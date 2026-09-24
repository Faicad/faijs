# FCStd 移植功能缺口 · 开发计划（2026-09-23）

> 状态：**部分实施中**（第 1 批 4 项已落地，见 §0）。
> 范围：只排 faijs 侧功能缺口（能力实现），单文件流水线由 fcstd-port 自行负责，与本计划无关。
> 工作方式：**每实现一个功能，只测一个对应的 FCStd 文件**（跑 convert + run + STEP 导出），严禁任何形式的批量扫描/普查。文件即回归锚点：改完功能 → 跑该文件 → 通过即关闭该项。
> 依赖：引擎换版后 fcstd-port 侧 tgz 重装（sha256 校验），与本计划互不阻塞（但**每项验收都跑不动**，见 §4 Step 0）。

---

## 0. 进度快照（本轮更新时核对）

### 0.1 已落地（faijs `162e7cb`）

| 项 | 缺口 | 落地内容 | 状态 |
|---|---|---|---|
| P0-1 | H13 | `.brp` 资产已含 Placement 时不再发射 `cad.place`；GOTCHA 单测在 `codegen.test.ts` | ✅ |
| P0-2 | V-C8 | 布尔失败改抛 `OpError('boolean/<op>')`（带输入名 + `cause`），无 handle 输入给结构化 `E_BREP_UNSUPPORTED`；单测 `boolean-vc8.test.ts` | ✅ |
| P0-3 | E3 | 手写 `api/revolve.ts` 建链根 roleTable（`recordOutput` 带 part 参）；`edge-ref` 绊线断言翻转；探针留 `revolve-probe.test.ts` | ✅ |
| P1-1（主体） | H6 头部 | `Spreadsheet::Sheet`/`App::VarSet` 作为被引用数据源过类型检查；`<<Label>>.Alias` 三跳解析 + 引用算术（`expressions.ts` 的 `evalWithDoc` / `spreadsheetAliasValue`）；Sprocket z08 上 `type-not-whitelisted` + `pad-length-expression-non-constant` + `pocket-missing-dependency` 三条 reason 同消 | ⏳ **残留 `pocket-midplane-unsupported`** → 拆出 P1-1b |

> 注：上一轮汇报里的提交号 `a9c7515` 在 faijs 仓库查不到；实际落地提交是 `162e7cb`（`fix(core): FCStd gap fixes — H13 double placement, V-C8 boolean errors, E3 revolve roles, P1-1 parameter carriers`）。以仓库为准。

### 0.2 本轮新增的判据来源（只读既有报表，未跑批量）

- `fcstd-port/reports/run-sweep.json`（2,323 个 product 的 run 结果，引擎 0.13.2）
- `fcstd-port/reports/batch-report.json`（3,201 个 FCStd 的 convert 结果，引擎 0.13.2）
- `fcstd-port/reports/reason-cascade.md`、`reports/status.md`、`reports/library-profile.json`

**关键发现：原表列的全部是 convert 期缺口，而 run 期失败（1,075 条）里约 96% 是两类内核/翻译缺陷，且都不在原表上。优先级需要重排。**

---

## 1. run 期失败结构（先把最大的坑排进来）

| 类别 | 条数 | 错误信息 | 归属 |
|---|---|---|---|
| `E_EXTRUDE_ZERO_VECTOR` | **918** | `Execution failed at statement N (callee: extrude): … E_EXTRUDE_ZERO_VECTOR` | **新 P0-4 / E4** |
| `edgeRef: input shape has no role table (nameless shape)` | **120**（fillet 91 / chamfer 29） | 见 §1.2 | **新 P0-5 / E3-b** |
| `REVOLVE_FAILED`（`[faijs/brepjs-compat] revolve`） | 9 | 旋转体本身失败 | 后置 |
| timeout（120 s） | 13 |  | 后置 |
| 其余未分类（含 1 条 `SEC_FREE_IDENT`） | ~15 |  | 后置 |

口径：`run-sweep.json` counts = run-fail 1,075 / ok 1,226 / failed 9 / timeout 13；上表按 error 串归类，两类主因合计 **1,038 条 ≈ run-fail 的 96%**。

### 1.1 E4 根因（已用真值对拍确认）

零向量全部来自 `Part::Extrusion`，**不是 Pad/Pocket**。语料里 `Part::Extrusion` 有三种序列化形态，当前代码只认第三种（语料里几乎不存在）：

| 形态 | 属性 | 抽样对象数（61 文件内） | 当前行为 |
|---|---|---|---|
| 新格式 | `LengthFwd`（+`LengthRev`）+ **单位** `Dir` | 626（其中仅 `LengthFwd` 28） | `Length` 缺失 → `len = 0` → 零向量 |
| 老格式 | 只有 `Dir`，`\|Dir\|` **即长度** | 76 | 同上 |
| 旧格式 | `Length` + `Dir` | ~0 | 现行为正确 |

代码位置：`feature-translate.ts:865-880`（`const len = propNum(obj, 'Length') ?? 0;`）。`LengthFwd` / `LengthRev` / `Symmetric` / `TaperAngle` 全仓无引用（grep 只命中 `propVec(obj,'Dir')`）。

真值印证：`Flat Bar 130x25 EN10058 S235JR` 的 `Dir = (0,0,50)` 且**无** `Length`；其 FCStd 真值 `truth.json` 为 `volume = 162500 = 130 × 25 × 50`、`bbox z: 0 → 50` → **挤出长度就是 `|Dir| = 50`**。

### 1.2 E3-b 根因

`api/extrude.ts` 两个分支都用 `fromBrep(..., { roleTable })` 登记角色表 —— 这正是 E3 在 revolve 上踩过的坑（GOTCHA：对已 `adoptEntity` 的产物再走一次 `fromBrep`，同语句 `registeredStmtId` 去重会把第二次登记吞掉；revolve 已改为 `runtimeLineage.recordOutput(origin, table, handle, part)`）。
样本 `DIN93_M18TabWasher` 的产物源码：`part1 = cad.extrude(part0,[0,0,1])` → `part2 = cad.fillet(part1, { edges: [cad.edgeRef(part1, 8), …] })` 报 nameless shape。
→ extrude（及同类「委托投影产形」op）需要按同一套 `recordOutput(…, part)` 修法；`import-brep` / `.brp` 资产通路同样要审计。

### 1.3 convert 期剩余结构（`batch-report.json`）

- gap 878 / ok 2,323。`type-not-whitelisted` 共 801 objects，按类型拆（byType 合计正好 801）：
  - `Spreadsheet::Sheet 576` + `App::VarSet 39` → **P1-1 已覆盖**；
  - `TechDraw::* 81`、`Drawing::* 20`、`Image::ImagePlane 42`、`Mesh::Feature 30`、`App::MeasureDistance 9`、`App::LinkGroup 4` → **非几何对象，应归 preserved 而非 gap（新增 P1-3）**。
- 桶（reasonKeys 组合）前几位，以及 P1-1 之后各自的剩余阻塞：

| 桶文件数 | reasonKeys | P1-1 之后的剩余阻塞 |
|---|---|---|
| 320 | `pad-length + pocket-missing-dependency + type-not-whitelisted` | 已清（残留 midplane → P1-1b） |
| 113 | 同上 + `polar-pattern-missing-source` | **pattern source（P3-1）** |
| 45 | `sketch-not-solved` | **P3-4** |
| 40 | 仅 `type-not-whitelisted`（例 `Profile HEA.FCStd`） | **P1-3**（大概率） |
| 30 | `pad-length + pocket-midplane-unsupported + type-not-whitelisted` | **P1-1b** |
| 25 / 16 / 8 | `external-geometry-unresolved` / polar pattern / linear pattern | P3-3 / P3-1 |

- `reason-cascade.md` 组合口径：参数三件套 + pocket 清账 = 347 文件（39.5%），仍是 convert 侧单项最大头；`pocket-midplane-unsupported` 单轮直接解封 33。

---

## 2. 优先级总表（更新后）

图例：✅ 已落地 · ⏳ 部分 · ▶ 下一步主推 · 其余保留原编号

| 优先级 | 缺口编号 | 功能 | faijs 侧改动位置 | 单个测试 FCStd | 通过判据 |
|---|---|---|---|---|---|
| **P0-1** | H13 | `.brp` 资产已含 Placement 时不再发射 `cad.place` | `fcstd/feature-translate.ts`（以资产成员是否已变换为准） | FreeCAD 样本树 **TO92** | ✅ convert ok + STEP + bbox/com 对拍 |
| **P0-2** | V-C8 | 非实体资产参与布尔时报带 op 名 + 资产名 + cause 的结构化错误 | `api/boolean.ts` + `OpError({cause})` | **Crank.FCStd** | ✅ 错误信息结构化，仍能 convert |
| **P0-3** | E3 | `revolve` 产形 op 建 role table | `api/revolve.ts`（`recordOutput` 带 part） | **ModelFromV021.FCStd** | ✅ convert + run 通过，绊线断言翻转 |
| **P0-4（新）** ▶ | **E4** | `Part::Extrusion` 长度语义：`LengthFwd/LengthRev`（含 `Symmetric`/`Reversed`）优先；无 `Length*` 时 `Dir` 即挤出向量；`TaperAngle≠0` 显式 bake | `fcstd/feature-translate.ts:865-880` | **`Mechanical Parts/Profiles EN/EN10058 Flat steel bars/Flat Bar 130x25 EN10058 S235JR.FCStd`**（真值 vol 162500 / bbox z 0–50） | convert ok + run ok + STEP 导出 + 与 truth.json 体积/bbox 一致（1e-5） |
| **P0-5（新）** ▶ | **E3-b** | `cad.extrude`（及同类委托投影产形 op）的 role table 改走 `recordOutput(origin, table, handle, part)`；顺带审计 `import-brep` / `.brp` 资产通路 | `api/extrude.ts:439/453`、`api/import-brep.ts` | **DIN93_M18TabWasher.FCStd**（run-sweep 中 nameless-shape 首例） | run 通过（fillet/chamfer 的 edgeRef 解析成功）+ STEP 导出 |
| **P1-1** | H6 头部 | 参数载体三件套（类型放行 + 三跳解析 + 引用算术） | `feature-translate.ts:476` + `expressions.ts` | Sprocket ANSI simplex ½x¼ **z08** | ⏳ 三条 reason 已消，**被 P1-1b 卡住** |
| **P1-1b（新）** ▶ | H6 残留 | **Pocket Midplane**：对称切除（±len/2 两段棱柱 ∪ 后 subtract，与已实现的 Pad Midplane 同构） | `feature-translate.ts:849` | 同 **z08** | convert ok（无 gap）+ STEP；连带 30 文件桶 + 33 直接解封 |
| **P1-2** | H6 尾部 | 函数族 / `cells[...]` 区间：**显式 bake**（禁止静默） | `expressions.ts`（`evalArithmetic` 已返回 undefined，需补独立 reason + 单测） | 与 P1-1 同文件（其非 Alias 单元格即此形态） | bake 带显式 reason，不静默 |
| **P1-3（新）** ▶ | H7 旁支 | 非几何类型归 preserved（不记 gap）：`TechDraw::*`、`Drawing::*`、`Image::ImagePlane`、`Mesh::Feature`、`App::MeasureDistance`、`App::LinkGroup` | `fcstd/feature-translate.ts` 白名单 + preserved 分类（与 P1-1 同构） | **`Architectural Parts/Beams/Profile HEA.FCStd`**（40 文件桶首例） | 该文件 convert ok（或仅剩真实几何原因）+ 报表 `type-not-whitelisted` 对象数下降 |
| **P2-1** | H7 头部 | Part 工作台特征系：`Part::Revolution` / `Part::Fillet` / `Part::Chamfer` | 白名单 + 翻译分支 | 取点需复核（见 §3 注） | convert ok + STEP |
| **P2-2** | H7 | `PartDesign::Groove`（画像 726 对象） | 同上 | 同 §3 取点规则 | convert ok + STEP |
| **P2-3** | H7 | 扫掠/放样/螺旋系（455；需先补内核 op） | 内核 `api/` + 翻译 | 同上 | 同上 |
| **P2-4** | H7 | `App::Link*` → 镜像系 → 跨引用系 → 布尔系 | `feature-translate.ts` | 同上 | 同上 |
| **P3-1** ▶ | pattern 源 | linear/polar pattern 缺 source 的翻译补齐 | `feature-translate.ts` | **Drilling_1.FCStd**（linear）+ `Electrical Parts/Servos/Emax-ES08A/servo-rounded-horn.fcstd`（polar，16 文件桶首例） | convert ok + STEP |
| **P3-2** | H2 | 缺失约束类型 `15/17/19` | `lang/sketch-solver.ts:63-78` | **Drilling_1.FCStd** | L0 或有成因结论 |
| **P3-3** | H8 | 草图外部几何弧线投影 | `fcstd/convert.ts:159-175` | **hole_puzzle.FCStd** | convert ok + STEP |
| **P3-4** ▶ | 求解器 | `sketch-not-solved` / `delta-exceeds-t1`（L2 静默降级 → 显式 gap 或实现） | `sketch-solver.ts` + `planegcs-backend.ts` | **`Architectural Parts/Building Construction/Slab adjustable scaffolder.FCStd`**（45 文件桶首例） | 每条有成因结论，不静默 |
| **P3-5** | 求解器 | 相切模式 | 同上 | **TestTangentMode3-0.21.FCStd** | 同上 |
| **P4-1** | H3 | 曲线/Frenet/面附着支撑（平面附着已 ✅） | `placement.ts` + `attachment.ts` | 取点 | convert ok + STEP |
| **P4-2** | H4 | Pad/Pocket 尾部 8 条 bake 分支 | `feature-translate.ts:442-595` | 取点 | 同上 |
| **P5** | E2 | 纯线框显示网格（不阻塞 STEP，后置） | `brep/` + `Shape` 边集 | 沿用 `load-nonsolid.test.ts` fixture | 可导入可查询且有显示网格 |

---

## 3. 实施纪律（沿用 + 本轮补充）

1. **每项一个文件**：实现前先在对应 FCStd 上跑一次确认失败形态；实现后跑同一文件确认通过。任何时刻只处理一个文件，不批量。
2. **选点规则**：P2/P3/P4 的取点从**已存在的** `fcstd-port/reports/batch-report.json` / `run-sweep.json` 里查首个解封文件名（读报表 ≠ 跑批量扫描）；报表没有的就由用户指定。
3. **测试留档**：每项实现伴随 faijs 内合成 fixture 单测（GOTCHA 留档踩坑）；依赖语料的对拍留 fcstd-port 侧。
4. **每项独立提交**，提交信息写明消掉的 reason 名（conventional commits，`--no-verify`）。
5. **先 run 期、后 convert 期**：E4（918）+ E3-b（120）合计覆盖 run-fail 的 96%，且都是单点修法，优先于任何 convert 期白名单扩展。
6. **注（P2 取点需复核）**：`batch-report.json` 的 `byType`（`type-not-whitelisted` 的 801 objects）里**没有** `Part::Revolution`（画像 425 对象）与 `PartDesign::Groove`（画像 726 对象）。取点时必须先在单个样本上确认它到底报哪条 reason，再决定 P2-1/P2-2 的改法与规模；**不要按画像里的对象数估工作量**。

---

## 4. 下一步开发步骤（按序，一次一项）

**Step 0（前置，非功能项）**
- faijs：`npm run build -w @faicad/faijs`（当前 `packages/core/dist` 停在 09-23 01:13，**不含** `162e7cb` 的改动 —— `dist/fcstd/feature-translate.js` 里 grep 不到 `docContext`）；`npm pack` 出 0.14.x tgz。
- fcstd-port：`npm i ../faijs/packages/core/faicad-faijs-<ver>.tgz`（当前装的是 **0.13.2**，落后两个版本），记 sha256。
- 然后单文件复核已落地的 4 项：TO92 / Crank / ModelFromV021 / Sprocket z08（convert + run + STEP）。
- **不做完 Step 0，后面每一项的判据都跑不出来**（fcstd-port 走 `@faicad/faijs/node`，只吃发布包）。

**Step 1 — P0-4 / E4：`Part::Extrusion` 长度语义**（`feature-translate.ts:865-880`）
① 有 `LengthFwd` → 沿 `Dir` 正向 `LengthFwd`、反向 `LengthRev`（缺省 0）；`Symmetric`（两侧同为 LengthFwd）/ `Reversed`（前后互换）按 FreeCAD 语义处理；② 无 `Length*` → `Dir` **整体**即挤出向量（`|Dir|` 为长度，方向取 normalize）；③ 保留旧 `Length` 兜底；④ `TaperAngle ≠ 0` 显式 bake（当前被静默忽略，属 no-heuristic-fallback 违规）。
样本：`Flat Bar 130x25 EN10058 S235JR.FCStd`，对拍 `out/per-file/<stem>/truth.json`（vol 162500、bbox z 0→50）。

**Step 2 — P0-5 / E3-b：extrude 的 role table 登记**
照 `api/revolve.ts:148-156` 的修法改 `runtimeLineage.recordOutput(origin, table, handle, part)`，不经过二次 `fromBrep`。先加探针单测复现「part 键表为空」，再改。
样本：`DIN93_M18TabWasher.FCStd`（fillet 报 nameless）；改完再取一个 chamfer 样本（29 条那一类）复核。

**Step 3 — P1-1b：Pocket Midplane**
照 `PartDesign::Pad` 的 midplane 分支（`feature-translate.ts:746-756`）做对称切除：两段 `cad.extrude`（±len/2）→ `cad.union` → `cad.subtract(base, cut)`。
样本：Sprocket z08（顺带把 P1-1 的判据收口）。

**Step 4 — P3-1：pattern source（polar 172 / linear 45）**
解封 113 + 16 + 8 三个桶。样本：Drilling_1（linear）、servo-rounded-horn（polar）。

**Step 5 — P1-3：非几何类型归 preserved**
与 P1-1 同构的分类扩展，清掉 40 文件桶的主体与 `type-not-whitelisted` 里约 186 个非几何对象。样本：`Profile HEA.FCStd`（先确认其具体类型落在本清单内）。

**Step 6 — P3-4 / P3-2**：sketch 求解器（45 文件桶 + `delta-exceeds-t1` 显式化；约束类型 15/17/19）
**Step 7 — P3-3**：外部几何弧线投影（25）
**Step 8 — P2-* / P4-* / P5**：Part 工作台特征系、Groove、sweep/loft、Link 系、曲线附着、线框显示；每项取点前先按 §3 注做单文件确认。

---

## 5. 验收口径（更新）

- 逐项关闭：表中每一行在对应文件上 convert ok（无 gap）+ run ok + STEP 落盘；P0-1 / P0-4 另加与 `truth.json` 的 volume/bbox 对拍（1e-5）。
- **不再用「56 样本池 41/50」当主口径**（样本太小、与全量脱节）。改用 `fcstd-port` 的 `state/manifest.jsonl` + `reports/run-sweep.json`：
  - 基线（引擎 0.13.2，2,323 product）：ok 1,226 / run-fail 1,075 / failed 9 / timeout 13。
  - Step 1 + Step 2 完成后，预期 run-fail 从 1,075 降到 ~50 量级（剩余 revolve 9 + timeout 13 + 未分类 ~15 + 新暴露的少量真差异）。
  - convert 侧以 `batch-report.json` 的 gap 878 为基线，按 §1.3 的桶逐轮下降（P1-1b 33、P3-1 ~137、P1-3 ~186 objects…）。
- 全部关闭 ≠ 结束：真差异（几何静默降级）必须显式留 reason，不允许靠放宽阈值变绿。
