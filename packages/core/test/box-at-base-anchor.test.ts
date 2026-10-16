/**
 * box 的 `at` 锚点语义测试（BASE 语义回归 + 复现用例）
 *
 * 背景（2026-10-16 缺陷）：box 的 `at` 此前是 CENTER 语义（at = 长方体的中心），
 * 与 cylinder/cone 的 BASE 语义（at = 底面中心）不一致。而 box 默认形态
 * （无 at、无 centered）是「角点在原点、底面贴地」（z∈[0,h]），于是
 *
 *   let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)
 *   let part1 = cad.box(10 * MM, 20 * MM, 30 * MM, { at: [10, 0, 0] })
 *
 * 中 part1 会被 CENTER 语义解释为「中心落在 (10,0,0)」→ 底面沉到 z=-15，
 * 半埋在地下、位置错误。修复后 `at` 统一为 BASE 语义：at = 底面中心
 * （与 cylinder/cone 一致），`at + centered:true` 时以 at 为中心（不变）。
 *
 * 本文件同时断言：
 * - 默认 box 的等价 at 写法（BASE 语义下为 at:[w/2, d/2, 0]）；
 * - mesh 路径与 brep 路径产出的最终 mesh 包围盒一致。
 *
 * 运行：npx vitest run packages/core/test/box-at-base-anchor.test.ts
 */

// ── OCCT stdout 噪声过滤（与 brep-mesh-equivalence.test.ts 一致） ──
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../src/brep/engine/adapters/occt'
import { createNodePorts } from '../src/node-host'
import type { ExecutionMode } from '../src/cad-runtime/ports'
import type { Shape } from '../src/mesh/types'
import * as meshPrimitives from '../src/mesh/primitives'
import * as meshQuery from '../src/mesh/query'
import { createEditorRuntime } from './support/editor-ops'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

// ── 工具 ──

interface BBox {
  min: [number, number, number]
  max: [number, number, number]
}

function bboxOf(shape: Shape): BBox {
  const p = shape.positions
  const min = [p[0], p[1], p[2]] as [number, number, number]
  const max = [p[0], p[1], p[2]] as [number, number, number]
  for (let i = 3; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a]
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
  }
  return { min, max }
}

/** 在指定模式下执行脚本，取最后一个 mesh shape 的包围盒。 */
async function bboxOfScript(code: string, mode: ExecutionMode): Promise<BBox> {
  const runtime = createEditorRuntime(createNodePorts(), mode)
  try {
    const result = await runtime.execute(code)
    if (result.failedAt) {
      throw new Error(`Execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
    }
    const last = [...result.outputs.keys()][result.outputs.size - 1]
    const shape = result.outputs.get(last!)
    if (!shape || !('positions' in shape) || !('indices' in shape)) {
      throw new Error(`Output for "${last}" is not a mesh shape`)
    }
    return bboxOf(shape as Shape)
  } finally {
    runtime.dispose()
  }
}

function expectBBox(actual: BBox, min: [number, number, number], max: [number, number, number]): void {
  for (let a = 0; a < 3; a++) {
    expect(actual.min[a]).toBeCloseTo(min[a], 2)
    expect(actual.max[a]).toBeCloseTo(max[a], 2)
  }
}

/** 断言两个 bbox 逐分量近似相等（mesh/brep 一致性）。 */
function expectBBoxClose(a: BBox, b: BBox): void {
  for (let i = 0; i < 3; i++) {
    expect(a.min[i]).toBeCloseTo(b.min[i], 2)
    expect(a.max[i]).toBeCloseTo(b.max[i], 2)
  }
}

// ── mesh 路径（无 OCCT，快） ──

describe('box at 锚点语义 — mesh 路径', () => {
  it('默认 box(10,20,30)：角点在原点、底面贴地 [0,10]×[0,20]×[0,30]（回归守卫）', () => {
    const bb = bboxOf(meshPrimitives.box({ width: 10, depth: 20, height: 30 }))
    expectBBox(bb, [0, 0, 0], [10, 20, 30])
  })

  it('复现缺陷：box(10,20,30,{at:[10,0,0]}) 修复后底面中心落在 (10,0,0) → [5,15]×[-10,10]×[0,30]', () => {
    // 修复前（CENTER 语义）：中心在 (10,0,0) → [5,15]×[-10,10]×[-15,15]，底面沉到 -15。
    const bb = bboxOf(meshPrimitives.box({ width: 10, depth: 20, height: 30, at: [10, 0, 0] }))
    expectBBox(bb, [5, -10, 0], [15, 10, 30])
  })

  it('默认 box 的等价 at 写法 = at:[w/2, d/2, 0]（底面中心）', () => {
    const a = bboxOf(meshPrimitives.box({ width: 10, depth: 20, height: 30 }))
    const b = bboxOf(meshPrimitives.box({ width: 10, depth: 20, height: 30, at: [5, 10, 0] }))
    expectBBoxClose(a, b)
  })

  it('box(10,20,30,{centered:true})：居中到原点（回归守卫，不变）', () => {
    const bb = bboxOf(meshPrimitives.box({ width: 10, depth: 20, height: 30, centered: true }))
    expectBBox(bb, [-5, -10, -15], [5, 10, 15])
  })

  it('box(10,20,30,{at:[10,0,0],centered:true})：at+centered 以 at 为中心（回归守卫，不变）', () => {
    const bb = bboxOf(meshPrimitives.box({ width: 10, depth: 20, height: 30, at: [10, 0, 0], centered: true }))
    expectBBox(bb, [5, -10, -15], [15, 10, 15])
  })
})

// ── 用户原始场景（双模式执行 + mesh/brep 一致性） ──

const USER_SCENARIO = [
  'let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)',
  'let part1 = cad.box(10 * MM, 20 * MM, 30 * MM, { at: [10 * MM, 0, 0] })',
].join('\n')

describe('box at 锚点语义 — 脚本执行（mesh 与 brep 双模式）', () => {
  const cases: Array<{ name: string; code: string; min: [number, number, number]; max: [number, number, number] }> = [
    {
      name: 'box(10,20,30) 默认：角点原点、底面贴地',
      code: 'const p = cad.box(10, 20, 30)',
      min: [0, 0, 0],
      max: [10, 20, 30],
    },
    {
      name: 'box(10,20,30,{at:[10,0,0]})：底面中心在 (10,0,0)，贴地',
      code: 'const p = cad.box(10, 20, 30, { at: [10, 0, 0] })',
      min: [5, -10, 0],
      max: [15, 10, 30],
    },
    {
      name: 'box(10,20,30,{at:[5,10,0]})：等价于默认形态',
      code: 'const p = cad.box(10, 20, 30, { at: [5, 10, 0] })',
      min: [0, 0, 0],
      max: [10, 20, 30],
    },
    {
      name: 'box(10,20,30,{centered:true})：居中到原点',
      code: 'const p = cad.box(10, 20, 30, { centered: true })',
      min: [-5, -10, -15],
      max: [5, 10, 15],
    },
    {
      name: 'box(10,20,30,{at:[10,0,0],centered:true})：at+centered 以 at 为中心',
      code: 'const p = cad.box(10, 20, 30, { at: [10, 0, 0], centered: true })',
      min: [5, -10, -15],
      max: [15, 10, 15],
    },
  ]

  for (const mode of ['mesh', 'brep'] as ExecutionMode[]) {
    describe(`mode=${mode}`, () => {
      for (const c of cases) {
        it(c.name, async () => {
          const bb = await bboxOfScript(c.code, mode)
          expectBBox(bb, c.min, c.max)
        })
      }

    })

  }

  it('mesh 与 brep 双模式产出的最终 mesh 包围盒一致（用户原始场景）', async () => {
    // 单语句逐条跑（runtime 为进程级单例，必须串行）：语句 i 的 bbox 即对应 part 的 bbox
    const bbs: Record<ExecutionMode, BBox[]> = { mesh: [], brep: [] }
    for (const mode of ['mesh', 'brep'] as ExecutionMode[]) {
      for (const line of USER_SCENARIO.split('\n')) {
        bbs[mode].push(await bboxOfScript(line, mode))
      }
    }
    for (let i = 0; i < 2; i++) {
      expectBBoxClose(bbs.mesh[i]!, bbs.brep[i]!)
    }
  })
})
