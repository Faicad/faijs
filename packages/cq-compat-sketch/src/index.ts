/**
 * @faicad/cq-compat-sketch — CadQuery Sketch layer for faijs（Phase 2 落点）。
 *
 * 本包镜像 CadQuery 的独立模块边界（cadquery 源码 sketch.py:133 `class Sketch`
 * + constrain/solve + occ_impl/sketch_solver.py `SketchConstraintSolver`）：
 * 约束驱动、参数化求解的 2D 草图。与主包 @faicad/cq-compat 的 Workplane
 * 2D 绘图（过程式无约束：rect/circle/line/arc/spline 等）是不同层次——
 * Sketch = 约束求解，Workplane 绘图 = 过程式造型。
 *
 * 当前状态：骨架包（Phase 2 落点）。Sketch 兼容面（Sketch 类、
 * sketch()/placeSketch()/constrain() 求解、与 Workplane 互转）在
 * docs/plans/2026-09-22-cq-compat-max-cadquery-support-plan.md §5 Phase 2 落地。
 */

export {}
