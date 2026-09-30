/**
 * font-family-index — the Node host's system-font family index.
 *
 * Covers the pieces that make `text(font: 'Arial')` work on Node: reading a
 * font's `name` table without parsing the whole file, normalising names so a
 * file stem and a real family name are interchangeable, and scanning a
 * directory into a family → path map.
 *
 * Everything here is machine-independent: the only font used is the repo's own
 * bundled OpenSans, copied into a temp directory. No system font is required.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildFontFamilyIndex,
  defaultSystemFontDirs,
  normalizeFontName,
  parseNameTable,
  readFontFileNames,
} from './font-family-index'

const BUNDLED = fileURLToPath(new URL('../assets/fonts/OpenSans-Regular.ttf', import.meta.url))

describe('font-family-index', () => {
  it('normalises names so separators/case are interchangeable', () => {
    expect(normalizeFontName('Open Sans')).toBe('opensans')
    expect(normalizeFontName('open-sans')).toBe('opensans')
    expect(normalizeFontName('OpenSans-Regular')).toBe('opensansregular')
    expect(normalizeFontName('Arial')).toBe('arial')
  })

  it('reads the family/subfamily out of a real font file', () => {
    const names = readFontFileNames(readFileSync(BUNDLED))
    expect(names).not.toBeNull()
    expect(names!.family).toBe('Open Sans')
    expect(names!.subfamily).toBe('Regular')
  })

  it('rejects buffers that are not fonts instead of throwing', () => {
    expect(readFontFileNames(Buffer.alloc(0))).toBeNull()
    expect(readFontFileNames(Buffer.from('not a font at all, just ascii text padding'))).toBeNull()
    // A valid sfnt header with no name table must also come back null.
    const stub = Buffer.alloc(12 + 16)
    stub.writeUInt32BE(0x00010000, 0)
    stub.writeUInt16BE(1, 4)
    stub.write('cmap', 12, 'latin1')
    expect(readFontFileNames(stub)).toBeNull()
    expect(parseNameTable(Buffer.alloc(0), 0)).toBeNull()
  })

  it('indexes a directory by family name and by file stem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'faijs-font-idx-'))
    try {
      // Same bytes under a stem that does NOT match the family name, which is
      // exactly the real-world Windows situation (arial.ttf ⇄ "Arial",
      // times.ttf ⇄ "Times New Roman").
      copyFileSync(BUNDLED, join(dir, 'zzz-renamed.ttf'))
      const index = buildFontFamilyIndex([dir])
      expect(index.get('opensans')).toBe(join(dir, 'zzz-renamed.ttf'))
      expect(index.get('zzzrenamed')).toBe(join(dir, 'zzz-renamed.ttf'))
      expect(index.get('arial')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('walks nested font directories and skips non-font files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'faijs-font-nest-'))
    try {
      const nested = join(dir, 'sub', 'deeper')
      mkdirSync(nested, { recursive: true })
      copyFileSync(BUNDLED, join(nested, 'OpenSans-Regular.ttf'))
      writeFileSync(join(dir, 'notes.txt'), 'ignored')
      copyFileSync(BUNDLED, join(dir, 'font.woff2')) // compressed: not indexable
      const index = buildFontFamilyIndex([dir])
      expect(index.get('opensans')).toBe(join(nested, 'OpenSans-Regular.ttf'))
      expect(index.has('font')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns an empty index for directories that do not exist', () => {
    expect(buildFontFamilyIndex([join(tmpdir(), 'faijs-definitely-absent-9f3a')]).size).toBe(0)
    expect(buildFontFamilyIndex([]).size).toBe(0)
  })

  it('reports OS font directories for the running platform', () => {
    const dirs = defaultSystemFontDirs()
    expect(Array.isArray(dirs)).toBe(true)
    if (process.platform === 'win32') {
      expect(dirs.some((d) => /fonts$/i.test(d))).toBe(true)
    } else {
      expect(dirs.length).toBeGreaterThan(0)
    }
  })
})
