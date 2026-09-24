/**
 * decoration-provider — host-injectable text/SVG decoration geometry.
 *
 * The `cad.engrave` op is a platform op (plan §4.2 C) but its decoration input
 * is text or SVG, whose mesh geometry is produced by three's non-basic chain
 * (`Shape` / `ExtrudeGeometry` / `SVGLoader`). That chain now lives in
 * `@faicad/faijs-extra`, so core asks the host for the decoration geometry
 * instead of importing it — the same capability-injection shape as
 * `setFontLoader` / `setKnurlTextureLoader`.
 *
 * With no provider installed, `cad.engrave` still works on its BREP path
 * (OCCT `textToSolid` / `svgToSolid`, zero three); only the **mesh** path needs
 * a provider, and it reports a precise error instead of failing obscurely.
 */
import type * as THREE from 'three'

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
) => Promise<THREE.BufferGeometry>

let provider: EngraveDecorationProvider | null = null

/**
 * Install (or clear, with `null`) the mesh-decoration provider.
 * @param next - the provider, or null to uninstall.
 */
export function setEngraveDecorationProvider(next: EngraveDecorationProvider | null): void {
  provider = next
}

/**
 * Read the installed mesh-decoration provider.
 *
 * `cad.engrave`'s mesh path calls this; a null result means the host installed
 * no provider and the op reports the precise "install a provider" error rather
 * than failing obscurely.
 *
 * @returns the installed mesh-decoration provider, or null when none is set.
 */
export function getEngraveDecorationProvider(): EngraveDecorationProvider | null {
  return provider
}
