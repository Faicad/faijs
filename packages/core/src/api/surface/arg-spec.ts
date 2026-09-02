/**
 * arg-spec — L3 投影签名适配表（E5 唯一人工维护点）
 *
 * 设计文档：docs/plans/2026-09-02-faijs-api-surface-completion.md §E5 / §5.2
 *
 * 输入：brepjs `src/index.ts`（upstream-surface.json 已按 §2.6 排除）。
 * 作用：为每个保留符号声明「faijs 面投影方式」。生成器
 * `scripts/gen-l3-surface.ts` 读取本表 + surface 清单，产出
 * `api/generated/<module>.ts`（E5：不手写 699 个；本表之外符号按默认规则推导）。
 *
 * 产出类别（对齐 §5.2 / E5 分类表；生成器按本类判别产出）：
 *   brep-op : defineOp({ brep }) —— Solid 进出（构造/变换/布尔/修饰，consumes 'none'|'all'）
 *   query   : 普通导出函数（输入 Shape 借入 brepjs handle → 调 vendored → 返回纯数据；
 *             返回非 Shape，不进 defineOp——先例 api/geom.ts，generated/topology.ts getBounds）
 *   pure    : 无 Shape 参数的纯函数 → 直接 re-export（不进 defineOp，不是 op）
 *   type    : `export type { … } from '<vendored>'` re-export
 *   skip    : 登记跳过（divergence：语义 faijs 面无法表达 / 已由 faijs 既有 op 覆盖），带 reason
 *
 * 双形态（E2）：同名符号由生成器注入 `normalizeArgs` 判别器（faijs 对象形态 ↔ brepjs
 * 位置形态），适配表给 faijs 形参映射；本文件首批样本聚焦「faijs 无同名」的纯新增符号，
 * 双形态条目随 §5.1 同名处置逐批加入（P14 分批）。
 *
 * P13a 机制验证样本（4 条，覆盖 type / brep-op 构造 / brep-op 布尔 / query 四类产出路径）：
 *   1. Bounds3D  — type re-export（topology/shapeFns）
 *   2. torus     — brep-op 构造（topology/primitiveFns，faijs 无同名）
 *   3. fuse      — brep-op 布尔（topology/booleanFns，faijs 用 union，fuse 无同名）
 *   4. getBounds — query（topology/shapeFns，consumes:'none'，faijs 用 bbox* 但无同名）
 */

/** 生成器可用的投影方式。 */
export type ProjectionKind = 'brep-op' | 'query' | 'pure' | 'type' | 'skip'

/** brep-op / query 的时间线消费声明（透传 defineOp 元数据，G3/G4）。 */
export type Consume = 'all' | 'none' | number[]

/**
 * faijs 面 query 形参描述（P14 机器签名：生成器按此产出函数签名 + JSDoc @param）。
 * 几何位（geometryArgs 索引）在生成器处以 Shape 覆盖；数值/选项位用 `type` 字段原样声明。
 */
export interface QueryParam {
  name: string
  /** 非几何位的类型（如 `number`）；几何位由生成器覆写为 `Shape`。 */
  type: string
  /** 是否为可选参数（faijs 面签名 `?`），函数缺省值由 vendored 承担。 */
  optional?: boolean
  /** JSDoc 补充说明。 */
  docs?: string
}

/**
 * 单条投影适配。
 *
 * - `name`   faijs 面导出名（= brepjs 符号名；同名冲突已在 §5.1 处置后，寻表登记双形态或改名）。
 * - `source` vendored 树内的来源符号，`<相对 vendored 根的模块路径>#<导出名>`（默认同名）。
 * - `kind`   投影类别（见文件头）。
 * - `module` 分片归属（缺省 'topology'，P13 兼容；P14 起逐模块登记）。
 * - `args`   brep-op/query：调用约定描述，供生成器产出 JSDoc 与 normalizeArgs 占位；
 *            type/pure：无需 args（直接 re-export）。
 * - `consumes` brep-op/query 的 defineOp consumes 声明；缺省 'all'（构造类显式 'none'）。
 */
export interface ArgSpecEntry {
  name: string
  source: string
  kind: ProjectionKind
  /** 分片归属模块（缺省 'topology'）。 */
  module?: string
  /** Human-readable call shape for generated JSDoc. */
  args?: string
  consumes?: Consume
  /** For kind 'skip': divergence reason (must be non-empty, §8 O4). */
  reason?: string
  /**
   * Machine bridge hints (P13a mechanism sample).
   * For 'brep-op'/'query': which positional parameters are geometry inputs
   * (0-based indices into the brepjs positional-arg list) that the generated
   * code must borrow via `borrowBrepjsShape`. Non-listed params pass through
   * untouched (numbers / option objects are value params).
   */
  geometryArgs?: number[]
  /**
   * P14: 几何数组位（query）——该索引是 Shape 数组形参，逐元素借入 brepjs handle。
   */
  geometryCollectionArgs?: number[]
  /** For brep-op/query: whether a bool `Result` must be unwrapped (err → throw). Default true for ops/query. */
  returnsResult?: boolean
  /** P14: query 侧 faijs 面形参列表（without the case for pure/type；brep-op 保持位置透传 `...args`）。 */
  queryParams?: QueryParam[]
  /** For query only: the vendored return type name (re-exportable from the entry's module) so the generated function can annotate its return type (the export-JSDoc gate requires an explicit annotation + @returns). */
  returnType?: string
}

/**
 * 首批机制验证样本（P13a）。每个样本都选了 faijs 无同名、brepjs 有完整实现的符号，
 * 生成产物可立即 typecheck 并桥接 vendored 跑通（E5 模板：句柄借入 → 调 vendored →
 * Result 翻转 → fromBrep 所有权转入）。
 */
export const ARG_SPEC: ArgSpecEntry[] = [
  {
    name: 'Bounds3D',
    source: 'topology/shapeFns.js#Bounds3D',
    kind: 'type',
  },
  {
    name: 'torus',
    source: 'topology/primitiveFns.js#torus',
    kind: 'brep-op',
    args: '(majorRadius: number, minorRadius: number, options?: TorusOptions)',
    consumes: 'none',
    // 构造类：无几何输入（纯数值参数），brepjs 返回裸 ValidSolid（非 Result）。
    geometryArgs: [],
    returnsResult: false,
  },
  {
    name: 'fuse',
    source: 'topology/booleanFns.js#fuse',
    kind: 'brep-op',
    args: '(a: Shape3D, b: Shape3D, options?: BooleanOptions) -> Result<Shape3D>',
    // 两个输入都是 faijs Shape → 借入 brepjs handle；第三参 options 透传。
    geometryArgs: [0, 1],
    returnsResult: true,
  },
  {
    name: 'getBounds',
    source: 'topology/shapeFns.js#getBounds',
    kind: 'query',
    args: '(shape: AnyShape) -> Bounds3D',
    consumes: 'none',
    // 查询：输入 Shape（借入），返回纯数据 Bounds3D → 不进 defineOp（直接导出函数）。
    geometryArgs: [0],
    returnsResult: false,
    returnType: 'Bounds3D',
  },

  // ──── P14 第一片：measurement 模块（21 符号，全 query/type，无 brep-op）────
  // 归属模块 measurement：产物 api/generated/measurement.ts。
  // 说明：测量模块全部符号都是「Shape 进 → 纯数据出」的无副作用查询；唯一例外
  // createDistanceQuery（状态化查询工具，闭包引用外部 referenceShape，faijs 面无法
  // 静态建模，登记 skip）。type 侧 8 个类型全部 re-export；query 侧返回类型由生成器
  // `import type` 引入（CurvatureResult 等来自 measureFns / interferenceFns）。

  // 8 × type 基础设施
  {
    name: 'CurvatureResult',
    source: 'measurement/measureFns.js#CurvatureResult',
    kind: 'type',
    module: 'measurement',
  },
  {
    name: 'DistanceProps',
    source: 'measurement/measureFns.js#DistanceProps',
    kind: 'type',
    module: 'measurement',
  },
  {
    name: 'InterferencePair',
    source: 'measurement/interferenceFns.js#InterferencePair',
    kind: 'type',
    module: 'measurement',
  },
  {
    name: 'InterferenceResult',
    source: 'measurement/interferenceFns.js#InterferenceResult',
    kind: 'type',
    module: 'measurement',
  },
  {
    name: 'LinearProps',
    source: 'measurement/measureFns.js#LinearProps',
    kind: 'type',
    module: 'measurement',
  },
  {
    name: 'PhysicalProps',
    source: 'measurement/measureFns.js#PhysicalProps',
    kind: 'type',
    module: 'measurement',
  },
  {
    name: 'SurfaceProps',
    source: 'measurement/measureFns.js#SurfaceProps',
    kind: 'type',
    module: 'measurement',
  },
  {
    name: 'VolumeProps',
    source: 'measurement/measureFns.js#VolumeProps',
    kind: 'type',
    module: 'measurement',
  },
  // 1 × skip（状态化查询工具）
  {
    name: 'createDistanceQuery',
    source: 'measurement/measureFns.js#createDistanceQuery',
    kind: 'skip',
    module: 'measurement',
    reason:
      '状态化查询工具：返回带闭包引用（distanceTo/dispose）的 brep 距离工具，faijs 面' +
      '无法静态建模（查询对象生命周期 + 后续 Shape 参数逐次借入）；跳过，待宿主适配器手工实现',
  },
  // 12 × query（volume / area / length / distance / curvature / interference）
  {
    name: 'measureVolumeProps',
    source: 'measurement/measureFns.js#measureVolumeProps',
    kind: 'query',
    module: 'measurement',
    args: '(shape: Shape3D) -> Result<VolumeProps>',
    geometryArgs: [0],
    returnsResult: true,
    returnType: 'VolumeProps',
  },
  {
    name: 'measureSurfaceProps',
    source: 'measurement/measureFns.js#measureSurfaceProps',
    kind: 'query',
    module: 'measurement',
    args: '(shape: Face | Shape3D) -> Result<SurfaceProps>',
    geometryArgs: [0],
    returnsResult: true,
    returnType: 'SurfaceProps',
  },
  {
    name: 'measureLinearProps',
    source: 'measurement/measureFns.js#measureLinearProps',
    kind: 'query',
    module: 'measurement',
    args: '(shape: AnyShape) -> Result<LinearProps>',
    geometryArgs: [0],
    returnsResult: true,
    returnType: 'LinearProps',
  },
  {
    name: 'measureVolume',
    source: 'measurement/measureFns.js#measureVolume',
    kind: 'query',
    module: 'measurement',
    args: '(shape: Shape3D) -> Result<number>',
    geometryArgs: [0],
    returnsResult: true,
    returnType: 'number',
  },
  {
    name: 'measureArea',
    source: 'measurement/measureFns.js#measureArea',
    kind: 'query',
    module: 'measurement',
    args: '(shape: Face | Shape3D) -> Result<number>',
    geometryArgs: [0],
    returnsResult: true,
    returnType: 'number',
  },
  {
    name: 'measureLength',
    source: 'measurement/measureFns.js#measureLength',
    kind: 'query',
    module: 'measurement',
    args: '(shape: AnyShape) -> Result<number>',
    geometryArgs: [0],
    returnsResult: true,
    returnType: 'number',
  },
  {
    name: 'measureDistance',
    source: 'measurement/measureFns.js#measureDistance',
    kind: 'query',
    module: 'measurement',
    args: '(a: AnyShape, b: AnyShape) -> Result<number>',
    consumes: 'none',
    geometryArgs: [0, 1],
    queryParams: [
      { name: 'a', type: 'Shape', docs: '第一个被查询形状' },
      { name: 'b', type: 'Shape', docs: '第二个被查询形状' },
    ],
    returnsResult: true,
    returnType: 'number',
  },
  {
    name: 'measureDistanceProps',
    source: 'measurement/measureFns.js#measureDistanceProps',
    kind: 'query',
    module: 'measurement',
    args: '(a: AnyShape, b: AnyShape) -> Result<DistanceProps>',
    consumes: 'none',
    geometryArgs: [0, 1],
    queryParams: [
      { name: 'a', type: 'Shape', docs: '第一个被查询形状' },
      { name: 'b', type: 'Shape', docs: '第二个被查询形状' },
    ],
    returnsResult: true,
    returnType: 'DistanceProps',
  },
  {
    name: 'measureCurvatureAt',
    source: 'measurement/measureFns.js#measureCurvatureAt',
    kind: 'query',
    module: 'measurement',
    args: '(face: OrientedFace, u: number, v: number) -> Result<CurvatureResult>',
    consumes: 'none',
    geometryArgs: [0],
    queryParams: [
      { name: 'face', type: 'Shape', docs: '被查询的曲面/面' },
      { name: 'u', type: 'number', docs: '参数域 u' },
      { name: 'v', type: 'number', docs: '参数域 v' },
    ],
    returnsResult: true,
    returnType: 'CurvatureResult',
  },
  {
    name: 'measureCurvatureAtMid',
    source: 'measurement/measureFns.js#measureCurvatureAtMid',
    kind: 'query',
    module: 'measurement',
    args: '(face: Face) -> Result<CurvatureResult>',
    consumes: 'none',
    geometryArgs: [0],
    returnsResult: true,
    returnType: 'CurvatureResult',
  },
  {
    name: 'checkInterference',
    source: 'measurement/interferenceFns.js#checkInterference',
    kind: 'query',
    module: 'measurement',
    args: '(a: AnyShape, b: AnyShape, tolerance?: number) -> Result<InterferenceResult>',
    consumes: 'none',
    geometryArgs: [0, 1],
    queryParams: [
      { name: 'a', type: 'Shape', docs: '第一个形状' },
      { name: 'b', type: 'Shape', docs: '第二个形状' },
      { name: 'tolerance', type: 'number', optional: true, docs: '干涉距离阈值（缺省 1e-6）' },
    ],
    returnsResult: true,
    returnType: 'InterferenceResult',
  },
  {
    name: 'checkAllInterferences',
    source: 'measurement/interferenceFns.js#checkAllInterferences',
    kind: 'query',
    module: 'measurement',
    args: '(shapes: AnyShape[], tolerance?: number) -> InterferencePair[]',
    consumes: 'none',
    // 数组输入：geometryCollectionArgs 索引对应的 Shape 数组逐元素借入 brepjs handle。
    geometryCollectionArgs: [0],
    queryParams: [
      { name: 'shapes', type: 'Shape[]', docs: '成对检测的形状数组' },
      { name: 'tolerance', type: 'number', optional: true, docs: '干涉距离阈值（缺省 1e-6）' },
    ],
    returnsResult: false,
    returnType: 'InterferencePair[]',
  },
]
