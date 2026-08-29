/**
 * stdlib engrave — 雕刻库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：textToSolid/svgToSolid + boolean（cut/fuse）。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** engrave: 至少提供 text 或 svg 之一；depth（如有）> 0。 */
export declare function assertEngraveParams(params: Record<string, unknown>): void;
export declare function engrave(input: Shape, params: Record<string, unknown>): Promise<Shape>;
//# sourceMappingURL=engrave.d.ts.map