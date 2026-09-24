# FCStd 移植开发计划 v2（2026-09-24 制定）

> **文档定位**：本计划取代 [`2026-09-23-fcstd-gap-dev-plan.md`](./2026-09-23-fcstd-gap-dev-plan.md)。
> 旧计划保留作历史归档（其 §0 已含 2026-09-24 校正），其中关于 0.13.2 报表失效的结论
> 已被本计划吸纳；本计划在此之上补入 0.15.1 落地内容与 sweep/loft/helix 内核 op 现状。
>
> **数据来源声明（重要）**：
> 1. 代码侧状态以 faijs 仓库 git 提交为准（`packages/core`、`packages/fcstd`）。
> 2. 通过率数字来自 fcstd-port 已发布报表：**`reports/batch-report.json`/`reason-cascade.md`
>    （引擎 0.13.2，生成于 2026-09-21）与 `reports/run-sweep.json`/`status.md`（生成于
>    2026-09-23 / 09-24，但底层产品仍是 0.13.2 基线下生成的）**。
> 3. **0.15.1 全量重基线（写 `state/manifest.jsonl`）正在后台运行（约 10 小时），本计划
>    不重跑、不读半截 manifest 做结论**。重基线完成后用新数字回填 §2。
> 4. 本次制定**不运行任何转换 / 执行 / 比对代码**，仅基于既有报表与源码静态分析。

---

## 0. 前置：为什么已有"通过率"必须标 stale

| 证据 | 内容 |
|---|---|
| `reports/batch-report.md:5-7` | 引擎 `@faicad/faijs@0.13.2`，生成时间 `2026-09-21T15:34` |
| `reports/reason-cascade.md:6` | 同一轮：引擎 `0.13.2`，`gap 878 / ok 2323` |
| `reports/run-sweep.md:1-7` | run-sweep 生成于 `2026-09-23`，run-fail 1075 |
| `reports/status.md:1-3` | 由 `state/manifest.jsonl` 生成，仅对 1,088 `parity=fail` 重跑 truth+parity（`changed=0`），**未重算 convert / run 阶段** |
| faijs git 提交日期 | P0-4/P0-5/P1-1/P1-1b/P2-1(P5–P9)/P2-2/P3-1..P3-4 **全部为 `2026-09-24`**，晚于上述报表 |

结论：已发布的 `gap=878 / run-fail=1075 / parity pass=141` 三条主口径，**全部来自 0.13.2 基线，
均未反映 2026-09-24 落地的 0.15.1 修复**。后台重基线正是旧计划的"Step 0 重新基线"，当前进行中。

---

## 1. 已落地状态（代码侧，faijs 0.15.1，截至 2026-09-24）

### 1.1 原缺口清单兑现（按真实提交）

| 优先级 | 缺口 | 落地内容 | 提交 | 状态 |
|---|---|---|---|---|
| P0-1 | H13 | `.brp` Placement 去重 `cad.place` | `162e7cb` | ✅ |
| P0-2 | V-C8 | 布尔错误结构化 | `162e7cb` | ✅ |
| P0-3 | E3 | revolve role table | `162e7cb` | ✅ |
| P0-4 | E4 | `Part::Extrusion` 长度语义（修 `E_EXTRUDE_ZERO_VECTOR`） | `1ba7a15` | ✅ |
| P0-5 | E3-b | extrude role table（修 `nameless-shape` edgeRef） | `8b7a0d3` | ✅ |
| P1-1 | H6 头部 | `Spreadsheet::Sheet`/`App::VarSet` 放行 + `<<Label>>.Alias` 三跳求值 | `162e7cb` | ✅ |
| P1-1b | H6 残留 | Pocket Midplane | `1ba7a15` | ✅ |
| P1-2 | H6 尾部 | 函数族 / `cells[...]` 区间显式 bake（行为已满足） | — | ✅（行为） |
| P1-3 | H7 旁支 | 非几何类型 preserved-only | `f3243a5` | ✅ |
| P2-1 | H7 头部 | Part 工作台：`Part::Mirroring`(P5)/`Part::Revolution`(P6)/`Part::Fuse`(P7)/`Part::Chamfer`(P8)/`Part::Fillet`(P9) | `5087100`/`c1d4dbb`/`4e3a7e7`/`6f75282`/`3c8d157` | ✅ |
| P2-2 | H7 | `PartDesign::Groove`（画像 726 对象）+ Revolution 级联 reason | `bda1090` | ✅ |
| P3-1 | pattern 源 | linear/polar pattern 缺 source 补齐 | `1ba7a15` | ✅ |
| P3-2 | H2 | 约束类型 15/17/19 显式记录 | `201e410` | ✅ |
| P3-3 | H8 | 外部几何弧线投影（`polyline >= 2`） | `ba37116` | ✅ |
| P3-4 | 求解器 | 无闭合环显式 reason | `b315a6e` | ✅ |

版本：`@faicad/faijs` 当前 **0.15.1**；fcstd-port 依赖 `file:../faijs/faicad-faijs-0.15.1.tgz`。

### 1.2 sweep / loft / helix / screw 内核 op（P2-3 前置已满足）

> 这是用户点名"已经支持了"的部分——**内核 op 已落地，但 FCStd 翻译桥未接**。

| op | 文件 | 提交 | API 名 | 说明 |
|---|---|---|---|---|
| sweep | `packages/core/src/api/sweep.ts:70` | `a4f9f30` | `cad.sweep(section, path)` | 截面：1D wire（`cad.wire`/`cad.helix`/`cad.sketch({as:'wire'})`）或 2D face；脊柱必须 wire；`engines:['occt']` |
| loft | `packages/core/src/api/loft.ts:70` | `a4f9f30` | `cad.loft([bottom, top])` | 截面为 face；`engines:['occt']` |
| helix | `packages/core/src/api/helix.ts:79` | `b0c4a92` | `cad.helix({radius,pitch,turns})` | 1D 曲线（螺旋线），可作 sweep 脊柱 |
| screw | `packages/core/src/api/screw.ts` | `b0c4a92` | `cad.screw(...)` | 螺旋扫掠（螺纹），FCStd 暂无直接对应类型，备用 |

**关键缺口**：`packages/fcstd/src/feature-translate.ts` 的白名单与 dispatch 尚未接入
`Part::Sweep` / `Part::Loft` / `Part::Helix`（见 §1.3）。即 P2-3 的"先补内核 op"已完成，
"再做翻译分支"未做。

### 1.3 FCStd 白名单当前覆盖（`packages/fcstd/src/feature-translate.ts:97-135` + dispatch `:540+`）

**已白名单（可翻译）**：
`Part::Box` `Part::Cylinder` `Part::Cut` `Part::MultiFuse` `Part::Extrusion`
`Part::Compound` `Part::Sphere` `Part::Mirroring` `Part::Revolution` `Part::Fuse`
`Part::Chamfer` `Part::Fillet` `Part::Sweep` `Part::Loft` `Part::Helix` +
`PartDesign::Pad` `Pocket` `Revolution` `Groove`
`LinearPattern` `PolarPattern` `Fillet` `Chamfer`。

> P2-3 已于 2026-09-24 落地：`Part::Sweep`/`Part::Loft`/`Part::Helix` 接入白名单 +
> dispatch（`feature-translate.ts:139-142` 白名单、`1347+` dispatch case），10 个合成单测留档
> （`feature-translate.test.ts` P2-3 describe，94 全包 217 测试绿）。
> `PartDesign::Additive*`/`Subtractive*` 仍待重基线 `byType` 证实语料含后再接。

**仍未接入（真实待办，来自语料普查 §3.2）**：
`PartDesign::AdditiveLoft`/`AdditivePipe`/`Subtractive*`(若语料含) ·
`App::Link`(126) `PartDesign::Mirrored`(166) `PartDesign::ShapeBinder`(71) ·
`Part::FeaturePython`(2101) `App::FeaturePython`(1459) 等。

---

## 2. 通过率现状（已发布报表，0.13.2 基线，标注 STALE）

> 漏斗口径：语料 3,201 个 `.FCStd`（跳过 `.FCStd1` 备份 102）。

| 阶段 | 口径 | 数值 | 占比 / 备注 |
|---|---|---|---|
| 转换 | stage1 ok | 2,323 | 72.6% |
| 转换 | stage1 gap（翻译缺口） | 878 | 27.4% |
| 执行 | stage2 ok（跑通+STEP 落盘） | 1,226 | 占 stage1-ok 52.8%；占语料 38.3% |
| 执行 | stage2 run-fail | 1,075 | — |
| 执行 | stage2 timeout / failed / threw | 13 / 9 / 1 | — |
| STEP | ok 中 `step=false` | 0 | 落盘率 100%（闸门 V-C3 通过） |
| 真值 | truth ok / fail | 3,128 / 73 | 73 为源数据缺陷 |
| 对拍 | parity pass / fail / skip | 141 / 1,088 / 1,972 | pass 占 truth-ok **4.5%**；占 STEP 候选 11.4% |
| **端到端** | **convert ok ∧ run ok ∧ STEP ∧ parity pass** | **141 / 3,201** | **= 4.4%** |

**端到端通过率 4.4%** 是当前唯一完整的"全链路通过率"口径，但它是 0.13.2 基线数字。

### 2.1 数字为何必然偏低（与 0.15.1 修复的对应）

- **run-fail 的 dominant "other" 类（963）以 `E_EXTRUDE_ZERO_VECTOR` 为主**（`run-sweep.md:22-26`：
  Flat Bar、Round Bar、Rectangular hollow section 等）→ 正是 **E4 / P0-4（`1ba7a15`）** 的修复对象。
  预计 run-fail 从 1,075 大幅下降到数百量级（待重基线确认）。
- **nameless-shape（120）** = `edgeRef: input shape has no role table`（`run-sweep.md:30`）→
  正是 **E3-b / P0-5（`8b7a0d3`）**。预计该类清零。
- **gap 的 dominant 组合**（`reason-cascade.md:50-94`）：`Spreadsheet + <<Label>>.Alias +
  pocket-dependency` 一次性解封 **347 文件（占 gap 39.5%）** → 正是 **P1-1（`162e7cb`）** 的修复范围
  （参数载体放行 + 三跳求值）。预计 gap 从 878 大幅下降。
- **polar/linear pattern（217）、external-geometry（115）、pocket-midplane（49）** →
  已被 P3-1 / P3-3 / P1-1b 覆盖。
- **Part 工作台类型（Mirroring/Revolution/Fuse/Chamfer/Fillet 共数百对象）** →
  已被 P2-1(P5–P9) 白名单，从 `type-not-whitelisted` 移除。

> ⚠️ 上述"预计"均**未经实测**，仅由"修复项 ↔ 缺口根因"对应推导。真实降幅待后台重基线（§4 Step 0）完成。

---

## 3. 优先级总表（v2，基于代码现状重排）

图例：✅ 已落地 · ▶ 下一步主推 · ⬜ 真实待办

| 优先级 | 功能 | faijs 侧改动位置 | 语料对象量（普查） | 状态 |
|---|---|---|---|---|
| P2-3 | **sweep/loft/helix 翻译分支**（内核 op 已就绪） | `packages/fcstd/src/feature-translate.ts` 白名单 + dispatch（`Part::Sweep`/`Part::Loft`/`Part::Helix`） | Sweep 268 / Loft 107 / Helix <63 | ✅ 已落地（2026-09-24） |
| P2-4a | `App::Link` / `PartDesign::Mirrored`（实例 / 镜像） | `feature-translate.ts` + 镜像系 | Link 126 / Mirrored 166 | ⬜ 真实待办 |
| P2-4b | `PartDesign::ShapeBinder` / 跨引用系 | `feature-translate.ts` + xlink 解析（`library-profile.md:101` xlinkRefs 1159） | ShapeBinder 71 | ⬜ 真实待办 |
| P2-4c | `*FeaturePython`（Python 自定义特征） | 需 Python 执行路径或 shape 缓存；**最大剩余类型桶** | FeaturePython 2101 + 1459 | ⬜ 真实待办（可能超几何 parity 范围） |
| P3-5 | 求解器相切模式 | `packages/fcstd/src/sketch-solver.ts` + `planegcs-backend.ts` | Tangent 约束 12,216（`library-profile.md:64`） | ⬜ 真实待办 |
| P4-1 | 曲线 / Frenet / 面附着 | `packages/fcstd/src/placement.ts` + `attachment.ts` | — | ⬜ 真实待办 |
| P5 | 纯线框显示网格（不阻塞 STEP） | `brep/` + `Shape` 边集 | — | ⬜ 真实待办（后置） |
| **H** | **硬骨头：parity 真实几何差异**（Z 偏移 2.5、体积差 44% 等） | 按 `reports/reason-cascade.md` 重排走"阶段1→2→3→提升"闭环 | 1,088（stale，待重基线重归类） | ⬜ 真实待办 |

> 注：P1-1 已覆盖的 `type-not-whitelisted` 主体（Spreadsheet 576）与 P2-1 已覆盖的 Part 工作台类型
> 在 0.15.1 下应已从缺口移除；**剩余 `type-not-whitelisted` 主要由 P2-3 / P2-4 的未接入类型构成**。
> 精确剩余量待重基线 `byType` 字段回填。

---

## 4. 下一步开发步骤（按真实剩余工作重排）

**Step 0（进行中，勿跑）— 0.15.1 全量重基线**
- 后台进程正在写 `state/manifest.jsonl`（约 10h）。完成后读 `reports/run-sweep.json` +
  `status.md` 的新数字，**回填 §2**：新 `convert ok / run ok / gap / parity pass` 分布。
- 这是挑选后续任务的数据基础——当前所有"剩余 reason 条数 / 文件数"估计都不可信。

**Step 1（✅ 已完成，2026-09-24）— P2-3：sweep/loft/helix 翻译分支**
1. ~~`feature-translate.ts` 白名单加入 `Part::Sweep` / `Part::Loft` / `Part::Helix`~~ ✅
   （`feature-translate.ts:139-142`；`PartDesign::Additive*`/`Subtractive*` 仍待重基线 `byType` 证实）。
2. ~~对应 dispatch case~~ ✅
   - `Part::Sweep` → `cad.sweep(profile, spine, opts)`；`Profile`/`Spine` 为 `PropertyLink`，
     支持 `Frenet`(0,默认)/`Binormal`(1)/`Auxiliary`(2) 模式映射；`Auxiliary` 显式 bake
     （`sweep-auxiliary-unsupported`，需第二支撑脊柱）。`Transition` 经 `normalizeSweepTransition`
     映射到 `transitionMode`。
   - `Part::Loft` → `cad.loft([sections], opts)`；`Sections` 为 `PropertyLinkList`，
     `Ruled`/`Closed` 标志透传——`Closed` 因 `cad.loft` 无 `closed` 选项显式 bake
     （`loft-closed-unsupported`）。`Sections` 以 JsExpr 数组字面量渲染（remap-safe）。
   - `Part::Helix` → `cad.helix({radius, pitch, turns})`；`turns` 由 `Height/Pitch` 推导
     （兜底 `Turns`），`Angle≠0`（锥螺旋）显式 bake（`helix-cone-unsupported`）。
3. ~~合成 fixture 单测留档~~ ✅ 10 个（`feature-translate.test.ts` P2-3 describe）。
   **GOTCHA 已留档**：不支持模式/选项（Sweep `Auxiliary`、Loft `Closed`）的判定必须**先于**
   依赖解析（`inputVar`），否则在依赖未解析时会被误报成 `*-baked-upstream`——
   该顺序问题已在 dispatch case 注释 + 单测中锚定（测试以 `() => undefined` stub 验证）。
4. ⬜ **单文件验收**：挑语料中含 `Part::Sweep` 的代表文件，convert ok + run ok + STEP 落盘。
   此项依赖重基线/转换链路实测，待 Step 0 后或随后续批次补跑（不单独跑对比代码）。

**Step 2 — P2-4a/b：实例 / 镜像 / 跨引用**
- `App::Link`（126）/ `PartDesign::Mirrored`（166）/ `ShapeBinder`（71）翻译分支。
- 依赖上游特征已被翻译；xlink 解析复用 `library-profile.md` 的 xlink 统计。

**Step 3 — P2-4c：*FeaturePython 处置策略**
- 2,101 + 1,459 个 Python 自定义特征。**评估是否纳入几何 parity 范围**：多数来自 Fasteners /
  sheet-metal 等工作台（螺纹、钣金折弯），需 Python 执行或 shape 缓存，超出当前 brep/mesh 内核。
- 决策：显式 bake（标注 `python-feature-unsupported`，无静默丢失）或另立 Python 执行通道。
  此决策影响"端到端通过率"上限，需在 Step 0 数字出来后定。

**Step 4 — P3-5：求解器相切模式**
- Tangent 约束（type 5，12,216 条）是 sketch 求解高频约束；确认当前 planegcs 后端是否已部分支持，
  缺失部分补相切求解分支（影响 `sketch-not-solved` 95 文件及下游）。

**Step 5 — P4-1 / P5**
- 曲线·面附着（attachment 模块）；纯线框显示网格（后置，不阻塞 STEP）。

**Step 6 — H 硬骨头（依赖 Step 0 重归类）**
- 重基线后重新跑"阶段1→2→3→提升"闭环，按 `reason-cascade.md` 排序修真实几何差异。
- 真差异必须显式留 reason，不允许靠放宽阈值（1e-5）变绿。

---

## 5. 验收口径（更新）

- **端到端通过率** = `convert ok ∧ run ok ∧ STEP 落盘 ∧ parity pass`，目标相对 0.13.2 基线的
  **4.4%** 提升（重基线后给出新基线值，再设增量目标）。
- 逐项关闭：对应文件 convert ok（无 gap）+ run ok + STEP 落盘；涉及几何的另加与 `truth.json`
  的 volume/bbox 对拍（1e-5）。
- 每完成一个 Step，对应 reason / 类型条数应下降；真实几何差异必须显式留 reason。

---

## 6. 待办总览（本会话动作）

1. **文档已写**（本文件）：状态列 / 通过率 / sweep·loft·helix 现状已对齐 0.15.1 + 代码静态分析。
2. **Step 0 重基线回填**：后台 10h 进程完成后，用新 `reports/run-sweep.json`/`status.md` 回填 §2/§3。
3. **Step 1 P2-3 翻译分支**：✅ 已完成（白名单 + dispatch + 10 单测，全包 217 测试绿）。
   仅「语料单文件验收」一项待重基线/转换链路实测补跑（不单独跑对比代码）。
4. 真实剩余功能开发：P2-4(a/b/c) / P3-5 / P4-1 / P5 / H（见 §3/§4）。
5. **不运行任何对比代码**（用户要求 + 后台进程占用）。
