/**
 * faijs 建模 op 适配层（core-decouple wrapup §2.2）
 *
 * sheetmetal 原调用形态 → faijs op 组合。faijs 建模 op 均为
 * 异步 op（`Promise<Shape>`）；本层只做形态适配，不复制任何
 * 兼容层（裁决 9）。说明：
 *
 * - `rotate` — faijs 原生 op（绕任意轴 + `at`，签名兼容原调用），直透。
 * - `translate` — faijs TS 面收 `{ offset }`（transform.ts defineOp），
 *   原调用传 Vec3 数组，在此平铺包装。
 * - `cylinder` — faijs `cylinder(radius, height, { at })` 默认 +Z 轴，
 *   原调用带任意 `axis`：组合 = 生成 → `applyMatrix`(Z→axis) → 平移 `at`。
 * - `getBounds` — 由 faijs `bounds3D`（brep 引擎包围盒，`cad.boundingBox`
 *   只读 mesh 载荷、brep 产物空载荷无效）组合成大写字段 `Bounds3D`。
 */

import {rotate as rotateOp, translate as translateOp, cylinder as cylinderOp, applyMatrix, bounds3D} from '@faicad/faijs/api';
import type {Shape, Vec3} from '@faicad/faijs/api';
import type { Bounds3D } from './types.js';

/** 把 +Z 轴旋到 `axis`（单位化）的 3×3 线性矩阵 + 零平移（Rodrigues；数学同
 * core brepHelpers.rotationZTo）。返回 `{ linear, translation }` 形态——faijs
 * `applyMatrix` 的 brep 实现（api/brep-operations/topologyFns.parseMatrixInput）
 * 接受该对象形态；扁平的 3×4 数组会落入数组解构分支导致线性矩阵全为
 * undefined（2026-09-25 实测：applyMatrix 后体积为 0 的根因）。 */
function rotationZTo(axis: readonly [number, number, number]): { linear: number[]; translation: readonly [number, number, number] } {
  const [x, y, z] = axis;
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) throw new Error('[sheetmetal/geometryOps] rotationZTo: zero-length axis');
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;
  const ZERO: readonly [number, number, number] = [0, 0, 0];
  if (Math.abs(nz - 1) < 1e-9) return { linear: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: ZERO };
  if (Math.abs(nz + 1) < 1e-9) {
    // Z → −Z：绕 X 转 180°。
    return { linear: [1, 0, 0, 0, -1, 0, 0, 0, -1], translation: ZERO };
  }
  const cross = [-ny, nx, 0]; // [0,0,1] × axis
  const crossLen = Math.hypot(...cross);
  const kx = cross[0] / crossLen;
  const ky = cross[1] / crossLen;
  const kz = cross[2] / crossLen;
  const cosA = nz;
  const sinA = Math.hypot(nx, ny);
  const t = 1 - cosA;
  return {
    linear: [
      t * kx * kx + cosA, t * kx * ky - kz * sinA, t * kx * kz + ky * sinA,
      t * kx * ky + kz * sinA, t * ky * ky + cosA, t * ky * kz - kx * sinA,
      t * kx * kz - ky * sinA, t * ky * kz + kx * sinA, t * kz * kz + cosA,
    ],
    translation: ZERO,
  };
}

/**
 * faijs 风格 rotate：绕过 `at` 的 `axis` 旋转 `angleDeg`°（faijs rotate op 原生签名，直透）。
 * @param shape 输入实体
 * @param angleDeg 旋转角度（度）
 * @param opts 旋转中心 `at` 与旋转轴 `axis`
 * @returns 旋转后的实体
 */
export function rotate(
  shape: Shape,
  angleDeg: number,
  opts: { at: Vec3; axis: Vec3 },
): Promise<Shape> {
  return rotateOp(shape as never, angleDeg, opts as never);
}

/**
 * faijs 风格 translate：平移 `offset`（faijs TS 面收 `{ offset }`，此处平铺 Vec3）。
 * @param shape 输入实体
 * @param offset 平移向量
 * @returns 平移后的实体
 */
export function translate(shape: Shape, offset: Vec3): Promise<Shape> {
  return translateOp(shape, { offset: [offset[0], offset[1], offset[2]] });
}

/**
 * faijs 风格 cylinder：底面圆心 `at`、轴向 `axis` 的圆柱（组合：Z 轴圆柱 → 取向 → 定位）。
 * @param radius 半径
 * @param height 高度
 * @param opts 底面圆心 `at` 与轴向 `axis`
 * @returns 圆柱实体
 */
export async function cylinder(
  radius: number,
  height: number,
  opts: { at: Vec3; axis: Vec3 },
): Promise<Shape> {
  // faijs cylinder TS 面为单参对象形态（defineOp 单参装箱：radius/height/at）。
  const c = await cylinderOp({ radius, height, at: [0, 0, 0] });
  const [ax, ay, az] = opts.axis;
  const axisIsZ = ax === 0 && ay === 0 && az > 0;
  const oriented = axisIsZ ? c : await applyMatrix(c as never, rotationZTo(opts.axis) as never);
  return translateOp(oriented, { offset: [opts.at[0], opts.at[1], opts.at[2]] });
}

/**
 * faijs 风格 getBounds：brep 引擎包围盒组合成 `Bounds3D`（大写字段形态）。
 * @param shape 输入实体
 * @returns 包围盒（大写字段形态）
 */
export function getBounds(shape: Shape): Bounds3D {
  const b = bounds3D(shape);
  return {
    xMin: b.min[0],
    xMax: b.max[0],
    yMin: b.min[1],
    yMax: b.max[1],
    zMin: b.min[2],
    zMax: b.max[2],
  };
}
