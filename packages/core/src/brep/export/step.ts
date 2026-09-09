/**
 * exportStepFromSolids — L1 STEP 导出（从 OCCT solid 句柄，多实体、零 fuse）
 *
 * 每个 entry 作为 STEP 中一个独立实体（独立 XCAF label / PRODUCT）导出，
 * 保留名称与颜色。多实体之间绝不 fuse —— 这是硬性约定：
 * fuse 只允许作为用户脚本里的几何布尔运算，禁止作为导出时的实体合并手段。
 *
 * 导出 → 再导入身份闭环：导入侧 importAssemblyFromStep（XCAF）会把
 * 多实体 STEP 还原为多个 part；多 solid compound 拆分出的子节点命名为
 * `name [n]`，与本节点的展平命名规则一致。
 */

import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import { reconstructSolidFromMesh } from '../../occt-kernel/meshReconstruct'

/** STEP 导出条目：一个 part（精确 BREP 形状或三角网格，二选一）。 */
export interface StepExportEntry {
  /** 精确 BREP 形状（solid/shell/face/compound，来自宿主导出缓存）。与 mesh 二选一，solid 优先。 */
  solid?: BrepHandle
  /** 三角网格（世界坐标、已按单位缩放），经 reconstructSolidFromMesh 重建为实体。 */
  mesh?: { positions: Float32Array; indices: Uint32Array }
  /** 实体名称（写入 label name，导出为 PRODUCT 名称）。 */
  name?: string
  /** RGB 0..1 颜色（sRGB 编码，如宿主材质 base color）。写入前转 linear。 */
  color?: [number, number, number]
}

/**
 * sRGB → linear 转换。
 *
 * OCCT XCAF 内部按 linear RGB 存储颜色，STEP writer（xcafExportSTEP）
 * 导出时做 linear→sRGB 编码写 COLOUR_RGB。为了让"宿主传入的 sRGB 颜色 ==
 * STEP 文件中的 COLOUR_RGB == 回读颜色"，写入前必须先转 linear。
 *
 * @param c sRGB 编码值（0..1）
 * @returns linear 值（0..1）
 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Export multiple BREP solids (and/or triangle meshes) to STEP, one
 * independent entity per entry — no fuse, no string splicing.
 *
 * @param kernel  OCCT kernel (must match the one that created the solids)
 * @param entries parts to export; each becomes its own XCAF label
 * @returns STEP file content as ArrayBuffer
 * @throws if entries is empty, or a mesh entry fails to reconstruct
 */
export function exportStepFromSolids(
  kernel: BrepEngineApi,
  entries: StepExportEntry[],
): ArrayBuffer {
  if (entries.length === 0) {
    throw new Error('No exportable geometry')
  }

  const doc = kernel.createXCAFDocument()
  // 本函数创建的句柄（展平出的子 solid + mesh 重建的 solid），导出后释放。
  // 缓存里的原 solid（entry.solid）绝不释放，归调用方/缓存所有。
  const ownedHandles: BrepHandle[] = []

  try {
    for (const entry of entries) {
      // 1. 解析 solid：优先用精确 solid；无则从三角网格重建
      let solid = entry.solid
      if (!solid) {
        if (!entry.mesh) {
          throw new Error('StepExportEntry must provide either solid or mesh')
        }
        solid = reconstructSolidFromMesh(kernel, entry.mesh.positions, entry.mesh.indices)
        ownedHandles.push(solid)
      }

      // 2. 展平 Compound（多 solid 导入的 part 其 solid 是 Compound）；
      //    纯 solid 时 getSubShapes('solid') 返回 [自身]。
      //    形状类型分派：solid → shell → face。ref 侧（cadquery
      //    Shape.exportStep）可导出任意类型的形状，面/壳 compound（如
      //    Shape.faces('>Z') 的结果）同样要能写进 STEP（U22，2026-09-09）。
      let subs = kernel.getSubShapes(solid, 'solid')
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'shell')
      }
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'face')
      }
      if (subs.length === 0) {
        throw new Error(
          '[exportStepFromSolids] shape contains no solid, shell or face sub-shapes',
        )
      }
      for (let si = 0; si < subs.length; si++) {
        const sub = subs[si]
        // 展平出的子句柄若不属于调用方缓存，记入 ownedHandles
        if (solid !== sub) ownedHandles.push(sub)
        const name = subs.length > 1
          ? `${entry.name ?? 'part'} [${si + 1}]`
          : entry.name
        // sRGB → linear：XCAF 按 linear 存储，STEP writer 输出时线性→sRGB，
        // 转换后 STEP 文件里的 COLOUR_RGB 才是宿主传入的原始 sRGB 值。
        const color: [number, number, number] | undefined = entry.color
          ? [srgbToLinear(entry.color[0]), srgbToLinear(entry.color[1]), srgbToLinear(entry.color[2])]
          : undefined
        doc.addShape(sub, { name, color })
      }
    }

    // 3. 导出（每个 label 一个独立 PRODUCT，保留名称/颜色）
    const stepText = doc.exportSTEP()
    return new TextEncoder().encode(stepText).buffer
  } finally {
    // 4. 释放顺序：先关文档，再释放本函数创建的句柄
    doc.close()
    for (const h of ownedHandles) {
      try {
        kernel.release(h)
      } catch {
        // already released
      }
    }
  }
}

/**
 * Export a BREP solid (OCCT native) to STEP format.
 *
 * 单实体导出 = exportStepFromSolids 的单条目特例（同一实现，无第二真源）。
 *
 * @param solid   OCCT solid handle
 * @param kernel  OCCT kernel (must match the one that created the solid)
 * @returns STEP file content as ArrayBuffer
 */
export function exportStepFromSolid(
  solid: BrepHandle,
  kernel: BrepEngineApi,
): ArrayBuffer {
  return exportStepFromSolids(kernel, [{ solid }])
}