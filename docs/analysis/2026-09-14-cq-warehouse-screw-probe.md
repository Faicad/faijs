# fai_cq_warehouse W5（Screw）偏差分析与两个几何陷阱实测

日期：2026-09-14 ｜ 上游：`cq_warehouse` v0.8.0（git HEAD `daa4650`）｜ 复现台：`scripts/kernel-screw-probe.ts`、`scripts/probe-screw-head-profiles.py`

W5 = 12 个螺钉类（`fastener.py` 的 Screw 族）。本文只记**判定口径、实测数据、根因与容差标定**；装配语义与逐类公式见 `.agents/notes/implemented/feature/2026-09-14-fai-cq-warehouse-screw-geometry.md`。

## 1. 判定口径

与 W3/W4 一致（方案 §7.3）：

1. 判定入口只有 `compareAssemblyFiles`（经 `src/testing/compare.ts` 封装），**不是** `compareStepFiles`（后者只比整件 solid 数）。
2. 主判据 = 逐件**体积 / bbox / 质心**；`skipFusedBoolean: true`（近重合曲面上的整体布尔差不可信，cq_gears 已证 `Cut` 会返回反向/垃圾实体）。
3. 容差只在 `src/testing/compare.ts` 定义：全局默认 `volumeRelativeTolerance 1e-6` / `linearTolerance 1e-3`，逐类 override 必须带实测最坏值 + 指向本文。
4. A 侧真值一律走 `volume_mesh`（W4 已证 A 侧 `volume` 对 revolve 原生带孔管是 2× 解析值）。

## 2. 验收结果

| 项 | 结果 |
|---|---|
| 参考用例 | **32 例**（12 类；每类 ≥2 规格） |
| 可做几何比对 | **28 例**（= 32 − 4 已知缺口） |
| STEP 等价 | **28 / 28 EQUIVALENT**（其中 1 例 `screw-shcs-m6-iso4762-threaded` 走路内 override） |
| 已知缺口 | **4 例**显式抛 `E_RECESS_TAPER_UNSUPPORTED`（测试断言抛错，不静默跳过） |
| 包内测试 | `src/screw.test.ts` **70 / 70**；整包 `vitest run` **234 / 234**（8 文件） |
| spine 用例 | `screw-shcs-m6-iso4762` A 侧实测 `900.6842796`（B 侧同值），方案验收 ① 过 |

逐类规格数（manifest 强制，`src/screw.test.ts` 覆盖度自检）：

| 类 | 例数 | 类 | 例数 |
|---|---|---|---|
| ButtonHeadScrew | 2 | PanHeadScrew | 3 |
| ButtonHeadWithCollarScrew | 2 | PanHeadWithCollarScrew | 2（缺口） |
| CheeseHeadScrew | 3 | RaisedCheeseHeadScrew | 2（缺口） |
| CounterSunkScrew | 5 | RaisedCounterSunkOvalHeadScrew | 3 |
| HexHeadScrew | 3 | SetScrew | 2 |
| HexHeadWithFlangeScrew | 2 | SocketHeadCapScrew | 3（含 1 例 `simple=false`） |

`simple=True/False` 覆盖：`screw-shcs-m6-iso4762-threaded`（`simple=false` → 真实螺旋外螺纹）。`CounterSunkScrew`（5 例，含 `hand=left` 1 例）与 `SetScrew`（2 例）单列。

## 3. 根因一：`edgeCenter` 是**圆弧质心**，不是圆心（cq 选择器语义）

RCOS 的头型轮廓用 `profile.toPending().edges(">Z").vertices(">X").vals()` 选圆角落点。`edges(">Z")` 的排序键是 `Edge.Center()`，而 **`Edge.Center()` 对圆弧给的是圆弧质心，不是圆心**：

| 量 | 值 | 说明 |
|---|---|---|
| RCOS 优弧圆心 z | `−9.165350`（三点外接圆，取自 dump 6 位小数） | 若拿它当排序键 |
| RCOS 优弧**质心** z | `2.386` | 才是正确的排序键 |
| `vLineTo` 中点 | `1.4173` | 被比下去 |
| 其余边（直线）质心 | ≤ 1.5 | 被比下去 |

把圆心当质心 → `edges(">Z")` 选错边 → 圆角倒到轴线角点上，几何全错。回归锁：`src/screw.test.ts`「RCOS 的 `edges(">Z")` 排序键是**圆弧质心**（2.386）而非圆心（−9.165）」，`screw.ts:edgeCenter()` 里带同款注释。

实现上 `edgeCenter()` 用「圆心 + `2R·sin(Δ/2)/Δ` · 单位弧中点向量」（Δ = 有向张角）复刻，与 A 侧 `edges(">Z")` 的选边结果逐例一致。

## 4. 根因二：`fillet2D` 的圆弧邻边不能用直线近似

`Wire.fillet2D(radius, vertices)` 的圆角切点，**当邻边是圆弧时**不能套「两直线角」的闭式 `t = r/tan(θ/2)`。

RCOS（`RaisedCounterSunkOvalHeadScrew`，M6-1 iso2010，`rf=12, dk=11, k=1.5, a=90°`）的圆角落点是「**优弧末点 − 锥面母线**」，半径 `0.075k = 0.1125`：

| 量 | B 侧（直线近似） | B 侧（圆心连线精确解） | A 侧 probe dump |
|---|---|---|---|
| 弧侧切点 x | `5.363082` | `5.3610355` | `5.361036` |
| 弧侧切点 y | `1.570607` | `1.5705238` | `1.570524` |
| 直线侧切点 | `5.391069, 1.391069` | `5.3903253, 1.3903253` | `5.390325, 1.390325` |
| 弧侧切点距圆心 | `12.000988` | `12.000000` | — |

直线近似给出一个**落在弧外**的点（`|p1 − Q| = 12.00099 ≠ rf = 12`），误差 `2.0e-3`；精确解与 A 侧 dump **六位全等**。

精确解的构造：圆角圆心 C 由两条约束确定 —— 直线边 `(C − a)·n = r`（n = 料内侧单位法向），圆弧边 `|C − Q| = R ∓ r`（圆角落在圆内取 `R−r`）；弧侧切点 = `Q + R·unit(C − Q)`（内切/外切同式），直线侧切点 = 垂足。两直线角退化为 `t = r/tan(θ/2)`，与原实现逐位等价（已对 `CounterSunkScrew` / `SocketHeadCapScrew` / `CheeseHeadScrew` 用例验证：`csk-m6-iso10642` 的 `t = 0.597511` → 切点 `(5.402489, 3.3)`，与 A 侧 `5.402482` 一致）。

回归锁：`src/screw.test.ts`「W5 头型轮廓：逐顶点回归锁」11 组，期望值逐字取自 `scripts/probe-screw-head-profiles.py` 的 A 侧边端点 dump。

## 5. 根因三：螺旋外螺纹的 GProps 求积混叠（容差标定的唯一越界项）

唯一越界用例 `screw-shcs-m6-iso4762-threaded`（`simple=false`，杆长 25）。两侧 STEP 导入**同一 occt-wasm 内核**测量（`scripts/kernel-screw-probe.ts` 段 1）：

| 量 | A 侧 | B 侧 | 两侧差 |
|---|---|---|---|
| GProps 体积 | `997.839734` | `997.425683` | `4.149e-4`（相对，= 判据 `vol`） |
| GProps 质心 | `(−0.000879, −0.000584, −5.952414)` | `(0.013434, −0.055304, −5.974063)` | `5.472e-2` mm（= 判据 `com`） |
| 三角化体积（弦高 2e-3） | `997.408197` | `997.195434` | `2.133e-4` |
| 三角化质心（弦高 2e-3） | `(0.000875, 0.002425, −5.964625)` | `(0.000816, 0.002484, −5.963071)` | `1.554e-3` mm |
| **自偏差：GProps 体积 vs 自身三角化** | `4.325e-4` | `2.308e-4` | 两侧都不自洽 |
| **自偏差：GProps 质心 vs 自身三角化** | **`1.221e-2` mm** | **`5.779e-2` mm** | 两侧都不自洽 |

关键反驳：**同一侧、同一 shape**，GProps 质心与三角化质心就差了 `1.2e-2` / `5.8e-2` mm（B 侧 y 分量 `−0.055304` vs 自身三角化 `+0.002484`）→ 一阶矩在螺旋 B 样条面上不可信，**不是几何差**。一阶矩对该混叠比体积敏感一个量级以上。

网格收敛（`scripts/kernel-screw-probe.ts` 段 3）证明差在**网格/求积**而非曲面：

| 弦高 | 三角化体积相对差 | 三角化质心最大差 |
|---|---|---|
| `2e-3`（默认） | `2.133e-4` | `1.554e-3` mm |
| `8e-4` | `5.818e-6`（↓37×） | `4.203e-5` mm（↓37×） |

差随弦高**同比例收敛** → 是离散化伪差，几何本身一致。

对照（同族 `simple=true` 光杆，`screw-shcs-m6-iso4762`，段 2）：体积相对差 `1.010e-15`、质心 `5.135e-11` mm —— 差异**全部**来自螺纹段，与头型/杆部无关（也反证了头型/杆部已逐位复刻）。

## 6. 容差标定与反向守卫（方案 §7.3.1 四步）

| 步 | 内容 |
|---|---|
| ① 实测最坏值 | 见 §5：`vol 4.149e-4` / `com 5.472e-2` mm |
| ② 分析文档 | 本文 §5 |
| ③ 逐类 override | `src/testing/compare.ts`：`match: /^screw-shcs-m6-iso4762-threaded$/`，`volumeRelativeTolerance: 2e-3`（= 4.149e-4 × 4.8）、`linearTolerance: 2e-1`（= 5.472e-2 × 3.7），政策与线程族（×4.4）/ 螺纹螺母（×4.37）一致 |
| ④ 反向守卫 | `src/screw.test.ts`：同一例在全局默认 `1e-6` 下必须 **DIFFERENT**、在标定容差下必须 **EQUIVALENT** |

`linearTolerance` 放到 `2e-1` 的理由：该量**自身**（同侧两种测法）自偏差就有 `5.8e-2` mm，再紧的闸门守的是噪声而不是几何。几何等价由 §5 的三角化收敛（`5.818e-6` / `4.203e-5` mm）+ 光杆对照（`1e-15` / `5e-11`）直接证明。

本例 bbox 差实测 `0.000e+0`，故 `linearTolerance` 的放宽只影响质心项，不掩盖任何位置偏差。

## 7. 已知缺口（如实记录）

`PanHeadWithCollarScrew`（din967）与 `RaisedCheeseHeadScrew`（iso7045）各自**唯一**的 `fastener_type` 都是 PH（cross）沉孔。其 30° 锥度切割器在臂宽退化后，A 侧 `LocOpe_DPrism` 续生锥面；本内核 `draftPrism` 在同一处自交 → 显式抛 `E_RECESS_TAPER_UNSUPPORTED`（`src/recess.ts` 文件头记有同款说明）。

- manifest 覆盖 **4 例**（pancollar M6/M4 + raisedcheese M6/M4），测试逐例断言抛错。
- **缺口只在 recess**：这两类的 `head_profile` 仍被逐顶点锁住（`src/screw.test.ts`「缺口只在 recess」）。
- 不静默近似、不跳过、不进 PASS 计数。

## 8. 复现命令

```bash
cd packages/fai_cq_warehouse

# A 侧头型轮廓边序列（需 cadquery venv）
"C:/Users/ylt/cadquery-env/Scripts/python.exe" scripts/probe-screw-head-profiles.py

# 内核侧证据（GProps vs 三角化 + 网格收敛 + 光杆对照）
npm run probe:screw                            # 全部 3 段（= npx tsx scripts/kernel-screw-probe.ts）
npx tsx scripts/kernel-screw-probe.ts 3        # 只跑网格收敛

# B 侧 STEP + 比对
npx tsx scripts/export-ours.ts --set screw

# 测试
npx vitest run src/screw.test.ts
npx vitest run
```

## 9. 对 W6–W7 的告诫

1. **cq 选择器 `>Z` / `>X` 的排序键是 `Edge.Center()` = 圆弧质心**。轴承（W6）内外圈、链轮（W7）齿廓都会大量出现圆弧边，凡是用 `vertices(">X")` / `edges(">Z")` 选点的地方，一律先确认键是质心而不是圆心。
2. **`fillet2D` 的圆弧邻边必须走圆心连线精确解。** 本包有两份圆角实现：`primitives.filletCorner2D`（W4 沉淀，`recess.ts` 在用）与 `screw.filletAt`（W5）。前者文档明确限定「**两直线夹角**处」，其唯一调用点喂进去的是显式 12 顶点多边形（全直线邻边），**当前无圆弧邻边暴露**，故未改。W5 只修了 `screw.filletAt`。**W6/W7 若在 polygon-wire 语境里要对「圆弧-直线」或「圆弧-圆弧」角倒圆，必须先升级 `filletCorner2D`**（届时把本包的精确解法上收到 `primitives`，两份合并，不得并存）。
3. **真实螺纹段的容差按类 override，一条一条标定**——不要提前给整族放宽。螺钉族的其它 27 例在全局默认 `1e-6` 下就已等价，放宽它们会掩盖真错。
4. **`SetScrew` 的 `custom_make` 语义**：上游是「圆柱 + 同心六角孔后镜像」，B 侧等价实现为 `cut(cylinderBetween(minRadius, −L, 0), hexPrism(e, −t, 0))`；直接嵌套 wire 成孔会失败（探针逐位吻合，A 侧 `200.625411` vs B 侧 `200.625508`）。
