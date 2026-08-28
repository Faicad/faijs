/**
 * stdlib 入口 — 库函数命名空间（@faicad/faijs/stdlib）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §2.7
 *
 * 导出全部官方库函数（末参 exec 形态）、Shape 构造器与 schema 表。
 * 库函数签名统一 `(input(s), params, exec) => Promise<Shape>`（创建类无 input），
 * exec 为引擎侧 ExecContext（见 src/cad-runtime/exec-context.ts）。
 */

export { box, sphere, cylinder, cone, wedge } from './primitives'
export { translate, rotate, scale } from './transform'
export { extrude } from './extrude'
export { drill } from './drill'
export { split } from './split'
export { union, subtract, intersect } from './boolean'
export { engrave } from './engrave'
export { text } from './text'
export { screw } from './screw'
export { svgExtrude } from './svgExtrude'
export { knurl } from './knurl'
export { load } from './load'
export { sdf } from './sdf'
export { group, assembly } from './compound'
export { copy } from './copy'
export type { AssemblyBehavior, AssemblyConstraint, FaceMateConstraint } from './compound'
export { faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax } from './geom'
export { asset } from './asset'
export { solid, compound, isShape, isCompound } from './shape'
export type { ShapeSlot, SolidShape, CompoundShape, StdShape, ShapeKind } from './shape'
