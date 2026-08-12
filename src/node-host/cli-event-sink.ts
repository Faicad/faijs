/**
 * CliEventSink — CLI 环境事件通知
 *
 * 设计文档：docs/faijs-engine-refactor-design.md §4.3, §5.2
 *
 * 继承 NodeEventSink 的收集行为，同时将事件写入 stderr，
 * 使 CLI 用户能看到断链通知。
 */

import type { EventSink } from '../cad-runtime/ports'

export class CliEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []

  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void {
    this.events.push({ event, detail: { ...detail } })
    // 写入 stderr（不干扰 stdout 的产物输出）
    process.stderr.write(`[faijs] ${event}: op="${detail.op}", reason="${detail.reason}"\n`)
  }

  clear(): void {
    this.events.length = 0
  }
}
