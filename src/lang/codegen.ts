/**
 * codegen — 语句 → 文本 确定性生成器（S-5 不变式）（L0，仅依赖 ./types）
 *
 * 设计文档：docs/syntax-design.md §2（扁平代码格式）
 *
 * 职责：
 * - statementToLine(stmt)：按 op 输出可读单行语句（如 `const part0_v0 = cad.box({ size:20 })`）
 *   用于 TimelinePanel 显示和用户导出
 * - scriptToCode(script)：按语句顺序拼接为代码文本（无 export/return 封装）
 *
 * 扁平代码格式（无 export default / async / await / return / apiVersion）：
 * ```js
 * const part0_v0 = cad.box({ size: 20 })
 * const part0_v1 = cad.translate(part0_v0, { offset: [1, 2, 3] })
 * ```
 *
 * 约束：
 * - 纯函数、无副作用，便于单测
 * - 覆盖全部 op（与 parser 的 switch 对齐，保证「文本 ↔ 语句」同构）
 * - terminal shapes 自动推导：不被任何其他语句引用的输出即终端
 *
 * 值格式约定（确定性输出，parser 按此反解）：
 * - vec3 → `[1,2,3]`（紧凑无空格）
 * - 数字 → 整数直出；小数最多保留 6 位有效小数并去尾零
 * - 字符串 → 单引号包裹
 * - ParamRef → 裸标识符 `name`（无 $ 前缀）
 * - GeomRef → `cad.faceCenter(of)` / `cad.faceCenter(of, [anchorPoint])`
 * - 对象字面量 → `{key:value}`（冒号，合法 JS）
 */

import type { Arg, AssetRef, CadStatement, GeomRef, PartScript, ParamRef, Vec3 } from './types'
import { isAssetRef, isGeomRef, isParamRef } from './types'

// ── 数值格式化 ──

/** 数字 → 文本：整数直出，小数保留最多 6 位有效小数并去尾零 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(6)
  return s.replace(/\.?0+$/, '')
}

/** vec3 → 文本：`[1,2,3]` */
function fmtVec3(v: Vec3 | number): string {
  if (typeof v === 'number') return fmtNum(v)
  return `[${v.map(fmtNum).join(',')}]`
}

/** 参数值 → 文本（递归） */
function fmtValue(value: Arg, varNames?: Map<string, string>): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return fmtNum(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return `'${escapeStr(value)}'`
  if (isParamRef(value)) return fmtParamRef(value)
  if (isAssetRef(value)) return fmtAssetRef(value)
  if (isGeomRef(value)) return fmtGeomRef(value, varNames)
  if (Array.isArray(value)) return `[${value.map(v => fmtValue(v, varNames)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, Arg>)
    return `{${entries.map(([k, v]) => `${k}:${fmtValue(v, varNames)}`).join(', ')}}`
  }
  return String(value)
}

/** 字符串转义：单引号与反斜杠 */
function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** ParamRef → 裸标识符 `name`（文本形式中无 $ 前缀，合法 JS） */
function fmtParamRef(ref: ParamRef): string {
  return ref.$param
}

/** AssetRef → `cad.asset('key')` */
function fmtAssetRef(ref: AssetRef): string {
  return `cad.asset('${escapeStr(ref.$asset)}')`
}

/** GeomRef → `cad.faceCenter(of)` / `cad.faceCenter(of, [anchorPoint])` / `cad.faceCenter(of, [anchorPoint], faceOrdinal)` */
function fmtGeomRef(ref: GeomRef, varNames?: Map<string, string>): string {
  const { of, feature, anchor, faceOrdinal } = ref.$geom
  const varName = varNames?.get(of) ?? of
  const suffix = anchor
    ? `, ${fmtVec3(anchor.point)}`
    : (faceOrdinal !== undefined ? ', null' : '')
  const ordinalSuffix = faceOrdinal !== undefined ? `, ${faceOrdinal}` : ''
  return `cad.${feature}(${varName}${suffix}${ordinalSuffix})`
}

// ── 语句 args → key:value 片段数组 ──

/**
 * 将单条语句的 args 转为 `['key:value', ...]` 数组。
 * 每个 op 输出固定顺序的参数（省略默认值/冗余字段），与 parser 的 switch 对齐。
 */
export function buildArgsParts(stmt: CadStatement, varNames?: Map<string, string>): string[] {
  const args = stmt.args
  const parts: string[] = []
  const push = (key: string, value: Arg | undefined, skip?: (v: Arg) => boolean): void => {
    if (value === undefined) return
    if (skip && skip(value)) return
    parts.push(`${key}:${fmtValue(value, varNames)}`)
  }

  switch (stmt.op) {
    // ── 创建 ──
    case 'box': {
      push('size', args.size)
      push('center', args.center)
      push('nRad', args.nRad, (v) => v === 32)
      break
    }
    case 'sphere': {
      push('radius', args.radius)
      push('segments', args.segments)
      push('center', args.center)
      push('nRad', args.nRad, (v) => v === 32)
      break
    }
    case 'cylinder': {
      push('radius', args.radius)
      push('height', args.height)
      push('segments', args.segments)
      push('center', args.center)
      push('nRad', args.nRad, (v) => v === 32)
      break
    }
    case 'cone': {
      push('radiusBottom', args.radiusBottom)
      push('radiusTop', args.radiusTop)
      push('height', args.height)
      push('segments', args.segments)
      push('center', args.center)
      push('nRad', args.nRad, (v) => v === 32)
      break
    }
    case 'wedge': {
      push('width', args.width)
      push('height', args.height)
      push('angle', args.angle)
      push('length', args.length)
      push('center', args.center)
      push('nRad', args.nRad, (v) => v === 32)
      break
    }

    // ── 变换 ──
    case 'translate': {
      push('offset', args.offset)
      break
    }
    case 'rotate': {
      push('anglesDeg', args.anglesDeg)
      push('pivot', args.pivot)
      break
    }
    case 'scale': {
      push('factor', args.factor)
      break
    }

    // ── 钻孔 ──
    case 'drill': {
      const holeType = (args.holeType as string | undefined) ?? 'simple'
      push('diameter', args.diameter)
      push('depth', args.depth)
      push('position', args.position)
      push('faceNormal', args.faceNormal)
      push('direction', args.direction, (v) => v === 'normal' || v === undefined)
      push('holeType', args.holeType, (v) => v === 'simple')
      push('tolerance', args.tolerance, (v) => v === 0.3)
      if (holeType === 'screw') {
        push('screwSystem', args.screwSystem)
        push('screwSpecIdx', args.screwSpecIdx)
        push('screwThread', args.screwThread)
        push('screwHead', args.screwHead)
      }
      break
    }

    // ── 分割 ──
    case 'split': {
      push('normal', args.normal, (v) => Array.isArray(v) && (v as number[]).every((n, i) => n === (i === 2 ? 1 : 0)))
      push('offset', args.offset, (v) => v === 0)
      push('inPlaneAngleDeg', args.inPlaneAngleDeg, (v) => v === 0)
      push('side', args.side)
      push('cutMode', args.cutMode, (v) => v === 'plane')
      push('bbCenter', args.bbCenter)
      push('bboxSize', args.bboxSize)
      push('grooveDepth', args.grooveDepth)
      push('grooveWidth', args.grooveWidth)
      push('grooveDepthTolerance', args.grooveDepthTolerance)
      push('grooveWidthTolerance', args.grooveWidthTolerance)
      push('grooveFlapsAngle', args.grooveFlapsAngle)
      push('dowelDiameter', args.dowelDiameter)
      push('dowelDiameterTolerance', args.dowelDiameterTolerance)
      push('dowelHeight', args.dowelHeight)
      push('dowelHeightTolerance', args.dowelHeightTolerance)
      push('tenonSideLength', args.tenonSideLength)
      push('tenonSideLengthTolerance', args.tenonSideLengthTolerance)
      push('tenonHeight', args.tenonHeight)
      push('tenonHeightTolerance', args.tenonHeightTolerance)
      push('selectedSections', args.selectedSections)
      push('applyExplode', args.applyExplode)
      push('frontPartName', args.frontPartName)
      push('backPartName', args.backPartName)
      break
    }

    // ── 拉伸 ──
    case 'extrude': {
      push('length', args.length)
      push('mode', args.mode, (v) => v === 'centered')
      push('normal', args.normal, (v) => Array.isArray(v) && (v as number[]).every((n) => n === 0))
      push('originOffset', args.originOffset, (v) => v === 0)
      push('space', args.space)
      break
    }

    // ── 布尔 ──
    case 'boolean': {
      break
    }

    // ── 雕刻 ──
    case 'engrave': {
      push('text', args.text, (v) => v === '')
      push('depth', args.depth)
      push('textSize', args.textSize)
      push('svg', args.svg)
      push('svgSize', args.svgSize)
      push('mode', args.mode, (v) => v === 'concave' || v === undefined)
      push('faceCenter', args.faceCenter)
      push('faceNormal', args.faceNormal)
      break
    }

    // ── 滚花 ──
    case 'knurl': {
      push('knurlTextureHeight', args.knurlTextureHeight)
      push('knurlScaleU', args.knurlScaleU)
      push('knurlScaleV', args.knurlScaleV)
      push('knurlInvertDisplacement', args.knurlInvertDisplacement)
      push('knurlRefineLength', args.knurlRefineLength)
      push('knurlMappingMode', args.knurlMappingMode)
      push('faceCenter', args.faceCenter)
      push('faceNormal', args.faceNormal)
      break
    }

    // ── 文字 ──
    case 'text': {
      push('text', args.text)
      push('size', args.size)
      push('depth', args.depth)
      break
    }

    // ── 螺丝 ──
    case 'screw': {
      push('system', args.system)
      push('specIdx', args.specIdx)
      push('thread', args.thread)
      push('pitchCustom', args.pitchCustom)
      push('length', args.length)
      push('head', args.head)
      push('nRad', args.nRad, (v) => v === 32)
      break
    }

    // ── SVG 挤出 ──
    case 'svgExtrude': {
      push('svg', args.svg)
      push('depth', args.depth)
      push('targetLongSide', args.targetLongSide)
      break
    }

    // ── SDF ──
    case 'sdf': {
      push('code', args.code)
      push('box', args.box)
      push('resolution', args.resolution)
      push('params', args.params)
      break
    }

    // ── 加载 ──
    case 'load': {
      push('key', args.key)
      push('path', args.path)
      push('url', args.url)
      push('format', args.format)
      break
    }

    // ── 分组 / 装配（结构型语句） ──
    case 'group': {
      push('name', args.name)
      push('members', args.members)
      break
    }
    case 'assembly': {
      push('name', args.name)
      push('members', args.members)
      push('constraints', args.constraints)
      break
    }
    case 'add_constraint': {
      push('type', args.type, (v) => v === 'face_mate')
      push('fixedPartName', args.fixedPartName)
      push('movingPartName', args.movingPartName)
      push('fixedFace', args.fixedFace)
      push('movingFace', args.movingFace)
      break
    }
    case 'do_assemble': {
      break
    }

    default: {
      for (const [k, v] of Object.entries(args)) {
        parts.push(`${k}:${fmtValue(v, varNames)}`)
      }
    }
  }

  return parts
}

// ── 语句 → 代码行 ──

/** 检测 id 是否已是 partN_vM 或 partN 格式 */
const PART_RE = /^part\d+$/
const PART_VM_RE = /^part\d+_v\d+$/

/** 从语句获取主输出变量名（单输出取 outputs[0]；无输出回退 stmt.id） */
function primaryOutput(stmt: CadStatement): string {
  return stmt.outputs[0] ?? stmt.id
}

/**
 * 将单条语句转为可读代码行（用于 TimelinePanel 显示和导出）。
 *
 * 输出格式：`const partN_vM = cad.op(inputs, { key: value, ... })`
 * - boolean op 输出 `const partN_vM = cad.operation(input0, input1)`
 * - 多输出 split 输出 `const { front: out0, back: out1 } = cad.split(input, { ... })`
 * - group/assembly 输出 `const grpN = cad.group({ ... })` / `const grpN = cad.assembly({ ... })`
 * - add_constraint 输出 `assem1.add_constraint({ ... })`
 * - do_assemble 输出 `assem1.do_assemble()`
 */
export function statementToLine(stmt: CadStatement): string {
  // 结构型语句按 op 输出（group/assembly 需赋值）
  if (stmt.op === 'group' || stmt.op === 'assembly') {
    const parts = buildArgsParts(stmt)
    const varName = primaryOutput(stmt)
    return `let ${varName} = cad.${stmt.op}({ ${parts.join(', ')} })`
  }

  if (stmt.op === 'add_constraint') {
    const parts = buildArgsParts(stmt)
    const target = stmt.assemblyTarget ?? primaryOutput(stmt)
    return `${target}.add_constraint({ ${parts.join(', ')} })`
  }
  if (stmt.op === 'do_assemble') {
    const target = stmt.assemblyTarget ?? primaryOutput(stmt)
    return `${target}.do_assemble()`
  }

  const varName = primaryOutput(stmt)

  const inputVars = stmt.inputs.map((id) => {
    if (PART_RE.test(id) || PART_VM_RE.test(id)) return id
    return id.replace(/[^a-zA-Z0-9_]/g, '_')
  }).join(', ')

  const argsParts = buildArgsParts(stmt)

  const isMultiOutputSplit = stmt.outputs.length >= 2 && stmt.op === 'split'
  if (isMultiOutputSplit) {
    const filteredArgs = argsParts.filter((p) => !p.startsWith('side:'))
    const destructureParts = stmt.outputs.map((outId, idx) => {
      const key = idx === 0 ? 'front' : 'back'
      return `${key}: ${outId}`
    }).join(', ')
    const argsStr = filteredArgs.length > 0 ? `, { ${filteredArgs.join(', ')} }` : ''
    return `const { ${destructureParts} } = cad.${stmt.op}(${inputVars}${argsStr})`
  }

  let opCall: string
  if (stmt.op === 'boolean') {
    const operation = (stmt.args.operation as string | undefined) ?? 'union'
    opCall = `cad.${operation}(${inputVars})`
  } else if (argsParts.length === 0 && inputVars) {
    opCall = `cad.${stmt.op}(${inputVars})`
  } else if (inputVars) {
    opCall = `cad.${stmt.op}(${inputVars}, { ${argsParts.join(', ')} })`
  } else {
    const argsStr = argsParts.length > 0 ? ` ${argsParts.join(', ')} ` : ''
    opCall = `cad.${stmt.op}({${argsStr}})`
  }

  // Phase 3：单入单出复用输入名（let 重赋值）；无输入/单输出（let 首次声明）
  return `let ${varName} = ${opCall}`
}

// ── 脚本 → 扁平代码 ──

/**
 * 将整个 PartScript 按语句顺序拼接为扁平代码文本。
 *
 * 无 export/async/await/return/参数声明。
 * terminal shapes 自动推导：不被引用的输出即终端（不在代码中标注）。
 */
export function scriptToCode(script: PartScript): string {
  const bodyLines: string[] = []
  const varNames = new Map<string, string>()
  /** 已声明过的变量名集合（用于区分 let 首次声明 vs let 重赋值） */
  const declared = new Set<string>()

  // 参数声明：输出为 const name = literal
  for (const p of script.params) {
    bodyLines.push(`const ${p.name} = ${fmtValue(p.value as Arg)}`)
    varNames.set(p.name, p.name)
    declared.add(p.name)
  }

  for (const stmt of script.statements) {
    if (stmt.op === 'group' || stmt.op === 'assembly') {
      const argsParts = buildArgsParts(stmt, varNames)
      const varName = stmt.outputs[0] ?? stmt.id
      bodyLines.push(`let ${varName} = cad.${stmt.op}({ ${argsParts.join(', ')} })`)
      varNames.set(varName, varName)
      declared.add(varName)
      continue
    }
    if (stmt.op === 'add_constraint') {
      const argsParts = buildArgsParts(stmt, varNames)
      const target = stmt.assemblyTarget ?? (stmt.outputs[0] ?? stmt.id)
      bodyLines.push(`${target}.add_constraint({ ${argsParts.join(', ')} })`)
      continue
    }
    if (stmt.op === 'do_assemble') {
      const target = stmt.assemblyTarget ?? (stmt.outputs[0] ?? stmt.id)
      bodyLines.push(`${target}.do_assemble()`)
      continue
    }

    if (stmt.op === 'load') {
      const ref = (stmt.args.key as string | undefined) ?? (stmt.args.path as string | undefined) ?? (stmt.args.url as string | undefined) ?? ''
      bodyLines.push(`// source: load ${ref}`)
    }

    const varName = stmt.outputs[0] ?? stmt.id
    // 将 outputs 中的每个 partName 映射到自身，使下游 inputs 能解析
    for (const outId of stmt.outputs) {
      varNames.set(outId, outId)
    }
    if (stmt.outputs.length === 0) {
      varNames.set(stmt.id, varName)
    }

    if (stmt.outputs.length > 1) {
      for (const outId of stmt.outputs) {
        varNames.set(outId, outId)
        declared.add(outId)
      }
    }

    const isMultiOutputSplit = stmt.outputs.length >= 2 && stmt.op === 'split'

    let argsParts = buildArgsParts(stmt, varNames)
    if (isMultiOutputSplit) {
      argsParts = argsParts.filter((p) => !p.startsWith('side:'))
    }
    const inputVars = stmt.inputs.map((id) => {
      const mapped = varNames.get(id)
      if (!mapped) throw new Error(`[codegen] unresolved input reference "${id}" — PartScript is not self-contained`)
      return mapped
    }).join(', ')

    let opCall: string
    if (stmt.op === 'boolean') {
      const operation = (stmt.args.operation as string | undefined) ?? 'union'
      opCall = `cad.${operation}(${inputVars})`
    } else if (argsParts.length === 0 && inputVars) {
      opCall = `cad.${stmt.op}(${inputVars})`
    } else if (inputVars) {
      opCall = `cad.${stmt.op}(${inputVars}, { ${argsParts.join(', ')} })`
    } else {
      const argsStr = argsParts.length > 0 ? ` ${argsParts.join(', ')} ` : ''
      opCall = `cad.${stmt.op}({${argsStr}})`
    }

    if (isMultiOutputSplit) {
      const destructureParts = stmt.outputs.map((outId, idx) => {
        const key = idx === 0 ? 'front' : 'back'
        return `${key}: ${outId}`
      }).join(', ')
      bodyLines.push(`const { ${destructureParts} } = ${opCall}`)
    } else {
      // Phase 3：单入单出复用输入名 → 已声明则直接重赋值，未声明则首次 let
      if (declared.has(varName)) {
        bodyLines.push(`${varName} = ${opCall}`)
      } else {
        bodyLines.push(`let ${varName} = ${opCall}`)
        declared.add(varName)
      }
    }
  }

  return bodyLines.join('\n')
}


