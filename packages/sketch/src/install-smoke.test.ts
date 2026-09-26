/**
 * install-smoke — publish-state npm install smoke test (§8 of the sketch plan).
 *
 * Packs @faicad/faijs and @faicad/faijs-sketch into tarballs, installs them
 * into an isolated temp directory, and runs the consumer script that exercises
 * the full solve pipeline. This catches publish-state traps that src-level
 * tests miss: missing exports subpaths, missing dist files, ghost-deps that
 * only surface outside the monorepo, un-fixed import extensions, and wasm
 * resolution from an installed location.
 *
 * Run via `npm run test:install -w @faicad/faijs-sketch` (not in the default
 * suite — it packs and installs, so it is slow).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'

import { existsSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const repoRoot = join(pkgDir, '..', '..')
const coreDir = join(repoRoot, 'packages', 'core')
const consumerScript = join(pkgDir, 'smoke', 'install-smoke-consumer.mjs')

/** Windows: execFile can't resolve bare `npm` — route through the shell. */
const SHELL: { shell?: boolean } = process.platform === 'win32' ? { shell: true } : {}

const KEEP = process.env.FAIJS_SMOKE_KEEP === '1'
let tmpDir: string
let coreTgz: string
let sketchTgz: string

beforeAll(async () => {
  // 1. pre-assert: dist/ must exist (CI runs build before tests)
  if (!existsSync(join(pkgDir, 'dist', 'index.js'))) {
    throw new Error('E_SMOKE_NO_DIST: run `npm run build -w @faicad/faijs-sketch` first')
  }
  if (!existsSync(join(coreDir, 'dist', 'index.js'))) {
    throw new Error('E_SMOKE_NO_CORE_DIST: run `npm run build -w @faicad/faijs` first')
  }

  tmpDir = mkdtempSync(join(tmpdir(), 'faijs-sketch-smoke-'))

  // 2. pack both packages into the temp dir
  const packCore = await execFileAsync('npm', ['pack', '--pack-destination', tmpDir], { cwd: coreDir, encoding: 'utf8', ...SHELL })
  const packSketch = await execFileAsync('npm', ['pack', '--pack-destination', tmpDir], { cwd: pkgDir, encoding: 'utf8', ...SHELL })
  coreTgz = join(tmpDir, packCore.stdout.trim().split('\n').pop()!)
  sketchTgz = join(tmpDir, packSketch.stdout.trim().split('\n').pop()!)

  // 3. isolated consumer dir
  const consumerDir = join(tmpDir, 'consumer')
  mkdirSync(consumerDir, { recursive: true })
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'faijs-sketch-smoke-consumer',
        type: 'module',
        private: true,
        dependencies: {
          '@faicad/faijs': `file:${coreTgz}`,
          '@faicad/faijs-sketch': `file:${sketchTgz}`,
        },
      },
      null,
      2,
    ),
  )

  // 4. npm install (no network for peer deps — they come from the tarballs)
  await execFileAsync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: consumerDir,
    timeout: 300000,
    encoding: 'utf8',
    ...SHELL,
  })

  // 5. copy consumer script into the install dir (so node resolves node_modules
  //    from the install dir, not the repo root)
  cpSync(consumerScript, join(consumerDir, 'install-smoke-consumer.mjs'))
}, 600000)

afterAll(() => {
  if (tmpDir) {
    if (KEEP) {
      console.log(`SMOKE: kept temp dir at ${tmpDir}`)
    } else {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }
})

describe('npm install smoke — @faicad/faijs-sketch publish state', () => {
  it('installed package solves a rectangle sketch correctly', async () => {
    const consumerDir = join(tmpDir, 'consumer')
    const { stdout, stderr } = await execFileAsync(
      'node',
      ['install-smoke-consumer.mjs'],
      { cwd: consumerDir, timeout: 120000, encoding: 'utf8' },
    )
    expect(stderr).toBe('')
    const summary = JSON.parse(stdout.trim())
    expect(summary.converged).toBe(true)
    expect(summary.bottomLenOk).toBe(true)
    expect(summary.leftLenOk).toBe(true)
    expect(summary.bottomLen).toBeCloseTo(50, 4)
    expect(summary.leftLen).toBeCloseTo(40, 4)
  }, 180000)
})