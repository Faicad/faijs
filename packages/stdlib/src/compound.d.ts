/**
 * stdlib compound — group/assembly 库函数（compound Shape + AssemblyBehavior）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.10 / §2.4
 *
 * 从 src/ops/assemble.ts 迁出并改写为 stdlib 形态：
 * - `group(params)` → compound Shape（kind='compound'，children 为成员 Shape 引用）
 * - `assembly(params)` → compound Shape + AssemblyBehavior（约束列表 + solve 方法）
 * - 装配三件套（solveFaceMate / executeDoAssemble / previewAssembly）迁移并挂到 AssemblyBehavior
 *
 * compound 自身无独立 mesh——几何由 children 承载，意义是结构（层级）。
 * do_assemble 编译为 `await ctx.<asm>.do_assemble()`：调用 compound 的 solve 方法，
 * 对 moving 成员施加 face_mate 变换（mesh 顶点烘焙 + BREP 刚体变换 + 下游传播）。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
import { type CompoundShape } from '@faicad/faijs-core/shape';
import { type AssemblyTransform } from '@faicad/faijs-core/runtime-state';
import type { PartName } from '@faicad/faijs-core/identity';
export interface GroupParams {
    name?: string;
    /** Compound members: read-only references, never mutated by group/assembly. */
    members?: Shape[];
    memberNames?: string[];
}
export interface AssemblyParams extends GroupParams {
    constraints?: AssemblyConstraint[];
}
export interface FaceMateConstraint {
    type: 'face_mate';
    fixedPartName: PartName;
    movingPartName: PartName;
    fixedFace: {
        surfaceType: string;
        center: [number, number, number];
        normal: [number, number, number];
    };
    movingFace: {
        surfaceType: string;
        center: [number, number, number];
        normal: [number, number, number];
    };
}
export type AssemblyConstraint = FaceMateConstraint;
export interface FaceMateTransform {
    quaternion: [number, number, number, number];
    pivot: [number, number, number];
    translation: [number, number, number];
    rotationMatrix: number[];
}
/**
 * 计算 face_mate 约束的变换（使 movingFace.normal → -fixedFace.normal + 中心重合）。
 */
export declare function solveFaceMate(fixedCenter: [number, number, number], fixedNormal: [number, number, number], movingCenter: [number, number, number], movingNormal: [number, number, number]): FaceMateTransform;
export { applyTransform } from '@faicad/faijs-core/mesh/rigid-transform';
export interface AssemblyBehavior {
    name?: string;
    memberNames: string[];
    constraints: AssemblyConstraint[];
    /** 只求解（P6）：返回"成员下标 → 变换"列表。不改写入参、不传播；可重复调用（幂等）。 */
    solve(): AssemblyTransform[];
}
/**
 * `cad.group({ name, members })` → compound Shape。
 * members 是成员 Shape（编译产物 ctx.<var> 引用），成员名经 keep() 反查。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：group 保留其成员且可见（R6）。
 */
export declare function group(params: GroupParams): CompoundShape;
/**
 * `cad.assembly({ name, members, constraints })` → compound Shape + AssemblyBehavior。
 * 挂 do_assemble 方法（编译产物 `ctx.<asm>.do_assemble()` 调用）。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：assembly 保留其成员且可见（R6）。
 */
export declare function assembly(params: AssemblyParams): CompoundShape;
//# sourceMappingURL=compound.d.ts.map