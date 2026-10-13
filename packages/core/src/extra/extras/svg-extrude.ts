/**
 * svg-extrude — SVG → 拉伸几何（editor extension library，three-free）。
 *
 * 几何链：SVG 文本 → Contour[]（共享 SVG 语法层折线化 + group matrix +
 * Y 翻转 + evenodd 分类，`@faicad/faijs/primitives/svg/svg-path`）→
 * `extrudeShape`（core 自有）→ 缩放 → 居中。返回 core `Shape`。
 *
 * 与旧 three `SVGLoader` 实现的登记差异：
 * - fill-rule：统一按 evenodd 分类孔洞（SVGLoader 支持 per-path fill-rule，
 *   本项目素材均为 potrace/Inkscape 导出，evenodd 语义足够，见方案 R6）；
 * - transform：支持 `<g transform="matrix(...)">` 与 rect 内联 transform
 *   （SVGLoader 亦支持；本项目共享层覆盖相同面）；
 * - 曲线：Bezier/Arc 按 `curveSegments` 采样折线化（SVGLoader 用精确曲线，
 *   预览级网格两者等价，几何级差异登记于方案 R2）。
 */
import { svgPathToContours } from '../../primitives/svg/svg-path'
import { extrudeShape } from '../../mesh/meshdata/extrude'
import type { Contour } from '../../mesh/meshdata/extrude'
import type { Shape } from '../../mesh/types'

/**
 * Options controlling an SVG extrusion.
 *
 * targetLongSide maps the longer logical side of the SVG to this length in
 * mm (the short side is scaled proportionally); naturalWidth/naturalHeight
 * are the SVG's logical dimensions used to compute the scale factor.
 */
export interface SvgExtrudeOptions {
  depth: number
  /** 长边目标长度（mm），短边按比例计算。默认 20 */
  targetLongSide?: number
  /** SVG 原始逻辑尺寸，用于计算实际缩放比例 */
  naturalWidth: number
  naturalHeight: number
}

/**
 * Parse SVG text into a list of closed Y-up contours.
 * Uses the shared SVG syntax layer (element extraction + path flattening +
 * group matrix + evenodd hole classification).
 *
 * @param svgText - the SVG source text.
 * @returns the list of closed contours found in the SVG.
 * @throws when the SVG contains no closed contour.
 */
export function parseSvgShapes(svgText: string): Contour[] {
  let contours: Contour[]
  try {
    contours = svgPathToContours(svgText, 6)
  } catch {
    // svgPathToContours 在「无 path 元素」与「无闭合轮廓」两种情形会各自抛更底层的
    // 错误（"[svg-path] No path elements found" / "[svg-path] No closed contours
    // generated"）。这里统一成编辑器面向用户的同一句，避免上层按消息文本做分档时
    // 撞上两种措辞（3d_editor 的 svg-extrude.test.ts 也按这一句断言）。
    throw new Error('No closed contour found in SVG. Please check the file content.')
  }
  if (contours.length === 0) {
    throw new Error('No closed contour found in SVG. Please check the file content.')
  }
  return contours
}

/** X/Y 居中、Z 底部对齐到 0（3D 打印放在热床上）。 */
function centerShapeXYBottom(shape: Shape): Shape {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity
  for (let i = 0; i < shape.positions.length; i += 3) {
    const x = shape.positions[i]
    const y = shape.positions[i + 1]
    const z = shape.positions[i + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
  }
  const dx = -(minX + maxX) / 2
  const dy = -(minY + maxY) / 2
  const dz = -minZ
  const positions = new Float32Array(shape.positions.length)
  for (let i = 0; i < shape.positions.length; i += 3) {
    positions[i] = shape.positions[i] + dx
    positions[i + 1] = shape.positions[i + 1] + dy
    positions[i + 2] = shape.positions[i + 2] + dz
  }
  return { ...shape, positions }
}

/**
 * Extrude a list of contours into a single Shape.
 * The scale factor is computed from naturalWidth/naturalHeight and targetLongSide.
 *
 * @param shapes - the contours to extrude.
 * @param options - the extrusion options (depth and scale inputs).
 * @returns the merged, scaled, centred Shape.
 */
export function extrudeShapes(
  shapes: Contour[],
  options: SvgExtrudeOptions,
): Shape {
  const { depth, naturalWidth, naturalHeight, targetLongSide = 20 } = options

  // 计算缩放比例：长边映射到 targetLongSide
  const longSide = Math.max(naturalWidth, naturalHeight)
  const scale = longSide > 0 ? targetLongSide / longSide : 1

  // 先挤出，再整体缩放几何体（XY 缩放，Z 不变）
  const shape = extrudeShape(shapes, depth)
  if (scale !== 1) {
    const positions = new Float32Array(shape.positions.length)
    for (let i = 0; i < shape.positions.length; i += 3) {
      positions[i] = shape.positions[i] * scale
      positions[i + 1] = shape.positions[i + 1] * scale
      positions[i + 2] = shape.positions[i + 2]
    }
    return centerShapeXYBottom({ ...shape, positions })
  }
  return centerShapeXYBottom(shape)
}

/**
 * One-stop helper: SVG text → extruded Shape.
 *
 * @param svgText - the SVG source text.
 * @param options - the extrusion options.
 * @returns the extruded Shape.
 */
export function svgToExtrudedGeometry(
  svgText: string,
  options: SvgExtrudeOptions,
): Shape {
  const shapes = parseSvgShapes(svgText)
  return extrudeShapes(shapes, options)
}
