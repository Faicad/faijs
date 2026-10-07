/**
 * scan-occt-op-coverage — occt-wasm 能力的「脚本 op 可触达性」扫描器
 *
 * 口径：一个 occt-wasm 方法「被接入」，当且仅当 **faijs 脚本作者能写出一行调用它的语句**。
 * 因此判定不看「faijs 源码里有没有出现过这个 API 名」（那是库内部口径），而看
 * 四级可达性：
 *
 *   L1 契约可达 — 该方法被 occt-kernel/occt-primitives.ts 用于实现某个 BrepEngineApi
 *                  成员 → 任何中立 op 都能用
 *   L2 平台可达 — 该方法被某个带 engines:['occt'] 的 op 实现链调用 → occt 下脚本可用
 *   L3 平台裸调 — 被调了，但所在 op 没声明 engines:['occt'] → 违规（brepkit 下运行时才炸）
 *   L4 不可达   — 无任何 op 触及 → 新 op 候选
 *
 * 用法：
 *   npm run scan:occt-ops     # 报告 + 落 occt-op-coverage.json
 *
 * 本工具是**只读报告**，不做 CI 门禁。门禁语义（"新增未接线就失败"）在目标是
 * op 化时站不住脚：不是每个新增 API 都有建模语义、都该单独成 op（wasm 胶水、
 * 批量变体、底层曲线编辑都不该），用门禁逼平只会倒逼出无意义的 op 或让人关掉
 * 门禁。人会读报告、按 §4 的取舍表判断，机器不做这个决定。
 *
 * 产物（packages/core/src/api/surface/）：
 *   occt-op-coverage.json   当前四级快照（供人工比对历次升级的差异）
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const nodeRequire = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const SURFACE_DIR = path.join(REPO_ROOT, 'packages', 'core', 'src', 'api', 'surface')

const OUT_JSON = path.join(SURFACE_DIR, 'occt-op-coverage.json')

const argv = process.argv.slice(2)
const MD_OUT = argv.includes('--md')

const lines: string[] = []
const say = (s = ''): void => {
  lines.push(s)
}

// ───────────────────────────────────────────────────────────────────────────
// 1. 上游面：occt-wasm 的 OcctKernel 方法名全集
// ───────────────────────────────────────────────────────────────────────────

function occtKernelMethods(): { names: string[]; version: string } {
  // 包的 exports 字段不暴露 ./package.json，直接按 node_modules 布局定位
  // （pnpm/npm 提升两种情况都覆盖）。
  const candidates = [
    path.join(REPO_ROOT, 'node_modules', 'occt-wasm'),
    path.join(REPO_ROOT, '..', '..', 'node_modules', 'occt-wasm'),
  ]
  const pkgDir = candidates.find((d) => fs.existsSync(path.join(d, 'package.json')))
  if (!pkgDir) throw new Error('找不到 occt-wasm 包目录')
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  const version = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).version as string
  const dts = path.join(path.dirname(pkgJsonPath), 'dist', 'index.d.ts')
  const src = fs.readFileSync(dts, 'utf8')
  const i = src.indexOf('export declare class OcctKernel')
  if (i < 0) throw new Error('index.d.ts 中找不到 OcctKernel')
  const names: string[] = []
  const re = /^ {4}(?:static\s+|get\s+|private\s+|readonly\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm
  const body = src.slice(i)
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const n = m[1]
    if (n !== 'constructor' && !names.includes(n)) names.push(n)
  }
  return { names, version }
}

// ───────────────────────────────────────────────────────────────────────────
// 2. L1 契约：BrepEngineApi 成员全集
// ───────────────────────────────────────────────────────────────────────────

function brepEngineApiMembers(): string[] {
  const f = path.join(REPO_ROOT, 'packages', 'core', 'src', 'brep', 'engine', 'primitives.ts')
  const src = fs.readFileSync(f, 'utf8')
  const i = src.indexOf('export interface BrepEngineApi')
  if (i < 0) throw new Error('primitives.ts 中找不到 BrepEngineApi')
  let depth = 0
  let j = i
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  const body = src.slice(i, j)
  const out: string[] = []
  const re = /^ {2}([A-Za-z_$][\w$]*)\??\s*[<(:]/gm
  for (let m = re.exec(body); m; m = re.exec(body)) out.push(m[1])
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// 3. 内核直调识别：先找文件里的内核变量名，再匹配 `变量.方法(`
//    刻意不用「文件里出现过 getOcctKernel 就算全文件方法都算」——那会把
//    faijs 自己的 BrepEngineApi 同名方法（rotate / tessellate / isFace …）
//    误判成 occt 调用。
// ───────────────────────────────────────────────────────────────────────────

// 内核获取器：只有从这三个入口拿到的变量才是 occt 原生句柄。
// **不能**默认把 `kernel` 算进来——本仓大量 `const kernel = getBrepApi()`
// （L1 契约句柄），把它的调用当 occt 直调会把中立 op 全误判成平台 op。
const KERNEL_ACQUIRE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?[^;\n]*(?:getOcctKernel|getKernel|initOcctWasm)\s*\(\s*\)/g

/** 文件里被判定为「occt 内核直调」的方法名集合。 */
function kernelCallsIn(src: string, occtNames: Set<string>): Set<string> {
  const vars = new Set<string>()
  KERNEL_ACQUIRE.lastIndex = 0
  for (let m = KERNEL_ACQUIRE.exec(src); m; m = KERNEL_ACQUIRE.exec(src)) vars.add(m[1])
  const out = new Set<string>()
  // 链式：`getOcctKernel().xxx(` / `getKernel().xxx(`
  for (const getter of ['getOcctKernel', 'getKernel']) {
    const chained = new RegExp(`${getter}\\s*\\(\\s*\\)\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')
    for (let m = chained.exec(src); m; m = chained.exec(src)) {
      if (occtNames.has(m[1])) out.add(m[1])
    }
  }
  for (const v of vars) {
    const re = new RegExp(`(?<![.\\w])${v}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')
    for (let m = re.exec(src); m; m = re.exec(src)) {
      if (occtNames.has(m[1])) out.add(m[1])
    }
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// 4. L1 契约映射：createOcctPrimitives() 返回的对象字面量
//    成员名 → 该成员实现体内调用的 occt 方法集合
// ───────────────────────────────────────────────────────────────────────────

/**
 * L1 契约映射：整个 `occt-kernel/` 目录就是 L1 契约 `BrepEngineApi` 的 occt
 * 显式实现层（`createOcctPrimitives()` 在此，成员实现再委托到 hullOps /
 * topologyExt / highLevelApi 等同目录文件）。所以 L1 = 该目录所有文件直调的
 * occt 方法之并集。
 *
 * 不做「成员 → 方法」的细粒度映射：`occt-primitives.ts` 的成员体多半只是
 * 一行委托（如 `hullFromPoints: hullFromPointsCore`），真实调用在别的文件里，
 * 按成员行区间切会把绝大多数方法漏掉（实测 L1 = 0）。
 */
function contractOcctMethods(occtNames: Set<string>): Map<string, Set<string>> {
  const dir = path.join(REPO_ROOT, 'packages', 'core', 'src', 'occt-kernel')
  const map = new Map<string, Set<string>>()
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'generated') walk(p)
        continue
      }
      if (!/\.tsx?$/.test(e.name) || e.name.endsWith('.test.ts')) continue
      const calls = kernelCallsIn(fs.readFileSync(p, 'utf8'), occtNames)
      if (calls.size > 0) map.set(path.relative(REPO_ROOT, p).replace(/\\/g, '/'), calls)
    }
  }
  walk(dir)
  return map
}

// ───────────────────────────────────────────────────────────────────────────
// 5. 脚本面 op 清单（arg-spec 的 scriptFace:true 条目）
// ───────────────────────────────────────────────────────────────────────────

interface ScriptFaceOp {
  name: string
  source?: string
  engines?: string[]
  module?: string
}

function scriptFaceOps(): ScriptFaceOp[] {
  const f = path.join(SURFACE_DIR, 'arg-spec.ts')
  const src = fs.readFileSync(f, 'utf8')
  const ops: ScriptFaceOp[] = []
  for (const block of src.split(/\n {2}\{\n/)) {
    if (!/scriptFace:\s*true/.test(block)) continue
    const name = /name:\s*'([^']+)'/.exec(block)?.[1]
    if (!name) continue
    const source = /source:\s*'([^']+)'/.exec(block)?.[1]
    const module = /module:\s*'([^']+)'/.exec(block)?.[1]
    const eng = /engines:\s*\[([^\]]*)\]/.exec(block)?.[1]
    const engines = eng
      ? [...eng.matchAll(/'([^']+)'/g)].map((m) => m[1])
      : undefined
    ops.push({ name, source, engines, module })
  }
  return ops
}

/** faijs 原生 op（symbol-table.generated.ts 的键）。 */
function nativeOps(): string[] {
  const f = path.join(REPO_ROOT, 'packages', 'core', 'src', 'lang', 'symbol-table.generated.ts')
  const src = fs.readFileSync(f, 'utf8')
  return [...src.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1])
}

// ───────────────────────────────────────────────────────────────────────────
// 6. op 实现链闭包（沿 import 边，排除契约实现层）
// ───────────────────────────────────────────────────────────────────────────

const EXCLUDED_FROM_CHAIN: RegExp[] = [/[\\/]occt-kernel[\\/]/, /[\\/]brep[\\/]engine[\\/]/]

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const cand of [base + '.ts', path.join(base, 'index.ts'), base + '.tsx']) {
    if (fs.existsSync(cand)) return cand
  }
  return null
}

/** 从一组入口文件出发，沿相对 import 做传递闭包。 */
function importClosure(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const f = queue.shift()!
    if (seen.has(f)) continue
    seen.add(f)
    let src: string
    try {
      src = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
      const r = resolveImport(f, m[1])
      if (r && !seen.has(r)) queue.push(r)
    }
  }
  return seen
}

/** arg-spec 的 source（`brep-operations/hullFns.ts#convexHullBrep`）→ { 文件, 导出名 }。 */
function parseSource(source: string): { file: string; exportName?: string } | null {
  const [file, exportName] = source.split('#')
  const p = path.join(REPO_ROOT, 'packages', 'core', 'src', 'api', file)
  return fs.existsSync(p) ? { file: p, exportName } : null
}

/**
 * 取某个导出符号在文件中的行区间（到下一个顶层 `export` 为止）。
 *
 * 必须按**导出名**切区间，不能按文件整体统计：同一文件里常有多个 op
 * （`topologyFns.ts` 有 applyMatrix/clone/locate/mirror/rotate 五个），
 * 按文件统计会把其中任一处的 occt 直调算到全部 op 头上，L3 门禁直接误报一片。
 */
function exportRange(src: string, exportName: string): [number, number] | null {
  const lines = src.split('\n')
  const startRe = new RegExp(`^export\\s+(?:const|function|async function)\\s+${exportName}\\b`)
  const start = lines.findIndex((l) => startRe.test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^export\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return [start, end]
}

/** 扫描 api/ 下全部 TS 作为 op 实现的兜底入口（原生 op 无 source 字段）。 */
function apiEntryFiles(): string[] {
  const dir = path.join(REPO_ROOT, 'packages', 'core', 'src', 'api')
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'surface' || e.name === 'generated') continue
        walk(p)
      } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts')) {
        out.push(p)
      }
    }
  }
  walk(dir)
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// 7. 主流程
// ───────────────────────────────────────────────────────────────────────────

const { names: occtNames, version } = occtKernelMethods()
const occtSet = new Set(occtNames)
const contractMembers = new Set(brepEngineApiMembers())
const cmap = contractOcctMethods(occtSet)
const sfOps = scriptFaceOps()
const natives = nativeOps()

// L1：契约实现层用到的 occt 方法
const L1 = new Set<string>()
for (const methods of cmap.values()) for (const m of methods) L1.add(m)

// op 链路：arg-spec source 指向的模块 + api/ 兜底入口，排除契约实现层
const entries: string[] = []
for (const op of sfOps) {
  if (!op.source) continue
  const s = parseSource(op.source)
  if (s) entries.push(s.file)
}
entries.push(...apiEntryFiles())
const chain = importClosure(entries)
const chainFiles = [...chain].filter((f) => !EXCLUDED_FROM_CHAIN.some((re) => re.test(f)))

// 每个链文件的内核直调
const fileCalls = new Map<string, Set<string>>()
for (const f of chainFiles) {
  const calls = kernelCallsIn(fs.readFileSync(f, 'utf8'), occtSet)
  if (calls.size > 0) fileCalls.set(f, calls)
}

// op → 直调 occt 方法（按 source 的导出名切区间；无 source 的记到 <api/*> 桶）
const opDirect = new Map<string, Set<string>>()
for (const op of sfOps) {
  const set = new Set<string>()
  const s = op.source ? parseSource(op.source) : null
  if (s) {
    const src = fs.readFileSync(s.file, 'utf8')
    let body = src
    if (s.exportName) {
      const range = exportRange(src, s.exportName)
      if (range) body = src.split('\n').slice(range[0], range[1]).join('\n')
    }
    for (const m of kernelCallsIn(body, occtSet)) set.add(m)
  }
  opDirect.set(op.name, set)
}

// L2 / L3
const L2 = new Set<string>()
const L3 = new Set<string>()
const l3Ops: string[] = []
for (const op of sfOps) {
  const direct = opDirect.get(op.name) ?? new Set<string>()
  if (direct.size === 0) continue
  const declared = op.engines?.includes('occt') ?? false
  for (const m of direct) {
    if (declared) L2.add(m)
    else L3.add(m)
  }
  if (!declared) l3Ops.push(op.name)
}

// L4
const all = new Set(occtNames)
const L4 = [...all].filter((m) => !L1.has(m) && !L2.has(m) && !L3.has(m)).sort()

// ───────────────────────────────────────────────────────────────────────────
// 8. 输出
// ───────────────────────────────────────────────────────────────────────────

const rel = (f: string): string => path.relative(REPO_ROOT, f).replace(/\\/g, '/')

say('# occt-wasm 能力 op 可触达性报告')
say()
say(`- occt-wasm 版本：**${version}**`)
say(`- \`OcctKernel\` 方法总数：**${occtNames.length}**`)
say(`- L1 契约 \`BrepEngineApi\` 成员：${contractMembers.size}；occt-kernel/ 中 ${cmap.size} 个文件直调 occt`)
say(`- 脚本面 op：arg-spec \`scriptFace:true\` ${sfOps.length} 条 + 原生 ${natives.length} 条`)
say(`- op 链路文件（已排除 occt-kernel/ 与 brep/engine/）：${chainFiles.length}`)
say()
say('## 四级归类')
say()
say(`| 级别 | 数量 | 含义 |`)
say(`|---|---|---|`)
say(`| L1 契约可达 | ${L1.size} | 中立 op 可用 |`)
say(`| L2 平台可达（已声明 engines） | ${L2.size} | occt 下脚本可用 |`)
say(`| L3 平台裸调（**未声明 engines**） | ${L3.size} | 违规：brepkit 下运行时才炸 |`)
say(`| L4 不可达 | ${L4.length} | 新 op 候选 |`)
say()

if (l3Ops.length > 0) {
  say('## L3 违规：调了 occt 原生却未声明 `engines: [\'occt\']`')
  say()
  say('这些 op 在 brepkit 装配下不会被静态门拦住，会**运行时崩溃**。')
  say()
  for (const op of [...new Set(l3Ops)].sort()) {
    const o = sfOps.find((x) => x.name === op)
    say(`- \`${op}\` — source: \`${o?.source ?? '?'}\`，直调 occt：${[...(opDirect.get(op) ?? [])].sort().join(', ')}`)
  }
  say()
}

say('## L4 不可达（新 op 候选）')
say()
say('> 结合方案 §4 的「不做 op」排除表判读：wasm 胶水 / 批量优化 / 原始序列化 /')
say('> 曲线底层编辑不必成 op，其余是有建模语义的候选。')
say()
say('```')
say(L4.join(' '))
say('```')
say()

// 快照 + 基线
const snapshot = {
  upstreamVersion: version,
  generatedAt: new Date().toISOString().slice(0, 10),
  kernelMethodCount: occtNames.length,
  contractMemberCount: contractMembers.size,
  scriptFaceOpCount: sfOps.length,
  L1: [...L1].sort(),
  L2: [...L2].sort(),
  L3: [...L3].sort(),
  L4,
  l3Ops: [...new Set(l3Ops)].sort(),
  contractMap: Object.fromEntries([...cmap].map(([k, v]) => [k, [...v].sort()])),
}
fs.writeFileSync(OUT_JSON, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
say()
say(`快照已写入 ${rel(OUT_JSON)}`)

const text = lines.join('\n')
if (MD_OUT) {
  const mdPath = argv[argv.indexOf('--md') + 1]
  if (mdPath) fs.writeFileSync(path.resolve(REPO_ROOT, mdPath), text + '\n', 'utf8')
}
process.stdout.write(text + '\n')
