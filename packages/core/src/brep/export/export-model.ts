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

import { buildStlBufferFromMesh } from './stl'
import { writeZipEntries } from '../../io/zip'
import { UNIT_SCALE, type UnitName } from '../../units'
import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import { getBrepApi } from '../handle-bridge'
import { exportStepFromSolids, type StepExportEntry } from './step'
import { detectStepUnit, STEP_UNIT_SCAN_PREFIX } from '../../mesh/io'

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

  // 2) 找到 LENGTH_UNIT() 里挂 SI_UNIT 的实体行，替换为 CONVERSION_BASED_UNIT
  //    并把 SI_UNIT 挂到 LENGTH_MEASURE 上。OCCT 输出形态（实测）：
  //    #n=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
  const siLine = out.match(/#(\d+)\s*=\s*\([^)]*SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)[^)]*\)\s*;/)
  if (!siLine) {
    throw new Error(`[export/step] no SI_UNIT(.MILLI.,.METRE.) entity found; cannot rewrite declaration to ${name}`)
  }

  // 3) 替换原 SI_UNIT 实体为 CONVERSION_BASED_UNIT，插入换算因子与基准米实体：
  //   #si=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
  // → #si=(LENGTH_UNIT()NAMED_UNIT(*)CONVERSION_BASED_UNIT('INCH',#conv));
  //   #conv=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#len);
  //   #len=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
  out = out.replace(siLine[0], siLine[0].replace(/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/, `CONVERSION_BASED_UNIT('${name}',#${convId})`))
  // 在 DATA 段结束前（ENDSEC;）插入新实体。
  const insert = [
    `#${convId}=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${inchFactor}),#${lenId});`,
    `#${lenId}=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));`,
  ].join('\n')
  out = out.replace(/ENDSEC\s*;/, `${insert}\nENDSEC;`)
  return out
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
function build3mfModelXml(entries: ExportEntry[], unit: UnitName, scale: number, printConfig?: unknown): string {
  const unitAttr = UNIT_NAME_TO_3MF[unit]
  if (!unitAttr) {
    // 调用方（exportModel）保证 unit 已成对回落；直接到这里 = 内部错误。
    throw new Error(`[export/3mf] unit ${unit} has no 3MF enum value`)
  }
  const objs: string[] = []
  const items: string[] = []
  entries.forEach((e, i) => {
    if (!e.mesh) return
    const pos = scalePositions(e.mesh.positions, scale)
    const verts: string[] = []
    for (let v = 0; v < pos.length; v += 3) {
      verts.push(`<vertex x="${pos[v]}" y="${pos[v + 1]}" z="${pos[v + 2]}"/>`)
    }
    const tris: string[] = []
    for (let t = 0; t < e.mesh.indices.length; t += 3) {
      tris.push(`<triangle v1="${e.mesh.indices[t]}" v2="${e.mesh.indices[t + 1]}" v3="${e.mesh.indices[t + 2]}"/>`)
    }
    const colorXml = e.color
      ? `<basematerials><base name="${e.name ?? 'p' + i}" displaycolor="${hexColor(e.color)}"/></basematerials>`
      : ''
    objs.push(`<object id="${i + 1}" type="model" name="${xmlAttr(e.name ?? `part${i + 1}`)}">${colorXml}<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`)
    items.push(`<item objectid="${i + 1}"/>`)
  })
  const pc = printConfig ? `<metadata name="printConfig">${xmlAttr(String(printConfig))}</metadata>` : ''
  return `<model unit="${unitAttr}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">${pc}<resources>${objs.join('')}</resources><build>${items.join('')}</build></model>`
}

function xmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hexColor(c: readonly [number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}FF`
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
    const bufs = entries.filter((e) => e.mesh).map((e) => ({ pos: scalePositions(e.mesh!.positions, scale), idx: e.mesh!.indices }))
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
    let buffer = exportStepFromSolids(kernel, stepEntries)
    for (const h of ownedHandles) {
      try { kernel.release(h) } catch { /* already released */ }
    }
    if (unit !== 'mm') {
      const text = new TextDecoder().decode(new Uint8Array(buffer))
      buffer = new TextEncoder().encode(rewriteStepUnitEntities(text, unit)).buffer
    }
    return buffer
  }

  if (format === '3mf') {
    return build3mfBuffer(build3mfModelXml(entries, unit, scale, opts?.printConfig))
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
    let buffer = exportStepFromSolids(kernel, stepEntries)
    for (const h of ownedHandles) {
      try { kernel.release(h) } catch { /* already released */ }
    }
    // 文本层只替换单位实体（红线：绝不文本级改坐标——坐标已在几何层缩放）。
    if (unit !== 'mm') {
      const text = new TextDecoder().decode(new Uint8Array(buffer))
      const rewritten = rewriteStepUnitEntities(text, unit)
      buffer = new TextEncoder().encode(rewritten).buffer
    }
    return buffer
  }

  if (format === '3mf') {
    return build3mfBuffer(build3mfModelXml(entries, unit, scale, opts?.printConfig))
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
