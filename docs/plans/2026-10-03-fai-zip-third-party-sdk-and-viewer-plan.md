# `.fai.zip` 第三方 SDK 与 3d_viewer_electron 接入开发计划

> Status: 方案（未实施）
> Scope: faijs monorepo（`packages/core` 容器层与执行面 + **新增独立包 `packages/faijs-viewer`**）+ 独立仓库 `3d_viewer_electron`
> 规范依据: `docs/fai-zip-format.md`（`.fai.zip` 容器格式规范，本计划的全部实现必须与之一致；**本计划含对该规范的 `requiresBrep` 字段移除修订，见 §1.6**）、`docs/api-contract.md`（宿主注入与执行契约）、`docs/ops-api-inventory.md`（op 手册）
> 修订记录: 2026-10-03 按用户指令修订——① `manifest.requiresBrep` 移除，BREP 为默认必需；② viewer **保留**原 occt-import-js，两套内核并存、暂不合并；③ SDK 采用独立包 `@faicad/faijs-viewer`（方案 B）；④ **v1 API 定案：`wasm` 三 url（occt/manifold/brepkit）全部必需**，预置与引擎无关化留待以后优化；⑤ 附 brepkit 网格布尔核查结论（§1.8）。

## 0. 用户原话（需求的第一真源）

原始需求（2026-10-03）：

> 「我想让任何的第三方软件都能够查看本项目的.fai.zip三维建模文档，该如何提供sdk或者类似的东西。比如我想让 C:\my\Faicad\3d_viewer_electron 项目增加对 .fai.zip 文件格式的支持，两个项目应该如何分工，请调研后写一份开发计划。」

修订指令一（2026-10-03，对本方案的直接约束，优先级等于原始需求）：

> 「manifest.requiresBrep 这个字段本身就很可疑，应该去掉。brep是默认必须支持的。然后3d_viewer_electron可以把occt的内核更改为occt-wasm, 和本项目保持一致。请更新你的方案。」

修订指令二（2026-10-03，覆盖修订指令一中「更改为 occt-wasm」的表述）：

> 「这样3d_viewer_electron保留原来的occt。只是解析.fai.zip文件时，还需要一个occt.wasm包，暂时不处理合并occt内核。」

修订指令三（2026-10-03，定案 SDK 形态）：

> 「我选择方案B：独立包 @faicad/faijs-viewer（新 workspace 包），第三方只需要引入这个包，就应该可以查看fai.zip文件，它不需要知道内部细节，什么occt引擎/mesh引擎等。也不需要知道要组装什么host环境。全部给出预置的，最多可选配置。而且你这里大概时错误的：manifoldUrl?: string // 可选：默认指向 SDK 内置路径 / brepkitUrl?: string // 可选：无 OCCT 环境（weapp 等）时兜底。你需要看brepkit是否支持网格的bool，如果支持，manifold没有存在的必要。此外，写成occtUrl、brepkitUrl不方便后期升级。因为faijs的原意是可以切换brep/mesh的后端引擎内核。」

修订指令四（2026-10-03，定案 v1 API，覆盖修订指令三中的配置风格）：

> 「算了，第一版就这么写：
>
> ```ts
> occtUrl: string          // 必需
> manifoldUrl?: string     // 必需
> brepkitUrl?: string      // 必需
> ```
>
> 全部必须，以后再优化。」

本计划的一切拆分、接口与责任划分都以这五段话为检验标准：**最终要交付「任何第三方软件都能查看 .fai.zip 三维建模文档」的能力**，`3d_viewer_electron` 是第一个落地样例；**SDK 形态 = 独立包 `@faicad/faijs-viewer`，第三方只依赖一个包**；**BREP 是查看链路的默认必需能力，不做「无 BREP 也可渲染」的承诺**；**v1 API 采用显式 `wasm` 三 url（occt/manifold/brepkit）全部必需**（修订指令四），「全部预置、最多可选配置、引擎无关通用 id」为后续优化方向（§1.8/§7）；viewer 保留既有 occt-import-js（step/iges/brep/fcstd 不动），`.fai.zip` 查看面完全由 `@faicad/faijs-viewer` 承担，两套内核并存、暂不合并。

## 1. 调研结论（现状与关键事实）

本轮调研核对 faijs monorepo 与 `3d_viewer_electron` 两个仓库，结论如下。

### 1.1 `.fai.zip` 是「可独立实现的完整容器规范」，但容器本身不保证可渲染

- `docs/fai-zip-format.md` 是规范性的（normative）容器格式定义（当前 `format: 3`），声明「任何第三方可仅凭本文实现 reader 或 writer」。
- 容器只装 `manifest.json` + `model/**/*.fai.js`（模块图）+ 可选的 `data/`、`files/`、`assets/` 载荷，以及**可选的** `preview/**`、`export/**`、`cache/**` 标准命名空间。
- 关键事实：**容器里没有打包好的网格**。要「看到」几何，读取方必须**执行** active 模型的 `.fai.js` 脚本。规范 §9 明确 `preview/`、`export/`、`cache/**` 不得当作模型几何、不得用于跳过或替代执行——那是站在「忠实重建模型」角度对 reader 的约束；但对「只读查看」的第三方 viewer 而言，脚本执行仍是唯一的保真路径。
- 现状：`3d_editor` 保存快照时只写模块图 + data + files/资产载荷，**不写**任何 `preview/` 或可渲染导出成员（见 `3d_editor/packages/app/src/stores/serialization/snapshot-io.ts`、`snapshot-serializer.ts`）。因此今天任何第三方要显示一个 `.fai.zip`，都必须完整执行引擎。

### 1.2 引擎执行是「查看」的真正难点；BREP 是默认必需的执行链

- 容器读：`openContainer(bytes)` 来自 `@faicad/faijs/io/fai-zip`，返回 `{ manifest, activeModel, loader, files, assets }`（读 API 已于 2026-09-30 从 `fcstd` 归核到 core，环境无关，worker/浏览器可用）。
- 执行：`createRuntime(ports, 'auto', { projectLoader })` → `runtime.execute(activeModel 入口源码)` → `ExecutionResult`，其 `terminals`（DAG 叶子 shape）经引擎网格化后持有 `positions` + `indices`，即 `3d_editor` 渲染的三角形源（`executeScript.ts` 演示了 terminals → THREE BufferGeometry）。
- 浏览器 worker 边界 `@faicad/faijs/browser`（`createBrowserPorts` + `createRuntime`）已能把 CSG/SDF/Manifold 计算放进 worker，且该入口不含 `node-host`，可被打包器（vite/webpack）消费——`3d_editor/packages/platform/src/web/faijs.worker.ts` 就是这套边界的现存生产使用样例。
- **BREP 默认必需（修订核心）**：faijs 的 op 图中有大量 op 没有 mesh 实现，必须依赖 BREP 引擎（occt 或 brepkit）才能执行。代码级证据：
  - `cad.sketch`（3d_editor 的约束求解草图 op，planegcs 喂入）是 **brep-only（D5）**，无 mesh 实现（`packages/sketch/src/faces-plane.test.ts` 明示 "the sketch op is brep-only, D5"）；
  - `cad.sketchOnPlane` 的 `defineOp` 只有 `brep` 分支，无 mesh 实现（`packages/core/src/api/sketch-on-plane.ts`），无 BREP 引擎时报 `E_MESH_UNSUPPORTED`；
  - `cad.sketchOnFace` BREP 侧声明 `engines: ['occt']`、mesh 侧声明 `meshEngines: ['brepkit']`（`packages/core/src/api/sketch-on-face.ts`）——mesh 后端也不是 manifold；
  - compat op（`fuse`/`cut`/`extrude` 等 brepjs 投影）为 brep-only，mesh 模式抛 `E_MESH_UNSUPPORTED`（AGENTS.md op 三分类）。
  - 因此「无 BREP 也可渲染」不成立，SDK 的边界承诺改为：**查看 = 完整执行引擎（含 BREP 链）→ 输出网格；mesh 是正式渲染结果，BREP 是执行链的默认必需能力**。v1 中由宿主提供三个 wasm url（含 BREP 主引擎 occt-wasm），装配与执行由 `@faicad/faijs-viewer` 包内完成。
- 双链路红线（AGENTS.md）：BREP/mesh 切换是静态规则、无运行时回退；mesh 是正式数据而非预览。SDK 应按此把「执行出网格」作为正式结果返回，不做「假装预览的降级」。

### 1.3 faijs 现有 SDK 入口面向「库作者」，不面向「第三方查看器」

- `@faicad/faijs/sdk`（core `src/sdk.ts`）是给「第三方库作者造几何函数」的薄 re-export（`defineOp`/`keep`/`solid`/BREP 桥），**不包含**「打开容器 → 执行 → 取网格」的查看器流程。
- `@faicad/faijs/io/fai-zip` 有完整读 API（`openContainer`/`readModule`/`readAssetEntries`），但「读容器 → 执行 → 产出可渲染网格」这段胶水目前只散落在 3d_editor 的工作流里，没有以「可被任意第三方 import 的查看 SDK」形式发布。
- `@faicad/faijs/occt-kernel`（`occt-kernel/occtKernel.ts` + `highLevelApi.ts`）已提供 occt-wasm 封装：`ensureOcctKernel`/`setOcctWasmInitFn`、`importStepToMesh`、`importBrepToMesh`、`importStepMultiPart`（含 part 树与 STEP 颜色解析）、`exportStep`、`releaseShape` 等——这是 SDK 执行面（`.fai.zip`）的 BREP 必需链入口。

### 1.4 `3d_viewer_electron` 已有清晰的「格式插件」骨架，其 OCCT 内核与 faijs 不同族且本期并存

- 格式注册表 `src/renderer/config/file-formats.ts`：`FileFormatEntry`（`id/extensions/loaderModule/group/renderHint/defaultUnit` 等）+ `FILE_FORMATS` 数组 + `ALL_ACCEPT`/`getGroupAccept`。
- 加载分发 `src/renderer/engine/formatLoaders.ts`（原 `formatLoaders.ts`）：按 `format` 分派 → 返回 `LoaderResult { meshes: THREE.Mesh[], ... }`。
- 打开入口 `OpenFileDialog.tsx`（浏览器 `<input>`）与 Electron `package.json` 的 `build.fileAssociations`（OS 文件关联）。
- **OCCT 内核现状（本期并存，不合并）**：viewer 的 `step`/`iges`/`brep`/`fcstd` 四条转换链路共用 **occt-import-js**（vendored 资产 `src/renderer/public/wasm/occt-import-js.cjs` + `occt-import-js.wasm`；`lib/step-converter/occtLoader.ts` 暴露 `OcctModule { ReadStepFile, ReadIgesFile, ReadBrepFile }`；`stepToGlb.ts`/`igesToGlb.ts`/`brepToGlb.ts`/`fcstd-converter/fcstdToGlb.ts` 都经它转 GLB）。occt-import-js 与 faijs 的 occt-wasm（OpenCascade.js 系）是**两套不同 OCCT 家族**。
- **内核决策（用户定案）**：viewer **保留** occt-import-js，上述四条转换链路本期**零改动**；`.fai.zip` 查看面**完全由 `@faicad/faijs-viewer` 包承担**（v1：宿主提供三个 wasm url，包内完成装配与执行），与 occt-import-js 并存、互不触碰。两套内核的合并（含 IGES/TKDEIGES 问题）列为未来工作，不在本期（§7）。

### 1.5 结论：两个项目互补，中间缺一条「第三方消费边界」

- **faijs 需要**：把「读容器 + 执行 + 网格」这条查看主链路封装为**独立包 `@faicad/faijs-viewer`**（新 workspace 包），第三方只依赖这一个包；**v1 契约 = `openFaiZip(bytes, { wasm: { occtUrl, manifoldUrl, brepkitUrl } })`，三 url 全部必需**（修订指令四），引擎装配、worker 边界、执行、网格结构化全部包内完成。边界为「**BREP 默认必需，mesh 为正式结果**」；执行失败时如实报错。同时把 3d_editor 保存时写出「可渲染的 export/preview」补齐为规范内可选能力。并**移除 `manifest.requiresBrep` 字段**（§1.6）。
- **3d_viewer_electron 需要**：把它视作「第一个第三方消费者」，依赖 `@faicad/faijs-viewer`，自托管三个 wasm 资产并传 url，新增 `fai` 加载分支 + 文件关联 + UI；**保留既有 occt-import-js**（step/iges/brep/fcstd 不动）。

### 1.6 `manifest.requiresBrep` 字段移除（本方案的规范修订）

**理由**：字段本身不可靠且语义已被「BREP 默认必需」取代。

1. 该字段是**写方声明的可选字段**，规范 §8.2 将其定义为 FCStd 转换溯源（「烘焙载体没有 mesh 解析器」），只在 faijs-freecad 转换路径写 `true`（`packages/faijs-freecad/src/build-fai-zip.ts` 硬编码 `requiresBrep: true`）；
2. `3d_editor` 自己的快照写出侧**根本不写它**（`FaiZipAssembly.meta` 只允许 `createdAt/appVersion/label`）——含草图（brep-only）文档的容器该字段缺省，却依然依赖 BREP 链，字段无法承载「读方据此判断能否渲染」的职责；
3. 用户指令定案：BREP 是默认必须支持的，字段没有存在价值，**移除**。

**兼容性**：`requiresBrep` 是可选字段，且规范 rule 6 已要求「未定义字段读方必须忽略」——移除后旧容器（含该字段）读取行为不变，**`format` 保持 3，不需版本迁移**。

**改动面清单（faijs monorepo 内，随 P1 落地）**：

| 文件 | 改动 |
|---|---|
| `docs/fai-zip-format.md` + `docs/fai-zip-format.zh.md` | §4 字段表删 `requiresBrep` 行、示例 manifest 删 `"requiresBrep": true`、§8.2 删 `manifest.requiresBrep` 行 |
| `packages/core/src/io/fai-zip/container.ts` | `ContainerManifest` 删 `requiresBrep?: boolean` |
| `packages/core/src/io/fai-zip/container-write.ts` | `FaiZipAssembly.meta` 删 `requiresBrep`；写 manifest 处删透传 |
| `packages/core/src/io/fai-zip/container-read.ts` | 读 manifest 处删 `requiresBrep` 透传 |
| `packages/core/src/io/fai-zip/container-write.test.ts` | 3 处 `requiresBrep: true` 断言删除 |
| `packages/faijs-freecad/src/build-fai-zip.ts` | 删 `requiresBrep: true`（FCStd 转换器停止写该字段；语义不变，因为 BREP 默认必需） |
| `packages/faijs-freecad/src/build-fai-zip.test.ts`、`container-open-e2e.test.ts` | 相关断言删除/改写 |

历史 plan（2026-09-17/28/30）中对该字段的记录是决策留痕，**不修改**；其语义以本方案为准。`3d_editor` 写方无需改动（本就不写）。

### 1.7 内核并存的边界

- viewer 既有转换链路（step/iges/brep/fcstd）继续使用 occt-import-js，其 IGES 支持（TKDEIGES）不受影响；
- `.fai.zip` 查看面经 `@faicad/faijs-viewer` 执行（v1：宿主提供三 wasm url，包内装配），viewer 不触碰 occt-import-js；
- 两套 OCCT wasm 并存是本期事实：体积上各自懒加载（faijs-viewer 的引擎仅打开 `.fai.zip` 时装配，occt-import-js 仅打开 CAD 格式时装配）；**合并内核**（含 IGES/TKDEIGES 问题）列为未来工作，不在本期（§7）。

### 1.8 引擎能力核查：brepkit 网格布尔与 manifold 的去留（修订核心事实）

用户指令要求核查「brepkit 是否支持网格布尔；如果支持，manifold 没有存在的必要」。代码级核查结论：

1. **brepkit wasm 内核有网格布尔原生能力**：`engine-method-map.json` 将 `meshBoolean` 标记为 `brepkit-only`（`occt: null`），即 brepkit 独有能力；但**它没有接进 faijs 的 L1 契约**（`brepkitKernel.ts` 头注释明列：brepkit 独有能力「…serializeSolid、meshBoolean、minkowskiSum…」都不在 L1 对象里，仅平台代码经原生面 `getBrepkitKernel()` 访问）。
2. **BREP 槽布尔已接线**：`brepkitKernel.ts:636-641` 的 `cut`/`fuse`/`intersect`（含 `*WithHistory`，1438-1449）已映射到内核 `kernel.cut`/`kernel.fuse`/`kernel.intersect`；brepkit 的 solid 本身是「三角形网格 + 面拓扑」，所以 **BREP 槽布尔即网格布尔**（走 `trackFallback` 链纪律）。
3. **mesh 路径布尔当前只有 manifold 后端**：`union`/`subtract`/`intersect` 的 mesh 实现走 `MeshData` 级 `computeBoolean`（`mesh/boolean.ts` → `boolean/csg-core.ts` → manifold worker/inline CSG 后端），`DEFAULT_MESH_ENGINES = ['manifold']`；而 brepkit 的 **mesh 实体后端**（`registerBrepkitMeshEngine`）只含 `importMesh/weld/unify`，**无布尔**。
4. **结论**：
   - 「manifold 没有存在的必要」**目前不成立**——因为 faijs 的 mesh 布尔槽还没有 brepkit 后端；mesh-only 内容（sdf、`load` 网格）的布尔仍只能走 manifold。
   - 让 manifold 可移除的前提是：**把 brepkit 的布尔（BREP 槽 `cut/fuse/intersect` 或原生 `meshBoolean`）接入 mesh 布尔槽**（新接线工作，内核能力已在），并经精度/鲁棒性验证（manifold 是专为网格布尔优化的库，需对比退化样例）。这是 faijs 侧前置工作，列为 P1（§4）。
   - 在接线完成前，`@faicad/faijs-viewer` 的 `wasm.manifoldUrl` 为**必需**（mesh 布尔兜底）；接线完成并验证后，可演进为「manifold 可选/移除、brepkit 承担」，属后续优化（§7）。
   - **v1 配置风格（修订指令四定案）**：`wasm` 三 url（`occtUrl`/`manifoldUrl`/`brepkitUrl`）**全部必需、显式书写**；「引擎无关通用 id 注册表 / 全部预置 / 零配置」为后续优化方向，不在 v1（§7）。

## 2. 架构决定（两项目分工）

### 2.1 归属划分：SDK 封装归 faijs，插件适配归 viewer

| 边界 | faijs monorepo | 3d_viewer_electron |
|---|---|---|
| `.fai.zip` 读 API | `packages/core/io/fai-zip`（已有） | 不重复实现，经 `@faicad/faijs-viewer` 消费 |
| 执行与网格产出 | `@faicad/faijs` / `@faicad/faijs/browser`（已有） | 不重复实现，经 `@faicad/faijs-viewer` 消费 |
| 「容器 → 可渲染网格」胶水 + 引擎装配 | **新建独立包 `@faicad/faijs-viewer`**（见 §3） | 消费 `openFaiZip(bytes, { wasm })`，自托管三 wasm 资产 |
| BREP 默认必需链 | v1：宿主提供三 wasm url（全部必需），包内装配（occt 主 + manifold mesh + brepkit 兜底） | 提供 `public/wasm/` 下三个 wasm 资产 + url |
| 文件格式注册 / UI / OS 关联 | — | 新增 `fai` `FormatId`、加载分支、accept、fileAssociation |
| 渲染前端（THREE/场景树/面板） | — | 复用既有 `LoaderResult` 管道，不改 |

faijs 侧新造资产：独立包 `@faicad/faijs-viewer`（含引擎装配与懒加载）+ `requiresBrep` 移除（§1.6）+ brepkit mesh 布尔接线评估（§1.8）。viewer 侧新造资产：`fai` 插件（消费 SDK + 自托管 wasm）。

### 2.2 渲染数据来源的优先级

为了让「任何第三方」都能查看，SDK 支持两级数据来源（优先级由宿主显式声明，不是 SDK 擅自决定）：

1. **直接取渲染产物（可选加速，非必需）**：若容器内有 `export/<modelId>.<ext>`（如 `.stl`/`.glb`）或 `preview/<modelId>.<ext>`（图片），SDK 读取方直接解析返回。预览图足够时用 preview。
2. **执行模型（主路径，BREP 默认必需）**：读模块图 → 按宿主提供的三 wasm url 装配引擎（occt-wasm 必需 + manifold mesh + brepkit 兜底，懒加载）→ `createBrowserPorts`/`createRuntime` 执行 → `result.terminals` 转原生网格。浏览器用 worker 避开 UI 阻塞。
3. **如实报「执行失败」**：当解析失败、模块/资产缺失、引擎初始化失败时，返回带 `code` + `message` 的结构化 `error`，**不得**用空占位几何假装渲染。

宿主通过 `preferRenderBundle: true` 才启用第 1 级，且只用于「只读查看」场景，避免违反规范 §9.5「可选成员不得当作模型几何、不得用于跳过或替代执行」。「读出可渲染产物」由写方（3d_editor 保存侧）可选补齐，放 §3.5。**不再存在「BREP 不可用 → 报错」分支：BREP 是默认必需，由 SDK 装配保证。**

## 3. faijs 侧：新增独立包「@faicad/faijs-viewer」

### 3.1 发布形态（用户定案：方案 B）

- 新 workspace 包 `packages/faijs-viewer`，发布名 `@faicad/faijs-viewer`，**独立版本线**（随 faijs 家族 `set-version` 锁步，见 §3.4）。
- 消费契约：第三方**只需依赖 `@faicad/faijs-viewer` 一个包**；v1 调用 `openFaiZip(bytes, { wasm: { occtUrl, manifoldUrl, brepkitUrl } })`，**三 url 全部必需**（修订指令四）；容器读、引擎装配、worker 边界、执行、网格结构化全部包内完成，第三方不组装 host 环境。
- 包内职责：容器读（复用 core `io/fai-zip`）→ 引擎装配（按三 url + 懒加载）→ 执行（复用 `@faicad/faijs/browser` 边界）→ 网格结构化返回。
- 与 core 的关系：`@faicad/faijs` 是它的**运行时依赖**（不重复实现引擎）；v1 **不捆绑 wasm 资产**（宿主自托管，见 §3.4）。
- 「全部预置、最多可选配置、引擎无关通用 id」为后续优化方向（§7），**不在 v1**。

### 3.2 公开 API（TS 草图，v1 定案）

```ts
// @faicad/faijs-viewer
export interface FaiViewerOptions {
  /** 可选：只读宿主加速——先用 export/preview 直接读取（仅限「只读查看」场景） */
  preferRenderBundle?: boolean
  /** v1：三个引擎 wasm 地址，全部必需（修订指令四）。 */
  wasm: {
    occtUrl: string      // 必需：BREP 主引擎（执行必需链）
    manifoldUrl: string  // 必需：mesh 布尔默认后端（§1.8 结论 3；brepkit 接入 mesh 布尔槽后可演进为可选）
    brepkitUrl: string   // 必需：兜底 BREP / mesh 实体后端（无 OCCT 环境、sketchOnFace mesh 等）
  }
  /** 可选：宿主追加注册 @faicad/faijs-extra 等扩展库 */
  registerLibs?: (rt: unknown) => void
}

export interface FaiViewerMesh {
  name: string
  positions: Float32Array
  indices: Uint32Array
  appearance?: unknown // 材质等外观元数据（由宿主定义）
}

export interface FaiViewerResult {
  source: 'renderBundle' | 'execution' | 'preview'
  meshes: FaiViewerMesh[]
  meta: { modelId: string; units: 'mm' }
  error?: { code: string; message: string }
}

export function openFaiZip(bytes: Uint8Array, opts: FaiViewerOptions): Promise<FaiViewerResult>
```

- **v1 定案**：`wasm` 三 url **全部必需**、显式书写（用户指令四）；不做预置、不做引擎无关通用 id（后续优化见 §1.8/§7）。
- **默认装配语义**（§1.8 决定）：`occtUrl` → BREP 主引擎；`manifoldUrl` → mesh 布尔默认后端（mesh-only 内容兜底）；`brepkitUrl` → 兜底 BREP / mesh 实体后端（weapp 类无 OCCT 环境、`sketchOnFace` 的 mesh 分支等）。三个引擎实例懒加载、跨多次打开复用。
- 内部实现复用：`openContainer`（容器读）→ 依优先级选路 → 执行走 `ensureOcctKernel`/`createBrowserPorts` + `createRuntime`（或宿主注入 ports）+ `execute` → `result.terminals` 网格（BREP shape 经 occt 网格化、mesh shape 直出）→ 结构化成 `FaiViewerResult`。
- 包入口不引用 node-host（与 `src/browser.ts` 同制），可在打包器中直接消费（vite/webpack）；worker 边界、wasm 懒加载均包内处理。

### 3.3 依赖与约束

- 依赖：`@faicad/faijs`（运行时依赖，核心引擎）；`occt-wasm`（经宿主 url 加载，BREP 必需链）；`manifold-3d`（经 core 传递，mesh 布尔）；`brepkit-wasm`（经宿主 url 加载，兜底；包内惰性加载，不静态 import 其 node 分支——`browser.ts` 已有同制约束）。
- **v1 不捆绑 wasm 资产**：三个 wasm 文件由宿主自托管并通过 url 传入（与 occt-wasm 作为 core peer 依赖的既有契约一致）。
- 不新增对 three 的强依赖：`FaiViewerMesh` 返回原生 typed array（positions/indices），THREE 由宿主转换（3d_editor 已是该模式）。

### 3.4 打包与发布

- 新包入 workspaces：根 `package.json` `workspaces` 追加 `packages/faijs-viewer`；构建顺序、`check-ghost-deps`、`check-workspaces-order`、锁步守卫自动覆盖。
- 包入口：`package.json` `exports` 暴露 `./`（`openFaiZip` 等）为主入口；随 `npm run build -w @faicad/faijs-viewer`（tsc 编 `dist/`）产出。
- **wasm 资产自托管指引（README 文档）**：v1 不捆绑 wasm；README 说明三个 wasm 文件的获取（`occt-wasm`/`manifold-3d`/`brepkit-wasm` 依赖内）与托管方式（如 vite 复制到 `public/wasm/`、Electron 相对路径、CDN）。
- 版本走既有「版本号升级流程」（`npm run set-version` + `scripts/check-lockstep.mjs`），不手改版本号。
- 防回归测试（`packages/faijs-viewer/src/*.test.ts`）：最小容器、含 assets 容器、`format !== 3`、缺 `manifest`、执行失败错误码（解析失败/模块缺失/资产缺失/引擎初始化失败）、**v1 三 url 装配下 openFaiZip 可跑通**等用例。

### 3.5 写方配套（可选、不阻塞本期主链）

`3d_editor` 保存时可选把可渲染产物写进容器（改写的是 `export/` / `preview/`，属于规范内可选标准命名空间，不破坏容器格式），供 `openFaiZip` 的 `preferRenderBundle` 使用。该步放「P4」阶段。**写方不再需要写任何 BREP 标记字段**（§1.6）。

### 3.6 viewer 侧：纯消费 `@faicad/faijs-viewer`

用户决策：viewer 保留 occt-import-js（step/iges/brep/fcstd 转换链路本期零改动）；`.fai.zip` 查看面**完全由 `@faicad/faijs-viewer` 承担**，viewer 不装配任何 faijs 引擎。

- **接入点**：`file-formats.ts` 加 `fai` 条目 → 加载分支调 `openFaiZip(bytes, { wasm: { occtUrl, manifoldUrl, brepkitUrl } })`（三个 wasm 资产由 viewer 自托管到 `public/wasm/` 并传 url；可选 `preferRenderBundle`）→ `FaiViewerResult.meshes` 转 `LoaderResult { meshes: THREE.Mesh[], ... }` 走既有渲染管道；`FaiViewerResult.error` 按 code 展示结构化错误（解析失败/模块缺失/资产缺失/引擎初始化失败）。
- **不动项**：`occtLoader.ts`/`stepToGlb.ts`/`igesToGlb.ts`/`brepToGlb.ts`/`fcstd-converter/*`、`GlbBuilder`、`stepCache`/`stepWorkerPool`、100MB 上限守卫、缩略图管线全部保持现状。
- **未来工作（不在本期）**：合并两套 OCCT 内核（含 IGES/TKDEIGES 问题，见 §1.7），另立任务。

## 4. 里程碑

| 阶段 | faijs 侧 | viewer 侧 | 验收 |
|---|---|---|---|
| P0 调研 | —— | —— | 本计划文档（含 §1.6/§1.7/§1.8 修订） |
| P1 SDK 独立包 + 规范修订 + 引擎核查 | **新包 `@faicad/faijs-viewer`**（v1：`openFaiZip(bytes, { wasm: 三 url })`、引擎装配+懒加载）+ 单测；**`requiresBrep` 移除**（规范 §4/§8.2 + container 层 + faijs-freecad，§1.6 清单）；**brepkit mesh 布尔接入评估/接线**（§1.8，决定 manifold 去留） | 依赖 `@faicad/faijs-viewer` | `openFaiZip(minimal 样例, { wasm: 三 url })` 返回 `meshes` 长度 > 0；`fai-zip-format.md` 无 `requiresBrep`；brepkit mesh 布尔接线结论落定（接 or 不接 + 依据） |
| P2 viewer 接入 | —— | `FormatId='fai'` + 加载分支（调 `openFaiZip` + 自托管三 wasm）+ 依赖 + OS 关联 + e2e fixture | e2e 打开真实 `.fai.zip` 场景树出现零件；step/fcstd/iges 既有 e2e 回归绿 |
| P3 打磨 | 错误码（解析/模块/资产/引擎初始化）/ worker / 体积（若 §1.8 接线完成，演进 manifold 为可选） | BREP 提示 + UI + 体积 | 全分支单测绿 |
| P4（可选） | 写方 `export/` 网格 + `preferRenderBundle` | viewer 走 renderBundle 加速 | 无完整引擎开容器出网格 |

## 5. 交付物（每阶段 PR）

1. faijs：本方案文档（实施后把状态改「已落地」）+ `docs/fai-zip-format.md`/`.zh.md` 的 `requiresBrep` 移除 + `packages/core/src/io/fai-zip/*` 清理 + `packages/faijs-freecad/src/build-fai-zip.ts` 清理 + **新包 `packages/faijs-viewer`**（v1 `openFaiZip` + 引擎装配/懒加载 + 测试 + wasm 自托管 README）+ 根 workspaces/锁步配套 + 必要时 Agent Note（如需，双语配对）。
2. viewer：`file-formats` / `fileLoaders` / `package.json` / OS 关联 / wasm 资产自托管 / e2e fixture（消费 `@faicad/faijs-viewer`）。
3. P4：若做，`3d_editor` 保存侧写 `export/<id>.stl`（或 glb），viewer 的 `preferRenderBundle` 读它。

## 6. 风险与应对

| 风险 | 应对 |
|---|---|
| v1 三 wasm url 全部必需，第三方要自托管资产 | README 提供三个 wasm 文件的获取与托管指引（vite public/、Electron 相对路径、CDN）；懒加载指引避免常驻；后续版本演进为包内预置（§7） |
| manifold 是否必要取决于 brepkit mesh 布尔接线 | P1 完成接线评估/实现（内核 `meshBoolean` 能力已在）；验证通过则演进 manifold 为可选/移除，未通过则保持必需并记录退化样例（§1.8） |
| 双 OCCT wasm 并存体积（viewer：occt-import-js + faijs-viewer 内 occt-wasm） | 各自懒加载（occt-import-js 仅 CAD 格式、faijs-viewer 引擎仅 `.fai.zip`），互不常驻；P4 提供 `preferRenderBundle` 免执行加速 |
| 双内核并存引入复杂度（版本/初始化状态） | 边界写死：occt-import-js 只服务既有转换链路，faijs-viewer 只服务 `.fai.zip`（§3.6 不动项）；既有 e2e（step/fcstd/iges 加载 spec）回归确认无触碰 |
| IGES（occt-wasm 未链 TKDEIGES） | 本期不受影响：viewer 的 IGES 仍由 occt-import-js 提供；仅当未来合并内核时再处理（§7） |
| `.zip` 扩展名与通用 zip 混淆 | 判定只看 `manifest.json`（规范 §2），不看 `.zip` |
| 执行失败被误判为「无法查看」 | SDK 返回结构化 `error { code, message }`（解析/模块/资产/引擎初始化分类），viewer 如实展示；绝不用空壳几何替代 |
| 双链路静态红线 | SDK 恒以 `auto` 静态派发（`dispatchPath`），无 try-catch 回退；配置不暴露强制引擎模式 |
| 独立包与 core 版本漂移 | 走家族锁步（`set-version` + `check-lockstep`），`@faicad/faijs-viewer` 与 `@faicad/faijs` 同版本线发布 |

## 7. 遗留之外（不在本期）

- 「写入 .fai.zip」的 writer-SDK（本期只做「查看」）。
- 文件列表显示 `preview` 缩略图（可选，不阻塞接入）。
- `3d_viewer_web`（web 版）接入：同一 API 复用，不在本计划展开。
- **合并 viewer 的两套 OCCT 内核（occt-import-js → faijs-viewer 内 occt-wasm）**：含 IGES/TKDEIGES 问题，列为未来工作，另立任务，不在本期。
- **v1 之后的 SDK 优化（修订指令三的长期目标）**：wasm 包内预置 + 懒加载（零配置 `openFaiZip(bytes)`）+ 引擎无关通用 id 注册表（支持切换/新增 brep、mesh 后端不改 API）；brepkit 接入 mesh 布尔槽后 manifold 从必需演进为可选/移除（§1.8）。独立小任务，不在 v1。
