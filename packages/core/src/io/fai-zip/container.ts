/**
 * `.fai.zip` container schemas (docs/fai-zip-format.md §4, §7).
 *
 * `.fai.zip` is faijs' own container format, so this module carries the format
 * itself and nothing producer-specific: `source` is a §4 manifest field
 * (described in §8.2 as conversion provenance), not an FCStd leak. Producer
 * members such as `mapping.json` and `freecad/**` are passed through opaquely
 * (spec §3, "Optional, producer-defined"). `requiresBrep` was removed in
 * 2026-10-03 (fai-zip-third-party-sdk-and-viewer-plan): BREP is always the
 * default-required execution chain, so no per-container flag exists.
 *
 * Environment-independent by construction: no `node:*`, no DOM, no fflate.
 * Text members go through the UTF-8 codec below, ZIP bytes go through
 * `io/zip.ts` — the container layer never touches a ZIP library directly.
 */

/** One model in the container: entry script, plus an optional data member. */
export interface ContainerModel {
  /** model identifier: unique in the container, stable (switch/data key), no `/` or `\` */
  id: string
  /** container path of the model's entry script, inside `model/`, ends with `.fai.js` */
  entry: string
  /** display name; a reader MUST NOT use it as an identifier (spec §4) */
  label?: string
  /** container path of the model's data member; absent = no data member (spec §6.5) */
  data?: string
}

/** `manifest.json` schema (unified `.fai.zip` format v3, spec §4). */
export interface ContainerManifest {
  /** container format identifier — MUST be 3 in this revision (spec §11) */
  format: 3
  /** unit of every coordinate in the container; always "mm" */
  units: 'mm'
  /** the complete model list (length ≥ 1) */
  models: ContainerModel[]
  /** id of the initially active model; absent = `models[0]` */
  active?: string
  /** ISO 8601 timestamp. Display only */
  createdAt?: string
  /** version of the producing tool. Display only */
  appVersion?: string
  /** container display name. Display only */
  label?: string
  /** conversion provenance (spec §8.2). Display only */
  source?: {
    /** original source document file name (not a full path) */
    file: string
    programVersion: string
    schemaVersion: number
  }
}

/**
 * Asset payloads of a container: bytes keyed by asset key (spec §7).
 * The key of a member is its base name with the final extension removed.
 */
export interface ContainerAssetEntries {
  /** `files/**` members — key = fileId (member path under `files/` with the final extension removed) */
  files: Record<string, Uint8Array>
  /** `assets/**` members — key = base name with the final extension removed */
  assets: Record<string, Uint8Array>
}

/**
 * Asset key of a member path: base name with the final extension removed
 * (spec §7). `assets/bracket.brp` → `bracket`; `files/deep/9f1c2a.bin` →
 * `9f1c2a`. The rule is by base name, so nesting does not change the key.
 *
 * @param path the container member path (including its namespace prefix)
 * @param prefix the namespace prefix the path was matched against
 * @returns the asset key
 */
export function assetKeyOf(path: string, prefix: string): string {
  const rel = path.slice(prefix.length)
  const slash = rel.lastIndexOf('/')
  const base = slash >= 0 ? rel.slice(slash + 1) : rel
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

const UTF8_DECODER = new TextDecoder('utf-8')

/**
 * Decode a text member. UTF-8, matching the spec's "UTF-8 JSON object" wording.
 * @param bytes the member bytes
 * @returns the decoded text
 */
export function decodeMemberText(bytes: Uint8Array): string {
  return UTF8_DECODER.decode(bytes)
}

/**
 * Encode a text member to UTF-8 bytes.
 * @param text the member text
 * @returns the encoded bytes
 */
export function encodeMemberText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

const MODEL_PREFIX = 'model/'
const DATA_PREFIX = 'data/'

/**
 * Validate a member path against the spec §2 naming rules: relative, forward
 * slashes only, no `..`, no drive letter, no leading `/`.
 * @param path the member path to check
 * @param what description of the field being checked, used in the error
 * @throws when the path is not a safe relative member path
 */
export function assertSafeMemberPath(path: string, what: string): void {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('..') || /^[A-Za-z]:/.test(path)) {
    throw new Error(`[fai-zip] unsafe member path in ${what}: "${path}"`)
  }
}

/**
 * Validate that a path is a model entry/script member: under `model/` and
 * ending with `.fai.js` (spec §5.1).
 * @param path the member path to check
 * @param what description of the field being checked, used in the error
 * @throws when the path is not a model member path
 */
export function assertModelMemberPath(path: string, what: string): void {
  assertSafeMemberPath(path, what)
  if (!path.startsWith(MODEL_PREFIX) || !path.endsWith('.fai.js')) {
    throw new Error(`[fai-zip] ${what} must be under model/ and end with .fai.js: "${path}"`)
  }
}

/**
 * Validate that a path is a data member path: under `data/` and ending with
 * `.json` (spec §6.1).
 * @param path the member path to check
 * @param what description of the field being checked, used in the error
 * @throws when the path is not a data member path
 */
export function assertDataMemberPath(path: string, what: string): void {
  assertSafeMemberPath(path, what)
  if (!path.startsWith(DATA_PREFIX) || !path.endsWith('.json')) {
    throw new Error(`[fai-zip] ${what} must be under data/ and end with .json: "${path}"`)
  }
}
