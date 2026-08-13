/**
 * codegen — 语句 → 文本 确定性生成器（S-5 不变式）（L0，仅依赖 ./types）
 *
 * 设计文档：docs/faijs-syntax-design.md §2（扁平代码格式）
 *
 * 职责：
 * - statementToLine(stmt)：按 op 输出可读单行语句（如 `const part0_v0 = cad.box({ size:20 })`）
 *   用于 TimelinePanel 显示和用户导出
 * - scriptToFlatCode(script)：按语句顺序拼接为扁平代码文本（无 export/return 封装）
 * - sceneToFlatCode(scripts, getPartMeta?)：多 PartScript 合并为单一 DAG 扁平代码
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
      push('frontPartId', args.frontPartId)
      push('backPartId', args.backPartId)
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

    // ── 分组 / 装配（结构型 marker） ──
    case 'group': {
      push('name', args.name)
      push('members', args.members)
      break
    }
    case 'assembly': {
      push('name', args.name)
      push('members', args.members)
      push('constraints', args.constraints)
      push('transform', args.transform)
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

/** 检测 id 是否已是 partN_vM 格式 */
const PART_VM_RE = /^part\d+_v\d+$/

/**
 * 将单条语句转为可读代码行（用于 TimelinePanel 显示和导出）。
 *
 * 输出格式：`const partN_vM = cad.op(inputs, { key: value, ... })`
 * - boolean op 输出 `const partN_vM = cad.operation(input0, input1)`
 * - 多输出 split 输出 `const { front: out0, back: out1 } = cad.split(input, { ... })`
 * - marker 语句（非 group/assembly）输出 `// op`
 * - group/assembly marker 输出 `cad.group({ ... })` / `cad.assembly({ ... })`
 */
export function statementToLine(stmt: CadStatement): string {
  if (stmt.isMarker && stmt.op !== 'group' && stmt.op !== 'assembly') {
    return `// ${stmt.op}`
  }

  if (stmt.isMarker && (stmt.op === 'group' || stmt.op === 'assembly')) {
    const parts = buildArgsParts(stmt)
    return `cad.${stmt.op}({ ${parts.join(', ')} })`
  }

  const varName = PART_VM_RE.test(stmt.id) ? stmt.id : stmt.id.replace(/[^a-zA-Z0-9_]/g, '_')

  const inputVars = stmt.inputs.map((id) => {
    if (PART_VM_RE.test(id)) return id
    return id.replace(/[^a-zA-Z0-9_]/g, '_')
  }).join(', ')

  const argsParts = buildArgsParts(stmt)

  const isMultiOutputSplit = stmt.outputs && stmt.outputs.length >= 2 && stmt.op === 'split'
  if (isMultiOutputSplit) {
    const filteredArgs = argsParts.filter((p) => !p.startsWith('side:'))
    const destructureParts = stmt.outputs!.map((outId, idx) => {
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

  return `const ${varName} = ${opCall}`
}

// ── 脚本 → 扁平代码 ──

/**
 * 将整个 PartScript 按语句顺序拼接为扁平代码文本。
 *
 * 无 export/async/await/return/参数声明。
 * terminal shapes 自动推导：不被引用的输出即终端（不在代码中标注）。
 */
export function scriptToFlatCode(script: PartScript): string {
  const bodyLines: string[] = []
  const varNames = new Map<string, string>()
  let vIdx = 0

  // 参数声明：输出为 const name = literal
  for (const p of script.params) {
    bodyLines.push(`const ${p.name} = ${fmtValue(p.value as Arg)}`)
  }

  for (const stmt of script.statements) {
    if (stmt.isMarker && stmt.op !== 'group' && stmt.op !== 'assembly') continue

    if (stmt.isMarker && (stmt.op === 'group' || stmt.op === 'assembly')) {
      const argsParts = buildArgsParts(stmt, varNames)
      bodyLines.push(`cad.${stmt.op}({ ${argsParts.join(', ')} })`)
      continue
    }

    if (stmt.op === 'load') {
      const ref = (stmt.args.key as string | undefined) ?? (stmt.args.path as string | undefined) ?? (stmt.args.url as string | undefined) ?? ''
      bodyLines.push(`// source: load ${ref}`)
    }

    const v = PART_VM_RE.test(stmt.id) ? stmt.id : `part0_v${vIdx++}`
    varNames.set(stmt.id, v)

    if (stmt.outputs && stmt.outputs.length > 1) {
      for (const outId of stmt.outputs) {
        varNames.set(outId, outId)
      }
    }

    const isMultiOutputSplit = stmt.outputs && stmt.outputs.length >= 2 && stmt.op === 'split'

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
      const destructureParts = stmt.outputs!.map((outId, idx) => {
        const key = idx === 0 ? 'front' : 'back'
        return `${key}: ${outId}`
      }).join(', ')
      bodyLines.push(`const { ${destructureParts} } = ${opCall}`)
    } else {
      bodyLines.push(`const ${v} = ${opCall}`)
    }
  }

  return bodyLines.join('\n')
}

// ── 场景级 codegen：多 PartScript → 单一 DAG ──

/**
 * 将场景中所有 PartScript 合并为单一 DAG，生成扁平代码文本。
 *
 * - 全局 seq 是唯一权威顺序（天然拓扑序）
 * - 按 seq 遍历所有 part 语句直接输出
 * - split 合并、终端自动推导
 *
 * @param scripts 场景中所有 PartScript
 * @param getPartMeta 可选：按 partId 获取 meta（name/appearance）——在新架构中不再使用，保留仅为兼容
 */
export function sceneToFlatCode(
  scripts: PartScript[],
  _getPartMeta?: (partId: string) => unknown,
): string {
  if (scripts.length === 0) {
    return ''
  }
  if (scripts.length === 1) {
    return scriptToFlatCode(scripts[0])
  }

  // 构建 partId → PartScript 映射
  const partMap = new Map(scripts.map((s) => [s.partId, s]))
  const stmtToPart = new Map<string, string>()
  for (const script of scripts) {
    for (const stmt of script.statements) {
      stmtToPart.set(stmt.id, script.partId)
    }
  }

  // 识别 split marker，构建 processedSplitParts 集合
  const processedSplitParts = new Set<string>()
  for (const script of scripts) {
    for (const stmt of script.statements) {
      if (stmt.isMarker && stmt.op === 'split' && stmt.args.frontPartId && stmt.args.backPartId) {
        processedSplitParts.add(stmt.args.frontPartId as string)
        processedSplitParts.add(stmt.args.backPartId as string)
      }
    }
  }

  // 按全局 seq 排序所有语句
  type IndexedStmt = { stmt: CadStatement; partId: string; seq: number }
  const allStmts: IndexedStmt[] = []
  for (let si = 0; si < scripts.length; si++) {
    for (let ii = 0; ii < scripts[si].statements.length; ii++) {
      const stmt = scripts[si].statements[ii]
      const seq = stmt.seq ?? (si * 1_000_000 + ii)
      allStmts.push({ stmt, partId: scripts[si].partId, seq })
    }
  }
  allStmts.sort((a, b) => a.seq - b.seq)

  const mergedStatements: CadStatement[] = []
  const oldToNew = new Map<string, string>()
  const partToModel = new Map<string, string>()
  const partToVersion = new Map<string, number>()
  let nextModelNum = 0
  const processedIds = new Set<string>()

  for (const { stmt, partId } of allStmts) {
    if (processedIds.has(stmt.id)) continue
    processedIds.add(stmt.id)

    // split marker：合并 front/back 的 split 语句为解构语法
    if (stmt.isMarker && stmt.op === 'split' && stmt.args.frontPartId && stmt.args.backPartId) {
      const frontPartId = stmt.args.frontPartId as string
      const backPartId = stmt.args.backPartId as string
      const frontScript = partMap.get(frontPartId)
      const backScript = partMap.get(backPartId)

      if (frontScript && backScript) {
        const frontSplit = frontScript.statements.find((s) => s.op === 'split' && !s.isMarker)
        const backSplit = backScript.statements.find((s) => s.op === 'split' && !s.isMarker)

        if (frontSplit && backSplit) {
          const frontModel = `part${nextModelNum++}`
          const backModel = `part${nextModelNum++}`
          partToModel.set(frontPartId, frontModel)
          partToModel.set(backPartId, backModel)
          partToVersion.set(frontPartId, 0)
          partToVersion.set(backPartId, 0)

          const frontVar = `${frontModel}_v0`
          const backVar = `${backModel}_v0`

          const remappedInputs = frontSplit.inputs.map((id) => {
            const mapped = oldToNew.get(id)
            if (!mapped) throw new Error(`[sceneToFlatCode] unresolved input reference "${id}" during DAG merge`)
            return mapped
          })

          const { side: _s, frontPartId: _f, backPartId: _b, ...splitArgs } = frontSplit.args as Record<string, Arg>

          const mergedStmt: CadStatement = {
            id: frontVar,
            op: 'split',
            args: splitArgs,
            inputs: remappedInputs,
            feature: { ...frontSplit.feature },
            outputs: [frontVar, backVar],
          }
          mergedStatements.push(mergedStmt)
          oldToNew.set(frontSplit.id, frontVar)
          oldToNew.set(backSplit.id, backVar)
        }
      }
      continue
    }

    // group/assembly marker → 直接推入
    if (stmt.isMarker && (stmt.op === 'group' || stmt.op === 'assembly')) {
      mergedStatements.push({ ...stmt })
      continue
    }

    // 跳过其他 marker
    if (stmt.isMarker) continue

    // 跳过已合并的 split 语句
    if (processedSplitParts.has(partId) && stmt.op === 'split') continue

    // 分配新变量名
    const modelPrefix = partToModel.get(partId) ?? `part${nextModelNum++}`
    partToModel.set(partId, modelPrefix)
    if (!partToVersion.has(partId)) partToVersion.set(partId, 0)
    const version = partToVersion.get(partId) ?? 0
    const newVar = `${modelPrefix}_v${version}`
    partToVersion.set(partId, version + 1)
    oldToNew.set(stmt.id, newVar)

    // 重映射 inputs
    const remappedInputs = stmt.inputs.map((id) => {
      const mapped = oldToNew.get(id)
      if (!mapped) throw new Error(`[sceneToFlatCode] unresolved input reference "${id}" during DAG merge`)
      return mapped
    })

    // 重映射 args 中 GeomRef 的 of 字段
    const remappedArgs: Record<string, Arg> = {}
    for (const [k, v] of Object.entries(stmt.args)) {
      if (isGeomRef(v) && v.$geom.of) {
        const mappedOf = oldToNew.get(v.$geom.of)
        remappedArgs[k] = mappedOf ? { ...v, $geom: { ...v.$geom, of: mappedOf } } : v
      } else {
        remappedArgs[k] = v
      }
    }

    mergedStatements.push({
      ...stmt,
      id: newVar,
      args: remappedArgs,
      inputs: remappedInputs,
      model: modelPrefix,
    })
  }

  // 构建 partId → last variable name 映射（用于 group/assembly members 映射）
  const partIdToLastVar = new Map<string, string>()
  for (const script of scripts) {
    const partId = script.partId
    const lastStmt = [...script.statements].reverse().find((s) => {
      if (s.isMarker) return false
      if (s.op === 'split' && processedSplitParts.has(partId)) return false
      return true
    })
    if (lastStmt) {
      const newVar = oldToNew.get(lastStmt.id)
      if (newVar) partIdToLastVar.set(partId, newVar)
    }
  }
  for (const [oldId, newId] of oldToNew) {
    const partId = stmtToPart.get(oldId)
    if (partId && !partIdToLastVar.has(partId)) {
      partIdToLastVar.set(partId, newId)
    }
  }

  // Post-process: map group/assembly markers' members/constraints from scopedIds to faijs var names
  for (let i = 0; i < mergedStatements.length; i++) {
    const stmt = mergedStatements[i]
    if (!stmt.isMarker || (stmt.op !== 'group' && stmt.op !== 'assembly')) continue
    const mappedArgs: Record<string, Arg> = { ...stmt.args }
    const members = stmt.args.members as string[] | undefined
    if (members) {
      mappedArgs.members = members.map((refId) => partIdToLastVar.get(refId) ?? refId)
    }
    if (stmt.op === 'assembly' && stmt.args.constraints) {
      const constraints = (stmt.args.constraints as unknown[]).map((c) => {
        const constraint = c as Record<string, unknown>
        const mapped: Record<string, unknown> = {}
        if (typeof constraint.fixedPartId === 'string') {
          mapped.fixedPartId = partIdToLastVar.get(constraint.fixedPartId as string) ?? constraint.fixedPartId
        }
        if (typeof constraint.movingPartId === 'string') {
          mapped.movingPartId = partIdToLastVar.get(constraint.movingPartId as string) ?? constraint.movingPartId
        }
        if (constraint.fixedFace) {
          const fixedFace = constraint.fixedFace as Record<string, unknown>
          mapped.fixedFace = { faceId: fixedFace.faceId, surfaceType: fixedFace.surfaceType }
        }
        if (constraint.movingFace) {
          const movingFace = constraint.movingFace as Record<string, unknown>
          mapped.movingFace = { faceId: movingFace.faceId, surfaceType: movingFace.surfaceType }
        }
        return mapped
      })
      mappedArgs.constraints = constraints as Arg
    }
    mergedStatements[i] = { ...stmt, args: mappedArgs }
  }

  const mergedScript: PartScript = {
    partId: 'scene',
    params: [],
    statements: mergedStatements,
  }

  return scriptToFlatCode(mergedScript)
}
