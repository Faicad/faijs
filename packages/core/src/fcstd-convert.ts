/**
 * Public conversion surface (`@faicad/faijs/fcstd-convert`).
 *
 * The `./fcstd` subpath is the dependency-light **read layer** (fflate + xmldom
 * only). This subpath is the **conversion pipeline** on top of it: it pulls the
 * planegcs constraint solver (and, through external-geometry resolution, the
 * occt kernel peer). Keep it Node-only — `planegcs-backend` resolves the solver
 * WASM from node_modules.
 *
 * Why the solver and the classifier are part of the public surface: the corpus
 * tooling (owned by the FCStd port project, not by this repository) must measure
 * solve outcomes and translation scope without re-implementing any of the
 * pipeline. One fact, one home — the tools consume these exports instead of
 * reaching into `src/`.
 *
 * GOTCHA: this entry lives at the top level (`src/fcstd-convert.ts`), not inside
 * `src/fcstd/`, because vitest and tsconfig resolve `@faicad/faijs/*` by string
 * prefix substitution to `src/*`. A barrel at `src/fcstd/convert-api.ts` would
 * make `@faicad/faijs/fcstd-convert` resolve to a non-existent path — tsc would
 * silently fall back to node_modules/dist while vitest fails outright.
 */
export { convertFcstdFile, SKETCH_T1, ALLOWED_DISPOSITIONS } from './fcstd/convert.js';
export type { ConvertSummary, ConvertOptions } from './fcstd/convert.js';
export { createPlanegcsSolver, planegcsWasmPath } from './fcstd/planegcs-backend.js';
export { classifySketch, maxPointDistance } from './fcstd/sketch-verify.js';
export type { SketchVerdict } from './fcstd/sketch-verify.js';
export { resolveExternalGeometry } from './fcstd/external-geo.js';
export type { ExternalGeoResult, ExternalLink } from './fcstd/external-geo.js';
export { isWhitelisted } from './fcstd/feature-translate.js';
