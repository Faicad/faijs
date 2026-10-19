/**
 * api shell — 抽壳：按面移除生成等厚薄壁（手写中立 op，Phase 5）
 *
 * 中立 op：L1 `shell(solid, facesToRemove, thickness, tolerance)` 在 occt 与
 * brepkit 两侧均有真实现（engine-method-map 实测 `dialect`）⇒ 走 `getBrepApi()`
 * （D12），不声明 engines（中立 op：实现只经 L1 契约面）。相对现状是
 * 覆盖面扩大——旧版是 occt 平台 op（arg-spec `engines:['occt']`，skip）。
 *
 * 选面口径（设计原则 4）：`openFaces: FaceTopoRef[]`（`cad.faceRef` 产物），
 * 与 `fillet` 的 `EdgeTopoRef[]` / `extrude` 的 `upTo` 同族；不复刻旧
 * `Face[]` 句柄入参。解析在 op 内一处完成（`buildEdgeResolutionContext` 现场枚举
 * + `resolveTopoRef`）。
 *
 * 网格链（方案 2026-10-01 §4 Phase 4 / B3 批）：`mesh:` 实现走网格后端，面按
 * **序号或 FaceTopoRef** 解析（近似拓扑没有 role 层），产物是新的网格零件。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { shellWithHashEvolution } from '../brep/face-evolution'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import { hasNativeHistory } from '../brep/engine/native-history'
import type { FaceTopoRef } from '../topology/naming'
import { resolveTopoRef, TopoRefError } from '../topology/naming'
import type { Provenance } from '../topology/naming/lineage'
import { buildEdgeResolutionContext } from './topo-resolve'
import { meshKernelFailure, meshSolidBasicEntry, meshSolidProduct, resolveMeshFaces } from './internal/mesh-solid-op'
import { resolveSelectorToFaceRefs } from './selectors-to-refs'

/**
 * 抽壳时移除的面选择器：精度链用 `FaceTopoRef`（UI 拾取产物）或 CadQuery 面选择器
 * 字符串（AI 生成，如 `">Z"` / `"|Z"` / `"%PLANE"`）；网格链也可用 1 起序号。
 */
export type ShellFaceSelector = number | FaceTopoRef | string

/** `cad.shell` 参数。 */
export interface ShellParams {
  /** 抽壳时移除的面：面选择器字符串（`">Z"` 等）、或 FaceTopoRef/序号/选择器字符串数组（空数组 = 全封闭薄壁）。 */
  openFaces: ShellFaceSelector[] | string
  /** 壁厚（mm，>0，向内偏置）。 */
  thickness: number
  /** 容差（mm，可选；默认走内核约定值）。 */
  tolerance?: number
}

/** 参数共校验（两条路径共用；`openFaces` 为空数组合法 = 全封闭薄壁）。 */
function assertShellParams(params: ShellParams): void {
  const { openFaces, thickness } = params ?? ({} as ShellParams)
  const openFacesOk =
    typeof openFaces === 'string' ||
    (Array.isArray(openFaces) &&
      openFaces.every(
        (s) =>
          typeof s === 'string' ||
          typeof s === 'number' ||
          (!!s && typeof s === 'object' && (s as { kind?: unknown }).kind === 'face'),
      ))
  if (!openFacesOk) {
    throw new Error(
      'E_SHELL_BAD_OPEN_FACES: shell.openFaces must be a face selector string, or an array of FaceTopoRef / ordinal / selector string',
    )
  }
  if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
    throw new Error('E_SHELL_BAD_THICKNESS: shell.thickness must be a positive number')
  }
}

/**
 * 展开 `openFaces` 到 `FaceTopoRef` 列表（BREP 路径）：选择器字符串 → 桥解析；
 * `FaceTopoRef` 原样保留；**序号在精度链抛错**（BREP 面身份是 `(origin, role)`，
 * 序号只是本次枚举序，见 shellBrep 原注释）。
 */
function expandShellFaceRefs(input: Shape, openFaces: ShellFaceSelector[] | string): FaceTopoRef[] {
  if (typeof openFaces === 'string') return resolveSelectorToFaceRefs(input, openFaces)
  return openFaces.flatMap((sel) => {
    if (typeof sel === 'string') return resolveSelectorToFaceRefs(input, sel)
    if (typeof sel === 'number') {
      throw new Error(
        'E_SHELL_BAD_OPEN_FACES: an ordinal face selector is only available on the mesh chain — ' +
          'a precision-chain face is identified by its role line (cad.faceRef) or a selector string',
      )
    }
    if (!sel || (sel as { kind?: unknown }).kind !== 'face') {
      throw new Error('E_SHELL_BAD_OPEN_FACES: every openFaces entry must be a FaceTopoRef (cad.faceRef) or a selector string')
    }
    return [sel]
  })
}

/** BREP 路径：解析面引用 → L1 shell → 收养。 */
function shellBrep(input: Shape, params: ShellParams): Shape {
  const { openFaces, thickness, tolerance } = params
  assertShellParams(params)
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (solid === undefined) throw new Error('E_SHELL_NO_BREP: shell input is not BREP')

  const ctx = buildEdgeResolutionContext(kernel, input as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'shell: input has no BREP naming context')
  const faceHandles = expandShellFaceRefs(input, openFaces).map((ref) => {
    const r = resolveTopoRef(ref, ctx)
    if (r.handle === undefined) {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `shell: face resolved without handle (${ref.origin}/${ref.role})`)
    }
    return r.handle as BrepHandle
  })

  // C5 实现面接入（静态双轨，无运行时 try-catch）：
  // - occt 原生有 `shellWithHistory` → 走权威面演化（血缘更准）；
  // - brepkit 没有 → 显式回退裸 L1 `shell`（**不报错**），不伪造面演化
  //   （抽壳是毁面重造，恒等映射不真实）。
  if (hasNativeHistory('shellWithHistory')) {
    const r = shellWithHashEvolution(kernel, solid, faceHandles, thickness, tolerance ?? 1e-6)
    return fromBrep(solidToShape(kernel, r.result), { solid: r.result, faceEvolution: r.faceEvolution })
  }
  const result = kernel.shell(solid, faceHandles, thickness, tolerance ?? 1e-6)
  return fromBrep(solidToShape(kernel, result), { solid: result })
}

/**
 * 网格实体路径：按序号或几何选出要开口的面，交网格后端抽壳。
 *
 * 与 BREP 路径同一条 L1 契约面（`shell(solid, faces, thickness, tolerance)`），
 * 差别只在选面方式：近似拓扑没有 role 层，面靠**序号**（拓扑 `faces` 数组下标 + 1）
 * 或 `FaceTopoRef` 的几何匹配（法向/中心/面积）指认。产物是新网格零件，
 * 近似拓扑由 `meshSolidProduct` 重建。
 *
 * @param input - the mesh-solid input.
 * @param params - the shell parameters.
 * @returns the shelled mesh solid as a new mesh part.
 */
function shellMeshSolid(input: Shape, params: ShellParams): Shape {
  const { openFaces, thickness, tolerance } = params
  assertShellParams(params)
  const entry = meshSolidBasicEntry(input, 'shell')
  // 选择器字符串只服务精度链：网格零件没有 role 层，选择器命中无名实体转
  // TopoRef 必然失败（方案 R1），显式抛错而非静默降级；网格链用 1 起序号。
  if (typeof openFaces === 'string' || openFaces.some((s) => typeof s === 'string')) {
    throw new TopoRefError(
      'E_TOPO_MESH_UNSUPPORTED',
      'face',
      'shell: selector strings are precision-chain only — mesh solids have no role layer (use 1-based face ordinals)',
    )
  }
  const faceHandles = resolveMeshFaces(entry.kernel, input, openFaces as (number | FaceTopoRef)[], 'shell')

  let result: BrepHandle
  try {
    result = entry.kernel.shell(entry.solid, faceHandles, thickness, tolerance ?? 1e-6)
  } catch (cause) {
    throw meshKernelFailure(
      'shell',
      'E_SHELL_FAILED',
      `shell(thickness=${thickness}) removing ${faceHandles.length} face(s)`,
      cause,
    )
  }
  return meshSolidProduct(entry, result)
}

/**
 * 抽壳：移除指定面并把余下面偏置成等厚薄壁。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name shell
 * @note 中立 op：L1 shell 两引擎同实现。`openFaces` 为空数组时生成全封闭薄壁。
 *       精度链按 role 线路选面（TopoRef 字面量或 CadQuery 面选择器字符串）；
 *       **禁止 `cad.faceRef` 序号**——序号跨内核不可移植。网格链没有 role 层，
 *       序号是唯一无歧义的指认方式（仅当前内核快照），选择器字符串只服务精度链。
 * @returns Shape 抽壳后的薄壁体。
 * @param input - 目标几何。type:Shape required:true
 * @param params.openFaces - 要移除的面：面选择器字符串（如 ">Z"，AI 生成）或 FaceTopoRef[]（UI 拾取产物字面量；禁止 cad.faceRef 序号；网格链可用 1 起序号）。type:ShellFaceSelector[]|string required:true
 * @param params.thickness - 壁厚（mm，>0）。type:number required:true
 * @param params.tolerance - 容差（mm）。type:number required:false
 * @example
 * // openFaces 取 UI 拾取产物的 FaceTopoRef 字面量（origin/role 由命名层分配，不手写）；
 * // ❌ 不要用 cad.faceRef 序号——跨内核不可移植
 * const sh = cad.shell(part0, { openFaces: pickedFaces, thickness: 2 })
 * // AI 生成可写 CadQuery 面选择器字符串（"|Z" 法向平行 Z 的面、"top" 命名视图）
 * const sh2 = cad.shell(part0, { openFaces: "|Z", thickness: 2 })
 * // 网格链（3MF mesh-solid）：无 role 层，序号是唯一无歧义指认（仅当前内核快照）
 * const sm = cad.shell(meshPart, { openFaces: [4], thickness: 2 })
 */
export const shell = defineOp({
  meshEngines: ['brepkit'],
  mesh(input: Shape, params: ShellParams) {
    return shellMeshSolid(input, params)
  },
  brep(input: Shape, params: ShellParams) {
    return shellBrep(input, params)
  },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,

  paramDims: {},
})
