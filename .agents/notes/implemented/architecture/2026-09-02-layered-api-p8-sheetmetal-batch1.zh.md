# Agent Note: 分层 API 移植 — P8 钣金库第一批（2D/数据层 + compat shim）

Status: implemented

[English](2026-09-02-layered-api-p8-sheetmetal-batch1.md) | 中文

## Problem

P7 打通了首条 L3→L2 接线，但方案的旗舰验证——移植钣金库以证明"L3 API 面足以支撑真实工业领域库"——尚未动工。P8 是这次移植的第一批（方案 §8）：完全不碰 3D 实体的纯 2D/数据层，加上 D12 的 compat shim，作为 API 面最早期的验证点。

## 决策

1. **新建 L5 workspace 包 `@faicad/sheetmetal`**（方案 §7.7）：单一 `.` 导出、`dependencies` 为空、自带 tsconfig/vitest 配置与 D10 内核装配（`initOCCT` = `initOcctWasm()` + `bindOcctKernel()`，方案 §7.5 ④）。peer 声明为 `"@faicad/faijs-core": "*"`——见下方偏差记录。
2. **`compat.ts`——包内唯一桥接点（D12 / §9 白名单）。** 从 vendored L1 重导出 Result 机制与类型（`core/result`、`core/errors`、`core/shapeTypes`、`core/validityTypes`、`core/types`、`topologyQueryFns.Bounds3D`），并把 2D/查询 op（`line`/`wire`/`wireLoop`/`getEdges`/`curveStartPoint`/`curveEndPoint`/`isSolid`/`getSolids`）作为 **vendored L2 的直 re-export** 提供——保留 brepjs 同名同签名，使移植文件只需改 import 来源行（`from 'brepjs'` → `from './compat.js'`）。
3. **第一批原样移植**——`allowanceFns`/`bendTableFns`/`materials`/`reportFns`/`featureTreeFns`/`types`/`polygonFns`/`nestFns`/`dxfFns`/`unfoldFns`（10 文件，3575 行）+ `internal.ts`（28 行，`unfoldFns` 依赖它）。Result 消费点零改动，只改 import 来源行。`NOTICE` 记录 Apache-2.0 归属与锁定的上游 commit（O10）。
4. **精度门：`reference.test.ts` 移植并全绿（6 测试）。** `bendAllowance` 对照硬编码的 SheetMetal.Me / Machinery's Handbook 参考常数（5 位小数），外加 `BA(2A) = 2·BA(A)` 线性测试——与实现无关。

## Alternatives considered

- **compat 用手写包装函数而非直 re-export。** 否决：直 re-export 保留 brepjs 的精确泛型签名（如 `getEdges<D>(shape: AnyShape<D>): Edge<D>[]`），把移植调用方的类型偏差风险降到最低。
- **把 2D/查询 op 加进 L3 `cad.*` 命名空间、让 compat 消费它。** 第一批否决：2D 值必须是 brepjs 形态的内核句柄（如 `FlatPattern.outline` 是 brepjs `Wire`），而 `cad.*` op 返回 faijs `Shape` 包装。`cad.*` 的参与属于 3D 批次（D12 的 `fuse = cad.union` 路径），推迟。
- **现在就把 `vec*` 搬进 compat。** 否决：第一批不消费 `vec*`；它们随 3D 批次（`authorFns` 等）到来，按方案 §7.5 ⑤。
- **P8 就跑 `invariants.test.ts`。** 否决：上游当前版本 import `author`/`unfold`（3D 实体，属第二/三批）——与方案"两个精度测试都不依赖 3D"的假设不符。随 3D 批次一起推迟。

## Consequences

- `@faicad/sheetmetal` 0.1.0 是真实的 L5 包：workspace 已注册（6 个 workspace，顺序守卫 OK）、单一 `.` 导出、peer `@faicad/faijs-core`、自带 vitest 配置与 D10 内核装配。
- 门禁全绿：sheetmetal typecheck/lint/test（6 passed）；根 `typecheck`；`lint` 0 errors；`check-workspaces-order` OK（6 workspace 依依赖拓扑排序）；`check-ghost-deps` OK（504 文件）；`check-layer-boundaries` OK（237 个 vendored 文件）。
- **偏差记录**（vs 方案）：① `invariants.test.ts` 推迟到第二/三批——它需要 3D 的 `author`/`unfold`；② peer 范围与方案 §7.7 不同（`"@faicad/faijs": ">=1.0.0 <2"` → `"@faicad/faijs-core": "*"`）——npm 无法把根包当作 workspace peer 解析，故沿用 mech-lib 的 `faijs-core` peer 模式；`CONTRACT_VERSION` 仍是真正的运行期协商机制；③ 批次规模 3575 行 vs 方案估算 2940 行（上游 `types`/`unfoldFns`/`nestFns` 有增长）。
- **CI 收尾（全绿，`scripts/ci.ps1` 9/9）**：全量测试首跑暴露两类既有问题并已修复——① p5-vendored-surface 的 sweep/sketch 测试触发 occt-wasm 适配器对缺失 `sweepAdvanced` 的一次性警告（occt-wasm 3.8.4 上限），违反 stderr 零容忍；5 个触发测试内 spy `console.warn` 并断言（断言置于 `finally` 内，先断言后 `mockRestore`——`mockRestore` 会清空调用记录）。② export-jsdoc 门禁对移植文件 118 处 JSDoc 缺失（函数缺 `@param`/`@returns`、接口缺描述），已逐一补全（仅注释，零逻辑改动）；`docs/ops-api-inventory.md`/`.zh.md` 从 L3 声明重新生成。
- 版本号：root/core `0.7.5 → 0.7.6`。
