# FCStd → `.fai.zip` 全库移植：进度复盘与下一阶段开发计划（2026-09-28）

状态：**规划文档**。前置文档 `2026-09-28-fcstd-v3-next-dev-plan.md`（下称「旧计划」）的 §1–§4 只覆盖
「翻译端 gap 清零」一条轴线，且其所依据的报表口径已被证实失真（见 §2 A2）。本计划先给全量实测复盘，
再重排优先级。**旧计划中 A1–A6/B/C 已完成、P3/P4 判定已落库的部分继续有效，不再重做**；
其「按 `singleFix` 名次继续清零 gap」的执行路线暂停，直到本计划 §4 的 P0 完成、口径重建后再续。

## 0. 一句话结论

**过去几天「ok 1615 → 5386（74.1%）」的进度数字不能代表任务完成度。** 它只统计「能不能出包」（stage1），
既没验证产物能不能跑（stage2），也没验证跑出来的几何对不对（parity）。按端到端口径，
**当前真正可用的产物是 153 / 3201 ≈ 4.8%**。同时发现一个此前完全没被任何报表照到的**一级阻塞**：
执行端 `cad` 命名空间缺 `sketch` / `draw` 两个库 op，**所有含参数化草图的产物 100% 运行失败**，
而语料里 2,641 个文件（82.5%）含草图。下一步必须先修「度量装置 + 执行装配」，再谈 gap 清零。

## 1. 进度复盘（全量实测）

### 1.1 端到端漏斗（唯一可信口径）

数据源 `D:/Faicad/fcstd-port/state/manifest.jsonl`（3,202 行，生成于 2026-09-28 07:33），
语料 `D:/Faicad/FreeCAD-library`（3,201 `.FCStd`，102 个 `.FCStd1` 备份跳过）。

| 阶段 | 状态 | 文件数 | 占全库 |
|---|---|---|---|
| stage1 翻译 | ok | 2391 | 74.7% |
| stage1 翻译 | gap | 800 | 25.0% |
| stage1 翻译 | failed | 11 | 0.3% |
| stage2 执行+导出 STEP | ok | 1215 | 38.0% |
| stage2 执行+导出 STEP | run-fail | 1163 | 36.3% |
| stage2 执行+导出 STEP | timeout / failed | 4 / 8 | 0.4% |
| stage2 | 未进入（stage1 非 ok） | 812 | 25.4% |
| parity（vs FCStd 真值，1e-5） | **pass** | **153** | **4.8%** |
| parity | fail | 1066 | 33.3% |
| parity | skip（无 STEP） | 1976 | 61.7% |
| promoted（入库） | true | 142 | 4.4% |

> 交叉核对：`gap/-/skip 800 + failed 11 + ok 1 = 812` 正好等于未进 stage2 的数量，漏斗自洽。

### 1.2 stage2 失败构成（`reports/run-sweep.json`，2,323 个旧产物）

| 失败类 | 数量 | 说明 |
|---|---|---|
| `E_EXTRUDE_ZERO_VECTOR` | 918 | 拉伸方向零向量，占 run-fail 的 79% |
| `edgeRef: nameless shape` | 77 | 拓扑命名：输入 Shape 无 role table |
| `edgeRef: no role lineage` | 15 | 同上，相邻面序号无 lineage |
| timeout（120 s） | 13 | 求解/布尔卡死 |
| OOM / worker 崩溃 | ~10 | `worker exit 2147483651 / 3221226505 / 134` |
| `0xC0000409`（WASM abort，stage1 崩溃） | 121 | manifest `convertError`，产物未生成 |

⚠️ 该基线产出于 **2026-09-23 的旧引擎（A2/A3 之前，format 1）**，见 §2 A4。

### 1.3 parity 失败构成（`manifest.jsonl` 的 `parityFails`）

| 量 | 失败文件数 |
|---|---|
| com（质心） | 1053 |
| bbox | 1010 |
| volume | 607 |
| area | 603 |
| solids（实体数不符） | 162 |

com/bbox 全面失守 ⇒ **放置链（Placement / 附件）错位是最普遍的几何错误**，量级错（volume/area）次之。

### 1.4 上一轮 gap 清零的既有战果（继续有效）

近两轮修复（faijs 侧，均已过门禁提交）：`compound-missing-members`（`c1a841d7`）、
`mirroring/polar/linear-pattern-missing-source`（`cca9b259`）、`fillet/chamfer-non-edge-sub`（`7db5030e`）、
`pocket-missing-dependency`（`ed314671`）、`multifuse-missing-dependency`（`e774d560`）、
`cut/fuse-missing-dependency`（`0b9d681f`）、`linear-pattern-edge-dir-unsupported`（`715fc774`）、
`pad-upTo-missing-base`（`133f95f3`）。
判定结论已落库：`docs/analysis/fcstd-baked-upstream.md`（P3/D8：`*-baked-upstream` 是依赖断裂的下游症状，
非独立死轮廓类）、`docs/analysis/fcstd-solver-throw-and-broken-assets.md`（P4：solver-throw 无真抛错路径；
shape-asset-broken 是 0 字节 `.brp` 源损坏，E4 契约正确报 gap，属已知限制）。

## 2. 主要问题（按严重度，每条附实测证据）

### A1（一级阻塞，**已修复** 2026-09-28）执行端 `cad` 命名空间缺 `sketch` / `draw`

- 生成端：`packages/fcstd/src/codegen.ts:347` 发 `op: 'cad.sketch'`；`codegen.ts:442` 发 `cad.draw(...)`。
- 运行端：core 的 `createApiNamespace()` 只有 **96 个键，既无 `sketch` 也无 `draw`**。
  `sketch` 由 `@faicad/faijs-sketch` 提供（`createSketchCadNamespace` / `mergeSketchNamespace` /
  `registerSketchSymbols` / `installSketchSolver`），`draw` 由 `@faicad/faijs-draw` 提供
  （`createDrawCadNamespace` / `mergeDrawNamespace` / `registerDrawSymbols`）——**必须由宿主合并**，
  这是 2026-09-28 抽包后的既定契约（`packages/sketch/src/namespace.ts:8-18` 有用法示例）。
- 现状：`fcstd-port` 的**全部**执行入口都用裸 `createApiNamespace()`——
  `tools/run-sweep-worker.ts:39`、`test/FreeCAD/run-census.test.ts:202`、`fcstd-e2e.test.ts:204,325`、
  `a4-edge-ref-regression.test.ts:35`、`a6-stack-overflow-regression.test.ts:36`。
  faijs 自己的测试（`packages/fcstd/src/container-open-e2e.test.ts`）**是合并了的**，
  所以 faijs CI 全绿、而语料侧 100% 跑不起来——两层盲区正好错开。
- 生成端 op 全集 vs core 命名空间求差：`box chamfer circularPattern compound cylinder extrude fillet
  helix import_brep linearPattern loft mirror place profile revolve sketch sketchOnPlane sphere subtract
  sweep union` —— **只有 `sketch` 缺失**（`draw` 走字面量生成，同样缺失）。

实测（本会话，当前 0.19.0 引擎）：

```
# 1) 转换：ok
node node_modules/@faicad/faijs-fcstd/dist/cli.js \
  "D:/Faicad/FreeCAD-library/Architectural Parts/Doors/Generic/Simple door.fcstd" /tmp/simple.fai.zip
→ {"ok":true,"gaps":[],"counts":{"translated":2,...},"sketches":{"total":1,"l0":1,...}}

# 2) 执行（现有 worker）：死在第一个草图语句
node --import tsx tools/run-sweep-worker.ts /tmp/simple.fai.zip /tmp/out1
→ {"ok":false,"error":"Execution failed at statement 0 (callee: sketch): __ns.cad.sketch is not a function",
   "checkErrors":[],"threw":false}

# 3) 执行（补齐 sketch 命名空间 + 注入 planegcs solver）：通过并导出 STEP
node tools/probe-cad-namespace-run.mjs /tmp/simple.fai.zip /tmp/out2
→ {"ok":true}   （out.step 110,546 B）
```

影响面：语料 2,641 / 3,201 文件（82.5%）含 `Sketcher::SketchObject`（共 8,370 个草图，
`reports/library-profile.json` 的 `structure.sketchFiles`）。**这是当前最大的单点杠杆。**

附带发现：`cliCheck` 对未知 op **不报错**（上例 `checkErrors: []`），所以静态检查也照不住这类断裂。

**修复已落地（fcstd-port）**：新增单点装配 `tools/lib/cad-namespace.ts`
（`createFaiCadNamespace()` = core + sketch + draw，`installFaiCadRuntime()` = 符号注册 + Node planegcs
solver 注入）；`tools/run-sweep-worker.ts` 与 `test/FreeCAD/{run-census,fcstd-e2e,a4-edge-ref,a6-stack-overflow}`
全部改走它（D13）。防回归在 `test/unit/cad-namespace.test.ts`（4 项，含「裸命名空间必红」反向断言）。

实测效果（56 样本 census，A/B 取差，基线工作树 `git worktree add … HEAD` 对照）：
**可运行样本 10 → 37**（tgz 工具链；vitest 源码 alias 链路为 32，差值即 §A3 版本漂移）。
修复后单个产物端到端：`Simple door` 从 `cad.sketch is not a function` → `{"ok":true}` 且导出 STEP 110,546 B。

修复同时揭开了**下一层缺陷**（原被"跑不起来"掩盖，已记入 P2）：
`E_SKETCHC_UNSUPPORTED_GE` 5 例（Drilling_1 / test_profile / dovetail / TestTangentMode3-0.21 /
ModelFromV021）、`E_SKETCHC_NO_GEOMS` 1 例（TestSketchCarbonCopyReverseMapping）、
`sketchOnPlane` makeLineEdge 构造失败 1 例（ArchDetail）、`revolve` CONSTRUCTION_FAILED 2 例（drill / v-bit）、
`edgeRef` edge ordinal 越界 2 例（hole_puzzle / strange_part_with_holes）。

### A2（度量失效）批量驱动的状态键被重复前缀污染

- `state/progress.json` 有 **7,270 个键，归一化后只有 903 个真实路径**（同一文件最多重复 9 份：
  前缀重复次数分布 `0:46, 1..8: 各 903`）。`out/batch/` 只有 857 个产物，与「903 中 857 ok」一致。
- 根因：`tools/batch-convert.ts` 的 `rekeyPreviousAbsolute()`（第 245 行）对**每个已存在的键无条件再拼一次
  `rootAbs`**，而快照里存的是绝对路径（`main()` 第 862 行 `meta.files = Object.fromEntries(outcomes)`，
  `outcomes` 由绝对键的 `prevFiles` 播种、却用相对键 `set()`）。每跑一轮多加一层前缀，
  旧结果在下一轮再也匹配不上（`previous[p]` 查不到 → 被当作新文件跳过/重跑）。
- 后果：`reports/batch-report.md` 的 `total 7270 / ok 5386 (74.1%)`、`singleFix` 的名次与 freed 数
  （solver-throw 165、shape-asset-broken 100 等）**全部是按重复键统计的，不可用于决策**。
  旧计划 §2 的 gap 分布表、以及另一份文档里「ok 2024 → 3679（67.2%）」同属该口径。
- 最近一次**可信的全库基线**只有 `state/manifest.jsonl`（§1.1）与 `state/progress.json.bak.20260928`
  （3,201 唯一键，ok 2323 / gap 878）。

### A3（环境漂移）引擎版本滞后两档

- faijs 源：`root.config.faijsVersion = 0.21.0`，core/sketch/draw/fcstd/extra 等 9 包全部 0.21.0。
- fcstd-port 装的是 **0.19.0** tgz（`packages/*/faicad-faijs*0.19.0.tgz`，建于 09-28 19:40），
  **磁盘上没有 0.21.0 的 tgz**。因此本轮所有语料数字都是两档旧引擎跑出来的，
  而 §1.4 的最新修复在 0.19.0 tgz 里是否完整也未经确认。

### A4（基线过期）stage2 / parity 基线来自 A2/A3 之前的旧产物

`reports/run-sweep.json`（09-23）扫的是 2,323 个 format 1 旧产物（pre-A2 参数化草图、pre-A3 显式 plane）。
§1.2 的 `E_EXTRUDE_ZERO_VECTOR 918` 是否仍存活、存活多少，必须在补 A1 后**重测**——
实测把一个原报 `E_EXTRUDE_ZERO_VECTOR` 的样例（`3ba2c55147af-Elevator doors with trims.fai.zip`）
在补齐命名空间后重跑，结果是 `{"ok":true}`，说明该类里至少有一部分是**旧基线/旧产物的连带假象**。

### A5（翻译端）残余 gap 需在新口径下重测

旧计划 §2 的 800→（近两轮修复后下降）gap 分布，在 A2 修好前无法给出可信数字；
重测后按新 `singleFix` 名次继续清零（执行纪律不变：一类一修、一修一测、一次一提交）。

### A6（已知限制）不立项

`shape-asset-broken`（0 字节 `.brp`，E4 契约正确）、`solver-throw`（无真抛错路径）、
`*-baked-upstream`（依赖断裂的下游症状）——按 D8 保留显式 reason，不计入可清零 gap。

## 3. 新决策

- **D9：进度只认端到端四态漏斗**（stage1 翻译 / stage2 执行 / parity 对拍 / promoted 入库），
  对外汇报一律给四层数字，禁止只用「stage1 ok 率」代表完成度。
- **D10：先修度量与执行装配，再谈 gap 清零。** A1/A2/A3/A4 未闭环前，任何 `singleFix` 名次都是噪声。
- **D11：产物 op 名 ↔ 运行时命名空间必须有静态守卫。** 新增审计：解析产物里所有 `cad.<op>`，
  与「宿主实际装配出的命名空间」求差，差集非空即失败；并在 `cliCheck` 补一条 unknown-op 检查。
  该守卫进 faijs 侧测试（不依赖语料），防的是「库抽包后宿主忘记合并」这类结构性断裂。
- **D12：一对 tgz 版本锁。** fcstd-port 的 `@faicad/*` 必须 = faijs `config.faijsVersion`；
  换版本必须 `build → pack → 重装` 三步走，并把 tgz sha256 记进报表（现有 `meta.tgzSha256` 已支持）。
- **D13：执行入口单点化。** fcstd-port 内所有执行入口（worker + 4 个语料测试）共用
  **一个** cad 命名空间装配函数，禁止各处裸调 `createApiNamespace()`。

## 4. 下一阶段任务

> 执行纪律继承旧计划：一次只修一类、逐项实测、单测留档（GOTCHA 标注真实 API 行为）、
> 每项独立过门禁提交（**严禁 `--no-verify`**）、长任务串行。

### P0（必须最先，全部完成才准碰 gap 清零）

**P0-1 修 `tools/batch-convert.ts` 的状态键 bug**
- 让 `rekeyPreviousAbsolute()` 只给**相对**键拼 root（绝对键原样保留）；`outcomes` 统一用一种键空间。
- 加一个回归单测：合成 state（相对键 + 绝对键混合），跑两轮快照，断言键数 == 文件数、无重复前缀。
- 验收：`state/progress.json` 键数 == 扫描数 3,201，无 `D:/…/D:/…` 形态键。

**P0-2 补齐执行端 cad 命名空间装配（A1）** — ✅ **已完成**
- 新增单点装配 `tools/lib/cad-namespace.ts`（`createFaiCadNamespace()` / `installFaiCadRuntime()`）。
- `tools/run-sweep-worker.ts` 与 `test/FreeCAD/*` 全部改走它（D13）；`tools/README.md` 记契约与 GOTCHA。
- 防回归 `test/unit/cad-namespace.test.ts` 4 项全绿（含裸命名空间必红的反向断言）。
- 实测：`Simple door` → `{"ok":true}` + STEP 110,546 B；census 可运行 10 → 37。

**P0-3 版本对齐与重装（A3）**
- faijs 侧 `node scripts/set-version.mjs` 已是 0.21.0 → 执行 `build → npm pack` 打出 0.21.0 四个 tgz
  （core / fcstd / sketch / draw），fcstd-port 重装并核对 `meta.tgzSha256`。
- 验收：`fcstd-port/package.json` 四个 `file:` 依赖全 0.21.0；`node_modules/@faicad/*/package.json` 全 0.21.0。

**P0-4 静态守卫（D11）**
- faijs 侧加测试：生成端 op 全集（含 `cad.draw` 字面量）⊆ 装配后命名空间键集；`cliCheck` 报 unknown op。
- 验收：故意去掉 `mergeSketchNamespace` 时该测试必须红。

### P1：重建全库基线（串行，分批）

**P1-1 stage1 重转全库**（修好 P0-1 后）
- `npx tsx tools/batch-convert.ts --force`（全量重跑，因引擎与产物格式已换）。
- 耗时预算：现网 p50 1.95 s/文件、p90 3.1 s、p99 7.8 s → 3,201 个约 **1.7 h**。
  按目录分批（`--subdir`）续跑，一批跑完再起下一批（用户铁律：后台任务串行）。
- 产出：`reports/batch-report.json`，键数 == 3,201，`singleFix` 名次可信。

**P1-2 stage2 重扫全库**（修好 P0-2 后）
- `run-sweep.ts` 全量重跑 → 新的 run-fail 分类表。
- 重点回答：`E_EXTRUDE_ZERO_VECTOR` 还剩多少；`cad.sketch` 缺失导致的那批是否全部转 ok。

**P1-3 parity 重判**
- 真值（3,143 ok / 59 fail）与 STEP 不变量已存在，只需重跑 `parity-judge.py` + `_promote.mjs`。
- 产出四层漏斗表，替代 §1.1 的旧数字。

### P2：按新漏斗的最大杠杆单项（P1 出数后再定序）

候选（按当前证据排序，待 P1 复核）：
1. **A1 揭开的新一类：`cad.sketch` 求解期失败**（`E_SKETCHC_UNSUPPORTED_GE` 5 + `E_SKETCHC_NO_GEOMS` 1）——
   参数化草图现在真跑起来了，solver 拒绝的几何类型（椭圆/样条/外几何？）与空输入浮出水面。先定性再修。
2. **`E_EXTRUDE_ZERO_VECTOR` 残余量**：若仍大，`Part::Extrusion` Dir 归一化（参考 `bf5ad377`）复查。
3. **parity com/bbox（1053 / 1010）**：Placement / 附件链（attachment）解析复查——这是「能跑但几何错位」的主因。
4. **`edgeRef` nameless / no-role-lineage（92）**：拓扑命名 lineage 在 FCStd 翻译链的覆盖缺口。
5. **`0xC0000409` WASM abort（121）+ OOM/timeout**：内核稳定性，单独开题。

### P3：翻译端残余 gap 清零（沿用旧计划纪律）

在 P1-1 的新 `singleFix` 表名次下继续，每类一个 commit + 一个 GOTCHA 单测 + B3 报表佐证。

### P4：入库与交付

- parity pass 产物经 `_promote.mjs` 入 `FreeCAD-library/` 并 git 入库，逐步抬高交付面（当前 142）。
- 写一份「v3 产物运行契约」说明（宿主必须合并 sketch/draw 命名空间并安装 planegcs solver），
  避免 3d_editor 等消费方踩同一个洞。

## 5. 验证与回归

- 每类修复伴合成 fixture 单测；不动非目标通路；stderr 零容忍。
- faijs 侧：`npm run test -w @faicad/faijs-fcstd -w @faicad/faijs-sketch -w @faicad/faijs` 取差；
  `npm run typecheck` 对基线取差（HEAD 有既有 tsc 红，不引入新红）。
- fcstd-port 侧：`npm run typecheck` + `npm run test`（`test/unit/batch-convert.test.ts` 必过）。
- **严禁靠跑全量 CI 找 bug**；全量批次只在 P1 的基线重建时跑，且串行分批。

## 6. 验收判据

| 项 | 判据 |
|---|---|
| P0-1 | `state/progress.json` 键数 == 3,201，无重复前缀键；新增回归单测绿 |
| P0-2 | `Simple door` 端到端 `ok:true` 且导出 STEP；所有执行入口走同一装配函数 |
| P0-3 | 四个 `@faicad/*` 在 fcstd-port 内 = 0.21.0，报表 `tgzSha256` 与之匹配 |
| P0-4 | 去掉合并即红的守卫测试存在且绿 |
| P1 | 四层漏斗（stage1 / stage2 / parity / promoted）各有全库数字，且报表键数自洽 |
| P2 | 每项修复后该类计数下降有报表佐证 + 单测留档 |
| 全程 | 一类一提交、门禁全过、`--no-verify` 零使用、后台任务零并行 |

## 7. 风险与已知限制

- **旧数字全部作废**：`reports/batch-report.md` 的 74.1%、旧计划 §2 的 gap 分布表、
  「ok 2024 → 3679」等，均按重复键统计，本计划生效后一律以新报表为准（旧文件保留作历史，不更新）。
- **P1 全量重转约 1.7 h + 重扫数小时**，必须分批串行；期间不得叠加其它后台任务。
- **真值侧 59 个 `truth=fail`** 属源数据缺陷（退化几何/坏 BREP），记 fail 跳过，不进 parity 分母。
- **`shape-asset-broken`（0 字节 `.brp`）不可修**，按 D8 保留显式 reason。
- 本计划不改动 faijs 的 op 归属设计（sketch/draw 留在各自包、由宿主合并是既定契约），只补宿主的装配。
