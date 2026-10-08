> 方案出处：DeepSeek-V4.1-Flash + WorkBuddy　·　日期：2026-10-08　·　状态：方案（未实施）

# faijs 装配层级与多格式导出：架构与验证方案

## 0. 摘要

1. 层级、名称、颜色、材质、位姿是模型层需求，载体是 `Shape` 与 `CompoundShape`（纯数据，不分 brep/mesh）。导出函数从模型读这些属性，各自翻译成目标格式的表达；XCAF 只在 occt 适配器内部出现，不进 faijs 公开面。
2. op 元数据的声明轴只有两根且正交：`engines`（BREP 引擎身份白名单）与 `meshEngines`（网格实体后端门禁）；`capabilities` 这条轴已从 `defineOp` 删除，不存在"保留与否"的问题，仓内也没有任何能力协商层。宿主环境（`hostEnv`）不在这两根里——它声明在宿主端口装配期，不进 op 元数据（§2.5）。
3. 装配层级在三种格式里的载体不同，被门控的方式也不同：STEP 靠 XCAF（occt 平台面），3MF 靠 `<components>`（纯 XML，与引擎无关），STL 无载体（只能展平烘焙）。
4. 导出有两个调用面：脚本面 `cad.exportStl` / `cad.exportBrep`（返回纯数据；现状只有这两个格式，本方案补齐 `cad.exportStep` / `cad.export3mf`，第 2.6 节），库面 `exportModel(Sync)` / `exportStepFromSolids*`（返回字节）。脚本面补齐后两面共用同一序列化器（单一真源），层级装配的完整通道仍在库面。
5. 文件写出永远在宿主。faijs 只产字节或文本，worker 内不 import fs。
6. 据此，导出**命令**（`cad.exportStl` / `cad.exportBrep`）只在 node 宿主开放；browser 与 weapp 宿主执行即报 `E_HOST_UNSUPPORTED`。宿主环境由 `HostPorts.hostEnv` 在装配期声明一次，与引擎身份正交（第 2.5 节）。理由是脚本可由 AI 生成任意代码、属不受信输入，而导出把「往哪写、写几份、写什么」的决定权交给脚本文本（第 1.8、2.5 节）：**浏览器里要导出模型，只能由宿主提供的入口触发**（用户点的按钮，或宿主自己调用的 API），faijs 脚本面不提供这条出口。
7. 装配相关概念收敛到 `CompoundShape` 单一真源；`AssemblyNode` 与装配求解只作分析中间态。
8. 本方案的验收以第 3 节的矩阵为准，每个格子的期望值写成断言而不是描述；已知缺陷按"当前值 + 应有值"双值钉住（第 4.8 节）。

## 0.1 决策记录

本方案的设计口径来自以下拍板（均为 2026-10-08）。依据列逐字引用，不改写、不归纳。

| # | 决策 | 依据（逐字） | 落点 |
|---|---|---|---|
| DEC-1 | 导出命令只在 node 宿主开放；browser 下禁用，执行即报错 | 「只有在no的环境下才允许在脚本里执行导出命令，如果是在浏览器环境下这这个命令是禁用的，执执行的话要报错」 | §2.5 |
| DEC-2 | 该决策的理由：`.fai.js` 是 AI 可生成的任意代码，安全级别要求更高，浏览器里危险；浏览器里要导出模型必须走宿主提供的按钮或 API，faijs 不提供 | 「把理由说上，因为FaI JS脚本是可以由AI生成任意代码的，安全性级别要求更高，而且在浏览器里危险，所以如果在浏览器里要导出模型，必须走宿主供供的按钮啊，或者ApPI接口，F AIjs不提供」 | §1.8、§2.5 |
| DEC-3 | 脚本面必须补齐 step / 3mf 导出；当前没有就实现 | 「脚本面的导出只有`cad.exportStl` / `cad.exportBrep` 这两个吗？应该还有step/3mf导出呀，如果目前没有，那么要实现呀」 | §2.6 |
| DEC-4 | 脚本 op 与库面 API 不构成冲突，不采用「实现体改名」规避 | 「脚本 op 的实现体导出名用 exportStepText？ 没有道理啊。脚本的op和库层面的api，应该不会冲突啊」 | §2.6「库面边界」段 |
| DEC-5 | 重申既有层级决策：库使用者不使用聚合 API，按需直连子路径 | 「我记得层级有个决策。库的使用者不使用聚合的api，自己想调用什么就直接去子路径」 | §2.7（现行依据：`docs/api-contract.zh.md:63`、`:70`、`packages/core/src/sdk.ts:17`） |
| DEC-6 | 库面公开的判据 = 库作者是否需要，不需要的都删除；「导出面 ⊇ cad 面」这条门禁可以删除 | 「你判断的标准时库的作者是否需要，不需要的东西，都删除。这个门禁我认为可以删除」 | §2.7 |
| DEC-7 | `api/index.ts` 里为门禁而存在的无用导出都删除（例：实现 cad 的那批）；该门禁本身也删除 | 「api/index.ts 是 L3 API 面， 为了门禁而存在的无用的导出都删除，比如实现cad的那批。那个门禁本身也删除。」 | §2.7 |
| DEC-8 | `scripts/gen-ops-api-inventory.ts` 标记为 deprecated，并从所有测试 / 门禁中摘除（`doc-sync` 的 `--check` 步、`packages/core/src/lang/ops-inventory-coverage.test.ts`）；未来删除该生成器 | 「这个gen-ops-api-inventory.ts本身就很可疑。把它从任何测试中拿掉，并标记为deprecated。我认为未来要删除它。」 | §2.6 连带门禁表、§5 第 2 步 |

尚未拍板（本方案按注明的口径暂定，实施前需确认）：

| # | 待定项 | 本方案暂定口径 |
|---|---|---|
| OPEN-1 | electron 主进程宿主的 `hostEnv` 取值 | 按 Node.js 进程算 → `'node'`，脚本在其上仍可执行导出命令（§2.5 末） |

## 1. 现状（以当前源码为准）

### 1.1 声明轴

| 字段 | 位置 | 语义 | 判定点 |
|---|---|---|---|
| `engines?: readonly BrepEngineId[]` | `packages/core/src/define-op.ts:124` | 平台 op 自证引擎身份（白名单） | `packages/core/src/cad-runtime/backend-dispatch.ts:221-226` |
| `meshEngines?: readonly string[]` | `packages/core/src/define-op.ts:136`、`:179` | 网格实体后端的门禁名 | 同上（另一轴，与引擎身份正交） |
| `capabilities` | 不存在 | —— | —— |
| `hostEnv`（宿主环境） | 不存在 | —— | —— |

`capabilities` 标识符在 `define-op.ts` 全文已无出现；`backend-dispatch.ts:139` 写明 op 元数据里 `engines` 是**唯一**收窄轴（宿主环境轴不走 `dispatchPath`）。防回引的守卫测试已存在：`packages/core/test/brep/engine/engine-switch-declaration.test.ts:91-97`（`DUAL_OP_META 不含 capabilities 字段`）。

引擎身份枚举是固定三值：`BREP_ENGINE_IDS = ['occt', 'brepkit', 'brep_mock']`（`packages/core/src/brep/engine/types.ts:21`）。引擎适配器只有 id 与 primitives 两个字段，没有能力声明：`adapters/occt.ts:34-37`；`adapters/brepkit.ts:30` 注释直接写明「没有能力声明表」。逐核函数可用性按引擎 id 记在 `packages/core/src/brep/engine/native-history.ts`（`adapters/brepkit.ts:31` 引用）。引擎注册表在装配后冻结、运行期只读：`registry.ts:53`、`:62-64`，活动引擎查询 `getActiveBrepEngineId()`（`registry.ts:155`）。

结论：「某个引擎能不能写 XCAF 装配树」由引擎身份回答，导出层不新增任何引擎能力声明位。宿主环境是另一根正交轴，声明在端口装配期（§2.5），不是 op 的能力声明。

### 1.2 模型层

层级载体已经存在：`CompoundShape = { kind: 'compound', children: Shape[] }`（`packages/core/src/shape.ts:37-40`），`compound()` 构造器在 `:323`。

`Shape` 的可选数据字段（`packages/core/src/mesh/types.ts`）：

| 字段 | 位置 | 内容 |
|---|---|---|
| `appearance?: PbrAppearance` | `:52` | 形状级 PBR 外观 |
| `materialGroups?` | `:54` | 面级外观分组（三角形区间 + 外观） |
| `vertexColors?: Float32Array` | `:56` | 顶点色 |
| `meta?: ShapeMeta` | `:64` | 名称、描述、料号、自定义键 |

装配成员的颜色目前只以入参形式存在：`assembly` op 的 `memberColors`（`packages/faijs-extra/src/ops/compound.ts:45`），位姿以求解结果 `AssemblyTransform[]` 表达（同文件 `:98`）。`Shape` 上没有 `transform` 字段。

### 1.3 导出面

| 面 | 入口 | 函数 | 格式 | 引擎约束 | 宿主约束（现状） |
|---|---|---|---|---|---|
| 库（环境无关） | `@faicad/faijs/export`（`packages/core/package.json:33-36` → `dist/brep/export/export-model.js`） | `exportModel`（`export-model.ts:516`）、`exportModelSync`（`:440`）、`readDeclaredUnit`（`:606`） | stl / step / 3mf | step 分支实际走 occt（§1.5） | 无（宿主字节通道） |
| 库（occt 平台） | `@faicad/faijs/brep/export/step`；另经 `src/index.ts:39`、`:168`、`src/browser.ts:69` 导出 | `exportStepFromSolids`（`brep/export/step.ts:61`）、`exportStepFromSolid`（`:159`）、`exportStepFromSolidsHighLevel`（`occt-kernel/highLevelApi.ts:215`） | step | 文件级 `@platform occt`（`step.ts:4`），内部 `getOcctKernel()`（`:70`） | 无 |
| 脚本（`cad` 命名空间） | 符号表 `packages/core/src/lang/symbol-table.generated.ts:52-53` | `cad.exportStl`（`api/export-stl.ts:118`，返回 `Uint8Array` 或 string）、`cad.exportBrep`（`api/export-brep.ts:60`，返回 string） | stl / brep（step、3mf 无出口，§2.6 补齐） | `exportStl` 中立（不触达内核）；`exportBrep` 走 `assertEngineFor('exportBrep', ['occt'])`（`export-brep.ts:32`） | 无——node / browser / weapp 三种宿主都可执行（本方案改为 node-only，§2.5） |

导出条目 `ExportEntry`（`export-model.ts:29-48`）是平铺结构：`{ solid | mesh, name, color, materialGroups, meta }`。没有 `children`，没有 `transform`。层级信息在进入导出之前就已经不存在。

脚本面的导出命令就是两个：`exportStl`（`lang/symbol-table.generated.ts:52`）、`exportBrep`（`:53`）——没有 `cad.exportStep` / `cad.export3mf` / `cad.exportModel`；`@group 导出` 分组同样只有这两个（`api/export-stl.ts:101`、`api/export-brep.ts:46`）。而脚本面**导入**侧有两个：`import_brep`（`:109`）、`import_step`（`:110`），即现状是「能导入 STEP、不能导出 STEP」的不对称。视图族 `toSVG` / `toMultiviewSVG` / `toPNG` / `toMultiviewPNG`（`:62-65`，`@group 视图`，`api/view-export/index.ts`）产出渲染图，不是导出命令，不混计。库面没有 brep 文本出口。

L1 契约的 `── IO ──` 段**有** STEP 导出成员：`exportStep(shape): string`（`brep/engine/primitives.ts:283`），occt（`occt-kernel/occt-primitives.ts:467`）与 brepkit（`brepkit-kernel/brepkitKernel.ts:1392`，原生返回 UTF-8 字节、适配器解码）两侧均已实现，`brep-mock.ts:419` 亦有桩。缺的只是 BREP 文本导出（`fromBREP` 有、`toBREP` 无）——`api/export-brep.ts:4-5` 的注释称 L1 契约「只有 fromBREP 导入侧、没有导出成员」，与该事实不符，属注释陈旧。brepkit 的 wasm 面另有原生 `export3mf(solid, deflection)`（`brepkit-kernel/_test-kernels/brepkit-2.129.15/package/brepkit_wasm.d.ts:517`、`4.0.32` 的 `:496`），但**未接进适配器**（`brepkitKernel.ts` 全文无 `export3mf`）；faijs 自己的 3MF 写出器是纯 XML + ZIP（`export-model.ts:319-418`、`:500-502`），与引擎无关。

### 1.4 写出层（格式 × 层级载体）

STEP 写侧：`exportStepFromSolids` 对每个 entry 调 `doc.addShape(...)`（`brep/export/step.ts:125`）；compound 先被 `getSubShapes` 展平成多个 sub 并改名为 `name [n]`（`step.ts:93-116`）。XCAF 句柄槽 `BrepXcafDocument`（`brep/engine/types.ts:202-206`）只有 `addShape` / `exportSTEP` / `close` 三个成员，没有 `addChild`。写侧产出的是多个平级 PRODUCT，没有装配结构。

3MF 写侧：`build3mfModelXml`（`export-model.ts:319-418`）写 `<resources>`（basematerials + object）与 `<build><item>`，object 内容是 `<mesh>`，没有 `<components>`。读侧 `parseThreemf` 支持 components 递归，既有用例在 `packages/core/test/mesh/threemf-archive.test.ts:188-280`（含嵌套复合顺序断言 `:225`）。

STL 写侧：多 mesh 的顶点合并成一个三角形 soup（`export-model.ts:451-468`、`:533-560`）；格式本身无对象概念。

单位不变式：声明单位与坐标刻度由同一次换算产出（`export-model.ts:509`、`:530-531`），回读检查函数 `readDeclaredUnit`（`:606`）。

### 1.5 STEP 的引擎归属

`exportModelSync` 与 `exportModel` 的 step 分支取内核走 `getBrepApi()`（`export-model.ts:471`、`:566`），随后调 `exportStepFromSolids`，后者直接取 `getOcctKernel()`（`step.ts:70`）。

`getOcctKernel` 是 `getKernel` 的别名（`occt-kernel/occtKernel.ts:196`）；内核未初始化时抛 `'occt-wasm kernel not initialized — call initOcctWasm() first'`（`occtKernel.ts:185-188`）。

该 step 分支没有引擎身份断言，与 `cad.exportBrep` 的显式 `assertEngineFor('exportBrep', ['occt'])`（`export-brep.ts:32`）不对称。小程序入口只装配 brepkit（`packages/core/src/weapp.ts:23`、`:26`、`:29`、`:41`），没有 occt 装配路径。

### 1.6 宿主与调用链

faijs 侧：CLI 的 `writeOutput`（`packages/core/src/node-host/cli.ts:729`）→ `exportModelSync`（`:761`）→ `writeFileSync`（`:762`）。内核导出只产字节，落盘在宿主。

3d_editor 侧：主线程构造 `ExportInstruction{ code, entries, opts, fileMeta }`（`packages/3d_editor/packages/platform/src/execution/protocol.ts:465-473`）；worker 的 `dispatchExport`（`packages/platform/src/execution/instruction-core.ts:230`）按引擎走两条通道——occt/electron 用 `@faicad/faijs/browser` 的 `exportStepFromSolidsHighLevel`（`instruction-core.ts:74`、`packages/platform/src/electron/execution-process.ts:211`）；brepkit/weapp 用 `exportStepFilePerSolid`（`packages/platform/src/weapp/faijs.worker.ts:139`，逐实体 `kernel.exportStep` 见 `:155`，zip 由主线程完成）。

### 1.7 宿主环境

`HostPorts`（`cad-runtime/ports.ts:243-254`）是宿主注入的环境能力集合，除 `events` 外全部可选，**没有任何宿主身份字段**；`ports.ts` 全文无 host-kind / env / platform 字段，仓内也不存在 host 判定函数。

运行期的环境探测只出现在内核装载器：`typeof process !== 'undefined' && process.versions?.node`（`occt-kernel/occtKernel.ts:155`、`brepkit-kernel/brepkitWasm.ts:85`），用途是选择 wasm 的装载通道（node fs 还是 fetch），不是 API 层判据。

因此现状是：`cad.exportStl` / `cad.exportBrep` 在 node CLI、browser worker、weapp worker 三种宿主下**都可执行**。`exportStl` 更是文档声明的「中立 op」——它只读 Shape 自带的三角载荷（`api/export-stl.ts:34-45`），不读任何环境事实。

已存在的「执行前断言」只有引擎身份一条：`assertEngineFor`（`api/internal/l3-bridge.ts:109-118`）读 `getBackends().config.brepEngineId`（`runtime-state.ts:50-55`），与 op 元数据的 `engines` 轴配对。宿主环境没有对应的断言位。

### 1.8 脚本的可信前提

`.fai.js` 脚本是**可由 AI 生成任意代码**的文本，属不受信输入。仓内既有的安全立场就建立在这个前提上：

| 事实 | 位置 |
|---|---|
| 静态安全扫描（`.fai.js` 静态安全门禁）定位为「纵深防御第一层」；判定模型 = 能力黑名单 + 危险语法 + 危险成员名 + 自由标识符白名单 + 结构上限 + 命名空间保护 | `lang/security-scanner.ts:1-15`、`:26-34` |
| S1 能力黑名单引用即拒：`eval` / `Function`、`globalThis` / `window` / `self` / `parent`、`process` / `require` / `module`、`fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `navigator`、`document` / `location` / `cookie` / `localStorage` / `caches`、`importScripts` / `Worker` / `WebAssembly` | `:88-105` |
| S4 白名单切断能力来源（免 import 的裸标识符只有 `Math` / `JSON` / `Date` / `Map` / `Set` / `console` / 单位常量等） | `:151-165`、`isSafeGlobalIdent` `:186` |
| 明确承认边界：**静态门禁 ≠ 沙箱**——拦不住属性名拼接（`g['ev'+'al']`）、字符串内代码、已获引用二次调用；靠 S4 切断能力来源使残留失去立足点，但不宣称等价隔离 | `:12-14`（D9） |
| 策略档位（`strict` / `balanced` / `off`）是**运行期选项**，缺省 `strict`；`balanced` 的适用场景是本机 CLI，`off` 是受控调试；`off` 下扫描直接早退返回 `ok: true` | `:23-24`、`cad-runtime/runtime.ts:538`、`security-scanner.ts:267-269`、`:307-309` |

结论：**脚本可信度不能由静态扫描承担**——扫描能被档位放宽、也自认不是沙箱。能力面是否开放必须由 API 侧自证，这是第 2.5 节宿主环境轴存在的前提（DEC-1、DEC-2）。

## 2. 目标契约

### 2.1 装配模型 = 节点属性，单一真源

导出可见的装配模型就是 `Shape` / `CompoundShape` 本身，不引入平行树。字段与导出映射：

| 节点字段 | 来源 | STEP 映射 | 3MF 映射 | STL 映射 |
|---|---|---|---|---|
| `children: Shape[]` | `shape.ts:39` | 多 PRODUCT + 装配引用 | `<components><component>` | 展平拼接 |
| `name` | `ShapeMeta.name`（`mesh/types.ts:64`） | XCAF label name | `<object name>` | `solid <name>`（ASCII 形态） |
| `appearance` | `mesh/types.ts:52` | XCAF color（sRGB→linear，`step.ts:118-122`） | object 级 `pid`/`pindex` | 无载体 |
| `materialGroups` | `mesh/types.ts:54` | per-part color | 逐三角形 `pid`（`export-model.ts:336-358`） | 无载体 |
| `meta` | `mesh/types.ts:64` | PRODUCT name | `<metadatagroup>`（`export-model.ts:365-388`） | 无载体 |
| `transform` | 新增 | XCAF location | `<component transform>` | 顶点烘焙 |

`transform` 是唯一需要新增的字段，落点取「`Shape` 的可选字段」方案：`transform?: { translate?: Vec3; rotate?: { angle: number; axis?: Vec3 }; matrix?: number[] }`，与 `appearance` / `meta` 同为可序列化纯数据。替代方案是把装配节点做成与 `Shape` 平行的 `AssemblyNode` 树，但那会在同一层级引入两套节点类型与两套遍历，导出必须处理「本节点是 Shape 还是 AssemblyNode」的分叉。

`transform` 的写入方有两个，都写回同一字段：导入侧（XCAF location / 3MF component transform），求解侧（`AssemblyTransform[]`，`faijs-extra/src/ops/compound.ts:98`）。导出只读它。

### 2.2 XCAF 的边界

XCAF 是 occt 适配器把装配模型翻译成 STEP 的内部手段。公开面只有装配模型与导出函数；`BrepXcafDocument` 槽留在 `brep/engine/types.ts`，不进 `browser.ts` / `api/` 的导出名单。3MF 与 STL 写出器不感知 XCAF。brepkit 适配器不需要知道 XCAF 存在。

### 2.3 格式 × 引擎：静态确定

| 格式 | 层级载体 | 门控方 | occt | brepkit |
|---|---|---|---|---|
| stl | 无 | 无 | 展平烘焙 | 同一路径（纯 mesh，无引擎分支） |
| 3mf | `<components>` | 写出器 | 写 components | 写 components（同一写出器，与引擎无关） |
| step | XCAF label / location | 引擎身份 | XCAF 写层级 | 无 XCAF 通道 → 逐实体通道 |

判据是装配期就已固定的事实：`getActiveBrepEngineId()`（`registry.ts:155`）在注册表冻结后（`registry.ts:64`）不再变化；宿主环境同理，`HostPorts.hostEnv` 在装配期写入后不再变化（§2.5）。不做运行期探测，不做 try-catch 回退。

brepkit 下的 STEP 走逐实体通道（3d_editor weapp 的 `exportStepFilePerSolid` 形态），层级丢失，颜色与材质按 per-part 保留。库面 `exportModel(entries, 'step')` 在非 occt 引擎下，必须在触碰任何句柄之前报出 `E_BREP_UNSUPPORTED` 并带上当前引擎名，与 `export-brep.ts:32` 的断言同构；不得落入 `getOcctKernel()` 的未初始化异常，也不得把 brepkit 句柄交给 occt 内核（`brep/engine/types.ts:6-7` 规定句柄不得跨引擎传递）。

降级信号：`ExportResponse` 携带层级丢失标记（格式 + 原因），供 UI 提示，不阻断导出。

### 2.4 两个调用面的分工

| 面 | 返回值 | 格式 | 文件写出 | 可用宿主 |
|---|---|---|---|---|
| 脚本面 `cad.*` | 纯数据（字节 / 文本） | stl、brep（现状）+ step、3mf（§2.6 补齐） | 宿主 | 仅 node（§2.5） |
| 库面 `@faicad/faijs/export` 等 | 字节 | stl、step、3mf | 宿主 | 全部 |

层级装配的导出走库面：它是层级、颜色、材质与位姿的完整通道。脚本面负责建模与标注，它的 step / 3mf 出口是库面序列化器的薄壳（§2.6），不另起一条写出通道。在 browser / weapp 宿主下库面也是唯一的导出通路——因为脚本面被 §2.5 关闭，导出只能由宿主入口发起。边界仍是「worker 内只产字节、宿主落盘」，参照 `node-host/cli.ts:761-762`；faijs 内核不得 import fs。

### 2.5 宿主环境轴：导出命令仅 node（DEC-1、DEC-2）

**为什么这条轴存在**（DEC-2 的理由）。前提见 §1.8：脚本是 AI 生成的任意代码，静态扫描只是第一层、且自认不是沙箱。导出是脚本能触碰的**后果最重**的一类能力——它把几何数据从内核交到脚本文本手里，宿主侧最终落到一次用户可见的落盘动作（下载 / 保存 / 剪贴板）。若这个动作能由脚本文本触发，「往哪写、写几份、写什么」的决定权就归了不受信代码：

- 浏览器里是敏感面：页面内脚本发起下载正是 CSP、用户手势要求与 drive-by download 防护所针对的模式，而导出的往往就是用户自己的模型数据。
- 因此**浏览器里要导出模型，必须由宿主提供的入口触发**——用户点的按钮，或宿主自己调用的 API（即 §2.4 的库面字节通道）；faijs 的脚本面不提供这条出口。
- node 宿主（本机 CLI，即 `balanced` 档的适用场景，`security-scanner.ts:23`）里落盘发生在用户自己的机器上，不构成跨域外泄，因此开放。
- weapp 与 browser 同口径拒绝：小程序里的落盘同样是宿主能力的范畴，决定权留在宿主入口上。

**本轴与安全档位解耦**：门禁只读 `config.hostEnv`，不读 `securityPolicy`。即使档位被放宽到 `balanced` / `off`（`scanSource` 在 `off` 下直接早退为 `ok: true`，`security-scanner.ts:267-269`），`hostEnv != 'node'` 下导出命令仍必须拒绝（§3 B11）——档位只回答「静态扫描放宽到哪」，不回答「API 能力面开放到哪」，后者由本轴单独回答。

**轴的定义**。宿主环境 = 执行脚本的那个宿主进程。三值，一值一入口：

| `hostEnv` | 宿主 | 装配点 |
|---|---|---|
| `'node'` | Node.js 进程（CLI、进程内嵌） | `@faicad/faijs/node`；`createNodePorts()`（`node-host/index.ts:63`，返回字面量 `:78-84`） |
| `'browser'` | web 页面 / web worker | `@faicad/faijs/browser`；`createBrowserPorts()`（`browser-host/index.ts:83`，返回字面量 `:123-131`） |
| `'weapp'` | 小程序 worker（无 occt，只有 brepkit） | `@faicad/faijs/weapp`；宿主手工装配 ports（3d_editor `packages/platform/src/weapp/worker-ports.ts:119` `buildWeappPorts`） |

**声明一处**：`HostPorts.hostEnv?: HostEnv`（`cad-runtime/ports.ts:243`），宿主装配期写入一次，运行期不再探测环境——`typeof process` 那类判断只留在内核装载器（§1.7）。字段保持可选而**不**设为必填：`HostPorts` 是公开类型（`src/browser.ts:34`、`src/index.ts:142` 导出），设必填会把「与本次需求无关的机械改动」压到仓内 test 侧近百处直接拼 `HostPorts`（多数只给 `events`）的装配点上；把它按可选 + 读取端 fail-closed 处理，效果等价于必填（漏声明 = 拒绝），代价只落在真正调用导出命令的那几处。

**传递**：`claimBackends()`（`runtime.ts:576-611`）把端口事实发布成 getter，`config` 新增 `get hostEnv() { return portsOf().hostEnv }`（与 `mode` / `brepEngineId` 同位，`runtime.ts:581-589`；类型位在 `runtime-state.ts:50-55`）。

**断言**：`assertHostFor(opName, hosts)` 落在 `api/internal/l3-bridge.ts`，与 `assertEngineFor`（`:109-118`）并列：读 `config.hostEnv`，不在白名单即抛 `HostUnsupportedError`，消息 `E_HOST_UNSUPPORTED: op 'exportStl' requires host node (current=browser)`。错误类定义在 `runtime-state.ts`（与 `BrepUnsupportedError:121`、`MeshUnsupportedError:141` 同级：零依赖，API 面与引擎共享同一类以便 `instanceof`）。

两个导出 op 的第一行调用它：

- `api/export-stl.ts`：函数体第一行（在 `meshOf` 之前）——browser 下不论输入如何都先报宿主错误；
- `api/export-brep.ts`：在既有 `assertEngineFor('exportBrep', ['occt'])`（`:32`）**之前**——顺序固定为宿主门 → 引擎门。

门禁只能写在函数体内：这两个 op 是普通函数，不走 `dispatchPath`（论证见 `export-brep.ts:12-14`）。将来若新增的脚本面导出 op 是 `defineOp`，其实现体同样第一行调用 `assertHostFor`。

**缺失声明 = 非 node**：`hostEnv` 未声明 → `current=<none>` → 拒绝；不设默认值兜底（与 `getBackends()` 同口径，`runtime-state.ts:392-395`）。仓内既有装配点清单见 §5 第 1 步。

**门禁地图**：

| 宿主声明 | `cad.exportStl` | `cad.exportBrep` | `cad.exportStep` | `cad.export3mf` | 字节通道函数（`exportModel(Sync)` / `exportStepFromSolids*` / `buildStlBufferFromMesh`） |
|---|---|---|---|---|---|
| `'node'` | 可执行 | 可执行（仍需 occt 引擎，§2.3） | 可执行（需 occt，§2.6） | 可执行 | 可执行 |
| `'browser'` | `E_HOST_UNSUPPORTED` | `E_HOST_UNSUPPORTED`（宿主门先于引擎门） | `E_HOST_UNSUPPORTED`（门序同前） | `E_HOST_UNSUPPORTED` | 可执行 |
| `'weapp'` | `E_HOST_UNSUPPORTED` | `E_HOST_UNSUPPORTED` | `E_HOST_UNSUPPORTED` | `E_HOST_UNSUPPORTED` | 可执行 |
| 未声明 | `E_HOST_UNSUPPORTED` | `E_HOST_UNSUPPORTED` | `E_HOST_UNSUPPORTED` | `E_HOST_UNSUPPORTED` | 可执行 |

**门禁点与宿主字节通道**。门禁点在两个 op 的函数本体，所以同名的库面出口（`api/index.ts:52-53` → `src/browser.ts:238` 的 re-export）被同一门禁覆盖（矩阵 B9）——不存在「脚本面被拒、TS 直连同一个函数却放行」的旁路。宿主自己产字节走的是另外几个函数（`export-model.ts:516`/`:440`、`brep/export/step.ts:61`/`:159`、`brep/export/stl.ts`）：它们不是导出命令，是宿主的字节通道，不受 `hostEnv` 约束，3d_editor 的 worker 导出链（§1.6）用的正是这几个——也就是「浏览器里由宿主提供的 API 触发导出」的那条通路。

**轴的正交性**：`hostEnv`（宿主环境，装配期声明）× `engines` / `meshEngines`（引擎身份，op 元数据）× `mode`（执行模式，宿主装配）三者独立。四个导出命令都是宿主门在前；引擎门上 `exportStl` / `export3mf` 中立，`exportBrep` / `exportStep` 需 occt。

**范围**：本轴拦四个导出命令符号（`exportStl` / `exportBrep` / `exportStep` / `export3mf`）。视图族 `toSVG` / `toPNG`（`api-namespace.ts:163-164`）不属于导出命令，不纳入；若纳入，按同一断言加一行。

**跨工作区声明清单**（3d_editor 侧，改动落在那个工作区）：

| 装配点 | 声明 | 方式 |
|---|---|---|
| `platform/src/web/worker-ports.ts:150` | `'browser'` | 经 `createBrowserPorts({...})` 自动继承 |
| `app/src/engine/host/index.ts:120` | `'browser'` | 包装 faijs 的 `createBrowserPorts` → 自动继承 |
| `platform/src/weapp/worker-ports.ts:119` | `'weapp'` | 手工装配 → 显式声明 |
| `platform/src/electron/execution-process.ts:129` | `'node'` | 基于 `createNodePorts()` → 继承 |

electron 主进程宿主是 Node.js 进程，按「运行在 node 环境」的口径继承 `'node'`，脚本在其上仍可执行导出命令；若要收紧为「只有 CLI 这类纯 node 宿主放行」，则该处显式声明第四个值并列入禁用。

### 2.6 脚本面的 step / 3mf 出口（DEC-3）

§1.3 的现状是脚本面只有 `exportStl` / `exportBrep` 两个导出命令，step 与 3mf 只有库面有出口，且导入侧却有 `import_step`——能力不对称。本节把两个缺口补成正式契约。

| op | 返回 | 序列化真源 | 引擎门 | 宿主门 |
|---|---|---|---|---|
| `cad.exportStep(shape, options?)` | string（P21 文本） | `exportModelSync([...], 'step', options)`（`export-model.ts:440`，step 分支 `:470-498`） | occt 必需（装配层级走 XCAF，§2.3） | 仅 node（§2.5） |
| `cad.export3mf(shape, options?)` | `Uint8Array`（ZIP 字节） | `exportModelSync([...], '3mf', options)`（3mf 分支 `:500-502`） | 中立（`build3mfModelXml` 纯 XML + ZIP，与引擎无关） | 仅 node（§2.5） |

**四条定式**：

1. **薄壳 + 门禁，不重写格式逻辑**。op 本体只做四件事：宿主门（`assertHostFor`）→ 引擎门（仅 `exportStep`）→ 把入参转成 `ExportEntry[]`（`export-model.ts:29-48`）→ 调库面序列化器。脚本面与库面因此天然字节一致（矩阵 B12、B14），单位声明与坐标刻度的成对不变式（`export-model.ts:509`）由库面统一保证，不需要在 op 里复刻。
2. **门序固定**：宿主门 → 引擎门（`exportStep` 走 `assertEngineFor('exportStep', ['occt'])`，与 `export-brep.ts:32` 同构）→ 实现体。`export3mf` 无引擎门，只有宿主门。
3. **入参形态与既有 op 同构**。`cad.exportStl` 收单个 `Shape`（`export-stl.ts:118`），两个新 op 同样收 `Shape`；`CompoundShape` 也是 `Shape`（§2.1），所以 `cad.exportStep(compound)` 就是层级导出的脚本面入口。compound → 多实体的形状转换有现成先例：`node-host/cli.ts#writeAssemblyStep`（`:773-855`）按 `behavior.memberNames` / `memberColors` 逐成员取**活句柄**（`brepOf(child)`，`:813`，注释标明 `brepSolids` 快照对已变换成员是陈旧的）拼 `StepExportEntry[]`。该函数直接调 `exportStepFromSolids` 因而绕过单位 / header 改写；新 op 必须走 `exportModelSync` 以继承单位成对写出。
4. **条目按格式分派，不能只给 `solid`**。三个写出器的吃法不同：step 吃 `solid`（保留精确 BREP 拓扑，缺则用 `mesh` 重建，`step.ts:83`）；STL 只吃 `mesh`，无 mesh 条目直接抛 `[export/stl] no mesh entries`（`export-model.ts:453`）；3MF 更危险——`build3mfModelXml` 对无 `mesh` 的条目**静默跳过**（`:330` `if (!e.mesh) return`），只给 `solid` 会产出「ZIP 合法但对象为空」的假成功。所以两个新 op 的条目构造照 `cli.ts#writeOutput`（`:744-758`）的口径：step 给 `solid`，3mf 先用 `solidToShape`（`brep/brep-ops.ts:57`）三角化再给 `mesh`。空装配显式报错，不落空文件（对齐 `export-stl.ts:41-43` 的 `E_EXPORT_STL_EMPTY` 口径）。

**单位口径**。`ExportOptions.unit`（`export-model.ts:57-67`）语义是「文件里声明的单位」，实现负责换算刻度并与声明成对写出；而 `cad.exportStl` 的既有口径是「不做缩放、一律 mm 写出，换算归宿主」（`export-stl.ts:121-122`）。两者不冲突但不同层，故新 op 的 `options` 只放 `unit`（透传库面，缺省 `mm`）：step 侧落在 `rewriteStepUnitEntities`（`:89`）、3mf 侧落在 `<model unit>` 与 `UNIT_NAME_TO_3MF`（`:70`，yard 无枚举值 → 库面已回落 mm）。**不改 `exportStl` 的既有语义**——它的 mm 口径是与宿主导出链一致的有意设计。

**库面边界**（DEC-4、DEC-6）。两个新 op 只进脚本面（`createApiNamespace()` 键 + `check()` 符号表），**不经 `api/index.ts` 平铺**——判据、要删的守卫与连带改动见 §2.7。因此实现体导出名与 `cad` 键名同名即可：`api/export-step.ts` 导出 `exportStep`、`api/export-3mf.ts` 导出 `export3mf`。库面已有一个同名函数 `exportStep`（`occt-kernel/highLevelApi.ts:179`，`(shape: Shape, options?) => string`，走 `meshesToStep`，经 `src/browser.ts:69` 显式导出），但两者**不在同一符号空间**（脚本 op 只经 `api-namespace.ts` 到 `cad.*`），不构成同名问题。

**连带门禁**（新增 op 会同时触发，落地步骤见 §5）：

| 门禁 | 触发点 |
|---|---|
| 符号表再生成 | `packages/core/scripts/gen-symbol-table.ts`（先跑 `gen-l3-surface.ts`）→ `src/lang/symbol-table.generated.ts` |
| 手册逐 op 章节 | **已停用（DEC-8）**：`gen-ops-api-inventory.ts` 摘出 `doc-sync`，覆盖守卫 `src/lang/ops-inventory-coverage.test.ts` 删除（它本就不被任何 vitest project 匹配）。`docs/ops-api-inventory.md` / `.zh.md` 自此为陈旧残留，不再随 op 变更重生成 |
| 公开面快照 | `scripts/api-surface-snapshot.mjs`（`scripts/ci.ps1:181`）：本批因 §2.7 的边界改动（脚本面 op 不再平铺）而更新 |
| 导出面测试覆盖 | `scripts/check-api-test-coverage.ts --package=core`（`scripts/ci.ps1:202`）：新增源码导出必须有测试 |
| 导出 JSDoc 规范 | `scripts/verify-export-jsdoc.ts`（`doc-sync` 链内）：`@group 导出` 等标注齐全 |

### 2.7 脚本 op 与库面导出面的边界（DEC-5、DEC-6、DEC-7）

**判据**（DEC-6）：库面公开什么，只看**库的作者是否需要**。脚本 op 是 `.fai.js` 的能力；库作者要的几何与 IO 函数走细粒度子路径（`docs/api-contract.zh.md:63` 的 `/sdk` 是"库作者唯一应依赖的入口"、`:70` 的细粒度子路径"供库作者按需导入"；`packages/core/src/sdk.ts:17`）。「脚本面有」不构成「库面必须有」的理由。

**据此删除的守卫**（DEC-6、DEC-7）。仓内把"三源一致"写作「导出面 ≡ cad 面 ≡ check() 符号表」（`packages/core/scripts/gen-l3-surface.ts:292`、`src/api/generated/script-face-manifest.ts:4`），其中「cad 面 ⊆ 导出面」由三条断言强制：

| 断言 | 位置 | 处置 |
|---|---|---|
| cad 命名空间每个键都被 `api/index.ts` 导出 | `packages/core/test/lang/op-set-consistency.test.ts:84-88` | 删除（门禁本体） |
| cad 面每个键都能在根门面 `@faicad/faijs` 顶层取到 | `packages/tests/faijs/p23-cad-face/p23-cad-face.test.ts:76-80` | 删除 |
| `SCRIPT_FACE_OPS` 每个 op 都能在根门面顶层取到（并带 dual-op 元数据） | `packages/tests/faijs/p23-cad-face/p23-cad-face.test.ts:82-91` | 拆开：**保留** dual-op 元数据那半（在那个对象上取），**删除**「必须在 facade 顶层」那半（`:85` 的 `expect(fn).toBeDefined()` 改从 `createApiNamespace()` 取） |

删除后"三源"降为**两源**：`check()` 符号表 ≡ cad 命名空间键集（`op-set-consistency.test.ts:42-50` 的双向断言保留）；`p23-cad-face.test.ts:70-74`（符号表 ≡ cad 键集）保留。cad 面仍由 `api-namespace.ts` 自带 `...scriptFaceOps` 展开（`op-set-consistency.test.ts:12-14` 注释），删平铺不影响脚本面可用性。

**连带改动**：

| 对象 | 位置 | 改动 |
|---|---|---|
| `export * from './generated/script-face'` | `src/api/index.ts:124` | **取消通配、改具名清单**——按名裁定后只留库作者在用的（见下），不是整条删掉 |
| 生成器注释"`api-namespace.ts` 与 `api/index.ts` 都从这里取" | `packages/core/scripts/gen-l3-surface.ts:248`、`:264` | 收窄为 `api-namespace.ts`（与取键的 `gen-symbol-table.ts`） |
| "三源一致：导出面 ≡ cad 面 ≡ 符号表" | `gen-l3-surface.ts:292`、`src/api/generated/script-face-manifest.ts:4` | 改为两源 |
| 主导出 `export * from './api'` 的说明注释 | `src/index.ts:235` | 同步措辞 |
| "硬门禁要求必须导出"式注释 | `src/api/index.ts:78-84`（`boolean`）等 | 依据已删，同步措辞 |

**对调用面的后果**。库面聚合面与根门面不再承接**脚本面专属**的 op（有库作者消费者的按名保留，见下）。`hostEnv` 门禁（§2.5）仍作用在 op 函数本体上，所以经**子路径**（`@faicad/faijs/api/*`）直连同一函数时依旧被拒——矩阵 B9 的判据不变，取用路径由聚合面换成子路径。

**为门禁而存在的无用导出（DEC-7）：按名裁定，不能整批删**。先要看清 `api/index.ts` 是**两个入口的同一实体**：

| 入口 | 映射 | 消费者 |
|---|---|---|
| `@faicad/faijs`（根门面） | `src/index.ts:239` 的 `export * from './api'` | 3d_editor 明令禁止 app 从这里取（`contract-entry.test.ts:337-349` 要求走 `/browser`）；仓内实际只取类型与框架符号（`createRuntime` / `registerOcctBrepEngine` / `BrepHandle` / `ok`…） |
| `@faicad/faijs/api` | `packages/core/package.json` 的 `./api` → `dist/api/index.js`，即 `src/api/index.ts` | **库作者**（`docs/api-contract.zh.md:70` 的"供库作者按需导入"）：`sheetmetal` 与 `sketch` 两个包大量从此导入 |

所以四类内容里，「脚本面 op 整批进桶」这一类**不能整条删**——`SCRIPT_FACE_OPS` 那 40 条里有真实库作者消费者，且正是经 `@faicad/faijs/api` 这个库作者入口：

| 名字 | 消费者 | 说明 |
|---|---|---|
| `isValid` | `sheetmetal/src/validateFns.ts:3`、`src/internal.ts:2`、`src/foldFns.ts:1` 等 | **唯一库面来源**就是本批：`api/brep-topology.ts` 故意不含它，`api/index.ts:158` 注释自证「isValid 不在此面——cad 脚本面」 |
| `fuse` | `sheetmetal/src/authorFns.ts:3`、`src/formFns.ts:3`、`src/contourFlangeFns.ts:3`、`src/loftedFlangeFns.ts:2`、`src/tabFns.ts:2`、`test/foreignUnfold.test.ts:6` | |
| `applyMatrix` | `sheetmetal/src/geometryOps.ts:17` | |
| `rotate` | `sheetmetal/src/geometryOps.ts:17`、`src/authorFns.ts:3`、`src/formFns.ts:3`、`src/miterFns.ts:4` 等 | |

落法：`:124` 的通配改**具名清单**，逐名按 DEC-6 判据裁定——上表四个及同类有消费者者留，无消费者者删。`extrude`（`:131`）与 `revolve`（`:132`）同样有消费者（`sheetmetal/src/cutoutFns.ts:2`、`src/formFns.ts:3`、`src/tabFns.ts:2` 等），留。`boolean`（`:78-84`）的命名绑定经全仓检索**无消费者**（无 `import { boolean }`），可只留 `booleanOp`。其余 op 接入族（`:58` 的 `view-export` 等）按同一方法逐名核，本方案不给结论。

**方向反过来要新增守卫**。仓内已有同题先例：`packages/faijs-extra/test/core-surface.test.ts:1-12` 的注释写「a name can leave the `cad` namespace while a stale re-export keeps it importable from `@faicad/faijs` or `@faicad/faijs/browser`, and that is how a 'removed' API quietly survives a major release」——它按 `src/op-names.ts` 的名单断言编辑器 op 不出现在两个入口面。本次按同一机制维护一份「脚本面专属、不进库面」的名字清单，断言其不出现在 `@faicad/faijs` / `@faicad/faijs/browser`。所以 DEC-7 删掉的不是一个守卫，而是把一个**方向错**的守卫（cad 面必须平铺到库面）换成一个**方向对**的（不该在库面的名字不得残留 re-export）。

## 3. 验收矩阵

每一行是一个必须存在断言的组合。这是第 4 节测试用例的索引。

「宿主」列 = `HostPorts.hostEnv` 的声明值（§2.5）；「任意」= 该行不受宿主门禁影响。

| # | 调用面 | 格式 | 引擎 | 宿主 | 期望产物 | 层级 | 断言要点 |
|---|---|---|---|---|---|---|---|
| A1 | 库 `exportModelSync` | stl | 任意 | 任意 | 单文件二进制 STL | 展平 | 三角形数、坐标刻度、80 字节头名字 |
| A2 | 库 | 3mf | 任意 | 任意 | ZIP + `3D/3dmodel.model` | `<components>` | resources 内 id 唯一、`<item>` 指向父 object |
| A3 | 库 | step | occt | 任意 | P21 文本 | XCAF label/location | PRODUCT 数 = 叶数、名称、颜色 |
| A4 | 库 | step | brepkit | 任意 | —— | —— | 触碰句柄前报 `E_BREP_UNSUPPORTED` |
| A5 | 库 `exportModelSync` | stl | 任意 | `'browser'` | 单文件二进制 STL | 展平 | 不受宿主门禁（字节通道 ≠ 导出命令，§2.5） |
| B1 | 脚本 `cad.exportStl` | stl | occt | `'node'` | `Uint8Array` | 展平 | 与 A1 同几何字节一致（单一真源） |
| B2 | 脚本 `cad.exportStl` | stl | brepkit | `'node'` | `Uint8Array` | 展平 | 同上（中立 op，无引擎分支） |
| B3 | 脚本 `cad.exportBrep` | brep | occt | `'node'` | string | 展平 | `import_brep` 往返无损 |
| B4 | 脚本 `cad.exportBrep` | brep | brepkit | `'node'` | —— | —— | `E_BREP_UNSUPPORTED`，实现体未执行 |
| B5 | 脚本面覆盖守卫 | —— | 任意 | —— | —— | —— | 符号表含 `exportStl`/`exportBrep`/`exportStep`/`export3mf`，不含 `exportModel`（库面入口不进脚本面） |
| B6 | 脚本 `cad.exportStl` | stl | 任意 | `'browser'` | —— | —— | `E_HOST_UNSUPPORTED`（`current=browser`），Shape 载荷未被读取 |
| B7 | 脚本 `cad.exportBrep` | brep | brepkit | `'browser'` | —— | —— | 宿主门先于引擎门：报 host 错误而非 `E_BREP_UNSUPPORTED` |
| B8 | 脚本 `cad.exportStl` | stl | 任意 | `'weapp'` | —— | —— | `E_HOST_UNSUPPORTED`（`current=weapp`） |
| B9 | 库直连 `exportStl` / `exportBrep`（TS import：聚合面或子路径 `@faicad/faijs/api/*`） | stl / brep | 任意 | `'browser'` | —— | —— | 同一函数体断言 → `E_HOST_UNSUPPORTED`（门在函数体，无旁路；取用路径见 §2.7） |
| B10 | 脚本 `cad.exportStl` | stl | 任意 | 未声明 | —— | —— | `E_HOST_UNSUPPORTED`（`current=<none>`），不兜底放行 |
| B11 | 脚本 `cad.exportStl` | stl | 任意 | `'browser'` + `security: 'off'` | —— | —— | 档位放宽不解除导出门禁：仍报 `E_HOST_UNSUPPORTED`（门禁不读安全档位） |
| B12 | 脚本 `cad.exportStep` | step | occt | `'node'` | string（P21 文本） | XCAF 层级 | 与库面 `exportModelSync([entry],'step')` 文本逐字节一致（同一序列化器） |
| B13 | 脚本 `cad.exportStep` | step | brepkit | `'node'` | —— | —— | `E_BREP_UNSUPPORTED`（层级需 XCAF，§2.3），触碰句柄前报出、实现体未执行 |
| B14 | 脚本 `cad.export3mf` | 3mf | 任意 | `'node'` | `Uint8Array`（ZIP） | `<components>` | 与库面 `exportModelSync([entry],'3mf')` 字节一致；与引擎无关（两支同产物） |
| B15 | 脚本 `cad.exportStep` / `cad.export3mf` | step / 3mf | 任意 | `'browser'` | —— | —— | `E_HOST_UNSUPPORTED`（新 op 走同一宿主门，不存在旁路） |
| B16 | 脚本 `cad.export3mf` | 3mf | 任意 | 未声明 | —— | —— | `E_HOST_UNSUPPORTED`（`current=<none>`），与 B10 同口径 |
| B17 | 脚本 `cad.exportStep(shape,{unit:'inch'})` | step | occt | `'node'` | string | XCAF 层级 | 声明单位与坐标刻度成对写出（回读 `readDeclaredUnit` == 'inch'；`export-model.ts:509`） |
| C1 | 库 | step | occt | `'node'` | 文件落盘 | XCAF | CLI 落盘字节 == 库返回值 |
| C2 | 库 | step | occt | `'browser'` | 字节回传 | XCAF | 注入 init fn 后可跑；入口不含 node-host |
| C3 | 宿主指令 | step | occt | `'browser'` worker | 字节 | XCAF | `dispatchExport` 走 `exportStepFromSolidsHighLevel` |
| C4 | 宿主指令 | step | brepkit | `'weapp'` worker | 逐实体文件数组 | 丢失 | 不被伪装成层级 |
| C5 | 宿主工厂声明 | —— | —— | —— | —— | —— | `createNodePorts().hostEnv === 'node'`、`createBrowserPorts()` → `'browser'`、`buildWeappPorts()` → `'weapp'` |
| D1 | 往返 | 3mf | 任意 | 任意 | 导入模型 | 层级保留 | children 结构与名称/颜色/meta 逐一相等 |
| D2 | 往返 | step | occt | 任意 | XCAF 装配树 | 层级保留 | `importAssemblyFromStep` 的叶名称与颜色 |
| D3 | 往返 | stl | 任意 | 任意 | 三角形 soup | 展平 | 三角形集合相等（无序比较） |

## 4. 测试方案

### 4.1 分层与落点

| 层 | 落点 | 资源需求 | 覆盖的矩阵行 |
|---|---|---|---|
| L1 序列化（无内核） | `packages/core/test/brep/export/export-model.test.ts`（扩展） | 无 | A1、A2、D1、D3 的写侧 |
| L2 STEP 写侧 | `packages/core/test/brep/export/step-export.test.ts`（扩展，`@vitest-environment node`） | `initOcctWasm()` | A3、D2 |
| L3 引擎矩阵 | `packages/core/test/brep/engine/export-engine-matrix.test.ts`（新增） | occt + brepkit 两套装配 | A4、B2、C4、§4.5 |
| L4 脚本面与宿主门 | `packages/core/test/api/export-stl-brep.test.ts`（扩展）+ `test/api/export-step-3mf.test.ts`（新增） | CadRuntime + 引擎 + `hostEnv` 三值 | B1–B17 |
| L5 入口与落盘 | `packages/core/test/entry-boundary.test.ts`（扩展）+ `test/browser-host/index.test.ts` + CLI 单测 | 入口名单 / 端口工厂 | C1、C2、C5 |
| L6 宿主接线 | `packages/3d_editor/test/e2e/export-dialog.spec.ts`（扩展） | 3d_editor e2e | C3、C4 |

既有测试提供了本批用例的全部骨架：`export-model.test.ts` 已用 `quadEntry()` 造 mesh（`:15`）、`readZipEntries` 解 ZIP（`:12`）、`importFile` 做往返（`:145`）、`readDeclaredUnit` 验单位（`:59`）；`step-export.test.ts` 已用 `initOcctWasm` + `importAssemblyFromStep` 做身份闭环（`:17-36`）。

### 4.2 断言归属

格式语义断言写在 L1/L2（XML 结构、字节布局、P21 实体）；引擎行为断言写在 L3（同一场景切引擎各跑一遍）；跨面一致性与宿主门断言写在 L4（脚本字节与库字节相等、`hostEnv` 三值 × 两份命令）；声明正确性写在 L5（端口工厂的 `hostEnv`、入口名单、落盘）。同一事实不写两遍。

### 4.3 L1 — 序列化与层级（无内核）

| # | 用例 | 断言形态 |
|---|---|---|
| 1 | 3MF 单层装配：父 object 的 `<components>` 引用 N 个叶 object，`<build><item>` 只指向父 | resources 内 id 唯一；引用计数正确 |
| 2 | 3MF 嵌套两层 | 变换复合顺序与读侧解释一致（对齐 `threemf-archive.test.ts:225` 的 child-first 断言） |
| 3 | 叶对象 transform | `<component transform>` 的 12 元组排布与读侧 `parseThreemf` 一致 |
| 4 | 3MF 层级 + 颜色 + materialGroups + meta 共存 | object 级 pid 与逐三角形 pid 各自生效；`<metadatagroup>` 落在正确 object（扩展 `export-model.test.ts:92-134`） |
| 5 | STL 展平烘焙 | 三角形总数 = 各叶之和；非单位 transform 成员的顶点坐标确有位移 |
| 6 | STL 单位 | `unit:'inch'` 时坐标 = 基准 / `UNIT_SCALE.inch`（对齐 `export-model.test.ts:47-55`） |
| 7 | 空装配 | children 为空时报错，不产出空文件（对齐 `export-model.ts:445`、`:521`） |
| 8 | 确定性 | 同一模型导出两次，字节逐字节相等 |

### 4.4 L2 — STEP 写侧（occt）

| # | 用例 | 断言形态 |
|---|---|---|
| 1 | 单层装配 | 出现装配引用实体（`NEXT_ASSEMBLY_USAGE_OCCURRENCE`）与 location；PRODUCT 数 = 叶数 |
| 2 | 名称 | 叶名 = 模型节点名；compound 展平命名保持 `name [n]`（`step.ts:115-116`） |
| 3 | 颜色 | sRGB→linear 往返（`step.ts:118-122`），回读颜色等于输入 |
| 4 | 零 fuse | `MANIFOLD_SOLID_BREP` 数 = 叶数，装配不被 fuse 成一体 |
| 5 | 单位与 header | 非 mm 单位的 `SI_UNIT`/`CONVERSION_BASED_UNIT` 改写（`export-model.ts:89-147`）；`fileMeta` header 改写（`:170`） |
| 6 | 句柄所有权 | 导出后调用方缓存中的原 solid 仍可用（`step.ts:71-73` 约定） |
| 7 | 网格叶 | mesh 叶经 `reconstructSolidFromMesh` 重建后进同一份 STEP（`step.ts:83`） |
| 8 | 非实体形状 | 面 / 壳 / 边 compound 的导出行为按既有分派（`step.ts:93-110`） |

### 4.5 L3 — 引擎矩阵

同一份装配模型，经 `__resetEngineRegistriesForTests()`（`registry.ts:189`）后分别装配 occt 与 brepkit，跑同一场景：

| 用例 | occt 期望 | brepkit 期望 |
|---|---|---|
| 3mf 装配导出 | 有 `<components>` | 有 `<components>`（与引擎无关） |
| stl 装配导出 | 展平烘焙 | 与 occt 路径逐字节等同（纯 mesh，无引擎分支） |
| step 导出（库面） | 真装配树 | 触碰内核前报 `E_BREP_UNSUPPORTED` |
| step 导出（宿主 brepkit 通道） | —— | 逐实体文件数组；层级丢失且不伪造 |

两个判据的实现手法：「实现体是否执行」用计数器（对齐既有 `engine-switch-declaration.test.ts:113`、`:121` 的 `implRuns` 手法）；「是否触碰 occt」用 spy 记录 `getOcctKernel` 调用次数，期望为 0。

宿主环境是第三条正交轴：同一份装配再切 `hostEnv` 三值（§4.6 用例 6–10）。它的判据不是"是否触碰内核"，而是"是否触碰 Shape 载荷"——`exportStl` 引擎中立，只能以载荷访问与否证明门在实现体之前。

### 4.6 L4 — 调用面（脚本 vs 库）

| # | 用例 | 断言形态 |
|---|---|---|
| 1 | 字节一致 | 同一几何，`cad.exportStl(part0)`（经 Runtime 执行）与 `exportModel([entry],'stl')` 字节逐字节相等（同一序列化器 `buildStlBufferFromMesh`） |
| 2 | ASCII 与 binary 同序 | `cad.exportStl(shape,{ascii:true})` 的三角形序与 binary 形态一致（`export-stl.ts:75-97`） |
| 3 | `cad.exportBrep` 引擎门 | occt 下与 `import_brep` 往返无损；brepkit 下报 `E_BREP_UNSUPPORTED` 且实现体未执行 |
| 4 | 空 mesh | `E_EXPORT_STL_EMPTY`（`export-stl.ts:41-43`），不返回空文件 |
| 5 | 覆盖守卫 | 符号表锚定：`exportStl`/`exportBrep`（`symbol-table.generated.ts:52-53`）、`exportStep`/`export3mf` 在册，`exportModel` 不在册（库面入口不进脚本面）；本条是 §2.6 落地的验收条件 |
| 6 | `hostEnv='browser'`：命令被拒 | `cad.exportStl(part0)` 与 `cad.exportBrep(part0)` 的 `failedAt.message` 以 `E_HOST_UNSUPPORTED:` 开头且含 `current=browser`，`failedAt.callee` 为对应命令名（对齐既有 `E_BREP_UNSUPPORTED` 的失败通道） |
| 7 | `hostEnv='browser'`：门在实现体之前 | 传入一个三角载荷为 **getter 陷阱**（读取即抛）的 Shape：抛出的是 `E_HOST_UNSUPPORTED` 而不是陷阱错误 → 证明 `exportStl` 未读载荷；同一手法对 `exportBrep` 用一个 `brepOf` 为陷阱的 Shape |
| 8 | 门序：宿主先于引擎 | `hostEnv='browser'` + 仅注册 brepkit：报 `E_HOST_UNSUPPORTED`，**不是** `E_BREP_UNSUPPORTED`（`export-brep.ts` 中断言顺序的直接证据） |
| 9 | `hostEnv='weapp'` | 同用例 6 的期望，`current=weapp` |
| 10 | 未声明 `hostEnv` | 同用例 6 的期望，`current=<none>`（不兜底放行） |
| 11 | 安全档位不参与判据 | 同一 Runtime 以 `security: 'off'` 建（档位放宽端，`runtime.ts:538`），`hostEnv='browser'` 下 `cad.exportStl` / `cad.exportBrep` 仍报 `E_HOST_UNSUPPORTED`：脚本侧「静态扫描放行即导出」的通路不存在，门禁只读 `config.hostEnv` |
| 12 | 新 op 同源（step） | `cad.exportStep(part0)` 文本 == 库面 `exportModelSync([entry],'step')` 文本（逐字节）；entry 构造手法对齐 `node-host/cli.ts#writeOutput`（`:744-758`：stl 取 mesh、step 取 solid） |
| 13 | 新 op 同源（3mf） | `cad.export3mf(part0)` 字节 == 库面 `exportModelSync([entry],'3mf')` 字节；`readZipEntries` 取出的 `3D/3dmodel.model` 与 §4.3-1 同构 |
| 14 | 层级入口 | `cad.exportStep(compound)` 的 PRODUCT 数 == 叶数，成员名与 `memberColors` 落在对应 XCAF label（成员遍历口径对齐 `cli.ts#writeAssemblyStep:798-835`，含「活句柄 `brepOf(child)` 优先于陈旧快照」） |
| 15 | 门序：宿主先于引擎 | `hostEnv='browser'` + 仅注册 brepkit：`cad.exportStep` 报 `E_HOST_UNSUPPORTED`，**不是** `E_BREP_UNSUPPORTED` |
| 16 | 门在实现体之前（新 op） | 传入 `positions` / `brep` 为 getter 陷阱的 Shape：`'browser'` 下抛 `E_HOST_UNSUPPORTED`；同一 Shape 在 `'node'` 下抛陷阱错误（反证 node 下门放行且实现体确实读载荷） |
| 17 | 单位透传 | `{unit:'inch'}` 时 `readDeclaredUnit(text) === 'inch'` 且坐标按 `UNIT_SCALE` 换算（与 §4.3-6 同一判据） |

### 4.7 L5 / L6 — 入口与落盘

| # | 用例 | 断言形态 |
|---|---|---|
| 1 | host（node） | CLI 落盘字节 == `exportModelSync` 返回值；扩展名到格式的映射正确；写盘失败报错不静默（`node-host/cli.ts:729-762`） |
| 2 | browser | `browser.ts` 导出名单不含 node-host 成员；`exportStepFromSolidsHighLevel` 在 `setOcctWasmInitFn` 注入后用注入的 init（`occtKernel.ts:99-103`） |
| 3 | weapp | `weapp.ts` 只导出 brepkit 装配与 `createRuntime`（`weapp.ts:20-42`），不含 occt 成员；该入口下的 step 导出落 §4.5 的 brepkit 期望 |
| 4 | 无 fs | faijs 内核（`/browser`、`/weapp` 入口）不 import `node:fs`；落盘只出现在 `node-host` |
| 5 | 3d_editor 接线 | `ExportInstruction.entries` 不含层级字段时仍可导出；含层级时必须落层级（`protocol.ts:465-473`） |
| 6 | 端口工厂声明（faijs） | `createNodePorts().hostEnv === 'node'`（`node-host/index.ts:78-84`）、`createBrowserPorts().hostEnv === 'browser'`（`browser-host/index.ts:123-131`）；落点 `test/browser-host/index.test.ts` 扩展 + node-host 单测新增 |
| 7 | 端口工厂声明（3d_editor） | `buildWeappPorts().hostEnv === 'weapp'`（`platform/src/weapp/worker-ports.ts:119`）；electron 的 `createProcessPorts` 继承 `'node'`（`electron/execution-process.ts:129`） |
| 8 | 库面边界（§2.7） | `@faicad/faijs` 与 `@faicad/faijs/browser` 的**入口面对象**不含「脚本面专属」名单里的名字；`@faicad/faijs/api` 侧仍可取到有库作者消费者者（`fuse` / `isValid` / `applyMatrix` / `rotate`），脚本面 `cad.*` 键集不受影响 |

### 4.8 缺陷钉法（当前值 + 应有值并存）

每个已知缺陷写一条测试同时钉住当前错误值与应有正确值，修复后翻转断言。两条断言必须并存，不得只写其一。

| # | 场景 | 当前值 | 应有值 | 落点 |
|---|---|---|---|---|
| P1 | 库 `exportModel(装配, 'step')`，仅注册 brepkit | 抛 `'occt-wasm kernel not initialized — call initOcctWasm() first'`（`occtKernel.ts:187`），且报错发生在 `getBrepApi()` 之后 | 触碰任何句柄前抛 `E_BREP_UNSUPPORTED`（含当前引擎名），与 `export-brep.ts:32` 同构 | L3 |
| P2 | 3MF 写出带层级的装配 | 无 `<components>`，层级塌成平级 `<object>`（`export-model.ts:319-418`） | 写出 `<components>` 与 `<component transform>`，读侧可还原（读侧已支持，`threemf-archive.test.ts:188`） | L1 |
| P3 | STEP 写出带层级的装配 | 平级 PRODUCT，无装配引用（XCAF 槽无 `addChild`，`engine/types.ts:202-206`） | 真装配树：label / location + 装配引用 | L2 |
| P4 | 3MF 往返带层级 | 导入后 children 结构丢失 | 结构与名称 / 颜色 / meta 逐一相等 | L1 |
| P5 | 脚本面导出 step / 3mf | 无该 op（符号表只有 `exportStl`/`exportBrep`，`:52-53`） | `cad.exportStep` / `cad.export3mf` 在册，且与库面同源：文本 / 字节一致（B12、B14） | L4 |
| P6 | `hostEnv != 'node'`（含 `security: 'off'` 档）或 `hostEnv` 未声明时执行导出命令（`exportStl` / `exportBrep` / `exportStep` / `export3mf`） | 正常返回产物（`export-stl.ts:118` 只校验载荷，`export-brep.ts` 只断言引擎） | 抛 `E_HOST_UNSUPPORTED`（含 `current=<宿主值>`），实现体未执行 | L4 |
| P8 | 库面 3MF 写出器吃 `solid` 条目 | 静默跳过无 `mesh` 的条目（`export-model.ts:330`），产出「ZIP 合法、对象为空」的假成功 | 由调用侧保证条目形态（§2.6 定式 4）；op 层必须显式报错而不是落空文件 | L1 |

写法示例：P1 形态是「两条断言都成立」——`expect(err.message).toBe(当前未初始化异常文本)` 与 `expect(err.code).toBe('E_BREP_UNSUPPORTED')` 同时存在，后者在修复后成立、前者同时被替换。P6 形态是「返回 → 抛错」，当前值钉法为 `expect(typeof out.bytes).toBe('object')` / `expect(typeof out.text).toBe('string')`（记录「当前不拒绝」这一事实），应有值钉法为 `expect(() => …).toThrow(/^E_HOST_UNSUPPORTED/)`（当前失败、修复后通过）；修复时删掉当前值断言，并把宿主前提翻转为 `hostEnv: 'node'` 后改写为「返回产物且载荷被读取」。

### 4.9 既有守卫的复用

`capabilities` 不回引由 `engine-switch-declaration.test.ts:92-97` 守卫；导出相关改动不新增任何**引擎能力**声明位——宿主环境是端口装配期的事实（§2.5），不进 op 元数据。静态安全扫描（`lang/security-scanner.ts`）是脚本侧的第一层防御，不是导出门禁的上游：放宽档位（含 `off`）不得让 §4.6-11 / B11 变绿。引擎相关测试必须经 `__resetEngineRegistriesForTests()` 装配，不得在运行期再注册（`registry.ts:64` 冻结）。断言一律读 `src`，不读 `packages/core/dist/**`（`docs/AGENTS.md` 规定 dist 非真源）。

库面边界（§2.7）的删除验证写在**入口面对象的运行时断言**上，不接受注释或类型声明层面的「已删除」——对齐 `packages/faijs-extra/test/core-surface.test.ts:11-12` 的既有做法（「written against the runtime export objects, so it cannot be satisfied by editing a comment or a type declaration」）。

## 5. 落地步骤

每步自带与第 4 节对应的测试。

1. 宿主环境轴：`HostEnv` 类型 + `HostPorts.hostEnv`（`ports.ts:243`）+ `Backends.config.hostEnv` getter（`runtime-state.ts:50-55`、`runtime.ts:581-589`）+ `HostUnsupportedError`（`runtime-state.ts`，与 `BrepUnsupportedError:121` 同级）+ `assertHostFor`（`api/internal/l3-bridge.ts`，与 `assertEngineFor:109` 并列）+ 两个导出 op 首行断言（`export-stl.ts`、`export-brep.ts`）+ 两个工厂声明（`createNodePorts` / `createBrowserPorts`）。同批把既有装配点补上声明：`packages/core/test/api/export-stl-brep.test.ts:45` 等只给 `events` 的 harness 声明 `'node'`（否则导出用例全部翻转为"未声明"分支）。类型面：`HostEnv` 随 `HostPorts` 进入公开类型导出名单（`src/browser.ts:33-42`、`src/index.ts:142`），按该仓做法同步 `packages/core/api-manifest.json` 等清单，并过 `npm run doc-sync`。配 A5、B6–B11、C5 与 P6。断言只读 `config.hostEnv`，不读 `securityPolicy`——档位放宽（含 `off`）不放宽导出门禁（§1.8）。
2. 库面边界（§2.7）+ 脚本面 step / 3mf 出口（§2.6）。**边界先做**：删三条「cad 面 ⊆ 导出面」断言（`op-set-consistency.test.ts:84-88`、`p23-cad-face.test.ts:76-80`、`:82-91` 的「必须在 facade 顶层」那半）；把 `src/api/index.ts:124` 的 `export * from './generated/script-face'` 改**具名清单**（按 §2.7 核查表逐名裁定：`fuse` / `isValid` / `applyMatrix` / `rotate` 等有库作者消费者者保留，无消费者者删）；`boolean`（`:78-84`）收为只导 `booleanOp`；在 `packages/faijs-extra/test/core-surface.test.ts` 按既有机制加「脚本面专属名单不出现在入口面」的断言；同步 `gen-l3-surface.ts:248`/`:264`/`:292`、`script-face-manifest.ts:4`、`src/index.ts:235` 的措辞（三源 → 两源）。**出口后做**：新增 `api/export-step.ts`（导出名 `exportStep`，`@group 导出`）与 `api/export-3mf.ts`（导出名 `export3mf`）；在 `createApiNamespace()` 里加这两个键，**不平铺 `api/index.ts`**。两 op 首行 `assertHostFor`，`exportStep` 其后加 `assertEngineFor('exportStep', ['occt'])`；条目构造按 §2.6 定式 4 分派。同批再生成：`gen-l3-surface.ts` → `gen-symbol-table.ts`（符号表）、`scripts/api-surface-snapshot.mjs`（手册生成器 `gen-ops-api-inventory.ts` 已停用，DEC-8），使 `check-api-test-coverage.ts --package=core`、`doc-sync` 两条门禁全绿（手册两条已按 DEC-8 摘除：覆盖守卫删除、`doc-sync` 不再调 `--check`）。其余 op 接入族（`view-export` 等）按同一方法逐名核，可与本步并做。配 B5、B12–B17 与 P5、P8。
3. `Shape` 增可选 `transform`（纯数据），配 L1 序列化用例：字段可序列化、对既有导出无影响。
4. 3MF 写侧实现 `<components>`（含递归与 transform），配 L1 的用例 1–4 与 P2、P4。
5. 导入归一：XCAF location 与 3MF component transform 写回 `Shape.transform`，配 D1、D2。
6. STEP 库面引擎归属：step 分支在取句柄前断言引擎身份，配 A4、P1。
7. XCAF 槽增装配写入能力（occt 适配器内部），配 L2 的用例 1 与 P3。
8. 宿主接线：`ExportInstruction.entries` 携带层级时走层级通道，配 §4.7 第 5 条。
9. 3d_editor 侧声明落地：`platform/src/weapp/worker-ports.ts:119` 显式声明 `'weapp'`，其余三处经工厂继承（§2.5 清单）。配 §4.7 第 7 条。
10. 全量回归：先跑本批测试，再跑受影响的引擎与导出既有测试，最后 `scripts/ci.ps1`。

## 6. 不变式 → 断言映射

| 不变式 | 断言位置 |
|---|---|
| 声明单位 == 写出坐标刻度 | L1 §4.3-6（`readDeclaredUnit` 回读） |
| 导出零 fuse | L2 §4.4-4（`MANIFOLD_SOLID_BREP` 计数） |
| 句柄不出 worker、内核不 import fs | L5 §4.7-4 |
| 句柄不跨引擎传递 | L3 §4.5（spy `getOcctKernel` 零调用） |
| 同一几何的脚本面与库面字节一致 | L4 §4.6-1 |
| 脚本面导出命令与库面共用同一序列化器（薄壳，不是第二条写出通道） | B12、B14（文本 / 字节一致）+ B5（在册名单） |
| 宿主门对**每一个**导出 op 生效，且门在实现体之前 | L4 §4.6-15、16 + B15、B16 |
| 装配层级单一真源 | D1、D2 往返；无第二棵树 |
| 收窄轴只有两根：引擎身份（op 元数据）与宿主环境（端口装配） | `engine-switch-declaration.test.ts:92-97`（`capabilities` 不回引）+ L3 引擎矩阵 + L5 §4.7-6/7（工厂声明） |
| 导出命令仅 node 宿主可执行，且门在实现体之前 | L4 §4.6-6～10 + P6 |
| 脚本不可信是既定前提，静态门禁 ≠ 沙箱；导出能力只能由宿主入口触发，与安全档位解耦 | §1.8 事实 + L4 §4.6-11（档位 `off` 仍拒绝）+ P6 |
| 库面公开什么只看库作者是否需要；脚本面**专属** op 不进库面聚合面（有库作者消费者者按名保留） | §2.7（判据 + 删掉的三条断言 + 按名核查表 + 反向守卫） |
| 导出确定性 | L1 §4.3-8（两次导出字节相等） |
