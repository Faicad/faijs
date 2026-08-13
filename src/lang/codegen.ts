/**
 * codegen — 语句 → 文本 确定性生成器（S-5 不变式）（L0，仅依赖 acorn + ./types）
 *
 * 设计文档：docs/faijs-syntax-design.md §2（合法 JS 子集）
 *
 * 职责：
 * - statementToCode(stmt)：按 op 输出可读语句（如 `cad.box({ size:[10,10,10] })`）——用于 TimelinePanel 显示
 * - scriptToCode(script)：按语句顺序拼接为 `export default async (cad) => { ... }` 合法 JS 子集文本
 *
 * 约束：
 * - 纯函数、无副作用，便于单测
 * - 覆盖全部 op（与 replay-validator.executeStatement 的 switch 对齐，保证「文本 ↔ 语句」同构）
 * - 产物是合法 JS 子集：acorn.parse 不抛错（J-1）
 *
 * 值格式约定（确定性输出，parser 按此反解）：
 * - vec3 → `[1,2,3]`（紧凑无空格）
 * - 数字 → 整数直出；小数最多保留 6 位有效小数并去尾零
 * - 字符串 → 单引号包裹
 * - ParamRef → 裸标识符 `name`（无 $ 前缀）
 * - GeomRef → `cad.faceCenter(of)` / `cad.faceCenter(of, [anchorPoint])`
 * - 对象字面量 → `{key:value}`（冒号，合法 JS）
 *
 * 统一 async（§6.1）：所有 cad.* op 统一加 await，不再区分同步/异步。
 */

import type { Arg, AssetRef, CadStatement, GeomRef, PartScript, PartScriptMeta, ParamRef, TerminalShape, Vec3 } from './types'
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
// 解析变量名：如果有 varNames 映射（scriptToCode 场景），用变量名；否则直接用 of（statementToCode 场景）
const varName = varNames?.get(of) ?? of
// 有 anchor → 输出 anchor point；无 anchor 但有 faceOrdinal → 输出 null 占位；都无 → 空串
const suffix = anchor
? `, ${fmtVec3(anchor.point)}`
: (faceOrdinal !== undefined ? ', null' : '')
const ordinalSuffix = faceOrdinal !== undefined ? `, ${faceOrdinal}` : ''
return `cad.${feature}(${varName}${suffix}${ordinalSuffix})`
}

// ── 语句 args → key:value 片段数组 ──

/**
 * 将单条语句的 args 转为 `['key:value', ...]` 数组。
 * 每个 op 输出固定顺序的参数（省略默认值/冗余字段），与 executeStatement 的 switch 对齐。
 *
 * 这是 statementToCode 和 scriptToCode 共用的核心逻辑。
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
      break
    }
    case 'sphere': {
      push('radius', args.radius)
      push('segments', args.segments)
      push('center', args.center)
      break
    }
    case 'cylinder': {
      push('radius', args.radius)
      push('height', args.height)
      push('segments', args.segments)
      push('center', args.center)
      break
    }
    case 'cone': {
      push('radiusBottom', args.radiusBottom)
      push('radiusTop', args.radiusTop)
      push('height', args.height)
      push('segments', args.segments)
      push('center', args.center)
      break
    }
    case 'wedge': {
      push('width', args.width)
      push('height', args.height)
      push('angle', args.angle)
      push('length', args.length)
      push('center', args.center)
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

    // ── 分割（直接序列化 normal/offset/inPlaneAngleDeg） ──
    case 'split': {
      push('normal', args.normal, (v) => Array.isArray(v) && (v as number[]).every((n, i) => n === (i === 2 ? 1 : 0)))
      push('offset', args.offset, (v) => v === 0)
      push('inPlaneAngleDeg', args.inPlaneAngleDeg, (v) => v === 0)
      push('side', args.side)
      push('cutMode', args.cutMode, (v) => v === 'plane')
      push('bbCenter', args.bbCenter)
      push('bboxSize', args.bboxSize)
      // 燕尾参数
      push('grooveDepth', args.grooveDepth)
      push('grooveWidth', args.grooveWidth)
      push('grooveDepthTolerance', args.grooveDepthTolerance)
      push('grooveWidthTolerance', args.grooveWidthTolerance)
      push('grooveFlapsAngle', args.grooveFlapsAngle)
      // 定位销参数
      push('dowelDiameter', args.dowelDiameter)
      push('dowelDiameterTolerance', args.dowelDiameterTolerance)
      push('dowelHeight', args.dowelHeight)
      push('dowelHeightTolerance', args.dowelHeightTolerance)
      // 直榫参数
      push('tenonSideLength', args.tenonSideLength)
      push('tenonSideLengthTolerance', args.tenonSideLengthTolerance)
      push('tenonHeight', args.tenonHeight)
      push('tenonHeightTolerance', args.tenonHeightTolerance)
      // 截面选择
      push('selectedSections', args.selectedSections)
      push('applyExplode', args.applyExplode)
      // 源语句的 frontPartId/backPartId（标记型语句用，正常输出不会到达这里因为 isMarker 被跳过）
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
      // boolean 的 operation 变为函数名（cad.union/subtract/intersect），不进 args 对象
      // inputs 变为位置实参，也不进 args 对象
      // sourcePartIds 不输出（内部元数据）
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
      // nRad：径向分段数（拓扑参数，决定 mesh 几何输出）
      // 默认 32；非默认值时序列化到 .faijs 以保证几何可复现
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
      // 未知 op：兜底输出全部 args（保持可读性与确定性）
      for (const [k, v] of Object.entries(args)) {
        parts.push(`${k}:${fmtValue(v, varNames)}`)
      }
    }
  }

  return parts
}

// ── 语句 → 代码（显示用） ──

/**
 * 将单条语句转为可读代码（用于 TimelinePanel 显示）。
 *
 * 输出格式：`cad.op({ key: value, ... })`
 * - boolean op 输出 `cad.operation(inputIds)`
 * - 不含 const 前缀和 await（仅显示 op 调用部分）
 */
export function statementToCode(stmt: CadStatement): string {
  // boolean：operation 变为函数名，inputs 变为位置实参
  if (stmt.op === 'boolean') {
    const operation = (stmt.args.operation as string | undefined) ?? 'union'
    const inputStr = stmt.inputs.length > 0 ? stmt.inputs.join(', ') : ''
    return `cad.${operation}(${inputStr})`
  }

  const parts = buildArgsParts(stmt)
  return `cad.${stmt.op}({ ${parts.join(', ')} })`
}

// ── meta 格式化 ──

/**
 * 格式化 PartScriptMeta 为 return 对象内的属性片段。
 * 返回空字符串表示无 meta。
 */
function formatMetaParts(meta?: PartScriptMeta): string {
  if (!meta) return ''
  const parts: string[] = []
  if (meta.name) {
    parts.push(`name: ${fmtValue(meta.name as Arg)}`)
  }
  if (meta.appearance) {
    if (meta.appearance.color) {
      parts.push(`color: ${fmtValue(meta.appearance.color as Arg)}`)
    }
    if (meta.appearance.metalness !== undefined) {
      parts.push(`metalness: ${fmtNum(meta.appearance.metalness)}`)
    }
    if (meta.appearance.roughness !== undefined) {
      parts.push(`roughness: ${fmtNum(meta.appearance.roughness)}`)
    }
  }
  return parts.join(', ')
}

// ── 脚本 → 代码 ──

/** 检测 id 是否已是 partN_vM 格式（parser 产出的多 mesh DAG） */
const PART_VM_RE = /^part\d+_v\d+$/

/** 格式化单个 TerminalShape 为 return 数组元素 */
function formatTerminalEntry(varName: string, meta?: PartScriptMeta): string {
  const metaParts = formatMetaParts(meta)
  if (metaParts) {
    return `{ shape: ${varName}, ${metaParts} }`
  }
  return `{ shape: ${varName} }`
}

/**
 * 将整个 PartScript 按语句顺序拼接为合法 JS 子集文本。
 *
 * 输出格式（设计文档 §2.1 单 mesh 形态 / §2.2 多 mesh 形态）：
 * ```js
 * // apiVersion: 1
 * export default async (cad) => {
 *   const size = 20
 *   const part0_v0 = await cad.box({ size: size })
 *   const part0_v1 = await cad.drill(part0_v0, { diameter: 5, depth: 0 })
 *   return { shape: part0_v1, name: '支架底板', color: '#4A90D9' }
 * }
 * ```
 *
 * 多 mesh 形态（当 script.terminalShapes 有多个元素时）：
 * ```js
 *   const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v2, { ... })
 *   return [ { shape: part1_v1, name: 'A', color: '#4A90D9' }, { shape: part2_v0, name: 'B' } ]
 * ```
 *
 * - `export default async (cad) => { ... }` 是合法 JS 容器（让 await 合法、整段是合法 ES module）
 * - 语句 id 如果已是 `partN_vM` 格式则直接用作变量名；否则生成 `part0_vN`
 * - split 语句如有 `outputs` 则输出解构语法 `const { front: ..., back: ... } = await cad.split(...)`
 * - 所有 op 统一加 await（§6.1 统一 async）
 * - boolean op → `cad.union/subtract/intersect(inputs)`
 * - 零件属性只在 return 里
 */
export function scriptToCode(script: PartScript): string {
  const bodyLines: string[] = []

  // 参数声明：const name = literal
  for (const p of script.params) {
    bodyLines.push(`const ${p.name} = ${fmtValue(p.value as Arg)}`)
  }

  // 语句 → 变量名映射
  const varNames = new Map<string, string>()
  let vIdx = 0
  for (const stmt of script.statements) {
    // A-7: 跳过 split 标记型语句，不输出到 .faijs 文本
    // 但 group/assembly marker 需要输出（结构信息的唯一载体）
    if (stmt.isMarker && stmt.op !== 'group' && stmt.op !== 'assembly') continue

    // Group/Assembly markers: emit as bare calls (no const, no variable)
    if (stmt.isMarker && (stmt.op === 'group' || stmt.op === 'assembly')) {
const argsParts = buildArgsParts(stmt, varNames)
bodyLines.push(`cad.${stmt.op}({ ${argsParts.join(', ')} })`)
      continue
    }

    // load 源标注注释
    if (stmt.op === 'load') {
      const ref = (stmt.args.key as string | undefined) ?? (stmt.args.path as string | undefined) ?? (stmt.args.url as string | undefined) ?? ''
      bodyLines.push(`// source: load ${ref}`)
    }

    // 变量名：如果 id 已是 partN_vM 格式则直接用，否则生成 part0_vN
    const v = PART_VM_RE.test(stmt.id) ? stmt.id : `part0_v${vIdx++}`
    varNames.set(stmt.id, v)

    // 如果是多输出 split（有 outputs），注册所有输出变量名
    if (stmt.outputs && stmt.outputs.length > 1) {
      for (const outId of stmt.outputs) {
        varNames.set(outId, outId)
      }
    }

    const isMultiOutputSplit = stmt.outputs && stmt.outputs.length >= 2 && stmt.op === 'split'

    // 解构 split 不输出 side（front/back 都返回，side 无意义）
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
      // boolean：operation 变为函数名，inputs 变为位置实参
      const operation = (stmt.args.operation as string | undefined) ?? 'union'
      opCall = `cad.${operation}(${inputVars})`
    } else if (argsParts.length === 0 && inputVars) {
      // 无 args，仅有 inputs
      opCall = `cad.${stmt.op}(${inputVars})`
    } else if (inputVars) {
      // 有 inputs 和 args
      opCall = `cad.${stmt.op}(${inputVars}, { ${argsParts.join(', ')} })`
    } else {
      // 仅有 args（或空 args）
      const argsStr = argsParts.length > 0 ? ` ${argsParts.join(', ')} ` : ''
      opCall = `cad.${stmt.op}({${argsStr}})`
    }

    // 统一 async（§6.1）：所有 op 加 await
    const prefix = 'await '

    // 多输出 split → 解构语法
    if (isMultiOutputSplit) {
      const destructureParts = stmt.outputs!.map((outId, idx) => {
        const key = idx === 0 ? 'front' : 'back'
        return `${key}: ${outId}`
      }).join(', ')
      bodyLines.push(`const { ${destructureParts} } = ${prefix}${opCall}`)
    } else {
      bodyLines.push(`const ${v} = ${prefix}${opCall}`)
    }
  }

  // return 语句
  if (script.terminalShapes && script.terminalShapes.length > 0) {
    // 多终端 return [ { shape: ..., meta }, ... ]
    const entries = script.terminalShapes.map((ts) => {
      const varName = varNames.get(ts.id) ?? ts.id
      return formatTerminalEntry(varName, ts.meta)
    })
    if (entries.length === 1) {
      bodyLines.push(`return ${entries[0]}`)
    } else {
      bodyLines.push(`return [\n${entries.map((e) => '    ' + e).join(',\n')}\n  ]`)
    }
  } else {
    // 单终端：return { shape: part0_vN, ...meta }
    const lastNonMarker = [...script.statements].reverse().find((s) => !s.isMarker)
    if (lastNonMarker) {
      const lastV = varNames.get(lastNonMarker.id) ?? 'part0_v0'
      const metaParts = formatMetaParts(script.meta)
      if (metaParts) {
        bodyLines.push(`return { shape: ${lastV}, ${metaParts} }`)
      } else {
        bodyLines.push(`return { shape: ${lastV} }`)
      }
    }
  }

  // 空脚本：仍输出合法 JS 容器
  if (bodyLines.length === 0) {
    return `// apiVersion: 1\nexport default async (cad) => {}`
  }

  return `// apiVersion: 1\nexport default async (cad) => {\n${bodyLines.map((l) => '  ' + l).join('\n')}\n}`
}

// ── 场景级 codegen：多 PartScript → 单一 DAG ──

/**
 * 将场景中所有 PartScript 合并为单一 DAG，生成合法 JS 子集文本。
 *
 * 设计文档 §2.2 / P4 烘焙执行引擎设计 §3.5：
 * - 全局 seq 是唯一权威顺序（天然拓扑序），不再使用 Kahn 算法
 * - 按 seq 遍历所有 part 语句直接输出，删除依赖图/拓扑排序/重命名表
 * - split 合并、终端收集、group 映射保留
 *
 * @param scripts 场景中所有 PartScript
 * @param getPartMeta 可选：按 partId 获取 meta（name/appearance）
 */
export function sceneToCode(
  scripts: PartScript[],
  getPartMeta?: (partId: string) => PartScriptMeta | undefined,
): string {
  if (scripts.length === 0) {
    return '// apiVersion: 1\nexport default async (cad) => {}'
  }
  if (scripts.length === 1) {
    const script = scripts[0]
    if (!script.meta && getPartMeta) {
      const meta = getPartMeta(script.partId)
      if (meta) return scriptToCode({ ...script, meta })
    }
    return scriptToCode(script)
  }

  // 构建 partId → PartScript 映射
  const partMap = new Map(scripts.map((s) => [s.partId, s]))

  // 构建 statementId → partId 映射（用于跨 part 引用查找）
  const stmtToPart = new Map<string, string>()
  for (const script of scripts) {
    for (const stmt of script.statements) {
      stmtToPart.set(stmt.id, script.partId)
    }
  }

  // P4: 第一遍——识别 split marker，构建 processedSplitParts 集合
  // split marker 的 frontPartId/backPartId 对应的 part 的 split 语句将被合并为解构语法，
  // 不单独输出。必须在排序前识别，因为 split marker 的 seq 可能大于 front/back 语句的 seq。
  const processedSplitParts = new Set<string>()
  for (const script of scripts) {
    for (const stmt of script.statements) {
      if (stmt.isMarker && stmt.op === 'split' && stmt.args.frontPartId && stmt.args.backPartId) {
        processedSplitParts.add(stmt.args.frontPartId as string)
        processedSplitParts.add(stmt.args.backPartId as string)
      }
    }
  }

  // P4: 按全局 seq 排序所有语句（seq 是天然拓扑序）
  // seq 未定义时（测试场景/导入前），使用 (scriptIndex, stmtIndex) 作为回退顺序
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

  // P4: 按 seq 顺序遍历，分配模型号，合并语句
  const mergedStatements: CadStatement[] = []
  const oldToNew = new Map<string, string>()
  const partToModel = new Map<string, string>()
  const partToVersion = new Map<string, number>()
  let nextModelNum = 0
  // Deduplicate by statement id (sceneScript + partScripts may have overlapping copies)
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
            if (!mapped) throw new Error(`[sceneToCode] unresolved input reference "${id}" during DAG merge`)
            return mapped
          })

          // 从 args 中移除 side（解构形式不需要 side）
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

    // group/assembly marker → 不跳过，直接推入 mergedStatements
    // members/constraints 的 scopedId→变量名映射在主循环后统一处理
    if (stmt.isMarker && (stmt.op === 'group' || stmt.op === 'assembly')) {
      mergedStatements.push({ ...stmt })
      continue
    }

    // 跳过其他 marker
    if (stmt.isMarker) continue

    // 跳过已合并的 split 语句（front/back part 的 split 语句已通过 marker 合并）
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
      if (!mapped) throw new Error(`[sceneToCode] unresolved input reference "${id}" during DAG merge`)
      return mapped
    })

    // P5-2: 重映射 args 中 GeomRef 的 of 字段（从旧语句 ID → 新变量名）
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

  // 找终端 mesh：不被任何其他语句引用的输出
  const referencedIds = new Set<string>()
  for (const stmt of mergedStatements) {
    for (const inputId of stmt.inputs) {
      referencedIds.add(inputId)
    }
  }

  // 构建 newVar → partId 反向映射（用于查找 split 输出对应的 part meta）
  const newVarToPartId = new Map<string, string>()
  for (const [oldId, newId] of oldToNew) {
    const partId = stmtToPart.get(oldId)
    if (partId) newVarToPartId.set(newId, partId)
  }

  // 终端 = 每个 part 的最后一条有效语句，且该语句不被其他语句引用
  const terminalShapes: TerminalShape[] = []
  const seenTerminals = new Set<string>()
  for (const script of scripts) {
    const partId = script.partId
    const lastStmt = [...script.statements].reverse().find((s) => {
      if (s.isMarker) return false
      if (s.op === 'split' && processedSplitParts.has(partId)) return false
      return true
    })
    if (!lastStmt) continue

    const newVar = oldToNew.get(lastStmt.id)
    if (!newVar) continue

    // 检查是否被其他语句引用
    if (referencedIds.has(newVar)) continue

    if (seenTerminals.has(newVar)) continue
    seenTerminals.add(newVar)

    const meta = getPartMeta?.(partId)
    terminalShapes.push({ id: newVar, meta })
  }

  // 对于 split 解构产生的输出（front/back），检查是否为终端
  for (const stmt of mergedStatements) {
    if (!stmt.outputs) continue
    for (const outId of stmt.outputs) {
      if (referencedIds.has(outId)) continue
      if (seenTerminals.has(outId)) continue
      seenTerminals.add(outId)
      const partId = newVarToPartId.get(outId)
      const meta = partId ? getPartMeta?.(partId) : undefined
      terminalShapes.push({ id: outId, meta })
    }
  }

  // 如果没有终端（所有输出都被引用），取最后一条语句作为终端
  if (terminalShapes.length === 0 && mergedStatements.length > 0) {
    const last = mergedStatements[mergedStatements.length - 1]
    terminalShapes.push({ id: last.id })
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
  // Also map split outputs
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
    // Map members from scopedIds to faijs variable names
    const members = stmt.args.members as string[] | undefined
    if (members) {
      mappedArgs.members = members.map((refId) => partIdToLastVar.get(refId) ?? refId)
    }
    // For assembly, also map constraints partIds and filter out runtime-only fields
    if (stmt.op === 'assembly' && stmt.args.constraints) {
      const constraints = (stmt.args.constraints as unknown[]).map((c) => {
        const constraint = c as Record<string, unknown>
        const mapped: Record<string, unknown> = {}
        // 映射 partId
        if (typeof constraint.fixedPartId === 'string') {
          mapped.fixedPartId = partIdToLastVar.get(constraint.fixedPartId as string) ?? constraint.fixedPartId
        }
        if (typeof constraint.movingPartId === 'string') {
          mapped.movingPartId = partIdToLastVar.get(constraint.movingPartId as string) ?? constraint.movingPartId
        }
        // 过滤 runtime-only 字段
        if (constraint.fixedFace) {
          const fixedFace = constraint.fixedFace as Record<string, unknown>
          mapped.fixedFace = {
            faceId: fixedFace.faceId,
            surfaceType: fixedFace.surfaceType,
          }
        }
        if (constraint.movingFace) {
          const movingFace = constraint.movingFace as Record<string, unknown>
          mapped.movingFace = {
            faceId: movingFace.faceId,
            surfaceType: movingFace.surfaceType,
          }
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
    terminalShapes: terminalShapes.length > 1 ? terminalShapes : undefined,
    meta: terminalShapes.length === 1 ? terminalShapes[0].meta : undefined,
  }

  return scriptToCode(mergedScript)
}
