/**
 * faqts — Node 入口：@faicad/faijs/faqts/node
 *
 * 绑定 Node 执行器（临时 .mjs）。浏览器消费方务必从 .../faqts/browser 导入，
 * 避免静态引入 node:fs。
 */

import { runFaqts } from './run'
import { executeFaqtsModuleInNode } from './exec-node'
import type { FaqtsRunOptions, FaqtsRunResult } from './run'

export { transformFaqts } from './transform'
export type { FaqtsTransformOptions, FaqtsTransformResult } from './transform'
export { findImports, rewriteImports } from './imports'
export type { FaqtsImportSpan, FaqtsRewriteFn } from './imports'
export { runFaqts } from './run'
export type { FaqtsRunOptions, FaqtsRunResult } from './run'
export { executeFaqtsModuleInNode } from './exec-node'

/** Node 环境整段执行 `.ts` 源码的便捷入口。 */
export async function runFaqtsInNode(
  source: string,
  options: Omit<FaqtsRunOptions, 'execute'> = {},
): Promise<FaqtsRunResult> {
  return runFaqts(source, { ...options, execute: executeFaqtsModuleInNode })
}