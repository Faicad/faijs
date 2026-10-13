/**
 * math3d — three.js math 子集的零依赖移植层（L0 数学层）。
 *
 * 用途：替换 core / `core/src/extra` 对 three.js `Vector2` / `Vector3` /
 * `Matrix4` / `Quaternion` / `Euler` / `Plane` / `Box3` 的依赖。所有类的公式与
 * 运算顺序逐行移植自 three r162（MIT License, © 2010-2024 three.js authors），
 * 由 `test/math3d/three-parity.test.ts` 逐位对照钉死。
 *
 * 与 `api/geom-types/vecOps.ts`（compat 面 tuple 纯函数，面向库开发者）职责分离：
 * 本层是 core 内部的 three 替换，不进入包级公开 API 面。
 */

export { Vec3 } from './Vec3'
export { Vec2 } from './Vec2'
export { Quat } from './Quat'
export { Mat4, type MatrixLike } from './Mat4'
export { Euler, type EulerOrder } from './Euler'
export { Plane } from './Plane'
export { Box3 } from './Box3'