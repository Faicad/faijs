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

import { brepOf, meshSolidOf } from '../../shape'
import { getBrepApi } from '../../brep/handle-bridge'
import { getBackends } from '../../runtime-state'
import type { MeshSolidBackend } from '../../brep/mesh-solid'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { Shape } from '../../mesh/types'
import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'

/** 量测目标：句柄 + 读它的内核（精度链用 BREP 引擎，网格链用网格后端）。 */
interface MeasurementTarget {
  /** 读该句柄的 L1 契约面。 */
  readonly kernel: BrepEngineApi
  /** 被量测的句柄。 */
  readonly handle: BrepHandle
  /** 量测所在链（`mesh` = 网格零件，量的是面片几何）。 */
  readonly chain: 'brep' | 'mesh'
}

/**
 * 取量测目标：精度链句柄优先，其次是网格零件句柄；两者都没有 → 显式报错。
 *
 * 网格零件（方案 2026-10-01 §4 Phase 4 / B4 批）走**网格后端**的 L1 内核。它的
 * 量测值是对**面片几何**的精确量（STL 的曲面本来就是离散的：立方体 1000 与解析值
 * 一致，圆柱侧面则是 32 个面片之和）——不是对原始设计的还原，也不是估算。所以
 * 这里如实量、如实说，不额外加"近似"折扣，也不静默返回 0。
 *
 * @param shape - the shape being measured.
 * @param op - the measurement op name (error messages).
 * @returns the handle to measure plus the kernel that can read it.
 * @throws {Error} `E_MEASUREMENT_NO_HANDLE` when the shape carries neither chain handle.
 */
function requireMeasurementTarget(shape: Shape, op: string): MeasurementTarget {
  const brep = brepOf(shape) as BrepHandle | undefined
  if (brep !== undefined) {
    return { kernel: getBrepApi(), handle: brep, chain: 'brep' }
  }
  const mesh = meshSolidOf(shape) as BrepHandle | undefined
  if (mesh !== undefined) {
    const backend = getBackends().kernel.meshSolid as MeshSolidBackend | undefined
    if (!backend) {
      throw new Error(
        `[faijs/measurement] ${op}: E_MESH_SOLID_UNSUPPORTED: this shape is a mesh solid but no mesh ` +
        'backend is assembled in this host',
      )
    }
    return { kernel: backend.kernel, handle: mesh, chain: 'mesh' }
  }
  throw new Error(
    `[faijs/measurement] ${op}: E_MEASUREMENT_NO_HANDLE: measurement requires a shape with a chain handle ` +
    '(a bare mesh has neither a BREP handle nor a mesh solid handle)',
  )
}

/**
 * 测量形状的表面积（L1 getSurfaceArea，两引擎同口径）。
 *
 * @param shape - 被测量的形状（Face / Shape3D / compound / 网格零件）。
 * @returns 表面积（mm²；网格零件按面片几何计）。
 */
export async function area(shape: Shape): Promise<number> {
  const t = requireMeasurementTarget(shape, 'area')
  return t.kernel.getSurfaceArea(t.handle)
}

/**
 * 测量形状的边长/线长（L1 getLength，两引擎同口径）。
 *
 * 口径 = **shape 中所有唯一 edge 的弧长之和**：edge 取自身弧长，wire 取其边之和，
 * face 取边界边之和，solid 取全部边之和，compound 取各子实体之和。两个 BREP 引擎
 * 在此口径下逐位一致（2026-10-02 归一化，见 occt / brepkit 适配器的 getLength）。
 *
 * @param shape - 被测量的形状（edge / wire / face / solid / compound）。
 * @returns 长度（mm）。
 */
export async function length(shape: Shape): Promise<number> {
  const t = requireMeasurementTarget(shape, 'length')
  return t.kernel.getLength(t.handle)
}

/**
 * 测量形状的体素体积（L1 getVolume，两引擎同口径）。
 *
 * @param shape - 被测量的形状（solid / compound；对 wire / face 内核按自身口径计，可能返回 0）。
 * @returns 体积（mm³；网格零件按面片几何计）。
 */
export async function volume(shape: Shape): Promise<number> {
  const t = requireMeasurementTarget(shape, 'volume')
  return t.kernel.getVolume(t.handle)
}

/**
 * 测量形状的质心（L1 getCenterOfMass，两引擎同口径）。
 *
 * @param shape - 被测量的形状（solid / compound / face / 网格零件）。
 * @returns 质心坐标（mm，BREP 中立形态 {x,y,z}）。
 */
export async function centerOfMass(shape: Shape): Promise<BrepVec3> {
  const t = requireMeasurementTarget(shape, 'centerOfMass')
  return t.kernel.getCenterOfMass(t.handle)
}
