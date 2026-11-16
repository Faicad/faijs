/**
 * `cad.sketchOnPlane`: lift 2D contours onto an arbitrary plane (E2 placement).
 *
 * This is the shared "placement" step of the plan's unified 3D pipeline: any 2D
 * profile source (profile / draw / sketch) that describes contours as
 * `ProfileLoop`s can be placed here, then extruded along the plane normal. The
 * plane is a named plane (`'XY'` / `'XZ'` / `'top'` …) or an explicit frame
 * `{ origin, normal, xAxis }`. The plane lift runs on the geometry2d bridge,
 * which builds exact analytic edges on BOTH engines: full circles via
 * `makeCircleEdge`, arcs via `makeArcEdge` (brepkit's circumcircle defect fixed
 * 2026-09-30). The op therefore carries no engine gate.
 * @module
 */
import type { Shape } from '../mesh/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getBrepApi } from '../brep/handle-bridge'
import { solidToShape } from '../brep/brep-ops'
import { fromBrep, fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { Blueprint } from '../geometry2d/blueprint'
import { CompoundBlueprint } from '../geometry2d/compound-blueprint'
import { organiseBlueprints } from '../geometry2d/organise'
import { namedPlane, makePlane, toVec3, type Plane, type Vec3Input } from '../geometry2d/bridge/plane'
import { assembleWire } from '../geometry2d/bridge/lift-on-plane'
import { assertProfileParams, contourAnglesToRadians, toContourBlueprints, type DrawnContours, type ProfileLoop } from './profile'
import { contoursDimSpec } from '../sketch/dim-spec.js'

/** A plane given by a named plane and/or an explicit frame (coords accept both array and `{x,y,z}`). */
export interface PlaneSpec {
  /** Named plane (`'XY'` / `'XZ'` / `'YZ'` / `'front'` / `'back'` / `'left'` / …). */
  name?: string
  /** The plane origin (default [0,0,0]; array `[x,y,z]` or `{x,y,z}`). */
  origin?: Vec3Input
  /** Explicit normal (used with an explicit frame; array or `{x,y,z}`). */
  normal?: Vec3Input
  /** Explicit in-plane X axis (auto-derived when omitted; array or `{x,y,z}`). */
  xAxis?: Vec3Input
}

/** Contour loops + a target plane (+ the result mode) for `cad.sketchOnPlane`. */
export interface SketchOnPlaneParams {
  /**
   * Contour source: segment loops (`{segments: […]}`) or already-drawn contours
   * (a `Blueprint`, or an array of them). The drawn form is what makes the
   * "draw → place → extrude" pipeline real — see {@link DrawnContours}.
   *
   * Contract for `as:'wire'`: one wire per input chain, in input order. A
   * single chain (open or closed) returns that chain's wire — an open chain is
   * accepted and becomes an open wire (the weapp sweep-spine path: one mixed
   * line/arc/spline chain). Multiple chains return a compound of wires
   * (distinguishable from a single wire via `getShapeType`).
   * (`as:'face'` keeps the closed-contour semantics: open chains make no
   * face — see `organiseBlueprints`.)
   */
  contours: ProfileLoop[] | DrawnContours
  /** Named plane or explicit `{ origin, normal, xAxis }` frame. */
  plane: PlaneSpec
  /** Result shape: 'face' (default) builds planar faces; 'wire' returns one wire per input chain (compound when multiple). */
  as?: 'face' | 'wire'
}

/**
 * Resolve a `PlaneSpec` to a plane frame. A named plane wins over an explicit
 * frame; with neither, the XY plane is used.
 * @param planeSpec - the user-facing plane spec (named plane and/or explicit frame).
 * @param fallbackOrigin - the origin used when `planeSpec.origin` is absent (default [0,0,0]).
 * @returns the resolved plane frame.
 */
export function resolvePlane(planeSpec: PlaneSpec, fallbackOrigin: Vec3Input = [0, 0, 0]): Plane {
  const o = planeSpec.origin ?? toVec3(fallbackOrigin)
  if (planeSpec.name) return namedPlane(planeSpec.name, o)
  if (planeSpec.normal) return makePlane(o, planeSpec.normal, planeSpec.xAxis)
  return namedPlane('XY', o)
}

/**
 * Build a 3D Shape from a set of `Blueprint` contours on a plane. This is the
 * shared placement core for every 2D profile source (`cad.profile` / a drawn
 * contour / sketch): with `as:'face'` it organises the closed contours (holes
 * vs islands), assembles edge wires on the plane via the geometry2d bridge,
 * and wraps them as BREP faces — ready to be extruded along the plane normal.
 * With `as:'wire'` every input chain becomes a wire, in input order (single
 * chain → that wire; multiple chains → a compound of wires).
 * @param kernel - the BREP engine surface.
 * @param plane - the resolved target plane frame.
 * @param blueprints - ordered contours as `Blueprint`s (draw output).
 * @param as - `'face'` (default) or `'wire'` (one wire per input chain).
 * @returns Shape on the target plane (face / face compound, or wire / wire compound).
 */
export function buildShapeFromBlueprints(
  kernel: BrepEngineApi,
  plane: Plane,
  blueprints: Blueprint[],
  as: 'face' | 'wire' = 'face',
): Shape {
  if (blueprints.length === 0) {
    throw new Error('E_PROFILE_NO_CONTOURS: at least one contour is required')
  }

  // wire 模式：孔/岛分类只对成面有意义，wire 不成面——逐条输入链按序组装。
  // 单链（开或闭）→ 该链 wire（与 weapp sweep-spine 路径一致）；
  // 多链 → wires 的 compound（与 as:'face' 多轮廓→面 compound 的口径对齐）。
  if (as === 'wire') {
    if (blueprints.length === 1) {
      const wire = assembleWire(kernel, plane, blueprints[0]!)
      return fromBrepCurve(solidToShape(kernel, wire), { solid: wire })
    }
    const wires = blueprints.map((bp) => assembleWire(kernel, plane, bp))
    const compound = kernel.makeCompound(wires)
    return fromBrepCurve(solidToShape(kernel, compound), { solid: compound })
  }

  const organised = organiseBlueprints(blueprints)

  const faces: ReturnType<BrepEngineApi['makeFace']>[] = []
  for (const entry of organised.blueprints) {
    if (entry instanceof CompoundBlueprint) {
      let face = kernel.makeFace(assembleWire(kernel, plane, entry.blueprints[0]!))
      const holes = entry.blueprints.slice(1).map((h) => assembleWire(kernel, plane, h) as never)
      if (holes.length > 0) {
        face = kernel.addHolesInFace(face, holes)
      }
      faces.push(face)
    } else {
      faces.push(kernel.makeFace(assembleWire(kernel, plane, entry)))
    }
  }

  if (faces.length === 1) {
    const f = faces[0]!
    return fromBrep(solidToShape(kernel, f), { solid: f })
  }
  const compound = kernel.makeCompound(faces)
  return fromBrep(solidToShape(kernel, compound), { solid: compound })
}

/**
 * Build the 2D→3D placement: normalize the contour source (segment loops or a
 * drawn contour) to a classified Blueprint set, assemble a wire on the plane,
 * then wrap as a face (or the outer wire).
 * @param kernel - the BREP engine surface.
 * @param params - contour source + plane + mode.
 * @returns Shape on the target plane (face, or a wire curve when `as:'wire'`).
 */
export function buildSketchOnPlaneWith(kernel: BrepEngineApi, params: SketchOnPlaneParams): Shape {
  const plane = resolvePlane(params.plane)
  // 2026-09-28：段环数据与「已绘制轮廓」（`Blueprint`）在此归一。少了这一步，
  // 「draw → sketchOnPlane → extrude」就断了 —— 已绘制轮廓没有 OCCT 句柄，
  // 实测喂 `cad.extrude` 报 `argument carries no BREP handle`、喂 `cad.sweep`
  // 报 `INVALID_SHAPE_ID`，全仓没有第二个能把它变成 Shape 的通道。
  const blueprints = toContourBlueprints(params.contours)
  return buildShapeFromBlueprints(kernel, plane, blueprints, params.as ?? 'face')
}

/**
 * `cad.sketchOnPlane`: place 2D contours on a plane and construct a Shape.
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name sketchOnPlane
 * @returns Shape on the target plane (face / face compound, or wire / wire compound when `as:'wire'`).
 * @param params.contours - ordered 2D contours (same shape as `cad.profile`: segment loops, or a drawn `Blueprint`).type:any required:true
 * @param params.plane - named plane (`'XY'` / `'XZ'`…) or `{ origin, normal, xAxis }`.type:any required:true
 * @param params.as - `'face'` (default) or `'wire'` (one wire per input chain; compound when multiple).type:string required:false
 * @example
 * // loop = 一个闭合 2D 轮廓：{ segments: [{ kind: 'line', x1, y1, x2, y2 }, ...] }
 * const face = cad.sketchOnPlane({ contours: [loop], plane: 'XY' })
 * // 显式坐标系：截面落在任意空间点，法向沿扫掠脊柱起点切向（不必再记 XY/XZ/YZ 的
 * // cx/cy 映射，也不用手工 translate）。下面把截面放在 (0,0,90)、法向 +Y：
 * const sec = cad.sketchOnPlane({
 *   contours: [ring],                     // ring = 圆环轮廓（外圆 + 内圆）
 *   plane: { origin: [0, 0, 90], normal: [0, 1, 0] },
 * })
 * // 只给 normal 时平面内 xAxis 是自动推导的（normal=[0,1,0] ⇒ 局部 +X 落在世界 +Z），
 * // 圆形/对称截面无所谓；**非对称截面要固定朝向就必须显式给 xAxis**：
 * const asymmetric = cad.sketchOnPlane({
 *   contours: [rect],
 *   plane: { origin: [0, 0, 90], normal: [0, 1, 0], xAxis: [1, 0, 0] },
 * })
 */
export const sketchOnPlane = defineOp({

  brep(params: Record<string, unknown>) {
    assertProfileParams(params)
    contourAnglesToRadians(params.contours)
    return buildSketchOnPlaneWith(getBrepApi(), params as unknown as SketchOnPlaneParams)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,

  spec: contoursDimSpec(),
})