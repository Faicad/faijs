/**
 * api view-export — 视图与导出族（平台 op engines:['occt']，普通函数形态）
 *
 * @platform occt — 4 个光栅/矢量导出（`toSVG` / `toMultiviewSVG` / `toPNG` /
 * `toMultiviewPNG`）直调 occt-wasm 原生同名方法（occt-wasm 5.6.0 有，见
 * `dist/index.d.ts` 的 `OcctKernel`）。这些原生方法**不在** L1 契约
 * `BrepEngineApi` 里（L1 只有导入/导出 STEP/STL，无 HLR→SVG / 光栅输出），因此它们
 * 不能走中立路径，必须声明 `engines: ['occt']` 直调 occt（方案 §3.4.7 校正注——
 * 原 S3 初稿把 toSVG/toMultiviewSVG 标为「中立（扩 projectView/projectSheet）」，
 * 实测 L1 无对应成员，更正为 occt 平台 op）。
 *
 * 为什么不是 `defineOp`：本族返回**字符串 / Uint8Array**（非 Shape）。`defineOp` 的
 * brep 包装（`define-op.ts#wrapBrepOne`）把返回值一律收养为 Shape，装不下文本/字节。
 * 数据型平台 op 走普通函数，是 `api/export-brep.ts` 与 `api/shape-type` 的既定口径。
 *
 * 引擎身份**不能**靠 dispatchPath 门控（普通函数不走那条路）⇒ 按
 * `api/internal/l3-bridge.ts#assertEngineFor` 的既定做法：函数体第一行断言当前引擎，
 * 触碰内核之前报出与 D11-4 同构的 `E_BREP_UNSUPPORTED`，不补桩、不回退。
 * （与 dispatchPath 的差异：`assertEngineFor` **不含** D11-3 的 `brep_mock` 豁免——
 *  mock 句柄不是 occt 句柄，放行只会拿到错形状，故这里如实拦截。）
 *
 * 注册：api/api-namespace.ts 手动 import + 进 createApiNamespace 对象；覆盖率扫描器
 * scan-occt-op-coverage.ts 的 PLAN_C2_EXTRA 补 4 个方法名（普通函数不在 defineOp
 * 全集口径内，collectOps 看不见）。
 *
 * §9.5 降级路径（记录在案）：一旦 brepkit 的 wasm 面把 HLR/光栅渲染接进 L1 契约且两侧
 * 适配器同时落地，这些函数删掉 assertEngineFor 并改走 `getBrepApi()`，对应方法即从 C2
 * 转入 C1。
 */

import type { Shape } from '../../mesh/types'
import type { ShapeHandle, ViewName, SvgViewOptions, PngViewOptions, MultiviewSvgOptions, MultiviewPngOptions } from 'occt-wasm'
import { brepOf } from '../../shape'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { assertEngineFor } from '../internal/l3-bridge'

/** 借出形状的内核句柄；无 BREP 槽（mesh-only）报错。 */
function occtHandleOf(shape: Shape, op: string): ShapeHandle {
  const h = brepOf(shape) as unknown as ShapeHandle | undefined
  if (!h) {
    throw new Error(`E_SHAPE_TYPE_NO_BREP: ${op} requires a BREP handle (mesh-only shape has none)`)
  }
  return h
}

/**
 * 将形状渲染为 SVG 字符串（HLR 隐藏线消除，单命名视图）。
 * @group 视图
 * @inputs 1
 * @async false
 * @qual ok
 * @name toSVG
 * @note 平台 op：仅 occt 引擎（原生 toSVG）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns string SVG 文本（含命名视图与隐藏边虚线样式）。
 * @param shape - 被渲染的形状。type:Shape required:true
 * @param view - 命名视图（front/top/right/iso 等）。type:string required:false
 * @param options - SVG 渲染选项。type:object required:false
 * @example
 * const svg = cad.toSVG(box, 'iso')
 */
export function toSVG(shape: Shape, view?: ViewName, options?: SvgViewOptions): string {
  assertEngineFor('toSVG', ['occt'])
  return getOcctKernel().toSVG(occtHandleOf(shape, 'toSVG'), view, options)
}

/**
 * 将形状渲染为多视图 SVG 图纸（Front/Top/Right/Iso 默认排布，含 gnomons 与尺寸标注）。
 * @group 视图
 * @inputs 1
 * @async false
 * @qual ok
 * @name toMultiviewSVG
 * @note 平台 op：仅 occt 引擎（原生 toMultiviewSVG）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。
 * @returns string 多视图 SVG 文本。
 * @param shape - 被渲染的形状。type:Shape required:true
 * @param options - 多视图渲染选项。type:object required:false
 * @example
 * const sheet = cad.toMultiviewSVG(box)
 */
export function toMultiviewSVG(shape: Shape, options?: MultiviewSvgOptions): string {
  assertEngineFor('toMultiviewSVG', ['occt'])
  return getOcctKernel().toMultiviewSVG(occtHandleOf(shape, 'toMultiviewSVG'), options)
}

/**
 * 将形状栅格化为 PNG 字节（与 toSVG 同绘制，经 CompressionStream 压缩）。
 * @group 视图
 * @inputs 1
 * @async true
 * @qual ok
 * @name toPNG
 * @note 平台 op：仅 occt 引擎（原生 toPNG，返回 Promise<Uint8Array>）。非 occt 引擎
 *       执行前报 E_BREP_UNSUPPORTED。
 * @returns Promise<Uint8Array> PNG 字节流。
 * @param shape - 被渲染的形状。type:Shape required:true
 * @param view - 命名视图（front/top/right/iso 等）。type:string required:false
 * @param options - PNG 渲染选项。type:object required:false
 * @example
 * const png = await cad.toPNG(box, 'iso')
 */
export async function toPNG(shape: Shape, view?: ViewName, options?: PngViewOptions): Promise<Uint8Array> {
  assertEngineFor('toPNG', ['occt'])
  return getOcctKernel().toPNG(occtHandleOf(shape, 'toPNG'), view, options)
}

/**
 * 将形状栅格化为多视图 PNG 字节（与 toMultiviewSVG 同绘制）。
 * @group 视图
 * @inputs 1
 * @async true
 * @qual ok
 * @name toMultiviewPNG
 * @note 平台 op：仅 occt 引擎（原生 toMultiviewPNG，返回 Promise<Uint8Array>）。非
 *       occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns Promise<Uint8Array> 多视图 PNG 字节流。
 * @param shape - 被渲染的形状。type:Shape required:true
 * @param options - 多视图渲染选项。type:object required:false
 * @example
 * const sheet = await cad.toMultiviewPNG(box)
 */
export async function toMultiviewPNG(shape: Shape, options?: MultiviewPngOptions): Promise<Uint8Array> {
  assertEngineFor('toMultiviewPNG', ['occt'])
  return getOcctKernel().toMultiviewPNG(occtHandleOf(shape, 'toMultiviewPNG'), options)
}
