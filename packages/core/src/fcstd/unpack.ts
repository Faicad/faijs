/**
 * M1.1 — FCStd container unpacking.
 *
 * Validation rules per plan §5.5.6 (corrected): a file is an FCStd iff it opens
 * as a ZIP and contains `Document.xml` at its root. The ZIP comment is advisory
 * only and must never cause rejection.
 *
 * faijs contract: unit mm, errors via Result (ok/err).
 */
import { unzipSync } from 'fflate';
import { err, ok, type Result } from '../vendored/brepjs/core/result.js';

export interface FcstdMember {
  /** path inside the ZIP, e.g. "Document.xml", "PartShape.brp" */
  path: string;
  bytes: Uint8Array;
}

export interface FcstdArchive {
  members: Map<string, Uint8Array>;
  /** advisory ZIP comment; may be empty (2/56 samples have empty comments) */
  zipComment: string;
}

export type UnpackError =
  | { kind: 'not-zip'; message: string }
  | { kind: 'no-document-xml'; message: string };

/**
 * Unpack an FCStd file. Only requirement: valid ZIP + root `Document.xml`.
 */
export function unpackFcstd(data: Uint8Array): Result<FcstdArchive, UnpackError> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch (e) {
    return err({
      kind: 'not-zip',
      message: `cannot open as ZIP: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  if (!('Document.xml' in entries)) {
    return err({ kind: 'no-document-xml', message: 'root Document.xml not found in ZIP' });
  }
  // fflate does not expose the raw ZIP comment through unzipSync; read it
  // directly from the EOCD record (22 bytes from end when comment is empty,
  // else longer). Advisory only — never used for validation.
  const comment = readZipComment(data) ?? '';
  return ok({ members: new Map(Object.entries(entries)), zipComment: comment });
}

function readZipComment(data: Uint8Array): string | null {
  // scan for EOCD signature 0x06054b50 from the end
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (
      data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06
    ) {
      const len = data[i + 20]! | (data[i + 21]! << 8);
      const start = i + 22;
      if (start + len > data.length) return null;
      return new TextDecoder('latin1').decode(data.subarray(start, start + len));
    }
  }
  return null;
}

/** UTF-8 text decode helper for XML members. */
export function memberText(archive: FcstdArchive, path: string): string | undefined {
  const bytes = archive.members.get(path);
  if (!bytes) return undefined;
  return new TextDecoder('utf-8').decode(bytes);
}
