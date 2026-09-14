# Agent Note: fai_cq_warehouse W3 螺纹 —— 直纹放样带、三角化体积基准、标定后的容差

状态：已实施

[English](2026-09-14-fai-cq-warehouse-thread-geometry.md) | 中文

## 问题

`@faicad/fai-cq-warehouse` 把 CadQuery 库 `cq_warehouse` 移植到 TypeScript。W3 是 Thread 模块：五个类（`Thread`、`IsoThread`、`AcmeThread`、`MetricTrapezoidalThread`、`PlasticBottleThread`），其几何是由四条直纹带加端帽围成的螺旋肋带——上游用 `Wire.makeHelix` / `Workplane.parametricCurve` 与 `Face.makeRuledSurface` 构造，这三者在 `occt-wasm` / `BrepEngineApi` 里都不存在。实现 `simple=False`（真实螺旋面）路线时接连撞上四个陷阱：

1. **`bsplineSurface` 是逼近而非插值，且系统性外扩。** 直纹带的第一版实现是 `bsplineSurface([...rowA, ...rowB], rows = 2, cols = N)`。在两行采样点**都**恰好落在 `r = 3.000000000` 的前提下，得到的曲面实测 `xmax = 3.000369534`（Δ = 3.70e-4），且该误差**不随采样密度下降**（每圈 12 → 192 点全部收敛到 3.699e-4），也**不随 `rows` 变化**（2/3/5/9 结果完全相同）。对 Ø6 螺纹即 0.37‰ 的半径误差——足以撞穿 1e-3 的 bbox 门禁。
2. **`BRepGProp` 的精确曲面积分在螺旋 B 样条面上发生求积混叠。** 上游 Thread 实体报 `Volume() = 49.961532`，而它自己的三角化报 `43.680000`——差 14%。三角化值才是真值：它对 deflection 收敛（0.05 → 0.0005），与独立的 Pappus/螺旋扫掠推导一致（43.693848）；而 GProps 值还随长度**非单调**（L=10 → 34.97、11 → 49.96、12 → 39.18），并且布尔分割后**不可加**（31.284 + 34.002 ≠ 49.962）。
3. **`Shape.BoundingBox()` 一旦发现三角化就去读粗三角化包围盒。** `gen-reference.py` 在计算 `volume_mesh`（内部调用 `tessellate`，会**原地**给 shape 建三角化）时先于 `bbox`，而 cadquery 的 `BoundingBox()` 用 `BRepBndLib::AddOptimal(..., useTriangulation=True)`。于是 manifest 里每一个参考 bbox 都被放大（例如 HexNut 11.560587 而非 11.545005；`thread-generic` 6.012626 而非 6.000001）。
4. **`compareAssemblyFiles` 的体积与质心判定都走同一套 GProps 积分。** 它只有 `linearTolerance`（bbox 与质心**共用**）和 `volumeRelativeTolerance` 两个旋钮，因此上述两个陷阱都无法表达成「按指标」的容差。

## 决策

### 直纹带走 `approximatePoints` + `loft(ruled)`

`primitives.ruledFace` 把每条带建成两条单边 wire（`makeWire([approximatePoints(row, 1e-6)])`），再用 `loft([wireA, wireB], isSolid = false, ruled = true)` 放样，最后经 `getSubShapes(shape, 'face')` 取出那一张面。同一组点下实测 `xmax = 3.000000982`（Δ = 9.8e-7），比 `bsplineSurface` **紧 375 倍**。兜底不静默：面数不为 1 直接抛错。

### 体积基准取三角化，而非 GProps

`gen-reference.py` 同时记 `volume`（GProps）与 `volume_mesh`（三角化，deflection 0.002 / angular 0.1——与 cadquery `Shape.tessellate` 同参数）；`primitives.meshVolume` 用 `kernel.tessellate` 做有符号四面体求和算出 B 侧对应量。manifest 驱动的比对以 `volume_mesh` 为判据；`volumeOf`（GProps）只作参考打印。

### 参考 bbox 一律走精确路径

`bbox_of` / `part_info` 显式调用 `BRepBndLib.AddOptimal_s(shape, box, False, False)`（与三角化状态解耦），并把 `volume_mesh` 挪到 `build_case` 的最后计算。`primitives.bboxOf` 保持内核默认（`useTriangulation = false`）。

### 容差按类标定，并配反向守卫

所有容差归 `src/testing/compare.ts` 一家。线程族只有一条覆盖：`volumeRelativeTolerance` 1e-6 → 1e-4（实测最坏 2.289e-5 的 4.4 倍）。`linearTolerance` **不放宽**（bbox 实测最坏 8.74e-7，余量 1144 倍），全局默认值不动。剩下唯一一例仍报 DIFFERENT 的，做**显式分类**而非容差覆盖：`KNOWN_A_SIDE_COM_ARTIFACTS` 配合 `classifyKnownArtifact()`，仅在「结构匹配 + 体积与 bbox 全过 + 唯一不合格项是质心」时才判为已知的 **A 侧测量**伪差。

## 证据

把两侧 STEP 导入**同一个内核**、各测两次：

| 量 | A 侧 | B 侧 |
|---|---|---|
| GProps 质心 x（`iso-m10x1.5-fade-square`） | +0.143267 | −0.007574 |
| **三角化**质心 x，同例 | −0.006756 | −0.006787（Δ = 4.4e-5） |
| GProps 体积 | 194.521596 | 194.519895 |
| 三角化体积 | 194.606211 | 194.607034 |

A 侧自身的 GProps 质心与自身三角化质心相差 0.15 mm，而 B 侧与 A 侧三角化质心一致到 4.4e-5——离群的是**测量值**，不是几何。逐例 bbox/体积/质心全表、仲裁数据与复现命令见 `docs/analysis/2026-09-14-cq-warehouse-thread-probe.md`。

修复后 STEP 等价性扫描 17/17（16 例 EQUIVALENT + 1 例已分类伪差）；各项最坏偏差：bbox 8.744e-7 mm、体积 2.289e-5 相对、质心 1.520e-4 mm。

## 已知缺口

- `end_finishes = "chamfer"` **未实现**。上游用的是**非对称** `chamfer(0.5·tooth_height, 0.75·tooth_height)` 配 `RadiusNthSelector` 选边；本内核只提供等距 chamfer。`buildThread` 显式抛错（错误信息指向分析文档）而不是近似，且参考用例集里不含 chamfer——有一条覆盖度断言强制其缺席，防止该缺口被静默跳过。
- 两个上游 bug 逐字复刻并有断言：`square_off_ends` 每次切割都以传入对象为基（因此 `("square","square")` 只切了 `z > length` 一侧）；`PBT_FINISH_DATA[200]` 保留写坏的直径列 `[24.28]`，使 `M200SP444` 判非法。

## 考虑过的替代方案

- **保留 `bsplineSurface`，把径向偏差记为已知偏差。** 否决：该偏差是所选原语的构造假象，不是方法差异，而且存在更紧的原语。旧路径还吃光了全部 bbox 余量（最坏 9.9e-2）。
- **两侧都用 GProps 判体积，把 `volumeRelativeTolerance` 放宽到约 2e-4。** 否决：那等于把一个坏掉的测量值写进契约。三角化对三角化的实测差（2.289e-5）小一个量级，且有两个独立仲裁者背书。
- **为提高线程族的 `linearTolerance` 让伪差例通过。** 直接否决：bbox 与质心共用该旋钮，那会把 bbox 门禁（实测 8.74e-7）悄悄放宽五个数量级——正是「就地放宽消 FAIL」的红线。
- **改用 `sweep` 或一排中间曲线构成的点阵重做直纹带。** 未采用：`loft(ruled)` 已达 9.8e-7，而点阵逼近会在第二个方向重新引入拟合误差。

## 后果

- 除 `chamfer` 外的四种端部组合，`simple = False` 路线均可行；W4–W7 可直接复用 `ruledFace` / `solidFromFaces` / `meshVolume`，无需改动。
- 内核契约测试现在钉住了三个行为，使内核升级不会静默回退：多边 wire 的 `loft` 逐边配对出一张面（单边 wire 恰好一张）、`tessellate` 遵循面朝向（2×2×2 box 的 mesh 体积为 +8）、`getBoundingBox(shape, true)` 会放大包围盒而默认不会。
- 后续每个阶段都继承两条规则：「先量 bbox/质心再三角化」与「螺旋面/近重合 B 样条面上不得把 GProps 当唯一体积判据」。
- 参考数据生成器已变更，故 smoke 与 thread 两个集合的 manifest 都重跑过——W1/W2 时期记录的 bbox 值从来就不可信。
- 本包 `npx tsc --noEmit` 现在会报出 `packages/cq-compat/src/workplane.ts:4548` 的一条既有错误（`kernel.brep` 类型擦除所致）。这不是新引入的：`packages/fai_cq_gears` 与 `packages/cq-compat` 自身在各自的 tsconfig 下报出完全相同的错误。在测试里 import `@faicad/cq-compat` 只是把它暴露出来而已。
