/**
 * cq-compat assembly helpers — CadQuery Assembly.constrain → faijs cad.assembly.
 *
 * Maps CadQuery constraint DSL ("part@faces@>Z[-2]", "Plane"/"Axis") to faijs
 * AssemblyConstraint objects with EntityRef geometry snapshots.
 *
 * Constraint mapping (verified against faijs api/assembly/lower.ts):
 * - "Plane" → mate (face-to-face: normal reversed + center coincident)
 * - "Axis"  → align (normal same direction + center coincident; plane face refs
 *             are encoded as axis via axisFromFace — concentric would reject
 *             plane faces because faceGeometryToSolverEntity maps plane→plane
 *             entity, not axis)
 */

import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type {
  AssemblyConstraint,
  EntityRef,
  AssemblyVec3,
} from '@faicad/faijs-core/api/assembly/types'
import type { CompoundShape } from '@faicad/faijs-core/shape'
import type { RGB } from './workplane'

const cad = createApiNamespace() as Record<string, (...args: unknown[]) => Promise<unknown>>

/**
 * faceRef
 * @param partName - string
 * @param selector - string
 * @param shape - Shape
 * @returns Promise<EntityRef>
 */
export async function faceRef(
  partName: string,
  selector: string,
  shape: Shape,
): Promise<EntityRef> {
  const max = (await cad.bboxMax(shape)) as unknown as AssemblyVec3
  const min = (await cad.bboxMin(shape)) as unknown as AssemblyVec3
  const center: AssemblyVec3 = [
    (max[0] + min[0]) / 2,
    (max[1] + min[1]) / 2,
    (max[2] + min[2]) / 2,
  ]

  // Strip index suffix like [-2]
  const baseSel = selector.replace(/\[-?\d+\]$/, '')

  let faceCenter: AssemblyVec3 = center
  let normal: AssemblyVec3 = [0, 0, 1]

  switch (baseSel) {
    case '>Z':
    case '+Z':
      faceCenter = [center[0], center[1], max[2]]
      normal = [0, 0, 1]
      break
    case '<Z':
    case '-Z':
      faceCenter = [center[0], center[1], min[2]]
      normal = [0, 0, -1]
      break
    case '>X':
    case '+X':
      faceCenter = [max[0], center[1], center[2]]
      normal = [1, 0, 0]
      break
    case '<X':
    case '-X':
      faceCenter = [min[0], center[1], center[2]]
      normal = [-1, 0, 0]
      break
    case '>Y':
    case '+Y':
      faceCenter = [center[0], max[1], center[2]]
      normal = [0, 1, 0]
      break
    case '<Y':
    case '-Y':
      faceCenter = [center[0], min[1], center[2]]
      normal = [0, -1, 0]
      break
    default:
      // Unknown selector — use center with +Z normal (best effort)
      break
  }

  return {
    part: partName,
    face: {
      surfaceType: 'plane',
      center: faceCenter,
      normal,
    },
  } as EntityRef
}

/**
 * constraint
 * @param aPart - string
 * @param aSelector - string
 * @param aShape - Shape
 * @param bPart - string
 * @param bSelector - string
 * @param bShape - Shape
 * @param type - 'Plane' | 'Axis'
 * @returns Promise<AssemblyConstraint>
 */
export async function constraint(
  aPart: string,
  aSelector: string,
  aShape: Shape,
  bPart: string,
  bSelector: string,
  bShape: Shape,
  type: 'Plane' | 'Axis',
): Promise<AssemblyConstraint> {
  if (!aShape) throw new Error(`constraint: aShape for part "${aPart}" is null/undefined`)
  if (!bShape) throw new Error(`constraint: bShape for part "${bPart}" is null/undefined`)
  const a = await faceRef(aPart, aSelector, aShape)
  const b = await faceRef(bPart, bSelector, bShape)

  if (type === 'Plane') {
    return { type: 'mate', a, b } as AssemblyConstraint
  }
  // Axis → align (plane faces encoded as axis; concentric would reject planes)
  return { type: 'align', a, b } as AssemblyConstraint
}

/**
 * buildAssembly
 * @param name - string
 * @param members - Array<{ name: string; shape: Shape; color?: RGB }>
 * @param constraints - AssemblyConstraint[]
 * @returns CompoundShape
 */
export function buildAssembly(
  name: string,
  members: Array<{ name: string; shape: Shape; color?: RGB }>,
  constraints: AssemblyConstraint[],
): CompoundShape {
  const shapes = members.map((m) => m.shape)
  const memberNames = members.map((m) => m.name)
  const memberColors: Record<string, [number, number, number]> = {}
  for (const m of members) {
    if (m.color) memberColors[m.name] = m.color
  }

  return cad.assembly({
    name,
    members: shapes,
    memberNames,
    constraints,
    memberColors,
  }) as unknown as CompoundShape
}

/**
 * Color
 * @param r - number
 * @param g - number
 * @param b - number
 * @param _a - number
 * @returns RGB
 */
export function Color(r: number, g: number, b: number, _a?: number): RGB {
  return [r, g, b]
}
