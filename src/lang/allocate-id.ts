/**
 * allocate-id — 语句 id 分配器（partN_vM + grp_N 格式）
 *
 * 设计文档：docs/plans/2026-08-13-ui-record-faijs-engine.md §B1
 * 装配执行 v7：docs/plans/2026-08-20-assembly-execution-v7-3d-editor-completion.md §4.1
 *
 * 命名规则：
 * - 几何 op（partN_vM 格式）：
 *   - 无输入（primitive/load/sdf/text/screw/svgExtrude）→ 新模型 partN_v0
 *   - 有输入（drill/extrude/engrave/knurl/transform）→ 跟随 inputs[0] 的模型号，版本 +1
 *   - 布尔（boolean）→ 新模型 partN_v0
 *   - 分割（split）→ 两个新模型 partN_v0, part(N+1)_v0
 * - 结构型 op（grp_N 格式）：
 *   - group/assembly/add_constraint/do_assemble → grp_N
 *   - N = 当前 statements 中 grp_(\d+) 的最大值 + 1
 *   - 与 parser 的 grp_N 同格式、同一序列；无模块级状态
 *
 * id 格式：part<N>_v<M> 或 grp_<N>，N ≥ 0, M ≥ 0
 */

import type { CadStatement } from './types'
import { asStmtId, asPartName, type StmtId, type PartName, type GroupName } from '../identity'

/** partN_vM 格式正则 */
const PART_VM_RE = /^part(\d+)_v(\d+)$/

/** grp_N 格式正则 */
const GRP_RE = /^grp_(\d+)$/

/** 从语句 id 列表中提取最大模型号 */
function getMaxModelNum(statements: CadStatement[]): number {
  let max = -1
  for (const stmt of statements) {
    const m = PART_VM_RE.exec(stmt.id)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
    // 也检查 outputs（split 的输出 id）
    if (stmt.outputs) {
      for (const outId of stmt.outputs) {
        const om = PART_VM_RE.exec(outId)
        if (om) {
          const n = parseInt(om[1], 10)
          if (n > max) max = n
        }
      }
    }
  }
  return max
}

/** 从语句 id 列表中提取最大 group 号（grp_N 中的 N） */
function getMaxGroupNum(statements: CadStatement[]): number {
  let max = 0
  for (const stmt of statements) {
    const m = GRP_RE.exec(stmt.id)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max
}

/** 从语句 id 中解析模型号 */
function parseModelNum(id: string): number | null {
  const m = PART_VM_RE.exec(id)
  return m ? parseInt(m[1], 10) : null
}

/** 从语句 id 中解析版本号 */
function parseVersionNum(id: string): number | null {
  const m = PART_VM_RE.exec(id)
  return m ? parseInt(m[2], 10) : null
}

/**
 * 获取指定模型号在已有语句中的最大版本号。
 */
function getMaxVersionForModel(statements: CadStatement[], modelNum: number): number {
  let max = -1
  for (const stmt of statements) {
    // 检查 id 格式
    const idMatch = PART_VM_RE.exec(stmt.id)
    if (idMatch && parseInt(idMatch[1], 10) === modelNum) {
      const v = parseInt(idMatch[2], 10)
      if (v > max) max = v
    }
    // 检查 outputs
    if (stmt.outputs) {
      for (const outId of stmt.outputs) {
        const om = PART_VM_RE.exec(outId)
        if (om && parseInt(om[1], 10) === modelNum) {
          const v = parseInt(om[2], 10)
          if (v > max) max = v
        }
      }
    }
  }
  return max
}

/**
 * 判断 op 是否为无输入的创建型操作（新模型）。
 */
function isCreatorOp(op: string): boolean {
  return ['box', 'sphere', 'cylinder', 'cone', 'wedge', 'load', 'sdf', 'text', 'screw', 'svgExtrude'].includes(op)
}

/**
 * 判断 op 是否为布尔操作（结果为新模型）。
 */
function isBooleanOp(op: string): boolean {
  return op === 'boolean'
}

/** 结构型 op 集合：group/assembly/add_constraint/do_assemble → grp_N 格式 */
const GROUP_OPS = new Set(['group', 'assembly', 'add_constraint', 'do_assemble'])

/** 分配器上下文 */
export interface AllocateIdContext {
  /** 当前 sceneScript 中所有已有语句 */
  statements: CadStatement[]
}

/**
 * 分配语句 id（partN_vM 格式）。
 *
 * 规则：
 * - 无输入 / 布尔 → 新模型 partN_v0（N = maxModel + 1）
 * - 有输入 → 跟随 inputs[0] 的模型号，版本 = 该模型最大版本 + 1
 * - 分割 → 返回两个 id（通过 allocateSplitIds）
 *
 * @param op 操作类型
 * @param inputs 输入语句 id 列表
 * @param ctx 分配器上下文（包含已有语句列表）
 * @returns 分配的语句 id（StmtId）
 */
export function allocateStatementId(
  op: string,
  inputs: string[],
  ctx: AllocateIdContext,
): StmtId {
  const { statements } = ctx

  // 结构型 op（group/assembly/add_constraint/do_assemble）→ grp_N 格式
  if (GROUP_OPS.has(op)) {
    return asStmtId(`grp_${getMaxGroupNum(statements) + 1}`)
  }

  // 创建型 / 布尔 → 新模型
  if (isCreatorOp(op) || isBooleanOp(op) || inputs.length === 0) {
    const nextN = getMaxModelNum(statements) + 1
    return asStmtId(`part${nextN}_v0`)
  }

  // 有输入 → 跟随 inputs[0] 的模型号
  const inputId = inputs[0]
  const inputModelNum = parseModelNum(inputId)

  if (inputModelNum === null) {
    // 输入不是 partN_vM 格式（可能是旧 st_* 格式），分配新模型
    const nextN = getMaxModelNum(statements) + 1
    return asStmtId(`part${nextN}_v0`)
  }

  // 跟随输入的模型号，版本 +1
  const maxVersion = getMaxVersionForModel(statements, inputModelNum)
  const nextV = maxVersion + 1
  return asStmtId(`part${inputModelNum}_v${nextV}`)
}

/**
 * 为分割操作分配两个输出的 PartName。
 *
 * 分割产生两个 PartName：partN_v0 和 part(N+1)_v0。
 *
 * @param ctx 分配器上下文
 * @param returns { front, back } 两个 PartName
 */
export function allocateSplitIds(
  ctx: AllocateIdContext,
): { front: PartName; back: PartName } {
  const { statements } = ctx
  const nextN = getMaxModelNum(statements) + 1
  return {
    front: asPartName(`part${nextN}_v0`),
    back: asPartName(`part${nextN + 1}_v0`),
  }
}

/**
 * 判断 id 是否为 partN_vM 格式（PartName）。
 */
export function isPartVmId(id: string): id is PartName {
  return PART_VM_RE.test(id)
}

/**
 * 从 id 中提取模型号。
 */
export function getModelNum(id: string): number | null {
  return parseModelNum(id)
}

/**
 * 从 id 中提取版本号。
 */
export function getVersionNum(id: string): number | null {
  return parseVersionNum(id)
}

/**
 * 判断 id 是否为 grp_N 格式（GroupName ⊆ PartName）。
 */
export function isGrpId(id: string): id is GroupName {
  return GRP_RE.test(id)
}

/**
 * 从 id 中提取 group 号（grp_N 中的 N）。
 */
export function getGroupNum(id: string): number | null {
  const m = GRP_RE.exec(id)
  return m ? parseInt(m[1], 10) : null
}
