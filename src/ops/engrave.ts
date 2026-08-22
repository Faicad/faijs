/**
 * 雕刻操作分派器
 *
 * BREP 路径：用 textToSolid + boolean（cut/fuse）
 * - 凹文字（concave）：cut(base solid, text solid)
 * - 凸文字（convex）：fuse(base solid, text solid)
 * Mesh 路径：用纹理位移
 */

import type { Shape, Vec3 } from '../mesh/types'
import type { ShapeHandle } from 'occt-wasm'
import { cad } from '../mesh'
import { parseSvgNaturalSize } from '../primitives/parse-svg-size'
import { textToSolid } from '../brep/text/text-to-solid'
import { svgToSolid } from '../brep/svg/svg-to-solid'
import { ensureDefaultFont } from '../brep/text/fontRegistry'
import { solidToShape } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { resolveSvgArg } from './svg-asset-resolver'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 将世界坐标转换为 BREP solid 的局部坐标。
 *
 * BREP solid 在原始坐标系中（无居中偏移），
 * 而 GeomRef 解析出的面中心是世界坐标（含 mesh.position 居中偏移）。
 * localPos = worldPos - mesh.position
 */
function worldToLocalPosition(
  worldPos: Vec3,
  brepChain: { partTransform?: { position: [number, number, number] } } | undefined,
): Vec3 {
  const offset = brepChain?.partTransform?.position
  if (!offset) return worldPos
  return [
    worldPos[0] - offset[0],
    worldPos[1] - offset[1],
    worldPos[2] - offset[2],
  ]
}

/**
 * 计算将 +Z 轴对齐到目标法向量的 3x4 仿射变换矩阵（仅旋转，无平移）。
 *
 * 等价于 THREE.Quaternion().setFromUnitVectors(
 *   new THREE.Vector3(0, 0, 1),
 *   new THREE.Vector3(nx, ny, nz)
 * )
 *
 * 使用 Rodrigues 旋转公式：
 * - 旋转轴 = cross([0,0,1], normal) = [-ny, nx, 0]
 * - 旋转角 = acos(dot([0,0,1], normal)) = acos(nz)
 *
 * OCCT transform 矩阵格式（3x4 row-major）：
 * [r00, r01, r02, tx,
 *  r10, r11, r12, ty,
 *  r20, r21, r22, tz]
 */
function alignZToNormal(normal: Vec3): number[] {
  const [nx, ny, nz] = normal
  // 归一化
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (len < 1e-10) {
    // 法向量退化，返回单位矩阵
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
  }
  const ux = nx / len, uy = ny / len, uz = nz / len

  // 如果已经与 +Z 同向，返回单位矩阵
  if (Math.abs(ux) < 1e-10 && Math.abs(uy) < 1e-10) {
    if (uz > 0) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
    // 反向：绕 X 轴旋转 180°
    return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0]
  }

  // Rodrigues 公式参数
  // 轴 = [-uy, ux, 0]（已归一化，因为 |cross|=sin(angle) 且 |normal|=1）
  const s = Math.sqrt(ux * ux + uy * uy) // sin(angle)
  const c = uz                              // cos(angle) = dot([0,0,1], normal)
  const t = 1 - c

  // 归一化旋转轴
  const ax = -uy / s, ay = ux / s // az = 0

  // R = cos*I + sin*[axis]_x + (1-cos)*axis⊗axis
  // 由于 az=0，矩阵简化为：
  // [c+ax²t,   ax*ay*t,  ay*s,
  //  ax*ay*t,  c+ay²t,   -ax*s,
  //  -ay*s,    ax*s,     c]
  return [
    c + ax * ax * t,  ax * ay * t,    ay * s,  0,
    ax * ay * t,      c + ay * ay * t, -ax * s, 0,
    -ay * s,          ax * s,          c,       0,
  ]
}

/**
 * 将 solid 居中到原点（基于包围盒中心）。
 *
 * 与 mesh 路径的 `geo.translate(-center.x, -center.y, -center.z)` 语义一致。
 */
function centerSolidAtOrigin(kernel: import('occt-wasm').OcctKernel, solid: ShapeHandle): ShapeHandle {
  const bb = getSolidBoundingBox(kernel, solid)
  const cx = (bb.min[0] + bb.max[0]) / 2
  const cy = (bb.min[1] + bb.max[1]) / 2
  const cz = (bb.min[2] + bb.max[2]) / 2
  const centered = kernel.translate(solid, -cx, -cy, -cz)
  kernel.release(solid)
  return centered
}

/**
 * 执行雕刻操作
 */
export async function executeEngrave(ctx: OpContext): Promise<Shape> {
  const { stmt, inputGeometries, args, ports } = ctx

  // 解析 SVG 资产引用（AssetRef → SVG 文本），如有
  const svgText = args.svg !== undefined && args.svg !== null
    ? await resolveSvgArg(args.svg, ports)
    : undefined

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    if (inputGeometries.length === 0) {
      throw new Error(`[ExecutionValidator] engrave statement "${stmt.id}" has no input geometry`)
    }
    const shape = inputGeometries[0]

    // 面中心/法向：优先从语句 args 读取（UI 路径记录的真实面信息）
    const faceCenter: Vec3 = (args.faceCenter as Vec3) ?? [0, 0, 0]
    const faceNormal: Vec3 = (args.faceNormal as Vec3) ?? [0, 0, 1]

    // SVG 雕刻：与 BREP 路径一致，解析 SVG 自然尺寸后缩放
    const { naturalWidth, naturalHeight } = svgText ? parseSvgNaturalSize(svgText) : { naturalWidth: 0, naturalHeight: 0 }

    // 分支判定：有 text → text 分支；有 svg → logo 分支
    const hasText = !!(args.text as string | undefined)

    return cad.engrave(shape, {
      mode: (args.mode as 'convex' | 'concave' | undefined) ?? 'concave',
      depth: args.depth as number,
      face: { center: faceCenter, normal: faceNormal },
      text: hasText ? (args.text as string) : undefined,
      textSize: args.textSize as number | undefined,
      svg: svgText,
      svgNaturalWidth: naturalWidth,
      svgNaturalHeight: naturalHeight,
      svgSize: args.svgSize as number | undefined,
    })
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeEngraveBrep(ctx, svgText)
}

/**
 * BREP 路径：用 textToSolid/svgToSolid + boolean（cut/fuse）
 *
 * 与 mesh 路径（mesh/engrave.ts）完全一致的位置算法：
 * 1. 生成装饰 solid（depth = 雕刻深度，与 mesh 一致）
 * 2. 居中到原点（包围盒中心 → 原点）
 * 3. 旋转 +Z 对齐面法向（alignZToNormal）
 * 4. 沿法向偏移 depth/2（凸=外，凹=内）
 * 5. 平移到面中心
 * 6. 布尔运算（凸=fuse，凹=cut）
 *
 * - 文字雕刻（有 text）：textToSolid → boolean
 * - SVG/logo 雕刻（有 svg）：svgToSolid → boolean
 */
async function executeEngraveBrep(ctx: OpContext, svgText?: string): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeEngrave] no kernel')

  const kernel = brepChain.kernel
  const depth = args.depth as number
  const mode = (args.mode as 'convex' | 'concave' | undefined) ?? 'concave'
  const text = args.text as string | undefined

  // 获取上游 solid
  const baseSolid = brepChain.solidCache.get(stmt.inputs[0])
  if (!baseSolid) {
    throw new Error('[executeEngrave] no upstream solid')
  }

  // 1. 创建装饰 solid（文字或 SVG），depth 与 mesh 路径一致
  let decorationSolid: ShapeHandle
  if (text) {
    // 文字雕刻
    await ensureDefaultFont()
    const textSize = (args.textSize as number) ?? 16
    decorationSolid = textToSolid(kernel, text, {
      fontSize: textSize,
      depth,
    })
  } else if (svgText) {
    // SVG/logo 雕刻
    decorationSolid = svgToSolid(kernel, svgText, {
      depth,
      targetLongSide: (args.svgSize as number) ?? 20,
    })
  } else {
    throw new Error('[executeEngraveBrep] neither text nor svg provided')
  }

  // 2. 居中到原点（与 mesh 路径 geo.translate(-center.x, -center.y, -center.z) 一致）
  decorationSolid = centerSolidAtOrigin(kernel, decorationSolid)

  // 3. 旋转 +Z 对齐面法向（与 mesh 路径 setFromUnitVectors([0,0,1], faceNormal) 一致）
  const worldFaceNormal: Vec3 = (args.faceNormal as Vec3) ?? [0, 0, 1]
  const rotMatrix = alignZToNormal(worldFaceNormal)
  const rotated = kernel.transform(decorationSolid, rotMatrix)
  kernel.release(decorationSolid)

  // 4. 沿法向偏移 + 平移到面中心
  //    凸（convex）：offset = +depth/2（装饰体在面上方）
  //    凹（concave）：offset = -depth/2（装饰体在面下方）
  //    注意：添加微小 Z 偏移（0.01）以避免与圆柱体顶面共面，
  //    OCCT WASM 的 cut 操作在面完全共面时可能返回空 compound。
  const worldFaceCenter: Vec3 = (args.faceCenter as Vec3) ?? [0, 0, 0]
  const localFaceCenter = worldToLocalPosition(worldFaceCenter, brepChain)
  const offset = mode === 'convex' ? depth / 2 : -depth / 2
  const epsilon = 0.01
  const tx = localFaceCenter[0] + worldFaceNormal[0] * (offset + epsilon)
  const ty = localFaceCenter[1] + worldFaceNormal[1] * (offset + epsilon)
  const tz = localFaceCenter[2] + worldFaceNormal[2] * (offset + epsilon)
  const positioned = kernel.translate(rotated, tx, ty, tz)
  kernel.release(rotated)

  // 5. 布尔运算
  const isRaised = mode === 'convex'
  let result: ShapeHandle
  if (isRaised) {
    result = kernel.fuse(baseSolid, positioned)  // 凸文字/logo
  } else {
    result = kernel.cut(baseSolid, positioned)   // 凹文字/logo
  }
  kernel.release(positioned)

  // 5b. cut 可能将模型分裂成多个 solid（compound），
  //     浏览器 WASM 中 getBoundingBox 对 compound 可能失败。
  //     如果结果是 compound，用 fuseAll 合并回单一 solid。
  try {
    const subSolids = kernel.getSubShapes(result, 'solid')
    if (subSolids.length > 1) {
      const fused = kernel.fuseAll(subSolids)
      // 释放子 solid 和原 compound
      for (const s of subSolids) {
        try { kernel.release(s) } catch { /* OCCT 句柄二次释放防御：已释放的句柄再次 release 会抛异常，此处安全吞掉 */ }
      }
      try { kernel.release(result) } catch { /* OCCT 句柄二次释放防御 */ }
      result = fused
    }
  } catch (subShapesErr) {
    // getSubShapes 失败说明结果不是 compound，无需处理
    // 但必须上报此异常以便发现潜在问题
    console.error('[executeEngraveBrep] getSubShapes failed (result may not be a compound), continuing with single solid:', subShapesErr)
  }

  brepChain.solidCache.set(stmt.id, result)
  return solidToShape(kernel, result, undefined, brepChain, stmt.id)
}
