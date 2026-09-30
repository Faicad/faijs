/**
 * System-font family index (Node host only).
 *
 * CadQuery resolves `font="Arial"` through OCC's `Font_FontMgr`, which consults
 * the operating system's installed fonts. faijs has no such service, so a
 * name-based `font=` cannot be honoured unless the *host* provides one. This
 * module is that provider for the Node host: it walks the OS font directories
 * and maps a normalised family name to the font file, so
 * `NodeFontProvider.resolveFont('Arial')` can return the bytes.
 *
 * Design notes
 * ------------
 * - **Only the `name` table is read.** Parsing a font with opentype.js costs
 *   milliseconds; a system font directory holds hundreds to thousands of files,
 *   so a full parse per file would add seconds to every first text call. The
 *   `name` table sits a few hundred bytes into the file, so a small `readSync`
 *   per file is enough.
 * - **`.ttc`/`.woff`/`.woff2` are skipped**: TrueType collections need a
 *   per-face offset table and the WOFF formats are compressed — neither is a
 *   plain `name` table read.
 * - Nothing here runs unless a caller explicitly asks for a font *by name*;
 *   the bundled default font stays the single source of truth for `default`.
 */

import { readdirSync, readSync, openSync, closeSync, statSync, existsSync } from 'node:fs'
import { join, extname, delimiter } from 'node:path'

/** A file we can index by reading its `name` table directly. */
const INDEXABLE_EXT = new Set(['.ttf', '.otf'])

/** sfnt version tags that start with a standard table directory. */
const SFNT_TRUE_TYPE = 0x00010000

/** Names of one font file. */
export interface FontFileNames {
  /** Typographic family (name ID 16) when present, else family (name ID 1). */
  family: string
  /** Subfamily (name ID 17 when present, else name ID 2), e.g. "Regular". */
  subfamily: string
}

/**
 * Normalise a font name for matching: lower-case, letters/digits only.
 *
 * `"DejaVu Sans"`, `"DejaVuSans"` and `"dejavu-sans"` all collapse to
 * `"dejavusans"`, which is what makes file-name based keys and real family
 * names interchangeable.
 *
 * @param name - raw font name
 * @returns the normalised comparison key
 */
export function normalizeFontName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Decode a UTF-16BE string out of `buf` (Node has no utf16be codec). */
function utf16beToString(buf: Buffer, start: number, byteLength: number): string {
  const chars: string[] = []
  for (let i = 0; i + 1 < byteLength; i += 2) {
    chars.push(String.fromCharCode(buf.readUInt16BE(start + i)))
  }
  return chars.join('')
}

/**
 * Locate the `name` table inside a font's table directory.
 *
 * @param buf - buffer holding at least the sfnt header + table directory
 * @returns the table's byte offset and length, or null for an unsupported file
 */
function findNameTable(buf: Buffer): { offset: number; length: number } | null {
  if (buf.length < 12) return null
  const sfnt = buf.readUInt32BE(0)
  const tag = buf.toString('latin1', 0, 4)
  if (sfnt !== SFNT_TRUE_TYPE && tag !== 'OTTO' && tag !== 'true' && tag !== 'typ1') return null

  const numTables = buf.readUInt16BE(4)
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (rec + 16 > buf.length) break
    if (buf.toString('latin1', rec, rec + 4) === 'name') {
      return { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) }
    }
  }
  return null
}

/**
 * Parse a `name` table that starts at `base` inside `buf`.
 *
 * Windows (platform 3) and Unicode (platform 0) records are UTF-16BE; Macintosh
 * (platform 1) records are single-byte. Windows/en records win when a name is
 * present more than once. Typographic names (16/17) win over legacy (1/2).
 *
 * @param buf - buffer containing the table
 * @param base - offset of the table inside `buf`
 * @returns the names, or null when the table is unreadable
 */
export function parseNameTable(buf: Buffer, base: number): FontFileNames | null {
  if (base + 6 > buf.length) return null
  const count = buf.readUInt16BE(base + 2)
  const storage = base + buf.readUInt16BE(base + 4)

  // nameID -> best (highest-priority) decoded value
  const best = new Map<number, { score: number; value: string }>()
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12
    if (rec + 12 > buf.length) break
    const platform = buf.readUInt16BE(rec)
    const language = buf.readUInt16BE(rec + 4)
    const nameId = buf.readUInt16BE(rec + 6)
    const len = buf.readUInt16BE(rec + 8)
    const off = buf.readUInt16BE(rec + 10)
    if (len === 0 || (nameId !== 1 && nameId !== 2 && nameId !== 16 && nameId !== 17)) continue
    const start = storage + off
    if (start + len > buf.length) continue

    let value: string | null = null
    let score = 0
    if (platform === 3 || platform === 0) {
      value = utf16beToString(buf, start, len)
      score = platform === 3 ? (language === 0x0409 ? 3 : 2) : 1
    } else if (platform === 1) {
      value = buf.toString('latin1', start, start + len)
      score = 1
    }
    if (value === null) continue
    value = value.replace(/\0/g, '').trim()
    if (!value) continue
    const prior = best.get(nameId)
    if (!prior || score > prior.score) best.set(nameId, { score, value })
  }

  const family = best.get(16)?.value ?? best.get(1)?.value
  if (!family) return null
  return {
    family,
    subfamily: best.get(17)?.value ?? best.get(2)?.value ?? '',
  }
}

/**
 * Read the family/subfamily names out of a complete font file buffer.
 *
 * @param buf - the whole font file
 * @returns the names, or null when the file has no readable `name` table
 */
export function readFontFileNames(buf: Buffer): FontFileNames | null {
  const table = findNameTable(buf)
  if (!table || table.offset + 6 > buf.length) return null
  return parseNameTable(buf, table.offset)
}

/**
 * Scan one font file and return its names (null when unreadable).
 *
 * Two-phase read: the sfnt header + table directory first, then exactly the
 * `name` table. Reading a fixed head window is not enough — in a large font
 * (`glyf`/`loca` are megabytes) the `name` table sits far past any small prefix
 * (Arial's is at ~0x0F0000), which silently made the whole system index miss.
 */
function namesOf(path: string): FontFileNames | null {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = statSync(path).size
    const head = Buffer.alloc(Math.min(size, 4096))
    readSync(fd, head, 0, head.length, 0)
    const table = findNameTable(head)
    if (!table || table.length === 0 || table.offset + table.length > size) return null
    const tbl = Buffer.alloc(table.length)
    readSync(fd, tbl, 0, table.length, table.offset)
    return parseNameTable(tbl, 0)
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Locate a font file whose `name` table names it `family`. */
export interface FontFamilyMatch {
  /** Absolute path of the best (Regular-preferred) file for the family. */
  path: string
}

/**
 * The OS font directories to scan, in search order (Windows / macOS / Linux).
 *
 * @returns the platform's standard font directories present in the environment,
 *   with unavailable ones filtered out (may be empty on a stripped-down host)
 */
export function defaultSystemFontDirs(): string[] {
  const win = process.env.WINDIR || process.env.SystemRoot
  if (process.platform === 'win32') {
    return [
      win ? join(win, 'Fonts') : '',
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts') : '',
    ].filter(Boolean)
  }
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/Library/Fonts',
      process.env.HOME ? join(process.env.HOME, 'Library', 'Fonts') : '',
    ].filter(Boolean)
  }
  // Linux / other unix: fontconfig's usual roots.
  const xdg = process.env.XDG_DATA_HOME
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    xdg ? join(xdg, 'fonts') : '',
    process.env.HOME ? join(process.env.HOME, '.fonts') : '',
    process.env.HOME ? join(process.env.HOME, '.local', 'share', 'fonts') : '',
  ].filter(Boolean)
}

/** Every indexable font file under `dir`, depth-first and depth-capped. */
function* walkFontFiles(dir: string, depth = 4): Generator<string> {
  if (depth <= 0 || !existsSync(dir)) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const p = join(dir, entry)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walkFontFiles(p, depth - 1)
    } else if (INDEXABLE_EXT.has(extname(entry).toLowerCase())) {
      yield p
    }
  }
}

/** normalized family name -> best file path found so far. */
export type FontFamilyIndex = Map<string, string>

/**
 * Build a normalised-family → file-path index for the given directories.
 *
 * When a family has several files (Regular/Bold/Italic…), the Regular one wins;
 * otherwise the first file seen is kept. Also indexes each file's *file stem*,
 * so a host pointed at a bare directory of renamed files still resolves them.
 *
 * @param dirs - font directories to scan (missing directories are skipped)
 * @returns the index (empty when nothing readable was found)
 */
export function buildFontFamilyIndex(dirs: readonly string[]): FontFamilyIndex {
  const index: FontFamilyIndex = new Map()
  for (const dir of dirs) {
    for (const file of walkFontFiles(dir)) {
      const names = namesOf(file)
      if (!names) continue
      const key = normalizeFontName(names.family)
      const isRegular = normalizeFontName(names.subfamily) === 'regular'
      if (key && (!index.has(key) || isRegular)) index.set(key, file)

      // Also allow lookup by file stem ("arial" -> arial.ttf).
      const stem = normalizeFontName(file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''))
      if (stem && !index.has(stem)) index.set(stem, file)
    }
  }
  return index
}

/**
 * PATH-style helper: split a user-supplied directory list.
 *
 * @param dirs - a path-delimiter-separated directory list (`;` on Windows, `:` elsewhere)
 * @returns the non-empty entries, in the order given
 */
export function splitDirList(dirs: string): string[] {
  return dirs.split(delimiter).filter(Boolean)
}
