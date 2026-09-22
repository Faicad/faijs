/**
 * engine/types — BREP 引擎中立类型（零具体实现依赖，不 import 任何内核包）
 *
 *
 * 契约（对应 brepjs 的 KernelShape 约定）：
 * - L1 及以上代码永远不对句柄调用任何方法，只把它传回产生它的那个引擎；
 * - 句柄不得跨引擎传递——跨引擎必须先经 mesh 层（§8.3 的结构保证）。
 * - OCCT 适配器的句柄运行时就是 number，加 brand 是零成本的类型层转换。
 */

declare const BrepHandleBrand: unique symbol

/**
 * BREP 实体句柄——不透明值。
 *
 * 与 occt-wasm 的 ShapeHandle 同构（number & brand）。OCCT 适配器
 * （occt-kernel/）内部以 `as unknown as` 双向转换，跨适配器边界零运行时成本。
 */
export type BrepHandle = number & { readonly [BrepHandleBrand]: never }

/** 三维点/向量（与内核无关的中立形态）。 */
export interface BrepVec3 {
  x: number
  y: number
  z: number
}

/** 轴对齐包围盒。 */
export interface BrepBoundingBox {
  xmin: number
  ymin: number
  zmin: number
  xmax: number
  ymax: number
  zmax: number
}

/** BRepMesh 三角化输出（镜像 occt-wasm Mesh 的中立形态）。 */
export interface BrepMeshResult {
  /** XYZ 交错顶点坐标，长度 = vertexCount * 3 */
  positions: Float32Array
  /** XYZ 交错顶点法线，长度 = vertexCount * 3 */
  normals: Float32Array
  /** 三角形索引 */
  indices: Uint32Array
  /** 顶点数（positions.length / 3） */
  vertexCount: number
  /** 三角形数（indices.length / 3） */
  triangleCount: number
  /** 面组：[triStart, triCount, faceHash] 三元组（meshShape 时存在） */
  faceGroups?: Int32Array
  /** 面组数（meshShape 时存在） */
  faceCount?: number
}

/** 三角化精度选项。 */
export interface BrepTessellateOptions {
  /** 最大弦偏差（mm），默认 0.1 */
  linearDeflection?: number
  /** 最大角偏差（弧度），默认 0.5 */
  angularDeflection?: number
  /** 按每条边长度相对解释 linearDeflection */
  relative?: boolean
}

/** 边折线数据（wireframe 输出）。 */
export interface BrepEdgeData {
  /** XYZ 交错边采样点 */
  points: Float32Array
  /** 每边分组：[pointStart, pointCount, edgeHash] 三元组 */
  edgeGroups: Int32Array
  /** points 中的浮点数总数（= XYZ 坐标数） */
  pointCount: number
  /** 不同边的数量 */
  edgeCount: number
}

/**
 * *WithHistory 面演化数据（modified/generated/deleted 用面 hash 编码）。
 *
 * ⚠️ **三个字段的编码不同，实测于 2026-09-22（`brep/engine/phase0-kernel-probes.test.ts`），
 * 与 occt-wasm 自己的文档（`dist/types.d.ts:227-231`）不符**：
 *
 * | 字段 | 实际编码 | 键/值语义 |
 * |---|---|---|
 * | `modified` | **分段** `[inHash, count, outHash…] × N` | 键 = 输入面 hash；值 = 该输入面在结果里的**后继**（可 1→N） |
 * | `generated` | **同构分段**，**键集与 `modified` 相同** | 值 = 该输入面派生出的**中间形**（实测结果里 0 存活） |
 * | `deleted` | **扁平** hash 数组 | 输入面中已不存在的面 |
 *
 * 「扁平数组」的读法会把 `generated` 的 count 字段当成 hash——
 * 实测 `cut` 的 `generated` 里真的含 `2`（一个 count），故该误读不会自己暴露。
 *
 * ⚠️ **未受影响的面有两种上报形态，两种都表示"未变"**：自映射（`i -> [i]`）。
 * 或者**整个不上报**（`fillet` 实测两者并存）。⇒ 读法必须是
 * `modified.get(h) ?? [h]`，不能只看"是否出现在 `modified` 里"。
 *
 * ⇒ 结果面的三种命运（判据见 `phase0-kernel-probes.test.ts`）：
 * **原样幸存**（hash ∈ 输入 hash 集合，hash 逐字不变）/ **改型幸存**（在 `modified` 输出里）/
 * **新造**（两者皆非——这才是真正需要派生词汇命名的面，如 `fillet` 的过渡面）。
 */
export interface BrepEvolutionData {
  /** 结果句柄 */
  result: BrepHandle
  /** 分段：`[inHash, count, outHash…] × N`；值 = 该输入面的结果后继 */
  modified: number[]
  /** 分段（键集同 `modified`）：该输入面派生的中间形 hash，实测结果里 0 存活 */
  generated: number[]
  /** 扁平：输入面中已不存在的面 hash */
  deleted: number[]
}

/** 曲线参数区间（与内核 curveParameters 返回同构：first/last）。 */
export interface BrepCurveParameters {
  first: number
  last: number
}

/** 曲面 UV 边界。 */
export interface BrepUvBounds {
  uMin: number
  uMax: number
  vMin: number
  vMax: number
}

/** 子形状类型（getSubShapes / subShapeHashes 等）。 */
export type BrepSubShapeType = 'vertex' | 'edge' | 'wire' | 'face' | 'shell' | 'solid'

/**
 * XCAF 装配文档句柄（可选能力槽 AssemblyCapability 的文档形态）。
 *
 * 形态来自 occt-wasm XCAFDocumentImpl 的被调用子集（step.ts / occt-kernel 装配链）。
 */
export interface BrepXcafDocument {
  addShape(shape: BrepHandle, opts?: { name?: string; color?: [number, number, number] }): void
  exportSTEP(): string
  close(): void
}

/**
 * 曲面细分精度控制模型（与 brepjs KernelCapabilities.tessellationModel 同构的中立镜像，
 * P7 并入；faijs 侧零内核依赖，不 import vendored 树——D8 反向只允许发生在 api/）。
 *
 * - `'build-time'`  — 网格在实体构造时固定（如 manifold 全局分段设置）；质量参数须在构造前应用。
 * - `'extract-time'`— 形状是精确的，按需以每调用 deflection 细分（如 OCCT）；质量是
 *                    `mesh()`/导出时的默认 deflection。
 * - `'none'`        — 无细分控制（或非网格内核）。
 */
export type BrepTessellationModel = 'build-time' | 'extract-time' | 'none'

/**
 * 面演化（`*WithHistory`）核函数名——与内核方法同名，**逐核函数**声明。
 *
 * ⚠️ **为什么不能是一个布尔位**（2026-09-22 Phase 0.2）：`evolution: true` 是**族级**声明。
 * 而「本内核提供面演化」这句话在建面上不成立——每个 `*WithHistory` 是一个独立核函数，
 * 内核可以只提供其中一部分。`brepkit` 就是活例：它提供 `fuse`/`cut`/`fillet`，
 * `chamfer`/`intersect`/`translate`/… 一律 `unsupported(...)`
 * （`brepkit-kernel/brepkitKernel.ts:220-537`）。
 *
 * 族级布尔的后果不是"少报"而是**多报**：`cad.intersect` 声明需要 `evolution`，
 * 在 `evolution: true` 下通过静态判定 → 落到运行时才撞 `unsupported('intersectWithHistory')`。
 * 这直接违反 AGENTS.md 红线「BREP 路径能否走由静态规则判定，禁止运行时回退」——
 * 静态判定之所以能成立，前提是引擎的能力声明**说的是逐核函数的实话**。
 *
 * ⇒ 引擎声明"我提供哪几个"（`BrepCapabilities.evolution`），op 声明"我要哪一个"
 * （`defineOp.capabilities`），两者**按名字求交集**（`cad-runtime/backend-dispatch.ts`）。
 */
export type BrepEvolutionKind =
  // 布尔族
  | 'fuse'
  | 'cut'
  | 'intersect'
  // 倒圆/倒角族
  | 'fillet'
  | 'chamfer'
  // 刚体变换族
  | 'translate'
  | 'rotate'
  | 'mirror'
  | 'scale'
  // 抽壳/偏置/加厚族
  | 'shell'
  | 'offset'
  | 'thicken'

/**
 * 可选能力槽声明（§7.5，Phase 1 钉死成员）。
 *
 * 缺失的能力 → 依赖它的功能静态降级走 mesh（§8.4），绝不伪造。
 *
 * P7 并入（D4）：移植 brepjs `KernelCapabilities` 的数据字段（exact/brepExport/
 * exactMeasurement/tessellationModel）进本模型，由适配器在注册时如实声明；分派逻辑
 * （backend-dispatch 的 BrepCapabilityName 路由）不改——新字段是引擎本质描述，不是
 * 逐 op 路由键。
 *
 * 未并入 `disposalModel`（D5 决策，与 vendored port 一致）：faijs 的句柄释放由
 * `cad-runtime` 顶替释放统一编排（增量失败回滚前提），brepjs 的 DisposalScope/arena
 * 语义不强制统一，故不作为能力位记录。
 */
export interface BrepCapabilities {
  /**
   * 面演化族：本引擎**实际提供**的 `*WithHistory` 核函数名（不是族级布尔，见
   * `BrepEvolutionKind`）。空数组 / 缺省 = 一个都不提供。
   */
  evolution?: readonly BrepEvolutionKind[]
  /** 修复族（healSolid/fixShape/fixFaceOrientations/...） */
  heal?: boolean
  /** 直接编辑族（C1：moveFace/replaceFace/...） */
  directEdit?: boolean
  /** 高级曲面族（C1：boundarySurface/fillSurface/...） */
  advSurface?: boolean
  /** XCAF 装配族 */
  assembly?: boolean
  /** mesh→BREP 提升（buildTriFace/sewAndSolidify） */
  meshLift?: boolean
  /** 精确 B-rep 几何（vs mesh 近似）——brepjs KernelCapabilities.exact 并入 */
  exact?: boolean
  /** 可序列化为 B-rep 交换格式（BREP/STEP）——brepjs brepExport 并入 */
  brepExport?: boolean
  /** 体积/面积/长度匹配解析值（vs mesh 近似）——brepjs exactMeasurement 并入 */
  exactMeasurement?: boolean
  /** 细分精度控制模型——brepjs tessellationModel 并入 */
  tessellationModel?: BrepTessellationModel
}
