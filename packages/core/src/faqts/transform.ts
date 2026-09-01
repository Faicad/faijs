/**
 * faits — TypeScript 源码转译（Phase D, pipeline 第 1 步）
 *
 * 管线（plans/2026-08-29-faijs-module-runtime-plan.md §7.5）：
 *   .ts（faits 脚本） → 本模块：sucrase 去类型（保留行号）
 *   → acorn 解析 import → 说明符重写 → Blob → import() 整段执行
 *
 * 与 faijs 录制的 `.fai.js` 不同，faits 不建 IR、逐语句执行，而是
 * 整段一次性 import() 执行；DAG 活跃性不自动推导，输出由作者显式
 * export 声明（§7.5 行 723–724）。
 *
 * 此处只做"转译"，不含任何执行/几何依赖，Node 与浏览器通用。
 */

import { transform } from 'sucrase'

/**
 * Options controlling the TypeScript-to-JavaScript transform.
 */
export interface FaqtsTransformOptions {
  /** 是否启用 JSX 转译（默认 false：纯 TS） */
  jsx?: boolean
}

/**
 * The result of transforming TypeScript source to plain JavaScript module code.
 */
export interface FaqtsTransformResult {
  /** 去类型后的纯 JS 模块代码（行号与源文件保持一致） */
  code: string
}

/**
 * 去除 TypeScript 类型（保留行号），返回可在浏览器/Node 运行的模块代码。
 *
 * - 不生成 source map（行号保留，错误定位足够）
 * - 仅 `transforms: ['typescript']`；若脚本含 JSX 需显式开启 `jsx`
 */
/**
 * Strip TypeScript types (preserving line numbers) and return module code that
 * can run in the browser or Node. No source map is generated; only the
 * `typescript` transform runs unless `jsx` is explicitly enabled.
 * @param source - the TypeScript source text to transform.
 * @param options - transform options such as JSX enablement.
 * @returns the de-typed JavaScript module code.
 */
export function transformFaqts(source: string, options: FaqtsTransformOptions = {}): FaqtsTransformResult {
  const js = transform(source, {
    transforms: options.jsx ? ['typescript', 'jsx'] : ['typescript'],
  }).code
  return { code: js }
}