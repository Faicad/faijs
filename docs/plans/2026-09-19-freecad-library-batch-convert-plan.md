# FreeCAD-library 全量 FCStd → .fai.zip 批量转换方案

> 日期：2026-09-19（同日二次修订：回退通道废止，改为硬骨头清单驱动）
> 状态：**方案（未实施）**——本轮只写方案；用户明确说「开始实施」后才动代码
> 前置文档：`docs/analysis/2026-09-15-fcstd-to-fai-zip-feasibility.md`（可行性）、`docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md`（一阶段 M0–M6，部分落地）、`docs/plans/2026-09-17-fcstd-port-phase2-plan.md`（二阶段 M7–M13，未实施）

---

## 1. 用户原始要求（原文引用）

> 请写一份方案，我需要把../FreeCAD-library里的所有fcstd文件转换为.fai.zip文件. 因为要转换的文件很多，我需要把这个任务放到一个独立的新的git项目里。而不是放在本项目里。当然，如果转换需要的功能faijs项目没有，则需要先补齐本项目的能力。

> 容器天生带「翻译不了 → 烘焙 assets/*.brp + 记 reason」的回退通道? 这是第一阶段的做法，现在的要求是除非是fcstd里的python脚本，其他都需要支持，不允许回退，要啃硬骨头。你的方案里要把现在明确不支持的作为优先解决的问题。

拆解为约束：

| 编号 | 约束 |
|---|---|
| C1 | 转换对象：`../FreeCAD-library`（`D:/Faicad/FreeCAD-library`）下的所有 FCStd 文件 → `.fai.zip` |
| C2 | 批量任务放在独立的新 git 项目，不进 faijs 仓库 |
| C3 | 转换需要而 faijs 缺失的能力，先补齐 faijs |
| **C4** | **除 `PropertyPythonObject`（Python 脚本特征）外，一切对象都必须翻译，不允许烘焙回退**；现在明确不支持的，就是优先要解决的问题 |

---

## 2. 约束变更的影响：从「覆盖率问题」变成「完备性问题」

第一阶段的容器设计（可行性分析 §7 R7、`build-fai-zip.ts` 现状）是「白名单翻译 + 兜底烘焙」，覆盖率的分母可以绕开难啃的对象。**C4 把这个逃生口焊死了**：

- `mapping.json` 的 disposition 从三态（translated / baked / preserved-only）收敛为**两态**：`translated` / `python-baked`（仅 `PropertyPythonObject` 及其依赖的 Python 特征）。`preserved-only` 仅用于本来就无需翻译的显示类对象（GuiDocument、缩略图等影子成员），不算翻译缺口。
- 凡出现第三种情况——该翻译却翻译不了的对象——**该文件的转换判 FAIL**，不产出 `.fai.zip`。
- 这条是**硬门禁**：批量驱动器对产物 `mapping.json` 做终检，发现任何非 Python 的 `baked` 处置即拒绝收货。内核侧也应有同源断言（`build-fai-zip` 收紧为：baked 处置的 `reason` 只允许 `python-opaque`）。

由此，方案的重心从「批量编排」彻底转移到「**翻译完备性**」：下面 §3 的硬骨头清单是全方案的优先级核心，批量项目（§6）只是跑完这批硬骨头之后的执行器。

**如实声明**：这是一份难度显著上调的承诺。「不允许回退」意味着 faijs 必须吃下 FreeCAD 非白名单特征、全部约束类型、表达式引擎语义、坐标系/附着体系、跨文档引用——其中草图约束求解器（planegcs 后端）和 PartDesign 特征树是工作量最大的两块。§3 每一项都给了处置方案与工作量定性，但**在没有跑完 §4 的全库画像之前，任何「预计 X 周完成」都是编造**，本文不给假时间表。

---

## 3. 硬骨头清单（当前明确不支持的，按优先级）

来源：二阶段计划 §4 缺口清单（G1–G13）+ 本方案对 C4 的增量分析。每项给出：现状、为何硬、处置方案、优先级。

### P0 — 不修好连一个文件都出不来

| 编号 | 硬骨头 | 现状（证据） | 处置方案 |
|---|---|---|---|
| **H1** | **codegen 产出非法 JS**（G1） | `renderArgs()` 空位置参数 → `cad.sketch(, {…})`（`codegen.ts:231-243`）；58 个单测全绿但产物 check 必失败 | 修渲染器 + e2e 护栏（= 二阶段 M7，无新设计，直接执行） |
| **H2** | **草图约束求解只覆盖 P0 集 15 类约束**（G1 草图侧） | 56 样本 126 个草图中 4 个 L1（`unsupported-constraint`×1、超容差×3）；零件库 3,201 个文件的约束类型分布**未知**，`InternalAlignment` 等未入集约束预计大量出现 | ① 先跑画像（§4）拿零件库约束类型直方图；② 按频次把缺失约束类型逐个接入 planegcs 后端（`planegcs-backend.ts` 是 wasm 编译的 planegcs，**理论上支持全部 FreeCAD 约束**，缺的只是 TS 侧登记/映射层——逐类补映射，不是重写求解器）；③ L1（有解超容差）逐个定位成因，禁止用「初始值兜底」糊弄 |
| **H3** | **坐标系/Placement/附着缺失**（G3） | `sketch-parse.ts:154-208` 丢 Z、不读 `Placement`/`AttachmentOffset`/`Support`；`feature-translate.ts` 仅 Box/Cylinder 用 `placementPos` | 按二阶段 M8 执行，但验收从「V6 尽力比对」升级为**硬要求**：所有 L0 草图轮廓与 FreeCAD 落盘值逐点一致；非 XY 平面、`AttachmentOffset`、`MapMode`（FlatFace/FlatFace2D 等）附着模式全部要有测试覆盖。附着到非平面（如圆柱面）的草图按 FreeCAD 源码标定，不猜 |

### P1 — 不修好大多数零件库文件出不来

| 编号 | 硬骨头 | 现状（证据） | 处置方案 |
|---|---|---|---|
| **H4** | **Pad/Pocket 类型枚举不完整**（G4） | 只支持 `Length`；`TwoLengths`/`ThroughAll`/`UpToFirst`/`UpToFace`/`TaperAngle`/`Offset` 未实现，且现状是**静默按 Length 处理**（现行违规） | `ThroughAll` → 求剖面沿法向与全体实体的精确相交深度（OCCT 可算，不猜 bbox）；`UpToFace`/`UpToFirst` → 面引用锚点（`cad.edgeRef` 范式扩展出 `faceRef`，一阶段已有 `faceRef` 导出，需接线）+ `topology/naming/` 几何提示；`TwoLengths` → 双段 extrude + union；`TaperAngle` → OCCT 拔模（draft）或双锥台构造，按样本实测定实现 |
| **H5** | **Body 语义与多 Body 拆分未实现**（G5） | `codegen.ts` 不读 `Body.Group`，同 Body 用了装配语义的 `cad.group`（语义错误） | 按二阶段 M10 执行（Group 主顺序 + fuse 链 + 多文件拆分 + main 聚合）。零件库文件普遍多 Body，此项不做则大多数文件的组织结构是错的 |
| **H6** | **表达式引擎未接入**（G6） | `expressions.ts` 已实现未接线；1,709 个 `<ExpressionEngine>`（56 样本口径）取到 0；零件库Spreadsheet 驱动的参数化文件预计更多 | 常量表达式 → JS 常量；**非常量表达式（跨对象引用、`<<Obj>>.prop`、算术组合）必须真翻译**——faijs 侧引入具名参数/常量图：`const` 声明 + 引用代入，拓扑排序处理依赖环（FreeCAD 表达式本身禁环，遇环报错不猜）。Spreadsheet `<Cells>` → JS 常量表 + 别名映射 |

### P2 — 白名单外的特征类型（C4 的主战场，规模未知）

| 编号 | 硬骨头 | 现状（证据） | 处置方案 |
|---|---|---|---|
| **H7** | **特征白名单只有 12 类**；零件库的对象类型全集未知 | 白名单：基本体/Pad/Pocket/Extrusion/Revolution/LinearPattern/PolarPattern/Fillet/Chamfer。已知缺口：`Part::Feature`（70 个未探针）、`Part::Offset2D`(22)、`Part::Mirroring`(4)、`Part::Compound`(5)、`Part::MultiCommon`(1)、`PartDesign::AdditiveSphere` 等；零件库还可能大量出现 Loft/Sweep/Pipe/Helix/Draft 系（Wire/Draft Union 等）/Part 布尔系 | ① **画像先行**（§4）：全库对象类型直方图，按频次排定实现顺序；② `sweep`/`loft`/`helix` 在 faijs 内核层缺 op 的（`revolve` 已挂、`sweep` 内核有未挂脚本面），走 `defineOp`/`compatOp` 正常补齐（这是给 faijs 补通用能力，不是转换器私货）；③ `Part::Compound`/`MultiCommon` → `cad.compound`/`cad.intersect` 语义映射；④ Draft 系对象（Draft Wire/Rectangle/Circle 等在零件库常见）→ 映射为 `cad.sketch` 等价轮廓 + 特征；⑤ 每类新特征：先写失败测试再实现，逐一进白名单 |
| **H8** | **外部几何（ExternalGeometry）只部分解锁**（M13.3） | `external-geo.ts` 投影已实现，但全量解锁在 M13 未做；零件库草图跨对象投影预计常见 | 全量解锁：`.brp` 边/顶点投影进草图局部 2D 喂求解器（已有管线），失败路径显式报错而非 L2 |
| **H9** | **XLink 跨文档引用**（零件库新问题，二阶段计划未覆盖） | 零件库文件可能 `XLink` 引用同库其它 FCStd；单文件转换语义没覆盖 | 递归转换：XLink 目标文件先转出 `.fai.zip`，引用方经 `cad.asset`/`load` 引用其产物。库级依赖图需先在画像阶段建好并检测环。若 FreeCAD-library 实际无 XLink（画像验证），此项降级记录 |
| **H10** | **`PropertyPythonObject` 之外的黑盒残留** | `PropertyPythonObject` 是唯一允许的烘焙类；但 Python 特征的**下游**（引用其形状的 Part 特征）仍需翻译 | Python 特征形状从 ZIP 内 `.brp` 取为 `cad.asset` 输入（这是数据引用，不是回退——对象本体是 Python，形状是既有事实）；下游特征照常翻译。mapping 中 Python 对象记 `python-baked`，其下游记 `translated`，链路在 mapping.json 可追溯 |

### 明确不做翻译的（C4 的例外，仅此一项）

| 对象 | 处置 |
|---|---|
| `PropertyPythonObject`（Python 脚本特征本体） | 烘焙：形状以 `.brp` 资产进 `assets/`，mapping 记 `python-baked`，reason `python-opaque` |
| 影子成员（GuiDocument.xml、缩略图、材质、相机、颜色） | 原样保留（`preserved-only`），本就非建模对象，不算缺口 |

---

## 4. 全库画像探针（一切排期的前置，第一个动手项）

对 3,201 个文件只读扫描，产出四张表：

1. **对象类型直方图**：`<Object type=...>` 全集 × 频次 → H7 的实现顺序依据；
2. **约束类型直方图**：全部 `<Constrain>` 的 Type 分布 → H2 的实现顺序依据；
3. **表达式统计**：`<ExpressionEngine>` 数量、非常量表达式占比、Spreadsheet 文件数 → H6 工作量依据；
4. **结构统计**：Body 数、XLink 数、Python 特征数、草图数/文件 → 整体规模与 H9 判定。

实现：扩展 `scripts/scan-fcstd-samples.ts`（修 G10 统计 bug 后复用），样本根参数化。**画像结果回填本文档 §3 的「未知」项，再定 P2 的实现排序与阶段划分**——这是本方案唯一诚实的排期方式。

---

## 5. faijs 侧交付（全部在本项目内做，C3）

### 5.1 内核补齐

§3 的 H1–H10 全部在 `packages/core/src/fcstd/` + `api/` 内实现。实施顺序 = P0 → P1 → P2（P2 按 §4 画像排序）。每项硬骨头：

- 先写失败测试（单元 + 端到端样本），再实现——二阶段计划 §10 纪律沿用；
- 与既有 M7–M13 计划的关系：H1=M7、H3=M8、H4+H5=M9/M10、H6=M11、H7/M13.3+M13.1/M13.2=H7/H8 扩容版。**二阶段计划被本方案吸收并收紧**（其「显式烘焙 + reason」条款全部废止，替换为「实现它」）；
- 白名单判定规则从「白名单外即回退」改为「白名单外即 FAIL」：`feature-translate.ts` 的未知类型分支从生成 baked 改为返回结构化错误，**禁止静默降级升级为禁止降级**。

### 5.2 CLI 产品化（新增，二阶段计划未覆盖）

现有 `fcstd-to-fai-zip.ts` 是 scripts/ 下开发脚本，批量项目没法用。改造为随包发布的稳定 CLI：

| 项 | 要求 |
|---|---|
| 入口 | `@faicad/faijs` 新增 exports 子路径（如 `./fcstd-convert`），编译后 JS；`package.json` 声明 `bin` |
| 契约 | `faijs-fcstd-convert <in.FCStd> <out.fai.zip>`；退出码：0=成功且 mapping 终检通过（无非 Python baked）、2=含翻译缺口（H 清单命中，产物不写出）、非 0=内部错误 |
| 输出 | stdout 一行 JSON 摘要（对象计数、草图 L0 数、耗时、失败 reason）；stderr 零容忍 |
| 隔离 | 单文件任何异常（ZIP 损坏、XML 失败、solver throw）捕获为结构化错误，绝不崩批量进程 |

### 5.3 版本发布

本项目禁发 npm：批量项目经 `npm run pack` 产出的 tgz 安装（`npm install ../faijs/faicad-faijs-<ver>.tgz`），报表记录 faijs 版本。严禁 `npm link` / junction。

---

## 6. 批量项目设计（新 git 项目，建议 `D:/Faicad/fcstd-batch`）

C4 之后批量项目变薄——它的职责是**忠实地暴露失败**，不是吸收失败：

```
fcstd-batch/
├─ bin/convert.mjs        ← 批量驱动：扫描/调度/超时/重试/断点
├─ lib/report.mjs         ← 汇总报表（成功/失败 + reason 直方图）
├─ state/                 ← 断点状态（.gitignore）
├─ out/                   ← 产物（.gitignore，镜像源目录结构）
├─ reports/               ← 每轮 JSON + md 报表（入库）
└─ test/                  ← 冒烟 golden（固定代表样本）
```

| 项 | 设计 |
|---|---|
| 范围 | 递归扫 `*.FCStd`/`*.fcstd`；`.FCStd1`（102 个备份）默认跳过（Q1）；路径全程 path API（目录名含空格是常态） |
| 调度 | **串行为主**（用户全局铁律），每文件一个子进程隔离 WASM 崩溃；`--concurrency` 上限 4 |
| 超时 | 每文件硬超时（默认 120s 可调），超时=失败，绝不无限等待 |
| 断点 | `state/progress.json` 记每文件状态 + faijs 版本；重跑跳过已成功文件，`--force` 全量 |
| 三态 | `ok`（退出码 0）/ `gap`（退出码 2，翻译缺口，产物不产出）/ `failed`（内部错误/超时）。**没有 baked-only=ok 这种状态**——C4 下 gap 就是失败的一种，报表单列是为了 reason 分桶回灌给 faijs 侧修 |
| 终检 | 每个成功产物校验 mapping.json：disposition ∈ {translated, python-baked, preserved-only}，违例判 FAIL |
| 护栏 | 冒烟 golden（代表样本）先行；全量跑完抽样 ≥20 个产物做 `check` + `run --mode brep` 导出 STEP 验证 |

阶段：B0=faijs P0 硬骨头（H1–H3）+ CLI → B1=批量骨架 + 全库画像（§4 可提前到与 B0 并行，画像只读不依赖内核）→ B2=小批量试跑（100 文件）暴露 P1/P2 清单的真实分布 → B3=硬骨头迭代（每轮小批量复测）→ B4=全量 + 抽样。B1 结束时**不承诺**有产物（C4 下不达标不出包）；画像 + gap 报表就是 B1 的交付物。

---

## 7. 验收判据

| 编号 | 判据 | 归属 |
|---|---|---|
| V-C1 | **翻译完备**：全部 3,201 个文件要么转换成功（mapping 仅含 translated/python-baked/preserved-only），要么在 gap/failed 清单中带结构化 reason；**不存在静默烘焙** | faijs 内核 + 批量终检 |
| V-C2 | 草图完备：全部草图 L0（求解复现落盘几何）或带定位到约束类型/几何成因的失败报告；L1/L2 数量归零或每条有成因结论 | faijs 内核 |
| V-C3 | 产物可执行：抽样 ≥20 个 `faijs-cli check` 零错误、`run --mode brep` 导出 STEP 成功 | 批量项目 |
| V-C4 | 影子保真：`freecad/` 子树 sha256 逐成员全等（既有 V1） | faijs 内核 |
| V-C5 | 断点续跑 + 可追溯（faijs 版本、逐文件状态、reason 分布） | 批量项目 |
| V-C6 | Python 例外如实：`python-baked` 对象 100% 是 `PropertyPythonObject` 本体或其 Python 依赖，无搭车 | faijs 内核 |

---

## 8. 风险登记

| 编号 | 风险 | 影响 | 对策 |
|---|---|---|---|
| R-CA | 零件库特征/约束类型全集未知，P2 工作量可能远超预期 | 高 | §4 画像先行；P2 按频次排序逐类攻克，画像数据回填后重排 |
| R-CB | planegcs 后端对某些约束类型求解不收敛（非映射缺失，是求解器本身能力） | 高 | H2 ②先区分「映射缺失」与「求解失败」；求解失败的逐例分析，必要时升级 planegcs 或补初值策略；逐例留档测试 |
| R-CC | `ThroughAll`/`UpToFace` 等语义需要 OCCT 级查询（相交深度、面拾取），faijs 内核可能缺底层 API | 中 | 走 OCCT highLevelApi 补底层能力；仍属 C3「先补齐本项目」范围 |
| R-CD | Draft/装配类对象的语义映射存在设计争议（如 Draft Array vs PartDesign Pattern） | 中 | 逐类拍板一次、留档 Agent Note，不逐文件即兴 |
| R-CE | XLink 环引用 / 引用文件不在库内 | 中 | 画像建依赖图检测环；缺目标文件判 gap 带 reason |
| R-CF | 3,201 文件全量时长未知 | 低 | 画像时实测单文件耗时分布；批量支持分目录分批 |
| R-CG | 「不允许回退」在个别对象上客观不可达成（如损坏文件、FreeCAD 自身也打不开的文件） | 低 | 这类判 gap/failed 并如实报告，不算违背 C4——C4 约束的是 faijs 能力，不是数据本身的完好性 |

---

## 9. 拍板结果（2026-09-19 用户确认）

| 编号 | 问题 | 拍板 |
|---|---|---|
| Q1 | `.FCStd1`（102 个备份）是否转换 | **跳过** |
| Q2 | 新项目名与位置 | **`D:/Faicad/fcstd-port`**；该项目未来承接更多 FCStd 模型移植，不只本库 |
| Q3 | 画像（§4）是否先于 B0 启动 | **同意：画像立即先行** |
| Q4 | gap 文件重跑策略 | **同意：只重试上一轮 gap 清单** |

---

## 10. 与既有计划的关系

- 本方案吸收并收紧二阶段计划（M7–M13）：M7/M8/M9/M10/M11 直接对应 H1/H3/H4+H5/H6；M13 的白名单扩容升级为 H7 的大规模攻坚；二阶段计划中所有「显式烘焙 + reason」条款**废止**，替换为「实现它」。
- 3,201 个零件库文件取代 56 个 FreeCAD 源码树样本成为验收语料。
- 批量项目是纯消费方，依赖面收敛为一个 CLI + 一份 tgz。
