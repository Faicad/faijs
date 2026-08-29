/**
 * Functional thread operation — builds a helical screw thread.
 *
 * 适配自 brepjs `src/operations/threadFns.ts`。
 * 保留文件名和核心算法，适配本项目的 occt-wasm API。
 *
 * occt-wasm 的 `BRepOffsetAPI_MakePipeShell` (sweep) 无法可靠地沿螺旋线扫掠截面，
 * 因此螺纹用 loft（`BRepOffsetAPI_ThruSections`）穿过一系列旋转的齿截面构造。
 * 结果是螺旋螺纹的 *ridge* — 外螺纹 fuse 到螺杆，内螺纹 cut 从孔中减去。
 *
 * 与 brepjs 的差异：
 * - brepjs 用 BlueprintSketcher + line() + wire() 构造截面 → 本项目直接用 kernel.makeLineEdge + kernel.makeWire
 * - brepjs 用 loft() 函数 → 本项目直接用 kernel.loft(wires, isSolid, ruled)
 * - brepjs 用 DisposalScope 管理中间句柄 → 本项目手动 kernel.release
 * - brepjs 用 Result 类型 → 本项目抛出异常
 */
import type { OcctKernel, ShapeHandle } from 'occt-wasm';
/** 螺纹配置参数。单位 mm，角度由螺距推导。 */
export interface ThreadOptions {
    /** 核心半径（外螺纹）或名义孔半径（内螺纹），在螺纹根部 */
    radius: number;
    /** 每圈轴向距离（螺距） */
    pitch: number;
    /** 螺纹总长（沿轴）。圈数 = height / pitch */
    height: number;
    /** 径向螺纹高度（齿顶 - 齿根）。默认 0.6 * pitch（≈ISO 60° V 型） */
    depth?: number;
    /** 齿根处轴向半宽。默认 0.42 * pitch */
    toothHalfWidth?: number;
    /**
     * flat 顶宽，给出梯形齿而非尖 V 型。
     * 0（默认）= 尖 V（ISO/UN）；正值 = 梯形齿（Acme/square）。
     * 必须 < toothHalfWidth。
     */
    crest?: number;
    /** 每圈截面数 — 越高越平滑但越慢。默认 20 */
    sectionsPerTurn?: number;
    /** 左旋。默认 false（右旋） */
    lefthand?: boolean;
    /** 齿尖朝向轴心（内螺纹用 cut 从孔中减去时） */
    inward?: boolean;
}
/**
 * 通过 loft 旋转齿截面构建螺旋螺纹 ridge。
 *
 * @param kernel  OCCT 内核
 * @param options 螺纹配置
 * @returns 螺纹 ridge solid（ShapeHandle）
 *
 * @example 外螺纹（Ø12 螺杆，2.5mm 螺距）:
 * ```ts
 * const ridge = threadBrep(kernel, { radius: 6, pitch: 2.5, height: 7.5 })
 * const rod = kernel.makeCylinder(6.15, 7.5)
 * const result = kernel.fuse(rod, ridge)
 * kernel.release(rod)
 * kernel.release(ridge)
 * ```
 *
 * @example 内螺纹（攻丝 Ø6 孔）:
 * ```ts
 * const ridge = threadBrep(kernel, { radius: 3, pitch: 1, height: 6, inward: true })
 * const result = kernel.cut(boredBlock, ridge)
 * kernel.release(ridge)
 * ```
 */
export declare function threadBrep(kernel: OcctKernel, options: ThreadOptions): ShapeHandle;
//# sourceMappingURL=threadFns.d.ts.map