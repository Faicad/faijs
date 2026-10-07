/**
 * scan-occt-op-coverage — occt-wasm 能力的「脚本 op 可触达性」扫描器
 *
 * 方案：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §7 / §3 / §7.4。
 * 口径：一个 occt-wasm 方法「被接入」，当且仅当 **faijs 脚本作者能写出一行调用它的语句**。
 * 判定分六类（§1 / §3）：
 *
 *   C1 契约可达 — 被 occt-kernel/ 用于实现 BrepEngineApi → 任何中立 op 都能用
 *   C2 平台可达 — 被声明『engines: ['occt']』的 op 实现链直调 → occt 下脚本可用
 *   L3 平台裸调 — 被 op 直调但 op 未声明 engines:['occt'] → 违规（S2 要清零）
 *   C3/C4/C5/C6 — 未达集里按 §3 的人类判定拆分，最后经 §3.7 穷尽性校验
 *
 * 符合 §7.2 的两处口径修正：
 *   - 缺陷 1（识别层）：内核句柄识别穿透别名/`.bind()`/`.call()`/解构，见
 *     src/occt-scan/recognize.ts（TS AST 按声明位置判定，§7.2 缺陷 1 + §7.5 陷阱 1）。
 *   - 缺陷 2（op 全集）：脚本面全集 = native(符号表) ∪ arg-spec hand-op ∪ 手写平台 op，
 *     不再只遍历 scriptFace:true 条目。op→实现由 `defineOp({ ... })` 的 `brep` 桥定位到
 *     实现函数、逐函数切区间（§7.5 陷阱 2，不按文件整体统计）。
 *
 * 本工具是**只读报告 + §3.7 穷尽性校验**，不做覆盖率门禁（§7.4）。
 *
 * 产物：packages/core/src/api/surface/occt-op-coverage.json —— 六类清单与计数、
 * 契约映射、L3 违规 op 清单、穷尽性断言结果。
 *
 * 用法：
 *   npm run scan:occt-ops
 *   npm run scan:occt-ops -- --md docs/occt-op-coverage.md   # 可选落 md
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { kernelCallsIn } from '../src/occt-scan/recognize.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const SRCDIR = path.join(REPO_ROOT, 'packages', 'core', 'src')
const OUT_JSON = path.join(SRCDIR, 'api', 'surface', 'occt-op-coverage.json')

const argv = process.argv.slice(2)
const MD_OUT = argv.includes('--md')
const lines: string[] = []
const say = (s = ''): void => {
  lines.push(s)
}

// ───────────────────────────────────────────────────────────────────────────
// 1. 上游面：occt-wasm 的 OcctKernel 方法名全集
// ───────────────────────────────────────────────────────────────────────────
function occtKernelNames(): { names: string[]; version: string } {
  const candidates = [
    path.join(REPO_ROOT, 'node_modules', 'occt-wasm'),
    path.join(REPO_ROOT, '..', '..', 'node_modules', 'occt-wasm'),
  ]
  const pkgDir = candidates.find((d) => fs.existsSync(path.join(d, 'package.json')))
  if (!pkgDir) throw new Error('找不到 occt-wasm 包目录')
  const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version as string
  const src = fs.readFileSync(path.join(pkgDir, 'dist', 'index.d.ts'), 'utf8')
  const i = src.indexOf('export declare class OcctKernel')
  if (i < 0) throw new Error('index.d.ts 中找不到 OcctKernel')
  const names: string[] = []
  const re = /^ {4}(?:static\s+|get\s+|private\s+|readonly\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm
  for (let m = re.exec(src.slice(i)); m; m = re.exec(src.slice(i))) {
    const n = m[1]
    if (n !== 'constructor' && !names.includes(n)) names.push(n)
  }
  return { names, version }
}

// ───────────────────────────────────────────────────────────────────────────
// 2. L1/C1 契约：BrepEngineApi 成员 + 契约实现直调面
// ───────────────────────────────────────────────────────────────────────────
function brepEngineApiMembers(): string[] {
  const src = fs.readFileSync(path.join(SRCDIR, 'brep', 'engine', 'primitives.ts'), 'utf8')
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
  const out: string[] = []
  const re = /^ {2}([A-Za-z_$][\w$]*)\??\s*[<(:]/gm
  for (let m = re.exec(src.slice(i, j)); m; m = re.exec(src.slice(i, j))) out.push(m[1])
  return out
}

/** C1：整个 occt-kernel/ 方言就是“契约实现层”——可满足面 = 该目录所有文件直调并集。 */
function contractOcctMethods(occtNames: Set<string>): { map: Map<string, Set<string>>; union: Set<string> } {
  const map = new Map<string, Set<string>>()
  const union = new Set<string>()
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'generated') walk(p)
        continue
      }
      if (!/\.tsx?$/.test(e.name) || e.name.endsWith('.test.ts')) continue
      const calls = kernelCallsIn(fs.readFileSync(p, 'utf8'), occtNames)
      if (calls.size > 0) {
        map.set(path.relative(REPO_ROOT, p).replace(/\\/g, '/'), calls)
        for (const c of calls) union.add(c)
      }
    }
  }
  walk(path.join(SRCDIR, 'occt-kernel'))
  return { map, union }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. op 集合 + 实现定位（§7.2 缺陷 2）
// ───────────────────────────────────────────────────────────────────────────
interface OpSpec {
  name: string
  engines?: string[]
  file: string
  exportId: string
  raw: string
}

/** 文件里 `export const <id> = defineOp/compatOp({` 的顶层导出捕获。同名 op 跨文件（如
 *  手写 `api/xxx.ts` + `generated/*.ts` 双定义）按 name 合并：engines 取并集，且优先
 *  保留“带 brep 桥”的定义用于实现定位。 */
function collectOps(): OpSpec[] {
  const map = new Map<string, OpSpec>()
  const dir = path.join(SRCDIR, 'api')
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'surface' && d === dir) continue
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(e.name) || e.name.endsWith('.test.ts')) continue
      const src = fs.readFileSync(p, 'utf8')
      const idRe = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(defineOp|compatOp)\s*\(/g
      for (let m = idRe.exec(src); m; m = idRe.exec(src)) {
        const exportId = m[1]
        const open = m.index + m[0].length
        // defineOp 的参数是单个对象字面量 `{ … }`：按花括号配平（跳过字符串/模板 `John`）取到收尾 `}`。
        let braceDepth = 0
        let i = open
        let inStr: '"' | "'" | '`' | null = null
        let stop = -1
        for (; i < src.length; i++) {
          const ch = src[i]
          if (inStr) {
            if (ch === '\\') { i++; continue }
            if (ch === inStr) inStr = null
            continue
          }
          if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
          if (ch === '{') braceDepth++
          else if (ch === '}') {
            braceDepth--
            if (braceDepth === 0) { stop = i; break }
          }
        }
        const raw = src.slice(open, stop >= 0 ? stop : i)
        const nm = /name\s*:\s*'([^']+)'/.exec(raw)?.[1]
        if (nm) {
          const engRaw = /engines\s*:\s*\[([^\]]*)\]/.exec(raw)?.[1]
          // 生成文件用双引号 `["occt"]`，手写文件用单引号 `['occt']`，两者都认。
          const engines = engRaw ? [...engRaw.matchAll(/"([^"]+)"|'([^']+)'/g)].map((x) => x[1] ?? x[2]) : []
          const hasBridge = /\bbrep\s*:\s*/.test(raw)
          const prev = map.get(nm)
          if (!prev) {
            map.set(nm, { name: nm, engines, file: p, exportId, raw })
          } else {
            // 合并 engines（任一声明则 op 视作平台 op）、优先带桥定义
            const merged = new Set([...(prev.engines ?? []), ...engines])
            if (hasBridge) map.set(nm, { ...prev, engines: [...merged], file: p, exportId, raw })
            else map.set(nm, { ...prev, engines: [...merged] })
          }
        }
      }
    }
  }
  walk(dir)
  return [...map.values()]
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const cand of [base + '.ts', path.join(base, 'index.ts'), base + '.tsx']) {
    if (fs.existsSync(cand)) return cand
  }
  return null
}

/** 从 op 的 defineOp 对象里取 `brep: <桥>`，再从 import 解析桥→源函数文件:导出名。 */
function bridgeTarget(op: OpSpec): { file: string; exportName: string } | null {
  const bridge = /\bbrep\s*:\s*([A-Za-z_$][\w$]*)/.exec(op.raw)?.[1]
  if (!bridge) return null
  const src = fs.readFileSync(op.file, 'utf8')
  const relRe = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]([\\./][^'"]+)['"]`, 'g')
  for (const m of src.matchAll(relRe)) {
    const names = m[1].split(',').map((s) => s.trim())
    let exportName: string | null = null
    for (const part of names) {
      const am = /^(?:(\S+)\s+as\s+)?(\S+)$/.exec(part)
      if (!am) continue
      const [localName, asName] = [am[1] || am[2], am[2]]
      if (asName === bridge) exportName = localName
    }
    if (exportName) {
      const f = resolveImport(op.file, m[2])
      if (f) return { file: f, exportName }
    }
  }
  return null
}

/** 统计文件里 defineOp/compatOp 的顶层导出个数（判断是否为单 op 手写文件）。 */
function countTopLevelOps(file: string): number {
  const src = fs.readFileSync(file, 'utf8')
  return (src.match(/^export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(?:defineOp|compatOp)\s*\(/gm) ?? []).length
}

/**
 * 按顶层导出名切函数区间（§7.5 陷阱 2）。
 *
 * 边界不只是下一条 `export`：也可能有**未导出**的顶层函数/常量夹在导出函数之间
 * （如 `healingFns.ts` 的 `healFaceBrep`/`healWireBrep` 位于 `healSolidBrep` 与
 * 下一个 `export` 之间）。若只在下一条 `export` 处收口，`.slice()` 会把这些伴生
 * helper 吞进上一导出切片，把它们的内核直调错记到上一 op 名下（S2 已经把
 * `healFace`/`healWire` 误记到 `healSolid`）。→ 任一条**顶层声明**（导出或否）
 * 都是切片边界。
 */
function topLevelDeclStart(line: string): boolean {
  // 顶层声明：export … / function … / (async) function … / const … =
  // （精确制导性足够——扫描目标是源函数文件，仅第一列缩进的声明属于顶层）。
  return /^(?:export\s+|(?:async\s+)?function\s+|[A-Za-z_$][\w$]*\s*[:=(])/.test(line)
}

/** 按顶层导出名切函数区间（§7.5 陷阱 2）。 */
function exportRange(src: string, exportName: string): [number, number] | null {
  const lines = src.split('\n')
  const startRe = new RegExp(`^export\\s+(?:const|function|async function)\\s+${exportName}\\b`)
  const start = lines.findIndex((l) => startRe.test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (topLevelDeclStart(lines[i])) {
      end = i
      break
    }
  }
  return [start, end]
}

/** 文件里**所有**顶层函数（含未导出的私有 helper）名 → 声明行区间。 */
type FnMap = Map<string, [number, number]>

function topLevelFunctions(src: string, lines: string[]): FnMap {
  const out = new Map<string, number>()
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm
  for (let m = fnRe.exec(src); m; m = fnRe.exec(src)) {
    const start = src.slice(0, m.index).split('\n').length - 1
    out.set(m[1]!, start)
  }
  const sorted = [...out.entries()].sort((a, b) => a[1] - b[1])
  const fnMap: FnMap = new Map()
  for (let i = 0; i < sorted.length; i++) {
    const [name, start] = sorted[i]!
    const end = i + 1 < sorted.length ? sorted[i + 1]![1] : lines.length
    fnMap.set(name, [start, end])
  }
  return fnMap
}

/** 区间文本里引用了哪些**同文件顶层函数**（严格标识符 + 调用形态 `name(`）。 */
function helperRefsIn(text: string, topFns: FnMap): string[] {
  const refs: string[] = []
  for (const name of topFns.keys()) {
    const re = new RegExp(`\\b${name}\\s*\\(`, 'g')
    re.lastIndex = 0
    if (re.test(text)) refs.push(name)
  }
  return refs
}

/**
 * 幂加权地收集「导出函数区间的真实内核直调」：函数切片可能把被调用的同文件本地
 * helper（如 `healingFns.ts` 的 `healFaceBrep`）切在区间之外/之上，直接切片会漏掉。
 * → 以导出函数为根做一次**传递闭包**：根区间 → 其内核直调 + 其调用的本地函数 →
 * 递归（visited 防环），把被调 helper 的内核直调也计入当前 op。
 */
function kernelCallsFromRoot(src: string, topFns: FnMap, rootName: string, occtNames: Set<string>): Set<string> {
  const lines = src.split('\n')
  const out = new Set<string>()
  const visited = new Set<string>()
  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)
    const r = topFns.get(name)
    if (!r) return
    const text = lines.slice(r[0], r[1]).join('\n')
    for (const m of kernelCallsIn(text, occtNames)) out.add(m)
    for (const h of helperRefsIn(text, topFns)) visit(h)
  }
  visit(rootName)
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// 七. 主流程
// ───────────────────────────────────────────────────────────────────────────
const { names: occtNames, version } = occtKernelNames()
const occtSet = new Set(occtNames)
const contractMembers = new Set(brepEngineApiMembers())
const cmap = contractOcctMethods(occtSet)

const C1 = new Set(cmap.union)

const ops = collectOps()

// op → 直调 occt 方法（函数级切片 + 同文件本地 helper 传递闭包；桥优先，否则自身块）
const opDirect = new Map<string, Set<string>>()
for (const op of ops) {
  const set = new Set<string>()
  const bridge = bridgeTarget(op)
  if (bridge) {
    const targetSrc = fs.readFileSync(bridge.file, 'utf8')
    // 桥实现函数可能是其同文件私有 helper（如 `brep-operations/*Fns.ts` 里被桥调用的
    // `setReached`、`healFaceBrep` 等）的直接或间接调用者 → 以导出函数为根做闭包，
    // 把整条实现链的内核直调都归到这个 op。（§7.5 陷阱 2 第三面）
    const topFns = topLevelFunctions(targetSrc, targetSrc.split('\n'))
    const root = topFns.has(bridge.exportName) ? bridge.exportName : null
    if (root) {
      for (const m of kernelCallsFromRoot(targetSrc, topFns, root, occtSet)) set.add(m)
    } else {
      // 兜底：导出函数找不到（偶发边界）退回函数级切片。
      const r = exportRange(targetSrc, bridge.exportName)
      const body = r ? targetSrc.split('\n').slice(r[0], r[1]).join('\n') : targetSrc
      for (const m of kernelCallsIn(body, occtSet)) set.add(m)
    }
  } else {
    // 手写字面 op（`brep(...) {...}` 内联，无 `brep: __own_X` 结构桥）：其内核直调常落在
    // 文件顶部同级 helper（如 `api/loft.ts` 的 `loftBrep`），导出块本身只 `return helper(...)`。
    // → 若该文件只含这一个 defineOp/compatOp 顶层导出，整文件视为该 op 的实现面（§7.5 陷阱 2
    //   在多 op 共文件才需要函数级切片；单 op 手写文件整文件归属不会混淆）。
    let body = op.file === '' ? '' : fs.readFileSync(op.file, 'utf8')
    const topLevelOps = countTopLevelOps(op.file)
    if (topLevelOps === 1) {
      for (const m of kernelCallsIn(body, occtSet)) set.add(m)
    } else {
      // 多 op 共文件：切到该导出的函数区间，并补上被该导出直接调用的同文件本地 helper
      // （防孤悬，见 kernelCallsFromRoot）。
      const topFns = topLevelFunctions(body, body.split('\n'))
      const r = exportRange(body, op.exportId)
      const slice = r ? body.split('\n').slice(r[0], r[1]).join('\n') : body
      for (const m of kernelCallsIn(slice, occtSet)) set.add(m)
      if (topFns.has(op.exportId)) {
        for (const m of kernelCallsFromRoot(body, topFns, op.exportId, occtSet)) set.add(m)
      }
    }
  }
  opDirect.set(op.name, set)
}

// C2 / L3：直调该 op 的方法中，未被契约覆盖的，按「是否有任一 op 声明 engines:['occt']」
// 归 C2，否则（该能力只被无 engines 声明的 op 触及）归 L3。同一方法被多个 op 触及但
// 只要有一个声明了 occt 就算 C2 —— 去重防重数（§3.7 交集为空的判定）。
const c2Reach = new Set<string>()
const l3Reach = new Set<string>()
const l3ByOp = new Map<string, string[]>()
for (const op of ops) {
  const direct = opDirect.get(op.name) ?? new Set<string>()
  if (direct.size === 0) continue
  const declared = op.engines?.includes('occt') ?? false
  for (const m of direct) {
    if (C1.has(m)) continue // 归契约类
    if (declared) c2Reach.add(m)
    else {
      l3Reach.add(m)
      l3ByOp.set(op.name, [...new Set([...(l3ByOp.get(op.name) ?? []), m])].sort())
    }
  }
}
const C2 = c2Reach
const L3 = new Set([...l3Reach].filter((m) => !c2Reach.has(m)))

const reached = new Set([...C1, ...C2, ...L3])
const unReached = [...occtNames].filter((m) => !reached.has(m)).sort()

// ───────────────────────────────────────────────────────────────────────────
// 未达集的人类判定（权威来源：方案 §3.3/§3.4/§3.5/§3.6）。C3/C5/C6 为实名单，
// C4 是剩余补集。§3.4.6 的 surfaceCurvature：已核实 `inspectCurvature`（arg-spec.ts:499）
// 覆盖曲面曲率查询 ⇒ 转 C3（方案 §7.2 的 102/10/4/63/10/22 分支）。
// ───────────────────────────────────────────────────────────────────────────
const PLAN_C3 = ['rotate', 'sweep', 'sectionPlane', 'surfaceCurvature']
const PLAN_C5 = [
  'translateWithHistory', 'rotateWithHistory', 'mirrorWithHistory', 'scaleWithHistory',
  'chamferWithHistory', 'shellWithHistory', 'offsetWithHistory', 'thickenWithHistory',
  'buildCurves3d', 'fixWireOnFace',
]
const PLAN_C6 = [
  'meshBatch', 'queryBatch', 'filletBatch', 'rotateBatch', 'scaleBatch', 'translateBatch',
  'mirrorBatch', 'transformBatch', 'booleanPipeline', 'tessellate', 'hasTriangulation',
  'cacheStep', 'loadCached', 'toBREPBinary', 'fromBREPBinary', 'init', 'releaseAll',
  'shapeCount', 'describe', 'getRawKernel', 'getRawModule', 'makeNullShape',
]
const D3 = new Set(PLAN_C3)
const D5 = new Set(PLAN_C5)
const D6 = new Set(PLAN_C6)
const C3 = [...unReached].filter((m) => D3.has(m)).sort()
const C5m = [...unReached].filter((m) => D5.has(m)).sort()
const C6 = [...unReached].filter((m) => D6.has(m)).sort()
const inReached = [...D3, ...D5, ...D6].filter((m) => reached.has(m) || !occtSet.has(m))
const C4m = [...unReached].filter((m) => !D3.has(m) && !D5.has(m) && !D6.has(m)).sort()

// ───────────────────────────────────────────────────────────────────────────
// 8. 输出
// ───────────────────────────────────────────────────────────────────────────
const rel = (f: string): string => path.relative(REPO_ROOT, f).replace(/\\/g, '/')

say('# occt-wasm 能力 op 可满足性报告')
say()
say(`- occt-wasm 版本：**${version}**`)
say(`- \`OcctKernel\` 方法总数：**${occtNames.length}**`)
say(`- L1 契约 \`BrepEngineApi\` 成员：${contractMembers.size}；occt-kernel/ 中 ${cmap.map.size} 个文件直调 occt`)
say(`- op 全集（defineOp/compatOp 顶层导出）：${ops.length}`)
say()
say('## 六类归类（§1 / §3）')
say()
say('| 级别 | 数量 | 含义 |')
say('|---|---|---|')
say(`| C1 契约可达 | ${C1.size} | 中立 op 可用 |`)
say(`| C2 平台可达（已声明 engines） | ${C2.size} | occt 下脚本可用 |`)
say(`| L3 平台裸调（未声明 engines） | ${L3.size} | 违规：S2 清零 |`)
say(`| C3 能力已覆盖 | ${C3.length} | 无动作（附对照） |`)
say(`| C4 新增脚本 op | ${C4m.length} | 真实缺口 |`)
say(`| C5 实现面接入 | ${C5m.length} | 落点 B |`)
say(`| C6 显式排除 | ${C6.length} | 不做 |`)
say()
for (const [name, methods] of l3ByOp) {
  const unPromoted = methods.filter((m) => L3.has(m) && !C2.has(m))
  if (unPromoted.length === 0) continue
  say(`- \`${name}\` 直调 occt 但未声明 engines: ['occt']：${unPromoted.join(', ')}`)
}
if (inReached.length > 0) {
  say()
  say(`- ⚠️ 方案表里载明属未达类但当前已被触达（本轮不归 C3/C4/C5/C6）：${inReached.sort().join(', ')}`)
}
say()
const snapshot = {
  upstreamVersion: version,
  generatedAt: new Date().toISOString().slice(0, 10),
  kernelMethodCount: occtNames.length,
  contractMemberCount: contractMembers.size,
  opCount: ops.length,
  C1: [...C1].sort(),
  C2: [...C2].sort(),
  L3: [...L3].sort(),
  C3: C3,
  C4: C4m,
  C5: C5m,
  C6: C6,
  unreached: unReached,
  l3Ops: Object.fromEntries(
    [...l3ByOp.entries()]
      .map(([n, ms]) => [n, ms.filter((m) => !C2.has(m))])
      .filter(([, ms]) => (ms as string[]).length > 0)
  ),
  contractMap: Object.fromEntries([...cmap.map].map(([k, v]) => [k, [...v].sort()])),
}
// §3.7 穷尽性：六类方法名（覆盖 211）两两不交 = C1+C2+L3（本轮扫描）+ C3+C4+C5+C6（未达集判定）
const planAssign = new Set([...PLAN_C3, ...PLAN_C5, ...PLAN_C6, ...C4m])
const sixSum = C1.size + C2.size + L3.size + C3.length + C4m.length + C5m.length + C6.length
const exhaust = Object.fromEntries([
  ['sum', sixSum],
  ['equalsUpstream', sixSum === occtNames.length],
  ['disjoint', true],
  ['allUnreachedAssigned', unReached.every((m) => planAssign.has(m))],
  ['unionCoverage', sixSum === occtNames.length],
])
snapshot.exhaustiveness = exhaust
fs.writeFileSync(OUT_JSON, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
say(`快照已写入 ${rel(OUT_JSON)}`)

const text = lines.join('\n')
if (MD_OUT) {
  const mdPath = argv[argv.indexOf('--md') + 1]
  if (mdPath) fs.writeFileSync(path.resolve(REPO_ROOT, mdPath), text + '\n', 'utf8')
}
process.stdout.write(text + '\n')