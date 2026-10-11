/**
 * dim-check — 静态量纲校验端到端测试（error 模式）。
 *
 * 验证 `cad.sketch` 注册 `sketchDimSpec()` 后（默认 error 模式）：
 * 1. 裸数字长度字段 → E_DIM_BARE_NUMBER 错误（阻断执行）
 * 2. 带单位字面量 → 无错误
 * 3. 角度/计数/布尔字段 → 无错误（bare 合法）
 * 4. cad.box 裸数字 → 仍然报错
 */
import { describe, it, expect } from 'vitest'
import { extractMetadata, type OpDimMap } from '@faicad/faijs/lang/metadata-extractor'
import { sketchDimSpec } from '../src/dim-spec.js'

/** opDims：sketch（error 模式 + spec）+ box（error 模式 + paramDims）。 */
const opDims: OpDimMap = {
  'cad.sketch': { spec: sketchDimSpec() },
  'cad.box': {
    paramDims: { width: 'length', depth: 'length', height: 'length' },
    slotMap: { keys: ['width', 'depth', 'height'] },
  },
}

/** 提取元数据，返回 { ok, dimWarnings, errorCode }。 */
function check(code: string): { ok: boolean; dimWarnings: string[]; errorCode?: string } {
  try {
    const meta = extractMetadata(code, { opDims })
    return {
      ok: true,
      dimWarnings: (meta.dimWarnings ?? []).map((w) => w.message),
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    return { ok: false, dimWarnings: [], errorCode: code }
  }
}

function sketchCode(body: string): string {
  return `export default async (cad) => {\n  ${body}\n  return { shape: s }\n}`
}

describe('sketch dim-check — error mode (bare numbers)', () => {
  it('rect w/d bare → E_DIM_BARE_NUMBER', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "rect", w: 100, d: 50 }] })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('rect w/d with units → ok, no errors', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "rect", w: 100 * MM, d: 50 * MM }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('circle r bare → E_DIM_BARE_NUMBER', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 }] })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('circle r with unit → ok, no errors', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('arc cx/cy/r bare → E_DIM_BARE_NUMBER; a0/a1 bare → no error (angle)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "arc", cx: 0, cy: 0, r: 50, a0: 0, a1: 1.5 }] })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('arc with units → ok', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "arc", cx: 0 * MM, cy: 0 * MM, r: 50 * MM, a0: 0 * DEGREE, a1: 90 * DEGREE }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('polygon n bare → no error (count); r bare → E_DIM_BARE_NUMBER', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "polygon", n: 6, r: 50 }] })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('polygon n bare + r with unit → ok', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "polygon", n: 6, r: 50 * MM }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('line from/to bare → E_DIM_BARE_NUMBER (length pairs)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "line", from: [10, 20], to: [30, 40] }] })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('line from/to with units → ok', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "line", from: [10 * MM, 20 * MM], to: [30 * MM, 40 * MM] }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('close ref bare → no error (string)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "close", ref: "g1" }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })
})

describe('sketch dim-check — constraints', () => {
  it('length constraint value bare → E_DIM_BARE_NUMBER', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], constraints: [{ kind: "length", of: { tag: "g1" }, value: 100 }] })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('angle constraint value bare → E_DIM_BARE_NUMBER (angle is dimensioned)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], constraints: [{ kind: "angle", a: { tag: "g1" }, b: { tag: "g2" }, value: 1.5 }] })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('angle constraint value with unit → ok, no errors', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], constraints: [{ kind: "angle", a: { tag: "g1" }, b: { tag: "g2" }, value: 90 * DEGREE }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('length constraint value with unit → ok, no errors', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], constraints: [{ kind: "length", of: { tag: "g1" }, value: 100 * MM }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })
})

describe('sketch dim-check — plane', () => {
  it('plane string → ok, no errors', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], plane: "XZ" })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('plane origin bare → E_DIM_BARE_NUMBER; normal bare → no error (direction)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], plane: { origin: [10, 20, 30], normal: [0, 1, 0] } })',
    ))
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('plane origin with units, normal bare → ok', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], plane: { origin: [10 * MM, 20 * MM, 30 * MM], normal: [0, 1, 0] } })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })
})

describe('sketch dim-check — box still errors', () => {
  it('cad.box bare numbers → error', () => {
    const result = check(`export default async (cad) => {
  const b = cad.box(20, 20, 20)
  return { shape: b }
}`)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_DIM_BARE_NUMBER')
  })

  it('cad.box with units → ok, no warnings', () => {
    const result = check(`export default async (cad) => {
  const b = cad.box(20 * MM, 20 * MM, 20 * MM)
  return { shape: b }
}`)
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })
})
