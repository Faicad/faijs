/**
 * module-resolver — 运行时模块解析（channel ③，V5.2）
 *
 * 设计文档：
 * - docs/plans/2026-08-29-faijs-module-runtime-plan.md §4.1（通道③）、§5.3
 * - docs/plans/2026-08-28-faijs-ecosystem-roadmap.md §10 V5.2（多版本 scopes）
 *
 * 本文件实现**极小 semver 判定子集**，用于 V5.2 版本仲裁的"范围不匹配即抛错"
 * （roadmap 验收 ③：版本校验失败必须明确报错、不静默、不降级）。
 *
 * 支持：
 * - 精确 `1.2.3`；前缀 `1.2` / `1`（major/minor 相等）
 * - caret `^1.2.3`（>=1.2.3 <2.0.0）、`^1.2`（>=1.2.0 <2.0.0）、`^1`（>=1.0.0 <2.0.0）
 *   `^0.2.3`（>=0.2.3 <0.3.0）、`^0.0.3`（>=0.0.3 <0.0.4）
 * - tilde `~1.2.3`（>=1.2.3 <1.3.0）、`~1.2`（>=1.2.0 <1.3.0）、`~1`（>=1.0.0 <2.0.0）
 * - 比较 `>=`、`>`、`<=`、`<`、`=`（v1.2.3 兼容前导 v）
 * - 区间 `1.2.3 - 2.0.0`（>= a && <= b）
 * - 通配 `*`、`x`、`latest`、空 → 恒真
 * - `||` / 空格组合的"或"
 *
 * 注意：这是**刻意极小**的子集（引擎不用完整 npm semver），只覆盖 roadmap
 * 需要的面；遇到不认识的语法按"不匹配"处理（宁可报错也不静默通过）。
 */

export type ParsedVersion = [major: number, minor: number | null, patch: number | null]

export function parseVersion(input: string | undefined | null): ParsedVersion | null {
  if (!input || typeof input !== 'string') return null
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(input.trim())
  if (!m) return null
  return [Number(m[1]), m[2] === undefined ? null : Number(m[2]), m[3] === undefined ? null : Number(m[3])]
}

function padVersion(v: ParsedVersion): [number, number, number] {
  return [v[0], v[1] ?? 0, v[2] ?? 0]
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const pa = padVersion(a)
  const pb = padVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

function samePrefix(a: ParsedVersion, b: ParsedVersion): boolean {
  // a 是前缀要求（missing minor = 只看 major），b 是实际版本
  if (a[0] !== b[0]) return false
  if (a[1] === null) return true
  if (a[1] !== b[1]) return false
  if (a[2] === null) return true
  return a[2] === b[2]
}

type Cmp = '<' | '<=' | '>' | '>=' | '='
type Part = { cmp: Cmp; v: ParsedVersion }

function caretBounds(spec: ParsedVersion): Part[] {
  const major = spec[0]
  const minor = spec[1] ?? 0
  const patch = spec[2] ?? 0
  if (major > 0) {
    return [
      { cmp: '>=', v: [major, minor, patch] },
      { cmp: '<', v: [major + 1, 0, 0] },
    ]
  }
  if (minor > 0) {
    return [
      { cmp: '>=', v: [0, minor, patch] },
      { cmp: '<', v: [0, minor + 1, 0] },
    ]
  }
  return [
    { cmp: '>=', v: [0, 0, patch] },
    { cmp: '<', v: [0, 0, patch + 1] },
  ]
}

function tildeBounds(spec: ParsedVersion): Part[] {
  const major = spec[0]
  const minor = spec[1] ?? 0
  const patch = spec[2] ?? 0
  if (spec[1] === null) {
    return [
      { cmp: '>=', v: [major, 0, 0] },
      { cmp: '<', v: [major + 1, 0, 0] },
    ]
  }
  return [
    { cmp: '>=', v: [major, minor, patch] },
    { cmp: '<', v: [major, minor + 1, 0] },
  ]
}

function check(cmp: Cmp, version: ParsedVersion, v: ParsedVersion): boolean {
  const c = compareVersions(version, v)
  switch (cmp) {
    case '<': return c < 0
    case '<=': return c <= 0
    case '>': return c > 0
    case '>=': return c >= 0
    case '=':
    default: return c === 0
  }
}

function parseCompPair(input: string): { ver: ParsedVersion; opRaw: string } | null {
  const m = /^(<=|>=|<|>|=)?\s*(.*)$/.exec(input)
  if (!m) return null
  const opRaw = m[1] ?? ''
  const rest = m[2].trim()
  const ver = parseVersion(rest)
  if (!ver) return null
  return { ver, opRaw }
}

/** 计算单个比较段是否满足。 */
function partSatisfies(partStr: string, version: ParsedVersion): boolean {
  const s = partStr.trim()
  if (s === '' || s === '*' || s === 'x' || /^x(\.x){0,2}$/i.test(s) || /^latest$/i.test(s)) return true

  // caret / tilde 段
  const caretM = /^\^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(s)
  if (caretM) {
    const spec: ParsedVersion = [
      Number(caretM[1]),
      caretM[2] === undefined ? null : Number(caretM[2]),
      caretM[3] === undefined ? null : Number(caretM[3]),
    ]
    return caretBounds(spec).every((b) => check(b.cmp, version, b.v))
  }
  const tildeM = /^~v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(s)
  if (tildeM) {
    const spec: ParsedVersion = [
      Number(tildeM[1]),
      tildeM[2] === undefined ? null : Number(tildeM[2]),
      tildeM[3] === undefined ? null : Number(tildeM[3]),
    ]
    return tildeBounds(spec).every((b) => check(b.cmp, version, b.v))
  }

  const pair = parseCompPair(s)
  if (!pair) return false
  if (pair.opRaw === '') return samePrefix(pair.ver, version) // 裸数字前缀
  return check(pair.opRaw as Cmp, version, pair.ver)
}

/** 极简 semver satisfies。 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version)
  if (!v) return false
  const r = (range ?? '').trim()
  if (r === '' || r === '*' || r === 'x' || /^x(\.x){0,2}$/i.test(r) || /^latest$/i.test(r)) return true

  // 区间 "a.b.c - d.e.f"
  const dashParts = r.split(/\s*-\s*/)
  if (dashParts.length === 2 && parseVersion(dashParts[0]) && parseVersion(dashParts[1])) {
    const lo = parseVersion(dashParts[0])!
    const hi = parseVersion(dashParts[1])!
    return compareVersions(v, lo) >= 0 && compareVersions(v, hi) <= 0
  }

  // "||" 或空格分隔的"或"段：满足任一即可
  const segs = r.split(/\s*\|\|\s*|\s+/).filter((x) => x.length > 0)
  if (segs.length === 0) return false
  return segs.some((seg) => partSatisfies(seg, v))
}

/** 版本校验（验收③）：不满足必须抛错，不降级。 */
export function assertSatisfies(version: string, range: string, what = 'dependency'): void {
  if (!satisfies(version, range)) {
    throw new Error(`[module-resolver] ${what} version "${version}" does not satisfy required range "${range}"`)
  }
}