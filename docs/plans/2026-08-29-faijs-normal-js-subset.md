# faijs 语言正常化：正常 JS 子集实施计划（实现差距 → 规范）

- 日期：2026-08-29
- 状态：待评审（仅写计划，未改代码）
- 上位文档：`docs/plans/2026-08-28-faijs-ecosystem-roadmap.md`（V1 语言正常化 / V3 模块运行时）
- 相关文档：`docs/syntax-design.md`（语法契约，已按"规范要求 vs 当前实现"双层重写 §2）、`docs/api-contract.md`（R-2、§5 已同步双层）

---

## 0. 需求原话（用户，逐字）

> faijs必需是正常的js的子集，除了没有控制流语句。

> 文档错的要改，实现错的要写开发计划。

> docs根目录下的文档，必需写清楚当前的实现与规范的要求。不能把当前的临时的、甚至错误的实现当成语言规范要求。

> 先解析后执行， 纯函数链 ， 这两点是过时的说法。

> 零 import 是关键决策？？？ 错的离谱

> faijs/faits必需是一个正常的语言。faits可以理解为就是ts代码，它里面可以import其它的库。而faijs对应UI录制的代码，只有这个特殊一些，但是也要能引用第三方库呀，只是没有控制流语句。

---

## 1. 目标定位（规范要求）

- **faijs = 正常 JS 的合法子集，唯一禁令是无控制流语句**（if/for/while/do/switch/try + 动态 `import()`），外加安全红线（`eval`/`new Function`）与 `export` 禁令（自动 export 方案，路线图 O3）。
- 语句形态开放、表达式为正常 JS 表达式、允许顶层 `import`、允许命名空间调用、允许顶层函数定义——**凡是非控制流 JS 特性都是合法子集成员**。
- 引擎职责不变：parse（语法闸门）→ ScriptIR → 编译 → JS VM 执行（**先解析后编译，执行交给 JS 虚拟机**；编译产物由引擎从 IR 生成，用户原文不进 VM）。

---

## 2. 现状与差距清单（规范要求 vs 当前实现）

> 判定原则：**实现不是规范**。当前 parser 白名单是临时实现，凡与规范冲突处以规范为准，按本计划分期追上。

| # | 特性 | 规范要求 | 当前实现（`src/lang/parser.ts` 等） | 工作量 |
|---|---|---|---|---|
| 1 | 语句形态 | 开放子集：任何非控制流 JS 语句合法（声明/赋值/表达式语句/函数调用/return/顶层 function/顶层 import） | 只接受 6 种形态（声明赋值/解构/裸重赋值/成员调用/return 单双终端），其余 `unsupported statement`（parser.ts:749-750） | 高 |
| 2 | 表达式 | 正常 JS 表达式：字面量、标识符、一元/二元、模板字符串、三元、数组/对象、函数调用（含嵌套）、展开等 | `parseValueExpr` 白名单（parser.ts:67-147）：Literal / Identifier / Array / Object / `cad.<fn>` 嵌套 Call / 负数字面量；`BinaryExpression`/`TemplateLiteral`/`Conditional`/`Spread` → `ParseError` | 高 |
| 3 | 禁止清单 | 仅：控制流（if/for/while/do/switch/try）+ 动态 import + eval/new Function + export | 额外禁止（临时限制）：函数定义、类、new、模板字符串、IIFE、var、多声明器、裸表达式语句、顶层 import（parser.ts:16-21 注释；:749-750） | 中 |
| 4 | 顶层 `import`（V1.1） | 允许 `import * as mech from 'mech-lib'` 等模块声明（模块声明非控制流） | import 落进 `export default async (cad) => {...}` 函数体 → 语法错误（parser.ts:504-520 包装） | 高 |
| 5 | 命名空间调用（V1.2） | `mech.makeHeadstock(...)` 合法，`cad` 只是缺省命名空间 | parser 硬编码 `cad`（parser.ts:127,190,291,613,679 五处）；`exec.libs` 未实现 | 中 |
| 6 | 函数定义（V1.3） | 顶层 `function` 声明合法（思考文档 §3 已预设） | 函数定义 → `unsupported statement` | 中 |
| 7 | 控制流错误码（V1.5） | if/for/while/try/switch/动态 import → **专用错误码**（parse 阶段） | 笼统 `unsupported statement`，无专用诊断 | 低 |
| 8 | 模块化产物（V3） | 编译产物可携带 import 说明符；模块解析由宿主 ModuleResolver 负责 | **零 import ESM**（compile.ts、module-executor.ts:34-47）——实现取舍，非语言约束（roadmap §0.2 E4） | 高 |

---

## 3. 分期实施

### P1 —— parser 白名单 → 黑名单（语句形态 + 表达式 + 控制流错误码）

目标：语言形态接近规范，唯一拒绝项是控制流等禁令。

- 语句 walk 放开：接受非控制流语句形态（表达式语句、任意函数调用、多声明器、IIFE 等），拒绝清单收敛为黑名单（控制流 + eval/new Function + 动态 import + export）。
- `parseValueExpr` 扩展：支持 `BinaryExpression` / `UnaryExpression`（全）、`TemplateLiteral`、`ConditionalExpression`、`SpreadElement`、`SequenceExpression` 等；IR 侧需为计算表达式定存储形态（编译期求值为字面量，或发射 `ctx.<expr>` 运行时求值——**取舍见开放问题 O1**）。
- 控制流专用错误码：if/for/while/do/switch/try/动态 import → `stage:'parse'` 明确诊断（V1.5）。
- 受影响：`src/lang/parser.ts`、`src/lang/types.ts`、`src/lang/compile.ts`（translateArgs）、`src/lang/codegen.ts`（往返保真）、`src/lang/code-to-args.ts`。

### P2 —— 顶层 import 段（V1.1）

- parse 前预扫描顶层 import 声明，提升到模块顶层（`export default async (cad) => {...}` 之外）。
- `ScriptIR.imports: ImportIR[]`（specifier/kind/localName/packageName）；`packageName` 由 specifier 推导（`@scope/pkg/sub` → `@scope/pkg`）。
- codegen 打印 import 段回文件头（round-trip 往返）；行号偏移同步修正。
- 约束：只允许 import、不允许 export；import 必须在文件头部连续段；不支持动态 import()。
- 受影响：`src/lang/parser.ts`、`types.ts`、`codegen.ts`。

### P3 —— 多命名空间（V1.2）

- parser 放开硬编码 `cad`（五处）；统一 `(packageName, callee)` 二元组。
- `StatementIR.namespace` / `CallRefIR.$call.namespace`；`scriptToCode`/`codegen` 打印 `${ns}.${callee}`。
- compile 按 ns 发射：`cad.*` → `cad.*(…, exec)` 不变；第三方 → `exec.libs.mech.makeHeadstock(…)`（`exec-context.ts` 加 `libs` 字段，不改 fn 签名）。
- `statementKey` 首段必须含包名（`cad.chamfer` ≠ `mech-lib.chamfer`，否则增量执行静默产错）。
- 受影响：`src/lang/*`、`src/cad-runtime/exec-context.ts`、`module-executor.ts`、`terminal-dag.ts`、`runtime.ts`（check ② `knownCallee(ns, callee)`）。

### P4 —— 函数定义（V1.3）

- 顶层 `function` 声明合法；DAG 跳过非几何语句；feature = `包名.函数名`。
- 函数体 keep 声明（keep-syntax §2.2）：用户自定义函数亦可用 `exec.keep`。
- 受影响：`src/lang/parser.ts`、`src/cad-runtime/terminal-dag.ts`、宿主 `getFeatureByOp(packageName, op)`。

### P5 —— 模块运行时（V3，依赖 P2/P3）

- 编译产物携带 import 说明符（不再是零 import）；宿主 `ModuleResolver`（specifier → URL 表，acorn 重写 import 说明符，禁正则）。
- `CadRuntime.registerLib` + `HostPorts.extLibs`；加载时校验 `FAIJS_STATE_VERSION`（roadmap §3.4 全局锚点，V2 前置）。
- 端到端：`import * as mech from 'mech-lib'` → `mech.makeHeadstock(...)` → 产物进 `ExecutionResult.outputs`，与内置 op 产物身份互通。

---

## 4. 验收标准

**P1**
- `cad.box({ size: base + 20 })`、`cad.box({ name: \`板-${n}\` })`、`cad.drill(p, { depth: flag ? 5 : 0 })` 全部通过 parse（不再 `ParseError`）。
- `if`/`for`/`while`/`switch`/`try`/动态 `import()` → 专用错误码（非笼统 unsupported）。
- `parse → codegen → parse` 往返逐位相等（含新表达式形态）。

**P2 / P3 / P4**
- `import * as mech from 'mech-lib'` + `mech.makeHeadstock(...)` + 顶层 `function` → `parse → codegen → parse` 往返相等；控制流语句报专用错误。
- `statementKey`：`cad.chamfer` ≠ `mech-lib.chamfer`（回归锚点）。

**P5（端到端，= roadmap V3 验收）**
- 四层依赖库（mech-lib → gear-lib → bearing-db）加载执行成功；齿轮几何与内置 op 产物可混合 `cad.union` / `cad.assembly`；保存 → 重载 → check 通过、几何一致。

---

## 5. 开放问题

| # | 问题 | 建议 |
|---|---|---|
| O1 | 计算表达式（二元/模板/三元）在 IR 中的存储形态：编译期求值折叠为字面量，还是发射为 `ctx.<expr>` 运行时求值？ | 建议 P1 内先做**编译期求值**（无控制流 → 可静态求值；IR 零改动），复杂表达式（引用其他变量）再评估运行时求值 |
| O2 | `var` 是否放开？ | `var` 非控制流，规范上应允许；但 var 提升与 DAG 静态推导（声明顺序）交互需专项验证，P1 排后 |
| O3 | 参数 `const name = <literal>` 右侧是否放开为任意表达式？ | 参数机制（ParamDef + $param 引用 + check 校验）依赖字面量形态；放开需 IR 扩展，P1 排后 |

---

## 6. 参考

- 路线图：`docs/plans/2026-08-28-faijs-ecosystem-roadmap.md` §6（语言层改动）、§10 V1/V3、§0.2 E4（零 import 是取舍）。
- 语法契约（双层）：`docs/syntax-design.md` §2（规范要求 vs 当前实现）、§6.1（零 import 取舍 vs import 规范）。
- 接口契约：`docs/api-contract.md` R-2、§5。
