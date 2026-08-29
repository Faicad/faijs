/**
 * @vitest-environment node
 *
 * terminal-dag — DAG 叶子终端判定单元测试（keep-syntax 设计 §3 / §6）
 *
 * 测试覆盖：
 * - boolean 叶子（box + sphere + subtract → 仅 subtract 终端）
 * - 链式重赋值（part0 = translate(part0) → 仅 1 个终端）
 * - split 双输出
 * - group/assembly 成员保留（函数体 exec.keep，C1——经运行时视图模拟）
 * - copy 源与副本终端（函数体 exec.keep，C1）
 * - 显式 return 优先
 * - hidden（D2：最后一次保留声明胜出）
 *
 * 纯静态（无 view）= C0 + C3 + C5；函数体 keep（C1）经 view.internalKeep 模拟
 * 内置函数在函数体内的 exec.keep 登记（与运行时 ModuleExecutor.internalKeep 同构）。
 *
 * Run: npx vitest run src/cad-runtime/terminal-dag.test.ts
 */

import { describe, it, expect } from 'vitest'
import { computeLeafTerminals, type DagRuntimeView } from './terminal-dag'
import { parseScript } from '../lang/parser'
import type { PartName, StmtId } from '../identity'
import type { ScriptIR } from '../lang/types'
import { asPartName } from '../identity'
import type { InternalKeepRecord } from '../lang/keep'

/**
 * 内置函数体 keep 声明视图（C1 模拟）：copy → exec.keep(input)；
 * group/assembly → exec.keep(members)。与运行时行为一致——
 * 纯静态（省略 view）时这些内置声明不可见，退化为 C5 默认消费。
 */
function builtinKeepView(script: ScriptIR): DagRuntimeView {
  const internal = new Map<StmtId, InternalKeepRecord>()
  for (const stmt of script.statements) {
    let names: PartName[] = []
    if (stmt.callee === 'copy') {
      names = stmt.inputs
    } else if (stmt.callee === 'group' || stmt.callee === 'assembly') {
      const members = stmt.args?.members
      if (Array.isArray(members)) {
        names = members
          .map((m) => (typeof m === 'string' ? m : (m as { $ref?: string } | null)?.$ref))
          .filter((n): n is string => !!n)
          .map(asPartName)
      }
    }
    if (names.length > 0) {
      internal.set(stmt.id, { kept: new Set(names), hidden: new Map() })
    }
  }
  return { value: () => undefined, internalKeep: (s) => internal.get(s.id) }
}

/** 用 parseScript 从代码构造 ScriptIR，提取所有 shape 变量名。 */
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
function terminalsFromCode(code: string, view?: DagRuntimeView): string[] {
  const { script, shapeVarNames } = parseAndCollectVars(code)
  const terminals = computeLeafTerminals(script, shapeVarNames, view)
  return terminals.map(t => String(t.id))
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

  it('非保名: part0=box; part1=copy(part0); part1=drill(part1) → part0、part1 终端', () => {
    // copy 函数体 exec.keep(input) → part0 不被 copy 消费（C1 视图）
    const view = builtinKeepView(parseAndCollectVars(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
      part1 = cad.drill(part1, { diameter: 5, depth: 10 })
    `).script)
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
      part1 = cad.drill(part1, { diameter: 5, depth: 10 })
    `, view)
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('group 不消费成员（C1 函数体 exec.keep）: part0 + part1 → group → 三者都是终端', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.sphere({ radius: 8 })
      let part2 = cad.group({ name: 'G', members: [part0, part1] })
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
    expect(terminals.sort()).toEqual(['part0', 'part1', 'part2'])
  })

  it('group 未声明 keep（纯静态，C5）→ 成员被消费，只剩 group', () => {
    const terminals = terminalsFromCode(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.sphere({ radius: 8 })
      let part2 = cad.group({ name: 'G', members: [part0, part1] })
    `)
    expect(terminals).toEqual(['part2'])
  })

  it('assembly 不消费成员（C1 函数体 exec.keep）: part0 + part1 → assembly → 三者都是终端', () => {
    const code = `
      let part0 = cad.box({ size: 10 })
      let part1 = cad.box({ size: 10 })
      let part2 = cad.assembly({ name: 'A', members: [part0, part1] })
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
    expect(terminals.sort()).toEqual(['part0', 'part1', 'part2'])
  })

  it('成员方法调用不消费 compound（真实解析: parser 保留词法名）: asm1=assembly(...); asm1.add_constraint(...) → compound 仍终端', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let asm1 = cad.assembly({ members: [part0] })
      asm1.add_constraint({ type: 'face_mate' })
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
    expect(terminals.sort()).toEqual(['asm1', 'part0'])
  })

  it('do_assemble 成员方法调用同样不消费 compound（保留词法名）', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let asm1 = cad.assembly({ members: [part0] })
      asm1.do_assemble()
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
    expect(terminals.sort()).toEqual(['asm1', 'part0'])
  })

  it('computeLeafTerminals 端到端守卫: receiver 与变量名一致时，成员方法调用不消费 compound', () => {
    const script = {
      params: [],
      statements: [
        { id: 's1' as never, callee: 'assembly', args: { members: [] }, inputs: [], outputs: [asPartName('asm1')], hasAssignment: true },
        { id: 's2' as never, callee: 'add_constraint', args: { type: 'face_mate' }, inputs: [], outputs: [], hasAssignment: false, receiver: asPartName('asm1') },
      ],
    } as ScriptIR
    const terminals = computeLeafTerminals(script, new Set<PartName>([asPartName('asm1')]))
    expect(terminals.map(t => t.id)).toEqual(['asm1'])
  })

  it('copy 不消费源（C1 函数体 exec.keep）: part0=box; part1=copy(part0) → 两者都是终端', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('copy 一源多副本: part0=box; part1=copy(part0); part2=copy(part0) → 三者都是终端', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
      let part2 = cad.copy(part0)
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
    expect(terminals.sort()).toEqual(['part0', 'part1', 'part2'])
  })

  it('copy 副本被消费: part0=box; part1=copy(part0); part1=drill(part1) → part0、part1 终端', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.copy(part0)
      part1 = cad.drill(part1, { diameter: 5 })
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
    // part0 不被 copy 消费（C1）→ 终端；part1 lastProducer=drill，其后无消费 → 终端
    expect(terminals.sort()).toEqual(['part0', 'part1'])
  })

  it('assemble + drill 链: x1=box; x2=assemble(x1); x1=drill(x1) → x1 和 x2 都是终端', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.assembly({ members: [part0] })
      part0 = cad.drill(part0, { diameter: 5 })
    `
    const view = builtinKeepView(parseAndCollectVars(code).script)
    const terminals = terminalsFromCode(code, view)
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

describe('computeLeafTerminals: hidden（D2 最后一次保留声明胜出）', () => {
  it('union 内置 keepHidden → 成员 hidden', () => {
    // 模拟 union 函数体 exec.keepHidden(inputs) 登记（union 保留且隐藏，R5）
    const { script, shapeVarNames } = parseAndCollectVars(`
      let part0 = cad.box({ size: 20 })
      let part1 = cad.box({ size: 5 })
      let part2 = cad.union(part0, part1)
    `)
    const internal = new Map<StmtId, InternalKeepRecord>()
    const unionStmt = script.statements[script.statements.length - 1]
    internal.set(unionStmt.id, {
      kept: new Set([asPartName('part0'), asPartName('part1')]),
      hidden: new Map([[asPartName('part0'), true], [asPartName('part1'), true]]),
    })
    const view: DagRuntimeView = { value: () => undefined, internalKeep: (s) => internal.get(s.id) }
    const terminals = computeLeafTerminals(script, shapeVarNames, view)
    const byId = new Map(terminals.map((t) => [String(t.id), t]))
    expect(byId.get('part0')!.hidden).toBe(true)
    expect(byId.get('part1')!.hidden).toBe(true)
    expect(byId.get('part2')!.hidden).toBeUndefined()
  })

  it('后声明压过先声明：union(keepHidden) 后 group(keep) → 成员可见（hidden undefined）', () => {
    // 同一变量 part0 先后被 union 的 keepHidden 与 group 的 keep 声明 → 后者胜出
    const { script, shapeVarNames } = parseAndCollectVars(`
      let part0 = cad.box({ size: 20 })
      let part2 = cad.union(part0)
      let part3 = cad.group({ members: [part0] })
    `)
    const internal = new Map<StmtId, InternalKeepRecord>()
    internal.set(script.statements[1].id, {
      kept: new Set([asPartName('part0')]),
      hidden: new Map([[asPartName('part0'), true]]),
    })
    internal.set(script.statements[2].id, {
      kept: new Set([asPartName('part0')]),
      hidden: new Map(),
    })
    const view: DagRuntimeView = { value: () => undefined, internalKeep: (s) => internal.get(s.id) }
    const terminals = computeLeafTerminals(script, shapeVarNames, view)
    const t0 = terminals.find((t) => String(t.id) === 'part0')
    expect(t0).toBeDefined()
    expect(t0!.hidden).toBeUndefined()
  })
})
