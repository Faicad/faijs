# Agent Note：在 cad.sketch 入口重新放开 ellipse 类型

Status: implemented

[English](2026-09-28-sketch-ellipse-entry-reopen.md) | 中文

## 问题

规范 sketch schema 预留了 `point` / `ellipse` / `bspline`，`toFreeCadGeoms` 对三者一律以 `E_SKETCHC_UNSUPPORTED_GEOM` 拒绝——但下游链路早已在消费它们：`planegcs-backend.ts` 推拉椭圆图元（center + focus1 + radmin）与独立点，`contour.ts` 对 bspline 采样并输出 64 段弦的闭合椭圆轮廓。op 入口 schema 比求解器链路更窄，导致 FCStd 语料库中所有含椭圆 sketch 的转换产物在运行期失败，且报的是求解器根本不会真正触到的错误（fcstd-port P2-1 类：`E_SKETCHC_UNSUPPORTED_GE`，5+ 个语料文件）。

## 决策

只重新放开 `ellipse`。`toFreeCadGeoms` 现在把规范椭圆（`cx/cy/rx/ry/angle`，angle 为弧度）投影为 FCStd 记录（`majorRadius/minorRadius/angleXU` 加上计算出的焦点对，与 FreeCAD 存储方式一致）。规范类型本身未改动——它早已声明了 ellipse 变体。`point` 与 `bspline` 保持预留：`point` 无轮廓用途（轮廓会跳过独立点），bspline 走 op 需要先做分段决策，而转换器已在上游把 bspline 降为折线。

## 曾考虑的替代方案

- **像 bspline 一样在转换器侧对椭圆做折线降级**：否决——精确路径端到端存在时，在产物脚本中降低几何精度不可接受。
- **连 `point`/`bspline` 一起放开**：暂缓——规范的独立点尚无消费方，bspline 的约束投影需要单独一轮设计。

## 后果

- 椭圆 sketch 现在可端到端求解并产生闭合轮廓；回归覆盖在 `packages/sketch/src/ellipse-sketch-e2e.test.ts`（投影焦点、规范往返、轮廓提取）以及 `op-entry-schema-gotcha.test.ts` 更新后的 GOTCHA 中（该测试现断言 ellipse 被接受，拒绝历史留在注释里）。
- `E_SKETCHC_UNSUPPORTED_GEOM` 仍只能经 `point`/`bspline` 触达。
- 语料库 stage2 中该类失败应在下一版 0.21.x tgz 安装后消失（P0-3 版本锁定纪律适用）。
