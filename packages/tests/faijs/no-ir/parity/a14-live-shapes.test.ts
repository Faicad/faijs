/**
 * A-14 对拍（P3 双路径）：computeLiveShapes == computeLeafTerminals
 *
 * 方案：2026-09-06-no-ir-dual-channel-runtime.md §6 验收 A-14（R11 门禁 3/3）
 *
 * 语料：packages/tests/faijs/ 全部 .fai.js fixture（mesh 模式可跑的部分）。
 *
 * 方法（双路径共存）：
 * - 旧路径：CadRuntime.executeIR（ModuleExecutor 链）→ collectResult 的
 *   computeLeafTerminals 终端（含 exec.keepHidden 登记的 hidden）；
 * - 新路径：同一 ctx 的 shape 变量名 + extractMetadata.lines + keep 视图
 *   （行内 = metadata.keep；函数体 = executor.internalKeep 按行号映射）喂给
 *   computeLiveShapes；
 * - 断言：终端 id 集 + hidden 逐条相等。
 *
 * 需要字体/资产/注册库的 fixture（text/engrave/load/第三方库）在此裸环境跑不动，
 * 两条路径都会失败 → 跳过（宿主注入对应 ports 后在对拍语料单独覆盖）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { computeLeafTerminals } from '@faicad/faijs-core/cad-runtime/terminal-dag'
import { computeLiveShapes, type KeepRegistration } from '@faicad/faijs-core/cad-runtime/live-shapes'
import { extractMetadata } from '@faicad/faijs-core/lang/metadata-extractor'
import { parseScript } from '@faicad/faijs-core/lang/parser'
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

describe('A-14: fixture 双路径 — computeLiveShapes == computeLeafTerminals', () => {
  const cadNs = createApiNamespace()
  const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: cadNs })
  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  it.each(fixtureFiles.map((f) => [f]))('dual-path: %s', async (file: string) => {
    const code = readFileSync(file, 'utf8')
    // 旧路径：解析 + 全量执行（executeIR 内部 compile → ModuleExecutor）
    let script: ReturnType<typeof parseScript>['script']
    let statementLines: number[]
    try {
      const r = parseScript(code)
      script = r.script
      statementLines = r.statementLines
    } catch {
      return // 现状拒绝（块/自由 JS）→ 块场景由 A-6 单独验收
    }
    // 需要外部环境的 fixture：旧路径失败 → 跳过（宿主注入后另行覆盖）
    try {
      await rt.executeIR(script)
    } catch {
      return
    }

    // 旧路径终端（含 exec.keepHidden 登记 → computeLeafTerminals）
    const executor = (rt as unknown as { executor: CadRuntime['executor'] }).executor
    // 手工重放 collectResult 的终端计算，拿「同样的运行时视图」下的旧路径结果：
    // shapeVarNames 来自 ctx（与 collectResult allShapeVarNames 同源）
    const shapeVarNames = new Set<PartName>()
    for (const name of executor.listCtxKeys()) {
      const v = executor.getCtxVar(name)
      if (v && typeof v === 'object' && 'positions' in v) shapeVarNames.add(asPartName(name))
    }
    const legacyView = {
      value: (name: PartName): unknown => executor.getCtxVar(String(name)),
      internalKeep: (stmt: { id: string }): ReturnType<typeof executor.getInternalKeep> =>
        executor.getInternalKeep(stmt.id as never),
    }
    const legacyTerminals = computeLeafTerminals(script, shapeVarNames, legacyView)
      .map((t) => {
        const v = executor.getCtxVar(String(t.id))
        const isCompound = v && typeof v === 'object' && !('positions' in v)
        return isCompound ? { ...t, kind: 'compound' as const } : t
      })

    // 新路径：metadata.lines + 同一 ctx 的 shape 变量名 + keep 视图
    const meta = extractMetadata(code)
    const lineToStmtId = new Map<number, string>()
    script.statements.forEach((s, i) => lineToStmtId.set(statementLines[i] ?? 0, String(s.id)))
    const functionBody = new Map<number, KeepRegistration>()
    for (const [line, stmtId] of lineToStmtId) {
      const rec = executor.getInternalKeep(stmtId as never)
      if (rec) {
        functionBody.set(line, {
          kept: new Set([...rec.kept].map((k) => asPartName(String(k)))),
          hidden: new Map([...rec.hidden].map(([k, h]) => [asPartName(String(k)), h])),
        })
      }
    }
    const liveTerminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: {
        lineEntries: (lineNo) => meta.keep.get(lineNo),
        functionBody: (lineNo) => functionBody.get(lineNo),
      },
      shapeVarNames,
      explicitTerminals: script.terminalShapes,
    })

    expect(normalizeTerminals(liveTerminals)).toEqual(normalizeTerminals(legacyTerminals))
  })
})
