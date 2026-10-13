/**
 * engrave-decoration — the mesh decoration geometry for `cad.engrave`.
 *
 * Core's `mesh/engrave.ts` calls this directly (the old host-injection
 * port `decoration-provider.ts` was deleted when faijs-extra was absorbed
 * into core — the text/SVG geometry chain is now an internal implementation).
 */
import type { Shape } from '../../mesh/types'
import { containsCjk, loadSystemCjkFont } from '../../primitives/text/cjk-font'
import { svgToExtrudedGeometry } from '../extras/svg-extrude'
import { createTextGeometry, getOpentypeFont } from '../extras/text-geometry'
import { createMixedTextGeometry } from '../extras/text-cjk'

/** Decoration inputs `cad.engrave` passes to the provider. */
export interface EngraveDecorationParams {
  /** Text to engrave (mutually exclusive with `svg`). */
  text?: string
  /** Text size in mm. */
  textSize?: number
  /** SVG source text (mutually exclusive with `text`). */
  svg?: string
  /** SVG long-side target size in mm. */
  svgSize?: number
  /** SVG logical width, used for the scale factor. */
  svgNaturalWidth?: number
  /** SVG logical height, used for the scale factor. */
  svgNaturalHeight?: number
  /** Extrusion depth in mm. */
  depth: number
}

/**
 * Produces the decoration geometry (local space, `+Z` = extrusion direction) for
 * `cad.engrave`'s mesh path.
 */
export type EngraveDecorationProvider = (
  params: EngraveDecorationParams,
) => Promise<Shape>

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
          return createMixedTextGeometry(params.text, size, params.depth, cjkFont.font, font)
        }
      }
      return createTextGeometry(params.text, size, params.depth, font)
    }
    if (params.svg) {
      return svgToExtrudedGeometry(params.svg, {
        depth: params.depth,
        targetLongSide: params.svgSize,
        naturalWidth: params.svgNaturalWidth ?? 0,
        naturalHeight: params.svgNaturalHeight ?? 0,
      })
    }
    throw new Error('[faijs-extra] engrave decoration requires either text or svg')
  }
}
