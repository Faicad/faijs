# cq-compat union 返回 compound 问题交接

## 问题概述

cq-compat 的 `extrude` boss 操作（在现有 shape 上挤出凸台并 union）在某些场景下返回 **compound（多个独立 solid）**，而不是融合后的单一 solid。导致装配体导出时，一个零件被 XCAF 拆成多个独立零件。

## 复现场景

`packages/mini_lathe/src/parts/slide_top.fai.js`（或 assembly.fai.js 中的 `make_slide_top()`）：

1. 创建主板 `box(110, 120, 8)`
2. `cutBlind` 切两个槽（pushPoints 两个位置）
3. `extrude` 在顶面挤出凸台 `box(20, 10, 13.7)` → **此时变成 2 个 solid**
4. 后续操作保持 2 个 solid

最终结果：凸台（2740 mm³）和主板（87268 mm³）是两个独立 solid，总体积正确但拓扑分离。

## 已排查结论

### 1. OCCT 底层正常

直接用 `kernel.fuse()` 和 `kernel.fuseWithHistory()` 测试：
- 有槽的 box + 重叠凸台 → **返回 1 个 solid** ✓
- 无槽的 box + 凸台 → 返回 1 个 solid ✓

### 2. 不是 coplanar 面接触问题

已在 extrude boss 分支加了 0.1mm overlap（`OVERLAP = 0.1`），凸台体积从 2740 变 2760（overlap 生效），但 fuse 结果仍是 2 个 solid。

### 3. 不是 cutBlind 本身产生 compound

单独 cutBlind slots 后检查 → 1 个 solid ✓

### 4. 无 cutBlind 时 boss extrude 正常

只做 `box → hole → boss extrude`（无 cutBlind slots）→ 1 个 solid ✓

### 5. 问题在 faijs 的 `cad.union` 链路

OCCT `fuse`/`fuseWithHistory` 都正常，但 `cad.union(wp.shape, boss)` 返回 compound。

调用链：
```
cq.extrude (boss 分支)
  → cad.union(wp.shape, shifted)          [defineOp]
    → booleanBrep([shape, boss], 'union')
      → booleanWithRoleTable(kernel, 'fuse', a, b, ...)
        → kernel.fuseWithHistory(a, b, ...)  [返回 1 solid]
      → solidToShape(kernel, result)
      → fromBrep(mesh, {solid, faceEvolution, roleTable})
```

`fuseWithHistory` 返回单一 solid，但经过 `solidToShape` + `fromBrep` 包装后，最终 Shape 可能变成了 compound。

### 6. 疑似根因（未确认）

以下任一可能：
- `brepOf(s)` 在 `booleanBrep` 中提取的 handle 不正确（特别是经过 cutBlind 后的 shape）
- `solidToShape` 的 `meshShape` 对某些拓扑结构返回多 group mesh
- `fromBrep` / `solid()` 创建的 Shape 对象没有正确关联单一 solid
- `defineOp` 的 brep 分派在库函数调用上下文（非 faijs 脚本语句上下文）中行为不同

## 关联 bug：cutBlind 忽略 pushPoints

`packages/cq-compat/src/workplane.ts` 的 `cutBlind` 函数只在 workplane origin 创建一个切割工具，**没有遍历 `wp.pts`**。

CadQuery 语义：`pushPoints` 后调用 `cutBlind`，应在每个点位置都切一个槽。当前实现只切了一个。

同样的问题可能存在于 `hole`、`cboreHole` 等接受 pushPoints 的函数中——需要逐一检查。

## 相关文件

| 文件 | 作用 |
|---|---|
| `packages/cq-compat/src/workplane.ts` | cq-compat Workplane 实现，extrude/cutBlind/hole 等 |
| `packages/core/src/api/boolean.ts` | `booleanBrep` / `booleanMesh` / `union` defineOp |
| `packages/core/src/brep/face-evolution.ts` | `booleanWithRoleTable` / `fuseWithHistory` 封装 |
| `packages/core/src/brep/brep-ops.ts` | `solidToShape` |
| `packages/core/src/shape.ts` | `fromBrep` / `solid` / `brepOf` |
| `packages/core/src/define-op.ts` | defineOp 分派逻辑 |

## 复现用测试文件

以下文件可用于快速复现和验证（在 `packages/mini_lathe/src/parts/`）：

- `slide_top_boss_only.fai.js` — box + hole + boss → 1 solid（正常）
- `slide_top_slots_only.fai.js` — box + cutBlind slots → 1 solid（正常）
- `slide_top_slots.fai.js` — box + cutBlind slots + boss → **2 solid（bug）**
- `slide_top_test.fai.js` — 完整 slide_top → 2 solid（bug）

检查 solid 数：
```bash
npx tsx packages/core/scripts/faijs-cli.ts run <file.fai.js> --out out.step --mode brep
# 然后用 OCCT importStep + getSubShapes(shape, 'solid') 检查
```

调试脚本在 `packages/mini_lathe/scripts/`：
- `test-fuse.ts` — 直接 OCCT fuse 测试
- `test-fuse-slot.ts` — 有槽 box + 凸台的 OCCT fuse 测试
- `test-fuse-history.ts` — fuseWithHistory 测试
- `check-*.ts` — 各种检查脚本

## 建议修复方向

1. **优先定位 `cad.union` 链路**：在 `booleanBrep` 中加日志，检查 `inputSolids` 是否正确、`fuseWithHistory` 结果是否为单一 solid、`solidToShape` 后是否变成 compound。
2. **绕过方案**：在 cq-compat 的 extrude boss 分支中，直接用 `borrowBrepjsShape` + `brepjsCompat.fuse` + `adoptBrepjsProduct` 做 union，绕过 `cad.union` 的 defineOp 链路。`brepjsCompat` 已有 `fuse` 方法。
3. **修复 cutBlind 的 pushPoints**：遍历 `wp.pts`，在每个点位置创建切割工具并逐个 subtract。
4. **验证其他零件**：修复后重新导出全部 7 个零件和装配体，确认所有零件都是单一 solid。

## 当前代码状态

- `OVERLAP = 0.1` 已加在 extrude boss 分支（临时措施，未解决根本问题）
- 装配体 `mini_lathe.step` 中 slide_top 仍为 2 个零件
- 其他 6 个零件未发现此问题（但需验证）
- 未提交：workplane.ts 的 OVERLAP 修改、各种测试 .fai.js 文件、调试脚本
