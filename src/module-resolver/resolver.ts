/**
 * module-resolver — 运行时模块解析（channel ③，V5.2）
 *
 * 提供纯函数 `resolveImports(code, options)`：
 * - acorn 解析每个顶层 import 声明（复用 faqts imports 的 span 定位）
 * - 裸说明符 → 查找解析表（imports / scopes）→ 重写为宿主可加载的绝对 URL
 * - 相对说明符 → 按 importer/baseURL 绝对化
 * - `@faicad/faijs` 家族 → 零替换（宿主 importmap 解析，保证单例）
 * - 未登记的裸说明符 → 抛错（roadmap §11 验收：不回退、不静默）
 * - 版本范围 → 校验（roadmap §11 验收：版本不匹配必须抛错）
 *
 * 本模块不发起网络、不做递归依赖装配（宿主负责拓扑与 fetch/build）。
 */

import { findImports } from '../faqts/imports'
import { assertSatisfies } from './version'

/** 解析值：可直接给 URL，或带版本的对象（用于范围校验）。 */
export type ResolverValue = string | { url: string; version?: string }

export interface ResolveImportsOptions {
  /** 顶层解析表：裸说明符 → URL / {url, version} */
  imports: Record<string, ResolverValue>
  /**
   * V5.2 多版本 scopes：键为导入方模块的 URL 前缀，值为局部解析表。
   * 解析当前模块时按 importer 前缀匹配**最长** scope，优先于顶层 imports。
   */
  scopes?: Record<string, Record<string, ResolverValue>>
  /** 当前模块 URL（可选）：用于 relative 绝对化与 scope 匹配 */
  importer?: string | URL
  /** base URL（可选）；缺省时相对 `importer` 的目录 */
  baseURL?: string | URL
  /** 保留前缀，默认 `@faicad/faijs` 家族零替换 */
  reservedPrefixes?: string[]
}

export interface ResolveResult {
  /** 重写后的模块源码 */
  code: string
  /** 每个被重写的 import 的映射：原 specifier → 绝对 URL */
  resolved: Record<string, string>
}

export class ModuleResolverError extends Error {}

/** 未登记的裸说明符（roadmap §11 第一条：不回退、不静默）。 */
export class UnresolvedImportError extends ModuleResolverError {
  readonly specifier: string
  constructor(specifier: string, importerHint?: string) {
    super(
      `[module-resolver] unresolvable bare module specifier "${specifier}"` +
        (importerHint ? ` (imported by ${importerHint})` : '') +
        ' — not registered in the resolution table',
    )
    this.name = 'UnresolvedImportError'
    this.specifier = specifier
  }
}

/** 版本范围不满足（roadmap §11 第三条：必须抛错）。 */
export class ImportVersionError extends ModuleResolverError {
  readonly specifier: string
  constructor(specifier: string, version: string, range: string) {
    super(
      `[module-resolver] import "${specifier}" requires range "${range}" ` +
        `but registry entry resolves to version "${version}"`,
    )
    this.name = 'ImportVersionError'
    this.specifier = specifier
  }
}

const DEFAULT_RESERVED = ['@faicad/faijs', '@faicad/faq', '@faicad/faq/sdk', '@fc/fq/']

function isReserved(spec: string, prefixes: string[]): boolean {
  return prefixes.some((p) => spec === p || spec.startsWith(p + '/'))
}

function asString(u: string | URL): string {
  return typeof u === 'string' ? u : u.href
}

function resolverBase(opts: ResolveImportsOptions): string | undefined {
  if (opts.baseURL) return asString(opts.baseURL)
  if (opts.importer) {
    const imp = asString(opts.importer)
    try {
      return new URL('.', imp).href
    } catch {
      return imp
    }
  }
  return undefined
}

/** 拆分裸名（可能内嵌版本范围）：`mech@^1.2` / `@scope/gear@~2.0` */
export function splitVersionRange(spec: string): { name: string; range?: string } {
  const at = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@')
  if (at === -1 || at === spec.length - 1) return { name: spec }
  return { name: spec.slice(0, at), range: spec.slice(at + 1) }
}

/** 选最长匹配的 scope 表（V5.2 多版本）。 */
function pickScope(opts: ResolveImportsOptions): Record<string, ResolverValue> | undefined {
  if (!opts.scopes || !opts.importer) return undefined
  const imp = asString(opts.importer)
  let best: Record<string, ResolverValue> | undefined
  let bestLen = -1
  for (const [prefix, table] of Object.entries(opts.scopes)) {
    if (imp.startsWith(prefix) && prefix.length > bestLen) {
      best = table
      bestLen = prefix.length
    }
  }
  return best
}

/** 表内精确查找，或子路径键（`gear/` → `gear/sub`）。 */
function lookupValue(
  pkgName: string,
  table: Record<string, ResolverValue> | undefined,
): ResolverValue | undefined {
  if (!table) return undefined
  if (Object.prototype.hasOwnProperty.call(table, pkgName)) return table[pkgName]
  for (const k of Object.keys(table)) {
    if (k.endsWith('/') && pkgName.startsWith(k)) return table[k]
  }
  return undefined
}

function resolveEntry(
  value: ResolverValue,
  specifier: string,
  range: string | undefined,
): string {
  const url = typeof value === 'string' ? value : value.url
  if (range !== undefined) {
    const version = typeof value === 'string' ? undefined : value.version
    if (version !== undefined) {
      try {
        assertSatisfies(version, range, specifier)
      } catch {
        throw new ImportVersionError(specifier, version, range)
      }
    } else {
      throw new ImportVersionError(specifier, '(unknown)', range)
    }
  }
  return url
}

/**
 * 纯函数：解析并重写模块代码中的 import 说明符。
 *
 * 优先级：
 * 1. 保留前缀（`@faicad/faijs` 家族）→ 零替换（宿主 importmap）
 * 2. scope 表（最长前缀匹配）覆盖顶层 imports
 * 3. 相对说明符且有 base → 绝对化；否则原样保留
 * 4. 顶层表登记 → 绝对 URL（含版本范围校验）
 * 5. 未登记的裸说明符 → UnresolvedImportError
 */
export function resolveImports(code: string, options: ResolveImportsOptions): ResolveResult {
  const spans = findImports(code)
  const reserved = options.reservedPrefixes === undefined ? DEFAULT_RESERVED : options.reservedPrefixes
  const scopeTable = pickScope(options)
  const base = resolverBase(options)
  let out = code
  const resolved: Record<string, string> = {}

  // 从后往前，保证 span 位置在之前替换后不漂移
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]
    const spec = span.specifier

    // 保留前缀：零替换
    if (span.bare && isReserved(spec, reserved)) continue

    if (span.bare) {
      const { name, range } = splitVersionRange(spec)
      const value = lookupValue(name, scopeTable) ?? lookupValue(name, options.imports)
      if (value === undefined) {
        throw new UnresolvedImportError(spec, options.importer !== undefined ? asString(options.importer) : undefined)
      }
      const url = resolveEntry(value, spec, range)
      out = out.slice(0, span.start) + url + out.slice(span.end)
      resolved[spec] = url
    } else if (spec.startsWith('.') && base !== undefined) {
      const url = new URL(spec, base).href
      if (url !== spec) {
        out = out.slice(0, span.start) + url + out.slice(span.end)
        resolved[spec] = url
      }
    }
    // 其余（绝对 URL）原样保留
  }

  return { code: out, resolved }
}