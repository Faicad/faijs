# Agent Note: compatOp adopt-only —— 库边界 borrow 措辞退役

Status: proposed

[English](2026-10-07-compatop-adopt-only-terminology.md) | 中文

## Problem

L3 库边界面此前跑一条「借入 → 调用 → 收养」管线：`borrowDeep` 把每个 faijs `Shape` 实参改写成内核句柄视图，调 compat 源函数，再把产物收养回 faijs `Shape`。借入那一半现已删除——两个真实库都不需要它，因为 `sheetmetal` 与 `faijs-gears` 是 faijs 原生库、直接消费 core `Shape`。`borrowDeep`、`borrowBrepjsShape`、`createBorrowedHandle`、`compat-projection.ts` 与 `registerLib` 的 `borrow` 选项均已删除，适配器改为入参原样直传。

描述性文字没有跟上，留下四类残留：

- `api/surface/arg-spec.ts` 的 skip reason 以已删机制为论据（「数组入参本身已无障碍——`borrowDeep` 递归借入」），结论因此悬在一条不存在的前提上；
- 约十五处注释把退役管线当成现行机制描述（「句柄借入 → 调 compat 源 → Result 翻转 → 收养」），包括 `api/extrude.ts` 的失效指向、`api/internal/compat-op.ts` 的两句残留，以及 `api/internal/l3-bridge.ts` 里 `callBrepjs` 的 JSDoc；
- `docs/library-dev-guide.md` 与其中文对照仍在教 `borrow: false`——该选项在 `registerLib` 上已不存在，照做的读者写的是死配置——并把「Borrow」列为引擎执行的边界步骤；
- 生成文档把同样的措辞带进了每一章：`packages/core/scripts/gen-l3-surface.ts` 往生成 JSDoc 里写「无 vendored 借入/调用」，`scripts/gen-ops-api-inventory.ts` 把「入口 `Shape` → 借入」硬编码进 `docs/ops-api-inventory.md` 及其中文侧的三面表。

## Proposal

把措辞对齐到实际存在的机制：引擎把库入参原样直传，只在出口收养产物——adopt-only。具体：

- `arg-spec.ts`：重写 4 条以 `borrowDeep` 为论据的 reason，但不发明替代论据（`loft` 条目指向手写 `api/loft.ts` 为唯一实现路径；`guidedSweep` / `multiSectionSweep` 只保留事实结论）；把管线描述改述为「输入直传 → 调 compat 源 → Result 翻转 → 收养」，几何实参字段注释改为「由 `brepOf` 直读内核句柄」。
- `gen-l3-surface.ts` 与 `gen-ops-api-inventory.ts`：更新 JSDoc 与表格模板（「无 vendored 借入/调用」「入口 `Shape` → 借入」改为「无 compat 源中转」「入口 `Shape` 原样直传」），然后重跑两个生成器，让生成文件与常驻清单文档由生成器改写而非手改。
- `library-dev-guide.md` 与 `library-dev-guide.zh.md`：删除 `borrow: false` 教学，把边界步骤「Borrow」改成「直传」，把 `unfoldSolid` 一行由「借入零拷贝 arena 视图」改为直接消费输入 `Shape`，并从收养生命周期里去掉「借入」；两侧同步改动并重录配对 sidecar。
- 保留仍然成立的 borrow 措辞：`BorrowedShapeHandle` 与 `adoptEntity`（产物侧「不拥有、不释放」）、`brepOf`（现行取内核句柄方式），以及 `api/feature-repair.ts`、`api/internal/profile-wire.ts` 的 `borrowed` wire 视图、`api/cadquery-selectors/borrow-bridge.ts` 的内核层局部借用。

无运行时行为变更：diff 只涉及注释、文档文本与生成器模板。

## Alternatives considered

**保留 reason，只删函数名。** 否决：论据随机制一起消失。直传之下根本不存在入参改写步骤，「数组入参本身已无障碍」没有指涉物；一条无法从代码重新推导的理由，会误导这份唯一人工维护的 spec 文件的下一位维护者。

**为了措辞统一，把 `BorrowedShapeHandle` / `borrowHandles` / `borrowedShapeCache` 一并改名。** 否决：产物侧「borrowed = 不拥有、不释放」的语义仍然准确，另两处是内核层借用、属另一种机制。改名换不来收益，却为纯文档目标去动活代码。

**手改生成文档。** 否决：`docs/ops-api-inventory.md` 与其中文侧是生成器产物，文档门禁里的清单检查会因过期直接判失败；模板才是唯一正确的改动点。

**只修英文手册。** 否决：两侧在双语文档配对门禁下是同一份文档，单边改动本身就是门禁失败。

## Acceptance criteria

- 全仓搜索已删标识符（`borrowDeep`、`borrowBrepjsShape`、`borrow: false`）只命中历史 plan 与 analysis 文档。
- `arg-spec.ts` 不再携带任何以退役借入步骤为论据的内容。
- 两个生成器第二次重跑零 diff，且 `capability-map.json` 无变更。
- 文档门禁通过，含双语配对与段落换行检查，手册配对已重录。
- 目标测试通过：arg-spec / capability-map 面测试，以及 compat-e2e 的 sheetmetal、aluminum-enclosure、lib-error 三条流。

## Risks

- 手册中英两侧可能结构漂移；配对门禁只在提交时拦截。
- 删掉论据会让 skip reason 变短，损失后续 op 覆盖决策的部分依据——以指向手写实现路径缓解。
- 生成器模板变更会波及大量生成 JSDoc；此后的措辞变更必须再走生成器，绝不可改生成文件。
