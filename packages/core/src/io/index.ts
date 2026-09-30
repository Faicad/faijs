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
  type ZipReadOptions,
} from './zip'