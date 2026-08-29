/**
 * faits（faqts）— `.ts` 源码整段执行（Phase D）
 *
 * 入口：@faicad/faijs/faqts
 *   Node 用：@faicad/faijs/faqts/node
 *   浏览器用：@faicad/faijs/faqts/browser
 *
 * 与 faq 录制管道（parseScript → plan → 逐语句执行）平行的第二条执行路径：
 * - `.ts` 整段一次执行（不建 IR、不逐语句、不接入 timeline）
 * - 输出由作者显式 export 声明（无 DAG 自动推导）
 * - 共享同一套 `cad` API 与 Shape 契约（与 faq 侧互通）
 *
 * 本入口导出纯逻辑：transform / imports / run（run 需要注入 execute 执行器）。
 * 环境特定执行器见 exec-node.ts（Node 临时 .mjs）与 exec-blob.ts（Blob URL）。
 */

export { transformFaqts } from './transform'
export type { FaqtsTransformOptions, FaqtsTransformResult } from './transform'
export { findImports, rewriteImports } from './imports'
export type { FaqtsImportSpan, FaqtsRewriteFn } from './imports'
export { runFaqts } from './run'
export type { FaqtsRunOptions, FaqtsRunResult, FaqtsModuleExecutor } from './run'
// 纯逻辑入口不挂执行器：Node/Browser 执行器见 ./node 与 ./browser 子路径，
// 避免浏览器侧静态引入 node:fs / node:os。