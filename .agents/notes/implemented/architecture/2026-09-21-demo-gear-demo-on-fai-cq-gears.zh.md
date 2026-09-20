# Agent Note — demo `gear-demo` 改用真齿轮库 fai_cq_gears

日期：2026-09-21
状态：implemented
领域：架构 / compat 边界 / demo

## 背景

`packages/gear-lib-demo` 已于 2026-09-21 删除（fixture 迁入
`packages/tests/faijs/compat-e2e/_support/`），demo 的 `gear-demo` 示例随即指向
一个不存在的包。用户要求：示例必须以**正确的方式**实现，且浏览器侧必须能用上
`@faicad/fai-cq-gears`——不接受「浏览器侧换不了」作为结论。

## 三处阻挡与处置

1. **compatOp 无法收编 async 库函数（真正的根因）**
   `fai_cq_gears` 每个工厂都是 async（`await getGearKernel()`，返回
   `Promise<Result<BrepHandle, string>>`）。适配器原先是
   `unwrapOrThrow(callBrepjs(...))`，而共享的 unwrap 是**同步 leaf**——未落定的
   promise 不是 ResultLike，会原样穿到 `adoptOut`，语句产出的是 promise 而不是
   Shape。修法（通用能力，非为某库写专属代码）：适配器在 unwrap 前先
   `await`（`packages/core/src/api/internal/compat-op.ts`）。对同步返回值
   await 是 no-op，同步库不受影响。

2. **`@faicad/cq-compat` 浏览器入口没有齿轮原语**
   `fai_cq_gears` 从包根导入 `getGearKernel`，而 `src/browser.ts` 只导出
   `./workplane` + `./assembly`，浏览器构建拿不到该符号。`gears.ts` 只 import
   `initOcctWasm` 与类型（无 node 内建），故 `export * from './gears'` 现补入
   该入口。

3. **已发布的 0.13.1 在 CDN 上不可用**
   `@faicad/cq-compat` 只声明在 devDependencies 且值为 `file:../cq-compat`，
   jsDelivr 给 `@faicad/fai-cq-gears@0.13.1` 打出的 `+esm` 会 import
   `/npm/@faicad/cq-compat@file%3A..%2Fcq-compat/+esm`——实测 HTTP 404。
   处置两条：(a) demo 对 workspace 库改用**本地活源码**优先（`packages/demo/main.ts`
   的 `LOCAL_LIBS` + vite alias `@faicad/fai-cq-gears` / `@faicad/cq-compat`）；
   (b) 声明 bug 修掉——`@faicad/cq-compat: ^0.13.0` 移入 `dependencies`。
   (b) 需下次发布后才在 CDN 生效。

## 设计取舍

- demo 的 libLoader 对未知 `@faicad/*` 仍 CDN 优先；`LOCAL_LIBS` 是显式小表，
  只收 CDN 当前服务不了的 workspace 库。走本地还顺带免去「CDN 份 faijs 与本地份
  两个模块实例」的内核绑定问题。
- `gear-demo` 现在造两个真齿轮（24T + 12T，中心距 `module·(z1+z2)/2 = 36`）再
  union，取代旧的 `external` + `thread`——`thread` 在 core，不在齿轮库。
- 「CDN 上没有的库必须显式报错」这条防回归没有丢载体：不再依赖一个坏示例，
  改为喂一段 import `@faicad/no-such-lib-demo` 的脚本并断言
  `not found on npm registry`。

## 验证（实测）

- `packages/core` `compat-op.test.ts`：9/9 绿（新增 2 条 async 用例：收养为带
  `hasBrep` 的 Shape；`err` → 语句级失败并携带 `E_GEAR`）。
- `packages/tests` `faijs/compat-e2e`：13 文件 / 47 用例全绿（原 12/43）；新增
  `fai-cq-gears-flow.test.ts` 用**与 demo 完全相同的脚本**走 `runtime.execute`，
  断言 Shape 收养、BREP 链保持、STEP 含 `ADVANCED_FACE`、mesh 模式
  `E_MESH_UNSUPPORTED`。
- `packages/demo`：`vite build` 成功（8.17s），齿轮库落在独立 chunk；playwright
  的 `gear-demo` 用例在 chromium 通过（45.9s，`OK — brep: 1 shape(s)`，STEP 含
  `ADVANCED_FACE`，mesh 不可用）；示例切换用例与新增的 CDN 缺失用例同样通过。
- `scripts/check-ghost-deps.mjs`、`check-workspaces-order.mjs`：OK。

## 已知未修（超出范围，既有问题）

- `packages/fai_cq_gears` 的 `src/stability/stability.test.ts`：8 条失败。它们用
  `spawnSync(process.execPath, ['runner-entry.ts', …])` 让裸 node 跑 `.ts`，而
  该文件 `import './cases'` 不带扩展名，原生 ESM 解析失败
  （`ERR_MODULE_NOT_FOUND`）。与本次改动无关；该套件不在
  `scripts/ci.ps1` 的 `$testPackages` 内，所以 CI 从未暴露。该包其余测试
  223 passed / 16 skipped。
- `packages/demo` `tsc --noEmit` 有 6 条既有错误（probe-cdn-kernel 用例与
  `main.ts` 三处 handle brand 不匹配）。本次未碰；demo 的 typecheck 不在 CI 内。
