/**
 * @faicad/faijs/extra/browser — browser/worker entry for the extra domain.
 *
 * This entry is environment-agnostic (no `node:*` modules). It re-exports the
 * main extra entry verbatim; it exists so hosts can import the extra domain
 * the same way they import `@faicad/faijs/browser`.
 */
export * from './index'
