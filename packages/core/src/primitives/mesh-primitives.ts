import { Mat4 } from '../math3d'
import type { Shape } from '../mesh/types'
import { boxGeometry, sphereGeometry, cylinderGeometry, coneGeometry } from '../mesh/meshdata/parametric'
import { transformShape, translateShape, mergeShapes } from '../mesh/meshdata/ops'
import type { PrimitiveType } from './types'

/** Default size in mm used when no explicit size is given. */
export const DEFAULT_SIZE = 20
/** Default angular/height segment count used by curved primitives. */
export const DEFAULT_SEGMENTS = 32

/** Rotation matrix: +90° around X — converts Y-up vertex data to Z-up. */
const ROT_Y_TO_Z = new Mat4().makeRotationX(Math.PI / 2)

/**
 * Build the base geometry for a primitive type, centred on the origin.
 *
 * Returns a Shape in Z-up coordinates. Cube/sphere/cylinder/cone
 * geometry is rotated from Y-up to Z-up; the wedge is constructed directly
 * in Z-up.
 *
 * @param type - the primitive type to build.
 * @param size - nominal size in mm (defaults to DEFAULT_SIZE).
 * @param segments - angular/height resolution for curved primitives (defaults to DEFAULT_SEGMENTS).
 * @returns the primitive Shape.
 */
export function makePrimitiveGeo(
  type: PrimitiveType,
  size?: number,
  segments?: number,
): Shape {
  const s = size ?? DEFAULT_SIZE
  const segs = segments ?? DEFAULT_SEGMENTS

  let geo: Shape
  switch (type) {
    case 'cube':
    case 'box': {
      const g = boxGeometry(s, s, s)
      geo = transformShape(g, ROT_Y_TO_Z)
      break
    }
    case 'sphere': {
      const g = sphereGeometry(s / 2, segs, segs)
      geo = transformShape(g, ROT_Y_TO_Z)
      break
    }
    case 'cylinder': {
      const g = cylinderGeometry(s / 2, s / 2, s, segs)
      geo = transformShape(g, ROT_Y_TO_Z)
      break
    }
    case 'cone': {
      const g = coneGeometry(s / 2, s, segs)
      geo = transformShape(g, ROT_Y_TO_Z)
      break
    }
    case 'wedge': {
      // 楔形体：梯形棱柱，直接在 Z-up 中构建
      // 梯形在 YZ 平面（Y=宽度方向，Z=高度方向），拉升沿 X 轴
      const width = s                     // 底边长度（沿 Y）
      const height = s / 2                // 梯形高（沿 Z，默认 10mm）
      const angleDeg = 60                 // 底边与斜边的夹角
      const angleRad = (angleDeg * Math.PI) / 180
      const halfExtrude = 25              // 拉升总长 50mm（沿 X）
      const hw = width / 2

      // 上边半宽 = 底边半宽 - 高 / tan(角度)，钳制到 >= 0
      const halfTopWidth = Math.max(0, hw - height / Math.tan(angleRad))

      const positions = new Float32Array([
        // 前端面 (X = -halfExtrude)
        -halfExtrude, -hw, 0,                  // p0: bottomLeft
        -halfExtrude,  hw, 0,                  // p1: bottomRight
        -halfExtrude,  halfTopWidth, height,    // p2: topRight
        -halfExtrude, -halfTopWidth, height,    // p3: topLeft
        // 后端面 (X = +halfExtrude)
         halfExtrude, -hw, 0,                  // p4: bottomLeft
         halfExtrude,  hw, 0,                  // p5: bottomRight
         halfExtrude,  halfTopWidth, height,    // p6: topRight
         halfExtrude, -halfTopWidth, height,    // p7: topLeft
      ])

      const indices = new Uint32Array([
        // 前端面 (outward = -X, counterclockwise from outside)
        0, 2, 1,  0, 3, 2,
        // 后端面 (outward = +X, counterclockwise from outside)
        4, 5, 6,  4, 6, 7,
        // 底面 (outward = -Z)
        0, 5, 4,  0, 1, 5,
        // 顶面 (outward = +Z)
        3, 6, 2,  3, 7, 6,
        // 左侧面 (outward = -Y)
        0, 7, 3,  0, 4, 7,
        // 右侧面 (outward = +Y)
        1, 6, 5,  1, 2, 6,
      ])

      geo = { positions, indices }
      break
    }
  }

  return geo
}

/**
 * Translate geometry to the given world coordinates.
 * The geometry should already be centred on the origin (makePrimitiveGeo /
 * makeScrew / createTextGeometry all produce centred geometry).
 *
 * @param geo - the geometry to translate.
 * @param x - the X offset in mm.
 * @param y - the Y offset in mm.
 * @returns a new translated Shape.
 */
export function applyPrimitiveOffset(
  geo: Shape,
  x: number,
  y: number,
): Shape {
  return translateShape(geo, x, y, 0)
}

/**
 * Merge multiple Shapes into a single indexed Shape.
 *
 * @param geometries - the shapes to merge.
 * @returns a new Shape containing the combined vertices and triangles.
 */
export function mergeBufferGeometries(geometries: Shape[]): Shape {
  return mergeShapes(geometries)
}
