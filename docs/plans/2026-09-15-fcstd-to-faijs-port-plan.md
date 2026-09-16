# FCStd → faijs 单向移植开发计划

> 日期：2026-09-15
> 状态：**部分实施** —— M0–M6 草图→cad 面接线 + Pad/Pocket/Extrusion/Revolution/LinearPattern/PolarPattern 已落地（commit 8e782e6）；**Fillet/Chamfer（12 个）已随 M6.1 接线**（`cad.edgeRef` 边锚点 + `cad.fillet`/`cad.chamfer`）。
> 依赖分析：
> - `docs/analysis/2026-09-15-fcstd-to-fai-zip-feasibility.md`（下称「前文 A」）
> - `docs/analysis/2026-09-15-sketch-constraint-solver-port-feasibility.md`（下称「前文 B」）

---

## 1. 用户原始要求（原文引用）

> 知道了。我同意planegcs用wasm，本项目未来会开源，没有许可证问题。可以第一步只支持草图的读档时求解。请根据两份分析文档，写一份开发计划，我需要能够把fcstd单向移植到faijs

拆解为五条约束：

| 编号 | 约束 |
|---|---|
| C1 | 约束求解器采用 **planegcs WASM**（前文 B §5 路线 A），不定自研、不定自编译 |
| C2 | 项目未来开源，**许可不构成阻塞**（前文 B 的 R1 降级，但仍有开源义务，见 D6） |
| C3 | **第一步的草图能力只做「读档时求解」**——不做交互式草图、不做拖拽求解、不做自动约束 |
| C4 | 计划基于前文 A 与前文 B，不另起炉灶 |
| C5 | 最终目标是**能把 FCStd 单向移植到 faijs**——草图是手段，不是终点 |

---

## 2. 目标与范围

### 2.1 做什么

一条单向转换管线：`.FCStd` → `.fai.zip`（容器设计见前文 A §6），其中：

- 非建模内容（Gui、缩略图、元数据、包含文件）**逐字节保留**；
- 建模内容尽最大可能翻译为 `.fai.js`；
- 翻译不了的**烘焙为资产**，并在 `mapping.json` 记明原因，**禁止静默丢弃**（前文 A R7）；
- 草图走**读档时求解**通道：解析 FCStd 的几何与约束 → 交给 planegcs WASM 求解 → 得到 2D 轮廓。

### 2.2 不做什么（明确边界）

| 不做 | 理由 |
|---|---|
| 反向写回 `.FCStd` | FreeCAD 保存链路在 C++ 硬编码，无外部接管点（前文 A §3.8） |
| 交互式草图（拖拽求解 `initMove`、临时约束） | C3；属于 faijs 原生建模轨道，不在本计划内 |
| 自动约束推断 | Gui 侧职责（前文 B §3.4，81,452 行不移植） |
| 移植 `SketchObject` 的文档对象语义 | 与 App 文档/表达式耦合（前文 B §3.3） |
| 2D 草图求解器自研 | C1 已定 WASM 路线 |
| `PropertyPythonObject` 翻译 | 黑盒，一律烘焙（前文 A R7） |

---

## 3. 前置结论（直接继承，不重新论证）

| 结论 | 来源 |
|---|---|
| FCStd 是标准 ZIP，无 mimetype | 前文 A §3.1（**但 ZIP 注释不能作校验依据，见 §5.5.6**） |
| 转换器必须以 `<ObjectData>` 为准，`<Objects>` 只是类型索引 | 前文 A §3.3 |
| `.fai.zip` = `manifest.json` + `mapping.json` + `model/` + `assets/` + `freecad/`（原样影子） | 前文 A §6 |
| planegcs 13,306 行，**复用 WASM、零重写**；真正要写的是语义桥 ~2,500–3,500 行 TS | 前文 B §2、§7 |
| planegcs WASM 选 `@salusoft89/planegcs` v1.2.0（unpacked 892,495 B） | C1 |
| 求解器选型必须在 P3 之前定——**本计划用 M0 探针兑现** | 前文 B §9.2 |
| `.fai.zip` 不能被 FreeCAD 打开，转换天然单向 | 前文 A §3.8 |
| **样本集已存在：仓库自带 56 个 `.FCStd`，含 1,539 条约束、786 个草图几何** | §5.5（**更正前文 A §11 第 1 条**） |

---

## 4. 架构总览

```
.FCStd
  │
  ├─ M1 解包 ────────────────► 成员字节表
  │
  ├─ M2 解析 Document.xml ───► 对象图（类型/属性/链接/表达式）
  │                              │
  │                              ├─ 非建模成员 ──► freecad/ 原样搬运（M5）
  │                              │
  │                              └─ 建模对象
  │                                    │
  │                     ┌──────────────┴──────────────┐
  │                     │                             │
  │              M3 草图只读求解通道          M4 白名单特征翻译
  │                     │                             │
  │   <GeometryList> + <ConstraintList>        基本体/布尔/变换/
  │                     │                      阵列/圆角倒角
  │              GCS primitives                       │
  │                     │                             │
  │            planegcs WASM solve()                  │
  │                     │                             │
  │              2D 轮廓（Curve2D）                   │
  │                     │                             │
  │                     └──────────────┬──────────────┘
  │                                    │
  │                            M5 代码生成 + 打包
  │                                    │
  │                            model/*.fai.js
  │                            assets/*.step（回退集）
  │                            freecad/*（影子）
  │                            mapping.json
  ▼
.fai.zip
```

**M3 与 M4 可并行**——M3 只依赖 M2 的对象图，M4 同样。两者的交汇点在 M5。

---

## 5. 数据契约（FCStd 侧实测）

本章是 M3 的输入规格。全部字段基于本地 FreeCAD 26.3.0-dev 源码逐字核实。

### 5.1 草图对象的关键属性

`SketchObject::SketchObject`（`src/Mod/Sketcher/App/SketchObject.cpp`）注册的属性：

| 属性 | 行号 | 落盘元素 | 用途 |
|---|---|---|---|
| `Geometry` | `:82` | `<GeometryList>` | 草图几何（主体） |
| `Constraints` | `:84` | `<ConstraintList>` | 约束定义 |
| `ExternalGeometry` | `:89` | `<LinkList>` | 外部几何引用 |
| `ExternalTypes` | `:94` | — | 外部几何类型 |
| `FullyConstrained` | `:99` | `<Bool>` | **是否全约束**（M3 的重要判据） |
| `Exports` | `:104` | — | 导出元素 |
| `ExternalGeo` | `:108` | — | 外部几何缓存 |
| `ArcFitTolerance` | `:112` | `<Float>` | 弧拟合容差 |

### 5.2 几何落盘格式

`PropertyGeometryList::Save`（`src/Mod/Part/App/PropertyGeometryList.cpp:241-263`）：

```xml
<GeometryList count="N">
  <Geometry type="Part::GeomLineSegment" migrated="1">
    …具体元素…
  </Geometry>
</GeometryList>
```

`type` 是 C++ 类名。各几何的内部元素（`src/Mod/Part/App/Geometry.cpp`）：

| 类型 | 元素标签 | 属性 | 源码位置 |
|---|---|---|---|
| 点 | `<GeomPoint/>` | `X` `Y` `Z` | `:689-698` |
| 线段 | `<LineSegment/>` | `StartX` `StartY` `StartZ` `EndX` `EndY` `EndZ` | `:4852-4864` |
| 圆 | `<Circle/>` | `CenterX/Y/Z` `NormalX/Y/Z` `AngleXU` `Radius` | `:2902-2919` |
| 圆弧 | `<ArcOfCircle/>` | 圆的全部 + `StartAngle` `EndAngle` | `:3155-3173` |
| 椭圆 | `<Ellipse/>` | 圆心/法向/`AngleXU` + 主副半径 | `:3417+` |
| 椭圆弧 | `<ArcOfEllipse/>` | 椭圆全部 + `StartAngle` `EndAngle` | `:3712+` |
| B 样条 | `<BSplinecurve>`（含子元素） | `PolesCount` `KnotsCount` `Degree` `IsPeriodic` | `:2102-2116` |

**所有几何坐标都是 3D（X/Y/Z）**，草图局部坐标系下 `Z` 通常为 0；草图到 3D 的定位由对象的 `Placement` / `AttachmentOffset` 承担。

### 5.3 约束落盘格式

`Constraint::Save`（`src/Mod/Sketcher/App/Constraint.cpp:157-202`）——注意元素名是单数 **`Constrain`**：

```xml
<Constrain Name="" MetaData=""
           Type="1"                        <!-- ConstraintType 枚举整数 -->
           [InternalAlignmentType="0"]     <!-- 仅 Type=15 -->
           [InternalAlignmentIndex="0"]
           Orientation="0"
           Value="10.0" LabelDistance="0" LabelPosition="0"
           IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1"
           First="0" FirstPos="1" Second="0" SecondPos="2" Third="0" ThirdPos="0"
           ElementIds="0 1" ElementPositions="1 2"/>
```

- `First/Second/Third` + 各自 `Pos` 是**向后兼容的旧格式**；`ElementIds` / `ElementPositions` 是**新版多元素格式**（空格分隔）。**转换器优先读 `ElementIds`/`ElementPositions`，缺失时回退到 `First/Second/Third`。**
- `Type` 取值 = `ConstraintType` 枚举（`src/Mod/Sketcher/App/Constraint.h:52-77`）：`Coincident=1`、`Horizontal=2`、`Vertical=3`、`Parallel=4`、`Tangent=5`、`Distance=6`、`DistanceX=7`、`DistanceY=8`、`Angle=9`、`Perpendicular=10`、`Radius=11`、`Equal=12`、`PointOnObject=13`、`Symmetric=14`、`InternalAlignment=15`、`SnellsLaw=16`、`Block=17`、`Diameter=18`、`Weight=19`、`Group=20`、`Text=21`。
- `IsDriving="1"` = 驱动约束（尺寸）；`"0"` = 参考/测量约束。

#### 5.3.1 解析规则（对全部 1,539 条约束的实测标定）

| 属性 | 实测结果 | 解析规则 |
|---|---|---|
| `IsDriving` | **缺失 224 条（14.6%）；值为 `0` 的 0 条** | 缺失时**默认 `true`（驱动）**。源码依据：`Constraint.h:240` 的 `bool isDriving {true};`，且 `Restore` 仅在属性存在时赋值（`Constraint.cpp:238-240`）。样本集中**不存在参考约束** |
| `ElementIds`/`ElementPositions` | **缺失或空 731 条（47.5%）** | **必须实现 `First/Second/Third` 回退**——这不是理论可能，是近半数的现实路径 |
| `Third`/`ThirdPos` | 1,539 / 1,539 存在 | 旧式三元组齐全，回退可直接用 |
| `Type` | 100% 存在，值域 0–21 无越界 | 无需防御分支 |
| `Orientation` | `Restore` 缺失时置 `None`（`Constraint.cpp:227-231`） | 同此默认 |

**推论**：M3.5 可暂不实现非驱动约束的回写（FreeCAD 的 `updateNonDrivingConstraints`，`Sketch.cpp:4934`），因为样本集中无此类约束；但仍需保留防御分支，遇到 `IsDriving=0` 时按「不参与求解、仅测量」处理。

### 5.4 元素引用的编号规则

`GeoEnum`（`src/Mod/Sketcher/App/GeoEnum.h:71-78`）：

| 常量 | 值 | 含义 |
|---|---|---|
| `RtPnt` / `HAxis` | **-1** | 根点 / 水平轴 |
| `VAxis` | **-2** | 垂直轴 |
| `RefExt` | **-3** | 外部几何起始（负 geoId 从这里往下） |
| `GeoUndef` | -2000 | 未定义/未使用 |

`PointPos`（`GeoEnum.h:88-94`）：`none=0`（边本身）、`start=1`、`end=2`、`mid=3`（圆心/椭圆中心）。

**推论：**
- `geoId >= 0` → 草图自有几何，参与求解；
- `geoId == -1 / -2` → 轴与根点，是**隐含固定几何**（原点 + H/V 轴），必须在 GCS 里建为固定图元；
- `geoId <= -3` → **外部几何**，需要投影源对象才能得到坐标（见 D4）。

### 5.5 实测样本集画像

**对前文 A §11 第 1 条「没有真实 `.FCStd` 样本」的更正：本地 FreeCAD 仓库自带 56 个样本，已全部解包扫描。**

扫描方式：Python `zipfile` + 正则统计 `Document.xml`，无 FreeCAD 运行时依赖。

#### 5.5.1 总体

| 指标 | 实测值 |
|---|---|
| `.FCStd`/`.fcbak` 文件 | **56 个**，解包失败 **0 个** |
| 含 `Sketcher::SketchObject` 的文件 | **35 个**（62.5%） |
| `SketchObject` 对象总数 | 126 |
| 草图几何总数 | **786** |
| 约束总数 | **1,539** |
| ZIP 成员总数 | 5,679（其中 `.brp`/`.bin` 1,221） |
| 含 `GuiDocument.xml` | 56 / 56 |
| `SchemaVersion` | 全部 = 4 |

**ProgramVersion 跨度**：`0.15R4241`（2015）→ `1.2R45573`（2026），覆盖约 11 年格式演进。**这本身就是一份向后兼容性测试集**，比任何人工构造的样例都更有价值。

#### 5.5.2 约束类型分布（1,539 条）

| 约束 | 数量 | 占比 | 累计 |
|---|---|---|---|
| `Coincident` | 494 | 32.1% | 32.1% |
| `Vertical` | 183 | 11.9% | 44.0% |
| `Horizontal` | 169 | 11.0% | 55.0% |
| `DistanceX` | 141 | 9.2% | 64.1% |
| `DistanceY` | 135 | 8.8% | 72.9% |
| `Tangent` | 95 | 6.2% | 79.1% |
| `PointOnObject` | 87 | 5.7% | 84.7% |
| `Symmetric` | 64 | 4.2% | 88.9% |
| `Equal` | 54 | 3.5% | 92.4% |
| `Distance` | 29 | 1.9% | 94.3% |
| `Radius` | 26 | 1.7% | 96.0% |
| `Diameter` | 20 | 1.3% | 97.3% |
| `Angle` | 14 | 0.9% | 98.2% |
| `Parallel` | 11 | 0.7% | 98.9% |
| `Perpendicular` | 9 | 0.6% | 99.5% |
| `InternalAlignment` | 8 | 0.5% | 100% |
| `SnellsLaw` / `Block` / `Weight` / `Text` | **0** | — | — |

**结论：**
- **P0 约束集（15 个）覆盖 99.5%**（1,531 / 1,539）。M3.4 的首轮范围选择被实测证实。
- **`SnellsLaw`/`Block`/`Weight`/`Text` 一个都没有**——前文 B §7.2 判为「不实现」是安全的。
- 前 5 类占 72.9%，前 9 类占 92.4%。**M3.4 可按此顺序实现，前 5 类就打通七成场景。**

#### 5.5.3 几何类型分布（786 个）

| 几何 | 数量 | 占比 |
|---|---|---|
| `GeomLineSegment` | 652 | 83.0% |
| `GeomCircle` | 64 | 8.1% |
| `GeomArcOfCircle` | 57 | 7.3% |
| `GeomPoint` | 11 | 1.4% |
| `GeomEllipse` | 2 | 0.3% |
| `GeomArcOfEllipse` / `GeomBSplineCurve` / 双曲线 / 抛物线 | **0** | — |

**结论：M3.3 只需实现 5 种几何**（线段、圆、圆弧、点、椭圆）。B 样条与圆锥曲线在样本中零出现——前文 B §6 担心的曲线类型缺口（R6）**在样本集上不构成风险**，但仍保留显式抛错而非静默近似。

#### 5.5.4 外部几何影响面

含 `geoId <= -3` 约束的文件仅 **5 个**（`hole_puzzle` 11 条、`motor_mount_inch` 10 条、`TestSketchCarbonCopyReverseMapping` 6 条、`PartDesignExample` 1 条、`Drilling_1` 1 条）。

**D4 的「整草图降级 L2」策略影响面有限**——35 个含草图的文件中仅 5 个受影响。

#### 5.5.5 对象类型分布（对 M4 覆盖率的影响）

| 类别 | 代表类型与数量 | 可翻译性 |
|---|---|---|
| **Python 系（占绝大多数）** | `Part::FeaturePython` 350、`Part::Part2DObjectPython` 232、`App::FeaturePython` 187、`Path::FeaturePython` 40、`Fem::*Python` ~65 | **不可翻译**，全部烘焙（R7） |
| 可翻译（PartDesign） | `Body` 37、`Pad` 32、`Pocket` 30、**`Revolution` 17**、`Chamfer` 7、`Fillet` 5、`LinearPattern` 1、`PolarPattern` 1 | 白名单翻译 |
| 可翻译（Part） | `Box` 24、`Extrusion` 27、`Cut` 17、`Cylinder` 5、`MultiFuse` 6 | 白名单翻译 |
| 保留 | `App::Origin` 36、`App::Link` 13、`Assembly::*` 2 | 原样保留 |
| 草图 | `Sketcher::SketchObject` 126 | M3 |

其他实测计数：`<ExpressionEngine>` **1,709** 个、`<XLink>` 58 个、`<Python>`（`PropertyPythonObject`）**935** 个、`Extensions="True"` 634 个。

**两个直接影响排期的结论：**

1. **`<ExpressionEngine>` 有 1,709 个**——远比预期多。表达式降级（M6.2）不是边缘功能，应提前评估是否需要在 M4 阶段就做最简降级（否则大量特征会因依赖表达式而回退）。
2. **`PartDesign::Revolution` 有 17 个，多于 `Chamfer`(7) + `Fillet`(5) 之和。** 这为 §11 待定项 ①（`revolve` 是否挂 `cad` 面）提供了实测依据：**必须挂**，否则 17 个对象全部回退。

#### 5.5.6 容器层校验规则（实测修正）

前文 A §3.1 将 ZIP 注释 `FreeCAD Document` 作为格式识别依据。实测 **2 / 56 个样本的 ZIP 注释为空字符串**（`data/tests/ProjectTest.FCStd`、`tests/src/Mod/PartDesign/App/TestModels/TwoLengthsPadWithExpression.FCStd`）。

**修正后的 M1.1 校验规则：**
1. 能作为 ZIP 打开（必要条件）；
2. 根目录存在 `Document.xml`（**唯一必要判据**）；
3. ZIP 注释仅作**提示性信息**，匹配与否都不影响处理——不得据此拒绝文件。

---

## 6. 关键设计决策

### D1：求解结果以「轮廓」为契约，不以「约束」为契约

M3 的输出是 **2D 轮廓（`Curve2D[]` / `Blueprint`）**，不是约束定义。

理由：C3 限定第一步只读求解；轮廓能直接喂给 `extrude`，M4 与 M5 无需等待 faijs 原生草图能力。

**但约束定义不丢弃**——M3 同时把 GCS primitives 写入 `mapping.json` 的 `sketch.gcs` 字段，作为未来升级为可编辑草图的输入。

### D2：落盘几何坐标即求解初值

这是本方案最重要的一条。

FCStd 里 `<GeometryList>` 存的坐标，就是 **FreeCAD 上次求解的结果**。它是求解器的**天然完美初值**——收敛快、且不会跳到错误的解分支（数值求解多解问题的经典陷阱，前文 B R7）。

更进一步，它还是**验收基准**：重解结果应当与落盘几何几乎一致（见 §8 V2）。这一个判据同时验证了解析器、GCS 语义、单位、坐标系四件事。

**因此 M3 的求解流程是「加载落盘几何 → 加载约束 → solve → 与落盘几何比对 → 通过则用解，不通过则用落盘几何并标记」。**求解失败不会让转换失败，只会降级。

### D3：分层回退，三级降级

| 级别 | 条件 | 产物 | `mapping.json` 标记 |
|---|---|---|---|
| L0 参数化 | 求解成功且比对通过 | 轮廓（可复算） | `sketch: solved` |
| L1 初值直用 | 求解失败/不收敛/比对超限 | 轮廓（落盘坐标直出） | `sketch: initial-value` + 失败原因 |
| L2 烘焙 | 几何类型不支持 / 含外部几何（D4） | `assets/<Sketch>.step` | `sketch: baked` + 原因 |

**三级都必须出几何，不存在「转换失败」这一档**——只有保真度不同。这与前文 A「P1 结束时就有可用产物」的原则一致。

### D4：含外部几何的草图，M3 阶段走 L2 烘焙

外部几何（`geoId <= -3`）的坐标不在 `<GeometryList>` 里，需要按 `ExternalGeometry` 的 Link 找到源对象、投影到草图平面才能得到。这需要理解 `XLink` + OCCT 投影，成本高且依赖 M1/M2 的完整性。

**M3 阶段：遇到 `geoId <= -3` 的约束 → 整张草图降级为 L2 烘焙**，记 `reason: external-geometry`。待 M6 具备元素引用能力后再解锁。

### D5：planegcs 封装隔离在 `SketchSolver` 接口之后

faijs 只依赖自定义的 `SketchSolver` 接口（输入几何图元 + 约束 → 输出求解后图元），WASM 只是其一个后端实现。

理由：前文 B R2/R3（版本漂移、第三方维护中断）需要保持可切换性。若日后改为自编译或换实现，M3 的调用方零改动。

### D6：开源不等于零义务

C2 说明许可不再是阻塞，但 `@salusoft89/planegcs` 是 LGPL-2.0-or-later（npm 元数据；GitHub 页写 LGPL-2.1，以保守者为准）。开源项目使用仍需：

1. 保留其版权与许可声明（随发行物附带 `LICENSE` 或 `THIRD-PARTY-NOTICES`）；
2. 若**修改**其源码（包括重新编译 wasm），该部分的修改需以 LGPL 开放；
3. 提供获取其源码的途径（npm 依赖天然满足）。

**最小化义务的做法：作为未修改的 npm 依赖使用，不重新编译、不内联 wasm。** 本计划按此执行。

### D7：单位

FreeCAD 的 `PropertyQuantity` 在 XML 里只存 `<Float>` 数值（前文 A §3.4），单位不在元素里。FCStd 内部标准是 mm（与 faijs 一致），但**不排除历史文件或用户改过单位制**。

M2 阶段从文档属性读取单位设置并归一到 mm，写进 `mapping.json` 的 `units` 字段；`main.fai.js` 头部写死单位注释（前文 A R3）。M3 的草图坐标同样走这条归一。

---

## 7. 分阶段计划

编号用 **M0–M6**（Milestone），避免与前文 A 的 P0–P4 混淆。右侧标注与前文 A 的对应关系。

### M0 — planegcs WASM 可行性探针（前置，必须在 M3 启动前完成）

**目标**：用 1–2 天拿到 go/no-go 结论，兑现前文 B §9.2 的要求。

| 步骤 | 内容 |
|---|---|
| M0.1 | 安装 `@salusoft89/planegcs`，读 `planegcs_dist/constraints.ts` 拿到**完整 primitive 类型清单** |
| M0.2 | 在 faijs 的 Node 环境加载 wasm，记录：初始化耗时、纯 wasm 体积（与 `initOcctWasm()` 对比） |
| M0.3 | 求解基准草图（一个矩形 + 4 条边 + 若干水平/垂直/距离约束），验证解正确 |
| M0.4 | 与本地 FreeCAD 26.3.0-dev 的 `Constraints.h` 做**约束清单差异比对**（前文 B §12 第 1 条） |
| M0.5 | 输出 go/no-go 报告 |

**出口判据**：M0.3 的解与解析解误差 < 1e-6；M0.4 的差异清单覆盖了 `<Constrain Type>` 的 P0 约束集（§7 M3 的表）。

**若 no-go**：切前文 B §5 路线 B（自编译 Emscripten）。前文 B §4 已证明剥离 Boost 后仅剩 Eigen，切换壁垒低。

### M1 — 解包与对象图解析（= 前文 A P0）

| 步骤 | 内容 |
|---|---|
| M1.1 | ZIP 解包：按 §5.5.6 的**修正规则**校验（ZIP 可打开 + `Document.xml` 存在；注释仅作提示） |
| M1.2 | `Document.xml` → 对象图（只解析 `<ObjectData>`，跳过 `_Property` transient） |
| M1.3 | 对象清单报表（类型分布、属性分布、表达式数量） |
| M1.4 | **样本集筛选与分类**：从仓库自带 56 个样本中筛出 M3/M4 的测试子集，并按 §5.5.2 的约束分布标注难度分级 |

**出口判据**：报表在**全部 56 个样本**上零失败跑通（§5.5.1 已用一次性脚本验证可行性，M1.4 将其固化为可重跑的资产）；测试子集 ≥ 10 个文件且覆盖 Pad / Pocket / Sketch / Fillet / Revolution。

> **样本集来源问题已解决**（原 §11 待定项 ②）。仓库自带样本覆盖 0.15（2015）至 1.2（2026）共 11 年格式演进，远超人工构造样例的价值。若日后有真实机械零件样本，作为**补充**加入即可。

### M2 — `.fai.zip` 容器与保留层（= 前文 A P1）

| 步骤 | 内容 |
|---|---|
| M2.1 | `manifest.json` / `mapping.json` 的 schema 定义与写入 |
| M2.2 | `freecad/` 影子：逐字节搬运，记录 sha256 |
| M2.3 | 全部建模对象走 `baked`（从 ZIP 内 `.brp` 直接取，不调 FreeCAD） |
| M2.4 | 单位归一（D7） |

**出口判据**：`freecad/` 每个成员解包前后 sha256 全等；由 `freecad/` 重打的包能被 FreeCAD 打开（人工抽样）。

**此时已有可用产物**——保真但不可编辑的 `.fai.zip`。

### M3 — 草图只读求解通道（新增，本计划核心）

与 M4 并行。

| 步骤 | 内容 | 估计规模 |
|---|---|---|
| M3.1 | FCStd 草图解析：`<GeometryList>` → `Geom2D[]`；`<ConstraintList>` → `Constraint[]` | ~400 行 |
| M3.2 | `SketchSolver` 接口 + planegcs WASM 后端封装（D5） | ~400 行 |
| M3.3 | 几何 → GCS primitives（含 HAxis/VAxis/RtPnt 隐含固定图元，D4 的外部几何检出） | ~500 行 |
| M3.4 | 约束 → GCS primitives：P0 约束集（下表） | ~800 行 |
| M3.5 | 求解 + 结果回写 + 与落盘几何比对（D2） | ~300 行 |
| M3.6 | 轮廓提取：求解后几何 → 闭合环 → `Curve2D[]` / `Blueprint` | ~400 行 |
| M3.7 | 三级降级（D3）+ `mapping.json` 落盘 | ~200 行 |

**P0 约束集（M3.4 首轮实现范围）**——按前文 B §7.2 分档：

| 档 | 约束 | 说明 |
|---|---|---|
| P0 | `Coincident` `Horizontal` `Vertical` `Parallel` `Perpendicular` `Tangent` `Distance` `DistanceX` `DistanceY` `Angle` `Radius` `Diameter` `Equal` `PointOnObject` `Symmetric` | 15 个，**实测覆盖 99.5%** |
| P1 | `InternalAlignment`（椭圆主轴/焦点、B 样条控制点） | M3 后期，实测 8 条（0.5%） |
| 不实现 | `SnellsLaw` `Weight` `Block` `Text` | 命中即降级 L2，**实测 0 条** |

**实现顺序按实测频率**（§5.5.2）：`Coincident` → `Vertical`/`Horizontal` → `DistanceX`/`DistanceY` → `Tangent`/`PointOnObject` → `Symmetric`/`Equal` → 其余。前 5 类即覆盖 72.9% 约束，可先打通端到端链路再补齐。

**出口判据**：见 §8 V2。

### M4 — 白名单特征翻译（= 前文 A P2）

与 M3 并行。

| 步骤 | 内容 |
|---|---|
| M4.1 | 白名单判定表（不在白名单即回退，前文 A §8 S3） |
| M4.2 | 基本体 → `cad.box/cylinder/cone/sphere/torus` |
| M4.3 | 布尔 → `cad.union/subtract/intersect` |
| M4.4 | 变换 / 阵列 → `cad.translate/rotate/linearPattern/circularPattern/mirrorJoin` |
| M4.5 | 圆角倒角 → `cad.fillet`/`cad.chamfer`：选边经 M6.1 的 `cad.edgeRef` 边锚点；样本 Chamfer 7 + Fillet 5 全部翻译 |
| M4.6 | **Pad/Pocket/Extrusion/Revolution 接入 M3 草图轮廓** → 新增 `cad.sketch` 构面 op + `cad.extrude` / `cad.revolve`（commit 8e782e6；原 `cad.fai_extrude` 路线废弃） |
| M4.7 | **LinearPattern/PolarPattern 阵列** → `cad.linearPattern` / `cad.circularPattern`（标准轴方向/轴直接接线；edge/vertex 引用降级烘焙，依赖 M6.1） |

**出口判据**：白名单内特征 100% 出 `cad.*` 调用；回退集 100% 有 `assets/` 产物。

### M5 — 代码生成与打包收口（= 前文 A S5–S7）

| 步骤 | 内容 |
|---|---|
| M5.1 | 拓扑排序：`Body.Group` 顺序 + `PropertyLink` 依赖 → 线性特征序列 |
| M5.2 | 代码生成：参数 → JS 常量；特征 → `cad.*` 调用；语句 id `sN`、变量名 `partN` |
| M5.3 | 多 Body 拆分 → `model/*.fai.js` |
| M5.4 | `.fai.zip` 打包 |
| M5.5 | **Agent Note + 文档更新**（AGENTS.md 要求非平凡变更同 PR 带 note） |

**出口判据**：产出的 `.fai.js` 能被 `faijs-cli.ts check` 干跑校验通过。

### M6 — 元素引用锚点与表达式降级（= 前文 A P4）

| 步骤 | 内容 | 进度 |
|---|---|---|
| M6（草图→cad 面） | M3 求解轮廓经 M5 生成 `cad.sketch({contours})` 真实面变量，Pad/Pocket/Extrusion/Revolution 接 `cad.extrude`/`cad.revolve` | **已落地**（commit 8e782e6） |
| M6.1 | 元素引用边锚点：`cad.edgeRef(shape, N)` 按内核枚举序（`getSubShapes(solid,'edge')` == 同用 TopExp::MapShapes 的 `wireframe()` == FreeCAD `EdgeN`）解析成 `EdgeTopoRef` | **已落地**（`api/edge-ref.ts`；Fillet/Chamfer 已接线） |
| M6.2 | 表达式降级：`<ExpressionEngine>` → JS 常量 / `const`（前文 A R4） | 已实现（`expressions.ts`） |
| M6.3 | **解锁 M3 的外部几何**（D4）→ L2 转 L0 | 锚点研究就绪（`external-geo.test.ts` GOTCHA：wireframe edgeGroups[k] == FreeCAD "Edge(k+1)"），未全量解锁 |

**出口判据**：样本集上圆角选边、`UpToFace` 引用不再错位。

---

## 8. 验收判据

| 编号 | 判据 | 阶段 | 量化标准 |
|---|---|---|---|
| V1 | 容器保真 | M2 | `freecad/` 每个成员 sha256 全等；成员集合与原 ZIP 条目集合完全一致 |
| V2 | **草图求解正确性** | M3 | 对样本集中每个草图（35 个文件 / 126 个 SketchObject / 1,539 条约束）：重解几何与落盘几何的**逐控制点距离最大值** < 容差 T1；未达标则记 L1 降级。**L0 占比**作为 M3 的核心指标，首轮目标 ≥ 80% |
| V3 | 零静默丢失 | M2/M3/M4 | `mapping.json` 中每个 `<ObjectData>` 对象都有归属（`translated`/`baked`/`preserved-only`），三者必居其一 |
| V4 | 可还原 | M2 | 由 `freecad/` 重打的包能被 FreeCAD 打开（人工抽样 ≥ 3 个样本） |
| V5 | 翻译覆盖 | M4 | `可翻译对象数 / 建模对象总数`；回退集 100% 有 `assets/` 产物 + `mapping.json` 记录 |
| V6 | 几何保真 | M5 | faijs 重算结果与原 BREP 比对：体积相对误差、质心距离、bbox 对角偏差、采样点 Hausdorff 落在容差内 |
| V7 | 脚本可执行 | M5 | 产出的 `.fai.js` 通过 `npx tsx packages/core/scripts/faijs-cli.ts check` |

**关于 V2 的容差 T1**：不预设数值。样本集已就绪（§5.5），M3 的**第一个任务**就是用「重解 vs 落盘」的实测分布标定 T1——正常情况下两者应收敛到同一解，T1 取分布尾部之外的合理值。**标定先于实现，不是最后一步。**

**关于 V5 的覆盖率预期**：受 R4' 制约（Python 对象占比过高），覆盖率天然存在天花板。V5 应分两个口径统计：① 全量对象覆盖率（会偏低，如实记录）；② **非 Python 建模对象的覆盖率**（这才是 M4 的真实成效指标）。

---

## 9. 风险登记

| 编号 | 风险 | 影响 | 对策 | 状态 |
|---|---|---|---|---|
| R1 | LGPL 合规 | 低 | 作为未修改 npm 依赖使用，不重编译、不内联；附 `THIRD-PARTY-NOTICES`（D6） | **已降级**（C2） |
| R2 | planegcs WASM 版本落后于 26.3.0-dev，约束语义可能已变 | 中 | M0.4 差异比对；`SketchSolver` 接口隔离（D5） | M0 兑现 |
| R3 | 第三方维护中断 | 低 | 接口隔离 + 路线 B 备选（前文 B §4 证明可自编译） | 已缓解 |
| R4 | ~~无真实 `.FCStd` 样本~~ | ~~高~~ | — | **已解除**：仓库自带 56 个样本，含 1,539 条约束（§5.5）。前文 A §11 第 1 条作废 |
| R4' | **Python 对象占比过高**：`<Python>` 935 个、`*FeaturePython` 系约 874 个对象，全部只能烘焙 | **高**（压低 V5 覆盖率上限） | 如实设定 V5 目标值；考虑 M4 增加 Draft/Arch 常用 Python 类型的**属性级**翻译（不依赖 Python 运行时）作为后续扩展 | 新增 |
| R4'' | **表达式数量超预期**：`<ExpressionEngine>` 1,709 个 | 中 | M6.2 需提前评估：是否在 M4 就做最简降级（常量化），否则大量特征因依赖表达式而回退 | 新增 |
| R5 | 外部几何需 OCCT 投影 | 中 | D4：M3 阶段整草图降级 L2，M6.3 解锁 | 已规划 |
| R6 | 双链路：草图轮廓必须在 mesh 链也可用 | 中 | `Blueprint` 不依赖 OCCT（前文 B §6）；照 `api/svgExtrude.ts` 的 dual-op 范式实现 | M4.6 |
| R7 | `revolve` 已挂 `cad` 脚本面（commit 8e782e6）；`sweep` 样本为 0，暂不强求 | 低 | 实测 `PartDesign::Revolution` **17 个** > `Chamfer`(7)+`Fillet`(5)；revolve 已在 M4 同批挂上。sweep 无样本 | 已解决（revolve）/ 搁置（sweep，零样本） |
| R8 | 单位走样（D7） | 低 | M2.4 归一 + `mapping.json` 记录 | 已规划 |
| R9 | 数值求解收敛到错误分支 | 中 | D2 用落盘几何作初值 + V2 比对；不通过即降级 L1 | 已规划 |

---

## 10. 里程碑顺序与并行关系

```
M0（探针，1–2 天）
 └─ M1（解包 + 样本筛选）── M2（容器）─────────┐
                                              ├─ M5（代码生成）── M6（锚点/表达式）
                        ┌── M3（草图求解）────┘
                        └── M4（特征翻译）────┘
          ▲                    ▲
       M3 必须在 M0 之后     M3 与 M4 可并行
```

- **M0 是 M3 的硬前置**（前文 B §9.2）。
- **M3 与 M4 并行**，交汇于 M5。
- 任一里程碑中止，已有产物仍可用（M2 后即有完整 `.fai.zip`，只是不可编辑）。

---

## 11. 待定项（需用户拍板）

1. **R7 / 前文 A G2**：`revolve` / `sweep` 是否在 M4 同批挂上 `cad` 脚本面？ **（已拍板：挂 —— revolve 已落地 commit 8e782e6；sweep 零样本搁置）**
   - 挂：草图能覆盖 Revolution / Groove，翻译覆盖率显著提升，但扩大 M4 范围。
   - 不挂：这些特征全部回退烘焙，M4 范围收窄。
   - **本计划默认「挂」**，因为草图做出来了却只能拉伸，投入产出比不划算。
   - **实测数据支持「挂」**：`PartDesign::Revolution` 17 个 > `Chamfer`(7) + `Fillet`(5) 之和（§5.5.5）。

2. ~~**样本集来源**~~ —— **已解决**：仓库自带 56 个样本，覆盖 0.15（2015）至 1.2（2026），含 1,539 条约束、786 个草图几何（§5.5）。原「测试文件是玩具样例」的担忧不成立——`PartDesignExample`、`EngineBlock`、`TestTangentMode3`、`InvoluteGear` 等都是真实复杂度的零件。**真实机械零件样本仍欢迎，但作为补充而非前提。**

3. **`.fai.zip` 入口启发式**：前文 A §11 第 5 条未实测 `zip-loader.ts` 是否命中 `model/main.fai.js`。M5.4 需实测，若未命中则在 `manifest.json` 显式写 `entry`。

4. **R4' 的应对**：Python 对象占样本绝大多数（`<Python>` 935 个），只能烘焙。是否在 M4 之外单开一个「Draft/Arch 常用 Python 类型的属性级翻译」子项？这需要按类型逐个摸清属性语义，成本不低。**建议先跑完 M4 拿到真实覆盖率数字再决定。**

---

## 12. 实施纪律（继承 AGENTS.md 与既有约定）

- **禁止静默降级**：任何降级必须写进 `mapping.json` 的 `reason`（前文 A R7）。
- **未验证的启发式回滚为显式抛错**：这是本项目在 occt-wasm 移植中反复验证过的纪律（见 `.workbuddy/memory/MEMORY.md`）。
- **容差只写一处**：几何比对容差集中在 `src/testing/compare.ts`（既有约定），不散落。
- **测试与文档同 PR**：每阶段出口带测试 + Agent Note。
- **串行跑后台任务**：构建/测试/比对严禁并行（用户全局铁律）。
