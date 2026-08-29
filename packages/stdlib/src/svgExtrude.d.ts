/**
 * stdlib svgExtrude — SVG 挤出创建库函数（creator 函数，无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** svgExtrude: svg 必填；depth 必填 > 0。 */
export declare function assertSvgExtrudeParams(params: Record<string, unknown>): void;
export declare function svgExtrude(params: Record<string, unknown>): Promise<Shape>;
//# sourceMappingURL=svgExtrude.d.ts.map