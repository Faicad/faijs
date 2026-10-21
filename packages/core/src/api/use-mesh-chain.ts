/**
 * api use-mesh-chain — 脚本级执行链偏好指令（2026-10-22 weapp mesh 链）
 *
 * `.fai.js` 里写 `cad.useMeshChain(true)`，后续语句的执行路径从 auto 规则切到
 * **mesh 链**（网格实体 / 近似拓扑 / brepkit 网格内核），适合"打印件"类模型
 * （人脸浮雕等最终只三角化 3D 打印、不可能 CNC 的几何——用 BREP 精度链没有意义）。
 *
 * 语义：
 * - `true` → 偏好 'mesh'：凡有 mesh 实现即走 mesh 路径（无 mesh 实现的函数如实报
 *   `E_MESH_UNSUPPORTED`，不会静默走 BREP）；
 * - `false` → 清除偏好，回到 auto 规则（brep 实现 + 输入全在精度链 → brep，否则 mesh）；
 * - 只影响 `config.mode === 'auto'` 的分派——宿主显式 mode='brep'/'mesh' 是地板；
 * - 每次全量执行（`runtime.execute`）从零声明：脚本第一行声明即生效，删掉即失效；
 *   update 增量重放沿用前缀声明（见 runtime-state.chainPref 注释）；
 * - 链互斥红线不变：本指令只是"选路径"，混链输入（网格实体 + BREP 实体同一调用）
 *   仍由 `assertMeshSolidInputs` 静态报 `E_MESH_SOLID_MIXED`，绝不静默归约一侧。
 *
 * 本函数是**普通库函数**（非 defineOp）：无几何输入、无 Shape 产物，语句值 undefined，
 * 由 DirectExecutor 的 ctx 值处理容忍（非对象值不登记身份）。
 */
import { setChainPreference } from '../runtime-state'

/**
 * 在脚本里切换执行链：`cad.useMeshChain(true)` 强制后续语句走 mesh 链
 * （网格实体 + 近似拓扑 + brepkit 网格内核）；`cad.useMeshChain(false)` 清除
 * 偏好回到 auto 规则。仅影响 auto 模式下的分派（宿主显式 mode 是地板）。
 *
 * @param enabled - true = 偏好 mesh 链；false / 缺省 = 清除偏好（auto 规则）。
 * @returns undefined（语句值；无几何产物）。
 * @example
 * cad.useMeshChain(true)
 * const head = cad.sphere({ radius: 10 })
 * const tool = cad.cylinder({ ... })
 * const carved = cad.subtract(head, tool)   // mesh 链布尔（brepkit 网格内核）
 */
export function useMeshChain(enabled?: boolean): undefined {
  setChainPreference(enabled === false ? null : 'mesh')
}
