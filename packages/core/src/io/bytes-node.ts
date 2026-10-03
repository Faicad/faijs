/**
 * Node-only file reader companion to `io/bytes.ts`.
 *
 * `Buffer.prototype.buffer` is the Buffer's *backing store*, not the file
 * bytes: on Node 24 pooled buffers come from a shared store larger than the
 * file and at a non-zero byteOffset. Handing that store to a kernel that
 * decodes the whole ArrayBuffer also feeds it pool residue — seen as
 * "Line 2: unexpected QUID, expecting STEP" in occt-wasm importStep.
 *
 * Node-only by design (top-level node: imports): exported from
 * `@faicad/faijs/node`, never from `io/index.ts` / the browser entries.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { toArrayBuffer } from './bytes'

/**
 * Read a file into a standalone ArrayBuffer sized exactly to the file.
 *
 * Equivalent to `toArrayBuffer(readFileSync(path))`; provided so filesystem
 * callers do not have to remember why the `.buffer` shorthand is unsafe.
 *
 * @param path - filesystem path to read, as a string or a `file:` URL.
 * @returns a new ArrayBuffer owned solely by the caller.
 */
export function readFileArrayBuffer(path: string | URL): ArrayBuffer {
  return toArrayBuffer(readFileSync(fileURLToPath(path)))
}
