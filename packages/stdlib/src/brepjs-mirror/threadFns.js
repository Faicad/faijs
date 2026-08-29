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
export function threadBrep(kernel, options) {
    const { radius, pitch, height, depth = 0.6 * pitch, toothHalfWidth = 0.42 * pitch, crest = 0, sectionsPerTurn = 20, lefthand = false, inward = false, } = options;
    // 参数校验
    if (!(radius > 0))
        throw new Error('[threadBrep] radius must be > 0');
    if (!(pitch > 0))
        throw new Error('[threadBrep] pitch must be > 0');
    if (!(height > 0))
        throw new Error('[threadBrep] height must be > 0');
    if (!(depth > 0))
        throw new Error('[threadBrep] depth must be > 0');
    if (crest < 0 || crest >= toothHalfWidth) {
        throw new Error('[threadBrep] crest must be >= 0 and < toothHalfWidth');
    }
    if (sectionsPerTurn < 3) {
        throw new Error('[threadBrep] sectionsPerTurn must be >= 3');
    }
    const turns = height / pitch;
    const nSec = Math.max(2, Math.round(turns * sectionsPerTurn));
    const sign = lefthand ? -1 : 1;
    const apexU = inward ? -depth : depth; // 齿顶：外螺纹朝外，内螺纹朝内
    const baseU = inward ? 0.3 : -0.3; // 齿根：略微嵌入配合实体以保证布尔干净
    const a = toothHalfWidth;
    // 构建截面序列
    const sections = [];
    const intermediateEdges = [];
    for (let i = 0; i <= nSec; i++) {
        const th = (sign * i * 2 * Math.PI) / sectionsPerTurn;
        const z = (pitch * Math.abs(th)) / (2 * Math.PI);
        const cx = radius * Math.cos(th);
        const cy = radius * Math.sin(th);
        const rx = Math.cos(th);
        const ry = Math.sin(th);
        // 点生成函数：u = 径向偏移，v = 轴向偏移
        const pt = (u, v) => ({
            x: cx + u * rx,
            y: cy + u * ry,
            z: z + v,
        });
        // V 型齿（crest=0）通过单个顶点闭合；梯形齿（crest>0）给出平顶
        const profile = crest > 0
            ? [pt(baseU, -a), pt(apexU, -crest), pt(apexU, crest), pt(baseU, a)]
            : [pt(baseU, -a), pt(apexU, 0), pt(baseU, a)];
        // 构建边
        const edges = [];
        for (let k = 0; k < profile.length; k++) {
            const edge = kernel.makeLineEdge(profile[k], profile[(k + 1) % profile.length]);
            edges.push(edge);
            intermediateEdges.push(edge);
        }
        // 构建 wire
        const wire = kernel.makeWire(edges);
        sections.push(wire);
    }
    // Loft
    const thread = kernel.loft(sections, true, true);
    // 释放中间句柄
    for (const w of sections)
        kernel.release(w);
    for (const e of intermediateEdges)
        kernel.release(e);
    return thread;
}
//# sourceMappingURL=threadFns.js.map