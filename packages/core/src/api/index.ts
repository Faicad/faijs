/**
 * L3 API 面（api/）— faijs 库函数命名空间（替代原 packages/stdlib）
 *
 * 设计文档：docs/plans/2026-09-01-layered-api-architecture.md §D1/D2（P6 迁入 core）
 *
 * 导出全部官方库函数、Shape 构造器与 schema 表。
 * 库函数签名 = .fai.js 源码里的调用形态（无隐式参数）；
 * 后端资源经 getBackends() 获取，保留声明经 keep() 表达。
 * 实现来源按 D11：mesh 侧复用 mesh/ 层，brep 侧复用既有 brep/ 层；
 * 缺失 brep 能力时经 D10 桥接调移植树 L2（见各 op 实现）。
 */

export { box, sphere, cylinder, cone, wedge } from './primitives'
// `../3d_editor` 消费面（**不是废弃项**，措辞于 2026-09-22 校正）：transform 家族
// （translate/rotate_euler/scale/scale3d）为编辑器应用提供（拖拽 / 时间线语句），
// 不属 faijs 平台面，但服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**；
// 各 op 的 JSDoc 已带校正后的 @deprecated。
//
// D1（2026-09-23 扩展库拆分，选项 C）：四个 transform op **全部留 core**——
// `translate` 是通用几何变换且是小程序端唯一在用的 transform op，同族不拆散。
export { translate, rotate_euler, scale, scale3d } from './transform'
export { union, subtract, intersect, cut } from './boolean'
export { engrave } from './engrave'
export { chamfer } from './chamfer'
export { fillet } from './fillet'
export { shell, type ShellParams } from './shell'
export { draft, type DraftParams } from './draft'
export { thicken } from './thicken'
export { defeature, reverseShape, unifySameDomain, sew, sewAndSolidify, removeHolesFromFace, type SewParams } from './feature-repair'
export { filletVariable } from './fillet-variable'
export { screw } from './screw'
export { sketch } from './sketch'
export { wire } from './wire'
export { helix } from './helix'
export { split } from './split'
export { sweep } from './sweep'
export { loft } from './loft'
export { knurl } from './knurl'
export { sdf } from './sdf'
// 应用变换（mesh 顶点烘焙）下沉到引擎侧 src/mesh/rigid-transform.ts（E-b：
// 引擎不得 import stdlib/compound；公共 API 经本 re-export 保持）。
export { applyTransform } from '../mesh/rigid-transform'
// P2-f3：装配子层全量导出（solvePreview/entityFromGeometry 等经此到门面）。
// A/B 组 op（fai_* / group / assembly / copy / load / text / svgExtrude）已迁出
// core，见 @faicad/faijs-extra；装配**求解器**（solve/validate/joints/solvers）
// 仍是平台能力，留在此处。
export * from './assembly'
// ── H11：平台几何 op（方案 §4，替代 FCStd 迁移对编辑器 op 的借用）──
export { import_brep } from './import-brep'
export { import_step } from './import-step'
export { compound } from './compound-geom'
export { place } from './place'
export { faceNormal, bboxCenter, bboxMin, bboxMax } from './geom'
export { edgeRef } from './edge-ref'
export { faceRef } from './face-ref'
export { asset } from './asset'
export { solid, isShape, isCompound } from '../shape'
export { compound as structCompound } from '../shape'
export type { ShapeSlot, SolidShape, CompoundShape, CurveShape, StdShape, ShapeKind } from '../shape'

// ── P23：brepjs 兼容面接线（§4.2 / B1 三源一致）──
//
// ① 生成脚本面 op（与 api-namespace 的 cad 面同源：api/generated/script-face.ts）。
//    这批 op 经 `compatOp(projectBrepOp(…))` 包装，faijs 形态（Shape 进 / Shape 出、
//    布尔双形态、brep-only），TS 侧与 `.fai.js` 侧同语义。
export * from './generated/script-face'
// P25: compat extrude/revolve (brep-only, face→prism / face→lathe) share one
// definition between the TS surface and the cad scripting surface. The fcstd
// codegen wires Pad/Pocket/Extrusion/Revolution through these (sketch face →
// cad.extrude / cad.revolve).
// extrude 是平台手写 op（承载 upTo；长度形态委托生成投影）——见 api/extrude.ts；
// revolve 仍直接取生成投影。
export { extrude } from './extrude'
export { revolve } from './generated/operations'
//
// ② brepjs 形态的 TS 兼容面（P21）以 `brepjsCompat` 命名空间整体导出（库作者面：
//    句柄进出、Result 语义）。**op 符号不在此处平铺**——`brepjsCompat.fuse`（brepjs
//    句柄形态）与脚本面 `fuse`（compatOp 包装的 faijs 形态）是同一 vendored
//    实现的两个投影，按「一个名字一份实现」红线（§6.3），平铺面只保留脚本面
//    那份；库作者继续 `import { brepjsCompat } from '@faicad/faijs'` 用上游形态。
//    此处只平铺**无 op 语义**的组合器与纯工具（Result / 向量 / 平面 / 错误 /
//    常量），它们在两个面之间语义一致且无同名冲突。
export {
  ok, err, isOk, isErr, unwrap, unwrapOr,
  vecAdd, vecSub, vecScale, vecDot, vecCross, vecLength, vecNormalize,
  createPlane, createNamedPlane, resolvePlane,
  kernelError, validationError,
  DEG2RAD, RAD2DEG,
} from './brepjs-compat'
export type {
  Result, Ok, Err,
  Vertex, Edge, Wire, Face, Shell, Solid, CompSolid, Shape3D,
  Plane, PlaneName, PlaneInput,
  Vec3, PointInput,
  Bounds3D,
} from './brepjs-compat'
// ── P24（§8.1）：库建造工厂与 Result 组合器平铺。它们不是脚本面 op（不在
//    符号表/`cad` 面），也不是 dual op——是库作者面的函数，与 P23 平铺的纯
//    组合器同一规则（`makeExternalGear`/`thread`/`map` 无同名冲突，§6.3）。
export {
  makeExternalGear, makeInternalGear, makePlanetaryGear, thread,
  map, andThen,
} from './brepjs-compat'
export type {
  ExternalGearParams, InternalGearParams, PlanetaryGearParams,
  GearGeometry, GearResult, PlanetaryGearAssembly, ThreadOptions,
  ValidSolid, ClosedWire,
} from './brepjs-compat'
export * as brepjsCompat from './brepjs-compat'
