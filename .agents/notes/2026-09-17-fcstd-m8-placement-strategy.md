# Agent Note: FCStd 移植 M8 — Placement 变换策略（2026-09-17）

## 决策：特征在草图局部系构建，输出后整体重定位（M8.3）

`cad.sketch` 只在局部 XY 平面建面（法向 +Z，`api/sketch.ts` 契约），`cad.extrude`
沿局部 +Z 拉伸。因此非 XY 平面草图**不能**把 3D 坐标烘进轮廓——选择：

1. 特征（Pad/Pocket/Revolution…）全部在草图局部系构建（现状不变）；
2. codegen 在特征最后一条调用后追加 `cad.rotate_euler` + `cad.translate`
   （顺序：先转后移），旋转角来自该对象 Placement 四元数。

**选整体重定位而非轮廓烘坐标的理由**：烘坐标要求把 extrude 方向也换算成
任意 3D 向量（cad.extrude 的 height 是标量槽 `literals: [vec]` 只在局部系有意义），
而 rotate/translate 是现成 brep op，语义清晰、语句可独立调试（配合 mapping.json）。

## 实测标定（勿凭记忆改）

- **四元数分量序 = (x, y, z, w)**：FCStd `Q0..Q3`，Q3 是标量。identity = (0,0,0,1)。
- `quatToEulerXYZDeg` 与 `THREE.Euler('XYZ')` 逐例对齐（`quat-euler.test.ts`
  用 THREE 本身做 oracle，8 个用例含 PadTest 全部三种 placement）。
  矩阵约定：`M = RX·RY·RZ`（行主序），`m[2] = +sinY`——首次实现写反成
  `-sinY`，差 180°，靠 THREE oracle 测试当场抓住。
- 样本集草图局部 Z 恒为 0（探针实测 PadTest 三个草图）；非零 Z 不存在
  「投影到 (u,v)」的需求，直接显式降级 L2（reason: `sketch-geometry-off-plane`），
  不静默丢 Z。

## GOTCHA（防踩坑）

- `quatToMatrix` 归一化时 `s = 2`（分量已除以模长），不要再乘 `2/n`——双重
  缩放曾让非单位四元数测试失败。
- `rotate_euler` 的 pivot 默认原点；FreeCAD Placement 的旋转本来就是绕原点
  （平移在 p 里），所以 rotate 在 translate 之前、都不带 pivot，顺序不可换。
- 语料四元数截断到 12 位（0.707106781187），标定容差 ≤1e-5°，别设更紧。

## 测试

- `placement.test.ts`：解析 + 矩阵解析解（90°/180° 各轴）+ 往返。
- `quat-euler.test.ts`：THREE oracle（GOTCHA 留档）。
- `placement-corpus.test.ts`：PadTest Sketch002 逐点落面 + 刚体距离保持
  （skipIf 无语料）。
- e2e 三样本 golden 仍全绿（`packages/tests/faijs/fcstd/fcstd-e2e.test.ts`）。
