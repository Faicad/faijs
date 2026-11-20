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
import { formatThreadHole } from '../../../src/api/pmi/text'
import { faceRef } from '../../../src/api/face-ref'
import type { FaceTopoRef } from '../../../src/topology/naming/types'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { solid } from '../../../src/shape'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'
import { dualOpMetaOf } from '../../../src/define-op'

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

/** A box made by a real op, so `faceRef` has a naming context to resolve against. */
async function namedBlock(): Promise<Shape> {
  const ports = { events: { emit: () => {} } } as HostPorts
  const rt = new CadRuntime(ports, 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await rt.execute('let base = cad.box(40, 40, 20)')
  if (result.failedAt) throw new Error(result.failedAt.message)
  return [...result.outputs.values()][0] as Shape
}

function capRefOf(shape: Shape, normalSign: number): FaceTopoRef {
  for (let i = 1; i <= 6; i++) {
    const ref = faceRef(shape, i)
    if ((ref.hint.normal?.[2] ?? 0) * normalSign > 0.9) return ref
  }
  throw new Error(`no ${normalSign > 0 ? '+Z' : '-Z'} cap on the block`)
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

  it('upTo PMI is annotated as 到面 instead of a numeric depth', async () => {
    const up = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', holeType: 'tapped',
      screwSpecIdx: 5, threadClass: '6H',
      upTo: { plane: { point: [0, 0, 5], normal: [0, 0, 1] } },
    })
    const item = pmiThreads(up)[0]!
    expect(item.termination).toBe('face')
    expect(item.label).toContain('到面')
    expect(item.label).not.toContain('↓5')
    expect(formatThreadHole(item)).toBe(item.label)
    // the resolved depth remains available as data even though the label does not print it
    expect(item.pilot.depth).toBeCloseTo(5, 2)
  })

  it('face is the entry face and upTo is the stop face (independent)', async () => {
    const base = await namedBlock()
    const bb = kernel.getBoundingBox(brepOf(base) as BrepHandle)
    const zMin = bb.zmin
    const zMax = bb.zmax
    const midZ = (zMin + zMax) / 2
    const common = {
      diameter: 6, holeType: 'tapped', screwSpecIdx: 5, threadClass: '6H',
      upTo: { plane: { point: [0, 0, midZ], normal: [0, 0, 1] } },
    }
    const fromBottom = await drill(base, {
      ...common, face: capRefOf(base, -1), position: [0, 0, zMin], direction: 'normal',
    })
    const fromTop = await drill(base, {
      ...common, face: capRefOf(base, 1), position: [0, 0, zMax], direction: 'normal',
    })
    const bottomPmi = pmiThreads(fromBottom)[0]!
    const topPmi = pmiThreads(fromTop)[0]!
    // same stop plane and same resolved depth, opposite entry faces / drill axes
    expect(bottomPmi.axis.origin).toEqual([0, 0, zMin])
    expect(topPmi.axis.origin).toEqual([0, 0, zMax])
    expect(bottomPmi.axis.direction[2]).toBeCloseTo(1, 3)
    expect(topPmi.axis.direction[2]).toBeCloseTo(-1, 3)
    expect(bottomPmi.pilot.depth).toBeCloseTo(10, 2)
    expect(topPmi.pilot.depth).toBeCloseTo(10, 2)
    expect(volumeOf(fromBottom)).toBeCloseTo(volumeOf(fromTop), 2)
    expect(volumeOf(fromBottom)).toBeLessThan(volumeOf(base))
  })

  it('offset shifts the resolved upTo depth', async () => {
    const up = await drill(block(40, 40, 20), {
      position: [0, 0, 10], direction: 'z', diameter: 6, holeType: 'simple',
      upTo: { plane: { point: [0, 0, 5], normal: [0, 0, 1] } }, offset: 2,
    })
    // entry z=10, plane z=5 shifted +2 along +Z → stop z=7 → depth 3
    expect(volumeOf(up)).toBeCloseTo(40 * 40 * 20 - Math.PI * 9 * 3, 1)
  })

  it('upTo on the frozen mesh chain is rejected explicitly', async () => {
    const meshShape = solid({ positions: new Float32Array(9), indices: new Uint32Array(3) })
    const meshImpl = dualOpMetaOf(fai_drill)!.mesh as (
      input: Shape, params: Record<string, unknown>,
    ) => Promise<Shape>
    await expect(meshImpl(meshShape, {
      position: [0, 0, 0], direction: 'z', diameter: 6, upTo: 'last',
    })).rejects.toThrow(/E_MESH_UNSUPPORTED/)
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
