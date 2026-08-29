/**
 * stdlib knurl — 滚花库函数（mesh-only）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2/P4
 *
 * knurl 无 BREP 实现（mesh-only）——dispatchPath 在 brep 模式下调用前抛错。
 * part-brep-lost 事件由引擎统一发（P4，库不再 emit）。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** knurl: knurlTextureHeight 必填 > 0。 */
export declare function assertKnurlParams(params: Record<string, unknown>): void;
export declare function knurl(input: Shape, params: Record<string, unknown>): Promise<Shape>;
//# sourceMappingURL=knurl.d.ts.map