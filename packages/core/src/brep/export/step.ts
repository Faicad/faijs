/**
 * exportStepFromSolids — L1 STEP 导出（从 OCCT solid 句柄，多实体、零 fuse）
 *
 * @platform occt — 本文件 import occt-kernel（createXCAFDocument/XCAF label 写入是
 * occt-only 平台面，D3）。文件级标注满足守卫①（平台 import 自证身份）。
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
import { getOcctKernel, type ShapeHandle } from '../../occt-kernel/occtKernel'

/** STEP 导出条目：一个 part 的精确 BREP 形状。 */
export interface StepExportEntry {
  /**
   * 精确 BREP 形状（solid/shell/face/compound，来自宿主导出缓存）。
   *
   * **必填**：曾经的「没有 solid 就从 `mesh` 重建」分支已删除（方案 2026-10-01 §3.6）。
   * 网格零件导出 STEP 必须**失败**并指出 part 名，而不是被静默升格成 facet BREP——
   * 那正是本项目区分 mesh/BREP 所要杜绝的产物。网格零件请导出 STL/3MF。
   */
  solid: BrepHandle
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
 * Export multiple BREP solids to STEP, one independent entity per entry — no
 * fuse, no string splicing, and **no mesh reconstruction**.
 *
 * @param kernel  OCCT kernel (must match the one that created the solids)
 * @param entries parts to export; each becomes its own XCAF label
 * @returns STEP file content as ArrayBuffer
 * @throws if entries is empty, or an entry carries no BREP handle (a mesh part
 *   cannot be exported to STEP — see `StepExportEntry.solid`)
 */
export function exportStepFromSolids(
  kernel: BrepEngineApi,
  entries: StepExportEntry[],
): ArrayBuffer {
  if (entries.length === 0) {
    throw new Error('No exportable geometry')
  }

  const doc = getOcctKernel().createXCAFDocument()
  // 本函数创建的句柄（展平出的子 solid），导出后释放。
  // 缓存里的原 solid（entry.solid）绝不释放，归调用方/缓存所有。
  const ownedHandles: BrepHandle[] = []

  try {
    for (const entry of entries) {
      // 1. solid 必须由调用方给出精确 BREP 句柄。这里**没有**网格重建回退：
      //    留一句「从三角网格重建 BREP」就等于承认 facet STEP 合法。调用侧
      //    （exportModel）已按 part 名拒绝，本层是最后一道闸。
      const solid = entry.solid
      if (!solid) {
        throw new Error(
          `E_STEP_MESH_PART: entry ${JSON.stringify(entry.name ?? '<unnamed>')} has no BREP handle — ` +
          'a mesh part cannot be exported to STEP (export it as STL/3MF instead)',
        )
      }

      // 2. 展平 Compound（多 solid 导入的 part 其 solid 是 Compound）；
      //    纯 solid 时 getSubShapes('solid') 返回 [自身]。
      //    形状类型分派：solid → shell → face → edge。ref 侧（cadquery
      //    Shape.exportStep）可导出任意类型的形状，面/壳/边 compound（如
      //    Shape.faces('>Z') / shape.edges('>Z') 的结果）同样要能写进
      //    STEP（U22，2026-09-09）。
      let subs = kernel.getSubShapes(solid, 'solid')
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'shell')
      }
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'face')
      }
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'edge')
      }
      if (subs.length === 0) {
        // wasm getSubShapes 不展开 compound 层（TopExp_Explorer 默认跳过），
        // 纯面/壳/边 compound（如 Shape.siblings / faces('>Z') 结果）在这里
        // 拿不到子形状。把 compound 整体作为单个 XCAF label 写入（STEP
        // writer 支持 compound 形状，与 ref 侧 cadquery Shape.exportStep
        // 对 faces/edges compound 的行为一致）。
        subs = [solid]
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
        // 平台面（D3）：XCAF label 写入是 occt-only。BrepHandle ↔ ShapeHandle
        // 运行时同构，品牌转换只发生在平台边界。
        doc.addShape(sub as unknown as ShapeHandle, { name, color })
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