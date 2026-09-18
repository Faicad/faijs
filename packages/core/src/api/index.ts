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
export { translate, rotate_euler, scale, scale3d } from './transform'
export { fai_extrude } from './fai_extrude'
export { fai_drill } from './fai_drill'
export { fai_split } from './fai_split'
export { union, subtract, intersect } from './boolean'
export { engrave } from './engrave'
export { chamfer } from './chamfer'
export { fillet } from './fillet'
export { text } from './text'
export { screw } from './screw'
export { svgExtrude } from './svgExtrude'
export { sketch } from './sketch'
export { knurl } from './knurl'
export { load } from './load'
export { sdf } from './sdf'
export { group, assembly } from './compound'
export { applyTransform } from './compound'
// P2-f3：装配子层全量导出（solvePreview/entityFromGeometry 等经此到门面；
// 与 ./compound 显式导出重名（assembly/AssemblyConstraint 等）时显式优先，不报错）
export * from './assembly'
export { copy } from './copy'
export type {
  AssemblyBehavior, AssemblyConstraint, FaceMateConstraint, FaceMateFace,
  AssemblySolveResult,
  EntityRef, FaceRef, EdgeRef, AssemblyVec3,
  MateConstraint, AlignConstraint, CoincidentConstraint, ConcentricConstraint,
  DistanceConstraint, AngleConstraint, ParallelConstraint, PerpendicularConstraint,
  FixedConstraint, StructuralConstraint,
} from './compound'
export { faceNormal, bboxCenter, bboxMin, bboxMax } from './geom'
export { edgeRef } from './edge-ref'
export { asset } from './asset'
export { solid, compound, isShape, isCompound } from '../shape'
export type { ShapeSlot, SolidShape, CompoundShape, StdShape, ShapeKind } from '../shape'

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
