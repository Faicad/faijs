/**
 * @faicad/faijs-extra/browser — browser/worker entry.
 *
 * The extension library is environment-agnostic: its dependency graph is three
 * (+ `three/examples` addons) and opentype.js, with no `node:*` module and no
 * wasm loader. This entry therefore re-exports the main entry verbatim; it
 * exists so hosts can import the extension library the same way they import
 * core's `@faicad/faijs/browser`, and so the entry-boundary guard has an
 * explicit symbol to pin.
 */
export * from './index'
