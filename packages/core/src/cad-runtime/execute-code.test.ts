/**
 * executeCode — 源代码执行入口对照测试（IR 剥离阶段 0，行为零变化闸门）
 *
 * 设计文档：3d_editor docs/plans/2026-08-28-ir-strip-source-code-generation-plan.md §4.2（B6 修正）
 *
 * 契约：同一代码文本，三种形态与现有 execute/append 产出一致：
 * ① 无 stmtIds → 全量（对照 runtime.execute(parseScript(code).script)）
 * ② stmtIds + incremental → 增量（对照 runtime.append(script, ids)）
 * ③ stmtIds 子集 → 过滤后全流水线（对照 runtime.execute(过滤后 script)）
 *
 * 用 mesh 模式（不依赖 occt-wasm 初始化，manifold 路径快速执行）。
 */

import { describe, it, expect } from 'vitest'
import { CadRuntime } from './runtime'
import { createInternalStdlib } from '@faicad/faijs-stdlib/internal-stdlib'
import type { HostPorts } from './ports'
import { parseScript } from '../lang/parser'
import { asStmtId, asPartName } from '../identity'
import { computeContentKey } from './content-key'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const CODE = [
  'let part0 = cad.box({ size: 20 })',
  'let part1 = cad.sphere({ radius: 10 })',
  'let part2 = cad.union(part0, part1)',
].join('\n')

/** 归一化结果：terminals 的 outputs 内容 key 集合（几何一致性判定） */
async function resultFingerprint(rt: CadRuntime, result: Awaited<ReturnType<CadRuntime['execute']>>) {
  const keys: string[] = []
  for (const [name, shape] of result.outputs) {
    // keep-syntax §5.1：outputs 含 compound（无 mesh，无法算内容 key）——跳过
    if (!('positions' in shape) || !('indices' in shape)) continue
    keys.push(`${name}:${computeContentKey(shape.positions, shape.indices)}`)
  }
  keys.sort()
  return keys
}

describe('executeCode: 全量形态与 runtime.execute 对照', () => {
  it('同一代码文本，outputs 内容 key 一致', async () => {
    const { script } = parseScript(CODE)
    const baseline = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const baselineResult = await baseline.execute(script)

    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const codeResult = await codeRt.executeCode(CODE)

    expect(await resultFingerprint(codeRt, codeResult))
      .toEqual(await resultFingerprint(baseline, baselineResult))
    expect(codeResult.terminals.map((t) => t.id))
      .toEqual(baselineResult.terminals.map((t) => t.id))
  })
})

describe('executeCode: 增量形态（incremental）与 runtime.append 对照', () => {
  it('先执行前两条，再 append 第三条 → 与全量结果一致', async () => {
    const { script } = parseScript(CODE)
    const firstTwo = script.statements.slice(0, 2)
    const appendId = asStmtId(String(script.statements[2].id))

    // baseline：execute 前两条 + append 第三条
    const baseline = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const baselineResult1 = await baseline.execute({ ...script, statements: firstTwo })
    expect(baselineResult1.outputs.has(asPartName('part2'))).toBe(false)
    const baselineResult2 = await baseline.append(script, [appendId])

    // executeCode：全量前两条代码 + incremental append 第三条
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    await codeRt.executeCode(CODE.split('\n').slice(0, 2).join('\n'))
    const codeResult = await codeRt.executeCode(CODE, { stmtIds: [appendId], incremental: true })

    expect(await resultFingerprint(codeRt, codeResult))
      .toEqual(await resultFingerprint(baseline, baselineResult2))
    expect(codeResult.outputs.has(asPartName('part2'))).toBe(true)
  })
})

describe('executeCode: 子集形态与过滤后 execute 对照', () => {
  it('stmtIds=[s3]（union）只执行子集，依赖缺失时按现有 execute 语义暴露（双方一致失败）', async () => {
    const { script } = parseScript(CODE)
    // baseline：宿主现状 executePart 形态——过滤出语句子集直接 execute
    const subset = script.statements.filter((s) => s.id === script.statements[2].id)
    const baseline = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const baselineRun = baseline.execute({ ...script, statements: subset })

    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const codeRun = codeRt.executeCode(CODE, { stmtIds: [script.statements[2].id] })

    // 依赖（part0/part1）不在 ctx → union 失败；executeCode 与 baseline 行为一致
    await expect(baselineRun).rejects.toThrow()
    await expect(codeRun).rejects.toThrow()
  })

  it('stmtIds 可用输出变量名（partN）指定', async () => {
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await codeRt.executeCode(CODE, { stmtIds: [asPartName('part1')] })
    expect(result.outputs.has(asPartName('part1'))).toBe(true)
  })

  it('stmtIds 无匹配 → 报错（不静默空执行）', async () => {
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    await expect(codeRt.executeCode(CODE, { stmtIds: [asPartName('part99')] })).rejects.toThrow(/no statement matches/)
  })

  it('非法代码 → ParseError 直接抛出（宿主可见）', async () => {
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    await expect(codeRt.executeCode('let part0 = cad.box(')).rejects.toThrow()
  })
})
