/**
 * native-history — 引擎是否原生提供某个 `*WithHistory` 面演化核函数。
 *
 * op 实现体内选实现轨（调 `*WithHistory` 还是裸方法）时读这里：这是一条**引擎事实**，
 * 与 op 无关，因此不挂在 op 声明上，也没有任何"能力表"参与——「引擎能不能做这件事」
 * 由引擎身份静态决定，写代码的时刻就是常量。
 *
 * 两个真实引擎的事实（本模块是唯一归属，别处不再声明）：
 * - `occt`：12 个 `*WithHistory` 全有（`occt-wasm@5.6.0` 原生导出）。
 * - `brepkit`：只有 `fuseWithHistory` / `cutWithHistory` / `filletWithHistory`
 *   （`brepkit-kernel/brepkitKernel.ts` 的面演化三员，其余为 `unsupported(...)` 桩）。
 *
 * 未知 / 未装配引擎（含测试替身 `brep_mock`）→ 一律 `false`：拿不到事实时按"没有"处理，
 * 让 op 走裸方法轨（几何仍正确，只是不产面演化），绝不假设引擎有历史。
 *
 * 零重依赖：只读运行期装配配置（引擎 id），不 import 任何平台内核。
 */

import { getBackends } from '../../runtime-state'
import type { BrepEvolutionKind } from './types'

/**
 * 各引擎**原生提供**的面演化核函数（常量表，非运行时探测）。
 *
 * 为什么是常量而不是"探测实现面"：所有适配器的 `*WithHistory` 成员都在 API 对象里
 * **有函数**——没实现的也放一个 `unsupported(...)` 桩，故
 * `typeof api.xWithHistory === 'function'` 恒为真，探测不出"真有还是桩"。
 */
const NATIVE_HISTORY_BY_ENGINE: Readonly<Record<string, readonly BrepEvolutionKind[]>> = {
  occt: [
    'fuseWithHistory',
    'cutWithHistory',
    'intersectWithHistory',
    'filletWithHistory',
    'chamferWithHistory',
    'translateWithHistory',
    'rotateWithHistory',
    'mirrorWithHistory',
    'scaleWithHistory',
    'shellWithHistory',
    'offsetWithHistory',
    'thickenWithHistory',
  ],
  brepkit: ['fuseWithHistory', 'cutWithHistory', 'filletWithHistory'],
}

/**
 * 当前 BREP 引擎是否原生实现该 `*WithHistory`（静态；读引擎身份，不读任何声明表）。
 *
 * @param kind - the evolution kernel function name to test.
 * @returns true when the current engine natively implements it; false otherwise
 * (including when no engine is assembled / the engine is unknown).
 */
export function hasNativeHistory(kind: BrepEvolutionKind): boolean {
  const engineId = getBackends().config.brepEngineId
  return engineId != null && (NATIVE_HISTORY_BY_ENGINE[engineId]?.includes(kind) ?? false)
}
