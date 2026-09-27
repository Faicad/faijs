# Agent Note: E5 — 草图→3D 出口声明式落地

Status: implemented

[English](2026-09-27-sketch-to-3d-exits.md) | 中文

## Problem

方案 E5 要求一个携带 wire、默认 origin/坐标系与 baseFace 的 `Sketch`/`CompoundSketch` 包装，暴露 `extrude`/`revolve`/`sweepSketch`/`loftWith` 三个 3D 出口。brepjs 恰好把这一整块做成**有状态**草图 DSL（`Sketch`/`Sketches`/`FaceSketcher`/`CompoundSketch` 类 + `sketch*`/`compoundSketch*` 函数），每个实例持有 kernel 引用与草绘平面。但 `arg-spec` P14 batch 10 已把整层登记为 `kind:'skip'`，理由声明：faijs 用 `cad` 命名空间的声明式 op 表达建模，不上草图状态机。

## Decision

E5 按 `arg-spec` 既定 skip 裁决落地，交付形态是**验证型**里程碑，而非新造 `Sketch` 类。有状态 `Sketch` 会提供的四个 3D 出口，用已就位的声明式链路逐条钉死：

- `cad.sketchOnPlane({contours, plane})` 是放置步（即「baseFace + 默认 frame + wire」）；
- `cad.extrude` / `cad.revolve` / `cad.sweep` / `cad.loft` 是四个 3D 出口；
- `cad.punchHole` 已覆盖 `CompoundSketch` 的「孔=独立实体 cut」语义。

`sketch-to-3d-e2e.test.ts` 断言「一个经 `sketchOnPlane` 的草图，从四个出口各产单一正体积实体」：extrude（w·h·d）、revolve（车削环固体）、sweep（截面沿 wire 脊柱）、loft（两个放置截面）。不新增 op、无状态机、无 kernel 句柄所有权泄露。

## 值得留档的 GOTCHA

**revolve 的轴必须落在草图平面内。** 把 XY 平面草图绕正交的 Z 轴旋转，扫出的区域 z=0——是平盘/平环，OCCT 体积为 0（bbox zmin=zmax=0）。要得到立体车削件，轴须在平面内（例：XY 草图绕 Y 轴转，得 `π(R²−r²)·h`）。e2e 断言了精确的 `π(8²−4²)·4≈603` 垫片体积，并把错轴情况记作已知避免项。

## Alternatives considered

- **移植 brepjs `Sketch`/`CompoundSketch` 状态机。** 未采纳：`arg-spec` P14 已把状态化草图 DSL 整层记为 skip；faijs 用声明式 op 表达同等能力。再引入持有 kernel 的调度器会重新带来句柄所有权与 dispose 生命周期的回潮。
- **轻量纯 TS `Sketch` 门面（不持 kernel）。** 本次范围未采纳：声明式 op 已覆盖能力；再包一层主要是 re-export，多一套待维护的 API 表面。

## Consequences

- `sketch-to-3d-e2e.test.ts` 逐个钉死放置草图的四个 3D 出口——补上了原先缺失的 revolve 覆盖（此前仅验过基于 profile 的 revolve，从未验过「放置的草图」）。
- 计划 E5 条目标注「已落地（验证型）」；`arg-spec` 的 skip 决策保持不变。
- 修正了 `threemf-extrude-chain.test.ts` 的历史 `Map.find` 类型错（运行时被 skip，但阻塞 core `tsc --noEmit` 门禁），改为 `outputs.get(asPartName(...))`，门禁恢复干净。