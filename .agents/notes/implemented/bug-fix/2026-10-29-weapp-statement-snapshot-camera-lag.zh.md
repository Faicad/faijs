# Agent Note：weapp statement-snapshot 相机滞后——先 fit 后 render

Status: implemented

[English](2026-10-29-weapp-statement-snapshot-camera-lag.md) | 中文

## Problem

真机上，AI 编辑（带流式预览的增量 `update`）之后模型明显慢一帧才跳正。weapp 页面的
`statementSnapshot` 处理器逐帧应用 mesh 更新后，先调 `render()` **再**调
`fitPreviewFrame()`：帧带着上一帧的相机上屏，fit 随后才落地——用户先看到旧取景一
帧，再看到跳动。`viewer3d.ts` 里的陈旧注释记载的恰是这个错误顺序，让 bug 看起来像
有意为之。

## Decision

statement-snapshot 处理器内逐帧顺序改为先 `fitPreviewFrame()` **再** `render()`
（`packages/weapp/src/pages/model/index.ts`）：相机先按该帧真实包围盒取景，帧再上
屏，流式帧不再带着落后几何一拍的相机展示。`viewer3d.ts` 的陈旧注释更正为真实顺序
及反序为何滞后。

顺序钉在 `execution-stream-preview.test.ts`：每个流式帧的调用记录下标必须满足
`renderAt[i] > fitAt[i]`——把两个调用再换回去会直接红，而不是只在真机上退化。

execute 收尾路径不变：完成时的 `endPreview(false)` 加 `fitView()` 仍然校正最终
状态。

## Alternatives considered

- **每帧渲染两次**（render、fit、render）。否决：真机上每个流式帧的渲染成本翻倍；
  单次渲染前先 fit 严格更优。
- **只在最终帧 fit。** 否决：AI 编辑的中间帧可能把几何挪出旧取景很远（part 被删、
  包围盒偏移），整条流期间画布空白或裁切。
- **把 fit 合并进稍后的 rAF tick。** 否决：重新引入一帧相机延迟，还把测试钉住的
  顺序不变量搞复杂。

## Consequences

- 流式帧上屏即已正确取景；AI 编辑后的相机一帧跳动消失。
- 逐帧契约（fit 先于 render）由测试强制；未来再换序会让 CI 变红，而不是作为真机
  专属回归溜出去。
