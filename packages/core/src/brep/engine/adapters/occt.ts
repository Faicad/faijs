/**
 * engine/adapters/occt — OCCT BREP 引擎适配器（槽位 1 的默认实现）
 *
 *
 * 本文件是「occt 引擎实现」的注册入口：把 occt-kernel 的 initOcctWasm 包装为
 * BrepEngine 注册进注册表。业务层（runtime/brep ops/stdlib）只经注册表取引擎，
 * 不直接 import occt 初始化函数——引擎本体可整体替换（换一个适配器即换引擎）。
 *
 * OCCT 类型耦合（import 'occt-wasm'）只存在于 occt-kernel/occtKernel.ts（A1 验收
 * 允许的唯一耦合区）；本文件经 initOcctWasm 函数边界获得 BrepEngineApi，不直接
 * 接触 occt-wasm 类型。
 */

import { registerBrepEngine, hasBrepEngine, isBrepEngineRegistered, type BrepEngine } from '../registry'
import type { AssertSatisfiesBrepEngineApi, BrepEngineApi } from '../primitives'
import type { BrepEvolutionKind, BrepMethodKind } from '../types'
import type { BrepEvolutionData, BrepHandle, BrepSubShapeType, BrepVec3 } from '../types'
import { OcctWasmAdapter } from '../../../vendored/brepjs/kernel/occtWasm/occtWasmAdapter'
import { initOcctWasm } from '../../../occt-kernel/occtKernel'
import { injectCurrentBrepEngineAsKernel } from '../../../api/occt-kernel-bridge'

/** OCCT 引擎注册 id（默认 BREP 引擎；首个注册自动成为默认）。 */
export const OCCT_BREP_ENGINE_ID = 'occt'

// Phase 2 幂等护栏：occt-wasm 是进程级单例，registerOcctBrepEngine 可能被多次调用
// （测试重置注册表后重注册）。pattern 三方法只覆写一次——重复覆写会捕获到上一轮
// 覆写版（返回 BrepHandle[]），把它当 compound 拆 → getSubShapes: Invalid shape ID: 0。
let occtPatternWired = false

/**
 * OCCT 实际提供的 `*WithHistory` 核函数名（Phase 0.2：逐核函数如实声明）。
 *
 * 12 个全部由 `occt-wasm@3.8.4` 提供（`dist/index.d.ts` 的 `*WithHistory` 声明），
 * 且 faijs 侧已全部绑定（`brep/engine/primitives.ts` 的 `BrepEngineApi`）并有运行时
 * 冒烟测试（`brep/engine/evolution-bindings.test.ts`——因 `initOcctWasm` 的返回类型
 * 被 `as unknown as` 硬断言，编译期守卫是空转的，只有运行时测试能证明它们真在）。
 */
/**
 * 非演化内核方法全集（BrepMethodKind）——occt-wasm 是参考内核，vendored
 * occtWasmAdapter 提供全部方法（occt-kernel/initOcctWasm 包装同一实例），
 * 逐核如实声明（Phase 1，P2 缺口补齐）。
 *
 * ⚠️ Phase 2 修正（能力声明=可执行语义）：
 *   - 保留 `gridPattern`：occt-wasm 无原生 gridPattern，但 vendored gridPattern
 *     有回退路径（嵌套 linearPattern，patternFns.ts）且本适配器新增组合实现
 *     ——occt 下 gridPattern op 可执行，声明成立；
 *   - 移除 `rectangularPattern`：occt-wasm 无此内核方法，vendored rectangularPattern
 *     是纯 JS 组合（compoundOpsFns.ts translate+fuseAll，不调内核）——无 op 依赖
 *     该能力名，声明即虚假（capability-map 实证 36 op 无一依赖）。
 */
const OCCT_METHOD_KINDS = [
  'linearPattern',
  'circularPattern',
  'gridPattern',
  'mirror',
  'rotate',
  'translate',
  'scale',
  'makeRectangle',
  'shell',
  'extrude',
  'loft',
  'loftAdvanced',
  'section',
  'sweepPipeShell',
  'simplePipe',
  'revolveVec',
  'buildExtrusionLaw',
  'fuse',
  'cut',
  'intersect',
  'fuseAll',
  'makeArcEdge',
  'makeBezierEdge',
  'makeCylinder',
  'makeEllipsoid',
  'makeFace',
  'makeFaceOnSurface',
  'makeLineEdge',
  'makeTorus',
  'makeVertex',
  'makeWireFromMixed',
  'buildEdgeOnSurface',
  'addHolesInFace',
  'buildTriFace',
  'sew',
  'sewAndSolidify',
  'healFace',
  'healSolid',
  'healWire',
  'fixShape',
  'fixSelfIntersection',
  'isValid',
  'removeDegenerateEdges',
  'simplify',
  'split',
  'boundingBox',
  'curveParameters',
  'curvePointAtParam',
  'curveTangent',
  'hullFromPoints',
  'isNull',
  'iterShapes',
  'locate',
  'shapeType',
  'surfaceCenterOfMass',
  'surfaceNormal',
  'surfaceType',
  'uvBounds',
  'composeTransform',
  'applyComposedTransformWithHistory',
  'generalTransformNonOrthogonal',
  'generalTransformWithHistory',
  'importStl',
  'createXCAFDocument',
  'importXCAFFromSTEP',
  'copyShape',
  'dispose',
  'downcast',
  'hashCode',
  // Phase 2：chamfer/fillet 基础方法（directEdit 族逐核真名；occt-wasm 原生提供，
  // brepkit 无——chamfer op 静态判定执行前报错）
  'chamfer',
  'chamferDistAngle',
  'fillet',
  'filletVariable',
] as const satisfies readonly BrepMethodKind[]

const OCCT_EVOLUTION_KINDS = [
  'fuseWithHistory',
  'cutWithHistory',
  'intersectWithHistory',
  'filletWithHistory',
  'chamferWithHistory',
  'translateWithHistory',
  'rotateWithHistory',
  'mirrorWithHistory',
  'scaleWithHistory',
  'shellWithHistory',
  'offsetWithHistory',
  'thickenWithHistory',
] as const satisfies readonly BrepEvolutionKind[]

/**
 * 装配 OCCT BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 initOcctWasm()：wasm 加载完成后立即注册——保证注册返回后
 * getKernel() 立即可用（occt-kernel 单例已就绪），provider 直接返回预初始化实例。
 * 幂等：已注册（含运行时默认装配或宿主先行注册）则跳过注册，仅确保 wasm 预初始化。
 */
/** occt-wasm 运行时原始 pattern 形态（initOcctWasm 返回类型被硬断言，此处如实还原）。 */
interface OcctPatternRaw {
  // occt-wasm 原生签名（dist/index.d.ts:230-231 实证）：方向/中心/轴是 **Vec3 对象**
  // （{x,y,z}），4/5 参数形态。⚠️ vendored transformOps.ts 的分量式调用（6/9 参数）
  // 是 brepjs 内部 OcctKernelWasm 的假定面，对真实 occt-wasm 不成立（运行实证崩），
  // Phase 3 全量收敛时单独处置。
  linearPattern(shape: number, direction: { x: number; y: number; z: number }, spacing: number, count: number): number
  circularPattern(shape: number, center: { x: number; y: number; z: number }, axis: { x: number; y: number; z: number }, angleStep: number, count: number): number
  getSubShapes(shape: number, type: 'solid'): number[]
  release(shape: number): void
  fuseAll(shapes: number[]): number
}

/**
 * 装配 OCCT BREP 引擎（幂等；pattern 三方法仅首次覆写，见上方长注释）。
 */
export async function registerOcctBrepEngine(): Promise<void> {
  const primitives = await initOcctWasm()
  if (isBrepEngineRegistered(OCCT_BREP_ENGINE_ID)) return
  // Phase 2：occt-wasm 原生 linearPattern/circularPattern 返回 compound（含全部副本），
  // BrepEngineApi 契约要求 BrepHandle[]（各份副本）→ 在此拆 compound（getSubShapes）。
  // gridPattern 无原生内核函数 → 组合实现（嵌套 linearPattern + fuseAll，与 vendored
  // 回退路径同构）；拆出的子句柄由调用方 release，compound 容器拆完即释放。
  // ⚠️ initOcctWasm 的返回类型在 occtKernel.ts 被硬断言为 BrepEngineApi（linearPattern
  // 签名 BrepHandle[]），但运行时 occt-wasm 的 linearPattern/circularPattern 返回**单个
  // compound 句柄**（含全部副本）——类型撒谎。此处以运行时原始形态（OcctPatternRaw）
  // 调用，再经 getSubShapes 拆成数组（与 vendored transformOps.linearPattern 同构）。
  // 不能使用对象展开（{ ...primitives }）：OcctKernel 的方法在原型上（class 实例），
  // 展开只拷自有属性 → makeBoxFromCorners 等全部原型方法丢失（consume-input.test 实证）。
  // 直接覆盖单例实例的 pattern 三方法（occt-wasm 单例，无共享状态风险）。
  // ⚠️ 覆盖前必须先捕获原生 linearPattern/circularPattern：覆盖后 raw.linearPattern
  // 会指向 occtApi.linearPattern 自身 → 无限递归（Maximum call stack size exceeded 实证）。
  const raw = primitives as unknown as OcctPatternRaw
  // ⚠️ 幂等护栏：occt-wasm 是进程级单例，宿主可能多次调用本注册（测试重置注册表后
  // 重注册）。重复覆写会捕获到上一轮覆写版（返回 BrepHandle[]），把它当 compound 拆
  // → `getSubShapes: Invalid shape ID: 0`（engine-switch-p2 parity 实证）。只覆写一次，
  // raw 与 occtApi 指向同一单例，后续注册直接复用覆写结果。
  if (!occtPatternWired) {
    // ⚠️ 覆盖前必须先捕获原生 linearPattern/circularPattern：覆盖后 raw.linearPattern
    // 会指向 occtApi.linearPattern 自身 → 无限递归（Maximum call stack size exceeded 实证）。
    const nativeLinearPattern = raw.linearPattern.bind(raw)
    const nativeCircularPattern = raw.circularPattern.bind(raw)
    const occtApi = primitives as BrepEngineApi
    occtApi.linearPattern = (shape, direction, spacing, count) => {
      const compound = nativeLinearPattern(shape, direction, spacing, count)
      const parts = raw.getSubShapes(compound, 'solid')
      raw.release(compound)
      return parts.map((h) => h as BrepHandle)
    }
    occtApi.circularPattern = (shape, center, axis, angleStep, count) => {
      const compound = nativeCircularPattern(shape, center, axis, angleStep, count)
      const parts = raw.getSubShapes(compound, 'solid')
      raw.release(compound)
      return parts.map((h) => h as BrepHandle)
    }
    occtApi.gridPattern = (shape, directionX, directionY, spacingX, spacingY, countX, countY) => {
      // ⚠️ 内部必须用捕获的 nativeLinearPattern：此时 raw.linearPattern 已被覆写为
      // BrepHandle[] 语义，误用会把数组当 compound 拆（同上红线实证）。
      const colCompound = nativeLinearPattern(shape, directionX, spacingX, countX)
      const cols = raw.getSubShapes(colCompound, 'solid')
      raw.release(colCompound)
      const all: number[] = []
      try {
        for (const c of cols) {
          const rowCompound = nativeLinearPattern(c, directionY, spacingY, countY)
          try {
            all.push(...raw.getSubShapes(rowCompound, 'solid'))
          } finally {
            raw.release(rowCompound)
          }
        }
      } finally {
        for (const c of cols) raw.release(c)
      }
      return raw.fuseAll(all) as BrepHandle
    }

    // ═══ Phase 3：能力表 33 个登记方法接线（capability-map 64 方法收口） ═══
    // 原则：能力表声明了（OCCT_METHOD_KINDS 含全部 33）→ 实例必须可实现，否则静态
    // 判定放行后运行时崩（红线）。18 个 occt-wasm 原生导出直接绑定（签名与
    // BrepEngineApi 一致：Vec3=BrepVec3、ShapeHandle=BrepHandle）；15 个组合方法
    // （occt-wasm 无原生导出）经 vendored OcctWasmAdapter 组合面代理 + 形态转换。
    // 只接线一次（occtPatternWired 护栏内）；重复注册复用覆写结果，不重复捕获。
    const k = primitives as unknown as {
      buildExtrusionLaw(profile: string, length: number, endFactor: number): BrepHandle
      composeTransform(m1: number[], m2: number[]): number[]
      downcast(shape: BrepHandle, targetType: BrepSubShapeType): BrepHandle
      healFace(shape: BrepHandle, tolerance?: number): BrepHandle
      healWire(shape: BrepHandle, tolerance?: number): BrepHandle
      isNull(shape: BrepHandle): boolean
      iterShapes(shape: BrepHandle): BrepHandle[]
      makeEllipsoid(rx: number, ry: number, rz: number): BrepHandle
      makeFaceOnSurface(face: BrepHandle, wire: BrepHandle): BrepHandle
      makeTorus(majorRadius: number, minorRadius: number): BrepHandle
      makeVertex(x: number, y: number, z: number): BrepHandle
      mirror(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle
      sew(shapes: BrepHandle[], tolerance?: number): BrepHandle
      shell(solid: BrepHandle, facesToRemove: BrepHandle[], thickness: number, tolerance: number): BrepHandle
      simplePipe(profile: BrepHandle, spine: BrepHandle): BrepHandle
      simplify(shape: BrepHandle): BrepHandle
      split(shape: BrepHandle, tools: BrepHandle[]): BrepHandle
      sweepPipeShell(profile: BrepHandle, spine: BrepHandle, freenet?: boolean, smooth?: boolean): BrepHandle
    }
    occtApi.buildExtrusionLaw = k.buildExtrusionLaw.bind(primitives)
    occtApi.composeTransform = k.composeTransform.bind(primitives)
    occtApi.downcast = k.downcast.bind(primitives)
    occtApi.healFace = k.healFace.bind(primitives)
    occtApi.healWire = k.healWire.bind(primitives)
    occtApi.isNull = k.isNull.bind(primitives)
    occtApi.iterShapes = k.iterShapes.bind(primitives)
    occtApi.makeEllipsoid = k.makeEllipsoid.bind(primitives)
    occtApi.makeFaceOnSurface = k.makeFaceOnSurface.bind(primitives)
    occtApi.makeTorus = k.makeTorus.bind(primitives)
    occtApi.makeVertex = k.makeVertex.bind(primitives)
    occtApi.mirror = k.mirror.bind(primitives)
    occtApi.sew = k.sew.bind(primitives)
    occtApi.shell = k.shell.bind(primitives)
    occtApi.simplePipe = k.simplePipe.bind(primitives)
    occtApi.simplify = k.simplify.bind(primitives)
    occtApi.split = k.split.bind(primitives)
    occtApi.sweepPipeShell = k.sweepPipeShell.bind(primitives)
    const vendor = OcctWasmAdapter.fromKernel(primitives as never)
    occtApi.boundingBox = (shape) => {
      const b = vendor.boundingBox(shape as never)
      return { xmin: b.min[0], ymin: b.min[1], zmin: b.min[2], xmax: b.max[0], ymax: b.max[1], zmax: b.max[2] }
    }
    occtApi.shapeType = (shape) => vendor.shapeType(shape as never) as BrepSubShapeType
    occtApi.surfaceCenterOfMass = (face) => {
      const v = vendor.surfaceCenterOfMass(face as never)
      return { x: v[0], y: v[1], z: v[2] }
    }
    occtApi.locate = (shape, matrix) => vendor.locate(shape as never, matrix as never) as BrepHandle
    occtApi.copyShape = (shape) => vendor.copyShape(shape as never) as BrepHandle
    occtApi.fixSelfIntersection = (wire) => vendor.fixSelfIntersection(wire as never) as BrepHandle
    occtApi.hullFromPoints = (points, tolerance) => vendor.hullFromPoints(points as never, tolerance) as BrepHandle
    occtApi.loftAdvanced = (wires, options) => vendor.loftAdvanced(wires as never, options as never) as BrepHandle
    occtApi.makeWireFromMixed = (items) => vendor.makeWireFromMixed(items as never) as BrepHandle
    occtApi.revolveVec = (shape, center, direction, angleDeg) =>
      vendor.revolveVec(shape as never, [center.x, center.y, center.z] as never, [direction.x, direction.y, direction.z] as never, angleDeg) as BrepHandle
    occtApi.buildEdgeOnSurface = (curve, surface) => vendor.buildEdgeOnSurface(curve as never, surface as never) as BrepHandle
    occtApi.dispose = (shape) => { if (shape !== undefined) raw.release(shape as number) }
    occtApi.generalTransformNonOrthogonal = (shape, matrix) =>
      vendor.generalTransformNonOrthogonal(shape as never, matrix.slice(0, 9) as never, matrix.slice(9, 12) as never) as BrepHandle
    const toEvolution = (op: {
      shape: number
      evolution: {
        modified: ReadonlyMap<number, readonly number[]>
        generated: ReadonlyMap<number, readonly number[]>
        deleted: ReadonlySet<number>
      }
    }): BrepEvolutionData => {
      const segments = (m: ReadonlyMap<number, readonly number[]>): number[] => {
        const out: number[] = []
        for (const [inHash, outHashes] of m) out.push(inHash, outHashes.length, ...outHashes)
        return out
      }
      return { result: op.shape as BrepHandle, modified: segments(op.evolution.modified), generated: segments(op.evolution.generated), deleted: [...op.evolution.deleted] }
    }
    occtApi.generalTransformWithHistory = (shape, matrix, inputFaceHashes, hashUpperBound) =>
      toEvolution(vendor.generalTransformWithHistory(
        shape as never,
        matrix.slice(0, 9) as never,
        matrix.slice(9, 12) as never,
        false,
        inputFaceHashes as never,
        hashUpperBound,
      ) as never)
    occtApi.applyComposedTransformWithHistory = (shape, matrix, inputFaceHashes, hashUpperBound) =>
      toEvolution(vendor.applyComposedTransformWithHistory(
        shape as never,
        matrix as never,
        inputFaceHashes as never,
        hashUpperBound,
      ) as never)
    occtPatternWired = true
  }
  const occtApi = primitives as BrepEngineApi
  registerBrepEngine(OCCT_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: OCCT_BREP_ENGINE_ID,
    primitives: occtApi,
    capabilities: {
      // 面演化：逐核函数名单（不是族级布尔——见 BrepEvolutionKind）。
      evolution: OCCT_EVOLUTION_KINDS,
      // 非演化内核方法：逐核如实声明（Phase 1，P2 缺口补齐；op 声明按此静态判定）。
      methods: OCCT_METHOD_KINDS,
      heal: true,
      directEdit: true,
      advSurface: true,
      assembly: true,
      // P7 并入（D4）：OCCT 是精确 B-rep 内核——如实声明 brepjs KernelCapabilities 字段。
      exact: true,
      brepExport: true,
      exactMeasurement: true,
      tessellationModel: 'extract-time',
    },
  }))
  // P7-②：同一装配点把移植内核注册表注入到当前 BREP 引擎（Phase 2 P2-5：取代旧的
  // bindOcctKernel() 固定绑定，改为引擎中立的 injectCurrentBrepEngineAsKernel）。
  // 使 L3 调移植 L2 的 op 在宿主装配后立即可用；幂等，重复调用安全。
  await injectCurrentBrepEngineAsKernel()
}

/**
 * 内置默认 BREP 引擎装配（OCCT）：宿主未注册任何引擎时的缺省值。
 *
 * OCCT 是 faijs 的默认 BREP 引擎——低频率、静态的替换：换引擎 = 宿主在
 * 装配期显式注册其它引擎（首个注册者为默认），或改本处默认。宿主无需为
 * 每次使用自行提供引擎；本函数幂等，已注册任何引擎则 no-op。
 */
export async function ensureOcctDefaultEngine(): Promise<void> {
  if (hasBrepEngine()) return
  await registerOcctBrepEngine()
}

// §7.8 编译期守卫：initOcctWasm 的返回类型必须满足 BrepEngineApi。
// 若未来 occt-kernel 的导出类型不再满足接口（如接口新增方法）→ tsc 报错列出缺失。
type _AssertOcctApi = AssertSatisfiesBrepEngineApi<Awaited<ReturnType<typeof initOcctWasm>>>
