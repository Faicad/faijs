/**
 * L3 bridge — vendored kernel registry injection (engine-neutral, Phase 2 P2-5).
 *
 * 原 occt-kernel-bridge 的职责是「把 vendored kernel registry 冻结绑定到 occt-wasm
 * 单实例」（D10）。Phase 2 起改为**跟随当前 BREP 引擎**：装配期把 registry 里当前
 * 引擎（occt / brepkit / mock）的 `BrepEngineApi` 适配器包装为 brepjs `KernelAdapter`
 * 形态注册进 vendored registry，使 `vendoredRegistry.getKernel()` 返回当前引擎——
 * vendored 函数全部逻辑（命名/角色表/Result）原样保留、零改动。
 *
 * 边界规则（D8/R5）不变：本文件是 faijs 侧唯一把 vendored kernel registry 与
 * faijs 引擎接线的地方；core 侧只从 `api/` import vendored 树。
 *
 * 装配期完整性检查（方案 §Phase 2.5）：KernelAdapter 是 211 方法大接口，但 vendored
 * 面存在大量**辅助构造方法**（createVector3d / createPoint3d / createDirection3d /
 * createAxis1 / createAxis2 / createAxis3，见 vendored core/kernelBoundary.ts）——
 * 它们不落在能力名体系内（BrepMethodKind 之外）、无法由 op 声明覆盖，任何 compat
 * op / TS compat 面都可能触发。⇒ 注入前必须断言这些胶水方法在适配器上齐备，缺失
 * 则在**装配期**报错（而非执行期崩）。清单见 {@link GLUE_METHODS}。
 */

import { getKernel as getFaijsKernel } from '../occt-kernel/occtKernel'
import type { OcctKernelOwner } from '../vendored/brepjs/kernel/occtWasm/occtWasmAdapter.js'
import { getBrepEngine, type BrepEngine } from '../brep/engine/registry'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { OcctWasmAdapter } from '../vendored/brepjs/kernel/occtWasm/occtWasmAdapter.js'
import {
  freezeKernels,
  getActiveKernelId,
  getKernel as getVendoredKernel,
  registerKernel,
  syncRegistryFromGlobal,
  syncRegistryToGlobal,
  __resetKernelRegistryForTests,
} from '../vendored/brepjs/kernel/index.js'
import type { KernelAdapter } from '../vendored/brepjs/kernel/types.js'

/** occt-wasm 适配器在 vendored registry 中的注册 id。这是 vendored 注册表的
 * 槽位名（宿主侧判据 + D10 globalThis 单例兼容），**不是**引擎身份标识——
 * 实际引擎由注入的 adapter 决定（vendored 面全部无参 `getKernel()` 取默认）。 */
export const VENDORED_OCCT_KERNEL_ID = 'occt-wasm'

/**
 * 装配期完整性检查清单——vendored 面辅助构造/生命周期胶水方法。
 *
 * 这些方法不在 `BrepMethodKind` 能力名体系内（能力判定无法覆盖），但 vendored 面
 * 大量使用（kernelBoundary.ts / wrapperFns / castShape 等）。当前引擎的
 * KernelAdapter 包装必须全部具备，否则对应 compat op / TS compat 面会在执行期崩。
 *
 * Phase 0 盘点实证：36 个 compat op 的 vendored 函数（capability-map 64 方法）与
 * kernelBoundary 都不需要 createAxis*（2D sketcher / TS compat 面需要）——清单按
 * 「vendored 面实际触发面」保守枚举，缺即装配期报错。
 */
const GLUE_METHODS = [
  'createVector3d',
  'createPoint3d',
  'createDirection3d',
  'createAxis1',
  'createAxis2',
  'createAxis3',
] as const

let _injected = false

/**
 * Inject the currently-registered BREP engine into the vendored kernel registry
 * (replaces the old occt-only `bindOcctKernel()` fixed binding, Phase 2 P2-5).
 *
 * 装配期调用（在 `registerOcctBrepEngine()` / 其它引擎注册之后）。从引擎注册表取
 * 当前默认 BREP 引擎，按其 id 构造 KernelAdapter 形态注册进 vendored registry：
 *
 * - occt：`OcctWasmAdapter.fromKernel(当前引擎 primitives)`——同一 occt-wasm 单实例
 *   （D10 不变），211 方法完整适配器，vendored 函数行为与旧 bindOcctKernel 完全一致；
 * - 其它引擎（brepkit/mock）：将 BrepEngineApi 透传包装为 KernelAdapter 形态
 *   （`dispose`→`release` 等方法名映射 + pattern 返回形态适配），**不做方法伪造**；
 * - 任一引擎注入前都做**装配期完整性检查**（GLUE_METHODS 齐备断言）。
 *
 * 幂等：首次调用后注册并冻结；重复调用返回已注入的适配器。
 *
 * @returns 注册进 vendored registry 的 kernel adapter。
 * @throws 无 BREP 引擎注册；或完整性检查失败（胶水方法缺失）——装配期报错。
 */
export async function injectCurrentBrepEngineAsKernel(): Promise<KernelAdapter> {
  // CDN 宿主跨实例同步：host bundle 已注入则直接复用（同旧 bindOcctKernel 语义）。
  // 短路判据与 isKernelInjected() 一致（含 registry 侧激活 id 分支），避免
  // 「registry 已注入但模块级 _injected=false」时走完整路径撞 frozen 抛错。
  syncRegistryFromGlobal()
  if (isKernelInjected()) return getVendoredKernel()

  const engine = await getBrepEngine()
  const adapter = buildKernelAdapter(engine)
  assertGlueMethodsComplete(engine.id, adapter)

  registerKernel(VENDORED_OCCT_KERNEL_ID, adapter)
  freezeKernels()
  _injected = true
  syncRegistryToGlobal()
  return adapter
}

/**
 * 按引擎 id 构造 KernelAdapter 形态（occt 走完整适配器；其它引擎透传包装）。
 *
 * occt 分支保持旧 bindOcctKernel 行为：OcctWasmAdapter.fromKernel 需要 occt-wasm
 * 实例（OcctKernelOwner）。当前引擎的 primitives 即 initOcctWasm 单例（occtApi 是
 * 同一实例的实例覆盖，方法面完整），转换安全。
 *
 * 其它引擎分支：BrepEngineApi → KernelAdapter 契约面——
 *   - `dispose` → `release`（vendored 面用 dispose，BrepEngineApi 用 release）；
 *   - `linearPattern` / `circularPattern` 的方向/中心/轴参数是 Vec3 对象（BrepEngineApi
 *     口径），vendored 面传 [x,y,z] 三元组——包装为对象再转发；
 *   - 返回 BrepHandle[]（BrepEngineApi）→ KernelShape[]（vendored castResultShape 消费
 *     `.wrapped` + `.type`）——包装为 `{ wrapped, type: 'solid' }`；
 *   - `gridPattern` 返回单 BrepHandle → 单 KernelShape（compound 语义一致）。
 * 不声明 `rectangularPattern`（纯 JS 组合，不调内核——capability-map 实证）。
 *
 * ⚠️ 不伪造：BrepEngineApi 未提供的方法**不**补桩；vendored 函数若触发，由
 * compat op 的静态能力判定（backend-dispatch，Phase 1）在执行前拦截。
 *
 * @param engine - 当前 BREP 引擎（装配期从引擎注册表取得）。
 * @returns 该引擎的 vendored KernelAdapter（occt → OcctWasmAdapter.fromKernel；
 *   其它引擎 → BrepEngineApi 透传包装，pattern 族 Vec3↔三元组适配）。
 */
export function buildKernelAdapter(engine: BrepEngine): KernelAdapter {
  if (engine.id === 'occt') {
    const faijsKernel = engine.primitives as unknown as OcctKernelOwner
    return OcctWasmAdapter.fromKernel(faijsKernel)
  }
  return wrapBrepEngineApi(engine.primitives)
}

/** No-op `delete` for synthesized glue objects (mirrors vendored `noop`). */
const noop = (): void => {}

/**
 * vendored kernel methods with no source capability in BrepEngineApi.
 * Registered explicitly (not silently undefined): tests assert this list and
 * the engine-contract gap is a separate decision, not a wrapping bug. No
 * stubs, no fake zeros — a silent 0 is worse than a crash.
 */
export const UNMAPPED_VENDORED_MEASURE_METHODS = [
  'area',
  'length',
  'linearCenterOfMass',
] as const

/** Unwrap a vendored KernelShape (handle view or bare number) to a BrepHandle. */
function unwrapHandle(h: unknown): unknown {
  if (typeof h === 'number') return h
  const view = h as { id?: unknown }
  return typeof view.id === 'number' ? view.id : h
}

/**
 * Map vendored measure method names/shapes onto BrepEngineApi capabilities.
 * The vendored measure face calls `kernel.volume/area/length/centerOfMass/...`
 * (its own naming); the occt adapter carries an internal mapping layer — this
 * is the engine-neutral equivalent for any wrapped BrepEngineApi. Only real
 * BrepEngineApi capabilities are mapped; the rest stay in the gap registry.
 */
function mapMeasureMethods(adapter: Record<string, unknown>, api: BrepEngineApi): void {
  adapter['volume'] = (s: unknown) => api.getVolume(unwrapHandle(s) as never)
  adapter['centerOfMass'] = (s: unknown): [number, number, number] => {
    const v = api.getCenterOfMass(unwrapHandle(s) as never)
    return [v.x, v.y, v.z]
  }
  adapter['boundingBox'] = (s: unknown) => {
    const bb = api.getBoundingBox(unwrapHandle(s) as never, true)
    return {
      min: [bb.xmin, bb.ymin, bb.zmin],
      max: [bb.xmax, bb.ymax, bb.zmax],
    }
  }
  // shapeType / isNull: same name, same semantics — already covered by the
  // transparent pass-through in wrapBrepEngineApi; listed here for docs only.
  // Known contract gaps (UNMAPPED_VENDORED_MEASURE_METHODS) are NOT stubbed:
  // they remain undefined so tests can pin the gap explicitly.
}

/**
 * Synthesize the vendored glue/auxiliary construction methods over any engine's
 * primitives. These 6 methods are pure JS data-literal constructors in the
 * vendored surface (zero kernel calls — see vendored constructionOps.ts), i.e.
 * a *calling convention*, not a kernel capability — so they are synthesized at
 * the faijs wrapper layer (engine-neutral) rather than added to BrepEngineApi.
 * Field shapes are copied verbatim from the vendored occt adapter; `delete` is
 * mandatory (kernelBoundary's with* helpers call it in `finally`).
 */
function synthesizeGlueMethods(adapter: Record<string, unknown>): void {
  const pnt = (x: number, y: number, z: number, __type: string) => ({ x, y, z, __type, delete: noop })
  adapter['createPoint3d'] = (x: number, y: number, z: number) => pnt(x, y, z, 'point3d')
  adapter['createDirection3d'] = (x: number, y: number, z: number) => pnt(x, y, z, 'direction3d')
  adapter['createVector3d'] = (x: number, y: number, z: number) => pnt(x, y, z, 'vector3d')
  adapter['createAxis1'] = (cx: number, cy: number, cz: number, dx: number, dy: number, dz: number) => ({
    origin: { x: cx, y: cy, z: cz },
    direction: { x: dx, y: dy, z: dz },
    __type: 'axis1',
    delete: noop,
  })
  // axis2/axis3: 6- or 9-arg forms (origin + zDir + optional xDir).
  const makeAxis = (__type: 'axis2' | 'axis3') =>
    (ox: number, oy: number, oz: number, zx: number, zy: number, zz: number, xx?: number, xy?: number, xz?: number) => ({
      origin: { x: ox, y: oy, z: oz },
      zDir: { x: zx, y: zy, z: zz },
      xDir: xx !== undefined ? { x: xx, y: xy as number, z: xz as number } : undefined,
      __type,
      delete: noop,
    })
  adapter['createAxis2'] = makeAxis('axis2')
  adapter['createAxis3'] = makeAxis('axis3')
}

/** 把 BrepEngineApi 透传包装为 KernelAdapter 形态（非 occt 引擎）。 */
function wrapBrepEngineApi(api: BrepEngineApi): KernelAdapter {
  const adapter: Record<string, unknown> = {
    // 生命周期：vendored 面统一用 dispose（BrepEngineApi 用 release）。
    dispose: (h: unknown) => api.release(h as never),
  }
  synthesizeGlueMethods(adapter)
  for (const key of Object.keys(api)) {
    if (key === 'release') continue // 上面已映射为 dispose
    adapter[key] = (api as unknown as Record<string, unknown>)[key]
  }
  // 测量面映射在透传之后追加，覆盖同名键（vendored 名 → BrepEngineApi 名 + 形态转换）。
  mapMeasureMethods(adapter, api)
  // pattern 族形态适配（BrepEngineApi 对象 Vec3 ↔ vendored 三元组）。
  adapter['linearPattern'] = (
    shape: unknown,
    direction: [number, number, number],
    spacing: number,
    count: number,
  ) =>
    api.linearPattern(
      shape as never,
      { x: direction[0], y: direction[1], z: direction[2] },
      spacing,
      count,
    ).map((h) => ({ wrapped: h, type: 'solid' }))
  adapter['circularPattern'] = (
    shape: unknown,
    center: [number, number, number],
    axis: [number, number, number],
    angleStep: number,
    count: number,
  ) =>
    api.circularPattern(
      shape as never,
      { x: center[0], y: center[1], z: center[2] },
      { x: axis[0], y: axis[1], z: axis[2] },
      angleStep,
      count,
    ).map((h) => ({ wrapped: h, type: 'solid' }))
  adapter['gridPattern'] = (
    shape: unknown,
    directionX: [number, number, number],
    directionY: [number, number, number],
    spacingX: number,
    spacingY: number,
    countX: number,
    countY: number,
  ) => ({
    wrapped: api.gridPattern(
      shape as never,
      { x: directionX[0], y: directionX[1], z: directionX[2] },
      { x: directionY[0], y: directionY[1], z: directionY[2] },
      spacingX,
      spacingY,
      countX,
      countY,
    ),
    type: 'compound',
  })
  return adapter as unknown as KernelAdapter
}

/**
 * 装配期完整性检查：KernelAdapter 胶水方法齐备断言。
 *
 * @param id - 引擎注册 id（报错时定位到引擎）。
 * @param adapter - 待注入 vendored registry 的 KernelAdapter。
 * @throws 缺失任一胶水方法 → 装配期报错（列出引擎 id 与缺失方法名）。
 */
export function assertGlueMethodsComplete(id: string, adapter: KernelAdapter): void {
  const missing = GLUE_METHODS.filter((m) => typeof (adapter as unknown as Record<string, unknown>)[m] !== 'function')
  if (missing.length > 0) {
    throw new Error(
      `[faijs] BREP engine '${id}' cannot back the vendored compat surface: KernelAdapter ` +
        `missing glue method(s): ${missing.join(', ')}. These auxiliary construction methods ` +
        `(createVector3d / createPoint3d / createDirection3d / createAxis1/2/3) are required by ` +
        `the vendored kernel boundary and cannot be covered by capability declarations. ` +
        `Fix the adapter (add real implementations) or do not inject this engine into the vendored registry.`
    )
  }
}

/**
 * Test-only: clear the injection cache and reset the vendored kernel registry
 * so a re-assembly (e.g. switching engines in tests) re-runs buildKernelAdapter
 * + assertGlueMethodsComplete for the new engine. Never called in prod.
 */
export function __resetKernelInjectionForTests(): void {
  _injected = false
  __resetKernelRegistryForTests()
}

/**
 * Whether the vendored kernel registry has been injected (engine-neutral D10).
 *
 * 取代旧的 `isOcctKernelBound()`（其判据 `_bound && getActiveKernelId() === 'occt-wasm'`
 * 把注入面写死为 occt）。新判据只问「vendored registry 是否已注入当前引擎」——
 * 不关心引擎 id，装配期换引擎（brepkit/mock）同样成立。
 *
 * @returns 注入是否已完成（vendored registry 已装配当前 BREP 引擎）。
 */
export function isKernelInjected(): boolean {
  syncRegistryFromGlobal()
  return _injected || getActiveKernelId() !== null
}

/**
 * Access the currently injected vendored kernel adapter (reads the registry).
 * @throws If the bridge has not been injected.
 * @returns the vendored kernel adapter for the current BREP engine.
 */
export function getBrepjsKernel(): KernelAdapter {
  return getVendoredKernel()
}

/**
 * 固定绑定 occt 内核到 vendored registry（Phase 2 前的装配方式）。
 *
 * @deprecated Phase 2 P2-5：固定绑定已被引擎中立的 injectCurrentBrepEngineAsKernel
 * 取代。保留导出仅为兼容旧调用点（适配器层迁移期）；新代码一律用注入函数。
 * @returns 恒抛错——本函数已移除，仅保留签名占位。
 */
export function bindOcctKernel(): KernelAdapter {
  void getFaijsKernel
  throw new Error(
    '[faijs] bindOcctKernel() removed (Phase 2 P2-5): use injectCurrentBrepEngineAsKernel() ' +
      'during host assembly to inject the current BREP engine into the vendored registry.'
  )
}

/**
 * 旧 occt 专用注入判据（Phase 2 前语义：绑定且激活内核为 occt-wasm）。
 *
 * @deprecated Phase 2 P2-5：occt 专用判据已被引擎中立的 isKernelInjected() 取代。
 * @returns 当前是否已注入（透传 isKernelInjected()）。
 */
export function isOcctKernelBound(): boolean {
  return isKernelInjected()
}
