/**
 * font-loader — node-side font loader for cq-compat's `text` op.
 *
 * faijs-extra's `textBrep` lazily calls `ensureDefaultFont()`, which requires a
 * `FontLoader` injected via `setFontLoader()`. In the browser that loader is
 * installed by `browserFontLoader.ts`; in node we read the single-source font
 * asset shipped in core (`packages/core/src/assets/fonts/OpenSans-Regular.ttf`)
 * via fs. The path is resolved relative to this module so it works from both
 * `src` (vitest) and `dist` (built) — mirroring core's own `fontTestHelper.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setFontLoader, ensureDefaultFont, type FontLoader } from '@faicad/faijs/brep/text/fontRegistry'

const fontPath = fileURLToPath(
  new URL('../../core/src/assets/fonts/OpenSans-Regular.ttf', import.meta.url),
)

let loaderSet = false

/** Install the fs font loader (idempotent). */
export function ensureCqFontLoader(): void {
  if (loaderSet) return
  loaderSet = true
  const fsFontLoader: FontLoader = {
    async loadDefaultFont(): Promise<ArrayBuffer> {
      const buf = readFileSync(fontPath)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    },
  }
  setFontLoader(fsFontLoader)
}

/** Install the loader and eagerly load the default font. */
export async function setupCqFont(): Promise<void> {
  ensureCqFontLoader()
  await ensureDefaultFont()
}
