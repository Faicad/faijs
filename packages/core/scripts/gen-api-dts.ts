/**
 * api.d.ts 生成脚本 — 从 stdlib 函数目录 + 签名生成 CadAPI 类型定义
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.10
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §6.4
 *
 * 输入：stdlib 函数目录（声明式数据，callee → 参数/返回形状，字段与真实 stdlib
 *       契约一致，原 SCHEMAS 数据迁移）—— 无 per-函数代码路径（SPECIAL_OPS /
 *       isAsync 名单死亡）。
 * 输出：src/mesh/api.d.ts（AI/UI 参考书，不参与任何语言机制）
 *
 * 用法：npx tsx scripts/gen-api-dts.ts
 */

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(__dirname, '..', 'src', 'mesh', 'api.d.ts')

// ── 函数目录（声明式数据，均匀查表；字段 = 真实 stdlib 契约） ──

interface ApiEntry {
  /** 位置 Shape 输入数（源码可见实参中位于 options 之前的 shape 数） */
  inputs: number
  /** options 参数对象类型文本；'never' 表示无 options 参数 */
  params: string
  /** 返回类型文本（含 async 信息：Promise<...> 即异步） */
  returns: string
  /** 可选备注 */
  note?: string
}

const API_ENTRIES: Record<string, ApiEntry> = {
  // ── 创建类 ──
  box: {
    inputs: 0,
    params: '{ size: number | [number, number, number]; center?: [number, number, number]; nRad?: number }',
    returns: 'Shape',
  },
  sphere: {
    inputs: 0,
    params: '{ radius: number; segments?: number; center?: [number, number, number]; nRad?: number }',
    returns: 'Shape',
  },
  cylinder: {
    inputs: 0,
    params: '{ radius: number; height: number; segments?: number; center?: [number, number, number]; nRad?: number }',
    returns: 'Shape',
  },
  cone: {
    inputs: 0,
    params: '{ radiusBottom: number; radiusTop: number; height: number; segments?: number; center?: [number, number, number]; nRad?: number }',
    returns: 'Shape',
  },
  wedge: {
    inputs: 0,
    params: '{ width: number; height: number; angle: number; length: number; center?: [number, number, number]; nRad?: number }',
    returns: 'Shape',
  },
  text: {
    inputs: 0,
    params: '{ text: string; size: number; depth: number }',
    returns: 'Promise<Shape>',
  },
  screw: {
    inputs: 0,
    params: '{ system: string; specIdx: number; thread: string; pitchCustom?: number; length: number; head: string; nRad?: number }',
    returns: 'Promise<Shape>',
  },
  svgExtrude: {
    inputs: 0,
    params: '{ svg: string; depth: number; targetLongSide: number }',
    returns: 'Promise<Shape>',
  },
  sdf: {
    inputs: 0,
    params: '{ code: string; box?: any; resolution?: number; params?: any }',
    returns: 'Promise<Shape>',
  },
  load: {
    inputs: 0,
    params: '{ key?: string; path?: string; url?: string; format?: string }',
    returns: 'Promise<Shape>',
  },

  // ── 变换类 ──
  translate: {
    inputs: 1,
    params: '{ offset: [number, number, number] }',
    returns: 'Shape',
  },
  rotate: {
    inputs: 1,
    params: '{ anglesDeg: [number, number, number]; pivot?: [number, number, number] }',
    returns: 'Shape',
  },
  scale: {
    inputs: 1,
    params: '{ factor: number | [number, number, number] }',
    returns: 'Shape',
  },

  // ── 布尔类 ──
  union: {
    inputs: 2,
    params: 'never',
    returns: 'Promise<Shape>',
    note: 'variadic: union(a, b, ...rest)',
  },
  subtract: {
    inputs: 2,
    params: 'never',
    returns: 'Promise<Shape>',
  },
  intersect: {
    inputs: 2,
    params: 'never',
    returns: 'Promise<Shape>',
  },

  // ── 分割类 ──
  fai_split: {
    inputs: 1,
    params: '{ normal?: [number, number, number]; offset?: number; cutMode?: string; inPlaneAngleDeg?: number; side?: string }',
    returns: 'Promise<{ front: Shape; back: Shape; wedge?: Shape | null }>',
  },

  // ── 特征类 ──
  fai_drill: {
    inputs: 1,
    params: '{ diameter: number; depth?: number; holeType?: string; direction?: string; tolerance?: number; position?: any; faceNormal?: any; screwSystem?: string; screwSpecIdx?: number; screwThread?: string; screwHead?: string }',
    returns: 'Promise<Shape>',
  },
  fai_extrude: {
    inputs: 1,
    params: '{ length: number; mode?: string; normal?: [number, number, number]; originOffset?: number; space?: string }',
    returns: 'Promise<Shape>',
  },
  engrave: {
    inputs: 1,
    params: '{ text?: string; depth?: number; textSize?: number; svg?: any; svgSize?: number; mode?: string; faceCenter?: any; faceNormal?: any }',
    returns: 'Promise<Shape>',
  },
  knurl: {
    inputs: 1,
    params: '{ knurlTextureHeight?: number; knurlScaleU?: number; knurlScaleV?: number; knurlInvertDisplacement?: boolean; knurlRefineLength?: number; knurlMappingMode?: number; faceCenter?: any; faceNormal?: any }',
    returns: 'Promise<Shape>',
  },
  chamfer: {
    inputs: 1,
    params: '{ edges: any[]; type?: string; width?: number; width1?: number; width2?: number; angle?: number }',
    returns: 'Promise<Shape>',
  },

  // ── 结构类 ──
  group: {
    inputs: 0,
    params: '{ name?: string; members?: readonly Shape[] }',
    returns: 'Shape',
    note: 'members are kept via function-body exec.keep (visible); group does not consume them',
  },
  assembly: {
    inputs: 0,
    params: '{ name?: string; members?: readonly Shape[]; constraints?: any[] }',
    returns: 'Shape',
    note: 'members are kept via function-body exec.keep (visible); assembly does not consume them',
  },

  // ── 克隆 ──
  copy: {
    inputs: 1,
    params: 'never',
    returns: 'Shape',
    note: 'input is kept via function-body exec.keep (visible); copy does not consume it',
  },

  // ── 几何查询 ──
  faceNormal: {
    inputs: 1,
    params: 'never',
    returns: '[number, number, number]',
    note: 'usage: cad.faceNormal(of, anchor?, faceOrdinal?)',
  },
  bboxCenter: {
    inputs: 1,
    params: 'never',
    returns: '[number, number, number]',
  },
  bboxMin: {
    inputs: 1,
    params: 'never',
    returns: '[number, number, number]',
  },
  bboxMax: {
    inputs: 1,
    params: 'never',
    returns: '[number, number, number]',
  },

  // ── 资产 ──
  asset: {
    inputs: 0,
    params: 'never',
    returns: 'Promise<string>',
    note: 'usage: cad.asset(key) inside args (nested call)',
  },
}

// ── 生成签名 ──

/** 生成单个函数的签名行（源码可见形态：shape 位置参数 + options + 返回类型）。 */
function genEntry(callee: string, entry: ApiEntry): string {
  const shapeParams: string[] = []
  for (let i = 0; i < entry.inputs; i++) {
    shapeParams.push(`shape${i === 0 ? '' : i}: Shape`)
  }
  const paramsPart = entry.params === 'never' ? 'params?: never' : `params: ${entry.params}`
  const sig = `  ${callee}(${[...shapeParams, paramsPart].join(', ')}): ${entry.returns}`
  return entry.note ? `${sig}  // ${entry.note}` : sig
}

// ── 查询方法（mesh/query，非 stdlib；设计文档 §4.10 保留硬编码） ──

const QUERY_METHODS = [
  `  boundingBox(shape: Shape): { min: [number, number, number]; max: [number, number, number] }`,
  `  bboxCenter(shape: Shape): [number, number, number]`,
  `  volume(shape: Shape): number`,
  `  faceAt(shape: Shape, anchor: { point: [number, number, number]; normal?: [number, number, number] }): {\n    center: [number, number, number]\n    normal: [number, number, number]\n    area: number\n  } | null`,
]

// ── 生成完整文件 ──

const ORDER = [
  'box', 'sphere', 'cylinder', 'cone', 'wedge',
  'text', 'screw', 'svgExtrude', 'sdf', 'load',
  'translate', 'rotate', 'scale',
  'union', 'subtract', 'intersect',
  'fai_split',
  'fai_drill', 'fai_extrude', 'engrave', 'chamfer', 'knurl',
  'group', 'assembly', 'copy',
  'faceNormal', 'bboxCenter', 'bboxMin', 'bboxMax',
  'asset',
]

function generate(): string {
  const lines: string[] = []

  lines.push(`/**`)
  lines.push(` * cad-core API 类型定义 — AI 建模时的提示词素材`)
  lines.push(` *`)
  lines.push(` * ⚠️ 此文件由 scripts/gen-api-dts.ts 从 stdlib 函数目录生成，禁止手改。`)
  lines.push(` * 修改 stdlib 函数签名/目录后运行：npx tsx scripts/gen-api-dts.ts`)
  lines.push(` */`)
  lines.push(``)
  lines.push(`import type { Shape } from './types'`)
  lines.push(``)
  lines.push(`/**`)
  lines.push(` * The \`cad\` object's runtime API surface: every callable available to a`)
  lines.push(` * \`.fai.js\` model, grouped by category (creation, transform, boolean, split,`)
  lines.push(` * drill, extrude, engrave, chamfer, structure, geometry queries, assets).`)
  lines.push(` */`)
  lines.push(`export interface CadAPI {`)

  const sections: Array<[string, string[]]> = [
    ['创建', ['box', 'sphere', 'cylinder', 'cone', 'wedge', 'text', 'screw', 'svgExtrude', 'sdf', 'load']],
    ['变换', ['translate', 'rotate', 'scale']],
    ['布尔', ['union', 'subtract', 'intersect']],
    ['分割', ['fai_split']],
    ['钻孔', ['fai_drill']],
    ['拉伸', ['fai_extrude']],
    ['雕刻', ['engrave', 'knurl']],
    ['倒角', ['chamfer']],
    ['结构（不消费成员）', ['group', 'assembly', 'copy']],
    ['几何查询', ['faceNormal', 'bboxCenter', 'bboxMin', 'bboxMax']],
    ['资产', ['asset']],
    ['查询方法（mesh/query）', []],
  ]

  let first = true
  for (const [title, callees] of sections) {
    if (!first) lines.push(``)
    first = false
    lines.push(`  // ── ${title} ──`)
    for (const c of callees) {
      lines.push(genEntry(c, API_ENTRIES[c]))
    }
    if (title === '查询方法（mesh/query）') {
      lines.push(...QUERY_METHODS)
    }
  }

  lines.push(`}`)
  lines.push(``)

  // 守卫：目录键与 stdlib cad 命名空间一致（缺一即生成时报错，防漂移）
  const missing = ORDER.filter((c) => !API_ENTRIES[c])
  if (missing.length > 0) {
    throw new Error(`[gen-api-dts] API_ENTRIES missing: ${missing.join(', ')}`)
  }

  return lines.join('\n')
}

// ── 主入口 ──

export { generate, outputPath }

// 仅直接执行时写文件（被 api-dts-sync.test.ts import 时不触发副作用）
const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const content = generate()
  writeFileSync(outputPath, content, 'utf-8')
  console.log(`[gen-api-dts] Generated ${outputPath}`)
  console.log(`[gen-api-dts] ${content.split('\n').length} lines`)
}
