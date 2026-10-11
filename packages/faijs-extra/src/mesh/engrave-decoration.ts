/**
 * engrave-decoration — the mesh decoration geometry `cad.engrave` asks the host for.
 *
 * Core's `mesh/engrave.ts` no longer imports the text/SVG geometry chain; it calls
 * the provider installed here (see core `mesh/decoration-provider.ts`).
 */
import type { EngraveDecorationProvider } from '@faicad/faijs/mesh/decoration-provider'
import { geoToManifoldMesh } from '@faicad/faijs/boolean/csg-backend'
import type { Shape } from '@faicad/faijs/mesh/types'
import { containsCjk, loadSystemCjkFont } from '@faicad/faijs/primitives/text/cjk-font'
import { svgToExtrudedGeometry } from '../extras/svg-extrude'
import { createTextGeometry, getOpentypeFont } from '../extras/text-geometry'
import { createMixedTextGeometry } from '../extras/text-cjk'

type BufferGeometryLike = {
  attributes: Record<string, { array?: ArrayLike<number> }>
  index: { array: ArrayLike<number> } | null
}

function geoToShape(geo: BufferGeometryLike): Shape {
  const positions = geo.attributes.position.array!
  let indices: ArrayLike<number>
  if (geo.index) {
    indices = geo.index.array
  } else {
    const vertexCount = positions.length / 3
    const seq = new Uint32Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) seq[i] = i
    indices = seq
  }
  return geoToManifoldMesh({ positions, indices })
}

/**
 * Build the text/SVG decoration provider for `cad.engrave`'s mesh path.
 *
 * Semantics match the pre-split implementation inside core: the CJK branch uses
 * the system CJK font when the Local Font Access API yields one, otherwise the
 * registered default font (whose missing glyphs then raise the documented
 * `[text-geometry] Character … not found in font` error).
 *
 * @returns the provider, ready to hand to `setEngraveDecorationProvider()`.
 */
export function createEngraveDecorationProvider(): EngraveDecorationProvider {
  return async (params): Promise<Shape> => {
    if (params.text) {
      const size = params.textSize ?? 10
      const font = await getOpentypeFont()
      if (containsCjk(params.text)) {
        const cjkFont = await loadSystemCjkFont()
        if (cjkFont) {
          return geoToShape(await createMixedTextGeometry(params.text, size, params.depth, cjkFont.font, font))
        }
      }
      return geoToShape(await createTextGeometry(params.text, size, params.depth, font))
    }
    if (params.svg) {
      return geoToShape(svgToExtrudedGeometry(params.svg, {
        depth: params.depth,
        targetLongSide: params.svgSize,
        naturalWidth: params.svgNaturalWidth ?? 0,
        naturalHeight: params.svgNaturalHeight ?? 0,
      }))
    }
    throw new Error('[faijs-extra] engrave decoration requires either text or svg')
  }
}
