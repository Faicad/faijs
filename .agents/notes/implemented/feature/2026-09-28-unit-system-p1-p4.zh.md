# Agent Note: 单位系统 P0–P4（量纲、常量、容差、I/O、声明面）

Status: implemented

[English](2026-09-28-unit-system-p1-p4.md) | 中文

## Problem

单位系统设计要求把真正的量纲与单位处理引入 faijs：
基准单位 `mm / degree / gram / kelvin / second / ampere`、带类型值对象、跨包单位常量去重、
面向单位的 I/O 容差，以及脚本侧 `paramDims`/`retDim` 声明面。P0（角度基准 = degree）已裁定。
本 Note 记录 P1–P4 交付及其约束。

## Decision

- **P1 — `packages/core/src/units.ts`** 是单位唯一真源。暴露纯数常量（`MM`/`INCH`/`RADIAN`…）、
  类型化常量（`mm`/`inch`/`degree`…）、`ValueWithUnits` 类（方法式运算 `.add/.mul/.as/.pow`，
  因 JS 无运算符重载；`.value` 恒为基准单位）、表（`UNIT_SCALE`/`UNIT_DIM`/`UNIT_DIMS` 由同一张表派生）、
  6 个 3MF 合法长度枚举、以及 `toBase/fromBase/unitFor/unitScale`。基准不变量为
  `inch.mul(2).value === 25.4 * 2`（基准单位 mm）。角度基准为 degree。
- **P2 — 容差为带类型值。** `packages/core/src/tolerance.ts` 声明 `SEWING_TOLERANCE`、
  `DEFAULT_LINEAR_DEFLECTION` 为 `ValueWithUnits`（用 `mm.mul(...)`，绝不对对象用 JS `*`）；消费方
  调用 `.as(mm)` 保留数值（mm 尺度 = 1）同时保持量纲类型化。
- **P3 — 重复单位表去重。** fcstd `expressions.ts`、warehouse `measure.ts`、`sprocket.ts` 不再各自定义
  `INCH`/`UNIT_TO_MM` 副本，改为从 `@faicad/faijs/units` 导入。3MF 解析上移进 faijs core
  （`threemf-loader.ts`，`fflate` 解 ZIP、`@xmldom/xmldom` 解析 XML、读取 `<model unit>` → 坐标尺度、
  逐 object item 的作动变换）。
- **P4 — 声明面。** `DualOpOptions` 与 `DualOpMeta` 现携带 `paramDims`/`retDim`（类型 `DimName`）。
  `ArgSpecEntry` 同样增加该字段，`gen-l3-surface.ts` 将其透传进生成的 `defineOp` 调用与
  `script-face-manifest.ts`。新导出访问器 `dualOpMetaOf(fn)` 读取 op 的声明。
  `ExtractMetadataOptions` 增加 `opDims`，并在运行时 `check()`/`execute()`、`codeToArgs`、（经
  `runtime.check`）CLI 三处透传。手写 op（`box`、`fai_extrude`）声明真实 `paramDims`。

## Constraints 接受

- **`lang/` 不得依赖 op 注册表。** 运行时经 `dualOpMetaOf` 从已注册库汇总 `opDims` 注入 `extractMetadata`。
- **`units.ts` 保持中立叶子**，`check-platform-imports` 与 sdk/browser 零 heavy 依赖约束继续通过；无任何平台导入。
- **P4 只声明面、不做 P6 拒绝规则。** 静态量纲*校验*（`dimension` pass、`E_DIM_BARE_NUMBER`）是
  P6 工作，本范围不做。`opDims` 存在在 P6 消费它之前不改变任何行为。

## Alternatives considered

- **JS 无运算符重载** → 在 `ValueWithUnits` 上使用方法式运算（`.add/.mul/.as/.pow`），与文档约束一致。
- **各消费方各自维护单位表 vs 单一事实源** → 否决重复；把第二个 `INCH`/`UNIT_TO_MM` 表收敛到
   `@faicad/faijs/units` 导出。
- **`opDims` 由 `lang/` 直接扫描 op 注册表** → 否决（分层违规）；由运行时（或 `codeToArgs` 调用方）注入该映射。
- **`paramDims` 从 `arg-spec.ts` 直接注入 vs 运行时从已注册 op 合成** → 运行时合成胜出：反映实际生效的 op 集，
  且 `lang/` 不依赖注册表。

## Consequences

- P1–P4 相关本地测试全绿：core（`184 passed / 2335`）、fcstd（`26 / 311`）、faijs-extra ops、
  `packages/tests` 集成（`49 / 552` + parity `12`）。fai_cq_warehouse 299/300 通过；唯一失败的是
  既有的上游 CSV 数据哈希守卫，与单位系统无关。
- 两个既存守卫漂移与本次无关、未动：`check-platform-imports.mjs` 标记长期存在的 `punch-hole.ts` → occtKernel
  导入；`check-dep-lockstep.mjs` 标记 `@faicad/faijs-draw` 版本号区间不匹配。两者都不涉及 P0–P4 的改动。
- P5–P8 依用户明确范围（仅 P0–P4）尚未开始。