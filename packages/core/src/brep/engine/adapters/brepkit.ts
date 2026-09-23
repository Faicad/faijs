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
        'boundingBox',
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
