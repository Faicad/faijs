/**
 * generated/topology.ts — 生成文件，禁手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 从 api/surface/arg-spec.ts 生成（E5/P13）。
 * topology 模块 4 个投影符号（ARG_SPEC 首批样本；全量在 P14 扩充）。
 */
import { defineOp } from '../../sdk'
import type { Shape } from '../../mesh/types'
import { borrowBrepjsShape, adoptBrepjsProduct, callBrepjs } from '../internal/l3-bridge'
import { torus as __vendored_torus } from '../../vendored/brepjs/topology/primitiveFns.js'
import { fuse as __vendored_fuse } from '../../vendored/brepjs/topology/booleanFns.js'
import { getBounds as __vendored_getBounds } from '../../vendored/brepjs/topology/shapeFns.js'
import type { Bounds3D } from '../../vendored/brepjs/topology/shapeFns.js'

export type { Bounds3D } from '../../vendored/brepjs/topology/shapeFns.js'

/**
 * torus — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (majorRadius: number, minorRadius: number, options?: TorusOptions)
 * 桥接：几何输入借入 brepjs handle → 调 vendored → 产物 adopt（E5 模板）。
 */
export const torus = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args
    const __r = callBrepjs(__vendored_torus, __args)
    return adoptBrepjsProduct(__r)
  },
  consumes: "none"
})

/**
 * fuse — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (a: Shape3D, b: Shape3D, options?: BooleanOptions) -> Result<Shape3D>
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const fuse = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0,1].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_fuse, __args)
    if (!__r.ok) throw new Error('[faijs/generated] fuse: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * getBounds — brepjs 投影查询（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (shape: AnyShape) -> Bounds3D
 * 输入 faijs Shape 借入 brepjs handle，返回纯数据（consumes 语义由查询表达式承载）。
 *
 * @param shape - 被测量的 faijs Shape（其 brep 槽位被借入 vendored 树）。
 * @returns Bounds3D 纯数据结果（非 Shape，不进 defineOp）。
 */
export function getBounds(shape: Shape): Bounds3D {
  const g = borrowBrepjsShape(shape as Shape)
  return __vendored_getBounds(g as never)
}
