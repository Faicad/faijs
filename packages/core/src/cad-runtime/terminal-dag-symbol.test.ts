/**
 * terminal-dag-consumes — keep 驱动的 consumes() 规格测试（keep-syntax 设计 §3）
 *
 * 原符号表驱动的消费判定（B1/NON_CONSUMING_OPS/readonly 标注）已在 keep-syntax
 * P1 删除——消费判定由 keep 统一机制驱动（设计 §3，C0 → C3 → C5 短路）：
 * - C0：调用点 keep 声明 → 不消费
 * - C1：函数体 exec.keep 声明（view.internalKeep）→ 不消费
 * - C3：语句有赋值且所有输出都是非几何 → 不消费任何输入（第三方测量/查询函数）
 * - C5：默认消费（drill/transform/未声明保留的第三方几何函数）
 * - 嵌套调用（CallRefIR）内引用 = 只读查询，不消费
 * - receiver（成员方法调用）不消费 receiver 变量
 *
 * 设计文档：docs/plans/2026-08-28-keep-syntax-design.md §3 / §6
 */

import { describe, it, expect } from 'vitest'
import { consumes, type DagRuntimeView } from './terminal-dag'
import type { StatementIR, ArgIR } from '../lang/types'
import type { InternalKeepRecord } from '../lang/keep'
import { asPartName, asStmtId } from '../identity'

// ── 辅助构造 ──

/** 构造一条消费性语句（用于 consumes 判定） */
function makeStmt(opts: {
  callee: string
  inputs?: string[]
  args?: Record<string, unknown>
  outputs?: string[]
  hasAssignment?: boolean
  receiver?: string
}): StatementIR {
  return {
    id: asStmtId('s1'),
    callee: opts.callee,
    args: (opts.args ?? {}) as Record<string, ArgIR>,
    positional: (opts.inputs ?? []).map((s) => ({ $ref: asPartName(s) })),
    outputs: (opts.outputs ?? []).map((s) => asPartName(s)),
    hasAssignment: opts.hasAssignment ?? true,
    receiver: opts.receiver ? asPartName(opts.receiver) : undefined,
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

/** 运行时视图构造：internalKeep 记录（模拟函数体 exec.keep 登记） */
function viewWith(internal: InternalKeepRecord | undefined): DagRuntimeView {
  return { value: () => undefined, internalKeep: () => internal }
}

describe('consumes: keep 驱动判定（C0/C1/C3/C5 短路）', () => {
  it('C0：调用点 keep 声明 → 不消费（即使 callee 是消费性 drill）', () => {
    const stmt = makeStmt({
      callee: 'fai_drill',
      inputs: ['part0'],
      args: { diameter: 5, keep: [varRef('part0')] },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
  })

  it('C0：keepHidden 不改变"不消费"判定（只影响 hidden）', () => {
    const stmt = makeStmt({
      callee: 'fai_drill',
      inputs: ['part0'],
      args: { diameter: 5, keep: [varRef('part0')], keepHidden: true },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
  })

  it('C1：函数体 exec.keep 声明（view.internalKeep）→ 不消费', () => {
    const internal: InternalKeepRecord = {
      kept: new Set([asPartName('part0')]),
      hidden: new Map(),
    }
    const stmt = makeStmt({
      callee: 'mech.makeGroup',
      inputs: ['part0'],
      args: {},
    })
    expect(consumes(stmt, asPartName('part0'), viewWith(internal))).toBe(false)
  })

  it('C1 缺席（无 view / 无登记）→ 退回 C5 默认消费', () => {
    const stmt = makeStmt({
      callee: 'mech.makeGroup',
      inputs: ['part0'],
      args: {},
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })

  it('C5：drill(part0, ...) 默认消费 part0', () => {
    const stmt = makeStmt({
      callee: 'fai_drill',
      inputs: ['part0'],
      args: { diameter: 5 },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })

  it('C5：split(part0, ...) 消费 part0（位置输入）', () => {
    const stmt = makeStmt({
      callee: 'fai_split',
      inputs: ['part0'],
      args: { normal: [0, 0, 1], offset: 0 },
      outputs: ['front', 'back'],
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })

  it('C5：未知函数默认消费（不依赖签名知识）', () => {
    const stmt = makeStmt({
      callee: 'myLib.clone',
      inputs: ['part0'],
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(true)
  })

  it('C3：语句有赋值且所有输出非几何 → 不消费任何输入（第三方测量函数）', () => {
    const stmt = makeStmt({
      callee: 'mech.measure',
      inputs: ['part0'],
      args: {},
      outputs: ['m'],
    })
    // shapeVarNames 不含 m（m 是 number）→ C3 触发
    expect(consumes(stmt, asPartName('part0'), undefined, new Set([asPartName('part0')]))).toBe(false)
  })

  it('C3 守卫：输出含几何（输出在 shapeVarNames）→ 不触发 C3，走 C5', () => {
    const stmt = makeStmt({
      callee: 'mech.offset',
      inputs: ['part0'],
      args: {},
      outputs: ['part1'],
    })
    // part1 在 shapeVarNames → C3 不触发 → C5 消费
    const shapeVarNames = new Set([asPartName('part0'), asPartName('part1')])
    expect(consumes(stmt, asPartName('part0'), undefined, shapeVarNames)).toBe(true)
  })

  it('C3 守卫：无赋值语句（void op）→ 不触发 C3，走 C5', () => {
    const stmt = makeStmt({
      callee: 'mech.log',
      inputs: ['part0'],
      args: {},
      outputs: [],
      hasAssignment: false,
    })
    expect(consumes(stmt, asPartName('part0'), undefined, new Set([asPartName('part0')]))).toBe(true)
  })
})

describe('consumes: 嵌套调用与 args 引用', () => {
  it('CallRefIR 内引用 = 只读查询，不消费', () => {
    const stmt = makeStmt({
      callee: 'fai_drill',
      inputs: ['part0'],
      args: {
        at: callRef('faceNormal', [varRef('part2')]),
        depth: 2,
      },
    })
    expect(consumes(stmt, asPartName('part2'))).toBe(false)
  })

  it('CallRefIR 嵌套多层也不消费', () => {
    const stmt = makeStmt({
      callee: 'fai_drill',
      inputs: ['part0'],
      args: {
        at: callRef('faceNormal', [
          callRef('bboxCenter', [varRef('part2')]),
        ]),
      },
    })
    expect(consumes(stmt, asPartName('part2'))).toBe(false)
  })

  it('args 中直接出现的 VarRefIR 被消费（非嵌套）', () => {
    const stmt = makeStmt({
      callee: 'fai_drill',
      inputs: ['part0'],
      args: {
        at: varRef('part2'),
      },
    })
    expect(consumes(stmt, asPartName('part2'))).toBe(true)
  })

  it('变量不在 stmt 中引用 → false', () => {
    const stmt = makeStmt({
      callee: 'fai_drill',
      inputs: ['part0'],
      args: { diameter: 5 },
    })
    expect(consumes(stmt, asPartName('part99'))).toBe(false)
  })

  it('字符串 members（非 VarRefIR）不触发消费', () => {
    const stmt = makeStmt({
      callee: 'group',
      args: { members: ['part0'] },
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
  })
})

describe('consumes: receiver（成员方法调用，原地修改不消费）', () => {
  it('do_assemble on receiver "grp1" 不消费 grp1', () => {
    const stmt = makeStmt({
      callee: 'do_assemble',
      receiver: 'grp1',
      hasAssignment: false,
    })
    expect(consumes(stmt, asPartName('grp1'))).toBe(false)
  })

  it('add_constraint on receiver "asm1" 不消费 asm1', () => {
    const stmt = makeStmt({
      callee: 'add_constraint',
      receiver: 'asm1',
      args: { type: 'face_mate' },
      hasAssignment: false,
    })
    expect(consumes(stmt, asPartName('asm1'))).toBe(false)
  })

  it('do_assemble 不消费无关变量', () => {
    const stmt = makeStmt({
      callee: 'do_assemble',
      receiver: 'grp1',
      hasAssignment: false,
    })
    expect(consumes(stmt, asPartName('part0'))).toBe(false)
  })

  it('add_constraint args 中普通引用仍按消费规则判定', () => {
    const stmt = makeStmt({
      callee: 'add_constraint',
      receiver: 'asm1',
      args: { target: varRef('part0') },
      hasAssignment: false,
    })
    expect(consumes(stmt, asPartName('asm1'))).toBe(false) // receiver 不消费
    expect(consumes(stmt, asPartName('part0'))).toBe(true)  // args 普通引用消费
  })
})
