/**
 * io/bytes — normalise a BufferSource into an exactly-owned ArrayBuffer.
 *
 * faijs hands geometry kernels plain `ArrayBuffer`s (see the `assets.resolveFile`
 * contract in `cad-runtime/ports`). That contract has no notion of a view
 * offset, so a *pooled* or *offset* backing store must never cross it: a
 * consumer that decodes the whole ArrayBuffer would also read whatever else
 * shares that store.
 *
 * This is the single place that conversion is spelled out, because the failure
 * it prevents is invisible: the kernel does not report a short read, it reports
 * a corrupt-parse error far away from the call that caused it.
 *
 * Contract:
 * - Always returns a fresh ArrayBuffer whose `byteLength` equals the source's
 *   `byteLength`; never aliases the input.
 * - Accepts any BufferSource (ArrayBuffer or any ArrayBufferView), so a caller
 *   holding a `Buffer`/subarray does not have to slice it by hand.
 * - Zero-copy is deliberately not attempted: the sources are whole-file reads,
 *   where one copy is cheaper than reasoning about who else owns the store.
 *
 * Browser-safe: this module must stay free of node: imports — it is
 * re-exported from `io/index.ts`, which is imported by browser bundles. The
 * Node-only file reader lives in `io/bytes-node.ts` (`@faicad/faijs/node`).
 */

/**
 * Copy a BufferSource into a standalone ArrayBuffer sized exactly to its bytes.
 *
 * @param source - the bytes to normalise (ArrayBuffer or any ArrayBufferView).
 * @returns a new ArrayBuffer owned solely by the caller.
 */
export function toArrayBuffer(source: BufferSource): ArrayBuffer {
  if (source instanceof ArrayBuffer) {
    // Already standalone in size, but callers may still hold another view onto
    // it; copy so the result can never be mutated through another reference.
    return source.slice(0)
  }
  const view = new Uint8Array(
    (source as ArrayBufferView).buffer as ArrayBuffer,
    (source as ArrayBufferView).byteOffset,
    (source as ArrayBufferView).byteLength,
  )
  return view.slice().buffer as ArrayBuffer
}
