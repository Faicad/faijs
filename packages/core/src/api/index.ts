/**
 * L3 API 面（api/）— faijs 库函数命名空间（替代原 packages/stdlib）
 *
 * 设计文档：docs/plans/2026-09-01-layered-api-architecture.md §D1/D2（P6 迁入 core）
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * 导出全部官方库函数、Shape 构造器与 schema 表。
 * 库函数签名 = .fai.js 源码里的调用形态（无隐式参数）；
 * 后端资源经 getBackends() 获取，保留声明经 keep() 表达。
 * 实现来源按 D11：mesh 侧复用 mesh/ 层，brep 侧复用既有 brep/ 层；
 * 缺失 brep 能力时经 D10 桥接调移植树 L2（见各 op 实现）。
 */

export { box, sphere, cylinder, cone, wedge } from './primitives'
export { translate, rotate_euler, scale } from './transform'
export { fai_extrude } from './fai_extrude'
export { fai_drill } from './fai_drill'
export { fai_split } from './fai_split'
export { union, subtract, intersect } from './boolean'
export { engrave } from './engrave'
export { chamfer } from './chamfer'
export { text } from './text'
export { screw } from './screw'
export { svgExtrude } from './svgExtrude'
export { knurl } from './knurl'
export { load } from './load'
export { sdf } from './sdf'
export { group, assembly } from './compound'
export { solveFaceMate, applyTransform } from './compound'
export { copy } from './copy'
export type { AssemblyBehavior, AssemblyConstraint, FaceMateConstraint } from './compound'
export { faceNormal, bboxCenter, bboxMin, bboxMax } from './geom'
export { asset } from './asset'
export { solid, compound, isShape, isCompound } from '../shape'
export type { ShapeSlot, SolidShape, CompoundShape, StdShape, ShapeKind } from '../shape'
