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

  // ──── P14 第七片：io 模块（27 符号 = 12 type + 15 skip）────
  // plan §5.5/§7.10（禁用 IO 直接搬）：export*/import* 全部是宿主侧交互——
  // exportOBJ/exportDXF 输入 ShapeMesh/DXFEntity[]（非 faijs Shape 面）、
  // importSVG/importSVGPathD 返回 kernel-句柄 Blueprint（同 2d 家族），所有
  // export*/import* 涉及文件/字节 → 走 faijs node-host/browser-host 端口适配。
  // 类型侧全部 re-export（12 个 type：各格式 options/实体/材料），供 faijs 面
  // 对宿主端口返回的数据做类型标注。
  {
    name: 'DXFEntity',
    source: 'index.js#DXFEntity',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'DXFExportOptions',
    source: 'index.js#DXFExportOptions',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'DXFImportOptions',
    source: 'index.js#DXFImportOptions',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'GltfExportOptions',
    source: 'index.js#GltfExportOptions',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'GltfFace',
    source: 'index.js#GltfFace',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'GltfMaterial',
    source: 'index.js#GltfMaterial',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'MaterialFn',
    source: 'index.js#MaterialFn',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'StepExportOptions',
    source: 'index.js#StepExportOptions',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'StepExportPart',
    source: 'index.js#StepExportPart',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'SVGImportOptions',
    source: 'index.js#SVGImportOptions',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'ThreeMFExportOptions',
    source: 'index.js#ThreeMFExportOptions',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'ThreeMFMaterial',
    source: 'index.js#ThreeMFMaterial',
    kind: 'type',
    module: 'io',
  },
  {
    name: 'blueprintToDXF',
    source: 'index.js#blueprintToDXF',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节走 host ports（接受 kernel 2D Blueprint + 返回字节 DXF），skip（divergence）',
  },
  {
    name: 'exportDXF',
    source: 'index.js#exportDXF',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节走 host ports（接收 DXFEntity[] + options），skip（divergence）',
  },
  {
    name: 'exportGlb',
    source: 'index.js#exportGlb',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'exportGltf',
    source: 'index.js#exportGltf',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'exportOBJ',
    source: 'index.js#exportOBJ',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports（参数是 ShapeMesh 而非 faijs Shape），skip（divergence）',
  },
  {
    name: 'exportSTEPConfigured',
    source: 'index.js#exportSTEPConfigured',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'exportThreeMF',
    source: 'index.js#exportThreeMF',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'importDXF',
    source: 'index.js#importDXF',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'importGLB',
    source: 'index.js#importGLB',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'importIGES',
    source: 'index.js#importIGES',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'importOBJ',
    source: 'index.js#importOBJ',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'importSTEP',
    source: 'index.js#importSTEP',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'importSTL',
    source: 'index.js#importSTL',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },
  {
    name: 'importSVG',
    source: 'index.js#importSVG',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports（返回 kernel-2D Blueprint，2d 族），skip（divergence）',
  },
  {
    name: 'importSVGPathD',
    source: 'index.js#importSVGPathD',
    kind: 'skip',
    module: 'io',
    reason: '返回 kernel-句柄 Blueprint（Result<Blueprint>），2d 族宿主模型缺位，skip（divergence）',
  },
  {
    name: 'importThreeMF',
    source: 'index.js#importThreeMF',
    kind: 'skip',
    module: 'io',
    reason: 'plan §5.5/§7.10: IO/字节 → host ports，skip（divergence）',
  },

  // ──── P14 第八片：operations 模块（122 符号 = 16 brep-op + 11 pure + 45 skip + 8u/others) ────
  // brep-op：Shapeable<…> 单/双形状入参 → faijs Shape 借入 → vendored Result → adopt 单产物；
  // 数组形状入参（loft/guidedSweep/multiSectionSweep 的 Wire[]）与多产物结果（extrudeAll/
  // loftAll = Shape[]/ValidSolid[]）不在单产物收养模板内 → skip（与 P14 派生早先判据一致）；
  // history/assembly/mate/instance 家族 = 状态化 DSL / kernel 句柄容器 → skip；
  // export*/createAssembly = host IO（同 io 判据）/宿主 API → skip；KernelType raw 句柄入参
//（supportExtrude）→ skip。joint 构造/数值助手与骨架计算 → pure。
  {
    // ---- 类型（全部 re-export；barrel 别名走 index.js）----
    name: 'AssemblyExporter', source: 'operations/exporters.js#AssemblyExporter', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'AssemblyNode', source: 'operations/assemblyFns.js#AssemblyNode', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'AssemblyNodeOptions', source: 'operations/assemblyFns.js#AssemblyNodeOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'AssemblySolveResult', source: 'operations/mateFns.js#AssemblySolveResult', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'CleanLoftOptions', source: 'index.js#CleanLoftOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'CleanSweepOptions', source: 'index.js#CleanSweepOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'CylindricalOptions', source: 'operations/jointFns.js#CylindricalOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'DHOptions', source: 'operations/dhFns.js#DHOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'DHRow', source: 'operations/dhFns.js#DHRow', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'ExtrudeAllEntry', source: 'operations/extrudeFns.js#ExtrudeAllEntry', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'ExtrusionProfile', source: 'operations/extrudeFns.js#ExtrusionProfile', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'GuidedSweepOptions', source: 'operations/guidedSweepFns.js#GuidedSweepOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'HistoryOperationRegistry', source: 'index.js#HistoryOperationRegistry', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'IKOptions', source: 'operations/ikFns.js#IKOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'IKResult', source: 'operations/ikFns.js#IKResult', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'IKTarget', source: 'operations/ikFns.js#IKTarget', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'InstancedMesh', source: 'operations/instanceFns.js#InstancedMesh', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'InstancedShape', source: 'operations/instanceFns.js#InstancedShape', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'InstanceGridOptions', source: 'operations/instanceFns.js#InstanceGridOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'Joint', source: 'operations/jointFns.js#Joint', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'JointAxis', source: 'operations/jointFns.js#JointAxis', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'JointDOF', source: 'operations/jointFns.js#JointDOF', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'JointOptions', source: 'operations/jointFns.js#JointOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'JointPose', source: 'operations/jointFns.js#JointPose', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'JointType', source: 'operations/jointFns.js#JointType', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'LoftAllEntry', source: 'operations/loftFns.js#LoftAllEntry', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'MateConstraint', source: 'operations/mateFns.js#MateConstraint', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'MateEntity', source: 'operations/mateFns.js#MateEntity', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'MaterializeOptions', source: 'operations/instanceFns.js#MaterializeOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'ModelHistory', source: 'operations/historyFns.js#ModelHistory', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'MultiSweepOptions', source: 'operations/multiSweepFns.js#MultiSweepOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'OperationFn', source: 'operations/historyFns.js#OperationFn', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'OperationStep', source: 'operations/historyFns.js#OperationStep', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'PlanarOptions', source: 'operations/jointFns.js#PlanarOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'RevolveOptions', source: 'operations/api.js#RevolveOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'RoofOptions', source: 'operations/roofFns.js#RoofOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SerializedHistory', source: 'operations/historyFns.js#SerializedHistory', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'ShapeOptions', source: 'operations/exporterFns.js#ShapeOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SkeletonFace', source: 'operations/straightSkeleton.js#SkeletonFace', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SkeletonNode', source: 'operations/straightSkeleton.js#SkeletonNode', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SkPoint2D', source: 'operations/straightSkeleton.js#SkPoint2D', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SphericalOptions', source: 'operations/jointFns.js#SphericalOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'StraightSkeleton', source: 'operations/straightSkeleton.js#StraightSkeleton', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SupportedUnit', source: 'operations/exporterFns.js#SupportedUnit', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SweepOptions', source: 'operations/extrudeFns.js#SweepOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'SweepSectionConfig', source: 'operations/multiSweepFns.js#SweepSectionConfig', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'ThreadOptions', source: 'operations/threadFns.js#ThreadOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'TrajectorySample', source: 'operations/ikFns.js#TrajectorySample', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'UrdfDocument', source: 'operations/urdfFns.js#UrdfDocument', kind: 'type', module: 'operations', reason: '',
  },
  {
    name: 'UrdfExportOptions', source: 'operations/urdfFns.js#UrdfExportOptions', kind: 'type', module: 'operations', reason: '',
  },
  {
    // ---- pure：纯数据/几何构造，直接 re-export ----
    name: 'revoluteJoint', source: 'operations/jointFns.js#revoluteJoint', kind: 'pure', module: 'operations', reason: '纯数据构造（无 kernel/Shape 参数）',
  },
  {
    name: 'prismaticJoint', source: 'operations/jointFns.js#prismaticJoint', kind: 'pure', module: 'operations', reason: '纯数据构造（无 kernel 参数）',
  },
  {
    name: 'cylindricalJoint', source: 'operations/jointFns.js#cylindricalJoint', kind: 'pure', module: 'operations', reason: '纯数据构造（无 kernel 参数）',
  },
  {
    name: 'planarJoint', source: 'operations/jointFns.js#planarJoint', kind: 'pure', module: 'operations', reason: '纯数据构造（无 kernel 参数）',
  },
  {
    name: 'sphericalJoint', source: 'operations/jointFns.js#sphericalJoint', kind: 'pure', module: 'operations', reason: '纯数据构造（无 kernel 参数）',
  },
  {
    name: 'setJointValue', source: 'operations/jointFns.js#setJointValue', kind: 'pure', module: 'operations', reason: 'Joint→Joint 数值更新（纯数据）',
  },
  {
    name: 'setJointValues', source: 'operations/jointFns.js#setJointValues', kind: 'pure', module: 'operations', reason: 'Joint→Joint 数值批量更新（纯数据）',
  },
  {
    name: 'jointTransform', source: 'operations/jointFns.js#jointTransform', kind: 'pure', module: 'operations', reason: 'Joint→JointPose（纯数据）',
  },
  {
    name: 'jointsFromDH', source: 'operations/dhFns.js#jointsFromDH', kind: 'pure', module: 'operations', reason: 'DH 表→Joint[]（纯数据）',
  },
  {
    name: 'computeStraightSkeleton', source: 'operations/straightSkeleton.js#computeStraightSkeleton', kind: 'pure', module: 'operations', reason: '纯 2D 骨架计算（无 kernel/Shape 参数）',
  },
  {
    name: 'isInstanced', source: 'operations/instanceFns.js#isInstanced', kind: 'pure', module: 'operations', reason: 'type guard（无 kernel 参数）',
  },
  {
    // ---- brep-op：单/多单形状入参 → 单产物收养 ----
    name: 'extrude', source: 'operations/api.js#extrude', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'shapeable 面/边 → Result(Shape)，brep-op',
    args: 'extrude(face: Shape, height?: number|Vec3) → Shape',
  },
  {
    name: 'revolve', source: 'operations/api.js#revolve', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'shapeable 面 → Result(Shape3D)，brep-op',
    args: 'revolve(face: Shape, options?: RevolveOptions): Shape',
  },
  {
    name: 'sweep', source: 'operations/extrudeFns.js#sweep', kind: 'brep-op', module: 'operations',
    geometryArgs: [0, 1], reason: 'wire + spine → Result(Shape3D|tuple)，默认单产物，brep-op',
    args: 'sweep(wire: Shape, spine: Shape, config?: SweepOptions, shellMode?: boolean): Shape',
  },
  {
    name: 'complexExtrude', source: 'operations/extrudeFns.js#complexExtrude', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'wire → Result(Shape3D)，brep-op',
    args: 'complexExtrude(wire: Shape, center: Vec3, normal: Vec3, profile?: ExtrusionProfile): Shape',
  },
  {
    name: 'twistExtrude', source: 'operations/extrudeFns.js#twistExtrude', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'wire → Result(Shape3D)，brep-op',
    args: 'twistExtrude(wire: Shape, angleDegrees: number, center: Vec3, normal: Vec3): Shape',
  },
  {
    name: 'linearPattern', source: 'operations/patternFns.js#linearPattern', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'shape → Result(Shape3D)，brep-op',
    args: 'linearPattern(shape: Shape, direction: Vec3, count: number, spacing: number): Shape',
  },
  {
    name: 'circularPattern', source: 'operations/patternFns.js#circularPattern', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'shape → Result(Shape3D)，brep-op',
    args: 'circularPattern(shape: Shape, axis: Vec3, count: number, fullAngle?: number, center?: Vec3): Shape',
  },
  {
    name: 'gridPattern', source: 'operations/patternFns.js#gridPattern', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'shape → Result(Shape3D)，brep-op',
    args: 'gridPattern(shape: Shape, directionX: Vec3, directionY: Vec3, countX: number, countY: number, spacingX: number, spacingY: number): Shape',
  },
  {
    name: 'roof', source: 'operations/roofFns.js#roof', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'wire → Result(ValidSolid)→solid，brep-op',
    args: 'roof(wire: Shape, options?: RoofOptions): Shape',
  },
  {
    name: 'drill', source: 'operations/compoundOpsFns.js#drill', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'Shapeable<Shape3D> → Result<T>，brep-op',
    args: 'drill(shape: Shape, options: DrillOptions): Shape',
  },
  {
    name: 'pocket', source: 'operations/compoundOpsFns.js#pocket', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'Shapeable<Shape3D> → Result<T>，brep-op',
    args: 'pocket(shape: Shape, options: PocketOptions): Shape',
  },
  {
    name: 'boss', source: 'operations/compoundOpsFns.js#boss', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'Shapeable<Shape3D> → Result<T>，brep-op',
    args: 'boss(shape: Shape, options: BossOptions): Shape',
  },
  {
    name: 'mirrorJoin', source: 'operations/compoundOpsFns.js#mirrorJoin', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'Shapeable<Shape3D> → Result<T>，brep-op',
    args: 'mirrorJoin(shape: Shape, options?: MirrorJoinOptions): Shape',
  },
  {
    name: 'rectangularPattern', source: 'operations/compoundOpsFns.js#rectangularPattern', kind: 'brep-op', module: 'operations',
    geometryArgs: [0], reason: 'Shapeable<Shape3D> → Result<T>，brep-op',
    args: 'rectangularPattern(shape: Shape, options: RectangularPatternOptions): Shape',
  },
  {
    name: 'thread', source: 'operations/threadFns.js#thread', kind: 'brep-op', module: 'operations',
    geometryArgs: [], reason: '仅参数构造 → Result(Shape3D)，单产物，brep-op（consumes: none）',
    args: 'thread(options: ThreadOptions): Shape',
  },
  {
    name: 'convexHull', source: 'operations/convexHullFns.js#convexHull', kind: 'brep-op', module: 'operations',
    geometryArgs: [], reason: '点集构造 → Result(Solid)，单产物，brep-op',
    args: 'convexHull(points: Vec3[]): Shape',
  },
  {
    // ---- skip：状态 DSL/多产物/数组入参/host IO/kernel 入参 ----
    name: 'addChild', source: 'operations/assemblyFns.js#addChild', kind: 'skip', module: 'operations', reason: '装配树操作（AssemblyNode 含 kernel Shape 引用），skip host 装配适配',
  },
  {
    name: 'collectShapes', source: 'operations/assemblyFns.js#collectShapes', kind: 'skip', module: 'operations', reason: '返回 AnyShape[]（kernel 句柄数组），单产物收养缺位，skip',
  },
  {
    name: 'countNodes', source: 'operations/assemblyFns.js#countNodes', kind: 'skip', module: 'operations', reason: '装配场景输入，skip',
  },
  {
    name: 'createAssemblyNode', source: 'operations/assemblyFns.js#createAssemblyNode', kind: 'skip', module: 'operations', reason: 'AssemblyNode 直接持有 kernel Shape 句柄，skip host 装配适配',
  },
  {
    name: 'findNode', source: 'operations/assemblyFns.js#findNode', kind: 'skip', module: 'operations', reason: '装配场景遍历，skip',
  },
  {
    name: 'removeChild', source: 'operations/assemblyFns.js#removeChild', kind: 'skip', module: 'operations', reason: '装配树操作，skip',
  },
  {
    name: 'updateNode', source: 'operations/assemblyFns.js#updateNode', kind: 'skip', module: 'operations', reason: '装配树操作，skip',
  },
  {
    name: 'walkAssembly', source: 'operations/assemblyFns.js#walkAssembly', kind: 'skip', module: 'operations', reason: '装配树遍历（含 kernel 形状），skip',
  },
  {
    name: 'supportExtrude', source: 'operations/extrudeFns.js#supportExtrude', kind: 'skip', module: 'operations', reason: 'support: KernelType raw 内核句柄入参，skip',
  },
  {
    name: 'extrudeAll', source: 'operations/extrudeFns.js#extrudeAll', kind: 'skip', module: 'operations', reason: '返回 ValidSolid[]（多产物），单产物收养缺位，skip',
  },
  {
    name: 'loft', source: 'operations/api.js#loft', kind: 'skip', module: 'operations', reason: '入参 Shapeable<Wire>[]（形状数组），brep-op 模板单柄借入不适用，skip',
  },
  {
    name: 'loftAll', source: 'operations/loftFns.js#loftAll', kind: 'skip', module: 'operations', reason: '返回 Shape3D 数组（多产物），skip',
  },
  {
    name: 'guidedSweep', source: 'operations/guidedSweepFns.js#guidedSweep', kind: 'skip', module: 'operations', reason: 'guides: Wire[]（数组）入参，brefreq 模板无法数组借入，skip',
  },
  {
    name: 'multiSectionSweep', source: 'operations/multiSweepFns.js#multiSectionSweep', kind: 'skip', module: 'operations', reason: 'sections: SweepSectionConfig[]（每份含 wire）数组入参，skip',
  },
  {
    name: 'addJoint', source: 'operations/jointFns.js#addJoint', kind: 'skip', module: 'operations', reason: '装配场景（AssemblyNode 输入），skip',
  },
  {
    name: 'forwardKinematics', source: 'operations/jointFns.js#forwardKinematics', kind: 'skip', module: 'operations', reason: '装配运动链场景输入，skip',
  },
  {
    name: 'mechanismDOF', source: 'operations/jointFns.js#mechanismDOF', kind: 'skip', module: 'operations', reason: '装配场景输入，skip',
  },
  {
    name: 'addMate', source: 'operations/mateFns.js#addMate', kind: 'skip', module: 'operations', reason: '装配约束 DSL（AssemblyNode+kernel 面/边），skip',
  },
  {
    name: 'solveAssembly', source: 'operations/mateFns.js#solveAssembly', kind: 'skip', module: 'operations', reason: '约束求解场景（kernel 句柄），skip',
  },
  {
    name: 'createHistory', source: 'operations/historyFns.js#createHistory', kind: 'skip', module: 'operations', reason: '状态化历史 DSL，skip host 适配',
  },
  {
    name: 'createRegistry', source: 'operations/historyFns.js#createRegistry', kind: 'skip', module: 'operations', reason: 'OperationRegistry 注册表状态，skip',
  },
  {
    name: 'addStep', source: 'operations/historyFns.js#addStep', kind: 'skip', module: 'operations', reason: '返回历史快照状态，skip',
  },
  {
    name: 'getHistoryShape', source: 'index.js#getHistoryShape', kind: 'skip', module: 'operations', reason: '历史快照查询（kernel Shape 句柄），skip',
  },
  {
    name: 'findStep', source: 'operations/historyFns.js#findStep', kind: 'skip', module: 'operations', reason: '历史注册表查询状态，skip',
  },
  {
    name: 'stepCount', source: 'operations/historyFns.js#stepCount', kind: 'skip', module: 'operations', reason: '历史栈长度（非几何查询），skip',
  },
  {
    name: 'stepsFrom', source: 'operations/historyFns.js#stepsFrom', kind: 'skip', module: 'operations', reason: '历史切片状态，skip',
  },
  {
    name: 'modifyStep', source: 'operations/historyFns.js#modifyStep', kind: 'skip', module: 'operations', reason: '改参+replay DSL，skip',
  },
  {
    name: 'registerShape', source: 'operations/historyFns.js#registerShape', kind: 'skip', module: 'operations', reason: '写入 ShapeMap 快照，skip',
  },
  {
    name: 'registerOperation', source: 'operations/historyFns.js#registerOperation', kind: 'skip', module: 'operations', reason: '注册表状态，skip',
  },
  {
    name: 'replayHistory', source: 'operations/historyFns.js#replayHistory', kind: 'skip', module: 'operations', reason: '重播模式，skip',
  },
  {
    name: 'replayFrom', source: 'operations/historyFns.js#replayFrom', kind: 'skip', module: 'operations', reason: '重播子域，skip',
  },
  {
    name: 'serializeHistory', source: 'operations/historyFns.js#serializeHistory', kind: 'skip', module: 'operations', reason: '序列化需 Shape→BREP 内部表示，skip',
  },
  {
    name: 'deserializeHistory', source: 'operations/historyFns.js#deserializeHistory', kind: 'skip', module: 'operations', reason: '重建 kernel Shapes 状态，skip',
  },
  {
    name: 'undoLast', source: 'operations/historyFns.js#undoLast', kind: 'skip', module: 'operations', reason: '历史回退 DSL，skip',
  },
  {
    name: 'instance', source: 'operations/instanceFns.js#instance', kind: 'skip', module: 'operations', reason: '返回 InstancedShape 容器（source 句柄 ownership），skip host 渲染',
  },
  {
    name: 'instanceGrid', source: 'operations/instanceFns.js#instanceGrid', kind: 'skip', module: 'operations', reason: '返回 InstancedShape（矩阵集），skip',
  },
  {
    name: 'instanceCount', source: 'operations/instanceFns.js#instanceCount', kind: 'skip', module: 'operations', reason: '作用于 InstancedShape 宿主引用，skip',
  },
  {
    name: 'instancedMesh', source: 'operations/instanceFns.js#instancedMesh', kind: 'skip', module: 'operations', reason: '返回 host 渲染数据（geometry+instances），非 Shape，skip',
  },
  {
    name: 'materialize', source: 'operations/instanceFns.js#materialize', kind: 'skip', module: 'operations', reason: 'InstancedShape→多产物（Compound/fused），单产物收养缺位，skip',
  },
  {
    name: 'inverseKinematics', source: 'operations/ikFns.js#inverseKinematics', kind: 'skip', module: 'operations', reason: '装配 IK 场景（AssemblyNode 输入），skip',
  },
  {
    name: 'jointTrajectory', source: 'operations/ikFns.js#jointTrajectory', kind: 'skip', module: 'operations', reason: '装配 IK 场景，skip',
  },
  {
    name: 'exportURDF', source: 'operations/urdfFns.js#exportURDF', kind: 'skip', module: 'operations', reason: 'URDF 字符串 host IO，skip（同 IO 判据）',
  },
  {
    name: 'importURDF', source: 'operations/urdfFns.js#importURDF', kind: 'skip', module: 'operations', reason: 'URDF 字符串 host IO，skip',
  },
  {
    name: 'exportAssemblySTEP', source: 'operations/exporterFns.js#exportAssemblySTEP', kind: 'skip', module: 'operations', reason: 'Blob/STEP 字节 host IO，skip',
  },
  {
    name: 'createAssembly', source: 'operations/exporters.js#createAssembly', kind: 'skip', module: 'operations', reason: '返回 AssemblyExporter（kernel 包裹），skip host API',
  },

  // ──── P14 batch 9：core 模块（168 = 47 type + 67 pure + 1 query + 53 skip）────
  // core 是 brepjs 的 L0/L1 基础设施层：Result 组合子、错误构造、向量/平面数学、
  // 类型判别与 Shape 类型体系、内核句柄生命周期。faijs 面把「裸 kernel 句柄」排除在
  // 外（Shape 所有权经 l3-bridge 借入/收养），故 disposal/kernelBoundary/kernelCall/
  // shapeTypes 裸句柄族登记 skip；纯数据函数与常量直接 re-export（pure）。

  // 47 × type（全量 re-export，无行为）
  {
    name: 'Curve2DHandle', source: 'core/curve2dHandle.js#Curve2DHandle', kind: 'type', module: 'core',
  },
  {
    name: 'DimensionError', source: 'core/dimensionTypes.js#DimensionError', kind: 'type', module: 'core',
  },
  {
    name: 'RequireDimension', source: 'core/dimensionTypes.js#RequireDimension', kind: 'type', module: 'core',
  },
  {
    name: 'SameDimension', source: 'core/dimensionTypes.js#SameDimension', kind: 'type', module: 'core',
  },
  {
    name: 'Deletable', source: 'core/disposal.js#Deletable', kind: 'type', module: 'core',
  },
  {
    name: 'DisposalStats', source: 'core/disposal.js#DisposalStats', kind: 'type', module: 'core',
  },
  {
    name: 'KernelHandle', source: 'core/disposal.js#KernelHandle', kind: 'type', module: 'core',
  },
  {
    name: 'ShapeHandle', source: 'core/disposal.js#ShapeHandle', kind: 'type', module: 'core',
  },
  {
    name: 'BrepError', source: 'core/errors.js#BrepError', kind: 'type', module: 'core',
  },
  {
    name: 'BrepErrorKind', source: 'core/errors.js#BrepErrorKind', kind: 'type', module: 'core',
  },
  {
    name: 'Plane', source: 'core/planeTypes.js#Plane', kind: 'type', module: 'core',
  },
  {
    name: 'PlaneInput', source: 'core/planeTypes.js#PlaneInput', kind: 'type', module: 'core',
  },
  {
    name: 'PlaneName', source: 'core/planeTypes.js#PlaneName', kind: 'type', module: 'core',
  },
  {
    name: 'Err', source: 'core/result.js#Err', kind: 'type', module: 'core',
  },
  {
    name: 'Ok', source: 'core/result.js#Ok', kind: 'type', module: 'core',
  },
  {
    name: 'Result', source: 'core/result.js#Result', kind: 'type', module: 'core',
  },
  {
    name: 'ResultPipeline', source: 'core/result.js#ResultPipeline', kind: 'type', module: 'core',
  },
  {
    name: 'Unit', source: 'core/result.js#Unit', kind: 'type', module: 'core',
  },
  {
    name: 'AnyShape', source: 'core/shapeTypes.js#AnyShape', kind: 'type', module: 'core',
  },
  {
    name: 'ClosedWire', source: 'core/shapeTypes.js#ClosedWire', kind: 'type', module: 'core',
  },
  {
    name: 'Compound', source: 'core/shapeTypes.js#Compound', kind: 'type', module: 'core',
  },
  {
    name: 'CompSolid', source: 'core/shapeTypes.js#CompSolid', kind: 'type', module: 'core',
  },
  {
    name: 'CurveLike', source: 'core/shapeTypes.js#CurveLike', kind: 'type', module: 'core',
  },
  {
    name: 'Dimension', source: 'core/shapeTypes.js#Dimension', kind: 'type', module: 'core',
  },
  {
    name: 'Edge', source: 'core/shapeTypes.js#Edge', kind: 'type', module: 'core',
  },
  {
    name: 'Face', source: 'core/shapeTypes.js#Face', kind: 'type', module: 'core',
  },
  {
    name: 'ManifoldShell', source: 'core/shapeTypes.js#ManifoldShell', kind: 'type', module: 'core',
  },
  {
    name: 'OrientedFace', source: 'core/shapeTypes.js#OrientedFace', kind: 'type', module: 'core',
  },
  {
    name: 'PlanarFace', source: 'core/shapeTypes.js#PlanarFace', kind: 'type', module: 'core',
  },
  {
    name: 'PlanarWire', source: 'core/shapeTypes.js#PlanarWire', kind: 'type', module: 'core',
  },
  {
    name: 'Shape1D', source: 'core/shapeTypes.js#Shape1D', kind: 'type', module: 'core',
  },
  {
    name: 'Shape3D', source: 'core/shapeTypes.js#Shape3D', kind: 'type', module: 'core',
  },
  {
    name: 'ShapeKind', source: 'core/shapeTypes.js#ShapeKind', kind: 'type', module: 'core',
  },
  {
    name: 'Shell', source: 'core/shapeTypes.js#Shell', kind: 'type', module: 'core',
  },
  {
    name: 'Solid', source: 'core/shapeTypes.js#Solid', kind: 'type', module: 'core',
  },
  {
    name: 'UnknownDimShape', source: 'core/shapeTypes.js#UnknownDimShape', kind: 'type', module: 'core',
  },
  {
    name: 'ValidSolid', source: 'core/shapeTypes.js#ValidSolid', kind: 'type', module: 'core',
  },
  {
    name: 'Vertex', source: 'core/shapeTypes.js#Vertex', kind: 'type', module: 'core',
  },
  {
    name: 'Wire', source: 'core/shapeTypes.js#Wire', kind: 'type', module: 'core',
  },
  {
    name: 'CurveType', source: 'core/typeDiscriminants.js#CurveType', kind: 'type', module: 'core',
  },
  {
    // 别名：vendored types.ts 只导出 Direction；根 barrel `Direction as DirectionInput`
    name: 'DirectionInput', source: 'index.js#DirectionInput', kind: 'type', module: 'core',
  },
  {
    name: 'Matrix4x4', source: 'core/types.js#Matrix4x4', kind: 'type', module: 'core',
  },
  {
    name: 'MatrixInput', source: 'core/types.js#MatrixInput', kind: 'type', module: 'core',
  },
  {
    name: 'MatrixTransform', source: 'core/types.js#MatrixTransform', kind: 'type', module: 'core',
  },
  {
    name: 'PointInput', source: 'core/types.js#PointInput', kind: 'type', module: 'core',
  },
  {
    name: 'Vec2', source: 'core/types.js#Vec2', kind: 'type', module: 'core',
  },
  {
    name: 'Vec3', source: 'core/types.js#Vec3', kind: 'type', module: 'core',
  },

  // 67 × pure（无 Shape/kernel 参数 → 直接 re-export，不进 defineOp）
  {
    name: 'DEG2RAD', source: 'core/constants.js#DEG2RAD', kind: 'pure', module: 'core', reason: '角度换算常量（纯数据）',
  },
  {
    name: 'RAD2DEG', source: 'core/constants.js#RAD2DEG', kind: 'pure', module: 'core', reason: '角度换算常量（纯数据）',
  },
  {
    name: 'HASH_CODE_MAX', source: 'core/constants.js#HASH_CODE_MAX', kind: 'pure', module: 'core', reason: '哈希上限常量（纯数据）',
  },
  {
    name: 'BrepBugError', source: 'core/errors.js#BrepBugError', kind: 'pure', module: 'core', reason: '错误类（纯构造，无 kernel 参数）',
  },
  {
    name: 'BrepErrorCode', source: 'core/errors.js#BrepErrorCode', kind: 'pure', module: 'core', reason: '错误码常量表（纯数据）',
  },
  {
    name: 'bug', source: 'core/errors.js#bug', kind: 'pure', module: 'core', reason: 'bug 错误构造器（纯函数）',
  },
  {
    name: 'computationError', source: 'core/errors.js#computationError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'ioError', source: 'core/errors.js#ioError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'kernelError', source: 'core/errors.js#kernelError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'moduleInitError', source: 'core/errors.js#moduleInitError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'queryError', source: 'core/errors.js#queryError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'sketcherStateError', source: 'core/errors.js#sketcherStateError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'typeCastError', source: 'core/errors.js#typeCastError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'unsupportedError', source: 'core/errors.js#unsupportedError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'validationError', source: 'core/errors.js#validationError', kind: 'pure', module: 'core', reason: '错误构造器（纯函数）',
  },
  {
    name: 'createNamedPlane', source: 'core/planeOps.js#createNamedPlane', kind: 'pure', module: 'core', reason: '命名平面构造（PlaneName，无 kernel 参数）',
  },
  {
    name: 'createPlane', source: 'core/planeOps.js#createPlane', kind: 'pure', module: 'core', reason: '平面构造（纯数据）',
  },
  {
    name: 'makePlane', source: 'core/planeOps.js#makePlane', kind: 'pure', module: 'core', reason: '平面构造（纯数据，PlaneInput）',
  },
  {
    name: 'pivotPlane', source: 'core/planeOps.js#pivotPlane', kind: 'pure', module: 'core', reason: '平面旋转变换（纯数据）',
  },
  {
    name: 'resolvePlane', source: 'core/planeOps.js#resolvePlane', kind: 'pure', module: 'core', reason: 'PlaneInput → Result<Plane>（无 Shape 参数）',
  },
  {
    name: 'translatePlane', source: 'core/planeOps.js#translatePlane', kind: 'pure', module: 'core', reason: '平面平移（纯数据）',
  },
  {
    name: 'ok', source: 'core/result.js#ok', kind: 'pure', module: 'core', reason: 'Result Ok 构造（纯函数）',
  },
  {
    name: 'err', source: 'core/result.js#err', kind: 'pure', module: 'core', reason: 'Result Err 构造（纯函数）',
  },
  {
    name: 'OK', source: 'core/result.js#OK', kind: 'pure', module: 'core', reason: 'Ok<Unit> 常量',
  },
  {
    name: 'isOk', source: 'core/result.js#isOk', kind: 'pure', module: 'core', reason: 'Result 判别（纯函数）',
  },
  {
    name: 'isErr', source: 'core/result.js#isErr', kind: 'pure', module: 'core', reason: 'Result 判别（纯函数）',
  },
  {
    name: 'map', source: 'core/result.js#map', kind: 'pure', module: 'core', reason: 'Result 组合子（纯函数）',
  },
  {
    name: 'mapErr', source: 'core/result.js#mapErr', kind: 'pure', module: 'core', reason: 'Result 组合子（纯函数）',
  },
  {
    name: 'mapBoth', source: 'core/result.js#mapBoth', kind: 'pure', module: 'core', reason: 'Result 组合子（纯函数）',
  },
  {
    name: 'andThen', source: 'core/result.js#andThen', kind: 'pure', module: 'core', reason: 'Result 组合子（纯函数）',
  },
  {
    name: 'flatMap', source: 'core/result.js#flatMap', kind: 'pure', module: 'core', reason: 'andThen 别名（纯函数）',
  },
  {
    name: 'or', source: 'core/result.js#or', kind: 'pure', module: 'core', reason: 'Result 组合子（纯函数）',
  },
  {
    name: 'orElse', source: 'core/result.js#orElse', kind: 'pure', module: 'core', reason: 'Result 组合子（纯函数）',
  },
  {
    name: 'all', source: 'core/result.js#all', kind: 'pure', module: 'core', reason: 'collect 别名（纯函数）',
  },
  {
    name: 'collect', source: 'core/result.js#collect', kind: 'pure', module: 'core', reason: 'Result[] 收集（纯函数）',
  },
  {
    name: 'tap', source: 'core/result.js#tap', kind: 'pure', module: 'core', reason: 'Result 副作用（纯函数）',
  },
  {
    name: 'tapErr', source: 'core/result.js#tapErr', kind: 'pure', module: 'core', reason: 'Result 副作用（纯函数）',
  },
  {
    name: 'flatten', source: 'core/result.js#flatten', kind: 'pure', module: 'core', reason: 'Result 嵌套展平（纯函数）',
  },
  {
    name: 'fromNullable', source: 'core/result.js#fromNullable', kind: 'pure', module: 'core', reason: 'nullable → Result（纯函数）',
  },
  {
    name: 'unwrap', source: 'core/result.js#unwrap', kind: 'pure', module: 'core', reason: 'Result 解包（纯函数）',
  },
  {
    name: 'unwrapOr', source: 'core/result.js#unwrapOr', kind: 'pure', module: 'core', reason: 'Result 解包（纯函数）',
  },
  {
    name: 'unwrapOrElse', source: 'core/result.js#unwrapOrElse', kind: 'pure', module: 'core', reason: 'Result 解包（纯函数）',
  },
  {
    name: 'unwrapErr', source: 'core/result.js#unwrapErr', kind: 'pure', module: 'core', reason: 'Result 解包（纯函数）',
  },
  {
    name: 'match', source: 'core/result.js#match', kind: 'pure', module: 'core', reason: 'Result 模式匹配（纯函数）',
  },
  {
    name: 'tryCatch', source: 'core/result.js#tryCatch', kind: 'pure', module: 'core', reason: '同步 try→Result（纯函数）',
  },
  {
    name: 'tryCatchAsync', source: 'core/result.js#tryCatchAsync', kind: 'pure', module: 'core', reason: '异步 try→Result（纯函数）',
  },
  {
    name: 'pipeline', source: 'core/result.js#pipeline', kind: 'pure', module: 'core', reason: 'Result 管道入口（纯函数）',
  },
  {
    // 别名：vendored result.ts 导出名 zip；根 barrel `zip as zipResults`
    name: 'zipResults', source: 'index.js#zipResults', kind: 'pure', module: 'core', reason: 'zip 的根 barrel 别名导出（纯函数）',
  },
  {
    name: 'resolveDirection', source: 'core/types.js#resolveDirection', kind: 'pure', module: 'core', reason: '方向简写 → Vec3（纯函数）',
  },
  {
    name: 'toVec2', source: 'core/types.js#toVec2', kind: 'pure', module: 'core', reason: 'PointInput → Vec2（纯函数）',
  },
  {
    name: 'toVec3', source: 'core/types.js#toVec3', kind: 'pure', module: 'core', reason: 'PointInput → Vec3（纯函数）',
  },
  {
    name: 'vecAdd', source: 'core/vecOps.js#vecAdd', kind: 'pure', module: 'core', reason: '向量加法（纯函数）',
  },
  {
    name: 'vecAngle', source: 'core/vecOps.js#vecAngle', kind: 'pure', module: 'core', reason: '向量夹角（纯函数）',
  },
  {
    name: 'vecCross', source: 'core/vecOps.js#vecCross', kind: 'pure', module: 'core', reason: '向量叉积（纯函数）',
  },
  {
    name: 'vecDistance', source: 'core/vecOps.js#vecDistance', kind: 'pure', module: 'core', reason: '向量距离（纯函数）',
  },
  {
    name: 'vecDot', source: 'core/vecOps.js#vecDot', kind: 'pure', module: 'core', reason: '向量点积（纯函数）',
  },
  {
    name: 'vecEquals', source: 'core/vecOps.js#vecEquals', kind: 'pure', module: 'core', reason: '向量相等（纯函数）',
  },
  {
    name: 'vecIsZero', source: 'core/vecOps.js#vecIsZero', kind: 'pure', module: 'core', reason: '零向量判别（纯函数）',
  },
  {
    name: 'vecLength', source: 'core/vecOps.js#vecLength', kind: 'pure', module: 'core', reason: '向量模长（纯函数）',
  },
  {
    name: 'vecLengthSq', source: 'core/vecOps.js#vecLengthSq', kind: 'pure', module: 'core', reason: '向量模长平方（纯函数）',
  },
  {
    name: 'vecNegate', source: 'core/vecOps.js#vecNegate', kind: 'pure', module: 'core', reason: '向量取反（纯函数）',
  },
  {
    name: 'vecNormalize', source: 'core/vecOps.js#vecNormalize', kind: 'pure', module: 'core', reason: '向量归一化（纯函数）',
  },
  {
    name: 'vecProjectToPlane', source: 'core/vecOps.js#vecProjectToPlane', kind: 'pure', module: 'core', reason: '向量平面投影（纯函数）',
  },
  {
    name: 'vecRepr', source: 'core/vecOps.js#vecRepr', kind: 'pure', module: 'core', reason: '向量字符串（纯函数）',
  },
  {
    name: 'vecRotate', source: 'core/vecOps.js#vecRotate', kind: 'pure', module: 'core', reason: '向量绕轴旋转（纯函数）',
  },
  {
    name: 'vecScale', source: 'core/vecOps.js#vecScale', kind: 'pure', module: 'core', reason: '向量缩放（纯函数）',
  },
  {
    name: 'vecSub', source: 'core/vecOps.js#vecSub', kind: 'pure', module: 'core', reason: '向量减法（纯函数）',
  },

  // 1 × query：形状判别串查询（Shape 进 → ShapeKind 字符串出，纯数据）
  {
    name: 'getShapeKind', source: 'core/shapeTypes.js#getShapeKind', kind: 'query', module: 'core',
    args: '(shape: AnyShape) -> ShapeKind',
    consumes: 'none',
    geometryArgs: [0],
    returnsResult: false,
    returnType: 'ShapeKind',
  },

  // 53 × skip（裸 kernel 句柄族；faijs 面 Shape 所有权经 l3-bridge 借入/收养，不暴露裸句柄）
  // disposal：内核句柄生命周期/作用域基础设施
  {
    name: 'createHandle', source: 'core/disposal.js#createHandle', kind: 'skip', module: 'core', reason: '裸 OCCT Shape 句柄注册（KernelShape 入参），skip host 生命周期管理',
  },
  {
    name: 'createKernelHandle', source: 'core/disposal.js#createKernelHandle', kind: 'skip', module: 'core', reason: '裸 OCCT 对象句柄包装，skip',
  },
  {
    name: 'DisposalScope', source: 'core/disposal.js#DisposalScope', kind: 'skip', module: 'core', reason: '内核句柄作用域类（裸句柄注册），skip host 生命周期管理',
  },
  {
    name: 'getDisposalStats', source: 'core/disposal.js#getDisposalStats', kind: 'skip', module: 'core', reason: '裸句柄泄漏统计（内部调试），skip',
  },
  {
    name: 'isLive', source: 'core/disposal.js#isLive', kind: 'skip', module: 'core', reason: '裸句柄存活判别（ShapeHandle/KernelHandle），skip',
  },
  {
    name: 'resetDisposalStats', source: 'core/disposal.js#resetDisposalStats', kind: 'skip', module: 'core', reason: '裸句柄统计清零（内部调试），skip',
  },
  {
    name: 'withScope', source: 'core/disposal.js#withScope', kind: 'skip', module: 'core', reason: '裸句柄作用域执行（DisposalScope 回调），skip host 生命周期管理',
  },
  {
    name: 'withScopeResult', source: 'core/disposal.js#withScopeResult', kind: 'skip', module: 'core', reason: '裸句柄作用域执行（Result 变体），skip',
  },
  {
    name: 'withScopeResultAsync', source: 'core/disposal.js#withScopeResultAsync', kind: 'skip', module: 'core', reason: '裸句柄作用域执行（异步变体），skip',
  },
  // kernelBoundary：OCCT 内核对象 ↔ JS 值 边界转换（Vec/KernelType）
  {
    name: 'toKernelVec', source: 'core/kernelBoundary.js#toKernelVec', kind: 'skip', module: 'core', reason: 'Vec3 → OCCT 内核对象（L0 内部桥），skip',
  },
  {
    name: 'fromKernelVec', source: 'core/kernelBoundary.js#fromKernelVec', kind: 'skip', module: 'core', reason: 'OCCT 内核对象 → Vec3（L0 内部桥），skip',
  },
  {
    name: 'fromKernelPnt', source: 'core/kernelBoundary.js#fromKernelPnt', kind: 'skip', module: 'core', reason: 'OCCT 内核对象 → Vec3（L0 内部桥），skip',
  },
  {
    name: 'fromKernelDir', source: 'core/kernelBoundary.js#fromKernelDir', kind: 'skip', module: 'core', reason: 'OCCT 内核对象 → Vec3（L0 内部桥），skip',
  },
  {
    name: 'withKernelVec', source: 'core/kernelBoundary.js#withKernelVec', kind: 'skip', module: 'core', reason: 'OCCT 对象生命周期作用域（L0 内部桥），skip',
  },
  {
    name: 'withKernelPnt', source: 'core/kernelBoundary.js#withKernelPnt', kind: 'skip', module: 'core', reason: 'OCCT 对象生命周期作用域（L0 内部桥），skip',
  },
  {
    name: 'withKernelDir', source: 'core/kernelBoundary.js#withKernelDir', kind: 'skip', module: 'core', reason: 'OCCT 对象生命周期作用域（L0 内部桥），skip',
  },
  // kernelCall：裸内核调用通道（kernel 句柄/方法名协议）
  {
    name: 'kernelCall', source: 'core/kernelCall.js#kernelCall', kind: 'skip', module: 'core', reason: '裸内核方法调用通道（L0 内部），skip',
  },
  {
    name: 'kernelCallRaw', source: 'core/kernelCall.js#kernelCallRaw', kind: 'skip', module: 'core', reason: '裸内核方法调用（raw 变体，L0 内部），skip',
  },
  {
    name: 'kernelCallScoped', source: 'core/kernelCall.js#kernelCallScoped', kind: 'skip', module: 'core', reason: '裸内核调用 + 句柄作用域（L0 内部），skip',
  },
  // shapeTypes：KernelShape 裸句柄构造/谓词/断言（faijs 面 Shape 经桥接生成，无裸句柄可传）
  {
    name: 'as2D', source: 'core/shapeTypes.js#as2D', kind: 'skip', module: 'core', reason: 'AnyShape → Shape1D 维度收窄（KernelShape 包装），skip',
  },
  {
    name: 'as3D', source: 'core/shapeTypes.js#as3D', kind: 'skip', module: 'core', reason: 'AnyShape → Shape3D 维度收窄（KernelShape 包装），skip',
  },
  {
    name: 'castShape', source: 'core/shapeTypes.js#castShape', kind: 'skip', module: 'core', reason: 'KernelShape → 拓扑类型收窄（裸句柄入参），skip',
  },
  {
    name: 'castShape3D', source: 'core/shapeTypes.js#castShape3D', kind: 'skip', module: 'core', reason: 'KernelShape → Shape3D（裸句柄入参），skip',
  },
  {
    name: 'closedWire', source: 'core/shapeTypes.js#closedWire', kind: 'skip', module: 'core', reason: 'Wire → ClosedWire 判别包装（KernelShape），skip',
  },
  {
    name: 'createCompound', source: 'core/shapeTypes.js#createCompound', kind: 'skip', module: 'core', reason: 'KernelShape → Compound 包装（裸句柄入参），skip',
  },
  {
    name: 'createEdge', source: 'core/shapeTypes.js#createEdge', kind: 'skip', module: 'core', reason: 'KernelShape → Edge 包装（裸句柄入参），skip',
  },
  {
    name: 'createFace', source: 'core/shapeTypes.js#createFace', kind: 'skip', module: 'core', reason: 'KernelShape → Face 包装（裸句柄入参），skip',
  },
  {
    name: 'createShell', source: 'core/shapeTypes.js#createShell', kind: 'skip', module: 'core', reason: 'KernelShape → Shell 包装（裸句柄入参），skip',
  },
  {
    name: 'createSolid', source: 'core/shapeTypes.js#createSolid', kind: 'skip', module: 'core', reason: 'KernelShape → Solid 包装（裸句柄入参），skip',
  },
  {
    name: 'createVertex', source: 'core/shapeTypes.js#createVertex', kind: 'skip', module: 'core', reason: 'KernelShape → Vertex 包装（裸句柄入参），skip',
  },
  {
    name: 'createWire', source: 'core/shapeTypes.js#createWire', kind: 'skip', module: 'core', reason: 'KernelShape → Wire 包装（裸句柄入参），skip',
  },
  {
    name: 'is2D', source: 'core/shapeTypes.js#is2D', kind: 'skip', module: 'core', reason: 'AnyShape 维度判别（KernelShape 谓词），skip',
  },
  {
    name: 'is3D', source: 'core/shapeTypes.js#is3D', kind: 'skip', module: 'core', reason: 'AnyShape 维度判别（KernelShape 谓词），skip',
  },
  {
    name: 'isClosedWire', source: 'core/shapeTypes.js#isClosedWire', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isCompound', source: 'core/shapeTypes.js#isCompound', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isEdge', source: 'core/shapeTypes.js#isEdge', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isFace', source: 'core/shapeTypes.js#isFace', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isManifoldShell', source: 'core/shapeTypes.js#isManifoldShell', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isOrientedFace', source: 'core/shapeTypes.js#isOrientedFace', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isPlanarFace', source: 'core/shapeTypes.js#isPlanarFace', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isPlanarWire', source: 'core/shapeTypes.js#isPlanarWire', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isShape1D', source: 'core/shapeTypes.js#isShape1D', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isShape3D', source: 'core/shapeTypes.js#isShape3D', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isShell', source: 'core/shapeTypes.js#isShell', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isSolid', source: 'core/shapeTypes.js#isSolid', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isValidSolid', source: 'core/shapeTypes.js#isValidSolid', kind: 'skip', module: 'core', reason: 'ValidSolid 判别（KernelShape 谓词），skip',
  },
  {
    name: 'isVertex', source: 'core/shapeTypes.js#isVertex', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'isWire', source: 'core/shapeTypes.js#isWire', kind: 'skip', module: 'core', reason: '拓扑谓词（KernelShape），skip',
  },
  {
    name: 'manifoldShell', source: 'core/shapeTypes.js#manifoldShell', kind: 'skip', module: 'core', reason: 'Shell → ManifoldShell 判别包装（KernelShape），skip',
  },
  {
    name: 'orientedFace', source: 'core/shapeTypes.js#orientedFace', kind: 'skip', module: 'core', reason: 'Face → OrientedFace 判别包装（KernelShape），skip',
  },
  {
    name: 'planarFace', source: 'core/shapeTypes.js#planarFace', kind: 'skip', module: 'core', reason: 'Face → PlanarFace 判别包装（KernelShape），skip',
  },
  {
    name: 'planarWire', source: 'core/shapeTypes.js#planarWire', kind: 'skip', module: 'core', reason: 'Wire → PlanarWire 判别包装（KernelShape），skip',
  },
  {
    name: 'validSolid', source: 'core/shapeTypes.js#validSolid', kind: 'skip', module: 'core', reason: 'Solid → ValidSolid 判别包装（KernelShape），skip',
  },

  // ──── P14 batch 10：sketching 模块（52 = 3 type + 1 pure + 1 brep-op + 47 skip）────
  // sketching 是 brepjs 的「状态化草图 DSL」层：Sketcher/Sketch/Sketches/FaceSketcher/
  // CompoundSketch 类 + draw*/drawing*/sketch*/compoundSketch* 函数全部消费 brepjs 内部
  // 草图状态对象（内部持有 kernel 引用/草绘平面），faijs 面以 cad 命名空间的声明式 op
  // 表达建模，不暴露草图 DSL 状态机 —— 整层除下列 5 个符号外登记 skip。
  // 保留：Drawing/DrawingPen/SketchInterface 类型 re-export（TS 消费方类型面需要）；
  // polysideInnerRadius（纯正多边形内径计算，无 kernel/Shape）；makeBaseBox（纯数值
  // 构造 → Shape3D，brep-op 构造类，与 torus 同款模板）。

  // 3 × type
  {
    name: 'Drawing', source: 'sketching/drawing.js#Drawing', kind: 'type', module: 'sketching',
  },
  {
    name: 'DrawingPen', source: 'sketching/drawingPen.js#DrawingPen', kind: 'type', module: 'sketching',
  },
  {
    name: 'SketchInterface', source: 'sketching/sketch.js#SketchInterface', kind: 'type', module: 'sketching',
  },
  // 1 × pure
  {
    name: 'polysideInnerRadius', source: 'sketching/cannedSketches.js#polysideInnerRadius', kind: 'pure', module: 'sketching', reason: '正多边形内径计算（纯数学，无 kernel/Shape）',
  },
  // 1 × brep-op（构造类：纯数值参数 → Shape3D，无几何输入）
  {
    name: 'makeBaseBox', source: 'sketching/shortcuts.js#makeBaseBox', kind: 'brep-op', module: 'sketching',
    args: '(xLength: number, yLength: number, zLength: number) -> Shape3D',
    consumes: 'none',
    geometryArgs: [],
    returnsResult: false,
  },

  // 47 × skip（状态化草图/绘图 DSL 族）
  {
    name: 'sketchCircle', source: 'sketching/cannedSketches.js#sketchCircle', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL（返回 Sketch 状态对象），skip',
  },
  {
    name: 'sketchEllipse', source: 'sketching/cannedSketches.js#sketchEllipse', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL，skip',
  },
  {
    name: 'sketchFaceOffset', source: 'sketching/cannedSketches.js#sketchFaceOffset', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL（Face 偏移），skip',
  },
  {
    name: 'sketchHelix', source: 'sketching/cannedSketches.js#sketchHelix', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL，skip',
  },
  {
    name: 'sketchParametricFunction', source: 'sketching/cannedSketches.js#sketchParametricFunction', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL，skip',
  },
  {
    name: 'sketchPolysides', source: 'sketching/cannedSketches.js#sketchPolysides', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL，skip',
  },
  {
    name: 'sketchRectangle', source: 'sketching/cannedSketches.js#sketchRectangle', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL，skip',
  },
  {
    name: 'sketchRoundedRectangle', source: 'sketching/cannedSketches.js#sketchRoundedRectangle', kind: 'skip', module: 'sketching', reason: '状态化草图 DSL，skip',
  },
  {
    name: 'CompoundSketch', source: 'sketching/compoundSketch.js#CompoundSketch', kind: 'skip', module: 'sketching', reason: '复合草图状态类（kernel 引用），skip',
  },
  {
    name: 'drawFaceOutline', source: 'sketching/draw3d.js#drawFaceOutline', kind: 'skip', module: 'sketching', reason: '3D 面轮廓绘制 DSL，skip',
  },
  {
    name: 'drawProjection', source: 'sketching/draw3d.js#drawProjection', kind: 'skip', module: 'sketching', reason: '投影绘制 DSL，skip',
  },
  {
    name: 'drawingChamfer', source: 'sketching/drawFns.js#drawingChamfer', kind: 'skip', module: 'sketching', reason: '绘图 DSL 变换（Drawing 状态对象），skip',
  },
  {
    name: 'drawingCut', source: 'sketching/drawFns.js#drawingCut', kind: 'skip', module: 'sketching', reason: '绘图 DSL 布尔（Drawing 状态对象），skip',
  },
  {
    name: 'drawingFillet', source: 'sketching/drawFns.js#drawingFillet', kind: 'skip', module: 'sketching', reason: '绘图 DSL 变换（Drawing 状态对象），skip',
  },
  {
    name: 'drawingFuse', source: 'sketching/drawFns.js#drawingFuse', kind: 'skip', module: 'sketching', reason: '绘图 DSL 布尔（Drawing 状态对象），skip',
  },
  {
    name: 'drawingIntersect', source: 'sketching/drawFns.js#drawingIntersect', kind: 'skip', module: 'sketching', reason: '绘图 DSL 布尔（Drawing 状态对象），skip',
  },
  {
    name: 'drawingToSketchOnPlane', source: 'sketching/drawFns.js#drawingToSketchOnPlane', kind: 'skip', module: 'sketching', reason: 'Drawing → Sketch 状态迁移，skip',
  },
  {
    name: 'mirrorDrawing', source: 'sketching/drawFns.js#mirrorDrawing', kind: 'skip', module: 'sketching', reason: '绘图 DSL 变换（Drawing 状态对象），skip',
  },
  {
    name: 'rotateDrawing', source: 'sketching/drawFns.js#rotateDrawing', kind: 'skip', module: 'sketching', reason: '绘图 DSL 变换（Drawing 状态对象），skip',
  },
  {
    name: 'scaleDrawing', source: 'sketching/drawFns.js#scaleDrawing', kind: 'skip', module: 'sketching', reason: '绘图 DSL 变换（Drawing 状态对象），skip',
  },
  {
    name: 'translateDrawing', source: 'sketching/drawFns.js#translateDrawing', kind: 'skip', module: 'sketching', reason: '绘图 DSL 变换（Drawing 状态对象），skip',
  },
  {
    name: 'deserializeDrawing', source: 'sketching/drawing.js#deserializeDrawing', kind: 'skip', module: 'sketching', reason: '绘图序列化重建（状态对象），skip',
  },
  {
    name: 'drawCircle', source: 'sketching/drawingFactories.js#drawCircle', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL（Drawing 状态对象），skip',
  },
  {
    name: 'drawEllipse', source: 'sketching/drawingFactories.js#drawEllipse', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL（Drawing 状态对象），skip',
  },
  {
    name: 'drawParametricFunction', source: 'sketching/drawingFactories.js#drawParametricFunction', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL，skip',
  },
  {
    name: 'drawPointsInterpolation', source: 'sketching/drawingFactories.js#drawPointsInterpolation', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL，skip',
  },
  {
    name: 'drawPolysides', source: 'sketching/drawingFactories.js#drawPolysides', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL，skip',
  },
  {
    name: 'drawRectangle', source: 'sketching/drawingFactories.js#drawRectangle', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL，skip',
  },
  {
    name: 'drawRoundedRectangle', source: 'sketching/drawingFactories.js#drawRoundedRectangle', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL，skip',
  },
  {
    name: 'drawSingleCircle', source: 'sketching/drawingFactories.js#drawSingleCircle', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL，skip',
  },
  {
    name: 'drawSingleEllipse', source: 'sketching/drawingFactories.js#drawSingleEllipse', kind: 'skip', module: 'sketching', reason: '绘图工厂 DSL，skip',
  },
  {
    name: 'drawText', source: 'sketching/drawingFactories.js#drawText', kind: 'skip', module: 'sketching', reason: '文本绘制 DSL，skip',
  },
  {
    name: 'draw', source: 'sketching/drawingPen.js#draw', kind: 'skip', module: 'sketching', reason: 'DrawingPen 状态入口（段落累积），skip',
  },
  {
    name: 'FaceSketcher', source: 'sketching/faceSketcher.js#FaceSketcher', kind: 'skip', module: 'sketching', reason: '面上草图状态类（kernel Face 引用），skip',
  },
  {
    name: 'Sketch', source: 'sketching/sketch.js#Sketch', kind: 'skip', module: 'sketching', reason: '草图状态类（kernel 草绘平面），skip',
  },
  {
    name: 'compoundSketchExtrude', source: 'sketching/sketchFns.js#compoundSketchExtrude', kind: 'skip', module: 'sketching', reason: '草图状态拉伸（CompoundSketch 入参），skip',
  },
  {
    name: 'compoundSketchFace', source: 'sketching/sketchFns.js#compoundSketchFace', kind: 'skip', module: 'sketching', reason: '草图状态取面（CompoundSketch 入参），skip',
  },
  {
    name: 'compoundSketchLoft', source: 'sketching/sketchFns.js#compoundSketchLoft', kind: 'skip', module: 'sketching', reason: '草图状态放样（CompoundSketch 入参），skip',
  },
  {
    name: 'compoundSketchRevolve', source: 'sketching/sketchFns.js#compoundSketchRevolve', kind: 'skip', module: 'sketching', reason: '草图状态旋转（CompoundSketch 入参），skip',
  },
  {
    name: 'sketchExtrude', source: 'sketching/sketchFns.js#sketchExtrude', kind: 'skip', module: 'sketching', reason: '草图状态拉伸（Sketch 入参），skip',
  },
  {
    name: 'sketchFace', source: 'sketching/sketchFns.js#sketchFace', kind: 'skip', module: 'sketching', reason: '草图状态取面（Sketch 入参），skip',
  },
  {
    name: 'sketchLoft', source: 'sketching/sketchFns.js#sketchLoft', kind: 'skip', module: 'sketching', reason: '草图状态放样（Sketch 数组入参），skip',
  },
  {
    name: 'sketchRevolve', source: 'sketching/sketchFns.js#sketchRevolve', kind: 'skip', module: 'sketching', reason: '草图状态旋转（Sketch 入参），skip',
  },
  {
    name: 'sketchSweep', source: 'sketching/sketchFns.js#sketchSweep', kind: 'skip', module: 'sketching', reason: '草图状态扫掠（Sketch + spine），skip',
  },
  {
    name: 'sketchWires', source: 'sketching/sketchFns.js#sketchWires', kind: 'skip', module: 'sketching', reason: '草图取线框（Sketch 入参），skip',
  },
  {
    name: 'Sketcher', source: 'sketching/sketcher.js#Sketcher', kind: 'skip', module: 'sketching', reason: '草图 DSL 状态类（kernel 句柄），skip',
  },
  {
    name: 'Sketches', source: 'sketching/sketches.js#Sketches', kind: 'skip', module: 'sketching', reason: '草图集合状态类（kernel 引用），skip',
  },
]
