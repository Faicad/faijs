# Agent Note: BREP-only 倒角 op（equal / twoDistances / distanceAngle）

Status: implemented

[English](2026-09-01-chamfer-brep-only-op.md) | 中文

## Problem

`cad.*` op 集合一直没有倒角（chamfer）。需要倒角的零件无法用 `.faijs` 表达，引擎面板也没有倒角功能。倒角是 BREP 专属操作，必须挂在 BREP 链上，并通过实时拓扑解析取得棱边身份：一个 `EdgeTopoRef` 是用两个 `RoleQualifier`（相邻两面）描述一条棱边，与任何预计算的面/棱序号无关。操作同时要把三种公开类型（`equal`、`twoDistances`、`distanceAngle`）一一映射到 OCCT 的两个内核原语（`chamfer`、`chamferDistAngle`）上。

## Decision

`cad.chamfer(part, { edges, type, width | width1/width2, angle })` 通过 `defineOp({ capabilities: ['directEdit'], brep })` 声明为 BREP 专属 op，注册进命名空间、符号表、`api.d.ts`、op-set 一致性测试与生成的 ops 清单。

- 逐棱解析：每个 `EdgeTopoRef` 基于当前零件实时构建解析上下文（`buildEdgeContextFromSolid`），后续倒角看到的是随每步演化后的实体。
- `equal`：每条棱一次 `kernel.chamfer(solid, [edge], width)`。
- `distanceAngle`：每条棱一次 `kernel.chamferDistAngle(solid, [edge], width, angle)`；`angle` 校验在 (0, 90) 内。
- `twoDistances`（§3.5 换算）：内核自选参考面（`getSubShapes(solid, 'face')` 中第一个含该棱的面）；宽度按「内核参考序号」与 `EdgeTopoRef.faces[0]/faces[1]` 的解析序号比对来映射（width1→faces[0] 侧，width2→faces[1] 侧），再 `θ = atan2(dO·sinβ, dF − dO·cosβ)`（β = 180° − 二面角）；反射（β ≥ 180°）抛 `E_CHAMFER_REFLEX_EDGE`。
- 校验（`assertChamferParams`）：空 `edges` → `E_CHAMFER_NO_EDGES`；`faces` 不成对 → `E_CHAMFER_BAD_EDGE_REF`；`type` 枚举 → `E_CHAMFER_BAD_TYPE`；`width` 非正 → `E_CHAMFER_BAD_WIDTH`；`angle` 越界 → `E_CHAMFER_BAD_ANGLE`。mesh-only 输入走现有分派规则的 `E_MESH_UNSUPPORTED`——倒角不声明 mesh 实现。

## Alternatives considered

- **同时声明 mesh 版倒角**：否。倒角在几何上就是 BREP 专属，mesh 兜底只能假近似；分派器正确报 `E_MESH_UNSUPPORTED` 而不近似。
- **只保留扁平 width/angle 一个签名**：否。丢失 `equal/twoDistances` 的易用性，逼调用方自算换算；三种形态贴合方案与 OCCT 内核侧。
- **要求用户手动指定参考面**：否。确定性来自方案规则（内核枚举次序）且已被测试覆盖；让用户指定只增加 API 面与出错路径。
- **把 `twoDistances` 并入 `distanceAngle`**：否。'twoDistances'（两侧两个偏距）是常见 CAD UX，方案文档把它作为一等 type。

## Consequences

- `chamfer` 成为真实 op 面：符号表（31 项含 chamfer）、`api.d.ts`、`ops-api-inventory` 生成清单、op-set 一致性测试全部覆盖。
- `equal` 是 OCCT 精确输出，体积变化量用测试量化（`0.5·w²·L`），不手调。
- `docs/ops-api-inventory.md` 预算从 3000 提升到 3300：自动生成的 API 手册必须列出每个公开 op，之前的余量只有约 6 个词。
- `@qual` 置 `ok`：op 已实现并有测试，BREP-only 路由是有意的且已在该条目注释中说明。

## Verification

- `chamfer-math.test.ts`（6 例）：§3.5 换算行——正立方体 1:1 → 45°，2:1 → 26.5651°，1:2 → 63.4349°，60° 二面角 2:1 → 30°，120° 3:1 → 13.8979°；法向夹角的 clamp；reflex 抛错。
- `packages/tests/faijs/chamfer/chamfer.test.ts`（8 例，真实 OCCT）：`equal` width=1 → 减体积 `½·1·20 = 10` 且面数 6→7，BREP 链存活；`twoDistances` 1×3 → 减体积 30；`distanceAngle` 2@30° 可执行；错误路径（`E_CHAMFER_NO_EDGES`、`E_CHAMFER_BAD_EDGE_REF`、`E_CHAMFER_BAD_WIDTH`、`E_CHAMFER_BAD_ANGLE`、`E_MESH_UNSUPPORTED`）均在 console spy 内断言 stderr 零容忍。
- 全量：core 818、stdlib 46、`packages/faijs` 230 全绿；根/list 级 typecheck、lint、build 与 CI 流水线通过。
