/**
 * keep.test — keep-syntax 统一内外 keep 机制验收测试（设计 §9 验收提纲）
 *
 * 设计文档：docs/plans/2026-08-28-keep-syntax-design.md
 *
 * 覆盖：
 * - 编译层剥离（§7.1）：keep/keepHidden 发射前剥离，hasArgs 顺序硬要求
 * - statementKey 排除 keep（§7.2）：仅 keep 变化零重算
 * - parse → codegen → parse 往返（§7.3）：含 keep/keepHidden 逐位守恒
 * - 运行时消费判定（§3）：C0 调用点 / C1 函数体 / C5 默认消费 + hidden（D1/D2）
 * - 第三方（§3.2）：C1 函数体 exec.keep、C5 未声明默认消费、C3 非几何输出不消费
 * - 优先级（§2.4）：调用点覆盖函数体
 * - activeValues / 第三方 compound（§5）：非几何进 activeValues、不进 terminals
 * - check 静态校验（§7.4）+ E4 拼写 warning
 * - 增量 keep 持久（§2.2）：缓存命中保留上一轮记录
 */

import { describe, it, expect } from 'vitest'
import { CadRuntime } from './runtime'
import type { HostPorts } from './ports'
import { parseScript } from '../lang/parser'
import { compileToModule } from '../lang/compile'
import { scriptIRToCode } from '../lang/codegen'
import { computeLeafTerminals } from './terminal-dag'
import { ModuleExecutor } from './module-executor'
import { createInternalStdlib } from '@faicad/faijs-stdlib/internal-stdlib'
import { isCompoundLike } from '../shape'
import type { InternalKeepRecord } from '../lang/keep'
import { asPartName, type PartName } from '../identity'
import type { StatementIR, ScriptIR, ArgIR } from '../lang/types'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 编译一段 .faijs 文本，返回 script + 编译产物。 */
function compileText(text: string) {
  const { script } = parseScript(text)
  return { script, ...compileToModule(script) }
}

/** 构造一条语句（terminal-dag 静态测试用）。inputs/outputs 接受裸字符串（自动品牌化）。 */
function makeStmt(
  over: { id: string; callee: string } & Omit<Partial<StatementIR>, 'id' | 'callee' | 'inputs' | 'outputs' | 'args'> & {
    inputs?: (string | PartName)[]
    outputs?: (string | PartName)[]
    args?: Record<string, unknown>
  },
): StatementIR {
  return {
    id: over.id as never,
    callee: over.callee,
    args: (over.args ?? {}) as Record<string, ArgIR>,
    inputs: (over.inputs ?? []).map((s) => asPartName(String(s))),
    outputs: (over.outputs ?? []).map((s) => asPartName(String(s))),
    hasAssignment: over.hasAssignment ?? true,
    receiver: over.receiver,
    outputKeys: over.outputKeys,
  }
}

/** VarRefIR 构造辅助（terminal-dag 静态测试用）。 */
function varRef(name: string): ArgIR {
  return { $ref: asPartName(name) } as ArgIR
}

function makeScript(statements: StatementIR[]): ScriptIR {
  return { params: [], statements }
}

// ── 编译层（P5：§7.1 剥离 + §7.2 statementKey + §7.3 往返） ──

describe('keep: 编译层剥离（设计 §7.1）', () => {
  it('cad.union(a,b,{keep:[a,b]}) → ns.cad.union(ctx.a, ctx.b)（剥离后空 args 槽）', () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.box({ size: [5, 5, 5] })
      const part2 = await cad.union(part0, part1, { keep: [part0, part1] })
    `)
    expect(code).toContain('ctx.part2 = await ns.cad.union(ctx.part0, ctx.part1)')
    expect(code).not.toContain('keep')
  })

  it('cad.copy(a,{keep:[a]}) → ns.cad.copy(ctx.a)（copy 无 params 槽）', () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.copy(part0, { keep: [part0] })
    `)
    expect(code).toContain('ctx.part1 = await ns.cad.copy(ctx.part0)')
    expect(code).not.toContain('keep')
  })

  it('drill 剥离 keep/keepHidden，其余 params 保留', () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.drill(part0, { diameter: 8, keep: ['part0'], keepHidden: true })
    `)
    expect(code).toContain('ctx.part1 = await ns.cad.drill(ctx.part0, { diameter: 8 })')
    expect(code).not.toContain('keepHidden')
    expect(code).not.toContain('keep')
  })

  it('逐条目 {shape, hidden} 形态同样剥离', () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.box({ size: [5, 5, 5] })
      const part2 = await cad.union(part0, part1, { keep: [{ shape: part0, hidden: true }] })
    `)
    expect(code).toContain('ctx.part2 = await ns.cad.union(ctx.part0, ctx.part1)')
  })
})

describe('keep: statementKey 排除 keep（设计 §7.2，零几何重算）', () => {
  it('仅 keep 变化 → computeKey 不变', () => {
    const { script, statements } = compileText(`
      const part0 = await cad.box({ size: 20 })
      const part1 = await cad.drill(part0, { diameter: 8 })
    `)
    const executor = new ModuleExecutor({ cad: createInternalStdlib() })
    executor.setCompiled(script, statements)
    const drillMeta = statements[statements.length - 1]
    const drillStmt = script.statements[script.statements.length - 1]

    const k1 = executor.computeKey(drillMeta, drillStmt)
    const k2 = executor.computeKey(drillMeta, {
      ...drillStmt,
      args: { diameter: 8, keep: ['part0'], keepHidden: true },
    })
    expect(k1).toBe(k2)
  })

  it('keep 剥离后仍与无 keep 版本逐位一致', () => {
    const a = compileText(`const part0 = await cad.box({ size: 20 })`)
    const b = compileText(`const part0 = await cad.box({ size: 20, keep: ['part0'] })`)
    // box 的 args 剥离 keep 后相同 → 发射一致
    expect(a.code).toContain('ctx.part0 = await ns.cad.box({ size: 20 })')
    expect(b.code).toContain('ctx.part0 = await ns.cad.box({ size: 20 })')
  })
})

describe('keep: parse → codegen → parse 往返（设计 §7.3，含 keep/keepHidden）', () => {
  it('keep 数组（标识符 + 字符串）与 keepHidden 往返守恒', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 5 })',
      'let part2 = cad.union(part0, part1, { keep: [part0, "part1"], keepHidden: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const regenerated = scriptIRToCode(script)
    const reparsed = parseScript(regenerated).script
    expect(reparsed.statements.length).toBe(script.statements.length)
    const orig = script.statements[2]
    const again = reparsed.statements[2]
    expect(JSON.stringify(again.args.keep)).toBe(JSON.stringify(orig.args.keep))
    expect(again.args.keepHidden).toBe(true)
  })
})

// ── 运行时消费判定（§3，executeCode mesh 模式） ──

describe('keep: 运行时消费判定（设计 §3）', () => {
  it('回归锚点：无任何 keep 声明的消费性 op → 输入被消费，只有产物是终端', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0] })',
    ].join('\n'))
    expect(result.terminals.map((t) => String(t.id))).toEqual(['part1'])
    expect(result.terminals[0].hidden).toBeUndefined()
  })

  it('cad.union(a,b) → a、b 是终端且 hidden（内置 exec.keepHidden 生效）', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 5 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))
    const byId = new Map(result.terminals.map((t) => [String(t.id), t]))
    expect([...byId.keys()].sort()).toEqual(['part0', 'part1', 'part2'])
    expect(byId.get('part0')!.hidden).toBe(true)
    expect(byId.get('part1')!.hidden).toBe(true)
    expect(byId.get('part2')!.hidden).toBeUndefined()
  })

  it('cad.group({members:[a,b]}) → a、b 是终端且可见（函数体 exec.keep 生效）', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 5 })',
      'let grp0 = cad.group({ name: "G", members: [part0, part1] })',
    ].join('\n'))
    const byId = new Map(result.terminals.map((t) => [String(t.id), t]))
    expect([...byId.keys()].sort()).toEqual(['grp0', 'part0', 'part1'])
    expect(byId.get('part0')!.hidden).toBeUndefined()
    expect(byId.get('part1')!.hidden).toBeUndefined()
    // group 产物是 compound 终端（kind 登记）
    expect(byId.get('grp0')!.kind).toBe('compound')
  })

  it('cad.copy(a) → a 是终端（函数体 exec.keep 生效）', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.copy(part0)',
    ].join('\n'))
    expect(result.terminals.map((t) => String(t.id)).sort()).toEqual(['part0', 'part1'])
  })

  it('cad.drill(c, {keep:["c"]}) → c 是终端（调用点覆盖无声明的函数）', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0], keep: ["part0"] })',
    ].join('\n'))
    const byId = new Map(result.terminals.map((t) => [String(t.id), t]))
    expect([...byId.keys()].sort()).toEqual(['part0', 'part1'])
    expect(byId.get('part0')!.hidden).toBeUndefined()
  })

  it('cad.drill(c, {keep:["c"], keepHidden:true}) → c hidden', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0], keep: ["part0"], keepHidden: true })',
    ].join('\n'))
    const t = result.terminals.find((t) => String(t.id) === 'part0')!
    expect(t).toBeDefined()
    expect(t.hidden).toBe(true)
  })

  it('优先级：调用点 keepHidden 覆盖函数体 exec.keep（用户胜，D1）', async () => {
    // group 函数体 exec.keep 声明成员可见；调用点 keepHidden:true → 成员隐藏
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 5 })',
      'let grp0 = cad.group({ name: "G", members: [part0, part1], keep: ["part0", "part1"], keepHidden: true })',
    ].join('\n'))
    const t = result.terminals.find((t) => String(t.id) === 'part0')!
    expect(t.hidden).toBe(true)
  })

  it('hidden 最后一次保留声明胜出（D2）：union 隐藏后 group 改可见', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 5 })',
      'let part2 = cad.union(part0, part1)',
      'let grp0 = cad.group({ name: "G", members: [part0, part1] })',
    ].join('\n'))
    const t0 = result.terminals.find((t) => String(t.id) === 'part0')!
    // group 的 exec.keep（可见）压过 union 的 exec.keepHidden（隐藏）
    expect(t0.hidden).toBeUndefined()
  })
})

// ── 第三方（§3.2：C1 函数体 keep / C5 默认消费 / C3 非几何输出） ──

describe('keep: 第三方函数（C1/C3/C5，terminal-dag 静态判定）', () => {
  const boxScript = (): ScriptIR => makeScript([
    makeStmt({ id: 's1', callee: 'box', args: { size: 20 }, outputs: ['part0'] }),
    makeStmt({ id: 's2', callee: 'box', args: { size: 5 }, outputs: ['part1'] }),
    makeStmt({
      id: 's3',
      callee: 'mech.makeGroup',
      args: { members: [{ $ref: 'part0' }, { $ref: 'part1' }] },
      inputs: [],
      outputs: ['grp0'],
    }),
  ])
  const allShapeNames = new Set([asPartName('part0'), asPartName('part1'), asPartName('grp0')])

  it('C1：第三方 makeGroup 函数体 exec.keep → a、b 是终端', () => {
    // 模拟 ModuleExecutor.internalKeep 登记（第三方库函数体内 exec.keep(...members)）
    const internal: InternalKeepRecord = {
      kept: new Set([asPartName('part0'), asPartName('part1')]),
      hidden: new Map(),
    }
    const view = { value: () => undefined, internalKeep: () => internal }
    const terminals = computeLeafTerminals(boxScript(), allShapeNames, view)
    expect(terminals.map((t) => String(t.id)).sort()).toEqual(['grp0', 'part0', 'part1'])
  })

  it('C5：第三方 makeGroup 未声明 keep → a、b 被消费（契约：保留必须显式声明）', () => {
    const view = { value: () => undefined, internalKeep: () => undefined }
    const terminals = computeLeafTerminals(boxScript(), allShapeNames, view)
    expect(terminals.map((t) => String(t.id))).toEqual(['grp0'])
  })

  it('C3：第三方测量函数（返回非几何）不消费输入', () => {
    const script = makeScript([
      makeStmt({ id: 's1', callee: 'box', args: { size: 20 }, outputs: ['part0'] }),
      makeStmt({ id: 's2', callee: 'mech.measure', args: { of: [varRef('part0')] }, inputs: [asPartName('part0')], outputs: [asPartName('m')] }),
    ])
    // shapeVarNames 只含 part0（m 是 number，非几何）
    const terminals = computeLeafTerminals(script, new Set([asPartName('part0')]))
    expect(terminals.map((t) => String(t.id))).toEqual(['part0'])
  })

  it('isCompoundLike：结构识别第三方未注册 compound（D5）', () => {
    expect(isCompoundLike({ kind: 'compound', children: [] })).toBe(true)
    expect(isCompoundLike({ kind: 'compound' })).toBe(false)
    expect(isCompoundLike({ positions: new Float32Array(), indices: new Uint32Array() })).toBe(false)
    expect(isCompoundLike(null)).toBe(false)
    expect(isCompoundLike(42)).toBe(false)
  })
})

// ── activeValues / outputs 含 compound（§5，executeCode mesh 模式） ──

describe('keep: activeValues 与 outputs 含 compound（设计 §5）', () => {
  it('查询函数（返回非几何值）→ 进 activeValues、不进 terminals；输入不被消费（C3）', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let c = cad.bboxCenter(part0)',
    ].join('\n'))
    // c = [x,y,z] 是普通数组（非几何）→ activeValues
    const c = result.activeValues?.get(asPartName('c')) as number[] | undefined
    expect(Array.isArray(c)).toBe(true)
    expect(c!.length).toBe(3)
    // c 不进 terminals；part0 不被 bboxCenter 消费（C3）→ 仍是终端
    expect(result.terminals.map((t) => String(t.id))).toEqual(['part0'])
  })

  it('group 产物（compound）进 outputs（keep-syntax §5.1 契约）', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let grp0 = cad.group({ name: "G", members: [part0] })',
    ].join('\n'))
    const grp = result.outputs.get(asPartName('grp0'))
    expect(grp).toBeDefined()
    expect(isCompoundLike(grp)).toBe(true)
    expect(result.compounds?.get(asPartName('grp0'))).toEqual([asPartName('part0')])
  })
})

// ── check 静态校验（§7.4 + E4） ──

describe('keep: check() 静态校验（设计 §7.4）', () => {
  it('合法 keep → ok', () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = rt.check([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0], keep: ["part0"], keepHidden: true })',
    ].join('\n'))
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('keep 元素不是变量引用（字面量）→ stage=keep 报错', () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = rt.check([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0], keep: [42] })',
    ].join('\n'))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.stage === 'keep')).toBe(true)
  })

  it('keep 目标不是本语句 inputs/args 变量 → 报错', () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = rt.check([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0], keep: ["part9"] })',
    ].join('\n'))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.stage === 'keep' && e.message.includes('part9'))).toBe(true)
  })

  it('keepHidden 非 boolean → 报错', () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = rt.check([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0], keep: ["part0"], keepHidden: "yes" })',
    ].join('\n'))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.stage === 'keep')).toBe(true)
  })

  it('E4：keep 拼写错误（keeps）→ warning 而非 error', () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    const result = rt.check([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.translate(part0, { offset: [1, 0, 0], keeps: ["part0"] })',
    ].join('\n'))
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.includes('keep-prefixed'))).toBe(true)
  })
})

// ── 增量 keep 持久（§2.2：缓存命中保留上一轮记录） ──

describe('keep: 增量执行 keep 持久（设计 §2.2）', () => {
  it('union 未重跑（缓存命中）时 internalKeep 仍生效', async () => {
    const rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createInternalStdlib() })
    await rt.execute([
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 5 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))

    // append 一条新语句；union（s3）缓存命中不重跑 → 上轮 keepHidden 记录保留
    const result = await rt.append('let part3 = cad.translate(part2, { offset: [1, 0, 0] })')

    const byId = new Map(result.terminals.map((t) => [String(t.id), t]))
    expect(byId.get('part0')!.hidden).toBe(true)
    expect(byId.get('part1')!.hidden).toBe(true)
    // part2 被 translate 消费 → 非终端；part3 是新终端
    expect(byId.get('part2')).toBeUndefined()
    expect(byId.get('part3')).toBeDefined()
  })
})
