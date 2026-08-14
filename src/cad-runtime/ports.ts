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
 * 事件通知接口 — 断链等事件。
 *
 * browser 实现：BrowserEventSink（window.dispatchEvent → toast）
 * node 实现 (P3)：NodeEventSink（写入 result.infos / stderr）
 */
export interface EventSink {
  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void
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
