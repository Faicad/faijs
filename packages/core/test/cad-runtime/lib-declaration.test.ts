/**
 * @vitest-environment node
 *
 * lib-declaration.test.ts — 库的两级引擎声明（2026-10-14 §3.3）
 *
 * 两级是**两个不同维度**，不是粗细两层：
 *   - 库级 = **定位属性**（库 `package.json` 的 `faijs.lib`）：这个库能不能在某个内核
 *     上成立。判据不是它调了哪些方法，而是它的语义基准（`conformsTo`）依赖什么。
 *   - 函数级 = **实现事实**（裸函数对象上的 `fn.engines`）：这个函数的实现调了哪个内核。
 *
 * 有效引擎判定链：`fn.engines ?? lib.platform ?? 中立`，在**装配期一次解析完**
 * （`registerLib` → `admitCompatLib`），所以分派侧（`backend-dispatch.ts`）只读 op
 * 元数据，不需要认识库级声明。
 *
 * 本文件钉住五件事：
 *   1. `assertLibDecl` 的形态校验与**单向** peer 约束：`platform` 含 occt ⟹ 库必须有
 *      `occt-wasm` peerDependency；**反向不成立**（`faijs-fasteners` 有 peer 却库级中立，
 *      是活反例，见 §2.5）；
 *   2. 函数级 `fn.engines` 经 `compatOp` 透传后在 brepkit 会话下**执行前**被拒
 *      （`E_BREP_UNSUPPORTED`，含引擎名）；同函数不带 `fn.engines` 时保持今日行为（回归）；
 *   3. 库级 `platform` 兜底全部裸函数，且 `fn.engines` 优先于它；
 *   4. 装配期拒绝「库级 `platform` + 未声明 `engines` 的 dual-op」——装配期注入只存在于
 *      提升通路（只包装裸函数），这种声明无法兑现，静默放行会是漏洞；
 *   5. 查询面 `describeLib` / `libsUnder` 与分派侧静态规则**同源**——同一份声明只有一个
 *      视图，不存在两处各自维护。
 *
 * GOTCHA（报错文案，实测）：引擎门文案是
 *   `E_BREP_UNSUPPORTED: op '<name>' requires engine occt (current=<engine>)`
 * 断言用 `/requires engine occt/`，不要用「能力门」时代的 `/lacks capability/`。
 *
 * GOTCHA（门在执行实现之前）：实现体写成「一旦被调用就 +1」，用 `implRuns` 的**未增**
 * 反证门确实拦在实现之前（正面证据 + 反面证据）。
 *
 * Run: npx vitest run test/cad-runtime/lib-declaration.test.ts
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRuntime } from '../../src/cad-runtime/runtime'
import type { CadRuntime, ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts, LibLoader } from '../../src/cad-runtime/ports'
import { assertLibDecl, resolveFunctionEngines } from '../../src/cad-runtime/lib-decl'
import type { LibDecl } from '../../src/cad-runtime/lib-decl'
import { compatOp } from '../../src/api/internal/compat-op'
import { defineOp, dualOpMetaOf } from '../../src/define-op'
import { CONTRACT_VERSION, type LibNamespace } from '../../src/runtime-state'
import { solid } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'

/** 极小 mesh 立方体——探针实现产物（本文件不验几何）。 */
function cubeMesh(size: number): Shape {
  const s = size / 2
  return {
    positions: new Float32Array([
      -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
      -s, -s, s, s, -s, s, s, s, s, -s, s, s,
    ]),
    indices: new Uint32Array([
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
    ]),
  }
}

/** 门放行后实现体确实被调用的正面证据。 */
let implRuns = 0

/** 平台专属裸函数：`fn.engines = ['occt']`（实现事实，不是定位属性）。 */
const occtOnly = (() => {
  const fn = (): Shape => {
    implRuns += 1
    return solid(cubeMesh(10))
  }
  ;(fn as unknown as { engines?: readonly string[] }).engines = ['occt']
  return fn
})()

/** 中立裸函数：不带 `fn.engines`（缺省 = 中立 = 今日行为）。 */
function neutral(): Shape {
  implRuns += 1
  return solid(cubeMesh(8))
}

function ports(loader?: LibLoader): HostPorts {
  return loader === undefined
    ? ({ events: { emit: () => undefined } } as HostPorts)
    : ({ events: { emit: () => undefined }, libLoader: loader } as HostPorts)
}

/**
 * 重置引擎注册表并只注册目标引擎（首个注册者 = 默认，R8）。
 *
 * `ensureOcctDefaultEngine` 在任何引擎已注册时是 no-op，所以只注册 brepkit 时活动引擎
 * 就是 brepkit——不需要伪造 `config.brepEngineId`。
 */
async function withEngine(id: 'occt' | 'brepkit'): Promise<void> {
  __resetEngineRegistriesForTests()
  if (id === 'occt') await registerOcctBrepEngine()
  else await registerBrepkitBrepEngine()
}

function failingMessage(result: ExecutionResult): string {
  return result.failedAt === undefined
    ? ''
    : `${result.failedAt.callee}:${result.failedAt.message}`
}

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

beforeEach(() => {
  implRuns = 0
})

// ═══════════════════════════════════════════════════════════
// 1 · `assertLibDecl` — 形态 + 单向 peer 约束
// ═══════════════════════════════════════════════════════════

describe('assertLibDecl — 声明形态与单向 peer 约束', () => {
  it('未声明（undefined / null）→ 返回 undefined（= 中立，存量库零改动）', () => {
    expect(assertLibDecl(undefined)).toBeUndefined()
    expect(assertLibDecl(null)).toBeUndefined()
  })

  it('合法声明原样归一化（role / conformsTo / platform）', () => {
    const decl = assertLibDecl({ role: 'library', conformsTo: 'cadquery', platform: ['occt'] })
    expect(decl).toEqual({ role: 'library', conformsTo: 'cadquery', platform: ['occt'] })
  })

  it('platform 含 occt 且 peers 缺省 → 不抛（来源未提供该项事实，跳过单向校验）', () => {
    expect(() => assertLibDecl({ platform: ['occt'] })).not.toThrow()
  })

  it('单向：platform 含 occt 而 peers 无 occt-wasm → 装配期拒绝', () => {
    expect(() => assertLibDecl({ platform: ['occt'] }, { three: '^1.0.0' }, 'demo-lib')).toThrow(/occt-wasm/)
  })

  it('单向：platform 含 occt 且 peers 有 occt-wasm → 通过', () => {
    expect(() => assertLibDecl({ platform: ['occt'] }, { 'occt-wasm': '^5.6.0' })).not.toThrow()
  })

  it('反向不成立（fasteners 反例）：有 occt-wasm peer 而 platform 中立 → 通过', () => {
    // `faijs-fasteners` 实测：有 occt-wasm peerDependency，库级 platform 却是 `[]`。
    // peer 只说明「这个库可能用到 occt」，不说明「每个函数都需要 occt」——所以 peer
    // 不能用来反推 platform。
    expect(() => assertLibDecl({ platform: [] }, { 'occt-wasm': '^5.6.0' })).not.toThrow()
    // 同一份 peer 下 platform 缺省（未声明）也照旧通过。
    expect(() => assertLibDecl({}, { 'occt-wasm': '^5.6.0' })).not.toThrow()
  })

  it('非法输入全部拒绝：未知引擎 id / 重复 id / 非数组 platform / 非法 role / 未知字段 / 非对象', () => {
    expect(() => assertLibDecl({ platform: ['nope'] })).toThrow(/unknown engine id/)
    expect(() => assertLibDecl({ platform: ['occt', 'occt'] })).toThrow(/duplicate engine id/)
    expect(() => assertLibDecl({ platform: 'occt' })).toThrow(/must be an array/)
    expect(() => assertLibDecl({ role: 'bogus' })).toThrow(/faijs\.lib\.role/)
    expect(() => assertLibDecl({ engines: ['occt'] })).toThrow(/unknown faijs\.lib field/)
    expect(() => assertLibDecl(['occt'])).toThrow(/must be an object/)
  })

  it('resolveFunctionEngines — 判定链 fn.engines ?? lib.platform ?? 中立', () => {
    expect(resolveFunctionEngines(['brepkit'], ['occt'])).toEqual(['brepkit'])
    expect(resolveFunctionEngines(undefined, ['occt'])).toEqual(['occt'])
    expect(resolveFunctionEngines(undefined, [])).toBeUndefined()
    expect(resolveFunctionEngines(undefined, undefined)).toBeUndefined()
    // 空数组与 undefined 同义（都表示「没声明」），不能把声明方锁成「无引擎可用」。
    expect(resolveFunctionEngines([], ['occt'])).toEqual(['occt'])
  })
})

// ═══════════════════════════════════════════════════════════
// 2 · 函数级 fn.engines 透传 → 分派侧执行前拒绝
// ═══════════════════════════════════════════════════════════

describe('函数级 fn.engines：提升通路透传后在非声明引擎下执行前被拒', () => {
  const SCRIPT = "import * as lib from 'decl-lib'\nlet p1 = lib.occtOnly()\n"
  const NEUTRAL_SCRIPT = "import * as lib from 'decl-lib'\nlet p1 = lib.neutral()\n"

  function runOn(engine: 'occt' | 'brepkit', ns: LibNamespace, code: string): Promise<ExecutionResult> {
    return withEngine(engine).then(async () => {
      const rt: CadRuntime = createRuntime(ports(), 'brep')
      try {
        rt.registerLib('lib', ns, { autoLift: true, packageName: 'decl-lib' })
        return await rt.execute(code)
      } finally {
        rt.dispose()
      }
    })
  }

  it('brepkit：拒绝，错误码 E_BREP_UNSUPPORTED 且消息含引擎名；实现体未执行', async () => {
    const result = await runOn('brepkit', { occtOnly } as unknown as LibNamespace, SCRIPT)
    const msg = failingMessage(result)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
    // 反面证据：能力门文案已随声明轴删除，不可能出现。
    expect(msg).not.toMatch(/lacks capability/)
    expect(implRuns).toBe(0)
  })

  it('occt：门放行，实现体被调用（正面证据，证明上一条是门拦的而非别的错）', async () => {
    const result = await runOn('occt', { occtOnly } as unknown as LibNamespace, SCRIPT)
    expect(result.failedAt).toBeUndefined()
    expect(implRuns).toBe(1)
  })

  it('回归：同形态裸函数不带 fn.engines → 中立，brepkit 下照常执行（今日行为）', async () => {
    const result = await runOn('brepkit', { neutral } as unknown as LibNamespace, NEUTRAL_SCRIPT)
    expect(failingMessage(result)).not.toMatch(/requires engine/)
    expect(implRuns).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════
// 3 · 库级 platform 兜底 + fn.engines 优先
// ═══════════════════════════════════════════════════════════

describe('库级 platform：裸函数自动继承，fn.engines 覆盖它', () => {
  const OCCT_PEERS = { 'occt-wasm': '^5.6.0' } as const

  /** 库级 occt（`conformsTo: 'cadquery'` → 由基准推导出的引擎约束）。 */
  const OCCT_LIB = { neutral } as unknown as LibNamespace

  function runOn(
    engine: 'occt' | 'brepkit',
    ns: LibNamespace,
    lib: unknown,
    peers: Readonly<Record<string, string>> | undefined,
    code: string,
  ): Promise<ExecutionResult> {
    return withEngine(engine).then(async () => {
      const rt = createRuntime(ports(), 'brep')
      try {
        rt.registerLib('lib', ns, {
          autoLift: true,
          packageName: 'decl-lib',
          ...(lib === undefined ? {} : { lib }),
          ...(peers === undefined ? {} : { peers }),
        })
        return await rt.execute(code)
      } finally {
        rt.dispose()
      }
    })
  }

  it('库级 platform=[occt]：未写 fn.engines 的裸函数自动为 occt → brepkit 下执行前被拒', async () => {
    const result = await runOn(
      'brepkit',
      OCCT_LIB,
      { role: 'library', conformsTo: 'cadquery', platform: ['occt'] },
      OCCT_PEERS,
      "import * as lib from 'decl-lib'\nlet p1 = lib.neutral()\n",
    )
    const msg = failingMessage(result)
    expect(msg).toMatch(/requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
    expect(implRuns).toBe(0)
  })

  it('库级 platform=[occt]：occt 下照常执行（声明不改变目标引擎行为）', async () => {
    const result = await runOn(
      'occt',
      OCCT_LIB,
      { role: 'library', conformsTo: 'cadquery', platform: ['occt'] },
      OCCT_PEERS,
      "import * as lib from 'decl-lib'\nlet p1 = lib.neutral()\n",
    )
    expect(result.failedAt).toBeUndefined()
    expect(implRuns).toBe(1)
  })

  it('fn.engines 优先于库级 platform：库级 occt，函数声明 brepkit → brepkit 下放行', async () => {
    const toBrepkit = (() => {
      const fn = (): Shape => {
        implRuns += 1
        return solid(cubeMesh(10))
      }
      ;(fn as unknown as { engines?: readonly string[] }).engines = ['brepkit']
      return fn
    })()
    const result = await runOn(
      'brepkit',
      { toBrepkit } as unknown as LibNamespace,
      { role: 'library', conformsTo: 'openscad', platform: ['occt'] },
      OCCT_PEERS,
      "import * as lib from 'decl-lib'\nlet p1 = lib.toBrepkit()\n",
    )
    expect(failingMessage(result)).not.toMatch(/requires engine/)
    expect(implRuns).toBe(1)
  })

  it('装配期拒绝：库级 platform=[occt] + 无 occt-wasm peer（`peers: {}` = 查过了、确实没有）', async () => {
    await withEngine('brepkit')
    const rt = createRuntime(ports(), 'brep')
    try {
      expect(() =>
        rt.registerLib('lib', OCCT_LIB, {
          autoLift: true,
          packageName: 'decl-lib',
          lib: { platform: ['occt'] },
          peers: {},
        }),
      ).toThrow(/occt-wasm/)
      // 反证控制：同一份声明 + 有 occt-wasm peer → 通过（证明上一条拒的是 peer 缺位，
      // 不是别的形态问题）。
      expect(() =>
        rt.registerLib('lib-peer-ok', OCCT_LIB, {
          autoLift: true,
          packageName: 'decl-lib',
          lib: { platform: ['occt'] },
          peers: OCCT_PEERS,
        }),
      ).not.toThrow()
    } finally {
      rt.dispose()
    }
  })

  it('peers 缺省（事实未提供）→ 跳过单向校验；`peers: {}` 与 `undefined` 语义不同', async () => {
    await withEngine('brepkit')
    const rt = createRuntime(ports(), 'brep')
    try {
      // 宿主不提供 peer 事实时不能凭空判定 —— 手工注册的免校验通道。
      expect(() =>
        rt.registerLib('lib-nofact', OCCT_LIB, {
          autoLift: true,
          packageName: 'decl-lib',
          lib: { platform: ['occt'] },
        }),
      ).not.toThrow()
      // 但 `describeLib` 如实回报声明（不是把声明丢掉）。
      expect(rt.describeLib('lib-nofact')!.platform).toEqual(['occt'])
    } finally {
      rt.dispose()
    }
  })

  it('装配期拒绝：不提升（autoLift=false）时任何引擎声明都是死声明（库级或函数级）', async () => {
    await withEngine('occt')
    const rt = createRuntime(ports(), 'brep')
    try {
      // 库级声明 + 不提升 → 拒
      expect(() =>
        rt.registerLib('nolit-lib', OCCT_LIB, {
          autoLift: false,
          packageName: 'decl-lib',
          lib: { platform: ['occt'] },
          peers: OCCT_PEERS,
        }),
      ).toThrow(/admitted WITHOUT lifting/)
      // 函数级声明 + 不提升 → 同样拒（fn.engines 只在提升通路写进 op 元数据）
      expect(() =>
        rt.registerLib('nolit-fn', { occtOnly } as unknown as LibNamespace, {
          autoLift: false,
          packageName: 'decl-lib',
        }),
      ).toThrow(/fn\.engines on occtOnly/)
      // 反证控制：同两个库在提升通路下正常（证明上两条拒的是「不提升」，不是别的）。
      expect(() =>
        rt.registerLib('lit-lib', OCCT_LIB, {
          autoLift: true,
          packageName: 'decl-lib',
          lib: { platform: ['occt'] },
          peers: OCCT_PEERS,
        }),
      ).not.toThrow()
      expect(() =>
        rt.registerLib('lit-fn', { occtOnly } as unknown as LibNamespace, {
          autoLift: true,
          packageName: 'decl-lib',
        }),
      ).not.toThrow()
    } finally {
      rt.dispose()
    }
  })

  it('装配期拒绝（提升通路）：库级 platform=[occt] 但库内有未声明 engines 的 dual-op（无法兑现的声明）', async () => {
    const anOp = defineOp({
      name: 'libDualOp',
      brep: () => solid(cubeMesh(10)),
      naming: { kind: 'unmodeled', reason: 'lib-declaration guard probe' },
    })
    await withEngine('occt')
    const rt = createRuntime(ports(), 'brep')
    try {
      // assertContractVersion 先跑（dual-op 库必须声明 contractVersion），随后才是
      // 库级声明与「无法兑现」的守卫。必须显式 autoLift —— 不提升时更早的那条守卫会先
      // 拒（见上一条测试），那就测不到这里的分支了。
      expect(() =>
        rt.registerLib(
          'lib',
          { contractVersion: CONTRACT_VERSION, anOp } as unknown as LibNamespace,
          { autoLift: true, packageName: 'decl-lib', lib: { platform: ['occt'] }, peers: OCCT_PEERS },
        ),
      ).toThrow(/cannot cover dual-op function\(s\) anOp/)
      // 反证控制：同一库去掉 platform 即通过 —— 证明上一条确实是那一处守卫拒的。
      expect(() =>
        rt.registerLib(
          'lib-ok',
          { contractVersion: CONTRACT_VERSION, anOp } as unknown as LibNamespace,
          { autoLift: true, packageName: 'decl-lib', peers: OCCT_PEERS },
        ),
      ).not.toThrow()
    } finally {
      rt.dispose()
    }
  })
})

// ═══════════════════════════════════════════════════════════
// 4 · 查询面：describeLib / libsUnder 与分派侧静态规则同源
// ═══════════════════════════════════════════════════════════

describe('查询面 describeLib / libsUnder', () => {
  const OCCT_PEERS = { 'occt-wasm': '^5.6.0' } as const

  /** 库级中立 + 两条支路标 fn.engines（fasteners 的形态）。 */
  const MIXED_LIB = { neutral, occtOnly } as unknown as LibNamespace

  function registerMixed(rt: CadRuntime): void {
    rt.registerLib('flib', MIXED_LIB, {
      autoLift: true,
      packageName: 'decl-lib',
      lib: { role: 'library', conformsTo: 'faijs', platform: [] } satisfies LibDecl,
      peers: OCCT_PEERS,
    })
  }

  it('describeLib：库级定位 + 逐函数有效引擎；未写 fn.engines 的回报中立', async () => {
    await withEngine('occt')
    const rt = createRuntime(ports(), 'brep')
    try {
      registerMixed(rt)
      const desc = rt.describeLib('flib')
      expect(desc).toBeDefined()
      expect(desc!.binding).toBe('flib')
      expect(desc!.packageName).toBe('decl-lib')
      expect(desc!.role).toBe('library')
      expect(desc!.conformsTo).toBe('faijs')
      expect(desc!.platform).toEqual([])
      const byName = new Map(desc!.functions.map((f) => [f.name, f]))
      expect(byName.get('neutral')!.engines).toBeUndefined()
      expect(byName.get('occtOnly')!.engines).toEqual(['occt'])
      // 未注册的 binding → undefined（查询面不抛）
      expect(rt.describeLib('nope')).toBeUndefined()
    } finally {
      rt.dispose()
    }
  })

  it('describeLib：库级 platform=[occt] 时，未写 fn.engines 的函数回报继承来的 platform', async () => {
    await withEngine('occt')
    const rt = createRuntime(ports(), 'brep')
    try {
      rt.registerLib('glib', { neutral } as unknown as LibNamespace, {
        autoLift: true,
        packageName: 'decl-lib',
        lib: { role: 'library', conformsTo: 'cadquery', platform: ['occt'] },
        peers: OCCT_PEERS,
      })
      const desc = rt.describeLib('glib')!
      expect(desc.platform).toEqual(['occt'])
      expect(desc.functions.find((f) => f.name === 'neutral')!.engines).toEqual(['occt'])
    } finally {
      rt.dispose()
    }
  })

  it('libsUnder：给定引擎分可调用 / 静态拒绝，且与 describeLib 的 engines 互推一致', async () => {
    await withEngine('occt')
    const rt = createRuntime(ports(), 'brep')
    try {
      registerMixed(rt)
      const desc = rt.describeLib('flib')!
      const declared = new Map(desc.functions.map((f) => [f.name, f.engines]))

      // 注册表里还有内置 `cad`（它自带一批 occt 平台 op），所以按 binding 过滤。
      const mineUnder = (engineId: string): { callable: string[]; rejected: string[] } => {
        const split = rt.libsUnder(engineId)
        return {
          callable: split.callable.filter((c) => c.binding === 'flib').map((c) => c.name),
          rejected: split.rejected.filter((c) => c.binding === 'flib').map((c) => c.name),
        }
      }

      const onBrepkit = rt.libsUnder('brepkit')
      expect(onBrepkit.engineId).toBe('brepkit')
      const brepkitMine = mineUnder('brepkit')
      expect(brepkitMine.callable).toEqual(['neutral'])
      expect(brepkitMine.rejected).toEqual(['occtOnly'])
      const reason = onBrepkit.rejected.find((r) => r.binding === 'flib')!.reason
      expect(reason).toMatch(/occt/)
      expect(reason).toMatch(/brepkit/)

      const occtMine = mineUnder('occt')
      expect(occtMine.rejected).toEqual([])
      expect(occtMine.callable.sort()).toEqual(['neutral', 'occtOnly'])

      // 同源判据：拒绝 ⟺ 声明了 engines 且不含该引擎；可调用 ⟺ 未声明或含该引擎。
      for (const engineId of ['occt', 'brepkit'] as const) {
        const split = mineUnder(engineId)
        const rejectedNames = new Set(split.rejected)
        for (const [name, engines] of declared) {
          const shouldReject = engines !== undefined && engines.length > 0 && !engines.includes(engineId)
          expect(rejectedNames.has(name), `${name} under ${engineId}`).toBe(shouldReject)
        }
      }
    } finally {
      rt.dispose()
    }
  })

  it('libsUnder 的拒绝与分派侧实际拒绝一致（同一份声明的两个视图）', async () => {
    await withEngine('brepkit')
    const rt = createRuntime(ports(), 'brep')
    try {
      registerMixed(rt)
      const brepkitMine = rt.libsUnder('brepkit').rejected.filter((r) => r.binding === 'flib')
      expect(brepkitMine.map((r) => r.name)).toEqual(['occtOnly'])
      const result = await rt.execute("import * as flib from 'decl-lib'\nlet p1 = flib.occtOnly()\n")
      expect(failingMessage(result)).toMatch(/requires engine occt \(current=brepkit\)/)
      expect(implRuns).toBe(0)
    } finally {
      rt.dispose()
    }
  })
})

// ═══════════════════════════════════════════════════════════
// 5 · 自动装载读盘通道：LibLoader.libMetaFor
// ═══════════════════════════════════════════════════════════

describe('LibLoader.libMetaFor — 逐库声明经自动装载进入装配期', () => {
  const OCCT_PEERS = { 'occt-wasm': '^5.6.0' } as const
  const SCRIPT = "import * as glib from 'decl-lib'\nlet p1 = glib.neutral()\n"

  function loaderWith(meta: Record<string, unknown> | undefined): LibLoader {
    return {
      loadLib: async () => ({ neutral } as unknown as LibNamespace),
      listLibs: () => ['decl-lib'],
      options: { autoLift: true },
      ...(meta === undefined ? {} : { libMetaFor: (pkg: string) => meta[pkg] as never }),
    }
  }

  it('提供 libMetaFor → 库级声明进入 registerLib：brepkit 下执行前被拒', async () => {
    await withEngine('brepkit')
    const rt = createRuntime(
      ports(loaderWith({ 'decl-lib': { lib: { role: 'library', conformsTo: 'cadquery', platform: ['occt'] }, peers: OCCT_PEERS } })),
      'brep',
    )
    try {
      const result = await rt.execute(SCRIPT)
      expect(failingMessage(result)).toMatch(/requires engine occt \(current=brepkit\)/)
      expect(implRuns).toBe(0)
      const desc = rt.describeLib('glib')!
      expect(desc.platform).toEqual(['occt'])
      expect(desc.conformsTo).toBe('cadquery')
    } finally {
      rt.dispose()
    }
  })

  it('不提供 libMetaFor → 按未声明处理（中立），brepkit 下照常执行（今日行为）', async () => {
    await withEngine('brepkit')
    const rt = createRuntime(ports(loaderWith(undefined)), 'brep')
    try {
      const result = await rt.execute(SCRIPT)
      expect(failingMessage(result)).not.toMatch(/requires engine/)
      expect(implRuns).toBe(1)
      expect(rt.describeLib('glib')!.platform).toEqual([])
    } finally {
      rt.dispose()
    }
  })

  it('libMetaFor 声明 platform=[occt] 但 peers 缺 occt-wasm → 装配期直接抛（读盘通道不绕过单向约束）', async () => {
    await withEngine('brepkit')
    const rt = createRuntime(
      ports(loaderWith({ 'decl-lib': { lib: { platform: ['occt'] }, peers: { three: '^1.0.0' } } })),
      'brep',
    )
    try {
      // 装配期校验失败是宿主/库作者的错（不是脚本的错），所以是抛错而非 failedAt：
      // 自动装载调用 registerLib，校验在 registerLib 内，异常不被 loadLib 的 catch 吞掉。
      await expect(rt.execute(SCRIPT)).rejects.toThrow(/occt-wasm/)
      expect(implRuns).toBe(0)
    } finally {
      rt.dispose()
    }
  })

  it('显式 registerLib 只给 packageName → 仍按库自身 package.json 读声明（不是静默中立）', async () => {
    await withEngine('brepkit')
    const loader = loaderWith({
      'decl-lib': { lib: { role: 'library', conformsTo: 'cadquery', platform: ['occt'] }, peers: OCCT_PEERS },
    })
    const rt = createRuntime(ports(loader), 'brep')
    try {
      // 宿主只声明「这个命名空间是哪个包」，没搬 lib —— 声明必须仍然落地，否则
      // describeLib 会对调用方撒谎（「声明了却不生效」）。
      rt.registerLib('glib', { neutral } as unknown as LibNamespace, {
        autoLift: true,
        packageName: 'decl-lib',
      })
      const desc = rt.describeLib('glib')!
      expect(desc.platform).toEqual(['occt'])
      expect(desc.conformsTo).toBe('cadquery')
      const result = await rt.execute(SCRIPT)
      expect(failingMessage(result)).toMatch(/requires engine occt \(current=brepkit\)/)
      expect(implRuns).toBe(0)
      // 反证控制：显式传入的 `lib` 优先于读盘（宿主覆盖声明的手段）。
      rt.registerLib('glib2', { neutral } as unknown as LibNamespace, {
        autoLift: true,
        packageName: 'decl-lib',
        lib: { role: 'library', conformsTo: 'faijs', platform: [] },
        peers: OCCT_PEERS,
      })
      expect(rt.describeLib('glib2')!.platform).toEqual([])
    } finally {
      rt.dispose()
    }
  })

  it('compatOp 已转发 engines：提升后的裸函数元数据可见（透传不是猜测）', () => {
    const lifted = compatOp(neutral as (...a: unknown[]) => unknown, {
      name: 'neutral',
      engines: ['occt'],
      naming: { kind: 'unmodeled', reason: 'lib-declaration probe' },
    })
    expect(dualOpMetaOf(lifted)!.engines).toEqual(['occt'])
    // 反证控制：不传 engines 时元数据为 undefined（不是把 ['occt'] 写死在某处）。
    const plain = compatOp(neutral as (...a: unknown[]) => unknown, {
      name: 'neutral',
      naming: { kind: 'unmodeled', reason: 'lib-declaration probe' },
    })
    expect(dualOpMetaOf(plain)!.engines).toBeUndefined()
  })
})
