/**
 * STEP 文件级元数据 → P21 header 重写（`FILE_NAME`/`FILE_DESCRIPTION`）。
 *
 * 独立成模块使 `export-model.ts`（ExportModel 入口）与 `step.ts`
 * （exportStepFromSolids）都能复用，避免 `export-model → export → export-model`
 * 的循环依赖：本模块只依赖 `../../api/meta` 的 `FileMeta` 类型（type-only）。
 *
 * 设计文档 2026-10-05-meta §6.2 第 6 步：`exportModel` 已有 SI_UNIT 声明重写的先例
 * ——同样只对 header 里 FILE_NAME(...)/FILE_DESCRIPTION(...) 行做文本替换，绝不碰
 * DATA 段几何实体（红线 §10.3 3a：文本层只改声明/元数据，坐标不动）。
 *
 * FILE_NAME(name, time_stamp, author, organization, preprocessor_version, ...)
 * FILE_DESCRIPTION(description_list, implementation_level)
 * 映射（§3.3）：title→name, creationDate→time_stamp, designer/author→author,
 * organization→organization, application→preprocessor, description→description。
 * 无对应位置的字段（copyright/licenseTerms/rating/modificationDate）**不写**
 * （STEP 无标准位置，不发明）。
 *
 * 宽容失败：找不到 FILE_NAME/FILE_DESCRIPTION 行则留空（P21 头由内核写出，形态
 * 已知为 `FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');` 一行，但在字符串内）。
 */

import type { FileMeta } from '../../api/meta'

/**
 * FileMeta 是否含可映射到 STEP header 的字段（避免对无 header 字段的 fileMeta
 * 做无谓解码重写）。
 *
 * @param f 文件级元数据；undefined 视为无 header 字段。
 * @returns 存在任一可映射字段时为 true。
 */
export function fileMetaHasHeaderFields(f: FileMeta | undefined): boolean {
  if (!f) return false
  return !!(f.title || f.description || f.designer || f.author || f.organization || f.application
    || f.creationDate || f.modificationDate)
}

/**
 * STEP 文件级元数据 → P21 header 重写：仅碰 `FILE_NAME`/`FILE_DESCRIPTION` 两处
 * 标准实体，其余文本（含 DATA 段几何）原样保留。
 *
 * @param stepText 内核产出的 STEP 全文（ISO-10303-21）。
 * @param fileMeta 目标文件级元数据。
 * @returns 改写后的 STEP 文本。
 */
export function rewriteStepHeader(stepText: string, fileMeta: FileMeta): string {
  let out = stepText

  const title = fileMeta.title && fileMeta.title.length > 0 ? fileMeta.title : undefined
  const ts = fileMeta.creationDate && fileMeta.creationDate.length > 0
    ? fileMeta.creationDate
    : (fileMeta.modificationDate && fileMeta.modificationDate.length > 0 ? fileMeta.modificationDate : undefined)
  const authorList = fileMeta.author && fileMeta.author.length > 0 ? [fileMeta.author] : []
  const org = fileMeta.organization && fileMeta.organization.length > 0 ? fileMeta.organization : undefined
  const preproc = fileMeta.application && fileMeta.application.length > 0 ? fileMeta.application : undefined
  const designer = fileMeta.designer && fileMeta.designer.length > 0 ? fileMeta.designer : undefined
  const desc = fileMeta.description && fileMeta.description.length > 0 ? fileMeta.description : undefined

  // 1) FILE_NAME（用平衡括号/引号感知的枚举，整块替换 —— 逐参安全，不依赖行结构）。
  const fn = matchEntity(out, 'FILE_NAME')
  if (fn) {
    const params = splitP21Params(fn.inner)
    const next: string[] = []
    if (title !== undefined || ts !== undefined || authorList.length > 0 || org !== undefined || preproc !== undefined || designer !== undefined) {
      next.push(stepStr(title ?? paramStr(params[0]) ?? 'STEP File'))
      next.push(stepStr(ts ?? paramStr(params[1]) ?? ''))
      next.push(authorList.length > 0 ? p21List(authorList) : (params[2] ?? "('')"))
      next.push(org !== undefined ? p21List([org]) : (params[3] ?? "('')"))
      // 保留内核写出的后续参数原样（preprocessor_version / originating_system /
      // authorisation）——FILE_NAME 可带 6..7 参，不丢既有值。
      next.push(preproc !== undefined ? stepStr(preproc) : (params[4] ?? ''))
      next.push(designer !== undefined ? stepStr(designer) : (params[5] ?? ''))
      for (let i = 6; i < params.length; i++) next.push(params[i])
      // 末尾空参保留则拼 ',' 会使整行以 ',' 结尾 → 过滤空的尾部。
      while (next.length > 0 && next[next.length - 1] === '') next.pop()
      out = splice(out, fn.start, fn.end, `FILE_NAME(${next.join(',')})`)
    }
  }

  // 2) FILE_DESCRIPTION(description_list, implementation_level)：替换描述列表。
  const fd = matchEntity(out, 'FILE_DESCRIPTION')
  if (fd) {
    const params = splitP21Params(fd.inner)
    if (desc !== undefined && params.length > 0) {
      const impl = params[params.length - 1]
      out = splice(out, fd.start, fd.end, `FILE_DESCRIPTION((${stepStr(desc)}),${impl})`)
    }
  }

  return out
}

/**
 * 用 replacement 替换字符串 [start, end) 区间，返回新字符串（不可变，纯函数）。
 *
 * @param s 原始字符串。
 * @param start 替换区起始偏移（含）。
 * @param end 替换区结束偏移（不含）。
 * @param replacement 替换内容。
 * @returns 替换后的新字符串。
 */
export function splice(s: string, start: number, end: number, replacement: string): string {
  return s.slice(0, start) + replacement + s.slice(end)
}

/**
 * 旧名别名：正文使用 {@link rewriteStepHeader}。保留导出以免破坏既有调用/test 引用。
 *
 * @param stepText 内核产出的 STEP 全文（ISO-10303-21）。
 * @param fileMeta 目标文件级元数据。
 * @returns 改写后的 STEP 文本。
 */
export const rewriteFileMetaHeader: (stepText: string, fileMeta: FileMeta) => string = rewriteStepHeader

/**
 * 在文本中定位 `NAME(` … 匹配的 `)` （引号忽略、内层括号计入）并返回
 * `{ start, end, inner }`；找不到返回 null。start/end 是 `NAME(` 起始/闭合 `)` 之后
 * 一位的偏移，供调用方做字符串拼接替换（不做正则整行匹配——行内可含 `;` 等字符）。
 *
 * @param text 待搜索的 STEP 全文。
 * @param name 实体名（如 `FILE_NAME`），大小写敏感。
 * @returns 匹配区间 `{ start, end, inner }`；未找到时 null。
 */
export function matchEntity(text: string, name: string): { start: number; end: number; inner: string } | null {
  const re = new RegExp(`${name}\\s*\\(`)
  const m = re.exec(text)
  if (!m) return null
  const start = m.index
  const head = m.index + m[0].length
  let depth = 1
  let i = head
  for (; i < text.length && depth > 0; i++) {
    const c = text[i]
    if (c === `'`) {
      // 跳过字符串字面量（含 ISO10303-21 双引号转义）
      i++
      while (i < text.length) {
        if (text[i] === `'` && text[i + 1] === `'`) { i += 2; continue }
        if (text[i] === `'`) break
        i++
      }
    } else if (c === '(') depth++
    else if (c === ')') depth--
  }
  return { start, end: i - 1, inner: text.slice(head, i - 1) }
}

/** 把一层参数（逗号分隔，忽略括号与字符串内的逗号）拆分（trim，原样保留字面量）。 */
/**
 * 把一层 P21 参数（逗号分隔，忽略括号与字符串内的逗号）拆成数组；每项 trim，
 * 字符串字面量原样保留（不做解引号）。
 *
 * @param inner 实体括号内、不含首尾括号的原文（如 `matchEntity` 返回的 `inner`）。
 * @returns 拆解后的参数数组（可能为空数组）。
 */
export function splitP21Params(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === `'`) {
      // 字符串字面量：整体吸收（含 ISO10303-21 转义 ''），不拆其内逗号/括号。
      const start = i
      i++
      while (i < inner.length) {
        if (inner[i] === `'` && inner[i + 1] === `'`) { i += 2; continue }
        if (inner[i] === `'`) { i++; break }
        i++
      }
      cur += inner.slice(start, i)
      i-- // for 循环还会 +1，落到字符串结束引号后一个字符
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = '' }
    else cur += c
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/**
 * 单个 P21 字符串字面量的未转义内容（剥离包裹引号与 `''` 转义）。
 *
 * @param p 可能带包裹引号的 P21 字符串字面量（含 trim），或 undefined。
 * @returns 未转义内容；非字面量/undefined 时返回 undefined。
 */
export function paramStr(p: string | undefined): string | undefined {
  if (p === undefined) return undefined
  const m = /^'((?:[^']|'')*)'$/.exec(p.trim())
  return m ? m[1].replace(/''/g, `'`) : undefined
}

/**
 * 单个 P21 字符串字面量（已转义）。
 *
 * @param v 原始字符串内容（未转义）。
 * @returns 包裹单引号并按 P21 规则转义后的字面量（如 `'a''b'`）。
 */
export function stepStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

/**
 * P21 列表字面量：把多项字符串转为带外层圆括号的字面量列表。
 *
 * @param items 待序列化的字符串数组。
 * @returns 形如 `('a','b')` 的 P21 列表字面量。
 */
export function p21List(items: string[]): string {
  return `(${items.map(stepStr).join(',')})`
}