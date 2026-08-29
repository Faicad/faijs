/**
 * stdlib copy — 深拷贝几何（方案 B：独立新对象，源不变）
 *
 * 设计文档：docs/plans/2026-08-27-restore-dag-terminal-detection.md §5.1
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * copy 是"共享读取"（克隆出新对象，源不变），与 drill/transform 的"独占改写"本质不同：
 * - **copy 不消费其源**（从消费方排除，与 group/assembly 同级）
 * - copy 输出是独立新对象 → 归"新名"类（allocate-id.ts 不保名）
 * - **源显示**（part0=box; part1=copy(part0) → 画布显示 box 和副本两份）
 *
 * 双链路：
 * - mesh 路径：深拷贝 positions/indices 到新数组
 * - BREP 路径：kernel.copy(inputSolid) → solidToShape → fromBrep 登记
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/**
 * `cad.copy(input)` → 深拷贝 Shape。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：copy 保留其源（可见）——
 * keep(input) 使源变量保持终端（画布显示 box 和副本两份）。
 *
 * mesh 路径：positions/indices 复制到新数组（改副本不影响源）。
 * BREP 路径：kernel.copy 产出独立 ShapeHandle。
 */
export declare function copy(input: Shape): Shape;
//# sourceMappingURL=copy.d.ts.map