/**
 * BrowserEventSink — browser 端事件通知实现
 *
 * 实现 EventSink 接口（ports.ts），通过 window.dispatchEvent 发送 CustomEvent。
 * 浏览器 UI 监听 'part-brep-lost' 事件来弹出 toast 通知。
 *
 * 与 node-host 的 CliEventSink 对称：
 * - CliEventSink: 写入 stderr + 收集到 events 数组
 * - BrowserEventSink: dispatch window CustomEvent
 *
 * 事件 detail 只保留 `partName`（§6.7：三键 partId/stmtName/partName 同值 → 去重）。
 */

import type { EventSink } from '../cad-runtime/ports'
import type { PartName } from '../identity'

export class BrowserEventSink implements EventSink {
  emit(event: 'part-brep-lost', detail: { partName: PartName; op: string; reason: string }): void {
    if (event === 'part-brep-lost' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('part-brep-lost', {
        detail: {
          partName: detail.partName,
          op: detail.op,
          reason: detail.reason,
        },
      }))
    }
  }
}