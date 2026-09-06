/**
 * A-17 runtime 等价（P4 前置证据）：DirectExecutor 执行 → computeLiveShapes
 * 的 outputs + terminals（含 exec.keepHidden 隐态）== CadRuntime.execute 全量结果。
 *
 * 现状 executeIR 把函数体 keep（union 等的 exec.keepHidden）登记进
 * ModuleExecutor.internalKeep（StmtId 键）；DirectExecutor 以行号为键做等价登记
 * （getKeepByLine），computeLiveShapes 消费同一登记 → 终端集必须逐条相等。
 *
 * 语料：packages/tests/faijs/ 全部 .fai.js（mesh 模式可跑部分）。
 * 需要字体/资产/注册库的 fixture 在此环境两边都失败 → 跳过（宿主注入后集成测试覆盖）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { DirectExecutor } from '@faicad/faijs-core/cad-runtime/direct-executor'
import { computeLiveShapes, type KeepRegistration } from '@faicad/faijs-core/cad-runtime/live-shapes'
import { extractMetadata } from '@faicad/faijs-core/lang/metadata-extractor'
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

function outputFingerprint(ctx: Record<string, unknown> | Map<string, unknown>): string[] {
  const keys: string[] = []
  const entries = ctx instanceof Map ? [...ctx.entries()] : Object.entries(ctx)
  for (const [name, v] of entries) {
    if (isMeshShape(v)) keys.push(`${name}:${computeContentKey(v.positions, v.indices)}`)
  }
  return keys.sort()
}

function terminalKeys(terminals: Array<{ id: PartName; hidden?: boolean }>): string[] {
  return terminals.map((t) => (t.hidden ? `${String(t.id)}:hidden` : String(t.id))).sort()
}

describe('P4 前置：DirectExecutor+computeLiveShapes == CadRuntime.execute（fixture 全集）', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it.each(fixtureFiles.map((f) => [f]))('runtime-equal: %s', async (file: string) => {
    const code = readFileSync(file, 'utf8')
    // 旧路径全量结果
    let baseline: Awaited<ReturnType<CadRuntime['execute']>>
    try {
      baseline = await rt.execute(code)
    } catch {
      return // 需要外部环境的 fixture → 跳过
    }
    if (baseline.failedAt) return

    // 无 IR 栈：DirectExecutor 执行 → 行号键 keep 登记 → computeLiveShapes
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const direct = await ex.execute(code)
    if (direct.failedAt) {
      throw new Error(`DirectExecutor failed: ${file} :: ${direct.failedAt.message}`)
    }
    const meta = extractMetadata(code)
    const shapeVarNames = new Set<PartName>()
    for (const name of ex.listCtxKeys()) {
      const v = ex.getCtxVar(name)
      if (v && typeof v === 'object' && ('positions' in v || 'children' in v)) {
        shapeVarNames.add(asPartName(name))
      }
    }
    const functionBody = new Map<number, KeepRegistration>()
    for (const line of ex.listKeepLines()) {
      const rec = ex.getKeepByLine(line)
      if (rec) functionBody.set(line, rec)
    }
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: {
        lineEntries: (lineNo) => meta.keep.get(lineNo),
        functionBody: (lineNo) => functionBody.get(lineNo),
      },
      shapeVarNames,
    })

    // outputs 几何一致
    expect(outputFingerprint(ex.ctx)).toEqual(outputFingerprint(baseline.outputs as unknown as Map<string, unknown>))
    // terminals（含 hidden）一致
    expect(terminalKeys(terminals)).toEqual(terminalKeys(baseline.terminals))
  })
})
