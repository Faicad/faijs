# faijs 执行引擎重构设计：Headless 化、解耦与 API 修订

> 日期：2026-08-12
> 状态：设计待评审
> 关联文档：
> - [总体架构](./architecture.md) — 分层结构、单一事实源、缓存架构
> - [Undo/Redo 架构设计](./undo-architecture-design.md) — Tier A/B/C、R 系列契约
> - [代码引擎 API 接口契约](./code-engine-api-contract.md) — 语句层 R-1/R-2 铁律、op 目录
> - [.faijs 语法设计](./faijs-syntax-design.md) — 语法子集、PartScript DAG、增量执行
> - [faijs 语言 API 参考与缺陷盘点](./faijs-ops-api-inventory.md) — 本文 §6 的输入

---

## 1. 背景与问题

### 1.1 三个做不到

| 需求 | 场景 | 现状 |
|---|---|---|
| **验证 `.faijs` 正确性** | AI 提交前 dryRun、单元级回归、CI 离线跑几何 | 唯一的 `dryRun` 通道（`executeScript.ts` `ExecuteScriptOptions.dryRun`）长在浏览器宿主上：import 它即隐式初始化 undo-store（toast/i18n）、model-store、VersionStore 全链路，Node/CI 无途径 |
| **不开浏览器产出 STL/STEP** | 批量加工、CAM 前置、AI 生成模型的产物校验 | 执行结果的"完成"定义为落入 6 个 zustand store + `window.dispatchEvent`；STEP 导出依赖 UI 会话里的 `_brepSolidCache`，无 headless 出口 |
| **引擎独立演进/测试** | 几何层单测先行（CLAUDE.md 新操作开发流程第 2 步） | 引擎与 undo、缓存、UI 深度耦合（§3 清单），单测要伪造 `registerPartMesh(new THREE.Mesh())` 等 UI 布景才能跑 |

### 1.2 API 层的病

`docs/faijs-ops-api-inventory.md` §7 列出的 10 项缺陷已逐条用代码证据核实（§6 附核实结论）。它们呈现三个结构性模式，说明缺陷不是个案而是机制缺失：

1. **"录制有、codegen/schema 漏"**：`screw.pitchCustom`、`engrave.svgSize`、`svgExtrude.naturalWidth/Height`、`wedge` 四键、`load.sourceBufferKey`——录制原样存 args，codegen 白名单输出，两者无一致性校验，文本往返静默丢参。
2. **schema 不拒绝多余键**：`args-schema.ts:302-314` 只校验已声明字段，split 的错键 `normal/offset` 得以静默通过校验再静默失效。
3. **`api.d.ts` 手写漂移**：AI 提示素材与 args-schema/codegen/dispatcher 三方均无同步机制，已漂移出 `type:'through'|'blind'`、`face:{center,normal}` 嵌套等不存在的写法。

### 1.3 重构目标

1. **执行引擎可在 Node 独立运行**：`.faijs` 文本 → parse → 执行 → 产出 STL/STEP 字节，全程无 DOM、无 Web Worker 硬依赖、无 zustand store 硬依赖。
2. **dryRun 成为一等公民**：parse + schema 校验 + 引用解析预检，零几何副作用，浏览器与 Node 同一实现。
3. **解耦**：undo、缓存、场景落地、浏览器能力（worker/字体/纹理/IO）全部变为注入式依赖，执行核心零环境 import。
4. **faijs API 修订**：修掉 inventory §7 全部缺陷，建立"schema ↔ codegen ↔ 素材"的一致性机制，杜绝回潮。

### 1.4 非目标

- 不改 `.faijs` 语法子集（`faijs-syntax-design.md` §2 全部规则保持有效）。
- 不改 undo 的用户可见语义（Tier A/B/C、快照策略、undo 粒度表保持不变——变的是 undo 逻辑住的**位置**）。
- 不改执行策略的用户可见语义（architecture.md §4.1：BREP/mesh 路径由静态规则判定，禁止运行时 try-catch 回退；`auto`/`brep`/`mesh` 可手动控制）——本设计把它落成执行核心的一等契约（§4.4），不是另起一套。
- 不引入新的包管理器/monorepo 工具链——分层用 `src/` 下的目录边界 + ESLint import 规则守护，不拆 npm 包。

---

## 2. 现状：模块地图

```
文本层    parser.ts ────────────── 纯 acorn，天然 headless ✅
          codegen.ts ───────────── 纯，但经 replay-validator 传递依赖 occt ⚠️
          args-schema.ts ───────── 纯 ✅
            │
编排层    ScriptEngine.ts ──────── 直接读 5 个 zustand store + window.dispatchEvent ❌
          executeScript.ts ─────── undo 快照/abort + 6 个 store 副作用 ❌
          replay-validator.ts ──── 薄壳转发 ✅
          scene-mutator.ts ─────── 场景落地唯一入口，写 model/material/fileBlob store ❌
          resolve-ref.ts ───────── 反向 import ScriptEngine + script-store（循环）❌
            │
分派层    src/brep/ops/dispatcher.ts → ops/<op>.ts
            │                       canUseBrep(ctx) 静态分流（ops/types.ts:38）
            ├─ BREP 路径：src/brep/brep-ops.ts → occt-wasm（主线程，同步）✅ Node-ready
            │    brep/text/fontRegistry DI ✅ / browserFontLoader（?url+fetch）⚠️
            └─ Mesh 路径：cad-core/* → three（纯数学部分 ✅）
                 ├─ engine/boolean/csg.ts → csg-worker（manifold-3d，?worker 构造）❌
                 ├─ engine/sdf/sdf-runner → sdf-worker ❌
                 └─ knurl 纹理 textureLoader（new Image + canvas）❌
```

**已有的 Node 可行性证据**（重构不是从零开始）：

| 证据 | 位置 | 说明 |
|---|---|---|
| 全 dispatcher 在 Node 跑通 BREP 路径 | `src/brep/ops/ops.test.ts`（`@vitest-environment node`） | box/sphere/transform/boolean/drill/text/engrave 等经 `executeStatement` 真实执行 |
| occt-wasm 有 Node 分支 | `occtWasmKernel.ts:46-67` | `process.versions.node` 检测 → `node:fs` 读 wasm |
| manifold-3d 可在 Node 主线程直跑 | `csg.test.ts:5-31` | 测试内 inline 复刻 worker 逻辑，即 InlineBackend 雏形 |
| 字体加载已做依赖注入 | `src/brep/text/fontRegistry.ts:25-46` | Node 由 `fontTestHelper.ts` 注入 fs 加载器 |
| loadFile 已预留 Node 分支 | `src/brep/ops/load.ts:84-88` | 注释明言"纯 node（cad-runtime 未来）" |

**结论**：BREP 链路已基本 Node-ready；断点集中在 **mesh 回退路径的 worker 构造**、**编排层的 store/undo 耦合**、**三处硬 DOM 残留**（`window.dispatchEvent`、knurl 纹理、CJK `queryLocalFonts`）。

---

## 3. 耦合点清单（解耦设计的事实输入）

### 3.1 undo 耦合

| 位置 | 耦合内容 |
|---|---|
| `executeScript.ts:246,251-253,277-283,305,452-463,841-842,907,977` | `useUndoStore.getState()` 直持；`pushSnapshot`（block/statement 两种粒度）、`abortToSnapshot` |
| `GeometryCommit.ts:20-26` | 模块加载即 `setStoreAccessors({ attachCommands: useUndoStore... })`——**任何 import commitGeometry 的代码都隐式拉起 undo-store 全链路（含 toast/i18n）** |
| `undo-store.ts:306-330,342-375` | 快照 ↔ VersionStore 引用计数联动；redo 时版本驱逐用 `commandPipeline.replayVersion` 重放（undo ↔ 命令重放双向耦合） |

### 3.2 UI/场景耦合

| 位置 | 耦合内容 |
|---|---|
| `executeScript.ts:24-32,168-172,395-401,504-570` | script/undo/model/material/engine 五个 store + `setScriptImportInProgress` UI 标志 + group/assembly 重建 |
| `scene-mutator.ts:148-202` | THREE.BufferGeometry 生成 STL → fileBlobStore → `addLoadedFile`/`setActiveFile`/`setMaterialOverride` |
| `CommandPipeline.ts:31-37` + `engine-store.ts:242-244` | `isKnownPartId` 用 `partMeshRegistry: Map<string, THREE.Mesh>` 校验——**没注册 THREE.Mesh 的 partId 无法 commit** |
| `GeometryCommit.ts:59-73` | commit 后动态 import assemble-store 触发 `recomputeAssembly` |
| `ScriptEngine.ts:1105-1228` | replayPart 读 script-store/engine-store（partTransforms）/topology-store，`window.dispatchEvent('brep-chain-broken')` |
| `resolve-ref.ts:64-97` | 跨 part 引用缺失时递归 `ScriptEngine.replayPart`，遍历 script-store——**反向依赖编排层** |

### 3.3 缓存耦合

| 缓存 | 性质 | 处置方向 |
|---|---|---|
| `outputCache`（重放内局部 Map） | 无环境依赖 ✅ | 保持 |
| `statementCache`（ScriptEngine.ts:332 模块级） | 模块单例，undo 不滚 | 改为 runtime 实例成员 |
| `_brepSolidCache`（ScriptEngine.ts:1088 模块级） | STEP 导出 solid 来源 | 改为 runtime 实例成员 |
| `brepChain.solidCache`（brep-chain.ts:84） | 每次重放的 OCCT 句柄链 | 保持（纯内存） |
| FileBlobStore / VersionStore | 纯内存内容寻址，Node 可用 ✅ | 保持，改为注入单例而非全局 import |
| loaderResultCache / proxy-mesh-cache / sdf-geometry-cache | 缓存 THREE.Mesh/LoaderResult，UI 渲染侧 | **不进**执行核心，留在 browser host |

### 3.4 浏览器 API 依赖

| 依赖 | 位置 | 处置方向 |
|---|---|---|
| csg-worker（`?worker`） | `csg.ts:1,51-53` | CsgBackend 抽象：browser=Worker，node=inline |
| sdf-worker（`?worker`） | `sdf-runner.ts:2,24` | 同上 |
| `window.dispatchEvent` | `ScriptEngine.ts:1224` | EventSink 注入 |
| knurl 纹理（Image+canvas） | `textureLoader.ts:37-48` | TextureSampler 注入；node 用纯数据解码 |
| CJK `window.queryLocalFonts` | `cjk.ts:55-60` | FontProvider 注入；node 无系统字体时显式报错 |
| occt CDN 分支 | `occtWasmKernel.ts:77-94` | node 走已有 fs 分支；生产浏览器分支不变 |
| `?url` 字体 | `browserFontLoader.ts:13` | FontProvider 的 browser 实现内部细节 |
| `import.meta.env.DEV` | `occtWasmKernel.ts:29` | 环境判定收敛到 `runtime-env.ts` 单一事实源 |

---

## 4. 目标架构

### 4.1 四层划分

```
┌─────────────────────────────────────────────────────────────────┐
│ L3 Host 适配层（两个宿主，各自实现 Ports）                          │
│  ┌─ browser host（src/renderer/…）                                │
│  │   场景落地(SceneMutator/commitGeometry)、undo 包装、             │
│  │   WorkerBackend、BrowserFontProvider、DOM 纹理采样、viewer-bridge│
│  └─ node host（src/node/ 或 scripts/）                             │
│      CLI（check/run）、InlineBackend、NodeFontProvider、fs 资产     │
├─────────────────────────────────────────────────────────────────┤
│ L2 编排层 cad-runtime                                             │
│   Runtime 实例：replay / 增量 diff / outputCache+statementCache /  │
│   dryRun / BrepChainState 生命周期                                 │
│   —— 只依赖 L0/L1 + Ports 接口，不 import 任何 store/DOM/Worker    │
├─────────────────────────────────────────────────────────────────┤
│ L1 几何执行层 cad-engine                                          │
│   dispatcher + ops/* + cad-core(mesh) + brep-ops(OCCT)            │
│   —— 后端能力（CSG/字体/纹理/资产/事件）全部经 Ports 接口注入        │
├─────────────────────────────────────────────────────────────────┤
│ L0 文本层 faijs                                                   │
│   parser / codegen / args-schema / types（PartScript/CadStatement）│
│   —— 仅依赖 acorn；两侧宿主共用同一份                               │
└─────────────────────────────────────────────────────────────────┘
```

**目录映射**（不拆 npm 包，用目录 + ESLint import 边界守护）：

| 层 | 目标位置 | 来源 |
|---|---|---|
| L0 | `src/faijs/` | 从 `script-engine/` 抽出 `parser.ts` `codegen.ts` `args-schema.ts` `types.ts`；`isGeomRef/isParamRef` 从 `brep/ops/geom-ref.ts` 上提（斩断 codegen→replay-validator→occt 的传递依赖） |
| L1 | `src/cad/` | 现 `src/brep/`（ops/dispatcher/brep-ops/brep-chain）+ `src/renderer/engine/cad-core/` 迁入；`csg.ts`/`sdf-runner.ts` 的 worker 构造剥离为 Ports 实现 |
| L2 | `src/cad-runtime/` | `ScriptEngine.ts`/`executeScript.ts`/`replay-validator.ts`/`resolve-ref.ts` 的**纯计算部分**；store 副作用全部移到 L3 |
| L3-browser | `src/renderer/engine/host/` | `SceneMutator`、`GeometryCommit`、undo 包装、worker 后端、viewer-bridge 命令 |
| L3-node | `src/node/` | CLI、inline 后端、fs 资产解析 |

### 4.2 依赖规则（新不变量）

| 规则 | 内容 | 守护 |
|---|---|---|
| **E-1** | L0/L1/L2 禁止 import：任何 zustand store、`window`/`document`、`?worker`/`?url` 模块、`sonner`/`i18n`、React | ESLint `no-restricted-imports`（同现有"store 禁止存 THREE 对象"的守护方式） |
| **E-2** | 一切环境能力（CSG 计算、字体、纹理采样、资产字节、事件通知、文件 IO）只能经 §4.3 的 Ports 接口获得，由 Host 在 `createRuntime` 时注入 | 类型系统 + ESLint |
| **E-3** | `.faijs` 文本仍是合法 JS 子集，parse-then-execute，绝不 eval（沿用 J-1） | 现有 parser 闸门 |
| **E-4** | 场景只有一份代码真源 `sceneScript`（沿用 CLAUDE.md 红线 4/5；`partScripts` 副本在本重构中一并收敛删除） | 代码评审 + 一致性测试 |
| **R-1/R-2 不变** | 单一几何实现（dispatcher）、单一模型构成实现（SceneMutator 抽象为 GeometrySink 后，browser host 内仍唯一） | 契约测试 |

### 4.3 核心接口契约（Ports）

以下是设计契约（签名与语义），不是完整实现。

```ts
// ============ L2 入口：Runtime 是实例，不是模块单例 ============
export interface CadRuntime {
  /** 整场景/单 part 重放。纯计算：只产出 ExecutionResult，不碰场景。 */
  replay(script: PartScript, opts?: ReplayOptions): Promise<ExecutionResult>
  /** 文本入口：parse → diff → 增量重放（对应现 executeScript/submitFaijsEdit 的计算内核） */
  execute(code: string, opts?: ExecuteOptions): Promise<ExecuteResult>
  /** dryRun：parse + schema 校验 + 引用解析预检，零几何副作用 */
  check(code: string): CheckResult
  /** 取终端几何用于导出（含 BREP 链 solid 句柄，供 STEP 导出） */
  getTerminalGeometry(id: string): { shape: Shape; solid?: ShapeHandle } | null
  dispose(): void   // 释放 OCCT kernel / caches
}

export interface ExecutionResult {
  outputs: Map<string, Shape>          // stmtId → 几何（现 outputCache 语义）
  brepChain: BrepChainState            // 含终端 solidCache（现 _brepSolidCache 语义）
  terminals: TerminalShape[]
  infos: string[]                      // 退化/跳过说明（沿用：禁 console.warn）
  failedAt?: { index: number; op: string; message: string }
}

// ============ Ports：Host 注入的环境能力 ============
export interface HostPorts {
  csg: CsgBackend              // mesh 路径 CSG（boolean/split/drill/extrude/engrave/knurl）
  sdf: SdfBackend              // SDF 求值
  fonts: FontProvider          // 字体字节/注册表（brep 侧已有 fontRegistry DI，推广到 mesh 侧）
  texture: TextureSampler      // knurl 纹理采样（browser=canvas，node=纯数据解码）
  assets: AssetResolver        // load* 的字节来源（key/path/url → ArrayBuffer + format）
  events: EventSink            // brep-chain-broken 等通知（browser=window 事件→toast，node=stderr/结构化输出）
}

export interface CsgBackend {
  boolean(op: BooleanOp, meshes: ManifoldMesh[]): Promise<MeshData>
  splitPlane(mesh: ManifoldMesh, plane: PlaneParams): Promise<{ front: MeshData; back: MeshData }>
  // ……其余与现 csg.ts 的消息协议一一对应
}

export interface AssetResolver {
  /** loadByKey 的 headless 等价物：key 由 Host 解释（browser=faicad 会话缓存，node=--assets 目录/manifest）。
      前端已原生处理 STEP、不再转 GLB，无需 isSource/双字节语义——格式由 format 判定，CAD 格式走 BREP 导入 */
  resolveByKey(key: string): Promise<{ bytes: ArrayBuffer; format?: string }>
  resolveFile(path: string): Promise<ArrayBuffer>   // browser 下抛错（现行为）
  resolveUrl(url: string): Promise<ArrayBuffer>     // fetch，两环境通用
}

export interface EventSink {
  /** auto 模式断链时触发：browser host 弹 toast，node host 写入 result.infos */
  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void
}

// ============ 执行选项：执行模式见 §4.4 ============
export type ExecutionMode = 'auto' | 'brep' | 'mesh'

export interface ExecuteOptions {
  mode?: ExecutionMode           // 缺省时由 Host 默认值决定（browser=用户设置，node=CLI --mode，默认 'auto'）
  params?: Record<string, JsonValue>
  dryRun?: boolean
  hooks?: { beforeStatement?: (stmt: CadStatement, index: number) => void }
}
```

**undo 不再是 Port**——它是 browser host 对 `execute` 的**包装**，不是执行的环境能力：

```ts
// L3-browser：现 executeScript 的 undo 语义原样保留，只是位置移到这里
async function executeScriptInApp(code: string, opts: ExecuteOptions & { undoGranularity?: ... }) {
  const plan = runtime.planUndo(code, opts)          // 纯函数：语句数 → 粒度/budget 决策
  if (plan.mode === 'block') undoStore.pushSnapshot('undo.label.loadScript', {})
  const result = await runtime.execute(code, {
    ...opts,
    hooks: { beforeStatement: plan.mode === 'statement'
      ? (stmt, i) => undoStore.pushSnapshot('undo.label.scriptStatement', { ... })
      : undefined },
  })
  if (!result.ok && plan.mode === 'block') undoStore.abortToSnapshot()
  // 场景落地：GeometrySink（现 SceneMutator+commitGeometry）消费 ExecutionResult
}
```

**GeometrySink**（R-2 的演化）：L2 产出 `ExecutionResult` 即视为"计算完成"；browser host 的 sink 负责 `SceneMutator.createPart → commitGeometry → recomputeAssembly` 的落地序列（现 executeScript.ts:395-413 逻辑平移）。node host 的 sink 是导出器（§5.3）。`CommandPipeline.isKnownPartId` 对 `partMeshRegistry` 的依赖**只存在于 browser sink 内部**，不再泄漏到执行路径。

**缓存处置**：
- `statementCache`/`outputCache`/`_brepSolidCache` → `CadRuntime` 实例成员（`createRuntime()` 每次新建；跨提交存活的需求由 Host 持有 runtime 实例满足）。
- FileBlobStore/VersionStore → 保持纯内存实现，构造注入；node host 用同一实现的新实例。
- loaderResultCache/proxy-mesh-cache/sdf-geometry-cache → 留在 browser host，L2 不感知。

**resolve-ref 循环解**：跨 part 引用解析改为 L2 内部能力——`replay` 接收整场景 DAG（sceneScript 本就单图，`resolveShapeRef` 查 runtime 自己的 outputs，缺失时按拓扑序补算），不再反向 import ScriptEngine/script-store。

### 4.4 执行模式：auto / brep / mesh

对应 architecture.md §4.1 的执行策略，在执行核心内的落地契约：

| 模式 | dispatcher 行为 | 断链后果 |
|---|---|---|
| `auto`（默认） | 执行前静态扫描语句序列，判定每条语句走 BREP 还是 mesh。判定规则：op 在 `BREP_NATIVE_OPS` 中且源文件为 CAD 格式 → BREP；op 在 `MESH_ONLY_OPS` 中 → mesh。**静态判定为 BREP 的语句执行异常即报错，不回退 mesh**。`breakBrepChain` 仅在静态判定不支持时触发 → 后续语句走 mesh 路径；`ports.events.emit('brep-chain-broken', { partId, op, reason })`（browser host → toast 通知用户；node host → 写入 `result.infos`） |
| `brep` | 同上，但禁止回退 | 静态判定不支持的 op 即失败：`ExecuteResult.error = { stage: 'execute', code: 'E_BREP_UNSUPPORTED', op, index }`——结构化报错、指明触发 op，**不自动切换** |
| `mesh` | 全部语句走 mesh 路径（BrepChainState 不初始化） | 无断链概念 |

- **BREP 路径是否可用由静态规则判定，不是运行时 try-catch 判定。** 静态规则：op 是否在 `BREP_NATIVE_OPS` 集合中 + 源文件是否为 CAD 格式（`isCadFormat`）。
- **严禁运行时 BREP→mesh 回退**：BREP 路径执行抛异常 = 设计缺陷或 bug，必须直接报错暴露，禁止 try-catch 后静默切 mesh。现 `canUseBrep(ctx)` 静态分流（`ops/types.ts:38`）的机制保留；移除 `replay` 中捕获 BREP 异常后 `breakBrepChain` 重试 mesh 的逻辑。
- **模式来源优先级**：`ExecuteOptions.mode`（单次执行显式指定）> Host 默认值（browser：用户设置项，Tier A 字段可 undo；node：CLI `--mode`）> `'auto'`。
- **未来只支持 brep、不支持 mesh 的 op**：目前不存在，不处理；出现时按对称规则——`mesh` 模式下报 `E_MESH_UNSUPPORTED`，`auto` 模式优先 brep 天然覆盖。
- ⚠️ 连带修订：`code-engine-api-contract.md` §5 的"BREP 路径失败自动回退 Mesh 路径"表述已改为静态规则判定（**BREP 异常不回退 mesh**）。

---

## 5. Headless 执行设计

### 5.1 Worker 策略：Backend 双实现

| 后端 | browser host | node host |
|---|---|---|
| CsgBackend | `CsgWorkerBackend` = 现 `csg.ts` 原样（`?worker` + postMessage） | `InlineCsgBackend` = 主线程直跑 manifold-3d（`csg.test.ts:5-31` 的 inline 模式产品化） |
| SdfBackend | `SdfWorkerBackend` = 现 `sdf-runner.ts` | `InlineSdfBackend`（SDF 求值本身是 wasm/纯计算，同法直跑） |
| OCCT | 主线程 kernel（现 occtWasmKernel 浏览器分支） | 主线程 kernel（**已有** fs 分支，ops.test.ts 验证过） |

**为什么 inline 而不是 node Worker**：Node 18+ 虽有 `worker_threads`，但 csg-worker 用 vite `?worker` 语法构造、worker 内动态 `import('manifold-3d/manifoldCAD')` 走打包产物——在 CI 里复刻这套构建得不偿失；`csg.test.ts` 已证明 manifold-3d 在 Node 主线程可直接跑。**正确性由"双后端一致性测试"保证**（§8）：同一组 op 输入，Worker 后端与 Inline 后端的输出几何指纹必须一致——这同时就是 CLAUDE.md 要求的"mesh 版本和 brep 版本生成的最终 mesh 一致"的同类验证。

性能权衡：node inline 阻塞主线程——CLI/CI 场景无 UI，可接受；browser 保持 worker 不变。

### 5.2 三处硬 DOM 残留的处置

1. **`window.dispatchEvent('brep-chain-broken')`** → `ports.events.emit`；browser host 的 EventSink 内部再 dispatch + toast，node host 写入 `result.infos`。
2. **knurl 纹理采样** → `TextureSampler` Port。node 实现：纹理 PNG 经纯 JS 解码（如 `pngjs`，构建期不引 DOM）。若未提供纹理采样器，knurl op 在 node 显式报 `E_CAPABILITY`，不静默降级。
3. **CJK `queryLocalFonts`** → `FontProvider` Port。node 无系统字体枚举能力：`cad.text`/`engrave` 遇 CJK 且无注册字体时报错并列出可用字体资产 key。

### 5.3 CLI 与产物导出

```
node scripts/faijs-cli.mjs check model.faijs
  → dryRun：parse（acorn 闸门）→ schema 校验（含 unknown-key 报错，§6.8）
    → GeomRef/输入引用预检 → 输出 { ok, errors[], warnings[] }，exit code 0/1

node scripts/faijs-cli.mjs run model.faijs --out bracket.step
node scripts/faijs-cli.mjs run model.faijs --out bracket.stl --format mesh
node scripts/faijs-cli.mjs run model.faijs --out bracket.step --mode brep   # 强制 brep，断链即报错（§4.4）
  → createRuntime(nodePorts) → execute → getTerminalGeometry
  → .step：brepChain 终端 solid → kernel.exportStep（导出能力现 exporters/index.ts:703 已有，上提到 L1）
  → .stl：Shape → buildStlBuffer（现 scene-mutator.ts:148-151 的生成逻辑上提到 L1，纯数据无 DOM）
  → 多终端：--out 为目录，按终端 name/partId 各产一件

node scripts/faijs-cli.mjs run model.faijs --assets ./assets/
  → loadByKey 的 key 从 assets 目录 manifest（key → 文件路径）解析
```

**与 CI 的关系**：CI 新增一步 `faijs-cli check test/faijs/*.faijs`（离线、秒级）+ 若干 golden 回归（`run` 产出与基线几何指纹比对）。这满足"CI 离线跑几何"且不引入 e2e 开销。

### 5.4 AI dryRun 通道的归一

现有三条"验证"通道收敛为一条：

| 通道 | 现状 | 重构后 |
|---|---|---|
| `executeScript(dryRun:true)`（bridge 命令） | 长在浏览器宿主 | = `runtime.check(code)`，bridge 薄转发 |
| AI 提交前自检 | 无 | 同一 `check`（viewer 内经 bridge / 外部经 CLI） |
| CI 离线校验 | 无 | 同一 `check`（CLI） |

`check` 的输出契约（设计契约）：

```ts
interface CheckResult {
  ok: boolean
  errors: { stage: 'parse'|'schema'|'reference'; message: string; line?: number; stmtId?: string }[]
  warnings: string[]
  /** 供 AI 自我修正的结构化上下文：语句数、op 清单、各 op 缺失/多余参数 */
  script?: { statements: number; ops: string[]; apiVersion: number }
}
```

---

## 6. faijs API 修订设计

总原则（吸收 inventory §6.2 的教训）：**引用要稳定、状态要派生、语义要单一、键名要一域**。

### 6.1 统一 async：取消文本层同步/异步之分

**回答 inventory 文末的质疑**（"为何有同步异步之分？难道不应该调用方决定吗"）：当前区分是纯历史噪音——

- parser **完全忽略** await（`parser.ts:210,622` 剥掉 AwaitExpression，不校验）；
- 执行层 `executeStatement` **全部 async**（`dispatcher.ts:77`）；
- 文本里的 await 只是 codegen 按静态清单 `ASYNC_OPS`（`codegen.ts:30-43`）加的记号，且已与实现漂移（knurl 实现是 async 却不在清单；api.d.ts 把 svgExtrude 声明为同步）；
- 异步的真实根源是**后端能力**（worker 通信、字体加载、文件 IO），不是 op 语义——同一 op 换后端同步性就变（occt 同步、manifold worker 异步），所以同步性根本不该写进 API 契约。

**修订**：所有 `cad.*` op 契约统一为 `Promise<Shape>`；codegen 对一切 op 语句统一输出 `await`；parser 维持忽略（向后读旧文本不受影响）。删除 `ASYNC_OPS` 清单。`api.d.ts` 同步修正。这是对"合法 JS 子集"语法规则的局部修订（`faijs-syntax-design.md` §2.3 的 `[await]` 变为恒有），需同步更新该文档。

### 6.2 split：修复文本参数断裂

现状：`codegen.ts:205-212` 输出 `normal/offset`，`ops/split.ts:38-43` 只读 `planeRotation/planePosition`——非默认平面无法文本复现，且错键静默通过校验（§3 核实）。

修订（三条路一起改）：

- **语句契约的首选参数改为用户语义**：`normal: Vec3`、`offset: number`，扩展 `inPlaneAngleDeg?: number`（切割面绕法线的面内旋转，承载现 `planeRotation` 的 rz 分量——燕尾/榫卯的 widthDir 需要它）。
- **执行层**：`executeSplit` 首选读 `normal/offset/inPlaneAngleDeg`，经**单一实现** `computePlaneParams`（现 `cad-core/split.ts:28-53` 上提 L1）派生 basis；`codegen.ts:102-118` 手写的 `eulerXYZToNormal` 复刻删除（双份平行实现收敛）。
- **codegen**：直接序列化 `normal/offset/inPlaneAngleDeg`；**schema** 补这三个键并按 §6.8 拒绝 unknown-key。
- 回归测试：旋转平面（含 rz）→ 文本导出 → 重新导入 → 几何指纹一致。

### 6.3 load 四联收敛

现状：`load`/`loadFile`/`loadUrl`/`loadByKey` 语义重叠（`ops/load.ts:183-225`），录制决策树 `ScriptEngine.ts:915-931` 按环境产不同 op，且 `sourceBufferKey` 录制有、codegen 漏。

修订为**单 op、互斥三键**：

```js
const p = await cad.load({ key: 'file_abc123' })              // 资产引用（首选）
const p = await cad.load({ path: 'D:/models/box.step' })      // 本地文件（node/electron）
const p = await cad.load({ url: 'https://…/box.glb' })        // 网络
```

- schema：`key/path/url` 恰居其一，否则校验报错；共用 `format?: string`。
- `sourceBufferKey` **随之消亡**：前端已完整处理 STEP、不再做 STEP → GLB 转换（architecture.md §4），"STEP 原始字节 vs GLB 转换字节"的双字节问题不复存在。资产格式由 `format` 判定：CAD 格式走 BREP 导入（`kernel.importStep`），其余走 mesh 导入；GLB 仅在只读预览后端转换结果的场景出现，按 mesh 处理。
- 执行层 `executeWithBuffer`（load.ts:145-170）的 CAD/非 CAD 分流不变。

### 6.4 svgExtrude 重做（P0）

现状三错：整份 SVG XML 拷贝进参数（`codegen.ts:306-311`）；自然尺寸两套实现隐式推导且 mesh 侧 `scale=1` bug（`svg-extrude/index.ts:48-49` + `cad-core/primitives.ts:197-198` 默认 0）；`naturalWidth/Height` 录制有、codegen/schema 漏。

新契约：

```js
const s = await cad.svgExtrude({ svg: { $asset: 'logo_svg_key' }, depth: 5, targetLongSide: 20 })
```

- `svg` 为**资产引用**（`{ $asset: string }`），内容经 `ports.assets.resolveByKey` 获取，永不进文本参数。
- 尺寸语义显式化：`targetLongSide` 必填；自然尺寸由解析器从 SVG viewBox/width/height 派生（`parse-svg-size.ts` 保持单一真源），派生不出时报错而非静默 `scale=1`。
- BREP 后端已具备（`svgBlueprints.ts` 的 makeWire/makeFace/extrude 管线）；mesh/BREP 的缩放语义（现 mesh z 不缩放、BREP 均匀缩放靠 Z=0 巧合对齐）在新实现里显式定义为"轮廓在 XY 平面等比缩放后沿 Z 挤出 depth"。

### 6.5 engrave 修订（P0：logo 分支重做）

- **logo 分支**：`svgText` → `{ svg: { $asset } }` 资产引用（同 §6.4）；`svgSize` 补进 schema + codegen（修"录制有导出丢"）；`svgNaturalWidth/Height` 同 §6.4 改为派生，不入参数。
- **面锚定**：`faceCenter`/`faceNormal` 从绝对坐标快照改为**只接受 GeomRef**（`cad.faceCenter(of, [anchor])` / `cad.faceNormal(of, [anchor])`——文本层 parser/codegen 已支持，缺的是 UI 录制改为生成 GeomRef）。无历史兼容红线下直接切换，不留 Vec3 快照分支。
- **删除 `engravingType`**：内容由 `text`/`svg` 二选一决定（录制/执行双推导点 `ScriptEngine.ts:298`、`ops/engrave.ts:134` 一并删除）。
- 顺带修双路径分歧：BREP 路径的 +0.01 共面 epsilon 与 worldToLocal 变换（`ops/engrave.ts:212-217,29-40`）需显式定义进契约，保证同语句双后端结果一致（§8 一致性测试覆盖）。

### 6.6 drill / api.d.ts / screwHole / screw

- **drill**：真实契约（`holeType`、`direction` 枚举 `'normal'|'x'|'y'|'z'`）不变；`type:'through'|'blind'` 是内部派生量（`ops/drill.ts:206` 由 depth 派生），**从一切对外素材删除**。
- **api.d.ts 改为生成物**：构建期脚本从 args-schema + op 注册表生成 `api.d.ts`（AI 提示素材），删除手写文件。生成的素材天然含 knurl/sdf/load/group/assembly/GeomRef helper，消灭漂移面。CI 加"生成物与提交物一致"检查（同 protobuf 生成物的惯例）。
- **screwHole**：删除独立 FeatureKind，五处清理（`types.ts:46`、`parser.ts:80`、两处 kind→commandType 映射、`feature-registry.tsx:559-560` 回退）。螺丝孔正式定义为 `drill` 的 `holeType:'screw'` 参数形态。
- **screw.pitchCustom**：codegen 补输出（`codegen.ts:295-303`），加往返测试。

### 6.7 text.font / wedge / 小项收敛

- **text.font**：当前 mesh/BREP 两侧实现都无视该参数（`cad-core/primitives.ts:147-167`、`ops/text.ts:43-54`），且两套语义（THREE typeface 名 vs opentype 注册表 key）无法对齐。**删除该参数**；未来支持多字体时以字体资产 key 形态重新引入。
- **wedge**：收敛为**单一四键形态** `width/height/angle/length`。理由：`size`（包围盒）无法表达 `angle`，是有损形态——且现状是 UI 录制四键、codegen 只输出 size，**UI 建的楔形根本出不了文本**（导出后四参数全丢回退默认值）。codegen/schema/`api.d.ts` 对齐四键；`cad.wedge` 核心的双形态兼容分支（`cad-core/types.ts:71-83`、`primitives.ts:98-104`）删除 size 兜底。
- **knurl**：面锚定同 §6.5 GeomRef 化；`api.d.ts` 补 knurl（生成机制自动覆盖）。

### 6.8 一致性机制（防回潮，是本次 API 修订的根基）

| 机制 | 内容 | 位置 |
|---|---|---|
| **schema ↔ codegen 键集一致性测试** | 遍历 op 注册表：schema 声明的键集 == codegen 输出的键集 == 录制写入的键集，三者两两断言 | L0 单测（现仅有 `op-set-consistency.test.ts` 校验 op 集合，扩展到 arg 键集） |
| **unknown-key 报错** | `validateStatementArgs` 遇未声明键报错（现 `args-schema.ts:302-314` 静默放行）——split 断裂类问题从此在 check 阶段即暴露 | L0 args-schema |
| **api.d.ts 生成物检查** | CI 校验生成物与提交物一致 | CI 脚本 |
| **文本往返保真测试** | 每个 op 至少一条：语句 → codegen → parse → 语句，args 深度相等；含参数的几何指纹一致（§8） | L0/L1 单测 |

### 6.9 装配面引用收敛

（对应 inventory §6.2，列为改进项，不阻塞本重构主线）

- 面引用收敛为**单一稳定 `faceId`**：`faceRowIndex` 不再进约束数据，运行时由 faceId 经 `SelectorRuntime` 反查行索引（`assemble-store.ts:668-673` 的 `getFaceRow` 改为按 id 查）；前提是 brep-topology 保证拓扑重建后 FaceRow.id 稳定。
- **`invalid` 改为派生量**：不进约束数据、不随 `.faijs` 序列化；codegen/parser/executeScript 三处 constraints 透传过滤该键（`codegen.ts:838-851`、`executeScript.ts:537-543`）。
- 约束类型扩展（轴向对齐/共面/距离）属后续独立设计，本文不展开。

---

## 7. 分阶段实施计划

每阶段独立可验证、可提交；严格 one-by-one 推进。

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P0 API 快修** | split 三件套（§6.2）、pitchCustom codegen、screwHole 删除、svgSize 补 schema/codegen、unknown-key 报错、schema↔codegen 键集一致性测试 | 旋转平面 split 文本往返几何指纹一致；一致性测试通过；现有单测不回归 |
| **P1 文本层抽离（L0）** | `src/faijs/` 建立：parser/codegen/schema/types 迁入；`isGeomRef/isParamRef` 上提，斩断 codegen→occt 传递依赖；统一 async（§6.1） | L0 零依赖（仅 acorn）由 ESLint 守护；`npx vitest run src/faijs` 全绿 |
| **P2 执行核心解耦（L1+L2）** | Ports 接口落地；csg/sdf 后端抽象（browser worker 实现平移）；dispatcher 改 mode-aware（§4.4，`auto`/`brep`/`mesh`），断链通知改经 EventSink；statementCache/_brepSolidCache 实例化；undo/场景落地从 executeScript 移入 browser host；`CadRuntime` 成形；E-1/E-2 ESLint 边界 | `ops.test.ts` 全部改为经 `createRuntime(nodePorts)` 驱动且通过；三模式行为各有契约测试；browser 端现有组件/e2e 测试不回归 |
| **P3 Node host + CLI** | InlineCsg/InlineSdf 后端、NodeFontProvider、fs/目录 AssetResolver、buildStlBuffer/exportStep 上提；`faijs-cli check/run` | CLI 对示例 `.faijs` 产出 STL/STEP；几何指纹与 browser 执行一致；CI 接入 check 步骤 |
| **P4 API 重做** | svgExtrude 资产引用化（§6.4）、engrave logo 分支（§6.5）、load 收敛（§6.3）、wedge 四键（§6.7）、text.font 删除、api.d.ts 生成化（§6.6）、GeomRef 化录制 | inventory §7 表全部条目关闭；AI 端到端（生成→check→执行）冒烟通过 |
| **P5 收尾收敛** | `partScripts` 收敛进 `sceneScript`（CLAUDE.md 红线 5）；装配面引用 faceId 化（§6.9）；文档同步（faijs-syntax-design.md / code-engine-api-contract.md / architecture.md） | 冗余结构删除；三份文档与新实现逐条核对一致 |

**顺序理由**：P0 先修最痛的 API 断裂（独立于重构、立即受益）；P1/P2 是解耦主体（P3 的地基）；P3 交付用户点名的 headless 能力；P4 的 API 重做依赖 P2 的 Ports（资产引用需要 AssetResolver 落地）；P5 处理跨阶段收尾。

**风险与对策**：
- **P2 是最大变更面**（undo/场景落地搬家）。对策：browser host 包装层先做"纯平移不改语义"，用现有 e2e（undo/脚本加载相关 spec）做回归基准，逐 spec 验证。
- **Inline 与 Worker 后端结果漂移**。对策：§8 双后端一致性测试作为 P2 验收硬门槛。
- **装配 marker 依赖 store 重建**（executeScript.ts:520-570）。对策：marker 语义保留在 L2（语句层），store 重建逻辑整体移入 browser sink。

---

## 8. 测试策略（提纲）

| 层 | 测点 | 方法 |
|---|---|---|
| L0 文本层 | parser/codegen 往返保真（每 op）；schema↔codegen↔录制键集一致；unknown-key 报错；统一 await 输出 | vitest node，纯文本无几何 |
| L1 执行层 | 每 op 的 BREP 路径（沿用 ops.test.ts 模式）；**mesh 路径 Inline 后端补全**（现 Node 下 skip 的 drill/split/extrude/boolean/engrave 全部解除 skip）；**双后端一致**：同输入下 mesh-inline / mesh-worker / brep 三路最终 mesh 指纹一致（体积/bbox/三角数+采样点距，contentKey 语义见 code-engine-api-contract §11.4） | vitest node，真实 OCCT/manifold |
| L2 编排层 | dryRun 零副作用断言；增量 diff（UNCHANGED/PARAM/STRUCT/ADD/DELETE 五分类 + suffix 重放范围）；runtime 实例隔离（两实例缓存互不可见）；执行模式三态契约（`auto` 静态判定断链+EventSink 通知 / `brep` 断链报 `E_BREP_UNSUPPORTED` 不切换 / `mesh` 不初始化 BrepChainState）；**严禁运行时 BREP→mesh 回退** | vitest node |
| L3-node | CLI check/run：示例 `.faijs` → STL/STEP golden 指纹比对；loadByKey manifest 解析；错误路径 exit code | vitest node（fork 子进程跑 CLI） |
| L3-browser | 现有组件测试 + 相关 e2e spec（脚本加载/undo/时间轴）回归；bridge `executeScript(dryRun)` 命令 | vitest jsdom + playwright 单 spec 逐个验证 |

---

## 9. 附：API 缺陷核实结论（2026-08-12 代码证据）

inventory §7 全部条目经代码核实属实，关键证据：

| 条目 | 关键证据 |
|---|---|
| split 断裂 | codegen 输出 normal/offset（`codegen.ts:205-212`）vs 执行只读 planeRotation/planePosition（`ops/split.ts:38-43`）；错键被 schema 静默放行（`args-schema.ts:302-314`） |
| api.d.ts 漂移 | `api.d.ts:66-79` 的 `type/direction` 向量 vs 真实契约 `holeType`/枚举（`ops/drill.ts:35-47`）；另漂移 engrave `face:{}` 嵌套、svgExtrude 同步签名、缺 knurl/sdf 等 |
| pitchCustom | schema 有（`args-schema.ts:92`）执行有（`ops/screw.ts:29`）codegen 漏（`codegen.ts:295-303`） |
| screwHole | parser 接受（`parser.ts:80`）dispatcher 无 case → 执行必炸（`dispatcher.ts:183-184`） |
| load 四联 | 统一入口 `ops/load.ts:183-225`；sourceBufferKey codegen 漏 |
| svgExtrude | mesh scale=1（`svg-extrude/index.ts:48-49`）；naturalWidth/Height codegen/schema 双漏 |
| engrave logo | svgSize 录制有（`ScriptEngine.ts:296`）schema/codegen 漏；mesh 路径重放根本不传 svgSize（`ops/engrave.ts:133-143` → `cad-core/engrave.ts:60`） |
| text.font | 两侧实现均无视参数（`cad-core/primitives.ts:147-167`、`ops/text.ts:43-54`） |
| wedge | UI 录制四键（`WedgePanel.tsx:178-184`）codegen 只输出 size（`codegen.ts:165-168`）→ UI 楔形出不了文本 |
| 装配面引用 | `getFaceRow` 只用 faceRowIndex 查数组（`assemble-store.ts:668-673`）；invalid 随 constraints 序列化（`codegen.ts:838-851`） |
