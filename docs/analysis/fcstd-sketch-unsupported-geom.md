# `cad.sketch` 求解期失败定性：E_SKETCHC_UNSUPPORTED_GEOM / E_SKETCHC_NO_GEOMS

状态：定性完成；**ellipse 与 point 已放开（2026-09-28）**；空 geoms 已由 fcstd
codegen 侧显式 gap（`sketch-empty-geoms`）兜住；`sketchOnPlane` 零长度线段已在 lift 层跳过；
`bspline` 仍保留拒绝（翻译端已折线化绕行）。`revolve` CONSTRUCTION_FAILED 定性见 §5。
关联：`docs/plans/2026-09-28-fcstd-port-progress-review-and-next-plan.md` §P2-1。

## 1. 产生点（faijs 侧，单点）

| 错误码 | 位置 | 条件 |
|---|---|---|
| `E_SKETCHC_NO_GEOMS` | `packages/sketch/src/op.ts:79`（`assertSketchParams`） | `cad.sketch` 的 `geoms` 非数组或为空 |
| `E_SKETCHC_UNSUPPORTED_GEOM` | `packages/sketch/src/project.ts:168`（`toFreeCadGeoms`） | canonical `SketchGeom` kind 为 `point` / `ellipse` / `bspline`（保留 schema，一期只收 `line`/`circle`/`arc`，见 `packages/sketch/src/canonical.ts:22-25`） |

## 2. 关键事实：能力缺口在 op 入口，不在求解器

`solver/project.ts` 抛错的是 **canonical → FCStd 投影**这一层；而下游对 FCStd 形几何的实际消费能力更宽：

- `packages/sketch/src/contour.ts:98,178` 已支持 `bspline`（采样成折线段）与 `ellipse`（64 弦闭合折线）；
- `packages/sketch/src/planegcs-backend.ts:166-174` 已支持 `point`（standalone GCS 点）；
- fcstd 翻译端对样条已有绕行方案：解析成 `bspline` 后由 `bsplineToSegments` 降为折线参与轮廓提取（`packages/fcstd/src/bspline.test.ts`，P4）。

即：**op 层 canonical schema 比求解器真实能力窄**。`ellipse`/`bspline` 到达 `cad.sketch` 入口即被 `toFreeCadGeoms` 拒绝，尽管求解链本身能吃。

## 3. 修复方向（供排期，未实施）

1. **首选（小改）**：`toFreeCadGeoms` 放开 `ellipse` —— canonical 增加 ellipse 变体（cx/cy/majorRadius/minorRadius/angleXU），投影到 `FcstdSketchGeom` 的 ellipse 记录；`contour.ts` 与 `planegcs-backend.ts` 已有消费路径，无需动求解器。
2. **次选（翻译端绕行，零 schema 变更）**：fcstd codegen 对椭圆草图做与 bspline 同样的降采样（折线化），代价是产物不再是精确椭圆。
3. `point` 放开与否取决于是否有真实轮廓用途（孤立点不参与闭合轮廓，现有 `contour.ts` 会跳过）。
4. `E_SKETCHC_NO_GEOMS`（空草图）：对全 construction / 全被裁剪的草图，翻译端应降级为 gap 显式 reason 或发射空 compound，而不是让运行时抛错——属 fcstd 端归类的下游症状。

## 4. 未完成部分（如实）

计划 P2-1 点名的 6 个语料样本（Drilling_1、test_profile、dovetail、TestTangentMode3-0.21、ModelFromV021、TestSketchCarbonCopyReverseMapping）未能在 `D:/Faicad/FreeCAD-library` 与 fcstd-port `state/manifest.jsonl` 中按名定位，复测未做。上述结论全部来自 faijs 源码路径证据；哪个样本命中哪条（ellipse vs 空 geoms）需在 fcstd-port 侧用其产物实测确认。

## 5. 附：`revolve` CONSTRUCTION_FAILED（drill / v-bit，2 例）定性（2026-09-28）

链路：`cad.revolve` → `revolveBrep`（`api/brep-mirror/sweepFns.ts:83`）→ `kernel.revolveVec`（OCCT 原生）。
探针实测（`packages/core/src/api/revolve-construction-probe.test.ts`，保留为可重复测试）：

| 轴-轮廓关系 | 结果 |
|---|---|
| 轮廓严格在轴一侧（x>0） | ok |
| 轮廓**横穿**轴线（x 跨正负） | CONSTRUCTION_FAILED / REVOLVE_FAILED —— OCCT 硬边界，**known-limitation，不可修** |
| 轮廓紧贴轴（x0=0） | OCCT 接受 |

结论：drill / v-bit 语料的失败属源几何关系（轮廓跨越旋转轴）或其上游轮廓提取缺陷，
非 faijs 代码缺陷；修复杠杆在 fcstd-port 翻译端（轮廓相对轴的定位/裁剪），不在 core。
