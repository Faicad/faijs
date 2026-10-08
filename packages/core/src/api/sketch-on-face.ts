/**
 * `cad.sketchOnFace`: place 2D contours onto the UV parameter space of an
 * existing face (E3 placement).
 *
 * Unlike `sketchOnPlane` (which lifts a contour onto a whole plane *frame*),
 * `sketchOnFace` lays the contour on the surface of a specific face of a target
 * solid. Every 2D curve is sampled, the samples mapped into the face's `(u,v)`
 * domain under a scale mode (`original` / `bounds` / `native`), the surface
 * evaluated at those UVs, and a curve edge interpolated through the resulting
 * 3D points (see `geometry2d/bridge/on-surface.ts`). The placed wire then
 * becomes a face (`as:'face'`) ready to be extruded along the face normal, or
 * is returned raw (`as:'wire'`).
 *
 * v1 scope: the on-surface primitive is surface-type-independent, but the result
 * face is built with `makeFace` on the interpolated wire, so it is exact for
 * planar faces; for curved host faces the wire is snapped to the surface via
 * `fixWireOnFace` (occt-wasm 5.6) before `makeFace`. The op declares
 * `engines: ['occt']` (surface sampling needs the BREP platform).
 *
 * **Two chains, two mechanisms** (plan 2026-10-01 §4 Phase 3). The BREP branch
 * above maps the contour into the host face's UV domain. The **mesh branch**
 * (`buildSketchOnFaceMesh`, `meshEngines: ['brepkit']`) works on a mesh solid's
 * approximate topology and deliberately does NOT use UV space: a brepkit plane's
 * domain is ±1e6 (an infinite domain), so "place the sketch in the face's UV
 * range" is meaningless there. It places the contour in the face's own plane
 * frame instead (origin = face bbox centre, normal = `surfaceNormal`), which
 * matches `cad.sketchOnPlane`'s semantics. The result is a **mesh-chain face**
 * (`ShapeSlot.meshFace`), ready for the mesh branch of `cad.extrude`.
 * @module
 */
import type { Shape } from '../mesh/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'
import { getBrepApi } from '../brep/handle-bridge'
import { solidToShape } from '../brep/brep-ops'
import { fromBrep, fromBrepCurve, brepOf } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { TopoRefError, resolveTopoRef, type FaceTopoRef } from '../topology/naming'
import { buildEdgeResolutionContext } from './topo-resolve'
import { Blueprint } from '../geometry2d/blueprint'
import { CompoundBlueprint } from '../geometry2d/compound-blueprint'
import { organiseBlueprints } from '../geometry2d/organise'
import { assembleWireOnFace, type FaceScaleMode } from '../geometry2d/bridge/on-surface'
import { assembleWire, type Plane, type Vec3 } from '../geometry2d/bridge/lift-on-plane'
import { profileSegToCurve, type ProfileSegLike } from '../geometry2d/adapt'
import { assertProfileParams, toContourBlueprints, type ProfileLoop } from './profile'
import { fixWireOnFaceBrep } from './brep-operations/healingFns'
import { MeshUnsupportedError, getCurrentStmt } from '../runtime-state'
import {
  meshBackendOrThrow,
  meshFacePlane,
  meshFaceProduct,
  resolveMeshFaceHandle,
} from './internal/mesh-solid-op'

/** A face selector on a target solid: a 1-based ordinal (FreeCAD `FaceN`) or a `cad.faceRef` result. */
export type FaceSelector = number | FaceTopoRef

/** Contour loops + the target face for `cad.sketchOnFace`. */
export interface SketchOnFaceParams {
  /** Ordered 2D closed contours (same shape as `cad.profile` / `cad.sketchOnPlane`). */
  contours: ProfileLoop[]
  /** The target solid on which the host face lives. */
  on: Shape
  /** The host face: a 1-based face ordinal, or a `cad.faceRef(on, n)` result. */
  face: FaceSelector
  /** How 2D coords map onto the face UV space: `'original'` (identity) | `'bounds'`/`'native'` (affine-fit). */
  scaleMode?: FaceScaleMode
  /** Result shape: `'face'` (default) builds a face on the contour; `'wire'` returns the outer-loop wire only. */
  as?: 'face' | 'wire'
}

/**
 * Resolve a face on `on` to its live BREP handle (1-based ordinal or `cad.faceRef`).
 * @param kernel - the BREP engine surface.
 * @param on - the target solid shape.
 * @param selector - the face ordinal or `cad.faceRef` result.
 * @returns the live face handle.
 */
export function resolveFaceHandle(kernel: BrepEngineApi, on: Shape, selector: FaceSelector): BrepHandle {
  const solid = brepOf(on) as BrepHandle | undefined
  if (!solid) {
    throw new TopoRefError('E_TOPO_MESH_UNSUPPORTED', 'face', 'sketchOnFace: target `on` has no BREP solid')
  }
  if (typeof selector === 'number') {
    const faces = kernel.getSubShapes(solid, 'face')
    if (!Number.isInteger(selector) || selector < 1 || selector > faces.length) {
      throw new TopoRefError(
        'E_TOPO_NOT_FOUND',
        'face',
        `sketchOnFace: face ordinal ${selector} out of range [1, ${faces.length}]`,
      )
    }
    return faces[selector - 1] as BrepHandle
  }
  if (selector.kind !== 'face') {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'sketchOnFace: selector must be a face ordinal or a face ref')
  }
  const ctx = buildEdgeResolutionContext(kernel, on as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'sketchOnFace: input has no naming context')
  const resolved = resolveTopoRef(selector, ctx)
  if (resolved.handle === undefined) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'sketchOnFace: face ref resolved to no live handle')
  }
  return resolved.handle as BrepHandle
}

/**
 * Make the placed face inherit the host face's outward orientation: surface
 * normals must point the same way, otherwise the resulting face — and any prism
 * extruded from it — carries a reversed shell whose OCCT volume collapses to ~0.
 * @param kernel - the BREP engine surface.
 * @param host - the host face handle (its normal is the reference).
 * @param face - the face built on the host surface.
 * @returns a handle to the (possibly re-oriented) face.
 */
function orientLikeHost(kernel: BrepEngineApi, host: BrepHandle, face: BrepHandle): BrepHandle {
  const a = kernel.surfaceNormal(host, 0, 0)
  const b = kernel.surfaceNormal(face, 0, 0)
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  return dot < 0 ? kernel.reverseShape(face) : face
}

/** Build one face (outer + optional holes) on the host face for an organised contour entry. */
function buildOnFace(kernel: BrepEngineApi, host: BrepHandle, mode: FaceScaleMode, entry: Blueprint | CompoundBlueprint): BrepHandle {
  if (entry instanceof CompoundBlueprint) {
    const outerWire = fixWireOnFaceBrep(assembleWireOnFace(kernel, host, mode, entry.blueprints[0]!).wire, host)
    let face = orientLikeHost(kernel, host, kernel.makeFace(outerWire))
    const holes = entry.blueprints.slice(1).map((h) => fixWireOnFaceBrep(assembleWireOnFace(kernel, host, mode, h).wire, host) as never)
    if (holes.length > 0) face = kernel.addHolesInFace(face, holes)
    return face
  }
  const wire = fixWireOnFaceBrep(assembleWireOnFace(kernel, host, mode, entry).wire, host)
  return orientLikeHost(kernel, host, kernel.makeFace(wire))
}

/**
 * Place `contours` onto the UV space of the host face and return one BREP face
 * per classified contour (each outer + holes folded into a single face). Shared
 * by `cad.sketchOnFace` (wrap as a Shape) and `cad.punchHole` (extrude → cut).
 * @param kernel - the BREP engine surface.
 * @param host - the resolved live host face handle.
 * @param mode - the face-scale (UV mapping) mode.
 * @param contours - ordered 2D closed contour loops to place.
 * @returns the BREP faces built on the host face (one per organised entry).
 */
export function placeContoursOnFace(
  kernel: BrepEngineApi,
  host: BrepHandle,
  mode: FaceScaleMode,
  contours: ProfileLoop[],
): BrepHandle[] {
  const blueprints = contours.map(
    (loop) => new Blueprint(loop.segments.map((s) => profileSegToCurve(s as ProfileSegLike))),
  )
  const organised = organiseBlueprints(blueprints)
  return organised.blueprints.map((entry) => buildOnFace(kernel, host, mode, entry))
}

/**
 * Build a 3D Shape from closed contours placed on the host face.
 * @param kernel - the BREP engine surface.
 * @param params - contour loops + target solid + face + scale mode.
 * @returns Shape on the target face (face, or the outer wire when `as:'wire'`).
 */
export function buildSketchOnFaceWith(kernel: BrepEngineApi, params: SketchOnFaceParams): Shape {
  const host = resolveFaceHandle(kernel, params.on, params.face)
  const mode = params.scaleMode ?? 'original'
  const blueprints = params.contours.map(
    (loop) => new Blueprint(loop.segments.map((s) => profileSegToCurve(s as ProfileSegLike))),
  )
  const organised = organiseBlueprints(blueprints)

  if (params.as === 'wire') {
    const outer =
      organised.blueprints[0] instanceof CompoundBlueprint
        ? organised.blueprints[0].blueprints[0]!
        : (organised.blueprints[0] as Blueprint)
    const { wire } = assembleWireOnFace(kernel, host, mode, outer)
    return fromBrepCurve(solidToShape(kernel, wire), { solid: wire })
  }

  const faces = placeContoursOnFace(kernel, host, mode, params.contours)
  if (faces.length === 0) throw new Error('sketchOnFace: no contours to place')
  if (faces.length === 1) {
    const f = faces[0]!
    return fromBrep(solidToShape(kernel, f), { solid: f })
  }
  const compound = kernel.makeCompound(faces)
  return fromBrep(solidToShape(kernel, compound), { solid: compound })
}

/**
 * 把一张平面的法向对齐到参考方向（外部朝向）。网格链上的复制版：BREP 侧的
 * `orientLikeHost` 存在的原因是"面朝向反了 → 由它拉出的棱柱壳反向 → 体积归零"，
 * 这里同一个道理，只是参考法向来自**平面本身**（`meshFacePlane` 的法向就是从宿主面
 * 的 `surfaceNormal` 取的），不必再回读宿主句柄。
 *
 * @param kernel - the mesh backend's L1 kernel.
 * @param reference - the outward normal the placed face must agree with.
 * @param face - the face built on the plane.
 * @returns a handle to the (possibly re-oriented) face.
 */
function orientFaceTo(kernel: BrepEngineApi, reference: Vec3, face: BrepHandle): BrepHandle {
  const uv = kernel.uvBounds(face)
  const n = kernel.surfaceNormal(face, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
  const dot = reference.x * n.x + reference.y * n.y + reference.z * n.z
  return dot < 0 ? kernel.reverseShape(face) : face
}

/** 一个已归类的轮廓条目（外环 + 可选孔）在平面坐标系里造一张面。 */
function buildFaceOnPlane(
  kernel: BrepEngineApi,
  plane: Plane,
  outward: Vec3,
  entry: Blueprint | CompoundBlueprint,
): BrepHandle {
  const outerBp = entry instanceof CompoundBlueprint ? entry.blueprints[0]! : entry
  let face = orientFaceTo(kernel, outward, kernel.makeFace(assembleWire(kernel, plane, outerBp)))
  if (entry instanceof CompoundBlueprint) {
    const holes = entry.blueprints.slice(1).map((h) => assembleWire(kernel, plane, h) as never)
    if (holes.length > 0) face = kernel.addHolesInFace(face, holes)
  }
  return face
}

/**
 * 网格链上的 `cad.sketchOnFace`：在**识别出的平面网格面**上铺 2D 轮廓，产出网格链面
 * （方案 2026-10-01 §4 Phase 3-2），可交给 `cad.extrude` 的网格路径拉伸出新实体。
 *
 * 与 BREP 侧的三点差别，每一点都是"近似拓扑没有 UV 语义"的直接后果：
 *
 * 1. **不走 UV 域**。BREP 侧 `assembleWireOnFace` 把 2D 采样点映射进面的 `(u,v)` 域；
 *    而平面在 brepkit 上的域是 ±1e6 的**无限域**（方案 §4 Phase 3-1 实测），拿它当
 *    草图范围毫无意义。这里改用面自己的平面框（原点 = 面包围盒中心、法向 = 面法向），
 *    2D 坐标直接落在平面坐标系里——与 `cad.sketchOnPlane` 的语义一致。
 * 2. **`scaleMode` 只接受 `'original'`**。`'bounds'` / `'native'` 的定义是"拟合到面的
 *    UV 域"，而那个域在这里要么是无限域、要么不存在。静默按 `'original'` 处理会造成
 *    "同一次调用在两条链上得到不同尺寸"的隐性分歧，所以如实拒绝。
 * 3. **`as:'wire'` 不支持**。网格链上的一根 wire 没有身份槽（面才有），而 sketch 的
 *    下游用途（拉伸）要的正是面。需要 wire 的场景请走 BREP 链。
 *
 * 另外只支持**平面面**：曲面面（STL 圆柱的侧面片）上铺草图需要曲面嵌入，属未开的能力。
 *
 * @param params - contour loops + target mesh solid + face selector + scale mode.
 * @returns the mesh-chain face Shape on the target face.
 * @throws {MeshUnsupportedError} when the target is not a mesh solid, the face is not planar,
 *   the scale mode is not `'original'`, `as:'wire'` was requested, or the sketch is multi-island.
 */
export function buildSketchOnFaceMesh(params: SketchOnFaceParams): Shape {
  const opLabel = 'sketchOnFace'
  const backend = meshBackendOrThrow(opLabel)
  const kernel = backend.kernel

  const mode = params.scaleMode ?? 'original'
  if (mode !== 'original') {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel} scaleMode '${mode}' is defined against the face's UV domain, ` +
      'which a mesh-chain face does not have — use the default \'original\' (2D coords live in the face plane)',
      getCurrentStmt(),
    )
  }
  if (params.as === 'wire') {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel} as:'wire' has no mesh-chain representation — ` +
      'a mesh-chain wire has no identity slot; ask for the default as:\'face\' instead',
      getCurrentStmt(),
    )
  }

  const host = resolveMeshFaceHandle(kernel, params.on, params.face, opLabel)
  const surface = kernel.surfaceType(host)
  if (surface !== 'plane') {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel} needs a planar mesh face to sketch on — this face reports ` +
      `surfaceType '${surface}'. Sketches on curved approximate faces are not implemented ` +
      '(an STL cylinder is 32 planar strips, each of which IS usable)',
      getCurrentStmt(),
    )
  }

  const plane = meshFacePlane(kernel, host)
  const outward: Vec3 = { x: plane.zDir.x, y: plane.zDir.y, z: plane.zDir.z }

  const organised = organiseBlueprints(toContourBlueprints(params.contours))
  if (organised.blueprints.length === 0) throw new Error('sketchOnFace: no contours to place')
  if (organised.blueprints.length > 1) {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel} produced ${organised.blueprints.length} disjoint islands — ` +
      'the mesh backend can only extrude a single face (brepkit extrude takes one face, not a compound). ' +
      'Sketch and extrude each island separately, then unite them with a boolean',
      getCurrentStmt(),
    )
  }

  const face = buildFaceOnPlane(kernel, plane, outward, organised.blueprints[0]!)
  return meshFaceProduct(backend, face)
}

/**
 * `cad.sketchOnFace`: place 2D contours on a face of a solid and construct a Shape.
 *
 * **网格链**（`meshEngines: ['brepkit']`，方案 2026-10-01 §4 Phase 3）：`on` 是网格实体
 * 时，轮廓按面自己的**平面框**铺放（原点 = 面包围盒中心、法向 = 面法向），产物是一张
 * 网格链面，可直接交给 `cad.extrude` 拉伸。该分支只接受平面面、只接受默认
 * `scaleMode`（`'bounds'`/`'native'` 相对 UV 域定义，网格链上没有 UV 域）、只接受
 * `as:'face'`、且只接受单个轮廓岛——每一条越界都以 `E_MESH_SOLID_UNSUPPORTED` 说明原因。
 *
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name sketchOnFace
 * @returns Shape on the target face (face, or a wire curve when `as:'wire'`).
 * @param params.contours - ordered 2D closed contours (same shape as `cad.profile`).type:any[] required:true
 * @param params.on - the target solid on which the face lives.type:Shape required:true
 * @param params.face - the host face: a 1-based ordinal or a `cad.faceRef(on, n)` result.type:any required:true
 * @param params.scaleMode - UV mapping: 'original' (identity) | 'bounds'/'native' (affine-fit).type:string required:false
 * @param params.as - `'face'` (default) or `'wire'` (outer loop only).type:string required:false
 */
export const sketchOnFace = defineOp({
  capabilities: ['directEdit'],
  engines: ['occt'],
  meshEngines: ['brepkit'],
  mesh(params: Record<string, unknown>) {
    assertProfileParams(params)
    return buildSketchOnFaceMesh(params as unknown as SketchOnFaceParams)
  },
  brep(params: Record<string, unknown>) {
    assertProfileParams(params)
    return buildSketchOnFaceWith(getBrepApi(), params as unknown as SketchOnFaceParams)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})