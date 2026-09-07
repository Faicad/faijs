/**
 * api/assembly/types — 装配约束的 faijs 侧类型（P1，方案 §5.2/§5.3）
 *
 * 设计约束（方案 §5.1）：
 * - C1 可序列化：约束参数全部 JSON 安全，写进 .fai.js 文本、跨重放指认同一实体。
 * - C4 a 是参考（reference）、b 是从动（dependent）：移动 b 去贴合 a。
 * - C6 派生值不入库：约束对象不存 transform。
 *
 * 本模块是纯类型层：只依赖 naming 的 TopoRef 类型，不依赖 compound（避免循环）。
 * FaceMateConstraint（遗留形态）也在此定义，compound.ts re-export 保持既有导出面。
 */

import type { PartName } from '../../identity'
import type { FaceTopoRef, EdgeTopoRef } from '../../topology/naming'

/** 3D 向量（mm）。 */
export type AssemblyVec3 = [number, number, number]

// ── 实体引用 EntityRef（§5.2）──

/**
 * 面引用：`{ topoRef }`（首选，宿主拾取生成，跨重放稳定）或
 * 旧快照 `{ surfaceType?, center, normal }`（兼容已持久化的历史脚本 / 手写调试）。
 */
export type FaceRef =
  | { topoRef: FaceTopoRef }
  | { surfaceType?: string; center: AssemblyVec3; normal: AssemblyVec3 }

/**
 * 边引用：`{ topoRef }`（直边 → 轴；圆边 → 轴线）或轴快照 `{ axis }`。
 */
export type EdgeRef =
  | { topoRef: EdgeTopoRef }
  | { axis: { origin: AssemblyVec3; direction: AssemblyVec3 } }

/**
 * 装配实体引用（§5.2）：
 * - 面：平面 → plane 实体；圆柱/回转面 → axis 实体（需 hint.axis）；
 * - 边：直边/圆边 → axis 实体；
 * - 点：局部坐标 → point 实体；
 * - faceIndex：面序号简写（1 起，手写友好但跨拓扑变更不稳定，仅调试）。
 */
export type EntityRef =
  | { part: PartName; face: FaceRef }
  | { part: PartName; edge: EdgeRef }
  | { part: PartName; point: AssemblyVec3 }
  | { part: PartName; faceIndex: number }

// ── 约束类型（§5.3 总表）──

/** 面对面贴合：法向反向 + 面中心重合（遗留 face_mate 的新名；求解降级为 concentric + 轴编码）。 */
export interface MateConstraint {
  type: 'mate'
  a: EntityRef
  b: EntityRef
}

/** 同向对齐：法向同向 + 面中心重合（mate 的不翻转变体）。 */
export interface AlignConstraint {
  type: 'align'
  a: EntityRef
  b: EntityRef
}

/** 共面/共点/共线（brepjs 原生 coincident；保留面内 2 个平移 DOF）。 */
export interface CoincidentConstraint {
  type: 'coincident'
  a: EntityRef
  b: EntityRef
}

/** 轴重合（孔轴配合 / 插入；要求两侧都是轴实体）。 */
export interface ConcentricConstraint {
  type: 'concentric'
  a: EntityRef
  b: EntityRef
}

/** 定距（mm）。 */
export interface DistanceConstraint {
  type: 'distance'
  value: number
  a: EntityRef
  b: EntityRef
}

/** 夹角（deg，plane-plane）。 */
export interface AngleConstraint {
  type: 'angle'
  value: number
  a: EntityRef
  b: EntityRef
}

/** 平行（angle 0° 的语法糖）。 */
export interface ParallelConstraint {
  type: 'parallel'
  a: EntityRef
  b: EntityRef
}

/** 垂直（angle 90° 的语法糖）。 */
export interface PerpendicularConstraint {
  type: 'perpendicular'
  a: EntityRef
  b: EntityRef
}

/** 锚定该部件（地基）。 */
export interface FixedConstraint {
  type: 'fixed'
  part: PartName
}

/** 新形态约束的并集。 */
export type StructuralConstraint =
  | MateConstraint
  | AlignConstraint
  | CoincidentConstraint
  | ConcentricConstraint
  | DistanceConstraint
  | AngleConstraint
  | ParallelConstraint
  | PerpendicularConstraint
  | FixedConstraint

// ── 遗留形态（§2.1，规范化时改写为 mate）──

/**
 * 装配约束的一个面：`{ topoRef: FaceTopoRef }`（§6.2 新形态，执行期解析几何）或
 * 旧快照 `{ surfaceType, center, normal }`（兼容已持久化的历史脚本）。
 */
export type FaceMateFace = { topoRef: FaceTopoRef } | {
  surfaceType?: string
  center: AssemblyVec3
  normal: AssemblyVec3
}

/** A face-mate constraint aligning two faces so the moving face mates against the fixed face. */
export interface FaceMateConstraint {
  type: 'face_mate'
  fixedPartName: PartName
  movingPartName: PartName
  fixedFace: FaceMateFace
  movingFace: FaceMateFace
}

/** `cad.assembly({ constraints })` 接受的全部约束形态（遗留 + 新增）。 */
export type AssemblyConstraint = FaceMateConstraint | StructuralConstraint
