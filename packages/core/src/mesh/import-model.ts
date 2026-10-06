/**
 * ImportModel — 一次文件导入的完整结构数据（非几何）。
 *
 * 方案 2026-10-06-step-3mf-multipart-import-plan.md §5.1：
 * - `ImportModel` 描述「一次导入」的零件身份表 + 装配层级 + 文件元数据；
 * - 与 `compounds` / `detectedUnits` 同层，不进 `.fai.js`、不参与几何运算、
 *   不影响确定性（内容由文件决定）；
 * - 几何由 `cad.load` 返回的 Shape（单零件）或 CompoundShape.children
 *   （多零件，children 序 = `parts.index` 一一对应）承载。
 *
 * R5 边界（显示/导出判别，衔接草图方案）：`ImportPart.exportable` 默认 true；
 * 仅显示几何（草图等）由草图方案置 false——宿主「导出依据场景树」红线据此过滤。
 */

import type { UnitName } from '../units'
import type { FileMeta, ShapeMeta } from '../api/meta'

/** 一次导入中的一个零件（身份数据；几何在 Shape/CompoundShape.children 对应下标）。 */
export interface ImportPart {
  /** 零件在本次导入中的序号（0 起，等于 load 返回 compound.children 的下标）。 */
  index: number
  /** 零件名（STEP XCAF label / 3MF `<object name>`；无则回退 `imported:<index>`）。 */
  name: string
  /** 显示色 sRGB 0..1（STEP STYLED_ITEM / 3MF basematerials）。 */
  color?: [number, number, number]
  /** 3MF `<object id>`（Bambu 视图变换查表键）。 */
  objectId?: string
  /** Bambu part id（`objectId:partId` 查 importTransforms 键；经父 object components 关联）。 */
  partId?: string
  /** Bambu 盘号（多盘分组依据）。 */
  plateId?: number
  /** Bambu 挤出机序号（1 起）。 */
  extruder?: number
  /** 零件级说明性元数据（复用 ShapeMeta）。 */
  meta?: ShapeMeta
  /** 是否可导出（R5）：默认 true；仅显示几何（草图等）由草图方案置 false。 */
  exportable?: boolean
}

/** STEP 装配层级节点（XCAF 树 / syntheticGroup 合成节点；DFS 序与 parts 顺序一致）。 */
export interface ImportAssemblyNode {
  name: string
  /** 叶节点：指向 parts 下标。 */
  partIndex?: number
  /** 装配/合成节点：子节点（DFS 序与 parts 顺序一致）。 */
  children?: ImportAssemblyNode[]
}

/** Bambu 显示视图数据（仅 3MF）：多盘布局 / print·assembly·import 视图 delta。
 *  显示通道删除后宿主不再解析 3mf archive，视图数据必须由 faijs 结果承载。
 *  字段覆盖宿主（ModelGroup view delta / 多盘布局 / 挤出机材质）的完整消费面，
 *  宿主经 `bambuViewsToMetadata` 重建 Bambu3mfMetadata 时无需再回读 archive。 */
export interface ImportBambuViews {
  /** 盘号列表（升序、去重）。 */
  plates: number[]
  /** `<assemble>` 装配视图位姿（键 = objectId）。 */
  assembleTransforms?: Record<string, { transform: number[]; offset: [number, number, number] }>
  /** per-part 导入位姿（键 = `objectId:partId`）。 */
  importTransforms?: Record<string, { matrix: number[]; sourceOffset: [number, number, number] }>
  /** `<build>` 打印视图 item 表（print 布局位姿判定用）。 */
  buildItems?: Array<{ objectId: string; transform: number[] | null }>
  /** 挤出机颜色表（下标 = extruder-1，材质继承用）。 */
  filamentColors?: string[]
  filamentTypes?: string[]
  /** per-part 身份表（序 = ImportModel.parts = compound.children；view delta 键匹配用）。 */
  parts?: Array<{
    partIndex: number
    objectId: string
    partId: string
    name: string
    extruder: number
    plateId: number
  }>
}

/** 一次文件导入的完整结构产物。 */
export interface ImportModel {
  format: 'step' | '3mf' | 'stl' | 'brep'
  /** 文件声明单位（元数据；坐标已是基准值）。 */
  unit: UnitName | null
  /** 整体级元数据（文件级；无声明则省略）。 */
  fileMeta?: FileMeta
  /** 零件表，顺序与 load 返回 compound.children 一致（单零件时长度 1）。 */
  parts: ImportPart[]
  /** STEP 装配层级（XCAF 树）；无装配结构时省略。 */
  assembly?: ImportAssemblyNode
  /** Bambu 显示视图数据（仅 3MF）。 */
  bambuViews?: ImportBambuViews
}
