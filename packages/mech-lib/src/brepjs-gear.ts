/**
 * C1 — brepjs 兼容层 adapter（fixture）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §6 / §7.4 C1
 *
 * 这是一个**第三方库**（模拟真实 `brepjs-gear` 库模块，`import * as gear from 'brepjs-gear'` 的目标），
 * 不是 faijs 的一部分（§6.2：adapter 属于库，faijs 不需要为 brepjs 写任何专有代码）。
 *
 * 职责（§6.2 表）：
 * ① 注入 faijs 内核：`OcctWasmAdapter.fromKernel(getRawModule/getRawKernel)` 复用 faijs 的
 *    occt-wasm 实例——零 shim、零额外 wasm 下载（§6.1）。
 * ② 调 brepjs 建形（`makeExternalGear` / `makeInternalGear` / `makePlanetaryGear`，
 *    以及 C5 泛化第二类 `thread`）。
 * ③ `wrapped.id` → `fromHandle` 转 faijs Shape（拿到 BREP 槽，`hasBrep === true`）。
 * ④ 模块级数组钉住 brepjs 句柄，阻止 GC / FinalizationRegistry 兜底释放（§6.3 只钉不释）。
 * ⑤ 错误转译：`isErr(r)` → `throw new Error(code + ': ' + message)`，不静默。
 *
 * 时序（§6.4）：内核注入在模块加载期完成。测试宿主先建 runtime 并热身执行一次
 * （确保 `getBackends().kernel.brep` 非空），然后 `await import()` 本模块——与真实宿主
 * `await import(url)` 完全一致。工厂函数内的 `ensureKernelInjected()` 是同步一次守卫，
 * 只防御"模块被过早加载"的测试环境偏差，不含 per-function await。
 */

import {
  registerKernel,
  OcctWasmAdapter,
  makeExternalGear,
  makeInternalGear,
  makePlanetaryGear,
  thread as brepThread,
  isErr,
} from 'brepjs'
import {
  defineOp,
  fromHandle,
  getBackends,
  compound,
  CONTRACT_VERSION,
  type SolidShape,
  type CompoundShape,
} from '@faicad/faijs-core/sdk'

/** Adapter contract version for the registerLib compatibility check. */
export const contractVersion = CONTRACT_VERSION

// ── ① 内核注入（§6.4 / §6.1） ──

/** faijs occt-wasm 内核的最小结构化视图（OcctKernelOwner，参见 brepjs source）。 */
interface KernelOwner {
  getRawModule(): unknown
  getRawKernel(): unknown
}

function kernelOwnerOf(): KernelOwner | null {
  const k = getBackends().kernel.brep
  return (k as unknown as KernelOwner | null | undefined) ?? null
}

let registered = false
function ensureKernelInjected(): void {
  if (registered) return
  const k = kernelOwnerOf()
  if (!k || typeof k.getRawModule !== 'function' || typeof k.getRawKernel !== 'function') {
    throw new Error('[brepjs-gear] OCCT kernel not ready: import this module after the host kernel is initialized')
  }
  registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(k))
  registered = true
}

// ── ④ 所有权：模块级 pin（只钉不泄，§6.3） ──
// brepjs 的 ShapeHandle 带 Symbol.dispose / .delete()，且有 FinalizationRegistry 兜底
// （src/core/disposal.ts:41）。faijs 的 solidCache 长期持有 raw handle——若 brepjs
// 包装对象被 GC → arena 槽被释放 → faijs 句柄悬空（R2）。协议：模块级数组永久引用；
// faijs 侧独占释放（kernel.release）。中间结果由 brepjs DisposalScope 处理，adapter 不重复释放。
const pinned: unknown[] = []

/**
 * Test-observable hook: the number of brepjs handles currently pinned.
 * @returns the current length of the module-level pinned-handle array.
 */
export function pinnedCount(): number {
  return pinned.length
}

function pinBrepsHandle(brepShape: unknown): void {
  pinned.push(brepShape)
}

// ── ⑤ 错误转译：Result → throw（携带 code + message，不静默） ──

function convError(err: unknown): never {
  const e = (err ?? {}) as { code?: string; message?: string }
  throw new Error(`[brepjs-gear] ${e.code ?? 'err'}: ${String(e.message ?? err)}`)
}

// ── ③ wrapped → faijs Shape（登记 BREP 槽） ──

interface BrepShapeHandle {
  wrapped: unknown
}

/** occt-wasm 3.7.x：wrapped 是 { __occtWasm, type, id }——id 即 arena 句柄（number）；
 *  兼容 wrapped 直接是 number 的扁平形态。 */
function rawIdOf(brepShape: unknown): number {
  const wrapped = (brepShape as BrepShapeHandle).wrapped as { id?: number } | number | undefined
  const raw = typeof wrapped === 'number' ? wrapped : (wrapped as { id?: number } | undefined)?.id
  if (typeof raw !== 'number') {
    throw new Error('[brepjs-gear] unsupported brepjs handle shape: wrapped must carry a numeric arena id')
  }
  return raw
}

function shapeFromGear(brepShape: unknown): ReturnType<typeof fromHandle> {
  pinBrepsHandle(brepShape) // ④ 只钉住，杜绝 Finalizer 中途释放
  return fromHandle(rawIdOf(brepShape))
}

// ── 齿轮工厂（§6.5 契约：参数名沿用 brepjs 字段名，不加映射层） ──

/** Parameters for building an external or internal spur gear. */
export interface GearParams {
  teeth: number
  moduleSize: number
  thickness: number
  pressureAngleDeg?: number
  bore?: number
  shift?: number
  clearance?: number
}

/**
 * Build an external spur gear as a faijs SolidShape with a BREP slot.
 * @param params - the external-gear parameters.
 * @returns the gear as a faijs SolidShape.
 */
export const external = defineOp({
  brep: (params: GearParams): SolidShape => {
    ensureKernelInjected()
    const r = makeExternalGear(params)
    if (isErr(r)) convError(r.error)
    return shapeFromGear(r.value.solid)
  },
})

/**
 * Build an internal (ring) gear as a faijs SolidShape with a BREP slot.
 * @param params - the internal-gear parameters, including an optional ring wall thickness.
 * @returns the gear as a faijs SolidShape.
 */
export const internal = defineOp({
  brep: (params: GearParams & { ringWallThickness?: number }): SolidShape => {
    ensureKernelInjected()
    const r = makeInternalGear(params)
    if (isErr(r)) convError(r.error)
    return shapeFromGear(r.value.solid)
  },
})

/**
 * Build a planetary gear train (sun + planets + ring), each as a BREP solid,
 * combined into a single CompoundShape.
 * @param params - the planetary-gear parameters.
 * @returns the assembled gear train as a faijs CompoundShape.
 */
// planetary 是结构函数（返回 CompoundShape，几何由成员承载）——不在 defineOp
// 适用范围（§4.2：返回 SolidShape 的函数）；成员各自由 shapeFromGear 登记 BREP 槽。
export function planetary(params: {
  thickness: number
  moduleSize?: number
  sunTeeth?: number
  planetTeeth?: number
  numPlanets?: number
  pressureAngleDeg?: number
}): CompoundShape {
  ensureKernelInjected()
  const r = makePlanetaryGear(params)
  if (isErr(r)) convError(r.error)
  const { sun, planets, ring } = r.value
  return compound([shapeFromGear(sun), ...planets.map((p) => shapeFromGear(p)), shapeFromGear(ring)])
}

// ── C5（可复用的第二类形状生成器 ── 螺纹） ──
// §7.4 C5：同一套 adapter（注入 / 所有权 / 错误转译）对螺纹 op 同样成立。

/** Parameters describing an external thread profile. */
export interface ThreadParams {
  radius: number
  pitch: number
  height: number
  depth?: number
  toothHalfWidth?: number
  crest?: number
  sectionsPerTurn?: number
  lefthand?: boolean
  inward?: boolean
}

/**
 * Build an external thread as a faijs SolidShape with a BREP slot.
 * @param params - the thread profile parameters.
 * @returns the thread as a faijs SolidShape.
 */
export const thread = defineOp({
  brep: (params: ThreadParams): SolidShape => {
    ensureKernelInjected()
    const r = brepThread(params)
    if (isErr(r)) convError(r.error)
    // thread 的 Result.value 本身就是形状对象（带 wrapped），与 geol 的 { solid } 不同
    return shapeFromGear(r.value as unknown)
  },
})