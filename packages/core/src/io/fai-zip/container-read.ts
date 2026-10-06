/**
 * Unified `.fai.zip` read API (docs/fai-zip-format.md §4–§9).
 *
 * Environment-independent by constraint: reading goes through `io/zip.ts`
 * (`readZipEntries`) plus JSON parsing — no `node:*`, no DOM, no fs, and no
 * direct ZIP library. Web workers, the weapp worker and node share this code.
 *
 * Contract highlights (spec §9 Reader obligations):
 * - a missing/malformed manifest, `format !== 3`, a malformed `models` array,
 *   a missing entry, a missing named data member and a duplicate asset key are
 *   all errors carrying the offending value;
 * - entry selection is `active` or `models[0]` — never a file-name heuristic;
 * - members outside the table (§3), unknown manifest fields and unknown
 *   data-member keys are ignored, never errors, never decision inputs.
 */
import { readZipEntries, type ZipReadOptions } from '../zip'
import type { ProjectLoader } from '../../cad-runtime/ports'
import {
  assetKeyOf,
  assertDataMemberPath,
  assertModelMemberPath,
  assertSafeMemberPath,
  decodeMemberText,
  type ContainerAssetEntries,
  type ContainerManifest,
  type ContainerModel,
} from './container'

/** openContainer options. */
export interface OpenContainerOptions {
  /** override `manifest.active`; default = `manifest.active`, else `models[0]` */
  modelId?: string
  /** override the `io/zip.ts` read caps (maxEntries / maxTotalBytes) */
  caps?: ZipReadOptions
}

/** openContainer result: manifest, active model, loader and payloads. */
export interface OpenContainerResult {
  manifest: ContainerManifest
  activeModel: ContainerModel
  /** project loader over the container's module graph (listModules/readSource) */
  loader: ProjectLoader
  files: Record<string, Uint8Array>
  assets: Record<string, Uint8Array>
}

/** Unzipped members, keyed by container path. */
type MemberMap = Map<string, Uint8Array>

/** Path prefix of every model script member. */
const MODEL_PREFIX = 'model/'
/** Path prefix of the imported-file payloads. */
const FILES_PREFIX = 'files/'
/** Path prefix of the script-consumed payloads. */
const ASSETS_PREFIX = 'assets/'

/**
 * Unpack the archive; a non-ZIP input is a hard error carrying the original
 * failure as `cause`. Caps violations keep `io/zip.ts`'s wording.
 */
function unzipMembers(bytes: Uint8Array, caps?: ZipReadOptions): MemberMap {
  try {
    return readZipEntries(bytes, caps)
  } catch (e) {
    const inner = (e instanceof Error ? e.message : String(e)).replace(/^zip read failed: /, '')
    const err = new Error(`[fai-zip] cannot open container as ZIP: ${inner}`)
    ;(err as Error & { cause?: unknown }).cause = e
    throw err
  }
}

/** Normalize a manifest field error into one message naming the offending value. */
function manifestError(reason: string, value?: unknown): Error {
  const shown = value === undefined ? '' : ` (observed: ${JSON.stringify(value)})`
  return new Error(`[fai-zip] invalid manifest: ${reason}${shown}`)
}

/**
 * Read and validate the container manifest from already-unpacked members.
 * @param members the unpacked container members
 * @returns the validated manifest
 */
function readManifestFrom(members: MemberMap): ContainerManifest {
  const raw = members.get('manifest.json')
  if (raw === undefined) throw new Error('[fai-zip] invalid manifest: missing manifest.json — not a .fai.zip container')
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeMemberText(raw))
  } catch (e) {
    throw new Error(`[fai-zip] invalid manifest: manifest.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw manifestError('manifest.json must be a JSON object')
  }
  const manifest = parsed as Record<string, unknown>

  if (manifest.format !== 3) {
    throw manifestError('format must be the integer 3 (this revision); no other value is interpretable', manifest.format)
  }
  if (manifest.units !== 'mm') {
    throw manifestError('units must be "mm"', manifest.units)
  }
  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    throw manifestError('models must be a non-empty array', manifest.models)
  }

  const models = manifest.models as unknown[]
  const seenIds = new Set<string>()
  const seenEntries = new Set<string>()
  const normalized: ContainerModel[] = []
  for (let i = 0; i < models.length; i++) {
    const m = models[i]
    if (typeof m !== 'object' || m === null || Array.isArray(m)) {
      throw manifestError(`models[${i}] must be an object`, m)
    }
    const rec = m as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id : ''
    if (id === '') throw manifestError(`models[${i}].id must be a non-empty string`, rec.id)
    if (id.includes('/') || id.includes('\\')) throw manifestError(`models[${i}].id must not contain "/" or "\\"`, id)
    if (seenIds.has(id)) throw manifestError('models[].id must be unique', id)
    seenIds.add(id)

    const entry = typeof rec.entry === 'string' ? rec.entry : ''
    if (entry === '') throw manifestError(`models[${i}].entry must be a non-empty string`, rec.entry)
    assertModelMemberPath(entry, `models[${i}].entry`)
    if (seenEntries.has(entry)) throw manifestError('models[].entry must be unique', entry)
    seenEntries.add(entry)
    if (!members.has(entry)) {
      throw manifestError(`models[${i}].entry does not exist in the container`, entry)
    }

    const data = typeof rec.data === 'string' ? rec.data : undefined
    if (data !== undefined) {
      assertSafeMemberPath(data, `models[${i}].data`)
      if (!members.has(data)) {
        throw manifestError(`models[${i}].data names a member that does not exist`, data)
      }
    }

    normalized.push({
      id,
      entry,
      ...(typeof rec.label === 'string' ? { label: rec.label } : {}),
      ...(data !== undefined ? { data } : {}),
    })
  }

  let active: string | undefined
  if (manifest.active !== undefined) {
    if (typeof manifest.active !== 'string' || !seenIds.has(manifest.active)) {
      throw manifestError('active must equal some models[].id', manifest.active)
    }
    active = manifest.active
  }

  return {
    format: 3,
    units: 'mm',
    models: normalized,
    ...(active !== undefined ? { active } : {}),
    ...(typeof manifest.createdAt === 'string' ? { createdAt: manifest.createdAt } : {}),
    ...(typeof manifest.appVersion === 'string' ? { appVersion: manifest.appVersion } : {}),
    ...(typeof manifest.label === 'string' ? { label: manifest.label } : {}),
    ...(typeof manifest.source === 'object' && manifest.source !== null ? { source: manifest.source as ContainerManifest['source'] } : {}),
  }
}

/**
 * Collect the payload bytes of already-unpacked members.
 * Keys are unique across `files/**` and `assets/**` together (spec §7.1);
 * a duplicate key is an error rather than a pick.
 * @param members the unpacked container members
 * @returns the payload entries keyed by asset key
 */
function readAssetEntriesFrom(members: MemberMap): ContainerAssetEntries {
  const files: Record<string, Uint8Array> = {}
  const assets: Record<string, Uint8Array> = {}
  const claimed = new Set<string>()
  for (const [path, body] of members) {
    const prefix = path.startsWith(FILES_PREFIX)
      ? FILES_PREFIX
      : path.startsWith(ASSETS_PREFIX)
        ? ASSETS_PREFIX
        : undefined
    if (prefix === undefined) continue
    const key = assetKeyOf(path, prefix)
    if (claimed.has(key)) throw new Error(`[fai-zip] duplicate asset key across files//assets/: "${key}"`)
    claimed.add(key)
    if (prefix === FILES_PREFIX) files[key] = body
    else assets[key] = body
  }
  return { files, assets }
}

/**
 * Read and validate the container manifest (spec §4).
 * @param bytes the .fai.zip archive bytes
 * @returns the validated manifest
 * @throws when the archive is not a ZIP, the manifest is missing/malformed,
 *   `format !== 3`, `units !== "mm"`, `models` is empty/malformed, ids/entries
 *   are duplicated, an entry is not under `model/` or does not exist, `active`
 *   is not in `models[].id`, or a named `data` member does not exist.
 */
export function readManifest(bytes: Uint8Array): ContainerManifest {
  return readManifestFrom(unzipMembers(bytes))
}

/**
 * List the container models (validated). Same validation as readManifest.
 * @param bytes the .fai.zip archive bytes
 * @returns the validated model list
 */
export function listModels(bytes: Uint8Array): ContainerModel[] {
  return readManifest(bytes).models
}

/**
 * List every module under `model/` (keys relative to `model/`, sorted).
 * Members outside the table are ignored (§3), never an error.
 * @param bytes the .fai.zip archive bytes
 * @returns module keys relative to `model/`, sorted
 */
export function listModules(bytes: Uint8Array): string[] {
  return listModulesFrom(unzipMembers(bytes))
}

/** Module keys (relative to `model/`, sorted) of already-unpacked members. */
function listModulesFrom(members: MemberMap): string[] {
  const keys: string[] = []
  for (const path of members.keys()) {
    if (path.startsWith(MODEL_PREFIX) && path.endsWith('.fai.js') && path.length > MODEL_PREFIX.length) {
      keys.push(path.slice(MODEL_PREFIX.length))
    }
  }
  return keys.sort()
}

/**
 * Read one module's source text by module key (relative to `model/`).
 * @param bytes the .fai.zip archive bytes
 * @param key the module key relative to `model/` (e.g. `main.fai.js`)
 * @returns the module source text
 * @throws for a key outside `model/` or that does not exist
 */
export function readModule(bytes: Uint8Array, key: string): string {
  if (typeof key !== 'string' || key === '') {
    throw new Error('[fai-zip] readModule: key must be a non-empty string')
  }
  assertSafeMemberPath(key, 'readModule key')
  if (!key.endsWith('.fai.js')) {
    throw new Error(`[fai-zip] readModule: key must name a module under model/ (ends with .fai.js): "${key}"`)
  }
  const member = unzipMembers(bytes).get(MODEL_PREFIX + key)
  if (member === undefined) {
    throw new Error(`[fai-zip] readModule: module "${key}" does not exist under model/`)
  }
  return decodeMemberText(member)
}

/**
 * Read one model data member's JSON text by member path (e.g. `data/main.json`).
 *
 * The path must be exactly what `models[].data` declares (spec §4): a safe,
 * relative member under `data/` ending with `.json`. Content is validated to
 * parse as JSON — the editor keeps data members pure JSON (§6.1), so a
 * non-JSON member is a format violation and an error, never a silent skip.
 *
 * @param bytes the .fai.zip archive bytes
 * @param memberPath the member path named by `models[].data`
 * @returns the raw JSON text
 * @throws for a non-string/unsafe path, a path outside `data/`, a missing
 *   member, or content that does not parse as JSON
 */
export function readDataMember(bytes: Uint8Array, memberPath: string): string {
  if (typeof memberPath !== 'string' || memberPath === '') {
    throw new Error('[fai-zip] readDataMember: memberPath must be a non-empty string')
  }
  assertDataMemberPath(memberPath, 'readDataMember path')
  const member = unzipMembers(bytes).get(memberPath)
  if (member === undefined) {
    throw new Error(`[fai-zip] readDataMember: member "${memberPath}" does not exist in the container`)
  }
  const text = decodeMemberText(member)
  try {
    JSON.parse(text)
  } catch (e) {
    throw new Error(`[fai-zip] readDataMember: "${memberPath}" is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  return text
}

/**
 * Read one producer-defined member (spec §3) by its container path.
 *
 * Members outside the table — `mapping.json`, `freecad/**`, `ui/**`, or any
 * other producer-defined path — are optional and opaque to the reader. Unlike
 * `readDataMember` (which is constrained to `data/` and is JSON by contract),
 * this function returns the raw bytes of any safe relative member path and
 * reports absence with `undefined` rather than an error: a missing optional
 * member is the normal shape of a conforming container (§8), never a defect.
 *
 * @param bytes the .fai.zip archive bytes
 * @param memberPath the safe relative member path to read (e.g. `ui/state.json`)
 * @returns the member bytes, or `undefined` when the member does not exist
 * @throws for an empty/unsafe path (assertSafeMemberPath)
 */
export function readContainerMember(bytes: Uint8Array, memberPath: string): Uint8Array | undefined {
  if (typeof memberPath !== 'string' || memberPath === '') {
    throw new Error('[fai-zip] readContainerMember: memberPath must be a non-empty string')
  }
  assertSafeMemberPath(memberPath, 'readContainerMember path')
  return unzipMembers(bytes).get(memberPath)
}

/**
 * Collect the payload bytes of a container.
 * Keys are unique across `files/**` and `assets/**` together (spec §7.1);
 * a duplicate key is an error rather than a pick.
 * @param bytes the .fai.zip archive bytes
 * @returns the payload entries keyed by asset key
 */
export function readAssetEntries(bytes: Uint8Array): ContainerAssetEntries {
  return readAssetEntriesFrom(unzipMembers(bytes))
}

/**
 * Host entry point: open a container and return the manifest, the active
 * model and a ProjectLoader over its module graph, plus the payloads.
 *
 * The archive is unpacked exactly once for the whole call.
 *
 * @param bytes the .fai.zip archive bytes
 * @param opts optional active-model override and `io/zip.ts` read caps
 * @returns manifest, active model, project loader and payload entries
 * @throws when the container is invalid, the requested model id is unknown, or
 *   the read caps are exceeded
 */
export function openContainer(bytes: Uint8Array, opts: OpenContainerOptions = {}): OpenContainerResult {
  const members = unzipMembers(bytes, opts.caps)
  const manifest = readManifestFrom(members)

  const activeModel: ContainerModel = (() => {
    if (opts.modelId === undefined) {
      const byActive = manifest.models.find((m) => m.id === manifest.active)
      return byActive ?? manifest.models[0]
    }
    const byParam = manifest.models.find((m) => m.id === opts.modelId)
    if (byParam === undefined) {
      throw new Error(`[fai-zip] openContainer: model "${opts.modelId}" is not in models[]`)
    }
    return byParam
  })()

  const keys = listModulesFrom(members)

  const loader: ProjectLoader = {
    listModules: () => [...keys],
    readSource: async (moduleKey) => {
      const member = members.get(MODEL_PREFIX + moduleKey)
      if (member === undefined) {
        throw new Error(`[fai-zip] loader: module "${moduleKey}" does not exist under model/`)
      }
      return decodeMemberText(member)
    },
  }

  const { files, assets } = readAssetEntriesFrom(members)
  return { manifest, activeModel, loader, files, assets }
}
