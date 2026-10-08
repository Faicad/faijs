/**
 * transform12 — 装配节点位姿 → 3×4 行主序矩阵（写出器共用件）
 *
 * `Shape.transform`（mesh/types.ts）到 12 元组的唯一换算点。消费方：
 * - `export-model.ts`：3MF `<component transform>` / STL 顶点烘焙；
 * - `export-step.ts`：c1 transform 非 identity 时烘进几何（首组件恒 identity）；
 * - `api/export-stl.ts`：transform 烘焙进顶点。
 *
 * 12 元组约定（行主序 3×4，平移在末列）：`[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]`，
 * 与加载器 `parseTransformAttr` / wasm `getLocation` 同约定。
 */

import type { Vec3 } from '../../mesh/types'

/** 归一化向量（零向量回退 z 轴）。 */
function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len === 0 ? [0, 0, 1] : [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * 轴角（度）→ 3×3 行主序旋转矩阵（Rodrigues）。
 *
 * @param axis - 旋转轴（零向量回退 z 轴）。
 * @param angleDeg - 旋转角（度）。
 * @returns 行主序 3×3 旋转矩阵（9 元素）。
 */
export function rotationMatrix3x3(axis: Vec3, angleDeg: number): number[] {
  const [x, y, z] = normalize3(axis)
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

/** 装配节点位姿（与 `Shape.transform` 同形态）。 */
export interface NodeTransform {
  translate?: Vec3
  rotate?: { angle: number; axis?: Vec3 }
  matrix?: number[]
}

/**
 * 3MF `<component transform>` 的 12 元组（行主序 3×4，平移在末列），与加载器 `parseTransformAttr` 同约定。
 *
 * @param t - 节点位姿（`matrix` 12 元组优先，缺省时由 `rotate` / `translate` 合成）。
 * @returns 行主序 3×4 仿射矩阵的 12 元组。
 */
export function transformToMatrix12(t: NodeTransform): number[] {
  if (t.matrix && t.matrix.length === 12) return t.matrix.slice()
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
  if (t.rotate) {
    const R = rotationMatrix3x3(t.rotate.axis ?? [0, 0, 1], t.rotate.angle)
    m[0] = R[0]; m[1] = R[1]; m[2] = R[2]
    m[4] = R[3]; m[5] = R[4]; m[6] = R[5]
    m[8] = R[6]; m[9] = R[7]; m[10] = R[8]
  }
  if (t.translate) {
    m[3] = t.translate[0]; m[7] = t.translate[1]; m[11] = t.translate[2]
  }
  return m
}

/**
 * 位姿平移分量按单位刻度换算（旋转不变）。基准单位（mm）→ 目标声明单位刻度，
 * 与几何缩放（`scalePositions` / `kernel.scale`）同一 `scale` 因子——
 * 「声明单位 == 坐标刻度」不变式对组件位姿同样成立。
 *
 * @param t - 基准单位刻度的节点位姿。
 * @param scale - 单位换算因子（`1 / UNIT_SCALE[unit]`）。
 * @returns 平移已换算的位姿（不修改入参）。
 */
export function scaleTransform(t: NodeTransform, scale: number): NodeTransform {
  if (t.matrix && t.matrix.length === 12) {
    const m = t.matrix.slice()
    m[3] = m[3]! * scale
    m[7] = m[7]! * scale
    m[11] = m[11]! * scale
    return { matrix: m }
  }
  return {
    ...(t.translate ? { translate: [t.translate[0] * scale, t.translate[1] * scale, t.translate[2] * scale] as Vec3 } : {}),
    ...(t.rotate ? { rotate: t.rotate } : {}),
  }
}
