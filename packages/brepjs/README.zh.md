# @faicad/faijs-brepjs

[English](README.md) | 中文

从 brepjs 项目（<https://github.com/OpenCascade/brepjs>）剥离的独立 `@faicad/faijs-brepjs` 子包，锁定上游 commit `8685273a`（不做双向同步）。详见 `NOTICE` / `LICENSE`。

## 子路径约定

每个模块沿用原 vendored 树的 `.js` 说明符约定。包根入口与任意子模块均可导入：

```ts
import { box, fuse, fillet } from '@faicad/faijs-brepjs/topology'
import { importSTEP } from '@faicad/faijs-brepjs/io/dxfImportFns.js'
```

`"@faicad/faijs-brepjs"`（包根）原样导出 brepjs 的 `index.ts` 表面。

## 内核绑定警告

本包导出的是简原始 vendored 原语表面，**不做**内核绑定断言（`assertKernelBound`）。建模 op 的消费方应经 `@faicad/faijs/brepjs-compat` —— 那是唯一带断言的消费面。

本包对 `occt-wasm` 零直接 import；内核由宿主（`occt-kernel-bridge`）以单实例方式注入。