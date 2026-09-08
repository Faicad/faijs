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
} from '@faicad/faijs-core/api/assembly/types'
import type { CompoundShape } from '@faicad/faijs-core/shape'
import { getSlot } from '@faicad/faijs-core/shape'
import type { RGB } from './workplane'
import { resolveFaceSelector } from './workplane'

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
  // Resolve via the same face enumeration as the Workplane API — this is
  // required for CadQuery-style indexed selectors like "bp@faces@>Z[-2]"
  // (second-highest Z face, e.g. a recess floor instead of the top annulus).
  // The returned center is the face's area centroid (CadQuery face Center)
  // and the normal is the outward direction.
  const { center: faceCenter, normal } = await resolveFaceSelector(shape, selector)
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

  const compound = cad.assembly({
    name,
    members: shapes,
    memberNames,
    constraints,
    memberColors,
  }) as unknown as CompoundShape

  // CadQuery's Assembly.save() solves constraints implicitly before export —
  // mirror that here so CLI STEP export sees the solved part poses.
  // NOTE: cad.assembly attaches solve() to the slot BEHAVIOR, not to the
  // compound object itself — a plain compound.solve lookup is always
  // undefined and the solve silently never ran.
  const behavior = getSlot(compound)?.behavior as { solve?: () => unknown } | undefined
  if (typeof behavior?.solve === 'function') behavior.solve()
  return compound
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
