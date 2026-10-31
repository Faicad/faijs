/**
 * 攻丝孔 PMI —— 脚本面端到端（`.fai.js` → 执行 → `ExecutionResult.pmi`）。
 *
 * 这一层验证的是**接线**，不是几何：`cad` 命名空间里有 `fai_drill` / `pmiThreads` /
 * `formatThreadHole`，执行结果里能读到螺纹孔标注，且一条标注同时带底孔与螺纹。
 *
 * 运行：npx vitest run test/api/pmi/pmi-thread-e2e.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'
import { hostPorts } from '../../support/host-env'
import { asPartName } from '../../../src/identity'
import type { PmiThreadHole } from '../../../src/api/pmi/types'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(hostPorts('node'), 'brep', { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

const SCRIPT = `
let part0 = cad.box(40, 40, 20)
part0 = cad.fai_drill(part0, {
  position: [20, 20, 20],
  direction: 'z',
  holeType: 'tapped',
  screwSpecIdx: 5,
  depth: 16,
  threadDepth: 14,
  threadClass: '6H',
})
part0.setName(cad.formatThreadHole(cad.pmiThreads(part0)[0]))
`

describe('攻丝孔 PMI — 脚本面端到端', () => {
  it('ExecutionResult.pmi 里能读到螺纹孔（底孔 + 螺纹）', async () => {
    const result = await exec(SCRIPT)
    expect(result.failedAt).toBeUndefined()
    const entry = result.pmi?.find((p) => String(p.part) === 'part0')
    expect(entry, 'part0 应有 PMI 条目').toBeDefined()
    const tap = entry!.items.find((i) => i.kind === 'threadHole') as PmiThreadHole | undefined
    expect(tap).toBeDefined()
    expect(tap!.pilot).toEqual({ diameter: 5, depth: 16 })
    expect(tap!.thread.nominalDiameter).toBe(6)
    expect(tap!.thread.toleranceClass).toBe('6H')
    expect(tap!.thread.depth).toBe(14)
    expect(tap!.process).toBe('tapped')
  })

  it('脚本内 cad.pmiThreads / cad.formatThreadHole 可用（两类信息一起显示）', async () => {
    const result = await exec(SCRIPT)
    expect(result.failedAt).toBeUndefined()
    const shape = result.outputs.get(asPartName('part0'))
    expect(shape).toBeDefined()
    const meta = (shape as { meta?: { name?: string } }).meta
    expect(meta?.name).toBe('M6-6H ↓14（底孔 Φ5 ↓16，攻丝）')
  })
})
