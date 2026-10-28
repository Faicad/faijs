/**
 * api engrave — 雕刻库函数
 *
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：textToSolid/svgToSolid + boolean（cut/fuse）。
 */

import type { Shape, Vec3 } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { AssetResolver } from '../cad-runtime/ports'
// B3 correction (2026-10-06): no library-face cad aggregate — import the impl from its own module.
import * as meshEngrave from '../mesh/engrave'
import { parseSvgNaturalSize } from '../primitives/parse-svg-size'
import { textToSolid } from '../brep/text/text-to-solid'
import { placeOnFace } from '../brep/text/face-place'
import { svgToSolid } from '../brep/svg/svg-to-solid'
import { dxfToSolid } from '../brep/dxf/dxf-to-solid'
import { ensureDefaultFont } from '../brep/text/fontRegistry'
import { solidToShape } from '../brep/brep-ops'
import { resolveAssetTextArg, resolveSvgArg } from './internal/svg-asset-resolver'
import { getBackends } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { assertPositiveNumber } from './assert'

// ── per-op 参数自校验（Phase 2.2；api 层被直接 import 时的防御层） ──

/**
 * Validate engrave parameters: at least one of `text` / `svg` / `dxf` must be
 * provided, and `depth` (if provided) must be a positive number.
 *
 * 三者**互斥地选一个**（不是"至少一个"就够）：同时给两个源时下面的实现只会取
 * 第一个命中的分支，多余的那个被静默忽略 —— 那是"我给了 logo 但刻的是字"级别的
 * 事故，所以这里直接拒绝。
 * @param params - the raw engrave operation parameters.
 */
export function assertEngraveParams(params: Record<string, unknown>): void {
  const hasText = params.text !== undefined && params.text !== null && params.text !== ''
  const hasSvg = params.svg !== undefined && params.svg !== null
  const hasDxf = params.dxf !== undefined && params.dxf !== null
  if (!hasText && !hasSvg && !hasDxf) {
    throw new Error('[api/engrave] requires one of "text" / "svg" / "dxf"')
  }
  const provided = [hasText && 'text', hasSvg && 'svg', hasDxf && 'dxf'].filter(Boolean)
  if (provided.length > 1) {
    throw new Error(`[api/engrave] "text" / "svg" / "dxf" are mutually exclusive, got ${provided.join(' + ')}`)
  }
  if (params.depth !== undefined && params.depth !== null) {
    assertPositiveNumber(params.depth, 'engrave.depth')
  }
}

/** BREP 路径：textToSolid / svgToSolid / dxfToSolid + boolean（cut/fuse）。 */
async function engraveBrepPath(
  input: Shape,
  params: Record<string, unknown>,
  svgText?: string,
  dxfText?: string,
): Promise<Shape> {
  const kernel = getBrepApi()
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (inputSolid === undefined) throw new Error('[api/engrave] input is not BREP')

  const depth = params.depth as number
  const mode = (params.mode as 'convex' | 'concave' | undefined) ?? 'concave'
  const text = params.text as string | undefined

  // 1. 创建装饰 solid（文字 / SVG / DXF），depth 与 mesh 路径一致
  let decorationSolid: BrepHandle
  if (text) {
    await ensureDefaultFont()
    const textSize = (params.textSize as number) ?? 10
    decorationSolid = textToSolid(kernel, text, { fontSize: textSize, depth })
  } else if (svgText) {
    decorationSolid = svgToSolid(kernel, svgText, {
      depth,
      targetLongSide: (params.svgSize as number) ?? 20,
    })
  } else if (dxfText) {
    // DXF：与 svg 同一口径（长边归一），差别只在轮廓解析（组码实体 + bulge 圆弧）。
    decorationSolid = dxfToSolid(kernel, dxfText, {
      depth,
      targetLongSide: (params.dxfSize as number) ?? 20,
    })
  } else {
    throw new Error('[api/engrave] neither text, svg nor dxf provided')
  }

  // 2. 居中 → 旋到面法向 → 沿法向偏移后平移到面中心
  //    （凸 offset=+depth/2，凹 offset=-depth/2；加 0.01 避免共面）。
  //    对齐与平移合并到 `placeOnFace`：`cad.text` 的"贴面"走的是同一份实现，
  //    两个工具选同一张面时方向与位置完全一致（2026-10-28 用户要求）。
  // faceCenter/faceNormal 契约（方向 A）：模型局部空间值（宿主生成脚本时已把交互
  // 世界坐标转换好），本 op 不做 world→local（无 partTransform 依赖）。
  const worldFaceNormal: Vec3 = (params.faceNormal as Vec3) ?? [0, 0, 1]
  const localFaceCenter: Vec3 = (params.faceCenter as Vec3) ?? [0, 0, 0]
  const offset = mode === 'convex' ? depth / 2 : -depth / 2
  const positioned = placeOnFace(kernel, decorationSolid, localFaceCenter, worldFaceNormal, offset + 0.01)

  // 5. 布尔运算（凸=fuse，凹=cut）——text/svg 的 decorationSolid 可能是多组
  // compound（虚拟容器：零件独立、禁布尔合并，见 smlibKernel makeCompound），
  // 整块送内核布尔会拿虚拟句柄当指针（invoke 异常）。逐零件布尔等价于
  // occt cut/fuse(solid, compound)：用每个成员依次切/并。真 solid 时
  // getSubShapes('solid') 返回 [自身]，循环一次即原语义。
  const isRaised = mode === 'convex'
  const toolSolids = kernel.getSubShapes(positioned, 'solid')
  let result = inputSolid
  for (const tool of toolSolids) {
    if (isRaised) result = kernel.fuse(result, tool)
    else result = kernel.cut(result, tool)
  }
  kernel.release(positioned)

  // 5b. cut 可能分裂成多个 solid（compound），用 fuseAll 合并回单一 solid
  try {
    const subSolids = kernel.getSubShapes(result, 'solid')
    if (subSolids.length > 1) {
      const fused = kernel.fuseAll(subSolids)
      for (const s of subSolids) {
        try { kernel.release(s) } catch { /* 已释放 */ }
      }
      try { kernel.release(result) } catch { /* 已释放 */ }
      result = fused
    }
  } catch {
    // getSubShapes 失败说明结果不是 compound，无需处理
  }

  return fromBrep(solidToShape(kernel, result), { solid: result })
}

/** 解析 SVG 资产引用（AssetRef → SVG 文本），两条路径共享；无 svg 返回 undefined。 */
async function resolveEngraveSvg(params: Record<string, unknown>): Promise<string | undefined> {
  return params.svg !== undefined && params.svg !== null
    ? await resolveSvgArg(params.svg, { assets: getBackends().assets as AssetResolver | undefined })
    : undefined
}

/** 解析 DXF 资产引用（同上，文案里报 DXF）；无 dxf 返回 undefined。 */
async function resolveEngraveDxf(params: Record<string, unknown>): Promise<string | undefined> {
  return params.dxf !== undefined && params.dxf !== null
    ? await resolveAssetTextArg(params.dxf, { assets: getBackends().assets as AssetResolver | undefined }, 'DXF')
    : undefined
}

/**
 * 在几何表面雕刻文字、SVG 或 DXF 轮廓（三种源，出口同一套定位 + 布尔）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name engrave
 * @returns Shape 雕刻后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.mode - 雕刻方式：concave 凹陷（减法）/ convex 凸出（加法）。type:'concave' | 'convex' 默认 'concave'
 * @param params.depth - 深度 / 凸出高度（mm）。type:number 默认 0
 * @param params.text - 文字内容（与 svg / dxf 三选一）。type:string
 * @param params.textSize - 字号（mm）。type:number 默认 10
 * @param params.svg - SVG 文本或资产引用（与 text / dxf 三选一；`{$asset:key}` 经宿主 assets 解析）。type:string
 * @param params.svgSize - SVG 长边目标尺寸。type:number
 * @param params.dxf - DXF 文本或资产引用（与 text / svg 三选一）。type:string
 * @param params.dxfSize - DXF 长边目标尺寸（与 svgSize 同口径，缺省 20）。type:number
 * @param params.faceCenter - 面位置（绝对坐标）。type:[x,y,z] 默认 [0,0,0]
 * @param params.faceNormal - 面法向。type:[x,y,z] 默认 [0,0,1]
 * @note 早期 logo 分支用 `svgText`（整份 XML 拷贝 + `svgSize` 文本导出丢失，往返失真）；现已改为 `svg` 资产引用，`engravingType` 冗余键已移除。faceCenter/faceNormal 目前是绝对坐标快照。DXF 只走 BREP 路径（mesh 几何上会显式报错，不静默忽略）。
 * @example
 * const p = cad.engrave(part0, { mode: 'concave', depth: 2, text: 'Hello', textSize: 10, faceCenter: [0, 0, 0], faceNormal: [0, 0, -1] })
  */
export const engrave = defineOp({
  mesh: async (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/engrave] no input geometry')
    assertEngraveParams(params)
    // DXF 只有 BREP 实现（`dxfToSolid` 走内核的面/拉伸）。mesh 几何上前端仍会进
    // 到这里 —— 静默忽略等于"选了个 DXF 但什么都没刻"，必须报错。
    if (params.dxf !== undefined && params.dxf !== null) {
      throw new Error('[api/engrave] dxf source requires BREP geometry (input is mesh)')
    }
    const svgText = await resolveEngraveSvg(params)
    // mesh 路径
    const faceCenter: Vec3 = (params.faceCenter as Vec3) ?? [0, 0, 0]
    const faceNormal: Vec3 = (params.faceNormal as Vec3) ?? [0, 0, 1]
    const { naturalWidth, naturalHeight } = svgText ? parseSvgNaturalSize(svgText) : { naturalWidth: 0, naturalHeight: 0 }
    const hasText = !!(params.text as string | undefined)

    return meshEngrave.engrave(input, {
      mode: (params.mode as 'convex' | 'concave' | undefined) ?? 'concave',
      depth: params.depth as number,
      face: { center: faceCenter, normal: faceNormal },
      text: hasText ? (params.text as string) : undefined,
      textSize: params.textSize as number | undefined,
      svg: svgText,
      svgNaturalWidth: naturalWidth,
      svgNaturalHeight: naturalHeight,
      svgSize: params.svgSize as number | undefined,
    })
  },
  brep: async (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[api/engrave] no input geometry')
    assertEngraveParams(params)
    const svgText = await resolveEngraveSvg(params)
    const dxfText = await resolveEngraveDxf(params)
    return engraveBrepPath(input, params, svgText, dxfText)
  },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,

  paramDims: { depth: 'length', textSize: 'length', svgSize: 'length', dxfSize: 'length' },
})
