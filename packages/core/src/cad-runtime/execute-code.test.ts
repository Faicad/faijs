/**
 * execute / append / update — 代码文本执行入口对照测试
 *
 * 契约：公开执行入口输入一律是代码文本；引擎内部解析文本为 IR 后执行。
 * 三种形态与 IR 内部版本（executeIR/appendIR/updateIR）产出一致：
 * ① execute(code) 全量（对照 executeIR(parseScript(code).script)）
 * ② append(code, newIds) 增量（对照 appendIR(script, newIds)）
 * ③ append 子集语义：newIds 可指定输出变量名（partN），无匹配报错
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

describe('execute(code): 全量形态与 IR 内部版本对照', () => {
  it('同一代码文本，outputs 内容 key 一致', async () => {
    const { script } = parseScript(CODE)
    const baseline = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const baselineResult = await baseline.executeIR(script)

    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const codeResult = await codeRt.execute(CODE)

    expect(await resultFingerprint(codeRt, codeResult))
      .toEqual(await resultFingerprint(baseline, baselineResult))
    expect(codeResult.terminals.map((t) => t.id))
      .toEqual(baselineResult.terminals.map((t) => t.id))
  })
})

describe('append(code, newIds): 增量形态与 IR 内部版本对照', () => {
  it('先执行前两条，再 append 第三条 → 与全量结果一致', async () => {
    const { script } = parseScript(CODE)
    const firstTwo = script.statements.slice(0, 2)
    const appendId = asStmtId(String(script.statements[2].id))

    // baseline：executeIR 前两条 + appendIR 第三条
    const baseline = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const baselineResult1 = await baseline.executeIR({ ...script, statements: firstTwo })
    expect(baselineResult1.outputs.has(asPartName('part2'))).toBe(false)
    const baselineResult2 = await baseline.appendIR(script, [appendId])

    // 公开入口：execute 前两条代码 + append 第三条
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    await codeRt.execute(CODE.split('\n').slice(0, 2).join('\n'))
    const codeResult = await codeRt.append(CODE, [appendId])

    expect(await resultFingerprint(codeRt, codeResult))
      .toEqual(await resultFingerprint(baseline, baselineResult2))
    expect(codeResult.outputs.has(asPartName('part2'))).toBe(true)
  })
})

describe('append 子集语义（newIds 指定输出变量名）', () => {
  it('newIds 可用输出变量名（partN）指定', async () => {
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await codeRt.append(CODE, [asPartName('part1')])
    expect(result.outputs.has(asPartName('part1'))).toBe(true)
  })

  it('newIds 无匹配 → 报错（不静默空执行）', async () => {
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    await expect(codeRt.append(CODE, [asPartName('part99')])).rejects.toThrow()
  })

  it('非法代码 → ParseError 直接抛出（宿主可见）', async () => {
    const codeRt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    await expect(codeRt.execute('let part0 = cad.box(')).rejects.toThrow()
  })
})
