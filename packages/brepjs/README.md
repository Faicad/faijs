# @faicad/faijs-brepjs

English | [中文](README.zh.md)

Standalone `@faicad/faijs-brepjs` package extracted from the brepjs project (https://github.com/OpenCascade/brepjs), locked at upstream commit `8685273a` (no two-way sync). See `NOTICE` / `LICENSE`.

## Subpath convention

Every module keeps the `.js` specifier convention used by the original vendored tree. Both the package root and any submodule are importable:

```ts
import { box, fuse, fillet } from '@faicad/faijs-brepjs/topology'
import { importSTEP } from '@faicad/faijs-brepjs/io/dxfImportFns.js'
```

`"@faicad/faijs-brepjs"` (the root) exports the original brepjs `index.ts` surface unchanged.

## Kernel-binding warning

This package exports the raw vendored primitive surface and does **not** perform kernel-bound assertions (`assertKernelBound`). Consumers of modeling ops should go through `@faicad/faijs/brepjs-compat`, which is the only assert-guarded facade.

The package has zero runtime imports of `occt-wasm`; the kernel is injected by the host (`occt-kernel-bridge`) as a single instance.