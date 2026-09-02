# Agent Note: API 面补齐 — P14 首片（measurement 模块全量投影，多模块生成器）

Status: implemented

[English](2026-09-02-api-surface-p14-measurement-slice.md) | 中文

## Problem

P13 在 4 个符号的样本片上证明了 E5 生成机制，但投影流水线仍是单模块的（`generate()` 硬编码 `topology`），query 模板只支持一个几何 `Shape` 参数，也还没有任何完整模块被投影。P14 的任务是把机制逐模块铺开：多模块产物、位置泛化的 query 模板（多 `Shape` / `Shape[]` / 数值透传）、以及作为后续批次范式的首块全量投影模块（`operations`、`core`、`sketching`、`2d`、`io`、`gear`、`query`、`projection`、`text`）。

## 决策

- **生成器改为多模块**。`scripts/gen-l3-surface.ts` 暴露纯函数 `generateModule(module)`（CLI `main()` 与测试共用），外加向后兼容的 `generate()` == `topology`。`PROJECTED_MODULES` 决定写哪个 `api/generated/<module>.ts`；每个模块是 `ARG_SPEC` 的一个分片，由条目的 `module` 字段选择（缺省 `topology`，兼容 P13）。
- **query 模板泛化为位置参数**。query 条目声明 `queryParams`（faijs 面形参：名称 + 类型 + 可选 + JSDoc）与 `geometryArgs` / `geometryCollectionArgs`（哪些位置索引是单个 faijs `Shape`，哪些是 `Shape[]` 数组，要被借入 brepjs handle）。非几何参数（数值、选项）原样透传。生成的 faijs 签名与 brepjs 位置一一对应，返回类型显式标注（`returnType`），满足 export-JSDoc 门禁的 `@param`/`@returns` 要求。
- **首片全量模块 = `measurement`**（21 个未排除符号，全是数据查询 + 类型，无 brep-op）。`generated/measurement.ts` 投影 8 个 type re-export（`CurvatureResult`、`DistanceProps`、`InterferencePair`、`InterferenceResult`、`LinearProps`、`PhysicalProps`、`SurfaceProps`、`VolumeProps`）与 12 个 query（`measure*`、`checkInterference`、`checkAllInterferences`），结果的 `Result` 被展开（err → throw），数组输入（`checkAllInterferences`）逐元素借入。
- **1 个 skip 登记**：`createDistanceQuery` 以 kind `skip` + reason 记入 arg-spec——它返回一个有状态的闭包（`distanceTo`/`dispose`），静态 faijs 函数无法建模（需要宿主适配器，不能透传投影）。
- **适配表仍是唯一人工清单**。没有手写包装器；每一行产物都来自 `ARG_SPEC`（现为所有模块的样板）。扩展后的 `surface-mechanism.test.ts` 同步守卫遍历 `PROJECTED_MODULES`，断言 `generateModule(m) ===` 已提交的 `generated/<module>.ts`（漂移即失败），并逐条断言产出形态与类别相符。
- **独立性保留**：新分片**不**从 `api/index.ts` / `api-namespace.ts` re-export —— 接线是 P14/E12 终态；提前暴露会破坏 U7 键集合相等断言（C）。

## 备选方案

- **先投 `operations`（方案名义上的首块）**。本片否决：`operations` 是最大块且混合了几何操作、joint/history/assembly/IO 语义，其分类需按 §5.2 逐模块仲裁；`measurement` 是小而纯的 query 模块——大规模模块前先泛化机制的正确选择。
- **保持单模块 `generate()`，第一片加 `operations.ts`**。否决：后续批次需要的就是 query 位置泛化（多 `Shape`、数组、数值透传）；在 `measurement`（同时覆盖单、双 `Shape` query 与数组 query）上验证模板，比一上来就动重型模块稳。
- **把 skip（`createDistanceQuery`）放进 `upstream-exclusions.json`**。否决：它不是 upstream 排除项，而是投影层的声明式 divergence；记在 `ARG_SPEC` 的 `skip` + `reason` 里，随批次一起可见可审。
- **现在就给 measurement 加运行时（OCCT-wasm）套件**。与 P13 一致地放：运行时执行需要完整宿主装配（内核 + backends + dispatch），那仍属后续接线点；结构/同步门是每批的契约，运行时覆盖随接线一并补。

## 后果

- `generated/measurement.ts` 通过编译，repo `export-jsdoc` 门禁 +0 违规（模板输出显式 `@param`/`@returns`），U8 品牌守卫全绿，core 全量 933 测试绿；门禁既有 91 条基线（主要是 `packages/sheetmetal` JSDoc 欠账）不变且与本片无关。
- 首个完整模块演示了后续批次的分片纪律：纯 query/type 模块不需要 brep-op 专属工作；混合模块（如 `operations`、`io`）复用同一套位置机制，再加各自的 §5.2 仲裁。
- 进度记入方案文档（`P14` 首片标记）。