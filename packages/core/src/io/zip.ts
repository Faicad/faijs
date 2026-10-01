/**
 * io/zip — the single ZIP read/write entry for every faijs consumer.
 *
 * This is the one place faijs (and the host) reads and writes ZIP bytes. The
 * plan unifies two previously-divergent behaviours: reading uses fflate's
 * `unzipSync`, writing uses `zipSync`. Both surface as a plain entry map so
 * no caller ever touches fflate's `Unzlib` / `Zip` objects directly.
 *
 * Contract:
 * - Entries are keyed by the archive path (fflate normalises to forward
 *   slashes). Directory entries (keys ending in `/`) are filtered out — they
 *   are produced by fflate and are not data.
 * - Every function throws on failure; there is no degraded return value.
 * - A non-zip buffer throws `new Error('zip read failed: <msg>')`.
 * - `writeZipEntries` rejects an empty entry table (never produces an empty zip).
 *
 * Environment: plain pure functions usable in node, browser, worker and the
 * weapp worker — fflate's sync + async (callback) forms cover all of them
 * (see plan D8: the async forms let the event loop yield between chunks).
 */
import { zip, zipSync, unzip, unzipSync } from 'fflate'

/** fflate's valid compression levels. */
export type ZipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Default compression level used by the sync/async writers. */
export const DEFAULT_ZIP_LEVEL: ZipLevel = 6

/** Read-side caps bounding what a single read materialises. */
export interface ZipReadOptions {
  /** Max entry count; default `DEFAULT_MAX_ENTRIES` (9999). */
  maxEntries?: number
  /** Max total uncompressed bytes; default `DEFAULT_MAX_TOTAL_BYTES` (512 MiB). */
  maxTotalBytes?: number
}

type RequiredReadOptions = Required<ZipReadOptions>

/**
 * Default cap on the number of entries a single read materialises. Deliberately
 * generous: loading a project container is not the same magnitude as a user
 * picking an arbitrary file, and container members (byte-exact source shadows,
 * baked `.brp` payloads) scale with the source document.
 *
 * NOTE these caps are *post-decompression* checks — `unzipSync` has already
 * materialised the archive when they run, so they bound what a caller keeps
 * and walks, not peak allocation. They are a resource budget, NOT a
 * zip-bomb defence. Pre-decompression rejection would need fflate's
 * `filter` (per-entry `originalSize` accounting) and is tracked separately.
 */
export const DEFAULT_MAX_ENTRIES = 9999

/** Default cap on total uncompressed bytes; same post-decompression caveat as {@link DEFAULT_MAX_ENTRIES}. */
export const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024

function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function resolveReadOptions(opts: ZipReadOptions): RequiredReadOptions {
  return {
    maxEntries: opts.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxTotalBytes: opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  }
}

/** Strip directory entries (keys ending in `/`) and enforce size/entry caps. */
function normalizeEntries(
  raw: Record<string, Uint8Array>,
  opts: RequiredReadOptions,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  let totalBytes = 0
  for (const key of Object.keys(raw)) {
    if (key.endsWith('/')) continue
    const body = raw[key]
    totalBytes += body.byteLength
    if (totalBytes > opts.maxTotalBytes) {
      throw new Error(
        `zip read failed: content exceeds limit (maxTotalBytes ${opts.maxTotalBytes})`,
      )
    }
    out.set(key, body)
  }
  if (out.size > opts.maxEntries) {
    throw new Error(`zip read failed: content exceeds limit (maxEntries ${opts.maxEntries})`)
  }
  return out
}

function wrapReadError(err: unknown): never {
  const inner = err instanceof Error ? err.message : String(err)
  const e = new Error(`zip read failed: ${inner}`)
  ;(e as Error & { cause?: unknown }).cause = err
  throw e
}

/**
 * Unzip bytes to an entry table (directory entries filtered).
 *
 * @param data - the ZIP bytes to read (Uint8Array or ArrayBuffer).
 * @param opts - optional read caps (maxEntries / maxTotalBytes).
 * @returns a map of archive path -> decompressed bytes.
 * @throws on non-ZIP bytes or when caps are exceeded.
 */
export function readZipEntries(
  data: Uint8Array | ArrayBuffer,
  opts: ZipReadOptions = {},
): Map<string, Uint8Array> {
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(toBytes(data))
  } catch (err) {
    wrapReadError(err)
  }
  return normalizeEntries(raw, resolveReadOptions(opts))
}

type EntryTable = Record<string, Uint8Array>

/** Write-side options (compression level + advisory ZIP comment). */
export interface ZipWriteOptions {
  /** Compression level; default `DEFAULT_ZIP_LEVEL` (6). */
  level?: ZipLevel
  /** Optional ZIP comment (advisory — consumers read it via the EOCD record). */
  comment?: string
}

/**
 * Zip an entry table into bytes.
 *
 * @param entries - archive path -> bytes to store.
 * @param opts - optional compression level / ZIP comment.
 * @returns the ZIP bytes.
 * @throws on an empty entry table.
 */
export function writeZipEntries(entries: EntryTable, opts?: ZipWriteOptions): Uint8Array {
  if (Object.keys(entries).length === 0) {
    throw new Error('zip write failed: empty entry table')
  }
  return zipSync(entries, { level: opts?.level ?? DEFAULT_ZIP_LEVEL, comment: opts?.comment })
}

/** Async read: yields to the event loop between chunks (see plan §D8).
 *
 * @param data - the ZIP bytes to read (Uint8Array or ArrayBuffer).
 * @param opts - optional read caps (maxEntries / maxTotalBytes).
 * @returns a promise of the entry map.
 */
export function readZipEntriesAsync(
  data: Uint8Array | ArrayBuffer,
  opts: ZipReadOptions = {},
): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(toBytes(data), (err, raw) => {
      if (err) {
        reject(new Error(`zip read failed: ${err.message}`))
        return
      }
      try {
        resolve(normalizeEntries(raw, resolveReadOptions(opts)))
      } catch (e) {
        reject(e)
      }
    })
  })
}

/** Zip an entry table into bytes, yielding between chunks.
 *
 * @param entries - archive path -> entry to store.
 * @param opts - optional compression level / ZIP comment.
 * @returns a promise of the ZIP bytes.
 */
export function writeZipEntriesAsync(
  entries: EntryTable,
  opts?: ZipWriteOptions,
): Promise<Uint8Array> {
  if (Object.keys(entries).length === 0) {
    return Promise.reject(new Error('zip write failed: empty entry table'))
  }
  return new Promise((resolve, reject) => {
    zip(entries, { level: opts?.level ?? DEFAULT_ZIP_LEVEL, comment: opts?.comment }, (err, out) => {
      if (err) {
        reject(new Error(`zip write failed: ${err.message}`))
        return
      }
      resolve(out)
    })
  })
}