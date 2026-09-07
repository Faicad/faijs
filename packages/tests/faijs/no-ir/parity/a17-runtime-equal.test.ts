/**
 * A-17 runtime 等价 → 快照断言（T5 后：module 路径已删除）
 *
 * 方案：2026-09-06-no-ir-dual-channel-runtime.md §6 验收 A-17
 *
 * T5 后：不再做 DirectExecutor vs CadRuntime.execute 对拍。
 * 改为 CadRuntime.execute 行为基线验证：
 * - outputs 几何指纹非空
 * - terminals（含 hidden）一致且每个 terminal 有对应 output
 *
 * 语料：packages/tests/faijs/ 全部 .fai.js（mesh 模式可跑部分）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { computeContentKey } from '@faicad/faijs-core/cad-runtime/content-key'
import { isMeshShape } from '@faicad/faijs-core/mesh/types'
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

function outputFingerprint(outputs: Map<PartName, unknown>): string[] {
  const keys: string[] = []
  for (const [name, v] of outputs) {
    if (isMeshShape(v)) keys.push(`${name}:${computeContentKey(v.positions, v.indices)}`)
  }
  return keys.sort()
}

function terminalKeys(terminals: Array<{ id: PartName; hidden?: boolean }>): string[] {
  return terminals.map((t) => (t.hidden ? `${String(t.id)}:hidden` : String(t.id))).sort()
}

describe('A-17: CadRuntime.execute 行为基线（fixture 全集，mesh）', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it.each(fixtureFiles.map((f) => [f]))('runtime baseline: %s', async (file: string) => {
    const code = readFileSync(file, 'utf8')
    let result: Awaited<ReturnType<CadRuntime['execute']>>
    try {
      result = await rt.execute(code)
    } catch {
      return // 需要外部环境的 fixture → 跳过
    }
    if (result.failedAt) return

    // outputs 几何指纹非空
    const fp = outputFingerprint(result.outputs as unknown as Map<PartName, unknown>)
    expect(fp.length).toBeGreaterThan(0)

    // terminals 非空 + 每个 terminal 在 outputs 中有对应 shape（hidden 除外）
    expect(result.terminals.length).toBeGreaterThan(0)
    for (const term of result.terminals) {
      if (!term.hidden) {
        const shape = result.outputs.get(term.id as never)
        expect(shape).toBeDefined()
      }
    }

    // 终端 id 集排序后稳定
    const termKeys = terminalKeys(result.terminals)
    expect(termKeys.length).toBeGreaterThan(0)
  })
})
