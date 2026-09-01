# Agent Note: 分层 API 移植 — P0 基线、宿主桥接、vendored 骨架

Status: implemented

[English](2026-09-01-layered-api-p0-baseline.md) | 中文

## Problem

分层 API 迁移（移植 brepjs 栈）此前仍处于"仅设计"状态。有三件事阻碍任何实施启动：没有锁定的回归套件来守卫大规模多期移植；宿主应用仅有的 `@faicad/faijs` 的 `stdlib` 消费者在删包之前没有迁移路径；移植将要落盘的外部代码树也缺少工具骨架（独立 tsconfig 与层边界强制）。

设计文档里有两处与真实宿主发生了事实性漂移：

- 文档把 `parseScript`/`statementToLine`/`scriptToCode`/`buildArgsParts` 列为必须导出的宿主导出面。`parseScript` 是引擎内部（宿主的契约测试禁止它），后三个在全仓代码中根本不存在。
- 文档把宿主迁移目标描述为根入口 `@faicad/faijs`。宿主自己的契约测试（红线 5）禁止生产代码从根入口 import —— 只允许 `@faicad/faijs/browser`，且从中使用的每个符号必须在白名单内。

## 决策

落地了四块自包含的工作，宿主侧的切换已备好但被门禁扣住：

1. **P0 验收套件** — `packages/tests/faijs/refactor-acceptance/refactor-acceptance.test.ts`（7 个测试）：
   - 在单次 BREP 执行上断言完整**十一字段** `ExecutionResult` 契约（outputs、brepChain、terminals、infos、failedAt、brepSolids、topology、naming、compounds、changed、activeValues），包括方案先前漏列的 `naming` 字段；
   - 宿主可见的"代码文本级"面（根门面导出 `analyzeCode`/`codeToArgs`/`formatCodeLine`，且 `parseScript` 必须保持不导出）；
   - D1-0 宿主桥（见下一条）；
   - append 增量与失败语义。
   - 回归锚点（§2.8 清单)同步跑绿：core 170 + 集成 132 条，加上新套件。

2. **宿主 stdlib 迁移桥（D1-⓪，faijs 侧）** — 让 `drill`/`engrave` 既能从 `@faicad/faijs`（根）也能从 `@faicad/faijs/browser` 引入（从 stdlib re-export），并用验收断言锁定。宿主（3d_editor）侧的 import 切换**暂不执行**：宿主以打包 `.tgz` 形式引用 faijs，切换需要一次 faijs 打包 + 版本号更新，这属于发版门禁而非代码决策。

3. **vendored 骨架** — `packages/core/src/vendored/brepjs/`（含 README）、`packages/core/tsconfig.vendored.json`（携带 brepjs 原严格度：`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`，用于 D9 隔离编译）与 `scripts/check-layer-boundaries.mjs`（实现 D8 移植层规则 R1–R5）。边界脚本可用 `BOUNDARY_SRC_DIR` 自测，空树时通过；CI 挂接推迟到 P1 有内容时。

4. **方案纠错** — 上述两处漂移（宿主现清单；根入口 vs `/browser`）是实质性的，记录于此，保证下一阶段从真实契约出发。

## 备选方案

- **现在改 3d_editor 的 import。** 否决：宿主按打包 tgz 消费（`file:../faijs/faicad-faijs-*.tgz`）；对当前包换 import 会破坏构建，而重建包需版本升级（发布决策）。
- **让宿主从根入口 `@faicad/faijs` 引入。** 否决——宿主契约测试（红线：生产代码不得 import 根入口）禁止；合法入口只有 `/browser`，且需随切换一并更新白名单。
- **不做整字段契约测试**，因为 `runtime.test.ts`/`topology-naming.test.ts` 已有单项字段断言。否决：没有一条测试一次断言整个 `ExecutionResult` 形状，被静默丢弃的字段可能溜过去；方案本身就把遗漏的 `naming` 字段列为动机。
- **现在就落地整棵 vendored 树与两段构建接线。** 否决：无移植内容时空的 `tsconfig.vendored.json` 没有输入、两段构建会失败；配置与脚本已备好，构建接线属于真正引入内容的那个阶段（P1）。

## 后果

- 验收套件是全程移植的主要回归护栏：在 `packages/tests` 下运行 `npx vitest run faijs/refactor-acceptance/refactor-acceptance.test.ts`。
- 在宿主切换时（下一次 faijs 打包后），`drill` 与 `engrave` 必须加入宿主契约白名单（`contract-entry.test.ts` 的 `WHITELIST_D`），并随切换一并落地。
- `npm run build -w @faicad/faijs-core` 现阶段保持原样；vendored 两阶段编译将在 P1 接入。
- License（根包 `LGPL-2.0-only` 与 Apache-2.0 移植代码的兼容）与 brepjs 上游提交锁定仍是开放的主人决策，需在 P1 落代码前收口。