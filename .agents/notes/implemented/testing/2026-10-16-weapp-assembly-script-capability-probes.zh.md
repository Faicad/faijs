# Agent Note: 小程序装配脚本能力探针

Status: implemented

[English](2026-10-16-weapp-assembly-script-capability-probes.md) | 中文

## Problem

一个下游消费方（`3d_editor` 里的小程序装配/动画工作台）建立在三项 faijs 能力之上，而这三项此前**都只是读码结论，没有一条测试验证过**：

1. **`interpreter` 后端下的多文件工程。** 小程序 worker 禁 eval，因此被钉死在 `execBackend: 'interpreter'`。多文件装载在 `DirectExecutor`（`executeDirectText` → `loadDirectModuleImports`），纸面上与后端无关——但既有覆盖是分裂的：`packages/tests/faijs/no-ir/multifile/multifile.test.ts` 只跑**默认后端**的多文件，`exec-backend-diff.test.ts` 只跑**单模块**的 vm × interpreter。两者的交集无人测过，而下游设计把它列为头号风险。
2. **宿主注入的命名空间可免 `import` 使用。** 预期 `registerLib(binding, ns)` 之后 `anim.foo(...)` 无需 `import * as anim from '...'` 即可解析，但既有测试无一例外仍写着 import 行。
3. **`cad.assembly({ members })` 消费其成员。** 下游设计把它当作"装配节与运动节必须同处一个脚本"的三条依据之一（「拆了脚本，动画脚本就再也 import 不到成员几何」）。

## Decision

把三项都钉成长期测试，并在实测与论断不符处修正下游论断。

- `packages/core/test/cad-runtime/exec-backend-multifile.test.ts`（8 例）——多文件 × 后端：named import、命名空间 import、被消费者不给导出、缺失模块、vm × interpreter 逐项 parity、`entryKey` 决定相对解析基准。
- `packages/core/test/cad-runtime/lib-namespace-implicit.test.ts`（4 例）——interpreter 后端的隐式命名空间绑定、显式 import 仍可用、未注册名被拒、同一隐式形态在 vm 后端也成立。
- `packages/tests/faijs/no-ir/multifile/multifile.test.ts` 的 A-11（4 例）——`cad.assembly({ members })` 对导出面的影响，两个方向都钉，外加一个 `translate` 对照。

## Key findings

- **多文件装载在 `interpreter` 后端上行为完全一致**——导入解析、导出面、失败消息都与 vm 相同，`entryKey` 亦同。下游设计的头号风险解除。
- **隐式命名空间绑定可用**，显式 import 同样可用（同一机制的两条入口，不是兼容层）。**未注册**的名字在**解析期**即被拒：`ParseError: [security] SEC_FREE_IDENT ... unknown identifier "foo"`——比执行期 `failedAt` 更早、更响亮。
- **`cad.assembly({ members })` 并不消费其成员。** 本模块声明的 shape 与 import 绑定在被 `cad.assembly` 引用后，都**仍可**被下游模块 import。这与 `live-shapes.test.ts` 已有的注释一致（「compound members 组装不是消费」）——`cad.assembly` 走 compound 路径。因此下游设计"合并装配节与运动节"的第三条依据是**错误类比**（把 `translate` 的消费语义套到 assembly 上），已删除；余下两条依据（`validateJointRefs` 要求成员集闭合、`ExecutionResult.assemblies` 只从主模块 ctx 收集）仍然成立。
- 对照：`translate` 的消费**确实**会把 shape 从导出面移除。消费规则本身完好——只是不适用于 `cad.assembly`。

## Alternatives considered

- **复用 `multifile.test.ts` 覆盖 interpreter 矩阵**：否决——该文件按构造就跑在默认后端上，硬塞一个后端轴会把两个不同的不变量糅进一个文件。新文件把交集显式写出来。
- **在宿主层（weapp / platform）而非 faijs 层做探针**：否决——这些问题是 faijs 自己的契约（模块装载、命名空间解析、存活 shape 导出面）。宿主层测试得重建一遍脚手架，且钉的是宿主行为而非引擎行为。
- **因 args 里有顶层 var-ref 就把 `cad.assembly` 的成员引用当作消费**：实测后否决——compound 路径把装配引用归类为装配，不是消费。留着错误论断等于把一个假约束编码进下游设计。

## Consequences

- 三个新增/扩展的测试文件纳入既有套件（`test -w @faicad/faijs`、`test -w @faicad/faijs-tests`）；未改任何生产源码，未动依赖。
- 一份下游设计文档已修正：第三条依据删除，其事实表与风险表改为实测语义。
- 此后问"多文件能否扛住 interpreter 后端"或"宿主注入的命名空间能否省掉 import"，拿到的是可执行的答案，而不是读码结论。
