/**
 * 核心 BREP 操作 — 使用 OCCT 精确实体运算
 *
 * 设计文档：docs/plans/2026-08-08-primitive-brep-mode-plan.md §4.7 (Phase 2)
 *           docs/plans/2026-08-10-brep-break-fix-plan.md §0 (目录重构)
 *
 * 与 mesh 路径（transform.ts / boolean/ / drill.ts / split.ts / extrude.ts）对照：
 * - mesh 路径：消费 Shape（三角网格），走 manifold-3d（mesh-CSG）
 * - BREP 路径：消费 ShapeHandle（OCCT 实体句柄），走 OCCT 精确布尔/变换
 *
 * 所有函数都是纯函数（可 import occtWasmKernel，不读 store）。
 * 输入输出均为 OCCT ShapeHandle，调用方负责句柄生命周期。
 *
 * 坐标系：Z-up、毫米，与 mesh 路径一致。
 */

import * as THREE from 'three'
import type { OcctKernel, ShapeHandle, Mesh as WasmMesh } from 'occt-wasm'
import type { Shape, Vec3 } from '../mesh/types'
import type { BrepChainState } from './brep-chain'
import { getSolidBoundingBox } from './brep-utils'

// ─── 通用工具 ───

/**
 * 将 OCCT solid 三角化为 Shape（供显示用）。
 *
 * 如果传入 brepChain + stmtId，同时把完整 WasmMesh（含 faceGroups）缓存到
 * brepChain.meshShapeCache，供 buildBrepTopology 复用——确保拓扑 mesh 与显示 mesh
 * 完全一致（规则 1：拓扑数据生成所使用的 mesh，必须是当前用户看到的 mesh）。
 *
 * @param kernel     已初始化的 OCCT 内核
 * @param solid      CAD 实体句柄
 * @param segments   可选分段数（影响三角化精度）
 * @param brepChain  可选——传入则缓存 WasmMesh
 * @param stmtId     可选——与 brepChain 配对，缓存 key
 * @returns Shape（三角化 mesh）
 */
export function solidToShape(
  kernel: OcctKernel,
  solid: ShapeHandle,
  segments?: number,
  brepChain?: BrepChainState,
  stmtId?: string,
): Shape {
  const angularDeflection = segments
    ? (2 * Math.PI) / Math.max(3, segments)
    : (2 * Math.PI) / 32 // 默认 32 段精度（与 primitives-brep.ts 一致）
  const mesh: WasmMesh = kernel.meshShape(solid, {
    linearDeflection: 0.1,
    angularDeflection,
  })

  // 规则 1：缓存完整 WasmMesh（含 faceGroups），供 buildBrepTopology 复用
  if (brepChain?.meshShapeCache && stmtId) {
    brepChain.meshShapeCache.set(stmtId, mesh)
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
  kernel: OcctKernel,
  solid: ShapeHandle,
  offset: Vec3,
): ShapeHandle {
  return kernel.translate(solid, offset[0], offset[1], offset[2])
}

/**
 * BREP 旋转：使用 OCCT transform（3x4 仿射矩阵）。
 *
 * 与 mesh 路径 rotate(shape, anglesDeg, pivot?) 一致：
 * - anglesDeg 为 XYZ 欧拉角（角度制）
 * - pivot 为旋转中心（可选，默认原点）
 *
 * @param kernel    OCCT 内核
 * @param solid     输入实体
 * @param anglesDeg XYZ 欧拉角（角度制）
 * @param pivot     旋转中心（可选）
 * @returns 新实体
 */
export function rotateBrep(
  kernel: OcctKernel,
  solid: ShapeHandle,
  anglesDeg: Vec3,
  pivot?: Vec3,
): ShapeHandle {
  const euler = new THREE.Euler(
    (anglesDeg[0] * Math.PI) / 180,
    (anglesDeg[1] * Math.PI) / 180,
    (anglesDeg[2] * Math.PI) / 180,
  )
  const matrix = new THREE.Matrix4().makeRotationFromEuler(euler)
  if (pivot) {
    matrix.premultiply(new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]))
    matrix.multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
  }
  return kernel.transform(solid, matrixToArray(matrix))
}

/**
 * BREP 缩放：使用 OCCT transform（3x4 仿射矩阵）。
 *
 * 与 mesh 路径 scale(shape, factor) 一致：
 * - factor 为 number（均匀缩放）或 Vec3 [sx, sy, sz]（非均匀）
 *
 * @param kernel  OCCT 内核
 * @param solid   输入实体
 * @param factor  缩放因子
 * @returns 新实体
 */
export function scaleBrep(
  kernel: OcctKernel,
  solid: ShapeHandle,
  factor: number | Vec3,
): ShapeHandle {
  const f = typeof factor === 'number' ? [factor, factor, factor] : factor
  const matrix = new THREE.Matrix4().makeScale(f[0], f[1], f[2])
  const isUniform = f[0] === f[1] && f[1] === f[2]
  // OCCT gp_Trsf (kernel.transform) only supports uniform scaling.
  // Non-uniform scaling requires gp_GTrsf (kernel.generalTransform).
  if (isUniform) {
    return kernel.transform(solid, matrixToArray(matrix))
  }
  return kernel.generalTransform(solid, matrixToArray(matrix))
}

// ─── 装配变换 ───

/**
 * BREP 版 applyTransform：与 mesh ops/assemble.ts 的 applyTransform 同语义（绕 pivot 旋转 + 平移）。
 *
 * 数学公式：p' = R·(p − pivot) + pivot + translation
 * 等价 Matrix4 = T(pivot) · R · T(−pivot) · T(translation)
 *
 * 用四元数而非欧拉角，是因为装配变换源是 solveFaceMate 的四元数；
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
  kernel: OcctKernel,
  solid: ShapeHandle,
  quaternion: [number, number, number, number],
  pivot: [number, number, number],
  translation: [number, number, number],
): ShapeHandle {
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
  kernel: OcctKernel,
  a: ShapeHandle,
  b: ShapeHandle,
): ShapeHandle {
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
  kernel: OcctKernel,
  a: ShapeHandle,
  b: ShapeHandle,
): ShapeHandle {
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
  kernel: OcctKernel,
  a: ShapeHandle,
  b: ShapeHandle,
): ShapeHandle {
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
export function drillBrep(
  kernel: OcctKernel,
  solid: ShapeHandle,
  params: DrillBrepParams,
): ShapeHandle {
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

  if (params.depth === 0) {
    // 通孔：与 mesh 路径一致（slab-method bbox 求交 + 0.2 余量）
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

  // OCCT makeCylinder 创建 Z 轴方向的圆柱体（从 Z=0 到 Z=height）
  // 需要将圆柱体旋转到钻孔方向，并平移到孔中心
  const cylinder = kernel.makeCylinder(radius, holeHeight)

  // 计算从 Z 轴到 direction 的旋转
  const zAxis = new THREE.Vector3(0, 0, 1)
  const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, direction)
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat)

  // 平移矩阵：到孔中心，并减去 height/2（因为圆柱从 Z=0 开始）
  const transMatrix = new THREE.Matrix4().makeTranslation(
    holeCenter.x,
    holeCenter.y,
    holeCenter.z,
  )
  // 组合：先旋转，再平移
  const finalMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)
  // 还需要补偿圆柱的起始位置（从 Z=0 开始 → 需要先下移 height/2）
  const offsetMatrix = new THREE.Matrix4().makeTranslation(0, 0, -holeHeight / 2)
  const fullMatrix = new THREE.Matrix4().multiplyMatrices(finalMatrix, offsetMatrix)

  const toolSolid = kernel.transform(cylinder, matrixToArray(fullMatrix))
  kernel.release(cylinder)

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
  /** 切割平面原点偏移（法线方向上的距离） */
  originOffset: number
  /** 切割平面中心点 */
  planeCenter: Vec3
}

/** splitBrep 的结果 */
export interface SplitBrepResult {
  /** 法线正方向的半部分 */
  front: ShapeHandle
  /** 法线负方向的半部分 */
  back: ShapeHandle
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
  kernel: OcctKernel,
  solid: ShapeHandle,
  params: SplitBrepParams,
): SplitBrepResult {
  const bbox = getSolidBoundingBox(kernel, solid)
  const bboxSize = new THREE.Vector3(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  )
  const bboxMax = Math.max(bboxSize.x, bboxSize.y, bboxSize.z)
  const bboxCenter = new THREE.Vector3(
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  )

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

  // 计算切割平面的世界坐标原点
  const planeOrigin = params.planeCenter
    ? new THREE.Vector3(...params.planeCenter)
    : bboxCenter.clone().add(normal.clone().multiplyScalar(params.originOffset))

  const transMatrix = new THREE.Matrix4().makeTranslation(
    planeOrigin.x,
    planeOrigin.y,
    planeOrigin.z,
  )
  const finalMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)

  const halfSpaceBox = kernel.transform(localBox, matrixToArray(finalMatrix))
  kernel.release(localBox)

  try {
    const front = kernel.common(solid, halfSpaceBox)
    const back = kernel.cut(solid, halfSpaceBox)
    kernel.release(halfSpaceBox)
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
  /** 平面原点偏移 */
  originOffset: number
  /** 拉伸长度 */
  length: number
  /** 拉伸模式 */
  mode?: 'centered' | 'forward' | 'backward'
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
  kernel: OcctKernel,
  solid: ShapeHandle,
  params: ExtrudeBrepParams,
): ShapeHandle {
  const mode = params.mode ?? 'centered'
  const normal = new THREE.Vector3(...params.normal).normalize()
  const length = params.length

  // 1. 创建切割平面盒子
  const bbox = getSolidBoundingBox(kernel, solid)
  const bboxCenter = new THREE.Vector3(
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  )
  const planeOrigin = bboxCenter.clone().add(normal.clone().multiplyScalar(params.originOffset))

  // 2. 分割实体
  const splitResult = splitBrep(kernel, solid, {
    normal: [normal.x, normal.y, normal.z],
    originOffset: params.originOffset,
    planeCenter: [planeOrigin.x, planeOrigin.y, planeOrigin.z],
  })

  // 3. 获取截面
  // 使用 section 获取切割平面与实体的交线
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

  // 获取截面边
  const sectionEdges = kernel.section(solid, planeFace)
  kernel.release(planeFace)

  // 4. 构建截面 wire → face → 拉伸
  let extrudedSolid: ShapeHandle
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

  // 5. 计算各段位置
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

  // 6. Fuse 三段
  let result: ShapeHandle
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
 * BREP-native STEP 导入：使用 OCCT kernel.importStep 导入 STEP 文件为精确实体。
 *
 * 与 mesh 路径（cad-core/io.ts importFile → loadFormat → meshes）对照：
 * - mesh 路径：STEP → 三角网格，丢弃 OCCT ShapeHandle
 * - BREP 路径：STEP → kernel.importStep → 保留 ShapeHandle，同时三角化为显示 mesh
 *
 * 导入的 solid 存入 brepChain.solidCache，后续操作（drillBrep/splitBrep 等）
 * 将其作为"基座特征"进行精确运算。
 *
 * **设计决策（I5 不准合并）**：
 * - 单 solid STEP：`importStep` 返回 Compound 包裹（顶层是 `TopoDS_Compound`，
 *   内含 1 个 `TopoDS_Solid`）。此处**解包**返回真实 Solid（`solids[0]`），
 *   下游 `isValid`/编辑/导出都针对真实实体。
 * - 多 solid STEP：返回顶层 Compound **不 fuse**。`meshShape(compound)` 整体显示，
 *   导出时 Compound 仍含全部 solid（非三角化）。逐 part 编辑由 Phase 1 XCAF 负责。
 * - **不调用 `kernel.isValid`**：`importStep` 对单 solid STEP 也返回 Compound 包裹，
 *   `isValid(compound)` 返回 false（Compound 不是 Solid），这会误杀合法 STEP。
 *   合法性判据改为 `getSubShapes(top, 'solid').length >= 1`（含 ≥1 个 solid 即合法），
 *   与装配路径 `walkLabel` 一致。
 *
 * @param kernel  已初始化的 OCCT 内核
 * @param buffer  STEP 文件原始字节（文本编码的 ArrayBuffer）
 * @returns { solid: OCCT 实体句柄, shape: 显示用三角网格 }
 */
export function loadBrep(
  kernel: OcctKernel,
  buffer: ArrayBuffer,
  brepChain?: BrepChainState,
  stmtId?: string,
): { solid: ShapeHandle; shape: Shape } {
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
    kernel.release(top)
    throw new Error(
      `[loadBrep] imported shape contains no solid sub-shapes ` +
      `(solidCount=0) — wireframe/surface/invalid shapes are not supported`
    )
  }

  // 单 solid：解包返回真实 Solid（非 Compound 包裹）
  if (solids.length === 1) {
    const realSolid = solids[0]
    kernel.release(top) // 释放 Compound 包裹，realSolid 独立持有
    const shape = solidToShape(kernel, realSolid, undefined, brepChain, stmtId)
    return { solid: realSolid, shape }
  }

  // 多 solid：保留 Compound 不合并（I5），逐 part 编辑由 Phase 1 XCAF 负责
  // 释放提取的子形句柄（它们是 top 的子引用，top 本身持有几何）
  for (const s of solids) {
    try { kernel.release(s) } catch { /* already released */ }
  }
  const shape = solidToShape(kernel, top, undefined, brepChain, stmtId)
  return { solid: top, shape }
}

// ─── 辅助函数 ───

/**
 * 将 THREE.Matrix4 转换为 OCCT transform 所需的 3x4 row-major 数组（12 doubles）。
 *
 * OCCT transform 接受 [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz] 格式。
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
