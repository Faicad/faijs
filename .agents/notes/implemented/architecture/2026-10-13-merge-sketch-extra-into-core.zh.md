# Agent Note：合并 sketch 和 faijs-extra 到 core，删除 draw——cad 保留绑定

English | [中文](2026-10-13-merge-sketch-extra-into-core.md)

Status: implemented

## Problem

cad 命名空间（`cad.*`）由宿主在运行时经三步协议装配（`registerLib('cad', merge(...))` + `register*Symbols()` + `install*()`）。如果遗漏任何一步，`.fai.js` 脚本会静默失败或在不同阶段失败。内部物理包结构（某个 op 属于哪个包）泄漏为公开契约——下游仓库硬编码 `@faicad/faijs-sketch`、`@faicad/faijs-extra` 等。内部重构迫使下游修改 import，即使脚本语义未变。

此外，`cad` 绑定可被宿主经 `libs.cad` 或 `registerLib('cad', ...)` 覆盖，意味着没有单一的权威 cad 命名空间。

## Decision

1. **合并**：`packages/sketch` → `core/src/sketch/`，`packages/faijs-extra` → `core/src/extra/`，`packages/draw` 删除（已废弃，由 `cad.sketchOnPlane` / `cad.profile` 取代）。

2. **单一装配点**：`createApiNamespace()` 现在携带完整的 cad 面（平台 + sketch + extra op）。`createRuntime(ports)` 内部注册它。宿主不再装配 cad。

3. **保留绑定**：`cad` 是唯一保留绑定名。向 `createRuntime` 或 `createBareRuntime` 传 `libs.cad` 抛 `E_CAD_RESERVED`。`createRuntime` 设置 `_cadReserved = true` 后，`registerLib('cad', ...)` 被拒绝。以任何其他名注册的第三方库不受影响。

4. **求解器注入**：`installSketchSolver` 替换为 `setSketchSolverInitFn` + `initSketchSolver` 三阶段模式（对齐 `setOcctWasmInitFn` / `setBrepkitWasmInitFn`）：① 宿主注入工厂，② Node 自动解析，③ 抛错。globalThis 共享用于 CDN 多实例。

5. **雕刻提供者**：`decoration-provider.ts` 删除；`mesh/engrave.ts` 直接调用 `extra/mesh/` 中的 `createEngraveDecorationProvider()`。

6. **子路径契约**（全部公开，随 core 发布）：
    - `@faicad/faijs/sketch`（原 `@faicad/faijs-sketch`）
    - `@faicad/faijs/sketch/node`（原 `@faicad/faijs-sketch/node`）
    - `@faicad/faijs/extra`（原 `@faicad/faijs-extra`）
    - `@faicad/faijs/extra/browser`（原 `@faicad/faijs-extra/browser`）
    - `@faicad/faijs/extra/editor-ops`（原 `@faicad/faijs-extra/editor-ops`）

## Alternatives considered

- **保留包，仅自动装配**：拒绝——下游仍硬编码包路径；问题是物理打包作为公开契约，不仅是装配便利性。
- **兼容性 shim**：拒绝——用户明确选择零兼容性、一次性破坏性变更。无转发 shell，无旧包名。
- **`HostPorts.assets` 资源键用于 planegcs wasm**：拒绝——planegcs wasm 加载与 occt/brepkit 是同类问题；复用同一模式（`setXxxWasmInitFn` + `initXxx`），不是新机制。
- **在 `createApiNamespace()` 中展开 op**：拒绝——`gen-symbol-table.ts` 无法发现 SpreadAssignment；显式键是符号表保持同步所必需的。
- **删除 `createBareRuntime`**：拒绝——它服务于合法的「纯引擎」用例；`libs.cad` 守卫足以防止绕过 cad 权威。

## Consequences

- `createRuntime(ports)` 是唯一的 cad 装配点；宿主仅提供 ports + wasm 源 + 第三方库。
- 10 个新 op（`sketch`、`fai_drill`、`fai_extrude`、`fai_split`、`group`、`assembly`、`copy`、`load`、`text`、`svgExtrude`）显式列在 `createApiNamespace()` 中——无展开。
- 守卫测试：`cad-binding-reserved`、`cad-face-completeness`、`assembly-single-point`、`solver-loader`、`editor-ops-closure` 防止回归。
- `op-set-consistency` 测试断言合并的 op 在符号表中（展开陷阱守卫）。
- 下游仓库必须更新 import（见 plan §7.6 的逐仓库变更）。
- `@salusoft89/planegcs` 现在是 core 的直接依赖（原为 sketch 的依赖）。
