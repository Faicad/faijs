# Agent Note: 库层面不再有任何 mesh 聚合对象

Status: implemented

[English](2026-10-06-remove-library-face-mesh-aggregate.md) | 中文

## Problem

`packages/core/src/mesh/index.ts` 曾导出 `cad`：一个把 mesh/BREP 实现聚合起来的对象，38 个键，经 `packages/core/src/index.ts` 与 `packages/core/src/browser.ts` 两处 re-export 出现在包根公开面上。

这个名字属于脚本面。脚本面的 `cad` 由宿主自己注入——`registerLib('cad', createApiNamespace(), { default: true })`——那个命名空间承载的是 95 个 op 的面。库层面的导出键集不同、参数形态也不同：它的 `cylinder({ radius, height, at, centered, segments })` 对象形态早已从脚本面移除。于是 TS 消费者若拿这个导出做能力探测，读到的是一份脚本永远看不到的面。

仓库内有 9 处调用点消费这个聚合：`packages/core/src/api/` 下 8 个文件，以及 `packages/faijs-extra/src/mesh/index.ts`（把它重新聚合为 `editorCad`）。另有 2 个 core 测试文件直接 import。同仓的 `3d_editor` 应用产品代码、以及其他所有下游库，一处都没有用它。

只把导出的名字改掉——本改动的第一次尝试——并不能消除危害：那个"这个引擎能做什么"的答案错误的对象仍在，仍能被深层 import，只是换了张皮。

## Decision

**库层面不以任何名字定义聚合对象。** `cad` 只指脚本面。

- `packages/core/src/mesh/index.ts` 只做 mesh 各模块的 re-export，不定义对象。文件头写明每一层的导入目标：`mesh/primitives`、`mesh/transform`、`mesh/boolean`、`mesh/engrave`、`mesh/query`、`mesh/io`、`brep`、`brep/primitives-brep`。
- `packages/core/src/index.ts` 与 `packages/core/src/browser.ts` 既不导出 `cad`，也不导出 `meshCad`。
- `packages/core/src/api/` 下 8 个文件改为导入模块命名空间——`meshPrimitives`、`meshTransform`、`meshBoolean`、`meshEngrave`、`meshQuery`——并经它们调用。每个 op 对内核的依赖现在读作一行 import 语句，任何文件都无法在不说清"键来自哪个模块"的情况下取到它。
- `packages/faijs-extra/src/mesh/index.ts` 删除；包入口按名字逐个导出实现，其中 `split` 以 `meshSplit` 重新导出，即聚合此前以 `fai_split` 携带的那个实现。
- 2 个 core 测试文件改为从具体模块导入。
- `AGENTS.md` 新增章节区分两类读者：脚本开发者只认宿主注入的 `cad` 命名空间；库开发者只认具名模块导入。该章节写明 `packages/core/src/mesh/` 里不存在"什么都有的那个对象"，找不到它是预期结果，不是缺 API。

## Alternatives considered

**把导出改名为 `meshCad`，继续公开。** 拒绝：改名消除的是撞名，不是危害。一个形似"引擎全套 API"的对象仍可被深层 import，下一个用它做探测的消费者只会换个名字重犯同样的错。

**把聚合挪到入口不导出的模块里。** 拒绝：`@faicad/faijs-extra` 跨包把这个对象重新聚合过，所以它无论如何都要能从 core 之外够到。该选项实际退化为删除。

**删掉导出，但 8 个内部调用点继续用这个对象。** 拒绝：对象会作为内核的私有门面存活下来，同样招致误读；改成模块导入本就是同文件内的同一批编辑。

**只在文档里立规矩，不改代码。** 拒绝：散文约束不住一次深层 import，而导出只要还在，就持续与它所违反的规矩相矛盾。

## Consequences

- 移除公开导出对任何曾 import 它的使用者都是破坏性变更；本仓"不考虑向后兼容"的规矩适用，因此不提供兼容垫片。升级后仍 import 该聚合的消费者会编译失败——这正是预期效果。
- 脚本面完全未动。`.fai.js` 脚本里的 `cad.box(...)` 解析到宿主注入的 op 命名空间，其实现路径不变，脚本文本无需改写。
- `@faicad/faijs-extra` 的入口面变化：实现改为具名导出，`editorCad` 消失。扩展库的 API 覆盖基线随之删掉该条目。
- 同仓 `3d_editor` 应用的测试文件仍在 import 被移除的名字；它们在应用侧对照重建的 tarball 改写。
