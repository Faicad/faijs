import type { EventSink } from '../cad-runtime/ports'
import type { PartName } from '../identity'

/**
 * CLI environment event notification sink.
 *
 * Collects events (matching NodeEventSink's accumulation behaviour) while also
 * writing each event to stderr, so CLI users can see broken-chain notifications.
 *
 * Each event detail keeps only `partName` (§6.7).
 */
export class CliEventSink implements EventSink {
  /** The collected events pushed so far. */
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []

  emit(event: 'part-brep-lost', detail: { partName: PartName; op: string; reason: string }): void {
    this.events.push({ event, detail: { ...detail } })
    // 写入 stderr（不干扰 stdout 的产物输出）
    process.stderr.write(`[faijs] ${event}: op="${detail.op}", partName="${detail.partName}", reason="${detail.reason}"\n`)
  }

  /** Clear all collected events. */
  clear(): void {
    this.events.length = 0
  }
}