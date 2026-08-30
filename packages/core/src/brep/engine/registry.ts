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

/**
 * Register a BREP engine (slot 1). The first registrant automatically becomes the default.
 * @param id - the engine registration id.
 * @param provider - the async provider that resolves the engine instance.
 */
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

/**
 * Register a mesh engine (slot 2). The first registrant automatically becomes the default.
 * @param id - the engine registration id.
 * @param engine - the engine instance to register.
 */
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

/**
 * Whether a default BREP engine is registered (none → mesh mode, equivalent to "no BREP capability").
 * @returns true when a default BREP engine is registered.
 */
export function hasBrepEngine(): boolean {
  return defaultBrepId !== null
}

/**
 * Whether the given BREP engine is registered (used for idempotent adapter registration).
 * @param id - the engine registration id to look up.
 * @returns true when the engine is registered.
 */
export function isBrepEngineRegistered(id: string): boolean {
  return brepEngineProviders.has(id)
}

/**
 * Resolve a BREP engine (asynchronously, resolving its provider; throws when not registered).
 * Omitting id uses the default (the first registrant).
 * @param id - optional engine registration id; defaults to the active engine.
 * @returns a Promise resolving to the BREP engine instance.
 */
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

/**
 * Get a mesh engine (throws when not registered). Omitting id uses the default (the first registrant).
 * @param id - optional engine registration id; defaults to the active engine.
 * @returns the mesh engine instance.
 */
export function getMeshEngine(id?: string): MeshEngine {
  const key = id ?? defaultMeshId
  const engine = key === null ? undefined : meshEngines.get(key)
  if (!engine) {
    throw new Error(`[engine/registry] mesh engine '${key ?? '<none>'}' not registered`)
  }
  return engine
}

/**
 * The current default BREP engine id (null when none is registered).
 * @returns the active BREP engine id or null.
 */
export function getActiveBrepEngineId(): string | null {
  return defaultBrepId
}

/**
 * The current default mesh engine id (null when none is registered).
 * @returns the active mesh engine id or null.
 */
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
