# Agent Note: HostArg -- 宿主侧位置实参的 IR 屏蔽

Status: implemented

[English](2026-09-05-host-arg-ir-shield.md) | 中文

## Problem

faijs 0.8.0 引入了五种位置实参 IR 形态（`ParamRefIR`、`VarRefIR`、`CallRefIR`、`ExprIR`、字面量），但宿主侧 API（`codeToArgs`、`formatCodeLine`、`StatementSummary`）将原始 IR 标记对象（`{$ref}`、`{$param}`、`{$call}`、`{$expr}`）直接泄漏给了 3d_editor 等宿主。宿主不得不手写 `{$ref: name}` 字面量（12 处），没有类型安全也没有守卫。`StatementSummary` 在原始 `positional` 槽位旁还有冗余投影（`inputs`、`positionalKinds`），且 `hasComputedArgs` 阻止整行 timeline 的编辑。

## Decision

引入 `HostArg`（`packages/core/src/lang/host-arg.ts`）作为唯一的宿主侧实参类型。宿主构造和消费 `HostArg` 形态（`{kind:'var-ref', name}` 等），不接触 IR。两个内部递归转换器（`argIRToHost` / `hostArgToIR`）在 IR 与 Host 边界桥接 -- 不导出。

- `codeToArgs` 返回 `HostArg[]` positional + `Record<string, HostArg>` args（经 `argIRToHost` 剥离 IR）。
- `formatCodeLine` 接受 `HostArg` positional/args，入口处经 `hostArgToIR` 转换 -- codegen 逻辑不变。
- `StatementSummary` 新增 `args: Record<string, HostArg>`，移除 `inputs` 和 `positionalKinds`（宿主用 `isHostVarRef` 过滤 `positional` 得到 inputs）。
- 导出宿主辅助函数：`isHostVarRef`、`isHostParamRef`、`isHostCallRef`、`isHostExprRef`、`isHostRef`、`hostArgToDisplay`、`hostArgToLiteral`、`HOST_REF_KINDS`。
- `argIRToHost` 和 `hostArgToIR` 不导出（IR 红线）。

判别依赖运行时守卫而非类型系统 -- `HostRef` 在结构上是 `JsonValue` 的子类型。保留字规则（kind 值为 `HOST_REF_KINDS`）确定性解决唯一歧义；字面量对象不得使用这些 kind 值。

## Alternatives considered

- **直接导出 ArgIR 类型**: 否决 -- IR 红线（V5）要求宿主不导入 IR 类型。泄漏 `{$ref}` 等迫使宿主手写 IR 字面量，违背初衷。
- **保留 `inputs`/`positionalKinds` 作为便捷字段**: 否决 -- 一个事实一个家。`inputs` 是 `positional` 上 `isHostVarRef` 过滤的平凡操作；`positionalKinds` 被运行时守卫替代。保留两者造成双事实源和过渡期兼容副本（仓库规则禁止）。
- **保留 `hasComputedArgs` 阻断**: 否决 -- 字段级可编辑性（通过 `isHostRef` 守卫）严格更强。整行阻断是 IR 泄漏时代的权宜之计；有了 HostArg，个别字段可只读而其余可编辑。

## Consequences

- 版本号从 0.8.0 升至 0.9.0（破坏性：`StatementSummary` 字段变更，`codeToArgs`/`formatCodeLine` 类型变更）。
- 3d_editor 必须将全部 12 处 `{$ref}` 手写迁移为 `{kind:'var-ref', name}`。
- `hasComputedArgs` 保留在 `StatementSummary` 上作为信息标志（不再门控面板入口）。
- `codeToArgs` 的哨兵声明行为（单行上下文中标识符变为 param-ref）是已知限制；`analyzeCode` 配合完整脚本上下文是 var-ref 测试的正确路径。
