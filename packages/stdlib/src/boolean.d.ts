/**
 * stdlib boolean — 布尔库函数（union/subtract/intersect，多输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *          docs/plans/2026-08-27-faijs-language-normalization-implementation.md §3.3
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，BREP 路径用 *WithHistory 收集面演化。
 *
 * 阶段 1：拆为三个薄函数 union/subtract/intersect + 兼容 boolean 导出（过渡）。
 * 阶段 3 将删除 boolean 兼容导出。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
export declare function union(...shapes: Shape[]): Promise<Shape>;
export declare function subtract(...shapes: Shape[]): Promise<Shape>;
export declare function intersect(...shapes: Shape[]): Promise<Shape>;
//# sourceMappingURL=boolean.d.ts.map