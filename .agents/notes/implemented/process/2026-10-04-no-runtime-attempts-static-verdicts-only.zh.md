# Agent Note：禁止运行期尝试——一切结论静态提前可知（fcstd 移植铁律）

[English](2026-10-04-no-runtime-attempts-static-verdicts-only.md) | 中文

Status: implemented

## Problem

项目红线「BREP/mesh 路径判定红线：静态规则，禁止运行时回退」在 fcstd 转换管线中被违反。参数化 `cad.sketch` 发射路径存在有损环节：约束投影（`fromFreeCadConstraints`）把映射不了的约束（轴引用、外部几何引用）**静默丢弃**后管线继续走——发射出一个缺失部分自身约束集的 `cad.sketch`。运行期重解有时无法重现闭合轮廓（`E_SKETCHC_NO_CONTOUR`，67 个文件）。

没有修根因，而是在有缺陷的发射之上叠了三轮缓解：

1. 转换期零环 bake 门禁（被 2 个 e2e 回归证伪并撤销）；
2. 提交 `5ecb7f94`——约束拓扑闭合判别器（`sketch-loop-topology.ts`）+ bake 门禁；
3. `closureUnobservable` 标记，防止门禁在投影致盲的数据上做判断。

三者的共同错误：都在治症状（「运行期会不会炸？」），而不是治病因（约束被丢弃的 sketch 根本就不该发射）。

用户原话：

> 本项目绝对不允许任何的运行期尝试，运行期修补 try/catch。必须全部都是静态提前就应该知道结果的。静态判断能过，而运行期失败的，就是严重 bug。

## Decision

- 约束未全量投影的 sketch（unmapped 非空、或有外部几何）→ 立即显式 gap。不参数化发射、不运行期重解、不产生运行期失败。gap reason 写明原因（如 `constraint-projection-incomplete`）。
- 通过静态检查的 sketch 不得在运行期失败。任何此类失败都是严重 bug：说明静态检查错了或不完整。
- 纯几何回退（bake FreeCAD 已求解的落盘几何）是允许的——那是转换期做出的静态决策，不是运行期尝试。

## Alternatives considered

- **保留 `5ecb7f94` 发射门禁与 `closureUnobservable`**：拒绝——它治症状（「运行期会不会炸？」）而非病因；约束被丢弃的 sketch 根本就不该发射。
- **只修约束投影、保留门禁作为安全网**：拒绝——门禁在投影已致盲的数据上操作；它无法在不完整数据上做出正确决策。

## Consequences

- 用 unmapped→gap 规则替换 `5ecb7f94` 的发射门禁；删除 `closureUnobservable`（它只为有缺陷的前提服务）。
- 重跑 batch conversion 并对账 NO_CONTOUR 桶：这批文件必须变成转换期 gap，而不是 run-fail。
- 评审今后任何移植特性时先问一个问题：「每个结果是否都在发射代码运行之前由静态判定决定？」
- 判别器的单测锁定了 `extractContours` 的真实链接语义，作为参考仍有价值；但建立在「照常发射、预测崩溃」上的门禁已替换。
