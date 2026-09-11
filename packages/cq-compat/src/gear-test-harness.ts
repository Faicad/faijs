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

export function kernel(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

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

export type BBox = {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  zmin: number
  zmax: number
}

export function bbox(shape: Shape): BBox {
  return kernel().getBoundingBox(brepOf(shape) as unknown as ShapeHandle) as BBox
}
