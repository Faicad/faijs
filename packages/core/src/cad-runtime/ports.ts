/**
 * Ports 接口定义 — Host 注入的环境能力
 *
 *
 * L2 CadRuntime 通过这些接口获取所有环境能力（CSG 计算、SDF 求值、字体、纹理、资产、事件）。
 * 不直接 import 任何 ?worker、window、document、zustand store——这些由 Host 实现。
 *
 * 两个宿主各自实现：
 * - browser host: WorkerCsgBackend / WorkerSdfBackend / BrowserFontProvider / ...
 * - node host (P3): InlineCsgBackend / InlineSdfBackend / NodeFontProvider / ...
 */

import type { PartName } from '../identity'
import type { StdlibNamespace } from '../runtime-state'

// ── 共享类型 ──

/** 网格数据（与 csg.ts ManifoldMeshData 同构） */
export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
}

/** 平面参数 */
export interface PlaneParams {
  normal: [number, number, number]
  offset: number
}

// Re-export joinery param types from boolean/geo-convert to ensure
// structural identity across CsgBackend interface and implementations.
export type {
  DovetailGrooveParams,
  DowelSplitParams,
  StraightTenonSplitParams,
} from '../boolean/geo-convert'
import type {
  DovetailGrooveParams,
  DowelSplitParams,
  StraightTenonSplitParams,
} from '../boolean/geo-convert'

/** 分割结果 */
export interface SplitResult {
  front: MeshData
  back: MeshData
  wedge: MeshData | null
}

// ── CsgBackend ──

/**
 * CSG 后端接口 — mesh 路径的布尔/分割操作。
 *
 * browser 实现：WorkerCsgBackend（经 csg-worker postMessage）
 * node 实现 (P3)：InlineCsgBackend（主线程直跑 manifold-3d）
 */
export interface CsgBackend {
  boolean(op: 'union' | 'subtract' | 'intersect', meshes: MeshData[]): Promise<MeshData>
  splitPlane(mesh: MeshData, plane: PlaneParams): Promise<{ front: MeshData; back: MeshData }>
  splitDovetail(
    mesh: MeshData,
    params: {
      planeNormal: [number, number, number]
      planeOriginOffset: number
      planeCenter: [number, number, number]
      widthDir: [number, number, number]
      bboxWidthOnWidthDir: number
      groove: DovetailGrooveParams
    },
  ): Promise<SplitResult>
  splitDowel(
    mesh: MeshData,
    params: {
      planeNormal: [number, number, number]
      planeOriginOffset: number
      planeCenter: [number, number, number]
      widthDir: [number, number, number]
      dowel: DowelSplitParams
      selectedSections?: number[] | null
    },
  ): Promise<SplitResult>
  splitStraightTenon(
    mesh: MeshData,
    params: {
      planeNormal: [number, number, number]
      planeOriginOffset: number
      planeCenter: [number, number, number]
      widthDir: [number, number, number]
      tenon: StraightTenonSplitParams
      selectedSections?: number[] | null
    },
  ): Promise<SplitResult>
}

// ── SdfBackend ──

/**
 * SDF 后端接口 — SDF 求值。
 *
 * browser 实现：WorkerSdfBackend（经 sdf-worker postMessage）
 * node 实现 (P3)：InlineSdfBackend（主线程直跑）
 */
export interface SdfBackend {
  runSdf(
    code: string,
    params: Record<string, number>,
    bounds: [number, number, number, number, number, number],
    edgeLength: number,
    level?: number,
    tolerance?: number,
  ): Promise<MeshData>
}

// ── FontProvider ──

/**
 * 字体提供者接口。
 *
 * browser 实现：BrowserFontProvider（?url + fetch + fontRegistry DI）
 * node 实现 (P3)：NodeFontProvider（fs 字体加载）
 */
export interface FontProvider {
  /** 加载字体字节（按 key/path），返回 ArrayBuffer */
  loadFont(key: string): Promise<ArrayBuffer>
  /** 列出可用字体 key（node 端为资产目录，browser 端为注册表） */
  listFonts(): string[]
}

// ── TextureSampler ──

/**
 * 纹理采样接口 — knurl 纹理。
 *
 * browser 实现：CanvasTextureSampler（Image + canvas）
 * node 实现 (P3)：纯数据解码
 */
export interface TextureSampler {
  /** 采样纹理在 (u, v) 处的值 [0,1] */
  sample(u: number, v: number): number
  /** 纹理尺寸 */
  readonly width: number
  readonly height: number
}

// ── AssetResolver ──

/**
 * 资产解析接口 — load* 操作的字节来源。
 *
 * browser 实现：FaicadAssetResolver（faicad 会话缓存）
 * node 实现 (P3)：FsAssetResolver（--assets 目录/manifest）
 */
export interface AssetResolver {
  /** loadByKey 的 headless 等价物 */
  resolveByKey(key: string): Promise<{ bytes: ArrayBuffer; format?: string }>
  /** 本地文件路径（browser 下抛错） */
  resolveFile(path: string): Promise<ArrayBuffer>
  /** 网络 URL（两环境通用） */
  resolveUrl(url: string): Promise<ArrayBuffer>
}

// ── EventSink ──

/**
 * 事件通知接口 — BREP 丢失等事件。
 *
 * browser 实现：BrowserEventSink（window.dispatchEvent → toast）
 * node 实现 (P3)：CliEventSink（写入 stderr + 收集到 events 数组）
 */
export interface EventSink {
  emit(event: 'part-brep-lost', detail: { partName: PartName; callee: string; reason: string }): void
}

// ── LibLoader ──

/**
 * 库加载器接口 — 按 packageName 自动装载未注册的第三方库。
 *
 * 宿主实现：
 * - node CLI（createNodePorts）：白名单 + Node 原生 `import(name)`（monorepo
 *   workspace symlink 直接把裸包解析到包源码）。
 * - browser / demo：静态 `LIB_MODULES` 映射表（value 必须是静态字面量
 *   specifier，Vite/Rollup 才能静态分析打包；禁止变量传参的 import(name)）。
 * - vitest：复用浏览器映射表写法 + `await import('@faicad/…')`（alias 落位活源码）。
 */
export interface LibLoader {
  /** 按 packageName 加载库模块，返回其导出命名空间对象（与 registerLib 的 ns 同形）。 */
  loadLib(packageName: string): Promise<StdlibNamespace>
  /** 列出当前可加载的 packageName（check 阶段同步校验 import specifier 用）。 */
  listLibs(): string[]
  /** 自动装载的注册选项；缺省由推断式决定（有 dual-op 的库不提升，全裸函数库自动提升，与手动注入一致）。 */
  options?: {
    autoLift?: boolean
    /**
     * 按 packageName 的逐库 `autoLift` 覆盖（优先于 `options.autoLift`）。
     * 返回 `undefined` 时回落到全局选项 / 推断式。用于别名库：如 cq-compat 在
     * 浏览器 host 被全局 autoLift 提升后，compat 边界的 borrowDeep 会把实参里的
     * faijs Shape 替换成 brepjs 借用视图，破坏其内部「以 Shape 受众」的借面逻辑
     * （原 CLI 即按 autoLift=false 运行）。逐库关掉提升恢复 CLI 等价行为。
     */
    autoLiftFor?: (packageName: string) => boolean | undefined
  }
  /**
   * 可选源码扫描钩子（§6.2 ②）：宿主返回库源码时走同一 SecurityScanner（A4，固定 strict）；
   * 不提供或返回 undefined 则跳过。不改 loadLib 返回值——返回 StdlibNamespace，
   * 往里挂 source 会被 admitCompatLib 当成导出值并污染命名空间。
   * @param packageName - the npm package name.
   * @returns the library source text if available, otherwise undefined.
   */
  loadSource?(packageName: string): Promise<string | undefined>
}

// ── ProjectLoader ──

/**
 * 项目文件加载器（多文件，§4.5）——按 moduleKey 读取/枚举项目内 .fai.js 模块源码。
 *
 * moduleKey 约定：host 决定字符串形态（项目根相对路径等）；引擎只做最小归一
 * （POSIX 斜杠、去掉 `./`/`../`/前导 `/` 前缀），随后按 `listModules()` 精确匹配。
 *
 * host 实现：
 * - 3d_editor / browser：项目文件表 + session 内缓存；
 * - node / vitest：内存映射表或 fs 读取（fixture 目录）。
 */
export interface ProjectLoader {
  /** 列出当前可加载的 moduleKey（装载前预检 / 错误提示用）。 */
  listModules(): string[]
  /** 按 moduleKey 读取模块源码（.fai.js 文本）。 */
  readSource(moduleKey: string): Promise<string>
  /** 模块内容指纹（增量缓存用；不提供则每次全量重读重执行）。 */
  fingerprint?(moduleKey: string): Promise<string>
}

// ── HostPorts 汇总 ──

/**
 * Host 在 createRuntime 时注入的全部环境能力。
 *
 * 所有字段可选——node 测试环境可只提供 occt kernel（不注入 csg/sdf），
 * BREP-path ops 不依赖这些 Port。
 */
export interface HostPorts {
  csg?: CsgBackend
  sdf?: SdfBackend
  fonts?: FontProvider
  texture?: TextureSampler
  assets?: AssetResolver
  events: EventSink  // events 必填——断链通知是基础能力
  /** 库加载器（execute 自动装载未注册库；check 用它做 specifier 预检）。可选——无则仅手工 registerLib。 */
  libLoader?: LibLoader
  /** 项目文件加载器（相对 specifier 的多文件模块，§4.5）。可选——不提供则单文件行为不变。 */
  projectLoader?: ProjectLoader
}

// ── 执行模式 ──

/**
 * 执行模式（设计文档 §4.4）。
 *
 * - `auto`（默认）：优先 BREP，断链后自动切 mesh + EventSink 通知
 * - `brep`：强制 BREP，断链即报错 E_BREP_UNSUPPORTED，不自动切换
 * - `mesh`：全部走 mesh 路径
 */
export type ExecutionMode = 'auto' | 'brep' | 'mesh'
