// 提交前版本 bump：patch 版本 + 同步 demo 的 file: 引用 + 刷新 lock。
// 用法：npx tsx scripts/bump-version.mjs  （在仓库根目录执行）
// 原理：tarball 文件名含版本号（faicad-faijs-<ver>.tgz），
// 版本变化 → npm 缓存 URL 变化 → 不会出现同名 tarball 的 EINTEGRITY。
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const demoDir = join(root, 'demo')

// 1. bump 根包版本（不创建 git tag/commit）
execSync('npm version patch --no-git-tag-version', { cwd: root, stdio: 'inherit' })
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ver = pkg.version
console.log(`bumped root version -> ${ver}`)

// 2. 同步 demo/package.json 的 file: 引用
const demoPkgPath = join(demoDir, 'package.json')
const demoPkg = JSON.parse(readFileSync(demoPkgPath, 'utf8'))
demoPkg.dependencies['@faicad/faijs'] = `file:../faicad-faijs-${ver}.tgz`
writeFileSync(demoPkgPath, JSON.stringify(demoPkg, null, 2) + '\n')
console.log(`synced demo/package.json -> file:../faicad-faijs-${ver}.tgz`)

// 3. 重新 pack（prepack 会自动 build）
execSync('npm pack', { cwd: root, stdio: 'inherit' })
console.log(`packed faicad-faijs-${ver}.tgz`)

// 4. 删除 demo lock 中 @faicad/faijs 条目并重新解析（写入新 URL + integrity）
const lockPath = join(demoDir, 'package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
delete lock.packages['node_modules/@faicad/faijs']
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
execSync('npm install --package-lock-only', { cwd: demoDir, stdio: 'inherit' })
console.log('refreshed demo/package-lock.json')