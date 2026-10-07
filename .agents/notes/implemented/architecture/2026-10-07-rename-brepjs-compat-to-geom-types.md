# Agent Note: `api/brepjs-compat` 改名为 `api/geom-types`

- 日期：2026-10-07
- 方案：docs/plans/2026-10-07-rename-brepjs-compat-to-geom-types.md

## 决策

`packages/core/src/api/brepjs-compat/` 改名为 `packages/core/src/api/geom-types/`（git mv，历史保留）。旧目录 2026-09-25 core-decouple（裁决 9）后已不含任何 brepjs 代码，只剩 core 内联的纯几何工具与类型（vecOps / planeOps / types / constants + Result 组合子桶出口），目录名是历史残留、误导读者。

## 改动面

- 目录 5+1 个文件 git mv；14 个 core 源文件的相对 import 路径 `brepjs-compat/` → `geom-types/`（`api/index.ts` 3 处 re-export、`brep-operations/` 8 文件、`brep-topology.ts`、`api/view/` 3 文件）。
- 生成文件 `api/surface/capability-map.json` 重跑 `gen-capability-map.ts` 重新生成（16 处路径更新），未手改。
- 注释更新：`src/index.ts`（保留原名括注）、`geometry2d/bridge/plane.ts`。

## 明确不改

- `packages/*/NOTICE`：「brepjs-compat facade」表述是许可证归属声明（brepjs Apache-2.0 移植代码），不随目录名失效。
- 归档 plans、`.agents/notes/` 历史记录、JSDoc 中「brepjs-compatible 签名」措辞（语义描述非路径）。
- 不保留旧路径 shim：该目录从未被外部包 import，公开符号全部经 `api/index.ts` 平铺导出且符号名不变——对外 0 破坏。

## 验证

- `npm run typecheck` 通过；`vitest run test/api/surface test/api/brep-operations test/api/brep-topology.test.ts`（core 包）113 测试全过；`npm run lint` 通过。
