# fai_cq_warehouse W3（Thread）偏差分析与内核陷阱实测

- **日期**：2026-09-14
- **范围**：W3 Thread 五个类（`Thread` / `IsoThread` / `AcmeThread` / `MetricTrapezoidalThread` / `PlasticBottleThread`）的 `simple=False` 真实螺旋面路线。
- **用途**：方案 §7.3.1「逐类容差标定」第 2 步要求的偏差分析文档；也是 `src/primitives.ts`、`src/testing/compare.ts`、`scripts/gen-reference.py` 中 comment 指向的权威依据。
- **结论先行**：W3 几何**已落地**。STEP 等价比对 17 例：**16 例 EQUIVALENT + 1 例已归因的 A 侧测量伪差**。容差按 §7.3.1 四步走完（实测数据 → 本文 → 逐类 override → 反向守卫）。

---

## 1. 判定口径（为什么体积要另立基准）

`@faicad/cq-compat` 的 `compareAssemblyFiles` 用 `getVolume` / `getCenterOfMass`，二者都走 **`BRepGProp` 精确曲面积分**。该积分对**螺旋 B 样条面**出现**求积混叠**（quadrature aliasing），实测 A 侧 Thread（raw/raw）自相矛盾：

| 量 | 值 | 来源 |
|---|---|---|
| `Volume()`（GProps 解析积分） | **49.961532** | `thread.py` 实体 |
| 三角化体积 | **43.680000** | `shape.tessellate(tol)` |
| Pappus 解析（梯形截面 × 螺旋扫掠） | **43.693848** | 独立推导 |
| 布尔分割可加性 | **不成立** | 两半 31.284 + 34.002 ≠ 49.962 |

三角化体积对 deflection **收敛**（0.05→43.687852、0.02→43.687852、0.01→43.687852、0.005→43.688218、0.002→43.680000、0.001→43.592857、0.0005→43.683725），Pappus 亦落在同一值；GProps 还随长度**非单调**（L=10→34.97、L=11→49.96、L=12→39.18）——这是求积混叠的典型特征。

**判定口径**：
- **体积以三角化（`volume_mesh`）为真值**；`gen-reference.py` 为此在 manifest 里额外记 `volume_mesh`，B 侧用 `primitives.meshVolume()`（同 deflection 0.002 / angular 0.1）同口径计算。
- **STEP 比对仍走 `compareAssemblyFiles`**（W3 验收要求），两侧 STEP 都导入**同一个 occt-wasm 内核**测量，属同算法同口径对比，因此该路径的 GProps 混叠在两侧基本同向抵消。
- 由此产生的**唯一例外**（A 侧 GProps 质心自相矛盾）按 §5 显式归类，不做容差放宽。

---

## 2. 偏差数据（W3 全量，不只看 PASS/FAIL）

### 2.1 STEP 等价性比对（`scripts/compare-all.ts`，方案验收口径）

| 用例 | bbox 绝对差 | 体积相对差 | 质心差 |
|---|---|---|---|
| acme-1-fade-fade | 8.014e-7 | 2.347e-5% | 2.175e-6 |
| acme-1_2-fade-fade | 7.257e-8 | 1.355e-5% | 7.858e-8 |
| acme-3_4-fade-fade | 1.992e-7 | 7.971e-6% | 1.309e-7 |
| iso-m10x1.5-fade-square | 7.166e-7 | 8.742e-4% | **1.508e-1** ← 见 §5 |
| iso-m30x3.5-fade-square | 3.450e-7 | 1.003e-3% | 5.433e-5 |
| iso-m6x1-fade-fade | 5.235e-7 | 2.696e-4% | 3.063e-6 |
| iso-m6x1-fade-square | 8.741e-7 | 8.859e-4% | 1.505e-4 |
| iso-m6x1-internal | **8.744e-7** | **2.289e-3%** | 2.048e-5 |
| iso-m6x1-lefthand | 8.741e-7 | 1.637e-3% | 1.520e-4 |
| iso-m6x1-raw-raw | 1.640e-7 | 1.341e-4% | 3.408e-7 |
| iso-m6x1-square-square | 1.640e-7 | 1.381e-3% | 5.298e-6 |
| mtrap-20x4-fade-fade | 3.382e-7 | 2.583e-5% | 2.112e-6 |
| mtrap-40x7-fade-fade | 2.775e-7 | 1.780e-5% | 8.296e-7 |
| pbt-L38SP444 | 3.533e-7 | 3.733e-6% | 4.168e-7 |
| pbt-M38SP444 | 3.533e-7 | 1.103e-5% | 2.921e-7 |
| pbt-M38SP444-internal | 3.163e-7 | 2.315e-5% | 1.763e-6 |
| thread-generic-raw-raw | 1.640e-7 | 1.341e-4% | 3.408e-7 |

**最坏值**：bbox 8.744e-7 mm（门禁 1e-3，余量 1144×）；体积 2.289e-5 相对（门禁 1e-4，余量 4.4×）；质心 1.520e-4 mm（门禁 1e-3）——唯一超标项是 §5 的 A 侧伪差例。

### 2.2 内存侧（未过 STEP，用于交叉验证）

| 指标 | 最坏值 | 最坏用例 |
|---|---|---|
| bbox 绝对差 | 1.75e-6 | iso-m6x1-fade-square |
| `meshVolume` 相对差 | 6.93e-4 | acme-3_4-fade-fade |
| `volumeOf`（GProps）相对差 | 2.29e-5 | iso-m6x1-internal |

内存侧 mesh 体积差（最坏 6.93e-4）比 STEP 侧（2.29e-5）大一个量级，原因是内存侧的 A 侧基准来自 **Python/OCCT 的 mesher**、B 侧来自 **occt-wasm 的 mesher**——两个 mesher 对同一张曲面的三角化本就不同。STEP 侧把两侧都交给同一个内核，所以更能反映几何真差。这也是 W3 采用 STEP 比对作为验收口径的理由。

---

## 3. 三个根因（均已定位并落到代码/数据）

### 3.1 参考数据 bbox 曾被三角化污染（我方生成器 bug，已修）

`gen-reference.py` 的 `build_case` 原本按「`volume` → `volume_mesh`（调 `tessellate`）→ `bbox`」顺序构造 dict，而 cadquery 的 `Shape.BoundingBox()` 走 `BRepBndLib::AddOptimal(..., useTriangulation=True)`：**一旦 shape 上有三角化，它就改读三角化包围盒**。结果 manifest 的 bbox 全部偏大：

| 用例 | 污染值（旧 manifest） | 精确值（修复后） |
|---|---|---|
| thread-generic-raw-raw | 6.012626122 | 6.000000895 |
| iso-m6x1-fade-square | 6.017477650 | 6.000000257 |
| mtrap-40x7-fade-fade | 40.082774118 | 40.000000592 |
| hexnut-m6-iso4032 | 11.560587 | **11.545005** |
| sprocket-16t | 69.081043 | 69.066803 |

修复后 HexNut 的 11.545 × 10.0 × 5.2 与方案 §2.6 记录的实测值逐字吻合，M6 螺纹直径回到 6.0000002、1 英寸 Acme 回到 25.4000002 —— 这是「修复方向正确」的最强证据。

**修法**：`bbox_of` / `part_info` 改为显式 `BRepBndLib.AddOptimal_s(shape, box, False, False)`（与三角化状态解耦），并把 `volume_mesh` 挪到 `build_case` 最后。

> occt-wasm 的 `getBoundingBox` 文档也独立记录了同一陷阱：`useTriangulation=true`「on a 2.0-deflection mesh it overshot a 26 mm extent by 1.8 mm」。本包 `primitives.bboxOf` 走默认 `false`，不受影响；`kernel-conformance.test.ts` 有回归 probe 钉住该行为。

### 3.2 内核 `bsplineSurface` 是**逼近**且系统性外扩 → 直纹带改走 `loft`

W3 最初用 `bsplineSurface([...rowA, ...rowB], rows=2, cols=N)` 实现「直纹带」。实测**两行采样点全部落在 r=3.000000000**，出来的面 `xmax=3.000369534`（Δ=**3.70e-4**）：

| 每圈采样点 | 8 | 12 | 16 | 24 | 48 | 96 | 192 |
|---|---|---|---|---|---|---|---|
| Δ（mm） | 1.106e-4 | 3.320e-4 | 3.320e-4 | 3.623e-4 | 3.695e-4 | 3.699e-4 | 3.699e-4 |

**与采样密度、rows（2/3/5/9 结果完全相同）均无关，已收敛** → 不是插值误差，是曲面拟合的系统性外扩。对 Ø6 螺纹即 0.37‰ 半径超差，直接撞穿 1e-3 的 bbox 门禁（17 例中 3 例 FAIL、其余也只剩单一数量级余量）。

**换路**：`approximatePoints(row, 1e-6)` → `loft([wireA, wireB], isSolid=false, ruled=true)`，同一组点实测 `xmax=3.000000982`（Δ=**9.8e-7**，比上面**小 375 倍**）。落地于 `primitives.ruledFace`，bbox 全量最坏值随即从 9.9e-2 降到 1.75e-6。

> 顺带钉住了 `loft` 的形态语义（`kernel-conformance.test.ts` probe）：**多边 wire 会逐边配对出一张面**（4 边矩形 × 2 → 4 张侧壁面）；生产路径传的是**单边** wire，得恰好 1 张面。

### 3.3 `BRepGProp` 对螺旋面的求积混叠（体积 14% / 质心 0.15 mm）

见 §1（体积）与 §5（质心）。这一项不是我方 bug，也不是「上游方法差异」，而是 **A 侧测量值本身不可靠**，因此**不允许用容差覆盖**，只能显式归类 + 记录证据。

---

## 4. 容差标定与反向守卫（方案 §7.3.1 四步）

| 步骤 | 落地 |
|---|---|
| 1 跑 | 17 例 STEP 比对 + 内存侧 mesh/GProps 双口径，最坏值见 §2 |
| 2 出 | 本文 |
| 3 定 | `src/testing/compare.ts` 的 `CASE_TOLERANCE_OVERRIDES`：线程族仅放宽 `volumeRelativeTolerance` 1e-6 → **1e-4**（实测最坏 2.289e-5 的 4.4 倍）。**`linearTolerance` 不放宽**（bbox 实测最坏 8.74e-7，余量 1144×）。全局默认值不动（§7.3.1：全局默认只在 W8 调） |
| 4 锁 | `src/thread.test.ts`：同一例（`iso-m6x1-internal`）**旧容差 1e-6 下必须 DIFFERENT、标定容差下必须 EQUIVALENT**；另有一条对伪差白名单的反向守卫（白名单必须精确等于当前实际伪差集合） |

---

## 5. 唯一超标项：A 侧 GProps 质心自相矛盾（显式归类，非放宽）

`iso-m10x1.5-fade-square` 的 `compareAssemblyFiles` 报 DIFFERENT，唯一不合格项是质心 **0.1508 mm**。把**两侧 STEP 导入同一内核**分别用两种方法测：

| 量 | A 侧 | B 侧 | 差 |
|---|---|---|---|
| GProps 质心 x | **+0.143267** | −0.007574 | 1.508e-1 |
| **三角化**质心 x | **−0.006756** | −0.006787 | **4.4e-5** |
| GProps 体积 | 194.521596 | 194.519895 | — |
| 三角化体积 | 194.606211 | 194.607034 | — |

A 侧自身的 GProps 质心（+0.1433）与自身三角化质心（−0.0068）相差 0.15 mm，而 **B 侧与 A 侧的三角化质心一致到 4.4e-5**。归因：**A 侧测量值错**（与 §1 体积同一求积混叠，一阶矩更敏感），不是我方几何错。

处理方式（与 cq_gears 的 `isFusedBooleanArtifact` 同构）：
- `compare.ts` 的 `KNOWN_A_SIDE_COM_ARTIFACTS` 白名单 + `classifyKnownArtifact()`：仅当「结构匹配 + 逐件体积与 bbox 全过 + 唯一不合格项是质心 + 白名单命中」才判为已知伪差；
- 白名单条目必须附实测证据，且**有反向守卫**：A 侧若被修好，该用例会变 EQUIVALENT，对应断言立即变红，强制清理白名单（避免永久豁免）。

---

## 6. 已知缺口与上游 bug 复刻（如实记录，不静默跳过）

1. **`end_finishes="chamfer"` 未实现**（W3 明确缺口）：上游用的是**非对称**倒角 `chamfer(0.5·tooth_height, 0.75·tooth_height)` 配 `RadiusNthSelector` 选边；本内核只提供等距 `chamfer`。`buildThread` **显式抛错**而非猜测性近似，错误信息指向本文。W3 的几何用例集里**不含** chamfer（覆盖度断言强制其缺席，防止「静默跳过」）。
2. **`square_off_ends` 的上游 bug 逐字复刻**：上游两次切割每次都拿**传入的 `cq_object`** 而非累积结果做基，因此两端都是 `"square"` 时实际只切了 `z>length` 一侧。A 侧用例 `iso-m6x1-square-square` 就是这么生成的（zlen=10.875 而非 9.875），故 B 侧必须一致——测试用例显式断言这一点。
3. **`PBT_FINISH_DATA` 的上游笔误**：`200: [1.5, [24.28]]` 的直径列写坏（`24.28` 不是直径），导致 `M200SP444` 判非法。逐字复刻，不「顺手修好」。
4. **`root_radius` fudge（±0.001）**：上游为让 fade 端的参数曲线面相交而引入，`toothHeight` 用 fudge 后的值——已按上游顺序实现并有单测。

---

## 7. 复现命令

```bash
# A 侧参考数据（需 cadquery venv）
C:/Users/ylt/cadquery-env/Scripts/python.exe scripts/gen-reference.py --set smoke
C:/Users/ylt/cadquery-env/Scripts/python.exe scripts/gen-reference.py --set thread

# B 侧 STEP + 比对
npx tsx scripts/export-ours.ts
npx tsx scripts/compare-all.ts          # 17/17 通过（16 EQUIVALENT + 1 已归因伪差）

# 测试
npx vitest run src/kernel-conformance.test.ts src/thread.test.ts
```

---

## 8. 对 W4–W7 的告诫

1. **bbox 必须在三角化之前取**（或用 `AddOptimal(useTriangulation=false)`）。W0/W1 的 A 侧数据已因此全部偏差过一次，`gen-reference.py` 已修；新增任何测量脚本都要遵守。
2. **体积别用 GProps 当唯一判据**。近重合/螺旋 B 样条面上它可差 14% 且非单调、布尔不可加。manifest 同时记 `volume`（GProps）与 `volume_mesh`（三角化），判定用后者；跨内核比对时优先走 STEP 让两侧同口径。
3. **质心也会被同一混叠污染**（本例 0.15 mm）。遇到「体积/bbox 全过、唯质心超差」时，先用三角化质心复核 A 侧，再决定是归类伪差还是查我方几何。
4. **容差只在 `src/testing/compare.ts` 定义**，逐类 override 必须附实测最坏值 + 本节式文档 + 反向守卫；未实测的类不得预先写进去。
