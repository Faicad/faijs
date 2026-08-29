/**
 * faits — Node 执行器（整段 import() 一次执行）
 *
 * Node 侧 import() 从 data:/blob: URL 开始无法解析其中的相对说明符
 * （vitest/实验已验证），因此落到唯一临时 `.mjs` 文件，经 file: URL
 * import 一次。文件位于系统 tmp，执行后立即清理。
 */

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

/** 将模块代码写入唯一临时 .mjs 并 import 一次，返回 ES 模块命名空间快照。 */
export async function executeFaqtsModuleInNode(jsCode: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'faqts-'))
  const file = join(dir, 'mod.mjs')
  writeFileSync(file, jsCode, 'utf-8')
  try {
    return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}