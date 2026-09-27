/**
 * `cad.sketchOnPlane`: lift 2D contours onto an arbitrary plane (E2 placement).
 *
 * This is the shared "placement" step of the plan's unified 3D pipeline: any 2D
 * profile source (profile / draw / sketch) that describes contours as
 * `ProfileLoop`s can be placed here, then extruded along the plane normal. The
 * plane is a named plane (`'XY'` / `'XZ'` / `'top'` …) or an explicit frame
 * `{ origin, normal, xAxis }`. The plane lift runs on the occt platform surface
 * via the geometry2d bridge; the op declares `engines: ['occt']`.
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
import { profileSegToCurve, type ProfileSegLike } from '../geometry2d/adapt'
import { assertProfileParams, type ProfileLoop } from './profile'

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
  contours: ProfileLoop[]
  /** Named plane or explicit `{ origin, normal, xAxis }` frame. */
  plane: PlaneSpec
  /** Result shape: 'face' (default) builds a planar face; 'wire' returns the outer-loop wire only. */
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
 * Build a 3D Shape (planar face, or outer-loop wire when `as:'wire'`) from a set
 * of classified `Blueprint` contours on a plane. This is the shared placement
 * core for every 2D profile source (`cad.profile` / `cad.draw` / sketch): it
 * organises the closed contours (holes vs islands), assembles edge wires on the
 * plane via the geometry2d bridge, and wraps them as a BREP face — ready to be
 * extruded along the plane normal.
 * @param kernel - the BREP engine surface.
 * @param plane - the resolved target plane frame.
 * @param blueprints - ordered closed contours as `Blueprint`s (draw output).
 * @param as - `'face'` (default) or `'wire'` (outer loop only).
 * @returns Shape on the target plane (face, or a wire curve when `as:'wire'`).
 */
export function buildShapeFromBlueprints(
  kernel: BrepEngineApi,
  plane: Plane,
  blueprints: Blueprint[],
  as: 'face' | 'wire' = 'face',
): Shape {
  const organised = organiseBlueprints(blueprints)

  if (as === 'wire') {
    const outerBp =
      organised.blueprints[0] instanceof CompoundBlueprint
        ? organised.blueprints[0].blueprints[0]!
        : (organised.blueprints[0] as Blueprint)
    const wire = assembleWire(kernel, plane, outerBp)
    return fromBrepCurve(solidToShape(kernel, wire), { solid: wire })
  }

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
 * Build the 2D→3D placement: convert contour loops to a classified Blueprint
 * set, assemble a wire on the plane, then wrap as a face (or the outer wire).
 * @param kernel - the BREP engine surface.
 * @param params - contour loops + plane + mode.
 * @returns Shape on the target plane (face, or a wire curve when `as:'wire'`).
 */
export function buildSketchOnPlaneWith(kernel: BrepEngineApi, params: SketchOnPlaneParams): Shape {
  const plane = resolvePlane(params.plane)
  const blueprints = params.contours.map(
    (loop) => new Blueprint(loop.segments.map((s) => profileSegToCurve(s as ProfileSegLike))),
  )
  return buildShapeFromBlueprints(kernel, plane, blueprints, params.as ?? 'face')
}

/**
 * `cad.sketchOnPlane`: place 2D contours on a plane and construct a Shape.
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name sketchOnPlane
 * @returns Shape on the target plane (face, or a wire curve when `as:'wire'`).
 * @param params.contours - ordered 2D contours (same shape as `cad.profile`).type:any[] required:true
 * @param params.plane - named plane (`'XY'` / `'XZ'`…) or `{ origin, normal, xAxis }`.type:any required:true
 * @param params.as - `'face'` (default) or `'wire'` (outer loop only).type:string required:false
 */
export const sketchOnPlane = defineOp({
  capabilities: ['directEdit'],
  engines: ['occt'],
  brep(params: Record<string, unknown>) {
    assertProfileParams(params)
    return buildSketchOnPlaneWith(getBrepApi(), params as unknown as SketchOnPlaneParams)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})