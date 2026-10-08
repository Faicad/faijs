/**
 * engine/types — BREP 引擎中立类型（零具体实现依赖，不 import 任何内核包）
 *
 *
 * 契约（对应 brepjs 的 KernelShape 约定）：
 * - L1 及以上代码永远不对句柄调用任何方法，只把它传回产生它的那个引擎；
 * - 句柄不得跨引擎传递——跨引擎必须先经 mesh 层（§8.3 的结构保证）。
 * - OCCT 适配器的句柄运行时就是 number，加 brand 是零成本的类型层转换。
 */

/**
 * BREP 引擎身份（D11-1，2026-09-24 narrowing plan）。
 *
 * 三个值来自三个已存在的引擎 id 常量（`OCCT_BREP_ENGINE_ID` / `BREPKIT_BREP_ENGINE_ID`
 * / `BREP_MOCK_ENGINE_ID`，各自适配器导出）；本类型由常量数组推导，禁止裸 `string`。
 * 适配器常量用 `satisfies BrepEngineId` 收窄（typecheck 钉住集合一致）。
 *
 * 消费点：`defineOp` 的 `engines` 声明（平台 op 自证身份）、`dispatchPath` 的平台
 * 身份分支（D11-2）、`script-face-manifest` 的平台 op 标注（§3.8）。
 */
export const BREP_ENGINE_IDS = ['occt', 'brepkit', 'brep_mock'] as const

/** BREP 引擎身份（固定三值联合；由 {@link BREP_ENGINE_IDS} 推导）。 */
export type BrepEngineId = (typeof BREP_ENGINE_IDS)[number]

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

/**
 * 面/边 hash 的上界（唯一真源）。
 *
 * 拓扑提取侧用 `kernel.hashCode(subShape, BREP_HASH_BOUND)` 查面/边，
 * 三角化/线框侧把 hash 写进 `faceGroups[·+2]` / `edgeGroups[·+2]`——
 * **两侧必须对同一上界取模**，否则查表恒 miss（实测 2026-10-01：
 * brepkit 适配器曾用 1e9、topologyExt 用 INT32_MAX → 面行 triangleCount 全 0）。
 * 值取自 OCCT `HASH_CODE_MAX` 惯例，也是 occt-wasm 的实际口径（实测一致）。
 */
export const BREP_HASH_BOUND = 2147483647

/**
 * BRepMesh 三角化输出（镜像 occt-wasm Mesh 的中立形态）。
 *
 * ⚠️ 单位口径（L1 契约的一部分，实测钉死）：
 * - `faceGroups` 三元组 = `[triStart, triCount, faceHash]`，前两元是**索引单位**
 *   （3/三角形），不是三角形单位；
 * - `wireframe().edgeGroups` = `[pointStart, pointCount, edgeHash]`，前两元是
 *   **浮点单位**（3/点）。
 * 修订任何一侧都要同步改另一侧与 brepkit 适配器（跨引擎一致性测试
 * `topology/face-group-units.test.ts` 钉住）。
 */
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
  /** 每边分组：[pointStart, pointCount, edgeHash] 三元组；前两元为**浮点单位**（3/点）。 */
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

/**
 * NURBS control data of one edge's BASIS curve.
 *
 * ⚠️ This is the WHOLE basis curve, not the edge: an OCCT edge is often only a
 * sub-range of its curve, so `curveParameters(edge)` is the trim to apply on top
 * of this (`BRep_Tool::Curve` hands back both halves). Rebuilding an edge from
 * this data without honouring that trim produces a curve running past its
 * neighbour's start (measured 2026-09-29).
 *
 * `poles` is flat `[x,y,z, x,y,z, …]`; `weights` has one entry per pole (all 1
 * for a non-rational curve, and `rational` then says whether they mean anything);
 * `knots`/`multiplicities` are parallel arrays (expanded, the knot vector is
 * `knots[i]` repeated `multiplicities[i]` times and has `poles + degree + 1`
 * entries).
 */
export interface BrepNurbsCurveData {
  /** Polynomial degree. */
  degree: number
  /** True when `weights` are meaningful (a rational curve). */
  rational: boolean
  /** True for a periodic (closed, wrap-around) curve. */
  periodic: boolean
  /** Distinct knot values, parallel to `multiplicities`. */
  knots: number[]
  /** Multiplicity of each entry in `knots`. */
  multiplicities: number[]
  /** Flat control points: `[x, y, z, x, y, z, …]`. */
  poles: number[]
  /** One weight per control point. */
  weights: number[]
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
 * XCAF label 句柄（`addShape` / `addChild` 的返回值，仅在所属文档内有效）。
 */
export type BrepXcafLabel = number & { readonly __brepXcafLabel: 'BrepXcafLabel' }

/**
 * XCAF 装配文档句柄（可选能力槽 AssemblyCapability 的文档形态）。
 *
 * 形态来自 occt-wasm XCAFDocumentImpl 的被调用子集（step.ts / occt-kernel 装配链）。
 * `addChild` 支撑真装配写入（方案 2026-10-08 步骤 7 / P3）：组件位姿经
 * `location`（平移 + Euler 弧度）落到 XCAF location，导出为装配引用而非平级 PRODUCT。
 */
export interface BrepXcafDocument {
  /** 顶层 part / 装配 label。返回的 label 可作为 `addChild` 的父。 */
  addShape(shape: BrepHandle, opts?: { name?: string; color?: [number, number, number] }): BrepXcafLabel
  /**
   * 把 shape 作为 parent 的子组件加入（parent 是 part 时，首个 child 使其转为
   * assembly：原几何移入 identity 首组件并携带 part 的名与色）。
   */
  addChild(
    parent: BrepXcafLabel,
    shape: BrepHandle,
    opts?: {
      name?: string
      color?: [number, number, number]
      /** 组件相对父的位姿：平移 + Euler 角（弧度）。⚠️ occt-wasm 当前只生效平移
       * （旋转分量写出→回读恒 identity，step-export.test.ts P7 钉住）——旋转由
       * 调用方烘进几何，wasm 修复后恢复 location 携带完整位姿。 */
      location?: { tx?: number; ty?: number; tz?: number; rx?: number; ry?: number; rz?: number }
    },
  ): BrepXcafLabel
  exportSTEP(): string
  close(): void
}

/**
 * 面演化（`*WithHistory`）核函数名——与内核方法同名，**逐核函数**。
 *
 * ⚠️ **为什么不是一个布尔位**（2026-09-22 Phase 0.2，事实不变）：家族化命名会**多报**。
 * 「本内核提供面演化」这句话在建面上不成立——每个 `*WithHistory` 是一个独立核函数，
 * 内核可以只提供其中一部分。`brepkit` 就是活例：它提供 `fuse`/`cut`/`fillet`，
 * `chamfer`/`intersect`/`translate`/… 一律 `unsupported(...)`
 * （`brepkit-kernel/brepkitKernel.ts:220-537`）。
 *
 * 本类型是「面演化核函数有哪些」的**名字全集**，供 `hasNativeHistory`
 * （`brep/engine/native-history.ts`）按引擎身份逐名回答"这个引擎原生有没有它"。
 * 没有声明轴：op 不声明要哪个核函数，分派时也不查任何能力表。
 */
export type BrepEvolutionKind =
  // 布尔族
  | 'fuseWithHistory'
  | 'cutWithHistory'
  | 'intersectWithHistory'
  // 倒圆/倒角族
  | 'filletWithHistory'
  | 'chamferWithHistory'
  // 刚体变换族
  | 'translateWithHistory'
  | 'rotateWithHistory'
  | 'mirrorWithHistory'
  | 'scaleWithHistory'
  // 抽壳/偏置/加厚族
  | 'shellWithHistory'
  | 'offsetWithHistory'
  | 'thickenWithHistory'
