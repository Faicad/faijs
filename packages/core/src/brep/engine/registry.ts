/**
 * engine/registry — BREP / mesh 双槽位注册表（§6.2，R8 构建时切换）
 *
 * 设计：docs/plans/2026-08-30-brep-engine-switch.md §6.2 / §8
 *
 * 与 brepjs 的 registerKernel 同构（首个注册者为默认），但两张表、两套 getter——
 * 这是 R2（双槽位正交：mesh 引擎与 BREP 引擎独立注册、单独切换）的直接落地。
 *
 * BREP 槽以「异步 provider」注册：引擎可能需异步初始化（occt-wasm 加载、
 * 外部内核 wasm 下载等），provider 只解析一次，结果缓存。
 *
 * 注册只发生在宿主启动装配期（R8）：构建时选定的适配器包在初始化时完成注册，
 * 之后注册表运行期只读。不提供运行时的 unregister / setDefault / 切换 API；
 * 装配完成后调用 freezeEngineRegistries() 冻结，冻结后任何注册尝试抛错（E2 验收）。
 */

import type { BrepEngineApi } from './primitives'
import type { BrepCapabilities } from './types'

/** BREP 引擎实例（槽位 1）：原语契约 + 可选能力声明。 */
export interface BrepEngine {
  readonly id: string
  readonly primitives: BrepEngineApi
  readonly capabilities?: BrepCapabilities
}

/** BREP 引擎异步提供者（宿主装配时注册；引擎初始化完成后 resolve）。 */
export type BrepEngineProvider = () => Promise<BrepEngine>

/** mesh 引擎实例（槽位 2）——与 BREP 槽完全独立（R2）。Phase 3 钉死形态。 */
export interface MeshEngine {
  readonly id: string
}

const brepEngineProviders = new Map<string, BrepEngineProvider>()
const brepEngineCache = new Map<string, BrepEngine>()
let defaultBrepId: string | null = null

const meshEngines = new Map<string, MeshEngine>()
let defaultMeshId: string | null = null

let frozen = false

/**
 * 冻结注册表：宿主启动装配完成后调用（R8）。
 * 冻结后任何 registerBrepEngine / registerMeshEngine 尝试抛错。
 * 已解析的引擎实例仍可读取（运行期只读，不冻结读取）。
 */
export function freezeEngineRegistries(): void {
  frozen = true
}

/** 注册 BREP 引擎（槽位 1）。首个注册者自动成为默认。 */
export function registerBrepEngine(id: string, provider: BrepEngineProvider): void {
  if (frozen) {
    throw new Error(`[engine/registry] registry frozen — cannot register BREP engine '${id}' after assembly (R8)`)
  }
  if (brepEngineProviders.has(id)) {
    throw new Error(`[engine/registry] BREP engine '${id}' already registered`)
  }
  brepEngineProviders.set(id, provider)
  if (defaultBrepId === null) defaultBrepId = id
}

/** 注册 mesh 引擎（槽位 2）。首个注册者自动成为默认。 */
export function registerMeshEngine(id: string, engine: MeshEngine): void {
  if (frozen) {
    throw new Error(`[engine/registry] registry frozen — cannot register mesh engine '${id}' after assembly (R8)`)
  }
  if (meshEngines.has(id)) {
    throw new Error(`[engine/registry] mesh engine '${id}' already registered`)
  }
  meshEngines.set(id, engine)
  if (defaultMeshId === null) defaultMeshId = id
}

/** 默认 BREP 引擎是否已注册（未注册 → mesh 模式等价「无 BREP 能力」）。 */
export function hasBrepEngine(): boolean {
  return defaultBrepId !== null
}

/** 取 BREP 引擎（异步解析 provider；未注册则抛错）。省略 id 用默认（首个注册者）。 */
export async function getBrepEngine(id?: string): Promise<BrepEngine> {
  const key = id ?? defaultBrepId
  if (key === null) {
    throw new Error('[engine/registry] no BREP engine registered — call registerBrepEngine() during host assembly (R8)')
  }
  const cached = brepEngineCache.get(key)
  if (cached) return cached
  const provider = brepEngineProviders.get(key)
  if (!provider) {
    throw new Error(`[engine/registry] BREP engine '${key}' not registered`)
  }
  const engine = await provider()
  brepEngineCache.set(key, engine)
  return engine
}

/** 取 mesh 引擎（未注册则抛错）。省略 id 用默认（首个注册者）。 */
export function getMeshEngine(id?: string): MeshEngine {
  const key = id ?? defaultMeshId
  const engine = key === null ? undefined : meshEngines.get(key)
  if (!engine) {
    throw new Error(`[engine/registry] mesh engine '${key ?? '<none>'}' not registered`)
  }
  return engine
}

/** 当前默认 BREP 引擎 id（无注册返回 null）。 */
export function getActiveBrepEngineId(): string | null {
  return defaultBrepId
}

/** 当前默认 mesh 引擎 id（无注册返回 null）。 */
export function getActiveMeshEngineId(): string | null {
  return defaultMeshId
}

/**
 * 仅测试用：重置注册表状态。
 *
 * R8 不提供运行期的 unregister / setDefault；此函数仅供 registry.test.ts
 * 重置模块级单例，不进入任何公共导出面（index/browser/node/sdk 均不 re-export）。
 */
export function __resetEngineRegistriesForTests(): void {
  brepEngineProviders.clear()
  brepEngineCache.clear()
  meshEngines.clear()
  defaultBrepId = null
  defaultMeshId = null
  frozen = false
}
