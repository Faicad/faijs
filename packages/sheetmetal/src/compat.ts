/**
 * compat — brepjs 同名兼容 shim（D12，批次一的桥接面）
 *
 * 设计：docs/plans/2026-09-01-layered-api-architecture.md §D12 / §7.3 / §7.5
 *
 * 移植的钣金源文件只改 import 来源行（`from 'brepjs'` → `from './compat.js'`），
 * Result 消费点零改动。本文件是包内**唯一**桥接点（§9 验收白名单：src 中
 * `kernel/`、`getBackends`、`getSlot` 零命中，compat.ts 除外）——
 * 批次一（纯 2D/数据层）需要的符号以 vendored L1/L2 的同名形态提供：
 *
 * - Result 机制与类型：vendored `core/result.js` / `core/errors.js` /
 *   `core/shapeTypes.js` / `core/validityTypes.js` / `core/types.js`；
 * - 2D/查询 op：直包 vendored L2（`primitiveFns.line/wire/wireLoop`、
 *   `topologyQueryFns.getEdges`、`curveFns.curveStartPoint/curveEndPoint`）——
 *   产出的都是 brepjs 原样句柄形态（同一 occt-wasm 实例，D10），与 3D 批次
 *   经 L3 `cad.*` 的路径不同：批次一不碰 3D 实体，无需 faijs Shape 包装。
 *
 * vec* 纯函数按 §7.5 ⑤ 不映射到 cad 命名空间；批次一各文件未消费 vec*，
 * 待 3D 批次需要时从 vendored `utils/vec3.js` 在此 re-export。
 */

import { ok, err, isOk, isErr, type Result } from '@faicad/faijs-core/vendored/brepjs/core/result.js'
import { validationError, type BrepError } from '@faicad/faijs-core/vendored/brepjs/core/errors.js'
import type { Solid, Wire, Edge, Face, AnyShape } from '@faicad/faijs-core/vendored/brepjs/core/shapeTypes.js'
import { isSolid } from '@faicad/faijs-core/vendored/brepjs/core/shapeTypes.js'
import type { ClosedWire, ValidSolid } from '@faicad/faijs-core/vendored/brepjs/core/validityTypes.js'
import { isPlanarWire } from '@faicad/faijs-core/vendored/brepjs/core/validityTypes.js'
import type { Vec3 } from '@faicad/faijs-core/vendored/brepjs/core/types.js'
import type { Bounds3D } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'
import { getSolids, getFaces, getBounds } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'
import {
  line as brepjsLine,
  wire as brepjsWire,
  wireLoop as brepjsWireLoop,
  box as brepjsBox,
  cylinder as brepjsCylinder,
  sphere as brepjsSphere,
  face as brepjsFace,
  polygon as brepjsPolygon,
} from '@faicad/faijs-core/vendored/brepjs/topology/primitiveFns.js'
import { unwrap as brepjsUnwrap } from '@faicad/faijs-core/vendored/brepjs/core/result.js'
import { fuse as brepjsFuse, cut as brepjsCut, intersect as brepjsIntersect } from '@faicad/faijs-core/vendored/brepjs/topology/booleanFns.js'
import { rotate as brepjsRotate, translate as brepjsTranslate } from '@faicad/faijs-core/vendored/brepjs/topology/transformFns.js'
import { extrude as brepjsExtrude } from '@faicad/faijs-core/vendored/brepjs/operations/extrudeFns.js'
import { getEdges as brepjsGetEdges } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'
import {
  curveStartPoint as brepjsCurveStartPoint,
  curveEndPoint as brepjsCurveEndPoint,
} from '@faicad/faijs-core/vendored/brepjs/topology/curveFns.js'
import { isValid } from '@faicad/faijs-core/vendored/brepjs/topology/healingFns.js'
import { measureVolume, measureArea } from '@faicad/faijs-core/vendored/brepjs/measurement/measureFns.js'
import {
  getSurfaceType,
  pointOnSurface,
  normalAt,
  faceCenter,
} from '@faicad/faijs-core/vendored/brepjs/topology/faceFns.js'
import { sharedEdges } from '@faicad/faijs-core/vendored/brepjs/topology/adjacencyFns.js'
import { outerWire as brepjsOuterWire } from '@faicad/faijs-core/vendored/brepjs/topology/faceFns.js'
import {
  vecAdd,
  vecSub,
  vecScale,
  vecDot,
  vecCross,
  vecNormalize,
  vecLength,
} from '@faicad/faijs-core/vendored/brepjs/core/vecOps.js'

// ── Result 机制（L1 core/result + core/errors，brepjs 同名） ──
export { ok, err, isOk, isErr, validationError, brepjsUnwrap as unwrap }
export type { Result, BrepError }

// ── 类型（L1，brepjs 同名；批次一消费的类型全集） ──
export type { Solid, Wire, Edge, Face, AnyShape, ClosedWire, ValidSolid, Vec3, Bounds3D }

// ── 2D/查询 op（直 re-export vendored L2，保留 brepjs 同名同签名） ──
export { brepjsLine as line, brepjsWire as wire, brepjsWireLoop as wireLoop }
export { brepjsGetEdges as getEdges, getSolids, getFaces, getBounds }
export { isSolid, isPlanarWire, isValid }
export { brepjsCurveStartPoint as curveStartPoint, brepjsCurveEndPoint as curveEndPoint }

// ── 3D op（批次二/三：布尔/图元/变换/拉伸） ──
export { brepjsBox as box, brepjsCylinder as cylinder, brepjsSphere as sphere, brepjsFace as face }
export { brepjsPolygon as polygon, brepjsOuterWire as outerWire }
export { brepjsExtrude as extrude }
export { brepjsTranslate as translate }

// 上游 brepjs 18 的 rotate 以 `{ at, axis }` 选项对象接受轴；vendored 树是
// 四参数位置形态（P5 锁定 commit）。compat 包装对齐上游同名同签（D12）。
/**
 * Rotate a shape by an angle in degrees around an axis.
 * @param shape - The shape to rotate.
 * @param angle - Rotation angle in degrees.
 * @param options - Axis and pivot (`at`) for the rotation; defaults to the Z
 * axis through the origin, matching upstream brepjs.
 * @returns A new rotated shape.
 */
export function rotate<T extends AnyShape>(
  shape: T,
  angle: number,
  options: { at?: Vec3; axis?: Vec3 } = {}
): T {
  return brepjsRotate(shape, angle, options.at ?? [0, 0, 0], options.axis ?? [0, 0, 1]);
}

// 上游 brepjs 18 的布尔接受任意 3D shape；vendored 首重载要求 ValidSolid
// 品牌（编译期幻影）。compat 以 Solid 形态导出、内部 cast（运行时无差异）。
/**
 * Fuse two solids (union). Accepts plain `Solid` operands like upstream
 * brepjs; the vendored `ValidSolid` brand is applied internally.
 * @param a - First solid operand.
 * @param b - Second solid operand.
 * @returns `Ok` with the fused solid, or `Err` when the result is not 3D.
 */
export function fuse(a: Solid, b: Solid): Result<ValidSolid> {
  return brepjsFuse(a as ValidSolid, b as ValidSolid);
}
/**
 * Cut solid `b` out of solid `a` (difference).
 * @param a - Solid to subtract from.
 * @param b - Solid to subtract.
 * @returns `Ok` with the result, or `Err` when the result is not 3D.
 */
export function cut(a: Solid, b: Solid): Result<ValidSolid> {
  return brepjsCut(a as ValidSolid, b as ValidSolid);
}
/**
 * Intersect two solids (common volume).
 * @param a - First solid operand.
 * @param b - Second solid operand.
 * @returns `Ok` with the intersection, or `Err` when the result is not 3D.
 */
export function intersect(a: Solid, b: Solid): Result<ValidSolid> {
  return brepjsIntersect(a as ValidSolid, b as ValidSolid);
}

// ── 度量 / 曲面查询（批次二/三） ──
export { measureVolume, measureArea }
export { getSurfaceType, pointOnSurface, normalAt, faceCenter, sharedEdges }

// ── 向量纯函数（§7.5 ⑤，不映射 cad 命名空间） ──
export { vecAdd, vecSub, vecScale, vecDot, vecCross, vecNormalize, vecLength }
