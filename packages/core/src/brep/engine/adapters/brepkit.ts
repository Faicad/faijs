/**
 * engine/adapters/brepkit — brepkit BREP 引擎适配器（对照 adapters/occt.ts 形态）
 *
 * 把 createBrepkitPrimitives 包装为 BrepEngine 注册进注册表。业务层只经注册表取
 * 引擎，不直接 import brepkit 初始化函数——引擎本体可整体替换（换适配器即换引擎）。
 *
 * 小程序装配顺序（§6.1）：Worker 启动时先 setBrepkitWasmInitFn + 本函数注册，
 * ensureOcctDefaultEngine 的动态 import('occt-wasm') 永不触发。
 */

import { registerBrepEngine, isBrepEngineRegistered, hasBrepEngine, type BrepEngine } from '../registry'
import type { AssertSatisfiesBrepEngineApi } from '../primitives'
import { createBrepkitPrimitives, type BrepkitPrimitives } from '../../../brepkit-kernel/brepkitKernel'

/** brepkit 引擎注册 id。 */
export const BREPKIT_BREP_ENGINE_ID = 'brepkit'

/**
 * 装配 brepkit BREP 引擎（宿主启动时调用一次，幂等）。
 *
 * 预初始化 createBrepkitPrimitives()：wasm 装载完成后立即注册——注册返回后
 * provider 直接返回就绪实例。幂等：已注册则跳过。
 *
 * 能力表（设计文档 §5.2 v1 建议值，随单测逐项校正）：
 * evolution 仅覆盖 fuse/cut/fillet（chamferWithHistory 未提供，诚实报错）；
 * meshLift/assembly/advSurface 均为 false，命中即静态报错，禁止伪造。
 */
export async function registerBrepkitBrepEngine(): Promise<void> {
  const primitives = await createBrepkitPrimitives()
  if (isBrepEngineRegistered(BREPKIT_BREP_ENGINE_ID)) return
  registerBrepEngine(BREPKIT_BREP_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: BREPKIT_BREP_ENGINE_ID,
    primitives,
    capabilities: {
      exact: true,
      // 面演化：逐核函数如实声明（Phase 0.2，不是族级布尔）。
      // brepkit 只实现 fillet/cut/fuse 三个 *WithHistory，其余（chamfer/intersect/
      // translate/rotate/mirror/scale/shell/offset/thicken）在
      // brepkit-kernel/brepkitKernel.ts:224-537 一律 unsupported(...)。
      // 声明里少写一项 = 让该 op 静默通过静态判定后死在运行时（红线违规）。
      evolution: ['fuseWithHistory', 'cutWithHistory', 'filletWithHistory'],
      methods: [
        'addHolesInFace',
        // Phase 3：brepkitKernel 真实现映射（wasm getBoundingBox/getSurfaceCenterOfMass 导出）——
        // 能力表可声明；其余 31 个 Phase 3 方法为 unsupported 桩 → 不声明（engine-switch-p3 断言）。
        'getBoundingBox',
        // Phase 4（narrowing D9）：测量族全部接线（surfaceArea→getSurfaceArea、
        // length/wireLength→getLength、volume、centerOfMass）——L1 中立名（D5）如实声明。
        'getVolume',
        'getSurfaceArea',
        'getLength',
        'getCenterOfMass',
        'surfaceCenterOfMass',
        'curveParameters',
        'curvePointAtParam',
        'curveTangent',
        'cut',
        'fixShape',
        'fuse',
        'fuseAll',
        'hashCode',
        'healSolid',
        'intersect',
        'makeCylinder',
        // Phase 3：brepkitKernel 真实现接线 5 个（wasm 导出同/可映射语义）——
        // makeEllipsoid/makeTorus/makeVertex/mirror/shell；section/split 语义
        // 不匹配（wasm 平面式）→ 保持 unsupported 不声明（engine-switch-p3 断言）。
        // extrude 已于 B 批接线（makeRectangle 产出 knownFace → extrude 沿向量挤出，:446）。
        'makeEllipsoid',
        'makeTorus',
        'makeVertex',
        'mirror',
        'shell',
        // 2026-09-26 B 批：brepkitKernel.hullFromPoints 真实现接线
        // （→ kernel.convexHull，brepkitKernel.ts:477）——convexHull op 由
        // engines:['occt'] 降级为 capabilities:['hullFromPoints']，故如实声明。
        'hullFromPoints',
        'makeFace',
        'makeLineEdge',
        // Phase 2：brepkit wasm 已导出 pattern 三方法并已接线（brepkitKernel.ts 阵列族）。
        'linearPattern',
        'circularPattern',
        'gridPattern',
        'scale',
        'sewAndSolidify',
        'surfaceNormal',
        'surfaceType',
        'translate',
        'uvBounds',
        // 2026-09-26 A 批：brepkitKernel 已实现 dispose（GC 型 no-op，:226）与
        // copyShape（调 kernel.copySolid，:397）——此前未声明导致 torus/pattern 族/
        // clone 在静态判定被拒。声明 ⊆ 实例（engine-switch-p3 守卫）。
        'dispose',
        'copyShape',
        // 2026-09-26 B 批：brepkitKernel 真实现 makeRectangle(:436)/extrude(:446，要求
        // knownFace 输入——makeRectangle 产出的面已登记进 knownFaces，makeBaseBox 链可用)/
        // transform(:563)/generalTransform(:572，二者均经 cloneAndTransform 深拷贝+原地仿射，
        // 与 occt STEP-safe BRepBuilderAPI_Transform 同语义)。声明 ⊆ 实例（engine-switch-p3 守卫）。
        'makeRectangle',
        'extrude',
        'transform',
        'generalTransform',
        // 2026-09-26 C batch (section/drill/pocket/boss/mirrorJoin downgrade):
        // brepkitKernel real wiring - sectionByPlane(:492 returns face group, occt returns
        // edge/wire group; semantic diff noted), makeCompound(:668 virtual compound for non-solid
        // children), located(:566 drill cylinder placement), getSubShapes(:775 face selection).
        // declared <= instance (engine-switch-p3 guard).
        'sectionByPlane',
        'makeCompound',
        'located',
        'getSubShapes',
      ],
      heal: true,
      directEdit: true,
      advSurface: false,
      assembly: false,
      meshLift: false,
      exactMeasurement: true,
      brepExport: true,
      tessellationModel: 'extract-time',
    },
  }))
}

/** 已注册任何 BREP 引擎则 no-op；否则注册 brepkit（可作为宿主的显式缺省装配点）。 */
export async function ensureBrepkitDefaultEngine(): Promise<void> {
  if (hasBrepEngine()) return
  await registerBrepkitBrepEngine()
}

// §7.8 编译期完整性守卫：brepkit 原语集合必须满足 BrepEngineApi。
// 实现缺方法或签名不兼容 → tsc 在此报错列出缺失（与 occt 适配器同守卫）。
type _AssertBrepkitApi = AssertSatisfiesBrepEngineApi<BrepkitPrimitives>
