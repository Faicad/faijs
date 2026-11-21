# Agent Note：中立法上的 `projectPointOnFace`

Status: implemented

[English](2026-11-21-project-point-on-face.md) | 中文

## 问题

下游库的 `snap`/`dent` 需要**面上的最近点**。`BrepEngineApi` 只暴露了 `surfaceCenterOfMass` 与 `surfaceNormal`，没有投影；库只能采样面中心。结果：大的 `dent` 工具被放到放样曲面的错误位置，布尔把主体切空，下一次布尔就报 `getBoundingBox: shape has no geometry`。

## 决策

新增 `BrepEngineApi.projectPointOnFace(face, point): BrepVec3`。

- occt 直接映射 `OcctKernel.projectPointOnFace`。
- brepkit 与 smlib 显式失败（occt-only）；mock 原样返回查询点。
- 下游用返回点算距离；法向仍取面中心（occt 公开投影不返回 UV）。

## 备选方案

**继续用面中心近似。** 那不是最近点；调用方的工具放置与后续布尔会继承误差。不采纳。

**下游库直接访问 occt kernel。** 违反唯一适配层规则，也破坏中立法。不采纳。

**返回 `{point, uv}`。** 没有引擎在公开 API 里给出投影 UV；伪造 UV 比“面中心法向”的已记录近似更糟。不采纳。

## 后果

- `snap` 在 occt 上返回真实曲面点；法向仍来自面中心。
- `projectPointOnFace` 是 occt-only；brepkit 宿主显式失败，不会静默退回面中心。
- mock 返回查询点（只验 bbox 的测试不受影响）。
- `packages/core/test/brep/project-point-on-face.test.ts` 钉住“投影到盒面”。