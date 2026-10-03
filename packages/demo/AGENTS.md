# packages/demo — Agent Notes

- demo 是独立 vite 应用（dev 端口 8899；build 时 three/manifold-3d/occt-wasm 外链 jsdelivr CDN importmap，版本号与 package.json 手写同步）。
- demo 的定位是**发布面验证者**：它模拟最终 npm 用户，通过 workspace 链接解析到各包 `dist/`——**不读源码、不 alias 活源码**。改 faijs 源码不会即时 HMR，需先 `npm run build` 刷新 dist；CI 已在 demo e2e 前经 step 3 `npm run build` 产出全部 demo 所需 dist。
- 解析方式分层：
  - `package.json`：声明 `@faicad/faijs` / `@faicad/faijs-extra` / `@faicad/sheetmetal` 依赖（runtime 经 node_modules→workspace→dist）。
  - `tsconfig.json` paths：**显式映射到各包 `dist/` 的 `.d.ts`**——不依赖 tsc 隐式 node_modules 回退；`scripts/check-tsconfig-paths.mjs` 对 demo 无豁免、同样检查。
  - vite/vitest：不配置 `@faicad/*` 指向 src（vite 仅保留 `resolve.dedupe: ['occt-wasm']` + `optimizeDeps.exclude`）。
- demo 无 `typecheck` script（CI `--workspaces --if-present` 跳过它）；测试 `npm run test -w @faicad/faijs-demo`（vitest，node 环境，只跑 `src/**/*.test.ts`），e2e 用 Playwright（`test:e2e` / `test:e2e:preview`）。
- wasm 经 `wasmAssets()` 插件（dev 中间件 `/wasm/*` + build 拷贝）。
