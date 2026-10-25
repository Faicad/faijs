/**
 * operator-dim-semantics — 算子级量纲语义（2026-10-25，阶段 1）
 *
 * 锁两条常开规则（`checkOperatorDimSemantics`）：
 * - 规则 P：`**` 的指数必须无量纲（`26.0 ** MM` → E_DIM_MISMATCH）
 * - 规则 B：`+` / `-` 不得一侧裸数字、另侧带量纲（`10 + MM` → E_DIM_MISMATCH）
 *
 * 以及同批的 R2 收窄 + 0 例外：
 * - length/mass/time 槽位的裸数字按基本单位读（`cad.box(20, 20, 20)` 合法）
 * - angle 槽位必须显式带单位；折叠后是 0 的值在任何槽位放行
 *
 * 关键接线：这两条规则走 `extractMetadata` 的常开 pass，`execute()`（不传 opDims）
 * 与 `check()`（传 opDims）必须**同时**报错 —— 见最后两组用例。
 */
import { describe, it, expect } from 'vitest'
import { extractMetadata, type OpDimMap } from '../../src/lang/metadata-extractor'
import { ParseError } from '../../src/lang/parse-error'
import { createRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts, EventSink } from '../../src/cad-runtime/ports'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
}

function makeRuntime() {
  const ports: HostPorts = { events: new TestEventSink() }
  return createRuntime(ports)
}

/** 扁平代码（会被 extractMetadata 包进 export default）→ { ok, code, line, message }。 */
function check(code: string, opDims?: OpDimMap): { ok: boolean; code?: string; line?: number; message?: string } {
  try {
    extractMetadata(code, { opDims })
    return { ok: true }
  } catch (err) {
    if (!(err instanceof ParseError)) throw err
    return { ok: false, code: err.code, line: err.line, message: err.message }
  }
}

/** 假 op：box（length×3，位置形态）+ rot（angle 对象形态）+ 一个单角度槽。 */
const opDims: OpDimMap = {
  'cad.box': {
    paramDims: { width: 'length', depth: 'length', height: 'length' },
    slotMap: { keys: ['width', 'depth', 'height'] },
  },
  'cad.rot': {
    paramDims: { angles: 'angle', angle: 'angle' },
  },
}

// ── 规则 P：`**` 的指数必须无量纲 ──

describe('规则 P — "**" 的指数必须无量纲', () => {
  it('声明 rhs 里的 `26.0 ** MM` → E_DIM_MISMATCH，行号为用户行号', () => {
    const r = check('const zz = 26.0 ** MM')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    // 扁平代码会包一层 export default；行号必须扣掉封装偏移（= 用户编辑器行号）
    expect(r.line).toBe(1)
    expect(r.message).toContain('exponent of "**" must be dimensionless, got length')
    expect(r.message).toContain('26.0 ** MM')
  })

  it('op 实参位置的 `2 ** MM` 也报', () => {
    const r = check('let p0 = cad.box(2 ** MM, 20 * MM, 30 * MM)')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    expect(r.message).toContain('exponent of "**" must be dimensionless')
  })

  it('`2 ** (3 * MM)` 与 `MM ** MM` 报（指数侧带量纲）', () => {
    expect(check('const a = 2 ** (3 * MM)').code).toBe('E_DIM_MISMATCH')
    expect(check('const a = MM ** MM').code).toBe('E_DIM_MISMATCH')
  })

  it('`2 ** 3` / `2 ** 0.5` / `MM ** 2` 通过（指数无量纲）', () => {
    expect(check('const k = 2 ** 3').ok).toBe(true)
    expect(check('const k = 2 ** 0.5').ok).toBe(true)
    // 结果 mm² 无法用单个 DimName 表达 → 与 MM*MM 同策略放行（见方案 §4.3）
    expect(check('const k = MM ** 2').ok).toBe(true)
  })

  it('指数是变量 → 静态不可判 → 放行（R5）', () => {
    expect(check('const k = 3\nconst a = 2 ** k').ok).toBe(true)
  })

  it('指数折叠后是 0 → 放行（0 例外，指数侧同样适用）', () => {
    expect(check('const a = 2 ** (0 * MM)').ok).toBe(true)
  })
})

// ── 规则 B：`+` / `-` 不得裸数字混量纲 ──

describe('规则 B — "+"/"-" 不得一侧裸数字一侧带量纲', () => {
  it('`const a = 10 + MM` → E_DIM_MISMATCH', () => {
    const r = check('const a = 10 + MM')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    expect(r.line).toBe(1)
    expect(r.message).toContain('"+" mixes a bare number with a length')
  })

  it('`MM + 10` / `10 * MM - 5` / `10 * MM + 5` 都报', () => {
    expect(check('const a = MM + 10').code).toBe('E_DIM_MISMATCH')
    expect(check('const a = 10 * MM - 5').code).toBe('E_DIM_MISMATCH')
    expect(check('const a = 10 * MM + 5').code).toBe('E_DIM_MISMATCH')
  })

  it('`10 + 5` / `10 * MM + 5 * MM` 通过', () => {
    expect(check('const a = 10 + 5').ok).toBe(true)
    expect(check('const a = 10 * MM + 5 * MM').ok).toBe(true)
  })

  it('任一侧推不出量纲 → 放行（R5：`x + 5`）', () => {
    expect(check('const x = 5\nconst y = x + 5').ok).toBe(true)
  })

  it('裸数字那侧折叠后是 0 → 放行（0 例外）', () => {
    expect(check('const a = 0 + MM').ok).toBe(true)
    expect(check('const a = 10 * MM - 0').ok).toBe(true)
  })

  it('两侧都带量纲但不同 → 仍由 checkDim 的 mismatch 路径报，规则 B 不抢报', () => {
    const r = check('let p0 = cad.box(10 * MM + 5 * DEGREE, 20 * MM, 30 * MM)', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    // checkDim 的既有文案（不是规则 B 的 "mixes a bare number"）
    expect(r.message).toContain('dimension mismatch in expression')
    expect(r.message).not.toContain('mixes a bare number')
  })

  it('不级联：`10 + MM + 5` 只报内层 `10 + MM`', () => {
    const r = check('const a = 10 + MM + 5')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('"10 + MM"')
    expect(r.message).not.toContain('"10 + MM + 5"')
  })
})

// ── 位置覆盖（声明 rhs / op 实参 / if 条件） ──

describe('位置覆盖 — 整棵 AST 单遍，不只看 op 实参', () => {
  it('op 实参里的 `10 + MM` 由规则 B 报（不是被 checkDim 顺手拦下）', () => {
    const r = check('let p0 = cad.box(10 + MM, 20 * MM, 30 * MM)', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    expect(r.message).toContain('"+" mixes a bare number with a length')
  })

  it('if 条件里的 `10 + MM` 也报（控制流块不经过 checkDim）', () => {
    const r = check('if (10 + MM > 5) {\n  const k = 1\n}\nconst p0 = cad.box(10 * MM, 10 * MM, 10 * MM)')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    expect(r.message).toContain('"+" mixes a bare number with a length')
  })
})

// ── R2 收窄：裸数字按基本单位读 ──

describe('R2 收窄 — length 槽位裸数字合法（默认 mm）', () => {
  it('`cad.box(20, 20, 20)` 通过（永久放行）', () => {
    expect(check('let p0 = cad.box(20, 20, 20)', opDims).ok).toBe(true)
  })

  it('对象形态 `{ width: 10, depth: 10, height: 10 }` 通过', () => {
    expect(check('let p0 = cad.box({ width: 10, depth: 10, height: 10 })', opDims).ok).toBe(true)
  })

  it('负裸数字与 `-10 * MM` 都通过', () => {
    expect(check('let p0 = cad.box(-10, -10, -10)', opDims).ok).toBe(true)
    expect(check('let p0 = cad.box(-10 * MM, -10 * MM, -10 * MM)', opDims).ok).toBe(true)
  })

  it('量的量纲不符（45 * DEGREE 落在 length 槽位）仍然报 E_DIM_MISMATCH', () => {
    const r = check('let p0 = cad.box(45 * DEGREE, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
  })
})

// ── angle 槽位：必须显式带单位，0 例外 ──

describe('angle 槽位 — 必须显式带单位，0 放行', () => {
  it('`angles: [45, 0, 0]` → E_DIM_BARE_NUMBER（角度缺单位）', () => {
    const r = check('const p0 = 0\nlet q = cad.rot(p0, { angles: [45, 0, 0] })', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
    expect(r.message).toContain('angle slot')
    // 扁平代码报错行号必须扣掉封装偏移：错误在用户第 2 行，不是 acorn 的第 3 行
    expect(r.line).toBe(2)
  })

  it('`angles: [45 * DEGREE, 0, 0]` 通过（0 走例外）', () => {
    expect(check('const p0 = 0\nlet q = cad.rot(p0, { angles: [45 * DEGREE, 0, 0] })', opDims).ok).toBe(true)
  })

  it('`angles: [0, 0, 0]` 通过（全 0 数组，0 例外必须按折叠判）', () => {
    expect(check('const p0 = 0\nlet q = cad.rot(p0, { angles: [0, 0, 0] })', opDims).ok).toBe(true)
  })

  it('`angles: [tilt, 0, 0]` 通过（首元素是变量 → 数组层推不出量纲，逐元素 0 走例外）', () => {
    expect(check('const tilt = 30\nconst p0 = 0\nlet q = cad.rot(p0, { angles: [tilt, 0, 0] })', opDims).ok).toBe(true)
  })

  it('单角度槽 `angle: 45` 报、`angle: 0` 与 `angle: 45 * DEGREE` 通过', () => {
    expect(check('const p0 = 0\nlet q = cad.rot(p0, { angle: 45 })', opDims).code).toBe('E_DIM_BARE_NUMBER')
    expect(check('const p0 = 0\nlet q = cad.rot(p0, { angle: 0 })', opDims).ok).toBe(true)
    expect(check('const p0 = 0\nlet q = cad.rot(p0, { angle: 45 * DEGREE })', opDims).ok).toBe(true)
  })

  it('0 例外不限角度：`0 * DEGREE` 落在 length 槽位也放行', () => {
    expect(check('let p0 = cad.box(0 * DEGREE, 20 * MM, 30 * MM)', opDims).ok).toBe(true)
  })

  it('`cad.box(0, 0, 0)` 通过', () => {
    expect(check('let p0 = cad.box(0, 0, 0)', opDims).ok).toBe(true)
  })
})

// ── 端到端：check() 与 execute() 两条路径同时生效 ──

describe('接线 — check() 与 execute() 同一判据', () => {
  const bad = `// apiVersion: 1
export default async (cad) => {
  const zz = 26.0 ** MM
  const p0 = cad.box(26.0 * MM, 20.5 * MM, zz)
  return { shape: p0 }
}`

  const good = `// apiVersion: 1
export default async (cad) => {
  const zz = 26.0 * MM
  const p0 = cad.box(26.0 * MM, 20.5 * MM, zz)
  return { shape: p0 }
}`

  it('check() 拦下 `**`（stage=dimension）', () => {
    const r = makeRuntime().check(bad)
    expect(r.ok).toBe(false)
    expect(r.errors[0].stage).toBe('dimension')
    expect(r.errors[0].code).toBe('E_DIM_MISMATCH')
    expect(r.errors[0].line).toBe(3)
  })

  it('execute() 也拦下 `**`（execute 不传 opDims，靠常开 pass）', async () => {
    const rt = makeRuntime()
    await expect(rt.execute(bad)).rejects.toMatchObject({ code: 'E_DIM_MISMATCH' })
  })

  it('对照组：`26.0 * MM` 正常执行', async () => {
    const rt = makeRuntime()
    const result = await rt.execute(good)
    expect(result.outputs.size).toBeGreaterThan(0)
  })

  it('execute() 也拦下 `10 + MM`', async () => {
    const rt = makeRuntime()
    const code = `export default async (cad) => {
  const w = 10 + MM
  const p0 = cad.box(w, 20 * MM, 30 * MM)
  return { shape: p0 }
}`
    await expect(rt.execute(code)).rejects.toMatchObject({ code: 'E_DIM_MISMATCH' })
  })

  it('execute() 接受 length 裸数字（`cad.box(20, 20, 20)`）', async () => {
    const rt = makeRuntime()
    const code = `export default async (cad) => {
  const p0 = cad.box(20, 20, 20)
  return { shape: p0 }
}`
    const result = await rt.execute(code)
    expect(result.outputs.size).toBeGreaterThan(0)
  })
})
