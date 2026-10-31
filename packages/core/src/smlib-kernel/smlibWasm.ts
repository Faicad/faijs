/**
 * smlib-kernel/smlibWasm — smlib wasm 装载（@faicad/smlib-wasm 包）
 *
 * 装载与类型化包装算法全部在独立包 @faicad/smlib-wasm 内（三宿主 loader +
 * SmlibKernel 内核壳：malloc/free/读时视图/错误消息全在包内）；本文件只保留
 * faijs 侧装配点：
 * - 宿主注入：setSmlibWasmInitFn(fn)（微信端 WXWebAssembly 路径，见 3d_editor
 *   weapp worker 的 loadSmlib）；
 * - node 默认装载：解析包内 wasm（'@faicad/smlib-wasm/wasm'）→ 包 loader 读取
 *   实例化 → SmlibKernel.init（smw_init 已含）；
 * - 两边都没有 → 抛带上下文的错误（报错好于掩盖，禁止静默回退）。
 *
 * imports 是 native/JS EH 通用 superset：native 模块忽略多余 env 项；
 * JS EH 微信/iOS 模块按实际 import 消费 invoke/cxa 转发。
 */

import { SmlibKernel, smwImports } from '@faicad/smlib-wasm'
import type { SmwRawExports } from '@faicad/smlib-wasm'

export type { SmlibKernel } from '@faicad/smlib-wasm'

type SmlibInitFn = () => Promise<SmlibKernel>

// 跨实例共享（与 brepkitWasm 同款设计）：customInitFn / initPromise 挂在
// globalThis 上，CDN 外部化多实例 / 小程序 Worker 副实例共享同一内核状态，
// 句柄互通。

const SMLIB_KERNEL_KEY = '__FAICAD_FAIJS_SMLIB_KERNEL__'
const SMLIB_KERNEL_STATE_VERSION = 1

interface SmlibKernelSharedState {
  stateVersion: number
  customInitFn: SmlibInitFn | null
  initPromise: Promise<SmlibKernel> | null
}

/** 获取 smlib 内核共享状态（单例）。 */
function getSmlibKernelSharedState(): SmlibKernelSharedState {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[SMLIB_KERNEL_KEY] as SmlibKernelSharedState | undefined
  if (existing) {
    if (existing.stateVersion !== SMLIB_KERNEL_STATE_VERSION) {
      throw new Error(
        `[faijs] smlib kernel state version mismatch: loaded=${existing.stateVersion}, expected=${SMLIB_KERNEL_STATE_VERSION}`,
      )
    }
    return existing
  }
  const created: SmlibKernelSharedState = {
    stateVersion: SMLIB_KERNEL_STATE_VERSION,
    customInitFn: null,
    initPromise: null,
  }
  g[SMLIB_KERNEL_KEY] = created
  return created
}

/**
 * 注入自定义 smlib wasm 初始化函数（宿主装配期调用一次）。写入共享挂点——
 * 任意 faijs 实例（含 CDN 外部化实例 / 小程序 Worker 副实例）都优先使用。
 * @param fn - the initialization function to use, or null to clear
 */
export function setSmlibWasmInitFn(fn: (() => Promise<SmlibKernel>) | null): void {
  const s = getSmlibKernelSharedState()
  s.customInitFn = fn
  // 挂点变化后丢弃进行中的初始化（下一次 init 用新挂点重来）。
  s.initPromise = null
}

/**
 * 初始化并返回 smlib 内核单例（幂等：多次调用共享同一次初始化）。
 * @returns Promise 解析为 SmlibKernel（@faicad/smlib-wasm 类型化内核壳）。
 */
export function initSmlibWasm(): Promise<SmlibKernel> {
  const s = getSmlibKernelSharedState()
  if (s.initPromise) return s.initPromise
  s.initPromise = (async (): Promise<SmlibKernel> => {
    if (s.customInitFn) return await s.customInitFn()
    // node 环境（单测 / CLI）：包内 wasm 默认装载路径
    if (typeof process !== 'undefined' && process.versions?.node) {
      return await loadNodeDefault()
    }
    throw new Error('initSmlibWasm: no init function set and not in Node environment. Call setSmlibWasmInitFn() first.')
  })()
  return s.initPromise
}

/** 是否已初始化完成（测试诊断用）。
 * @returns true 表示 wasm 已装载完成。 */
export function isSmlibInitialized(): boolean {
  return getSmlibKernelSharedState().initPromise !== null
}

/**
 * 丢弃当前初始化结果（测试收尾 / 内核释放后调用）。
 * customInitFn 不受影响（宿主注入的装载路径仍在）。
 */
export function resetSmlibWasm(): void {
  getSmlibKernelSharedState().initPromise = null
}

/**
 * smlib wasm 的完整 superset imports（native 忽略多余项，JS EH 消费 invoke/cxa 转发）。
 * 微信端装载器复用：WXWebAssembly.instantiate(path, createSmlibImportsByName())。
 * @returns the complete WebAssembly imports object for the smlib module.
 */
export function createSmlibImportsByName(): WebAssembly.Imports {
  return smwImports()
}

/**
 * 由宿主自行实例化的 wasm Instance 构建 SmlibKernel（微信端复用：
 * WXWebAssembly instantiate 后把 instance 交给本函数，得到与 node 端
 * 同构的内核句柄；smw_init 已含）。
 * @param instance - 已实例化的 smlib wasm Instance
 * @returns 与 node 端同构的 SmlibKernel 内核句柄
 */
export function buildSmlibKernel(instance: WebAssembly.Instance): SmlibKernel {
  return SmlibKernel.init(instance.exports as SmwRawExports)
}

// ── Node 默认装载 ──

async function loadNodeDefault(): Promise<SmlibKernel> {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const wasmPath = require.resolve('@faicad/smlib-wasm/wasm')
  return await SmlibKernel.create({ kind: 'nodePath', path: wasmPath })
}
