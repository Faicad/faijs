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

/**
 * Convenience entry point that runs `.ts` source end-to-end in a Node
 * environment, binding the Node module executor (temporary .mjs file).
 * @param source - the complete TypeScript source to execute as a module.
 * @param options - run options; the `execute` executor is supplied automatically.
 * @returns the run result containing the module namespace and explicit outputs.
 */
export async function runFaqtsInNode(
  source: string,
  options: Omit<FaqtsRunOptions, 'execute'> = {},
): Promise<FaqtsRunResult> {
  return runFaqts(source, { ...options, execute: executeFaqtsModuleInNode })
}