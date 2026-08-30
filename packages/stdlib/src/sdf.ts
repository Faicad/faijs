/**
 * stdlib sdf — SDF 库函数（mesh-only，创建类无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2/P4
 *
 * sdf 无 BREP 实现（mesh-only）——dispatchPath 在 brep 模式下调用前抛错。
 * part-brep-lost 事件由引擎统一发（P4，库不再 emit）。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { solid } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'

/**
 * Validate sdf parameters: `code` must be a non-empty string.
 * @param params - the raw sdf operation parameters.
 */
export function assertSdfParams(params: Record<string, unknown>): void {
  if (typeof params.code !== 'string' || params.code.trim() === '') {
    throw new Error(`[stdlib/sdf] code must be a non-empty string, got ${JSON.stringify(params.code)}`)
  }
}

/**
 * 用 SDF（符号距离场）函数生成网格体（mesh-only）。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual warn
 * @name sdf
 * @note SDF 无 BREP 实现（mesh-only）；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError。SDF 天生是网格操作，允许网格参数（resolution）。
 * @returns Shape SDF 生成的网格体，生成独立零件。
 * @param params.code - SDF 函数源码（`sdf(x,y,z)` 定义或标题模板调用，如 'return sphere(10) - sphere(5, [10,0,0])'）。type:string required:true
 * @param params.box - 采样包围盒。type:[[minX,minY,minZ],[maxX,maxY,maxZ]] 默认 [[-10,-10,-10],[10,10,10]]
 * @param params.resolution - 网格单元边长（越小越精细）。type:number 默认 1.0
 * @param params.params - 参数数值表（SDF 里引用的变量值）。type:object
 * @example
 * const s = await cad.sdf({ code: 'return sphere(10) - sphere(5, [10,0,0])', box: [[-20,-20,-20],[30,20,20]], resolution: 1 })
  */
export async function sdf(params: Record<string, unknown>): Promise<Shape> {
  assertSdfParams(params)
  // mesh-only：无 brepImpl；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError
  dispatchPath([], undefined)
  return solid(await cad.sdf({
    code: params.code as string,
    box: params.box as [[number, number, number], [number, number, number]] | undefined,
    resolution: params.resolution as number | undefined,
    params: params.params as Record<string, number> | undefined,
  }))
}
