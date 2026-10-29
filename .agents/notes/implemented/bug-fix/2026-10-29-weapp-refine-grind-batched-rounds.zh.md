# Agent Note：weapp 精化磨盘——分批推进、超时收口

Status: implemented

[English](2026-10-29-weapp-refine-grind-batched-rounds.md) | 中文

## Problem

真机上，weapp 的精化流程在 `execute` 之后一磨就是几分钟：精化状态在 refine→idle→
refine 之间闪烁，part 被反复重三角化。三个机制叠加：

1. **超时语义。** 触到 `REFINE_TIMEOUT_MS` 的轮次把控制器打回 `idle`，缩放随即重发
   同一个全量批请求。每次重发都从头重做全部工作（0.45.17 之前的 faijs 没有同密度
   跳过），于是超时保证了下一次缩放又是一整轮——磨盘循环。
2. **一次性成批。** `fire()` 把整个目标列表作为单个 `retessellate` 请求发出。一个
   慢 part 就让整批撞上单请求预算（5 s；真机每 part L1 实测 3.4-9.4 s），大多数
   轮次超时且颗粒无收。
3. **重新武装的轮次重做已完成的工作**——引擎把同密度请求当完整工作。

## Decision

精化轮次分批推进、超时收口（`packages/weapp/src/core/refine-controller.ts`，线上
类型加宽在 `packages/platform/src/execution/protocol.ts`、`instruction-core.ts` 与
`contract.ts`）：

- `REFINE_BATCH_SIZE = 1`（可经 `RefineTiming.batchSize` 覆盖）。`fire()` 快照目标
  交给 `runRound()`：按批大小切片、每批发一个 `retessellate` 请求、**每批到达即
  apply**——部分精化落库，不再被超时整批吞掉。逐批重挂超时。批大小 1 让真机大多数
  part 留在 5 s 预算内（批 2 实测约 7 s，超预算）；批间 `postMessage` 成本在两个
  平台都可忽略，disarm 在批边界依然有效。
- **超时把轮次收口为 `refined`**，不是 `idle`：轮次 generation 递增、phase 一次性
  置位、上报一个 `RefineTimeoutError`。收口的轮次不能被缩放重触发；下一次
  `execute` 干净地重新武装。被杀轮次的迟到响应由 generation 检查丢弃。请求被拒仍
  回 `idle` 并走 `onError`（可重试——语义不变）。
- **平台线型：** `RetessellateSkippedPart.reason` 加宽为
  `'no-solid' | 'same-density'`，`instruction-core` 把
  `{ skipped: 'same-density' }` 结果路由进 `skipped` 列表、不拷几何——消费 faijs
  0.45.17 的幂等跳过，重新武装的轮次对已精化 part 近乎零成本。

钉在测试里：`refine-controller.test.ts`（逐批推进每批 apply、批间 disarm 停轮、
中途超时收口并丢弃迟到响应、批 reject 整轮回 `idle`、`batchSize` 覆盖、超时后缩放
不重触发、重新 arm 恢复精化）与 `instruction-core.test.ts`（同密度结果带原因落
`skipped`、无几何传输）。

## Alternatives considered

- **更大批次（5-10）换吞吐。** 被实测否决：真机每 part L1 为 3.4-9.4 s，对上每批
  5 s 预算；更大批次让大多数批超预算、更早收轮、落库更少。
- **保持超时→idle，只靠引擎跳过。** 否决：缩放仍会每次重请求全部 part；跳过让重
  请求变便宜，但轮次搅动（状态闪烁、反复 wire 流量）还在。
- **逐 part 超时且轮次继续**（跳过慢 part 接着跑）。否决：没有 worker 的逐 part
  进度，挂死的请求与慢请求无法区分；收口轮次、让下一次 `execute` 重新武装是确定性
  的。
- **按观测的逐 part 耗时自适应批大小。** 暂缓：还没有测量通道；对当前真机逐 part
  成本，常数 1 就是实测最优。

## Consequences

- 磨盘循环两头都被打破：轮次增量落库（逐批 apply 让超时后仍有成果）、超时终结本轮
  精化而不是重启它、重新武装的轮次靠引擎同密度跳过略过已精化 part（node 复现：
  第二轮相同请求 2.2 s → 55 ms，零更新）。
- 轮次进行中缩放会在下一个批边界 disarm 并以新目标重新武装；超时收口后，缩放不再
  触发任何事，直到下一次 `execute` 重新武装。
- 超时错误每轮上报一次，不是每批一次。
