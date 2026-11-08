/**
 * api screw — 螺丝创建库函数（creator 函数，无输入）
 *
 * 平台分层（narrowing plan Phase 5，D11）：**平台 op（occt）**——BREP 路径的
 * 螺纹经 `threadBrep`（brep-operations/threadFns.ts）走 occt-only `loft`（D3）→
 * `engines: ['occt']`。mesh 路径（cad.screw）在 auto 模式下正常降级。
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '../mesh/types'
// B3 correction (2026-10-06): no library-face cad aggregate — import the impl from its own module.
import * as meshPrimitives from '../mesh/primitives'
import { solidToShape } from '../brep/brep-ops'
import { threadBrep } from './brep-operations/threadFns'
import { getScrewSpec, threadToPitchMm, SCREW_HEAD_DIMS } from '../primitives/screw/screw-db'
import { parseThreadSpec } from '../primitives/screw/thread-spec'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

/** BREP 路径：threadBrep + fuse 构造精确螺纹螺钉 + 三角化 + fromBrep 登记。 */
async function screwBrep(params: Record<string, unknown>): Promise<Shape> {
  // L1 面（D12）：makeCylinder/translate/fuse/makeCone 等全是 L1；螺纹 loft 在
  // threadFns 内部走 occt 平台面。
  const kernel = getBrepApi()

  const system = params.system as 'metric' | 'imperial'
  const specIdx = params.specIdx as number
  const spec = getScrewSpec(system, specIdx)
  const length = params.length as number
  const head = params.head as 'hex' | 'chc' | 'none'
  const thread = params.thread as 'coarse' | 'fine' | 'custom' | 'none'
  const pitchCustom = params.pitchCustom as number | undefined

  // #13（plan 2026-11-07）：牙型统一——crest（牙顶）= 公称大径、root（牙根）=
  // 公称 − 2×depth（depth = 0.6·P，ISO 60° V 型）。螺杆取 root 半径，螺纹从
  // root 起牙、牙顶到公称 → 大径 = 公称（M6 → Ø6，不再是 nominal+1.2P）。
  const pitch = thread !== 'none' ? threadToPitchMm(system, spec, thread, pitchCustom) : 0
  const threadDepth = 0.6 * pitch
  const shankRadius = pitch > 0 ? spec.dia / 2 - threadDepth : spec.dia / 2

  // 1. 螺杆（圆柱体，居中）
  const shank = kernel.makeCylinder(shankRadius, length)
  const centeredShank = kernel.translate(shank, 0, 0, -length / 2)
  kernel.release(shank)

  let result = centeredShank

  // 2. 螺纹（外螺纹）
  if (thread !== 'none') {
    if (pitch > 0) {
      const threadSolid = threadBrep(kernel, {
        radius: shankRadius,
        pitch,
        depth: threadDepth,
        height: length,
      })
      // threadBrep creates thread from Z=0 to Z=height; center it to match shank
      const centeredThread = kernel.translate(threadSolid, 0, 0, -length / 2)
      kernel.release(threadSolid)
      const fused = kernel.fuse(result, centeredThread)
      kernel.release(result)
      kernel.release(centeredThread)
      result = fused
    }
  }

  // 3. 螺钉头
  if (head === 'hex') {
    // 六棱柱头
    const headHeight = spec.dia * SCREW_HEAD_DIMS.hex.heightFactor
    const headRadius = spec.dia * SCREW_HEAD_DIMS.hex.radiusFactor
    const headSolid = makeHexPrismBrep(kernel, headRadius, headHeight, length / 2)
    const fused = kernel.fuse(result, headSolid)
    kernel.release(result)
    kernel.release(headSolid)
    result = fused
  } else if (head === 'chc') {
    // 沉头（圆锥）
    const headHeight = spec.dia * SCREW_HEAD_DIMS.chc.heightFactor
    const headRadius = spec.dia * SCREW_HEAD_DIMS.chc.radiusFactor
    const cone = kernel.makeCone(headRadius, 0, headHeight)
    const positioned = kernel.translate(cone, 0, 0, length / 2)
    kernel.release(cone)
    const fused = kernel.fuse(result, positioned)
    kernel.release(result)
    kernel.release(positioned)
    result = fused
  }

  return fromBrep(solidToShape(kernel, result), { solid: result })
}

/**
 * 构造六棱柱 BREP solid
 */
function makeHexPrismBrep(
  kernel: BrepEngineApi,
  radius: number,
  height: number,
  zOffset: number,
): BrepHandle {
  // 六边形顶点
  const pts: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (i * 2 * Math.PI) / 6
    pts.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      z: 0,
    })
  }

  // 构建边
  const edges: BrepHandle[] = []
  for (let i = 0; i < 6; i++) {
    const edge = kernel.makeLineEdge(pts[i], pts[(i + 1) % 6])
    edges.push(edge)
  }

  // 构建 wire → face → extrude
  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)
  const extruded = kernel.extrude(face, 0, 0, height)

  // 平移到 zOffset
  const positioned = kernel.translate(extruded, 0, 0, zOffset)

  // 释放中间句柄
  for (const e of edges) kernel.release(e)
  kernel.release(wire)
  kernel.release(face)
  kernel.release(extruded)

  return positioned
}

/**
 * Validate screw parameters: either the descriptive `spec` string or the
 * legacy `system` + `specIdx` pair is required, and `length` must be a finite
 * number.
 * @param params - the raw screw operation parameters.
 */
export function assertScrewParams(params: Record<string, unknown>): void {
  if (typeof params.spec === 'string') {
    // Descriptive path (D1): the spec string is the single source of the
    // thread series — legacy spec selectors and pitch overrides are mutexed.
    const resolved = parseThreadSpec(params.spec)
    if (resolved.system === 'pipe') {
      throw new Error(
        "[api/screw] E_ARG: pipe thread specs ('PT…'/'R…'/'Rc…') are not supported by screw — metric/imperial only.",
      )
    }
    if (params.system !== undefined || params.specIdx !== undefined) {
      throw new Error(
        '[api/screw] E_ARG: `spec` cannot be combined with `system`/`specIdx` — use either the descriptive spec string or the legacy pair, not both.',
      )
    }
    if (params.pitchCustom !== undefined) {
      throw new Error(
        "[api/screw] E_ARG: `spec` cannot be combined with `pitchCustom` — put the pitch in the spec string ('M16×1.5') instead.",
      )
    }
    const thread = params.thread
    if (thread !== undefined && thread !== 'none') {
      throw new Error(
        `[api/screw] E_ARG: \`spec\` cannot be combined with thread:'${String(thread)}' — the spec string is the single source of the thread series; only thread:'none' (unthreaded shank) may accompany it.`,
      )
    }
  } else if (typeof params.system !== 'string' || typeof params.specIdx !== 'number') {
    throw new Error(
      `[api/screw] system (string) and specIdx (number) are required, got system=${JSON.stringify(params.system)}, specIdx=${JSON.stringify(params.specIdx)}`,
    )
  }
  if (typeof params.length !== 'number' || !Number.isFinite(params.length)) {
    throw new Error(`[api/screw] length must be a finite number, got ${JSON.stringify(params.length)}`)
  }
}

/**
 * Descriptive `spec` string → legacy param form (`system`/`specIdx`/`thread`/
 * `pitchCustom`) so both impls run unchanged (plan §3.5: BREP 实现零改动).
 *
 * The spec string is the single source of the thread series: its resolved
 * pitch feeds `thread:'custom'` + `pitchCustom` verbatim (coarse/fine/custom
 * all reduce to the same pitch value). `thread:'none'` keeps the unthreaded
 * shank. No-op when `spec` is absent (legacy path untouched).
 */
function normalizeSpecParams(params: Record<string, unknown>): Record<string, unknown> {
  if (typeof params.spec !== 'string') return params
  const resolved = parseThreadSpec(params.spec)
  if (params.thread === 'none') {
    return { ...params, system: resolved.system, specIdx: resolved.specIdx, thread: 'none' }
  }
  return {
    ...params,
    system: resolved.system,
    specIdx: resolved.specIdx,
    thread: 'custom',
    pitchCustom: resolved.pitch,
  }
}

/**
 * 生成螺丝零件（螺纹 + 头型）。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name screw
 * @returns Shape 螺丝几何，生成独立零件。
 * @param params.system - 制式。type:'metric' | 'imperial' required:true
 * @param params.specIdx - 规格索引（决定公称直径，如 5 → M5、6 → M6）。type:number required:true
 * @param params.spec - 描述性螺纹规格串（推荐，如 'M16'、'M16×1.5'、'1/4"-20'、'M16-6g'）。给出时为规格唯一来源：缺省取粗牙；不可与 system/specIdx/pitchCustom 或 thread（'none' 除外）同给，违者 E_ARG；解析失败 E_THREAD_SPEC（错误信息附最近表项建议，绝不自动应用）。OCR 变体白名单同 `fai_drill` 的 `thread` 参数（NFKC 等价、形近字映射、数字逗号小数、公差等级唯一修复；白名单外显式拒绝）。type:string
 * @param params.thread - 螺纹类型。type:'coarse' | 'fine' | 'custom' | 'none' 默认 'coarse'
 * @param params.length - 螺杆长度（mm）。type:number required:true
 * @param params.head - 头型（hex 六角 / chc 沉头 / none 无头）。type:'hex' | 'chc' | 'none' 默认 'none'
 * @param params.pitchCustom - 自定螺距（thread='custom' 时用）。type:number
 * @param params.nRad - 径向分段数（拓扑参数）。type:number 默认 32
 * @note nRad 是拓扑参数不是渲染参数：mesh 路径直接决定分段数；BREP 路径用精确曲面，nRad 仅作 BREP→mesh 三角化角度提示（angular deflection ≈ 2π/nRad）。.fai.js 默认 32 不输出，非默认才输出以保证可复现。
 * @note pitchCustom 执行层已支持（makeScrew/threadBrep 均读取），codegen 曾不序列化（TODO）；当前已机械输出。
 * @example
 * const s = cad.screw({ spec: 'M16', length: 40 })
 * const s = cad.screw({ spec: 'M16×1.5', length: 40, head: 'hex' })
 * const s = cad.screw({ spec: 'M16', thread: 'none', length: 40 })
 * @example
 * const s = cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex' })
 * const s = cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex', nRad: 64 })
  */
export const screw = defineOp({
  mesh: async (params: Record<string, unknown>) => {
    assertScrewParams(params)
    const p = normalizeSpecParams(params)
    return meshPrimitives.screw({
      system: p.system as 'metric' | 'imperial',
      specIdx: p.specIdx as number,
      thread: p.thread as 'coarse' | 'fine' | 'custom' | 'none',
      pitchCustom: p.pitchCustom as number | undefined,
      length: p.length as number,
      head: p.head as 'hex' | 'chc' | 'none',
      nRad: p.nRad as number | undefined,
    })
  },
  brep: async (params: Record<string, unknown>) => {
    assertScrewParams(params)
    return screwBrep(normalizeSpecParams(params))
  },
  // 平台 op（D11）：螺纹 loft 是 occt-only（threadFns.ts，D3）→ engines 声明。
  engines: ['occt'],
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,

  paramDims: { specIdx: 'plain', length: 'length', pitchCustom: 'length', nRad: 'plain' },
})
