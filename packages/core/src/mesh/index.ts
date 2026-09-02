/**
 * mesh — 纯数据几何 API 统一入口
 *
 * See docs/api-contract.md §1 (architecture layers) and §10 (stdlib function catalog).
 *
 * 原则（§5.1）：
 * 1. 全部纯数据：输入输出是 Shape (ManifoldMeshData)，不碰 THREE 场景、不读 store
 * 2. 不可变：每个 API 返回新几何，不修改输入
 * 3. 同步签名、异步执行：API 签名同步（或 async）；worker 边界由 ScriptEngine 处理
 * 4. 坐标系：右手系 +Z 向上、毫米、角度用度
 *
 * P1 阶段：mesh 是对现有纯函数的薄包装层，行为完全不变。
 * P3+ 阶段：mesh 将由 ScriptEngine 驱动，在 worker 中执行。
 */

import * as primitives from './primitives'
import * as brepPrimitives from '../brep/primitives-brep'
import * as brepOps from '../brep'
import * as booleanOps from './boolean'
import * as splitOps from './fai_split'
import * as drillOps from './fai_drill'
import * as extrudeOps from './fai_extrude'
import * as engraveOps from './engrave'
import * as transformOps from './transform'
import * as queryOps from './query'
import * as ioOps from './io'

// ── 统一 cad API 对象 ──

/**
 * Unified `cad` API object aggregating the pure-data mesh operations: mesh and
 * BREP primitives, transforms, booleans, splits, drill/extrude/engrave/knurl,
 * geometry queries, file IO, and BREP feature operations.
 */
export const cad = {
  // 创建（mesh 路径）
  box: primitives.box,
  sphere: primitives.sphere,
  cylinder: primitives.cylinder,
  cone: primitives.cone,
  wedge: primitives.wedge,
  text: primitives.text,
  screw: primitives.screw,
  svgExtrude: primitives.svgExtrude,
  sdf: primitives.sdf,

  // 创建（BREP 路径 — OCCT 精确实体三角化）
  boxBrep: brepPrimitives.boxBrep,
  sphereBrep: brepPrimitives.sphereBrep,
  cylinderBrep: brepPrimitives.cylinderBrep,
  coneBrep: brepPrimitives.coneBrep,
  wedgeBrep: brepPrimitives.wedgeBrep,

  // 变换
  translate: transformOps.translate,
  rotate: transformOps.rotate,
  scale: transformOps.scale,
  transformMatrix: transformOps.transformMatrix,

  // 布尔
  union: booleanOps.union,
  subtract: booleanOps.subtract,
  intersect: booleanOps.intersect,

  // 分割
  fai_split: splitOps.split,
  fai_splitWithParams: splitOps.splitWithParams,
  dovetailSplit: splitOps.dovetailSplit,
  dowelSplit: splitOps.dowelSplit,
  tenonSplit: splitOps.tenonSplit,

  // 钻孔
  fai_drill: drillOps.drill,

  // 拉伸
  fai_extrude: extrudeOps.extrude,

  // 雕刻
  engrave: engraveOps.engrave,
  knurl: engraveOps.knurl,

  // 查询
  boundingBox: queryOps.boundingBox,
  bboxCenter: queryOps.bboxCenter,
  volume: queryOps.volume,
  faceAt: queryOps.faceAt,

  // IO
  load: ioOps.importFile,

  // BREP 特征操作（Phase 2 — OCCT 精确实体运算）
  translateBrep: brepOps.translateBrep,
  rotateBrep: brepOps.rotateBrep,
  scaleBrep: brepOps.scaleBrep,
  fuseBrep: brepOps.fuseBrep,
  cutBrep: brepOps.cutBrep,
  commonBrep: brepOps.commonBrep,
  drillBrep: brepOps.drillBrep,
  splitBrep: brepOps.splitBrep,
  extrudeBrep: brepOps.extrudeBrep,
  loadBrep: brepOps.loadBrep,
  solidToShape: brepOps.solidToShape,
}

// ── 类型导出 ──

export type { Shape, Vec3, BoundingBox, FaceDescriptor } from './types'
export type {
  BoxParams, SphereParams, CylinderParams, ConeParams, WedgeParams,
  TextParams, SvgExtrudeParams, SdfParams,
  DrillParams, ExtrudeParams, EngraveParams, KnurlParams,
  SplitPlane, SplitResult, DovetailSplitParams, DowelSplitParams, TenonSplitParams,
} from './types'

// BREP ops 类型导出
export type {
  BrepChainState, DrillBrepParams, SplitBrepParams, SplitBrepResult,
  ExtrudeBrepParams,
} from '../brep'
export {
  createBrepChainState, initBrepChainState, releaseBrepChainState,
  solidToShape,
  isCadFormat,
} from '../brep'
