/**
 * section-placement — 截面的「精确落位」矩阵（一份实现，两个 op 共用）
 *
 * `sweepAlong`（三种策略）与 `sweepAdvanced`（`autoPlace`）都需要把截面从
 * 「它被画在哪」搬到「脊柱起点 + 起点切向」。这段计算有三个坑，任何一处走偏都会
 * 变成静默的几何错误，所以只有这一份实现：
 *
 * 1. **必须自己搬**：内核 `MakePipe` / `MakePipeShell` 都不把截面平移到脊柱起点
 *    （截面留在原点、脊柱从 (0,0,90) 出发时，弧段扫出 0 体积）。
 * 2. **不能用 `withContact` 代替**：它只让截面「蹭到」脊柱上，管心相对路径偏一个
 *    截面半径（实测管跨 z[90,102] 而路径在 z=90，`sweep-kernel-behavior.test.ts` K5d）。
 * 3. **必须用最小旋转**：任取 helper 向量造正交基会绕法向自转，非对称截面（矩形、
 *    L 形）被悄悄拧一个角度。这里用 Rodrigues（转轴 = from×to），面内朝向最接近
 *    用户画的那个。
 *
 * 口径：截面中心取 bbox 中点 —— Pappus 恒等式「体积 = 净面积 × 长度」要求管心落在
 * 路径上，偏一点体积就对不上。
 */

import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'

function unit3(v: BrepVec3): BrepVec3 {
  const l = Math.hypot(v.x, v.y, v.z)
  return l < 1e-12 ? { x: 0, y: 0, z: 1 } : { x: v.x / l, y: v.y / l, z: v.z / l }
}

function cross3(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function add3(a: BrepVec3, b: BrepVec3): BrepVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale3(a: BrepVec3, k: number): BrepVec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k }
}

function dot3(a: BrepVec3, b: BrepVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * 把局部 +Z 转到 `to`、且**保留原本的面内朝向**的最小旋转（Rodrigues）。
 *
 * 为什么不用「任取一个 helper 向量造正交基」那种写法：那会绕法向任意自转，非对称
 * 截面（矩形、L 形）会被悄悄拧一个角度。最小旋转的转轴 = from×to，在满足「法向对准」
 * 的前提下转动量最小，面内朝向最接近用户画的那个。
 *
 * @returns 三个列向量（旋转矩阵的像基）。
 */
function rotationColumns(from: BrepVec3, to: BrepVec3): [BrepVec3, BrepVec3, BrepVec3] {
  const a = unit3(from)
  const b = unit3(to)
  const c = Math.min(1, Math.max(-1, dot3(a, b)))
  const angle = Math.acos(c)
  if (angle < 1e-9) return [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
  let axis: BrepVec3
  if (Math.PI - angle < 1e-6) {
    // 反向：绕任一垂直于 a 的轴转 180°。
    const helper: BrepVec3 = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
    axis = unit3(cross3(helper, a))
  } else {
    axis = unit3(cross3(a, b))
  }
  const s = Math.sin(angle)
  const t = 1 - Math.cos(angle)
  const { x: k1, y: k2, z: k3 } = axis
  const r11 = c + t * k1 * k1
  const r12 = -s * k3 + t * k1 * k2
  const r13 = s * k2 + t * k1 * k3
  const r21 = s * k3 + t * k2 * k1
  const r22 = c + t * k2 * k2
  const r23 = -s * k1 + t * k2 * k3
  const r31 = -s * k2 + t * k3 * k1
  const r32 = s * k1 + t * k3 * k2
  const r33 = c + t * k3 * k3
  return [
    { x: r11, y: r21, z: r31 },
    { x: r12, y: r22, z: r32 },
    { x: r13, y: r23, z: r33 },
  ]
}

/**
 * 12 元行主序仿射矩阵：把截面从「法向 `normal`、中心 `center`」搬到
 * 「过 `target`、法向 ∥ `tangent`」的切平面。
 *
 * 为什么必须自己搬：内核 `MakePipe` / `MakePipeShell` 不会把截面平移到脊柱起点。
 * `withContact + withCorrection` 虽然能搬，但 `withContact` 只让截面**蹭到**脊柱上
 * —— 管心相对路径偏一个截面半径（实测 `z[90,102]` 而路径在 `z=90`，见
 * `sweep-kernel-behavior.test.ts` K5d），所以这里做精确落位：截面中心压在路径上。
 *
 * @param normal - 截面当前法向（单位向量）。
 * @param center - 截面当前中心（bbox 中点）。
 * @param target - 目标点（脊柱首边起点）。
 * @param tangent - 目标切向（脊柱首边起点切向，单位向量）。
 * @returns 12 元行主序仿射矩阵（`kernel.transform` 的入参形态）。
 */
export function sectionPlacementMatrix(
  normal: BrepVec3,
  center: BrepVec3,
  target: BrepVec3,
  tangent: BrepVec3,
): number[] {
  const [c0, c1, c2] = rotationColumns(normal, tangent)
  const rc = add3(add3(scale3(c0, center.x), scale3(c1, center.y)), scale3(c2, center.z))
  return [
    c0.x, c1.x, c2.x, target.x - rc.x,
    c0.y, c1.y, c2.y, target.y - rc.y,
    c0.z, c1.z, c2.z, target.z - rc.z,
  ]
}

/**
 * 截面中心（bbox 中点）：Pappus 恒等式要求管心落在路径上。
 * @param api - 引擎面。
 * @param handle - 截面句柄（面或 wire）。
 * @returns bbox 中点。
 */
export function bboxCenter(api: BrepEngineApi, handle: BrepHandle): BrepVec3 {
  const b = api.getBoundingBox(handle)
  return { x: (b.xmin + b.xmax) / 2, y: (b.ymin + b.ymax) / 2, z: (b.zmin + b.zmax) / 2 }
}

/**
 * 截面外接半径（bbox 最长边的一半）：只用于斜接自交预判。
 * @param api - 引擎面。
 * @param handle - 截面句柄。
 * @returns 外接半径（bbox 三边最大值的一半）。
 */
export function sectionRadius(api: BrepEngineApi, handle: BrepHandle): number {
  const b = api.getBoundingBox(handle)
  return Math.max(b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin) / 2
}

/**
 * 截面的平面法向。
 *
 * 面截面：读一个面的 `surfaceNormal`（`reversed` 时取反）。曲线截面：先用外环造一个
 * 临时面再读；造不出（非平面 / 不闭合）返回 `undefined`，调用方据此跳过落位而不是瞎猜。
 *
 * @param api - 引擎面。
 * @param section - 截面 shape 句柄。
 * @param ring - 外环 wire 句柄（曲线截面造临时面用）。
 * @returns 单位法向；量不出来时 `undefined`。
 */
export function sectionNormal(
  api: BrepEngineApi,
  section: BrepHandle,
  ring: BrepHandle,
): BrepVec3 | undefined {
  const pick = (face: BrepHandle): BrepVec3 | undefined => {
    const uv = api.uvBounds(face)
    const n = api.surfaceNormal(face, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
    const flipped = String(api.shapeOrientation(face)).toLowerCase() === 'reversed'
    const out = flipped ? { x: -n.x, y: -n.y, z: -n.z } : n
    return Math.hypot(out.x, out.y, out.z) < 1e-12 ? undefined : unit3(out)
  }
  try {
    const faces = api.getSubShapes(section, 'face')
    try {
      if (faces.length > 0) return pick(faces[0]!)
    } finally {
      for (const f of faces) {
        try { api.release(f) } catch { /* 已释放 */ }
      }
    }
    const tmp = api.makeFace(ring)
    try {
      return pick(tmp)
    } finally {
      try { api.release(tmp) } catch { /* 已释放 */ }
    }
  } catch {
    return undefined
  }
}

/**
 * 截面已经是「中心在脊柱起点、法向 ∥ 起点切向」时返回 true（此时不再变换，避免二次误差）。
 * @param normal - 截面法向（单位向量）。
 * @param center - 截面中心。
 * @param target - 脊柱首边起点。
 * @param tangent - 脊柱首边起点切向。
 * @param extent - 落位判定的长度尺度（一般传 `sectionRadius * 2`）。
 * @returns 已落位返回 true。
 */
export function isPlaced(
  normal: BrepVec3,
  center: BrepVec3,
  target: BrepVec3,
  tangent: BrepVec3,
  extent: number,
): boolean {
  const d = Math.hypot(center.x - target.x, center.y - target.y, center.z - target.z)
  if (d > 1e-6 * Math.max(extent, 1)) return false
  return Math.abs(dot3(normal, unit3(tangent))) >= Math.cos((1 * Math.PI) / 180)
}

/**
 * 截面是否已经落在脊柱起点、且法向与起点切向平行。
 *
 * 判据套件 C2（端面法向）与 C3（包围盒覆盖）都**以「截面在路径上」为前提**：截面
 * 整体偏移时，扫出的管整体挪位（体积累积仍对，位置错），此时 C2/C3 没有判据意义
 * —— 该修的是落位（`autoPlace` / `sweepAlong`），不是断言。所以调用方先用本函数
 * 判定，再决定要不要把 `caps` 交给判据套件。
 *
 * @param api - 引擎面。
 * @param section - 截面 shape 句柄（用于取 bbox 中心与外接半径）。
 * @param outerRing - 外环 wire 句柄（曲线截面时用于造临时面取法向）。
 * @param startPoint - 脊柱首边起点。
 * @param startTangent - 脊柱首边起点切向。
 * @returns 已落位返回 true；法向量不出来时返回 false（宁可不判，不可误判）。
 */
export function sectionIsOnPath(
  api: BrepEngineApi,
  section: BrepHandle,
  outerRing: BrepHandle,
  startPoint: BrepVec3,
  startTangent: BrepVec3,
): boolean {
  const normal = sectionNormal(api, section, outerRing)
  if (normal === undefined) return false
  const center = bboxCenter(api, section)
  return isPlaced(normal, center, startPoint, startTangent, sectionRadius(api, section) * 2)
}
