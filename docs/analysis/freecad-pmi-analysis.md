# FreeCAD PMI（产品制造信息）源码分析

> 分析对象：FreeCAD 源码（`C:\git\F-cad\FreeCAD`）
> 分析日期：2026-10-31

---

## 0. 用户原始需求

> 「分析 C:\git\F-cad\FreeCAD 的源代码，分析它是如何编辑和处理 PMI 信息的，如何导出 PMI 信息的。导出 fcstd 和 step 文件中，PMI 信息都是如何处理的。」

---

## 1. 结论概要

**FreeCAD 当前不具备完整的 PMI（Product Manufacturing Information）系统。** PMI 在 FreeCAD 中以**碎片化**的方式存在：

| 层面 | 现状 | 说明 |
|------|------|------|
| 3D 模型上的 PMI | **完全缺失** | 无 3D 标注、无特征控制框、无基准符号 |
| 2D 图纸上的尺寸/公差 | **TechDraw 工作台** | 仅存在于 2D 图纸层面，不回写 3D 模型 |
| STEP 导入的 PMI | **不处理** | ImportOCAF2 不读取 XCAFDoc_Dimension / XCAFDoc_GeomTolerance |
| STEP 导出的 PMI | **不写入** | ExportOCAF2 / WriterStep 仅处理形状、颜色、装配 |
| FCStd 文件中的标注 | **XML 属性序列化** | TechDraw 尺寸对象作为 DocumentObject 序列化到 Document.xml |
| GD&T 符号 | **文本拼凑** | 通过 Unicode 字符插入格式字符串，无独立 FCF 对象 |

---

## 2. PMI 数据模型：TechDraw 尺寸系统

### 2.1 核心数据结构

FreeCAD 的"PMI"全部封装在 TechDraw 工作台的 `DrawViewDimension` 对象中。

**关键文件**：`src/Mod/TechDraw/App/DrawViewDimension.h`

```
DrawViewDimension : public DrawView
├── References2D    (PropertyLinkSubList)  → 指向投影后的 2D 子特征
├── References3D    (PropertyLinkSubList)  → 指向 3D 几何子特征
├── Type            (PropertyEnumeration)  → Distance / DistanceX / DistanceY / DistanceZ /
│                                            Radius / Diameter / Angle / Angle3Pt
├── TheoreticalExact (PropertyBool)        → 理论精确尺寸（框格显示，无公差）
├── EqualTolerance   (PropertyBool)        → 对称公差 ±T
├── OverTolerance    (PropertyQuantityConstraint) → 上偏差
├── UnderTolerance   (PropertyQuantityConstraint) → 下偏差
├── Arbitrary        (PropertyBool)        → 用户自定义文本覆盖
├── ArbitraryTolerances (PropertyBool)     → 用户自定义公差文本
├── FormatSpec       (PropertyString)      → 主值格式规格（如 "%.2w"）
├── FormatSpecOverTolerance (PropertyString) → 上偏差格式规格
├── FormatSpecUnderTolerance (PropertyString) → 下偏差格式规格
├── Inverted         (PropertyBool)        → 反向标注
├── ShowSupplementary (PropertyBool)       → 显示补角
├── AngleOverride    (PropertyBool)        → 角度标注方向覆盖
├── LineAngle        (PropertyAngle)       → 尺寸线角度
├── ExtensionAngle   (PropertyAngle)       → 延伸线角度
└── ShowUnits        (PropertyBool)        → 显示单位
```

### 2.2 尺寸类型

| DimensionType | 说明 | 引用类型要求 |
|---|---|---|
| `Distance` | 两点间真实距离 | oneEdge / twoEdge / twoVertex / vertexEdge |
| `DistanceX` | X 方向投影距离 | 同上 |
| `DistanceY` | Y 方向投影距离 | 同上 |
| `DistanceZ` | Z 方向投影距离 | 同上 |
| `Radius` | 半径 | arc（圆弧/圆边） |
| `Diameter` | 直径 | arc |
| `Angle` | 两边夹角 | twoEdge |
| `Angle3Pt` | 三点角 | threeVertex |

### 2.3 公差处理机制

**关键设计原则：名义值动态、公差值静态。**

- **名义值（Nominal Value）**：每次 `execute()` 调用时从 3D 几何重算（`getDimValue()` → `measurement->length()` 或读取几何点坐标）
- **上下偏差（OverTolerance / UnderTolerance）**：用户手工输入，`execute()` 从不修改

代码证据（`DrawViewDimension.cpp`）：

```cpp
// execute() 中只重算几何点（m_linearPoints / m_arcPoints / m_anglePoints），
// 从不触碰 OverTolerance / UnderTolerance
App::DocumentObjectExecReturn* DrawViewDimension::execute() {
    // ...
    if (Type.isValue("Distance") || ...) {
        m_linearPoints = getPointsOneEdge(references);  // 从 3D 几何重算
    }
    // 公差属性完全不被 execute() 触及
    return DrawView::execute();
}
```

### 2.4 格式化引擎

**关键文件**：`src/Mod/TechDraw/App/DimensionFormatter.h / .cpp`

`DimensionFormatter` 负责将数值按格式规格渲染为显示字符串：

- `%w` — 自定义格式符：数值不保留尾零（FreeCAD 扩展）
- `%r` — 自定义格式符：按精度舍入（FreeCAD 扩展）
- 标准格式符：`%f`、`%.2f` 等

公差显示逻辑：
- `EqualTolerance = true` → 显示 `值 ±T`
- `EqualTolerance = false` → 显示 `值 +上偏差 / -下偏差`
- `TheoreticalExact = true` → 框格显示 `值`（无公差）
- `Arbitrary = true` → 直接显示 `FormatSpec` 文本

### 2.5 GD&T 符号

**关键文件**：`src/Mod/TechDraw/Gui/TaskCustomizeFormat.h / .cpp`

GD&T 符号不是独立的图形对象，而是通过 Unicode 字符插入到尺寸格式字符串中：

| 公差类型 | 符号 | Unicode |
|---|---|---|
| 直线度 | ⏤ | U+23E4 |
| 平面度 | ⏥ | U+23E5 |
| 圆度 | ○ | U+25CB |
| 圆柱度 | ⌭ | U+232D |
| 平行度 | ∥ | U+2225 |
| 垂直度 | ⊥ | U+22A5 |
| 倾斜度 | ∠ | U+2220 |
| 位置度 | ⌖ | U+2316 |
| 同轴度 | ◎ | U+25CE |
| 对称度 | ‖ | U+2016 |
| 圆跳动 | ↗ | U+2197 |
| 全跳动 | ↗↗ | — |
| MMC | Ⓜ | U+24C2 |
| LMC | Ⓛ | U+24C1 |

符号资源：
- `src/Mod/TechDraw/Symbols/gd-and-t/` — 20 个 SVG 特征控制框符号
- `src/Mod/TechDraw/Gui/Resources/ToleranceSymbols/` — 17 个 SVG 公差符号图标

**关键局限**：没有独立的 Feature Control Frame（FCF）对象。商业 CAD 中 FCF 是独立的标注实体，有自己的属性和引用关系；FreeCAD 中 FCF 只是拼在尺寸文本里的 Unicode 字符串。

---

## 3. 编辑 PMI：用户交互流程

### 3.1 创建尺寸标注

```
用户在 TechDraw 图纸上选择几何边/顶点
    ↓
Command 创建 DrawViewDimension 对象
    ↓
DrawViewDimension::execute()
    ├── 从 References2D/References3D 读取引用几何
    ├── getDimValue() 从 3D 几何计算名义值
    ├── 几何点保存到 m_linearPoints/m_arcPoints/m_anglePoints
    └── 触发重绘
    ↓
ViewProviderDimension 更新图形项 (QGIViewDimension)
    └── QGIDatumLabel 渲染：名义值 + 公差文本
```

### 3.2 编辑公差

```
用户双击尺寸 → TaskDimension 对话框
    ├── 设置 OverTolerance / UnderTolerance
    ├── 切换 EqualTolerance / TheoreticalExact
    ├── 编辑 FormatSpec（格式规格）
    └── 可选：TaskCustomizeFormat 插入 GD&T 符号到 FormatSpec
    ↓
属性写入 DrawViewDimension 对象
    ↓
DimensionFormatter 重新格式化显示文本
```

### 3.3 ISO 286 配合公差工具

**关键文件**：`src/Mod/TechDraw/TechDrawTools/CommandHoleShaftFit.py / TaskHoleShaftFit.py`

这是一个纯 2D 层面的查表工具，与 3D 模型无关：

1. 用户选中 TechDraw 尺寸 → 弹出配合对话框
2. 选择配合类型（如 H7/h6）
3. `ISO286` 类查表计算上下偏差：
   - `getNominalRange()` — 确定名义尺寸范围段（0–500mm，25 段）
   - `getFieldValue()` — 查基本偏差表（17 字母 × 25 段）
   - `getITValue()` — 查公差等级表（IT6–IT11 × 25 段）
4. 结果直接写入 TechDraw 尺寸对象的 `OverTolerance` / `UnderTolerance`
5. **不回写 3D 模型**

---

## 4. FCStd 文件中的 PMI 处理

### 4.1 FCStd 文件格式

FCStd 是 ZIP 压缩包，核心内容为 `Document.xml`（XML 格式的文档序列化）。

**保存机制**（`src/App/Document.cpp`）：

```cpp
bool Document::saveToFile(const char* filename) const {
    Base::ZipWriter writer(file);
    writer.putNextEntry("Document.xml");
    writer.Stream() << "<?xml version='1.0' encoding='utf-8'?>" << '\n';
    Document::Save(writer);         // 序列化所有 DocumentObject
    signalSaveDocument(writer);     // Gui 信号（GuiDocument.xml）
    writer.writeFiles();            // 附加文件（如 brep 几何）
}
```

### 4.2 DrawViewDimension 在 FCStd 中的序列化

每个 `DrawViewDimension` 作为 `DocumentObject` 被序列化到 `Document.xml`，其全部属性以 XML 标签保存：

```xml
<Object name="Dimension001" type="TechDraw::DrawViewDimension">
  <Property name="Type" type="App::PropertyEnumeration">
    <Enumeration value="Distance"/>
  </Property>
  <Property name="References2D" type="App::PropertyLinkSubList">
    <Link object="View001" sub="Edge1"/>
  </Property>
  <Property name="References3D" type="App::PropertyLinkSubList">
    <Link object="Body001" sub="Edge3"/>
  </Property>
  <Property name="OverTolerance" type="App::PropertyQuantityConstraint">
    <Float value="0.021"/>
  </Property>
  <Property name="UnderTolerance" type="App::PropertyQuantityConstraint">
    <Float value="0.000"/>
  </Property>
  <Property name="EqualTolerance" type="App::PropertyBool">
    <Bool value="false"/>
  </Property>
  <Property name="FormatSpec" type="App::PropertyString">
    <String value="%.2w H7"/>
  </Property>
  <!-- ... 其他属性 ... -->
</Object>
```

### 4.3 3D 几何引用机制

`References3D`（`PropertyLinkSubList`）保存对 3D 模型子特征的引用：

- **对象引用**：指向 Part/PartDesign 对象（如 `Body001`）
- **子元素引用**：如 `Edge3`、`Vertex1`、`Face2`

加载时：
1. `Document::Restore()` 从 XML 重建所有对象
2. `DrawViewDimension::Restore()` 恢复属性
3. `execute()` 被触发 → 从 `References3D` 读取 3D 几何 → 重算名义值

### 4.4 FCStd PMI 的关键特征

| 特征 | 说明 |
|---|---|
| **2D 专属** | PMI 数据仅存在于 TechDraw 的 2D 图纸层面 |
| **XML 序列化** | 作为 DocumentObject 属性写入 Document.xml |
| **引用关联** | References3D 指向 3D 模型子特征（边/顶点/面） |
| **名义值动态** | 加载后从 3D 几何重算，不存储硬编码值 |
| **公差值静态** | 存储为属性值，不随几何变化自动更新 |
| **无 PMI 独立层** | 标注不是 3D 模型的属性，是独立的 2D DocumentObject |

---

## 5. STEP 文件中的 PMI 处理

### 5.1 STEP 导出链路

```
Document → ExportOCAF2 → TDocStd_Document → WriterStep → STEPCAFControl_Writer → STEP 文件
```

**关键文件**：
- `src/Mod/Import/App/ExportOCAF2.cpp` — 构建 OCAF 文档（形状 + 颜色 + 装配）
- `src/Mod/Import/App/WriterStep.cpp` — 调用 OCCT STEPCAFControl_Writer 写入 STEP

### 5.2 导出时 PMI 的处理：不写入

**ExportOCAF2** 负责：
- 形状写入（`XCAFDoc_ShapeTool::AddShape`）
- 颜色写入（`XCAFDoc_ColorTool::SetColor`）
- 装配结构（`XCAFDoc_ShapeTool::AddComponent`）
- 名称写入（`TDataStd_Name::Set`）

**完全不处理**：
- ❌ `XCAFDoc_DimTolTool`（OCCT 的 PMI 工具，FreeCAD 从未调用）
- ❌ `XCAFDoc_Dimension`（尺寸标注）
- ❌ `XCAFDoc_GeomTolerance`（几何公差）
- ❌ `XCAFDoc_Datum`（基准）

**WriterStep** 负责：
- 调用 `STEPCAFControl_Writer::Transfer(hDoc, STEPControl_AsIs)`
- 设置文件头（作者、公司、程序名、描述）
- 写入文件

代码证据（`WriterStep.cpp`）：

```cpp
void WriterStep::write(Handle(TDocStd_Document) hDoc) const {
    STEPCAFControl_Writer writer;
    writer.Transfer(hDoc, STEPControl_AsIs);  // 仅写形状/颜色/装配
    // 无任何 PMI 写入代码
    APIHeaderSection_MakeHeader makeHeader(writer.ChangeWriter().Model());
    makeHeader.SetAuthorValue(1, ...);
    makeHeader.SetOrganizationValue(1, ...);
    makeHeader.SetOriginatingSystem(...);
    makeHeader.SetDescriptionValue(1, "FreeCAD Model");
    writer.Write(name8bit.c_str());
}
```

全仓搜索 `XCAFDoc_DimTolTool`、`XCAFDoc_Dimension`、`XCAFDoc_GeomTolerance`、`XCAFDoc_Datum` — **零结果**。FreeCAD 从未调用 OCCT 的 PMI 写入接口。

### 5.3 STEP 导入时 PMI 的处理：不读取

**导入链路**：

```
STEP 文件 → ReaderStep → STEPCAFControl_Reader → TDocStd_Document → ImportOCAF2 → Document
```

**ReaderStep**（`src/Mod/Import/App/ReaderStep.cpp`）：

```cpp
void ReaderStep::read(Handle(TDocStd_Document) hDoc) {
    STEPCAFControl_Reader aReader;
    aReader.SetColorMode(true);
    aReader.SetNameMode(true);
    aReader.SetLayerMode(true);
    aReader.SetSHUOMode(true);
    // 无 SetDimTolMode / SetMatTolMode 调用
    aReader.ReadFile(name8bit.c_str());
    aReader.Transfer(hDoc);
}
```

**ImportOCAF2** 负责：
- 从 OCAF 文档读取形状（`XCAFDoc_ShapeTool`）
- 读取颜色（`XCAFDoc_ColorTool`）
- 读取装配结构
- 读取 SHUO（Styled User Object）

**完全不处理**：
- ❌ `XCAFDoc_DimTolTool::GetDimTols()` — 不调用
- ❌ PMI 标注实体 — 不解析
- ❌ Annotation 平面 — 不解析

### 5.4 STEP AP 版本支持

FreeCAD 的 STEP 导出支持以下 AP 版本（`DlgExportStep.ui`）：

| AP 版本 | PMI 支持 | FreeCAD 状态 |
|---|---|---|
| AP203 | 无 PMI | 支持（无 PMI 问题） |
| AP214 CD | 无 PMI | 支持 |
| AP214 DIS | 无 PMI | 支持 |
| AP214 IS | 无 PMI | 支持 |
| AP242 DIS | **有 PMI**（semantic PMI） | 支持版本号但**不写入 PMI** |

即使选择 AP242 DIS 导出，FreeCAD 也只写形状+颜色+装配，不写任何 PMI 实体。

### 5.5 ImportStep.cpp 中的 PMI 痕迹

`src/Mod/Part/App/ImportStep.cpp` 中有两处 PMI 相关的 include：

```cpp
#include <StepElement_AnalysisItemWithinRepresentation.hxx>
#include <StepVisual_AnnotationCurveOccurrence.hxx>
```

但这只是**链接器占位**（强制链接 TKSTEPBase / TKSTEPAttr），实际代码中从未使用这些类型：

```cpp
// Use this to force to link against TKSTEPBase, TKSTEPAttr and TKStep209
// in order to make RUNPATH working on Linux
StepElement_AnalysisItemWithinRepresentation stepElement;
StepVisual_AnnotationCurveOccurrence stepVis;
```

---

## 6. TechDraw → 3D 模型的关联（现状与缺口）

### 6.1 现有关联：References3D

`DrawViewDimension.References3D` 可以指向 3D 模型的子特征：

```
3D 模型 (Part::Feature / PartDesign::Body)
    │ 用户选择边/顶点/面
    ↓
TechDraw 尺寸 (DrawViewDimension)
    ├── References3D = [(Body001, "Edge3")]
    ├── 名义值 = 从 References3D 的 3D 几何动态重算
    └── 公差值 = 用户手动输入（不来自 3D 模型）
```

### 6.2 缺失：3D → TechDraw 自动传递

```
3D 模型 ← (无公差属性) → 不能自动传递到 TechDraw
```

| 3D 对象 | 是否有公差信息 | 能否传递到 TechDraw |
|---|---|---|
| Part::Feature | ❌ 无 | — |
| PartDesign::Body | ❌ 无 | — |
| PartDesign::Hole (螺纹孔) | 有 ThreadClass（如 6H/6g） | ❌ 仅用于螺纹几何计算，不暴露 |
| TechDraw 尺寸 | ✅ 有 OverTolerance/UnderTolerance | 仅手动或 Hole/Shaft Fit 工具 |

### 6.3 缺失：STEP AP242 PMI 往返

STEP AP242 定义了 semantic PMI 实体（`DIMENSIONAL_LOCATION`、`GEOMETRIC_TOLERANCE`、`DATUM_FEATURE`），但 FreeCAD：

- **导入**：不读取这些实体（ImportOCAF2 不调用 `XCAFDoc_DimTolTool`）
- **导出**：不写入这些实体（ExportOCAF2 不调用 `XCAFDoc_DimTolTool`）

---

## 7. FreeCAD PMI 架构总览图

```
┌─────────────────────────────────────────────────────────┐
│                    FreeCAD Document                      │
│  ┌─────────────────┐    ┌─────────────────────────┐    │
│  │   3D 模型层      │    │   TechDraw 2D 图纸层     │    │
│  │  (Part/PartDesign)│    │  (DrawViewDimension)    │    │
│  │                  │    │                         │    │
│  │  ❌ 无公差属性    │    │  ✅ OverTolerance       │    │
│  │  ❌ 无 GD&T      │    │  ✅ UnderTolerance      │    │
│  │  ❌ 无基准符号    │    │  ✅ FormatSpec          │    │
│  │                  │    │  ✅ GD&T Unicode 符号    │    │
│  │                  │←───│  References3D (单向引用) │    │
│  │                  │    │  名义值动态重算          │    │
│  │                  │    │  公差值静态存储          │    │
│  └────────┬─────────┘    └───────────┬─────────────┘    │
│           │                          │                   │
└───────────┼──────────────────────────┼───────────────────┘
            │                          │
    ┌───────▼────────┐         ┌──────▼──────────┐
    │  STEP 导出      │         │  FCStd 保存      │
    │  (ExportOCAF2)  │         │  (Document.xml)  │
    │                 │         │                  │
    │  ❌ 不写 PMI    │         │  ✅ 尺寸对象     │
    │  ✅ 写形状/颜色  │         │     XML 序列化   │
    │  ✅ 写装配      │         │  ✅ 公差属性     │
    │                 │         │  ✅ 引用关系     │
    │  AP242DIS:      │         │                  │
    │  版本号支持但   │         │                  │
    │  不写 PMI 实体   │         │                  │
    └─────────────────┘         └──────────────────┘

    ┌───────┐
    │ STEP  │
    │ 导入   │
    │       │
    │ ❌ 不读│
    │  PMI  │
    │ ✅ 读 │
    │ 形状  │
    └───────┘
```

---

## 8. 关键文件索引

### TechDraw（App 层 — 数据模型）

| 文件 | 说明 |
|---|---|
| `src/Mod/TechDraw/App/DrawViewDimension.h` | 尺寸数据模型，全部公差属性声明 |
| `src/Mod/TechDraw/App/DrawViewDimension.cpp` | 公差管理、引用解析、名义值重算 |
| `src/Mod/TechDraw/App/DimensionFormatter.h` | 格式化引擎接口 |
| `src/Mod/TechDraw/App/DimensionFormatter.cpp` | 格式规格解析、`%w`/`%r` 扩展、公差文本格式化 |
| `src/Mod/TechDraw/App/DrawDimHelper.h` | 尺寸辅助工具 |
| `src/Mod/TechDraw/App/DrawViewAnnotation.h` | 文本标注对象（非尺寸标注） |

### TechDraw（Gui 层 — 编辑/渲染）

| 文件 | 说明 |
|---|---|
| `src/Mod/TechDraw/Gui/QGIDatumLabel.h/.cpp` | 尺寸+公差文本图形项渲染 |
| `src/Mod/TechDraw/Gui/QGIViewDimension.h/.cpp` | 尺寸视图项管理 |
| `src/Mod/TechDraw/Gui/ViewProviderDimension.h/.cpp` | 视图提供者，响应属性变化 |
| `src/Mod/TechDraw/Gui/TaskDimension.h/.cpp` | 尺寸编辑对话框 |
| `src/Mod/TechDraw/Gui/TaskCustomizeFormat.h/.cpp` | GD&T 符号选择器 |

### TechDraw（符号资源）

| 目录 | 说明 |
|---|---|
| `src/Mod/TechDraw/Symbols/gd-and-t/` | 20 个 FCF SVG 符号 |
| `src/Mod/TechDraw/Gui/Resources/ToleranceSymbols/` | 17 个公差符号 SVG 图标 |

### TechDraw Tools

| 文件 | 说明 |
|---|---|
| `src/Mod/TechDraw/TechDrawTools/CommandHoleShaftFit.py` | ISO 286 配合公差命令 |
| `src/Mod/TechDraw/TechDrawTools/TaskHoleShaftFit.py` | ISO 286 对话框 + `ISO286` 查表类 |

### Import/Export（OCAF 层）

| 文件 | 说明 |
|---|---|
| `src/Mod/Import/App/ExportOCAF2.cpp` | OCAF 文档构建（形状/颜色/装配，**无 PMI**） |
| `src/Mod/Import/App/ImportOCAF2.cpp` | OCAF 文档读取（形状/颜色/装配，**无 PMI**） |
| `src/Mod/Import/App/WriterStep.cpp` | STEP 写入（STEPCAFControl_Writer，**无 PMI**） |
| `src/Mod/Import/App/ReaderStep.cpp` | STEP 读取（STEPCAFControl_Reader，**无 PMI**） |

### Part（STEP 导入旧路径）

| 文件 | 说明 |
|---|---|
| `src/Mod/Part/App/ImportStep.cpp` | 旧 STEP 导入（已废弃，PMI include 仅作链接器占位） |
| `src/Mod/Part/Gui/DlgExportStep.ui` | STEP 导出设置对话框（AP203–AP242DIS，无 PMI 选项） |
| `src/Mod/Part/Gui/DlgExportStep.cpp` | STEP 导出设置逻辑 |

### FCStd 文件格式

| 文件 | 说明 |
|---|---|
| `src/App/Document.cpp` | Document 保存/加载（ZipWriter + XML） |
| `src/App/ProjectFile.h` | FCStd 文件读取接口 |

---

## 9. 如果 FreeCAD 要实现完整的 PMI 系统

基于源码分析，需要以下改造：

1. **Part 层增加 PMI 属性系统**：在 `Part::Feature` 上挂载公差属性（或创建独立的 `Part::PMIAnnotation` 对象）
2. **ExportOCAF2 增加 PMI 写入**：调用 `XCAFDoc_DimTolTool::SetDimension()` / `SetGeomTolerance()` / `SetDatum()`
3. **ImportOCAF2 增加 PMI 读取**：调用 `XCAFDoc_DimTolTool::GetDimTols()` 并还原为 PMI 对象
4. **DrawViewDimension::execute() 扩展**：从 `References3D` 关联的 3D PMI 属性自动读取公差
5. **STEP AP242 升级**：从 AP242DIS 升级到 AP242 Edition 2/3（完整 semantic PMI 支持）
6. **3D 视图增加 PMI 显示**：在 3D viewport 中渲染特征控制框、基准符号（当前完全缺失）
