/**
 * CliEventSink — CLI 环境事件通知
 *
 *
 * 继承 NodeEventSink 的收集行为，同时将事件写入 stderr，
 * 使 CLI 用户能看到断链通知。
 *
 * 事件 detail 只保留 `partName`（§6.7）。
 */

import type { EventSink } from '../cad-runtime/ports'
import type { PartName } from '../identity'

export class CliEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []

  emit(event: 'part-brep-lost', detail: { partName: PartName; op: string; reason: string }): void {
    this.events.push({ event, detail: { ...detail } })
    // 写入 stderr（不干扰 stdout 的产物输出）
    process.stderr.write(`[faijs] ${event}: op="${detail.op}", partName="${detail.partName}", reason="${detail.reason}"\n`)
  }

  clear(): void {
    this.events.length = 0
  }
}