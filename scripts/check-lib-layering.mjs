/**
 * check-lib-layering — fai_cq_warehouse 分层静态门禁（方案 §10，W8 落地）
 *
 * 规则（仅作用于 packages/fai_cq_warehouse 的 src/ 与 scripts/）：
 *  1. 禁止 `from 'occt-wasm'` / `initOcctWasm` —— 不得绕 host 注入直接消费内核；
 *  2. 禁止 `getGearKernel` —— 不得消费另一个第三方库（fai_cq_gears）的东西；
 *  3. `getBackends()` 只允许出现在 src/kernel.ts（其余文件必须经 requireKernel()）；
 *  4. 禁止 `as any`；
 *  5. 禁止 type-only import `occt-wasm` 的 `OcctKernel`。
 *
 * 命中任一规则即退出码 1（CI 红）。
 *
 * 用法：node scripts/check-lib-layering.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRoot = join(repoRoot, 'packages', 'fai_cq_warehouse')
const SCOPES = ['src', 'scripts'].map((d) => join(pkgRoot, d))
const KERNEL_FILE = 'kernel.ts'

const RULES = [
  { id: 'occt-wasm-import', re: /from\s+['"]occt-wasm['"]|import\s*\(\s*['"]occt-wasm['"]\s*\)/, files: null, msg: "不得 import 'occt-wasm'（内核须经 host 注入的 requireKernel()）" },
  // initOcctWasm 只允许 host 角色的 src/test-setup.ts（方案 §5.1 约束 2：库代码不初始化内核）
  { id: 'initOcctWasm', re: /\binitOcctWasm\b/, files: ['src/test-setup.ts'], msg: '不得调用 initOcctWasm（仅 host 角色 src/test-setup.ts 允许）' },
  { id: 'getGearKernel', re: /\bgetGearKernel\b/, files: null, msg: "不得消费 fai_cq_gears 的 getGearKernel（那是另一个第三方库的内部入口）" },
  { id: 'as-any', re: /\bas\s+any\b/, files: null, msg: '禁止 as any' },
  { id: 'occt-kernel-type', re: /\bOcctKernel\b/, files: null, msg: '禁止 type-only import occt-wasm 的 OcctKernel' },
]

/** 剥掉块注释/行注释/字符串字面量，避免文档性提及误报。 */
function stripCommentsAndStrings(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replaceAll(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replaceAll(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replaceAll(/[^\n]/g, ' '))
}

function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__pycache__') continue
      collectFiles(full, out)
    } else if (/\.(ts|mts|mjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const violations = []

for (const scope of SCOPES) {
  for (const file of collectFiles(scope)) {
    const rel = relative(pkgRoot, file).replaceAll('\\', '/')
    const code = stripCommentsAndStrings(readFileSync(file, 'utf-8'))
    for (const rule of RULES) {
      // files = 白名单：列出的文件豁免本规则（如 host 角色的 test-setup.ts）
      if (rule.files !== null && rule.files.includes(rel)) continue
      if (rule.re.test(code)) {
        violations.push(`${rel}: [${rule.id}] ${rule.msg}`)
      }
    }
    // 规则 3：getBackends 只允许在 src/kernel.ts
    if (rel !== `src/${KERNEL_FILE}` && /\bgetBackends\b/.test(code)) {
      violations.push(`${rel}: [getBackends-scope] getBackends() 只允许出现在 src/${KERNEL_FILE}，其余文件须经 requireKernel()`)
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-lib-layering] FAIL — ${violations.length} 处违规：`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log('[check-lib-layering] OK — fai_cq_warehouse 分层门禁通过')
