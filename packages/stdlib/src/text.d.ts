/**
 * stdlib text — 文字创建库函数（text）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** text: text 必填非空字符串；size/depth 必填 > 0。 */
export declare function assertTextParams(params: Record<string, unknown>): void;
export declare function text(inputOrParams: unknown, maybeParams?: Record<string, unknown>): Promise<Shape>;
//# sourceMappingURL=text.d.ts.map