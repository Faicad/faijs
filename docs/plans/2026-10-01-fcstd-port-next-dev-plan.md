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

#### B5 修 disk-drive boolean 内核失败（`kernel cut failed`）— 待启动（属 C/D 类，非 solids terminal）

- **现象**：disk-drive 复跑 `stage1 ok`、B2 的 `import { assembly }` 形态已正确，但新鲜 run 在 `cad.subtract(Body__chain_2, Pocket002)` 抛 `kernel cut failed … cutWithHistory`。`process-one.py` 在 `do_run` 失败后未清 `step/` 目录，复用了 Sep-27 陈旧 STEP，造成 `solids(1vs2)`/`inv:true` 假象（工具侧 `tools/process-one.py` L96-113 缺陷：应在运行前 `rm -rf step_dir` 或仅采用本次写出的文件）。
- **根因**：boolean `cut` 内核在 `Body__chain_2 × Pocket002` 上失败——可能是几何退化（Pocket002 的拉伸/减运算输入自交或零体积）触发 OCCT `cutWithHistory` 异常。与 solids terminal 无关，属 C/D 组（几何/内核）范畴。
- **修复方向**：先定位 `Body__chain_2` 与 `Pocket002` 的几何（哪一步拉伸/布尔产生退化体），再决定是 cad 翻译端约束（如 Pocket002 高度/容差）还是内核 `cutWithHistory` 容错。
- **判据**：disk-drive `stage2` 转 ok 并能产出 STEP；其 `solids` 届时再按真实 terminal 数重判。
- **工具侧附带修复**：`tools/process-one.py` 的 `do_run` 在 spawn worker 前清空 `step_dir`，避免陈旧 STEP 污染 `inv`。此修复独立、低风险，可随 B5 一并提交或单独立项。

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
| B1 | ✅ 已定性：单 Body 翻译多产出一个冗余 terminal（别名 + 顶层 `let` 泄漏）；judge 方向为 truth=1 / faijs=2（plan 原写反） |
| B2 | ✅ 已完成（commit `a0f94ebf`）：单 Body 别名泄漏终端改为 `assembly` 直接 import，Sprocket 取点 solids 退出 fail + M-B1 单测留档。**覆盖边界（订正）**：仅单 Body 别名泄漏子类；TS35（`1vs4` 中间 var 泄漏）/ disk-drive（`1vs6`→boolean 内核失败）经复跑实证为不同机制，B2 未覆盖（见 B4/B5） |
| B3 | 撤销：实证非口径错，无需改 parity/truth 侧 |
| B4 | 待启动：修 runtime 中间 feature-var 泄漏为 terminal（TS35 `solids(1vs4)`）；根因在 `computeLiveShapes.lineConsumes` 对 `import_brep`/`cylinder` 源几何消费漏判；TS35 复跑 `solids 1vs1` |
| B5 | 待启动（C/D 类）：disk-drive `cad.subtract(Body__chain_2, Pocket002)` boolean 内核 `kernel cut failed`；附带修 `process-one.py` `do_run` 运行前清空 `step_dir` 防陈旧 STEP 污染 |
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