/**
 * api.d.ts 生成脚本 — 从 args-schema 生成 CadAPI 类型定义
 *
 * 消除 api.d.ts 手写漂移。schema 改了，重新跑此脚本即可同步。
 *
 * 用法：npx tsx scripts/gen-api-dts.ts
 * 输出：src/mesh/api.d.ts
 *
 * 生成策略：
 * - 简单 op（box/sphere/.../drill/engrave/knurl/sdf/translate/rotate/scale）→ 从 SCHEMAS 直接生成
 * - 特殊 op（boolean→3方法、split→4方法、load→3键互斥）→ 硬编码模板
 * - 查询方法（boundingBox/bboxCenter/volume/faceAt）→ 硬编码
 * - GeomRef helper（cad.bboxCenter/cad.bboxMin/cad.bboxMax/cad.faceCenter/cad.faceNormal）→ 硬编码
 */

import { SCHEMAS } from '../src/lang/args-schema'
import type { ArgType, OpSchema } from '../src/lang/args-schema'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(__dirname, '..', 'src', 'mesh', 'api.d.ts')

// ── 类型映射 ──

function tsType(argType: ArgType): string {
  switch (argType) {
    case 'number': return 'number'
    case 'vec3': return '[number, number, number]'
    case 'string': return 'string'
    case 'boolean': return 'boolean'
    case 'any': return 'any'
    case 'numberOrVec3': return 'number | [number, number, number]'
    default: return 'any'
  }
}

function fieldToTs(field: { name: string; type: ArgType; required: boolean }): string {
  const opt = field.required ? '' : '?'
  return `${field.name}${opt}: ${tsType(field.type)}`
}

function fieldsToParams(schema: OpSchema): string {
  return `{ ${schema.fields.map(fieldToTs).join('; ')} }`
}

// ── 生成签名 ──

/** 是否需要 Shape 输入（minInputs >= 1） */
function takesShape(schema: OpSchema): boolean {
  return (schema.minInputs ?? 0) >= 1
}

/** 是否返回 Promise */
function isAsync(op: string): boolean {
  // text/screw/svgExtrude/sdf 需要异步（字体加载/SVG解析/SDF求值）
  // drill/extrude/engrave/knurl/boolean/split 也返回 Promise（mesh boolean）
  // 创建类（box/sphere/...）和变换类是同步的
  const asyncOps = new Set(['text', 'screw', 'svgExtrude', 'sdf', 'drill', 'extrude', 'engrave', 'knurl', 'boolean', 'split', 'load'])
  return asyncOps.has(op)
}

function returnType(op: string): string {
  const r = isAsync(op) ? `Promise<Shape>` : `Shape`
  if (op === 'split') return `Promise<{ front: Shape; back: Shape; wedge?: Shape | null }>`
  return r
}

function genSimpleOp(op: string): string {
  const schema = SCHEMAS[op]
  if (!schema) return ''
  const shapeParam = takesShape(schema) ? 'shape: Shape, ' : ''
  const params = fieldsToParams(schema)
  const ret = returnType(op)
  return `  ${op}(${shapeParam}params: ${params}): ${ret}`
}

// ── 特殊 op 签名（不从 SCHEMAS 直接生成） ──

const SPECIAL_OPS: string[] = [
  // 布尔 → 3 个方法
  `  union(a: Shape, b: Shape, ...rest: Shape[]): Promise<Shape>`,
  `  subtract(a: Shape, b: Shape): Promise<Shape>`,
  `  intersect(a: Shape, b: Shape): Promise<Shape>`,
  // 分割 → 4 个方法
  `  split(shape: Shape, params: { normal?: [number, number, number]; offset?: number; cutMode?: string; inPlaneAngleDeg?: number; side?: string }): Promise<{ front: Shape; back: Shape; wedge?: Shape | null }>`,
  `  dovetailSplit(shape: Shape, params: {
    plane: { normal: [number, number, number]; offset: number }
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    bboxWidthOnWidthDir: number
    groove: { depth: number; depthTolerance: number; width: number; widthTolerance: number; flapsAngle: number }
  }): Promise<{ front: Shape; back: Shape; wedge: Shape | null }>`,
  `  dowelSplit(shape: Shape, params: {
    plane: { normal: [number, number, number]; offset: number }
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    dowel: { diameter: number; diameterTolerance: number; height: number; heightTolerance: number }
    selectedSections?: number[] | null
  }): Promise<{ front: Shape; back: Shape; wedge: Shape | null }>`,
  `  tenonSplit(shape: Shape, params: {
    plane: { normal: [number, number, number]; offset: number }
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    tenon: { sideLength: number; sideLengthTolerance: number; height: number; heightTolerance: number }
    selectedSections?: number[] | null
  }): Promise<{ front: Shape; back: Shape; wedge: Shape | null }>`,
  // load → 三键互斥
  `  load(params: { key?: string; path?: string; url?: string; format?: string }): Promise<Shape>`,
  // 查询方法
  `  boundingBox(shape: Shape): { min: [number, number, number]; max: [number, number, number] }`,
  `  bboxCenter(shape: Shape): [number, number, number]`,
  `  volume(shape: Shape): number`,
  `  faceAt(shape: Shape, anchor: { point: [number, number, number]; normal?: [number, number, number] }): {
    center: [number, number, number]
    normal: [number, number, number]
    area: number
  } | null`,
]

// ── 生成完整文件 ──

const SIMPLE_OPS = ['box', 'sphere', 'cylinder', 'cone', 'wedge', 'text', 'screw', 'svgExtrude', 'sdf',
  'translate', 'rotate', 'scale', 'drill', 'extrude', 'engrave', 'knurl']

const SKIP_OPS = new Set(['boolean', 'split', 'load']) // 有特殊签名

function generate(): string {
  const lines: string[] = []

  lines.push(`/**`)
  lines.push(` * cad-core API 类型定义 — AI 建模时的提示词素材`)
  lines.push(` *`)
  lines.push(` * ⚠️ 此文件由 scripts/gen-api-dts.ts 从 args-schema 自动生成，禁止手改。`)
  lines.push(` * 修改 args-schema.ts 后运行：npx tsx scripts/gen-api-dts.ts`)
  lines.push(` */`)
  lines.push(``)
  lines.push(`import type { Shape } from './types'`)
  lines.push(``)
  lines.push(`export interface CadAPI {`)

  // 创建类
  lines.push(`  // ── 创建 ──`)
  for (const op of ['box', 'sphere', 'cylinder', 'cone', 'wedge', 'text', 'screw', 'svgExtrude', 'sdf']) {
    if (SKIP_OPS.has(op)) continue
    lines.push(genSimpleOp(op))
  }

  // 变换类
  lines.push(``)
  lines.push(`  // ── 变换 ──`)
  for (const op of ['translate', 'rotate', 'scale']) {
    if (SKIP_OPS.has(op)) continue
    lines.push(genSimpleOp(op))
  }

  // 布尔类
  lines.push(``)
  lines.push(`  // ── 布尔 ──`)
  lines.push(SPECIAL_OPS[0])
  lines.push(SPECIAL_OPS[1])
  lines.push(SPECIAL_OPS[2])

  // 分割类
  lines.push(``)
  lines.push(`  // ── 分割 ──`)
  lines.push(SPECIAL_OPS[3])
  lines.push(SPECIAL_OPS[4])
  lines.push(SPECIAL_OPS[5])
  lines.push(SPECIAL_OPS[6])

  // 特征类
  lines.push(``)
  lines.push(`  // ── 钻孔 ──`)
  lines.push(genSimpleOp('drill'))
  lines.push(``)
  lines.push(`  // ── 拉伸 ──`)
  lines.push(genSimpleOp('extrude'))
  lines.push(``)
  lines.push(`  // ── 雕刻 ──`)
  lines.push(genSimpleOp('engrave'))
  lines.push(genSimpleOp('knurl'))

  // 查询类
  lines.push(``)
  lines.push(`  // ── 查询 ──`)
  lines.push(SPECIAL_OPS[8])  // boundingBox
  lines.push(SPECIAL_OPS[9])  // bboxCenter
  lines.push(SPECIAL_OPS[10]) // volume
  lines.push(SPECIAL_OPS[11]) // faceAt

  // IO
  lines.push(``)
  lines.push(`  // ── IO ──`)
  lines.push(SPECIAL_OPS[7])  // load

  lines.push(`}`)
  lines.push(``)
  lines.push(`// ── GeomRef helpers ──`)
  lines.push(``)
  lines.push(`/** 包围盒中心引用：重算时自动跟随包围盒中心 */`)
  lines.push(`export function bboxCenter(of: string): { $geom: { of: string; feature: 'bboxCenter' } }`)
  lines.push(``)
  lines.push(`/** 包围盒最小角引用 */`)
  lines.push(`export function bboxMin(of: string): { $geom: { of: string; feature: 'bboxMin' } }`)
  lines.push(``)
  lines.push(`/** 包围盒最大角引用 */`)
  lines.push(`export function bboxMax(of: string): { $geom: { of: string; feature: 'bboxMax' } }`)
  lines.push(``)
  lines.push(`/** 面心引用：重算时自动跟随面位置。faceOrdinal 为拓扑面序号（getSubShapes(shape,'face') 中的索引），优先于 anchor 定位 */`)
  lines.push(`export function faceCenter(of: string, anchor?: [number, number, number] | null, faceOrdinal?: number): { $geom: { of: string; feature: 'faceCenter'; faceOrdinal?: number; anchor?: { point: [number, number, number] } } }`)
  lines.push(``)
  lines.push(`/** 面法向引用：重算时自动跟随面法向。faceOrdinal 为拓扑面序号（getSubShapes(shape,'face') 中的索引），优先于 anchor 定位 */`)
  lines.push(`export function faceNormal(of: string, anchor?: [number, number, number] | null, faceOrdinal?: number): { $geom: { of: string; feature: 'faceNormal'; faceOrdinal?: number; anchor?: { point: [number, number, number] } } }`)
  lines.push(``)
  lines.push(`/** 资产引用：SVG/XML 等大段文本由 AssetResolver 按 key 解析 */`)
  lines.push(`export function asset(key: string): { $asset: string }`)

  return lines.join('\n')
}

// ── 主入口 ──

const content = generate()
writeFileSync(outputPath, content, 'utf-8')
console.log(`[gen-api-dts] Generated ${outputPath}`)
console.log(`[gen-api-dts] ${content.split('\n').length} lines`)
