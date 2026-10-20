/**
 * `cad.sketchOnSurface`: place 2D contours onto the UV parameter space of an
 * existing face (E3 placement) — the **curved / UV-conform** sketch op.
 *
 * This is the renamed successor of the old curved-capable `cad.sketchOnFace`
 * (2026-10-09 split). `cad.sketchOnFace` now owns the *planar* face case
 * (engine-neutral, works on OCCT and brepkit BREP as well as mesh solids); this
 * op owns the *surface* case: it maps the contour into the host face's `(u,v)`
 * domain and snaps the resulting wire to the surface via `fixWireOnFace` (occt
 * only), so it is declared `engines: ['occt']`.
 *
 * Unlike `sketchOnPlane` (which lifts a contour onto a whole plane *frame*),
 * `sketchOnSurface` lays the contour on the surface of a specific face of a
 * target solid. Every 2D curve is sampled, the samples mapped into the face's
 * `(u,v)` domain under a scale mode (`original` / `bounds` / `native`), the
 * surface evaluated at those UVs, and a curve edge interpolated through the
 * resulting 3D points (see `geometry2d/bridge/on-surface.ts`). The placed wire
 * then becomes a face (`as:'face'`) ready to be extruded along the face normal,
 * or is returned raw (`as:'wire'`).
 *
 * It is surface-type-independent (plane / cylinder / cone / sphere): for planar
 * host faces `makeFace` is exact, for curved ones the wire is snapped to the
 * surface via `fixWireOnFace` (occt-wasm 5.6) before `makeFace`. The op
 * declares `engines: ['occt']` because that snapping step needs the BREP
 * platform.
 * @module
 */
import type { Shape } from '../mesh/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, fromBrepCurve } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { Blueprint } from '../geometry2d/blueprint'
import { CompoundBlueprint } from '../geometry2d/compound-blueprint'
import { organiseBlueprints } from '../geometry2d/organise'
import { assembleWireOnFace, type FaceScaleMode } from '../geometry2d/bridge/on-surface'
import { profileSegToCurve, type ProfileSegLike } from '../geometry2d/adapt'
import { assertProfileParams, contourAnglesToRadians, type ProfileLoop } from './profile'
import { contoursDimSpec } from '../sketch/dim-spec.js'
import { fixWireOnFaceBrep } from './brep-operations/healingFns'
import { resolveFaceHandle, orientLikeHost, type SketchOnFaceParams } from './sketch-on-face'

/** Build one face (outer + optional holes) on the host face for an organised contour entry (UV-conform). */
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
 * by `cad.sketchOnSurface` (wrap as a Shape) and `cad.punchHole` (extrude → cut).
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
 * Build a 3D Shape from closed contours placed on the host face (UV-conform).
 * @param kernel - the BREP engine surface.
 * @param params - contour loops + target solid + face + scale mode.
 * @returns Shape on the target face (face, or the outer wire when `as:'wire'`).
 */
export function buildSketchOnSurfaceWith(kernel: BrepEngineApi, params: SketchOnFaceParams): Shape {
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
  if (faces.length === 0) throw new Error('sketchOnSurface: no contours to place')
  if (faces.length === 1) {
    const f = faces[0]!
    return fromBrep(solidToShape(kernel, f), { solid: f })
  }
  const compound = kernel.makeCompound(faces)
  return fromBrep(solidToShape(kernel, compound), { solid: compound })
}

/**
 * `cad.sketchOnSurface`: place 2D contours on a face of a solid via UV-conform
 * placement and construct a Shape.
 *
 * Curved/UV-conform variant of `cad.sketchOnFace` (which is now planar-only and
 * engine-neutral). This op maps the contour into the face's `(u,v)` domain and
 * snaps it to the surface, a step that needs the OCCT BREP platform, hence
 * `engines: ['occt']`.
 *
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name sketchOnSurface
 * @returns Shape on the target face (face, or a wire curve when `as:'wire'`).
 * @param params.contours - ordered 2D closed contours (same shape as `cad.profile`).type:any[] required:true
 * @param params.on - the target solid on which the face lives.type:Shape required:true
 * @param params.face - the host face: FaceTopoRef（UI 拾取产物字面量）| 面选择器字符串（如 ">Z"，在 on 上解析，多面命中抛错）| 1 起序号（仅网格链/当前内核快照，禁止用于生成脚本）。type:any required:true
 * @param params.scaleMode - UV mapping: 'original' (identity) | 'bounds'/'native' (affine-fit).type:string required:false
 * @param params.as - `'face'` (default) or `'wire'` (outer loop only).type:string required:false
 * @example
 * // loop = 一个闭合 2D 轮廓：{ segments: [{ kind: 'line', x1, y1, x2, y2 }, ...] }
 * const sk = cad.sketchOnSurface({ contours: [loop], on: cad.cylinder(20, 30), face: '>Z', scaleMode: 'original' })
 */
export const sketchOnSurface = defineOp({
  engines: ['occt'],
  brep(params: Record<string, unknown>) {
    assertProfileParams(params)
    contourAnglesToRadians(params.contours)
    return buildSketchOnSurfaceWith(getBrepApi(), params as unknown as SketchOnFaceParams)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,

  spec: contoursDimSpec(),
})
