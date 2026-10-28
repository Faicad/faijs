/**
 * DXF → solid（轮廓 → 面 → 拉伸 → 合并），与 `svg-to-solid.ts` 同一骨架。
 *
 * ── 为什么不复用 svgToSolid ─────────────────────────────────────────────────
 * 两者的**输入形态**不同：SVG 要解析 path `d`（贝塞尔 / 圆弧 / 子路径），DXF 是
 * 组码流里的实体（LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE + bulge），而且 DXF 已经
 * 由 `importDxfProfiles` 做好"外轮廓 + 孔洞"嵌套分组。硬塞进 svgToSolid 只会
 * 让两边都长出一堆 `if (isDxf)` 分叉。共同的部分（makeFace → addHolesInFace →
 * extrude → fuse）在本文件按同一顺序重写一遍，**定位/布尔仍留在 engrave 里**，
 * 本文件不碰它们（那才是唯一真源，见 api/engrave.ts）。
 *
 * ── 单位 ────────────────────────────────────────────────────────────────────
 * DXF 的坐标是"图纸单位"，`dxf-import.ts` 不读 `$INSUNITS`（见该文件），所以
 * 尺寸不能靠文件自称，只能由调用方给**长边目标毫米数**（`targetLongSide`，
 * 与 svgSize 同口径），按包围盒长边等比缩放到该值。缺省 20 mm。
 *
 * ── 轴向 ────────────────────────────────────────────────────────────────────
 * DXF 在 XY 平面（Y 向上），本函数不做任何翻转：画在 XY 上的图形保持原样。
 * 贴到模型面之后的方向由 engrave 的 `alignZToNormal` 决定（+Z 对齐面法向），
 * 因此"顶面（+Z）上刻的图与 DXF 里看到的一致"这条由单测钉住。
 */
import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import { getSolidBoundingBox } from '../brep-utils'
import { importDxfProfiles } from './dxf-import'

/** 缺省长边目标尺寸（mm），与 `svgToSolid` 的 `targetLongSide` 默认值一致。 */
export const DEFAULT_DXF_LONG_SIDE = 20

/** {@link dxfToSolid} 的选项。 */
export interface DxfToSolidOptions {
  /** 拉伸深度（mm）。 */
  depth: number
  /** 长边目标尺寸（mm）；缺省 {@link DEFAULT_DXF_LONG_SIDE}。 */
  targetLongSide?: number
  /** 只取某个图层（缺省 = 全部图层）。 */
  layer?: string
}

/**
 * 把 DXF 文本转成 solid：每个 `{outer, holes}` 轮廓造一张面（挖孔）→ 按长边缩放 →
 * 沿 +Z 拉伸 → 所有 solid 合成一个（fuse）。
 *
 * 失败口径（与 svgToSolid 一致：宁抛不产空体）：
 * - 解析失败（`importDxfProfiles` 的 err，带 DXF 行号）→ 原样转抛，不吞；
 * - 轮廓为 0 / 所有轮廓都面化失败 → 抛错（一个"看不见的雕刻件"比报错难查得多）。
 *
 * @param kernel BREP 内核
 * @param text DXF 文本
 * @param options 深度 / 长边 / 图层
 * @returns 合并后的单一 solid（多轮廓时可能是 compound，交给 engrave 逐 solid 处理）
 */
export function dxfToSolid(
  kernel: BrepEngineApi,
  text: string,
  options: DxfToSolidOptions,
): BrepHandle {
  const { depth, targetLongSide = DEFAULT_DXF_LONG_SIDE, layer } = options
  if (!(depth > 0)) {
    throw new Error(`[dxfToSolid] depth 必须是正数，收到 ${String(depth)}`)
  }

  const profilesResult = importDxfProfiles(kernel, text, layer)
  if (!profilesResult.ok) {
    const e = profilesResult.error
    // 原样转抛：DXF 解析错误带行号，改成一句"DXF 解析失败"就把唯一有用的信息丢了。
    throw new Error(`[dxfToSolid] ${e.code}: ${e.message}`)
  }
  const profiles = profilesResult.value
  if (profiles.length === 0) {
    throw new Error('[dxfToSolid] DXF 里没有可用的闭合轮廓')
  }

  // ① 轮廓 → 面（外轮廓 + 挖孔）。失败的轮廓单独跳过，全部失败才算错。
  const faces: BrepHandle[] = []
  for (const profile of profiles) {
    try {
      let face = kernel.makeFace(profile.outer)
      if (profile.holes.length > 0) {
        const withHoles = kernel.addHolesInFace(face, profile.holes)
        kernel.release(face)
        face = withHoles
      }
      faces.push(face)
    } catch {
      // makeFace 失败（轮廓自交 / 端点不连续）→ 跳过这一个，继续其余的。
    }
  }
  if (faces.length === 0) {
    throw new Error('[dxfToSolid] DXF 轮廓无法面化（自交或端点不连续）')
  }

  // ② 长边归一：按**所有面**的合并包围盒长边算比例（单个轮廓各缩各的会把图形比例弄乱）。
  //    面都在 z=0，均匀缩放不会影响 Z，因此 depth 不受缩放影响（与 svgToSolid 同法）。
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  for (const face of faces) {
    const bb = kernel.getBoundingBox(face, false)
    if (bb.xmin < minX) minX = bb.xmin
    if (bb.xmax > maxX) maxX = bb.xmax
    if (bb.ymin < minY) minY = bb.ymin
    if (bb.ymax > maxY) maxY = bb.ymax
  }
  const longSide = Math.max(maxX - minX, maxY - minY)
  const scale = longSide > 1e-9 && targetLongSide > 0 ? targetLongSide / longSide : 1
  if (scale !== 1) {
    for (let i = 0; i < faces.length; i++) {
      const scaled = kernel.scale(faces[i], { x: 0, y: 0, z: 0 }, scale)
      kernel.release(faces[i])
      faces[i] = scaled
    }
  }

  // ③ 拉伸 + 合并。
  const solids: BrepHandle[] = []
  for (const face of faces) {
    try {
      solids.push(kernel.extrude(face, 0, 0, depth))
    } catch {
      // 单张面拉伸失败 → 跳过（与面化失败同口径）。
    } finally {
      try { kernel.release(face) } catch { /* 已释放 */ }
    }
  }
  if (solids.length === 0) {
    throw new Error('[dxfToSolid] DXF 轮廓无法拉伸成实体')
  }

  let result = solids[0]
  for (let i = 1; i < solids.length; i++) {
    const prev = result
    result = kernel.fuse(prev, solids[i])
    kernel.release(prev)
    kernel.release(solids[i])
  }

  // ④ 居中：XY 居中到原点、Z 底部对齐 0 —— 与 svgToSolid / textToSolid 同一姿态基准，
  //    上层的 alignZToNormal + 偏移因此对三种源完全一致（它们只关心"实体中心在原点"）。
  const bb = getSolidBoundingBox(kernel, result)
  const cx = (bb.min[0] + bb.max[0]) / 2
  const cy = (bb.min[1] + bb.max[1]) / 2
  const cz = bb.min[2]
  const centered = kernel.translate(result, -cx, -cy, -cz)
  kernel.release(result)
  return centered
}
