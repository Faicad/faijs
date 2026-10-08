/**
 * @vitest-environment node
 *
 * occt S4 布尔扩展族 + 对齐族探针（长期保留，可重复跑）——方案 §3.4.5 / §3.4.9。
 *
 * 覆盖 2 个新脚本符号（平台 op engines:['occt']，defineOp 形态）：
 *   boolean（原生 booleanOp：带 glue/fuzzy/simplify 选项的通用布尔）
 *   alignTo（原生 alignX/alignY/alignZ：包围盒锚点对齐，三轴并为一个符号）
 *
 * 钉住的事实：
 *   A. occt 下几何正确：
 *     - boolean 'cut'：工具移除对应体积（体积 = 主体 − 重叠）；
 *       'fuse'：体积相加；'common'：体积等于交集体积；
 *     - alignTo：把该轴包围盒的指定锚点（min / center / max）挪到 target；target 与
 *       anchor 都缺省透传给原生（本仓不替上游编默认值，故这里的锚点语义由 occt
 *       原生决定，实测默认取 **center**、默认 target 为 0——见 A4b，若上游改默认，
 *       该断言须翻转）。
 *   B. 入参校验（空数组 / 非法算子 / 非法 glue / 非法轴与锚点）；
 *   C. 平台身份：brepkit 下脚本级执行前报 E_BREP_UNSUPPORTED（D11-4）。
 *      注：defineOp 形态**必须**经脚本 'brep' 模式验门（直连会先报
 *      E_MESH_UNSUPPORTED，见 measure-query 测试里的同款 GOTCHA）；
 *   D. TS 级直连（L1 覆盖门禁）。
 *
 * Run: npx vitest run test/api/occt-s4-boolean-align.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { solidToShape } from '../../src/brep/brep-ops'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { brepOf, fromBrep } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { boolean as booleanOp } from '../../src/api/boolean-op'
import { alignTo } from '../../src/api/align'

let boxA: Shape, boxB: Shape

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  await initOcctWasm()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)

  makeFixtures()
}, 120000)

/**
 * 构造 TS 直连用的夹具（必须在**当前**引擎注册之后调用）。
 *
 * GOTCHA：`__resetEngineRegistriesForTests()` + 重新 register 之后，之前拿到的
 * occt arena 句柄全部失效——沿用会报 `invalid solid handle: index N is out of
 * bounds`（不是类型错误，是内核 arena 索引越界）。因此每个会重注册引擎的
 * describe 都要重建夹具，不能复用顶层 beforeAll 的那些。
 */
function makeFixtures(): void {
  const api = getBrepApi()
  boxA = adopt(api.makeBox(10, 10, 10))
  // 与 boxA 半重叠（错开 5）：交集体积 = 5×10×10 = 500
  boxB = adopt(api.translate(brepOf(boxA) as BrepHandle, 5, 0, 0))
}

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function adopt(h: BrepHandle): Shape {
  return fromBrep(solidToShape(getBrepApi(), h), { solid: h })
}

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function exec(mode: ExecutionMode, code: string) {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

function bboxOf(s: Shape) {
  return getBrepApi().getBoundingBox(brepOf(s) as never)
}
function volumeOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

const TWO_BOXES =
  `let part0 = cad.box(10,10,10)\n` +
  `let part1 = cad.translate(part0, 5, 0, 0)\n`

describe('S4 布尔扩展族 / 对齐族 — occt 正例（脚本级）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    makeFixtures() // 夹具必须与当前引擎注册同批重建（见 makeFixtures 头注）
  }, 120000)

  it('A1. boolean cut：主体减工具，体积 1000 − 500 = 500', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.boolean([part0], [part1], 'cut')\n`)
    expect(r.failedAt).toBeUndefined()
    const s = r.outputs.get(asPartName('part2')) as Shape
    expect(volumeOf(s)).toBeCloseTo(500, 3)
  })

  it('A2. boolean fuse：两盒并集，体积 1000 + 1000 − 500 = 1500', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.boolean([part0], [part1], 'fuse')\n`)
    expect(r.failedAt).toBeUndefined()
    const s = r.outputs.get(asPartName('part2')) as Shape
    expect(volumeOf(s)).toBeCloseTo(1500, 3)
  })

  it('A3. boolean common：交集体积 = 500', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.boolean([part0], [part1], 'common')\n`)
    expect(r.failedAt).toBeUndefined()
    const s = r.outputs.get(asPartName('part2')) as Shape
    expect(volumeOf(s)).toBeCloseTo(500, 3)
  })

  it('A4. alignTo anchor:min + target:0：最低点落到 0（原盒本就在 [0,10] ⇒ 不动）', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.alignTo(part1, 'z', { anchor: 'min', target: 0 })\n`)
    expect(r.failedAt).toBeUndefined()
    const s = r.outputs.get(asPartName('part2')) as Shape
    expect(bboxOf(s).zmin).toBeCloseTo(0, 6)
  })

  it('A4b. GOTCHA：alignTo 的 target/anchor 缺省值是 target=0 且 **anchor=center**（非 min）', async () => {
    // dist/index.js:549-553：alignX(shape, target = 0, anchor = "center")。
    // 缺省调用把包围盒**中点**挪到 target，而不是把最低点抬到 target——
    // part1 的 z∈[0,10]（中点 5） ⇒ 缺省 alignTo(part1,'z') 后 zmin = −5。
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.alignTo(part1, 'z')\n`)
    expect(r.failedAt).toBeUndefined()
    const s = r.outputs.get(asPartName('part2')) as Shape
    const b = bboxOf(s)
    expect((b.zmin + b.zmax) / 2).toBeCloseTo(0, 6)
    expect(b.zmin).toBeCloseTo(-5, 6)
  })

  it('A5. alignTo anchor:min + target:0：错开 5 的盒 xmin 5 → 0（整体左移 5）', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.alignTo(part1, 'x', { anchor: 'min', target: 0 })\n`)
    expect(r.failedAt).toBeUndefined()
    const s = r.outputs.get(asPartName('part2')) as Shape
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(0, 6)
    expect(b.xmax).toBeCloseTo(10, 6)
  })

  it('A6. alignTo anchor 三态：min→xmin=target / center→中点在 target / max→xmax=target', async () => {
    const min = await exec(
      'brep',
      TWO_BOXES + `let part2 = cad.alignTo(part1, 'x', { anchor: 'min', target: 100 })\n`,
    )
    const center = await exec(
      'brep',
      TWO_BOXES + `let part2 = cad.alignTo(part1, 'x', { target: 100, anchor: 'center' })\n`,
    )
    const max = await exec(
      'brep',
      TWO_BOXES + `let part2 = cad.alignTo(part1, 'x', { target: 100, anchor: 'max' })\n`,
    )
    expect(min.failedAt).toBeUndefined()
    expect(center.failedAt).toBeUndefined()
    expect(max.failedAt).toBeUndefined()
    const bMin = bboxOf(min.outputs.get(asPartName('part2')) as Shape)
    const bCen = bboxOf(center.outputs.get(asPartName('part2')) as Shape)
    const bMax = bboxOf(max.outputs.get(asPartName('part2')) as Shape)
    expect(bMin.xmin).toBeCloseTo(100, 6)
    expect((bCen.xmin + bCen.xmax) / 2).toBeCloseTo(100, 6)
    expect(bMax.xmax).toBeCloseTo(100, 6)
  })

  it('A7. boolean 直连（TS）：cut 体积 500', async () => {
    const s = await booleanOp([boxA], [boxB], 'cut')
    expect(volumeOf(s)).toBeCloseTo(500, 3)
  })

  it('A8. boolean 直连（TS）：fuzzyValue 选项被接受且不影响交集体积', async () => {
    const s = await booleanOp([boxA], [boxB], 'common', { fuzzyValue: 1e-6 })
    expect(volumeOf(s)).toBeCloseTo(500, 3)
  })

  it('A9. alignTo 直连（TS）：anchor max + target 20 ⇒ xmax 落到 20', async () => {
    const s = await alignTo(boxB, 'x', { target: 20, anchor: 'max' })
    expect(bboxOf(s).xmax).toBeCloseTo(20, 6)
  })
})

describe('S4 布尔扩展族 / 对齐族 — 入参校验（脚本级）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 120000)

  it('B1. boolean 空 args → E_BOOLEAN_NO_ARGS', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.boolean([], [part1], 'cut')\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_BOOLEAN_NO_ARGS/)
  })

  it('B2. boolean 空 tools → E_BOOLEAN_NO_TOOLS', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.boolean([part0], [], 'cut')\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_BOOLEAN_NO_TOOLS/)
  })

  it('B3. boolean 非法算子 → E_BOOLEAN_BAD_KIND', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.boolean([part0], [part1], 'xor')\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_BOOLEAN_BAD_KIND/)
  })

  it('B4. boolean glue 越界 → E_BOOLEAN_BAD_GLUE', async () => {
    const r = await exec(
      'brep',
      TWO_BOXES + `let part2 = cad.boolean([part0], [part1], 'fuse', { glue: 7 })\n`,
    )
    expect(JSON.stringify(r.failedAt)).toMatch(/E_BOOLEAN_BAD_GLUE/)
  })

  it('B5. alignTo 非法轴 → E_ALIGNTO_BAD_AXIS', async () => {
    const r = await exec('brep', TWO_BOXES + `let part2 = cad.alignTo(part0, 'w')\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_ALIGNTO_BAD_AXIS/)
  })

  it('B6. alignTo 非法锚点 → E_ALIGNTO_BAD_ANCHOR', async () => {
    const r = await exec(
      'brep',
      TWO_BOXES + `let part2 = cad.alignTo(part0, 'x', { anchor: 'middle' })\n`,
    )
    expect(JSON.stringify(r.failedAt)).toMatch(/E_ALIGNTO_BAD_ANCHOR/)
  })
})

describe('S4 布尔扩展族 / 对齐族 — 平台身份（脚本级，brepkit 下执行前拒绝）', () => {
  const CALLS: Array<[string, string]> = [
    ['boolean', TWO_BOXES + `let part2 = cad.boolean([part0], [part1], 'cut')\n`],
    ['alignTo', TWO_BOXES + `let part2 = cad.alignTo(part0, 'x')\n`],
  ]

  for (const [op, code] of CALLS) {
    it(`${op}: requires engine occt (current=brepkit)`, async () => {
      __resetEngineRegistriesForTests()
      await registerBrepkitBrepEngine()
      try {
        const result = await exec('brep', code)
        expect(result.failedAt).toBeDefined()
        const msg = JSON.stringify(result.failedAt)
        expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
        expect(msg).toMatch(new RegExp(`op '${op}' requires engine occt`))
      } finally {
        __resetEngineRegistriesForTests()
        await registerOcctBrepEngine()
      }
    })
  }
})

// TS 级直连用（A7/A8/A9）与脚本级正例同处一个 describe：**不另开 describe 重注册
// 引擎**——实测重注册后新建的 L1 句柄仍会在内核侧报 INVALID_SHAPE_ID（arena 与
// 注册批次不同步），故直连用必须与创建它的那次 register 引擎同批。
