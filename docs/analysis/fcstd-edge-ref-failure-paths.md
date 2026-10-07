# `edgeRef` 失败三路径定性：nameless shape / no role lineage / ordinal 越界

状态：定性完成（2026-09-28）。三条路径全部是**契约内的结构化错误**，core 侧无可修缺陷。
（corpus 实测 nameless 77 + no-role-lineage 15 + ordinal 越界 2）。

## 产生点与定性

单点：`packages/core/src/api/edge-ref.ts`（`edgeRef()`，全部抛 `TopoRefError` 三态错误码）。

| 路径 | 位置 | 触发 | 定性 |
|---|---|---|---|
| nameless shape | edge-ref.ts:94 | 输入 Shape 无 role table（clone / 裸 handle 投影 / 上游 op 未 `recordOutput`） | **契约正确**。模块头设计为「定不了案一律抛错，绝不静默硬取」；降级语义已有测试钉住（`brep/engine/brepkit-clone-fix.test.ts` (c)） |
| no role lineage | edge-ref.ts:101 | 邻面存在但 hash 无血统（上游 op 未传播命名） | **契约正确**。结构化报错；语料侧根因是上游产物无血统，修复杠杆在上游 op 的 `recordOutput`（extrude/revolve 类已修，见 `api/extrude-roles.test.ts`） |
| ordinal 越界 | edge-ref.ts:70 | 请求的边号 > 现场边数 | **契约正确**。结构化报错带有效区间；语料侧越界是 fcstd 翻译端引用了错误边号，杠杆在翻译端 |

## 结论与杠杆

- core 侧：无缺陷可修——`edgeRef` 的职责是精确拒绝而不是猜。
- fcstd-port 侧：77 例 nameless 大头应随产物重生成（0.21.0 引擎 + 最新修复）重测；
  若重测后仍高，逐一核对生成脚本的边号来源（FeatureFillet/Chamfer 的 Base 子元素序号）。
