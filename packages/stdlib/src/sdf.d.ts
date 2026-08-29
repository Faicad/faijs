/**
 * stdlib sdf — SDF 库函数（mesh-only，创建类无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2/P4
 *
 * sdf 无 BREP 实现（mesh-only）——dispatchPath 在 brep 模式下调用前抛错。
 * part-brep-lost 事件由引擎统一发（P4，库不再 emit）。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** sdf: code 必填非空字符串。 */
export declare function assertSdfParams(params: Record<string, unknown>): void;
export declare function sdf(params: Record<string, unknown>): Promise<Shape>;
//# sourceMappingURL=sdf.d.ts.map