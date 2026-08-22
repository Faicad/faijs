# 代码引擎 API 接口契约（代码 / 语句层）


## 1. 分层与职责边界

```
┌─────────────────── 文本 / 桥接层 ───────────────────┐
│  executeScript / getScript / editParam / getParamSchema   │
└───────────────────────────┬──────────────────────────┘
                              │ 解析为 PartScript
┌────────────────────────────┴─────────────────────────┐
│  ScriptEngine（录制 + 执行编排）                         │
│   record*() 产生语句  ·  executeScript() 加载代码       │
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
  id: string                 // 语句 id = 文本变量名（UI 层自动生成时为 partN_vM，见 §9.2）
  op: string                 // 见 §5 目录，必须命中白名单
  args: Record<string, Arg>  // 该 op 的完备参数集（见 §5 逐 op 契约）
  inputs: ShapeRef[]         // 上游语句 id（顺序敏感，见各 op）
  name?: string              // 语句显示名（Timeline 用），不进 args
  feature: FeatureMeta
  model?: string             // 所属模型号（UI 层自动生成代码为 partN），多 mesh DAG 区分不同模型
  outputs?: string[]         // 多输出 op 的输出 id 列表（split 写两个输出 id）
  seq?: number               // 全局序列号，timeline 跨 part 线性排序用
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
  source?: { kind: 'load' } | { kind: 'sdf' }
  params: ParamDef[]
  statements: CadStatement[]       // 拓扑序：被依赖的语句在前
  /** 零件级模型属性（往返保真载体）。缺省时由宿主按 op 兜底派生（默认名 + 兜底配色）。 */
  meta?: PartScriptMeta
  /** 多 mesh 终端集合（return [ { shape, meta }, ... ]）；单 mesh 简写时为 undefined。 */
  terminalShapes?: TerminalShape[]
}
```

**`meta` 的定位（往返保真的载体）**：颜色与用户改过的名字**不可从建模参数推导**，因此必须显式记录，否则 `scriptToCode → parseScript` 往返后会丢失。放 part 级 / `TerminalShape` 级而非 `args`——它们是零件属性，不是几何参数。实际载体是宿主层信息（见 §9.1），**不是** `export default … with { … }` 属性导入语法（`with` 在 module 严格模式为保留字，文本语法从不使用）。

**注意**：代码路径**不需要复刻**鼠标路径的配色/命名算法。它只携带结果值，执行端照做；代码没写时才走兜底。兜底配色使用全局计数器，保持原样，不是缺陷。

`CadStatement.name` 是语句的显示名（Timeline 用），与 `meta.name`（零件名）是两回事，勿混。

---

## 5. 语句 op 目录与参数契约

**单一命名域原则**：每个 op 的 `args` 键名**等于**对应几何核心函数的参数名。UI 录制、`executeStatement` 执行、文本 parser 三条路径共用同一份命名与同一份 arg schema 校验（§9.3）。下表是**契约**（应然的参数完备集）。

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
| `drill` | `cad.drill`（async） | `diameter`、`depth?`（0=通孔）、`holeType?:'simple'\|'screw'`、`direction?:'normal'\|'x'\|'y'\|'z'`（缺省 'normal'）、`position?:Vec3`、`faceNormal?:Vec3`、`tolerance?`、`screwSystem?`、`screwSpecIdx?`、`screwThread?`、`screwHead?` |
| `extrude` | `cad.extrude`（async） | `normal:Vec3`、`originOffset:number`、`length:number`、`mode?:'centered'\|'forward'\|'backward'` |
| `engrave` | `cad.engrave`（async） | `engravingType:'text'\|'logo'`、`mode:'convex'\|'concave'`、`depth`、`face:{center,normal}`、`text?`、`textSize?`、`svgText?`、`svgSize?`、`svgNaturalWidth?`、`svgNaturalHeight?` |
| `split` | `cad.split` / `dovetailSplit` / `dowelSplit` / `tenonSplit`（async） | 见 §5.4；产出 front/back 多输出写入 `stmt.outputs` |
| `boolean` | `cad.union/subtract/intersect`（async） | `operation:'union'\|'subtract'\|'intersect'`；`inputs` ≥2（顺序敏感：subtract/intersect 以 inputs[0] 为主体） |
| `knurl` | `cad.knurl` | `face`、`knurlTextureHeight?`、`knurlInvertDisplacement?`、`knurlRefineLength?`、`knurlScaleU?`、`knurlScaleV?`、`knurlMappingMode?` |
| `screwHole` | — | 暂无独立几何核心函数；执行走 `drill` 的 `holeType:'screw'` 分支 |
| `sdf` | — | `code:string`、`box:[Vec3,Vec3]`、`resolution?`、`params?` |

### 5.4 `split` 完整 args 契约

`split` 按 `cutMode` 分发，args 为下列完备集（缺省值由 codegen 省略；切割平面直接序列化为 `normal`/`offset`/`inPlaneAngleDeg`，执行层不再另作推导）：

```
cutMode: 'plane'|'dovetail'|'dowel'|'straight-tenon'|'tenon'|'straight'   // 缺省 'plane'
normal: Vec3             // 切平面法线，缺省 [0,0,1]
offset: number           // 切平面沿法线偏移，缺省 0
inPlaneAngleDeg: number  // 切平面在自身平面内的旋转角（°），缺省 0
side: 'front'|'back'     // 主输出侧，执行态消费以确定主输出
applyExplode: boolean    // 显示态位移，非建模态
bbCenter: Vec3           // 分割参考中心，缺省 bboxCenter
bboxSize: Vec3           // 参考包围盒尺寸
// dovetail：
grooveDepth, grooveWidth, grooveDepthTolerance, grooveWidthTolerance, grooveFlapsAngle
// dowel：
dowelDiameter, dowelDiameterTolerance, dowelHeight, dowelHeightTolerance, selectedSections?
// tenon：
tenonSideLength, tenonSideLengthTolerance, tenonHeight, tenonHeightTolerance, selectedSections?
```

---

## 6. 执行契约（execute / load 共用的计算核心）

### 6.1 单条执行

```ts
async function executeStatement(
  stmt: CadStatement,
  inputGeometries: Shape[],
  outputCache?: Map<string, Shape>,
  params?: Record<string, unknown>,   // 参数表（调用方构建）
  brepChain?: BrepChainState,         // BREP 链状态（几何内核 + solid 缓存）
): Promise<Shape>
```

- 先 `resolveArgs`（字面量透传；`ParamRef`→参数表求值；`GeomRef`→§6.3 解析），再按 `stmt.op` 分派到对应执行模块（BREP/Mesh 双路径）。
- `op` 命中 §5 白名单；未命中 → 拒绝执行。
- **输入约束**：特征/变换类 op 要求 `inputs[0]` 存在，缺失则拒绝执行。

### 6.2 整段执行

```ts
async function executeScript(
  script: PartScript,
  inputGeometryMap?: Map<ShapeRef, Shape>,
  params?: Record<string, unknown>,
): Promise<ExecuteOutput>   // { contentKey, shape, brepActive?, breakReason?, brepChain? }
```

- 按 `statements` **拓扑序**逐条执行；结构型语句（group/assembly）空执行（不产出几何、不写缓存）。
- 每条输出按 `stmt.id` 写入 `outputCache`；多输出 op 还会写入 `stmt.outputs` 各 id。
- 输入解析：先查本 part `outputCache`，再查 `inputGeometryMap`（跨 part 上游）。
- 最终输出 = **最后一条非结构型语句**的输出；空脚本（无非结构型语句）拒绝执行。
- 始终贯穿一条 `BrepChainState`，终端 solid 句柄保留在返回的 `brepChain` 中供导出。
- `contentKey` 为几何等价度量手段（见 §9.4），用于判定 T-1 自包含。

### 6.3 引用解析

- **GeomRef**：用 `of`（上游语句 id）取几何 → 按 `feature` 求位置；`faceCenter/faceNormal` **优先按 `faceOrdinal`**（拓扑面序号，`getSubShapes(shape,'face')[ordinal]`）直接取面，失败或无 ordinal 时用 `anchor`（point+normal）找回最近面，最终降级 `bboxCenter`。`faceOrdinal` 由录制时从 `SelectorRuntime.faces` 获取，在确定性重放下稳定；上游参数编辑导致 ordinal 失效时自动降级 anchor。
- **ParamRef**：`params[paramName]`，缺则 `null`。参数表真实流转——调用方将 `script.params` 与外部 `params` 合并贯穿执行；编辑参数通过改 `script.params` 驱动增量重算。
- **跨 part 解析**：`executeScript` 收 `inputGeometryMap` 参数；跨 part 引用通过场景级单一 DAG 的 `inputs` 同图解析。

---

## 9. 不变量与版本化

### 9.1 文本语法（合法 JS 子集，设计文档 `syntax-design.md` §2）

`.faijs` 文本必须是 **JavaScript 的合法子集**——任意 JS 解析器都能无错解析。加载时 **先 parse 再执行**，绝不 `eval` / `import()` 真跑。

- 平铺语句序列（无 `export default` 包裹、无 `return`、无 `apiVersion` 头——`scriptToCode` 产出格式）
- `const <name> = <literal>` → `ParamDef`（参数声明，右侧仅字面量）
- `const <id> = [await] cad.<op>(<inputVar>?, { ...args })` → `CadStatement`（`<id>` 即语句 id = 变量名；UI 层自动生成代码采用 `partN_vM`）
- `const { front: <id>, back: <id> } = [await] cad.split(<inputVar>, { ...args })` → 多输出语句（front/back 各为一个输出 id）
- `cad.faceCenter(part0_v0)` / `cad.faceNormal(...)` / `cad.bboxCenter(...)` / `cad.bboxMin(...)` / `cad.bboxMax(...)` → `GeomRef`（派生位置引用）
- `cad.group({ ... })` / `cad.assembly({ ... })` 裸调用 → 结构型语句（`grp_N`，不产出几何）
- 终端 = 自动推导（不被引用的输出即终端 → `PartScript.terminalShapes`）；`meta`（name/color 等）由宿主层管理，不进文本
- **禁止**：`param`/`with` 关键字、对象字面量用 `=`、循环/条件/IIFE/try-catch/模板字符串、`eval`/`new Function`/动态 `import()`、除 split 外的解构、跨语句重名 const、函数定义
- 越界一律 `ParseError`

```js
const size = 20
const part0_v0 = cad.box({ size })
const part0_v1 = await cad.drill(part0_v0, { diameter: 5, depth: 0, position: cad.faceCenter(part0_v0) })
```

`part0_v1` 未被引用 → 自动成为终端。执行器不问这些值当初怎么算出来的。

### 9.2 语句 id 稳定性

- UI 层自动生成的代码采用 `partN_vM` 命名（模型 N 的版本 M），既是变量名也是语句 id；`part0` 是主模型，`partN`(N≥1) 为 split/独立图元/布尔派生的其它模型。**AI / 手写代码的 id 不受此约束**，可用任意合法 JS 标识符。`st_<partLocalSeq>` 命名仅保留给 load/sdf 等非可编辑来源（以及自动生成的结构型语句）。
- parser 加载文本：与既有 PartScript 按 id 对齐（`scriptToCode → parseScript` 往返保 id 稳定）；UI 层自动生成的新 id 遵循 `allocateStatementId`，AI / 手写代码的新 id 由作者自定（不得与既有 id 重复）。
- 文本导出用变量名而非裸 id，降低跨会话耦合。

### 9.3 args schema 校验

每个 op 一份 arg schema（复用特征注册表的参数 schema），**录制 / 解析 / 执行三处共用同一份校验**。加载入口做 `validateScriptArgs`，保证 args 名/类型一致，杜绝命名域漂移。

### 9.4 contentKey 作为保真判据

`contentKey` 是几何等价的度量手段（往返保真的几何部分）。需实证几何内核对同输入是否逐位确定；若否，退化为几何指纹（体积/bbox/三角数 + 采样点距离）。

### 9.5 「结果一致」的边界（防回潮）

契约只保证：**代码 → 模型是一个函数**，且 `scriptToCode → parseScript` 往返后模型相同。
**不保证也不要求**：代码路径与鼠标路径的内部实现/属性分配算法一致、实例 id 值相同、undo 栈结构相同。任何要求「代码算得和 UI 一样」的设计出现时，先回 §1 的 R-1 对照。

