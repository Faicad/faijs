/**
 * L3 API 面（api/）— faijs 库函数命名空间
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
export { splitByPlane, type SplitByPlaneParams } from './split-by-plane'
export { sectionByPlane, type SectionByPlaneParams } from './section-by-plane'
export { screw } from './screw'
export { profile, buildProfileShape, assertProfileParams } from './profile'
export type { ProfileLineSeg, ProfileArcSeg, ProfileSeg, ProfileLoop, ProfileParams } from './profile'
export { sketchOnPlane, buildSketchOnPlaneWith } from './sketch-on-plane'
export { sketchOnFace, buildSketchOnFaceWith } from './sketch-on-face'
export { punchHole, buildPunchHole, punchSolidOf } from './punch-hole'
export type { SketchOnPlaneParams, PlaneSpec } from './sketch-on-plane'
export { wire } from './wire'
export { helix } from './helix'
export { split } from './split'
export { sweep, type SweepOptions, type SweepOrientation, type SweepGuideContact, type SweepLawKind } from './sweep'
export { loft } from './loft'
// S3（occt-wasm op 接入）：控制点阵 → B 样条面（平台 op engines:['occt']）。
export { surface, type SurfaceOptions } from './surface'
// S3（occt-wasm op 接入）：2D 轮廓偏置 → 1D 轮廓（平台 op engines:['occt']）。
export { offset2d, type Offset2DOptions, type Offset2DJoinType } from './offset2d'
// S3（occt-wasm op 接入）：面集一次成型为实体（平台 op engines:['occt']）。
export { solidFromFaces, type SolidFromFacesParams } from './solid-from-faces'
// S3（occt-wasm op 接入）：无限半空间实体（平台 op engines:['occt']，作无界布尔工具）。
export { halfSpace, type HalfSpaceParams } from './half-space'
// S3（occt-wasm op 接入）：导出族——STL（中立，纯数据序列化）/ BREP 文本（平台 op engines:['occt']）。
export { exportStl, type ExportStlOptions } from './export-stl'
export { exportBrep } from './export-brep'
// S4（occt-wasm op 接入）：类型判定谓词族（平台 op engines:['occt']，布尔返回）。
// 仅平铺不与 ../shape 既有 TS 守卫同名者；`isCompound` 与 ../shape#isCompound 同名，
// 只在 cad 脚本面（api-namespace）暴露，避免本桶重复导出。
export { isEdge, isFace, isShell, isVertex, isWire, isCompSolid, isEqual } from './shape-type'
// S4 视图与导出族（平台 op engines:['occt']，字符串/Uint8Array 返回）：平铺到 TS 桶。
export { toSVG, toMultiviewSVG, toPNG, toMultiviewPNG } from './view-export'
// S4（occt-wasm op 接入）：曲线与草图构造族（平台 op engines:['occt']，方案 §3.4.1）。
export {
  edge, circleArc, ellipseEdge, ellipseArc, tangentArc,
  approximatePoints, interpolateWithTangents,
  curveDegreeElevate, curveKnotInsert, curveKnotRemove, curveIsPeriodic,
} from './curve-sketch'
// S4（occt-wasm op 接入）：曲面与面构造族（平台 op engines:['occt']，方案 §3.4.2）。
export { faceOnSurface, nonPlanarFace, makeSolid, reverseSurfaceU, outerWire } from './surface-face'
// S4（occt-wasm op 接入）：实体与偏置族剩余（平台 op engines:['occt']，方案 §3.4.4）。
export { draftPrism, pipe } from './solid-offset'
export { knurl } from './knurl'
export { sdf } from './sdf'
// 应用变换（mesh 顶点烘焙）下沉到引擎侧 src/mesh/rigid-transform.ts（E-b：
// 引擎不得 import api/compound；公共 API 经本 re-export 保持）。
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
export type { Shape } from '../mesh/types'
// PBR 外观规格（设计文档 2026-10-05 v2 §4.1）：类型供宿主/第三方消费；
// 归一化/合并纯函数供编辑器映射（faijsAppearanceToHost）与导出复用。
export type { PbrAppearance, PbrColor, PbrAlphaMode, MaterialSpec, ShapeAppearanceMethods } from './appearance'
export { mergeAppearance, normalizeColor } from './appearance'
// 零件/文件级说明性元数据（设计文档 2026-10-05-meta）：类型供宿主/第三方消费；
// 合并纯函数供编辑器映射与导出复用。
export type { ShapeMeta, FileMeta, ShapeMetaMethods } from './meta'
export { mergeMeta } from './meta'

// ── P23：brepjs 兼容面接线（§4.2 / B1 三源一致）──
//
// ① 生成脚本面 op（与 api-namespace 的 cad 面同源：api/generated/script-face.ts）。
//    这批 op 经 `defineOp({ brep: __own_* })` 直连 core 自有实现，faijs 形态（Shape 进 / Shape 出、
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
// ② 2026-09-25 core-decouple：brepjsCompat 命名空间与全部 op 投影随旧
//    子包删除（§5.5 第 3 条，裁决 9）。此处只平铺**无 op 语义**的组合器与纯工具
//    （Result / 向量 / 平面 / 错误 / 常量），它们为 core 内联实现（§5.2），
//    在两个面之间语义一致且无同名冲突。
export {
  ok, err, isOk, isErr, unwrap, unwrapOr,
  vecAdd, vecSub, vecScale, vecDot, vecCross, vecLength, vecNormalize,
  createPlane, createNamedPlane, resolvePlane,
  kernelError, validationError,
  DEG2RAD, RAD2DEG,
} from './geom-types'
export type {
  Result, Ok, Err,
  BrepError,
  Plane, PlaneName, PlaneInput,
  Vec3, PointInput,
} from './geom-types'
// ── 2026-09-25 core-decouple：旧库建造工厂（makeExternalGear /
//    makeInternalGear / makePlanetaryGear / thread）与其句柄类型
//    （Vertex/Edge/…/Shape3D/ValidSolid/Bounds3D/Gear*）随裁决 9 删除；
//    Result 组合器 map/andThen 为 core 内联（§5.2），保留平铺；
//    brepjsCompat 命名空间整体删除（§5.5 第 3 条）。
export { map, andThen } from './geom-types'
// ── 2026-09-25 core-decouple wrapup §2.2：sheetmetal 拓扑查询 / 构造 / 测量
//    出口（faijs 风格，裁决 3 补进公开导出）。isValid 不在此面——cad 脚本面
//    已有同语义出口（见 brep-topology.ts 头部注释）。同步测量（measureVolume
//    / measureArea / measureLength）为 api/generated/measurement.ts 第一方
//    同步版，一并平铺（cad 面的 volume/area/length 为 async 脚本面重命名）。
export * from './brep-topology'
// CadQuery 拓扑选择器子系统（独立物理边界，与 topo-resolve 隔离）：
// 等价搬运自 cq-compat，子路径直达 @faicad/faijs/api/cadquery-selectors。
export * from './cadquery-selectors'
export { measureVolume, measureArea, measureLength } from './generated/measurement'
