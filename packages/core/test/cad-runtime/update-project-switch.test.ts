/**
 * 切工程（整份 sceneCode 被替换）时的增量执行等价性 —— 2026-10-19 端侧回归。
 *
 * ── 为什么单开一份 ────────────────────────────────────────────────────────────
 * `update-incremental.test.ts` 钉的是"改一行"的语义（前缀确实跳过、失败降级、
 * 闸门退化……）。它**没有**覆盖"新旧代码是两个不同工程"这种形态，而端侧小程序
 * 的工程切换正好走这条路：worker 的 runtime 常驻，页面把「上一个工程的 sceneCode」
 * 当 oldCode 发 update。这里钉住"增量结果必须与全量执行逐值一致"，并单独钉住两个
 * 真实缺陷（都是这条路径上暴露的）：
 *
 *   ① 旧工程的 ctx 变量残留：重放只跑 `[startLine, ∞)`，没有任何一步删除"旧代码
 *      写过、新代码不再写"的 ctx 键 → `collectDirectResult` 扫 `listCtxKeys()` 时
 *      把它们当 outputs/terminals 带出去。宿主侧表现 = **切换工程后旧工程的模型
 *      还在画面上**；这些没有 producer 行的变量还会污染 live-shapes 的消费关系，
 *      严重时新工程的终端被判成"已被消费" → 一个终端都不剩（**空画面**）。
 *      修法：runtime 按「上一轮写键 − 新代码写键」收敛 ctx（releasePartCaches +
 *      deleteCtxVars），判据用写键集合而不是 ctx 键全集（params / import seed 是
 *      宿主预置、不属于任何 code 的 writes）。
 *
 *   ② 前缀污染：旧代码在 startLine 之后**改写过前缀变量**（裸调用原地写回
 *      `cad.translate(p, …)`，或显式 `p = cad.translate(p, …)`）。前缀之所以能跳过，
 *      前提是它在新代码下的值等于旧前缀跑出来的值；被旧后缀改写之后这个前提没了 →
 *      重放会得到"平移两次 / 平移了但新代码不该平移"的几何。
 *      修法：把 startLine 回退到被污染键的 producer 行（那里重算干净值），而不是
 *      一律全量 —— 回退量 = 改动点到 producer 的距离，增量收益仍在。
 *
 * 两个后端各跑一遍：小程序端固定 `execBackend:'interpreter'`（见 3d_editor 的
 * platform/src/weapp/faijs.worker.ts），同一条语义不能在 vm 下绿、在解释器下红。
 */
import { describe, it, expect } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { isMeshShape } from '../../src/mesh/types'
import { computeContentKey } from '../../src/cad-runtime/content-key'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

type Backend = 'vm' | 'interpreter'
const BACKENDS: readonly Backend[] = ['vm', 'interpreter']

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function makeRuntime(execBackend: Backend): CadRuntime {
  return new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespaceWithEditorOps() }, { execBackend })
}

interface Summary {
  /** 每个 part 的内容键（名 + 几何哈希），排序后比较 = 逐值一致。 */
  outputs: string[]
  terminals: string[]
  path: string
  reason: string | undefined
  startLine: number | undefined
}

function summarize(result: Awaited<ReturnType<CadRuntime['execute']>>): Summary {
  const outputs: string[] = []
  for (const [name, shape] of result.outputs) {
    if (isMeshShape(shape)) outputs.push(`${String(name)}:${computeContentKey(shape.positions, shape.indices)}`)
  }
  return {
    outputs: outputs.sort(),
    terminals: result.terminals.map((t) => String(t.id)).sort(),
    path: result.execution.path,
    reason: result.execution.reason,
    startLine: result.execution.startLine,
  }
}

/** 基准：fresh runtime 全量执行 code（"正确答案"）。 */
async function fullBaseline(code: string, backend: Backend): Promise<Summary> {
  return summarize(await makeRuntime(backend).execute(code))
}

/** 页面级：先 execute(A) 建立基线，再 update(A → B)。 */
async function switchProject(a: string, b: string, backend: Backend): Promise<Summary> {
  const rt = makeRuntime(backend)
  const first = await rt.execute(a)
  // 前置条件：基线必须是全量（否则下面的 update 不是"切工程"而是"接着跑"）。
  expect(first.execution.path).toBe('full')
  return summarize(await rt.update(a, b))
}

interface Case {
  name: string
  a: string
  b: string
  /** 期望的执行路径（不写 = 只断言与全量等价，不管走哪条）。 */
  path?: 'full' | 'incremental' | 'noop'
  /** 期望的重放起始行（钉住前缀污染回退到的行）。 */
  startLine?: number
}

const A3 = [
  'let part0 = cad.box(10, 10, 10, { centered: true })',
  'let part1 = cad.box(20, 10, 10, { centered: true })',
  'let part2 = cad.union(part0, part1)',
].join('\n')

const cases: Case[] = [
  // ── 常规：同一工程内的编辑（不能因为收敛逻辑误伤）────────────────────────────
  {
    name: '追加一行',
    a: A3,
    b: `${A3}\nlet part3 = cad.box(5, 5, 5, { centered: true })`,
    path: 'incremental',
    startLine: 4,
  },
  {
    name: '改中间一行的参数',
    a: A3,
    b: A3.replace('cad.box(20, 10, 10', 'cad.box(30, 10, 10'),
    path: 'incremental',
    startLine: 2,
  },
  {
    name: '只差结尾换行 → 零变更',
    a: A3,
    b: `${A3}\n`,
    path: 'noop',
  },

  // ── 切工程：新代码更短 → G2 全量（旧行为，防回归）──────────────────────────
  {
    name: '工程换短（行数减少）',
    a: A3,
    b: 'let part0 = cad.box(10, 20, 30)',
    path: 'full',
  },

  // ── 切工程：新代码更长且共享前缀 → 真增量，旧工程变量必须消失 ────────────────
  {
    name: 'B 少了 pin 且更长（旧变量残留回归）',
    a: [
      'let base = cad.box(20, 20, 10, { centered: true })',
      'let pin = cad.cylinder(3, 10, { centered: true })',
      'let part0 = cad.union(base, pin)',
    ].join('\n'),
    b: [
      'let base = cad.box(20, 20, 10, { centered: true })',
      'let boss = cad.cylinder(6, 12, { centered: true })',
      'let cut = cad.subtract(base, boss)',
      'let part0 = cad.union(cut, base)',
    ].join('\n'),
    path: 'incremental',
    startLine: 2,
  },
  {
    name: 'A 有函数定义、B 没有（函数产出同样不得残留）',
    a: [
      'let base = cad.box(10, 10, 10, { centered: true })',
      'function makeBox(w) {',
      '  return cad.box(w, w, w, { centered: true })',
      '}',
      'let part0 = makeBox(10)',
    ].join('\n'),
    b: [
      'let base = cad.box(10, 10, 10, { centered: true })',
      'let part1 = cad.box(20, 20, 20, { centered: true })',
      'let part2 = cad.union(base, part1)',
      'let part3 = cad.subtract(part2, part1)',
      'let part4 = cad.union(part3, base)',
    ].join('\n'),
    path: 'incremental',
    startLine: 2,
  },

  // ── 前缀污染：旧后缀改写过的前缀变量必须重算（回退到 producer 行）─────────────
  {
    name: 'A 的裸调用原地写回 part0、B 同一行是普通语句',
    a: [
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'cad.translate(part0, { offset: [5, 0, 0] })',
    ].join('\n'),
    b: [
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part1 = cad.box(5, 5, 5, { centered: true })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'),
    path: 'incremental',
    // 改动落在第 2 行，但 part0 的 producer 在第 1 行 → 起点回退到 1（等价全量、
    // 但仍走重放路径；不回退就会拿到 A 平移过的 part0）。
    startLine: 1,
  },
  {
    name: 'A 显式重赋值 part0、B 不再重赋值（显式链同样要回退）',
    a: [
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'part0 = cad.translate(part0, { offset: [5, 0, 0] })',
    ].join('\n'),
    b: [
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part1 = cad.box(5, 5, 5, { centered: true })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'),
    path: 'incremental',
    startLine: 1,
  },
]

describe('切工程：update 结果必须与全量执行逐值一致', () => {
  for (const backend of BACKENDS) {
    for (const c of cases) {
      it(`[${backend}] ${c.name}`, async () => {
        const want = await fullBaseline(c.b, backend)
        const got = await switchProject(c.a, c.b, backend)
        // 基准自身必须是全量 + 无残留（否则"对拍"没有意义）。
        expect(want.path).toBe('full')
        if (c.path !== undefined) expect(got.path).toBe(c.path)
        if (c.startLine !== undefined) expect(got.startLine).toBe(c.startLine)
        // 终端集合是宿主渲染的唯一真源：多一个 = 旧工程模型没清，少一个 = 空画面。
        expect(got.terminals).toEqual(want.terminals)
        expect(got.outputs).toEqual(want.outputs)
      })
    }
  }
})
