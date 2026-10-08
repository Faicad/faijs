# occt-wasm 5.6 能力接入方案（脚本 op 化 + 实现面接入）

> 日期：2026-10-07（2026-10-08 续：C4 收口批）
> 状态：**S1–S3 已实现**（commit `7e20393` 等）；**S4 类型判定族已落地**（commit `7e13583`，8 个 occt 平台谓词）；**S4b 视图/导出族已落地**（commit `e57578c`）；**S4 曲线草图 / 曲面面 / 实体偏置族已落地**（commit `5da07a0`）；**S4 测量查询族 + 布尔扩展族 + 对齐族已落地**：`api/measure-query`、`booleanOp` → `cad.boolean`、`alignX/Y/Z` → `alignTo`；**C4 收口批（2026-10-08）**：`chamferAsymmetric` / `cutAll` / `sweepAdvanced` / `sweepOriented` 四项判为 C3（等价证据固化于 `test/api/occt-s4-c4-disposition.test.ts`），`sweep` 补齐 `withContact` / `withCorrection` 两个脚本面字段。
> 刷新后六类 = **C1 102 / C2 64 / L3 0 / C3 10 / C4 1 / C5 10 / C6 24**（和 211，穷尽性四项全绿）。**C4 只剩 1 项**：`createXCAFDocument`（§5.3，属 S5，命名待拍板）。本方案随实测持续校正，凡与源码冲突处以实测为准。
> 方案出处：DeepSeek-V4.1-Flash + WorkBuddy
> 事实基线：全部**技术结论**来自当前源码实测，唯一来源为 `node_modules/occt-wasm@5.6.0` 的 `dist/*.d.ts`（与本机 `occt-wasm` 源码仓）、本仓 `packages/core/src` 与 `packages/faijs-extra/src` 的具体文件行号。

## 0. 需求原文（最高判据）

> 只收录**直接决定本方案范围与判据**的原话；对话过程中的状态询问、过程性评论、情绪用语不在此列。

### 0.1 原话

| # | 原话 | 判定作用 |
|---|---|---|
| R1 | 「必须全部植OCCT的全部的能力，只要能移植都必须全部移植，除非是不应该暴露给脚本面的方法」 | 范围 + 接入判据 |
| R2 | 「你的任务是把occt-wasm里的所有的功能都接入faijs，如何接入，你要理解需求，给出方案。occt里怎么可能有3mf的东西？」 | 任务复述（范围 = occt-wasm）；3MF 不属 occt |
| R3 | 「我反对你写的方案里排除XCAFDocument，理由就是目前faijs脚本层面对step/3mf的支持。我提到这一点，只是让你明白需求。根本不是所谓的非Shape方法不接入。」 | XCAF 全族接入；排除理由不得是「非 Shape」 |
| R4 | 「我明明要求完整支持所有step/3mf的所有特性，所有字段。」 | STEP 全特性、全字段 |

### 0.2 原话直接决定的约束

| # | 约束 | 依据 |
|---|---|---|
| 1 | 范围 = **occt-wasm 的全部能力**（不是某个子集、不是别的模块的能力） | R1、R2 |
| 2 | 「接入」= 能移植的都移植；落点两种，见 §1.1 | R1 |
| 3 | 排除只允许**逐条**给理由；**不得**用「返回的不是 Shape」当理由 | R1、R3 |
| 4 | `XCAFDocument` **全族接入**（16 个具名能力逐条给落点），见 §5.3 | R3 |
| 5 | faijs 脚本层对 STEP 的支持要**完整到全部字段**，见 §11 | R4 |
| 6 | 3MF **不是 occt-wasm 的能力**，不写进本方案的能力矩阵；3MF 的全字段要求归 faijs 自持 mesh 层 | R2 |

---

## 1. 目标与判据

### 1.1 「接入」有两种落点，必须分别定义

occt-wasm 的一项能力被接入 faijs，有两种等价合法的落点，二者不可互相替代：

| 落点 | 含义 | 判据 | 影响面 |
|---|---|---|---|
| **A — 脚本 op** | 脚本作者能在 `.fai.js` 里写出一行调用它的语句 | 该 op 名出现在 `lang/symbol-table.generated.ts` 或 `api/surface/arg-spec.ts` 的 `scriptFace:true` 条目中，且 `check()` / `dimension` / `dispatchPath` 三道门能过 | 脚本面符号增加 |
| **B — 实现面接入** | 现有 op 的实现体改用更精确/更全的原生路径，**脚本面符号不变** | 该原生方法被某个已存在的 op 实现链调用，且该项能力不产生新的脚本语义 | 脚本面符号不增加，输出精度/血缘/覆盖率提升 |

**这条区分是本方案的地基。** 把两者混为一谈，就会得出「211 个方法要造 211 个 op」的荒谬结论，并倒逼出一批语义重复的 op（例：`rotateWithHistory` 与 `rotate` 是同一建模能力的两种血缘精度，不是两项能力）。

### 1.2 op 的三种身份

`defineOp` 的 `engines` 字段是**引擎白名单**（`packages/core/src/define-op.ts`，字段声明在 `engines?: readonly BrepEngineId[]`），语义为「本 op 的实现只能跑在这些 BREP 引擎上」：

| 身份 | 声明 | 实现约束 | brepkit 装配下 |
|---|---|---|---|
| **中立 op** | 不写 `engines` | 只经 L1 契约 `BrepEngineApi`（`brep/engine/primitives.ts:34`，102 成员） | 正常执行 |
| **平台 op** | `engines: ['occt']` | 可直调 `getOcctKernel()` | **执行前静态报错**（`dispatchPath` 判定，非运行时崩） |
| **未接入** | — | 无 op 触达 | 脚本里没有这个符号 |

`engines` 与 `capabilities` 正交、可并存（`define-op.ts` 中 `engines` 与 `capabilities` 两字段并存，判定次序 `engines` 在先）。`engines` 声明不破坏引擎可切换性，它是引擎可切换性的**表达方式**：声明后 brepkit 装配会拿到明确的、可测试的静态错误；不声明而偷调 occt 原生，才是真正破坏可切换性（运行时才炸）。

### 1.3 六类处置（互斥完备，和 = 211）

全部 `OcctKernel` 成员按下列**次序**判定，落且仅落一类：

| 类 | 名称 | 判据 | 动作 |
|---|---|---|---|
| **C1** | 契约可达 | 该方法被 `packages/core/src/occt-kernel/` 用于实现某个 `BrepEngineApi` 成员 | 无需动作 |
| **C2** | 平台 op 已触达 | 被某个已存在于脚本面、且声明 `engines:['occt']` 的 op 直接调用 | 补声明或确认现状 |
| **C3** | 能力已由现 op 覆盖 | 该方法未被直调，但**同一能力**已有脚本 op 经别的内核路径/组合实现达成 | 无需动作（附对照） |
| **C4** | 新增脚本 op | 真实缺口：脚本作者会想单独写这一行 | 按 §4 规范新增 op |
| **C5** | 实现面接入 | 有语义但属"同一能力的更优路径"（血缘精度、修复补充），造新符号会形成双轨 | 改由现 op 内部选用（落点 B） |
| **C6** | 显式排除 | 不应暴露给脚本面（附理由） | 不做 |

**判定次序即优先级**：先问"契约能到吗"（C1），再问"现 op 直调了吗"（C2），再问"能力被别的 op 覆盖了吗"（C3），三者皆否才在 C4/C5/C6 之间决策。

### 1.4 覆盖范围

| 面 | 内容 | 本方案处理 |
|---|---|---|
| **STEP 交换格式**（occt-wasm 能力） | STEP 规范里的**全部特性与全部字段**（读 / 写 / 往返），含各 AP 应用协议 | **§11 逐条覆盖矩阵**（§0.1 R4）；不以「本期不做」整族搁置。3MF 不在此列——它不是 occt-wasm 的能力 |
| `OcctKernel` | 211 个成员（`dist/index.d.ts:34-651` 的 212 个唯一名 − `[Symbol.dispose]`；含 1 个 `static init`、1 个 `get shapeCount` getter，重载按名去重，口径见 F23） | §3 逐条处置 |
| `XCAFDocument` | 颜色 / 名称 / 标签树 / 装配结构 / STEP 保真 / GLTF 导出（`dist/index.d.ts:16`、`dist/xcaf-document.d.ts`，16 个具名成员） | §5.3 **全族接入**：逐条给落点（新增 op / 扩现 op / 实现面接入）。它是「faijs 脚本层完整支持 STEP」的数据载体（颜色/名称/标签树/装配都只在 XCAF 文档里，不在 Shape 里），**不排除整族** |
| 自由渲染函数 | `renderShapeSVG` / `renderMultiviewSVG` / `renderShapePNG` / `renderMultiviewPNG`（`dist/index.d.ts:18-19`） | §5.2 专节：与 `OcctKernel.toSVG` 族同一实现，按方法族统一处置，不重复计数 |
| `OcctWorker` | 并发/批量提交面（`dist/worker.d.ts`、`dist/index.d.ts` 的 `./worker` 子入口） | **C6 显式排除**：并发执行面不是脚本语义；脚本面单线程执行模型由 `cad-runtime/` 承担 |

`OcctKernel` 之外的枚举（`BooleanOp`/`JoinType`/`SweepMode`/`TransitionMode` 等，`dist/types.d.ts`）不单列：它们只作为新增 op 的参数类型被消费，随 §4 的 op 定义落地。

---

## 2. 事实基线（全部实测）

| # | 事实 | 数值 | 证据 |
|---|---|---|---|
| F1 | `occt-wasm` 版本 | 5.6.0 | `node_modules/occt-wasm/package.json` |
| F2 | `OcctKernel` 成员全集 | **211** | `dist/index.d.ts:34-651`；212 个唯一名 − `[Symbol.dispose]`（见 F23）；含 `static init` 与 `get shapeCount` getter，重载按名去重 |
| F3 | L1 契约 `BrepEngineApi` 成员 | **102** | `packages/core/src/brep/engine/primitives.ts:34` |
| F4 | faijs 原生 op | **95** | `packages/core/src/lang/symbol-table.generated.ts:8-102` |
| F5 | arg-spec `scriptFace: true` 条目 | **48** | `packages/core/src/api/surface/arg-spec.ts` |
| F6 | **脚本面全集 = F4 ∪ F5 ∪ 手写平台 op** | 三者互不为超集 | arg-spec.ts 文件头 A6 口径原文：「两个清单回答不同问题、互不为超集——禁止互相反推」 |
| F7 | `engines: ['occt']` 声明 | **99 处 / 22 文件**（`packages/*/src`），其中 `arg-spec.ts` 内 **35 处** | `grep -rn "engines: \['occt'\]"` |
| F8 | `getOcctKernel` 出现面 | **67 处 / 21 文件**，其中带括号调用 **42 处** | `packages/core/src` 全量 grep |
| F9 | 扫描器与命令 | `packages/core/scripts/scan-occt-op-coverage.ts`；`package.json` 的 `scan:occt-ops` | 已存在，非待建 |
| F10 | 快照产物 | `packages/core/src/api/surface/occt-op-coverage.json` | L1 100 / L2 8 / L3 3 / L4 105 |
| F11 | 四级**并集** | L1∪L2∪L3 = **106**（重叠：`getShapeType` 属 L1∩L2∩L3；`release`/`split` 属 L1∩L2；`healWire` 属 L2∩L3） | F10 逐项比对 |
| F12 | L4 = 211 − \|L1∪L2∪L3\| | 105 | 算术自洽（不是 211−100−8−3=100） |
| F13 | L3 违规规模 | **1 个 op**（`healSolid`），涉 3 个方法（`getShapeType`/`healFace`/`healWire`） | F10 的 `l3Ops` |
| F14 | 目录名 | `packages/core/src/api/brep-operations/`（`b534970` 由 `brep-mirror/` 改名） | 目录实测；`selfhost` 字段同期退役 |
| F15 | 现视图 op | `projectView` / `projectSheet` / `viewCamera`（已是 HLR→SVG） | `symbol-table.generated.ts:78-80`；`api/view/view-projection.ts:257`、`api/view/view-sheet.ts:70` |
| F16 | 现平面截面 op | `sectionByPlane`（中立 op，L1 `sectionByPlane` 双引擎实现） | `symbol-table.generated.ts:34`；`api/section-by-plane.ts:70` |
| F17 | `sweep` 的实现路径 | 只用 `sweepPipeShell` / `simplePipe`，从不用任何 `*Law` | `api/brep-operations/sweepFns.ts:139,141,179,244` |
| F18 | 内核句柄捕获形态 | 存在别名捕获与 `.call()` 调用，破坏「`<内核变量>.<方法>(`」正则识别 | `occt-kernel/occt-primitives.ts:107`（`raw.linearPattern.bind(k)`）、`:267,282,288`（`nativeLinearPattern(...)`）、`:273`（`(k as OcctUnknown).circularPattern.call(k, ...)`） |
| F19 | 扫描器的 op 全集口径缺陷 | `opDirect` 只遍历 arg-spec `scriptFace:true` 条目；`natives` 与 `fileCalls` 算出后**从未被读取**（死代码） | `scan-occt-op-coverage.ts:327`、`:319-323`、`:201-205` |
| F20 | 上述缺陷的可验证后果 | `sweep` / `loft` / `thicken` / `extrude` / `revolve` 的 arg-spec 条目**无 `scriptFace`**（由手写平台 op 覆盖），其直调的能力全部落入 L4 | `arg-spec.ts:1881,1889,1896`（无 scriptFace）、`:2043`（`loft` 为 `skip`）、`:3233`（`thicken` 为 `skip`）；对应实现 `sweepFns.ts:139`、`api/loft.ts:63,69`、`api/thicken.ts:52` |
| F21 | `*WithHistory` 能力面 | 12 个能力名全部由 occt-wasm 提供；L1 契约只含其中 4 个（`fuseWithHistory`/`cutWithHistory`/`intersectWithHistory`/`filletWithHistory`） | `brep/engine/adapters/occt.ts` 的 `OCCT_EVOLUTION_KINDS`（12 项）与 `primitives.ts` 契约成员 |
| F22 | 平台独有能力清单（源码自述） | 「loft 族、工具实体 section/split、L1 三员之外的 `*WithHistory`、XCAF 等不在 L1 契约里」 | `brep/engine/adapters/occt.ts` 文件头 |
| F23 | 成员计数口径 | 212 唯一名 − 1 = **211** | `dist/index.d.ts:34-651` 有 216 行 4 空格缩进的成员声明；按**名**去重（`exportStl` 3 个重载并 1、`getBoundingBox` 2 个重载并 1）得 **212** 个唯一名；扣除符号键协议方法 `[Symbol.dispose]` 得 **211**。本方案全篇的 211 即此口径，§3 穷尽性校验按此复现 |

**F11/F12 的算术纪律**：四级是**集合**不是划分。任何「L1+L2+L3+L4 = 211」的求和表述都是错的（100+8+3+105 = 216）；正确表述是 L4 = 211 − |L1∪L2∪L3|。

**F19/F20 的后果**：现有快照的 L4（105）**不是**「脚本用不到的能力」清单，而是「未被扫描器识别的直调 ∩ 未被契约覆盖」的混合体，其中至少 6 个方法对应的能力早已是脚本 op。§3 已按修正口径逐条重新判定；修正后的扫描器（§7）必须复现本表。

---

## 3. 处置总表（211 项穷尽）

| 类 | 计数 |
|---|---|
| C1 契约可达 | **102** |
| C2 平台 op 已触达 | **64** |
| C3 能力已由现 op 覆盖 | **10** |
| C4 新增脚本 op | **1** |
| C5 实现面接入 | **10** |
| C6 显式排除 | **24** |
| **合计** | **211** ✓ |

> **口径对齐（2026-10-07 S4 接手，二次刷新）**：本表计数取自 `packages/core/src/api/surface/occt-op-coverage.json`（`npm run scan:occt-ops` 实测，穷尽性四项全绿：sum 211 / equalsUpstream / disjoint / unionCoverage；L3 = 0）。
> 权威增量链：**C2 64 = 25（类型判定族 8 项落地后） + 22（曲线草图 11 / 曲面面 6 / 实体偏置 5，commit `5da07a0`） + 17（测量查询 11 + liftCurve2dToPlane + intersectionCells + booleanOp + alignX/Y/Z）**。
> **2026-10-08 收口批（C4 5 → 1）**：`chamferAsymmetric` / `cutAll` / `sweepAdvanced` / `sweepOriented` 四项判定为 **C3**（能力已由现 op 覆盖），**C4 只剩 `createXCAFDocument`**。四项一律**不能**落 C2：承载它们的 `chamfer` / `subtract` 是**中立 op**（brepkit 也要跑），在其实现体里插 occt 原生直调会造 **L3 违规**（扫描器 `scan-occt-op-coverage.ts:383-395` 的判定：op 直调了 occt 方法却未声明 `engines:['occt']`）。等价证据固化于 `packages/core/test/api/occt-s4-c4-disposition.test.ts`（9 用例）：
> - `cutAll`：原生 `cutAll(A,[B,C])` 与链式 `subtract(A,B,C)` 同为 **250**（A−(B∪C) = ((A−B)−C)），`cad.boolean([a],[b,c],'cut')` 同解；
> - `sweepAdvanced`：原生 `sweepAdvanced(w,sp,opts)` 与 `sweepFull(w,sp,opts)` 体积相等（`SweepFullOptions extends SweepAdvancedOptions`，是**严格超集**）；
> - `sweepOriented`：原生 `sweepOriented(w,sp,FixedUp,up)` 与 `sweepFull(w,sp,{mode:FixedUp,up})` 体积相等（其 `SweepOrientedOptions` 的 tolerances / `curvilinearEquivalence` / `contact` 全在 `SweepAdvancedOptions` 里）；本批补上 `SweepOptions` 漏声明的 `withContact` / `withCorrection`（`sweepFns.ts` 早已支持，脚本面却触达不到）；
> - `chamferAsymmetric`：原生 `chamferAsymmetric(edge, d1, d2, refFace)` 与 `chamfer` 的 `twoDistances` 换算（§3.5 → `chamferDistAngle(dF,θ)`）体积相等 ⇒ `twoDistances` 即非对称倒角，`referenceFace` 的取舍由 `EdgeTopoRef.faces` 的**顺序**表达（换序即换参考面）。
> 更早的 §3 初稿写的是 C2=10 / C4=64（S3 law 族再分类前的基线）；law 再分类（§3.4.3 校正注：`buildExtrusionLaw`/`trimLaw`→C6、`sweepWithLaw`→C3）与类型判定族 8 项从 C4→C2 都已在链上。C6 的 24 为扫描器实测值，未变。
> **剩余 C4 的 1 项**：`createXCAFDocument`（§5.3，S5，建文档 op 的命名待拍板）。

### 3.1 C1 — 契约可达（102）

经 `occt-kernel/` 实现 L1 契约成员而被中立 op 使用。**无需动作。**

权威清单由修正后的扫描器产出。当前实测 100 项（快照 `L1` 数组），另加 2 项已证实的识别漏检：

| 补充项 | 为什么属 C1 | 证据 |
|---|---|---|
| `linearPattern` | 用于实现契约成员 `linearPattern`（返回 compound，适配器拆成句柄数组） | `occt-kernel/occt-primitives.ts:107,266-269` |
| `circularPattern` | 用于实现契约成员 `circularPattern` | `occt-kernel/occt-primitives.ts:270-277` |

> **口径提醒**：C1 的 102 与契约成员数 F3 的 102 **数值相同纯属巧合**——C1 的元素是 occt **方法名**（L1 快照 100 项 + `linearPattern`/`circularPattern` 两项漏检），F3 的元素是 `BrepEngineApi` **成员**。两个集合元素不同，**禁止互相反推**。C1–C6 六类的元素一律是 `OcctKernel` 的方法名。

### 3.2 C2 — 平台 op 已触达（29）

已存在于脚本面、且声明 `engines:['occt']` 的 op 直调。**动作：确认声明齐全（其中 4 项为扫描器漏检，须由修正后的扫描器复现）。**

| 方法 | 触达它的 op | 证据 | 备注 |
|---|---|---|---|
| `healWire` | `heal` / 修复族 | `l3Ops` 之外，L2 成员 | — |
| `healFace` | 同上 | 快照 L3 → 该 op 缺 `engines` 声明 | 与 F13 同批修 |
| `makeHelixWire` | `helix` | `api/helix.ts`（`engines: ['occt']`） | — |
| `offset` | `offset` | `arg-spec.ts:3224` | — |
| `simplify` | `simplify` | `arg-spec.ts:3250` | — |
| `sweepPipeShell` | `sweep` / `complexExtrude` / `twistExtrude` | `sweepFns.ts:141,179,244` | — |
| `thicken` | `thicken` | `api/thicken.ts:52`（`getOcctKernel().thicken(...)`），`engines: ['occt']` 在 `api/thicken.ts:55` | 扫描器漏检 |
| `loft` | `loft` | `api/loft.ts:69` | 扫描器漏检 |
| `loftWithVertices` | `loft`（`startPoint`/`endPoint` 选项） | `api/loft.ts:60-63` | 扫描器漏检 |
| `simplePipe` | `sweep`（`mode:'simple'`） | `sweepFns.ts:139` | 扫描器漏检 |

> **S4 落地（2026-10-07）：类型判定族 8 项**，occt 平台 op（普通函数形态 + `assertEngineFor('<op>',['occt'])` 引擎守卫，与 `api/export-brep.ts` 同口径；不能走 `defineOp`，因其返回布尔而非 Shape）。实现见 `api/shape-type/index.ts`，注册见 `api/api-namespace.ts`，扫描器 `PLAN_C2_EXTRA` 已补 8 方法名（`collectOps` 看不见普通函数）。测试固化于 `test/api/occt-s4-shape-type.test.ts`（10 用例全绿）。

| 方法 | 触达它的 op | 证据 | 备注 |
|---|---|---|---|
| `isEdge` | `isEdge` | `api/shape-type/index.ts` | occt 原生 `isEdge`，`engines:['occt']` |
| `isFace` | `isFace` | 同上 | 同上 |
| `isShell` | `isShell` | 同上 | 同上 |
| `isVertex` | `isVertex` | 同上 | 同上 |
| `isWire` | `isWire` | 同上 | 同上 |
| `isCompound` | `isCompound` | 同上 | `isCompound` 与 `../shape#isCompound`（TS 守卫）同名，仅在 cad 脚本面暴露，不平铺到 `api/index.ts` 桶 |
| `isCompSolid` | `isCompSolid` | 同上 | 同上 |
| `isEqual` | `isEqual` | 同上 | occt `IsEqual` 语义（同 TShape+Location/Orientation）；几何相同但独立构造返回 false，区别于 `isSame` |

> **S4 落地（2026-10-07，续类型判定族之后）：视图与导出族 4 项**（`toSVG` / `toMultiviewSVG` / `toPNG` / `toMultiviewPNG`），occt 平台 op（普通函数形态 + `assertEngineFor('<op>',['occt'])` 引擎守卫，与 `api/export-brep.ts` / `api/shape-type` 同口径；不能走 `defineOp`，因其返回字符串 / Uint8Array 而非 Shape）。实现见 `api/view-export/index.ts`，注册见 `api/api-namespace.ts`，扫描器 `PLAN_C2_EXTRA` 已补 4 方法名（`collectOps` 看不见普通函数）。测试固化于 `test/api/occt-s4b-view-export.test.ts`（6 用例全绿：SVG 含 `<svg`、PNG 头 89 50 4E 47、非 occt 引擎抛 `E_BREP_UNSUPPORTED`、mesh-only 抛 `E_SHAPE_TYPE_NO_BREP`）。

| 方法 | 触达它的 op | 证据 | 备注 |
|---|---|---|---|
| `toSVG` | `toSVG` | `api/view-export/index.ts` | occt 原生 `toSVG`（HLR→SVG 单命名视图），`engines:['occt']` |
| `toMultiviewSVG` | `toMultiviewSVG` | 同上 | occt 原生 `toMultiviewSVG`（多视图图纸） |
| `toPNG` | `toPNG` | 同上 | occt 原生 `toPNG`（PNG 字节，异步 CompressionStream 压缩） |
| `toMultiviewPNG` | `toMultiviewPNG` | 同上 | occt 原生 `toMultiviewPNG`（多视图 PNG 字节，异步） |

> **§3.4.7 校正注（2026-10-07 接手）**：本族 `toSVG` / `toMultiviewSVG` 原 S3 初稿标为「中立（扩 projectView / projectSheet）」，但实测 L1 契约 `BrepEngineApi` 无 `projectView` / `toSVG` 等渲染成员（L1 仅含 STEP/STL 导入导出），故这 4 个导出**不能走中立路径**，必须声明 `engines:['occt']` 直调 occt 原生。判定从「中立」更正为「occt 平台 op」，落点不变（仍为脚本面新符号）。`exportStl` 仍属 C3（能力已由现 op 覆盖，见 §3.3），`toBREP` 已随 S3 落地为 `exportBrep`（C2）。

### 3.3 C3 — 能力已由现 op 覆盖（3）

方法本身未被直调，但**同一能力**已有脚本 op 经别的内核路径达成。**无需动作，但须在新增 op 时避开命名与语义重叠。**

| 方法 | 能力 | 已覆盖它的 op | 现 op 走的路径 |
|---|---|---|---|
| `rotate` | 绕轴旋转 | `rotate`（`capabilities: ['transform']`）、`rotate_euler` | 复合变换矩阵 → L1 `transform` |
| `sweep` | 沿 spine 扫掠 | `sweep`（`engines: ['occt']`） | `sweepPipeShell` / `simplePipe`（F17） |
| `sectionPlane` | 平面截面（精确保留解析几何） | `sectionByPlane`（中立 op，F16） | L1 `sectionByPlane`（大平面 face 作 tool 经原生 `section` 达成） |

> `sectionPlane` 是本表中最易误判的一项：occt-wasm 的原生 `sectionPlane` 返回复合体，而 faijs 的中立成员 `sectionByPlane` 用另一条路径拿到了同样的精确交线。**不得**再新增一个叫 `sectionPlane` 的平台 op——那会与 `sectionByPlane` 形成双轨。

### 3.4 C4 — 新增脚本 op（64）

真实缺口。**这一批就是「只要能移植都必须全部移植」的主体。**

64 项中 **9 项是扩现 op**（给已存在的 op 加参数，**不新增脚本符号**）：`sweepFull` / `sweepAdvanced` / `sweepOriented` / `sweepWithLaw`（扩 `sweep`）、`chamferAsymmetric`（扩 `chamfer`）、`cutAll`（扩 `subtract`）、`makeHelixWireHanded`（扩 `helix`）、`toSVG`（扩 `projectView`）、`toMultiviewSVG`（扩 `projectSheet`）；其余 **55 项**为新增符号。下面 9 个分族行数之和 = 64（12+6+6+5+3+22+6+1+3）。

#### 3.4.1 曲线与草图构造族（12）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `makeEdge` | `edge` | occt | 两顶点 → 边（L1 只有 `makeLineEdge` 等按几何构造，无顶点对构造） |
| `makeCircleArc` | `circleArc` | occt | 圆心+法向+半径+起止角 |
| `makeEllipseEdge` | `ellipseEdge` | occt | 整椭圆边 |
| `makeEllipseArc` | `ellipseArc` | occt | 椭圆弧 |
| `makeTangentArc` | `tangentArc` | occt | 起点+切向+终点 |
| `approximatePoints` | `approximatePoints` | occt | 点集**逼近**（与 L1 `interpolatePoints` 的插值成对） |
| `interpolatePointsWithTangents` | `interpolateWithTangents` | occt | 带端点切向的插值 |
| `curveDegreeElevate` | `curveDegreeElevate` | occt | NURBS 升阶 |
| `curveKnotInsert` | `curveKnotInsert` | occt | 插节点 |
| `curveKnotRemove` | `curveKnotRemove` | occt | 去节点（带容差） |
| `curveIsPeriodic` | `curveIsPeriodic` | occt | 周期性查询（L1 只有 `curveIsClosed`） |
| `makeHelixWireHanded` | 扩 `helix`（`handed`） | occt | 显式手性（左右旋）；现 `helix` 只有右手，二者同 pitch/height/radius 互为镜像 |

#### 3.4.2 曲面与面构造族（6）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `bsplineSurface` | `surface` | occt | 点阵 → B 样条曲面（heightmap 链路） |
| `makeFaceOnSurface` | `faceOnSurface` | occt | 在已有面上建面 |
| `makeNonPlanarFace` | `nonPlanarFace` | occt | 非平面 wire → 面（L1 `makeFace` 只处理平面） |
| `makeSolid` | `makeSolid` | occt | 闭合壳 → 实体（与 `sewAndSolidify` 的分工见 §4.5） |
| `reverseSurfaceU` | `reverseSurfaceU` | occt | 反转面的 U 参数方向 |
| `outerWire` | `outerWire` | occt | 取面外环（查询） |

#### 3.4.3 扫掠与 law 族（6）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `sweepFull` | 扩 `sweep`（`options`） | occt | 完整控制面：法向模式 + 转角过渡 + 截面放置 + 支持面 + 逼近预算 + 缩放律。**这是 twist 类特征的正确实现路径**（F17：现 op 从不用 `*Law`） |
| `sweepAdvanced` | 扩 `sweep` | occt | `sweepFull` 的子集，参数并轨。**2026-10-08 → C3**：`SweepFullOptions extends SweepAdvancedOptions`（严格超集），`sweep` 已走 `sweepFull` ⇒ 能力已覆盖，无需再单列入口（不落 C2 的理由见 §3 增量链） |
| `sweepOriented` | 扩 `sweep` | occt | 方向模式 + 辅 spine。**2026-10-08 → C3**：`mode`/`up`/`auxSpine` + `SweepOrientedOptions`（tolerances / `curvilinearEquivalence` / `contact`）全在 `SweepAdvancedOptions` ⊆ `SweepFullOptions` 内 |
| `buildExtrusionLaw` | `extrusionLaw` | occt | 构造挤出律（长度随参数） |
| `trimLaw` | `trimLaw` | occt | 截断律 |
| `sweepWithLaw` | 扩 `sweep` | occt | law 驱动扫掠 |

> **实测校正（2026-10-07 接手）：`buildExtrusionLaw` / `trimLaw` / `sweepWithLaw` 三个 law 原生在
> occt-wasm **5.6.0（npm latest）的 wasm 里均未导出**——facade 头声明了它们，TS 包装层也转发了，
> 但 `facade/generated/kernel.cpp` 缺对应实现，wasm 导出表里没有这三个函数
> （`this[#raw].buildExtrusionLaw is not a function`）。证据固化于
> `packages/core/test/api/occt-s3-capability-probes.test.ts` 用例 D/E。npm latest 即 5.6.0，无更新版可升。
> 因此：
> - `buildExtrusionLaw` / `trimLaw` → **C6 显式排除**（理由：上游未导出，无法调用；其「律」能力已由
>   `sweepFull` 内建 `Law_Linear` / `Law_Constant` 覆盖，见用例 F），不再单列 `extrusionLaw` / `trimLaw` op。
> - `sweepWithLaw` → **C3**（能力已被 `sweepFull` 的 law 选项覆盖，见用例 F），不再单列 `sweepWithLaw` op。
> - `sweepFull` 已在 S3 落地，且 `sweepFull` 的 law 选项即 law 族能力的唯一正确交付面。
> - `sweepAdvanced` / `sweepOriented`（2026-10-08 收口批）判为 **C3**：`SweepFullOptions
>   extends SweepAdvancedOptions`（严格超集），`SweepOrientedOptions` 的 tolerances /
>   `curvilinearEquivalence` / `contact` 也全在 `SweepAdvancedOptions` 内 ⇒ 二者能力已由
>   `sweep` 的 sweepFull 路径覆盖。同批补上 `api/sweep.ts` 的 `SweepOptions` 漏声明的
>   `withContact` / `withCorrection`（`sweepFns.ts:121-122,212-214` 早已支持，脚本面却
>   因缺声明触达不到）。证据：`test/api/occt-s4-c4-disposition.test.ts` 用例 B1 / B2 / B3。
>   扫描器 `PLAN_C3` 已同步。

#### 3.4.4 实体与偏置族（5）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `buildSolidFromFaces` | `solidFromFaces` | occt | 面集一次成型为实体（带容差） |
| `halfSpace` | `halfSpace` | occt | 无限半空间实体，作无界布尔切割工具 |
| `offsetWire2D` | `offset2d` | occt | 2D 轮廓偏置（OpenSCAD `offset()` 链路） |
| `draftPrism` | `draftPrism` | occt | 拔模棱柱（带角度挤出） |
| `pipe` | `pipe` | occt | 沿 spine 的管（与 `sweep` 的截面扫掠区分） |

#### 3.4.5 倒角与布尔扩展（3）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `chamferAsymmetric` | 扩 `chamfer`（`distance2` + `referenceFace`） | occt | 非对称倒角；扩现 op 不新增符号。**2026-10-08 → C3**：`chamfer` 的 `type:'twoDistances'`，`referenceFace` 的取舍由 `EdgeTopoRef.faces` 顺序表达 |
| `cutAll` | 扩 `subtract`（接受工具数组） | occt | n 元差集；扩现 op 不新增符号。**2026-10-08 → C3**：`subtract(a,b,c)` 链式，或 `cad.boolean([a],[b,c],'cut')` 一次成 |
| `booleanOp` | `boolean` | occt | 带 glue/fuzzy/simplify 选项的通用布尔（脚本面现有 `union`/`subtract`/`intersect` 均为无选项版）**已落地** |

> **2026-10-08 收口（2/3 → 3/3）**：上两行判为 C3 的依据是「原生 ↔ 现 op」的**体积等价实测**，
> 证据固化于 `test/api/occt-s4-c4-disposition.test.ts` 用例 A1–A3 / C1–C3。不落 C2 的硬约束：
> `chamfer` / `subtract` 是中立 op，塞 occt 原生直调 ⇒ L3 违规。

> **已落地（2026-10-07，本批，1/3）**：`booleanOp` → `cad.boolean`，实现见
> `api/boolean-op/index.ts`，注册见 `api/api-namespace.ts`（cad 面名 `boolean`）与
> `api/index.ts`（导出面 ⊇ cad 面是硬门禁 —— `test/lang/op-set-consistency.test.ts`
> 要求 cad 命名空间每个函数都被 `api/index.ts` 导出，故必须**同时**以 `boolean` 导出；
> `booleanOp` 只是给 TS 消费方的自解释别名）。测试固化于
> `test/api/occt-s4-boolean-align.test.ts`（18 用例全绿）。
> naming 为 `unmodeled`：原生 `booleanOp` 回的 `EvolutionData` 里 modified/generated/
> deleted 是**扁平的面 hash 数组**，不是本仓 `faceEvolution` 需要的
> `Map<输入面 hash, 结果面 hash[]>` —— 合成不出 roleTable，按 §4.2 纪律不给
> `kernel` + `byAdjacency`（那会声称「内核给了历史」，实为伪造身份）。

#### 3.4.6 测量与查询族（14，原 22 含 8 项已移至 C2）

> **已落地（2026-10-07，本批，13/14）**：实现见 `api/measure-query/index.ts`，注册见
> `api/api-namespace.ts` / `api/index.ts`，扫描器 `PLAN_C2_EXTRA` 补 11 个方法名
> （返回非 Shape 的普通函数不在 `collectOps` 口径内）。测试固化于
> `test/api/occt-s4-measure-query.test.ts`（25 用例全绿）。
> 形态二分：**返回 Shape 的两项走 `defineOp`**（`liftCurve2d` ← 原生
> `liftCurve2dToPlane`；`commonCells` ← 原生 `intersectionCells`），**其余 11 项返回
> 标量/Vec3/对象/Shape[] ⇒ 普通函数 + `assertEngineFor`**（与 shape-type 同口径）。
> naming：`liftCurve2d` / `commonCells` 均为 `unmodeled`（前者无面词汇；后者原生只回
> 裸 Shape，无 EvolutionData）。
>
> **GOTCHA（上游载体差异，写实现前必读）**：occt-wasm 的 `Vec3` 是 **`{x,y,z}` 对象**
> （`dist/types.d.ts:52-56），faijs 脚本面的 `Vec3` 是 **`[x,y,z]` 数组**
> （`mesh/types.ts:21`，见 `api/geom.ts` 里 `normal = [n.x, n.y, n.z]` 的同款转接）。
> 漏掉这层转换的**症状不是报错**——原生读到 `undefined` 坐标，静默落在原点。
>
> **GOTCHA（`liftCurve2d` 产物形态）**：原生造的是**过点的插值 B 样条**，不是折线
> wire ⇒ bbox 会越出给定点集（实测点集 bbox x∈[0,10]，产物 xmax ≈ 10.4167）。
> 判定产物只能用端点（`curvePointAtParam` 于参数域两端），不能用 bbox。

#### 3.4.6 测量与查询族（14，原 22 含 8 项已移至 C2；本批再落地 13/14）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `containsPoint` | `containsPoint` | occt | 点是否在实体内（含容差） |
| `distanceBetween` | `distanceBetween` | occt | 两形状最短距离 |
| `getInertia` | `inertia` | occt | 绕质心的惯性矩阵（3×3） |
| `getLinearCenterOfMass` | `linearCenterOfMass` | occt | 线性质心 |
| `surfaceCurvature` | `surfaceCurvature` | occt | 曲面曲率（**实现前须核实 `inspectCurvature` 是否已覆盖**；若已覆盖则本行转 C3） |
| `projectPointOnEdge` | `projectPointOnEdge` | occt | 点 → 边上最近点 + 切向 + 参数 |
| `projectPointOnFace` | `projectPointOnFace` | occt | 点 → 面上最近点 |
| `classifyPointOnFace` | `classifyPointOnFace` | occt | UV 点相对面边界的分类 |
| `uvFromPoint` | `uvFromPoint` | occt | 点 → 面 UV |
| `vertexPosition` | `vertexPosition` | occt | 顶点坐标 |
| `subShapeCount` | `subShapeCount` | 中立 | 不需要物化句柄的子形状计数 |
| `iterShapes` | `iterShapes` | 中立 | 遍历全部子形状 |

> ↑ `isEdge`/`isFace`/`isShell`/`isVertex`/`isWire`/`isCompound`/`isCompSolid`/`isEqual` 八个类型判定谓词已于 **S4 落地为 occt 平台 op**，从本 C4 表移除（见 §3.2 S4 落地表与 §9.5 降级路径）。其「中立」标注为 S3 初稿误判——L1 契约 `BrepEngineApi` 不含这些类型判定成员（仅 `isSolid` 与 `getSubShapes`/`subShapeHashes`），实测校正见 §3.4.6 末尾校正注。

| `intersectionCells` | `commonCells` | occt | ≥2 输入的重叠区域（干涉/通用熔合胞元） |
| `liftCurve2dToPlane` | `liftCurve2d` | occt | 2D 点集 → 平面 wire |

#### 3.4.7 视图与导出族（6）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `toSVG` | 扩 `projectView` | 中立 | 现 op 已是 HLR→SVG（F15）；补命名视图与虚线隐藏边样式 |
| `toMultiviewSVG` | 扩 `projectSheet` | 中立 | 现 op 已是多视图图纸；补标准视图排布与尺寸标注 |
| `toPNG` | `projectViewPng` | occt | 光栅输出（现面只有 SVG） |
| `toMultiviewPNG` | `projectSheetPng` | occt | 多视图光栅输出 |
| `exportStl` | `exportStl` | 中立 | 脚本面**只有导入没有导出**；二进制/ASCII 双形态 |
| `toBREP` | `exportBrep` | 中立 | 文本 BREP 导出，与现 `import_brep` 对称（L1 已含 `fromBREP`） |

#### 3.4.8 XCAF 族（1）

| occt 方法 | 落点 | 说明 |
|---|---|---|
| `createXCAFDocument` | 建文档 op（**命名待你拍板**） | 见 §5.3；建文档能力必须可达，不整族排除。这是 2026-10-08 收口批后 **C4 唯一剩余项** |

#### 3.4.9 对齐/定位族（3）

| occt 方法 | 建议 op | 引擎 | 说明 |
|---|---|---|---|
| `alignX` | `alignTo`（`axis: 'x'`） | occt | 按包围盒锚点把形状对齐到目标 X |
| `alignY` | `alignTo`（`axis: 'y'`） | occt | 同上，Y |
| `alignZ` | `alignTo`（`axis: 'z'`） | occt | 同上，Z |

> **实测校正（2026-10-07 接手）：本族「`isEdge`/`isFace`/`isShell`/`isVertex`/`isWire`/`isCompound`/`isCompSolid` 为中立 op」的判断需修正。** L1 契约 `BrepEngineApi`（`brep/engine/primitives.ts`）**不含** `isEdge` 等类型判定方法，也不含 `getShapeType` / `isEqual`（仅含 `isSolid` 与 `getSubShapes`/`subShapeHashes`）。因此这些谓词**无法走 L1 中立路径**，必须声明 `engines: ['occt']` 直调 occt 原生 `isEdge`/`isFace`/…（它们确实在 `OcctKernel` 的 211 成员里）。另：arg-spec 中 `core/shapeTypes.js` 的 `isEdge`/`isFace`/`isShell`/`isVertex`/`isSolid`/`isShape3D`/`isValidSolid` 旧 `skip` 条目指向的模块**已不存在**（`packages/core/src/core/shapeTypes.*` 无文件），属 stale 引用，需按新 op 重做。判定：本族从「中立」改为「occt 平台 op」，落点不变（仍为脚本面新符号）。

> 脚本面现无 `align` 族符号：`place`/`locate` 是矩阵/定位语义，`bboxMin`/`bboxMax`/`bboxCenter` 是查询，二者组合可表达但无单调用。三者是同一 op 的三参数形态，**落一个符号** `alignTo`。

> **已落地（2026-10-07，本批，3/3）**：实现见 `api/align/index.ts`，注册见
> `api/api-namespace.ts` / `api/index.ts`。测试固化于
> `test/api/occt-s4-boolean-align.test.ts` A4/A4b/A5/A6（18 用例全绿）。
> naming 为 `kernel` + `newFaces: { via: 'byAdjacency' }`——对齐是刚体平移，与
> `api/transform.ts` 的 `translate` 同口径。
>
> **GOTCHA（默认值，实测钉在 A4b）**：`target` / `anchor` 在 d.ts 里都写作可选，但
> 原生的默认值是 **`target = 0` 且 `anchor = "center"`**（`dist/index.js:549-553`
> 的默认参数）——**不是**直觉上的 `min`。缺省调用 `cad.alignTo(p, 'z')` 把包围盒
> **中点**挪到 0（`z∈[0,10]` 的盒子会移到 `zmin = −5`）。本 op 不替上游编默认值
> （缺省一律透传 `undefined`），因此该语义变化会直接透到脚本面。
>
> 实现细节（与扫描器有关）：三轴走 **if/else 显式直调**，不用
> `const native = axis === 'x' ? k.alignX : …` 再 `.call()` —— 动态取属性会让
> `scan-occt-op-coverage.ts` 看不见 `alignX`/`alignY`/`alignZ`，它们会掉回 C4 被
> 误判成「未接入」。

### 3.5 C5 — 实现面接入（10）

有语义，但属**同一能力的更优路径**：造新符号会与现 op 形成双轨。正确落点是让现 op 内部按引擎能力择优选用。

| 方法 | 接入点 | 收益 |
|---|---|---|
| `translateWithHistory` | `translate` / `place` | 血缘更准 |
| `rotateWithHistory` | `rotate` / `rotate_euler` | 血缘更准；`rotateBrep` 双轨（occt 走权威，brepkit 走 Rodrigues+transform）；`rotate_euler` 单轴特判；产物 STEP 导出安全（与原生 `rotate` 的 GOTCHA 无关） |
| `mirrorWithHistory` | `mirror` | 血缘更准；`mirrorBrep` 双轨（occt 走权威，brepkit 走裸 `mirror`+identity）；replicate 不重复消费（role table 经质心聚类重建） |
| `scaleWithHistory` | `scale` / `scale3d` | 血缘更准 |
| `chamferWithHistory` | `chamfer` | 与已接入的 `filletWithHistory` 对称 |
| `shellWithHistory` | `shell` | 血缘更准；`shellBrep` 双轨（occt 走权威，brepkit 走裸 `shell`） |
| `offsetWithHistory` | `offset` | 上游 5.6.0 空壳（`modified`/`deleted` 全空），接入为未来就绪（见 `test/api/occt-s4-c5-disposition.test.ts`） |
| `thickenWithHistory` | `thicken` | 上游 5.6.0 空壳（`modified`/`deleted` 全空），接入为未来就绪 |
| `buildCurves3d` | `heal` / `import_step` | wire 上重建 3D 曲线（原地变更）；已接入 `healWireBrep`（`healWire` 后追加，幂等补充） |
| `fixWireOnFace` | `sketchOnFace` | 草图贴合面的几何前置；已接入 `buildOnFace`（`assembleWireOnFace` 后、`makeFace` 前） |

**纪律**：C5 的接入不得改变 op 的外部签名、错误码与脚本面符号。是否启用由引擎能力表静态判定，brepkit 侧缺该能力时回退到现路径（**回退必须在实现层显式写出，不得静默**）。

### 3.6 C6 — 显式排除（22）

| 类别 | 方法 | 理由 |
|---|---|---|
| 批量/性能聚合 | `meshBatch` `queryBatch` `filletBatch` `rotateBatch` `scaleBatch` `translateBatch` `mirrorBatch` `transformBatch` `booleanPipeline` | 同一 op 的批量版本或单调用链式聚合。脚本层用循环/数组表达；暴露会固化 wasm 调用形态 |
| wasm 胶水 | `tessellate` `hasTriangulation` | 网格化是渲染/导出的内部路径，不是建模语义。网格数据由 mesh 链路（manifold）负责 |
| 序列化缓存 | `cacheStep` `loadCached` | 性能内部机制 |
| 二进制形态 | `toBREPBinary` `fromBREPBinary` | 二进制载荷在脚本面（文本 JS 子集）无法表达——`.fai.js` 里没有二进制字面量 |
| 生命周期/调试 | `init`（static 工厂）、`releaseAll`、`shapeCount`（arena 句柄计数，非形状子元素数）、`describe` | 内核装配与 arena 管理由宿主承担；`describe` 是调试文字摘要 |
| 集成面逃生口 | `getRawKernel` `getRawModule` | 供第三方适配器取原生句柄，会绕过引擎抽象；库层面可用，不进脚本面 |
| 空值构造 | `makeNullShape` | 空句柄用 `null` / `Result` 表达，不需要脚本 op |
| 并发面 | `OcctWorker` 全部成员 | 见 §1.4 |

**排除不是丢弃**：C6 的方法仍可被 op 实现内部调用（届时自动升为 C1/C2 可达）。排除只表示「不单独占一个脚本符号」。

### 3.7 穷尽性校验

| 校验项 | 断言 |
|---|---|
| 计数完备 | C1(102) + C2(25) + C3(6) + C4(44) + C5(10) + C6(24) = **211** |
| 互斥 | 任一方法只出现在一类中；类别内方法名不重复 |
| 上游一致 | 六类方法名之并集 == `OcctKernel` 成员名全集（212 唯一名 − `[Symbol.dispose]` = 211；重载按名去重；含 `init` 与 `shapeCount`，见 F23） |
| C4 分族自洽 | 扫描器实测 **C4 = 1**，即 `createXCAFDocument`（§3.4.8 / §5.3，建文档 op 命名待拍板）。原 5 项里的 `chamferAsymmetric` / `cutAll`（§3.4.5）与 `sweepAdvanced` / `sweepOriented`（§3.4.3）已于 2026-10-08 收口批判为 C3（证据见 `test/api/occt-s4-c4-disposition.test.ts`）。以 `packages/core/src/api/surface/occt-op-coverage.json` 为准 |
| 非 `OcctKernel` 面 | `XCAFDocument` / 自由渲染函数 / `OcctWorker` 三者各自有明确落点或排除理由（§1.4、§5.2、§5.3） |

校验由扫描器自动执行（§7.4），不满足即 `exit 1`。**这不是覆盖率门禁**：它判的是「划分是否完备」，不判「该不该接」。

---

## 4. 新增 op 的规范

### 4.1 arg-spec 条目（唯一人工维护点）

`packages/core/src/api/surface/arg-spec.ts`，实现文件位于 `packages/core/src/api/brep-operations/`（F14 之后的目录名）：

> 术语提示（防误读）：该文件头把本表称作「brepjs 投影面的增量清单」（`arg-spec.ts:19`，属**遗产措辞**）。brepjs vendor 树已于 2026-09-25 删除（`api/brepjs-compat/index.ts` 头部自述；CI 守卫 `scripts/check-core-no-brepjs.mjs`，`.github/workflows/ci.yml:114`），现役 BREP 引擎集合为 `['occt', 'brepkit', 'brep_mock']`（`brep/engine/types.ts:23`）。本表**当下**的所指是 faijs 自己的 L3 投影面；条目里的 `source: 'operations/api.js#loft'` 一类是旧上游路径，同样是遗产字段。

```ts
{
  name: 'offset2d',
  source: 'brep-operations/offsetFns.ts#offset2dBrep',
  kind: 'brep-op',
  engines: ['occt'],                       // 平台 op 自证；brepkit 补 offsetWire2D 后删此行
  module: 'operations',
  geometryArgs: [0],
  reason: '2D 轮廓偏置；occt offsetWire2D 无 brepkit 对应，声明 engines 待降级',
  args: 'offset2d(profile: Shape, delta: number, options?: Offset2DOptions): Shape',
  params: ['profile', 'delta', 'options'],
  formClass: 'A',
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } },
  scriptFace: true,                        // 没有这行，脚本里就没有这个符号
}
```

必填：`name` / `source` / `kind` / `naming` / `scriptFace`。`engines` 按 §4.4 决策树决定。**不要**写 `selfhost` —— 该字段已退役（F14）。

### 4.2 `naming` 怎么选（六值封闭，`topology/naming/lineage.ts` 的 `Provenance`）

| kind | 适用 | 例 |
|---|---|---|
| `kernel` | 内核给历史：boolean / fillet / chamfer / shell / offset / 刚体变换 | `offset2d`、`boolean` |
| `construct` | 输出面 ↔ 输入有构造规则：extrude / revolve / sweep / loft / primitives | `surface`（需 `via: 'explicit'` 词汇） |
| `identity` | 1:1 映射：copy / clone / locate | — |
| `subdivide` | 一片 → 多片：split / section | `commonCells` |
| `replicate` | 第 k 份第 i 面 ← 第 i 面，需 `k` | — |
| `unmodeled` | 算不出来，**必须**给 `reason` | `halfSpace`、`makeSolid` |

**`kind: 'kernel'` 的确切含义**：面演化记录**由内核给出**（boolean / fillet / chamfer / shell / offset / 刚体变换），op 自己不推算面词汇，因此必须同时声明 `newFaces` 规则；执行期据此把 `faceEvolution` 补挂到血缘节点（`lineage.ts:105-113`、`define-op.ts` 的 lineage 挂载逻辑）。

- `newFaces: { via: 'byAdjacency' }` —— 新面按与旧面的**邻接关系**推导；
- `newFaces: { via: 'explicit', vocab }` —— 用**显式词汇表**（仅 `construct` 允许，`lineage.ts:81`）。

**为什么 `newFaces` 是必填**：不能靠内核的 `generated` 桶——实测它与 `modified` 同构分段、键集相同、值是各输入面派生的**中间形**（`cut` 的 12 个 hash 结果 0 存活，`fillet` / `fuse` 整桶为空），故 `byAdjacency` / `explicit` 必填（`lineage.ts:61-63`）。

查询类 op（返回数字/布尔/数组）不产出 Shape，`naming` 不适用。

**`sweep` 的三处口径不一致（实测；新增 op 严禁照抄上表）**：类型注释 `lineage.ts:80` 把 `sweep` 列在 `construct`；arg-spec 投影条目（`arg-spec.ts:1896-1901`）与生成产物（`generated/operations.ts:56-59`，该条目**无 `scriptFace`**、不进 cad 命名空间）声明 `kernel`；而脚本面真正执行的 `cad.sweep`（手写平台 op，`api/sweep.ts:87-94`）声明 `unmodeled`，理由 `'swept-body face vocabulary not defined'`（`sweepFns.ts` 内无 `naming` 声明）。新增 op 一律以自己的**血缘可算性**为准：词汇未定义就用 `unmodeled` + `reason`。

### 4.3 实现体：BREP 优先

```ts
// packages/core/src/api/brep-operations/offsetFns.ts
import { defineOp } from '../../define-op'
import { getOcctKernel } from '../../occt-kernel/occtKernel'

export const offset2dBrep = defineOp({
  name: 'offset2d',
  engines: ['occt'],        // 与 arg-spec 必须一致，否则声明与实现脱节
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } },
  brep: (profile, delta, options) => {
    const k = getOcctKernel()
    return k.offsetWire2D(/* … */)
  },
})
```

**硬约束**：

1. 实现必须走 OCCT BREP 算法，**不得用 Manifold 结果回填**（需要精确 STEP 的语义）。
2. `engines` 在 arg-spec 条目与 `defineOp` 调用**两处同时声明**。`assertLibConforms`（`define-op.ts`）只校验 `defineOp` 侧；arg-spec 侧由 §7 的扫描器交叉比对，不一致即报错。
3. 只给 `brep` 不给 `mesh` 是合法的（`define-op.ts` 的 `DualOpImpls` 允许 `mesh?: never`）——纯 occt 能力不必硬凑 mesh 实现。但**中立** op（`isEdge`/`iterShapes`/`exportStl` 等）必须同时给出 mesh 路径或声明为 brep-only 并写清理由。
4. 新增 op 必须配测试（§9.3）。

### 4.4 `engines` vs `capabilities` 决策树

```
实现只用 BrepEngineApi 的 102 个成员？
├─ 是 → 不写 engines（中立 op）；按需写 capabilities 声明所需能力
└─ 否（直调 occt 原生）→ 写 engines: ['occt']
                         └─ 若该能力在 BrepMethodKind 里有真名
                            （见 brep/engine/adapters/occt.ts 的 OCCT_METHOD_KINDS）
                            可同时写 capabilities，让能力门再做一次校验
```

### 4.5 与既有 op 的边界（去重表，实现前必读）

新增 op 前先对照本表，避免造出语义重叠的第二个符号：

| 新能力 | 已存在的 op | 边界 |
|---|---|---|
| `solidFromFaces` | `sewAndSolidify`、`sew` | 前者 = 已知面集**一次成型**（带容差）；后者 = 「面 → 缝合 → 固化」链。二者并存，`reason` 必须写清分工 |
| `makeSolid` | `compound`、`sewAndSolidify` | 输入是**已闭合的壳**，直接升为实体 |
| `pipe` | `sweep` | `pipe` = 沿 spine 的管；`sweep` = 截面沿 spine 扫掠 |
| `surface`（`bsplineSurface`） | `sweep` 的 `surface` 支撑面选项 | 前者独立构造曲面，后者是扫掠的一个选项 |
| `sectionPlane` | **不得新增** | 能力已由 `sectionByPlane` 覆盖（§3.3） |
| `boolean` | `union` `subtract` `intersect` `fuse` `cut` | 前者是带 glue/fuzzy/simplify 选项的通用形态 |
| `projectViewPng` / `projectSheetPng` | `projectView` `projectSheet` | 同族光栅化，命名与 SVG 版成对 |
| `exportBrep` | `import_brep` | 导出/导入成对 |
| `isEdge` 族 | `isSameShape` `isValid` | 前者是**类型判定**，后者是**同一性/有效性** |
| `offset2d` | `offset` | 前者是 **2D 轮廓**偏置，后者是 **3D 实体**面偏置 |

---

## 5. 分族设计

### 5.1 曲线 / NURBS 族

`approximatePoints`（逼近）与 L1 的 `interpolatePoints`（插值）是数学上对偶的两条路径，脚本面必须都能表达。`curveDegreeElevate` / `curveKnotInsert` / `curveKnotRemove` / `curveIsPeriodic` 属 NURBS 精修，是标准 CAD 能力（不是"底层内部细节"）：脚本作者用它做曲线归一、去冗余节点、判断周期性以决定接缝处理。四项按 §3.4.1 落为 op。

### 5.2 视图族（与既有 op 合流）

现状：`projectView` / `projectSheet` / `viewCamera` 已是脚本 op，实现经 `api/view/view-projection.ts`、`api/view/view-sheet.ts`，内部调 L1 `projectEdges`（HLR）。自由函数 `renderShapeSVG` / `renderMultiviewSVG` / `renderShapePNG` / `renderMultiviewPNG` 与 `OcctKernel.toSVG` 族是同一实现的两种入口。

落法：**不新增重复符号**，按 §3.4.7 扩 `projectView` / `projectSheet` 并补两个 PNG op。

### 5.3 XCAF 族（全族接入）

**为什么 XCAF 必须在场**：faijs 脚本层面必须完整支持 STEP（§11）。零件颜色、名称、标签树、装配层级、面/边级着色，这些数据的载体是 **XCAF 文档**，不是 Shape。`XCAFDocument`（`dist/xcaf-document.d.ts`）的 **16 个具名能力按能力逐条接入**；排除只允许逐条给「不应暴露给脚本面」的理由，不做整族排除。

| 能力 | XCAFDocument 成员 | 为什么必须接入 | 落点 |
|---|---|---|---|
| 建文档 | `create` | 写出带颜色/名称/装配的 STEP 必须先建文档——写侧链路的起点 | **接入**：运行时托管句柄 + 脚本可达的建文档入口（命名待拍板） |
| 从 STEP 建文档 | `fromSTEP` | 读侧入口：颜色/名称/标签树/装配全部由它产出 | **接入**：并入现 `import_step` 实现链（落点 B），不新增脚本符号 |
| 装配 / 部件 / 实例 | `addShape` `addChild` | 装配结构的写侧载体（§11.6 K1-1） | **接入**：扩 `assembly.*`；`addShape` 须带 `assembly:true` |
| 颜色 | `setColor` | 零件级颜色写侧载体（§11.6 K1-3） | **接入**：落「新增 op」或「`src/io/` 声明成员」（待拍板） |
| 名称 | `setName` | 零件级名称写侧载体（§11.6 K1-3） | 同上 |
| 子形状命名/着色 | `addSubShape` | 面/边级颜色与名称（读侧「子形状 label」缺口的写侧对偶，§11.3） | 同上（依赖面级引用 `faceRef`） |
| 装配/标签查询 | `getRoots` `getChildren` `getReferredLabel` `getLocation` `getSubShapes` `getLabelInfo` | 标签树与组件位姿的读侧载体；`getSubShapes` 是面/边级 label 的唯一入口 | **接入**：新增查询 op，与 §3.4.6 查询族同批 |
| 导出 STEP（保色保名） | `exportSTEP` | STEP 写侧主路径 | **接入**：并入导出族（§3.4.7） |
| 导出 glTF | `exportGLTF` | 与 `exportStl` 同族、能力不重复；脚本面缺 | **接入**：新增 op（命名待拍板） |
| 生命周期 | `close` `[Symbol.dispose]` | — | 句柄所有权在运行时，脚本不持有句柄；**这是所有权归属，不是能力排除** |

对应到 `OcctKernel` 侧的两个成员：`createXCAFDocument` 属 **C4**（§3.4.8，脚本面以建文档 op 形态出现，句柄由运行时持有）；`importXCAFFromSTEP` 属 **C1**（已在 `occt-kernel/occtKernel.ts` 用于实现契约，**且实现内须改走它**以保留颜色与名称，属落点 B）。

`src/io/` 容器只承载「被忽略后模型几何与身份不变」的成员面；重建必需的数据必须走声明成员。

> **待你拍板**：颜色/名称/子形状三项落「新增 op」还是落「`src/io/` 声明成员」，以及建文档 op 与 `exportGLTF` 的命名。**两者都是接入，不存在「不做」这个选项。**

### 5.4 law / sweep 族

~~`buildExtrusionLaw` + `trimLaw` + `sweepWithLaw` 是一组：law 是「长度随参数的函数」，`buildExtrusionLaw(profile, length, endFactor)` 构造它，`sweepFull` 的 `options` 也接受 law。三者的 op 必须**同批落地**，否则 law 构造出来了却没有消费者。这一族同时修掉 twist 类特征的根因（F17）。~~

**校正（2026-10-07 接手）**：上述三个 law 构造原生在 occt-wasm 5.6.0 的 wasm 中**未导出**（见 §3.4.3 校正注），调用即抛 `is not a function`，且 npm latest 即 5.6.0 无更新版。故「三者的 op 必须同批落地」不成立——它们本就无法落地。`sweepFull` 的 `options` 已内建 `Law_Linear` / `Law_Constant`（`law` / `lawLength` / `lawEndFactor`），twist 类特征的正确实现面就是 `sweepFull`，**不依赖** `buildExtrusionLaw` / `trimLaw` / `sweepWithLaw`。`sweepWithLaw` 的「law 驱动扫掠」能力已含于 `sweepFull`，归入 C3。

---

## 6. 实现面接入（C5）

对 §3.5 的 10 项，接入规矩：

1. 由 op 实现体内的能力判定选择路径（`BrepMethodKind` / `BrepEvolutionKind` / 契约成员），**不改 op 签名、错误码、脚本面符号**。
2. brepkit 侧缺该能力时**显式回退**到现路径，回退分支必须可测。
3. 每项接入补一条回归测试，断言：occt 装配下走新路径且血缘节点的演化数据非空；brepkit 装配下走回退路径且结果与接入前一致。

---

## 7. 扫描器

### 7.1 定位

`packages/core/scripts/scan-occt-op-coverage.ts` + `package.json` 的 `scan:occt-ops`（F9）。它是**只读报告 + 穷尽性校验**工具，不是覆盖率门禁。

### 7.2 必须修正的两处口径缺陷

**缺陷 1（识别层）**：内核句柄的识别必须能穿透别名。当前实现只认「`<内核变量>.<方法>(`」，实测漏检 `occt-kernel/occt-primitives.ts:107,267,273,282,288`（F18）。

修法按本仓既定纪律：**用 TypeScript 类型检查器按符号声明位置判定**，不做正则（正则在两头都错：`.rotate(` 是 geometry2d 蓝图方法、`.tessellate(`/`.isFace(` 是 faijs 自己的 L1 同名方法；而 `kernel`/`k`/`getOcctKernel()`/`getBackends().kernel.brep` 是一批别名）。必须覆盖的形态：`const x = <handle>.<m>.bind(k)`、`(<cast>).<m>.call(k, ...)`、解构赋值。

**缺陷 2（op 全集）**：`opDirect` 不得只遍历 arg-spec `scriptFace:true` 条目（F19）。脚本面全集 = **原生 op 95（F4）∪ arg-spec `scriptFace:true` 48（F5）∪ 手写平台 op**，三者互不为超集（F6）。已算出但被丢弃的 `fileCalls`（`:319-323`）必须接入：对原生 op 用 symbol-table 名 ↔ `api/**` 实现文件的 `defineOp({ name })` 对齐做函数级定位。

**修完的判据**：修正后的扫描器必须复现 §3 的六类计数（102/10/3/64/10/22）与全部方法归属；若 §3.4.6 的 `surfaceCurvature` 经核实已由 `inspectCurvature` 覆盖，则计数变为 102/10/4/63/10/22（和仍为 211），并把该行改为 C3。

### 7.3 输出

```bash
npm run scan:occt-ops                                   # stdout 报告 + 落 JSON
npm run scan:occt-ops -- --md docs/occt-op-coverage.md  # 可选：落成 md
```

JSON 落 `packages/core/src/api/surface/occt-op-coverage.json`，字段：`upstreamVersion` / `generatedAt` / `kernelMethodCount` / 六类清单与计数 / 契约映射 / L3 违规 op 清单。

### 7.4 只做穷尽性校验，不做覆盖率门禁

**不提供**「新增方法未 op 化就失败」的棘轮基线。理由：

1. **判据不成立**：门禁能判的只有「数量变了」，判不了「该不该接」。C6 的 22 项本来就不该成 op，用门禁逼平等于强制为每个新增方法造 op。
2. **逼平的必然结局是门禁被关掉**：要么补一堆无意义 op 污染脚本面，要么进 allowlist 永久豁免——制造「已被管控」的假象，比没有门禁更糟。
3. **取舍只能人做**：「有没有独立建模语义、脚本作者会不会想单独写这一行」是设计判断，不可枚举。

**唯一提供的校验是 §3.7 的穷尽性断言**（六类和 = 211、互斥、并集等于上游全集）。它判的是划分完备性，任何一类漏判都会红，不涉及「该不该接」。

### 7.5 四个实现陷阱（踩过，改回去就会误报）

1. **不能把 `kernel` 当默认内核变量名**。本仓大量 `const kernel = getBrepApi()`（L1 契约句柄），例如 `api/brep-operations/patternFns.ts:55,88,123,168`。把它的方法调用算作 occt 直调，会把中立 op 全误判成平台 op。
2. **必须按 `#导出名` 切函数区间**，不能按文件整体统计。`api/brep-operations/topologyFns.ts` 一个文件里挤了 5 个 op，按文件统计会串味。
3. **闭包必须排除 `occt-kernel/` 与 `brep/engine/`**（算进 op 链路会让覆盖率虚高到失真）；但 **L1 的采集面必须包含 `occt-kernel/` 全目录**——它是契约的 occt 实现层，真实调用散在 `hullOps.ts` / `topologyExt.ts` / `highLevelApi.ts` 等同目录文件里，按成员行区间切会漏掉绝大多数。
4. **op 链路入口必须包含原生 op 与手写平台 op**（见 §7.2 缺陷 2），否则 `sweep` / `loft` / `thicken` / `extrude` / `revolve` 这类"arg-spec 条目无 `scriptFace`、由手写 op 覆盖"的能力全部落入「不可达」（F20）。

---

## 8. 分阶段实施

| 阶段 | 内容 | 前置 | 产出 |
|---|---|---|---|
| **S1 修扫描器 + 冻结基线** | 按 §7.2 修两处口径缺陷（类型检查器识别 + op 全集），重跑并核对必须复现 §3 的六类计数 | 无 | 可信的 `occt-op-coverage.json` + 别名/op 全集的回归测试 |
| **S2 声明对齐** | L3 违规清零：`healSolid` 涉及的 op 逐个判定——能改走 L1 的改走 L1，不能的补 `engines: ['occt']`（两处声明一致） | S1（否则报告里 L3 段不可信） | L3 = 0 |
| **S3 P0 op** | `sweep` 族（`sweepFull`/`sweepAdvanced`/`sweepOriented`/`sweepWithLaw` + `extrusionLaw`/`trimLaw`）、`offset2d`、`solidFromFaces`、`surface`、`halfSpace`、`helix` 加 `handed`、`exportStl`、`exportBrep` | S2 | 解锁 twist / offset / heightmap / 半空间切割 / STL 导出 |
| **S4 构造与查询族** | 曲线族（11）、曲面面族（6，除 `surface`）、实体偏置族（`pipe`/`draftPrism`）、测量查询族（21）、视图族（6） | S3 | 构造面与测量面补齐 |
| **S5 实现面接入 + XCAF** | C5 的 10 项实现面接入；XCAF 16 项按 §5.3 逐条落点接入（建文档/读文档/装配/颜色/名称/标签树查询/STEP 与 glTF 导出） | S4 | 血缘精度提升；颜色/名称/装配保真 |
| **S6 STEP 全字段（occt-wasm 侧）** | 见 §11.6 的 K1/K2/K3 三批（K1 现存读写保真缺口，K2 规范扩展，K3 上游能力缺口） | K1 无前置；K2 依赖 K1；K3 依赖 occt-wasm 上游发版（不阻塞 K1/K2） | STEP 规范项逐条闭环，§11.3/§11.4 每条皆有归属 |

**S1 必须先做**：现有数字因识别层与 op 全集两处缺陷而不可信（F19/F20），在此之上排期会把工作量算错。

**S1/S2 状态**：S1 完成，扫描器改用 TS-AST 识别（`occt-scan/recognize.ts`）+ 全量 op 采集，并把归属从「文件级」精确到「函数区间 + 同文件顶层 helper 的传递闭包」。修复后六类 = C1 102 / C2 10 / L3 0 / C3 4 / C4 63 / C5 10 / C6 22（和 211，穷尽且互斥），复现 §3 处置分支。**S2 的 `healSolid → healFace/healWire` 实为 §7.5 陷阱 2 的归属伪阳性**：`healSolidBrep` 走 L1 契约（引擎中立，无需 `engines` 声明），occt 的 `healFace`/`healWire` 由已声明 `engines:['occt']` 的 `heal` op 触达（C2），`getShapeType` 是契约成员（C1）。因此 **L3 = 0 由扫描器修正达成**，`healSolid` 不做任何声明改动（保持双引擎中立，不破坏 brepkit parity）。回归测试 `test/occt-scan/coverage-baseline.test.ts` 锁定该基线不变量。

---

## 9. 验收

### 9.1 穷尽性与口径

1. `npm run scan:occt-ops` 输出六类清单，**和 = 211**，六类互斥，并集等于 `OcctKernel` 成员全集（§3.7）。
2. 别名形态回归测试存在且通过：`occt-kernel/occt-primitives.ts` 的 `nativeLinearPattern` 与 `(k as …).circularPattern.call(k, …)` 两个用例必须被判为 C1，不得落入 L4。
3. op 全集回归测试存在且通过：`sweep` / `loft` / `thicken` / `extrude` / `revolve` 的直调能力必须被计入 C2，不得落入 L4。

### 9.2 声明一致性

4. `grep -rl getOcctKernel packages/*/src` 涉及的每个 op，要么不再直调 occt，要么在 arg-spec 与 `defineOp` 两处都有 `engines: ['occt']`。
5. 扫描器交叉比对两处声明，不一致即报错（含 `l3Ops` 段为空）。

### 9.3 每个新增 op（C4 的 64 项）

6. 一条 `.fai.js` 脚本用例，走通 `check()` → `run()` → `exportStep()`，且 STEP 可被 OCCT 重新读入验证（精确 BREP，非 mesh 回填）。
7. 平台 op：在 brepkit 装配下断言**执行前被静态拒绝**（证明 `engines` 声明生效，可切换性未被破坏）。
8. 中立 op：在 brepkit 装配下断言**能执行**（不得挂 `engines` 冒充）。
9. 参与 `npx tsx scripts/check-api-test-coverage.ts --package=packages/core`（L1 导出覆盖 + L2 参数覆盖）。

### 9.4 实现面接入（C5 的 10 项）

10. 每项接入补回归测试：occt 装配走新路径且演化数据非空；brepkit 装配走显式回退路径且结果与接入前一致。
11. op 的外部签名、错误码、脚本面符号未变（`symbol-table.generated.ts` 与 `script-face-manifest.ts` 的 diff 中，除本方案新增项外零变化）。

### 9.5 引擎降级路径

12. 任一平台 op 在 brepkit 补齐对应能力后，按「删 `engines` 两处声明 → 改走 L1/契约 → 补一条 brepkit 可执行回归测试 → 重跑扫描器，该方法从 C2 转入 C1」降级；契约新增成员必须 occt 与 brepkit **同时**落地。

---

## 10. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 契约膨胀 | 把 occt 独有能力塞进 `BrepEngineApi` 冒充「中立」，brepkit 侧空实现造假 | 扩契约必须两侧同时落地（§9.5）；扫描器报「契约成员在 brepkit adapter 中无实现」 |
| op 面污染 | 为凑数量把 C6 的批量/胶水方法也做成 op | §3.6 是硬边界；C4 每项必须写清「脚本作者为什么需要这一行」 |
| 双轨 op | 新增 op 与既有 op 语义重叠（§4.5 表） | §4.5 去重表是新增前必读项；评审时逐条核对 |
| 声明与实现脱节 | arg-spec 写了 `engines` 但 `defineOp` 没写（或反之） | 扫描器交叉比对，不一致即报错（§9.2） |
| `naming` 选错 | 血缘追踪失真（尤其 `subdivide` vs `kernel` 的取舍） | 新增 op 必须给 `naming` 理由；`unmodeled` 需测试列出 |
| C5 静默回退 | brepkit 缺能力时静默走旧路径，血缘精度差异无告警 | §6 纪律 2：回退分支必须显式且可测 |
| 扫描器再度退化为正则 | 别名/`.call()` 形态重现漏检 | §7.2 定为类型检查器口径 + §9.1 的两组回归测试 |
| §11 覆盖矩阵退化为现状抄写 | 「规范有什么」被写成「现在能读什么」，缺项被隐形 | §11.1 判据：字段清单以 **STEP 规范文本**为准逐项列举，禁止用现实现有读点反向定义；§11.7 断「每条有归属」 |

---

## 11. STEP 能力全字段覆盖（occt-wasm 侧）

STEP 是 occt-wasm 的能力：读走 `XCAFDocument.fromSTEP` / `importXCAFFromSTEP`，写走 `XCAFDocument.exportSTEP`。所以「全部特性、全部字段」这条要求在本方案内成立，且**只针对 STEP**。3MF 不是 occt-wasm 的能力，由 faijs 自持的 mesh 层承担，不在本方案。

### 11.1 判据

| 项 | 定义 |
|---|---|
| 「支持」 | 三向可验证：**读**（外部文件 → faijs 数据）、**写**（faijs 数据 → 外部文件）、**往返**（读 → 写 → 读，字段不丢）。只读不写、或写后丢字段，都**不算**支持 |
| 「全部字段」 | 清单以 **STEP 规范**（ISO 10303-21 / AP203 / AP214 / AP242）逐项列举为准，**不得以现实现有读点反向定义**——那样等于用现状证明现状 |
| 排除 | 只允许**逐条**给理由，**禁止整族排除**（同 §0.1 R1 纪律）。排除项必须留在表内，不得留白 |
| 落点 | 每条必须落到 **R**（读取侧）/ **W**（写出侧）/ **U**（上游 occt-wasm 能力补齐）三者之一 |

### 11.2 事实基线（全部实测）

| # | 事实 | 证据 |
|---|---|---|
| G1 | STEP 读 = occt-wasm XCAF + P21 文本兜底 | `occt-kernel/occtKernel.ts:308`（`importAssemblyFromStep`）、`api/import-step.ts:91-97`、`step/stepMetaParser.ts` |
| G2 | STEP 写 = occt-wasm XCAF + P21 header/单位文本改写 | `brep/export/step.ts:125,130`、`brep/export/export-model.ts:89-147,170-215` |
| G3 | occt-wasm **无 IGES**（TKDEIGES 未链接） | `occt-wasm/README.md:473` |
| G4 | **`cad.load` 的 STEP 多零件已是全量返回**（不是降级）：走 `loadBrepAssembly`，多零件返回 compound + `ImportModel.parts`/`assembly` | `faijs-extra/src/ops/load.ts:128,134,152-157`；`core/src/brep/brep-ops.ts:1005` |
| G5 | **`cad.import_step` 仍是首件收敛，且是静默的**：走 `loadBrep`，多 solid 时取 `solids[0]` 并只回传 `multiSolidCount`——该返回值在调用点**未被消费**（`importStepImpl` 只解构 `solid`/`shape`），也没有任何 `setPendingMultiPartCount` 生产调用点，即**不警告、不报错、丢零件** | `core/src/api/import-step.ts:84`；`core/src/brep/brep-ops.ts:931-948`；`runtime-state.ts:591`（无生产调用） |
| G6 | STEP 写侧不写装配：`doc.addShape(sub, { name, color })` 无 `assembly:true`、无 `addChild` | `core/src/brep/export/step.ts:125`（该文件 100-127 行整段） |

### 11.3 读侧矩阵

| 规范项 | 现状 | 证据 | 落点 |
|---|---|---|---|
| label name（→ PRODUCT.name） | ✅ | `occt-kernel/occtKernel.ts` `walkLabel` | — |
| label color + `STYLED_ITEM` 兜底 | ✅ | `occt-kernel/stepColorParser.ts`（`getSolidColorsOrdered`） | — |
| 装配层级（isAssembly / children） | ✅ | `occtKernel.ts:308` | — |
| 组件位姿 | ✅ 经 `getLabelInfo().shapeHandle` 烘焙进几何（OCCT `GetShape` 语义）；XCAF `getLocation` 本身**无消费点** | `occt-kernel/occtKernel.ts` `walkLabel`（leaf 注释） | — |
| 子形状 label（面/边独立名称与颜色，`xcafGetSubShapeLabels`） | ✗ `XCAFDocument.getSubShapes` 在 faijs **零消费点**；`walkLabel` 只取 `getLabelInfo` | `occtKernel.ts` `walkLabel`；`grep "doc.getSubShapes"` 无命中 | R |
| header `FILE_NAME` / `FILE_DESCRIPTION` | ✅ | `step/stepMetaParser.ts:106` | — |
| `PRODUCT.description` | ✅（P21 文本） | `stepMetaParser.ts:162` | — |
| UDA（`GENERAL_PROPERTY` + `PROPERTY_DEFINITION`） | ✅（P21 文本，product 级） | `stepMetaParser.ts:179-180` | — |
| 单位（`SI_UNIT` / `CONVERSION_BASED_UNIT`） | ✅ | `mesh/io.ts:114` `detectStepUnit` | — |
| `PRODUCT_IDENTIFICATION` → partNumber | ✗ **上游缺** | `xcaf-document.d.ts` `LabelInfo` 无该字段 | U |
| `PRODUCT_DEFINITION_FORMATION.description` / `PRODUCT_DEFINITION.description` | ✗ | 无读取点 | R |
| LAYER / 图层 | ✗ | 无读取点 | R |
| AP242 语义 PMI（尺寸/形位公差/标注） | ✗ | 无读取点 | R |
| AP242 几何验证属性（validation properties） | ✗ | 无读取点 | R |
| 材料（密度/牌号） | ✗ | 无读取点 | R |
| 坐标系 / 基准（datum） | ✗ | 无读取点 | R |
| 装配实例名（NAUO） | ✗ | 无读取点 | R |
| `cad.import_step` 通路 | ✗ 走 `loadBrep`（**静默首 solid 收敛**：`multiSolidCount` 未被消费，无警告）→ 拿不到颜色/名称/装配 | `api/import-step.ts:84-86`；`brep/brep-ops.ts:931-948` | R |
| `cad.load` 通路（对照） | ✅ 走 `loadBrepAssembly` → 全部叶零件（DFS 序）+ 装配树 + 颜色/名称 | `faijs-extra/src/ops/load.ts:128,141-157`；`brep/brep-ops.ts:1005-1043` | — |
| `cad.load` 的 BREP 路径不写 `Shape.meta` | ✗ name/color 只进 `ImportModel.parts`，`fromBrep` 未带 meta——零件级元数据在同一导入链上有两种承载 | `faijs-extra/src/ops/load.ts:141-157` | R |

### 11.4 写侧矩阵

| 规范项 | 现状 | 证据 | 落点 |
|---|---|---|---|
| PRODUCT name（每实体独立 label） | ✅ | `brep/export/step.ts:115-125` | — |
| 颜色（sRGB → linear → `COLOUR_RGB`） | ✅ | `step.ts:45-47,118-125` | — |
| header 元数据（title/author/org/application/description/时间） | ✅ | `export-model.ts:170-215` | — |
| 单位声明与坐标同源 | ✅（`SI_UNIT` 改写 / `CONVERSION_BASED_UNIT` 注入） | `export-model.ts:89-147` | — |
| **装配结构**（层级/组件/位姿） | ✗ `addShape` 不带 `assembly:true`，也不用 `addChild` → 导入的装配往返后**层级全丢** | `step.ts:125` | W |
| `PRODUCT.description` | ✗ 上游缺 | `AddShapeOptions` 只有 `{name?,color?}` | U |
| `PRODUCT_IDENTIFICATION`（partNumber） | ✗ 上游缺 | 同上 | U |
| UDA 写出 | ✗ | 无写出点 | W |
| 面级颜色/名称（`addSubShape`） | ✗ 写侧未用 | `step.ts` 无 `addSubShape` 调用 | W |
| LAYER / PMI / 公差 / 验证属性 / 材料 / 坐标系 | ✗ | 无写出点 | W（逐条落 K2-2，写侧不支持的给理由） |

### 11.5 上游（occt-wasm）缺口

| 缺口 | 事实 | 处置 |
|---|---|---|
| XCAF 部件级 `description` / `partNumber` | `dist/xcaf-document.d.ts` 的 `AddShapeOptions` 只有 `{ name?, color? }`；`LabelInfo` 无这两个字段 | **U**：上游能力缺口，本方案列为 K3 批，**不阻塞 K1/K2** |
| IGES | 上游 README 明确 TKDEIGES 未链接 | **不在本方案范围**；faijs 白名单不含、维持报错。须在 §11.3/§11.4 之外单列「已知不做」一行（§11.7） |

### 11.6 排期（并入 §8，阶段 S6）

**K1 — 现存读写保真缺口（无前置，立即可做）**

| # | 工作项 | 落点 | 验收 |
|---|---|---|---|
| K1-1 | STEP 写：装配结构（`assembly:true` + `addChild`），与读侧成对 | W | 装配 STEP 往返后层级与叶子数一致 |
| K1-2 | STEP 读：`cad.import_step` 改走装配导入路径，消除**静默首件收敛**（与 `cad.load` 同口径：名称/颜色/装配） | R | 缺陷测试（两值并钉）：同一多零件 STEP 经 `cad.import_step` **当前只返回 1 个零件**（当前错误值），改后零件数与装配树同 `cad.load`（应有正确值）；测试落在 `core/test/api/import-step.test.ts`（该文件现**无多零件断言**） |
| K1-3 | 零件级 `ShapeMeta` 统一承载：STEP 路径补写 `Shape.meta`（name/color/description/partNumber），与 `ImportModel.parts` 双通道一致；两条导入路径同口径 | R | 字段级断言：同一文件经 `cad.load` 与 `cad.import_step` 得到同一 `ShapeMeta` |

**K2 — 规范扩展（依赖 K1）**

| # | 工作项 | 落点 |
|---|---|---|
| K2-1 | STEP：LAYER、UDA 写出、面级颜色/名称（`addSubShape`） | R+W |
| K2-2 | STEP：AP242 验证属性 / PMI / 公差 / 材料 / 坐标系（按「规范里有位置即支持」逐条） | R（写侧逐条给理由） |

**K3 — 上游能力（依赖 occt-wasm 发版）**

| # | 工作项 | 落点 |
|---|---|---|
| K3-1 | occt-wasm XCAF 补 `description` / `partNumber` 读写（现 `AddShapeOptions` 只有 `{ name?, color? }`，`LabelInfo` 无此二字段，见 `dist/xcaf-document.d.ts`），faijs 侧接线 | U |
| K3-2 | 上游发版后：`step.ts` 写 description/partNumber；`walkLabel` 读回填入 `Shape.meta` | U |

### 11.7 验收

1. **穷尽性**：§11.3 / §11.4 的每一条必须有状态（✅/◐/✗）与落点（R/W/U/—）；✗ 项必须有工作项编号；任何一条**不得留白**。
2. **排除项**：IGES 等「已知不做」必须在表内逐条写出理由，禁用「本期不做」整族搁置（同 §0.1 R1 纪律）。
3. **往返测试**：每个字段构造 fixture → 读 → 写 → 读，断言字段值一致；缺一条即红。测试落在 `packages/core/test/`（与 src 分离约定）。
4. **两条导入路径一致性**（K1-2/K1-3）：同一 STEP 文件经 `cad.load` 与 `cad.import_step` 得到一致的 `ShapeMeta`、装配树与颜色。
5. **不回归**（G4/G5）：`cad.load` 的多零件既有断言（`core/test/brep/load-brep-assembly.test.ts`）保持全绿；`cad.import_step` 的静默首件收敛改由 K1-2 的两值缺陷测试覆盖，修复后断言翻转。
