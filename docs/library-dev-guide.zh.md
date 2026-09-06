# 第三方库开发手册

[English](library-dev-guide.md) | 中文

> 本手册按 faijs 生态的三层分工组织——**库作者**写什么、**Host**（引擎装配方）处理什么、**`.fai.js` 脚本**调用什么。每层一节：职责、接口与边界。

> 相关文档：`docs/api-contract.md`（引擎契约——§7 三个 API 面与 Result 错误体系）、`docs/ops-api-inventory.md`（脚本面 `cad.*` API 手册）。

---

## 1. 三层一览

```mermaid
flowchart LR
  A[Library author writes] -->|exported functions + annotations + contractVersion| B[Host assembles & admits]
  B -->|registerLib: dual-ops pass through, bare fns lifted| C[.fai.js calls]
  C -->|ns.fn / cad.* + Result unwrap at statement boundary| D[Engine dispatches & bridges]
  D -->|Shape / handle / data record| C
```

| 层 | 角色 | 写 / 做什么 | 产出 | 关键接口 |
|---|---|---|---|---|
| ① 库作者 | TS/JS 库开发者 | 导出函数、`Result` 返回、`defineOp` / `fn.outputs` / `solidOf` 标注、`contractVersion` | 一个普通模块命名空间 | `@faicad/faijs/sdk` |
| ② Host | 引擎装配方（应用 / worker） | 创建运行时、注册库、提供内核与 backends | 可调用命名空间（`ns.*`、`cad.*`） | `runtime.registerLib(binding, ns, { compat: true })` |
| ③ `.fai.js` 脚本 | 用户 / UI / AI 生成代码 | 导入库并调用其函数 | 几何产物与值存储中的数据 | `ns.fn(...)` / `cad.*` |

数据流在编写期与运行期方向不同：库作者写命名空间，Host 注册并接纳，脚本调用已接纳的函数——引擎在两者之间处理分派、桥接与语句边界 Result。

---

## 2. 第一层——库作者写什么

### 2.1 库模块

faijs 库就是一个普通 TS/JS 模块命名空间，导出若干函数。库作者只写模块，**不负责注册**——那是 Host 的事（§3）。

```ts
import { keep, fromBrep, getBackends, CONTRACT_VERSION } from '@faicad/faijs/sdk'

export const contractVersion = CONTRACT_VERSION

export function external(params: { teeth: number; moduleSize: number; thickness: number }) {
  // ... build the gear, return a faijs Shape or a geometry handle ...
}
```

### 2.2 导出函数返回 `Result`

库函数返回 `Result<T>`（`ok` / `err`）。引擎在语句边界 unwrap：`err` 变成语句失败（`ExecutionResult.failedAt`）——**不是崩溃**；失败前已完成的语句保留其 outputs。意外异常（bug）仍会抛穿 `execute()`。

### 2.3 返回值——三分类

引擎用**单一判别**区分几何与纯数据——`__occtWasm` 标记（判别实现收敛在 `brep/handle-bridge.ts` 的 `isOcctHandle` 叶子）。返回值必须是以下三种形态之一：

| 返回值 | 分类 | 引擎行为 |
|---|---|---|
| faijs `Shape`（来自 `solid` / `fromBrep`） | 已包装 | 原样透传 |
| OCCT 句柄：带 `__occtWasm: true` 标记的对象，或 branded number id | 几何句柄 | 三角化 + 登记 BREP 槽（`fromHandle`） |
| 不带标记的 plain object | 纯数据记录（如 sheetmetal `part`） | 原样存储——**绝不**被当句柄三角化 |

把数据记录当句柄传入会在 SDK 边界以 `E_BAD_HANDLE` 显式拒绝，而不是在 kernel 深处崩溃。不要发明其他句柄形态。

### 2.4 双路径 op：`defineOp`

用 `defineOp`（来自 `@faicad/faijs/sdk`）声明两条实现路径和 L3 元数据：

```ts ignore-check
import { defineOp, keepHidden } from '@faicad/faijs/sdk'

export const intersect = defineOp({
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMesh(reconcileBrepInputs(shapes), 'intersect')
  },
  brep: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanBrep(shapes, 'intersect')
  },
  capabilities: ['evolution'], // BREP features needed (gated vs brepCapabilities)
  outputs: [...],             // named multi-product fields (§2.6)
  schema: { ... },            // param types for the UI panel (L3)
  slotMap: { ... },           // positional → object boxing, for brepjs-style calls
})
```

- **`mesh` / `brep`**：两条引擎路径。`mesh` 是默认；`brep` 可选。brep-only op 在 mesh 路径抛 `E_MESH_UNSUPPORTED`。
- **`capabilities`**：op 需要的 BREP 引擎能力——按宿主声明的 `brepCapabilities` 门控。
- **`outputs`**：命名多产物字段（唯一被识别的多产物契约名；数组字段逐元素收养）。
- **`schema` / `slotMap`**：L3 元数据——UI 面板的参数类型，以及 brepjs 风格调用所需的位置 → 对象装箱表。

### 2.5 `keep` / `keepHidden`——UI 层可见性

控制哪些输入 shape 留在 UI 层显示。函数体声明（库作者写，执行期求值）**被调用点声明覆盖**（用户 / UI / AI 在脚本录制期写）：

| 声明点 | 谁写 | 优先级 |
|---|---|---|
| 调用点（`.fai.js` 语句选项） | 用户 / UI / AI | 最高 |
| 函数体（实现内部的 `keep` / `keepHidden`） | 库作者 | 被覆盖 |

### 2.6 裸函数与 `fn.outputs`

普通导出函数（未用 `defineOp`）在命名空间以 `{ compat: true }` 注册时被提升为 brep-only op。用唯一被识别的标注声明多输出字段：

```ts ignore-check
interface PlanetaryOutput {
  sun: ValidSolid
  planets: ValidSolid[]
  ring: ValidSolid
}
export function planetary(params: PlanetaryParams): Result<PlanetaryOutput> {
  // ... build sun, planets, ring ...
  return ok({ sun, planets, ring })
}
;(planetary as { outputs?: string[] }).outputs = ['sun', 'planets', 'ring']
```

### 2.7 `solidOf`——显式几何终端

对于数据中心库（sheetmetal：`part` 是一个内嵌 `solid` 的纯数据对象），提供 `solidOf(part)` 作为显式几何终端：

```ts ignore-check
export function solidOf(part: SheetMetalPart): Result<ValidSolid> {
  return ok(part.solid!)
}
```

### 2.8 硬约束

1. **`contractVersion`**：与运行时匹配（`assertContractVersion`）；双路径 op 缺它会被拒绝。
2. **不碰引擎内部**：不得访问引擎内部可变状态（`currentStmt` / `script` / `outputCache` / `brepChain`），不得查询或修改 DAG，不得原地修改已发布的 `Shape`。
3. **句柄所有权**：返回的句柄一旦被引擎收养，之后不得再 `delete()`（返回即转移）。

### 2.9 库作者产出什么

一个普通模块命名空间：导出函数、可选标注（裸函数上的 `fn.outputs`）、可选 `defineOp` 声明、`contractVersion`。Host 原样接收这个命名空间——它从不改写库作者的代码。

---

## 3. 第二层——Host 处理什么

### 3.1 Host 职责

Host（Node 宿主或浏览器 worker）装配引擎并让库可被调用：

1. 提供引擎：内核（`brep` / `csg` / `sdf`）、backends、字体/资源——经 `createRuntime(ports, mode)`。
2. 用 `runtime.registerLib(binding, ns, { compat: true })` 注册库。
3. 提供 `cad` 命名空间（内置 op）与值存储。

### 3.2 注册库

```ts ignore-check
import { createRuntime, createNodePorts } from '@faicad/faijs'
import * as gear from 'gear-lib-demo'

const runtime = createRuntime(createNodePorts(), 'auto')
runtime.registerLib('gear', gear, { compat: true })
```

`binding`（`'gear'`）是脚本导入并调用的名字：`.fai.js` 里的 `gear.external({ ... })`。

### 3.3 接纳——每个导出发生什么

以 `{ compat: true }` 注册时，Host 的接纳步骤处理命名空间的每个导出：

| 导出类型 | 发生什么 |
|---|---|
| `defineOp` 声明的函数（携带 `DUAL_OP_META`） | 按其 spec 原样透传——不重写 |
| 裸函数 | 提升为 brep-only op；`fn.outputs`（如有）成为其 `outputs` spec |
| `contractVersion` | 与运行时校验（`assertLibConforms`）——不匹配则拒绝整个库 |
| 其他值（常量、数据） | 原样登记供脚本访问 |

### 3.4 引擎边界行为（Host 无感知）

脚本调用已接纳的函数时，边界机制由**引擎自己**处理——Host 不写任何这部分：

1. **分派**：mesh / brep 路径静态判定（链状态 + 能力），无运行时回退。
2. **借入**：faijs `Shape` 参数变成 brepjs 侧的零拷贝视图（仅当前调用内有效）。
3. **调用 + unwrap**：函数运行；`Result` 的 `err` 被 unwrap 成语句失败。
4. **收养**：几何产物跨回成为 faijs `Shape`（三角化 + BREP 槽）；纯数据原样透传（§2.3）。

### 3.5 Host 产出什么

可调用的命名空间：`gear.*`（第三方）与 `cad.*`（内置），都能从 `.fai.js` 以同样的语句级语义调用。

---

## 4. 第三层——`.fai.js` 调用什么

### 4.1 调用形态

parser 顶层调用实参是完整表达式（`lang/parser.ts`）——**`.fai.js` 在调用点上是真正的 JS 子集**：

- **位置实参任意形态、任意混排**：字面量（`addHole(p, 'root', 15, 15, 4)`）、数组、已声明变量、成员访问（`hem(p0.solid, spec)`）、嵌套命名空间查询、运行时表达式。
- **多个对象实参原样保留**：`tabAndSlot(p, tabSpec, slotSpec)` 可用——不覆盖、不合并。*末位*纯对象是选项槽（承载 `keep` / `keepHidden`），更早的对象是位置数据。

```js
import * as gear from 'gear-lib-demo'
let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
let b0 = cad.box({ size: [30, 30, 5] })
let u1 = cad.union(g1, b0)
```

### 4.2 语句边界行为

每个调用库 op 的语句都是一个边界：`Result` 被 unwrap（`err` → `ExecutionResult.failedAt`，之前已完成的语句保留其 outputs）；调用点的 `keep` / `keepHidden` 覆盖函数体声明（§2.5）。

### 4.3 调用矩阵

1. **对象形态入口是推荐风格，不再是硬性要求。** spec 对象参数仍是惯用方式，但首参是字符串 id、标量或数组的函数也能调用。
2. **脚本里可以读记录字段**（`hem(u1.solid, …)`——成员访问是运行时求值的表达式）；整份记录传递照常可用。
3. **库的 `err` 结果是语句失败，不是崩溃**——`OpError` → `ExecutionResult.failedAt`；失败前已完成的语句保留其 outputs。

对 `@faicad/sheetmetal` 的实测结论（整包注册，`{ compat: true }`）——现在全部签名形态都可调用：

| 可调用 | 示例 |
|---|---|
| spec 对象函数 | `author(spec)`、`hem(p, spec)` |
| 字符串 id / 标量 / 数组函数 | `addHole(p, 'root', 15, 15, 4)`、`allowance(p, 0.44)` |
| 变量上的成员访问 | `hem(p0.solid, { kFactor: 0.44 })` |
| 多个对象实参 | `tabAndSlot(p, tabSpec, slotSpec)` |
| 几何终端 | `unfoldSolid(s1)`——借入零拷贝 arena 视图 |

`solidOf` 作为显式终端保留，供 TS 兼容面与库侧使用；脚本面上它不再是*必需*的——成员访问（`p.solid`）可以直接取到该字段。

---

## 5. 端到端走查

一个函数跨越全部三层，逐步看：

1. **库作者写**（第一层）：`planetary` 返回 `Result<{ sun, planets, ring }>` 并携带 `fn.outputs = ['sun', 'planets', 'ring']`（§2.6）。
2. **Host 注册**（第二层）：`registerLib('gear', gear, { compat: true })`——`planetary` 被提升为 brep-only op，`outputs: ['sun', 'planets', 'ring']`；`contractVersion` 通过校验（§3.3）。
3. **脚本调用**（第三层）：`let p0 = gear.planetary({ ratio: 4 })`——语句记录调用点的 `keep`，引擎分派、借入 shape 输入、调用 `planetary`、unwrap `Result`。
4. **产物返回**：`p0.sun` / `p0.planets` / `p0.ring` 被收养为 faijs `Shape`（或数据记录），存入值存储——后续语句可继续使用（`cad.union(p0.sun, b0)`）。

每一步恰好属于一层：库作者写，Host 接纳，脚本调用，引擎桥接。

---

## 6. 移植已有的 brepjs 库

已经写过 brepjs 库？移植基本是机械性的——faijs 沿用 brepjs 惯例（位置参数、`Result` 返回、DSL）：

1. **改导入**：`from 'brepjs'` → `from '@faicad/faijs'`（`package.json` 同步）。
2. **删除 `registerKernel` 调用**——faijs 管理内核（单实例）；由宿主提供。
3. **删除 `pinned` 数组 / finalizer 变通方案**——收养生命周期（借入 → 调用 → unwrap → 收养）由引擎处理，库不再管理释放。
4. **注册命名空间**：`runtime.registerLib('mylib', myNamespace, { compat: true })`。
5. **按需补 `fn.outputs` / `solidOf`**（§2.6 / §2.7）。

brepjs 侧的惯例概念（借入视图仅限当前调用、返回句柄所有权转移）本身就是 brepjs 的约定。移植中遇到引擎边界问题时，第一层（§2.3 返回分类、§2.6 `outputs`、§2.7 `solidOf`、§2.8 硬约束）是权威契约。
