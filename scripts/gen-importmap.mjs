/**
 * gen-importmap.mjs — D3-Browser (npm 自动加载) 的构建期 importmap / 版本表生成器。
 *
 * 扫描 monorepo 内全部可发布的 `@faicad/*` 包，产出三份浏览器消费端产物：
 *   - importmap.json : 方案 a（dev / playground，latest 版）。每个 `@faicad/x` 映射到
 *                      `CDN_BASE + @faicad/x + /+esm`，供浏览器 <script type="importmap">
 *                      直接解析裸 specifier；loader 走 plan-a 模式 `import('@faicad/x')`。
 *   - versions.json : 方案 b（release 兜底，精确 pin 到已安装版）。`{ "@faicad/x": "0.13.0" }`，
 *                      loader 拼 `CDN_BASE + pkg + '@' + version + '/+esm'` 直链导入。
 *   - lib-meta.json : 逐库 `faijs.autoLift` 外置字段（D3-autoLift），`{ "@faicad/x": { "autoLift": bool } }`，
 *                     host 据此构建 loader 的 `autoLiftFor` 闭包。
 *
 * 两方案共用 CDN_BASE（C-CDN 拍板 2026-09-19）：jsDelivr `https://cdn.jsdelivr.net/npm/`，
 * ESM 经 `+esm` 取。dev 走 a、CI 发包渠道走 b。
 *
 * 用法：
 *   node scripts/gen-importmap.mjs [--out <dir>] [--cdn-base <url>]
 * 默认 --out = 仓库根 `cdn/`，默认 CDN_BASE 取 `--cdn-base` 或 env CDN_BASE 或 jsDelivr。
 *
 * 注意：本脚本为纯 Node ESM（无 TS、无构建依赖），可直接用托管 node 跑。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

// --- args ---
let outDir = join(repoRoot, 'cdn')
let cdnBase = process.env.CDN_BASE ?? 'https://cdn.jsdelivr.net/npm/'
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = args[++i]
  else if (args[i] === '--cdn-base') cdnBase = args[++i]
}
if (!cdnBase.endsWith('/')) cdnBase += '/'

// 不发布 / 非引擎包（见 plans/2026-09-19-npm-publish-plan.md §2 C1/Q2/Q3）。
const EXCLUDE = new Set([
  '@faicad/gear-lib-demo', // Q2：属 demo，排除
  '@faicad/faijs-fixtures', // private：测试数据
  '@faicad/faijs-tests', // private：集成测试
  '@faicad/faijs-demo', // private：demo
])

const packagesDir = join(repoRoot, 'packages')
const libs = []
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pjPath = join(packagesDir, entry.name, 'package.json')
  if (!existsSync(pjPath)) continue
  let pj
  try {
    pj = JSON.parse(readFileSync(pjPath, 'utf8'))
  } catch {
    continue
  }
  const name = pj.name
  if (!name || !name.startsWith('@faicad/')) continue
  if (pj.private === true) continue
  if (EXCLUDE.has(name)) continue
  libs.push({
    name,
    version: String(pj.version ?? ''),
    autoLift: pj.faijs?.autoLift, // undefined 表示回落到 runtime 推断式 !hasDualOp(ns)
  })
}

if (libs.length === 0) {
  throw new Error('gen-importmap: no publishable @faicad/* packages found under packages/')
}

// --- plan a: importmap.json（latest，裸 specifier 解析） ---
const imports = {}
for (const lib of libs) {
  imports[lib.name] = `${cdnBase}${lib.name}/+esm`
}
const importmap = { imports }

// --- plan b: versions.json（精确 pin） ---
const versions = {}
for (const lib of libs) {
  if (!lib.version) throw new Error(`gen-importmap: ${lib.name} missing version`)
  versions[lib.name] = lib.version
}

// --- lib-meta.json（autoLift 外置） ---
const libMeta = {}
for (const lib of libs) {
  if (typeof lib.autoLift === 'boolean') libMeta[lib.name] = { autoLift: lib.autoLift }
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'importmap.json'), JSON.stringify(importmap, null, 2) + '\n')
writeFileSync(join(outDir, 'versions.json'), JSON.stringify(versions, null, 2) + '\n')
writeFileSync(join(outDir, 'lib-meta.json'), JSON.stringify(libMeta, null, 2) + '\n')

console.log(
  `gen-importmap: wrote ${libs.length} libs -> ${outDir}\n` +
    `  importmap.json (plan a, latest)  versions.json (plan b, pinned)  lib-meta.json (autoLift)\n` +
    `  CDN_BASE=${cdnBase}\n` +
    `  libs: ${libs.map((l) => l.name + '@' + l.version).join(', ')}`,
)
