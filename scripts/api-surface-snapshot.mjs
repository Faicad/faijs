/**
 * api-surface-snapshot — dump the runtime export surface of all @faicad/faijs
 * subpaths into scripts/api-surface-snapshot.json (P0 baseline).
 *
 * 用途：monorepo 迁移期间与之后，比对「公开导出面」不漂移（P5/P6 验收：
 * npm run build 产物的导出面与 P0 快照逐字一致，9 个子路径全比对）。
 *
 * 只捕获**运行时值导出**（export type 不可见）；类型面由 typecheck 兜底。
 * 先 `npm run build` 生成最新 dist，再运行本脚本：
 *   node scripts/api-surface-snapshot.mjs
 */
import { writeFileSync } from 'node:fs'

// core package.json exports 的**具体（可整体 import）键**（P6 起取消 ./stdlib
// 子路径；D2-A 起 facade 折入 core；2026-09-20 的 ./fcstd 读层已于后续移除，
// 2026-09-25 重拍基线对齐当前 28 键中可 import 的 18 个；通配键
// ./api/*、./mesh/*、./brep/*、./topology/* 等不可整体 import，不列入）。
const SUBPATHS = [
  '.', './api', './api/brepjs-compat', './brepjs-compat',
  './sdk', './symbol-table', './csg', './sdf', './node', './browser',
  './weapp', './runtime-state', './identity', './shape', './module-resolver',
  './mesh', './topology/naming', './env-agnostic', './units',
]

const snapshot = {}
for (const sub of SUBPATHS) {
  // './browser' → '@faicad/faijs/browser'；'.' → '@faicad/faijs'
  const spec = sub === '.' ? '@faicad/faijs' : `@faicad/faijs${sub.slice(1)}`
  try {
    const mod = await import(spec)
    snapshot[sub] = Object.keys(mod).filter((k) => k !== 'default').sort()
  } catch (e) {
    snapshot[sub] = { error: String(e?.message ?? e) }
  }
}

const out = new URL('./api-surface-snapshot.json', import.meta.url)
writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')

const failed = SUBPATHS.filter((s) => typeof snapshot[s] !== 'object' || Array.isArray(snapshot[s]) === false)
console.log(`[api-surface-snapshot] written ${SUBPATHS.length} subpaths -> scripts/api-surface-snapshot.json`)
if (failed.length > 0) {
  console.error(`[api-surface-snapshot] FAILED subpaths: ${failed.join(', ')}`)
  process.exitCode = 1
}
