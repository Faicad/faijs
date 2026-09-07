/**
 * api/assembly/validate — `cad.assembly({ constraints })` 约束参数运行期校验（P2-f1）
 *
 * 前置事实（09-07 方案 §2.1）：`assembly` 是 `api/compound.ts` 里的普通导出函数
 * （经 api-namespace 注册进 cad 命名空间），**不是 defineOp/compatOp 声明的 op**，
 * 没有 "params 校验惯例" 可复用；`api/assert.ts` 的 7 个助手都是标量/向量级，
 * **没有对象/数组结构校验助手**——本模块内的结构校验逻辑是新增的，不污染通用 assert。
 *
 * 校验规则（逐条可判，报错文案必含：字段路径 + 期望形态 + 实际收到值）：
 * - V1 `type` ∈ {mate, align, coincident, concentric, distance, angle, parallel,
 *   perpendicular, fixed, face_mate}（文案列出合法类型全集）；
 * - V2 mate/align/coincident/concentric/distance/angle/parallel/perpendicular
 *   必须有 `a`、`b` 两个 EntityRef（face_mate 等价为 fixedFace/movingFace）；
 * - V3 distance/angle 必须有**有限数** `value`；不设区间（angle 允许 ±360 以外）
 *   与 brepjs solveAngle 行为对齐；
 * - V4 EntityRef 四形态 `face`/`edge`/`point`/`faceIndex` 互斥且恰占其一；
 *   `faceIndex` 必须为正整数；
 * - V5 `fixed` 只需要 `part`；`part` 必须出现在 members 里（**所有约束类型统一检查**，
 *   文案含成员名全集）；
 * - V6 face_mate 按 normalize 语义重排（fixedPartName/fixedFace → a，
 *   movingPartName/movingFace → b）后同样过 V2/V5。
 *
 * 调用点：`compound.ts` 的 `assembly(params)` 函数体开头、`keep()` 之前（fail-fast，
 * 与 normalize.ts 的未知类型抛错互补——执行期错误不静默）。
 */

import type { AssemblyConstraint } from './types'

/** 合法约束类型全集（V1；与 types.ts 的 AssemblyConstraint 并集约等）。 */
export const ASSEMBLY_CONSTRAINT_TYPES = [
  'mate', 'align', 'coincident', 'concentric', 'distance', 'angle',
  'parallel', 'perpendicular', 'fixed', 'face_mate',
] as const

/** 需要 `a`/`b` 两个 EntityRef 的新形态类型（V2；distance/angle 在 types 契约里也有 a/b）。 */
const PAIRED_TYPES = new Set([
  'mate', 'align', 'coincident', 'concentric', 'distance', 'angle',
  'parallel', 'perpendicular',
])

function fail(path: string, expected: string, got: unknown): never {
  throw new Error(`[assembly] ${path}: expected ${expected}, got ${JSON.stringify(got)}`)
}

/** V4：EntityRef 四形态互斥且恰占其一；faceIndex 正整数；part 必须 ∈ members（V5）。 */
function checkEntityRef(ref: unknown, path: string, memberNames: string[]): void {
  if (ref === null || typeof ref !== 'object') {
    fail(path, 'an EntityRef object { part, face | edge | point | faceIndex }', ref)
  }
  const r = ref as Record<string, unknown>
  if (typeof r.part !== 'string' || r.part.length === 0) {
    fail(`${path}.part`, 'a non-empty member name string', r.part)
  }
  if (!memberNames.includes(r.part)) {
    throw new Error(
      `[assembly] ${path}.part: "${r.part}" is not a member; members: [${memberNames.join(', ')}]`,
    )
  }
  const present = (['face', 'edge', 'point', 'faceIndex'] as const).filter(
    (k) => k in r && r[k] !== undefined,
  )
  if (present.length !== 1) {
    fail(path, `exactly one of face/edge/point/faceIndex (mutually exclusive), got keys [${present.join(', ')}]`, r)
  }
  if ('faceIndex' in r) {
    const idx = r.faceIndex
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 1) {
      fail(`${path}.faceIndex`, 'a positive integer (1-based face ordinal)', idx)
    }
  }
  if ('point' in r) {
    const p = r.point
    if (
      !Array.isArray(p) || p.length !== 3 ||
      p.some((n) => typeof n !== 'number' || !Number.isFinite(n))
    ) {
      fail(`${path}.point`, 'a vec3 [x, y, z] of finite numbers', p)
    }
  }
}

/** V6：face_mate 按 normalize 语义重排后过 V2/V5（face 省略四形态检查——结构上必为面）。 */
function checkFaceMate(c: Record<string, unknown>, path: string, memberNames: string[]): void {
  const a = { part: c.fixedPartName, face: c.fixedFace }
  const b = { part: c.movingPartName, face: c.movingFace }
  checkEntityRef(a, `${path} (a → fixedPartName/fixedFace)`, memberNames)
  checkEntityRef(b, `${path} (b → movingPartName/movingFace)`, memberNames)
}

/** 校验单条约束（下标 i 用于报错路径）。 */
function checkOne(raw: unknown, i: number, memberNames: string[]): void {
  const path = `constraints[${i}]`
  if (raw === null || typeof raw !== 'object') {
    fail(path, 'an object with a "type" field', raw)
  }
  const c = raw as Record<string, unknown>
  // V1
  const type = c.type
  if (typeof type !== 'string' || !(ASSEMBLY_CONSTRAINT_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `[assembly] ${path}.type: unknown constraint type ${JSON.stringify(type)}, expected one of ${ASSEMBLY_CONSTRAINT_TYPES.join(' | ')}`,
    )
  }

  // V6：face_mate 先归一化再走通用校验
  if (type === 'face_mate') {
    checkFaceMate(c, path, memberNames)
    return
  }

  // V5：fixed 只需要顶层 part（字符串）且 ∈ members
  if (type === 'fixed') {
    if (typeof c.part !== 'string' || c.part.length === 0) {
      fail(`${path}.part`, 'a non-empty member name string', c.part)
    }
    if (!memberNames.includes(c.part)) {
      throw new Error(
        `[assembly] ${path}.part: "${c.part}" is not a member; members: [${memberNames.join(', ')}]`,
      )
    }
    return
  }

  // V2 + V4（a/b 每个都是 EntityRef）
  if (PAIRED_TYPES.has(type)) {
    checkEntityRef(c.a, `${path}.a`, memberNames)
    checkEntityRef(c.b, `${path}.b`, memberNames)
  }

  // V3：distance/angle 必须有有限数 value（不设区间，与 brepjs solveAngle 对齐）
  if (type === 'distance' || type === 'angle') {
    const v = c.value
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      fail(`${path}.value`, 'a finite number', v)
    }
  }
}

/**
 * 校验 `cad.assembly({ constraints })` 的 constraints 参数（V1–V6）。
 * @param constraints - 未校验的 constraints 输入（脚本/宿主直传，可为任意值）。
 * @param memberNames - 成员名列表（来自成员的 nameOf 反查/显式 memberNames），V5 用。
 * @throws Error 首条违规即抛（fail-fast），文案含字段路径。
 * @returns 断言函数，通过后收窄 constraints 为 AssemblyConstraint[]。
 */
export function validateConstraints(
  constraints: unknown,
  memberNames: string[],
): asserts constraints is AssemblyConstraint[] {
  if (!Array.isArray(constraints)) {
    fail('constraints', 'an array of constraint objects', constraints)
  }
  for (let i = 0; i < constraints.length; i++) {
    checkOne(constraints[i], i, memberNames)
  }
}