/**
 * stdlib split — 分割库函数（返回具名对象 { front, back }）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，双输出以具名对象返回（替代 outputCache 多输出写入）。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
export declare function split(input: Shape, params?: Record<string, unknown>): Promise<{
    front: Shape;
    back: Shape;
}>;
//# sourceMappingURL=split.d.ts.map