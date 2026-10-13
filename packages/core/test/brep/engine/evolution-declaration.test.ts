/**
 * @vitest-environment node
 *
 * 引擎原生面演化事实审计 —— `brep/engine/native-history.ts`
 *
 * 背景与红线：面演化不是一个能力，是一族 12 个独立核函数（`*WithHistory`）。引擎是否
 * **原生提供**某一个必须是**静态常量**：探测实现面不可行——所有适配器的 `*WithHistory`
 * 成员在 API 对象上**都有函数**，没实现的也放一个 `unsupported(...)` 桩，故
 * `typeof api.xWithHistory === 'function'` 恒为真，探测不出「真有还是桩」。
 *
 * 2026-10-08：本文件原审计适配器的 `BrepCapabilities.evolution` 声明；该声明轴（`BrepCapabilities`
 * / `engineCapabilitySet` / `op.capabilities`）已整体删除，同一事实的归属地改为
 * `native-history.ts` 的常量表。本文件把三个引擎的取值钉成期望值，使任何增删都成为显式 diff：
 * - 表里**少**一项 → 该 op 在具备该核函数的内核上被错误降级（欠报）；
 * - 表里**多**一项 → 该 op 静默通过静态判断后死在运行时（红线违规，多报）。
 *
 * 两值并钉（对应方案 §4.3 的既有不一致）：brepkit 的**实现面**提供
 * `intersectWithHistory`（与 cut/fuse 并列），而常量表按「保持删除前的判决」未列入。
 * 当前值与应有正确值**同时**钉住：修复（补表 → 行为增强需几何验证，或从实现面移除该
 * 未用方法）后，标 `← 当前值` 的那条断言翻转。
 *
 * 另一半（occt 的 12 个是真实现而非桩）由 `evolution-bindings.test.ts` 用**真调用**证明
 * ——那里对 4 个做了 bbox 断言；因 `initOcctWasm` 返回类型被 `as unknown as` 硬断言，
 * 编译期守卫是空转的，只有运行时调用能证明。
 *
 * Run: npx vitest run src/brep/engine/evolution-declaration.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { hasNativeHistory } from '../../../src/brep/engine/native-history'
import { BREP_MOCK_ENGINE_ID } from '../../../src/brep/engine/adapters/brep-mock'
import { OCCT_BREP_ENGINE_ID } from '../../../src/brep/engine/adapters/occt'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../../src/runtime-state'
import { BREP_HASH_BOUND, type BrepEvolutionKind } from '../../../src/brep/engine/types'

/** 面演化核函数全 12 员（`BrepEvolutionKind` 的值域 = `*WithHistory` 真名）。 */
const ALL_KINDS: readonly BrepEvolutionKind[] = [
  'fuseWithHistory',
  'cutWithHistory',
  'intersectWithHistory',
  'filletWithHistory',
  'chamferWithHistory',
  'translateWithHistory',
  'rotateWithHistory',
  'mirrorWithHistory',
  'scaleWithHistory',
  'shellWithHistory',
  'offsetWithHistory',
  'thickenWithHistory',
]

/** 最小 backends 记录：本文件只读 `config.brepEngineId`（`hasNativeHistory` 的唯一输入）。 */
function backendsFor(engineId: string | null): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep', brepEngineId: engineId },
    kernel: { brep: null, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

beforeEach(() => {
  __resetEngineRegistriesForTests()
})

describe('native-history 判据：occt（12 个全有）', () => {
  it('12 个 *WithHistory 全部为真——一个不多一个不少', () => {
    configureBackends(backendsFor(OCCT_BREP_ENGINE_ID))
    const native = ALL_KINDS.filter((k) => hasNativeHistory(k))
    expect([...native].sort()).toEqual([...ALL_KINDS].sort())
  })
})

describe('native-history 判据：brep-mock / 未装配 / 未知引擎（一律 false）', () => {
  it('brep_mock 替身：无原生面演化', () => {
    configureBackends(backendsFor(BREP_MOCK_ENGINE_ID))
    expect(ALL_KINDS.filter((k) => hasNativeHistory(k))).toEqual([])
  })

  it('brepEngineId = null（未装配）：一律 false', () => {
    configureBackends(backendsFor(null))
    expect(ALL_KINDS.filter((k) => hasNativeHistory(k))).toEqual([])
  })

  it('未知引擎 id：一律 false（拿不到事实按"没有"处理，绝不假设引擎有历史）', () => {
    configureBackends(backendsFor('some_future_engine'))
    expect(ALL_KINDS.filter((k) => hasNativeHistory(k))).toEqual([])
  })
})

// GOTCHA: brepkit-wasm 是可选运行时注入（非声明依赖）——未安装时套件整体 skip 而非 FAIL
// （与 brepkitKernel.test.ts 同法：条件须在收集期同步求值，不能依赖 beforeAll 的异步结果）。
const require = createRequire(import.meta.url)
let brepkitAvailable: boolean
try {
  require.resolve('brepkit-wasm')
  brepkitAvailable = true
} catch {
  brepkitAvailable = false
}

describe.skipIf(!brepkitAvailable)('native-history 判据：brepkit（部分实现 ⇒ 只有三员）', () => {
  it("恰为 ['cutWithHistory','filletWithHistory','fuseWithHistory']——其余 9 个是 unsupported 桩", () => {
    configureBackends(backendsFor('brepkit'))
    const native = ALL_KINDS.filter((k) => hasNativeHistory(k))
    expect([...native].sort()).toEqual(['cutWithHistory', 'filletWithHistory', 'fuseWithHistory'])
    // 反面证据：多报即红线违规（静态放行后死在运行时）。
    for (const k of ALL_KINDS.filter((k) => !native.includes(k))) {
      expect(hasNativeHistory(k), `brepkit 不应声称原生实现 ${k}`).toBe(false)
    }
  })

  it('两值并钉：intersectWithHistory —— 判据当前 false / 实现面已提供（应有 true）', async () => {
    configureBackends(backendsFor('brepkit'))

    // ── 当前值（镜像删除前的 adapters/brepkit.ts `evolution` 声明面）──────────────
    // 后果：`api/boolean.ts` 在 brepkit 上让 intersect 走裸路径、产物不带 roleTable。
    expect(hasNativeHistory('intersectWithHistory')).toBe(false) // ← 当前值，修好后应为 true

    // ── 应有正确值：实现面**已提供**该方法（可独立复跑的行为证据）───────────────
    // `unsupported(...)` 桩会抛出带方法名的错误；真实现不会。故「真调用不报 unsupported」
    // 即证明实现存在——这正是常量表漏列的根据。
    const { createBrepkitPrimitives } = await import('../../../src/brepkit-kernel/brepkitKernel')
    const primitives = await createBrepkitPrimitives()
    const a = primitives.makeBox(10, 10, 10)
    const b = primitives.makeBox(10, 10, 10)
    let unsupportedStub = false
    try {
      const evo = primitives.intersectWithHistory(a, b, [], BREP_HASH_BOUND)
      expect(evo).toBeDefined()
    } catch (e) {
      unsupportedStub = /unsupported/i.test(String((e as Error)?.message ?? e))
    } finally {
      primitives.release(a)
      primitives.release(b)
    }
    // 应有正确值 = true（真实现在位）；若本行失败，说明实现面已改，需同步重估本用例。
    expect(unsupportedStub, 'brepkit 的 intersectWithHistory 是 unsupported 桩').toBe(false)
  })
})
