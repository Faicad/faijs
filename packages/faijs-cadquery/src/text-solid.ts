/**
 * text-solid — self-contained CadQuery `Workplane.text` geometry builder.
 *
 * cq-compat owns its CadQuery-compatible API: this module renders glyph
 * outlines straight onto the OCCT kernel (via core's `textBlueprints`) and
 * applies CadQuery's `halign`/`valign` + `distance` semantics itself, with NO
 * dependency on the editor-oriented `@faicad/faijs-extra` package.
 *
 * Upstream reference (cadquery 2.8.0, `occ_impl/shapes.py::Compound.makeText`
 * → `Font_BRepTextBuilder::Perform(theHAlign, theVAlign)`):
 *
 * - alignment is applied to the LAYOUT ORIGIN (the pen), NOT to the ink
 *   bounding box (measured against cadquery 2.8.0 + OpenSans-Regular.ttf):
 *   `halign`: left ⇒ pen x=0, center ⇒ pen x=-W/2, right ⇒ pen x=-W, where
 *   `W` is the string's total ADVANCE width (sum of glyph advances — a trailing
 *   space still counts: W("I ")=W("I")+advance(" "));
 *   `valign`: bottom ⇒ baseline y=0, center ⇒ baseline y=-(A-D)/2, top ⇒
 *   baseline y=-A, where `A` = hhea ascender × size/unitsPerEm and
 *   `D` = (|hhea descender| + hhea lineGap) × size/unitsPerEm (OpenSans:
 *   A=1.0688em, D=0.2930em, lineGap=0; Arial: A=0.9053em, D=0.2446em,
 *   lineGap=67/2048 — see {@link verticalMetrics}). Because the
 *   reference is the pen/baseline (not the ink box), the ink bbox lands where
 *   its side bearings / descenders put it — e.g. halign="left" on "I" yields
 *   ink xmin≈0.98 (the glyph's left side bearing), not 0;
 * - when `height != 0` the flat faces are prisme'd by `height` along the local
 *   +Z (negative ⇒ opposite); when `height == 0` the flat faces are kept as-is;
 * - `Compound.makeText` returns ONE compound holding every glyph — the glyphs
 *   are NOT fused into a single solid. `Workplane.text` then combines that
 *   compound with the context solid (`combine`: "cut" | "a" | false).
 * - each glyph face keeps its enclosed COUNTER (the hole in "0"/"Q"/"A"), i.e.
 *   the outline is a face-with-holes, not a filled disc.
 * - the face is chosen exactly as upstream does: `fontPath` (a font file) wins
 *   over `font` (a family name), and the name is resolved by the HOST the way
 *   OCC's font manager resolves it — see `options.font`/`options.fontPath`.
 *
 * This module reproduces the geometry half (font choice, aligned, per-glyph
 * parts); the combine/placement half lives in `workplane.text`.
 */

import type { BrepBoundingBox, BrepHandle } from '@faicad/faijs/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { Font } from 'opentype.js'
import { textBlueprints } from '@faicad/faijs/brep/text/text-to-solid'
import { ensureFont } from '@faicad/faijs/brep/text/fontRegistry'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { solidToShape } from '@faicad/faijs/brep/brep-ops'
import { fromBrep } from '@faicad/faijs/shape'
import type { Shape } from '@faicad/faijs/mesh/types'

/** CadQuery horizontal text alignment. */
export type HAlign = 'center' | 'left' | 'right'
/** CadQuery vertical text alignment. */
export type VAlign = 'center' | 'top' | 'bottom'

/** Options for {@link buildTextSolid}. */
export interface TextSolidOptions {
  /** Font size in model units (glyph cap height ≈ fontSize). */
  fontSize: number
  /** Extrusion distance along local +Z (negative = opposite the normal). `0` keeps flat faces. */
  distance: number
  /** Horizontal alignment of the glyph box (default `'center'`). */
  halign?: HAlign
  /** Vertical alignment of the glyph box (default `'center'`). */
  valign?: VAlign
  /**
   * Font family name, resolved by the host the way CadQuery resolves `font=`
   * (OCC `Font_FontMgr`). Node hosts look the name up among installed fonts;
   * browsers only know consumer-injected fonts. Unresolvable names fall back to
   * the engine's default face, as OCC does — it never throws.
   */
  font?: string
  /** Path to a font file; takes precedence over {@link font} (CadQuery's `fontPath`). */
  fontPath?: string
}

/**
 * CadQuery's vertical metric pair for a font, in model units.
 *
 * Measured against cadquery 2.8.0 (`text(...)` with halign/valign probes):
 *
 * - `ascent` = hhea ascender × size / unitsPerEm  (valign="top" ⇒ dy = -ascent);
 * - `descent` = (|hhea descender| + **hhea lineGap**) × size / unitsPerEm.
 *
 * The lineGap term is easy to miss because it is 0 in many fonts (OpenSans),
 * in which case the naive `-descender` formula happens to agree. It is not 0 in
 * Arial (67/2048 em), and leaving it out puts the text 0.164 units low at size
 * 10 (measured: our centre-aligned "CQ" spanned y[-4.0234, 3.8184] where
 * cadquery gives y[-3.8599, 3.9819], while X matched to 1e-9).
 *
 * @param font - the loaded font (opentype.js)
 * @param fontSize - font size in model units
 * @returns the ascent/descent pair in model units
 */
export function verticalMetrics(font: Font, fontSize: number): {
  ascent: number
  descent: number
} {
  const scale = fontSize / font.unitsPerEm
  // `font.tables` is present on every opentype.js Font, but the metric helper is
  // exported and synthesised test fonts omit it; read defensively so a font with
  // no hhea table degrades to lineGap 0 instead of throwing.
  const lineGap = (font.tables?.hhea as { lineGap?: number } | undefined)?.lineGap ?? 0
  return {
    ascent: font.ascender * scale,
    descent: (-font.descender + lineGap) * scale,
  }
}

/** True when `inner`'s bbox lies inside `outer`'s (a glyph counter nests in its body). */
function containsBox(outer: BrepBoundingBox, inner: BrepBoundingBox, eps = 1e-6): boolean {
  return (
    outer.xmin <= inner.xmin + eps &&
    outer.ymin <= inner.ymin + eps &&
    outer.xmax >= inner.xmax - eps &&
    outer.ymax >= inner.ymax - eps
  )
}

/**
 * Build the text geometry in its own local frame — the XY plane, extruded along
 * local +Z — with CadQuery's `halign`/`valign` applied to the glyph box.
 *
 * Each glyph outline becomes its own part (face when `distance === 0`, otherwise
 * a prism); the parts are grouped into ONE compound, matching upstream's
 * `Compound.makeText` (glyphs stay separate — they are not fused).
 *
 * @param txt - the string to render
 * @param options - font size, extrusion distance and alignment
 * @returns the text Shape, carrying its OCCT handle
 * @throws if no glyph outline could be built (empty string or unsupported glyphs)
 */
export async function buildTextSolid(txt: string, options: TextSolidOptions): Promise<Shape> {
  const kernel = getBrepApi() as unknown as BrepEngineApi
  const { fontSize, distance, halign = 'center', valign = 'center' } = options

  // core's fontRegistry needs an injected loader (node-host / browser-host do
  // this on host creation); ensureFont throws a clear error when it is missing,
  // and falls back to the default font for a name this host cannot resolve.
  const fontKey = options.fontPath ?? options.font
  const font = await ensureFont(fontKey)

  const wires = textBlueprints(kernel, txt, { fontSize, fontFamily: fontKey })
  if (wires.length === 0) {
    throw new Error('[cq-compat] text: no glyph outlines generated')
  }

  // `textBlueprints` returns every closed contour as its OWN wire — glyph bodies
  // and their counters alike. Upstream `Compound.makeText` keeps the counter as
  // a hole, so re-group the contours by bounding-box nesting: a contour whose
  // box nests inside an odd number of larger boxes is a hole; an even depth is a
  // glyph body (island). Each body becomes a face with its immediate holes.
  const boxes = wires.map((w) => kernel.getBoundingBox(w))
  const areas = boxes.map((b) => (b.xmax - b.xmin) * (b.ymax - b.ymin))
  const parentOf: number[] = wires.map(() => -1)
  for (let i = 0; i < wires.length; i++) {
    let best = -1
    for (let j = 0; j < wires.length; j++) {
      if (i === j || areas[j]! <= areas[i]!) continue
      if (!containsBox(boxes[j]!, boxes[i]!)) continue
      if (best === -1 || areas[j]! < areas[best]!) best = j
    }
    parentOf[i] = best
  }
  const depthOf = (i: number): number => {
    let d = 0
    for (let p = parentOf[i]!; p !== -1; p = parentOf[p]!) d++
    return d
  }

  const parts: BrepHandle[] = []
  for (let i = 0; i < wires.length; i++) {
    if (depthOf(i) % 2 !== 0) continue // a counter — consumed by its parent body
    const holes = wires.map((_, j) => j).filter((j) => parentOf[j] === i)
    try {
      let face = kernel.makeFace(wires[i]!)
      if (holes.length > 0) {
        const holed = kernel.addHolesInFace(face, holes.map((j) => wires[j]!))
        kernel.release(face)
        face = holed
      }
      if (distance === 0) {
        parts.push(face)
      } else {
        const solid = kernel.extrude(face, 0, 0, distance)
        kernel.release(face)
        parts.push(solid)
      }
    } catch {
      // A degenerate / open contour cannot form a face — skip it, mirroring
      // core `textToSolid`'s tolerance for unbuildable wires.
    }
  }
  for (const w of wires) kernel.release(w)
  if (parts.length === 0) {
    throw new Error('[cq-compat] text: no renderable glyph outlines')
  }

  // CadQuery aligns the LAYOUT ORIGIN (pen/baseline) in the local frame, not the
  // ink bbox — see the module header for the measured formula.
  const advance = font.getAdvanceWidth(txt, fontSize)
  const { ascent, descent } = verticalMetrics(font, fontSize)
  const dx = halign === 'left' ? 0 : halign === 'right' ? -advance : -advance / 2
  const dy = valign === 'bottom' ? 0 : valign === 'top' ? -ascent : -(ascent - descent) / 2

  const placed = parts.map((h) => {
    if (dx === 0 && dy === 0) return h
    const moved = kernel.translate(h, dx, dy, 0)
    kernel.release(h)
    return moved
  })

  const handle = placed.length === 1 ? placed[0]! : kernel.makeCompound(placed)
  return fromBrep(solidToShape(kernel, handle), { solid: handle })
}
