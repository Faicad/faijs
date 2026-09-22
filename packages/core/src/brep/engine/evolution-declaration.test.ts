/**
 * evolution 能力声明审计（Phase 0.2）
 *
 * 背景：`BrepCapabilities.evolution` 曾是**族级布尔**（`evolution: true`），而面演化
 * 不是一个能力、是一族 12 个独立核函数（`*WithHistory`）。族级声明会**多报**能力：
 * 内核只实现一部分时，静态判定仍放行，op 落到运行时才撞 `unsupported(...)`——
 * 违反 AGENTS.md 红线「BREP 路径能否走由静态规则判定，禁止运行时回退」。
 *
 * 本文件把两个适配器的 `evolution` 声明**钉成期望值**，使任何增删都成为显式 diff：
 * - 声明里**少**一项 → 该 op 在具备该核函数的内核上被错误拒绝（能力欠报）；
 * - 声明里**多**一项 → 该 op 静默通过静态判定后死在运行时（红线违规，多报）。
 *
 * ⚠️ 为什么必须钉死而不能"自动探测"：所有内核适配器的 `*WithHistory` 都在 API 对象里
 * **有函数**——没实现的也放一个 `unsupported('xWithHistory')` 桩（如
 * `brepkit-kernel/brepkitKernel.ts:224-537`）。所以 `typeof api.xWithHistory === 'function'`
 * 永远为真，**探测不出"真有还是桩"**。声明是唯一的真相来源，只能靠期望值钉住。
 *
 * 另一半（occt 的 12 个是真实现而非桩）由 `evolution-bindings.test.ts` 用**真调用**
 * 证明——那里对 4 个做了 bbox 断言；因 `initOcctWasm` 返回类型被 `as unknown as` 硬断言，
 * 编译期守卫是空转的，只有运行时调用能证明。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { __resetEngineRegistriesForTests, getBrepEngine } from './registry'
import { registerBrepMockEngine, BREP_MOCK_ENGINE_ID } from './adapters/brep-mock'
import { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from './adapters/occt'
import type { BrepEvolutionKind } from './types'
import type { BrepEngineApi } from './primitives'

/** OCCT（occt-wasm@3.8.4）实际提供的 12 个 `*WithHistory`，与 BrepEngineApi 声明一一对应。 */
const OCCT_EXPECTED: readonly BrepEvolutionKind[] = [
  'fuse',
  'cut',
  'intersect',
  'fillet',
  'chamfer',
  'translate',
  'rotate',
  'mirror',
  'scale',
  'shell',
  'offset',
  'thicken',
]

/** 能力名 → 核函数名（命名一律 `<kind>WithHistory`，见 BrepEngineApi 声明）。 */
const methodOf = (kind: BrepEvolutionKind): string => `${kind}WithHistory`

describe('evolution 声明审计：occt', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('声明恰为 12 个逐核函数名（不是族级布尔，也不多不少）', async () => {
    await registerOcctBrepEngine()
    const engine = await getBrepEngine(OCCT_BREP_ENGINE_ID)
    expect([...(engine.capabilities?.evolution ?? [])].sort()).toEqual([...OCCT_EXPECTED].sort())
  })

  it('声明 ⇒ 已绑定：每个声明项在 primitives 上都是函数（欠报防回归）', async () => {
    await registerOcctBrepEngine()
    const engine = await getBrepEngine(OCCT_BREP_ENGINE_ID)
    const api = engine.primitives as unknown as BrepEngineApi
    for (const kind of engine.capabilities?.evolution ?? []) {
      expect(typeof (api as unknown as Record<string, unknown>)[methodOf(kind)]).toBe('function')
    }
  })
})

describe('evolution 声明审计：brep-mock（无面演化）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('不声明任何 evolution 核函数', async () => {
    registerBrepMockEngine()
    const engine = await getBrepEngine(BREP_MOCK_ENGINE_ID)
    expect(engine.capabilities?.evolution ?? []).toEqual([])
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

describe.skipIf(!brepkitAvailable)('evolution 声明审计：brepkit（部分实现 ⇒ 必须部分声明）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it("声明恰为 ['fuse','cut','fillet']——chamfer/intersect/transform/shell/offset/thicken 全是 unsupported 桩，不得声明", async () => {
    const { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID } = await import('./adapters/brepkit')
    await registerBrepkitBrepEngine()
    const engine = await getBrepEngine(BREPKIT_BREP_ENGINE_ID)
    // 这里曾是 `evolution: true`（族级多报）。brepkit 只实现这三个：
    // brepkitKernel.ts:220 filletWithHistory、:504 cutWithHistory、:508 fuseWithHistory；
    // :224 chamferWithHistory、:512 intersectWithHistory、:518+ 其余一律 unsupported(...)。
    expect([...(engine.capabilities?.evolution ?? [])].sort()).toEqual(['cut', 'fillet', 'fuse'])
  })
})
