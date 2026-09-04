# faijs Language API Reference (AI / User Coding Manual)

English | [中文](ops-api-inventory.zh.md)

> 本手册由 `scripts/gen-ops-api-inventory.ts` 从 stdlib JSDoc 自动生成。**不要手改**——改 stdlib JSDoc 后运行生成器（或 CI 的 `--check` 会拦截不一致）。
>
> - ✅ = 此接口正确、可放心使用
> - ⚠️ = 可用，但参数有已知缺陷
> - ❌ = 接口错误，**禁止使用**，等重做
>
> 相关文档：`docs/syntax-design.md`（语法与执行契约）、`docs/api-contract.md`（语句层内部契约）。

---

## 1. 三个 API 面

faijs 的 API 分三个面，消费者和形态各不同：

| 面 | 消费者 | 形态 | 位置 |
|---|---|---|---|
| ① TS 兼容面 | 第三方库（TS 代码，如 gear-lib-demo / sheetmetal） | brepjs 原样：位置参数 + `Result` 原生；同名同签名；`Sketcher` / `Blueprint` / `draw` DSL；`ok` / `err` / `isErr` / `pipe` 组合子 | `@faicad/faijs` 主导出（`packages/core/src/api/compat/`） |
| ② cad 脚本面 | `.fai.js`（UI / AI 生成代码） | `cad.*` 对象参数；语句边界 `Result` unwrap（err → 语句失败）；产物 = faijs `Shape`（mesh 载荷 + BREP 槽） | `cad` 命名空间（经门面 `createRuntime` 注入） |
| ③ 库边界面 | `registerLib` 注册的第三方库导出函数 | 库作者写纯 brepjs 代码；入口 `Shape` → 借入，出口 `Solid` → 收养，`Result` 原样传递 | `runtime.registerLib(binding, ns, { compat: true })` |

**参数双形态（D11）**：① TS 面与 ② 脚本面是同一批函数，位置 / 对象两种形态都可用。明显可区分的参数用单名（如 `box`），人类看来不明显的用两个名字（如 `rotate_euler`）。

> 下方 § 3–§ 7 的逐 op 手册仅覆盖 ② 脚本面（`cad.*` 函数）。① TS 兼容面的符号清单见 `packages/core/src/api/compat/index.ts`；③ 库边界面的使用方法见 `docs/library-dev-guide.md`。

---

## 2. 错误体系

faijs 对外 API 全面采用 `Result` / `BrepError` 体系（`ok` / `err` / `isOk` / `isErr` / `map` / `andThen` / `unwrap`）。在 ② 脚本面，语句边界自动 unwrap：`err` 转为带语句上下文的执行失败（`ExecutionResult.failedAt`），存量 `.fai.js` 脚本零修改。在 ① TS 兼容面，`Result` 原生传递，库作者用 `isErr` / `map` / `andThen` 组合。

| 面 | Result 处置 | 消费者写法 |
|---|---|---|
| ① TS 兼容面 | 原样返回 `Result<T>` | `const r = fuse(a, b); if (isErr(r)) …` |
| ② cad 脚本面 | 语句边界 unwrap | `let p = cad.union(a, b)` — err → 语句失败 |
| ③ 库边界面 | 库内原样；边界 unwrap | 库内 `err` → 边界 unwrap → 脚本层语句失败 |

> 相关契约：`docs/api-contract.md` § 7.6（三个库契约面）和 § 8（几何契约）定义了 `compatOp` / `defineOp` 的分派规则。

---

## 3. 创建类操作（无上游输入）

### 3.1 `box` ✅

创建长方体（或立方体）。size 给定三条边：传 number 为等边立方体，传 [x,y,z] 为长方体。

```js
const part0 = cad.box({ size: 20 })
const part0 = cad.box({ size: [30, 20, 10], center: [0, 0, 5] })
D11 双形态：位置形态 `box(10, 20, 30)`（三边）/`box(20)`（立方体）与对象形态
`box({ size: [10, 20, 30] })` 归一到同一实现（§4.2）。
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `size` | `number | [x,y,z]` | ✅ | — | 尺寸（[x,y,z] 三边或 number 等边） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 中心位置 |

**同步**。Shape 长方体几何，可作为后续 op 的输入。

### 3.2 `cone` ✅

创建圆锥体。radiusTop 等于 radiusBottom 时即圆柱。

```js
const c = cad.cone({ radiusBottom: 10, radiusTop: 4, height: 30 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radiusBottom` | `number` | ✅ | — | 底半径（mm） |
| `radiusTop` | `number` | ✅ | — | 顶半径（mm），可传 0 得尖锥，传等于 radiusBottom 得圆柱 |
| `height` | `number` | ✅ | — | 高度（mm），沿 Z 轴 |
| `segments` | `number` |  | 32 | 细分度（影响面数） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 中心位置 |

**同步**。Shape 圆锥体几何，可作为后续 op 的输入。

### 3.3 `cylinder` ✅

创建圆柱体。

```js
const c = cad.cylinder({ radius: 5, height: 40 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | `number` | ✅ | — | 底面半径（mm） |
| `height` | `number` | ✅ | — | 高度（mm），沿 Z 轴 |
| `segments` | `number` |  | 32 | 细分度（影响面数） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 中心位置 |

**同步**。Shape 圆柱体几何，可作为后续 op 的输入。

### 3.4 `load` ✅

加载几何资产。key / path / url 三选一（按此优先级分流），内容经宿主资产解析器解析，**引用而非拷贝**。

```js
const p = await cad.load({ key: 'file_abc123' })
const p = await cad.load({ path: 'D:/models/box.step', format: 'step' })
const p = await cad.load({ url: 'https://…/box.3mf' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `key` | `string` |  | — | faicad 缓存中的资产 key（内容按 key 取） |
| `path` | `string` |  | — | 本地绝对路径（非 web 环境） |
| `url` | `string` |  | — | 网络地址 |
| `format` | `string` |  | — | 格式提示（如 'step'/'stl'；CAD 源走 BREP 精确路径，STL 等三角化源走 mesh 路径） |

**异步**。Shape 加载的几何，永远是 part 的第一条语句，后面可接特征链。

> 语言正常化后 loadFile/loadUrl/loadByKey 别名已删除（A4），统一为 `load` 一个函数。
>
> key/path/url 是优先级分流（key 优先，其次 path，最后 url），三者只需其一；同时给多个时按优先级取。`format` 是提示而非强约束——CAD 源（step/stp/brep 等）与三角化源（stl 等）由 `isCadFormat` 静态判定路径。

### 3.5 `screw` ✅

生成螺丝零件（螺纹 + 头型）。

```js
const s = await cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex' })
const s = await cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex', nRad: 64 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `system` | `'metric' | 'imperial'` | ✅ | — | 制式 |
| `specIdx` | `number` | ✅ | — | 规格索引（决定公称直径，如 5 → M5、6 → M6） |
| `thread` | `'coarse' | 'fine' | 'custom' | 'none'` |  | 'coarse' | 螺纹类型 |
| `length` | `number` | ✅ | — | 螺杆长度（mm） |
| `head` | `'hex' | 'chc' | 'none'` |  | 'none' | 头型（hex 六角 / chc 沉头 / none 无头） |
| `pitchCustom` | `number` |  | — | 自定螺距（thread='custom' 时用） |
| `nRad` | `number` |  | 32 | 径向分段数（拓扑参数） |

**异步**。Shape 螺丝几何，生成独立零件。

> nRad 是拓扑参数不是渲染参数：mesh 路径直接决定分段数；BREP 路径用精确曲面，nRad 仅作 BREP→mesh 三角化角度提示（angular deflection ≈ 2π/nRad）。.fai.js 默认 32 不输出，非默认才输出以保证可复现。
>
> pitchCustom 执行层已支持（makeScrew/threadBrep 均读取），codegen 曾不序列化（TODO）；当前已机械输出。

### 3.6 `sdf` ⚠️

用 SDF（符号距离场）函数生成网格体（mesh-only）。

```js
const s = await cad.sdf({ code: 'return sphere(10) - sphere(5, [10,0,0])', box: [[-20,-20,-20],[30,20,20]], resolution: 1 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `code` | `string` | ✅ | — | SDF 函数源码（`sdf(x,y,z)` 定义或标题模板调用，如 'return sphere(10) - sphere(5, [10,0,0])'） |
| `box` | `[[minX,minY,minZ],[maxX,maxY,maxZ]]` |  | [[-10,-10,-10],[10,10,10]] | 采样包围盒 |
| `resolution` | `number` |  | 1.0 | 网格单元边长（越小越精细） |
| `params` | `object` |  | — | 参数数值表（SDF 里引用的变量值） |

**异步**。Shape SDF 生成的网格体，生成独立零件。

> SDF 无 BREP 实现（mesh-only）；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError。SDF 天生是网格操作，允许网格参数（resolution）。

### 3.7 `sphere` ✅

创建球体。

```js
const r = cad.sphere({ radius: 10 })
const r = cad.sphere({ radius: 10, segments: 64, center: [0,0,10] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | `number` | ✅ | — | 半径（mm） |
| `segments` | `number` |  | 32 | 细分度（影响面数） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 球心位置 |

**同步**。Shape 球体几何，可作为后续 op 的输入。

### 3.8 `svgExtrude` ⚠️

从二维 SVG 轮廓挤出零件（拓扑操作）。

```js
const s = await cad.svgExtrude({ svg: 'logo.svg', depth: 5, targetLongSide: 20 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `svg` | `string` | ✅ | — | SVG 内容：资产 key（推荐）或整份 SVG 文本（兼容） |
| `depth` | `number` | ✅ | — | 挤出深度（mm） |
| `targetLongSide` | `number` |  | 20 | 长边目标尺寸（mm） |

**异步**。Shape SVG 挤出几何，生成独立零件。

> SVG 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份 XML 内联拷贝。自然尺寸（viewBox）与缩放已显式成参数（mesh/BREP 两条路径都解析 viewBox 并传递 naturalWidth/naturalHeight），尺寸语义不再依赖两套实现各自推导。

### 3.9 `text` ⚠️

生成文字零件（文字轮廓挤出，X/Z 居中、Y 底部对齐原点）。

```js
const t = await cad.text({ text: 'Hello', size: 20, depth: 5 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `text` | `string` | ✅ | — | 要生成的文字 |
| `size` | `number` | ✅ | — | 字号（mm） |
| `depth` | `number` | ✅ | — | 挤出深度（mm） |
| `font` | `string` |  | 默认字体 | 字体 |

**异步**。Shape 文字几何，生成独立零件。

> font 语义未定（当前只有默认字体），⚠️ 暂不要传。兼容 `cad.text(part0, {...})` 带输入形态（输入被忽略），正常写 `cad.text({...})` 即可。

### 3.10 `wedge` ✅

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

---

## 4. 变换类操作（inputs ≥ 1）

### 4.1 `rotate_euler` ✅

绕轴旋转几何体。anglesDeg 为欧拉角（度，XYZ 顺序）。

```js
const p2 = cad.rotate_euler(part0, { anglesDeg: [0, 0, 45] })
const p3 = cad.rotate_euler(part0, { anglesDeg: [0, 0, 45], pivot: [0,0,0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `anglesDeg` | `[x,y,z]` | ✅ | — | 欧拉角（度，XYZ 顺序） |
| `pivot` | `[x,y,z]` |  | 原点 | 旋转中心 |

**同步**。Shape 旋转后的几何。

### 4.2 `scale` ✅

缩放几何体。factor 传 number 为等比缩放，传 [x,y,z] 为非等比。

```js
const p4 = cad.scale(part0, { factor: 2 })
const p5 = cad.scale(part0, { factor: [2, 1, 1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `factor` | `number | [x,y,z]` | ✅ | — | 缩放系数：number（等比）或 [x,y,z]（非等比，> 0） |

**同步**。Shape 缩放后的几何。

### 4.3 `translate` ✅

平移几何体。

```js
const p1 = cad.translate(part0, { offset: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `offset` | `[x,y,z]` | ✅ | — | 平移向量（mm） |

**同步**。Shape 平移后的几何，装配的相对位置靠成员的变换语句表达。

---

## 5. 特征类操作（inputs ≥ 1）

### 5.1 `chamfer` ✅

在几何体上倒角（等距 / 双距 / 距角）。仅 BREP 可用。

```js
const p = await cad.chamfer(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], type:'equal', width:1 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edges` | `EdgeTopoRef[]` | ✅ | — | 参与倒角的边（EdgeTopoRef[]，条目为相邻两面的 role 线路） |
| `type` | `string` | ✅ | — | 倒角类型（equal | twoDistances | distanceAngle） |
| `width` | `number` |  | 1 | type=equal: 倒角宽度（mm） |
| `width1` | `number` |  | — | type=twoDistances: 沿 faces[0] 侧距离（mm） |
| `width2` | `number` |  | — | type=twoDistances: 沿 faces[1] 侧距离（mm） |
| `angle` | `number` |  | — | type=distanceAngle: 与参考面夹角（度，(0,90)） |

**异步**。Shape 倒角后的几何。

> 倒角是 BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。参考面由内核自选，`width1` 沿 faces[0] 侧、`width2` 沿 faces[1] 侧。

### 5.2 `copy` ✅

深拷贝几何为独立新对象（源不变，源与副本都显示）。

```js
const part1 = cad.copy(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|

**同步**。Shape 源几何的深拷贝。copy 不消费其源（画布显示 box 和副本两份），改副本不影响源。

### 5.3 `drill` ✅

在几何体上钻孔（CSG 减除）。depth=0 为通孔，>0 为盲孔。

```js
const p = await cad.fai_drill(part0, { diameter: 5 })
const p = await cad.fai_drill(part0, { diameter: 5, depth: 3 })
const p = await cad.fai_drill(part0, { diameter: 5.2, depth: 8, holeType: 'screw', screwSystem: 'metric', screwSpecIdx: 4, screwThread: 'coarse', screwHead: 'none' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `diameter` | `number` | ✅ | — | 孔径（mm） |
| `depth` | `number` |  | 0 | 孔深（mm）；0 = 通孔，> 0 = 盲孔 |
| `holeType` | `'simple' | 'screw'` |  | 'simple' | 孔类型：simple 简单孔 / screw 螺丝孔 |
| `direction` | `'normal' | 'x' | 'y' | 'z'` |  | 'normal' | 钻孔轴向（normal 表示沿面法向） |
| `position` | `[x,y,z]` |  | 原点 | 孔心位置 |
| `face` | `FaceTopoRef` |  | — | 面引用（§6.2 新形态：`FaceTopoRef`，执行期按输入 Shape 解析派生法向；优先于 `faceNormal`） |
| `faceNormal` | `[x,y,z]` |  | [0,0,1] | 面法向（决定朝向；历史兜底，§6.2 起宿主不再写，改由 `face` 解析） |
| `tolerance` | `number` |  | 0.3 | 公差（mm） |
| `screwSystem` | `'metric' | 'imperial'` |  | 'metric' | 螺丝孔制式（holeType='screw' 时用） |
| `screwSpecIdx` | `number` |  | 4 | 螺丝规格索引（holeType='screw' 时用；4 → M5） |
| `screwThread` | `'coarse' | 'fine' | 'custom'` |  | 'coarse' | 螺丝螺纹类型 |
| `screwHead` | `'hex' | 'chc' | 'none'` |  | 'none' | 螺丝头型 |

**异步**。Shape 钻孔后的几何。

> 键名以本表为准：`type: 'through'|'blind'` 与 `direction` 为向量的旧素材是无效写法——孔型由 `depth`（0=通孔）推导，`direction` 是 'normal'|'x'|'y'|'z' 枚举。

### 5.4 `engrave` ✅

在几何表面雕刻文字或 SVG（文字分支与 logo 分支都可用）。

```js
const p = await cad.engrave(part0, { mode: 'concave', depth: 2, text: 'Hello', textSize: 10, faceCenter: [0, 0, 0], faceNormal: [0, 0, -1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `mode` | `'concave' | 'convex'` |  | 'concave' | 雕刻方式：concave 凹陷（减法）/ convex 凸出（加法） |
| `depth` | `number` |  | 0 | 深度 / 凸出高度（mm） |
| `text` | `string` |  | — | 文字内容（与 svg 二选一） |
| `textSize` | `number` |  | 10 | 字号（mm） |
| `svg` | `string` |  | — | SVG 资产引用（与 text 二选一；经 cad.asset 解析） |
| `svgSize` | `number` |  | — | SVG 长边目标尺寸 |
| `faceCenter` | `[x,y,z]` |  | [0,0,0] | 面位置（绝对坐标） |
| `faceNormal` | `[x,y,z]` |  | [0,0,1] | 面法向 |

**异步**。Shape 雕刻后的几何。

> 早期 logo 分支用 `svgText`（整份 XML 拷贝 + `svgSize` 文本导出丢失，往返失真）；现已改为 `svg` 资产引用，`engravingType` 冗余键已移除。faceCenter/faceNormal 目前是绝对坐标快照。

### 5.5 `fai_extrude` ✅

沿法向拉伸几何。

```js
const p = await cad.fai_extrude(part0, { length: 10 })
const p = await cad.fai_extrude(part0, { length: 10, mode: 'forward' })
const p = await cad.fai_extrude(part0, { length: 10, normal: [0,0,1], originOffset: 2 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `length` | `number` | ✅ | — | 总拉伸量（mm） |
| `mode` | `'centered' | 'forward' | 'backward'` |  | 'centered' | 拉伸方向：centered 双向各一半 / forward 正向 / backward 反向 |
| `normal` | `[x,y,z]` |  | 当前面法向 [0,0,1] | 拉伸方向法向 |
| `originOffset` | `number` |  | 0 | 切面在法向上的偏移 |
| `space` | `'local' | 'world'` |  | — | 坐标空间声明 |

**异步**。Shape 拉伸后的几何。

### 5.6 `fai_split` ⚠️

分割几何，返回具名对象 { front, back } 两个独立零件。

```js
const { front: part1, back: part2 } = await cad.fai_split(part0, { normal: [0, 0, 1], offset: 5, cutMode: 'dovetail', grooveDepth: 3, grooveWidth: 5 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `cutMode` | `'plane' | 'dovetail' | 'dowel' | 'tenon' | 'straight-tenon' | 'straight'` |  | 'plane' | 切割模式 |
| `normal` | `[x,y,z]` |  | [0,0,1] | 切割面法向 |
| `offset` | `number` |  | 0 | 切割面沿法向偏移（过 bbCenter） |
| `inPlaneAngleDeg` | `number` |  | 0 | 切割面面内旋转角（度） |
| `bbCenter` | `[x,y,z]` |  | 自动 | 包围盒中心（缺省自动推导） |
| `bboxSize` | `[x,y,z]` |  | 自动 | 包围盒尺寸（缺省自动推导） |
| `applyExplode` | `boolean` |  | true | 是否将两侧沿法向分离位移（bbox 对角线 2% + 榫卯深度一半） |
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

**异步**。{ front: Shape; back: Shape } 必须用解构 `const { front: partA, back: partB } = await cad.fai_split(...)` 取出两个零件。

> 切割面统一用 `normal`/`offset`/`inPlaneAngleDeg` 描述；早期文本层曾与执行层键名断裂（planeRotation/planePosition），已修并统一为上述键名。

### 5.7 `intersect` ✅

布尔交集：所有输入的重叠部分。

```js
const c = await cad.intersect(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用） |

**异步**。Shape 所有输入的交集。

### 5.8 `knurl` ⚠️

施加滚花（顶点位移，非布尔）。mesh-only。

```js
const p = await cad.knurl(part0, { knurlTextureHeight: 0.5, knurlScaleU: 0.15, knurlScaleV: 0.15, knurlInvertDisplacement: false, knurlRefineLength: 1.0, knurlMappingMode: 5 })
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

### 5.9 `subtract` ✅

布尔差集：第一个为主体，减去其余输入。

```js
const b = await cad.subtract(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用，第一个为主体） |

**异步**。Shape part0 减 part1 的差集（第一个为主体）。

### 5.10 `union` ✅

布尔并集：合并所有输入几何（≥2 个输入）。

```js
const a = await cad.union(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用，≥2 个） |

**异步**。Shape 所有输入的并集。函数名即操作，输入全是变量引用，可用 `cad.union(a, b, c)` 多输入。

---

## 6. 结构类操作（结构语句，无几何输出）

### 6.1 `assembly` ⚠️

装配：成员 + 面约束（face_mate）。结构语句，无几何输出，成员用变量名引用、约束用拓扑面引用。

```js
cad.assembly({ name: '装配1', members: [part0, part1], constraints: [{ type: 'face_mate', fixedPartName: part0, movingPartName: part1, fixedFace: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } } }, movingFace: { topoRef: { kind: 'face', origin: 'part1', role: 'cylinder:bottom', hint: { kind: 'face', surfaceType: 'circle' } } } }] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | `string` |  | — | 装配名 |
| `members` | `Shape[]` |  | — | 成员（裸变量引用） |
| `constraints` | `AssemblyConstraint[]` |  | — | 面约束数组（type='face_mate'；fixedPartName/movingPartName + fixedFace/movingFace：`{topoRef: FaceTopoRef}` 或 `{surfaceType, center, normal}`） |

**同步**。CompoundShape + AssemblyBehavior（含 do_assemble 方法）。

> 早期文档/示例曾用 `fixedPartId`/`movingPartId`/`faceRowIndex`/`faceId`/`invalid`——这些键在代码中不存在。真实契约是 `fixedPartName`/`movingPartName` + `fixedFace`/`movingFace`。支持两种形态：`{ topoRef: FaceTopoRef }`（§6.2 新形态，几何由 faijs 执行期从面行派生）或旧快照 `{ surfaceType, center, normal }`（兼容历史脚本）。`faceId` 字段随 §6.2 移除，不再写入。

### 6.2 `group` ✅

分组：零约束，保持当前布局。结构语句，无几何输出，成员用变量名引用。

```js
const part0 = cad.box({ size: [30, 20, 10] })
cad.group({ name: '底板组', members: [part0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | `string` |  | — | 组名 |
| `members` | `Shape[]` |  | — | 成员（编译产物 ctx.<var> 引用；结构语句里是裸变量引用，非字符串数组） |

**同步**。CompoundShape 复合几何（kind='compound'，children 为成员 Shape 引用）。

> members 在 .fai.js 里是裸变量引用（编译为 ctx.<var>），字符串数组形态的成员名经 keep() 反查兼容历史 IR。

---

## 7. 查询类操作（几何 / 资产引用查询）

### 7.1 `asset` ✅

查询资产 key 内容为 UTF-8 字符串（SVG 等文本资产）。嵌套调用，供 text/svg 类 op 作资产引用。

```js
const svg = await cad.asset('logo_cfg')
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `key` | `string` | ✅ | — | 资产 key |

**异步**。Promise<string> 资产内容字符串（UTF-8 解码）。`cad.asset('cfg')` 返回 SVG 等文本资产，可作 svgExtrude/engrave 的 svg 参数。

### 7.2 `bboxCenter` ✅

查询几何包围盒中心。

```js
const c = cad.bboxCenter(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何 |

**同步**。Vec3 包围盒中心 [x,y,z]。交互式可编辑（参数量引用）。

### 7.3 `bboxMax` ✅

查询几何包围盒最大角点。

```js
const mx = cad.bboxMax(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何 |

**同步**。Vec3 包围盒最大角点 [x,y,z]。

### 7.4 `bboxMin` ✅

查询几何包围盒最小角点。

```js
const mn = cad.bboxMin(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何 |

**同步**。Vec3 包围盒最小角点 [x,y,z]。

### 7.5 `faceNormal` ✅

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

---

## 8. 接口品质状态（自动派生自 @qual）

| op | 品质 | 说明 |
|---|---|---|
| `assembly` | ⚠️ | 早期文档/示例曾用 `fixedPartId`/`movingPartId`/`faceRowIndex`/`faceId`/`invalid`——这些键在代码中不存在。真实契约是 `fixedPartName`/`movingPartName` + `fixedFace`/`movingFace`。支持两种形态：`{ topoRef: FaceTopoRef }`（§6.2 新形态，几何由 faijs 执行期从面行派生）或旧快照 `{ surfaceType, center, normal }`（兼容历史脚本）。`faceId` 字段随 §6.2 移除，不再写入。 |
| `fai_split` | ⚠️ | 切割面统一用 `normal`/`offset`/`inPlaneAngleDeg` 描述；早期文本层曾与执行层键名断裂（planeRotation/planePosition），已修并统一为上述键名。 |
| `knurl` | ⚠️ | knurl 无 BREP 实现（mesh-only），本质是顶点位移（网格操作），网格参数可接受；brep 模式下调用前抛 BrepUnsupportedError。面锚定建议用几何引用。 |
| `sdf` | ⚠️ | SDF 无 BREP 实现（mesh-only）；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError。SDF 天生是网格操作，允许网格参数（resolution）。 |
| `svgExtrude` | ⚠️ | SVG 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份 XML 内联拷贝。自然尺寸（viewBox）与缩放已显式成参数（mesh/BREP 两条路径都解析 viewBox 并传递 naturalWidth/naturalHeight），尺寸语义不再依赖两套实现各自推导。 |
| `text` | ⚠️ | font 语义未定（当前只有默认字体），⚠️ 暂不要传。兼容 `cad.text(part0, {...})` 带输入形态（输入被忽略），正常写 `cad.text({...})` 即可。 |


---

## 9. 写给 AI 的速查（一句话总结每个可用 op）

```
创建: load / box / sphere / cylinder / cone / wedge / screw / sdf / svgExtrude / text
变换: translate / rotate_euler / scale
特征: union / subtract / intersect / chamfer / copy / engrave / drill / fai_extrude / fai_split / knurl
结构: group / assembly
查询: asset / faceNormal / bboxCenter / bboxMin / bboxMax
```
