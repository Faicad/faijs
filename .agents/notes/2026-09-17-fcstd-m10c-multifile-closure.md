# Agent Note: FCStd port M10c — multi-file container cross-file reference closure (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m10c-multifile-closure.zh.md)

## Conclusion

The "multi-Body products cannot execute end-to-end" gap left by M10 is closed. The aggregation main's cross-file references now use the runtime's existing relative-import contract (module-registry D6); no new loader or runtime mechanism was added.

## Implementation (two places, both in codegen.ts)

1. **Import-semantics aggregation entry**: main.fai.js emits `import { <Body>_out } from './<Body>.fai.js';` for every Body with geometry, then `cad.group({ members: [...] })`. The Body file's terminal alias `<Body>_out` (a plain assignment `let Body_out = <chain head>;`) has no producer in the live-shapes determination → terminal → bindable by a named import (the D6 name contract holds).
2. **Split closure (key fix)**: calls in main that consume Body-file variables must migrate into that Body file, otherwise main references undeclared identifiers (`SEC_FREE_IDENT` — the first end-to-end run caught it on test_geomop: `part13` lives in the Body file while its consumer `part14` stayed in main). Fixed with iterative closure: any main call whose inputs hit a Body-file product is migrated repeatedly until stable (chains can span multiple levels).

## Measured (test_geomop.fcstd, a real 7-Body corpus)

- Conversion → model/{main,Body,Body002..Body007}.fai.js seven-plus-one files
- `faijs-cli run model/main.fai.js --mode brep --project-root model/` → STEP export succeeds (3030 ents)
- Single-Body aggregation: importing the single terminal then `let part_out = <Body>_out;` keeps the root name stable; zero-Body falls back to single file (original path unchanged)

## GOTCHA

- CLI multi-file run needs `--project-root` (fs-project-loader uses it as the moduleKey base; e2e passes `--project-root model/` after unpacking the container).
- The plain-assignment alias line `let A = B;` is not an op call; the live-shapes "no producer → terminal" branch is exactly what makes it exportable — do not rewrite the alias line into an identity op.
- The security scanner auto-collects import binding names (`collectImportBindings`), so identifiers after import are legal; **bare cross-file references that did not go through import** are what trigger SEC_FREE_IDENT.

## Tests

- codegen.test.ts: the M10.3 dual-Body assertions updated to import semantics (+2 import-line assertions)
- fcstd 13 files / 102 cases all green; e2e three samples + the G9 real sample all green (baselines unchanged)
- Real multi-Body sample end-to-end: test_geomop 7 Bodies → STEP passes (manual verification; re-runnable commands above)
