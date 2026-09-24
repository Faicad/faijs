# faijs Language API Reference (AI / User Coding Manual)

[English](ops-api-inventory.md) | 中文

> 本手册由 `scripts/gen-ops-api-inventory.ts` 从 stdlib JSDoc 自动生成。**不要手改**——改 stdlib JSDoc 后运行生成器（或 CI 的 `--check` 会拦截不一致）。
>
> - ✅ = 此接口正确、可放心使用
> - ⚠️ = 可用，但参数有已知缺陷
> - ❌ = 接口错误，**禁止使用**，等重做
> - 🚫 = **已废弃（deprecated）**，勿在新代码中使用
>
> 🚫 标记的 op 是 `../3d_editor` 项目特有的操作，不属于 faijs 平台面；将来会迁往该项目并从 faijs 删除。
>
> 相关文档：`docs/syntax-design.md`（语法与执行契约）、`docs/api-contract.md`（语句层内部契约）。

---

## 1. 三个 API 面

faijs 的 API 分三个面，消费者和形态各不同：

| 面 | 消费者 | 形态 | 位置 |
|---|---|---|---|
| ① TS 兼容面 | 第三方库（TS 代码，如 fai_cq_gears / sheetmetal） | brepjs 原样：位置参数 + `Result` 原生；同名同签名；`Sketcher` / `Blueprint` / `draw` DSL；`ok` / `err` / `isErr` / `pipe` 组合子 | `@faicad/faijs` 主导出（`packages/core/src/api/compat/`） |
| ② cad 脚本面 | `.fai.js`（UI / AI 生成代码） | `cad.*` 对象参数；语句边界 `Result` unwrap（err → 语句失败）；产物 = faijs `Shape`（mesh 载荷 + BREP 槽） | `cad` 命名空间（经门面 `createRuntime` 注入） |
| ③ 库边界面 | `registerLib` 注册的第三方库导出函数 | 库作者写纯 brepjs 代码；入口 `Shape` → 借入，出口 `Solid` → 收养，`Result` 原样传递 | `runtime.registerLib(binding, ns, { autoLift: true })` |

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

> 相关契约：`docs/api-contract.md` § 7（三个库契约面、库接纳）和 § 8（几何契约）定义了 op 与库函数的分派规则。

---

## 3. 创建类操作（无上游输入）

### 3.1 `box` ✅

创建长方体（brepjs 契约，§4.1 A 决策）。

```js
const part0 = cad.box(10, 20, 30)
const part1 = cad.box(30, 20, 10, { centered: true, at: [1, 2, 3], segments: 64 })
位置原生（§4.1/§6.2）：`box(width, depth, height)` 与 `box(10, 20, 30, {centered:true})`
归一到同一对象（D11 位置→对象 + 尾参 options 合并）。旧 `{ size }` 对象形态已废弃（裁决 3），
传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.1）。
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `width` | `number` | ✅ | — | X 方向边长（mm） |
| `depth` | `number` | ✅ | — | Y 方向边长（mm） |
| `height` | `number` | ✅ | — | Z 方向边长（mm） |
| `at` | `[x,y,z] 可选` |  | — | 中心点（CENTER 语义，优先于 centered） |
| `centered` | `boolean` |  | false，角点在原点） | 无 at 时是否居中到原点（ |
| `segments` | `number` |  | 64（= brepjs standard 等效，P0 §5.0/§5.1） | 细分度（影响三角化） |

**同步**。Shape 长方体几何，可作为后续 op 的输入。

### 3.2 `cone` ✅

创建圆锥体（brepjs 契约，§4.1 P 决策）。radiusTop 等于 radiusBottom 时即圆柱，0 为尖锥。 锚点：`at` 是**底面轴心**（BASE 语义，默认 [0,0,0]，底面在原点、+Z 延伸）；`centered:true` 指底面落到 −h/2（无 at 时居中到原点；与 `at` 同给时以 `at` 为中心）。

```js
const c = cad.cone(10, 4, 30)
const c = cad.cone(10, 0, 30, { centered: true, at: [0, 0, 20], segments: 64 })
位置原生（§4.1/§6.2）：`cone(10, 4, 30)` 与 `cone(10, 4, 30, { centered: true })`
归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }`/`{ size }` 对象形态
已废弃（裁决 3），传入会抛 E_ARGS_FORM（错误提示 ≠ 兼容）。
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radiusBottom` | `number` | ✅ | — | 底半径（mm） |
| `radiusTop` | `number` | ✅ | — | 顶半径（mm），0 为尖锥，非负，等于 radiusBottom 得圆柱 |
| `height` | `number` | ✅ | — | 高度（mm），沿 +Z 轴 |
| `at` | `[x,y,z] 可选` |  | — | 底面轴心（BASE 语义） |
| `centered` | `boolean` |  | false | 是否居中（底面 −h/2；与 at 同给时以 at 为中心） |
| `segments` | `number` |  | 64（= brepjs standard 等效，P0 §5.0/§5.1） | 细分度（影响三角化） |

**同步**。Shape 圆锥体几何，可作为后续 op 的输入。

### 3.3 `cylinder` ✅

创建圆柱体（brepjs 契约，§4.3 A 决策）。 锚点：`at` 是**底面轴心**（BASE 语义，默认 [0,0,0]，底面在原点、+Z 延伸）；`centered:true` 指底面落到 −h/2（无 at 时居中到原点；与 `at` 同给时以 `at` 为中心）。

```js
const c = cad.cylinder(5, 40)
const c = cad.cylinder(5, 40, { centered: true, at: [0, 0, 20], segments: 64 })
位置原生（§4.1/§6.2）：`cylinder(5, 40)` 与 `cylinder(5, 40, {centered:true})`
归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }` 对象形态已废弃
（裁决 3），传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.3）。
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | `number` | ✅ | — | 底面半径（mm） |
| `height` | `number` | ✅ | — | 高度（mm），沿 +Z 轴 |
| `at` | `[x,y,z] 可选` |  | — | 底面中心（BASE 语义） |
| `centered` | `boolean` |  | false | 是否居中（底面 −h/2；与 at 同给时以 at 为中心） |
| `segments` | `number` |  | 64（= brepjs standard 等效，P0 §5.0/§5.1） | 细分度（影响三角化） |

**同步**。Shape 圆柱体几何，可作为后续 op 的输入。

### 3.4 `import_brep` ✅

平台 BREP 资产导入：把容器 `assets/` 里的冻结 BREP 载体装成持 OCCT 句柄的 Shape。 `asset` = 资产名（去扩展名，沿用 `FsAssetResolver` 的 `key = basename(file)` 规则）， 由宿主资产解析器按 key 解析（与 `cad.load` 同套解析器）。

```js
const a = await cad.import_brep({ asset: 'Array001.Shape' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `asset` | `string` | ✅ | — | 容器资产名（去扩展名） |

**异步**。Promise<Shape> 持 OCCT 句柄的几何（非实体亦可）。

> 非实体一等（C6）：wire/face/shell 一律可导入，本 op 不设 `allowNonSolid` 一类开关。需要实体的 op（布尔、up-to 目标面）在**使用点**报错，而不是在导入点拒绝。
>
> 这是**平台**资产导入 op。编辑器 `cad.load` 是 `../3d_editor` 的「文件导入 Feature」（key/path/url 三键分流 + 画布语句位置语义），平台侧不要复用它（C7）。

### 3.5 `import_step` ✅

stdlib import_step — 任意路径 STEP 文件导入 op（方案 Phase 5 / Q2 真缺口） 与 `import_brep`（容器资产）和 `cad.load`（编辑器 FileRef）的职责切分： - `cad.import_step` 是 faijs **平台**几何 op：单一本地路径（宿主 `resolveFile`）， OCCT STEPControl_Reader 读入，返回持 OCCT 句柄 + roleTable 的 Shape。 - `import_brep` 读的是容器 `assets/` 里的冻结 BREP 资产（key，去扩展名）； `cad.load` 是 `../3d_editor` 的「文件导入 Feature」（key/path/url 三键分流、 画布语句位置语义），平台侧不要复用它（C7）。 非实体（wire/face/shell）一等公民（C6，对齐 import_brep）：始终 allowNonSolid。 STEP 是 BREP 专属格式：mesh / 无内核模式抛 E_BREP_UNSUPPORTED。

```js
const a = await cad.import_step({ path: 'D:/models/box.step' })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `path` | `string` | ✅ | — | 本地绝对路径（宿主 resolveFile 解析） |

**异步**。Promise<Shape> 持 OCCT 句柄的几何（非实体亦可）。

> 平台 STEP 导入 op。读文件经宿主资产解析器（`assets.resolveFile`），与 `cad.load` 同一通道；语义为「任意路径 STEP → OCCT 读入的 Shape」。
>
> 非实体一等（C6）：wire/face/shell 一律可导入。需要实体的 op（布尔、up-to 目标面）在**使用点**报错。

### 3.6 `screw` ✅

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

### 3.7 `sdf` ⚠️

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

### 3.8 `sketch` ✅

从 2D 轮廓构造平面（creator，无输入）。仅 BREP 可用。

```js
const f = cad.sketch({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `contours` | `SketchLoop[]` | ✅ | — | 有序 2D 轮廓（线段/圆弧；外环 + 孔） |

**同步**。Shape 平面几何（mesh 三角化 + BREP 句柄）。

### 3.9 `sphere` ✅

创建球体。

```js
const r = cad.sphere({ radius: 10 })
const r = cad.sphere(10, { at: [0, 0, 10], segments: 64 })
const r = cad.sphere({ radius: 10, segments: 64, center: [0,0,10] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | `number` | ✅ | — | 半径（mm） |
| `segments` | `number` |  | 64（= brepjs standard 等效，P0 §5.0/§5.1） | 细分度（影响面数） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 球心位置（at 的同义别名） |
| `at` | `` |  | — | 球心位置（center 的同义别名，brepjs 契约；裁决 4 双形态合法） |

**同步**。Shape 球体几何，可作为后续 op 的输入。

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

### 4.1 `place` ✅

刚性放置几何体：旋转（四元数，绕局部原点）后平移。两者皆可缺省 = 恒等。

```js
const p = cad.place(part0, { rotation: [0, 0, Math.sin(Math.PI/4), Math.cos(Math.PI/4)], position: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `rotation` | `[number,number,number,number]` |  | — | 旋转四元数 [x,y,z,w]（Hamilton，绕局部原点） |
| `position` | `[number,number,number]` |  | — | 平移向量 [x,y,z]（mm） |

**同步**。Shape 放置后的几何（持 OCCT 句柄，可继续变换/导出）。

### 4.2 `rotate_euler` ✅ 🚫

绕轴旋转几何体。anglesDeg 为欧拉角（度，XYZ 顺序）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**（见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §2）。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p2 = cad.rotate_euler(part0, { anglesDeg: [0, 0, 45] })
const p3 = cad.rotate_euler(part0, { anglesDeg: [0, 0, 45], pivot: [0,0,0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `anglesDeg` | `[x,y,z]` | ✅ | — | 欧拉角（度，XYZ 顺序） |
| `pivot` | `[x,y,z]` |  | 原点 | 旋转中心 |

**同步**。Shape 旋转后的几何。

### 4.3 `scale` ✅ 🚫

等比缩放几何体（brepjs 契约，§4.6 裁决 2）。factor 只收 number；不动点默认 原点（与 vendored `scale(shape, factor, { center? })` 一致），`center` 可选。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**（见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §2）。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p4 = cad.scale(part0, 2)
const p5 = cad.scale(part0, { factor: 2, center: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `factor` | `number` | ✅ | — | 等比缩放系数（> 0） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 缩放不动点（p 保持不动） |

**同步**。Shape 缩放后的几何。

### 4.4 `scale3d` ✅ 🚫

非等比缩放几何体（faijs 语义，§1.4.4 裁决 2）。factor 定死 vec3 — 等比缩放请用 `scale(p, s)`，`scale3d(p, [x,y,z])` 才可非等比。`center` 为不动点（默认原点）。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**（见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §2）。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

```js
const p4 = cad.scale3d(part0, { factor: [2, 1, 1] })
const p5 = cad.scale3d(part0, [2, 1, 1], { center: [10, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `factor` | `[x,y,z]` | ✅ | — | 三轴缩放系数（均 > 0） |
| `center` | `[x,y,z]` |  | [0,0,0]（原点） | 缩放不动点 |

**同步**。Shape 缩放后的几何。

### 4.5 `translate` ✅ 🚫

平移几何体。

> 🚫 **已废弃（deprecated）**：**`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：该 op 为编辑器应用提供（承载拖拽与时间线语句），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**（见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §2）。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。

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

### 5.2 `circularPattern` ✅

环形阵列：绕 axis 均分 fullAngle（度，缺省 360）复制 count 份（含原位置）。

```js
const p = await cad.circularPattern(part0, [0, 0, 1], 6)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `axis` | `[x,y,z]` | ✅ | — | 旋转轴方向 |
| `count` | `number` | ✅ | — | 副本总数（含原位置） |
| `fullAngle` | `number` |  | — | 总角度（度，缺省 360） |
| `center` | `[x,y,z]` |  | — | 旋转轴上一点（缺省原点） |

**异步**。Shape 所有副本 fused 后的几何。

> BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[k]/<inner>`。

### 5.3 `clone` ✅

深拷贝句柄：返回独立副本（源保留）。

```js
const p = await cad.clone(part0)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|

**异步**。Shape 克隆的新几何。

> BREP-only。keep 语义：不消费输入（薄 override 委托生成 op，行为不变）。

### 5.4 `cut` ✅

Boolean cut (subtract): remove `tool` from `base`. Same semantics as {@link subtract} but with the brepjs-compatible `(base, tool, options?)` signature. Overrides the generated projection (compatOp) to do roleTable propagation (Phase 3: L2 requires wall:<i> to survive cut).

```js
const b = await cad.cut(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `base` | `Shape` | ✅ | — | the target shape. |
| `tool` | `Shape` | ✅ | — | the shape to subtract. |

**异步**。Shape base minus tool.

### 5.5 `engrave` ✅

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

### 5.6 `extrude` ✅

沿 normal 拉伸几何（面 → 棱柱）。 up-to 模式（`upTo`）与长度模式（`length`）二选一；长度模式委托生成投影 （vendored extrude 为唯一引擎），up-to 模式走半空间组合。

```js
const p = await cad.extrude(part0, [0, 0, 10])
const p = await cad.extrude(part0, { length: 10 })
const p = await cad.extrude(sk, { upTo: cad.faceRef(part0, 3) })
const p = await cad.extrude(sk, { upTo: 'last', baseFeature: part0 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `length` | `number` |  | — | 总拉伸量（mm，>0）。up-to 模式下无需给 |
| `normal` | `[x,y,z]` |  | [0,0,1] | 拉伸方向（世界坐标） |
| `mode` | `'forward' | 'backward'` |  | 'forward' | 沿 normal 的前进方向：forward 正向 / backward 反向 |
| `upTo` | `'last' | 'first' | FaceTopoRef` |  | — | 拉伸到面：FaceTopoRef 指定面 / 'last' 支持体远端面 / 'first' 近端面（需 baseFeature）。提供时忽略 length |
| `baseFeature` | `Shape` |  | — | upTo 'last'/'first' 的支持体几何（累积支持体） |
| `offset` | `number` |  | 0 | 截断面沿其法向的偏移（mm） |

**异步**。Shape 拉伸后的几何。

### 5.7 `fillet` ✅

在几何体上做圆角（等半径）。仅 BREP 可用。

```js
const p = await cad.fillet(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], radius:2 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edges` | `EdgeTopoRef[]` | ✅ | — | 参与圆角的边（EdgeTopoRef[]，条目为相邻两面的 role 线路） |
| `radius` | `number` | ✅ | — | 圆角半径（mm，>0） |

**异步**。Shape 圆角后的几何。

> 圆角是 BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。`radius` 为正数（mm）。 圆角后 roleTable 经 filletWithHistory 传播，保证后续特征仍可按 role 选面/选边。

### 5.8 `gridPattern` ✅

二维栅格阵列：沿 directionX × directionY 复制 countX×countY 份（含原位置）。

```js
const p = await cad.gridPattern(part0, [1, 0, 0], [0, 1, 0], 3, 2, 20, 20)
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

### 5.9 `intersect` ✅

布尔交集：所有输入的重叠部分。

```js
const c = await cad.intersect(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用） |

**异步**。Shape 所有输入的交集。

### 5.10 `knurl` ⚠️

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

### 5.11 `linearPattern` ✅

线性阵列：沿 direction 复制 count 份（含原位置）。

```js
const p = await cad.linearPattern(part0, [1, 0, 0], 3, 20)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `direction` | `[x,y,z]` | ✅ | — | 阵列方向 |
| `count` | `number` | ✅ | — | 副本总数（含原位置） |
| `spacing` | `number` | ✅ | — | 副本间距 |

**异步**。Shape 所有副本 fused 后的几何。

> BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。结果面按份数 k 回投影到输入面 角色，产出 `replica[k]/<inner>`（Phase 3 L3 抗重放词汇）。

### 5.12 `mirror` ✅

镜像：返回镜像后的新 Shape（源保留）。

```js
const p = await cad.mirror(part0, { normal: [1, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `options` | `MirrorOptions` |  | — | { normal?, at? } 镜像面 |

**异步**。Shape 镜像后的新几何。

> BREP-only。keep 语义：不消费输入（薄 override 委托生成 op，行为不变）。

### 5.13 `mirrorJoin` ✅

镜像并融合：原物（replica[0]）+ 沿平面镜像（replica[1]）fuse 成一体。

```js
const p = await cad.mirrorJoin(part0, { normal: [1, 0, 0] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `options` | `MirrorJoinOptions` |  | — | { normal?, at? } 镜像面法向与面上一点 |

**异步**。Shape fuse 后的几何。

> BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[0|1]/<inner>`。

### 5.14 `rectangularPattern` ✅

矩形阵列：按 options（xDir/xCount/xSpacing/yDir/yCount/ySpacing）复制并 fuse。

```js
const p = await cad.rectangularPattern(part0, { xDir: [1,0,0], xCount: 3, xSpacing: 20, yDir: [0,1,0], yCount: 2, ySpacing: 15 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `options` | `RectangularPatternOptions` | ✅ | — | 阵列参数 |

**异步**。Shape 所有副本 fused 后的几何。

> BREP-only。keep 语义：不消费输入。结果面回投输入面角色，产出 `replica[ix_iy]/<inner>`。

### 5.15 `revolve` ✅

旋转成形：把平面轮廓绕轴旋转（兼容生成投影签名）。

```js
const p1 = await cad.revolve(part0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307179586 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `face` | `Shape` | ✅ | — | 平面轮廓 |
| `options` | `RevolveOptions` |  | — | 旋转轴/点/角度（透传 vendored 语义） |

**异步**。Shape 旋转体（带链根 roleTable：bottom/top/wall:i）。

### 5.16 `split` ✅

用工具几何切分目标几何（BRepAlgoAPI_Splitter），返回所有碎片组成的几何。

```js
const pieces = await cad.split(part0, [part1])
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tools` | `Shape[]` | ✅ | — | 切刀几何（数组） |

**异步**。Shape 切分后的几何（compound of pieces）。

> BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。切分产生的截面 / 被切细的侧面 片记 `splinter(#j)`（Phase 3 L4 抗重放词汇）。平台 op：仅 occt 引擎（原生 split）。

### 5.17 `subtract` ✅

布尔差集：第一个为主体，减去其余输入。

```js
const b = await cad.subtract(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用，第一个为主体） |

**异步**。Shape part0 减 part1 的差集（第一个为主体）。

### 5.18 `union` ✅

布尔并集：合并所有输入几何（≥2 个输入）。

```js
const a = await cad.union(part0, part1)
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shapes` | `Shape[]` | ✅ | — | 参与运算的几何（变量引用，≥2 个） |

**异步**。Shape 所有输入的并集。函数名即操作，输入全是变量引用，可用 `cad.union(a, b, c)` 多输入。

---

## 6. 结构类操作（结构 / 聚合）

### 6.1 `compound` ✅

`cad.compound({ members, name? })` → 几何复合体 Shape（持 OCCT 句柄）。

```js
const c = cad.compound({ members: [part0, part1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `members` | `Shape[]` |  | — | 成员数组（Shape 或结构 compound；编译产物 ctx.<var> 引用） |
| `name` | `string` |  | — | 可选名称 |

**同步**。Shape 几何复合体（brep 路径持句柄，可变换/可导出）。

> 成员经 `params.members` 传入，不是位置参数。与编辑器 `cad.group` 的区别：本 op 产出**几何**复合体（持 OCCT 句柄，可放置/导出），`group` 是结构壳（无句柄）。平台侧不要用 `group`。

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

### 7.5 `edgeRef` ✅

查询几何体第 N 条边的 `EdgeTopoRef`，供 `cad.fillet` / `cad.chamfer` 的 `edges` 使用： `cad.fillet(base, { edges: [cad.edgeRef(base, 17)], radius: 2 })`。 定不了案（无 BREP / 序号越界 / 邻面不足两面 / 邻面无 role 血统）抛 `TopoRefError`。

```js
const part1 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 1)], radius: 2 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何（BREP 实体所在的 Shape） |
| `edgeOrdinal` | `number` | ✅ | — | 边序号（1 起；等于 FreeCAD 的 `EdgeN`） |

**同步**。EdgeTopoRef 该边的拓扑引用（相邻两面 role 对 + length/midpoint hint）。

> 序号 1 起，与命名层 `TopoRef.ordinal` 及 FreeCAD `EdgeN` 同序（`getSubShapes(solid,'edge')` 用 TopExp::MapShapes + IndexedMap 枚举）。

### 7.6 `faceNormal` ✅

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

### 7.7 `faceRef` ✅

查询几何体第 N 张面的 `FaceTopoRef`，供 `cad.extrude` 的 `upTo` 等参数使用： `cad.extrude(part0, { upTo: cad.faceRef(part0, 3) })`。 定不了案（无 BREP / 序号越界 / 面无 role 血统）抛 `TopoRefError`。

```js
const part1 = cad.extrude(sk, { upTo: cad.faceRef(part0, 3) })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `of` | `Shape` | ✅ | — | 目标几何（BREP 实体所在的 Shape） |
| `faceOrdinal` | `number` | ✅ | — | 面序号（1 起；等于 FreeCAD 的 `FaceN`） |

**同步**。FaceTopoRef 该面的拓扑引用（origin/role 血统 + 几何 hint）。

> 序号 1 起，与命名层 `TopoRef.ordinal` 及 FreeCAD `FaceN` 同序（`getSubShapes(solid,'face')` 用 TopExp::MapShapes + IndexedMap 枚举）。

### 7.8 `projectSheet` ✅

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
| `gap` | `number` |  | 30 | 格间距（px） |
| `labels` | `boolean` |  | true | 是否渲染 <text> 标签 |
| `cellWidth` | `number` |  | 400 | 每格画布宽度 |
| `cellHeight` | `number` |  | 300 | 每格画布高度 |

**同步**。SVG 字符串（嵌套 <svg x y width height viewBox preserveAspectRatio> + <text> 标签）。空列表返回空 SVG 不抛错。

### 7.9 `projectView` ✅

单视图投影 → SVG 线稿字符串（纯数据，不消费/修改 shape；规则 1 下裸调用不消费输入）。

```js
const svg = cad.projectView(part0, 'front')
const svg = cad.projectView(part0, 'iso', { strokeWidth: 1, dash: '4,4', hiddenOpacity: 0.6 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `shape` | `Shape` | ✅ | — | 目标几何（必须有 BREP 槽；mesh-only 抛 E_BREP_ONLY_INPUT） |
| `view` | `string|{dir,xAxis?}` | ✅ | — | 视图规格（同 viewCamera：标准视图名 / iso / 轴对平面 / 方向对象） |
| `strokeWidth` | `number` |  | 1 | 可见线宽（stroke-width） |
| `dash` | `string` |  | '4,4' | 隐藏线虚线样式（stroke-dasharray） |
| `hiddenOpacity` | `number` |  | 0.6 | 隐藏线透明度 |
| `margin` | `number` |  | 10 | viewBox 外扩边距 |
| `width` | `number` |  | — | 输出宽度（缺省 = viewBox 宽度） |
| `height` | `number` |  | — | 输出高度（缺省 = viewBox 高度） |

**同步**。SVG 字符串（<svg viewBox="…"> + 可见实线 <path> + 隐藏虚线 <path>）。裸调用 cad.projectView(part0, 'front') 不消费 part0（规则 1），part 仍留在 canvas。

### 7.10 `viewCamera` ✅

解析视图规格为投影相机（纯数据，无 Shape 输入；不消费任何几何）。

```js
const cam = cad.viewCamera('iso')
const cam = cad.viewCamera({ dir: [1, -1, 1] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `view` | `string|{dir,xAxis?}` | ✅ | — | 视图规格：标准视图名（front/back/top/bottom/left/right/iso（=isometric）/XY/XZ/YZ/YX/ZX/ZY）或方向对象 |

**同步**。{ direction, xAxis? } 归一化方向向量（iso = (1,-1,1)/√3，与 FreeCAD/OCCT 惯例一致）。未知视图名抛错；零方向向量抛错。用于 3d_editor 侧三轴相机渲染（mesh/SDF 形状的截图通道）。

---

## 8. BREP 能力声明（compat op → 内核方法真名）

来自 `packages/core/src/api/surface/capability-map.json`（Phase 0 生成，36 compat op、64 个唯一内核方法）；能力名三层结构、静态前置判定与报错形态见 `docs/api-contract.md` §7.9 / §8.1；引擎侧可执行性由各适配器的 `capabilities.methods` / `evolution` 声明决定（缺能力执行前静态报错，不伪造）。

| compat op | 内核方法真名（kernelMethods） |
|---|---|
| torus | dispose、makeTorus |
| fuse | dispose、fuse、fuseWithHistory、isNull |
| extrude | dispose、downcast、extrude、isNull |
| revolve | dispose、isNull、revolveVec、shapeType |
| sweep | dispose、shapeType、simplePipe、sweepPipeShell |
| complexExtrude | buildExtrusionLaw、dispose、shapeType、simplePipe、sweepPipeShell |
| twistExtrude | buildExtrusionLaw、dispose、shapeType、simplePipe、sweepPipeShell |
| linearPattern | dispose、fuseAll、hashCode、isNull、iterShapes、linearPattern、section、surfaceCenterOfMass、surfaceNormal、surfaceType、uvBounds |
| circularPattern | circularPattern、dispose、fuseAll、hashCode、isNull、iterShapes、section、surfaceCenterOfMass、surfaceNormal、surfaceType、uvBounds |
| gridPattern | dispose、fuseAll、gridPattern、hashCode、isNull、iterShapes、linearPattern、section、surfaceCenterOfMass、surfaceNormal、surfaceType、uvBounds |
| roof | buildTriFace、dispose、fixShape、isValid、sew、sewAndSolidify |
| drill | boundingBox、cut、cutWithHistory、dispose、isNull、makeCylinder |
| pocket | addHolesInFace、cut、cutWithHistory、dispose、downcast、extrude、isNull、makeFace、surfaceCenterOfMass、surfaceNormal、surfaceType、translateWithHistory、uvBounds |
| boss | addHolesInFace、dispose、downcast、extrude、fuse、fuseWithHistory、isNull、makeFace、surfaceCenterOfMass、surfaceNormal、surfaceType、translateWithHistory、uvBounds |
| mirrorJoin | dispose、fuse、fuseWithHistory、isNull、mirrorWithHistory |
| rectangularPattern | dispose、fuse、fuseAll、fuseWithHistory、hashCode、isNull、iterShapes、section、surfaceCenterOfMass、surfaceNormal、surfaceType、translateWithHistory、uvBounds |
| thread | dispose、loftAdvanced、makeLineEdge、makeVertex、makeWireFromMixed、shapeType |
| convexHull | dispose、hullFromPoints、shapeType |
| makeBaseBox | addHolesInFace、buildEdgeOnSurface、buildExtrusionLaw、copyShape、curveParameters、curvePointAtParam、curveTangent、dispose、downcast、extrude、isNull、loftAdvanced、makeFace、makeFaceOnSurface、makeVertex、makeWireFromMixed、mirror、revolveVec、shapeType、simplePipe、surfaceType、sweepPipeShell |
| ellipsoid | dispose、makeEllipsoid、translateWithHistory |
| rotate | dispose、rotateWithHistory |
| mirror | dispose、mirrorWithHistory |
| clone | copyShape、dispose |
| applyMatrix | dispose、generalTransformNonOrthogonal、generalTransformWithHistory、hashCode、iterShapes、surfaceCenterOfMass、surfaceNormal、surfaceType、uvBounds |
| locate | composeTransform、dispose、hashCode、locate |
| section | dispose、isNull、section |
| split | dispose、isNull、split |
| shell | dispose、shapeType、shell、shellWithHistory |
| offset | dispose、offsetWithHistory、shapeType |
| heal | dispose、healFace、healSolid、healWire、isValid、shapeType |
| simplify | dispose、simplify |
| autoHeal | dispose、fixSelfIntersection、healFace、healSolid、healWire、isValid、iterShapes、sew、shapeType |
| fixShape | fixShape |
| healSolid | dispose、healSolid、isValid、shapeType |
| fixSelfIntersection | dispose、fixSelfIntersection、shapeType |

---

## 9. 接口品质状态（自动派生自 @qual）

| op | 品质 | 说明 |
|---|---|---|
| `knurl` | ⚠️ | knurl 无 BREP 实现（mesh-only），本质是顶点位移（网格操作），网格参数可接受；brep 模式下调用前抛 BrepUnsupportedError。面锚定建议用几何引用。 |
| `sdf` | ⚠️ | SDF 无 BREP 实现（mesh-only）；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError。SDF 天生是网格操作，允许网格参数（resolution）。 |


---

## 10. 写给 AI 的速查（一句话总结每个可用 op）

```
创建: import_brep / import_step / box / sphere / cylinder / cone / wedge / screw / sdf / sketch
变换: place
特征: union / cut / subtract / intersect / chamfer / engrave / extrude / fillet / knurl / linearPattern / circularPattern / gridPattern / rectangularPattern / mirrorJoin / mirror / clone / revolve / split
结构: compound
查询: asset / edgeRef / faceRef / faceNormal / bboxCenter / bboxMin / bboxMax / viewCamera / projectView / projectSheet
废弃（勿用，`fai_` 前缀 / ../3d_editor 特有，将迁出）: translate、rotate_euler、scale、scale3d
```

---

## 11. 面 role 词汇表（拓扑身份，自动派生自 op 的 naming 声明）

BREP 链上每个面的身份 = `(StmtId, role)`。下表列出每个 op 对**自己新造的面**声明的 role 词汇（`RoleName` 线格式）；继承来的面沿用其产生 op 的 role。`vocab` 中的 `<i>` / `<j>` / `[k]` 为序号占位。**改一个 op 的词汇 = breaking change**（会破坏存量 `.fai.js` 引用），需版本化。

| op | 类别 | 新造面词汇 | 说明 |
|---|---|---|---|
| `applyMatrix` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `autoHeal` | 内核历史 | `gen:autoHeal:<i>` |  |
| `boss` | 内核历史 | `gen:boss:<i>` |  |
| `box` | 构造语义 | `top`、`bottom`、`front`、`back`、`left`、`right` |  |
| `chamfer` | 内核历史 | `gen:chamfer:<i>` |  |
| `circularPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `clone` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `cone` | 构造语义 | `top`、`bottom`、`lateral` |  |
| `convexHull` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `cut` | 内核历史 | `gen:cut:<i>` |  |
| `cylinder` | 构造语义 | `top`、`bottom`、`lateral` |  |
| `drill` | 内核历史 | `gen:drill:<i>` |  |
| `ellipsoid` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `engrave` | 内核历史 | `gen:engrave:<i>` |  |
| `extrude` | 构造语义 | `top`、`bottom`、`wall:0` |  |
| `fillet` | 内核历史 | `gen:fillet:<i>` |  |
| `fixShape` | 内核历史 | `gen:fixShape:<i>` |  |
| `fuse` | 内核历史 | `gen:fuse:<i>` |  |
| `gridPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `heal` | 内核历史 | `gen:heal:<i>` |  |
| `healSolid` | 内核历史 | `gen:healSolid:<i>` |  |
| `intersect` | 内核历史 | `gen:intersect:<i>` |  |
| `knurl` | 未建模 | —（不造新面） | knurl is mesh-only, no BREP face identity |
| `linearPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `locate` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `makeBaseBox` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `mirror` | 内核历史 | `gen:mirror:<i>` |  |
| `mirrorJoin` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..1） |
| `offset` | 内核历史 | `gen:offset:<i>` |  |
| `place` | 1:1 恒等 | —（不造新面） | 1:1，第 i 面 → 第 i 面（零声明） |
| `pocket` | 内核历史 | `gen:pocket:<i>` |  |
| `rectangularPattern` | 复制 k 份 | —（不造新面） | replica[k]/<原 role> 由框架生成（k=0..-1） |
| `revolve` | 构造语义 | `top`、`bottom`、`wall:0` |  |
| `rotate` | 内核历史 | `gen:rotate:<i>` |  |
| `rotate_euler` | 内核历史 | `gen:rotate_euler:<i>` |  |
| `scale` | 内核历史 | `gen:scale:<i>` |  |
| `scale3d` | 内核历史 | `gen:scale3d:<i>` |  |
| `screw` | 构造语义 | —（不造新面） |  |
| `sdf` | 未建模 | —（不造新面） | sdf is mesh-only, no BREP face identity |
| `simplify` | 内核历史 | `gen:simplify:<i>` |  |
| `sketch` | 构造语义 | —（不造新面） |  |
| `sphere` | 未建模 | —（不造新面） | sphere face vocabulary pending Phase 3 |
| `split` | 分片 | —（不造新面） | 每输入面 → 若干片：splinter(<原 role>)#j 由框架生成 |
| `subtract` | 内核历史 | `gen:subtract:<i>` |  |
| `torus` | 未建模 | —（不造新面） | construct vocabulary pending Phase 3 |
| `translate` | 内核历史 | `gen:translate:<i>` |  |
| `union` | 内核历史 | `gen:union:<i>` |  |
| `wedge` | 未建模 | —（不造新面） | wedge face vocabulary pending Phase 3 |

> 本表由 `DUAL_OP_META.naming` 声明自动生成（与 `.d.ts` 的 `CAD_ROLE_VOCAB` 同源）。漏声明的 op 会在生成期/编译期失败（G4）。
