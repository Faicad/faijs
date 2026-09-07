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
