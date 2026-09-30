#!/usr/bin/env node
/**
 * pack — build the family in dependency order and pack every package.
 *
 * `npm pack` drops `faicad-<name>-<ver>.tgz` next to each package's
 * package.json. Everything it needs is already in this repository: the version
 * (`config.faijsVersion`, written by `set-version.mjs`) and the build order.
 *
 * Why it is a script instead of two npm commands:
 *   1. `npm pack` must run with cwd = the package directory. Run from the
 *      workspace root, npm parses the path argument as a package *spec* and
 *      hits GitHub shorthand resolution.
 *   2. The build order is the workspace order (asserted by
 *      check-workspaces-order.mjs), not alphabetical. Building out of order
 *      leaves a package resolving its siblings from stale `dist/`.
 *
 * Usage:
 *   node scripts/pack.mjs [options]
 *
 * Options:
 *   --only <a,b>       Limit to these family package names.
 *   --no-build         Skip the build step (pack what is already in `dist/`).
 *   --dry-run          Print the plan; `npm pack --dry-run` writes nothing.
 *   --strict-lockstep  Abort when the family lockstep guard fails (default: warn).
 *   --help
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { familyVersion, readFamily, readRootPackage, repoRoot } from './lockstep-lib.mjs'

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const posix = (p) => p.replace(/\\/g, '/')
const info = (m) => process.stdout.write(`   ${m}\n`)
const step = (n, total, title) => process.stdout.write(`\n[${n}/${total}] ${title}\n`)
const fmtMs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

const notes = []
function warn(m) {
  notes.push(m)
  process.stdout.write(`   ! ${m}\n`)
}

function run(cmd, args, { cwd = repoRoot, quiet = false } = {}) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    // Windows: Node >=18.20 refuses to spawn a `.cmd` shim without a shell
    // (spawnSync EINVAL), so npm.cmd must go through cmd.exe.
    shell: process.platform === 'win32',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  })
}

function parseArgs(argv) {
  const o = { only: null, build: true, dryRun: false, strictLockstep: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const eq = a.indexOf('=')
      if (eq !== -1) return a.slice(eq + 1)
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} requires a value`)
      return v
    }
    if (a === '--help' || a === '-h') o.help = true
    else if (a.startsWith('--only')) o.only = value().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--no-build') o.build = false
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--strict-lockstep') o.strictLockstep = true
    else throw new Error(`unknown option: ${a} (try --help)`)
  }
  return o
}

function helpText() {
  const src = readFileSync(new URL(import.meta.url), 'utf8')
  return src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ ?\* ?/gm, '').replace(/^\n+/, '').trimEnd()
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) return void process.stdout.write(`${helpText()}\n`)

  const t0 = Date.now()
  const rootPkg = readRootPackage()
  const version = familyVersion(rootPkg)
  if (!version) throw new Error('root config.faijsVersion is missing — run `node scripts/set-version.mjs <version>`')

  const family = readFamily()
  // The workspaces array order IS the dependency topology (asserted by
  // check-workspaces-order.mjs).
  const ordered = rootPkg.workspaces
    .map((ws) => ws.split('/').pop())
    .map((dir) => [...family.values()].find((p) => p.dir === dir))
    .filter(Boolean)
    .filter((p) => !opts.only || opts.only.includes(p.name))

  process.stdout.write(`pack — faijs family @ ${version}\n`)
  info(`repo       ${posix(repoRoot)}`)
  info(`packages   ${ordered.length}${opts.only ? ' (--only)' : ` of ${family.size}`}`)
  if (opts.dryRun) info('mode       DRY RUN — nothing will be written')

  // ------------------------------------------------------------- [1] lockstep
  step(1, 3, 'family lockstep')
  try {
    run('node', [join(repoRoot, 'scripts', 'check-lockstep.mjs')], { quiet: true })
    info('OK')
  } catch (e) {
    const detail = String(e.stderr ?? e.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' / ')
    const msg = `lockstep guard failed${detail ? `: ${detail}` : ''} — a stale @faicad/* range breaks CDN builds`
    if (opts.strictLockstep) throw new Error(msg)
    warn(`${msg}; continuing (--strict-lockstep makes this fatal)`)
  }
  const drifted = ordered.filter((p) => p.version !== version)
  if (drifted.length) {
    throw new Error(
      `version drift: ${drifted.map((p) => `${p.name}@${p.version}`).join(', ')} — run \`node scripts/set-version.mjs ${version}\``,
    )
  }

  // ---------------------------------------------------------------- [2] build
  const built = []
  if (opts.build) {
    step(2, 3, 'build (topological order)')
    for (const p of ordered) {
      if (!p.pj.scripts?.build) {
        info(`- ${p.name}: no build script`)
        continue
      }
      const s = Date.now()
      run(NPM, ['run', 'build', '-w', p.name], { quiet: true })
      built.push(`${p.name} ${fmtMs(Date.now() - s)}`)
      info(`+ ${p.name} (${fmtMs(Date.now() - s)})`)
    }
  } else {
    step(2, 3, 'build — skipped')
  }

  // ----------------------------------------------------------------- [3] pack
  step(3, 3, 'pack (cwd = package dir)')
  const tarballs = []
  for (const p of ordered) {
    const dir = join(repoRoot, 'packages', p.dir)
    const s = Date.now()
    const args = ['pack', '--json', ...(opts.dryRun ? ['--dry-run'] : []), '.']
    const parsed = JSON.parse(run(NPM, args, { cwd: dir, quiet: true }))[0]
    const tgz = join(dir, parsed.filename)
    // `npm pack --dry-run` reports the filename without writing it.
    const onDisk = existsSync(tgz)
    const size = onDisk ? statSync(tgz).size : 0
    tarballs.push({ name: p.name, tgz, size, onDisk })
    info(
      onDisk
        ? `+ ${parsed.filename} (${fmtBytes(size)}, ${fmtMs(Date.now() - s)})`
        : `~ ${parsed.filename} (dry run — not written)`,
    )
    if (p.pj.bin) notes.push(`${p.name} declares bin — a tarball install does not create .bin shims`)
  }

  // ------------------------------------------------------------------ report
  process.stdout.write('\n────────────────────────────────────────────\n')
  if (built.length) info(`build      ${built.join(' | ')}`)
  const packed = tarballs.filter((t) => t.onDisk)
  for (const t of packed) {
    info(`${posix(relative(repoRoot, t.tgz))}  ${fmtBytes(t.size)}`)
  }
  process.stdout.write(`OK — family @ ${version}: ${packed.length}/${tarballs.length} tarball(s)\n`)
  if (notes.length) {
    process.stdout.write(`warnings (${notes.length})\n`)
    for (const n of [...new Set(notes)]) process.stdout.write(`  ! ${n}\n`)
  }
  info(`total ${fmtMs(Date.now() - t0)}`)
}

main()
