/**
 * faits — 浏览器入口：@faicad/faijs/faqts/browser
 *
 * 绑定 Blob 执行器（Blob URL → import）。不含任何 Node 专属依赖。
 */

export { transformFaqts } from './transform'
export type { FaqtsTransformOptions, FaqtsTransformResult } from './transform'
export { findImports, rewriteImports } from './imports'
export type { FaqtsImportSpan, FaqtsRewriteFn } from './imports'
export { runFaqts } from './run'
export type { FaqtsRunOptions, FaqtsRunResult } from './run'
export { executeFaqtsModuleInBrowser } from './exec-blob'
import { executeFaqtsModuleInBrowser } from './exec-blob'
import type { FaqtsModuleExecutor } from './run'

/** The browser-bound module executor: executes compiled module code via a Blob URL import. */
export const faqtsBrowserExecutor: FaqtsModuleExecutor = executeFaqtsModuleInBrowser