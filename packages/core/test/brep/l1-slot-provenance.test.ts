/**
 * L1 槽位来源守卫（2026-10-14 内核取用面收敛 §3.1 第 5 项）
 *
 * `getBrepApi()` 是本仓唯一一处 `as BrepEngineApi` —— 它的诚实性完全取决于
 * **注入槽位的值来自哪里**。本测试把这条依据钉成可重复执行的断言：
 *
 * 1. 写入端只有 `brep/brep-chain.ts#initBrepChainState` 与
 *    `cad-runtime/runtime.ts#ensureBrepChain`，两处都取 `engine.primitives`；
 * 2. 运行期：注册一个 `primitives` 为哨兵对象的引擎 → 链状态与 `getBrepApi()`
 *    必须**同一引用**返回该哨兵。若有人把槽位改成别的东西（raw 内核、合成面），
 *    这一条立刻红。
 *
 * 反面（本测试守住的历史事故）：`faijs-gears` 曾把 `getBackends().kernel.brep`
 * 断言成「L1 + 15 个 occt 平台扩展」的并集 —— 槽位值是 L1，断言却是平台面，
 * 缺的方法只在齿轮构建深处以 `kernel.X is not a function` 爆出。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registerBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import { initBrepChainState } from '../../src/brep/brep-chain'
import { configureBackends, CONTRACT_VERSION } from '../../src/runtime-state'
import { getBrepApi } from '../../src/brep/handle-bridge'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('L1 槽位来源：值必须来自 BrepEngine.primitives', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })
  afterEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('运行期：链状态与 getBrepApi() 返回的都是 engine.primitives（同一引用）', async () => {
    // 哨兵：只要有任何一个字节不是 engine.primitives 原样透传，identity 断言就失败
    const sentinel = { __sentinel: 'l1-primitives' } as unknown as BrepEngineApi
    registerBrepEngine('sentinel', async () => ({ id: 'sentinel', primitives: sentinel }))

    const chain = await initBrepChainState()
    expect(chain.kernel, 'BREP 链状态必须存 engine.primitives').toBe(sentinel)

    // 宿主侧回填（runtime.claimBackends 的同构装配）→ getBrepApi 的原样透传
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'brep' },
      kernel: {
        get brep() {
          return chain.kernel
        },
        csg: undefined,
        sdf: undefined,
      },
      fonts: null,
      texture: null,
      assets: null,
      events: null,
    })
    expect(getBrepApi(), 'getBrepApi() 必须原样返回槽位值，不得包装/合成').toBe(sentinel)
  })

  it('写入端只有两处，且都取 engine.primitives（静态）', () => {
    const chainSrc = readFileSync(join(ROOT, 'src', 'brep', 'brep-chain.ts'), 'utf-8')
    const runtimeSrc = readFileSync(join(ROOT, 'src', 'cad-runtime', 'runtime.ts'), 'utf-8')
    expect(chainSrc).toMatch(/kernel:\s*engine\.primitives/)
    expect(runtimeSrc).toMatch(/const kernel = engine\?\.primitives \?\? null/)
  })

  it('handle-bridge 只 import 类型与后端读写，不得 import 任何内核实现模块', () => {
    // `getBrepApi()` 的断言之所以诚实，前提是它拿不到别的值，也造不出别的值。
    const src = readFileSync(join(ROOT, 'src', 'brep', 'handle-bridge.ts'), 'utf-8')
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    for (const spec of imports) {
      expect(spec, `handle-bridge 不得 import ${spec}`).toMatch(
        /^\.\.\/(mesh\/types|runtime-state|shape)$|^\.\/engine\/primitives$/,
      )
    }
  })
})
