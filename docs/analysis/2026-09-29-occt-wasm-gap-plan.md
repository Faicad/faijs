# occt-wasm 内核缺口修改方案（P2 收口，2026-09-29）

日期：2026-09-29（**2026-10-01 复核更新**：§0 水位重列 + §10 新增发现 + §9 排期重排）
状态：**方案（未实施；本文件即 occt-wasm 侧排期的唯一权威清单）**
范围：cq-compat P2 攻坚后仍攻不动的内核缺口，逐项给出 occt-wasm 侧的修改路径
上游基准：cadquery-ocp 7.9.3.1.1（OCCT 7.9.3）
探针纪律：本文每个「实测结论」均来自 `packages/faijs-cadquery/src` 内的临时探针（当日 vitest 跑通），结论已留档为测试或写进 plan §8。

---

## 0. P2 攻坚结果总览

| 缺口 | 原条数 | 处置 |
|---|---|---|
| sweep 多截面（`op:sweep.multisection` 3 + pipeshell 4 + aux-spine 3） | 10 | ⚠️ **2026-10-04 B2-3b 重新定性（推翻本行原「已解锁 / 镜像 24/24 绿」的说法）**：多截面 pipe **并未解锁** —— 内核仅有单轮廓 `sweepPipeShell`，无多 `Add` 绑定 ⇒ 5 条（r5/r7/special/arc/normal）移内核 §2b / B6-11；`test_sweep__r6`/`__r8` 是单轮廓、已精确解锁（ported）；aux-spine 3 条移内核 §2 / B6-10；`circletorectSweep` 归近重合布尔 §10.1。原「24/24 绿」口径是「同形截面 + 直线脊」子集，不是多截面能力 |
| aux-spine（`SweepMode.Auxiliary`） | 3 | ❌ **内核语义缺口（2026-10-04 定性，推翻「半解锁」）**：绑定与句柄封送都正常（`sweepOriented(profile, spine, 3, up, auxSpine)`），无 `Invalid shape ID`，但该模式的几何**与 CadQuery `SetMode(aux, CurvilinearEquivalence=True)` 不等价**（实测 17759.16 vs ref 20218.35）→ 见 §2 / B6-10 |
| shell 外扩 / intersection join | 2+2 | ❌ 需内核增强 → §3 |
| `remove`/`replace`（`BRepTools_ReShape`） | 5+4+3 | ❌ 内核只有 `defeature`（语义不同，9-23 实测不得冒充）→ §4 |
| `interpPlate` | 5 | ❌ 内核无 Plate 构造（OCCT 有 `GeomPlate` 包）→ §5 |
| `narrow:sphere-angles` / 高椭圆 / chamfer-asym | 3+1+1 | ❌ 内核参数限制 → §6 |
| ~~`op:shape.offset`（3D 实体偏移）~~ | ~~4~~ | ✅ **已关闭（2026-10-04 B2-5，faijs 侧）**：实测内核 `thicken` 与 CQ `Shape.offset(t)` **逐位等价**（原「9-22 实测语义不同」的记法**被一次性捕获推翻**），faijs 已实现 free-function `offset` → §7 |
| `parametricCurve`/`parametricSurface`、`eachpoint`/`map`/`filter` | 4+~10 | C 层（解析器无 lambda）→ **非内核问题**，不属 occt-wasm 修改范围 |
| `getfixturevalue`/`images`/`raises`/`finalize` | 11+8+6+6 | pytest/非几何/helper 语义 → **永久 block，非内核问题** |

---

## 1. 修改 occt-wasm 的通用流程

1. **源码位置**：occt-wasm 是独立包（`node_modules/occt-wasm`，上游 `@salusoft89/occt-wasm` 仓库另 clone）；绑定层在 `src/index.ts`（TS wrapper）+ C++ embind 层（`src/*.cpp` 编译产物）。
2. **新增一个内核入口的完整清单**（每个缺口方案都按此结构给出）：
   - C++：`#include <OCCT 头>` + wrapper 函数（入参出参全部扁平化为 double/int/句柄 id，embind 不支持 OCCT 原生类直接暴露）；
   - embind 注册：`emscripten::class_<OcctKernel>("OcctKernel").function("新名", &…)`；
   - TS 绑定：`src/index.d.ts` 加方法签名（含 `ShapeHandle` 品牌类型）+ `src/raw-types.d.ts` 加 raw 入口；
   - 单测：occt-wasm 仓库自测 + faijs 侧探针测试（GOTCHA 留档）。
3. **验收口径**：faijs 侧以「上游 CQ 用例镜像 PASS」为准（manifest 该条 blockedBy 清除）；不许放宽容差。

---

## 2. aux-spine 单 profile（3 条）—— **2026-10-04 实测定性：内核语义缺口，非 faijs 侧**

**结论（推翻本节的「可先试，不必改 C++」假设）**：faijs 侧 API 已按原方案补齐（`sweep(wp, path, { auxSpine })` → `sweepOriented(profile, spine, 3, up, auxWire)`；句柄封送正常，无 `Invalid shape ID`），`normal=`（mode 2 FixedUp）已实现并单测锁定。但 **`SweepMode.Auxiliary` 与 CadQuery 的用法不等价**，必须改内核才可能对齐：

- CadQuery 走 `BRepOffsetAPI_MakePipeShell::SetMode(aux, CurvilinearEquivalence=True)`（`cadquery/occ_impl/shapes.py:4587`）。
- 同一组线（path 长 102.50、aux 长 105.23；端点/切向/长度已逐位比对一致）实测：

| 实现 | vol |
|---|---|
| OCR `SetMode(aux, True)` | **20218.347** ← = ref（CadQuery 2.8.0） |
| OCP `SetMode(aux, False)` | 20500.445 |
| OCP default / Fixed（`sweepOriented` mode 0） | 20500.455 |
| OCP Frenet | 19295.966 |
| **occt-wasm `sweepOriented(..., 3, up, aux)`** | **17759.157**（Δ 12.2 %） |

  即内核的 Auxiliary 模式既不等于 CV=True 也不等于 CV=False。它**仅在导引线重参数化是恒等时偶然相符**（例：`test_sweep_aux` 的 path/aux 都是长度 1），故不可依赖。

**已落地处置**：`sweep(auxSpine=…)` **显式报错**（`workplane.ts`，报错串含 `kernel:sweep-aux-spine-mode`），不再静默返回畸变几何（同 core `draft` 的 neutral-plane 拒绝范式）。三条镜像转为 `.fai.js.blocked`（证据见 `tests/mark-blocked.ts`）。长度 1 的 aux 几何（ref vol 0.9991567936618069 / f6/e12/v8）由 `src/sweep-oriented.test.ts` 直接断言捕获真值（绕过 comparator；该用例即使几何正确也因布尔近重合探针无法评级）。

**要解锁需补的绑定**：在辅助脊模式下暴露 `CurvilinearEquivalence` 标志（或按 OCCT 语义重写该模式）。**验收**：`TestCadQuery::testSweep__result`（ref vol 20218.347254736764）。对应路线图 B6-10 / G-C9。

## 2b. 多截面 pipe shell（5 条）—— **2026-10-04 实测定性：内核绑定缺口**

**结论**：CadQuery 的多截面 sweep 与 free-function `sweep(sections, path)` 都建**一个** `BRepOffsetAPI_MakePipeShell(spine)`，然后**每个截面 `Add(section, False, False)` 一次**，最后 `Build()` + `MakeSolid()`：

- `Solid.sweep_multi`（`cadquery/occ_impl/shapes.py:4682`）—— `Workplane.sweep(path, multisection=True)` 的落点（`cq.py:3860`）。
- free `sweep(s, path)`（`shapes.py:7127` / `7249`）—— face 轮廓展开为 `Solid.sweep(outerWire, innerWires, path)`（`shapes.py:4638-4655`）：**逐线建 pipe 后 `rv.cut(*inner_shapes)`**。⚠ 后者**不是**多截面缺口：单轮廓 pipe 就能复现（见下「已解锁」）。

而 occt-wasm 只暴露**单轮廓**包装 `sweepPipeShell(profile, spine, freenet?, smooth?)`（`dist/index.d.ts:169`；raw 绑定同为单 `profileId`，`raw-types.d.ts:153`）。旁路都不等价：`sweepWithLaw(profile, spine, law)` 是**轮廓缩放律**（`SetLaw`）不是截面插值；`loft(wires, isSolid, ruled)` 不跟随 spine；`sweep(wire, spine, transitionMode)` 也是单轮廓。

**实测（2026-10-04，三条近似全不符）**：

| case | ref | 最接近的构造 | 结果 |
|---|---|---|---|
| `specialSweep`（2 截面，直线脊） | vol 62.425600，f7/e15/v10 | `loft[c@x=-10, c@x=0, r@x=10]` | 65.733851（Δ 5.3 %） |
| | | `sweep(circle@x=0, line)` | 62.831853（Δ 0.65 %，**只有 3 face**） |
| | | `sweep(rect@x=10, line)` | 80.000000（Δ 28 %） |
| `test_sweep__r5`（2 个同形 rect，B 样条脊） | vol 0.913416，bb z[0,1] | `sweep(rect@z0, p2)` | vol 0.913424（Δ 8.8e-6，**数值巧合**）但 **bb z[-0.008,1.400]** |
| `arcSweep`（4 截面，弧脊） | vol 114.061557 | 任何 loft / 单轮廓 | 不适用（loft 不跟弧脊） |
| `test_sweep__r7`（2 个不同 face 截面） | vol 2.695798 | 同上 | 不适用 |

> r5 那一行是判据关键：单轮廓与多截面的**体积**可以数值巧合地接近，但**端盖平面**不同 —— 单轮廓的端盖垂直于 spine（bb 沿切线方向伸出），多截面在**给定截面的平面**封盖。两者是不同实体。

**已解锁（同一批，非内核缺口）**：`test_sweep__r6` / `__r8` 是**单轮廓** face sweep，原判 `op:sweep.pipeshell` 属陈旧标签。r8 = 线级 `sweep(rect, spline)`（volΔ 3e-12）；r6 = 上游 `Solid.sweep(face)` 的展开 `sweep(outerWire) cut sweep(innerWire)`（volΔ 2e-12）。`defaultSweep` / `recttocircleSweep` / `circletorectSweep` 三条是「同形截面 + 直线脊」，`loft` 精确等价（前两条 PASS；第三条几何精确但 comparator 布尔在近重合面上退化 ⇒ 归 §10 的 `kernel:boolean-near-coincident-bspline`）。

**要解锁需补的绑定**：暴露多截面 `Add`（`BRepOffsetAPI_MakePipeShell` 的 N×`Add(section, translate=false, rotate=false)` + `Build` + `MakeSolid`），约 30 行。**验收**：`test_sweep__r5`（ref vol 0.913416，bb z[0,1]）与 `testMultisectionSweep__specialSweep`（ref vol 62.425600）。对应路线图 B6-11 / G-C9。

## 3. shell 外扩（MakeThickSolidByJoin 完整参数）（4 条：shell-outward 2 + intersection-join 1 + hollow 1）

**现状**：内核有 `thicken(shape, thickness, tolerance)`（均匀加厚）与 `shell(solid, faces, thickness)`（抽壳）；CQ `hull(t>0)` 与 `offset(t<0, kind='intersection')` 需要的是 `BRepOffsetAPI_MakeThickSolidByJoin` 的**完整参数面**：
- `Offset` 按面单独指定（CQ `hollow` 支持 per-face thickness）；
- `Join type`：`Intersection`（内凹角外扩）/ `Arc`——内核当前只有 Arc 行为；
- `Tangent`/`Intersection` 的 `BRepOffset_MakeOffset` 上下文（非 MakeThickSolid 的简单封装）。

**修改方案（需改 C++）**：
```cpp
// occt-wasm C++ wrapper 新增：
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffset_MakeOffset.hxx>
struct ThickSolidParams {  // embind value type
  double thickness;
  int joinType;            // 0=Arc, 1=Intersection (BRepOffset_Type)
  bool intersection;
};
OcctKernel::makeThickSolidByJoin(shape, facesToRemove, params, tolerancesPerFace?);
```
- TS 绑定：`makeThickSolidByJoin(shape, faces: ShapeHandle[], params: {thickness, joinType, intersection}): ShapeHandle`。
- faijs 侧接 `Workplane.hollow/thickness`/`Shape.offset(kind='intersection')`。
- **验收**：上游 `test_hollow`（含 Intersection 分支）镜像 PASS；现 blocked 4 条清零。

## 4. remove/replace（BRepTools_ReShape）（9 条：remove 5 + replace 4 + addCavity 3 交叉）

**现状**：内核只有 `defeature(shape, faces, tolerance)`（内部 `ShapeFix`/删特征重建，9-23 实测返回 6 面实体 vs CQ 5 面开放壳——语义不同）。CQ `Shape.remove(shape, kind)` / `Workplane.replace` 底层是 `BRepTools_ReShape`（拓扑替换/删除且保持其它实体共享）。

**修改方案（需改 C++）**：
```cpp
#include <BRepTools_ReShape.hxx>
// Replace: BRepTools_ReShape::Replace(old, new) → Apply(shape)
OcctKernel::reshapeReplace(shape, oldShape, newShape): ShapeHandle
// Remove: BRepTools_ReShape::Remove(shape) → Apply
OcctKernel::reshapeRemove(shape, toRemove): ShapeHandle
```
- embind 只传句柄 id；`BRepTools_ReShape` 无 Build 阶段（Apply 即得），封送简单。
- faijs 侧落 `Shape.remove/replace` 类模型方法（shape-class.ts 已有 borrowed/owned 框架）。
- **验收**：上游 `test_remove`/`test_replace` 镜像 PASS（注意 CQ remove 产物是开放壳——断言按 area 而非 volume）。
- **工作量**：C++ ~40 行 + 绑定 ~20 行 + faijs 封装 1 人日内。

## 5. interpPlate（GeomPlate）（5 条）

**现状**：内核无任何 Plate 入口。CQ `Workplane.interpPlate(edges, points, tol, plDegree, pressure)` 底层 `GeomPlate_BuildPlateSurface`（N 边插值曲面，点约束 + 边约束）。

**修改方案（需改 C++，工作量最大）**：
```cpp
#include <GeomPlate_BuildPlateSurface.hxx>
#include <GeomPlate_PointConstraint.hxx>
#include <GeomPlate_CurveConstraint.hxx>
// 输入：边界曲线句柄数组 + 采样点阵 + 公差/阶数/压力参数
OcctKernel::interpPlate(boundaryCurves: ShapeHandle[], points: double[], nPts,
                        tolerance: double, degree: int, pressure: double): ShapeHandle
```
- C++ 内部：为每条 boundary curve 建 `BRepAdaptor_Curve + GeomPlate_CurveConstraint`，每点建 `GeomPlate_PointConstraint`，`BuildPlateSurface.Perform()` → `PlateSurface` → `BRepBuilderAPI_MakeFace`。
- 输出 face 句柄；embind 数组用 `std::vector<double>` flat 传递。
- **验收**：上游 `test_interpPlate` 5 条镜像 PASS（对照 ref STEP 面积/体积）。
- **工作量**：2–3 人日（含 embind 数组封送调试）。

## 6. 球角 / 高椭圆 / 非对称倒角（5 条）

**现状**（三个独立限制）：
- `makeSphere` 不支持部分角球（CQ `Sphere(angle1, angle2, angle3)`）——绑定只有整球；
- 高椭圆（`major < minor`）被 `gp_Elips` 拒绝（workplane.ts ellipse 已 fail-loud 注明）；
- `chamferDistAngle` 存在但 CQ 的非对称 chamfer 语义（两距离 `Chamfer(length, length2)`）无入口。

**修改方案**：
1. **球角**：C++ 用 `BRepPrimAPI_MakeSphere(r, angle1, angle2, angle3)` 全参构造重载（OCCT 现成），绑定 `makeSphereAngles(center, r, a1, a2, a3)`。~30 行。
2. **高椭圆**：C++ `gp_Elips` 后调 `gp_Elips::SetMajorRadius/MinorRadius` 前先判断，或直接 `Elips(gp_Ax2, major, minor)` 交换 + `TopoDS` 翻转 orientation 实现 minor-on-X；更简单的是绑定层加 `makeEllipseArc(center, normal, major, minor, a0, a1, flip)`，在 wrapper 内做坐标交换（不触 OCCT 源码）。~50 行。
3. **非对称倒角**：`BRepFilletAPI_MakeChamfer::Add(dis1, dis2, edge, face)` 双距离重载——绑定 `chamfer2Dist(solid, edges, d1, d2, face)`。~40 行。
- **验收**：`narrow:sphere-angles`/`narrow:chamfer-asym`/`ellipse-tall-axis` 相关 manifest 条清零。

## 7. 3D 实体偏移 `op:shape.offset`（4 条）—— ✅ **已关闭（2026-10-04 B2-5，faijs 侧，无需改内核）**

**结论（推翻本节原「语义不同」的判断）**：内核 `thicken(shape, t, tol)` 与上游 CQ `Shape.offset(t)` **逐位等价**，原「9-22 实测语义不同」的说法是**凭印象的错误记法**，已由一次性 CadQuery 2.8.0 捕获推翻：

| case | ref（CQ 2.8.0 捕获） | faijs `offset`（内核 `thicken`） | Δ |
|---|---|---|---|
| `test_offset__r1`（`plane(1,1)`，t=1） | Solid vol 1，f6，bb z[0,1] | 同 | volΔ ≤2.2e-14 |
| `test_offset__r2`（`box.shells()`，t=−0.25） | Solid vol 0.875，f12，bb z[−0.5,0.5] | 同 | 同 |
| `test_offset__r3`（`plane(1,1)`，t=1，`both=True`） | Solid vol 2，f10，bb z[−1,1] | 同 | 同 |
| `test_offset__r4`（`moved` compound 双面，t=1，`both=True`） | Compound vol 4，f20，bb xy[−0.5,5.5] | 同 | 同 |

**落地**：free-function `offset(s, t, {cap, both, tol})`（`packages/faijs-cadquery/src/workplane.ts`）——逐 Face/Shell 调 `kernel.thicken`；`both` = `fuse(thicken(+t), thicken(−t))`；`cap:false` 显式报错（内核 `thicken` 无 cap 标志）；非 Face/Shell 显式报错。**`op:shape.offset` 标签 4 条全退役**，4 条镜像全 PASS。

> **不属内核范围的残条**：`op:offset2D-multi-region`（1 条，`test_offset2D`）仍 blocked —— 它需要 `MakeOffset2D` 的**多区域分裂**语义（`Plane` 平面内偏移，非 3D 加厚），与本节无关；另 `test_offset2D` 还用到 `plane()` 无参重载（faijs 显式不支持）。

---

## 8. 明确不动的（记录理由）

- **C 层（解析器）**：`parametricCurve/Surface`、`eachpoint/each/cutEach/map/filter/invoke`——需要 `.fai.js` 解析器支持函数字面量，与 occt-wasm 无关；若未来立项走 parser 路线（plan Stage 6 已注明单独立项）。
- **pytest 语义**：`getfixturevalue`（11）、`raises`（6）、`images`（8）——非几何。
- **Assembly `finalize`**（6）：helper 语义，faijs 侧 Sketch.finalize 已覆盖同名面。

## 9. 优先级建议（若立项内核增强）

> 2026-10-01 复核：按当前 manifest 水位与工作量重排（见 §10 的逐项条数）。

1. §4 reshapeRemove/Replace（1 人日，解锁 remove 5 + replace 相关条目，API 简单）；
2. §6.1 球角（0.5 人日，narrow:sphere-angles 3 条）；
3. §3 makeThickSolidByJoin（1–2 人日，解锁 shell-outward-opening 2 + shell-intersection-join 1 + hollow 精度 2 ≈ 5 条；~~op:shape.offset 4~~ 已于 2026-10-04 B2-5 在 faijs 侧用 `thicken` 关闭，不再计入内核工作量）；
4. §6.2 高椭圆（ellipse-tall-axis 1）/ §6.3 双距离倒角（chamfer-asym 1）（合计 ~1 人日）；
5. §2b makePipeShell 多截面 `Add`（~30 行，解锁 `kernel:sweep-multisection-pipe` 5 条；API 简单、收益/成本比高）；
6. §2 aux-spine 绑定验证（0.5 人日试探；2026-10-04 已实测 `sweepOriented` 的 Auxiliary 模式语义不符，需暴露 `CurvilinearEquivalence`，`kernel:sweep-aux-spine-mode` 3 条）；
7. §5 GeomPlate（2–3 人日，interpPlate 5 条，最后做）。

---

## 10. 复核记录（2026-10-01：manifest 当前内核相关 blocked 全量水位）

> 数据源：`packages/faijs-cadquery/tests/manifest.json`（449 ported / 201 blocked / 47 skipped）。下列条目均以当前 blockedBy 精确重列，替代 §0 的原始估计。

### 10.1 `kernel:*` 直接登记（11 个标签 / 31 条，2026-10-04 B2-3b 后实读）

| blockedBy | 条数 | 状态与方案归属 |
|---|---|---|
| `kernel:sweep-multisection-pipe` | 5 | **§2b**（2026-10-04 新增：多截面 pipe 无多 `Add` 绑定；含 r5/r7/special/arc/normal） |
| `kernel:boolean-near-coincident-bspline` | 4 | testTwistExtrude__r / testTwistExtrudeCombine__r（comparator 探针失败）/ **testTwistExtrudeCombineCut__cut（2026-10-01 新实证：90° 扭曲工具体 cut 进盒体，内核布尔 >300 s 挂死——BooleanOp 本体缺陷，不止 comparator）** / **testMultisectionSweep__circletorectSweep（2026-10-04：cand 是「同形截面+直线脊」的精确 loft，volΔ 1.13e-5、7 个面面积均在 1e-5 内、topo f7/e15/v10 全中；`cut(ref,cand)` 返回整个 ref、`common`=0、`fuse`=-2.1e-4；两实体各自与外部半盒布尔正常〔36.7390/36.7395〕，近重合破开〔cand 缩放 0.98〕后布尔恢复〔4.44〕）**。方案：occt-wasm 侧核查 BOPAlgo fuzzy/区间处理，或提供可中断/限时布尔。无独立小节（原 E4）。 |
| `kernel:fillet-chain-reapply` | 9 | **2026-10-01 新发现**：内核 fillet 拒绝对「fillet 产出」再 fillet——`fillet: operation failed`（8 条顶棱）或 `fillet: TopoDS::Solid`（单边、内核层探针），而输入仍是 1-solid TopoDS（getSubShapes('solid')==1）。testEnclosure 整链（|Z r10 → #Z r2 两次 fillet）被挡：op:split-all 的 faijs 侧缺口（split keepTop/keepBottom + partAt）已关闭，剩余纯内核问题。GOTCHA 已钉进 `p1-workplane-ops.test.ts`。方案：occt-wasm 侧核查 fillet wrapper 的句柄生命周期/类型封送（输入 shape 是否在二次调用间被降级）。 |
| `kernel:shell-outward-opening` | 2 | §3 |
| `kernel:draft-existing-solid` | 2 | test_draft__res1/res2 + test_free_functions test_draft —— 既有实体拔模（BRepOffsetAPI_DraftAngle 全参面），§0 未单列；需在 occt-wasm 暴露 `BRepOffsetAPI_MakeDraft`/`DraftAngle` 完整入口（face + angle + direction），~40 行。 |
| `kernel:shell-intersection-join` | 1 | §3 |
| `kernel:crash-polygon-cutThruAll` | 1 | 多边形穿透切割崩溃——occt-wasm 侧稳定性缺陷，需最小复现报上游。 |
| `kernel:loft-coplanar-sections` | 1 | 共面截面放样拒绝。 |
| `kernel:ellipse-tall-axis` | 1 | §6.2 |

### 10.2 hollow 精度（2 条，随 §3 落地）

`test_hollow__res2` / `test_hollow_open__res2`：上游 MakeThickSolidByJoin Intersection join（锐外角）vs 内核 arc-join（圆角），unit box `0.698/0.565` vs `0.728/0.584`。§3 的 `makeThickSolidByJoin(params)` 落地即解锁。

### 10.3 sweep 残量（9 条，2026-10-04 B2-3b 后实读）

| blockedBy | 条数 | 说明 |
|---|---|---|
| `kernel:sweep-multisection-pipe` | 5 | §2b（2026-10-04 由 `op:sweep.pipeshell`(4) + `op:sweep.multisection`(3) 归并而来：其中 `test_sweep__r6`/`__r8` 单轮廓即可复现 ⇒ 已解锁转 ported；`r5`/`r7`/`specialSweep`/`arcSweep`/`normalSweep` 是真多截面缺口） |
| `kernel:sweep-aux-spine-mode` | 3 | §2（2026-10-04 由 `op:sweep.aux-spine` 改名：op 已实现，缺口在内核模式语义） |
| `op:sweep-sketch-sections` | 1 | testSketch r6：spline 帧放置 + sketch 截面 sweep |

> `op:sweep.pipeshell`(4) / `op:sweep.multisection`(3) 两个标签 **2026-10-04 退役**；`circletorectSweep` 从 `op:sweep.multisection` 改判 `kernel:boolean-near-coincident-bspline`（§10.1 同类，非 sweep 缺口）。

### 10.4 内核/新 op 类（2026-09-30 ~ 10-01 镜像攻坚后新浮出）

| blockedBy | 条数 | 说明 |
|---|---|---|
| `op:solid-voids` | 4 | solid(...) 内 void 缝合（外层面 + 内层面反侧成 void）——solidFromFaces 无内面反侧处理；occt-wasm 侧可加 `makeSolidWithVoids(outer, inner[])`（内壳反向 orientation 后 sew+makeSolid），~60 行 |
| `op:prism-from-face` | 4 | **2026-10-01 归内核**：上游 `func.prism` 的 from/to-face / to-face / through-all 重载走 `BRepFeat_MakePrism`（特征棱柱：Perform(f1,f2) 布尔融合语义），occt-wasm 只有 `BRepPrimAPI_MakePrism` 向量挤出，outerWire loft 无法复刻其拓扑（ref f9 vs 简单放样）。需 BRepFeat_MakePrism 绑定（profile face + base face + direction + Perform 重载），~80 行 |
| `op:prism-tilt` | 1 | 非法向方向挤出（BRepPrimAPI_MakePrism 直接支持任意方向向量，封送即可，~20 行） |
| ~~`op:extrude-taper-sketch`~~ | ~~2~~ | **已关闭（2026-10-01，faijs 侧）**：extrude taper 分支消费 pendingFaces（draftPrism），testSketch r2 镜像 PASS |
| ~~`op:solid-makeSolid-3d-wire`~~ | ~~1~~ | **已关闭（2026-10-01，faijs 侧）**：`faceFromPoints`（3D 顶点环 → wire → face）+ 既有 solidFromFaces 给出精确 √2/12 四面体，testMakeShellSolid__solid 镜像 parity PASS |
| ~~`op:sweep-hole-section`~~ | ~~1~~ | **已关闭（2026-10-01）**：test_history_sweep__res 的 ref STEP 是单位盒（ref 侧异常，非扫掠产物）——镜像按 ref 几何复现翻 ported，不隐含带孔 sweep 能力 |

### 10.5 其余与内核无关的大块（如实列出，非本文件范围）

- `imprint` 12、`remove` 5、`interpPlate` 5（§5）、`placeSketch` 残量、Assembly 求解器 `op:assembly-solve` 8、pytest/harness 语义 ~19。

### 10.6 复核结论

内核侧可估总量：**§4 reshape 1 人日 + §6 球角/椭圆/倒角 ~1.5 人日 + §3 ThickSolidByJoin 1–2 人日 + §10.4 三个新原语（voids/face-loft/tilt）~2 人日 + aux-spine 验证 0.5 人日 + GeomPlate 2–3 人日 ≈ 8–10 人日**，可解锁 manifest 内核相关 blocked 约 **40 条**（13 kernel + 2 hollow + 9 sweep + 10 新 op 类，去重后）。§10.4 中 `op:extrude-taper-sketch` 与 `op:solid-makeSolid-3d-wire` 是 faijs 侧缺口，不计入 occt-wasm 工作量。
