# Agent Note：intersect op 通过静态能力分派降级到 brepkit

English | [中文](2026-09-26-intersect-brepkit-capability-degradation.md)

## 问题

`intersect` 声明 `capabilities: ['intersectWithHistory']`。brepkit 适配器不声明 `intersectWithHistory`（其 evolution 集合恰为 `['fuseWithHistory','cutWithHistory','filletWithHistory']`，被 `evolution-declaration.test.ts` 硬编码钉死），故在 brepkit 上执行前即被拒绝，报 `lacks capability 'intersectWithHistory'`。用户要求必须支持 brepkit，指出内核有普通 `intersect(a,b)`，差异只在命名/演化扩展。

## 决策

选择方向 A（中立 op + booleanBrep 内静态分派）；被否的方向 B 见备选方案。

### `api/boolean.ts` 改动

1. `intersect` op：移除 `capabilities: ['intersectWithHistory']` → 中立 op。
2. `booleanBrep`：通过 `engineCapabilitySet(getBackends().config.brepCapabilities)` 静态定轨：
   - 引擎声明了 `*WithHistory`（occt）→ `booleanWithRoleTable` 历史路径，产出 faceEvolution + roleTable。
   - 否则（brepkit）→ L1 裸 `kernel[op](a,b)`，无 faceEvolution、不传播 roleTable。
3. `fuse`/`cut` 保留各自 `*WithHistory` 能力声明——dispatchPath gate 保证它们到达 `booleanBrep` 时引擎必已声明历史方法，`useHistory` 恒为 true，行为零变化。

### 诚实命名降级

brepkit 上 intersect 结果无面身份（lineage 节点注册为 `kind:'kernel'` 但不 attach 演化）。明确**没有**用恒等映射伪造演化表——结果实体的面 hash 与输入根本不同，恒等映射即假身份。

## 备选方案

**方向 B（defineOp 能力析取）**——否决：那会把框架级 `firstMissingCapability`/`dispatchPath` 语义从合取改为析取，爆炸半径大。方向 A 只需在 `booleanBrep` 内读同一份声明能力集做静态分支——不加新机制、不加运行时 try-catch。

## 后果

- intersect 在 occt + brepkit 2.129.15/3.4.18/4.0.32 上全部通过，bbox [16,16,20] 四引擎精确一致。
- occt 行为不变（仍用 `intersectWithHistory`，完整 evolution/roleTable）。
- 若未来 brepkit 声明了 `intersectWithHistory`，分支自动切回历史路径——无需改代码。

## 验证

- `brepkit-intersect-fix.test.ts`（4 例）：occt 历史路径（带面演化）+ 三版本 brepkit 裸路径（无演化、几何正确）。
- `multi-engine-op-parity.test.ts`：mismatches=0；intersect 从 error case（24→21）移入 parity case（129→132）。
- 守卫：`evolution-declaration`、`engine-switch-p3`、`arg-spec-capabilities` 全过。
- naming 全套（144 测试）与 mesh 路径不受影响。
