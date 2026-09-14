# Agent Note：fai_cq_warehouse W4 螺母与垫圈 —— revolve 返回 shell、washer 内孔 A 侧体积 2×、短螺旋螺纹逐例容差

状态：已落地

[English](2026-09-14-fai-cq-warehouse-nut-washer-geometry.md) | 中文

## 问题

`@faicad/fai-cq-warehouse` 是把 `cq_warehouse`（CadQuery 库）移植到 TypeScript。W4 是 Nut（7 类）+ Washer（3 类）。上游造一个螺母的路径是：倒角六边形截面旋转 → 与拉伸出的六棱柱求交 → 钻通孔 → 视类融合法兰轮廓和/或真实螺旋螺纹。实现过程中暴露四个坑：

1. **内核 `revolve` 返回的是 SHELL，不是 SOLID。** 对闭合 4 点截面执行 `revolve(profile, +Z, 2π)`，实测 `solids = 0 / shells = 1`，而 cadquery 的 `Workplane.revolve()` 给的是 Solid。**对闭合壳 `getVolume` 恰好精确**（r=3、h=5 得 `141.371669`）—— 这正是 bug 藏得住的原因：只查体积的检查会通过。真正坏掉的是：nut 上 `common(shell, blank)` **静默**给出正确体积的**三分之一**；`fuse(shell, solid)` 抛 `boolean operation failed`；即便在包含关系下 `common` 体积正确，结果仍是壳 —— 于是导出的 STEP 是 SHELL，而 A 侧每例 `shapeType` 都是 `Solid`。
2. **washer 内孔上，A 侧 `volume` 是解析值的 2 倍。** `Solid.Volume()`（OCP `BRepGProp`）对 revolve 原生生成的带孔管给出恰好 2 倍的解析体积，6 例 washer 全部如此（plain M6 iso7089：解析 145.669368 / `Volume()` 291.338736 / 三角化 145.609004）。nut 不受影响，因为它的中心孔是旋转之后才切的。同一几何上 `occt-wasm` 的 `getVolume` 是精确的，所以 STEP 比对本身不受影响 —— 但读 A 侧真值必须走 `volume_mesh`。
3. **`extrude` 必须收 face，不能收 wire。** 对 4×2 矩形执行 `extrude(wire, 0,0,3)` 得到体积 `−16`，传 face 才是 `24`。内核不校验输入拓扑，所以这是静默出错而不是抛错。
4. **短内螺纹把 `BRepGProp` 的求积混叠放大一个数量级。** 对 `nut-hex-m6-iso4032-threaded`（L=5.2、两端 `fade`、约 5 牙），两侧 STEP 导入同一内核后 GProps 体积相对差 `4.577e-3`、GProps 质心差 `5.107e-3` mm；而**三角化**体积只差 `3.636e-7`、三角化质心只差 `1.506e-5`。两侧的 GProps 都与自身三角化不符（A `6.176e-4`、B `3.978e-3`），所以离群的是**测量**而不是几何。与 W3 同源，只是大一个量级。

## 决策

### `revolveProfile` 返回实体

`primitives.revolveProfile` 现在以 `orientOutward(kern.makeSolid(kern.revolve(profile, axis, angleRad)))` 收尾。这才是 cadquery `revolve()` 的语义（上游在 `.val()` 之后还要解包 `Compound.Solids()[0]`）。修完立刻：`common(nutSolid, blank) = 302.297726`，与 A 侧解析值 `302.2977262431188` 逐位一致。

### 螺母构造逐条照抄上游四步

| 上游 `make_nut`（`fastener.py:581`） | 本包 |
|---|---|
| `profile.toPending().revolve()` | `revolveProfile(profileWire(profile), AXIS_Z, 2π)`（实体，见上） |
| `Workplane("XY").add(nut_plan()).toPending().extrude(max_nut_height)` | `extrudeFace(planarFace(planWire), maxNutHeight)` —— 传 **face** 不传 wire |
| `.faces("<Z").workplane().hole(d, m)` | `cut(blank, cylinderBetween(d / 2, 0, m))` |
| `.intersect(nut_blank)` | `intersect(nut, blank)` |
| `.union(flange)` | `fuse(out, 带中心孔的法兰)` |
| `.union(thread)`（`simple=False`） | `fuse(out, isoThread({ external: false, end_finishes: ['fade','fade'] }))` |

`max_nut_height` 取**轮廓最高顶点的 z**，不是 `nut_data["m"]`：DomedCapNut 的球顶使它为 `m + dk/2`。

### 垫圈是精确的

`plainWasher` / `chamferedWasher` / `cheeseHeadWasher` 直接旋转各自截面轮廓，无任何逼近，所以 6 例比对的 bbox / 体积 / 质心差**全为 0**，不需要任何容差 override。

### BradTeeNut 在 W4 内落地，靠一个临时沉孔切割器

`BradTeeNut.custom_make` 需要 `extensions.clearanceHole`（W9·P1-b 才落地）；它还**额外**把 W5 的 `CounterSunkScrew` 当纯参数载体用（`clearance_hole_diameters` + `countersink_profile`）。按方案 §8-W4 去重表，临时切割器落在 `src/recess.ts`，命名 `tempClearanceHoleCutter` / `tempCounterSunkCountersinkProfile` —— 带 `Temp` 前缀、单一消费者（`nut.ts: bradTeeNut`）、JSDoc 写明「P1-b 落地后删除，勿扩散引用」。`countersink_profile` 是 **90° 截锥** `(0,0) → (0,k) → (dk/2,k) → (dk/2 − k·tan(a/2), 0)`，不是矩形，且不读 `fit`。

### HeatSetNut 保持为显式缺口

`HeatSetNut.make_nut` 用 `cq.Face.makeNSidedSurface(4 条边, [])` 造 knurl 面。内核无此原语；最近的替代 `makeNonPlanarFace(wire)` 把 4 边扭面退化为 3 边面（面积 2.749170），不等价。`heatSetNut()` **显式抛错**并点名缺失原语，而不是塞一个启发式实现；两例 A 侧参考数据留在 manifest 里，等谁补上原语就能直接接。

### 只有一个逐例容差 override，且带反向守卫

`src/testing/compare.ts` 只新增一条 nut 条目：`nut-hex-m6-iso4032-threaded` → `volumeRelativeTolerance: 2e-2, linearTolerance: 2e-2`（= 实测 4.577e-3 × 4.37、5.107e-3 × 3.9，与线程族同一套 4.4× 政策）。`linearTolerance` 由 bbox 与质心共用，但本例 bbox 差 `1.013e-13` —— 十一个数量级余量，放宽不构成风险。全局默认未动，其余十例 nut 的最坏体积偏差是 `3.720e-10`（余量 2700×）。

## 证据

STEP 等价性（两侧 STEP 导入同一 `occt-wasm` 内核）：

| 用例组 | 例数 | 等价 | 备注 |
|---|---|---|---|
| HexNut / HexNutWithFlange / DomedCapNut / UnchamferedHexagonNut / SquareNut | 10 | 10/10 | 无需 override |
| BradTeeNut（M6 / M8） | 2 | 2/2 | 体积相对差 1.3e-10 / < 1e-8 |
| Washer（3 类） | 6 | 6/6 | bbox / 体积 / 质心差全为 0 |
| HexNut（`simple=false`，带螺纹） | 1 | 1/1 | 逐例 override，见上 |
| HeatSetNut | 2 | **0/2（已知缺口）** | 显式抛错 |
| **合计** | **21** | **19/21** | 2 例缺口是方案范围内的显式缺口，不是静默跳过 |

B 侧 GProps 体积 vs A 侧 `volume`，除带螺纹一例外全部落在 `1e-8` 相对差以内（`hexnut-m6-iso4032`：`302.297726` vs `302.2977262431188`）。BradTeeNut 用上游 Python 独立拆解：`make_nut() = 3585.465923`、每孔切除 65.4292、3 孔共 196.290、终值 `3389.175287` vs A 侧 `3389.1752874338977`。

逐例明细表、washer 2× 矩阵、threaded 四步标定与复现命令见 `docs/analysis/2026-09-14-cq-warehouse-nut-washer-probe.md`。

## 已知缺口

- **HeatSetNut（2 例）**：需要 `Face.makeNSidedSurface`。`nut.test.ts` 同时断言「抛错」与「缺口清单与 manifest 对齐」，所以缺口不可能被静默跳过；A 侧数据保留。
- **五种头部凹槽不在 W4。** 方案 §8-W4 那行写着「recess.ts 五种沉孔」，但那是**螺钉头**的驱动槽，W4 的螺母几何一个都不用。实现无人覆盖的代码违反「一个事实一个家」，故推迟到 W5（在分析文档里记为偏差 D1）。
- **`recess.ts` 内与上游的两处显式偏差**（均不改体积）：不调 `.clean()`（`ShapeUpgrade_UnifySameDomain` 是 cq-compat 的 parity 欠账）、不建 `null_object` + `eachpoint` 反算孔位（极坐标等价且更直白）。

## 考虑过但否决的方案

- **继续用壳做布尔。** 否决：`common` 静默给出三分之一体积、`fuse` 抛错，失败形态要么是错几何要么是迟到的崩溃；而 `getVolume` 在壳上通过正是这个坑本身。
- **用 `makeNonPlanarFace` 近似 HeatSetNut。** 否决：实测退化为 3 边面、面积 2.749170，不是同一个曲面；且拿启发式顶替缺失原语是方案 §5.4 的红线。kernel-pitfalls 测试把它锁成「看着对其实错」的案例。
- **用 A 侧 `volume` 判 washer 体积。** 否决：该字段是解析值的 2 倍，比出来的是 ~50% 的幻影偏差。`washer.test.ts` 保留两条「错误基准」回归锁，防止有人再引回来。
- **放宽全局 `volumeRelativeTolerance`，而不是加一条逐例 override。** 直接否决 —— 那会为了修一处测量伪差而放松全部 33 类的门禁。
- **因为方案提了就把五种头部凹槽一起做掉。** 否决：W4 里没有任何东西用到它们；该行方案原文已在分析文档中订正（D1）。

## 影响

- W5–W7 可原样复用 `revolveProfile`（现在返回实体）、`extrudeFace`、`planarFace`、`bboxDiagonal` 与 `volumeOf` / `meshVolume`；此后所有基于旋转的类都继承修好的拓扑。
- 三条行为由回归锁而不是注释来固定：`kernel-pitfalls.test.ts` 陷阱 8（revolve 拓扑，源自 `kernel-nut-probe.ts` 段 7）、`nut.test.ts`（BradTeeNut / hexNut 是实体；threaded 四步反向守卫；polarArray 排他性；已知缺口）、`washer.test.ts`（2× 错误基准；零差异断言且无 override 可依赖）。
- W4 的临时探针已收进永久载体并删除：threaded 的 GProps-vs-三角化裁定成为 `kernel-nut-probe.ts` **段 8**，A 侧 BradTeeNut 拆解成为永久脚本 `scripts/probe-bradtee-decomposition.py`。
- 为了让 BradTeeNut 有 ≥2 规格（覆盖度断言要求），新增了一个 manifest 用例（`nut-bradtee-m8-hilitchi`）；参考集现为 39 例，nut/washer 子集 21 例。
- 本包 `npx vitest run` 为 7 个文件 / 157 个测试，全绿。`npx tsc --noEmit` 仍报 `packages/cq-compat/src/workplane.ts:4548` 的既有错误（测试里 import `@faicad/cq-compat` 会暴露它），与本包无关。
