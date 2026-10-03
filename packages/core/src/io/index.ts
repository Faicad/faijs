/**
 * io — unified ZIP container IO for faijs (and the host).
 *
 * Single read/write entry for ZIP bytes; every downstream consumer (3MF loader,
 * export-model writer, fcstd, demo) should use these rather than fflate
 * directly. See `io/zip.ts` for the behaviour contract.
 */
export {
  readZipEntries,
  readZipEntriesAsync,
  writeZipEntries,
  writeZipEntriesAsync,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_TOTAL_BYTES,
  type ZipReadOptions,
} from './zip'
// toArrayBuffer is browser-safe; readFileArrayBuffer is Node-only and lives in
// bytes-node.ts — exporting it here would pull node:fs into browser bundles
// (seen as a hard rollup error in the 3d_editor web build).
export { toArrayBuffer } from './bytes'
