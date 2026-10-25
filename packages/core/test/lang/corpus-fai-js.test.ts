/**
 * corpus-fai-js — `.fai.js` 语料 × 量纲判据的契约守卫（2026-10-25）
 *
 * 为什么要有这条测试：2026-10-25 把「裸数字」判据收窄为"只有角度槽位必须带单位、
 * 裸数字在 length/mass/time 槽位按基本单位读"，并同批收紧算子语义（`**` 指数无量纲、
 * `+`/`-` 不得裸数字混量纲）。这两个动作的真实影响面**只能用仓内语料锁住**：
 * 本次改造前实测有 7 条 length 裸数字诊断（今天全部消失），角度侧唯一一处是
 * `phone_stand.fai.js` 里的 `angles: [-tilt, 0, 0]`（走 0 例外也消失）。
 *
 * 这条测试就是那句契约的守门人：
 * - 仓内每一个 `.fai.js` 都必须过 `check()`（含 opDims 的完整量纲判据）。
 * - 例外只有 `E_SYNTAX`：工程模式多文件 fixture 是**片段**，单独喂给 extractMetadata
 *   必然语法错误，与量纲无关。
 *
 * 新增 `.fai.js` 时若确实需要违规写法（例如故意演示报错），把它加进 SYNTAX_FIXTURES
 * 或在文件头注明；**不要**为了让测试变绿而放宽判据。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts, EventSink } from '../../src/cad-runtime/ports'

class SilentSink implements EventSink {
  emit(): void {}
}

/** 工程模式多文件 fixture：单独解析必然是片段，与量纲无关。 */
const SYNTAX_FIXTURES = new Set<string>([])

function collectFaiJs(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) collectFaiJs(p, out)
    else if (ent.name.endsWith('.fai.js')) out.push(p)
  }
  return out
}

describe('.fai.js 语料 — 量纲判据基线', () => {
  it('faijs 仓内每个 .fai.js 都通过 check()', () => {
    // test/lang/ → ../../../../ = 仓根
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const files = collectFaiJs(repoRoot).sort()
    // 语料存在性自检：路径算错时这里是 0，测试会红而不是静默通过
    expect(files.length).toBeGreaterThan(40)

    const ports: HostPorts = { events: new SilentSink() }
    const runtime = createRuntime(ports)
    const failures: string[] = []
    for (const file of files) {
      const rel = relative(repoRoot, file).split(sep).join('/')
      if (SYNTAX_FIXTURES.has(rel)) continue
      const result = runtime.check(readFileSync(file, 'utf8'))
      if (result.ok) continue
      const err = result.errors[0]
      failures.push(`${rel}: ${err.code ?? err.stage} — ${err.message}`)
    }
    expect(failures).toEqual([])
  })
})
