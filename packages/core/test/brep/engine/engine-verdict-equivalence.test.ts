/**
 * @vitest-environment node
 *
 * 判决等价性：旧「能力门」判决 == 新「engines」判决（方案 §6.1，R1 的直接证据）
 *
 * 背景（2026-10-08 删除 `capabilities` 声明轴）：op 在某个引擎上「可执行 / 执行前静态
 * 拒绝」的判决必须**逐 op 不变**。旧判决由两部分叠加：
 *   (a) 引擎门（`engines`）——HEAD 时已存在的部分，语义不变；
 *   (b) 能力门——`op.capabilities ⊆ engine.declared` 求交，缺失即拒。
 * 本文件把 (b) 的**基线**（HEAD 时的 op→能力 与 brepkit 声明面）冻结成常量，逐 op 计算
 * 旧判决，再与当前 `ARG_SPEC.engines` 推出的新判决做**集合相等**断言——取代人工核对。
 *
 * 为什么基线必须冻结成字面量而不是「从代码里读」：声明轴已经删除，代码里不再有该数据；
 * 而「判决不变」这一命题只有对照删除前的数据才可证。常量表逐项注明了快照来源，任何
 * 后续增删都会让本文件 diff 出来。
 *
 * 常量表的正确性由**本测试自身**交叉验证：`HEAD_ENGINE_GATED_BREP_OPS` ∪
 * `HEAD_CAPABILITIES` 必须覆盖全部 `kind:'brep-op'` 条目（见下方第一个用例），
 * 否则说明基线漏抄，判决等价性无从谈起。
 *
 * 等价性命题的作用域 = occt 与 brepkit。**唯一**一处判决变化落在 `brep_mock`（测试替身）：
 * 旧能力门对 mock 同样生效（HEAD 时 mock 声明 `capabilities: {}`），故凡声明过能力的 op 在
 * mock 上一律被静态拒绝；新设计没有第二条声明轴，且 engine 门本就豁免 mock（D11-3）。
 * 该差集在文件末尾单独钉住，运行时的可观察面由 `engine-switch.test.ts` 覆盖。
 *
 * Run: npx vitest run src/brep/engine/engine-verdict-equivalence.test.ts
 */

import { describe, it, expect } from 'vitest'
import { ARG_SPEC } from '../../../src/api/surface/arg-spec'
import { BREP_ENGINE_IDS } from '../../../src/brep/engine/types'

/**
 * 快照：HEAD（删除前）`packages/core/src/api/surface/arg-spec.ts` 中
 * `kind:'brep-op'` 条目的 `capabilities` 声明。共 17 条。
 */
const HEAD_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  torus: ['dispose', 'makeTorus'],
  roof: ['buildTriFace', 'dispose', 'fixShape', 'isValid', 'sew', 'sewAndSolidify'],
  drill: ['makeCylinder', 'located', 'getBoundingBox', 'cut'],
  pocket: ['getSubShapes', 'surfaceCenterOfMass', 'uvBounds', 'surfaceNormal', 'makeFace', 'translate', 'extrude', 'cut'],
  boss: ['getSubShapes', 'surfaceCenterOfMass', 'uvBounds', 'surfaceNormal', 'makeFace', 'translate', 'extrude', 'fuse'],
  mirrorJoin: ['mirror', 'fuse'],
  convexHull: ['hullFromPoints'],
  makeBaseBox: ['makeRectangle', 'extrude'],
  ellipsoid: ['makeEllipsoid', 'translate'],
  rotate: ['transform'],
  mirror: ['mirror'],
  clone: ['copyShape'],
  applyMatrix: ['transform', 'generalTransform'],
  locate: ['composeTransform', 'dispose', 'hashCode', 'locate'],
  section: ['sectionByPlane', 'makeCompound'],
  fixShape: ['fixShape'],
  healSolid: ['healSolid'],
}

/**
 * 快照：HEAD（删除前）`packages/core/src/brep/engine/adapters/brepkit.ts` 声明的
 * 能力名全集 = `evolution` 三员 + `methods` 名单 + `heal`/`directEdit` 两个为真的族级布尔
 * （`engineCapabilitySet` 只收这五个布尔）。
 */
const HEAD_BREPKIT_DECLARED: readonly string[] = [
  // evolution 三员（:47）
  'fuseWithHistory', 'cutWithHistory', 'filletWithHistory',
  // 族级布尔 true（:126-127）
  'heal', 'directEdit',
  // methods 名单（:48-125）
  'addHolesInFace', 'getBoundingBox', 'getVolume', 'getSurfaceArea', 'getLength', 'getCenterOfMass',
  'surfaceCenterOfMass', 'curveParameters', 'curvePointAtParam', 'curveTangent',
  'cut', 'fixShape', 'fuse', 'fuseAll', 'hashCode', 'healSolid', 'intersect', 'makeCylinder',
  'makeEllipsoid', 'makeTorus', 'makeVertex', 'mirror', 'shell', 'hullFromPoints', 'makeFace',
  'makeLineEdge', 'makeArcEdge', 'makeBezierEdge', 'makeCircleEdge', 'makeWire',
  'linearPattern', 'circularPattern', 'gridPattern', 'scale', 'sewAndSolidify',
  'surfaceNormal', 'surfaceType', 'translate', 'uvBounds', 'dispose', 'copyShape',
  'makeRectangle', 'extrude', 'transform', 'generalTransform',
  'sectionByPlane', 'makeCompound', 'located', 'getSubShapes',
]

/**
 * 快照：HEAD（删除前）arg-spec 中**已**声明 `engines:['occt']` 的 `kind:'brep-op'` 条目
 * （18 条）。这批在当时就由引擎门拒绝，本次不新增、不删除。
 */
const HEAD_ENGINE_GATED_BREP_OPS: readonly string[] = [
  'fuse', 'extrude', 'revolve', 'sweep', 'complexExtrude', 'twistExtrude',
  'linearPattern', 'circularPattern', 'gridPattern', 'rectangularPattern', 'thread',
  'split', 'shell', 'offset', 'heal', 'simplify', 'autoHeal', 'fixSelfIntersection',
]

/** HEAD 时 occt 声明的 12 个 `*WithHistory`（`adapters/occt.ts:33-46`，全集）。 */
const OCCT_HISTORY = new Set([
  'fuseWithHistory', 'cutWithHistory', 'intersectWithHistory', 'filletWithHistory',
  'chamferWithHistory', 'translateWithHistory', 'rotateWithHistory', 'mirrorWithHistory',
  'scaleWithHistory', 'shellWithHistory', 'offsetWithHistory', 'thickenWithHistory',
])

const BREPKIT_DECLARED = new Set(HEAD_BREPKIT_DECLARED)
const BREP_OPS = ARG_SPEC.filter((e) => e.kind === 'brep-op')

/** 旧能力门判决：声明的每个能力名都被 brepkit 声明 ⇒ 放行；否则拒绝。 */
function headCapabilityGateBlocksOnBrepkit(name: string): boolean {
  const caps = HEAD_CAPABILITIES[name] ?? []
  return caps.some((c) => !BREPKIT_DECLARED.has(c))
}

/** 新判决：声明了 engines 且不含 brepkit ⇒ 拒绝。 */
function newGateBlocksOnBrepkit(e: (typeof BREP_OPS)[number]): boolean {
  const engines = e.engines
  return engines !== undefined && engines.length > 0 && !engines.includes('brepkit')
}

describe('基线自洽：常量表覆盖全部 brep-op', () => {
  it('HEAD_ENGINE_GATED_BREP_OPS ∪ HEAD_CAPABILITIES 覆盖每条 brep-op（无漏抄）', () => {
    const covered = new Set<string>([...HEAD_ENGINE_GATED_BREP_OPS, ...Object.keys(HEAD_CAPABILITIES)])
    const uncovered = BREP_OPS.filter((e) => !covered.has(e.name)).map((e) => e.name)
    expect(uncovered, '基线漏抄（HEAD 时该 op 应至少命中一条声明轴）').toEqual([])
    // 反向：基线里的名字都必须在 arg-spec 里存在（防抄错名字）。
    const names = new Set(BREP_OPS.map((e) => e.name))
    expect([...covered].filter((n) => !names.has(n))).toEqual([])
    expect(Object.keys(HEAD_CAPABILITIES)).toHaveLength(17)
  })

  it('快照的引擎 id 合法（与 BREP_ENGINE_IDS 一致）', () => {
    expect([...BREP_ENGINE_IDS]).toEqual(['occt', 'brepkit', 'brep_mock'])
  })
})

describe('R1 判决等价：brepkit 上的拒绝集合逐 op 相等', () => {
  it('旧判决（引擎门 ∪ 能力门）== 新判决（engines 排除 brepkit）', () => {
    const oldBlocked = BREP_OPS.filter(
      (e) => HEAD_ENGINE_GATED_BREP_OPS.includes(e.name) || headCapabilityGateBlocksOnBrepkit(e.name),
    ).map((e) => e.name)
    const newBlocked = BREP_OPS.filter(newGateBlocksOnBrepkit).map((e) => e.name)
    expect([...newBlocked].sort()).toEqual([...oldBlocked].sort())
  })

  it('差集为空即无新增/无遗漏；被拦者恰为 {roof, locate} ∪ 既存 engines 条目', () => {
    const oldBlocked = new Set(
      BREP_OPS.filter(
        (e) => HEAD_ENGINE_GATED_BREP_OPS.includes(e.name) || headCapabilityGateBlocksOnBrepkit(e.name),
      ).map((e) => e.name),
    )
    const newBlocked = new Set(BREP_OPS.filter(newGateBlocksOnBrepkit).map((e) => e.name))
    // 新增拦截（过度收窄 → 对外行为变化）
    expect([...newBlocked].filter((n) => !oldBlocked.has(n))).toEqual([])
    // 丢失拦截（漏收窄 → 静态放行后死在运行时）
    expect([...oldBlocked].filter((n) => !newBlocked.has(n))).toEqual([])
    // 唯二由能力门转成引擎门的条目
    const converted = [...newBlocked].filter((n) => !HEAD_ENGINE_GATED_BREP_OPS.includes(n))
    expect(converted.sort()).toEqual(['locate', 'roof'])
  })
})

describe('R1 判决等价：occt 上一切照旧（无人被拦）', () => {
  it('没有任何 brep-op 的 engines 排除 occt（occt 声明面是全集）', () => {
    const blockedOnOcct = BREP_OPS.filter(
      (e) => e.engines !== undefined && e.engines.length > 0 && !e.engines.includes('occt'),
    ).map((e) => e.name)
    expect(blockedOnOcct).toEqual([])
  })

  it('旧能力门在 occt 上恒不拦（HEAD 时 occt 声明了全部 *WithHistory 与方法名）', () => {
    const blockedOnOcctOld = Object.keys(HEAD_CAPABILITIES).filter((n) =>
      (HEAD_CAPABILITIES[n] ?? []).some((c) => c.endsWith('WithHistory') && !OCCT_HISTORY.has(c)),
    )
    expect(blockedOnOcctOld).toEqual([])
  })
})

/**
 * 快照：HEAD（删除前）**手写 op** 的 `capabilities` 声明（`api/boolean.ts` /
 * `api/pattern.ts` / `api/replicate.ts` / 各 `*directEdit*` 文件 / `packages/sketch/src/op.ts`）。
 * 这些 op 当时都不带 `engines`，判决完全由能力门决定。
 */
const HEAD_HANDWRITTEN_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  union: ['fuseWithHistory'],
  cut: ['cutWithHistory'],
  subtract: ['cutWithHistory'],
  linearPattern: ['linearPattern'],
  circularPattern: ['dispose', 'fuseAll', 'gridPattern', 'hashCode', 'linearPattern', 'surfaceCenterOfMass', 'surfaceNormal', 'surfaceType', 'uvBounds'],
  gridPattern: ['dispose', 'fuseAll', 'gridPattern', 'hashCode', 'linearPattern', 'surfaceCenterOfMass', 'surfaceNormal', 'surfaceType', 'uvBounds'],
  rectangularPattern: ['dispose', 'fuse', 'fuseAll', 'fuseWithHistory', 'hashCode', 'surfaceCenterOfMass', 'surfaceNormal', 'surfaceType', 'uvBounds'],
  mirrorJoin: ['mirror', 'fuse'],
  mirror: ['mirror'],
  clone: ['copyShape', 'dispose'],
  // 族级 directEdit（draft / punchHole / sketchOnFace / sketchOnPlane / sectionByPlane /
  // splitByPlane / profile / fillet / filletVariable / feature-repair 六条 / sketch）
  directEditFamily: ['directEdit'],
}

describe('R1 判决等价：手写 op（HEAD 时全由能力门判定，brepkit 全放行）', () => {
  it('手写 op 声明的能力名 brepkit 全部具备 ⇒ 旧判决 = 放行', () => {
    for (const [op, caps] of Object.entries(HEAD_HANDWRITTEN_CAPABILITIES)) {
      expect(caps.filter((c) => !BREPKIT_DECLARED.has(c)), `手写 op '${op}' 在 brepkit 上曾被拦`).toEqual([])
    }
  })

  it('这些 op 现均为中立（无 engines）⇒ 新判决同样放行', () => {
    // 一一对应关系由 arg-spec 侧同名条目 + 源文件删除守卫（arg-spec-capabilities.test.ts）
    // 共同覆盖；此处钉住"手写 op 没有任何一条新增 engines 白名单"这一事实的可观察面：
    // 凡 arg-spec 中同名条目存在且未声明 engines 的，即为中立。
    const neutralProjections = BREP_OPS.filter(
      (e) => Object.prototype.hasOwnProperty.call(HEAD_HANDWRITTEN_CAPABILITIES, e.name),
    ).filter((e) => (e.engines ?? []).length > 0)
      .map((e) => e.name)
    // linearPattern / circularPattern / gridPattern / rectangularPattern 的历史条目带
    // engines:['occt']（HEAD 时既是引擎门又是能力门，两者都不拦 brepkit 之外的语义由
    // 上方集合相等覆盖）；它们不属于"新增白名单"。
    expect(neutralProjections.filter((n) => !HEAD_ENGINE_GATED_BREP_OPS.includes(n))).toEqual([])
  })
})

/**
 * 快照：HEAD（删除前）`packages/core/src/brep/engine/adapters/brep-mock.ts:462-464`
 * 的 `capabilities: {}` —— **空**声明面（原注释：brep-mock lacks evolution/heal/assembly）。
 * 能力门不看引擎身份，故它当时同样拦 mock；只有 engine 门才豁免 mock（D11-3）。
 */
const HEAD_BREP_MOCK_DECLARED: readonly string[] = []

describe('唯一判决变化：brep_mock（测试替身）上的能力门拦截消失', () => {
  it('HEAD 时 17 条 arg-spec op 因 mock 声明面为空而在 mock 上被静态拒绝', () => {
    const blockedOnMock = Object.entries(HEAD_CAPABILITIES)
      .filter(([, caps]) => caps.some((c) => !HEAD_BREP_MOCK_DECLARED.includes(c)))
      .map(([name]) => name)
    expect(blockedOnMock.sort()).toEqual(Object.keys(HEAD_CAPABILITIES).sort())
  })

  it('拦截名单全是 arg-spec 里的真实 brep-op（无幽灵名）', () => {
    const names = new Set(BREP_OPS.map((e) => e.name))
    expect(Object.keys(HEAD_CAPABILITIES).filter((n) => !names.has(n))).toEqual([])
  })
})
