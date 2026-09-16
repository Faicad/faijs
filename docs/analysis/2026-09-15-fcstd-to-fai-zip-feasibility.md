# FCStd → `.fai.zip` 转换可行性技术调研

> 日期：2026-09-15
> 分析对象：`D:\Faicad\FreeCAD`（`version.json` → 26.3.0-dev）与 `D:\Faicad\faijs`
> 状态：调研结论，未实施

---

## 1. 用户原始要求（原文引用）

> 请分析D:\Faicad\FreeCAD的源代码，了解其fcstd文件格式。然后，我想把它进行格式转换，其中的参数化建模部分替换为faijs代码，文档中的其他内容不变。新的文件格式后缀名定为.fai.zip。请分析这个想法的可行性，写一份技术调研文档。(PS:是单向转换。faijs的能力要强大的多。)

拆解为四条约束：

| 编号 | 约束 |
|---|---|
| C1 | 从 FreeCAD 源码出发搞清楚 FCStd 的真实结构（不接受二手描述） |
| C2 | 做**格式转换**，不是做阅读器 |
| C3 | 只替换「参数化建模部分」，文档里的**其他内容不变** |
| C4 | 新容器后缀为 `.fai.zip` |

---

## 2. 结论摘要

**总体判定：可行，但必须接受「部分保真 + 显式回退」，不能承诺无损等价。**

| 层面 | 判定 | 依据 |
|---|---|---|
| 容器层（ZIP 解包/重打包、非建模成员原样保留） | **完全可行，成本低** | FCStd 就是标准 ZIP（§3.1），成员可逐字节搬运 |
| 保留层（Gui、元数据、缩略图、外部文件） | **完全可行** | 这些成员与建模无关，无需理解语义即可搬运（§3.7） |
| 语义层（参数化建模 → faijs 代码） | **部分可行**，覆盖率取决于特征种类 | faijs 无草图约束求解器、无特征树、无表达式引擎（§5.3） |
| 往返层（`.fai.zip` 能被 FreeCAD 打开） | **不可行** | FCStd 保存链路硬编码在 C++，无 Python 接管点（§3.8） |

三条硬结论：

1. `.fai.zip` 应当定位为 **faijs 原生格式 + FCStd 原文影子备份**，而不是「FCStd 的另一种编码」。FreeCAD 侧无法在不改 C++ 的前提下认识它（§3.8），因此转换天然是**单向**的。
2. 最大的技术缺口是 **Sketcher 的二维几何约束求解器**。FreeCAD 用 `planeGCS`（`src/3rdParty/planegcs`）求解；faijs 侧的 `solveConstraints`（`packages/core/src/vendored/brepjs/kernel/solverAdapter.ts:307`）是**装配位姿求解器**（3D 刚体），不是 2D 草图求解器，两者不可互换（§5.3 G1）。
3. 必须设计**烘焙回退通道**：任何翻译不了的对象，其几何以 STEP/BREP 资产形式进 `.fai.zip`，并在 `mapping.json` 里记明原因，**禁止静默丢弃**（§7 R7）。

---

## 3. FCStd 文件格式剖析（基于源码）

### 3.1 物理容器：标准 ZIP，无 mimetype

`Document::save`（`src/App/Document.cpp:2035` 起）用 `Base::ZipWriter`（封装 `zipios`，第三方库在 `src/3rdParty/zipios++/`）写出：

```cpp
Base::ZipWriter writer(file);          // Document.cpp:2036
writer.setComment("FreeCAD Document"); // :2040
writer.setLevel(compression);          // :2041
writer.putNextEntry("Document.xml");   // :2042
if (hGrp->GetBool("SaveBinaryBrep", false)) writer.setMode("BinaryBrep"); // :2044-2046
...
Document::Save(writer);                // :2052
signalSaveDocument(writer);            // :2056  ← Gui 侧挂在这里写 GuiDocument.xml
writer.writeFiles();                   // :2059  ← 遍历 FileList，各对象 SaveDocFile
```

读取侧（`Document.cpp:2185-2192`）：先判 `size < 22`（空 ZIP 长度）抛 `Invalid project file`，再用 `zipios::ZipInputStream` + `Base::XMLReader` 解析。

识别方式：按扩展名 `fcstd` / `fcbak` / `std`（`src/App/Application.cpp:3104`）。
**ZIP 内没有 mimetype 成员**（全仓未检索到 `FC-Standard` 字面量；此结论为穷尽检索后的否定判断，非逐行证明）。

> **2026-09-15 实测订正**：ZIP 注释 `FreeCAD Document` **不能作为校验依据**——仓库自带 56 个样本中有 2 个（`data/tests/ProjectTest.FCStd`、`tests/src/Mod/PartDesign/App/TestModels/TwoLengthsPadWithExpression.FCStd`）注释为空字符串。可靠的唯一判据是「根目录下存在 `Document.xml`」。详见 `docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md` §5.5.6。

### 3.2 典型成员清单

| 成员 | 写出位置 | 性质 |
|---|---|---|
| `Document.xml` | `Document.cpp:2042` | 建模数据主体 |
| `GuiDocument.xml` | `src/Gui/Document.cpp:1921`（经 `signalSaveDocument`） | 显示数据 |
| `thumbnails/Thumbnail.png` | `src/Gui/Thumbnail.cpp:82`；读取在 `:135` | 预览图 |
| `<ObjectName>.Shape.brp` 或 `.bin` | `src/Mod/Part/App/PropertyTopoShape.cpp:393` | 形状（BREP 文本 / 二进制） |
| `<ObjectName>.Shape.Table` | `PropertyTopoShape.cpp:409`（`Hasher->setPersistenceFileName`） | 字符串哈希器持久化 |
| `<ObjectName>.Shape.Map` | `PropertyTopoShape.cpp:418`（`setPersistenceFileName`） | **元素映射表（拓扑命名）** |
| 被包含文件（STEP、图片…） | `src/App/DocumentObjectFileIncluded.cpp` | `PropertyFileIncluded` 注入 |
| `*.iv` | `src/Gui/ViewProvider.cpp:615` 附近（`SoFCDB::writeNodesToString`） | Coin3D 节点（少数 ViewProvider 用） |

文件名由 `Property::getFileName(postfix, prefix)`（`src/App/Property.cpp:94`）按属性全名拼后缀生成，重名经 `Writer::addFile` 的 `FileNameManager.makeUniqueName` 去重（`src/Base/Writer.cpp:302-304`）。

> **2026-09-15 实测验证**：对仓库自带 56 个 `.FCStd`/`.fcbak` 全量解包，解包失败 0 个；ZIP 成员合计 5,679 个（其中 `.brp`/`.bin` 1,221 个）；**56 / 56 均含 `GuiDocument.xml`**；`SchemaVersion` 全部为 4；`ProgramVersion` 从 `0.15R4241`（2015）跨到 `1.2R45573`（2026）。上表成员清单与实测一致。

### 3.3 `Document.xml` 骨架

`Document::Save`（`Document.cpp:1119`）写出根元素：

```xml
<Document SchemaVersion="4" ProgramVersion="26.3R..." FileVersion="1" StringHasher="1">
```

三段式结构：

1. `<Properties Count=".." TransientCount="..">` — 文档级属性（`PropertyContainer::Save`，`src/App/PropertyContainer.cpp:256`）。含 `Label`、`CreatedBy`、`CreationDate`、`LastModifiedBy` 等（`Document.cpp:973-985`）。
2. `<Objects Count="..">` — **只声明对象**：`writeObjectType`（`Document.cpp:1428-1459`）写
   `<Object type="PartDesign::Pad" name="Pad" id=".." [ViewType=..] [Touched="1"] [Invalid="1" Error=..] [Freeze="1"]/>`。
3. `<ObjectData Count="..">` — **属性数据**：`writeObjectData`（`Document.cpp:1464-1481`）写
   `<Object name="Pad" [Extensions="True"]>` + `it->Save(writer)`。

即 `<Objects>` 是类型索引，`<ObjectData>` 才是内容。转换器必须以 `<ObjectData>` 为准。

### 3.4 属性序列化协议

`PropertyContainer::Save`（`src/App/PropertyContainer.cpp:256-292`）统一包外层，各属性只写内部值元素：

```xml
<Property name="Length" type="App::PropertyLength" status="0">
  <Float value="10.0"/>
</Property>
```

- `type` = C++ 类名（`prop->getTypeId().getName()`，`PropertyContainer.cpp:274`）。
- 带单位属性（`PropertyQuantity : PropertyFloat`）内部元素仍是 `<Float>`，单位不在元素里。
- Transient 属性写成 `<_Property name="..">`（`PropertyContainer.cpp:264`），转换器可整段跳过。
- 常见标签：`<Integer>`、`<Float>`、`<Bool>`、`<String>`、`<PropertyPlacement>`、`<PropertyVector>`、`<Link value="..">`、`<LinkList count=../>`、`<XLink name=.. file=..>`（外部文档引用）、`<ExpressionEngine>`。
- **`PropertyPythonObject` 是黑盒**（`src/App/PropertyPythonObject.cpp:435-451`）：值 `json.dumps` 后 `base64_encode`，写成 `<Python value=".." encoded="yes" [module=".."] [class=".."] json="yes"/>`。还原依赖具体 Python 类，**无法翻译成 faijs**，只能烘焙。

### 3.5 几何与拓扑命名的存放

`PropertyTopoShape` 默认导出 **OCCT 文本 BREP**（`.brp`）；`SaveBinaryBrep` 开启时写二进制 `.bin`。两者都随 ZIP 被 deflate 压缩。

关键点是 `.Map` / `.Table`（`PropertyTopoShape.cpp:409/418`）：FreeCAD 用它们持久化**元素映射（拓扑命名）**——即「这个 Pad 的第 3 条边在操作后叫什么」。后续特征（`UpToFace`、圆角选边、草图附着）都靠这个名字引用几何。这是 FCStd 参数化的隐形骨架，也是格式转换最容易断裂的地方（见 §7 R1）。

### 3.6 参数化的三个数据源

| 数据源 | 存储形态 | 位置 |
|---|---|---|
| 特征参数 | `<ObjectData>` 内各属性的 `<Float>`/`<Integer>`/枚举 | `Document.cpp:1464-1481` |
| 表达式 / 电子表格 | `<ExpressionEngine count=.. [xlink="1"]>` → `<Expression path=".." expression=".." [comment=".."]/>` | `src/App/PropertyExpressionEngine.cpp:428-457` |
| 草图（几何 + 约束） | `PropertyGeometryList` → `<GeometryList>`；`PropertyConstraintList` → `<ConstraintList>`，每条 `Constraint::Save` 写 `<Constrain ... />`（注意元素是单数 `Constrain`） | `src/Mod/Sketcher/App/Constraint.cpp:157-202` |

`Constraint::Save` 的字段（`Constraint.cpp:161-202`）：`Type`、`InternalAlignmentType`、`Orientation`、`Value`、`First`/`Second`/`Third` + 各自的 `Pos`、`ElementIds`、`ElementPositions`，以及驱动标志。约束的**解**不落盘，落盘的是约束**定义**；几何坐标由求解器重算。

Body 的特征顺序由 `Group`（`PropertyLinkList`）持久化，`Tip`（`PropertyLink`）指向末端特征（`src/Mod/PartDesign/App/Body.cpp:47-98`）。PartDesign 共有 33 个 `Feature*.cpp`。

### 3.7 需要原样保留的非建模内容

- `GuiDocument.xml`：ViewProvider 属性（DisplayMode、Visibility、ShapeColor、LineColor、Transparency…）+ `<Camera settings=".."/>`（`src/Gui/Document.cpp:1967-2057`）。
- `thumbnails/Thumbnail.png`。
- 文档元数据（`Label`/`CreatedBy`/`CreationDate`/`LastModifiedBy`）。
- `App::Origin`、`App::Part`、`App::Link`、外部文档 `XLink`。
- `DocumentObjectFileIncluded` 的包含文件（STEP、贴图等）。
- `Material` 属性（`PropertyMaterial`，`PropertyStandard.cpp:3008` 附近）。

### 3.8 可扩展性结论：无法从外部接管保存

`Document::save` / `restore` 是 C++ 硬编码路径。FreeCAD 提供的两个扩展点都不够用：

- `App.addImportType` / `addExportType`（`src/App/Application.cpp:1673` 附近、Python 侧 `FreeCADInit.py`）按扩展名注册**新格式**，不能拦截 `.FCStd` 自身。
- 信号 `signalSaveDocument`（`Document.cpp:2056`）只能**追加**成员（Gui 就是这么写 `GuiDocument.xml` 的），不能改写 `Document.xml`。

**结论：不改 FreeCAD C++ 源码，就不存在「FreeCAD 直接读写 `.fai.zip`」的可能。** 转换器必须是 faijs 侧的独立工具。

---

## 4. 「参数化建模部分」的边界定义

「其他内容不变」要先定边界。按 §3 的结构，三类划分如下：

| FCStd 中的数据 | 归属 | 处理 |
|---|---|---|
| `<ObjectData>` 中 Sketcher / PartDesign / Part 特征的属性 | **替换** | 翻译为 `.fai.js`；翻译不了 → 烘焙为资产 |
| 特征产生的形状（`.brp`/`.bin`）、`.Map`/`.Table` | **替换（重新生成）** | faijs 运行时重算，产物不进包 |
| `<ExpressionEngine>`、Spreadsheet `<Cells>` | **替换** | 降级为 JS 表达式 / `const` 常量 |
| `GuiDocument.xml`、`thumbnails/Thumbnail.png` | **原样保留** | 逐字节搬运 |
| `Label`、`CreatedBy`、`CreationDate`、`LastModifiedBy` 等文档属性 | **原样保留** | 逐字节搬运 |
| `App::Origin`、`App::Part`、`App::Link`、`XLink` | **原样保留** | 逐字节搬运 |
| `Material` 属性、包含文件（STEP/图片） | **原样保留** | 逐字节搬运 |
| `PropertyPythonObject`（Python 特征） | **保留 + 烘焙** | XML 原样保留，几何另存资产，faijs 侧只做导入 |

---

## 5. faijs 侧能力盘点

### 5.1 脚本形态

`.fai.js` 是**合法 JS 子集**，acorn 解析（`packages/core/src/lang/metadata-extractor.ts:18`）；扁平语句、无 `export`/`async`/`return`（`lang/codegen.ts:7-11`）；语句 id 为 `sN`（`metadata-extractor.ts:11`），变量名为 `partN`（`cad-runtime/runtime.ts:36`）。真实样例（`packages/tests/faijs/features/extrude.fai.js`）：

```js
let part0 = cad.box(50, 50, 10, { centered: true })
part0 = cad.fai_extrude(part0, { length: 5 })
```

支持顶层 `const size = 20` 参数声明、算术表达式、注释；UI 元数据由 `metadata-extractor.ts` 的 `ParamEntry` / `ArgSource` 描述。

### 5.2 `cad` 命名空间覆盖（`packages/core/src/api/api-namespace.ts:46-62` + `api/generated/script-face.ts:17-43`）

已有：
`box`、`sphere`、`cylinder`、`cone`、`wedge`、`torus`、`ellipsoid`（基本体）；
`union`、`subtract`、`intersect`、`fuse`、`cut`、`split`（布尔）；
`fai_extrude`、`drill`、`fai_drill`、`pocket`、`boss`、`engrave`、`fai_split`（成形）；
`fillet`、`chamfer`、`knurl`、`offset`、`heal`、`simplify`、`convexHull`（修饰/修复）；
`translate`、`rotate`、`rotate_euler`、`scale`、`scale3d`、`clone`、`applyMatrix`、`transformCopy`、`locate`（变换）；
`linearPattern`、`circularPattern`、`rectangularPattern`、`gridPattern`、`mirror`、`mirrorJoin`（阵列）；
`group`、`assembly`、`copy`、`text`、`screw`、`svgExtrude`、`sdf`、`load`、`asset`。

### 5.3 关键缺口

| 编号 | 缺口 | 证据 |
|---|---|---|
| G1 | **无 2D 草图 + 约束求解器** | `cad.*` 无 `sketch`（`api-namespace.ts` 全文件无 `sketch` 匹配）；`api/generated/sketching.ts` 只导出 `makeBaseBox`；vendored brepjs 的 `solveConstraints`（`kernel/solverAdapter.ts:307`）解的是装配位姿（节点初始化在原点、`Pose{position,rotation}`），不是 2D 几何约束 |
| G2 | `revolve` / `sweep` / `loft` 未挂 `cad` | `api/generated/operations.ts:162/172` 有 `revolve`/`sweep`，但**不在** `scriptFaceOps`（`script-face.ts:17-43`）→ `.fai.js` 当前调用不到 |
| G3 | 无特征树 / 命名特征历史 | 语句序列即历史；运行时靠 `statementCache` + 增量重放（`runtime.ts`），无 Body/Group/Tip 结构 |
| G4 | 无表达式引擎 | 表达式是普通 JS 算术 + `HostExprRef`（`lang/host-arg.ts`），无跨特征引用求解 |
| G5 | 无文档级概念 | `ExecutionResult`（`runtime.ts:119`）只有 `outputs`/`compounds`/`topology`/`naming`；无单位、材质、相机、缩略图 |
| G6 | CLI 导出仅 STL/STEP | `node-host/cli.ts:323`（`supported: .stl, .step`） |

### 5.4 可直接复用的既有资产

- **多文件项目 + zip 通道**：`ProjectLoader` 契约在 `cad-runtime/ports.ts:226`；`packages/demo/src/project/zip-loader.ts` 已用 `fflate` 落地 zip 项目加载（上限 64MB / 5000 条目）。**`.fai.zip` 可以做成它的超集**——`zip-loader.ts:70` 只挑 `.fai.js` 条目作模块，其余条目被忽略，因此往包里塞 `assets/`、`freecad/` 不会破坏现有加载路径（入口启发式是否命中 `model/main.fai.js` 需实测确认）。
- **拓扑命名基础设施**：`packages/core/src/topology/naming/`（`face-evolution.ts`、`geom-hint.ts`、`score.ts`、`resolve-*.ts`）提供了「用几何提示重新解析引用」的能力，正好是 R1 的缓解手段。
- **几何导入**：`occt-kernel/highLevelApi.ts:60/120` 的 `importStepMultiPart` / `importStep` / `importBrepToMesh` → 烘焙回退有落点。
- **第三方库移植范式**：`packages/cq-compat`、`packages/fai_cq_gears`、`packages/fai_cq_warehouse` 证明了「把一套外部建模 API 移植成 faijs 库」这条路是可走的（`@faicad/faijs/sdk` 的 `defineOp` / `compatOp` / `registerLib`）。FreeCAD 特征集可以按同样方式做成一个 `fai_freecad` 库。

---

## 6. `.fai.zip` 容器设计

```
example.fai.zip
├─ manifest.json                 # 格式版本、入口 moduleKey、权威层标记、来源指纹
├─ mapping.json                  # FCStd 对象 ↔ faijs 变量/资产 的对应关系与回退原因
├─ model/
│  ├─ main.fai.js                # 入口（Body 的 Group 顺序 → 语句顺序）
│  └─ *.fai.js                   # 可选：按 Body / Part 拆分，相对 import 引入
├─ assets/                       # 烘焙回退几何（.step / .brp）+ 字体 / SVG
│  └─ <ObjectName>.step
└─ freecad/                      # 原 FCStd 解包后的全部成员，逐字节保留
   ├─ Document.xml
   ├─ GuiDocument.xml
   ├─ thumbnails/Thumbnail.png
   └─ *.brp / *.Map / *.Table / 包含文件 / *.iv
```

**为什么保留整份 `freecad/` 而不是就地改写 `Document.xml`：**

1. 字面满足 C3——非建模内容一个字节都不动，无需理解 `GuiDocument.xml` 的 ViewProvider 语义。
2. 可还原：把 `freecad/` 子树按原样重新打包（ZIP 注释写回 `FreeCAD Document`）即可得到一个能被 FreeCAD 打开的 `.FCStd`，转换因此不再是「跳崖」。
3. 可校验：原 BREP 与 faijs 重算结果能直接做几何比对（§9）。
4. 冗余成本低：文本 BREP 与 XML 在 deflate 下压缩比很高。

`manifest.json` 用 `authoritative: "model"` 标明权威层是 faijs 代码，`freecad/` 是影子备份，避免双写歧义。

---

## 7. 风险登记

| 编号 | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | **拓扑命名断裂**：FreeCAD 的元素引用靠 `.Map`/`.Table`（`PropertyTopoShape.cpp:409/418`），faijs 重建后名字全变 | 圆角选边、`UpToFace`、草图附着全部错位 | 不直译名字。`mapping.json` 存**几何锚点**（面中心+法向、边端点、包围盒），用 `topology/naming/geom-hint.ts` + `score.ts` 在 faijs 侧重新解析 |
| R2 | **草图约束求解器缺失（G1）** | 任何含 Sketch 的文档都翻译不了 | 分层：① 若 `FullyConstrained` 为真，把**解出的几何**硬编码成 faijs 线段（保几何、丢可编辑性，并在 mapping 里标记 `dim: solved-baked`）；② 长期需引入 2D GCS（FreeCAD `src/3rdParty/planegcs`、`OndselSolver`，**授权需法务确认**） |
| R3 | 量纲：FC 的 `PropertyQuantity` 带单位，XML 里只存 `<Float>` 数值；faijs 隐式 mm | 尺寸走样 | 转换期做单位归一，`main.fai.js` 头部写死单位注释；单位本身记进 `mapping.json` |
| R4 | 表达式语义：FC 支持跨文档引用 `<<Doc>>#Obj.prop`（`ObjectIdentifier.cpp`） | 无法等价翻译 | 降级为常量或资产引用，并在 mapping 里记 `expr: downgraded` |
| R5 | 单向不可逆 + 双写漂移 | `.fai.zip` 与 FCStd 各自演化后对不上 | 规定 FCStd 为唯一源；`manifest.json` 记 `sourceFingerprint`（原 `Document.xml` 的 sha256） |
| R6 | 保真度难验证 | 转换后几何悄悄走样 | 建立几何比对：体积 / 面积 / 质心 / bbox + 采样点云 Hausdorff，逐对象设容差（§9） |
| R7 | `PropertyPythonObject` 黑盒（`PropertyPythonObject.cpp:435-451`） | 无法翻译 | 一律烘焙成资产，`mapping.json` 记 `reason: python-opaque`，**禁止静默丢弃** |
| R8 | `.fai.zip` 双后缀在部分系统的 MIME/关联行为 | 用户体验 | 待定：可同时支持 `.faizip` 单后缀；不影响格式本身 |

---

## 8. 转换流水线

| 阶段 | 输入 | 输出 | 说明 |
|---|---|---|---|
| S1 解包 | `.FCStd` | 成员字节表 | 标准 ZIP 读取；用 ZIP 注释 + `Document.xml` 存在性做校验 |
| S2 解析 | `Document.xml` | 对象图（类型/属性/链接）+ 表达式表 | 只读 XML，不依赖 FreeCAD 运行时 |
| S3 分类 | 对象图 | 可翻译集 / 回退集 | 按 §5 的映射表判定；判定规则必须是**白名单**（不在白名单即回退） |
| S4 拓扑排序 | 可翻译集 | 线性特征序列 | 按 `Body.Group` 顺序 + `PropertyLink` 依赖 |
| S5 代码生成 | 特征序列 | `model/*.fai.js` | 参数 → JS 常量；特征 → `cad.*` 调用；单位归一 |
| S6 烘焙 | 回退集 | `assets/*.step` | 从成员里的 `.brp` 直接取（无需 FreeCAD 运行时） |
| S7 打包 | 以上 + `freecad/` 原样 | `.fai.zip` | 写 `manifest.json` / `mapping.json` |

**回退集的对象在 S6 不应调用 FreeCAD**——直接复用 ZIP 内已有的 `.brp`（或 `.bin`）即可，这是保留 `freecad/` 带来的额外好处。

---

## 9. 验收判据（可量化）

1. **容器保真**：`freecad/` 子树每个成员解包前后 `sha256` 全等；成员集合与原 ZIP 条目集合完全一致。
2. **可还原**：由 `freecad/` 重打的包能被 FreeCAD 打开（人工抽样验证）。
3. **翻译覆盖**：样本集上 `可翻译对象数 / 建模对象总数` 达到目标值；回退集 100% 有 `assets/` 产物 + `mapping.json` 记录。
4. **几何保真**：对可翻译对象，faijs 重算结果与原 BREP 比对——体积相对误差、质心距离、bbox 对角偏差、采样点 Hausdorff 距离均落在既定容差内（容差需在实施前按样例测定，本文不预设数值）。
5. **零静默丢失**：`mapping.json` 中每个原 `<ObjectData>` 对象都有归属（`translated` / `baked` / `preserved-only`），三者必居其一。

---

## 10. 分阶段路线

| 阶段 | 目标 | 前置 |
|---|---|---|
| P0 | 只读工具：解包 + `Document.xml` 解析 + 对象清单报表；收集真实 `.FCStd` 样本集 | 无 |
| P1 | `.fai.zip` 容器与保留层：S1 + S7，全部对象走 `baked` | P0 |
| P2 | 白名单翻译器：基本体 / 布尔 / 变换 / 阵列 / 圆角倒角 → `cad.*` | P1 |
| P3 | 草图降级通道（G1 的对策①）+ `revolve`/`sweep` 挂上 `cad` 面（G2） | P2 |
| P4 | 元素引用几何锚点（R1）+ 表达式降级（R4）+ 单位归一（R3） | P2 |

P1 结束时就有可用产物（保真但不可编辑），P2/P3/P4 逐步提升可编辑比例——这条路线保证任何阶段的中止都不会留下无用的半成品。

---

## 11. 未确认项（如实列出）

1. ~~本次调研**没有真实 `.FCStd` 样本**可用于解包验证，§3.2 的成员清单来自源码推导，未做实测交叉验证。实施 P0 时应先用真实样本核对。~~
   **2026-09-15 作废**：仓库自带 56 个样本已全量解包扫描（56/56 成功），§3.2 清单已获实测验证（见该节订正）。实测画像（56 个文件 / 35 个含草图 / 786 个草图几何 / 1,539 条约束 / 约束与几何类型全分布）见 `docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md` §5.5。
2. `DocumentObjectFileIncluded::Save` 把外部文件注入 ZIP 的具体代码路径未逐行核实。
3. `PropertyColor` 的内部元素标签未逐字核实（其余属性标签均已核实）。
4. 当前版本 `FeaturePad` 是否仍保留 `Reversed` / `Midplane` 独立属性未逐字核实——据 agent 调研，双向/对称可能已由 `SideType` / `Type2` 表达；具体枚举取值未逐一核对。
5. `.fai.zip` 能否被 `packages/demo/src/project/zip-loader.ts` 直接读取，取决于入口启发式是否命中 `model/main.fai.js`，未实测；若未命中，可在 `manifest.json` 里写明 `entry` 并由宿主显式指定。
6. FCStd 无 mimetype 成员这一结论，基于全仓字符串检索未命中，属于穷尽检索后的否定判断。
7. `src/3rdParty/planegcs` 与 `OndselSolver` 的许可条款未确认，若 R2 走对策② 需法务评估。

---

## 12. 附：FreeCAD 特征 → faijs 映射速查

| FreeCAD 对象 | faijs 落点 | 判定 |
|---|---|---|
| `Part::Box/Cylinder/Cone/Sphere/Torus` | `cad.box/cylinder/cone/sphere/torus` | 直接映射 |
| `PartDesign::Pad` / `Pocket` | `cad.fai_extrude` / `cad.pocket`、 `cad.drill` | 部分（`UpToFirst`/`UpToFace`/拔模等选项缺失） |
| `PartDesign::Revolution` / `Groove` | 无（`revolve` 未挂脚本面） | 缺口 G2 |
| `PartDesign::Loft` / `Pipe` / `Helix` | 无 | 缺口 |
| `PartDesign::Fillet` / `Chamfer` | `cad.fillet` / `cad.chamfer` | 可映射（选边语义需 R1 锚点） |
| `PartDesign::LinearPattern` / `PolarPattern` / `Mirrored` | `cad.linearPattern` / `circularPattern` / `mirrorJoin` | 可映射 |
| `PartDesign::Boolean` | `cad.union` / `subtract` / `intersect` | 可映射 |
| `Sketcher::SketchObject` | 无 | **最大缺口 G1** |
| `App::Part` / `App::Link` 装配 | `cad.group` / `cad.assembly` | 部分 |
| `Spreadsheet::Sheet` | 无（降级为常量） | 降级 |
| Python 特征（含 `PropertyPythonObject`） | 无 | 烘焙 R7 |
