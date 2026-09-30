/**
 * stl-unit — STL unit guessing (moved up from 3d_editor per plan §8 decision 5).
 *
 * STL carries no unit metadata, so the host seeds `cad.load`'s `unit` from a
 * bounding-box volume heuristic. The heuristic itself now lives here (single
 * source of truth in faijs); the host keeps the "visible + correctable + locked
 * by regression test" constraints, but does not re-implement the guess.
 *
 * The thresholds mirror the historical 3d_editor behaviour:
 *   volume < 0.008   m³   → 'm'    (cube root ≈ 0.2 → likely meters)
 *   volume < 8.0    mm³   → 'inch' (cube root ≈ 2.0 → likely inches)
 *   otherwise              → 'mm'
 *
 * Input is a world-space axis-aligned bounding box. Returns a faijs `UnitName`.
 */
import type { BoundingBox } from './types'
import type { UnitName } from '../units'

/** Guess the STL source unit from a bounding box volume.
 *
 * @param bbox - the world-space axis-aligned bounding box of the mesh.
 * @returns the guessed faijs `UnitName` ('m' | 'inch' | 'mm').
 */
export function guessStlUnit(bbox: BoundingBox): UnitName {
  const w = bbox.max[0] - bbox.min[0]
  const h = bbox.max[1] - bbox.min[1]
  const d = bbox.max[2] - bbox.min[2]
  const volume = w * h * d

  if (volume > 0 && volume < 0.008) return 'm'   // cube root ≈ 0.2 → meters
  if (volume > 0 && volume < 8.0)  return 'inch' // cube root ≈ 2.0 → inches
  return 'mm'
}