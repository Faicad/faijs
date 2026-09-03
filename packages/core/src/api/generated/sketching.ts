/**
 * generated/sketching.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * sketching 模块：5 个投影符号；另有 47 个 skip 登记。
 */
import { compatOp } from '../internal/compat-op'
import { projectBrepOp } from '../internal/compat-projection'
import { makeBaseBox as __vendored_makeBaseBox } from '../../vendored/brepjs/sketching/shortcuts.js'

export type { Drawing } from '../../vendored/brepjs/sketching/drawing.js'

export type { DrawingPen } from '../../vendored/brepjs/sketching/drawingPen.js'

export type { SketchInterface } from '../../vendored/brepjs/sketching/sketch.js'

export { polysideInnerRadius } from '../../vendored/brepjs/sketching/cannedSketches.js'

/**
 * makeBaseBox — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (xLength: number, yLength: number, zLength: number) -> Shape3D
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const makeBaseBox = compatOp(
  projectBrepOp('makeBaseBox', ["xLength","yLength","zLength"], 'A', __vendored_makeBaseBox),
  { name: 'makeBaseBox', consumes: "none" },
)
