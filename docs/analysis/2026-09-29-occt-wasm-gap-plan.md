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
| sweep 多截面（`op:sweep.multisection` 3 + pipeshell 4 + aux-spine 3） | 10 | ✅ **已解锁**：`sweepPipeShell`（MakePipeShell）+ 端盖 `sewAndSolidify`（探针实测 valid solid）；cq-compat `sweep` 已扩 `multisection` 选项，镜像 24/24 绿 |
| aux-spine（`SweepMode.Auxiliary`） | 3 | ⚠️ 半解锁：内核绑定存在（`sweepOriented(profile, spine, 3, up?, auxSpine?)`），但**单 profile + auxSpine 组合未探通**（mode 3 抛 `Invalid shape ID: 0`）→ 见 §2 |
| shell 外扩 / intersection join | 2+2 | ❌ 需内核增强 → §3 |
| `remove`/`replace`（`BRepTools_ReShape`） | 5+4+3 | ❌ 内核只有 `defeature`（语义不同，9-23 实测不得冒充）→ §4 |
| `interpPlate` | 5 | ❌ 内核无 Plate 构造（OCCT 有 `GeomPlate` 包）→ §5 |
| `narrow:sphere-angles` / 高椭圆 / chamfer-asym | 3+1+1 | ❌ 内核参数限制 → §6 |
| `op:shape.offset`（3D 实体偏移） | 4 | ⚠️ 内核有 `thicken`/`shell`，与 CQ `Shape.offset` 语义差需逐条核对 → §7 |
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

## 2. aux-spine 单 profile（3 条，半解锁）

**现状**：`sweepOriented(profile, spine, mode, up?, auxSpine?)` 绑定已存在；`SweepMode.Auxiliary = 3` 要求传 `auxSpine`。探针实测：mode 3 不传 auxSpine 抛 `Invalid shape ID: 0`（预期），**传 auxSpine 的组合未验证成功**——cq-compat 侧无 auxSpine 的 Workplane 级 API 面（上游 `Workplane.sweep(path, auxSweep?)` 传第二个 Workplane）。

**修改方案（可先试，不必改 C++）**：
1. faijs 侧先补 API：`sweep(wp, path, { auxSpine: Workplane })` → `sweepOriented(profile, spine, SweepMode.Auxiliary, undefined, auxWire)`；
2. 若绑定层已正确透传（大概率），直接解锁 3 条；若 `up`/`auxSpine` 的 Vec3/句柄转换有 bug（`Invalid shape ID` 提示句柄桥问题），修 occt-wasm 的 `src/index.ts` 中 `sweepOriented` 的参数封送：确认 auxSpine 的 `ShapeHandle` id 正确传到 embind 层（对照 `sweep(profile, spine)` 的封送代码）。
3. **验收**：上游 `test_sweep_aux_spine` 镜像 PASS。

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

## 7. 3D 实体偏移 `op:shape.offset`（4 条）

**现状**：内核 `thicken(shape, t, tol)` 均匀加厚 face/shell；CQ `Shape.offset(t)` 对 solid 是 `BRepOffset_MakeOffset`（Join=Intersection 内核级别），对 face/shell 产物是 open shell——9-22 实测语义不同。

**修改方案**：与 §3 同源（同一 `BRepOffset_MakeOffset` 上下文），§3 的 `makeThickSolidByJoin(params)` 落地后，`shape.offset` 用 `joinType=Intersection + facesToRemove=[]` 即可复用同一入口。**不单独立项**。

---

## 8. 明确不动的（记录理由）

- **C 层（解析器）**：`parametricCurve/Surface`、`eachpoint/each/cutEach/map/filter/invoke`——需要 `.fai.js` 解析器支持函数字面量，与 occt-wasm 无关；若未来立项走 parser 路线（plan Stage 6 已注明单独立项）。
- **pytest 语义**：`getfixturevalue`（11）、`raises`（6）、`images`（8）——非几何。
- **Assembly `finalize`**（6）：helper 语义，faijs 侧 Sketch.finalize 已覆盖同名面。

## 9. 优先级建议（若立项内核增强）

> 2026-10-01 复核：按当前 manifest 水位与工作量重排（见 §10 的逐项条数）。

1. §4 reshapeRemove/Replace（1 人日，解锁 remove 5 + replace 相关条目，API 简单）；
2. §6.1 球角（0.5 人日，narrow:sphere-angles 3 条）；
3. §3 makeThickSolidByJoin（1–2 人日，解锁 shell-outward-opening 2 + shell-intersection-join 1 + hollow 精度 2 + op:shape.offset 4 ≈ 9 条，含 §7 复用）；
4. §6.2 高椭圆（ellipse-tall-axis 1）/ §6.3 双距离倒角（chamfer-asym 1）（合计 ~1 人日）；
5. §2 aux-spine 绑定验证（0.5 人日试探，op:sweep.aux-spine 3 条）；
6. §5 GeomPlate（2–3 人日，interpPlate 5 条，最后做）。

---

## 10. 复核记录（2026-10-01：manifest 当前内核相关 blocked 全量水位）

> 数据源：`packages/faijs-cadquery/tests/manifest.json`（449 ported / 201 blocked / 47 skipped）。下列条目均以当前 blockedBy 精确重列，替代 §0 的原始估计。

### 10.1 `kernel:*` 直接登记（13 条）

| blockedBy | 条数 | 状态与方案归属 |
|---|---|---|
| `kernel:boolean-near-coincident-bspline` | 3 | testTwistExtrude__r / testTwistExtrudeCombine__r（comparator 探针失败）/ **testTwistExtrudeCombineCut__cut（2026-10-01 新实证：90° 扭曲工具体 cut 进盒体，内核布尔 >300 s 挂死——BooleanOp 本体缺陷，不止 comparator）**。方案：occt-wasm 侧核查 BOPAlgo fuzzy/区间处理，或提供可中断/限时布尔。无独立小节（原 E4）。 |
| `kernel:fillet-chain-reapply` | 9 | **2026-10-01 新发现**：内核 fillet 拒绝对「fillet 产出」再 fillet——`fillet: operation failed`（8 条顶棱）或 `fillet: TopoDS::Solid`（单边、内核层探针），而输入仍是 1-solid TopoDS（getSubShapes('solid')==1）。testEnclosure 整链（|Z r10 → #Z r2 两次 fillet）被挡：op:split-all 的 faijs 侧缺口（split keepTop/keepBottom + partAt）已关闭，剩余纯内核问题。GOTCHA 已钉进 `p1-workplane-ops.test.ts`。方案：occt-wasm 侧核查 fillet wrapper 的句柄生命周期/类型封送（输入 shape 是否在二次调用间被降级）。 |
| `kernel:shell-outward-opening` | 2 | §3 |
| `kernel:draft-existing-solid` | 2 | test_draft__res1/res2 + test_free_functions test_draft —— 既有实体拔模（BRepOffsetAPI_DraftAngle 全参面），§0 未单列；需在 occt-wasm 暴露 `BRepOffsetAPI_MakeDraft`/`DraftAngle` 完整入口（face + angle + direction），~40 行。 |
| `kernel:shell-intersection-join` | 1 | §3 |
| `kernel:crash-polygon-cutThruAll` | 1 | 多边形穿透切割崩溃——occt-wasm 侧稳定性缺陷，需最小复现报上游。 |
| `kernel:loft-coplanar-sections` | 1 | 共面截面放样拒绝。 |
| `kernel:ellipse-tall-axis` | 1 | §6.2 |

### 10.2 hollow 精度（2 条，随 §3 落地）

`test_hollow__res2` / `test_hollow_open__res2`：上游 MakeThickSolidByJoin Intersection join（锐外角）vs 内核 arc-join（圆角），unit box `0.698/0.565` vs `0.728/0.584`。§3 的 `makeThickSolidByJoin(params)` 落地即解锁。

### 10.3 sweep 残量（9 条，§0 已解锁的部分之外）

| blockedBy | 条数 | 说明 |
|---|---|---|
| `op:sweep.pipeshell` | 4 | pipeShell 变体（isFrenet/mode 组合）仍缺 |
| `op:sweep.multisection` | 3 | 多截面已解锁主流（镜像 24/24 绿），此 3 条是剩余变体（带孔/特殊截面） |
| `op:sweep.aux-spine` | 3 | §2 |
| `op:sweep-hole-section` | 1 | 带孔截面 sweep（需公开的带孔面构造） |
| `op:sweep-sketch-sections` | 1 | testSketch r6：spline 帧放置 + sketch 截面 sweep |

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
