# CadQuery 移植缺口审计（faijs-cadquery，原 cq-compat）—— 沉默缺口与语义级验证

> 日期：2026-10-02
> 状态：**审计完成，待立项**
> 范围：`packages/faijs-cadquery`（Shape 类模型 `shape-class.ts`、Workplane `workplane.ts`、草图 `sketch.ts`）、`packages/core`（选择器引擎 `src/api/cadquery-selectors`）
> 上游基准：CadQuery **2.8.0**
> 配套文档：
> - `2026-09-30-cq-compat-parity-status.md`（parity 进度与待办，**头部已于本日刷新**为 §14 最终态）
> - `2026-10-02-cadquery-selector-parity-plan.md`（选择器方案；P1–P4 已落地、P5 收口与字符串语法全量待办，详见其头部状态）
> - `2026-09-28-cq-compat-remaining-cadquery-support-plan.md`（剩余特性盘点与分期计划）
>
> 本文**不复述历史方案**，只做一件事：**把 parity 框架结构性看不见的"沉默缺口"显形，并给出可落地的语义级验证方法论**。它是对 `2026-09-30` 文档"能力缺口清单"的**补全**，而非替代。

---

## 0. TL;DR

1. `2026-09-30` 文档头部滞后于正文：**头部写 423/227/47、结论写 293 blocked，正文 §14 最终态是 452/198/47**。本日已把头部刷新为 **452 ported / 198 blocked / 47 skipped**，coverage 刷新为 **199 PORTABLE / 41 STUB / 62 BLOCKED**（合计 302）。
2. parity 度量对两类东西**结构性失明**：(a) **查询 / 内省操作**（返回子形状或值，不进导出 STEP）；(b) **"已实现但语义空心"** 的状态。选择器是第一个暴露的病例，但**不是最后一个**。
3. 下一个最该立项审计的**沉默缺口**（文档从未登记、mirror 全绿但语义空心）：
   - **Shape 类模型 + 内省查询 API**（最大；值/元数据查询子集 `volume/area/length/center/bbox/isValid/geomType` 已于 2026-10-02 **P1 实施**，剩余 ~74 个 `Shape` 方法——构造器、`transform`/`translate`/`rotate`、几何操作 `Sections`/`Shells`、`distToShape` 等——仍属后续大项）
   - **对象栈模型**（`.all()/.end()/.val()/.vals()` 多对象 Workplane）
   - **对象选择器类**（Box/RadiusNth/LengthNth/AreaNth/NearestToShape/BooleanSelector）
   - **任意平面变换**（`Plane.toLocalCoords`/`mirrorInPlane`，faijs-cadquery 只有 `mirrorX/mirrorY`）——**P2 已于 2026-10-02 实施**（三件套 + 向量形态，16 用例全绿）
   - （已派生）`wires()/shells()/solids()` 选择器、`2D` 草图选择器、导出保真（GLTF/VTK/带颜色-名字-层的 STEP）
4. **方法论修正**：凡是"查询 / 内省 / 返回子形状或值"的 API，**不应只靠 STEP 几何比对判定 parity**。正确范式是**一次性 Python（CadQuery 2.8.0）参考捕获 → 把真值固化进 TS 断言**（已被 `selectors.test.ts` 验证可行），而非每次重跑 Python 的自动化探针通道。该范式应推广到上述所有沉默缺口（见 §5）。

---

## 1. 基线快照（从 2026-09-30 §14 最终态，已校正头部漂移）

| 维度 | 口径 | 数值（2026-10-02 校正） |
|------|------|------|
| manifest | 导出变量级（每个 `test_x__r1` 变体） | **697** = **452 ported** + **198 blocked** + 47 skipped |
| coverage | 上游测试函数级 | **302** = **199 PORTABLE** + 41 PORTABLE-WITH-STUB + **62 BLOCKED** |
| 门禁 | tsc / eslint / verify-export-jsdoc / check-ghost-deps / 针对性 parity | 全绿（截至 2026-09-30 §14.3） |

> 头部漂移说明：原 `2026-09-30` 文档 §2.1 记 `423/227/47`、结论先行记"293 blocked"，均为第四轮口径；正文续作到第十轮已推到 `452/198/47`（§14.1），但头部未同步。本日已把头部与结论先行刷新为第十轮最终态，并标注历轮轨迹（首 357/293/47 → 二 363/287/47 → 三 414/236/47 → 四 423/227/47 → 十 452/198/47）。

parity 完成度换算：**452 / 697 ≈ 64.8% ported**（变量级）。这是"镜像存在"的口径，不是"语义正确"的口径——本文核心论点是：**镜像存在 ≠ 能力存在**，静默缺口正藏在这 64.8% 的"已 ported"里。

---

## 2. 为什么选择器这类大功能会被漏掉（parity 框架的结构性失明）

`2026-09-30` 文档的"能力缺口"清单（§3.2）**根本没有列选择器**，但选择器一直就在仓内、且大部分镜像"PASS"。漏掉不是疏忽，是框架性隐形。四层根因（详见 `2026-10-02-cadquery-selector-parity-plan.md` §2）：

### 2.1 度量对选择语义是瞎的（最致命）
parity = 最终导出实体的 STEP 几何比对。选择器产出的是**进程内的子形状引用**，不进导出 STEP。`2026-10-02` 方案 §2.4 确认：`test_selectors` **46 条镜像全 PASS**，但全部是同一形态——注释写明"选择是进程内断言，导出的是输入立方体"，`vertices()` 是空操作，STEP 照样 PASS。"不是误报，是通道的能力边界"。

### 2.2 缺口登记机制只认"写不出镜像"的用例
选择器用例都写出了镜像且 PASS → 永不进 `blockedBy` → 永远不出现在 §3.2 的缺口分布里。

### 2.3 部分实现制造"已完成"假象
`face.ts`/`edge.ts` 有 `resolveFaceSelector`/`resolveEdgeSelection`，支持 `> < + -` 多轴 索引 命名视图。coverage 分析器把它们当"已导出/已实现" → 也不进 BLOCKED。于是落在"已实现但语义空心"的第三种沉默状态。

### 2.4 顶点选择器 / 完整字符串语法 / 逐级收窄整条链缺失却没人登记
`2026-09-30` 文档 §2 现状取证其实写过：vertex 无解析器（`workplane.ts` 的 `vertices()` 只把字符串塞进 `wp.vertexSel`，消费时忽略字符串、枚举全部顶点）；`| # % and/or/not/exc` 在 face/edge 也缺失。这些是"已在仓内、但根本没被当作缺口"的典型。

> **结论**：同一个框架对 (a) 查询/内省操作、(b) 语义空心状态 两类东西失明。**它的病不在选择器，而在"以导出实体几何相等为唯一信号"的度量哲学**。下面 §3 的沉默缺口是同一类病的不同发作点。

---

## 3. 沉默缺口清单（文档未登记，比透明缺口更危险）

> 定义：**沉默缺口** = 已在仓内（或上游明确存在）但 (1) 从未进 `2026-09-30` §3.2 缺口清单、(2) mirror 可能全绿但语义空心、(3) 没有任何测试抓得到差异。
> 透明缺口（`2026-09-30` §3.2–3.4 已登记）在此只摘要，不重述。

### 3.1 A 类 · Shape 类模型 + 内省查询 API（最大沉默缺口）

- **上游面**：`Shape` 类 81 方法（`2026-09-28` §2.4 实测 ≈0% 覆盖）；模块级类 `cq.Face/Edge/Wire/Solid/Compound/Vector/Plane/Matrix/BoundBox/Selector` 等 30 符号"极少/低"。
- **当前实现（源码核查 2026-10-02；P1 已于 2026-10-02 实施）**：`shape-class.ts` 仍以 `CqShape` 薄壳 + 4 个选择器类（`shape-class.ts:255/274/338/363`）为类模型骨架；**P1 已补齐**值/元数据查询层 —— `volumeOf` / `areaOf` / `lengthOf` / `boundingBoxOf` / `centerOfMassOf` / `isValidShape` / `geomTypeOf`（新增于文件 introspection 段）。内核（`occt-wasm`）早已具备 `getVolume` / `getSurfaceArea` / `getLength` / `getCenterOfMass` / `getBoundingBox` / `isValid` / `getShapeType` / `surfaceType` / `curveType` 原语，本次只是把它们在类模型上暴露出来，不属于"新建内核能力"。
- **P1 实施结果（2026-10-02）**：一次性 Python 参考捕获（`packages/faijs-cadquery/tests/ref-harness/shape-introspection-probe.py`，CadQuery 2.8.0）落定的真值已**固化进 TS 断言**（`src/shape-class.test.ts` 的 `Shape introspection parity` 段，20 个用例全绿）。暴露并记录了两个真实语义差异（均为 GOTCHA）：
  - **`geomType()` 异质语义（探针证实）**：solid 返回 TopAbs 型、face 返回**曲面类型** `PLANE`、edge 返回**曲线类型** `LINE`；faijs 已精确对齐（face→`surfaceType`、edge→`curveType`）。唯一残留：CadQuery `cq.Solid.makeBox` 把盒子标成 `COMPSOLID`（构造怪癖），faijs `makeBox` 是真正 `SOLID`——同几何、仅 TopAbs 标签不同，按 GOTCHA 记录，非 faijs 缺陷。
  - **`length` on solid 内核缺口**：occt-wasm `getLength` 对 solid 重复计数共享边（逐面遍历），单位盒（12 条唯一边 ×1）得 **24**，CadQuery 唯一边求和为 **12**。CadQuery 无直接 solid `Length()`；该差异定为**内核级 `length` 语义缺口**，待修（edge 级 `lengthOf` 正确，已断言 =1）。
- **为什么沉默**：这些方法返回**值/元数据**而非导出几何 → 既看不见 parity，也不进 `blockedBy`。`2026-09-28` §2.4 把它们算进 `face` 13 / `shells` 12 / `makeCompound` 8 / `remove` 5 / `replace` 4 / `addCavity` 3，但 `2026-09-30` §3.2 的"能力缺口"**完全没列 Shape 类整体**。
- **风险**：镜像全绿但语义空心。例如上游大量用例用 `BoundingBox()`/`Volume()`/`Center()` 做断言，faijs-cadquery 若只在镜像里复现"几何"而跳过这些值断言，parity 全绿但 API 不可用。（P1 已把值断言补上，该风险在查询子集上消除；其余 ~74 个 `Shape` 方法仍在。）
- **审计动作（P1 已完成）**：对 `Shape` 查询方法做**一次性 Python 参考捕获 → 固化 TS 值断言**（见 §5），不再依赖 STEP 比对。剩余 ~74 个 `Shape` 方法（构造器、`transform`/`translate`/`rotate`、`Sections`/`Shells` 几何操作、`distToShape` 等）仍属后续大项，未实现、也未登记为透明缺口（见下方"P1 之后"）。

### 3.2 B 类 · 对象栈模型（`.all()/.end()/.val()/.vals()` 多对象 Workplane）

- **上游语义**：`Workplane` 是**对象栈**，`_selectObjects` 对"当前栈里每个对象"取子实体并集去重再过滤（`cq.py:760-790`）。
- **当前实现（源码核查 2026-10-02）**：`workplane.ts` 是**扁平单对象**模型（`shape` 单一字段承载几何），grep 确认无 `.all()/.end()/.vals()/.first()/.last()/.item()` 方法定义。`2026-10-02` 选择器方案 §4.8 明确"`.all()/.end()` 等多对象栈 API 不在本版范围，属结构性改造"。
- **影响**：选择器逐级收窄（`.faces("+Z").vertices("<XY")` 候选集应是那张面的 4 个顶点而非全实体 8 个）依赖对象栈；`split/loft` 的 `.all()` 解构（`(lid, bottom) = wp.split(...).all()`）等上游模式无法表达。
- **为什么沉默**：`2026-09-30` 文档把它当"已绕过"（镜像作者用单对象模型复现几何），没登记为真实缺口。
- **风险**：结构性，单独立项；但必须显式登记，否则永远在"绕过"而非"解决"。

### 3.3 C 类 · 对象选择器类（Box/RadiusNth/LengthNth/AreaNth/NearestToShape/BooleanSelector）

- **当前实现（源码核查 2026-10-02）**：`shape-class.ts` 只有 4 个选择器类（见 §3.1），**无** `BoxSelector`/`RadiusNthSelector`/`LengthNthSelector`/`AreaNthSelector`/`NearestToShapeSelector`/`AndSelector/OrSelector/...`。
- **上游**：`selectors.py` 约 15 个选择器类（`2026-10-02` 方案 §3.1 全量列出）。
- **为什么沉默**：`2026-10-02` 方案 §4.8 显式排除（D2 裁决为"字符串语法全量"，对象选择器类不在本版）；`2026-09-28` §2.4 虽提到"选择器类体系…按镜像需求逐条加"，但从未作为缺口登记进 `2026-09-30` §3.2。
- **审计动作**：待字符串选择器（D2 范围）落地后，第二轮审计对象选择器类。

### 3.4 D 类 · 任意平面变换（`Plane.toLocalCoords` / `mirrorInPlane`）

- **当前实现（源码核查 2026-10-02）**：`packages/faijs-cadquery/src` 中 `toLocalCoords` **完全不存在**；`mirrorInPlane` 仅在 `workplane.ts:5821` 注释中出现（描述上游语义），faijs-cadquery 只有 `mirrorX`/`mirrorY`（`2026-09-30` §7.2 已确认：`test_cad_objects` 的 `local_box`/`mirror_box` 因缺任意平面变换被判 blocked）。
- **缺口规模**：上游 `Plane` 完整坐标变换 API（toLocalCoords/toWorldCoords/mirrorInPlane/rotate/translate 等），`2026-09-30` §9.2 只登了 `op:plane-toLocalCoords` 2 条——**把"任意平面变换"整体低估为 2 条**，实际是整套 `Plane` 变换面的缺失。
- **P2 实施结果（2026-10-02）**：把 `Plane` 变换 API 整体立案（不止 2 条），`toLocalCoords`/`toWorldCoords`/`mirrorInPlane` 三件套已在 `packages/faijs-cadquery/src/plane.ts` 落地（新增 `CqPlane` 帧类型 + `toLocalCoords`/`toWorldCoords`/`mirrorInPlane`/`toLocalCoordsVec`/`mirrorInPlaneVec` 五个函数）。实现只复用内核既有 `generalTransform(shape, matrix)`（3×4 行主序仿射矩阵）与 `getKernel`，**未改 core**。关键语义差异（探针证实）已固化并 GOTCHA 标注：
  - **`mirrorInPlane` 反射轴语义（探针证实）**：CadQuery `axis='X'` 是**关于平面 X 轴线的反射**（翻转 local y&z），`axis='Y'` 翻转 local x&z——**不是**关于 YZ/XZ 平面的反射。矩阵用 Householder 反射 `R = -I + 2·u⊗u` + 平移 `T = 2·(origin − (origin·u)u)` 精确对齐（首次手写矩阵把"关于线反射"误写成"关于平面反射"导致 4 个测试失败，已手工验算全部捕获值修正）。
  - **`mirrorInPlane` 返回拓扑差异（探针证实）**：CadQuery 返回 `Shell`，faijs 保留输入拓扑（solid 仍是 solid）——几何相同，仅 TopoDS 标签不同，按 GOTCHA 记录，非 faijs 缺陷。
  - CadQuery `Plane.mirrorInPlane(cq.Vector)` **不接受 Vector 参数**（抛错），故向量形态 `mirrorInPlaneVec` 改为**纯基反射自洽验证**（不捕获 CadQuery 调用），仅 `toLocalCoordsVec` 捕获真值。
- **审计动作（P2 已完成）**：对 `toLocalCoords`/`mirrorInPlane` 做**一次性 Python 参考捕获 → 固化 TS 坐标断言**（见 §5）：参考捕获见 `packages/faijs-cadquery/tests/ref-harness/plane-transform-probe.py`（CadQuery 2.8.0，XY/TR/TILT/Y 平面 + ROOT/OFF 盒，不进 CI），断言见 `src/plane.test.ts`（16 用例全绿，容差 1e-6）。`toWorldCoords` 是 `toLocalCoords` 的逆，由矩阵逆自洽覆盖。

### 3.5 E 类 · 派生沉默缺口（与上面同源，单独一轮）

| 项 | 现状 | 来源 |
|---|---|---|
| `wires()/shells()/solids()` 选择器 | `2026-10-02` §4.8 排除（`Wires` 的 `_collectProperty` 有 Solid→Compounds 特例）；`2026-09-30` §3.2 把 `shells` 12 / `wires` 当几何 op 而非选择器语义 | 同源失明 |
| `2D` 草图选择器（`sketch.ts:498 applyStringSelector`） | `2026-10-02` §4.8 排除（目标不是 3D 拓扑实体） | 同源失明 |
| 导出保真（GLTF / VTK.js / VRML / 带颜色-名字-层的 STEP 子形状往返） | `2026-09-30` §3.4 塞进"测试基础设施"口径（5 条），实为输出格式特性缺口 | 分量被低估 |

---

## 4. 透明缺口摘要（文档已登记，仅列未完清单，不重述论证）

> 完整论证见 `2026-09-30` §3.2–3.4。此处只给"仍 blocked"的条目计数，作为审计的对照基线。

- **几何 op**：`imprint` 12、`sweep` 多截面/aux-spine/pipeshell ~12、`plane` 5、`project` 2、`remove` 5、`op:text-spine` 3、`op:faceOn` 1、`op:addCavity` 3、`op:prism-from-face` 4、`op:extrude-until-face` 4、`op:sweep-hole-section` 1、`op:sweep-sketch-sections` 1、`op:offset2D-multi-region` 1、`kernel:fillet-chain-reapply` 9、`op:fuzzy-bool`（union/intersect 无 tolerance 通道）。
- **内核缺口**（§3.3）：`shell-outward-opening` 2、`draft-existing-solid` 2、`shell-intersection-join` 1、`loft-coplanar-sections` 1、`boolean-near-coincident-bspline` 1、`ellipse-tall-axis` 1、`crash-polygon-cutThruAll` 1；`hollow t>0` 精度（intersection-join 偏移，单独立项）。
- **测试基础设施**（§3.4）：`getfixturevalue` 11、`parametrize` 3、`__dir__` 2、`fixture`/`exportGLTF`/`exportVTKJS` 各 1。

---

## 5. 非 STEP 输出的 Python/TS 比对方法论（一次性参考捕获）

> 适用范围：凡是"查询 / 内省 / 返回子形状或值"的 API——选择器、Shape 内省查询、坐标变换、对象栈解构。这些输出不进导出 STEP，STEP 几何比对（parity 框架的 `compare.ts`）看不见它们。
>
> **核心结论**：正确的比对范式是 **"一次性 Python（CadQuery 2.8.0）参考捕获 → 把真值固化进 TS 断言"**，**不是**每次重跑 Python 的自动化探针通道。`selectors.test.ts`（200+ 行）已用此范式验证了选择器语义，可照搬。

### 5.1 四步范式

1. **一次性 Python 参考捕获**：在 CadQuery 2.8.0 环境（venv，一次性）里，对标准 fixture（如 `box(1,1,1)`）实跑待测 API，把"真值"打印 / 落盘。**这一步只跑一次，不进 CI、不 per-test 重跑。**
2. **把真值固化进 TS 断言**：将捕获到的数字手抄成 `*.test.ts` 的硬编码期望；反直觉语义（空集 / 抛错 / 跳过）标注 `GOTCHA:`。
3. **faijs 用自家 OCCT 内核重算同值并断言**：TS 测试通过 faijs 引擎重新计算同样的值，匹配即通过；容差按量纲（center 1e-6、bbox 1e-3、volume 1e-6·rel）。
4. **真值快照管理**：Python 参考脚本是一次性的，不留在 CI；捕获的数字活在测试文件里。若 CadQuery 版本或 fixture 变化需重新校准，再手动重跑一次性脚本刷新断言。

**为什么不用 per-run 探针通道（曾被评估为 P0）**：per-run 方案（spec 驱动 → ref 侧每次 `CQ_PROBE_SPEC` 重跑 CadQuery → cand 侧跑 faijs → `compare-selectors.ts` 差分）需要每次跑 Python、需要常驻 cadquery 环境与对照 harness，对"校准一次即可"的语义验证是过度工程，且 CI 稳定性更差。一次性捕获 + 手抄断言已能覆盖最刁钻的空集 / 抛错 / 收窄语义，且零运行时依赖。

**通道有效性的自证（仍适用）**：反直觉语义（如 `.vertices("+Z")` 返回 `[]`、`vertices(">Z[1]")` 抛 `EmptyNthError`、`.faces("+Z").vertices("<XY")` 收窄到 1 个顶点）必须落成带 `GOTCHA:` 的防回归测试。这些断言预先存在，本身就能证明"测试看得见选择结果"——不需要一条独立的差分通道来充当仲裁。

### 5.2 四类非 STEP 输出的比对要点

| 输出类型 | 比对内容 | 真值如何捕获（一次性 Python） | 容差 |
|---|---|---|---|
| 选择结果（子形状引用） | 选中实体的 `{type, center}` 保序集合 + count | 对 `box(1,1,1)` 跑选择链，打印每选中实体的 type + center | center 1e-6，顺序敏感 |
| 几何量 / 元数据（值） | `Volume()/Center()/BoundingBox()/isValid()/geomType()` 等返回值 | 对标准 fixture 实跑查询，打印标量 | 体积 1e-6·rel、bbox 1e-3、bool 精确 |
| 坐标变换结果 | `Plane.toLocalCoords`/`mirrorInPlane` 把点 / 形状转到另一坐标系的结果 | 构造标准 Plane + 点，打印变换后坐标 | 坐标 1e-6 |
| 对象栈解构 | `.all()/.vals()` 解构出的多对象集合（数量 + 各自几何） | 构造多对象 Workplane，打印各对象几何 | 同几何量容差 |

### 5.3 通用原则：把"值断言"从"几何断言"里拆出来

凡是满足下列任一条件的 API，**不应只靠 STEP 比对**：
1. 返回**子形状引用**（选择器、`.faces()/.edges()/.vertices()`、对象栈解构）；
2. 返回**值 / 元数据**（`.Center()/.Area()/.Volume()/.BoundingBox()/.isValid()/.geomType()`、坐标变换结果、`.val()/.vals()` 的首末对象）；
3. 是**进程内断言**（上游用例断言的是中间量，ref STEP 只是纯几何）。

这些全部走 §5.1 的一次性捕获范式，而非 STEP `compare.ts`。

### 5.4 度量改造建议（可选，但能根治）

`analyze-coverage.py` 的 op universe 只认"是否实现 / 导出"。建议增加一个**维度标签**：每个上游 API 标记为 `geometry-producing`（进 STEP parity）或 `value/subshape-producing`（进 §5.1 一次性断言通道）。前者继续走 `compare.ts`，后者进对应断言。**这样 coverage 计数才能区分"几何已对齐"与"语义已对齐"**，不再把 §3 的沉默缺口藏在 64.8% 的 ported 里。

### 5.5 红线（沿用仓库纪律）

- 禁止用放宽容差把断言改成 PASS；
- 反直觉语义（空集 / 抛错 / 跳过）必须落成带 `GOTCHA:` 注释的防回归测试；
- 测试触发错误必须 spy `console.warn/error` 并断言（CI stderr 零容忍）；
- 一次性 Python 脚本**不进 CI、不 per-test 重跑**；捕获的真值以 TS 断言形态固化，作为唯一可维护产物。

---

## 6. 立项优先级建议（下一步最该审计的）

| 优先级 | 项 | 理由 | 依赖 |
|---|---|---|---|
| **P0** | 字符串语法全量 + 逐级收窄（沿用 §5.1 一次性参考捕获范式，不建 per-run 探针通道） | 选择器方案既定范围；验证已用一次性捕获范式落地（`selectors.test.ts`） | — |
| **P1** | **几何量断言** + Shape 类模型内省 API 审计 | **已完成**（2026-10-02）：查询子集 volume/area/length/center/bbox/isValid/geomType 已在 `shape-class.ts` 暴露 + 一次性捕获断言全绿；剩余 ~74 个 `Shape` 方法（`transform`/构造器/几何操作/`distToShape` 等）待续 | — |
| **P2** | **坐标变换一次性捕获** + Plane 任意平面变换审计（整体立案，非 2 条） | **已完成**（2026-10-02）：`plane.ts` 落地 `toLocalCoords`/`toWorldCoords`/`mirrorInPlane` + 向量形态，一次性 Python 捕获断言 16 用例全绿；曝光 `mirrorInPlane` 反射轴语义（关于 X/Y 轴**线**反射）+ 返回 Shell vs 保留拓扑两个 GOTCHA | P1 |
| **P3** | 对象栈模型结构性改造 + 对象栈一次性捕获 | §3.2，结构性、工作量最大 | 选择器逐级收窄落地后 |
| **P4** | 对象选择器类（C 类）+ `wires/shells/solids` 选择器 + 2D 草图选择器 | §3.3/§3.5，同源派生 | P0 字符串选择器落地后 |

> **共同风险**（一句话）：P1–P4 的所有缺口，都和这次的选择器是**同一类病**——"镜像全绿但语义空心"，因为度量只能看见导出几何。解决它们的不是更多镜像，而是 §5 的一次性参考捕获范式（把真值固化进 TS 断言）。

---

## 7. 后续动作清单（checklist）

- [ ] **（已做）** 刷新 `2026-09-30` 文档头部为 452/198/47 / 199·41·62，消除与 §14 漂移。
- [ ] **（已做 · P1）** 对 `Shape` 内省 API（`volume/area/length/center/bbox/isValid/geomType`）做**一次性 Python 捕获 → 固化 TS 值断言**：实现见 `packages/faijs-cadquery/src/shape-class.ts`（introspection 段）、断言见 `src/shape-class.test.ts`（`Shape introspection parity` 段，20 用例全绿）、参考捕获见 `packages/faijs-cadquery/tests/ref-harness/shape-introspection-probe.py`（CadQuery 2.8.0，不进 CI）。暴露并记录了两个真实语义差异：`geomType()` 异质语义（face→`PLANE`/edge→`LINE`，已对齐；`cq.Solid.makeBox`→`COMPSOLID` 怪癖按 GOTCHA 记录）、`length` on solid 内核级重复计数缺口（24 vs 12）。
- [ ] **（待办）** 修内核级 `length` on solid 重复计数（`occt-wasm` `getLength` 逐面遍历共享边）——edge 级 `lengthOf` 正确，solid/compound 级需去重，否则 `Length()` 语义与 CadQuery 唯一边求和不符。
- [ ] **（待办）** 把本审计 §3 的 A–E 类沉默缺口**反向补登**进 `2026-09-30` §3.2（作为"沉默缺口"子节），使缺口清单完整。
- [ ] P0：推进选择器方案字符串语法全量 + 逐级收窄（**一次性 Python 捕获 → 固化 TS 断言**，不建 per-run 探针通道）。
- [ ] **（已做 · P2）** 把 `Plane` 任意平面变换整体立案（不止 2 条），对 `toLocalCoords`/`mirrorInPlane` 做**一次性 Python 坐标捕获 → 固化 TS 断言**：实现见 `packages/faijs-cadquery/src/plane.ts`（`CqPlane` 帧 + `toLocalCoords`/`toWorldCoords`/`mirrorInPlane`/`toLocalCoordsVec`/`mirrorInPlaneVec`，复用内核 `generalTransform` + `getKernel`，未改 core）、断言见 `src/plane.test.ts`（16 用例全绿，容差 1e-6）、参考捕获见 `packages/faijs-cadquery/tests/ref-harness/plane-transform-probe.py`（CadQuery 2.8.0 XY/TR/TILT/Y 平面 + ROOT/OFF 盒，不进 CI）。曝光两个真实语义差异：`mirrorInPlane` 反射轴是"关于 X/Y 轴**线**反射"（翻转 local y&z 或 x&z，非关于 YZ/XZ 平面）——Householder 反射矩阵对齐；CadQuery 返回 `Shell`、faijs 保留输入拓扑（几何相同、TopoDS 标签不同），按 GOTCHA 记录。`toWorldCoords` 为 `toLocalCoords` 逆，由矩阵逆自洽覆盖。
- [ ] P1 之后：审计剩余 ~74 个 `Shape` 方法（构造器、`transform`/`translate`/`rotate`、`Sections`/`Shells` 几何操作、`distToShape` 等），逐个判定"已实现 / 语义空心 / 缺失"，并与本审计 §5 范式落地断言。
- [ ] 评估 `analyze-coverage.py` 增加 `geometry-producing` / `value-producing` 维度标签（§5.4），根治度量失明。
- [ ] 每立项一个沉默缺口，先写一次性 Python 参考捕获 + 固化 TS 断言（复用 `selectors.test.ts` 的"捕获真值 → 硬编码期望 → 引擎重算"纪律）。

---

## 8. 参考源（本文事实出处）

- `docs/plans/2026-09-30-cq-compat-parity-status.md` §2.1（头部，已刷新）、§3.2–3.4、§9.1、§11.2、§14.1（最终态 452/198/47）。
- `docs/plans/2026-10-02-cadquery-selector-parity-plan.md` §2（现状取证）、§3（语义基线）、§4.8（不在本版范围）、§5.1（per-run 探针通道——本审计 §5 已弃用，改用一次性 Python 参考捕获）。
- `docs/plans/2026-09-28-cq-compat-remaining-cadquery-support-plan.md` §2.4（Shape 类模型 81 方法 ≈0%）、§3（缺口分层）。
- 源码核查（2026-10-02）：`packages/faijs-cadquery/src/shape-class.ts:255/274/338/363`（4 个选择器类）、`workplane.ts`（无对象栈方法、`mirrorInPlane` 仅注释）、`grep toLocalCoords` 全仓零命中。
