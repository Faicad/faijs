/**
 * NodeFontProvider.resolveFont — resolving a font *family name* or a *file path*.
 *
 * This is the Node host's half of the `text(font: 'Arial')` contract: CadQuery
 * passes a font family name to OCC's `Font_FontMgr::FindFont`, so a host that
 * only knows a fixed default face cannot reproduce that text. `resolveFont`
 * closes the gap — but it must stay hermetic-friendly (no system font required)
 * and must **never throw** on a miss (the caller falls back to the default face,
 * exactly like OCC).
 *
 * Everything here is machine-independent: the only font used is the repo's own
 * bundled OpenSans. For the system-family-index branch the bundled file is
 * copied with its `name` table rewritten (`Open Sans` → `Zeta Sans`, same byte
 * length in both the UTF-16BE and latin1 encodings) so a *distinct* family name
 * resolves to a temp directory — no OS font is consulted.
 *
 * GOTCHA: `expect(a).toEqual(b)` does NOT compare two `ArrayBuffer`s' bytes —
 * distinct instances compare equal, so a byte assertion must go through
 * `Buffer.from(x).equals(...)` (see `sameBytes`).
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeFontProvider } from '../../src/node-host/node-font-provider'
import { readFontFileNames } from '../../src/node-host/font-family-index'

const BUNDLED = fileURLToPath(new URL('../../src/assets/fonts/OpenSans-Regular.ttf', import.meta.url))

/** Byte-wise equality — `toEqual` does not compare ArrayBuffer contents. */
function sameBytes(a: ArrayBuffer | null, b: ArrayBuffer | null): boolean {
  return a !== null && b !== null && Buffer.from(a).equals(Buffer.from(b))
}

/** Overwrite every byte occurrence of `from` with `to` (both must be equal length). */
function replaceAllBytes(buf: Buffer, from: Buffer, to: Buffer): void {
  for (let i = 0; i <= buf.length - from.length; i++) {
    if (buf.subarray(i, i + from.length).equals(from)) to.copy(buf, i)
  }
}

/** Copy the bundled font into `dir`, renaming the family `Open Sans` → `Zeta Sans`. */
function patchedFamilyFont(dir: string): string {
  const out = Buffer.from(readFileSync(BUNDLED))
  // Both spellings are 9 characters, so a byte-for-byte overwrite keeps every
  // table offset valid (no length change, nothing to re-index).
  replaceAllBytes(out, Buffer.from('Open Sans', 'utf16le').swap16(), Buffer.from('Zeta Sans', 'utf16le').swap16())
  replaceAllBytes(out, Buffer.from('Open Sans', 'latin1'), Buffer.from('Zeta Sans', 'latin1'))
  const path = join(dir, 'ZetaSans-Regular.ttf')
  writeFileSync(path, out)
  return path
}

describe('NodeFontProvider.resolveFont', () => {
  it('resolves the bundled default by its registered keys', async () => {
    const p = new NodeFontProvider()
    const expected = await p.loadDefaultFont()
    for (const key of ['default', 'OpenSans', 'OpenSans-Regular']) {
      expect(sameBytes(await p.resolveFont(key), expected)).toBe(true)
    }
  })

  it('resolves an absolute font-file path, and it matches the default bytes', async () => {
    const p = new NodeFontProvider({ systemFonts: false })
    expect(sameBytes(await p.resolveFont(BUNDLED), await p.loadDefaultFont())).toBe(true)
  })

  it('does not treat a non-font path as a font file', async () => {
    // A real file with a non-font extension must fall through to a miss, not be
    // read as a font (resolveFont only accepts FONT_EXTENSIONS paths).
    const dir = mkdtempSync(join(tmpdir(), 'faijs-font-prov-'))
    try {
      const txt = join(dir, 'not-a-font.txt')
      writeFileSync(txt, 'hello')
      expect(await new NodeFontProvider({ systemFonts: false }).resolveFont(txt)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the system font index for a family name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'faijs-font-prov-'))
    try {
      patchedFamilyFont(dir)
      const p = new NodeFontProvider({ defaultFontPath: BUNDLED, systemFontDirs: [dir] })
      // 'Zeta Sans' is neither a registered key nor the default's family, so this
      // can only be satisfied by walking the OS-style family index.
      const byFamily = await p.resolveFont('Zeta Sans')
      expect(byFamily).not.toBeNull()
      // The resolved bytes really are the patched file, not the default face.
      expect(readFontFileNames(Buffer.from(byFamily!))?.family).toBe('Zeta Sans')
      expect(sameBytes(await p.resolveFont('ZETA  sans'), byFamily)).toBe(true) // normalisation
      // ...and by the file stem, the way Windows ships arial.ttf ⇄ "Arial".
      expect(sameBytes(await p.resolveFont('ZetaSans-Regular'), byFamily)).toBe(true)
      // Backed by a real font file, not a copy of the default.
      expect(sameBytes(byFamily, await p.loadDefaultFont())).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('systemFonts:false keeps the host hermetic (name lookups miss)', async () => {
    // With the system scan disabled there is no index to consult, so a family
    // name that is not a registered key misses outright.
    const p = new NodeFontProvider({ systemFonts: false })
    expect(await p.resolveFont('Zeta Sans')).toBeNull()
    // Registered keys still resolve.
    expect(await p.resolveFont('OpenSans')).not.toBeNull()
  })

  it('returns null (never throws) for an unknown name', async () => {
    const p = new NodeFontProvider({ systemFonts: false })
    expect(await p.resolveFont('Definitely Not Installed 9f3a')).toBeNull()
  })

  it('loadFont still throws for an unknown key (explicit lookup, unlike resolveFont)', async () => {
    const p = new NodeFontProvider({ systemFonts: false })
    await expect(p.loadFont('nope')).rejects.toThrow(/not found/)
  })
})
