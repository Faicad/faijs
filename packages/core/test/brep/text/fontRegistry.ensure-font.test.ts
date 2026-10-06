/**
 * fontRegistry.ensureFont — name/path font resolution contract.
 *
 * CadQuery's `font=` names a font that OCC's system font manager resolves, and
 * `fontPath=` names a file. `ensureFont` is the engine-side half of that: it
 * asks the injected FontLoader to resolve the name and registers the result,
 * and — like OCC's `Font_FontMgr::FindFont` — falls back to the default font
 * instead of throwing when the host cannot resolve it.
 *
 * GOTCHA (2026-09-30): `ensureFont` must NEVER throw for an unknown name. A
 * name the host cannot resolve is a normal outcome (the font is not installed),
 * and upstream CadQuery keeps working by using its default face. Throwing here
 * would make `text('A', 1, font: 'Arial')` fail on every machine without Arial
 * — including browsers, which can never enumerate system fonts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  clearFonts,
  ensureFont,
  getFont,
  loadFont,
  setFontLoader,
  type FontLoader,
} from '../../../src/brep/text/fontRegistry'

const BUNDLED = fileURLToPath(new URL('../../../src/assets/fonts/OpenSans-Regular.ttf', import.meta.url))

function bundledBytes(): ArrayBuffer {
  const buf = readFileSync(BUNDLED)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** A loader that resolves exactly one name and reports misses as null. */
function stubLoader(): FontLoader {
  return {
    async loadDefaultFont(): Promise<ArrayBuffer> {
      return bundledBytes()
    },
    async resolveFont(name: string): Promise<ArrayBuffer | null> {
      return name === 'StubSans' ? bundledBytes() : null
    },
  }
}

describe('fontRegistry.ensureFont', () => {
  beforeEach(() => clearFonts())
  afterEach(() => {
    clearFonts()
    setFontLoader(null)
  })

  it('loads the default font when no name is given', async () => {
    setFontLoader(stubLoader())
    const font = await ensureFont()
    expect(font).toBe(getFont())
    expect(font.unitsPerEm).toBeGreaterThan(0)
  })

  it('resolves a family name through the host loader and registers it under that name', async () => {
    setFontLoader(stubLoader())
    const font = await ensureFont('StubSans')
    expect(font).toBe(getFont('StubSans')) // registered under the requested name
    // Name matching is the HOST's job: the registry does not case-fold, so a
    // differently-spelled miss is simply not a hit (and falls back, see below).
    expect(getFont('stub-sans')).toBeUndefined()
  })

  it('falls back to the default font for a name the host cannot resolve', async () => {
    setFontLoader(stubLoader())
    const font = await ensureFont('NoSuchFamily-Xyz')
    expect(font).toBe(getFont()) // the default face, no throw
  })

  it('falls back to the default font when the host has no resolveFont at all', async () => {
    setFontLoader({
      async loadDefaultFont(): Promise<ArrayBuffer> {
        return bundledBytes()
      },
    })
    const font = await ensureFont('Arial')
    expect(font).toBe(getFont())
  })

  it('returns an already-registered font without consulting the loader', async () => {
    setFontLoader({
      async loadDefaultFont(): Promise<ArrayBuffer> {
        return bundledBytes()
      },
      async resolveFont(): Promise<ArrayBuffer | null> {
        throw new Error('resolveFont must not be called for a registered name')
      },
    })
    await loadFont(bundledBytes(), 'PreRegistered')
    const font = await ensureFont('PreRegistered')
    expect(font).toBe(getFont('PreRegistered'))
  })

  it('throws only when there is no loader and no default font', async () => {
    setFontLoader(null)
    await expect(ensureFont('Arial')).rejects.toThrow(/No font loader set/)
  })
})
