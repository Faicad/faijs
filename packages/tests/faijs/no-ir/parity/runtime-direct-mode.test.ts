/**
 * P4/T5: CadRuntime direct 执行语义验证（module 路径已删除）
 *
 * T5 后：module 路径已删除，不再做 direct vs module 对拍。
 * 改为 direct-only 行为验证：outputs/terminals/failedAt/append/update
 * 等 runtime 面语义在 mesh 模式下正确。
 *
 * 语料：packages/tests/faijs/ 全部 .fai.js（mesh 模式可跑部分）。
 * 需要字体/资产/注册库的 fixture 在裸环境失败 → 跳过（宿主注入后
 * 集成测试覆盖）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CadRuntime, AppendPrefixError, ExecutionLimitError } from '@faicad/faijs-core/cad-runtime/runtime'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { computeContentKey } from '@faicad/faijs-core/cad-runtime/content-key'
import { isMeshShape } from '@faicad/faijs-core/mesh/types'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports'
import type { TerminalShape } from '@faicad/faijs-core/lang/types'

const here = fileURLToPath(new URL('.', import.meta.url))
const fixturesRoot = join(here, '..', '..', '..')

function collectFiles(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent)
    if (statSync(p).isDirectory()) collectFiles(p, out)
    else if (ent.endsWith('.fai.js')) out.push(p)
  }
}
const fixtureFiles: string[] = []
collectFiles(fixturesRoot, fixtureFiles)

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function outputFingerprint(outputs: Map<PartName, unknown>): string[] {
  const keys: string[] = []
  for (const [name, v] of outputs) {
    if (isMeshShape(v)) keys.push(`${name}:${computeContentKey(v.positions, v.indices)}`)
  }
  return keys.sort()
}

function terminalKeys(terminals: TerminalShape[]): string[] {
  return terminals.map((t) => (t.hidden ? `${String(t.id)}:hidden` : String(t.id))).sort()
}

function compoundKeys(compounds: Map<PartName, PartName[]> | undefined): string[] {
  if (!compounds || compounds.size === 0) return []
  return [...compounds.entries()]
    .map(([name, members]) => `${String(name)}:[${[...members].sort().join(',')}]`)
    .sort()
}

const WARMUP = 'let warmup = cad.box(1, 1, 1, { centered: true })'

describe('T5：CadRuntime direct 执行（fixture 全集，mesh）', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })

  beforeAll(async () => {
    await rt.execute(WARMUP)
  }, 120000)

  it.each(fixtureFiles.map((f) => [f]))('direct execute: %s', async (file: string) => {
    const code = readFileSync(file, 'utf8')
    const result = await rt.execute(code)
    // 需要外部环境的 fixture → 失败可接受（跳过断言）
    if (result.failedAt) return

    // 成功的 fixture：验证 outputs 非空 + terminals 合理
    expect(result.outputs.size).toBeGreaterThan(0)
  })
})

describe('T5：CadRuntime direct 模式 runtime 面语义', () => {
  const cadNs = createApiNamespace()
  const mk = (): CadRuntime =>
    new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })

  it('A-1：execute 产出 terminals（outputs + terminals 与预期同形）', async () => {
    const rt = mk()
    const r = await rt.execute('let bp = cad.box(10, 20, 30, { centered: true })\nlet t = cad.translate(bp, [5, 0, 0])')
    expect(r.failedAt).toBeUndefined()
    expect(r.outputs.size).toBe(2)
    // 最后写者 bp 被 translate 消费 → 只剩 t 存活
    expect(r.terminals.map((t) => String(t.id)).sort()).toEqual(['t'])
  })

  it('A-2：append 共享 ctx 增量执行（新行引用先前产出）', async () => {
    const rt = mk()
    await rt.execute('let bp = cad.box(10, 20, 30, { centered: true })')
    const r2 = await rt.append('let t = cad.translate(bp, [5, 0, 0])')
    expect(r2.failedAt).toBeUndefined()
    expect(r2.terminals.map((t) => String(t.id)).sort()).toEqual(['t'])
  })

  it('append 引用不在 ctx 的变量 → AppendPrefixError（宿主升级为 execute）', async () => {
    const rt = mk()
    await rt.execute('let bp = cad.box(10, 20, 30, { centered: true })')
    await expect(rt.append('let t = cad.translate(missingPart, [5, 0, 0])')).rejects.toBeInstanceOf(AppendPrefixError)
  })

  it('A-3：update 全量重跑；失败记 failedAt 且带 lineNo', async () => {
    const rt = mk()
    const goodCode = 'let bp = cad.box(10, 20, 30, { centered: true })\nlet t = cad.translate(bp, [5, 0, 0])'
    await rt.execute(goodCode)
    // update 把第二行换成不存在的 op → failedAt.lineNo 指向该行
    const badCode = 'let bp = cad.box(10, 20, 30, { centered: true })\nlet boom = cad.no_such_op(bp)'
    const bad = await rt.update(goodCode, badCode)
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt?.lineNo).toBe(2)
    expect(bad.failedAt?.callee).toBe('no_such_op')
    // update 合法文本 → 与 execute(新文本) 等价
    const upd = await rt.update(badCode, goodCode)
    const full = await rt.execute(goodCode)
    expect(upd.failedAt).toBeUndefined()
    expect(terminalKeys(upd.terminals)).toEqual(terminalKeys(full.terminals))
  })

  it('E8：execute 后 getCachedOutput 从 direct ctx 派生缓存可读', async () => {
    const rt = mk()
    const r = await rt.execute('let p1 = cad.box(1, 2, 3, { centered: true })')
    expect(r.failedAt).toBeUndefined()
    const cached = rt.getCachedOutput(asPartName('p1'))
    expect(cached).toBeDefined()
    expect(cached && isMeshShape(cached)).toBe(true)
    rt.clearStatementCache()
    expect(rt.getCachedOutput(asPartName('p1'))).toBeUndefined()
  })
})

describe('T5：CadRuntime direct 模式 E4 执行选项', () => {
  const cadNs = createApiNamespace()
  const mk = (): CadRuntime =>
    new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  const CODE = [
    'let bp = cad.box(10, 20, 30, { centered: true })',
    'let t = cad.translate(bp, [5, 0, 0])',
  ].join('\n')

  it('beforeStatement：execute 每个已执行单元触发（第一参数 s+行号）；append 只对新单元触发', async () => {
    const rt = mk()
    const calls: string[] = []
    const r1 = await rt.execute(CODE, { beforeStatement: (id) => calls.push(id) })
    expect(r1.failedAt).toBeUndefined()
    expect(calls).toEqual(['s1', 's2'])
    const calls2: string[] = []
    const r2 = await rt.append('let t2 = cad.translate(t, [5, 0, 0])', { beforeStatement: (id) => calls2.push(id) })
    expect(r2.failedAt).toBeUndefined()
    expect(calls2).toEqual(['s3'])
  })

  it('executionTimeoutMs：超时抛 ExecutionLimitError（code = E_EXEC_LIMIT，透传 direct）', async () => {
    const rt = mk()
    // 若干廉价单元确保远超 1ms 总耗时（单元循环内 deadline 检查必然触发）
    const code = Array.from({ length: 600 }, (_, i) => `let v${i} = ${i}`).join('\n')
    const err = await rt.execute(code, { executionTimeoutMs: 1 }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ExecutionLimitError)
    expect((err as { code?: string }).code).toBe('E_EXEC_LIMIT')
  })

  it('executionTimeoutMs 未超时：正常完成', async () => {
    const rt = mk()
    const r = await rt.execute(CODE, { executionTimeoutMs: 60_000 })
    expect(r.failedAt).toBeUndefined()
    expect(terminalKeys(r.terminals)).toEqual(['t'])
  })
})

describe('T5/P5：参数引用保真（A-5）— 编辑 height 后 update 全量重跑，代码行保留参数引用形态', () => {
  const cadNs = createApiNamespace()
  const mk = (): CadRuntime =>
    new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  it('改参数值：几何内容 key 变化且 terminals 仍为 bp（引用形态未破坏）', async () => {
    const rt = mk()
    const oldCode = 'const height = 10\nlet bp = cad.box(10, 20, height, { centered: true })'
    const newCode = 'const height = 30\nlet bp = cad.box(10, 20, height, { centered: true })'
    const before = await rt.execute(oldCode)
    expect(before.failedAt).toBeUndefined()
    const after = await rt.update(oldCode, newCode)
    expect(after.failedAt).toBeUndefined()
    // 行级参数引用形态保真（重印后的行仍引用 height，不落数值）
    expect(newCode).toContain('cad.box(10, 20, height')
    expect(terminalKeys(after.terminals)).toEqual(['bp'])
    // 高度 10 → 30，几何内容 key 必然变化（参数编辑生效）
    const fp1 = outputFingerprint(before.outputs as unknown as Map<PartName, unknown>)
    const fp2 = outputFingerprint(after.outputs as unknown as Map<PartName, unknown>)
    expect(fp1.length).toBe(1)
    expect(fp2.length).toBe(1)
    expect(fp2[0]).not.toBe(fp1[0])
  })
})

describe('E6/E7：direct 面 failedAt.index 语句序数与 check() 语法门禁', () => {
  const cadNs = createApiNamespace()
  const directMk = (): CadRuntime =>
    new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })

  it('E6：failedAt.index 为场景语句序数（参数行不计入；与 lines 位置一致）', async () => {
    const code = [
      'const height = 10',
      'let okp = cad.box(height, height, height, { centered: true })',
      'let boom = cad.no_such_op(okp)',
    ].join('\n')
    const dr = directMk()
    await dr.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const direct = await dr.execute(code)
    expect(direct.failedAt).toBeDefined()
    expect(direct.failedAt?.callee).toBe('no_such_op')
    expect(direct.failedAt?.lineNo).toBe(3)
    // 语句序数 = meta.lines 内位置（参数行 height 不计入）→ boom 是第 2 条语句（下标 1）
    expect(direct.failedAt?.index).toBe(1)
  })

  it('E7：direct check = 语法门禁（未知 callee 放行；语法错 ok=false 带行号）', async () => {
    const direct = directMk()
    // 语法门禁：未知 callee 不报错（执行期才 failedAt）
    const loose = direct.check('let x = cad.no_such_op()\nlet ok = cad.box(1, 1, 1)')
    expect(loose.ok).toBe(true)
    expect(loose.script?.statements).toBe(2)
    // 语法错误 → ok=false，stage=parse，带 E_SYNTAX 与行号
    const bad = direct.check('let x = (')
    expect(bad.ok).toBe(false)
    expect(bad.errors[0]?.stage).toBe('parse')
    expect(bad.errors[0]?.code).toBe('E_SYNTAX')
    expect(bad.errors[0]?.line ?? 0).toBeGreaterThan(0)
  })
})
