/**
 * P4 runtime 切换证据：CadRuntime(executor='direct') 与 CadRuntime(缺省 module)
 * 在 mesh fixture 全集上逐条等价（outputs 几何 + terminals + failedAt），并覆盖
 * append/update/AppendPrefixError/failedAt.lineNo 等 runtime 面语义。
 *
 * 语料与 A-17 相同：packages/tests/faijs/ 全部 .fai.js（mesh 模式可跑部分）。
 * 需要字体/资产/注册库的 fixture 在此环境 module 路径也失败 → 跳过（宿主注入后
 * 集成测试覆盖）。缺省 executorMode 仍为 'module'——direct 是 guarded 可选模式。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CadRuntime, AppendPrefixError } from '@faicad/faijs-core/cad-runtime/runtime'
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

describe('P4：CadRuntime direct 模式 == module 模式（fixture 全集，mesh）', () => {
  const cadNs = createApiNamespace()
  const moduleRt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  const directRt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs }, { executor: 'direct' })

  beforeAll(async () => {
    await moduleRt.execute(WARMUP)
    await directRt.execute(WARMUP)
  }, 120000)

  it.each(fixtureFiles.map((f) => [f]))('direct==module: %s', async (file: string) => {
    const code = readFileSync(file, 'utf8')
    let baseline: Awaited<ReturnType<CadRuntime['execute']>>
    try {
      baseline = await moduleRt.execute(code)
    } catch {
      return // 需要外部环境的 fixture → 跳过（module 路径抛错/不支持）
    }
    if (baseline.failedAt) return // env 依赖 fixture → 两边都失败，跳过

    const direct = await directRt.execute(code)
    // module 成功而 direct 失败 = 回归（对拍红线）
    if (direct.failedAt) {
      throw new Error(`direct failed on ${file}: ${direct.failedAt.message}`)
    }
    expect(outputFingerprint(direct.outputs as unknown as Map<PartName, unknown>)).toEqual(
      outputFingerprint(baseline.outputs as unknown as Map<PartName, unknown>),
    )
    expect(terminalKeys(direct.terminals)).toEqual(terminalKeys(baseline.terminals))
    expect(compoundKeys(direct.compounds)).toEqual(compoundKeys(baseline.compounds))
  })
})

describe('P4：CadRuntime direct 模式 runtime 面语义', () => {
  const cadNs = createApiNamespace()
  const mk = (): CadRuntime =>
    new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs }, { executor: 'direct' })

  it('A-1：execute 产出 terminals（outputs + terminals 与 module 同形）', async () => {
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

  it('同名 module 实例与 direct 实例产出逐条一致（box→translate 链）', async () => {
    const cad = createApiNamespace()
    const m = new CadRuntime(defaultPorts(), 'mesh', { cad }, { executor: 'module' })
    const d = new CadRuntime(defaultPorts(), 'mesh', { cad }, { executor: 'direct' })
    const code = 'let bp = cad.box(10, 20, 30, { centered: true })\nlet t = cad.translate(bp, [5, 0, 0])'
    const [mr, dr] = [await m.execute(code), await d.execute(code)]
    expect(outputFingerprint(dr.outputs as unknown as Map<PartName, unknown>)).toEqual(
      outputFingerprint(mr.outputs as unknown as Map<PartName, unknown>),
    )
    expect(terminalKeys(dr.terminals)).toEqual(terminalKeys(mr.terminals))
  })
})
