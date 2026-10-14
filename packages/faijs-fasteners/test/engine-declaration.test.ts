/**
 * engine-declaration.test.ts — 本包两级引擎声明的落地验收（内核取用面收敛 2026-10-14 §3.3 / §5）
 *
 * 本文件把 `package.json` 里的**库级声明**与源码里的**函数级声明**放进一个真实装配
 * 周期里验证——不是读一遍 JSON 就算数：
 *
 *   1. 库级 `platform: []`（中立）经 `packageName` 从库自身 `package.json` 读进装配期，
 *      `describeLib` 如实回报；
 *   2. 函数级 `fn.engines = ['occt']` 只落在 5 个螺纹构形函数上，其余零件保持中立
 *      （否则「库级中立 + 少数例外」就退化成「整库 occt」）；
 *   3. brepkit 会话下：中立零件照常构建；那 5 个函数在**执行前**被拒
 *      （`E_BREP_UNSUPPORTED`，含引擎名）。
 *
 * `recessCutter` 单列一例（见下）：它的 `['occt']` 声明是**实现事实**，但它没有从
 * `src/index.ts` 导出，所以门（只作用于脚本面 op）管不到它——这是与方案 §5
 * 「taper 路径的 recessCutter 在执行前被拒」一行的**已核实偏差**，用测试钉住，
 * 不靠口头说明。
 *
 * 判据与 `kernel-conformance.test.ts` 的 `PROBED_OCCT_PLATFORM` 清单一致
 * （`loft(isSolid=false, ruled)` → 螺纹族的齿面直纹带；`draftPrism` → `recessCutter`
 * 的 taper 支路，见上）。
 *
 * GOTCHA：实参不是判据。门（`dispatchPath`）在执行实现之前，所以这里对 5 个平台函数
 * 一律给空对象——真正证明「实现体一次都没跑」的是 `packages/core/test/cad-runtime/
 * lib-declaration.test.ts` 的 `implRuns` 用例（机制层），本文件管的是**真实库的接线**。
 *
 * Run: npx vitest run test/engine-declaration.test.ts
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createRuntime, registerBrepkitBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { withCliLibLoader } from '@faicad/faijs/node-host/cli'
import { __resetEngineRegistriesForTests } from '@faicad/faijs/brep/engine/registry'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import * as fasteners from '../src/index'
import { recessCutter } from '../src/recess'

/**
 * 脚本面可见、且声明了 `fn.engines = ['occt']` 的函数。
 *
 * 唯一事实来源是源码里的标注（`thread.ts` 的 5 处）；本清单是它的**期望值副本**，
 * 所以任何一处新增/删除都会让本文件红——这正是要的效果。
 */
const OCCT_ONLY = [
  'buildThread',
  'isoThread',
  'acmeThread',
  'metricTrapezoidalThread',
  'plasticBottleThread',
] as const

/** 中立零件抽样：库级 `platform: []` 必须对它们真的成立。 */
const NEUTRAL_SAMPLE = ['hexNut', 'buildScrew', 'plainWasher', 'buildBearing'] as const

const IMPORT = "import * as flib from 'flib'\n"

function failingMessage(result: ExecutionResult): string {
  return result.failedAt === undefined
    ? ''
    : `${result.failedAt.callee}:${result.failedAt.message}`
}

let runtime: CadRuntime

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  // 首个注册者 = 默认引擎（R8），所以这一次注册就把会话钉在 brepkit 上。
  await registerBrepkitBrepEngine()
  // 测试扮演 node 宿主：用 CLI 白名单装载器装配 ports，`packageName` 才拿得到
  // `libMetaFor`（库级声明的读盘通道）。`createNodePorts()` 本身不含 libLoader。
  runtime = createRuntime(withCliLibLoader(createNodePorts()), 'brep')
  // 只给 `packageName`：库级声明由 loader 按包名读库自身 package.json 进来
  // （与脚本 `import` 自动装载同一条读盘通道）。
  runtime.registerLib('flib', fasteners as never, {
    autoLift: true,
    packageName: '@faicad/faijs-fasteners',
  })
}, 240_000)

describe('库级声明：中立 + 逐函数例外', () => {
  it('describeLib 如实回报 package.json 与源码两级的声明', () => {
    const desc = runtime.describeLib('flib')
    expect(desc).toBeDefined()
    expect(desc!.packageName).toBe('@faicad/faijs-fasteners')
    expect(desc!.role).toBe('library')
    expect(desc!.conformsTo).toBe('faijs')
    expect(desc!.platform).toEqual([])

    const byName = new Map(desc!.functions.map((f) => [f.name, f]))
    for (const name of OCCT_ONLY) expect(byName.get(name)?.engines, name).toEqual(['occt'])
    for (const name of NEUTRAL_SAMPLE) expect(byName.get(name)?.engines, name).toBeUndefined()
  })

  it('libsUnder(brepkit) 的静态拒绝项恰好是那 5 个函数', () => {
    const rejected = runtime
      .libsUnder('brepkit')
      .rejected.filter((r) => r.binding === 'flib')
      .map((r) => r.name)
      .sort()
    expect(rejected).toEqual([...OCCT_ONLY].sort())
  })

  it('recessCutter：声明存在，但不在公共命名空间里，所以门管不到它（已核实偏差）', () => {
    // 与方案 §5「taper 路径的 recessCutter 在执行前被拒」一行不符的**实测事实**：
    // 它没有从 `src/index.ts` 导出（只有 screw.ts 内部调它），因此既不出现在
    // describeLib / libsUnder 里，也不受任何引擎门约束。
    expect('recessCutter' in (fasteners as unknown as Record<string, unknown>)).toBe(false)
    expect(runtime.describeLib('flib')!.functions.some((f) => f.name === 'recessCutter')).toBe(false)
    // 但源码里的标注确实在（实现事实：taper 支路走 occt `draftPrism`）。
    expect((recessCutter as { engines?: readonly string[] }).engines).toEqual(['occt'])
    // 从公共 API 也走不到那条 occt 支路：包内唯一造 RecessSpec 的 defaultHeadRecess
    // 四个分支全部 `taperDeg: 0`（recess.ts:255/263/283/289），故 draftPrism 不可达
    // —— 这正是 screw.test.ts 把 12 类螺钉判为「零缺口（['occt','brepkit']）」的原因。
    expect(runtime.libsUnder('brepkit').rejected.some((r) => r.name === 'buildScrew')).toBe(false)
  })
})

describe('brepkit 会话：中立零件照常构建，平台函数执行前被拒', () => {
  it('中立零件（HexNut M6-1）在 brepkit 下构建成功', async () => {
    const result = await runtime.execute(
      `${IMPORT}let p1 = flib.hexNut({ size: 'M6-1', fastener_type: 'iso4032' })\n`,
    )
    expect(failingMessage(result)).toBe('')
  })

  for (const name of OCCT_ONLY) {
    it(`${name} 在执行前被拒：E_BREP_UNSUPPORTED + 引擎名`, async () => {
      const result = await runtime.execute(`${IMPORT}let p1 = flib.${name}({})\n`)
      const message = failingMessage(result)
      expect(message).toMatch(/E_BREP_UNSUPPORTED/)
      expect(message).toMatch(/requires engine occt \(current=brepkit\)/)
      // 反证：不是「跑到一半失败」——那会落成 E_OP_FAILED。
      expect(message).not.toMatch(/E_OP_FAILED/)
    })
  }
})
