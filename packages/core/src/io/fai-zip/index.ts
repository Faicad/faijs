/**
 * `@faicad/faijs/io/fai-zip` — the `.fai.zip` container layer.
 *
 * `.fai.zip` is faijs' own container format (docs/fai-zip-format.md). Reading,
 * writing and the manifest schema live here, in core, because every host that
 * loads or saves a faijs project needs them and none of them needs a
 * producer-specific converter to get at them.
 *
 * The layer is a peer of `@faicad/faijs/io`, not a child of it: `io` owns ZIP
 * bytes, this owns the container format built on top. `io/index.ts` therefore
 * does not re-export anything from here — a base layer never depends on a
 * format layer.
 */
export type { ContainerAssetEntries, ContainerManifest, ContainerModel } from './container'
export { decodeMemberText, encodeMemberText } from './container'
export {
  listModels,
  listModules,
  openContainer,
  readAssetEntries,
  readContainerMember,
  readDataMember,
  readManifest,
  readModule,
  type OpenContainerOptions,
  type OpenContainerResult,
} from './container-read'
export {
  createManifest,
  writeContainer,
  type ContainerAssembly,
  type WriteContainerResult,
} from './container-write'
