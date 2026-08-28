/**
 * terminal-dag-symbol — 符号表驱动的 consumes() 规格测试（阶段 0，红）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.8
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §2.3
 *
 * `consumes()` 是阶段 3 才实现的纯函数（实施文档 §5.5）。
 * 本测试按目标签名写，阶段 0 必须红（编译失败/断言失败均可接受）。
 * 阶段 3 实现后转绿。
 *
 * 符号表示例（设计文档 §4.6）：
 *   copy     → { readonlyPositions: [0] }
 *   group    → { readonlyPaths: ['members'] }
 *   assembly → { readonlyPaths: ['members'] }
 *   drill    → {} (无 readonly 标注)
 *   split    → {} (无 readonly 标注)
 *   未知函数  → undefined (默认消费)
 */

import { describe, it, expect } from 'vitest'
import { consumes } from './terminal-dag'
import type { StatementIR, ArgIR } from '../lang/types'
import { asPartName, asStmtId } from '../identity'

// ── 辅助构造 ──

/** 构造一条消费性语句（用于 consumes 判定） */
function makeStmt(opts: {
  callee: string
  inputs?: string[]
  args?: Record<string, unknown>
  refs?: string[]
  receiver?: string
}): StatementIR {
  return {
    id: asStmtId('s1'),
    callee: opts.callee,
    args: (opts.args ?? {}) as Record<string, ArgIR>,
    inputs: (opts.inputs ?? []).map((s) => asPartName(s)),
    outputs: [],
    refs: opts.refs,
    receiver: opts.receiver ? asPartName(opts.receiver) : undefined,
    hasAssignment: false,
  }
}

/** VarRefIR 构造辅助 */
function varRef(name: string): ArgIR {
  return { $ref: asPartName(name) } as ArgIR
}

/** CallRefIR 构造辅助 */
function callRef(callee: string, args: ArgIR[]): ArgIR {
  return { $call: { callee, args } } as ArgIR
}

describe('consumes: §4.8 效果对照表六例', () => {
  // 1. part1 = cad.copy(part0) → copy 入参 readonly → 不消费 part0
  it('copy(part0) 不消费 part0 (readonlyPositions=[0])', () => {
    const stmt = makeStmt({
      callee: 'copy',
      inputs: ['part0'],
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
  })

  // 2. part0 = cad.drill(part0, ...) → drill 无 readonly → 消费 part0
  it('drill(part0, ...) 消费 part0 (无 readonly 标注)', () => {
    const stmt = makeStmt({
      callee: 'drill',
      inputs: ['part0'],
      args: { diameter: 5 },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })

  // 3. {front, back} = cad.split(part0, ...) → split 消费 part0
  it('split(part0, ...) 消费 part0 (无 readonly 标注)', () => {
    const stmt = makeStmt({
      callee: 'split',
      inputs: ['part0'],
      args: { normal: [0, 0, 1], offset: 0 },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })

  // 4. g = cad.group({ members: [part0, part1] }) → members 路径 readonly → 不消费
  it('group({ members: [part0, part1] }) 不消费 part0 (readonlyPaths=["members"])', () => {
    const stmt = makeStmt({
      callee: 'group',
      args: {
        members: [varRef('part0'), varRef('part1')],
      },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
    expect(consumes(stmt, asPartName('part1'))).toBe(false)
  })

  // 5. cad.drill(part0, { at: cad.faceCenter(part2) }) → part2 在嵌套调用内 → 不消费
  it('drill(part0, { at: cad.faceCenter(part2) }) 不消费 part2 (嵌套调用内=只读查询)', () => {
    const stmt = makeStmt({
      callee: 'drill',
      inputs: ['part0'],
      args: {
        at: callRef('faceCenter', [varRef('part2')]),
        depth: 2,
      },
    })
    expect(consumes(stmt, asPartName('part2'))).toBe(false)
  })

  // 6. x = myLib.clone(part0)（未知 callee）→ 默认消费
  it('myLib.clone(part0) 消费 part0 (未知函数=默认消费)', () => {
    const stmt = makeStmt({
      callee: 'myLib.clone',
      inputs: ['part0'],
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })
})

describe('consumes: 边界与组合', () => {
  it('assembly({ members: [part0] }) 不消费 part0 (readonlyPaths=["members"])', () => {
    const stmt = makeStmt({
      callee: 'assembly',
      args: {
        members: [varRef('part0')],
      },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
  })

  it('drill(part0, { at: cad.faceCenter(part2) }) 仍消费 part0 (位置输入非 readonly)', () => {
    const stmt = makeStmt({
      callee: 'drill',
      inputs: ['part0'],
      args: {
        at: callRef('faceCenter', [varRef('part2')]),
      },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })

  it('group({ members: [part0] }) 不消费 part0, 但 group 的非 members 路径中出现的 part0 消费', () => {
    // 假设 group 有一个非 readonly 的参数引用了 part0
    const stmt = makeStmt({
      callee: 'group',
      args: {
        members: [varRef('part1')],   // members 路径 readonly → 不消费 part1
        extra: varRef('part0'),        // 非 members 路径 → 消费 part0
      },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
    expect(consumes(stmt, asPartName('part1'))).toBe(false)
  })

  it('变量不在 stmt 中引用 → false', () => {
    const stmt = makeStmt({
      callee: 'drill',
      inputs: ['part0'],
      args: { diameter: 5 },
    })
    expect(consumes(stmt, asPartName('part99'))).toBe(false)
  })

  it('CallRefIR 嵌套多层也不消费', () => {
    // drill(part0, { at: cad.faceCenter(cad.bboxCenter(part2)) })
    const stmt = makeStmt({
      callee: 'drill',
      inputs: ['part0'],
      args: {
        at: callRef('faceCenter', [
          callRef('bboxCenter', [varRef('part2')]),
        ]),
      },
    })
    expect(consumes(stmt, asPartName('part2'))).toBe(false)
  })
})

describe('consumes: receiver (member method calls) — 修正：原地修改不消费', () => {
  it('do_assemble on receiver "grp1" does NOT consume grp1 (compound 原地修改，仍作为终端)', () => {
    const stmt = makeStmt({
      callee: 'do_assemble',
      receiver: 'grp1',
    })
    expect(consumes(stmt, asPartName('grp1'))).toBe(false)
  })

  it('add_constraint on receiver "asm1" does NOT consume asm1 (compound 原地修改，仍作为终端)', () => {
    const stmt = makeStmt({
      callee: 'add_constraint',
      receiver: 'asm1',
      args: { type: 'face_mate' },
    })
    expect(consumes(stmt, asPartName('asm1'))).toBe(false)
  })

  it('do_assemble on receiver "grp1" does NOT consume unrelated variable', () => {
    const stmt = makeStmt({
      callee: 'do_assemble',
      receiver: 'grp1',
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
  })

  it('add_constraint 右侧 args 中的输入 shape 仍按 readonly 规则判定消费', () => {
    // 设计 §4.8：仅函数调用的输入 shape 被消费；receiver 自身不被消费。
    // 这里 asm1 是 receiver（不消费），part0 作为 args 中的普通引用应被消费。
    const stmt = makeStmt({
      callee: 'add_constraint',
      receiver: 'asm1',
      args: { target: varRef('part0') },
    })
    expect(consumes(stmt, asPartName('asm1'))).toBe(false) // receiver 不消费
    expect(consumes(stmt, asPartName('part0'))).toBe(true)  // 右侧输入 shape 消费
  })
})
