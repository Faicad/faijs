/**
 * B4 — mock library fixture: mesh version (B4), defineOp mesh-only form.
 *
 * Design: docs/plans/2026-08-29-faijs-module-runtime-plan.md §7.3 B4 / §4.4
 *         docs/plans/2026-08-30-defineop-library-contract.md §6.3
 *
 * Simulates a third-party library module (the target of
 * `import * as mech from 'gear-lib-demo'`):
 * - carries `contractVersion` (= CONTRACT_VERSION, registerLib check passes);
 * - declares its implementation set via `defineOp({ mesh })` — the mesh-only
 *   legal form (D1: mesh mandatory; no brep slot, hasBrep === false).
 *
 * Difference from a real library: a real one ships as a pre-bundled / CDN
 * external (B2/B3); here it is registered in source form to validate the
 * full registerLib → ns.<binding>.<callee> pipeline.
 */

import { defineOp, CONTRACT_VERSION } from '@faicad/faijs-core/sdk'

/** Adapter contract version, checked against CONTRACT_VERSION by registerLib. */
export const contractVersion = CONTRACT_VERSION

/** 12-vertex cube mesh (raw MeshData; the wrapper calls solid() on it). */
function cubeMesh(size: number): { positions: Float32Array; indices: Uint32Array } {
  const s = size / 2
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ])
  return { positions, indices }
}

/** Subdivided sphere mesh (raw MeshData). */
function sphereMesh(radius: number): { positions: Float32Array; indices: Uint32Array } {
  const r = radius
  const positions: number[] = []
  const indices: number[] = []
  const segments = 12
  for (let i = 0; i <= segments; i++) {
    const phi = (Math.PI * i) / segments
    for (let j = 0; j <= segments; j++) {
      const theta = (2 * Math.PI * j) / segments
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      )
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j
      const b = a + segments + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/**
 * Build a cube as a mesh-only faijs SolidShape (no BREP slot).
 * @param params - configuration for the cube; `size` is the edge length.
 * @returns the cube as a mesh-based faijs SolidShape.
 */
export const makeHeadstock = defineOp({
  mesh: (params: { size: number }) => cubeMesh(params.size),
})

/**
 * Build a sphere as a mesh-only faijs SolidShape, approximated by subdivision.
 * @param params - configuration for the sphere; `radius` is the sphere radius.
 * @returns the sphere as a mesh-based faijs SolidShape.
 */
export const makeBall = defineOp({
  mesh: (params: { radius: number }) => sphereMesh(params.radius),
})
