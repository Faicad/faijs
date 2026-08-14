/**
 * exportStepFromSolid — L1 STEP 导出（从 OCCT solid 句柄）
 *
 *
 * 从 BREP 链终端 solid 句柄导出 STEP 文件。
 * 这是 exporters/index.ts 中 exportBrepSolidToStep() 的 L1 等价物，
 * 不依赖任何 store/DOM/THREE。
 */

import type { ShapeHandle, OcctKernel } from 'occt-wasm'

/**
 * Export a BREP solid (OCCT native) to STEP format.
 *
 * @param solid   OCCT solid handle
 * @param kernel  OCCT kernel (must match the one that created the solid)
 * @returns STEP file content as ArrayBuffer
 */
export function exportStepFromSolid(
  solid: ShapeHandle,
  kernel: OcctKernel,
): ArrayBuffer {
  const stepContent = kernel.exportStep(solid)
  return new TextEncoder().encode(stepContent).buffer
}
