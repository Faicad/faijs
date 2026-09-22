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
// (browser entry there: ./browser). Gear primitives stay here (browser-safe:
// gears.ts imports only `@faicad/faijs`'s initOcctWasm + types — no node
// builtins), so they belong in this entry just as much as workplane do.
// Without this line `@faicad/fai-cq-gears` (which imports `getGearKernel`
// from `@faicad/cq-compat`) has no browser resolution and every gear factory
// throws at call time.
export * from './gears'
