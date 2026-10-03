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

### F 组：kernel-boolean run-fail 161（run-fail 头号类）—— **已重新定性（2026-10-03），不是内核缺陷**

- **现象**：`cad.subtract/fuse/intersect` 抛 `kernel cut failed … cutWithHistory / E_OP_FAILED`。B5 降级链（裸 kernel → unifySameDomain → 裸重算）已修 disk-drive 型，但 161 个新组合仍失败。
- **重定性（取点 3 个实测）**：
  1. 当前 state 里真 `kernel fuse failed` 只有 **6 个**（161 是旧粗口径，把 fillet/sketch 的
     `E_OP_FAILED` 也算了进去）；6 个全是 `union`，输入多含 ShapeBinder/import_brep 产物。
  2. 取点 FCBL_chair_upholstered 复现链：`Part::Extrusion`（Symmetric，Dir=(0,1,0)）的 base
     sketch `Sketch001` 类型是 **`Part::FeaturePython`**（非 `Sketcher::SketchObject`）。
     转换器把它的 `.brp` 资产按**世界位姿**导出（raw bbox z∈[327.8, 971.6]，与 truth 一致），
     但 codegen 仍按「sketch 带非恒等 Placement」发射 `cad.place(Sketch001, Q90°X)` ——
     **place 二次施放**（I 组 double-apply 家族）。结果挤出面被移到 y∈[-971,-327]、
     世界 Dir=(0,±450,0) 与面**共面** → 退化薄片（vol≈3e-10）→ fuse 三级降级全败。
     内核探针（裸资产）上 `fuseWithHistory`/裸 fuse/unify 后 fuse **全部成功** —— 内核无罪。
  3. 另两个取点已非 fuse 失败：FAULHABER 现为 chamfer edgeRef 越界（归 G 组）；
     Beam-coupling-5mm 抛 `wireframe: BRepAdaptor_Curve::No geometry`（另行归类）。
- **结论**：F 组原「扩 B5 降级链」工作项作废。真根因已修（2026-10-03）：
  `brpEmbeddedLocation`（`unpack.ts`）只读平移、把零平移当恒等——**纯旋转内嵌
  （90°X，tx=ty=tz=0）被报成 null** → `prePlacedAssets` skip 不命中 → child 资产被
  `cad.place` 二次施放 → 挤出方向躺在轮廓面内 → 退化薄片 → fuse 全链失败。
  修法：返回**完整 3×4 变换**，恒等（旋转 AND 平移）才 null；convert 侧比较
  **旋转+平移全等**才 skip（`quatToMatrix` 对比）。这同时是 I 组「brp 是否已含
  Placement」权威判定的**可判定子集**（头部内嵌 location 的 child 资产）；
  Tapon/Caisson 型「几何已折进坐标、头不可信」的 ROOT 场景仍归 I 组后续收口。
- **留档**：`packages/faijs-freecad/src/brp-embedded-location.test.ts`（4 用例，
  含 GOTCHA：纯旋转内嵌不得读成 null；变异验证：翻错断言即红）。
- **改动位置**：原定 `packages/core/src/api/boolean.ts`（降级链，无需改）；真根因在
  `packages/faijs-freecad/src/codegen.ts`（place 发射判据）与转换器资产导出位姿约定。

### G 组：edgeRef-lineage run-fail 104（D2 的下游残余）—— **取点已定性（2026-10-03），归 G3 专项记档**

- **现象**：`edgeRef: adjacent face ordinal N has no role lineage`（fillet/chamfer callee）。D2 修了 plane 帧方向，但 extrude 产物仍有无名面（cap 判定对退化薄片失据的同类问题）。
- **取点定性（3 个实测，2026-10-03）**：当前 state 里 edgeRef 类实为 **两个子类**（87 个）：
  1. **`has no role lineage`**（如 ISO4762 M6x40：`cad.chamfer(Cut, …)` 的 `Cut =
     cad.subtract(Revolution, Pocket)`，而 `Pocket` 是 `cad.import_brep` 冻结资产
     PartShape7）——资产面**天然无 role 表**，其衍生的边/邻面拿不到 lineage 是
     **语义必然**，不是 role 分派盲区。修法只能是翻译侧把冻结资产面接入 role 图
     （G3 拓扑身份域），或 edgeRef 对资产面走降级定位。
  2. **`edge ordinal N out of range [1, M]`**（如 pushbutton-right-angle：
     `Fillet001` 引用 `Pad002` 的 edge 15，faijs 产物只有 3 条边）——FreeCAD 端
     edge 序号是在**原始 FCStd 形状**上数的，faijs 重建的形状边数/序完全不同。
     这是**拓扑身份对齐**问题（翻译侧记录的 ordinal 语义失效），同属 G3。
  3. 取点 Flapper LHS 当前已变为 `E_FILLET_RADIUS_TOO_LARGE`（kernel fillet 失败），
     不再是 edgeRef 类——归 kernel 域另行分类。
- **结论**：两类都归 **G3 拓扑身份专项**（与 C3c-3 DIN463 同域），按 plan 判据记档转出，
  不在本组硬修。87 个 edgeRef 失败在 G3 收口前维持 run-fail 形态。
- **改动位置**：`packages/core/src/api/edge-ref.ts`（lineage 解析）＋翻译侧 ordinal
  记录语义（`packages/faijs-freecad/src/`）。

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
  | `TRUTH-DOUBLE-APPLY` | **33** | T==B 且 A!=B（**其中只有 8 个真是帧问题，见下**） |
  | neither（T≠A 且 T≠B） | 34 | truth 磁盘记录与本模块算法不一致，未定性 |
  | `faijs-missed-placement` | 1 | 后证为**分类器缺陷**：`xtal-2016` 的 truth volume 恰为 A 的一半（2.909331 vs 5.818662），而 `same()` 只比 bbox+com 未比 volume，误判 |

- **⚠️ 33 个必须再按失配形状切分（2026-10-03 补测）**：刚体变换不改 volume/area/solids，所以
  **只有「fails ⊆ {bbox, com}」才是帧候选**。实测 33 个里仅 **8 个**满足，其余 **25 个同时失配
  volume/area/solids**（QFN20-5x4 是 21vs6 solids、LED_0603 是 9vs21）⇒ 那是**两边在比不同的
  形状集合**（truth 的 ROOT 选取 vs faijs 的终端选取），与帧无关。**别把 33 一起当帧问题修。**
  - 8 个帧候选：servo-screw-1.7x6.2 / servo-screw-2x7_5 / EncoderCircuit / Motor-CC-3.3V-WlToy911 /
    InitialFinal / Caisson / F623ZZ_Ball_Bearing / Tapon。
- **8 个的机理（Tapon / Caisson 双样本复现）**：root 特征的 `.brp` 读出来就**已经**在
  Document Placement 施加后的姿态上，而 `export-fcstd-truth.py` 对每个 root 再施放一次 ⇒ truth
  多了一次变换。faijs 侧读 raw 是对的。
  - 数值证据（Tapon，OCP，`tools/_i-group-frame-probe.py`）：
    - A `read(brp)` = `bbox=[-16,-16,-1e-07, 16,16,12.25] com=[0,0,7.6153]`
    - A′ `BRepBuilderAPI_Copy(read)`（identity location 的副本）**与 A 逐位相同** ⇒ 该 brp
      **没有独立的 TopLoc_Location**，姿态已折进几何
    - B `apply_placement(read, P)` = `bbox=[-16,-12.25,-16, 16,1e-07,16] com=[0,-7.6153,0]` = **T**
  - **⚠️ 修法三次被自己的实测否决，不要照抄任何一条**：
    ① 「剥 location 再施放」—— `BRepBuilderAPI_Transform` 是**复合**而非替换，
       `BRepBuilderAPI_Copy` 虽给 identity location 但 A′==A 证明无可剥之物 ⇒ **空操作**；
    ② 「按对象类型跳过」（PartDesign::*/Revolution 不施放）—— **21 个回归**，
       `PartDesign::Pad`/`Pocket` 跳过会破坏原本正确的文件；
    ③ 「E==P 就跳过」—— HBS `Cut002`（E==P）**必须**施放，Caisson（E==P）**必须**跳过，同条件
       反结论；且 HBS 的唯一 root 只有 identity Placement 的 `Compound`，`Cut002` 是 child
       不参与 truth ⇒ C2 那条「root 必须重放 Placement」的结论在 HBS 上**无法被现有 truth 复现**
       （三个候选表达式都給 com z 5.42843，truth 是 6.173765）。
  - **结论**：8 个的修法需要能区分「brp 几何已含 Placement」与「不含」的信息，而 A′==A 说明
    **`.brp` 层面已无此信息**（`Locations` ASCII 头在 Tapon 三个成员上都写着同一个旋转矩阵，
    但 OCCT 读出的 location 各不相同 ⇒ **头不可信，必须用 `shape.Location()`**）。可行的方向是
    从 **Document 语义**入手（PartDesign 特征的 `.brp` 已知含 Tip 位姿），而不是从 brp 头反推。
- **留档**：`packages/faijs-freecad/src/i-group-frame-e2e.test.ts`（5 用例，两样本 e2e +
  「raw 与 truth 只差一个 90°X 旋转」的冻结断言）。变异验证：把「无 `cad.place`」断言翻成
  要求有 ⇒ 套件变红，断言承重。⚠️ 该测试的 `raw` 断言是「faijs 不重放」这一**当前行为**的冻结，
  不表达「faijs 正确」——truth 侧修好后这两者会一致，测试仍绿。
- **后续**：8 个帧问题待修（修法未定，见上）；185 个 `B==A` 与 34 个 neither 需另起根因分析。

### I 组延伸：profile 混入 terminal compound（2026-10-03 已修，影响 727/3131 语料）

- **取点**：`Mechanical Parts/cable-chain-links/cable-chain-link-25_5x16x12_5mm.fcstd`
  （25 个"几何量也失配"里 solids 只差 1 的最干净样本）。
- **实测**：faijs 单终端 `solids 12 / vol 21506.67`，truth `solids 11 / vol 58157.32`
  —— **faijs 只有 truth 的 37% 体积**。原判据「faijs 导出多终端」被否（只导出 1 个）。
- **根因**：`lower()`（`codegen.ts`）算 roots 的条件是「没被任何 call 消费」，而
  `cad.sketch` / `cad.profile` 声明时 `inputs: []`（`codegen.ts:368`），消费者只通过
  `params.sketch` 引用它。**消费者没被翻译时（真实文件里那些 Pocket 走了
  `cad.import_brep` 冻结形状），草图就成了游离 roots**，被塞进 terminal `cad.compound`。
  cable-chain 一行就有 **5 个 sketch 混进 16 个 members**。
- **影响面实测**（`fcstd-port/tools/_i-profile-census.mjs`，遍历 3131 个 `.fai.zip`）：
  **1863 个产品含 profile op，727 个把 profile 混进了 terminal compound（23%）**。
- **修法**：`PROFILE_OPS = {cad.sketch, cad.profile}` 从 roots 里排除。**不要**改成「把 profile
  标记成被消费」—— extrude 是用 `params.sketch`（渲染进 options 的裸变量名）携带它的，
  不走 `inputs`；改 roots 过滤才能保持 `lower()` 作为「什么进产物」的唯一事实来源。
- **留档**：`codegen.test.ts` 两条新用例。⚠️ **第一版 fixture 是无效的**：草图被 Pad 正常消费，
  变异（拿掉 filter）后测试**仍全绿** —— 它压根没触发 bug。改成**游离 profile**（消费者的
  feature 类型不被翻译）后变异恰好 1 条变红，才算承重。
- **⚠️ 同一根因的第二处（未修）**：修完 compound 侧后 cable-chain 仍导出 **6 个 STEP**，
  其中 5 个是 sketch（`volume 0 / solids 0`）。它们是**独立的 live terminal**
  （`computeLiveShapes` / `live-shapes.ts` 层面），不在 compound 里。判「是否实体」不属于
  keep/hidden 终端语义的职责，**未在该处加过滤**（会改变 profile 语义）—— 需单独立项。

### I 组延伸 2：`cliCheck` 误报 run-time 合并的 op（2026-10-03 已修）

- **现象**：`rebased-sweep.ts` 每个产品的 `checkErrors` 都带
  `unknown op: cad.sketch is not in the cad namespace`，但同一脚本第 166 行把
  `mergeSketchNamespace(...)` 的结果传给了 `cliRun` —— 判定与执行看的不是同一个命名空间。
- **根因**：`cliCheck` 的 unknown-op 守卫只查 `symbolTableNames()`（**静态**符号表），
  `CliCheckOptions` 根本没有 `libs` 字段，调用方无法告知自己合并了什么。
  **一个完全可运行的产品被报成 broken**，任何信任 `checkErrors` 的 sweep 都会把整个语料读成坏的。
- **修法**：`CliCheckOptions` 加 `libs?: Record<string, unknown>`，守卫把这些 namespace 的
  key 并入 known。`rebased-sweep.ts` 改为 `cliCheck(entry, { assetsDir, libs: { cad: CAD_NS } })`，
  与 `cliRun` 传同一个 `CAD_NS`。cable-chain 的 `checkErrors` 由 1 条变 **0 条**。
- **留档**：`cli.test.ts` 三条（D11 原有那条「未 merge 必须报错」仍绿 + 「已 merge 不得报错」
  + 「`libs` 不得掩盖真缺失的 op」）。变异敏感。



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
| I | ~~com/bbox 每档取点转 pass~~ → **已定性：faijs 侧帧缺陷 0。33 个里仅 8 个是帧问题（修法三次被实测否决，待定），25 个是选择差异；185 个 `B==A` 另查根因** |
| I-ext | ~~profile 混入 terminal compound~~ → **已修**（727/3131 语料受影响）；残留 5 个 sketch 独立终端未修 |
| I-ext2 | ~~`cliCheck` 误报合并的 op~~ → **已修**（每产品 1 条误报 → 0） |
| J | state 无 failed 假记录 |
| K | gap 97 逐类下降 |
| L | promote 与 truth 口径变更经用户批准 |

## 5. 风险与已知限制

- **parity pass 数字口径**：860 是「与 truth 口径一致」，而 canonical truth 本身有已知缺陷（C3b 累积链双重计数未收口）——pass 数与几何正确性不是同一概念，解读时必须带着这个边界。
- **timeout 41 未分类**：本计划未含 D3 timeout 分桶（真慢 vs 卡死），待 F–K 推进后按需启动。
- **单进程 wasm 堆增长**：长 sweep 必须分片（`--skip/--limit`）或子进程隔离，避免静默退出（本轮已实证两次）。
- 本计划不改动 faijs 的 op 归属设计（sketch/draw 留在各自包、由宿主合并是既定契约）。

