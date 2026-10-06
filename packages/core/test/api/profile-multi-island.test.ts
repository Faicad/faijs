/**
 * @vitest-environment node
 *
 * profile 多岛语义回归（H15，2026-09-26，Beds part16/39）
 *
 * GOTCHA：`cad.profile` 的环语义是「嵌套 = 孔，不相交 = 独立岛」（与 FreeCAD 草图
 * 一致），**不是**「面积最大者当外环、其余全当孔」。旧实现把双岛轮廓的第二个岛
 * 判成「洞外面」→ addHolesInFace 收到与外环不相交的 wire → 构面退化（volume 0）。
 * 多岛产物 = compound（每岛一面、各带自己的孔）。
 *
 * 全部用例走 runtime.execute（内核在 registerOcctBrepEngine 后才可用）。
 *
 * Run: npx vitest run src/api/profile-multi-island.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { ProfileLoop } from '../../src/api/profile'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { asPartName } from '../../src/identity'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), 'brep' as ExecutionMode, {
    cad: createApiNamespaceWithEditorOps(),
  }).execute(code)
}

/** 轴对齐正方形环（size 为边长）。 */
function sq(x: number, y: number, s: number): ProfileLoop {
  return {
    segments: [
      { kind: 'line', x1: x, y1: y, x2: x + s, y2: y },
      { kind: 'line', x1: x + s, y1: y, x2: x + s, y2: y + s },
      { kind: 'line', x1: x + s, y1: y + s, x2: x, y2: y + s },
      { kind: 'line', x1: x, y1: y + s, x2: x, y2: y },
    ],
  }
}

/** 失败即抛的执行 helper。 */
async function run(parts: ProfileLoop[], extrude: [number, number, number] | null, as?: 'wire') {
  const code = `
    const part0 = cad.profile({ contours: ${JSON.stringify(parts)}${as ? `, as: '${as}'` : ''} })
    ${extrude ? `const part1 = cad.extrude(part0, [${extrude.join(', ')}])` : ''}
  `
  const result = await exec(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  return result
}

function handleOf(result: ExecutionResult, part: string): never {
  const s = result.outputs.get(asPartName(part)) as Shape | undefined
  if (!s) throw new Error(`no output for ${part}`)
  return brepOf(s) as never
}

function solidsOf(handle: never): never[] {
  return getBrepApi().getSubShapes(handle, 'solid' as never) as never[]
}

function facesOf(handle: never): never[] {
  return getBrepApi().getSubShapes(handle, 'face' as never) as never[]
}

describe('cad.profile multi-island semantics (H15)', () => {
  it('single island, no holes: unchanged — 1 face, extrude → 1 solid', async () => {
    const result = await run([sq(0, 0, 20)], [0, 0, 5])
    const profileFaces = facesOf(handleOf(result, 'part0'))
    expect(profileFaces).toHaveLength(1)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeCloseTo(20 * 20 * 5, 0)
  })

  it('loop + nested loop = washer with hole (regression of the OLD semantics)', async () => {
    const result = await run([sq(0, 0, 20), sq(5, 5, 10)], [0, 0, 5])
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeCloseTo((400 - 100) * 5, 0)
  })

  it('two disjoint islands → 2 faces; extrude → 2 positive-volume solids (Beds part16/39 case)', async () => {
    const result = await run([sq(-50, 0, 10), sq(50, 0, 10)], [0, 0, 5])
    expect(facesOf(handleOf(result, 'part0'))).toHaveLength(2)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(2)
    const total = solids.reduce((acc, s) => acc + getBrepApi().getVolume(s), 0)
    expect(total).toBeCloseTo(2 * (10 * 10 * 5), 0)
  })

  it('island-in-island-in-island: odd depth = hole, even depth = island again', async () => {
    const result = await run([sq(0, 0, 30), sq(5, 5, 20), sq(10, 10, 10)], [0, 0, 5])
    expect(facesOf(handleOf(result, 'part0'))).toHaveLength(2) // 外环(带孔) + 内岛
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(2)
    const total = solids.reduce((acc, s) => acc + getBrepApi().getVolume(s), 0)
    // (900-400)*5 外环带孔 + 100*5 内岛
    expect(total).toBeCloseTo((900 - 400) * 5 + 100 * 5, 0)
  })

  it("as:'wire' over a multi-island input picks the LARGEST island's outer loop", async () => {
    const result = await run([sq(0, 0, 10), sq(20, 0, 40)], null, 'wire')
    const s = result.outputs.get(asPartName('part0')) as Shape
    // 1D 曲线形态（getBoundingBox 对 curve 不可用 → 用 getLength 判定取到了哪个岛）
    expect((s as { kind?: string }).kind).toBe('curve')
    // 大岛周长 160；若误取小岛则是 40
    expect(getBrepApi().getLength(handleOf(result, 'part0'))).toBeCloseTo(160, 3)
  })
})
