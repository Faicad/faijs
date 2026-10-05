/**
 * STEP 元数据解析器 — 从 STEP (P21) 文本头部与 PRODUCT 层提取
 * FileMeta（文件级）与 ShapeMeta（零件级描述字/料号）。
 *
 * 与 stepColorParser 同一原则：纯文本扫描，不依赖 OCCT 内核（XCAF label 层
 * 是否暴露 description/属性不确定，见设计文档 2026-10-05-meta §6.3 风险 2）。
 *
 * 读取面映射（§3.3）：
 * - HEADER FILE_NAME(name,time_stamp,author,organization,preprocessor,originator)
 *   → title / creationDate / author / organization / application / designer。
 * - HEADER FILE_DESCRIPTION(...) → description（逗号拼接，去首尾引号）。
 * - DATA PRODUCT(name,description,frame)（第一个、leaf 使用的）→ 零件 description。
 *   name 已由 OCCT label 提供（不在本解析器处理）。
 * - PRODUCT → PRODUCT_DEFINITION_FORMATION/WITH_SPECIFIED_SOURCE-关联的料号通道：
 *   PART_NUMBER_PROPERTY/IDENTIFICATION 命名在 §3.3 表里列出的 PART 层通道（P4
 *   标 "IDENTIFICATION 内核支持" 待实测），这里尽量从 PRODUCT_DEFINITION 挂的
 *   UDA（GENERAL_PROPERTY + PROPERTY_DEFINITION）捞自定义属性。
 *
 * 所有扫描都容错：找不到就不给对应字段，绝不让解析器抛（信息性收益）。
 */

/** Header 级人物贡献字段（FILE_NAME 组内的三四五参数）。 */
export interface StepFileMeta {
  title?: string
  creationDate?: string
  designer?: string
  author?: string
  organization?: string
  application?: string
  description?: string
  /** 自定义 FILE_DESCRIPTION/FILE_NAME 之外的 vendor 属性（metadata 笼）。 */
  metadata?: Record<string, string>
}

/** STEP 伙伴级 P21 解析出的轻量属性。 */
export interface StepPartMeta {
  /** 产品描述（PRODUCT( ..., description, id )）。空串/缺省不设。 */
  description?: string
  /** 自定义属性：`PROPERTY_DEFINITION(...)` + `GENERAL_PROPERTY('name', value, ...)`。 */
  metadata?: Record<string, string>
}

/** 剥离一层引号（STEP 字符串形如 `'abc'`），出双引号化转义；去末尾换行。 */
function unquote(s: string): string {
  const t = s.trim()
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1)
  return t
}

/** 任一 `HEADER`/`DATA` 段中的实体文本（多行），从 header 段中取整行。 */
function headerLines(text: string): string {
  const m = /HEADER;\n([\s\S]*?)\nENDSEC;/.exec(text)
  return m ? m[1] : ''
}

/** `TYPE(...)` 实体块捕获：从开括号起做括号配平扫描到闭合（容错 LIST/嵌套）。 */
function entityBlock(text: string, type: string): string | undefined {
  const re = new RegExp(`${type}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let depth = 0
    let inQuote = false
    let i = m.index + m[0].length - 1 // 停在开括号
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === "'") inQuote = !inQuote
      if (inQuote) continue
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) return text.slice(m.index, i + 1)
      }
    }
  }
  return undefined
}

/** 逗号分隔的顶层简单参数（忽略嵌套括号内容仍按逗号简单切——够用即可）。 */
function splitTopLevel(body: string): string[] {
  // 剥离外层括号后，按未被引号包裹的逗号切分（不处理嵌套括号——STEP 伙伴级
  // FILE_NAME/FILE_DESCRIPTION 参数都是简单标量/字符串，不涉及深层嵌套）。
  const s = body.slice(body.indexOf('(') + 1, body.lastIndexOf(')'))
  const parts: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") inQuote = !inQuote
    if (c === ',' && !inQuote) {
      parts.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  parts.push(cur)
  return parts.map((p) => p.trim())
}

/**
 * Header 段整块（FILE_NAME / FILE_DESCRIPTION）→ `StepFileMeta`。
 *
 * @param text STEP 全文（ISO-10303-21）。
 * @returns 解析出的文件级元数据；无 header 时返回空对象。
 */
export function parseStepHeaderMeta(text: string): StepFileMeta {
  const meta: StepFileMeta = {}
  const header = headerLines(text)
  if (!header) return meta

  const fileBlock = entityBlock(header, 'FILE_NAME')
  if (fileBlock) {
    const parts = splitTopLevel(fileBlock)
    // FILE_NAME(name, time_stamp, author(list), organization(list), preprocessor, originator)
    // 引号数组形如 `('x')`，去首尾括号后 unquote；author/organization 可能为列表。
    const inline = (p: string): string | undefined => {
      if (!p) return undefined
      const v = unquote(p.replace(/^\(|\)$/g, ''))
      return v === '' ? undefined : v
    }
    const title = inline(parts[0])
    if (title) meta.title = title
    const cdate = inline(parts[1])
    if (cdate) meta.creationDate = cdate
    const author = inline(parts[2] ?? '')
    if (author) meta.author = author
    const org = inline(parts[3] ?? '')
    if (org) meta.organization = org
    // preprocessor → application（编辑器导入后端把 preprocessor 视为 APP）；
    // originator → designer。
    const pre = inline(parts[4] ?? '')
    if (pre) meta.application = pre
    const origin = inline(parts[5] ?? '')
    if (origin) meta.designer = origin
  }

  const descBlock = entityBlock(header, 'FILE_DESCRIPTION')
  if (descBlock) {
    // FILE_DESCRIPTION(description_list, implementation_context)：描述只取第一个
    // 顶层参数（描述串列表，`('a','b')` 形态含内层逗号）；实现上下文不算。
    // 直接取 `FILE_DESCRIPTION((…),` 里第一层括号内的引号字符串列表。
    const m = /FILE_DESCRIPTION\s*\(\s*\((.*?)\)\s*,\s*/.exec(descBlock)
    if (m) {
      const joined = m[1]
        .split(',')
        .map((p) => unquote(p.trim()))
        .filter((v) => v !== '')
      if (joined.length > 0) meta.description = joined.join(', ')
    }
  }

  return meta
}

/**
 * 伙伴层 `PRODUCT` 描述 + 根自定义属性（UDA，`GENERAL_PROPERTY`）解析
 * （简化：description 只取第一个 `PRODUCT`）。
 *
 * @param text STEP 全文（ISO-10303-21）。
 * @returns 解析出的部分级元数据（`description`/`metadata`）。
 */
export function parseStepPartMeta(text: string): StepPartMeta {
  const out: StepPartMeta = {}
  // 逐 PRODUCT 取 description（第 2 个参数）。
  const dataRe = /PRODUCT\s*\(/g
  let m: RegExpExecArray | null
  while ((m = dataRe.exec(text)) !== null) {
    const close = text.indexOf(')', m.index)
    if (close < 0) break
    const inner = text.slice(m.index, close + 1)
    const descM = /,\s*'([^']*)'/.exec(inner)
    if (descM) {
      const d = descM[1]
      if (d !== '') out.description = d
      break // 只取第一个
    }
  }
  // 属性笼（UDA：GENERAL_PROPERTY('name', value?) 挂在 PROPERTY_DEFINITION 上）。
  const props: Record<string, string> = {}
  const gpRe = /GENERAL_PROPERTY\s*\(\s*'([^']*)'\s*,\s*([^,)]+)/g
  let gm: RegExpExecArray | null
  while ((gm = gpRe.exec(text)) !== null) {
    props[gm[1]] = unquote(gm[2])
  }
  if (Object.keys(props).length > 0) out.metadata = props
  return out
}