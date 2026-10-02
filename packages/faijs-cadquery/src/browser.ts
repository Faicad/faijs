/**
 * @faicad/faijs-cadquery/browser — browser-safe entry for the CadQuery compatibility layer.
 *
 * Unlike the package root (`./index`), this entry does NOT re-export the STEP /
 * assembly comparison helpers (`step-compare`, `assembly-compare`), which import
 * `node:fs` and cannot be bundled into a browser (Vite/Rollup would fail on the
 * builtin module). The faijs demo libLoader imports this entry statically and
 * registers it under the `@faicad/faijs-cadquery` specifier, so `.fai.js` scripts keep
 * writing `import * as cq from '@faicad/faijs-cadquery'`.
 */
export * from './workplane'
// Assembly layer (merged 2026-10-02, ex standalone cq-compat-assembly package)
// now lives in src/assembly/ — browser entry: `./assembly/browser`. Gear
// primitives migrated to @faicad/faijs-gears `src/kernel/` (2026-10-02); the
// only consumer was faijs-gears itself, which no longer depends on this package.
