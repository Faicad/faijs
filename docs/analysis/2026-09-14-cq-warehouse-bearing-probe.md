# W6 Bearing 探测与容差标定（cq_warehouse → TypeScript）

日期：2026-09-14 ｜ 阶段：W6（Bearing 5 类） ｜ 上游：cq_warehouse v0.8.0（`bearing.py`）

本文档记录 W6 阶段发现的三类问题及处置：**两处上游语义复刻缺口**（已修复）与
**两处 A/B 比对伪差**（已按类标定 override）。所有数字均为实测值，取证脚本与
复现路径随条目给出。

---

## 1. 上游语义缺口一：tapered cup 的 `vertices().fillet(r34)` 静默丢角

### 现象

`SingleRowTaperedRollerBearing('M17-40-13.25','SKT')` 两侧分阶段体积对照
（races = 外圈 + 内圈 fuse）：

| 阶段 | A 侧（Python live） | B 侧（TS） | 差 |
|---|---|---|---|
| races（M17） | 6501.2910 | 6474.6245 | **26.6665（0.41%）** |
| races（M15） | 7649.7836 | 7649.7836 | 0 |

### 取证

- 上游 cup 截面构造：`Sketch().push(...).trapezoid(...).reset().vertices().fillet(r34)`。
  M17 的 2D 截面输出 `LINE 4 + CIRCLE 3` —— **4 个角只有 3 个被倒圆**；
  M15 输出 `LINE 4 + CIRCLE 4` —— 全部倒上。cadquery **静默**跳过，无告警。
- 被丢的角恒为 **(r=D/2, h=C)**（顶边-外圆柱角，cq 顶点序第 2 个）。
  全部 26 个 SKT tapered 尺寸逐一生成验证：**14 个丢角、12 个保留**，丢角者无一例外
  都是该角（取证：`scripts/kernel-bearing-probe.py` 第 3 段）。
- M17 丢角使 cup 外圆柱面高 10（=C−1）而非 9（=C−2·r34），torus 少 1 个。

### 为什么不能解析复刻

| 候选规则 | 预测 | 实测 | 结论 |
|---|---|---|---|
| 顶边长 < t₁+t₂（两切点占用） | m15（2.0 < 2.17）也该丢 | m15 全倒 | ✗ |
| fillet 圆相交（圆心距 < 2r） | m15 圆心距 1.381 < 2.0 该丢 | m15 全倒 | ✗ |
| 圆弧段相交 | m17 交点方向 30.9°/157.9° 均不在 A 弧 [0,−80°] 内 | m17 却丢 | ✗ |
| w/(t_slant+t_right) 比值分界 | bad ≤1.52 / ok ≥1.73，无样本区间，分界未知 | — | 无法闭式 |

另实测：OCC `BRepFilletAPI_MakeFillet2d` 对同一 face、同一顶点集，**添加顺序不同
结果不同**（cq `vertices()` 顺序 → 成功丢 1 角；sorted 顺序 → `Build()` 整体
`StdFail_NotDone`）。内部机制无法黑盒化简。

### 处置（数据驱动，零启发式）

- 新增 `scripts/gen-fillet-drop.py`：cadquery 环境逐尺寸实测 `drop_top_outer` 布尔，
  写 `src/data/tapered-fillet-drop.json`（26 尺寸 / 14 丢角，JSON 自描述来源）。
- `src/bearing.ts`：`filletedPolygonEdges` 增加 `skip` 参数（跳过指定角的圆角）；
  `taperedCupEdges` 按 `dropsTopOuterCorner(size)` 查表跳过第 2 角。
- 修复后 M17 races 差 26.67 → **0.41%→0%**（分阶段对照 B=6501.2910 与 A 一致）。

---

## 2. 上游语义缺口二：`polarArray` Location 自带 Rz 自旋

### 现象

丢角修复后 M17 残差仍 1.070%。分阶段：races 已一致，差在 `+rollers` 阶段。

### 取证

对 A 侧 STEP 的 45 个滚子锥面（`BRepAdaptor_Surface.Cone().Axis().Direction()`）
逐一取轴向 (x,y,z)：**15 个滚子的锥轴 xy 方向各不相同**（如 (−0.0915,−0.1259)、
(0,0.1556)、(0.1547,−0.0163)…）——上游 `Workplane.polarArray(...).vals()` 的
Location 带 `Rz(ang)` 自旋（cq.py `polarArray` `rotate=True` 默认），圆锥滚子先绕
Z 转到方位角、再平移落位，倾斜朝向随位置旋转。TS 原实现只平移未旋转。

### 处置

`src/bearing.ts` 滚子循环改为 `translate(rotateAbout(roller, AXIS_Z, ang), pos)`。
对球/圆柱滚子无影响（绕自身对称轴旋转不变）；对圆锥滚子决定倾斜朝向，必须复刻。

修复后：M15 通过（默认容差 <1e-6），M17 残差降至 vol 2.086e-4 / com 1.383e-2（见 §4）。

---

## 3. A 侧 STEP 写出损坏：dgb 两例（override 依据）

### 现象

`bearing-dgb-m6-19-6` / `bearing-dgb-m8-22-7` 比对体积差 6.99% / 9.93%。

### 取证（同一次取证链覆盖两例）

| 量 | A live（Python） | A STEP 重导入 | B（TS） |
|---|---|---|---|
| dgb-m6 体积 | 1133.613019 | **1218.8194**（+7.5%） | 1133.629（对 A live 差 1.4e-5 相对） |
| dgb-m8 体积 | 1644.749126 | **1825.9880**（+11.0%） | 1644.757（差 4.9e-6 相对） |
| 球面片 | 14×面积 16.517（被滚道裁剪） | 7/14 片变 20.992（≈完整球） | 14×16.517 |

- **纯 Python 自身 roundtrip 同样损坏**：live 1133.6130 → cadquery importStep 1218.8194，
  且 `BRepCheck_Analyzer(reimport).IsValid() = False`。损坏在 A 侧 STEP
  写出/读回链（球-环裁剪交线丢失），与我方内核无关。
- **补救实验全数无效**：写侧 `write.surfacecurve.mode=0`（更差 1240.12）、
  读侧 `read.precision.mode/val`、`read.minprecision`、`ShapeFix_Shape` 均不恢复。
- 对照组：`capped` 两例（球被密封盖完全包裹，无自由球面片）roundtrip 完好
  （1202.0357 → 1202.0357），与「球-环自由交集损坏」假说一致。

### 处置

`compare.ts` 按例 override：`bearing-dgb-(m6-19-6|m8-22-7)` →
`volumeRelativeTolerance: 0.4, linearTolerance: 1e-1`（实测最坏 ×~4，与线程族政策一致）。
反向守卫（`bearing.test.ts`）：旧容差 1e-6 下必须 DIFFERENT。

---

## 4. taper-m17 残差：近切线锥面 GProps 求积混叠（override 依据）

丢角 + 自旋两处修复后，M17 残差 vol 2.086e-4 / com 1.383e-2 / bbox 1e-7。

- 该件滚道（semi-angle 7.903°）、滚子、保持架全是近切线锥面；两侧各自的
  GProps vs 自身三角化体积自偏差 ~0.5% 量级（A: 8955.84 vs mesh 8908.45；
  B: 8832.48 vs 8875.70），远大于两侧差 —— 与 thread/screw 阶段实证的
  GProps 一阶矩混叠同族。
- 同构例 M15（几何构造完全相同，仅参数不同）在默认容差 1e-6 下即通过，
  证明构造一致，残差是求积伪差而非几何差。
- 处置：`bearing-taper-m17-40-13.25` → `volumeRelativeTolerance: 1e-3,
  linearTolerance: 6e-2`（实测 ×4.8 / ×4.3）。反向守卫同上。

---

## 5. 其它（非问题）确认项

- **A 侧派生量 dump 逐字一致**：10 个 manifest 用例的 roller_diameter /
  race_center_radius / roller_count / thickness 与 `kernel-bearing-probe.py`
  第 2 段输出逐字一致（含 taper 的 `asin(radians(a))` quirk 与
  `2.5·cone_radii[0]` 测量式）。
- **raceway 锥面参数化差异不是几何差**：A 侧 STEP 重导入后 raceway 锥的
  RefRadius/原点参数与 B 不同（14.6658@z13.25 vs 14.5079@z12.112），但换算到
  世界坐标 r(1.25)=13.0000、r(13.25)=14.6658 **完全一致** —— 只是 STEP 读回
  重参数化，物理锥面相同。
- **Bearing 5 类均为单 part Compound**，无零件顺序复杂度（方案 §8-W6 验收 2）。
- 内圈（cone）截面角点闭式与 cadquery 实测 match=True（M15 与 M17 均验证），
  取证：`scripts/kernel-bearing-probe.py` `corners_after_transform` vs `formula_cone`。
