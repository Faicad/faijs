/**
 * args-schema — 语句参数校验（D-10）（L0 零依赖）
 *
 * 每个 op 一份 arg schema，录制/解析/执行三处共用同一份校验。
 * A-1（cone 参数名错）这类错误能在这里被拦截。
 *
 * schema 定义了每个 op 的必需参数和可选参数及其类型。
 * 校验不通过的 args 会在录制/解析/执行时被拒绝。
 */

import type { CadStatement, ReturnType } from './types'

// ── 类型定义 ──

export type ArgType = 'number' | 'vec3' | 'string' | 'PartName' | 'boolean' | 'any' | 'numberOrVec3'

export interface ArgFieldSchema {
  name: string
  type: ArgType
  required: boolean
}

export interface OpSchema {
  op: string
  fields: ArgFieldSchema[]
  /** 需要 inputs 的最小数量 */
  minInputs?: number
  /** 返回值类型。缺省 = 'new_shape'。
   *  - new_shape：返回新几何，必须赋值
   *  - same_shape：返回自身/上下文，可赋值可不赋值（用于链式调用）
   *  - scalar：返回非 shape 值，必须赋值
   *  - void：无返回值，不准赋值 */
  returnType?: ReturnType
}

// ── op 目录的 args schema ──

export const SCHEMAS: Record<string, OpSchema> = {
  // 创建类
  box: {
    op: 'box',
    fields: [
      { name: 'size', type: 'numberOrVec3', required: true },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  sphere: {
    op: 'sphere',
    fields: [
      { name: 'radius', type: 'number', required: true },
      { name: 'segments', type: 'number', required: false },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  cylinder: {
    op: 'cylinder',
    fields: [
      { name: 'radius', type: 'number', required: true },
      { name: 'height', type: 'number', required: true },
      { name: 'segments', type: 'number', required: false },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  cone: {
    op: 'cone',
    fields: [
      { name: 'radiusBottom', type: 'number', required: true },
      { name: 'radiusTop', type: 'number', required: true },
      { name: 'height', type: 'number', required: true },
      { name: 'segments', type: 'number', required: false },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  wedge: {
    op: 'wedge',
    fields: [
      { name: 'width', type: 'number', required: true },
      { name: 'height', type: 'number', required: true },
      { name: 'angle', type: 'number', required: true },
      { name: 'length', type: 'number', required: true },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  text: {
    op: 'text',
    fields: [
      { name: 'text', type: 'string', required: true },
      { name: 'size', type: 'number', required: true },
      { name: 'depth', type: 'number', required: true },
    ],
  },
  screw: {
    op: 'screw',
    fields: [
      { name: 'system', type: 'string', required: true },
      { name: 'specIdx', type: 'number', required: true },
      { name: 'thread', type: 'string', required: true },
      { name: 'pitchCustom', type: 'number', required: false },
      { name: 'length', type: 'number', required: true },
      { name: 'head', type: 'string', required: true },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  svgExtrude: {
    op: 'svgExtrude',
    fields: [
      { name: 'svg', type: 'any', required: true },
      { name: 'depth', type: 'number', required: true },
      { name: 'targetLongSide', type: 'number', required: true },
    ],
  },
  load: {
    op: 'load',
    fields: [
      { name: 'key', type: 'string', required: false },
      { name: 'path', type: 'string', required: false },
      { name: 'url', type: 'string', required: false },
      { name: 'format', type: 'string', required: false },
    ],
  },

  // 变换类
  translate: {
    op: 'translate',
    fields: [{ name: 'offset', type: 'vec3', required: true }],
    minInputs: 1,
  },
  rotate: {
    op: 'rotate',
    fields: [
      { name: 'anglesDeg', type: 'vec3', required: true },
      { name: 'pivot', type: 'vec3', required: false },
    ],
    minInputs: 1,
  },
  scale: {
    op: 'scale',
    fields: [{ name: 'factor', type: 'any', required: true }],
    minInputs: 1,
  },

  // 特征类
  drill: {
    op: 'drill',
    fields: [
      { name: 'diameter', type: 'number', required: true },
      { name: 'depth', type: 'number', required: false },
      { name: 'holeType', type: 'string', required: false },
      { name: 'direction', type: 'string', required: false },
      { name: 'tolerance', type: 'number', required: false },
      { name: 'position', type: 'any', required: false },
      { name: 'faceNormal', type: 'any', required: false },
      { name: 'screwSystem', type: 'string', required: false },
      { name: 'screwSpecIdx', type: 'number', required: false },
      { name: 'screwThread', type: 'string', required: false },
      { name: 'screwHead', type: 'string', required: false },
    ],
    minInputs: 1,
  },
  extrude: {
    op: 'extrude',
    fields: [
      { name: 'length', type: 'number', required: true },
      { name: 'mode', type: 'string', required: false },
      { name: 'normal', type: 'vec3', required: false },
      { name: 'originOffset', type: 'number', required: false },
      { name: 'space', type: 'string', required: false },
    ],
    minInputs: 1,
  },
  split: {
    op: 'split',
    fields: [
      { name: 'cutMode', type: 'string', required: false },
      { name: 'normal', type: 'vec3', required: false },
      { name: 'offset', type: 'number', required: false },
      { name: 'inPlaneAngleDeg', type: 'number', required: false },
      { name: 'side', type: 'string', required: false },
      { name: 'grooveDepth', type: 'number', required: false },
      { name: 'grooveWidth', type: 'number', required: false },
      { name: 'grooveDepthTolerance', type: 'number', required: false },
      { name: 'grooveWidthTolerance', type: 'number', required: false },
      { name: 'grooveFlapsAngle', type: 'number', required: false },
      { name: 'dowelDiameter', type: 'number', required: false },
      { name: 'dowelDiameterTolerance', type: 'number', required: false },
      { name: 'dowelHeight', type: 'number', required: false },
      { name: 'dowelHeightTolerance', type: 'number', required: false },
      { name: 'tenonSideLength', type: 'number', required: false },
      { name: 'tenonSideLengthTolerance', type: 'number', required: false },
      { name: 'tenonHeight', type: 'number', required: false },
      { name: 'tenonHeightTolerance', type: 'number', required: false },
      { name: 'bbCenter', type: 'vec3', required: false },
      { name: 'bboxSize', type: 'vec3', required: false },
      { name: 'selectedSections', type: 'any', required: false },
      { name: 'applyExplode', type: 'boolean', required: false },
      { name: 'frontPartName', type: 'PartName', required: false },
      { name: 'backPartName', type: 'PartName', required: false },
    ],
    minInputs: 1,
  },
  boolean: {
    op: 'boolean',
    fields: [
      { name: 'operation', type: 'string', required: true },
      { name: 'sourcePartNames', type: 'any', required: false },
    ],
    minInputs: 1,
  },
  engrave: {
    op: 'engrave',
    fields: [
      { name: 'text', type: 'string', required: false },
      { name: 'depth', type: 'number', required: false },
      { name: 'textSize', type: 'number', required: false },
      { name: 'svg', type: 'any', required: false },
      { name: 'svgSize', type: 'number', required: false },
      { name: 'mode', type: 'string', required: false },
      { name: 'faceCenter', type: 'any', required: false },
      { name: 'faceNormal', type: 'any', required: false },
    ],
    minInputs: 1,
  },
  knurl: {
    op: 'knurl',
    fields: [
      { name: 'knurlTextureHeight', type: 'number', required: false },
      { name: 'knurlScaleU', type: 'number', required: false },
      { name: 'knurlScaleV', type: 'number', required: false },
      { name: 'knurlInvertDisplacement', type: 'boolean', required: false },
      { name: 'knurlRefineLength', type: 'number', required: false },
      { name: 'knurlMappingMode', type: 'number', required: false },
      { name: 'faceCenter', type: 'any', required: false },
      { name: 'faceNormal', type: 'any', required: false },
    ],
    minInputs: 1,
  },
  sdf: {
    op: 'sdf',
    fields: [
      { name: 'code', type: 'string', required: true },
      { name: 'box', type: 'any', required: false },
      { name: 'resolution', type: 'number', required: false },
      { name: 'params', type: 'any', required: false },
    ],
  },

  // ── 结构型语句 ──
  // group/assembly/add_constraint/do_assemble
  // 这些 op 不产出几何，但需要 schema 校验其参数结构。
  // assembly 是定义装配的名词（const x = cad.assembly({...})），
  // do_assemble 是执行装配的动词（x.do_assemble()）。
  group: {
    op: 'group',
    fields: [
      { name: 'name', type: 'string', required: false },
      { name: 'members', type: 'any', required: false },
    ],
  },
  assembly: {
    op: 'assembly',
    fields: [
      { name: 'name', type: 'string', required: false },
      { name: 'members', type: 'any', required: false },
      { name: 'constraints', type: 'any', required: false },
    ],
  },
  add_constraint: {
    op: 'add_constraint',
    returnType: 'same_shape',
    fields: [
      { name: 'type', type: 'string', required: false },
      { name: 'fixedPartName', type: 'PartName', required: false },
      { name: 'movingPartName', type: 'PartName', required: false },
      { name: 'fixedFace', type: 'any', required: false },
      { name: 'movingFace', type: 'any', required: false },
    ],
  },
  do_assemble: {
    op: 'do_assemble',
    returnType: 'void',
    fields: [],
  },
}

// ── 校验逻辑 ──

export interface ValidationError {
  field: string
  message: string
}

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
 * 校验单条语句的 args 是否满足其 op 的 schema。
 *
 * @returns 错误列表，空数组表示通过
 */
export function validateStatementArgs(stmt: CadStatement): ValidationError[] {
  const schema = SCHEMAS[stmt.op]
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

  // 赋值校验（与 parser 层双重保障）
  const rt = stmt.returnType ?? schema.returnType ?? 'new_shape'
  if (rt === 'void' && stmt.hasAssignment) {
    errors.push({
      field: 'assignment',
      message: `op "${stmt.op}" is void, cannot assign to a variable`,
    })
  }
  if ((rt === 'new_shape' || rt === 'scalar') && !stmt.hasAssignment) {
    errors.push({
      field: 'assignment',
      message: `op "${stmt.op}" returns ${rt}, must assign to a variable`,
    })
  }

  return errors
}

/**
 * 校验整个 PartScript 的所有语句。
 *
 * @returns 错误列表，空数组表示全部通过
 */
export function validateScriptArgs(
  statements: CadStatement[],
): Array<{ statementId: string; errors: ValidationError[] }> {
  const results: Array<{ statementId: string; errors: ValidationError[] }> = []
  for (const stmt of statements) {
    const errors = validateStatementArgs(stmt)
    if (errors.length > 0) {
      results.push({ statementId: stmt.id, errors })
    }
  }
  return results
}

/** 获取 op 的 schema（供外部查询） */
export function getOpSchema(op: string): OpSchema | undefined {
  return SCHEMAS[op]
}

/** 获取 op 的返回值类型 */
export function getOpReturnType(op: string): ReturnType {
  return SCHEMAS[op]?.returnType ?? 'new_shape'
}

/** 判断 op 是否有 schema */
export function hasOpSchema(op: string): boolean {
  return op in SCHEMAS
}
