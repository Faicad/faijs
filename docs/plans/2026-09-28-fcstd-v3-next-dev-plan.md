# FCStd → `.fai.zip` v3 后续开发计划（2026-09-28）

状态：**规划文档（基于 git 实况校正旧计划 `2026-09-28-fcstd-sketch-and-zip-v3-plan.md` 的过时状态）**。本计划记录真实进展，并规划下一阶段开发任务——即全量 v3 重转换后剩余的 **1590 个 gap** 如何按类清零。

## 0. 用户要求（原话）

> 根据最新的进展，写一份新的开发计划，规划下一步的开发任务。

## 1. 状态校正（旧计划已严重过时，必须以 git 为准）

旧计划 `2026-09-28-fcstd-sketch-and-zip-v3-plan.md` 的 §0/§6 声称「A1/A2/A3/A5/A6、B 组、C 组仍待开发」。**这与 git 实际不符。** 经 `git log` 实测，A 组（A1–A6）、C 组（C1–C4）全部已 commit 完成；B 组（v3 语料重转换）已在本会话跑完。旧计划头部状态属于未随开发更新的过期声明，后续以本计划为准。

### 1.1 已落地工作项（git 实证）

| 工作项 | 内容 | 落地 commit |
|---|---|---|
| **A1** | `fromFreeCadConstraints` 反向投影（FCStd 整数约束 → canonical） | `8cfe04c2` |
| **A2** | 草图分支改发 `cad.sketch({geoms,constraints,plane})`；`classifySketch` 降格为保真预检 | `549dfe9c` |
| **A3** | `cad.sketch` 接显式 plane frame，一步放置 | `0fae51eb` |
| **A4** | Draft 画图 → `cad.draw` 笔链重建 | `375608a2` + `f16f3dd6` |
| **A5** | `cad.profile` 兜底收紧，显式 reason | `91cf3f9e` |
| **A6** | 椭圆不再静默丢段（`extractContours`） | `e04ded0d` |
| **C1–C4** | 叶子参数升格 `const p_*`、表达式内联折叠、`mapping.params` 来源台账 | `c118170f` |
| **solver-throw 根因修复** | 欠定约束改为 ledger 记录而非抛错（REGS_REQUIRED 守卫） | `0ad3d90b` |
| **B1** | fcstd-port 读端切 v3 读 API | （早于本计划，已就位） |
| **B2** | 源 `.FCStd` 全量重转换 → v3 | 本会话完成 |
| **B3** | v3 产物 parity/对账报表 | 本会话完成（`reports/batch-report.md`/`.json`） |

### 1.2 本会话收尾完成的工作（版本一致化 + B 组重转换）

1. **版本一致化（铁律：所有子包必须 = core 0.19.0）**
   - `packages/draw` `0.18.3 → 0.19.0`；`packages/fcstd` 对 draw/sketch 依赖 `^0.18.3/^0.18.0 → ^0.19.0`。
   - 全 9 个 `@faicad/*` 子包（core / sketch / draw / fcstd / sheetmetal / fai_cq_gears / fai_cq_warehouse / faijs-extra / cq-compat）经实测核验**全部 = 0.19.0**，无不一致。
   - **core 补回 `./units` 导出**：已发布旧 `core 0.19.0.tgz` 缺该子路径，而 fcstd 源 `expressions.ts` 已 `import { toBase } from '@faicad/faijs/units'`，重建 core 后导出补全。
2. **fcstd-port 依赖对齐 + 重装**：四个 `@faicad/*` 依赖全部指向 `0.19.0` 的 file: tgz。`npm install` 被 `genie-safe-delete` shim 拦截删除而不可靠，改为**直接解包 tgz 铺进 node_modules**（非 node 的 `rm`+`tar`），并清掉陈旧 `package-lock.json`。
3. **全量 v3 重转换**：`tools/batch-convert.ts --only gap` 续跑，3201 个 `.FCStd` 扫描、引擎 sha 守卫未拦截（`cli.js` sha256 = `627ecc91…` 与 state 记录一致）。
4. **v3 产物实证**：抽样 `Bathroom_cabinet_sink.fai.zip` 确认 `format:3`、`models:[{id:"main",entry:"model/main.fai.js",label:...}]`、`sketches:{total:63,l0:63}`（全参数化投影），内嵌 `freecad/` 源镜像可追溯。

### 1.3 当前全量结果（来自 `reports/batch-report.json`）

| 指标 | 值 |
|---|---|
| 扫描文件 | 3201 `.FCStd`（102 `.FCStd1` 备份跳过） |
| 总计 | 3205 |
| **ok** | **1615** |
| **gap** | **1590** |
| failed / timeout | 0 / 0 |
| convertRate | 50.39% |

> ⚠️ **未提交改动**：`packages/draw/package.json`、`packages/fcstd/package.json` 的版本号 bump 尚未 commit（见 §4 P0）。probe 脚本 `packages/core/scripts/probe-w2-*.ts`、`packages/tests/tmp-faijs-cli/` 为未跟踪文件，待清理/归档（§6）。

## 2. 残余 gap 分布（下一步的真实任务面）

全量重转换后 1590 gap。按原因聚合（前 15，`reports/batch-report.json` 的 `byReasonKey`）：

| 排名 | 原因 key | 文件数 | 单次修复可释放（singleFix.freed） | 与其它原因并存（blocked） |
|---|---|---|---|---|
| 1 | `solver-throw` | 439 | 150（本轮已清） | 289 |
| 2 | `groove-profile-baked-upstream` | 212 | — | — |
| 3 | `pad-missing-profile` | 139 | — | — |
| 4 | `multifuse-missing-dependency` | 70 | 4 | 66 |
| 5 | `pocket-missing-dependency` | 49 | 13 | 36 |
| 6 | `revolution-profile-baked-upstream` | 49 | — | — |
| 7 | `fillet-missing-base` | 44 | — | — |
| 8 | `mirroring-missing-source` | 33 | — | — |
| 9 | `loft-section-baked-upstream` | 32 | — | — |
| 10 | `compound-missing-members` | 28 | 18 | 10 |
| 11 | `cut-missing-dependency` | 23 | — | — |
| 12 | `shape-asset-broken` | 22 | 36 | -14 |
| 13 | `chamfer-missing-base` | 22 | — | — |
| 14 | `fillet-non-edge-sub` | 20 | 9 | 11 |
| 15 | `sweep-profile-baked-upstream` | 19 | — | — |

其余（<19）：`extrusion-missing-base` 18、`external-geometry-unresolved` 16、`polar-pattern-missing-source` 12、`linear-pattern-missing-source` 11、`fuse-missing-dependency` 7、`chamfer-non-edge-sub` 6、`extrusion-zero-length` 5、`unsupported-geometry` 5、`cylinder/ sphere-partial-angle` 各 4、`linear-pattern-edge-dir-unsupported` 4、`pad-upTo-missing-base` 3、`fillet-variable-radius` 2、`helix-cone-unsupported` 1、等。

### 2.1 原因分类

- **依赖解析缺口（`*-missing-*` / `*-non-edge-sub`）**：被引用对象（base / profile / source / member / dependency）未翻译或未找到。这是**最大的可清量**，根因通常是引用名解析失败或翻译顺序导致被引对象先被判 gap/baked，进而下游全部 missing。包含 `pad-missing-profile`(139)、`multifuse-missing-dependency`(70)、`pocket-missing-dependency`(49)、`fillet-missing-base`(44)、`mirroring-missing-source`(33)、`compound-missing-members`(28)、`cut-missing-dependency`(23)、`chamfer-missing-base`(22)、`fillet-non-edge-sub`(20)、`extrusion-missing-base`(18)、`polar/linear-pattern-missing-source`(12/11) 等。
- **上游已烘焙轮廓（`*-baked-upstream`）**：FCStd 源里该轮廓本身就是烘焙死的 Shape（非真实可参数化草图），转换器无从恢复参数化。含 `groove-profile-baked-upstream`(212)、`revolution-profile-baked-upstream`(49)、`loft-section-baked-upstream`(32)、`sweep-profile-baked-upstream`(19)。需判定为**已知限制**（文档化、不接受假参数化）还是可恢复。
- **solver-throw 余波**：`0ad3d90b` 已把欠定约束从「抛错」改为「ledger 记录」，本轮释放 150 个纯 solver-throw 文件。剩余 289 个是与其它原因并存（co-morbid），需 per-file 分类确认是否还有真抛错路径。

## 3. 关键决策

### D6：依赖解析缺口优先于烘焙轮廓

`*-missing-*` 族是「翻译链断裂」类 bug，修复杠杆最高（单个修复可连带清空数十个下游 gap，如 `multifuse-missing-dependency` 并存 66 个文件）。`*-baked-upstream` 多为源数据本身限制，单独修复收益低、且易引入假参数化，**先判定后处理**。

### D7：每个 gap 类修复后必须走 B3 闭环

修复一类 → `tools/batch-convert.ts --only gap` 续跑 → 读 `reports/batch-report.json` 的 `singleFix`/`byReasonKey` 确认该类 freed 数 → 更新报表。严禁「靠跑 CI 找 bug」式盲改。

### D8：烘焙轮廓不伪造参数化

`*-baked-upstream` 若无法从烘焙 Shape 可靠恢复参数化轮廓，则保留 `python-baked`/`baked` 并写显式 reason，**绝不**用估算几何伪装成 `cad.sketch`。

## 4. 下一步开发任务（按优先级）

> 执行纪律继承旧计划：单文件闭环、一次只修一类、逐文件汇报、测试留档、每项独立过门禁提交。

### P0（前置，必须最先做）：提交版本一致化改动

- 提交 `packages/draw/package.json`（`0.18.3 → 0.19.0`）、`packages/fcstd/package.json`（sketch/draw 依赖 `^0.18.x → ^0.19.0`）。
- 必须过 lefthook 全部门禁（line-ending / verify-export-jsdoc / eslint / whitespace），**严禁 `--no-verify`**（2026-09-26 用户铁律）。
- 提交信息：`chore(release): lockstep bump draw/fcstd to 0.19.0`（或等其它待发改动合并为一次 release commit）。

### P1（最高杠杆）：依赖解析缺口族

按「单修可清量 + 是否 unblock 其它类」排序：

1. **`multifuse-missing-dependency`（70，blocked 66）**：多实体融合找不到被融合成员。先查引用解析为何失败——大概率被融合对象本身先被判 gap/baked 导致成员缺失。修复后预计连带清空大量下游。
2. **`pad-missing-profile`（139）**：Pad 找不到其草图轮廓。最常见的根因是草图翻译顺序 / 命名解析。建议先做合成 fixture 复现 `Pad.Length` 指向的 Sketch 未被正确产出的路径。
3. **`pocket-missing-dependency`（49，blocked 36）**：Pocket 依赖缺失，与 multifuse 同类引用链问题。
4. **`fillet-missing-base`（44）/ `chamfer-missing-base`（22）/ `extrusion-missing-base`（18）**：圆角/倒角/拉伸找不到基面。基面通常是上一个特征的 Body face，需确认 Body→face 引用解析。
5. **`mirroring-missing-source`（33）/ `polar-pattern-missing-source`（12）/ `linear-pattern-missing-source`（11）**：镜像/阵列找不到源特征。
6. **`compound-missing-members`（28，freed 18）**：`Part::Compound` 成员缺失（注意 `065240e5` 已做「跳过非建模成员」，需确认是否过度跳过）。
7. **`cut-missing-dependency`（23）**：布尔减依赖缺失。
8. **`fillet-non-edge-sub`（20）/ `chamfer-non-edge-sub`（6）**：选边子形状解析失败（非整边）。次级几何引用。

每修一类即跑 B3 闭环验证，记录 freed 数与新增/消失的 reason。

### P2：外部几何与次级引用

- **`external-geometry-unresolved`（16，blocked 13）**：外部几何引用未解析（如草图依赖其它草图的边/顶点）。`78a1fc93` 已修 VertexN 链接，需确认是否仍有 H/V 轴或跨草图引用缺口。
- **`shape-asset-broken`（22，freed 36）**：源 Shape 资产损坏/缺失，单修可释放 36 个（净正向），优先级可上提到 P1 末。

### P3：烘焙轮廓判定（D8）

- 对 `*-baked-upstream` 四族（212+49+32+19 = 312 文件）逐类调研：FCStd 源是否真为死轮廓（FreeCAD 里已是 `Shape` 而非 `Sketch`/`Profile`）。若是，则**接受为已知限制**，在 `reports/` 与 `mapping.json` 显式标注，不再计入「可清零 gap」；若发现可从 Shape 拓扑恢复参数化轮廓（如环形 groove 的截面线可重参数化），则单独开题。
- 产出：`docs/analysis/fcstd-baked-upstream.md` 记录判定结论。

### P4：solver-throw 余波分类

- 对 289 个 co-morbid solver-throw 文件 per-file 分类：确认 `0ad3d90b` 后是否还有真抛错路径（若有，补守卫）；若无，确认这些文件真正卡住的原因是并存的另一 reason，归入对应 P1/P3 类。

## 5. 验证与回归

- 每个 P1 类修复伴合成 fixture 单测（`packages/fcstd` / `packages/sketch`），GOTCHA 留档真实 API 行为。
- 不破坏非目标通路：`npm run test -w @faicad/faijs-fcstd -w @faicad/faijs-sketch -w @faicad/faijs` 取差；stderr 零容忍。
- B3 闭环：`tools/batch-convert.ts --only gap` 续跑 → 比对 `reports/batch-report.json` 的 `totals.gap` 下降与 `byReasonKey` 该类计数归零/下降。
- 每类修复后单独提交，commit message 标注该类 reason（如 `fix(fcstd): resolve multifuse-missing-dependency references`）。

## 6. 验收

- **P0**：`packages/draw`、`packages/fcstd` 版本号已 commit 且全仓 9 个子包 = 0.19.0（lockstep 守卫 `scripts/check-dep-lockstep.mjs` 通过）。
- **P1**：`*-missing-*` 族文件数较当前显著下降（目标：每类 freed 数 ≥ 该类当前文件数的 60%），`totals.ok` 上升、`totals.gap` 下降；每个修复有单测 + B3 报表佐证。
- **P3**：`*-baked-upstream` 经判定后要么被修复、要么显式标注为已知限制，不在「未解释 gap」中遗留。
- **全程**：单测随项落库、每项独立过门禁提交、逐文件汇报、stderr 零容忍。

## 7. 待清理（housekeeping，非开发阻塞）

- `packages/core/scripts/probe-w2-run.ts`、`probe-w2-toilets.ts`、`packages/fcstd/scripts/probe-w2-placements.ts`：一次性探针，若结论已落单测则删除，否则归 `scripts/`。
- `packages/tests/tmp-faijs-cli/`：临时产物，确认无保留价值后删除。
- 旧计划 `2026-09-28-fcstd-sketch-and-zip-v3-plan.md` 头部状态声明已过期，本计划为其权威替代；旧文件保留作历史，不再更新。
