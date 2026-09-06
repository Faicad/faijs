/**
 * B4 — mock library fixture: BREP version (B4), defineOp mesh-first rewrite.
 *
 *
 * Simulates a third-party library module (the target of
 * `import * as mech from 'gear-lib-demo'`):
 * - carries `contractVersion` (= CONTRACT_VERSION, registerLib check passes);
 * - declares its implementation set via `defineOp` (D-face contract:
 *   mesh mandatory as the default path, BREP optional);
 * - **mesh-first**: mesh mode produces a mesh cube (hasBrep === false);
 *   auto/brep mode produces a BREP cube (registered via the wrapper's
 *   fromHandle path, hasBrep === true).
 *
 * Difference from a real library: a real one (e.g. an external adapter) injects
 * the kernel at module load and builds handles via `kernel.makeXxx`; here the
 * brep implementation consumes a handle already built by the kernel (tests
 * initialize the kernel via an auto-mode runtime first).
 */

import {
  defineOp,
  CONTRACT_VERSION,
  getBackends,
} from '@faicad/faijs-core/sdk'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'

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

/** Subdivided sphere mesh (raw MeshData), mirroring the mesh-version fixture. */
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
 * Build a box solid handle via the faijs OCCT kernel (the brep implementation's
 * core capability). Real libraries build handles themselves (e.g. brep
 * `makeExternalGear`); here we inline one to demo the SDK bridge from a
 * library function.
 * @param size - the cube edge length.
 * @returns the raw OCCT handle (registered by the wrapper's fromHandle path).
 */
function boxSolidHandle(size: number): BrepHandle {
  const kernel = getBackends().kernel.brep as
    | { makeBox(x: number, y: number, z: number): unknown }
    | null
    | undefined
  if (!kernel || typeof kernel.makeBox !== 'function') {
    throw new Error('[mock-mech-brep] OCCT kernel not available (run in auto/brep mode)')
  }
  return kernel.makeBox(size, size, size) as BrepHandle
}

/**
 * Build a cube as a faijs SolidShape (dual-path, mesh-first).
 * @param params - configuration for the cube; `size` is the edge length.
 * @returns the cube as a faijs SolidShape.
 */
export const makeHeadstock = defineOp({
  mesh: (params: { size: number }) => cubeMesh(params.size),
  brep: (params: { size: number }) => boxSolidHandle(params.size),
})

/**
 * Parameterless demo function; the caller is responsible for invoking it in
 * auto mode once the OCCT kernel is ready.
 * @returns a fixed-size cube as a faijs SolidShape.
 */
export const makeBox = defineOp({
  mesh: () => cubeMesh(10),
  brep: () => boxSolidHandle(10),
})

/**
 * Retained mesh-only function (proves a library can mix mesh and BREP products).
 * @param params - configuration for the sphere; `radius` is the sphere radius.
 * @returns the sphere as a mesh-only faijs SolidShape.
 */
export const makeBall = defineOp({
  mesh: (params: { radius: number }) => sphereMesh(params.radius),
})
