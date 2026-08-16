/**
 * BrowserEventSink — browser 端事件通知实现
 *
 * 实现 EventSink 接口（ports.ts），通过 window.dispatchEvent 发送 CustomEvent。
 * 浏览器 UI 监听 'brep-chain-broken' 事件来弹出 toast 通知。
 *
 * 与 node-host 的 CliEventSink 对称：
 * - CliEventSink: 写入 stderr + 收集到 events 数组
 * - BrowserEventSink: dispatch window CustomEvent
 */

import type { EventSink } from '../cad-runtime/ports'

export class BrowserEventSink implements EventSink {
  emit(event: 'brep-chain-broken', detail: { partName: string; op: string; reason: string }): void {
    if (event === 'brep-chain-broken' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('brep-chain-broken', {
        detail: {
          op: detail.op,
          stmtName: detail.partName,
          partName: detail.partName,
          reason: detail.reason,
        },
      }))
    }
  }
}
