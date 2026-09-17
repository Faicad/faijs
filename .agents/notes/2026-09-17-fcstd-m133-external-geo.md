# Agent Note: FCStd 移植 M13.3 — 外部几何全量解锁（2026-09-17）

## 变更

转换器（`scripts/fcstd-to-fai-zip.ts`）取消 `external-geometry` 预判 L2：
带外部几何引用的草图现在走 M6.3 真实解析——源对象 .brp 边经 OCCT 提取、
投影到草图局部 2D，作为不可变目标（geoId -3..-N）交给求解器。解析失败
（无可用链接/源形状不可加载）才烘焙，reason
`external-geometry-unresolved: <首条失败原因>`。

## 实测效果（Drilling_1.FCStd）

- 转换前：带外部几何的草图全部 L2 预判（即 M12.2b 测试钉住的旧行为）
- 转换后：translated=17、sketches **L0=13**（外部边参与求解并收敛）
- 定位器（locate-l1-sketches.ts）与转换器的口径差**消除**——M12.2b
  GOTCHA 中记录的「同一草图两边判级不同」不复存在

## 测试状态

- fcstd 13 文件 / 102 用例全绿
- G9 真实样本测试（fcstd-g9-contour.test.ts）通过——Drilling_1 中仍有
  L2 草图（InternalAlignment×8 的 Sketch 属 unsupported-constraint），
  contour.json 落盘 + assets/mapping 1:1 断言不变
- e2e 三样本全绿，基线不变（三样本草图均无外部几何引用，路径不受影响）

## GOTCHA

- `external-geometry` 作为 reason 语义已变：预判时代=「见外部引用即烘焙」，
  现在只有解析失败才出现（且带 `-unresolved` 后缀格式）。依赖旧 reason
  做断言的测试需同步。
- solve 传入的外部目标仅取 `polyline.length === 2`（两点线段）——曲线边
  投影多点的情形暂不进求解器，落 L1/L2 由 delta 判定。
