/**
 * allocate-id — 语句 id 分配器（Phase 3 命名规则）
 *
 * Phase 3 命名规则（§4）：
 * - 单入单出（translate/rotate/drill/extrude/knurl/engrave/boolean 等）：**复用输入名**
 * - 无输入/单输出（box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load）：**新名 partN**
 * - 多输出（split 1→2）：按输出数分配新 partN / part(N+1)
 * - group/assembly：取消 grp_N，按「无输入/单输出」规则拿新 partN
 * - void op（add_constraint/do_assemble）：无输出，不调用 allocateStatementId
 *
 * 版本号 _vM 语义取消：模型号 N 在单次脚本内单调递增。
 * 存量 partN_vM fixture 仍可加载（isPartVmId/getModelNum/getVersionNum 保留供解析旧名）。
 */

import type { CadStatement } from './types'
import { asPartName, type PartName } from '../identity'

/** partN_vM 格式正则（兼容旧名） */
const PART_VM_RE = /^part(\d+)_v(\d+)$/
/** partN 格式正则（Phase 3 新名） */
const PART_RE = /^part(\d+)$/
/** grp_N 格式正则（兼容旧名） */
const GRP_RE = /^grp_(\d+)$/

/**
 * 从语句 outputs 列表中提取最大模型号（Phase 3: 从 outputs 扫描，不再依赖 stmt.id）。
 * 同时兼容旧名 partN_vM 和新名 partN。
 */
function getMaxModelNum(statements: CadStatement[]): number {
  let max = -1
  for (const stmt of statements) {
    for (const outId of stmt.outputs) {
      // Phase 3: 新名 partN
      const m = PART_RE.exec(outId)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > max) max = n
      }
      // 兼容旧名 partN_vM
      const om = PART_VM_RE.exec(outId)
      if (om) {
        const n = parseInt(om[1], 10)
        if (n > max) max = n
      }
    }
    // 也检查旧格式的 stmt.id（兼容旧 fixture 中 id 仍为 partN_vM）
    const idM = PART_RE.exec(stmt.id) ?? PART_VM_RE.exec(stmt.id)
    if (idM) {
      const n = parseInt(idM[1], 10)
      if (n > max) max = n
    }
  }
  return max
}

/** 从 id 中解析模型号（兼容旧名 partN_vM 和新名 partN） */
function parseModelNum(id: string): number | null {
  const m = PART_RE.exec(id) ?? PART_VM_RE.exec(id)
  return m ? parseInt(m[1], 10) : null
}

/** 从 id 中解析版本号（仅旧名 partN_vM 有版本号；新名 partN 返回 0） */
function parseVersionNum(id: string): number | null {
  const m = PART_VM_RE.exec(id)
  return m ? parseInt(m[2], 10) : null
}

/**
 * 判断 op 是否为无输入的创建型操作（新模型）。
 */
function isCreatorOp(op: string): boolean {
  return ['box', 'sphere', 'cylinder', 'cone', 'wedge', 'load', 'sdf', 'text', 'screw', 'svgExtrude'].includes(op)
}

/**
 * 判断 op 是否为克隆型操作（输出是独立新对象，不保名）。
 * copy 不消费源（共享读取），但输出是独立几何 → 归“新名”类。
 */
function isCloneOp(op: string): boolean {
  return op === 'copy'
}

/**
 * 判断 op 是否为布尔操作（结果为新模型）。
 */
function isBooleanOp(op: string): boolean {
  return op === 'boolean'
}

/** 分配器上下文 */
export interface AllocateIdContext {
  /** 当前 sceneScript 中所有已有语句 */
  statements: CadStatement[]
}

/**
 * 分配语句的输出变量名（PartName）。
 *
 * Phase 3 命名规则（§4）：
 * - 单入单出（translate/rotate/drill/extrude/knurl/engrave/boolean 等）：**复用输入名**（inputs[0]）
 * - 无输入/单输出（box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load）：**新名 partN**
 * - group/assembly：取消 grp_N，按「无输入/单输出」规则拿新 partN
 * - void op（add_constraint/do_assemble）：不调用此函数（outputs 为空数组）
 *
 * 版本号 _vM 语义取消：模型号 N 在单次脚本内单调递增。
 *
 * @param op 操作类型
 * @param inputs 输入变量名列表（PartName）
 * @param ctx 分配器上下文（包含已有语句列表）
 * @returns 分配的变量名（PartName）
 */
export function allocateStatementId(
  op: string,
  inputs: string[],
  ctx: AllocateIdContext,
): PartName {
  const { statements } = ctx

  // group/assembly：取消 grp_N，按「无输入/单输出」规则拿新 partN
  if (op === 'group' || op === 'assembly') {
    const nextN = getMaxModelNum(statements) + 1
    return asPartName(`part${nextN}`)
  }

  // 创建型 / 布尔 / 克隆 / 无输入 → 新模型
  if (isCreatorOp(op) || isBooleanOp(op) || isCloneOp(op) || inputs.length === 0) {
    const nextN = getMaxModelNum(statements) + 1
    return asPartName(`part${nextN}`)
  }

  // 单入单出 → 复用输入名
  return asPartName(inputs[0])
}

/**
 * 为分割操作分配两个输出的 PartName。
 *
 * 分割产生两个新模型：partN 和 part(N+1)。
 *
 * @param ctx 分配器上下文
 * @returns { front, back } 两个 PartName
 */
export function allocateSplitIds(
  ctx: AllocateIdContext,
): { front: PartName; back: PartName } {
  const { statements } = ctx
  const nextN = getMaxModelNum(statements) + 1
  return {
    front: asPartName(`part${nextN}`),
    back: asPartName(`part${nextN + 1}`),
  }
}

/**
 * 判断 id 是否为 partN_vM 格式（旧名 PartName）。
 * 新名 partN 请用 isPartId 判断。
 */
export function isPartVmId(id: string): id is PartName {
  return PART_VM_RE.test(id)
}

/**
 * 判断 id 是否为 partN 格式（Phase 3 新名 PartName）。
 */
export function isPartId(id: string): id is PartName {
  return PART_RE.test(id)
}

/**
 * 从 id 中提取模型号（兼容旧名 partN_vM 和新名 partN）。
 */
export function getModelNum(id: string): number | null {
  return parseModelNum(id)
}

/**
 * 从 id 中提取版本号（仅旧名 partN_vM 有版本号；新名 partN 返回 null）。
 */
export function getVersionNum(id: string): number | null {
  return parseVersionNum(id)
}

/**
 * 判断 id 是否为 grp_N 格式（GroupName ⊆ PartName，兼容旧名）。
 */
export function isGrpId(id: string): id is PartName {
  return GRP_RE.test(id)
}

/**
 * 从 id 中提取 group 号（grp_N 中的 N）。
 */
export function getGroupNum(id: string): number | null {
  const m = GRP_RE.exec(id)
  return m ? parseInt(m[1], 10) : null
}
