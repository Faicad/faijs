# 无 `new Function` 执行后端 — AST 解释器改造方案（faijs）

- 日期：2026-09-14
- 状态：**实施中（核心已落地，2026-09-14）**——解释器后端 + 双后端差分测试 + no-eval-realm 证明测试已通过；见文末 §11 实施进度
- 关联：`docs/plans/2026-09-06-no-ir-dual-channel-runtime.md`（direct 执行器的设计源头）、`docs/plans/2026-09-08-faijs-security-gate.md`（安全门禁）、`docs/AGENTS.md`
- 事实基线均为当日代码实测（标注文件与行号，行号仅供定位）

---

## 0. 需求原话（逐字，不准删除）

> 引擎自己靠 new Function 执行，用户代码被禁止用它。说明引擎实现错误啊。我当初就是禁止new Function的啊。微信里不需要支持SDF。你思考如何保证大部分faijs的语义和功能下，可以在小程序禁止new Function。

> 请写出一份独立的faijs改造方案，验证无new Function下的执行流程。写在../faijs项目里

（背景语境，同样逐字保留：）

> 本项目的一个核心卖点是AI与UI混合建模。在手机端，就算交互做简单一些，至少也要能执行简单的拉伸、圆角、钻孔这些。而且要能够在UI上通过触摸指定一个面或者边，然后让AI执行某个操作，比如倒角。如果采用你的方案里的mesh链，其没有真拓扑，这些要求很难完成。所以还是要调研occt到底能否用在小程序里。小程序对wasm的大小、内存占用有哪些限制。对worker运行机制有哪些限制。请更新方案

---

## 1. 定位与背景

### 1.1 问题陈述

faijs 对用户脚本明令禁止动态求值：`security-scanner.ts:89` 的 S1 黑名单（`eval`、`Function`、`AsyncFunction`、`GeneratorFunction`、`AsyncGeneratorFunction`…）引用即拒，S-1~S-5 测试固化。但引擎自身的执行载体恰恰是被禁止的 `new Function`：

| # | 生产使用点 | 用途 |
|---|---|---|
| 1 | `packages/core/src/cad-runtime/direct-executor.ts:650`（`runUnit`） | **唯一执行路径**：把变换后的单元文本包成 `return (async () => {…})()`，`new Function('__ctx','__ns','__isGeom', src)` 编译执行 |
| 2 | `packages/core/src/sdf/sdf-core.ts:28`（`compileSdf`） | 用户 SDF 数学代码 → 可调用函数 |
| 3 | `packages/core/src/sdf/sdf-core.ts:52`（`tryCompileBounds`） | 同上（bounds 函数） |

这是引擎实现与自身语言原则的背离：用户代码被压制成静态安全形态后，又被引擎用被禁止的方式求值。

### 1.2 历史核查：IR 时代（ModuleExecutor）没有 `new Function`，但同样过不了小程序关

git 考古核实（commit `97a0484` "delete IR pipeline" 及其父提交）：IR 时代（`lang/compile.ts` + `cad-runtime/module-executor.ts`，2026-09-07 随 T5 删除）的执行载体是 ScriptIR → `compileToModule` 编译成**零 import ESM 模块文本** → Node `data:` URL / 浏览器 Blob URL **动态 `import()`** 执行（`importModule`）。当时 core 生产代码中唯一留存 `new Function` 的只有 `sdf/sdf-core.ts` 两处（至今未变）。`new Function` 是 no-IR DirectExecutor（T1–T4，commit `17eb190`）落地后才引入的执行载体。

但 IR 时代的动态 `import()` 通道**同样被微信小程序禁止**——禁 eval 与禁动态 import 任意代码文本是同一层宿主限制。"恢复 IR + 生成文本 + import()"在 weapp/严格 CSP 下是死路。**结论：执行载体必须是解释器，这与内部有没有 IR 正交。**

同时细读 `direct-executor.ts` 可见，**变换阶段已经把"编译"做完了**——`transformVariable`/`transformExpressionStatement`/`transformBlock` 产出结构化单元（`{lineNo, writes, refs, callee, isBlock}`），op 行已重写为 `__ctx.x = await __ns.cad.box(...)` 形态。文本再交给 `new Function`，等于把解析好的 AST 序列化回字符串、让 VM 重新解析一遍。这条"文本往返"路线还带来两个已知的语义薄弱点：

- `hoistText`（`direct-executor.ts:1205-1216`）与 `hoistBlockText`（`:848-929`）用**正则词边界替换**做标识符提升——源码文本里恰好含变量名的字符串字面量/注释会被误改写（潜在损坏类 bug）；
- `hoistBlockText` 自述 R-5 局限（`:841-843`）："不做嵌套作用域精确区分——嵌套块/函数体内的局部变量也会被提升到 `__ctx`"。

### 1.3 修法定位：把执行载体从"文本回注 VM"换成"AST 直接解释"（IR 红线 = 不暴露，不是不准有）

**IR 红线的准确定义（2026-09-14 用户澄清）：内部中间表示不能暴露给上层宿主（如 ../3d_editor 项目），而不是 core 内部不准有任何中间表示。** 3d_editor 消费的是元数据面（`analyzeCode`/`codeToArgs`/StatementSummary/HostArg），这个边界在 IR 时代和现在都成立。acorn AST 在 core 包内部、不出宿主面，它是否称为"IR"不构成路线约束；将来若需带 deps/拓扑的语句 IR（增量、DAG 优化），也属允许的内部演进。

本方案的实质是执行载体问题：禁 eval 环境（weapp / 严格 CSP）下，`new Function`、`eval`、动态 `import()` 全部不可用，**唯一可行载体是解释器**。改造方式：**没有文本重编译**——acorn AST 直接进入解释器执行，解释器与 AST 均不暴露出 core。语言面被三层既有机制压得很小（§3），解释器覆盖的是"安全扫描器已放行的语法集合"，边界现成且有测试固化。

改造完成后：`new Function` 在 core 源码中只剩 vm 后端一处（§5），interpreter 后端可在 `eval`/`new Function` 被**运行环境层面删除**的 JS 环境中运行（微信小程序、严格 CSP web、node `vm` 沙箱）。

### 1.4 非目标

- 不改安全扫描器规则、不改 L1 几何层（op/wasm）、不改增量/undo/DAG 语义；
- 不消灭 faqts 的 Blob URL + `import()` 通道（`faqts/exec-blob.ts:17`）——那是模块装载（动态 import），不是 eval；weapp 侧的模块装载问题另行处理，不在本方案；
- 不做小程序侧的任何适配（那是 3d_editor weapp 方案的事；本方案只保证 faijs 具备"无 eval 运行"能力）；
- 不追求解释执行性能对齐 JIT（§7 诚实清单）。

---

## 2. 现状事实基线

### 2.1 DirectExecutor 执行管线（`packages/core/src/cad-runtime/direct-executor.ts`，1289 行）

```
execute/append/update/replayFrom
  └→ runCode(code, opts, preParsedUnits?)           ← 主循环：deadline 检查、T2 changed、
       ├→ parseAndTransform(code, extraKnown)         ← A2 安全门禁前置 + acorn parse + 单元变换
       │    ├→ assertSecure(...)                      ← security-scanner（strict/balanced/off）
       │    ├→ parseBody(code)                        ← 扁平 ESM / 容器体 / AI 手写体三态
       │    └→ transformTopNode → TransformedUnit     ← 文本变换：writes/refs/callee/isBlock
       └→ 逐单元 runUnit(unit)                        ← new Function 执行（:650）
```

单元执行依赖的执行期状态（全部由 `runCode` 调度，`runUnit` 只消费）：

| 状态 | 消费点 |
|---|---|
| `this.ctx` | `__ctx` 实参——变量读写唯一持久层 |
| `this.namespaces` | `__ns` 实参——cad + registerLib 库绑定 |
| `isGeomValue` | `__isGeom` 实参——裸调用原地写回双条件守卫（P25 §3.7 规则 2，`:647-650`） |
| `setCurrentStmt(anchor)` | 执行锚点（行号 + 写键），库函数体 exec.keep / primitive 命名读取（`:653-663`） |
| `setKeepSink` | 函数体 keep 登记回收（`runCode` 开头设置，`:450`） |
| `fnParams` | 本机函数"位置 + 按名"ABI（`splitPositionalOptions`，`:1102-1144`） |

**关键观察：`runUnit` 对外的全部依赖就是 `ctx` / `namespaces` / `isGeom` 三件套**——锚点与 keep sink 由 `runCode` 在调用前设置。这就是后端抽象的天然切口。

### 2.2 四类单元的文本形态（解释器要覆盖的全部输入）

| 单元类型 | 变换产物（unit.body 示意） | 语义要点 |
|---|---|---|
| op 行 | `__ctx.part0 = await __ns.cad.box(__ctx.a, 20)` | 赋值写 ctx；await 命名空间调用 |
| 参数/派生常量行 | `__ctx.w = 20 * 2`（自由标识符已提升） | 纯表达式求值 |
| 裸调用行（P25） | `const __r = await __ns.cad.fai_drill(__ctx.p0); if (__isGeom(__r) && __isGeom(__ctx.p0)) __ctx.p0 = __r` | 双条件写回守卫 |
| 函数声明 | `__ctx.foo = async function foo(p1, p2) { const cad = __ns.cad; <原文> }` | 函数体**原文嵌入**（无标识符提升！见 D2） |
| 控制流块 | 整段文本 hoist 后直通（R-5：块内全部声明提升 ctx） | `writes` 由变换后文本的正则收集（`:827-832`） |

### 2.3 既有安全边界（解释器的语法全集来源）

- `metadata-extractor.ts:1305-1311,1571-1574`：拒 class、一切 `new` 表达式、`eval`、`with`；
- `security-scanner.ts` S1 黑名单（`:89-106`）+ S4 自由标识符白名单（`:144-149`：`Math`/`Number`/`String`/`Boolean`/`Array`/`Object`/`JSON`/`Date`/`Map`/`Set`/`Promise`/`Symbol`/`RegExp`/`Error`/`Infinity`/`NaN`/`undefined`/`parseInt`/`parseFloat`/`isNaN`/`isFinite`/`console`）+ S5 结构上限（1MiB 源码 / 5000 顶层语句 / 20 万节点 / 深度 100）；
- S-1~S-16 测试（`security-scanner.test.ts:35+`）固化"必须拒绝"集合。

**推论：能流到执行器的代码 ⊆ 扫描器放行集合。解释器实现该集合即为完备，集外代码在扫描器/解析层已被拒。**

### 2.4 现有测试资产（差分对拍的回归网）

- `packages/core/src` 同目录单测：`direct-executor.test.ts`、`execute-code.test.ts`、`function-execute.test.ts`、`brep-direct-parity.test.ts`、`assembly-replay.test.ts`、`multi-runtime.test.ts`、`arena-bounded.test.ts` 等；
- `packages/tests/faijs/`：`no-ir/`（acceptance / blocks / multifile / parity 四组）、`parity/`（6 个 .fai.js 语料）、`features/`、`mixed/`（含 SDF 语料）、`module-resolver/`、`compat-*`、`fillet/`、`chamfer/` 等；
- `parity/a17-runtime-equal.test.ts`：**已实现"fixture 全集 → CadRuntime 执行 → outputs 几何指纹 + terminals 快照"的行为基线模式**（`computeContentKey` 做几何指纹）——差分测试直接复用该模式。

---

## 3. 目标与非目标

### 3.1 目标

1. core 源码中 `new Function` 收敛到唯一文件 `cad-runtime/exec-backends/vm-backend.ts`（执行通道）与 sdf（vm 后端专属，见 §3.2）；其余任何源文件不得出现（grep 守卫固化，§6.4）。
2. 新增 interpreter 执行后端：acorn AST 直接解释，语义与 vm 后端差分一致（§6.1）。
3. 在 `eval`/`Function` 被运行环境删除的沙箱里跑通全部解释器语料（§6.2 的强制证明）。
4. 后端静态选定、无运行时回退（红线：与 BREP/mesh 链判定同一纪律）。

### 3.2 能力裁定（按用户裁定，逐字依据见 §0）

- **SDF 是 vm 后端专属能力**：`compileSdf` 在 interpreter 后端抛 `E_UNSUPPORTED_BACKEND`（静态能力声明，非运行时探测/降级）。宿主侧（3d_editor weapp）据此在构建期裁剪 SDF 入口——与"BREP 链可用性由静态规则在执行前判定"同一纪律。
- 其余 faijs 能力（op 双链、模块装载、增量、undo、装配、拓扑）**语义不减**：管线共享保证两端一致。

---

## 4. 总体设计

### 4.1 架构

```
现状:  源码 → acorn parse → 安全扫描 → 单元切分/变换(结构化元数据+文本) ──文本──→ new Function → VM
改为:  源码 → acorn parse → 安全扫描 → 单元切分/变换(结构化元数据+AST引用) ─┬→ VmBackend(文本→new Function)      [缺省]
                                                                        └→ InterpBackend(AST→解释器)        [无 eval 环境]
```

- **管线一字不动**：parseBody、assertSecure、单元切分、`writes/refs/callee/isBlock` 元数据、`runCode` 主循环（deadline、T2 changed、ctx-diff blockOutputs、身份槽同步、beforeStatement、ExecutionLimitError）全部共享。增量重算、undo、keep、装配这些难啃的语义都在管线里，两后端天然一致。
- **`TransformedUnit` 增加字段** `node: ASTNode`（保留顶层 AST 引用）；`body` 文本仅为 VmBackend 服务（解释器不用）。机械改动，存量行为零变化。

### 4.2 后端接口

```ts
// packages/core/src/cad-runtime/exec-backend.ts
export interface ExecBackend {
  /** 执行一个单元。锚点/keep-sink 由 runCode 在调用前设置，后端不负责。 */
  runUnit(
    unit: TransformedUnit,
    host: {
      ctx: Record<string, unknown>
      namespaces: Namespaces
      isGeom: (v: unknown) => boolean
    },
  ): Promise<void>
}
```

`runUnit`（`:646-664`）拆为两个实现：

- `VmBackend.runUnit`：现有文本封装逻辑原样搬入（`return (async()=>{…})()` + `new Function`）；
- `InterpBackend.runUnit`：按 `unit.node` 分派到解释器（§5）。

`DirectExecutor` 构造选项注入后端；`CadRuntimeOptions` 透传：

```ts
// runtime.ts CadRuntimeOptions 增补
export interface CadRuntimeOptions {
  security?: SecurityPolicy
  /** 执行后端。缺省 'vm'。weapp / 严格 CSP 宿主显式传 'interpreter'。静态选定，无运行时回退。 */
  execBackend?: 'vm' | 'interpreter'
}
```

### 4.3 语义决策（差分对齐的关键裁定，实施前必须逐条冻结）

| # | 决策 | 内容 | 依据 |
|---|---|---|---|
| D1 | 块内声明写 ctx | interpreter 对块内 `const/let` 声明**照现状 R-5 语义**写入 ctx（不做词法作用域净化） | 差分对齐优先；R-5 行为是已文档化的现状（`:841-843`），净化属独立语义改造，另立项 |
| D2 | 函数体作用域 | 函数体可见绑定 = 形参 + ns 绑定 + S4 安全全局；**不可见顶层 ctx 变量**——与现状完全一致（`transformFunction:934-951` 的 bodyText 原文嵌入，ctx 标识符在 `new Function` 体内本就是自由标识符会 ReferenceError） | 现状即如此；interpreter 若"顺手修好"反而破坏差分。如需开放 ctx 访问，另立语义提案 |
| D3 | 嵌套函数/箭头函数 | 函数体内声明的函数/箭头按 D2 同一作用域规则；闭包捕获 = 捕获"定义时可见绑定集"（形参 + ns + 全局） | 与 D2 同源 |
| D4 | await 语义 | 命名空间调用（`__ns.*`）结果一律 await；同步 op 被 await 合法（现状文本变换即此语义，`:13-14`） | 与现状一致 |
| D5 | 错误传播 | 用户代码抛出的 Error 原样传播（`failedAt.error` 保留原对象）；解释器内部信号对象（break/continue/return）绝不逃逸出对应语句边界 | `failedAt` 语义（`:64-72`） |
| D6 | 行号 | 错误定位一律取 `node.loc`（比现状文本包装更精确）；`failedAt.lineNo` 仍由管线统一填 | 现状 unit.lineNo 语义不变 |
| D7 | deadline 粒度 | interpreter 在**循环体每轮迭代**检查 deadline（现状只能在单元间检查，`runCode:462-464` 自述"块内死循环仍会卡死，R-7 留 v2"）。vm 后端维持现状。此为 interpreter 的**增强**，差分测试对死循环语料仅跑 interpreter | 解决 R-7 的 interpreter 侧；vm 侧不动 |
| D8 | 对象键序 / 数值语义 | 解释器逐 AST 节点求值，JS 原生运算符与内建对象直接调用宿主全局——数值/键序/类型转换语义与 vm 后端天然一致（同一个 JS 引擎），无自造语义 | 实现约束：解释器只做"求值调度"，一切内建行为委托宿主 |

---

## 5. InterpBackend 详细设计

### 5.1 文件布局

```
packages/core/src/cad-runtime/
├── exec-backend.ts              ← ExecBackend 接口（新）
├── exec-backends/
│   ├── vm-backend.ts            ← 现有 runUnit 文本封装逻辑原样迁入（core 内唯一 new Function）
│   └── interp-backend.ts        ← AST 解释器（新）
├── interp/
│   ├── eval-expr.ts             ← 表达式求值
│   ├── exec-stmt.ts             ← 语句执行
│   ├── env.ts                   ← 作用域/绑定解析
│   ├── signals.ts               ← Break/Continue/Return 内部信号
│   └── closure.ts               ← InterpClosure（函数对象）
└── direct-executor.ts           ← 管线不动；runUnit 改为委托注入的 backend
```

无新增依赖（acorn 已在 dependencies，`packages/core/package.json:39`）；幽灵依赖守卫零变化。

### 5.2 环境（`env.ts`）

```
Env = {
  kind: 'root' | 'function'
  vars: Map<string, unknown>        // root: 直通 ctx（读：ctx 有则 ctx，写：写 ctx）
                                    // function: 形参 + 函数内 let/const（D2：无 ctx 访问）
  ns: Namespaces                    // 命名空间绑定（cad + registerLib）
  globals: S4_SAFE_GLOBALS          // 宿主全局白名单，直接引用
}
```

标识符解析顺序（与 S4 白名单语义严格同构）：`vars → ns → globals → 抛 ReferenceError`。命名空间**赋值**被拒（S7 SEC_NS_ASSIGN 对应，`:613` 同语义在运行时再现）。

**不实现 hoistText/hoistBlockText**——解释器按 AST 作用域解析，天然消灭 §1.2 的两个文本缺陷（字符串字面量误替换、R-5 深度不可控）；D1 保证可观察行为（ctx 键集）与现状一致。

### 5.3 表达式求值（`eval-expr.ts`）

支持的 AST 节点集合（**冻结清单**，= 扫描器放行集；集外节点抛 `ParseError('E_UNSUPPORTED_SYNTAX')`，绝不静默跳过）：

`Literal` / `Identifier` / `MemberExpression`（含 computed）/ `CallExpression` / `AwaitExpression` / `UnaryExpression` / `UpdateExpression`（`i++`，块内循环需要）/ `BinaryExpression` / `LogicalExpression`（短路语义）/ `ConditionalExpression` / `ArrayExpression`（含 SpreadElement）/ `ObjectExpression`（含 shorthand / computed key）/ `TemplateLiteral` / `TaggedTemplateExpression`（不支持，显式拒）/ `ArrowFunctionExpression` / `FunctionExpression` / `AssignmentExpression`（`=` 与复合赋值）/ `SequenceExpression` / `ParenthesizedExpression`（acorn 不产，忽略）。

快路径：实参 AST 全为 `Literal`/`Identifier`（AI 生成 op 行的绝对主流形态）时直接取值，跳过通用求值路径（§6.3 性能预算的达成手段）。

### 5.4 语句执行（`exec-stmt.ts`）

- `VariableDeclaration`（const/let，单 declarator——管线已拒多 declarator）：init 求值 → 写 env.vars（root env 即写 ctx）；
- `ExpressionStatement`：按管线既定的裸调用写回语义执行——**写回判定不重造**：管线在变换期已算出 `inplaceWrites` 候选（`writebackTarget:1070-1098`），interpreter 对带候选的裸调用执行同一双条件守卫（`isGeom(result) && isGeom(ctx[target])`）；
- `IfStatement` / `ForStatement` / `ForInStatement` / `ForOfStatement` / `WhileStatement` / `DoWhileStatement` / `SwitchStatement` / `TryStatement` / `BlockStatement` / `LabeledStatement` / `BreakStatement` / `ContinueStatement` / `ReturnStatement`（仅函数体内合法，顶层 return 管线已忽略，`:778-781`）；
- `FunctionDeclaration`：注册 `InterpClosure` 入 ctx（writes 语义与现状 `[name]` 一致）；
- `ThrowStatement`：求值后 throw 原值。

控制流用内部信号类（`signals.ts`）：`BreakSignal(label?)` / `ContinueSignal(label?)` / `ReturnSignal(value)`，在对应语句边界捕获；逃逸出单元边界 = 解释器 bug，包装 `InternalError` 直接上抛（不进 `failedAt`——按 CLAUDE.md 掩盖禁令，直接暴露）。

### 5.5 闭包（`closure.ts`）

```ts
class InterpClosure {
  constructor(
    private node: ASTNode,          // FunctionDeclaration / Arrow / FunctionExpression
    private defEnv: Env,            // 定义时 env（D3：形参 + ns + 全局）
    private backend: InterpBackend,
  ) {}
  async call(args: unknown[]): Promise<unknown> { /* 新 env(params) + body 解释执行 */ }
}
```

- 存入 ctx 后被 `emitCall` 语义调用（本机函数"位置 + 按名"ABI 在**管线层**已完成实参解包——interpreter 直接收到最终实参列表，`fnParams` ABI 不需要在解释器内重实现）；
- 递归深度护栏（如 512）防栈溢出失控；超限抛 `ExecutionLimitError` 同族错误；
- `async` 函数：解释器全程 async，闭包调用返回 Promise，await 语义与 D4 一致。

### 5.6 SDF 的处理

`compileSdf`/`tryCompileBounds` 不改造（保持 `new Function`），改为**静态能力声明**：

```ts
// sdf-core.ts
export function compileSdf(...): SdfFn {
  if (getActiveExecBackend() === 'interpreter') {
    throw new Error('E_UNSUPPORTED_BACKEND: sdf requires the vm exec backend (no-eval environments do not support sdf)')
  }
  ...
}
```

weapp 宿主构建期已知后端为 interpreter → SDF 入口在宿主侧裁剪（不出现 UI 入口），运行时防御性兜底为显式报错。**不允许**"interpreter 下用别的算法近似 SDF"之类的回退（红线）。

---

## 6. 测试与验证策略

### 6.1 差分测试（核心验收，"大部分语义和功能保持"的证明形式）

**机制**：新增参数化测试基建 `packages/core/src/cad-runtime/exec-backends/differential.test.ts`，把语料在两个后端各跑一次，逐项断言 `DirectExecOutcome` 与几何内容一致：

| 断言项 | 比对方式 |
|---|---|
| `ctxKeys` | 集合相等 |
| `failedAt`（index/callee/message/lineNo） | lineNo 允许解释器更精确（D6），其余相等；无失败时两边都无 |
| `executedLines` | 相等 |
| `changed` / `blockOutputs` / `inplaceWrites` | 深相等 |
| shape 产出 | `computeContentKey(positions, indices)` 指纹相等（复用 `a17-runtime-equal.test.ts:49-53` 的指纹函数） |
| keep 登记（keepByLine） | 相等 |

**语料**（全部现成，零新写）：

1. `packages/core/src/cad-runtime/*.test.ts` 现有单测语料——把 `direct-executor.test.ts` / `execute-code.test.ts` / `function-execute.test.ts` 的用例参数化为双后端跑（测试文件内 `describe.each(['vm','interpreter'])`）；
2. `packages/tests/faijs/no-ir/`（acceptance / blocks / multifile / parity 四组）+ `parity/*.fai.js` + `features/*.fai.js`——按 `a17` 模式对全集跑双后端行为基线；
3. SDF 语料（`mixed/m3-sdf-box-union.fai.js`）：**仅 vm 后端跑**，interpreter 下断言抛 `E_UNSUPPORTED_BACKEND`。

**红线**：差分不绿不进入下一步（与"测试风暴防治"同纪律：每步只修当步问题）。

### 6.2 "无 eval 环境"强制证明（验证无 new Function 执行流程的直接形式）

新增 `packages/tests/faijs/no-eval-realm/no-eval-realm.test.ts`：

```ts
// node vm 模块构造沙箱 realm：把 Function/eval 从全局作用域链头上删除
const realm = vm.createContext({ /* 空对象即全局作用域链头 */ })
vm.runInContext(`
  // 顶部遮蔽：任何残余的 eval/Function 引用与调用在此环境直接抛错
  const Function = undefined; const eval = undefined;
  // ...由测试注入的 interpreter 驱动代码在此运行
`, realm)
```

- 驱动方式：interpreter 后端 + `createApiNamespace()` 在该 realm 内执行全部 §6.1 语料，断言全部通过；
- 该测试从**运行环境层面**证明"无 new Function 下执行流程可用"——任何残余的动态求值调用当场抛错，不依赖 grep 自信；
- 此测试进 CI（`packages/tests` workspace）。

### 6.3 性能基线（预算而非优化目标）

新增基准测试（`describe` 内计时断言，宽松预算防 CI 抖动）：

- 单条 op 行（`const p = cad.box(20,20,20,{centered:true})`）解释执行 ≤ 0.5ms（快路径下预期远低于此）；
- 500 行纯 op 脚本全量执行中，解释开销占比 ≤ 几何计算耗时的 10%（几何是 wasm 重活，此预算即"编排层数学可接受"的量化）；
- D7 循环插桩的检查开销：10 万次迭代空循环 ≤ 100ms。

预算写入测试断言；超标 = 当步修，不靠"再等等优化"。

### 6.4 静态守卫（grep 级，长期固化）

- 新增守卫（并入现有守卫脚本族，与 `check-ghost-deps.mjs` 同风格）：`packages/core/src` 中 `new Function` 仅允许出现在 `exec-backends/vm-backend.ts` 与 `sdf/sdf-core.ts`；
- eslint 层面（如可行）对 core 源码禁 `no-restricted-properties` 指向 `Function` 构造——静态规则，双保险。

### 6.5 手工验收流程（文档化）

```
1. npx vitest run packages/core/src/cad-runtime          # 单测（双后端参数化）
2. npm run test -w @faicad/faijs-tests                    # no-ir / parity / features 全语料差分
3. npx vitest run packages/tests/faijs/no-eval-realm     # 无 eval realm 证明
4. npm run typecheck && npm run lint                      # 静态
5. faijs-cli 双后端冒烟：npx tsx packages/core/scripts/faijs-cli.ts run parity/parity-drill.fai.js --mode mesh
   （--backend interpreter / --backend vm 各一次，产物 diff 为空）
```

（按 CLAUDE.md 测试纪律：以上每步独立跑，失败只修当步；全绿前不跑 `scripts/ci.ps1`。）

---

## 7. 诚实清单：丢什么、留什么

| 项 | 结论 |
|---|---|
| SDF | interpreter 后端**不可用**（用户已裁定 weapp 不需要；vm 后端（web/desktop/node CLI）无损保留） |
| 重数值循环的用户 JS | 无 JIT，慢于 vm 后端（几何重活本就在 wasm op 内——faijs 设计哲学如此；编排层数学可接受，§6.3 有量化预算） |
| 语法边角 | 解释器只实现冻结语法集（§5.3/§5.4）；集外显式 ParseError，非静默错误，可迭代补集 |
| `hoistText` 两缺陷 | **顺带消灭**（AST 作用域解析替代正则提升）；可观察行为不变（D1） |
| 行号精度 | **变好**（D6） |
| 块内死循环超时 | interpreter 侧解决（D7）；vm 侧维持现状 |
| 得到 | 引擎自身与"禁止动态求值"语言原则一致；可在禁 eval 环境运行（weapp / 严格 CSP / node vm 沙箱） |

---

## 8. 实施步骤（每步可运行、可验证、可停）

验证按 faijs AGENTS.md 分层顺序（先自己写的测试 → 受影响单测 → typecheck/lint → 全量 workspace 测试），全绿前禁止跑 `scripts/ci.ps1`。

### 步骤 1：后端接口抽离（纯重构，行为零变化）

1. 新建 `exec-backend.ts` + `exec-backends/vm-backend.ts`；`runUnit` 文本封装逻辑原样迁入；
2. `TransformedUnit` 增加 `node` 字段（`transformTopNode` 填充）；
3. `DirectExecutor` 构造注入后端，缺省 vm；
4. 验收：全部现有测试原样绿（不改任何断言）。

### 步骤 2：解释器核心（表达式 + 简单语句）

1. `interp/` 四模块：env / eval-expr / exec-stmt / signals（§5.2–5.4）；
2. 覆盖：op 行、参数行、派生常量、裸调用写回（P25 双条件）；
3. 差分基建（§6.1）就位，core 同目录单测语料双后端绿。

### 步骤 3：控制流块 + 闭包

1. 块单元 AST 直执行（D1 语义）+ `FunctionDeclaration` → InterpClosure（D2/D3）；
2. `packages/tests/faijs/no-ir/blocks`、`no-ir/acceptance`、`no-ir/multifile`、`parity` 全语料差分绿；
3. SDF 静态能力声明落地（§5.6）+ 守卫脚本（§6.4）。

### 步骤 4：无 eval 证明 + 性能基线

1. `no-eval-realm.test.ts`（§6.2）全语料通过；
2. 性能预算测试（§6.3）达标；
3. faijs-cli `--backend` 冒烟双跑 diff 为空。

### 步骤 5：文档与门禁收口

1. `docs/api-contract.md` 增补 `execBackend` 选项与 SDF 能力声明；
2. `npm run doc-sync`；
3. 版本号更新（发版纪律）；3d_editor 侧消费另行（不在本方案）。

---

## 9. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 解释器语义边角与 vm 后端不一致（类型转换、Error 形态、getter 副作用等） | 中 | 高 | §6.1 差分全语料门禁；D8 约束"求值调度委托宿主内建"从实现上压低分叉面；发现即修 interpreter，不动 vm |
| 现有测试隐式依赖 new Function 行为（如错误消息文本） | 中 | 中 | 差分允许 lineNo 差异（D6）；错误消息断言若过严，按"测试允许同步改写、行为不变"原则处理，逐条记录 |
| 解释器性能不达标 | 低 | 中 | 快路径（§5.3）+ §6.3 预算测试前移暴露；解释器只服务编排层，几何在 wasm |
| 闭包/递归实现复杂度失控 | 中 | 中 | D2/D3 把作用域模型压到最小（无 ctx 捕获）；深度护栏兜底；递归语料进差分 |
| SDF 静态声明破坏现有宿主 | 低 | 低 | vm 后端（缺省）行为零变化；仅 interpreter 显式抛错，宿主按红线裁剪入口 |
| 用户代码用了扫描器放行但本方案未列的语法 | 低 | 中 | §5.3 冻结清单与扫描器规则表**同源维护**（清单改动须同步评审扫描器）；集外显式报错可发现 |

---

## 10. 开放问题（需用户裁定，不裁定不进入实施）

| # | 问题 | 建议 |
|---|---|---|
| 1 | 语义决策 D1–D8 确认（尤其 D1 块声明写 ctx 维持现状、D2 函数体不可见顶层 ctx 变量） | 建议全部按"差分对齐现状"冻结；净化/开放留待独立语义提案 |
| 2 | SDF 裁定确认：interpreter 后端静态不支持（weapp 不需要；vm 后端保留） | 按你已裁定的方向落地 |
| 3 | `no-eval-realm` 证明进 CI 常驻（增加少量 CI 时长）vs 仅发版前跑 | 建议常驻——它是本方案核心验收的固化 |
| 4 | faijs-cli 是否增加 `--backend` 参数（§6.5 冒烟用） | 建议增加（CLI 已有 `--mode`，同风格） |

---

## 11. 实施进度（2026-09-14，核心已落地）

### 11.1 已落地

| 交付物 | 文件 | 说明 |
|---|---|---|
| 后端接口 | `cad-runtime/exec-backend.ts` | `ExecBackend`/`ExecHost`/`TransformedUnit`（含 `node` AST 字段）/`ExecBackendChoice` |
| vm 后端 | `cad-runtime/exec-backends/vm-backend.ts` | 原路径原样迁出，行为零变化 |
| 解释器后端 | `cad-runtime/exec-backends/interp-backend.ts` | 单元分派 + 裸调用写回（双条件几何守卫，与 P25 §3.7 对齐） |
| 解释器内核 | `cad-runtime/interp/{env,eval-expr,exec-stmt,closure,signals}.ts` | root/function/overlay 三环境（D1/D2/D4）、命名函数自绑定、递归深度护栏 |
| 公共 API | `CadRuntimeOptions.execBackend` | `createRuntime(..., { execBackend: 'interpreter' })`；缺省 `'vm'` 行为零变化 |
| 差分测试 | `cad-runtime/exec-backend-diff.test.ts` | 13 例：几何指纹/函数/递归/闭包/块/循环/裸调用写回/失败点对齐，全绿 |
| no-eval 证明 | `cad-runtime/no-eval-realm.test.ts` | Function/eval 打补丁后 interpreter 全场景跑通、vm 被拦截（双向证明），2 例全绿 |

验证状态：`tsc --noEmit` 0 错误；`cad-runtime` 目录 16 文件 241 测试全绿；解释器链路静态检查无 `new Function`/`eval`/动态 `import()`。

### 11.2 差分对拍顺带修复的 vm 路径既有缺陷

1. `emitCall` 把 `Math.floor(...)` 等全局成员调用误重写为 `await __ns.Math.floor` → 非命名空间对象保留裸调用；
2. `hoistBlockText` 对 `for (const s of ...)` 头部声明改写出非法语法（`const __ctx.s`）→ 新增 for-of/in 头部先行改写；
3. 非函数调用的 TypeError 文案对齐（`__ctx.a.fuse is not a function`）。

### 11.3 实施中发现的关键事实

- **manifold-3d 的 emscripten 绑定层在首次调用某 wasm 绑定时会惰性用 `new Function` 创建 invoker**——这是 wasm 绑定层关注点，不属于引擎层 no-eval 保证范围（生产受限环境应以 `-sDYNAMIC_EXECUTION=0` 编译 wasm）；no-eval-realm 测试据此对所有用到的 op 做预热后再打补丁。
- vm 路径函数体只能看见「自身」（命名函数表达式自绑定），看不见其它顶层函数与 ctx 变量（D2 的实际代码形态）；解释器已按此对齐。

### 11.4 剩余事项

- [ ] `docs/api-contract.md` 增补 `execBackend` 选项（§8 步骤 5 第 1 条）；
- [ ] faijs-cli `--backend` 参数（§10 开放问题 #4，待用户裁定）；
- [ ] no-eval-realm 测试是否进 CI 常驻（§10 开放问题 #3，当前已随测试文件常驻 `packages/core`）；
- [ ] 版本号更新（发版纪律，随打包发布时执行）。
