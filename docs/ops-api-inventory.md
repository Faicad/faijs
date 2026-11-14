# faijs Language API Reference (AI / User Coding Manual)

English | [中文](ops-api-inventory.zh.md)

> 本手册由 `scripts/gen-ops-api-inventory.ts` 自动生成。**不要手改**——改 api JSDoc 后运行生成器（或 CI 的 `--check` 会拦截不一致）。
>
> 逐 op 章节有两个来源：**手写 op** 取 `api/**/*.ts` 的 `@group` JSDoc 契约；**生成 op** 取 `api/surface/arg-spec.ts`（与其派生的 `script-face-manifest.ts` 同源），章节里以「自动派生」标出。生成器会断言章节符号集 == `lang/symbol-table.generated.ts` 键集，缺章即失败。
>
> - ✅ = 此接口正确、可放心使用
> - ⚠️ = 可用，但参数有已知缺陷
> - ❌ = 接口错误，**禁止使用**，等重做
> - 🚫 = **已废弃（deprecated）**，勿在新代码中使用
>
> 🚫 标记的 op 是 `../3d_editor` 项目特有的操作，不属于 faijs 平台面；将来会迁往该项目并从 faijs 删除。
>
> 相关文档：`docs/language-design.md`（语言与执行契约）、`docs/api-contract.md`（语句层内部契约）。

---

## 1. 三个 API 面

faijs 的 API 分三个面，消费者和形态各不同：

| 面 | 消费者 | 形态 | 位置 |
|---|---|---|---|
| ① TS 兼容面 | 第三方库（TS 代码，如 faijs-gears / sheetmetal） | brepjs 原样：位置参数 + `Result` 原生；同名同签名；`Sketcher` / `Blueprint` / `draw` DSL；`ok` / `err` / `isErr` / `pipe` 组合子 | `@faicad/faijs` 主导出（`packages/core/src/api/brepjs-compat/`） |
| ② cad 脚本面 | `.fai.js`（UI / AI 生成代码） | `cad.*` 对象参数；语句边界 `Result` unwrap（err → 语句失败）；产物 = faijs `Shape`（mesh 载荷 + BREP 槽） | `cad` 命名空间（经门面 `createRuntime` 注入） |
| ③ 库边界面 | `registerLib` 注册的第三方库导出函数 | 库作者写纯 brepjs 代码；入口 `Shape` 原样直传，出口 `Solid` → 收养，`Result` 原样传递 | `runtime.registerLib(binding, ns, { autoLift: true })` |

**参数双形态（D11）**：① TS 面与 ② 脚本面是同一批函数，位置 / 对象两种形态都可用。明显可区分的参数用单名（如 `box`），人类看来不明显的用两个名字（如 `rotate_euler`）。

> 下方 § 3–§ 8 的逐 op 手册仅覆盖 ② 脚本面（`cad.*` 函数）。① TS 兼容面的符号清单见 `packages/core/src/api/brepjs-compat/index.ts`；③ 库边界面的使用方法见 `docs/library-dev-guide.md`。

---

## 2. 错误体系

faijs 对外 API 全面采用 `Result` / `BrepError` 体系（`ok` / `err` / `isOk` / `isErr` / `map` / `andThen` / `unwrap`）。在 ② 脚本面，语句边界自动 unwrap：`err` 转为带语句上下文的执行失败（`ExecutionResult.failedAt`），存量 `.fai.js` 脚本零修改。在 ① TS 兼容面，`Result` 原生传递，库作者用 `isErr` / `map` / `andThen` 组合。

| 面 | Result 处置 | 消费者写法 |
|---|---|---|
| ① TS 兼容面 | 原样返回 `Result<T>` | `const r = fuse(a, b); if (isErr(r)) …` |
| ② cad 脚本面 | 语句边界 unwrap | `let p = cad.union(a, b)` — err → 语句失败 |
| ③ 库边界面 | 库内原样；边界 unwrap | 库内 `err` → 边界 unwrap → 脚本层语句失败 |

> 相关契约：`docs/api-contract.md` § 7（三个库契约面、库接纳）和 § 8（几何契约）定义了 op 与库函数的分派规则。

---

## 2.5 基元锚点约定（跨 op 设计决定）

基元 op 遵循 CAD 拉伸语义：**默认底面/角点落在原点平面上，沿 +Z 延伸**——`box` 是角点 (0,0,0) 在原点，`cylinder` / `cone` 是底面轴心在原点。`centered: true` 是显式非默认选项（底面落到 −h/2），仅在确实想把实体居中到原点时才传；生成脚本 / 手写脚本的预期写法是**不带 `centered`**。`at`（cylinder/cone 为 BASE、box 为 CENTER）优先级最高，同时覆盖前两者。

```js
let plate = cad.box(100 * MM, 80 * MM, 10 * MM)          // 角点在原点，+Z 向上
let shaft = cad.cylinder(5 * MM, 40 * MM)                // 底面轴心在原点，+Z 向上
let shaft2 = cad.cylinder(5 * MM, 40 * MM, { at: [0, 0, 10 * MM] })  // 显式定位
```

涉及 op：`box`、`cylinder`、`cone`、`makeBaseBox`。

---

## 2.5 外观方法（Shape 实例方法，非 op）✅

外观（颜色/材质/透明度）设置是 **Shape 实例方法**，不是 `cad.*` op。脚本写法：

```js
let box1 = cad.box(10, 10, 10)
box1.setColor('#e53935')                    // hex: #rgb / #rrggbb / #rrggbbaa；或数组 [r,g,b] / [r,g,b,a]（sRGB 0–1）
box1.setOpacity(0.5)                        // 透明度权威字段 0–1；#rrggbbaa / [r,g,b,a] 的 alpha 等价 opacity
box1.setMaterial({ metalness: 0.8, roughness: 0.2, transmission: 1, ior: 1.5 })
let a1 = box1.getAppearance()               // 读当前外观（可能 undefined）
```

- 方法集：`setAppearance(spec)` / `setColor(color)` / `setMaterial(spec)` / `setOpacity(opacity)` / `getAppearance()`。
- 语义：原地合并 `{...cur, ...spec}`（`undefined` 字段保留旧值），返回 `this`；**脚本面一次一条 `setX` 语句**（解析器只识别单层成员调用，链式 `a.setColor(...).setMaterial(...)` 脚本面不支持；TS 库面可链式）。
- 产物数据：`Shape.appearance`（`PbrAppearance`，JSON 可序列化）随 mesh/brep 双链路产物传递；几何 op 产物默认继承第一个携带外观的几何输入；编辑器渲染读 `shape.appearance`。
- 颜色值内部归一为 sRGB 0–1 数组；CSS 颜色名不支持（P1）。
- 注：旧 `return { shape, color, metalness, roughness }` 三字段通道已删除（死特性），`ScriptMetaIR.appearance` 不存在；return 对象未知 key 静默忽略。

---

## 3. 创建类操作（无上游输入）

### 3.1 `approximatePoints` ✅

点集**逼近**曲线：过点但不严格插值（逼近容差内贴合，产平滑 B 样条）。 与 `interpolatePoints`（严格插值）成对的数学对偶路径。

```js
const c = cad.approximatePoints([[0,0,0],[5,3,0],[10,0,0]])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `points` | `Vec3[]` | ✅ | — | 点集 [x,y,z][]（≥2 点） |
| `tolerance` | `number` |  | 1e-3）。type:number required:false | 逼近容差（mm， |

**同步**。Shape 1D 逼近曲线（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 approximatePoints，tolerance 缺省 1e-3）。

### 3.2 `box` ✅

创建长方体（brepjs 契约）。

```js
const part0 = cad.box(10 * MM, 20 * MM, 30 * MM)
const part1 = cad.box(30 * MM, 20 * MM, 10 * MM, { at: [15 * MM, 10 * MM, 0], segments: 64 })
位置原生：`box(width, depth, height)` 与 `box(10 * MM, 20 * MM, 30 * MM, { at: [1, 2, 3] })`
有量纲位必须写单位字面量（基准单位亦然，`10` 这类裸数字会被拒）。
两种写法归一到同一对象（位置→对象 + 尾参 options 合并）。旧 `{ size }` 对象形态已废弃，
传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容）。
锚点：默认角点在原点、底面贴地，`box(w, d, h)` ≡ `box(w, d, h, { at: [w/2, d/2, 0] })`。
`at` 与 `align` 正交：`at` 只管"锚点落在哪"，`align` 只管"包围盒哪一侧贴上去"
（`align:'min'` = 角点落在 at，`['center','center','max']` = 顶面落在 at）。
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `width` | `number` | ✅ | — | X 方向边长（mm） |
| `depth` | `number` | ✅ | — | Y 方向边长（mm） |
| `height` | `number` | ✅ | — | Z 方向边长（mm） |
| `at` | `[x,y,z] 可选` |  | 锚点 = 底面中心，BASE 语义，与 cylinder/cone 一致）。type:[x,y,z] 可选 | 锚点落点（ |
| `align` | `string|string[]?` |  | 有 at 时 ['center','center','min']，无 at 时 'none'（角点在原点） | 包围盒哪一侧贴到 at：'min'|'center'|'max'|'none'，或 [X,Y,Z] 逐轴 |
| `centered` | `boolean` |  | false | `align:['center','center','center']` 的语法糖（与 align 同给报 E_ANCHOR_CONFLICT） |
| `segments` | `number` |  | 64（= brepjs standard 等效） | 细分度（影响三角化） |

**同步**。Shape 长方体几何，可作为后续 op 的输入。

### 3.3 `circleArc` ✅

构造圆弧：圆心 + 法向 + 半径 + 起止角（度，绕法向右手逆时针）。

```js
const a = cad.circleArc([0,0,0], [0,0,1], 5, 0, 90)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `center` | `Vec3` | ✅ | — | 圆心 [x,y,z] |
| `normal` | `Vec3` | ✅ | — | 圆面法向 [x,y,z]（非零） |
| `radius` | `number` | ✅ | — | 半径（mm，>0） |
| `startAngle` | `number` | ✅ | — | 起始角（度，自法向基准 X 方向起量） |
| `endAngle` | `number` | ✅ | — | 终止角（度） |

**同步**。Shape 1D 圆弧（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 makeCircleArc）。角度单位是**度**（内部换算弧度 传给 occt 的 Geom_TrimmedCurve）。

### 3.4 `cone` ✅

创建圆锥体（brepjs 契约）。radiusTop 等于 radiusBottom 时即圆柱，0 为尖锥。 锚点：`at` 只表"锚点落在哪"（默认锚点 = **底面轴心**，BASE 语义，底面在原点、+Z 延伸）； `align` 表"包围盒哪一侧贴上去"，`centered:true` ≡ `align:['center','center','center']`。

```js
const c = cad.cone(10, 4, 30)
const c = cad.cone(10, 0, 30, { at: [0, 0, 20], segments: 64 })
位置原生：`cone(10, 4, 30)` 与 `cone(10, 4, 30, { at: [0, 0, 20] })`
归一到同一对象（位置→装箱 + 尾参 options 合并）。旧 `{ center }`/`{ size }` 对象形态
已废弃，传入会抛 E_ARGS_FORM（错误提示 ≠ 兼容）。
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radiusBottom` | `number` | ✅ | — | 底半径（mm） |
| `radiusTop` | `number` | ✅ | — | 顶半径（mm），0 为尖锥，非负，等于 radiusBottom 得圆柱 |
| `height` | `number` | ✅ | — | 高度（mm），沿 +Z 轴 |
| `at` | `[x,y,z] 可选` |  | 锚点 = 底面轴心，BASE 语义）。type:[x,y,z] 可选 | 锚点落点（ |
| `align` | `string|string[]?` |  | ['center','center','min'] | 包围盒哪一侧贴到 at：'min'|'center'|'max'|'none'，或 [X,Y,Z] 逐轴 |
| `centered` | `boolean` |  | false | `align:['center','center','center']` 的语法糖（与 align 同给报 E_ANCHOR_CONFLICT） |
| `segments` | `number` |  | 64（= brepjs standard 等效） | 细分度（影响三角化） |

**同步**。Shape 圆锥体几何，可作为后续 op 的输入。

### 3.5 `convexHull` ✅

点集构造 → Result(Solid)，单产物，brep-op

```js
convexHull(points: Vec3[]): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `points` | `Vec3[]` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/hullFns.ts#convexHullBrep`。

### 3.6 `cylinder` ✅

创建圆柱体（brepjs 契约）。 锚点：`at` 只表"锚点落在哪"（默认锚点 = **底面轴心**，BASE 语义，底面在原点、+Z 延伸）； `align` 表"包围盒哪一侧贴上去"，`centered:true` ≡ `align:['center','center','center']`。

```js
const c = cad.cylinder(5, 40)
const c = cad.cylinder(5, 40, { at: [0, 0, 20], segments: 64 })
位置原生：`cylinder(5, 40)` 与 `cylinder(5, 40, { at: [0, 0, 20] })`
归一到同一对象（位置→装箱 + 尾参 options 合并）。旧 `{ center }` 对象形态已废弃，
传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容）。
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | `number` | ✅ | — | 底面半径（mm） |
| `height` | `number` | ✅ | — | 高度（mm），沿 +Z 轴 |
| `at` | `[x,y,z] 可选` |  | 锚点 = 底面轴心，BASE 语义）。type:[x,y,z] 可选 | 锚点落点（ |
| `align` | `string|string[]?` |  | ['center','center','min'] | 包围盒哪一侧贴到 at：'min'|'center'|'max'|'none'，或 [X,Y,Z] 逐轴 |
| `centered` | `boolean` |  | false | `align:['center','center','center']` 的语法糖（与 align 同给报 E_ANCHOR_CONFLICT） |
| `segments` | `number` |  | 64（= brepjs standard 等效） | 细分度（影响三角化） |

**同步**。Shape 圆柱体几何，可作为后续 op 的输入。

### 3.7 `draftPrism` ✅

拔模棱柱：把平面基底（face 或 wire）沿方向挤出，并施加拔模角（上下截面渐变）。

```js
const s = cad.draftPrism(squareFace, [0, 0, 10], 5)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `base` | `Shape` | ✅ | — | 平面基底（face 或闭合 wire） |
| `direction` | `Vec3` | ✅ | — | 挤出方向 [dx,dy,dz]（非零；长度即挤出距离） |
| `angleDeg` | `number` | ✅ | — | 拔模角（度） |

**同步**。Shape 拔模挤出体。

> 平台 op：仅 occt 引擎（原生 draftPrism，形参即 angleDeg——角度单位是**度**， 原生内部换算）。角度为 0 时等价普通挤出。

### 3.8 `dxfExtrude` ⚠️

从二维 DXF 轮廓挤出零件（拓扑操作）。

```js
const s = cad.dxfExtrude({ dxf: 'logo.dxf', depth: 5, targetLongSide: 20 })
```

```js
const s = cad.dxfExtrude({ dxf: 'logo.dxf', depth: 5, targetLongSide: 20, faceCenter: [0, 0, 15], faceNormal: [0, 0, 1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `dxf` | `string` | ✅ | — | DXF 内容：资产 key（推荐）或整份 DXF 文本（兼容） |
| `depth` | `number` | ✅ | — | 挤出深度（mm）；允许负值，负值=沿 -Z 负向拉伸（凹陷口袋，与草图负向拉伸同逻辑） |
| `targetLongSide` | `number` |  | 20 | 长边目标尺寸（mm） |
| `faceCenter` | `[x,y,z]` |  | — | 面心（给了就贴在该面上：轮廓中心落此处、厚度朝面外） |
| `faceNormal` | `[x,y,z]` |  | — | 面外法向（与 faceCenter 配套；缺省 [0,0,1]） |

**异步**。Shape DXF 挤出几何，生成独立零件。

> DXF 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份文件内联拷贝。轮廓解析用本仓自带的 ASCII DXF 解析器（LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE + bulge 圆弧 + INSERT 展开），不引入任何第三方 DXF 库；尺寸语义由调用方给 `targetLongSide` 长边归一（DXF 图纸单位不可信，不读 $INSUNITS）。
>
> faceCenter 只有 BREP 实现：mesh 几何上传 faceCenter 会显式报错（不静默忽略）。不给 faceCenter 时保持历史行为（XY 居中、Z 底部对齐原点）。

### 3.9 `edge` ✅

两顶点构造边。顶点入参可以是 vertex Shape，也可以是 `[x,y,z]` 点 （点经 `makeVertex` 物化成顶点再配边）。

```js
const e = cad.edge([0,0,0], [10,0,0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `v1` | `Shape|Vec3` | ✅ | — | 第一个顶点（vertex Shape 或 [x,y,z]） |
| `v2` | `Shape|Vec3` | ✅ | — | 第二个顶点（vertex Shape 或 [x,y,z]） |

**同步**。Shape 1D 直线边（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 makeEdge，L1 契约只有 makeLineEdge 等按几何构造）。 非 occt 引擎执行前报错；brep_mock 不拦截。

### 3.10 `ellipseArc` ✅

构造椭圆弧：中心 + 法向 + 长短半轴 + 起止角（度）。

```js
const a = cad.ellipseArc([0,0,0], [0,0,1], 10, 5, 0, 90)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `center` | `Vec3` | ✅ | — | 椭圆中心 [x,y,z] |
| `normal` | `Vec3` | ✅ | — | 椭圆面法向 [x,y,z]（非零） |
| `majorRadius` | `number` | ✅ | — | 长半轴（mm，>0） |
| `minorRadius` | `number` | ✅ | — | 短半轴（mm，>0 且 <= 长半轴） |
| `startAngle` | `number` | ✅ | — | 起始角（度） |
| `endAngle` | `number` | ✅ | — | 终止角（度） |

**同步**。Shape 1D 椭圆弧（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 makeEllipseArc）。角度单位是**度**（内部换算弧度）。

### 3.11 `ellipseEdge` ✅

构造整椭圆边：中心 + 法向 + 长半轴 + 短半轴。

```js
const e = cad.ellipseEdge([0,0,0], [0,0,1], 10, 5)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `center` | `Vec3` | ✅ | — | 椭圆中心 [x,y,z] |
| `normal` | `Vec3` | ✅ | — | 椭圆面法向 [x,y,z]（非零） |
| `majorRadius` | `number` | ✅ | — | 长半轴（mm，>0） |
| `minorRadius` | `number` | ✅ | — | 短半轴（mm，>0 且 <= 长半轴） |

**同步**。Shape 1D 椭圆边（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 makeEllipseEdge）。要求 majorRadius >= minorRadius。

### 3.12 `ellipsoid` ✅

纯数值整件构造（rx/ry/rz → ValidSolid），brep-op

```js
ellipsoid(rx: number, ry: number, rz: number, options?: EllipsoidOptions): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `rx` | `number` | ✅ | 数值 / 选项参数 |
| `ry` | `number` | ✅ | 数值 / 选项参数 |
| `rz` | `number` | ✅ | 数值 / 选项参数 |
| `options` | `EllipsoidOptions` |  | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/primitiveFns.ts#ellipsoidBrep`。

### 3.13 `faceFromWire` ✅

平面 wire → face：由闭合平面 wire 构造面（可选孔 wire）。

```js
const rect = cad.wire([[0,0,0],[10,0,0],[10,6,0],[0,6,0]], { closed: true })
const face = cad.faceFromWire(rect)
const box = cad.extrude(face, 5)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `wire` | `Shape` | ✅ | — | 闭合平面 wire Shape（`cad.wire` / `cad.wireFromEdges` / `cad.outerWire` 等产物） |
| `holes` | `Shape[]` |  | — | 可选孔 wire 列表（落在面内，经 addHolesInFace） |

**同步**。Shape 平面 face（可显示、可被 extrude/revolve/thicken 消费）。

> 中立 op：L1 makeFace 两引擎 dialect（brepkit 侧 makeFaceFromWire）。 平面限定——非平面 wire 抛 E_FACE_FROM_WIRE_NOT_PLANAR（走 cad.nonPlanarFace）。

### 3.14 `faceOnSurface` ✅

在已有曲面上建面：以宿主面（承载曲面）为底，用曲面上的闭合 wire 圈出新面。

```js
const f = cad.faceOnSurface(cylFace, boundaryWire)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `hostFace` | `Shape` | ✅ | — | 宿主面（承载曲面） |
| `wire` | `Shape` | ✅ | — | 曲面上的闭合边界 wire |

**同步**。Shape 新建的面。

> 平台 op：仅 occt 引擎（原生 makeFaceOnSurface，L1 契约无对应成员）。 非 occt 引擎执行前报错；brep_mock 不拦截。

### 3.15 `halfSpace` ✅

构造无限半空间实体（无界布尔工具）。

```js
const half = cad.halfSpace({ origin: [0, 0, 5], normal: [0, 0, 1] })
const lower = cad.cut(part0, half)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `origin` | `Vec3` | ✅ | — | 边界平面上一点 [x,y,z]（mm） |
| `normal` | `Vec3` | ✅ | — | 边界平面法向 [x,y,z]（非零；保留侧 = 法向所指侧） |

**同步**。Shape 无限半空间实体（brep 句柄有效、mesh 为空）。

> 平台 op：仅 occt 引擎（原生 halfSpace，L1 契约无对应成员）。非 occt 引擎 执行前报错；brep_mock 不拦截。产物是**无界实体**：面载荷为空（无有限面可 离散），单独渲染无意义，用法是喂给布尔 op 作工具 （`cad.cut(part0, cad.halfSpace({ origin: [0,0,5], normal: [0,0,1] }))` 切出 z<=5 的一半）。

### 3.16 `helix` ✅

构造螺旋线（1D 曲线）。

```js
const h = cad.helix({ radius: 5, pitch: 2, turns: 3 })
const lh = cad.helix({ radius: 5, pitch: 2, turns: 3, handed: 'left' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | `number` | ✅ | — | 螺旋半径（mm，>0） |
| `pitch` | `number` | ✅ | — | 螺距（mm，≠0） |
| `turns` | `number` | ✅ | — | 圈数（>0） |
| `axis` | `Vec3` |  | +Z）。type:Vec3 required:false | 螺旋轴方向（ |
| `origin` | `Vec3` |  | 原点）。type:Vec3 required:false | 起点（ |
| `handed` | `HelixHanded` |  | ）或 'left'。type:HelixHanded required:false | 手性：'right'（ |

**同步**。Shape 1D 螺旋线（kind:'curve'）。

> 全平台中立 op：手性是 L1 `makeHelixWire` 的形参（`leftHanded`）——右手两引擎都可建（brepkit 侧为采样拟合近似）；左手仅 occt 原生支持，brepkit 适配器显式失败（不镜像兜底）。

### 3.17 `import_brep` ✅

平台 BREP 资产导入：把容器 `assets/` 里的冻结 BREP 载体装成持 OCCT 句柄的 Shape。 `asset` = 资产名（去扩展名，沿用 `FsAssetResolver` 的 `key = basename(file)` 规则）， 由宿主资产解析器按 key 解析（与 `cad.load` 同套解析器）。

```js
const a = cad.import_brep({ asset: 'Array001.Shape' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `asset` | `string` | ✅ | — | 容器资产名（去扩展名） |

**异步**。Promise<Shape> 持 OCCT 句柄的几何（非实体亦可）。

> 非实体一等（C6）：wire/face/shell 一律可导入，本 op 不设 `allowNonSolid` 一类开关。需要实体的 op（布尔、up-to 目标面）在**使用点**报错，而不是在导入点拒绝。
>
> 这是**平台**资产导入 op。编辑器 `cad.load` 是 `../3d_editor` 的「文件导入 Feature」（key/path/url 三键分流 + 画布语句位置语义），平台侧不要复用它（C7）。
>
> GOTCHA（2026-09-30）：必须经 defineOp 包装进入 cad 命名空间，不能是裸 async 函数。part 键 roleTable（outputTablesByPart）只在 define-op.ts 包装层的 brep 分支登记（shape.ts attachBrep 只落语句键表，因为 fromBrep 时刻 shape 还没被 executor 命名）。裸函数产物没有 part 键表 → 下游 place 的 inputRoleTable（tableOfPart）拿到 undefined → place 产物 roleTable 断流 → edgeRef 报 "input shape has no role table (nameless shape)"（fcstd 语料 43 例，如 ISO4032_Hex_Nut_M10 的 chamfer(Pocket001__place)）。

### 3.18 `import_step` ✅

api import_step — 任意路径 STEP 文件导入 op 与 `import_brep`（容器资产）和 `cad.load`（编辑器 FileRef）的职责切分： - `cad.import_step` 是 faijs **平台**几何 op：单一本地路径（宿主 `resolveFile`）， OCCT STEPControl_Reader 读入，返回持 OCCT 句柄 + roleTable 的 Shape。 - `import_brep` 读的是容器 `assets/` 里的冻结 BREP 资产（key，去扩展名）； `cad.load` 是 `../3d_editor` 的「文件导入 Feature」（key/path/url 三键分流、 画布语句位置语义），平台侧不要复用它（C7）。 非实体（wire/face/shell）一等公民（C6，对齐 import_brep）：始终 allowNonSolid。 STEP 是 BREP 专属格式：mesh / 无内核模式抛 E_BREP_UNSUPPORTED。

```js
const a = cad.import_step({ path: 'D:/models/box.step' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `path` | `string` | ✅ | — | 本地绝对路径（宿主 resolveFile 解析） |

**异步**。Promise<Shape> 持 OCCT 句柄的几何（非实体亦可）。

> 平台 STEP 导入 op。读文件经宿主资产解析器（`assets.resolveFile`），与 `cad.load` 同一通道；语义为「任意路径 STEP → OCCT 读入的 Shape」。
>
> 非实体一等（C6）：wire/face/shell 一律可导入。需要实体的 op（布尔、up-to 目标面）在**使用点**报错。
>
> GOTCHA（2026-09-30）：与 import_brep 同——必须经 defineOp 包装进入 cad 命名空间，不能是裸 async 函数。part 键 roleTable（outputTablesByPart）只在 define-op.ts 包装层的 brep 分支登记；裸 async 函数产物没有 part 键表，下游 place/edgeRef 报 "input shape has no role table (nameless shape)"。

### 3.19 `interpolateWithTangents` ✅

点集**插值**曲线，带端点切向约束（三次 B 样条，过全部点且端点切向指定）。

```js
const c = cad.interpolateWithTangents([[0,0,0],[5,3,0],[10,0,0]], [1,0,0], [1,0,0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `points` | `Vec3[]` | ✅ | — | 点集 [x,y,z][]（≥2 点） |
| `startTangent` | `Vec3` | ✅ | — | 起点切向 [x,y,z]（非零） |
| `endTangent` | `Vec3` | ✅ | — | 终点切向 [x,y,z]（非零） |

**同步**。Shape 1D 插值曲线（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 interpolatePointsWithTangents）。两端切向非零。

### 3.20 `liftCurve2d` ✅

把 2D 点集抬升到指定平面上，构造平面 wire。

```js
const w = cad.liftCurve2d([[0,0],[10,0],[10,5]], [0,0,0], [0,0,1], [1,0,0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `points2d` | `Array` | ✅ | — | 2D 点集 [[x,y], …]（≥2 点） |
| `planeOrigin` | `Vec3` | ✅ | — | 平面原点 [x,y,z] |
| `planeZ` | `Vec3` | ✅ | — | 平面法向 [x,y,z]（非零） |
| `planeX` | `Vec3` | ✅ | — | 平面内 X 轴方向 [x,y,z]（非零） |

**同步**。Shape 平面上的 wire（登记为 kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 liftCurve2dToPlane，L1 契约无对应成员）。 非 occt 引擎执行前报错；brep_mock 不拦截。 坐标收 `[x,y]` 数对（脚本面习惯），内部转成上游的 `{x,y}` 对象； planeZ/planeX 须非零且互不平行。

### 3.21 `load` ✅ 🚫

加载几何资产。`file` 指定资产名（用户上传文件名，不含路径、含后缀），内容经宿主资产解析器按名解析，**引用而非拷贝**。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用的「文件导入 Feature」提供——`file` 读的是应用侧资产库（按用户上传文件名注册），产物语句位置与命名都是画布语义。不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。2026-10-06 起多零件文件不再单零件收敛——全量以 compound + `ExecutionResult.importModels` 返回；宿主按 `importModel.parts` 身份批量建 part。

```js
const p = cad.load({ file: 'box.stl' })
const p = cad.load({ file: 'box.3mf' })
const p = cad.load({ file: 'model.step' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `file` | `string` |  | — | 资产文件名（用户上传名，不含路径、含后缀，如 'vise.3mf'）；内容按名从宿主资产库取 |
| `unit` | `string` |  | — | **强制设置模型的源单位**：仅对无内部单位声明的 mesh 格式 （STL/3MF）有效——提供即覆盖/忽略模型内部记录的单位（3MF `<model unit>`）， 按指定单位折算坐标；只有调用方确实知道单位时才提供（用户手写脚本）。未提供 时：STL faijs 启发式（guessStlUnit）、3MF 文件声明。**STEP/BREP 不支持**—— 走 OCCT 链、单位由文件内部声明决定（读取时折算），提供 unit 直接报错 |

**异步**。Shape 加载的几何，永远是 part 的第一条语句，后面可接特征链。

> 语言正常化后 loadFile/loadUrl/loadByKey 别名已删除（A4），统一为 `load` 一个函数。
>
> 格式由 `file` 后缀白名单自判：stl/3mf → mesh 路径；step/stp/stpz/brep → BREP 路径。宿主不再传 `format`。
>
> 后缀白名单未命中 → 报错（不猜格式）；3MF 后缀会做 zip 魔数 sanity（后缀与内容明显不符时报错）。
>
> 本 op 要求导入物含实体（历史契约）。非实体（wire/face/shell）的导入是平台 `cad.import_brep` 的一等能力，不由本 op 承担。

### 3.22 `makeBaseBox` ✅

```js
(xLength: number, yLength: number, zLength: number) -> Shape3D
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `xLength` | `number` | ✅ | 数值 / 选项参数 |
| `yLength` | `number` | ✅ | 数值 / 选项参数 |
| `zLength` | `number` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `sketching`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/primitiveFns.ts#makeBaseBoxBrep`。

### 3.23 `makeSolid` ✅

把已闭合的壳升为实体（输入是壳，不做缝合——缝合链见 `sewAndSolidify`）。

```js
const s = cad.makeSolid(closedShell)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shell` | `Shape` | ✅ | — | 已闭合的壳 |

**同步**。Shape 实体。

> 平台 op：仅 occt 引擎（原生 makeSolid）。输入须为闭合 shell。

### 3.24 `nonPlanarFace` ✅

由非平面闭合 wire 构造面（L1 `makeFace` 只处理平面 wire；本 op 补非平面缺口）。

```js
const f = cad.nonPlanarFace(curvedBoundaryWire)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `wire` | `Shape` | ✅ | — | 闭合边界 wire（可非平面） |

**同步**。Shape 构造出的面。

> 平台 op：仅 occt 引擎（原生 makeNonPlanarFace）。wire 须闭合。

### 3.25 `pipe` ✅

沿脊柱扫出管：把截面沿脊柱 wire 扫掠（`BRepOffsetAPI_MakePipe` 裸管线； 带过渡/方向控制的扫掠见 `sweep`）。 产物类型随截面类型（实测钉住，test/api/occt-s4-solid-offset.test.ts A3/A4）： **截面 face → 实体；截面 wire/edge → 壳（管面，体积无意义）**。要实体管， 喂面截面（如 `cad.profile` 的圆盘轮廓）。

```js
const tube = cad.pipe(diskFace, spineWire)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `profile` | `Shape` | ✅ | — | 截面（face → 实体；wire/edge → 壳） |
| `spine` | `Shape` | ✅ | — | 脊柱 wire |

**同步**。Shape 扫出的管（截面 face → 实体；wire/edge → 壳）。

> 平台 op：仅 occt 引擎（原生 pipe，L1 契约无对应成员）。脊柱须为 wire。 非 occt 引擎执行前报错；brep_mock 不拦截。

### 3.26 `profile` ✅

从 2D 轮廓构造平面（creator，无输入）。仅 BREP 可用。

```js
const f = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }] })
const w = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }], as: 'wire' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `contours` | `ProfileLoop[]|Blueprint|Blueprint[]` | ✅ | — | 有序 2D 轮廓（线段/圆弧；外环 + 孔），或已绘制轮廓（单个 Blueprint 或其数组） |
| `as` | `'face'|'wire'` |  | ）构面；'wire' 逐链交 wire（单链 1D 曲线，多链 compound）。type:'face'|'wire' required:false | 产物形态：'face'（ |

**同步**。Shape 平面几何（mesh 三角化 + BREP 句柄）；`as:'wire'` 时返回 1D 曲线（kind:'curve'，多链为 wire compound）。

### 3.27 `punchHole` ✅

`cad.punchHole`: cut a face-placed 2D profile out of a solid.

```js
// loop = 一个闭合 2D 轮廓：{ segments: [{ kind: 'line', x1, y1, x2, y2 }, ...] }
const plate = cad.punchHole({ contours: [loop], on: cad.box(40, 40, 4), face: '>Z' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `contours` | `any[]` | ✅ | — | ordered 2D closed contours (the hole profile). |
| `on` | `Shape` | ✅ | — | the target solid to punch. |
| `face` | `any` | ✅ | — | host face: FaceTopoRef（UI 拾取产物字面量）| 面选择器字符串（如 ">Z"，在 on 上解析，多面命中抛错）| 1 起序号（仅网格链/当前内核快照，禁止用于生成脚本） |
| `height` | `number|object` |  | — | blind depth along the face inward normal (null/absent = through). |
| `draftAngle` | `number` |  | — | wall taper in degrees (default 0 = straight; built as an occt loft frustum). |
| `scaleMode` | `string` |  | — | UV mapping: 'original' | 'bounds' | 'native'. |

**同步**。Shape with the profile punched out of `on`.

### 3.28 `screw` ✅

生成螺丝零件（螺纹 + 头型）。

```js
const s = cad.screw({ spec: 'M16', length: 40 })
const s = cad.screw({ spec: 'M16×1.5', length: 40, head: 'hex' })
const s = cad.screw({ spec: 'M16', thread: 'none', length: 40 })
```

```js
const s = cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex' })
const s = cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex', nRad: 64 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `system` | `'metric' | 'imperial'` | ✅ | — | 制式 |
| `specIdx` | `number` | ✅ | — | 规格索引（决定公称直径，如 5 → M5、6 → M6） |
| `spec` | `string` |  | — | 描述性螺纹规格串（推荐，如 'M16'、'M16×1.5'、'1/4"-20'、'M16-6g'）。给出时为规格唯一来源：缺省取粗牙；不可与 system/specIdx/pitchCustom 或 thread（'none' 除外）同给，违者 E_ARG；解析失败 E_THREAD_SPEC（错误信息附最近表项建议，绝不自动应用）。OCR 变体白名单同 `fai_drill` 的 `thread` 参数（NFKC 等价、形近字映射、数字逗号小数、公差等级唯一修复；白名单外显式拒绝） |
| `thread` | `'coarse' | 'fine' | 'custom' | 'none'` |  | 'coarse' | 螺纹类型 |
| `length` | `number` | ✅ | — | 螺杆长度（mm） |
| `head` | `'hex' | 'chc' | 'none'` |  | 'none' | 头型（hex 六角 / chc 沉头 / none 无头） |
| `pitchCustom` | `number` |  | — | 自定螺距（thread='custom' 时用） |
| `nRad` | `number` |  | 32 | 径向分段数（拓扑参数） |

**异步**。Shape 螺丝几何，生成独立零件。

> nRad 是拓扑参数不是渲染参数：mesh 路径直接决定分段数；BREP 路径用精确曲面，nRad 仅作 BREP→mesh 三角化角度提示（angular deflection ≈ 2π/nRad）。.fai.js 默认 32 不输出，非默认才输出以保证可复现。
>
> pitchCustom 执行层已支持（makeScrew/threadBrep 均读取），codegen 曾不序列化（TODO）；当前已机械输出。

### 3.29 `sdf` ⚠️

用 SDF（符号距离场）函数生成网格体（mesh-only）。

```js
const s = cad.sdf({ code: 'return sphere(10) - sphere(5, [10,0,0])', box: [[-20,-20,-20],[30,20,20]], resolution: 1 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `code` | `string` | ✅ | — | SDF 函数源码（`sdf(x,y,z)` 定义或标题模板调用，如 'return sphere(10) - sphere(5, [10,0,0])'） |
| `box` | `[[minX,minY,minZ],[maxX,maxY,maxZ]]` |  | [[-10,-10,-10],[10,10,10]] | 采样包围盒 |
| `resolution` | `number` |  | 1.0 | 网格单元边长（越小越精细） |
| `params` | `object` |  | — | 参数数值表（SDF 里引用的变量值） |

**异步**。Shape SDF 生成的网格体，生成独立零件。

> SDF 无 BREP 实现（mesh-only）；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError。SDF 天生是网格操作，允许网格参数（resolution）。

### 3.30 `sketch` ✅

Sketch (semantic shapes / geometry + constraints) → solve → face / outer wire. 两条入口（二选一）： - `shapes`：语义图元（矩形/圆/……/画笔图元/close）→ 库面 `expandShapes` 展开成 canonical 几何 + 形状自带约束，再与调用方给的 `constraints` 合并求解； - `geoms`：直接给展开后的 canonical 几何（存量语句形态）。 Permanently brep-only: the mesh path reports `E_MESH_UNSUPPORTED`. Sketch APIs never get a mesh path — industry precedent (CadQuery, FreeCAD) solves sketches onto exact BREP edges.

```js
const plate = cad.sketch({
plane: 'XY',
shapes: [
{ kind: 'rect', w: 100, d: 60, tag: 'g0' },
{ kind: 'circle', r: 10, cx: 30, cy: 20, tag: 'hole', mode: 's' },
],
constraints: [{ kind: 'length', of: { tag: 'g0.0' }, value: 100 }],
})
```

```js
const f = cad.sketch({
geoms: [{ tag:'bottom', kind:'line', x1:0, y1:0, x2:80, y2:3 }],
constraints: [{ kind:'horizontal', of: { tag:'bottom' } }, { kind:'length', of: { tag:'bottom' }, value: 80 }],
})
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `SketchShape[]` |  | — | 语义图元清单（与 geoms 二选一） |
| `geoms` | `SketchGeom[]` |  | — | 展开后的草图几何（线段/圆/圆弧，与 shapes 二选一） |
| `constraints` | `SketchConstraint[]` |  | — | 草图约束（可空；追加在形状自带约束之后） |
| `as` | `'face'|'wire'` |  | ）构面；'wire' 只交外环 wire。type:'face'|'wire' required:false | 产物形态：'face'（ |
| `plane` | `string` |  | 'XY'；如 'XZ' / 'YZ'）。type:string required:false | 放置目标命名平面（ |

**异步**。Shape 平面几何（求解后构面）；`as:'wire'` 时返回外环 1D 曲线。

### 3.31 `sketchOnFace` ✅

`cad.sketchOnFace`: place 2D contours on a **planar** face of a solid and construct a Shape. Engine-neutral (no `engines` declaration): works on the OCCT BREP engine, the brepkit BREP engine, and the brepkit mesh backend. **网格链**（`meshEngines: ['brepkit']`）：`on` 是网格实体 时，轮廓按面自己的**平面框**铺放（原点 = 面包围盒中心、法向 = 面法向），产物是一张 网格链面，可直接交给 `cad.extrude` 拉伸。该分支只接受平面面、只接受默认 `scaleMode`（`'bounds'`/`'native'` 相对 UV 域定义，网格链上没有 UV 域）、只接受 `as:'face'`、且只接受单个轮廓岛——每一条越界都以 `E_MESH_SOLID_UNSUPPORTED` 说明原因。

```js
// loop = 一个闭合 2D 轮廓：{ segments: [{ kind: 'line', x1, y1, x2, y2 }, ...] }
const face = cad.sketchOnFace({ contours: [loop], on: cad.box(20, 20, 10), face: '>Z' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `contours` | `any[]` | ✅ | — | ordered 2D closed contours (same shape as `cad.profile`). |
| `on` | `Shape` | ✅ | — | the target solid on which the face lives. |
| `face` | `any` | ✅ | — | the host face: FaceTopoRef（UI 拾取产物字面量）| 面选择器字符串（如 ">Z"，在 on 上解析，多面命中抛错）| 1 起序号（仅网格链/当前内核快照，禁止用于生成脚本） |
| `scaleMode` | `string` |  | — | UV mapping: 'original' (identity) | 'bounds'/'native' (affine-fit; OCCT planar only). |
| `as` | `string` |  | — | `'face'` (default) or `'wire'` (outer loop only). |

**同步**。Shape on the target face (face, or a wire curve when `as:'wire'`).

### 3.32 `sketchOnPlane` ✅

`cad.sketchOnPlane`: place 2D contours on a plane and construct a Shape.

```js
// loop = 一个闭合 2D 轮廓：{ segments: [{ kind: 'line', x1, y1, x2, y2 }, ...] }
const face = cad.sketchOnPlane({ contours: [loop], plane: 'XY' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `contours` | `any` | ✅ | — | ordered 2D contours (same shape as `cad.profile`: segment loops, or a drawn `Blueprint`). |
| `plane` | `any` | ✅ | — | named plane (`'XY'` / `'XZ'`…) or `{ origin, normal, xAxis }`. |
| `as` | `string` |  | — | `'face'` (default) or `'wire'` (one wire per input chain; compound when multiple). |

**同步**。Shape on the target plane (face / face compound, or wire / wire compound when `as:'wire'`).

### 3.33 `sketchOnSurface` ✅

`cad.sketchOnSurface`: place 2D contours on a face of a solid via UV-conform placement and construct a Shape. Curved/UV-conform variant of `cad.sketchOnFace` (which is now planar-only and engine-neutral). This op maps the contour into the face's `(u,v)` domain and snaps it to the surface, a step that needs the OCCT BREP platform, hence `engines: ['occt']`.

```js
// loop = 一个闭合 2D 轮廓：{ segments: [{ kind: 'line', x1, y1, x2, y2 }, ...] }
const sk = cad.sketchOnSurface({ contours: [loop], on: cad.cylinder(20, 30), face: '>Z', scaleMode: 'original' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `contours` | `any[]` | ✅ | — | ordered 2D closed contours (same shape as `cad.profile`). |
| `on` | `Shape` | ✅ | — | the target solid on which the face lives. |
| `face` | `any` | ✅ | — | the host face: FaceTopoRef（UI 拾取产物字面量）| 面选择器字符串（如 ">Z"，在 on 上解析，多面命中抛错）| 1 起序号（仅网格链/当前内核快照，禁止用于生成脚本） |
| `scaleMode` | `string` |  | — | UV mapping: 'original' (identity) | 'bounds'/'native' (affine-fit). |
| `as` | `string` |  | — | `'face'` (default) or `'wire'` (outer loop only). |

**同步**。Shape on the target face (face, or a wire curve when `as:'wire'`).

### 3.34 `sphere` ✅

创建球体。

```js
const r = cad.sphere({ radius: 10 })
const r = cad.sphere(10, { at: [0, 0, 10], segments: 64 })
const r = cad.sphere({ radius: 10, segments: 64, center: [0,0,10] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | `number` | ✅ | — | 半径（mm） |
| `segments` | `number` |  | 64（= brepjs standard 等效） | 细分度（影响面数） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 球心位置（at 的同义别名） |
| `at` | `` |  | — | 球心位置（center 的同义别名，brepjs 契约；双形态合法） |
| `align` | `string|string[]?` |  | 'center'（球心落在该点） | 包围盒哪一侧贴到球心位置：'min'|'center'|'max'|'none'，或 [X,Y,Z] |

**同步**。Shape 球体几何，可作为后续 op 的输入。

### 3.35 `surface` ✅

由控制点阵构造 B 样条曲面。

```js
const s = cad.surface({ points: [[-5,-5,0],[5,-5,0],[-5,5,0],[5,5,0]], rows: 2, cols: 2 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `points` | `Vec3[]` | ✅ | — | 控制点阵（`rows * cols` 个 `[x, y, z]`，按行优先展开） |
| `rows` | `number` | ✅ | — | 控制点行数（整数 >= 2） |
| `cols` | `number` | ✅ | — | 控制点列数（整数 >= 2） |

**同步**。Shape 曲面（面产物，可作 thicken/sweep 的输入）。

> 平台 op：仅 occt 引擎（原生 bsplineSurface）。非 occt 引擎执行前报错；brep_mock 不拦截。

### 3.36 `svgExtrude` ⚠️

从二维 SVG 轮廓挤出零件（拓扑操作）。

```js
const s = cad.svgExtrude({ svg: 'logo.svg', depth: 5, targetLongSide: 20 })
```

```js
const s = cad.svgExtrude({ svg: 'logo.svg', depth: 5, targetLongSide: 20, faceCenter: [0, 0, 15], faceNormal: [0, 0, 1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `svg` | `string` | ✅ | — | SVG 内容：资产 key（推荐）或整份 SVG 文本（兼容） |
| `depth` | `number` | ✅ | — | 挤出深度（mm）；允许负值，负值=沿 -Z 负向拉伸（凹陷口袋，与草图负向拉伸同逻辑） |
| `targetLongSide` | `number` |  | 20 | 长边目标尺寸（mm） |
| `faceCenter` | `[x,y,z]` |  | — | 面心（给了就贴在该面上：轮廓中心落此处、厚度朝面外） |
| `faceNormal` | `[x,y,z]` |  | — | 面外法向（与 faceCenter 配套；缺省 [0,0,1]） |

**异步**。Shape SVG 挤出几何，生成独立零件。

> SVG 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份 XML 内联拷贝。自然尺寸（viewBox）与缩放已显式成参数（mesh/BREP 两条路径都解析 viewBox 并传递 naturalWidth/naturalHeight），尺寸语义不再依赖两套实现各自推导。
>
> faceCenter 只有 BREP 实现：mesh 几何上传 faceCenter 会显式报错（不静默忽略）。不给 faceCenter 时保持历史行为（XY 居中、Y 底部对齐原点）。

### 3.37 `tangentArc` ✅

构造圆弧：过起点、以给定切向出发、终于终点（GC_MakeArcOfCircle 语义）。

```js
const a = cad.tangentArc([0,0,0], [1,0,0], [5,5,0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `start` | `Vec3` | ✅ | — | 起点 [x,y,z] |
| `tangent` | `Vec3` | ✅ | — | 起点切向 [x,y,z]（非零，不必单位化） |
| `end` | `Vec3` | ✅ | — | 终点 [x,y,z] |

**同步**。Shape 1D 圆弧（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 makeTangentArc）。切向为零向量非法。

### 3.38 `text` ⚠️

生成文字零件（文字轮廓挤出，X/Z 居中、Y 底部对齐原点）。

```js
const t = cad.text({ text: 'Hello', size: 20, depth: 5 })
```

```js
const t = cad.text({ text: 'Hello', size: 20, depth: 5, faceCenter: [0, 0, 15], faceNormal: [0, 0, 1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `text` | `string` | ✅ | — | 要生成的文字 |
| `size` | `number` | ✅ | — | 字号（mm） |
| `depth` | `number` | ✅ | — | 挤出深度（mm）；允许负值，负值=沿 -Z 负向拉伸（凹陷口袋，与草图负向拉伸同逻辑） |
| `font` | `string` |  | 默认字体 | 字体 |
| `faceCenter` | `[x,y,z]` |  | — | 面心（给了就贴在该面上：文字中心落此处、厚度朝面外） |
| `faceNormal` | `[x,y,z]` |  | — | 面外法向（与 faceCenter 配套；缺省 [0,0,1]） |

**异步**。Shape 文字几何，生成独立零件。

> font 语义未定（当前只有默认字体），⚠️ 暂不要传。兼容 `cad.text(part0, {...})` 带输入形态（输入被忽略），正常写 `cad.text({...})` 即可。
>
> faceCenter 只有 BREP 实现：mesh 几何上传 faceCenter 会显式报错（不静默忽略）。不给 faceCenter 时保持历史行为（X 居中、Y 底部对齐原点）。

### 3.39 `thread` ✅

仅参数构造 → Result(Shape3D)，单产物，brep-op

```js
thread(options: ThreadOptions): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `ThreadOptions` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/threadFns.ts#threadBrepOp`。

### 3.40 `torus` ✅

```js
(majorRadius: number, minorRadius: number, options?: TorusOptions)
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `majorRadius` | `number` | ✅ | 数值 / 选项参数 |
| `minorRadius` | `number` | ✅ | 数值 / 选项参数 |
| `options` | `TorusOptions` |  | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/primitiveFns.ts#torusBrep`。

### 3.41 `wedge` ✅

创建楔形体。唯一契约是 width/height/angle/length（width/height/angle 为正数，length 沿切割方向）， 旧文档的 size 形态已废弃，传 { size } 会抛错。

```js
const w = cad.wedge({ width: 30, height: 20, angle: 45, length: 10 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `width` | `number` | ✅ | — | 底面宽度（mm） |
| `height` | `number` | ✅ | — | 高度（mm） |
| `angle` | `number` | ✅ | — | 楔形角度（度） |
| `length` | `number` | ✅ | — | 沿切割方向的长度（mm） |

**同步**。Shape 楔形体几何，可作为后续 op 的输入。

> 曾与 UI 面板的 `size` 形态并存并写入文档，但断言层确认唯一合法契约是 width/height/angle/length；传 `{ size }` 直接抛错。已按真源收敛。

### 3.42 `wire` ✅

从点列构造 1D 曲线（折线 / 闭合轮廓 / 平滑样条）。

```js
const w = cad.wire([[0,0,0],[10,0,0],[10,10,0]], { closed: true })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `points` | `Vec3[]` | ✅ | — | 有序点列 [[x,y,z], ...]，至少 2 点 |
| `closed` | `boolean` |  | — | 闭合轮廓（首尾相连） |
| `smooth` | `boolean` |  | 折线）。type:boolean required:false | 平滑曲线（B-样条穿过全部点， |
| `degree` | `number` |  | 3）。type:number required:false | smooth 时的样条次数（ |

**同步**。Shape 1D 曲线（kind:'curve'，无三角载荷；显示经 wireframe）。

### 3.43 `wireFromEdges` ✅

边列表 → wire：把有序边 Shape 组装成一条 wire（1D 曲线）。

```js
const e1 = cad.edge([0,0,0],[10,0,0])
const e2 = cad.edge([10,0,0],[10,10,0])
const w = cad.wireFromEdges([e1, e2])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edges` | `Shape[]` | ✅ | — | 有序边 Shape 列表（`cad.edge` / `cad.circleArc` / `cad.tangentArc` 等产物），至少 2 条 |
| `closed` | `boolean` |  | false 开链合法）。type:boolean required:false | 要求闭合链（组装后校验首尾相连，不闭合抛 E_WIRE_FROM_EDGES_NOT_CLOSED |

**同步**。Shape 1D 曲线（kind:'curve'）。

> 中立 op：L1 makeWire 两引擎同实现。顺序敏感——按入参顺序组装， 不做端点排序；连接性由内核校验，失败抛内核错误。

---

## 4. 变换类操作（inputs ≥ 1）

### 4.1 `alignTo` ✅

把形状沿某一轴平移，使其包围盒的指定锚点落到目标坐标。

```js
// 把零件放到 XY 平面上（最低点抬到 z=0）
const flat = cad.alignTo(part0, 'z')
// 居中：把 x 方向的包围盒中点移到 0
const centered = cad.alignTo(part0, 'x', { target: 0, anchor: 'center' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被对齐的形状 |
| `axis` | `string` | ✅ | — | 对齐的目标轴（x/y/z） |
| `target` | `number` |  | ）。type:number required:false | 目标坐标（缺省交由原生 |
| `anchor` | `string` |  | ）。type:string required:false | 包围盒锚点 min|center|max（缺省交由原生 |

**同步**。Shape 对齐后的形状。

> 平台 op：仅 occt 引擎（原生 alignX/alignY/alignZ，L1 契约无对应成员）。 非 occt 引擎执行前报错；brep_mock 不拦截。 输入的原形状**不会被改动**——原生返回新句柄。

### 4.2 `applyMatrix` ✅

faijs 用 applyTransform（不同名），整件矩阵变换 → brep-op

```js
applyMatrix(shape: Shape, matrix: unknown): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `matrix` | `unknown` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> **任意仿射变换就是这样做的**——等价 OpenSCAD `multmatrix`：`matrix` 是**行主序 4×4**（四个 `[x,y,z,w]` 行组成的数组，底行必须 `[0,0,0,1]`，否则报错），如绕 Z 转 90° 的 `cad.applyMatrix(b, [[0,-1,0,0],[1,0,0,0],[0,0,1,0],[0,0,0,1]])`；也可给结构形态 `{ linear: 9 个数（行主序）, translation: [tx,ty,tz] }`。线性部分行列式 ≈ 0（不可逆）报错；正交等长行（旋转 + 等比缩放）走仿射快路径，其余走通用变换。下游常误判「faijs 不具备任意仿射能力」，实为本 op 此前未进手册所致。
>
> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/topologyFns.ts#applyMatrixBrep`。

### 4.3 `locate` ✅

faijs 无同名，整件定位变换 → brep-op

```js
locate(shape: Shape, placement: unknown): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `placement` | `unknown` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/topologyFns.ts#locateBrep`。

### 4.4 `offset` ✅

faijs 无同名偏置 → brep-op

```js
offset(shape: Shape, distance: number): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `distance` | `number` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/topologyFns.ts#offsetBrep`。

### 4.5 `place` ✅

刚性放置几何体：旋转（四元数，绕局部原点）后平移。两者皆可缺省 = 恒等。

```js
const p = cad.place(part0, { rotation: [0, 0, Math.sin(Math.PI/4), Math.cos(Math.PI/4)], position: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `rotation` | `[number,number,number,number]` |  | — | 旋转四元数 [x,y,z,w]（Hamilton，绕局部原点） |
| `position` | `[number,number,number]` |  | — | 平移向量 [x,y,z]（mm） |

**同步**。Shape 放置后的几何（持 OCCT 句柄，可继续变换/导出）。

### 4.6 `rotate` ✅

faijs rotate 已更名 rotate_euler（faijs 面只导出 rotate_euler），上游轴角 rotate 空出 → brep-op 进脚本面（§5.1 D-ROTATE / §4.7）。⚠️ cad.rotate 是 brep-only（compatOp 契约：mesh 模式/断链抛错，从不回退），3d_editor UI 不得暴露；将来暴露前必须先补 mesh 实现。

```js
rotate(shape: Shape, angle: number, options?: { at?, axis? }): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `angle` | `number` | ✅ | 数值 / 选项参数 |
| `options` | `{ at?, axis? }` |  | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/topologyFns.ts#rotateBrep`。

### 4.7 `rotate_euler` ✅ 🚫

绕轴旋转几何体。angles 为欧拉角（度，XYZ 顺序）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p2 = cad.rotate_euler(part0, { angles: [0, 0, 45] })
const p3 = cad.rotate_euler(part0, { angles: [0, 0, 45], pivot: [0,0,0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `angles` | `[x,y,z]` | ✅ | — | 欧拉角（度，XYZ 顺序） |
| `pivot` | `[x,y,z]` |  | 原点 | 旋转中心 |

**同步**。Shape 旋转后的几何。

### 4.8 `scale` ✅ 🚫

等比缩放几何体（brepjs 契约）。factor 只收 number；不动点默认 原点（与旧 `scale(shape, factor, { center? })` 一致），`center` 可选。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p4 = cad.scale(part0, 2)
const p5 = cad.scale(part0, { factor: 2, center: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `factor` | `number` | ✅ | — | 等比缩放系数（> 0） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 缩放不动点（p 保持不动） |

**同步**。Shape 缩放后的几何。

### 4.9 `scale3d` ✅ 🚫

非等比缩放几何体（faijs 语义）。factor 定死 vec3 — 等比缩放请用 `scale(p, s)`，`scale3d(p, [x,y,z])` 才可非等比。`center` 为不动点（默认原点）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p4 = cad.scale3d(part0, { factor: [2, 1, 1] })
const p5 = cad.scale3d(part0, [2, 1, 1], { center: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `factor` | `[x,y,z]` | ✅ | — | 三轴缩放系数（均 > 0） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 缩放不动点 |

**同步**。Shape 缩放后的几何。

### 4.10 `translate` ✅ 🚫

平移几何体。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p1 = cad.translate(part0, { offset: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `offset` | `[x,y,z]` | ✅ | — | 平移向量（mm） |

**同步**。Shape 平移后的几何，装配的相对位置靠成员的变换语句表达。

---

## 5. 特征类操作（inputs ≥ 1）

### 5.1 `boolean` ✅

通用布尔运算：一次调用对 args / tools 两组形状做布尔，并支持粘连、模糊容差与 结果简化选项（脚本面的 union/subtract/intersect 是无选项形态）。

```js
// 两盒相减（第二个盒作为工具）
const hollow = cad.boolean([boxA], [boxB], 'cut')
// 带容差的 union（近乎重合的面会被合并）
const joined = cad.boolean([p1, p2], [p3], 'fuse', { fuzzyValue: 1e-4 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `args` | `Shape[]` | ✅ | — | 参与运算的形状（≥1） |
| `tools` | `Shape[]` | ✅ | — | 工具形状（≥1） |
| `kind` | `string` | ✅ | — | 算子 fuse|cut|common |
| `glue` | `number` |  | — | 共面粘连模式 0|1|2 |
| `fuzzyValue` | `number` |  | — | 模糊容差（模型单位） |
| `simplifyAngularTolerance` | `number` |  | — | 同域合并角阈值（ANGLE 量纲，写 `1 * DEGREE`；内核收弧度） |

**同步**。Shape 布尔结果。

> 平台 op：仅 occt 引擎（原生 booleanOp，L1 契约无对应成员）。 非 occt 引擎执行前报错；brep_mock 不拦截。 血缘：原生只回扁平的面 hash 列表（modified/generated/deleted），不是 输入面→结果面的映射，无法构造 faceEvolution，故 naming 为 unmodeled。

### 5.2 `boss` ✅

Shapeable<Shape3D> → Result<T>，brep-op

```js
boss(shape: Shape, options: BossOptions): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `options` | `BossOptions` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/compoundFns.ts#bossBrep`。

### 5.3 `chamfer` ✅

在几何体上倒角（等距 / 双距 / 距角）。

```js
const p = cad.chamfer(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], type:'equal', width:1 })
// AI 生成可写 CadQuery 边选择器字符串
const p2 = cad.chamfer(part0, { edges: "|Z", type:'equal', width:1 })
const q = cad.chamfer(meshPart, { edges: [3], type:'equal', width:1 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edges` | `EdgeTopoRef[]|string` | ✅ | — | 参与倒角的边：CadQuery 边选择器字符串（如 "|Z"，AI 生成）或相邻两面的 role 线路（EdgeTopoRef[]，UI 拾取产物） |
| `type` | `string` | ✅ | — | 倒角类型（equal | twoDistances | distanceAngle） |
| `width` | `number` |  | 1 | type=equal: 倒角宽度（mm） |
| `width1` | `number` |  | — | type=twoDistances: 沿 faces[0] 侧距离（mm） |
| `width2` | `number` |  | — | type=twoDistances: 沿 faces[1] 侧距离（mm） |
| `angle` | `number` |  | — | type=distanceAngle: 与参考面夹角（度，(0,90)） |

**异步**。Shape 倒角后的几何。

> BREP 输入走完整三形态；**网格实体**输入只支持 `equal` / `distanceAngle` （`twoDistances` 需要 role 可解析的邻面，近似拓扑没有 role）。 `width1` 沿 faces[0] 侧、`width2` 沿 faces[1] 侧（BREP 路径）。

### 5.4 `circularPattern` ✅

环形阵列：绕 axis 复制 count 份（含原位置），第 k 份转过 k·angleStep。

```js
const p = cad.circularPattern(part0, [0, 0, 1], 6)
const arc = cad.circularPattern(part0, [0, 0, 1], 4, 30)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `axis` | `[x,y,z]` | ✅ | — | 旋转轴方向 |
| `count` | `number` | ✅ | — | 副本总数（含原位置） |
| `angleStep` | `number` |  | — | 相邻两份夹角（度，缺省 360/count） |
| `center` | `[x,y,z]` |  | — | 旋转轴上一点（缺省原点） |

**异步**。Shape 所有副本 fused 后的几何。

> BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[k]/<inner>`。

### 5.5 `clone` ✅

深拷贝句柄：返回独立副本（源保留）。

```js
const p = cad.clone(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|

**异步**。Shape 克隆的新几何。

> BREP-only。keep 语义：不消费输入（薄 override 委托生成 op，行为不变）。

### 5.6 `complexExtrude` ✅

wire → Result(Shape3D)，brep-op

```js
complexExtrude(wire: Shape, center: Vec3, normal: Vec3, profile?: ExtrusionProfile): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `wire` | `Shape` | ✅ | 几何输入（Shape） |
| `center` | `Vec3` | ✅ | 数值 / 选项参数 |
| `normal` | `Vec3` | ✅ | 数值 / 选项参数 |
| `profile` | `ExtrusionProfile` |  | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/sweepFns.ts#complexExtrudeBrep`。

### 5.7 `copy` ✅ 🚫

深拷贝几何为独立新对象（源不变，源与副本都显示）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（语义含编辑器画布显示——源与副本各显示一份），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const part1 = cad.copy(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|

**同步**。Shape 源几何的深拷贝。copy 不消费其源（画布显示 box 和副本两份），改副本不影响源。

### 5.8 `cut` ✅

Boolean cut (subtract): remove `tool` from `base` — {@link subtract} 的别名。 brepjs 兼容名。与 `subtract` 是同一个函数对象（同一实现、同一 schema、同一 消费语义），`cut(a, b)` ≡ `subtract(a, b)`；变参形态同样适用（`cut(a, b, c)` 从 a 中依次减去 b、c）。

```js
const b = cad.cut(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（第一个为主体） |

**异步**。Shape base 依次减去其余输入。

### 5.9 `draft` ✅

拔模：对选定面施加拔模斜度（铸造/注塑出模角）。

```js
// faces 取 UI 拾取产物的 FaceTopoRef 字面量；❌ 禁止 cad.faceRef 序号（跨内核不可移植）
const d = cad.draft(part0, { faces: pickedFaces, angleDeg: 3 })
// AI 生成可写 CadQuery 面选择器字符串（"|Z" 法向平行 Z 的面）
const d2 = cad.draft(part0, { faces: "|Z", angleDeg: 3 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `faces` | `FaceTopoRef[]|string` | ✅ | — | 拔模面：面选择器字符串（如 "|Z"，AI 生成）或 FaceTopoRef[]（UI 拾取产物字面量；禁止 cad.faceRef 序号） |
| `angleDeg` | `number` | ✅ | — | 拔模角（度，≠0） |
| `pull` | `Vec3` |  | +Z）。type:Vec3 required:false | 拔模方向（ |
| `neutral` | `{point:Vec3,normal?:Vec3}` |  | — | 中性面**点**（{point}；normal 无消费者） |

**异步**。Shape 拔模后的几何。

> **occt-only**（`engines: ['occt']`；实证收窄，非平台依赖——见文件头实证： brepkit 破坏对称性且部分 ordinal 静默无操作）。`neutral`（中性点）**只支持 原点**：occt-wasm 原生 `draft(shape, face, angleRad, direction)` 没有 neutral 形参，传非原点中性点会显式报错（不静默产出错几何）；brepkit 已被静态拒绝， 故非原点 `neutral` 当前**没有任何可用引擎**——需要该语义时请改用 `pull` + 面上一点建模。仅 BREP 可用（mesh 输入执行前报错）。

### 5.10 `drill` ✅

Shapeable<Shape3D> → Result<T>，brep-op

```js
drill(shape: Shape, options: DrillOptions): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `options` | `DrillOptions` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/compoundFns.ts#drillBrep`。

### 5.11 `extrude` ✅

沿 normal 拉伸几何（面 → 棱柱）。 up-to 模式（`upTo`）与长度模式（`length`）二选一；长度模式委托生成投影 （brepjs extrude 为唯一引擎），up-to 模式走半空间组合。 **网格链**（`meshEngines: ['brepkit']`，方案 2026-10-01 §4 Phase 3）：输入是 `cad.sketchOnFace` 在网格实体识别面上铺出的网格链面时，本 op 沿同一份方向语义 拉伸出**一个新的网格零件**。网格链上不支持 `upTo` （需精度链求交裁切）——会以 `E_MESH_SOLID_UNSUPPORTED` 明确拒绝，不静默当定长拉伸。

```js
const p = cad.extrude(part0, [0, 0, 10])
const p = cad.extrude(part0, { length: 10 })
// upTo 接受 FaceTopoRef（UI 拾取产物字面量）；❌ 禁止 cad.faceRef 序号（跨内核不可移植）
const p = cad.extrude(sk, { upTo: pickedUpToFace })
const p = cad.extrude(sk, { upTo: 'last', baseFeature: part0 })
// AI 生成可写 CadQuery 面选择器字符串（在 baseFeature 上解析）
const p = cad.extrude(sk, { upTo: '>Z', baseFeature: part0 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `length` | `number` |  | — | 总拉伸量（mm，>0）。up-to 模式下无需给 |
| `normal` | `[x,y,z]` |  | [0,0,1] | 拉伸方向（世界坐标） |
| `mode` | `'forward' | 'backward'` |  | 'forward' | 沿 normal 的前进方向：forward 正向 / backward 反向 |
| `backwardLength` | `number` |  | 0 | 负向长度（mm，≥0，缺省 0 = 单向）。>0 时与 length 组成双向拉伸（输入面成为棱柱内部平面）；与 mode:'backward' / upTo 互斥 |
| `upTo` | `'last' | 'first' | FaceTopoRef | string` |  | — | 拉伸到面：FaceTopoRef（UI 拾取产物字面量）指定面 / 'last' 支持体远端面 / 'first' 近端面 / 面选择器字符串（如 ">Z"，在 baseFeature 上解析，多面命中抛错）。提供时忽略 length。❌ 禁止 cad.faceRef 序号 |
| `baseFeature` | `Shape` |  | — | upTo 'last'/'first'/面选择器的支持体几何（累积支持体） |
| `offset` | `number` |  | 0 | 截断面沿其法向的偏移（mm） |

**异步**。Shape 拉伸后的几何。

### 5.12 `fai_drill` ✅ 🚫

在几何体上钻孔（CSG 减除）。depth=0 为通孔，>0 为盲孔。 孔型三选一（`holeType`）： - `simple`：光孔（圆柱）； - `screw`：**建模螺纹**——几何里真的切出螺旋牙； - `tapped`：**攻丝孔**——几何只钻底孔，螺纹信息进 PMI（`PmiThreadHole`， 底孔 + 螺纹同属一条标注）。`diameter` 可省略，按「公称直径 − 螺距」反算（M6 → Φ5）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载（3d_editor 38 个文件在用）。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p = cad.fai_drill(part0, { diameter: 5 })
const p = cad.fai_drill(part0, { diameter: 5, depth: 3 })
// 描述性建模：M16 螺纹通孔（底孔 Φ14 表反算；串内无公差后缀 → 无 PMI）
const p = cad.fai_drill(part0, { position: [0, 0, 30], direction: 'z', thread: 'M16' })
// 图纸标注组合：PMI 产出（公差 6H 来自串内后缀），孔深 18 来自 ↧ 后缀
const p = cad.fai_drill(part0, { position: [0, 0, 30], direction: 'z', thread: 'M16-6H↧18' })
```

```js
const p = cad.fai_drill(part0, { diameter: 5.2, depth: 8, holeType: 'screw', screwSystem: 'metric', screwSpecIdx: 4, screwThread: 'coarse', screwHead: 'none' })
// 攻丝孔：几何只钻 Φ5×16，螺纹 M6-6H ↓14 进 PMI
const p = cad.fai_drill(part0, { position: [0, 0, 30], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
// 管螺纹 PT1/8（锥管螺纹）：几何只钻 Φ8.8×20 底孔，PT1/8 螺纹进 PMI
const p = cad.fai_drill(part0, { position: [47.5, 0, 55], direction: 'x', holeType: 'tapped', screwSystem: 'pipe', screwSpecIdx: 0, diameter: 8.8, depth: 20 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `diameter` | `number` |  | — | 孔径（mm）；`tapped`/`screw` 时省略则按表反算底孔（M16 → Φ14；显式值优先，图纸值唯一真源），`simple` 必填 |
| `thread` | `string` |  | — | 描述性螺纹规格（一个键即完整规格，不写 `screwSystem`/`screwSpecIdx`/`screwThread`）：metric `'M<dia>[×<pitch>][-<class>][↧|↓<depth>]'`（'M16'、'M16×1.5'、'M4 X 0.7 - 6H'、'M16-6H↧18'）、imperial `'(#<gauge>|<frac>"|<dec>")[-<tpi>][-<class>][↧|↓<depth>]'`（'1/4"-20-2B↧10'）、pipe `'PT|R|Rc<size>[↧|↓<depth>]'`（'PT1/8'）。空格/大小写全容忍。深度后缀亦可用 `'<depth> DEEP'`（'M16 18 DEEP'）；`'THRU'`/`'THROUGH'` 后缀 = 通孔（与显式 `depth` 同给报错）。OCR 变体白名单（只收敛、不扩语法）：NFKC 等价（全角、分数字形）、破折号/×/引号/箭头形近字、数字逗号小数（'1,5'→'1.5'）、前导点小数英寸（'.25"'）、公差等级闭字母表唯一修复（'GH'→'6H'、'ZB'→'2B'，自由数字绝不猜测，仅报错并附最近表项建议）；白名单外显式拒绝（>64 字符、零宽/双向控制字符、表外字符如西里尔 'М'、注入载荷）。给出后：`holeType` 缺省 `'tapped'`（显式 `'tapped'`/`'screw'` 合法，`'simple'` 报错）；底孔按表反算（显式 `diameter` 优先）；**串内带公差后缀（-6H）或显式 `threadClass` 才产出 PMI**（'M4×0.7' 无 PMI）；串内 `↧18`/`↓18`/`18 DEEP` = 孔深 18（与显式 `depth` 同给报错）；解析失败/表外显式报错（E_THREAD_SPEC），不静默回落 |
| `depth` | `number` |  | 0 | 孔深（mm）；0 = 通孔，> 0 = 盲孔 |
| `holeType` | `'simple' | 'screw' | 'tapped'` |  | 'simple' | 孔类型：simple 光孔 / screw 建模螺纹 / tapped 攻丝孔（底孔 + 螺纹 PMI）。`thread` 给出时缺省 'tapped' |
| `direction` | `'normal' | 'x' | 'y' | 'z'` |  | 'normal' | 钻孔轴向：`'normal'` = 沿该面法向进入材料（面在底面时即"向上"），`x`/`y`/`z` = 世界轴，两类都会按面法向自动定号；PMI 的 `axis.direction` 记的是定号后的实际钻孔方向 |
| `position` | `[x,y,z]` |  | 原点 | 孔心位置 |
| `face` | `FaceTopoRef` |  | — | 面引用（§6.2 新形态：`FaceTopoRef`，执行期按输入 Shape 解析派生法向；优先于 `faceNormal`） |
| `faceNormal` | `[x,y,z]` |  | [0,0,1] | 面法向（决定朝向；历史兜底，§6.2 起宿主不再写，改由 `face` 解析） |
| `tolerance` | `number` |  | — | 公差（mm）；BREP 链缺省 0（名义孔径，+tolerance/2 扩孔），mesh 链缺省 0.3（冻结链）；screw 孔不吃 tolerance（底孔+牙型配对不可扩孔） |
| `screwSystem` | `'metric' | 'imperial' | 'pipe'` |  | 'metric' | 螺纹制式（holeType='screw'/'tapped' 时用）。'metric' 公制 / 'imperial' 英制 / 'pipe' 55° 锥管螺纹（PT·R·BSPT，**只支持 tapped**：几何只钻底孔、螺纹进 PMI；'screw' + 'pipe' 会直接报错） |
| `screwSpecIdx` | `number` |  | 4 | 螺丝规格索引（holeType='screw'/'tapped' 时用；metric 4 → M5、5 → M6；pipe 0 → PT1/8、1 → PT1/4、2 → PT3/8、3 → PT1/2） |
| `screwThread` | `'coarse' | 'fine' | 'custom'` |  | 'coarse' | 螺丝螺纹类型 |
| `screwPitchCustom` | `number` |  | — | 自定螺距（mm；`screwThread='custom'` 时生效，缺省回落粗牙螺距） |
| `screwHead` | `'hex' | 'chc' | 'none'` |  | 'none' | 螺丝头型 |
| `threadDepth` | `number` |  | — | 有效螺纹深度（mm），仅标注用；须 ≤ depth，缺省与 depth 同深 |
| `threadClass` | `string` |  | 。type:string | 螺纹公差等级（如 '6H'），仅标注用；旧三键路径 metric 缺省 '6H'、imperial 缺省 '2B'，描述串路径不 |
| `handedness` | `'right' | 'left'` |  | 'right' | 螺纹旋向，仅标注用（写入 PMI；几何旋向不随此参数改变） |

**异步**。Shape 钻孔后的几何（`tapped` / `screw` 会附带 `PmiThreadHole` 标注）。

> 键名以本表为准：`type: 'through'|'blind'` 与 `direction` 为向量的旧素材是无效写法——孔型由 `depth`（0=通孔）推导，`direction` 是 'normal'|'x'|'y'|'z' 枚举。

### 5.13 `fai_drill_tapper` ✅ 🚫

双串攻丝孔：钻孔串 + 攻丝串各表一职——`drill` 决定底孔几何（直径 + 深度）， `tap` 决定螺纹规格（公差等级 / 丝深 / 旋向随串或参数）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**。**变更其 API 形态必须同步更新 `../3d_editor`**。BREP-only（mesh 链冻结，2026-11-07 起）：无 mesh 实现，mesh 模式显式报错。

```js
// 通孔攻丝：底孔 Φ2.5 贯穿，M3-6H 贯穿（PMI：'M3-6H 通（底孔 Φ2.5 通，攻丝）'）
const p = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 完全贯穿', tap: 'M3-6H 完全贯穿', position: [0, 0, 30], direction: 'z' })
// 盲孔攻丝：底孔 Φ2.5×12，丝深 8（孔底留 4 光底；PMI：'M3-6H ↓8（底孔 Φ2.5 ↓12，攻丝）'）
const p = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 深12', tap: 'M3-6H ↓8', position: [0, 0, 30], direction: 'z' })
// 通孔 + 攻丝定深（Q2）：贯穿底孔上的 ↓8 丝段
const p = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 完全贯穿', tap: 'M3-6H ↓8', position: [0, 0, 30], direction: 'z' })
// 管螺纹：底孔 Φ8.7×20，PT1/8（无公差概念，PMI 无公差等级）
const p = cad.fai_drill_tapper(part0, { drill: 'Ø8.7 深20', tap: 'PT1/8', position: [0, 0, 30], direction: 'z' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `drill` | `string` | ✅ | — | 钻孔串（底孔几何唯一真源）：`'Ø<diameter>[↧|↓|▼<depth> | 深<depth> | <depth> DEEP | THRU | 完全贯穿]'`，如 'Ø2.5 完全贯穿'、'Ø5 深10'、'Ø14 18 DEEP'。直径符号 Ø/⌀/Φ/φ/ϕ/∅ 等价（OCR 白名单）；无深度后缀 = 通孔。解析失败 E_THREAD_SPEC |
| `tap` | `string` | ✅ | 6H）。解析失败 E_THREAD_SPEC。type:string required:true | 攻丝串（螺纹规格唯一真源）：`parseThreadSpec` 全文法（metric 'M3-6H'、imperial '1/4"-20-2B'、pipe 'PT1/8'；深度后缀 = 丝深，'THRU'/'完全贯穿' = 通丝）。串内 '-6H' → PMI 公差等级；无后缀则 PMI 无公差（不 |
| `direction` | `'normal' | 'x' | 'y' | 'z'` |  | 'normal' | 钻孔轴向：`'normal'` = 沿该面法向进入材料，`x`/`y`/`z` = 世界轴，按面法向自动定号；PMI 的 `axis.direction` 记定号后的实际钻孔方向 |
| `position` | `[x,y,z]` |  | 原点 | 孔心位置（模型局部空间） |
| `face` | `FaceTopoRef` |  | — | 面引用（`FaceTopoRef`，执行期按输入 Shape 解析派生法向；优先于 `faceNormal`） |
| `faceNormal` | `[x,y,z]` |  | [0,0,1] | 面法向快照（历史兜底） |
| `partIndex` | `number` |  | — | 多零件 load 的 compound 成员索引（结果替换回原 compound） |
| `handedness` | `'right' | 'left'` |  | 'right' | 螺纹旋向，仅标注用（写入 PMI；几何旋向不随此参数改变） |

**同步**。Shape 钻孔后的几何（恒附 `PmiThreadHole` 标注：底孔 + 螺纹一体）。

> 两串独立解析、跨串校验（E_ARG）：底孔直径必须 < 公称大径；tap 串 THRU 要求 drill 串也是通孔；盲丝丝深不得超过孔深。通孔 + 攻丝定深（'Ø2.5 完全贯穿' + 'M3-6H ↓8'）合法。由串推导的键（diameter/depth/thread/threadDepth/threadClass/holeType/旧三键/tolerance）显式给出即报错。
>
> PMI 恒产出 `PmiThreadHole`（本 op 语义即攻丝孔）；公差等级缺省不补——tap 串带 '-6H' 才有（Q3，2026-11-08）。

### 5.14 `fai_extrude` ✅ 🚫

沿法向拉伸几何。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p = cad.fai_extrude(part0, { length: 10 })
const p = cad.fai_extrude(part0, { length: 10, mode: 'forward' })
const p = cad.fai_extrude(part0, { length: 10, normal: [0,0,1], planeDistance: 2 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `length` | `number` | ✅ | — | 总拉伸量（mm） |
| `mode` | `'centered' | 'forward' | 'backward'` |  | 'centered' | 拉伸方向：centered 双向各一半 / forward 正向 / backward 反向 |
| `normal` | `[x,y,z]` |  | 当前面法向 [0,0,1] | 拉伸方向法向 |
| `planeDistance` | `number` |  | 0 | 切面在法向上的偏移 |
| `space` | `'local' | 'world'` |  | — | 坐标空间声明 |

**异步**。Shape 拉伸后的几何。

### 5.15 `fai_split` ⚠️ 🚫

分割几何，返回具名对象 { front, back } 两个独立零件。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const { front: part1, back: part2 } = cad.fai_split(part0, { normal: [0, 0, 1], offset: 5, cutMode: 'dovetail', grooveDepth: 3, grooveWidth: 5 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `cutMode` | `'plane' | 'dovetail' | 'dowel' | 'tenon' | 'straight-tenon' | 'straight'` |  | 'plane' | 切割模式 |
| `normal` | `[x,y,z]` |  | [0,0,1] | 切割面法向 |
| `offset` | `number` |  | 0 | 切割面沿法向偏移（过 bbCenter） |
| `inPlaneAngle` | `number` |  | 0 | 切割面面内旋转角（度） |
| `bbCenter` | `[x,y,z]` |  | 自动 | 包围盒中心（缺省自动推导） |
| `bboxSize` | `[x,y,z]` |  | 自动 | 包围盒尺寸（缺省自动推导） |
| `grooveDepth` | `number` |  | — | 燕尾槽深（cutMode='dovetail'） |
| `grooveWidth` | `number` |  | — | 燕尾槽宽（cutMode='dovetail'） |
| `grooveDepthTolerance` | `number` |  | — | 燕尾槽深公差 |
| `grooveWidthTolerance` | `number` |  | — | 燕尾槽宽公差 |
| `grooveFlapsAngle` | `number` |  | — | 燕尾槽翼角（度） |
| `dowelDiameter` | `number` |  | — | 定位销直径（cutMode='dowel'） |
| `dowelDiameterTolerance` | `number` |  | — | 定位销直径公差 |
| `dowelHeight` | `number` |  | — | 定位销高度 |
| `dowelHeightTolerance` | `number` |  | — | 定位销高度公差 |
| `tenonSideLength` | `number` |  | — | 直榫边长（cutMode='tenon'/'straight-tenon'） |
| `tenonSideLengthTolerance` | `number` |  | — | 直榫边长公差 |
| `tenonHeight` | `number` |  | — | 直榫高度 |
| `tenonHeightTolerance` | `number` |  | — | 直榫高度公差 |
| `selectedSections` | `number[]` |  | — | 参与榫卯的截面下标 |
| `separationRatio` | `number` |  | 0 | 分割后两半沿切割面法向对开的单侧距离中「占 bbox 对角线的比例」部分。**比值不是百分数**：0.02 表示 2% |
| `separation` | `number` |  | 0 | 分割后两半沿切割面法向对开的单侧距离中的绝对追加量（mm），典型值 = 半个榫卯深度（不拉开至少半个榫长，榫头仍插在槽里） |

**异步**。{ front: Shape; back: Shape } 必须用解构 `const { front: partA, back: partB } = cad.fai_split(...)` 取出两个零件。

> 切割面统一用 `normal`/`offset`/`inPlaneAngle` 描述；早期文本层曾与执行层键名断裂（planeRotation/planePosition），已修并统一为上述键名。

### 5.16 `fillet` ✅

在几何体上做圆角（等半径）。 两条路径都以 `meshEngines: ['brepkit']` 之外的事实为界：BREP 输入走 `filletWithHistory`（带面演化与 roleTable 传播）；**网格实体**输入走网格后端 （近似拓扑无 role，边按几何或序号解析，无面演化）。非 BREP 的**裸网格**输入仍抛 `E_MESH_SOLID_UNSUPPORTED`——裸网格没有近似拓扑，没有边可选。

```js
const p = cad.fillet(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], radius:2 })
// AI 生成可写 CadQuery 边选择器字符串（"|Z" 切线平行 Z 的边）
const p2 = cad.fillet(part0, { edges: "|Z", radius: 2 })
const q = cad.fillet(meshPart, { edges: [3], radius: 1 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edges` | `EdgeTopoRef[]|string` | ✅ | — | 参与圆角的边：CadQuery 边选择器字符串（如 "|Z"，AI 生成）或相邻两面的 role 线路（EdgeTopoRef[]，UI 拾取产物）；网格链上也可用 1 起序号 |
| `radius` | `number` | ✅ | — | 圆角半径（mm，>0） |

**异步**。Shape 圆角后的几何。

> `radius` 为正数（mm）。BREP 路径圆角后 roleTable 经 filletWithHistory 传播， 后续特征仍可按 role 选面/选边；网格实体路径没有 role 层，边只能按几何或 序号（近似拓扑 `edges` 数组下标 + 1）指认。

### 5.17 `filletVariable` ✅

变半径圆角：对单条边施加从起点到终点的线性变半径圆角。

```js
const v = cad.filletVariable(part0, partEdges[0], 1, 4)
// AI 生成可写 CadQuery 边选择器字符串
const v2 = cad.filletVariable(part0, "|Z", 1, 4)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edge` | `EdgeTopoRef|string` | ✅ | — | 目标边：EdgeTopoRef（同 cad.fillet 的 edges 条目，UI 拾取产物）或 CadQuery 边选择器字符串（如 "|Z"，AI 生成；多边命中抛错） |
| `r1` | `number` | ✅ | — | 起点半径（mm，>0） |
| `r2` | `number` | ✅ | — | 终点半径（mm，>0） |

**异步**。Shape 变半径圆角后的几何。

> 中立 op：L1 filletVariable 两引擎同实现。`r1 == r2` 时与 cad.fillet 等半径 结果等价。旧版的 per-edge 回调变半径（variableFillet）不上脚本面。 仅 BREP 可用。

### 5.18 `fuse` ✅

Boolean fuse (union) — {@link union} 的别名。 brepjs 兼容名。与 `union` 是同一个函数对象（同一实现、同一 schema、同一 消费语义），`fuse(a, b)` ≡ `union(a, b)`；变参形态同样适用。

```js
const c = cad.fuse(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用，≥2 个） |

**异步**。Shape 所有输入的并集。

### 5.19 `gridPattern` ✅

二维栅格阵列：沿 directionX × directionY 复制 countX×countY 份（含原位置）。

```js
const p = cad.gridPattern(part0, [1, 0, 0], [0, 1, 0], 3, 2, 20, 20)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `directionX` | `[x,y,z]` | ✅ | — | 第一方向 |
| `directionY` | `[x,y,z]` | ✅ | — | 第二方向 |
| `countX` | `number` | ✅ | — | X 向副本数 |
| `countY` | `number` | ✅ | — | Y 向副本数 |
| `spacingX` | `number` | ✅ | — | X 向间距 |
| `spacingY` | `number` | ✅ | — | Y 向间距 |

**异步**。Shape 全部副本的 compound。

> BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[ix_iy]/<inner>`。

### 5.20 `intersect` ✅

布尔交集：所有输入的重叠部分。

```js
const c = cad.intersect(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用） |

**异步**。Shape 所有输入的交集。

### 5.21 `knurl` ⚠️

施加滚花（顶点位移，非布尔）。mesh-only。

```js
const p = cad.knurl(part0, { knurlTextureHeight: 0.5, knurlScaleU: 0.15, knurlScaleV: 0.15, knurlInvertDisplacement: false, knurlRefineLength: 1.0, knurlMappingMode: 5 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `knurlTextureHeight` | `number` |  | 0.5 | 纹路高度（mm） |
| `knurlScaleU` | `number` |  | 0.15 | 纹路 U 向频率 |
| `knurlScaleV` | `number` |  | 0.15 | 纹路 V 向频率 |
| `knurlInvertDisplacement` | `boolean` |  | false | 反向位移 |
| `knurlRefineLength` | `number` |  | 1.0 | 细分长度（mm） |
| `knurlMappingMode` | `number` |  | 5 | UV 映射模式 |
| `faceCenter` | `[x,y,z]` |  | bboxCenter | 面锚点中心 |
| `faceNormal` | `[x,y,z]` |  | [0,0,1] | 面法向 |

**异步**。Shape 滚花后的几何。

> knurl 无 BREP 实现（mesh-only），本质是顶点位移（网格操作），网格参数可接受；brep 模式下调用前抛 BrepUnsupportedError。面锚定建议用几何引用。

### 5.22 `linearPattern` ✅

线性阵列：沿 direction 复制 count 份（含原位置）。

```js
const p = cad.linearPattern(part0, [1, 0, 0], 3, 20)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `direction` | `[x,y,z]` | ✅ | — | 阵列方向 |
| `count` | `number` | ✅ | — | 副本总数（含原位置） |
| `spacing` | `number` | ✅ | — | 副本间距 |

**异步**。Shape 所有副本 fused 后的几何。

> BREP 输入走质心聚类回投，结果面按份数 k 回投影到输入面角色，产出 `replica[k]/<inner>` 面命名；**网格实体**输入走网格后端， 阵列后融合为一个新的网格零件，近似拓扑没有 role 层故不产 replica 命名。 裸网格输入仍抛 `E_MESH_UNSUPPORTED`。

### 5.23 `loft` ✅

放样：按给定顺序在截面之间蒙皮生成体。

```js
const bottom = cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -5, y1: -5, x2: 5, y2: -5 },
{ kind: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
{ kind: 'line', x1: 5, y1: 5, x2: -5, y2: 5 },
{ kind: 'line', x1: -5, y1: 5, x2: -5, y2: -5 },
] }] })
const top = cad.translate(cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -3, y1: -3, x2: 3, y2: -3 },
{ kind: 'line', x1: 3, y1: -3, x2: 3, y2: 3 },
{ kind: 'line', x1: 3, y1: 3, x2: -3, y2: 3 },
{ kind: 'line', x1: -3, y1: 3, x2: -3, y2: -3 },
] }] }), [0, 0, 20])
const body = cad.loft([bottom, top])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `sections` | `Shape[]` | ✅ | — | 有序截面集合（wire 或面；面取其外环） |
| `opts` | `LoftOptions` |  | — | 放样配置（ruled / endPoint） |

**异步**。Shape 放样体。

> 基础 op：**occt 与 brepkit 两内核都支持**（occt `BRepOffsetAPI_ThruSections`； brepkit `loft` / `loftSmooth` / `loftWithOptions`）。截面可为 wire 或面 （面取其外环），至少 2 个；`endPoint` 可做终点退化到点的蒙皮。选项集 = 两内核交集 = `{ ruled, endPoint }` —— `startPoint` 与 `tolerance` 只有 occt 有，用 `cad.loftAdvanced`。brepkit 链对顶点数不一致的截面（如圆 → 方） 由内核重采样兜底，直接可达。

### 5.24 `loftAdvanced` ✅

放样（完整语义）：按给定顺序在截面之间蒙皮生成体。

```js
const bottom = cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -5, y1: -5, x2: 5, y2: -5 },
{ kind: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
{ kind: 'line', x1: 5, y1: 5, x2: -5, y2: 5 },
{ kind: 'line', x1: -5, y1: 5, x2: -5, y2: -5 },
] }] })
const top = cad.translate(cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -3, y1: -3, x2: 3, y2: -3 },
{ kind: 'line', x1: 3, y1: -3, x2: 3, y2: 3 },
{ kind: 'line', x1: 3, y1: 3, x2: -3, y2: 3 },
{ kind: 'line', x1: -3, y1: 3, x2: -3, y2: -3 },
] }] }), [0, 0, 20])
const body = cad.loftAdvanced([bottom, top], { endPoint: [0, 0, 30] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `sections` | `Shape[]` | ✅ | — | 有序截面集合（wire 或面；面取其外环） |
| `opts` | `LoftAdvancedOptions` |  | — | 放样完整配置（ruled / startPoint / endPoint / tolerance） |

**异步**。Shape 放样体。

> 平台 op：仅 occt 引擎（BRepOffsetAPI_ThruSections）。截面可为 wire 或面 （面取其外环），至少 2 个；`startPoint` / `endPoint` 可做退化到点的蒙皮； `tolerance` 控制缝合公差。非 occt 引擎执行前报错；brep_mock 不拦截。 基础放样（两内核交集）用 `cad.loft`。不做 `loftAll`（数组产物）。

### 5.25 `mirror` ✅

镜像：返回镜像后的新 Shape（源保留）。

```js
const p = cad.mirror(part0, { normal: [1, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `options` | `MirrorOptions` |  | — | { normal?, at? } 镜像面 |

**异步**。Shape 镜像后的新几何。

> BREP-only。keep 语义：不消费输入（薄 override 委托生成 op，行为不变）。

### 5.26 `mirrorJoin` ✅

镜像并融合：原物（replica[0]）+ 沿平面镜像（replica[1]）fuse 成一体。

```js
const p = cad.mirrorJoin(part0, { normal: [1, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `options` | `MirrorJoinOptions` |  | — | { normal?, at? } 镜像面法向与面上一点 |

**异步**。Shape fuse 后的几何。

> BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[0|1]/<inner>`。

### 5.27 `offset2d` ✅

2D 轮廓偏置：把平面轮廓（wire 或面）沿其法向等距偏移，产出新的 1D 轮廓。

```js
const c = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })
const outer = cad.offset2d(c, 2)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `profile` | `Shape` | ✅ | — | 轮廓几何（wire；面取其外环） |
| `delta` | `number` | ✅ | — | 偏置距离（mm） |
| `options` | `Offset2DOptions` |  | — | 偏置配置（joinType） |

**异步**。Shape 1D 偏置轮廓（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 offsetWire2D，L1 契约无对应成员）。非 occt 引擎执行前报错；brep_mock 不拦截。`delta` 可正可负（正 = 外扩， 负 = 内缩，方向随 contour 走向）；轮廓接受 wire 或面（面取其外环）。

### 5.28 `pocket` ✅

Shapeable<Shape3D> → Result<T>，brep-op

```js
pocket(shape: Shape, options: PocketOptions): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `options` | `PocketOptions` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/compoundFns.ts#pocketBrep`。

### 5.29 `rectangularPattern` ✅

矩形阵列：按 options（xDir/xCount/xSpacing/yDir/yCount/ySpacing）复制并 fuse。

```js
const p = cad.rectangularPattern(part0, { xDir: [1,0,0], xCount: 3, xSpacing: 20, yDir: [0,1,0], yCount: 2, ySpacing: 15 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `options` | `RectangularPatternOptions` | ✅ | — | 阵列参数 |

**异步**。Shape 所有副本 fused 后的几何。

> BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[ix_iy]/<inner>`。

### 5.30 `revolve` ✅

旋转成形：把平面轮廓绕轴旋转（兼容生成投影签名）。

```js
const p1 = cad.revolve(part0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307179586 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 平面轮廓 |
| `options` | `RevolveOptions` |  | — | 旋转轴/点/角度（透传 compat 语义） |

**异步**。Shape 旋转体（带链根 roleTable：bottom/top/wall:i）。

### 5.31 `roof` ✅

wire → Result(ValidSolid)→solid，brep-op

```js
roof(wire: Shape, options?: RoofOptions): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `wire` | `Shape` | ✅ | 几何输入（Shape） |
| `options` | `RoofOptions` |  | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/roofFns.ts#roofBrep`。

### 5.32 `sectionByPlane` ✅

求实体与无限平面的精确截面线（1D 曲线，可继续建模/导出 STEP）。

```js
const sec = cad.sectionByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `point` | `Vec3` | ✅ | — | 平面上一点 [x,y,z]（mm） |
| `normal` | `Vec3` | ✅ | — | 平面法向 [x,y,z] |

**异步**。Shape 1D 截面曲线。

> 中立 op：L1 sectionByPlane 两引擎同实现。产物是 1D 曲线（kind:'curve'， 全部交线收拢为一个 compound）；平面不与体相交时显式报错。

### 5.33 `shell` ✅

抽壳/薄壁：移除指定面并把余下面偏置成等厚薄壁（产物仍是**实体**，不是壳——壳构造走 `cad.sew`）。

```js
// openFaces 取 UI 拾取产物的 FaceTopoRef 字面量（origin/role 由命名层分配，不手写）；
// ❌ 不要用 cad.faceRef 序号——跨内核不可移植
const sh = cad.shell(part0, { openFaces: pickedFaces, thickness: 2 })
// AI 生成可写 CadQuery 面选择器字符串（"|Z" 法向平行 Z 的面、"top" 命名视图）
const sh2 = cad.shell(part0, { openFaces: "|Z", thickness: 2 })
// 网格链（3MF mesh-solid）：无 role 层，序号是唯一无歧义指认（仅当前内核快照）
const sm = cad.shell(meshPart, { openFaces: [4], thickness: 2 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `openFaces` | `ShellFaceSelector[]|string` | ✅ | — | 要移除的面：面选择器字符串（如 ">Z"，AI 生成）或 FaceTopoRef[]（UI 拾取产物字面量；禁止 cad.faceRef 序号；网格链可用 1 起序号） |
| `thickness` | `number` | ✅ | — | 壁厚（mm，>0） |
| `tolerance` | `number` |  | — | 容差（mm） |

**异步**。Shape 抽壳后的薄壁体（实体）。

> 中立 op：L1 shell 两引擎同实现。`openFaces` 为空数组时生成全封闭薄壁。 **`cad.shell` ≠ 壳构造**：输入实体、产物也是实体（薄壁体）；把面/壳 组装成壳的正门是 `cad.sew`（缝合）。精度链按 role 线路选面（TopoRef 字面量或 CadQuery 面选择器字符串）；**禁止 `cad.faceRef` 序号**—— 序号跨内核不可移植。网格链没有 role 层，序号是唯一无歧义的指认方式 （仅当前内核快照），选择器字符串只服务精度链。

### 5.34 `solidFromFaces` ✅

面集一次成型为实体：把一组共享边界的面缝合成一个实体（occt 原生一次构造）。

```js
const solid = cad.solidFromFaces([f0, f1, f2, f3, f4, f5])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `faces` | `Shape[]` | ✅ | — | 面集合（共享边界、构成闭合壳） |
| `tolerance` | `number` |  | occt 1e-6）。type:number required:false | 缝合容差（mm， |

**异步**。Shape 缝合固化后的实体。

> 平台 op：仅 occt 引擎（原生 buildSolidFromFaces，L1 契约无对应成员）。 非 occt 引擎执行前报错；brep_mock 不拦截。中立路径见 `sewAndSolidify`。

### 5.35 `split` ✅

用工具几何切分目标几何（BRepAlgoAPI_Splitter），返回所有碎片组成的几何。

```js
const pieces = cad.split(part0, [part1])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tools` | `Shape[]` | ✅ | — | 切刀几何（数组） |

**异步**。Shape 切分后的几何（compound of pieces）。

> BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。切分产生的截面 / 被切细的侧面 片记 `splinter(#j)` 命名。平台 op：仅 occt 引擎（原生 split）。

### 5.36 `splitByPlane` ✅

沿无限平面把实体切成两半，返回法向正/负两半（具名产物）。

```js
const { positive, negative } = cad.splitByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `point` | `Vec3` | ✅ | — | 平面上一点 [x,y,z]（mm） |
| `normal` | `Vec3` | ✅ | — | 平面法向 [x,y,z] |

**异步**。具名产物 positive/negative。

> 中立 op：L1 splitByPlane 两引擎同实现。产物是具名两半 `{ positive, negative }`（不是数组）；法向正侧 = positive。

### 5.37 `subtract` ✅

布尔差集：第一个为主体，减去其余输入。

```js
const b = cad.subtract(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用，第一个为主体） |

**异步**。Shape part0 减 part1 的差集（第一个为主体）。

### 5.38 `sweep` ✅

扫掠：截面沿脊柱路径生成扫掠体。

```js
const path = cad.wire([[0, 0, 0], [0, 0, 50]])
const section = cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -4, y1: -4, x2: 4, y2: -4 },
{ kind: 'line', x1: 4, y1: -4, x2: 4, y2: 4 },
{ kind: 'line', x1: 4, y1: 4, x2: -4, y2: 4 },
{ kind: 'line', x1: -4, y1: 4, x2: -4, y2: -4 },
] }] })
const body = cad.sweep(section, path)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `profile` | `Shape` | ✅ | — | 截面几何（wire 或面；面取其外环） |
| `spine` | `Shape` | ✅ | — | 脊柱路径（wire） |

**异步**。Shape 扫掠体。

> 基础 op：**occt 与 brepkit 两内核都支持**（occt `sweepPipeShell`；brepkit `sweep(face, NURBS path)`，路径由适配器从脊柱 wire 拟合）。截面接受 wire 或面（面取其外环）；脊柱必须为 wire。选项集 = 两内核交集 = **空** —— 需要 transition / auxSpine / support / law / orientation 等 occt 独有控制面 时用 `cad.sweepAdvanced`。

### 5.39 `sweepAdvanced` ✅

扫掠（完整控制面）：截面沿脊柱路径生成扫掠体。

```js
const path = cad.wire([[0, 0, 0], [0, 0, 50]])
const section = cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -4, y1: -4, x2: 4, y2: -4 },
{ kind: 'line', x1: 4, y1: -4, x2: 4, y2: 4 },
{ kind: 'line', x1: 4, y1: 4, x2: -4, y2: 4 },
{ kind: 'line', x1: -4, y1: 4, x2: -4, y2: -4 },
] }] })
const body = cad.sweepAdvanced(section, path, { orientation: 'frenet' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `profile` | `Shape` | ✅ | — | 截面几何（wire 或面；面取其外环） |
| `spine` | `Shape` | ✅ | — | 脊柱路径（wire） |
| `opts` | `SweepAdvancedOptions` |  | — | 扫掠完整控制面 |

**异步**。Shape 扫掠体。

> 平台 op：仅 occt 引擎（BRepOffsetAPI_MakePipeShell / MakePipe）。截面接受 wire 或面（面取其外环）；脊柱必须为 wire。非 occt 引擎执行前报错； brep_mock 不拦截。`shellMode` 不暴露（元组产物跨不过单产物边界）。 完整控制面：给出 `orientation` / `up` / `auxSpine` / `curvilinearEquivalence` / `guideContact` / `transitionMode`（新名）/ `withContact` / `withCorrection` / `support` / `maxDegree` / `maxSegments` / `law` / `lawLength` / `lawEndFactor` / `tol3d` / `boundTol` / `tolAngular` 任一，即改走 occt 原生 `sweepFull`（law 驱动扫掠是 twist 类特征的正 确路径）。`sweepFull` 的 options 是 `sweepAdvanced` 的**严格超集**，且含 `sweepOriented` 的全部字段 ⇒ 三者能力并轨，脚本面只需本符号一个。 基础扫掠（两内核交集）用 `cad.sweep`。

### 5.40 `thicken` ✅

加厚：把面（或壳）沿法向偏置成等厚实体。

```js
const face = cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -10, y1: -10, x2: 10, y2: -10 },
{ kind: 'line', x1: 10, y1: -10, x2: 10, y2: 10 },
{ kind: 'line', x1: 10, y1: 10, x2: -10, y2: 10 },
{ kind: 'line', x1: -10, y1: 10, x2: -10, y2: -10 },
] }] })
const solid = cad.thicken(face, 2)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `thickness` | `number` | ✅ | — | 厚度（mm，≠0；正沿法向，负反向） |

**异步**。Shape 加厚后的实体。

> 平台 op：仅 occt 引擎（BRepOffset）。输入为面/壳 Shape（如 cad.profile 产物）； 正厚度沿法向、负厚度反向。非 occt 引擎执行前报错；brep_mock 不拦截。

### 5.41 `twistExtrude` ✅

wire → Result(Shape3D)，brep-op

```js
twistExtrude(wire: Shape, angleDegrees: number, center: Vec3, normal: Vec3): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `wire` | `Shape` | ✅ | 几何输入（Shape） |
| `angleDegrees` | `number` | ✅ | 数值 / 选项参数 |
| `center` | `Vec3` | ✅ | 数值 / 选项参数 |
| `normal` | `Vec3` | ✅ | 数值 / 选项参数 |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `operations`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/sweepFns.ts#twistExtrudeBrep`。

### 5.42 `union` ✅

布尔并集：合并所有输入几何（≥2 个输入）。

```js
const a = cad.union(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用，≥2 个） |

**异步**。Shape 所有输入的并集。函数名即操作，输入全是变量引用，可用 `cad.union(a, b, c)` 多输入。

---

## 6. 修复类操作（inputs ≥ 1）

### 6.1 `autoHeal` ✅

整件自动修复（Result<Shape>），brep-op

```js
autoHeal(shape: Shape, options?: AutoHealOptions): { shape: Shape, report }
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |
| `options` | `AutoHealOptions` |  | 数值 / 选项参数 |

**异步**。多产物对象（`shape` 为 Shape 包装位，同对象其余键如诊断原样透传；脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/healingFns.ts#autoHealBrep`。

### 6.2 `defeature` ✅

移除特征面（孔/凸台等），恢复基础形状。

```js
// faces 取 UI 拾取产物的 FaceTopoRef 字面量；❌ 禁止 cad.faceRef 序号（跨内核不可移植）
const base = cad.defeature(part0, pickedFaces)
// AI 生成可写 CadQuery 面选择器字符串
const base2 = cad.defeature(part0, "|Z")
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `faces` | `FaceTopoRef[]|string` | ✅ | — | 要移除的面：面选择器字符串（如 "|Z"，AI 生成）或 FaceTopoRef[]（UI 拾取产物字面量；禁止 cad.faceRef 序号） |

**异步**。Shape 移除特征后的几何。

> 中立 op：L1 defeature 两引擎同实现。仅 BREP 可用。

### 6.3 `fixSelfIntersection` ✅

```js
fixSelfIntersection(shape: Shape): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/healingFns.ts#fixSelfIntersectionBrep`。

### 6.4 `fixShape` ✅

整件修复（Result<Shape>），brep-op

```js
fixShape(shape: Shape): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/healingFns.ts#fixShapeBrep`。

### 6.5 `heal` ✅

faijs 无同名整件修复 → brep-op

```js
heal(shape: Shape): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/healingFns.ts#healBrep`。

### 6.6 `healSolid` ✅

Solid 修复（Result<ValidSolid>），brep-op

```js
healSolid(solid: Shape): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `solid` | `Shape` | ✅ | 几何输入（Shape） |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`brep-operations/healingFns.ts#healSolidBrep`。

### 6.7 `removeHolesFromFace` ✅

移除面（或实体某面）上的孔。

```js
const plain = cad.removeHolesFromFace(faceWithHoles)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 含孔的面几何 |

**异步**。Shape 去孔后的面。

> 中立 op：L1 removeHolesFromFace 两引擎同实现。入参为含孔的面 Shape （L1 形参是面句柄；借入输入 Shape 的 BREP 槽位句柄）。

### 6.8 `reverseShape` ✅

反转壳体朝向（内表面 ↔ 外表面）。

```js
const flipped = cad.reverseShape(sh)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|

**异步**。Shape 朝向反转后的几何。

> **occt-only**（`engines: ['occt']`，实证收窄）：brepkit 实测在 op 级抛 `invalid solid handle: index N is out of bounds`（非输入侧失败）， 故由静态门在执行前拒绝而非等到运行时。产物 `getVolume` 返回**有向**体积 （朝向反转 ⇒ 符号翻转）。仅 BREP 可用。

### 6.9 `sew` ✅

缝合：把一组面/壳沿公共边缝成一张壳。**壳构造的正门**（面/壳集 → 壳的唯一脚本面入口）。

```js
const shellShape = cad.sew([f1, f2, f3], { tolerance: 1e-5 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 面/壳集合 |
| `tolerance` | `number` |  | — | 缝合容差（mm） |

**异步**。Shape 缝合后的壳。

> 中立 op：L1 sew 两引擎同实现。产物是壳（不保证闭合）；要实体用 sewAndSolidify。 组装链定位：`cad.wireFromEdges`（边→线）→ `cad.faceFromWire`（线→面）→ `cad.sew`（面/壳集→壳，本 op）→ `cad.sewAndSolidify` 或 `cad.solidFromFaces` （→实体）。要"由面集一步成实体"直接走 `cad.solidFromFaces`；sew+solidify 则允许先得到中间壳。

### 6.10 `sewAndSolidify` ✅

缝合并固化为实体：缝合后若闭合则生成 solid。

```js
const solid = cad.sewAndSolidify([f1, f2, f3, f4, f5, f6])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 面/壳集合 |
| `tolerance` | `number` |  | — | 缝合容差（mm） |

**异步**。Shape 缝合固化后的实体。

> 中立 op：L1 sewAndSolidify 两引擎同实现。仅 BREP 可用。

### 6.11 `simplify` ✅

faijs 无同名整件简化 → brep-op

```js
simplify(shape: Shape): Shape
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**异步**。Shape 几何产物（脚本面语句边界 unwrap `Result`，err → 语句失败）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`brep-operations/healingFns.ts#simplifyBrep`。

### 6.12 `unifySameDomain` ✅

合并同域面/边（去除被分割成多片的冗余细分）。

```js
const merged = cad.unifySameDomain(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|

**异步**。Shape 合并后的几何。

> 中立 op：L1 unifySameDomain 两引擎同实现。仅 BREP 可用。

---

## 7. 结构类操作（结构 / 聚合）

### 7.1 `assembly` ⚠️ 🚫

装配：成员 + 约束。结构语句，无几何输出，成员用变量名引用、实体用 EntityRef / 拓扑引用。 求解内核复用 chain-solver solveConstraints（链式拓扑调度 / DOF / converged / unsupported 诊断）；输出为 per-member 终态变换（每成员一条，恒等位姿不输出）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（成员以编辑器结构语句形态声明，服务于画布与时间线），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
let asm1 = cad.assembly({ name: '主轴组件', members: [part0, part1, part2], constraints: [ { type: 'fixed', part: 'part0' }, { type: 'mate', a: { part: 'part0', face: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } } } }, b: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: 'box:bottom', hint: { kind: 'face', surfaceType: 'plane' } } } } }, { type: 'concentric', a: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: '', hint: { kind: 'face', surfaceType: 'cylinder' } } } }, b: { part: 'part2', face: { topoRef: { kind: 'face', origin: 'part2', role: 'cylinder:lateral', hint: { kind: 'face', surfaceType: 'cylinder' } } } } } ] })
asm1.solve()
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | `string` |  | — | 装配名 |
| `members` | `Shape[]` |  | — | 成员（裸变量引用） |
| `constraints` | `AssemblyConstraint[]` |  | — | 约束数组（遗留 face_mate 形态或上述新形态 { type, a, b }） |
| `more` | `Shape[]` |  | — | 位置参数形态的成员（cad.assembly(a, b, ...)），经 normalizeGroupCall 归入 members |

**同步**。CompoundShape + AssemblyBehavior（含 do_assemble / solve 方法）。

> 约束类型（a=参考、b=从动，移动 b 去贴合 a）：`mate` 面对面贴合（法向反向+面中心重合，遗留 face_mate 的新名，求解降级为 concentric + 轴编码）；`align` 同向对齐（法向同向+面中心重合）；`coincident` 共面/共点/共线（保留面内 2 个平移 DOF）；`concentric` 轴重合（孔轴配合，圆柱/圆锥面需 hint.axis，直边/圆边需 EdgeHint.axis）；`distance` 定距（mm，带 value）；`angle` 夹角（deg，带 value）；`parallel`/`perpendicular` 平行/垂直（angle 0°/90° 语法糖）；`fixed` 锚定部件（地基）；`fixedPoint`/`fixedAxis`/`fixedRotation` 世界锚定 unary（把成员子实体钉到世界字面点/方向、锁朝向，平移其余 DOF 仍自由，仅 `solver:'global'` 支持）；`face_mate` 为遗留别名（规范化为 mate，新代码不再使用）。
>
> EntityRef 四种形态：`{ part, face: { topoRef } | { surfaceType?, center, normal } }`、`{ part, edge: { topoRef } | { axis: { origin, direction } } }`、`{ part, point: [x,y,z] }`、`{ part, faceIndex }`（1 起，仅调试简写）。
>
> 不收敛（实体类型不匹配/环/参考不可达）→ 抛错并带 unsupported 明细；成员名为空串 → 求解前抛错；mesh 快照缺 axis 的圆柱/圆锥面作轴实体 → E_TOPO_NOT_FOUND（绝不静默降级）。`mate`（中心重合）与 `coincident`（只共面）是两种不同语义，不互相映射。
>
> 早期文档/示例曾用 `fixedPartId`/`movingPartId`/`faceRowIndex`/`faceId`/`invalid`——这些键在代码中不存在。真实契约是 `fixedPartName`/`movingPartName` + `fixedFace`/`movingFace`（遗留 face_mate）。`faceId` 字段随 §6.2 移除，不再写入。

### 7.2 `compound` ✅

`cad.compound({ members, name?, dropSubsumed? })` → 几何复合体 Shape（持 OCCT 句柄）。

```js
const c = cad.compound({ members: [part0, part1] })
```

```js
// drop members fully subsumed by a later member (FreeCAD truth mirror)
const c = cad.compound({ members: [pad, pocket, pad001], dropSubsumed: [0, 1, 2] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `members` | `Shape[]` |  | — | 成员数组（Shape 或结构 compound；编译产物 ctx.<var> 引用） |
| `name` | `string` |  | — | 可选名称 |
| `dropSubsumed` | `number[]` |  | — | 可选「吞并删除」参与成员的下标列表（BREP-only） |

**同步**。Shape 几何复合体（brep 路径持句柄，可变换/可导出）。

> 成员经 `params.members` 传入，不是位置参数。与编辑器 `cad.group` 的区别：本 op 产出**几何**复合体（持 OCCT 句柄，可放置/导出），`group` 是结构壳（无句柄）。平台侧不要用 `group`。
>
> `dropSubsumed` 是 FreeCAD truth（`export-fcstd-truth.py` 的 `drop_cumulative_part_design`，经 fcstd-port `freecad-parity.py` 逐条移植）的 内核侧镜像：成员 i（在列表内）被更晚的列表内成员 j 以「逐 solid 体积和 ≥ i 的 ×(1−1e−6) 且 i 的包围盒落在 j 的包围盒内（容差 1e−6·max(1,|b|))」 吞并时，i 从复合体中删除。不在列表内的成员既不被删也不参与吞并（对应 truth 的 `is_pd` 门槛）。典型用途：Body-less PartDesign 链的中间特征 结果是 truth root（减材料步骤永不吞并前一特征），需要按同规则裁剪后 才能与 FreeCAD 场景对齐。

### 7.3 `group` ✅ 🚫

分组：零约束，保持当前布局。结构语句，无几何输出，成员用变量名引用。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（无几何输出，服务于编辑器画布与时间线），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。**平台侧需要几何复合体请用 `cad.compound`**（内核 `makeCompound`，持 OCCT 句柄，可变换/可导出）。

```js
const part0 = cad.box(30, 20, 10, { centered: true })
cad.group({ name: '底板组', members: [part0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | `string` |  | — | 组名 |
| `members` | `Shape[]` |  | — | 成员（编译产物 ctx.<var> 引用；结构语句里是裸变量引用，非字符串数组） |
| `more` | `Shape[]` |  | — | 位置参数形态的成员（cad.group(a, b, ...)），经 normalizeGroupCall 归入 members |

**同步**。CompoundShape 复合几何（kind='compound'，children 为成员 Shape 引用）。

> members 在 .fai.js 里是裸变量引用（编译为 ctx.<var>），字符串数组形态的成员名经 keep() 反查兼容历史 IR。

---

## 8. 查询类操作（几何 / 资产引用 / 装配查询）

### 8.1 `area` ✅

```js
(shape: Shape) -> number(面积 mm²)
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**同步**。number(面积 mm²) —— 纯数据结果（非 Shape）。

> **中立 op**：直连 L1 测量面，无引擎绑定，occt / brepkit 上同一份 `.fai.js` 都跑。返回纯数字，不产 Shape；需要体积+面积+质心一次取回且接受 occt 独占时用 `cad.inspectMassProps`。
>
> 自动派生自 `api/surface/arg-spec.ts`（module `measurement`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`measurement/index.js#area`。

### 8.2 `asset` ✅

查询资产 key 内容为 UTF-8 字符串（SVG 等文本资产）。嵌套调用，供 text/svg 类 op 作资产引用。

```js
const svg = cad.asset('logo_cfg')
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `key` | `string` | ✅ | — | 资产 key |

**异步**。Promise<string> 资产内容字符串（UTF-8 解码）。`cad.asset('cfg')` 返回 SVG 等文本资产，可作 svgExtrude/engrave 的 svg 参数。

### 8.3 `bboxCenter` ✅

查询几何包围盒中心。

```js
const c = cad.bboxCenter(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何 |

**同步**。Vec3 包围盒中心 [x,y,z]。交互式可编辑（参数量引用）。

### 8.4 `bboxMax` ✅

查询几何包围盒最大角点。

```js
const mx = cad.bboxMax(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何 |

**同步**。Vec3 包围盒最大角点 [x,y,z]。

### 8.5 `bboxMin` ✅

查询几何包围盒最小角点。

```js
const mn = cad.bboxMin(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何 |

**同步**。Vec3 包围盒最小角点 [x,y,z]。

### 8.6 `centerOfMass` ✅

```js
(shape: Shape) -> BrepVec3(质心 mm)
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**同步**。BrepVec3(质心 mm) —— 纯数据结果（非 Shape）。

> 自动派生自 `api/surface/arg-spec.ts`（module `measurement`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`measurement/index.js#centerOfMass`。

### 8.7 `classifyPointOnFace` ✅

UV 点相对面边界的分类（BRepClass_FaceClassifier）。

```js
const cls = cad.classifyPointOnFace(f, 0.5, 0.5)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 被判定的面 |
| `u` | `number` | ✅ | — | U 参数 |
| `v` | `number` | ✅ | — | V 参数 |

**同步**。string 'in' | 'on' | 'out'。

> 平台 op：仅 occt 引擎（原生 classifyPointOnFace）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.8 `containsPoint` ✅

点是否在实体内（含边界，带容差）。

```js
const inside = cad.containsPoint(box, [1, 1, 1])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被检测的形状（语义上是实体/壳） |
| `point` | `Vec3` | ✅ | — | 待判定点 [x,y,z] |
| `tolerance` | `number` |  | — | 判定容差（模型单位） |

**同步**。boolean 点是否在形状内。

> 平台 op：仅 occt 引擎（原生 containsPoint，L1 契约无对应成员）。 非 occt 引擎执行前报 E_BREP_UNSUPPORTED。坐标收脚本面的 [x,y,z]。

### 8.9 `curveDegreeElevate` ✅

NURBS 曲线升阶：把边/曲线的阶数提升 `elevateBy`（几何不变，表示空间变大）。

```js
const up = cad.curveDegreeElevate(e, 2)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `curve` | `Shape` | ✅ | — | 输入边/曲线 |
| `elevateBy` | `number` | ✅ | — | 升阶量（正整数） |

**同步**。Shape 升阶后的 1D 曲线（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 curveDegreeElevate）。输入边/曲线。

### 8.10 `curveIsPeriodic` ✅

曲线是否周期（契约只有 `curveIsClosed`，周期性是 occt 原生独有查询）。

```js
const c = cad.circleArc([0,0,0], [0,0,1], 5, 0, 360)
const periodic = cad.curveIsPeriodic(c)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `curve` | `Shape` | ✅ | — | 被查询的边/曲线 |

**同步**。boolean 是否为周期曲线。

> 平台 op：仅 occt 引擎（原生 curveIsPeriodic，L1 无对应成员）。非 occt 引擎 执行前报 E_BREP_UNSUPPORTED。

### 8.11 `curveKnotInsert` ✅

NURBS 曲线插节点：在曲线参数 `knot` 处插入节点 `times` 次（几何不变）。

```js
const refined = cad.curveKnotInsert(e, 0.5, 1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `curve` | `Shape` | ✅ | — | 输入边/曲线 |
| `knot` | `number` | ✅ | — | 目标节点参数 |
| `times` | `number` | ✅ | — | 重复次数（正整数） |

**同步**。Shape 插节点后的 1D 曲线（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 curveKnotInsert）。knot 是曲线参数（不是长度）。

### 8.12 `curveKnotRemove` ✅

NURBS 曲线去节点：在容差内移除参数 `knot` 处的节点（几何漂移不超过 tolerance）。

```js
const lean = cad.curveKnotRemove(e, 0.5, 1e-4)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `curve` | `Shape` | ✅ | — | 输入边/曲线 |
| `knot` | `number` | ✅ | — | 目标节点参数 |
| `tolerance` | `number` | ✅ | — | 允许的几何漂移（mm，>0） |

**同步**。Shape 去节点后的 1D 曲线（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 curveKnotRemove）。knot 是曲线参数（不是长度）。

### 8.13 `distanceBetween` ✅

两形状之间的最短距离。

```js
const gap = cad.distanceBetween(box1, box2)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `a` | `Shape` | ✅ | — | 第一个形状 |
| `b` | `Shape` | ✅ | — | 第二个形状 |

**同步**。number 最短距离（模型单位；相交为 0）。

> 平台 op：仅 occt 引擎（原生 distanceBetween，BRepExtrema_DistShapeShape）。 非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.14 `edgeRef` ✅

查询几何体第 N 条边的 `EdgeTopoRef`（1 起），供按 role 线路选边（`cad.fillet` / `cad.chamfer` 的 `edges` 等）使用。**查询用途，不用于脚本生成**——序号是内核 枚举序，跨内核/跨特征会漂移；本 API 仅供 FCStd 移植桥与网格链等无 role 层场景使用。 定不了案（无 BREP / 序号越界 / 邻面不足两面 / 邻面无 role 血统）抛 `TopoRefError`。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何（BREP 实体所在的 Shape） |
| `edgeOrdinal` | `number` | ✅ | — | 边序号（1 起；等于 FreeCAD 的 `EdgeN`） |

**同步**。EdgeTopoRef 该边的拓扑引用（相邻两面 role 对 + length/midpoint hint）。

> ⚠️ 查询用途，不用于脚本生成：序号跨内核不可移植（同实体 occt 与 brepkit 枚举序不同）。生成脚本应使用 TopoRef 字面量（UI 拾取产物）或 CadQuery 选择器字符串（AI 生成）。
>
> 序号 1 起，与命名层 `TopoRef.ordinal` 及 FreeCAD `EdgeN` 同序（`getSubShapes(solid,'edge')` 用 TopExp::MapShapes + IndexedMap 枚举）。

### 8.15 `faceBySelector` ✅

按语义选择器定位一张面并返回它的 `FaceTopoRef`。 结果可直接作为 `addDatum` / `addGdt` / `addSurfaceFinish` / `addDimension` 的 `target(s)`，PMI 数据模型仍是纯 `TopoRef`， 解析发生在**参数层**而不是执行后回填数据层。

```js
const base = cad.faceBySelector(part0, '>Z')
part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: base })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何（BREP 实体所在的 Shape） |
| `selector` | `string` | ✅ | — | 轴向选择器或命名视图，如 '>Z' / '<X' / 'top' |

**同步**。FaceTopoRef 选中面的拓扑引用（origin/role 血统 + 几何 hint）。

> ⚠️ 这是 AI 生成脚本该用的面引用入口；序号式 faceRef 引用跨内核不可移植，勿用于生成脚本。
>
> 定不了案（无 BREP / 无 role 血统 / 语法不支持 / 无可用质心）一律抛 `TopoRefError`，不静默退化。

### 8.16 `faceNormal` ✅

查询面上某点（锚点）的法向。

```js
const n = cad.faceNormal(part0, [0, 0, 5])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何（编译产物 ctx.<var> 引用） |
| `anchor` | `[x,y,z]` |  | — | 锚点（几何反查兜底） |
| `ordinal` | `number` |  | — | 面序号（BREP 拓扑引用优先） |

**同步**。Vec3 面上锚点处的法向 [x,y,z]。

### 8.17 `faceRef` ✅

查询几何体第 N 张面的 `FaceTopoRef`（1 起），供按 role 线路选面（`cad.extrude` 的 `upTo` 等）使用。**查询用途，不用于脚本生成**——序号是内核枚举序，跨内核/跨特征 会漂移；本 API 仅供 FCStd 移植桥与网格链等无 role 层场景使用。 定不了案（无 BREP / 序号越界 / 面无 role 血统）抛 `TopoRefError`。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何（BREP 实体所在的 Shape） |
| `faceOrdinal` | `number` | ✅ | — | 面序号（1 起；等于 FreeCAD 的 `FaceN`） |

**同步**。FaceTopoRef 该面的拓扑引用（origin/role 血统 + 几何 hint）。

> ⚠️ 查询用途，不用于脚本生成：序号跨内核不可移植（同实体 occt 与 brepkit 枚举序不同）。生成脚本应使用 TopoRef 字面量（UI 拾取产物）或 CadQuery 选择器字符串（AI 生成）。
>
> 序号 1 起，与命名层 `TopoRef.ordinal` 及 FreeCAD `FaceN` 同序（`getSubShapes(solid,'face')` 用 TopExp::MapShapes + IndexedMap 枚举）。

### 8.18 `formatTechNote` ✅

技术要求块的完整显示文本（多行，以 `\n` 连接）。 例：`'技术要求\n1. 未注倒角 C0.3\n2. 未注公差按 GB/T 1804-m'`。

```js
const text = cad.formatTechNote(cad.pmiTechNotes(part0)[0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `item` | `PmiTechNote` | ✅ | — | the technical-requirement block. |

**同步**。string 多行显示文本。

### 8.19 `formatThreadHole` ✅

螺纹孔标注的完整显示文本——**底孔 + 螺纹一起呈现**。 例： - 攻丝孔：`'4×M6-6H ↓14（底孔 Φ5 ↓16，攻丝）'` - 无公差等级：`'M6 ↓14（底孔 Φ5 ↓16，攻丝）'` - 建模螺纹：`'M6 ↓14（实体螺纹）'`

```js
const text = cad.formatThreadHole(cad.pmiThreads(part0)[0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `item` | `PmiThreadHole` | ✅ | — | the thread-hole annotation. |

**同步**。string 单行显示文本。

### 8.20 `inertia` ✅

绕质心的惯性矩阵（row-major 3×3，长度 9；对称：[1]==[3]、[2]==[6]、[5]==[7]）。

```js
const m = cad.inertia(box)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被测量的形状 |

**同步**。number[] row-major 3×3 惯性矩阵。

> 平台 op：仅 occt 引擎（原生 getInertia）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.21 `inspectMassProps` ✅

occt 独占诊断（绕轴惯性矩/主轴，中立面没有）→ inspect* 命名进脚本面（§7 待裁决 4）

```js
(shape: Shape) -> { volume, area, centerOfMass }（core）
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 目标实体（体积/质心/惯量/主轴） |

**同步**。{ volume: number; area: number; centerOfMass: { x: number; y: number; z: number } } —— 纯数据结果（非 Shape）。

> 自动派生自 `api/surface/arg-spec.ts`（module `measurement`）——生成 op 无手写 JSDoc 契约。
>
> **平台限定**：仅 `occt` 引擎（缺能力时执行前静态报错，不回退）。
>
> 实现：`measurement/measureFns.js#measureVolumeProps`。

### 8.22 `inverseKinematics` ✅

`cad.inverseKinematics({ joints, endEffector, target, options? })` — damped-least-squares IK：求使末端到达 target 的关节值。关节范围在每个迭代 clamp；不可达目标返回 converged:false 与最优配置。纯函数，无副作用。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `p` | `InverseKinematicsParams` | ✅ | — | IK 查询参数 |

**同步**。IKResult 关节值 + 收敛诊断（converged / iterations / error）。

> 纯函数：输入输出都是纯数据，不产 Shape、不依赖引擎；装配面契约见 `docs/api-contract.md` §12。

### 8.23 `isCompound` ✅

形状是否为复合体（compound）。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被判别的形状 |

**同步**。boolean 是否为复合体。

> 平台 op：仅 occt 引擎（原生 isCompound）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.24 `isCompSolid` ✅

形状是否为组合实体（comp-solid）。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被判别的形状 |

**同步**。boolean 是否为组合实体。

> 平台 op：仅 occt 引擎（原生 isCompSolid）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.25 `isEdge` ✅

形状是否为边（edge）。

```js
const e = cad.makeLineEdge([0,0,0],[1,0,0])
const yes = cad.isEdge(e)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被判别的形状 |

**同步**。boolean 是否为边。

> 平台 op：仅 occt 引擎（原生 isEdge）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.26 `isEqual` ✅

两个形状是否为同一几何实体（occt 原生 `isEqual` 语义）。 occt 的 `IsEqual` 当且仅当两形状共享同一 `TShape` 且 `Location`/`Orientation` 相同时返回 true——即「同一几何实体」，不是「几何内容相同但独立构造」。因此两个 几何相同但各自 `makeBox` 出来的形状会返回 false；要比较「内容相同」需另走几何 比较（非本 op 职责）。区别于 `isSame`（同一句柄引用）。

```js
const same = cad.isEqual(part0, part0)   // true（同一手柄）
const diff = cad.isEqual(part0, part1)   // 独立构造的相同几何 → false
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `a` | `Shape` | ✅ | — | 第一个形状 |
| `b` | `Shape` | ✅ | — | 第二个形状 |

**同步**。boolean 是否为同一几何实体。

> 平台 op：仅 occt 引擎（原生 isEqual，L1 无对应成员）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.27 `isFace` ✅

形状是否为面（face）。

```js
const f = cad.makeFace(wire)
const yes = cad.isFace(f)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被判别的形状 |

**同步**。boolean 是否为面。

> 平台 op：仅 occt 引擎（原生 isFace）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.28 `isSameShape` ✅

两整件同构比较（纯数据），query

```js
isSameShape(a: Shape, b: Shape): boolean（core）
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `a` | `Shape` | ✅ | 第一个被比较形状 |
| `b` | `Shape` | ✅ | 第二个被比较形状 |

**同步**。boolean —— 纯数据结果（非 Shape）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`core:brep-operations#isSameShape`。

### 8.29 `isShell` ✅

形状是否为壳（shell）。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被判别的形状 |

**同步**。boolean 是否为壳。

> 平台 op：仅 occt 引擎（原生 isShell）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.30 `isValid` ✅

整件合法性检查（Shape → boolean 纯数据），query

```js
isValid(shape: Shape): boolean（core）
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**同步**。boolean —— 纯数据结果（非 Shape）。

> 自动派生自 `api/surface/arg-spec.ts`（module `topology`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`core:brep-operations#isValid`。

### 8.31 `isVertex` ✅

形状是否为顶点（vertex）。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被判别的形状 |

**同步**。boolean 是否为顶点。

> 平台 op：仅 occt 引擎（原生 isVertex）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.32 `isWire` ✅

形状是否为线（wire）。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被判别的形状 |

**同步**。boolean 是否为线。

> 平台 op：仅 occt 引擎（原生 isWire）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.33 `iterShapes` ✅

遍历全部子形状（递归展平，返回 Shape[]）。

```js
const subs = cad.iterShapes(box)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被遍历的形状 |

**同步**。Shape[] 子形状列表（vertex/edge/wire 形态为 curve）。

> 平台 op：仅 occt 引擎（原生 iterShapes；L1 契约的 getSubShapes 只按类型单层取）。 非 occt 引擎执行前报 E_BREP_UNSUPPORTED。 返回 Shape 数组（非单个 Shape）⇒ 普通函数形态，与 shape-type 同口径。

### 8.34 `jointTrajectory` ✅

`cad.jointTrajectory({ joints, from, to, steps })` — 关节空间直线路径采样。 产出 steps+1 个采样（含两端点）；joints 缺省值在两端取存储值。 无 endEffector 参数（关节空间插值，不追踪端点）。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `p` | `JointTrajectoryParams` | ✅ | — | 轨迹查询参数 |

**同步**。FaijsTrajectorySample[] 采样序列（steps+1 个，含两端点）。

> 纯函数：输入输出都是纯数据，不产 Shape、不依赖引擎；装配面契约见 `docs/api-contract.md` §12。

### 8.35 `length` ✅

```js
(shape: Shape) -> number(长度 mm)
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**同步**。number(长度 mm) —— 纯数据结果（非 Shape）。

> **中立 op**：直连 L1 测量面，无引擎绑定，occt / brepkit 上同一份 `.fai.js` 都跑（线/边长度）。返回纯数字，不产 Shape。
>
> 自动派生自 `api/surface/arg-spec.ts`（module `measurement`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`measurement/index.js#length`。

### 8.36 `linearCenterOfMass` ✅

线性质心（按边长加权的质心；wire/edge 用它与体积质心区分）。

```js
const c = cad.linearCenterOfMass(wire)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被测量的形状 |

**同步**。Vec3 线性质心坐标 [x,y,z]。

> 平台 op：仅 occt 引擎（原生 getLinearCenterOfMass）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。返回脚本面的 [x,y,z]（非 occt 的 {x,y,z} 对象）。

### 8.37 `mechanismDOF` ✅

`cad.mechanismDOF({ joints })` — 开链机构自由度 = 各 joint DOF 数之和 （revolute/prismatic 各 1；串联两 revolute = 2）。纯函数，无副作用。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `p` | `MechanismDOFParams` | ✅ | — | 自由度查询参数 |

**同步**。number 机构总自由度。

> 纯函数：输入输出都是纯数据，不产 Shape、不依赖引擎；装配面契约见 `docs/api-contract.md` §12。

### 8.38 `outerWire` ✅

取面的外环（outer wire）：面上边界中最大的闭合 wire，1D 产物。

```js
const ow = cad.outerWire(face0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 输入面 |

**同步**。Shape 面的外环（kind:'curve'）。

> 平台 op：仅 occt 引擎（原生 outerWire）。产物 kind='curve'（1D wire）。

### 8.39 `pmiDatums` ✅

Query datum identifier → datum mapping.

```js
const datums = cad.pmiDatums(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | the shape to query. |

**同步**。Record<string, PmiDatum> — datum identifier → datum.

### 8.40 `pmiItems` ✅

Query PMI annotations on a shape, optionally filtered by kind or target type.

```js
const dims = cad.pmiItems(part0, { kind: 'dimension' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | the shape to query. |
| `filter` | `object` |  | — | optional filter. |

**同步**。PmiItem[] — matching PMI annotations.

### 8.41 `pmiOn` ✅

Query all PMI annotations attached to a specific TopoRef.

```js
const annos = cad.pmiOn(part0, cad.faceBySelector(part0, '>Z'))
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | the shape to query. |
| `ref` | `TopoRef` | ✅ | — | the topology reference (face/edge/vertex). |

**同步**。PmiItem[] — annotations attached to the given TopoRef.

### 8.42 `pmiTechNotes` ✅

查询零件级技术要求块（编号条目）。 便捷封装：等价 `pmiItems(shape, { kind: 'techNote' })`，但返回精确类型。 这类条目无 target，渲染时进图纸全局注释块，不参与视图归属打分。

```js
const blocks = cad.pmiTechNotes(part0)
console.log(cad.formatTechNote(blocks[0]))
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | the shape to query. |

**同步**。PmiTechNote[] — 该零件上的全部技术要求块。

### 8.43 `pmiThreads` ✅

查询螺纹孔标注（含底孔几何 + 后加工攻丝两组信息）。 便捷封装：等价 `pmiItems(shape, { kind: 'threadHole' })`，但返回精确类型。

```js
const taps = cad.pmiThreads(part0)
console.log(cad.formatThreadHole(taps[0]))  // 'M6-6H ↓14（底孔 Φ5 ↓16，攻丝）'
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | the shape to query. |

**同步**。PmiThreadHole[] — 该零件上的全部螺纹孔标注。

### 8.44 `projectPointOnEdge` ✅

点到边的最近点（含该处切向与参数）。

```js
const hit = cad.projectPointOnEdge(e, [3, 4, 0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edge` | `Shape` | ✅ | — | 被投影的边 |
| `point` | `Vec3` | ✅ | — | 待投影点 [x,y,z] |

**同步**。object { point: Vec3; tangent: Vec3; parameter: number }。

> 平台 op：仅 occt 引擎（原生 projectPointOnEdge）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。返回体里的 point/tangent 是脚本面的 [x,y,z]。

### 8.45 `projectPointOnFace` ✅

点到面的最近点（三维坐标）。

```js
const p = cad.projectPointOnFace(f, [3, 4, 5])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 被投影的面 |
| `point` | `Vec3` | ✅ | — | 待投影点 [x,y,z] |

**同步**。Vec3 面上的最近点 [x,y,z]。

> 平台 op：仅 occt 引擎（原生 projectPointOnFace）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。要 UV 参数用 `uvFromPoint`。

### 8.46 `projectSheet` ✅

多视图投影图纸 → 组合 SVG 字符串（纯数据，不消费/修改 shape）。

```js
const sheet = cad.projectSheet(part0, ['front', 'top', 'right', 'iso'])
const sheet = cad.projectSheet(part0, [{ view: 'front', label: '主视图' }], { cols: 2, gap: 40, labels: true })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 目标几何（必须有 BREP 槽；mesh-only 抛 E_BREP_ONLY_INPUT） |
| `views` | `(string|{view,label?})[]` | ✅ | — | 视图列表：视图规格字符串，或 { view, label? } 对象（方向对象自动生成 x,y,z 标签） |
| `cols` | `number` |  | 2 | 网格列数 |
| `gap` | `number` |  | — | 格间距（模型单位；缺省 = 最大视图高度 × 0.12） |
| `padding` | `number` |  | — | 图纸外留白（模型单位；缺省 = 最大视图高度 × 0.12） |
| `labels` | `boolean` |  | true | 是否渲染 <text> 标签 |
| `labelFontSize` | `number` |  | — | 标签字号（模型单位；缺省 = 最大视图高度 × 0.07） |
| `pmi` | `boolean|object` |  | true | PMI 图层：每条标注**只在一个视图里出现**（自动挑最看得清该特征的视图，见 assignPmiToViews），各视图独立 <g> 图层、自动摆放；全局注释块整张图纸只画一次、位于右下角。true/缺省自动渲染，false 关闭 |

**同步**。SVG 字符串（嵌套 <svg x y width height viewBox preserveAspectRatio> + <text> 标签）。空列表返回空 SVG 不抛错。

### 8.47 `projectView` ✅

单视图投影 → SVG 线稿字符串（纯数据，不消费/修改 shape；规则 1 下裸调用不消费输入）。

```js
const svg = cad.projectView(part0, 'front')
const svg = cad.projectView(part0, 'iso', { strokeWidth: 1, dash: '4,4', hiddenOpacity: 0.6 })
const svg = cad.projectView(part0, 'front', { pmi: { fontSize: 9, showHiddenTargets: false } })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 目标几何（必须有 BREP 槽；mesh-only 抛 E_BREP_ONLY_INPUT） |
| `view` | `string|{dir,xAxis?}` | ✅ | — | 视图规格（同 viewCamera：标准视图名 / iso / 轴对平面 / 方向对象） |
| `strokeWidth` | `number` |  | 1 | 可见线宽（stroke-width） |
| `dash` | `string` |  | '4,4' | 隐藏线虚线样式（stroke-dasharray） |
| `hiddenOpacity` | `number` |  | 0.6 | 隐藏线透明度 |
| `margin` | `number` |  | 1 | viewBox 外扩边距 |
| `width` | `number` |  | — | 输出宽度（缺省 = viewBox 宽度） |
| `height` | `number` |  | — | 输出高度（缺省 = viewBox 高度） |
| `pmi` | `boolean|object` |  | true | PMI 图层：true/缺省自动渲染 shape 上的 PMI 标注（独立 <g> 图层，自动摆放），false 关闭，对象可定制字号/颜色/背面标注/全局块 |

**同步**。SVG 字符串（<svg viewBox="…"> + 可见实线 <path> + 隐藏虚线 <path>）。裸调用 cad.projectView(part0, 'front') 不消费 part0（规则 1），part 仍留在 canvas。

### 8.48 `reverseSurfaceU` ✅

反转面的 U 参数方向（occt `Geom_Surface::UReverse` 语义）：返回新面代理， 其曲面是原曲面的 U 反转版（拓扑不变，UV 求值随之镜像）。

```js
const flipped = cad.reverseSurfaceU(f)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 输入面 |

**同步**。Shape U 反转后的面。

> 平台 op：仅 occt 引擎（原生 reverseSurfaceU）。输入面。

### 8.49 `subShapeCount` ✅

子形状计数（不物化逐个子形状句柄）。

```js
const n = cad.subShapeCount(box, 'face')
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被统计的形状 |
| `type` | `string` | ✅ | — | 子形状类型（vertex/edge/wire/face/shell/solid） |

**同步**。number 该类子形状的个数。

> 平台 op：仅 occt 引擎（原生 subShapeCount；L1 契约只有 getSubShapes， 计数能力是 occt 独有）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.50 `uvFromPoint` ✅

三维点 → 面的 UV 参数。

```js
const { u, v } = cad.uvFromPoint(f, [1, 2, 0])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 目标面 |
| `point` | `Vec3` | ✅ | — | 三维点 [x,y,z] |

**同步**。object { u: number; v: number }。

> 平台 op：仅 occt 引擎（原生 uvFromPoint）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 8.51 `vertexPosition` ✅

顶点坐标。

```js
const p = cad.vertexPosition(v)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `vertex` | `Shape` | ✅ | — | 顶点形状 |

**同步**。Vec3 顶点坐标 [x,y,z]。

> 平台 op：仅 occt 引擎（原生 vertexPosition）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。返回脚本面的 [x,y,z]。

### 8.52 `viewCamera` ✅

解析视图规格为投影相机（纯数据，无 Shape 输入；不消费任何几何）。

```js
const cam = cad.viewCamera('iso')
const cam = cad.viewCamera({ dir: [1, -1, 1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `view` | `string|{dir,xAxis?}` | ✅ | — | 视图规格：标准视图名（front/back/top/bottom/left/right/iso（=isometric）/XY/XZ/YZ/YX/ZX/ZY）或方向对象 |

**同步**。{ direction, xAxis? } 归一化方向向量（iso = (1,-1,1)/√3，与 FreeCAD/OCCT 惯例一致）。未知视图名抛错；零方向向量抛错。用于 3d_editor 侧三轴相机渲染（mesh/SDF 形状的截图通道）。

### 8.53 `volume` ✅

```js
(shape: Shape) -> number(体积 mm³)
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `shape` | `Shape` | ✅ | 几何输入（Shape） |

**同步**。number(体积 mm³) —— 纯数据结果（非 Shape）。

> **中立 op**：直连 L1 测量面，无引擎绑定，occt / brepkit 上同一份 `.fai.js` 都跑。返回纯数字，不产 Shape；需要体积+面积+质心一次取回且接受 occt 独占时用 `cad.inspectMassProps`。
>
> 自动派生自 `api/surface/arg-spec.ts`（module `measurement`）——生成 op 无手写 JSDoc 契约。
>
> 实现：`measurement/index.js#volume`。

---

## 9. 布尔类操作（inputs ≥ 1）

### 9.1 `commonCells` ✅

求多个形状的重叠区域（通用熔合胞元，常用于干涉检查）。

```js
const overlap = cad.commonCells([boxA, boxB, boxC])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 输入形状数组（≥2） |

**同步**。Shape 重叠区域（无重叠时为空复合体）。

> 平台 op：仅 occt 引擎（原生 intersectionCells；与 `intersect` 的区别： 后者是两形状求交，本 op 支持 ≥2 输入并返回全部重叠胞元）。 非 occt 引擎执行前报错；brep_mock 不拦截。

---

## 10. 导出类操作（inputs ≥ 1）

### 10.1 `export3mf` ✅

导出 3MF（ZIP 容器字节）。

```js
const bytes = cad.export3mf(part0)
const asmBytes = cad.export3mf(asm1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape|CompoundShape` | ✅ | — | 目标几何（单件 Shape 或装配 compound） |
| `unit` | `UnitName` |  | — | 文件里声明的长度单位，缺省 mm（坐标随之换算） |

**同步**。Uint8Array 3MF（ZIP）字节。

> 薄壳 op：条目构造后一律交库面 `exportModelSync(entries,'3mf',{unit})` 序列化， 故同一入参下脚本面字节与库面**逐字节一致**（同一真源）。返回 **ZIP 字节** （`Uint8Array`），由宿主写入 `.3mf` 文件——内核不 import fs。`unit` 只声明单位 （写 `<model unit>`），坐标随之换算，两者同源（缺省 mm）。 入参可为单件 Shape 或装配 compound；compound 逐成员导出并带上成员名与 `memberColors`（basematerials）。条目**只交 mesh**：无 mesh 的条目会被写出器 静默跳过、产出「ZIP 合法但对象为空」的假成功，故三角数为 0 的成员视为不可导出， 全体不可导出时显式报 E_EXPORT_3MF_EMPTY。 **宿主门**：仅 `'node'` 宿主可执行；browser / weapp / 未声明宿主报 E_HOST_UNSUPPORTED（门在读取载荷之前）。无引擎门——写出器是纯 XML + ZIP， 与引擎身份无关。

### 10.2 `exportBrep` ✅

导出 BREP 文本（与 `import_brep` 成对的导出侧）。

```js
const text = cad.exportBrep(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 目标几何（必须带 BREP 槽；mesh-only 输入报 E_EXPORT_BREP_NO_BREP） |

**同步**。string OCCT BREP 文本。

> 平台 op：仅 occt 引擎（原生 toBREP，L1 契约无对应导出成员）。非 occt 引擎 执行前报 E_BREP_UNSUPPORTED；brep_mock 不拦截（引擎身份判定读 `config.brepEngineId`）。返回**纯文本**，由宿主写入 `.brep` 文件； 经 `import_brep` / L1 `fromBREP` 可无损回读（精确 BREP，非 mesh 回填）。 **宿主门**：仅 `'node'` 宿主可执行，且宿主门先于引擎门——browser / weapp / 未声明宿主报 E_HOST_UNSUPPORTED（不读 BREP 槽、不触碰内核）。

### 10.3 `exportStep` ✅

导出 STEP 文本（与 `cad.import_step` 成对的导出侧）。

```js
const text = cad.exportStep(part0)
const asm = cad.exportStep(asm1, { unit: 'inch' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape|CompoundShape` | ✅ | — | 目标几何（单件 Shape 或装配 compound） |
| `unit` | `UnitName` |  | — | 文件里声明的长度单位，缺省 mm（坐标随之换算） |

**同步**。string STEP（ISO-10303-21）文本。

> 薄壳 op：条目构造后一律交库面 `exportModelSync(entries,'step',{unit})` 序列化， 故同一入参下脚本面文本与库面**逐字节一致**（同一真源，不另起写出通道）。 返回**纯文本**（ISO-10303-21），由宿主写入 `.step` / `.stp` 文件——内核不 import fs。`unit` 只声明单位，坐标换算与声明由库面成对完成（缺省 mm）。 入参可为单件 Shape 或装配 compound（`cad.assembly` / `cad.group` 产物）， compound 逐成员导出并带上成员名与 `memberColors`；空装配显式报 E_EXPORT_STEP_EMPTY，不落空文件。 **宿主门**：仅 `'node'`（browser / weapp / 未声明报 E_HOST_UNSUPPORTED）。 引擎通道无门禁：库面按当前引擎分派——brepkit → 内核原生通道（unit/fileMeta 不生效），occt → XCAF 装配通道。

### 10.4 `exportStl` ✅

导出 STL（二进制 / ASCII 双形态）。

```js
const bytes = cad.exportStl(part0)
const text = cad.exportStl(part0, { ascii: true, name: 'bracket' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 目标几何（brep 或 mesh 链路的 Shape） |
| `ascii` | `boolean` |  | — | true = ASCII STL 文本，缺省 = 二进制 |
| `name` | `string` |  | — | 实体名（缺省 'Faicad STL'） |

**同步**。Uint8Array 二进制 STL 字节；`options.ascii === true` 时返回 ASCII 文本 string。

> 中立 op：只序列化 Shape 自带的三角载荷（brep 与 mesh 链路同一份实现）， 不走原生二次三角化，产物与显示 mesh 逐三角形一致。空 mesh（如 `cad.halfSpace` 产的无界体）显式报 E_EXPORT_STL_EMPTY，不返回空文件。 返回值是**纯数据**（二进制 `Uint8Array` 或 ASCII 文本），由宿主写入文件。 **宿主门**：仅 `'node'` 宿主可执行；browser / weapp / 未声明宿主报 E_HOST_UNSUPPORTED（门在读取载荷之前），浏览器与小程序里导出走宿主入口。

---

## 11. 视图类操作（inputs ≥ 1）

### 11.1 `toMultiviewPNG` ✅

将形状栅格化为多视图 PNG 字节（与 toMultiviewSVG 同绘制）。

```js
const sheet = cad.toMultiviewPNG(box)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被渲染的形状 |
| `options` | `object` |  | — | 多视图渲染选项 |

**异步**。Promise<Uint8Array> 多视图 PNG 字节流。

> 平台 op：仅 occt 引擎（原生 toMultiviewPNG，返回 Promise<Uint8Array>）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 11.2 `toMultiviewSVG` ✅

将形状渲染为多视图 SVG 图纸（Front/Top/Right/Iso 默认排布，含 gnomons 与尺寸标注）。

```js
const sheet = cad.toMultiviewSVG(box)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被渲染的形状 |
| `options` | `object` |  | — | 多视图渲染选项 |

**同步**。string 多视图 SVG 文本。

> 平台 op：仅 occt 引擎（原生 toMultiviewSVG）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

### 11.3 `toPNG` ✅

将形状栅格化为 PNG 字节（与 toSVG 同绘制，经 CompressionStream 压缩）。

```js
const png = cad.toPNG(box, 'iso')
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被渲染的形状 |
| `view` | `string` |  | — | 命名视图（front/top/right/iso 等） |
| `options` | `object` |  | — | PNG 渲染选项 |

**异步**。Promise<Uint8Array> PNG 字节流。

> 平台 op：仅 occt 引擎（原生 toPNG，返回 Promise<Uint8Array>）。非 occt 引擎 执行前报 E_BREP_UNSUPPORTED。

### 11.4 `toSVG` ✅

将形状渲染为 SVG 字符串（HLR 隐藏线消除，单命名视图）。

```js
const svg = cad.toSVG(box, 'iso')
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 被渲染的形状 |
| `view` | `string` |  | — | 命名视图（front/top/right/iso 等） |
| `options` | `object` |  | — | SVG 渲染选项 |

**同步**。string SVG 文本（含命名视图与隐藏边虚线样式）。

> 平台 op：仅 occt 引擎（原生 toSVG）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。

---

## 12. BREP 能力声明（compat op → 内核方法真名）

来自 `packages/core/src/api/surface/capability-map.json`（Phase 0 生成，36 compat op、64 个唯一内核方法）；能力名三层结构、静态前置判定与报错形态见 `docs/api-contract.md` §7.9 / §8.1；引擎侧可执行性由各适配器的 `capabilities.methods` / `evolution` 声明决定（缺能力执行前静态报错，不伪造）。

| compat op | 内核方法真名（kernelMethods） |
|---|---|
| torus | generalTransform、makeTorus、release |
| extrude | extrude |
| revolve | revolveVec |
| sweep | simplePipe、sweepFull、sweepPipeShell |
| complexExtrude | release、sweepPipeShell |
| twistExtrude | makeHelixWire、release、sweepPipeShell |
| linearPattern | linearPattern |
| circularPattern | circularPattern |
| gridPattern | gridPattern |
| roof | buildTriFace、fixShape、isSolid、release、sew、sewAndSolidify |
| drill | cut、getBoundingBox、release |
| pocket | cut、extrude、release、translate |
| boss | extrude、fuse、release、translate |
| mirrorJoin | fuse、mirror、release |
| rectangularPattern | fuseAll、release、translate |
| thread | loft、makeLineEdge、makeWire、release |
| convexHull | hullFromPoints、isSolid、release |
| makeBaseBox | extrude、makeRectangle、release |
| ellipsoid | makeEllipsoid |
| rotate | rotateWithHistory、transform |
| mirror | mirror、mirrorWithHistory |
| clone | copyShape |
| applyMatrix | generalTransform、transform |
| locate | locate |
| section | makeCompound、sectionByPlane |
| split | split |
| shell | shell |
| offset | offsetWithHistory |
| heal | getShapeType、healSolid、isSolid、isValid |
| simplify | simplify |
| autoHeal | getSubShapes、healSolid、healWire、isSolid、isValid、release、sew |
| fixShape | fixShape |
| healSolid | healSolid、isSolid、isValid |
| fixSelfIntersection | getShapeType、healWire |

---

## 13. 接口品质状态（自动派生自 @qual）

| op | 品质 | 说明 |
|---|---|---|
| `knurl` | ⚠️ | knurl 无 BREP 实现（mesh-only），本质是顶点位移（网格操作），网格参数可接受；brep 模式下调用前抛 BrepUnsupportedError。面锚定建议用几何引用。 |
| `sdf` | ⚠️ | SDF 无 BREP 实现（mesh-only）；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError。SDF 天生是网格操作，允许网格参数（resolution）。 |
| `assembly` | ⚠️ | 约束类型（a=参考、b=从动，移动 b 去贴合 a）：`mate` 面对面贴合（法向反向+面中心重合，遗留 face_mate 的新名，求解降级为 concentric + 轴编码）；`align` 同向对齐（法向同向+面中心重合）；`coincident` 共面/共点/共线（保留面内 2 个平移 DOF）；`concentric` 轴重合（孔轴配合，圆柱/圆锥面需 hint.axis，直边/圆边需 EdgeHint.axis）；`distance` 定距（mm，带 value）；`angle` 夹角（deg，带 value）；`parallel`/`perpendicular` 平行/垂直（angle 0°/90° 语法糖）；`fixed` 锚定部件（地基）；`fixedPoint`/`fixedAxis`/`fixedRotation` 世界锚定 unary（把成员子实体钉到世界字面点/方向、锁朝向，平移其余 DOF 仍自由，仅 `solver:'global'` 支持）；`face_mate` 为遗留别名（规范化为 mate，新代码不再使用）。 |
| `dxfExtrude` | ⚠️ | DXF 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份文件内联拷贝。轮廓解析用本仓自带的 ASCII DXF 解析器（LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE + bulge 圆弧 + INSERT 展开），不引入任何第三方 DXF 库；尺寸语义由调用方给 `targetLongSide` 长边归一（DXF 图纸单位不可信，不读 $INSUNITS）。 |
| `fai_split` | ⚠️ | 切割面统一用 `normal`/`offset`/`inPlaneAngle` 描述；早期文本层曾与执行层键名断裂（planeRotation/planePosition），已修并统一为上述键名。 |
| `svgExtrude` | ⚠️ | SVG 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份 XML 内联拷贝。自然尺寸（viewBox）与缩放已显式成参数（mesh/BREP 两条路径都解析 viewBox 并传递 naturalWidth/naturalHeight），尺寸语义不再依赖两套实现各自推导。 |
| `text` | ⚠️ | font 语义未定（当前只有默认字体），⚠️ 暂不要传。兼容 `cad.text(part0, {...})` 带输入形态（输入被忽略），正常写 `cad.text({...})` 即可。 |


---

## 14. 写给 AI 的速查（一句话总结每个可用 op）

```
创建: approximatePoints / box / circleArc / cone / convexHull / cylinder / draftPrism / dxfExtrude / edge / ellipseArc / ellipseEdge / ellipsoid / faceFromWire / faceOnSurface / halfSpace / helix / import_brep / import_step / interpolateWithTangents / liftCurve2d / makeBaseBox / makeSolid / nonPlanarFace / pipe / profile / punchHole / screw / sdf / sketch / sketchOnFace / sketchOnPlane / sketchOnSurface / sphere / surface / svgExtrude / tangentArc / text / thread / torus / wedge / wire / wireFromEdges
变换: alignTo / applyMatrix / locate / offset / place / rotate
特征: boolean / boss / chamfer / circularPattern / clone / complexExtrude / cut / draft / drill / extrude / fillet / filletVariable / fuse / gridPattern / intersect / knurl / linearPattern / loft / loftAdvanced / mirror / mirrorJoin / offset2d / pocket / rectangularPattern / revolve / roof / sectionByPlane / shell / solidFromFaces / split / splitByPlane / subtract / sweep / sweepAdvanced / thicken / twistExtrude / union
修复: autoHeal / defeature / fixSelfIntersection / fixShape / heal / healSolid / removeHolesFromFace / reverseShape / sew / sewAndSolidify / simplify / unifySameDomain
结构: compound
查询: area / asset / bboxCenter / bboxMax / bboxMin / centerOfMass / classifyPointOnFace / containsPoint / curveDegreeElevate / curveIsPeriodic / curveKnotInsert / curveKnotRemove / distanceBetween / edgeRef / faceBySelector / faceNormal / faceRef / formatTechNote / formatThreadHole / inertia / inspectMassProps / inverseKinematics / isCompound / isCompSolid / isEdge / isEqual / isFace / isSameShape / isShell / isValid / isVertex / isWire / iterShapes / jointTrajectory / length / linearCenterOfMass / mechanismDOF / outerWire / pmiDatums / pmiItems / pmiOn / pmiTechNotes / pmiThreads / projectPointOnEdge / projectPointOnFace / projectSheet / projectView / reverseSurfaceU / subShapeCount / uvFromPoint / vertexPosition / viewCamera / volume
布尔: commonCells
导出: export3mf / exportBrep / exportStep / exportStl
视图: toMultiviewPNG / toMultiviewSVG / toPNG / toSVG
废弃（勿用，`fai_` 前缀 / ../3d_editor 特有，将迁出）: translate、rotate_euler、scale、scale3d、group、assembly、copy、fai_drill、fai_drill_tapper、fai_extrude、fai_split、load
```

---

## 15. 面 role 词汇表（拓扑身份，自动派生自 op 的 naming 声明）

BREP 链上每个面的身份 = `(StmtId, role)`。下表列出每个 op 对**自己新造的面**声明的 role 词汇（`RoleName` 线格式）；继承来的面沿用其产生 op 的 role。`vocab` 中的 `<i>` / `<j>` / `[k]` 为序号占位。**改一个 op 的词汇 = breaking change**（会破坏存量 `.fai.js` 引用），需版本化。

| op | 类别 | 新造面词汇 | 说明 |
|---|---|---|---|
| `alignTo` | 内核历史 | `gen:alignTo:<i>` |  |
| `applyMatrix` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `approximatePoints` | 未建模 | —（不造新面） | 1D approximated curve has no face role vocabulary |
| `autoHeal` | 内核历史 | `gen:autoHeal:<i>` |  |
| `boolean` | 未建模 | —（不造新面） | booleanOp returns flat face-hash lists, not an input-face to result-face map |
| `boss` | 内核历史 | `gen:boss:<i>` |  |
| `box` | 构造语义 | `top`、`bottom`、`front`、`back`、`left`、`right` |  |
| `chamfer` | 内核历史 | `gen:chamfer:<i>` |  |
| `circleArc` | 未建模 | —（不造新面） | 1D arc has no face role vocabulary |
| `circularPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `clone` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `commonCells` | 未建模 | —（不造新面） | intersectionCells returns a bare shape with no face evolution data |
| `complexExtrude` | 内核历史 | `gen:complexExtrude:<i>` |  |
| `cone` | 构造语义 | `top`、`bottom`、`lateral` |  |
| `convexHull` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `copy` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `curveDegreeElevate` | 未建模 | —（不造新面） | 1D refined curve has no face role vocabulary |
| `curveKnotInsert` | 未建模 | —（不造新面） | 1D refined curve has no face role vocabulary |
| `curveKnotRemove` | 未建模 | —（不造新面） | 1D refined curve has no face role vocabulary |
| `cut` | 内核历史 | `gen:cut:<i>` |  |
| `cylinder` | 构造语义 | `top`、`bottom`、`lateral` |  |
| `defeature` | 内核历史 | `gen:defeature:<i>` |  |
| `draft` | 内核历史 | `gen:draft:<i>` |  |
| `draftPrism` | 未建模 | —（不造新面） | tapered prism face vocabulary not defined |
| `drill` | 内核历史 | `gen:drill:<i>` |  |
| `dxfExtrude` | 构造语义 | —（不造新面） |  |
| `edge` | 未建模 | —（不造新面） | 1D edge has no face role vocabulary |
| `ellipseArc` | 未建模 | —（不造新面） | 1D ellipse arc has no face role vocabulary |
| `ellipseEdge` | 未建模 | —（不造新面） | 1D ellipse has no face role vocabulary |
| `ellipsoid` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `extrude` | 构造语义 | `top`、`bottom`、`wall:0` |  |
| `faceFromWire` | 未建模 | —（不造新面） | no source-derived face role vocabulary |
| `faceOnSurface` | 未建模 | —（不造新面） | face built on a host surface has no source-derived face role vocabulary |
| `fai_drill` | 内核历史 | `gen:fai_drill:<i>` |  |
| `fai_drill_tapper` | 内核历史 | `gen:fai_drill_tapper:<i>` |  |
| `fai_extrude` | 构造语义 | `top`、`bottom` |  |
| `fai_split` | 分片 | —（不造新面） | 每输入面 → 若干片：splinter(<原 role>)#j 由框架生成 |
| `fillet` | 内核历史 | `gen:fillet:<i>` |  |
| `filletVariable` | 内核历史 | `gen:filletVariable:<i>` |  |
| `fixSelfIntersection` | 内核历史 | `gen:fixSelfIntersection:<i>` |  |
| `fixShape` | 内核历史 | `gen:fixShape:<i>` |  |
| `fuse` | 内核历史 | `gen:fuse:<i>` |  |
| `gridPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `halfSpace` | 未建模 | —（不造新面） | unbounded half-space has no source-derived face role vocabulary |
| `heal` | 内核历史 | `gen:heal:<i>` |  |
| `healSolid` | 内核历史 | `gen:healSolid:<i>` |  |
| `helix` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `import_brep` | 构造语义 | `imported:0` |  |
| `import_step` | 构造语义 | `imported:0` |  |
| `interpolateWithTangents` | 未建模 | —（不造新面） | 1D interpolated curve has no face role vocabulary |
| `intersect` | 内核历史 | `gen:intersect:<i>` |  |
| `knurl` | 未建模 | —（不造新面） | knurl is mesh-only, no BREP face identity |
| `liftCurve2d` | 未建模 | —（不造新面） | 1D wire lifted from 2D points has no face role vocabulary |
| `linearPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `locate` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `loft` | 未建模 | —（不造新面） | lofted-body face vocabulary not defined |
| `loftAdvanced` | 未建模 | —（不造新面） | lofted-body face vocabulary not defined |
| `makeBaseBox` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `makeSolid` | 未建模 | —（不造新面） | solid promoted from an arbitrary shell has no face role vocabulary |
| `mirror` | 内核历史 | `gen:mirror:<i>` |  |
| `mirrorJoin` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..1） |
| `nonPlanarFace` | 未建模 | —（不造新面） | face from arbitrary non-planar wire has no face role vocabulary |
| `offset` | 内核历史 | `gen:offset:<i>` |  |
| `offset2d` | 未建模 | —（不造新面） | 1D offset contour has no face role vocabulary |
| `outerWire` | 未建模 | —（不造新面） | extracted sub-wire has no face role vocabulary |
| `pipe` | 未建模 | —（不造新面） | pipe face vocabulary not defined |
| `place` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `pocket` | 内核历史 | `gen:pocket:<i>` |  |
| `profile` | 构造语义 | —（不造新面） |  |
| `punchHole` | 构造语义 | —（不造新面） |  |
| `rectangularPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `removeHolesFromFace` | 内核历史 | `gen:removeHolesFromFace:<i>` |  |
| `reverseShape` | 内核历史 | `gen:reverseShape:<i>` |  |
| `reverseSurfaceU` | 未建模 | —（不造新面） | U-reversed face proxy keeps input topology; no new face role vocabulary |
| `revolve` | 构造语义 | `top`、`bottom`、`wall:0` |  |
| `roof` | 内核历史 | `gen:roof:<i>` |  |
| `rotate` | 内核历史 | `gen:rotate:<i>` |  |
| `rotate_euler` | 内核历史 | `gen:rotate_euler:<i>` |  |
| `scale` | 内核历史 | `gen:scale:<i>` |  |
| `scale3d` | 内核历史 | `gen:scale3d:<i>` |  |
| `screw` | 构造语义 | —（不造新面） |  |
| `sdf` | 未建模 | —（不造新面） | sdf is mesh-only, no BREP face identity |
| `sectionByPlane` | 未建模 | —（不造新面） | 1D section curves have no face role vocabulary |
| `sew` | 内核历史 | `gen:sew:<i>` |  |
| `sewAndSolidify` | 内核历史 | `gen:sewAndSolidify:<i>` |  |
| `shell` | 内核历史 | `gen:shell:<i>` |  |
| `simplify` | 内核历史 | `gen:simplify:<i>` |  |
| `sketch` | 构造语义 | —（不造新面） |  |
| `sketchOnFace` | 构造语义 | —（不造新面） |  |
| `sketchOnPlane` | 构造语义 | —（不造新面） |  |
| `sketchOnSurface` | 构造语义 | —（不造新面） |  |
| `solidFromFaces` | 内核历史 | `gen:solidFromFaces:<i>` |  |
| `sphere` | 未建模 | —（不造新面） | sphere face vocabulary pending Phase 3 |
| `split` | 分片 | —（不造新面） | 每输入面 → 若干片：splinter(<原 role>)#j 由框架生成 |
| `splitByPlane` | 分片 | —（不造新面） | 每输入面 → 若干片：splinter(<原 role>)#j 由框架生成 |
| `subtract` | 内核历史 | `gen:subtract:<i>` |  |
| `surface` | 未建模 | —（不造新面） | bspline-surface face vocabulary not defined |
| `svgExtrude` | 构造语义 | —（不造新面） |  |
| `sweep` | 未建模 | —（不造新面） | swept-body face vocabulary not defined |
| `sweepAdvanced` | 未建模 | —（不造新面） | swept-body face vocabulary not defined |
| `tangentArc` | 未建模 | —（不造新面） | 1D arc has no face role vocabulary |
| `text` | 构造语义 | —（不造新面） |  |
| `thicken` | 未建模 | —（不造新面） | thickened-body face vocabulary not defined |
| `thread` | 内核历史 | `gen:thread:<i>` |  |
| `torus` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `translate` | 内核历史 | `gen:translate:<i>` |  |
| `twistExtrude` | 内核历史 | `gen:twistExtrude:<i>` |  |
| `unifySameDomain` | 内核历史 | `gen:unifySameDomain:<i>` |  |
| `union` | 内核历史 | `gen:union:<i>` |  |
| `wedge` | 未建模 | —（不造新面） | wedge face vocabulary pending Phase 3 |
| `wire` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `wireFromEdges` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |

> 本表由 `DUAL_OP_META.naming` 声明自动生成（与 `.d.ts` 的 `CAD_ROLE_VOCAB` 同源）。漏声明的 op 会在生成期/编译期失败（G4）。
