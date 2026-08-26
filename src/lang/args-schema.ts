/**
 * args-schema — 参数 schema 校验框架（纯函数）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §2.2
 *
 * SCHEMAS（op 目录的 schema 表）已迁到 src/stdlib/schemas.ts（L1）。
 * 本文件（L0）只保留：
 * - schema 类型定义（ArgType / ArgFieldSchema / OpSchema / ReturnType / ValidationError）
 * - 对"给定 schema 表"校验的纯函数（validateStatementArgs / validateScriptArgs /
 *   getOpSchema / hasOpSchema）
 * - getOpReturnType：结构型 op（add_constraint/do_assemble）的返回值类型硬编码，
 *   不再依赖 schema 表（Phase 2.8 删除 returnType 后本函数退役）
 */

import type { CadStatement } from './types'

// ── 类型定义 ──

export type ArgType = 'number' | 'vec3' | 'string' | 'PartName' | 'boolean' | 'numberOrVec3' | 'any'

export interface ArgFieldSchema {
  name: string
  type: ArgType
  required?: boolean
}

export interface OpSchema {
  op: string
  fields: ArgFieldSchema[]
  minInputs?: number
  /** 结构型无输出 op（add_constraint/do_assemble）：赋值即错误（Phase 2.8 替代 returnType 四类分类） */
  void?: boolean
}

export interface ValidationError {
  field: string
  message: string
}

// ── 校验逻辑（纯函数：对给定 schema 表校验） ──

function isVec3(v: unknown): boolean {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
}

function isNumberOrVec3(v: unknown): boolean {
  return typeof v === 'number' || isVec3(v)
}

function checkType(value: unknown, type: ArgType): boolean {
  switch (type) {
    case 'number': return typeof value === 'number'
    case 'vec3': return isVec3(value)
    case 'string': return typeof value === 'string'
    case 'PartName': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'numberOrVec3': return isNumberOrVec3(value)
    case 'any': return true
    default: return true
  }
}

/**
 * 校验单条语句的 args 是否满足其 op 的 schema（对给定 schema 表校验）。
 *
 * @param stmt 语句
 * @param schemas op 目录的 schema 表（由 stdlib 注入）
 * @returns 错误列表，空数组表示通过
 */
export function validateStatementArgs(
  stmt: CadStatement,
  schemas: Record<string, OpSchema>,
): ValidationError[] {
  const schema = schemas[stmt.op]
  if (!schema) {
    // 未知 op — 不校验（让执行器自己 throw）
    return []
  }

  const errors: ValidationError[] = []
  const declaredFields = new Set(schema.fields.map((f) => f.name))

  // 检查必需字段 + 类型
  for (const field of schema.fields) {
    const value = stmt.args[field.name]
    if (field.required && (value === undefined || value === null)) {
      errors.push({ field: field.name, message: `missing required field "${field.name}"` })
      continue
    }
    if (value !== undefined && value !== null && !checkType(value, field.type)) {
      errors.push({
        field: field.name,
        message: `field "${field.name}" expected type ${field.type}, got ${typeof value}`,
      })
    }
  }

  // 检查未知键（拒绝多余参数）
  for (const key of Object.keys(stmt.args)) {
    if (!declaredFields.has(key)) {
      errors.push({
        field: key,
        message: `unknown field "${key}" for op "${stmt.op}" — not in schema`,
      })
    }
  }

  // 检查 inputs
  if (schema.minInputs && stmt.inputs.length < schema.minInputs) {
    errors.push({
      field: 'inputs',
      message: `op "${stmt.op}" requires at least ${schema.minInputs} input(s), got ${stmt.inputs.length}`,
    })
  }

  // load op 互斥校验：key/path/url 恰居其一
  if (stmt.op === 'load') {
    const hasKey = stmt.args.key !== undefined && stmt.args.key !== null
    const hasPath = stmt.args.path !== undefined && stmt.args.path !== null
    const hasUrl = stmt.args.url !== undefined && stmt.args.url !== null
    const count = (hasKey ? 1 : 0) + (hasPath ? 1 : 0) + (hasUrl ? 1 : 0)
    if (count === 0) {
      errors.push({ field: 'load', message: 'load op requires exactly one of key/path/url, got none' })
    } else if (count > 1) {
      errors.push({ field: 'load', message: `load op requires exactly one of key/path/url, got ${count}` })
    }
  }

  // 赋值校验（基于 schema 表的可选校验；无表不校验）
  if (schema.void && stmt.hasAssignment) {
    errors.push({
      field: 'assignment',
      message: `op "${stmt.op}" is void, cannot assign to a variable`,
    })
  }

  return errors
}

/**
 * 校验整个 PartScript 的所有语句（对给定 schema 表校验）。
 *
 * @returns 错误列表，空数组表示全部通过
 */
export function validateScriptArgs(
  statements: CadStatement[],
  schemas: Record<string, OpSchema>,
): Array<{ statementId: string; errors: ValidationError[] }> {
  const results: Array<{ statementId: string; errors: ValidationError[] }> = []
  for (const stmt of statements) {
    const errors = validateStatementArgs(stmt, schemas)
    if (errors.length > 0) {
      results.push({ statementId: stmt.id, errors })
    }
  }
  return results
}

/** 获取 op 的 schema（对给定 schema 表查询） */
export function getOpSchema(op: string, schemas: Record<string, OpSchema>): OpSchema | undefined {
  return schemas[op]
}

/** 判断 op 是否有 schema（对给定 schema 表查询） */
export function hasOpSchema(op: string, schemas: Record<string, OpSchema>): boolean {
  return op in schemas
}
