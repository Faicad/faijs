> 方案出处：DeepSeek-V4.1-Flash + WorkBuddy　·　日期：2026-10-08

# faijs 装配层级 + 多格式导出的统一架构方案

有几个方向性的要求：
1. 建模和导出时，支持层级结构，颜色，材质等。这些应该是不分brep/mesh, 不分step/3mf的通用需求，不能在这一层暴露底层的xcaf的内容。
2. 如果某一个几何内核如brepkit不支持xcaf，那么导出的时候，能力自动降级，不要报错。
3. 能力表是一个临时的设计，甚至从来没有真正发挥作用。你需要去调研是否还保留。目前似乎只需要根据engine申明，静态切换能力。比如如果不是occt engine，则不支持很多能力。
4. 目前3d_editor项目并不是通过faijs脚本实现导出的。脚本层面导出和库api层面导出，是什么关系？
5. 如果是脚本层面支持导出，则涉及到文件操作，在host里如何处理？
6. 多个支持装配层级的api到底如何整合，各自有哪些使用场合。
7. XCAF似乎是底层功能，不需要在faijs层面暴露？

请完整思考这个问题，写一份全新的方案，写在新的文件里。不要改老文件。

## 0. 摘要

本方案回答七个方向性问题，并给出最终架构。核心结论先行：

1. **层级 / 颜色 / 材质是 faijs 通用模型层的需求**，必须建在 `Shape` / `CompoundShape`（纯数据，不分 brep/mesh）之上，**不与任何具体导出格式耦合，更不暴露 occt 的 XCAF**。
2. **导出能力降级是确定性的、静态的、不报错的**：引擎不支持 XCAF（如 brepkit）→ 装配自动降级为平铺零件；颜色/材质是 per-shape 数据，降级后仍然保留。
3. **能力表是引擎在源码里写死的内核函数自述，与"按 engine 切换"无关，也没有任何协商**：`defineOp` 上有两根**正交**的静态声明轴——`capabilities`（op 要哪些内核函数 / 引擎提供哪些内核函数，静态求交）与 `engines`（op 能跑在哪些引擎上，平台身份白名单）。二者都在执行前判定完，运行期只读一份既成事实。导出层**不新增任何能力位**——"引擎能否写 XCAF 装配树"已由现有声明（族级布尔 `assembly` + 逐核真名 `createXCAFDocument`，仅 occt 声明）如实表达。
4. **faijs 脚本层目前没有导出 op**；导出是宿主（3d_editor）经指令驱动的库 API 调用。脚本只负责"建模 + 标注（层级/颜色/材质）"，真正的文件写出由 host 完成。
5. **多套装配 API 收敛为单一内核装配模型**：用户面 = `cad.group` / `cad.assembly`（产出 `CompoundShape`）；运动学面 = `AssemblyNode`（求解/机构分析）；导入面 = XCAF 导入树归一为 `CompoundShape`。三者以 `CompoundShape` 为唯一真源。
6. **XCAF 是 occt 引擎适配器的内部实现细节，faijs 公开面不暴露**。公开面只有"装配模型" + "与格式/引擎无关的导出函数"。

---

## 一、七个方向性问题的调研与答复

### 1. 层级 / 颜色 / 材质应是通用需求，不暴露 XCAF

**现状已具备一半。** faijs 的 `Shape`（`packages/core/src/mesh/types.ts:48`）本身就是纯数据 mesh 契约，已携带：

- `appearance?: PbrAppearance` —— 形状级 PBR 外观（sRGB 0–1，可序列化）
- `materialGroups?` —— 面级外观分组（Phase 2）
- `vertexColors?` —— 顶点色（3MF colorgroup / 面级 mesh 链）
- `meta?: ShapeMeta` —— 零件级说明性元数据（名称/描述/料号/自定义键）

`CompoundShape`（`packages/core/src/shape.ts`，`kind:'compound', children:Shape[]`）已是纯数据结构，天然可以承载**层级**（children 递归）+ **名称**（node name）+ **transform**（成员位姿）。`cad.assembly` 的 `memberColors` 已把颜色挂到成员上（`packages/faijs-extra/src/ops/compound.ts:45`）。

**缺口**：这些信息目前没有统一的"装配模型"语义封装，且导出时颜色/材质/层级各自为政（STEP 走 XCAF、3MF 走 basematerials、STL 走纯顶点烘焙）。

**方案**：把"层级 / 颜色 / 材质 / transform"正式定义为 `CompoundShape`（或它的语义别名 `AssemblyModel`）的一等属性，作为 faijs 通用模型层的契约。导出函数从 `AssemblyModel` 读取这些属性，分别翻译成各格式的对应表达。XCAF 只在 occt 适配器内部出现，faijs 公开 API 永不出现 `XCAFDocument` / `addShape` / `addChild` / `label`。

### 2. 内核不支持 XCAF（如 brepkit）时导出自动降级，不报错

**现状**：brepkit 适配器能力表 `assembly: false`（`packages/core/src/brep/engine/adapters/brepkit.ts:129`），它指的就是"不能写/读 XCAF 装配树"。3d_editor 的 weapp 宿主注入 `host.exportStepFilePerSolid`（`packages/platform/src/weapp/faijs.worker.ts:139`），逐实体 `kernel.exportStep` 打 zip；层级信息在此时丢失。

**方案**：降级必须是**确定性 + 静态 + 不报错**的（与 `backend-dispatch` 的 auto 降级哲学一致，红线：不运行时 try-catch 回退）。判据不是任何"协商出来的能力位"，而是**执行前就已固定的静态事实**（装配了哪个引擎 + 该引擎源码里自述了什么，见 §3）：

- 事实为"有 XCAF 通道"（occt）：STEP 写真装配树——XCAF 写 component/location/label/color。
- 事实为"无 XCAF 通道"（brepkit）：STEP 自动降级——逐实体 `kernel.exportStep` 拼 zip，文件名取自 `CompoundShape` 成员名；层级丢失，颜色/材质若引擎能承载则保留，否则落到 per-part。
- STL 与引擎无关：展平 `CompoundShape`，成员 transform 烘焙进顶点后拼接，单文件（二进制 STL 不支持多实体，多实体则 zip）。
- **仅在用户显式要求"必须保留层级"且引擎不支持时，才抛出明确的 `AssemblyLevelUnsupportedError`**；默认行为是静默降级（降级后 `ExportResponse.degraded = true` 回传主线程，供 UI 提示，但不阻断）。

（3MF 的 `<components>` 层级**不由引擎门控**——它是纯 XML，只要写出器实现了就能写；详见 §3.2。）

颜色/材质不受降级影响：它们是 `Shape` 自带数据，STEP 降级走 per-part color、3MF 走 basematerials/colorgroup、STL 走顶点色，都不依赖 XCAF。

### 3. 能力表是什么——两根正交的静态声明轴，与"按引擎切换"无关，也没有协商

**先纠两个概念错误。**

**错误一：把"按引擎切换"当成能力表。** 二者是**正交的两根声明轴**，在 `defineOp` 里是两个彼此独立的字段（`packages/core/src/define-op.ts:114` / `:127`；装配校验处注释明确写"两者是正交的两轴"，`define-op.ts:569-576`）：

| 轴 | 字段 | 声明方 | 回答的问题 |
|---|---|---|---|
| **内核能力** | `capabilities: BrepCapabilityName[]`（op 侧）+ `BrepCapabilities`（引擎侧） | op 与引擎**各声明一半** | 这个 op **要哪些内核函数**；这个引擎**提供哪些内核函数** |
| **引擎身份** | `engines: BrepEngineId[]` | 仅 op 声明（引擎白名单） | 这个 op **能跑在哪些引擎上** |

`engines` 是平台身份白名单（D11），**不属于能力表**——全仓 100 处 `engines: ['occt']` 就是它的用法。判定次序是引擎身份在先、能力门在后（`backend-dispatch.ts:292` 的 D11-2 注释："引擎不匹配时谈能力没有意义"），`decidePath` 里两段是分开的代码（身份分支 `:298`，能力分支 `:330`/`:340`）。把"非 occt 就不支持 XCAF"说成能力表语义，是把第二根轴塞进了第一根轴。

**错误二：以为存在一个"协商层"。** 没有。能力表是引擎**在源码里写死的自述**，不是运行期的议价或探测：

- **引擎侧 = 适配器源码里的常量**（`packages/core/src/brep/engine/adapters/occt.ts:169` / `brepkit.ts:40`）：`evolution: ['fuseWithHistory', …]`（逐核函数名）、`methods: ['cut', 'makeCylinder', …]`（逐核方法名）、族级布尔 `heal`/`directEdit`/`advSurface`/`assembly`/`meshLift`，以及 `exact`/`brepExport`/`exactMeasurement`/`tessellationModel`。**这些值在写适配器那一刻就定死了**，没有一处来自运行时探测。
- **op 侧 = `defineOp.capabilities`**（`['directEdit']` / `['fuseWithHistory']` / `['makeCylinder','located','getBoundingBox','cut']` …）。
- **判定 = 求交**：`engineCapabilitySet(引擎声明)`（`backend-dispatch.ts:94`）与 `op.capabilities` 求交，取第一个缺口（`firstMissingCapability` `:115`），在执行前决定 brep/mesh 路径（`decidePath` `:274`）。缺能力：brep 模式明确报错，auto 模式静态降级 mesh——都不试探、不回退。
- **注册一次、冻结、只读**：注册表只在宿主装配期注册一次并冻结（`registry.ts:55` `freezeEngineRegistries`，冻结后任何注册尝试抛错），运行期只读。所以"这个引擎具备哪些能力"在**任何实现跑起来之前**就是一个常量。

⇒ **一切能力在写代码那一刻就是绝对的，运行时只是读这份既成事实。** 没有探测、没有议价、没有"先试再退"——没有协商。

**结论**：

- 能力表**保留**，语义是"op 静态声明的需求集 ∩ 引擎静态自述的提供集"。**不要往里塞"按引擎切换"这类身份信息**——那是 `engines` 轴的事。
- **导出层不新增任何能力位**。"引擎能不能写 XCAF 装配树"已由现有声明如实表达：族级布尔 `assembly`（`occt.ts:177` = `true` / `brepkit.ts:129` = `false`）+ 逐核真名 `createXCAFDocument` / `importXCAFFromSTEP`（只出现在 `occt.ts:131-132` 的 `methods`，brepkit 不声明）。再加一个 `xcafAssembly` 是冗余的第二真源，还把身份问题伪装成能力问题。

### 4. 3d_editor 不是通过 faijs 脚本导出；脚本导出 vs 库 API 导出的关系

**调研事实**：

- faijs 脚本层面**没有导出 op**。`packages/core/src/api/api-namespace.ts` 里的 `exportStl` / `exportBrep` 是**库函数**（供宿主调用），不是用户在设计脚本里写的设计语言 op。`grep` 整个 `api/` 与 `faijs-extra/` 无任何 `defineOp` 名为 export。用户在 faijs 脚本里只做建模（`box` / `union` / `cad.assembly` ...），产出 `Shape` / `CompoundShape`。
- 导出真实路径是 **宿主指令驱动**：
  - 3d_editor 主线程构造 `ExportInstruction`（`packages/platform/src/execution/protocol.ts:465`），含 `entries`（partName + brep handle / mesh + name + color）。
  - worker 内 `dispatchExport`（`packages/platform/src/execution/instruction-core.ts:230`）基于与主线程一致的 ctx，把 entries 喂给 faijs 库 API：
    - occt/electron：`host.exportStepSolids = exportStepFromSolidsHighLevel`（`execution-process.ts:210`）
    - brepkit/weapp：`host.exportStepFilePerSolid`（`faijs.worker.ts:139`）逐实体通道
  - 产出的字节（`ArrayBuffer` / 文件数组）经 `ExportResponse` 回传主线程，host 落盘（electron 用 Node `fs`，weapp 用微信文件系统）。

**关系界定**：

- **库 API 导出（现状，推荐保留）**：faijs 提供与格式/引擎无关的 `exportStepFromSolids` / `exportModelSync(3mf/stl)` / 高层的 `exportStepFromSolidsHighLevel`。宿主负责"决定导出什么、把字节落盘"。faijs 不碰文件系统。
- **脚本层导出（目前不存在）**：若未来要让用户在 faijs 设计脚本里写 `cad.export(model, 'step')`，则必须解决文件 IO 不在 worker 的问题（见 §5）。

> 建议：**导出始终是宿主指令驱动，不要做成 faijs 脚本 op。** 脚本的职责收敛为"建模 + 标注装配层级/颜色/材质"，导出由宿主读取这些标注后调用库 API。这避免了 worker 内文件 IO，也与平台红线（BREP 句柄不出 worker）一致。

### 5. 若支持脚本层导出，文件操作在 host 里如何处理

（本节仅讨论"如果要做"的边界；默认按 §4 不实现脚本导出。）

若引入脚本级 `cad.export(model, format, opts)`：

- **worker 内只产字节，不落盘**：`cad.export` 在 worker 内调 `exportDocument` 得到 `ArrayBuffer`（或通过 `host` 桥把字节回传）。
- **宿主桥接落盘**：worker runtime 暴露一个受控 host 能力，例如 `host.saveExportedFile(fileName, bytes)` 或导出结果作为语句返回值经 `ExecutionResult` 回主线程，由主线程调平台文件 API（electron `fs.promises.writeFile` / weapp `wx.getFileSystemManager().writeFile`）。
- **路径策略由 host 决定**：沙箱不允许脚本自定任意路径；脚本最多传"建议文件名 + 格式"，真实落盘路径（用户下载目录 / 项目目录）由宿主按平台策略定（与现有 `url-policy` / 文件落盘逻辑一致）。
- **红线**：faijs worker 内部**绝不 import `fs` 或平台文件 API**；文件操作一律经 host 桥，与现有 `exportStepFilePerSolid` 的 host 注入模式同构。

> 现状已正确：faijs 内核 `step.ts` / `export-model.ts` 只返回 `ArrayBuffer`，落盘全在 3d_editor 平台层。保持即可。

### 6. 多套装配 API 如何整合，各自使用场合

**现状（确实存在多套）**：

| # | 概念 | 位置 | 形态 | 使用场合 |
|---|------|------|------|----------|
| 1 | `cad.group` | faijs-extra `compound.ts:164` | `CompoundShape`（零约束结构容器） | 用户把若干零件**纯结构分组**（无约束），编辑器消费面 |
| 2 | `cad.assembly` | faijs-extra `compound.ts:202` | `CompoundShape` + `AssemblyBehavior`（约束+`solve`） | 用户做**约束装配**（mate/align/距离/角度），求解后烘焙位姿，编辑器消费面 |
| 3 | `cad.compound` | core `makeCompound` | 平台复合体（brepkit 下是 *virtual compound*） | 内核几何复合，被 `cad.group/assembly` 复用为底层容器 |
| 4 | `cad.copy` | faijs-extra `copy.ts` | 深拷贝 `Shape` | 实例化/复用几何 |
| 5 | `api/assembly/*` | core `api/assembly/` | 约束求解内核（lower/solve/pose/joints） | `cad.assembly` 的内核；被运动学/机构复用 |
| 6 | `AssemblyNode` | core `api/assembly/solvers/assembly-tree.ts` | 纯数据装配树（带 `joints`/`mates`/`translate`/`rotate`） | **运动学 / 机构分析**（joints-kinematics、buildKinematicTree）；被 `arg-spec.ts` 标 `skip`，不向宿主公开 |
| 7 | XCAF 导入树 | core `occtKernel.importAssemblyFromStep` → `ImportAssemblyNode` | 导入时 OCCT label/component/location/color | 外部 STEP 装配读入，经 `load.ts` 归一 |
| 8 | `StepExportEntry[]` | `brep/export/step.ts` | 平铺导出形态（逐 solid/mesh + name + color） | 导出入口，无层级 |

**整合原则**：

- **单一真源 = `CompoundShape`**（纯数据 `children:Shape[]` + name + transform + appearance + meta）。它是所有装配层级的统一载体。
  - `cad.group` / `cad.assembly` 直接产出它；`cad.compound` 是它的底层同构。
  - XCAF 导入树（`ImportAssemblyNode`）在 `load.ts` 里**归一化为 `CompoundShape`**（children 即导入的各 part），与用户建模的装配同构。
- **`AssemblyNode` 保留为运动学专用**：它带 `joints`/`mates`，是 `CompoundShape` 之上做机构分析/求解的输入形态。建议 `cad.assembly` 的 `solve()` 结果能**直接投影回 `CompoundShape` 的每成员 transform**（而不是另存一份树），保证"求解后的装配"仍然是 `CompoundShape`，导出时同源。
- **`StepExportEntry[]` 退化为内部桥**：导出函数吃 `CompoundShape`，内部展平/提取成 `StepExportEntry[]` / `ExportEntry[]` 交给底层字节生成器；用户与宿主都不应直接构造 `StepExportEntry[]`。
- **明确边界**：用户永远只接触 `cad.group` / `cad.assembly`；运动学脚本接触 `AssemblyNode`（且经 `cad.mechanismDOF` / `cad.inverseKinematics` 查询函数，不直接暴露 `createAssemblyNode`）；导入经 `cad.load`；导出经宿主指令（§4）。

### 7. XCAF 似乎不需要在 faijs 暴露——确认：是的

**结论**：XCAF 是 occt 引擎把"层级 + 颜色 + 材质"翻译成 STEP 的**内部实现手段**，faijs 公开 API 不应暴露它。

- faijs 公开面只有：`AssemblyModel`（`CompoundShape` 语义）+ `exportDocument(model, format)`。
- occt 适配器（`packages/core/src/brep/engine/adapters/occt.ts`）内部持有 `createXCAFDocument` / `addShape` / `addChild` / `exportSTEP`，把 `AssemblyModel` 翻译成 XCAF 树。这些 API 留在适配器层，不进入 faijs 的 `browser.ts` / `api/` 导出面。
- 好处：brepkit 引擎根本不需要知道 XCAF 的存在——它只实现 `kernel.exportStep`（平铺）与 mesh 字节生成；"是否写真装配树"完全由 occt 适配器在内部决定，对上层透明。

---

## 二、目标架构：通用装配模型（不分 brep/mesh、不分格式）

```
用户脚本 (faijs)                宿主 (3d_editor)
  cad.group / cad.assembly  ──产出──▶  AssemblyModel (CompoundShape)
  cad.load(STEP)            ──归一──▶  (children:Shape[], name, transform,
                                        appearance, meta, material)
                                              │
                              exportDocument(model, format)
                              [按执行前已固定的静态事实选定路径]
                                              │
              ┌───────────────┬───────────────┴───────────────┐
           format='step'   format='3mf'                   format='stl'
              │               │                              │
      occt: XCAF 装配树   写出器直接写 <components>      任意链: 展平烘焙顶点
      brepkit: 逐实体zip  (与引擎无关，纯 XML)          (单文件/多实体 zip)
      (降级不报错)                                          (层级压平，几何正确)
              │               │                              │
         字节(bytes) ──────▶  ExportResponse ──────▶  host 落盘 (fs / 微信文件系统)
```

**`AssemblyModel` 契约（建在现有 `CompoundShape` 之上，纯数据）**：

- `children: AssemblyModel[]` —— 递归层级（替代手写 SceneNode）
- `shape?: Shape` —— 叶子节点的几何（纯 mesh 数据，brep/mesh 双链路通用）
- `name: string` —— 零件/子装配名（导出 STEP 的 label name、3MF item name）
- `transform?: { translate?: Vec3; rotate?: { angle; axis? }; matrix?: number[] }` —— 成员位姿（导出 location / 3MF transform）
- `appearance?: PbrAppearance` —— 颜色（已存在于 Shape，可上提到节点级）
- `material?: MaterialMeta` —— 材质（料号/密度/自定义；3MF basematerials / STEP 扩展属性）
- `meta?: ShapeMeta` —— 说明性元数据（名称/描述/料号/自定义键）

> 这正是你要求的"内核装配树"——**不是 UI 场景树**。UI 的 scene tree 由 3d_editor 自己从 `AssemblyModel` 镜像生成，faijs 内核不感知 UI。

---

## 三、导出路径的静态确定（不协商、不新增能力位）

导出**不是 op**：`exportStepFromSolids` / `exportModel(Sync)` 是库函数，没有 `capabilities` / `engines` 声明字段，不进 `dispatchPath`。它"降级"的依据只有**两条在执行前就已固定的事实**：

1. **宿主装配期装配了哪个引擎**——`registry.getActiveBrepEngineId()` / 运行时配置 `brepEngineId`，注册后冻结、运行期只读；
2. **该引擎源码里自述的能力**——`BrepCapabilities`（同上，常量）。

### 3.1 "引擎能否写真装配树"已由现有声明回答，不新增字段

- STEP 的真装配树需要 XCAF，这是 **occt-only 平台面**：`exportStepFromSolids` 文件级标注 `@platform occt` 并直接 `getOcctKernel()`（`packages/core/src/brep/export/step.ts:4`、`:70`）；brepkit 没有这条通道，宿主给它注入的是 `host.exportStepFilePerSolid`（逐实体 zip）。
- 现有能力表已如实表达这件事：族级布尔 `assembly`（occt `true` / brepkit `false`）+ 逐核真名 `createXCAFDocument`/`importXCAFFromSTEP`（仅 occt 的 `methods` 声明）。
- ⇒ **不加 `xcafAssembly`**。加它等于在 `assembly` 族位之外再造一个同义的第二真源，并把"引擎身份"混进能力名空间（§一.3 错误一）。

### 3.2 分层：哪些格式真被引擎门控

一个容易混的点：**"装配层级"在各格式里的载体不同，被门控的方式也不同**。

| 格式 | 层级的载体 | 被什么门控 |
|---|---|---|
| STEP | XCAF component/location/label | **引擎身份**——只有 occt 有 XCAF 通道 |
| 3MF | `<components>`（纯 XML，网格模型） | **写出器实现**，与引擎无关（mesh XML，brepkit 链一样能写） |
| STL | 无 | 无——格式本身没有装配概念，只能展平 |

所以"brepkit 下 3MF 也降级"是不成立的：3MF 的 `<components>` 只取决于写出器有没有实现（当前 `exportModelSync` 的 3MF 分支走 `build3mfModelXml`，是纯 XML、不吃内核），不取决于引擎。

### 3.3 STEP 的降级（不报错）

| 引擎（静态事实） | 行为 | 层级 | 颜色/材质 | 报错？ |
|---|---|---|---|---|
| occt（有 XCAF 通道） | XCAF 写 component/location/label/color | 真装配树 | XCAF color + 元数据 | 否 |
| brepkit（无 XCAF 通道） | 逐实体 `kernel.exportStep` 打 zip | 丢失 | per-part color（引擎支持则） | 否（除非用户强制层级） |

颜色/材质不受降级影响：它们是 `Shape` 自带数据（`appearance` / `materialGroups` / `vertexColors` / `meta`），STEP 降级走 per-part color、3MF 走 basematerials/colorgroup、STL 走顶点色，都不依赖 XCAF。

**降级信号**：`ExportResponse` 增加 `degraded?: { reason: 'assembly-level-unsupported'; format: string }`，供 UI 提示"当前引擎不支持装配层级，已降级为平铺"，但不阻断导出。

**红线**：路径由**执行前读到的静态事实**决定；不做运行时探测、不做 try-catch 回退、不伪造层级（不把平铺零件假装成 component）。

---

## 四、落地步骤（建议顺序）

1. **定义 `AssemblyModel` 语义层**：在 `shape.ts` 给 `CompoundShape` 补 `transform` / `material` / 上移 `appearance` 到节点级，并加一个类型别名 `AssemblyModel = CompoundShape`（不动既有导出，仅扩展契约）。补单测：构造带层级+颜色+材质的 model，断言字段可序列化。
2. **统一导入归一**：`load.ts` 把 `ImportAssemblyNode` 归一为 `AssemblyModel`（而非中间结构），保证导入装配与用户装配同源。
3. **确认现有声明已够用，不新增能力位**：STEP 走 XCAF 是 occt 平台面（`exportStepFromSolids` 已 `@platform occt`，occt 已声明 `assembly: true` / `createXCAFDocument`），brepkit 走逐实体 zip——不需要 `xcafAssembly` 之类的第二真源。
4. **实现 `exportDocument(model, format)`**：
   - STEP：occt 走 XCAF（`addChild(location)` 写真树）；brepkit 走逐实体 zip（复用 `exportStepFilePerSolid` 语义）。
   - 3MF：实现 `components` 层级（当前 `exportModelSync` 仅 basematerials 平铺，需补 components）。
   - STL：展平烘焙（已有，补多实体 zip）。
   - 内部把 `AssemblyModel` 展平/提取为既有 `StepExportEntry[]` / `ExportEntry[]`，复用字节生成器。
5. **收敛 `cad.assembly.solve()` 投影**：求解结果写回 `AssemblyModel` 各成员 `transform`，保证求解后仍可直接导出，且 `AssemblyNode` 只作为求解/机构分析的中间形态。
6. **3d_editor 收口**：`dispatchExport` 改为先构造 `AssemblyModel`（从 ctx 结果 + entries 标注），再调 `exportDocument`；`exportDocument` 内部按执行前已固定的静态事实（引擎身份 + 已声明能力）吸收 `exportStepSolids` / `exportStepFilePerSolid` 的差异，host 只保留"产出单文件 vs 多文件数组"的落盘差异。
7. **降级单测**：occt 与 brepkit 两套引擎下分别跑"带层级装配 → 导出"，断言 occt 产真树、brepkit 产平铺且不抛错、颜色/材质在两种路径都保留。

---

## 五、红线 / 约束（沿用既有，新增导出相关）

- **BREP 句柄不出 worker**：faijs 内核导出只产字节（`ArrayBuffer`），落盘全在 host。
- **绝不 fuse / 绝不布尔合并导出实体**：导出零 fuse（既有 `exportStepFromSolids` 已遵守）。
- **降级不报错、不伪造层级**：能力缺失 → 静态平铺；用户强制层级且不支持 → 才明确报错。
- **不文本级改几何**：STEP/STL/3MF 字节由各自生成器产生，不靠字符串拼接几何。
- **XCAF 不越界**：faijs 公开面零 XCAF API；XCAF 仅 occt 适配器内部使用。
- **单一真源**：所有装配层级最终都收敛为 `AssemblyModel`（`CompoundShape`），不维护第二套树（运动学 `AssemblyNode` 仅作分析中间态，可投影回 `AssemblyModel`）。
