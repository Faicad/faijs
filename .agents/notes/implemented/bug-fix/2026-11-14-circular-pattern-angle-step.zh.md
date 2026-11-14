# Agent Note: circularPattern 收「步距角」，不收名义全角

Status: implemented

[English](2026-11-14-circular-pattern-angle-step.md) | 中文

## Problem

`circularPattern` 的第 4 个参数原本叫 `fullAngle`，文档称其为「总扫过角度」，但没有任何一层按这个意思实现：各层一律把它除以 `count` 当每份步距用（`replicate.ts`、`patternFns.ts`、`smlibKernel.ts`），而 occt-wasm 自己的原语收的是「总角度（弧度）」并内部再除以 `count`。于是「4 份、相邻 30°」的调用要填 120 —— 这个数与「总跨度」（90°）和「步距」（30°）都不是同一个数。只有 `fullAngle = 360` 自洽：`360 / count` 既是整圈等份、又是闭环相邻孔距，所以缺陷长期没被发现。

## Decision

参数改为 `angleStep`，单位度：`count` 份（含原件）位于 `0, step, …, (count−1)·step`，缺省 `360 / count`。`fullAngle` 彻底删除，不留别名。校验：`count` 必须是正整数；`count > 1` 时步距为 0 或 `|step| ≥ 360` 在两面都拒绝（脚本面 `[api/circularPattern] angleStep …`，兼容面 `PATTERN_INVALID_STEP`）。occt 适配器改为把文档口径的步距换算成 occt-wasm 的「总角度弧度」形态（`count · step · π/180`），不再把步距直传。brepkit 适配器只能做整圈等分，`angleStep ≠ 360 / count` 时显式失败，而不是返回角度错位的实例。

## Alternatives considered

- **保留 `fullAngle`，只在文档里说明它等于 `count × step`。** 否：名字说的是「阵型扫过多少度」，值却是一个只在 360° 时才与现实吻合的名义乘积，且每个调用方都得自己算这个派生数。
- **`fullAngle` 与 `angleStep` 并存，前者标废弃。** 否：一个概念两种写法会让错误心智模型继续存活，每个调用点都变得有歧义；仓内也没有脚本面调用方需要迁移。
- **改名 `spanAngle` / `totalAngle` 并除以 `count − 1`。** 否：那才贴合「首末跨度」，但两个内核都不这么工作（occt-wasm 与 SMLib 都按步距旋转），且 `count = 1` 会除零。内核的 API 就是步距，表面 API 也就是步距。

## Consequences

- `circularPattern(shape, axis, 4, 30)` 现在就是「4 份、相邻 30°」，与 SMLib、occt-wasm 内部形态一致；闭环仍是 `angleStep = 360 / count`（显式或缺省），整圈调用点不变。
- occt 适配器的改动超出改名，是一处行为修复：把步距直传给 occt-wasm 得到的是 `step / count` 弧度，`(30, 4)` 实际生成 69.7° 的四处实例。`test/api/circular-pattern-step.test.ts` 钉住内核层角度读数与融合 bbox 对「手工旋转基线」的等值；`test/smlib-kernel/circular-pattern-step.test.ts` 在 SMLib 上钉同一契约，可选 wasm 包缺失时整套 skip。
- `arg-spec.ts` 与生成的 L3 表面（`api/generated/*`）都换到新名；`docs/ops-api-inventory.md` 及其中文对偶由 JSDoc 重新生成。
