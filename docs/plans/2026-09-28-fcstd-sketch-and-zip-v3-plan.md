# FCStd 草图参数化翻译 + `.fai.zip` v3 格式迁移计划（2026-09-28）

状态：**方案（未实施）**——等实施指令。本方案接续 `2026-09-27-fcstd-next-batch-plan.md`（该计划把草图相关缺口 B2′ 草图求解 / B3 外部几何 / C0 开放轮廓、约 659 个 translation-gaps「继续挂起，等草图库改版落地」）。现在 faijs 的 2D 草图能力已落地（`docs/plans/2026-09-27-2d-sketching-to-3d-plan.md`），`.fai.zip` 容器格式升到 v3，`../fcstd-port` 也已更新到消费 `@faicad/faijs-fcstd` 的新读 API——本方案把这些前置条件合起来，规划「用新草图能力兼容 FCStd 草图」与「老 `.fai.zip` 升级到 v3」两件事。

## 0. 用户要求（原话）

> 这份文档的内容基本落地，请检查实现是否合理。然后你需要写一份新的 fcstd 移植方案。昨天有一份方案，见 docs/plans/2026-09-27-fcstd-next-batch-plan.md，其中特意略过了草图相关的部分。现在草图的工作完成了。那么需要写新的方案，用新的草图的能力，来兼容 fcstd 文件里的草图相关的功能。此外，.fai.zip 文件格式变更了，../fcstd-port 项目代码也更新了，之前老的 .fai.zip 文件需要更新。你可以参考 docs/fai-zip-format.md。

### 0.1 方向纠正（2026-09-28，用户原话）

> 我的意思是，如果 freecad 的 fcstd 文件格式里是参数化的草图，那么移植到 .fai.zip 也应该是参数化草图 cad.sketch。如果是画图，那么移植过来是 cad.draw。而 cad.profile 只是一个死的最终非参数化结果，这只是最后的兼容手段。之前把所有 fcstd 都翻译为 profile，这是不合理的。

**由此确立本方案的翻译总原则**：FCStd 对象的**参数化程度**决定 faijs 目标入口，逐类映射，绝不一律 profile 化：

| FCStd 源对象 | 参数化程度 | faijs 目标入口 |
|---|---|---|
| `Sketcher::SketchObject`（几何 + 约束） | 参数化（约束驱动，可编辑） | `cad.sketch`（几何 + 约束，run 期求解） |
| Draft 画图对象（`Part::Part2DObject` 及子类：wire/circle/arc/polyline 等死坐标几何） | 非参数化（画图过程，无约束） | `cad.draw`（链式重建画图过程） |
| 求解失败 / 求解器不支持的草图、无法参数化的死轮廓 | 已定形 | `cad.profile`（**最终兜底**，死的非参数化轮廓） |

**参数变量层（横切维度，2026-09-28 追加拍板）**：除「对象类型 → 入口」外，还有一个横切维度——FreeCAD 里**可被驱动的标量参数**，统一升格为 faijs 顶层 `const` 参数（`syntax-design.md:81` 的 `param = const <name> = <literal>`），运行时可改、改后重算：

- **参数来源**：`Spreadsheet::Sheet` 别名单元格、`VarSet` 变量、**具名 + 带数值的草图约束**（length/radius/diameter/distance/angle）——三类「叶子参数」。
- **表达式依赖**：`ExpressionEngine` 的绑定（`Pad.Length = width * 2`）**内联**成 op 的参数表达式（`cad.pad(sk, { length: p_width * 2 })`），不抽独立 `const`、也不烘焙成常数（faijs §2.5 已原生支持参数参与的位置表达式）。
- **求解时机**：convert 期按表格数据求解一次，得出各 `const` 参数的 default 值（几何真值也据此算，供 parity）；run 期改参数即重算。
- **命名**：统一 `p_` 前缀（`p_width`、`p_Sketch_Length`）防冲突，撞名沿用 codegen 的 `emitVar` 去重后缀（§2.6 标识符在 JS/Python/C/Java 均合法）。

## 1. 前置条件现状（2026-09-28 实测确认）

### 1.1 faijs 三个 2D 入口的语义归宿（已具备，本方案直接映射）

- **`cad.sketch`（约束草图，`@faicad/faijs-sketch`）**：`packages/sketch/src/op.ts` 接受 `geoms: SketchGeom[]` + `constraints: SketchConstraint[]`，**run 期经 host 注入的 planegcs 求解**，产出 face/outer-wire；`plane?` 已支持命名平面（`XY`/`XZ`/`YZ`，F4 落地）。`SketchGeom`（`canonical.ts`）已声明 line/circle/arc/point/ellipse/bspline 六种。
- **`cad.draw`（链式绘图，`@faicad/faijs-draw`）**：`packages/draw/src/draw.ts` 提供 `draw(session)` 链式笔方法（moveTo/lineTo/arcTo/circle/…/close）+ 命名空间工厂（rectangle/roundedRectangle/polygon/circle）。
- **`cad.profile`（数据式死轮廓，core）**：`packages/core/src/api/profile.ts` 接受 `contours:[{segments:[line|arc]}]`，锁 z=0 构面，是**死轮廓**商品化；已消费 `organiseBlueprints`（F2）。

三者最终都汇入同一条放置 + 拉伸管线（`sketchOnPlane`/`sketchOnFace`/`extrude`/`punchHole`，2d-sketching §1.5/§6）。

### 1.2 fcstd 草图链路现状（本方案要纠正的目标）

`convert.ts` + `codegen.ts` 现有草图通路：

```
parseSketchObject(线/圆/弧/点/椭圆/bspline + 约束)          sketch-parse.ts（faijs-sketch）
  → planegcs 求解（convert 期）→ classifySketch(L0/L1/L2)   convert.ts:145-201
  → extractContours → Contour[]（仅 line/arc）               @faicad/faijs-sketch contour.ts
  → 发射 cad.profile({contours})（锁 z=0，丢了约束）        codegen.ts:286-325 (M6)
  → cad.place 重定向到草图 Placement                        codegen.ts M8.3
  → Pad 用 cad.extrude / Pocket 用 cad.subtract
```

**问题（正是 0.1 纠正的对象）**：

1. **一律 profile 化**：L0 草图求解后只保留「死轮廓」`cad.profile({contours})`，几何 + 约束的**参数化本质被丢弃**——产出的 `.fai.js` 里草图不再可编辑、不再带约束，退化成了非参数化结果。
2. **曲线压平/丢弃**：`contour.ts:13` 的 `ContourSeg` 只有 line/arc；bspline 被 `bsplineToSegments` 离散，ellipse 在 `segEnds` default 分支被丢段——「不丢几何」都未满足。
3. **锁 z=0 + 事后放置**：轮廓先 z=0 构面，再靠 `cad.place` 搬去草图平面；本应一步放对 frame。
4. **Draft 对象缺位**：Draft 画图对象因带 `Proxy` 被判 `python-opaque` → `python-baked`（`feature-translate.ts:651-666`），没走 `cad.draw`。

### 1.3 参数化翻译的现成基础设施

- **FCStd → canonical 投影已有一半**：`packages/sketch/src/project.ts` 有 `fromFreeCadGeoms`（`FcstdSketchGeom[] → SketchGeom[]`）与 `toFreeCadConstraints`（canonical → FCStd）；**缺 `fromFreeCadConstraints`（FCStd 整数约束 → canonical 字符串 kind）这条反向**——这是草图翻译成 `cad.sketch` 的**唯一硬缺口**。
- **planegcs 后端已覆盖约束全集**：`planegcs-backend.ts` 已处理 Coincident/Horizontal/Vertical/Parallel/Perpendicular/Distance/DistanceX/DistanceY/Angle/Radius/Diameter/Equal/PointOnObject/Symmetric/Tangent 等——**convert 期现在就是在用同一后端求解**，所以「把求解搬到 run 期（`cad.sketch`）」不损失能力，只多保留参数化。

### 1.4 `.fai.zip` 格式 v1 → v3 与老文件规模

`docs/fai-zip-format.md` 现规范 `format: 3`（`fai-zip-format.zh.md` 已配）。`packages/fcstd/src/container.ts:98` 已发 v3。v1 → v3 核心变更：

| 维度 | v1（老产物） | v3（现规范） |
|---|---|---|
| 版本字段 | `format: 1` | `format: 3` |
| 模型描述 | `entry: "model/main.fai.js"`（单入口字符串） | `models: [{id, entry, label?, data?}]`（数组，main + 每 Body 一模型） |
| 默认模型 | 无 | `active?`（缺省 `models[0]`） |
| BREP 链标记 | `requiresBrep: true`（必填） | `requiresBrep?: boolean`（可选） |

`../fcstd-port` 已更新到消费 `@faicad/faijs-fcstd` 的 v3 读 API（`container-read.ts` 的 `readManifest`/`listModels`/`openContainer`，`packages/fcstd/src/index.ts:24-33`）。

**老 `.fai.zip` 规模（待更新到 v3）**：fcstd-port 下 `FreeCAD-library/`（已晋升入库，按分类子目录组织）**142** 个 + `FreeCAD-library-staging/`（平铺）**2182** 个 = **2324** 个，实测全为 format 1（键 `['entry','format','requiresBrep','source','units']`，无 `models[]`）。**源 `.FCStd` 在 `D:/Faicad/FreeCAD-library/`（3201 个）**，reconvert 以它为输入。

### 1.5 参数化表格 + 表达式现状（convert 期求值烘焙，运行时不可改）

`packages/fcstd/src/expressions.ts` 已实现：`spreadsheetAliasValue`（`<<Label>>.Alias` 三跳）、`sketchConstraintValue`（`Sketch.Constraints.<Name>` 具名约束）、`objectPropertyValue`/`docReferenceValue`（对象属性 + 引用算术 + 环保护）、`evalWithDoc`（引用替换 + 算术求值）。**但结果是 convert 期求值成死数值**（`ExpressionBinding.value?: number`），生成 `.fai.js` 时烘焙成常数——能算对，却不保留参数化。本方案 C 组把它升级为「识别叶子参数升格 `const` + 表达式内联折叠」。

## 2. 关键决策（概念 + 选项 + 推荐）

### D1：按参数化程度分三类翻译（已由 0.1 拍板，此处固化）

- `Sketcher::SketchObject` → **`cad.sketch`**（保留几何 + 约束，参数化可编辑）。
- Draft 画图对象 → **`cad.draw`**（链式重建画图过程）。
- `cad.profile` → **仅兜底**（求解 failed / 求解器不支持的几何 / 无法参数化的死轮廓）。

### D2：草图求解从 convert 期搬到 run 期，convert 期只做「解析 + 投影 + 保真预检」

- **概念**：现在 convert 期用 planegcs 求解、再 profile 化死轮廓；正确做法是 convert 期把 `FcstdSketchGeom` + `FcstdSketchCon` **投影成 canonical** 后发射 `cad.sketch({geoms, constraints, plane})`，求解交给 run 期的 `cad.sketch` op（同一个 planegcs 后端）。
- **选项**：(a) 保留 convert 期求解但发射死轮廓（现状，否决）；(b) 发射 `cad.sketch` 参数化调用，convert 期仅保留一次求解作**保真预检**（判定能否求解，写进 `mapping.json` 的 fidelity 台账，并决定「参数化翻译 vs 降级 profile/baked」）。
- **已拍板**：**(b)**（2026-09-28 用户确认）。预检复用现状 `classifySketch` 逻辑，但结论不再是「烘焙死轮廓」，而是「发射 cad.sketch 还是降级兜底」。under/redundant/conflicting（`SolveStatus` 非 `failed`）都保留参数化，只有 `failed` 或不支持几何才降级。

### D3：放置接口衔接 —— `sketchOnPlane` 放平面，`sketchOnFace` 放模型给定的面

- **概念**：`sketchOnPlane` 把轮廓放到一个**平面**（命名平面或任意 frame）；`sketchOnFace` 把轮廓放到**模型给定的某个面**（UV 参数域）。FCStd 草图有两条附着路径：附着在 datum/命名平面 → 用 `sketchOnPlane`；附着在别的特征的面（`Support` 指向某 face）→ 用 `sketchOnFace`。2d-sketching §1.5 已定「cad.sketch 只产轮廓，放到平面/面用 core 的 `sketchOnPlane`/`sketchOnFace`」。
- **`sketchOnFace` 能力边界（2026-09-28 实测确认）**：**支持平面面，不支持曲面**。`sketch-on-face.ts` 用 `makeFace` 在 UV 采样插值出的 wire 上构面，对平面面精确（v1 scope 注释 + `sketch-on-face-e2e.test.ts` 平面顶面控制组已证）；真正曲面 host 面的 `fixWireOnFace` 贴合是 follow-up（未实现），圆柱面会抛 `CONSTRUCTION_FAILED: makeFace`（`sketch-on-curved-face.gotcha.test.ts` 已钉死）。因此 fcstd 附着在**曲面**上的草图，本方案**降级兜底**（profile/baked，reason 标注 `sketch-on-curved-face-unsupported`），不伪造支持。
- **选项**：(a) 把 `cad.sketch` 的 `plane` 从命名平面 string 扩为任意 frame（`{origin, normal, xDir}`）一步到位；(b) `cad.sketch` 增「仅求解回轮廓」模式，由 `sketchOnPlane`/`sketchOnFace` 承接放置（现状 F4 的 `buildSketchOnPlaneWith` 已是这样）。
- **推荐**：**(b)** 为主线（贴合已拍板分工、与 F4 落地一致）；命名/斜平面用 `sketchOnPlane` 任意 frame，附着面（平面面）用 `sketchOnFace`。命名平面可直传 `plane` 省一跳，作为优化。

### D4：老 `.fai.zip` 用 reconvert 全量重跑到 v3，不打 manifest 补丁

- 理由同前：草图翻译本会改变产物（哪些草图转 `cad.sketch`、`cad.draw`，哪些曲线变精确），打补丁只改格式、不反映翻译升级，会留下两套不一致产物；reconvert 一步同时解决「v3 格式」与「草图参数化翻译」两件事。
- **reconvert 对象是源 `.FCStd`（`D:/Faicad/FreeCAD-library/`，3201 个），不是老 `.fai.zip`**；老产物（fcstd-port 下 142 promoted + 2182 staging）由重跑覆盖/补齐。按老规矩单文件循环、逐文件汇报。

### D5：参数化变量映射 —— 叶子参数升格 `const`，表达式内联折叠，`p_` 前缀（2026-09-28 拍板）

- **叶子参数 → `const`**：`Spreadsheet::Sheet` 别名单元格、`VarSet` 变量、**具名 + 带数值的草图约束**（length/radius/diameter/distance/angle）升格为 faijs 顶层 `const p_xxx = <值>`；纯几何约束（coincident/horizontal/parallel/tangent…）与非具名尺寸约束留在 `cad.sketch` 的 `constraints` 数组内。convert 期用 `evalWithDoc` 求解一次得出各参数的 default 值（写入 `const` 右值，同时用于几何真值/parity）。
- **表达式 → 内联折叠**：`ExpressionEngine` 绑定（`Pad.Length = width * 2`）内联成 op 的参数表达式（`cad.pad(sk, { length: p_width * 2 })`），不抽独立 `const`、不烘焙成常数——选内联而非「抽 `const Pad_Length = width*2`」，因 faijs §2.5 已原生支持参数位置表达式，零新语法。
- **命名**：统一 `p_` 前缀（`p_width`、`p_Sketch_Length`）防撞几何变量名；撞名走 `emitVar` 去重后缀；来源信息进 `mapping.json`。

## 3. 工作项（按「发现一个解决一个」组织，无强制顺序）

执行循环继承 2026-09-27 计划 §2 全部纪律：单文件闭环、一次只跑一个任务、逐文件汇报、测试留档、每项独立提交。

### A 组：fcstd 草图参数化翻译（主题一）

- **A1 补 `fromFreeCadConstraints`**：`packages/sketch/src/project.ts` 新增 FCStd 整数 `ConstraintType` + `(geoId,pos)` ref → canonical `SketchConstraint`（string kind）的反向投影，配合既有 `fromFreeCadGeoms`；把 `SketchCon` 的 `-1/-2/≤-3` 特殊 geoId（HAxis/VAxis/外部）投影为对应 canonical 引用或显式标为不可投。**单测**：约束全集（含内部对齐、外部参考）双向 roundtrip；GOTCHA 留档 geoId 负值语义。
- **A2 sketch 分支改发 `cad.sketch`**：`codegen.ts` M6 草图分支从「`extractContours → cad.profile`」改为「`fromFreeCadGeoms + fromFreeCadConstraints → cad.sketch({geoms, constraints, plane})`」；convert 期 `classifySketch` 降格为**保真预检**——`solved`/`underconstrained`/`redundant`/`conflicting` 都发 `cad.sketch` 并把 verdict 写进 `mapping.json` 的 fidelity，只有 `failed` 或不支持几何才落 A5 兜底。**改动位置**：`codegen.ts`（`SketchObject` 分支）+ `convert.ts`（M3 求解段去 profile 化）+ `feature-translate.ts` 的 `SketchObject` 相关。**单测**：`codegen.test.ts` 现「sketch → cad.profile」断言改为「sketch → cad.sketch」，并断言约束原样出现在生成代码里。
- **A3 放置衔接 —— `sketchOnPlane`（平面）/ `sketchOnFace`（模型给定面，限平面面）**：草图 `Placement` + `Support`（`attachment.ts` 的 `effectivePlacement`）归一为两路——附着在 datum/命名平面 → `sketchOnPlane(plane frame)`；附着在别的特征的面 → `sketchOnFace(on, face)`；附着在**曲面**面 → 降级 A5 兜底并显式 reason（`sketch-on-curved-face-unsupported`，因 G2 `fixWireOnFace` 未实现）。删除/旁路 M8.3 的 `cad.place` 重定向 hack。**改动位置**：`codegen.ts`（M8.3 放置段）+ 新增 Placement→frame 转换。**单测**：斜平面草图 e2e 精确 target 断言、平面面上草图 `sketchOnFace` 几何等价、曲面草图降级 reason 明确；GOTCHA 留档「两帧往返」。
- **A4 Draft 画图 → `cad.draw`**：识别 Draft/`Part::Part2DObject` 画图对象，把死几何（wire 点列、circle、arc、polyline…）链式重建为 `cad.draw` 调用（moveTo/lineTo/arcTo/circle/close）。`cad.draw` 产出的 Drawing 与草图同一条下拉管线：在 XY/命名平面画出 → `sketchOnPlane` 放置 → `extrude`；附着在别的特征面上 → `sketchOnFace` 放置 → `extrude`。**前置**：先解析 Draft 对象几何（现被判 `python-opaque`，需从 `Python`/`Proxy` 属性或 Shape .brp 中取坐标）。**改动位置**：`feature-translate.ts` 新增 Draft 特征分支 + `document.ts` 解析辅助。**取点**：从 ArchDetail 等含 Draft 语料取点，逐文件汇报。
- **A5 `cad.profile` 兜底收紧**：仅在「求解 failed / 求解器不支持几何（bspline/ellipse 超能力）/ 开放轮廓不可参数化 / **附着在曲面面（`sketch-on-curved-face-unsupported`，G2 `fixWireOnFace` 未实现）**」时落 `cad.profile`（烘焙求解结果/原始几何成死轮廓）或 baked，并把降级原因写成显式 reason（如 `sketch-unsupported-geom`），替代现在的「默认 profile 化」。**单测**：断言不可解/曲面附着草图的 mapping reason 明确、且 profile 只出现在兜底分支。
- **A6 曲线精确化（parity 提升项，晚做）**：`ContourSeg`/`SketchGeom` 已含的 bspline/ellipse 逐步走精确边（`sketchOnPlane` 的 `liftCurve2dToPlane` 抬控制点），替代折线采样；**第一步先修「ellipse 丢段」这个硬 bug**（`contour.ts` 的 `segEnds` 补 ellipse 分支），再逐个精确化。

### B 组：`.fai.zip` v3 迁移与老文件更新（主题二）

- **B1 fcstd-port 消费端对齐 v3 读 API**：确认 `../fcstd-port` 对拍/重跑管线已从「读 `manifest.entry`」切到 `readManifest`/`listModels`/`active`；仍读旧 `entry` 的先改读端。**改动位置**：`../fcstd-port` 对拍脚本。
- **B2 reconvert 源 `.FCStd` → v3 新产物**：对 `D:/Faicad/FreeCAD-library/`（3201 个源 `.FCStd`）用升级后 `convert` 重跑，产出 format 3 + 新草图翻译，覆盖/补齐 fcstd-port 下 142 promoted + 2182 staging 老产物；单文件循环、逐文件汇报、跳过可信产物、批跑前 smoke。
- **B3 v3 产物的 parity/入库回核**：reconvert 后按固定口径核对（parity pass/fail/skip、promoted 数、`FreeCAD-library/` 下 `.fai.zip` 数 == promoted、原 142 个回核），刷新 `reports/status.md` 并记「v1→v3 迁移 + 草图参数化翻译」事实。

### C 组：参数化表格 + 表达式 → faijs 参数（主题三）

- **C1 Spreadsheet 别名 / VarSet → `const p_xxx`**：识别 `Spreadsheet::Sheet` 别名单元格与 `VarSet` 变量为叶子参数，发射 `const p_<alias> = <值>`（值由 `spreadsheetAliasValue` 在 convert 期求出，作为 default 写入）。**改动位置**：`convert.ts` 新增「参数收集」阶段（遍历 Spreadsheet/VarSet 对象），`codegen.ts` 在脚本头部发射 `const` 参数块。
- **C2 具名草图约束 → `const p_xxx`**：识别**带 Name 且带数值**的草图约束（length/radius/diameter/distance/angle）为叶子参数，发射 `const p_<SketchName>_<ConstraintName> = <值>`；`cad.sketch` 的 `constraints` 数组里该约束的 `value` 改为引用该参数（`{ kind:'length', value: p_Sketch_Length }`），非具名/几何约束仍内嵌字面量。**与 A2 衔接**：A2 发 `cad.sketch` 时，具名尺寸约束走本项，其余走 A2。`sketchConstraintValue` 已能按 Name 取到值，这里复用其识别。
- **C3 表达式内联折叠**：`feature-translate.ts` 里 `ExpressionEngine` 绑定从「求值成数值烘焙进 params」改为「产出参数引用表达式」——`Pad.Length = width * 2` 生成 `cad.pad(sk, { length: p_width * 2 })`（`p_width` 是 C1/C2 升格的参数，表达式的标识符替换复用现有 `evalWithDoc` 的引用替换、但**替换成参数名而非数值**）。无法内联的（函数族 / 残留标识符）维持降级（`undefined` → 属性未知/property-downgrade），不猜。**改动位置**：`expressions.ts` 增「产出参数表达式文本」入口 + `feature-translate.ts` 参数发射。
- **C4 命名与来源台账**：参数统一 `p_` 前缀 + `emitVar` 去重后缀；每个参数在 `mapping.json` 记来源（如 `{ name:'p_width', source:'Spreadsheet::Sheet.Alias:width' }`），供 UI 回显「可改参数」列表。**单测**：含别名/具名约束/表达式的合成 FCStd fixture，断言 `.fai.js` 里 `const p_*` 参数块、内联表达式、`mapping.params` 来源正确。

## 4. 验证与回归

- 每项伴随合成 fixture 单测（`packages/sketch` / `packages/fcstd` / `packages/core`），GOTCHA 踩坑注释，探针脚本留在 `scripts/`。
- 草图翻译升级绝不破坏非草图通路：`npm run test -w @faicad/faijs-fcstd`、`-w @faicad/faijs-sketch`、`-w @faicad/faijs` 取差；stderr 零容忍。
- 新 `.fai.zip` 读端回归：`container-read.test.ts` 覆盖 v3 `models[]`/`active`。
- **C 组参数化验证**：含 Spreadsheet 别名/VarSet/具名约束/表达式的样本文件，断言 `.fai.js` 的 `const p_*` 参数块、内联表达式、`mapping.json` 来源台账正确；run 期改 `p_*` 参数值后几何重算、且用 default 值时与 convert 期求解值一致（参数可变但默认一致）。
- fcstd-port 端：A/C 组每项用一个含对应特征的样本文件 `process-one --reconvert` 走通 convert→run→truth→inv→parity，逐文件汇报。

## 5. 验收

- 主题一（草图参数化翻译）：`Sketcher::SketchObject` 一律翻译为 `cad.sketch`（保留几何 + 约束，产出的 `.fai.js` 可编辑）；Draft 画图对象翻译为 `cad.draw`；`cad.profile` 只出现在兜底分支且 reason 明确；659 草图族 translation-gaps 中「参数化不可译」一支归零或显式 reason。
- 主题二（格式迁移）：`FreeCAD-library/` 与 `FreeCAD-library-staging/` 下 `.fai.zip` 全部 `format: 3`，读端与对拍走 v3 读 API，parity/promoted 核对与 reports 刷新通过。
- 主题三（参数化变量）：`Spreadsheet::Sheet` 别名、`VarSet` 变量、具名尺寸草图约束翻译为 faijs `const p_*` 参数，表达式内联成 op 参数表达式；`mapping.json` 记录参数来源；run 期改参数可重算、default 值与 convert 期求解值一致。
- 全程：单测随项落库、每项独立提交、逐文件汇报、stderr 零容忍。