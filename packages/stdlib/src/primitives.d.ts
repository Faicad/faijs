/**
 * stdlib primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/** box: size 必填（number 或 vec3），> 0。 */
export declare function assertBoxParams(params: Record<string, unknown>): void;
/** sphere: radius 必填，> 0。 */
export declare function assertSphereParams(params: Record<string, unknown>): void;
/** cylinder: radius/height 必填，> 0。 */
export declare function assertCylinderParams(params: Record<string, unknown>): void;
/** cone: radiusBottom/height 必填 > 0，radiusTop >= 0。 */
export declare function assertConeParams(params: Record<string, unknown>): void;
/** wedge: width/height/angle/length 必填，> 0。 */
export declare function assertWedgeParams(params: Record<string, unknown>): void;
export declare function box(params: Record<string, unknown>): Shape;
export declare function sphere(params: Record<string, unknown>): Shape;
export declare function cylinder(params: Record<string, unknown>): Shape;
export declare function cone(params: Record<string, unknown>): Shape;
export declare function wedge(params: Record<string, unknown>): Shape;
//# sourceMappingURL=primitives.d.ts.map