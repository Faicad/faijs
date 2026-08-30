/**
 * faits — 浏览器执行器：Blob URL → import() 整段一次执行
 *
 * 浏览器侧被执行的模块若有裸说明符（`@faicad/faq/sdk` 等），由宿主页面的
 * importmap 解析（B 通道 ① 语义）；重写钩子负责把它改到宿主资源。
 */

/**
 * Execute module code once by importing it through a Blob URL, returning the
 * ES module namespace snapshot.
 * @param jsCode - the compiled, de-typed JavaScript module source to execute.
 * @returns the ES module namespace snapshot of the imported module.
 */
export async function executeFaqtsModuleInBrowser(jsCode: string): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(new Blob([jsCode], { type: 'text/javascript' }))
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  } finally {
    URL.revokeObjectURL(url)
  }
}