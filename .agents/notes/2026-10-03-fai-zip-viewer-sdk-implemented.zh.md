# Agent Note：供第三方查看 `.fai.zip` 的 faijs-viewer 包

Status: implemented

[English](2026-10-03-fai-zip-viewer-sdk-implemented.md) | 中文

## Problem

任何想渲染项目 `.fai.zip` 三维文档的第三方，都必须知道如何读容器、组装执行宿主环境、
接好 occt / manifold / brepkit 引擎、再把执行结果转成网格数据。消费方没有一个可单独
依赖的包。

## Decision

新增独立 workspace 包 `@faicad/faijs-viewer`，拥有完整查看链路。第三方只需依赖这一个包，
调用 v1 入口：

```ts ignore-check
openFaiZip(bytes, { wasm: { occtUrl, manifoldUrl, brepkitUrl } })
```

- `wasm` 为**必需**，且三个 url **必须是非空字符串**。缺失或为空属于调用方契约违规，
  **抛错** `E_WASM_URL`；它不是按字节的渲染失败。
- 容器错误、执行失败、「无可见几何」返回 `result.error`，`code ∈ { E_CONTAINER, E_EXECUTION, E_NO_GEOMETRY }`。
- 浏览器中用三个 url 绑定 occt/manifold 引擎；Node 环境下同样做 url 校验，但引擎本地
  自动加载，因此测试可产出真实几何。
- 容器用 `@faicad/faijs/io/fai-zip` 读取；活动（或指定）模型的源码经绑定浏览端 ports
  （资产解析器 + 容器模块加载器）的 `createRuntime` 执行；可见的 `TerminalShape`
  （过滤 `hidden`）作为结构化 `FaiViewerMesh` 数组返回。
- 不依赖 `@faicad/faijs-extra` / `sheetmetal`；唯一运行时依赖是 `@faicad/faijs`（peer），
  外加 `occt-wasm`（peer，仅在浏览器 `OcctKernel` 初始化时懒加载）。
- v1 不内置 wasm 资产；README 给出三个 wasm 文件的自托管指引。
- viewer 产品保留原 occt-import-js 内核；两套内核并存而非合并（按计划决策执行）。

## Alternatives considered

- 复用既有 occt-import-js CAD→GLB 路径：拒绝 —— `.fai.zip` 没有烘焙网格，必须执行 faijs
  脚本，SDK 须对第三方保持内核无关。
- 把查看链路收进 `@faicad/faijs` 核心：拒绝 —— 用户选择独立包，第三方只依赖一个 viewer
  包，无需自行组装宿主/worker/引擎。
- 用 brepkit 作为 mesh 布尔后端并去掉 manifold：拒绝 —— brepkit 的网格布尔 v1 未接入
  布尔槽，`manifoldUrl` 仍保留为必需（仅校验、不消费）字段。
- core 自动宿主装配：拒绝 —— v1 采用调用方传入 `wasm` 对象更简单，未来零配置预置不列入范围。

## 工程留档

- `.fai.zip` 没有预烘焙网格：渲染在运行时执行模型脚本。
- 写测试时发现一个 GOTCHA：入口若 `import` 一个缺失模块并不会失败 —— 运行时忽略它，
  仍能产出网格。要让模型在回归测试里确定性失败，应强制脚本级 throw。
- viewer 即便在 Node 下也在执行前先校验三个 url；只校验（不可实际访问）url 的样例
  仍能产出真实网格（本地引擎自动加载）。

## Acceptance criteria

- [x] `openFaiZip` 对最小 `cad.box` 容器返回非空 `meshes`。
- [x] 空 `occtUrl` 抛错 `E_WASM_URL`；非法字节 -> `{ error }` `E_CONTAINER`；模型抛错 -> `{ error }` `E_EXECUTION`。
- [x] `@faicad/faijs-viewer` 通过 type/project ghost/lockstep/typecheck 守卫、vitest、
  build 到 `dist/`，CDN `versions.json` 经 `gen-importmap` 重生成。
- [x] Node 打开真实 `fcstd-port/**/*.fai.zip`：多数可渲染网格；部分模型以 `E_EXECUTION` 如实报桥体差异错误。

## 变更影响（用户选择的 v1 扩展：真实 FreeCAD sketch/draw 支持）

用户选择扩展 v1，使 `openFaiZip` 能执行调用 `cad.sketch` / `cad.draw` 的**真实
FreeCAD 转换容器**，而不只是 `cad.box` 这类纯 core op。`openFaiZip` 现在：

- 把 sketch + draw 命名空间合并进它注册的 `cad` 绑定：
  `runtime.registerLib('cad', mergeDrawNamespace(mergeSketchNamespace(createApiNamespace())), { default: true })`
  （先 `registerSketchSymbols()` + `registerDrawSymbols()`）；
- 经 `installSketchSolver` 安装 planegcs 约束求解器。**Node** 下自动加载
  `@faicad/faijs-sketch/node` -> `createNodePlanegcsSolver`（`node:` 相关 import
  保持动态，避免浏览器产物拉入 `node:*` 模块）；浏览器宿主自托管 `planegcs.wasm`
  并传 `opts.sketch.planegcsUrl`，否则 `sketch` op 以 `E_SKETCHC_NO_SOLVER` 报错并
  经 `OpenFaiZipResult.error` 返回。
- 把 `@faicad/faijs-sketch` + `@faicad/faijs-draw` 声明为 **peer**（与
  `@faicad/faijs` 并列），保持「只依赖一个包」契约（宿主提供全部三个家族包）；
  electron 消费方以 file 链接方式提供它们。

已验证：`openFaiZip` 可渲染合成 `cad.sketch{rect}+extrude` 容器（viewer 测试
5/5 通过）；electron 的真实 `loadFormat('fai')` 路径现在能打开并渲染 fcstd-port
的 `Group01.fai.zip`（People symbols）。原先 `cad.sketch is not a function` 的
失败已消失。

**未解决（如实记录）：** 两个真实库样例 —— `ThreePartRight` 与 `Double glass
sliding doors...` —— 仍然失败，报
`E_SKETCHC_NO_GEOMS: sketch requires at least one geometry`。解包转换后的
`main.fai.js` 可见转换器输出 `cad.sketch({ contours: [...] })`，但 sketch op 的
输入契约只接受 `shapes`/`geoms`；`contours` 是输出概念而非输入。这是 **faijs
家族里「转换器 ↔ sketch 契约」不匹配，不是 viewer 接线问题**；需要在
`@faicad/faijs-sketch` 中为 `contours` 提供别名（属设计决策），或让 fcstd-port
转换器改输出 `shapes`/`geoms`。