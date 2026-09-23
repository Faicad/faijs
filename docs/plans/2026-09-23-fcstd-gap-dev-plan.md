# FCStd 移植功能缺口 · 开发计划（2026-09-23）

> 状态：**方案（未实施，本轮只写方案）**。
> 范围：只排 faijs 侧功能缺口（能力实现），单文件流水线由 fcstd-port 自行负责，与本计划无关。
> 工作方式：**每实现一个功能，只测一个对应的 FCStd 文件**（跑 convert + run + STEP 导出），严禁任何形式的批量扫描/普查。文件即回归锚点：改完功能 → 跑该文件 → 通过即关闭该项。
> 依赖：引擎换版后 fcstd-port 侧 tgz 重装（sha256 校验），与本计划互不阻塞。

---

## 1. 优先级总表

| 优先级 | 缺口编号 | 功能 | faijs 侧改动位置 | 单个测试 FCStd | 通过判据 |
|---|---|---|---|---|---|
| **P0-1** | H13 | `.brp` 资产已含 Placement 时不再发射 `cad.place`（消除双重放置） | `fcstd/feature-translate.ts`（以资产成员是否已变换为准） | `FreeCAD` 样本树 **TO92**（Cut001 资产 bbox z 从 2.8 起，已定位证据） | convert ok + STEP 导出成功 + 与真值对拍 bbox/com 轴序一致（体积/solids 本已一致） |
| **P0-2** | V-C8 | 非实体资产参与布尔时报**带 op 名 + 资产名 + cause** 的显式错误（替换 OCCT 裸文本 `boolean operation failed`） | 平台 op 边界（`api/` 布尔 op 包装） | **Crank.FCStd**（零实体资产样本，56 样本池内） | 该文件错误信息结构化；同时该文件仍能 convert（导入/放置/聚合不受影响） |
| **P0-3** | E3-a | `revolve` 产形 op 建 role table（按 Q13 拍板路线②：调度层统一兜底，或改手写 `defineOp`） | `brep/` 产物登记处统一建表（origin = 语句 LHS） | **ModelFromV021.FCStd**（死在 `cad.revolve` 产物上的 `edgeRef` nameless shape） | convert ok + run 通过；`edge-ref.test.ts` 绊线断言**翻转**（不是删除） |
| **P1-1** | H6 头部 | 参数载体三件套：a) `Spreadsheet::Sheet`/`App::VarSet` 作为被引用数据源过类型检查；b) `<<Label>>.Alias`/`Object.Alias` 三跳解析（Label→对象→alias→单元格→去 `=`，同表地址再跳），值交给已有 `evalConstantExpression`；c) 引用参与算术（657 条） | `fcstd/feature-translate.ts:476`（类型检查）+ `fcstd/expressions.ts`（三跳解析） | `Mechanical Parts/Chains/Sprocket/ISO 606/Simplex ½x¼/`**`Sprocket ANSI simplex ½x¼ z08.FCStd`**（B2 代表样本：Spreadsheet→Pad.Length 绑定 `<<Data>>.Wt`→Pocket 级联，一个文件覆盖 a+b+c） | convert ok（原 gap 的 `type-not-whitelisted` + `pad-length-expression-non-constant` + `pocket-missing-dependency` 三条 reason 同消）+ STEP 导出成功 |
| **P1-2** | H6 尾部 | 函数族 / `cells[...]` 区间：按 `no heuristic fallback` **显式 bake**（禁止静默） | `fcstd/expressions.ts` | 与 P1-1 同文件（其非 Alias 单元格即此形态） | bake 带显式 reason，不静默 |
| **P2-1** | H7 头部 | Part 工作台特征系：`Part::Revolution`/`Part::Fillet`/`Part::Chamfer`（注意与 PartDesign 同名异构） | `fcstd/feature-translate.ts` 白名单 + 翻译分支 | 从 `fcstd-port/reports/batch-report.json` 取首个仅含该 reason 的文件（转换期选点，不跑批量） | convert ok + STEP 导出成功 |
| **P2-2** | H7 | `PartDesign::Groove`（726 对象） | 同上 | 同上取点 | 同上 |
| **P2-3** | H7 | 扫掠/放样/螺旋系（455；需先补内核 op：sweep/loose/helix） | 内核 `api/` + `fcstd/feature-translate.ts` | 同上取点 | 同上 |
| **P2-4** | H7 | `App::Link*`（149）→ 镜像系（461）→ 跨引用系（150）→ 布尔系（96） | `fcstd/feature-translate.ts` | 同上逐类取点 | 同上 |
| **P3-1** | pattern 源 | linear/polar pattern 缺 source 的翻译补齐 | `fcstd/feature-translate.ts` | **Drilling_1.FCStd**（56 样本池，`linear-pattern-missing-source`） | convert ok + STEP 导出成功 |
| **P3-2** | H2 | 缺失约束类型 `15/17/19`（2,599 条） | `lang/sketch-solver.ts:63-78` | **Drilling_1.FCStd**（`unsupported-constraint` 样本） | 草图 L0 或有成因结论；convert ok |
| **P3-3** | H8 | 草图外部几何**弧线投影** | `fcstd/convert.ts:159-175` | **hole_puzzle.FCStd**（`external-geometry-unresolved: no links`） | convert ok + STEP 导出成功 |
| **P3-4** | 求解器 | `sketch-not-solved` / `delta-exceeds-t1`（几何静默降级 L2 → 改显式 gap 或实现，Q10） | `lang/sketch-solver.ts` + `planegcs-backend.ts` | **TestSketchCarbonCopyReverseMapping.FCStd**（`delta-exceeds-t1` + `sketch-not-solved`×3） | L1/L2 每条有成因结论；不静默 |
| **P3-5** | 求解器 | 相切模式（`sketch-not-solved` 单独成因） | 同上 | **TestTangentMode3-0.21.FCStd** | 同上 |
| **P4-1** | H3 | 曲线/Frenet/面附着支撑（平面附着已 ✅） | `fcstd/placement.ts` + `fcstd/attachment.ts` | 从 batch-report 取首个含曲线附着的文件 | 同上 |
| **P4-2** | H4 | Pad/Pocket 尾部 8 条 bake 分支 | `fcstd/feature-translate.ts:442-595` | 从 batch-report 取首个命中尾部分支的文件 | 同上 |
| **P5** | E2 | 纯线框显示网格（内核 `wireframe()` 边通道；**不阻塞 STEP 导出，后置**） | `brep/` + `Shape` 边集承载 | 沿用既有 `load-nonsolid.test.ts` 合成 fixture（无需 FCStd） | 可导入可查询且有显示网格 |

---

## 2. 实施纪律

1. **每项一个文件**：实现前先在对应 FCStd 上跑一次确认失败形态；实现后跑同一文件确认通过。任何时刻只处理一个文件，不批量。
2. **选点规则**：P2/P3/P4 的取点从**已存在的** `fcstd-port/reports/batch-report.json` 里查首个解封文件名（读报表 ≠ 跑批量扫描）；报表没有的就由用户指定。
3. **测试留档**：每项实现伴随 faijs 内合成 fixture 单测（GOTCHA 留档踩坑）；依赖语料的对拍留 fcstd-port 侧。
4. **每项独立提交**，提交信息写明消掉的 reason 名（沿用 conventional commits，`--no-verify`）。
5. **P0 三项先行**：H13 影响所有含 Placement 资产的产物正确性（静默错位），V-C8/E3 是验收判据收尾；P1-1 是单项解封最大的头部（347/878）。

## 3. 验收

逐项关闭：表中每一行在对应文件上 convert ok + STEP 导出成功（P0-1 另加 bbox/com 对拍通过），该项即完成并打勾。全部关闭后，56 样本池的 run 基线应从 41/50 达到 50/0（V-C3 样本口径）。
