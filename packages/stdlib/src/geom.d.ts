/**
 * stdlib geom — $geom 查询函数族（有形签名）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.9
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2（§5.5）
 *
 * `cad.<feature>(of, anchor?, ordinal?)`：
 * - of 是 Shape（编译产物 `ctx.<var>` 引用），非变量名
 * - faceCenter/faceNormal：faceOrdinal + brepOf(of) + kernel（拓扑引用）
 *   优先 → anchor 几何反查（兜底）→ 报错
 * - bboxCenter/bboxMin/bboxMax：mesh 包围盒查询
 */
import type { Shape, Vec3 } from '@faicad/faijs-core/mesh/types';
/** `cad.faceCenter(of, anchor?, ordinal?)` */
export declare function faceCenter(of: Shape, anchor?: Vec3, ordinal?: number): Vec3;
/** `cad.faceNormal(of, anchor?, ordinal?)` */
export declare function faceNormal(of: Shape, anchor?: Vec3, ordinal?: number): Vec3;
/** `cad.bboxCenter(of)` */
export declare function bboxCenter(of: Shape): Vec3;
/** `cad.bboxMin(of)` */
export declare function bboxMin(of: Shape): Vec3;
/** `cad.bboxMax(of)` */
export declare function bboxMax(of: Shape): Vec3;
//# sourceMappingURL=geom.d.ts.map