# 彻底移除 faijs 对 three.js 的运行时依赖 — 收尾设计与使用方边界

- 日期：2026-10-11
- 状态：已实施（2026-10-11 落地，P1–P5 完成，§9 实施结论已记录）
- 前置：`docs/plans/2026-10-11-remove-three-from-core-design.md`（core 去 three 主方案，M0–M4 大部已落地）
- 影响范围：`packages/core`（@faicad/faijs）、`packages/faijs-extra`（@faicad/faijs-extra）；下游联动 `3d_editor`（web/electron/weapp）、`faijs-cadquery`、`faijs-openscad`、`faijs-viewer`

---

## 0. 需求原文（逐字，最原始内容）

> 阅读这份方案（指 `2026-10-11-remove-three-from-core-design.md`），目前已经实施了部分，core应该已经不依赖three.js了，字体和svg的部分暂缓了。现在需要分析本项目到底哪些地方还依赖three.js，如果彻底删除。特别是你要分析本项目对字体和svg的支持，以及../3d_editor项目是如何使用的，还要../faijs_openscad和../faijs_cadquery项目是否依赖本项目提供的字体和svg能力，写一份新的方案，如何彻底让faijs删除对three.js的运行时依赖。使用方如果依赖three.js，应该让它们自己申明和引入。

（注：用户原话中的 `faijs_openscad` / `faijs_cadquery` 实际目录名为连字符形态：`C:\my\Faicad\faijs-openscad`、`C:\my\Faicad\faijs-cadquery`，均独立于 faijs monorepo。）

---

## 1. 现状核实（2026-10-11 磁盘实测）

相对前置方案，当前实际进度：

| 前置方案里程碑 | 状态 | 证据 |
|---|---|---|
| M0 parity 测试链 | ✅ 已落地 | `packages/core/test/math3d/three-parity.test.ts`（three-162 oracle，逐位断言）、`test/mesh/meshdata-parametric.test.ts`（Box/Cylinder/Cone/Sphere 对照）、`test/support/three-162.d.ts` |
| M1 math3d（L0） | ✅ 已落地 | `core/src/math3d/`：Vec2/Vec3/Mat4/Quat/Euler/Plane/Box3；`./math3d` 子路径已导出 |
| M2 meshdata（L1） | ✅ 已落地 | `core/src/mesh/meshdata/`：`parametric.ts`（boxGeometry/cylinderGeometry/coneGeometry/sphereGeometry）、`ops.ts`（toNonIndexed/computeVertexNormals/mergeShapes/transformShape/translateShape）、`weld.ts`；`./mesh/meshdata/parametric`、`./mesh/meshdata/ops` 子路径已导出 |
| M3 core 侧调用点替换 | ✅ 已落地 | `core/src` 生产代码 `from 'three` 导入为 **0**（16 处命中全为注释）；`boolean/cross-section.ts` 已改用 `earcut` + `math3d`（`triangulateWithEarcut`，L2 三角化已完成）；core dist 亦为 0（唯一命中 `brep/handle-bridge.js` 为注释行） |
| M3 L2 批（extra 的 text/svg） | ⏸️ **暂缓** | extra 仍依赖 three，见 §2 |
| M4 依赖收口（core） | ✅ 已落地 | core `peerDependencies` 只剩 `occt-wasm`；`dependencies` 新增 `earcut@^3.2.4`；`devDependencies` 保留 `three-162`（parity oracle）+ `@types/three`（three-162.d.ts shim 用），生产用 `three`(r184) 已删 |
| M5 下游跟进（weapp audit/build） | ⏸️ **未做** | weapp `audit.mjs` 仍断言 worker 内嵌 three r162（当前必然 FAIL）；`build.mjs` 仍有 three 解析规则（handler 1b），见 §5 |
| 既有守卫测试处置 | ✅ 已改造 | `three-surface.test.ts` 已改为断言「three-162 与 @types/three 留在 devDependencies」（peer 断言已删） |

结论：**core（@faicad/faijs）已彻底去 three，剩余工作集中在 faijs-extra 的字体/SVG mesh 链、weapp 审计收口、以及「使用方自申明 three」的边界落地。**

---

## 2. three 依赖全景盘点（faijs 仓库 + 下游，2026-10-11 实测）

### 2.1 faijs monorepo 各包

| 包 | src 中 `from 'three` 导入 | dist 中 three 运行时导入 | peer three | 结论 |
|---|---|---|---|---|
| `packages/core`（@faicad/faijs） | 0（仅注释） | 0（仅注释） | 无 | ✅ 已完成 |
| `packages/faijs-extra`（@faicad/faijs-extra） | **3 文件** | **3 文件**（与 src 同步） | `^0.162.0 || ^0.184.0` | ⏸️ 剩余主体 |
| `packages/sketch`（@faicad/faijs-sketch） | 0 | 0 | 无 | 与 three 无关（草图求解走 planegcs wasm） |
| `packages/faijs-viewer` | 渲染包 | — | `^0.162.0 || ^0.184.0` | 渲染底座，**正当依赖，非目标** |
| `packages/draw`（@faicad/faijs-draw） | 0 | — | 无 | 与 three 无关 |
| `packages/demo` | dev 级 | — | — | 演示宿主，非目标 |

### 2.2 faijs-extra 剩余 three 使用点（全量，6 处 import）

全部集中在 **字体（mesh 链）+ SVG（mesh 链）**：

| 文件 | three import | 用途 | 性质 |
|---|---|---|---|
| `src/extras/text-geometry.ts` | `* as THREE` | opentype 轮廓 → `THREE.Shape` → `ExtrudeGeometry`（curveSegments:6），返回 `THREE.BufferGeometry` | L2 几何生成 |
| `src/extras/text-cjk.ts` | `* as THREE` + `three/examples/jsm/utils/BufferGeometryUtils.js` 的 `mergeGeometries` | 逐字几何 + 合并 | L2 + examples |
| `src/extras/svg-extrude.ts` | `* as THREE` + `three/examples/jsm/loaders/SVGLoader.js` 的 `SVGLoader` + `mergeGeometries` | SVG `d` 解析 → Shape → 拉伸 → 合并 | L2 + examples |

三个文件的消费方（同包内）：

- `src/mesh/primitives.ts`：`text`（cad.text mesh 路径）与 `svgExtrude`（cad.svgExtrude mesh 路径），经 `geoToManifoldMesh` 把 BufferGeometry 转 core `Shape`
- `src/mesh/engrave-decoration.ts`：`cad.engrave` 的 mesh 装饰 provider（text/SVG → Shape），同上转换
- `src/namespace.ts` / `index.ts` / `browser.ts`：完整入口导出 `createTextGeometry` / `createMixedTextGeometry` / `svgToExtrudedGeometry` / `opentypePathToGeometry` 等（**部分被 3d_editor 直接消费**，见 §5）

extra 的 A 组（editor-ops：fai_drill/fai_extrude/fai_split/group/assembly/copy/load）与 `engrave-decoration` 之外的 mesh 层已**无 three 导入**（grep 实测）——weapp worker 打包 `@faicad/faijs-extra/editor-ops` 不再拖 three。

### 2.3 结论

faijs 侧残留 three 的**唯一位置** = extra 的「opentype/Shape/ExtrudeGeometry 文字链」+「SVGLoader 路径链」。这正是前置方案 §3.4 L2 批的「暂缓」项。

---

## 3. 字体与 SVG 能力盘点（本项目提供的全部能力与归属）

### 3.1 字体能力

| 能力 | 位置 | 链 | three-free | 说明 |
|---|---|---|---|---|
| 字体注册/默认字体/加载注入 | `core/src/brep/text/fontRegistry.ts`（`ensureDefaultFont`/`getFont`/`setFontLoader`/`ensureFont`） | brep + mesh 共用 | ✅ | 3d_editor 经 `setFontLoader(new BrowserFontProvider(...))` 注入（`packages/app/src/engine/host/index.ts`）；faijs-cadquery re-export `ensureFont` |
| 字符分类/系统 CJK 字体 | `core/src/primitives/text/cjk-font.ts`（`containsCjk`/`loadSystemCjkFont`） | brep + mesh 共用 | ✅ | 已 three-free |
| brep 文字实体化 | `core/src/brep/text/text-to-solid.ts`（`textToSolid`/`textBlueprints`） | brep | ✅ | opentype → OCCT；faijs-cadquery re-export `textBlueprints` |
| **mesh 文字实体化** | `faijs-extra/src/extras/text-geometry.ts`、`text-cjk.ts` | mesh | ❌ **three** | opentype → `THREE.Shape` → `ExtrudeGeometry`；**这是待迁移主体** |

### 3.2 SVG 能力

| 能力 | 位置 | 链 | three-free | 说明 |
|---|---|---|---|---|
| SVG 自然尺寸解析 | `core/src/primitives/parse-svg-size.ts`（`parseSvgNaturalSize`） | brep + mesh 共用 | ✅ | 两条链已统一走它 |
| **brep SVG 实体化 + 路径解析** | `core/src/brep/svg/svg-to-solid.ts`：`extractSvgPaths`（支持 path/rect/circle/ellipse/line/polyline/polygon + group transform）、`tokenizeSVGPath`（**全命令集** `MmLlHhVvCcSsQqTtAaZz`，arc 用 sagitta 三点圆弧近似，与 brepjs `createStandardArc` 同算法）、`parseSVGPathToWires` | brep | ✅ | **core 内已有自写 SVG 解析器**，mesh 链可直接复用/泛化 |
| **mesh SVG 实体化 + 路径解析** | `faijs-extra/src/extras/svg-extrude.ts`（`SVGLoader`） | mesh | ❌ **three** | 待迁移主体 |

### 3.3 关键事实

1. core 的 brep SVG 解析器已经具备完整命令覆盖（含 A 弧、Q/T/S/C 二次转三次），**不需要移植 SVGLoader**，只需从 `svg-to-solid.ts` 泛化出与 OCCT 无关的「SVG → 2D 轮廓点集」共享模块，brep 链与 mesh 链同源（一个事实一个家）。
2. `meshdata/ops.ts` 的 `mergeShapes`（index 偏移合并）已等价替代 three `mergeGeometries`（text-cjk / svg-extrude 用它）。
3. `boolean/cross-section.ts` 的 `triangulateWithEarcut` 是「earcut 三角化含孔多边形」的现成范式，`meshdata.extrudeShape` 的封盖可直接复用同一写法。
4. meshdata **缺失的 L2 能力**：`extrudeShape`（2D 轮廓拉伸 + 封盖/侧壁）与 `svgPathToContours`（SVG → 轮廓）。这两项是本次方案在 core 侧的全部新增代码。
5. **孔洞/多子路径语义差异**：three `Shape` 的孔洞是显式 `holes` 列表（`SVGLoader.createShapes` 按 evenodd 分组）；自写解析必须明示 fill-rule 支持范围（见 §6 设计）。

---

## 4. 下游使用方分析（谁在用本项目的能力、怎么用）

### 4.1 3d_editor（`C:\my\Faicad\3d_editor`）

**web / Electron 宿主**（`packages/web`、`packages/platform`、`packages/app`）：

- `cad` 命名空间 = `@faicad/faijs-extra/browser` 的 `createEditorCadNamespace()`（`platform/src/web/faijs.worker.ts`、`platform/src/electron/execution-process.ts` 均如此装配）→ **执行侧会携带 text/svgExtrude 两个 op**（其 mesh 实现当前依赖 three）
- **预览层直接消费 extra 的 three 依赖函数**：
  - `app/src/engine/components/engraving/EngravingCore.ts`：`export { createTextGeometry } from '@faicad/faijs-extra/browser'`
  - `app/src/engine/components/engraving/EngravingPreviewLayer.tsx`：`import { createMixedTextGeometry, svgToExtrudedGeometry } from '@faicad/faijs-extra/browser'`——把返回的 `THREE.BufferGeometry` 直接交给 three 场景渲染
- 字体加载：`app/src/engine/host/index.ts` `setFontLoader(new BrowserFontProvider({ defaultFontUrl: ... }))` → **core `fontRegistry` 接口**（不受本方案影响）
- 页面 three 渲染：web/app/scene-kernel 大量 `from 'three'`（viewer/geometry 层）——**渲染底座，正当依赖**

**weapp 小程序宿主**（`packages/weapp`）：

- worker 打包 `src/worker/index.ts` → `@faicad/faijs-extra/editor-ops`（**A 组，无 text/svgExtrude**）；`@faicad/faijs-sketch`（planegcs 求解器，无 three）
- **产物实测**：`miniprogram/workers/faijs.js` 941.1 KB，**已不含 three**（无 r162 版本字面量、无 WebGLRenderer）
- ⚠️ **audit.mjs 过时**：仍断言 worker bundle 内嵌 three r162（`extractThreeRevision` 找不到版本字面量会 throw）——**当前 `npm run audit` 必然 FAIL**，改造方案见 §6.5
- `build.mjs` 的 handler 1b（`onResolve /^three(\/|$)/`）仍解析 three 到本包 0.162——当前不命中（worker 无 three 引用），但规则保留会掩盖回归
- 页面侧：`build-pages.mjs` 的 `ALLOWED_BARE` 登记 `three`（0.162，WebGL1 锁定）+ `threeAnimationBackport` 上游缺陷回填——**页面渲染，正当依赖，自己声明**
- `src/ui/tools.ts` 把 text/screw/svg-extrude/engrave/knurl 列为端侧禁用 op（fonts 端口抛错）——不变

### 4.2 faijs-cadquery（`C:\my\Faicad\faijs-cadquery`，独立仓库）

- **依赖本项目提供的字体能力（brep 链，非 mesh 链）**：
  - `src/adapters/faijs.ts`：`export { ensureFont } from '@faicad/faijs/brep/text/fontRegistry'`、`export { textBlueprints } from '@faicad/faijs/brep/text/text-to-solid'`
  - `src/text-solid.ts`：自包含 CadQuery `Workplane.text`，用 core `textBlueprints` 在 OCCT 上建字形实体，自带 halign/valign/distance 语义（对照 cadquery 2.8.0）
  - `devDependencies` 有 `opentype.js` + `@types/opentype.js`（自己读字体做度量，如 `verticalMetrics`）
- **不依赖 three**（grep 零命中）
- **不依赖 faijs-extra 的字体/SVG mesh 链**（`text-solid.ts` 文件头明确 "NO dependency on the editor-oriented @faicad/faijs-extra"）
- peer：`@faicad/faijs` + `@faicad/faijs-extra` + `@faicad/faijs-sketch` + `occt-wasm`

**结论：faijs-cadquery 只依赖 core 的 brep 文本能力（fontRegistry / text-to-solid），两者均已 three-free，不受本方案影响。**

### 4.3 faijs-openscad（`C:\my\Faicad\faijs-openscad`，独立仓库）

- 功能：OpenSCAD 前端 CSG → 归一 IR → `.fai.js` 代码（transpiler）
- **不依赖字体能力、不依赖 SVG 能力、不依赖 three**（grep 零命中）
- peer：`@faicad/faijs` + `@faicad/faijs-extra`（optional）；唯一 dependency 是 `pngjs`

**结论：faijs-openscad 完全不受影响。**

### 4.4 faijs-viewer / faijs-sketch / faijs-draw

- `faijs-viewer`：peer three（渲染底座，自己声明）——非目标
- `faijs-sketch` / `faijs-draw`：无 three——不受影响

---

## 5. 设计目标与原则

1. **faijs 全家（core + faijs-extra）运行时零 three**：`from 'three`（含 `three/examples/**`）在 `src/` 与 `dist/` 中全部为零；three 从 extra 的 peer/dev 移除。
2. **使用方自申明、自引入 three**：凡需要 three（渲染、预览、几何转换）的使用方（3d_editor 预览层、weapp 页面、faijs-viewer）在自己的 package.json 声明 three，在自己的代码里做「纯数据 → three」的适配，不再由 faijs 代劳。3d_editor web/app/weapp 页面侧已声明 three ✅；唯一需要新做的是预览层的「Shape/GeoData → BufferGeometry」适配（§6.4）。
3. **不改变对外行为契约**：`cad.text` / `cad.svgExtrude` / `cad.engrave` 的输入输出（脚本面）不变；字体来源（fontRegistry）不变；brep 链不动。
4. **可复现性契约不变**：替换的是「产生 mesh 的内部数学实现」，golden 快照 + parity 测试是执法者（延续前置方案 §6 的语义）。
5. **brep 链与 mesh 链同源**：SVG 解析器只保留一份（从 `svg-to-solid.ts` 泛化），不出现两套解析。

---

## 6. 设计方案

### 6.1 P1 — core 补齐 L2 缺失能力（本次方案在 core 侧的全部新增）

**a. 2D 轮廓类型**：`packages/core/src/mesh/meshdata/contour.ts`

```ts
/** 一条 2D 轮廓（外环 + 孔环），与 three Shape 的 outer+holes 对应 */
interface Contour { outer: Vec2[]; holes: Vec2[][] }
```

多子路径（`SVGLoader.createShapes` 返回 `Shape[]` 的情形）用 `Contour[]` 表达，不塌缩。

**b. `extrudeShape`**：`packages/core/src/mesh/meshdata/extrude.ts`（或并入 `parametric.ts`，以评审为准）

```ts
function extrudeShape(contours: Contour[], depth: number, opts?: {
  curveSegments?: number   // 曲线细分，默认 6（对齐 three ExtrudeGeometry 默认）
  bevelEnabled?: false     // 显式不支持 bevel：全仓未用，传 true 抛错（报错好于掩盖）
}): Shape
```

实现要点：
- 封盖（底/顶）：`outer` + `holes` 合并进 earcut（复用 `cross-section.ts::triangulateWithEarcut` 的含孔范式），顶点序与 three `ShapeUtils.triangulateShape` 对照
- 侧壁：轮廓边逐段连接底/顶环，quad 拆 tri；**壁序/法线朝向与 three `ExtrudeGeometry` r162 对照**（顶面朝 +Z、底面朝 -Z 等约定必须逐位对齐）
- 曲线（bezier/arc 采样点）：以 `curveSegments` 细分，采样算法与 three r162 一致

**c. `svgPathToContours`**：从 `core/src/brep/svg/svg-to-solid.ts` **泛化出与 OCCT 无关的共享解析器**，落点 `packages/core/src/primitives/svg/svg-path.ts`（或 `mesh/meshdata/svg-path.ts`，以评审为准）：

- 搬运 `extractSvgPaths`（path/rect/circle/ellipse/line/polyline/polygon + transform）与 `tokenizeSVGPath`（全命令集，arc 三点圆弧近似、quadToCubic）
- 新增「SVG 子路径 → `Contour[]`」：隐式闭合（M 前推）、`Z` 闭合、**孔洞归属**（fill-rule：SVGLoader 按 evenodd 判定孔洞；自写解析器以 `fill-rule` 属性 + evenodd 射线法判定，明示支持范围，缺省按 nonzero 简化处理并在文档标注差异）
- 输出 Y-down → Y-up 翻转（与既有 flipY 一致）
- brep 链改调该共享模块（`svg-to-solid.ts` 保留 OCCT 装配面，解析逻辑不再私有）

**d. golden 对照（先于替换建立）**：`test/mesh/meshdata-extrude.test.ts` 用 `three-162` 的 `ExtrudeGeometry`/`ShapeUtils`/`SVGLoader` 对代表输入（矩形含孔、圆弧轮廓、含 arc/bezier 的 SVG、文本轮廓样本）固化顶点逐位 golden；对照基准 **r162**（与既有 parity 一致）；已知分歧登记进 `KNOWN_DIVERGENCES` 风格清单。

### 6.2 P2 — extra 三文件迁移（去 three 主体）

| 文件 | 替换前 | 替换后 |
|---|---|---|
| `text-geometry.ts` | opentype Path → `THREE.Shape` → `ExtrudeGeometry` → `BufferGeometry` | opentype Path → `Contour[]`（M/L/C/Q/Z 搬运，y 翻转不变）→ `meshdata.extrudeShape` → 返回 **core `Shape`** |
| `text-cjk.ts` | 逐字 `ExtrudeGeometry` + `mergeGeometries` | 逐字 `extrudeShape` + `meshdata.mergeShapes`（已存在）→ `Shape` |
| `svg-extrude.ts` | `SVGLoader` → `Shape` → `ExtrudeGeometry` + `mergeGeometries` | `svgPathToContours` → `extrudeShape` → `Shape` |

- `mesh/primitives.ts`、`engrave-decoration.ts` 的 `geoToShape`（BufferGeometry → manifold）**删除**：`extrudeShape` 直接产 core `Shape`，不再经 three 中转
- `BufferGeometryLike` 适配层移除
- `import * as THREE` / `three/examples/**` 全部移除；`curveSegments: 6` 语义由 `extrudeShape` 默认承接

**导出面调整（破坏性，需联动 §6.4）**：

- `createTextGeometry` / `createMixedTextGeometry` / `svgToExtrudedGeometry` / `opentypePathToGeometry` 返回类型：`THREE.BufferGeometry | null` → **`Shape | null`**
- 消费方（3d_editor 预览层）需要 three 时自行转换（§6.4），faijs 不再提供 three 类型

### 6.3 P3 — extra 依赖收口

```jsonc
// faijs-extra/package.json 最终态
"peerDependencies": {
  "@faicad/faijs": "^0.32.0"      // three 移除
},
"devDependencies": {
  // "three": "^0.184.0" 与 "@types/three": "^0.184.1" 移除
  // 若迁移测试仍需 three-162 对照，按 core 惯例加 "three-162": "npm:three@^0.162.0"
}
```

- 不新增任何第三方依赖（earcut 已在 core，extra 经 `@faicad/faijs/mesh/meshdata/...` 复用）
- `editor-ops` 入口不触达新模块（A 组边界不变，entry-boundary 守卫继续生效）

### 6.4 P4 — 使用方边界落地（3d_editor）

**3d_editor 预览层**（唯一需要新做适配的地方）：

- `EngravingPreviewLayer.tsx` 消费的 `createMixedTextGeometry` / `svgToExtrudedGeometry` 改为返回 `Shape` → 在 3d_editor 侧新增 thin 适配模块（如 `packages/app/src/engine/components/engraving/shape-to-three.ts`）：`shapeToBufferGeometry(shape: Shape): THREE.BufferGeometry`（positions/indices → BufferAttribute，可含 normals）
- `EngravingCore.ts` 的 re-export 同步调整（不再从 faijs-extra 拿 three 类型）
- three 由 3d_editor 自己声明（web/app 已有；确认 electron 执行进程侧如需 three 亦自行声明）
- 3d_editor 其它侧（weapp worker、页面渲染）无需改动或已满足自声明

**weapp 审计/构建收口**：

- `audit.mjs`：删除 worker 侧 three 版本断言（`extractThreeRevision(worker)` 与「worker/页面一致」交叉断言），保留**页面单侧** r162 断言（页面渲染底座）；REVISION_PATTERNS 只查 pages bundle
- `build.mjs`：handler 1b（`/^three(\/|$)/` 解析规则）删除，改为防御性注释（若未来 worker 再出现 three 引用，esbuild 会解析到根 hoisted 184 而当场暴露——正是 audit 单侧断言要防的回归）
- `tools.ts` 禁用 op 清单（text/svg-extrude/engrave/knurl）不变

### 6.5 P5 — 验收（全链路）

1. `grep -rn "from 'three"`（不带闭引号，覆盖 `three/examples/**`）：`core/src`、`core/dist`、`extra/src`、`extra/dist` 全部为零
2. CI 新增 dist 守卫：构建后对 `packages/core/dist` 与 `packages/faijs-extra/dist` 重复第 1 条检查（把「修好了」钉成闸门）
3. 存量测试全绿：`npm run test --workspaces`；golden 快照全绿；`npm run typecheck` / `lint`
4. extra 的 node 环境安装后无需 three 即可跑测试（删 node_modules 的 three 后 vitest 全绿）
5. weapp：`npm run build:worker` + `npm run audit` 全绿（audit 已改单侧）；worker 产物体积复核（当前 941.1 KB 已无 three，迁移后应再降——extra 的 text/svg 不打包进 worker，体积主要验证「无 three 回归」）
6. 3d_editor：web 侧预览层（text/svgExtrude/engrave 预览）走新适配层验证；electron 执行进程 smoke；weapp 页面渲染回归
7. 版本号：移除 peer 依赖不改变包版本号；若同一 PR 另有发版需求，一律走 `set-version.mjs` + `check-lockstep.mjs`（禁止手改）

---

## 7. 风险清单

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | `extrudeShape` 封盖/侧壁的顶点序、法线朝向与 three `ExtrudeGeometry` 不一致（顶/底 winding、壁 quad 拆 tri 顺序） | 高 | P1 先建 golden 对照（r162 基准），逐位断言；M3 式逐文件替换逐文件跑测 |
| R2 | 曲线采样不一致：bezier（Q/T/S/C）细分点、arc 近似（sagitta 三点圆弧 vs SVGLoader 精确椭圆弧参数化）导致 mesh 输出与 three 不同 | 高 | golden 覆盖 arc/bezier 代表输入；arc 采样用 `curveSegments` 细分参数化；对照基准 r162 显式登记分歧 |
| R3 | 孔洞归属语义：SVG `fill-rule`（evenodd/nonzero）与 three `SVGLoader.createShapes` 的孔洞分组不一致 | 中 | 自写解析明示支持范围（evenodd 射线法），缺省 nonzero 并文档标注差异；golden 覆盖含孔 SVG |
| R4 | extra 导出面返回类型变更（BufferGeometry → Shape）破坏 3d_editor 预览层调用点 | 中 | §6.4 列出全部调用点（EngravingCore / EngravingPreviewLayer）；适配层在 3d_editor 侧，先改调用点再发版 |
| R5 | weapp audit 过时断言在改造前让 `npm run audit` 持续 FAIL，被误读为「构建坏了」 | 中 | P4 与本方案同 PR 改造 audit（先删 worker 侧断言再验证）；文档注明现状 audit 必败 |
| R6 | SVG 解析器泛化时 brep 链回归（解析逻辑从 `svg-to-solid.ts` 抽出） | 中 | 抽模块后 brep 链既有测试全绿；解析器输出与旧实现对照（同函数搬移，非重写） |
| R7 | `mergeShapes` 与 three `mergeGeometries` 行为差异（attribute 保留、index 类型）被间接依赖 | 低 | text-cjk 迁移时对逐字合并结果做 golden 对照；core `mergeShapes` 已存在且经过测 |
| R8 | 历史 `.fai.js` 脚本依赖 `cad.text`/`cad.svgExtrude` 内部细节（如输出顶点序） | 低 | op 层输入输出不变（脚本面契约）；golden 对照保证顶点序一致 |

---

## 8. 设计边界（哪些不动）

1. **3d_editor 页面/渲染层、faijs-viewer 的 three**：渲染底座，使用方自己声明（已经声明），与本方案无关
2. **faijs-sketch / faijs-draw**：无 three，不动
3. **faijs-cadquery 的 brep 文本链**（fontRegistry/text-to-solid re-export + 自带 opentype 度量）：已 three-free，不动；**它不依赖 extra 的字体/SVG mesh 链**，故不受 P2 影响
4. **faijs-openscad**：完全不接触字体/SVG/three，不动
5. **core 的 brep 链（text-to-solid / svg-to-solid 的 OCCT 装配面）**：行为不变；仅 SVG 解析逻辑物理搬移到共享模块（同函数搬移）

---

## 9. 待评审问题（实施结论）

1. 落点：`meshdata/contour.ts` + `meshdata/extrude.ts`（extrudeShape）与 `primitives/svg/svg-path.ts`（SVG 语法层+折线化，含 extractSvgPaths/parsePathToSubpaths/classifyNested 等）；brep 侧 `brep/svg/svg-to-solid.ts` 已改为 import 共享实现
2. bevel：确认不支持（全仓无人传），入口不暴露该参数
3. 测试：golden 快照用**几何等价断言**（顶点/法线集合逐位），不搬 three 内部 Earcut（其 npm 版与内置版凹多边形划分不同）；`expectWatertight` 用坐标 key 无向边计数
4. 适配归属：3d_editor 自持有 `shapeToBufferGeometry.ts`（双向转换，含 normals/excludeWeight 传递）
5. 孔洞 fill-rule：evenodd 全支持（classifyNested 分类），logo.svg 实跑验证通过
6. weapp audit 单侧断言（worker 无 three + 页面内嵌 r162）保留，已落地
