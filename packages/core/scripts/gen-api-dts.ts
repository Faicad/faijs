/**
 * api.d.ts 生成脚本 — 从 stdlib 函数目录 + 签名生成 CadAPI 类型定义
 *
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
import { collectRoleVocab } from './role-vocab'

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
  /**
   * 已废弃说明（deprecated）。给定后在该签名前输出一段带 `@deprecated` 的 JSDoc
   * 注释块，让 AI / IDE 看到废弃标记；`fai_` 前缀 op 走此字段。
   */
  deprecated?: string
  /**
   * 可选的完整源码可见参数列表覆盖（位置原生 op，如
   * `box(width, depth, height, options?)`——除 options 对象外还有前置位置参数）。
   * 给定后忽略 inputs/params 的拼接。
   */
  args?: string
}

/**
 * `fai_` 前缀 op 的说明（`../3d_editor` 消费面）。
 *
 * ⚠️ 措辞于 2026-09-22 校正（D8）：原文写「将来迁出并从 faijs 删除 / 新代码请勿使用」，
 * 那是**错误定位**——这些 op 服务 `../3d_editor` 的**真实负载**，不是删除候选。
 * 留着旧措辞 = 留一个未来必定踩的坑（后人会把它们当死代码删掉，从而打断 3d_editor）。
 */
const FAI_DEPRECATED =
  '**`../3d_editor` 消费面**：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。'

/**
 * `../3d_editor` 项目特有的**编辑器交互** op（transform 家族 / group / assembly /
 * copy）的说明。它们的形态服务编辑器——画布显示、拖拽、时间线语句、结构分组
 * ——而非几何语义，因此不属于 faijs 平台面。
 *
 * ⚠️ 措辞于 2026-09-22 校正（D8）：同 {@link FAI_DEPRECATED}，它们**不是废弃项**。
 */
const EDITOR_OWNED_DEPRECATED =
  '**`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。'

const API_ENTRIES: Record<string, ApiEntry> = {
  // ── 创建类 ──
  box: {
    inputs: 0,
    args:
      'width: number, depth: number, height: number, options?: ' +
      '{ at?: [number, number, number]; centered?: boolean; segments?: number }',
    params: 'never',
    returns: 'Shape',
  },
  sphere: {
    inputs: 0,
    params: '{ radius: number; segments?: number; center?: [number, number, number]; nRad?: number }',
    returns: 'Shape',
  },
  cylinder: {
    inputs: 0,
    params: '{ radius: number; height: number; at?: [number, number, number]; centered?: boolean; segments?: number; nRad?: number }',
    returns: 'Shape',
  },
  cone: {
    inputs: 0,
    params: '{ radiusBottom: number; radiusTop: number; height: number; at?: [number, number, number]; centered?: boolean; segments?: number; nRad?: number }',
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
  import_brep: {
    inputs: 0,
    params: '{ asset: string }',
    returns: 'Promise<Shape>',
    note: 'usage: cad.import_brep({asset}) — platform BREP asset import (non-solid wire/face/shell allowed, C6)',
  },
  import_step: {
    inputs: 0,
    params: '{ path: string }',
    returns: 'Promise<Shape>',
    note: 'usage: cad.import_step({path}) — platform STEP file import via host resolveFile (OCCT reader; non-solid allowed, C6)',
  },

  // ── 变换类（DEPRECATED: ../3d_editor 编辑器交互 op） ──
  translate: {
    inputs: 1,
    params: '{ offset: [number, number, number] }',
    returns: 'Shape',
    deprecated: EDITOR_OWNED_DEPRECATED,
  },
  rotate_euler: {
    inputs: 1,
    params: '{ anglesDeg: [number, number, number]; pivot?: [number, number, number] }',
    returns: 'Shape',
    deprecated: EDITOR_OWNED_DEPRECATED,
  },
  scale: {
    inputs: 1,
    args: 'shape: Shape, factor: number, options?: { center?: [number, number, number] }',
    params: 'never',
    returns: 'Shape',
    deprecated: EDITOR_OWNED_DEPRECATED,
  },
  scale3d: {
    inputs: 1,
    args: 'shape: Shape, factor: [number, number, number], options?: { center?: [number, number, number] }',
    params: 'never',
    returns: 'Shape',
    deprecated: EDITOR_OWNED_DEPRECATED,
  },
  place: {
    inputs: 1,
    params: '{ position?: [number, number, number]; rotation?: [number, number, number, number] }',
    returns: 'Shape',
    note: 'rigid placement: rotate (quaternion, about local origin) then translate; = FreeCAD Placement T∘R',
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
    deprecated: FAI_DEPRECATED,
  },

  // ── 特征类 ──
  fai_drill: {
    inputs: 1,
    params: '{ diameter: number; depth?: number; holeType?: string; direction?: string; tolerance?: number; position?: any; faceNormal?: any; screwSystem?: string; screwSpecIdx?: number; screwThread?: string; screwHead?: string }',
    returns: 'Promise<Shape>',
    deprecated: FAI_DEPRECATED,
  },
  fai_extrude: {
    inputs: 1,
    params: '{ length: number; mode?: string; normal?: [number, number, number]; originOffset?: number; space?: string }',
    returns: 'Promise<Shape>',
    deprecated: FAI_DEPRECATED,
  },
  extrude: {
    inputs: 1,
    params: '{ length?: number; normal?: [number, number, number]; mode?: string; upTo?: any; baseFeature?: Shape; offset?: number }',
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

  // ── 结构类（DEPRECATED: ../3d_editor 编辑器交互 op） ──
  group: {
    inputs: 0,
    params: '{ name?: string; members?: readonly Shape[] }',
    returns: 'Shape',
    note: 'members are kept via function-body exec.keep (visible); group does not consume them',
    deprecated: EDITOR_OWNED_DEPRECATED,
  },
  compound: {
    inputs: 0,
    params: '{ members?: Shape[]; name?: string }',
    returns: 'Shape',
    note: 'platform geometric compound (OCCT TopoDS_Compound handle); merges member meshes / makeCompound — NOT the editor group',
  },
  assembly: {
    inputs: 0,
    params: '{ name?: string; members?: readonly Shape[]; constraints?: any[] }',
    returns: 'Shape',
    note: 'members are kept via function-body exec.keep (visible); assembly does not consume them',
    deprecated: EDITOR_OWNED_DEPRECATED,
  },

  // ── 克隆（DEPRECATED: ../3d_editor 编辑器交互 op） ──
  copy: {
    inputs: 1,
    params: 'never',
    returns: 'Shape',
    note: 'input is kept via function-body exec.keep (visible); copy does not consume it',
    deprecated: EDITOR_OWNED_DEPRECATED,
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

/** 生成单个函数的签名行（源码可见形态：shape 位置参数 + options + 返回类型）；带 `deprecated` 时在签名前输出 `@deprecated` JSDoc 块。 */
function genEntry(callee: string, entry: ApiEntry): string {
  const lines: string[] = []
  if (entry.deprecated) {
    lines.push('  /**')
    lines.push(`   * @deprecated ${entry.deprecated}`)
    lines.push('   */')
  }
  if (entry.args !== undefined) {
    const sigArgs = `  ${callee}(${entry.args}): ${entry.returns}`
    lines.push(entry.note ? `${sigArgs}  // ${entry.note}` : sigArgs)
    return lines.join('\n')
  }
  const shapeParams: string[] = []
  for (let i = 0; i < entry.inputs; i++) {
    shapeParams.push(`shape${i === 0 ? '' : i}: Shape`)
  }
  const paramsPart = entry.params === 'never' ? 'params?: never' : `params: ${entry.params}`
  const sig = `  ${callee}(${[...shapeParams, paramsPart].join(', ')}): ${entry.returns}`
  lines.push(entry.note ? `${sig}  // ${entry.note}` : sig)
  return lines.join('\n')
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
  'text', 'screw', 'svgExtrude', 'sdf', 'load', 'import_brep', 'import_step',
  'translate', 'rotate_euler', 'scale', 'scale3d', 'place',
  'union', 'subtract', 'intersect',
  'fai_split',
  'fai_drill', 'extrude', 'fai_extrude', 'engrave', 'chamfer', 'knurl',
  'group', 'compound', 'assembly', 'copy',
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
    ['创建', ['box', 'sphere', 'cylinder', 'cone', 'wedge', 'text', 'screw', 'svgExtrude', 'sdf', 'load', 'import_brep', 'import_step']],
    ['变换', ['translate', 'rotate_euler', 'scale', 'scale3d', 'place']],
    ['布尔', ['union', 'subtract', 'intersect']],
    ['分割', ['fai_split']],
    ['钻孔', ['fai_drill']],
    ['拉伸', ['extrude', 'fai_extrude']],
    ['雕刻', ['engrave', 'knurl']],
    ['倒角', ['chamfer']],
    ['结构（不消费成员）', ['group', 'compound', 'assembly', 'copy']],
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

  // ── role 词汇表（2.10）：从 DUAL_OP_META.naming 收集，供 AI/用户引用 face role ──
  lines.push(`/**`)
  lines.push(` * Topology identity role vocabulary per op (plan §4.2, Phase 2.10).`)
  lines.push(` *`)
  lines.push(` * Generated from each op's \`naming\` provenance declaration (\`DUAL_OP_META\`).`)
  lines.push(` * \`vocab\` lists the serialized \`RoleName\` forms the op assigns to faces it`)
  lines.push(` * **creates**; inherited faces keep their originating op's role. Changing a`)
  lines.push(` * vocabulary is a breaking change to \`.fai.js\` scripts (versioned contract).`)
  lines.push(` */`)
  lines.push(`export interface CadRoleVocab {`)
  lines.push(`  op: string`)
  lines.push(`  kind: 'kernel' | 'construct' | 'identity' | 'replicate' | 'subdivide' | 'unmodeled'`)
  lines.push(`  reason?: string`)
  lines.push(`  vocab: readonly string[]`)
  lines.push(`  note?: string`)
  lines.push(`}`)
  lines.push(``)
  lines.push(`export const CAD_ROLE_VOCAB: readonly CadRoleVocab[] = [`)
  for (const e of collectRoleVocab()) {
    const parts = [
      `op: '${e.op}'`,
      `kind: '${e.kind}' as CadRoleVocab['kind']`,
      e.reason !== undefined ? `reason: ${JSON.stringify(e.reason)}` : '',
      `vocab: [${e.vocab.map((v) => `'${v}'`).join(', ')}]`,
      e.note !== undefined ? `note: ${JSON.stringify(e.note)}` : '',
    ].filter(Boolean)
    lines.push(`  { ${parts.join(', ')} },`)
  }
  lines.push(`]`)
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
