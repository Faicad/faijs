/**
 * stdlib drill — 钻孔库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** drill: diameter 必填 > 0；position（如有）为 vec3；depth（如有）为数字（<=0 表示通孔）。 */
export declare function assertDrillParams(params: Record<string, unknown>): void;
export declare function drill(input: Shape, params: Record<string, unknown>): Promise<Shape>;
//# sourceMappingURL=drill.d.ts.map