# Agent Note：specifier 校验的 registerLib + 宿主 libLoader 在执行期自动装载

Status: implemented

[English](2026-09-04-gear-lib-renaming-and-execute-auto-load.md) | 中文

## 问题

第三方库靠一个易错的名字装载：宿主把命名空间按绑定名注入（`registerLib('gear', ns)`），而脚本写 `import * as gear from '<specifier>'` 时只按**绑定名**匹配，不按 import specifier 匹配。`derivePackageName` 会归一化 specifier（`gear-lib-demo` → `gear-lib-demo`，`@scope/pkg/sub` → `@scope/pkg`），但没有任何校验断言 specifier 确实指向已注册的包——于是库改名后旧的裸 specifier 仍能跑，不匹配是**静默**的。`@faicad/mech-lib` → `@faicad/gear-lib-demo` 改名恰好暴露了这一点：改名之后，脚本仍可 `import ... 'gear-lib-demo'`，而引擎只记得旧的包身份。自动装载还跟 parse 期纠缠在一起（宿主手动注入），浏览器应用必须自己拼 `registerLib` 调用并重复引擎的解析逻辑。

## 决策

两种机制根治装载名不匹配的根因，并让执行自包含：

1. **specifier 校验注册**：`registerLib(binding, ns, { default?, compat?, packageName? })` 记录 `specifierToBinding.set(packageName, binding)`。parser 从 import specifier 推出规范 `packageName`（剥离后的首段）。`check()` 在 import-specifier 循环中，把脚本每个 import 的 `packageName` 与注册表（或 loader 的 `listLibs()`）比较；不匹配 → `stage:'symbol'` 错误——不静默放过。预检同时声明哪些命名空间推迟到执行期（可自动装载）。
2. **执行期自动装载**：`HostPorts.libLoader` 是可选宿主能力：`{ loadLib(packageName): Promise<StdlibNamespace>, listLibs(): string[], options?: { compat?: boolean } }`。`autoLoadLibs(scriptIR)` 在 `executeIR`、`updateIR`、`appendIR` 内部——`compileToModule` **之前**——运行，对每个尚未绑定的命名空间 import 用 `{ compat, packageName }`（取自 loader）`registerLib`；`loadLib` 失败变成 `ExecutionResult.failedAt`（import 级消息），而不是命名空间上的运行时 TypeError。`check()` 保持同步（只用 `listLibs()`），把成员解析推迟到执行期。

框架**刻意不在 parse 期自动装载**：`parse` 是同步的，装载是宿主的 I/O 关注点。切分让 `parse` 保持文本的纯函数，又让每个宿主（Node CLI、浏览器 demo、vitest）都通过同一个 `libLoader` 契约供给装载。demo 示范了模式：静态 `LIB_MODULES`（字面量 specifier → 懒 import 的命名空间，`import()` 用字面量以便 Vite/Rollup 静态打包），经 `createBrowserPorts({ libLoader })` 注入。

`mech-lib` 这个名字遍布全仓已消失——包名 `@faicad/gear-lib-demo`，绑定与脚本 specifier 一律 `gear-lib-demo`。`derivePackageName` 归一化出的 specifier 是唯一事实源。

## CLI 与 demo loader 细节

Node CLI（`packages/core/src/node-host/cli.ts`）带白名单 loader（`CLI_ALLOWED_LIBS`）：`loadLib` 把脚本短 specifier（`'gear-lib-demo'`）与 scoped 名（`'@faicad/gear-lib-demo'`）经 `await import(pkgName)` 归一到同一个真实模块；`listLibs` 返回被接受的 specifier。demo（`packages/demo/main.ts`）用字面量 key 的 `LIB_MODULES` 表，值为静态 import 的 `@faicad/gear-lib-demo`，因此映射可静态打包：`'gear-lib-demo' → async () => gearLib`；demo 的 vite alias 把 scoped 包指到 `packages/gear-lib-demo/src/index.ts`。这与执行期自动装载共享同一机制：脚本写 `import * as gear from 'gear-lib-demo'`，loader 返回命名空间，`registerLib('gear', ns, { compat, packageName: 'gear-lib-demo' })` 在 `runCode` 内无需任何手动接线。

## 失败语义

- 有 loader 但 specifier 不在 `listLibs()` → `check()` 在 ① import 循环失败——显式，绝不静默。
- 无 loader → 回落 specifier 表（`specifierToBinding`），旧的手动 `registerLib` 路径原样保留。
- `loadLib` 在执行期抛错/reject → `ExecutionResult.failedAt`，`message: 'import specifier "…" cannot be auto-loaded: …'`——脚本响亮失败，显示不匹配的 specifier，而不是 `ns.binding` 上的迟到 TypeError。

## 被否决的备选方案

- **parse 期自动装载**（`parse` 内 `registerLib`）。否决：`parse` 必须保持同步（纯文本 → IR）；parse 期间做带副作用的 I/O 破坏 parser 契约与所有消费方。
- **浏览器 loader 里对变量做动态 `import(name)`**。否决：Vite/Rollup 无法静态分析变量 specifier——生产构建会留下裸动态 import 在浏览器 404；静态 `LIB_MODULES` 表 + 字面量 specifier 才是打包安全的。
- **只按绑定名 `registerLib`、无 specifier 表**（现状）。否决：正是静默错配 bug——宿主要是没按名字注入正确命名空间，改名后的库会在过期名下继续跑。
- **CLI 通配装载任意包名**。否决：CLI 不能从磁盘装载任意 specifier 串，白名单是安全边界；loader 只对白名单内的名字回落 `import()`。

## 后果

- 改名全链路 specifier 完整：脚本 import `'gear-lib-demo'` 且 gear 包在场时经 `gear-lib-demo` 绑定；改名错配变成响亮、可缩放的错误，而不是死寂行为。
- 浏览器应用（含 demo）不再为脚本 import 手写 `registerLib`——`libLoader` 是唯一扩展点。
- 增量 `updateIR`/`appendIR` 也跑 `autoLoadLibs`，任何路径都会把库带起来；重跑 `executeIR` 时已注册的 binding 是 no-op（不覆盖宿主注入的实例）。
- 引擎处处保持 parse 同步：`parse`/`check` 无异步泄漏工具抽象中没有异步泄漏。