/**
 * mesh — 纯数据几何内核（按模块组织的实现层）
 *
 * See docs/api-contract.md §1 (architecture layers) and §10 (api function catalog).
 *
 * 原则（§5.1）：
 * 1. 全部纯数据：输入输出是 Shape (ManifoldMeshData)，不碰 THREE 场景、不读 store
 * 2. 不可变：每个 API 返回新几何，不修改输入
 * 3. 同步签名、异步执行：API 签名同步（或 async）；worker 边界由 ScriptEngine 处理
 * 4. 坐标系：右手系 +Z 向上、毫米、角度用度
 *
 * ⚠️ B3 补正（2026-10-06，用户决定）：本文件**不再导出任何聚合对象**。
 *
 * 此前这里有一个把 primitives / brep / transform / boolean / engrave / query / io
 * 全量聚合进来的对象（曾名 `cad`，B3 一度改名 `meshCad`）。它把内核实现包装成一个
 * 「形似平台 API」的门面，使下游（含本仓测试）能 `import { cad } from '../mesh'`
 * 把内核当成 faijs 的公开 API——这正是要根除的混淆。改名只是换了张皮，因此聚合
 * 对象已整体删除，不再以任何名字存在。
 *
 * 要哪一层的实现，就从对应模块具名导入：
 * - `mesh/primitives`   box / sphere / cylinder / cone / wedge / screw / sdf
 * - `mesh/transform`    translate / rotate_euler / scale / scale3d / transformMatrix
 * - `mesh/boolean`      union / subtract / intersect
 * - `mesh/engrave`      engrave / knurl
 * - `mesh/query`        boundingBox / bboxCenter / volume / faceAt
 * - `mesh/io`           importFile / detectStepUnit
 * - `brep`、`brep/primitives-brep`  BREP（OCCT）路径
 *
 * 注意：脚本面的 `cad`（宿主经 `registerLib('cad', …)` 注入的 op 命名空间）与这一层
 * 是两回事——它不在这里，也不该被这里 import。见 AGENTS.md「库开发者 vs 脚本开发者」。
 */

// ── 类型导出 ──

export type { Shape, Vec3, BoundingBox, FaceDescriptor } from './types'
export { guessStlUnit } from './stl-unit'
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
