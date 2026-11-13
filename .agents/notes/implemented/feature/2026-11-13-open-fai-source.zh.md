# Agent Note: 单脚本查看入口

Status: implemented

[English](2026-11-13-open-fai-source.md) | 中文

## Problem

磁盘上的 `.fai.js` 文件不是项目容器。`openFaiZip` 读取自包含的 `.fai.zip`，其 `resolveFile` 明确拒绝归档之外的路径，因此宿主没有受支持的入口来直接打开一个裸脚本。

## Decision

`@faicad/faijs-viewer` 在 `openFaiZip(bytes, opts)` 之外提供 `openFaiSource(source, opts)`。两个入口共用 `installEngine`、`createViewerLibLoader`、`ensureSketchSolver` 和 `extractMeshes`，并返回同一个 `OpenFaiResult`。`OpenFaiSourceOptions` 把容器等价的能力作为可选的宿主注入项暴露：`projectLoader` 用于相对 `import './other.fai.js'`，`assets` 用于 `cad.load` / `cad.loadByKey`，另有 `wasm`、`entryKey`、`mode`、`sketch` 和 `libs`。`entryKey` 缺省为 `model.fai.js` 并作为 `sourceFile` 上报；由于不存在容器 model，`modelId` 为空字符串。失败使用 `E_SOURCE`、`E_EXECUTION` 和 `E_NO_GEOMETRY`，`E_WASM_URL` 仍按调用方契约违规抛出。

## Alternatives considered

- **由宿主用 `writeContainer` 把脚本包成 `.fai.zip` 再调 `openFaiZip`。** 未采用：宿主需要编造 manifest 和 model id，依赖容器的内部布局；而归档的自包含契约无法解析同目录文件，相对 import 与 `cad.load` 仍然不可用。
- **由宿主直接调 `createRuntime`，绕过 viewer 包。** 未采用：wasm 绑定、草图求解器安装和动态库装载会在每个宿主里重复一遍。

## Consequences

- `open-fai-zip.ts` 导出 `extractMeshes` 和 `ensureSketchSolver` 供复用；`openFaiZip` 行为不变，既有测试全部通过。
- 自包含脚本不需要任何宿主注入；带相对 import 或外部资源的脚本需要宿主提供 `projectLoader` / `assets`。
- 宿主按扩展名选择入口：`.fai.zip` → `openFaiZip`，`.fai.js` → `openFaiSource`。
