# `cad.load` parameter surface converges to `{ file, unit? }`

English | [中文](2026-10-01-load-file-param.zh.md)

**Date**: 2026-10-01
**Status**: implemented

## Decision

Per 3d_editor plan `2026-10-01-unified-load-flow-and-scene-tree-design.md` (user
P8 decision), the editor `cad.load` op (in `@faicad/faijs-extra`) drops the
three-key surface `{ key | path | url, format? }` and converges to:

```js
const p = await cad.load({ file: 'vise.3mf' })   // asset file name, no path, with extension
const p = await cad.load({ file: 'box.stl', unit: 'mm' })  // unit kept for STL only (R17)
```

- **`file`** is the user-uploaded file name (basename, extension included). The
  host asset library registers assets **by file name**; `load` resolves via
  `assets.resolveByKey(file)`.
- **Format is self-detected from the `file` extension** (whitelist
  `stl/3mf/step/stp/stpz/brep` → normalized `stl/3mf/step/brep`); the host no
  longer passes `format`. `iges/igs` stay **out** of the whitelist — occt-wasm
  does not link TKDEIGES (see `CAD_FORMATS` in `brep-chain.ts`), so a clear
  "unsupported extension" error beats a kernel error.
- **3MF magic-number sanity**: a `.3mf` file whose bytes are not a zip archive
  (`PK\x03\x04`/`PK\x05\x06`) is rejected. STL (text/binary ambiguity) and
  text formats are left to their parsers (lenient external-data parsing rule).
- **Whitelist miss** → hard error (no format guessing).
- **`unit`** retained for STL only (no declared unit in the format; frozen into
  the statement line for replay scale consistency).

## Secondary changes (same PR)

- `FsAssetResolver.scanDirectory` now registers **both** keys per file: the full
  file name (for `cad.load({ file })`) and the extension-less stem (for
  `cad.import_brep({ asset })` — platform BREP asset convention where `asset`
  references `<stem>.brp`'s `<stem>`). Two namespaces, one file — not a
  runtime fallback.
- `fileBlobStore.put` accepts an explicit key (test support; asset-by-file-name
  registration).
- Updated call sites: `load-multipart.test.ts`, `threemf-extrude-chain.test.ts`,
  `case2-load-stl-cylinder-assembly.test.ts`, mixed fixtures
  `m1/m2/m5-*.fai.js` (all `key:`/`path:`+`format:` → `file:`).

## GOTCHA

Node `readFileSync(...).buffer` is a pooled-view hazard for files < 8 KiB
(`byteOffset !== 0`): tests reading small fixtures must slice
`buf.buffer, buf.byteOffset, buf.byteLength`. Fixed in the touched tests;
`load-file-param.test.ts` and `load-multipart.test.ts` carry the `toArrayBuffer`
helper.

## Verification

- `packages/core/src/api/load-file-param.test.ts` (new, 7 cases) — full-workspace
  run: **3561 passed, 4 failed before fixture updates; all green after**
  (`case2` 6/6, `mixed` 10/10, `load-multipart` 3/3, `threemf-extrude-chain` 1/1).
- lint 0 errors; typecheck green.
