/**
 * features — 裸齿轮之上的布尔特征（倒角 / 轴孔）
 *
 * 复刻 cq_gears `GearBase._make_chamfer` / `_make_bore`（A1 尖峰
 * `scripts/spike-chamfer.ts` 已验证：spur 裸体 + chamfer0.5 + bore1 → 体积
 * 167.845620 对齐官方 167.8456187，rel 5.6e-9）。
 *
 * 实现要点（与 cq 逐字一致）：
 * - 倒角是 XZ 平面（法向 -Y）上的三角轮廓 → line-edge → wire → face → revolve 360°
 *   得到旋转体 cutter，再布尔差到裸齿轮；外部齿 / 内齿（ring）的 cutter 轮廓方向相反。
 * - 轴孔是贯穿圆柱 cut（轴心对齐 +Z，高度 = width + 2E 确保穿透）。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'

/** cq `_make_chamfer` 的小偏移量（避免共面自交）。 */
export const CHAMFER_E = 0.01

/** 倒角量：标量 = 等边；`[wx, wy]` = 半径方向 / z 方向各自的去除量。 */
export type ChamferValue = number | [number, number]

/** 倒角 / 轴孔相关构造选项（裸齿轮之上的镀铬特征）。 */
export interface GearFeatureOptions {
  /** 上下两边同时倒角（同量）。 */
  chamfer?: ChamferValue
  /** 顶面倒角量（覆盖 `chamfer`）。 */
  chamferTop?: ChamferValue
  /** 底面倒角量（覆盖 `chamfer`）。 */
  chamferBottom?: ChamferValue
  /** 轴孔直径（cq `bore_d`）。 */
  boreD?: number
}

function point(u: number, v: number): BrepVec3 {
  return { x: u, y: 0, z: v }
}

/**
 * cq `_make_chamfer` 的旋转体 cutter 三角轮廓（XZ 平面，4 个顶点：末点=首点闭合重复）。
 *
 * ⚠️ 末点必须与首点相同：`makeChamferCutter` 用 `pts.slice(0, 3).map((p, i) => makeLineEdge(p, pts[i + 1]))`
 * 构造边，i=2 时 `pts[i + 1]` 取 `pts[3]`（即首点）才能闭合三角——这是 A1 尖峰验证过的写法。
 *
 * @param ra 齿顶圆半径（外部齿=齿尖、内齿=内齿尖）
 * @param width 齿宽
 * @param wx 沿半径方向的去除量
 * @param wy 沿 z 方向的去除量
 * @param which 顶面 / 底面
 * @param isRing 内齿（true）使用与 cq `ring_gear.py` 一致的相反轮廓
 */
function chamferProfile(
  ra: number, width: number, wx: number, wy: number, which: 'top' | 'bottom', isRing: boolean,
): [BrepVec3, BrepVec3, BrepVec3, BrepVec3] {
  if (isRing) {
    const top: [BrepVec3, BrepVec3, BrepVec3] = [
      point(ra - CHAMFER_E, width - wy), point(ra - CHAMFER_E, width + CHAMFER_E), point(ra + wx, width + CHAMFER_E),
    ]
    const bottom: [BrepVec3, BrepVec3, BrepVec3] = [
      point(ra + wx, -CHAMFER_E), point(ra - CHAMFER_E, -CHAMFER_E), point(ra - CHAMFER_E, wy),
    ]
    const p = which === 'top' ? top : bottom
    return [p[0], p[1], p[2], p[0]]
  }
  const top: [BrepVec3, BrepVec3, BrepVec3] = [
    point(ra - wx, width + CHAMFER_E), point(ra + CHAMFER_E, width + CHAMFER_E), point(ra + CHAMFER_E, width - wy),
  ]
  const bottom: [BrepVec3, BrepVec3, BrepVec3] = [
    point(ra + CHAMFER_E, wy), point(ra + CHAMFER_E, -CHAMFER_E), point(ra - wx, -CHAMFER_E),
  ]
  const p = which === 'top' ? top : bottom
  return [p[0], p[1], p[2], p[0]]
}

/** 生成单个倒角 cutter 旋转体（A1 已验证的几何）。 */
export function makeChamferCutter(
  kernel: RawOcctKernel,
  ra: number, width: number, wx: number, wy: number,
  which: 'top' | 'bottom', isRing: boolean,
): BrepHandle {
  const pts = chamferProfile(ra, width, wx, wy, which, isRing)
  // 与 A1 尖峰完全一致：取前 3 顶点 → 2 条边，i=2 时 `pts[3]`（=首点）闭合三角 → wire → face → revolve 360°。
  const edges = pts.slice(0, 3).map((p, i) => kernel.makeLineEdge(p, pts[i + 1]))
  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)
  return kernel.revolve(face, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2)
}

function resolveChamfer(spec: ChamferValue | undefined): [number, number] | undefined {
  if (spec === undefined) return undefined
  return Array.isArray(spec) ? [spec[0], spec[1]] : [spec, spec]
}

/**
 * occt-wasm `BRepAlgoAPI_Cut` 有时会多包一层 compound 外壳（即使结果只是单个实体，
 * 内齿 cutter 即此情况；外部齿则直接返回 solid）。这里把「仅含 1 个 solid 的 compound」
 * 解包成 solid，与 `fixFaceOrientations` 的思路一致，避免调用方无谓地判非 solid。
 *
 * @returns 解包后的 solid；若本就不是 compound 或含多块实体则原样返回（交给调用方校验）。
 */
function asSolid(kernel: RawOcctKernel, shape: BrepHandle): BrepHandle {
  if (kernel.isSolid(shape)) return shape
  if (kernel.getShapeType(shape) === 'compound') {
    const solids = kernel.getSubShapes(shape, 'solid')
    if (solids.length === 1) return solids[0]
  }
  return shape
}

/**
 * 复刻 cq `_make_chamfer`：在裸齿轮实体上布尔差上/下倒角旋转体。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 裸齿轮 solid
 * @param ra 齿顶圆半径
 * @param width 齿宽
 * @param opts 倒角选项（chamfer / chamferTop / chamferBottom）
 * @param isRing 内齿（使用 ring 版 cutter 轮廓）
 * @returns 倒角后的 solid（cutter 无效时显式抛错，不静默吞掉）
 */
export function applyChamfer(
  kernel: RawOcctKernel,
  body: BrepHandle,
  ra: number,
  width: number,
  opts: GearFeatureOptions,
  isRing = false,
): BrepHandle {
  const top = resolveChamfer(opts.chamferTop ?? opts.chamfer)
  const bottom = resolveChamfer(opts.chamferBottom ?? opts.chamfer)
  let result = body
  if (top) {
    const cutter = makeChamferCutter(kernel, ra, width, top[0], top[1], 'top', isRing)
    if (!kernel.isValid(cutter)) {
      throw new Error(`applyChamfer: top cutter invalid (ra=${ra}, width=${width}, wx=${top[0]}, wy=${top[1]})`)
    }
    result = asSolid(kernel, kernel.cut(result, cutter))
  }
  if (bottom) {
    const cutter = makeChamferCutter(kernel, ra, width, bottom[0], bottom[1], 'bottom', isRing)
    if (!kernel.isValid(cutter)) {
      throw new Error(`applyChamfer: bottom cutter invalid (ra=${ra}, width=${width}, wx=${bottom[0]}, wy=${bottom[1]})`)
    }
    result = asSolid(kernel, kernel.cut(result, cutter))
  }
  return result
}

/**
 * 复刻 cq `_make_bore`：贯穿圆柱 cut（轴心对齐 +Z，高度 = width + 2E 确保穿透）。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 实体
 * @param boreD 轴孔直径（cq `bore_d`）
 * @param width 齿宽
 * @returns 带轴孔的 solid
 */
export function applyBore(
  kernel: RawOcctKernel,
  body: BrepHandle,
  boreD: number,
  width: number,
): BrepHandle {
  const cyl = kernel.makeCylinder(boreD / 2, width + 2 * CHAMFER_E)
  const moved = kernel.translate(cyl, 0, 0, -CHAMFER_E)
  return asSolid(kernel, kernel.cut(body, moved))
}
