/**
 * stdlib transform — 变换库函数（translate/rotate/scale）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，
 * BREP 路径用 brepOf(input) 取输入实体、fromBrep 登记输出实体。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** translate: offset 必填 vec3。 */
export declare function assertTranslateParams(params: Record<string, unknown>): void;
/** rotate: anglesDeg 必填 vec3；pivot（如有）为 vec3。 */
export declare function assertRotateParams(params: Record<string, unknown>): void;
/** scale: factor 必填（number > 0 或 vec3）。 */
export declare function assertScaleParams(params: Record<string, unknown>): void;
export declare function translate(input: Shape, params: Record<string, unknown>): Shape;
export declare function rotate(input: Shape, params: Record<string, unknown>): Shape;
export declare function scale(input: Shape, params: Record<string, unknown>): Shape;
//# sourceMappingURL=transform.d.ts.map