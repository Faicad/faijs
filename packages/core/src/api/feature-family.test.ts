/**
 * @vitest-environment node
 *
 * Phase 5 — 按面/边选的特征族（shell / draft / thicken / defeature / filletVariable
 * / 修复薄包装）验收。
 *
 * 覆盖：
 * 1. shell 可达 + 成薄壁（bbox 不变、体积严格小于原体）+ 两引擎 bbox parity；
 * 2. draft 可达且**确实改变几何**（回归守卫：修复前 pull/neutral 以元组传入 L1，
 *    两引擎全挂；brepkit 现由静态门在执行前拒绝，见文件头 GOTCHA-3）；
 * 3. filletVariable 在 `r1 == r2` 时与 fillet 等半径**结果等价**（方案 §5.6 验收：
 *    实测二者体积逐位相同 ⇒ 以 1e-6 容差断言，不是空洞的 toBeTruthy）；
 * 4. thicken 平台 op 可达 + 引擎门（D11-4 非目标引擎执行前报错 / D11-3 mock 不拦截）；
 * 5. 修复薄包装（reverseShape / unifySameDomain / sew / removeHolesFromFace）可达且体积守恒；
 * 6. 参数校验：厚度 / 半径 / 角度非法值、draft 的 neutral.normal 无消费者，均执行前报错。
 *
 * GOTCHA-1（Phase 5 实测，L1 向量形态）：L1 的向量形参是 `BrepVec3 = {x,y,z}` **对象**，
 * 不是元组。`draft.ts` 曾直接把 `[0,0,1]` 传进去 ⇒ occt 报空文案 `KERNEL_ERROR: draft:`、
 * brepkit 报 `cannot normalize zero vector`，`cad.draft` 两引擎全不可用。修复 =
 * 显式转 `{x,y,z}`（同 `pattern.ts:41` / `api/helix.ts`）。本文件「draft 确实改变几何」
 * 用例即该 bug 的回归守卫。
 *
 * GOTCHA-2（Phase 5 实测，brepkit 输入侧不可用）：brepkit 下 `cad.sketch` 与 `cad.edgeRef`
 * 不可用（sketch 报 `invalid solid handle: index N is out of bounds`；edgeRef 报
 * `edge 1 has 0 adjacent face(s)`）。故本文件凡以 sketch 面 / edgeRef 为输入的用例都只跑
 * occt —— 失败点会落在输入构造（callee=sketch / edgeRef）而不是被测 op，那样断言毫无意义。
 * 引擎门用例改用 `cad.cylinder`（中立 dual op，brepkit 声明了 makeCylinder）。
 *
 * GOTCHA-3（Phase 5 实测 → **已定案**）：brepkit 侧 `draft` / `reverseShape` 曾是
 * 「静态门放行、运行时出问题」形态。根因：两条只声明族级 `capabilities:['directEdit']`
 * （brepkit 声明了 `directEdit: true`），静态判定无从拦。**定案 = 按实证收窄为
 * `engines: ['occt']`**（非平台依赖；engines 与 capabilities 并存合法，engines 先判），
 * brepkit 直接静态拒绝。证据（同一脚本 box(20,20,10) / angleDeg=3，两引擎同一次运行）：
 *   - occt：4 个侧面（ordinal 1–4）**一致** delta = −52.4078 —— 对称输入 ⇒ 对称输出；
 *     ⊥ pull 的端面由内核报 KERNEL_ERROR；
 *   - brepkit：ordinal 1–5 给 +60.29 / 0 / 0 / +17.47 / 0 —— **对称性被破坏**（序号跨
 *     引擎错配不能解释：对称 box 上拔单个侧面，四个侧面不可能给出不同结果），其中三个
 *     是**静默无操作**（体积与 bbox 均不变），而 ⊥ pull 的端面反而把 x/y 凸包各撑大
 *     0.524（= 10·tan 3°）；
 *   - brepkit `reverseShape` op 级抛 `invalid solid handle: index N is out of bounds`。
 * 本文件两条「brepkit 静态拒绝」用例即该收窄的回归守卫。
 * **未收窄**（证据不足，留档不擅动）：`unifySameDomain`（brepkit 可用但会把体重新居中，
 * 见 GOTCHA-6）、`defeature` / `sew` / `sewAndSolidify` / `removeHolesFromFace`
 * （面输入先撞到 faceRef / 输入构造侧限制，op 级行为未取到干净证据）。
 *
 * GOTCHA-4（Phase 5 实测，parity 边界）：`shell` 两引擎 bbox 完全一致（均为原体 bbox），
 * 但**壁厚语义不同** —— occt vol=2272、brepkit vol=1952（同输入 box20×20×10 / 开面 1 / t=2）。
 * 故 parity 只断言到「bbox 一致 + 两者都确实成了薄壁（0 < vol < 4000）」，不断言体积数值相等。
 *
 * GOTCHA-5（Phase 5 实测，跨引擎测量的陷阱）：BREP 句柄只在**创建它的内核实例**内有效。
 * 若要跨引擎比对同一段脚本的产物，必须在切引擎**之前**把该引擎的量测值取出来；切到
 * brepkit 后再对 occt 的产物调 `getBoundingBox` 会报 `invalid solid handle`。
 *
 * GOTCHA-6（Phase 5 实测，有向体积）：`cad.reverseShape` 反转壳朝向 ⇒ `getVolume` 返回
 * **负**体积（box(10,10,10)：+1000 → −1000）。这是语义正确的表现，不是缺陷；「体积守恒」
 * 断言必须写成 `|vol|`。另注 brepkit 的 `unifySameDomain` 会把体**重新居中**
 * （[0,10]³ → [−5,5]³），与 occt 不同。
 *
 * Run: npx vitest run src/api/feature-family.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import { asPartName } from '../identity'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../brep/engine/adapters/brepkit'
import { registerBrepMockEngine } from '../brep/engine/adapters/brep-mock'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf } from '../shape'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

async function useBrepkit(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
}

async function useBrepMock(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerBrepMockEngine()
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() })
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return makeRuntime(mode).execute(code)
}

/** 执行代码并取回命名产物（失败即抛）。调用方负责先选好引擎。 */
async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

interface BBox {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  zmin: number
  zmax: number
}

/** 产物 BREP 包围盒。 */
function bboxOf(s: Shape): BBox {
  return getBrepApi().getBoundingBox(brepOf(s) as never)
}

/** 产物 BREP 体积（brepkit / occt 均声明 getVolume）。 */
function volOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

/** 包围盒逐界相等（容差 tol）。 */
function expectSameBBox(a: BBox, b: BBox, tol = 1e-6): void {
  for (const k of ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'] as const) {
    expect(Math.abs(a[k] - b[k]), `bbox.${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(tol)
  }
}

/** 方框 sketch 面（10×10 见方，位于 z=0 平面）。 */
const SQUARE_SKETCH =
  'cad.sketch({ contours: [{ segments: [ ' +
  '{ kind: "line", x1: -10, y1: -10, x2: 10, y2: -10 }, ' +
  '{ kind: "line", x1: 10, y1: -10, x2: 10, y2: 10 }, ' +
  '{ kind: "line", x1: 10, y1: 10, x2: -10, y2: 10 }, ' +
  '{ kind: "line", x1: -10, y1: 10, x2: -10, y2: -10 } ] }] })'

/** box(20,20,10) 的体积，多个用例的基准。 */
const BOX_20_20_10_VOL = 4000

describe('shell — 抽壳（中立 op，capabilities 路由）', () => {
  it('box(20,20,10) 开面 1 / t=2 → 成薄壁：bbox 不变、体积严格小于原体', async () => {
    await useOcct()
    const sh = await shapeOf(
      'brep',
      `const p0 = cad.box(20,20,10)\nlet part1 = cad.shell(p0, { openFaces: [cad.faceRef(p0, 1)], thickness: 2 })\n`,
      'part1',
    )
    expectSameBBox(bboxOf(sh), { xmin: 0, xmax: 20, ymin: 0, ymax: 20, zmin: 0, zmax: 10 })
    // 实测 occt=2272：严格小于原体（若成了空壳/无操作则为 0 或 4000，两种都失败）
    const vol = volOf(sh)
    expect(vol).toBeGreaterThan(0)
    expect(vol).toBeLessThan(BOX_20_20_10_VOL)
  })

  it('两引擎 parity：bbox 一致且两侧都确实成薄壁（不断言体积数值相等，见 GOTCHA-4）', async () => {
    const code =
      `const p0 = cad.box(20,20,10)\nlet part1 = cad.shell(p0, { openFaces: [cad.faceRef(p0, 1)], thickness: 2 })\n`
    // ⚠️ GOTCHA-5：BREP 句柄只在**创建它的内核实例**内有效。跨引擎比对必须在切引擎
    // 之前先把该引擎的量测值取出来 —— 否则切到 brepkit 后再对 occt 产物调
    // getBoundingBox 会用 brepkit 内核去解析 occt 的 arena id，报
    // `invalid solid handle: index N is out of bounds`。
    await useOcct()
    const occtShape = await shapeOf('brep', code, 'part1')
    const occtBox = bboxOf(occtShape)
    const occtVol = volOf(occtShape)

    await useBrepkit()
    const bkShape = await shapeOf('brep', code, 'part1')
    const bkBox = bboxOf(bkShape)
    const bkVol = volOf(bkShape)

    expectSameBBox(occtBox, bkBox)
    for (const [name, vol] of [['occt', occtVol], ['brepkit', bkVol]] as const) {
      expect(vol, `${name} shell volume`).toBeGreaterThan(0)
      expect(vol, `${name} shell volume`).toBeLessThan(BOX_20_20_10_VOL)
    }
  })

  it('参数校验：厚度非正 → E_SHELL_BAD_THICKNESS（执行前）', async () => {
    await useOcct()
    const bad = await exec(
      'brep',
      `const p0 = cad.box(10,10,5)\nlet part1 = cad.shell(p0, { openFaces: [], thickness: -1 })\n`,
    )
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt!.message).toMatch(/E_SHELL_BAD_THICKNESS/)
  })
})

describe('draft — 拔模（中立 op；GOTCHA-1 回归守卫）', () => {
  it('box(20,20,10) 面 1 / 3° → 可达且**确实改变几何**（bbox 不变、体积减少）', async () => {
    await useOcct()
    const d = await shapeOf(
      'brep',
      `const p0 = cad.box(20,20,10)\nlet part1 = cad.draft(p0, { faces: [cad.faceRef(p0, 1)], angleDeg: 3 })\n`,
      'part1',
    )
    expectSameBBox(bboxOf(d), { xmin: 0, xmax: 20, ymin: 0, ymax: 20, zmin: 0, zmax: 10 })
    // 实测 occt=3947.5922。3° 拔模必然削掉一小块材料 ⇒ 严格小于原体。
    // 这条同时是 GOTCHA-1（元组 vs BrepVec3）的回归守卫：修复前此调用直接失败。
    const vol = volOf(d)
    expect(vol).toBeLessThan(BOX_20_20_10_VOL)
    expect(vol).toBeGreaterThan(BOX_20_20_10_VOL * 0.97)
  })

  it('occt：4 个侧面拔模给**一致**的 delta（对称性不变量 —— brepkit 违反的正是这条，见 GOTCHA-3）', async () => {
    await useOcct()
    const vols: number[] = []
    for (const ord of [1, 2, 3, 4]) {
      const s = await shapeOf(
        'brep',
        `const p0 = cad.box(20,20,10)\nlet part1 = cad.draft(p0, { faces: [cad.faceRef(p0, ${ord})], angleDeg: 3 })\n`,
        'part1',
      )
      vols.push(volOf(s))
    }
    // 对称体上对单个侧面拔模，四个侧面必然等价 ⇒ 体积两两相等（实测均 3947.5922，
    // delta = −52.4078）。这条不变量是「按实证把 draft 收窄为 occt-only」的依据：
    // brepkit 同一 sweep（面序按几何枚举对齐后仍成立）给 +60.29 / 0 / 0 / +17.47 ——
    // 四值互不相等，对称性被破坏 ⇒ 静态拒绝（见文件头 GOTCHA-3）。
    for (const v of vols) expect(Math.abs(v - vols[0]!)).toBeLessThanOrEqual(1e-6)
    expect(vols[0]!).toBeLessThan(BOX_20_20_10_VOL)
  })

  it('参数校验：角度为 0 → E_DRAFT_BAD_ANGLE（执行前）', async () => {
    await useOcct()
    const bad = await exec(
      'brep',
      `const p0 = cad.box(10,10,10)\nlet part1 = cad.draft(p0, { faces: [cad.faceRef(p0, 1)], angleDeg: 0 })\n`,
    )
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt!.message).toMatch(/E_DRAFT_BAD_ANGLE/)
  })

  it('neutral.normal 无内核消费者 → 显式报错，不静默丢弃（不静默产出错几何）', async () => {
    await useOcct()
    const bad = await exec(
      'brep',
      `const p0 = cad.box(10,10,10)\nlet part1 = cad.draft(p0, { faces: [cad.faceRef(p0, 1)], angleDeg: 3, neutral: { point: [0,0,0], normal: [0,0,1] } })\n`,
    )
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt!.message).toMatch(/E_DRAFT_NEUTRAL_NORMAL_UNUSED/)
  })

  it('occt 侧 neutral 非原点 → 显式报错（occt-wasm 原生无 neutral 形参，见 api/draft.ts @note）', async () => {
    await useOcct()
    const bad = await exec(
      'brep',
      `const p0 = cad.box(10,10,10)\nlet part1 = cad.draft(p0, { faces: [cad.faceRef(p0, 1)], angleDeg: 3, neutral: { point: [0,0,5] } })\n`,
    )
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt!.message).toMatch(/neutral plane is not supported/)
  })

  it('brepkit：draft 被静态门**执行前**拒绝（实证收窄 engines:["occt"]，见 GOTCHA-3）', async () => {
    await useBrepkit()
    const r = await exec(
      'brep',
      `const p0 = cad.box(20,20,10)\nlet part1 = cad.draft(p0, { faces: [cad.faceRef(p0, 1)], angleDeg: 3 })\n`,
    )
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt!.callee).toBe('draft')
    const msg = JSON.stringify(r.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/requires engine occt/)
  })

  it('brep_mock：draft 不被平台身份判定拦截（D11-3 豁免）', async () => {
    await useBrepMock()
    const r = await exec(
      'brep',
      `const p0 = cad.box(20,20,10)\nlet part1 = cad.draft(p0, { faces: [cad.faceRef(p0, 1)], angleDeg: 3 })\n`,
    )
    // 只断言「不是被引擎门拦下的」；mock 内核能不能真拔模不在本用例范围。
    expect(JSON.stringify(r.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })
})

describe('filletVariable — 变半径圆角（方案 §5.6：r1 == r2 与 fillet 等价）', () => {
  it('r1 == r2 == 2 时与 fillet(radius=2) 体积 / bbox 等价（实测逐位相同 ⇒ 1e-6 容差）', async () => {
    await useOcct()
    const v = await shapeOf(
      'brep',
      `const p0 = cad.box(10,10,10)\nlet part1 = cad.filletVariable(p0, cad.edgeRef(p0, 1), 2, 2)\n`,
      'part1',
    )
    const u = await shapeOf(
      'brep',
      `const p0 = cad.box(10,10,10)\nlet part2 = cad.fillet(p0, { edges: [cad.edgeRef(p0, 1)], radius: 2 })\n`,
      'part2',
    )
    // 实测两者 vol 均为 991.4159，bbox 均为 [0,10]^3
    expectSameBBox(bboxOf(v), bboxOf(u))
    expect(Math.abs(volOf(v) - volOf(u))).toBeLessThanOrEqual(1e-6)
    // 圆角必然削掉棱角 ⇒ 体积严格小于原 box(10,10,10)=1000
    expect(volOf(v)).toBeLessThan(1000)
  })

  it('参数校验：半径非正 → E_FILLETVAR_BAD_RADIUS（执行前）', async () => {
    await useOcct()
    const bad = await exec(
      'brep',
      `const p0 = cad.box(10,10,10)\nlet part1 = cad.filletVariable(p0, cad.edgeRef(p0, 1), -1, 2)\n`,
    )
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt!.message).toMatch(/E_FILLETVAR_BAD_RADIUS/)
  })
})

describe('thicken — 加厚（平台 op engines:["occt"]）', () => {
  it('sketch 面 → 实体：bbox 保住面尺寸、体积为正', async () => {
    await useOcct()
    const solid = await shapeOf('brep', `const f0 = ${SQUARE_SKETCH}\nlet part1 = cad.thicken(f0, 2)\n`, 'part1')
    const b = bboxOf(solid)
    expect(Math.abs(b.xmin - -10)).toBeLessThanOrEqual(1e-6)
    expect(Math.abs(b.xmax - 10)).toBeLessThanOrEqual(1e-6)
    expect(Math.abs(b.ymin - -10)).toBeLessThanOrEqual(1e-6)
    expect(Math.abs(b.ymax - 10)).toBeLessThanOrEqual(1e-6)
    expect(volOf(solid)).toBeGreaterThan(0)
  })

  it('参数校验：厚度为 0 → E_THICKEN_BAD_THICKNESS（执行前）', async () => {
    await useOcct()
    const bad = await exec('brep', `const f0 = ${SQUARE_SKETCH}\nlet part1 = cad.thicken(f0, 0)\n`)
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt!.message).toMatch(/E_THICKEN_BAD_THICKNESS/)
  })

  it('brepkit 引擎：非目标引擎**执行前**报错（D11-4；输入用 cylinder 以免失败点落在 sketch，见 GOTCHA-2）', async () => {
    await useBrepkit()
    const r = await exec('brep', 'let part0 = cad.cylinder(4,20)\nlet part1 = cad.thicken(part0, 2)\n')
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt!.callee).toBe('thicken')
    const msg = JSON.stringify(r.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/requires engine occt/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    await useBrepMock()
    const r = await exec('brep', 'let part0 = cad.cylinder(4,20)\nlet part1 = cad.thicken(part0, 2)\n')
    expect(JSON.stringify(r.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })
})

describe('修复薄包装 — reverseShape / unifySameDomain / sew / removeHolesFromFace', () => {
  it('reverseShape(box) 把有向体积翻成负值（朝向反转的语义表现）', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part1 = cad.reverseShape(cad.box(10,10,10))\n`, 'part1')
    // GOTCHA-6（Phase 5 实测）：`cad.reverseShape` 反转壳朝向 ⇒ `getVolume` 返回
    // **有向**体积 -1000（原体 +1000）。这是语义正确的表现，不是缺陷；断言体积守恒
    // 必须写成 |vol|，直接 vol === 1000 会误判（差 2000）。
    const vol = volOf(s)
    expect(vol).toBeLessThan(0)
    expect(Math.abs(Math.abs(vol) - 1000)).toBeLessThanOrEqual(1e-6)
    expectSameBBox(bboxOf(s), { xmin: 0, xmax: 10, ymin: 0, ymax: 10, zmin: 0, zmax: 10 })
  })

  it('unifySameDomain(box) 体积守恒（合并同域面不改形状）', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part1 = cad.unifySameDomain(cad.box(10,10,10))\n`, 'part1')
    expect(Math.abs(volOf(s) - 1000)).toBeLessThanOrEqual(1e-6)
    expectSameBBox(bboxOf(s), { xmin: 0, xmax: 10, ymin: 0, ymax: 10, zmin: 0, zmax: 10 })
  })

  it('sew([face]) / removeHolesFromFace(face) 可达（薄包装确实接到 L1）', async () => {
    await useOcct()
    const sewn = await shapeOf('brep', `const f0 = ${SQUARE_SKETCH}\nlet part1 = cad.sew([f0])\n`, 'part1')
    expectSameBBox(bboxOf(sewn), { xmin: -10, xmax: 10, ymin: -10, ymax: 10, zmin: 0, zmax: 0 })
    const plain = await shapeOf('brep', `const f0 = ${SQUARE_SKETCH}\nlet part1 = cad.removeHolesFromFace(f0)\n`, 'part1')
    expectSameBBox(bboxOf(plain), { xmin: -10, xmax: 10, ymin: -10, ymax: 10, zmin: 0, zmax: 0 })
  })

  it('defeature 空面表 → E_DEFEATURE_NO_FACES（执行前）', async () => {
    await useOcct()
    const bad = await exec('brep', `const p0 = cad.box(10,10,10)\nlet part1 = cad.defeature(p0, [])\n`)
    expect(bad.failedAt).toBeDefined()
    expect(bad.failedAt!.message).toMatch(/E_DEFEATURE_NO_FACES/)
  })

  it('brepkit：reverseShape 被静态门**执行前**拒绝（实证收窄 engines:["occt"]，见 GOTCHA-3）', async () => {
    await useBrepkit()
    const r = await exec('brep', `let part1 = cad.reverseShape(cad.box(10,10,10))\n`)
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt!.callee).toBe('reverseShape')
    const msg = JSON.stringify(r.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/requires engine occt/)
  })
})
