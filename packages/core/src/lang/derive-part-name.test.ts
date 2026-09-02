/**
 * derivePartName — 变量名自动推导规格测试（code 文本形态，IR 剥离阶段 0）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.7
 * 修订：3d_editor docs/plans/2026-08-28-ir-strip-source-code-generation-plan.md §4.2（B2 修正）
 * 修订：keep-syntax 设计 §4（2026-08-28）——命名与保留信息解耦，**一律新名**
 * （R1 readonly 入参、R2 复用名已删；任何 callee 都分配新名 partN）。
 *
 * 定位：**命名服务单测（生成侧）**——derivePartName 仅供 UI/AI/CLI 生成代码文本时调用，
 * parser 不调用（2026-08-28 命名分层修复后，parser 只做语法分析、保留词法变量名）。
 *
 * IR 剥离后唯一形态：入参为 `{ inputCount, outputCount, code }`——
 * 宿主无 IR，统一传当前代码文本，faijs 内部扫描已用 partN。无 callee 字段
 * （命名不依赖任何函数元数据）。
 *
 * 命名规则（keep-syntax §4.2）：
 * - R0：无赋值语句 → 无名字
 * - 唯一规则：一律分配新名（drill/group/copy/union/第三方 → 都 new）
 * - R4：多入多出且数量相等（Shape[] 批处理）→ 保持禁用（独立决策）
 */

import { describe, it, expect } from 'vitest'
import { derivePartName, getMaxModelNum } from './allocate-id'
import type { StatementIR } from './types'
import { asPartName } from '../identity'

// ── 辅助构造 ──

/** 构造"已有这些 partN 输出"的代码文本（词法扫描只认 partN 标识符） */
function codeWith(...partNames: string[]): string {
  return partNames.map((n) => `let ${n} = cad.box({ size: 1 })`).join('\n')
}

/** 构造一条有 outputs 的语句（getMaxModelNum 仍为 statements 形态，faijs 内部服务） */
function stmtWithOutputs(outputs: string[]): StatementIR {
  return {
    id: `s${outputs.length}` as never,
    callee: 'box',
    args: {},
    inputs: [],
    outputs: outputs.map((o) => asPartName(o)),
    hasAssignment: true,
  }
}

describe('derivePartName: R0 — 无赋值语句', () => {
  it('do_assemble (outputCount=0) → behavior=new, names=[]', () => {
    const result = derivePartName({
      inputCount: 0,
      outputCount: 0,
      code: codeWith('part0'),
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([])
  })
})

describe('derivePartName: 一律新名（keep-syntax §4.2，R1/R2 复用名已删）', () => {
  it('drill（消费性单入单出）→ new, names=[partN]', () => {
    const result = derivePartName({
      inputCount: 1,
      outputCount: 1,
      code: codeWith('part0'),
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part1')])
  })

  it('copy → new, names=[partN]', () => {
    const result = derivePartName({
      inputCount: 1,
      outputCount: 1,
      code: codeWith('part0'),
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part1')])
  })

  it('group（无位置输入）→ new, names=[partN]', () => {
    const result = derivePartName({
      inputCount: 0,
      outputCount: 1,
      code: codeWith('part0', 'part1'),
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part2')])
  })

  it('assembly（无位置输入）→ new, names=[partN]', () => {
    const result = derivePartName({
      inputCount: 0,
      outputCount: 1,
      code: '',
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part0')])
  })

  it('union（多入单出）→ new, names=[partN]', () => {
    const result = derivePartName({
      inputCount: 2,
      outputCount: 1,
      code: codeWith('part0', 'part1'),
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part2')])
  })

  it('split（单入多出）→ new, names=[partN, part(N+1)]', () => {
    const result = derivePartName({
      inputCount: 1,
      outputCount: 2,
      code: codeWith('part0'),
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part1'), asPartName('part2')])
  })
})

describe('derivePartName: 未知函数 → 一律新名（默认消费语义不影响命名）', () => {
  it('未知函数 inputCount=1, outputCount=1 → new, names=[partN]', () => {
    const result = derivePartName({
      inputCount: 1,
      outputCount: 1,
      code: codeWith('part0'),
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part1')])
  })

  it('未知函数 inputCount=0, outputCount=1 → new, names=[partN]', () => {
    const result = derivePartName({
      inputCount: 0,
      outputCount: 1,
      code: '',
    })
    expect(result.behavior).toBe('new')
    expect(result.names).toEqual([asPartName('part0')])
  })
})

describe('derivePartName: R4 — 等量多入多出 → 禁用（抛错）', () => {
  it('R4: myBatch (inputCount=2, outputCount=2) → throws', () => {
    expect(() =>
      derivePartName({
        inputCount: 2,
        outputCount: 2,
        code: '',
      }),
    ).toThrow()
  })
})

describe('derivePartName: partN 递增（code 词法扫描）', () => {
  it('多个已有 partN 时 N 递增正确', () => {
    // 新名应为 part3
    const result = derivePartName({
      inputCount: 0,
      outputCount: 1,
      code: codeWith('part0', 'part1', 'part2'),
    })
    expect(result.names).toEqual([asPartName('part3')])
  })

  it('split 多输出连续递增', () => {
    const result = derivePartName({
      inputCount: 1,
      outputCount: 2,
      code: codeWith('part0'),
    })
    expect(result.names).toEqual([asPartName('part1'), asPartName('part2')])
  })

  it('输入/args 中出现的 partN 也计入（不只 outputs 行）', () => {
    const code = [
      'let part0 = cad.box({ size: 1 })',
      'let part5 = cad.cylinder({ diameter: 2, height: 3 })',
      'part0 = cad.fai_drill(part0, { diameter: 1 })',
    ].join('\n')
    const result = derivePartName({
      inputCount: 0,
      outputCount: 1,
      code,
    })
    expect(result.names).toEqual([asPartName('part6')])
  })

  it('非 partN 变量名（grp0 等）不影响模型号', () => {
    const code = [
      'let part0 = cad.box({ size: 1 })',
      "let grp0 = cad.group({ name: 'G', members: [part0] })",
    ].join('\n')
    const result = derivePartName({
      inputCount: 0,
      outputCount: 1,
      code,
    })
    expect(result.names).toEqual([asPartName('part1')])
  })
})

describe('getMaxModelNum: 从 statements 扫描最大模型号（faijs 内部服务，statements 形态）', () => {
  it('空语句列表 → -1', () => {
    expect(getMaxModelNum([])).toBe(-1)
  })

  it('单语句 part0 → 0', () => {
    expect(getMaxModelNum([stmtWithOutputs(['part0'])])).toBe(0)
  })

  it('多语句取最大值', () => {
    expect(getMaxModelNum([
      stmtWithOutputs(['part0']),
      stmtWithOutputs(['part1', 'part2']),
    ])).toBe(2)
  })
})
