/**
 * runtime-env — 运行环境检测
 *
 * 判断当前是否在浏览器（web）环境运行。
 */

export function isWebRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined'
}
