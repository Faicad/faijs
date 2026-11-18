/**
 * 3MF PMI metadata bridge — PmiSet ↔ 3MF <metadatagroup>
 *
 * 3MF 不支持 PMI 实体。PMI 通过 3MF `<metadatagroup>` 传递：
 *
 * ```xml
 * <metadatagroup>
 *   <metadata name="faijs:pmi" preserve="1">
 *     {"items":[{"kind":"dimension",...}],"meta":{"source":"faijs"}}
 *   </metadata>
 * </metadatagroup>
 * ```
 *
 * 导出侧（写入 3MF）：在 `export-model.ts` 的 `emitObject` 中调用
 * `serializePmiFor3mf(pmiSet)` 生成 `<metadata>` XML 片段。
 *
 * 导入侧（读取 3MF）：在 3MF 解析器中调用 `parsePmiFrom3mfMetadata(metadataMap)`
 * 从 `<metadata name="faijs:pmi">` 提取 PmiSet。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-design.md §8.1
 */

import type { PmiSet } from '../api/pmi/types'
import { migratePmiSet } from '../api/pmi/kind-alias'

/** 3MF metadata name for PMI data (vendor-prefixed per 3MF spec). */
export const PMI_3MF_METADATA_NAME = 'faijs:pmi'

/**
 * Serialize a PmiSet into a 3MF `<metadata>` XML element string.
 *
 * The PMI data is JSON-serialized and XML-attribute-escaped.
 * `preserve="1"` ensures downstream 3MF tools retain the metadata.
 *
 * @param pmi - the PMI set to serialize.
 * @returns the `<metadata>` XML element string, or empty string if no PMI.
 */
export function serializePmiFor3mf(pmi: PmiSet | undefined): string {
  if (!pmi || !pmi.items || pmi.items.length === 0) return ''
  const json = JSON.stringify(pmi)
  // XML-escape the JSON content for use as element text content.
  const escaped = xmlEscape(json)
  return `<metadata name="${PMI_3MF_METADATA_NAME}" preserve="1">${escaped}</metadata>`
}

/**
 * Parse a PmiSet from 3MF metadata entries.
 *
 * The caller provides a map of metadata name → raw text content (already
 * XML-unescaped by the 3MF parser). This function looks for the `faijs:pmi`
 * key and deserializes the JSON PmiSet.
 *
 * @param metadataMap - metadata name → text content map.
 * @returns PmiSet if found and valid, undefined otherwise.
 */
export function parsePmiFrom3mfMetadata(
  metadataMap: Map<string, string> | Record<string, string>,
): PmiSet | undefined {
  const get = (key: string): string | undefined => {
    if (metadataMap instanceof Map) return metadataMap.get(key)
    return metadataMap[key]
  }

  const raw = get(PMI_3MF_METADATA_NAME)
  if (!raw) return undefined

  try {
    const parsed = JSON.parse(raw) as PmiSet
    if (!parsed || !Array.isArray(parsed.items)) return undefined
    // 外部数据宽容兼容：旧 kind（note / techNote）在这里归一到当前字面量。
    return migratePmiSet(parsed)
  } catch {
    // Invalid JSON — silently skip (corrupted or truncated metadata)
    return undefined
  }
}

/**
 * XML-escape a string for use as element text content.
 *
 * Escapes the 5 predefined XML entities: & < > " '
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
