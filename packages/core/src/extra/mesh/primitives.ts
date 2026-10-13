/**
 * mesh primitives — editor extension mesh-path creators.
 *
 * `text` and `svgExtrude` are the two creators whose mesh implementations
 * used to carry three's non-basic geometry chain (`Shape` / `ExtrudeGeometry` /
 * `SVGLoader`). They moved here from core's `mesh/primitives.ts` so the
 * platform mesh entry no longer drags that chain (nor `three/examples/**`)
 * into every consumer.
 *
 * Both return core `Shape` directly: text/SVG → Contour[] → `extrudeShape`
 * (three-free). Coordinates: Z-up, millimetres.
 */
import type { Shape, TextParams, SvgExtrudeParams } from '../../mesh/types'
import { svgToExtrudedGeometry } from '../extras/svg-extrude'
import { createTextGeometry, getOpentypeFont } from '../extras/text-geometry'
import { createMixedTextGeometry } from '../extras/text-cjk'
import { containsCjk, loadSystemCjkFont } from '../../primitives/text/cjk-font'

/**
 * Create text geometry. Font loading is asynchronous, so this function is
 * async; CJK text is rendered with the system font when one is available.
 *
 * @param params - text parameters (text, size, depth).
 * @returns the text shape.
 */
export async function text(params: TextParams): Promise<Shape> {
  const font = await getOpentypeFont()
  if (containsCjk(params.text)) {
    const cjkFont = await loadSystemCjkFont()
    if (cjkFont) {
      return createMixedTextGeometry(params.text, params.size, params.depth, cjkFont.font, font)
    }
    // No CJK font available: replace CJK chars with '?' so geometry still
    // can be created (graceful degradation). Without this, createTextGeometry
    // would throw because CJK glyphs are .notdef in OpenSans Regular.
    const fallback = params.text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u2F800-\u2FA1F\u3000-\u303F\uFF00-\uFFEF]/g, '?')
    return createTextGeometry(fallback, params.size, params.depth, font)
  }
  return createTextGeometry(params.text, params.size, params.depth, font)
}

/**
 * Create an extruded geometry from an SVG source.
 *
 * @param params - SVG extrude parameters (svg, depth, target size, optional natural size).
 * @returns the extruded shape.
 */
export function svgExtrude(params: SvgExtrudeParams): Shape {
  return svgToExtrudedGeometry(params.svg, {
    depth: params.depth,
    targetLongSide: params.targetLongSide ?? 20,
    naturalWidth: params.naturalWidth ?? 0,
    naturalHeight: params.naturalHeight ?? 0,
  })
}
