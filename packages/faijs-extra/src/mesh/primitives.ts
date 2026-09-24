/**
 * mesh primitives — editor extension mesh-path creators.
 *
 * `text` and `svgExtrude` are the two creators whose mesh implementations carry
 * three's non-basic geometry chain (`Shape` / `ExtrudeGeometry` / `SVGLoader`).
 * They moved here from core's `mesh/primitives.ts` so the platform mesh entry no
 * longer drags that chain (nor `three/examples/**`) into every consumer.
 *
 * Both return Shape (ManifoldMeshData): THREE.BufferGeometry →
 * geoToManifoldMesh conversion. Coordinates: Z-up, millimetres.
 */
import * as THREE from 'three'
import { geoToManifoldMesh } from '@faicad/faijs/boolean/csg-backend'
import type { Shape, TextParams, SvgExtrudeParams } from '@faicad/faijs/mesh/types'
import { svgToExtrudedGeometry } from '../extras/svg-extrude'
import { createTextGeometry, getOpentypeFont } from '../extras/text-geometry'
import { createMixedTextGeometry } from '../extras/text-cjk'
import { containsCjk, loadSystemCjkFont } from '@faicad/faijs/primitives/text/cjk-font'

/** THREE.BufferGeometry → Shape (ManifoldMeshData) */
function geoToShape(geo: THREE.BufferGeometry): Shape {
  return geoToManifoldMesh(geo)
}

/**
 * Create text geometry. Font loading is asynchronous, so this function is
 * async; CJK text is rendered with the system font when one is available.
 *
 * @param params - text parameters (text, size, depth).
 * @returns the text shape.
 */
export async function text(params: TextParams): Promise<Shape> {
  const font = await getOpentypeFont()
  let geo: THREE.BufferGeometry
  if (containsCjk(params.text)) {
    const cjkFont = await loadSystemCjkFont()
    if (cjkFont) {
      geo = await createMixedTextGeometry(params.text, params.size, params.depth, cjkFont.font, font)
    } else {
      // No CJK font available: replace CJK chars with '?' so geometry still
      // can be created (graceful degradation). Without this, createTextGeometry
      // would throw because CJK glyphs are .notdef in OpenSans Regular.
      const fallback = params.text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u2F800-\u2FA1F\u3000-\u303F\uFF00-\uFFEF]/g, '?')
      geo = await createTextGeometry(fallback, params.size, params.depth, font)
    }
  } else {
    geo = await createTextGeometry(params.text, params.size, params.depth, font)
  }
  return geoToShape(geo)
}

/**
 * Create an extruded geometry from an SVG source.
 *
 * @param params - SVG extrude parameters (svg, depth, target size, optional natural size).
 * @returns the extruded shape.
 */
export function svgExtrude(params: SvgExtrudeParams): Shape {
  const geo = svgToExtrudedGeometry(params.svg, {
    depth: params.depth,
    targetLongSide: params.targetLongSide ?? 20,
    naturalWidth: params.naturalWidth ?? 0,
    naturalHeight: params.naturalHeight ?? 0,
  })
  return geoToShape(geo)
}
