/**
 * Generate docs/ops-api-inventory.md (+ .zh.md + .i18n.yaml) from the L3
 * API-surface exported-op JSDoc. The api layer (core/src/api, 原 stdlib) is the
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

const root = resolve(import.meta.dirname, '..')
const API_SRC = join(root, 'packages/core/src/api')
const EN_TARGET = join(root, 'docs/ops-api-inventory.md')
const ZH_TARGET = join(root, 'docs/ops-api-inventory.zh.md')

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
}

const QUAL_LABEL: Record<Op['qual'], string> = {
  ok: '✅',
  warn: '⚠️',
  error: '❌',
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

const GROUP_ORDER = ['创建', '变换', '特征', '结构', '查询']

function renderDoc(locale: 'en' | 'zh'): string {
  const files = readdirSync(API_SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
  const allOps: Op[] = []
  for (const f of files) allOps.push(...collectOps(join(API_SRC, f)))
  const grouped = new Map<string, Op[]>()
  for (const op of allOps) {
    if (!grouped.has(op.group)) grouped.set(op.group, [])
    grouped.get(op.group)!.push(op)
  }
  for (const list of grouped.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  const lines: string[] = []
  lines.push(`# faijs Language API Reference (AI / User Coding Manual)`)
  lines.push('')
  if (locale === 'en') lines.push('English | [中文](ops-api-inventory.zh.md)')
  else lines.push('[English](ops-api-inventory.md) | 中文')
  lines.push('')
  lines.push(`> 本手册由 \`scripts/gen-ops-api-inventory.ts\` 从 stdlib JSDoc 自动生成。**不要手改**——改 stdlib JSDoc 后运行生成器（或 CI 的 \`--check\` 会拦截不一致）。`)
  lines.push('>')
  lines.push('> - ✅ = 此接口正确、可放心使用')
  lines.push('> - ⚠️ = 可用，但参数有已知缺陷')
  lines.push('> - ❌ = 接口错误，**禁止使用**，等重做')
  lines.push('>')
  lines.push('> 相关文档：`docs/syntax-design.md`（语法与执行契约）、`docs/api-contract.md`（语句层内部契约）。')
  lines.push('')
  lines.push('---')
  lines.push('')
  const section = new Map<string, number>([
    ['创建', 3],
    ['变换', 4],
    ['特征', 5],
    ['结构', 6],
    ['查询', 7],
  ])
  const sectionSuffix: Record<string, string> = {
    创建: '（无上游输入）',
    结构: '（结构语句，无几何输出）',
    查询: '（几何 / 资产引用查询）',
  }
  for (const group of GROUP_ORDER) {
    const ops = grouped.get(group)
    if (!ops) continue
    const num = section.get(group)
    lines.push(`## ${num}. ${group}类操作${sectionSuffix[group] ?? '（inputs ≥ 1）'}`)
    lines.push('')
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      lines.push(`### ${num}.${i + 1} \`${op.name}\` ${QUAL_LABEL[op.qual]}`)
      lines.push('')
      if (op.desc) {
        lines.push(op.desc)
        lines.push('')
      }
      for (const ex of op.example) {
        lines.push('```js')
        for (const exLine of ex.split('\n')) lines.push(exLine)
        lines.push('```')
        lines.push('')
      }
      lines.push('| 参数 | 类型 | 必填 | 默认 | 说明 |')
      lines.push('|---|---|---|---|---|')
      for (const p of op.params) {
        lines.push(`| \`${p.name}\` | \`${p.type}\` | ${p.required ? '✅' : ''} | ${p.default ?? '—'} | ${p.desc} |`)
      }
      lines.push('')
      lines.push(`**${op.async ? '异步' : '同步'}**。${op.returns ?? ''}`)
      lines.push('')
      if (op.note && op.note.length) {
        lines.push(op.note.map((n) => `> ${n}`).join('\n>\n'))
        lines.push('')
      }
    }
    lines.push('---')
    lines.push('')
  }

  // 接口品质状态（从各 op 的 @qual 派生，替换手写状态表）
  const bad = allOps.filter((op) => op.qual === 'error' || op.qual === 'warn')
  if (bad.length > 0) {
    lines.push('## 8. 接口品质状态（自动派生自 @qual）')
    lines.push('')
    lines.push('| op | 品质 | 说明 |')
    lines.push('|---|---|---|')
    for (const op of bad) {
      lines.push(`| \`${op.name}\` | ${QUAL_LABEL[op.qual]} | ${op.note?.[0] ?? op.desc} |`)
    }
    lines.push('')
    const err = allOps.filter((op) => op.qual === 'error')
    if (err.length) lines.push('**禁止使用**：' + err.map((op) => `\`${op.name}\``).join('、') + '。')
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // 写给 AI 的速查（自动派生自分组 / 同步性 / 品质）
  lines.push('## 9. 写给 AI 的速查（一句话总结每个可用 op）')
  lines.push('')
  lines.push('```')
  lines.push('创建: ' + allOps.filter((o) => o.group === '创建' && o.qual !== 'error').map((o) => o.name).join(' / '))
  lines.push('变换: ' + allOps.filter((o) => o.group === '变换' && o.qual !== 'error').map((o) => o.name).join(' / '))
  lines.push('特征: ' + allOps.filter((o) => o.group === '特征' && o.qual !== 'error').map((o) => o.name).join(' / '))
  lines.push('结构: ' + allOps.filter((o) => o.group === '结构' && o.qual !== 'error').map((o) => o.name).join(' / '))
  lines.push('查询: ' + allOps.filter((o) => o.group === '查询' && o.qual !== 'error').map((o) => o.name).join(' / '))
  const errNames = allOps.filter((o) => o.qual === 'error').map((o) => o.name)
  if (errNames.length) lines.push('禁止: ' + errNames.join('、'))
  lines.push('```')
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
