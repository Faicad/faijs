# 代码引擎 API 接口契约（代码 / 语句层）


## 1. 分层与职责边界

```
┌─────────────────── 文本 / 桥接层 ───────────────────┐
│  executeScript / getScript / editParam / getParamSchema   │ ← 对外命令（§9）
└───────────────────────────┬──────────────────────────┘
                              │ 解析为 PartScript
┌────────────────────────────┴─────────────────────────┐
│  ScriptEngine（录制 + 执行编排）                         │
│   record*() 产生语句  ·  executeScript() 加载代码       │ ← §7 / §8
└───────────────┬───────────────────────┬───────────────┘
                │ 语句 op                │ 模型构成
       ┌────────▼─────────┐    ┌────────▼──────────┐
       │  执行分派层        │    │  SceneMutator      │
       │  （分派 + BREP/Mesh │    │  建/改/删零件      │
       │   双路径执行）      │    └───────────────────┘
       └───────────────────┘
```

铁律（写进契约，后续任何实现都不得违反）：

- **R-1 单一几何实现**：语句 op 与几何核心函数是一一映射，参数编排只发生在几何核心内（含派生量如平面参数、drill 的 `direction` 枚举解析等）。禁止出现「UI 一份、重放一份」两份实现。存在唯一的分派入口，按 op 分派到各自的执行模块；每个 op 内置 **BREP 与 Mesh 两条执行路径**，BREP 与 Mesh 路径的切换由**静态规则**判定（op 白名单 + 源文件格式），**严禁运行时 try-catch BREP 异常后回退 Mesh**。
- **R-2 单一模型构成实现**：零件创建 / 几何替换 / 删除，以及随之的命名、id、partInfos、材质外观，一律经 `SceneMutator`（§10）。理由是「代码路径需要一个建完整零件的入口，避免出现第三套实现」，**不是**「让两条路径算出相同的值」。`SceneMutator` 不感知语句、不感知 undo 粒度。

---

## 2. 基础值类型

```ts
export type Vec3 = [number, number, number]      // 右手系 +Z 向上，毫米，角度用度

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[] | { [k: string]: JsonValue }

/** 几何核心的核心几何类型。 */
export interface Shape {
  positions: Float32Array   // (x,y,z) 交替
  indices: Uint32Array      // 三角形索引
}
```

**坐标空间约定**：所有 `cad.*` 输入/输出均为**世界空间** `Shape`；局部↔世界变换由执行器负责，几何核心不读网格的世界矩阵。

---

## 3. 引用类型（区别于字面量）

```ts
/** 参数引用：执行前从 PartScript.params 求值。 */
export interface ParamRef { $param: string }

/** 语义引用：对上游几何的派生位置，重算时自动跟随。 */
export interface GeomRef {
  $geom: {
    of: string                              // 上游语句 id（ShapeRef）
    feature: 'bboxCenter' | 'faceCenter' | 'faceNormal' | 'bboxMin' | 'bboxMax'
    anchor?: { point: Vec3; normal?: Vec3 }  // 拾取时记录的 point+normal
    faceOrdinal?: number                    // 拓扑面序号（getSubShapes(shape,'face') 中的索引），优先于 anchor
  }
}

export type Arg = JsonValue | ParamRef | GeomRef
export type ShapeRef = string                 // 即语句 id
```

`GeomRef` 的求值语义见 §6.3：用 `of`（上游语句 id）取几何 → 按 `feature` 求位置；`faceCenter/faceNormal` 优先按 `faceOrdinal`（拓扑面序号）直接取面，失败或无 ordinal 时用 `anchor` 找回最近面，最终降级 `bboxCenter`。

---

## 4. 语句模型（核心契约）

```ts
export interface CadStatement {
  id: string                 // 形如 st_<partLocalSeq> 或 partN_vM（见 §11.2）
  op: string                 // 见 §5 目录，必须命中白名单
  args: Record<string, Arg>  // 该 op 的完备参数集（见 §5 逐 op 契约）
  inputs: ShapeRef[]         // 上游语句 id（顺序敏感，见各 op）
  name?: string              // 由 SceneMutator 按 op 派生，不进 args（见 §10）
  feature: FeatureMeta
  isMarker?: boolean         // 标记型语句：不进 replay 执行序列，仅供 Timeline 展示
                              //   与 codegen 跳过（如 split 源 part marker、group/assembly marker）
  model?: string             // 所属模型号（partN），多 mesh DAG 区分不同模型
  outputs?: string[]         // 多输出 op 的输出 id 列表（split 写 ['partN_vM','partN_vK']）
  seq?: number               // 全局序列号，timeline 跨 part 线性排序用
  groupScopedId?: string     // group/assembly marker 关联的场景 scopedId
}

export type FeatureKind =
  | 'load' | 'primitive' | 'transform' | 'drill' | 'screwHole'
  | 'split' | 'extrude' | 'boolean' | 'engrave' | 'knurl' | 'sdf'
  | 'group' | 'assembly'

export interface FeatureMeta {
  kind: FeatureKind
  label: string
  createdBy: 'user' | 'ai' | 'script'
  alternateParams?: Partial<Record<FeatureKind, Record<string, Arg>>>
}

export interface ParamDef {        // 参数表项
  name: string
  type: 'number' | 'vec3' | 'bool' | 'enum'
  value: JsonValue
  default: JsonValue
  min?: number; max?: number
  options?: string[]
  label?: string
}

export interface PartScriptMeta {  // 零件级模型属性（往返保真载体）
  name?: string
  appearance?: { color?: string; metalness?: number; roughness?: number }
}

export interface TerminalShape {   // 多 mesh 终端
  id: string
  meta?: PartScriptMeta
}

export interface PartScript {
  partId: string
  source?: { kind: 'load' } | { kind: 'sdf' }
  params: ParamDef[]
  statements: CadStatement[]       // 拓扑序：被依赖的语句在前
  /** 零件级模型属性。缺省 → SceneMutator 按 op 兜底派生（默认名 + 兜底配色）。 */
  meta?: PartScriptMeta
  /** 多 mesh 终端集合（return [ { shape, meta }, ... ]）；单 mesh 简写时为 undefined。 */
  terminalShapes?: TerminalShape[]
}
```

**`meta` 的定位（往返保真的载体）**：颜色与用户改过的名字**不可从建模参数推导**，因此必须显式记录，否则 `getScript → executeScript` 往返后会丢失。放 part 级 / `TerminalShape` 级而非 `args`——它们是零件属性，不是几何参数。实际载体是文本 `return` 对象（见 §11.1），**不是** `export default … with { … }` 属性导入语法（`with` 在 module 严格模式为保留字，文本语法从不使用）。

**注意**：代码路径**不需要复刻**鼠标路径的配色/命名算法。它只携带结果值，执行端照做；代码没写时才走兜底。兜底配色使用全局计数器，保持原样，不是缺陷。

`CadStatement.name` 是语句的显示名（Timeline 用），与 `meta.name`（零件名）是两回事，勿混。

---

## 5. 语句 op 目录与参数契约

**单一命名域原则**：每个 op 的 `args` 键名**等于**对应几何核心函数的参数名。`record*` 录制、`executeStatement` 执行、文本 parser 三条路径共用同一份命名与同一份 arg schema 校验（§11.3）。下表是**契约**（应然的参数完备集）。

> 约定：`inputs` 列标注该 op 是否需要上游几何；所有特征/变换类 op 的几何核心调用在 `inputs[0]` 缺失时拒绝执行。op 走 BREP 还是 Mesh 路径由静态规则判定（`BREP_NATIVE_OPS` / `MESH_ONLY_OPS` + 源文件格式），**BREP 路径执行异常直接报错，不回退 Mesh**。

### 5.1 创建类（无 inputs）

| op | 几何核心调用 | args 契约（= 几何核心参数名） |
|----|---------------|-------------------------------|
| `box` | `cad.box` | `size: Vec3\|number`、`center?: Vec3` |
| `sphere` | `cad.sphere` | `radius: number`、`segments?: number` |
| `cylinder` | `cad.cylinder` | `radius`、`height`、`segments?` |
| `cone` | `cad.cone` | `radiusBottom`、`radiusTop`、`height`、`segments?` |
| `wedge` | `cad.wedge` | `size: Vec3\|number`（向后兼容）或 `width/height/angle/length` |
| `text` | `cad.text`（async） | `text`、`size`、`depth`、`font?` |
| `screw` | `cad.screw`（async） | `system`、`specIdx`、`thread`、`length`、`head`、`nRad?`、`pitchCustom?` |
| `svgExtrude` | `cad.svgExtrude` | `svg`、`depth`、`targetLongSide?` |
| `load` | `cad.load`（async） | `fileRef: string`、`sourceBufferKey?: string`、`format?` |

> 注：原 `import` op 已更名为 **`load`**（见 §4 `FeatureKind` / `PartScript.source`）。

### 5.2 变换类（inputs[0] = 被变换几何）

| op | 几何核心调用 | args 契约 |
|----|---------------|-----------|
| `translate` | `cad.translate` | `offset: Vec3` |
| `rotate` | `cad.rotate` | `anglesDeg: Vec3`、`pivot?: Vec3` |
| `scale` | `cad.scale` | `factor: number\|Vec3` |

### 5.3 特征类（inputs[0] = 载体几何）

| op | 几何核心调用 | args 契约 |
|----|---------------|-----------|
| `drill` | `cad.drill`（async） | `diameter`、`depth?`、`type:'through'\|'blind'`、`position:Vec3`、`direction:Vec3\|enum`、`faceNormal:Vec3`、`tolerance?`、`holeType?:'simple'\|'screw'`、`screwSystem?`、`screwSpecIdx?`、`screwThread?`、`screwHead?` |
| `extrude` | `cad.extrude`（async） | `normal:Vec3`、`originOffset:number`、`length:number`、`mode?:'centered'\|'forward'\|'backward'` |
| `engrave` | `cad.engrave`（async） | `engravingType:'text'\|'logo'`、`mode:'convex'\|'concave'`、`depth`、`face:{center,normal}`、`text?`、`textSize?`、`svgText?`、`svgSize?`、`svgNaturalWidth?`、`svgNaturalHeight?` |
| `split` | `cad.split` / `dovetailSplit` / `dowelSplit` / `tenonSplit`（async） | 见 §5.4；产出 front/back 多输出写入 `stmt.outputs` |
| `boolean` | `cad.union/subtract/intersect`（async） | `operation:'union'\|'subtract'\|'intersect'`；`inputs` ≥2（顺序敏感：subtract/intersect 以 inputs[0] 为主体） |
| `knurl` | `cad.knurl` | `face`、`knurlTextureHeight?`、`knurlInvertDisplacement?`、`knurlRefineLength?`、`knurlScaleU?`、`knurlScaleV?`、`knurlMappingMode?` |
| `screwHole` | — | 暂无独立几何核心函数；执行走 `drill` 的 `holeType:'screw'` 分支 |
| `sdf` | — | `code:string`、`box:[Vec3,Vec3]`、`resolution?`、`params?` |

### 5.4 `split` 完整 args 契约

`split` 按 `cutMode` 分发，args 为下列完备集（派生量 `planeCenter/widthDir/bboxWidthOnWidthDir` **不入 args**，由几何核心同公式推导）：

```
cutMode: 'plane'|'dovetail'|'dowel'|'straight-tenon'|'tenon'|'straight'
planeRotation: Vec3 (°)      planePosition: number (标量)
bbCenter: Vec3               bboxSize: Vec3        space: 'local'|'world'
side: 'front'|'back'         // 源 part 上那条 marker 语句需要，执行态消费以确定主输出
applyExplode: boolean        // 显示态位移，非建模态
// dovetail：
grooveDepth, grooveWidth, grooveDepthTolerance, grooveWidthTolerance, grooveFlapsAngle
// dowel：
dowelDiameter, dowelDiameterTolerance, dowelHeight, dowelHeightTolerance, selectedSections?
// tenon：
tenonSideLength, tenonSideLengthTolerance, tenonHeight, tenonHeightTolerance, selectedSections?
```

---

## 6. 执行契约（replay / load 共用的计算核心）

### 6.1 单条执行

```ts
async function executeStatement(
  stmt: CadStatement,
  inputGeometries: Shape[],
  outputCache?: Map<string, Shape>,
  params?: Record<string, unknown>,   // 参数表（executeScript 构建）
  brepChain?: BrepChainState,         // BREP 链状态（几何内核 + solid 缓存）
): Promise<Shape>
```

- 先 `resolveArgs`（字面量透传；`ParamRef`→参数表求值；`GeomRef`→§6.3 解析），再按 `stmt.op` 分派到对应执行模块（BREP/Mesh 双路径）。
- `op` 命中 §5 白名单；未命中 → 拒绝执行。
- **输入约束**：特征/变换类 op 要求 `inputs[0]` 存在，缺失则拒绝执行。

### 6.2 整段重放

```ts
async function replayScript(
  script: PartScript,
  inputGeometryMap?: Map<ShapeRef, Shape>,
  params?: Record<string, unknown>,
): Promise<ReplayOutput>   // { contentKey, shape, brepActive?, breakReason?, brepChain? }
```

- 按 `statements` **拓扑序**逐条执行；`isMarker` 语句跳过（不执行、不写缓存）。
- 每条输出按 `stmt.id` 写入 `outputCache`；多输出 op 还会写入 `stmt.outputs` 各 id。
- 输入解析：先查本 part `outputCache`，再查 `inputGeometryMap`（跨 part 上游）。
- 最终输出 = **最后一条非 marker 语句**的输出；空脚本（无非 marker 语句）拒绝执行。
- 始终贯穿一条 `BrepChainState`，终端 solid 句柄保留在返回的 `brepChain` 中供导出。
- `contentKey` 为几何等价度量手段（见 §11.4），用于判定 T-1 自包含。

### 6.3 引用解析

- **GeomRef**：用 `of`（上游语句 id）取几何 → 按 `feature` 求位置；`faceCenter/faceNormal` **优先按 `faceOrdinal`**（拓扑面序号，`getSubShapes(shape,'face')[ordinal]`）直接取面，失败或无 ordinal 时用 `anchor`（point+normal）找回最近面，最终降级 `bboxCenter`。`faceOrdinal` 由录制时从 `SelectorRuntime.faces` 获取，在确定性重放下稳定；上游参数编辑导致 ordinal 失效时自动降级 anchor。
- **ParamRef**：`params[paramName]`，缺则 `null`。参数表真实流转——`executeScript` 将 `script.params` 与调用方 `params` 合并贯穿执行，`editParam` 通过改 `script.params` 驱动增量重算。
- **跨 part 解析**：`replayScript` 收 `inputGeometryMap` 参数；跨 part 引用通过场景级单一 DAG 的 `inputs` 同图解析。

---

## 7. 录制 API（鼠标路径 → 语句）

这些是**产生语句**的入口。契约要求它们写出的 `args` 严格满足 §5，保证「鼠标路径产出的语句」与「代码路径写的语句」可被同一条 `executeStatement` 执行。

> 语句只承载**几何**。零件的名字与外观走 `PartScript.meta`（§4），由 codegen 在导出时从 store 读取实际值写入 `return` 对象，不经 `record*`。

| 方法 | 产出 op |
|------|--------|
| `recordPrimitive(partId, primitiveType, params)` | `box/sphere/cylinder/cone/wedge` |
| `recordDrill(partId, params)` | `drill` |
| `recordSplit(partId, params)` | `split`（含源 part 上的 marker 语句） |
| `recordExtrude(partId, params)` | `extrude` |
| `recordBoolean(partId, params)` | `boolean` |
| `recordEngrave(partId, params)` | `engrave` |
| `recordKnurl(partId, params)` | `knurl` |
| `recordLoad(partId, fileRef, format?, sourceBufferKey?)` | `load` |
| `recordTransform(partId, ...)` | `translate/rotate/scale` |
| `commitAndRecord(...)` | 提交几何 + 落语句 |
| `replayPart(partId)` | 调 `executeStatement` 重放 |
| `plan(partId)` | 返回 `{stale, reused}` 增量计划 |
| `recomputePart(partId)` | 增量重算 |
| `getScript(partId)` | 返回 `PartScript`（文本由 codegen 生成） |

**契约约束**：上述 `record*` 写入的 `args` 键名必须等于 §5 中对应 op 的几何核心参数名（单一命名域）。

---

## 8. 加载执行契约（代码路径入口）

这是「加载代码」对外暴露的执行 API，桥接层薄包装它。

```ts
type UndoGranularity = 'statement' | 'block'

interface ExecuteScriptOptions {
  partId?: string
  params?: Record<string, JsonValue>
  dryRun?: boolean                                   // 仅 parse+validate，不落几何
  undoGranularity?: UndoGranularity                  // 默认 'statement'
  undoBudget?: number                               // 默认 20，超则自动退化 'block'
}

interface ExecuteScriptResult {
  ok: boolean
  partIds: string[]
  statementIds: string[]
  undoGranularityUsed: UndoGranularity
  undoEntries: number
  infos: string[]                                   // 退化/跳过说明走这里，禁 console.warn
  failedAt?: { index: number; op: string; message: string }  // 仅 statement 模式
  error?: { stage: 'parse'|'validate'|'execute'|'commit'; message: string; line?: number }
}
```

撤销行为（T-4）：

| | `statement`（默认） | `block` |
|---|---|---|
| 快照时机 | 每条**改变场景**的语句前压一次 | 全部执行前压一次 |
| label | 脚本语句 + `{index,op}` | 加载脚本 |
| 撤销效果 | 一次退一条语句 | 一次退整个代码块 |
| 第 k 条失败 | 前 k−1 条保留，`failedAt` 报第 k 条 | 回滚到执行前，无半成品 |
| 启用条件 | 默认 | 显式指定，或语句数 > `undoBudget` 自动退化 |

撤销机制原则：`pushSnapshot` 是调用方自决粒度的全量快照；`script` store 已注册 undo registry，逐语句撤销不会使脚本与场景 desync；快照只存元数据不克隆网格。执行中途失败由 `abortToSnapshot()` 回滚到执行前状态。

`executeScript` 还提供 `executeScriptDiff` / `submitFaijsEdit`（整场景 `.faijs` 编辑，按 stmtId 做 UNCHANGED/PARAM/STRUCT/ADD/DELETE 分类，首个变更点起 suffix 重放）、以及 `getScriptText` / `getSceneScriptText` / `editParam` / `getParamSchema` 等 helper。

---

## 9. 桥接协议（对外命令）

```ts
// 统一响应信封
export type ApiResponse = {
  type: '3d-viewer'
  id?: string
  command: string
  status: 'success' | 'error'
  data?: unknown
  error?: string
  event?: string
}
```

新增命令（请求 `params` / 响应 `data`）：

```ts
// 加载代码：文本 → 语句 → 执行 → 落场景
{ command: 'executeScript',
  params: { code: string; partId?: string; params?: Record<string,JsonValue>;
            dryRun?: boolean; undoGranularity?: 'statement'|'block'; undoBudget?: number } }
→ { ok:true, data: ExecuteScriptResult }
→ { ok:false, error: { stage, message, line? } }   // 失败用 error 字段，非 console

// 导出代码：PartScript → 确定性文本
{ command: 'getScript', params: { partId: string } }
→ { ok:true, data: { code: string; params: ParamDef[]; apiVersion: string } }

// 改参：驱动增量重算
{ command: 'editParam', params: { partId: string; name: string; value: JsonValue } }
→ { ok:true, data: { recomputed: string[]; contentKey: string } }

// 取参数 schema
{ command: 'getParamSchema', params: { partId: string } }
→ { ok:true, data: { params: ParamDef[] } }
```

`dryRun:true` 通道：只做 parse + validate，不压快照、不落几何——供 AI 生成代码时低成本自检。

---

## 10. 模型构成契约（SceneMutator）

`SceneMutator` 是 R-2 的载体：零件创建 / 几何替换 / 删除，以及命名、id、partInfos、材质外观，统一经它。它是单例对象，不感知语句、不感知 undo 粒度。

```ts
export interface Appearance {
  color?: string    // hex color string, e.g. "#4A90D9"
  metalness?: number
  roughness?: number
}

export interface CreatePartInput {
  shape: Shape
  op: string                                    // 'box'|'split'|'boolean'|'load'|...
  kind: SceneTreeNode['kind']
  nameOverride?: string                         // 代码路径把 PartScript.meta.name 透传
  appearanceOverride?: Appearance               // 代码路径把 PartScript.meta.appearance 透传
  fileIdPrefix?: string                         // 如 'prim_panel_' / 'wedge_'
  fileIdOverride?: string                       // 直接指定 fileId（跳过自动生成）
}

export interface CreatePartResult { fileId: string; scopedId: string }

export const SceneMutator = {
  createPart(input: CreatePartInput): CreatePartResult
  replacePartGeometry(scopedId: string, shape: Shape): void   // 几何替换
  removePart(scopedId: string): void
}
```

契约要点：

- **命名 / 外观：默认由 `SceneMutator` 派生，但必须可被显式覆写**。覆写通道是代码路径落地 `PartScript.meta` 的唯一入口（`createPart` 的 `nameOverride`/`appearanceOverride`）。UI 路径不传覆写，行为与今天一致。
- **兜底配色保持原样**——不改算法。代码携带颜色值时以代码为准；没携带时兜底。
- **id 由 `SceneMutator` 生成且不可覆写**：它是实例标识，不进代码文本（跨会话会撞号）。id 的值不参与任何等价判定。
- 几何替换统一经 `replacePartGeometry`（in-place 替换），不另立实现。

---

## 11. 不变量与版本化

### 11.1 文本语法（合法 JS 子集，设计文档 `syntax-design.md` §2）

`.faijs` 文本必须是 **JavaScript 的合法子集**——任意 JS 解析器都能无错解析。加载时 **先 parse 再执行**，绝不 `eval` / `import()` 真跑。

- 单一 `export default async (cad) => { ... }` 箭头函数作合法 JS 容器
- `const <name> = <literal>` → `ParamDef`（参数声明，右侧仅字面量）
- `const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { ...args })` → `CadStatement`（模型 N 的第 M 版；`partN_vM` 既是变量名也是语句 id）
- `cad.faceCenter(part0_v0)` / `cad.faceNormal(...)` / `cad.bboxCenter(...)` → `GeomRef`（派生位置引用）
- `return { shape: part<N>_v<M>, name, color, metalness, roughness }` 或 `return [ { shape: part<N>_v<M>, name, color, ... }, ... ]` → `PartScript.meta` / `terminalShapes`（零件属性只在 return 里；多 mesh 用数组）
- 顶部 `// apiVersion: N` → 版本迁移锚点
- **禁止**：`param`/`with` 关键字、对象字面量用 `=`、循环/条件/IIFE/try-catch/模板字符串、`eval`/`new Function`/动态 `import()`、除多输出 op 外的解构
- 越界一律 `ParseError`

```js
// apiVersion: 1
export default async (cad) => {
  const size = 20
  const part0_v0 = cad.box({ size })
  return { shape: part0_v0, name: "支架底板", color: "#4A90D9" }
}
```

`return` 里的值就是执行后模型的值——执行器不问这些值当初怎么算出来的。

### 11.2 语句 id 稳定性

- 采用 `partN_vM` 命名（模型 N 的版本 M），既是变量名也是语句 id；`part0` 是主模型，`partN`(N≥1) 为 split/独立图元/布尔派生的其它模型。旧的 `st_<partLocalSeq>` 命名仅保留给 load/sdf 等非可编辑来源（以及自动生成的 marker 语句）。
- parser 加载文本：文本 id 若已在目标 part 存在则复用（保参数表/缓存），否则分配新 id。
- 文本导出用变量名而非裸 id，降低跨会话耦合。

### 11.3 args schema 校验

每个 op 一份 arg schema（复用特征注册表的参数 schema），**录制 / 解析 / 执行三处共用同一份校验**。加载入口做 `validateScriptArgs`，保证 args 名/类型一致，杜绝命名域漂移。

### 11.4 contentKey 作为保真判据

`contentKey` 是几何等价的度量手段（往返保真的几何部分）。需实证几何内核对同输入是否逐位确定；若否，退化为几何指纹（体积/bbox/三角数 + 采样点距离）。

### 11.5 「结果一致」的边界（防回潮）

契约只保证：**代码 → 模型是一个函数**，且 `getScript → executeScript` 往返后模型相同。
**不保证也不要求**：代码路径与鼠标路径的内部实现/属性分配算法一致、实例 id 值相同、undo 栈结构相同。任何要求「代码算得和 UI 一样」的设计出现时，先回 §1 的 R-1/R-2 对照。

