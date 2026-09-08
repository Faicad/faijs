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
 * 比对一个用例（装配一致性比对）。
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
