# faijs / brepjs 冲突 API 分离方案（2026-09-05）

> 状态：方案（未实施）
> 范围：仅 9 个冲突 API —— `box` / `sphere` / `cylinder` / `cone` / `translate` / `scale` / `rotate` / `intersect` / `faceCenter`，外加用户追加裁决的细分度参数 `segments`
> 事实基线：本文件所有结论均来自 2026-09-05 当天的源码与 `faijs-cli check` 实测，**不引用任何历史 plan 文档**；行号均附实测日期，改动前复核。

---

## 0. 需求来源（用户原话，逐字）

### 0.1 初始需求

> 之前，在把brepjs的api引入faijs项目的时候，有下面这些冲突的api，
> 由于faijs和brepjs的参数不同，当时决定是同时保留双方的实现，然后根据参数来分派。具体包括下面这些api：
> *9 个 （双形态映射即可：`box`/`sphere`/`cylinder`/`cone`/`translate`/`scale`/`rotate`/`intersect`/`faceCenter`）

> 但是../3d_editor项目的UI层并不支持双形态映射。所以我决定还是把双方的实现分开。

> 如果双方的实现不兼容，那么把faijs的实现改名。比如rotate，已经改名为了rotate_euler。

> 现在，请检查上面其他所有的api。有两个选择：要么只保留brepjs的实现并删除faijs的实现（同时要更改../3d_editor项目的UI层），要么保留两份实现并给faijs的实现改名。

> 以box为例，faijs的api只是brepjs实现的子集，那么完全可以只保留brepjs的api。但是这就要求3d_editor项目的UI层编辑box这个op的时候，要提供xyz三个尺寸的编辑框，而不是一个size的编辑框。同时还要提供brepjs对应的mesh的实现。

> 请详细分析其他的api，做出选择，并写成一份技术实现方案。

### 0.2 裁决（2026-09-05，逐字，本方案须无条件满足）

> **裁决 1（segments 归属）**：segments 的归属：faijs所有支持segments参数的，brepjs也都必须增加这个可选参数。mesh 路径消费，brep 路径不是忽略，而是用于三角化。brep模型显示、导出stl的时候，照样需要三角化。

> **裁决 2（scale）**：faijs 的非等比实现改名 scale3d，确定这个方案。已经修改完成了。

> **裁决 3（不兼容红线）**：所有选择更改为brepjs签名的api，在faijs和../3d_editor项目中，所有代码都必须采用新的签名，不准采用老的签名，而不是什么兼容。

> **裁决 4（例外）**：然后translate、sphere如果语义全等，那么可以保留两种写法进行兼容。

> **裁决 5（默认锚点，2026-09-05 拍板）**：这样，在3d_editor项目的宿主侧，实现其原来的默认行为，也就是基本体都居中(api必须换成新的，只是居中采用原来的方案)。在faijs项目，不论是库函数，还是.fai.js脚本层面，都保持兼容brepjs的约定，在faijs项目里有个demo项目，也是要采用brepjs的默认规则。

> **裁决 6（demo 归属）**：faijs 仓库内的 `packages/demo` 同 `.fai.js` 脚本层面，**一律 brepjs 默认规则**，不享受宿主居中。

> **裁决 7（xyz + Z-up 红线，2026-09-05）**：本系统是cad，绝对、必须是xyz。必须是z轴朝上，没有任何例外可言。任何不符合xyz顺序的代码，一定是错误的。（补充常识基准：three.js 原生 Y-up，凡使用 three.js API 构造几何，必须反转为 Z-up——反转本身正确且必须，但反转后各维度的落轴必须仍满足 xyz 契约。）

**裁决 7 的直接结论**：`size:[a,b,c]` 的文档契约（X=a, Y=b, Z=c）是对的；现状实现产出 X=a, Y=c, Z=b 是**实参映射 bug**，不是"另一种约定"。错误行在 `mesh/primitives.ts:39-43`（`BoxGeometry(w,h,d)` 缺一次第 2/3 参对调，正确应为 `BoxGeometry(x, z, y)` 再旋转）；`primitives/brep-primitives.ts` 的 corners 映射同源同错（两条路径互相"对齐"地错，parity 测试无法发现）。**迁移按文档意图执行：`box({size:[a,b,c]})` → `box(a, b, c, {centered:true})`，不做任何换位**（§6.3 注 1）。

**裁决 5 的精确含义（消除了 §8.1 的待决项）**：

| 层 | 归属 | 默认锚点 | 谁负责"居中" |
|---|---|---|---|
| faijs 库函数（cad 面 / compat 面） | faijs | **brepjs 裸默认**（box 角点在原点、cyl/cone 底面在 Z=0、sphere 球心原点） | 无——**不注入任何默认值** |
| faijs `.fai.js` 存量脚本 | faijs | 同上 | 调用点显式写 `centered:true`（由 codemod 一次性重写，§6.3） |
| `packages/demo` | faijs | 同上 | 调用点显式写 |
| 3d_editor 生成的 `.fai.js` | 3d_editor | **保持今天的行为：基本体居中** | **宿主（UI）**——生成代码时恒定输出 `centered:true` + `at` |

即：**"居中"不再是框架约定，而是 3d_editor 宿主的生成策略**。faijs 侧逐字对齐 brepjs，3d_editor 侧用户体验零变化。

---

## 1. 结论速览

| # | API | faijs 契约（cad 面现状） | brepjs 契约（vendored） | 关系 | **决策** | **双形态** | UI 改动 | 补 mesh |
|---|---|---|---|---|---|---|---|---|
| 1 | `box` | `box({size: n\|[x,y,z], center?})` 默认居中 | `box(w,d,h,{at?,centered?})` 默认角点在原点 | faijs ⊂ brepjs，但**键非一一映射**（`size`→`w,d,h`） | **A：改用 brepjs 契约** | ❌ 禁止（旧签名废弃） | 三框 + 显式 `centered:true` | 必做 |
| 2 | `sphere` | `sphere({radius, segments?, center?})` | `sphere(r,{at?,segments?})` | **语义全等**（`center`≡`at`，球心原点） | **A** | ✅ **允许（裁决 4）** | 零改动 | 必做 |
| 3 | `cylinder` | `cylinder({radius,height,segments?,center?})` 默认居中 | `cylinder(r,h,{at?,axis?,centered?,segments?})` 默认底面原点 | faijs ⊂ brepjs，锚点默认值不同 | **A** | ❌ 禁止 | 显式 `centered:true` | 必做 |
| 4 | `cone` | `cone({radiusBottom,radiusTop,height,segments?,center?})` | `cone(rb,rt,h,{at?,axis?,centered?,segments?})` | 同 cylinder | **A** | ❌ 禁止 | 加 `radiusTop` 框 + `centered:true` | 必做 |
| 5 | `translate` | `translate(shape,{offset:vec3})` | `translate(shape, v:Vec3)` | **语义全等**（`offset`≡`v`） | **A** | ✅ **允许（裁决 4）** | 零改动（可选切 positional） | 必做 |
| 6 | `scale` | `scale(shape,{factor: n\|[x,y,z]})` **非等比** | `scale(shape, factor:number, {center?})` 只等比 | **互有对方没有的** | **B：faijs 改名 `scale3d`（裁决 2 定案）** | ❌ | 按等比/非等比分派 callee | 必做（等比） |
| 7 | `rotate` | 已改名 `rotate_euler(shape,{anglesDeg,pivot?})` | `rotate(shape, angle, {at?,axis?})` 轴角 | 语义不同 | **已完成 B** | ❌ | 无（不得暴露 brep-only 的 `rotate`） | 已投影，brep-only（§4.7） |
| 8 | `intersect` | variadic、async、`keepHidden`、roleTable | `(a,b,options?) → Result<T>` 二元同步 | 三维度全不一致 | **分面不改名**（§4.8） | ❌ | 无 | — |
| 9 | `faceCenter` | **faijs 侧不存在同名 op**（仅 engrave/knurl 参数键） | `faceCenter(face: Face): Vec3` | 伪冲突 | **无冲突 + 修正 arg-spec 失效说明** | — | 无 | — |

**A = 只保留 brepjs 实现（cad 面改用 brepjs 参数契约）；B = 保留两份，faijs 改名。**

**双形态"列的含义**：同一 op 名是否同时接受位置形态与对象形态。允许的前提是**键一一映射、语义全等**（§3 判据）。裁决 3 禁止的是"用老签名继续写代码"，不是禁止"两种等价写法"。

---

## 2. 现状基线（读码 + 实测，2026-09-05）

### 2.1 三面的当前归属

- **cad 脚本面** = `createApiNamespace()`（`api/api-namespace.ts:53-68`）：faijs dual op 字面量 + `...scriptFaceOps`。`scriptFaceOps` 由 `api/generated/script-face.ts` 生成，当前只有 brepjs 投影 op（`torus/fuse/ellipsoid/rotate/mirror/clone/applyMatrix/…`）。
- **`box`/`sphere`/`cylinder`/`cone`/`translate`/`scale`/`intersect`/`faceCenter` 的 brepjs 版本当前都不在 cad 面** —— `api/surface/arg-spec.ts` 中它们的 `kind` 全部为 `'skip'`（实测行号 2574 / 2578 / 2582 / 2586 / 2685 / 2697 / 2761 / 3066），只有 `rotate` 是 `'brep-op'`（2689）。
- **compat 面** = `api/compat/index.ts`：brepjs 语义投影。实测：`box` 是手写双形态（`compat/index.ts:96-140`，接受 `box(w,d,h)` 与 `box({size})`/`box({width,depth,height})`）；`sphere` = vendored 直接 re-export（178 行）；`cylinder` = re-export（180 行）；`cone` = `wrapDual`（182-183 行）。

**推论**：冲突不在"两个面已撞名"，而在双形态方案想让**同一个 cad 名字**承载两套参数契约。放弃双形态后，只要每面内单一契约，两面天然分离；工作量集中在"cad 面换成 brepjs 契约 + 旧签名删除"。

### 2.2 双形态判别器对"尾参 options"必然失效（根因）

`api/internal/dual-form-args.ts` 的 `positionalToObject` 按 `positional.keys` 装箱：vec3 槽最多吃 3 个实参，非 vec3 槽每键吃 1 个，**剩余实参一律抛 `E_ARGS_FORM`**。

| 调用 | 当前行为 |
|---|---|
| `box(10,20,30)` | ✅ `{size:[10,20,30]}` |
| `box(10,20,30,{centered:true})` | ❌ `E_ARGS_FORM`（vec3 槽吃 3 个后余 1） |
| `sphere(5,{at:[0,0,10]})` | ❌ `E_ARGS_FORM` |
| `cylinder(5,40,{centered:true})` | ❌ `E_ARGS_FORM` |
| `translate(p,[10,0,0])` | ✅ `{offset:[10,0,0]}` |
| `scale(p,2,{center:[0,0,0]})` | ❌ 装出畸形 `factor=[2,{…}]` |

**裁决 4 要求 sphere / translate 保留两种写法 → 判别器必须扩展**（§6.2），否则"两种写法"里带 options 的那半边是死的。

### 2.3 位置形态在 `.fai.js` 可用（实测）

`npx tsx packages/core/scripts/faijs-cli.ts check` 对含 `cad.box(10,20,30)` / `cad.translate(p,[10,0,0])` / `cad.rotate(p,45,{axis:[0,0,1]})` / `cad.scale(p,2,{center:[0,0,0]})` / `cad.cone(10,4,30)` / `cad.sphere(5,{at:[0,0,10]})` / `cad.cylinder(5,40,{centered:true})` 的脚本返回 OK（parse + schema + 引用预检全过，含数组字面量与尾参 options 对象）。

→ A 方案的语言层前提成立。

### 2.4 3d_editor UI 层的消费形态

- `FeatureDef.buildArgs(params): Record<string, HostArg>`（`src/engine/features/types.ts:124`）—— UI 只能产出**对象形态 args**；代码行由 `formatCodeLine({callee, positional, outputs, args})` 打印。
- primitive Feature 的 `positional` 恒为 `[]`（`features/primitive.ts:47`），`buildArgs` 只把 params 中的 number/array 字段转成 args（`features/primitive.ts:28`）—— **primitive 不输出 center**，位置由 placement 决定。
- transform Feature 的 `positional` 只放输入引用（`features/transform.ts:63`），缩放产出 `factor:[x,y,z]`（vec3，非等比是 UI 硬需求，`features/transform.ts:152-160`）。
- `PrimitivePanel.tsx`：cube 只有**一个 `size` 输入框**；cone 的 `radiusTop` 硬编码 0（第 73 行）→ UI 现在只能造尖锥。
- UI 无法在同一 op 名上按参数选择两套语义（`FeatureDef` 无形态选择字段）—— 这是"UI 层不支持双形态映射"的准确落点。

### 2.5 细分度参数的现状（`segments` / `nRad`）

| 事实 | 位置（2026-09-05 实测） |
|---|---|
| 两个名字：`nRad`（现行）与 `segments`（历史名）；`NRAD_DEFAULT=32`、`NRAD_MIN/MAX`、`clampNRad()` | `mesh/types.ts`；经 `index.ts:97`、`browser.ts:172` 导出 |
| mesh 路径消费：`clampNRad(params.nRad ?? params.segments)` → THREE 几何分段数 | `mesh/primitives.ts:60 / 77 / 93` |
| brep 路径**已消费**：`segmentsToAngularDeflection(segments)=2π/max(3,segments)` → `kernel.meshShape({linearDeflection:0.1, angularDeflection})` | `brep/primitives-brep.ts:44-72`，调用点 `:105 / :114 / :123` |
| brep 另一消费点：`solidToShape(kernel, solid, segments?)` 同式转 angularDeflection | `brep/brep-ops.ts:40-52` |
| **缺陷**：`solidToShape(kernel, result.solid, params.segments)` 只取 `segments`，未取 `nRad`、未经 `clampNRad` | `api/primitives.ts:83` |
| 带细分度的 op 清单（生成文件）：box(nRad)、sphere(segments+nRad)、cylinder(segments+nRad)、cone(segments+nRad)、wedge(nRad)、screw(nRad) | `mesh/api.d.ts:17-23`（**生成文件，禁止手改**，改 schema 后重跑 `gen-api-dts.ts`） |

**结论**：用户裁决 1 中"brep 路径不是忽略，而是用于三角化"与 faijs 现状**一致**（三角化 = 显示 mesh 与 STL 导出的唯一来源）。本方案要把它从"既成事实"升为"强制契约"，并补齐 `api/primitives.ts:83` 的缺口。

---

## 3. 判定标准（含裁决 3/4 的落点）

三个维度，任一不兼容即不能合并：

1. **参数契约**：位置/对象形态、参数个数、options 键集合是否**一一映射**。
2. **几何语义**：默认锚点（角点 / 底面 / 中心）、轴向、是否居中等**默认行为**是否一致。
3. **返回与副作用契约**：同步/异步、返回值、时间线副作用、拓扑命名（roleTable）。

**决策规则**
- faijs ⊆ brepjs 且默认语义差异可由调用点显式吸收 → **A（改用 brepjs 契约）**；
- 双方互有对方没有的能力，或返回/副作用不可调和 → **B（faijs 改名）**；
- 本就不在同一面 → **分面（不改名）**。

**是否允许双形态（裁决 3 与裁决 4 的分界判据）**

> 只有**键一一映射、语义全等**的两个形态才允许并存；凡是"旧键需要语义转换才能变成新键"的，旧签名一律废弃，不允许兼容。

- `sphere`：`{radius, center?}` ↔ `(r, {at?})`，`center` ≡ `at`（都是球心） → **允许双形态**（裁决 4）。
- `translate`：`{offset}` ↔ `(v)`，`offset` ≡ `v` → **允许双形态**（裁决 4）。
- `box`：`{size, center?}` → 需把 `size` 拆成 `w,d,h`（语义转换），且默认锚点从"居中"变"角点" → **禁止**，旧签名废弃（裁决 3）。
- `cylinder` / `cone`：同 box（锚点默认值不同） → **禁止**，旧签名废弃（裁决 3）。
- `scale`：两套语义本就不同，已改名为两个 op，不存在同名的两种写法。

---

## 4. 逐 API 决策

### 4.1 `box` → A（改用 brepjs 契约，旧签名废弃）

**双方契约**
- faijs：`box({ size: number | [x,y,z], center?: vec3 })`，**默认居中**；mesh 走 `mesh/primitives.ts:37`（THREE.BoxGeometry 居中 + `geo.translate(center)`）；brep 走 `primitiveBrep`（`api/primitives.ts:71-86`）= `primitiveToBrepSolid` + `assignRoles` 建 roleTable + `fromBrep` 登记链。
- brepjs：`box(width, depth, height, options?: { at?: Vec3; centered?: boolean; segments?: number })`，**默认角点在原点**；维度顺序 width/depth/height（`vendored/brepjs/topology/primitiveFns.ts:82-96`；`compat/index.ts:88` 注释确认）。

**差异**：① 形态；② **默认锚点**；③ `size` 需拆成三个维度（语义转换，不是映射）。

**决策**：**A + 旧签名废弃（裁决 3）**。`cad.box({size:…})` 在改造后必须抛 `E_ARGS_FORM`，错误信息里写明新写法（错误提示 ≠ 兼容）。

**默认锚点的处理（裁决 5 定案 = 方案 A）**：cad 面**采用 brepjs 裸默认**——`centered:false`，box 角点在原点、cylinder/cone 底面在 Z=0。`centered` 是 brepjs 原生 options 键，faijs **不注入任何默认值**：`cad.box(10,20,30)` 与 brepjs `box(10,20,30)` 行为逐字一致（这正是裁决 3 要求的"不准兼容"在默认值上的延伸——隐性注入默认值就是一种隐性不兼容）。

"基本体居中"由 3d_editor 宿主在自己的生成层实现（§7）：UI 恒定输出 `centered:true` + `at`，因此 **UI 用户体验零变化**；faijs 存量 `.fai.js` 与 `packages/demo` 由 codemod 显式补全 `centered:true`（§6.3），几何与今天一致。

**faijs 改动**
1. `api/primitives.ts#box`：删除 `positional:{keys:['size'],vec3Keys:['size']}` 的对象入口；改位置形态原生签名 `(w,d,h,opts?)`；保留 `assignRoles` + `fromBrep`（§5.3）。
2. mesh 实现按新契约接线：`boxMesh(w,d,h,{at?,centered?,segments?})` —— 以角点为基准构造，`centered:true` 时平移 `-(w/2,d/2,h/2)`，再叠加 `at`；与 brep 路径逐点对齐（parity 强约束）。
3. 断言改为位置参数校验（`assertPositiveNumber` ×3）；`schema` 补 `width/depth/height/at/centered/segments`。
4. `arg-spec.ts` 的 `box` 条目 `skip → brep-op`，同步重跑生成器（§5.4）。

**UI 改动**：`PrimitivePanel.tsx` 的 cube 分支由单 `size` 改为 `width/depth/height` 三框；`features/primitive.ts#buildArgs` 输出 `args:{at, centered:true, segments?}`（`positional` 仍为空——**注意**：positional 需要在 `buildCode` 处输出三值，见 §7）；`primitiveBackfill` 从三键读回；`primitiveLabel` 改 `W×D×H`。

**风险**：存量 `.fai.js` 中 35 个文件 / 97 处调用（8 类 op）→ 必须 codemod（§6.3）。

---

### 4.2 `sphere` → A + **允许双形态**（裁决 4）

**双方契约**：faijs `{radius, segments?, center?}`（球心原点）；brepjs `sphere(radius, {at?, segments?})`（球心原点）。**唯一差异是形态**，`center` ≡ `at`。

**决策**：**A，两种写法同时合法**（裁决 4 明确许可）：

```
cad.sphere(5, { at: [0,0,10], segments: 32 })     // brepjs 位置形态
cad.sphere({ radius: 5, center: [0,0,10], segments: 32 })  // faijs 对象形态
```

两者必须产出**完全相同的几何**（不是"近似兼容"）。

**`segments`**：按裁决 1，`sphere` 的 brepjs 形态**必须带 `segments?`**（vendored 原本没有），且 mesh 与 brep 两路径都消费（§5）。

**faijs 改动**：`api/primitives.ts#sphere` 声明双形态（`positional:{keys:['radius']}` + 对象入口）；brep 侧 `solidToShape` 透传 `segments`（含 §2.5 的 `nRad` 缺口修正）；mesh 侧 `mesh/primitives.ts:60` 现状已消费，只需接线 `at`。断言保留 `assertPositiveNumber(radius)`。

**UI 改动**：**零改动**（现有对象形态即新契约内的合法形态）。

---

### 4.3 `cylinder` → A（旧签名废弃）

**双方契约**：faijs `{radius,height,segments?,center?}`（默认**中心在原点**，轴向 Z）；brepjs `cylinder(radius,height,{at?,axis?,centered?,segments?})`（默认**底面在原点**）。faijs ⊂ brepjs（差 `axis`）。

**决策**：**A + 旧签名废弃（裁决 3）**。宿主**不**注入 `centered` 默认值（同 §4.1），由 codemod 与 UI 显式写 `centered:true`。

`axis` 是 brepjs 的额外能力：投影面（compat）保留，cad 面 **v1 不投**（UI 无对应交互，投了是死参数）。

**faijs 改动**：同 box；mesh 实现需支持 base-at-origin + `centered` 平移（现 `mesh/primitives.ts:74-84` 是居中构造，需换基准）。

**UI 改动**：radius/height 两框不变；`buildArgs` 输出 `args:{at, centered:true, segments?}`。**面板不新增"对齐方式"开关**（v1）。

---

### 4.4 `cone` → A（旧签名废弃）

**双方契约**：faijs `{radiusBottom, radiusTop, height, segments?, center?}`；brepjs `cone(bottomRadius, topRadius, height, {at?,axis?,centered?,segments?})`。参数顺序一致，仅命名与锚点不同。

**决策**：**A + 旧签名废弃**。

**收益**：UI 现在把 `radiusTop` 硬编码为 0（`PrimitivePanel.tsx:73`），换契约后自然暴露 `radiusTop` 输入框 → UI 从"只能造尖锥"升级为可造圆台。

**UI 改动**：cone 分支增加 `radiusTop` 框；输出 `args:{at, centered:true, segments?}`。

---

### 4.5 `translate` → A + **允许双形态**（裁决 4）

**双方契约**：faijs `translate(shape,{offset:vec3})`；brepjs `translate(shape, v:Vec3)`。**语义完全一致**（`offset` ≡ `v`）。

**决策**：**A，两种写法同时合法**（裁决 4）：

```
cad.translate(part0, [10, 0, 0])              // brepjs 位置形态
cad.translate(part0, { offset: [10, 0, 0] })  // faijs 对象形态
```

**faijs 改动**：`api/transform.ts#translate` 声明双形态；**必须补 mesh 实现接线**（vendored translate 是 brep-only，直接投影会违反"每个 op 必支持 mesh"红线）—— mesh 侧直接用现有 `cad.translate(shape, offset)`（`mesh/transform.ts:24`）；brep 侧保留 faijs 的 `translateBrep`（含 `identityHashEvolution` 的 roleTable 传播，vendored 的 metadata 传播不能替代，§5.3）。

**UI 改动**：**零改动**（对象形态合法）。建议后续批次再切 positional，不在本方案强制。

---

### 4.6 `scale` → B（faijs 改名 `scale3d`，裁决 2 定案）

**双方契约**
- faijs：`scale(shape, { factor: number | [x,y,z] })` —— **支持非等比**，无缩放中心；
- brepjs：`scale(shape, factor: number, options?: { center?: Vec3 })` —— **只支持等比**，有缩放中心。

**差异**：互有对方没有的能力，任一方向删除都丢功能 —— UI 缩放 gizmo 是 vec3 三轴（`features/transform.ts:152-160` 产出 `factor:[x,y,z]`），非等比是 UI 硬需求；brepjs 的 `{center}` faijs 没有。

**决策（裁决 2 定案，备选方案已废弃）**：

```
cad.scale(shape, factor: number, opts?: { center?: Vec3 })    // brepjs 语义（等比 + 中心）
cad.scale3d(shape, factor: [x,y,z], opts?: { center?: Vec3 }) // faijs 语义（非等比）
```

命名理由：沿用 `rotate_euler` 的"描述性后缀"先例，`scale3d` 直指"三轴独立缩放"，UI 层 callee 切换可读。

`scale3d` 是否同时支持 `{center}`：**v1 支持**（与 brepjs 对齐，避免二次改名；实现为"平移到 center → 缩放 → 平移回"，非等比下语义明确）。

**faijs 改动**
1. `api/transform.ts`：`scale` 的 defineOp 改名 `scale3d`（`name:'scale3d'`，`factor` 定死 vec3，删除 vec3Keys 装箱）；新增 `scale`（brepjs 契约，等比 + `center`）；brep 实现 = vendored `topology/api.js#scale`，**mesh 实现必补**（等比缩放 = 现有 `cad.scale(shape, factor)` + 中心点平移补偿）。
2. `arg-spec.ts` 的 `scale` 条目 `skip → brep-op` 并投脚本面。
3. `api/api-namespace.ts` 的 cad 面同时导出 `scale` 与 `scale3d`。

**UI 改动**：`features/transform.ts` 的 `ops` 增加 `'scale3d'`；`transformCollectArgs` 按三轴是否相等选择 callee（相等 → `scale`，否则 → `scale3d`），`buildTransformCode` 按 `ctx.op` 分派（机制已存在，第 177 行）；`transformBackfill` 按 `summary.callee` 回填（标量 / 数组）；图标与 label 复用 `transform-scale`。

---

### 4.7 `rotate` → 已完成 B，本方案只补两点

现状：`cad.rotate_euler`（faijs 欧拉 XYZ，UI Feature 只用它）；`cad.rotate`（brepjs 轴角，`arg-spec.ts:2689` `kind:'brep-op'`，已进脚本面）。

补充：
1. `cad.rotate` 是 **brep-only**（`compatOp` 契约：mesh 模式/断链抛错，从不回退）→ **UI 不得暴露**；将来暴露前必须先补 mesh 实现。本方案只加标注，不改代码。
2. `rotate` 是本次 9 个里唯一已完成"两形态分开"的样本，§6 的实施路径以它为模板。

---

### 4.8 `intersect` → 分面不改名（cad 面锁 faijs，compat 面锁 brepjs）

- faijs（`api/boolean.ts:169-179`）：`cad.intersect(a, b, c…)` —— variadic、**async**（`Promise<Shape>`）、**`keepHidden` 隐藏输入**（时间线副作用）、roleTable 合流 + 面演化、mesh+brep 双实现。
- brepjs（`vendored/brepjs/topology/api.ts:203`）：`intersect(a, b, options?) → Result<T>` —— 二元、同步、返回 `Result`。

三维度全不一致（arity / 返回契约 / 副作用）。UI 的 boolean Feature（`features/boolean.ts:23-40`）是"多输入 + 无 args"。

**决策**：不改名、不删除，**分面锁定**：
- cad 面 `cad.intersect` = faijs variadic 实现（UI 与存量零改动）；
- compat 面 `intersect` = brepjs 二元 Result 实现；
- `arg-spec.ts` 的 `intersect` 条目（2761 行 `skip`）理由改写为"**禁止投脚本面**"，并加生成期断言：任何把 `topology/api.js#intersect` 标为 `brep-op`/`scriptFace:true` 的改动，必须同时把 faijs 的 `intersect` 改名为 `intersect_all`（含 UI ops 与存量迁移）。

**触发条件**：仅当第三方库需要在 `.fai.js` 内直接调用 brepjs 语义的二元 intersect 时才执行改名。

---

### 4.9 `faceCenter` → 无冲突（修正 arg-spec 失效说明）

**事实**：faijs 侧**不存在名为 `faceCenter` 的 op**。全仓（排除 vendored）grep 只命中：① `api/compat/index.ts:388/413`（brepjs 投影本身）；② `api/engrave.ts` / `api/knurl.ts` 里的**参数键** `params.faceCenter`（绝对坐标快照，非函数）。
`arg-spec.ts:3066-3067` 写的"faijs 同名 faceCenter 查询形态已手写覆盖（D-FACECENTER 双形态）"——**代码中没有这个覆盖**，属文档与代码不符。

**决策**：① 不列入冲突清单；② 修正该条 reason 为"faijs 无同名 op，仅作为 engrave/knurl 参数键存在，不共面、不冲突"；③ 若将来要在 cad 面提供面质心查询，契约应为 `cad.faceCenter(shape, ordinal?)`（入参是 faijs `Shape` + 面序号，与 brepjs 的 `Face` 入参不同），两面各持各的契约，同名不构成冲突。

---

## 5. 细分度参数 `segments` 的统一契约（裁决 1）

### 5.0 brepjs 默认参数基准（用户裁决：mesh 实现必须逐项一致，2026-09-05 补录）

**用户原话**：你找到的根本不是mesh的现状，它是根据brepjs写的，如果不一致，就是实现错误。原本的box只支持一个size参数，这才是3d_editor项目原始的实现。你他妈给我找到brepjs里的默认参数都是什么，mesh的实现必须一致。

**brepjs op 级默认**（`vendored/brepjs/topology/primitiveFns.ts:66-222`，逐字核对）：

| op | 位置参数 | options 默认 | 几何默认效果 |
|---|---|---|---|
| `box` | `width, depth, height` | `at?`（无默认）、`centered?: false` | `makeBox(w,d,h)`：**min 角点在 (0,0,0)**，向 +X/+Y/+Z 长出 |
| `cylinder` | `radius, height` | `at: [0,0,0]`、`axis: [0,0,1]`、`centered: false` | `_makeCylinder(r,h,at,axis)`：**底面圆心在 at，沿 axis 长出** |
| `sphere` | `radius` | `at?`（未给 = 不平移 = 原点） | `_makeSphere(r)`：**球心在原点** |
| `cone` | `bottomRadius, topRadius, height` | `at: [0,0,0]`、`axis: [0,0,1]`、`centered: false` | `_makeCone(rb,rt,h,at,axis)`：**底面在 at** |
| `torus` | `majorRadius, minorRadius` | `at: [0,0,0]`、`axis: [0,0,1]` | 环心在 at |
| `ellipsoid` | `rx, ry, rz` | `at?` | 球心在原点 |

内核层（`topology/solidBuilders.ts:37-72`）：`makeCylinder(r, h, location=[0,0,0], direction=[0,0,1])`、`makeCone(r1, r2, h, location=[0,0,0], direction=[0,0,1])` —— 位置/方向默认在这一层就已经是原点 + Z-up，op 层只是透传。

**brepjs 三角化默认**（`kernel/quality.ts:27-40`）：**op 级没有任何 segments 参数**。精度是**进程全局** `QualityLevel`，`mesh()`/STL 导出时取当前档位的挠度对：

| 档位 | linearDeflection | angularTolerance | 说明 |
|---|---|---|---|
| `draft` | 1e-2 | 0.5 rad | |
| `standard`（**默认**） | **1e-3** | **0.1 rad** | 注释明示"matches brepjs's historical `mesh()` defaults" |
| `fine` | 1e-4 | 0.05 rad | |

**对齐结论（写死为本方案基准）**：

1. **锚点/轴/位置默认**：mesh 实现与 brep 实现一律按上表（角点、底面、球心、Z-up）——差异即实现错误，不是风格。
2. **`segments` 是 faijs 对 brepjs 的显式超集**（裁决 1 要求 faijs 侧支持、brepjs 侧补齐可选参数），不是 brepjs 的默认；**缺省行为必须等效于 brepjs `standard` 档**：angular 0.1 rad ⇒ 整圆 ≥ ⌈2π/0.1⌉ = **63 段**。mesh 路径引擎默认从 `NRAD_DEFAULT = 32`（`mesh/types.ts:61`）**改为 64**（≥63 的最小 2 的幂，与 brepjs standard 等效且规整）；brep 路径默认直接用 brepjs 挠度对（linear 1e-3 + angular 0.1），不再经 `2π/segments` 换算缺省值（显式 `segments` 给出时仍换算：`angular = 2π/segments`）。
3. **`box(s)` 单 size 是 3d_editor 的原始需求**（等边立方体），新契约下由 UI 产出 `box(s, s, s, {centered:true})`；faijs 侧的 `{size:[a,b,c]}` vec3 分支与 `ROT_Y_TO_Z` 旋转是后来加的实现细节，随旧签名一起废弃，**不迁入新契约**。
4. 优先级相应修订：**op options `segments` > UI `nRadDefault` > 引擎默认 64（= brepjs standard 等效）**。

### 5.1 契约（三路径强制）

> **对外唯一名 = `segments?: number`。** `nRad` 作为 faijs 内部历史同义输入继续被 `clampNRad` 接受，**不新增第三个名字**；新代码、UI、脚本面一律写 `segments`。

| 路径 | 消费点 | `segments` 的语义 | 缺省 |
|---|---|---|---|
| mesh 构造 | `clampNRad(segments ?? nRad)` → THREE 分段数（`mesh/primitives.ts:60/77/93`） | 拓扑分段（决定顶点数与圆度） | 64（= brepjs standard 等效，§5.0） |
| brep 构造 | `segmentsToAngularDeflection` → `kernel.meshShape({linearDeflection:0.1, angularDeflection})`（`brep/primitives-brep.ts:44-72`）；`solidToShape`（`brep/brep-ops.ts:40-52`） | **三角化精度**：`angularDeflection = 2π/segments` | 64（等效 angular 0.1 rad） |
| brep **显示** / **STL 导出** | 上一条的三角化结果 | 决定显示网格与导出 STL 的三角形数 | 64 |
| STEP 导出 | 不涉及 | 精确面（ADVANCED_FACE），`segments` 不影响 | — |

**不变量（违反即缺陷）**
1. brep 路径**禁止丢弃** `segments`；静默丢弃必须有测试守住。
2. 同 `segments` 下 mesh 与 brep 的 **bbox 一致**（parity）；顶点数允许不同（拓扑构造 vs 三角化构造的固有差异），但**必须随 segments 单调变化**。
3. 优先级：**op options `segments` > UI `nRadDefault` > 引擎默认 64**（= brepjs standard 等效，§5.0；明确写死，消除 §2.5 的双来源歧义）。

### 5.2 需要新增 `segments?` 的 op

按裁决 1「faijs 所有支持 segments 参数的，brepjs 也都必须增加这个可选参数」，逐项对齐：

| faijs 侧（带细分度） | brepjs 投影对应 | 处置 |
|---|---|---|
| `sphere(segments,nRad)` | `sphere(r,{at?})` | **新增 `segments?`** |
| `cylinder(segments,nRad)` | `cylinder(r,h,{at?,axis?,centered?})` | **新增 `segments?`** |
| `cone(segments,nRad)` | `cone(rb,rt,h,{at?,axis?,centered?})` | **新增 `segments?`** |
| `box(nRad)` | `box(w,d,h,{at?,centered?})` | **新增 `segments?`**（box 的 nRad 当前只影响三角化，非拓扑） |
| `wedge(nRad)` / `screw(nRad)` | brepjs 无对应 op | 不适用 |
| — | brepjs 自有回转体 `torus` / `ellipsoid` | **新增 `segments?`**（同源要求，vendored 侧同样需要三角化密度） |

**机制**：`compatOp` 包装层与 faijs dual op 的 brep 实现，都把 `options.segments` 透传给 `solidToShape(kernel, solid, segments)` 的第 3 参 —— **当前这条透传不存在**（`api/primitives.ts:83` 只取 `params.segments`），必须补。

### 5.3 必须修的既有缺陷

`api/primitives.ts:83`：`solidToShape(kernel, result.solid, params.segments as number | undefined)`
→ 只认 `segments`、不认 `nRad`、未过 `clampNRad`。
**修正**：`solidToShape(kernel, result.solid, clampNRad(params.nRad ?? params.segments))`，与 mesh 路径（`mesh/primitives.ts:60/77/93`）和 brep 路径（`brep/primitives-brep.ts:105/114/123`）完全一致。

### 5.4 验收测试点

1. brep 模式下 `sphere(10,{segments:8})` 与 `sphere(10,{segments:64})` 的**三角化顶点数显著不同**（守"不忽略"）。
2. STL 导出的三角形数随 `segments` 单调增。
3. 三处消费点对 `nRad` 与 `segments` 两个名字的结果一致（等价性）。
4. `clampNRad` 边界：`segments` 越界被钳制到 `[NRAD_MIN, NRAD_MAX]`，不产生畸形几何。

---

## 6. 实施路径

### 6.1 默认锚点分层（裁决 5 定案）

| 层级 | 谁写 | 内容 |
|---|---|---|
| 框架默认 | faijs 投影层 | **无任何注入** —— brepjs 裸默认即 cad 面默认（box 角点在原点、cyl/cone 底面 Z=0、sphere 球心原点）；`segments` 引擎默认 64（= brepjs standard 等效）是唯一的框架默认（§5.0） |
| 库作者覆盖 | 第三方库 options | `box(10,20,30,{centered:true, segments:64})` |
| 调用点显式 | UI 生成代码 / 用户 `.fai.js` / codemod 产物 | `centered:true`、`at` 显式写出，最高优先级 |

**"居中"的职责划分（裁决 5）**：

- **faijs 侧**（库函数 / `.fai.js` / `packages/demo`）：一律 brepjs 裸默认，`cad.box(10,20,30)` 与 brepjs `box(10,20,30)` 行为逐字一致。需要居中的存量代码由 codemod 显式补 `centered:true`（§6.3）。
- **3d_editor 宿主侧**：UI 生成代码时**恒定输出** `centered:true` + `at`（§7），宿主用户体验与今天完全一致——"基本体都居中"从框架约定降级为宿主生成策略。
- **守卫方式**：几何断言（cad 面 `box(10,20,30)` 的 bbox 中心 ≡ `(5,10,15)` 即角点语义；UI 产物 bbox 中心 ≡ `at`），不做文本断言。

### 6.2 判别器扩展（为裁决 4 的 sphere / translate 双形态）

`api/internal/dual-form-args.ts#positionalToObject` 新增**尾参 options 合并**规则：

```
positional 槽按 keys 装箱后，若剩余实参恰好 1 个且为 plain object → merge 进 args
（与已装箱键冲突 → E_ARGS_FORM）；否则维持现有 E_ARGS_FORM 行为。
```

这条规则让 `box(10,20,30,{centered:true})`、`sphere(5,{at,segments})`、`cylinder(5,40,{centered:true})` 全部可用 —— 即 **brepjs 形态 + options 尾参**在脚本面成立。注意：它**不**恢复 `box({size:…})` 这类对象形态（旧签名仍废弃，§4.1）。

### 6.3 存量迁移（裁决 3：唯一方式 = codemod 一次性重写，无过渡期）

**codemod 映射表（必须逐条实现并测试）**

| 旧写法 | 新写法 |
|---|---|
| `box({size:20})` | `box(20, 20, 20, { centered: true })` |
| `box({size:[a,b,c]})` | `box(a, b, c, { centered: true })` —— **不做任何换位**，按文档 `[x,y,z]` 意图迁移，见下方注 1（这 8 处属"顺带语义修复"，迁移后几何会变化） |
| `box({size:s, center:[x,y,z]})` | `box(<同上展开>, { at: [x,y,z] })`（box 的 `at` 即中心语义，无需再写 `centered`） |
| `cylinder({radius:r,height:h,center:c})` | `cylinder(r, h, { centered: true, at: c })`（cyl/cone 的 `at` 是底面语义，必须配 `centered:true`） |
| `cone({radiusBottom:rb,radiusTop:rt,height:h,center:c})` | `cone(rb, rt, h, { centered: true, at: c })` |
| `cylinder({radius,height})` / `cone({...})`（无 center） | 各维度不变 + `{ centered: true }` |
| `scale(p,{factor:[x,y,z]})` | `scale3d(p, [x,y,z])` |
| `scale(p,{factor:n})` | `scale(p, n)` |
| `sphere({radius,center,segments})` / `translate(p,{offset})` | **不动**（双形态合法，裁决 4） |
| `rotate_euler(...)` | **不动**（已是 faijs 专名，本次不涉及） |

#### 6.3.1 影响面实测清单（2026-09-05 grep 全量统计，实施前须以当时代码复核）

**faijs 仓库**

| 范围 | 数量 | 说明 |
|---|---|---|
| `packages/**/*.fai.js` | **46 个文件** | 调用点：box 45 / sphere 14 / cylinder 10 / cone 5 / translate 11 / rotate_euler 5 / intersect 2 / scale 0，共 **92 处** |
| 其中 `box` 形态 | 45 处**全部** `{size:…}` | 位置形态 0 处；带 `center:` 的 box 5 处 |
| 其中 `center:` 总量 | 19 处 | sphere 9 / cylinder 5 / box 5 |
| `packages/**/*.test.ts` | **39 个文件 / 466 处** | box 390（仅 6 处已是位置形态）/ translate 35 / sphere 26 / cylinder 8 / rotate_euler 6 / cone 2 / intersect 1 |
| 非测试 `src` 引用 | 17 处 | 主要是 `mesh/api.d.ts` 生成物与 fixtures |

**3d_editor 仓库（`src` + `test`）**

| 类别 | 文件 | 站点 | 改法 |
|---|---|---|---|
| 代码字符串黄金断言 | `script-engine.test.ts`(~25)、`feature-registry.test.ts`(8)、`executeScript.test.ts`(8)、`TimelinePanel.test.tsx`(4)、`model-store.test.ts`(3)、`group-file-members.test.ts`(3)、`chamfer.test.ts`(1)、`c4-brepjs-gear.test.ts`(1) | **~53 处** | 只改期望串（`{size:20}` → 新签名），机械替换，无逻辑风险 |
| 真实执行 + 几何断言 | `assembly-transform.test.ts`(8)、`test/e2e/control-flow-drill-roundtrip.spec.ts`(2) | 10 处 | **全部是自洽断言**（cad 链 vs 手算矩阵 / 往返前后对比），锚点变更不破坏；只需把入参签名改掉 |
| 生产源码 | `features/primitive.ts`、`primitives/PrimitivePanel.tsx`、`primitives/placement.ts`、`stores/tools/primitives-store.ts`、`fixtures/faqts/clamp-plate.ts`(2)、`test/faijs/*.fai.js`(3) | ~10 处 | §7 详列；`clamp-plate.ts` 与 `test/faijs` 属脚本，走 codemod |

**关键结论（决定工作量）**：3d_editor 的几何断言**没有硬编码绝对坐标**——`assembly-transform.test.ts` 用手算矩阵对照同一 shape 的 cad 链，e2e 用往返前后对比。因此**锚点变更本身不会让它们红**；让它们红的是 `{size}` 等旧签名作废，而这是机械替换。3d_editor 真正的工程量在 §7 的 UI 生成/回填链路，不在测试修复。

（上一版记录"35 文件 / 97 处 / 73 处"为粗粒度估算，以本表为准。）

**⚠️ 注 1（实测 + git 取证，2026-09-05，按裁决 7 定性）：vec3 `size` 的 Y/Z 落轴是实现 bug，迁移不换位。**

**术语**：codemod = 一次性的批量改写脚本（读旧写法 → 按映射表输出新写法），不是架构组件，迁移完成即弃。

**bug 定性（裁决 7）**：`docs/ops-api-inventory.md` 写 `size:[x,y,z]` 是**对的**；实测行为不符才是 bug：

```
box({size:[10,20,30]})            → 现状 bbox 尺寸 X=10, Y=30, Z=20   （应X=10,Y=20,Z=30）
box({size:[10,20,30],center:[5,5,5]}) → min [0,-10,-5] max [10,20,15]（center 语义正常）
```

**错误行**：`mesh/primitives.ts:39-43`——

```ts
const [w, h, d] = params.size        // 契约是 [x,y,z]，这里却按 [宽,高,深] 解构
geo = new THREE.BoxGeometry(w, h, d) // THREE 原生 Y-up，参数序 (X宽,Y高,Z深)
geo.applyMatrix4(makeRotationX(π/2)) // Y-up→Z-up 反转：本身正确且必须（three.js 常识）
```

Y-up→Z-up 的旋转没有错，错在**调用 THREE 前没把第 2/3 实参对调**（应为 `BoxGeometry(x, z, y)` 再旋转，出来才是 X=x, Y=y, Z=z）。`primitives/brep-primitives.ts` 的 corners 映射按"mesh 侧现状"同源实现（注释 `ROT_Y_TO_Z swaps Y and Z`），两条路径**一致地错**，所以 parity（mesh vs brep 一致性）测试天然发现不了。

**为什么验证一直没抓住（git 取证，回答"怎么可能有这种 bug"）**：bug 自 2026-08-13 初版（`df0e0cb`，`src/cad-core/primitives.ts:35`）就存在，且**有测试**——但初版测试 `cad-core.test.ts:40-53` 自己注释写着 `let's just check it's not a cube`，把三个维度 **sort 后只验多重集合 {10,20,30}**，轴序被排序抹掉；此后该断言随 3 次重构原样搬运（`3dd3817` → `b0d35cc`），24 天无人发现。属"测试写错黄金值"，不是没测。

**迁移处置**：`box({size:[a,b,c]})` → `box(a, b, c, {centered:true})`，**不换位**。存量 8 处 vec3 调用迁移后几何会变化（Y/Z 归位）——这是顺带修复 bug，不是迁移事故；§6.3 的"迁移前后 bbox 全等"验收对这 8 处**豁免**，改验"修复后语义 = 文档契约"（X=size[0], Y=size[1], Z=size[2]），并在迁移报告中单列。

**注 2（读码确认，2026-09-05）**：brepjs 的 `at` 语义**在 box 与 cylinder/cone 上不同**（`vendored/brepjs/topology/primitiveFns.ts:80-130`）：

| op | `at` 语义 | 与 `centered` 同给时 |
|---|---|---|
| `box` | **中心**（`translate(base, center - (w/2,d/2,h/2))`） | `at` 优先，`centered` 被忽略（`center = options.at ?? …`）|
| `cylinder`/`cone` | **底面轴心**（`_makeCylinder(r,h,at,axis)`） | `centered:true` 沿 axis 平移 `-h/2` ⇒ **`at` 变成中心语义** |

⇒ 迁移 faijs 的 `center`：**box 写 `{at:c}`；cylinder/cone 写 `{at:c, centered:true}`**。

**验收**：codemod 前后逐文件执行结果比对（bbox + 面数 + roleTable 键集合），全等才算迁移成功；**唯一豁免**：`box({size:[a,b,c]})` 的 8 处 vec3 调用按注 1 修复语义（Y/Z 归位），在迁移报告单列。旧对象形态在迁移后必须抛 `E_ARGS_FORM`（带新写法提示），**不得静默兼容**。

### 6.4 mesh 实现接线（红线，不可省）

`compatOp` 是 **brep-only**（mesh 模式/断链抛错、从不回退）。因此 A 类 op **不能只做投影**，必须是真正的 dual op：

```
cad.box(w,d,h,opts) = defineOp({
  mesh: (w,d,h,opts) => boxMesh(w,d,h,{ ...opts, segments }),
  brep: (w,d,h,opts) => primitiveBox(w,d,h,{ ...opts }) + roleTable + 三角化(segments)
})
```

唯一正确性标准：**与 brep 路径同参 bbox 一致**（`brep-mesh-equivalence.test.ts`）；**默认参数以 §5.0 的 brepjs 基准表为准（锚点、轴、缺省精度三项，逐项一致，差异即实现错误）**。faijs 现有 mesh 基本体已具备全部几何能力，工作是"换入参形态 + 换默认锚点基准 + 缺省精度对齐 standard"，不是重写几何。

### 6.5 roleTable / 面命名必须保留（faijs 特性，不可丢）

换成 brepjs 实现后，两件 vendored 不做的事**必须在投影之后由 faijs 侧补**：
1. `assignRoles(kernel, solid, op)` 建 roleTable（`api/primitives.ts:81-84`）—— 下游 chamfer/knurl/engrave 的选面依赖它；
2. `fromBrep(...)` 登记 brep 链 + 三角化（`segments` 在此透传，§5.2）。

分层：brepjs 负责几何构造，faijs 负责链与命名。**不是打补丁**。

### 6.6 断言 / schema / 符号表

- `assertBoxParams` 等对象参数断言 → 位置参数断言（保留 `api/assert.ts` 原语）；
- `defineOp.schema` 补齐（现只有 box/cylinder 有），供 codegen 与 UI 面板消费；
- `arg-spec.ts` 条目 `skip → brep-op`，重跑 `gen-l3-surface.ts` / `gen-symbol-table.ts` / `gen-api-dts.ts`，保证三源一致（`lang/op-set-consistency.test.ts`）；
- `mesh/api.d.ts` 是**生成文件**，禁止手改。

### 6.7 实施顺序（每批独立可验收）

| 批次 | 内容 | 依赖 |
|---|---|---|
| P0 | **`segments` 统一契约**：三路径透传 + `api/primitives.ts:83` 修正 + brepjs 投影补 `segments?` + 三角化断言测试 | — |
| P1 | `sphere`（语义全等，双形态，UI 零改动） | P0 |
| P2 | `translate`（语义全等，双形态，UI 零改动，补 mesh） | P0 |
| P3 | `box`（UI 三框 + `centered:true` 显式化 + codemod） | P1/P2 的双形态与 mesh 接线模式 |
| P4 | `cone`（同 box，解锁 radiusTop） | P3 |
| P5 | `cylinder`（同 box） | P3 |
| P6 | `scale3d` 改名 + brepjs `scale` 投影 + mesh + UI 分派 | — |
| P7 | `intersect` 分面断言 + `faceCenter` arg-spec 修正 + `rotate` UI 禁令标注 | — |

P3–P5 的 codemod 与 UI 改动**同批提交**，避免出现"引擎已切、UI 还在产老签名"的窗口。

---

## 7. 3d_editor UI 改动清单（裁决 3：全量切新签名；裁决 5：宿主负责居中）

| 文件 | 改动 |
|---|---|
| `src/engine/features/primitive.ts` | `buildArgs` 按 op 输出对应键（cube：`width/depth/height`；cone：`radiusBottom/radiusTop/height`；cylinder：`radius/height`）+ `segments`；**`buildPrimitiveCode` 输出 `positional:[…]`**（维度值按 op 排序），并恒定输出 `args:{ centered: true, at: <placement>, segments? }`（裁决 5 的宿主居中就落在这一行）；`primitiveBackfill` 从 `positional` + `at` 读回，**并修复只回填 number、丢数组键的缺陷（§8.8）**；`primitiveLabel` 改 `W×D×H` |
| `src/engine/primitives/PrimitivePanel.tsx` | `CubeParams` 由 `{size}` 改为 `{width, depth, height}`；三框渲染；cone 增 `radiusTop` 框（解锁圆台）；`paramsToRecord`/`recordToParams` 同步 |
| `src/engine/primitives/placement.ts` | `computePlacement` 返回的中心点坐标改为随代码行输出为 `at`（当前它只算 `{x,y}` 二维 + 屏幕可见性，需补 z 与三元组化；注释中"Place primitive centre"的语义不变） |
| `src/engine/features/transform.ts` | scale 按等比/非等比分派 `scale` / `scale3d` callee；ops 增 `scale3d`；backfill 按 callee 区分标量与数组。translate / sphere **不动**（双形态合法） |
| `src/stores/tools/primitives-store.ts` | `PrimitiveParamsRecord = Record<string, number>` 增键即可，无需改类型 |
| `src/engine/script-engine/*` 与测试 | 生成代码行文本断言（§6.3.1：约 53 处 / 8 个测试文件，机械替换期望串）；真实执行断言（`assembly-transform.test.ts`、e2e 往返）只改入参签名，断言本体不动 |
| `src/fixtures/faqts/clamp-plate.ts`、`test/faijs/*.fai.js` | 5 处脚本调用走 codemod（§6.3） |
| `src/i18n` / locales | 新增 label：`width` / `depth` / `height` / `topRadius` |

UI 不需要改的：`formatCodeLine` / `codeToArgs`（已支持 positional 与 `{positional,args}` 契约）、`FeatureDef` 接口、`computePlacement` 的"选点"算法本身（仍输出中心语义，只是落点变成 `at`）。

**宿主居中的守卫（裁决 5）**：两条几何断言——① UI 生成的 primitive 代码执行后 bbox 中心 ≡ `at`（宿主恒显式 `centered:true`，漏写会漂到第一象限）；② faijs cad 面**裸调用**（无 options）bbox 中心 ≡ `(w/2, d/2, h/2)`（守住"框架零注入"）。不采用代码行文本断言。

---

## 8. 风险与未决问题

1. **默认锚点 —— 已定案（裁决 5）**：faijs 全盘采用 brepjs 裸默认（含 `packages/demo`），**无框架注入**；"基本体都居中"由 **3d_editor 宿主生成层**实现（恒定输出 `centered:true` + `at`）。此前倾向的"框架默认 `centered:true`"（A′）已废弃——它让 `cad.box(10,20,30)` 与 brepjs `box(10,20,30)` 行为不同，属隐性不兼容，与裁决 3 的精神相悖。
   - 风险残留：**漏写 `centered:true` 的后果是新建零件跑到第一象限**。守卫：几何断言（UI 产物 bbox 中心 ≡ `at`；cad 面裸调用 bbox 中心 ≡ `(w/2,d/2,h/2)`），加一条 UI 生成快照测试。
   - faijs 侧影响极小：46 个 `.fai.js` 中需要"保持今天位置"的只有带 `center:` 的 19 处与居中诉求的其余调用点，全部由 codemod 一次性显式化（§6.3.1）；`packages/demo` 同批处理。
2. **`at` 与 `centered` 的交互已读码确认**（不再是待验证项），结论见 §6.3 注 2：box 的 `at` 是中心语义且优先于 `centered`；cylinder/cone 的 `at` 是底面语义，`centered:true` 会把它变成中心语义。迁移 faijs 的 `center` 时两者写法不同。
3. **roleTable 在投影后补建**：`assignRoles` 需要 op 类型与 origin（当前语句 LHS），投影层的 `getCurrentStmt()` 是否可用需在 P1（sphere）验证。
4. **UI 的 `nRadDefault` 与 op 级 `segments` 双来源**：优先级已定（op > UI > 引擎默认 64，§5.0），需在 `mesh/types.ts` 的 clamp 入口统一执行，避免两处各 clamp 一次。
5. **`translate` 双形态下 `codeToArgs` 回填**：positional 与 args 都要读，UI 侧两条路径都需覆盖测试。
6. **`translate` 的 gizmo 提交路径**（`transform-session.ts` 直接调 `ScriptEngine.recordFeature(op, scopedId, args)`）需与 Feature 路径保持一致。
7. **cad 面的 `rotate` 是 brep-only**，UI 不得暴露；本方案只加标注。
8. **`primitiveBackfill` 丢数组（3d_editor 现状缺陷，本次必修）**：`features/primitive.ts:104-108` 只回填 `typeof value === 'number'` 的键，`center`/`at` 等 vec3 数组会被静默丢弃，编辑面板 reopening 后位置丢失。切新签名时一并修（回填 `at` 数组）。

---

## 9. 验收与测试点（提纲）

**分层**
- L0 语言层：`formatCodeLine` / `codeToArgs` 往返 —— 位置形态（含数组字面量 + 尾参 options）打印后解析等价。
- L1 几何层：brep/mesh parity —— 新契约下每个基本体同参 bbox 一致；`centered` / `at` / `segments` 各组合的锚点与三角化断言（角点、底面、中心三组黄金值）。
- L2 运行时：op 分派 —— mesh 模式下所有 A 类 op 必须可执行（**不得出现 `E_MESH_UNSUPPORTED`**）；brep 模式下 roleTable 非空、三角化随 `segments` 变化。
- L3 宿主/UI：面板建 box → 生成代码（含 `centered:true`）→ 回填 → 面板值一致；scale/scale3d callee 切换往返。
- 迁移：codemod 前后脚本执行结果等价（bbox + 面数 + roleTable 键集合）。

**测试点**
1. 每个 A 类 op：brep/mesh 双路径 + 显式 `centered:true` + 默认（角点/底面）覆盖。
2. `sphere` / `translate` 双形态等价性（同参产出几何逐点一致）。
3. `scale` vs `scale3d`：等比分派、非等比分派、backfill 双向。
4. `segments` 三路径消费（§5.4 四条）。
5. cad 面 op 集合快照（`op-set-consistency.test.ts`）随 arg-spec 变更更新。
6. 存量 fixture 回归（46 个 `.fai.js` 迁移后执行结果不变）。
7. **负例**：`box({size:20})` 必须抛 `E_ARGS_FORM` 且错误信息含新写法；`box(10,20,30,{unknownKey:true})` 必须抛 `E_ARGS_FORM`。
