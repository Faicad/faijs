/**
 * check-dist-sync — faijs dist 脱节守卫（A5 / M4）。
 *
 * 真源是 `packages/core/src/lang/symbol-table.generated.ts`（由
 * `packages/core/scripts/gen-symbol-table.ts` 从 api-namespace 的 cad 命名空间生成，
 * **入库**）；`packages/core/dist/**` 是 *构建产物*（gitignored，不入库）。下游若直接
 * import 已构建包去枚举 op（v1 勘误 M4 就是这么踩的：读 dist 得到的是 stale 清单，
 * 比源码少 34 个 op，于是误判「faijs 不具备 applyMatrix / mirror / extrude …」）。
 *
 * 本守卫在「构建之后」比对 src 符号表键集与 dist 符号表键集：
 *   - dist 缺失 → 无可比对象，打印提示并以 0 退出（fresh checkout / 未构建的本地
 *     环境本就不会有 dist，构建会重新生成，无需在此拦截）。
 *   - 两者键集不一致（源码有而 dist 缺 / dist 有而源码多）→ 打印 diff 并以 1 退出，
 *     CI 在 publish 前拦下这种「构建产物落后于源码」的脱节。
 *   - 一致 → 0 退出。
 *
 * 用法：node scripts/check-dist-sync.mjs [--self-test]
 * 退出码：0 = 通过 / 无可比对象；1 = 脱节（或守卫自身空转）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(repoRoot, 'packages/core/src/lang/symbol-table.generated.ts')
const DIST = join(repoRoot, 'packages/core/dist/lang/symbol-table.generated.js')

/** 从源码生成文件抽取符号表键（与 gen-symbol-table 产物形态对齐：每行 `"name": {}`）。 */
function srcKeys() {
  const text = readFileSync(SRC, 'utf8')
  const re = /^\s+"([A-Za-z_][A-Za-z0-9_]*)":\s*\{\}/gm
  const out = []
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

/** 从构建产物抽取符号表键（default export 是 `{ name: {} }` 字面量）。 */
async function distKeys() {
  const mod = await import(pathToFileURL(DIST).href)
  return Object.keys((mod.default ?? mod) || {})
}

/** src 有 / dist 缺、dist 有 / src 多 的双向 diff。 */
function diffKeys(a, b) {
  const setB = new Set(b)
  const setA = new Set(a)
  const missing = a.filter((k) => !setB.has(k)) // 源码有、dist 没有
  const extra = b.filter((k) => !setA.has(k)) // dist 有、源码没有
  return { missing, extra }
}

function fail(msg) {
  console.error('check-dist-sync: ' + msg)
  process.exit(1)
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const code = selfTest()
    console.log(code === 0 ? 'check-dist-sync: self-test passed' : 'check-dist-sync: self-test FAILED')
    process.exit(code)
  }

  if (!existsSync(SRC)) fail(`源码符号表缺失：${SRC}`)
  const src = srcKeys()
  // 守卫本身不可空转：源码键集为空意味着正则/抽取逻辑坏了，必须主动失败。
  if (src.length === 0) fail(`源码符号表为空（守卫不可空转）：${SRC}`)

  if (!existsSync(DIST)) {
    console.log(`check-dist-sync: dist 产物不存在（${DIST}）—— 跳过比对，构建会重新生成，不拦截。`)
    process.exit(0)
  }

  const dist = await distKeys()
  const { missing, extra } = diffKeys(src, dist)
  if (missing.length || extra.length) {
    const lines = [`dist 与源码符号表脱节（src ${src.length} / dist ${dist.length}）：`]
    if (missing.length) lines.push(`  源码有、dist 缺 ${missing.length} 个：${missing.join(' ')}`)
    if (extra.length) lines.push(`  dist 有、源码多 ${extra.length} 个：${extra.join(' ')}`)
    lines.push('  修复：在仓库根运行 `npm run build`（重建 dist），再重新发布。')
    fail(lines.join('\n'))
  }
  console.log(`check-dist-sync: 通过（src 与 dist 符号表均为 ${src.length} 键）。`)
}

/**
 * 规则引擎自测：在合成键集上钉死 pass/fail 边界（仿 check-lockstep --self-test），
 * 证明 diff 逻辑不是「永远通过」。
 * @returns {0|1} 0 = 全部预期命中；1 = 有 case 偏离预期。
 */
function selfTest() {
  const cases = [
    { title: '一致 → 通过', src: ['a', 'b', 'c'], dist: ['a', 'b', 'c'], expect: 0 },
    { title: 'dist 缺键 → 失败', src: ['a', 'b', 'c'], dist: ['a', 'b'], expect: 1 },
    { title: 'dist 多键 → 失败', src: ['a', 'b'], dist: ['a', 'b', 'c'], expect: 1 },
    { title: 'dist 完全为空 → 失败', src: ['a', 'b'], dist: [], expect: 1 },
    { title: '顺序不同但集合相同 → 通过', src: ['a', 'b', 'c'], dist: ['c', 'a', 'b'], expect: 0 },
  ]
  let failed = 0
  for (const c of cases) {
    const { missing, extra } = diffKeys(c.src, c.dist)
    const got = missing.length || extra.length ? 1 : 0
    if (got !== c.expect) {
      failed++
      console.error(`  ✗ ${c.title}（期望 ${c.expect}，得到 ${got}）`)
    } else {
      console.log(`  ✓ ${c.title}`)
    }
  }
  return failed === 0 ? 0 : 1
}

main()
