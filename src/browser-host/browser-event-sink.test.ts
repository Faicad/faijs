/**
 * BrowserEventSink 测试
 *
 * 测试内容：
 * 1. emit 'part-brep-lost' 触发 window.dispatchEvent + CustomEvent
 * 2. 事件 detail 包含正确的 op / partName / reason
 * 3. window 未定义时不抛错（SSR 安全）
 *
 * Run: npx vitest run src/browser-host/browser-event-sink.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserEventSink } from './browser-event-sink'

// Mock window + CustomEvent for Node environment
class MockCustomEvent {
  type: string
  detail: Record<string, unknown>
  constructor(type: string, init: { detail?: Record<string, unknown> }) {
    this.type = type
    this.detail = init.detail ?? {}
  }
}

interface MockWindow {
  dispatchEvent: ReturnType<typeof vi.fn>
  CustomEvent: typeof MockCustomEvent
}

let mockWindow: MockWindow

beforeEach(() => {
  mockWindow = {
    dispatchEvent: vi.fn(),
    CustomEvent: MockCustomEvent,
  }
  // @ts-expect-error — assigning mock window to globalThis
  globalThis.window = mockWindow
  // Also set CustomEvent globally
  // @ts-expect-error — assigning mock CustomEvent
  globalThis.CustomEvent = MockCustomEvent
})

afterEach(() => {
  // @ts-expect-error — cleaning up
  delete globalThis.window
  // @ts-expect-error — cleaning up
  delete globalThis.CustomEvent
})

describe('BrowserEventSink', () => {
  let eventSink: BrowserEventSink

  beforeEach(() => {
    eventSink = new BrowserEventSink()
  })

  it('dispatches "part-brep-lost" CustomEvent on window', () => {
    eventSink.emit('part-brep-lost', {
      partId: 'part0_v1',
      op: 'drill',
      reason: 'no brep solid in chain',
    })

    expect(mockWindow.dispatchEvent).toHaveBeenCalledTimes(1)
    const event = mockWindow.dispatchEvent.mock.calls[0][0] as MockCustomEvent
    expect(event.type).toBe('part-brep-lost')
    expect(event.detail.op).toBe('drill')
    expect(event.detail.partName).toBe('part0_v1')
    expect(event.detail.stmtName).toBe('part0_v1')
    expect(event.detail.reason).toBe('no brep solid in chain')
  })

  it('does not throw when window is undefined (SSR safety)', () => {
    // @ts-expect-error — temporarily delete window
    delete globalThis.window

    expect(() => {
      eventSink.emit('part-brep-lost', {
        partId: 'part0_v1',
        op: 'drill',
        reason: 'test',
      })
    }).not.toThrow()

    // Restore for afterEach cleanup
    // @ts-expect-error — re-assign mock window
    globalThis.window = mockWindow
  })
})
