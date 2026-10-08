/**
 * gen-engine-skill-docs.ts
 *
 * Generate the per-engine AI skill docs:
 *   skills/all_occt.md     = common (engine-neutral) cad.* ops + OCCT-only ops
 *   skills/all_brepkit.md   = common (engine-neutral) cad.* ops + brepkit-only ops
 *
 * Why this exists: `skills/all.md` was hand-assembled and drifts from the op set.
 * On every faijs release the doc must be regenerated from the *authoritative* op
 * metadata so the third-party AI (ai_gateway) never sees an op that the deployed
 * BREP engine cannot run.
 *
 * Authoritative engine classification of each script-face `cad.*` op is built at
 * runtime (no hand-maintained lists):
 *   1. Every wrapped op carries `DUAL_OP_META.engines` (defineOp / compatOp). We
 *      assemble the real `cad` namespace via `createApiNamespace()` and read it.
 *      Missing `engines` = neutral op (runs on every engine -> "common").
 *   2. Plain-function platform ops (return bool / string / data, NOT wrapped by
 *      defineOp) gate themselves with `assertEngineFor(name, ['occt'])`. We scan
 *      the api/ sources for those literal call sites (including the one
 *      helper-gated family, `shapePredicate('isEdge', ...)`).
 *   3. Generated/query ops carry `engines` in the generated script-face manifest.
 *
 * An op is:
 *   - common      : no engine whitelist, OR whitelisted for both engines
 *   - occt-only   : whitelist includes 'occt' but not 'brepkit'
 *   - brepkit-only: whitelist includes 'brepkit' but not 'occt'
 *
 * Usage:
 *   npx tsx scripts/gen-engine-skill-docs.ts            # write both docs
 *   npx tsx scripts/gen-engine-skill-docs.ts --check    # fail if stale (CI gate)
 *   npx tsx scripts/gen-engine-skill-docs.ts --print    # print the bucket report
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApiNamespace } from '../packages/core/src/api/api-namespace'
import { dualOpMetaOf } from '../packages/core/src/define-op'
import { SCRIPT_FACE_OPS } from '../packages/core/src/api/generated/script-face-manifest'

const root = resolve(import.meta.dirname, '..')
const skillsDir = join(root, 'skills')
const apiSrcDir = join(root, 'packages/core/src/api')

// ── 1. Build authoritative engine map ──────────────────────────────────────

/** Recursively collect every api/**\/*.ts source file. */
function walkApiFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) walkApiFiles(p, out)
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

/**
 * Plain-function occt-only names found by scanning api sources.
 *
 * Direct gate:        assertEngineFor('exportBrep', ['occt'])
 * Helper-gated family: shapePredicate('isEdge', shape)  (the helper itself asserts ['occt'])
 *
 * Both are the established convention (see api/shape-type/index.ts header): a
 * plain function cannot go through dispatchPath, so it asserts engine identity in
 * its body before touching the kernel. Any new plain occt-only op MUST call
 * assertEngineFor, or it would wrongly run on brepkit — so scanning here keeps
 * this table in sync for free.
 */
function scanPlainOcctNames(): Set<string> {
  const names = new Set<string>()
  for (const file of walkApiFiles(apiSrcDir)) {
    const text = readFileSync(file, 'utf8')
    // Direct assertEngineFor('<name>', ['occt']...)
    for (const m of text.matchAll(/assertEngineFor\(\s*['"](\w+)['"]/g)) names.add(m[1])
    // Helper-gated family (shapePredicate / any '<helper>('<name>' first-arg gate).
    // Currently only shape-type's shapePredicate; match a first-string-arg to a
    // local assertEngineFor-wrapping helper. We deliberately keep this explicit:
    // shapePredicate is the only such helper in the codebase today.
    for (const m of text.matchAll(/shapePredicate\(\s*['"](\w+)['"]/g)) names.add(m[1])
  }
  return names
}

type Bucket = 'common' | 'occt-only' | 'brepkit-only'

/** op name -> bucket, derived from runtime metadata + source scan. */
function buildEngineBuckets(): Map<string, Bucket> {
  const ns = createApiNamespace()
  const plainOcct = scanPlainOcctNames()

  // Manifest engines (generated/query ops) keyed by op name.
  const manifestEngines = new Map<string, readonly string[]>()
  for (const op of SCRIPT_FACE_OPS) {
    if (op.engines?.length) manifestEngines.set(op.name, op.engines)
  }

  const buckets = new Map<string, Bucket>()
  for (const [name, value] of Object.entries(ns)) {
    if (name === 'contractVersion' || typeof value !== 'function') continue

    // The assembled cad.* namespace is authoritative. A wrapped op's engines come
    // ONLY from its runtime DUAL_OP_META — never let the manifest override it: the
    // generated projection may be tagged engines:['occt'] while a hand-written
    // override (spread last in api-namespace.ts) deliberately downgraded the op to
    // neutral capability routing (e.g. linearPattern/circularPattern after the
    // 2026-09-26 C-batch downgrade). For plain functions (no DUAL_OP_META), fall
    // back to the generated manifest tag, then the source assertEngineFor scan.
    let engines: readonly string[] | undefined
    const meta = dualOpMetaOf(value)
    if (meta?.engines?.length) {
      engines = meta.engines
    } else if (!meta) {
      engines = manifestEngines.get(name) ?? (plainOcct.has(name) ? ['occt'] : undefined)
    }

    const hasOcct = !!engines?.includes('occt')
    const hasBrepkit = !!engines?.includes('brepkit')
    if (hasOcct && hasBrepkit) buckets.set(name, 'common')
    else if (hasOcct) buckets.set(name, 'occt-only')
    else if (hasBrepkit) buckets.set(name, 'brepkit-only')
    else buckets.set(name, 'common')
  }
  return buckets
}

// ── 2. Assemble the doc skeleton (overview header + non-core embeds) ───────

/** Strip a skill file's H1 title + leading blockquote, body from first ## onward. */
function embedFile(filename: string): string {
  const lines = readFileSync(join(skillsDir, filename), 'utf-8').split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i < lines.length && lines[i].startsWith('# ')) i++
  while (i < lines.length && lines[i].trim() === '') i++
  while (i < lines.length && lines[i].startsWith('>')) i++
  while (i < lines.length && lines[i].trim() === '') i++
  return lines.slice(i).join('\n').trimEnd()
}

/** Keep only the overview sections of SKILL.md (drop Available Libraries / Quick Reference). */
function processSkillMd(content: string, target: 'occt' | 'brepkit'): string {
  const lines = content.split('\n')
  const kept: string[] = []
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i < lines.length && lines[i].startsWith('# ')) {
    kept.push(lines[i].replace('# faijs', `# faijs (${target === 'occt' ? 'OCCT engine' : 'brepkit engine'} skill)`))
    i++
  }
  while (i < lines.length) {
    if (lines[i].startsWith('## ')) {
      const heading = lines[i].slice(3).trim()
      if (heading === 'Available Libraries' || heading === 'Quick Reference: Platform `cad.*` Ops') {
        i++
        while (i < lines.length && !lines[i].startsWith('## ')) i++
        continue
      }
    }
    kept.push(lines[i])
    i++
  }
  let result = kept.join('\n')
  for (const file of ['core.md', 'faijs-extra.md', 'sketch.md', 'sheetmetal.md', 'faijs-gears.md', 'faijs-fasteners.md', 'draw.md', 'faijs-cadquery.md']) {
    result = result.replaceAll(new RegExp(`\\[([^\\]]+)\\]\\(${file.replace('.', '\\.')}\\)`, 'g'), '$1')
  }
  return result.trimEnd()
}

// ── 3. Filter core.md per engine ────────────────────────────────────────────

/** Extract the op name from a `### \`box(width, ...)\`` heading, or null. */
function opNameFromHeading(heading: string): string | null {
  const bt = /`([^`]+)`/.exec(heading)
  const token = (bt ? bt[1] : heading.replace(/^###\s*/, '')).trim()
  const m = /^([A-Za-z_$][\w$]*)/.exec(token)
  return m ? m[1] : null
}

/**
 * Filter the core.md body (already stripped to start at first `##`) so that only
 * op sections available on `target` remain. A `##` group is kept only when at
 * least one of its `###` op sections survives; non-op prose is kept as-is.
 */
function filterCore(body: string, target: 'occt' | 'brepkit', buckets: Map<string, Bucket>): string {
  const lines = body.split('\n')
  const out: string[] = []
  let i = 0
  // Preamble before the first ## (should be empty after strip) — keep verbatim.
  while (i < lines.length && !lines[i].startsWith('## ')) out.push(lines[i]), i++

  while (i < lines.length) {
    if (!lines[i].startsWith('## ')) { i++; continue }
    const groupHeader = lines[i]
    i++
    // Collect this group's lines until next ##.
    const groupLines: string[] = []
    while (i < lines.length && !lines[i].startsWith('## ')) { groupLines.push(lines[i]); i++ }

    // Split group into op chunks at ### headings.
    const chunks: string[][] = []
    let cur: string[] = []
    let inOp = false
    for (const gl of groupLines) {
      if (gl.startsWith('### ')) {
        if (inOp || cur.length) chunks.push(cur)
        cur = [gl]
        inOp = true
      } else {
        cur.push(gl)
      }
    }
    if (cur.length) chunks.push(cur)

    // First chunk (before any ###) is group prose — always keep.
    const prose = chunks.length && !chunks[0][0].startsWith('### ') ? chunks[0] : null
    const opChunks = chunks.length && chunks[0][0].startsWith('### ') ? chunks : prose ? chunks.slice(1) : chunks

    const keptOps: string[][] = []
    for (const chunk of opChunks) {
      const name = opNameFromHeading(chunk[0])
      if (!name) { keptOps.push(chunk); continue } // non-op subsection: keep
      const bucket = buckets.get(name)
      const keep = bucket === 'common' || (target === 'occt' && bucket === 'occt-only') || (target === 'brepkit' && bucket === 'brepkit-only')
      if (keep) keptOps.push(chunk)
    }

    if (keptOps.length > 0 || prose) {
      out.push(groupHeader)
      if (prose) out.push(prose.join('\n'))
      for (const chunk of keptOps) out.push(chunk.join('\n'))
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

// ── 4. Render ──────────────────────────────────────────────────────────────

const NON_CORE_EMBEDS = ['faijs-extra.md', 'sketch.md', 'sheetmetal.md', 'faijs-gears.md', 'faijs-fasteners.md']

function render(target: 'occt' | 'brepkit', buckets: Map<string, Bucket>): string {
  const skillMd = readFileSync(join(skillsDir, 'SKILL.md'), 'utf-8')
  const header = processSkillMd(skillMd, target)

  const coreBody = embedFile('core.md')
  const filteredCore = filterCore(coreBody, target, buckets)

  const occtOnly = [...buckets].filter(([, b]) => b === 'occt-only').map(([n]) => n).sort()
  const brepkitOnly = [...buckets].filter(([, b]) => b === 'brepkit-only').map(([n]) => n).sort()
  const commonCount = [...buckets.values()].filter((b) => b === 'common').length

  const banner = [
    `> **Engine-specific skill doc — auto-generated** by \`scripts/gen-engine-skill-docs.ts\` (do not edit by hand; regenerate on every faijs release via \`npm run gen:engine-skill-docs\`).`,
    '>',
    `> This doc lists the \`cad.*\` ops available when the runtime BREP engine is **${target}**.`,
    `> It contains the **${commonCount} engine-neutral (common) ops**${target === 'occt'
      ? ` plus the **${occtOnly.length} OCCT-only ops**.`
      : ` plus the **${brepkitOnly.length} brepkit-only ops** (currently none).`}`,
    `> OCCT-only ops (${occtOnly.length}: ${occtOnly.join(', ')}) are **excluded** from the brepkit doc;`,
    `> brepkit-only ops (${brepkitOnly.length}: ${brepkitOnly.join(', ') || 'none'}) are excluded from the OCCT doc.`,
    '',
  ].join('\n')

  const parts = [header, banner, filteredCore]
  for (const f of NON_CORE_EMBEDS) parts.push(embedFile(f))
  return parts.join('\n\n---\n\n') + '\n'
}

// ── main ────────────────────────────────────────────────────────────────────

const buckets = buildEngineBuckets()

const occtDoc = render('occt', buckets)
const brepkitDoc = render('brepkit', buckets)

const args = process.argv.slice(2)

if (args.includes('--print')) {
  const groups = { 'common': [], 'occt-only': [], 'brepkit-only': [] }
  for (const [n, b] of buckets) groups[b].push(n)
  for (const k of Object.keys(groups)) groups[k].sort()
  console.log(`total ops: ${buckets.size}`)
  for (const k of Object.keys(groups)) console.log(`\n=== ${k} [${groups[k].length}] ===\n${groups[k].join(', ')}`)
}

const occtPath = join(skillsDir, 'all_occt.md')
const brepkitPath = join(skillsDir, 'all_brepkit.md')

/** 出口统一剥行尾空白：内联代码拆行等模板变换会遗留尾随空格，过不了 pre-commit 的 whitespace 门禁。 */
const stripTrailingWs = (s: string): string => s.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')

if (args.includes('--check')) {
  const read = (p: string): string => { try { return readFileSync(p, 'utf8') } catch { return '' } }
  const errs: string[] = []
  if (read(occtPath) !== stripTrailingWs(occtDoc)) errs.push('skills/all_occt.md is stale')
  if (read(brepkitPath) !== stripTrailingWs(brepkitDoc)) errs.push('skills/all_brepkit.md is stale')
  if (errs.length) {
    console.error(`gen-engine-skill-docs: ${errs.join('; ')} — run the generator.`)
    process.exit(1)
  }
  console.log('gen-engine-skill-docs: in sync.')
  process.exit(0)
}

writeFileSync(occtPath, stripTrailingWs(occtDoc))
writeFileSync(brepkitPath, stripTrailingWs(brepkitDoc))
console.log(`gen-engine-skill-docs: wrote skills/all_occt.md (${occtDoc.length} chars), skills/all_brepkit.md (${brepkitDoc.length} chars)`)
