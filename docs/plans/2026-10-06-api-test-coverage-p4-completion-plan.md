# API 测试覆盖补全计划（P4）

日期：2026-10-06
状态：方案（未实施）

## 1. 背景

P1–P3、P5 已落地（commit `9129bbf`）：测试迁移至 `test/`、AST 门禁脚本上线、CI 接入完成。当前门禁使用 baseline 机制过渡——已知缺口记录在各包 `api-coverage-baseline.json` 中，门禁只对**新增缺口**失败。

本计划是 P4 阶段：逐步关闭 baseline 中的缺口，最终删除所有 baseline 文件，实现全量硬门禁。

## 2. 缺口总览

| 包 | L1 缺口 | L2 API 缺口 | L2 参数缺口 | 备注 |
|---|---|---|---|---|
| core | 118 | 50 | 157 | 缺口最大，含 op 参数 + 内部辅助函数 |
| faijs-extra | 23 | 4 | 38 | L2 集中在 fai_drill/fai_extrude/fai_split |
| sheetmetal | 31 | 1 | 1 | L1 含常量/类型 + 构造器 |
| sketch | 29 | 1 | 4 | L1 含命名空间注册 + 数学辅助 |
| draw | 3 | 0 | 0 | 最小，3 个导出未引用 |
| faijs-gears | 15 | 0 | 0 | 全部 L1，各类齿轮构造函数 |
| faijs-fasteners | 23 | 1 | 4 | L1 含常量/工具函数 |
| faijs-viewer | 2 | 1 | 4 | 最小 |
| **合计** | **244** | **58** | **212** | |

## 3. 分类与优先级

### 3.1 L1 缺口分类

将 L1 缺口按性质分为四类，优先级递减：

| 类别 | 说明 | 典型示例 | 优先级 |
|---|---|---|---|
| **A. Op / 用户面 API** | `cad.*` 脚本面 op，直接面向 `.fai.js` | `box`/`sphere`/`extrude`/`screw`/`helix`/`punchHole` | P0 |
| **B. 库函数 / 高层 API** | 库开发者面函数，有明确语义 | `createRuntime`/`exportModel`/`resolveImports`/`measureVolume` | P1 |
| **C. 内部辅助 / 低层函数** | 导出但偏内部，测试需较多 mock | `vecAdd`/`vecDot`/`polarToCartesian`/`createBBox2d` | P2 |
| **D. 常量 / 类型 / 枚举** | 常量值或类型导出，引用即覆盖 | `LENGTH`/`DEG2RAD`/`BREP_ENGINE_IDS`/`SheetMetalError` | P3 |

### 3.2 L2 缺口分类

| 类别 | 说明 | 典型示例 | 优先级 |
|---|---|---|---|
| **E. Op schema 参数** | op 的 schema 参数未在调用点出现 | `box: segments`/`sphere: at, segments`/`extrude: mode, normal` | P0 |
| **F. 函数选项参数** | 高层函数的选项对象属性未覆盖 | `projectSheet: dash, margin, ...`/`resolveImports: baseURL, ...` | P1 |
| **G. Knurl/SDF 深层参数** | knurl/sdf displacement 的映射参数，需构造几何 | `applyKnurlDisplacement: mappingMode, scaleU, ...` | P2 |

## 4. 分批实施

### 批次 1：小包快赢（draw / faijs-viewer / faijs-gears）

**目标**：3 个最小包的 L1 缺口清零，验证 baseline 收缩流程。

| 包 | L1 缺口 | 工作量 | 策略 |
|---|---|---|---|
| draw | `BaseSketcher2d`/`Blueprint`/`mergeDrawNamespace` | 3 个 | 直接在测试中引用类名和命名空间函数 |
| faijs-viewer | `assertWasmUrls`/`installEngine` + L2 `openFaiZip` 4 参数 | 2+4 | 引用函数 + 在调用点覆盖 `executionTimeoutMs`/`mode`/`modelId`/`sketch` |
| faijs-gears | 15 个齿轮构造函数（`spurGear`/`bevelGear`/`worm`/...） | 15 个 | 每个函数至少调用一次（轻量参数，不跑 BREP parity） |

完成后：刷新 baseline → 提交 → 确认门禁仍通过。

### 批次 2：sketch / faijs-fasteners / sheetmetal

**目标**：中等包的 L1 + 少量 L2 缺口关闭。

| 包 | L1 | L2 | 策略 |
|---|---|---|---|
| sketch | 29 | 4 参数 | L1 含命名空间注册函数（`registerSketchSymbols` 等）和数学辅助（`arcPoints`/`evalBSpline` 等）；L2 补 `sketch` op 的 `geoms`/`constraints`/`as`/`plane` |
| faijs-fasteners | 23 | 4 参数 | L1 含常量（`ACME_PITCH`/`INCH`）和工具函数（`evalArithmetic`/`metricStrToFloat`）；L2 补 `makeLink` 的 4 参数 |
| sheetmetal | 31 | 1 参数 | L1 含常量/类型/构造器和高层 API（`unfoldPart`/`contourFlange`）；L2 补 `patternToFlatInput: material` |

### 批次 3：faijs-extra

**目标**：faijs-extra 的 23 L1 + 38 L2 参数。

L2 集中在 3 个 op：
- `fai_drill`（12 参数）：需在 `.fai.js` fixture 或测试中构造调用，覆盖 `diameter`/`depth`/`holeType`/`direction`/`position`/`face`/`faceNormal`/`tolerance`/`screwSystem`/`screwSpecIdx`/`screwThread`/`screwHead`
- `fai_extrude`（4 参数）：`mode`/`normal`/`planeDistance`/`space`
- `fai_split`（21 参数）：`cutMode`/`normal`/`offset`/`inPlaneAngle`/`bbCenter`/`bboxSize`/`applyExplode` + groove/dowel/tenon 子参数

L1 含 editor 命名空间函数（`mergeEditorNamespace`/`installEditorMeshProviders`）和几何函数（`svgToExtrudedGeometry`/`createTextGeometry`）。

### 批次 4：core L2 op 参数

**目标**：core 的 50 个 L2 API 缺口，重点是 op schema 参数。

按 op 分组补齐：

| op 组 | 涉及 op | 缺失参数 |
|---|---|---|
| 基本体 | `box`/`sphere`/`cylinder`/`cone` | `segments`/`at` |
| 变换 | `scale`/`scale3d` | `factor`/`center` |
| 布尔 | `union`/`cut` | `shapes`/`base`/`tool` |
| 倒角/圆角 | `chamfer`/`fillet` | `edges`/`type`/`width`/`angle` |
| 薄壳/加厚 | `shell`/`thicken`/`sew` | `thickness`/`tolerance`/`openFaces` |
| 草图/打孔 | `profile`/`sketchOnFace`/`punchHole` | `contours`/`as`/`scaleMode` |
| 扫掠/放样 | `sweep`/`loft` | `spine`/`profile`/`sections`/`opts` |
| 螺纹 | `screw` | `pitchCustom`/`nRad` |
| 拔模/分割 | `draft`/`split`/`defeature` | `faces`/`angleDeg`/`pull`/`neutral`/`tools` |
| 雕刻 | `engrave`/`knurl` | `mode`/`svg`/`faceCenter`/`faceNormal` + knurl 子参数 |
| 拉伸 | `extrude` | `length`/`mode`/`normal`/`upTo`/`baseFeature`/`offset` |
| 其他 | `wire`/`removeHolesFromFace`/`filletVariable` | `points`/`closed`/`smooth`/`degree`/`face`/`edge`/`r1`/`r2` |

策略：在 `.fai.js` fixture 或 `test/` 中构造调用，覆盖每个参数名。op 参数大多是对象字面量属性，只需在调用点传入即可，不需要完整 BREP 执行。

### 批次 5：core L1 内部辅助 + 常量

**目标**：core 的 118 个 L1 缺口中的 C/D 类（内部辅助 + 常量/类型）。

- **D 类（常量/类型，约 40 个）**：`LENGTH`/`AREA`/`VOLUME`/`ANGLE`/`DEG2RAD`/`RAD2DEG`/`BREP_ENGINE_IDS`/`ScriptUnitConstants`/`ValueWithUnits`/`SheetMetalError`/`ModuleResolverError` 等——在测试中引用名字即可。
- **C 类（内部辅助，约 50 个）**：向量数学（`vecAdd`/`vecSub`/`vecDot`/`vecCross`/`vecLength`/`vecNormalize`）、2D 几何（`distance2d`/`samePoint`/`polarToCartesian`/`normalize2d`/`polarAngle2d`）、BBox（`createBBox2d`/`addPoints`/`mergeBBox`/`containsPoint`/`isBBoxOut`/`centerOf`/`widthOf`/`heightOf`/`outsidePointOf`/`boundsOf`）、字体（`loadSystemCjkFont`/`containsCjk`/`isCjkChar`/`ensureDefaultFont`）、引擎注册（`ensureBrepkitDefaultEngine`/`ensureBrepkitMeshBackend`/`initBrepkitWasm`/`isBrepkitInitialized`/`registerMeshEngine`/`isMeshEngineRegistered`）等——写轻量单元测试引用函数名。
- **B 类（高层 API，约 28 个）**：`createRuntime`/`exportModel`/`resolveImports`/`satisfies`/`parseVersion`/`splitVersionRange`/`cliMain`/`enterFunctionBrep`/`exitFunctionBrep` 等——按需写集成引用。

### 批次 6：core L2 函数选项参数

**目标**：core L2 缺口中非 op 的部分（knurl displacement、UV 映射、安全扫描等）。

| 函数 | 缺失参数 | 策略 |
|---|---|---|
| `applyKnurlDisplacement` | 14 个映射参数 | 构造 mock geometry，在调用点覆盖 |
| `computeUV` | 13 个参数 | 同上 |
| `applyDisplacement` | 14 个参数 | 同上 |
| `projectSheet` | 8 个排版参数 | 构造 view，在调用点覆盖 |
| `resolveImports` | 6 个参数 | 构造 import map，在调用点覆盖 |
| `readZipEntries`/`readZipEntriesAsync` | `maxEntries`/`maxTotalBytes` | 构造 zip buffer 调用 |
| `scanAst`/`scanSource`/`assertSecure` | `nsNames`/`defaultNs` | 构造 AST 调用 |
| `buildSelectorRuntime`/`buildSelectorRuntimeData` | `transform` | 构造 bundle 调用 |
| 其他 | `CadRuntime`/`unitEquals`/`faceRowToHint`/`edgeRowToHint` 等 | 按函数签名补齐 |

## 5. 工作流程（每批次）

1. **选定批次**：按上述分批顺序选择一个批次。
2. **补写测试**：在该包 `test/` 目录下新增或补充测试文件，覆盖缺口中的 API 名和参数。
   - L1：在测试中引用 API 名（import + 调用/引用）。
   - L2：在调用点用对象字面量传入每个缺失参数名。
   - 测试应有真实断言，不允许只写名字无断言的空洞测试。
3. **刷新 baseline**：`npx tsx scripts/check-api-test-coverage.ts --package=<pkg> --generate-baseline`。
4. **验证门禁通过**：`npx tsx scripts/check-api-test-coverage.ts --package=<pkg>`。
5. **跑包测试**：`npm run test -w <pkg>`，确保新测试通过且无 stderr。
6. **提交**：commit message 用 `test(api-coverage): close <N> L1 + <M> L2 gaps in <pkg>`。

## 6. 验收标准

- 所有 8 个包的 `api-coverage-baseline.json` 中 L1 和 L2 缺口均为 0。
- baseline 文件删除后，门禁仍通过：`npx tsx scripts/check-api-test-coverage.ts --package=<pkg>` 输出 `✅ API coverage gate passed` 且无 `known gaps (baseline)`。
- 新增导出 API 或新参数 → CI 立即失败（已由门禁保证）。
- 所有新测试有真实断言，无空洞测试。

## 7. 风险

- **core 批次工作量大**：118 L1 + 50 L2 API（157 参数），需分多个子 PR。
- **L2 测试质量**：参数名出现 ≠ 参数语义正确，需人工确保测试有断言。
- **op 调用构造**：部分 op 需要 BREP/mesh 执行环境，fixture 构造较重；可优先在 `.fai.js` fixture 中补调用（parser 只需解析语法，不需执行）。
- **baseline 漂移**：每次补齐后必须刷新 baseline，否则旧缺口永远留在文件中。
