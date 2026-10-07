# Agent Note: 基于 TS-AST 识别与全量 op 采集重建 occt-wasm op 可达性扫描器

Status: implemented

English | [中文](2026-10-07-occt-op-coverage-rebuild.md)

## Problem

初版扫描器产出 occt-wasm 基线报告（对 211 个 `OcctKernel` 方法的六类处置）时，存在两个已认定缺陷与两个归属陷阱：

- 识别内核调用用正则，处理不了真实调用形态——`const x = <k>.<m>.bind(k)`、`(<cast>).<m>.call(k, …)`、解构、强转。
- op 全集只采 `scriptFace: true` 的 schema 行，未收 arg-spec 手写 op 与手写平台 op，导致 50 个 op 存在却对扫描不可见。
- 陷阱：把 `getBrepApi()` 的 L1 契约句柄当内核句柄（把中立 op 误判为平台 op）；且按整文件归属内核调用，多 op 文件把单个 op 的归属淹没在兄弟 op 里。

没有可信扫描器就无法冻结基线，也谈不上在 S2 阶段对 L3「裸调」计数作推理。

## Decision

改用 TS-AST 可达性 + 精确 op 集重建扫描器，并冻结六类处置到 `packages/core/src/api/surface/occt-op-coverage.json`。

- 内核句柄识别落在 `packages/core/src/occt-scan/recognize.ts`：按声明识别内核标识
  （`getOcctKernel()` / `getKernel()` / `initOcctWasm()`），在 AST 层穿透 cast/别名/`as` 链，
  把 `bind`/`call`、解构别名还原到底层方法名，并且**不**把 `const kernel = getBrepApi()` 当内核句柄（陷阱 1 的防线）。
- op 全集 = `api/` 下 `defineOp`/`compatOp` 顶层导出之并（生成文件与手写文件皆含），按 op 名合并、
  优先带 `brep` 桥的声明。
- 归属按函数精确：带 `brep: __own_X` 桥的 op 切桥的目标函数；单 op 手写文件取整文件——helper
  实现（如 `loftBrep`/`sweepBrep`）正在文件顶部，取链和归属互不混淆，且不污染多 op 的生成文件。
- 六类报告复现方案 §7.2 的处置分支：C1=102、C2=10、L3=0、C3=4、C4=63、C5=10、C6=22 —— 和 211
  穷尽、互斥，且每个未达方法恰好落入 C3/C4/C5/C6 之一（JSON `exhaustiveness` 里断言）。
- L3 为空的根因是：看起来的 `healSolid → healFace` 违规本身就是第三种归属陷阱（§7.5 陷阱 2 的
  「跨函数 helper」一面）而非真实声明缺口——`healSolidBrep` 是引擎中立实现（走 `getBrepApi()`/L1
  契约），occt 的 `healFace`/`healWire` 由已声明 `engines:['occt']` 的 `heal` op 触达。扫描器现走
  「函数切片 + 同文件顶层本地 helper 的传递闭包」(`kernelCallsFromRoot`)：像 `healFaceBrep` 这类
  非导出 helper 会归属到真正调用它的 op。`surfaceCurvature` 归 C3，因脚本 op `inspectCurvature`
  已覆盖曲率查询。
- 回归测试 `test/occt-scan/recognize.test.ts` 锁定四种调用形态 + 陷阱 1；
  `test/occt-scan/coverage-baseline.test.ts` 锁定 S2 基线不变量（L3 空、healFace/healWire ∈ C2、
  getShapeType ∈ C1、穷尽且互斥）。

## Alternatives considered

- **就地修整旧正则识别器。** 拒绝：正则结构性表达不了 bind/call/解构/强转，且 `getBrepApi` 对
  `getOcctKernel` 是语义差别，正则无法可靠判定。
- **归属仍用文件级、再做减法。** 拒绝：减法脆弱。桥函数精确切片 + 单 op 整文件，对「多 op 生成文件」
  （桥）与「手写 helper 文件」（单 op）都精确。
- **暂不冻结基线（等 L3=0）。** 拒绝：S1 的本职正是冻结诚实现状。冻结修正后的 L3=0 处置是 S2 可评审的产物。

## Consequences

- `npm run scan:occt-ops` 产出报告并重写冻结 JSON。加脚本目标使扫描可用文档里的配方复现。
- `recognize.ts` 是扫描器内部（`@internal` 注解），不是公开 API。
- 基线 C2=10（非 9）且 L3=0，如实记录扫描器修正后的诚实处置。C2=10 含 `healFace`/`healWire`
  （由已声明 engines 的 `heal` op 触达）与 `loftWithVertices`/`thicken`；C1=102 复现方案目标，六类求和精确。
- `live-shapes.test.ts` 原本带着与本改动无关的既有 `tsc` 报错（在 `HostArg` 上断言原始 `kind` 属性，
  但 `JsonValue | HostRef` 宽联合无法收窄）；现改用导出的 `isHostVarRef` 守卫——既是正确类型
  也是文档化的访问模式，`npm run typecheck` 全绿。用守卫而非手写 cast 是更佳的示例。