/**
 * Functional thread operation — builds a helical screw thread.
 *
 * @platform occt — 本文件 import occt-kernel：螺纹用 `loft`
 * （BRepOffsetAPI_ThruSections）构造，loft 是 occt-only（L1 无，engine-method-map
 * `loft` → occt-only）。守卫①要求平台 import 自证身份；调用方 op（screw）声明
 * `engines: ['occt']`（D11）。
 *
 * 适配自 brepjs `src/operations/threadFns.ts`。
 * 保留文件名和核心算法，适配本项目的 occt-wasm API。
 *
 * occt-wasm 的 `BRepOffsetAPI_MakePipeShell` (sweep) 无法可靠地沿螺旋线扫掠截面，
 * 因此螺纹用 loft（`BRepOffsetAPI_ThruSections`）穿过一系列旋转的齿截面构造。
 * 结果是螺旋螺纹的 *ridge* — 外螺纹 fuse 到螺杆，内螺纹 cut 从孔中减去。
 *
 * 与 brepjs 的差异：
 * - brepjs 用 BlueprintSketcher + line() + wire() 构造截面 → 本项目直接用 kernel.makeLineEdge + kernel.makeWire
 * - brepjs 用 loft() 函数 → 本项目直接用 kernel.loft(wires, isSolid, ruled)
 * - brepjs 用 DisposalScope 管理中间句柄 → 本项目手动 kernel.release
 * - brepjs 用 Result 类型 → 本项目抛出异常
 */

import type { BrepHandle } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import { getOcctKernel, type ShapeHandle } from '../../occt-kernel/occtKernel'
import { getBrepApi } from '../../brep/handle-bridge'

/** 螺纹配置参数。单位 mm，角度由螺距推导。 */
export interface ThreadOptions {
  /** 核心半径（外螺纹）或名义孔半径（内螺纹），在螺纹根部 */
  radius: number
  /** 每圈轴向距离（螺距） */
  pitch: number
  /** 螺纹总长（沿轴）。圈数 = height / pitch */
  height: number
  /** 径向螺纹高度（齿顶 - 齿根）。默认 0.6 * pitch（≈ISO 60° V 型） */
  depth?: number
  /** 齿根处轴向半宽。默认 0.42 * pitch */
  toothHalfWidth?: number
  /**
   * flat 顶宽，给出梯形齿而非尖 V 型。
   * 0（默认）= 尖 V（ISO/UN）；正值 = 梯形齿（Acme/square）。
   * 必须 < toothHalfWidth。
   */
  crest?: number
  /** 每圈截面数 — 越高越平滑但越慢。默认 20 */
  sectionsPerTurn?: number
  /** 左旋。默认 false（右旋） */
  lefthand?: boolean
  /** 齿尖朝向轴心（内螺纹用 cut 从孔中减去时） */
  inward?: boolean
}

/**
 * 通过 loft 旋转齿截面构建螺旋螺纹 ridge。
 *
 * @param kernel  OCCT 内核
 * @param options 螺纹配置
 * @returns 螺纹 ridge solid（BrepHandle）
 *
 * @example 外螺纹（Ø12 螺杆，2.5mm 螺距）:
 * ```ts
 * const ridge = threadBrep(kernel, { radius: 6, pitch: 2.5, height: 7.5 })
 * const rod = kernel.makeCylinder(6.15, 7.5)
 * const result = kernel.fuse(rod, ridge)
 * kernel.release(rod)
 * kernel.release(ridge)
 * ```
 *
 * @example 内螺纹（攻丝 Ø6 孔）:
 * ```ts
 * const ridge = threadBrep(kernel, { radius: 3, pitch: 1, height: 6, inward: true })
 * const result = kernel.cut(boredBlock, ridge)
 * kernel.release(ridge)
 * ```
 */
export function threadBrep(
  kernel: BrepEngineApi,
  options: ThreadOptions,
): BrepHandle {
  const {
    radius,
    pitch,
    height,
    depth = 0.6 * pitch,
    toothHalfWidth = 0.42 * pitch,
    crest = 0,
    sectionsPerTurn = 12,
    lefthand = false,
    inward = false,
  } = options

  // 参数校验
  if (!(radius > 0)) throw new Error('[threadBrep] radius must be > 0')
  if (!(pitch > 0)) throw new Error('[threadBrep] pitch must be > 0')
  if (!(height > 0)) throw new Error('[threadBrep] height must be > 0')
  if (!(depth > 0)) throw new Error('[threadBrep] depth must be > 0')
  if (crest < 0 || crest >= toothHalfWidth) {
    throw new Error('[threadBrep] crest must be >= 0 and < toothHalfWidth')
  }
  if (sectionsPerTurn < 3) {
    throw new Error('[threadBrep] sectionsPerTurn must be >= 3')
  }

  const turns = height / pitch
  const nSec = Math.max(2, Math.round(turns * sectionsPerTurn))
  const sign = lefthand ? -1 : 1
  const apexU = inward ? -depth : depth // 齿顶：外螺纹朝外，内螺纹朝内
  const baseU = inward ? 0.3 : -0.3 // 齿根：略微嵌入配合实体以保证布尔干净
  const a = toothHalfWidth

  // 构建截面序列
  const sections: BrepHandle[] = []
  const intermediateEdges: BrepHandle[] = []

  for (let i = 0; i <= nSec; i++) {
    const th = (sign * i * 2 * Math.PI) / sectionsPerTurn
    const z = (pitch * Math.abs(th)) / (2 * Math.PI)
    const cx = radius * Math.cos(th)
    const cy = radius * Math.sin(th)
    const rx = Math.cos(th)
    const ry = Math.sin(th)

    // 点生成函数：u = 径向偏移，v = 轴向偏移
    const pt = (u: number, v: number) => ({
      x: cx + u * rx,
      y: cy + u * ry,
      z: z + v,
    })

    // V 型齿（crest=0）通过单个顶点闭合；梯形齿（crest>0）给出平顶
    const profile = crest > 0
      ? [pt(baseU, -a), pt(apexU, -crest), pt(apexU, crest), pt(baseU, a)]
      : [pt(baseU, -a), pt(apexU, 0), pt(baseU, a)]

    // 构建边
    const edges: BrepHandle[] = []
    for (let k = 0; k < profile.length; k++) {
      const edge = kernel.makeLineEdge(profile[k], profile[(k + 1) % profile.length])
      edges.push(edge)
      intermediateEdges.push(edge)
    }

    // 构建 wire
    const wire = kernel.makeWire(edges)
    sections.push(wire)
  }

  // Loft（occt-only 平台面，D3）。BrepHandle（branded number）与 occt-wasm
  // ShapeHandle 运行时同构，品牌转换只发生在平台边界。
  const thread = getOcctKernel().loft(sections as unknown as ShapeHandle[], true, true)

  // 释放中间句柄
  for (const w of sections) kernel.release(w)
  for (const e of intermediateEdges) kernel.release(e)

  return thread as unknown as BrepHandle
}


/**
 * compat-op 包装：thread(options) → Result<BrepHandle>。
 * 收敛以 core threadBrep 为准（§5.4：vendored compat op 与 core 版两份收敛为一处）。
 * threadBrep 内部校验抛异常 → 捕获为 Result err（错误码 THREAD_INVALID_ARGS / THREAD_FAILED）。
 */

import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import { ok, err, type Result } from '../../result/result'
import { validationError, kernelError } from '../../result/errors'

const THREAD_PARAMS = { name: 'thread', params: ['options'], formClass: 'B1' as FormClass }

/**
 * compat-op wrapper: thread(options) → Result<BrepHandle>.
 * Converges on core threadBrep (§5.4: vendored compat op and core version merged into one).
 * threadBrep internal validation throws are caught as Result err (codes THREAD_INVALID_ARGS / THREAD_FAILED).
 *
 * @param args - Resolved arguments (thread options).
 * @returns The generated thread solid as a `BrepHandle`.
 */
export function threadBrepOp(...args: unknown[]): Result<BrepHandle> {
  const [options] = resolveArgs(args, THREAD_PARAMS)
  const kernel = getBrepApi()
  try {
    const h = threadBrep(kernel, options as ThreadOptions)
    return ok(h)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    if (raw.startsWith('[threadBrep]')) {
      return err(validationError('THREAD_INVALID_ARGS', raw))
    }
    return err(kernelError('THREAD_FAILED', `Thread generation failed: ${raw}`, e))
  }
}
