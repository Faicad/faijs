/**
 * api-surface-snapshot — dump the runtime export surface of all @faicad/faijs
 * subpaths into scripts/api-surface-snapshot.json (P0 baseline).
 *
 * 用途：比对「公开导出面」不漂移（npm run build 产物的导出面与入库快照逐字一致，
 * SUBPATHS 列出的子路径全比对）。
 *
 * 只捕获**运行时值导出**（export type 不可见）；类型面由 typecheck 兜底。
 * 先 `npm run build` 生成最新 dist，再运行本脚本：
 *   node scripts/api-surface-snapshot.mjs
 */
import { writeFileSync } from 'node:fs'

// 参与快照的**可整体 import 的子路径**（D2-A 起 facade 折入 core；2026-09-20 的
// ./fcstd 读层已于后续移除）。本数组是快照的覆盖范围，**不是** package.json
// exports 的镜像：通配键（./api/*、./mesh/*、./brep/*、./topology/* 等）不可整体
// import，不列入；两者本就不等长，禁止互相反推。
// 纪律：package.json 删掉某个具体子路径时，必须同步从本数组移除，否则该子路径
// import 失败会让本脚本以非 0 退出（CI 5/9 因此报红）。
const SUBPATHS = [
  '.', './api',
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
