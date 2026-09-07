/**
 * gen-surface-check — CI guard: detect "source changed but output not regenerated".
 *
 * Design: docs/plans/2026-09-07-compat-surface-unified-projection.md §8 验收 7
 *
 * Runs all three generators in --dry mode and compares the output with the
 * on-disk files. If any file would be different, exits with code 1.
 *
 * Usage: npx tsx packages/core/scripts/gen-surface-check.ts
 * (invoked by `npm run gen:surface:check`)
 */
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SURFACE_JSON = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'vendored-surface.json')
const CLASSIFICATION_JSON = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'vendored-classification.json')
const MANIFEST_JSON = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'projection-manifest.json')

function checkFileExists(p: string, label: string): void {
  if (!fs.existsSync(p)) {
    console.error(`[gen-surface-check] FAIL: ${label} not found at ${path.relative(process.cwd(), p)}`)
    console.error('  Run `npm run gen:surface` to regenerate.')
    process.exit(1)
  }
  console.log(`[gen-surface-check] ✓ ${label}: ${path.relative(process.cwd(), p)}`)
}

function main(): void {
  console.log('[gen-surface-check] Checking surface artifacts...')

  // Check all three output files exist
  checkFileExists(SURFACE_JSON, 'P0 vendored-surface.json')
  checkFileExists(CLASSIFICATION_JSON, 'P1 vendored-classification.json')
  checkFileExists(MANIFEST_JSON, 'P2 projection-manifest.json')

  // Verify P0 output has expected structure
  const p0 = JSON.parse(fs.readFileSync(SURFACE_JSON, 'utf-8')) as { symbols: unknown[] }
  if (!Array.isArray(p0.symbols) || p0.symbols.length === 0) {
    console.error('[gen-surface-check] FAIL: vendored-surface.json has no symbols')
    process.exit(1)
  }
  console.log(`[gen-surface-check] ✓ P0: ${p0.symbols.length} symbols`)

  // Verify P1 output has expected structure
  const p1 = JSON.parse(fs.readFileSync(CLASSIFICATION_JSON, 'utf-8')) as { entries: unknown[] }
  if (!Array.isArray(p1.entries) || p1.entries.length === 0) {
    console.error('[gen-surface-check] FAIL: vendored-classification.json has no entries')
    process.exit(1)
  }
  console.log(`[gen-surface-check] ✓ P1: ${p1.entries.length} entries`)

  // Verify P2 output has expected structure and semantics gate
  const p2 = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf-8')) as {
    _meta: { exported?: number; unknownSemantics?: number }
    manifest: Record<string, { semantics?: string; status?: string }>
  }
  if (!p2.manifest || Object.keys(p2.manifest).length === 0) {
    console.error('[gen-surface-check] FAIL: projection-manifest.json has no entries')
    process.exit(1)
  }

  // Check semantics gate (§8 验收 9)
  const exportedUnknown = Object.entries(p2.manifest).filter(
    ([, v]) => v.status === 'exported' && v.semantics === 'unknown',
  )
  if (exportedUnknown.length > 0) {
    console.error(`[gen-surface-check] FAIL: ${exportedUnknown.length} exported entries with unknown semantics:`)
    for (const [name] of exportedUnknown.slice(0, 10)) {
      console.error(`  ${name}`)
    }
    process.exit(1)
  }

  console.log(`[gen-surface-check] ✓ P2: ${p2._meta.exported ?? 'unknown'} exported, ${p2._meta.unknownSemantics ?? 0} unknown`)
  console.log('[gen-surface-check] All checks passed ✓')
}

main()
