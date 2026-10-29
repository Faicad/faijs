# Agent Note：retessellate 的同密度幂等跳过

Status: implemented

[English](2026-10-29-retessellate-same-density-idempotent-skip.md) | 中文

## Problem

真机上 weapp 的精化流程一磨就是几分钟：每一轮重新武装（re-arm）的精化都把所有请求
的 part 从头重三角化一遍——哪怕显示 mesh 已经在目标密度上。`retessellate` 只有一种
跳过——静态的 `notApplicable`（无 BREP solid）——同密度请求被当成完整工作：真机每
part 数秒的三角化（比 node 慢 30-60 倍）、MB 级几何跨 worker 线拷贝、逐字节相同的
mesh 重新渲染。会重新武装轮次的宿主（超时后重执行、缩放重触发）一次又一次付这笔
钱——即「精化磨盘」症状。

## Decision

`retessellate` 对每个 part 在解析密度相等时幂等
（`packages/core/src/cad-runtime/runtime.ts`，随 0.45.17 发布）：

- `RetessellatePartResult` 增加第三个变体 `{ skipped: 'same-density' }`，与几何
  结果、`{ notApplicable: 'no-solid' }` 并列。跳过的 part 不传任何东西；宿主视为
  完成。
- 私有 `refinedDensityCache: Map<PartName, RefinedDensityRecord>` 在每次成功精化后
  记录两个解析后的密度数值，以及存进 `brepChain.meshShapeCache` 的那份 mesh 的
  **对象引用**。
- 跳过判据是**引用同一性**：仅当记录存在、`meshShapeCache` 现存条目仍是同一对象
  （`=== record.mesh`）、两个解析密度完全相等时才跳过。一切改写或删除显示 mesh 的
  路径——执行写入（`setSolidAndTess`）、延迟物化（`getLiveOutput`/
  `getCachedOutput`/`materializeOne`）、更细的精化、`releasePartCaches`、
  `dispose`——都会改变或移除该引用，记录因此自失效，不需要任何事件钩子。
- 记录随 mesh 一起在 `releasePartCaches` 中删除、在 `dispose` 中清空。

钉在 `test/tessellation-lod.test.ts`：幂等（第二次同密度精化返回跳过，mesh 引用与
语句内容指纹一概不动，更细密度照常精化）与失效（重新执行换新 mesh 后同密度照常
重算——陈旧记录永远掩盖不了新几何）。

## Alternatives considered

- **从每个 mesh 写入点失效记录**（事件式穿线）。否决：每个 part 的显示 mesh 槽
  本来就只有一个权威对象；与真正被精化的那份对象做比较不可能陈旧，也不需要新的
  失效调用让未来的写入路径去记得调。
- **把原几何当 `updated` 返回。** 否决：每轮 re-arm 都要为相同数据付出 MB 级跨线
  拷贝、version-store 写入与重渲染。显式跳过变体让重新武装的轮次免费。
- **浮点容差的密度比较。** 否决：相同输入解析出相同浮点，精确相等才是正确的同一性
  判据；容差可能放过本应执行的更细请求。
- **宿主侧 memoization**（weapp 自己记住精化过什么）。否决：显示 mesh 的事实源在
  runtime；宿主侧记录在 worker 侧重写后即陈旧，也看不到增量 update 的失效。

## Consequences

- 重新武装的轮次不再重做已完成的工作。皮卡丘模型的 node 复现（流式 execute、19 个
  终端）：首轮全量 L1 精化约 2.2 s；紧随的第二次同密度轮次约 55 ms 返回、零更新；
  增量 update 后的重精化只触及 update 真正换过 mesh 的 part；全量重执行后全部
  重算（记录正确失效）。
- 变宽的联合类型对假设只有两个变体的消费方是破坏性变更。3d_editor 宿主用判别字段
  收窄（`'skipped' in result`），并在自己的线上以 `'no-solid' | 'same-density'`
  透出原因。
- 跳过的正确性依赖 worker 每个 runtime 串行：流式预览的 mesh 写入在宿主武装精化前
  落定（宿主在 execute 后驻留），引用检查看到的是已落定状态。
- 仍开放、不在本次范围：part 的解析密度未通过 API 暴露；想知道「这个 part 现在是
  什么密度」的宿主仍需跟踪自己的请求。
