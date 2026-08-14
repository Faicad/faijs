# .faijs 语法设计

> 定位：这是 `.faijs` 的**语法与增量执行契约**（长期有效）。

---

## 0. 需求与约束

1. **`.faijs` 必须是 JavaScript 的合法子集** —— 任意 JS 解析器（acorn）都能无错解析。
2. **禁止 `eval` / `new Function` / 动态 `import()` 真执行** —— 存在安全风险，且会让"子集边界"毫无意义。文本必须**先经语法解析**还原成结构化语句。
3. **人类 UI 建模 与 AI 代码建模 在同一场景上交织**：
   - 人类用鼠标建立方体、钻孔；AI 读代码后写"倒角 4 条边"并交回引擎。
   - AI 可能**追加**语句，也可能**修改**已有语句（如把尺寸翻倍）。
   - AI 执行后人类继续交互（如顶面滚花）。
4. **引擎必须增量执行 + 变更识别**：
   - "尺寸翻倍" → 引擎识别为**参数/参数值变更**，只重算受影响语句；
   - "追加倒角" → 引擎识别为**新增**，仅执行新增后缀；
   - 任意结构性修改 → 引擎识别为**结构变更**，从该点起重放。
5. **语法层必须支持多 mesh（模型间派生 / 合并的 DAG）**，命名采用模型/版本分离的 **partName** 格式（`partN_vM`）。
6. **只有一份代码**：不存在"statement 对象"与"代码文本"两份表示的转化函数——代码文本是 PartScript 的确定性序列化投影（`scriptToCode`/`statementToLine`），parser 与 codegen 双向同构。代码允许注释；**一个操作对应一行代码**（注释/空行不计）。

---

## 1. 核心抽象：PartScript 是唯一事实源

```
            Human UI 操作                 AI 代码 (.faijs 文本)
                 │                              │
                 │ 记录语句                     │ acorn 解析（不执行）
                 ▼                              ▼
        ┌──────────────────────────────────────────────┐
        │  PartScript（场景级单一 DAG）                  │   ← 唯一事实源
        │   平铺语句序列：const part0_v0 = cad.box(…)  │
        │               const {front: part1_v0, back:  │
        │                 part2_v0} = cad.split(…)     │
        │   每条 CadStatement 带 feature.createdBy     │
        │   终端 = 自动推导（未被引用的输出 = 叶子）     │
        └──────────────────────────────────────────────┘
                            │
                            ▼
                CadRuntime.replay（BREP 优先 + 静态切换 mesh）
                            │
                            ▼
                         Scene（单/多 mesh）
```

- **平铺代码格式**：`scriptToCode(script)` 产出纯语句序列——无 `export default` 包裹、无 `return`、无 `apiVersion` 头。语句 id 采用 **partName** 格式（`partN_vM`，模型/版本分离，见 §3）。
- **双向转换**：
  - UI → PartScript → `scriptToCode` → `.faijs` 文本（代码视图）。
  - AI → `.faijs` 文本 → `parseScript`（acorn）→ PartScript。
  - 序列化是**可逆投影**：statement 对象的 `id`=变量名、`inputs`=参数引用、`op`=函数名；parser 能原样解析回来（部分宿主字段如 `seq`/`groupScopedId`/`createdBy` 不进入文本，属宿主层信息）。
- **终端自动推导**：不被任何语句引用为输入的输出即终端（叶子节点）。
- **meta（name/color/metalness/roughness）不进代码文本**：由宿主（3d_editor）store 管理；`.faijs` 文本中不存在 `return { shape, name, color }`。
- **执行永远走 CadRuntime**：`cad.*` 在文本里只是**约定**（合法 JS 子集），应用内执行时 parser 还原为结构化语句。几何由引擎双链路执行（BREP 优先，`MESH_ONLY_OPS = {sdf, knurl}`、mesh 源文件、多输入布尔含 mesh 输入时静态切换 mesh；**禁止运行时回退**）。
- 因此"合法 JS"是**序列化契约**，不是"加载后真跑的代码"。这规避了安全风险，也保留了撤销粒度 / 增量重算 / args 校验（全部挂在 parse-then-execute 链路上）。

---

## 2. 语法规范（合法 JS 子集）

> **语句 id 采用 partName 格式 `partN_vM`：模型（model）与版本（version）是两个独立维度**：
> - **`partN` = 模型编号（第 N 个模型）**，`part0` 是主模型（人类最先建立 / AI 最先编写的那个）。
> - **`vM` = 该模型内的版本号**：`part0_v0` 是 part0 模型的第一个版本，`part0_v1` 是 part0 被加工出的第二个版本（同一模型的不同版本）。
> - 每个模型独立拥有自己的版本链：`part0_v0 → part0_v1 → part0_v2`（同一模型越加工越深）、`part1_v0`（split 出的前半、独立模型）、`part2_v0`（split 出的后半、独立模型）、`part1_v1`（part1 的下一版本）……
> - **`partN_vM` 中第一个下标 N = 模型、第二个下标 M = 版本**。因此：
>   - "同一个模型的不同版本" = 模型号不变、版本号变（`part0_v0 → part0_v1`，二者都是 part0 模型）。
>   - "不同的模型" = 模型号变（`part0_v0` vs `part1_v0`，分属 part0 / part1 两个模型）。
>   - 两种语义在文本上**彻底分开**。

### 2.1 单 mesh 形态（人类友好简写，主模型 part0）

```js
// —— 参数（仅字面量，无表达式；可选）——
const size = 20
const holeD = 5

// —— 语句：同步 op 无 await，异步 op 加 await；输入用变量名引用 ——
// part0_v0 / part0_v1 是「同一个模型(part0)」的两个版本：part0_v0=方体，part0_v1=钻孔后
const part0_v0 = cad.box({ size })
const part0_v1 = await cad.drill(part0_v0, {
  diameter: holeD, depth: 0,                  // depth=0 即通孔（无 type 键）
  position: cad.faceCenter(part0_v0),         // GeomRef：派生位置引用
  direction: 'normal', faceNormal: [0, 0, 1], // direction 是枚举：'normal'|'x'|'y'|'z'
})
```

- 无 `export default` / `async (cad)` 包裹、无 `return`。`part0_v1` 未被任何语句引用 → **自动成为终端**。
- 参数声明（`const size = 20`）解析为 `script.params`（ParamDef）；引用处解析为 ParamRef，执行前求值。文本保留参数声明行。
- 一个操作一行代码；注释随意（不占操作行）。

### 2.2 多 mesh 形态 = 单一 PartScript DAG，模型与版本分离命名（partName）

多 mesh **不是**"互相独立的平行 part 数组"，也**不是**把所有 mesh 平铺进同一个版本池。
- 反例：`const part0_v0=box; const {front:part0_v1,back:part0_v2}=split(part0_v0,…)`——`part0_v1`/`part0_v2` 是 split 出来的**两个不同模型**，却用了"同一模型(part0)的版本"命名，与 `part0_v0`/`part0_v1`="同一模型版本"的语义撞车。
- 正解：整场景是**一张 DAG**；每份"不同的模型"拿到自己的模型号 `partN`，其演化用 `partN_vM` 版本链。"同一个模型的不同版本"（如 part0_v0→part0_v1）与"不同的模型"（如 part0_v0 vs part1_v0）在命名上彻底分开。

```js
// —— 主模型 part0：版本链 part0_v0 → part0_v1 → part0_v2（同一个模型越加工越深）——
const part0_v0 = cad.box({ size: 20 })
const part0_v1 = await cad.drill(part0_v0, { diameter: 5, depth: 0, position: cad.faceCenter(part0_v0), direction: 'normal', faceNormal: [0, 0, 1] })
const part0_v2 = await cad.extrude(part0_v1, { length: 3 })

// —— 分割 part0 当前版本 part0_v2 → 两个【不同模型】part1(前) / part2(后) ——
// 注意：front/back 各自拿到新模型号 part1 / part2，版本从 _v0 起算，绝不写 part0_v1/part0_v2
const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v2, { normal: [0, 0, 1], offset: 0, cutMode: 'plane' })

// —— part1 演化：part1_v1（模型 part1 的版本 1）——
const part1_v1 = await cad.drill(part1_v0, { diameter: 3, position: cad.faceCenter(part1_v0) })
// —— part2 演化：part2_v1（knurl 是同步 mesh-only op，无 await；参数见 args-schema）——
const part2_v1 = cad.knurl(part2_v0, { knurlTextureHeight: 0.5, knurlScaleU: 0.15, knurlScaleV: 0.15, knurlInvertDisplacement: false })

// —— 新独立模型 part3 ——
const part3_v0 = cad.cylinder({ radius: 5, height: 40 })

// —— part1 当前版本 ∪ part3 → 新模型 part4 ——
// 现状：布尔合并产出新模型 partN（与 allocate-id 一致）；「布尔跟随主体」的决策见 reconciliation 文档 §2.1
const part4_v0 = await cad.union(part1_v1, part3_v0)

// —— 终端集合（自动推导，无 return）：未被引用的输出 part2_v1、part4_v0 ——
```

- **模型号 `partN` 的分配规则**：`part0` 即主模型；每出现一个"非 part0 来源"分配下一个 `partN`：split 一次产出 `partN`(front) 与 `part(N+1)`(back)；独立新图元（如 `cylinder`）分配下一个 `partN`；布尔合并产出新 `partN`（现状，待决策，见 reconciliation §2.1）。具体编号由 codegen / 分配器顺序决定，引擎只认 id 文本，不依赖编号大小。
- 终端 mesh = 未被引用的输出（叶子）。被作为后续输入的 mesh 视为中间产物，不单独入场景。
- 不存在 `build` 闭包 / `parts[i]` 跨作用域引用：所有 mesh 在同一 DAG，跨模型引用就是直接写对方的 id（如 `union(part1_v1, part3_v0)`）。UI 路径与 AI 路径天然同构——人类在 UI 里 split，引擎追加 `const {front:partN_v0,back:partM_v0}=cad.split(part0_vK,…)` 到同一脚本即可。
- 语法是完整 DAG：split / 布尔 / 多终端在语法层完整支持。

### 2.3 形态清单（缺一不可、多一不可）

```
script   = ( <comment> | <param> | <stmt> | <marker> )*
comment  = // 单行注释（不占操作行）
param    = const <name> = <literal>                                              // 参数：字面量（数/串/布尔/数组/对象/负数）
stmt     = const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { <key>:<val>, … })                       // 版本链语句
         | const part<N>_v<M> = [await] cad.<union|subtract|intersect>(<inputVar>, <inputVar>, …)        // 布尔（多输入）
         | const { front: part<N>_v<M>, back: part<O>_v<M> } = [await] cad.split(<inputVar>, { … })      // 多输出
marker   = cad.group(<obj>) | cad.assembly(<obj>)                                                 // 裸调用，不赋值
```

- 平铺语句序列；无 `export default` / `async (cad)` 包裹。
- `// apiVersion: N` 注释**可选**（缺省 1）。
- 异步/同步以 `src/mesh/api.d.ts`（由 args-schema 生成）为准：**异步 op 加 `await`**（drill / split / union / subtract / intersect / extrude / engrave / load / sdf / text / screw / svgExtrude），**同步 op 不加**（box / sphere / cylinder / cone / wedge / translate / rotate / scale / knurl）。
- 输入引用 = **变量名**（`part0_v0`、`part1_v1`），即该语句的 `id`；boolean 的输入为多个变量名。
- 对象字面量一律用 `:`（不是 `=`）。

### 2.4 子集边界（"方便 parse"的收敛规则）

**允许**：
- `const <name> = <literal>`（字面量，含负数 `-5`；无表达式、无函数调用）
- 版本链语句（任意模型）：`const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { key: val, … })`
- boolean 多输入：`[await] cad.union/subtract/intersect(<inputVar>, <inputVar>, …)`
- 多输出 op 的受限解构：`const { front: part<N>_v<M>, back: part<O>_v<M> } = [await] cad.split(<inputVar>, { … })`（keys 必须是该 op 声明的输出名，如 split 的 `front`/`back`；**每个输出拿到各自的模型号 partN / partO**）
- GeomRef helper：`cad.faceCenter(<id>)` / `cad.faceNormal(<id>)` / `cad.bboxCenter(<id>)` / `cad.bboxMin(<id>)` / `cad.bboxMax(<id>)`（输入为任意模型版本 id；`faceCenter`/`faceNormal` 可携带 `[anchorPoint]` 与 `faceOrdinal` 第三参，见 §3 映射表）
- `cad.asset('key')`（AssetRef：SVG/XML 等大段文本由 AssetResolver 按 key 解析）
- 结构型 marker 裸调用：`cad.group(<obj>)` / `cad.assembly(<obj>)`（不赋值、不参与执行；args 仅限字面量/参数/GeomRef，**不支持引用语句 id**——`members: [part0_v0]` 会报 unknown identifier，成员关联能力待后续版本）
- 单行注释（`//`）

**禁止**（任何一个出现即 `ParseError`，并让 acorn 抛错 → 证明非法）：
- `param` / `with` 关键字、`export default x with {…}`、对象字面量用 `=`。
- 循环 / 条件（`if`/`for`/`while`/`switch`）、IIFE、`try/catch`、模板字符串、动态属性名。
- 解构（**仅允许**多输出 op 的受限形式 `const { front: partM_v0, back: partO_v0 } = await cad.split(...)`；其余解构一律禁止）。
- 顶层 `import` / `require` / `eval` / `new Function` / 远程拉包。
- `$xxx` 形式引用（参数统一用裸标识符）。
- 多 default export、跨语句重名 `const`、函数定义。
- 裸表达式语句（除 `cad.group(...)` / `cad.assembly(...)` 调用外）。
- **把"不同模型"误命名为"同一模型的版本"**：如 `const { front: part0_v1, back: part0_v2 } = split(...)`（split 输出是两个不同模型，必须用各自模型号 part1 / part2，不得占用主模型 part0 的版本链 `part0_v1`/`part0_v2`）。更完整的命名语义规则（新模型必须 `partN_v0`、版本严格递增、加工类跟随输入模型等）见 `docs/plans/2026-08-13-naming-validator-design.md` —— **该校验尚未实现**，当前 parser 不强制 id 格式（`const foo = cad.box(...)` 也能通过），见 reconciliation §2.2。

合法性证明（J-1）= 一道闸门：`acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })` 不抛错即合法；抛错即 codegen bug。

### 2.5 标识符命名约束（关键字黑名单）——可读性约束

本条约束的是**本项目生成/拥有的代码**，具体指：
- `codegen` 输出的所有标识符（`const <name> = …` 的变量名、渲染为 `const <name> = <literal>` 的参数名）；
- 引擎自身的固定词汇（`cad.box` / `cad.drill` / `cad.load` / `cad.split` / `faceCenter` 等 op 与 helper 名）。

上述标识符**不得**是以下任一门语言的保留关键字：
- **JavaScript**（含严格模式/模块保留字）、**Python 3**、**C**（C11）、**Java**。

仅仅是可读性要求。

---

## 3. 语句模型 ↔ `CadStatement` 映射

现有 `CadStatement = { id, op, args, inputs, name?, feature, isMarker?, model?, outputs?, seq?, groupScopedId? }`（`types.ts`）。**parser 只填充 `id`/`op`/`args`/`inputs`/`feature`（`createdBy:'script'`）/`outputs`（split）**；`model`/`seq`/`groupScopedId` 由宿主层（3d_editor）填充。映射规则：

| 文本（平铺） | PartScript |
|------|-----------|
| `const size = 20` | `script.params += { name:'size', type:'number', value:20, default:20 }`；引用处解析为 ParamRef `{ $param:'size' }`（**不折叠**，执行前求值） |
| `const part0_v0 = cad.box({ size })` | `{ id: 'part0_v0', op: 'box', args: { size: { $param: 'size' } }, inputs: [], feature: { kind: 'primitive', label: 'box', createdBy: 'script' } }` |
| `const part0_v1 = await cad.drill(part0_v0, {…})` | `{ id: 'part0_v1', op: 'drill', args: {…}, inputs: ['part0_v0'] }` |
| `cad.faceCenter(part0_v0)` | `args.position = GeomRef { $geom: { of: 'part0_v0', feature: 'faceCenter', faceOrdinal?: <n>, anchor?: { point } } }`（`faceOrdinal` 为拓扑面序号引用，优先于 `anchor` 几何反查；`anchor.normal` 类型存在但文本无法表达） |
| `const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v2, {…})` | `{ id: 'part1_v0', op: 'split', args: {…}, inputs: ['part0_v2'], outputs: ['part1_v0','part2_v0'] }`（一个语句、两个输出 id；`front`→`part1` 模型、`back`→`part2` 模型） |
| `const part4_v0 = await cad.union(part1_v1, part3_v0)` | `{ id: 'part4_v0', op: 'boolean', args: { operation: 'union' }, inputs: ['part1_v1','part3_v0'] }`（多输入；codegen 渲染回 `cad.union(...)`；subtract/intersect 同构） |
| `cad.group({ name, members })` | `{ id: 'grp_N', op: 'group', args: {…}, inputs: [], feature: { kind: 'group', …, createdBy: 'script' }, isMarker: true }`（marker 不参与执行、不写终端；assembly 同构） |
| 终端（自动推导，无 return） | `PartScript.terminalShapes = [ { id: 'part2_v1' }, { id: 'part4_v0' } ]`（未被引用的输出；单终端时等价单 mesh，meta 由宿主提供） |
| 提交来源（UI / AI） | `feature.createdBy = 'user' \| 'ai'`（parser 统一产 `'script'`；宿主按提交上下文 / diff 继承重标，非语法） |

**`id` 全局唯一 + 模型/版本分离（partName 体系，关键决策）**：
- 每个模型 `partN` 拥有独立版本链 `partN_v0, partN_v1, …`。`part0` 是主模型；`part1`/`part2`/… 是 split / 独立图元 / 布尔派生的其它模型。
- 所有语句 `id`（`part0_v0`、`part1_v0`、`part2_v1`…）在整场景中**全局唯一**——模型号不同天然不冲突（`part0_vN` 与 `part1_vM` 永不撞）。
- 人类 UI 路径记录语句时即按上述规则分配 id（主模型 append `part0_vN`、split 产出 `partN_v0`/`part(N+1)_v0`、独立新图元 `partN_v0`）；AI 文本路径 parser 也产出同样形态。两条路径因此能用**同一套 id 方案**对齐，diff 才能工作（见 §4）。`st_*` 仅用于 load/sdf 等非可编辑来源；`grp_N` 仅用于 group/assembly marker。
- `model?: string`（= id 中的模型号，如 `'part0'`/`'part1'`，供时间轴/代码视图按模型分组）与 `outputs?: string[]`（默认 `[id]`：普通 op `outputs=[id]`，split 多输出写入 `['part1_v0','part2_v0']`）。`outputCache` 按 **output id** 索引，下游用具体输出 id（`part1_v0`/`part2_v0`）引用。`model` 当前由宿主填充（parser 不产出，见 reconciliation §2.3）。

> 理由：引擎用 `stmt.id` 作 `outputCache` 键、用 `inputs` 引用其它语句。把"模型"与"版本"拆成 `partN_vM` 两个命名维度后，split / 新图元 / 布尔产物各自拿到不冲突的模型号 `partN`——diff 只需按 id 对齐，不看编号池。

**`id` 身份契约（§4 能工作的前提）**：所有语句 id（均为 `partN_vM` 形态）同时是"身份"和"顺序"。双方约定：
- 既有语句的 id **不得重命名、不得重排**；只能就地改 `args` 值（参数变更）或改 `op`（结构变更）。
- 新增特征分配**下一个未用 id**：主模型追加用下一个 `part0_vN`，新模型用下一个 `partN_v0`；不得复用已删除的 id（避免碰撞）。
- 删除特征 = 该 id 整行移除（见 §4.2 DELETE）。
- 此契约对 **AI 是 prompt 级约束**（写进代码生成 system prompt），对 UI 是引擎自身保证（append 即分配新 id）。引擎侧可检测"id 顺序与出现顺序不一致"并警告，但不依赖它做对齐——对齐始终以 id 为准。
- ⚠️ 现状：parser **不强制** id 必须 `partN_vM`（命名语义校验未实现，`const foo = cad.box(...)` 可通过 parse + check），见 reconciliation §2.2。

---

## 4. AI 代码生成模型 与 引擎增量执行机制（核心 HOW）

### 4.1 AI 如何生成代码：**总是全量，不生成 patch**

AI 的产出模型是**全量覆盖式 `.faijs` 文本**，不是结构化 diff/patch。理由：

1. **LLM 最擅长生成完整可运行代码，最难可靠生成结构化 patch**（patch 格式易不一致、易漏改依赖）。
2. **增量识别的职责放在引擎侧**（确定性算法），比依赖 AI 的 patch 格式更稳。
3. 这正好匹配需求原话"人类说把尺寸翻倍，AI 只需去更改原先的尺寸参数"——在"全量生成"视角下，就是 AI **保留 `part0_v0` 这行、只改它 `size` 的值**，而非输出一段"把 part0_v0.size 改成 40"的补丁。

AI 提交的契约（写进代码生成 system prompt）：
- 读取当前 `.faijs` **全文**（含所有 `partN_vM` 语句，平铺格式）。
- 输出**完整新全文**（平铺格式）：保留所有既有语句（除非用户要求删除该特征），仅在既有行改值/改 op，新增特征用下一个连续 id（`partN_vM`，依所属模型而定）。
- 不得重排、不得重命名既有 id（见 §3 身份契约）。
- `// apiVersion: N` 注释可选（默认 1）；不输出 `export default` / `return`。

> 由此，AI 提交 = "一次完整重写"，引擎负责"和上次提交比对，找出改了什么"。AI 无需理解 diff 算法，引擎无需信任 AI 的意图描述——**全部基于解析后的 PartScript 做客观比对**。

### 4.2 引擎如何知道"哪些修改 / 哪些新增 / 哪些删除"

引擎持久保存**上一次已提交的 PartScript**（`committedPartScript`，场景级单一 DAG，存于宿主 store）。新提交到达时：

**Step 1 — 解析**：`acorn.parse`（合法性闸门，抛错即拒绝整个提交）→ `parseScript` → 新 `PartScript`（`newStmts`，ids = `partN_vM`）。

**Step 2 — 按 id 建立双映射**：
```
oldById = map(stmt.id -> stmt)   // committedPartScript
newById = map(stmt.id -> stmt)   // 新 PartScript
```

**Step 3 — 逐条分类**（以 newStmts 的声明顺序遍历，同时对照 oldById）：
| 判定 | 条件 | 类别 |
|------|------|------|
| 双方都有同一 id，`op` 与 `args` 完全相同 | `oldById[id] == newById[id]` | **UNCHANGED** |
| 双方都有同一 id，`op` 相同但 `args` 值不同 | `op` 同，`args` 异 | **PARAM 变更** |
| 双方都有同一 id，`op` 不同 | `op` 异 | **STRUCT 变更** |
| 仅在新脚本中有（oldById 无此 id） | 新增 id | **ADD** |
| 仅在旧脚本中有（newById 无此 id） | 消失 id | **DELETE** |

> "args 值不同"指序列化后的 JSON 字符串不同（含 ParamRef/GeomRef 展开后）。内容比对用 `computeContentKey`，与 `editParam` 现有机制同源（J-2 保真）。

**Step 4 — 定位首个变更点**：
```
firstChange = min(
  indexOf(首个 PARAM/STRUCT/ADD 语句),
  indexOf(首个被 DELETE 的语句在旧链中的位置)
)
```
线性链下，从 `firstChange` 起的所有语句（及其下游）均需重放。

### 4.3 重放规则

1. 引擎为场景维护一个**持久 `outputCache`**（key = 语句 output id），跨提交存活。
2. 遍历新链：
   - **UNCHANGED** → 不重算，直接复用 `outputCache[id]` 中的几何（供下游引用）。
   - **PARAM / STRUCT / ADD** → 从 `firstChange` 起执行 `executeStatement`；其结果写入 `outputCache`；其下游因读取到新结果而自动失效、随 suffix 重放。
   - **DELETE** → 该 id 的 `outputCache` 失效；其下游（旧链中引用它的语句）在本次重放中已被 STRUCT/ADD 覆盖或一并失效。
3. 重放沿用宿主 `ScriptEngine.replayPart` 逻辑；失败沿用现有 statement 模式：保留前 k-1 条成功语句。
4. 重放成功 → 新 `PartScript` 写回 store 作为下一次提交的 `committedPartScript`；`feature.createdBy` 按提交上下文标注（UI 提交='user'，AI 提交='ai'，行内来源由 parser 从既有 PartScript 继承——见 §4.4）。

**DAG 相关补充**：
5. **split 多输出**：split 语句 `id='part1_v0', outputs=['part1_v0','part2_v0']`，`outputCache` 同时存 part1_v0、part2_v0。`part1_v0` 这条 PARAM/STRUCT 变更 → 从它起重放，两个输出一并重算；下游引用 part1_v0 或 part2_v0 的语句随 suffix 失效重放。
6. **DELETE 级联 / 孤儿**：若某语句被删且其输出仍被下游引用（如删了 split 但保留了 `drill(part1_v0)`），下游语句的 `inputs` 指向不存在的 id → 视为**孤儿**。推荐处理：直接 `ParseError` 拒绝提交（因为全量生成的 AI 通常一并删除下游，孤儿多代表 AI 违反身份契约）；若确需级联，则把孤儿语句一并判为 DELETE 并级联其下游。

### 4.4 为什么"保留 id"让增量成立 + AI/UI 来源如何继承

- **增量成立的前提**就是 §3 身份契约：引擎**只靠 id 对齐**，不看行号位置。所以 AI 改 `part0_v0.size` 时，只要 `part0_v0` 这个 id 保留，引擎就识别为"part0_v0 的参数变更"而非"删了 part0_v0 加了新东西"。若 AI 违反契约重命名 `part0_v0→part0_v9`，引擎会判成"删 part0_v0 + 加 part0_v9"——功能上可能仍能跑，但丢失了"参数变更"语义、且下游 `inputs:['part0_v0']` 全部断引用报错。**所以 id 身份契约是硬约束，不是建议。**
- **`createdBy` 来源继承**：`parseScript` 解析新文本时本身**看不出**某行是 user 还是 ai（语法里不含此信息）。因此宿主在做 diff 时，对"UNCHANGED / PARAM / STRUCT"的既有 id，**从 `oldById[id]` 继承 `feature.createdBy`**；只有 **ADD** 的新 id 才标为本次提交的来源（AI 或 UI）。这样"哪些步骤是 AI 生成的"能在时间轴/代码视图正确延续，不会因为一次全量重写就丢失历史来源。

### 4.5 场景对照（验证机制）

| 场景 | AI 改动（全量文本） | diff 判定 | 重放范围 |
|------|---------|-----------|----------|
| 把正方形尺寸翻倍 | 保留 `part0_v0=box`，改 `size 20→40` | `part0_v0` PARAM 变更 | 重算 `part0_v0`，`part0_v1(drill)`/`part0_v2(extrude)` 随 suffix 重放 |
| 给零件加高（追加） | 保留 `part0_v0/part0_v1`，末尾加 `part0_v2=extrude(part0_v1,…)` | `part0_v2` ADD | 只执行 `part0_v2`（`part0_v0/part0_v1` 命中缓存） |
| 把钻孔改成雕刻文字（改 op） | 保留 `part0_v1`，改 `op drill→engrave` | `part0_v1` STRUCT 变更 | 从 `part0_v1` 起重放 |
| 人类滚花顶面（UI 追加） | UI 追加 `part0_v3=knurl(part0_v2,…)` | `part0_v3` ADD | 只执行 `part0_v3` |
| **多 mesh：前半(加高) ∪ 新立柱** | 保留 `part0_v0..part0_v2`，加 `part1_v0/part2_v0=split(part0_v2)`、加 `part1_v1=drill(part1_v0)`、加 `part3_v0=cylinder(...)`、`part4_v0=union(part1_v1,part3_v0)` | `part1_v0/part2_v0/part1_v1/part3_v0/part4_v0` ADD | 只执行这些新增（`part0_v0..part0_v2` 命中缓存；跨模型引用 `part1_v0`/`part1_v1` 直接命中） |

---

## 5. 人类 UI ↔ AI 交织流程

**人类钻孔（UI）**：
1. 用户点击面 → 引擎根据交互派生 args（position/normal/direction…）。
2. `useScriptStore.appendStatement(scopedId, stmt)`，`stmt.id = 'part0_vN'`（主模型版本链）、`feature.createdBy = 'user'`。
3. `replayPart` 增量重算，`outputCache` 更新。
4. `scriptToCode(sceneScript)` 回写 `.faijs` 全文（代码视图同步）。

**AI 倒角（代码）**：
1. AI 读取当前 `.faijs` 全文（平铺：含 `part0_v0=box`、`part0_v1=drill`）。
2. AI 输出全量新全文：保留 `part0_v0/part0_v1`，追加新语句（如 `part0_v2=extrude(part0_v1,…)`），交回引擎。
3. `acorn` 解析（合法闸门）→ `parseScript` → 与 store 中 `committedPartScript` **按 id diff**（§4.2）。
4. 判定新语句为 ADD → 只执行新增（既有语句命中缓存）→ `commitGeometry`。新增语句 `feature.createdBy='ai'`（ADD 继承本次来源），既有语句继承历史来源。

两条路径**收敛到同一个 PartScript**，引擎只认 PartScript；人类和 AI 永远在改同一份事实源。

---

## 6. 场景走查（端到端，主模型 part0 版本链）

| 步骤 | 操作来源 | .faijs 关键变化 | diff 类型 | 引擎动作 |
|------|----------|-----------------|-----------|----------|
| 0 | 人类 | `part0_v0 = cad.box({ size: 20 })` | — | 建立方体（模型 part0 版本 0） |
| 1 | 人类 | `part0_v1 = await cad.drill(part0_v0, {…faceCenter(part0_v0)…})` | 新增 | 钻孔（模型 part0 版本 1） |
| 2 | AI | 追加 `part0_v2 = await cad.extrude(part0_v1, { length: 3 })` | 新增 `part0_v2` | 仅执行加高 |
| 3 | AI | `part0_v0.box.args.size 20→40`（保留 `part0_v0` id） | `part0_v0` 参数变更 | 重算 `part0_v0`，`part0_v1/part0_v2` 随 suffix 重放 |
| 4 | 人类 | 追加 `part0_v3 = cad.knurl(part0_v2, { knurlTextureHeight: 0.5 })` | 新增 `part0_v3` | 仅执行滚花 |

> 注意：`part0_v0`/`part0_v1`/`part0_v2`/`part0_v3` 始终是**同一个模型（part0）的版本链**；多模型语法不得破坏这个语义。

每一步提交后，未被变更的前缀（`part0_v0` 在步骤 2/4；`part0_v0/part0_v1` 在步骤 4）都**命中持久缓存、不重算**。
