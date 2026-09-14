# W4（Nut 7 类 + Washer 3 类）探测与偏差裁决

状态：**已落地** | 日期：2026-09-14 | 上游：`C:\git\CADQ\cq_warehouse` v0.8.0（git HEAD `daa4650`）
方案：`docs/plans/2026-09-13-fai-cq-warehouse-port.md` §8-W4
复现台：`scripts/kernel-nut-probe.ts`（段 7 = revolve 拓扑；段 8 = threaded GProps 混叠）、`scripts/kernel-pitfalls-probe.ts`、`scripts/probe-bradtee-decomposition.py`（A 侧）
回归锁：`src/nut.test.ts`、`src/washer.test.ts`、`src/kernel-pitfalls.test.ts`（陷阱 8）

---

## 1. 结论摘要

W4 交付 `src/nut.ts`（7 类）、`src/washer.ts`（3 类）、`src/recess.ts`（**临时**沉孔切割器，BradTeeNut 用）。逐个用例的 STEP 等价比对（`compareAssemblyFiles`，两侧 STEP 导入同一 occt-wasm 内核）：

| 用例组 | 例数 | STEP 等价 | 备注 |
|---|---|---|---|
| HexNut / HexNutWithFlange / DomedCapNut / UnchamferedHexagonNut / SquareNut | 10 | 10 / 10 | 全部 EQUIVALENT，无需任何容差 override |
| BradTeeNut（M6 / M8） | 2 | 2 / 2 | 体积相对差均 < 1e-8（见下表） |
| Washer（3 类） | 6 | 6 / 6 | bbox / 体积 / 质心差**全为 0**（两侧都是精确 revolve） |
| HexNut(simple=false，带螺纹) | 1 | 1 / 1 | 需逐例容差 override，见 §5 |
| HeatSetNut | 2 | **0 / 2（已知缺口）** | 内核缺 `Face.makeNSidedSurface`，显式抛错，见 §6 |
| **合计** | **21** | **19 / 21** | 缺口的 2 例为**方案范围内的显式缺口**，不是静默跳过 |

「B 侧 GProps 体积 vs A 侧 `volume`」的逐位对照（A 侧 `Solid.Volume()`，OCP BRepGProp）：

| 用例 | B 侧（本包） | A 侧 manifest `volume` | 相对差 |
|---|---|---|---|
| hexnut-m6-iso4032 | 302.297726 | 302.2977262431188 | 2.4e-10 |
| nut-hex-m3-iso4032 | 45.740788 | 45.74078806994256 | 1.5e-9 |
| nut-hexflange-m6-din1665 | 440.107634 | 440.1076343062627 | 7.0e-10 |
| nut-hexflange-m8-din1665 | 916.071363 | 916.0713634765818 | 5.2e-10 |
| nut-domed-m6-din1587 | 404.647072 | 404.64707239585516 | 9.8e-10 |
| nut-domed-m4-din1587 | 143.274980 | 143.2749804505537 | 3.1e-9 |
| nut-unchamfer-m6-iso4036 | 186.650228 | 186.6502275264963 | 2.5e-9 |
| nut-unchamfer-m3-iso4036 | 34.431614 | 34.43161427697855 | 8.0e-9 |
| nut-square-m6-din557 | 355.009907 | 355.0099074816303 | 1.4e-9 |
| nut-square-m5-din557 | 175.607322 | 175.60732214209798 | 8.2e-10 |
| nut-bradtee-m6-hilitchi | 3389.175287 | 3389.1752874338977 | 1.3e-10 |
| nut-bradtee-m8-hilitchi | 2641.8595（4 位小数） | 2641.8595101832652 | < 1e-8 |
| nut-hex-m6-iso4032-threaded | 324.193032 | 325.6836417366476 | **4.6e-3（见 §5）** |

除带螺纹一例外，**全部落在 1e-8 以内**——即本包的 revolve/intersect/cut/fuse 路径与上游 CadQuery 的 B-rep 构造在这个精度上等价。

---

## 2. 内核语义探测（本阶段新增结论）

### 2.1 ⚠️ 最贵的一条：`revolve` 返回的是 SHELL，不是 SOLID

`kernel-nut-probe.ts` 段 7 实测：

```
revolve(实心柱) solids / shells     0 / 1        ← 拓扑是壳
revolve(实心柱) getVolume           141.371669   ← 体积却完全正确（掩盖问题）
makeCylinder(3,5) solids / shells   1 / 1
makeBox(6,6,5) solids / shells      1 / 1
common(revShell, 包含盒) volume     141.371669   ← 包含关系下体积也对
common(revShell, 包含盒) 结果 solids 0            ← 但结果还是壳！
fuse(revShell, 包含盒)              THROW(OcctError: fuse: boolean operation failed)
nut: common(shell, blank) volume    108.504290   ← nut 形态：静默错到 1/3
nut: common(shell, blank) 结果 solids 0
nut: common(solid, blank) volume    302.297726   ← 补 makeSolid 后 = A 侧解析值
nut: common(solid, blank) 结果 solids 1
```

**为什么这条最贵**：`getVolume` 对闭合壳给出的值**恰好正确**，所以在只做体积检查时完全看不出问题。W4 初版 `revolveProfile` 直接返回 `k().revolve(...)`，全部 nut 用例的体积是参考值的 **0.33–0.36 倍**（bbox 却完全正确，因为 revolve 的半径是对的）。

**修法**：`primitives.revolveProfile` 内部补 `makeSolid` + `orientOutward`（与 `solidFromFaces` 同款兜底）。这才是 cq `Workplane.revolve()` 的语义（上游 `.val()` 后还要 `Compound.Solids()[0]` 解包）。修完立刻全绿：`common(nutSolid, blank)` = 302.297726，与 A 侧解析值 `302.2977262431188` 逐位一致。

**三种失效形态**（回归锁 `kernel-pitfalls.test.ts` 陷阱 8 全部锁住）：
1. **静默错几何**：`common(shell, solid)` 在「一个体挖空后与旋转体相交」时会掉到 1/3 体积；
2. **静默给壳**：即使体积正确（包含关系），结果仍是壳 → 导出的 STEP 是 SHELL，而 A 侧 `shapeType` 全是 `Solid`；
3. **直接抛错**：`fuse(shell, solid)` 抛 `boolean operation failed`。

### 2.2 其余新增/订正结论

| 结论 | 实测值 | 影响 |
|---|---|---|
| `makeCone(r1, r2, h)` 拒绝等半径 | `OcctError: makeCone: cone with two identic radii` | 圆柱必须用 `makeCylinder`；`cone(r, r, h)` 不可用（`src/recess.ts` 已改） |
| `makeCone` 的放置 | 底半径 `r1` 在 `z=0`、顶半径 `r2` 在 `z=h`、轴 +Z | 钻尖（尖朝下）用 `cone(0, r, h)` 再平移到 `z = −depth − h` |
| `revolve(闭合轮廓)` 精确 | 实心柱 r=3 h=5 → 141.371669（=π·9·5）；管 2→4 h=5 → 188.495559（=π·12·5） | washer 走直通路径，无退化 |
| 轮廓点序决定朝向 | 反序 → 体积为负；`orientOutward` 兜住 | — |
| `makeWire` / `revolve` 都不校验闭合 | 未闭合 3 边 wire 被静默接受 | 闭合由调用方保证（`profileWire` / `polygonWire`） |
| `polarArray` 语义 | `startAngle + (endAngle − startAngle)·i/count`，`endAngle` **排他**；`(0,360,3)` → 0°/120°/240° | `nut.ts:polarArrayLocations`（只算位置，不依赖平台 `polarArray`） |
| cq `largestDimension()` = **包围盒对角线** | nut 侧 √(36.3²+36.3²+16.5²) = 53.922444 | `primitives.bboxDiagonal`；BradTeeNut 的孔深取此值 |
| cq `polygon(n, diameter)` 首顶点在角度 0 | 顶点 `(r,0)` 起 | `polygonPlanPoints` |
| cq `radiusArc` → `sagittaArc` 的第三点 | `sag = |r| − √(r²−half²)`，符号随 radius；±90° 旋转取弧中点 | `radiusArcMidpoint`；半径不足时**抛错**（不静默给退化点） |

### 2.3 Nut 四步构造的映射（与上游逐条对齐）

上游 `make_nut`（fastener.py:581）：`nut_profile().revolve()` → `nut_plan()` extrude → `.hole(d, m)` → `intersect` / 依次 `union(flange)`、`union(thread)`。本包：

| 上游 | 本包 |
|---|---|
| `profile.toPending().revolve()` | `revolveProfile(profileWire(profile), AXIS_Z, 2π)`（**含 makeSolid**，见 §2.1） |
| `Workplane("XY").add(nut_plan()).toPending().extrude(max_nut_height)` | `extrudeFace(planarFace(planWire), maxNutHeight)` |
| `.faces("<Z").workplane().hole(d, m)` | `cut(blank, cylinderBetween(d/2, 0, m))` |
| `.intersect(nut_blank)` | `intersect(nut, blank)` |
| `.union(flange)`（有 `flange_profile` 的类） | `fuse(out, 切割过中心孔的 flange)` |
| `.union(thread)`（`simple=False`） | `fuse(out, isoThread({external:false, end_finishes:['fade','fade']}))` |

⚠️ **`extrude` 必须收 face 而非 wire**（段 1 实测：`extrude(wire,0,0,3)` 对 4×2 矩形给体积 −16，传 face 才得 24）。内核不校验输入拓扑，传错不抛错、只给错几何。
⚠️ **`max_nut_height` 取轮廓最高顶点 z**（上游 `profile.vertices(">Z").val().Z`），不是 `nut_data["m"]`：DomedCapNut 的球顶使之为 `m + dk/2`。

---

## 3. BradTeeNut 的解析拆解（方案 §8-W4 要求「本地等价实现」）

上游 `custom_make`（fastener.py:734）与方案初稿的判断**不同**：它不只缺 `extensions.clearanceHole`，还把 `CounterSunkScrew`（**W5 的类**）当**参数载体**用（`brad.clearance_hole_diameters` + `brad.countersink_profile(fit)`）。方案漏了后者；本阶段按「先把依赖的参数面抽出来」处理：

- `CounterSunkScrew.countersink_profile`（fastener.py:1786-1798）**不是矩形**，而是 **90° 截锥**：`(0,0) → (0,k) → (dk/2,k) → (dk/2 − k·tan(a/2), 0)`。M4-0.7/iso10642 实测顶点 = `(0,0),(0,2.3),(4.0,2.3),(1.7,0)`（`scripts/probe-bradtee-decomposition.py` 用上游 Python 打印，逐位一致）。它**不读 `fit`**（与 `Screw.default_countersink_profile` 不同）。
- `_fastenerHole`（extensions.py:865-1046）在 `clearanceHole` 的默认实参下走：`fit="Normal"`、`depth=None → largestDimension()`、`counterSunk=True`、`captiveNut=False`、`hand=None`（非螺纹孔）、`clean=True`。

**解析验证**（两侧独立算，数值逐位吻合）：

| 量 | 解析值 | 上游 Python 实测 |
|---|---|---|
| `make_nut()`（轮廓 revolve ∩ Ø36.3 圆棱柱 − Ø6×16.5 中心孔） | 3585.46 | **3585.465923421005** |
| 每孔切除（截锥 ∪ 杆部 ∪ 钻尖 与法兰板之并集；截锥 r 1.7→4.0 h=2.3、杆部 Ø4.5、钻尖 82°） | 65.4292 | — |
| 3 孔共切除 | 196.29 | 3585.4659 − 3389.1753 = **196.291** |
| 终值 | 3389.1753 | **3389.1752874338977** |

STEP 比对：bbox 差 0、体积相对差 **6.145e-12 %**、质心差 7.686e-13 → EQUIVALENT。

### 3.1 `src/recess.ts` 的定位与去重契约

按方案 §8-W4 的去重表，`clearanceHole` 的临时实现落在 `src/recess.ts`，导出名带 `Temp` 前缀（`tempClearanceHoleCutter` / `tempCounterSunkCountersinkProfile`），JSDoc 标注「P1-b 落地后删除，勿扩散引用」。**只有 `nut.ts` 的 `bradTeeNut` 引用它。**

与上游的**三处已知偏差**（均不改几何体积）：

1. **不调 `clean()`** —— OCCT `ShapeUpgrade_UnifySameDomain` 只合并同域面，不改体积；核内无该封装（cq-compat parity 欠账，见 §7）。
2. **不建 `null_object` + `eachpoint` 反算孔位** —— 直接算极坐标（等价且更直白）。
3. **不做 `baseAssembly` 装配注入** —— 上游该分支为 `None`，不执行。

---

## 4. A 侧 `volume` 字段对 washer **不可用**（2× 病理）

上游 `Solid.Volume()`（OCP `BRepGProp`）对 **revolve 原生生成的内孔管**给出**恰好 2× 解析值**的错值。nut 侧不受影响（nut 的旋转体不贴内孔，中心孔是后切的）：

| 用例 | 解析值（= 我方 GProps） | A 侧 `volume` | A 侧 `volume_mesh` |
|---|---|---|---|
| washer-plain-m6-iso7089 | 145.669368 | **291.338736**（= 2×） | 145.609004 |
| washer-plain-m6-iso7094 | 795.5（我方 795.6178） | **1591.235529**（= 2×） | 795.288065 |
| washer-chamfer-m6-iso7090 | 141.9478 | **283.895518**（= 2×） | 141.869408 |
| washer-chamfer-m8-iso7090 | 257.1657 | **514.331339**（= 2×） | 257.059102 |
| washer-cheese-m6-iso7092 | 108.8915 | **217.783057**（= 2×） | 108.860142 |
| washer-cheese-m4-iso7092 | 19.3981 | **38.796125**（= 2×） | 19.390024 |

**影响面**：occt-wasm 的 `getVolume` 对同一几何**精确**，故 `compareCase`（两侧 STEP 都导入 occt-wasm）**不受影响**——实测 6 例 washer 的 bbox/体积/质心差**全为 0**。但**读 A 侧真值必须用 `volume_mesh`**，`washer.test.ts` 有两条「错误基准」回归锁把这一点钉住（拿 `volume` 当基准会得到 ~50% 的假偏差）。

---

## 5. threaded nut 的容差标定（§7.3.1 四步走）

**第 1 步 · 实测最坏值**：`nut-hex-m6-iso4032-threaded`，两侧 STEP 导入同一 occt-wasm 内核：

| 量 | A 侧 | B 侧 | 两侧差 |
|---|---|---|---|
| GProps 体积 | 325.683642 | 324.193032 | **4.577e-3**（相对） |
| GProps 质心 | — | — | **5.107e-3 mm** |
| **三角化体积** | 325.482500 | 325.482618 | **3.636e-7**（相对） |
| **三角化质心** | (0.009951622, 0.007238889, 2.599999332) | (0.009966681, 0.007230606, 2.600000606) | **1.506e-5 mm** |
| GProps/mesh 自偏差 | 6.176e-4 | 3.978e-3 | — |

**判据**：两侧 GProps **都不自洽**（A 偏 0.062%、B 偏 0.40%），而三角化的体积与质心几乎相同 → 差异是**求积伪差**，不是几何差。

**第 2 步 · 归因**：混叠根源在**螺纹面本身**，不在融合。B 侧独立内螺纹 M6×1 L=5.2 的 GProps=23.391955 / mesh=23.210013（自偏差 **7.778e-3**，`kernel-nut-probe.ts` 段 8 末行）；A 侧同名用例仅 5.902e-4（L=10）。L=5.2 只有约 5 牙且两端 `fade`，螺旋 B 样条逼近的 BRepGProp 求积在该长度上明显不收敛。这与 W3 的结论同源（`docs/analysis/2026-09-14-cq-warehouse-thread-probe.md`），只是被短螺纹放大一个量级。

**第 3 步 · 逐例 override**（`src/testing/compare.ts`）：

```
match: /^nut-hex-m6-iso4032-threaded$/
options: { volumeRelativeTolerance: 2e-2, linearTolerance: 2e-2 }
```

- 体积门禁 2e-2 = 实测 4.577e-3 × **4.37**（与线程族的 4.4× 同政策）；
- 线性门禁 2e-2 = 实测质心 5.107e-3 × **3.9**。⚠️ 线性门禁由 bbox 与质心**共用**，本例 bbox 实测 1.013e-13（11 个数量级余量），放宽不构成风险。

**第 4 步 · 反向守卫**（`src/nut.test.ts`）：① 沿用全局默认（1e-6 / 1e-3）必须 DIFFERENT；② 标定后必须 EQUIVALENT；③ 三角化三项直接证明几何等价，并断言「GProps 体积差 > 1e-3」而「三角化质心差 < GProps 质心差的 1/100」。

**未放宽的**：全局 `CALIBRATED_COMPARE.volumeRelativeTolerance` 仍是 1e-6、`linearTolerance` 仍是 1e-3。其余 10 例 nut 的最坏体积相对差是 3.720e-10（hexflange m8），余量 2700×。

---

## 6. 已知缺口：HeatSetNut（2 例）

`HeatSetNut.make_nut`（fastener.py:947）不走向轮廓旋转，而是 `HeatSetNut.knurled_cylinder_faces` 用 `cq.Face.makeNSidedSurface(4 条边, [])` 造 **4 边扭曲面**（fastener.py:884-897），再 `makeFromWires` / `makeShell` / `makeSolid` 装配。

- 内核**无 `makeNSidedSurface`**（`packages/core/src` 全仓 grep 无此符号）；
- 最近的替代 `makeNonPlanarFace(wire)` 段 4 实测把 4 边扭面**退化为 3 边面**（面积 2.749170），几何不等价。

**处置**：`heatSetNut()` **显式抛错**并说明缺失原语（不写启发式实现——方案 §5.4 红线）。`nut.test.ts` 用「断言抛错 + 断言缺口清单与 manifest 对齐」覆盖这 2 例。A 侧参考数据保留在 manifest 里（`nut-heatset-m3-mcmaster` volume 30.4926 / `nut-heatset-m2-mcmaster` 10.7253），待平台补齐 `makeNSidedSurface` 后即可直接接上。

---

## 7. 给 cq-compat / core 的 parity backlog 增量

| 能力 | 现状 | 本包兜法 | 谁欠 |
|---|---|---|---|
| `Workplane.polarArray` | 无 | `nut.ts:polarArrayLocations`（纯三角，只算位置） | cq-compat |
| `Shape.clean()` / `ShapeUpgrade_UnifySameDomain` | 无 | BradTeeNut **不调**（体积中性）；已在 `recess.ts` 文件头记录 | cq-compat |
| `Face.makeNSidedSurface` | 无 | **无法兜** → HeatSetNut 显式抛错 | core / cq-compat |
| `revolve` 返回 shell 而非 solid | 语义与 cq 不同（cq 给 Solid） | `primitives.revolveProfile` 内补 `makeSolid` + `orientOutward` | core（建议在适配层收敛，本包不越界改） |

---

## 8. 方案偏差记录（如实登记）

| # | 方案原文 | 实际做法 | 理由 |
|---|---|---|---|
| D1 | W4 任务含「`recess.ts` 五种沉孔」 | 未实现五种螺丝驱动凹槽（十字/六角/梅花/一字/方孔），`src/recess.ts` 只承载 `clearanceHole` 的**临时**实现 | 五种凹槽是**螺钉头**的驱动槽，W4 的 nut 几何一个都不用到；实现未被任何用例覆盖的代码违反「一个事实一个家」。**建议归 W5**（`Screw.default_head_recess` 的调用方在 W5） |
| D2 | BradTeeNut 在 W4 内以「本地等价实现（孔 + 沉头锥）」替代 `clearanceHole` | 已实现，但**额外**需要抽出 `CounterSunkScrew` 的两个参数面（方案漏记这是 W5 的类） | 见 §3；`recess.ts` 用 `Temp*` 命名 + JSDoc 标注 P1-b 替换契约 |
| D3 | W4 验收「7 类螺母 × 2 规格 STEP 比对通过」 | 21 例中 19 例通过；`HeatSetNut` 2 例为**显式缺口** | 内核缺 `makeNSidedSurface`，见 §6。不是静默跳过——测试断言其抛错 |

---

## 9. 复现方式

```
# 内核语义（段 7 = revolve 拓扑；段 8 = threaded GProps vs 三角化）
npx tsx scripts/kernel-nut-probe.ts        # 或 npm run probe:nut -w @faicad/fai-cq-warehouse

# A 侧 BradTeeNut 中间量（需 cadquery venv + 上游 clone）
cd C:/git/CADQ/cq_warehouse && PYTHONPATH=src C:/Users/ylt/cadquery-env/Scripts/python.exe \
    D:/Faicad/faijs/packages/fai_cq_warehouse/scripts/probe-bradtee-decomposition.py

# W4 验收（STEP 等价比对 + 反向守卫）
npx vitest run src/nut.test.ts src/washer.test.ts
```
