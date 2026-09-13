/**
 * testing/compare — 封装 `@faicad/cq-compat` 的 STEP 等价性比对
 *
 * 放在 `src/testing/` 而不是库源码里，是因为比对属于**测试期依赖**
 * （`@faicad/cq-compat` 是 devDependency）——库运行时不该依赖它。
 * `tsconfig.build.json` 已排除本目录。
 *
 * 一个事实一个家：容差只在**这里**定义，测试与 `scripts/compare-all.ts` 共用同一份。
 *
 * ⚠️ 比对方法：**所有 STEP 比对必须走装配一致性比对（compareAssemblyFiles）**，
 * 不能走 compareStepFiles——后者只比整件总 solid 数，无法区分「N 个独立零件」与
 * 「1 个 compound 的 N 个 solid」（slide_top 案例：2 parts vs 1 compound 错误通过）。
 * 参考 STEP 的 PRODUCT 名是 OCC 默认名（"Open CASCADE STEP translator …"），与
 * 我方 "SOLID" 不同，故 `matchNames: false`（按索引配对单零件；leaf 数一致性仍生效）。
 */

import { compareAssemblyFiles, type AssemblyCompareOptions, type AssemblyCompareResult } from '@faicad/cq-compat'

/**
 * 标定后的容差（2026-09-08 P0 实测，见
 * `docs/analysis/2026-09-08-fai-cq-gears-spike.md`）。
 *
 * | 维度 | 值 | 依据 |
 * |---|---|---|
 * | `strictTopology` | **false** | 齿面是 B-spline 曲面，两侧表示（次数/节点/面数）必然不同；mini_lathe 的做法同此 |
 * | `linearTolerance` | 1e-3 mm | 实测 bbox/质心差 ≪ 1e-6；留 3 个数量级余量 |
 * | `volumeRelativeTolerance` | 1e-6 | 实测体积相对差 4e-12（直齿）/ 1.4e-7（斜齿） |
 * | `booleanVolumeTolerance` | `max(1e-3, vol×1e-6)` | 布尔差是绝对量，随件体缩放 |
 *
 * ⚠️ 这些数字是**实测标定的差异量级**，不是「允许的建模误差」。
 *    放宽前必须先出实测数据并写进分析文档——静默放宽是红线。
 */
export const CALIBRATED_COMPARE: AssemblyCompareOptions = {
  strictTopology: false,
  linearTolerance: 1e-3,
  volumeRelativeTolerance: 1e-6,
  booleanVolumeTolerance: 1e-3,
  matchNames: false,
  // 方案 §9.2：布尔差是绝对量、**不进门禁主判据**；且 occt-wasm 对近重合 B 样条面
  // 的融合 cut 既可能返回反向实体（bp-angled-helix B−A=−1.319、cgp-basic ≈整件体积，
  // 见 docs/analysis/2026-09-13-fai-cq-gears-crossed-pair-phase-scan.md）又可能挂死
  // wasm（case03 后 30+ 分钟无输出，进程只能强杀）。故比对一律跳过融合布尔，
  // 以逐件（体积/质心/bbox）指标为判定。
  skipFusedBoolean: true,
}

/**
 * 逐类容差覆盖（方案 §10 第 3 步：逐类设容差而非全局放宽）。
 *
 * 只收录**已写分析文档、有全精度实测数据**的类；每条注明实测最坏值与依据。
 * 共同根因：齿面是 B-spline 逼近（cq 用 makeSplineSurface / makeSplineApprox，
 * 我方走 row-approx-loft / grid-approx），两侧逼近曲线/曲面必然不同，体积差随
 * 齿面螺旋度放大。线性门禁（bbox/com 1e-3）**不在此放宽**——超差的用例在
 * T2 报表中记为已知偏差（见 docs/analysis/2026-09-13-fai-cq-gears-t2-full-rerun.md）。
 */
const CASE_TOLERANCE_OVERRIDES: Array<{ match: RegExp; options: AssemblyCompareOptions; reason: string }> = [
  {
    // Bevel 族（单体 case08–case13 + 齿轮对 bp-*）：实测最坏单体 1.9e-4（case11，
    // surface_splines=12）、齿轮对逐件 1.415e-5；门禁 5e-4 = 实测最坏 ×2.6。
    // 见 docs/analysis/2026-09-12-fai-cq-gears-bevel-precision.md
    match: /^(case\d+-BevelGear|bp-)/,
    options: { volumeRelativeTolerance: 5e-4 },
    reason: 'Bevel tooth-face B-spline approximation difference (measured worst 1.9e-4, gate 5e-4)',
  },
  {
    // Worm：grid-approx 策略（逐行 loft 的行间误差被螺旋面放大，见 worm_gear.ts），
    // 实测 1.411e-3（worm-basic）/ 3.112e-4（worm-2threads）；门禁 2e-3 = 最坏 ×1.4。
    match: /^worm-/,
    options: { volumeRelativeTolerance: 2e-3 },
    reason: 'Worm helical face grid-approx difference (measured worst 1.411e-3, gate 2e-3)',
  },
  {
    // Rack 族（case23–case28）：实测最坏 4.61e-4（case26）；门禁 1e-3 = ×2.2。
    match: /^case2[345678]-/,
    options: { volumeRelativeTolerance: 1e-3 },
    reason: 'Rack straight-flank approximation difference (measured worst 4.61e-4, gate 1e-3)',
  },
  {
    // CrossedHelical（case29/30 + cgp- + hgp-）：实测最坏 2.99e-4（case30）；门禁 1e-3 = ×3.3。
    match: /^(case29|case30|cgp-|hgp-)/,
    options: { volumeRelativeTolerance: 1e-3 },
    reason: 'Crossed-helical twist-face approximation difference (measured worst 2.99e-4, gate 1e-3)',
  },
  {
    // Herringbone（case05/06 + hb- + hbring- + hpg-）：实测最坏 1.04e-5；门禁 1e-4 = ×9.6。
    match: /^(case05|case06|hb-|hbring-|hpg-)/,
    options: { volumeRelativeTolerance: 1e-4 },
    reason: 'Herringbone V-tooth approximation difference (measured worst 1.04e-5, gate 1e-4)',
  },
  {
    // RingGear（case14–case19）：实测最坏 5.8e-5（case19）；门禁 1e-4 = ×1.7。
    match: /^case1[456789]-/,
    options: { volumeRelativeTolerance: 1e-4 },
    reason: 'Ring internal-tooth approximation difference (measured worst 5.8e-5, gate 1e-4)',
  },
  {
    // SpurGear（case00–case04/07 + spur-*）：实测最坏 1.95e-6（case02）；门禁 1e-5 = ×5。
    match: /^(case\d{2}-SpurGear|spur-)/,
    options: { volumeRelativeTolerance: 1e-5 },
    reason: 'Spur involute approximation difference (measured worst 1.95e-6, gate 1e-5)',
  },
]

/**
 * 按用例 id 取逐类容差覆盖（无命中返回空对象）。
 *
 * @param id 用例 id（manifest 的 `id` 字段）
 * @returns 覆盖项（叠加在 `CALIBRATED_COMPARE` 之上）
 */
export function toleranceOverridesFor(id: string): AssemblyCompareOptions {
  for (const o of CASE_TOLERANCE_OVERRIDES) {
    if (o.match.test(id)) return { ...o.options }
  }
  return {}
}

/** 布尔差容差按参考体积缩放（大件需要放缩，但不无上限放宽）。
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
 * 逐类覆盖（`toleranceOverridesFor`，最后生效，可覆盖前两者）。
 *
 * @param input 用例输入（两侧 STEP 路径 + 参考体积）
 * @param overrides 对标定容差的临时覆盖（仅测试诊断用）
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

/** 把比对结果压成一行（测试失败信息 / 报告表都用它）。
 *
 * @param r 比对结果
 * @returns 单行文本摘要
 */
export function formatCompareLine(r: AssemblyCompareResult): string {
  const vol = r.parts[0]?.volume
  const com = r.parts[0]?.centerOfMass
  const bb = r.parts[0]?.bbox
  const bool = r.overall.booleanDiff
  return (
    `${r.fileA.split(/[\\/]/).pop() ?? r.fileA} vs ${r.fileB.split(/[\\/]/).pop() ?? r.fileB}: ` +
    `${r.equivalent ? 'EQUIVALENT' : 'DIFFERENT'} | ` +
    `leaves ${r.structure.leafCountA} vs ${r.structure.leafCountB} (${r.structure.match ? 'ok' : 'MISMATCH'}) | ` +
    `bbox ${bb ? bb.maxDiff.toExponential(3) : 'n/a'} | ` +
    `vol ${vol ? vol.diffPct.toExponential(3) : 'n/a'}% | ` +
    `com ${com ? com.maxDiff.toExponential(3) : 'n/a'} | ` +
    `bool A-B ${bool.aMinusB.toExponential(3)} B-A ${bool.bMinusA.toExponential(3)}`
  )
}

/**
 * 判定一个 DIFFERENT 是否为「融合布尔差数值伪差」（已知 occt-wasm 缺陷）。
 *
 * 判据（全部满足才算，缺一不可）：
 * 1. 结构匹配（leaf 数一致）；
 * 2. **逐件**体积 / 质心 / bbox 全部在容差内（伪差的本质：逐件几何全对，
 *    唯 `BRepAlgoAPI_Cut` 对近重合 B 样条面返回反向/垃圾实体，使 overall 布尔差
 *    ≈ 整件体积）。
 *
 * 这是**显式分类**而非放宽容差：布尔项不参与等价判定时，逐件指标仍是硬门禁。
 * 依据与相位扫描实证见 `docs/analysis/2026-09-13-fai-cq-gears-crossed-pair-phase-scan.md`。
 *
 * @param r 比对结果
 * @returns true = 伪差（除融合布尔外全部指标合格）
 */
export function isFusedBooleanArtifact(r: AssemblyCompareResult): boolean {
  if (r.equivalent || !r.structure.match) return false
  if (r.parts.length === 0) return false
  return r.parts.every((p) =>
    p.found &&
    p.volume?.match !== false &&
    p.centerOfMass?.match !== false &&
    p.bbox?.match !== false,
  )
}
