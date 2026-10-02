/**
 * @faicad/cq-compat/browser — browser-safe entry for the CadQuery compatibility layer.
 *
 * Unlike the package root (`./index`), this entry does NOT re-export the STEP /
 * assembly comparison helpers (`step-compare`, `assembly-compare`), which import
 * `node:fs` and cannot be bundled into a browser (Vite/Rollup would fail on the
 * builtin module). The faijs demo libLoader imports this entry statically and
 * registers it under the `@faicad/cq-compat` specifier, so `.fai.js` scripts keep
 * writing `import * as cq from '@faicad/cq-compat'`.
 */
export * from './workplane'
// Assembly layer moved out of the main package → @faicad/cq-compat-assembly
// (browser entry there: ./browser). Gear primitives migrated to
// @faicad/fai-cq-gears `src/kernel/` (2026-10-02); the only consumer was
// fai_cq_gears itself, which no longer depends on this package.
