/**
 * Probe (durable evidence): the **raw** occt-wasm kernel's `getLength` across
 * shape kinds.
 *
 * Conclusion (fix landed 2026-10-02): the raw kernel's `getLength` goes straight
 * to `BRepGProp::LinearProperties` with the default `SkipShared=false`, which
 * walks by face and counts a shared edge once per adjacent face — a unit box
 * yields 24, not 12. That is the native OCC default (real OCC and
 * opencascade.js agree), not an occt-wasm bug. faijs adopts "sum of unique-edge
 * arc lengths" as the L1 `getLength` meaning and normalizes in **two** places:
 * the two core adapters (`occt-primitives.ts` / `brepkitKernel.ts`) and this
 * package's `lengthOf` — which talks to the raw kernel directly (see
 * `shape-class.ts` importing `occt-kernel/occtKernel`), bypassing the L1
 * adapter, so it must normalize on its own. Post-normalization regression for
 * both engines lives in
 * `packages/core/src/brep/engine/getlength-domain.probe.test.ts`.
 *
 * Kept as repeatable evidence of the **raw kernel** behaviour (24/280), which is
 * also the reason `lengthOf` cannot rely on the adapter: it shows the L1
 * adapter's normalization does not (and must not) change the raw kernel.
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { ShapeHandle } from 'occt-wasm'
import { setupNativeKernel } from './gear-test-harness'

beforeAll(async () => {
  await setupNativeKernel()
})

interface ProbeKernel {
  makeBox: (x: number, y: number, z: number) => ShapeHandle
  makeCylinder: (r: number, h: number) => ShapeHandle
  translate: (h: ShapeHandle, dx: number, dy: number, dz: number) => ShapeHandle
  makeLineEdge: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ShapeHandle
  makeWire: (edges: ShapeHandle[]) => ShapeHandle
  makeFace: (wire: ShapeHandle) => ShapeHandle
  makeCompound: (shapes: ShapeHandle[]) => ShapeHandle
  getSubShapes: (h: ShapeHandle, t: 'edge' | 'face' | 'vertex' | 'wire' | 'solid') => ShapeHandle[]
  curveLength: (h: ShapeHandle) => number
  getLength: (h: ShapeHandle) => number
  getShapeType: (h: ShapeHandle) => string
}

function k(): ProbeKernel {
  return getKernel() as unknown as ProbeKernel
}

/** Sum of unique sub-edge lengths via getSubShapes('edge') + curveLength. */
function uniqueEdgeSum(kk: ProbeKernel, h: ShapeHandle): number {
  return kk.getSubShapes(h, 'edge').reduce((acc, e) => acc + kk.curveLength(e), 0)
}

describe('probe: length dedup across shape kinds', () => {
  it('raw counts / lengths table', () => {
    const kk = k()
    const rows: Record<string, unknown>[] = []

    const record = (label: string, h: ShapeHandle): void => {
      const edges = kk.getSubShapes(h, 'edge')
      rows.push({
        label,
        shapeType: kk.getShapeType(h),
        edges: edges.length,
        uniqueEdgeSum: uniqueEdgeSum(kk, h),
        nativeGetLength: kk.getLength(h),
      })
    }

    // 1. unit box: geometric unique-edge sum = 12 (12 edges × 1)
    const box = kk.makeBox(1, 1, 1)
    record('solid:unitBox', box)

    // 1b. cylinder r=1 h=1: unique sum 2·2π + 1(seam) ≈ 13.56637;
    // real OCC default (per-face) = 27.1327412287…
    record('solid:cylinder_r1h1', kk.makeCylinder(1, 1))

    // 2. standalone edge (from the box) — does getSubShapes(edge,'edge') = [edge]?
    const edge = kk.getSubShapes(box, 'edge')[0]
    record('edge:fromBox', edge)

    // 3. 40×30 rectangle wire (perimeter 140)
    const e1 = kk.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 })
    const e2 = kk.makeLineEdge({ x: 40, y: 0, z: 0 }, { x: 40, y: 30, z: 0 })
    const e3 = kk.makeLineEdge({ x: 40, y: 30, z: 0 }, { x: 0, y: 30, z: 0 })
    const e4 = kk.makeLineEdge({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0 })
    const wire = kk.makeWire([e1, e2, e3, e4])
    record('wire:40x30', wire)

    // 4. face from that wire (boundary perimeter 140)
    const face = kk.makeFace(wire)
    record('face:40x30', face)

    // 5. compound of two disjoint unit boxes → unique-edge sum 24
    const box2 = kk.translate(kk.makeBox(1, 1, 1), 5, 0, 0)
    const comp = kk.makeCompound([box, box2])
    record('compound:2boxes', comp)

    // eslint-disable-next-line no-console
    console.log('\n' + JSON.stringify(rows, null, 2) + '\n')

    expect(rows.length).toBe(6)
  })
})
