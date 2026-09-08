/**
 * 多文件模块（§4.5 / A-8 / A-9 / A-10）——CadRuntime direct 模式 + HostPorts.projectLoader
 *
 * - A-8：`import { bp } from './x.fai.js'` + 后续 op 引用通过；缺失导出名 / 缺失模块 /
 *   循环依赖 → failedAt（带环路径 / import 行）。
 * - A-9：引用判定与显示判定一致——A 内被消费的 shape 不在 A.liveShapes → B 引用报错；
 *   A 的存活 shape 全部可被 B 引用。
 * - A-10：跨文件引用不取消被引用 shape 的显示资格（D6——B 引用 A 的 shape 后，A 的
 *   liveShapes 仍含它；B 侧 import 绑定作为直接终端保留）。
 *
 * 环境：mesh 模式 + 内存 projectLoader（moduleKey → 源码文本）；direct 为 guarded 可选。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import type { ProjectLoader } from '@faicad/faijs-core/cad-runtime/ports'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { isMeshShape } from '@faicad/faijs-core/mesh/types'
import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports'
import type { ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'

function memLoader(map: Record<string, string>): ProjectLoader {
  return {
    listModules: () => Object.keys(map),
    readSource: async (key) => map[key],
  }
}

function mkRuntime(loader: ProjectLoader): CadRuntime {
  const ports = { events: { emit: () => {} }, projectLoader: loader } as unknown as HostPorts
  return new CadRuntime(ports, 'mesh', { cad: createApiNamespace() })
}

const SHAPE = (name: string): string => `let ${name} = cad.box(10, 20, 30, { centered: true })`
const term = (r: ExecutionResult): string[] => r.terminals.map((t) => String(t.id))

function hasShape(r: ExecutionResult, name: string): boolean {
  for (const [k, v] of r.outputs) {
    if (String(k) === name && isMeshShape(v)) return true
  }
  return false
}

describe('A-8：多文件 import + 引用通过 / 缺失导出 / 缺失模块 / 循环依赖', () => {
  const cadNs = createApiNamespace()
  const ports0 = { events: { emit: () => {} } } as unknown as HostPorts
  const warm = new CadRuntime(ports0, 'mesh', { cad: cadNs })

  beforeAll(async () => {
    await warm.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('named import：依赖 shape 直接可用，union 结果正确（无 failedAt）', async () => {
    const loader = memLoader({
      'bp.fai.js': SHAPE('bp'),
    })
    const rt = mkRuntime(loader)
    const r = await rt.execute([
      "import { bp } from './bp.fai.js'",
      'let extra = cad.box(10, 10, 10, { centered: true })',
      'let part = cad.union(bp, extra)',
    ].join('\n'))
    expect(r.failedAt).toBeUndefined()
    expect(hasShape(r, 'part')).toBe(true)
    // union 输出是最后写者 → 终端含 part（bp/extra 被 union keepHidden 保留为隐藏终端）
    expect(term(r)).toContain('part')
    expect(hasShape(r, 'bp')).toBe(true)
  })

  it('缺失导出名 → failedAt（lineNo 指向 import 行，callee = 绑定名）', async () => {
    const loader = memLoader({
      'bp.fai.js': SHAPE('bp'),
    })
    const rt = mkRuntime(loader)
    const code = [
      "import { doesNotExist } from './bp.fai.js'",
      'let part = cad.union(doesNotExist, doesNotExist)',
    ].join('\n')
    const r = await rt.execute(code)
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt?.lineNo).toBe(1)
    expect(r.failedAt?.callee).toBe('doesNotExist')
    expect(r.failedAt?.message).toContain('doesNotExist')
    expect(r.failedAt?.message).toContain('not exported')
  })

  it('缺失模块 → failedAt（NOT_FOUND 提示可用模块）', async () => {
    const loader = memLoader({ 'bp.fai.js': SHAPE('bp') })
    const rt = mkRuntime(loader)
    const r = await rt.execute("import { bp } from './missing.fai.js'\nlet t = bp")
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt?.message).toContain('missing.fai.js')
    expect(r.failedAt?.message).toContain('not found')
  })

  it('循环依赖 → failedAt（message 带环路径）', async () => {
    const loader = memLoader({
      'a.fai.js': "import { b } from './b.fai.js'\n" + SHAPE('a'),
      'b.fai.js': "import { a } from './a.fai.js'\n" + SHAPE('b'),
    })
    const rt = mkRuntime(loader)
    const r = await rt.execute("import { a } from './a.fai.js'\nlet t = a")
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt?.message).toContain('cycle')
  })

  it('命名空间 import：模块常量经 cfg.OUTX 引用可用', async () => {
    const loader = memLoader({
      'cfg.fai.js': 'const OUTX = 24\n' + 'let base = cad.box(OUTX, OUTX, OUTX, { centered: true })',
    })
    const rt = mkRuntime(loader)
    const r = await rt.execute([
      "import * as cfg from './cfg.fai.js'",
      'let part = cad.box(cfg.OUTX, 1, 1, { centered: true })',
    ].join('\n'))
    expect(r.failedAt).toBeUndefined()
    expect(hasShape(r, 'part')).toBe(true)
  })

  it('函数导出：import 的函数可被主模块调用', async () => {
    const loader = memLoader({
      'fn.fai.js': [
        'function lift(shape) {',
        '  return cad.translate(shape, [0, 0, 5])',
        '}',
      ].join('\n'),
    })
    const rt = mkRuntime(loader)
    const r = await rt.execute([
      "import { lift } from './fn.fai.js'",
      'let base = cad.box(10, 10, 10, { centered: true })',
      'let p = lift(base)',
    ].join('\n'))
    expect(r.failedAt).toBeUndefined()
    expect(hasShape(r, 'p')).toBe(true)
  })
})

describe('A-9/A-10：引用判定与显示判定一致；跨文件引用不取消显示资格（D6）', () => {
  const cadNs = createApiNamespace()
  const ports0 = { events: { emit: () => {} } } as unknown as HostPorts
  const warm = new CadRuntime(ports0, 'mesh', { cad: cadNs })

  beforeAll(async () => {
    await warm.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  // A 模块：base 被 translate 消费（不进 liveShapes）；moved 是存活导出。
  const A = [
    'let base = cad.box(10, 10, 10, { centered: true })',
    'let moved = cad.translate(base, [0, 0, 10])',
  ].join('\n')

  it('A-9：A 的存活 shape 可被 B 引用；A 内被消费的 base 不可引用（failedAt）', async () => {
    const loader = memLoader({ 'a.fai.js': A })
    const rt = mkRuntime(loader)
    // moved ∈ A.liveShapes → 通过
    const ok = await rt.execute("import { moved } from './a.fai.js'\nlet t = moved")
    expect(ok.failedAt).toBeUndefined()
    // base 在 A 内被 translate 消费 → 不在 A.liveShapes → failedAt
    const bad = await rt.execute("import { base } from './a.fai.js'\nlet t = base")
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt?.message).toContain('base')
    expect(bad.failedAt?.message).toContain('not exported')
  })

  it('A-10：B 引用 A 的 moved 后，moved 仍是 B 的显示候选（直接终端）', async () => {
    const loader = memLoader({ 'a.fai.js': A })
    const rt = mkRuntime(loader)
    const r = await rt.execute([
      "import { moved } from './a.fai.js'",
      'let extra = cad.box(5, 5, 20, { centered: true })',
      'let part = cad.union(moved, extra)',
    ].join('\n'))
    expect(r.failedAt).toBeUndefined()
    // moved 是 import 绑定（无生产者行）→ 直接终端，D6 显示资格不被 B 的引用取消
    expect(term(r)).toContain('moved')
    expect(term(r)).toContain('part')
  })
})
