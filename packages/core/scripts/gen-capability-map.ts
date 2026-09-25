/**
 * gen-capability-map — compat op → vendored 内核方法依赖盘点（Phase 0 工件生成器）
 *
 * 设计：docs/plans/2026-09-23-brep-engine-switchability-rework.md §4 Phase 0
 *
 * 输入：api/surface/arg-spec.ts（ARG_SPEC，单一真源：kind==='brep-op' 条目）
 *       vendored 树（packages/core/src/vendored/brepjs/）
 * 产物：api/surface/capability-map.json（入库，能力映射表的工作底表）
 *
 * 算法：对每条 brep-op 条目——
 *   1. 解析 source（<module>.js#<Export>）定位 vendored 文件与导出函数；
 *   2. 解析文件的 import（namespace alias / named / re-export），建立调用图；
 *   3. 从导出函数出发 BFS：提取函数体，收集
 *       内核调用  getKernel().<m>( / getKernel2D().<m>( / kernel.<m>(
 *       函数调用  <alias>.<fn>(（命名空间）/ <fn>(（本地或 named import）
 *   4. 递归展开被调函数（环保护），最终得到 op → 内核方法集合。
 *
 * 口径：capability-map.json 的条目数 == arg-spec kind:'brep-op' 条目数，
 *       断言测试（src/api/surface/capability-map.test.ts）钉住三方一致。
 *
 * 运行：npx tsx packages/core/scripts/gen-capability-map.ts
 */

import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { ARG_SPEC } from '../src/api/surface/arg-spec'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const VENDORED_ROOT = path.resolve(__dirname, '../../brepjs/src')
const OUT_FILE = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'capability-map.json')

/** source '<module>.js#<Export>' → 模块文件（.js → .ts）与导出名。 */
function parseSource(source: string): { file: string; exportName: string } {
  const by = source.lastIndexOf('#')
  if (by < 0) throw new Error(`[gen-capability-map] bad source '${source}'`)
  const file = source.slice(0, by)
  return { file: file.endsWith('.js') ? `${file.slice(0, -3)}.ts` : file, exportName: source.slice(by + 1) }
}

// ── 源码扫描工具（字符串/注释/模板串感知） ──

/** 跳过引号字符串 / 模板串 / 行注释 / 块注释；返回下一个实质字符的索引。 */
function skipTrivia(src: string, i: number): number {
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'") {
      const quote = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (c === '`') {
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '`') { i++; break }
        if (src[i] === '$' && src[i + 1] === '{') {
          // 模板插值：跳到配对的 }
          let depth = 1
          i += 2
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') depth--
            i++
          }
          continue
        }
        i++
      }
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    return i
  }
  return i
}

/** 从 open 索引（指向 '('）找到配对 ')' 的索引。 */
function matchParen(src: string, open: number): number {
  let depth = 0
  let i = open
  while (i < src.length) {
    i = skipTrivia(src, i)
    if (i >= src.length) break
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/** 从 open 索引（指向 '{'）找到配对 '}' 的索引。 */
function matchBrace(src: string, open: number): number {
  let depth = 0
  let i = open
  while (i < src.length) {
    i = skipTrivia(src, i)
    if (i >= src.length) break
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/** 从 open 索引（指向 '<'）跳过泛型参数块，返回 '>' 之后的索引（支持嵌套 <…>）。 */
function skipGeneric(src: string, open: number): number {
  let depth = 0
  let i = open
  while (i < src.length) {
    i = skipTrivia(src, i)
    if (i >= src.length) break
    const c = src[i]
    if (c === '<') depth++
    else if (c === '>') {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return -1
}

/** 反向跳过空白，返回索引 i 之前最近的实质字符索引（-1 表示无）。 */
function lastNonTrivia(src: string, i: number): number {
  let j = i - 1
  while (j >= 0) {
    if (/\s/.test(src[j])) { j--; continue }
    return j
  }
  return -1
}

/** 提取 `export function <name>(…) { … }` 或 `export const <name> = …` 的函数体。
 *  支持泛型签名（`export function f<T>(…`）与重载声明（无函数体的声明自动跳过）。
 *  返回 { body, end }；找不到返回 null。 */
function extractFunctionBody(
  src: string,
  name: string,
): { body: string; end: number } | null {
  // 两种形态：export function NAME ... (  /  export const NAME = (…)=> 或 function
  const patterns = [
    new RegExp(`export\\s+function\\s+${name}\\b`, 'g'),
    new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\s*)?(?:<[\\s\\S]*?>\\s*)?\\(`, 'g'),
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      let i: number
      if (patterns.indexOf(re) === 0) {
        // 形态 1：函数名后可能跟泛型 <…> 再跟 '('
        i = skipTrivia(src, m.index + m[0].length)
        if (i < src.length && src[i] === '<') {
          i = skipGeneric(src, i)
          if (i < 0) continue
          i = skipTrivia(src, i)
        }
        if (i >= src.length || src[i] !== '(') continue
      } else {
        // 形态 2：正则已含 '('
        i = m.index + m[0].length - 1
      }
      const close = matchParen(src, i)
      if (close < 0) continue
      // 参数列表之后：扫描到函数体 '{'。跳过返回类型（可能含对象字面量类型）；
      // 重载声明（' ;' 结尾）判定后跳过，继续搜索下一个定义。
      let j = skipTrivia(src, close + 1)
      while (j < src.length) {
        if (src[j] === ';') break // 重载声明（无函数体）→ 跳过本匹配
        if (src[j] === '{') {
          const bodyEnd = matchBrace(src, j)
          if (bodyEnd < 0) {
            j = skipTrivia(src, j + 1)
            continue
          }
          // 函数体 vs 类型块：函数体 '{' 之前最近的非空 token 决定。
          // 函数体前导：`)`（function 声明无返回类型）、`>`（简单/泛型返回类型）、
          // `}`（对象返回类型块结束）、`=`（`=>`）、标识符（类型名）；
          // 类型块前导：`:` `&` `|` `<` `(` 等签名语法。
          const prev = lastNonTrivia(src, j)
          const pc = prev >= 0 ? src[prev] : '\0'
          const isFunctionBody =
            pc === ')' || pc === '}' || pc === '>' || pc === '=' || /[A-Za-z0-9_$]/.test(pc)
          if (isFunctionBody) return { body: src.slice(j + 1, bodyEnd), end: bodyEnd }
          // 类型块（返回类型对象 / 签名内嵌）→ 配对跳过，继续扫描
          j = skipTrivia(src, bodyEnd + 1)
          continue
        }
        j = skipTrivia(src, j + 1)
      }
    }
  }
  return null
}

/** 行内的简单类型注解跳过（用于 `: T` 到行尾/逗号/括号边界）。 */
// （当前实现走 extractFunctionBody 的返回类型分支，无需独立工具。）

interface ImportInfo {
  /** namespace 别名 → 模块绝对路径（如 transforms → …/shapeFns.ts） */
  namespaceAliases: Map<string, string>
  /** named import 名 → { 模块绝对路径, 模块内原始导出名 }（别名导入追踪原始名） */
  namedImports: Map<string, { module: string; origName: string }>
  /** default import 类名 → 模块绝对路径（`new X().method(` 链式调用追踪用） */
  defaultImports: Map<string, string>
  /** 本文件内定义的顶层函数/常量名（含 re-export 的转发名） */
  localNames: Set<string>
}

const fileCache = new Map<string, string>()
const importCache = new Map<string, ImportInfo>()

function readFile(p: string): string {
  let s = fileCache.get(p)
  if (s === undefined) {
    s = fs.readFileSync(p, 'utf-8')
    fileCache.set(p, s)
  }
  return s
}

/** 解析一个文件的 import 图（含 re-export 转发：export { x } from '…'）。 */
function buildImportInfo(fileAbs: string): ImportInfo {
  const cached = importCache.get(fileAbs)
  if (cached) return cached
  const info: ImportInfo = {
    namespaceAliases: new Map(),
    namedImports: new Map(),
    defaultImports: new Map(),
    localNames: new Set(),
  }
  importCache.set(fileAbs, info) // 先占位防环
  const src = readFile(fileAbs)
  const dir = path.dirname(fileAbs)

  const resolveSpec = (spec: string): string | null => {
    const p = path.resolve(dir, spec.endsWith('.js') ? spec : spec)
    const cand = p.endsWith('.js') ? p.slice(0, -3) + '.ts' : p
    return fs.existsSync(cand) ? cand : null
  }

  // import * as alias from '…'
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) {
    const resolved = resolveSpec(m[2])
    if (resolved) info.namespaceAliases.set(m[1], resolved)
  }
  // import Sketcher from '…'（default import，类实例方法链追踪）
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) {
    const resolved = resolveSpec(m[2])
    if (resolved) info.defaultImports.set(m[1], resolved)
  }
  // import { a, b as c } from '…'
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g)) {
    const resolved = resolveSpec(m[2])
    if (!resolved) continue
    for (const item of m[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/)
      const local = (parts[1] ?? parts[0]).trim()
      const orig = parts[0].trim()
      if (local && /^\w+$/.test(local)) info.namedImports.set(local, { module: resolved, origName: orig })
    }
  }
  // re-export 转发：export { x } from '…'  /  export { x as y } from '…'
  for (const m of src.matchAll(/export\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g)) {
    const resolved = resolveSpec(m[2])
    if (!resolved) continue
    for (const item of m[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/)
      const local = (parts[1] ?? parts[0]).trim()
      const orig = parts[0].trim()
      if (local && /^\w+$/.test(local)) info.namedImports.set(local, { module: resolved, origName: orig })
    }
  }
  // 本文件定义的顶层函数/常量（export function X / function X / export const X =）
  for (const m of src.matchAll(/export\s+function\s+(\w+)/g)) info.localNames.add(m[1])
  for (const m of src.matchAll(/^\s*function\s+(\w+)/gm)) info.localNames.add(m[1])
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=/g)) info.localNames.add(m[1])
  return info
}

/** 函数体内的调用收集：内核方法 + 被调函数名（命名空间调用/直接调用/default-import 类）。 */
function collectCalls(
  body: string,
  info: ImportInfo,
): { kernelMethods: Set<string>; calls: Set<string>; nsCalls: Map<string, Set<string>>; classCalls: Set<string> } {
  const kernelMethods = new Set<string>()
  const calls = new Set<string>()
  const nsCalls = new Map<string, Set<string>>()
  const classCalls = new Set<string>()

  // 内核调用：getKernel().<m>( / getKernel2D().<m>( / 局部变量 kernel.<m>(
  for (const m of body.matchAll(/getKernel\(\)\s*\.\s*(\w+)\s*\(/g)) kernelMethods.add(m[1])
  for (const m of body.matchAll(/getKernel2D\(\)\s*\.\s*(\w+)\s*\(/g)) kernelMethods.add(m[1])
  for (const m of body.matchAll(/(?<![.\w])kernel\s*\.\s*(\w+)\s*\(/g)) kernelMethods.add(m[1])

  // 命名空间调用：<alias>.<fn>(  —— alias ∈ info.namespaceAliases
  for (const alias of info.namespaceAliases.keys()) {
    const re = new RegExp(`(?<![.\\w])${alias}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g')
    for (const m of body.matchAll(re)) {
      if (!nsCalls.has(alias)) nsCalls.set(alias, new Set())
      nsCalls.get(alias)!.add(m[1])
    }
  }
  // default import 类实例化：new X( → 追踪该类所在模块（方法链目标）
  for (const m of body.matchAll(/new\s+(\w+)\s*\(/g)) {
    const cls = m[1]
    if (info.defaultImports.has(cls)) classCalls.add(cls)
  }
  // 直接函数调用：<fn>( —— 排除关键字与内核门面（getKernel/getKernel2D 已被上方
  // 内核调用正则捕获，作为函数调用追踪无意义）
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new', 'delete', 'throw', 'else', 'do', 'in', 'of', 'instanceof', 'void', 'function', 'case', 'default', 'yield', 'with', 'this', 'super', 'getKernel', 'getKernel2D'])
  for (const m of body.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1]
    if (KEYWORDS.has(name)) continue
    if (info.localNames.has(name) || info.namedImports.has(name)) calls.add(name)
  }
  return { kernelMethods, calls, nsCalls, classCalls }
}

/** 从入口函数出发 BFS 收集全部内核方法（环保护）。 */
function collectForOp(entryFile: string, entryFn: string): {
  methods: string[]
  trace: Array<{ fn: string; file: string; methods: string[]; calls: string[] }>
} {
  const methods = new Set<string>()
  const trace: Array<{ fn: string; file: string; methods: string[]; calls: string[] }> = []
  const visited = new Set<string>() // key = fileAbs#fn

  const queue: Array<{ file: string; fn: string }> = [{ file: entryFile, fn: entryFn }]
  while (queue.length > 0) {
    const { file, fn } = queue.shift()!
    const key = `${file}#${fn}`
    if (visited.has(key)) continue
    visited.add(key)

    const src = readFile(file)
    const body = fn === '__class__' ? null : extractFunctionBody(src, fn)
    if (fn === '__class__') {
      // default-import 类模块：类方法链的内核依赖。文件级扫描收集直接 getKernel
      // 调用，并把本文件调用的命名空间/命名导入函数继续入队展开（如
      // sketcher.ts → 2d/curves.ts / extrudeFns.ts）。
      const info = buildImportInfo(file)
      const { kernelMethods, calls, nsCalls, classCalls: cc } = collectCalls(src, info)
      for (const m of kernelMethods) methods.add(m)
      const nextCalls: string[] = []
      for (const c of calls) {
        const target = info.namedImports.get(c)
        if (target) {
          queue.push({ file: target.module, fn: target.origName })
          nextCalls.push(`${path.relative(VENDORED_ROOT, target.module).replace(/\\/g, '/')}#${target.origName}`)
        } else if (info.localNames.has(c)) {
          queue.push({ file, fn: c })
          nextCalls.push(`${path.basename(file)}#${c}`)
        }
      }
      for (const [alias, fns] of nsCalls) {
        const target = info.namespaceAliases.get(alias)
        if (!target) continue
        for (const f of fns) {
          queue.push({ file: target, fn: f })
          nextCalls.push(`${path.relative(VENDORED_ROOT, target).replace(/\\/g, '/')}#${f}`)
        }
      }
      for (const cls of cc) {
        const target = info.defaultImports.get(cls)
        if (!target) continue
        queue.push({ file: target, fn: '__class__' })
        nextCalls.push(`${path.relative(VENDORED_ROOT, target).replace(/\\/g, '/')}#new ${cls}()`)
      }
      trace.push({ fn: `new ${path.basename(file)}()`, file: path.relative(VENDORED_ROOT, file).replace(/\\/g, '/'), methods: [...kernelMethods].sort(), calls: nextCalls })
      continue
    }
    if (!body) {
      // barrel re-export 转发：fn 在本文件无函数体，但可能被 re-export 自其它模块
      // （如 shapeHelpers.ts 的 `export { makeTorus } from './solidBuilders.js'`）
      const info = buildImportInfo(file)
      const fwd = info.namedImports.get(fn)
      if (fwd) {
        queue.push({ file: fwd.module, fn: fwd.origName })
        continue
      }
      continue
    }
    const info = buildImportInfo(file)
    const { kernelMethods, calls, nsCalls, classCalls } = collectCalls(body.body, info)
    for (const m of kernelMethods) methods.add(m)

    const nextCalls: string[] = []
    for (const c of calls) {
      // named import 优先（别名 → 模块内原始导出名）；否则同文件本地函数
      const target = info.namedImports.get(c)
      if (target) {
        queue.push({ file: target.module, fn: target.origName })
        nextCalls.push(`${path.relative(VENDORED_ROOT, target.module).replace(/\\/g, '/')}#${target.origName}`)
      } else if (info.localNames.has(c)) {
        queue.push({ file, fn: c })
        nextCalls.push(`${path.basename(file)}#${c}`)
      }
    }
    for (const [alias, fns] of nsCalls) {
      const target = info.namespaceAliases.get(alias)
      if (!target) continue
      for (const f of fns) {
        queue.push({ file: target, fn: f })
        nextCalls.push(`${path.relative(VENDORED_ROOT, target).replace(/\\/g, '/')}#${f}`)
      }
    }
    for (const cls of classCalls) {
      const target = info.defaultImports.get(cls)
      if (!target) continue
      queue.push({ file: target, fn: '__class__' })
      nextCalls.push(`${path.relative(VENDORED_ROOT, target).replace(/\\/g, '/')}#new ${cls}()`)
    }
    trace.push({ fn, file: path.relative(VENDORED_ROOT, file).replace(/\\/g, '/'), methods: [...kernelMethods].sort(), calls: nextCalls })
  }
  return { methods: [...methods].sort(), trace }
}

function main(): void {
  const brepOps = ARG_SPEC.filter((e) => e.kind === 'brep-op')
  const entries = brepOps.map((e) => {
    const { file, exportName } = parseSource(e.source)
    const fileAbs = path.join(VENDORED_ROOT, file)
    if (!fs.existsSync(fileAbs)) {
      throw new Error(`[gen-capability-map] vendored file not found: ${file} (source '${e.source}')`)
    }
    const { methods, trace } = collectForOp(fileAbs, exportName)
    return {
      op: e.name,
      source: e.source,
      vendoredFile: file,
      vendoredFn: exportName,
      kernelMethods: methods,
      trace,
    }
  })

  const out = {
    generatedBy: 'packages/core/scripts/gen-capability-map.ts',
    design: 'docs/plans/2026-09-23-brep-engine-switchability-rework.md §4 Phase 0',
    count: entries.length,
    entries,
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  console.log(`[gen-capability-map] wrote ${entries.length} entries -> ${path.relative(process.cwd(), OUT_FILE)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
