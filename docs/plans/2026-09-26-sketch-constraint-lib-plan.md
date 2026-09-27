# 方案：faijs 草图约束库（能力层）与脚本面 `cad.sketch`

状态：已落地（2026-09-27 核对）——决策已全部拍板（§10），实施完成，见 Agent Note `.agents/notes/implemented/architecture/2026-09-26-sketch-constraint-lib-extraction.md`

## 0. 实施进度核对（2026-09-27）

| §9 步骤 | 状态 | 依据 |
|---|---|---|
| 1. 改名 `cad.sketch` → `cad.profile` | ✅ 完成 | `packages/core/src/api/profile.ts`（`@name profile`、`E_PROFILE_*`）；全仓 src 已无 `cad.sketch` 旧引用（仅本库新 op 自身使用该名） |
| 2. 新建 `packages/sketch` | ✅ 完成 | 包存在，含 solver / planegcs-backend / contour / canonical / project / faces / op 等模块 |
| 3. 规范模型 + 投影表 | ✅ 完成 | `src/canonical.ts`（Ref/At/约束集）、`src/project.ts`（双向投影） |
| 4. `solveSketch` | ✅ 完成 | `src/solve.ts`；欠/冗余/冲突/失败诊断齐全（Agent Note：DoF 探针 + planegcs 冗余/冲突标志） |
| 5. `sketchFaces` + `cad.sketch` op | ✅ 完成 | `src/faces.ts`、`src/op.ts`（`@name sketch`，brep-only，mesh 抛 `E_MESH_UNSUPPORTED`）、`src/namespace.ts`（mergeSketchNamespace / registerSketchSymbols） |
| 6. mesh 链路（永久 brep-only） | ✅ 完成 | 2026-09-27 拍板：草图相关 API **不做 mesh 侧**（业界无先例），mesh 模式显式 `E_MESH_UNSUPPORTED`；不列后续 |
| 7. fcstd 切换 | ✅ 完成 | `convert.ts` / `codegen.ts` / `sketch-parse.ts` 均改从 `@faicad/faijs-sketch` 导入；包内 solver/planegcs-backend/contour 实现已删除，公开面 re-export 保兼容 |
| 8. 测试 | ✅ 完成 | `src/solve-sketch.test.ts` 五类场景 e2e（6 用例全过）+ `src/install-smoke.test.ts` npm 安装冒烟（`test:install`）；GOTCHA 随包迁移 |
| 9. 收尾 | ✅ 基本完成 | workspaces 顺序（line 54）、`publish-all.ps1` `$Packages`（line 80）、`ci.ps1` 测试包列表 + test:install 门、四守卫全过；Agent Note 已落 |


## 1. 用户要求（原话）

### 1.1 需求原始记录（2026-09-25）

> 草图约束不是是一核心的功能，他应该也一样是做一个可选的纸包，然后其他人的脚本里如果引用的这个纸包这个库硬泡以后以后它可以就可以用这个纸包里的草图约束求解的功能那那么如何设计这个API就是在脚脚里如何定义草图约束，然后如何设计一份方案，而且这个包到时候可案可以提供给现在的FC IT D来使用，就增加一个阶层次

（语音识别原文。「纸包」= 库包，「FC IT D」= faijs-fcstd，「硬泡」= import。）

### 1.2 定位纠正（2026-09-26 用户原话）

> 对这些包的定位理解错误，我需要设计的是fai js自己的核心库的那个草图，相关的功能或者至少是写到一个独立的库，也是fai自己的库的草图，约束的功能，然后至于category和free CAD的草图，约束的功能，这是基于我们写的这个草图约束去做API兼容，你现在看到的那个带cq开头的那个库，它是早期的用于兼容get query的API的，并不是现在的要你设计的那个库

（「category」「get query」= CadQuery，「fai js」= faijs。）

### 1.3 决策拍板（2026-09-26 用户原话）

> 问题一当然应该通用呀，问题二报名当然就是这个，问题三我不太清楚你的意思，应该是要在CAD命名空间里添加这个，第四个应该允许欠约束和过约束，此外这个API的名字最好叫sketch，而现在的这个sketch应该换一个名字，因为sketch明显就是草图的意思，那直接画图似乎不太适合用这个API的名字啊

（「报名」= 包名。）

### 1.4 拍板结论

| 项                       | 结论                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| 规范模型                    | **通用**：不用 FreeCAD 的 `pos` 三值枚举，用 tag/索引 + 0..1 参数化位置，且圆心与中点语义可区分                                          |
| 包名                      | **`@faicad/faijs-sketch`**                                                                                |
| 脚本面入口                   | **进 `cad` 命名空间**，名为 **`cad.sketch`**                                                                      |
| 欠约束 / 过约束               | **允许**，不报错；诊断显式暴露                                                                                         |
| 现有 `cad.sketch`（精确轮廓构面） | **改名**，把 `sketch` 让给草图我记得昨天的文档里有这么一个说法，就是把那个草图约束，求解以后的东西传给现有的sketch的API，然后嘞就可以进行后续的操作，比如说拉伸成3d实体，这个说法正确吗？ |

## 2. 定位：能力层与兼容层

本方案设计的库是 **faijs 自己的草图与约束能力层**。CadQuery 侧与 FreeCAD 侧都是它的**下游消费者**，只做 API 兼容投影，不再各自持有求解器。

代码事实：`packages/cq-compat-sketch` 是 CadQuery API 兼容层（其包描述为 "CadQuery Sketch.py-compatible 2D sketch container"），`packages/fcstd`（`@faicad/faijs-fcstd`）是 FCStd 端口层，当前持有 planegcs 求解管线。两者都不是本方案的落点。

依赖方向（单向，无回边）：

```
.fai.js 脚本 ──┐
               ├──▶ @faicad/faijs-sketch（能力层：几何 + 约束 + 求解 + 构面）
faijs-fcstd ───┤              │
（FreeCAD 面）  │              ├──▶ @faicad/faijs（core：Shape / Result / 构面内核）
cq-compat-sketch┘             └──▶ @salusoft89/planegcs（WASM 求解内核）
（CadQuery 面）
```

能力层只定义**一套规范模型**；FreeCAD 的 `geoId` + `pos` 整数表示与 CadQuery 的 tag + 字符串约束名，都只是这套模型在两个方向上的投影。同一份实现多处投影，不写两份。

## 3. 包：`@faicad/faijs-sketch`

### 3.1 包定位

- 性质：faijs 自有的可选能力库，不进 core。
- 依赖：`peerDependencies: { "@faicad/faijs": "^0.17.0" }`；`dependencies: { "@salusoft89/planegcs": "1.2.0" }`（已是既有依赖）。
- 双端：planegcs 是 WASM。Node 侧沿用既有的 `planegcsWasmPath()`（`createRequire` 解析）；浏览器侧 wasm 字节经 `HostPorts.assets`（`AssetResolver`）注入，包内只依赖该接口，由宿主实现。
- 消费 core 的方式：**库函数层面直接调用，就是普通的静态 import**，没有别的通道。`@faicad/faijs-sketch` 是**独立发布的 npm 包**，发布后它对 `@faicad/faijs` 的可达面与其它任何消费者**完全相同**——不存在"自家库"特权，也不会因为是同一个 monorepo 就多看到什么。它要用到 core 的能力（构面内核、Shape、Result）时，按库的方式 `import` 即可——`import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'`。
  - **可用面 = core `package.json` 的 `exports` 子路径，且仅此。** core 显式开了 `./occt-kernel/*`、`./brep/*`、`./mesh/*`、`./cad-runtime/*`、`./topology/*`、`./primitives/*`、`./api/*`、`./boolean/*` 等通配子路径，`docs/api-contract.md` §1.1 写明这些细粒度子路径是 "for library authors to import on demand"。所以上面那行是**已声明的公开子路径**，不是钻内部；`cq-compat/src/sketch.ts`、`faijs-extra/src/ops/*` 都走这一路。反过来，**未声明的路径（`vendored/**` 一类）对包括本库在内的所有消费者一律禁入**——`2026-09-23` 方案的守卫矩阵把这条写成了断言：「扩展库零 core 深路径 → 只 import core 的 exports 子路径」。
  - **可达 ≠ 该用。** 通配子路径没有独立 semver 承诺（core 一个版本就能改），且受 `@faicad/*` lockstep 版本约束。取值顺序：① 优先 core 公开面已导出的函数；② 公开面没有 → 在 core 侧**提升为受支持的导出**（补 `exports` + 表面快照 + 文档）后再 import；③ 不走"找个恰好开着的通配路径钻进去"。本库需要的构面能力按这条办（见下一条）。
  - 注：「库里能不能调脚本面的 `cad.*`」这个问题不存在——`cad` 是 runtime 注册进**脚本作用域**的库绑定（VM 后端把脚本编译为 `new Function('__ctx', '__ns', '__isGeom', src)`，`cad` 经 `__ns` 传入脚本体），只对脚本可见。而作为库的提供者，本来也没有任何理由去调脚本面的 `cad`：需要什么能力就在库函数层面直接 import。两件事互不相干，不构成约束。
- **进入 `cad` 命名空间走「合并注册」，不是运行时访问**：`cad` 是宿主在**注册阶段**装配出来的对象——core 的 `createApiNamespace()` 只装平台面，扩展 op 由库提供后经合并函数并进去（`@faicad/faijs-extra` 即此模式：导出纯函数 `mergeEditorNamespace(platform)` 与便捷入口 `createEditorCadNamespace()`，宿主把合并结果交给 `registerLib('cad', …)`；另有 `registerEditorSymbols()` 把 op 名注册进 core 符号表供 `check()` / 静态分析识别）。本库照此办理：导出草图 op + 合并函数 + 符号注册，由宿主决定是否并入 `cad`。另有一条 `registerLib` 的 `autoLift` 通道可把库函数提升进 `cad`（`faijs.autoLift` 字段控制；`cq-compat*` 全部显式置 false 不用它）——本库不用 autoLift，走显式合并。
- **构面实现必须单点**：优先调 core 导出的构面函数（外环/孔判定、整圆拆分、makeWire/makeFace 那套）；core 若未导出该函数，则在 core 侧补充导出，**不在库里重写一遍**——否则 shoelace 判定、整圆拆分、孔处理会出现第二份实现，与「一份实现多处投影」相悖。`cad.profile` op 与本库共同消费这一个函数。

### 3.2 导出面

```
@faicad/faijs-sketch
  ├── solveSketch(geoms, cons, opts?)   → SolveOutcome（解后几何 + 诊断；fcstd / CQ 面消费）
  ├── sketchFaces(geoms, cons, opts?)   → Shape（求解 + 构面一步；脚本面消费）
  ├── 规范模型类型：SketchGeom / SketchConstraint / Ref / At / SolveOutcome
  └── 投影表：toFreeCad() / fromFreeCad() / toCadQuery() / fromCadQuery()
```

`sketchFaces` 是 `solveSketch` 的便捷包装：求解 → 解后几何转轮廓环 → core 构面（外环取面积最大环，其余为孔）。其中「解后几何 → 轮廓环」是一个独立且可能失败的环节，见 §3.3。

### 3.3 求解结果如何接到构面：环组装环节

求解器的产物是 `SolveOutcome.geoms`（与输入同序的**几何元素列表**），不是轮廓；`cad.profile` 要的是**有序闭合环**。中间必须做环组装，这一步不做则求解成功也拿不到面。

代码事实（`packages/fcstd/src/contour.ts` 的 `extractContours`）：

- 取每个元素的端点，按 `JOIN_TOL = 1e-7` 容差把首尾相接的段串成链，**只保留闭合环**，开放链丢弃。
- 串链用 DFS + 回溯：三叉端点（三条以上段汇于一点）会让朴素 first-come 串链走进死分支，导致真环永远合不上，死分支要把段还回池子。
- bspline 先采样成折线再参与串链；circle 自成闭环（落成 `0 → 2π` 的一段弧）；**ellipse 不参与串环**（`segEnds` 的 default 分支直接返回 `undefined`），所以 ellipse 首版不只是构面不支持，连轮廓都抽不出来。
- **求解成功但抽出零个环是真实失败模式**：悬空段导致零闭合环，fcstd 侧记为 `sketch-not-solved`，且不生成面变量。本库必须把这一态显式暴露，不能当作"求解成功"处理。

本库下沉该环节（`contour.ts` 是纯数据实现，无 OCCT 依赖，适合随求解一起下沉），fcstd 改为消费本库的轮廓输出。

对接 `cad.profile` 时的两个已知坑：

| 坑 | 说明 | 处置 |
|---|---|---|
| 整圆面积算成 0 | core 的 `loopSignedArea` 只用每段的起点 `(x1,y1)` 算 shoelace；整圆轮廓只有一段弧、起终点重合 → 面积 0。若草图是「整圆 + 方孔」，孔的面积反而更大，会被误判成外环 | 外环判定改为按段的扫角/面积积分，或对单段整圆特判，不再依赖段起点 shoelace |
| 坐标系与定位 | `cad.profile` 的输入即 `(x, y, 0)`，法向 +Z；草图在体局部系内的定位不由构面承担 | 定位由调用方在轮廓坐标里预变换，或交给下游特征的 Placement |

链路可达性：**brep 链路完整可达**（求解 → 轮廓 → `cad.profile` 构面 → `cad.extrude`，fcstd 已按此产出过真实面变量与 Pad）；**mesh 链路永久 brep-only，不补 mesh 侧**（§6.3，2026-09-27 拍板：业界无先例）。

## 4. 规范模型（通用）

### 4.1 设计原则

1. **引用用 tag 优先，索引兜底**：`tag` 是具名引用（CadQuery 形态），`index` 是数组下标（FreeCAD 形态）。二者可混用，单点解析。
2. **位置用参数化 `at`，不用 FreeCAD 的 `pos` 三值枚举**：理由见 §4.4。
3. **约束用字符串 kind**，枚举整数只在投影边界出现。
4. **初值即坐标**：几何声明里的坐标就是求解初值；约束把它拉精确。

### 4.2 几何与引用

```ts
/** 元素上的位置。number = 0..1 参数化位置（0 起点、1 终点、0.5 弧/线段中点）。 */
type At = number | 'start' | 'end' | 'mid' | 'center'

/** 元素引用：tag 与 index 二选一。at 省略 = 整个元素。 */
type Ref = { tag: string; at?: At } | { index: number; at?: At }

type SketchGeom =
  | { tag?: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { tag?: string; kind: 'circle'; cx: number; cy: number; r: number }
  | { tag?: string; kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; ccw?: boolean }
  | { tag?: string; kind: 'point'; x: number; y: number }        // 预留
  | { tag?: string; kind: 'ellipse'; ... }                        // 预留
  | { tag?: string; kind: 'bspline'; ... }                        // 预留
```

`'center'` 只对圆 / 弧 / 椭圆有意义（圆心），`'mid'` 是弧或线段的中点（等价于 `0.5`）。两者语义不同，规范模型必须能区分。

### 4.3 约束

```ts
type SketchConstraint =
  | { kind: 'fixed'; of: Ref }                                        // 锚定（CQ: FixedPoint）
  | { kind: 'coincident'; a: Ref; b: Ref }
  | { kind: 'horizontal'; of: Ref }
  | { kind: 'vertical'; of: Ref }
  | { kind: 'parallel'; a: Ref; b: Ref }
  | { kind: 'perpendicular'; a: Ref; b: Ref }
  | { kind: 'tangent'; a: Ref; b: Ref }
  | { kind: 'distance'; a: Ref; b: Ref; value: number }
  | { kind: 'distanceX'; a: Ref; b: Ref; value: number }
  | { kind: 'distanceY'; a: Ref; b: Ref; value: number }
  | { kind: 'length'; of: Ref; value: number }                        // 实体长度（CQ: Length）
  | { kind: 'angle'; a: Ref; b: Ref; value: number }                  // 度
  | { kind: 'orientation'; of: Ref; dir: [number, number] }           // 平行于给定向量（CQ: Orientation）
  | { kind: 'radius'; of: Ref; value: number }
  | { kind: 'diameter'; of: Ref; value: number }
  | { kind: 'arcAngle'; of: Ref; value: number }                      // 弧角跨度（CQ: ArcAngle）
  | { kind: 'equal'; a: Ref; b: Ref }
  | { kind: 'pointOnObject'; p: Ref; on: Ref }
  | { kind: 'symmetric'; p1: Ref; p2: Ref; about: Ref }
```

单位遵循项目契约（mm / 度）。

### 4.4 为什么不用 FreeCAD 的 `pos` 三值枚举

`packages/fcstd/src/sketch-parse.ts` 的 `PointPos` 只有 `none:0 / start:1 / end:2 / mid:3`，且注释写明 `mid: 3 // center of circle/ellipse` —— 它把「中点」直接等同于「圆心」。CadQuery 的 `0..1` 是元素上的参数化位置，能表达「线段 30% 处」这类任意内点。

若规范模型沿用 `pos`：① CQ 的 `0.5`（线段中点）映射到 `3`（圆心）会语义错位；② CQ 的 `0.3` 无法表达。故规范模型用 `At`，FreeCAD 的 `pos` 退化为它的特例（下表）。

### 4.5 投影映射

| 规范                                                                                                             | FreeCAD 面（fcstd）              | CadQuery 面（cq-compat-sketch）              |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| `at: 'start'`                                                                                                  | `PointPos.start` (1)          | `0.0`                                     |
| `at: 'end'`                                                                                                    | `PointPos.end` (2)            | `1.0`                                     |
| `at: 'mid'`（弧/线段中点）                                                                                            | 无对应 → 显式 `E_SKETCHC_UNMAPPED` | `0.5`                                     |
| `at: 'center'`（圆心）                                                                                             | `PointPos.mid` (3)            | arc center（参数传 `None`）                    |
| `at: 0.3`                                                                                                      | 无对应 → 显式 `E_SKETCHC_UNMAPPED` | `0.3`                                     |
| `fixed`                                                                                                        | 无（隐式固定框架 RtPnt + H/V 轴承担）     | `FixedPoint`                              |
| `length`                                                                                                       | 用同元素两点 `distance` 表达          | `Length`                                  |
| `orientation`                                                                                                  | 无                             | `Orientation`                             |
| `arcAngle`                                                                                                     | 无                             | `ArcAngle`                                |
| `distanceX` / `distanceY` / `equal` / `symmetric` / `pointOnObject` / `diameter` / `perpendicular` / `tangent` | 原生                            | CQ 无对应 → 显式 `E_SKETCHC_UNSUPPORTED_BY_CQ` |

反向同理：CQ 的 8 种约束（FixedPoint / Coincident / Angle / Length / Distance / Radius / Orientation / ArcAngle）全部可被规范模型表达；规范模型中 CQ 没有的项，在 CQ 面投影时显式报错，不做静默降级。

## 5. 欠约束与过约束：允许，但诊断必须显式

用户拍板：允许欠约束和过约束。据此定义三种状态与处置：

| 状态      | 判定          | 处置                                                                      | 产物                                 |
| ------- | ----------- | ----------------------------------------------------------------------- | ---------------------------------- |
| 欠约束     | 自由度 > 0     | 允许。以声明坐标为初值求最小位移解；整体刚体自由度由后端既有隐式固定框架（RtPnt + H/V 轴）吸收，或由用户显式 `fixed` 指定 | 正常输出几何，诊断携带剩余自由度                   |
| 过约束（冗余） | 存在可被剔除的冗余约束 | 允许。求解器剔除冗余并求解                                                           | 正常输出几何，诊断列出被剔除的约束                  |
| 过约束（冲突） | 约束互相矛盾      | 允许。求解器给出最小二乘意义下的 best-effort 解                                          | 输出几何，诊断携带 `problemConstraints` 与残差 |

**允许 ≠ 静默。** 诊断必须双路暴露：① `SolveOutcome` 结构返回给兼容层消费者；② 经 `HostPorts.events`（EventSink）发到宿主，供 UI / CLI 展示。

**D3 已拍板：冲突型过约束放行。** 理由：fcstd 读第三方 `.FCStd` 时冲突约束很常见，一旦收紧为 err，整份文件的转换会直接失败——那不是"明确报错"，是把上游数据问题放大成整文件不可用。

**仍然报错**的情形（不属于"允许"范畴，沿用"不静默回退"红线）：

- 引用了不存在的 `tag` / 越界 `index` → `E_SKETCHC_BAD_REF`
- 约束 kind 不在规范模型内 → `E_SKETCHC_UNSUPPORTED_CONSTRAINT`
- 几何 kind 首版未支持（ellipse / bspline / point）→ `E_SKETCHC_UNSUPPORTED_GEOM`（**D4 已拍板**：首版只支持 line + circle + arc，其余预留 schema）
- 求解器数值失败（非欠/过约束原因）→ `E_SKETCHC_SOLVE_FAILED`

## 6. 脚本面：`cad.sketch`（草图）

### 6.1 现有 `cad.sketch` 改名

现有 `cad.sketch({ contours })`（`packages/core/src/api/sketch.ts`，`@name sketch`）的语义是**用已定的精确 2D 轮廓构面**——输入即结果，不涉及求解。`sketch` 这个名字应当留给草图。

**新名定为 `cad.profile`**（profile = 由已定轮廓产出截面 face / wire）——已拍板（D1）。弃用备选：`cad.contour` 与 fcstd 内部 `Contour` / `ContourSeg` 同名易混；`cad.face2d` 太窄（该 op 还要出 wire 给扫掠族作 spine）。

改名后两侧语义：

| API                                      | 语义                                |
| ---------------------------------------- | --------------------------------- |
| `cad.profile({ contours, as })`          | 精确轮廓 → 面 / wire（现有能力，仅改名）         |
| `cad.sketch({ geoms, constraints, as })` | 草图（几何 + 约束）→ 求解 → 面 / wire（本方案新增） |

`cad.sketch` 内部求解完成后复用 `cad.profile` 的构面链路，构面实现单点。

### 6.1.1 为什么不把两者合并成一个 op

「求解结果喂给构面」只说明两者**数据流可串联**，不等于**该合并成一个 API**。让 `cad.sketch` 按入参有无 `constraints` 来决定求不求，是可实现的，但代价是：

| 维度 | 精确轮廓 | 草图约束 |
|---|---|---|
| 语义 | 输入即结果，无中间态 | 输入是欠定的，经求解才成形 |
| 失败模式 | 只有参数校验失败 | 另有欠约束、冗余、冲突、零闭合环四类 |
| 产物契约 | 纯 `Shape` | `Shape` + 诊断（自由度 / 被剔除约束 / 残差） |
| 静态判定 | 不涉及引擎路径选择 | 求解层是纯数值、构面层是引擎相关，两段能力不同源 |
| op 声明 | `capabilities` / `naming` / 平台身份各一份 | 与左列不同（草图还要声明 mesh 侧实现） |

按「BREP/mesh 路径由静态规则在执行前判定、禁止运行时回退」这条红线，用「有没有传 `constraints`」在运行时切换语义，本身就是一类隐式判定；分开成两个 op 才能各自静态声明。

若坚持共用一个名字，唯一体面的做法是加显式 `mode: 'profile' | 'constrained'` 参数。但那样参数校验、错误码、诊断、op 声明（`capabilities` / `naming` / 平台身份）仍是两套，只是塞进同一个壳里，复杂度没省。**改名是命名一致性与契约纯净性的取舍，不是技术必然**——见 §10。

### 6.2 `cad.sketch` 形态

**归属（已拍板，D2）**：`cad.sketch` 这个 op 由**本库提供**，经 §3.1 的合并注册进入 `cad` 命名空间，不在 core 内新增——草图约束是可选能力，宿主不合并则 `cad.sketch` 不存在。`cad.profile`（改名后的轮廓构面）留在 core 平台面。代价：3d_editor / 小程序宿主各需接一次合并，否则脚本里 `cad.sketch` 不存在。

`.fai.js` 是受限 JS 子集，脚本面一律函数式（state 作为参数传递，与 `cq-compat` 的 `rect(s, 2, 2)` 同形态），不做方法链。

```js
// .fai.js
import * as skc from 'faijs-sketch'   // binding 名由宿主 libLoader / registerLib 决定

let sk0 = cad.sketch({
  geoms: [
    { tag: 'bottom', kind: 'line', x1: 0,  y1: 0, x2: 80, y2: 3 },
    { tag: 'right',  kind: 'line', x1: 80, y1: 3, x2: 83, y2: 50 },
    { tag: 'top',    kind: 'line', x1: 83, y1: 50, x2: 0,  y2: 50 },
  ],
  constraints: [
    { kind: 'horizontal', of: { tag: 'bottom' } },
    { kind: 'vertical',   of: { tag: 'right' } },
    { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
    { kind: 'length', of: { tag: 'bottom' }, value: 80 },
  ],
})

let part0 = cad.extrude(sk0, [0, 0, 10])
```

参数：`geoms`（必填）、`constraints`（可空——纯声明式草图，等价于现有 `cad.profile` 的用法）、`as?: 'face' | 'wire'`、`plane?`（首版固定 z=0，预留草图平面）。

返回值：`Shape`（`as:'face'` 默认 / `as:'wire'` 交外环 wire 供扫掠族作 spine）。诊断不挂在 Shape 上——脚本面只取几何，诊断经 EventSink 暴露；需要结构化诊断的兼容层消费者调 `solveSketch`。

错误：脚本面语句边界自动 unwrap，err 落入 `failedAt`；欠/过约束不产生 err。

### 6.3 双链路

求解层本身是纯数值计算，不区分链路；构面层依赖 OCCT，与 `cad.profile` 同为 brep-only，mesh 侧显式抛 `E_MESH_UNSUPPORTED`。**草图相关 API 永久 brep-only，不做 mesh 侧**（2026-09-27 拍板）：业界无草图约束走 mesh 链路的先例——CadQuery `Sketch.solve()` 求解后用 OCCT `Edge.makeLine`/`makeThreePointArc` 重建精确边（纯 BREP），FreeCAD Sketcher 同样构建在 OCCT 之上；mesh 侧不是「待补」，是「不做」。

## 7. `cad.sketch` 改名影响面（实测）

改名是 breaking，**无别名过渡**（D6 已拍板：语义冲突正是改名的原因，留别名等于把两个语义继续绑在同一个名字上）。代价：3d_editor 与存量 `.fai.js` 必须同步改。迁移清单：

| 位置                                                                                                              | 内容                                                          | 处置                                                   |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `packages/core/src/api/sketch.ts`                                                                               | op 定义（`@name sketch`）、`assertSketchParams`、错误码 `E_SKETCH_*` | 文件改 `profile.ts`，`@name profile`，错误码同步 `E_PROFILE_*` |
| `packages/fcstd/src/codegen.ts:236`                                                                             | 生成代码硬编码 `op: 'cad.sketch'`                                  | 改 `cad.profile`                                      |
| `packages/fcstd/src/codegen.test.ts`                                                                            | 多处 `expect(code).toContain('cad.sketch')`                   | 断言同步                                                 |
| `packages/fcstd/src/sketch-contour.test.ts`                                                                     | 用例标题与 `runCode` 字符串                                         | 同步                                                   |
| `packages/tests/faijs/topology-naming/*`（phase0-coverage-baseline、g3-replay-chains）、`edge-ref/edge-ref.test.ts` | 约 12 处 `cad.sketch(${SQUARE})` 模板                           | 同步                                                   |
| `packages/core/src/api/` 测试（\_\_probe-extrude、wire-helix、revolve-probe、sweep-loft）                              | 用例内脚本字符串                                                    | 同步                                                   |
| `packages/core/src/api/thicken.ts`、`sweep.ts`、`loft.ts`                                                         | JSDoc 示例与注释                                                 | 同步                                                   |
| `packages/core/src/api/surface/arg-spec.ts`                                                                     | 注释中引用                                                       | 同步                                                   |
| `packages/core/src/mesh/api.d.ts`                                                                               | **生成文件**，由 `gen-api-dts.ts` 产出                              | 重跑生成脚本                                               |
| `docs/ops-api-inventory.md` 与 `.zh.md`                                                                          | 8 处示例（双语配对）                                                 | 双语同步                                                 |
| `packages/core/dist/`、`packages/fcstd/dist/`                                                                    | 构建产物                                                        | 全量重建                                                 |
| 3d_editor（外部项目）                                                                                                 | 消费面                                                         | 变更须同步                                                |

## 8. 安装可消费性：npm 安装后必须能跑（结果级测试）

**用户要求（原话）**：「只需要保证通过 npm 方式进行安装调用，以后可以正常运行，要有这样的测试，只要有结果测试就行了，不需要一个一个的细节。」

验收目标是**发布态可消费**，不是源码态；断言只看**最终几何结果对不对**，不逐 API 铺细节。

### 8.1 为什么必须有：workspace 测试覆盖不到发布态

现有测试（包括 `cq-compat-sketch/src/sketch-pkg.test.ts` 那类 package-surface 冒烟）跑的是 monorepo 内的 `src/`，靠 vitest alias / workspace 链接解析 `@faicad/faijs`。这条路径**永远发现不了**只有装出去才暴露的问题：

| 只在发布态暴露                 | 具体表现                                                                        |
| ----------------------- | ------------------------------------------------------------------------- |
| `exports` 子路径漏写 / 写错     | import 直接 `ERR_PACKAGE_PATH_NOT_EXPORTED`                                 |
| `files` 没带 `dist/`      | 装完是空包                                                                      |
| 发布态缺依赖                  | src 下靠 monorepo hoisting 蒙对，装出去立刻 `Cannot find module`（ghost-deps 只查声明，不查发布态） |
| dist 的 import 扩展名未修     | ESM 下 `ERR_MODULE_NOT_FOUND`                                              |
| planegcs wasm 定位        | `createRequire` 解析在 `node_modules/@faicad/faijs-sketch/dist/` 下是否仍成立        |
| `.d.ts` 缺失 / 路径错位       | 消费方 TS 报类型错                                                               |

既有的 `scripts/publish-all.ps1` 只做到 E2 tarball 白名单断言（有 `package.json` + 有 `dist/` + 无禁用文件）和发布后 `npm view` 校验——**中间缺"装进去真跑一遍"这一步**。本包补上。

### 8.2 它是永久测试，不是一次性脚本

**落点（全部入库，随包走）**

```
packages/sketch/
  ├── src/install-smoke.test.ts          永久测试（vitest 用例；与仓库「测试放 src/」惯例一致）
  ├── smoke/install-smoke-consumer.mjs   被安装后真正执行的消费方脚本（放 src 外，不进 tsc 构建、不进 tarball）
  ├── vitest.config.ts                   默认套件：include src/**/*.test.ts，exclude src/install-smoke.test.ts
  └── vitest.install.config.ts           只 include src/install-smoke.test.ts，testTimeout 10 分钟
```

`package.json` 增 `"test:install": "vitest run -c vitest.install.config.ts"`。

`install-smoke.test.ts` 是**一个真正的 vitest 测试**：`beforeAll` 里 pack + install，`afterAll` 里清理，中间起 `node` 子进程跑消费方脚本并断言输出。不是跑一次就删的 dbg 脚本——任何人、任何机器、`npm run test:install -w @faicad/faijs-sketch` 都能复现同一结果。

**一次执行的流程**

1. 前置断言：`dist/` 已存在（CI 里 build 排在测试前）；没 build 就报明确错误，**不静默跳过**。
2. pack：包目录与 core 目录各跑 `npm pack --pack-destination <tmp>`——**tarball 只落临时目录，仓库里不留 tgz**。
3. 隔离消费目录：`fs.mkdtemp(path.join(os.tmpdir(), 'faijs-sketch-smoke-'))`，写入 `package.json`（`type: module`），依赖指向两个 tgz 的绝对路径。
4. peer 依赖**不碰网络**：用 `createRequire` 从仓库根解析已 hoist 的 `occt-wasm` / `three` 真实路径，以 `file:<绝对路径>` 写进依赖表。解析不到就**大声失败**，不许退化成联网安装——否则离线 CI 上会随机红。
5. `npm install --no-audit --no-fund --loglevel=error`。
6. 把 `smoke/install-smoke-consumer.mjs` **拷贝**进临时目录再执行（node 按脚本所在位置解析 `node_modules`，就地执行会解析到仓库根，等于没测发布态），然后起子进程 `node install-smoke-consumer.mjs`：**一条草图打穿全链路**——矩形四边 + 两条水平约束 + 一条长度约束（欠约束起步，由约束拉成形）→ `solveSketch` → `sketchFaces` → 挤出成实体。
7. 断言**只有结果**：退出码 0；stdout 里的关键坐标 / 面积 / 体积等于解析解（`toBeCloseTo`）。

逐约束类型、逐几何分支的细粒度断言属于包内单测（§9 步骤 8），**不是这条测试的职责**——这条只回答一个问题：装进去能不能跑出正确结果。

**可重复性的硬要求**

| 要求       | 做法                                                            |
| -------- | ------------------------------------------------------------- |
| 幂等       | 每次 `mkdtemp` 新目录；`--pack-destination` 不写仓库；跑完删除临时目录            |
| 可调试      | `FAIJS_SMOKE_KEEP=1` 时保留临时目录并打印路径                              |
| 不拖慢日常    | 默认套件不含它（`vitest.config.ts` 里 exclude）；`test:install` 单独入口；`testTimeout` 放宽到 10 分钟 |
| 不会悄悄失效   | 进 `scripts/ci.ps1`，并作为 `scripts/publish-all.ps1` 的 pre-publish 门 |
| 结论留在测试里  | 将来若发现新的发布态问题，补成这条测试的断言，不写一次性 dbg 脚本                            |

### 8.3 归位

- 接进 `scripts/ci.ps1`（末尾一步），同时作为 `scripts/publish-all.ps1` 的 **pre-publish 门**（装不过就不许发布）。
- 新包同步登记：`scripts/publish-all.ps1` 的 `$Packages` 列表、根 `package.json` workspaces 顺序、四个守卫（§9 步骤 9）。

## 9. 实施步骤

1. **改名**：`core/src/api/sketch.ts` → `profile.ts`，`@name profile`，错误码前缀同步；跑 core + fcstd + tests 全量，清掉全部 `cad.sketch` 旧引用；重跑 `gen-api-dts`；双语文档同步。
2. **新建 `packages/sketch`**（`@faicad/faijs-sketch`）：从 fcstd 搬入 `sketch-solver.ts`、`planegcs-backend.ts`、`contour.ts`（环组装，见 §3.3）及 `sketch-parse.ts` 的类型部分；`sketch-verify.ts` 随求解通道一并下沉，fcstd 保留 XML 解析。
3. **规范模型**：实现 `Ref` / `At` 解析与 §4.3 约束集；写 §4.5 双向投影表与单点转换函数。
4. **`solveSketch`**：接 planegcs，实现 §5 三种状态的诊断产出。
5. **`sketchFaces` + `cad.sketch`**：本库导出草图 op（`@name sketch`）、合并函数与符号注册（照 extra 模式），宿主并入 `cad`；op 内部复用 `cad.profile` 的构面函数。
6. **mesh 链路**：草图相关 API **永久 brep-only**（2026-09-27 拍板，业界无先例），mesh 侧显式抛 `E_MESH_UNSUPPORTED`；不做 2D 三角化 + 挤出 dual-op。
7. **fcstd 切换**：`convert.ts` 改从 `@faicad/faijs-sketch` 导入；删除包内 `sketch-solver.ts` / `planegcs-backend.ts` / `contour.ts`；公开读取面（`index.ts` 已导出的 `SketchCon` / `SketchGeom` / `ConstraintType` / `CONSTRAINT_NAMES` / `parseConstraintList`）改为 re-export 保兼容，不得静默 breaking。
8. **测试**：planegcs GOTCHA 测试随包迁移；新增脚本面 e2e（水平/垂直、长度驱动、欠约束、冗余过约束、冲突过约束五类）；**新增 §8 的 npm 安装冒烟（装 tarball → 跑通 → 断言结果）**；stderr 零容忍照常。
9. **收尾**：新包登记进 `publish-all.ps1` 的 `$Packages` 与根 workspaces 顺序；workspaces 顺序 / ghost-deps / dep-lockstep / madge 四守卫 + `npm run build`；版本号按 lockstep 递增；实施时补一份 Agent Note（记录 `cad.sketch` 改名取舍与"库无 core 深路径特权"这条边界）。

## 10. 决策点

全部已拍板（2026-09-26 定稿，无剩余待确认项）。

### 10.1 第一批拍板（2026-09-26 上午）

| 项             | 结论                                 |
| ------------- | ---------------------------------- |
| 规范模型          | 用通用 `At`，不用 FreeCAD `pos` 三值枚举       |
| 包名            | `@faicad/faijs-sketch`             |
| 脚本面入口         | 进 `cad` 命名空间，名为 `cad.sketch`         |
| 欠约束 / 过约束     | 允许；诊断双路暴露，不静默                        |
| 现有轮廓构面 op     | 改名，`sketch` 让给草图（取舍见 §6.1.1）         |

### 10.2 第二批拍板（2026-09-26 定稿，D1–D6）

| #   | 项              | 结论                                                           | 理由与代价                                                                                                       |
| --- | -------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| D1  | 改名后的新名         | **`cad.profile`**                                            | `profile` 是截面/轮廓通用词，与草图语义正交；弃 `cad.contour`（与 fcstd 内部 `Contour`/`ContourSeg` 同名易混）、`cad.face2d`（太窄，该 op 还要出 wire） |
| D2  | `cad.sketch` 归属 | **库提供 op + 宿主合并注册**（照 extra 模式）                              | 可选能力，宿主不合并则无此 op，core 保持零草图知识。代价：3d_editor / 小程序宿主要各接一次合并                                                     |
| D3  | 冲突型过约束         | **放行 + best-effort 解 + 诊断**（残差 + 被剔除约束）                      | 冲突是过约束的一类；fcstd 读第三方 `.FCStd` 时常见，收紧成 err 会让整份文件转换直接失败                                                        |
| D4  | 首版几何范围         | **line + circle + arc**；ellipse / bspline / point 预留 schema   | fcstd P0 的 15 类约束在这三种几何上已跑通真实文件；bspline 采样与求解器参数化未标定，命中即 `E_SKETCHC_UNSUPPORTED_GEOM`                         |
| D5  | 首版 mesh 链路     | **brep-only**，mesh 侧显式抛 `E_MESH_UNSUPPORTED`                  | 2026-09-27 升级拍板：草图相关 API **永久 brep-only**，不做 2D 三角化 + 挤出 dual-op——业界无草图约束走 mesh 链路的先例（CadQuery / FreeCAD 草图求解均落 OCCT 精确边）                                |
| D6  | 改名别名过渡         | **不做别名**                                                     | 语义冲突正是改名原因。代价：3d_editor 与存量 `.fai.js` 必须同步改（清单见 §7）                                                           |
