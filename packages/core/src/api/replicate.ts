/**
 * replicate — handwritten overrides for the copy-family ops (keep semantics +
 * replica[k] role tables).
 *
 * @platform occt — 本文件 import occt-kernel（mirrorJoin 走 `mirrorWithHistory`
 * 平台面，D3）。文件级标注满足守卫①（平台 import 自证身份）；文件内的**中立 op**
 * （circularPattern/gridPattern/rectangularPattern/clone 只用 L1 核心面）不声明
 * engines，运行时不拦截——标注只约束平台 import，不改变函数级中立性
 * （与 face-evolution.ts 同口径）。
 *
 * All 9 copy-like ops must NOT consume their input (same as `copy`): each brep
 * body declares `keep(input)` (function-body keep → KeepRegistry → live-shapes),
 * so the source stays a live terminal in both runtime and UI.
 *
 * Two groups:
 * - Multi-replica patterns (circularPattern / gridPattern / rectangularPattern /
 *   mirrorJoin): promoted from generated compatOps to handwritten defineOps that
 *   also build `replica[*]/<inner>` role tables (same treatment as linearPattern,
 *   via the shared buildReplicaRoleTable helper).
 * - Single-copy ops (mirror / clone / transformCopy): thin overrides that keep
 *   the input and delegate to the generated compatOp (borrow/adopt/capabilities/
 *   naming preserved).
 *
 * The generated files stay untouched; overrides win via api-namespace spread
 * (same precedent as cut / split / linearPattern).
 *
 * 平台分层（narrowing plan Phase 5，D11）：
 * - mirrorJoin / mirror：平台 op（依赖 occt-only `mirrorWithHistory`）→
 *   `engines: ['occt']`，不声明 capabilities（能力由平台身份本身界定）。
 * - circularPattern / gridPattern / rectangularPattern / clone：中立 op（实现
 *   只用 L1 核心面）→ capabilities 收窄到真实 L1 名（删除 isNull/iterShapes/
 *   section/translateWithHistory 等 occt-only 虚名，capability-map 实证实现不依赖）。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { getCurrentStmt, keep } from '../runtime-state'
import { fromBrep, brepOf } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { buildReplicaRoleTable, type ReplicaTransform } from './internal/replica-role-table'
import {
  meshKernelFailure,
  meshPatternProduct,
  meshSolidBasicEntry,
  meshSolidProduct,
} from './internal/mesh-solid-op'
// Generated compatOps (delegation targets for the thin single-copy overrides).
// NOTE: transformCopy is NOT a script-face op (arg-spec skip: ComposedTransform
// is not constructible in .fai.js); it stays a TS-library-only re-export.
import {
  mirror as generatedMirror,
  clone as generatedClone,
} from './generated/topology'
/** 镜像面参数（与旧 MirrorOptions 同形；G5 去外部依赖后本地自持）。 */
interface MirrorOptions {
  /** 镜像面法向。默认 [0,0,1]。 */
  normal?: readonly [number, number, number] | { x: number; y: number; z: number }
  /** 镜像面过点。默认 [0,0,0]。 */
  at?: readonly [number, number, number] | { x: number; y: number; z: number }
}

/** Normalize a vector (zero vector → [0,0,1] fallback, same as pattern.ts). */
function norm(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-9) return [0, 0, 1]
  return [v[0] / len, v[1] / len, v[2] / len]
}

function toBrepVec(v: Vec3): BrepVec3 {
  return { x: v[0], y: v[1], z: v[2] }
}

/**
 * `MirrorOptions` 的宽松向量形态（只读元组或 `{x,y,z}`）→ `Vec3`。
 *
 * 生成的 compatOp 自己吃得下这两种形态，网格路径要自己换算，故收在一处。
 *
 * @param v - the loosely typed vector from the op's options.
 * @param fallback - the default vector.
 * @returns the vector as a plain tuple.
 */
function optionVec(
  v: readonly [number, number, number] | { x: number; y: number; z: number } | undefined,
  fallback: Vec3,
): Vec3 {
  if (!v) return fallback
  if (Array.isArray(v)) return [v[0] as number, v[1] as number, v[2] as number]
  const o = v as { x: number; y: number; z: number }
  return [o.x, o.y, o.z]
}

/** Shared prelude: L1 kernel（getBrepApi，D12）+ BREP input handle + output statement id. */
function prelude(input: Shape, tag: string): { kernel: BrepEngineApi; solid: BrepHandle; outStmt: string } {
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error(`[api/${tag}] input is not BREP`)
  return { kernel, solid, outStmt: String(getCurrentStmt()?.id ?? '') }
}

/** Rotate point p around the axis line (point `center`, unit direction `u`) by theta radians. */
function rotateAroundAxis(p: BrepVec3, center: BrepVec3, u: Vec3, theta: number): BrepVec3 {
  const vx = p.x - center.x
  const vy = p.y - center.y
  const vz = p.z - center.z
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const dot = vx * u[0] + vy * u[1] + vz * u[2]
  // u × v
  const cx = u[1] * vz - u[2] * vy
  const cy = u[2] * vx - u[0] * vz
  const cz = u[0] * vy - u[1] * vx
  return {
    x: center.x + vx * cos + cx * sin + u[0] * dot * (1 - cos),
    y: center.y + vy * cos + cy * sin + u[1] * dot * (1 - cos),
    z: center.z + vz * cos + cz * sin + u[2] * dot * (1 - cos),
  }
}

/** Reflect point p across the plane (point `o`, unit normal `n`). Self-inverse. */
function reflectAcrossPlane(p: BrepVec3, o: BrepVec3, n: Vec3): BrepVec3 {
  const d = (p.x - o.x) * n[0] + (p.y - o.y) * n[1] + (p.z - o.z) * n[2]
  return { x: p.x - 2 * d * n[0], y: p.y - 2 * d * n[1], z: p.z - 2 * d * n[2] }
}

// ── circularPattern ─────────────────────────────────────────────────────────

/**
 * 环形阵列：绕 axis 均分 fullAngle（度，缺省 360）复制 count 份（含原位置）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name circularPattern
 * @note BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[k]/<inner>`。
 * @returns Shape 所有副本 fused 后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param axis - 旋转轴方向。type:[x,y,z] required:true
 * @param count - 副本总数（含原位置）。type:number required:true
 * @param fullAngle - 总角度（度，缺省 360）。type:number required:false
 * @param center - 旋转轴上一点（缺省原点）。type:[x,y,z] required:false
 * @example
 * const p = await cad.circularPattern(part0, [0, 0, 1], 6)
 */
export const circularPattern = defineOp({
  meshEngines: ['brepkit'],
  mesh(input: Shape, axis: Vec3, count: number, fullAngle: number = 360, center: Vec3 = [0, 0, 0]) {
    keep(input)
    const entry = meshSolidBasicEntry(input, 'circularPattern')
    const u = norm(axis)
    const step = fullAngle / count
    // 网格链：内核返回 count 份副本（含原位置），融合成一个网格零件；近似拓扑没有
    // role 层，故不产 `replica[k]/<inner>` 命名（如实缺席）。
    return meshPatternProduct(entry, 'circularPattern', 'E_PATTERN_FAILED', () =>
      entry.kernel.circularPattern(entry.solid, toBrepVec(center), toBrepVec(u), step, count),
    )
  },
  brep(input: Shape, axis: Vec3, count: number, fullAngle: number = 360, center: Vec3 = [0, 0, 0]) {
    keep(input)
    const { kernel, solid, outStmt } = prelude(input, 'circularPattern')
    const u = norm(axis)
    const step = fullAngle / count
    const raw = kernel.circularPattern(solid, toBrepVec(center), toBrepVec(u), step, count)

    let resultSolid: BrepHandle
    try {
      resultSolid = kernel.fuseAll(raw)
    } finally {
      for (const c of raw) kernel.release(c)
    }

    const replicas: ReplicaTransform[] = []
    for (let k = 0; k < count; k++) {
      const theta = (-k * step * Math.PI) / 180
      replicas.push({
        label: `replica[${k}]`,
        inverse: (c) => rotateAroundAxis(c, toBrepVec(center), u, theta),
      })
    }
    const roleTable = buildReplicaRoleTable(kernel, input, resultSolid, replicas, outStmt)
    return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid, roleTable })
  },
  // 中立 op（D11）：capabilities 收窄到实现真实调用的 L1 名（删除 isNull/iterShapes/
  // section 等 occt-only 虚名——实现只调 kernel.circularPattern/fuseAll）。
  capabilities: [
    'circularPattern',
    'dispose',
    'fuseAll',
    'hashCode',
    'surfaceCenterOfMass',
    'surfaceNormal',
    'surfaceType',
    'uvBounds',
  ],
  naming: { kind: 'replicate', k: 0 } as Provenance,
})

// ── gridPattern ─────────────────────────────────────────────────────────────

/**
 * 二维栅格阵列：沿 directionX × directionY 复制 countX×countY 份（含原位置）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name gridPattern
 * @note BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[ix_iy]/<inner>`。
 * @returns Shape 全部副本的 compound。
 * @param input - 目标几何。type:Shape required:true
 * @param directionX - 第一方向。type:[x,y,z] required:true
 * @param directionY - 第二方向。type:[x,y,z] required:true
 * @param countX - X 向副本数。type:number required:true
 * @param countY - Y 向副本数。type:number required:true
 * @param spacingX - X 向间距。type:number required:true
 * @param spacingY - Y 向间距。type:number required:true
 * @example
 * const p = await cad.gridPattern(part0, [1, 0, 0], [0, 1, 0], 3, 2, 20, 20)
 */
export const gridPattern = defineOp({
  meshEngines: ['brepkit'],
  mesh(
    input: Shape,
    directionX: Vec3,
    directionY: Vec3,
    countX: number,
    countY: number,
    spacingX: number,
    spacingY: number,
  ) {
    keep(input)
    const entry = meshSolidBasicEntry(input, 'gridPattern')
    const dx = norm(directionX)
    const dy = norm(directionY)
    // 网格链走"逐份平移 + fuseAll"（与 rectangularPattern 同口径），不用内核的
    // `gridPattern`——那支返回**单个 compound 句柄**，近似拓扑无法把 compound 讲成
    // 一个网格零件；逐份平移则得到与线性/环形阵列同形的单一融合实体。
    return meshPatternProduct(entry, 'gridPattern', 'E_PATTERN_FAILED', () => {
      const copies: BrepHandle[] = []
      for (let ix = 0; ix < countX; ix++) {
        for (let iy = 0; iy < countY; iy++) {
          const ox = ix * spacingX
          const oy = iy * spacingY
          copies.push(entry.kernel.translate(
            entry.solid,
            ox * dx[0] + oy * dy[0],
            ox * dx[1] + oy * dy[1],
            ox * dx[2] + oy * dy[2],
          ))
        }
      }
      return copies
    })
  },
  brep(
    input: Shape,
    directionX: Vec3,
    directionY: Vec3,
    countX: number,
    countY: number,
    spacingX: number,
    spacingY: number,
  ) {
    keep(input)
    const { kernel, solid, outStmt } = prelude(input, 'gridPattern')
    const dx = norm(directionX)
    const dy = norm(directionY)
    // kernel.gridPattern 返回 compound 单句柄（含全部副本），无需 fuse。
    const resultSolid = kernel.gridPattern(
      solid,
      toBrepVec(dx),
      toBrepVec(dy),
      spacingX,
      spacingY,
      countX,
      countY,
    )

    const replicas: ReplicaTransform[] = []
    for (let ix = 0; ix < countX; ix++) {
      for (let iy = 0; iy < countY; iy++) {
        const ox = ix * spacingX
        const oy = iy * spacingY
        replicas.push({
          label: `replica[${ix}_${iy}]`,
          inverse: (c) => ({
            x: c.x - (ox * dx[0] + oy * dy[0]),
            y: c.y - (ox * dx[1] + oy * dy[1]),
            z: c.z - (ox * dx[2] + oy * dy[2]),
          }),
        })
      }
    }
    const roleTable = buildReplicaRoleTable(kernel, input, resultSolid, replicas, outStmt)
    return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid, roleTable })
  },
  capabilities: [
    'dispose',
    'fuseAll',
    'gridPattern',
    'hashCode',
    'linearPattern',
    'surfaceCenterOfMass',
    'surfaceNormal',
    'surfaceType',
    'uvBounds',
  ],
  naming: { kind: 'replicate', k: 0 } as Provenance,
})

// ── rectangularPattern ──────────────────────────────────────────────────────

interface RectangularPatternOptions {
  xDir: Vec3
  xCount: number
  xSpacing: number
  yDir: Vec3
  yCount: number
  ySpacing: number
}

/**
 * 矩形阵列：按 options（xDir/xCount/xSpacing/yDir/yCount/ySpacing）复制并 fuse。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name rectangularPattern
 * @note BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[ix_iy]/<inner>`。
 * @returns Shape 所有副本 fused 后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param options - 阵列参数。type:RectangularPatternOptions required:true
 * @example
 * const p = await cad.rectangularPattern(part0, { xDir: [1,0,0], xCount: 3, xSpacing: 20, yDir: [0,1,0], yCount: 2, ySpacing: 15 })
 */
export const rectangularPattern = defineOp({
  meshEngines: ['brepkit'],
  mesh(input: Shape, options: RectangularPatternOptions) {
    keep(input)
    const entry = meshSolidBasicEntry(input, 'rectangularPattern')
    const { xDir, xCount, xSpacing, yDir, yCount, ySpacing } = options
    const dx = norm(xDir)
    const dy = norm(yDir)
    // 与 BREP 路径同一手法（逐份 translate 再 fuseAll），只是句柄来自网格后端。
    return meshPatternProduct(entry, 'rectangularPattern', 'E_PATTERN_FAILED', () => {
      const copies: BrepHandle[] = []
      for (let ix = 0; ix < xCount; ix++) {
        for (let iy = 0; iy < yCount; iy++) {
          const ox = ix * xSpacing
          const oy = iy * ySpacing
          copies.push(entry.kernel.translate(
            entry.solid,
            ox * dx[0] + oy * dy[0],
            ox * dx[1] + oy * dy[1],
            ox * dx[2] + oy * dy[2],
          ))
        }
      }
      return copies
    })
  },
  brep(input: Shape, options: RectangularPatternOptions) {
    keep(input)
    const { kernel, solid, outStmt } = prelude(input, 'rectangularPattern')
    const { xDir, xCount, xSpacing, yDir, yCount, ySpacing } = options
    const dx = norm(xDir)
    const dy = norm(yDir)
// 旧 rectangularPattern 是纯 JS 组合（translate + fuseAll），内核不声明
// 该方法——与旧版同口径：逐份 translate 再 fuseAll。
    const copies: BrepHandle[] = []
    try {
      for (let ix = 0; ix < xCount; ix++) {
        for (let iy = 0; iy < yCount; iy++) {
          const ox = ix * xSpacing
          const oy = iy * ySpacing
          copies.push(kernel.translate(solid, ox * dx[0] + oy * dy[0], ox * dx[1] + oy * dy[1], ox * dx[2] + oy * dy[2]))
        }
      }
      const resultSolid = kernel.fuseAll(copies)

      const replicas: ReplicaTransform[] = []
      for (let ix = 0; ix < xCount; ix++) {
        for (let iy = 0; iy < yCount; iy++) {
          const ox = ix * xSpacing
          const oy = iy * ySpacing
          replicas.push({
            label: `replica[${ix}_${iy}]`,
            inverse: (c) => ({
              x: c.x - (ox * dx[0] + oy * dy[0]),
              y: c.y - (ox * dx[1] + oy * dy[1]),
              z: c.z - (ox * dx[2] + oy * dy[2]),
            }),
          })
        }
      }
      const roleTable = buildReplicaRoleTable(kernel, input, resultSolid, replicas, outStmt)
      return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid, roleTable })
    } finally {
      for (const c of copies) kernel.release(c)
    }
  },
  capabilities: [
    'dispose',
    'fuse',
    'fuseAll',
    'fuseWithHistory',
    'hashCode',
    'surfaceCenterOfMass',
    'surfaceNormal',
    'surfaceType',
    'uvBounds',
  ],
  naming: { kind: 'replicate', k: 0 } as Provenance,
})

// ── mirrorJoin ──────────────────────────────────────────────────────────────

interface MirrorJoinOptions {
  normal?: Vec3
  at?: Vec3
}

/**
 * 镜像并融合：原物（replica[0]）+ 沿平面镜像（replica[1]）fuse 成一体。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name mirrorJoin
 * @note BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[0|1]/<inner>`。
 * @returns Shape fuse 后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param options - { normal?, at? } 镜像面法向与面上一点。type:MirrorJoinOptions required:false
 * @example
 * const p = await cad.mirrorJoin(part0, { normal: [1, 0, 0] })
 */
export const mirrorJoin = defineOp({
  meshEngines: ['brepkit'],
  mesh(input: Shape, options?: MirrorJoinOptions) {
    keep(input)
    const entry = meshSolidBasicEntry(input, 'mirrorJoin')
    const n = norm(optionVec(options?.normal, [1, 0, 0]))
    const o = toBrepVec(optionVec(options?.at, [0, 0, 0]))
    // 输入句柄**不释放**（keep 语义）；只释放本次自造的镜像副本。
    let mirrored: BrepHandle
    try {
      mirrored = entry.kernel.mirror(entry.solid, o, toBrepVec(n))
    } catch (cause) {
      throw meshKernelFailure('mirrorJoin', 'E_MIRROR_FAILED', `mirror across normal [${n.join(', ')}]`, cause)
    }
    try {
      return meshSolidProduct(entry, entry.kernel.fuse(entry.solid, mirrored))
    } catch (cause) {
      throw meshKernelFailure('mirrorJoin', 'E_MIRROR_FAILED', 'fusing the mirrored copy', cause)
    } finally {
      entry.backend.release(mirrored)
    }
  },
  brep(input: Shape, options?: MirrorJoinOptions) {
    keep(input)
    const { kernel, solid, outStmt } = prelude(input, 'mirrorJoin')
    const n = norm(options?.normal ?? [1, 0, 0])
    const o = toBrepVec(options?.at ?? [0, 0, 0])
    // 2026-09-26 C 批降级：原实现直调 getOcctKernel().mirrorWithHistory（occt-only history
    // 镜像，返回 modified/newFaces 供细粒度 roleTable）。按用户指示「有没有历史 withhistory
    // 并不重要」，降级为 L1 kernel.mirror（brepkit 已声明 mirror 能力）——几何结果一致，
    // roleTable 仍由 buildReplicaRoleTable 经质心聚类重建（引擎无关），仅丢失 history 级
    // modified 面映射（不影响几何与产物有效性）。
    const mirrored = kernel.mirror(solid, o, toBrepVec(n))
    try {
      const resultSolid = kernel.fuse(solid, mirrored)

      const replicas: ReplicaTransform[] = [
        { label: 'replica[0]', inverse: (c) => ({ x: c.x, y: c.y, z: c.z }) },
        { label: 'replica[1]', inverse: (c) => reflectAcrossPlane(c, o, n) },
      ]
      const roleTable = buildReplicaRoleTable(kernel, input, resultSolid, replicas, outStmt)
      return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid, roleTable })
    } finally {
      kernel.release(mirrored)
    }
  },
  // 2026-09-26 C 批：从 engines:[occt] 降级为 capabilities:['mirror','fuse']（L1 中立面，
  // brepkit 已声明二者）。history 语义丢失（见上注释），几何不回退。
  capabilities: ['mirror', 'fuse'],
  naming: { kind: 'replicate', k: 2 } as Provenance,
})

// ── single-copy thin overrides（keep + 委托生成 op）─────────────────────────

/**
 * 镜像：返回镜像后的新 Shape（源保留）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name mirror
 * @note BREP-only。keep 语义：不消费输入（薄 override 委托生成 op，行为不变）。
 * @returns Shape 镜像后的新几何。
 * @param input - 目标几何。type:Shape required:true
 * @param options - { normal?, at? } 镜像面。type:MirrorOptions required:false
 * @example
 * const p = await cad.mirror(part0, { normal: [1, 0, 0] })
 */
export const mirror = defineOp({
  meshEngines: ['brepkit'],
  mesh(input: Shape, options?: MirrorOptions) {
    keep(input)
    const entry = meshSolidBasicEntry(input, 'mirror')
    const n = norm(optionVec(options?.normal, [1, 0, 0]))
    const o = toBrepVec(optionVec(options?.at, [0, 0, 0]))
    let result: BrepHandle
    try {
      result = entry.kernel.mirror(entry.solid, o, toBrepVec(n))
    } catch (cause) {
      throw meshKernelFailure('mirror', 'E_MIRROR_FAILED', `mirror across normal [${n.join(', ')}]`, cause)
    }
    return meshSolidProduct(entry, result)
  },
  async brep(input: Shape, options?: MirrorOptions) {
    keep(input)
    return (await generatedMirror(input, options)) as Shape
  },
  // 2026-09-26 B 批：generatedMirror 已降级为 L1 kernel.mirror（brepkit 已声明 mirror
  // 能力），薄 override 同步从 engines:[occt] 降级为 capabilities:['mirror']——
  // 与 clone 薄 override 同模式（外层门不拦 brepkit，内层 generatedMirror 已按能力路由）。
  capabilities: ['mirror'],
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})

/**
 * 深拷贝句柄：返回独立副本（源保留）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name clone
 * @note BREP-only。keep 语义：不消费输入（薄 override 委托生成 op，行为不变）。
 * @returns Shape 克隆的新几何。
 * @param input - 目标几何。type:Shape required:true
 * @example
 * const p = await cad.clone(part0)
 */
export const clone = defineOp({
  meshEngines: ['brepkit'],
  mesh(input: Shape) {
    keep(input)
    const entry = meshSolidBasicEntry(input, 'clone')
    let result: BrepHandle
    try {
      result = entry.kernel.copyShape(entry.solid)
    } catch (cause) {
      throw meshKernelFailure('clone', 'E_CLONE_FAILED', 'copying the mesh solid handle', cause)
    }
    return meshSolidProduct(entry, result)
  },
  async brep(input: Shape) {
    keep(input)
    return (await generatedClone(input)) as Shape
  },
  capabilities: ['copyShape', 'dispose'],
  naming: { kind: 'identity' } as Provenance,
})
