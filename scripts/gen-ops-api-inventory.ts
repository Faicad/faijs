/**
 * @deprecated 2026-10-08 —— 本生成器已停用，未来删除。不要新增依赖，不要接回门禁链。
 *
 * 裁定（2026-10-08，`docs/plans/2026-10-08-assembly-hierarchy-and-export-plan.md`
 * 决策记录 DEC-8）：「这个 gen-ops-api-inventory.ts 本身就很可疑。把它从任何测试
 * 中拿掉，并标记为deprecated。我认为未来要删除它。」
 *
 * 已解除的接线（本次）：
 *   - 根 `package.json` 的 `doc-sync` 链不再调用 `--check`；
 *   - `packages/core/src/lang/ops-inventory-coverage.test.ts`（本产物的覆盖守卫）
 *     已删除——它本就不被任何 vitest project 匹配（各包 `include` 只含 `test/**`），
 *     从未真正执行过。
 *
 * 保留 `npm run gen-ops-api-inventory` / `npm run check-ops-api-inventory` 两个手工
 * 入口，仅作过渡期手动重生成 `docs/ops-api-inventory.md` / `.zh.md` 之用。
 *
 * ----- 以下为停用前的原始说明 -----
 *
 * Generate docs/ops-api-inventory.md (+ .zh.md + .i18n.yaml) from the L3
 * API-surface exported-op JSDoc. The api layer (core/src/api) is the
 * single source of truth for the faijs `.fai.js` coding API; this generator
 * projects each op's JSDoc (params, types, required/default, quality, group,
 * async, examples, notes) into the standing bilingual doc so it never silently
 * drifts from the implementation.
 *
 * Usage:
 *   npx tsx scripts/gen-ops-api-inventory.ts            # write both sides
 *   npx tsx scripts/gen-ops-api-inventory.ts --check    # diff, fail if stale
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { collectRoleVocab } from '../packages/core/scripts/role-vocab'
import { ARG_SPEC, type ArgSpecEntry } from '../packages/core/src/api/surface/arg-spec'
import { SCRIPT_FACE_OPS } from '../packages/core/src/api/generated/script-face-manifest'
import SYMBOL_TABLE from '../packages/core/src/lang/symbol-table.generated'

const root = resolve(import.meta.dirname, '..')
const API_SRC = join(root, 'packages/core/src/api')
const EN_TARGET = join(root, 'docs/ops-api-inventory.md')
const ZH_TARGET = join(root, 'docs/ops-api-inventory.zh.md')

/** Phase 0 能力映射表（36 compat op → 内核方法真名清单；能力声明列数据源）。 */
interface CapabilityEntry {
  op: string
  kernelMethods: string[]
}
// GOTCHA (2026-09-24): this generator **embeds** capability-map.json (the per-op
// kernel-method column). Regenerating the map therefore makes the inventory stale
// too — run `npm run gen:capability-map -w @faicad/faijs` and then this script, or
// `npm run doc-sync` will fail on the inventory check with no hint about the map.
const CAPABILITY_MAP: CapabilityEntry[] = JSON.parse(
  readFileSync(join(root, 'packages/core/src/api/surface/capability-map.json'), 'utf8'),
).entries
/** op 名 → 内核方法清单（能力声明列查找表）。 */
const CAPABILITY_BY_OP = new Map(CAPABILITY_MAP.map((e) => [e.op, e.kernelMethods]))

interface Param {
  name: string
  type: string
  required: boolean
  default?: string
  desc: string
}

interface Op {
  name: string
  group: string
  inputs: number
  async: boolean
  qual: 'ok' | 'warn' | 'error'
  desc: string
  params: Param[]
  returns?: string
  note?: string[]
  example: string[]
  /** `@deprecated` 说明（存在即视为已废弃）。 */
  deprecated?: string
}

const QUAL_LABEL: Record<Op['qual'], string> = {
  ok: '✅',
  warn: '⚠️',
  error: '❌',
}

/**
 * 一个逐 op 手册章节。手写版 op（api/ JSDoc 契约）与派生版 op
 * （`api/surface/arg-spec.ts`）统一成同一形状，由分组循环统一编号。
 *
 * `body` 不含 `###` 标题行——编号由渲染循环给出，章节顺序才可能被校验。
 */
interface Chapter {
  name: string
  group: string
  qual: Op['qual']
  deprecated?: string
  /** 品质状态表里的一句话说明（手写版取首条 `@note`，退化为描述）。 */
  qualNote?: string
  /** 章节正文行（不含标题）。 */
  body: string[]
}

/** Strip the file-level license/header block and split into op-level JSDoc blocks. */
function collectOps(file: string): Op[] {
  const text = readFileSync(file, 'utf8')
  const ops: Op[] = []
  const re = /\/\*\*([\s\S]*?)\*\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]
    const lines = raw
      .split('\n')
      .map((l) => l.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
      .map((l) => l.trim())
    if (!lines.some((l) => l.startsWith('@group'))) continue
    const tags: Record<string, string[]> = {}
    let current: string | null = null
    let prose: string[] = []
    for (const line of lines) {
      const t = /^@([\w.]+)\s*(.*)$/.exec(line)
      if (t) {
        current = t[1]
        tags[current] = tags[current] ?? []
        tags[current].push(t[2] ?? '')
      } else if (current && line) {
        tags[current][tags[current].length - 1] += current === 'example' ? `\n${line}` : ` ${line}`
      } else if (line) {
        prose.push(line)
      }
    }
    const name = tags['name']?.[0]?.trim()
    if (!name) continue
    const params: Param[] = []
    for (const p of tags['param'] ?? []) {
      const parsed = parseParam(p)
      if (!parsed) continue
      if (parsed.name === 'input' || parsed.name === 'maybeParams') continue
      params.push(parsed)
    }
    ops.push({
      name,
      group: tags['group']?.[0]?.trim() ?? '其他',
      inputs: Number(tags['inputs']?.[0] ?? 1),
      async: (tags['async']?.[0]?.trim() ?? 'false') === 'true',
      qual: (tags['qual']?.[0]?.trim() as Op['qual']) ?? 'ok',
      desc: (tags['desc']?.[0] ?? prose.join(' ')).trim(),
      params,
      returns: tags['returns']?.[0]?.trim(),
      note: tags['note']?.map((s) => s.trim()).filter(Boolean),
      example: tags['example']?.map((s) => s.replace(/^`/, '').trim()) ?? [],
      deprecated: tags['deprecated']?.[0]?.trim() || undefined,
    })
  }
  return ops
}

/** Parse one `@param` line into a Param record. */
function parseParam(raw: string): Param | null {
  const sep = raw.indexOf(' - ')
  if (sep < 0) return null
  let name = raw.slice(0, sep).trim()
  const rest = raw.slice(sep + 3)
  if (name.includes('.')) name = name.slice(name.lastIndexOf('.') + 1)

  let type = ''
  let required = false
  let def: string | undefined
  let desc = rest

  const typeM = /type\s*[:：]\s*(.+?)\s+(?=required|默认)/.exec(rest)
    ?? /type\s*[:：]\s*(.+)$/.exec(rest)
  if (typeM) {
    type = typeM[1].trim()
    desc = desc.replace(/type\s*[:：].*?(?=required|默认|$)/, '')
  }
  const reqM = /required\s*[:：]\s*(true|false)/.exec(rest)
  if (reqM) {
    required = reqM[1] === 'true'
    desc = desc.replace(/required\s*[:：]\s*(true|false)/, '')
  }
  const defM = /默认\s*[:：]?\s*(.+)$/.exec(rest)
  if (defM) {
    def = defM[1].replace(/[。；;]$/, '').trim()
    desc = desc.replace(/默认\s*[:：]?\s*.+$/, '')
  }
  desc = desc.replace(/[；;。]?\s*$/, '').replace(/\s+$/, '').trim()
  return { name, type, required, default: def, desc }
}

/**
 * 手册分节顺序。**必须覆盖 op 声明的全部 `@group` 值**——不在本表里的分组会被
 * 静默丢弃（B1 的根因：`修复` 组 6 个 op 曾因此整组从手册消失）。`collectChapters`
 * 会断言这一点。
 */
const GROUP_ORDER = ['创建', '变换', '特征', '修复', '结构', '查询']

/** 分节标题里的序号（渲染成 `## ${n}. ${group}类操作`）。 */
const GROUP_SECTION: Record<string, number> = {
  创建: 3,
  变换: 4,
  特征: 5,
  修复: 6,
  结构: 7,
  查询: 8,
}

const GROUP_SUFFIX: Record<string, string> = {
  创建: '（无上游输入）',
  // 结构组不再一律「无几何输出」：`cad.compound` 是持 OCCT 句柄的几何复合体，
  // 而 `group`/`assembly` 仍是结构壳。标题按两者共有的性质写。
  结构: '（结构 / 聚合）',
  查询: '（几何 / 资产引用 / 装配查询）',
}

// ────────────────────────────────────────────────────────────────────────────
// B1：arg-spec 派生章节
//
// 脚本面 op 分两代落地：
//   ① 手写 op —— `api/**/*.ts` 里带 `@group` 的 JSDoc 契约（`collectOps` 收）；
//   ② 生成 op —— 由 `api/surface/arg-spec.ts` 投影（`compatOp(projectBrepOp(...))`
//      或 core 自有实现），**生成文件禁手改，因此不带 `@group`**。
// ② 曾整类缺席手册（38 个符号无逐 op 章节，含 `applyMatrix`——与 OpenSCAD
// `multmatrix` 逐字对应的任意仿射变换）。本段把 ② 补上：从 arg-spec 取
// `args` / `params` / `queryParams` / `capabilities` / `engines` / `reason`
// 现算章节，与 `script-face-manifest.ts` 同源，从根上不再有手工滞后。
// ────────────────────────────────────────────────────────────────────────────

/**
 * 派生 op 的语义分组——**唯一人工维护点**（B1）。
 *
 * 生成文件不带 `@group`，arg-spec 的 `module`（topology / operations / …）是
 * *代码分片*不是语义分组（`topology` 同时含构造、变换与查询），故分组必须显式
 * 声明。新增脚本面 op 若不出现在本表，`collectChapters()` 直接报错——漏归类
 * 不可能再变成静默缺章。
 */
const DERIVED_GROUP: Record<string, string> = {
  // 创建类：无上游几何输入，整件构造
  torus: '创建',
  makeBaseBox: '创建',
  ellipsoid: '创建',
  convexHull: '创建',
  thread: '创建',
  // 变换类：整件变换 / 定位
  rotate: '变换',
  applyMatrix: '变换',
  locate: '变换',
  offset: '变换',
  // 特征类：输入几何 → 新几何
  fuse: '特征',
  complexExtrude: '特征',
  twistExtrude: '特征',
  roof: '特征',
  drill: '特征',
  pocket: '特征',
  boss: '特征',
  // 修复类：整件/子面修复与简化
  heal: '修复',
  simplify: '修复',
  autoHeal: '修复',
  fixShape: '修复',
  healSolid: '修复',
  fixSelfIntersection: '修复',
  // 查询类：返回纯数据（非 Shape）
  inspectMassProps: '查询',
  area: '查询',
  length: '查询',
  volume: '查询',
  centerOfMass: '查询',
  isValid: '查询',
  isSameShape: '查询',
}

/** arg-spec `args` 人读串解析出的一个形参。 */
interface DerivedArg {
  name: string
  type: string
  required: boolean
}

/**
 * 从 arg-spec 的 `args` 人读串里抽出形参。串形态**不统一**（历史原因）：
 *   `(majorRadius: number, options?: TorusOptions)`（torus）
 *   `fuse(a: Shape3D, b: Shape3D, options?: BooleanOptions) -> Result<Shape3D>`（fuse）
 *   `complexExtrude(wire: Shape, center: Vec3, profile?: ExtrusionProfile): Shape`
 * 故取**第一对括号**并按顶层逗号切分（忽略 `{}` / `<>` 内的逗号）。解析结果与
 * `entry.params` 不符时返回空表——宁可少一列类型，不编造形参。
 */
function parseArgsLine(entry: ArgSpecEntry): DerivedArg[] {
  const raw = entry.args ?? ''
  const open = raw.indexOf('(')
  if (open < 0) return []
  let depth = 0
  let close = -1
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === '(') depth++
    else if (raw[i] === ')') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0) return []
  const inner = raw.slice(open + 1, close)
  if (!inner.trim()) return []

  const items: string[] = []
  let buf = ''
  let nest = 0
  for (const ch of inner) {
    if ('({[<'.includes(ch)) nest++
    else if (')}]>'.includes(ch)) nest--
    if (ch === ',' && nest === 0) {
      items.push(buf)
      buf = ''
    } else buf += ch
  }
  items.push(buf)

  const parsed: DerivedArg[] = []
  for (const item of items) {
    const m = /^\s*(\w+)\s*(\?)?\s*:\s*([\s\S]+?)\s*$/.exec(item)
    if (!m) return []
    parsed.push({ name: m[1], type: m[3], required: m[2] !== '?' })
  }
  // 与机器参数名表对不上 → 串形态超出解析能力，退回「只列参数名」
  const expected = entry.params
  if (expected && JSON.stringify(parsed.map((p) => p.name)) !== JSON.stringify(expected)) return []
  return parsed
}

/**
 * 形参在 op 里的角色。几何位的权威声明是 `geometryArgs` /
 * `geometryCollectionArgs`；`kind: 'faijs'` 的原生库函数（`area` / `volume` …）
 * 没有这两列，按形参类型 `Shape*` 兜底推断。
 */
function argRole(entry: ArgSpecEntry, index: number, type: string): string {
  if ((entry.geometryCollectionArgs ?? []).includes(index)) return '几何输入（Shape 数组）'
  if ((entry.geometryArgs ?? []).includes(index)) return '几何输入（Shape）'
  if (/^Shape\b/.test(type)) return type.endsWith('[]') ? '几何输入（Shape 数组）' : '几何输入（Shape）'
  return '数值 / 选项参数'
}

/** arg-spec 派生 op 的返回值说明（`brep-op` 产出几何，`query` / `faijs` 产出纯数据）。 */
function derivedReturns(entry: ArgSpecEntry): string {
  if (entry.kind === 'brep-op') {
    const unwrap = '脚本面语句边界 unwrap `Result`，err → 语句失败'
    if (entry.outputs?.length) {
      return `多产物对象（\`${entry.outputs.join('` / `')}\` 为 Shape 包装位，同对象其余键如诊断原样透传；${unwrap}）。`
    }
    return `Shape 几何产物（${unwrap}）。`
  }
  const arrow = (entry.args ?? '').match(/->\s*([\s\S]+)$/)
  const ret = entry.returnType ?? arrow?.[1]?.trim()
  return ret ? `${ret} —— 纯数据结果（非 Shape）。` : '纯数据结果（非 Shape）。'
}

/** 由一条 arg-spec 条目渲染出逐 op 章节。 */
function chapterFromArgSpec(entry: ArgSpecEntry): Chapter | null {
  const group = DERIVED_GROUP[entry.name]
  if (!group) return null
  const manifest = SCRIPT_FACE_OPS.find((op) => op.name === entry.name)
  const derivedArgs = parseArgsLine(entry)
  const queryParam = new Map((entry.queryParams ?? []).map((p) => [p.name, p]))

  const body: string[] = []
  if (entry.reason) {
    body.push(entry.reason, '')
  }
  body.push('```js')
  body.push(entry.args ?? `${entry.name}(…)`)
  body.push('```', '')
  body.push('| 参数 | 类型 | 必填 | 说明 |')
  body.push('|---|---|---|---|')
  const nameList = derivedArgs.length > 0 ? derivedArgs.map((p) => p.name) : entry.params ?? []
  if (nameList.length === 0) {
    body.push('| — | — | — | 无参数 |')
  }
  nameList.forEach((name, i) => {
    const arg = derivedArgs[i]
    const type = arg?.type ?? queryParam.get(name)?.type ?? '—'
    const required = arg ? arg.required : queryParam.get(name) ? !queryParam.get(name)!.optional : true
    const desc = queryParam.get(name)?.docs ?? argRole(entry, i, type)
    body.push(`| \`${name}\` | \`${type}\` | ${required ? '✅' : ''} | ${desc} |`)
  })
  body.push('')
  body.push(`**${entry.kind === 'brep-op' ? '异步' : '同步'}**。${derivedReturns(entry)}`)
  body.push('')
  const notes: string[] = []
  if (entry.manualNote) notes.push(entry.manualNote)
  notes.push(
    `自动派生自 \`api/surface/arg-spec.ts\`（module \`${entry.module ?? 'topology'}\`）——生成 op 无手写 JSDoc 契约。`,
  )
  if (manifest?.engines?.length) notes.push(`**平台限定**：仅 \`${manifest.engines.join('` / `')}\` 引擎（缺能力时执行前静态报错，不回退）。`)
  if (entry.capabilities?.length) notes.push(`内核能力依赖：${entry.capabilities.map((c) => `\`${c}\``).join('、')}。`)
  if (entry.source) notes.push(`实现：\`${entry.source}\`。`)
  if (manifest?.paramDims && Object.keys(manifest.paramDims).length > 0) {
    notes.push(`参数量纲：${Object.entries(manifest.paramDims).map(([k, v]) => `\`${k}\`→\`${v}\``).join('、')}。`)
  }
  if (manifest?.retDim) notes.push(`返回量纲：\`${manifest.retDim}\`。`)
  body.push(notes.map((n) => `> ${n}`).join('\n>\n'))
  body.push('')

  return { name: entry.name, group, qual: 'ok', body }
}

/** 手写 op（`collectOps` 产物）→ 章节。 */
function chapterFromOp(op: Op): Chapter {
  const body: string[] = []
  if (op.desc) body.push(op.desc, '')
  if (op.deprecated) body.push(`> 🚫 **已废弃（deprecated）**：${op.deprecated}`, '')
  for (const ex of op.example) {
    body.push('```js')
    for (const exLine of ex.split('\n')) body.push(exLine)
    body.push('```', '')
  }
  body.push('| 参数 | 类型 | 必填 | 默认 | 说明 |')
  body.push('|---|---|---|---|---|')
  for (const p of op.params) {
    body.push(`| \`${p.name}\` | \`${p.type}\` | ${p.required ? '✅' : ''} | ${p.default ?? '—'} | ${p.desc} |`)
  }
  body.push('')
  body.push(`**${op.async ? '异步' : '同步'}**。${op.returns ?? ''}`)
  body.push('')
  if (op.note && op.note.length) {
    body.push(op.note.map((n) => `> ${n}`).join('\n>\n'))
    body.push('')
  }
  return { name: op.name, group: op.group, qual: op.qual, deprecated: op.deprecated, qualNote: op.note?.[0] ?? op.desc, body }
}

/** 递归收集 api/ 下全部源码（含子目录模块，如 api/view/）。 */
function walkApiSources(dir: string, files: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) walkApiSources(p, files)
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) files.push(p)
  }
}

/**
 * 全部逐 op 章节 = 手写 JSDoc 契约 ∪ arg-spec 派生，去重后按 `GROUP_ORDER` 分节。
 *
 * 两条断言把 B1 那类缺陷钉死：
 *   ① 手写 op 的每个 `@group` 必须在 `GROUP_ORDER` 里（否则整组静默消失）；
 *   ② 章节名集合必须**恰好等于** `lang/symbol-table.generated.ts` 的键集
 *      （符号表 = `cad` 命名空间可调用键集，即脚本面真实 op 全集）。
 */
function collectChapters(): Chapter[] {
  const files: string[] = []
  walkApiSources(API_SRC, files)
  const handwritten = files.flatMap((f) => collectOps(f)).map(chapterFromOp)

  const covered = new Set(handwritten.map((c) => c.name))
  const derived: Chapter[] = []
  for (const op of SCRIPT_FACE_OPS) {
    if (covered.has(op.name)) continue
    const entry = ARG_SPEC.find((e) => e.name === op.name)
    if (!entry) {
      throw new Error(
        `gen-ops-api-inventory: 脚本面 op '${op.name}' 既无手写 @group JSDoc，也不在 api/surface/arg-spec.ts —— 手册无法覆盖它。`,
      )
    }
    const chapter = chapterFromArgSpec(entry)
    if (!chapter) {
      throw new Error(
        `gen-ops-api-inventory: 脚本面 op '${op.name}' 未在 DERIVED_GROUP 中归类 —— 给它一个语义分组（创建/变换/特征/修复/结构/查询）。`,
      )
    }
    derived.push(chapter)
    covered.add(op.name)
  }

  const chapters = [...handwritten, ...derived]

  // ① 分组表必须覆盖 op 声明的全部 @group（漏一个 = 整组从手册消失）
  const unknownGroups = [...new Set(chapters.map((c) => c.group))].filter((g) => !GROUP_ORDER.includes(g))
  if (unknownGroups.length > 0) {
    throw new Error(
      `gen-ops-api-inventory: @group 值 ${unknownGroups.join('、')} 不在 GROUP_ORDER 中 —— 该组会被静默丢弃。请补进 GROUP_ORDER / GROUP_SECTION。`,
    )
  }

  // ② 章节符号集必须恰好等于符号表键集（双向：无缺章、无幽灵章）
  const symbolKeys = new Set(Object.keys(SYMBOL_TABLE))
  const chapterNames = new Set(chapters.map((c) => c.name))
  const missing = [...symbolKeys].filter((k) => !chapterNames.has(k)).sort()
  const ghosts = [...chapterNames].filter((k) => !symbolKeys.has(k)).sort()
  if (missing.length > 0 || ghosts.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) parts.push(`缺失 ${missing.length} 章：${missing.join('、')}`)
    if (ghosts.length > 0) parts.push(`手册有而符号表无 ${ghosts.length} 个：${ghosts.join('、')}`)
    throw new Error(
      `gen-ops-api-inventory: 逐 op 章节符号集 ≠ 符号表键集（${chapterNames.size} vs ${symbolKeys.size}）—— ${parts.join('；')}。`,
    )
  }

  return chapters
}

/** 逐 op 章节全集（模块级只算一次；生成与 `--check` 共用同一份）。 */
const CHAPTERS = collectChapters()

function renderDoc(locale: 'en' | 'zh'): string {
  const grouped = new Map<string, Chapter[]>()
  for (const chapter of CHAPTERS) {
    if (!grouped.has(chapter.group)) grouped.set(chapter.group, [])
    grouped.get(chapter.group)!.push(chapter)
  }
  for (const list of grouped.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  const lines: string[] = []
  lines.push(`# faijs Language API Reference (AI / User Coding Manual)`)
  lines.push('')
  if (locale === 'en') lines.push('English | [中文](ops-api-inventory.zh.md)')
  else lines.push('[English](ops-api-inventory.md) | 中文')
  lines.push('')
  lines.push(`> 本手册由 \`scripts/gen-ops-api-inventory.ts\` 自动生成。**不要手改**——改 api JSDoc 后运行生成器（或 CI 的 \`--check\` 会拦截不一致）。`)
  lines.push('>')
  lines.push('> 逐 op 章节有两个来源：**手写 op** 取 \`api/**/*.ts\` 的 \`@group\` JSDoc 契约；**生成 op** 取 \`api/surface/arg-spec.ts\`（与其派生的 \`script-face-manifest.ts\` 同源），章节里以「自动派生」标出。生成器会断言章节符号集 == \`lang/symbol-table.generated.ts\` 键集，缺章即失败。')
  lines.push('>')
  lines.push('> - ✅ = 此接口正确、可放心使用')
  lines.push('> - ⚠️ = 可用，但参数有已知缺陷')
  lines.push('> - ❌ = 接口错误，**禁止使用**，等重做')
  lines.push('> - 🚫 = **已废弃（deprecated）**，勿在新代码中使用')
  lines.push('>')
  lines.push('> 🚫 标记的 op 是 `../3d_editor` 项目特有的操作，不属于 faijs 平台面；将来会迁往该项目并从 faijs 删除。')
  lines.push('>')
  lines.push('> 相关文档：`docs/language-design.md`（语言与执行契约）、`docs/api-contract.md`（语句层内部契约）。')
  lines.push('')
  lines.push('---')
  lines.push('')
  // ── Three API surfaces overview (P27: ① ② ③ three-face chapter) ──
  lines.push('## 1. 三个 API 面')
  lines.push('')
  lines.push('faijs 的 API 分三个面，消费者和形态各不同：')
  lines.push('')
  lines.push('| 面 | 消费者 | 形态 | 位置 |')
  lines.push('|---|---|---|---|')
  lines.push('| ① TS 兼容面 | 第三方库（TS 代码，如 faijs-gears / sheetmetal） | brepjs 原样：位置参数 + `Result` 原生；同名同签名；`Sketcher` / `Blueprint` / `draw` DSL；`ok` / `err` / `isErr` / `pipe` 组合子 | `@faicad/faijs` 主导出（`packages/core/src/api/brepjs-compat/`） |')
  lines.push('| ② cad 脚本面 | `.fai.js`（UI / AI 生成代码） | `cad.*` 对象参数；语句边界 `Result` unwrap（err → 语句失败）；产物 = faijs `Shape`（mesh 载荷 + BREP 槽） | `cad` 命名空间（经门面 `createRuntime` 注入） |')
  lines.push('| ③ 库边界面 | `registerLib` 注册的第三方库导出函数 | 库作者写纯 brepjs 代码；入口 `Shape` 原样直传，出口 `Solid` → 收养，`Result` 原样传递 | `runtime.registerLib(binding, ns, { autoLift: true })` |')
  lines.push('')
  lines.push('**参数双形态（D11）**：① TS 面与 ② 脚本面是同一批函数，位置 / 对象两种形态都可用。明显可区分的参数用单名（如 `box`），人类看来不明显的用两个名字（如 `rotate_euler`）。')
  lines.push('')
  lines.push('> 下方 § 3–§ 8 的逐 op 手册仅覆盖 ② 脚本面（`cad.*` 函数）。① TS 兼容面的符号清单见 `packages/core/src/api/brepjs-compat/index.ts`；③ 库边界面的使用方法见 `docs/library-dev-guide.md`。')
  lines.push('')
  lines.push('---')
  lines.push('')
  // ── op error system overview (P27: Result-ization) ──
  lines.push('## 2. 错误体系')
  lines.push('')
  lines.push('faijs 对外 API 全面采用 `Result` / `BrepError` 体系（`ok` / `err` / `isOk` / `isErr` / `map` / `andThen` / `unwrap`）。在 ② 脚本面，语句边界自动 unwrap：`err` 转为带语句上下文的执行失败（`ExecutionResult.failedAt`），存量 `.fai.js` 脚本零修改。在 ① TS 兼容面，`Result` 原生传递，库作者用 `isErr` / `map` / `andThen` 组合。')
  lines.push('')
  lines.push('| 面 | Result 处置 | 消费者写法 |')
  lines.push('|---|---|---|')
  lines.push('| ① TS 兼容面 | 原样返回 `Result<T>` | `const r = fuse(a, b); if (isErr(r)) …` |')
  lines.push('| ② cad 脚本面 | 语句边界 unwrap | `let p = cad.union(a, b)` — err → 语句失败 |')
  lines.push('| ③ 库边界面 | 库内原样；边界 unwrap | 库内 `err` → 边界 unwrap → 脚本层语句失败 |')
  lines.push('')
  lines.push('> 相关契约：`docs/api-contract.md` § 7（三个库契约面、库接纳）和 § 8（几何契约）定义了 op 与库函数的分派规则。')
  lines.push('')
  lines.push('---')
  lines.push('')
  // ── 外观方法（Shape 实例方法，非 op；PbrAppearance，plan 2026-10-05 P1）──
  // 外观设置不是 cad.* op（无 mesh/brep 双实现、无引擎分派），作为脚本面 Shape
  // 实例方法单列一节。改动须同步本生成器 + 重跑 gen-ops-api-inventory.ts（禁止手改 md）。
  lines.push('## 2.5 外观方法（Shape 实例方法，非 op）✅')
  lines.push('')
  lines.push('外观（颜色/材质/透明度）设置是 **Shape 实例方法**，不是 `cad.*` op。脚本写法：')
  lines.push('')
  lines.push('```js')
  lines.push('let box1 = cad.box(10, 10, 10)')
  lines.push("box1.setColor('#e53935')                    // hex: #rgb / #rrggbb / #rrggbbaa；或数组 [r,g,b] / [r,g,b,a]（sRGB 0–1）")
  lines.push('box1.setOpacity(0.5)                        // 透明度权威字段 0–1；#rrggbbaa / [r,g,b,a] 的 alpha 等价 opacity')
  lines.push('box1.setMaterial({ metalness: 0.8, roughness: 0.2, transmission: 1, ior: 1.5 })')
  lines.push('let a1 = box1.getAppearance()               // 读当前外观（可能 undefined）')
  lines.push('```')
  lines.push('')
  lines.push('- 方法集：`setAppearance(spec)` / `setColor(color)` / `setMaterial(spec)` / `setOpacity(opacity)` / `getAppearance()`。')
  lines.push('- 语义：原地合并 `{...cur, ...spec}`（`undefined` 字段保留旧值），返回 `this`；**脚本面一次一条 `setX` 语句**（解析器只识别单层成员调用，链式 `a.setColor(...).setMaterial(...)` 脚本面不支持；TS 库面可链式）。')
  lines.push('- 产物数据：`Shape.appearance`（`PbrAppearance`，JSON 可序列化）随 mesh/brep 双链路产物传递；几何 op 产物默认继承第一个携带外观的几何输入；编辑器渲染读 `shape.appearance`。')
  lines.push('- 颜色值内部归一为 sRGB 0–1 数组；CSS 颜色名不支持（P1）。')
  lines.push('- 注：旧 `return { shape, color, metalness, roughness }` 三字段通道已删除（死特性），`ScriptMetaIR.appearance` 不存在；return 对象未知 key 静默忽略。')
  lines.push('')
  lines.push('---')
  lines.push('')
  for (const group of GROUP_ORDER) {
    const ops = grouped.get(group)
    if (!ops) continue
    const num = GROUP_SECTION[group]
    lines.push(`## ${num}. ${group}类操作${GROUP_SUFFIX[group] ?? '（inputs ≥ 1）'}`)
    lines.push('')
    for (let i = 0; i < ops.length; i++) {
      const chapter = ops[i]
      lines.push(`### ${num}.${i + 1} \`${chapter.name}\` ${QUAL_LABEL[chapter.qual]}${chapter.deprecated ? ' 🚫' : ''}`)
      lines.push('')
      lines.push(...chapter.body)
    }
    lines.push('---')
    lines.push('')
  }

    // ── BREP 能力声明节（Phase 4：来自 Phase 0 能力映射表 capability-map.json） ──
  lines.push('## 9. BREP 能力声明（compat op → 内核方法真名）')
  lines.push('')
  lines.push('来自 `packages/core/src/api/surface/capability-map.json`（Phase 0 生成，36 compat op、64 个唯一内核方法）；能力名三层结构、静态前置判定与报错形态见 `docs/api-contract.md` §7.9 / §8.1；引擎侧可执行性由各适配器的 `capabilities.methods` / `evolution` 声明决定（缺能力执行前静态报错，不伪造）。')
  lines.push('')
  lines.push('| compat op | 内核方法真名（kernelMethods） |')
  lines.push('|---|---|')
  for (const e of CAPABILITY_MAP) {
    lines.push(`| ${e.op} | ${e.kernelMethods.join('、')} |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

// 接口品质状态（从各 op 的 @qual 派生，替换手写状态表）
  const bad = CHAPTERS.filter((c) => c.qual === 'error' || c.qual === 'warn')
  if (bad.length > 0) {
    lines.push('## 10. 接口品质状态（自动派生自 @qual）')
    lines.push('')
    lines.push('| op | 品质 | 说明 |')
    lines.push('|---|---|---|')
    for (const chapter of bad) {
      lines.push(`| \`${chapter.name}\` | ${QUAL_LABEL[chapter.qual]} | ${chapter.qualNote ?? ''} |`)
    }
    lines.push('')
    const err = CHAPTERS.filter((c) => c.qual === 'error')
    if (err.length) lines.push('**禁止使用**：' + err.map((c) => `\`${c.name}\``).join('、') + '。')
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // 写给 AI 的速查（自动派生自分组 / 同步性 / 品质）
  lines.push('## 11. 写给 AI 的速查（一句话总结每个可用 op）')
  lines.push('')
  lines.push('```')
  for (const group of GROUP_ORDER) {
    const names = CHAPTERS.filter((c) => c.group === group && c.qual !== 'error' && !c.deprecated)
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b))
    lines.push(`${group}: ${names.join(' / ')}`)
  }
  const errNames = CHAPTERS.filter((c) => c.qual === 'error').map((c) => c.name)
  if (errNames.length) lines.push('禁止: ' + errNames.join('、'))
  const depNames = CHAPTERS.filter((c) => c.deprecated).map((c) => c.name)
  if (depNames.length) lines.push('废弃（勿用，`fai_` 前缀 / ../3d_editor 特有，将迁出）: ' + depNames.join('、'))
  lines.push('```')
  lines.push('')

  // ── Topology identity role vocabulary (plan §4.2, Phase 2.10) ──
  const KIND_LABEL: Record<string, string> = {
    kernel: '内核历史',
    construct: '构造语义',
    identity: '1:1 恒等',
    replicate: '复制 k 份',
    subdivide: '分片',
    unmodeled: '未建模',
  }
  lines.push('---')
  lines.push('')
  lines.push('## 12. 面 role 词汇表（拓扑身份，自动派生自 op 的 naming 声明）')
  lines.push('')
  lines.push('BREP 链上每个面的身份 = `(StmtId, role)`。下表列出每个 op 对**自己新造的面**声明的 role 词汇（`RoleName` 线格式）；继承来的面沿用其产生 op 的 role。`vocab` 中的 `<i>` / `<j>` / `[k]` 为序号占位。**改一个 op 的词汇 = breaking change**（会破坏存量 `.fai.js` 引用），需版本化。')
  lines.push('')
  lines.push('| op | 类别 | 新造面词汇 | 说明 |')
  lines.push('|---|---|---|---|')
  for (const e of collectRoleVocab()) {
    const vocab = e.vocab.length > 0 ? e.vocab.map((v) => `\`${v}\``).join('、') : '—（不造新面）'
    const note = e.kind === 'unmodeled' ? e.reason ?? '' : e.note ?? ''
    lines.push(`| \`${e.op}\` | ${KIND_LABEL[e.kind] ?? e.kind} | ${vocab} | ${note} |`)
  }
  lines.push('')
  lines.push('> 本表由 `DUAL_OP_META.naming` 声明自动生成（与 `.d.ts` 的 `CAD_ROLE_VOCAB` 同源）。漏声明的 op 会在生成期/编译期失败（G4）。')
  lines.push('')
  return lines.join('\n').trimEnd() + '\n'
}

const args = process.argv.slice(2)
const check = args.includes('--check')

const en = renderDoc('en')
const zh = renderDoc('zh')

// The `.i18n.yaml` sidecar records git blob hashes. Compute SHA-1 of file contents.
import { createHash } from 'node:crypto'
function gitBlobHash(content: string): string {
  const buf = Buffer.from(content, 'utf8')
  const header = `blob ${buf.length}\0`
  return createHash('sha1').update(header).update(buf).digest('hex').padStart(40, '0')
}
const yaml = [
  '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
  '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
  `# This file is regenerated by scripts/gen-ops-api-inventory.ts.`,
  `ops-api-inventory.md: ${gitBlobHash(en)}`,
  `ops-api-inventory.zh.md: ${gitBlobHash(zh)}`,
  '',
].join('\n')

if (check) {
  const read = (p: string): string => {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return ''
    }
  }
  let errors: string[] = []
  if (read(EN_TARGET) !== en) errors.push('docs/ops-api-inventory.md is stale')
  if (read(ZH_TARGET) !== zh) errors.push('docs/ops-api-inventory.zh.md is stale')
  if (errors.length) {
    console.error(`gen-ops-api-inventory: ${errors.join('; ')} — run the generator.`)
    process.exit(1)
  }
  console.log('gen-ops-api-inventory: in sync.')
  process.exit(0)
}

writeFileSync(EN_TARGET, en)
writeFileSync(ZH_TARGET, zh)
writeFileSync(join(root, 'docs/ops-api-inventory.i18n.yaml'), yaml)
console.log(`gen-ops-api-inventory: wrote ${EN_TARGET}, ${ZH_TARGET}, i18n.yaml`)
