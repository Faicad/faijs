# Agent Note: H3 平面支撑附着解析（Support → MapMode → AttachmentOffset）

Status: implemented

## Problem

faijs 的 FCStd 管线此前只读落盘的 `Placement` 属性。FreeCAD 在保存时会从
附着链（Support/MapMode/AttachmentOffset）**重算**该 placement，因此当支撑
框架带旋转时，直接用落盘值只是碰巧正确——附着链语义与简单拷贝一旦分歧，
几何就静默错位。这正是 H3 要闭合的失效类。

## Decision

- 新增 `fcstd/attachment.ts`，导出 `resolveAttachment(obj, placements)` 与
  `effectivePlacement(obj, placements)`。解析逻辑复合
  **支撑体 placement ∘ AttachmentOffset**（四元数 Hamilton 积）；附着未激活
  （MapMode=0）、无支撑链接、或支撑对象无 placement 时，回落到落盘
  `Placement`。
- **仅平面支撑。** corpus 探针（`fcstd-port/tools/
  probe-attachment-usage.mjs`）：29/56 文件带非 deactivated 的 MapMode——
  实际使用的值：5=mmFlatFace（68 个对象）、6=mmTangentPlane（3）、
  1=mmTranslate（1）——且所有 Support 目标都是 datum/origin 平面，此时支撑
  的框架就是基准框架。曲线/Frenet/面法向投影模式返回 undefined（不猜框架），
  corpus 出现真实需求时再按 Attacher.cpp 标定实现。
- `convert.ts` 的 placements 表改经 `effectivePlacement` 构建，附着草图落在
  其支撑框架上。
- **契约测试**：复合结果必须等于同一文件里 FreeCAD 落盘的 Placement（保存时
  重算——落盘值即真值）。由 `attachment.test.ts` 锁定（5 用例）。

## Alternatives considered

- **现在就实现 Attacher.cpp 全模式集** — 否决：corpus 证据只有平面支撑；
  曲线/面框架是大面积工作（法向投影、Frenet 框架、路径参数），56 样本零
  覆盖。不可解析时返回 undefined 使 C4 缺口契约保持诚实。
- **永远读落盘 Placement、不解析附着链** — 否决：仅在支撑框架轴对齐时碰巧
  正确；旋转的基准面会静默错位——恰是 H3 要闭合的失效类。

## Consequences

- GOTCHA 已由测试锁定：`MapMode` 是 `App::PropertyEnumeration`，存储为
  `<Integer value="N"/>`（按字符串名匹配一无所获——探针第一版匹配到 0 个
  文件）；支撑链接属性名为 `Support`（旧）或 `AttachmentSupport`（新版
  FreeCAD），两者都读。
- 接线后 56 样本复测：ok 维持 22。本 corpus 的落盘 Placement 本就反映了
  复合链（支撑面为 identity/平移），故本轮是正确性加固，不是覆盖面变化。
  13 个 `sketch-not-solved` 首因文件与附着无关。
- faijs：`attachment.test.ts` 绿；fcstd 套件 12 文件 / 117 用例绿。探针脚本
  在 fcstd-port（`tools/probe-attachment-usage.mjs`）。
