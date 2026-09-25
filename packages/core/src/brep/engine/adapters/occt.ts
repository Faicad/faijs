/**
 * engine/adapters/occt — OCCT BREP 引擎适配器（槽位 1 的默认实现）
 *
 * 本文件是「occt 引擎实现」的注册入口：把 `createOcctPrimitives()`（occt-kernel/
 * occt-primitives.ts，L1 契约 `BrepEngineApi` 的 occt 显式实现）注册进引擎注册表。
 * 业务层（runtime/brep ops/stdlib）只经注册表取引擎，不直接 import occt 初始化
 * 函数——引擎本体可整体替换（换一个适配器即换引擎）。
 *
 * Phase 3（docs/plans/2026-09-24-brep-engine-api-narrowing-native-access.md）：
 * 本文件不再做任何猴子补丁（旧版在 occt-wasm 单例上覆写 pattern 三方法与 33 个
 * 登记方法——全部移入 `createOcctPrimitives` 的显式对象字面量）。occt-wasm 类型
 * 耦合只存在于 occt-kernel/（A1 允许的唯一耦合区）；本文件不接触 occt-wasm 类型。
 *
 * 平台独有能力（loft 族、工具实体 section/split、L1 三员之外的 *WithHistory、
 * XCAF 等）不在 L1 契约里——平台代码经原生面 `getOcctKernel()`（D3）访问。
 */

import { registerBrepEngine, hasBrepEngine, isBrepEngineRegistered, type BrepEngine } from '../registry'
import type { BrepEvolutionKind, BrepMethodKind } from '../types'
import { createOcctPrimitives } from '../../../occt-kernel/occt-primitives'

/** OCCT 引擎注册 id（默认 BREP 引擎；首个注册自动成为默认）。 */
export const OCCT_BREP_ENGINE_ID = 'occt'

/**
 * OCCT 实际提供的 `*WithHistory` 核函数名（Phase 0.2：逐核函数如实声明）。
 *
 * 12 个全部由 `occt-wasm@3.8.4` 提供（`dist/index.d.ts` 的 `*WithHistory` 声明）。
 * L1 契约只含前三员 + filletWithHistory（双方都有对齐实现）；其余 8 个是 occt
 * 平台面能力（brepkit 无对应 API），存在性由本能力表如实声明，op 侧用
 * `engines: ['occt']`（Phase 5 D11）表达平台归属。
 */
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
 * 非演化内核方法全集（BrepMethodKind）——逐核如实声明（Phase 1，P2 缺口补齐）。
 *
 * ⚠️ Phase 2 修正（能力声明=可执行语义）：
 *   - 保留 `gridPattern`：occt-wasm 无原生 gridPattern，但适配器有组合实现
 *     （嵌套 linearPattern + fuseAll，见 occt-primitives.ts）——occt 下
 *     gridPattern op 可执行，声明成立；
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
  // Phase 5（D5）：测量族能力名统一为 L1 中立名（getBoundingBox/getVolume/...）——
  // vendored 面按 brepjs 自身命名（volume/area/length），core 能力表用 L1 中立名。
  'getBoundingBox',
  'getVolume',
  'getSurfaceArea',
  'getLength',
  'getCenterOfMass',
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
  // chamfer/fillet 基础方法（directEdit 族逐核真名；occt-wasm 原生提供）
  'chamfer',
  'chamferDistAngle',
  'fillet',
  'filletVariable',
] as const satisfies readonly BrepMethodKind[]

/**
 * 装配 OCCT BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 `createOcctPrimitives()`（内部 await initOcctWasm）：wasm 加载完成后
 * 立即注册——保证注册返回后内核单例已就绪。幂等：已注册（含运行时默认装配或
 * 宿主先行注册）则跳过注册，仅确保 wasm 预初始化。
 */
export async function registerOcctBrepEngine(): Promise<void> {
  const primitives = await createOcctPrimitives()
  if (isBrepEngineRegistered(OCCT_BREP_ENGINE_ID)) return
  registerBrepEngine(OCCT_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: OCCT_BREP_ENGINE_ID,
    primitives,
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
  // 2026-09-25 core-decouple Phase 2（§5.1）：删除 occt-kernel-bridge 后，本注册
  // 流程只管 core 引擎注册表，不再向 vendored kernel registry 注入——vendored
  // 兼容面（compat op）由 Phase 3 逐批自有化替换；中间态下需要 vendored 面的
  // 宿主/测试自行装配 vendored registry。
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
