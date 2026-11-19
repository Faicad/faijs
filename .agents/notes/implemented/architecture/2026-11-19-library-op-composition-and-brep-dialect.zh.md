# Agent Note：库作者组合 faijs op；BREP 方言在适配器边界归一

Status: implemented

[English](2026-11-19-library-op-composition-and-brep-dialect.md) | 中文

## 问题

下游库（faijs-sand3d）在 M1/M2 后报告了 13 条 API 问题。按 0.47.1 源码逐条复核后分成三类：

- 4 条现有接口已经覆盖（`Shape` 的 mesh 字段、`BrepHolder`、类型化的 `BrepEngineApi`、`makeFace`）；
- 5 条是文档缺口（嵌套 `defineOp`、布尔 compound、`fromBrep`、命名传播、compound 终端）；
- 2 条是真实缺陷：`shapeType` 返回未归一的引擎方言（occt 小写，brepkit/smlib/mock 大写），而 `api/boolean.ts` 与 `boolean-closure.ts` 用小写字面量比较；以及 `cad.revolve` 的类型只声明了 `{ axis }`，实现却接受 `at` / `angle`。

下游库还因为误判"嵌套 `defineOp` 不受支持"，用 kernel 重造了 `cad.extrude` / `cad.subtract` / `cad.loft`。复现测试（`packages/core/test/cad-runtime/nested-op-repro.test.ts`）证明嵌套可用：嵌套调用共享语句锚点，并有意跳过血缘登记。

## 决策

1. `shapeType` 返回小写的 `ShapeType` 联合；每个适配器在边界归一。下游直接比较小写字面量，不再调用 `toUpperCase()`。
2. 从 `@faicad/faijs/sdk` 导出 `isCompoundHandle(kernel, handle)` 与 `getSolids(kernel, handle)`；多 solid compound 只报告，不拒绝。
3. `cad.revolve` 导出 `RevolveOptions { axis?, at?, angle? }`（角度为弧度）。
4. 库开发手册写明组合契约：嵌套 op 允许；嵌套产物不登记血缘；句柄属于外层函数的 BREP 域；每个几何输入必须带 PartName。优先调用 op，而不是用 kernel 重造；只有 faijs 没有等价 op、任意矩阵变换、或布尔后命名传播时才走 `getBrepApi()`。

## 备选方案

**继续让 `shapeType` 返回 `string`，由每个调用方自己归一。** 不采纳：引擎间不一致已经在 brepkit/smlib 上导致布尔操作数分类错误，而且每个库作者都会重复同样的防御代码。

**为嵌套 op 增加 `withStmt()` 包装。** 不采纳：复现表明不存在语句上下文被破坏；真正的约束是血缘命名与句柄生命周期，二者都可以文档化。

**增加 `cad.pose` 或重写下游导出架构。** 不采纳：建模期姿态属于库的职责，模型终端只是一个同步 Shape。

## 后果

- 下游库可以删除 `toUpperCase()` 与 duck-typing 绕行。
- 把 `shapeType` mock 成大写字面量的测试需要归一。
- sweep/loft 的选项缺口（`scale` / `twist` / `follow` / `loop`）仍然开放；那属于能力开发，不是 API 清晰度问题。