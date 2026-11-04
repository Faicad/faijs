#!/usr/bin/env node
/**
 * Fetch unpacked brepkit-wasm versions for the multi-version BREP engine tests.
 *
 * The multi-version tests (packages/core/src/brepkit-kernel/multi-version-smoke.test.ts
 * and packages/core/src/brep/engine/brepkit-*-fix.test.ts) switch between three
 * brepkit versions in one process. Version 2.130.0 — the Faicad fork published as
 * @faicad/brepkit2-wasm — comes from node_modules (the devDependency); 2.129.15 and
 * 4.0.32 are unpacked npm tarballs of the upstream brepkit-wasm package.
 * under packages/core/src/brepkit-kernel/_test-kernels/ (gitignored — large wasm
 * binaries are not committed).
 *
 * This script downloads the two pinned tarballs via `npm pack` and unpacks each
 * into `_test-kernels/brepkit-<version>/package/`. Idempotent: a version whose
 * cjs entry already exists is skipped. Run it after a fresh clone / before
 * running tests that import multi-version-test (CI does this right after npm ci).
 *
 * Usage: node scripts/fetch-test-kernels.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targetDir = join(root, 'packages/core/src/brepkit-kernel/_test-kernels')

/** Pinned versions must match BrepkitTestVersion in multi-version-test.ts. */
const VERSIONS = ['2.129.15', '4.0.32']

for (const version of VERSIONS) {
  const pkgDir = join(targetDir, `brepkit-${version}`, 'package')
  const entry = join(pkgDir, 'brepkit_wasm_node.cjs')
  if (existsSync(entry)) {
    console.log(`[fetch-test-kernels] brepkit-wasm@${version}: already present, skip`)
    continue
  }

  console.log(`[fetch-test-kernels] brepkit-wasm@${version}: downloading via npm pack ...`)
  rmSync(join(targetDir, `brepkit-${version}`), { recursive: true, force: true })
  mkdirSync(join(targetDir, `brepkit-${version}`), { recursive: true })

  // npm pack prints the tarball filename on stdout; -pack-destination keeps the
  // tgz in a known place. Use the workspace root as cwd so npm does not try to
  // resolve workspace-local deps.
  const dest = join(targetDir, `brepkit-${version}`)
  // shell:true so npm resolves through PATH on all platforms (npm.cmd shim on
  // Windows cannot be spawned directly by Node >= 18 without a shell).
  const out = execFileSync(
    `npm pack brepkit-wasm@${version} --pack-destination "${dest}"`,
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: true },
  )
  const tgzName = out.trim().split('\n').pop()
  if (!tgzName) {
    throw new Error(`[fetch-test-kernels] brepkit-wasm@${version}: npm pack produced no tarball name`)
  }
  const tgz = join(dest, tgzName)

  // Unpack with tar (available on ubuntu/macos/windows runners and dev machines).
  //
  // **只传文件名、用 `cwd: dest`**，不传绝对路径。Windows GOTCHA（2026-11-04）：
  // MSYS/GNU tar 把 `-xzf D:/…` 里的 `D:` 当成远程主机规格（rsh），报
  // “Cannot connect to D: resolve failed”；加 `--force-local` 后反斜杠又被当转义
  // （`D\:\\Faicad\\…`）。BSD tar（macOS）又不认 `--force-local`。cwd + 相对文件名
  // 一次绕开全部三种差异。
  execFileSync('tar', ['-xzf', tgzName], { cwd: dest, stdio: 'inherit' })
  rmSync(tgz, { force: true })

  if (!existsSync(entry)) {
    throw new Error(`[fetch-test-kernels] brepkit-wasm@${version}: expected entry missing after unpack: ${entry}`)
  }
  console.log(`[fetch-test-kernels] brepkit-wasm@${version}: ok`)
}

console.log('[fetch-test-kernels] all versions ready')
