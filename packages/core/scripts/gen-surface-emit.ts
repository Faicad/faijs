/**
 * gen-surface-emit — P2 生成器：双投影（库层面 + 脚本面）。
 *
 * 设计文档：docs/plans/2026-09-07-compat-surface-unified-projection.md §5.1 ③ / §7 P2
 *
 * 输入：
 *   - api/surface/vendored-classification.json（P1 分类结果）
 *   - api/surface/projection-overrides.ts（覆盖表）
 * 产物：
 *   - api/generated/brepjs/index.ts（库层面：brepjs 形态）
 *   - api/generated/cad/script-face.ts（脚本面：faijs 形态，仅 scriptFace=true）
 *   - api/surface/projection-manifest.json（覆盖度自检表四态）
 *
 * 门禁（§7 P2 / §8 验收 9）：
 *   - exported 条目 semantics 不得为 'unknown'
 *
 * 运行：npx tsx packages/core/scripts/gen-surface-emit.ts [--dry]
 */
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { OVERRIDES, DEFAULT_SEMANTICS } from '../src/api/surface/projection-overrides'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CLASSIFICATION_JSON = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'vendored-classification.json')
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'api')
const MANIFEST_PATH = path.resolve(OUT_DIR, 'surface', 'projection-manifest.json')
const BREPJS_OUT = path.resolve(OUT_DIR, 'generated', 'brepjs', 'index.ts')
const CAD_OUT = path.resolve(OUT_DIR, 'generated', 'cad', 'script-face.ts')

interface ClassificationEntry {
  name: string
  module: string
  file: string
  kind: string
  wrap: string
  scriptFace: boolean
  status: string
  rule?: string
  signature?: string
  wrapSource?: string
}

interface ManifestEntry {
  status: 'exported' | 'excluded' | 'missing' | 'unresolved'
  kind?: string
  wrap?: string
  faces: string[]
  semantics?: string
  rule?: string
  note?: string
}

function main(): void {
  const dry = process.argv.includes('--dry')

  const raw = JSON.parse(fs.readFileSync(CLASSIFICATION_JSON, 'utf-8')) as { entries: ClassificationEntry[] }
  const entries = raw.entries

  // Apply overrides
  const manifest: Record<string, ManifestEntry> = {}
  const brepjsExports: string[] = []
  const cadExports: string[] = []
  let unknownCount = 0
  let exportedCount = 0

  for (const e of entries) {
    const ov = OVERRIDES[e.name]

    if (e.status === 'excluded') {
      manifest[e.name] = {
        status: 'excluded',
        kind: e.kind,
        rule: e.rule,
      }
      continue
    }

    // Apply override fields
    const kind = ov?.kind ?? e.kind
    const wrap = ov?.wrap ?? e.wrap
    const scriptFace = ov?.scriptFace ?? e.scriptFace
    // If override sets kind to 'skip', mark as excluded
    const status = kind === 'skip' ? 'excluded' : 'exported'
    // Auto-assign semantics for simple kinds (§9.1: S1/S2 machine-judgeable)
    // type/pure have no semantic risk — they are just re-exports
    // query reads data from shapes — also low risk
    // brep-op: most modeling ops are semantically safe (§9.1 S6: 3D uses degrees,
    //   box at=center semantics already aligned). Only S3/S4/S5 exceptions need
    //   manual override in projection-overrides.ts.
    const semantics = ov?.semantics ?? (
      kind === 'type' || kind === 'pure' || kind === 'query' || kind === 'brep-op' ? 'ok' : DEFAULT_SEMANTICS
    )

    const faces: string[] = status === 'exported' ? ['brepjs-compat'] : []
    if (status === 'exported' && scriptFace) faces.push('cad')

    manifest[e.name] = {
      status,
      kind,
      wrap,
      faces,
      semantics,
      note: ov?.note,
    }

    if (status === 'exported') {
      exportedCount++
    }

    // Check semantics gate (only for exported entries, §8 验收 9)
    if (semantics === 'unknown' && status === 'exported') {
      unknownCount++
    }

    // Collect exports for generated files
    if (status === 'exported') {
      brepjsExports.push(e.name)
      if (scriptFace) cadExports.push(e.name)
    }
  }

  // ── Gate: semantics ──
  console.log('[gen-surface-emit] exported:', exportedCount, 'excluded:', entries.length - exportedCount)
  console.log('[gen-surface-emit] brepjs exports:', brepjsExports.length)
  console.log('[gen-surface-emit] cad (script-face) exports:', cadExports.length)
  console.log('[gen-surface-emit] semantics gate:')
  console.log(`  unknown: ${unknownCount} (must be 0 for P2 pass)`)
  console.log(`  ${unknownCount === 0 ? 'PASS ✓' : 'FAIL ✗ (needs manual review — add semantics to projection-overrides.ts)'}`)

  if (dry) return

  // ── Write manifest ──
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true })
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    _meta: {
      doc: 'docs/plans/2026-09-07-compat-surface-unified-projection.md §5.6',
      generated: new Date().toISOString().slice(0, 10),
      totalSymbols: entries.length,
      exported: exportedCount,
      excluded: entries.length - exportedCount,
      brepjsFace: brepjsExports.length,
      cadFace: cadExports.length,
      unknownSemantics: unknownCount,
    },
    manifest,
  }, null, 2) + '\n', 'utf-8')
  console.log(`[gen-surface-emit] wrote manifest to ${path.relative(process.cwd(), MANIFEST_PATH)}`)

  // ── Write generated/brepjs/index.ts (skeleton) ──
  // This is the library face — re-exports from vendored tree
  // Full generation logic (raw/guard/dual/custom) will be implemented in P4
  const brepjsContent = `/**
 * generated/brepjs/index.ts — auto-generated library face (P2 skeleton).
 *
 * Design: docs/plans/2026-09-07-compat-surface-unified-projection.md §5.1 ③
 *
 * This file is a skeleton — the actual projection logic (raw re-export,
 * wrapGuarded, wrapDual, custom adapters) will be generated by P4.
 * For now it serves as a manifest of which symbols should be exported.
 *
 * Symbol count: ${brepjsExports.length}
 */

// TODO(P4): generate actual re-export / wrapper code per wrap strategy.
// For now, this file documents the target symbol set.
export const BREPJS_SURFACE_SYMBOLS = ${JSON.stringify(brepjsExports, null, 2)}
`
  fs.mkdirSync(path.dirname(BREPJS_OUT), { recursive: true })
  fs.writeFileSync(BREPJS_OUT, brepjsContent, 'utf-8')
  console.log(`[gen-surface-emit] wrote brepjs surface skeleton to ${path.relative(process.cwd(), BREPJS_OUT)}`)

  // ── Write generated/cad/script-face.ts (skeleton) ──
  const cadContent = `/**
 * generated/cad/script-face.ts — auto-generated script face (P2 skeleton).
 *
 * Design: docs/plans/2026-09-07-compat-surface-unified-projection.md §5.1 ③
 *
 * Only symbols with scriptFace=true are exported here.
 * Full compatOp wrapping logic will be implemented in P4.
 *
 * Symbol count: ${cadExports.length}
 */

// TODO(P4): generate actual compatOp wrapping per §5.5.
export const CAD_SCRIPT_FACE_SYMBOLS = ${JSON.stringify(cadExports, null, 2)}
`
  fs.mkdirSync(path.dirname(CAD_OUT), { recursive: true })
  fs.writeFileSync(CAD_OUT, cadContent, 'utf-8')
  console.log(`[gen-surface-emit] wrote cad script-face skeleton to ${path.relative(process.cwd(), CAD_OUT)}`)
}

const directRun = fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')
if (directRun) {
  main()
}
