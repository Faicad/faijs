/**
 * 解析 node CPU profile：聚合各 JS 帧的自耗时（selfTime），排序输出 top 25。
 * 用于定位 buildAssemblySelectorManifest 里 1.2s 的隐藏热点（JS 帧可见，
 * wasm 内核内部不可见，但其桥接 JS 包装帧会现形）。
 */
const fs = require('node:fs')
const path = require('node:path')

const dir = process.argv[2]
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cpuprofile'))
if (files.length === 0) { console.error('no cpuprofile'); process.exit(1) }
const prof = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'))

// 帧 id → { name, url }
const nodes = prof.nodes
const frameById = new Map()
for (const n of nodes) frameById.set(n.id, n)

// selfTime：node.hitCount（抽样数）→ 时间 = hitCount * sampleInterval（微秒）
const sampleIntervalUs = prof.samples?.length ? (prof.timeDeltas ? 0 : 0) : 0
// node 4.x 输出：samples = 采样到的节点 id 序列，timeDeltas = 每个采样间隔（us）
const timeDeltas = prof.timeDeltas
const deltaUs = timeDeltas && timeDeltas.length > 0 ? timeDeltas[0] : 1000

const selfUs = new Map() // frameId → 总自耗时 us
for (let i = 0; i < prof.samples.length; i++) {
  const fid = prof.samples[i]
  const dt = timeDeltas ? timeDeltas[i] : deltaUs
  selfUs.set(fid, (selfUs.get(fid) ?? 0) + dt)
}

const rows = []
for (const [fid, us] of selfUs) {
  const frame = frameById.get(fid)
  if (!frame) continue
  const cf = frame.callFrame
  const name = cf.functionName || '(anon)'
  const url = (cf.url || '').split(/[\\/]/).pop() || ''
  rows.push({ name, url, line: cf.lineNumber, us })
}
rows.sort((a, b) => b.us - a.us)
const totalUs = rows.reduce((s, r) => s + r.us, 0)
console.log(`total sampled: ${(totalUs / 1e6).toFixed(2)}s (${prof.samples.length} samples, dt=${deltaUs}us)`)
console.log('--- top 25 self time ---')
for (const r of rows.slice(0, 25)) {
  console.log(`${(r.us / 1e3).toFixed(1).padStart(8)}ms  ${r.name}  ${r.url}:${r.line + 1}`)
}
