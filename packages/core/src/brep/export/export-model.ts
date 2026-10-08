/**
 * exportModel — 统一导出入口（unit-system §10.6 二 / R11 / 裁决 J）
 *
 * 单一真源：坐标单位换算与文件单位声明由**同一次换算**产出（§10.3 规则 3），
 * 声明与坐标必须同源。CLI（writeOutput）与宿主（3d_editor）共用本入口。
 *
 * 格式分派（§10.6 表）：
 * - stl：坐标缩放到 unit 刻度，无声明（格式不支持）。
 * - step：预缩放 + 文本层只改写单位实体（§10.3 规则 3a；OCCT 恒写
 *   SI_UNIT(.MILLI.,.METRE.)，坐标预先缩放到目标刻度后声明必须跟上）。
 * - 3mf：坐标缩放到 unit 刻度 + <model unit> 与坐标同源；yard 不在 3MF
 *   枚举 → 成对回落到 mm（§10.3 规则 2）。
 *
 * 红线（§10.3 3a）：绝不文本级改坐标 — 坐标只在几何层缩放，文本层只碰单位实体。
 */

import { buildStlBufferFromMesh, composeMatrix12, bakeMatrix12ToPositions } from './stl'
import { writeZipEntries } from '../../io/zip'
import { UNIT_SCALE, type UnitName } from '../../units'
import type { Vec3 } from '../../mesh/types'
import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import { getBrepApi } from '../handle-bridge'
import { getBackends, BrepUnsupportedError } from '../../runtime-state'
import { exportStepFromSolids, type StepExportEntry } from './step'
import { detectStepUnit, STEP_UNIT_SCAN_PREFIX } from '../../mesh/io'
import type { PbrAppearance } from '../../api/appearance'
import type { ShapeMeta, FileMeta } from '../../api/meta'

/** 导出条目：一个 part 的几何来源。精确 BREP 与三角网格二选一，solid 优先。 */
export interface ExportEntry {
  /** 精确 BREP 句柄（来自 brep 链，导出 ADVANCED_FACE）。 */
  solid?: BrepHandle
  /** 三角网格（基准单位刻度；调用方只做世界变换烘焙，不做单位缩放）。 */
  mesh?: { positions: Float32Array; indices: Uint32Array }
  /** 实体名（写 STEP PRODUCT 名 / 3MF <object name>）。 */
  name?: string
  /** sRGB 0..1 颜色（STEP 走 XCAF COLOUR_RGB，3MF 走 basematerials）。 */
  color?: readonly [number, number, number]
  /**
   * 逐三角形材质分组（P4，3MF 走多 basematerials + `<triangle pid p1..p3>`）：
   * start/count 为**三角形索引**区间，appearance.color 为该组基色。
   */
  materialGroups?: Array<{ start: number; count: number; appearance: PbrAppearance }>
  /**
   * 零件级说明性元数据（设计文档 2026-10-05-meta §6.1）：写 3MF
   * `<object name/partnumber>` + `<metadatagroup>`；STEP 走 PRODUCT name（既有）。
   */
  meta?: ShapeMeta
  /**
   * 装配子节点（方案 2026-10-08 §2.1 / 第 4 步）：存在时本条目是装配容器，写出器据此
   * 生成 3MF `<components>`（每个 child 一个 `<component objectid>`，子节点的 `transform`
   * 写进 `<component transform>`）；STL / STEP 分支忽略此字段或将其展平（逐层烘焙 /
   * 逐实体通道，第 5、7 步）。
   */
  children?: ExportEntry[]
  /**
   * 本节点相对父的位姿（与 `Shape.transform` 同形态，方案 §2.1）。写出器消费：3MF 写
   * `<component transform>`、STEP 写 XCAF location（第 7 步）、STL 顶点烘焙（第 5 步）。
   */
  transform?: { translate?: Vec3; rotate?: { angle: number; axis?: Vec3 }; matrix?: number[] }
}

/** Output formats supported by the unified {@link exportModel} entry. */
export type ExportFormat = 'stl' | 'step' | '3mf'

/**
 * Options controlling {@link exportModel}/{@link exportModelSync} output
 * (unit-system §10.3): the declared target unit and optional 3MF print config.
 */
export interface ExportOptions {
  /**
   * 目标长度单位。缺省 'mm'。语义是「文件里声明的单位」——
   * 实现负责把坐标换算到该单位刻度并与声明成对写出（§10.3）。
   */
  unit?: UnitName
  /** 3MF 打印配置（可选，原样进 model 层）。 */
  printConfig?: unknown
  /** 整体级元数据（设计文档 2026-10-05-meta §6.1）：3MF 写 `<model>` 级 `<metadata>`。 */
  fileMeta?: FileMeta
}

/** UnitName → 3MF <model unit> 枚举全名（唯一真源；yard 无对应值）。 */
export const UNIT_NAME_TO_3MF: Partial<Record<UnitName, 'micron' | 'millimeter' | 'centimeter' | 'inch' | 'foot' | 'meter'>> = {
  mm: 'millimeter',
  cm: 'centimeter',
  m: 'meter',
  micron: 'micron',
  inch: 'inch',
  foot: 'foot',
  // yard 无 3MF 枚举值 — 调用方必须先成对回落到 mm（§10.3 规则 2）。
}

/** 缩放 Float32 positions 到目标单位刻度（基准值 ÷ unitScale(unit)）。 */
function scalePositions(positions: Float32Array, scale: number): Float32Array {
  if (scale === 1) return positions
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i++) out[i] = positions[i] * scale
  return out
}

/** STEP 单位声明改写：SI_UNIT(.MILLI.,.METRE.) → 目标单位实体（只碰单位实体，红线）。 */
function rewriteStepUnitEntities(stepText: string, unit: UnitName): string {
  // mm 是 OCCT 的原生写出形态，无需改写。
  if (unit === 'mm') return stepText

  // SI 面积/体积单位实体的前缀同样要跟着换（LENGTH/AREA/VOLUME 挂同一前缀链），
  // 但坐标已缩放 → 只需把 LENGTH 链上的前缀换掉；面积/体积单位在 STEP 里由
  // SI_UNIT 前缀 + 幂次表达，XCAF 写出的实体形态是 SI_UNIT(.MILLI.,.METRE.)
  // 挂在长度、平方与立方三条依赖链上。为保守起见只改写显式 LENGTH_UNIT 链上的
  // SI_UNIT —— 具体做法：全局替换 SI_UNIT 前缀（同一文件里坐标相关单位恒为
  // 长度链；角度 SI_UNIT(.RADIAN.) 不含 METRE 不会被命中）。
  let out = stepText

  if (unit === 'cm' || unit === 'm' || unit === 'micron') {
    const prefix = unit === 'cm' ? '.CENTI.' : unit === 'm' ? '$' : '.MICRO.'
    // OCCT 写出恒为 SI_UNIT(.MILLI.,.METRE.)（实测）；$ 前缀形态（无前缀=米）
    // 在 OCCT 输出中不会出现，但容错处理（若上游将来变化）。
    out = out.replace(/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/g,
      prefix === '$' ? 'SI_UNIT($,.METRE.)' : `SI_UNIT(${prefix},.METRE.)`)
    return out
  }

  // inch / foot：CONVERSION_BASED_UNIT 形态。需要注入换算因子实体并替换
  // LENGTH_UNIT 依赖。最简形态：把 SI_UNIT(.MILLI.,.METRE.) 替换为
  // CONVERSION_BASED_UNIT('INCH', #factor)，并附加 MEASURE_WITH_UNIT 实体。
  // 实体编号：取文件内最大 #n + 1、+2（附加实体挂在文件尾部 DATA 段内合法）。
  const inchFactor = unit === 'inch' ? 25.4 : 304.8
  const name = unit === 'inch' ? 'INCH' : 'FOOT'

  // 1) 收集现有最大实体编号
  let maxId = 0
  for (const m of out.matchAll(/#(\d+)\s*=/g)) {
    const id = Number(m[1])
    if (id > maxId) maxId = id
  }
  const lenId = maxId + 1
  const convId = maxId + 2

  // 2) 存在性守卫：必须至少有一条 LENGTH_UNIT 挂 SI_UNIT(.MILLI.,.METRE.)，否则
  //    没有可改写的声明（凭空插入单位声明 = 伪造文件单位）。
  //    OCCT 实测形态（实体括号内还有 LENGTH_UNIT() / NAMED_UNIT(*) 的括号，且
  //    `=`、`)` 前后都有空格）：
  //      #346 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
  //    故实体体的字符类用 [^;]（STEP 实体行内不含分号）而不是 [^)]——后者跨不过
  //    `LENGTH_UNIT()` 与 `NAMED_UNIT(*)` 自带的括号，整段永远匹配不上。
  const siDecl = out.match(/#(\d+)\s*=\s*\([^;]*?SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)[^;]*?\)\s*;/)
  if (!siDecl) {
    throw new Error(`[export/step] no SI_UNIT(.MILLI.,.METRE.) entity found; cannot rewrite declaration to ${name}`)
  }

  // 3) 把**全部** SI_UNIT(.MILLI.,.METRE.) 换成 CONVERSION_BASED_UNIT（各 context
  //    共享同一份换算因子实体），插入换算因子与基准米实体：
  //   #si=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
  // → #si=( LENGTH_UNIT() NAMED_UNIT(*) CONVERSION_BASED_UNIT('INCH',#conv) );
  //   #conv=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#len);
  //   #len=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
  // 全局替换而不是只改第一条：多零件导出会写出多条 LENGTH_UNIT 声明（每个 part 一个
  // context，实测 2 个 part → #346 与 #690），只改第一条会让同一文件里并存两种长度
  // 单位声明——而坐标是按同一 scale 换算过的。
  out = out.replace(/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/g, `CONVERSION_BASED_UNIT('${name}',#${convId})`)
  // 在 DATA 段结束前（ENDSEC;）插入新实体。
  const insert = [
    `#${convId}=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${inchFactor}),#${lenId});`,
    `#${lenId}=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));`,
  ].join('\n')
  out = out.replace(/ENDSEC\s*;/, `${insert}\nENDSEC;`)
  return out
}

/**
 * STEP 文件级元数据 → P21 header 重写（`FILE_NAME`/`FILE_DESCRIPTION`）。
 *
 * 设计文档 2026-10-05-meta §6.2 第 6 步：`exportModel` 已有 SI_UNIT 声明重写的
 * 先例——同样只对 header 里 FILE_NAME(...)/FILE_DESCRIPTION(...) 行做文本替换，
 * 绝不碰 DATA 段几何实体（红线 §10.3 3a：文本层只改声明/元数据，坐标不动）。
 *
 * FILE_NAME(name, time_stamp, author, organization, preprocessor_version, ...)
 * FILE_DESCRIPTION(description_list, implementation_level)
 * 映射（§3.3）：title→name, creationDate→time_stamp, author|designer→author 列表,
 * organization→organization, application→preprocessor, description→description。
 * 无对应的字段（copyright/licenseTerms/rating/modificationDate）**不写**（§5.3 头：
 * STEP 无标准位置，不发明）。
 *
 * 宽容失败：找不到 FILE_NAME/FILE_DESCRIPTION 行则留空（P21 头由内核写出，形态
 * 已知为 `FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');` 一行，但在字符串内）。
 *
 * @param stepText 内核产出的 STEP 全文（ISO-10303-21）。
 * @param fileMeta 目标文件级元数据。
 * @returns 改写后的 STEP 文本。
 */
export function rewriteFileMetaHeader(stepText: string, fileMeta: FileMeta): string {
  let out = stepText

  const title = fileMeta.title && fileMeta.title.length > 0 ? fileMeta.title : undefined
  const ts = fileMeta.creationDate && fileMeta.creationDate.length > 0
    ? fileMeta.creationDate
    : (fileMeta.modificationDate && fileMeta.modificationDate.length > 0 ? fileMeta.modificationDate : undefined)
  const authorList = fileMeta.author && fileMeta.author.length > 0 ? [fileMeta.author] : []
  const org = fileMeta.organization && fileMeta.organization.length > 0 ? fileMeta.organization : undefined
  const preproc = fileMeta.application && fileMeta.application.length > 0 ? fileMeta.application : undefined
  const designer = fileMeta.designer && fileMeta.designer.length > 0 ? fileMeta.designer : undefined
  const desc = fileMeta.description && fileMeta.description.length > 0 ? fileMeta.description : undefined

  // 1) FILE_NAME（用平衡括号/引号感知的枚举，整块替换 —— 逐参安全，不依赖行结构）。
  const fn = matchEntity(out, 'FILE_NAME')
  if (fn) {
    const params = splitP21Params(fn.inner)
    const next: string[] = []
    if (title !== undefined || ts !== undefined || authorList.length > 0 || org !== undefined || preproc !== undefined || designer !== undefined) {
      next.push(stepStr(title ?? paramStr(params[0]) ?? 'STEP File'))
      next.push(stepStr(ts ?? paramStr(params[1]) ?? ''))
      next.push(authorList.length > 0 ? p21List(authorList) : (params[2] ?? "('')"))
      next.push(org !== undefined ? p21List([org]) : (params[3] ?? "('')"))
      // 保留内核写出的后续参数原样（preprocessor_version / originating_system /
      // authorisation）——FILE_NAME 可带 6..7 参，不丢既有值。
      next.push(preproc !== undefined ? stepStr(preproc) : (params[4] ?? ''))
      next.push(designer !== undefined ? stepStr(designer) : (params[5] ?? ''))
      for (let i = 6; i < params.length; i++) next.push(params[i])
      // 末尾空参保留则拼 ',' 会使整行以 ',' 结尾 → 过滤空的尾部。
      while (next.length > 0 && next[next.length - 1] === '') next.pop()
      out = splice(out, fn.start, fn.end, `FILE_NAME(${next.join(',')})`)
    }
  }

  // 2) FILE_DESCRIPTION(description_list, implementation_level)：替换描述列表。
  const fd = matchEntity(out, 'FILE_DESCRIPTION')
  if (fd) {
    const params = splitP21Params(fd.inner)
    if (desc !== undefined && params.length > 0) {
      const impl = params[params.length - 1]
      out = splice(out, fd.start, fd.end, `FILE_DESCRIPTION((${stepStr(desc)}),${impl})`)
    }
  }

  return out
}

/** [start, end) 区间替换为 replacement（end 为闭合括号后一位，仍保留其后的 `;`）。 */
function splice(s: string, start: number, end: number, replacement: string): string {
  return s.slice(0, start) + replacement + s.slice(end)
}

/** FileMeta 是否含可映射到 STEP header 的字段（避免对无 header 字段的 fileMeta 做无谓解码重写）。 */
function fileMetaHasHeaderFields(f: FileMeta): boolean {
  return !!(f.title || f.description || f.designer || f.author || f.organization || f.application
    || f.creationDate || f.modificationDate)
}

/**
 * 在文本中定位 `NAME(` … 匹配的 `)` （引号忽略、内层括号计入）并返回
 * `{ start, end, inner }`；找不到返回 null。start/end 是 `NAME(` 起始/闭合 `)` 之后
 * 一位的偏移，供调用方做字符串拼接替换（不做正则整行匹配——行内可含 `;` 等字符）。
 */
function matchEntity(text: string, name: string): { start: number; end: number; inner: string } | null {
  const re = new RegExp(`${name}\\s*\\(`)
  const m = re.exec(text)
  if (!m) return null
  const start = m.index
  const head = m.index + m[0].length
  let depth = 1
  let i = head
  for (; i < text.length && depth > 0; i++) {
    const c = text[i]
    if (c === `'`) {
      // 跳过字符串字面量（含 ISO10303-21 双引号转义）
      i++
      while (i < text.length) {
        if (text[i] === `'` && text[i + 1] === `'`) { i += 2; continue }
        if (text[i] === `'`) break
        i++
      }
    } else if (c === '(') depth++
    else if (c === ')') depth--
  }
  return { start, end: i - 1, inner: text.slice(head, i - 1) }
}

/** 把一层参数（逗号分隔，忽略括号与字符串内的逗号）拆分（trim，原样保留字面量）。 */
function splitP21Params(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === `'`) {
      // 字符串字面量：整体吸收（含 ISO10303-21 转义 ''），不拆其内逗号/括号。
      const start = i
      i++
      while (i < inner.length) {
        if (inner[i] === `'` && inner[i + 1] === `'`) { i += 2; continue }
        if (inner[i] === `'`) { i++; break }
        i++
      }
      cur += inner.slice(start, i)
      i-- // for 循环还会 +1，落到字符串结束引号后一个字符
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = '' }
    else cur += c
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/** 单个 P21 字符串字面量的未转义内容（剥离包裹引号与 '' 转义）。 */
function paramStr(p: string | undefined): string | undefined {
  if (p === undefined) return undefined
  const m = /^'((?:[^']|'')*)'$/.exec(p.trim())
  return m ? m[1].replace(/''/g, `'`) : undefined
}

/** 单个 P21 字符串字面量（已转义）。 */
function stepStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

/** P21 列表字面量：(['a','b']) → `('a','b')`。 */
function p21List(items: string[]): string {
  return `(${items.map(stepStr).join(',')})`
}

/** 3MF写出：最小 ZIP 容器（deflate），落 3D/3dmodel.model + [Content_Types].xml + _rels。 */
function build3mfBuffer(modelXml: string): ArrayBuffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`

  const zipped = writeZipEntries({
    '[Content_Types].xml': new TextEncoder().encode(contentTypes),
    '_rels/.rels': new TextEncoder().encode(rels),
    '3D/3dmodel.model': new TextEncoder().encode(modelXml),
  })
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}

/** 组 3MF <model> XML：单位声明与坐标由同一 scale 变量产出（同源，§10.3 规则 3）。 */
function build3mfModelXml(entries: ExportEntry[], unit: UnitName, scale: number, printConfig?: unknown, fileMeta?: FileMeta): string {
  const unitAttr = UNIT_NAME_TO_3MF[unit]
  if (!unitAttr) {
    // 调用方（exportModel）保证 unit 已成对回落；直接到这里 = 内部错误。
    throw new Error(`[export/3mf] unit ${unit} has no 3MF enum value`)
  }
  const objs: string[] = []
  const mats: string[] = []
  const items: string[] = []
  let nextObjId = 1
  // 逐三角形材质分组的 basematerials id 从「顶层条目数 + 1」起，与 object id（1..N）
  // 错开（P3：resources 内 id 唯一）。对象级颜色 basematerials 复用其 object id。
  let nextMatId = entries.length + 1

  // 递归发射一个节点为 <object>（叶带 mesh、容器带 <components>），返回其 object id。
  function emitObject(e: ExportEntry): number | undefined {
    // P8 契约（库面）：无 mesh 且无子节点的条目 → 静默跳过（不发射 <object>/<item>），
    // 与 op 层「无三角载荷即 E_EXPORT_3MF_EMPTY 显式报错」形成双值防护。显式容器
    // （children 已声明，即便为空 []）仍发射，以便装配层级（含空装配）可写。
    const isContainer = e.children !== undefined
    if (!e.mesh && !isContainer) return undefined
    const id = nextObjId++
    let meshXml = ''
    if (e.mesh) {
      const pos = scalePositions(e.mesh.positions, scale)
      const verts: string[] = []
      for (let v = 0; v < pos.length; v += 3) {
        verts.push(`<vertex x="${pos[v]}" y="${pos[v + 1]}" z="${pos[v + 2]}"/>`)
      }
      // P4（3MF Core 逐三角形材质）：materialGroups（appearance.color）→ 每组
      // 一个独立 basematerials 资源（id 与对象 id 错开，P3 曾与对象共用 id、
      // 违反 resources 内 id 唯一），分组三角形用 `<triangle pid p1..p3>` 引用。
      const groupPids: number[] = []
      const groups = (e.materialGroups ?? []).filter((g) => g.appearance?.color)
      for (const g of groups) {
        groupPids.push(nextMatId)
        mats.push(
          `<basematerials id="${nextMatId}"><base name="${xmlAttr(`${e.name ?? `part${id}`}_g${groupPids.length}`)}" displaycolor="${hexColor(g.appearance.color!)}"/></basematerials>`,
        )
        nextMatId++
      }
      const tris: string[] = []
      const triCount = e.mesh.indices.length / 3
      let gi = 0
      for (let t = 0; t < triCount; t++) {
        while (gi < groups.length && t >= groups[gi].start + groups[gi].count) gi++
        const inGroup = gi < groups.length && t >= groups[gi].start
        const matAttr = inGroup ? ` pid="${groupPids[gi]}" p1="0" p2="0" p3="0"` : ''
        tris.push(
          `<triangle v1="${e.mesh.indices[t * 3]}" v2="${e.mesh.indices[t * 3 + 1]}" v3="${e.mesh.indices[t * 3 + 2]}"${matAttr}/>`,
        )
      }
      meshXml = `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`
    }
    // 对象级颜色 basematerials：复用 object id（既有契约，解析器按 id 取首个资源）。
    let pidAttr = ''
    if (e.color) {
      mats.push(`<basematerials id="${id}"><base name="${xmlAttr(e.name ?? 'p' + id)}" displaycolor="${hexColor(e.color)}"/></basematerials>`)
      pidAttr = ` pid="${id}" pindex="0"`
    }
    // 装配层级 → <components>（子节点递归；<component transform> 写相对父位姿）。
    let compXml = ''
    if (e.children && e.children.length > 0) {
      const comps = e.children.map((child) => {
        const cid = emitObject(child)
        if (cid === undefined) return ''
        const tf = child.transform ? ` transform="${matrix12ToAttr(transformToMatrix12(child.transform))}"` : ''
        return `<component objectid="${cid}"${tf}/>`
      }).filter((s) => s !== '')
      compXml = comps.length > 0 ? `<components>${comps.join('')}</components>` : ''
    }
    // 零件级元数据（设计文档 2026-10-05-meta §6.1）：partnumber 属性 +
    // `<metadatagroup><metadata>`（3MF 自定义标签须带命名空间前缀；faijs
    // 无前缀键一律补 `faijs:` 前缀，跨工具链兼容）。description 3MF 无对象级
    // 标准位 → 写 `faijs:description`（规范允许 vendor 前缀名）。
    const partnumberAttr = e.meta?.partNumber ? ` partnumber="${xmlAttr(e.meta.partNumber)}"` : ''
    const metadatas: string[] = []
    const meta = e.meta
    if (meta) {
      const metaPairs: Array<[string, string]> = []
      if (meta.description !== undefined && meta.description !== '') metaPairs.push(['faijs:description', meta.description])
      if (meta.metadata) {
        for (const [k, v] of Object.entries(meta.metadata)) {
          metaPairs.push([k.includes(':') ? k : `faijs:${k}`, v])
        }
      }
      // 同键不重复（首见保留）。
      const seen = new Set<string>()
      for (const [k, v] of metaPairs) {
        if (seen.has(k)) continue
        seen.add(k)
        metadatas.push(`<metadata name="${xmlAttr(k)}">${xmlAttr(v)}</metadata>`)
      }
    }
    const metadatagroup = metadatas.length > 0 ? `<metadatagroup>${metadatas.join('')}</metadatagroup>` : ''
    const nameAttr = xmlAttr(e.name ?? `part${id}`)
    objs.push(`<object id="${id}" type="model" name="${nameAttr}"${partnumberAttr}${pidAttr}>${metadatagroup}${meshXml}${compXml}</object>`)
    return id
  }

  for (const e of entries) {
    const id = emitObject(e)
    if (id === undefined) continue
    const tf = e.transform ? ` transform="${matrix12ToAttr(transformToMatrix12(e.transform))}"` : ''
    items.push(`<item objectid="${id}"${tf}/>`)
  }
  // 整体级元数据（`<model>` 直接子级 `<metadata>`）：well-known 名经映射写标准
  // 3MF 名，vendor 名写 `faijs:` 前缀。排在 `<resources>` 之前（3MF Core）。
  const modelMetas: string[] = []
  if (fileMeta) {
    const wellKnown: Array<[Exclude<keyof FileMeta, 'metadata'>, string]> = [
      ['title', 'Title'],
      ['designer', 'Designer'],
      ['description', 'Description'],
      ['copyright', 'Copyright'],
      ['licenseTerms', 'LicenseTerms'],
      ['rating', 'Rating'],
      ['creationDate', 'CreationDate'],
      ['modificationDate', 'ModificationDate'],
      ['application', 'Application'],
    ]
    for (const [field, name] of wellKnown) {
      if (fileMeta[field] !== undefined) modelMetas.push(`<metadata name="${name}">${xmlAttr(String(fileMeta[field]))}</metadata>`)
    }
    if (fileMeta.metadata) {
      for (const [k, v] of Object.entries(fileMeta.metadata)) {
        modelMetas.push(`<metadata name="${xmlAttr(k.includes(':') ? k : `faijs:${k}`)}">${xmlAttr(v)}</metadata>`)
      }
    }
  }
  const pc = printConfig ? `<metadata name="printConfig">${xmlAttr(String(printConfig))}</metadata>` : ''
  return `<model unit="${unitAttr}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:faijs="http://schemas.faicad.dev/3mf/2026/10">${pc}${modelMetas.join('')}<resources>${mats.join('')}${objs.join('')}</resources><build>${items.join('')}</build></model>`
}

function xmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hexColor(c: readonly [number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

/** 归一化向量（零向量回退 z 轴）。 */
function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len === 0 ? [0, 0, 1] : [v[0] / len, v[1] / len, v[2] / len]
}

/** 轴角（度）→ 3×3 行主序旋转矩阵（Rodrigues）。 */
function rotationMatrix3x3(axis: Vec3, angleDeg: number): number[] {
  const [x, y, z] = normalize3(axis)
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

/**
 * 3MF `<component transform>` 的 12 元组（行主序 3×4，平移在末列），与加载器 `parseTransformAttr` 同约定。
 *
 * @param t - 节点位姿（`matrix` 12 元组优先，缺省时由 `rotate` / `translate` 合成）。
 * @returns 行主序 3×4 仿射矩阵的 12 元组。
 */
export function transformToMatrix12(t: NonNullable<ExportEntry['transform']>): number[] {
  if (t.matrix && t.matrix.length === 12) return t.matrix.slice()
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
  if (t.rotate) {
    const R = rotationMatrix3x3(t.rotate.axis ?? [0, 0, 1], t.rotate.angle)
    m[0] = R[0]; m[1] = R[1]; m[2] = R[2]
    m[4] = R[3]; m[5] = R[4]; m[6] = R[5]
    m[8] = R[6]; m[9] = R[7]; m[10] = R[8]
  }
  if (t.translate) {
    m[3] = t.translate[0]; m[7] = t.translate[1]; m[11] = t.translate[2]
  }
  return m
}

function fmtNum(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 1e6) / 1e6)
}

function matrix12ToAttr(m: number[]): string {
  return m.map(fmtNum).join(' ')
}

/**
 * Synchronous twin of {@link exportModel} for hosts already holding a live
 * kernel (CLI, in-process consumers). Same invariants: declared unit ==
 * written coordinate scale. Only 'stl' / 'step' (3mf is also sync but is
 * routed through the same code path below).
 *
 * @param entries - the shapes to export (BREP solids preferred, mesh fallback).
 * @param format - output format: 'stl' | 'step' | '3mf'.
 * @param opts - optional target unit and 3MF print config.
 * @returns the serialized file bytes (ArrayBuffer).
 */
export function exportModelSync(
  entries: ExportEntry[],
  format: ExportFormat,
  opts?: ExportOptions,
): ArrayBuffer {
  if (entries.length === 0) throw new Error('[export] no exportable entries')

  let unit = opts?.unit ?? 'mm'
  if (format === '3mf' && !UNIT_NAME_TO_3MF[unit]) unit = 'mm'
  const scale = 1 / UNIT_SCALE[unit]

  if (format === 'stl') {
    // 步骤 5（方案 §2.1 / §4.3 L1-5）：装配展平 + 顶点烘焙。递归把 children 拍平成叶，
    // 每个叶的世界变换 = 父世界变换 ∘ 本节点局部 transform（row-major 3×4，平移在末列）。
    // 先在世界空间烘焙 transform，再按单位换算缩放坐标（缩放同时作用于平移分量，坐标与声明成对）。
    const flatten = (
      list: ExportEntry[],
      accTf: number[] | null,
    ): Array<{ pos: Float32Array; idx: Uint32Array }> => {
      const out: Array<{ pos: Float32Array; idx: Uint32Array }> = []
      for (const e of list) {
        const tf = e.transform ? transformToMatrix12(e.transform) : null
        const world = tf && accTf ? composeMatrix12(accTf, tf) : tf ?? accTf ?? null
        if (e.children && e.children.length > 0) {
          out.push(...flatten(e.children, world))
          continue
        }
        if (!e.mesh) continue
        let pos = e.mesh.positions
        if (world) pos = bakeMatrix12ToPositions(pos, world)
        pos = scalePositions(pos, scale)
        out.push({ pos, idx: e.mesh.indices })
      }
      return out
    }
    const bufs = flatten(entries, null)
    if (bufs.length === 0) throw new Error('[export/stl] no mesh entries')
    if (bufs.length === 1) return buildStlBufferFromMesh(bufs[0]!.pos, bufs[0]!.idx)
    const totalTris = bufs.reduce((n, b) => n + b.idx.length / 3, 0)
    const mergedPos = new Float32Array(bufs.reduce((n, b) => n + b.pos.length, 0))
    const mergedIdx = new Uint32Array(totalTris * 3)
    let po = 0
    let io2 = 0
    let base = 0
    for (const b of bufs) {
      mergedPos.set(b.pos, po)
      for (let i = 0; i < b.idx.length; i++) mergedIdx[io2++] = b.idx[i] + base
      base += b.pos.length / 3
      po += b.pos.length
    }
    return buildStlBufferFromMesh(mergedPos, mergedIdx)
  }

  if (format === 'step') {
    // 步骤 6（方案 §2.3 / P1）：STEP 装配层级走 XCAF，仅 occt 具备；非 occt 引擎在
    // 触碰任何句柄之前报 E_BREP_UNSUPPORTED（带当前引擎名），不落入 getBrepApi 的
    // 未初始化异常，也不把 brepkit 句柄交给 occt 内核（句柄不得跨引擎传递）。
    const engineId = getBackends().config.brepEngineId
    if (engineId !== 'occt') {
      throw new BrepUnsupportedError(
        `E_BREP_UNSUPPORTED: op 'exportModel:step' requires engine occt (current=${engineId ?? '<none>'})`,
      )
    }
    const kernel = getBrepApi()
    const ownedHandles: BrepHandle[] = []
    const stepEntries: StepExportEntry[] = entries.map((e) => {
      if (e.solid) {
        if (scale === 1) return { solid: e.solid, ...(e.name ? { name: e.name } : {}), ...(e.color ? { color: [...e.color] as [number, number, number] } : {}) }
        const scaled = kernel.scale(e.solid, { x: 0, y: 0, z: 0 }, scale)
        ownedHandles.push(scaled)
        return { solid: scaled, ...(e.name ? { name: e.name } : {}), ...(e.color ? { color: [...e.color] as [number, number, number] } : {}) }
      }
      return {
        ...(e.mesh ? { mesh: { positions: scalePositions(e.mesh.positions, scale), indices: e.mesh.indices } } : {}),
        ...(e.name ? { name: e.name } : {}),
        ...(e.color ? { color: [...e.color] as [number, number, number] } : {}),
      }
    })
    const buffer = exportStepFromSolids(kernel, stepEntries)
    for (const h of ownedHandles) {
      try { kernel.release(h) } catch { /* already released */ }
    }
    // 文本层只替换 header 声明/元数据（红线：绝不文本级改坐标——坐标已在几何层缩放）。
    const applyTextRewrites = (buf: ArrayBuffer): ArrayBuffer => {
      let text = new TextDecoder().decode(new Uint8Array(buf))
      if (unit !== 'mm') text = rewriteStepUnitEntities(text, unit)
      if (opts?.fileMeta && fileMetaHasHeaderFields(opts.fileMeta)) text = rewriteFileMetaHeader(text, opts.fileMeta)
      return new TextEncoder().encode(text).buffer
    }
    return applyTextRewrites(buffer)
  }

  if (format === '3mf') {
    return build3mfBuffer(build3mfModelXml(entries, unit, scale, opts?.printConfig, opts?.fileMeta))
  }

  throw new Error(`[export] unsupported format: ${format}`)
}

/**
 * 统一导出入口：按 format 分派到各写出器。
 * **内部不变式：写出的坐标刻度 == 文件声明的单位。** 这是本 API 存在的唯一理由。
 * @param entries - 待导出的几何条目（BREP solid 优先，缺则走 mesh）。
 * @param format - 输出格式：'stl' | 'step' | '3mf'。
 * @param opts - 可选的目标单位与 3MF 打印配置。
 * @returns 文件字节
 * @throws 目标单位该格式不支持且无法回落时（不静默降级）
 */
export async function exportModel(
  entries: ExportEntry[],
  format: ExportFormat,
  opts?: ExportOptions,
): Promise<ArrayBuffer> {
  if (entries.length === 0) throw new Error('[export] no exportable entries')

  let unit = opts?.unit ?? 'mm'

  // 3MF 枚举回落（§10.3 规则 2）：yard 不在枚举 → 成对回落到 mm（坐标+声明）。
  if (format === '3mf' && !UNIT_NAME_TO_3MF[unit]) {
    unit = 'mm'
  }

  // scale = 基准值 → 目标单位刻度（fromBase(1, unit, 'length') 的表实现）。
  const scale = 1 / UNIT_SCALE[unit]

  if (format === 'stl') {
    // STL 无声明：坐标按 unit 刻度写出，调用方保证 unit 语义（当前文档单位）。
    const parts: ArrayBuffer[] = []
    for (const e of entries) {
      if (!e.mesh) continue // STL 只吃 mesh；solid 条目由宿主先三角化
      parts.push(buildStlBufferFromMesh(scalePositions(e.mesh.positions, scale), e.mesh.indices))
    }
    if (parts.length === 0) throw new Error('[export/stl] no mesh entries')
    if (parts.length === 1) return parts[0]!
    // 多 mesh：合并顶点后再写（binary STL 无对象概念，多实体合一个 soup）。
    const bufs = entries.filter((e) => e.mesh).map((e) => {
      const pos = scalePositions(e.mesh!.positions, scale)
      return { pos, idx: e.mesh!.indices }
    })
    const totalTris = bufs.reduce((n, b) => n + b.idx.length / 3, 0)
    const mergedPos = new Float32Array(bufs.reduce((n, b) => n + b.pos.length, 0))
    const mergedIdx = new Uint32Array(totalTris * 3)
    let po = 0
    let io2 = 0
    let base = 0
    for (const b of bufs) {
      mergedPos.set(b.pos, po)
      for (let i = 0; i < b.idx.length; i++) mergedIdx[io2++] = b.idx[i] + base
      base += b.pos.length / 3
      po += b.pos.length
    }
    return buildStlBufferFromMesh(mergedPos, mergedIdx)
  }

  if (format === 'step') {
    // 步骤 6（方案 §2.3 / P1）：同同步分支，取内核前先断言 occt 引擎身份。
    const engineId = getBackends().config.brepEngineId
    if (engineId !== 'occt') {
      throw new BrepUnsupportedError(
        `E_BREP_UNSUPPORTED: op 'exportModel:step' requires engine occt (current=${engineId ?? '<none>'})`,
      )
    }
    // 同一 scale 变量喂两类条目（§10.3 规则 7，修 E4）：mesh 缩放 positions，
    // solid 用 owned copy 做 kernel.scale —— 不释放调用方缓存里的原句柄。
    // 先过门禁再取内核（同同步分支：拒绝理由与引擎装配状态无关）。
    const kernel = (await import('../handle-bridge')).getBrepApi() as BrepEngineApi
    const ownedHandles: BrepHandle[] = []
    const stepEntries: StepExportEntry[] = entries.map((e) => {
      if (e.solid) {
        if (scale === 1) return { solid: e.solid, ...(e.name ? { name: e.name } : {}), ...(e.color ? { color: [...e.color] as [number, number, number] } : {}) }
        const scaled = kernel.scale(e.solid, { x: 0, y: 0, z: 0 }, scale)
        ownedHandles.push(scaled)
        return { solid: scaled, ...(e.name ? { name: e.name } : {}), ...(e.color ? { color: [...e.color] as [number, number, number] } : {}) }
      }
      return {
        ...(e.mesh ? { mesh: { positions: scalePositions(e.mesh.positions, scale), indices: e.mesh.indices } } : {}),
        ...(e.name ? { name: e.name } : {}),
        ...(e.color ? { color: [...e.color] as [number, number, number] } : {}),
      }
    })
    const buffer = exportStepFromSolids(kernel, stepEntries)
    for (const h of ownedHandles) {
      try { kernel.release(h) } catch { /* already released */ }
    }
    // 文本层只替换 header 声明/元数据（红线：绝不文本级改坐标——坐标已在几何层缩放）。
    let text = new TextDecoder().decode(new Uint8Array(buffer))
    if (unit !== 'mm') text = rewriteStepUnitEntities(text, unit)
    if (opts?.fileMeta && fileMetaHasHeaderFields(opts.fileMeta)) text = rewriteFileMetaHeader(text, opts.fileMeta)
    return new TextEncoder().encode(text).buffer
  }

  if (format === '3mf') {
    return build3mfBuffer(build3mfModelXml(entries, unit, scale, opts?.printConfig, opts?.fileMeta))
  }

  throw new Error(`[export] unsupported format: ${format}`)
}

/**
 * 导出后回读声明单位（自检与验收用；与 detectStepUnit 互为对偶）。
 * @param data - the exported file bytes (ArrayBuffer or decoded Uint8Array).
 * @param format - the format the bytes were produced in.
 * @returns the declared unit, or null when the format cannot declare one (STL)
 *   or the declaration cannot be parsed.
 */
export function readDeclaredUnit(data: ArrayBuffer | Uint8Array, format: ExportFormat): UnitName | null {
  if (format === 'stl') return null
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const text = new TextDecoder().decode(bytes).slice(0, STEP_UNIT_SCAN_PREFIX)

  if (format === '3mf') {
    const m = text.match(/<model[^>]*\sunit="([^"]+)"/)
    if (!m) return null
    for (const [name, val] of Object.entries(UNIT_NAME_TO_3MF)) {
      if (val === m[1]) return name as UnitName
    }
    return null
  }

  // step
  return detectStepUnit(text)
}
