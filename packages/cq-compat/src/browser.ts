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
export * from './assembly'
