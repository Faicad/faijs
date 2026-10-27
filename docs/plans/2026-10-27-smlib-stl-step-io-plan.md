# 把 brepkit 的 STL/STEP 导入导出能力移植到 smlib：方案

> 状态：方案（未实施）
> 日期：2026-10-27
> 参考源：`C:\git\OpenCascade\brepkit`（移植来源）、`C:\git\new\usd-brep`（smlib 源码）
> 前置方案：`docs/plans/2026-10-26-smlib-brep-engine-plan.md`（P5 STEP/STL IO 缺口）

本方案是**方案文档**，不含任何实施代码改动；在用户明确说"开始实施"前，一切修改只发生在本方案内。

## 0. 用户要求（原文）

> 请参考C:\git\OpenCascade\brepkit项目，我需要把它的stl/step导入和导出能力移植到smlib

补上前一轮的约束：目标是**微信小程序**内支持 STL/STEP 的「导入 + 编辑 + 导出」，**必须考虑 size**。

## 1. 结论摘要

四个判断，逐条可否：

1. **STL 导出不需要移植——faijs 已经有了。** `packages/core/src/api/export-stl.ts` 的 `exportStl`
   是引擎中立的纯数据序列化器（只读 Shape 自带的 `positions`/`indices`，不触达任何引擎）。
   brepkit 的 `stl/writer.rs` 与它**同构**（都是 `tessellate → TriangleMesh → binary/ascii`）。
   smlib 只要让 `solidToShape` 能用 `SmApiTessellateEx` 填好三角载荷，`cad.exportStl` 直接可用。
2. **"移植到 smlib" 的落点不是改 SMLib C++ 内核，而是新增一层。** usd-brep 全仓零 STEP/STL
   读写代码（见 §2），SMLib 只有私有的 `.smb` 文件 IO 且走文件路径。真正的可复用资产是
   brepkit 的**格式编解码逻辑**，它与内核无关，应落到 faijs 的 TS 层 + smlib-kernel 适配器。
3. **真正需要移植的是三项**：`importStl`（网格→B-rep）、`importStep`、`exportStep`。
   其中 `exportStep` 被一个具体缺口阻塞（NURBS 数据提取桥，见 §4.3）。
4. **体积上，TS 层实现远优于 C++ 层。** 当前 smlib wasm brotli 后 1.53 MB，已占小程序单包
   2 MB 上限的 **76%**。任何新增 C++ 都在跟剩余 0.47 MB 抢预算；TS 是文本、可分包、可压缩。

## 2. 移植源：brepkit 到底有什么（源码级）

`crates/io/` 共 9184 行，与本次相关的：

| 文件 | 行数 | 内核耦合 |
|---|---|---|
| `crates/io/src/stl/reader.rs` | 391 | **无**（文件 → `TriangleMesh` 纯数据） |
| `crates/io/src/stl/writer.rs` | 260 | 仅 `tessellate_solid` |
| `crates/io/src/stl/import.rs` | 441 | **有**（`TriangleMesh` → brepkit `Topology`） |
| `crates/io/src/step/reader.rs` | 2584 | **解析层无 / `StepBuilder` 有** |
| `crates/io/src/step/writer.rs` | 1060 | **有**（遍历 `Topology` + 读几何） |

**关键结构（决定移植形态）**——`step/reader.rs:31`：

```rust
pub fn read_step(input: &str, topo: &mut Topology) -> Result<Vec<SolidId>, IoError> {
    let entities = parse_step_entities(input)?;   // ← A 层：Part21 文本 → HashMap<u64, StepEntity>，零内核依赖
    let mut builder = StepBuilder::new(topo, &entities, legacy_bounds);
    builder.build_all_solids()                    // ← B/C 层：实体 → brepkit Topology，强内核耦合
}
```

即 brepkit 自己就把 IO 分成了「格式层」与「内核层」。**我们要移植的是 A 层 + B/C 层的算法思路，
B/C 层的实现要换成 SM_API 调用。**

### 2.1 brepkit 的类型面（映射的两端）

`crates/topology/src/face.rs:27` 与 `edge.rs:16`：

- `FaceSurface` = `Plane{normal,d}` | `Nurbs(NurbsSurface)` | `Cylinder` | `Cone` | `Sphere` | `Torus`
- `EdgeCurve` = `Line` | `NurbsCurve(NurbsCurve)` | `Circle(Circle3D)` | `Ellipse(Ellipse3D)`

### 2.2 STEP reader 支持的实体（实测清单）

`ADVANCED_FACE`、`FACE_OUTER_BOUND`、`FACE_BOUND`、`EDGE_LOOP`、`ORIENTED_EDGE`、`EDGE_CURVE`、
`VERTEX_POINT`、`MANIFOLD_SOLID_BREP`、`BREP_WITH_VOIDS`、`CLOSED_SHELL`、`ORIENTED_CLOSED_SHELL`、
`PLANE`、`CYLINDRICAL_SURFACE`、`CONICAL_SURFACE`、`SPHERICAL_SURFACE`、`TOROIDAL_SURFACE`、
`B_SPLINE_SURFACE(_WITH_KNOTS)`、`BOUNDED_SURFACE`、`SURFACE_OF_LINEAR_EXTRUSION`、
`LINE`、`CIRCLE`、`ELLIPSE`、`B_SPLINE_CURVE(_WITH_KNOTS)`、
`SEAM_CURVE`、`INTERSECTION_CURVE`、`SURFACE_CURVE`

**不支持**：装配（PRODUCT 层级）、PMI、颜色、层。

### 2.3 STL 导入的做法（`stl/import.rs`）

`import_mesh(topo, mesh, tolerance)`：顶点按 tolerance 合并建 `Vertex` → 每个三角形建一个
**平面面**（`FaceSurface::Plane`）→ 组装 `Shell` → `Solid`。Winding 用带符号体积（散度定理）
整体判定，有逐点法向时逐三角校正；退化三角形（两顶点重合）跳过。

**这就是"网格→B-rep"的标准做法，也是 smlib 侧可直接照搬的算法。**

## 3. 移植目标：SM_API 侧有什么

从 `wasm-probe/exports-api.json`（224 个导出）提取的相关能力：

**构造侧（导入用）**
- `SmApiCreateCanonicalCurveEx(points, knots, knotMultiplicities, weights, degree, form)`
  —— `form` 支持 `SM_CF_POLYLINE_FORM` / `PARABOLIC_ARC` / `CIRCULAR_ARC` / `HYPERBOLIC_ARC` /
  `ELLIPTIC_ARC` / `UNSPECIFIED` / `HELICAL_ARC`。**正好覆盖 brepkit 的 Line / Circle / Ellipse。**
- `SmApiCreateCurveInterpPointsEx` / `SmApiCreateCurveApproxPointsEx` —— NURBS 曲线
- `SmApiCreateSurfaceFromOrderedPointsEx(points, rows, cols)` —— NURBS 曲面
- `SmApiCreatePlanarFacesEx`（曲线数组 → 平面面）、`SmApiStitchIntoSolidEx` / `SmApiStitchEx`
- `SmApiCreateLinearSweepEx` / `SmApiCreateRotationalSweepEx` / `SmApiCreateSkinPrimitiveEx`
- `SmApiHealBrepEx`、`SmApiUnifyNormalsEx`

**查询侧（导出用）**
- `SmApiGetFacesEx` / `SmApiGetEdgesEx` / `SmApiEdgeVerticesEx` / `SmApiFaceBoundaryLoopsEx`
- `SmApiSurfaceTypeEx` / `SmApiCurveTypeEx` / `SmApiCurveParametersEx`
- `SmApiSurfaceNormalEx` / `SmApiPointOnSurfaceEx` / `SmApiFaceUvBoundsEx`
- `SmApiCurvePointAtParamEx` / `SmApiCurveTangentEx` / `SmApiCurveLengthEx` / `SmApiCurveIsClosedEx`

**结论：SM_API 的构造面与查询面都已覆盖 STEP 导入/导出所需，缺的是"胶水层"，不是内核能力。**

## 4. 四项能力的移植判定

| 能力 | 判定 | 依据 |
|---|---|---|
| **STL 导出** | **无需移植** | faijs 已有中立 `exportStl`（§1.1） |
| **STL 导入** | **需移植算法，落 TS + 少量桥** | 算法见 §2.3；构造用 `SmApiCreatePlanarFacesEx` + `SmApiStitchIntoSolidEx` |
| **STEP 导出** | **需移植，但被阻塞** | 格式层可写；读侧缺 NURBS 提取桥（§4.3） |
| **STEP 导入** | **需移植，工作量最大** | 解析层可直接改写；构建层需 SM_API 重写（§4.4） |

### 4.1 STL 导出（零成本，仅需接通）

`smlib-kernel` 侧只需保证 `solidToShape` 用 `SmApiTessellateEx` 填好 `positions`/`indices`，
`cad.exportStl` 即自动工作。**这是本方案性价比最高的一项。**

### 4.2 STL 导入

- A 层：TS 写 STL 解析（binary 头 84 字节 + 每三角 50 字节；ASCII 逐 `facet normal`/`vertex`）。
  参考 `stl/reader.rs`，约 300–400 行 TS。
- C 层：照搬 `stl/import.rs` 的「顶点合并 → 逐三角建平面面 → 缝合」。
  批量建面需新增桥（一次传 N 个三角形，避免 N 次跨界调用开销）。

**风险提示（必须写在方案里）**：一个 10 万三角的 STL 会生成 10 万个平面面。brepkit 能扛是因为它的
`Topology` arena 很轻；smilb 侧 `SmApiStitchIntoSolid` 在万级面上的表现**未实测**，这是本项最大的未知数。
建议实施第一步就做这个性能探针（见 §7）。

### 4.3 STEP 导出——被 NURBS 提取桥阻塞

`step/writer.rs` 需要按 `FaceSurface` 枚举分派写出 STEP 曲面实体。smlib 侧查询有
`SmApiSurfaceTypeEx`（拿类型）、`SmApiSurfaceNormalEx`（拿法向）、`SmApiFaceUvBoundsEx`（拿 UV 界），
但**拿不到 NURBS 曲面的控制点/节点/权重**——`SmApiCreateCanonicalCurve` 是写侧，读侧无对应 API。

这与 P2 记录的 `getNurbsCurveData` 是同一个缺口。

**解法：在 `SmApiBridgeEx.cpp` 新增内核级桥**（读 `SmBSplineCurve` / NURBS 曲面内部数据）。
这是本方案唯一**必须动 smlib C++ 源码**的地方，也是唯一必须重跑完整编译链路（233 文件 ≈10–20 min + link ≈5 min）的地方。

**建议**：先做这个桥的**可行性探针**（单独编译一个小 wasm 验证能读出控制点），确认了再进完整链路。

### 4.4 STEP 导入

- A 层：`parse_step_entities` 可直接改写为 TS（Part 21 词法：实体行 `#id = TYPE(...)`、字符串/关键字/枚举、嵌套括号）。
  注意 brepkit 的实现有个**简化假设**（`reader.rs:67`：`joined.split(';')` 按分号切分），
  遇到字符串常量里带分号的 STEP 文件会出错。移植时应当修正为正确的 tokenizer。
- B 层：STEP 几何实体 → SM_API：`LINE`→`POLYLINE_FORM`、`CIRCLE`→`CIRCULAR_ARC`、
  `ELLIPSE`→`ELLIPTIC_ARC`、`B_SPLINE_*`→`CreateCurveInterp/Approx` + `CreateSurfaceFromOrderedPoints`
- C 层：拓扑组装（vertex→edge→wire→face→shell→solid）+ `SmApiStitchIntoSolidEx` 收尾

**风险**：容差、UV trim 曲线方向、退化边、周期面缝合是 ACIS/OCCT 数十年积累域。
移植版在自己写出的 STEP 上应当无损往返；在第三方工业 STEP 上**不保证**。
这一点要在方案里如实标注，不要包装成"完整支持"。

## 5. 建议的分层架构

```
faijs TS 层（可分包、可压缩、迭代快）
  ├─ step/  Part21 tokenizer + 实体表        ← 移植 brepkit step/reader.rs 的 A 层
  ├─ step/  AP203 写出器                     ← 移植 brepkit step/writer.rs 的格式层
  └─ stl/   STL 读/写（binary + ascii）      ← 移植 brepkit stl/{reader,writer}.rs
                    │
                    ▼  跨界调用（新桥，批量化）
usd-brep C++ 桥（SmApiBridgeEx.cpp）
  ├─ NURBS 数据提取桥（必需，阻塞 exportStep）
  └─ 批量建面 / 批量缝合桥（性能必需）
                    │
                    ▼
SMLib 内核（不动）
```

**为什么格式层放 TS 而不是 C++**：体积是本次的第一约束。C++ 每加一行都进
6.77 MB 的 wasm，brotli 后仍要占包；TS 走小程序分包、按需下载、且不占 wasm 预算。

## 6. 具体改动点（文件级）

| # | 文件 | 改动 | 为什么 |
|---|---|---|---|
| 1 | `packages/core/src/step/` | 新增 Part21 tokenizer + 实体表 | 移植 reader.rs A 层；修正其分号切分缺陷 |
| 2 | `packages/core/src/step/` | 新增 AP203 写出器 | 移植 writer.rs 格式层 |
| 3 | `packages/core/src/stl/` | 新增 STL 读写（binary + ascii） | 移植 stl/{reader,writer}.rs；导出可复用现有 `brep/export/stl.ts` |
| 4 | `packages/core/src/smlib-kernel/smlibKernel.ts` | 填 `importStl` / `importStep` / `exportStep` 三个 `unsupported` 桩（第 1664–1678 行） | 这是契约面要求 |
| 5 | `wasm-probe/src/SmApiBridgeEx.cpp` | 新增 NURBS 提取桥 + 批量建面/缝合桥 | 唯一必须动 C++ 的部分 |
| 6 | `packages/core/src/smlib-kernel/smlibWasm.ts` | 注册新桥导出 | 桥的发现机制 |

**不动**：SMLib 内核本体、`step/writer.rs` 的 brepkit 专属部分（它依赖 brepkit `Topology`，无移植价值）。

## 7. 测试方案（按 AGENTS.md「先跑自己写的测试」）

1. **往返测试（核心）**：smlib 建模 → `exportStep` → `importStep` → 比对体积/面数/质心。
   样本先用 `packages/demo/examples/sheetmetal-demo.fai.js`。
2. **跨引擎一致性**：同一模型 `exportStep` 的文本，与 occt/brepkit 引擎产物做**几何等价**
   （体积/面数/质心）比对，而非逐字节比对（各写出器风格不同）。
3. **第三方 STEP 样本**：用 `C:\git\new\usd-brep\TestFiles` 里的样本（Git LFS，需先
   `git lfs pull`）跑导入成功率和有效性校验。
4. **性能探针（优先做）**：STL 导入在 1k / 10k / 100k 三角面下的耗时与内存，
   确认 `SmApiStitchIntoSolid` 的实际上限。
5. **包体回归**：改动后重测 `wechat-demo` 分包体积，确保不破 2 MB 单包上限。

## 8. 风险与遗留（如实记录，不包装）

- **R1（高）**：`SmApiStitchIntoSolid` 在万级平面面上的性能未知 → 先做 §7.4 探针。
- **R2（高）**：STEP 导入对第三方工业文件不保证成功（容差/UV/周期面域）→ 需样本实测定成功率。
- **R3（中）**：NURBS 提取桥需要一次完整编译链路（约 25 分钟），迭代慢 → 建议先单独探针验证。
- **R4（中）**：小程序 wasm 只能从代码包内加载（官方文档），格式层放 TS 是对此的对冲。
- **R5（低）**：`SmApiGetOrCreateContext` 是进程级全局单例，多实例需改造（沿用 P2 记录）。

## 9. 待拍板清单（请逐条选择，我不替你填默认值）

1. **格式层放 TS 还是 C++？** 我推荐 TS（体积约束第一，且迭代快）。若你的优先级是
   解析性能 > 包体，则改走 C++ 并接受一次 ~25 分钟/轮的编译循环。
2. **STEP 导入的能力边界**：只保证「自己导出的 STEP 无损往返」，还是要追第三方工业 STEP？
   后者工作量显著更大且不保证成功率。
3. **STL 导入的语义**：导入成 B-rep（万级平面面，有性能风险），还是导入成 mesh 走已有
   mesh 链路（零风险，但编辑能力是 mesh 语义）？
4. **实施顺序**：建议 ① STL 导出接通（零成本）→ ② 性能探针 → ③ NURBS 桥 → ④ STEP 导出 →
   ⑤ STEP 导入 → ⑥ STL 导入。是否认可？
5. 探针（`wasm-probe/`）可以先跑起来验证 R1/R3，是否需要我先只做探针这一步？

## 10. 回滚路径

- 新增文件集中在 `packages/core/src/step/` 与 `packages/core/src/stl/`，删除即回滚。
- `smlibKernel.ts` 的三个桩是**新增填充**，回滚即恢复 `unsupported` 调用。
- `SmApiBridgeEx.cpp` 新增桥函数：删除函数即可，但需重跑编译链路重新出 wasm。
  **建议保留当前 `smlib_standalone.wasm.br` 副本作为回滚基线。**
