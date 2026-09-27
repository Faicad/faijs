/**
 * organiseBlueprints — classify a set of 2D profiles (outer / holes / disjoint)
 * into Blueprint / CompoundBlueprint / Blueprints (pure-data port of brepjs
 * `2d/blueprints/lib.ts`, Apache-2.0).
 *
 * Adaptation notes:
 * - brepjs uses Flatbush to accelerate bbox-overlap grouping; faijs uses an
 *   equivalent union-find over pairwise bbox overlap (O(n²), constant factor at
 *   profile scale), documented in an Agent Note. Classification results are
 *   identical to brepjs for the non-crossing cases the algorithm handles.
 * - `addContainmentInfo` probes the midpoint of the first curve of each
 *   blueprint and runs `isInside` (exact ray-cast via intersectCurves2dFn).
 *
 * @module
 */
import { Blueprint } from './blueprint'
import { CompoundBlueprint } from './compound-blueprint'
import { Blueprints } from './blueprints'
import { curveBounds, evaluateCurve2d } from './curve2d'
import { isBBoxOut } from './bbox2d'

interface Grouped {
  /** original index into the input array (used as identity) */
  blueprint: Blueprint
  /** blueprints that contain this one */
  isIn: Blueprint[]
}

/** Group blueprints whose bounding boxes overlap (union-find over overlap graph). */
function groupByBoundingBoxOverlap(blueprints: Blueprint[]): Blueprint[][] {
  if (blueprints.length === 0) return []
  if (blueprints.length === 1) return [[blueprints[0]!]]
  // Build overlap neighbor lists (only j > i to avoid duplicating each pair)
  const overlaps: number[][] = blueprints.map(() => [])
  for (let i = 0; i < blueprints.length; i++) {
    const bi = blueprints[i]!
    for (let j = i + 1; j < blueprints.length; j++) {
      if (!isBBoxOut(bi.boundingBox, blueprints[j]!.boundingBox)) {
        overlaps[i]!.push(j)
        overlaps[j]!.push(i)
      }
    }
  }
  // Union-find
  const parent = blueprints.map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]!
      x = parent[x]!
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  for (let i = 0; i < overlaps.length; i++) {
    for (const j of overlaps[i]!) union(i, j)
  }
  const byRoot = new Map<number, Blueprint[]>()
  for (let i = 0; i < blueprints.length; i++) {
    const root = find(i)
    const list = byRoot.get(root)
    if (list) list.push(blueprints[i]!)
    else byRoot.set(root, [blueprints[i]!])
  }
  return [...byRoot.values()]
}

/** Probe each blueprint with its first-curve midpoint; gather containing blueprints. */
function addContainmentInfo(groupedBlueprints: Blueprint[]): Grouped[] {
  return groupedBlueprints.map((blueprint) => {
    const firstCurve = blueprint.curves[0]!
    const b = curveBounds(firstCurve)
    const point = evaluateCurve2d(firstCurve, (b.first + b.last) / 2)
    const isIn = groupedBlueprints.filter((potentialOuter) => {
      if (potentialOuter === blueprint) return false
      return potentialOuter.isInside(point as [number, number])
    })
    return { blueprint, isIn }
  })
}

function splitMultipleOuterBlueprints(outerBlueprint: Grouped[], allGrouped: Grouped[]): Grouped[][] {
  return outerBlueprint.flatMap(({ blueprint: outerBlueprint }) => {
    return cleanEdgeCases(
      allGrouped.filter(({ blueprint, isIn }) => blueprint === outerBlueprint || isIn.includes(outerBlueprint)),
    )
  })
}

function handleNestedBlueprints(nestedBlueprints: Grouped[], allBlueprints: Grouped[]): Grouped[][] {
  // First level: all profiles contained in ≤1 ancestor; deeper levels re-grouped.
  const firstLevelOuter = allBlueprints.filter(({ isIn }) => isIn.length <= 1)
  const innerLevels = cleanEdgeCases(addContainmentInfo(nestedBlueprints.map(({ blueprint }) => blueprint)))
  return [firstLevelOuter, ...innerLevels]
}

function cleanEdgeCases(groupedBlueprints: Grouped[]): Grouped[][] {
  if (!groupedBlueprints.length) return []
  const outerBlueprints = groupedBlueprints.filter(({ isIn }) => isIn.length === 0)
  const nestedBlueprints = groupedBlueprints.filter(({ isIn }) => isIn.length > 1)
  if (outerBlueprints.length === 1 && nestedBlueprints.length === 0) {
    return [groupedBlueprints]
  } else if (outerBlueprints.length > 1) {
    return splitMultipleOuterBlueprints(outerBlueprints, groupedBlueprints)
  } else {
    return handleNestedBlueprints(nestedBlueprints, groupedBlueprints)
  }
}

/**
 * Groups blueprints so holes nest inside their outer boundaries.
 * The outer boundary of a CompoundBlueprint is blueprints[0]; holes follow.
 * Does not handle profiles that cross each other (same contract as brepjs).
 * @param blueprints - the profiles to classify into outer boundaries and holes.
 * @returns the organised Blueprints, grouping nested holes into CompoundBlueprint profiles.
 */
export function organiseBlueprints(blueprints: Blueprint[]): Blueprints {
  const basicGrouping = groupByBoundingBoxOverlap(blueprints).map(addContainmentInfo)
  return new Blueprints(
    basicGrouping.flatMap(cleanEdgeCases).map((compounds) => {
      if (compounds.length === 1) return compounds[0]!.blueprint
      compounds.sort((a, b) => a.isIn.length - b.isIn.length)
      return new CompoundBlueprint(compounds.map(({ blueprint }) => blueprint))
    }),
  )
}

// re-export container types for convenience
export type { Blueprint, CompoundBlueprint, Blueprints }