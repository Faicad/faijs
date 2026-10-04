# Agent Note: faijs-viewer 预置库与动态库加载

Status: proposed

[English](2026-10-04-faijs-viewer-preset-dynamic-libs.md) | 中文

## Problem

`openFaiZip`（v1）只把 `sketch` + `draw` 预置进默认 `cad` 命名空间，且从未向 `createBrowserPorts` 传入 `libLoader`。凡模型 import 第三方 faijs 库（`@faicad/faijs-gears`、`@faicad/sheetmetal`、`cq-compat` 等）的 `.fai.zip`，执行时都会因绑定未注册而失败。通用 `.fai.zip` 查看器（3d_viewer_electron）无法打开这类模型——而模型可能 import 的库集合无法预先知道。

## Proposal

**预置面改为 core + sketch + faijs-extra 三合一。** `openFaiZip` 把 `mergeEditorNamespace(mergeSketchNamespace(createApiNamespace()))` 注册为默认 `cad` 绑定，并调用 `registerSketchSymbols()` / `registerEditorSymbols()`。faijs-extra 全量预置（A 组 + B 组，无选择参数）——A/B 能力差只是"尚未实现"，不是需要宿主选参的架构边界。

**draw 离开预置面。** viewer 不再 import、合并或注册 `@faicad/faijs-draw`；`cad.draw` 调用现在按未知 callee 失败。draw 包标记 deprecated（description + JSDoc），代码不动。

**动态加载封装进 viewer。** `OpenFaiZipOptions.libs`（`{ enabled, cdnBase, versions, allow, aliases, importModule }`）交给 viewer 内部 `createViewerLibLoader`，按环境分派：浏览器 → `createBrowserLibLoader`（jsDelivr CDN 动态 import）；node → 内部白名单 `import(pkg)` loader，镜像 `cliPortsLibLoader` 语义（默认限 `@faicad/` scoped、短名别名、`loadSource` determinism 扫描、逐库 `faijs.autoLift`）。`enabled: false` 移除 loader，未注册绑定显式失败。

**依赖。** faijs-viewer peer 移除 `@faicad/faijs-draw`，新增 `@faicad/faijs-extra` 与 `three`（B 组 op 的 mesh 实现静态 import three；3d_viewer_electron 已具备）。

## Alternatives considered

**`libs.editor` 选择参数（`full | editor-ops | none`）。** 被用户否决：小程序能力缺口是未实现的能力，不是边界；且 B 组 op 的 mesh 路径无论如何都静态 import three，子入口同样免不掉该依赖。

**保留 draw 合并、只标 deprecated。** 被用户否决：预置面移除 draw。没有任何 emitter 受影响——faijs-freecad 的 Draft 管线（2026-09-29）已迁离 `cad.draw`（contours 以 `ProfileLoop` 数据经 `cad.sketchOnPlane` 放置），draw 包自身头部也已声明"no remaining emitter"。

**core 导出 `createNodeLibLoader` 工厂。** 因范围否决：DRY 有吸引力但会动 core 公开 API；viewer 内部 node loader 约 40 行，镜像 `cliPortsLibLoader` 语义。

**新增 `@faicad/faijs-extra/ops` 子入口（不含预览 helpers）。** 暂缓：B 组 op 模块本身静态触达 three 链，子入口免不掉该依赖；待 B 组实现免 three 后再议。

## Acceptance criteria

- 预置模型（`cad.fai_*` / `cad.sketch`，无 import）以默认选项经 `openFaiZip` 成功执行。
- 配置 `libs` 后，第三方库 import 由 viewer 的 loader 按需装载；白名单拒绝与 `enabled: false` 都结构化返回 `E_EXECUTION`（`failedAt`）。
- `cad.draw` 按未知 callee 失败（回归断言）。
- faijs-viewer 单元 + 端到端测试全绿；全量 typecheck/lint/守卫/CI 全绿。

## Risks

- `three` 成为 viewer peer；不带 three 的宿主需自行安装（3d_viewer_electron 已有）。
- CDN 加载的库必须 pin 到宿主引擎版本线，否则 `assertContractVersion` 失败（显式、结构化）。
- 家族内已无 `cad.draw` emitter（faijs-freecad 已于 2026-09-29 迁到 `cad.sketchOnPlane`）；viewer 移除 draw 不影响任何转换模型。3d_editor 宿主仍在自己 sketch host 里合并 draw——deprecated 只影响其后续演进。
