# Agent Note: op 量纲声明防遗漏机制（paramDims 强制声明）

Status: implemented

[English](2026-10-10-op-dims-declaration-guard.md) | 中文

## Problem

`defineOp`/`compatOp` 的 `paramDims` 字段是可选的。152 个 op 中仅 22 个有声明。新增 op 可以完全不声明量纲，没有任何机制阻止遗漏——`cad.extrude(sk, { length: 20 })`（量纲参数传裸数字）既不报 `E_DIM_BARE_NUMBER` 也不生成 `20 * MM`。

用户要求："有没有什么方案，可以在以后新增 op 的时候，保证不会遗漏这个量纲的申明。而且保证量纲的申明只需要在一个地方处理，不需要重复申明。"

## Decision

将 `paramDims`（或 `spec`）设为**必填**，由三层机制强制：

1. **源码级 AST 守卫**（`scripts/check-op-dims.mjs`）：扫描 `packages/core/src/api/`、`packages/faijs-extra/src/ops/` 及其他包 `src/` 目录下所有 `defineOp`/`compatOp` 调用点。`paramDims` 或 `spec` 缺失即 CI 失败。同时交叉核对 JSDoc `@param` 单位标注（如 `(mm)`）与声明的量纲。

2. **运行时不变量测试**（`packages/core/test/lang/op-dims-invariant.test.ts`）：驱动完整 `cad` 命名空间（平台 + 编辑器 op），断言每个 dual-op 函数在 `getOpDims()` 中有非空条目，并验证 `paramDims` 值均为合法的 `DimName | 'plain'`。

3. **类型系统**：`DimParamValue = DimName | 'plain'`——`'plain'` 标记数字参数为显式无量纲（如 `segments: 64`）。它不是第二条豁免通道，而是同一条声明取不同值，每个数字参数都被显式穷举。

声明仍是唯一来源：`CadRuntime.getOpDims()` 运行时汇总；维度校验 pass（`extractMetadata`）和 codegen 单位字面量序列化（`n * MM`）消费同一份表。不维护第二张表。

## Alternatives considered

- **op 级 `dimless: true` 豁免**：用户否决——op 级开关会让未来新增的参数自动跟着被豁免，正是我们要堵的漏洞。

- **品牌类型（`Dim<'length'>`）**：否决——TS 类型跨 JS VM 边界被擦除，脚本侧 `20 * MM` 运行时是裸 `number`，brand 无法存活。且 `segments: 64` 仍需一个"无量纲 brand"，等于换名不换实。

- **从实现签名全自动推导**：否决——参数量纲是语言/运行时契约（脚本面 `20 * MM` 的语义），不是实现类型能表达的。推导会创造第二处量纲知识维护点，违背"只在一个地方处理"的要求。

## Consequences

- 全部 152 个 op 现已声明 `paramDims`（或 `spec`）。
- `scripts/check-op-dims.mjs` 接入 `ci.ps1` 和 `ci.sh` 作为硬门禁。
- `DimParamValue` 类型（`DimName | 'plain'`）从 `@faicad/faijs/units` 导出。
- `docs/api-contract.md` §10.3 记录量纲声明纪律（双语）。
- `'plain'` 参数零行为变化：不包单位字面量、不参与维度校验——与 D8 前裸输出一致。
- 存量 fixture/测试中对量纲参数使用裸数字的违规被暴露为既有违规（非新破坏）；修复为后续任务。
