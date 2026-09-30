/**
 * Unified `.fai.zip` write API (docs/fai-zip-format.md §10, Writer obligations).
 *
 * The input is an *assembly* — pure format concepts plus opaque
 * producer-defined members (§3). Nothing here knows about FCStd, editors or
 * filesystems.
 *
 * Environment-independent: ZIP bytes go through `io/zip.ts`, text goes through
 * the UTF-8 codec in `./container.js`. No `node:*`, no fflate, no fs.
 *
 * The point of this layer is that a container which a reader cannot
 * reconstruct is never produced: every §10 obligation that can be checked
 * statically is checked here and throws. A thrown error is always preferable
 * to a container with a dangling reference (spec §10.7, fail loudly).
 */
import { writeZipEntries } from '../zip'
import {
  assetKeyOf,
  assertDataMemberPath,
  assertModelMemberPath,
  assertSafeMemberPath,
  encodeMemberText,
  type ContainerManifest,
  type ContainerModel,
} from './container'

/** Assembly input of a container: no producer concept, only format concepts. */
export interface ContainerAssembly {
  /** `manifest.models` — the complete model list (spec §4) */
  models: ContainerModel[]
  /** `manifest.active`; must equal some `models[].id` when present */
  active?: string
  /** display-only manifest fields plus §8.2 conversion provenance */
  meta?: {
    createdAt?: string
    appVersion?: string
    label?: string
    source?: ContainerManifest['source']
    requiresBrep?: boolean
  }
  /** `model/**` members: full container path → source text. Every `models[].entry` must be present */
  modules: Record<string, string>
  /** `data/**` members: full container path → JSON text (spec §6) */
  dataMembers: Record<string, string>
  /** `files/**` payloads: fileId → bytes. Written as `files/<fileId>.bin` */
  files: Record<string, Uint8Array>
  /** `assets/**` payloads: full container path → bytes (e.g. `assets/bracket.brp`) */
  assets: Record<string, Uint8Array>
  /** producer-defined members (spec §3, e.g. `mapping.json`, `freecad/**`), written as-is */
  producerMembers?: Record<string, Uint8Array>
}

/** Result of `writeContainer`. */
export interface WriteContainerResult {
  /** the assembled container bytes */
  bytes: Uint8Array
  /** the manifest that was serialized into the container */
  manifest: ContainerManifest
}

const FILES_PREFIX = 'files/'
const ASSETS_PREFIX = 'assets/'

/**
 * Build and validate the container manifest — the single implementation of the
 * §4 schema.
 *
 * Structural only: it cannot check that `models[].entry` and `models[].data`
 * resolve to emitted members, because it never sees the members. That is
 * `writeContainer`'s job, and it is why conversion pipelines that legitimately
 * assemble a container in two passes can still reuse this function.
 *
 * @param input the model list, the optional active id and display metadata
 * @returns the manifest, with `format: 3` and `units: "mm"` fixed
 * @throws when `models` is empty, an id/entry is empty, unsafe or duplicated,
 *   an `entry` is not a module path under `model/` ending with `.fai.js`, a
 *   `data` is not a JSON path under `data/`, or `active` names no model
 */
export function createManifest(input: Pick<ContainerAssembly, 'models' | 'active' | 'meta'>): ContainerManifest {
  const { models, active, meta = {} } = input
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('[fai-zip] createManifest: models must be a non-empty array')
  }

  const seenIds = new Set<string>()
  const seenEntries = new Set<string>()
  const normalized: ContainerModel[] = []
  for (let i = 0; i < models.length; i++) {
    const m = models[i] as ContainerModel
    const id = typeof m.id === 'string' ? m.id : ''
    if (id === '') throw new Error(`[fai-zip] createManifest: models[${i}].id must be a non-empty string`)
    if (id.includes('/') || id.includes('\\')) {
      throw new Error(`[fai-zip] createManifest: models[${i}].id must not contain "/" or "\\": "${id}"`)
    }
    if (seenIds.has(id)) throw new Error(`[fai-zip] createManifest: models[].id must be unique: "${id}"`)
    seenIds.add(id)

    if (typeof m.entry !== 'string' || m.entry === '') {
      throw new Error(`[fai-zip] createManifest: models[${i}].entry must be a non-empty string`)
    }
    assertModelMemberPath(m.entry, `createManifest: models[${i}].entry`)
    if (seenEntries.has(m.entry)) {
      throw new Error(`[fai-zip] createManifest: models[].entry must be unique: "${m.entry}"`)
    }
    seenEntries.add(m.entry)

    if (m.data !== undefined) assertDataMemberPath(m.data, `createManifest: models[${i}].data`)

    normalized.push({
      id,
      entry: m.entry,
      ...(m.label !== undefined ? { label: m.label } : {}),
      ...(m.data !== undefined ? { data: m.data } : {}),
    })
  }

  if (active !== undefined && !seenIds.has(active)) {
    throw new Error(`[fai-zip] createManifest: active must equal some models[].id: "${active}"`)
  }

  return {
    format: 3,
    units: 'mm',
    models: normalized,
    ...(active !== undefined ? { active } : {}),
    ...(meta.createdAt !== undefined ? { createdAt: meta.createdAt } : {}),
    ...(meta.appVersion !== undefined ? { appVersion: meta.appVersion } : {}),
    ...(meta.label !== undefined ? { label: meta.label } : {}),
    ...(meta.source !== undefined ? { source: meta.source } : {}),
    ...(meta.requiresBrep !== undefined ? { requiresBrep: meta.requiresBrep } : {}),
  }
}

/**
 * Assemble a container from an assembly, enforcing spec §10 before writing any
 * bytes.
 *
 * Enforced (each throws, never silently produces an unreconstructable
 * container):
 * 1. `models` is non-empty, ids and entries are unique (`createManifest`);
 * 2. every `models[].entry` is emitted in `modules`;
 * 3. every `models[].data` is emitted in `dataMembers`;
 * 4. `active`, when present, equals some `models[].id` (`createManifest`);
 * 5. asset keys are unique across `files/**`, `assets/**` and any
 *    producer-defined member in those namespaces (spec §7.1) — a fileId that
 *    would not survive the base-name key rule is an error, not a silent rename;
 * 6. every `entry`/`data`/module/asset path is a safe relative member path in
 *    its namespace, and no path is emitted twice.
 *
 * @param assembly the assembly input (§3.4)
 * @returns the container bytes and the manifest that was written
 * @throws when any of the obligations above is violated
 */
export function writeContainer(assembly: ContainerAssembly): WriteContainerResult {
  const { modules, dataMembers, files, assets, producerMembers = {} } = assembly
  const manifest = createManifest(assembly)

  const members = new Map<string, Uint8Array>()
  const claimedKeys = new Map<string, string>()

  /** Record an asset key; a second member claiming it is an error (spec §7.1). */
  const claim = (key: string, path: string): void => {
    const prev = claimedKeys.get(key)
    if (prev !== undefined) {
      throw new Error(`[fai-zip] writeContainer: duplicate asset key "${key}" (members "${prev}" and "${path}")`)
    }
    claimedKeys.set(key, path)
  }

  /** Add one member; a duplicate member path is an error. */
  const put = (path: string, body: Uint8Array): void => {
    if (members.has(path)) {
      throw new Error(`[fai-zip] writeContainer: duplicate member path "${path}"`)
    }
    members.set(path, body)
  }

  // manifest.json — always first, always present (spec §10.1)
  put('manifest.json', encodeMemberText(JSON.stringify(manifest, null, 2)))

  // model/** — every declared entry must be delivered (spec §10.2, §10.3)
  for (const [path, source] of Object.entries(modules)) {
    assertModelMemberPath(path, 'writeContainer: modules key')
    put(path, encodeMemberText(source))
  }
  for (const m of manifest.models) {
    if (!members.has(m.entry)) {
      throw new Error(`[fai-zip] writeContainer: models[].entry "${m.entry}" has no module in the assembly`)
    }
  }

  // data/** — a declared data member must be delivered, and must be JSON (spec §6.1)
  for (const [path, json] of Object.entries(dataMembers)) {
    assertDataMemberPath(path, 'writeContainer: dataMembers key')
    try {
      JSON.parse(json)
    } catch (e) {
      throw new Error(`[fai-zip] writeContainer: data member "${path}" is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
    put(path, encodeMemberText(json))
  }
  for (const m of manifest.models) {
    if (m.data !== undefined && !members.has(m.data)) {
      throw new Error(`[fai-zip] writeContainer: models[].data "${m.data}" has no member in the assembly`)
    }
  }

  // files/** — keyed by fileId, stored as files/<fileId>.bin so the key
  // round-trips through the base-name rule (spec §7). A fileId containing a
  // separator would be silently re-keyed on read, so it is rejected here.
  for (const [fileId, body] of Object.entries(files)) {
    if (fileId === '' || fileId.includes('/') || fileId.includes('\\')) {
      throw new Error(`[fai-zip] writeContainer: fileId must be a non-empty base name without separators: "${fileId}"`)
    }
    const path = `${FILES_PREFIX}${fileId}.bin`
    put(path, body)
    claim(assetKeyOf(path, FILES_PREFIX), path)
  }

  // assets/** — the key is the base name, so two paths may collide (spec §7.1)
  for (const [path, body] of Object.entries(assets)) {
    assertSafeMemberPath(path, 'writeContainer: assets key')
    if (!path.startsWith(ASSETS_PREFIX)) {
      throw new Error(`[fai-zip] writeContainer: assets key must be under assets/: "${path}"`)
    }
    put(path, body)
    claim(assetKeyOf(path, ASSETS_PREFIX), path)
  }

  // producer-defined members (spec §3) — opaque payload, but they still live
  // in the archive, so a member dropped under files//assets/ takes part in the
  // key uniqueness rule whether or not the producer thought of it that way.
  for (const [path, body] of Object.entries(producerMembers)) {
    assertSafeMemberPath(path, 'writeContainer: producerMembers key')
    put(path, body)
    if (path.startsWith(FILES_PREFIX)) claim(assetKeyOf(path, FILES_PREFIX), path)
    else if (path.startsWith(ASSETS_PREFIX)) claim(assetKeyOf(path, ASSETS_PREFIX), path)
  }

  return { bytes: writeZipEntries(Object.fromEntries(members)), manifest }
}
