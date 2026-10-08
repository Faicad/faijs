# faijs FAQ

[English](faq.md) | 中文

> faijs API 面的常见问题。每条回答自包含；权威契约见 [api-contract.zh.md](api-contract.zh.md) 与 [library-dev-guide.zh.md](library-dev-guide.zh.md)。

## Q1: `compatOp` 的含义是什么？

一句话：**compatOp 是把"只有 BREP 实现——输入内核句柄、返回 `Result`——的库函数"包装成 faijs 语句 op 的适配器**——它不是第二条实现路径，而是站在 `defineOp` 之上的薄适配层。源码位置 `packages/core/src/api/internal/compat-op.ts`。

背景——op 三分类（见 `AGENTS.md`）：

| 类型 | 写法 | 链路 | 例子 |
|---|---|---|---|
| dual-op | `defineOp({ mesh, brep })` | mesh + brep 双实现 | `box`、`union`、`knurl` |
| **compat op** | `compatOp(fn, spec)` | **仅 BREP**（mesh 模式抛 `E_MESH_UNSUPPORTED`） | `fuse`、`cut`、`extrude` |
| 纯投影 | re-export，不是 op | — | `Sketcher`、`ok`/`err`、`getFaces` |

为什么存在：op 体系需要一个入口来容纳"只在 BREP 链上有意义的运算"——它们无法提供 mesh 实现，`defineOp({ mesh, brep })` 不适用；compatOp 就是这个唯一入口。

内核引擎：机制本身是内核中立的。适配器经 `getBrepApi()`（引擎中立的 L1 契约 `BrepEngineApi`）调用，已注册的引擎有 `occt`（默认）、`brepkit`、`brep_mock`（见 `brep/engine/types.ts` 的 `BREP_ENGINE_IDS`）。是否限定内核由 `spec.engines` 声明（"平台 op"）；不声明 `engines` 的 op 在任何引擎上都能跑。core 现有的 compat op 之所以都声明 `engines: ["occt"]`，是因为它们的实现调用了 occt-only 的内核方法——这是当前实现的事实，不是 compatOp 机制的限制；在其他引擎下分派这类 op 会在执行前静态报 `E_BREP_UNSUPPORTED`，没有运行时回退。

它只做两件事（其余机制全归 `defineOp` 所有）：

1. **spec 透传**：`CompatSpec` 直接继承 `DualOpOptions`（去掉 mesh/brep 两个字段），`capabilities`/`engines`/`outputs`/`slotMap`/`schema`/`naming` 自动同步——单一事实来源，不自造字段。
2. **适配器构造**（defineOp 无法共享的两个桥接步骤）：
   - **调用 + unwrap**：调用库函数，经共享 `unwrapResult`——`err` 变成携带 op 名 + `BrepError` 码的 `OpError` 抛出；支持 async 库函数（先 await 再 unwrap）。
   - **adoptOut（收编）**：把产物里的顶层内核句柄（或 `outputs` 声明的字段）经 `adoptEntity` 收编为 faijs `Shape`（注销 finalizer + `fromHandle`），并透传调用点的 `segments` 三角化密度。

之后 defineOp 负责其余一切：分派、`DUAL_OP_META` 挂载、`assertLibConforms` 校验。所以 compatOp 产物与 defineOp 产物完全同构。

对脚本开发者的实际意义：`.fai.js` 里调 `cad.fuse(...)` / `cad.cut(...)` / `cad.extrude(...)`，背后就是 compatOp 包装的 brep-only 实现；这些 op 没有 mesh 实现，静态规则分派时 BREP 链不可用就直接报 `E_MESH_UNSUPPORTED`，没有运行时回退。库开发者写第三方 op 时：有 mesh+brep 双实现用 `defineOp`；只有 BREP 实现就用 `compatOp`，边界上的 Result 自动 unwrap。经 `registerLib` 注册的库函数会被 `admitCompatLib` 自动经 compatOp 提升，裸函数无法绕过语句级边界契约。

## Q2: 纯投影和 op 的区别是什么？

核心一句话：**op 是"执行引擎会调度执行的运算"，纯投影只是"TS 层的 re-export/包装函数"——它根本不是 op，不走执行链路。**

| | op（dual-op / compat op） | 纯投影 |
|---|---|---|
| 本质 | `defineOp` / `compatOp` 产生的运算对象，带 `DUAL_OP_META` 元数据 | 普通函数/类的 re-export，无 op 元数据 |
| 执行方式 | 进 faijs 虚拟机执行，语句级调度 | 被调用代码同步直接调用，就是一次普通函数调用 |
| 链路分派 | 经 `backend-dispatch.ts` 按静态规则分派 mesh/brep | 无分派概念——内部爱用什么就用什么 |
| Result 边界 | 语句边界自动 unwrap（err → `failedAt`） | 无语句边界；是 TS 兼容面，Result 原样返回给调用者 |
| 符号表 | 进 `symbol-table.generated.ts`，是脚本面 `cad.<name>` 的合法 op | 不进 op 符号表，脚本面（`.fai.js`）一般看不到它 |
| 典型例子 | `box`、`union`、`fuse`、`extrude`、`knurl` | `Sketcher`/`Blueprint`/`draw` DSL、`ok`/`err`/`isErr` 组合子、`getFaces`/`getEdges` 子形状查询 |

为什么要区分：`cad` 命名空间里除了"几何运算"还有一类东西——查询、组合子、DSL 构造器。它们的共同特征是：

1. **不产生新的几何产物需要引擎计算**——比如 `getFaces(shape)` 只是把已有形状的子形状列出来；`ok`/`err` 是 Result 工具函数，跟几何无关。
2. **不需要 mesh/brep 双实现**——没有"两条链路跑同一个运算"的问题，自然不适用 `defineOp`/`compatOp` 的分派机制。
3. **面向 TS 库开发者，不面向 `.fai.js` 脚本**——纯投影属于"TS 兼容面"：库开发者从 `@faicad/faijs/*` 子路径 import 直接用，调用即执行，返回值不经语句级 unwrap。

判据：这个东西需要引擎在语句执行时算出几何、且可能有 mesh/brep 两种实现 → 是 op（用 `defineOp` 或 `compatOp`）；这个东西只是把已有能力换个名字暴露出去（re-export、查询、工具函数、DSL）→ 是纯投影，直接 re-export，别包成 op。
