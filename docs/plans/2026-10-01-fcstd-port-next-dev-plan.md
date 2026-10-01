# FCStd → `.fai.zip` 移植：0.22.5 全库重转后的下一阶段开发计划（2026-10-01）

- Status: 方案（未实施）
- 引擎基线: faijs `0.22.5`（`config.faijsVersion`，已确认）
- 语料: `D:/Faicad/FreeCAD-library` 3,201 `.FCStd`
- 转换工程: `D:/Faicad/fcstd-port`
- 前置文档: `docs/plans/2026-09-28-fcstd-port-progress-review-and-next-plan.md`（P0 已完成、P1 基线已重建）、`docs/plans/2026-09-29-fcstd-draft-sprocket-timeout-plan.md`（A1/A2 已落地、A3 Sprocket 已解除隔离）

## 0. 用户原话汇报（2026-10-01）

> 全库重转 + parity 重判全部完成，四态漏斗汇报如下：
>
> 端到端漏斗（0.22.5 引擎，2026-10-01）
>
> | 阶段 | 旧基线（09-28，0.19/0.21 引擎） | 新数字（0.22.5） | 变化 |
> |---|---|---|---|
> | stage1 翻译 ok | 2,391（74.7%） | 3,103 / 3,201（96.9%） | gap 800 → 98 |
> | stage2 执行 ok | 1,215（38%） | 2,559（80%） | 翻倍 + |
> | parity pass | 153（4.8%） | 883（27.6%） | 153 → 883（×5.8） |
> | promoted 入库 | 142 | 142（未跑 --promote） | 待你批准后再跑 |
>
> 关键变化解读
>
> - 停滞数月的 153 已破：parity pass 从 4.8% → 27.6%，证实此前停滞的主因确实是「度量不闭环（judge 从未重跑）+ nameless-shape/旧引擎假象」叠加。
> - stage2 ok 2,559：含 449 个 Sprocket 解除隔离后大量转 ok（Draft 解析重建生效；旧引擎下这批 100% 产不出 STEP）。
> - parity fail 1,272 的新构成：com 1,168 / volume 990 / area 977 / bbox 657 / solids 553——solids 失配（553）是新暴露的大类（多终端产物 merge 或 compound 拆分语义），是下一批 singleFix 的头号候选；com/volume 类需重定性（含旧 cylinder 假象消除后的真实残余）。
> - no-truth 399：真值侧无记录（多为新增 ok 的 Sprocket 等），需补跑 truth 生成才能进 parity 分母——这是 parity 数字还能再涨的明确空间。

## 1. 当前漏斗（实测，2026-10-01 10:41，`out/stage3-parity/parity.json` + `logs/stage3-0225.log`）

| 阶段 | 数量 | 占全库 |
|---|---|---|
| stage1 翻译 ok | 3,103 | 96.9% |
| stage1 翻译 gap | 98 | 3.1% |
| stage2 执行 ok（产 STEP） | 2,559 | 80.0% |
| stage2 run-fail | 472 | 14.7% |
| stage2 timeout | 88 | 2.7% |
| stage2 failed | 12 | 0.4% |
| parity pass | 886 | 27.7% |
| parity fail | 1,661 | 51.9% |
| parity no-truth | 2 | 0.1% |
| parity no-step | 11 | 0.3% |
| promoted 入库 | 1,006 | 31.4%（已入库） |

> 注：上表 parity 数字为 **A1 执行后**（2026-10-01，真值重跑 688 条 stale 记录）的修正口径；A1 执行为 `docs/plans/2026-10-01` 本计划 §3-A1，已完成。修正前（真值陈旧）为 pass 883 / fail 1,272 / no-truth 399。

### 1.1 parity fail 1,661 的量级画像（`parity.json` failClasses + verdicts 实测）

| 失配量 | 文件数 |
|---|---|
| com（质心） | 1,555 |
| volume | 1,363 |
| area | 1,352 |
| bbox | 1,036 |
| solids（实体数不符） | 922 |

**solids 失配的 N 分布**（faijs 侧 vs truth 侧）：

| 模式 | 数量 | 含义 |
|---|---|---|
| `1vs2` | 651 | faijs 产 1 个 solid，truth 2 个——主模式 |
| `1vs6` | 30 | faijs 1，truth 6 |
| `3vs2` | 21 | faijs 3，truth 2 |
| `1vs4` | 13 | faijs 1，truth 4 |
| `1vs0` | 9 | faijs 1，truth 0——truth 侧未识别到 solid |
| 其余 | ~198 | `1vs3` / `1vs7` 等零散 |

主模式（`1vsN`，N>1）强烈暗示 **compound merge 语义**：faijs 侧把多实体产成一个 compound（按 1 个 solid 计），或 STEP 导出把 compound 写成单 solid；truth 侧统计的是独立 solid 数。

**com 偏移量级分布**：

| 量级 | 数量 | 初判 |
|---|---|---|
| >= 100（大偏移） | 684 | 真实几何错位（placement/attachment 链） |
| 1 ~ 100 | 202 | 待定性 |
| 1e-2 ~ 1 | 311 | 待定性 |
| < 1e-2（微小） | 358 | 疑似精度/口径问题，可能非真实几何差异 |

**fail 组合 top 1**：100 个 `(area, solids(1vs2), volume)`——solids 1vs2 + area + volume 三联失配，是 solids 类的典型形态。

### 1.2 no-truth 2 的原因（A1 后）

余 2 个：`Half concrete block`（root `PartShape.brp` 0 字节，但 feature `Pocket` 有形状——可恢复的「空 tip」形态）、`door-sealing-2`（Body→Boolean→Body001→Clone→Body 引用成环，root-only 启发式返回空）。A1 前为 399 个，均为真值文件陈旧（早于 2026-09-26 root 修复）。

### 1.3 stage2 run-fail 472 构成（`reports/run-sweep.md`，2026-10-01 03:12）

| 类 | 数量 | 典型错误 |
|---|---|---|
| other（scratch dir missing） | 271 | `ENOENT: ... copyfile '...\out.step'`——worker 产出了空 scratch 目录 |
| nameless-shape (edgeRef) | 203 | `edgeRef: adjacent face ordinal N has no role lineage`（fillet callee） |
| timeout（120 s） | 88 | Mannequin、Plate Wheel、arduinounopcb |
| threw-other | 8 | parser `SEC_FREE_IDENT`（Chamfer/Sketch007 未声明）、`Maximum call stack`、import 位置 |
| nameless-shape (role table) | 2 | `faceRef: input shape has no role table`（extrude callee） |

## 2. 缺口分类与开发方向

按用户要求，本计划**按工作项组织、发现一个解决一个、无强制顺序**。每组给出建议优先级但不强制；任何一项可立即开始。开发循环（纪律不变）：

```
取点（挑一个失败文件）→ process-one.py --reconvert 复现 → 定位源码
→ 改代码 + 单测 → 同文件复跑至 pass → rebuild + 提交 → 下一个
```

- 一类一修、一修一测、一次一提交。
- 严禁 `--no-verify`；stderr 零容忍；长任务串行。
- 不等全量基线，直接取一个失败文件改代码。

### 工作项分组总览

| 组 | 方向 | 数量级 | 建议序 |
|---|---|---|---|
| A | parity 分母扩充（no-truth 真值补跑） | 399 → 2（已执行） | ✅ 完成 |
| B | solids 失配（compound merge 语义） | 922 | 头号 singleFix |
| C | com/volume 失配重定性 + 修复 | 1,555 + 1,363 | B 后或并行 |
| D | stage2 run-fail（scratch dir / edgeRef / timeout / threw） | 472 | 随需 |
| E | stage1 残余 gap 清零 | 98 | 随需 |

---

## 3. 工作项

### A 组：parity 分母扩充（低垂果实）

#### A1 补跑 no-truth 真值生成 ✅ 已完成（2026-10-01，提交 `2d90cfd`）

- **实际根因**：不是「Sprocket 未跑过真值」，而是 `out/stage3-truth/fcstd-truth.jsonl`（2026-09-23）**早于 2026-09-26 的 root 识别修复**——688 条记录仍带旧的 `no readable root shapes`，其中 399 条因已有 STEP 而显示为 parity no-truth。
- **做法**：给 `tools/export-truth-driver.py` 加 `--only <listFile>`（复用其逐文件 timeout 保护），对 688 条 stale 记录逐文件重跑；合并成 v3 真值并重判 parity。
- **实测结果**：688 条中 **677 条转 ok**；no-truth 399 → **2**；parity pass 883 → **886**，fail 1,272 → **1,661**，no-step 6 → 11。
- **关键发现（诚实汇报）**：新增进分母的 397 条中，**389 条 fail**（仅 3 pass、5 no-step）。pass 只涨 3——即这批「此前未计量的文件」绝大多数几何不匹配，主要是 **Sprocket `solids(1vs2)` + volume/area/com** 三联失配。修好度量后，solids 失配从 553 涨到 922（绝对数翻倍），才是当前第一大单点。
- **残余 11 条非 ok 的全局清单**：
  - 8 个 `quad_robot_*`（`Robots/Quadruped robot/Spider robot/01 FCStd/`）：单 member、`PartShape.brp` **0 字节**，源数据无几何 → 记 fail。
  - `Half concrete block`：root `PartShape.brp` **0 字节**，但 feature `Pocket` 有形状（9883 B）→ **可恢复的「空 tip」形态**，需 root 回退到 Tip feature。
  - `door-sealing-2`：`Body→Boolean→Body001→Clone→Body` **引用成环**，root-only 返回空 → **可恢复**，需无 root 时回退（如取 Tip / Body 容器）。
  - `Lerge_V5_heatblock`：源几何退化 `Geom_TrimmedCurve::U1 == U2` → 记 fail（源数据问题）。
- **产物**：`out/stage3-truth/fcstd-truth.jsonl`（canonical，已备份 `.bak.pre-v3rootfix`）、`out/stage3-parity/parity.json`（canonical）、manifest truth/parity 字段已同步、`logs/stage3-0225.log` 已刷新。


---

### B 组：solids 失配 922（头号 singleFix）

#### B1 定性 solids 1vsN 失配根因

- **取点**：`0203a22597f2-Sprocket ANSI duplex`（`solids(1vs2)`，parts=2）、`02d55246310d-TS35`（`solids(1vs4)`，parts=3）、`04f6a668fdd0-3-5inch-Disk-Drive-SATA`（`solids(1vs6)`，parts=2）。
- **复现**：`python tools/process-one.py --reconvert <fcstd>`，检查产出的 `.fai.zip` 执行后 STEP 的 solid 数 vs truth 侧 solid 数。
- **定性三问**：
  1. faijs 侧 STEP 导出是否把 compound 写成单 solid？用 `python tools/step-invariants.py <faijs.step>` 看 solids 计数。
  2. truth 侧 `export-fcstd-truth.py` 的 solid 统计是否按独立 TopoDS_Solid 计（而非 compound 内嵌）？
  3. `parity-judge.py` 的 `merge_parts()` 对多终端产物的 solids 是否「求和」——若 faijs 侧 compound 只算 1 而真理侧求和，即口径错位。
- **判据**：明确 922 个中多少是「faijs 侧 compound 导出语义错」、多少是「truth/parity 口径错」、多少是「真实几何 merge 缺失」。

#### B2 修 faijs 侧 compound → STEP 导出的 solids 计数

- **前提**：B1 判明 faijs 侧把多 solid compound 写成单 solid。
- **改动位置**：`packages/core/src/brep/` 的 STEP 导出（`brep/engine/step-write.ts` 或对应），或 `packages/core/src/mesh/` 的 mesh 链 STEP 导出。确认 compound 的子 solid 在 STEP 中以独立 `MANIFOLD_SOLID_BREP` 产出而非嵌套。
- **单测**：合成一个 2-solid compound，导出 STEP，断言 `step-invariants.py` 读出 solids=2。
- **判据**：B1 取点的 3 个文件 solids 失配消除；同文件复跑 parity pass。

#### B3 修 truth/parity 侧 solids 统计口径

- **前提**：B1 判明是 `parity-judge.py` 的 `merge_parts()` 或 `export-fcstd-truth.py` 的 solid 统计口径错。
- **改动位置**：`tools/parity-judge.py` 的 `merge_parts()`（solids 求和逻辑）或 `tools/export-fcstd-truth.py` 的 solid 计数。
- **单测**：合成多终端产物（2 part × 2 solid），断言 merge 后 solids=4 而非 1。
- **判据**：口径修正后 922 个 solids 失配中属口径问题的部分消除。

---

### C 组：com/volume 失配重定性 + 修复

#### C1 分离 com 微小偏移 vs 大偏移

- **取点**：com 偏移 < 1e-2 的 354 个（如 `solids(1vs2)` + `com(1.59e-03)` 类）取一个；com >= 100 的 393 个取一个（如 `Sprocket ANSI duplex` com=4.48e+03）。
- **定性**：
  - 微小偏移（< 1e-2）：疑为数值精度 / 坐标系原点 / merge_parts 质心加权口径。取一个文件，对比 faijs STEP 与 truth 的 com 分量，看是否是原点平移常数。
  - 大偏移（>= 100）：真实几何错位，进 C2。
- **改动位置**（若微小偏移是口径）：`tools/parity-judge.py` 的质心比较容差或 merge_parts 质心加权逻辑。
- **判据**：微小偏移类重判后转 pass 或归入已知容差；大偏移类隔离进 C2。

#### C2 修 placement/attachment 链导致的 com 大偏移

- **取点**：com >= 100 的 393 个中取一个典型（如 `Sprocket ANSI duplex` com=4.48e+03，或含 Placement/Attachment 的文件）。
- **复现**：`python tools/process-one.py --reconvert <fcstd>`，检查产出的 `.fai.js` 中 `cad.place` / `cad.translate` / attachment 语句的参数 vs FCStd 源的 Placement。
- **改动位置**：`packages/fcstd/src/` 的 placement 翻译（`placement.ts` 或 `convert.ts` 中 Placement 解析）、faijs 侧 `api/place.ts` / `api/translate.ts`。
- **单测**：合成一个带 Placement 偏移的 FCStd fixture，断言转换后几何 com 与 truth 一致。
- **判据**：取点文件 com 失配消除；同文件复跑 parity pass。

#### C3 修 volume 失配的真实几何差异

- **取点**：volume 失配且非 solids 失配联带的（即纯 volume 差异）取一个。
- **复现**：对比 faijs STEP 与 truth 的 volume，差异 > 1% 的定位几何差异来源（拉伸高度 / 布尔运算 / 圆弧参数等）。
- **改动位置**：视根因定，可能在 `packages/fcstd/src/` 的特征翻译或 `packages/core/src/api/` 的 op 实现。
- **判据**：取点文件 volume 失配消除。

---

### D 组：stage2 run-fail 472

#### D1 scratch dir missing 271（worker 产物目录缺失）

- **取点**：`0031c9f93c85-TO92.fai.zip`（`scratch dir missing (worker produced no output): ENOENT`）。
- **定性**：worker 执行后 scratch 目录为空——是 worker 崩溃未清理、还是 worker 根本没产出（但 run-sweep 误判为 run-fail 而非 threw）？先确认这 271 个的 worker exit code 与 stderr。
- **改动位置**：`tools/run-sweep-worker.ts`（scratch 目录创建/清理逻辑）、`tools/run-sweep.ts`（失败分类）。
- **判据**：271 个中能跑通的转 ok；真崩溃的归入正确失败类。

#### D2 nameless-shape edgeRef 203（fillet lineage）

- **取点**：`00300e4653b7-Sliding_door.fai.zip`（`edgeRef: adjacent face ordinal 10 has no role lineage`，fillet callee）。
- **根因**：fillet/chamfer 选边时，相邻面的 role lineage 缺失——输入 shape 的面无 role table（导入 BREP / 布尔运算后产物 nameless）。
- **改动位置**：`packages/core/src/topology/`（role lineage 构造）、`packages/core/src/api/fillet.ts` / `api/chamfer.ts`（edgeRef 解析）、`packages/fcstd/src/`（翻译期是否给导入 BREP 补 role）。
- **单测**：合成一个「导入 BREP → fillet 选边」fixture，断言 edgeRef 能解析。
- **判据**：取点文件 run ok 且产 STEP。

#### D3 timeout 88

- **取点**：`0b71af9567ea-Mannequin_mp-dummy-1850mm-standing-004.fai.zip`（120 s timeout）。
- **定性**：Mannequin 是高面数人体模型（OCCT 布尔慢）；Plate Wheel 是阵列 + 布尔；arduinounopcb 是 PCB 高密度。判明是「真慢」还是「卡死」。
- **做法**：若真慢，提高 timeout 阈值或跳过（标 known-slow）；若卡死，定位卡点 op。
- **改动位置**：`tools/run-sweep.ts`（timeout 配置）；若卡死则修对应 op。
- **判据**：真慢的标 known-slow 不计 run-fail；卡死的修通。

#### D4 threw-other 8

- **子项**：
  - D4a parser `SEC_FREE_IDENT`（`Chamfer` / `Sketch007` 未声明，4 个）：翻译期生成的 `.fai.js` 引用了未声明的自由标识——是跨文档引用（ExternalReference）未正确翻译成 import。改动位置：`packages/fcstd/src/codegen.ts`（标识解析 / import 生成）。
  - D4b `Maximum call stack`（`arduinounomisswhite`，1 个）：递归爆栈。改动位置：视栈迹定位递归 op。
  - D4c `import/export at top level`（`Duct_linear_rectangular_circular_complet`，1 个）：生成的 `.fai.js` 把 import 放进了函数体。改动位置：`packages/fcstd/src/codegen.ts`（import 位置）。
- **判据**：8 个 threw 全部消除或归入正确失败类。

---

### E 组：stage1 残余 gap 98

#### E1 逐个取点清零残余翻译 gap

- **取点**：`state/manifest.jsonl` 中 `stage1=="gap"` 的 98 个，按 `convertError` / `gaps` 分类取点。
- **做法**：沿用既有 singleFix 纪律——一类一修、一修一测、一次一提交。每类修复伴合成 fixture 单测 + GOTCHA 标注。
- **改动位置**：视 gap 类型定，`packages/fcstd/src/` 各特征翻译分支。
- **判据**：98 个 gap 逐类下降；stage1 ok 率逼近 100%。

---

## 4. 验收判据

| 项 | 判据 |
|---|---|
| A1 | ✅ 已完成：no-truth 399 → 2；pass 883 → 886；四层漏斗已刷新 |
| B1 | solids 失配 922 的根因明确分类（compound 导出 / 口径 / 真实 merge 缺失） |
| B2 | 取点文件 solids 失配消除 + 单测留档 |
| B3 | 口径修正后 solids 失配中属口径问题的部分消除 |
| C1 | com 微小偏移重定性完成（口径 vs 真实） |
| C2 | 取点文件 com 大偏移消除 + 单测留档 |
| C3 | 取点文件 volume 失配消除 |
| D1 | scratch dir missing 271 中能跑通的转 ok |
| D2 | 取点文件 fillet edgeRef run ok + 单测留档 |
| D3 | timeout 88 分类完成（known-slow / 卡死已修） |
| D4 | threw-other 8 消除或归入正确类 |
| E1 | stage1 gap 98 逐类下降 |
| 全程 | 一类一提交、门禁全过、`--no-verify` 零使用、后台任务零并行 |

## 5. 验证与回归

- 每类修复伴合成 fixture 单测；不动非目标通路；stderr 零容忍。
- faijs 侧：`npm run test -w @faicad/faijs-fcstd -w @faicad/faijs-sketch -w @faicad/faijs` 取差；`npm run typecheck` 对基线取差。
- fcstd-port 侧：`npm run typecheck` + `npm run test`。
- 严禁靠跑全量 CI 找 bug；全量批次仅在基线重建时跑，且串行分批。
- parity 重判：`python tools/parity-judge.py` → `out/stage3-parity/parity.json` → 四层漏斗。

## 6. 风险与已知限制

- **no-truth 残余 2 个**：`Half concrete block`（空 tip，feature 有形状）与 `door-sealing-2`（引用成环）均为 root 启发式边界；修 root 回退前需先证明不影响已 ok 的 3,190 条真值（改 root 选择会全局生效）。
- **solids 失配可能是口径而非 bug**：B1 定性前不要假设全是 faijs 侧错；`parity-judge.py` 的 `merge_parts()` solids 求和逻辑需先核对。
- **com 微小偏移 354 个**：可能是 `merge_parts()` 质心加权口径（按体积加权 vs 算术平均），修口径前先取一个文件对比分量。
- **stage2 other 271（scratch dir missing）**：可能是 worker 并发/清理问题而非几何 bug，先定性再修。

- 本计划不改动 faijs 的 op 归属设计（sketch/draw 留在各自包、由宿主合并是既定契约）。