# occt-wasm 内核缺口修改方案（P2 收口，2026-09-29）

日期：2026-09-29
状态：**方案**（未实施）
范围：cq-compat P2 攻坚后仍攻不动的内核缺口，逐项给出 occt-wasm 侧的修改路径
上游基准：cadquery-ocp 7.9.3.1.1（OCCT 7.9.3）
探针纪律：本文每个「实测结论」均来自 `packages/cq-compat/src` 内的临时探针（当日 vitest 跑通），结论已留档为测试或写进 plan §8。

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

1. §4 reshapeRemove/Replace（1 人日，解锁 9 条，API 简单）；
2. §6.1 球角（0.5 人日，3 条）；
3. §3 makeThickSolidByJoin（1–2 人日，解锁 4+4 条）；
4. §6.2 高椭圆 / §6.3 双距离倒角（1 人日，5 条）；
5. §2 aux-spine 绑定验证（0.5 人日试探，3 条）；
6. §5 GeomPlate（2–3 人日，5 条，最后做）。
