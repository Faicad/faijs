/**
 * projection-overrides — P2 例外覆盖表（唯一人工维护点）。
 *
 * 设计文档：docs/plans/2026-09-07-compat-surface-unified-projection.md §5.4 / §9.1
 *
 * 规模目标：约 60~80 条（对比现状 866 条手工表，维护量下降 ~90%）。
 * 每条 `exported` 条目必须有非 `unknown` 的 `semantics` 值（§8 验收 9）。
 */

export interface Override {
  kind?: 'type' | 'pure' | 'query' | 'brep-op' | 'skip'
  wrap?: 'raw' | 'guard' | 'dual' | 'custom'
  semantics?: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'ok' | 'unknown'
  /** wrap === 'custom' 时必填：手写适配器模块名 */
  adapter?: string
  /** D11 参数名表（对象形态 → 位置形态） */
  params?: string[]
  /** 脚本面准入（§5.3 第四层） */
  scriptFace?: boolean
  /** faijs 同名冲突时的导出名 */
  rename?: string
  /** 指定 vendored 源文件 */
  source?: string
  /** 必填：为什么这条不能被规则推导 */
  note: string
}

/**
 * The exception override table (§5.4). Each entry overrides the classifier's
 * automatic derivation for a specific symbol. Keys are symbol names.
 * Entries with `semantics: 'unknown'` are forbidden from `exported` status (§8 ⑨).
 */
export const OVERRIDES: Record<string, Override> = {
  // ── §3.6 手写面独有逻辑（4 类）──
  box: {
    wrap: 'custom',
    adapter: 'box-adapter',
    source: 'topology/primitiveFns.js',
    semantics: 'ok',
    note: '§3.6: {size} object form + custom E_ARGS_FORM',
  },
  rotate: {
    wrap: 'custom',
    adapter: 'rotate-adapter',
    source: 'topology/transformFns.js',
    semantics: 'ok',
    note: '§3.6: upstream-18 {at,axis} options adapter (not transformFns four-arg positional)',
  },
  cylinder: {
    wrap: 'raw',
    semantics: 'ok',
    note: 'P25: library authors want raw morph form (no kernel assert)',
  },
  sphere: {
    wrap: 'raw',
    semantics: 'ok',
    note: 'P25: same as cylinder — raw morph form',
  },

  // ── §2.2 包装项（15 个已由 P1 从 compat-ast 解析，覆盖表只补充语义分级） ──
  cone: {
    wrap: 'dual',
    params: ['bottomRadius', 'topRadius', 'height'],
    semantics: 'ok',
    note: '§2.2: wrapDual — kernel assert + D11 dual form',
  },
  torus: {
    wrap: 'dual',
    params: ['majorRadius', 'minorRadius'],
    semantics: 'ok',
    note: '§2.2: wrapDual',
  },
  ellipsoid: {
    wrap: 'dual',
    params: ['rx', 'ry', 'rz'],
    semantics: 'ok',
    note: '§2.2: wrapDual',
  },
  fuse: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded — kernel assert + forward',
  },
  cut: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded',
  },
  extrude: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded',
  },
  revolve: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded',
  },
  loft: {
    wrap: 'guard',
    scriptFace: false,
    semantics: 'ok',
    note: '§2.2: wrapGuarded; Wire[] input — library face only (§3.7)',
  },
  intersect: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded; vendored intersect is Result contract, compat face only',
  },
  makeExternalGear: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded — library builder factory (P24)',
  },
  makeInternalGear: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded',
  },
  makePlanetaryGear: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded',
  },
  thread: {
    wrap: 'guard',
    semantics: 'ok',
    note: '§2.2: wrapGuarded',
  },

  // ── §5.3 第四层 scriptFace 覆盖 ──
  split: {
    scriptFace: true,
    semantics: 'ok',
    note: '§5.3: multi-product op but in current 27 — do not exclude by "single Shape" rule',
  },

  // ── §1.3 A 类规则漏洞 ──
  io: {
    kind: 'skip',
    semantics: 'unknown',
    note: '§1.3: ns.io forwards byte-type API, module field is ns not io',
  },

  // ── §9.1 S3: global side-effects (destructive / singleton state) ──
  resetDisposalStats: {
    semantics: 'S3',
    note: '§9.1: destructive global state — clears faijs handle stats',
  },
  getDisposalStats: {
    semantics: 'S3',
    note: '§9.1: reads module-level singleton _stats',
  },
  kernelCall: {
    semantics: 'S3',
    note: '§9.1: raw kernel call bypass — global OCCT state mutation',
  },
  kernelCallScoped: {
    semantics: 'S3',
    note: '§9.1: scoped kernel call — still mutates global OCCT state',
  },

  // ── §9.1 S4: host-injected resource dependency (fonts / files / network) ──
  getFont: {
    semantics: 'S4',
    note: '§9.1: depends on font source (host-injected vs vendored internal path)',
  },
  loadFont: {
    semantics: 'S4',
    note: '§9.1: same as getFont',
  },
  sketchText: {
    semantics: 'S4',
    note: '§9.1: same font dependency',
  },
  surfaceFromImage: {
    semantics: 'S4',
    note: '§9.1: depends on image file loading (host ports)',
  },
}

/**
 * Default semantics for symbols not in the override table.
 * The generator fills this in, then P2 requires manual review to upgrade
 * from 'unknown' to a specific S1-S6 or 'ok' before the symbol can be exported.
 */
export const DEFAULT_SEMANTICS = 'unknown' as const
