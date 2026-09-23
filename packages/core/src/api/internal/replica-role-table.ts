/**
 * replica-role-table — generalized replica[k] role-table builder (Phase 3 L3).
 *
 * Shared by the handwritten replicate ops (circularPattern / gridPattern /
 * rectangularPattern / mirrorJoin). Every replica is a rigid transform T_k of
 * the input; result faces = ∪ T_k(input faces). For each result face, its
 * centroid is mapped back through T_k⁻¹ into input coordinates and matched to
 * the nearest input-face centroid, recovering the input role, prefixed with
 * the replica label: `replica[k]/<inner>`.
 *
 * Same mechanism as pattern.ts linearPattern (centroid clustering), generalized
 * from a projection along one direction to arbitrary per-replica inverses.
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { RoleTable } from '../../topology/naming/types'
import { brepOf, inputRoleTable } from '../../shape'
import { getFaceHashes } from '../../brep/face-evolution'

/** One replica: role-table label prefix + inverse of its placement transform. */
export interface ReplicaTransform {
  /** Label prefix, e.g. 'replica[2]' / 'replica[1_0]'. */
  label: string
  /** Map a result-face centroid back into the input coordinate frame (T_k⁻¹). */
  inverse: (c: BrepVec3) => BrepVec3
}

/**
 * Build the `replica[*]/<inner>` role table for a fused multi-replica result.
 *
 * @param kernel - the BREP engine api.
 * @param input - the source Shape (its role table provides inner roles).
 * @param resultSolid - the fused result handle.
 * @param replicas - per-replica label + inverse transform.
 * @param outStmt - the output statement id (role-table key).
 * @returns the role table keyed by outStmt.
 */
export function buildReplicaRoleTable(
  kernel: BrepEngineApi,
  input: Shape,
  resultSolid: BrepHandle,
  replicas: ReplicaTransform[],
  outStmt: string,
): RoleTable {
  const inputSolid = brepOf(input) as BrepHandle
  const inputTable = inputRoleTable(input) as RoleTable | undefined

  // input face hash → role (for inner-role recovery)
  const inputHashes = getFaceHashes(kernel, inputSolid)
  const inputHashToRole = new Map<number, string>()
  if (inputTable) {
    for (const roles of inputTable.values()) {
      for (const [role, hashes] of roles) for (const h of hashes) inputHashToRole.set(h, role)
    }
  }
  const inputFaces = kernel.getSubShapes(inputSolid, 'face')
  const inputCentroids = inputFaces.map((f) => kernel.getSurfaceCenterOfMass(f))

  const resultHashes = getFaceHashes(kernel, resultSolid)
  const resultFaces = kernel.getSubShapes(resultSolid, 'face')
  const resultCentroids = resultFaces.map((f) => kernel.getSurfaceCenterOfMass(f))

  const roleTable = new Map<string, Map<string, number[]>>()
  const inner = new Map<string, number[]>()
  for (let i = 0; i < resultHashes.length; i++) {
    const c = resultCentroids[i]!
    // Try every replica inverse; the one mapping closest to an input face
    // centroid wins (identifies both the replica k and the inner role).
    let bestLabel = replicas[0]!.label
    let bestRole: string | undefined
    let bestDist = Infinity
    for (const r of replicas) {
      const p = r.inverse(c)
      for (let j = 0; j < inputCentroids.length; j++) {
        const ic = inputCentroids[j]!
        const d = (p.x - ic.x) ** 2 + (p.y - ic.y) ** 2 + (p.z - ic.z) ** 2
        if (d < bestDist) {
          bestDist = d
          bestLabel = r.label
          bestRole = inputHashToRole.get(inputHashes[j]!)
        }
      }
    }
    const role = `${bestLabel}/${bestRole ?? 'face'}`
    if (!inner.has(role)) inner.set(role, [])
    inner.get(role)!.push(resultHashes[i]!)
  }
  roleTable.set(outStmt as never, inner)
  return roleTable as unknown as RoleTable
}
