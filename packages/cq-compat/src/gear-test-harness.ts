/**
 * Shared harness for the E1–E4 gear-extension ops.
 *
 * These ops call the occt-wasm kernel directly via `getKernel()` (the native
 * singleton that `registerOcctBrepEngine()` initializes) and wrap results with
 * `fromHandle`. `fromHandle` needs `getBackends().kernel.brep` to be a MESHABLE
 * kernel — the raw occt-wasm `OcctKernel` exposes `meshShape`, so we wire it
 * straight into `configureBackends`. This is intentionally the SAME native
 * instance the ops use, so handles stay consistent (no second kernel, no
 * `createRuntime`, which only lazily builds its brep chain inside `execute`).
 *
 * This file is NOT a test (no `*.test.ts`); it is imported by the E1–E4 specs.
 */

import { registerOcctBrepEngine, configureBackends, CONTRACT_VERSION } from '@faicad/faijs-core'
import { getKernel } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { brepOf } from '@faicad/faijs-core/shape'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type { Workplane } from './workplane'

/**
 * Initialise the native occt-wasm kernel for the E1–E4 specs.
 *
 * Calls `registerOcctBrepEngine()` (which boots the kernel singleton and
 * registers the OCCT engine) and then wires that SAME instance into the
 * backend registry via `configureBackends`, so `fromHandle` can resolve a
 * meshable kernel. Must be awaited in `beforeAll` before any op is invoked.
 *
 * @returns a promise that resolves once the kernel and backends are ready
 */
export async function setupNativeKernel(): Promise<void> {
  await registerOcctBrepEngine()
  const k = getKernel() as unknown as OcctKernel
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep', brepEngineId: 'occt' },
    kernel: { brep: k, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
  })
}

/**
 * Return the shared native occt-wasm kernel singleton.
 *
 * The same instance the E1–E4 ops obtain internally via `getKernel()`, so
 * fixtures built here and op outputs share one handle space.
 *
 * @returns the live `OcctKernel` instance (valid after {@link setupNativeKernel})
 */
export function kernel(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/**
 * Build a minimal valid root `Workplane` without touching the `cad.*` backend.
 *
 * Defaults to the XY plane at the origin (normal +Z, xDir +X, yDir +Y) with no
 * shape and no pending wires; pass `over` to override any field (e.g.
 * `{ shape }` or `{ normal, origin }`).
 *
 * @param over - partial overrides merged onto the default workplane
 * @returns a `Workplane` literal suitable as the first argument of an op
 */
export function mkWP(over: Partial<Workplane> = {}): Workplane {
  return {
    __cq: true,
    plane: 'XY',
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    xDir: [1, 0, 0],
    yDir: [0, 1, 0],
    shape: null,
    faceSel: null,
    edgeSel: null,
    vertexSel: null,
    pts: [],
    forConstruction: false,
    ...over,
  }
}

/**
 * Axis-aligned bounding box of a shape, in the kernel's field naming.
 *
 * Mirrors the `BoundingBox` record returned by the native
 * `getBoundingBox` call (all six min/max fields, no `minX`-style aliases).
 */
export type BBox = {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  zmin: number
  zmax: number
}

/**
 * Compute the axis-aligned bounding box of a shape through the native kernel.
 *
 * @param shape - a faijs `Shape` carrying a BREP handle (see `brepOf`)
 * @returns the six-field bounding box
 */
export function bbox(shape: Shape): BBox {
  return kernel().getBoundingBox(brepOf(shape) as unknown as ShapeHandle) as BBox
}

/**
 * Surface area of a face (or total area of a shell/solid), via the native
 * kernel's `getSurfaceArea`.
 *
 * @param shape - a faijs `Shape` carrying a BREP handle (see `brepOf`)
 * @returns the area in model units squared
 */
export function area(shape: Shape): number {
  return kernel().getSurfaceArea(brepOf(shape) as unknown as ShapeHandle)
}
