# 第三方库开发手册

[English](library-dev-guide.md) | 中文

> 本手册讲解如何为 faijs 生态编写和移植第三方库。库作者写 brepjs 形态代码（位置参数、`Result` 返回、`Sketcher`/`Blueprint`/`draw` DSL），通过 `runtime.registerLib(binding, ns, { compat: true })` 注册。

> 相关文档：`docs/api-contract.md`（§ 7.6–7.8 三个库契约面、`compatOp` 和 Result 错误体系）、`docs/ops-api-inventory.md`（② 脚本面 `cad.*` API 手册）。

---

## 1. 三个 API 面一览

| 面 | 消费者 | 形态 | 位置 |
|---|---|---|---|
| ① TS 兼容面 | 库作者（TS 代码） | brepjs 原样：位置参数 + `Result`；同名同签名；DSL + 组合子 | `@faicad/faijs` 主导出（`packages/core/src/api/compat/`） |
| ② cad 脚本面 | `.fai.js`（UI/AI 生成代码） | `cad.*` 对象参数；语句边界 `Result` unwrap | `cad` 命名空间（经 `createRuntime` 注入） |
| ③ 库边界面 | `registerLib` 注册的导出函数 | 库写纯 brepjs 代码；边界处理借入/收养 | `runtime.registerLib(binding, ns, { compat: true })` |

库作者与 ①（导入构建块）和 ③（注册库供 `.fai.js` 调用）交互。

---

## 2. 边界契约 — 库作者三条款

以下三条是库作者**唯一**需要遵守的约束。brepjs 生态库天然满足。

### 条款 1：输入句柄不得跨调用保留

入向借入视图（经 `createBorrowedHandle`）仅在**当前调用内**有效。派生新句柄返回，不要存输入句柄供后续使用。

### 条款 2：已返回的句柄所有权已转移

函数返回的实体句柄被 faijs 收养后（经 `adoptEntity`），库不得再 `delete()` 它。brepjs 惯例本来就是「返回即转移」——上游库天然满足。

### 条款 3：返回结构里只有顶层句柄与 `geometryFields` 声明字段会被收养

返回结构中，只有顶层句柄和 `geometryFields` 列出的字段会被收养（跨边界成为 faijs `Shape`）。其余内嵌句柄保持库私有状态，跨调用一致性由库自己保证。

---

## 3. `geometryFields` — 多输出声明

当函数返回包含多个几何句柄的结构（非单一顶层 solid）时，在函数上声明 `geometryFields`，让兼容边界知道收养哪些字段：

```ts ignore-check
import { ok, type Result } from '@faicad/faijs'
import type { ValidSolid } from '@faicad/faijs'

interface PlanetaryOutput {
  sun: ValidSolid
  planets: ValidSolid[]
  ring: ValidSolid
}

export function planetary(params: PlanetaryParams): Result<PlanetaryOutput> {
  // ... build sun, planets, ring ...
  return ok({ sun, planets, ring })
}
// Declare which fields carry geometry handles for boundary adoption:
planetary.geometryFields = ['sun', 'planets', 'ring']
```

不声明 `geometryFields` 时，边界只收养顶层返回值（如果是句柄）；结构作为纯数据透传（内嵌句柄保持库私有）。

---

## 4. `solidOf` — 显式几何终端

对于数据中心库（如 sheetmetal，`part` 是一个内嵌 `solid` 的纯数据对象），提供 `solidOf` 函数作为显式几何终端——库私有句柄在此点跨边界成为 faijs `Shape`：

```ts ignore-check
export function solidOf(part: SheetMetalPart): Result<ValidSolid> {
  return ok(part.solid!)
}
```

这使中间数据流零收养（不三角化、不分配身份槽），直到显式终端，与显示需求天然重合。

---

## 5. 最小移植清单

### 从 brepjs 到 faijs — 理想情况

1. 将所有 `from 'brepjs'` 导入说明符改为 `from '@faicad/faijs'`。
2. 删除所有 `registerKernel` 调用（faijs 管理内核——D10 单实例）。
3. 删除 `pinned` 数组或 finalizer 变通方案（faijs 处理收养生命周期——R1 修复在 `adoptEntity`）。
4. 注册库：`runtime.registerLib('mylib', myNamespace, { compat: true })`。

### mech-lib 移植

| # | 改动 | 理由 |
|---|---|---|
| 1 | `package.json` + 所有导入中 `brepjs` → `@faicad/faijs` | 包名迁移 |
| 2 | 删除 `registerKernel` 调用 | D10：内核由宿主管理 |
| 3 | 删除 `pinned` 数组 | R1：收养生命周期由 `adoptEntity` 处理 |
| 4 | `brepjs-gear.ts` 重命名 → `gear.ts` | 源码中不含 brepjs 名 |
| 5 | `Result` 消费点：**零改动** | D1：Result 原生——库的 `isErr`/`map`/`andThen` 原样工作 |

### sheetmetal 移植

| # | 改动 | 理由 |
|---|---|---|
| 1 | 删除 `compat.ts`（22 处深路径导入） | 被 `@faicad/faijs` 主导出替代 |
| 2 | 27 个文件导入中 `brepjs` → `@faicad/faijs` | 包名迁移 |
| 3 | 折弯表注册：显式化（无全局副作用） | 确定性注册 |
| 4 | 新增 `solidOf` 终端函数 | §4：显式几何终端 |
| 5 | 按需添加 `geometryFields` | §3：多输出收养 |
| 6 | 删除 `pinned` / finalizer 变通方案 | R1：由 `adoptEntity` 处理 |

---

## 6. 在 `.fai.js` 中测试库

注册后，库可在 `.fai.js` 中调用：

```js
import * as gear from 'gear-lib'
let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
let b0 = cad.box({ size: [30, 30, 5] })
let u1 = cad.union(g1, b0)
```

`registerLib` 的 `compat: true` 标志触发 `admitCompatLib`，它会：
1. 运行 `assertLibConforms`（契约校验，在包装之前——R8）。
2. 用 `compatOp` 包装每个裸函数（借入 → 分派 → 调用 → unwrap → 收养）。
3. 登记库身份用于增量键计算（B2 修复）。

已携带 `DUAL_OP_META`（来自 `defineOp`）的函数直接透传不包装——库可以自由混用 `defineOp` 声明和纯 brepjs 函数。

---

## 7. 脚本面调用矩阵 — `.fai.js` 语句实际能调什么

parser 顶层调用实参是完整表达式（`lang/parser.ts`）——**`.fai.js` 在调用点上是真正的 JS 子集**：

- **位置实参任意形态、任意混排**：字面量（`addHole(p, 'root', 15, 15, 4)`）、数组、已声明变量、成员访问（`hem(p0.solid, spec)`）、嵌套命名空间查询、运行时表达式。
- **多个对象实参原样保留**：`tabAndSlot(p, tabSpec, slotSpec)` 可用——不覆盖、不合并。*末位*纯对象是选项槽（承载 `keep` / `keepHidden`），更早的对象是位置数据。

对作者的推论：

1. **对象形态入口是推荐风格，不再是硬性要求。** spec 对象参数仍是传结构化配置的惯用方式（`defineOp` 的 D11 双形态声明照常工作），但首参是字符串 id、标量或数组的函数也能从脚本面调用。
2. **脚本里现在*可以读记录字段***（`hem(u1.solid, …)`、`allowance(u1.thickness)`——成员访问是运行时求值的表达式）；整份记录传递照常可用。
3. **库的 `err` 结果是语句失败，不是崩溃**——`OpError` → `ExecutionResult.failedAt`；失败前已完成的语句保留其 outputs。意外异常（bug）仍会抛穿 `execute()`。

对 `@faicad/sheetmetal` 的实测结论（整包注册，`{ compat: true }`）——现在全部签名形态都可调用：

| 可调用 | 示例 |
|---|---|
| spec 对象函数 | `author(spec)`、`hem(p, spec)` |
| 字符串 id / 标量 / 数组函数 | `addHole(p, 'root', 15, 15, 4)`、`allowance(p, 0.44)` |
| 变量上的成员访问 | `hem(p0.solid, { kFactor: 0.44 })` |
| 多个对象实参 | `tabAndSlot(p, tabSpec, slotSpec)` |
| 几何终端 | `unfoldSolid(s1)`——faijs `Shape` 对同一 arena 槽借入零拷贝视图 |

`solidOf` 作为显式终端保留，供 TS 兼容面与库侧使用；脚本面上它不再是*必需*的——成员访问（`p.solid`）可以直接取到该字段。
