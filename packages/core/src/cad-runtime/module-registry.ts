/**
 * module-registry — 多文件模块注册表（§4.5 / A-8/A-9/A-10）
 *
 * 无 IR 通道的多文件装载：主模块（runtime 直接执行）的顶层相对 import
 * （`import { bp } from './x.fai.js'`）指向项目内其它 `.fai.js` 模块。
 * 每个依赖模块用**独立 ctx** 执行（经注入的 ModuleRunner），产出导出面：
 * - values：模块存活 ctx 键中的 shape/常量（非函数）；
 * - fns：模块内顶层函数；
 * - liveShapes：computeLiveShapes 对该模块自身的存活终端（模块内消费判定生效——
 *   A-9：A 内被消费的 shape 不在 liveShapes → B 引用报错）。
 *
 * 名字契约（D6）：A 的 LHS 名 = 导出名；B 的 import 绑定名 = 引用名；绑定必须 ∈
 * A.liveShapes ∪ A.fns（A-8 缺失导出名 → ModuleRegistryError）。跨文件引用 ≠ 消费：
 * B 引用 A 的 shape 不影响 A 的 liveShapes（A 单独执行时计算）。
 *
 * 装载：DFS 递归（相对 specifier → moduleKey 归一 → readSource → 提取其 import →
 * 先装依赖 → 带 seed 执行自身）；循环依赖 → MODULE_CYCLE（failedAt 带环路径）。
 * 本实现每次调用重建缓存（execute/append 各轮全量重读重执行；fingerprint 增量缓存
 * 留作 v2）。
 */

import { extractMetadata } from '../lang/metadata-extractor'
import type { UiMetadata } from '../lang/metadata-extractor'
import { assertSecure, type SecurityPolicy, S6_MAX_DEPTH, S6_MAX_MODULES } from '../lang/security-scanner'
import { computeLiveShapes, type KeepRegistration } from './live-shapes'
import type { ExecKeepRecord } from './direct-executor'
import type { ProjectLoader } from './ports'
import { asPartName, type PartName } from '../identity'
import { ParseError } from '../lang/parse-error'

// ── 导出类型 ──

/** 模块导出面（§4.5 FaiModuleExports）。 */
export interface FaiModuleExports {
  /** 存活 shape + 常量（params）——ctx 非函数键 */
  values: Record<string, unknown>
  /** 顶层函数（ctx 函数键） */
  fns: Record<string, (...a: unknown[]) => unknown>
  /** 存活 shape 名（引用校验；模块内消费生效） */
  liveShapes: Set<string>
}

/** 已装载模块。 */
export interface FaiModule {
  key: string
  exports: FaiModuleExports
}

/** 模块执行视图（ModuleRunner 返回；DirectExecutor 满足该形状）。 */
export interface ModuleRunResult {
  listCtxKeys(): string[]
  getCtxVar(name: string): unknown
  listKeepLines(): number[]
  getKeepByLine(lineNo: number): ExecKeepRecord | undefined
}

/** 模块执行回调：独立 ctx 执行模块源码（imports = 该模块自己的 seed）。 */
export type ModuleRunner = (code: string, imports: Record<string, unknown>) => Promise<ModuleRunResult>

/** 多文件装载错误码（runtime 归并为 ExecutionResult.failedAt）。 */
export type ModuleRegistryErrorCode =
  | 'MODULE_NOT_FOUND'
  | 'MODULE_CYCLE'
  | 'MODULE_EXEC_FAILED'
  | 'BINDING_NOT_EXPORTED'
  | 'MODULE_SECURITY'
  | 'MODULE_DEPTH_EXCEEDED'
  | 'MODULE_COUNT_EXCEEDED'

/** 多文件装载错误（带 lineNo/callee，供 failedAt 定位 import 行）。 */
export class ModuleRegistryError extends Error {
  /** 错误码（MODULE_NOT_FOUND / MODULE_CYCLE / MODULE_EXEC_FAILED / BINDING_NOT_EXPORTED）。 */
  readonly code: ModuleRegistryErrorCode
  /** import 行号（failedAt.lineNo 定位用；可选）。 */
  readonly lineNo?: number
  /** 绑定名 / callee（failedAt.callee 用；可选）。 */
  readonly callee?: string
  constructor(code: ModuleRegistryErrorCode, message: string, info?: { lineNo?: number; callee?: string }) {
    super(message)
    this.name = 'ModuleRegistryError'
    this.code = code
    this.lineNo = info?.lineNo
    this.callee = info?.callee
  }
}

// ── 路径归一 ──

/**
 * 相对 specifier 判定（'./x' / '../x' / '/x'；裸 specifier = libLoader 通道，不在此）。
 * @param specifier - import 说明符。
 * @returns 该 specifier 是否指向项目内相对路径模块。
 */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
}

/**
 * 相对 specifier → moduleKey（POSIX 斜杠归一 + ./.. 段消解；相对 baseKey 目录）。
 * @param specifier - import 说明符（如 './bp.fai.js'）。
 * @param baseKey - 所在模块的 moduleKey（取其目录为解析基准）；主模块可省。
 * @returns 归一后的 moduleKey（与 loader.listModules() 精确匹配）。
 */
export function normalizeModuleKey(specifier: string, baseKey?: string): string {
  const spec = specifier.replace(/\\/g, '/')
  const baseDir = baseKey && baseKey.includes('/')
    ? baseKey.slice(0, baseKey.lastIndexOf('/') + 1)
    : ''
  // 绝对形态（/x）不拼 baseDir；相对形态按 baseKey 目录解析
  const combined = spec.startsWith('/') ? spec.slice(1) : `${baseDir}${spec}`
  const segs: string[] = []
  for (const seg of combined.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      segs.pop()
      continue
    }
    segs.push(seg)
  }
  return segs.join('/')
}

// ── ModuleRegistry ──

/**
 * 多文件模块注册表：装载/导出/绑定校验。每次调用实例化（缓存仅存活单轮装载）。
 */
export class ModuleRegistry {
  private cache = new Map<string, FaiModule>()
  private loadCount = 0

  constructor(
    private readonly loader: ProjectLoader,
    private readonly run: ModuleRunner,
    private readonly securityPolicy: SecurityPolicy = 'strict',
  ) {}

  /**
   * 装载 import 表对应的全部依赖并返回 seed（绑定名 → 值）。
   * @param imports - 顶层 import 条目（UiMetadata.imports 同构）。
   * @param baseKey - 所在模块的 moduleKey（相对 specifier 解析基准）；主模块无 key。
   * @returns seed map（供 DirectExecutor opts.imports / params 预置 ctx）。
   * @throws ModuleRegistryError — 环 / 模块缺失 / 依赖执行失败 / 绑定未导出。
   */
  /**
   * 装载 import 表对应的全部依赖并返回 seed（绑定名 → 值）。
   * @param imports - 顶层 import 条目（UiMetadata.imports 同构）。
   * @param baseKey - 所在模块的 moduleKey（相对 specifier 解析基准）；主模块无 key。
   * @param stack - 循环依赖检测栈（内部递归使用；外部调用缺省 []）。
   * @returns seed map（供 DirectExecutor opts.imports / params 预置 ctx）。
   * @throws ModuleRegistryError — 环 / 模块缺失 / 依赖执行失败 / 绑定未导出。
   */
  async resolveImports(
    imports: UiMetadata['imports'],
    baseKey?: string,
    stack: string[] = [],
  ): Promise<Record<string, unknown>> {
    const seed: Record<string, unknown> = {}
    for (const imp of imports ?? []) {
      if (!isRelativeSpecifier(imp.specifier)) continue // 裸 specifier → libLoader 通道
      const depKey = normalizeModuleKey(imp.specifier, baseKey)
      const dep = await this.load(depKey, stack)
      if (imp.kind === 'namespace' || imp.kind === 'default') {
        if (imp.localName) seed[imp.localName] = this.namespaceView(dep)
        continue
      }
      // named：每个绑定分别校验
      for (const binding of imp.bindings) {
        const value = this.resolveBinding(binding, dep, imp.lineNo)
        if (value !== undefined) seed[binding] = value
      }
    }
    return seed
  }

  /** 装载并执行单个模块（递归装其依赖；缓存本装载轮）。 */
  private async load(key: string, stack: string[]): Promise<FaiModule> {
    const cached = this.cache.get(key)
    if (cached) return cached
    if (stack.includes(key)) {
      throw new ModuleRegistryError(
        'MODULE_CYCLE',
        `module cycle detected: ${[...stack, key].join(' -> ')}`,
      )
    }
    // S6：装载深度上限
    if (stack.length >= S6_MAX_DEPTH) {
      throw new ModuleRegistryError(
        'MODULE_DEPTH_EXCEEDED',
        `module loading depth exceeded ${S6_MAX_DEPTH} (stack: ${stack.join(' -> ')})`,
      )
    }
    // S6：模块总数上限
    if (this.loadCount >= S6_MAX_MODULES) {
      throw new ModuleRegistryError(
        'MODULE_COUNT_EXCEEDED',
        `total module count exceeded ${S6_MAX_MODULES} limit`,
      )
    }
    const available = this.loader.listModules()
    if (!available.includes(key)) {
      throw new ModuleRegistryError(
        'MODULE_NOT_FOUND',
        `module "${key}" not found in project (available: ${available.length > 0 ? available.join(', ') : 'none'})`,
      )
    }
    const source = await this.loader.readSource(key)
    // A3：子模块安全扫描前置（固定 strict；违规 → MODULE_SECURITY）
    try {
      assertSecure(source, {
        policy: 'strict',
        knownNames: ['cad'],
        defaultNs: 'cad',
      })
    } catch (err) {
      if (err instanceof ParseError) {
        throw new ModuleRegistryError(
          'MODULE_SECURITY',
          `module "${key}" failed security check: ${err.message}`,
          { lineNo: err.line, callee: key },
        )
      }
      throw err
    }
    this.loadCount++
    const meta = extractMetadata(source, { security: 'strict' })
    const seed = await this.resolveImports(meta.imports ?? [], key, [...stack, key])
    const result = await this.run(source, seed) // 执行失败 → runner 抛 ModuleRegistryError
    const module = { key, exports: this.buildExports(meta, result) }
    this.cache.set(key, module)
    return module
  }

  private buildExports(meta: UiMetadata, result: ModuleRunResult): FaiModuleExports {
    const values: Record<string, unknown> = {}
    const fns: Record<string, (...a: unknown[]) => unknown> = {}
    const shapeVarNames = new Set<PartName>()
    for (const name of result.listCtxKeys()) {
      const v = result.getCtxVar(name)
      if (v === undefined) continue
      if (typeof v === 'function') {
        fns[name] = v as (...a: unknown[]) => unknown
      } else {
        values[name] = v
        if (v !== null && typeof v === 'object' && ('positions' in v || 'children' in v)) {
          shapeVarNames.add(asPartName(name))
        }
      }
    }
    // 模块自身的存活终端：函数体 keep 登记读 ModuleRunResult（DirectExecutor.keepByLine）
    const terminals = computeLiveShapes({
      lines: meta.lines,
      blocks: meta.blocks,
      keep: {
        lineEntries: (lineNo) => meta.keep.get(lineNo),
        functionBody: (lineNo): KeepRegistration | undefined => result.getKeepByLine(lineNo),
      },
      shapeVarNames,
    })
    const liveShapes = new Set<string>(terminals.map((t) => String(t.id)))
    return { values, fns, liveShapes }
  }

  /** named 绑定解析：liveShapes ∪ fns；缺失 → BINDING_NOT_EXPORTED。 */
  private resolveBinding(binding: string, dep: FaiModule, lineNo: number): unknown | undefined {
    if (dep.exports.liveShapes.has(binding)) return dep.exports.values[binding]
    if (Object.prototype.hasOwnProperty.call(dep.exports.fns, binding)) return dep.exports.fns[binding]
    throw new ModuleRegistryError(
      'BINDING_NOT_EXPORTED',
      `"${binding}" is not exported by module "${dep.key}" (live shapes: ${[...dep.exports.liveShapes].join(', ') || 'none'})`,
      { lineNo, callee: binding },
    )
  }

  /** 命名空间/默认 import 的模块视图：values + fns。 */
  private namespaceView(dep: FaiModule): Record<string, unknown> {
    return { ...dep.exports.values, ...dep.exports.fns }
  }
}
