# FreeCAD-library 全量 FCStd → .fai.zip 批量转换方案

> 日期：2026-09-19（2026-09-20 更新：回填实测进展，删除已被实测推翻的论断）
> 状态：**方案 + 部分落地**。B0（CLI / H1 / H2 部分 / H3 部分）、B1（全库画像）、H4 / H5 / H8 已落地；H6 常量路径已接线、非常量仍 bake；**H10 已接线（2026-09-20，含 App::Point/App::Annotation 口径修复）；H7 未动**。
> 前置文档：`docs/analysis/2026-09-15-fcstd-to-fai-zip-feasibility.md`（可行性）、`docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md`（一阶段 M0–M6）、`docs/plans/2026-09-17-fcstd-port-phase2-plan.md`（二阶段 M7–M13，已被本方案吸收）
> 归属：库/语料分析代码在 `D:/Faicad/fcstd-port`；本仓库只保留通用 FCStd→`.fai.zip` 能力（2026-09-20 起语料依赖测试也已迁至 fcstd-port `test/FreeCAD/`，见 §5.4）

---

## 1. 用户原始要求（原文引用）

> 请写一份方案，我需要把../FreeCAD-library里的所有fcstd文件转换为.fai.zip文件. 因为要转换的文件很多，我需要把这个任务放到一个独立的新的git项目里。而不是放在本项目里。当然，如果转换需要的功能faijs项目没有，则需要先补齐本项目的能力。

> 容器天生带「翻译不了 → 烘焙 assets/*.brp + 记 reason」的回退通道? 这是第一阶段的做法，现在的要求是除非是fcstd里的python脚本，其他都需要支持，不允许回退，要啃硬骨头。你的方案里要把现在明确不支持的作为优先解决的问题。

packages/core/scripts/scan-fcstd-library.ts这样的文件明显是错误的。
本项目只应该有通用的fcstd转.fai.zip的功能代码。绝对不允许有分析FreeCAD-library的代码。
分析FreeCAD-library的代码应该写在D:\Faicad\fcstd-port.

开发之前,必须读D:\Faicad\fcstd-port项目的代码. 

还有一点要求, 未来如果测试的文档在fcstd-port项目, 那么测试的代码就写在fcstd-port项目.
两个项目联合调试.


拆解为约束：

| 编号 | 约束 |
|---|---|
| C1 | 转换对象：`../FreeCAD-library`（`D:/Faicad/FreeCAD-library`，**3,201** 个 FCStd） → `.fai.zip` |
| C2 | 批量任务放在独立的新 git 项目（= `D:/Faicad/fcstd-port`，Q2 已拍板），不进 faijs 仓库 |
| C3 | 转换需要而 faijs 缺失的能力，先补齐 faijs |
| **C4** | **除 `PropertyPythonObject`（Python 脚本特征）外，一切对象都必须翻译，不允许烘焙回退**；现在明确不支持的，就是优先要解决的问题 |

---

## 2. 约束变更的影响：从「覆盖率问题」变成「完备性问题」

第一阶段的容器设计（可行性分析 §7 R7）是「白名单翻译 + 兜底烘焙」，覆盖率的分母可以绕开难啃的对象。**C4 把这个逃生口焊死了**：

- `mapping.json` 的 disposition 收敛为**三态**：`translated` / `python-baked`（仅 Python 脚本特征）/ `preserved-only`（结构性对象 + 影子成员，本就不需要翻译，不算缺口）。
- 凡出现第三种情况——该翻译却翻译不了的对象——**该文件的转换判 FAIL**，不产出 `.fai.zip`。

> **实现口径（2026-09-20 定版，`convert.ts:73-104`）**：`preserved-only` 覆盖两类——① 结构性/基准/容器类型（`STRUCTURAL_TYPES`：`PartDesign::Body`、`App::Origin/Plane/Line`、`App::Part`、`App::DocumentObjectGroup`、`PartDesign::Plane/Line/CoordinateSystem`；它们没有特征语义，其语义由翻译器消费而非产出 cad 调用）；② 影子成员（GuiDocument、缩略图等）。其余任何 `baked` 处置都进 `gaps[]`。
> **实测基线（PadTest）**：`preserved-only` = 7（原 3 是旧的「结构对象算缺口」口径，已随审计口径修正）。

由此，方案的重心从「批量编排」彻底转移到「**翻译完备性**」：下面 §3 的硬骨头清单是全方案的优先级核心，批量项目（§6）只是跑完这批硬骨头之后的执行器。

**如实声明**：这是一份难度显著上调的承诺。「不允许回退」意味着 faijs 必须吃下 FreeCAD 非白名单特征、全部约束类型、表达式引擎语义、坐标系/附着体系、跨文档引用。§3 每一项都给出处置方案与**实测**进展，不写假时间表。

---

## 3. 硬骨头清单（含实测现状）

### 3.1 现状快照（2026-09-20 实测）

| 编号 | 硬骨头 | 状态 | 关键证据 |
|---|---|---|---|
| — | 转换 CLI + 公开面 | ✅ 落地 | `@faicad/faijs/fcstd-convert` + `bin: faijs-fcstd-convert`；快照 12 子路径 |
| **H1** | codegen 产出非法 JS | ✅ **已修复** | `codegen.ts:520-535`；56 样本 17 个产物逐个 `cliCheck` → **失败 0** |
| **H2** | 草图约束类型覆盖 | 🟡 **98.38%**，缺 3 类 | 已支持 `{1–14, 18}`（`sketch-solver.ts:63-78`）；缺 15 / 17 / 19 共 2,599 条（1.62%） |
| **H3** | 坐标系/Placement/附着 | 🟡 **一半** | `placement.ts`（149 行）已落地；`MapMode`/`Support`/`AttachmentOffset` **零实现** |
| **H4** | Pad/Pocket 类型枚举 | 🟡 主干已实现，尾部分支仍 bake | `feature-translate.ts:442-595` |
| **H5** | Body 语义与多 Body 拆分 | ✅ 落地 | `codegen.ts:76-83`（`Model` 优先、回退 `Group`）+ `:124-136` + `:435` |
| **H6** | 表达式引擎 | 🟡 常量已接线，非常量仍 bake | `feature-translate.ts:107-118` / `:144-147`；剩 16,277 条非常量 |
| **H7** | 白名单外特征类型 | ❌ 未动 | 白名单 14 类；全库缺口 **4,256 对象 / 41 类型（9.2%）** |
| **H8** | 外部几何投影 | ✅ 已接线 | `convert.ts:159-175`；失败 → 显式 gap `external-geometry-unresolved` |
| **H9** | XLink 跨文档引用 | ✅ 已定论（0 个） | 画像：`<XLink>` 1,159 个 / 15 文件，`file` 全空 |
| **H10** | Python 特征 → `python-baked` | ✅ 已接线（2026-09-20） | 产生端 `feature-translate.ts` `isPythonOpaque()`：按**属性存在**判定（`Python`/`Proxy` 属性名或 `App::PropertyPythonObject` 属性类型），非类型名后缀；产出 `python-opaque` → `auditMapping` 改名 `python-baked`（消费端原已存在）。`App::Point`/`App::Annotation` 已入 `STRUCTURAL_TYPES`。测试：`feature-translate.test.ts` H10 组（含 V-C6 防搭车、后缀非充分条件 GOTCHA）+ `convert.test.ts` 正向锁定（gaps 中不再出现 `*Python` 类型） |

**⚠️ H10 的更正（重要，此前记录有误导；✅ 已于 2026-09-20 接线，以下为历史诊断保留）**：`python-baked` / `python-opaque` **在管线里没有产生者**。全仓只有 `convert.ts:95-97` 的**改名消费**（`python-opaque` → `python-baked`）和若干注释；`feature-translate.ts:347` 对一切未知类型（**包括** `Part::FeaturePython` 这类 Python 对象）统一返回 `baked` + `type-not-whitelisted`。因此 **Python 特征当前 100% 被判为翻译缺口**，C4 允许的例外尚未接线。`convert.test.ts:42` 的断言 `reason !== 'python-opaque'` 目前是**空真**（永远不会命中）。
**接线时的判定依据必须是「属性存在」而不是「类型名后缀」**：C4 的例外是 `PropertyPythonObject` **属性**（以及 `Python`/`Proxy`/`ProxyPython`），对象类型名里带 `Python` 只是常见伴随特征。画像的 `pythonObjects: 4,514 / 647 文件` 即按属性口径统计（`definitions.pythonObjects` 已写明）。

### 3.2 56 样本实测失败分布（`D:/Faicad/FreeCAD` 源码树，ok=9 / gap=47）

口径：`out/sweep-report.json`（`fcstd-port/out/`，gitignore，重跑即得）。**注意：每文件只记录前 4 条 gap reason**，故下表「次数」是下界。

| gap reason | 次数 | 涉及文件 | 归属 |
|---|---|---|---|
| `type-not-whitelisted` | 117 | 43 | **H7 + H10** |
| `sketch-not-solved` | 14 | 12 | H2 / H3 / 几何种类（见下） |
| `revolution-missing-profile` | 10 | 10 | H7（依赖链） |
| `pocket-missing-dependency` | 7 | 4 | H7（依赖链） |
| `cut-missing-dependency` | 4 | 1 | H7（依赖链） |
| `external-geometry-unresolved` | 1 | 1 | H8 |
| `unsupported-constraint` | 1 | 1 | H2 |
| `delta-exceeds-t1` | 1 | 1 | H2 ② |
| 其余 3 条各 1 | 3 | 3 | H7 |

**首因分布**（每文件只算第一条因）：`type-not-whitelisted` 30、`sketch-not-solved` 11、`pocket-missing-dependency` 2，其余 4 类各 1。

56 样本里 `type-not-whitelisted` 的**类型**头部：`App::FeaturePython` 20、`Part::Feature` 17、`App::Point` 15、`Part::FeaturePython` 14、`Path::FeaturePython` 9、`Part::Part2DObjectPython` 6、`Fem::*Python` 9、`App::MaterialObjectPython` 4、`Part::Mirroring` 3。**结论：H10（Python 例外）接线的收益远大于 H2**——这些样本里 Python 对象是类型缺口的第一大宗，而 `unsupported-constraint` 只命中 1 个文件。

**另一个被忽略的草图阻碍**：`sketch-not-solved`（12 文件）的成因不是约束类型，而是**几何种类**。全库实测（`out/geom-kinds.json`）：

| 几何种类 | 条目 | 文件 | `parseGeometryList` 处置 |
|---|---|---|---|
| `Part::GeomLineSegment` | 46,080 | 2,472 | 已支持 |
| `Part::GeomArcOfCircle` | 8,573 | 1,851 | 已支持 |
| `Part::GeomCircle` | 6,075 | 1,514 | 已支持 |
| **`Part::GeomBSplineCurve`** | **1,630** | **24** | ❌ **降级为 NaN → L2** |
| `Part::GeomPoint` | 1,188 | 102 | 已支持 |
| **`Part::GeomArcOfEllipse`** | **8** | **5** | ❌ **降级为 NaN → L2** |
| `Part::GeomEllipse` | 4 | 3 | 已支持 |

> 口径：全文档 `<Geometry type="Part::Geom*">` 条目 = 63,558 / 3,201 文件；画像的 `geometry: 61,445` 只统计 `Sketcher::SketchObject`，差额 2,113 落在 `Part::Part2DObjectPython` 等 2D 容器里，两者不矛盾。
> **`sketch-parse.ts:239-241` 的注释「sample set: 0 occurrences」已被全库数据推翻**（B 样条 1,630 条 / 24 文件）。该分支目前静默降级（NaN 点 → L2），不是显式 gap。
> TODO：把几何种类统计折进 `fcstd-port/lib/profile.mjs`（一次遍历即可），让这个数字成为可复现的画像产物，而不是一次性探针。

### 3.3 P0 — 不修好连一个文件都出不来

| 编号 | 硬骨头 | 现状（证据） | 处置方案 |
|---|---|---|---|
| **H1** | ~~codegen 产出非法 JS~~ | ✅ **已修复（M7.1）**：`renderArgs` 过滤空元素 + 无位置参数时不加前导逗号（`codegen.ts:520-535`）。实测：56 样本 9 个 ok，其 17 个 `model/*.fai.js` 逐个 `cliCheck` → **失败 0**；生成物全文搜 `(,` / `, )` → 0 命中 | 已完成。护栏 = `packages/tests/faijs/fcstd/fcstd-e2e.test.ts`（PadTest 产物 `cliCheck`）+ `codegen.ts` 的 `renderArgs` 单测 |
| **H2** | **草图约束类型覆盖 98.38%** | 已支持集 = `{1–14, 18}`（`sketch-solver.ts:63-78`，含 **18=Diameter**）。**未支持仅 3 类**：`15=InternalAlignment` 2,067 条（1.29%）/ `17=Block` 355（0.22%）/ `19=Weight` 177（0.11%），合计 **2,599 条 = 1.62%**。56 样本仅 1 文件命中 `unsupported-constraint`；另有 1 文件 `delta-exceeds-t1`（L1，超容差） | ① 补齐 15/17/19 的映射层（planegcs 是 FreeCAD 同源求解器，本身支持这三类；缺的只是 TS 侧登记）——**但按 §3.2 的数据，这项工作几乎不会让 ok 数上升**，应按 §10 的排序降到 H7/H10 之后；② `delta-exceeds-t1` 的 L1 成因逐个定位，禁止用「初始值兜底」糊弄 |
| **H3** | **坐标系/Placement/附着：附着体系仍缺失** | ✅ 已落地：`placement.ts`（149 行）= Placement 解析（`placementOf`/`placementOfProp`）、四元数→矩阵、`applyPlacement`/`invertApplyPlacement`、`quatToEulerXYZDeg`、`planeBasis`、`isIdentityPlacement`，并有 `placement-corpus.test.ts`；`codegen.ts`/`convert.ts`/`feature-translate.ts` 均已消费。`parseGeometryList` **已读 Z**（`sketch-parse.ts:188-189, 197, 205, 211-213, 218, 231`）。<br>❌ **未实现**：`MapMode` / `Support` / `AttachmentOffset` —— 全仓仅 1 处注释命中、**零实现**。草图附着到另一实体的面（非 XY 平面）这条路是断的 | 做附着解析：`Support`（`(object, subelement)` 二元组）→ `MapMode` → `AttachmentOffset` 变换链。验收：所有 L0 草图轮廓与 FreeCAD 落盘值逐点一致；非 XY 平面、`AttachmentOffset`、`MapMode`（FlatFace/FlatFace2D 等）全覆盖测试。附着到非平面（圆柱面）按 FreeCAD 源码标定，不猜 |

### 3.4 P1 — 不修好大多数零件库文件出不来

| 编号 | 硬骨头 | 现状（证据） | 处置方案 |
|---|---|---|---|
| **H4** | Pad/Pocket 类型枚举 | 🟡 **主干已实现**（`feature-translate.ts:442-595`）：`TwoLengths`（前段 + `Length2` 反向段 + union，`:457-469`）、`UpToFace`（datum plane → 精确有向距离 → `plane` 目标；实体面 → `cad.faceRef`；`:470-571`）、`UpToLast`/`UpToFirst`（经 `BaseFeature` → `cad.extrude({upTo})`；`:573-591`）。**已无「静默按 Length 处理」**——未知类型走显式 `pad-type-<x>-unsupported` bake。<br>仍在 bake 的分支（Pad 路径的全部 bake reason，共 8 条）：`pad-missing-profile`、`pad-length-expression-non-constant`、`pad-upTo-missing-base`、`pad-type-<type>-unsupported`（现仅 `unknown` 可达）、`uptoface-solid-face-unsupported`、`uptoface-sub-unparseable`、`uptoface-datum-plane-parallel`、`uptoface-datum-plane-degenerate-distance` | ① 按样本实测逐条消掉上列 bake 分支；`ThroughAll` 仍缺（求剖面沿法向与全体实体的精确相交深度，OCCT 可算，不猜 bbox）；② **Pocket 的类型枚举表已就位但需按同样口径复测**（`Pocket: 0=Length 1=ThroughAll 2=UpToFirst 3=UpToFace 4=TwoLengths`，`feature-translate.ts:183-184`） |
| **H5** | Body 语义与多 Body 拆分 | ✅ **已实现（M10）**：迭代顺序 `Model` 优先、回退 `Group`（`codegen.ts:76-83`）；Body 内按 Group 顺序做 D-C 累加、**不用 `cad.group`**（`:124-136`、`:160-164`）；跨 Body 由 `cad.group` 聚合（`:435`）、多文件拆分 + `main.fai.js` 聚合（`:411-420`）。实测 PadTest 单 Body → `part_out` 别名，Volume 与 Tip 一致 | 已完成。剩余：多 Body 文件的抽样验真（并入 §7 V-C3） |
| **H6** | 表达式引擎 | 🟡 **常量已接线**：`propNum` 优先取 `expressionBindingOf(...).value`（常量表达式覆盖落盘 Float，`feature-translate.ts:107-118`）。<br>❌ **非常量仍 bake**：`hasNonConstantBinding` 命中即显式 bake（`pad-length-expression-non-constant` 等，`:144-147`、`:452`、`:624`）。全库仍有**非常量绑定 16,277 条（94.8%）** | 引入具名参数/常量图：`const` 声明 + 引用代入，拓扑排序处理依赖环（FreeCAD 表达式本身禁环，遇环报错不猜）。Spreadsheet `<Cells>` → JS 常量表 + 别名映射。分类口径以 `expressions.ts` 的 `evalConstantExpression` 为准（`value === undefined` 即非常量），禁止另立启发式 |

### 3.5 P2 — 白名单外的特征类型（C4 的主战场）

| 编号 | 硬骨头 | 现状（证据） | 处置方案 |
|---|---|---|---|
| **H7** | 特征白名单只有 **14 类**；全库缺口 **4,256 对象 / 41 类型（9.2%）** | 白名单（`feature-translate.ts:77-95`）：`Part::Box`/`Cylinder`/`Cut`/`MultiFuse`/`Extrusion`/`Compound`/`Sphere` + `PartDesign::Pad`/`Pocket`/`Revolution`/`LinearPattern`/`PolarPattern`/`Fillet`/`Chamfer`。**白名单 14 类与 translate 的 14 个 `case` 一一对应**（`:351-790`），故 `default` 的 `type-not-implemented: <type>`（`:843`）当前**不可达**（防御性默认）——所有类型缺口都从 `:347` 的 `type-not-whitelisted: <type>` 出。缺口头部（全库）：`Part::Feature` 1359、`PartDesign::Groove` 726、`Part::Revolution` 425、`Part::Sweep` 268、`Part::Mirroring` 253、`Part::Fillet` 196、`PartDesign::Mirrored` 166、`App::Link` 126、`Part::Chamfer` 109、`Part::Loft` 107（top-10 = 3,479，占缺口的 82%） | ① 按 §4 画像频次排定实现顺序（§10）；② `sweep`/`loft`/`helix` 在内核层缺 op 的走 `defineOp`/`compatOp` 正常补齐（给 faijs 补**通用**能力，不是转换器私货）；③ `Part::Compound`/`Part::MultiCommon` → `cad.compound`/`cad.intersect`；④ Draft 系对象 → `cad.sketch` 等价轮廓 + 特征；⑤ 每类新特征：先写失败测试再实现，逐一进白名单 |
| **H8** | 外部几何（ExternalGeometry） | ✅ **已接线**：`convert.ts:159-175` 调 `resolveExternalGeometry`，把 `.brp` 边/顶点投影成折线（`geoId` 负数）喂求解器；解析失败 → **显式 gap** `external-geometry-unresolved`（不再静默 L2）。56 样本命中 1 文件 | 扩大覆盖面：把剩余的 `ext.failures` 逐类归因（缺 op / 引用形态不支持），失败路径保持显式报错 |
| **H9** | XLink 跨文档引用 | ✅ **已定论（§4 画像）**：库内 `<XLink>` 元素 1,159 个 / 15 文件，`file` 属性**全为空 → 跨文档引用 0**。真正要处理的是**文档内链接**：`App::Link` 126 + `App::LinkElement` 19 + `App::LinkGroup` 4 = 149 个对象（`App::PropertyXLink` 且 `file=""`） | 跨文档递归转换**降级为非阻塞**（保留运行时检测：遇非空 `file` 即显式报 gap，不静默）。`App::Link*` 的文档内链接语义（形状别名 / 子形状引用 `sub="Pocket.Face5"`）并入 H7 的实现序列，**不得当 baked** |
| **H10** | **Python 特征 → `python-baked`（C4 的例外）尚未接线** | ❌ 见 §3.1 的更正：管线零产生者，Python 对象全部落 `type-not-whitelisted` gap。全库 **4,514 个 Python 对象 / 647 文件**（9.8%）；56 样本里是类型缺口第一大宗 | ① 判定依据改为**属性存在**：`PropertyPythonObject` / `Python` / `Proxy`（`profile.mjs` 的属性口径可直接复用），产出 `python-opaque` → 由 `auditMapping` 改名 `python-baked`（改名逻辑已存在，只缺产生端）；② Python 特征的**下游**（引用其形状的 Part 特征）仍须翻译：形状从 ZIP 内 `.brp` 取为 `cad.asset` 输入（数据引用，不是回退——对象本体是 Python，形状是既有事实）；③ mapping 中 Python 对象记 `python-baked`、下游记 `translated`，链路可追溯 |

> **⚠️ 同名异构陷阱（必须记住）**：`Part::Revolution`(425) / `Part::Fillet`(196) / `Part::Chamfer`(109) 与 PartDesign 系**同名但语义不同**（前者是 Part 工作台的特征，输入/属性形态不同）。白名单只收了 PartDesign 系，看起来「同类已支持」，实际这 730 个对象全漏。
> **⚠️ 分类口径待对齐**：`App::Point` / `App::Annotation` 属基准/标注类，应进 `STRUCTURAL_TYPES`（preserved-only）却不在其中（`convert.ts:76-82`），因此被算作翻译缺口。全库规模很小（`App::Point` 2、`App::Annotation` 9），但在 FreeCAD 源码树样本里是多文件的首因之一。接线 H10 时一并拍板。

### 3.6 明确不做翻译的（C4 的例外）

| 对象 | 处置 |
|---|---|
| `PropertyPythonObject`（Python 脚本特征本体） | 烘焙：形状以 `.brp` 资产进 `assets/`，mapping 记 `python-baked`，reason `python-opaque`（**产生端待实现，见 H10**） |
| 结构性/基准/容器类型（`STRUCTURAL_TYPES`）+ 影子成员（GuiDocument.xml、缩略图、材质、相机、颜色） | `preserved-only`：本就非建模对象，不算缺口 |

---

## 4. 全库画像探针（已完成并定版）

> **已完成（2026-09-20，`reports/library-profile.json/.md`，3,201 文件 / 0 失败 / 105.8 s）**。实现归属：**`D:/Faicad/fcstd-port/lib/profile.mjs`**（`npm run profile`，`--per-file` 可选）——库分析代码不属于本项目（用户铁律），本项目只保留通用转换能力；画像脚本消费 faijs 公开的读层子路径 `@faicad/faijs/fcstd`（`unpackFcstd`/`memberText`/`parseDocumentXml`/`parseSketchObject`/`parseGeometryList`/`parseConstraintList`/`parseExpressionEngine`），因此全栈只有一份 FCStd XML 实现。`.FCStd1` 备份跳过（Q1）。
>
> **过程留痕（重要）**：2026-09-19 曾在 `packages/core/scripts/` 放过两份画像脚本（`profile-fcstd-library.ts`、`scan-fcstd-library.ts`）+ 一份 785KB 产物，且两份脚本对 **XLink 与表达式口径给出不同数字**。两者均已删除，重复实现在本轮收敛为一份。数字口径写进产物的 `definitions` 字段，防再分叉。

**四张表（全部来自一次只读遍历）**：

1. **对象类型直方图**（H7 排序依据）：**91 类**。头部：Sketch 8,370 / App::Line 5,808 / App::Plane 5,808 / Pad 2,617 / Pocket 2,174 / `Part::FeaturePython` 2,101 + `App::FeaturePython` 1,459 + `Part2DObjectPython` 766 / App::Origin 1,944 / `Part::Extrusion` 1,832 / `Part::Feature` 1,359 / `App::DocumentObjectGroup` 1,350 / Body 1,262 / `Part::Cylinder` 780 / `PartDesign::Fillet` 777 / Groove 726 / MultiFuse 533 / `Part::Cut` 507 / Revolution 合计 926 / `Part::Compound` 332 / `Part::Sweep` 268 / `Part::Mirroring` 253 / `Part::Loft` 107 / `Part::MultiCommon` 50 / `Part::Helix` 46；`App::Link` 126 + `App::LinkElement` 19 + `App::LinkGroup` 4。
2. **约束类型直方图**（H2 排序依据）：**160,331 条**，XML `Type` 是**数字枚举**，共 18 档：1=49,327 / 2=17,618 / 3=16,814 / 12=13,525 / 5=12,216 / 7=11,454 / 8=11,306 / 13=11,158 / 14=5,280 / 11=4,871 / 15=2,067 / 18=1,955 / 9=903 / 6=567 / 4=471 / 17=355 / 10=267 / 19=177（数字→语义见 faijs 的 `CONSTRAINT_NAMES`）。**已支持 = 98.38%；未支持仅 15=InternalAlignment / 17=Block / 19=Weight，合计 2,599 条（1.62%）**。
3. **表达式统计**（H6）：615 文件含 ExpressionEngine（6,537 个对象携带），**绑定 17,166 条，非常量 16,277 条（94.8%）**；Spreadsheet 文件 567 个。口径 = `<Expression>` **条目数**（不是携带 engine 的对象数；前一版把空 engine 也算进去得出 38,015 / 43%，已作废）。H6 从「预计更多」坐实为高频刚需。
4. **结构统计**：Body 1,262（758 文件，98 个文件多 Body）/ 草图 8,370（2,641 文件，单文件最多 174）/ 几何 61,445 / 约束 160,331 / Python 对象 4,514（647 文件）/ **XLink：`<XLink>` 元素 1,159 个、15 文件、跨文档 0**（H9 据此降级）。几何种类另见 §3.2（待折进画像脚本）。

**本项目内不得再出现库分析代码**——faijs 侧只保留通用 FCStd→`.fai.zip` 能力。画像结果已回填 §3 与 §10。

---

## 5. faijs 侧交付（全部在本项目内做，C3）

### 5.1 内核补齐

§3 的 H1–H10 全部在 `packages/core/src/fcstd/` + `api/` 内实现。实施顺序见 §10（按实测收益排序，**不是**按编号）。每项硬骨头：

- 先写失败测试（单元 + 端到端样本），再实现——二阶段计划 §10 纪律沿用；
- 与既有 M7–M13 计划的关系：H1=M7、H3=M8、H4+H5=M9/M10、H6=M11、H7/M13.3+M13.1 = H7/H8 扩容版。**二阶段计划被本方案吸收并收紧**（其「显式烘焙 + reason」条款废止，替换为「实现它」）；
- 白名单判定规则从「白名单外即回退」改为「白名单外即 FAIL」：`feature-translate.ts:347` 的未知类型分支**不生成 baked 资产**，直接进 `gaps[]`，**禁止静默降级**。

### 5.2 公开面：读层 + 转换面均已落地

**读层 `@faicad/faijs/fcstd`（2026-09-20）**：导出 `unpackFcstd`/`memberText`/`parseDocumentXml`/`parseSketchObject`/`parseGeometryList`/`parseConstraintList`/`parseExpressionEngine`/`CONSTRAINT_NAMES` 及相关类型。实现要点：`src/fcstd/index.ts` 桶文件；`tsconfig.build.json` 解除对 `src/fcstd` 的 exclude；`scripts/api-surface-snapshot.mjs` 子路径表加入 `./fcstd`。**读层不含 solver/occt 依赖**，故可被 fcstd-port 直接消费（profile 脚本即第一个消费者）。

**转换层 `@faicad/faijs/fcstd-convert`（2026-09-20）**：导出 `convertFcstdFile`/`ConvertSummary`/`ConvertOptions`/`SKETCH_T1`/`ALLOWED_DISPOSITIONS` + `createPlanegcsSolver`/`planegcsWasmPath`/`classifySketch`/`maxPointDistance`/`resolveExternalGeometry`/`isWhitelisted`。**管线共有两份实现的历史已收敛为一份**——`scripts/fcstd-to-fai-zip.ts`（无 C4 终检、无退出码契约）与 `scripts/fcstd-convert-cli.ts` 均已删除；唯一 CLI 收进 `src/fcstd/cli.ts`，根 `scripts/` 与 `packages/core/scripts/` 下均无 `probe-*`。快照 **12 子路径**。

**依赖归属（原阻塞项已解）**：`planegcs` 是**转换能力**（L0 轮廓提取前必须先求解草图）的硬依赖，而非 faijs 运行时草图能力——`cad.sketch` 吃的是已解算的轮廓（见 `api/extrude.ts` 的输入形态），因此不需要在浏览器侧引入 solver。结论：`@salusoft89/planegcs` 由 devDependencies **提为 dependencies**（1.2.0，含 wasm 约 1 MB，无传递依赖）；`occt-wasm` 维持 peerDependency（`external-geo.ts` 用）。已在消费侧实测：fcstd-port 经 tgz 安装后 `planegcs` 随包自动落地，`faijs-fcstd-convert` 直接可跑。

| 项 | 要求 | 状态 |
|---|---|---|
| 入口 | exports 子路径 `./fcstd-convert` + `bin: faijs-fcstd-convert` → `dist/fcstd/cli.js` | ✅ |
| 契约 | `faijs-fcstd-convert <in.FCStd> [out.fai.zip]`；退出码 0=成功且 mapping 终检通过、2=含翻译缺口（产物不写出）、1=内部错误 | ✅ |
| 输出 | stdout 一行 JSON 摘要（`ok`/`counts`/`sketches`/`gaps`/`elapsedMs`）；成功路径 stderr 零输出 | ✅ |
| 隔离 | 单文件任何异常（ZIP 损坏、XML 失败、solver throw）捕获为结构化错误，绝不崩批量进程 | ✅ `convert.ts` 返回结构化 summary；「逐文件隔离 + 断点」在批量驱动（§6，待办） |
| 诊断 | `ConvertOptions.keepGappedContainer`：**仅诊断**逃生舱，`ok` 仍为 false、退出码仍为 2，只把带缺口的容器带出来供测试查资产 | ✅ |

### 5.3 版本发布

**本节已被 `docs/plans/2026-09-19-npm-publish-plan.md` 取代**（该计划 §8 明示）：原「本项目禁发 npm、只走 tgz」的交付方式作废。发布计划落地的口径是——core 升格为公开包名 `@faicad/faijs`（D2-A）、lockstep 版本、经 `scripts/publish-all.ps1` 发布；fcstd-port 发布后改为从 npm 消费 `@faicad/faijs`，版本追溯直接用 npm 版本号。

**当前过渡态**：tgz 仍是唯一可用通道（`npm install ../faijs/packages/core/faicad-faijs-<ver>.tgz`，现为 `0.13.1`；**换新 tgz 必须重装**，禁 `npm link`/junction）。fcstd-port 的 `package.json` 以 `file:` 依赖指向该 tgz。npm 首发尚未执行。

### 5.4 脚本归属：faijs 只留「能力 + 自动测试」（2026-09-20 落地）

**判定规则**：`packages/core/scripts/` 下的脚本，凡是**能在 CI 跑**的，应当落成 `*.test.ts`（自动测试代码留在 faijs）；**不能在 CI 跑**的（依赖语料在磁盘、依赖人工给输入文件），连同 FreeCAD-library 相关分析代码，全部迁出到 fcstd-port。语料画像必须只有一份实现。

**faijs 侧现状**
- 根 `scripts/`：**已无任何 `probe-*` 与 fcstd 语料脚本**；现存 27 个 `.ts` 全是仓库自身的文档/i18n/门禁工具（`doc-typecheck*`、`verify-*`、`*-pairing*`、`markdown`/`jsdoc`、`agent-note*` 等），与 FCStd 无关，不在本次归属调整范围内。
- `packages/core/scripts/`：只剩 `faijs-cli.ts`（运行时 CLI，被测试调用）+ 8 个 `gen-*.ts` 代码生成器（被 `gen:surface:check` / op 一致性门禁接线）。

**迁出清单（13 个 → `fcstd-port/tools/`，import 全部改走公开子路径）**：

| 迁出 | 说明 |
|---|---|
| `coverage-report.ts` | V5 翻译覆盖率（按对象类型 × 白名单） |
| `validate-sketch-solve.ts` | 全语料草图求解扫描 L0/L1/L2 |
| `locate-l1-sketches.ts` | L1 草图定位（含约束类型明细） |
| `calibrate-t1.ts` | T1 容差标定（delta 分布 P50/P90/P99/max） |
| `probe-m13-types.ts` / `probe-offset2d-feasibility.ts` | M13 候选类型属性形态 / Offset2D 可行性 |
| `probe-planegcs.ts` | planegcs M0 探针（**从仓库根 `scripts/` 补迁**，wasm 路径改走公开的 `planegcsWasmPath()`） |
| `probe-padtest-brp-bbox.ts` / `probe-padtest-brp-volumes.ts` | PadTest 各特征 `.brp` 真值 bbox / 体积 |
| `probe-pad002-chain.ts` / `probe-pad002-upto.ts` | Pad002 子链路 up-to 体积复现 |
| `probe-step-volume.ts` / `verify-geometry.ts` | STEP 网格体积 / V6 保真度（FCStd Tip vs 回导 STEP） |

**删除（不留重复实现）**：

| 删除 | 依据 |
|---|---|
| `scan-fcstd-samples.ts` | 与 `lib/profile.mjs` 完全重叠，且计数口径更差（读 XML `count` 属性而非解析列表） |
| `probe-upto-circle.ts` | 唯一用例（圆形草图 upTo 斜平面）已被 `src/api/extrude-upto.test.ts` 覆盖，常量逐字相同 |
| `smoke-cad-builtin.ts` | 检查项不需要语料 → 按规则转成自动测试：`src/cad-runtime/createRuntimeWithCad.test.ts`（钉 D1：`createRuntime` 默认注册含 >50 op 的 `cad` 命名空间，纯引擎保持 cad-free） |
| `fcstd-to-fai-zip.ts` + `fcstd-convert-cli.ts` | 同一条管线的两份实现，收敛为 `src/fcstd/cli.ts`（见 §5.2） |

`packages/core/package.json` 的 `fcstd:scan` / `fcstd:validate` 随脚本删除；`fcstd:convert` 改指 `tsx src/fcstd/cli.ts`。fcstd-port 侧对应 `tools/README.md`（13 个工具的用途、迁移修正、迁移后的 `npm run typecheck` 把关）。

> **归属清查的教训**：只按 `packages/core/scripts/` 列举会漏掉仓库根 `scripts/` 下的同类文件。清查时按「全仓 import 了哪个不该有的包」反查更可靠（本次即由「谁还 import `@salusoft89/planegcs`」发现漏网的 `probe-planegcs.ts`）。

---

## 6. 批量项目（= `D:/Faicad/fcstd-port`，Q2 已拍板）

C4 之后批量项目变薄——它的职责是**忠实地暴露失败**，不是吸收失败。**现状目录（已存在）**：

```
fcstd-port/
├─ lib/profile.mjs      ← 全库画像（唯一实现，入库）
├─ tools/               ← 13 个语料报表/内核探针（入库，见 tools/README.md）
├─ tsconfig.json        ← moduleResolution: bundler，供 npm run typecheck
├─ reports/             ← 画像与每轮运行报表（入库）
├─ state/               ← 断点状态（gitignore）
├─ out/                 ← 产物与一次性探针（gitignore）
└─ test/                ← 冒烟 golden（待建）
```

单文件转换由 faijs 发布的 CLI 承担（`npm run convert -- <in.FCStd> [out.fai.zip]`）。**批量驱动（扫描/调度/超时/重试/断点/聚合）仍是 B2 待办**——原设计的 `bin/convert.mjs` 不再作为转换器，只是驱动壳：

| 项 | 设计 |
|---|---|
| 范围 | 递归扫 `*.FCStd`/`*.fcstd`（3,201 个）；`.FCStd1`（102 个备份）默认跳过（Q1）；路径全程 path API（目录名含空格是常态） |
| 调度 | **串行为主**（用户全局铁律），每文件一个子进程隔离 WASM 崩溃；`--concurrency` 上限 4 |
| 超时 | 每文件硬超时（默认 120 s 可调），超时 = 失败，绝不无限等待 |
| 断点 | `state/progress.json` 记每文件状态 + faijs 版本；重跑跳过已成功文件，`--force` 全量 |
| 三态 | `ok`（退出码 0）/ `gap`（退出码 2，翻译缺口，产物不产出）/ `failed`（内部错误/超时）。**没有 baked-only=ok 这种状态**——C4 下 gap 就是失败的一种，报表单列是为了 reason 分桶回灌给 faijs 侧修 |
| 终检 | 每个成功产物校验 mapping.json：disposition ∈ {translated, python-baked, preserved-only}，违例判 FAIL |
| 护栏 | 冒烟 golden（代表样本）先行；全量跑完抽样 ≥20 个产物做 `check` + `run --mode brep` 导出 STEP（入口见 §7 V-C3 注） |

**阶段进展**：

| 阶段 | 内容 | 状态 |
|---|---|---|
| **B0** | faijs P0 硬骨头（H1–H3）+ CLI | 🟡 CLI ✅、**H1 ✅**；H2 剩 3 类约束（1.62%）、**H3 的附着体系未做**。附带完成 H8（外部几何接线） |
| **B1** | 批量骨架 + 全库画像 | 🟡 画像 ✅（`reports/library-profile.*`）；批量骨架 ❌ |
| **B2** | 小批量试跑，暴露 P1/P2 的真实分布 | ❌ 待办。**建议先做**——见 §10 |
| **B3** | 硬骨头迭代（每轮小批量复测） | ❌ |
| **B4** | 全量 + 抽样验收 | ❌ |

B1 结束时**不承诺**有产物（C4 下不达标不出包）；画像 + gap 报表才是交付物。

---

## 7. 验收判据

| 编号 | 判据 | 归属 |
|---|---|---|
| V-C1 | **翻译完备**：全部 3,201 个文件要么转换成功（mapping 仅含 translated/python-baked/preserved-only），要么在 gap/failed 清单中带结构化 reason；**不存在静默烘焙** | faijs 内核 + 批量终检 |
| V-C2 | 草图完备：全部草图 L0（求解复现落盘几何）或带定位到约束类型/几何成因的失败报告；L1/L2 数量归零或每条有成因结论 | faijs 内核 |
| V-C3 | 产物可执行：抽样 ≥20 个产物 `check` 零错误、`run --mode brep` 导出 STEP 成功 | 批量项目 |
| V-C4 | 影子保真：`freecad/` 子树 sha256 逐成员全等（既有 V1） | faijs 内核 |
| V-C5 | 断点续跑 + 可追溯（faijs 版本、逐文件状态、reason 分布） | 批量项目 |
| V-C6 | Python 例外如实：`python-baked` 对象 100% 是 `PropertyPythonObject` 本体或其 Python 依赖，无搭车 | faijs 内核 |

> **V-C3 的执行入口（实测澄清，避免照表找不到命令）**：**发布的 tgz 里没有 `check` / `run` 子命令**——`bin` 只有 `faijs-fcstd-convert`，`faijs-cli.ts` 位于 `packages/core/scripts/`（不发布）。批量项目要执行 V-C3，走**编程接口**：`@faicad/faijs/node` 导出的 `cliCheck(path)` / `cliRun(path, outPath, opts)`。
> `cliCheck` 的返回形态是 `{ ok, errors, warnings, script: { statements, callees } }`——**`statements` 在 `script` 下，不在顶层**（56 样本扫描时按顶层取会得到「全 0」的假象）。`cliRun` 的签名是 `(filePath, outPath, opts)`，`opts.mode` ∈ `brep|mesh|auto`，`opts.libs` 传 `{ cad: createApiNamespace() }`。

---

## 8. 风险登记

| 编号 | 风险 | 影响 | 对策 |
|---|---|---|---|
| R-CA | ~~零件库特征/约束类型全集未知~~ **已消解（2026-09-20 画像）**：91 类 / 41 类缺口 / 4,256 对象，规模已量化为 9.2% | 中 | 按 §10 频次排序逐类攻克；每轮小批量复测后重排 |
| R-CB | planegcs 后端对某些约束类型求解不收敛（非映射缺失，是求解器本身能力） | 中 | H2 ②先区分「映射缺失」与「求解失败」；求解失败的逐例分析，必要时升级 planegcs 或补初值策略；逐例留档测试。**当前 L1 只有 1 例（`delta-exceeds-t1`）** |
| R-CC | ~~`ThroughAll`/`UpToFace` 需要 OCCT 级查询而内核缺 API~~ **已消解**：`UpToFace` 两条路（datum plane 精确距离 / `cad.faceRef`）与 `UpToLast`/`UpToFirst`（`BaseFeature`）均已实现；`ThroughAll` 仍待做 | 低 | `ThroughAll` 走 OCCT 相交深度；仍属 C3「先补齐本项目」范围 |
| R-CD | Draft/装配类对象的语义映射存在设计争议（如 Draft Array vs PartDesign Pattern） | 中 | 逐类拍板一次、留档 Agent Note，不逐文件即兴 |
| R-CE | ~~XLink 环引用 / 引用文件不在库内~~ **已消解**：跨文档 XLink 为 0 | 低 | 保留运行时检测：遇非空 `file` 属性即判 gap 带 reason，不静默 |
| R-CF | 3,201 文件全量时长未知 | 低 | 画像已实测：单次全库只读遍历 105.8 s；批量支持分目录分批 |
| R-CG | 「不允许回退」在个别对象上客观不可达成（损坏文件、FreeCAD 自身也打不开的文件） | 低 | 判 gap/failed 并如实报告，不算违背 C4——C4 约束的是 faijs 能力，不是数据本身的完好性。**画像实测 3,201 文件 0 失败**（无损坏样本） |
| R-CH | **几何种类静默降级**：`ArcOfEllipse`/`BSpline`/`Hyperbola`/`Parabola` 走 NaN 点 → L2（`sketch-parse.ts:238-242`），不是显式 gap，容易漏统计 | 中 | 全库已量化：`GeomBSplineCurve` 1,630 条 / 24 文件、`GeomArcOfEllipse` 8 条 / 5 文件。要么实现 B 样条轮廓，要么改为**显式 gap**（不许静默 L2） |

---

## 9. 拍板结果

**2026-09-19（用户确认）**

| 编号 | 问题 | 拍板 |
|---|---|---|
| Q1 | `.FCStd1`（102 个备份）是否转换 | **跳过** |
| Q2 | 新项目名与位置 | **`D:/Faicad/fcstd-port`**；该项目未来承接更多 FCStd 模型移植，不只本库 |
| Q3 | 画像（§4）是否先于 B0 启动 | **同意：画像立即先行** |
| Q4 | gap 文件重跑策略 | **同意：只重试上一轮 gap 清单** |

**2026-09-20（按用户「你选一个合适的解决方案」授权，已执行）**

| 编号 | 问题 | 决定 |
|---|---|---|
| Q5 | `planegcs` 是 devDependency 还是 dependency | **dependencies**。判据是代码事实：`convert.ts` 在抽取任何轮廓**之前**对每个草图求解，缺 solver = 不能转换。faijs **不需要**浏览器侧草图能力（`cad.sketch` 只消费已解好的轮廓） |
| Q6 | 两份转换管线实现是否合并 | **合并**：删 `scripts/fcstd-to-fai-zip.ts`，唯一 CLI = `src/fcstd/cli.ts` |
| Q7 | 14 个语料/探针脚本归属 | **全部迁出**到 `fcstd-port/tools/`（实迁 13：12 个 + 补迁的 `probe-planegcs.ts`；`scan-fcstd-samples.ts` 判重删除）；faijs 只留能力 + 自动测试 |

---

## 10. 与既有计划的关系与实施顺序

- 本方案吸收并收紧二阶段计划（M7–M13）：M7/M8/M9/M10/M11 对应 H1/H3/H4+H5/H6；M13 的白名单扩容升级为 H7 的大规模攻坚；二阶段计划中所有「显式烘焙 + reason」条款**废止**，替换为「实现它」。
- §5.3 的「禁发 npm、走 tgz」被 `docs/plans/2026-09-19-npm-publish-plan.md` 取代。
- 3,201 个零件库文件取代 56 个 FreeCAD 源码树样本成为**验收语料**；56 样本仅保留为「不依赖零件库的快速把关」。

**下一步排序（依据实测收益，2026-09-20 定版）**

先做 **B2**（对 3,201 文件跑一次批量试跑）：**当前的频次数据是「对象级」，而排序需要「文件级」**——「补完哪几个类型 / 哪一项，能让多少个文件从 gap 变 ok」才是决定实现顺序的量。对象级直方图会给出误导性的顺序（例如按对象数会把 `Part::Feature` 排第一，但按解锁文件数可能完全不同）。56 样本只能提供方向性提示，不能外推到零件库。

**修订后的候选顺序（待 B2 数据确认）**：

1. **H10 先接线**（Python → `python-baked`）——改动小（产生端 + 属性判定），收益大：56 样本里 Python 对象是类型缺口第一大宗（`App::FeaturePython` 20 / `Part::FeaturePython` 14 / `Path::FeaturePython` 9 / `Part2DObjectPython` 6 / `Fem::*Python` 9）；全库 4,514 对象 / 647 文件。同时清掉 `App::Point`/`App::Annotation` 的分类口径不一致。
2. **H3 附着体系**（`MapMode`/`Support`/`AttachmentOffset`）——不做则非 XY 平面草图的几何位置全错，且是 `sketch-not-solved` 之外的独立风险面。
3. **H7 按文件级收益排序**——全库缺口 4,256 对象 / 41 类型；头部 10 个类型占 82%。分组处理：
   - `Part::Feature`(1359) + `Part::Revolution`(425) + `Part::Fillet`(196) + `Part::Chamfer`(109) = **Part 工作台特征系（2,089）**——注意与 PartDesign 同名异构；
   - `PartDesign::Groove`(726)（= Revolve 减体）；
   - `Part::Sweep`(268) + `Part::Loft`(107) + `Part::Helix`(46) + `PartDesign::AdditivePipe`(22) + `PartDesign::AdditiveLoft`(5) + `PartDesign::SubtractiveHelix`(4) + `PartDesign::AdditiveHelix`(1) + `PartDesign::SubtractivePipe`(2) = **扫掠/放样/螺旋系（455）**，内核 op 补齐；
   - `App::Link*`(149) 文档内链接语义（含 `sub="Pocket.Face5"` 子形状引用）——H9 修订后的唯一新增项，C4 下不得 baked；
   - `Part::Mirroring`(253) + `PartDesign::Mirrored`(166) + `PartDesign::MultiTransform`(42) = **镜像/多重变换系（461）**；
   - `PartDesign::ShapeBinder`(71) + `PartDesign::FeatureBase`(69) + `Part::SubShapeBinder`(9) + `PartDesign::SubShapeBinder`(1) = **跨引用系（150）**；
   - `Part::MultiCommon`(50) + `Part::Fuse`(42) + `PartDesign::Boolean`(4) = **布尔系（96）**；
   - 其余长尾（`Part::Thickness` 34、`PartDesign::Hole` 33、Draft 系 14+12、基本体补漏 `Part::Cone`/`Torus`/`Wedge`/`Circle`/`Plane`/`Offset`、`PartDesign::AdditiveBox/Cylinder/Ellipsoid`…）。
4. **H2 补 15/17/19 三类约束**（2,599 条 / 1.62%）——工作量小、闭合度高，但按现有数据对 ok 数的贡献最小，故**后置**；配套把 `delta-exceeds-t1` 的 L1 归因。
5. **H4 尾部 bake 分支**（`ThroughAll`、`uptoface-solid-face-unsupported`、`pad-type-<type>-unsupported` 等）+ **H6 非常量表达式**（16,277 条 / 94.8%）——H6 是 `Part` 参数化零件库的刚需，需在 H7 头部类型之间穿插推进。

- **归属铁律（2026-09-20 用户确认）**：库分析代码只存在于 `D:/Faicad/fcstd-port`；faijs 只保留通用 FCStd→`.fai.zip` 能力与其**公开读层/转换层 API** + 自动测试。faijs 侧出现 `FreeCAD-library` 相关脚本一律视为越界。
- **测试归属（2026-09-20 二次确认）**：**依赖外部语料的测试**（`convert.test.ts`、`placement-corpus.test.ts`、`external-geo.test.ts`、`solver-wrong-solution.test.ts`、`fcstd-e2e.test.ts`、`fcstd-g9-contour.test.ts` 共 6 个）及 `packages/fixtures/data/fcstd/` 的 3 个 `.FCStd` 样本已迁至 **`fcstd-port/test/FreeCAD/`**（vitest alias 指向 faijs 源码树，免打包；fixture 在其 `fixtures/` 子目录）。faijs 内只保留**合成 fixture 的单元测试**（parser/codegen/placement/容器/白名单翻译等 11 文件 112 用例），CI 防回归不丢。
- 批量项目是纯消费方，依赖面收敛为一个 CLI + 一份 tgz（发布后为一个 npm 包）。
