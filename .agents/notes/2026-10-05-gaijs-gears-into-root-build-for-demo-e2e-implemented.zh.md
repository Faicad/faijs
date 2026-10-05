# Agent Note：将 @faicad/faijs-gears 纳入根 `npm run build` 构建链

Status: implemented

[English](2026-10-05-gaijs-gears-into-root-build-for-demo-e2e-implemented.md) | 中文

## Problem

GitHub Actions 的 CI（以及本地 `scripts/ci.ps1` 流水线）在 demo e2e 测试前执行
`npm run build`，但根 `build` 脚本只编译 `@faicad/faijs`、`@faicad/faijs-draw`、
`@faicad/faijs-sketch`、`@faicad/faijs-extra`、`@faicad/faijs-viewer`、
`@faicad/sheetmetal`，**没有**构建 `@faicad/faijs-gears`。

demo 页面（`packages/demo/main.ts:132`）懒加载 `@faicad/faijs-gears`
（`LOCAL_LIBS["@faicad/faijs-gears"] = () => import("@faicad/faijs-gears")`）。
在干净的 CI checkout 上，`packages/faijs-gears/dist/` 不存在（dist 被 gitignore，
只能由 build 阶段产出），于是 vite 的 import-analysis 报：

```
Failed to resolve entry for package "@faicad/faijs-gears" ...
File: packages/demo/main.ts:132:38
```

由于这是非致命的 pre-transform 错误，vite dev 继续运行，`gear-demo` 的
Playwright 测试却会一直阻塞在这个坏掉的懒加载上——整个 `Demo e2e (dev server)`
步骤在 CI 上悬挂了约 44 分钟而不是快速失败。本地同一套件约 1.6 分钟通过，
只是因为 `packages/faijs-gears/dist` 已由之前的构建提前存在。

## Decision

把 `@faicad/faijs-gears` 加入 workspace 构建链：

- 根 `package.json` 的 `scripts.build` 现在在 `@faicad/sheetmetal` 之后追加
  `npm run build -w @faicad/faijs-gears`。
- 两条流水线都驱动同一个 `npm run build`，故无需改各 job 的命令；
  `.github/workflows/ci.yml` 与 `scripts/ci.ps1` 只同步步骤标签/注释以保持
  step-aligned。`faijs-gears` 构建很轻（tsc + import 扩展修复），且它只依赖
  `@faicad/faijs`（链上前序已构建），追加安全。
- 刻意**不**加入 `@faicad/faijs-fasteners`：demo 未将其声明为依赖，单独加入
  只会平添无用构建工作，对修复无益。

## 备选方案

- **在 CI/ci.ps1 里加独立的 `npm run build -w @faicad/faijs-gears` 步骤。**
  否决：会令两条流水线各自需要额外 job、破坏 `.github/workflows/ci.yml` 与
  `scripts/ci.ps1` 的 step-alignment 不变量；统一驱动根 `build` 脚本只需一次
  编辑即可让两条流水线都正确。
- **同时构建 `@faicad/faijs-fasteners`。** 否决：fasteners 不是 `demo` 的依赖，
  demo e2e 不消费它；加入只会增加无用的构建面、扩大 CI 范围，却修复不了挂死。
- **让 demo e2e 跳过 `gear-demo` 用例或伪造该懒导入。** 否决：掩盖解析失败会
  隐藏真正的打包缺口（干净 checkout 无法提供 demo 自己声明的依赖），而不是修复它。

## Consequences

- 干净的 CI checkout 现在会产出 `packages/faijs-gears/dist`，demo 的懒导入得以
  解析，`Demo e2e (dev server)` 步骤会正常完成而不是在 `@faicad/faijs-gears`
  的入口解析上挂死。
- `package-lock.json` **未改动**（HEAD 已携带 rollup 族还原与 `0.29.5` 版本线）；
  未升级任何版本号。
- 已本地验证：`npm run build`（含 gears 的全链）exit 0 并产出
  `packages/faijs-gears/dist/index.js`；完整 demo e2e（`npm run test:e2e`）
  约 1.6 分钟通过 23 个用例。