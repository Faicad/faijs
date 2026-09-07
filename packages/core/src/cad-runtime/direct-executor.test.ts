/**
 * direct-executor — 无 IR 执行器测试（P2）
 *
 * 覆盖：
 * - execute/append/update 基本语义（共享 ctx、行号增量、清 ctx 全量）；
 * - 文本变换产物正确性（ctx 提升 / await / 解构 / 顶层函数）；
 * 注意：几何 op 依赖全局 backends（mesh 模式），用「先跑一次 reference
 * runtime 认领全局 backends」的方式提供环境（与 execute-code.test 同构）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { CadRuntime } from './runtime'
import { DirectExecutor } from './direct-executor'
import { createApiNamespace } from '../api/api-namespace'
import type { HostPorts } from './ports'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeContentKey } from './content-key'
import { isMeshShape } from '../mesh/types'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const CODE = [
  'let part0 = cad.box(20, 20, 20, { centered: true })',
  'let part1 = cad.sphere({ radius: 10 })',
  'let part2 = cad.union(part0, part1)',
].join('\n')

/** 收集 mesh 输出内容 key（Map 名序排序；几何一致性判定）。 */
function fingerprint(ctx: Record<string, unknown>): string[] {
  const keys: string[] = []
  for (const [name, v] of Object.entries(ctx)) {
    if (isMeshShape(v)) keys.push(`${name}:${computeContentKey(v.positions, v.indices)}`)
  }
  keys.sort()
  return keys
}

describe('DirectExecutor: execute（共享 ctx / 基本产出）', () => {
  // 全局 backends 认领：用一个 mesh runtime 提供环境（与 execute-code 同构）
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
  const cadNs = createApiNamespace()

  it('execute 三行 op：ctx 含全部 shape 且几何内容合法', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    // 先让全局 backends 归属一个存活 runtime（mesh 模式），几何 op 才能 dispatch
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const out = await ex.execute(CODE)
    expect(out.failedAt).toBeUndefined()
    expect(out.ctxKeys).toContain('part0')
    expect(out.ctxKeys).toContain('part2')
    expect(out.executedLines).toEqual([1, 2, 3])
    const fp = fingerprint(ex.ctx)
    expect(fp).toHaveLength(3)
    expect(isMeshShape(ex.ctx.part2)).toBe(true)
  })

  it('execute 结果与 CadRuntime.execute 几何一致（A-17 抽样）', async () => {
    const baseline = await rt.execute(CODE)
    const baselineKeys: string[] = []
    for (const [name, shape] of baseline.outputs) {
      if (isMeshShape(shape)) baselineKeys.push(`${name}:${computeContentKey(shape.positions, shape.indices)}`)
    }
    baselineKeys.sort()

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(CODE)
    expect(out.failedAt).toBeUndefined()
    const directKeys = fingerprint(ex.ctx)
    expect(directKeys).toEqual(baselineKeys)
  })

  it('append：只执行新行（旧 op 不重跑），共享 ctx 可见旧变量', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const first = await ex.execute(CODE.split('\n').slice(0, 2).join('\n'))
    expect(first.executedLines).toEqual([1, 2])

    const second = await ex.append(CODE.split('\n').slice(2).join('\n'))
    expect(second.executedLines).toEqual([3])
    expect(ex.listCtxKeys()).toContain('part0')
    expect(isMeshShape(ex.ctx.part2)).toBe(true)
    expect(fingerprint(ex.ctx)).toHaveLength(3)
  })

  it('update：清 ctx 全量重跑（R3）', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    await ex.execute('let part0 = cad.box(10, 10, 10, { centered: true })')
    const out = await ex.update('let part0 = cad.box(10, 10, 10, { centered: true })', 'let part0 = cad.box(20, 20, 20, { centered: true })')
    expect(out.failedAt).toBeUndefined()
    const fp = fingerprint(ex.ctx)
    expect(fp).toHaveLength(1)
    // 仅保留新输出（ctx 已清）
    expect(ex.listCtxKeys()).toEqual(['part0'])
  })
})

describe('DirectExecutor: 顶层函数 / 解构 / 参数', () => {
  it('顶层函数定义提升到 ctx 并可被后续行调用', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
    const cadNs = createApiNamespace()
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'function doubleIt(x) { return cad.scale(x, 2) }',
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part1 = doubleIt(part0)',
    ].join('\n')
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()
    expect(typeof ex.ctx.doubleIt).toBe('function')
    expect(isMeshShape(ex.ctx.part1)).toBe(true)
  })

  it('解构 op 行：多输出写入 ctx', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
    const cadNs = createApiNamespace()
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'let part0 = cad.box(30, 30, 30, { centered: true })',
      'const { front: part1, back: part2 } = cad.fai_split(part0)',
    ].join('\n')
    const out = await ex.execute(code)
    expect(out.failedAt).toBeUndefined()
    expect(isMeshShape(ex.ctx.part1)).toBe(true)
    expect(isMeshShape(ex.ctx.part2)).toBe(true)
  })

  it('参数预置（opts.params）注入 ctx', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
    const cadNs = createApiNamespace()
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute('let part0 = cad.box(size, size, size, { centered: true })', {
      params: { size: 20 },
    })
    expect(out.failedAt).toBeUndefined()
    expect(ex.ctx.size).toBe(20)
    expect(isMeshShape(ex.ctx.part0)).toBe(true)
  })

  it('单行失败 → failedAt 携带行号（不中断后续 API 使用）', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
    const cadNs = createApiNamespace()
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part1 = cad.no_such_op(part0)',
    ].join('\n')
    const out = await ex.execute(code)
    expect(out.failedAt).toBeDefined()
    expect(out.failedAt?.lineNo).toBe(2)
    expect(out.failedAt?.index).toBe(1)
    expect(out.failedAt?.callee).toBe('no_such_op')
  })
})

describe('DirectExecutor A-17: fixture 对拍（扁平行式 op 行）', () => {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const fixturesRoot = join(here, '..', '..', '..', 'tests', 'faijs')
  const files: string[] = []
  const collect = (dir: string): void => {
    for (const ent of readdirSync(dir)) {
      const p = join(dir, ent)
      if (statSync(p).isDirectory()) collect(p)
      else if (ent.endsWith('.fai.js')) files.push(p)
    }
  }
  collect(fixturesRoot)

  let rt: CadRuntime
  const cadNs = createApiNamespace()
  beforeAll(async () => {
    rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  })

  it.each(files.map((f) => [f]))('parity outputs: %s', async (file: string) => {
    const code = readFileSync(file, 'utf8')
    // 需要字体/资产/注册库的 fixture（text/engrave/load/第三方库）在裸 mesh 环境下
    // 两边都会失败——不在无环境 corpus 内（对拍在宿主注入对应 ports 后验收）。
    let baseline: Awaited<ReturnType<CadRuntime['execute']>>
    try {
      baseline = await rt.execute(code)
    } catch {
      return
    }
    if (baseline.failedAt) return

    const baselineKeys: string[] = []
    for (const [name, shape] of baseline.outputs) {
      if (isMeshShape(shape)) baselineKeys.push(`${name}:${computeContentKey(shape.positions, shape.indices)}`)
    }
    baselineKeys.sort()

    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    let out: Awaited<ReturnType<DirectExecutor['execute']>>
    try {
      out = await ex.execute(code)
    } catch {
      // baseline 成功而 DirectExecutor 抛错 = 真实分歧
      throw new Error(`DirectExecutor threw but baseline succeeded: ${file}`)
    }
    if (out.failedAt) {
      // baseline 成功而 DirectExecutor 失败 = 真实分歧
      throw new Error(
        `DirectExecutor failed but baseline succeeded: ${file} :: ${out.failedAt.callee}: ${out.failedAt.message}`,
      )
    }
    const directKeys = fingerprint(ex.ctx)
    // 空脚本 / 纯参数脚本两边都无输出 → 跳过
    if (baselineKeys.length === 0 && directKeys.length === 0) return
    expect(directKeys).toEqual(baselineKeys)
  })
})

describe('DirectExecutor: E4 执行选项（beforeStatement / executionTimeoutMs）', () => {
  // 全局 backends 认领：用一个 mesh runtime 提供环境（与 execute-code 同构）
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
  const cadNs = createApiNamespace()

  beforeEach(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  })

  it('beforeStatement：execute 每个已执行单元触发一次（第一参数 s+行号，第二参数行号）', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const calls: Array<[string, number]> = []
    const out = await ex.execute(CODE, { beforeStatement: (id, line) => calls.push([id, line]) })
    expect(out.failedAt).toBeUndefined()
    expect(calls).toEqual([
      ['s1', 1],
      ['s2', 2],
      ['s3', 3],
    ])
  })

  it('beforeStatement：append 只对新单元触发（旧单元不进钩子）', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    await ex.execute(CODE)
    const calls: string[] = []
    const out = await ex.append('let part3 = cad.translate(part2, [1, 0, 0])', {
      beforeStatement: (id) => calls.push(id),
    })
    expect(out.failedAt).toBeUndefined()
    expect(calls).toEqual(['s4'])
  })

  it('executionTimeoutMs：超时抛 ExecutionLimitError（code = E_EXEC_LIMIT）', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    // 若干廉价单元确保远超 1ms 总耗时；deadline 在单元循环内逐单元检查 → 必然触发
    const code = Array.from({ length: 600 }, (_, i) => `let v${i} = ${i}`).join('\n')
    await expect(ex.execute(code, { executionTimeoutMs: 1 })).rejects.toMatchObject({
      name: 'ExecutionLimitError',
      code: 'E_EXEC_LIMIT',
    })
  })

  it('executionTimeoutMs 未超时：正常完成，failedAt 无', async () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const out = await ex.execute(CODE, { executionTimeoutMs: 60_000 })
    expect(out.failedAt).toBeUndefined()
    expect(out.executedLines).toEqual([1, 2, 3])
  })
})
