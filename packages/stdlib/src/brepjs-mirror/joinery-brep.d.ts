/**
 * BREP 榫卯结构操作 — 用 OCCT 精确实体复刻 mesh 路径的榫卯布尔序列
 *
 * 设计文档：docs/plans/2026-08-11-split-joinery-brep-plan.md
 *
 * 与 mesh 路径（joinery-shapes.ts + csg-worker.ts）对照：
 * - mesh 路径：buildWedgeGeometry/buildDowelGeometry/buildStraightTenonGeometry → Manifold CSG
 * - BREP 路径：buildWedgeSolid/buildDowelSolid/buildTenonSolid → OCCT fuse/cut/common
 *
 * 坐标框架与 mesh 路径完全一致：
 * - normal: 切割平面法线（单位向量，指向上方）
 * - widthDir: 挤出方向（单位向量）
 * - depthDir = normalize(cross(normal, widthDir))
 * - planeCenter: 切割平面中心
 *
 * 所有函数都是纯函数，输入输出均为 OCCT ShapeHandle，调用方负责句柄生命周期。
 */
import type { OcctKernel, ShapeHandle } from 'occt-wasm';
import type { Vec3 } from '@faicad/faijs-core/mesh/types';
/** 榫卯操作的坐标框架（与 joinery-shapes.ts 一致） */
export interface JoineryBasis {
    /** 切割平面法线（单位向量） */
    normal: Vec3;
    /** 宽度/挤出方向（单位向量） */
    widthDir: Vec3;
    /** 深度方向 = normalize(cross(normal, widthDir)) */
    depthDir: Vec3;
    /** 切割平面中心 */
    planeCenter: Vec3;
    /** 平面原点偏移 = dot(normal, planeCenter) */
    originOffset: number;
}
/**
 * 梯形棱柱（燕尾楔）— BREP 等价物。
 *
 * 复刻 joinery-shapes.ts buildWedgeGeometry 的 8 顶点拓扑：
 * - 梯形截面在 normal-depthDir 平面
 * - 底边（宽）在 planeCenter - normal*depth
 * - 顶边（窄）在 planeCenter
 * - 沿 widthDir 拉伸 extrudeLength，居中于 planeCenter
 *
 * 用 kernel.makeLineEdge + makeWire + makeFace + extrude 构造实体，
 * 然后用 transform 对齐到世界坐标系。
 */
export declare function buildWedgeSolid(kernel: OcctKernel, basis: JoineryBasis, depth: number, width: number, angleDeg: number, extrudeLength: number): ShapeHandle;
/**
 * 圆柱（定位销）— BREP 等价物。
 *
 * 复刻 joinery-shapes.ts buildDowelGeometry：
 * - 圆截面在 widthDir-depthDir 平面，中心在 centroid
 * - 从切割平面向下延伸 height（沿 -normal）
 *
 * 用 kernel.makeCylinder + transform 对齐方向。
 */
export declare function buildDowelSolid(kernel: OcctKernel, centroid: Vec3, basis: JoineryBasis, diameter: number, height: number): ShapeHandle;
/**
 * 长方体（直榫）— BREP 等价物。
 *
 * 复刻 joinery-shapes.ts buildStraightTenonGeometry：
 * - 方截面在 widthDir-depthDir 平面，中心在 centroid
 * - 从切割平面向下延伸 height（沿 -normal）
 *
 * 用 kernel.makeBoxFromCorners + transform 对齐方向。
 */
export declare function buildTenonSolid(kernel: OcctKernel, centroid: Vec3, basis: JoineryBasis, sideLength: number, height: number): ShapeHandle;
/** 截面分量信息 */
export interface CrossSectionComponent {
    /** 分量质心 */
    centroid: Vec3;
    /** 分量面积（近似，用于排序） */
    area: number;
}
/**
 * 检测上部实体在切割平面上的截面连通分量。
 *
 * BREP 等价物：将 upper solid 三角化后，用与 mesh 路径 detectCapComponents
 * 完全相同的算法（找帽面三角形 → union-find）检测连通分量。
 *
 * 与 csg-worker.ts detectCapComponents + computeCrossSectionCentroid 一致。
 */
export declare function detectCrossSectionComponents(kernel: OcctKernel, upper: ShapeHandle, basis: JoineryBasis): CrossSectionComponent[];
/** dovetail 布尔分割的结果 */
export interface DovetailSplitBrepResult {
    /** 上部 + 楔（法线正方向半部分加燕尾榫） */
    front: ShapeHandle;
    /** 下部 - 凹腔（法线负方向半部分减燕尾槽） */
    back: ShapeHandle;
}
/** dowel/tenon 布尔分割的结果 */
export interface DowelOrTenonSplitBrepResult {
    /** 上部 + 销/榫（法线正方向半部分加圆柱/方柱） */
    front: ShapeHandle;
    /** 下部 - 孔（法线负方向半部分减圆柱/方柱） */
    back: ShapeHandle;
}
/** groove 参数 */
export interface GrooveParams {
    depth: number;
    depthTolerance: number;
    width: number;
    widthTolerance: number;
    flapsAngle: number;
}
/**
 * Dovetail（燕尾）布尔分割 — BREP 等价物。
 *
 * 1:1 复刻 csg-worker.ts dovetailBooleanSplit：
 * 1. splitBrep → upper + lower
 * 2. 计算 crossSectionWidth（bbox 投影近似）
 * 3. buildWedgeSolid（overhang=20）→ common(wedge, lower) 裁剪贴合
 * 4. fuse(upper, wedgeTrimmed) → upper'
 * 5. buildWedgeSolid（公差）→ cut(lower, wedgeTol) → lower'
 */
export declare function dovetailBooleanSplitBrep(kernel: OcctKernel, original: ShapeHandle, basis: JoineryBasis, groove: GrooveParams): DovetailSplitBrepResult;
/** dowel/tenon 参数 */
export interface DowelOrTenonParams {
    /** 直径（dowel）或边长（tenon） */
    size: number;
    /** 尺寸公差 */
    sizeTolerance: number;
    /** 高度 */
    height: number;
    /** 高度公差 */
    heightTolerance: number;
}
/**
 * Dowel（定位销）/ Tenon（直榫）布尔分割 — BREP 等价物。
 *
 * 1:1 复刻 csg-worker.ts dowelOrTenonBooleanSplit：
 * 1. splitBrep → upper + lower
 * 2. detectCrossSectionComponents → 截面质心列表
 * 3. 对每个质心：buildShapeSolid → fuse(upper, shape) → upper'
 * 4. 对每个质心：buildShapeSolid（公差）→ cut(lower, shapeTol) → lower'
 */
export declare function dowelOrTenonBooleanSplitBrep(kernel: OcctKernel, original: ShapeHandle, basis: JoineryBasis, shape: 'dowel' | 'tenon', params: DowelOrTenonParams, selectedSections?: number[] | null): DowelOrTenonSplitBrepResult;
//# sourceMappingURL=joinery-brep.d.ts.map