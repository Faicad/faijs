# W7 Sprocket 探测与容差标定（cq_warehouse → TypeScript）

日期：2026-09-15 ｜ 阶段：W7（Sprocket 链轮） ｜ 上游：cq_warehouse v0.8.0（`sprocket.py`）

本文档记录 W7 阶段的复刻事实与容差标定。所有数字均为实测值，取证脚本随条目给出
（`packages/fai_cq_warehouse/scripts/probe-sprocket-*.py/.ts`）。

---

## 1. 齿廓与环形复制：每齿净变换 = 纯旋转

### 取证

`scripts/probe-sprocket-outline.py`（cadquery 环境实测）：

- 单齿轮廓（`make_tooth_outline`）在 polarArray 位置阵列 + `translate(-pitch_rad, 0)`
  后，每颗齿的净变换是**纯旋转 `Rz(90° + k·a)`**（a = 360/N）：polarArray 的
  Location（平移 p·û(ka)、旋转 k·a）与轮廓的平移项恰好相消。这正是上游注释掉的
  `#1006` rotate 修正（`sprocket.py:363`）。
- 相邻齿在滚子窝底共享端点（浮点 ~1e-13 内），全齿构成**单闭合链**：
  - 平齿 5 弧/齿：窝弧(−roller_rad) + 侧弧(cp−roller_rad) + 顶弧(outer_rad)
    + 侧弧 + 窝弧；
  - 尖齿 4 弧/齿：无顶弧，两段侧弧直接交于齿尖。
- 链遍历方向为顺时针（角度递减），齿序 k = 0, N−1, …, 1。

### 处置

`src/sprocket.ts` 直接以世界坐标生成弧边（不模拟 cq 的 Workplane 栈），每齿旋转
θk = 90° + k·a，`wireFromEdges` 合成单闭合 wire → `planarFace` → `extrudeFace`。

## 2. 无倒角基体：两侧逐位一致

16T 平齿例（N=16, cp=12.7, roller=7.9375），跳过倒角步骤直接量体积：

| 侧 | 体积 (mm³) |
|---|---|
| A 侧（Python live，`probe` 脚本） | 6590.2887 |
| B 侧（TS，`probe-sprocket-nochamfer.ts`） | 6590.2887 |

齿廓顶点坐标逐位一致（outer_pt = (34.475436, 2.000023) 两侧同值）。尖齿例
（16t-inch，无倒角）成品 STEP 比对 vol 3.4e-12% —— 齿廓复刻无任何公式误差。

## 3. 平齿倒角：cq chamfer 的角部近似 vs 解析锥环切割

### cq 语义取证

`scripts/probe-sprocket-chamfer.py`（32T flat 实测）：

- 倒角面构成 `{'PLANE': 2, 'CYLINDER': 128, 'CONE': 64}`：CONE 64 = 顶 32 + 底 32，
  即 cq `chamfer(0.25t, 0.5t)` 在齿顶圆（半径 outer_rad）**上下两圈圆边**各生成
  一个锥面。
- 锥面母线：顶边锥面过 (r = R − 0.25t, z = 0) 与 (r = R, z = t/2)，斜率 dr/dz = 0.5；
  底边镜像。两锥面在赤道 z=0、r = R − 0.25t 处尖点相接。

### B 侧实现

内核 `chamferDistAngle` 的第二面 F 由内核自选、调用方不可指定
（`core/src/brep/engine/primitives.ts` 契约），不可用。改用解析锥环切割：

```
cutterTop    = cylinderBetween(R+m, 0, h) − cone(R−0.25t, R−0.25t+0.5h, h)
cutterBottom = mirrorAbout(cutterTop, z=0)
```

第一版锥环起面放在 z=t/2（赤道以上无材料、切削无效，只削掉一半：19.24 vs 37.99），
修正为从 z=0 起面后与 cq 锥面精确重合。

### 残差与标定（§7.3.1 四步）

倒角修正后两侧体积差从 0.29% 降到 ~7e-5 相对（B 侧仍略大 = cq 削得略多）：

| 用例 | vol 相对差 | CoM 差 (mm) | bbox 差 (mm) |
|---|---|---|---|
| sprocket-16t | 7.112e-5 | 5.731e-4 | 1.4e-7 |
| sprocket-32t-mount | 4.851e-5 | 4.766e-4 | 1.3e-7 |
| sprocket-16t-inch（尖齿，无倒角） | 3.4e-12 | 8.2e-13 | 0 |

根因：cq `BRepFilletAPI_MakeChamfer` 在 32×2 个弧-弧交点角部有近似处理，
本实现锥面解析精确——**倒角面本身重合，残差全部来自角部**（无倒角基体逐位
一致佐证）。

门禁（`src/testing/compare.ts` 逐类 override，实测最坏 ×~4）：
`sprocket-(16t|32t-mount)` → `volumeRelativeTolerance: 3e-4, linearTolerance: 2.5e-3`。
反向守卫（`sprocket.test.ts`）：沿用全局默认 1e-6 时两例必须 DIFFERENT。

## 4. 32t-mount 与上游测试硬编码的差异

A 侧实测 15852.685 vs 上游 `sprocket_and_chain_tests.py` 硬编码 15851.937
（~0.05%）。manifest 已记 `expect_diff: 0.749`；以本管线实测为基准
（上游硬编码疑为旧版本 cadquery 的产物），比对阶段不受影响。

## 5. flat 判定

上游用拉伸体圆边 unique 半径数 == 3 判定（窝/侧/顶三半径）；数学等价于
`make_tooth_outline` 的分支条件 `outer_pt.y > 0`。本实现用后者（纯公式，免拓扑查询），
`flatTeeth` 派生量与 A 侧三例实测一致。
