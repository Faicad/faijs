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
 * planar faces; embedding the wire into a genuinely curved host face
 * (`fixWireOnFace`) is a follow-up. The op declares `engines: ['occt']`
 * (surface sampling needs the BREP platform).
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
import { profileSegToCurve, type ProfileSegLike } from '../geometry2d/adapt'
import { assertProfileParams, type ProfileLoop } from './profile'

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

/** Build one face (outer + optional holes) on the host face for an organised contour entry. */
function buildOnFace(kernel: BrepEngineApi, host: BrepHandle, mode: FaceScaleMode, entry: Blueprint | CompoundBlueprint): BrepHandle {
  if (entry instanceof CompoundBlueprint) {
    let face = kernel.makeFace(assembleWireOnFace(kernel, host, mode, entry.blueprints[0]!).wire)
    const holes = entry.blueprints.slice(1).map((h) => assembleWireOnFace(kernel, host, mode, h).wire as never)
    if (holes.length > 0) face = kernel.addHolesInFace(face, holes)
    return face
  }
  return kernel.makeFace(assembleWireOnFace(kernel, host, mode, entry).wire)
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

  const faces: BrepHandle[] = organised.blueprints.map((entry) => buildOnFace(kernel, host, mode, entry))
  if (faces.length === 0) throw new Error('sketchOnFace: no contours to place')
  if (faces.length === 1) {
    const f = faces[0]!
    return fromBrep(solidToShape(kernel, f), { solid: f })
  }
  const compound = kernel.makeCompound(faces)
  return fromBrep(solidToShape(kernel, compound), { solid: compound })
}

/**
 * `cad.sketchOnFace`: place 2D contours on a face of a solid and construct a Shape.
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
  brep(params: Record<string, unknown>) {
    assertProfileParams(params)
    return buildSketchOnFaceWith(getBrepApi(), params as unknown as SketchOnFaceParams)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})