/**
 * @vitest-environment node
 *
 * CadRuntime.check() dryRun 测试 (P3-6)
 *
 * T5 后：module 路径已删除，check() 只做语法门禁（extractMetadata = acorn parse +
 * 语句摘要），不做符号检查和引用预检（这些在运行时暴露）。
 *
 * 测试内容：
 * 1. 合法脚本 → ok: true
 * 2. parse 错误 → ok: false, stage: 'parse'
 * 3. 未定义引用/未知 callee → acorn 能 parse → ok: true（运行时暴露）
 *
 * Run: npx vitest run src/cad-runtime/check.test.ts
 */

import { describe, it, expect } from 'vitest'
import { asPartName } from '../../src/identity'
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

describe('CadRuntime.check() — dryRun validation', () => {
  it('valid script: single box → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script).toBeDefined()
    expect(result.script!.statements).toBe(1)
    expect(result.script!.callees).toEqual(['box'])
  })

  it('script.calls carries the namespace/packageName provenance of each call', () => {
    // check() 除裸 callees 外还输出结构化 calls：默认命名空间的 cad op 无 packageName，
    // import 的第三方库 op 带 namespace + packageName。unknown-op 守卫据此判定，
    // 无需 core import 任何外层库。
    const code = `import * as sm from '@faicad/sheetmetal'
export default async (cad) => {
  const part0 = cad.box({ size: 10 })
  const w = sm.validate(part0)
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    const calls = result.script!.calls!
    const cadCall = calls.find((c) => c.callee === 'box')!
    const libCall = calls.find((c) => c.callee === 'validate')!
    expect(cadCall.packageName).toBeUndefined()
    expect(libCall.namespace).toBe('sm')
    expect(libCall.packageName).toBe('@faicad/sheetmetal')
  })

  it('valid script: box + sphere boolean subtract → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  const part1 = cad.sphere({ radius: 8 * MM, center: [5, 0, 0] })
  const part2 = cad.subtract(part0, part1)
  return { shape: part2 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script!.callees).toEqual(['box', 'sphere', 'subtract'])
  })

  it('valid script with params → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const radius = 5
  const part0 = cad.sphere({ radius: radius })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script!.statements).toBe(1)
  })

  it('split destructure: referencing an output id later → ok', () => {
    // 文档标准形态：split 解构后引用 back 输出 part2
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  const { front: part1, back: part2 } = cad.fai_split(part0, { normal: [0, 0, 1], offset: 0 })
  const part3 = cad.translate({ offset: [5, 0, 0] }, part2)
  return { shape: part3 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script!.callees).toEqual(['box', 'fai_split', 'translate'])
  })

  it('reference precheck: undefined identifier → ok=false (extractMetadata catches E_REFERENCE)', () => {
    // extractMetadata checks references: unknown identifiers throw E_REFERENCE.
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  const { front: part1, back: part2 } = cad.fai_split(part0, { normal: [0, 0, 1], offset: 0 })
  const part3 = cad.translate({ offset: [5, 0, 0] }, part999)
  return { shape: part3 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('split separation params: separationRatio + separation accepted at the script face', () => {
    // 2026-10-24：`fai_split` 的分离方式由这两个参数承载（取代原 `applyExplode`）。
    // `separation` 声明为 length（可带单位字面量），`separationRatio` 声明为 plain
    // （纯比率，0.02 = 2%）。两者能同时出现在同一条语句里并通过静态检查，
    // 是宿主（web / 小程序）能发射它们的前提。
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  const { front: part1, back: part2 } = cad.fai_split(part0, { normal: [0, 0, 1], offset: 0, separationRatio: 0.02, separation: 2.5 * MM })
  return { shape: part1 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script!.callees).toEqual(['box', 'fai_split'])
  })

  it('parse error: invalid JS → ok=false, stage=parse', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box({ size: 20
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('parse error: not a default export and not valid flat code → ok=false, stage=parse', () => {
    // flat code 支持：`const x = 42` 现在是合法的扁平代码
    // 真正无效的输入：语法错误
    const code = `export default {`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('unknown callee: acorn parses → ok=true (runtime exposes)', () => {
    // T5: direct-only check() does not do symbol checking — acorn parses any valid
    // function call. Unknown callees surface at runtime.
    const code = `export default async (cad) => {
  const part0 = cad.bogusFn({ size: 20 })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('member method calls are valid syntax', () => {
    // 成员方法（asm.do_assemble）语法合法，check() 放行
    const code = `export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  const asm0 = cad.assembly({ members: [part0] })
  asm0.do_assemble()
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('check is zero-geometry-side-effect: no OCCT init needed', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  return { shape: part0 }
}`
    const runtime = makeRuntime()
    const result = runtime.check(code)
    expect(result.ok).toBe(true)
    // No brepChain, no outputs — check is pure text validation
    expect(runtime.getCachedOutput(asPartName('part0'))).toBeUndefined()
  })

  it('check provides structured context for AI self-correction', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
  const part1 = cad.sphere({ radius: 10 * MM })
  const part2 = cad.union(part0, part1)
  return { shape: part2 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script).toBeDefined()
    expect(result.script!.statements).toBe(3)
    expect(result.script!.callees).toEqual(['box', 'sphere', 'union'])
  })
})

// ── P6/D8: dimension pass end-to-end tests ──

describe('CadRuntime.check() — dimension pass (P6/D8)', () => {
  // 2026-10-25 收窄：length 槽位的裸数字按基本单位（mm）读 ⇒ `cad.box(20, 20, 20)` 合法。
  it('bare number on a length slot → ok=true (read as mm)', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('E_DIM_BARE_NUMBER: bare number on an angle slot → ok=false, stage=dimension', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM)
  const part1 = cad.rotate_euler(part0, { angles: [45, 0, 0] })
  return { shape: part1 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].stage).toBe('dimension')
    expect(result.errors[0].code).toBe('E_DIM_BARE_NUMBER')
  })

  it('angle slot with a unit, and 0 angles → ok=true', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box(20 * MM, 20 * MM, 20 * MM)
  const part1 = cad.rotate_euler(part0, { angles: [45 * DEGREE, 0, 0] })
  return { shape: part1 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('E_DIM_MISMATCH: operator pass is always on (26.0 ** MM) → stage=dimension', () => {
    const code = `export default async (cad) => {
  const zz = 26.0 ** MM
  const part0 = cad.box(26.0 * MM, 20.5 * MM, zz)
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('dimension')
    expect(result.errors[0].code).toBe('E_DIM_MISMATCH')
  })

  it('10 * MM on dimensioned slot → ok=true (unit literal is valid)', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box(10 * MM, 10 * MM, 10 * MM, { centered: true })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('10 * INCH on dimensioned slot → ok=true (inch is also length)', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box(10 * INCH, 10 * INCH, 10 * INCH, { centered: true })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('object form with a bare length → ok=true (5 means 5 mm)', () => {
    const code = `export default async (cad) => {
  const p0 = cad.box(10 * MM, 10 * MM, 10 * MM)
  const p1 = cad.fai_extrude(p0, { length: 5 })
  return { shape: p1 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('object form with a bare angle → E_DIM_BARE_NUMBER', () => {
    const code = `export default async (cad) => {
  const p0 = cad.box(10 * MM, 10 * MM, 10 * MM)
  const p1 = cad.draft(p0, { faces: "|Z", angleDeg: 3 })
  return { shape: p1 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('dimension')
    expect(result.errors[0].code).toBe('E_DIM_BARE_NUMBER')
  })

  it('object form with a unit angle → ok=true', () => {
    const code = `export default async (cad) => {
  const p0 = cad.box(10 * MM, 10 * MM, 10 * MM)
  const p1 = cad.draft(p0, { faces: "|Z", angleDeg: 3 * DEGREE })
  return { shape: p1 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('fai_extrude with 5 * MM → ok=true', () => {
    const code = `export default async (cad) => {
  const p0 = cad.box(10 * MM, 10 * MM, 10 * MM)
  const p1 = cad.fai_extrude(p0, { length: 5 * MM })
  return { shape: p1 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('sphere radius (length): bare 10 and 10 * MM both accepted', () => {
    // 2026-10-25 收窄：length 槽位裸数字 = 基本单位 mm，两种写法等价。
    const bare = `export default async (cad) => {
  const part0 = cad.sphere({ radius: 10 })
  return { shape: part0 }
}`
    expect(makeRuntime().check(bare).ok).toBe(true)

    const lit = `export default async (cad) => {
  const part0 = cad.sphere({ radius: 10 * MM })
  return { shape: part0 }
}`
    expect(makeRuntime().check(lit).ok).toBe(true)
  })

  it('box object form with bare lengths → ok=true', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box({ width: 10, depth: 10, height: 10 })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('box object form with a bare 0 → ok=true (zero exception)', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box({ width: 0, depth: 0, height: 0 })
  return { shape: part0 }
}`
    expect(makeRuntime().check(code).ok).toBe(true)
  })
})
