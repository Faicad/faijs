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
| `1vs2` | 651 | truth 1 个、faijs 2 个（faijs 多产一个冗余 terminal，见 B1/B2）——主模式 |
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

#### B1 定性 solids 1vsN 失配根因 ✅ 已定性（2026-10-01 续）

> **方向订正（重要）**：plan §1.1 把 `solids(1vs2)` 写成「faijs 产 1 个 solid，truth 2 个」——**方向写反了**。`parity-judge.py` 的 verdict 格式是 `(truth vs step)`，即 `1vs2` = **truth=1、faijs=2**。全库实测以 faijs 侧多产出为主。

- **取点**：`0203a22597f2-Sprocket ANSI duplex`（`solids(1vs2)`）、`02d55246310d-TS35`（`solids(1vs4)`）、`04f6a668fdd0-3-5inch-Disk-Drive-SATA`（`solids(1vs6)`）。
- **⚠️ 覆盖边界（2026-10-01 续，复跑实证订正）**：B2 仅消弭**单 Body 别名泄漏**子类（Sprocket + 651 个 `1vs2` 中的别名子类）。B1 另两个取点文件经 `process-one.py --reconvert` 复跑，**均为不同机制、B2 未覆盖**——见 §B2 覆盖边界与 §B4/§B5。原"B2 通用修复已覆盖全部 1vsN"假设**不成立**：`1vsN`（N>1）中 `1vs2` 是别名子类与中间 var 泄漏子类的混合，更高 N 多为其它 bug（boolean 内核 / 多 Body 旧产物）。
- **根因（已锁定，实证）**：单 Body 文档生成的 `main.fai.js` 为 `import { Body_out } from './Body.fai.js'; let assembly = Body_out;`，且 `manifest.models[]` 同时列了 `main` 与 `Body`。`Body.fai.js` 顶层 `let Body_out` 在执行时**泄漏为第二个 terminal**，于是 cliRun 把 `Body_out` 与 `assembly` 别名**都导出**（`run-sweep-steps` 出现 `__0_Body_out.step` + `__1_assembly.step`，两者体积完全相同）。`parity-judge.merge_parts()` 对多终端求和 → 同一几何被计 2 次 → `solids 1vs2`（truth=1，faijs=2）。多 Body 文档因 `assembly = cad.compound(...)` 是 compound，cliRun 的「多终端优先导出 compound」早返回只产 1 个 assembly STEP，**不受影响**。
- **实证验证（zip 直接打补丁跑 worker）**：把单 Body 的 `let assembly = Body_out` 改为 `import { assembly } from './Body.fai.js'`（同名的跨模块 shape var 在运行时合并为一个 terminal），worker 只产出 1 个 `out.step`，`step-invariants.py` 读出 `solids: 1`、体积 18556——与 truth 的 1 solid 对齐。
- **定性三问结论**：不是 compound 导出语义错、不是 truth/parity 口径错、不是真实几何 merge 缺失——是**翻译产物多产出一个冗余 terminal**（别名 + 顶层 `let` 泄漏）。
- **判据达成**：922 的主模式 `1vs2`（651）属此类，已通过 B2 修复消除。

#### B2 修单 Body 聚合多产出一个冗余 terminal（faijs-fcstd 翻译侧）✅ 已完成（2026-10-01 续，commit `a0f94ebf`）

- **实际修复位置**：`packages/fcstd/src/codegen.ts`（`generateModel` 聚合分支），**不是** faijs core 的 STEP 导出（B2 原假设的「compound→STEP solids 计数」方向是错的——compound 早已正确，问题在翻译多产 terminal）。
- **做法**：当 `bodiesWithGeo.size === 1` 时，Body 模块的 terminal 命名为 `assembly`（而非 `<Body>_out`），聚合入口直接 `import { assembly } from './Body.fai.js'`、不再写 `let assembly = Body_out;` 别名。这样执行程序只有 **一个** terminal，cliRun 只导出一个 `out.step`。多 Body 维持 `<Body>_out` + `cad.compound`，不受影响。
- **单测**：`codegen.test.ts` 新增 M-B1 断言单 Body 产物 `import { assembly }` 且无 `let assembly = Body_out`；原有 M10.3 多 Body 用例（`<Body>_out` + `cad.compound`）不变。34 个 codegen 用例全过。
- **端到端验证**：Sprocket ANSI duplex 经 `process-one.py --reconvert` 重跑——`solids` 已退出 fail 列表（原先 `1vs2`），剩余 `volume/area/bbox/com` 属 C 组，正确出界。
- **判据达成**：取点文件 solids 失配消除 + 单测留档。
- **⚠️ 覆盖边界（复跑实证）**：B2 只解决**单 Body 别名泄漏**（main 写 `let assembly = Body_out` 别名 → 顶层 `let` 泄漏为第二 terminal）。B1 另两个取点文件**不在 B2 覆盖范围内**，实测如下：
  - **`TS35`（`solids(1vs4)`，复跑 `stage1/2 ok`）：** 单模块、无 Body 模块；`main.fai.js` 把每个 FCStd feature 译成独立顶层 `let`——`Common = cad.import_brep(...)`、`Cylinder = cad.cylinder(...)`，被 `Cut = cad.subtract(Common, Cylinder)` 消费，最终 `assembly = cad.compound({ members: [Pad__place, Sketch001, Pocket__place, Cut] })`。运行时 `computeLiveShapes`（`packages/core/src/cad-runtime/live-shapes.ts`）把**所有顶层 shape var 当 terminal**导出 → `out.step_0_Common.step` + `out.step_1_Cylinder.step` + `out.step_2_assembly.step` 三文件，`merge_parts` 求和得 `solids 1vs4`（inv `parts:3, solids:4` vs truth `solids:1`）。**根因不是「消费判定漏判」**——该假设已被 B4 实测推翻：`Common`/`Cylinder` 是被 `subtract` 的 `keepHidden(inputs)`（`api/boolean.ts`，R5「布尔源保留但隐藏」）登记成 **hidden 终端**存活下来的，属**导出层判据**问题 → 见 **§B4**（已修复）。
  - **`3-5inch-Disk-Drive-SATA`（`solids(1vs6)`，复跑 `stage1 ok` 但 `stage2 run-fail`）：** B2 的 `import { assembly } from './Body.fai.js'` 形态已正确生成（单 Body 折叠对），但新鲜 run 在 `cad.subtract(Body__chain_2, Pocket002)` 抛 `kernel cut failed for inputs … — cutWithHistory`（boolean 内核失败）——与 B2 无关的独立 bug；stale 基线 `1vs6` 来自旧版转换器的多 Body 产物，非单 Body 冗余 terminal。其复跑出现的 `solids(1vs2)` / `inv:true` 是 **`process-one.py` 在 `do_run` 失败后未清 `step/` 目录、误用 Sep-27 陈旧 STEP** 造成的假象（工具侧缺陷，非真实 parity）→ 见 **§B5**。

#### B3 修 truth/parity 侧 solids 统计口径 — 撤销（被 B2 取代）

- **前提不成立**：B1 实证表明 922 的 solids 失配**不是口径错**（merge_parts 的求和语义是对的，它只是忠实地把「被翻译多产出的第二个 terminal」也加进去了）。无需改 `parity-judge.py` / `export-fcstd-truth.py`。
- 仅当后续发现「真实复合体多实体被 step-invariants 误计」时再重启 B3；当前无此证据。

#### B4 导出层默认跳过 hidden 终端（消 TS35 类 1vsN）✅ 已修复（2026-10-01 续，导出层判据）

> **⚠️ 本节原假设已被实测推翻**：原写「`computeLiveShapes`/`lineConsumes` 对 `import_brep`/`cylinder` 消费判定漏判」，并给了「改 runtime 消费扫描」或「codegen 内联中间 feature」两条修复方向。**两条都不是真根因**。真根因是**导出层没有跳过 hidden 终端**。

- **现象**：TS35（单模块、无 Body 模块）把每个 FCStd feature 译成顶层 `let`：`Common = cad.import_brep(...)`、`Cylinder = cad.cylinder(...)`，被 `Cut = cad.subtract(Common, Cylinder)` 消费，最终 `assembly = cad.compound({ members: [Pad__place, Sketch001, Pocket__place, Cut] })`。运行时 terminals = `['Common','Cylinder','assembly']` → cliRun 逐终端各写一份 → `out.step_0_Common` + `_1_Cylinder` + `_2_assembly`；`merge_parts` 求和 → `solids 1vs4`。
- **根因（三层实证）**：
  1. `extractMetadata(TS35)`：`Cut` 行 `positional = [{var-ref:Common},{var-ref:Cylinder}]`，`meta.keep` 为空 → **提取器正确**，消费引用在；
  2. 喂**空 keep** 的 standalone `computeLiveShapes` → `['assembly']`（1 个）→ **消费扫描本身没漏**；
  3. 插桩 `cliRun` 打印 `computeLiveShapes` 入参：`keep.functionBody(Cut 行)` = `{kept:{Common,Cylinder}, hidden:{Common:true,Cylinder:true}}` → 有一个**函数体 keep 落在 subtract 行**。
  来源：`packages/core/src/api/boolean.ts` 的 `union/cut/subtract/intersect` **无条件** `keepHidden(...inputs)`（注释即 R5「布尔源保留但隐藏」，编辑器要看源）。`lineConsumes` 的 C0/C1 短路据此判「不消费」→ 输入作为 `hidden:true` 终端存活。
- **既有测试佐证（推翻「升引擎即收敛」）**：`packages/core/src/cad-runtime/runtime.test.ts` 的「boolean: box + sphere + subtract → subtract 终端 + 输入保留隐藏」断言 `terminals=['s1','s2','s3']`（3 个）且**在当前 src 上就是绿的**；0.22.5 dist 与 0.25.0 src 都给 3 ⇒ 这不是版本回归，升级引擎修不了 TS35。
- **修复（导出层判据，用户裁定「隐藏的语义就是保留但不产出，默认必须跳过」）**：
  - `packages/core/src/node-host/cli.ts` 新增导出函数 **`selectExportableTerminals(terminals, includeHidden=false)`** 作单一事实来源；`exportExecutionResult` 默认剔除 `hidden` 终端，**全部隐藏时报明确错误**而非静默回退到「最后一个 output」；`selectViewShapes`（`view` 命令）同判据；`writeAssemblyStep` 的「兜底导出全部 brepSolids」分支同样剔除隐藏终端。
  - 显式 opt-in：`CliRunOptions.includeHidden` + CLI `--include-hidden`（仅在指名要导出隐藏源时用）。
- **判据达成**：`box-boolean.fai.js`（`subtract` 保留 2 个 hidden 源）现在只产 **1 个** `out.stl` / `out.step`（此前 `_0_part0/_1_part1/_2_part2` 三份）。TS35 结构同型 ⇒ `merge_parts` 只计 1 个 solid，`solids 1vs4` 消除。
- **单测（防回归）**：`packages/core/src/node-host/cli.test.ts` —— `selectExportableTerminals` 5 例（默认剔除 / `includeHidden` / 全隐藏 / 无 hidden 零回归 / 空集）；`cliRun` box-boolean 单文件（STL+STEP）且不落 `_i_` 隐藏源文件；`includeHidden:true` 恢复 3 文件；**装配兜底路径**剔除隐藏源（`ADVANCED_BREP_SHAPE_REPRESENTATION` 计数 1 vs 3）；`cliView` 隐藏终端不投影；`parseArgs --include-hidden`。
- **附带**：`cli.test.ts` 草稿目录由仓库内 `packages/tests/tmp-faijs-cli` 迁到 `os.tmpdir()`（宿主 safe-delete shim 对「仓库内目录单轮 >50 文件」有批量守卫，会把 `afterAll` 递归清理判成 suite 失败）。
- **未做 / 待办**：
  - `packages/core/src/cad-runtime/module-registry.ts` 的 `liveShapes` **保持原样**——那是跨模块 import 的绑定解析，hidden shape 仍是模块真实导出值，不属「产物导出」层。
  - **corpus parity funnel 尚未重跑**：本修复改变了不少文件的产物文件数，§1 的 886/1,661/922 等数字需按新导出行为重跑后重基线（未做，不得沿用旧数）。

#### B5 修 disk-drive boolean 内核失败（`kernel cut failed`）✅ 已完成（2026-10-01 续）

- **现象**：disk-drive 复跑 `stage1 ok`、B2 的 `import { assembly }` 形态已正确，但新鲜 run 在 `cad.subtract(Body__chain_2, Pocket002)` 抛 `kernel cut failed … cutWithHistory`。`process-one.py` 在 `do_run` 失败后未清 `step/` 目录，复用了 Sep-27 陈旧 STEP，造成 `solids(1vs2)`/`inv:true` 假象（工具侧 `tools/process-one.py` L96-113 缺陷：应在运行前 `rm -rf step_dir` 或仅采用本次写出的文件）。
- **根因（变体探针实证）**：失败不在输入退化（`chainOnly`/`prev`/`toolOnly` 单独导出均 ok），而在 **OCCT `cutWithHistory` 对「布尔产物作为刀具且与 target 共享子域」的组合失败**（Pocket002 = Pocket001 − Pocket002_cut，Body__chain_2 含 Pocket001）；裸 `kernel.cut` 对最小合成复现成功，但对真实几何仍失败；**`unifySameDomain` 两输入后裸 cut 成功**。
- **修复（faijs `packages/core/src/api/boolean.ts`）**：history 路径失败时的降级链——① 裸 `kernel[op]` 重试；② 仍失败则 `unifySameDomain(prev)/unifySameDomain(tool)` 后裸 `kernel[op]` 重算；全部失败才抛原 `E_OP_FAILED`（带原 cause）。降级如实丢本次面演化/roleTable（同裸路径语义），GOTCHA 注释留档。
- **工具侧附带修复**：`fcstd-port tools/process-one.py` 的 `do_run` 在 spawn worker 前清空 `step_dir` 的 `*.step`，防陈旧 STEP 污染 `inv`。
- **单测（防回归）**：`fcstd-port test/unit/b5-boolean-history-cut-regression.test.ts`（最小合成复现：布尔产物作刀具共享子域 → 修复前 `kernel cut failed`，现 pass）；`test/unit/b5-disk-drive-e2e.test.ts`（真实 Body.fai.js 转 ok 且产 STEP）。探针脚本 `tools/probe-dd-run.mts` / `tools/probe-dd-variants.mts` / `test/unit/b5-probe-variants.test.ts` 按铁律保留。
- **验证**：回归单测 + e2e 全过；faijs `npm run typecheck` 干净；`boolean-vc8.test.ts` 无回归。
- **判据达成**：disk-drive 执行转 ok 并产出 STEP（`out.step_0_Body__chain_3` + `out.step_1_assembly`）；全量 parity 漏斗重基线仍属 B4 遗留待办。

---

### C 组：com/volume 失配重定性 + 修复

#### C1 分离 com 微小偏移 vs 大偏移 ✅ 已完成（2026-10-01 续，判定为口径问题并修复）

- **取点**：com 偏移 < 1e-2 共 358 个，最小一批集中在 1.02e-05 ~ 1.22e-05（Round Bar 系列、FlatWasher 等），恰在 `tol=1e-5` 判定线附近。
- **定性（分量实测，Round Bar 125）**：truth com x = −7.71e-15，faijs com x = 2.47e-15——**两侧都是数值零（浮点噪声）**。旧口径 `EPS_FLOOR=1e-9` 作分母，把 1e-15 级噪声放大成 1.02e-5 相对误差，恰好越过判定线。**是口径假象，非真实几何差异**（体积在 1e-13 相对差内完全一致）。
- **修复**：`fcstd-port tools/parity-judge.py` 的 com 分母地板改为**尺度感知**——`max(|ref|, bbox对角线 × COM_FLOOR_SCALE(1e-5), EPS_FLOOR)`。地板比容差线低两个量级：真实偏移（>=1e-2）仍 fail，浮点噪声零不再膨胀到判定线。
- **重判结果**：parity pass **886 → 1125**（+239）；com fail 1,555 → 1,101。sanity 双向核验：取点的 3 个 Round Bar 全部转 pass；大偏移文件（com >= 100，381 个，如 Sprocket）仍正确 fail。
- **残余**：com fail 1,101 中仍有微小偏移子类（1e-2 ~ 1 区间 202 个）待 C2 一并定性；大偏移 381 个进 C2。
- **判据达成**：微小偏移类（数值零噪声）归入已知口径并转 pass；大偏移类隔离进 C2。

#### C2 修 placement/attachment 链导致的 com 大偏移 ✅ 已完成（2026-10-01 续）

- **取点**：`Mechanical Parts/Enclosures/HBS/HBS_assembly.FCStd`（`6c96676a4761`，verdict `fail` / `com(1.21e-01)`）。
- **实测（取点文件，四态）**：
  | 侧 | volume | com z | bbox z | solids |
  |---|---|---|---|---|
  | truth | 1775.9027086 | **6.1737645** | [-2.750005, 21.750005] | 3 |
  | faijs（修复前） | 1775.9027199 | **5.4284254** | [-2.750000, 21.750000] | 3 |
  volume/area/bbox/solids 全部吻合，**只有 com z 差 0.7453**（= verdict 的 1.21e-01）。
- **根因（三层实证，与 B 组同源思路）**：
  1. 该文档扁平无 Body：`Cut`/`Cut001`（child）被冻结的 `Part::Compound` 消费，`Cut002`（Tuerca 螺母，Document Placement **z=+3**）是 **root**。生成代码为 `cad.compound({members:[Compound, Cut002]})`，**root 的 +3 没被发出**。
  2. `convert.ts` 的 `prePlacedAssets` 启发式（`brpEmbeddedLocation(brp) == placement` ⇒ 视为「已放置」而跳过 place）对 `PartShape3.brp` 判真——其 Locations 首块就是 `tz=3`，与 Document Placement 相等。**但 OCP 实测该 brp 的几何确实在 local 帧**（`read` 后 bbox z=[-0.4677,6.4677]，raw 去位置后 [-6.4677,0.4677]）——首块 location ≠ 几何是否已烘焙，该启发式**判不出**（H13 两次返工的同一判定问题）。
  3. truth 口径（`export-fcstd-truth.py`）：**只对 root 形状对象**取 `Placement ∘ read(brp)`；**child 只贡献 `read(brp)`**（父 compound 的冻结 brp 已含 child placement）。faijs 的 `cad.import_brep` 返回的正是 `read(brp)`（root location 由 BREP 读入器施加）⇒ **root 必须叠加 Document Placement，child 维持「embedded==placement 则跳过」**。
- **修复（`packages/fcstd/src/codegen.ts`）**：新增 `childShapeAssets` = 被其它**有形状对象**引用的形状载体（源码内已有 `nodes[].deps`，无需新解析）；`isPrePlaced` 改为 `prePlacedAssets.has(name) && childShapeAssets.has(name)`。即 header 证据**只对 child 授权跳过**，root 一律按 Document Placement 重放。
- **数值实证（OCP，与 faijs 同内核族）**：`compound(read(PartShape2), place(read(PartShape3), z=3))` → com z **6.1737645296731785**，与 truth **逐位相同**（delta 0.000000）；修复前同构造给出 **5.428425379385555**，与 faijs 实测 `inv.json` 的 `5.428425372487442` 逐位吻合 ⇒ 模型正确、修复到位。
- **无回归实证（A/B 逐字比对）**：`TO92.FCStd` = 0 place、`Beds.FCStd` = 13 place，修复前后**逐字符相同**（`Beds` 的 Section002-005 root place 与各 child place 均未变）。
- **单测（防回归）**：
  - `packages/fcstd/src/codegen.test.ts` 新增合成用例：同 placement 下 **root 发 1 个 place、child 不发**。
  - `packages/fcstd/src/c2-root-placement-e2e.test.ts`（真实文件，缺失即 skip）：① 断言生成码 `cad.place(Cut002, position:[0,0,3])` 且**不** place Cut001；② `cliRun` 全程跑通并产非空 STEP。
  - fcstd 全包 **353 个测试全过**；`npm run typecheck -w @faicad/faijs-fcstd` 干净。
- **影响半径（诚实边界）**：本改动**只**影响「**root** 形状载体且 `embedded==placement`」的文件——此前这类文件的 Document Placement 被误丢。child 行为一字未动。
- **未做 / 待办**：**corpus parity funnel 尚未重跑**（与 §B4 遗留同一项）——本次改变了这部分文件的产物几何，§1 的 886/1,661/922 等数字需按新行为重跑后重基线（不得沿用旧数）。另：fcstd-port 侧复跑依赖 `faijs-fcstd-convert` 的 **tgz 重建 + 重装**（`npm pack`），且其 worker 经 `npx tsx` 驱动（本沙箱拦 npx），故本轮以 OCP 数值实证 + 源侧 e2e 替代。

#### C3 修 volume 失配的真实几何差异

- **取点**：volume 失配且非 solids 失配联带的（即纯 volume 差异）取一个。
- **复现**：对比 faijs STEP 与 truth 的 volume，差异 > 1% 的定位几何差异来源（拉伸高度 / 布尔运算 / 圆弧参数等）。
- **改动位置**：视根因定，可能在 `packages/fcstd/src/` 的特征翻译或 `packages/core/src/api/` 的 op 实现。
- **判据**：取点文件 volume 失配消除。

**取点结果（441 个纯 volume 失配的量级画像，实测）**：`tools/_c3-pick.py` 分档 —— `>1.0` 0 个、`0.1~1` 436 个、`1e-2~0.1` 2 个、`1e-5~1e-2` 3 个；`fails == ["volume"]` 的**纯 volume-only 文件 0 个**（volume 永远与 area/bbox/com 联带）。取点定为**体积恰好差整数倍**那一族（Winch-Model1 系列），因为它给出可判定的机制而非噪声。

##### C3a 剖面 sketch 的平面帧被施加两次 ✅ 已完成（2026-10-01 续，commit `816a4627`）

- **现象（Winch-Model1-Roll-Vertical，三段堆叠 Pad：0..10 / 10..72 / 72..82）**：faijs volume 与真值侧最终形状**逐位相同**（11961.614），但 `bbox z = [0,154]`（真值 82）、`com z = 53.19`（真值 41.0）。体积不变式对平移不敏感 ⇒ 这族只表现为 bbox/com 失配。
- **根因（源码 + 运行时双证）**：A3（`codegen.ts` L356-361）把 sketch 的 attachment-resolved Placement 作为**显式 `plane: {origin, normal, xAxis}`** 发出，挤出体**已经站在 sketch 帧里**；M8.3（L662）随后又用**同一个** placement 发了一次 `cad.place`。A3 的注释本就写明该 place「被取代」，但守卫从未加上。
  - 红测实证：禁用守卫时生成码同时含 `plane: {"origin":[0,0,250]}` 与 `cad.place(Pad, position:[0,0,250])`。
  - 运行时实证（真实文件 STL 包围盒）：修复前 `zMax = 154`，修复后 `82`。
- **修复**：`codegen.ts` 增加 `sketchCarriesFrame` 守卫 —— 仅当 profile sketch 走**参数化 `cad.sketch` 路径**（`sketchInputs` 非空）且 placement 非恒等时才抑制 place；A5 `cad.profile` 兜底仍在局部坐标构建，保留其 place。
- **规模**：3131 个产物中 **133 个**带该形态（`tools/_c3-double-place-scan.py`）；与 parity 交叉后**当前 pass 数为 0**（42 fail / 2 no-step / 89 未入判）⇒ 不存在「错误相消」，无回归需要保留。
- **单测**：`codegen.test.ts` 新增两条（参数化路径不发 place / A5 兜底仍发 place，后者防守卫过宽）；新增 `c3-sketch-frame-e2e.test.ts`（真实文件，缺失即 skip）：① 断言保留 `"origin":[0,0,10]`/`[0,0,72]` 且**无** `cad.place(`；② `cliRun` 全程跑通并由二进制 STL 反解包围盒，断言 `zMax ≈ 82`。**两条在修复前均为红**。
- **回归**：fcstd 全包 33 文件 / 356 用例全绿；`typecheck -w @faicad/faijs-fcstd` 干净；eslint 干净。

##### C3b truth 侧把 legacy 累积 PartDesign 链重复计数 — 已实现，未收口（见 §C3c）

- **现象**：同一取点文件 truth volume = **23923.228 = 2 × 11961.614**。
- **根因（OCP 逐形状剖开实证）**：该文档是**无 Body/Part 容器的 legacy 文档**（6 个对象、零引用），legacy PartDesign 的 feature 是**累积**的 —— `Pad(PartShape2)=502.65 / bbox 0..10`、`Pad001(PartShape5)=11458.96 / bbox 0..72`（= Pad + 自身柱体）、`Pad002(PartShape8)=11961.61 / bbox 0..82`。`export-fcstd-truth.py` 的「root = 未被引用者」在无容器时把 6 个**全**当 root 求和：`502.65 + 11458.96 + 11961.61 = 23923.23`，与 truth 记录逐位吻合。**真值侧把同一份材料数了两遍**。
  - 第二样本 `Winch-Model1-Horizontal-roll` 同构（`402.12 + 13479.00 + 13881.13 = 27762.25` = truth）。
- **规模**：语料 **316 / 3201（9.9%）** 是「无容器 + ≥2 个带 Shape 的 `PartDesign::*`」（`tools/_c3b-class-size.py`）；已判定的 133 个**当前全部 fail**（零 pass）⇒ 无回归风险。
- **修复**：`export-fcstd-truth.py` 新增对象 `type` 解析 + `drop_cumulative_part_design()` —— 仅在无容器时生效，且只剔除**被更靠后的 `PartDesign::*` root 证伪 supersede** 的前序 root（体积不小于它 **且** bbox 包含它）；独立 feature（bbox 不相交）一律保留。最终聚合（compound + invariants）一字未改，未命中文件数值不变。
- **实测**：两个取点文件 truth volume → **11961.614** / **13881.127**，bbox z → 0..82 / 0..90，com z → 41.0 / 45.0 —— 与 `PartShape8` 逐位一致。
- **⚠️ 未收口（诚实边界，含全量实测数字）**：truth 修正后 solids 由 3 → **1**，而 faijs 侧是 3 个独立 pad 的 `cad.compound`（solids=3）。即本项把「volume 失配」换成了「solids 失配」，取点文件**仍未 pass**。
  - **C3 判据单项达成**：取点文件 `Winch-Model1-Roll-Vertical` 的 fail 集由
    `['volume','area','bbox(8.78e-01)','com(3.47e-01)']` → `['area','bbox(8.78e-01)','com(2.97e-01)','solids(1vs3)']`
    —— **`volume` 已退出失配列表**（§C3 判据字面达成），代价是新出现 `solids(1vs3)`。
  - **全量重判实测（faijs 侧 STEP 仍是旧产物，故只反映 truth 侧净效）**：
    `tools/_c3b-merge.py` 合并 316 条（其中 **211 条体积变化**）→ `parity-c3b.json`。
    | 指标 | 修正前 | 修正后 |
    |---|---|---|
    | pass | 1125 | **1125（未变）** |
    | fail | 1422 | 1422 |
    | volume | 1363 | 1361（−2） |
    | solids | 922 | **927（+5）** |
    | com / area / bbox | 1101 / 1352 / 1036 | 1101 / 1352 / 1036 |
    - 逐文件差分：**转 pass 0 个、转 fail 0 个**，98 个文件的 fail **集合**发生变化（`tools/_c3b-diff.py`）。
  - **结论（不粉饰）**：truth 侧修正**单独不产生任何净 pass**。它是正确的一步（真值不再把同一份材料数两遍），但必须与 §C3c 配对才有收益。
- **产物**：`out/stage3-truth/c3b-truth.jsonl`（316 条，0 超时 0 错）、`fcstd-truth-c3b.jsonl`（候选合并，**未覆盖 canonical**）、`out/stage3-parity/parity-c3b.json`（候选重判）。canonical `fcstd-truth.jsonl` 与 `parity.json` **保持未动**。

##### C3c — 原方向（union 而非 compound）**实测证伪**；重新界定后：C3c-1 再证伪、C3c-2 已修、C3c-3 已归因

**原假设**：无容器文档里连续的 `PartDesign::*` 是累积链；faijs 应 fusion 而非 compound。
**四项实测（均为独立测量，非推断）证伪之**：

1. **它们不是「一个链」**：C3b 候选 truth 中，316 个链文档只有 **55** 个塌缩为单形状，其余 **261** 个 truth 明确保留多根 ⇒ 那些特征本就独立。
2. **union 会错杀 248 个文档**：`tools/_c3c-fuse-safe.py` 用 truth 同一个 supersede 判据取 survivors，逐文档比较 `solids(compound)` vs `solids(fuse)`（OCP 实跑）：

   | 结果 | 数量 | 例 |
   |---|---|---|
   | **DIFF**（fuse 合并了 truth 分开的固体） | **248 / 316** | fan-40x40 `compound 12 → fuse 1`；battery-holder-4-AAA `20 → 1`；MK8 `45 → 7` |
   | same 且 survivors 塌缩为 1（union 正确的真集合） | **51** | Winch-Roll-Vertical、Dir_A、MSOP-8 |

   ⇒ 宽口径 union 不是「修 316 个」，而是**砸掉 248 个**。
3. **XML 层无判别信号**：2409 个 loose PartDesign 中 **2369 个根本没有 `BaseFeature` 属性**（另 40 个才是空 `<Link value=""/>`，即 P1.3 注释里说的那种）；sketch 的 `Support` 挂「前一特征面」在累积型与独立型文档中都出现（fan-40x40 每个 Pocket 都挂前一特征面，truth 仍保留 12 个固体）。唯一判别信息是几何，codegen 期无内核 ⇒ 结构判别不可能。
4. **compound 规模极大**：316 个链文档中 **236 个**含 `cad.compound`，成员最多 **53**（ramps-1.4）。全 union 会把聚合变成最多 53 层布尔链（内核风险 + 语义错）。

**真集合只有 ~7 个**（Dir_A/Dir_B/Dir_F、TS35、Wall anchor、rotary-resistor-M64W103KB40、EmergencyButton_LAY37），且它们也**不是单纯 compound 问题**：`Dir_A` 的 compound 是
`[Pad, Sketch001, Pocket__place, Pad001__place, Pad002__place, Pad003__place]` —— 混入 `Sketch001`（0 体积线框），且 `Pocket` 被 `cad.import_brep(PartShape5)` 当成**正形状**复合（27.428 = 已挖孔的累积形状）⇒ 双重计数。

**重新界定出的三个独立项（各自都有实测规模与机制）**：

| 项 | 规模 | 实测结论（2026-10-02） |
|---|---|---|
| **C3c-1** 聚合把参考 sketch 当成员 | 727 | **证伪 ⇒ 不修**。`tools/_c3c-wire-member.py`（OCP）用同一批冻结 brp 造 `compound(solid)` 与 `compound(solid+wire)`：volume `1311.029621` / area `898.344785` / com `-8.437036` / solids / bbox **全部逐位相同** ⇒ 0 体积线框成员对 invariants **零影响**。上一轮「727 个由线框引起」的推断不成立（C3c-2 的真根因见下）。 |
| **C3c-2** Pocket 的 `SubShape` 被当成结果 import | 622 文档 / 1028 Pocket | **真根因（与线框无关）**：`feature-translate.ts` 对「带 SubShape 的对象」无条件取 `SubShape`，理由是它「是 feature 的结果缓存」。实测该前提为假——`SubShape` 是 FreeCAD 的 `AddSubShape`，即 feature 增/减的**工具**；对 `PartDesign::Pocket` 就是**被切掉的材料**。M6x30：`Pocket.Shape=PartShape3.brp(1198.832)`、`Pocket.SubShape=PartShape4.brp(112.197，六角槽)`。**已修** commit `2de18c15`。 |
| **C3c-3** DIN463 TabWasher fillet 链 | 20 | **归因到边选择身份，未修**：`Fillet` 的 `Base=Pad` 且 `Sub=Edge8/Edge11`、`Radius=4`（板厚仅 0.5）。FreeCAD 自身给 98.819（PartShape3），faijs 给 **2 solids / 130.622** ⇒ 边序身份不一致（属 G3 拓扑身份域，非本轮可收口）。 |

**C3c-2 判据（已达成）**：取点 `Screw M6x30 ISO4762 8,8 A2K` 由 `SubShape(PartShape4)` 改为 `Shape(PartShape3)`；子集重基线（12 文档，before/after 为**同一样本**，仅代码不同）：

| 产品 | before | after | truth | 判据 |
|---|---|---|---|---|
| M1,6x10 ISO4762 | 34.439 | **59.014** | 59.014 | ✅ pass（逐位） |
| M1,6x12 ISO4762 | 38.460 | **67.056** | 67.056 | ✅ pass（逐位） |
| M1,6x16 ISO4762 | 46.502 | **83.141** | 83.141 | ✅ pass（逐位） |
| M1,6x20 ISO4762 | 54.542 | 99.210 | 99.202 | ❌ 差 8e-5（**参数化 revolve 精度**，与本修无关；本修已消除主要差量） |

同批 8 个非 ISO4762 样本（HSD/battery/endstop/microswitch）**全部** RUN-FAIL 或 CONV-FAIL 于既有缺口（`edgeRef` 越界、`sweep transitionMode`、`sketch 无闭合环`），故收益面只能由 ISO4762 族体现。

**全族重基线（423 个，`out/rebased-iso-after.json` / `-parity.json`）**：

| | RUN-OK | pass | fail | 其余 |
|---|---|---|---|---|
| **BEFORE**（canonical parity，旧 codegen） | — | **0** | **409** | 14 no-record |
| **AFTER**（本工作树） | **411** | **118** | 293 | 12 RUN-FAIL（另一批 `ISO4762_Hex_Socket_Head_Cap_Screw_M*.fcstd`，chamfer role-lineage，属 D2 类） |

⇒ 族内 **+118 净 pass**（409 个 fail 的 28.8%）。全库口径：1125 → 约 1243。

**⚠️ 诚实边界**：这些 pass 是「**与 truth 口径一致**」而非「与真几何一致」——当前 canonical truth 本身把 `Revolve(1311.030)` 与 `Pocket 结果(1198.832)` **双重计数**（Pocket 的 Shape 已含 Revolve 的材料），faijs 修后恰好是同一结构。若 §C3b 的 truth 修正日后 promote（放宽 supersede 判据以剔除切削型前序），faijs 侧需同步让 `compound` 不再并列「前序特征」与其冻结后代 —— 这是 C3b/C3c-2 的**共同收口点**，尚未做。

**测量门（已建成）**：`packages/fcstd/scripts/rebased-sweep.ts` 免 tgz、免 npx 直跑**本工作树**的 `convertFcstdFile` → 物化 → `cliRun` 出 STEP（命名对齐 `state/manifest.jsonl` 的 product stem），交给 fcstd-port 自己的 `step-invariants.py --batch` + `parity-judge.py` 测量 ⇒ 唯一变量是待测代码。

##### C3 遗留观察

- ~~`ISO4762` 族的 bbox z「恰好 2× 头高」+ 体积偏小~~ —— **已由 C3c-2 解释并修复**：该族 `Pocket` 被 import 的 `SubShape`（工具=切掉的材料）本身就在轴向多出一段（六角槽沿 z 0.94..6），且把「应被减掉的材料」当正体积复合 ⇒ bbox z 偏高、体积偏小。修后 3/4 取点与 truth 逐位一致。
- **M1,6x20 的 8e-5 残差**（99.210 vs 99.202）：`cad.revolve`（参数化重算）与 brp（FreeCAD 导出）之间的精度差，随尺寸增大而放大，落在 1e-5 容差线上。独立问题，未取点。
- `DIN463` 的 fillet 边身份（C3c-3）：`Fillet.Base = Pad` 的 `Sub=Edge8/Edge11`，而 faijs 的 `cad.edgeRef(Pad, 8/11)` 指向的不是同一条边 ⇒ 需 G3 拓扑身份（`(StmtId, RoleName)`）能力才能收口。

---

### D 组：stage2 run-fail 472

#### D1 scratch dir missing — ✅ **已收口**（271 → 12 → 12/12 可跑）

- **取点**：`0031c9f93c85-TO92.fai.zip`（`scratch dir missing (worker produced no output): ENOENT`）。
- **根因（已在 `run-sweep.ts:116-123` 修过）**：`KEEP_STEPS`（`out/run-sweep-steps`）若不存在，`copyFileSync` 抛 ENOENT，被外层 try/catch 误标成「worker 无产出」，把好产品记成 `failed`。修法 = 循环前 `mkdirSync(KEEP_STEPS, {recursive:true})`。
- **实测（2026-10-02）**：`state/run-sweep.json` 当前状态为 ok **2559** / run-fail 472 / timeout 88 / **failed 仅 12** —— 旧记录的「271」是修复前基线。
- **12 个的真伪用测量门逐一验证**：`out/rebased-d1.json` 得 **RUN-OK 12/12**（含取点 TO92 与 M6x30）⇒ 这些是**假失败**（旧 worker 崩溃/环境），产品本身可执行；判 parity 得 **4 pass / 8 fail**（8 个进入真实失败类）。
- **改动位置**：无需再改；`run-sweep.ts` 的失败分类可再细化（区分「worker 崩溃」与「产物拷贝失败」），非阻塞。

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
| B1 | ✅ 已定性：单 Body 翻译多产出一个冗余 terminal（别名 + 顶层 `let` 泄漏）；judge 方向为 truth=1 / faijs=2（plan 原写反） |
| B2 | ✅ 已完成（commit `a0f94ebf`）：单 Body 别名泄漏终端改为 `assembly` 直接 import，Sprocket 取点 solids 退出 fail + M-B1 单测留档。**覆盖边界（订正）**：仅单 Body 别名泄漏子类；TS35（`1vs4` 中间 var 泄漏）/ disk-drive（`1vs6`→boolean 内核失败）经复跑实证为不同机制，B2 未覆盖（见 B4/B5） |
| B3 | 撤销：实证非口径错，无需改 parity/truth 侧 |
| B4 | 待启动：修 runtime 中间 feature-var 泄漏为 terminal（TS35 `solids(1vs4)`）；根因在 `computeLiveShapes.lineConsumes` 对 `import_brep`/`cylinder` 源几何消费漏判；TS35 复跑 `solids 1vs1` |
| B5 | ✅ 已完成（2026-10-01 续）：`cutWithHistory` 失败降级链（裸 kernel 重试 → unifySameDomain 后重算）+ `process-one.py` 运行前清空 step_dir；disk-drive 转 ok 产 STEP；回归单测 + e2e 留档 |
| C1 | ✅ 已完成（2026-10-01 续）：com 微小偏移 358 个定性为「数值零浮点噪声 ÷ 1e-9 地板」口径假象；parity-judge com 地板改尺度感知（bbox 对角线 × 1e-5）；重判 pass 886 → 1125，大偏移仍正确 fail |
| C2 | ✅ 已完成（2026-10-01 续）：根因 = `prePlacedAssets` 把 **root** 形状载体的 Document Placement 误当「已放置」丢弃；修复 = header 证据只对 **child** 授权跳过（`childShapeAssets = prePlaced && root` 取反）；HBS com z 5.4284 → **6.1737645296731785**（与 truth 逐位相同，rel 0）；TO92/Beds 输出逐字未变；合成单测 + 真实文件 e2e 留档 |
| C3 | 取点文件 volume 失配消除（C3a ✅ 已完成 commit `816a4627`；C3b ✅ 已完成 commit `98cb00a` —— 取点 `volume` 已退出 fail 列表，但全量重判 **pass 1125 未变、solids +5**，净 pass 为 0；需与 C3c 配对才有收益） |
| C3c | ❌ 原方向实测证伪。重新界定后：**C3c-1 再证伪**（线框成员对 compound 的 invariants 逐位无影响，`_c3c-wire-member.py`）／**C3c-2 已修**（`SubShape` 是 `AddSubShape` 工具而非结果，commit `2de18c15`）—— 全族 423 个重基线 **pass 0 → 118**（+118，RUN-OK 411）／**C3c-3 已归因**（DIN463 fillet 边身份，属 G3 域，未修）。测量门 `packages/fcstd/scripts/rebased-sweep.ts` 已建成。 |
| D1 | ✅ **已收口**：根因是 `KEEP_STEPS` 缺目录致 ENOENT 被误标（`run-sweep.ts:116-123` 已修）；state 实测 failed 只剩 **12**（旧 271 是修复前基线），12 个经测量门 **RUN-OK 12/12**、parity **4 pass / 8 fail** ⇒ 假失败 |
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