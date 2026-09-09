# Agent Note: 浏览器 ProjectLoader + demo Open Folder — browser host 的多文件 `.fai.js` 支持

Status: rejected — 宿主「项目文件从哪来」属应用层策略，不该放进 core（已迁至 packages/demo）；其中第 4 条 autoLiftFor 决策仍然有效，见 implemented/feature/2026-09-09-demo-local-folder-project.md

[English](2026-09-09-browser-project-loader-in-core.md) | 中文

## 问题

多文件能力（ModuleRegistry + `HostPorts.projectLoader`，P5）在 Node 侧接了真实文件系统（fs ProjectLoader + CLI wiring + entryKey），但 browser host 完全没有加载器：`createBrowserPorts` 不接受 `projectLoader`，任何带相对 `.fai.js` import 的脚本（如 mini_lathe 装配）在 demo 里都会因绑定缺失而失败。demo 也没有「打开项目文件夹」的入口，只能打开单文件。

## 提案

1. **`browser-host/directory-project-loader.ts`** —— `createDirectoryProjectLoader(rootHandle, opts?)` 把 File System Access API 目录句柄（`FsDirectoryHandleLike`）包装成 `ProjectLoader`。`listModules()` 同步且有缓存（ModuleRegistry 以不带 await 的方式调用它）；`refresh()` 重新枚举，保证每次 runCode 都看到最新内容。枚举用 `for await (… of handle.entries())`，只保留 `*.fai.js`，跳过 `node_modules`、`.git`、`out`、`dist`、`.wpblock`，key 用 POSIX 相对路径；loader 错误一律 `{ cause }` 包裹抛出（preserve-caught-error 规则）。
2. **`createBrowserPorts`** —— 接受 `projectLoader` 并在 `HostPorts` 中回吐；缺省 `undefined`（单文件行为不变）。
3. **demo Open Folder** —— 「Open Folder」按钮调用 `window.showDirectoryPicker()`（File System Access API，环境不支持时有守卫），在返回的句柄上构建 `createDirectoryProjectLoader`，并把示例下拉灌入 `__proj:` 条目；runCode 每次 `refresh()` loader、把 loader + `entryKey` 同时传给 brep/mesh 两个 `createBrowserPorts`，状态栏显示 `Project: <root> (<entry>)` 前缀。
4. **`autoLiftFor` 逐库覆盖（`LibLoader.options`）** —— 新增引擎开关：`autoLiftFor(packageName)` 优先级高于全局 `autoLift`。验证浏览器装配时发现：demo 的全局 `autoLift: true` 会把 `@faicad/cq-compat` 的裸函数整体提升进 compat 边界，而 compat 边界的 `borrowDeep` 会把实参里的 faijs Shape 替换成 brepjs 借用视图，导致 `cq.constraint` 的面选取崩溃（`E_OP_FAILED` → 对无 `positions` 的 shape 走 bbox）。CLI（`autoLift: false`）跑同一装配没问题。逐库 `autoLiftFor` 让 demo 保留全局 `autoLift: true`（sheetmetal 这类真裸函数库仍需要），同时让 cq-compat 保持不提升——与 CLI 等价。
5. **测试** —— `createDirectoryProjectLoader` 单元测试（内存假句柄：枚举、`refresh()`、`ModuleRegistry` 集成 + `MODULE_NOT_FOUND`）、`createBrowserPorts` 注入透传、`autoLiftFor` 优先级（false → 函数保持原样；undefined → 回落到全局 true → 被 compat 包装）。demo e2e：mini_lathe 装配、纯 cad 多文件 fixture、空目录、切回内置示例。

## 验证

- core 全量：90 个测试文件、1310 通过 / 10 跳过；cq-compat 31 通过。demo e2e 20/20，含此前失败的「Open Folder：mini_lathe 装配（brep 多文件相对 import）+ STEP（`ISO-10303-21`、`ADVANCED_FACE`）」。

## 备选方案

- **让 compat 边界不再 borrow faijs Shape 实参（或转回 faijs Shape）**：拒绝——改变所有 compat 库的 vendored-bridge 语义，风险是动既有 `admitCompatLib` 契约；问题只出现在「以 Shape 为受众」的 cq-compat 函数被全局提升时。
- **demo 全局 `autoLift: false`**：拒绝——会让 sheetmetal（真裸库）和 gear 脱离 compat/语句边界，改变这些示例的浏览器行为；逐库关闭更精准。
- **IndexedDB 句柄持久化（BREP.io 式）**：v1 不需要——demo 是单会话测试载体（v2 随 3d_editor 再做）。
- **异步 `listModules`**：拒绝——引擎同步调用；loader 缓存模块清单并「惰性」刷新。

## 后果

- browser host 与 fs 版能力对等；需要多个项目根的宿主按根构造多个 loader。
- `window.showDirectoryPicker()` 需安全上下文（localhost 可以）；不支持的环境退化单文件模式。
- `autoLiftFor` 是加法式开关：不设置它的宿主行为与之前完全一致。
- 沿用 P5 的已知缺口：每次运行都重新读源码（暂无 fingerprint 缓存）。