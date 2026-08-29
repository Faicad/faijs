/**
 * faits — 浏览器执行器：Blob URL → import() 整段一次执行
 *
 * 浏览器侧被执行的模块若有裸说明符（`@faicad/faq/sdk` 等），由宿主页面的
 * importmap 解析（B 通道 ① 语义）；重写钩子负责把它改到宿主资源。
 */

/** 将模块代码经 Blob URL import 一次，返回 ES 模块命名空间快照。 */
export async function executeFaqtsModuleInBrowser(jsCode: string): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(new Blob([jsCode], { type: 'text/javascript' }))
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  } finally {
    URL.revokeObjectURL(url)
  }
}