/**
 * var-dim-env — 变量量纲环境（2026-10-25，阶段 2）
 *
 * 阶段 1 修掉了「表达式节点内部」的量纲错误，但跨语句的变量中转是黑洞：
 * `inferDim(Identifier)` 一律返回 `null`（R5 放行），于是
 *
 *   const tilt = 45
 *   cad.rotate_euler(p0, { angles: [tilt, 0, 0] })   // 角度缺单位，静默通过
 *
 *   const a = 10 * MM
 *   cad.rotate_euler(p0, { angles: [a, 0, 0] })      // 长度当角度用，静默通过
 *
 * 阶段 2 给 `inferDim` 接一个声明顺序填充的环境 `Map<name, DimName | 'bare'>`，
 * 让上面两类在 **check 与 execute 两条路径**都被拦下（execute 侧依赖阶段 3：
 * `runtime.ts` 的三处 extractMetadata 也传 `opDims`）。
 *
 * 刻意**不做**（见方案 §4.3，属阶段 4）：`Math.sqrt(4 * MM)` 这类调用返回量纲不可知、
 * `MM * MM` 复合量纲、`1 / MM`。
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

/** 扁平代码 → { ok, code, line, message }。 */
function check(code: string, opDims?: OpDimMap): { ok: boolean; code?: string; line?: number; message?: string } {
  try {
    extractMetadata(code, { opDims })
    return { ok: true }
  } catch (err) {
    if (!(err instanceof ParseError)) throw err
    return { ok: false, code: err.code, line: err.line, message: err.message }
  }
}

/** 假 op：box（length×3，位置形态）+ rot（angle 对象形态）。 */
const opDims: OpDimMap = {
  'cad.box': {
    paramDims: { width: 'length', depth: 'length', height: 'length' },
    slotMap: { keys: ['width', 'depth', 'height'] },
  },
  'cad.rot': {
    paramDims: { angles: 'angle', angle: 'angle' },
  },
}

/** 两条路径都跑：check()（web 门禁）+ execute()（小程序），断言同一个错误码。 */
async function bothPaths(code: string): Promise<{ check: string; execute: string }> {
  const runtime = () => createRuntime({ events: new TestEventSink() } as HostPorts)
  const wrapped = `export default async (cad) => {\n${code.replace(/^/gm, '  ')}\n  return { shape: p0 }\n}`
  const c = runtime().check(wrapped)
  const checkCode = c.ok ? 'OK' : String(c.errors[0]?.code)
  let executeCode = 'OK'
  try {
    await runtime().execute(wrapped)
  } catch (err) {
    executeCode = err instanceof ParseError ? String(err.code) : 'THROW'
  }
  return { check: checkCode, execute: executeCode }
}

// ── 收益 1：变量把「裸数字」带进角度槽位 ──

describe('收益 1 — 裸数字经变量进入角度槽位', () => {
  it('const tilt = 45 → angles: [tilt, 0, 0] → E_DIM_BARE_NUMBER', () => {
    const r = check('const p0 = 0\nconst tilt = 45\nlet q = cad.rot(p0, { angles: [tilt, 0, 0] })', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
    expect(r.message).toContain('angle slot')
  })

  it('const tilt = 45 直接当 angle 槽（非数组）→ E_DIM_BARE_NUMBER', () => {
    const r = check('const p0 = 0\nconst tilt = 45\nlet q = cad.rot(p0, { angle: tilt })', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('环境不读未来：先用后声明 → 引用检查先拦（E_REFERENCE），不是按后文声明反推量纲', () => {
    // 先引用 `tilt`、后声明它：脚本本身非法，引用检查先拦。
    // 关键断言是**错误码不是量纲码** —— 说明槽位判据用的是"声明到此刻为止"的环境，
    // 没有拿后文的 `const tilt = 45` 去反推前面那一行。
    const r = check('const p0 = 0\nlet q = cad.rot(p0, { angle: tilt })\nconst tilt = 45', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_REFERENCE')
  })
})

// ── 收益 2：量纲错经变量中转（阶段 1 的最大漏口） ──

describe('收益 2 — 带错量纲的值经变量进入槽位', () => {
  it('const a = 10 * MM → angles: [a, 0, 0] → E_DIM_MISMATCH', () => {
    const r = check('const p0 = 0\nconst a = 10 * MM\nlet q = cad.rot(p0, { angles: [a, 0, 0] })', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    expect(r.message).toContain('expected angle')
  })

  it('const a = 10 * MM → angle: a（标量角度槽）→ E_DIM_MISMATCH', () => {
    const r = check('const p0 = 0\nconst a = 10 * MM\nlet q = cad.rot(p0, { angle: a })', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
  })

  it('链式传递：a 带量纲 → b = a → 角度槽 → E_DIM_MISMATCH', () => {
    const r = check('const p0 = 0\nconst a = 10 * MM\nconst b = a\nlet q = cad.rot(p0, { angle: b })', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
  })

  it('角度值经变量进入长度槽 → E_DIM_MISMATCH（反方向同样拦）', () => {
    const r = check('const t = 30 * DEGREE\nlet b = cad.box(t, 20 * MM, 20 * MM)', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
  })

  it('`**` 的指数经变量带量纲 → E_DIM_MISMATCH（规则 P 也吃环境）', () => {
    const r = check('const k = 3 * MM\nconst v = 2 ** k', opDims)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_MISMATCH')
    expect(r.message).toContain('dimensionless')
  })
})

// ── 收益 3：比较运算补进 inferDim（R6 文档/实现不一致） ──

describe('收益 3 — 比较运算的量纲是 bare', () => {
  it('const flag = (10 * MM) < (20 * MM) → 量纲已判定为 bare，角度槽报 E_DIM_BARE_NUMBER', () => {
    // 若比较运算仍落 default → null，环境里就没有 flag，角度槽会按 R5 放行。
    // 报错即证明 inferDim 认了 ComparisonExpression 且结果为无量纲。
    const r = check(
      'const p0 = 0\nconst flag = (10 * MM) < (20 * MM)\nlet q = cad.rot(p0, { angle: flag })',
      opDims,
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('`===` / `>` 同样判为 bare', () => {
    for (const op of ['===', '>', '>=', '!==']) {
      const r = check(
        `const p0 = 0\nconst flag = (10 * MM) ${op} (20 * MM)\nlet q = cad.rot(p0, { angle: flag })`,
        opDims,
      )
      expect(r.code, op).toBe('E_DIM_BARE_NUMBER')
    }
  })
})

// ── 不误伤：合法写法必须继续通过 ──

describe('不误伤 — 合法的变量中转继续通过', () => {
  it('const a = 10 * MM 用在 length 槽 → ok', () => {
    expect(check('const a = 10 * MM\nlet b = cad.box(a, 20 * MM, 20 * MM)', opDims).ok).toBe(true)
  })

  it('const w = 10（裸数字）用在 length 槽 → ok（裸数字 = mm）', () => {
    expect(check('const w = 10\nlet b = cad.box(w, 20, 20)', opDims).ok).toBe(true)
  })

  it('const a = 10 * MM；const c = a * 2（长度×纯数 = 长度）→ length 槽 ok', () => {
    expect(check('const a = 10 * MM\nconst c = a * 2\nlet b = cad.box(c, 20, 20)', opDims).ok).toBe(true)
  })

  it('const a = 10 * MM；const half = a / 2 → length 槽 ok', () => {
    expect(check('const a = 10 * MM\nconst half = a / 2\nlet b = cad.box(half, 20, 20)', opDims).ok).toBe(true)
  })

  it('const t = 30 * DEGREE → angle 槽 ok', () => {
    expect(check('const p0 = 0\nconst t = 30 * DEGREE\nlet q = cad.rot(p0, { angle: t })', opDims).ok).toBe(true)
  })

  it('变量存在但量纲不可知（op 输出）仍是 R5 放行', () => {
    // 未声明标识符会被 SEC_FREE_IDENT 先拦，测不到 R5；op 输出的量纲要靠 retDim
    // （阶段 4，全仓 0 处声明），今天属于"知不道"，必须放行而不是猜一个。
    expect(check('const b = cad.box(10, 10, 10)\nconst p0 = 0\nlet q = cad.rot(p0, { angle: b })').ok).toBe(true)
  })

  it('0 例外优先：const ZERO = 0 → angle: ZERO → ok', () => {
    expect(check('const p0 = 0\nconst ZERO = 0\nlet q = cad.rot(p0, { angle: ZERO })', opDims).ok).toBe(true)
  })
})

// ── 两条路径（check 与 execute 同时生效） ──

describe('两条路径一致（execute 也传 opDims）', () => {
  // 注：bothPaths 走真实 runtime，所以用真实 op 名（rotate_euler 的 angles 是 angle 槽），
  // 而不是上面假 opDims 里的 `cad.rot`。
  // 阶段 2 落地时收益只在 check 路径（execute() 不传 opDims）；阶段 3（2026-10-25）把
  // opDims 接到 execute/append/update 三处后，两条路径给出同一个错误码。
  it('const a = 10 * MM → 角度槽：check 与 execute 都报 E_DIM_MISMATCH', async () => {
    const r = await bothPaths(
      'const p0 = cad.box(20 * MM, 20 * MM, 20 * MM)\nconst a = 10 * MM\nconst q = cad.rotate_euler(p0, { angles: [a, a, a] })',
    )
    expect(r.check).toBe('E_DIM_MISMATCH')
    expect(r.execute).toBe('E_DIM_MISMATCH')
  })

  it('const tilt = 45 → 角度槽：check 与 execute 都报 E_DIM_BARE_NUMBER', async () => {
    const r = await bothPaths(
      'const p0 = cad.box(20 * MM, 20 * MM, 20 * MM)\nconst tilt = 45\nconst q = cad.rotate_euler(p0, { angles: [tilt, 0, 0] })',
    )
    expect(r.check).toBe('E_DIM_BARE_NUMBER')
    expect(r.execute).toBe('E_DIM_BARE_NUMBER')
  })
})
