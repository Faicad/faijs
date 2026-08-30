/**
 * faits — 整段执行 Runner（Phase D, pipeline 第 4–5 步）
 *
 *   已去类型 + 说明符重写的模块代码
 *   → 执行器（浏览器 Blob URL / Node 临时 .mjs）import()
 *   → 收集显式声明的输出（export default / 具名 export）
 *
 * faq 与 faits 差异（plan §7.5 行 720–725）：
 *   faq → 逐语句 append/update/plan、DAG 自动推导、一行一 timeline
 *   faits → 整段一次执行、**显式声明输出**（无 DAG 自动推导）、不参与 timeline
 *
 * 输出约定：作者通过 `export default {part0: …, part1: …}` 或具名 export
 * 显式声明哪些产物是输出（由于无 IR，引擎不会猜测终端集）。本 runner 返回
 * 模块命名空间，并把 export default（若为对象）平铺为命名输出。
 *
 * 本文件无任何 Node 专属依赖：执行器（execute）由浏览器 Blob / Node 临时
 * 文件实现注入，见 exec-blob.ts / exec-node.ts。
 */

import { transformFaqts } from './transform'
import { rewriteImports } from './imports'
import type { FaqtsRewriteFn } from './imports'

/** 将"已转译 + 已重写"的模块代码执行一次，返回 ES 模块命名空间快照。 */
export type FaqtsModuleExecutor = (jsCode: string) => Promise<Record<string, unknown>>

/**
 * Options controlling one full-module run through `runFaqts`.
 */
export interface FaqtsRunOptions {
  /** 导入重写钩子（裸说明符 → 宿主可解析的 URL）；默认保留。 */
  rewrite?: FaqtsRewriteFn
  /** 相对说明符绝对化的基准 URL（默认取 process.cwd() + '/'） */
  baseURL?: string | URL
  /** 转译选项透传（jsx 等） */
  transform?: { jsx?: boolean }
  /** 模块执行器；默认未注入，由入口（browser/node）提供 */
  execute?: FaqtsModuleExecutor
}

/**
 * The outcome of executing one module: the full namespace plus the outputs the
 * author explicitly declared via `export default { ... }` and named exports.
 */
export interface FaqtsRunResult {
  /** 已执行的 ES 模块命名空间 */
  namespace: Record<string, unknown>
  /** 显式输出：export default 为对象 → 展开；否则作为 default；具名 export 并入 */
  outputs: Record<string, unknown>
}

/**
 * 将完整的 `.ts` 源码作为单个 ES 模块执行一次。
 *
 * - 不建 IR、不逐语句执行、不接入 timeline
 * - 每次调用执行一份全新模块实例（执行器唯一 blob/temp 路径）
 */
/**
 * Execute the complete `.ts` source as a single ES module once. No IR is
 * built, statements are not executed one by one, and no timeline is involved;
 * each call runs a fresh module instance.
 * @param source - the complete TypeScript source to execute.
 * @param options - run options including the mandatory `execute` executor.
 * @returns the run result with the module namespace and explicit outputs.
 */
export async function runFaqts(source: string, options: FaqtsRunOptions = {}): Promise<FaqtsRunResult> {
  if (typeof options.execute !== 'function') {
    throw new Error('runFaqts: 缺少 execute 执行器（浏览器用 exec-blob，Node 用 exec-node）')
  }
  const js = transformFaqts(source, options.transform).code
  const base = options.baseURL ?? (typeof process !== 'undefined' ? process.cwd() + '/' : undefined)
  const code = rewriteImports(js, { rewrite: options.rewrite, baseURL: base })
  const namespace = await options.execute(code)
  return { namespace, outputs: collectOutputs(namespace) }
}

/** 显式输出收集：export default 是对象 → 展开为具名输出；否则作为 default。 */
function collectOutputs(ns: Record<string, unknown>): Record<string, unknown> {
  const outputs: Record<string, unknown> = {}
  const def = ns['default']
  if (def !== undefined && def !== null && typeof def === 'object' && !Array.isArray(def)) {
    Object.assign(outputs, def)
  } else if (def !== undefined) {
    outputs.default = def
  }
  for (const key of Object.keys(ns)) {
    if (key === 'default') continue
    outputs[key] = ns[key]
  }
  return outputs
}