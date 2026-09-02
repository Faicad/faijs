# Agent Note: API 面补齐 — P14 首片（measurement 模块全量投影，多模块生成器）

Status: implemented

[English](2026-09-02-api-surface-p14-measurement-slice.md) | 中文

## Problem

P13 在 4 个符号的样本片上证明了 E5 生成机制，但投影流水线仍是单模块的（`generate()` 硬编码 `topology`），query 模板只支持一个几何 `Shape` 参数，也还没有任何完整模块被投影。P14 的任务是把机制逐模块铺开：多模块产物、位置泛化的 query 模板（多 `Shape` / `Shape[]` / 数值透传）、以及作为后续批次范式的首块全量投影模块（`operations`、`core`、`sketching`、`2d`、`io`、`gear`、`query`、`projection`、`text`）。

## 决策

- **生成器改为多模块**。`scripts/gen-l3-surface.ts` 暴露纯函数 `generateModule(module)`（CLI `main()` 与测试共用），外加向后兼容的 `generate()` == `topology`。`PROJECTED_MODULES` 决定写哪个 `api/generated/<module>.ts`；每个模块是 `ARG_SPEC` 的一个分片，由条目的 `module` 字段选择（缺省 `topology`，兼容 P13）。
- **query 模板泛化为位置参数**。query 条目声明 `queryParams`（faijs 面形参：名称 + 类型 + 可选 + JSDoc）与 `geometryArgs` / `geometryCollectionArgs`（哪些位置索引是单个 faijs `Shape`，哪些是 `Shape[]` 数组，要被借入 brepjs handle）。非几何参数（数值、选项）原样透传。生成的 faijs 签名与 brepjs 位置一一对应，返回类型显式标注（`returnType`），满足 export-JSDoc 门禁的 `@param`/`@returns` 要求。
- **首片全量模块 = `measurement`**（21 个未排除符号，全是数据查询 + 类型，无 brep-op）。`generated/measurement.ts` 投影 8 个 type re-export（`CurvatureResult`、`DistanceProps`、`InterferencePair`、`InterferenceResult`、`LinearProps`、`PhysicalProps`、`SurfaceProps`、`VolumeProps`）与 12 个 query（`measure*`、`checkInterference`、`checkAllInterferences`），结果的 `Result` 被展开（err → throw），数组输入（`checkAllInterferences`）逐元素借入。
- **后续批次补投小纯模块**：`text`（5 个投影：`fontMetrics`、`getFont`、`textMetrics` + 2 个度量类型；3 个 skip）与 `projection`（4 个纯相机/平面函数 + 3 个类型；2 个 skip）。这两个模块零新增机制地验证 `pure`（值）与 `type` 投影路径——没有 brep-op、没有 query。skip 记录了「静态 faijs 函数无法忠实建模」的类别：`loadFont`（fetch + 全局注册表副作用——需要宿主字体源）、`sketchText`/`textBlueprints`（返回 brep 侧 DSL 对象，依赖已加载字体注册表）、`projectEdges`/`makeProjectedEdges`（返回克隆 `Edge[]` 句柄数组 + 逐结果 compound 生命周期——faijs 还没有多产物收养模型）。每条 skip 都带 `reason`，divergence 可见可审而非静默。进度：text 5 + 3 skip（= 8 个已入册，与 `upstream-surface.json` 完全对账），projection 7 + 2 skip（= 9 个已入册）。
- **第三批补投 `query` 模块**（14 个符号：8 个 type re-export + 6 个 skip）。finder 家族（`edgeFinder`/`faceFinder`/`wireFinder`/`vertexFinder`/`cornerFinder`、`getSingleFace`）是状态化链式构建工具，与 `createDistanceQuery` 同类：每个工厂返回带闭包状态的 `ShapeFinder` DSL 对象，静态 faijs 函数无法忠实建模生命周期——6 个值全部登记 `skip` + `reason`。8 个类型导出（`EdgeFinderFn`、`FaceFinderFn`、`ShapeFinder`、`SingleFace`、`CornerFilter` 等）照常 re-export：它们是可复用查询契约的类型形态，本身没有运行时语义。
- **第四批补投 `ns` 模块**（9 个符号，全部 `pure`）。它们都是命名空间对象：vendored 根 barrel 以 `export * as booleans from './ns/booleans.js'` 聚合各子模块，所以 surface 记录里的 `file`（`./ns/booleans.js`）指向子模块，而真正的导出值在根 barrel 上。适配表因此把 `source` 指向根 barrel（`index.js#booleans`），产物 re-export 整个命名空间对象（`export { booleans } from …/index.js`）而非摊平成员——保持 brepjs 的组织形态（用户代码原样访问 `booleans.fuse(…)`），零新增机制：`pure` 模板本已处理普通 re-export，只有 `source` 目标不同。进度：ns 9/9 已入册。
- **第五批补投 `gear` 模块**（17 个符号：11 个 type re-export + 3 个 `pure` + 3 个 skip）。pure 成员是纯数学/校验助手（`gearGeometry`、`planetPlacements`、`validatePlanetary`）——无 Shape 参数，直接透传。三个 `make*Gear` 构造器带 reason 跳过，扩展了「复合结果」类别：它们各自返回 `Result` 包裹多个 BREP 句柄（`GearResult` = 一个 solid + 若干计量直径；`PlanetaryGearAssembly` = sun + planets[] + ring），现有 ops 模板无法承载——`brep-op` 只收养单产物、`query` 只返回标量/数组，多句柄对象结果需要宿主侧收养模型（与 `makeProjectedEdges`/`projectEdges` skip 同一种缺口）。类型面仍然投影，所以 faijs 今天就能给齿轮结果做类型标注；构造齿轮推迟到 E12 接线点。进度：gear 14 + 3 skip = 17/17 已入册。
- **第六批补投 `2d` 模块**（45 个符号：12 个 type re-export + 33 个 skip）。`2d` 模块是「2D 制图框架」整体：值侧工厂/变换/布尔助手全部消费或返回 kernel-句柄包装对象（`Curve2D`/`Blueprint`/`Blueprints`），形成互相咬合的 DSL（createBlueprint → 变换 → sketchOnPlane2D），并带 `registerForCleanup` 装饰的生命周期。这些 2D 对象不是 faijs `Shape`，既不符合单产物收养（brep-op）模板、也不符合标量/数组（query）模板；朴素 re-export 会把带自有 dispose 的 kernel 句柄对象漏到 faijs 面。因此值侧全部 `skip` + reason，待宿主侧 2D 接入（E12）承载生命周期；12 个类型照常 re-export，供用户今天就能对宿主提供的 2D 数据做类型标注。进度：2d 12 + 33 skip = 45/45 已入册。
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