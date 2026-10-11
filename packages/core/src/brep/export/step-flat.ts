/**
 * step-flat — brepkit 原生 STEP 导出通道（平铺多实体，无 XCAF 装配层级）
 *
 * 方案 docs/plans/2026-10-11-brepkit-step-io.md §4 Phase 1：brepkit 引擎下 STEP
 * 完全按内核自带的 `exportStep` 实现（纯 Rust AP203 writer）产出——平铺、无层级、
 * 无名称颜色。brepkit wasm 的 `exportStep` 每次只吃一个 solid、返回一份完整
 * STEP 文件，多成员由本文件在文本层拼接：取第一个成员的文件作骨架，其余成员
 * DATA 段实体**重编号**后并入（纯文本处理，绝不改坐标数字）。
 *
 * 设计基调（用户 2026-10-11）：不做门禁、不因 brepkit 缺特性而报错；`unit` /
 * `fileMeta` 等 occt 通道选项在本通道不生效（忽略，不报错不警告）。
 */

import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'

/** STEP 文本里的实体引用（`#123`）。 */
const REF_RE = /#(\d+)/g

/** 单份 STEP 文件的 DATA 段（实体语句）与其内最大实体号。 */
interface StepDataSection {
  /** DATA 段文本（不含 `DATA;` / `ENDSEC;` 定界符）。 */
  body: string
  /** DATA 段内出现过的最大实体 id（`#n`）。 */
  maxId: number
}

/**
 * 切出 DATA 段。找不到 DATA/ENDSEC 时返回 undefined——调用方按内核输出原样透传
 * （只有单成员时不会走到这），绝不报错。
 */
function sliceDataSection(text: string): StepDataSection | undefined {
  const start = text.indexOf('DATA;')
  if (start < 0) return undefined
  const end = text.indexOf('ENDSEC;', start)
  if (end < 0) return undefined
  const body = text.slice(start + 'DATA;'.length, end)
  let maxId = 0
  for (const m of body.matchAll(REF_RE)) maxId = Math.max(maxId, Number(m[1]))
  return { body, maxId }
}

/** 把 DATA 段里的所有 `#n` 引用按 map 重编号（map 缺项原样保留）。 */
function renumberRefs(body: string, map: Map<number, number>): string {
  return body.replace(REF_RE, (whole, num: string) => {
    const mapped = map.get(Number(num))
    return mapped === undefined ? whole : `#${mapped}`
  })
}

/**
 * 多份单实体 STEP 文本 → 一份平铺多实体 STEP 文本。
 *
 * 骨架 = 第一份文件的 header + 最后的 END-ISO 脚注；其余文件的 DATA 段实体整体
 * 平移到不与骨架冲突的号段后追加进骨架 DATA 段。单份输入原样返回（零加工）。
 *
 * @param texts - 每个成员一份的完整 STEP 文本（`kernel.exportStep` 的产出）。
 * @returns 合并后的 STEP 文本；`texts` 为空时返回空串（调用方已有空装配守卫）。
 */
export function mergeStepTexts(texts: string[]): string {
  if (texts.length === 0) return ''
  if (texts.length === 1) return texts[0]!
  const [base, ...rest] = texts
  const baseSection = sliceDataSection(base!)
  if (!baseSection) return base!
  let maxId = baseSection.maxId
  let mergedBody = baseSection.body
  for (const text of rest) {
    const section = sliceDataSection(text)
    if (!section) continue
    const offset = maxId
    const map = new Map<number, number>()
    for (const m of section.body.matchAll(REF_RE)) {
      const id = Number(m[1])
      if (!map.has(id)) map.set(id, id + offset)
    }
    mergedBody += renumberRefs(section.body, map)
    maxId += section.maxId
  }
  // 骨架文件原样保留 header 与脚注，只把 DATA 段体换成拼接后的。
  const start = base!.indexOf('DATA;') + 'DATA;'.length
  const end = base!.indexOf('ENDSEC;', start)
  return base!.slice(0, start) + mergedBody + base!.slice(end)
}

/**
 * brepkit 原生 STEP 导出：逐成员取 `kernel.exportStep(handle)` 文本后平铺拼接。
 * 只有带 `solid` 句柄的条目参与（纯 mesh 条目无精确 BREP，brepkit 通道跳过——
 * 不报错，与"按内核支持的格式来"的基调一致）。
 *
 * @param kernel - 当前 BREP 引擎的 L1 契约面（brepkit 适配器实例）。
 * @param handles - 待导出的 solid 句柄表（每个成员一个，顺序即文件内实体顺序）。
 * @returns 合并后的 STEP（ISO-10303-21）文件字节，供宿主写入 `.step` / `.stp`。
 */
export function exportStepFlat(kernel: BrepEngineApi, handles: BrepHandle[]): ArrayBuffer {
  const texts: string[] = []
  for (const handle of handles) texts.push(kernel.exportStep(handle))
  const merged = mergeStepTexts(texts)
  return new TextEncoder().encode(merged).buffer
}
