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
5. **语法层必须支持多 mesh（模型间派生 / 合并的 DAG）**，命名采用模型/版本分离的 `partN_vN`。多 mesh 的语法结构从第一天就按"单一 PartScript DAG、模型与版本分离命名（`partN_vN`）"设计。

---

## 1. 核心抽象：PartScript 是唯一事实源

```
            Human UI 操作                 AI 代码 (.faijs 文本)
                 │                              │
                 │ 记录语句                     │ acorn 解析（不执行）
                 ▼                              ▼
        ┌──────────────────────────────────────────────┐
        │  PartScript (part0_v0, part0_v1, … /           │  ← 唯一事实源
        │              part1_v0, part2_v1, …)            │
        │   每条 CadStatement 带 createdBy: 'user'|'ai'   │
        │   每条带 model 字段标注所属模型                  │
        └──────────────────────────────────────────────┘
                            │
                            ▼
                 executeStatement (replay-validator → cad-core，R-1 单一实现)
                            │
                            ▼
                         Scene (单/多 mesh)
```

- **双向转换**：
  - UI → PartScript → `scriptToCode`（codegen） → `.faijs` 文本（代码视图）。
  - AI → `.faijs` 文本 → `parseScript`（acorn） → PartScript。
- **引擎永远只认 PartScript**，执行永远走 `executeStatement`。`cad.*` 在文本里只是**约定**，应用内执行时 parser 直接 strip，真实几何仍在 `replay-validator`（单一实现 R-1）。
- 因此"合法 JS"是**序列化契约**，不是"加载后真跑的代码"。这规避了安全风险，也保留了撤销粒度 / 增量重算 / args 校验（全部挂在 parse-then-execute 链路上）。

---

## 2. 语法规范（合法 JS 子集）

> **模型（model）与版本（version）是两个独立维度，统一用 `partN_vN` 命名**：
> - **`partN` = 模型编号（第 N 个模型）**，`part0` 是主模型（人类最先建立 / AI 最先编写的那个）。
> - **`vM` = 该模型内的版本号**：`part0_v0` 是 part0 模型的第一个版本，`part0_v1` 是 part0 被加工出的第二个版本（同一模型的不同版本）。
> - 每个模型独立拥有自己的版本链：`part0_v0 → part0_v1 → part0_v2`（同一模型越加工越深）、`part1_v0`（split 出的前半、独立模型）、`part2_v0`（split 出的后半、独立模型）、`part1_v1`（part1 的下一版本）……
> - **`partN_vN` 中第一个下标 N = 模型、第二个下标 M = 版本**。因此：
>   - "同一个模型的不同版本" = 模型号不变、版本号变（`part0_v0 → part0_v1`，二者都是 part0 模型）。
>   - "不同的模型" = 模型号变（`part0_v0` vs `part1_v0`，分属 part0 / part1 两个模型）。
>   - 两种语义在文本上**彻底分开**，不再有 `vN` / `mK_N` 两套命名。

### 2.1 单 mesh 形态（人类友好简写，主模型 part0）

```js
// apiVersion: 1
export default async (cad) => {
  // —— 参数（仅字面量，无表达式）——
  const size = 20
  const holeD = 5

  // —— 语句：同步 op 无 await，异步 op 加 await；输入用变量名引用 ——
  // part0_v0 / part0_v1 是「同一个模型(part0)」的两个版本：part0_v0=方体，part0_v1=钻孔后
  const part0_v0 = cad.box({ size })
  const part0_v1 = await cad.drill(part0_v0, {
    diameter: holeD, depth: 0, type: 'through',
    position: cad.faceCenter(part0_v0),       // GeomRef：派生位置引用
    direction: [0, 0, 1], faceNormal: [0, 0, 1],
  })

  // —— 零件属性只在 return 里 ——
  return { shape: part0_v1, name: "支架底板", color: "#4A90D9", metalness: 0.1, roughness: 0.8 }
}
```

> `part0_v0`/`part0_v1` 是同一模型（part0）的版本链（part0_v1 = part0_v0 加工后）。这与旧契约"vN 是一个模型的不同版本"语义完全一致，只是显式写出了模型号 `part0`。

### 2.2 多 mesh 形态 = 单一 PartScript DAG，模型与版本分离命名（`partN_vN`）

**关键纠正（来自评审）**：多 mesh **不是**"互相独立的平行 part 数组"，也**不是**把所有 mesh 平铺进同一个版本池。
- 错例（已否决）：`const part0_v0=box; const {front:part0_v1,back:part0_v2}=split(part0_v0,…)`——这里 `part0_v1`/`part0_v2` 是 split 出来的**两个不同模型**，却用了"同一模型(part0)的版本"命名 `part0_v1`/`part0_v2`，和 `part0_v0`/`part0_v1`="同一模型版本"的语义撞车。
- 正解：整场景是**一张 DAG**；每份"不同的模型"拿到自己的模型号 `partN`，其演化用 `partN_vM` 版本链。这样"同一个模型的不同版本"（如 part0_v0→part0_v1）与"不同的模型"（如 part0_v0 vs part1_v0）在命名上彻底分开。

```js
// apiVersion: 1
export default async (cad) => {
  // —— 主模型 part0：版本链 part0_v0 → part0_v1 → part0_v2（同一个模型越加工越深）——
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = await cad.drill(part0_v0, { diameter: 5, position: cad.faceCenter(part0_v0), direction: [0,0,1], faceNormal: [0,0,1] })
  const part0_v2 = await cad.chamfer(part0_v1, { edges: [0,1,2,3], radius: 2 })

  // —— 分割 part0 当前版本 part0_v2 → 两个【不同模型】part1(前) / part2(后) ——
  // 注意：front/back 各自拿到新模型号 part1 / part2，版本从 _v0 起算，绝不写 part0_v1/part0_v2
  const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v2, { normal: [0,0,1], offset: 0, cutMode: 'plane' })

  // —— part1 演化：part1_v1（模型 part1 的版本 1）——
  const part1_v1 = await cad.drill(part1_v0, { diameter: 3, position: cad.faceCenter(part1_v0) })
  // —— part2 演化：part2_v1 ——
  const part2_v1 = await cad.knurl(part2_v0, { face: 'top' })

  // —— 新独立模型 part3 ——
  const part3_v0 = cad.cylinder({ radius: 5, height: 40 })

  // —— part1 当前版本 ∪ part3 → 新模型 part4 ——
  const part4_v0 = await cad.union(part1_v1, part3_v0)

  // —— 终端 mesh 集合（每个终端 mesh 带独立 name/color）——
  return [
    { shape: part2_v1, name: "后半·滚花", color: "#4A90D9", metalness: 0.1, roughness: 0.8 },
    { shape: part4_v0, name: "前半∪立柱", color: "#E67E22", metalness: 0.2, roughness: 0.6 },
  ]
}
```

- **模型号 `partN` 的分配规则**：`part0` 即主模型；每出现一个"非 part0 来源"分配下一个 `partN`：split 一次产出 `partN`(front) 与 `part(N+1)`(back)；独立新图元（如 `cylinder`）分配下一个 `partN`；布尔合并产出新 `partN`。具体编号由 codegen 顺序决定，引擎只认 id 文本，不依赖编号大小。
- 终端 mesh = `return` 里列出的 `shape` 所指向的 id（场景里最终存在的 mesh；被作为后续输入的 mesh 视为中间产物，不单独入场景）。
- 单 mesh 简写 `return { shape: part0_vN, meta }` 等价于 `return [ { shape: part0_vN, meta } ]`。
- 不再有 `build` 闭包 / `parts[i]` 跨作用域引用：所有 mesh 在同一 DAG，跨模型引用就是直接写对方的 id（如 `union(part1_v1, part3_v0)`）。UI 路径与 AI 路径天然同构——人类在 UI 里 split，引擎追加 `const {front:partN_v0,back:partM_v0}=cad.split(part0_vK,…)` 到同一脚本即可。
- 语法已是完整 DAG，split / 布尔 / 多终端 return 都已在语法层完整支持。

### 2.3 形态清单（缺一不可、多一不可）

```
// apiVersion: 1
export default async (cad) => <body>
body   = {
  const <name> = <literal>                                         // 参数：字面量（数/串/布尔/数组/对象）
  const part<M>_v<N> = [await ]cad.<op>(<inputVar>?, { <key>:<val>, … })          // 版本链语句（模型 M 的第 N 版）
  const { <outKey>: part<M>_v<N>, <outKey2>: part<O>_v<N> } = await cad.<multiOutputOp>(<inputVar>?, { … })  // split 等多输出 op
  return part<M>_v<N> | { shape: part<M>_v<N>, name?, color?, metalness?, roughness? }
       | [ { shape: <id>, name?, color?, metalness?, roughness? }, … ]             // 多 mesh 终端集合
}
```

- 单一 `export default` 一个 `async (cad) => …` 箭头函数；绝不多 default、绝不用 `with`。
- 对象字面量一律用 `:`（不是 `=`）。
- 输入引用 = **变量名**（`part0_v0`、`part1_v1`），即该语句的 `id`。
- `await` 仅在 async op 出现；同步 op 不加（清单见 plan §4.4，与 cad-core 实际签名一致）。
- 首行 `// apiVersion: 1` 保留作迁移锚点。

### 2.4 子集边界（"方便 parse"的收敛规则）

**允许**：
- `const <name> = <literal>`（字面量；无表达式、无函数调用）
- 版本链语句（任意模型）：`const part<M>_v<N> = [await] cad.<op>(<inputVar>?, { key: val, … })`
- 多输出 op 的受限解构：`const { <outKey>: part<M>_v<N>, <outKey2>: part<O>_v<N> } = await cad.<multiOutputOp>(<inputVar>?, { … })`（keys 必须是该 op 声明的输出名，如 split 的 `front`/`back`；**每个输出拿到各自的模型号 partM / partO**）
- `cad.faceCenter(part0_v0)` / `cad.faceCenter(part1_v1)` / `cad.faceNormal(…)` / `cad.bboxCenter(…)`（GeomRef helper，输入可为任意模型版本 id；`faceCenter`/`faceNormal` 可携带 `faceOrdinal` 拓扑序号引用，见 §3 GeomRef 映射）
- `return part<M>_v<N>` / `return { shape: <id>, name, color, metalness, roughness }` / `return [ { shape: <id>, name?, color?, metalness?, roughness? }, … ]`
- `// apiVersion: N` 注释

**禁止**（任何一个出现即 `ParseError`，并让 acorn 抛错 → 证明非法）：
- `param` / `with` 关键字、`export default x with {…}`、对象字面量用 `=`。
- 循环 / 条件（`if`/`for`/`while`/`switch`）、IIFE、`try/catch`、模板字符串、动态属性名。
- 解构（**仅允许**多输出 op 的受限形式 `const { front: partM_v0, back: partO_v0 } = await cad.split(...)`；其余解构一律禁止）。
- 顶层 `import` / `require` / `eval` / `new Function` / 远程拉包。
- `$xxx` 形式引用（与 `ParamRef` 的 `$<name>` 正则撞车；参数统一用裸标识符）。
- 多 default export、跨语句重名 `const`、函数定义（除顶层 `export default` 箭头外）。
- **把"不同模型"误命名为"同一模型的版本"**：如 `const { front: part0_v1, back: part0_v2 } = split(...)`（split 输出是两个不同模型，必须用各自模型号 part1 / part2，不得占用主模型 part0 的版本链 `part0_v1`/`part0_v2`）。

合法性证明（J-1）= 一道闸门：`acorn.parse(body, { ecmaVersion: 'latest', sourceType: 'module' })` 不抛错即合法；抛错即 codegen bug。

### 2.5 标识符命名约束（关键字黑名单）——可读性约束

本条约束的是**本项目生成/拥有的代码**，具体指：
- `codegen` 输出的所有标识符（`const <name> = …` 的变量名、渲染为 `const <name> = <literal>` 的参数名）；
- 引擎自身的固定词汇（`cad.box` / `cad.drill` / `cad.load` / `cad.split` / `faceCenter` 等 op 与 helper 名）。

上述标识符**不得**是以下任一门语言的保留关键字：
- **JavaScript**（含严格模式/模块保留字）、**Python 3**、**C**（C11）、**Java**。

仅仅是可读性要求。

---

## 3. 语句模型 ↔ `CadStatement` 映射

现有 `CadStatement = { id, op, args, inputs, name?, feature }`（`types.ts`）。映射规则：

| 文本 | PartScript |
|------|-----------|
| `const part0_v0 = cad.box({ size })` | `{ id: 'part0_v0', model: 'part0', op: 'box', args: { size: 20 }, inputs: [] }` |
| `const part0_v1 = await cad.drill(part0_v0, {…})` | `{ id: 'part0_v1', model: 'part0', op: 'drill', args: {…}, inputs: ['part0_v0'] }` |
| `cad.faceCenter(part0_v0)` | `args.position = GeomRef { $geom: { of: 'part0_v0', feature: 'faceCenter', faceOrdinal?: <n>, anchor?: { point, normal } } }`（`faceOrdinal` 为拓扑面序号引用，优先于 `anchor` 几何反查；二者均不要求必填） |
| `const size = 20` + 引用 `size` | 解析期**折叠**为字面量 `20`；如需暴露 UI 滑块则保留 `ParamRef`+`ParamDef`（可选增强，见 §8） |
| `return { shape: part0_v1, name, color, … }` | `PartScript.meta = { name, appearance: { color, metalness, roughness } }` |
| `const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v2, {…})` | `{ id: 'part1_v0', op: 'split', args: {…}, inputs: ['part0_v2'], outputs: ['part1_v0','part2_v0'], model: 'part1' }`（一个语句、两个输出 id；`front`→`part1` 模型、`back`→`part2` 模型，二者均为新模型号，**不占用主模型 part0 的版本链**） |
| `const part1_v1 = await cad.drill(part1_v0, {…})` | `{ id: 'part1_v1', model: 'part1', op: 'drill', args: {…}, inputs: ['part1_v0'] }` |
| `const part4_v0 = await cad.union(part1_v1, part3_v0)` | `{ id: 'part4_v0', model: 'part4', op: 'union', args: {}, inputs: ['part1_v1','part3_v0'] }`（多输入；subtract/intersect 同构；`part4` 为合并出的新模型） |
| `return [ { shape: part2_v1, … }, { shape: part4_v0, … } ]` | `PartScript.terminalShapes = ['part2_v1','part4_v0']`，各自 meta 映射到对应 mesh |
| 提交来源（UI / AI） | `feature.createdBy = 'user' \| 'ai'`（由提交上下文注入，非语法） |

**`id` 全局唯一 + 模型/版本分离（`partN_vN` 体系，关键决策）**：
- 每个模型 `partN` 拥有独立版本链 `partN_v0, partN_v1, …`。`part0` 是主模型；`part1`/`part2`/… 是 split / 独立图元 / 布尔派生的其它模型。
- 所有语句 `id`（`part0_v0`、`part1_v0`、`part2_v1`…）在整场景中**全局唯一**——模型号不同天然不冲突（`part0_vN` 与 `part1_vM` 永不撞）。
- 人类 UI 路径记录语句时即按上述规则分配 id（主模型 append `part0_vN`、split 产出 `partN_v0`/`part(N+1)_v0`、独立新图元 `partN_v0`）；AI 文本路径 parser 也产出同样形态。两条路径因此能用**同一套 id 方案**对齐，diff 才能工作（见 §4）。`st_*` 仅保留给 import/sdf 等非可编辑来源。
- `CadStatement` 增加 `model?: string`（= id 中的模型号，如 `'part0'`/`'part1'`，供时间轴/代码视图按模型分组）与可选 `outputs?: string[]`（默认 `[id]`：普通 op `outputs=[id]`，split 多输出写入 `['part1_v0','part2_v0']`）。`outputCache` 按 **output id** 索引，下游用具体输出 id（`part1_v0`/`part2_v0`）引用。

> 理由：`executeScript` 当前用 `stmt.id` 作 `outputCache` 键、用 `inputs` 引用其它语句。把"模型"与"版本"拆成 `partN_vN` 两个命名维度后，既保留了旧契约"`vN` = 同一模型的不同版本"的语义（现为 `part0_v0→part0_v1`），又让 split / 新图元 / 布尔产物各自拿到不冲突的模型号 `partN`——diff 只需按 id 对齐，不看编号池。

**`id` 身份契约（§4 能工作的前提）**：所有语句 id（均为 `partN_vM` 形态）同时是"身份"和"顺序"。双方约定：
- 既有语句的 id **不得重命名、不得重排**；只能就地改 `args` 值（参数变更）或改 `op`（结构变更）。
- 新增特征分配**下一个未用 id**：主模型追加用下一个 `part0_vN`，新模型用下一个 `partN_v0`；不得复用已删除的 id（避免碰撞）。
- 删除特征 = 该 id 整行移除（见 §4.2 DELETE）。
- 此契约对 **AI 是 prompt 级约束**（写进代码生成 system prompt），对 UI 是引擎自身保证（append 即分配新 id）。引擎侧可检测"id 顺序与出现顺序不一致"并警告，但不依赖它做对齐——对齐始终以 id 为准。

---

## 4. AI 代码生成模型 与 引擎增量执行机制（核心 HOW）

### 4.1 AI 如何生成代码：**总是全量，不生成 patch**

AI 的产出模型是**全量覆盖式 `.faijs` 文本**，不是结构化 diff/patch。理由：

1. **LLM 最擅长生成完整可运行代码，最难可靠生成结构化 patch**（patch 格式易不一致、易漏改依赖）。
2. **增量识别的职责放在引擎侧**（确定性算法），比依赖 AI 的 patch 格式更稳。
3. 这正好匹配需求原话"人类说把尺寸翻倍，AI 只需去更改原先的尺寸参数"——在"全量生成"视角下，就是 AI **保留 `part0_v0` 这行、只改它 `size` 的值**，而非输出一段"把 part0_v0.size 改成 40"的补丁。

AI 提交的契约（写进代码生成 system prompt）：
- 读取当前 `.faijs` **全文**（含所有 `partN_vM` 语句）。
- 输出**完整新全文**：保留所有既有语句（除非用户要求删除该特征），仅在既有行改值/改 op，新增特征用下一个连续 id（`partN_vM`，依所属模型而定）。
- 不得重排、不得重命名既有 id（见 §3 身份契约）。
- 必须 `// apiVersion: 1` 开头、单一 `export default`。

> 由此，AI 提交 = "一次完整重写"，引擎负责"和上次提交比对，找出改了什么"。AI 无需理解 diff 算法，引擎无需信任 AI 的意图描述——**全部基于解析后的 PartScript 做客观比对**。

### 4.2 引擎如何知道"哪些修改 / 哪些新增 / 哪些删除"

引擎持久保存**上一次已提交的 PartScript**（`committedPartScript`，按 part 存于 store）。新提交到达时：

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

1. 引擎为该 part 维护一个**持久 `outputCache`**（key = 语句 output id），跨提交存活。
2. 遍历新链：
   - **UNCHANGED** → 不重算，直接复用 `outputCache[id]` 中的几何（供下游引用）。
   - **PARAM / STRUCT / ADD** → 从 `firstChange` 起执行 `executeStatement`；其结果写入 `outputCache`；其下游因读取到新结果而自动失效、随 suffix 重放。
   - **DELETE** → 该 id 的 `outputCache` 失效；其下游（旧链中引用它的语句）在本次重放中已被 STRUCT/ADD 覆盖或一并失效。
3. 重放沿用 `ScriptEngine.replayPart` 逻辑；失败沿用现有 statement 模式：保留前 k-1 条成功语句。
4. 重放成功 → 新 `PartScript` 写回 store 作为下一次提交的 `committedPartScript`；`feature.createdBy` 按提交上下文标注（UI 提交=‘user’，AI 提交=‘ai’，行内来源由 parser 从既有 PartScript 继承——见 §4.4）。

**DAG 相关补充**：
5. **split 多输出**：split 语句 `id='part1_v0', outputs=['part1_v0','part2_v0']`，`outputCache` 同时存 part1_v0、part2_v0。`part1_v0` 这条 PARAM/STRUCT 变更 → 从它起重放，两个输出一并重算；下游引用 part1_v0 或 part2_v0 的语句随 suffix 失效重放。
6. **DELETE 级联 / 孤儿**：若某语句被删且其输出仍被下游引用（如删了 split 但保留了 `drill(part1_v0)`），下游语句的 `inputs` 指向不存在的 id → 视为**孤儿**。推荐处理：直接 `ParseError` 拒绝提交（因为全量生成的 AI 通常一并删除下游，孤儿多代表 AI 违反身份契约）；若确需级联，则把孤儿语句一并判为 DELETE 并级联其下游。

### 4.4 为什么"保留 id"让增量成立 + AI/UI 来源如何继承

- **增量成立的前提**就是 §3 身份契约：引擎**只靠 id 对齐**，不看行号位置。所以 AI 改 `part0_v0.size` 时，只要 `part0_v0` 这个 id 保留，引擎就识别为"part0_v0 的参数变更"而非"删了 part0_v0 加了新东西"。若 AI 违反契约重命名 `part0_v0→part0_v9`，引擎会判成"删 part0_v0 + 加 part0_v9"——功能上可能仍能跑，但丢失了"参数变更"语义、且下游 `inputs:['part0_v0']` 全部断引用报错。**所以 id 身份契约是硬约束，不是建议。**
- **`createdBy` 来源继承**：`parseScript` 解析新文本时本身**看不出**某行是 user 还是 ai（语法里不含此信息）。因此 parser 在做 diff 时，对"UNCHANGED / PARAM / STRUCT"的既有 id，**从 `oldById[id]` 继承 `feature.createdBy`**；只有 **ADD** 的新 id 才标为本次提交的来源（AI 或 UI）。这样"哪些步骤是 AI 生成的"能在时间轴/代码视图正确延续，不会因为一次全量重写就丢失历史来源。

### 4.5 场景对照（验证机制）

| 场景 | AI 改动（全量文本） | diff 判定 | 重放范围 |
|------|---------|-----------|----------|
| 把正方形尺寸翻倍 | 保留 `part0_v0=box`，改 `size 20→40` | `part0_v0` PARAM 变更 | 重算 `part0_v0`，`part0_v1(drill)`/`part0_v2(chamfer)` 随 suffix 重放 |
| 给 4 条边倒角（追加） | 保留 `part0_v0/part0_v1`，末尾加 `part0_v2=chamfer(part0_v1,…)`，改 `return shape:part0_v2` | `part0_v2` ADD | 只执行 `part0_v2`（`part0_v0/part0_v1` 命中缓存） |
| 把钻孔改成挖槽（改 op） | 保留 `part0_v1`，改 `op drill→slot` | `part0_v1` STRUCT 变更 | 从 `part0_v1` 起重放 |
| 人类滚花顶面（UI 追加） | UI 追加 `part0_v3=knurl(part0_v2,…)` | `part0_v3` ADD | 只执行 `part0_v3` |
| **多 mesh：前半(倒角) ∪ 新立柱** | 保留 `part0_v0..part0_v2`，加 `part1_v0/part2_v0=split(part0_v2)`、加 `part1_v1=drill(part1_v0)`、加 `part3_v0=cylinder(...)`、`part4_v0=union(part1_v1,part3_v0)`，改 `return [ {shape:part2_v1}, {shape:part4_v0} ]` | `part1_v0/part2_v0/part1_v1/part3_v0/part4_v0` ADD | 只执行这些新增（`part0_v0..part0_v2` 命中缓存；跨模型引用 `part1_v0`/`part1_v1` 直接命中） |

---

## 5. 人类 UI ↔ AI 交织流程

**人类钻孔（UI）**：
1. 用户点击面 → 引擎根据交互派生 args（position/normal/direction…）。
2. `useScriptStore.appendStatement(partId, stmt)`，`stmt.id = 'part0_vN'`（主模型版本链）、`model='part0'`、`feature.createdBy = 'user'`。
3. `replayPart` 增量重算，`outputCache` 更新。
4. `getScriptText(partId)` 经 `scriptToCode` 回写 `.faijs` 文本（代码视图同步）。

**AI 倒角（代码）**：
1. AI 读取当前 `.faijs` 全文（含 `part0_v0=box`、`part0_v1=drill`）。
2. AI 输出全量新全文：保留 `part0_v0/part0_v1`，追加 `part0_v2=chamfer(part0_v1,…)` 并改 `return shape:part0_v2`，交回引擎。
3. `acorn` 解析（合法闸门）→ `parseScript` → 与 store 中 `committedPartScript` **按 id diff**（§4.2）。
4. 判定 `part0_v2` 为 ADD → 只执行 `part0_v2`（`part0_v0/part0_v1` 命中缓存）→ `commitGeometry`。`part0_v2.feature.createdBy='ai'`（ADD 继承本次来源），`part0_v0/part0_v1` 继承历史来源。

两条路径**收敛到同一个 PartScript**，引擎只认 PartScript；人类和 AI 永远在改同一份事实源。

---

## 6. 场景走查（端到端，主模型 part0 版本链）

| 步骤 | 操作来源 | .faijs 关键变化 | diff 类型 | 引擎动作 |
|------|----------|-----------------|-----------|----------|
| 0 | 人类 | `part0_v0 = cad.box({ size: 20 })` | — | 建立方体（模型 part0 版本 0） |
| 1 | 人类 | `part0_v1 = await cad.drill(part0_v0, {…faceCenter(part0_v0)…})` | 新增 | 钻孔（模型 part0 版本 1） |
| 2 | AI | 追加 `part0_v2 = await cad.chamfer(part0_v1, {edges:[0,1,2,3], radius:2})`；`return shape: part0_v2` | 新增 `part0_v2` | 仅执行倒角 |
| 3 | AI | `part0_v0.box.args.size 20→40`（保留 `part0_v0` id） | `part0_v0` 参数变更 | 重算 `part0_v0`，`part0_v1/part0_v2` 随 suffix 重放 |
| 4 | 人类 | 追加 `part0_v3 = await cad.knurl(part0_v2, { face: top })` | 新增 `part0_v3` | 仅执行滚花 |

> 注意：`part0_v0`/`part0_v1`/`part0_v2`/`part0_v3` 始终是**同一个模型（part0）的版本链**——这正是旧契约"`vN` 是一个模型的不同版本"的语义（现为 `part0_vN`），多模型语法不得破坏它。

每一步提交后，未被变更的前缀（`part0_v0` 在步骤 2/4；`part0_v0/part0_v1` 在步骤 4）都**命中持久缓存、不重算**。

---

## 7. 未来演进方向
- **应用外执行**：`cad-runtime` facade 实现 `CadAPI`，与 `replay-validator.resolveGeomRef` 同源（R-1）；供 Node/AI 直接 `import()` 跑出几何。
- **AI dryRun 校验通道**：acorn 解析 + J-2 保真比对，作为 AI 提交前的预检。
