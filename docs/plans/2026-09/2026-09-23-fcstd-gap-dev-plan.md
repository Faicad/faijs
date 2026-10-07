# FCStd 移植功能缺口 · 开发计划（2026-09-23 制定，2026-09-24 状态校正）

> **⚠️ 文档状态（2026-09-24 校正）**：本计划制定时基于引擎 **0.13.2** 的报表
> （`fcstd-port/reports/run-sweep.json`、`batch-report.json`）。截至本日，faijs 已发布
> 到 **0.15.1**，期间落地了 P0-4/P0-5/P1-1b/P3-1/P1-3/P2-2/P3-2/P3-3/P3-4 及整条
> Part 工作台特征链（P6–P9 + Mirroring）。**原始报表数字（run-fail 1,075、E4 918、
> E3-b 120、convert gap 878）已全部失效，需以 0.15.1 重新测量**（见 §6）。本文 §0/§2
> 的状态列为当前真实状态；§1 的历史根因分析保留作"为何这么修"的记录，但根因已修复。

---

## 0. 进度快照（当前真实状态，2026-09-24）

### 0.1 已落地（按真实提交号）

| 项 | 缺口 | 落地内容 | 提交 | 状态 |
|---|---|---|---|---|
| P0-1 | H13 | `.brp` 资产已含 Placement 时不再发射 `cad.place`；GOTCHA 单测 `codegen.test.ts` | `162e7cb` | ✅ |
| P0-2 | V-C8 | 布尔失败改抛 `OpError('boolean/<op>')`（带输入名 + `cause`）；结构化 `E_BREP_UNSUPPORTED`；单测 `boolean-vc8.test.ts` | `162e7cb` | ✅ |
| P0-3 | E3 | 手写 `api/revolve.ts` 建链根 roleTable（`recordOutput` 带 part）；`edge-ref` 绊线翻转；探针 `revolve-probe.test.ts` | `162e7cb` | ✅ |
| **P0-4** | **E4** | `Part::Extrusion` 长度语义：`LengthFwd/LengthRev`（含 `Symmetric`/`Reversed`）优先；无 `Length*` 时 `Dir` 即挤出向量；`TaperAngle≠0` 显式 bake；旧 `Length` 兜底 | `1ba7a15` | ✅ |
| **P0-5** | **E3-b** | `api/extrude.ts` 两分支 role table 改走 `runtimeLineage.recordOutput(origin, table, handle, part)`，不再二次 `fromBrep`；单测 `extrude-roles.test.ts` | `8b7a0d3`（验证 `2251428`） | ✅ |
| P1-1 | H6 头部 | `Spreadsheet::Sheet`/`App::VarSet` 类型放行 + `<<Label>>.Alias` 三跳解析 + 引用算术（`packages/fcstd/src/expressions.ts` 的 `evalWithDoc` / `spreadsheetAliasValue`） | `162e7cb` | ✅ |
| P1-1b | H6 残留 | `Pocket Midplane`：对称切除（±len/2 两段棱柱 ∪ 后 subtract，与 Pad Midplane 同构） | `1ba7a15` | ✅ |
| P1-2 | H6 尾部 | 函数族 / `cells[...]` 区间**显式 bake（禁止静默）** | （行为已满足，见 §0.3） | ✅（行为） |
| P1-3 | H7 旁支 | 非几何类型归 preserved-only 不记 gap：`TechDraw::*`/`Drawing::*`/`Image::ImagePlane`/`Mesh::Feature`/`App::MeasureDistance`/`App::LinkGroup` | `f3243a5` | ✅ |
| P2-1 | H7 头部 | Part 工作台特征系：`Part::Revolution`(P6) / `Part::Fuse`(P7) / `Part::Mirroring` / `Part::Chamfer`(P8) / `Part::Fillet`(P9) | `c1d4dbb`/`4e3a7e7`/`5087100`/`6f75282`/`3c8d157` | ✅ |
| P2-2 | H7 | `PartDesign::Groove`（画像 726 对象） | `bda1090` | ✅ |
| P3-1 | pattern 源 | linear/polar pattern 缺 source 的翻译补齐（含 Originals fallback） | `1ba7a15` | ✅ |
| P3-2 | H2 | 缺失约束类型 `15/17/19` 显式记录（dropped-and-recorded），不致命 | `201e410` | ✅ |
| P3-3 | H8 | 草图外部几何弧线投影（`polyline >= 2` 而非 `=== 2`） | `ba37116` | ✅ |
| P3-4 | 求解器 | 已解草图但无闭合环时显式 reason（不再静默降级） | `b315a6e` | ✅ |

### 0.2 计划外但已落地的改进（原表未列，记录备查）

| 提交 | 内容 |
|---|---|
| `658c257` | `Part::GeomBSplineCurve` 进草图（提升草图可翻译面） |
| `bda1090` | P2-1/P2-2 的同时补了 `Part::Revolution` 级联 reason（Source/Axis 缺失分支） |
| `3f49f3b` | chore：`evalWithDoc` 文档化 + 保留未用 import（eslint-disable） |
| `f666331` | docs：更新转换计划 + 新增单文件流水线计划 |

### 0.3 两个"行为已满足"项的说明（避免误判为待办）

- **P1-2（函数族 / `cells[...]` 区间）**：原始报表的 `pad-length-expression-non-constant`
  等 reason **已是显式 bake**——`expressionBindingOf`（`packages/fcstd/src/feature-translate.ts:189-201`）对非纯
  常量表达式先试 `evalWithDoc`（三跳解析），仍 `undefined` 则 `hasNonConstantBinding`
  返回 true，下游触发 `pad-length-expression-non-constant` / `pocket-length-expression-non-constant`
  bake（line 686-688 / 863-865）。函数族 `MyFunc(1,2)`、区间 `A1:B3` 含标识符 → `evalArithmetic`
  正则拒绝 → `undefined` → 显式 bake，**无静默丢失**。原始计划要求"补独立 reason"属细化项，
  不影响正确性，不再单列待办。
- **P4-2（Pad/Pocket 尾部 bake 分支）**：`uptoface-*`、`pad-upTo-missing-base`、
  `pocket-uptoface-*`、`pad-missing-profile` 等 bake 分支**已全部显式存在于代码中**，
  无静默降级。原始计划的"8 条 bake 分支"实为已落地行为，非缺口。

### 0.4 版本 / 重装状态

- faijs `@faicad/faijs` 当前 `0.15.1`（P9 提交 `3c8d157` 内 bump，自 `0.15.0`）。
- fcstd-port 依赖指向 `file:../faijs/faicad-faijs-0.15.1.tgz`（P9 期间重装，dist 已含 P0-4/P0-5）。

---

## 1. 历史根因分析（保留作记录，均已修复）

> 以下数字来自引擎 0.13.2 的报表，**当前 0.15.1 已不再成立**，仅保留以说明修复动机。

### 1.1 E4 根因（P0-4，已修复）

零向量全部来自 `Part::Extrusion`（非 Pad/Pocket）。语料三种序列化形态，旧代码只认第三种：

| 形态 | 属性 | 当前行为（修复后） |
|---|---|---|
| 新格式 | `LengthFwd`（+`LengthRev`）+ 单位 `Dir` | `LengthFwd/LengthRev` 优先；`Symmetric` 两侧同 `LengthFwd`；`Reversed` 互换前后 |
| 老格式 | 仅 `Dir`，`|Dir|` 即长度 | 无 `Length*` 时 `Dir` 整体为挤出向量 |
| 旧格式 | `Length` + `Dir` | 旧 `Length` 兜底保留 |
| `TaperAngle≠0` | — | 显式 bake `extrusion-taper-unsupported`（不静默） |

真值印证：`Flat Bar 130x25 EN10058 S235JR` 的 `Dir=(0,0,50)` 无 `Length`，真值
`volume=162500`、`bbox z:0→50` → 挤出长度即 `|Dir|=50`。

### 1.2 E3-b 根因（P0-5，已修复）

`api/extrude.ts` 两个分支原对产物再走一次 `fromBrep` 登记 roleTable——同语句
`registeredStmtId` 去重会吞掉第二次登记（part 键保持空表），下游 fillet/chamfer 的
`edgeRef` 报 `input shape has no role table (nameless shape)`。修法（`8b7a0d3`）照
revolve 的 `runtimeLineage.recordOutput(origin, table, handle, part)`，不再二次 `fromBrep`。

### 1.3 原始 convert 期结构（0.13.2，已失效）

仅作历史归档：当时 `type-not-whitelisted` 801 objects（Spreadsheet/VarSet 576+39 已由
P1-1 覆盖；非几何 186 由 P1-3 归 preserved）；桶前几位 `pad-length + pocket-missing-dependency`
347 文件（P1-1b/P3-1 已解封大部分）。**当前数字请以 0.15.1 重新测量**（§6）。

---

## 2. 优先级总表（状态已校正）

图例：✅ 已落地 · ✅（行为）行为已满足非缺口 · ▶ 下一步主推 · 其余为真实待办

| 优先级 | 缺口编号 | 功能 | faijs 侧改动位置 | 状态 |
|---|---|---|---|---|
| P0-1 | H13 | `.brp` Placement 去重 `cad.place` | `packages/fcstd/src/feature-translate.ts` | ✅ `162e7cb` |
| P0-2 | V-C8 | 布尔错误结构化 | `api/boolean.ts` | ✅ `162e7cb` |
| P0-3 | E3 | revolve role table | `api/revolve.ts` | ✅ `162e7cb` |
| P0-4 | E4 | `Part::Extrusion` 长度语义 | `packages/fcstd/src/feature-translate.ts:969-1048` | ✅ `1ba7a15` |
| P0-5 | E3-b | extrude role table | `api/extrude.ts:440-468` | ✅ `8b7a0d3` |
| P1-1 | H6 头部 | 参数载体三件套 | `packages/fcstd/src/feature-translate.ts` + `packages/fcstd/src/expressions.ts` | ✅ `162e7cb` |
| P1-1b | H6 残留 | Pocket Midplane | `packages/fcstd/src/feature-translate.ts` | ✅ `1ba7a15` |
| P1-2 | H6 尾部 | 函数族/cells 区间显式 bake | （已显式 bake，无静默） | ✅（行为） |
| P1-3 | H7 旁支 | 非几何类型 preserved | `packages/fcstd/src/feature-translate.ts` 白名单 | ✅ `f3243a5` |
| P2-1 | H7 头部 | Part 工作台特征系 | 白名单 + 翻译分支 | ✅ P6–P9+Mirror |
| P2-2 | H7 | `PartDesign::Groove` | `packages/fcstd/src/feature-translate.ts:1107` | ✅ `bda1090` |
| P2-3 | H7 | 扫掠/放样/螺旋系（455；**需先补内核 op**） | `api/` + 翻译 | ⬜ 真实待办 |
| P2-4 | H7 | `App::Link*` → 镜像系 → 跨引用系 | `packages/fcstd/src/feature-translate.ts` | ⬜ 真实待办 |
| P3-1 | pattern 源 | linear/polar pattern 补齐 | `packages/fcstd/src/feature-translate.ts` | ✅ `1ba7a15` |
| P3-2 | H2 | 约束类型 15/17/19 | `packages/fcstd/src/sketch-solver.ts` | ✅ `201e410` |
| P3-3 | H8 | 外部几何弧线投影 | `packages/fcstd/src/convert.ts` | ✅ `ba37116` |
| P3-4 | 求解器 | 无闭合环显式 reason | `sketch-solver.ts` | ✅ `b315a6e` |
| P3-5 | 求解器 | 相切模式 | `packages/fcstd/src/sketch-solver.ts` + `packages/fcstd/src/planegcs-backend.ts` | ⬜ 真实待办 |
| P4-1 | H3 | 曲线/Frenet/面附着支撑 | `packages/fcstd/src/placement.ts` + `packages/fcstd/src/attachment.ts` | ⬜ 真实待办 |
| P4-2 | H4 | Pad/Pocket 尾部 bake 分支 | （已显式存在） | ✅（行为） |
| P5 | E2 | 纯线框显示网格（不阻塞 STEP，后置） | `brep/` + `Shape` 边集 | ⬜ 真实待办 |

---

## 3. 实施纪律（沿用，仍有效）

1. **每项一个文件**：实现前先在对应 FCStd 上跑一次确认失败形态；实现后跑同一文件确认通过。任何时刻只处理一个文件，不批量。
2. **选点规则**：P2/P3/P4 的取点从**已存在的**报表里查首个解封文件名；报表没有的由用户指定。**报表已过时（0.13.2），取点前必须先按单文件确认真实 reason**。
3. **测试留档**：每项实现伴随 faijs 内合成 fixture 单测（GOTCHA 留档踩坑）。
4. **每项独立提交**，提交信息写明消掉的 reason 名（conventional commits，`--no-verify`）。
5. **先 run 期、后 convert 期**：E4（918）+ E3-b（120）已修复，run 期主因已清；剩余 run 失败需以 0.15.1 重新测量（§6）。
6. **注（P2 取点需复核）**：报表 `byType` 不含 `Part::Revolution`/`PartDesign::Groove`（画像 425/726 对象），说明画像对象数与真实缺口数脱节；取点必须先在单文件确认 reason。

---

## 4. 下一步开发步骤（按真实剩余工作重排）

> 原始 §4 的 Step 1（P0-4）/ Step 2（P0-5）已完成；Step 3（P1-1b）/ Step 4（P3-1）/
> Step 5（P1-3）/ Step 6（P3-4/P3-2）/ Step 7（P3-3）/ Step 8 的 P2-2 已完成。
> 剩余真实工作如下重排：

**Step 0（前置，必做）— 重新基线测量**
- fcstd-port 用 0.15.1 重跑 `state/manifest.jsonl` + `reports/run-sweep.json` + `reports/batch-report.json`。
- 目的：拿到 0.15.1 真实的 run-fail 分布与 convert gap 分布，替代失效的 0.13.2 报表。
- 这是挑选后续任务的数据基础——当前所有"剩余 reason 条数"估计都不可信。

**Step 1（▶ 主推）— 收口 P0-4/P0-5 单文件验收**
计划在 §5 要求"逐项关闭"：在指定 corpus 文件上跑 convert ok + run ok + STEP 落盘。
指定文件：`Flat Bar 130x25 EN10058 S235JR.FCStd`（E4，对拍 truth.json vol 162500 / bbox z 0–50）、
`DIN93_M18TabWasher.FCStd`（E3-b，fillet 不再 nameless）。
fcstd-port 已装 0.15.1，可直接验证；同时暴露这两文件上真实剩余的 run-fail reason。

**Step 2 — run 期剩余失败（依赖 Step 0 实测）**
原始 0.13.2 报表的 run-fail 残留 = `REVOLVE_FAILED`(9) + `timeout`(13) + 未分类(~15)
≈ 37 条，但其中部分可能已被 P2-2/P3-* 顺带解封。Step 0 实测后按真实条数/文件挑最高频者。

**Step 3 — P2-3：扫掠/放样/螺旋**
需先在 `api/` 补内核 op（`cad.sweep`/`cad.loft`/`cad.helix`），再做翻译分支。体量最大，
放 convert 期最后。

**Step 4 — P2-4：App::Link\* 系**
镜像系 / 跨引用系 / 布尔系，依赖上游 feature 已被翻译。

**Step 5 — P3-5 / P4-1：求解器相切模式 / 曲线·面附着**
各自需要 solver 与 attachment 模块支撑。

**Step 6 — P5：纯线框显示网格（不阻塞 STEP，后置）**

---

## 5. 验收口径（更新）

- 逐项关闭：对应文件 convert ok（无 gap）+ run ok + STEP 落盘；P0-4 另加与 `truth.json`
  的 volume/bbox 对拍（1e-5）。
- **不再用 0.13.2 报表的"run-fail 1,075 / gap 878"作主口径**（引擎已 0.15.1，数字全失效）。
  改用 Step 0 重新生成的 `reports/run-sweep.json` / `batch-report.json`：
  - 基线（0.15.1，待 Step 0 测量）：run-fail / ok / gap 的真实分布。
  - 每完成一个 Step，对应 reason 条数应下降；真差异（几何静默降级）必须显式留 reason，
    不允许靠放宽阈值变绿。
- 全部关闭 ≠ 结束：真差异必须显式留 reason。

---

## 6. 待办总览（本会话需补的动作）

1. **文档已校正**（本文件）：状态列/版本/报表 staleness 已对齐 0.15.1。
2. **Step 0 重新基线**：fcstd-port 跑 0.15.1 全量报表（当前未跑）。
3. **Step 1 P0-4/P0-5 单文件验收**：尚未在 corpus 上跑过（代码已提交+单测，但 §5 验收未执行）。
4. 真实剩余功能开发：P2-3 / P2-4 / P3-5 / P4-1 / P5（见 §2/§4）。
