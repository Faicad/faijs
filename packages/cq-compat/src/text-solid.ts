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
 *   baseline y=-A, where `A`/`D` are the font's hhea ascender/descender scaled
 *   by `fontSize/unitsPerEm` (OpenSans: A=1.0688em, D=0.2930em). Because the
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
 *
 * This module reproduces the geometry half (aligned, per-glyph parts); the
 * combine/placement half lives in `workplane.text`.
 */

import type { BrepBoundingBox, BrepHandle } from '@faicad/faijs/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import { textBlueprints } from '@faicad/faijs/brep/text/text-to-solid'
import { ensureDefaultFont, getFont } from '@faicad/faijs/brep/text/fontRegistry'
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
  // this on host creation); ensure throws a clear error when it is missing.
  await ensureDefaultFont()

  const wires = textBlueprints(kernel, txt, { fontSize })
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
  const font = getFont()
  if (!font) {
    throw new Error('[cq-compat] text: no font loaded')
  }
  const advance = font.getAdvanceWidth(txt, fontSize)
  const ascent = (font.ascender * fontSize) / font.unitsPerEm
  const descent = (-font.descender * fontSize) / font.unitsPerEm
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
