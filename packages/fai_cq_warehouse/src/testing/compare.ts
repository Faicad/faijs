/**
 * testing/compare — 封装 `@faicad/cq-compat` 的 STEP 等价性比对（W3 起用）。
 *
 * 放在 `src/testing/` 而不是库源码里：比对属**测试期依赖**
 * （`@faicad/cq-compat` 是 devDependency），库运行时不依赖它，
 * `tsconfig.build.json` 已排除本目录。
 *
 * 一个事实一个家：**容差只在这里定义**，`src/thread.test.ts` 与
 * `scripts/compare-all.ts` 共用同一份（方案 §7.3 红线：禁止就地放宽消 FAIL）。
 *
 * ⚠️ 比对必须走 `compareAssemblyFiles`（装配一致性比对），不能走 `compareStepFiles`
 * ——后者只比整件 solid 数，区分不了「N 个独立零件」与「1 个 compound」（cq_gears
 * slide_top 案例已实证）。参考 STEP 的 PRODUCT 名是 OCC 默认名，与我们的不同，
 * 故 `matchNames: false`（按索引配对）。
 */

import {
  compareAssemblyFiles,
  type AssemblyCompareOptions,
  type AssemblyCompareResult,
} from '@faicad/cq-compat'

/**
 * 标定后的基线容差（沿用 cq_gears 的标定值，方案 §7.3）。
 *
 * | 维度 | 值 | 依据 |
 * |---|---|---|
 * | `strictTopology` | false | 螺旋/齿面是 B 样条曲面，两侧面数与次数必然不同 |
 * | `linearTolerance` | 1e-3 mm | W3 实测 bbox 最坏 1.75e-6 → 余量 570×（**未放宽**）|
 * | `volumeRelativeTolerance` | 1e-6 | 见下：线程族整体超此值 → **逐类 override**，全局默认不动（§7.3.1：全局默认值只在 W8 调）|
 * | `booleanVolumeTolerance` | 1e-3 | 布尔差不进主判据（`skipFusedBoolean`）|
 *
 * ⚠️ 这些数字是**实测标定的差异量级**，不是「允许的建模误差」。
 */
export const CALIBRATED_COMPARE: AssemblyCompareOptions = {
  strictTopology: false,
  linearTolerance: 1e-3,
  volumeRelativeTolerance: 1e-6,
  booleanVolumeTolerance: 1e-3,
  matchNames: false,
  // 方案 §7.3：螺纹这类**近重合曲面**上整体布尔差不可靠（cq_gears 已证 cut 会返回
  // 反向/垃圾实体），故比对一律跳过融合布尔，判定以逐件体积/质心/bbox 为准。
  skipFusedBoolean: true,
}

/**
 * 逐类容差覆盖（方案 §7.3.1 第 3 步：确属上游方法差异才允许按类 override）。
 *
 * 每条都必须带实测最坏值 + 指向分析文档。**未实测的类不得预先写进来**
 * ——W4–W7 各自标定后追加。
 */
const CASE_TOLERANCE_OVERRIDES: Array<{
  match: RegExp
  options: AssemblyCompareOptions
  reason: string
}> = [
  {
    // 线程族（Thread/IsoThread/AcmeThread/MetricTrapezoidalThread/PlasticBottleThread）。
    // W3 实测（STEP 比对，17 例，2026-09-14）：体积相对差最坏 2.289e-5（iso-m6x1-internal）
    // → 门禁 1e-4 = 实测最坏 ×4.4。线性门禁（bbox+质心共用 1e-3）**不放宽**：
    // bbox 实测最坏 8.74e-7（余量 1144×）。
    // 根因见 docs/analysis/2026-09-14-cq-warehouse-thread-probe.md：
    // 两侧螺旋面都是 B 样条逼近（上游 `Face.makeRuledSurface` vs 我方
    // `approximatePoints` + `loft(ruled)`），曲面表示不同 → 体积天然有差。
    match: /^(thread-|iso-|acme-|mtrap-|pbt-)/,
    options: { volumeRelativeTolerance: 1e-4 },
    reason: 'Thread helical-face B-spline approximation difference (measured worst 2.289e-5, gate 1e-4)',
  },
  {
    // threaded nut：**短内螺纹**上的同一族问题，但求积混叠被放大一个量级。
    // W4 实测（2026-09-14，两侧 STEP 导入同一 occt-wasm 内核；复现台
    // scripts/kernel-nut-probe.ts 段 8，断言在 src/nut.test.ts 反向守卫）：
    //   | 量 | A 侧 | B 侧 | 两侧差 |
    //   |---|---|---|---|
    //   | GProps 体积 | 325.683642 | 324.193032 | 4.577e-3（相对）|
    //   | GProps 质心 | — | — | 5.107e-3 mm |
    //   | **三角化体积** | 325.482500 | 325.482618 | 3.636e-7（相对）|
    //   | **三角化质心** | (0.009951622, 0.007238889, 2.599999332) | (0.009966681, 0.007230606, 2.600000606) | **1.506e-5 mm** |
    // GProps 自偏差：A 6.176e-4 / B 3.978e-3 —— **两侧都不自洽**，故体积与质心两项都不可信。
    // 混叠根源在螺纹面而非融合：B 侧独立内螺纹 M6x1 L=5.2 的 GProps=23.391955 /
    // mesh=23.210013（自偏差 7.778e-3），A 侧同名用例仅 5.902e-4（L=10）——L=5.2 只有
    // 约 5 牙且两端 fade，螺旋面 B 样条逼近的求积在该长度上明显不收敛。
    // 门禁 2e-2：体积 4.577e-3 × 4.37、质心 5.107e-3 × 3.9（与线程族的 4.4× 同政策）。
    // ⚠️ 线性门禁（bbox 与质心共用）在此例被一并放宽——本例 bbox 实测 1.013e-13，
    // 有 11 个数量级余量，放宽不构成风险；几何等价由上面的三角化三项直接证明。
    match: /^nut-hex-m6-iso4032-threaded$/,
    options: { volumeRelativeTolerance: 2e-2, linearTolerance: 2e-2 },
    reason:
      'Short internal thread (L=5.2, fade/fade) GProps quadrature aliasing — both sides evaluate a different helical B-spline approximation, and both are self-inconsistent (A 6.180e-4 / B 3.962e-3). Geometry is equivalent: tessellated volume differs 3.636e-7 and tessellated CoM 1.506e-5 mm',
  },
]

/**
 * 已知 **A 侧**伪差清单（按用例 id）——不是容差放宽，是**显式分类**。
 *
 * 判定机制：`compareAssemblyFiles` 的体积与质心都走 `BRepGProp` 精确曲面积分，
 * 而该积分对**螺旋 B 样条面**存在求积混叠（W3 仲裁：A 侧 Thread raw/raw 的
 * GProps 体积 49.9615 vs 三角化 43.6800，差 14%，且随长度非单调、布尔分割不可加）。
 * 体积已由 `volumeRelativeTolerance` 覆盖（实测两侧同向），但**一阶矩**对该混叠
 * 更敏感：`iso-m10x1.5-fade-square` 两侧**同一内核**测出的 GProps 质心差 0.1508 mm，
 * 而同例的**三角化**质心差仅 4.4e-5 mm，且 A 侧自身 GProps 质心与自身三角化质心
 * 相矛盾（0.143267 vs −0.006756）→ 是 A 侧测量值错，不是我方几何错。
 *
 * 证据（2026-09-14 实测，两侧 STEP 导入同一 occt-wasm 内核）：
 * | 量 | A 侧 | B 侧 |
 * |---|---|---|
 * | GProps 质心 x | +0.143267 | −0.007574 |
 * | **三角化**质心 x | −0.006756 | −0.006787 |
 * | GProps 体积 | 194.521596 | 194.519895 |
 * | 三角化体积 | 194.606211 | 194.607034 |
 */
export const KNOWN_A_SIDE_COM_ARTIFACTS: Readonly<Record<string, string>> = {
  'iso-m10x1.5-fade-square':
    'A-side GProps CoM is self-contradictory (GProps x=+0.143267 vs its own tessellated x=-0.006756); B matches A tessellated to 4.4e-5 mm',
}

/** 已知伪差的分类结论。 */
export interface ArtifactVerdict {
  /** true = 除该项外的全部逐件指标均合格（即 DIFFERENT 由已知伪差解释） */
  artifact: boolean
  /** 分类依据（artifact=false 时为 undefined） */
  reason?: string
}

/**
 * 把 DIFFERENT 分类为「已知 A 侧伪差」。
 *
 * 判据（全部满足才算，缺一不可——与 cq_gears 的 `isFusedBooleanArtifact` 同构）：
 * 1. 结构匹配（leaf 数一致）；
 * 2. 逐件**体积、bbox 全部合格**（伪差只可能出在质心这一项）；
 * 3. 该用例在 `KNOWN_A_SIDE_COM_ARTIFACTS` 白名单内（附证据）。
 *
 * 这是**显式分类**而非放宽容差：白名单为空则等价于无例外；列入必须附实测证据。
 *
 * @param id 用例 id
 * @param r 比对结果
 * @returns 分类结论
 */
export function classifyKnownArtifact(id: string, r: AssemblyCompareResult): ArtifactVerdict {
  if (r.equivalent) return { artifact: false }
  if (!r.structure.match || r.parts.length === 0) return { artifact: false }
  const nonComOk = r.parts.every(
    (p) => p.found && p.volume?.match !== false && p.bbox?.match !== false,
  )
  if (!nonComOk) return { artifact: false }
  const reason = KNOWN_A_SIDE_COM_ARTIFACTS[id]
  return reason ? { artifact: true, reason } : { artifact: false }
}

/**
 * 按用例 id 取逐类容差覆盖。
 *
 * @param id 用例 id（manifest 的 `id` 字段）
 * @returns 覆盖项（叠加在 `CALIBRATED_COMPARE` 之上；无命中返回空对象）
 */
export function toleranceOverridesFor(id: string): AssemblyCompareOptions {
  for (const o of CASE_TOLERANCE_OVERRIDES)
    if (o.match.test(id)) return { ...o.options }
  return {}
}

/** 布尔差容差按参考体积缩放（大件需放缩，但不无上限放宽）。
 *
 * @param refVolume 参考件体积（mm³）
 * @returns 该件适用的布尔差绝对容差（mm³）
 */
export function booleanToleranceFor(refVolume: number): number {
  return Math.max(1e-3, refVolume * 1e-6)
}

/** 单个用例的比对输入（两侧 STEP 路径 + 参考体积）。 */
export interface CaseCompareInput {
  id: string
  referenceStep: string
  ourStep: string
  /** 参考体积，用于放缩布尔差容差 */
  refVolume: number
}

/**
 * 比对一个用例（装配一致性比对）。容差叠加顺序：标定容差 → 布尔差按件放缩 →
 * 逐类覆盖（最后生效，可覆盖前两者）。
 *
 * @param input 用例输入（两侧 STEP 路径 + 参考体积）
 * @param overrides 对最终容差的临时覆盖（仅测试诊断用，勿用于消 FAIL）
 * @returns 四级装配比对结果（structure / per-part / overall）
 */
export async function compareCase(
  input: CaseCompareInput,
  overrides: AssemblyCompareOptions = {},
): Promise<AssemblyCompareResult> {
  return compareAssemblyFiles(input.referenceStep, input.ourStep, {
    ...CALIBRATED_COMPARE,
    booleanVolumeTolerance: booleanToleranceFor(input.refVolume),
    ...toleranceOverridesFor(input.id),
    ...overrides,
  })
}

/** 把比对结果压成一行（测试失败信息 / 报告表共用）。
 *
 * @param r 比对结果
 * @returns 单行文本摘要
 */
export function formatCompareLine(r: AssemblyCompareResult): string {
  const vol = r.parts[0]?.volume
  const com = r.parts[0]?.centerOfMass
  const bb = r.parts[0]?.bbox
  return (
    `${r.fileA.split(/[\\/]/).pop() ?? r.fileA} vs ${r.fileB.split(/[\\/]/).pop() ?? r.fileB}: ` +
    `${r.equivalent ? 'EQUIVALENT' : 'DIFFERENT'} | ` +
    `leaves ${r.structure.leafCountA} vs ${r.structure.leafCountB} (${r.structure.match ? 'ok' : 'MISMATCH'}) | ` +
    `bbox ${bb ? bb.maxDiff.toExponential(3) : 'n/a'} | ` +
    `vol ${vol ? vol.diffPct.toExponential(3) : 'n/a'}% | ` +
    `com ${com ? com.maxDiff.toExponential(3) : 'n/a'}`
  )
}
