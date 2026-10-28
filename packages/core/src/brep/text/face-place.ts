/**
 * brep/text/face-place.ts — 把"平面内轮廓体"（文字 / SVG / DXF）对齐到一张给定面。
 *
 * 三种轮廓源都在 **XY 平面**生成、沿 **+Z** 挤出（见 `text-to-solid.ts` /
 * `svg-to-solid.ts` / `dxf-to-solid.ts`），厚度居中于 z∈[-depth/2, +depth/2]。
 * 贴到一张面上只需要两步：**把 +Z 转到该面法向**、**把体中心移到面心**。
 *
 * 为什么单独成一个模块：`cad.engrave`（刻进已有实体）与 `cad.text`（在面上生成
 * 文字）必须给出**同一种**对齐结果 —— 用户在「刻字」与「文字」两个工具里选同一张面，
 * 看到的方向与位置就该一样。两个 op 各写一份 Rodrigues 必然走样（一处改了另一处忘改），
 * 所以只留这一份。
 */

import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import type { Vec3 } from '../../mesh/types'
import { getSolidBoundingBox } from '../brep-utils'

/**
 * 计算将 +Z 轴对齐到目标法向的 3×4 仿射矩阵（仅旋转、无平移，Rodrigues 公式）。
 *
 * 这是**最小旋转**：绕 `z × n` 转 `acos(nz)`。法向恰为 ±Z 时退化为单位阵 / 绕 X 转 180°。
 * 选最小旋转（而不是"先绕 Z 再绕 Y"这类欧拉分解）是为了让面内朝向可预测：
 * 法向偏一点点，面上的图形也只歪一点点。
 *
 * @param normal 目标面外法向（不必单位化；零向量按单位阵处理）。
 * @returns row-major 3×4 矩阵（与 `BrepEngineApi.transform` 同约定）。
 */
export function alignZToNormal(normal: Vec3): number[] {
  const [nx, ny, nz] = normal
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (len < 1e-10) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
  }
  const ux = nx / len
  const uy = ny / len
  const uz = nz / len

  if (Math.abs(ux) < 1e-10 && Math.abs(uy) < 1e-10) {
    if (uz > 0) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
    return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0]
  }

  const s = Math.sqrt(ux * ux + uy * uy)
  const c = uz
  const t = 1 - c
  const ax = -uy / s
  const ay = ux / s

  return [
    c + ax * ax * t, ax * ay * t, ay * s, 0,
    ax * ay * t, c + ay * ay * t, -ax * s, 0,
    -ay * s, ax * s, c, 0,
  ]
}

/**
 * 把 solid 的**包围盒中心**移到原点（释放原件）。
 *
 * 用包围盒中心而不是某个拓扑特征点：文字 / SVG / DXF 的轮廓体没有"天然中心"，
 * 包围盒中心是唯一与内容无关的锚点（'Hi' 与 'Hello' 都以自身中心对齐面心）。
 *
 * @param kernel brep 引擎。
 * @param solid 待居中的 solid 句柄（会被释放）。
 * @returns 居中后的新 solid 句柄。
 */
export function centerSolidAtOrigin(kernel: BrepEngineApi, solid: BrepHandle): BrepHandle {
  const bb = getSolidBoundingBox(kernel, solid)
  const cx = (bb.min[0] + bb.max[0]) / 2
  const cy = (bb.min[1] + bb.max[1]) / 2
  const cz = (bb.min[2] + bb.max[2]) / 2
  const centered = kernel.translate(solid, -cx, -cy, -cz)
  kernel.release(solid)
  return centered
}

/**
 * 把平面轮廓体摆到一张面上：居中 → 旋到法向 → 平移到面心（再沿法向偏移 `offset`）。
 *
 * 为什么要外部给 `offset` 而不是内部按 mode 算：刻字要往面**里**让（凹）、往面**外**探
 * （凸），文字建模只要贴面（0）。三者的差别就只是这一个数。
 *
 * @param kernel  brep 引擎。
 * @param solid   XY 平面生成、沿 +Z 挤出的轮廓体（本函数接管所有权）。
 * @param faceCenter 面心（与 `partTransforms` 同空间 = 模型局部坐标，调用方负责换算）。
 * @param faceNormal 面外法向（零向量 = 单位阵，图形保持朝 +Z）。
 * @param offset  沿法向的额外偏移（mm；刻字用 ±depth/2 + 0.01，文字建模传 0）。
 * @returns 已摆放好的新句柄（输入的 solid 已被释放）。
 */
export function placeOnFace(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  faceCenter: Vec3,
  faceNormal: Vec3,
  offset: number,
): BrepHandle {
  const centered = centerSolidAtOrigin(kernel, solid)
  const matrix = alignZToNormal(faceNormal)
  const rotated = kernel.transform(centered, matrix)
  kernel.release(centered)
  // 沿法向偏移用**单位**法向：面法向由宿主从拓扑行抄来，不保证单位化
  // （`alignZToNormal` 内部会归一化，这里若直接用原值，偏移量会随向量长度缩放 ——
  // "深度 2mm 实际刻了 2×|n| mm"这种错查起来极其费时）。
  const nlen = Math.sqrt(faceNormal[0] ** 2 + faceNormal[1] ** 2 + faceNormal[2] ** 2)
  const nx = nlen > 1e-10 ? faceNormal[0] / nlen : 0
  const ny = nlen > 1e-10 ? faceNormal[1] / nlen : 0
  const nz = nlen > 1e-10 ? faceNormal[2] / nlen : 1
  const positioned = kernel.translate(
    rotated,
    faceCenter[0] + nx * offset,
    faceCenter[1] + ny * offset,
    faceCenter[2] + nz * offset,
  )
  kernel.release(rotated)
  return positioned
}
