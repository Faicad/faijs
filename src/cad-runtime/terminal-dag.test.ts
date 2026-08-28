/**
 * @vitest-environment node
 *
 * terminal-dag — DAG 叶子终端判定单元测试
 *
 * 测试覆盖（§4.1 / §4.2）：
 * - boolean 叶子（box + sphere + subtract → 仅 subtract 终端）
 * - 链式重赋值（part0 = translate(part0) → 仅 1 个终端）
 * - split 双输出
 * - group/assembly 成员保留（compound 不消费成员）
 * - copy 源与副本终端
 * - 显式 return 优先
 *
 * Run: npx vitest run src/cad-runtime/terminal-dag.test.ts
 */

import { describe, it, expect } from 'vitest'
import { computeLeafTerminals, consumes } from './terminal-dag'
import { parseScript } from '../lang/parser'
import type { PartName } from '../identity'
import type { PartScript } from '../lang/types'
import { asPartName } from '../identity'

/** 用 parseScript 从代码构造 PartScript，提取所有 shape 变量名。 */
function parseAndCollectVars(code: string) {
  const { script } = parseScript(code)
  const shapeVarNames = new Set<PartName>()
  for (const stmt of script.statements) {
    for (const out of stmt.outputs) {
      shapeVarNames.add(asPartName(out))
    }
  }
  return { script, shapeVarNames }
}

/** 便捷：parse 代码 → 计算终端 → 返回终端变量名数组。 */
function terminalsFromCode(code: string): string[] {
  const { script, shapeVarNames } = parseAndCollectVars(code)
  const terminals = computeLeafTerminals(script, shapeVarNames)
  return terminals.map(t => t.id)
}

describe('computeLeafTerminals: DAG leaf detection', () => {
  it('boolean: box + sphere + subtract → 仅 subtract 终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.sphere({ radius: 8, center: [5, 0, 0] })
      let part2 = cad.subtract(part0, part1)
    `)
    expect(terminals).toEqual(['part2'])
  })

  it('链式重赋值: part0 = translate(part0) → 仅 1 个终端 (part0 最终值)', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      part0 = cad.translate(part0, { offset: [5, 0, 0] })
    `)
    expect(terminals).toEqual(['part0'])
  })

  it('保名链: part0 = drill(part0) → 仅 part0 终端 (drilled)', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      part0 = cad.drill(part0, { diameter: 5, depth: 10 })
    `)
    expect(terminals).toEqual(['part0'])
  })

  it('非保名: part0 = box; part1 = copy(part0); part1 = drill(part1) → 仅 part1 终端', () => {
    // copy 产出新名 part1，drill 保名复用 part1 → part1 是最终终端
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
      part1 = cad.drill(part1, { diameter: 5, depth: 10 })
    `)
    // part0 被 copy 引用（copy 不消费）→ part0 终端
    // part1 的 lastProducer = drill，其后无消费 → part1 终端
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('group 不消费成员: part0 + part1 → group(part0, part1) → 三者都是终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.sphere({ radius: 8 })
      let part2 = cad.group({ name: 'G', members: ['part0', 'part1'] })
    `)
    expect(terminals.sort()).toEqual(['part0', 'part1', 'part2'])
  })

  it('assembly 不消费成员: part0 + part1 → assembly → 三者都是终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 10 })
      let part1 = cad.box({ size: 10 })
      let part2 = cad.assembly({ name: 'A', members: ['part0', 'part1'] })
    `)
    expect(terminals.sort()).toEqual(['part0', 'part1', 'part2'])
  })

  it('成员方法调用不消费 compound（真实解析: 变量被重命名为 partN）: asm1=assembly(...); asm1.add_constraint(...) → 重命名后的 compound 仍终端', () => {
    // 设计 §4.8：仅函数调用的输入 shape 被消费；receiver（add_constraint/do_assemble）
    // 是原地修改 compound，不应被消费。parser 会把 asm1 重命名为 part1，故终端为 part0 + part1。
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let asm1 = cad.assembly({ members: ['part0'] })
      asm1.add_constraint({ type: 'face_mate' })
    `)
    // assembly 不消费 part0 → part0 终端；add_constraint 不消费 compound → part1（即 asm1）终端
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('do_assemble 成员方法调用同样不消费 compound（重命名后）', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let asm1 = cad.assembly({ members: ['part0'] })
      asm1.do_assemble()
    `)
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('computeLeafTerminals 端到端守卫: receiver 与变量名一致时，成员方法调用不消费 compound', () => {
    // 手工构建命名一致的脚本，真正命中 consumes 的 receiver 分支：
    // S1 产出 asm1；S2 = asm1.add_constraint(...) 的 receiver == 'asm1'。
    // 修复前 consumes(S2,'asm1') 返回 true → asm1 被判消费、从终端消失（[]）；
    // 修复后返回 false → asm1 仍是终端。
    const script = {
      params: [],
      statements: [
        { id: 's1' as never, callee: 'assembly', args: { members: [] }, inputs: [], outputs: [asPartName('asm1')], hasAssignment: true },
        { id: 's2' as never, callee: 'add_constraint', args: { type: 'face_mate' }, inputs: [], outputs: [], hasAssignment: false, receiver: asPartName('asm1') },
      ],
    } as PartScript
    const terminals = computeLeafTerminals(script, new Set<PartName>([asPartName('asm1')]))
    expect(terminals.map(t => t.id)).toEqual(['asm1'])
  })

  it('copy 不消费源: part0=box; part1=copy(part0) → 两者都是终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
    `)
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('copy 一源多副本: part0=box; part1=copy(part0); part2=copy(part0) → 三者都是终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
      let part2 = cad.copy(part0)
    `)
    expect(terminals.sort()).toEqual(['part0', 'part1', 'part2'])
  })

  it('copy 副本被消费: part0=box; part1=copy(part0); part2=drill(part1) → part0 和 part2 终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
      part1 = cad.drill(part1, { diameter: 5 })
    `)
    // part1 被 drill 消费 → 非终端；part0 不被消费（copy 不消费）→ 终端
    // 但 part1 被 re-assign，lastProducer 是 drill，part1 是 drill 的 output
    // part1 (drill) 之后无消费 → part1 是终端
    // 等等——part1 被重新赋值了！lastProducer(part1) = drill
    // 所以 part1 进终端（drilled copy）
    // part0 的 lastProducer = box, 之后 copy(S2) 不消费, drill(S3) refs part1 但不 refs part0
    // 所以 part0 是终端
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('assemble + drill 链: x1=box; x2=assemble(x1); x1=drill(x1) → x1 和 x2 都是终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.assembly({ members: ['part0'] })
      part0 = cad.drill(part0, { diameter: 5 })
    `)
    // part1 (assembly) 的 lastProducer = S2, 之后 S3(drill) refs part0 但不 refs part1 → part1 终端
    // part0 的 lastProducer = S3(drill), 之后无消费 → part0 终端
    // assembly 不消费 part0，所以 part0 不会被 S2 判为被消费
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('单 box 无下游消费 → 单终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
    `)
    expect(terminals).toEqual(['part0'])
  })

  it('三个独立原语互不消费 → 3 个终端', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.sphere({ radius: 8 })
      let part2 = cad.cylinder({ radius: 5, height: 20 })
    `)
    expect(terminals.sort()).toEqual(['part0', 'part1', 'part2'])
  })
})

describe('consumes: 符号表驱动的消费判定（B1 消灭 NON_CONSUMING_OPS）', () => {
  it('group/assembly/copy 是不消费 op（readonly 标注）', () => {
    expect(consumes(
      { id: 's1' as never, callee: 'group', args: { members: [{ $ref: asPartName('s1') }] }, inputs: [], outputs: [], hasAssignment: false },
      asPartName('s1'),
    )).toBe(false)
    expect(consumes(
      { id: 's1' as never, callee: 'assembly', args: { members: [{ $ref: asPartName('s1') }] }, inputs: [], outputs: [], hasAssignment: false },
      asPartName('s1'),
    )).toBe(false)
    expect(consumes(
      { id: 's1' as never, callee: 'copy', args: {}, inputs: [asPartName('s1')], outputs: [], hasAssignment: false },
      asPartName('s1'),
    )).toBe(false)
  })

  it('其它 op 是消费 op（无 readonly 标注）', () => {
    expect(consumes(
      { id: 's1' as never, callee: 'box', args: {}, inputs: [], outputs: [], hasAssignment: false },
      asPartName('part99'),
    )).toBe(false)
    expect(consumes(
      { id: 's1' as never, callee: 'drill', args: { diameter: 5 }, inputs: [asPartName('part0')], outputs: [], hasAssignment: false },
      asPartName('part0'),
    )).toBe(true)
    expect(consumes(
      { id: 's1' as never, callee: 'translate', args: { offset: [1, 0, 0] }, inputs: [asPartName('part0')], outputs: [], hasAssignment: false },
      asPartName('part0'),
    )).toBe(true)
    expect(consumes(
      { id: 's1' as never, callee: 'subtract', args: {}, inputs: [asPartName('part0'), asPartName('part1')], outputs: [], hasAssignment: false },
      asPartName('part0'),
    )).toBe(true)
    expect(consumes(
      { id: 's1' as never, callee: 'split', args: { normal: [0, 0, 1], offset: 0 }, inputs: [asPartName('part0')], outputs: [], hasAssignment: false },
      asPartName('part0'),
    )).toBe(true)
  })
})
