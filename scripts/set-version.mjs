/**
 * set-version — the write half of the faijs package-family lockstep rule.
 *
 * Aligns the whole family onto one version in a single command:
 *   1. root `package.json` → `config.faijsVersion` (the single source of truth);
 *   2. every family member's `version` field;
 *   3. every registry-range `@faicad/*` dependency / peerDependency / devDependency
 *      → `^<major>.<minor>.0` of that version (`file:` / `workspace:` / `link:`
 *      entries are local resolutions and are left alone);
 *   4. `npm install --package-lock-only` so the lockfile's workspace entries match
 *      (skippable with `--no-lock` for an offline edit-only run);
 *   5. `gen-importmap.mjs` so the CDN release pin mirror `cdn/versions.json` — a
 *      second home for the same fact — cannot be left behind.
 *
 * A major/minor bump must rewrite the ranges; a patch bump may leave them valid
 * (`^0.20.0` admits `0.20.x`), and this script reports those as unchanged rather
 * than pretending to touch them.
 *
 * Usage:
 *   node scripts/set-version.mjs 0.21.0              # write + refresh lock + CDN pins
 *   node scripts/set-version.mjs 0.21.0 --dry-run    # print the plan, write nothing
 *   node scripts/set-version.mjs 0.21.0 --no-lock    # skip the lockfile refresh
 *   node scripts/set-version.mjs 0.21.0 --include-private
 *                                                        # also align fixtures/tests/demo
 *
 * Exit code: 0 = written (or dry-run planned); 1 = bad usage.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEP_SECTIONS,
  expectedRange,
  familyVersion,
  isLocalRange,
  readFamily,
  readRootPackage,
  repoRoot,
} from './lockstep-lib.mjs'

const argv = process.argv.slice(2)
const target = argv.find((a) => !a.startsWith('--'))
const dryRun = argv.includes('--dry-run')
const withLock = !argv.includes('--no-lock')
const includePrivate = argv.includes('--include-private')

if (!target || !/^\d+\.\d+\.\d+$/.test(target)) {
  console.error('[set-version] usage: node scripts/set-version.mjs <MAJOR.MINOR.PATCH> [--dry-run] [--no-lock] [--include-private]')
  process.exit(1)
}

const range = expectedRange(target)
const family = readFamily({ includePrivate })
if (family.size === 0) {
  console.error('[set-version] no @faicad/* packages found under packages/')
  process.exit(1)
}

/** Rewrite a package.json on disk with 2-space indent + trailing newline (npm style). */
function writePkg(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n')
}

// ── 1. root single source of truth ────────────────────────────────────────────
const rootPkgPath = join(repoRoot, 'package.json')
const rootPkg = readRootPackage()
const prevDeclared = familyVersion(rootPkg)
const rootChanged = prevDeclared !== target
if (rootChanged) {
  rootPkg.config = { ...(rootPkg.config ?? {}), faijsVersion: target }
  if (!dryRun) writePkg(rootPkgPath, rootPkg)
}

// ── 2 + 3. family versions and @faicad/* ranges ───────────────────────────────
const changes = []
for (const [, info] of family) {
  const pjPath = join(repoRoot, 'packages', info.dir, 'package.json')
  let dirty = false

  if (info.version !== target) {
    changes.push({ pkg: info.name, field: 'version', from: info.version || '(none)', to: target })
    info.pj.version = target
    dirty = true
  }

  for (const section of DEP_SECTIONS) {
    const deps = info.pj[section]
    if (!deps) continue
    for (const dep of Object.keys(deps)) {
      if (!dep.startsWith('@faicad/')) continue
      if (isLocalRange(deps[dep])) continue
      if (!family.has(dep)) continue // not a family member
      if (deps[dep] === range) continue
      changes.push({ pkg: info.name, field: `${section}.${dep}`, from: deps[dep], to: range })
      deps[dep] = range
      dirty = true
    }
  }

  if (dirty && !dryRun) writePkg(pjPath, info.pj)
}

if (rootChanged) {
  changes.push({ pkg: '(root)', field: 'config.faijsVersion', from: prevDeclared ?? '(none)', to: target })
}

if (changes.length === 0) {
  console.log(`[set-version] already aligned: ${family.size} package(s) at ${target}, all @faicad/* ranges ${range}`)
} else {
  const w = Math.max(...changes.map((c) => c.pkg.length))
  for (const c of changes) {
    console.log(`  ${c.pkg.padEnd(w)}  ${c.field.padEnd(34)} ${c.from} -> ${c.to}`)
  }
  console.log(`[set-version] ${dryRun ? 'would change' : 'changed'} ${changes.length} field(s) across ${family.size} package(s) -> ${target}`)
}

if (dryRun) process.exit(0)

// ── 5. CDN release pin mirror ─────────────────────────────────────────────────
// `cdn/versions.json` is a generated artifact (`gen-importmap.mjs`) that pins every
// family member for the plan-b exact-pin browser loader — a second home for the same
// version fact. Regenerating it here (a pure local scan, deterministic output) means
// a bump cannot leave the mirror behind, and re-running the same version repairs a
// mirror that drifted for any other reason.
execFileSync(process.execPath, [join(repoRoot, 'scripts', 'gen-importmap.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
})

// ── 4. lockfile refresh ───────────────────────────────────────────────────────
if (withLock) {
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  console.log('[set-version] refreshed package-lock.json')
} else {
  console.log('[set-version] skipped the lockfile refresh (--no-lock); run `npm install --package-lock-only` before committing')
}
