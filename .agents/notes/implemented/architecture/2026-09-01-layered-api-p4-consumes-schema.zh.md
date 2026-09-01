# Agent Note: 分层 API 移植 — P4 L3 端到端（defineOp 的 consumes + schema 元数据）

Status: implemented

[English](2026-09-01-layered-api-p4-consumes-schema.md) | 中文

## Problem

P0–P3 已落地分层栈（内核 → L0/L1 → L2 vendored），但 L3 API 面仍是旧的隐式函数链：函数"是否消费"其 shape 输入，由函数体内的运行时 `keep()`/`keepHidden()` 调用决定，且 codegen 与 UI 参数面板没有机器可读的参数元数据。P4 门是第一个 L3 端到端里程碑：给 `defineOp` 扩展两个静态字段（D2），并把第一批三个 op（`box`/`cylinder`/`union`）打穿整条宿主链路——`.fai.js` 文本 → parse → execute → terminals → 宿主可见的 `ExecutionResult`。

## 决策

1. **静态消费声明（`consumes`，D2 G3/G4）** — `defineOp` 新增可选 `consumes?: 'all' | 'none' | number[]` 字段，随 `DualOpMeta` 携带，并在库装配时由 `assertLibConforms` 校验。语义：`'all'`（默认，布尔/变换类拥有其操作数）、`'none'`（纯查询/创建类——不隐藏操作数）、`number[]`（只消费列出的位置输入）。`defineOp` 会校验 `consumes`/`schema` 形态合法。
2. **运行时视图读取声明** — `DagRuntimeView.opConsumes(stmt)` 经 runtime 的 libs 注册表解析 callee（`libs[ns][callee]` → `DUAL_OP_META.consumes`），`computeLeafTerminals`/`consumes()` 据此使用静态声明，不再只靠函数体推断。C 规则链变为 C0（keep）→ C2（静态 consumes）→ C3（输出全非几何）→ C5（默认）。被 keep 的变量（C0）仍然优先于任何声明。
3. **三个 op 就地打上声明** — `box`/`cylinder` 声明 `consumes: 'none'` + 一个 `schema` 参数表；`union` 声明 `consumes: 'all'`。`schema` 与 `consumes` 都挂在 `DualOpMeta` 上，可经 `DUAL_OP_META` 从函数对象读取，供 codegen / UI 面板使用。
4. **运行时消费路径不变** — 运行时仍尊重函数体内的 `keepHidden()`（静态声明是增量式的；"仅凭声明接管消费语义"的 O6 迁移明确推迟）。
5. **P4 验收套件** — `packages/tests/faijs/p4-l3-e2e/`：宿主链路 `.fai.js → execute → terminals → ExecutionResult`（断言 `naming`、`brepSolids`、`topology` 及十一字段面），另有 `terminal-dag.test.ts` 中的 C2 单测（静态 `'none'`/`number[]` 让上游 shape 保持终端；缺省声明落入 C5；调用点 keep 仍然胜出），以及 `defineOp` 与三个 stdlib op 的 D2 元数据断言。

## 备选方案

- **让宿主或 codegen 直接解析函数体 `keep()` 调用**来得知消费语义。否决：要执行才知其行为，违反"零签名知识"目标，也无法在未执行时驱动终端推导。
- **把静态消费语义写进单独的声明寄存器/表**而非挂在函数元数据上。否决：`DUAL_OP_META` 已随函数同行，检索 O(1)，无需第二套注册机制。
- **立即用静态声明接管消费语义（O6 全文迁移）**。否决：会改变现有 box/union 的时间线行为，属于须逐 op 对照的行为变更，P4 只做声明载体与消费链打通，迁移留 P6。

## 后果

- 第三方 op 现在可以静态声明其消费语义；宿主无需改动即可让终端推导在不解执行函数体的前提下遵守契约。
- 三个 stdlib 原语当下携带机器可读的 `consumes` + `schema` 元数据；其余 API 面与对应的 codegen/UI 消费属于 L3 后续（P6 对齐）。
- 所有门禁全绿：core typecheck、`check-layer-boundaries`（150 个 vendored 文件）、export JSDoc、翻译配对，以及完整 vitest 套件（core 880 passed / 9 skipped、stdlib 46、tests 638，含 P4 验收、C2 与元数据用例）。