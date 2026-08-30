#!/usr/bin/env node
// Installs lefthook git hooks into the repository. Runs automatically via the
// root package.json `postinstall` hook after dependencies are installed. CI and
// hookless environments skip installation silently so plain installs stay cheap.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') process.exit(0)

const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook')
if (!existsSync(bin)) process.exit(0)

const args = ['install']
// Node refuses to spawn Windows `.cmd` shims directly; the quoted path is
// re-parsed by cmd.exe, while POSIX can execute its extensionless shim.
const result = process.platform === 'win32'
  ? spawnSync(`"${bin}"`, args, { cwd: root, env: process.env, stdio: 'inherit', shell: true })
  : spawnSync(bin, args, { cwd: root, env: process.env, stdio: 'inherit' })
if (result.status !== 0) {
  console.error(`[install-lefthook] lefthook install failed: ${String(result.error ?? result.status)}`)
  process.exit(result.status ?? 1)
}