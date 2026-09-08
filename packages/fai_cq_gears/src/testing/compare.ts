/**
 * testing/compare — 封装 `@faicad/cq-compat` 的 STEP 等价性比对
 *
 * 放在 `src/testing/` 而不是库源码里，是因为 `compareStepFiles` 属于**测试期依赖**
 * （`@faicad/cq-compat` 是 devDependency）——库运行时不该依赖它。
 * `tsconfig.build.json` 已排除本目录。
 *
 * 一个事实一个家：容差只在**这里**定义，测试与 `scripts/compare-all.ts` 共用同一份。
 */

import { compareStepFiles, type CompareOptions, type StepCompareResult } from '@faicad/cq-compat'

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
export const CALIBRATED_COMPARE: CompareOptions = {
  strictTopology: false,
  linearTolerance: 1e-3,
  volumeRelativeTolerance: 1e-6,
  booleanVolumeTolerance: 1e-3,
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
 * 比对一个用例。
 *
 * @param input 用例输入（两侧 STEP 路径 + 参考体积）
 * @param overrides 对标定容差的临时覆盖（仅测试诊断用）
 * @returns 五维比对结果
 */
export async function compareCase(
  input: CaseCompareInput,
  overrides: CompareOptions = {},
): Promise<StepCompareResult> {
  return compareStepFiles(input.referenceStep, input.ourStep, {
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
export function formatCompareLine(r: StepCompareResult): string {
  return (
    `${r.fileA.split(/[\\/]/).pop() ?? r.fileA} vs ${r.fileB.split(/[\\/]/).pop() ?? r.fileB}: ` +
    `${r.equivalent ? 'EQUIVALENT' : 'DIFFERENT'} | ` +
    `bbox ${r.bbox.maxDiff.toExponential(3)} | ` +
    `vol ${r.volume.diff.toExponential(3)} (${r.volume.diffPct.toExponential(3)}%) | ` +
    `com ${r.centerOfMass.maxDiff.toExponential(3)} | ` +
    `topo A(${r.topology.a.faces}f/${r.topology.a.edges}e) B(${r.topology.b.faces}f/${r.topology.b.edges}e) | ` +
    `bool A-B ${r.booleanDiff.aMinusB.volume.toExponential(3)} B-A ${r.booleanDiff.bMinusA.volume.toExponential(3)}`
  )
}
