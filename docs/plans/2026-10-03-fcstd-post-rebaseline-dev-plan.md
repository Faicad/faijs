# FCStd → `.fai.zip` 移植：0.27.0 全量重基线分析与下一批开发计划（2026-10-03）

- Status: 方案（未实施）
- 引擎基线: faijs `0.27.0`（`config.faijsVersion`；cli sha256 `af8e778d…`）
- 语料: `D:/Faicad/FreeCAD-library` 3,201 `.FCStd`
- 转换工程: `D:/Faicad/fcstd-port`
- 前置文档: `docs/plans/2026-10-01-fcstd-port-next-dev-plan.md`（A/B/C/D 组主体修复已落地；其 §7 记录了本次重基线的漏斗数字）

## 0. 用户原话（2026-10-03）

> 你需要把分析的结果和后续的开发计划写成一份开发计划文档

## 1. 重基线分析结果（2026-10-03，0.27.0 引擎全量重转 + 重跑 + 重判）

### 1.1 四层漏斗（实测，`out/stage3-parity/parity.json` + `logs/stage3-0270.log`）

| 阶段 | 旧基线（0.22.5，09-30~10-01） | 新基线（0.27.0） | 变化 |
|---|---|---|---|
| stage1 翻译 ok | 3,103（96.9%） | 3,103 / 3,201（96.9%） | 持平（gap 98 → 97，failed 1） |
| stage2 执行 ok | 2,559（80.0%） | **2,733（87.3%）** | +174 |
| stage2 run-fail | 472 | 317 | −155 |
| stage2 timeout | 88 | 41 | −47 |
| parity pass | 1,125 | 860 | −265 |
| parity fail | 1,422 | 1,559 | +137 |
| parity no-truth | 2 | 2 | 持平 |
| promoted 入库 | 1,006 | 1,006（未跑 --promote） | — |

### 1.2 parity fail 分类（`parity.json` failClasses 实测，2,421 verdicts）

| 类 | 旧 | 新 | 变化 | 解读 |
|---|---|---|---|---|
| com | 1,101 | 1,250 | +149 | 终端收敛后加权口径变化暴露真实失配 |
| bbox | 1,036 | 1,122 | +86 | 同上 |
| volume | 1,361 | 1,071 | −290 | C3c-2（SubShape）+ B4 生效 |
| area | 1,352 | 1,026 | −326 | 同上 |
| solids | 927 | **708** | −219 | B4 hidden 终端剔除生效；`solids(1vs2)` 仍余 479 |

**run-fail 317 分类（`state/run-sweep.json.jsonl` 逐条归并，2026-10-03 实测）**：

| 类 | 数量 | 典型错误 |
|---|---|---|
| kernel-boolean | 161 | `kernel cut failed / cutWithHistory / E_OP_FAILED`（B5 降级链未覆盖的组合） |
| edgeRef-lineage | 104 | `edgeRef: adjacent face ordinal N has no role lineage`（fillet/倒角 callee） |
| sweep-transition | 25 | `SWEEP_TRANSITION_UNSUPPORTED: transitionMode 'transformed'`（self-host 只支持 'right'） |
| other | 21 | 零散（含 worker 崩溃残留） |
| ident-binding | 4 | D4a-2/3 残余（A-9 重发未覆盖的形态） |
| sketch | 2 | `E_SKETCHC_NO_CONTOUR` 等轮廓缺口 |

### 1.3 关键定性（诚实，不粉饰）

1. **pass 1125 → 860 不是简单回退**。B4（hidden 终端默认不导出）+ D2（extrude 方向旋转）改变了大量产物的终端集合与几何——此前「多终端重复计数」恰好把同一几何计多次，掩盖了 com/bbox 失配；终端收敛后这些文件暴露出真实失配。fail 文件集整体换血，com/bbox 上升与 volume/area/solids 下降是同一枚硬币的两面。
2. **stage2 ok +174 / timeout −47 是干净的净收益**：B5（cut 降级链）、D2、D4a（语法层）的直接效果，无口径变化参与。
3. **`solids(1vs2)-only`（单一失配类）为 0**：479 个 `solids(1vs2)` 全部与 volume/area/com 联带——终端选择问题不是独立单点，修它必须连带处理其几何失配，单一 singleFix 不可行。
4. **com ≥ 1（真实大偏移）253 个**：C2 修的是 root placement 一类，仍有大量 attachment 链偏移待取点。
5. **stage2 `failed` 40 条是本轮工具事故残留**（worker `openContainer` import 崩溃期写入的假失败），resume 只跳 ok 不重跑 failed，需显式 `--only failed` 补跑。
6. **stage1 gap 97**：top singleFix 为 `sketch-empty-geoms` 28 / `extrusion-zero-length` 16 / `shape-asset-broken` 14（`reports/batch-report.json`）。

---

## 2. 开发循环纪律（不变）

```
取点（挑一个失败文件）→ process-one.py --reconvert 或 rebased-sweep.ts 复现 → 定位源码
→ 改代码 + 单测 → 同文件复跑至 pass → rebuild + 提交 → 下一个
```

- 一类一修、一修一测、一次一提交；严禁 `--no-verify`（fcstd-port 工具侧除外）；stderr 零容忍；长任务串行。
- 测量门：`packages/faijs-freecad/scripts/rebased-sweep.ts --only <list>` 免 tgz 直跑本工作树代码。
- 验收须用 acorn AST 口径（正则口径噪声过大，见 10-01 plan §D4a 工具陷阱）。

## 3. 工作项（按建议优先级排序，无强制顺序）

### F 组：kernel-boolean run-fail 161（run-fail 头号类）

- **现象**：`cad.subtract/fuse/intersect` 抛 `kernel cut failed … cutWithHistory / E_OP_FAILED`。B5 降级链（裸 kernel → unifySameDomain → 裸重算）已修 disk-drive 型，但 161 个新组合仍失败。
- **取点**：从 `state/run-sweep.json.jsonl` 取 `kernel-boolean` 类前 3 个失败文件，逐个 `--reconvert` 复现。
- **做法**：对每个取点扩 B5 降级链的覆盖（如 `unifySameDomain` 前置、按 op 差异化降级、或对退化输入先 `fix`）；逐个判定「内核真不支持」还是「输入退化需清洗」。
- **改动位置**：`packages/core/src/api/boolean.ts`（降级链）；输入清洗在 `packages/faijs-freecad/src/feature-translate.ts`。
- **判据**：取点 run ok 且产 STEP；回归单测留档（修复前红）。

### G 组：edgeRef-lineage run-fail 104（D2 的下游残余）

- **现象**：`edgeRef: adjacent face ordinal N has no role lineage`（fillet/chamfer callee）。D2 修了 plane 帧方向，但 extrude 产物仍有无名面（cap 判定对退化薄片失据的同类问题）。
- **取点**：取 `edgeRef-lineage` 前 3 个文件，用 `probe-d2-faces.ts` 思路逐面问 `faceRef`，确认无名面构成。
- **做法**：视根因定——可能是 role 表对 cap/wall 分派的另一盲区，或 fillet 的边选择身份问题（与 C3c-3 DIN463 同域，G3 拓扑身份）。
- **改动位置**：`packages/core/src/api/extrude`（role 分派）或 `cad.edgeRef` 侧。
- **判据**：取点 run ok；若归因到 G3 拓扑身份域则记档并转入 G3 专项，不在本组硬修。

### H 组：sweep-transition 25（self-host sweep 缺口）

- **现象**：`SWEEP_TRANSITION_UNSUPPORTED: transitionMode 'transformed' is not supported after selfhosting (only 'right' default)`。现知 25+ 个（Screw tornillo / Trapezoidal thread / Duct 系列同根因）。
- **做法**：① 判定 `'transformed'` transition 的语义与工作量——若可实现则在 sweep op 补该模式；若不可行，则把该 gap 显式上报为 `E_SWEEP_UNSUPPORTED` 并在翻译侧记 gap（而不是 run-fail）。
- **改动位置**：sweep op 实现（`packages/core`）；翻译侧 gap 归类在 `packages/faijs-freecad/src/feature-translate.ts`。
- **判据**：取点 run ok（实现）或转 stage1 gap（显式上报），不再以 run-fail 形态出现。

### I 组：com 大偏移 253 + bbox 失配 —— **已定性（2026-10-03），faijs 侧无缺陷，原「每档一个 singleFix」作废**

- **取点**：从 parity verdicts 取 `com >= 1` 的文件按 offset 分档（1~10 / 10~100 / >=100），各取 1 个。
- **做法**：对齐 10-01 plan §C2 的三层实证法（生成码 → truth 口径 → OCP 数值），逐档定性。
- **原判据「每档一个 singleFix」已作废** —— 实测 253 个里 faijs 侧帧缺陷 **0 个**。分类器
  `fcstd-port/tools/_i-group-triage.py`（产物 `out/i-group-triage.json`）对每个文件算
  A=root `.brp` 裸读、B=A+各 root 的 Document Placement、T=磁盘 truth：

  | 分类 | 数量 | 含义 |
  |---|---|---|
  | `B==A` | **185** | Placement 对该文件无影响 ⇒ com 偏移另有根因，不是帧问题 |
  | `TRUTH-DOUBLE-APPLY` | **33** | **truth 侧缺陷**，faijs 是对的 |
  | neither（T≠A 且 T≠B） | 34 | truth 磁盘记录与本模块算法不一致，未定性 |
  | `faijs-missed-placement` | 1 | 后证为**分类器缺陷**：`xtal-2016` 的 truth volume 恰为 A 的一半（2.909331 vs 5.818662），而 `same()` 只比 bbox+com 未比 volume，误判 |

- **TRUTH-DOUBLE-APPLY 的机理（两个独立取点复现）**：Tapon / Caisson 的 root 特征自身
  Document Placement 是 90°X 旋转（Q=0.7071,0,0,0.7071），而该特征的 `.brp` **已经烘焙了**
  这个旋转；`export-fcstd-truth.py` 无条件再施放一次 ⇒ truth 是同一实体被转了两次。
  同一文档内**草图的 `.brp` 相反**（`PartShape.brp` 裸读是未旋转的 sketch 局部坐标），所以
  对草图施放是对的 —— 两种约定在一个文档里共存，「对每个 root 一律施放」只对后者成立。
  - 数值证据（Tapon，OCP）：brp 裸读 `vol=3211.434185 bbox=[-16,-16,0, 16,16,12.25] com=[0,0,7.6153]`；
    truth 记录 `bbox=[-16,-12.25,-16, 16,0,16] com=[0,-7.6153,0]`；**faijs 导出逐位等于前者**。
  - faijs 侧没跟着错，是因为 C3 的 `sketchCarriesFrame` guard 抑制了 M8.3 的 `cad.place`。
  - 判别器：`fcstd-port/tools/_i-group-frame-probe.py <corpus-rel>…` 打印 A / B / T 三行。
- **留档**：`packages/faijs-freecad/src/i-group-frame-e2e.test.ts`（5 用例，两样本 e2e +
  「raw 与 truth 只差一个 90°X 旋转」的冻结断言）。变异验证：把「无 `cad.place`」断言翻成
  要求有 ⇒ 套件变红，断言承重。
- **后续**：33 个 truth 侧缺陷要修在 `export-fcstd-truth.py`（判据：对 root **特征**的 `.brp`
  先探 `Locations` 头，旋转已烘焙则不再施放），属 truth 口径变更，**须用户批准**（同 L 组
  的审批性质）。185 个 `B==A` 的 com 偏移与 34 个 neither 需另起根因分析，不是帧问题。


### J 组：stage2 failed 40 补跑（工具卫生，半小时）

- **做法**：`node --import tsx tools/run-sweep.ts --only failed`（依赖已修好的 worker import），覆盖 import 崩溃期的假失败记录。
- **判据**：state 无 `failed` 残留；真实失败并入 §1.2 分类。

### K 组：stage1 gap 97 逐类清零（E1 延续）

- **top singleFix**：`sketch-empty-geoms` 28（空 sketch 应跳过而非 gap）、`extrusion-zero-length` 16、`shape-asset-broken` 14。
- **做法**：沿用一类一修纪律；每类伴合成 fixture 单测 + GOTCHA 标注。
- **判据**：gap 97 逐类下降，ok 率逼近 100%。

### L 组：promote 决策（用户审批项）

- parity pass 860 中未入库部分 + truth v3 修正后的候选（C3b 的 `fcstd-truth-c3b.jsonl` 316 条未覆盖 canonical）需要决策：
  ① 是否跑 `stage3-parity.mjs --promote` 把 pass 增量入库；
  ② C3b truth 修正是否 promote（其 supersede 判据放宽会改变 316 文件的 truth，需与 faijs 侧 compound 并列问题配对收口，见 10-01 plan §C3c 共同收口点）。
- **性质**：数据入库与 truth 口径变更，必须用户批准后执行。

## 4. 验收判据汇总

| 项 | 判据 |
|---|---|
| F | kernel-boolean 取点转 ok + 降级链单测留档 |
| G | edgeRef 取点转 ok 或归因 G3 记档 |
| H | sweep-transition 消失于 run-fail（实现或显式 gap） |
| I | ~~com/bbox 每档取点转 pass~~ → **已定性：faijs 侧帧缺陷 0；33 个是 truth 侧双重施放（待批准修 truth），185 个 `B==A` 另查根因** |
| J | state 无 failed 假记录 |
| K | gap 97 逐类下降 |
| L | promote 与 truth 口径变更经用户批准 |

## 5. 风险与已知限制

- **parity pass 数字口径**：860 是「与 truth 口径一致」，而 canonical truth 本身有已知缺陷（C3b 累积链双重计数未收口）——pass 数与几何正确性不是同一概念，解读时必须带着这个边界。
- **timeout 41 未分类**：本计划未含 D3 timeout 分桶（真慢 vs 卡死），待 F–K 推进后按需启动。
- **单进程 wasm 堆增长**：长 sweep 必须分片（`--skip/--limit`）或子进程隔离，避免静默退出（本轮已实证两次）。
- 本计划不改动 faijs 的 op 归属设计（sketch/draw 留在各自包、由宿主合并是既定契约）。

