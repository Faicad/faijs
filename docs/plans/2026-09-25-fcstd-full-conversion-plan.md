# FCStd 全量转换 · 开发计划（2026-09-25）

> 状态：**方案（未实施）**。目标：把 `D:/Faicad/FreeCAD-library` 的 3,201 个 `.FCStd` 全部转成 faijs 格式（`.fai.zip`），以几何对拍 `parity=pass` 为准入库。
> 本计划的执行对象是 **faijs 引擎代码**（`packages/core/src/`），不是 fcstd-port 的报表/流水线。

---

## 0. 需求原话

> "你的计划不应该依赖于流水线，你应该发现问题就解决问题，发现一个解决一个先解决问题，而不是要等所有的问题，全部发现以后再解决，请按照我的这个思路重写你的开发计划，你的目标是写代码，你这个方案是一个开发计划，不是查漏补缺，不是看现在的整个进度怎么样，你绝对不能等现在的进度。"

---

## 1. 开发原则（本轮纠错）

1. **不等基线，立即修**：不先跑全量把所有问题找齐再动手。直接从手头一个已知失败文件出发，定位根因 → 改代码 → 验证 → 提交 → 下一个。
2. **目标是写代码**：每个工作项都落到"改哪个文件、加什么功能、加什么单测"，不是"跑什么报表、看什么分布"。
3. **发现一个解决一个**：不把问题攒成清单再批量处理。稳定性问题（如 WASM 挂起）在撞上的那个文件上顺手解决，不单独停下来做"阶段 0"。
4. **单文件闭环**：一个文件的 `convert→run→truth→inv→parity` 在 `process-one <file> --reconvert` 里走通即闭环，不依赖全量跑。
5. **无强制顺序**：下列工作项彼此独立，任何一个都可以立刻开始；唯一的方向性依赖是"扫掠/放样/螺旋需要先有内核 op"。

---

## 2. 开发循环（每个工作项的标准动作）

对任意一个失败签名，重复：

1. **取点**：从下表取一个具体文件（已给出）。
2. **复现**：`python tools/process-one.py "<rel>" --reconvert`，看到失败签名。
3. **定位**：顺着签名（`callee: <op>`、statement 号、`edgeRef` 文本）二分到 faijs 源码的具体分支。
4. **改代码 + 单测**：修根因；在 `packages/core/src/**/*.test.ts` 加合成 fixture 单测（GOTCHA 留档踩坑，参考 P0-4 的 `valueX/valueY/valueZ` 形式案例）。
5. **验证**：同一文件复跑 `process-one --reconvert`，直到该文件 `parity=pass`；再跑相邻同签名的 2–3 个文件确认不回归。
6. **提交**：`npm run build -w @faicad/faijs` → `npm pack -w @faicad/faijs` → fcstd-port `npm install` → 提交（conventional commits，写明消掉的 reason/签名）。

---

## 3. 工作项（逐个击破，每个含具体取点文件）

### A. run 期缺口（convert ok，run 失败）

样本量来自 0.15.1 已完成重跑的 315 个 convert-ok 文件。

| id | 失败签名 | 取点文件（立即可跑） | 根因方向 | 改动位置 |
|---|---|---|---|---|
| **A1** | `mirror: E_OP_FAILED`（43 个） | `Electrical Parts/Servos/Futaba3003/Futaba3003-4-arms-horn.fcstd` | `Part::Mirroring` 翻译出的 `cad.mirror` 输入（镜像平面/基体解析） | `api/mirror.ts` + `feature-translate.ts` Mirroring 分支 |
| **A2** | `fillet: edgeRef: adjacent face ordinal N has no role lineage`（63 个） | `Architectural Parts/Bedroom/Beds.FCStd` | **不是血统断裂**——是 `cad.extrude` 的链根词汇表漏面：①侧面法向只在 `surfaceType==='plane'` 时取，弧段扫出的**圆柱侧面**无 role，且被 `wallIdx` 跳过（wall 序号脱离 profile 边序）；②拉伸轴取「第一对反平行平面法向」，而方柱的**对侧平面侧壁也反平行**，Beds part28 因此把 X 向侧壁判成端盖、真端盖成了 wall | **RESOLVED**（2026-09-26）：`api/extrude.ts` — 侧面判定不再限平面 + 轴由 op 的拉伸方向 hint、几何确认。实证：Beds part28 面覆盖 6/10 → **10/10**（wall:0..7）；全文件 convert ok + `cliRun` ok + STEP 4930 ents。回归护栏 `packages/core/src/api/extrude-wall-role-gotcha.test.ts` |
| **A3** | `revolve: REVOLVE_FAILED` / `dependency module failed`（19 个） | `Architectural Parts/Garden/FCBL_tree_entourage.FCStd` | 草图弧 `ccw:false` 被当成 CCW 长弧 → 轮廓跨转轴 → 退化回转体 → OCCT BRepMesh 无限挂死 | **RESOLVED**（`d90ac8e8`）：`api/sketch.ts` 弧扫掠方向/中点/整圆拆分均随 `ccw`。护栏 `src/api/sketch-arc-ccw-gotcha.test.ts`；探针 `scripts/probe-a3-crash.ts` / `probe-a3-revolve.ts` 保留 |
| **A4** | `chamfer: edgeRef: edge ordinal N out of ...` / `adjacent face ordinal N has no role lineage`（19 个，**已验证消解**） | `Electrical Parts/Batteries/battery-AAA.fcstd` | chamfer 边引用面无角色血统（同 A6 lineage 重构消除） | **RESOLVED** —— 3/3 `cliRun` 通过、无 `no role lineage` / `edgeRef` 报错；fcstd-port 新增 `test/FreeCAD/a4-edge-ref-regression.test.ts` 回归护栏 |
| **A5** | `run-timeout`（6 个） | `Electronics Parts/Boards/Arduino/Arduino UNO/arduinounopcb.FCStd` | WASM 执行挂起（solver 或布尔死锁） | 在撞上的文件上：给 run 加 per-file 看门狗（挂起即杀、记 fail、继续） |
| **A6** | `THREW: Maximum call stack size exceeded`（3 个，**已验证消解**） | `Electronics Parts/Boards/Arduino/Arduino UNO/arduinounomissblack.FCStd` | 递归爆栈；根因已随 topology lineage 重构消除（roleTable 降为缓存 + §1.4/1.5 lineage 登记），非单点修复 | **RESOLVED** —— 13/13 `cliRun` 通过、到达 STEP 导出无爆栈；fcstd-port 新增 `test/FreeCAD/a6-stack-overflow-regression.test.ts` 回归护栏 |

> A5 是"发现一个解决一个"的典型：不把它当"前置阻塞阶段"，而是在处理到 `arduinounopcb.FCStd` 时，顺手把看门狗加上，让该文件记 timeout 后循环继续。

### B. convert 期缺口（翻译阶段 `stage1=gap`）

根因分析见 `reports/reason-cascade.md`（结论部分仍有效，频次数字已过时）。

| id | 缺口 | 根因方向 | 改动位置 |
|---|---|---|---|
| **B1** | 参数载体（`<<Label>>.Alias` + `Spreadsheet::Sheet`/`App::VarSet` + Pocket 下游清账） | 三跳解析：按 Label 找对象 → 按 alias 找单元格 → 去 `=` 交给现有 `evalConstantExpression`；算术顺带 | `feature-translate.ts` + `expressions.ts`（P1-1 已落地主体，取一个仍 gap 的文件验证剩余） |
| **B2** | `Part::Loft` / `Part::Compound` 翻译缺口（`loft-section-baked-upstream` / `compound-missing-members`） | `depsOf`（codegen）少了 `Sections`／`Spine`／`Source`／`Sketch` 这几条依赖边——与 ArchDetail `Links` 同类缺陷。Kahn 按文档序放置特征，`inputVar()` 取不到尚未构建的上游 | **RESOLVED**（2026-09-26）：`feature-translate.ts` 导出 `LINK_INPUT_PROPS` / `LINK_LIST_INPUT_PROPS` 作为唯一真值，`codegen.ts depsOf` 消费；另加环断裂（不再静默丢弃对象）。实证：Beds `translated` 31→33、`gaps` 2→0 |
| **B2′** | 草图求解 `sketch-not-solved`（含相切模式） | 约束求解器缺类型/模式 | `lang/sketch-solver.ts` + `fcstd/planegcs-backend.ts`（P3-2/P3-4 已部分） |
| **B3** | 外部几何 `external-geometry-unresolved` | 外部几何子元素投影（P3-3 已修弧线，取一个仍 gap 的文件验证剩余） | `fcstd/convert.ts` + `external-geo.ts` |
| **B4** | pattern 源（linear/polar） | 源链接解析（P3-1 已落地，验证剩余） | `feature-translate.ts` |
| **B5** | `chamfer/fillet-missing-base`、`fillet-non-edge-sub`、`pad-missing-profile` | 各特征上游缺失，多为级联后果 | 随上游消解；个案定位 |

### C. 功能缺口（尚未开发的能力）

| id | 功能 | 依赖 | 改动位置 |
|---|---|---|---|
| **C1** | 扫掠/放样/螺旋（`Part::Sweep`/`Loft`/`Helix`） | 需先补内核 op `cad.sweep`/`cad.loft`/`cad.helix` | `api/` 新 op + `feature-translate.ts` 翻译分支 |
| **C2** | `App::Link*` 镜像系 / 跨引用系 / 布尔系 | 依赖上游 feature 已翻译 | `feature-translate.ts` |
| **C3** | 曲线/Frenet/面附着支撑 | — | `placement.ts` + `attachment.ts` |

### D. 对拍缺口（`parity=fail`，convert+run 均成功但数值不对）

| id | 现象 | 根因方向 | 改动位置 |
|---|---|---|---|
| **D1** | 真实几何差异：faijs 几何 Z 偏移 2.5、体积差 44% 等 | 几何算子偏差（布尔/挤出方向/placement 合成/单位角度口径） | `boolean/`、`brep/`、`placement.ts` 等 |

> D1 与 A/B 不同：不是执行失败，是**数值不对**。取一个 `parityFails` 含具体项的文件，逐项定位偏差来源。

---

## 4. 为什么不需要"先跑全量基线"

- 全量基线的唯一作用是"把问题列全"，但本计划**不要求列全**——上面 A/B/C/D 的取点文件已经够开始写代码。
- 全量跑本身慢且会撞上 WASM 挂起；把"跑全量"当成前置条件，等于把开发卡在数据收集上。
- 正确节奏：**修一个 → 该文件 pass → 提交 → 顺手取下一个**。全量基线在开发过程中自然逐步覆盖，不需要单独作为阶段。

---

## 5. 实施纪律

1. **每项一个文件**：实现前先在该文件上跑一次确认失败形态；实现后跑同一文件确认通过。
2. **测试留档**：每项实现伴随 faijs 内合成 fixture 单测，GOTCHA 注释标注踩坑（两种 `value` 序列化形式等）。
3. **每项独立提交**：提交信息写明消掉的 reason/签名（conventional commits）。
4. **不重写流水线**：用已有 `process-one.py --reconvert` + `run-single-file.py`，缺步骤就加，不另起新脚本。
5. **真差异显式留 reason**：不允许靠放宽阈值变绿。

---

## 6. 验收

- 逐项关闭：对应文件 `convert ok`（无 gap）+ `run ok` + STEP 落盘 + `parity=pass`。
- 每个工作项有对应单测；改动后相邻同签名文件不回归。
- 全部关闭 ≠ 结束：真差异必须显式留 reason。

---

## 7. 立即开始的第一批（建议顺序）

1. **A1 mirror**（43 个，量最大）：取 `Futaba3003-4-arms-horn.fcstd`，定位 `cad.mirror` 的 E_OP_FAILED。**已修**（`f8fc561`，去掉 translate 里误加的 `noPositionalArgs`，位置源形状不再被丢弃）。
2. **A2 fillet 血统**（63 个，量最大）：取 `Beds.FCStd`。血统类根因**已随 lineage 重构消解**（同 A4/A6），但本样本 convert 仍卡 B1/B2（`Loft002`/`Compound001` 未实现），run 验证待 B1/B2 落地。
3. **A3 revolve**（19 个）：取 `FCBL_tree_entourage.FCStd`。
4. **A4 chamfer**（19 个，**RESOLVED**）：取 `battery-AAA.fcstd` —— 实证 3/3 `cliRun` 通过；fcstd-port 已加回归护栏 `test/FreeCAD/a4-edge-ref-regression.test.ts`。
5. **A6 爆栈**（3 个，**RESOLVED**）：取 `arduinounomissblack.FCStd` —— 实证已消解，无需改码；fcstd-port 已加回归护栏。
6. **A5 看门狗**：处理到 `arduinounopcb.FCStd` 时顺手加。

> 每完成一项即提交，不等其他项。
