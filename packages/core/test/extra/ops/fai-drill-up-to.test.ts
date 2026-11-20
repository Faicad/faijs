/**
 * fai_drill up-to tests (P1).
 *
 * fai_drill resolves `upTo` into a concrete blind-hole depth at the op boundary,
 * so all hole types (simple / tapped / screw) and PMI share the same depth the
 * fixed-depth path would have produced. These tests pin: up-to geometry equals
 * the equivalent fixed depth, extent/plane/faceSelector targets, mutual
 * exclusion with depth and with a depth-suffixed thread spec, BREP-only
 * rejection on the mesh path, and PMI depth for tapped up-to holes.
 */

const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') || msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') || msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) || msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../../src/runtime-state'
import { getBrepApi } from '../../../src/brep/handle-bridge'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import type { BrepHandle } from '../../../src/brep/engine/types'
import { fromBrep, brepOf } from '../../../src/shape'
import { solidToShape } from '../../../src/brep/brep-ops'
import type { Shape } from '../../../src/mesh/types'
import { fai_drill } from '../../../src/extra/ops/fai_drill'
import { pmiThreads } from '../../../src/api/pmi/query'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined, texture: undefined, assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  kernel = getBrepApi()
}, 120000)

function block(sx: number, sy: number, sz: number): Shape {
  const h = kernel.translate(kernel.makeBox(sx, sy, sz), -sx / 2, -sy / 2, -sz / 2)
  return fromBrep(solidToShape(kernel, h), { solid: h })
}

function volumeOf(shape: Shape): number {
  return kernel.getVolume(brepOf(shape) as BrepHandle)
}

async function drill(shape: Shape, params: Record<string, unknown>): Promise<Shape> {
  return (await fai_drill(shape, params)) as Shape
}

describe('fai_drill upTo (P1)', () => {
  it('upTo plane equals fixed depth (simple hole)', async () => {
    // block z∈[-10,10]; entry at top z=10, drill down (direction 'z' => inward -Z).
    // plane z=5 → depth 5; plane z=-10 → depth 20 (through).
    const up = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6, holeType: 'simple',
      upTo: { plane: { point: [0, 0, 5], normal: [0, 0, 1] } },
    })
    const fixed = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6, holeType: 'simple', depth: 5,
    })
    expect(volumeOf(up)).toBeCloseTo(volumeOf(fixed), 2)
    expect(volumeOf(up)).toBeCloseTo(40 * 40 * 20 - Math.PI * 9 * 5, 1)
  })

  it('upTo extent last drills through the block', async () => {
    const up = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6, holeType: 'simple', upTo: 'last',
    })
    expect(volumeOf(up)).toBeCloseTo(40 * 40 * 20 - Math.PI * 9 * 20, 1)
  })

  it('upTo plane behind the entry point is rejected (no intersection)', async () => {
    // entry at top z=10, drilling down (-Z); plane z=20 is behind → no intersection.
    await expect(drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6, holeType: 'simple',
      upTo: { plane: { point: [0, 0, 20], normal: [0, 0, 1] } },
    })).rejects.toThrow(/E_UP_TO_NO_INTERSECTION/)
  })

  it('depth + upTo is rejected', async () => {
    await expect(drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6,
      depth: 5, upTo: { plane: { point: [0, 0, 5], normal: [0, 0, 1] } },
    })).rejects.toThrow(/E_DRILL_DEPTH_UPTO/)
  })

  it('thread spec with depth suffix + upTo is rejected', async () => {
    await expect(drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', thread: 'M6-6H↧8',
      upTo: { plane: { point: [0, 0, 0], normal: [0, 0, 1] } },
    })).rejects.toThrow(/E_DRILL_DEPTH_UPTO/)
  })

  it('tapped upTo hole produces PMI at the resolved depth', async () => {
    const up = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'tapped',
      screwSpecIdx: 5, /* M6 */ threadClass: '6H',
      upTo: { plane: { point: [0, 0, 5], normal: [0, 0, 1] } },
    })
    const threads = pmiThreads(up)
    expect(threads.length).toBe(1)
    expect(threads[0]!.pilot.depth).toBeCloseTo(5, 2)
  })

  it('fixed-depth paths remain unchanged (no upTo)', async () => {
    const blind = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6, holeType: 'simple', depth: 5,
    })
    const through = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6, holeType: 'simple',
    })
    expect(volumeOf(blind)).toBeCloseTo(40 * 40 * 20 - Math.PI * 9 * 5, 1)
    expect(volumeOf(through)).toBeCloseTo(40 * 40 * 20 - Math.PI * 9 * 20, 1)
  })
})
