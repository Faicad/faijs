/**
 * Source-side alias for the public `@faicad/faijs/brepjs-compat` subpath.
 *
 * Why this file exists: `packages/core/package.json` exports the compat face as
 * `./brepjs-compat -> ./dist/api/brepjs-compat/index.js`, while every local
 * toolchain that consumes live sources resolves `@faicad/faijs` by *prefix*
 * substitution onto `packages/core/src` (vitest `resolve.alias` in 8 configs,
 * `tsconfig.json` `paths`, the demo Vite config). A prefix alias rewrites the
 * subpath to `src/brepjs-compat`; TypeScript then falls back to node_modules
 * (hitting `dist/`) but Vite does not, so library sources such as
 * `packages/sheetmetal/src/*.ts` failed with "Cannot find module".
 *
 * Keeping the alias inside the source tree makes the src layout mirror the
 * exports map, so no per-toolchain config has to special-case this subpath.
 *
 * Projection only — the compat face keeps its single implementation in
 * `./api/brepjs-compat/index.ts`.
 */
export * from './api/brepjs-compat/index.js'
