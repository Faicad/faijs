# 方案：STEP 导出面剔除 2D 终端（未消费草图）—— G0-D 修复

- 日期：2026-10-06
- 归属：`packages/core`（导出层）+ `fcstd-port`（验证）
- 触发：faijs-freecad 独立仓 `docs/plans/2026-10-05-freecad-post-occt56-plan.md` 的 **G0-D / R10**
- 状态：**已实施（E-2 完成、E-1 探针改判 `SHELL`；E-3 V-1 通过；E-4 V-2 通过（2026-10-06），V-3 待跑）**
- 范围纪律：**本方案只解决「2D 终端被单独导出」这一个问题**。相邻缺陷在 §8 留档并单独立项，不在本批改。

---

## 0. 实施纪要（2026-10-06 追加，含对 §3 的实测改判）

- **E-1 探针结果推翻 §3 的 `SHELL` 判决**：8 个游离 sketch 中 **5 个顶层 shapeType = `SHELL`**（pin-header ×2、M24、45x45 ×2），3 个 = `COMPOUND`（含 0 solid）。§3 原把 shell 判为「导出（保留现状）」⇒ 只能拦 3/8。
  改判依据：① 旧栈 A 组 9/9 真实件顶层全 `SOLID`/`COMPOUND` 且 `solids≥1`，语料无「合法 2D 面模型」；② 改前 `cli.ts` **0 处** shell 逻辑，无既有行为要兼容；③ §9-R2 预案本就约定「若为 shell 立即回 §3 改判决」。
  ⇒ **最终判决：`SHELL` 且无子实体 → 跳过**（与 `COMPOUND` 同款：`getSubShapes(h,'solid').length > 0` 才导出）。
- **不再递归分层**：内核 `getSubShapes`（OCCT `TopExp_Explorer` 语义）对任意嵌套深度一次取全部子实体；`compsolid` 不在 L1 `BrepSubShapeType` 联合里，无法直接查子形状。故 `COMPOUND`/`SHELL` 分支各一次 `getSubShapes('solid')` 即足。
- **判据可注入**：`isExportableSolid(shape, probe)` 的 `probe` 参数（`{shapeType, getSubShapes}`）使 §5 判决矩阵可用假 kernel 测，零 OCCT 启动。
- **I-1…I-6 全部落地**（`packages/core/src/node-host/cli.ts`）：判据 + `selectExportableTerminals` 之后过滤 + 封 last-output 后门 + `writeAssemblyStep` 兜底同判据 + `infos` 报告。
- **§5 变异验证通过**：判决反写 ⇒ 8 用例变红（矩阵 6 + §5-4 + §5-5）。
- **E-3 V-1 通过**：3 样本产物集合 == 旧 A 组，4 对同名 STEP 六位有效数字全等。
- **E-4 未执行**（V-2 60 样本 / V-3 全量）。

---

## 1. 结论先给

**推荐方案 A：导出层加「三维实体判据」——终端集合不变，UI 显示不变，只拦 STEP/STL 落盘。**

| | 判据 | 位置 | 影响面 |
|---|---|---|---|
| 终端集合（`terminals`） | 不动 | `cad-runtime/live-shapes.ts:214-251` | 无任何变化 ⇒ **未消费草图照旧显示** |
| 显示面 | 不动 | `packages/faijs-viewer/src/open-fai-zip.ts:56`（`terminals.filter(t => !t.hidden)`） | 无变化 |
| CLI 预览面 | 不动 | `cli.ts:488-519 selectViewShapes` | 无变化 |
| **导出面** | **新增：句柄必须含至少一个 solid** | `cli.ts:395` 之后、单/多终端分支之前 | 只影响 `.step`/`.stl` 落盘 |

一句话原则：**"谁该被看见" 与 "什么能落成零件" 是两件事，前者由终端集合决定（不动），后者由导出层决定（新增判据）。** 不在 `fcstd-port` 侧做过滤（那是在消费者里补旁路开关，违反本项目铁律）。

---

## 2. 事实基础（本轮全部实测，非推断）

### 2.1 现象：新多出来的产物**全部是**未被消费的 `cad.sketch` 变量

同一批 `.fai.zip`（0.27.0 固定转换产物），内核 3.8.4/core 0.27.0（10-03 产出）→ 内核 5.6.0/core 0.29.5（10-06 重跑），按文件 mtime 区分新旧（KEEP_STEPS 是累积目录，见 §7 的方法论坑）：

| 产品 | 旧终端导出 | 新终端导出 | 增量 |
|---|---|---|---|
| `00300e4653b7-Sliding_door` | `0_Fillet`, `1_assembly` | `0_Sketch`, `1_Fillet`, `2_assembly` | **`Sketch`** |
| `0140e0a33363-2x1-male-pin-header` | 单文件（= assembly） | `0_Sketch001`, `1_Sketch002`, `2_assembly` | **2 个 sketch** |
| `01154871d647-Screw M24x130 ISO4762` | 单文件（= assembly） | `0_Sketch001`, `1_assembly` | **`Sketch001`** |
| TO92 / 两个矩形管 / M1.6LooseMin | 单文件 | 单文件 | 无（几何全等，见 2.3） |

脚本侧证据 `out/batch/00300e4653b7-Sliding_door.fai.zip` → `model/main.fai.js`：
- `:15` `let Sketch = cad.sketch({...})` —— **无任何消费者**（`:28` 的 compound members = `[Window, Extrude_Sketch001, Array, Extrude_Sketch002, Array001, Part__Mirroring__place]`，不含 `Sketch`）
- `:25` `let Fillet = cad.fillet(Extrude_Sketch003, ...)` —— 被 `:26` 的 `cad.mirror(Fillet, ...)` 消费（**旧栈也导出它，属相邻缺陷，见 §8-D1**）

### 2.2 多出来的东西是 2D 面片，不是实体

`fcstd-port/out/_g0c-sketch.txt`（OCP 量测）：

| 文件 | volume | area | solids | faces | bbox (mm) |
|---|---|---|---|---|---|
| `Sliding_door__0_Sketch`（多出） | 1.17e-10 | **5.04e+06** | **0** | 3 | 2400 × **2e-07** × 2140 |
| `Sliding_door__1_assembly`（真实件） | 7.19e+07 | 5.50e+06 | 6 | 50 | 2500 × 460 × 2190 |
| `pin-header__0_Sketch001`（多出） | 0 | 0.16 | 0 | 1 | 0.2 × **2e-07** × 0.8 |

⇒ 厚度 2e-07（浮点噪声级）、solids=0。它是**带 BREP 句柄的面（或面 compound）**，不是网格。

### 2.3 真实件本身没变 —— 排除"内核/数据结构 regression"

`out/_g0c-pairs.txt`：pin-header 旧单文件 vs 新 `__2_assembly`、**volume/area/solids/faces/bbox 六位有效数字全同**（179.781 / 545.989 / 7 / 274 / 4.98×11.2×13.25）；M24 旧 vs 新 `__1_assembly` 同样全同（159772 / 30082.9 / 2 / 23 / 38.97×38.97×154）。

⇒ **唯一变量 = 终端集合多了一类成员（未消费的 2D sketch）**，不是几何计算变了。

### 2.4 它如何毁掉 parity

`fcstd-port/tools/parity-judge.py:73 merge_parts`（在 `:157` 对多终端调用）把多 STEP 的 **area 相加、bbox 求并**。加了 `0_Sketch` 后：Σarea = 5.50e+06 + 5.04e+06 ≈ 1.05e+07，**相对 ~91%**，而 `parity-judge.py:33 bbox_rel_err` 用的容差是 1e-5 ⇒ area 判定必 FAIL。（bbox 因真实件覆盖，侥幸不受影响。）

> ⚠️ **更正此前记录**：上一版结论写的是"Sliding_door 2 个 → 5 个"。KEEP_STEPS 是**累积目录**，那个数字混入了 10-03 的旧文件；真实增量是 **2 → 3**（只多 `Sketch`）。同理 `_g0c-ab.txt` 的 8 个"同名全等"里**只有 4 个**（TO92、两个矩形管、M1.6）是真正的新写文件参与对比，另 4 个因新栈改了命名而**从未被覆盖，是旧 vs 旧的自证**。结论不变（几何零回归），但证据强度从 8 降为 4 —— 已用 §2.3 的两对"旧 vs 新真实件"补足。

---

## 3. 判决表（`BrepEngineApi.shapeType` + `getSubShapes`，均属 L1 契约）

内核返回联合 `node_modules/occt-wasm/dist/types.d.ts:184`（`compound|compsolid|solid|shell|face|wire|edge|vertex|shape`），L1 能力名 `shapeType`（`brep/engine/types.ts:344`）、`getSubShapes`（`:358`），接口见 `brep/engine/primitives.ts:216`、`getVolume :267`。既有用法可参考 `api/brep-mirror/healingFns.ts:70,102,191` 与 `api/brep-topology.ts:56`。

| shapeType | 判决 | 理由 |
|---|---|---|
| `solid` / `compsolid` | **导出** | 真零件 |
| `shell` | **含子实体 → 导出；否则跳过**（E-1 改判，见 §0） | 原「保留现状」被实测推翻：5/8 游离草图顶层即是 shell |
| `face` / `wire` / `edge` / `vertex` | **跳过** | 本次目标：无实体的 2D 片面 / 1D 线框 |
| `compound` | **递归**：含 ≥1 solid/compsolid → 导出；仅 face/wire/edge/vertex → 跳过 | Sliding_door 的 sketch 实测 `faces=3` ⇒ 很可能是 compound-of-faces，**不递归就会漏判** |
| `shape`（枚举兜底） | **导出** | 保守，零回归 |
| **无 BREP 句柄**（纯 mesh 终端） | **导出** | mesh 零件导出 STEP 是既有能力（`d1a88d00`），不借本批收紧。见 §9-R3 |

实现上不分层递归：内核 `getSubShapes(h,'solid')`（OCCT `TopExp_Explorer` 语义）对任意嵌套深度**一次取全**子实体（`compsolid` 不在 L1 `BrepSubShapeType` 联合里，不能直接查）。探针抛错 → 保守放行。

---

## 4. 实施清单（精确到位）

| # | 改动 | 位置 |
|---|---|---|
| **I-1** | 新增 `isExportableSolid(...)`：输入 `execResult` + terminal id，按 §3 判决表返回 boolean | `packages/core/src/node-host/cli.ts`（新私有函数，靠 `brepSolids` 取 `{solid, kernel}`，**全部经 L1 `BrepEngineApi`，不直连 wasm**） |
| **I-2** | `exportExecutionResult` 在 `selectExportableTerminals`（`:395`）之后、单终端分支之前，套一层 3D 过滤 | `cli.ts:395` 附近 |
| **I-3** | **封住回退漏洞**：`:408-421` 的"无终端 → 用最后一个 output"不能直接吃掉被过滤的 2D 终端——过滤后为空但原非空时，必须按 all-hidden 同款报错（`:401-406` 的写法），否则会把刚删掉的 sketch 从后门写回去 | `cli.ts:408-421` |
| **I-4** | **第二个漏点**：`writeAssemblyStep` 的兜底路径 `:728-739` 遍历 **全体 `brepSolids`**，2D sketch 的句柄同样会进这里 ⇒ 同一判据必须也套在这条路上 | `cli.ts:728-739` |
| **I-5** | 被跳过的终端写进 `infos`（一行，含名字） | 同上函数返回路径 |
| **I-6** | STL 同口径（`writeOutput :619` 的 `fmt === 'stl'` 分支同样不该导出面片）——已由 I-2 在调用前统一过滤，无需单独改 `writeOutput` | `cli.ts:619`（不改） |

**不动**：`live-shapes.ts`（终端计算）、`selectExportableTerminals`（保持只管 hidden，语义纯净）、`selectViewShapes`、`faijs-viewer`。

---

## 5. 测试清单（按仓库铁律：一次性验证必须保留为 `.test.ts`，且必须做过变异）

单测 `packages/core/src/node-host/cli.test.ts`（现有 suite 在 `:345`，是 hidden 判据的一组，扩充新一组）：

1. **判决矩阵表驱动**：`solid/compsolid/shell/face/wire/edge/vertex/shape` × {导出, 跳过} —— 用假 kernel（`shapeType` stub）注入，**不需要起真实 OCCT**。
2. `compound`：① 含 solid → 导出；② 仅 faces → 跳过；③ 嵌套两层 compound 含 solid → 导出。
3. 无 BREP 句柄的 mesh 终端 → 导出（零回归钉子）。
4. 混合：含 1 个 2D + 1 个实体的脚本 → 只落一个 STEP，且文件名**不带** 2D 那个。
5. **全 2D 脚本 → 明确报错**，且**不许回退到 last output**（回归守卫：这条一旦退化，parity 会再次被污染）。
6. `hidden` 语义不受干扰（既有 5 条用例保持绿）。

e2e `packages/tests/` 或 fixtures：`.fai.js` fixture（一个游离 `cad.sketch` + 一个实体）跑真 CLI run `--out x.step`，断言产物清单。

**变异要求（必做）**：把判决表的 `face → 导出` 反向写一次，上述 2/4/5 必须变红，否则判测试无效。

---

## 6. 验证计划（fcstd-port 侧，分三级）

| 级 | 规模 | 判据 |
|---|---|---|
| V-1 | Sliding_door / pin-header / M24 三个已知样本 | 产物文件集合 **== 10-03 的 A 组集合**（含 `Fillet` 那条，见 §8-D1），且同名 STEP 与 A 组几何全等 |
| V-2 | 随机 60 个已 translated 产品 | 新旧逐产品或差：只允许两种差异 —— (a) 新侧多出的文件全都是 `solids=0` 的面片；(b) 旧侧比新侧多出的文件同上是面片。出现任何「新侧少了实体」或「共享文件几何数值变化」⇒ 停机排查 |
| V-3 | 全量 sweep → step-invariants → parity-judge | **parity PASS 集合 ⊇ 旧基线集合**，且不允许新增 `area` 类 FAIL |

前置（行政，非代码）：core 改动后必须 `npm run pack -- --only @faicad/faijs` 重打 tgz，并在 `fcstd-port` 重装 —— **改了 core 的 src 不重打 tgz 就等于没改**。

---

## 7. 方法论坑（本轮代价，写进规程）

**`out/run-sweep-steps` 是累积目录，不是单次产物目录。** 同一个 product 跨周多轮的 STEP 会共存（`tools/run-sweep.ts:117,205-221`），且文件名里只有 `${stem}` 或 `${stem}__${i}_${name}`，**不带批次信息**。上一版结论被这个坑误导出"2→5"。

规程三条：
1. 任何 A/B 对比，输出目录必须是**每批次独立目录**（不要靠 stem 前缀从累积目录里捞）。
2. 判定"这是本轮产物"一律用 **mtime**，不用文件名。
3. Windows 下 `copyFileSync` **保留源 mtime**（CopyFileW 语义）⇒ 不能用副本的 mtime 判断拷贝时间（本轮 A 组副本全是 10-03 的时间戳，差点再次误导）。

建议顺带给 `run-sweep` 加 `--steps-dir` 隔离（属 fcstd-port，本批不做，登记 §8-D3）。

---

## 8. 相邻缺陷（本次**不改**，留档单独立项）

| ID | 缺陷 | 证据 | 为什么析出 |
|---|---|---|---|
| **D-1** | `Fillet` 已被 `cad.mirror(Fillet, ...)` 消费，却仍是终端并被导出 | Sliding_door `:25` vs `:26`；**新旧栈都有**（10-03 也有 `0_Fillet`）⇒ **不是本轮引入** | 与本议题无关，但它同样污染 parity 的 area/bbox，须单独测量后立项 |
| **D-2** | "已被消费的中间特征成为终端" 这一族是否普遍 | **已测量并更正（2026-10-06 v2，fcstd-port `tools/_d2-consumed-census.mjs` + 旧栈 STEP 文件名交叉）**：初版静态判定（866/27.6%）作废——它把 compound 对成员的组装误判为消费、且未剥离行尾注释。**更正后：全量 3,136 产品中 25（0.8%）** 确认「被消费 ∧ 非 compound 成员 ∧ 实际导出为独立终端」；有 truth 的 20 个里 **19 个** merged area 超 truth **1.37×–17.3×**（双重计数签名，`arduino-mega` 17.3×）。测量报告 `fcstd-port/out/d2-measure-report.md`（v2）。**立项建议**：量级小但确凿；根因在 core 消费判定（`live-shapes.ts` C0–C5）对特定形态（`__pos`/`__neg` 拆分变量、import_brep 链等）漏判，属 core 议题 |
| **D-3** | `run-sweep` 缺 `--steps-dir` 批次隔离 | §7 | fcstd-port 侧工具改进，不影响 core |

---

## 9. 风险登记

| ID | 风险 | 处置 |
|---|---|---|
| **R1** | 判据写错方向（把真实体判成 2D）⇒ 大量产品从 pass 变无产物 | V-1 先跑三个已知样本；V-2 的「新侧不得少实体」是硬断言；V-3 要求 PASS 集合 ⊇ 旧基线 |
| **R2** | `shell` 判为导出：若语料里的草图样貌其实是 `shell`，本方案就不生效 | E-1 探针先确认三个样本的真实形态是 `face` / `compound`；若为 `shell`，立即回 §3 改判决并补 §5 用例 |
| **R3** | mesh-only 的 2D 终端（无 BREP 句柄）本方案拦不住 | 已知且明确接受（保守换零回归）。若 V-2 里出现「新侧多出、solids=0，但本方案没拦住」，则补 tier-2：用 `getBoundingBox` 的无量纲厚度比 `minExtent/maxExtent ≤ 1e-9` 判定（实测本例 8e-11 ≪ 1e-9，而 1mm/1000mm 的板金件是 1e-3，天然可分） |
| **R4** | 改 `cli.ts` 属于 CLI 面；若 GUI 另有导出路径（不经 `cliRun`）则会不一致 | 实施前 grep 确认导出入口唯一性（目前 grep 显示 `selectExportableTerminals` 无外部消费者，`dist` 除外），若发现第二条路径必须在同一批收口 |
| **R5** | 在 V-3 复跑之前，**既有 parity PASS 数字（freecad 侧记录的 860）不可信** | 数字以 V-3 复跑后的新基线为准，不得引用旧数字对外汇报 |

---

## 10. 批次与验收

| 批 | 内容 | 验收 |
|---|---|---|
| **E-1** | shapeType 探针：确认 Sliding_door / pin-header / M24 三个 sketch 的真实 `shapeType`（face？compound-of-faces？shell？） | ✅ **已完成**：Sliding_door=`COMPOUND`(3 shells)；其余 5 个 `SHELL` ⇒ 已按预案回 §3 改判决（见 §0） |
| **E-2** | I-1…I-6 实施 + §5 单测（含变异） | ✅ **已完成**：`cli.test.ts` 55/55、tsc 0 错、eslint/ghost-deps/lockstep 全绿；变异 8 用例变红 |
| **E-3** | 重打 core tgz → fcstd-port 重装 → V-1（3 样本） | ✅ **已完成**：产物集合 == A 组；4 对同名 STEP 六位有效数字全等 |
| **E-4** | V-2（60 样本差分）+ V-3（全量） | **V-2 ✅ 通过（2026-10-06）**：60 样本（随机 seed 20261006，排除 Sprocket，清单 `fcstd-port/out/e4-v2-picks.json`）新栈重跑 60/60 ok；与旧栈基线差分（`fcstd-port/tools/_e4-v2-diff.py`，容差 1e-5）**newOnly=0 / legacyOnly=0 / sharedOk=61 / hardFail=0** —— 实体数全等、volume/bbox 相对差 <1e-5。摘要 `fcstd-port/out/e4-v2-summary.md`。**V-3 未执行** |

**实施前置批准**：本改动位于 `packages/core`（非本议题所属的两个独立仓），按既有铁律，动手前须用户确认一次。
