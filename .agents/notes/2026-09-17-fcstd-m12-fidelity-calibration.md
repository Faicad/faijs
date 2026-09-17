# Agent Note: FCStd 移植 M12 — 保真度标定与验收报表（2026-09-17）

## M12.2：4 个 L1 全部定位（三元组）

| 文件 | 草图 | 成因 | 约束构成 |
|---|---|---|---|
| `src/Mod/CAM/CAMTests/Drilling_1.FCStd` | Sketch | unsupported-constraint | InternalAlignment×8（B-spline/椭圆对齐） |
| `src/Mod/CAM/DemoParts/hole_puzzle.fcstd` | Sketch005 | delta=1.0e+2（错解） | Coincident×5+H/V+Angle |
| `src/Mod/CAM/Tools/Shape/taperedballnose.fcstd` | Sketch | delta=1.7e-1 | 21 条混合约束含 Symmetric |
| `src/Mod/Sketcher/SketcherTests/TestSketchCarbonCopyReverseMapping.FCStd` | Sketch001 | delta=1.0e+1 | 含 Symmetric/Angle×5 |

**InternalAlignment(15) 不升级 P0**：仅 Drilling_1 一个文件命中（8 处集中在
单一草图，服务于 B-spline 内部对齐），升级收益 1/126 草图、需实现
B-spline/ellipse 几何对齐求解，性价比不支持。维持显式降级 + reason。

**注意**：同一 Drilling_1 草图在定位脚本（解析外部几何→L1）与转换器
（外部几何未解锁预判 L2）之间级别不同——G9 资产测试按转换器真实行为
钉住，M13.3 解锁外部几何后两者自然一致。

## M12.1：T1 标定（125 收敛草图）

非零 delta 双峰分布：12 个在 1e-16~3.6e-15（浮点噪声，真收敛），3 个在
1.7e-1~1e2（错解，即上表 delta-exceeds 三项），**1e-9~1e-6 中间地带空缺**。
结论：`T1 = 1e-6` 保留——阈值降到 1e-8 不改变任何分类，但现在有分布依据
（`scripts/calibrate-t1.ts` 可重跑），不再是拍脑袋写死。

## M12.3：V6 可重跑（当前 FAIL，如实记录）

`scripts/verify-geometry.ts`（体积/质心/bbox，全部三角网格散度定理计算，
禁用 `getVolume`——BRepGProp 精确积分与网格口径混叠）。实测 PadTest：

- truth（Tip=Pad002 的 .brp）= 48199 mm³ vs rebuilt = 230000 mm³，relErr 377%
- **FAIL 是正确诊断而非脚本缺陷**：rebuilt 只含 Pad（基特征），Pad001
  （UpToFace）/Pad002（UpToLast）已按 M9 显式烘焙——产物本就少于原模型。
  覆盖率提升（M13）后该门槛才可能达标；当前门槛值 V6 PASS 需 relVol<1%
  且 bboxDiag delta<0.5。

**踩坑留档**：FreeCAD 写出的 .brp 首行是 `DBRep_DrawableShape`，
`CASCADE Topology V1` 在第二行——用 `includes` 判定，不能用 `startsWith`。

## M12.4：V5 双口径（可重跑 `scripts/coverage-report.ts`）

- 口径①全量对象：1838（Python 系 990，占 53.9%）
- 口径②非 Python：848，其中白名单+基准面+草图可覆盖 556 = **65.6%**
- 不可覆盖主力：Fem::Constraint* 系列、TechDraw、Part2DObjectPython

## M12.5（V4 人工抽样）：留给用户

`freecad/` 影子已保证字节级保真（V1），人工验证需 FreeCAD 实机打开 ≥3 个
样本核对，无法自动化——未执行，如实留空。

## 测试

- 新增 `packages/tests/faijs/fcstd/fcstd-g9-contour.test.ts`（真实 L1 语料
  的 contour.json 落盘 + G7 一致性不变）
- 新增 `scripts/locate-l1-sketches.ts` / `calibrate-t1.ts` /
  `verify-geometry.ts` / `coverage-report.ts` 四个可重跑脚本
- fcstd 13 文件 / 97 用例全绿；e2e 不受影响（本阶段无源码行为变更）
