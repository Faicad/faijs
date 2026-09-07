/**
 * host-arg 单元测试 — IR↔Host 双向转换、守卫、显示/字面量辅助
 *
 * 覆盖：
 * - 五变体 IR→Host（$ref/$param/$call/$expr/字面量）
 * - 五变体 Host→IR（反向）
 * - 双向恒等（hostArgToIR(argIRToHost(x)) deepEqual）
 * - 嵌套递归
 * - 保留字规则
 * - 守卫
 * - hostArgToDisplay / hostArgToLiteral
 */

import { describe, it, expect } from 'vitest'
import {
  argIRToHost,
  hostArgToIR,
  isHostVarRef,
  isHostParamRef,
  isHostCallRef,
  isHostRef,
  hostArgToDisplay,
  hostArgToLiteral,
  HOST_REF_KINDS,
} from './host-arg'
import type { HostArg, HostVarRef, HostParamRef, HostCallRef, HostExprRef } from './host-arg'

// ── 五变体 IR→Host ──

describe('IR→Host: 五变体精确转换', () => {
  it('$ref (VarRefIR) → HostVarRef', () => {
    const ir: any = { $ref: 'part0' }
    const host = argIRToHost(ir)
    expect(host).toEqual({ kind: 'var-ref', name: 'part0' })
    expect(isHostVarRef(host)).toBe(true)
  })

  it('$param (ParamRefIR) → HostParamRef', () => {
    const ir: any = { $param: 'hole_diameter' }
    const host = argIRToHost(ir)
    expect(host).toEqual({ kind: 'param-ref', name: 'hole_diameter' })
    expect(isHostParamRef(host)).toBe(true)
  })

  it('$call (CallRefIR) → HostCallRef', () => {
    const ir: any = { $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [10, 10, 0], 4] } }
    const host = argIRToHost(ir) as HostCallRef
    expect(host.kind).toBe('call-ref')
    expect(host.callee).toBe('faceNormal')
    expect(host.args).toEqual([
      { kind: 'var-ref', name: 'part0' },
      [10, 10, 0],
      4,
    ])
    expect(host.namespace).toBeUndefined()
  })

  it('$call with namespace → HostCallRef with namespace', () => {
    const ir: any = { $call: { callee: 'helper', args: [], namespace: 'mech' } }
    const host = argIRToHost(ir) as HostCallRef
    expect(host.namespace).toBe('mech')
  })

  it('$expr (ExprIR) → HostExprRef', () => {
    const ir: any = { $expr: { text: 'base + 20', refs: ['base'], params: [] } }
    const host = argIRToHost(ir) as HostExprRef
    expect(host.kind).toBe('expr-ref')
    expect(host.text).toBe('base + 20')
    expect(host.refs).toEqual(['base'])
    expect(host.params).toEqual([])
  })

  it('字面量 → 原值', () => {
    expect(argIRToHost(42)).toBe(42)
    expect(argIRToHost('hello')).toBe('hello')
    expect(argIRToHost(true)).toBe(true)
    expect(argIRToHost(null)).toBe(null)
  })

  it('数组 → 递归映射', () => {
    const ir: any = [{ $ref: 'part0' }, 5, [10, 20]]
    const host = argIRToHost(ir) as HostArg[]
    expect(host).toEqual([
      { kind: 'var-ref', name: 'part0' },
      5,
      [10, 20],
    ])
  })

  it('普通对象 → 递归映射', () => {
    const ir: any = { corner: { $param: 'w' }, at: [{ $ref: 'p0' }, 5] }
    const host = argIRToHost(ir) as Record<string, HostArg>
    expect(host.corner).toEqual({ kind: 'param-ref', name: 'w' })
    expect(host.at).toEqual([{ kind: 'var-ref', name: 'p0' }, 5])
  })
})

// ── 五变体 Host→IR ──

describe('Host→IR: 五变体精确转换', () => {
  it('HostVarRef → $ref', () => {
    const host: HostVarRef = { kind: 'var-ref', name: 'part0' }
    expect(hostArgToIR(host)).toEqual({ $ref: 'part0' })
  })

  it('HostParamRef → $param', () => {
    const host: HostParamRef = { kind: 'param-ref', name: 'hole_diameter' }
    expect(hostArgToIR(host)).toEqual({ $param: 'hole_diameter' })
  })

  it('HostCallRef → $call', () => {
    const host: HostCallRef = {
      kind: 'call-ref',
      callee: 'faceNormal',
      args: [{ kind: 'var-ref', name: 'part0' }, [10, 10, 0], 4],
    }
    const ir = hostArgToIR(host) as any
    expect(ir).toEqual({
      $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [10, 10, 0], 4] },
    })
  })

  it('HostCallRef with namespace → $call with namespace', () => {
    const host: HostCallRef = {
      kind: 'call-ref',
      callee: 'helper',
      args: [],
      namespace: 'mech',
    }
    const ir = hostArgToIR(host) as any
    expect((ir as { $call: { namespace?: string } }).$call.namespace).toBe('mech')
  })

  it('HostExprRef → $expr', () => {
    const host: HostExprRef = { kind: 'expr-ref', text: 'base + 20', refs: ['base'], params: [] }
    expect(hostArgToIR(host)).toEqual({
      $expr: { text: 'base + 20', refs: ['base'], params: [] },
    })
  })

  it('字面量 → 原值', () => {
    expect(hostArgToIR(42)).toBe(42)
    expect(hostArgToIR('hello')).toBe('hello')
    expect(hostArgToIR(true)).toBe(true)
    expect(hostArgToIR(null)).toBe(null)
  })
})

// ── 双向恒等 ──

describe('双向恒等: hostArgToIR(argIRToHost(x)) deepEqual', () => {
  const cases: { name: string; ir: any }[] = [
    { name: '字面量', ir: 42 },
    { name: '字符串', ir: 'hello' },
    { name: '布尔', ir: true },
    { name: 'null', ir: null },
    { name: '数组', ir: [1, 2, 3] },
    { name: 'var-ref', ir: { $ref: 'part0' } },
    { name: 'param-ref', ir: { $param: 'size' } },
    { name: 'call-ref', ir: { $call: { callee: 'faceNormal', args: [{ $ref: 'part0' }, [1, 2, 3], 4] } } },
    { name: 'call-ref with namespace', ir: { $call: { callee: 'helper', args: [], namespace: 'mech' } } },
    { name: 'expr-ref', ir: { $expr: { text: 'base + 20', refs: ['base'], params: [] } } },
    { name: '嵌套对象', ir: { corner: { $param: 'w' }, at: [{ $ref: 'p0' }, 5] } },
    { name: '嵌套数组', ir: [{ $ref: 'a' }, { $param: 'b' }, [1, 2]] },
    { name: '混合嵌套', ir: { items: [{ $ref: 'x' }, { $call: { callee: 'fn', args: [{ $param: 'n' }] } }] } },
  ]

  for (const c of cases) {
    it(`${c.name}: IR→Host→IR deepEqual`, () => {
      const host = argIRToHost(c.ir)
      const back = hostArgToIR(host)
      expect(back).toEqual(c.ir)
    })
  }

  it('Host→IR→Host deepEqual (var-ref)', () => {
    const host: HostVarRef = { kind: 'var-ref', name: 'part0' }
    const ir = hostArgToIR(host)
    const back = argIRToHost(ir)
    expect(back).toEqual(host)
  })

  it('Host→IR→Host deepEqual (call-ref with nested)', () => {
    const host: HostCallRef = {
      kind: 'call-ref',
      callee: 'faceNormal',
      args: [{ kind: 'var-ref', name: 'part0' }, [10, 10, 0], 4],
    }
    const ir = hostArgToIR(host)
    const back = argIRToHost(ir)
    expect(back).toEqual(host)
  })

  it('Host→IR→Host deepEqual (expr-ref)', () => {
    const host: HostExprRef = { kind: 'expr-ref', text: 'base + 20', refs: ['base'], params: [] }
    const ir = hostArgToIR(host)
    const back = argIRToHost(ir)
    expect(back).toEqual(host)
  })
})

// ── 保留字规则 ──

describe('保留字规则', () => {
  it('{ kind: "var-ref", name: "x" } → HostVarRef (Host→IR 判定为引用)', () => {
    const host: HostArg = { kind: 'var-ref', name: 'x' }
    expect(isHostVarRef(host)).toBe(true)
    expect(hostArgToIR(host)).toEqual({ $ref: 'x' })
  })

  it('{ kind: "other" } → 字面量 (不匹配任何 HostRefKind)', () => {
    const host: HostArg = { kind: 'other' } as HostArg
    expect(isHostRef(host)).toBe(false)
    // Host→IR 对非引用对象递归处理——kind 不在 HOST_REF_KINDS 中
    const ir = hostArgToIR(host)
    expect(ir).toEqual({ kind: 'other' })
  })

  it('{ kind: "var-ref" } without name → 不判定为 HostVarRef (形状不匹配)', () => {
    const host: HostArg = { kind: 'var-ref' } as HostArg
    expect(isHostVarRef(host)).toBe(false)
    expect(isHostRef(host)).toBe(false)
  })

  it('{ kind: "call-ref", callee: "fn" } without args → 不判定为 HostCallRef', () => {
    const host: HostArg = { kind: 'call-ref', callee: 'fn' } as HostArg
    expect(isHostCallRef(host)).toBe(false)
    expect(isHostRef(host)).toBe(false)
  })

  it('HOST_REF_KINDS 包含全部 4 个 kind', () => {
    expect(HOST_REF_KINDS).toEqual(['var-ref', 'param-ref', 'call-ref', 'expr-ref'])
  })
})

// ── 守卫 ──

describe('isHostRef 守卫', () => {
  it('数组 → false', () => {
    expect(isHostRef([1, 2, 3] as HostArg)).toBe(false)
  })

  it('原始值 → false', () => {
    expect(isHostRef(42 as HostArg)).toBe(false)
    expect(isHostRef('hello' as HostArg)).toBe(false)
    expect(isHostRef(true as HostArg)).toBe(false)
    expect(isHostRef(null as HostArg)).toBe(false)
  })

  it('普通对象 (无 kind) → false', () => {
    expect(isHostRef({ size: 20 } as HostArg)).toBe(false)
  })

  it('var-ref → true', () => {
    expect(isHostRef({ kind: 'var-ref', name: 'x' } as HostArg)).toBe(true)
  })

  it('param-ref → true', () => {
    expect(isHostRef({ kind: 'param-ref', name: 'x' } as HostArg)).toBe(true)
  })

  it('call-ref → true', () => {
    expect(isHostRef({ kind: 'call-ref', callee: 'fn', args: [] } as HostArg)).toBe(true)
  })

  it('expr-ref → true', () => {
    expect(isHostRef({ kind: 'expr-ref', text: 'a + b', refs: [], params: [] } as HostArg)).toBe(true)
  })
})

// ── hostArgToDisplay ──

describe('hostArgToDisplay: 五变体显示文本', () => {
  it('字面量 → String(arg)', () => {
    expect(hostArgToDisplay(42)).toBe('42')
    expect(hostArgToDisplay('hello')).toBe('hello')
    expect(hostArgToDisplay(true)).toBe('true')
    expect(hostArgToDisplay(null)).toBe('null')
  })

  it('数组 → [a, b] (递归)', () => {
    expect(hostArgToDisplay([10, 20, 30])).toBe('[10, 20, 30]')
    expect(hostArgToDisplay([{ kind: 'var-ref', name: 'p0' }, 5])).toBe('[p0, 5]')
  })

  it('var-ref → name', () => {
    expect(hostArgToDisplay({ kind: 'var-ref', name: 'part0' })).toBe('part0')
  })

  it('param-ref → name', () => {
    expect(hostArgToDisplay({ kind: 'param-ref', name: 'hole_diameter' })).toBe('hole_diameter')
  })

  it('call-ref → callee(a, b) (递归)', () => {
    const ref: HostCallRef = {
      kind: 'call-ref',
      callee: 'faceNormal',
      args: [{ kind: 'var-ref', name: 'part0' }, [10, 10, 0], 4],
    }
    expect(hostArgToDisplay(ref)).toBe('faceNormal(part0, [10, 10, 0], 4)')
  })

  it('expr-ref → text', () => {
    const ref: HostExprRef = { kind: 'expr-ref', text: 'base + 20', refs: ['base'], params: [] }
    expect(hostArgToDisplay(ref)).toBe('base + 20')
  })

  it('普通对象 → JSON.stringify', () => {
    expect(hostArgToDisplay({ size: 20, depth: 5 })).toBe('{"size":20,"depth":5}')
  })
})

// ── hostArgToLiteral ──

describe('hostArgToLiteral: 引用 → null, 字面量 → 原值', () => {
  it('var-ref → null', () => {
    expect(hostArgToLiteral({ kind: 'var-ref', name: 'part0' })).toBeNull()
  })

  it('param-ref → null', () => {
    expect(hostArgToLiteral({ kind: 'param-ref', name: 'size' })).toBeNull()
  })

  it('call-ref → null', () => {
    expect(hostArgToLiteral({ kind: 'call-ref', callee: 'fn', args: [] })).toBeNull()
  })

  it('expr-ref → null', () => {
    expect(hostArgToLiteral({ kind: 'expr-ref', text: 'a+b', refs: [], params: [] })).toBeNull()
  })

  it('字面量 → 原值', () => {
    expect(hostArgToLiteral(42)).toBe(42)
    expect(hostArgToLiteral('hello')).toBe('hello')
    expect(hostArgToLiteral(true)).toBe(true)
    expect(hostArgToLiteral(null)).toBe(null)
  })

  it('数组 → 原值', () => {
    expect(hostArgToLiteral([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('普通对象 → 原值', () => {
    expect(hostArgToLiteral({ size: 20 })).toEqual({ size: 20 })
  })
})
