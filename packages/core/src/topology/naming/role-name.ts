/**
 * role-name.ts — `RoleName` 契约与序列化（计划 §4.2）。
 *
 * 一条语句对自己产出的每个面起的**局部名**。作用域 = 那条语句；
 * 全局唯一性由 `(origin, role)` 提供（`origin` 是 `StmtId`，见 `types.ts`）。
 *
 * ## 为什么 role 不能是一个裸字符串
 *
 * 旧实现在位置兜底时产出 `box:top` / `extrude:face_3` / `cylinder:lateral`
 * ——**名字里塞了 origin**。这带来两个后果，都是致命的：
 * 1. 同一个 role 在不同语句下**不是同一个名字**（`box:top` vs `extrude:top`），
 *    于是「role 词汇表」无法按 op 封闭枚举，生成器无法把词汇表产出到 `.d.ts`；
 * 2. 前缀是**位置兜底**的伪装——`extrude:face_3` 有名字却不承载任何设计意图，
 *    按「有名/无名」统计会得出假的"全覆盖"（Phase 0.8 基线实测）。
 *
 * ⇒ role 只描述**在那条语句内的局部语义**，origin 由 `(StmtId)` 单独承载。
 *
 * ## 七个 kind 是封闭集
 *
 * `semantic`（op 词汇表封闭）/ `wall`（profile 第 i 条边扫出）/ `hole`（内环子结构）/
 * `replica`（pattern 第 k 份）/ `splinter`（split 第 j 片）/ `generated`（倒角过渡面）/
 * `imported`（import_brep 原始面序）。**新增 kind = 破坏性变更，须版本化。**
 *
 * ## 四条约束（分析文档 §5.1.1 R1–R4）
 *
 * 局部唯一 / 封闭可枚举 / **抗参数变化** / 结构化可分解。
 * 第三、四条正是本文件的序列化设计目标：`wall:3` 在 profile 边数变化后**仍然是第 3 条边**
 * （不是"第 3 张面"这种随面序漂移的地址），且 `replica[2]/hole:1/wall:3` 可逐层分解回结构。
 *
 * ## 序列化（进 `.fai.js` 的参数）
 *
 * ```
 * semantic   top                        （裸名）
 * wall       wall:3
 * hole       hole:1/wall:2              （前缀包裹 inner）
 * replica    replica[2]/wall:3          （前缀包裹 inner）
 * splinter   splinter(top)#1            （包裹 inner + 后缀）
 * generated  gen:fillet:0
 * imported   imported:5
 * ```
 *
 * `parseRoleName` 与 `formatRoleName` **互为逆**（值级 round-trip），
 * 且 `parseRoleName` 是**单射**的（不接受前导零、不接受保留字作 semantic）——
 * 否则两个不同的 RoleName 会序列化成同一个串，`.fai.js` 里的引用会静默指向错的面。
 */

/** 结构关键字：出现在串首即被解释成结构 kind，故不得作为 semantic 名。 */
const RESERVED_KEYWORDS = ['wall', 'hole', 'replica', 'splinter', 'gen', 'imported'] as const

/**
 * semantic 名的合法形态。
 *
 * 限成 `[A-Za-z_][A-Za-z0-9_]*`：op 词汇表是**封闭可枚举**的
 * （`top` / `bottom` / `lateral` / `start` / `end` …），不需要更宽的字符集；
 * 收紧后串首不会与任何结构关键字歧义。
 */
const SEMANTIC_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 非负整数，**禁止前导零**（`0` 合法，`01` 不合法）——保证 format/parse 单射。 */
const INDEX_SOURCE = '0|[1-9][0-9]*'
const LEADING_INDEX_RE = new RegExp(`^(${INDEX_SOURCE})$`)

/** `generated` 的 op 名：与 semantic 同字符集，保证 `gen:<op>:<i>` 无歧义。 */
const OP_NAME_RE = SEMANTIC_NAME_RE

/**
 * 一条语句对某个产出面的局部名（计划 §4.2）。
 *
 * - `semantic`：op 声明的封闭词汇（`top` / `bottom` / `lateral` / `start` / `end` …）
 * - `wall`：由输入 profile 第 `index` 条边扫出/旋出的侧面
 * - `hole`：第 `index` 个内环下的同名子结构（`inner` 递归该内环下的局部名）
 * - `replica`：pattern 的第 `k` 份（`inner` 递归该份内的局部名）
 * - `splinter`：split 的第 `index` 片（`inner` 递归原面的局部名）
 * - `generated`：`op` 造出的过渡面（`fillet` / `chamfer`）第 `index` 张
 * - `imported`：`import_brep` 的原始面序第 `index` 张
 */
export type RoleName =
  | { readonly kind: 'semantic'; readonly name: string }
  | { readonly kind: 'wall'; readonly index: number }
  | { readonly kind: 'hole'; readonly index: number; readonly inner: RoleName }
  | { readonly kind: 'replica'; readonly k: number; readonly inner: RoleName }
  | { readonly kind: 'splinter'; readonly inner: RoleName; readonly index: number }
  | { readonly kind: 'generated'; readonly op: string; readonly index: number }
  | { readonly kind: 'imported'; readonly index: number }

/** 七个 kind 的名字，供审计测试枚举（`RoleName` 是封闭集，新增 kind 必须同步此处）。 */
export const ROLE_NAME_KINDS = [
  'semantic',
  'wall',
  'hole',
  'replica',
  'splinter',
  'generated',
  'imported',
] as const

/** `ROLE_NAME_KINDS` 的元素类型。 */
export type RoleNameKind = (typeof ROLE_NAME_KINDS)[number]

/** RoleName 序列化/校验失败（格式不合法、保留字冲突、索引非法）。 */
export class RoleNameError extends Error {
  /** 稳定的错误码（供 args 校验与宿主识别）。 */
  readonly code = 'E_TOPO_ROLE_INVALID'

  /**
   * @param message - what is wrong with the role name.
   */
  constructor(message: string) {
    super(message)
    this.name = 'RoleNameError'
  }
}

/** 校验非负整数索引。 @throws RoleNameError when out of contract. */
function assertIndex(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RoleNameError(`${what} must be a non-negative integer, got ${String(value)}`)
  }
}

/**
 * 校验 semantic 名：形态合法且不与结构关键字冲突。
 *
 * @param name - the candidate semantic name.
 * @throws RoleNameError when empty, malformed, or shadowing a structural keyword.
 */
function assertSemanticName(name: string): void {
  if (!SEMANTIC_NAME_RE.test(name)) {
    throw new RoleNameError(
      `semantic name must match ${SEMANTIC_NAME_RE.source}, got ${JSON.stringify(name)}`,
    )
  }
  if ((RESERVED_KEYWORDS as readonly string[]).includes(name)) {
    throw new RoleNameError(
      `semantic name ${JSON.stringify(name)} is a structural keyword; ` +
        `serializing it would parse back as kind '${name}' (use the structural kind instead)`,
    )
  }
}

/** 校验 generated 的 op 名（保证 `gen:<op>:<i>` 三段可切）。 */
function assertOpName(op: string): void {
  if (!OP_NAME_RE.test(op)) {
    throw new RoleNameError(
      `generated op must match ${OP_NAME_RE.source}, got ${JSON.stringify(op)}`,
    )
  }
}

/**
 * 把一个 `RoleName` 序列化成进 `.fai.js` 的串。
 *
 * 结果**不含 origin**：身份是 `(StmtId, RoleName)` 两元组，串只承载后半。
 *
 * @param role - the role name to serialize.
 * @returns the wire form (e.g. `top`, `wall:3`, `replica[2]/wall:3`).
 * @throws RoleNameError when the value violates the contract (reserved name, bad index).
 */
export function formatRoleName(role: RoleName): string {
  switch (role.kind) {
    case 'semantic':
      assertSemanticName(role.name)
      return role.name
    case 'wall':
      assertIndex(role.index, 'wall index')
      return `wall:${role.index}`
    case 'hole':
      assertIndex(role.index, 'hole index')
      return `hole:${role.index}/${formatRoleName(role.inner)}`
    case 'replica':
      assertIndex(role.k, 'replica k')
      return `replica[${role.k}]/${formatRoleName(role.inner)}`
    case 'splinter':
      assertIndex(role.index, 'splinter index')
      return `splinter(${formatRoleName(role.inner)})#${role.index}`
    case 'generated':
      assertOpName(role.op)
      assertIndex(role.index, 'generated index')
      return `gen:${role.op}:${role.index}`
    case 'imported':
      assertIndex(role.index, 'imported index')
      return `imported:${role.index}`
  }
}

/**
 * 读一个非负整数前缀（禁止前导零）。
 *
 * @param text - the candidate integer text.
 * @returns the parsed value, or null when it is not a canonical non-negative integer.
 */
function readIndex(text: string): number | null {
  if (!LEADING_INDEX_RE.test(text)) return null
  return Number(text)
}

/**
 * 切出 balanced 的 `(...)` 段：返回内层文本与剩余文本。
 *
 * `splinter` 的 inner 自身可能含括号（`splinter(splinter(top)#1)#2`），
 * 故不能用最后一个 `)` 定位。
 *
 * @param text - text starting with `(`.
 * @returns the inner text and the remainder after the matching `)`, or null when unbalanced.
 */
function readBalancedParen(text: string): { inner: string; rest: string } | null {
  if (!text.startsWith('(')) return null
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return { inner: text.slice(1, i), rest: text.slice(i + 1) }
      if (depth < 0) return null
    }
  }
  return null
}

/**
 * 把串解析回 `RoleName`（`formatRoleName` 的逆）。非法输入返回 `null`，不抛错。
 *
 * 只返回 `null` 而不抛错，是因为解析发生在读 `.fai.js` 参数时：
 * 调用方需要区分「这不是一个 role 串」（→ 走迁移器/报缺失）与「这是坏的 role 串」。
 *
 * @param text - the wire form.
 * @returns the parsed role, or null when the text is not a valid RoleName.
 */
export function parseRoleName(text: string): RoleName | null {
  if (text === '') return null

  if (text.startsWith('wall:')) {
    const index = readIndex(text.slice('wall:'.length))
    return index === null ? null : { kind: 'wall', index }
  }

  if (text.startsWith('imported:')) {
    const index = readIndex(text.slice('imported:'.length))
    return index === null ? null : { kind: 'imported', index }
  }

  if (text.startsWith('gen:')) {
    const parts = text.split(':')
    if (parts.length !== 3) return null
    const op = parts[1]
    if (!OP_NAME_RE.test(op)) return null
    const index = readIndex(parts[2])
    return index === null ? null : { kind: 'generated', op, index }
  }

  if (text.startsWith('splinter(')) {
    const balanced = readBalancedParen(text.slice('splinter'.length))
    if (!balanced) return null
    const inner = parseRoleName(balanced.inner)
    if (!inner) return null
    if (!balanced.rest.startsWith('#')) return null
    const index = readIndex(balanced.rest.slice(1))
    return index === null ? null : { kind: 'splinter', inner, index }
  }

  if (text.startsWith('hole:')) {
    // `hole:<i>/<inner>`：先切 index，再整体递归 inner（inner 内还可有 `/`）。
    const remainder = text.slice('hole:'.length)
    const slash = remainder.indexOf('/')
    if (slash < 0) return null
    const index = readIndex(remainder.slice(0, slash))
    if (index === null) return null
    const inner = parseRoleName(remainder.slice(slash + 1))
    return inner ? { kind: 'hole', index, inner } : null
  }

  if (text.startsWith('replica[')) {
    const close = text.indexOf(']')
    if (close < 0) return null
    const k = readIndex(text.slice('replica['.length, close))
    if (k === null) return null
    const rest = text.slice(close + 1)
    if (!rest.startsWith('/')) return null
    const inner = parseRoleName(rest.slice(1))
    return inner ? { kind: 'replica', k, inner } : null
  }

  // 兜底：semantic（保留字已在上面被结构分支吃掉，故此处不会歧义）
  if (!SEMANTIC_NAME_RE.test(text)) return null
  if ((RESERVED_KEYWORDS as readonly string[]).includes(text)) return null
  return { kind: 'semantic', name: text }
}

// ── 构造子（七个 kind 各一个）──
//
// 存在理由：把「契约校验」收在一处。调用点直接写字面量会绕过 `assertIndex` /
// `assertSemanticName`，于是不合法的 role 在 `formatRoleName` 才炸——
// 那时已经离出错点很远（可能跨了一次执行）。构造子让非法值**在产生点**就报错。

/**
 * 造一个 `semantic` role（op 声明的封闭词汇）。
 *
 * @param name - the op's closed-vocabulary name.
 * @returns the role.
 * @throws RoleNameError when the name is malformed or shadows a structural keyword.
 */
export function semantic(name: string): RoleName {
  assertSemanticName(name)
  return { kind: 'semantic', name }
}

/**
 * 造一个 `wall` role（输入 profile 第 i 条边扫出/旋出的侧面）。
 *
 * @param index - zero-based profile-edge index.
 * @returns the role.
 * @throws RoleNameError when the index is not a non-negative integer.
 */
export function wall(index: number): RoleName {
  assertIndex(index, 'wall index')
  return { kind: 'wall', index }
}

/**
 * 造一个 `hole` role（第 j 个内环下的同名子结构）。
 *
 * @param index - zero-based inner-loop index.
 * @param inner - the local role inside that loop.
 * @returns the role.
 * @throws RoleNameError when the index is not a non-negative integer.
 */
export function hole(index: number, inner: RoleName): RoleName {
  assertIndex(index, 'hole index')
  return { kind: 'hole', index, inner }
}

/**
 * 造一个 `replica` role（pattern 的第 k 份）。
 *
 * @param k - zero-based replica index.
 * @param inner - the local role inside that replica.
 * @returns the role.
 * @throws RoleNameError when k is not a non-negative integer.
 */
export function replica(k: number, inner: RoleName): RoleName {
  assertIndex(k, 'replica k')
  return { kind: 'replica', k, inner }
}

/**
 * 造一个 `splinter` role（split 的第 j 片）。
 *
 * @param inner - the local role of the face being split.
 * @param index - zero-based splinter index.
 * @returns the role.
 * @throws RoleNameError when the index is not a non-negative integer.
 */
export function splinter(inner: RoleName, index: number): RoleName {
  assertIndex(index, 'splinter index')
  return { kind: 'splinter', inner, index }
}

/**
 * 造一个 `generated` role（fillet/chamfer 过渡面）。
 *
 * @param op - the producing op ('fillet' / 'chamfer').
 * @param index - zero-based index among that op's generated faces.
 * @returns the role.
 * @throws RoleNameError when op or index violates the contract.
 */
export function generated(op: string, index: number): RoleName {
  assertOpName(op)
  assertIndex(index, 'generated index')
  return { kind: 'generated', op, index }
}

/**
 * 造一个 `imported` role（`import_brep` 的原始面序）。
 *
 * @param index - zero-based face index in the imported shape's enumeration order.
 * @returns the role.
 * @throws RoleNameError when the index is not a non-negative integer.
 */
export function imported(index: number): RoleName {
  assertIndex(index, 'imported index')
  return { kind: 'imported', index }
}
