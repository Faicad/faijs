/**
 * faijs-extra drill — 钻孔库函数
 *
 * 坐标契约（unit-system §5.2，方向 A：position 契约自包含）：**所有几何参数
 * （position / faceNormal / diameter / depth）一律是模型局部空间的值**——
 * 宿主在生成脚本时负责把交互世界坐标转换为局部坐标（local = (world − position)/scale）；
 * 本 op 不做任何 world→local 转换、不读取 partTransform。同一脚本在任何入口
 * （交互式 / 容器重放 / 手写）重放结果一致。
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import { drill as meshDrill } from '../mesh/fai_drill'
import {
  buildDrillToolSolid,
  computeDrillGeometry,
  solidToShape,
  matrixToArray,
} from '../../brep/brep-ops'
import { drillBrepWithRoleTable, getFaceHashes } from '../../brep/face-evolution'
import { threadBrep } from '../../api/brep-operations/threadFns'
import { getScrewSpec, getPipeSpec, threadToPitchMm } from '../../primitives/screw/screw-db'
import type { ThreadSystem } from '../../primitives/screw/screw-db'
import { Vec3 as Vec3C, Mat4, Quat } from '../../math3d'
import { getCurrentStmt } from '../../runtime-state'
import { getBrepApi } from '../../brep/handle-bridge'
import { fromBrep, brepOf, inputRoleTable, resolveCompoundMember, replaceCompoundMember } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import type { BrepHandle } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import { assertPositiveNumber, assertNumber, assertVec3 } from '../../api/assert'
import { captureFaceHint, type FaceTopoRef } from '../../topology/naming'
import { resolveFaceGeometry } from '../../api/topo-resolve'
import { appendPmiItem } from '../../api/pmi/methods'
import { threadHole as makeThreadHole } from '../../api/pmi/types'
import type { PmiThreadHole } from '../../api/pmi/types'
import { formatThreadHole } from '../../api/pmi/text'

// ── per-op 参数自校验（Phase 2.2；op 被直接 import 时的防御层） ──

/**
 * Validate drill parameters: `diameter` must be a positive number, `position`
 * (if provided) a vec3, and `depth` (if provided) a number (<= 0 means a through hole).
 * @param params - the raw drill operation parameters.
 */
export function assertDrillParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.diameter, 'drill.diameter')
  if (params.position !== undefined && params.position !== null) {
    assertVec3(params.position, 'drill.position')
  }
  if (params.depth !== undefined && params.depth !== null) {
    assertNumber(params.depth, 'drill.depth')
  }
}

/** 解析 direction 枚举 → 名义方向向量（`'normal'` 即面外法向，未定号）。 */
function resolveDirection(params: Record<string, unknown>, faceNormal: Vec3): Vec3 {
  const directionEnum = (params.direction as string | undefined) ?? 'normal'
  if (directionEnum === 'normal') return faceNormal
  if (directionEnum === 'x') return [-1, 0, 0]
  if (directionEnum === 'y') return [0, -1, 0]
  if (directionEnum === 'z') return [0, 0, -1]
  return faceNormal
}

/**
 * 实际钻孔方向：把名义方向按「朝向材料内部」规则定号。
 *
 * `direction: 'normal'` 返回的是**面外法向**（指向空腔），而孔是往材料里钻的；
 * 几何链（`computeDrillGeometry` / `resolveDrillDirection`）内部会再看
 * `dir·faceNormal > 0` 取反。PMI 必须记同一支向量——否则标注说"孔朝外"、
 * 几何却朝内（例：沉孔底面向下取面法向 + `'normal'`，几何向上钻进法兰，
 * PMI 却记成朝下）。`PmiThreadHole.axis.direction` 的契约是**钻孔方向**，
 * 见 `fai-drill-tapped.test.ts` 的 `axis.direction === [0,0,-1]` 断言。
 *
 * @param direction - 名义方向（`resolveDirection` 的结果）。
 * @param faceNormal - 面外法向。
 * @returns 指向材料内部的单位方向（未归一化，与几何链同一支向量）。
 */
function inwardDirection(direction: Vec3, faceNormal: Vec3): Vec3 {
  const dot = direction[0] * faceNormal[0] + direction[1] * faceNormal[1] + direction[2] * faceNormal[2]
  const sign = dot > 0 ? -1 : 1
  // 逐轴乘号而不是整体取负：`0 * -1 = -0`，而 vitest 的 toEqual 区分 ±0，
  // `[-0,-0,-1]` 会让调用方的 `toEqual([0,0,-1])` 失败。
  const x = direction[0] === 0 ? 0 : direction[0] * sign
  const y = direction[1] === 0 ? 0 : direction[1] * sign
  const z = direction[2] === 0 ? 0 : direction[2] * sign
  return [x, y, z]
}

/**
 * 面法向派生（§6.2）：钻孔轴向是「点击点的真实面法向」——曲面（圆柱面等）上
 * 仅凭 FaceTopoRef 的单一 hint 法向无法还原点击点的径向方向（引擎无 点→曲面
 * 投影 API），故轴向优先使用宿主捕获的 `faceNormal` 快照（与 position 同为点击
 * 快照）；`face: FaceTopoRef` 作为持久化身份引用（跨重放追踪），仅在无
 * `faceNormal` 的历史/手写脚本时才按其派生的法向兜底。
 *
 * @param input - the target geometry (used to resolve the face ref).
 * @param params - raw drill params.
 * @returns the face normal the drill axis uses.
 */
function faceNormalFrom(input: Shape, params: Record<string, unknown>): Vec3 {
  const faceNormal = params.faceNormal as Vec3 | undefined
  if (faceNormal && Array.isArray(faceNormal)) {
    return faceNormal
  }
  const face = params.face as FaceTopoRef | undefined
  if (face && typeof face === 'object' && face.kind === 'face') {
    const kernel = getBrepApi()
    const geom = resolveFaceGeometry(kernel, input, face)
    return geom.normal
  }
  return [0, 0, 1]
}

// ── 螺纹孔（tapped / screw）共用：规格解析、底孔反算、PMI 构造 ──

/**
 * 解析出的螺纹规格——metric / imperial / pipe 走同一份**统一视图**。
 *
 * 不用 `spec?` + `pipe?` 二选一字段：那样下游每个取值点都要 `!` 断言，
 * 而三者的下游需求其实只有四个数（公称直径 / 标签 / 螺距 / 缺省底孔）。
 */
interface ResolvedThread {
  /** 制式。 */
  system: ThreadSystem
  /** 公称直径 mm（pipe = 基准平面大径）。 */
  nominalDiameter: number
  /** 规格标签（'M6' / '1/4"' / 'PT1/8'），同时是 PMI 的显示真源。 */
  specLabel: string
  /** 实际螺距（mm）。 */
  pitch: number
  /** 底孔缺省直径（metric/imperial: 公称 − 螺距；pipe: 表内标准攻丝底孔）。 */
  pilotDia: number
}

/**
 * 解析螺纹参数（默认 metric + 索引 4（M5）+ 粗牙，与 mesh 路径一致）。
 *
 * `screwSystem: 'pipe'` 走管螺纹表：单一螺距系列，底孔取标准攻丝底孔
 * （PT1/8 → 8.4），不做「公称 − 螺距」近似（见 `PIPE_SPECS` 注释）。
 *
 * @param params - raw drill params.
 * @returns 解析后的螺纹规格。
 */
function resolveThread(params: Record<string, unknown>): ResolvedThread {
  const system = (params.screwSystem as ThreadSystem | undefined) ?? 'metric'
  const specIdx = (params.screwSpecIdx as number) ?? 4
  if (system === 'pipe') {
    const pipe = getPipeSpec(specIdx)
    return {
      system,
      nominalDiameter: pipe.majorDia,
      specLabel: pipe.label,
      pitch: pipe.pitch,
      pilotDia: pipe.pilotDia,
    }
  }
  const threadType = (params.screwThread as 'coarse' | 'fine' | 'custom') ?? 'coarse'
  const spec = getScrewSpec(system, specIdx)
  const pitch = threadToPitchMm(system, spec, threadType, params.screwPitchCustom as number | undefined)
  return {
    system,
    nominalDiameter: spec.dia,
    specLabel: spec.label,
    pitch,
    pilotDia: Math.round((spec.dia - pitch) * 1000) / 1000,
  }
}

/**
 * 攻丝孔底孔直径：显式给 `diameter` 就用它（图纸值是唯一真源）；否则用
 * `resolveThread` 算出的缺省底孔（M6 粗牙 P=1 → Φ5；PT1/8 → Φ8.4）。
 *
 * @param params - raw drill params (`diameter` may be omitted for `tapped`).
 * @param th - resolved thread spec.
 * @returns the pilot-hole diameter in mm.
 */
function resolvePilotDiameter(params: Record<string, unknown>, th: ResolvedThread): number {
  const explicit = params.diameter
  if (typeof explicit === 'number' && explicit > 0) return explicit
  return th.pilotDia
}

/**
 * 钻孔参数归一化：`tapped` 反算底孔直径，`depth` 缺省归一为 0（通孔）。
 *
 * 归一化在 op 入口做一次，往下（mesh / brep 两条链）只看到确定的数值——
 * 避免 `undefined` 在 `depth <= 0` 判定里落入盲孔分支产生 NaN 刀具。
 *
 * 同时在这里拒绝 `holeType:'screw'` + `screwSystem:'pipe'`：建模螺纹要真的
 * 切出螺旋牙，而锥管牙型（1:16 锥度）尚未实现，`makeScrew` 也不认 pipe
 * （它只按 metric/imperial 查表，pipe 会静默落进 imperial）。静默降级比报错
 * 危险得多，所以入口直接抛。
 *
 * @param params - raw drill params.
 * @returns normalized params (new object; input untouched).
 */
function normalizeDrillParams(params: Record<string, unknown>): Record<string, unknown> {
  if (params.holeType === 'screw' && params.screwSystem === 'pipe') {
    throw new Error(
      "[extra/drill] 管螺纹（screwSystem:'pipe'）不支持 holeType:'screw'：锥管牙型未实现。"
      + "改用 holeType:'tapped'——几何只钻底孔，螺纹（PT/R）由 PmiThreadHole 标注表达。",
    )
  }
  const depth = typeof params.depth === 'number' ? params.depth : 0
  if (params.holeType !== 'tapped') {
    return { ...params, depth }
  }
  const th = resolveThread(params)
  return { ...params, depth, diameter: resolvePilotDiameter(params, th) }
}

/** 是否产出螺纹孔 PMI（tapped 与 screw 都产出；simple 不产出）。 */
function isThreadHole(params: Record<string, unknown>): boolean {
  return params.holeType === 'tapped' || params.holeType === 'screw'
}

/**
 * 构造螺纹孔 PMI（底孔几何 + 后加工螺纹，两组信息同属一个条目）。
 *
 * @param params - normalized drill params.
 * @param th - resolved thread spec.
 * @param direction - inward axis (local space).
 * @param localPosition - hole entry point (local space).
 * @param target - optional BREP face ref of the hole wall (`hole:N`).
 * @returns the PmiThreadHole item (label filled).
 */
function buildThreadHolePmi(
  params: Record<string, unknown>,
  th: ResolvedThread,
  direction: Vec3,
  localPosition: Vec3,
  target?: FaceTopoRef,
): PmiThreadHole {
  const pilotDiameter = params.diameter as number
  const pilotDepth = typeof params.depth === 'number' ? params.depth : 0
  const rawThreadDepth = params.threadDepth as number | undefined
  // 有效螺纹深度：显式值优先；缺省 = 底孔同深；不得超过底孔深度（孔底留光底）。
  const threadDepth = typeof rawThreadDepth === 'number' && rawThreadDepth > 0
    ? (pilotDepth > 0 ? Math.min(rawThreadDepth, pilotDepth) : rawThreadDepth)
    : pilotDepth
  const toleranceClass = (params.threadClass as string | undefined)
    ?? (th.system === 'metric' ? '6H' : undefined)

  const base = {
    thread: {
      standard: th.system,
      nominalDiameter: th.nominalDiameter,
      ...(th.pitch > 0 ? { pitch: th.pitch } : {}),
      ...(toleranceClass !== undefined ? { toleranceClass } : {}),
      depth: threadDepth,
      specLabel: th.specLabel,
    },
    pilot: { diameter: pilotDiameter, depth: pilotDepth },
    axis: { origin: localPosition, direction },
    process: (params.holeType === 'tapped' ? 'tapped' : 'modeled') as 'tapped' | 'modeled',
    ...(target !== undefined ? { target } : {}),
  }
  const item = makeThreadHole(base)
  // label 只是显示缓存：两类信息在生成时就写全，宿主可直接渲染。
  return { ...item, label: formatThreadHole(item) }
}

/**
 * 在钻孔结果里定位「孔壁」面并合成 `FaceTopoRef`（BREP 链专用）。
 *
 * 依据：`drillBrepWithRoleTable` 把本次生成面登记为 `outStmt → hole:0/1/…`；
 * 生成面里圆柱面即孔壁（盲孔另有一个平底面）。mesh 链没有 BPEP 拓扑，
 * 返回 `undefined`，消费者改用 `axis` 定位。
 *
 * @param kernel - BREP engine.
 * @param solid - drilled result solid.
 * @param roleTable - result role table.
 * @param outStmt - the drill statement id (origin of generated faces).
 * @returns the hole-wall face ref, or undefined if it cannot be identified.
 */
function holeWallRef(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  roleTable: ReadonlyMap<unknown, unknown>,
  outStmt: string,
): FaceTopoRef | undefined {
  const roles = roleTable.get(outStmt) as ReadonlyMap<string, readonly number[]> | undefined
  if (!roles || roles.size === 0) return undefined

  // hash → role（生成面各自的 hole:N）
  const generated = new Map<number, string>()
  for (const [role, hashes] of roles) {
    for (const h of hashes) generated.set(h, role)
  }
  // 面枚举与 hash 枚举同序（TopExp::MapShapes + IndexedMap）
  const hashes = getFaceHashes(kernel, solid)
  const faces = kernel.getSubShapes(solid, 'face')
  for (let i = 0; i < hashes.length && i < faces.length; i++) {
    const role = generated.get(hashes[i]!)
    if (role === undefined) continue
    const face = faces[i]!
    let surfaceType: string
    try {
      surfaceType = kernel.surfaceType(face)
    } catch {
      continue
    }
    if (surfaceType !== 'cylinder') continue
    // outStmt 是运行时语句 id 字符串，与 RoleTable 的键同源（StmtId 是它的品牌类型）。
    return {
      kind: 'face',
      origin: outStmt as unknown as FaceTopoRef['origin'],
      role,
      hint: captureFaceHint(kernel, face),
    }
  }
  return undefined
}

/** BREP 螺丝孔：底孔（圆柱 cut）+ 内螺纹（threadBrep + cut）。带 roleTable 传播。 */
function screwHoleBrep(
  kernel: BrepEngineApi,
  upstreamSolid: BrepHandle,
  params: Record<string, unknown>,
  direction: Vec3,
  faceNormal: Vec3,
  localPosition: [number, number, number],
  inputRoleTable: ReadonlyMap<unknown, unknown>,
  outStmt: string,
): { result: BrepHandle; roleTable: ReadonlyMap<unknown, unknown> } {
  const diameter = params.diameter as number
  const depth = params.depth as number
  // 1. 底孔（圆柱 cut）→ roleTable（hole:0）
  const baseGeom = computeDrillGeometry(kernel, upstreamSolid, {
    diameter,
    depth,
    position: localPosition,
    direction,
    faceNormal,
  })
  const baseTool = buildDrillToolSolid(kernel, baseGeom)
  const baseR = drillBrepWithRoleTable(kernel, upstreamSolid, baseTool, inputRoleTable, outStmt)
  kernel.release(baseTool)

  // 2. 螺纹（内螺纹 ridge，inward=true）
  // 只管 metric / imperial：`normalizeDrillParams` 已在 op 入口拒绝 screw + pipe，
  // 这里的类型收窄是安全的（锥管牙型未实现，见该处的注释）。
  const screwSystem = (params.screwSystem as 'metric' | 'imperial') ?? 'metric'
  const screwSpecIdx = (params.screwSpecIdx as number) ?? 4 // M5 default（与 mesh 路径一致）
  const screwThread = (params.screwThread as 'coarse' | 'fine' | 'custom') ?? 'coarse'
  const spec = getScrewSpec(screwSystem, screwSpecIdx)
  const pitch = threadToPitchMm(screwSystem, spec, screwThread)

  if (pitch > 0) {
    const threadSolid = threadBrep(kernel, {
      radius: diameter / 2,
      pitch,
      height: depth > 0 ? depth : 20,
      inward: true,
    })
    const dir = new Vec3C(...direction).normalize()
    const fn = new Vec3C(...faceNormal)
    if (dir.dot(fn) > 0) dir.negate()

    const zAxis = new Vec3C(0, 0, 1)
    const quat = new Quat().setFromUnitVectors(zAxis, dir)
    const rotMatrix = new Mat4().makeRotationFromQuaternion(quat)
    const transMatrix = new Mat4().makeTranslation(localPosition[0], localPosition[1], localPosition[2])
    const fullMatrix = new Mat4().multiplyMatrices(transMatrix, rotMatrix)

    const positionedThread = kernel.transform(threadSolid, matrixToArray(fullMatrix))
    kernel.release(threadSolid)

    const finalR = drillBrepWithRoleTable(kernel, baseR.result, positionedThread, baseR.roleTable, outStmt)
    kernel.release(positionedThread)
    kernel.release(baseR.result)
    return { result: finalR.result, roleTable: finalR.roleTable }
  }

  return { result: baseR.result, roleTable: baseR.roleTable }
}

/** BREP 路径：OCCT cut（simple / tapped）或 threadBrep + cut（screw）。带 roleTable 传播。 */
function drillBrepPath(
  input: Shape,
  params: Record<string, unknown>,
): { shape: Shape; target?: FaceTopoRef } {
  const kernel = getBrepApi()
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (inputSolid === undefined) throw new Error('[extra/drill] input is not BREP')

  const faceNormal = faceNormalFrom(input, params)
  const direction = resolveDirection(params, faceNormal)
  const holeType = params.holeType as 'simple' | 'screw' | 'tapped' | undefined

  // position 契约（方向 A）：局部坐标——宿主生成脚本时已把交互世界坐标转换好，
  // 本 op 不做 world→local（无 partTransform 依赖）。
  const localPosition = params.position as [number, number, number]

  const inputTable = inputRoleTable(input) as ReadonlyMap<unknown, unknown> | undefined
  const outStmt = String(getCurrentStmt()?.id ?? '')

  let resultSolid: BrepHandle
  let roleTable: ReadonlyMap<unknown, unknown> | undefined
  if (holeType === 'screw') {
    const r = screwHoleBrep(
      kernel, inputSolid, params, direction, faceNormal, localPosition,
      inputTable ?? new Map(), outStmt,
    )
    resultSolid = r.result
    roleTable = r.roleTable
  } else {
    // simple 与 tapped 同一几何路径：只切底孔（tapped 的螺纹进 PMI，不进几何）。
    const geom = computeDrillGeometry(kernel, inputSolid, {
      diameter: params.diameter as number,
      depth: params.depth as number,
      position: localPosition,
      direction,
      faceNormal,
    })
    const toolSolid = buildDrillToolSolid(kernel, geom)
    const r = drillBrepWithRoleTable(kernel, inputSolid, toolSolid, inputTable ?? new Map(), outStmt)
    kernel.release(toolSolid)
    resultSolid = r.result
    roleTable = r.roleTable
  }

  const shape = fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid, roleTable })
  const target = roleTable === undefined
    ? undefined
    : holeWallRef(kernel, resultSolid, roleTable, outStmt)
  return { shape, target }
}

/** mesh 路径：manifold-3d mesh-CSG。 */
async function drillMeshPath(input: Shape, params: Record<string, unknown>): Promise<Shape> {
  const faceNormal = faceNormalFrom(input, params)
  const direction = resolveDirection(params, faceNormal)
  // position/diameter/depth/tolerance 契约（方向 A）：全部是模型局部空间值——
  // diameter 是用户输入的模型孔径（UI 面板），不随渲染层拖拽缩放折算；
  // position 由宿主在生成脚本时转为局部坐标。本 op 不做任何转换。
  const localPos = params.position as [number, number, number]

  return meshDrill(input, {
    diameter: params.diameter as number,
    depth: params.depth as number,
    type: (params.depth as number) > 0 ? 'blind' : 'through',
    position: localPos,
    direction,
    faceNormal,
    tolerance: (params.tolerance as number | undefined) !== undefined ? (params.tolerance as number) : undefined,
    holeType: params.holeType as 'simple' | 'screw' | 'tapped' | undefined,
    screwSystem: params.screwSystem as string | undefined,
    screwSpecIdx: params.screwSpecIdx as number | undefined,
    screwThread: params.screwThread as string | undefined,
    screwHead: params.screwHead as string | undefined,
    threadDepth: params.threadDepth as number | undefined,
    threadClass: params.threadClass as string | undefined,
  })
}

/**
 * 在几何体上钻孔（CSG 减除）。depth=0 为通孔，>0 为盲孔。
 *
 * 孔型三选一（`holeType`）：
 * - `simple`：光孔（圆柱）；
 * - `screw`：**建模螺纹**——几何里真的切出螺旋牙；
 * - `tapped`：**攻丝孔**——几何只钻底孔，螺纹信息进 PMI（`PmiThreadHole`，
 *   底孔 + 螺纹同属一条标注）。`diameter` 可省略，按「公称直径 − 螺距」反算（M6 → Φ5）。
 *
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name fai_drill
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载（3d_editor 38 个文件在用）。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
 * @note 键名以本表为准：`type: 'through'|'blind'` 与 `direction` 为向量的旧素材是无效写法——孔型由 `depth`（0=通孔）推导，`direction` 是 'normal'|'x'|'y'|'z' 枚举。
 * @returns Shape 钻孔后的几何（`tapped` / `screw` 会附带 `PmiThreadHole` 标注）。
 * @param input - 目标几何。type:Shape required:true
 * @param params.diameter - 孔径（mm）；`tapped` 时省略则按公称直径 − 螺距反算底孔，其余孔型必填。type:number required:false
 * @param params.depth - 孔深（mm）；0 = 通孔，> 0 = 盲孔。type:number 默认 0
 * @param params.holeType - 孔类型：simple 光孔 / screw 建模螺纹 / tapped 攻丝孔（底孔 + 螺纹 PMI）。type:'simple' | 'screw' | 'tapped' 默认 'simple'
 * @param params.direction - 钻孔轴向：`'normal'` = 沿该面法向进入材料（面在底面时即"向上"），`x`/`y`/`z` = 世界轴，两类都会按面法向自动定号；PMI 的 `axis.direction` 记的是定号后的实际钻孔方向。type:'normal' | 'x' | 'y' | 'z' 默认 'normal'
 * @param params.position - 孔心位置。type:[x,y,z] 默认 原点
 * @param params.face - 面引用（§6.2 新形态：`FaceTopoRef`，执行期按输入 Shape 解析派生法向；优先于 `faceNormal`）。type:FaceTopoRef
 * @param params.faceNormal - 面法向（决定朝向；历史兜底，§6.2 起宿主不再写，改由 `face` 解析）。type:[x,y,z] 默认 [0,0,1]
 * @param params.tolerance - 公差（mm）。type:number 默认 0.3
 * @param params.screwSystem - 螺纹制式（holeType='screw'/'tapped' 时用）。'metric' 公制 / 'imperial' 英制 / 'pipe' 55° 锥管螺纹（PT·R·BSPT，**只支持 tapped**：几何只钻底孔、螺纹进 PMI；'screw' + 'pipe' 会直接报错）。type:'metric' | 'imperial' | 'pipe' 默认 'metric'
 * @param params.screwSpecIdx - 螺丝规格索引（holeType='screw'/'tapped' 时用；metric 4 → M5、5 → M6；pipe 0 → PT1/8、1 → PT1/4、2 → PT3/8、3 → PT1/2）。type:number 默认 4
 * @param params.screwThread - 螺丝螺纹类型。type:'coarse' | 'fine' | 'custom' 默认 'coarse'
 * @param params.screwHead - 螺丝头型。type:'hex' | 'chc' | 'none' 默认 'none'
 * @param params.threadDepth - 有效螺纹深度（mm），仅标注用；须 ≤ depth，缺省与 depth 同深。type:number
 * @param params.threadClass - 螺纹公差等级（如 '6H'），仅标注用；metric 缺省 '6H'。type:string
 * @example
 * const p = cad.fai_drill(part0, { diameter: 5 })
 * const p = cad.fai_drill(part0, { diameter: 5, depth: 3 })
 * const p = cad.fai_drill(part0, { diameter: 5.2, depth: 8, holeType: 'screw', screwSystem: 'metric', screwSpecIdx: 4, screwThread: 'coarse', screwHead: 'none' })
 * // 攻丝孔：几何只钻 Φ5×16，螺纹 M6-6H ↓14 进 PMI
 * const p = cad.fai_drill(part0, { position: [0, 0, 30], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
 * // 管螺纹 PT1/8（锥管螺纹）：几何只钻 Φ8.8×20 底孔，PT1/8 螺纹进 PMI
 * const p = cad.fai_drill(part0, { position: [47.5, 0, 55], direction: 'x', holeType: 'tapped', screwSystem: 'pipe', screwSpecIdx: 0, diameter: 8.8, depth: 20 })
  */
export const fai_drill = defineOp({
  mesh: async (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[extra/drill] no input geometry')
    const p = normalizeDrillParams(params)
    assertDrillParams(p)
    // P2：多零件 load 的输入是 compound——按 partIndex 取目标成员，
    // 结果替换回原 compound（其余 children 原样保留）。
    const target = resolveCompoundMember(input, p.partIndex, 'fai_drill')
    const result = await drillMeshPath(target, p)
    // PMI：上游标注归上游零件名所有，不需要搬运（查询时沿血缘聚合），
    // 这里只补本孔的螺纹孔标注。标注挂在**零件**（成员）上而不是 compound 上。
    if (isThreadHole(p)) {
      const fn = faceNormalFrom(target, p)
      const direction = inwardDirection(resolveDirection(p, fn), fn)
      appendPmiItem(result, buildThreadHolePmi(p, resolveThread(p), direction, p.position as Vec3))
    }
    return replaceCompoundMember(input, p.partIndex, result)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[extra/drill] no input geometry')
    const p = normalizeDrillParams(params)
    assertDrillParams(p)
    const target = resolveCompoundMember(input, p.partIndex, 'fai_drill')
    const drilled = drillBrepPath(target, p)
    if (isThreadHole(p)) {
      const fn = faceNormalFrom(target, p)
      const direction = inwardDirection(resolveDirection(p, fn), fn)
      appendPmiItem(
        drilled.shape,
        buildThreadHolePmi(p, resolveThread(p), direction, p.position as Vec3, drilled.target),
      )
    }
    return replaceCompoundMember(input, p.partIndex, drilled.shape)
  },
  paramDims: { diameter: 'length', depth: 'length', tolerance: 'length', screwSpecIdx: 'plain', threadDepth: 'length' },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
  // 建模即标注：`tapped`/`screw` 在同一语句里既钻几何又产 `PmiThreadHole`。
  // 上游标注不需要搬运——它们归上游零件名所有，查询时沿血缘聚合得到。
})
