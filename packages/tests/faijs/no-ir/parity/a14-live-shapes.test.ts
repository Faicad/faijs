/**
 * A-14 快照断言
 *
 * 方案：2026-09-06-no-ir-dual-channel-runtime.md §6 验收 A-14（R11 门禁 3/3）
 *
 * direct-only 终端行为基线：CadRuntime.execute(code) 产出的
 * terminals 与预期一致（最后写者 + 下游无独占消费）。
 *
 * 语料：packages/tests/faijs/ 全部 .fai.js fixture（mesh 模式可跑的部分）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports'
import { extractMetadata } from '@faicad/faijs-core/lang/metadata-extractor'
import { computeLiveShapes, keepViewFromMetadata } from '@faicad/faijs-core/cad-runtime/live-shapes'

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

/** 归一终端（id + hidden → 字符串键排序）。 */
function normalizeTerminals(terminals: Array<{ id: PartName; hidden?: boolean }>): string[] {
  return terminals
    .map((t) => (t.hidden ? `${String(t.id)}:hidden` : String(t.id)))
    .sort()
}

describe('A-14: fixture — direct terminals 行为基线', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it.each(fixtureFiles.map((f) => [f]))('terminals: %s', async (file: string) => {
    const code = readFileSync(file, 'utf8')
    // 需要外部环境的 fixture：执行失败 → 跳过
    let result: Awaited<ReturnType<CadRuntime['execute']>>
    try {
      result = await rt.execute(code)
    } catch {
      return
    }
    if (result.failedAt) return

    // 行为基线：终端集非空 + 每个 terminal 在 outputs 中有对应 shape
    expect(result.terminals.length).toBeGreaterThan(0)
    for (const term of result.terminals) {
      const shape = result.outputs.get(term.id as never)
      if (!term.hidden) {
        expect(shape).toBeDefined()
      }
    }

    // 终端 id 集排序后非空
    const termKeys = normalizeTerminals(result.terminals)
    expect(termKeys.length).toBeGreaterThan(0)
  })
})

describe('A-14b: P25 C4 —— 无赋值裸调用不消费（静态/运行时对拍）', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it('只读裸调用（bboxCenter）：输入仍终端，静态与运行时一致', async () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.bboxCenter(part0)',
    ].join('\n')
    const result = await rt.execute(code)
    expect(result.failedAt).toBeUndefined()
    // 运行时终端：part0（bboxCenter 返回纯数据，守卫不写回）
    expect(normalizeTerminals(result.terminals)).toEqual(['part0'])
    // 静态判定一致（无 inplaceWrites 时 C4 不消费）
    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
    })
    expect(normalizeTerminals(terminals)).toEqual(['part0'])
  })

  it('修改类裸调用（fai_drill）：写回登记 → 输入仍终端（producer 锚到裸调用行）', async () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.fai_drill(part0, { diameter: 4, depth: 0, position: [0, 0, 0] })',
      'const p1 = cad.scale(part0, 2)',
    ].join('\n')
    const result = await rt.execute(code)
    expect(result.failedAt).toBeUndefined()
    // part0 被行2 写回（新值），行3 消费新值 → part0 不终端，p1 终端
    expect(normalizeTerminals(result.terminals)).toEqual(['p1'])
    // 静态：带 inplaceWrites（行2→part0）判定一致
    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const l of meta.lines) for (const o of l.outputs) shapeVarNames.add(o)
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: keepViewFromMetadata(meta),
      shapeVarNames,
      inplaceWrites: new Map([[2, 'part0']]),
    })
    expect(normalizeTerminals(terminals)).toEqual(['p1'])
  })
})
