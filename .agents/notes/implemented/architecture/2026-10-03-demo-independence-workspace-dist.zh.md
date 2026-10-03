# Agent Note: demo 独立化——workspace 内消费各包 dist

Status: implemented

[English](2026-10-03-demo-independence-workspace-dist.md) | 中文

## Problem

`packages/demo`（`@faicad/faijs-demo`，private vite 应用）原先通过 `vite.config.ts`
的 `resolve.alias`、`vitest.config.ts` 的 alias、`tsconfig.json` 的
`baseUrl`+`paths` 把 `@faicad/faijs` → `../core/src`、`@faicad/faijs-extra` →
`../faijs-extra/src` 落位到 live 源码（M7 免打包联动）。后果：

1. 编译期与各包 `src/` 强耦合，demo 构建/测试无法独立于引擎源码打包路径运行；
2. 无法以「普通依赖消费者」身份验证各包 `dist/` 的公告出口（`package.json`
   exports 映射、子路径、`dist` 完整性）——dist 上的坏出口只在装出去后才暴露；
3. dev server 依赖 HMR 联动 live 源码，与「demo 是独立应用」的定位不符。

## Decision

demo 保持 workspace 成员，但改为 **workspace 内消费各包 `dist/`**：

- `packages/demo/package.json` 在 `dependencies` 声明并安装 `@faicad/faijs` /
  `@faicad/faijs-extra` / `@faicad/sheetmetal`（`^0.28.0`），经
  `node_modules/@faicad/*` workspace 链接解析到各包 `dist/`。
- 删除全部 live-src 接线：
  - `vite.config.ts`：删 `resolve.alias` 的 `@faicad/*` 与 `server.watch` 反选块、
    `optimizeDeps.exclude` 中的 `@faicad/faijs/browser`（dist 已无 wasm glue，不再
    需要排除）；保留 `resolve.dedupe: ['occt-wasm']` + `optimizeDeps.exclude`
    `['occt-wasm','manifold-3d']`（Emscripten glue 仍需排除）。
  - `vitest.config.ts`：删 `@faicad/*` alias，仅保留 `include` + `environment`。
  - `tsconfig.json`：删 `baseUrl`/`paths`，仅剩 `noEmit`。
- 根 `package.json` 的 `build` 脚本新增 `@faicad/faijs-extra`（原只构建
  `core`/`faijs-draw`/`sheetmetal`），使 `npm run build` 产出 demo 所需全部
  `@faicad/*` dist。
- `scripts/ci.ps1` step 3 注明「demo e2e 前必须 build 出 demo 所依赖的 @faicad/*
  dist」；step 6 label 由「M7 链路」改为「@faicad/* 走 workspace dist」。

选 workspace-dist 而非「tarball 真·独立消费者」：dist 在各仓 git ignore，fresh
checkout 无 dist；为了让 demo 像真实消费者一样吃到「发布形态」的
exports/入口/子路径，把解析落到 `dist/`，CI 在 demo e2e（step 6/7）之前经 step 3
`npm run build` 统一产出。比 tarball 更轻：无需每次 `npm pack`+`npm install`。

## Alternatives considered

- **保留 M7 live-src alias 不动**：改动最小，但 demo 永远尝不到 dist 的
  exports/子路径/损坏风险，且与「demo 是独立 npm 应用」目标相悖。拒绝。
- **真·独立消费者：`npm pack` 各包 + 在 demo 装 tgz**：最真实，但每轮改引擎都要
  重新 pack+install，开发与 CI 都重，且引入 demo 与 workspace 版本漂移管理。本轮
  采用更轻的 workspace-dist；tarball 独立消费列为后续选项。
- **`optimizeDeps.exclude` 保留 `@faicad/faijs/browser`**：不需要——dist 已是编译
  产物，不含 Emscripten glue，只保留 `occt-wasm`/`manifold-3d`（真正的 glue 载体）。

## Consequences

- **demo 不再 live-src 联动**：改 `core` 等引擎源码不会即时反映到 demo dev server；
  需先 `npm run build` 刷新 `dist/`。CI 已在 step 3 产出 demo 所需全部 dist。
- demo 单测（vitest 19 例）与 `vite build` 均通过；`require.resolve` 实证
  `@faicad/faijs/io/zip` → `packages/core/dist/io/zip.js`、`@faicad/faijs/browser` →
  `dist/browser.js`（不再指向 src）。AGENTS.md（demo 段、「测试/CLI 直接消费
  src」断句、`npm run build` 命令行）已同步。
- CI e2e dev-server（step 6）：本地 `dist` 相关 19 例全过；3 例 CDN 库自动装载用例
  （gear/sheetmetal/cadquery）与 1 例「CDN 上没有的库」在本沙盒/被拦截网络下因
  `fetch('https://registry.npmjs.org/…')` 触发 `net::ERR_CERT_COMMON_NAME_INVALID`
  （TLS 拦截代理）而失败——环境性、与本次独立化无关（该流程走运行时 jsDelivr
  动态 `import`，不经过 demo 本地 alias/dist）。