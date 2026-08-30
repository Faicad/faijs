import * as THREE from 'three'
import { SVGLoader, type SVGResult } from 'three/examples/jsm/loaders/SVGLoader.js'
import { mergeBufferGeometries } from '../primitives/mesh-primitives'

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
 * Parse SVG text into a list of THREE.Shape contours.
 * Uses SVGLoader to convert the SVG paths into shapes usable by ExtrudeGeometry.
 *
 * @param svgText - the SVG source text.
 * @returns the list of closed shapes found in the SVG.
 * @throws when the SVG contains no closed contour.
 */
export function parseSvgShapes(svgText: string): THREE.Shape[] {
  const loader = new SVGLoader()
  const svgData: SVGResult = loader.parse(svgText)

  const allShapes: THREE.Shape[] = []
  for (const path of svgData.paths) {
    const shapes = SVGLoader.createShapes(path)
    for (const shape of shapes) {
      allShapes.push(shape)
    }
  }

  if (allShapes.length === 0) {
    throw new Error('No closed contour found in SVG. Please check the file content.')
  }

  return allShapes
}

/**
 * Extrude a list of shapes into a single merged BufferGeometry.
 * The scale factor is computed from naturalWidth/naturalHeight and targetLongSide.
 *
 * @param shapes - the shapes to extrude.
 * @param options - the extrusion options (depth and scale inputs).
 * @returns the merged, scaled, centred BufferGeometry.
 */
export function extrudeShapes(
  shapes: THREE.Shape[],
  options: SvgExtrudeOptions,
): THREE.BufferGeometry {
  const { depth, naturalWidth, naturalHeight, targetLongSide = 20 } = options

  // 计算缩放比例：长边映射到 targetLongSide
  const longSide = Math.max(naturalWidth, naturalHeight)
  const scale = longSide > 0 ? targetLongSide / longSide : 1

  // 先挤出，再整体缩放几何体
  const geometries = shapes.map((shape) => {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
    })
    // 应用缩放
    geo.scale(scale, scale, 1)
    return geo
  })

  // 合并所有几何体为一个
  const merged = mergeBufferGeometries(geometries)
  merged.computeVertexNormals()

  // 居中处理：XY 居中，Z 底部对齐到 0（3D 打印放在热床上）
  merged.computeBoundingBox()
  if (merged.boundingBox) {
    const cx = (merged.boundingBox.max.x + merged.boundingBox.min.x) / 2
    const cy = (merged.boundingBox.max.y + merged.boundingBox.min.y) / 2
    const cz = merged.boundingBox.min.z
    merged.translate(-cx, -cy, -cz)
  }

  // 清理临时 geometry
  for (const g of geometries) {
    g.dispose()
  }

  return merged
}

/**
 * One-stop helper: SVG text → extruded BufferGeometry.
 *
 * @param svgText - the SVG source text.
 * @param options - the extrusion options.
 * @returns the extruded BufferGeometry.
 */
export function svgToExtrudedGeometry(
  svgText: string,
  options: SvgExtrudeOptions,
): THREE.BufferGeometry {
  const shapes = parseSvgShapes(svgText)
  return extrudeShapes(shapes, options)
}