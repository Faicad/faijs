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

let customInitFn: BrepKitInitFn | null = null
let initPromise: Promise<BrepKitKernel> | null = null

/**
 * 注入自定义 brepkit wasm 初始化函数（宿主装配期调用一次）。
 * @param fn - the initialization function to use, or null to clear
 */
export function setBrepkitWasmInitFn(fn: (() => Promise<BrepKitKernel>) | null): void {
  customInitFn = fn
  initPromise = null
}

/**
 * 初始化并返回 BrepKernel 单例（幂等：多次调用共享同一次初始化）。
 * @returns Promise 解析为 BrepKernel 实例。
 */
export function initBrepkitWasm(): Promise<BrepKitKernel> {
  if (initPromise) return initPromise
  initPromise = (async (): Promise<BrepKitKernel> => {
    if (customInitFn) return await customInitFn()
    // node 环境（单测 / CLI）：npm 包默认装载路径

    if (typeof process !== 'undefined' && process.versions?.node) {
      const mod = await import('brepkit-wasm')
      return new mod.BrepKernel() as BrepKitKernel
    }
    throw new Error('initBrepkitWasm: no init function set and not in Node environment. Call setBrepkitWasmInitFn() first.')
  })()
  return initPromise
}

/** 是否已初始化完成（测试诊断用）。
 * @returns true 表示 init 已启动/完成。 */
export function isBrepkitInitialized(): boolean {
  return initPromise !== null
}
