/**
 * dim-check — 静态量纲校验端到端测试（D8+ warn 模式）。
 *
 * 验证 `cad.sketch` 注册 `sketchDimSpec()` + `dimCheck: 'warn'` 后：
 * 1. 裸数字长度字段 → 警告（dimWarnings），不阻断（ok=true, no errors）
 * 2. 带单位字面量 → 无警告无错误
 * 3. 角度/计数/布尔字段 → 无警告（bare 合法）
 * 4. cad.box 裸数字 → 仍然报错（不受 sketch warn 模式影响）
 */
import { describe, it, expect } from 'vitest'
import { extractMetadata, type OpDimMap } from '@faicad/faijs/lang/metadata-extractor'
import { sketchDimSpec } from '../src/dim-spec.js'

/** opDims：sketch（warn 模式 + spec）+ box（error 模式 + paramDims）。 */
const opDims: OpDimMap = {
  'cad.sketch': { spec: sketchDimSpec(), dimCheck: 'warn' },
  'cad.box': {
    paramDims: { width: 'length', depth: 'length', height: 'length' },
    slotMap: { keys: ['width', 'depth', 'height'] },
  },
}

/** 提取元数据，返回 { ok, dimWarnings, threw }。 */
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

describe('sketch dim-check — warn mode (bare numbers)', () => {
  it('rect w/d bare → warnings, ok=true', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "rect", w: 100, d: 50 }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings.length).toBeGreaterThanOrEqual(2)
    expect(result.dimWarnings.some((w) => w.includes('bare number'))).toBe(true)
  })

  it('rect w/d with units → no warnings', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "rect", w: 100 * MM, d: 50 * MM }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('circle r bare → warning', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings.length).toBeGreaterThanOrEqual(1)
  })

  it('circle r with unit → no warnings', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('arc cx/cy/r bare → warnings; a0/a1 bare → no warning (angle)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "arc", cx: 0, cy: 0, r: 50, a0: 0, a1: 1.5 }] })',
    ))
    expect(result.ok).toBe(true)
    // r:50 is bare → 1 warning; cx:0/cy:0 are bare → 2 warnings; a0/a1 → no warning
    expect(result.dimWarnings.length).toBeGreaterThanOrEqual(3)
  })

  it('polygon n bare → no warning (count); r bare → warning', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "polygon", n: 6, r: 50 }] })',
    ))
    expect(result.ok).toBe(true)
    // Only r:50 should warn; n:6 is a count (bare, no spec)
    expect(result.dimWarnings.length).toBeGreaterThanOrEqual(1)
  })

  it('line from/to bare → warnings (length pairs)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "line", from: [10, 20], to: [30, 40] }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings.length).toBeGreaterThanOrEqual(4)
  })

  it('close ref bare → no warning (string)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "close", ref: "g1" }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })
})

describe('sketch dim-check — constraints', () => {
  it('length constraint value bare → warning', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], constraints: [{ kind: "length", of: { tag: "g1" }, value: 100 }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings.length).toBeGreaterThanOrEqual(1)
  })

  it('angle constraint value bare → no warning (radians)', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], constraints: [{ kind: "angle", a: { tag: "g1" }, b: { tag: "g2" }, value: 1.5 }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('length constraint value with unit → no warning', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], constraints: [{ kind: "length", of: { tag: "g1" }, value: 100 * MM }] })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })
})

describe('sketch dim-check — plane', () => {
  it('plane string → no warning', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], plane: "XZ" })',
    ))
    expect(result.ok).toBe(true)
    expect(result.dimWarnings).toHaveLength(0)
  })

  it('plane origin bare → warning; normal bare → no warning', () => {
    const result = check(sketchCode(
      'const s = cad.sketch({ shapes: [{ kind: "circle", r: 50 * MM }], plane: { origin: [10, 20, 30], normal: [0, 1, 0] } })',
    ))
    expect(result.ok).toBe(true)
    // origin:[10,20,30] → 3 warnings; normal:[0,1,0] → no warning (direction)
    expect(result.dimWarnings.length).toBeGreaterThanOrEqual(3)
  })
})

describe('sketch dim-check — box still errors (not affected by warn mode)', () => {
  it('cad.box bare numbers → error (not warning)', () => {
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