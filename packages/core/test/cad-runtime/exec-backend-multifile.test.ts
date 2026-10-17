/**
 * 多模块工程 × 执行后端（vm / interpreter）—— 端侧多脚本可行性的固化探针。
 *
 * 来源：`3d_editor/docs/plans/2026-10-15-weapp-assembly-animation-workbench-design.md`
 * §9 Phase 0 第 2 条（探针必须固化为测试）。小程序端要把建模脚本与装配动画脚本拆成
 * 两个 faijs 模块，靠 faijs 原生多文件落地：`HostPorts.projectLoader` +
 * `execute(code, { entryKey })` + 相对 `import`。而 weapp worker 被迫使用
 * `execBackend: 'interpreter'`（禁 eval 环境）。
 *
 * 既有测试覆盖了两半，但**没有覆盖交集**：
 * - `packages/tests/faijs/no-ir/multifile/multifile.test.ts` —— 多文件，但跑在默认
 *   direct 后端；
 * - `packages/core/test/cad-runtime/exec-backend-diff.test.ts` —— vm × interpreter
 *   差异，但全是单模块语句。
 *
 * 「多模块装载在 interpreter 下是否同样成立」因此从未被验证过，而它决定端侧方案成立与否。
 * 本文件把这个交集钉成长期回归：装载、绑定、失败三类行为在 interpreter 下与 vm 一致。
 *
 * 若将来 interpreter 后端补/改多模块装载，这些用例是回归网；若本文件出现 divergence，
 * 说明端侧多脚本方案必须重设计（退路是文本拼接，代价见方案 §11）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime, type ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts, ProjectLoader } from '../../src/cad-runtime/ports'
import { isMeshShape } from '../../src/mesh/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

/** 内存工程装载器：moduleKey → 源码文本。 */
function memLoader(map: Record<string, string>): ProjectLoader {
  return {
    listModules: () => Object.keys(map),
    readSource: async (key) => map[key] as string,
  }
}

/** 构造指定后端的 runtime（可选内存 projectLoader）。 */
function mkRuntime(backend: 'vm' | 'interpreter', loader?: ProjectLoader): CadRuntime {
  const ports = { events: { emit: () => {} }, projectLoader: loader } as unknown as HostPorts
  return new CadRuntime(ports, 'mesh', { cad: createApiNamespaceWithEditorOps() }, {
    execBackend: backend,
  })
}

const SHAPE = (name: string): string => `let ${name} = cad.box(10, 20, 30, { centered: true })`

/** ExecutionResult 里真几何的键（排序，便于跨后端逐项比对）。 */
function shapeKeys(r: ExecutionResult): string[] {
  const out: string[] = []
  for (const [k, v] of r.outputs) if (isMeshShape(v)) out.push(String(k))
  out.sort()
  return out
}

/** 终端 id（排序）。 */
function termIds(r: ExecutionResult): string[] {
  return r.terminals.map((t) => String(t.id)).sort()
}

// 几何 op 需要全局 backend 被一个活着的 runtime claim（同 exec-backend-diff.test.ts）。
let warm: CadRuntime

beforeAll(async () => {
  warm = mkRuntime('vm')
  await warm.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
}, 120000)

// ─────────────────────────────────────────────────────────────
// A. interpreter 后端下的多模块：装载 / 绑定 / 失败
// ─────────────────────────────────────────────────────────────

describe('多模块 × interpreter 后端：装载 / 绑定 / 失败', () => {
  it('named import：依赖模块的存活 shape 在 interpreter 下可用（union 结果正确）', async () => {
    const loader = memLoader({ 'bp.fai.js': SHAPE('bp') })
    const rt = mkRuntime('interpreter', loader)
    const r = await rt.execute(
      [
        "import { bp } from './bp.fai.js'",
        'let extra = cad.box(10, 10, 10, { centered: true })',
        'let part = cad.union(bp, extra)',
      ].join('\n'),
    )
    expect(r.failedAt).toBeUndefined()
    expect(shapeKeys(r)).toContain('part')
    // import 绑定是直接终端（D6）——依赖模块的存活 shape 仍参与显示候选
    expect(shapeKeys(r)).toContain('bp')
  })

  it('被依赖模块内部消费掉的 shape 不可 import：interpreter 下同样报 not exported', async () => {
    const shifted = [
      'let base = cad.box(10, 10, 10, { centered: true })',
      'let moved = cad.translate(base, [0, 0, 10])',
    ].join('\n')
    const rt = mkRuntime('interpreter', memLoader({ 'a.fai.js': shifted }))

    // 存活终端可引用
    const ok = await rt.execute("import { moved } from './a.fai.js'\nlet t = moved")
    expect(ok.failedAt).toBeUndefined()

    // base 已被 translate 消费 → 不在 a 的 exports → 引用即失败（不静默给空）
    const bad = await rt.execute("import { base } from './a.fai.js'\nlet t = base")
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt?.message).toContain('base')
    expect(bad.failedAt?.message).toContain('not exported')
  })

  it('缺失模块：interpreter 下同样报 not found（不静默降级）', async () => {
    const rt = mkRuntime('interpreter', memLoader({ 'bp.fai.js': SHAPE('bp') }))
    const r = await rt.execute("import { bp } from './missing.fai.js'\nlet t = bp")
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt?.message).toContain('missing.fai.js')
    expect(r.failedAt?.message).toContain('not found')
  })

  it('命名空间 import：模块常量经 cfg.OUTX 引用在 interpreter 下可用', async () => {
    const loader = memLoader({
      'cfg.fai.js': 'const OUTX = 24\n' + SHAPE('base'),
    })
    const rt = mkRuntime('interpreter', loader)
    const r = await rt.execute(
      [
        "import * as cfg from './cfg.fai.js'",
        'let part = cad.box(cfg.OUTX, 1, 1, { centered: true })',
      ].join('\n'),
    )
    expect(r.failedAt).toBeUndefined()
    expect(shapeKeys(r)).toContain('part')
  })
})

// ─────────────────────────────────────────────────────────────
// B. 多模块 × 后端差异：vm 与 interpreter 必须同结果
// ─────────────────────────────────────────────────────────────

describe('多模块 × 后端差异：vm 与 interpreter 结果一致', () => {
  const MODULES: Record<string, string> = {
    'bp.fai.js': SHAPE('bp'),
    'cfg.fai.js': 'const OUTX = 24\n' + SHAPE('base'),
  }
  const SCRIPT = [
    "import { bp } from './bp.fai.js'",
    "import * as cfg from './cfg.fai.js'",
    'let extra = cad.box(cfg.OUTX, 10, 10, { centered: true })',
    'let part = cad.union(bp, extra)',
  ].join('\n')

  it('同一多模块脚本：几何键与终端逐项一致', async () => {
    const rv = await mkRuntime('vm', memLoader(MODULES)).execute(SCRIPT)
    const ri = await mkRuntime('interpreter', memLoader(MODULES)).execute(SCRIPT)
    expect(rv.failedAt).toBeUndefined()
    expect(ri.failedAt).toBeUndefined()
    expect(shapeKeys(ri)).toEqual(shapeKeys(rv))
    expect(termIds(ri)).toEqual(termIds(rv))
  })

  it('同一失败脚本：两边在同一行失败、同一条消息', async () => {
    const bad = [
      "import { doesNotExist } from './bp.fai.js'",
      'let part = cad.union(doesNotExist, doesNotExist)',
    ].join('\n')
    const rv = await mkRuntime('vm', memLoader(MODULES)).execute(bad)
    const ri = await mkRuntime('interpreter', memLoader(MODULES)).execute(bad)
    expect(rv.failedAt).toBeDefined()
    expect(ri.failedAt).toBeDefined()
    expect(ri.failedAt?.lineNo).toBe(rv.failedAt?.lineNo)
    expect(ri.failedAt?.message).toBe(rv.failedAt?.message)
  })
})

// ─────────────────────────────────────────────────────────────
// C. entryKey 决定相对 import 的解析基准
// ─────────────────────────────────────────────────────────────

describe('entryKey 决定相对 import 的解析基准', () => {
  /** 相对 `./parts/a.fai.js` —— 只有 entry 在 `src/` 下时才解析得到。 */
  const ENTRY_SRC = [
    "import { pa } from './parts/a.fai.js'",
    'let extra = cad.box(1, 1, 1, { centered: true })',
    'let part = cad.union(pa, extra)',
  ].join('\n')
  const MODULES: Record<string, string> = {
    'src/main.fai.js': ENTRY_SRC,
    'src/parts/a.fai.js': SHAPE('pa'),
  }

  it("entryKey='src/main.fai.js'：'./parts/a.fai.js' 相对 entry 目录解析 → 装载成功", async () => {
    const rt = mkRuntime('interpreter', memLoader(MODULES))
    const r = await rt.execute(ENTRY_SRC, { entryKey: 'src/main.fai.js' })
    expect(r.failedAt).toBeUndefined()
    expect(shapeKeys(r)).toContain('part')
  })

  it('不传 entryKey：同一源码相对项目根解析 → 模块不存在（钉住 entryKey 的必要性）', async () => {
    const rt = mkRuntime('interpreter', memLoader(MODULES))
    const r = await rt.execute(ENTRY_SRC)
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt?.message).toContain('not found')
  })
})
