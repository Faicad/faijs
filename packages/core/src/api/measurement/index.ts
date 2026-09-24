/**
 * measurement — cad 脚本面测量 op（Phase 7，narrowing plan §Phase 7 / Q4）
 *
 * 补齐 §1.5 的反向缺口：BrepEngineApi 的 L1 测量面（getSurfaceArea / getLength）
 * 在脚本面此前没有任何入口——脚本里量不出面积、长度。本模块提供两个**中立**测量
 * op（走 getBrepApi() 的 L1 契约面，occt / brepkit / 小程序端同一份 .fai.js 都可跑）：
 *   - area(shape)         → 表面积（getSurfaceArea）；
 *   - length(shape)       → 边长/线长（getLength）；
 *   - volume(shape)       → 体积（getVolume）；
 *   - centerOfMass(shape) → 质心坐标（getCenterOfMass，BrepVec3 {x,y,z}）。
 *
 * 与 vendored 测量面（api/generated/measurement.ts 的 measureArea / measureLength）
 * 的区别：那些 op 经 l3-bridge 借入层 + vendored 函数绑定 occt-wasm，整体 occt-only
 * （Phase 6 已声明 engines: ['occt']）；本模块直接调 L1 方法，无借入层、无引擎绑定，
 * 是脚本面的中立测量入口。返回纯数字，不产出 Shape、不消费 shape。
 *
 * 三源一致（B1）：本模块经 arg-spec 的 `scriptFace: true` 条目（kind 'faijs'）登记，
 * 由 gen-l3-surface.ts re-export 进 api/generated/script-face.ts / script-face-manifest.ts，
 * gen-symbol-table.ts 同步 check() 符号表——cad 命名空间、manifest、符号表三处同源。
 */

import { brepOf } from '../../shape'
import { getBrepApi } from '../../brep/handle-bridge'
import type { Shape } from '../../mesh/types'
import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'

/** 读该 Shape 的 BREP 句柄；mesh-only 输入在测量前显式报错（不静默降级）。 */
function requireBrepHandle(shape: Shape, op: string): BrepHandle {
  const h = brepOf(shape)
  if (h === undefined) {
    throw new Error(
      `[faijs/measurement] ${op}: E_BREP_ONLY_INPUT: measurement requires a BREP-backed shape (mesh-only input has no BREP handle)`,
    )
  }
  return h as BrepHandle
}

/**
 * 测量形状的表面积（L1 getSurfaceArea，两引擎同口径）。
 *
 * @param shape - 被测量的形状（Face / Shape3D / compound）。
 * @returns 表面积（mm²）。
 */
export async function area(shape: Shape): Promise<number> {
  const h = requireBrepHandle(shape, 'area')
  return getBrepApi().getSurfaceArea(h)
}

/**
 * 测量形状的边长/线长（L1 getLength，两引擎同口径）。
 *
 * @param shape - 被测量的形状（edge / wire / solid，solid 按内核口径计边）。
 * @returns 长度（mm）。
 */
export async function length(shape: Shape): Promise<number> {
  const h = requireBrepHandle(shape, 'length')
  return getBrepApi().getLength(h)
}

/**
 * 测量形状的体素体积（L1 getVolume，两引擎同口径）。
 *
 * @param shape - 被测量的形状（solid / compound；对 wire / face 内核按自身口径计，可能返回 0）。
 * @returns 体积（mm³）。
 */
export async function volume(shape: Shape): Promise<number> {
  const h = requireBrepHandle(shape, 'volume')
  return getBrepApi().getVolume(h)
}

/**
 * 测量形状的质心（L1 getCenterOfMass，两引擎同口径）。
 *
 * @param shape - 被测量的形状（solid / compound / face）。
 * @returns 质心坐标（mm，BREP 中立形态 {x,y,z}）。
 */
export async function centerOfMass(shape: Shape): Promise<BrepVec3> {
  const h = requireBrepHandle(shape, 'centerOfMass')
  return getBrepApi().getCenterOfMass(h)
}
