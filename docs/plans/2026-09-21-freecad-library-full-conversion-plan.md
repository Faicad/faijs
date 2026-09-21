# FreeCAD-library 全量 FCStd → .fai.zip 批量转换方案（2026-09-21 版）

> 日期：2026-09-21
> 状态：**方案（本轮只出方案，不动代码）**。已落地部分在 §3 逐项标状态并附证据。
> 与既有文档的关系：**本文取代 `2026-09-19-freecad-library-batch-convert-plan.md` 的 §3（进度口径）与 §10（实施顺序）**；该文的 §1 用户要求、§4 全库画像、§5.4 脚本归属、§6 批量项目骨架、§7 验收判据骨架仍然有效，本文在其上增量，不重复抄写。
> 前置：`docs/analysis/2026-09-15-fcstd-to-fai-zip-feasibility.md`（可行性）、`docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md`、`docs/plans/2026-09-17-fcstd-port-phase2-plan.md`
> 归属：库/语料分析代码在 `D:/Faicad/fcstd-port`；本仓库只保留通用 FCStd→`.fai.zip` 能力与其公开读层/转换层 API。

---

## 1. 用户原始要求（原文引用）

### 1.1 目标与约束（2026-09-19 原文）

> 请写一份方案，我需要把../FreeCAD-library里的所有fcstd文件转换为.fai.zip文件. 因为要转换的文件很多，我需要把这个任务放到一个独立的新的git项目里。而不是放在本项目里。当然，如果转换需要的功能faijs项目没有，则需要先补齐本项目的能力。

> 容器天生带「翻译不了 → 烘焙 assets/*.brp + 记 reason」的回退通道? 这是第一阶段的做法，现在的要求是除非是fcstd里的python脚本，其他都需要支持，不允许回退，要啃硬骨头。你的方案里要把现在明确不支持的作为优先解决的问题。

> packages/core/scripts/scan-fcstd-library.ts这样的文件明显是错误的。本项目只应该有通用的fcstd转.fai.zip的功能代码。绝对不允许有分析FreeCAD-library的代码。

### 1.2 op 来源与语义的澄清（2026-09-21 原文，本轮新增的硬约束）

> 你要记住，所有fai_开头的op，以及你刚刚用到的group/rotate_euler，都是最初只为../3d_editor项目使用而提供的op，根本没有设计为成为一个通用的op。为何你迁移freecad的fcstd文件，要用到它们？？因为之前你错用fai_split,fai_extrude，我已经强制把这些写成了deprecated. 这两个group/rotate_euler也应该是一样的处理。未来要拿到。只给3d_editor项目用。你应该设计的是自己的api。

> 什么叫allowNonSolid方向已被你否定？ 根本没有啊。之前我说的是你对所谓的运行时回退理解错误。如果allowNonSolid指的是可以load草图、装配等对象，当然应该支持啊。而且你应该考虑的是，是否重用cad.load这个api。load的语义是加载文件，也是最初给3d_editor用的。

### 1.3 拆解为约束

| 编号 | 约束 | 来源 |
|---|---|---|
| C1 | 转换对象：`D:/Faicad/FreeCAD-library`（**3,201** 个 FCStd）→ `.fai.zip` | 1.1 |
| C2 | 批量任务放在独立 git 项目（`D:/Faicad/fcstd-port`），不进 faijs 仓库 | 1.1 |
| C3 | 转换需要而 faijs 缺失的能力，先补齐 faijs | 1.1 |
| **C4** | 除 `PropertyPythonObject`（Python 脚本特征）外，一切对象都必须翻译，不允许烘焙回退 | 1.1 |
| **C5** | **FCStd 迁移不得借用编辑器 op**（`fai_*`、`group`、`rotate_euler`/`translate`/`scale`/`scale3d`、`copy`、`assembly`、**`load`**）；平台能力必须落在平台自有 API 上 | 1.2 |
| **C6** | **非实体对象（草图线框、面、壳、装配）的导入是一等能力**，不是开关；用不了它的操作（布尔等）在**使用点**显式报错，而不是在导入点设卡 | 1.2 |
| **C7** | `cad.load` 是否重用：**不重用**（理由见 §4.5） | 1.2 |

> **C6 的措辞是本轮的关键更正**：此前把「加 `allowNonSolid` 开关」当成能力补齐，并把「静态规则/禁运行时回退」红线反用于论证该开关的必要性——方向错了。红线要求的是「不支持就暴露」，不是「静态地绕过去」。正确形态：能力本身直接具备（导入不要求实体），限制发生在**需要实体的操作**上。

---

## 2. 结论先行：当前最大障碍不是「缺特征翻译」，而是「站错了 API 面」

按实测（§3.3），56 样本的 50 个可转换产物里，**84.3% 的 callee 是编辑器 op**。也就是说：即使把 H7 的 41 类特征全部补齐，产物依然整体站在 `../3d_editor` 的 API 面上，违反 C5，且 ArchDetail 已经因此死在 s652。

**所以本轮的 P0 = 先在 faijs 建平台自有的三个 op（资产导入 / 几何 compound / 放置），把翻译层从编辑器 op 面整体切过去**，然后再回到「缺哪些特征」的问题上。这个顺序不可颠倒：P0 未完成时，任何新增的翻译分支都会继续往编辑器 op 面上堆。

---

## 3. 实测现状（2026-09-21）

### 3.1 语料与口径

| 语料 | 规模 | 用途 |
|---|---|---|
| `D:/Faicad/FreeCAD`（FreeCAD 源码树样本） | **56** 文件 | 快速把关（不依赖零件库）；本文所有「实测」均指这批 |
| `D:/Faicad/FreeCAD-library` | **3,201** 文件 | 最终验收语料（C1） |

转换侧口径：`fcstd-port/out/sweep3.log`（56 文件 / 82 模块 / 1,075 语句）；执行侧口径：`fcstd-port/out/probe-runnable2.log`。

| 指标 | 数值 |
|---|---|
| 转换 ok / gap | **50 / 6**（`cliCheck` 失败 0） |
| 执行 run ok / fail | **36 / 14**（0 抛异常） |

### 3.2 op 归属实测：产物 callee 普查（**本轮新测，C5 的证据**）

对 50 个可转换产物的**全部 82 个 `.fai.js` 模块**（1,063 条语句 / 1,084 处 callee）逐处统计：

| callee | 次数 | 归属 |
|---|---|---|
| `cad.load` | **434** | 🔴 编辑器 op（file import Feature） |
| `cad.translate` | **303** | 🔴 编辑器 op（transform 家族） |
| `cad.rotate_euler` | **160** | 🔴 编辑器 op（transform 家族） |
| `cad.group` | **17** | 🔴 编辑器 op（结构分组） |
| `cad.sketch` | 46 | 🟢 平台 op |
| `cad.extrude` | 33 | 🟢 平台 op（compat/brep-only） |
| `cad.box` | 24 | 🟢 平台 op |
| `cad.subtract` | 17 | 🟢 平台 op |
| `cad.revolve` | 17 | 🟢 平台 op |
| `cad.union` | 14 | 🟢 平台 op |
| `cad.edgeRef` | 9 | 🟢 平台 op |
| `cad.cylinder` / `cad.fillet` | 5 / 3 | 🟢 平台 op |
| `cad.sphere` / `cad.chamfer` | 1 / 1 | 🟢 平台 op |

- **编辑器 op：914 处 = 84.3%**；平台 op：170 处 = 15.7%。
- 含至少一个编辑器 op 的模块：**40 / 82**。
- ArchDetail 单文件（660 条语句）：`load` 293 + `translate` 227 + `rotate_euler` 128 + `group` 6 = 654 条（99.1%）。

> 复现命令（只读，无内核）：遍历 `fcstd-port/out/sweep/**/*.fai.js`，正则统计 `cad\.<name>` 并按名单分类。**该普查须在 P0 落地后重跑，验收判据 V-C7 以它为准。**

### 3.3 编辑器 op 归属的判据与证据（C5 的裁定依据）

| op | 3d_editor 侧证据 | faijs 侧自述 |
|---|---|---|
| `fai_split` / `fai_extrude` | 同名 Feature 模块 | 已 `@deprecated`（`f963d97`） |
| `group` | `features/group.ts` | `api/compound.ts:13`「无几何输出，意义是结构（层级）」 |
| `translate` / `rotate_euler` / `scale` / `scale3d` | `features/transform.ts`（UI 工具模式 move/rotate/scale + 时间线 backfill） | `api/copy.ts`「画布显示 box 和副本两份」 |
| `copy` / `assembly` | `features/assembly.ts` | `api/compound.ts`（装配行为挂在编辑器结构节点上） |
| **`load`** | **`features/load.ts` 头注释「load Feature — file import」+ `registerFeature(loadFeature)`；`loadArgsFromFileRef` 用 `getPlatform().caps.realPaths` 做 key/path/url 三键分流；`deriveOutputs('load', …)` 产 partN；`ModelGroup.tsx:254` 注明「faijs cad.load 只支持 STL；STEP/IGES/BREP 通过 BREP 路径处理」、`:256` 记 part0 重名冲突** | `api/load.ts`「永远是 part 的第一条语句，后面可接特征链」 |

- 前 7 个已标 `@deprecated` 并提交（`fce0cff`），守界回归 `fcstd/editor-op-boundary.test.ts`（`c2339b5`，双向：标记得留、借用点不得增）。
- **`load` 是本轮新增的第 8 个**（用户指出 + 上表核实）：它是编辑器的「文件导入 Feature」，`key/path/url` 三键分流读的是应用侧 `FileRef` 与平台能力位，`partN` 命名与「part 首条语句」的语句位置约束都是画布/时间线语义。**平台侧的 FCStd 资产导入不该复用它**（C7）。

### 3.4 硬骨头状态刷新

| 编号 | 硬骨头 | 状态（2026-09-21） | 证据 |
|---|---|---|---|
| — | 转换 CLI + 公开面 | ✅ | `@faicad/faijs/fcstd-convert` + `bin: faijs-fcstd-convert`；快照 12 子路径 |
| — | 全库画像 | ✅ | `fcstd-port/reports/library-profile.*`（3,201 文件 / 0 失败 / 105.8 s） |
| H1 | codegen 产出非法 JS | ✅ | 56 样本 `cliCheck` 失败 0 |
| H2 | 草图约束类型覆盖 | 🟡 98.38%，缺 `15/17/19`（2,599 条 = 1.62%） | `sketch-solver.ts:63-78` |
| H3 | 坐标系/Placement/附着 | 🟡 平面支撑 ✅（`attachment.ts`）；曲线/Frenet/面支撑未做 | `placement.ts` 149 行 + `attachment.test.ts` |
| H4 | Pad/Pocket 类型枚举 | 🟡 主干 ✅（`TwoLengths`/`UpToFace`/`UpToLast`/`UpToFirst`/`ThroughAll`），尾部 8 条 bake 分支仍在 | `feature-translate.ts:442-595` |
| H5 | Body 语义与多 Body 拆分 | ✅ | `codegen.ts:76-83` / `:124-136` / `:435` |
| H6 | 表达式引擎 | 🟡 常量 ✅；非常量 16,277 条（94.8%）仍 bake | `expressions.ts` + `feature-translate.ts:144-147` |
| H7 | 白名单外特征类型 | 🟡 `Part::Feature` 纯 Shape 载体 ✅；其余约 **3,546 对象 / 40 类型** 未动 | `shapeCarriers` 接线（`convert.ts`） |
| H8 | 外部几何投影 | ✅ 接线（失败 → 显式 gap）；弧线投影仍是缺口 | `convert.ts:159-175` |
| H9 | XLink 跨文档引用 | ✅ 定论（跨文档 0）；`App::Link*` 文档内链接并入 H7 | 画像 |
| H10 | Python 特征 → `python-baked` | ✅ 已接线（属性口径判定 + `App::Point`/`App::Annotation` 归结构类型） | `isPythonOpaque()` + `convert.test.ts` |
| **H11** | **平台 op 面自建（本轮 P0）** | ✅ 已完成（P0 步骤 1–2）：三个平台 op 落地 + 翻译层切换 + §4.6 删除 + 守界归零 | §3.2 / §4 |
| **H12** | **执行侧缺陷**（导出/显示/命名/资产） | 🟡 非实体导入已按 C6 改造（`allowNonSolid` 已删，非实体在导入点一等）；E1/E3/E4 未做 | §5 |

### 3.5 剩余 6 个转换 gap（56 样本，均为真实几何/求解工作）

BIMExample `sketch-not-solved`；PartDesignExample `external-geometry-unresolved: no links` + `pocket-missing-dependency`×2；Drilling_1 `unsupported-constraint` + `pad-missing-profile` + `pocket-missing-dependency` + `linear-pattern-missing-source`；hole_puzzle `external-geometry-unresolved: no links`；TestTangentMode3-0.21 `sketch-not-solved`；TestSketchCarbonCopyReverseMapping `delta-exceeds-t1` + `sketch-not-solved`×3。

### 3.6 剩余 8 个 run 失败（4 类，`run-census.test.ts` 逐样本钉死；2026-09-21 E3/E4/E5 执行侧修复后复测）

| 类 | 数量 | 性质 | 归属 |
|---|---|---|---|
| `nameless-shape` | 2 | `edgeRef` 无 role table——E3 已在 `import_brep` 链根建表，但这两例的缺口在 **op 间传播**（fillet/chamfer 的输入是布尔/特征 op 的产物，仍无名）。复测：strange_part_with_holes 报 `fillet: input shape has no role table`；ModelFromV021 报 `chamfer: edge ordinal out of range`（同族，演化链断裂） | H12/E3 后续 |
| `extrude-zero-vector` | 1 | 退化输入（EngineBlock） | H4/H8 |
| `dep-module-revolve` | 2 | 跨模块 Revolve 依赖 | H4 |
| `no-geometry` | 3 | 无几何终端 —— **属正确行为** | — |

> E5（本轮修复，2026-09-21）：ArchDetail 的 `compound-chain-members` 根因不在内核而在**lowering**——`cad.compound` 的 `params.members` 是词法变量名，`renderArgs` 把它们当数据字符串加了引号，op 收到的是无句柄的字符串。修复：members 渲染为裸标识符 + codegen 经 `variables` 重映射（GOTCHA 已留档 codegen.ts）。ArchDetail 转可跑（STEP 导出成功）。
> E4 补刀（同日）：`buildFaiZip` 的 `.brp` 资产收集器原来只读 `Shape` 属性，SubShape 载体（motor_mount_inch 的 PartShape5/8）的资产从未拷进 `assets/` → `asset-resolver` 2 例全消（PocketTest、motor_mount_inch 转可跑，GOTCHA 已留档 build-fai-zip.ts）。
> 基线：**49 convert / 41 run / 8 fail**（口径 `fcstd-port/out/census10.log`）。此前的平台 op 切换红利：`export-no-exportable-shape` 2 例消除；E1/E4 已落地（导出结构化错误、零字节资产转换期 gap）。

### 3.7 ArchDetail 卡点（P0 的验收靶）

- 失败：`statement 652 (callee: rotate_euler): E_BREP_UNSUPPORTED: input is not BREP`（`out/arch-run.log`）。
- 机制：`cad.group` 产出 `{kind:'compound', children}` 结构壳（`shape.ts:88`），OCCT 句柄只由 `fromBrep` 写入（`shape.ts:62`）→ `brepOf` 空（`shape.ts:173`）→ `api/transform.ts:82` 抛错。
- 资产普查（`out/nonsolid-kernel.log`）：302 个资产 = 132 有实体 / **170 零实体**。零实体资产的 `meshShape` 与 `translate` **都成功**，只有 `fuse(solid, …)` 抛 `boolean operation failed`。
  → **结论：非实体子形完全能进 compound、能整体放置；做不到的只有布尔。** 与 C6 的表述一致。

---

## 4. 平台 op 面设计（H11，本轮 P0）

三个 op 全部**手写**在 `packages/core/src/api/`（禁止用生成投影承载 faijs 语义；生成投影只承载「位置形参 + vendored 语义」）。命名见 §11 Q8。

### 4.1 op 一：BREP 资产导入（暂名 `cad.asset`）

| 项 | 设计 |
|---|---|
| 语义 | 把容器 `assets/` 里的冻结 BREP 载体装成 Shape（**引用而非拷贝**），返回**持 OCCT 句柄**的形状 |
| 形参 | `{ asset, format? }`；`asset` = `assets/` 成员名**去扩展名**（沿用 `FsAssetResolver` 目录模式 `key = basename(file)` 的既有规则），`format:'brep'` 为提示（`.brp` 不在 `CAD_FORMATS`，无提示会误走 mesh 路径） |
| **非实体** | **一等公民：不设任何开关**。导入不要求实体；wire/face/shell/compound 一律放行（对应 170/302 的 Draft 载体） |
| 限制落点 | 需要实体的操作（布尔、up-to 目标面等）在**使用点**报错。当前实测错误文本是 OCCT 的 `boolean operation failed`——须换成带 op 名与 cause 的显式错误 |
| 链路 | BREP 专属（`.brp` 无 mesh 解析器）：mesh 模式抛 `E_BREP_UNSUPPORTED`，与既有 compat op 同语义 |
| 与 `cad.load` 的差别 | 见 §4.5 |

### 4.2 op 二：几何 compound（暂名 `cad.compound`）

| 项 | 设计 |
|---|---|
| 语义 | 把多个成员聚成**一个几何体**（OCCT `TopoDS_Compound`），可被放置、导出、作为后续 op 的输入 |
| 形参 | `{ members, name? }` |
| BREP 实现 | `kernel.makeCompound(handles)`（`brep/engine/primitives.ts:109`，收**任意** BrepHandle，含非实体）→ `solidToShape`（`brep-ops.ts:40`，只三角化、不要求实体）→ `fromBrep` 登记句柄 |
| mesh 实现 | 合并成员 mesh（无句柄可合并时退化为可用子集；纯线框无面成员不贡献网格，见 §5/E2） |
| 与 `cad.group` 的区别 | `group` = 编辑器结构节点（无几何、不可变换）；`compound` = 几何复合体（有句柄、可变换/可导出）。**翻译层用后者** |
| 落地替换 | `feature-translate.ts:518`（`Part::Compound`）、`codegen.ts:533`/`:582`（两处产物聚合） |

### 4.3 op 三：放置（暂名 `cad.place`）

| 项 | 设计 |
|---|---|
| 语义 | **一个刚体变换**：先绕局部原点按 `rotation` 旋转，再平移 `position`（= FreeCAD `Placement` 的 `T(P)∘R(Q)`） |
| 形参 | `{ position?: [x,y,z], rotation?: [x,y,z,w] }`（两者皆可缺省 = 恒等；**不接受 pivot**——FCStd 语义就是绕局部原点） |
| BREP 实现 | `kernel.located(shape, matrix)`（`primitives.ts:97`）——一条语句换掉现在的 `rotate_euler` + `translate` 两条 |
| mesh 实现 | `applyTransform`（`mesh/rigid-transform.ts`，与 BREP 路径同数学：`p' = R·(p − pivot) + pivot + t`） |
| 替换点 | `codegen.ts:308`/`:315`（草图 Placement）、`:367-374`（up-to 反向变换）、`feature-translate.ts` 的 Placement 发射 |
| **必做标定** | 四元数→4×4 矩阵的**行/列主序**与 `located` 的约定必须以测试标定（`placement.ts` 已有四元数工具，但 kernel 侧的序须实测钉死），**禁止凭记忆写** |

### 4.4 内核能力盘点（不缺，无需新内核 API）

| 需要 | 已有 | 位置 |
|---|---|---|
| 组 compound | `makeCompound(shapes): BrepHandle` | `brep/engine/primitives.ts:109` |
| 刚体变换 | `located` / `transform` / `generalTransform` | `:96-98` |
| 三角化 | `meshShape` | `:115` |
| 线框通道（E2 用） | `wireframe(shape, deflection)` | `:116` |
| mesh 侧刚体变换 | `applyTransform` | `mesh/rigid-transform.ts` |

### 4.5 为什么不重用 `cad.load`（C7）

| 维度 | `cad.load`（编辑器） | 平台需要的 |
|---|---|---|
| op 身份 | `features/load.ts` 注册的 **Feature**，Timeline 可编辑的「文件导入」 | 平台几何 op（`defineOp`），无 UI 语义 |
| 键语义 | `key` / `path` / `url` 三键分流，判据含**平台能力位**（`caps.realPaths`）、应用侧 `FileRef` | 单一 **asset 引用**（容器资产名） |
| 语句位置 | 「永远是 part 的第一条语句」（source 语句） | 任意位置：成员依赖拓扑里可能出现在中段 |
| 命名 | `deriveOutputs('load', …)` → partN（编辑器代码生成约定） | 由 `codegen` 自行分配变量名 |
| 多 part | `partIndex`（逐 part 拆多 solid 文件，画布语义） | 容器资产是单载体的冻结拓扑 |
| 实体要求 | 历史契约「必须含实体」（本轮被 `allowNonSolid` 打开） | **不要求实体**（C6） |

→ 结论：**新建平台 op，`cad.load` 恢复原契约**（撤掉 `allowNonSolid`，见 §4.6）。

### 4.6 对既有 `allowNonSolid` 的处置（回收 fc9e145 的形态，保留其能力）

| 内容 | 处置 | 理由 |
|---|---|---|
| `params.allowNonSolid`（`api/load.ts`） | **删除** | 编辑器 op 不该为平台能力开参；编辑器侧不需要非实体导入 |
| `brep/brep-topology-text.ts`（`brepTextHasSolid`） | **删除**（连同 `nonSolidAssets` 收集与 `shapeAssetCall` 的分派） | 它是为「静态决定是否开开关」而生的判据；开关消失后无存在价值。**C6 下平台导入不设条件，不需要任何拓扑类型判据** |
| 能力本身（导入非实体资产） | **保留**，迁入 `cad.asset` | C6：能力必须支持 |
| 收益是否丢失 | **不丢**：已实测 4 个原 `asset-empty` 样本（Crank / thermomech_flow1D / 两个 InvoluteGear）走的是同一条导入路径，`cad.asset` 无实体要求后照样能跑 | `probe-runnable2.log` 36/50 的构成不变 |

> 说明：`.brp` 文本判据的技术事实（`TShapes` 扁平表、与内核 `getSubShapes(top,'solid')` 对拍 681/681 一致、非 CASCADE 须「弃权」）**不再是方案的一部分**——它服务的是被删掉的开关。相关验证若要留档，只作为测试代码保留，不作为设计依据。

### 4.7 翻译层切换清单（精确到行）

| 文件:行 | 现状 | 改为 |
|---|---|---|
| `fcstd/feature-translate.ts:381` `shapeAssetCall` | 发 `cad.load({key, format, allowNonSolid?})` | 发 `cad.import_brep({asset})` |
| `fcstd/feature-translate.ts:511-518` | `Part::Compound` → `cad.group` | → `cad.compound` |
| `fcstd/codegen.ts:533` / `:582` | 产物聚合 → `cad.group` | → `cad.compound` |
| `fcstd/codegen.ts:308` / `:315` | 发射 `cad.rotate_euler` + `cad.translate` | → `cad.place`（单点发射，两语句合一） |
| `fcstd/codegen.ts:367-374` | up-to 反向变换发射两条 | → `cad.place`（逆向：`rotation` 取共轭、`position` 取负） |
| `fcstd/convert.ts` | 收集 `nonSolidAssets` | 删除该收集 |
| `fcstd/editor-op-boundary.test.ts` | 借用点计数 group 3 / rotate_euler 2 / translate 2 | **全部归零**，并加「产物 callee ⊆ 平台 op 集」断言 |
| 两文件顶部的 ⚠️ 过渡态注释 | 声明临时借用 | 删除（借用已结束） |

---

## 5. 执行侧缺陷（H12）

| 编号 | 缺陷 | 现状证据 | 处置 |
|---|---|---|---|
| **E1** | `exportStepFromSolids` 在「无可导出子形」时**抛异常而非返回 error** | 2 例 `export-no-exportable-shape` | 改为返回 `Result`/结构化 error；全语料普查必须 catch；全线框链的导出语义需拍板（导出 STEP 时线框怎么办） |
| **E2** | 无面的纯线框三角化为空 → 可导入、可查询，但**无显示网格** | 已钉进 `load-nonsolid.test.ts` | 走内核 `wireframe()` 边通道，由显示层承载（`Shape` 目前不承载边集）。**不阻塞 STEP 导出，阻塞渲染** |
| **E3** | `nameless-shape`：装载后无名形状 → `edgeRef` 无 role table | 2 例 | 给导入资产建立 roleTable（沿用 `topology/naming/` 既有机制）；否则下游拓扑引用不可解析 |
| **E4** | `asset-resolver`（manifest 缺 key）2 例 + `asset-unreadable` 1 例 | 3 例 | 转换层**前置校验**：资产成员缺失/不可读 → 转换期显式 gap，而不是产物运行期才炸 |
| **E5** | `compound-transform` 1 例 | ArchDetail | **由 H11 解决** |
| — | `extrude-zero-vector` 1、`dep-module-revolve` 2、`no-geometry` 3 | — | 前两者按 H4/H8 归因；`no-geometry` 属正确行为 |

---

## 6. faijs 侧交付与归属（C3）

- **H1–H12 的实现全部在 `packages/core/src/`**（`fcstd/` + `api/`），每项先写失败测试再实现。
- **公开面**：读层 `@faicad/faijs/fcstd`、转换层 `@faicad/faijs/fcstd-convert`（CLI `faijs-fcstd-convert`）已落地，快照 12 子路径；本轮不新增子路径，新增的是 `cad` 命名空间里的三个 op（须重跑 `gen-api-dts.ts` / `gen-ops-api-inventory.ts`，并受 `op-set-consistency.test.ts` 三源一致约束）。
- **脚本归属（沿用 09-19 方案 §5.4）**：`packages/core/scripts/` 下能在 CI 跑的落成 `*.test.ts`；依赖语料/人工输入的迁出到 `fcstd-port/tools/`。faijs 侧出现 `FreeCAD-library` 相关脚本一律视为越界。
- **测试归属（沿用 §5.4 二次确认）**：依赖外部语料的 6 个测试与 3 个 `.FCStd` 样本在 `fcstd-port/test/FreeCAD/`；faijs 内只保留合成 fixture 的单元测试。
- **版本发布**：`docs/plans/2026-09-19-npm-publish-plan.md` 为准；过渡期 fcstd-port 经 tgz 消费（`file:../faijs/packages/core/faicad-faijs-<ver>.tgz`，现为 0.13.2 待发布），**换 tgz 必须重装**。

---

## 7. 批量项目（`D:/Faicad/fcstd-port`）：3,201 全量

C4 之下，批量项目的职责是**忠实地暴露失败**，不是吸收失败。

| 项 | 设计 | 状态 |
|---|---|---|
| 单文件转换 | 消费发布的 CLI：`faijs-fcstd-convert <in.FCStd> [out.fai.zip]` | ✅ |
| 批量驱动 | 扫描 3,201（`.FCStd1` 备份跳过）、每文件子进程隔离 WASM 崩溃、**串行为主**（用户铁律；`--concurrency` 上限 4）、每文件硬超时 120 s 可调 | ❌ **B2 待办** |
| 断点 | `state/progress.json` 记逐文件状态 + faijs 版本；重跑只补上一轮 gap/failed（Q4） | ❌ |
| 三态 | `ok`（0）/ `gap`（2，翻译缺口，不产包）/ `failed`（内部错误/超时）。**没有「baked-only = ok」这种状态** | ❌ |
| 终检 | 每个成功产物校验 `mapping.json` disposition ∈ {`translated`, `python-baked`, `preserved-only`} | ❌ |
| 报表 | 文件级 reason 分桶（**不是对象级**）：决定「补哪一项能让多少个文件从 gap 变 ok」 | ❌ |
| 抽样验收 | ≥20 个产物 `check` + `run --mode brep` 导出 STEP（入口：`@faicad/faijs/node` 的 `cliCheck`/`cliRun`，**tgz 里没有 `check`/`run` 子命令**） | ❌ |

### 7.1 阶段进展

| 阶段 | 内容 | 状态 |
|---|---|---|
| **B0** | faijs P0 硬骨头（H1–H3）+ CLI | ✅ 基本完成（H2 剩 3 类、H3 曲线/面附着未做） |
| **B1** | 批量骨架 + 全库画像 | 🟡 画像 ✅、批量骨架 ❌ |
| **B2** | 全量试跑，暴露文件级 reason 分布 | ❌ **下一个必做**（见 §9） |
| **B3** | 硬骨头迭代（每轮小批量复测） | ❌ |
| **B4** | 全量 + 抽样验收 | ❌ |

---

## 8. 验收判据

| 编号 | 判据 | 归属 |
|---|---|---|
| V-C1 | 翻译完备：3,201 文件要么成功（mapping 仅含三种 disposition），要么带结构化 reason 进 gap/failed；**不存在静默烘焙** | faijs 内核 + 批量终检 |
| V-C2 | 草图完备：全部草图 L0，或每条 L1/L2 有成因结论 | faijs 内核 |
| V-C3 | 产物可执行：抽样 ≥20 个产物 `check` 零错误、`run --mode brep` 导出 STEP 成功。**基线（56 样本全部 50 产物）：36 能跑 / 14 失败 → 目标 50/0** | 批量项目 |
| V-C4 | 影子保真：`freecad/` 子树 sha256 逐成员全等 | faijs 内核 |
| V-C5 | 断点续跑 + 可追溯（faijs 版本、逐文件状态、reason 分布） | 批量项目 |
| V-C6 | Python 例外如实：`python-baked` 100% 是 `PropertyPythonObject` 本体或其 Python 依赖，无搭车 | faijs 内核 |
| **V-C7** | **产物零编辑器 op（C5 的判据）**：全部产物的 callee 集合 ⊆ 平台 op 集；脚本级静态守卫 + 语料级普查（编辑器 op 计数 **914 → 0**） | faijs 内核 |
| **V-C8** | **非实体一等（C6 的判据）**：零实体资产（56 样本 170/302）可导入、可放置、可聚合；对其做布尔时得到**带 op 名与 cause 的显式错误**，而非 OCCT 裸文本 | faijs 内核 |

---

## 9. 实施顺序

### P0（先做，不可跳过）

1. ✅ **H11：平台三个 op 落地**——实发名 `cad.import_brep` / `cad.compound` / `cad.place`（方案原写 `cad.asset`，落地时改名）；含四元数→矩阵标定测试、非实体放行测试、mesh 路径测试。
2. ✅ **翻译层切换**（§4.7 清单）+ **删除 `allowNonSolid` 与 `brepTextHasSolid`**（§4.6）+ 守卫测试改为「借用点归零 + callee ⊆ 平台 op 集」。
3. **ArchDetail 复跑**：目标是越过 s652。越过后再跑一次 56 样本执行侧普查，用实测数据刷新 §3.6（预期落到 E1/E2/E3/E4）。
4. **E1/E3/E4**：导出返回结构化错误、导入资产建 roleTable、资产缺失前置 gap。E2（线框显示）可后置。

### P1（P0 之后，按收益排序）

5. **B2 全量试跑**（3,201）——**排序的唯一依据是文件级 reason 分布**；在拿到它之前不排 H7 的攻坚顺序。
6. **H7 头部类型**：`Part::Feature`(1,359 已做) → Part 工作台特征系（`Part::Revolution/Fillet/Chamfer`，注意与 PartDesign **同名异构**）→ `PartDesign::Groove`(726) → 扫掠/放样/螺旋系(455，内核 op 补齐) → `App::Link*`(149) → 镜像系(461) → 跨引用系(150) → 布尔系(96)。
7. **H6 非常量表达式**(16,277 条)——参数化零件库的刚需，与 H7 穿插推进。
8. **H3 曲线/Frenet/面支撑**、**H4 尾部 8 条 bake 分支**、**H2 补 15/17/19**、**H8 弧线投影**。
9. **R-CH 的几何静默降级**（`ArcOfEllipse`/`BSpline`/`Hyperbola`/`Parabola` → NaN → L2）：要么实现 B 样条/椭圆弧轮廓，要么改为**显式 gap**。**不允许继续静默 L2**（见 Q10）。

---

## 10. 风险登记

| 编号 | 风险 | 影响 | 对策 |
|---|---|---|---|
| R-CI | **平台 op 面切换期产物漂移**：`cad.load`→`cad.asset`、`group`→`compound`、两条变换→`place` 会让既有产物**逐字节变化**，golden 断言全量失效 | 中 | 一次性切换 + 重生成 golden；切换窗口内不与其它翻译改动混提（一个提交只做一件事） |
| R-CJ | 新 op 命名与既有 `group`/`load` 语义易混（`compound` vs `group`、`asset` vs `load`） | 中 | 命名在 Q8 拍板后写进 `docs/api-contract.md`；`cad.group`/`cad.load` 的 JSDoc 补「编辑器 op，平台请用 `cad.compound`/`cad.asset`」的反向指引 |
| R-CK | `located` 的矩阵约定（行/列主序）标定错误会导致**全部放置静默错位** | 高 | 先写标定测试（已知 Placement 的样本 → 变换后 bbox 逐轴比对），再接线；禁止凭记忆 |
| R-CL | 非实体子形参与布尔时错误信息是 OCCT 裸文本（`boolean operation failed`） | 中 | 在平台 op 边界包一层：带 op 名 + 输入资产名 + cause 的显式错误（V-C8） |
| R-CM | 3,201 全量时长未知 | 低 | 画像实测全库只读遍历 105.8 s；批量串行 + 硬超时，支持分目录分批 |
| R-CN | 「不允许回退」在损坏文件上客观不可达成 | 低 | 判 `failed` 并如实报告不算违背 C4（C4 约束 faijs 能力，不约束数据完好性）；画像实测 3,201 文件 0 失败 |

> 09-19 方案的 R-CA/R-CB/R-CC/R-CE/R-CG 仍有效，未变；R-CD（Draft/装配语义映射争议）并入 Q9。

---

## 11. 待拍板

| 编号 | 问题 | 建议 |
|---|---|---|
| **Q8** | 三个新 op 的命名 | **已定（用户拍板）**：`cad.import_brep` / `cad.compound` / `cad.place` —— 即取下方备选，未采用本栏倾向的 `cad.asset`（`locate` 亦未采用） |
| **Q9** | `cad.place` 是否也吸收 `Part::Mirroring`、sweep 定向等后续需求，还是各自独立 op | 先只做「刚体放置」；镜像等按需另立 op（避免一个 op 承载多种几何语义） |
| **Q10** | B 样条/椭圆弧轮廓：实现，还是改判显式 gap | 倾向**实现**（1,630 条/24 文件不算长尾），但要先看 B2 的文件级数据；在实现前**不允许静默 L2** |
| **Q11** | 3,201 全量产物的存放（本地磁盘 / 是否入库） | 产物不入库（体积大）；报表与状态入库，产物留 `out/`（gitignore） |
| **Q12** | `.FCStd1` 备份（102 个）与多 Body 文档的产物组织是否维持现口径 | 维持 Q1（跳过）与「每 Body 一模块 + `main.fai.js` 聚合」 |

---

## 12. 本轮不改动的既有结论（避免重复劳动）

- 09-19 方案的 §1（用户要求原文）、§2（三态 disposition 口径）、§4（全库画像，含数字口径写进产物 `definitions`）、§5.2（读层/转换层公开面）、§5.3（发布移交 npm-publish-plan）、§5.4（脚本与测试归属）、§6（批量项目骨架设计表）、§7（V-C1–V-C6）、§8 的 R-CA/R-CB/R-CC/R-CE/R-CG、§9 的 Q1–Q7 拍板结果 —— **全部继续有效**。
- 本文与之冲突的部分只有两处：**§3 的进度口径**（本文 §3 为准）与 **§10 的实施顺序**（本文 §9 为准），另外本文新增 C5/C6/C7 三条约束与 V-C7/V-C8 两条判据。
