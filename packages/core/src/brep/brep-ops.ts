/**
 * 核心 BREP 操作 — 使用 OCCT 精确实体运算
 *
 * @platform occt — 本文件 import occt-kernel：`extrudeBrep` 用原生 `section`
 * （BRepAlgoAPI_Section，occt-only，L1 只有 sectionByPlane）构造截面 → 守卫①
 * 要求平台 import 自证身份。本文件是内部工具面（非 op 文件），文件级标注即满足
 * 守卫；调用方 op 若经本文件触达 occt-only 能力，须在 defineOp 声明 engines
 * （extrudeBrep 的 section 仅 occt 路径可达，brepkit 下由调用方引擎声明拦截）。
 *
 * See docs/api-contract.md §8 (dual-path geometry contract: BREP / Mesh).
 *
 * 与 mesh 路径（transform.ts / boolean/ / drill.ts / split.ts / extrude.ts）对照：
 * - mesh 路径：消费 Shape（三角网格），走 manifold-3d（mesh-CSG）
 * - BREP 路径：消费 BrepHandle（OCCT 实体句柄），走 OCCT 精确布尔/变换
 *
 * 所有函数都是纯函数（可 import occtWasmKernel，不读 store）。
 * 输入输出均为 OCCT BrepHandle，调用方负责句柄生命周期。
 *
 * 坐标系：Z-up、毫米，与 mesh 路径一致。
 */

import * as THREE from 'three'
import type { BrepHandle, BrepMeshResult } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import {
  getOcctKernel,
  importAssemblyFromStep,
  collectLeafParts,
  type ShapeHandle,
  type AssemblyPartNode,
} from '../occt-kernel/occtKernel'
import { getSolidColorsOrdered } from '../occt-kernel/stepColorParser'
import type { Shape, Vec3 } from '../mesh/types'
import type { ImportAssemblyNode } from '../mesh/import-model'
import type { BrepChainState } from './brep-chain'
import type { PartName } from '../identity'
import { getSolidBoundingBox } from './brep-utils'
import { getTessellation, type TessellationDensity } from '../runtime-state'

// ─── 通用工具 ───

/**
 * 将 OCCT solid 三角化为 Shape（供显示用）。
 *
 * 如果传入 brepChain + stmtId，同时把完整 BrepMeshResult（含 faceGroups）缓存到
 * brepChain.meshShapeCache，供 buildBrepTopology 复用——确保拓扑 mesh 与显示 mesh
 * 完全一致（规则 1：拓扑数据生成所使用的 mesh，必须是当前用户看到的 mesh）。
 *
 * @param kernel     the initialized OCCT kernel.
 * @param solid      the CAD solid handle.
 * @param segments   optional tessellation segment count (affects precision).
 * @param brepChain  optional - caches the BrepMeshResult when provided.
 * @param partName   optional - the part this solid belongs to, paired with brepChain as the cache key.
 * @param defaultDeflection optional - per-call deflection fallback when `segments` is absent
 *   (wins over the global tessellation knob; explicit `segments` still wins over both).
 * @returns the tessellated Shape.
 */
export function solidToShape(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  segments?: number,
  brepChain?: BrepChainState,
  partName?: PartName,
  defaultDeflection?: TessellationDensity,
): Shape {
  // Deflection precedence: explicit segments > per-call defaultDeflection > global
  // tessellation (host-tunable via createRuntime, proposal 2026-10-07).
  const fallback = defaultDeflection ?? getTessellation()
  const angularDeflection = segments
    ? (2 * Math.PI) / Math.max(3, segments)
    : fallback.angularDeflection
  const mesh: BrepMeshResult = kernel.meshShape(solid, {
    linearDeflection: fallback.linearDeflection,
    angularDeflection,
  })

  // 规则 1：缓存完整 BrepMeshResult（含 faceGroups），供 buildBrepTopology 复用
  if (brepChain?.meshShapeCache && partName) {
    brepChain.meshShapeCache.set(partName, mesh)
  }

  return {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(mesh.indices),
  }
}

// ─── 变换操作 ───

/**
 * BREP 平移：使用 OCCT translate（精确，不损失几何精度）。
 *
 * @param kernel  OCCT 内核
 * @param solid   输入实体
 * @param offset  平移量 [dx, dy, dz]
 * @returns 新实体（调用方负责释放输入实体）
 */
export function translateBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  offset: Vec3,
): BrepHandle {
  return kernel.translate(solid, offset[0], offset[1], offset[2])
}

/**
 * BREP 旋转：使用 OCCT transform（3x4 仿射矩阵）。
 *
 * 与 mesh 路径 rotate_euler(shape, angles, pivot?) 一致：
 * - angles 为 XYZ 欧拉角（角度制）
 * - pivot 为旋转中心（可选，默认原点）
 *
 * @param kernel    OCCT 内核
 * @param solid     输入实体
 * @param angles XYZ 欧拉角（角度制）
 * @param pivot     旋转中心（可选）
 * @returns 新实体
 */
export function rotateBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  angles: Vec3,
  pivot?: Vec3,
): BrepHandle {
  const euler = new THREE.Euler(
    (angles[0] * Math.PI) / 180,
    (angles[1] * Math.PI) / 180,
    (angles[2] * Math.PI) / 180,
  )
  const matrix = new THREE.Matrix4().makeRotationFromEuler(euler)
  if (pivot) {
    matrix.premultiply(new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]))
    matrix.multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
  }
  return kernel.transform(solid, matrixToArray(matrix))
}

/**
 * 判定 3×4 行主序仿射矩阵的线性部分是否为**相似变换**（旋转/反射 × 等比缩放）——
 * 即 `gp_Trsf` 能精确承载、`kernel.transform`（BRepBuilderAPI_Transform）唯一
 * 正确处理的那一类。
 *
 * 判据必须用**相对**容差，不能像 2026-10-07 之前那样用绝对容差：
 * GOTCHA（2026-10-07，openscad example023 parity）——一个 60° 刚体旋转只要按
 * 7 位小数打印（`0.8660254`），行范数就是 `0.99999999645`（与 1 相差 3.6e-9）。
 * 绝对容差 1e-9 会判定 `|‖row2‖ − ‖row0‖| = 3.6e-9 > 1e-9` ⇒ 把这个**纯旋转**
 * 判成"非相似"，从而错误地走进 `generalTransform`；而 occt 侧 `gp_GTrsf` 路径在
 * **已三角化**的形状上会重复计入被平移面的 TopLoc（顶盖 z 由 5 变 10，绕过在
 * `occt-kernel/occt-primitives.ts` 的 `generalTransform` 适配层，本层不感知）。
 * 相对容差 1e-6 覆盖 7 位小数打印精度，同时仍能区分真正的非等比缩放
 * （如 z×2.5 行范数相差 2.5 倍）。正交性同用 1e-6：7 位小数打印的旋转，行点积
 * 误差上界约 2e-7。
 *
 * @param m12 - 3×4 行主序矩阵（12 元素：`[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]`）。
 * @returns `true` 当且仅当线性部分可逆且为相似变换。
 */
export function isSimilarityAffine(m12: readonly number[]): boolean {
  const s0 = Math.hypot(m12[0]!, m12[1]!, m12[2]!)
  const s1 = Math.hypot(m12[4]!, m12[5]!, m12[6]!)
  const s2 = Math.hypot(m12[8]!, m12[9]!, m12[10]!)
  if (!(s0 > 1e-12) || !(s1 > 1e-12) || !(s2 > 1e-12)) return false
  const REL = 1e-6
  if (Math.abs(s1 - s0) > REL * s0 || Math.abs(s2 - s0) > REL * s0) return false
  const dot = (r: number, c: number): number =>
    m12[r * 4]! * m12[c * 4]! + m12[r * 4 + 1]! * m12[c * 4 + 1]! + m12[r * 4 + 2]! * m12[c * 4 + 2]!
  return (
    Math.abs(dot(0, 1)) <= REL * s0 * s1 &&
    Math.abs(dot(0, 2)) <= REL * s0 * s2 &&
    Math.abs(dot(1, 2)) <= REL * s1 * s2
  )
}

/**
 * 施加 3×4 行主序仿射矩阵，按矩阵类别选**唯一正确**的 OCCT 路径。
 *
 * 两条路径的差异是**正确性**而不只是性能：
 * - 相似（旋转/反射 × 等比缩放）→ `kernel.transform`（BRepBuilderAPI_Transform）。
 * - 其余（非等比缩放、错切）→ `kernel.generalTransform`（gp_GTrsf）。
 *
 * GOTCHA（2026-10-07）：occt 的 `generalTransform` 在**已经三角化过**的形状上会
 * 重复计入被平移面的 TopLoc（精确 z∈[0,5]，网格顶盖却落在 z=10；非等比 z×2.5 时
 * 12.5 vs 17.5）。该缺陷是 **occt 专属**（brepkit 的 GTrsf 路径干净），因此绕过
 * **不在本层**——本层是引擎中立分派，让每个引擎都为 occt 的毛病多付一次句柄分配
 * 是错的（还会扰动 brepkit 的 `cut` bbox，见 multi-engine-op-parity）。
 * 绕过落在 occt 适配层：`occt-kernel/occt-primitives.ts` 的 `generalTransform`
 * 先 `copy` 再变换。`kernel.transform` 无此问题，故相似矩阵不付这份深拷贝成本。
 *
 * 反向陷阱：把非相似矩阵交给 `kernel.transform` 是**静默错误**——OCCT 会按
 * `det^(1/3)` 取等比因子近似（实测 z×2.5 被当成 1.357 倍等比缩放）。所以分类
 * 判据既不能过严（把刚体旋转推给 GTrsf），也不能过宽（把非等比缩放塞给 Trsf）。
 *
 * @param kernel - L1 引擎句柄。
 * @param solid - 输入实体（不被消费、不被释放；调用方保留其所有权）。
 * @param m12 - 3×4 行主序矩阵（12 元素）。
 * @returns 变换后的新实体（调用方负责释放）。
 */
export function applyAffineBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  m12: readonly number[],
): BrepHandle {
  if (isSimilarityAffine(m12)) return kernel.transform(solid, m12 as number[])
  return kernel.generalTransform(solid, m12 as number[])
}

/**
 * BREP 缩放：使用 OCCT transform（3x4 仿射矩阵）。
 *
 * 与 mesh 路径 scale（P6 §4.6）一致：
 * - factor 为 number（均匀缩放）或 Vec3 [sx, sy, sz]（非均匀）
 * - center 为缩放不动点（p' = center + S·(p − center)）；缺省 [0,0,0]（原点），
 *   与早期 brepjs `scale(shape, factor, { center? })` 的默认一致。
 *
 * 路径分派交给 {@link applyAffineBrep}：等比走 `transform`，非等比走
 * `generalTransform`（gp_Trsf 表达不了非等比）。注意判据是**数值**相似性而非
 * 因子逐分量相等——`[1, 1, 1+1e-9]` 这种数值上就是等比，归 `transform` 一侧。
 *
 * @param kernel  OCCT 内核
 * @param solid   输入实体
 * @param factor  缩放因子
 * @param center  缩放不动点（可选，默认原点）
 * @returns 新实体
 */
export function scaleBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  factor: number | Vec3,
  center?: Vec3,
): BrepHandle {
  const f = typeof factor === 'number' ? [factor, factor, factor] : factor
  const scale = new THREE.Matrix4().makeScale(f[0], f[1], f[2])
  // T(c)·S·T(−c)：不动点为 center；缺省时退化为原点缩放（现状行为）。
  const matrix = center
    ? new THREE.Matrix4()
        .makeTranslation(center[0], center[1], center[2])
        .multiply(scale)
        .multiply(new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2]))
    : scale
  return applyAffineBrep(kernel, solid, matrixToArray(matrix))
}

/**
 * 强制单位缩放（unit-system §5.2 — opts.unit/params.unit 对所有格式一视同仁）的
 * BREP 重三角化：`scaleBrep(factor)`（等比，原点）后用 **相对 deflection** 重新
 * meshShape。
 *
 * 为什么必须相对：OCCT meshShape 的 linearDeflection 是**绝对** mm 误差
 * （DEFAULT_LINEAR_DEFLECTION = 0.1mm）。模型放大 factor 后仍用绝对 0.1mm →
 * 细分密度暴增（实测 ×1000 时顶点数 ×~218），显示与拓扑双爆炸。乘以 factor
 * 保持**相对精度不变**（模型大了，绝对误差等比例放宽），网格密度与原始一致。
 *
 * 返回含 faceGroups 的完整 BrepMeshResult：调用方应把它登记进
 * brepChain.meshShapeCache（按 partName），引擎侧 buildBrepTopology 直接复用
 * （规则 1：显示 mesh = 拓扑 mesh），不再二次 meshShape。
 *
 * @param kernel  OCCT 内核
 * @param solid   输入实体（等比缩放后返回新句柄；输入句柄不变）
 * @param factor  缩放因子（≠1 才有意义；=1 时应走 solidToShape 普通路径）
 * @returns 缩放后的 { solid, shape（显示 mesh）, mesh（含 faceGroups 的完整三角化） }
 */
export function scaleBrepAndTessellate(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  factor: number,
): { solid: BrepHandle; shape: Shape; mesh: BrepMeshResult } {
  const scaled = scaleBrep(kernel, solid, factor)
  // 与 solidToShape 默认一致的 angularDeflection（2π/64 = brepjs standard 等效）；
  // linearDeflection × factor —— 相对精度不变。
  const mesh: BrepMeshResult = kernel.meshShape(scaled, {
    linearDeflection: DEFAULT_LINEAR_DEFLECTION.as(mm) * factor,
    angularDeflection: (2 * Math.PI) / 64,
  })
  return {
    solid: scaled,
    shape: {
      positions: new Float32Array(mesh.positions),
      indices: new Uint32Array(mesh.indices),
    },
    mesh,
  }
}

// ─── 装配变换 ───

/**
 * BREP 版 applyTransform：与 mesh ops/assemble.ts 的 applyTransform 同语义（绕 pivot 旋转 + 平移）。
 *
 * 数学公式：p' = R·(p − pivot) + pivot + translation
 * 等价 Matrix4 = T(pivot) · R · T(−pivot) · T(translation)
 *
 * 用四元数而非欧拉角，是因为装配变换源是 api/assembly 的四元数；
 * 转欧拉会引入顺序/万向锁歧义。与 mesh applyTransform 顶点公式完全等价。
 *
 * @param kernel      OCCT 内核
 * @param solid       输入实体
 * @param quaternion  旋转四元数 [x, y, z, w]
 * @param pivot       旋转中心
 * @param translation 平移量
 * @returns 新实体（调用方负责释放输入实体）
 */
export function applyTransformBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  quaternion: [number, number, number, number],
  pivot: [number, number, number],
  translation: [number, number, number],
): BrepHandle {
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
  )
  // T(translation) · T(pivot) · R · T(-pivot) = T(pivot+translation) · R · T(-pivot)
  // 先绕 pivot 旋转，再平移 translation（与 mesh 路径 applyTransform 一致）
  const matrix = new THREE.Matrix4()
    .makeTranslation(pivot[0] + translation[0], pivot[1] + translation[1], pivot[2] + translation[2])
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
  return kernel.transform(solid, matrixToArray(matrix))
}

// ─── 布尔操作 ───

/**
 * BREP 布尔并集：使用 OCCT fuse（BRepAlgoAPI_Fuse）。
 *
 * @param kernel OCCT 内核
 * @param a      实体 A
 * @param b      实体 B
 * @returns 融合后的实体
 */
export function fuseBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): BrepHandle {
  return kernel.fuse(a, b)
}

/**
 * BREP 布尔差集：使用 OCCT cut（BRepAlgoAPI_Cut）。
 *
 * @param kernel OCCT 内核
 * @param a      基体
 * @param b      工具（从基体中减去）
 * @returns 切割后的实体
 */
export function cutBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): BrepHandle {
  return kernel.cut(a, b)
}

/**
 * BREP 布尔交集：使用 OCCT common（BRepAlgoAPI_Common）。
 *
 * @param kernel OCCT 内核
 * @param a      实体 A
 * @param b      实体 B
 * @returns 交集实体
 */
export function commonBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): BrepHandle {
  return kernel.common(a, b)
}

// ─── 钻孔操作 ───

/** drillBrep 的参数 */
export interface DrillBrepParams {
  /** 孔直径 */
  diameter: number
  /** 孔深度（0 = 通孔） */
  depth: number
  /** 孔位置（世界空间） */
  position: Vec3
  /** 钻孔方向（世界空间，指向材料内部） */
  direction: Vec3
  /** 面法向（世界空间） */
  faceNormal: Vec3
  /** 孔类型 */
  holeType?: 'simple' | 'screw'
}

/**
 * BREP 钻孔：创建圆柱工具实体并用 OCCT cut 减去。
 *
 * 仅支持圆柱孔（holeType='simple'）。
 * 螺丝孔（holeType='screw'）由调用方判断为 mesh-only，触发 BREP 链断裂。
 *
 * 通孔（depth=0）：创建一个足够长的圆柱体穿透整个零件。
 * 盲孔（depth>0）：创建指定深度的圆柱体。
 *
 * @param kernel OCCT 内核
 * @param solid  目标实体
 * @param params 钻孔参数
 * @returns 钻孔后的实体
 */
/** 钻孔几何参数（由 `DrillBrepParams` 推导；roleTable 路径与 `drillBrep` 共用同一份几何，避免重复计算）。 */
export interface DrillGeometry {
  readonly radius: number
  readonly holeHeight: number
  readonly holeCenter: THREE.Vector3
  readonly direction: THREE.Vector3
}

/** 从 `DrillBrepParams` 推导钻孔几何（孔中心/高度/轴向）。供 `drillBrep` 与 role-table 路径共用。
 * @param kernel - BREP 引擎接口
 * @param solid - 待钻孔实体（用于 bbox 推导通孔高度）
 * @param params - 钻孔参数（直径/深度/位置/方向/面法向）
 * @returns 钻孔几何（半径/高度/中心/轴向）
 */
export function computeDrillGeometry(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  params: DrillBrepParams,
): DrillGeometry {
  const radius = params.diameter / 2
  const direction = new THREE.Vector3(...params.direction).normalize()
  // 确保方向指向材料内部
  const faceNormal = new THREE.Vector3(...params.faceNormal)
  if (direction.dot(faceNormal) > 0) {
    direction.negate()
  }

  // 计算孔的高度和中心
  const bbox = getSolidBoundingBox(kernel, solid)
  const bboxSize = new THREE.Vector3(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  )
  const bboxMax = Math.max(bboxSize.x, bboxSize.y, bboxSize.z)

  let holeHeight: number
  let holeCenter: THREE.Vector3
  const pos = new THREE.Vector3(...params.position)

  // 通孔：depth <= 0（契约：depth<=0 表示通孔，与 mesh 路径 `depth>0 ? 'blind':'through'` 一致）。
  // ⚠️ 只判 `=== 0` 会让 depth<0 落入盲孔分支 → safeDepth=0 → 零高圆柱 → OCCT transform 崩溃。
  if (params.depth <= 0) {
    const d = direction.clone().normalize()
    const bbMin = new THREE.Vector3(bbox.min[0], bbox.min[1], bbox.min[2])
    const bbMax = new THREE.Vector3(bbox.max[0], bbox.max[1], bbox.max[2])

    let tNear = -Infinity
    let tFar = Infinity
    const axes: Array<[number, number, number, number]> = [
      [0, d.x, bbMin.x, bbMax.x],
      [1, d.y, bbMin.y, bbMax.y],
      [2, d.z, bbMin.z, bbMax.z],
    ]
    const pArr = [pos.x, pos.y, pos.z]
    for (const [axis, di, lo, hi] of axes) {
      const pi = pArr[axis]
      if (Math.abs(di) > 1e-12) {
        const t1 = (lo - pi) / di
        const t2 = (hi - pi) / di
        tNear = Math.max(tNear, Math.min(t1, t2))
        tFar = Math.min(tFar, Math.max(t1, t2))
      } else if (pi < lo || pi > hi) {
        // 与 slab 平行且在外部 — 无交点（与 mesh 行为一致：几乎不钻孔）
        tNear = 0
        tFar = 0
      }
    }
    if (!isFinite(tNear) || !isFinite(tFar) || tFar < tNear) {
      // 不穿过 bbox：与 mesh 一致，只留 0.2mm 微小孔
      holeHeight = 0.2
      holeCenter = pos.clone()
    } else {
      holeHeight = tFar - tNear + 0.2
      holeCenter = pos.clone().add(direction.clone().normalize().multiplyScalar((tNear + tFar) / 2))
    }
  } else {
    // 盲孔：深度钳制到 bboxMax（与 mesh cad-core/drill.ts 一致）
    const safeDepth = Math.max(0, Math.min(params.depth, bboxMax))
    holeHeight = safeDepth
    holeCenter = pos.clone().add(direction.clone().normalize().multiplyScalar(safeDepth / 2))
  }

  return { radius, holeHeight, holeCenter, direction }
}

/** 由钻孔几何构造刀具实体（圆柱，旋转 + 平移到孔位）。调用方负责 release。
 * @param kernel - BREP 引擎接口
 * @param geom - 钻孔几何（半径/高度/中心/轴向）
 * @returns 刀具实体（BrepHandle，调用方负责 release）
 */
export function buildDrillToolSolid(kernel: BrepEngineApi, geom: DrillGeometry): BrepHandle {
  const cylinder = kernel.makeCylinder(geom.radius, geom.holeHeight)

  // 计算从 Z 轴到 direction 的旋转
  const zAxis = new THREE.Vector3(0, 0, 1)
  const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, geom.direction)
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat)

  // 平移矩阵：到孔中心，并减去 height/2（因为圆柱从 Z=0 开始）
  const transMatrix = new THREE.Matrix4().makeTranslation(
    geom.holeCenter.x,
    geom.holeCenter.y,
    geom.holeCenter.z,
  )
  // 组合：先旋转，再平移
  const finalMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)
  // 还需要补偿圆柱的起始位置（从 Z=0 开始 → 需要先下移 height/2）
  const offsetMatrix = new THREE.Matrix4().makeTranslation(0, 0, -geom.holeHeight / 2)
  const fullMatrix = new THREE.Matrix4().multiplyMatrices(finalMatrix, offsetMatrix)

  const toolSolid = kernel.transform(cylinder, matrixToArray(fullMatrix))
  kernel.release(cylinder)
  return toolSolid
}

/** 在实体上钻一个孔：由参数推导几何、构造刀具实体并做布尔差。
 * @param kernel - BREP 引擎接口
 * @param solid - 待钻孔实体
 * @param params - 钻孔参数（直径/深度/位置/方向/面法向）
 * @returns 钻孔后的实体（BrepHandle）
 */
export function drillBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  params: DrillBrepParams,
): BrepHandle {
  const geom = computeDrillGeometry(kernel, solid, params)
  const toolSolid = buildDrillToolSolid(kernel, geom)
  try {
    const result = kernel.cut(solid, toolSolid)
    kernel.release(toolSolid)
    return result
  } catch (err) {
    kernel.release(toolSolid)
    throw new Error(`[drillBrep] OCCT cut failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

// ─── 分割操作 ───

/** splitBrep 的参数 */
export interface SplitBrepParams {
  /** 切割平面法线 */
  normal: Vec3
  /**
   * 切割平面位置：世界系平面方程 d 值（n·x = planeDistance）。
   * 与 planeCenter 二选一必填；都缺省时抛错，不隐式回退。
   */
  planeDistance?: number
  /**
   * 切割平面位置：世界坐标点（平面中心）。
   * 与 planeDistance 二选一必填；都缺省时抛错，不隐式回退。
   */
  planeCenter?: Vec3
}

/** splitBrep 的结果 */
export interface SplitBrepResult {
  /** 法线正方向的半部分 */
  front: BrepHandle
  /** 法线负方向的半部分 */
  back: BrepHandle
}

/**
 * BREP 平面分割：使用 OCCT cut + common 实现平面分割。
 *
 * 仅支持平面分割（cutMode='plane'）。
 * 燕尾/定位销/直榫等复杂分割由 joinery-brep.ts 处理。
 *
 * 实现方式：
 * 1. 创建一个大的半空间盒子（法线正方向一侧）
 * 2. common(solid, box) → 法线正方向的半部分
 * 3. cut(solid, box) → 法线负方向的半部分
 *
 * @param kernel OCCT 内核
 * @param solid  目标实体
 * @param params 分割参数
 * @returns 两个半部分
 */
export function splitBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  params: SplitBrepParams,
): SplitBrepResult {
  const bbox = getSolidBoundingBox(kernel, solid)
  const bboxSize = new THREE.Vector3(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  )
  const bboxMax = Math.max(bboxSize.x, bboxSize.y, bboxSize.z)

  // 创建一个大的盒子代表法线正方向的半空间
  const normal = new THREE.Vector3(...params.normal).normalize()
  const halfSize = bboxMax * 3 // 足够大

  // 先在局部坐标系（Z 轴 = 法线方向）创建盒子
  // 然后旋转到世界坐标系
  const zAxis = new THREE.Vector3(0, 0, 1)
  const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, normal)
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat)

  // 在局部坐标系中，盒子从 Z=0（切割平面）延伸到 Z=halfSize
  const localBox = kernel.makeBoxFromCorners(
    { x: -halfSize, y: -halfSize, z: 0 },
    { x: halfSize, y: halfSize, z: halfSize },
  )

  // 计算切割平面的世界坐标原点（planeCenter / planeDistance 二选一必填，
  // 都缺省直接报错，不隐式回退 bbox 中心）
  const planeOrigin = resolvePlaneOrigin(normal, params.planeCenter, params.planeDistance)

  const transMatrix = new THREE.Matrix4().makeTranslation(
    planeOrigin.x,
    planeOrigin.y,
    planeOrigin.z,
  )
  const finalMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)

  const halfSpaceBox = kernel.transform(localBox, matrixToArray(finalMatrix))
  kernel.release(localBox)

  try {
    // P2（2026-10-06）：规避 occt-wasm 在 Chrome worker 下 common 对"平面退化 BOP"
    // 挂死（common(solid, 半边盒) 不稳定；cut 稳定——drill 打孔 cut 在 worker 正常）。
    // 差集对偶：back（负侧）= solid - 正盒；front（正侧）= solid - 负盒。
    // 数学等价于 common/cut（盒覆盖 solid 全尺寸，边界同为切割平面），node 探针验证
    // 三角化结果与原实现一致。common 保留在 node/非 worker 环境的回退不可行——
    // 静态行为应一致，故统一走两 cut。
    const back = kernel.cut(solid, halfSpaceBox)
    // 负盒：local 系 z ∈ [-halfSize, 0]，同 finalMatrix（平面沿 -normal 方向扩展）
    const localBoxNeg = kernel.makeBoxFromCorners(
      { x: -halfSize, y: -halfSize, z: -halfSize },
      { x: halfSize, y: halfSize, z: 0 },
    )
    const negBox = kernel.transform(localBoxNeg, matrixToArray(finalMatrix))
    kernel.release(localBoxNeg)
    const front = kernel.cut(solid, negBox)
    kernel.release(halfSpaceBox)
    kernel.release(negBox)
    return { front, back }
  } catch (err) {
    kernel.release(halfSpaceBox)
    throw new Error(`[splitBrep] OCCT split failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

// ─── 拉伸操作 ───

/** extrudeBrep 的参数 */
export interface ExtrudeBrepParams {
  /** 拉伸法线方向 */
  normal: Vec3
  /**
   * 切割平面位置：世界系平面方程 d 值（n·x = planeDistance）。
   * 与 planeCenter 二选一必填；都缺省时抛错，不隐式回退。
   */
  planeDistance?: number
  /**
   * 切割平面位置：世界坐标点（平面中心）。
   * 与 planeDistance 二选一必填；都缺省时抛错，不隐式回退。
   */
  planeCenter?: Vec3
  /** 拉伸长度 */
  length: number
  /** 拉伸模式 */
  mode?: 'centered' | 'forward' | 'backward'
}

/** 从 planeCenter / planeDistance 收敛出切割平面上的一个点（planeOrigin）。 */
function resolvePlaneOrigin(
  normal: THREE.Vector3,
  planeCenter?: Vec3,
  planeDistance?: number,
): THREE.Vector3 {
  if (planeCenter !== undefined) {
    return new THREE.Vector3(...planeCenter)
  }
  if (planeDistance !== undefined) {
    // 平面方程 n·x = d 上的点：取法线上距原点 d 处（n 为单位向量）
    return normal.clone().multiplyScalar(planeDistance)
  }
  throw new Error(
    '[extrudeBrep] plane location missing: provide planeCenter or planeDistance (implicit bbox-center fallback is forbidden)',
  )
}

/**
 * BREP 拉伸：在切割平面处将实体切开，中段沿法线拉伸 length，三段 fuse。
 *
 * 实现方式：
 * 1. 用平面分割得到 front + back
 * 2. 获取截面线（section edges → wire → face）
 * 3. 沿法线拉伸截面 face → 中段实体
 * 4. fuse(front, extruded, back)
 *
 * 如果截面无法构建 face（开放线框等），抛出错误由调用方处理为链断裂。
 *
 * @param kernel OCCT 内核
 * @param solid  目标实体
 * @param params 拉伸参数
 * @returns 拉伸后的实体
 */
export function extrudeBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  params: ExtrudeBrepParams,
): BrepHandle {
  const mode = params.mode ?? 'centered'
  const normal = new THREE.Vector3(...params.normal).normalize()
  const length = params.length

  // 1. 确定切割平面位置（世界系，来源静态：planeCenter 或 planeDistance，
  //    都缺省直接报错，不隐式回退 bbox 中心）
  const planeOrigin = resolvePlaneOrigin(normal, params.planeCenter, params.planeDistance)

  // 2. 分割实体
  const splitResult = splitBrep(kernel, solid, {
    normal: [normal.x, normal.y, normal.z],
    planeCenter: [planeOrigin.x, planeOrigin.y, planeOrigin.z],
  })

  // 3. 获取截面
  // 使用 section 获取切割平面与实体的交线
  const bbox = getSolidBoundingBox(kernel, solid)
  const zAxis = new THREE.Vector3(0, 0, 1)
  const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, normal)
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat)
  const transMatrix = new THREE.Matrix4().makeTranslation(
    planeOrigin.x,
    planeOrigin.y,
    planeOrigin.z,
  )
  const planeMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)

  // 创建一个大的矩形面作为切割平面
  const bboxSize = new THREE.Vector3(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  )
  const planeSize = Math.max(bboxSize.x, bboxSize.y, bboxSize.z) * 3
  const planeRect = kernel.makeRectangle(planeSize, planeSize)
  // makeRectangle creates a face from [0,0] to [width,height] — center it at origin first
  const centerMatrix = new THREE.Matrix4().makeTranslation(-planeSize / 2, -planeSize / 2, 0)
  const centeredRect = kernel.transform(planeRect, matrixToArray(centerMatrix))
  kernel.release(planeRect)
  const planeFace = kernel.transform(centeredRect, matrixToArray(planeMatrix))
  kernel.release(centeredRect)

  // 获取截面边（occt-only 平台面，D3）。BrepHandle（branded number）与
  // occt-wasm ShapeHandle 运行时同构，品牌转换只发生在平台边界；转回 BrepHandle
  // 后继续用 L1 面（getSubShapes/makeWire/extrude）。
  const sectionEdges = getOcctKernel().section(
    solid as unknown as ShapeHandle,
    planeFace as unknown as ShapeHandle,
  ) as unknown as BrepHandle
  kernel.release(planeFace)

  // 4. 构建截面 wire → face → 拉伸
  let extrudedSolid: BrepHandle
  try {
    // 尝试从截面边构建 wire
    const subShapes = kernel.getSubShapes(sectionEdges, 'edge')
    if (subShapes.length === 0) {
      kernel.release(sectionEdges)
      kernel.release(splitResult.front)
      kernel.release(splitResult.back)
      throw new Error('no section edges from plane intersection')
    }

    const wire = kernel.makeWire(subShapes)
    const face = kernel.makeFace(wire)
    kernel.release(wire)

    // 计算拉伸向量
    let extrudeVec: THREE.Vector3
    if (mode === 'centered') {
      extrudeVec = normal.clone().multiplyScalar(length)
    } else if (mode === 'forward') {
      extrudeVec = normal.clone().multiplyScalar(length)
    } else {
      // backward
      extrudeVec = normal.clone().multiplyScalar(-length)
    }

    extrudedSolid = kernel.extrude(face, extrudeVec.x, extrudeVec.y, extrudeVec.z)
    kernel.release(face)
    kernel.release(sectionEdges)
  } catch {
    // 截面构建失败 — 释放资源并抛出
    if (sectionEdges) kernel.release(sectionEdges)
    kernel.release(splitResult.front)
    kernel.release(splitResult.back)
    throw new Error('[extrudeBrep] failed to build extrusion from section')
  }

  // 5. 中段落位补偿（修复 centered 模式中空 / 开壳）
  //
  // 切割平面位于 planeOrigin，splitBrep 产出的 front/back 其切面恰好在 planeOrigin。
  // - forward：front 偏移 +L、back 偏移 0 → 中段(从 planeOrigin 沿 +normal 拉伸 L，
  //   底面在 planeOrigin)的顶面(planeOrigin+L)正好接 front 底面，无需位移。
  // - backward：front 偏移 0、back 偏移 -L → 中段(沿 -normal 拉伸 L，顶在 planeOrigin)
  //   底面(planeOrigin-L)正好接 back 顶面，无需位移。
  // - centered：front 偏移 +L/2、back 偏移 -L/2，二者之间让出 L 的缝隙；但中段默认
  //   从 planeOrigin 沿 +normal 拉伸 L，落在 planeOrigin→planeOrigin+L，与 back 顶面
  //   (planeOrigin-L/2) 和 front 底面 (planeOrigin+L/2) 各错开 L/2，形成两道 L/2 的缝隙
  //   → fuse 后实体开壳 / 中空。必须对中段额外沿 -normal 位移 L/2，使其落在
  //   planeOrigin-L/2 → planeOrigin+L/2，正好填补缝隙。
  const middleOffset = mode === 'centered' ? -length / 2 : 0
  if (middleOffset !== 0) {
    const translatedMiddle = kernel.translate(
      extrudedSolid,
      normal.x * middleOffset,
      normal.y * middleOffset,
      normal.z * middleOffset,
    )
    kernel.release(extrudedSolid)
    extrudedSolid = translatedMiddle
  }

  // 6. 计算各段位置
  let frontOffset: number
  let backOffset: number
  if (mode === 'centered') {
    frontOffset = length / 2
    backOffset = -length / 2
  } else if (mode === 'forward') {
    frontOffset = length
    backOffset = 0
  } else {
    frontOffset = 0
    backOffset = -length
  }

  // 平移 front 和 back
  const frontTranslated = kernel.translate(
    splitResult.front,
    normal.x * frontOffset,
    normal.y * frontOffset,
    normal.z * frontOffset,
  )
  kernel.release(splitResult.front)

  const backTranslated = kernel.translate(
    splitResult.back,
    normal.x * backOffset,
    normal.y * backOffset,
    normal.z * backOffset,
  )
  kernel.release(splitResult.back)

  // 7. Fuse 三段
  let result: BrepHandle
  try {
    const fused1 = kernel.fuse(frontTranslated, extrudedSolid)
    kernel.release(frontTranslated)
    kernel.release(extrudedSolid)
    result = kernel.fuse(fused1, backTranslated)
    kernel.release(fused1)
    kernel.release(backTranslated)
  } catch (err) {
    kernel.release(frontTranslated)
    kernel.release(extrudedSolid)
    kernel.release(backTranslated)
    throw new Error(`[extrudeBrep] fuse failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  return result
}

// ─── STEP/BREP 导入操作 ───

/**
 * 单零件导入的 STEP 颜色挂载（P2，方案 §5 STEP 行）。
 *
 * `getSolidColorsOrdered`（stepColorParser）把 STYLED_ITEM → COLOUR_RGB 引用链
 * 解析为按 MANIFOLD_SOLID_BREP 文件序的颜色数组；该序与 OCCT
 * `getSubShapes(compound,'solid')` 一致（stepColorParser 注释），因此取 `[0]`
 * 即「loadBrep 单零件收敛取第一个 solid」的颜色，语义对齐。
 *
 * 宽容兼容外部数据：BREP（CASCADE Topology 文本）无颜色概念直接跳过；STEP
 * 文本无 `STYLED_ITEM` 早退（零额外开销）；引用链缺失/未知预定义色返回 null，
 * 一律不挂外观、不抛错（AGENTS.md 全局铁律：不得以内部严格性拒收正常文件）。
 */
function applyFirstStepColor(shape: Shape, buffer: ArrayBuffer): Shape {
  const head = new TextDecoder('utf-8').decode(buffer.slice(0, 64))
  if (head.includes('CASCADE Topology')) return shape
  const text = new TextDecoder('utf-8').decode(buffer)
  if (!text.includes('STYLED_ITEM')) return shape
  const c0 = getSolidColorsOrdered(text)[0]
  if (c0) shape.appearance = { color: [c0[0], c0[1], c0[2]] }
  return shape
}

/**
 * BREP-native STEP 导入：使用 OCCT kernel.importStep 导入 STEP 文件为精确实体。
 *
 * 与 mesh 路径（cad-core/io.ts importFile → loadFormat → meshes）对照：
 * - mesh 路径：STEP → 三角网格，丢弃 OCCT BrepHandle
 * - BREP 路径：STEP → kernel.importStep → 保留 BrepHandle，同时三角化为显示 mesh
 *
 * 导入的 solid 存入 brepChain.solidCache，后续操作（drillBrep/splitBrep 等）
 * 将其作为"基座特征"进行精确运算。
 *
 * **设计决策（I5 不准合并；fileid-container-and-nesting §5.4 单零件收敛）**：
 * - 单 solid STEP：`importStep` 返回 Compound 包裹（顶层是 `TopoDS_Compound`，
 *   内含 1 个 `TopoDS_Solid`）。此处**解包**返回真实 Solid（`solids[0]`），
 *   下游 `isValid`/编辑/导出都针对真实实体。
 * - 多 solid STEP：**只支持单零件**（§5.4）——降级取**第一个** solid 返回（单一
 *   非复合 Shape），并回传 `multiSolidCount`（≥2 表示本文件被降级取件，由 load op
 *   登记"多零件降级" pending，宿主据此弹警告 §5.4:166）。取件点唯一，逐 part 拆
 *   分只发生在 load op 内部，宿主不再发多条 load。
 * - **不调用 `kernel.isValid`**：`importStep` 对单 solid STEP 也返回 Compound 包裹，
 *   `isValid(compound)` 返回 false（Compound 不是 Solid），这会误杀合法 STEP。
 *   合法性判据改为 `getSubShapes(top, 'solid').length >= 1`（含 ≥1 个 solid 即合法），
 *   与装配路径 `walkLabel` 一致。
 *
 * @param kernel     the initialized OCCT kernel.
 * @param buffer     the raw STEP file bytes (a text-encoded ArrayBuffer).
 * @param brepChain  optional - caches the tessellated BrepMeshResult when provided.
 * @param stmtId     optional - the part this solid belongs to, paired with brepChain as the cache key.
 * @param opts       optional - `allowNonSolid` relaxes the solid requirement so
 *                   a frozen wireframe/surface asset (a Draft wire, a face, a
 *                   shell) can be imported as addressable geometry. Callers
 *                   must decide this STATICALLY from the asset itself (see
 *                   `brepTextHasSolid`), never by retrying after a failure.
 * @returns { solid: the OCCT solid handle, shape: the display tessellated mesh,
 *            multiSolidCount: total solids declared when > 1 (single-part take-first) }
 */
export function loadBrep(
  kernel: BrepEngineApi,
  buffer: ArrayBuffer,
  brepChain?: BrepChainState,
  stmtId?: PartName,
  opts?: { allowNonSolid?: boolean },
): { solid: BrepHandle; shape: Shape; multiSolidCount?: number } {
  // BREP 文件（CASCADE Topology 文本格式）必须用 kernel.fromBREP 解析；
  // 误用 STEP 解析器（importStep）读 BREP 会抛 "failed to read STEP data"。
  const decoder = new TextDecoder('utf-8')
  const head = decoder.decode(buffer.slice(0, 64))
  const top = head.includes('CASCADE Topology')
    ? kernel.fromBREP(decoder.decode(buffer))
    : kernel.importStep(buffer)

  // 校验：含至少一个 solid 子形即合法（不调用 isValid，见上文设计决策）
  const solids = kernel.getSubShapes(top, 'solid')
  if (solids.length < 1) {
    // 非实体导入（allowNonSolid）：冻结资产是 wireframe/surface（Draft 线/面/壳）
    // 时仍可作为可寻址几何导入——顶点/边/线/面/壳都算有内容。此时返回 top 本身，
    // 它独立持有几何，不能释放。
    // 注意：这类 Shape 进不了布尔运算（OCCT fuse/cut 抛 "boolean operation
    // failed"），调用方必须自己保证它只流向变换/聚合。
    if (opts?.allowNonSolid && hasAnyTopology(kernel, top)) {
      const shape = solidToShape(kernel, top, undefined, brepChain, stmtId)
      return { solid: top, shape: applyFirstStepColor(shape, buffer) }
    }
    kernel.release(top)
    throw new Error(
      `[loadBrep] imported shape contains no solid sub-shapes ` +
      `(solidCount=0) — wireframe/surface/invalid shapes are not supported ` +
      `unless allowNonSolid is set`
    )
  }

  // 单 solid：解包返回真实 Solid（非 Compound 包裹）
  if (solids.length === 1) {
    const realSolid = solids[0]
    kernel.release(top) // 释放 Compound 包裹，realSolid 独立持有
    const shape = solidToShape(kernel, realSolid, undefined, brepChain, stmtId)
    return { solid: realSolid, shape: applyFirstStepColor(shape, buffer) }
  }

  // 多 solid（§5.4 单零件收敛）：只支持单零件 —— 降级取**第一个** solid，
  // 返回单一非复合 Shape，并回传 multiSolidCount（≥2 表示本文件被降级取件，
  // 由 `cad.load` op 登记"多零件降级" pending，宿主据零件数弹警告 §5.4:166）。
  // 取件点唯一：多零件拆分只发生在 load op 内部，宿主不再逐 part 拆、不再发
  // 多条 load。`solids` 是 kernel.getSubShapes(top,'solid') 的内核枚举序；对同一
  // import 路径、同一 OCCT 版本，该序是确定性的，故"第一个"可复现（红线 7）。
  const first = solids[0]
  if (!first) {
    kernel.release(top)
    throw new Error(`[loadBrep] imported shape has 0 solid sub-shapes`)
  }
  // 释放其余多余子形句柄（first 独立持有几何，剩下的子是 top 的子引用）
  for (const s of solids.slice(1)) {
    try { kernel.release(s) } catch { /* already released */ }
  }
  kernel.release(top) // 释放 Compound 包裹，first 独立持有（同单 solid 模式）
  const shape = solidToShape(kernel, first, undefined, brepChain, stmtId)
  return { solid: first, shape: applyFirstStepColor(shape, buffer), multiSolidCount: solids.length }
}

/** Sub-shape kinds that make an imported shape "addressable but not a solid". */
const NON_SOLID_KINDS = ['vertex', 'edge', 'wire', 'face', 'shell'] as const

/**
 * Does a freshly imported shape hold any sub-shape at all?
 *
 * Guards the `allowNonSolid` path: a file whose TShapes table is empty (or that
 * holds only a bare compound with nothing inside) is a broken asset, not a
 * wireframe one, and must still fail loudly.
 *
 * @param kernel - the initialized OCCT kernel.
 * @param top - the imported top-level shape handle.
 * @returns true when at least one non-solid sub-shape exists.
 */
function hasAnyTopology(kernel: BrepEngineApi, top: BrepHandle): boolean {
  return NON_SOLID_KINDS.some((kind) => kernel.getSubShapes(top, kind).length > 0)
}

// ─── 多零件 STEP 装配导入（P0，方案 2026-10-06-step-3mf-multipart-import-plan.md §5.3）───

/** 多零件 STEP 导入中的一个零件（几何 + solid 句柄 + 身份）。 */
export interface LoadBrepAssemblyPart {
  /** 零件序号（0 起，DFS 声明序）。 */
  index: number
  /** 零件名（XCAF label；无则回退 `imported:<index>`）。 */
  name: string
  /** 显示色 sRGB 0..1，无则 null。 */
  color: [number, number, number] | null
  /** 三角化显示 mesh。 */
  shape: Shape
  /** OCCT solid 句柄（已烘 location；生命周期归 brepChain，调用方经 fromBrep 绑定）。 */
  solid: BrepHandle
}

/**
 * BREP-native 多零件 STEP 导入（XCAF 装配树 → 逐零件 Shape + 装配层级）。
 *
 * 与 `loadBrep`（单零件收敛，§5.4 旧行为）对照：loadBrepAssembly 走
 * `importAssemblyFromStep`（XCAF），返回**全部**叶零件（DFS 声明序）与装配树。
 *
 * - 装配树叶子 = 零件；合成节点（syntheticGroup：单一产品含多 MANIFOLD_SOLID_BREP）
 *   如实表达为中间节点；
 * - 无装配结构的单叶文件 → 1 个零件、无 assembly（行为与现状单零件一致）；
 * - 句柄互通（T0）：`importAssemblyFromStep` 内部用 initOcctWasm() 全局单例内核，
 *   与注入的 `BrepEngineApi`（createOcctPrimitives 包装同一单例）句柄数值互通——
 *   探针见 test/brep/load-brep-assembly.test.ts；
 * - 释放：装配节点句柄已由 walkLabel 释放，叶句柄随返回 parts 交给调用方
 *   （fromBrep 绑定后归 brepChain 管理，不在此释放）。
 *
 * @param kernel - the initialized OCCT kernel (L1 contract face).
 * @param buffer - the raw STEP file bytes (text-encoded ArrayBuffer; stpz
 *   unzipping is the caller's job — faijs never unzips implicitly).
 * @returns 全部零件 + 装配层级（多叶时）+ 叶数（>1 时）。
 */
export async function loadBrepAssembly(
  kernel: BrepEngineApi,
  buffer: ArrayBuffer,
): Promise<{ parts: LoadBrepAssemblyPart[]; assembly?: ImportAssemblyNode; multiSolidCount?: number }> {
  const nodes = await importAssemblyFromStep(buffer)
  const leaves = collectLeafParts(nodes)

  // DFS 声明序：leaf 序 = parts 序 = ImportModel.parts.index。
  // 实体校验（与 load op「要求导入物含实体」契约一致）：leaf 必须持有实体
  // （自身是 solid，或 label 内含 solid）；空 label / wireframe 零件跳过，
  // 全部跳过则报错（不静默回退）。parts 下标保持连续（0..N-1）。
  const leafIndex = new Map<AssemblyPartNode, number>()
  const parts: LoadBrepAssemblyPart[] = []
  for (const leaf of leaves) {
    if (!leaf.shapeHandle || !leafHasSolid(kernel, leaf.shapeHandle)) continue
    const idx = parts.length
    leafIndex.set(leaf, idx)
    const h = leaf.shapeHandle as unknown as BrepHandle
    parts.push({
      index: idx,
      name: leaf.name || `imported:${idx}`,
      color: leaf.color,
      shape: solidToShape(kernel, h),
      solid: h,
    })
  }

  // 无叶零件（空/异常/纯 wireframe 文件）→ 报错暴露（不静默回退）。
  if (parts.length === 0) {
    throw new Error('[loadBrepAssembly] imported STEP contains no solid leaf parts')
  }

  const assembly = toImportAssemblyNode(nodes, leafIndex)
  return {
    parts,
    ...(assembly ? { assembly } : {}),
    ...(parts.length > 1 ? { multiSolidCount: parts.length } : {}),
  }
}

/**
 * leaf 是否持有实体（loadBrepAssembly 实体校验）：自身是 solid（syntheticGroup
 * 拆出的单个 solid 句柄），或 label compound 内含 solid。getSubShapes 的引用
 * 句柄须立即 release（walkLabel 只释放了它自己取的副本）。
 */
function leafHasSolid(kernel: BrepEngineApi, h: ShapeHandle): boolean {
  const bh = h as unknown as BrepHandle
  if (kernel.isSolid(bh)) return true
  const solids = kernel.getSubShapes(bh, 'solid')
  const n = solids.length
  for (const s of solids) kernel.release(s)
  return n > 0
}

/**
 * XCAF 装配树 → ImportAssemblyNode（DFS 序与 parts 一致）。
 *
 * - 单根且根为叶（无装配结构）→ undefined（单零件路径，与现状一致）；
 * - 单根装配 → 该根；
 * - 多根 → 合成虚拟根 `{ name: 'imported' }`（确定性结构名，非零件身份）。
 */
function toImportAssemblyNode(
  nodes: AssemblyPartNode[],
  leafIndex: Map<AssemblyPartNode, number>,
): ImportAssemblyNode | undefined {
  if (nodes.length === 0) return undefined
  const convert = (node: AssemblyPartNode): ImportAssemblyNode => {
    if (node.children.length === 0) {
      const idx = leafIndex.get(node)
      return { name: node.name, ...(idx !== undefined ? { partIndex: idx } : {}) }
    }
    return { name: node.name, children: node.children.map(convert) }
  }
  if (nodes.length === 1) {
    const root = convert(nodes[0])
    // 单根且根为叶（无装配结构）→ 不表达装配层级
    if (root.partIndex !== undefined) return undefined
    return root
  }
  return { name: 'imported', children: nodes.map(convert) }
}

// ─── 辅助函数 ───

/**
 * Convert a THREE.Matrix4 into the 3x4 row-major array (12 doubles) the OCCT
 * transform expects.
 *
 * OCCT transform accepts [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz].
 * @param matrix - the source matrix to convert.
 * @returns the 3x4 row-major array of 12 doubles.
 */
export function matrixToArray(matrix: THREE.Matrix4): number[] {
  const e = matrix.elements
  // THREE.Matrix4 是 column-major，OCCT 需要 row-major 3x4
  return [
    e[0], e[4], e[8], e[12],
    e[1], e[5], e[9], e[13],
    e[2], e[6], e[10], e[14],
  ]
}
