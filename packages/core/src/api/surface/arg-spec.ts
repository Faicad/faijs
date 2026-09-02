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

  // ──── P14 第二片：text 模块（8 符号：3 pure + 3 skip + 2 type）────
  // 纯字体/度量函数直接 re-export；字体加载（fetch/ArrayBuffer + 全局注册表
  // 状态）与「返回 brep 侧 DSL 对象」的函数（blueprints/sketches）无法静态透传，
  // 登记 skip + reason（divergence，理由见各条）。
  {
    name: 'FontMetricsResult',
    source: 'text/textMetrics.js#FontMetricsResult',
    kind: 'type',
    module: 'text',
  },
  {
    name: 'TextMetricsResult',
    source: 'text/textMetrics.js#TextMetricsResult',
    kind: 'type',
    module: 'text',
  },
  {
    name: 'fontMetrics',
    source: 'text/textMetrics.js#fontMetrics',
    kind: 'pure',
    module: 'text',
  },
  {
    name: 'getFont',
    source: 'text/fontRegistry.js#getFont',
    kind: 'pure',
    module: 'text',
  },
  {
    name: 'textMetrics',
    source: 'text/textMetrics.js#textMetrics',
    kind: 'pure',
    module: 'text',
  },
  {
    name: 'loadFont',
    source: 'text/fontRegistry.js#loadFont',
    kind: 'skip',
    module: 'text',
    reason:
      '字体加载走 fetch/ArrayBuffer + 全局注册表（FONT_REGISTER）状态副作用；faijs 需 ' +
      'host 侧提供字体源与生命周期管理（同 faijs HostPorts.fonts 通道），非静态透传函数',
  },
  {
    name: 'sketchText',
    source: 'text/sketchText.js#sketchText',
    kind: 'skip',
    module: 'text',
    reason:
      '返回 brep 域 Sketches DSL 对象（sketchOnPlane/extrude 方法链），并依赖已加载字体 ' +
      '注册表；faijs 面需要单独的 sketch DSL 适配层，跳过（divergence）',
  },
  {
    name: 'textBlueprints',
    source: 'text/textBlueprints.js#textBlueprints',
    kind: 'skip',
    module: 'text',
    reason:
      '返回 brep 域 Blueprints DSL 对象（组织轮廓/孔 + mirror 方法），依赖已加载字体；' +
      'faijs 面需要单独的 2D sketch 适配层，跳过（divergence）',
  },

  // ──── P14 第二片：projection 模块（9 符号，4 pure + 3 type + 2 skip）────
  // 相机/pure 向量数学与平面别名 guard 直接 re-export；projectEdges/makeProjectedEdges
  // 返回「克隆 Edge 句柄数组」且逐条管理所有权（makeProjectedEdges.ts 的 compound 生命周期），
  // faijs 的单一产物再收养模型不匹配，登记 skip（divergence）。
  {
    name: 'Camera',
    source: 'projection/cameraFns.js#Camera',
    kind: 'type',
    module: 'projection',
  },
  {
    name: 'CubeFace',
    source: 'projection/projectionPlanes.js#CubeFace',
    kind: 'type',
    module: 'projection',
  },
  {
    name: 'ProjectionPlane',
    source: 'projection/projectionPlanes.js#ProjectionPlane',
    kind: 'type',
    module: 'projection',
  },
  {
    name: 'cameraFromPlane',
    source: 'projection/cameraFns.js#cameraFromPlane',
    kind: 'pure',
    module: 'projection',
  },
  {
    name: 'cameraLookAt',
    source: 'projection/cameraFns.js#cameraLookAt',
    kind: 'pure',
    module: 'projection',
  },
  {
    name: 'createCamera',
    source: 'projection/cameraFns.js#createCamera',
    kind: 'pure',
    module: 'projection',
  },
  {
    name: 'isProjectionPlane',
    source: 'projection/projectionPlanes.js#isProjectionPlane',
    kind: 'pure',
    module: 'projection',
  },
  {
    name: 'makeProjectedEdges',
    source: 'projection/makeProjectedEdges.js#makeProjectedEdges',
    kind: 'skip',
    module: 'projection',
    reason:
      '返回 { visible: Edge[]; hidden: Edge[] } 克隆句柄数组并管理 compound 生命周期；' +
      'faijs 单一收养模型不匹配，且属于 2D 投影预览语义，跳过（divergence）',
  },
  {
    name: 'projectEdges',
    source: 'projection/cameraFns.js#projectEdges',
    kind: 'skip',
    module: 'projection',
    reason:
      '同 makeProjectedEdges：返回 Edge 句柄数组 + 所有权生命周期，无法静态收养，跳过（divergence）',
  },

  // ──── P14 第二片：query 模块（14 符号：7 type + 7 skip）────
  // finder 体系（edge/face/wire/vertex/corner + ShapeFinder 基接口）是「状态化查询工具」：
  // finder 工厂返回带内部闭包状态的 DSL 对象（.when/.inList/.findAll…逐步链式），与
  // createDistanceQuery 同类（§5.2/测量批的 skip 先例）。faijs 面无法以静态函数忠实建模
  // （finder 生命周期 + 逐次 Shape 借入需宿主适配），值侧全部 skip + reason。类型侧仍然
  // re-export：这些类型是可复用查询契约的形态面，无运行时语义。
  {
    name: 'CornerFilter',
    source: 'query/finderFns.js#CornerFilter',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'CornerFinderFn',
    source: 'query/finderFns.js#CornerFinderFn',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'EdgeFinderFn',
    source: 'query/finderFns.js#EdgeFinderFn',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'FaceFinderFn',
    source: 'query/finderFns.js#FaceFinderFn',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'ShapeFinder',
    source: 'query/finderFns.js#ShapeFinder',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'SingleFace',
    source: 'query/helpers.js#SingleFace',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'VertexFinderFn',
    source: 'query/finderFns.js#VertexFinderFn',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'WireFinderFn',
    source: 'query/finderFns.js#WireFinderFn',
    kind: 'type',
    module: 'query',
  },
  {
    name: 'cornerFinder',
    source: 'query/finderFns.js#cornerFinder',
    kind: 'skip',
    module: 'query',
    reason:
      '返回带状态链式的 2D 角 finder 对象（builder DSL），同 createDistanceQuery 判例：' +
      'faijs 面无法静态建模（逐 Shape 借入 + 生命周期），跳过（divergence）',
  },
  {
    name: 'edgeFinder',
    source: 'query/finderFns.js#edgeFinder',
    kind: 'skip',
    module: 'query',
    reason:
      '返回带状态链式的边 finder 对象（builder DSL），同 createDistanceQuery 判例：' +
      'faijs 面无法静态建模，跳过（divergence）',
  },
  {
    name: 'faceFinder',
    source: 'query/finderFns.js#faceFinder',
    kind: 'skip',
    module: 'query',
    reason:
      '返回带状态链式的面 finder 对象（builder DSL），同 createDistanceQuery 判例：' +
      'faijs 面无法静态建模，跳过（divergence）',
  },
  {
    name: 'getSingleFace',
    source: 'query/helpers.js#getSingleFace',
    kind: 'skip',
    module: 'query',
    reason:
      '接受 SingleFace（finder 对象/Face 回调）并返回 Result<Face>——输入是 finder/findCallable ' +
      '而非纯的子句，且返回值借用输入 shape 的 Face；faijs 面需要 finder 契约适配，跳过（divergence）',
  },
  {
    name: 'vertexFinder',
    source: 'query/finderFns.js#vertexFinder',
    kind: 'skip',
    module: 'query',
    reason:
      '返回带状态链式的顶点 finder 对象（builder DSL），同 createDistanceQuery 判例：' +
      'faijs 面无法静态建模，跳过（divergence）',
  },
  {
    name: 'wireFinder',
    source: 'query/finderFns.js#wireFinder',
    kind: 'skip',
    module: 'query',
    reason:
      '返回带状态链式的线框 finder 对象（builder DSL），同 createDistanceQuery 判例：' +
      'faijs 面无法静态建模，跳过（divergence）',
  },

  // ──── P14 第四片：ns 模块（9 符号）────
  // 9 个符号均为「命名空间对象」：vendored 根 barrel 以
  // `export * as booleans from './ns/booleans.js'` 形式聚合子命名空间。
  // surface 把每个 namespace 记为 value（file 指向子模块），但实际导出名来自
  // 根 barrel 的 *-as 再导出，故 source 指向 `index.js#<name>`（子文件只有
  // 逐名导出、无名空间值）。faijs 面以 `pure` 整包 re-export 该命名空间对象
  // 即可——保持 brepjs 的组织形态（§5.2 pure 判据：纯导出、无 Shape 参数）。
  {
    name: 'booleans',
    source: 'index.js#booleans',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'construction',
    source: 'index.js#construction',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'io',
    source: 'index.js#io',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'measurement',
    source: 'index.js#measurement',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'modifiers',
    source: 'index.js#modifiers',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'patterns',
    source: 'index.js#patterns',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'primitives',
    source: 'index.js#primitives',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'query',
    source: 'index.js#query',
    kind: 'pure',
    module: 'ns',
  },
  {
    name: 'transforms',
    source: 'index.js#transforms',
    kind: 'pure',
    module: 'ns',
  },

  // ──── P14 第五片：gear 模块（17 符号 = 11 type + 3 pure + 3 skip）────
  // 纯数学/校验助手（无 Shape 参数，返回几何数据/校验结果）→ pure 直连 brepjs 函数。
  // 3 个 make*Gear 构造器返回「复合多句柄结果」：GearResult 内含 solid + 计量字段
  // （pitch/base/tip/root 直径 + diagnostics）；PlanetaryGearAssembly 内含 sun +
  // planets[] + ring 多个 solid。faijs 面的 ops 模板当前只收「单产物 Shape」
  // （brep-op：adopt 一个 product）或标量查询（query）——复合结果既非单产物
  // 也非标量：需要「结果对象内多句柄收养/再导出」的适配模型，同 makeProjectedEdges
  // 判例（多产物收养模型缺位），故 skip + reason（divergence，留待 E12 宿主层设计）。
  {
    name: 'ExternalGearParams',
    source: 'gear/index.js#ExternalGearParams',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'GearDiagnostic',
    source: 'gear/index.js#GearDiagnostic',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'GearDiagnosticCode',
    source: 'gear/index.js#GearDiagnosticCode',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'GearDiagnosticSeverity',
    source: 'gear/index.js#GearDiagnosticSeverity',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'GearGeometry',
    source: 'gear/index.js#GearGeometry',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'GearResult',
    source: 'gear/index.js#GearResult',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'InternalGearParams',
    source: 'gear/index.js#InternalGearParams',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'PlanetPlacement',
    source: 'gear/index.js#PlanetPlacement',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'PlanetPlacementParams',
    source: 'gear/index.js#PlanetPlacementParams',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'PlanetaryGearAssembly',
    source: 'gear/index.js#PlanetaryGearAssembly',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'PlanetaryGearParams',
    source: 'gear/index.js#PlanetaryGearParams',
    kind: 'type',
    module: 'gear',
  },
  {
    name: 'gearGeometry',
    source: 'gear/index.js#gearGeometry',
    kind: 'pure',
    module: 'gear',
  },
  {
    name: 'planetPlacements',
    source: 'gear/index.js#planetPlacements',
    kind: 'pure',
    module: 'gear',
  },
  {
    name: 'validatePlanetary',
    source: 'gear/index.js#validatePlanetary',
    kind: 'pure',
    module: 'gear',
  },
  {
    name: 'makeExternalGear',
    source: 'gear/index.js#makeExternalGear',
    kind: 'skip',
    module: 'gear',
    reason:
      '复合结果（GearResult：solid + 计量 + diagnostics），faijs ops 模板只有单产物收养/标量查询，' +
      '无「结果对象内收养 solid」模型，跳过（divergence，待 E4 宿主层多产物收养）',
  },
  {
    name: 'makeInternalGear',
    source: 'gear/index.js#makeInternalGear',
    kind: 'skip',
    module: 'gear',
    reason:
      '同 makeExternalGear：复合结果含 solid 句柄 + 计量，需结果内收养模型，跳过（divergence）',
  },
  {
    name: 'makePlanetaryGear',
    source: 'gear/index.js#makePlanetaryGear',
    kind: 'skip',
    module: 'gear',
    reason:
      '返回 PlanetaryGearAssembly：sun + planets[] + ring 多个 solid（多产物收养模型缺位），' +
      '跳过（divergence，同 makeProjectedEdges 判例）',
  },

  // ──── P14 第六片：2d 模块（45 符号 = 12 type + 33 skip）────
  // 2d 模块是「2D 制图框架」整体：值侧工厂/变换/布尔操作全部接收或返回
  // kernel-句柄包装对象（Curve2D/Blueprint/Blueprints，均有 registerForCleanup
  // 装饰的析构生命周期），并互相成链（createBlueprint → … → sketchOnPlane2D）。
  // 这些 2D 对象**不是** faijs Shape，也不符合 faijs ops 的单产物收养/标量查询模板；
  // 若朴素 re-export，用户在 faijs 面拿到 kernel 句柄对象 → 所有权/清理逃逸。
  // 与 BlueprintContour 同族：待宿主 2D 制图接入（E12 宿主层）携带它们的生命周期。
  // 类型侧全部 re-export（12 个 type：BS 主类型/句柄/选项），供用户在 faijs 面
  // 对来自宿主接入的 2D 数据做类型标注。
  {
    name: 'Blueprint',
    source: 'index.js#Blueprint',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'Blueprints',
    source: 'index.js#Blueprints',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'BoundingBox2d',
    source: 'index.js#BoundingBox2d',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'CompoundBlueprint',
    source: 'index.js#CompoundBlueprint',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'Curve2D',
    source: 'index.js#Curve2D',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'DrawingInterface',
    source: 'index.js#DrawingInterface',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'GenericSketcher',
    source: 'index.js#GenericSketcher',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'Point2D',
    source: 'index.js#Point2D',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'ScaleMode',
    source: 'index.js#ScaleMode',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'Shape2D',
    source: 'index.js#Shape2D',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'SketchData',
    source: 'index.js#SketchData',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'SplineOptions',
    source: 'index.js#SplineOptions',
    kind: 'type',
    module: '2d',
  },
  {
    name: 'BaseSketcher2d',
    source: 'index.js#BaseSketcher2d',
    kind: 'skip',
    module: '2d',
    reason:
      '2D 制图框架的手写框架层（kernel 2D 对象生命周期），同 Curve2D/Blueprint 族：' +
      'skip（divergence，待宿主侧 2D 制图接入）',
  },
  {
    name: 'BlueprintSketcher',
    source: 'index.js#BlueprintSketcher',
    kind: 'skip',
    module: '2d',
    reason:
      '同 BaseSketcher2d：2D 框架 DSL 类（kernel-句柄对象 + 链式态），' +
      'skip（divergence，待宿主侧 2D 制图接入）',
  },
  {
    name: 'createBlueprint',
    source: 'index.js#createBlueprint',
    kind: 'skip',
    module: '2d',
    reason: '工厂返回 kernel-句柄 Blueprint 对象，skip（divergence，同 2D DSL 框架）',
  },
  {
    name: 'createCompoundBlueprint',
    source: 'index.js#createCompoundBlueprint',
    kind: 'skip',
    module: '2d',
    reason: '工厂返回 kernel-句柄 CompoundBlueprint 对象，skip（divergence）',
  },
  {
    name: 'curve2dBoundingBox',
    source: 'index.js#curve2dBoundingBox',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，skip（divergence，同 2D 制图框架）',
  },
  {
    name: 'curve2dDistanceFrom',
    source: 'index.js#curve2dDistanceFrom',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，skip（divergence）',
  },
  {
    name: 'curve2dFirstPoint',
    source: 'index.js#curve2dFirstPoint',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，skip（divergence）',
  },
  {
    name: 'curve2dIsOnCurve',
    source: 'index.js#curve2dIsOnCurve',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，skip（divergence）',
  },
  {
    name: 'curve2dLastPoint',
    source: 'index.js#curve2dLastPoint',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，skip（divergence）',
  },
  {
    name: 'curve2dParameter',
    source: 'index.js#curve2dParameter',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，skip（divergence）',
  },
  {
    name: 'curve2dSplitAt',
    source: 'index.js#curve2dSplitAt',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，返回 Curve2D[]（多句柄），skip（divergence）',
  },
  {
    name: 'curve2dTangentAt',
    source: 'index.js#curve2dTangentAt',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Curve2D，skip（divergence）',
  },
  {
    name: 'cut2D',
    source: 'index.js#cut2D',
    kind: 'skip',
    module: '2d',
    reason: '2D 布尔 op：输入/输出均为 kernel-2D Blueprint 句柄对象，skip（divergence）',
  },
  {
    name: 'cutBlueprints',
    source: 'index.js#cutBlueprints',
    kind: 'skip',
    module: '2d',
    reason: '接受 Blueprint[] + 切型，返回句柄对象，skip（divergence）',
  },
  {
    name: 'fuse2D',
    source: 'index.js#fuse2D',
    kind: 'skip',
    module: '2d',
    reason: '2D 布尔 op：Blueprints 句柄对象，skip（divergence）',
  },
  {
    name: 'fuseBlueprints',
    source: 'index.js#fuseBlueprints',
    kind: 'skip',
    module: '2d',
    reason: '接受 Blueprint[] + 返回句柄对象，skip（divergence）',
  },
  {
    name: 'getBounds2D',
    source: 'index.js#getBounds2D',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Blueprint（句柄内可缓存的 BoundingBox2d），skip（divergence）',
  },
  {
    name: 'getOrientation2D',
    source: 'index.js#getOrientation2D',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Blueprint，skip（divergence）',
  },
  {
    name: 'intersect2D',
    source: 'index.js#intersect2D',
    kind: 'skip',
    module: '2d',
    reason: '2D 布尔 op：Blueprints 句柄对象，skip（divergence）',
  },
  {
    name: 'intersectBlueprints',
    source: 'index.js#intersectBlueprints',
    kind: 'skip',
    module: '2d',
    reason: '接受 Blueprint[] + 返回句柄对象，skip（divergence）',
  },
  {
    name: 'isInside2D',
    source: 'index.js#isInside2D',
    kind: 'skip',
    module: '2d',
    reason: '接受 kernel-句柄 Blueprint，skip（divergence）',
  },
  {
    name: 'mirror2D',
    source: 'index.js#mirror2D',
    kind: 'skip',
    module: '2d',
    reason: '接受/返回 Blueprint 句柄对象，skip（divergence）',
  },
  {
    name: 'organiseBlueprints',
    source: 'index.js#organiseBlueprints',
    kind: 'skip',
    module: '2d',
    reason: 'Blueprints 组合/清理 DSL，skip（divergence）',
  },
  {
    name: 'polysidesBlueprint',
    source: 'index.js#polysidesBlueprint',
    kind: 'skip',
    module: '2d',
    reason: '返回 kernel-句柄 Blueprint（边数多边形），skip（divergence）',
  },
  {
    name: 'reverseCurve',
    source: 'index.js#reverseCurve',
    kind: 'skip',
    module: '2d',
    reason: '接受/返回 Curve2D 句柄对象，skip（divergence）',
  },
  {
    name: 'rotate2D',
    source: 'index.js#rotate2D',
    kind: 'skip',
    module: '2d',
    reason: '接受/返回 Blueprint 句柄对象，skip（divergence）',
  },
  {
    name: 'roundedRectangleBlueprint',
    source: 'index.js#roundedRectangleBlueprint',
    kind: 'skip',
    module: '2d',
    reason: '返回 kernel-2D Blueprint 对象，skip（divergence）',
  },
  {
    name: 'scale2D',
    source: 'index.js#scale2D',
    kind: 'skip',
    module: '2d',
    reason: '接受/返回 Blueprint 句柄对象，skip（divergence）',
  },
  {
    name: 'sketchOnFace2D',
    source: 'index.js#sketchOnFace2D',
    kind: 'skip',
    module: '2d',
    reason: '把 Blueprint 映射到 3D 面 UV：跨供 2D+3D 混合 + Sketch 句柄，' +
      'skip（divergence，待宿主 2D 接入）',
  },
  {
    name: 'sketchOnPlane2D',
    source: 'index.js#sketchOnPlane2D',
    kind: 'skip',
    module: '2d',
    reason: '把 Blueprint 映射到平面返回 Sketch 句柄，skip（divergence）',
  },
  {
    name: 'stretch2D',
    source: 'index.js#stretch2D',
    kind: 'skip',
    module: '2d',
    reason: '接受/返回 Blueprint 句柄对象，skip（divergence）',
  },
  {
    name: 'toSVGPathD',
    source: 'index.js#toSVGPathD',
    kind: 'skip',
    module: '2d',
    reason: '接受 Blueprint 句柄对象，skip（divergence）',
  },
  {
    name: 'translate2D',
    source: 'index.js#translate2D',
    kind: 'skip',
    module: '2d',
    reason: '接受/返回 Blueprint 句柄对象，skip（divergence）',
  },
]
