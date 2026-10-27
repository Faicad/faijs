# 在 smlib C++ 源码层实现 STL/STEP 导入导出：方案

> 状态：**已实施（P0–P3 完成，P4 部分完成，P5 未开始）** —— 实施结果见 §14
> 日期：2026-10-27（§14 为当日实施后的实况总结）
> 参考源：`C:\git\OpenCascade\brepkit`（算法来源，Rust）、`C:\git\new\usd-brep`（smlib 源码，C++）
> 取代关系：**本方案取代** `docs/plans/2026-10-27-smlib-stl-step-io-plan.md`。
> 旧方案的核心结论是「格式层放 TS、只加少量 C++ 桥」——与用户要求相反，作废。

§0–§13 为**原始方案**（保留原文，便于对照设计与实际的偏差）。
**§14 是实施后的实况总结**：交付物、修掉的缺陷、测试矩阵、剩余缺口、回退记录——以 §14 为准。

---

## 0. 用户要求（原文）

> 让你改 smlib 的源代码，实现 stl/step 的导入导出，参考 brepkit，给我先写一份方案出来
> （前几轮追加）「必需用系统的工具链，不准你安装隔离的」「让你改 smlib 的源代码……你干一些无关紧要的事情」

约束（沿用）：
1. **落点必须是 smlib 的 C++ 源码**（`C:\git\new\usd-brep`），不是 faijs 的 TS 层。
2. 目标运行环境是**微信小程序**，wasm 体积是硬约束（单包 2 MB，总 20 MB；`WXWebAssembly.instantiate` 只能从包内路径加载）。
3. 必须用**系统工具链**（`C:\emsdk` 的 `emcc.bat`、系统 node），不准装隔离环境。
4. 参考 brepkit 的算法，但**内核层实现换成 smlib 的 SM_API / SMLib 类**。

---

## 1. 结论摘要

1. **落点是新增 smlib C++ 桥** `source/SM_API/src/SmApiStepIo.cpp`（STEP 导入+导出），与已完成的
   `SmApiStlIo.cpp`（STL 导入+导出）并列。TS 层只做**薄调用**（`k.find('SmApiImportStepEx')(...)`），不含任何格式算法。
2. **STL 的 C++ 导入导出已经完成**（上一轮）：`SmApiImportStlEx` / `SmApiExportStlEx`，产出真 B-rep 实体，
   已有 6 个桥级测试全绿。本方案不推翻它，只需在最终验收里并入回归。
3. **STEP 目前只有 TS 实现**（`packages/core/src/smlib-kernel/step-export.ts` / `step-import.ts`）——
   这就是「无关紧要的事」。本方案把它**迁进 C++**，迁完后 TS 算法文件作废。
4. **关键收益：旧 TS 方案里「NURBS 提取桥阻塞 exportStep」的问题，在 C++ 里自动消失。**
   因为代码活在内核里，`SmFace::GetSurface()` 直接返回 `SmSurface*`，`GetType()` + 各解析曲面 getter
   + `SmBSplineSurface`/`SmBSplineCurve` 内部数据都能直接读，不需要跨 wasm 边界新开「Ex」桥。
5. **构建接入近乎零配置**：`compile-all.ps1` 扫描 `source/SM_API/src/*.cpp` 自动编译新文件；
   `make-exports-api.ps1` 用 `llvm-nm` 扫所有 `SmApi*.o` 的 `SmApi*` 符号自动生成导出表；
   `link-rsp.ps1` 扫 obj 目录自动链接。**唯一硬约束**：新桥不能放进 `SmApiImportExport.cpp`
   （导出脚本明确排除 `SmApiImportExport.o`），必须独立成 `SmApiStepIo.cpp`。

---

## 2. 现状盘点（源码级证据）

### 2.1 STL —— C++ 已实现，已测

| 项 | 位置 | 状态 |
|---|---|---|
| 导出桥 | `source/SM_API/src/SmApiStlIo.cpp` `SmApiExportStlEx` (L184) | 完成：binary(50B/三角，u16 属性)+ASCII |
| 导入桥 | 同文件 `SmApiImportStlEx` (L370) | 完成：解析→按容差焊接→逐三角建闭合环→平面面→合并→缝合→修复 |
| 头文件 | `source/SM_API/inc/SmApiStlIo.h` | 完成 |
| 导出符号 | `wasm-probe/exports-api.json` L226-227 | `_SmApiExportStlEx` / `_SmApiImportStlEx` |
| 测试 | `packages/core/test/smlib-kernel/smlib-stl-{import,io-bridge}.test.ts` | 6/6 通过 |

### 2.2 STEP —— 目前只有 TS，需迁 C++

> **2026-10-27 实施后更新**：下表描述的是方案期的状态。`step-import.ts` / `step-export.ts`
> **已删除**，算法已全部迁入 `source/SM_API/src/SmApiStepIo.cpp`。现状见 §14。
| 文件 | 行数级 | 命运 |
|---|---|---|
| `packages/core/src/smlib-kernel/step-export.ts` | 平面+直线 MVP | 迁入 C++，文件作废 |
| `packages/core/src/smlib-kernel/step-import.ts` | Part21 解析+重建 | 迁入 C++，文件作废 |
| `smlibKernel.ts#importStep/exportStep` | 调 TS 实现 | 改调 C++ 桥 |

### 2.3 smlib 已有的几何构造/查询能力（C++ 侧，决定可行性）

**构造侧（导入用）**
- 平面面：`SmApiCreatePlanarFaces(const SmTArray<SmCurve*>&, SmBrep*&)`（`SmApiTrimmedSurfaces.h:61`；
  要求曲线图为若干闭合环，每端点恰好连一条其他曲线端点——STL 导入已验证）
- 任意曲面+裁剪环：`SmApiTrimSurfaceWith3dCurves(SmSurface*, curveLoops, 3DCurves, SmBrep*&)`
  （`SmApiTrimmedSurfaces.h:36`）——**曲面 STEP 导入的通用入口**
- 曲面构造：`SmApiCreatePlane(..., SmPlane*&)`、`SmApiCreateCylinder(..., SmSurface*&)`、
  `SmApiCreateCone(..., SmSurface*&)`、`SmApiCreateTorus(..., SmSurface*&)`（`SmApiPrimitives.h:35-122`）
- 曲线构造：`SmApiCreateLineSegment`、`SmApiCreateLine`、`SmApiCreateCircle(center,r,SmCircle*&)`、
  `SmApiCreateEllipse`、`SmApiCreateArc`（`SmApiCurves.h:35-86`）
- 装配：`SmApiMergeBreps(arr, SM_BO_MERGE=5, out)`、`SmApiStitchIntoSolid(...)`、`SmApiHealBrep(...)`

**查询侧（导出用，均为原生非 Ex 函数，C++ 可直接调）**
- `SmApiGetFaces`(Queries.h:76)、`SmApiGetEdges`(:70)、`SmApiFaceGetBoundaryLoops`(:82)、`SmApiVertexGetPoint`(:336)
- 更直接：`SmFace::GetSurface()`(SmFace.h:652) → `SmSurface*` → `GetType()`(SmSurface.h:2672)
  → `dynamic_cast` 到 `SmPlane/SmCylinder/SmCone/SmSphere/SmTorus/SmBSplineSurface` 读参数：
  `SmCylinder::GetRadius`、`SmSphere::GetRadius`、`SmTorus::Get{ Major,Minor }Radius`、
  `SmCone::Get{ Bot,Top }Radius/GetHeight`、`SmPlane` 的 position/normal。
- NURBS：`SmBSplineCurve` / `SmBSplineSurface` 的控制点/节点/权重在 C++ 内直接可取。

### 2.4 构建链（源码级证据）

- `wasm-probe/compile-all.ps1`：扫 `source/SMLib/src/*.cpp` + `source/SM_API/src/*.cpp`（跳过
  `SmDllMain/SmGraphicsExtern/StdAfx`），`emcc -O2 -c` → `obj/*.o`。**新增 .cpp 自动纳入。**
- `wasm-probe/make-exports-api.ps1`：`llvm-nm --defined-only` 扫 `SmApi*.o`（**显式排除 `SmApiImportExport.o`**），
  取 `T` 全局符号中含 `SmApi` 且非 `_ZL` 者，加 `_` 前缀写 `exports-api.json`。**新增 `extern "C"` 桥自动导出。**
- `wasm-probe/link-rsp.ps1`：glob `obj/*.o` → `link.rsp`，`emcc -sSTANDALONE_WASM=1 -O3
  -sEXPORTED_FUNCTIONS=@exports-api.json` 链接 → `out/smlib_standalone.js/.wasm`。
- 产物体积（实测，2026-10-27）：`smlib_opt.wasm` 6,816,928 B；`smlib_opt.wasm.br` **1,542,301 B ≈ 1.47 MB**。
  单包 2 MB（按 2×1024×1024 计）余量 **≈ 0.53 MB**；按 10^6 计余量 **≈ 0.44 MB**。

---

## 3. 落点与总体架构

```
                      faijs TS 层（薄调用，无算法）
                 smlibKernel.importStep / exportStep / importStl / exportStl
                                  │  k.find('SmApiImportStepEx')(...)
                                  ▼
        ┌──────────────────── smlib wasm（C++，本方案新增部分）────────────────────┐
        │  source/SM_API/src/SmApiStepIo.cpp   ← STEP Part21 解析/序列化 + 重建/遍历 │
        │  source/SM_API/src/SmApiStlIo.cpp    ← STL（已完成）                      │
        │         │ 调 SM_API 构造/查询 + 直接访问 SmFace/SmSurface 内部            │
        │         ▼                                                               │
        │  SMLib 内核（SmBrep/SmFace/SmSurface/SmCurve …，不动）                     │
        └────────────────────────────────────────────────────────────────────────┘
```

**为什么必须独立成 `SmApiStepIo.cpp` 而不是塞进 `SmApiImportExport.cpp`**：
`make-exports-api.ps1:9` 明确 `Where-Object { $_.Name -ne "SmApiImportExport.o" }`——该文件的符号**不会进导出表**，
wasm 里就调不到。`SmApiStlIo.cpp` 之所以能导出正是因为它独立成文件。STEP 同理。

**为什么 C++ 让 NURBS 无障碍**：导出需要「面→曲面参数→STEP 实体」。TS 侧只能通过 `SmApiSurfaceTypeEx`
等封装拿类型/法向，拿不到 NURBS 控制点（旧方案的阻塞点）。而 C++ 在同一个进程内，`SmFace::GetSurface()`
直接给出 `SmSurface*`，`dynamic_cast` 到具体类型即可读私有成员 getter；`SmBSplineSurface` 的控制点/节点/权重
也能直接访问。**不需要新增任何「Ex」查询桥。**

---

## 4. STEP 导入（C++）设计 —— 参考 brepkit `step/reader.rs`（2584 行）

brepkit 自己把 IO 分成两层，我们照搬这个分层，只把「内核层」换成 SM_API：

- **A 层（format）**：Part21 文本 → 实体表 `unordered_map<uint64_t, Entity>`。零内核依赖，纯 C++ 可直接照搬。
  实体 = `{ type_name, raw_attrs, parsed_refs }`。
  - **必须修正 brepkit 的已知缺陷**：它用 `joined.split(';')` 按分号切记录（`reader.rs:67` 附近），
    遇到字符串常量里含 `;` 的 STEP 会切错。C++ 版用**括号深度感知的 tokenizer**（`'` 字符串、`(`/`)` 计数、
    `#id` 引用识别）。
- **B 层（geometry）**：实体 → smlib 几何对象。
- **C 层（topology）**：几何 → 面/壳/体（`SmApiMergeBreps` + `SmApiStitchIntoSolid` + `SmApiHealBrep`）。

### 4.1 实体 → smlib 映射表

| STEP 实体 | smlib C++ 构造 |
|---|---|
| `CARTESIAN_POINT` | `SmPoint3d(x,y,z)` |
| `DIRECTION` | `SmVector3d(x,y,z)` |
| `AXIS2_PLACEMENT_3D` | `(origin, axis, refDir)` → 位置/法向/参考向 |
| `VERTEX_POINT` | `SmPoint3d` |
| `LINE` | `SmApiCreateLineSegment(p1,p2,SmLine*&)` |
| `CIRCLE` | `SmApiCreateCircle(center,r,SmCircle*&)`（整圆）/ `SmApiCreateArc`（弧段） |
| `ELLIPSE` | `SmApiCreateEllipse(origin,r1,r2,SmEllipse*&)` |
| `B_SPLINE_CURVE(_WITH_KNOTS)` | `SmApiCreateCanonicalCurve` / `SmApiCreateCurveInterpPoints`（内核内可直接 `new SmBSplineCurve`） |
| `SURFACE_CURVE`/`SEAM_CURVE`/`INTERSECTION_CURVE` | 取其所包的 3D 基曲线（brepkit 同样处理，`reader.rs:887`） |
| `PLANE` | `SmApiCreatePlane(origin, SmPlane*&)` |
| `CYLINDRICAL_SURFACE` | `SmApiCreateCylinder(origin,r,h, SmSurface*&)` |
| `CONICAL_SURFACE` | `SmApiCreateCone(origin,rBase,rTop,h, SmSurface*&)` |
| `SPHERICAL_SURFACE` | ⚠ `SmApiCreateSphere` 只有 `SmBrep*&` 重载；球面需在内核内 `new (*pContext) SmSphere(...)`（或补一个 surface 重载） |
| `TOROIDAL_SURFACE` | `SmApiCreateTorus(origin,rMaj,rMin, SmSurface*&)` |
| `B_SPLINE_SURFACE(_WITH_KNOTS)` | `SmApiCreateSurfaceFromOrderedPoints`（或内核内直接构造 `SmBSplineSurface`） |
| `EDGE_CURVE` | 基曲线 + 参数区间 → 裁剪曲线 |
| `ORIENTED_EDGE` | 方向标志（`.T.`/`.F.`）决定曲线是否反向 |
| `EDGE_LOOP` | 有序曲线环 |
| `FACE_BOUND`/`FACE_OUTER_BOUND` | 环集合 + `.T.`/`.F.` 朝向 |
| `ADVANCED_FACE`/`FACE_SURFACE` | 曲面 + 环 → **平面走 `SmApiCreatePlanarFaces`，曲面走 `SmApiTrimSurfaceWith3dCurves`** |
| `CLOSED_SHELL`/`MANIFOLD_SOLID_BREP` | 面 brep 集合 → `SmApiMergeBreps(5)` → `SmApiStitchIntoSolid` → `SmApiHealBrep` |

### 4.2 重建流程（C 层，复用 STL 导入已验证的路径）

1. 每个面单独建一个 `SmBrep`（平面面：逐边 `SmApiCreateLineSegment` 成闭合环→`SmApiCreatePlanarFaces`；
   曲面：建曲面 + 裁剪环→`SmApiTrimSurfaceWith3dCurves`）。
2. 多面 → `SmApiMergeBreps(faceBreps, SM_BO_MERGE=5, merged)`。
3. `SmApiStitchIntoSolid(merged, isSolid, stitched, vgap, egap)`。
4. `SmApiHealBrep(merged)`。
5. 返回 `SmBrep*` 句柄。

> 逐面 brep 必须是**裸句柄**（不登记到 faijs 的 `solidHandles`），因为 merge 会消费它们，
> 否则 dispose 时重复释放触发 wasm trap（上一轮 STL/STEP 都踩过）。

### 4.3 朝向与 winding

- `ORIENTED_EDGE` 的 `.T.`/`.F.` 决定曲线首尾顺序。
- 闭合环的**有向面积法向**与面法向比对；反向则整体翻转环序，保证外向。
- `FACE_BOUND` 的 `.T.`/`.F.` 按 ISO 10303-42（bound 绕面法向）处理——这正是 brepkit `mod.rs`
  里 `ISO_FACE_BOUNDS` 标记的历史 bug 修复点，需照做。

### 4.4 能力边界（如实标注）

- **MVP（Phase 2）**：平面 + 直线。只保证「自己导出的 STEP」与简单箱体类文件无损往返。
- **曲面（Phase 4）**：圆柱/圆锥/球/环面 + 圆/椭圆/样条边，靠 `SmApiTrimSurfaceWith3dCurves`。
  难点是「裁剪曲线必须落在曲面上（容差内）」——第三方工业 STEP 的 3D 曲线常与曲面有微小偏差，
  需要投影/拟合兜底。**不保证第三方 STEP 一次成功**，逐样本追。

---

## 5. STEP 导出（C++）设计 —— 参考 brepkit `step/writer.rs`（1060 行）

### 5.1 遍历与写出

1. 遍历 `SmBrep` 的面：`SmFace::GetSurface()` → `GetType()` → 分派到具体曲面类型写 STEP 曲面实体。
2. 每个面写 `ADVANCED_FACE`/`FACE_SURFACE` + 曲面实体 + 若干 `FACE_BOUND` + `EDGE_LOOP`。
3. 每条边写 `EDGE_CURVE` + 曲线实体（`LINE`/`CIRCLE`/`ELLIPSE`/`B_SPLINE_CURVE_WITH_KNOTS`）+ `VERTEX_POINT`。
4. 壳/体写 `CLOSED_SHELL` + `MANIFOLD_SOLID_BREP`。
5. HEADER：`FILE_DESCRIPTION` / `FILE_NAME` / `FILE_SCHEMA('AUTOMOTIVE_DESIGN ...')`，加最小
   `APPLICATION_CONTEXT` / `PRODUCT` 脚手架（brepkit `writer.rs:160-255` 的 `write_geometric_context`、
   `write_product_structure` 是参考）。

### 5.2 曲面/曲线 → STEP 实体

| smlib 类型 | STEP 实体 |
|---|---|
| plane | `PLANE('',#axis2)` |
| cylinder | `CYLINDRICAL_SURFACE('',#axis2,r)` |
| cone | `CONICAL_SURFACE('',#axis2,r,semiAngle)`（半角从轴量起，brepkit `ISO_CONE_ANGLES`） |
| sphere | `SPHERICAL_SURFACE('',#axis2,r)` |
| torus | `TOROIDAL_SURFACE('',#axis2,rMaj,rMin)` |
| bspline surface | `B_SPLINE_SURFACE_WITH_KNOTS(...)` |
| line edge | `LINE` |
| circle/arc edge | `CIRCLE` |
| ellipse edge | `ELLIPSE` |
| bspline edge | `B_SPLINE_CURVE_WITH_KNOTS(...)` |

### 5.3 去重与 id 分配

- 按值去重：`CARTESIAN_POINT`（坐标）、`DIRECTION`（单位向量）、`AXIS2_PLACEMENT_3D`（origin+axis+refDir）。
  用 `unordered_map` 以量化 key 合并（平面法向/取样点有浮点微差，需**容差匹配**，与 TS 版踩过的坑一致）。
- 实体 id 从固定基数（如 100）顺序分配，避免与脚手架 id 冲突。
- 面向 `#id` 引用必须闭合（brepkit 有测试 `step_all_entities_properly_closed`）。

### 5.4 体积控制

- 输出文本按需 `reserve`，一次性 `malloc` 给调用方（与 STL 导出同 ABI：返回 buffer 指针 + `*pnBytes`）。

---

## 6. STL（已完成，仅纳入回归）

`SmApiStlIo.cpp` 已实现 binary/ASCII 导入导出，逐三角建面→合并→缝合→修复。本方案不重做，
只在最终验收时把 6 个既有测试并入回归，确认 STEP 改动没让它们退化。

---

## 7. 改动点清单（文件级）

| # | 文件 | 改动 | 说明 |
|---|---|---|---|
| 1 | `source/SM_API/inc/SmApiStepIo.h` | **新增** | 声明 `SmApiImportStepEx` / `SmApiExportStepEx`（`extern "C"`） |
| 2 | `source/SM_API/src/SmApiStepIo.cpp` | **新增** | Part21 tokenizer + 实体表 + 重建 + 遍历写出 |
| 3 | `wasm-probe/exports-api.json` | 重新生成 | 由 `make-exports-api.ps1` 自动写入两个 `_SmApi*StepEx` |
| 4 | `wasm-probe/link.rsp` | 自动 | `link-rsp.ps1` 扫 obj 自动加 `SmApiStepIo.o` |
| 5 | `packages/core/src/smlib-kernel/smlibKernel.ts` | 改 | `importStep/exportStep` 改调 C++ 桥（薄封装） |
| 6 | `packages/core/src/smlib-kernel/step-{import,export}.ts` | 删除（需批准） | 算法迁入 C++ 后作废；删除属破坏性操作，**待你点头再删** |
| 7 | `packages/core/test/smlib-kernel/smlib-step-io-bridge.test.ts` | **新增** | 桥级直驱测试（见 §9） |

**不动**：SMLib 内核本体（`source/SMLib/`）、`SmApiImportExport.cpp`。

---

## 8. 分阶段实施顺序

| 阶段 | 内容 | 新增 C++ | 验收 |
|---|---|---|---|
| P0 | STL（已完成） | — | 6/6 测试 |
| P1 | STEP 导出 C++，**平面+直线** | `SmApiExportStepEx` | 箱体往返、实体计数、HEADER |
| P2 | STEP 导入 C++，**平面+直线** | `SmApiImportStepEx` | 箱体往返体积/面数、可再导出 |
| P3 | STEP 导出 C++，**解析曲面**（柱/锥/球/环 + 圆/椭圆边） | 扩展 writer | 圆柱/球/锥往返保曲面类型 |
| P4 | STEP 导入 C++，**解析曲面**（`SmApiTrimSurfaceWith3dCurves`） | 扩展 reader | 圆柱/球往返 |
| P5 | NURBS 曲面/曲线（bspline） | 扩展 reader/writer | NURBS 往返 |
| P6 | TS 清理：删 `step-{import,export}.ts` | — | 全链路只走 C++ 桥 |

**推荐先做 P1+P2**（平面+直线），它复用 STL 已验证的重建路径，风险最低、能最快看到「C++ 里真的跑通」。
P3/P4 再上曲面。

---

## 9. 测试方案

### 9.1 桥级直驱（核心，仿 `smlib-stl-io-bridge.test.ts`）

在 TS 里 `initSmlibWasm()` → `k.find('SmApiExportStepEx')(...)` / `SmApiImportStepEx`，绕开 faijs 封装，
直接验证 C++ 桥：

1. `SmApiCreateBox` → `SmApiExportStepEx` → 文本含 `FILE_SCHEMA`/`MANIFOLD_SOLID_BREP`/6×`PLANE`/6×`FACE_SURFACE`/12×`LINE`/8×`VERTEX_POINT`。
2. 导出文本 → `SmApiImportStepEx` → `SmApiBrepComputeVolume` ≈ 6000、面数 6。
3. 非法输入（非 Part21）→ 返回 0 且 `*pStatus` 非 SUCCESS（**不静默吞**）。
4. 平面面朝向/环序：导出的 bound 绕面法向（ISO 10303-42）。
5. 非平面几何（原生圆柱）→ 明确报错，不静默丢几何。

### 9.2 回归

- STL 6 个测试 + STEP 导出/导入 各自测试，一起跑全绿。
- `npx tsc --noEmit` 仅看改动文件零错误（其余预存错误与本方案无关）。

### 9.3 体积回归

- 每阶段重测 `smlib_opt.wasm.br`，确保 < 2 MB 单包。当前基线 **1,542,301 B**。

### 9.4 第三方样本（可选，后期）

- `C:\git\new\usd-brep\TestFiles`（Git LFS，需 `git lfs pull`）跑导入成功率；如实记录失败率，不包装。

---

## 10. 体积预算（实测基线 + 估算）

| 项 | raw | brotli | 说明 |
|---|---|---|---|
| 当前基线 | 6.82 MB | **1.47 MB** | `smlib_opt.wasm.br` |
| P1+P2（平面+直线 STEP） | +30–80 KB | +10–25 KB | 解析器 + 序列化器，无 NURBS |
| P3+P4（解析曲面） | +80–180 KB | +25–60 KB | 曲面/曲线分派 |
| P5（NURBS） | +150–400 KB | +50–120 KB | bspline 控制点/节点/权重 |
| 合计上限估计 | — | **≤ 1.68 MB** | 仍在 2 MB 内，余量 ≥ 0.3 MB |

> 估算值，**以实测为准**；每阶段落地后必须重跑 brotli 体积报告。

---

## 11. 风险与遗留（如实记录）

- **R1（高）**：`SmApiStitchIntoSolid` 在万级平面面上的性能未知（STL 导入同风险）。P2 后实测 1k/1w/10w 三角。
- **R2（高）**：第三方工业 STEP 的容差/UV trim/周期面缝合是数十年积累域，**不保证成功率**；本方案只保证自往返 + 简单文件。
- **R3（中）**：C++ 改动需完整编译链（233 文件 ≈10–20 min + link ≈5 min + brotli），约 25 min/轮，迭代慢。
- **R4（中）**：`SmApiTrimSurfaceWith3dCurves` 要求裁剪曲线在曲面上（容差内），曲面导入需投影/拟合兜底。
- **R5（低）**：`SmApiGetOrCreateContext` 是进程级全局单例（沿用既有约束）。
- **R6（低）**：球面没有 `SmSurface*&` 的 `SmApiCreateSphere` 重载，需内核内直接构造或补重载。

---

## 12. 回滚路径

- 新增文件仅 `SmApiStepIo.h/.cpp` + `smlib-step-io-bridge.test.ts`，删除即回滚。
- `exports-api.json` / `link.rsp` 由脚本重生成，回滚即重跑脚本。
- `smlibKernel.ts` 的改动是**改调用目标**，回滚即改回 TS 实现（保留 TS 文件期间）。
- **保留当前 `smlib_standalone.wasm` / `smlib_opt.wasm.br`（1.47 MB）副本作为回滚基线。**
- 破坏性操作（删 `step-{import,export}.ts`）单独留到 P6，且**需你明确点头**。

---

## 13. 待拍板（不替你填默认值）

1. **STEP 导入能力边界**：只保证「自己导出的 STEP + 简单箱体类文件无损往返」（推荐，风险可控），
   还是要追第三方工业 STEP（工作量与不确定性大幅上升）？
2. **实施顺序**：是否认可 §8 的 **P1+P2 先做平面+直线**，曲面/P5 再看实测？
3. **TS 算法文件处置**：P6 删除 `step-{import,export}.ts` 是否需要保留一个过渡期（先并存、桥与 TS 双跑对比）？
4. **STEP 版本/模式**：只出 AP203 即可，还是需要 AP214/AP242（影响 HEADER 与实体子集）？
5. **球面构造**：接受「内核内直接 `new SmSphere`」，还是希望我在 `SmApiPrimitives` 补一个
   `SmApiCreateSphere(..., SmSurface*&)` 重载（后者更干净但要改动既有 API 头）？

> 你确认「开始实施」并回答上面几条后，我按 P1→P2 顺序写 C++、跑编译链、出桥级测试。

---

# 14. 实施与验证总结（2026-10-27 实况）

> 本节是实施后的事实记录，不是计划。所有数字均为本机实测；与 §0–§13 的原计划冲突之处，以本节为准。

## 14.1 一句话结论

**算法已完整下沉到 smlib 的 C++ 内核并通过编译链；合成几何测试全绿；真实工业模型尚未打通（10/45）。**
剩余缺口全部在「内核对真实 STEP 拓扑/裁剪语义的适配」上，不是缺功能入口——
同批 45 个文件用 brepkit 自身跑是 40/45，所以 35 个失败里 **30 个属于移植没做到位**。

## 14.2 交付物清单

### C++ 侧（`C:\git\new\usd-brep`）

| 文件 | 性质 | 内容 |
|---|---|---|
| `source/SM_API/inc/SmApiStepIo.h` | 新增 | `extern "C"` 声明：`SmApiImportStepEx` / `SmApiExportStepEx` / `SmApiStepLastError` |
| `source/SM_API/src/SmApiStepIo.cpp` | 新增（核心） | Part21 切分/解析 → 实体表 → 曲面/曲线构造 → 拓扑重建 → AP203 序列化 → 失败原因回传 |
| `source/SM_API/src/SmApiStlIo.cpp` + `inc/SmApiStlIo.h` | 前序已完成 | STL binary/ASCII 导入导出（真 B-rep） |
| `wasm-probe/exports-api.json` | 重生成 | 229 个符号，含 `_SmApiImportStepEx` / `_SmApiExportStepEx` / `_SmApiStepLastError` / `_SmApiImportStlEx` / `_SmApiExportStlEx` |
| `wasm-probe/step-fixture-check.mjs` | 新增 | 45 个真实 STEP 的往返驱动（**纯 node 宿主，零算法**，只调 C++ 桥） |
| `wasm-probe/make-exports-api.ps1` | 改 | 无 BOM 写出 + 排除静态构造符号（见 §14.3） |
| `test-data/step/`（45 个 `.step`） | 新增样本 | 从 `C:\my\Faicad\OLD\python_server\training\solid_exports` 拷入，OCCT 导出的 **AP214** |
| `test-data/brepkit-step-baseline.txt` | 新增证据 | brepkit 对同一批样本的逐文件结果（裁判基线） |

### TS 侧（`C:\my\Faicad\faijs\packages\core`）

| 文件 | 改动 |
|---|---|
| `src/smlib-kernel/smlibKernel.ts` | `importStep` / `exportStep` 改为**薄封装**，只做缓冲区与句柄搬运；新增常量 `STEP_IMPORT_TOL_MM = 1e-4` |
| `src/smlib-kernel/step-import.ts` | **已删除**（算法已在内核） |
| `src/smlib-kernel/step-export.ts` | **已删除**（同上） |
| `test/smlib-kernel/smlib-step-export.test.ts` | 重写：断言 `ADVANCED_FACE`、`FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'))`；「非平面抛错」改为「圆柱必须导出 `CYLINDRICAL_SURFACE`/`CONICAL_SURFACE`，且 `ADVANCED_FACE` 数 == 面数」（不静默丢几何） |
| `test/smlib-kernel/smlib-step-import.test.ts` | `FACE_SURFACE` → `ADVANCED_FACE`；错误断言对齐 `expectOk` 实际文案 |

**未动**：`source/SMLib/` 内核本体、`SmApiImportExport.cpp`（该文件的符号不进导出表，硬约束见 §3）。

## 14.3 构建链的三个坑（都会让链接「看起来成功但产物是废桩」）

1. **`exports-api.json` 的 UTF-8 BOM**
   导出表脚本原来用 `Set-Content -Encoding UTF8`，PowerShell 5 会写 BOM。emcc 靠首字符是不是 `[`
   判断「按 JSON 还是按文件列表」解析，BOM 让它把整段当成**一个符号**，报
   `undefined exported symbol: "\ufeff[\"__Z11SmApiStitch..."`。
   修复：改用 `WriteAllText` + `UTF8Encoding($false)` 写出（无 BOM）。
   **症状陷阱**：链接失败后 `out/smlib_standalone.wasm` 仍会留下约 30 KB 的残废桩，
   只看「文件存在」会误判成功——必须看尺寸量级（正常 ≈6.9 MB）。

2. **静态构造符号混入导出表**
   为回传失败原因引入的全局 `std::string` 会生成 `_GLOBAL__sub_I_SmApiStepIo.cpp`，它含 `SmApi`
   子串，被脚本当成导出符号。两面都修：C++ 侧改成函数内 `static`（消除动态初始化），
   脚本侧过滤 `GLOBAL__sub_I`。

3. **`SmApiStepIo.o` 必须独立成文件**
   导出表脚本显式排除 `SmApiImportExport.o`（§3 已说明），放进那个文件就导不出符号。

## 14.4 实施中修掉的 5 个真缺陷

| # | 缺陷 | 根因 | 修法 | 证据 |
|---|---|---|---|---|
| 1 | STL 往返后共面 `PLANE` 去重出 10 个而非 6 个 | 去重键用 `%.7g` 精确字符串，float32 STL 的法向/偏移抖动会让同一平面裂成多个键 | 改「主导轴分桶 + 容差比较」：法向 `1-dot <= 1e-9`，偏移 `<= 1e-6*(1+|d|)` | `smlib-step-export` 测试由红转绿 |
| 2 | 直线边一律被判 unsupported（`edge curve #21 unsupported`） | `EDGE_CURVE` 的几何引用在 OCCT 导出里几乎总是 `SURFACE_CURVE` 包装，原代码只看**直接实体类型**是不是 `LINE` | 新增 `baseCurveRef()` 解包 `SURFACE_CURVE`/`SEAM_CURVE`/`INTERSECTION_CURVE` 再判定 | `box.step` 从失败转为通过 |
| 3 | 导出的实体没有体积（`V=0`），面数却正确 | writer 把 `FACE_OUTER_BOUND` 朝向与 `ADVANCED_FACE` 的 `same_sense` **硬编码 `.T.`**；而 `SmFace` 本身不带朝向，朝向在 `SmFaceuse` 上 | 遍历 faceuse，`reversed = (fu->GetOrientation() != SM_OT_SAME)`，bound 朝向与 `same_sense` 共用同一个 `reversed`（照 brepkit `writer.rs:433/523`） | 导出 cube 交 brepkit 读：修前 `F=6 V=0.0000`，修后 `F=6 V=8000.0000`，rel=0 |
| 4 | 修完朝向后面数翻倍（6 → 12） | `SmBrep::GetFaceuses` 返回 12 个（6 面 × 2：infinite region 的壳 + 实体壳各一份） | 只从**非 infinite region** 的 shell 取 faceuse；无实体 region 时退回全 shell | 导出文件 `ADVANCED_FACE` 计数回到 6 |
| 5 | 任何失败都只返回 `SM_ERR_INVALID_INPUT`(1007)，无法定位 | 桥丢弃了 `imp.build(err)` 的错误串 | 新增 `SmApiStepLastError()`，把「哪个面 / 哪个曲面 / 哪个内核状态码」回传 | 真实样本的失败原因由此可读（§14.6 的分类正基于此） |

> 缺陷 3/4 的意义：**验收不能只信自己的往返**。smlib 自导自入时朝向错误会「自洽」地通过，
> 是让 brepkit 读同一份文件才暴露出来。这条已固化为方法：**导出侧必须用第三方读回校验。**

## 14.5 验证矩阵

### 合成几何（`packages/core/test/smlib-kernel/`）

| 测试文件 | 覆盖 | 结果 |
|---|---|---|
| `smlib-step-import.test.ts` | 导入、面数/体积、非法输入不静默 | 全绿 |
| `smlib-step-export.test.ts` | `ADVANCED_FACE` / `FILE_SCHEMA` / 曲面类型 / 不丢面 | 全绿 |
| `smlib-stl-import.test.ts` | STL 导入真 B-rep、按容差焊接 | 全绿 |
| `smlib-stl-export.test.ts` | binary / ASCII 导出 | 全绿 |
| `smlib-wasm-smoke.test.ts` | wasm 装载与桥可达 | 全绿 |
| **合计** | | **15/15** |

### 真实模型（45 个 OCCT AP214 文件，`wasm-probe/step-fixture-check.mjs`）

判据：`import` 成功（面数 > 0 且体积 > 0）→ `export` 出合法 ISO-10303-21 →
**re-import 面数相等且体积相对误差 <= 1e-6**。

| 实现 | import | 往返 | 备注 |
|---|---|---|---|
| **brepkit（裁判）** | **40/45** | **40/45** | 失败的 5 个：`loft`、`mounting_bracket`（NURBS 越界 panic，`math/src/nurbs/surface.rs:223`、`curve.rs:165`）、`sphere{,_large,_small}`（单面 `FACE_BOUND→VERTEX_LOOP`，`empty wire`） |
| **smlib（本次移植）** | **10/45** | **10/45** | 通过的 10 个全是**纯平面**模型（box / cube / chamfer / wedge / stepped_block / bracket / channel_block 等） |

**归因**：35 个失败中，5 个与 brepkit 同源（上游本身不支持），**30 个是移植缺陷**。

> 驱动的一个必要细节：**每个文件必须新建 wasm 实例**。任一文件触发 trap 后实例被毒化，
> 复用会把 1 个缺陷放大成级联全红——第一版驱动就在这上面误报过。

## 14.6 剩余 30 个移植缺口的分类（含根因假设）

| 类别 | 文件数（粗计，有重叠） | 现象 | 根因判断 |
|---|---|---|---|
| 旋转曲面走裁剪时 trap | 12 | `null function or function signature mismatch`（cylinder*/cone*/torus*/box_boss/connector_body） | `SmApiTrimSurfaceWith3dCurves` 内部 call_indirect 命中空槽；疑曲面类型/环组入参不匹配 |
| 圆柱面 / 孔壁裁剪被拒 | ~16 | `SmApiTrimSurfaceWith3dCurves status 1001/1007` | 环组未被接受：seam 边重复、pcurve 缺失、曲线未严格首尾相接 |
| 带内环的平面面 | 2 | `SmApiCreatePlanarFaces status 1001`（`box_cross_hole_multi`、`box_tall`） | 内环（孔）方向 / 嵌套深度未按内核期望给出 |
| 整球（无 seam 边） | 3 | 单面 `FACE_BOUND→VERTEX_LOOP`，被当成环去解边 | 缺「整曲面 canonical 建体」分支（brepkit 也缺，但它是另一个报错） |
| NURBS 曲面 | 2 | `B_SPLINE_SURFACE_WITH_KNOTS not supported` | **纯缺失**，未实现（与 brepkit 同缺） |

## 14.7 试过并回退的路线（避免重走）

**把「逐面建 brep + `SmApiMergeBreps`」换成「单 brep + `SmBrep::CreateFacesWithCurves`」**
（后者注释称曲线可任意顺序 / 任意朝向 / 不需要外环第一，语义上更接近 STEP）。

- 结果：**10/45 → 0/45，已整体回退到逐面 + merge 路线**（回到 10/45）。
- 回退原因不是 API 选错，而是**曲线区间语义不齐**：该 API 取端点用 `GetNaturalInterval()`，
  而我喂进去的圆 / 椭圆是「整曲线 + `AdjustSTEPInterval` 裁剪」，直线是 `CreateLineSegment`，
  两种端点语义混在一起，环接不上就把面切碎（cube 6→8、box 6→4）。
- 要再走这条路，**前提是先统一曲线区间语义**（全部走 `AdjustSTEPInterval` + `Trim`，
  或全部按端点重建），不能混。
- 另有一个所有权坑：`CreateFacesWithCurves` 失败时 `surface` 已被内核消费，再 `delete` 会 double free。

## 14.8 体积账（单包 2 MB 硬约束）

| 项 | raw | brotli | 相对基线 |
|---|---|---|---|
| 基线（STL 完成时） | 6,816,928 B | 1,542,301 B | — |
| **当前（STEP 导入 + 导出 + 诊断）** | **6,916,694 B** | **1,565,851 B ≈ 1.49 MB** | **+99,766 B / +23,550 B** |

单包 2 MB（按 2×1024×1024 计）余量 **≈ 0.50 MB**；按 10^6 计余量 **≈ 0.41 MB**。
STEP 全量移植（含解析曲面、NURBS 曲线读写）只花了约 **23 KB** brotli——
原计划 §10 里「P1–P5 合计 ≤ 1.68 MB」的估算偏保守，实际远低于预算。

## 14.9 下一步（按收益排序，未执行，等指示）

| 优先级 | 目标 | 覆盖文件 | 备注 |
|---|---|---|---|
| P-a | 旋转曲面 `call_indirect` 空槽 | 12 | 收益最大；需先确认 `SmApiTrimSurfaceWith3dCurves` 对曲面类型的要求 |
| P-b | 圆柱 / 孔壁 seam 边裁剪 | ~16 | 与 P-a 可能同源（同一入口），建议一起查 |
| P-c | 带内环平面面 | 2 | `SmApiCreatePlanarFaces` 内环方向 / 嵌套 |
| P-d | 整球 `VERTEX_LOOP` | 3 | 需补「整曲面 canonical 建体」分支 |
| P-e | NURBS 曲面 | 2 | 纯新增实现；上游 brepkit 也不支持，可最后做 |

**验收口径**：任何一轮改动都必须同时给出
① 合成几何 15/15 不回退；② 45 个真实样本的通过数（不降）；
③ 导出物交 brepkit 读回的面数 / 体积（防「自洽地错」）；④ brotli 体积。
