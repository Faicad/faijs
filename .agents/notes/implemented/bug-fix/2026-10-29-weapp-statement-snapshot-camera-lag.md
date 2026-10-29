# Agent Note: weapp statement-snapshot camera lag — fit before render

Status: implemented

English | [中文](2026-10-29-weapp-statement-snapshot-camera-lag.zh.md)

## Problem

On device, after an AI edit (incremental `update` with streaming preview), the
model visibly jumped one frame late. The weapp page's `statementSnapshot` handler
applied each frame's mesh updates and called `render()` **before**
`fitPreviewFrame()`: the frame went on screen with the previous frame's camera,
then the fit landed — the user saw the old framing for one frame, then a jump.
The stale comment in `viewer3d.ts` documented exactly this wrong order, so the
bug looked intentional.

## Decision

The per-frame order in the statement-snapshot handler is
`fitPreviewFrame()` **then** `render()`
(`packages/weapp/src/pages/model/index.ts`): the camera is fitted to the frame's
actual bounds before the frame reaches the screen, so streamed frames are never
shown with a camera that is one beat behind the geometry. The stale
`viewer3d.ts` comment is corrected to describe the real order and why the
reverse order lags.

The order is pinned by `execution-stream-preview.test.ts`: per streamed frame,
the recorded call indices must satisfy `renderAt[i] > fitAt[i]` — reverting the
two calls fails the suite instead of regressing only on device.

The end-of-execute path is unchanged: `endPreview(false)` plus `fitView()` at
completion still corrects the final state.

## Alternatives considered

- **Render twice per frame** (render, fit, render). Rejected: doubles the render
  cost of every streamed frame on device; fitting before the single render is
  strictly better.
- **Fit only on the final frame.** Rejected: intermediate frames during an AI
  edit can move geometry far outside the old framing (parts removed, bounds
  shifted), leaving the canvas empty or clipped for the whole stream.
- **Coalesce fits into a later rAF tick.** Rejected: reintroduces a frame of
  camera latency and complicates the ordering invariant the tests now pin.

## Consequences

- Streamed frames go on screen already correctly framed; the one-frame camera
  jump after AI edits is gone.
- The per-frame contract (fit before render) is enforced by tests; a future
  reorder fails CI rather than shipping as a device-only regression.
