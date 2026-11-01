/**
 * Declaration → toolpath entry point (worker side).
 *
 * Given a cam operation declaration, the target part's faijs `Shape`, and the
 * machine profile, this resolves the operation geometry (face selection via
 * `faceRanges`, whole-part triangles for roughing) and calls the matching
 * algorithm module. It is the only place the worker's `camGenerate`
 * instruction core needs to import.
 *
 * Geometry rule (3d_editor architecture red line): the triangles consumed here
 * come from the very `positions`/`indices` buffers the UI renders — the same
 * tessellation the user sees.
 */
import type { Shape } from '@faicad/faijs/browser'
import { makeFaceTriangleFilter, trianglesFromMesh } from './geometry.js'
import type { Triangle } from './geometry.js'
import { normalizeCamMachineProfile } from './profile.js'
import type { CamMachineProfile } from './profile.js'
import type { CamMachineDecl, CamOperationDecl } from './decl.js'
import type { CamToolpathProgram } from './types.js'
import { generateSurfacingToolpath } from './surfacing.js'
import type { SurfacingParams } from './surfacing.js'
import { generateRoughingToolpath } from './roughing.js'
import type { RoughingParams } from './roughing.js'

/** CamGenerateTarget — CAM toolpath type (BREP.io port). */
export type CamGenerateTarget = {
  /** The target part's displayed mesh shape (worker-internal solid tessellation). */
  shape: Shape
}

/** machineDeclToProfile — CAM toolpath helper (BREP.io port).
 *
 *
 * @param decl - the decl value.
 * @returns CamMachineProfile - computed result.
 */
export function machineDeclToProfile(decl: CamMachineDecl | null): CamMachineProfile {
  return normalizeCamMachineProfile(decl || null)
}

/** generateToolpathForDeclaration — CAM toolpath helper (BREP.io port).
 *
 *
 * @param op - the op value.
 * @param target - the target value.
 * @param machine - the machine value.
 * @returns CamToolpathProgram - computed result.
 */
export function generateToolpathForDeclaration(
  op: CamOperationDecl,
  target: CamGenerateTarget,
  machine: CamMachineProfile,
): CamToolpathProgram {
  const triangles = trianglesFromMesh(target.shape.positions, target.shape.indices)
  if (op.kind === 'roughing') {
    const params: RoughingParams = {
      toolDiameter: op.tool?.diameter,
      toolLength: op.tool?.cuttingLength,
      stockAllowance: op.stockAllowance,
      stepDown: op.stepDown,
      extraDepth: op.extraDepth,
      safeHeight: op.safeHeight,
      feedRate: op.feedRate,
      plungeRate: op.plungeRate,
      spindleRPM: op.spindleRPM,
    }
    return generateRoughingToolpath({
      operationId: op.name,
      operationName: op.name,
      machine,
      params,
      triangles,
    })
  }
  // surfacing
  const faceTriangles = resolveFaceTriangles(op, target.shape, triangles)
  const params: SurfacingParams = {
    toolDiameter: op.tool?.diameter,
    toolLength: op.tool?.cuttingLength,
    stockAllowance: op.stockAllowance,
    stepover: op.stepover,
    linkClearance: op.linkClearance,
    pathTolerance: op.pathTolerance,
    sampleSpacing: op.sampleSpacing,
    minSampleSpacing: op.minSampleSpacing,
    flatnessCosLimit: op.flatnessCosLimit,
    rasterDirection: op.rasterDirection,
    safeHeight: op.safeHeight,
    feedRate: op.feedRate,
    plungeRate: op.plungeRate,
    spindleRPM: op.spindleRPM,
  }
  return generateSurfacingToolpath({
    operationId: op.name,
    operationName: op.name,
    machine,
    params,
    faceTriangles,
    obstacleTriangles: triangles,
  })
}

/** resolveFaceTriangles — CAM toolpath helper (BREP.io port).
 *
 *
 * @param op - the op value.
 * @param shape - the shape value.
 * @param triangles - the triangles value.
 * @returns Triangle[] - computed result.
 */
export function resolveFaceTriangles(
  op: CamOperationDecl,
  shape: Shape,
  triangles: Triangle[],
): Triangle[] {
  const faces = op.faces
  if (faces === undefined || faces === 'all' || faces === null) return triangles
  if (typeof faces === 'number') {
    const selected = trianglesFromMesh(shape.positions, shape.indices, makeFaceTriangleFilterChecked(shape, op.name, [faces]))
    if (!selected.length) {
      throw new Error(`[cam] ${op.name}: face ${faces} selects no triangles.`)
    }
    return selected
  }
  if (Array.isArray(faces)) {
    const entityRefs = faces.filter((f): f is { part?: string; faceIndex?: number | number[]; name?: string } => typeof f === 'object' && f !== null)
    if (entityRefs.length) {
      throw new Error(
        `[cam] ${op.name}: entity-shaped face references must be resolved to face indices before execution ` +
          '(worker cannot map (part, faceIndex) pairs without host selection state).',
      )
    }
    const indices = faces as number[]
    const filter = makeFaceTriangleFilter(shape.faceRanges, indices)
    if (!filter) {
      throw new Error(
        `[cam] ${op.name}: faces ${JSON.stringify(indices)} cannot be resolved — ` +
          'the target shape has no faceRanges (boolean/imported shapes have no CAD faces).',
      )
    }
    const selected = trianglesFromMesh(shape.positions, shape.indices, filter)
    if (!selected.length) {
      throw new Error(`[cam] ${op.name}: faces ${JSON.stringify(indices)} select no triangles.`)
    }
    return selected
  }
  return triangles
}

function makeFaceTriangleFilterChecked(shape: Shape, opName: string, indices: number[]) {
  const filter = makeFaceTriangleFilter(shape.faceRanges, indices)
  if (!filter) {
    throw new Error(
      `[cam] ${opName}: faces ${JSON.stringify(indices)} cannot be resolved — ` +
        'the target shape has no faceRanges (boolean/imported shapes have no CAD faces).',
    )
  }
  return filter
}
