/**
 * brepkit-kernel/brepkitWasm — brepkit-wasm 装载（setOcctWasmInitFn 同构的注入点）
 *
 * 装载策略（与 occt-kernel 一致）：
 * - 宿主可调用 setBrepkitWasmInitFn(fn) 注入自定义初始化函数
 *   （小程序 Worker 传 WXWebAssembly 实例化路径；node 测试走 npm 包默认 init）；
 * - 未注入时，node 环境直接 require('brepkit-wasm')（该包胶水零 eval，可直接装载）；
 * - 两边都没有 → 抛带上下文的错误（报错好于掩盖，禁止静默回退）。
 */

/** brepkit 内核实例形态（BrepKernel 类，228 个方法；类型面见 npm 包 brepkit_wasm.d.ts）。 */
export type BrepKitKernel = any

type BrepKitInitFn = () => Promise<BrepKitKernel>

// 2026-09-26 跨实例共享（随 0.18.2 发布）：customInitFn / initPromise 从模块级
// 单例提升为挂在 globalThis 上的共享状态（与 occtKernel.ts / runtime-state.ts
// 同款设计）。原因：CDN 外部化的 faijs 多实例各自持有独立内核 → 句柄不互通
// （occtKernel.ts 顶部注释详述）；小程序 Worker 场景同理。挂到 globalThis 后，
// 任一实例 initBrepkitWasm() 产出的内核全局可见，句柄互通。
// 构建期去重（external / dedupe）仍是主手段，这里是兜底。

const BREPKIT_KERNEL_KEY = '__FAICAD_FAIJS_BREPKIT_KERNEL__'
const BREPKIT_KERNEL_STATE_VERSION = 1

/** brepkit 内核共享状态（跨 faijs 模块实例，浏览器/Node/小程序 Worker 多环境）。 */
interface BrepkitKernelSharedState {
  stateVersion: number
  customInitFn: BrepKitInitFn | null
  initPromise: Promise<BrepKitKernel> | null
}

/**
 * 获取 brepkit 内核共享状态（单例）。
 *
 * 挂在 globalThis 上是为了让"两份 faijs 代码"（宿主 bundle 一份、第三方库
 * 外部化一份）共享同一份内核状态——否则两份 initPromise 导致内核各自初始化、
 * 句柄不互通（几何孤岛）。
 *
 * @returns the shared brepkit kernel state singleton.
 */
function getBrepkitKernelSharedState(): BrepkitKernelSharedState {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[BREPKIT_KERNEL_KEY] as BrepkitKernelSharedState | undefined
  if (existing) {
    if (existing.stateVersion !== BREPKIT_KERNEL_STATE_VERSION) {
      throw new Error(
        `[faijs] brepkit kernel state version mismatch: loaded=${existing.stateVersion}, expected=${BREPKIT_KERNEL_STATE_VERSION}`,
      )
    }
    return existing
  }
  const created: BrepkitKernelSharedState = {
    stateVersion: BREPKIT_KERNEL_STATE_VERSION,
    customInitFn: null,
    initPromise: null,
  }
  g[BREPKIT_KERNEL_KEY] = created
  return created
}

/**
 * 注入自定义 brepkit wasm 初始化函数（宿主装配期调用一次）。写入共享挂点——
 * 任意 faijs 实例（含 CDN 外部化实例 / 小程序 Worker 副实例）都优先使用。
 * @param fn - the initialization function to use, or null to clear
 */
export function setBrepkitWasmInitFn(fn: (() => Promise<BrepKitKernel>) | null): void {
  const s = getBrepkitKernelSharedState()
  s.customInitFn = fn
  // 挂点变化后丢弃进行中的初始化（下一次 init 用新挂点重来）。
  s.initPromise = null
}

/**
 * 初始化并返回 BrepKernel 单例（幂等：多次调用共享同一次初始化）。
 * @returns Promise 解析为 BrepKernel 实例。
 */
export function initBrepkitWasm(): Promise<BrepKitKernel> {
  const s = getBrepkitKernelSharedState()
  if (s.initPromise) return s.initPromise
  s.initPromise = (async (): Promise<BrepKitKernel> => {
    if (s.customInitFn) return await s.customInitFn()
    // node 环境（单测 / CLI）：npm 包默认装载路径

    if (typeof process !== 'undefined' && process.versions?.node) {
      // Non-literal specifier: brepkit-wasm is an optional runtime injection, not
      // a declared dependency — a literal would make tsc fail with TS2307 when
      // the package is absent. A missing package surfaces at runtime (below).
      const specifier = 'brepkit-wasm'
      const mod = (await import(/* @vite-ignore */ specifier)) as {
        BrepKernel: new () => BrepKitKernel
      }
      if (!mod?.BrepKernel) {
        throw new Error('initBrepkitWasm: brepkit-wasm is not installed; install it or call setBrepkitWasmInitFn() first.')
      }
      return new mod.BrepKernel() as BrepKitKernel
    }
    throw new Error('initBrepkitWasm: no init function set and not in Node environment. Call setBrepkitWasmInitFn() first.')
  })()
  return s.initPromise
}

/** 是否已初始化完成（测试诊断用）。
 * @returns true 表示 init 已启动/完成。 */
export function isBrepkitInitialized(): boolean {
  return getBrepkitKernelSharedState().initPromise !== null
}

/**
 * 丢弃当前初始化结果（测试收尾 / 内核释放后调用）。
 *
 * `disposeBrepkit()` 必须调它——否则已释放的内核仍被缓存的 `initPromise` 引用，
 * 下一次 `initBrepkitWasm()` 会返回**已释放**的内核（实测报 `null pointer passed
 * to rust`）。`customInitFn` 不受影响（宿主注入的装载路径仍在）。
 */
export function resetBrepkitWasm(): void {
  getBrepkitKernelSharedState().initPromise = null
}
