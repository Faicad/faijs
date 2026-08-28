# faijs 语言正常化重构设计：消灭 op 概念，函数即函数

- 日期：2026-08-27
- 状态：待评审
- 范围：faijs 引擎 + 3d_editor 宿主两个项目；本文档只写方案，不包含实施
- 关联文档：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（需求来源）；`docs/plans/2026-08-27-faijs-function-contract.md`（旧方案，作废，差异见 §6）；`docs/plans/2026-08-27-restore-dag-terminal-detection.md`（DAG 终端判定）

---

## 1. 需求原话（不准删除）

来自用户会话与 `Faijs语言的思考.md`。

本次任务原话（2026-08-27）：

> 核心任务是去掉目有所有op相关的特殊处理，让faijs成为一个正常的js/ts语言子集。但是又保留目前的UI可以自动生成代码，AI/UI代码兼容的特性。

> 这里是之前写的方案 docs\plans\2026-08-27-faijs-function-contract.md，但是质量很差。你需要完全了解这两个项目现有的代码的基础上，写一份全新的设计和技术实现方案。

此前会话中的需求原话（仍然有效，是本方案的需求基线）：

> 这个schema根本不像正常语言应该有的东西。你参考C:\git\OpenCascade\brepjs项目，看它如何实现op的校验的，还是完全无校验依赖js vm？正确的做法应该是在faijs语言的源代码里定义这些函数，不应该再有op的概念。faijs的引擎解析这些函数，自然知道其输入、输出的格式。

> faijs是通用语言，并不是一个什么op相关的语言。op就是函数，这是长期的方向。未来的第三方库，它就是写代码，实现function。不需要知道什么op这种概念。

> 第三方库当然需要提供是否修改入参的申明呀，就是我说的readonly语义，如何实现？

> 必需再次强调，faijs必需是正常的语言，必需正常的设计。所有不符合这个要求的设计，都要给我去掉，目前的代码如何实现的不重要。唯一的例外，faijs必需是UI能够自动生成代码，比如AI/UI生成的代码能够和谐共存。

> 注意UI生成代码的两个要点：1. 变量名如何自动推导；2. 自动推导哪些shape自动出现在canvas中。问题2的解决方案就是dag活跃性，加ReadonlyShape不被消费。

> 问题1的方案，核心的底层原则是要看给定一个函数调用后，是否有独立的新的shape生成了。有新的shape生成了，就需要新的变量名。如果是在原来的shape的基础上的修改，则不需要分配新的变量名。

> 初步的方案是：1. 如果输入是ReadonlyShape, 且输出是Shape的，需要一个新的变量名。比如copy，group，assemble；2. 如果输入是一个Shape，输出是一个shape的，不需要变量名。代表修改这个入参本身。比如drill、fillet；3. 如果输入和输出的（非readonly的）shape数量不同，则需要一个新的变量名。比如split/boolean。其它例外：4. 输入和输出的shape不是一个且数量相等（Shape[] 入参）如何处理？5. ReadonlyShape和Shape同时出现？目前想象不出这个场景，可以禁用。

> 既然入参是ReadonlyShape，而出参是Shape，那代表一定有新的shape生成了。而且ReadonlyShape是一个类型，是Shape类型的强化。

`Faijs语言的思考.md` 中的关键决策（原话摘录）：

> UI 层是"死"的，必须有一套确定的命名方案才能稳定生成与回放代码，因此约定 UI 生成的代码统一采用 partN（N 为整数序号）。faijs变量名只要是合法的 JS 标识符即可，变量命名规则仅针对 UI 生成的代码，手写或AI生成的代码可以用任意合法的变量名。

> 其实最终就是一句话：dag活跃性，加ReadonlyShape的入参不被消费。最终存活下来的shape显示在canvas中。

> 所有返回值是compound shape类型对象的方法，它的入参shape不失去活跃性，也就是入参其实是readonly的。算子copy也是类似的逻辑。

> 一个shape最多只能被一个compound shape引用。目前可以强制这个规则。

> 规定faijs里不准出现控制流语句，也就是不能有if/for/while之类的语句。如此，canvas里如何决定显示哪些几何模型、timeline如何显示等需求不会被AI生成的代码破坏。

> faijs引擎负责代码的解析与校验，提前杜绝错误和安全风险。但是执行完全交给js虚拟机。几何运算全部交给faijs语言库来实现，faijs引擎不内置。

---

## 2. 设计判定标准（一切取舍的唯一标尺)

1. **faijs 是正常的 JS 子集语言。** 函数就是函数。引擎（parser/compile/codegen/runtime）中**不允许存在任何按函数名分支的代码**——发现一个删一个，不因现状存在而保留。
2. **引擎可以持有一张机器生成的符号表**（§4.6）：有哪些函数、每个函数的哪些入参是 `ReadonlyShape`。这是"标准库符号表"，相当于正常语言编译器认识自己的 prelude——它是**均匀的数据**（从 TS 签名机械生成，无 per-函数代码路径），不是 op 概念。第三方函数不在表中时，语言的一切机制仍然工作（解析、编译、执行、命名、活跃性全部有确定默认行为）。
3. **两个必须保留的 UI 能力**（都在引擎侧完成，调用方零元数据负担）：①变量名自动推导（§4.7）；②canvas 显示集合自动推导（§4.8）。它们只依赖符号表中的 readonly 信息 + 语句语法结构。
4. **伪需求判定（用户原话）**：不在上面两点里的要求，要么在库函数里实现，要么扔掉。
5. **执行完全交给 JS VM**（现状已是：compileToModule → 零 import ESM → 动态 import），本方案不改执行模型，只把编译产物从"per-op 模板"改为"机械翻译"。

---

## 3. 现状分析：op 概念寄生在哪里（代码事实，已逐一核实）

现状架构中**正确、必须保留**的部分：VM 执行模型（`src/lang/compile.ts` → `src/cad-runtime/module-executor.ts`）、语句级增量执行与缓存（module-executor.ts:70, :260-273 statementKey）、静态 DAG 终端判定算法结构（`src/cad-runtime/terminal-dag.ts:32-83`）、`ExecutionResult` 结构（runtime.ts:92-119）、BREP/mesh 双链路在库函数内部静态分派（`src/stdlib/internal/resolve-path.ts:30`，符合"BREP/mesh 路径静态判定红线"）。

**要消灭的 op 特殊处理全景清单：**

### 3.1 faijs 语言层（L0）

| # | 位置 | 事实 | 性质 |
|---|---|---|---|
| A1 | `src/lang/parser.ts:67,237-250` | `BOOLEAN_OP_NAMES`：把 `cad.union/subtract/intersect` 改写为 `op='boolean'` + `args.operation` | 按函数名改写语义 |
| A2 | `src/lang/parser.ts:296-407` | `parseSplitDestructuring`：只允许 callee 恰为 `split`（:373）的对象解构，且键必须恰为 front/back（:349） | 按函数名开门 |
| A3 | `src/lang/parser.ts:764-809` | group/assembly E15.1 特判分支：单独解析、立即分配 id、登记 assemblyVars | 按函数名开门 |
| A4 | `src/lang/parser.ts:277-284` | loadFile/loadUrl/loadByKey 收敛为 `load` + 键迁移 | 按函数名改写 |
| A5 | `src/lang/parser.ts:823-828` | `schema.void` 校验：注入 schemas 查 void 拒赋值 | 引擎查 op 元数据 |
| A6 | `src/lang/parser.ts:914-953` | 成员方法语句只认 `add_constraint`/`do_assemble` 两个名字（:921） | 按函数名开门 |
| A7 | `src/lang/parser.ts:68-69,124-168` | `GEOMREF_FEATURES`/`ASSET_FEATURES`：args 内的嵌套调用只认 5 个 geom 名 + asset | 按函数名开门 |
| A8 | `src/lang/parser.ts:546-639` | `NON_CONSUMING_OPS={'group','assembly','copy'}`（:563）+ 消费规则 A/B 报错 | 引擎硬编码消费语义 |
| A9 | `src/lang/compile.ts:165-222` | `buildStatementFnBody` 六个 op 分支：add_constraint no-op(:167)、do_assemble(:171)、group/assembly(:177)、split 解构(:193)、boolean 变参(:211)、默认(:213) | 按函数名生成代码 |
| A10 | `src/lang/compile.ts:134-162` | `getStatementRefs` 兜底扫描含 group/assembly members 特判（:155-160） | 按函数名扫引用 |
| A11 | `src/lang/compile.ts:248-253` | writes 计算特判 add_constraint/do_assemble | 按函数名分支 |
| A12 | `src/lang/codegen.ts:99-332` | `buildArgsParts` 每个 op 一个 case（含默认值省略逻辑）；`statementToLine`(:355-408) 与 `scriptToCode`(:418-516) 对 group/assembly/add_constraint/do_assemble/split/boolean/load 各有分支 | 按函数名生成文本 |
| A13 | `src/lang/allocate-id.ts:71-88,120-123` | `isCreatorOp`/`isCloneOp`/`isBooleanOp` 白名单 + group/assembly 特判 | 命名依赖 op 名 |
| A14 | `src/lang/args-schema.ts` + `src/stdlib/schemas.ts:15-268` | OpSchema 框架 + 22 个手写 op 参数表（含 load 互斥 :115-125、void :128-133 特判） | 引擎持有 op 元数据 |

### 3.2 faijs 运行时与库层（L1/L2）

| # | 位置 | 事实 | 性质 |
|---|---|---|---|
| B1 | `src/cad-runtime/terminal-dag.ts:20` | `NON_CONSUMING_OPS={'group','assembly','copy'}`（与 parser.ts:563 重复定义两份！） | 活跃性硬编码 op 名 |
| B2 | `src/cad-runtime/internal-stdlib-adapter.ts:45-136` | 手写 cad 命名空间转发：`parseCall` 弹栈适配 per-op 调用形态；sdf/knurl 的 `emitBrepLost`（:91-95,:107-111）也写在这里 | 按函数名装配 |
| B3 | `src/cad-runtime/runtime.ts:879-983` | `check()` 注入 SCHEMAS 做参数校验（:886,:904-940） | 引擎查 op 元数据 |
| B4 | `src/cad-runtime/runtime.ts:676-687` | `extractBrepSolids` 特判 `stmt.op !== 'assembly'` | 按函数名分支 |
| B5 | `scripts/gen-api-dts.ts:58-64,84-123,127` | `isAsync` 名单、`SPECIAL_OPS` 硬编码模板（boolean×3/split×4/load 互斥） | 文档生成硬编码 op |

### 3.3 3d_editor 宿主侧（这些大部分是合理的宿主职责，只列需要随动的）

| # | 位置 | 事实 | 处置方向 |
|---|---|---|---|
| C1 | `src/engine/features/*`（types.ts:86-136、index.ts:25-130） | FeatureDef 注册表：op→buildStatement/图标/编辑器 | **保留**（UI 元数据是宿主职责）；`byOp` 改按 callee 匹配 |
| C2 | `src/engine/features/boolean.ts:16,48` | 单 op `'boolean'`，union/subtract/intersect 是 args.operation | 随 boolean 拆函数改注册三个 callee |
| C3 | `src/engine/script-engine/executeScript.ts:19` | 从 `@faicad/faijs/stdlib` import SCHEMAS 做 validateScriptArgs | 删除（校验进函数 + check() 符号诊断） |
| C4 | `executeScript.ts:36-47`、`ScriptEngine.ts:1146`、`model-store.ts:1279/1360/1414-1468`、`CommandPipeline.ts:398`、`scene-mutator.ts:67-80` | isVoidOrSameShape/isNewShape 排除 group/assembly、op→中文名表、split/boolean 专用编排、do_assemble/assemblyTarget 特判 | 随新 IR 逐个适配（§5.11） |
| C5 | `src/engine/__tests__/contract-entry.test.ts:55-228` | faijs 导出面白名单（含 allocateStatementId/allocateSplitIds） | 随导出面收敛更新 |

**现状痛点小结**：同一个"copy/group/assembly 不消费输入"的知识硬编码在两处（A8/B1）且互相不一致地演化；"boolean 是三个函数"的知识被压成一个 op 再在五处（A1/A9/A12/B5/C2）分别还原；新增一个库函数需要同时改 parser 白名单、compile 模板、codegen 模板、allocate-id 白名单、SCHEMAS、adapter、gen-api-dts 名单，共 6-7 处——这就是 op 概念的代价。

---

## 4. 目标设计

### 4.1 语言定义：.faijs = 受限制的 JS 子集（语法即全部）

合法语句只有以下形式（分号可选；无控制流、无函数定义、无 eval/import——现状限制全部保留，这是**语言设计**，不是 op 概念）：

```faijs
// 声明赋值：RHS 是调用表达式
let part0 = cad.box({ size: 20 })
const part3 = cad.union(part0, part1)

// 重赋值（变量须已声明）
part0 = cad.drill(part0, { diameter: 5 })

// 对象解构赋值：任意 callee、任意键（不再限 split/front/back）
const { front, back } = cad.split(part0, { normal: [0,0,1], offset: 0 })

// 成员方法调用表达式语句：任意已声明变量的任意方法
asm1.add_constraint({ type: 'coincident', a: part0, b: part1 })
asm1.do_assemble()

// 参数对象中的嵌套调用：任意 cad 函数（不再限 5 个 geom 名）
part1 = cad.drill(part0, { at: cad.faceCenter(part2), depth: cad.asset('cfg') })
```

parser 对以上形式**完全均匀处理**：不认识 box/union/split/group 中的任何一个名字。`partN` 只是 UI 生成代码的命名约定，语言层面任何合法 JS 标识符都行（AI/手写自由命名）。

### 4.2 IR：通用调用语句（CadStatement 改造）

`src/lang/types.ts:78-107` 的 `CadStatement` 已经是接近通用的 IR，做如下收敛（字段级 diff）：

```ts
interface CadStatement {
  id: StmtId                    // 不变，顺序 sN
  callee: string                // ← 改名自 op（去 op 概念的符号性动作，两仓库一起改）
  receiver?: PartName           // ← 泛化自 assemblyTarget：成员调用的接收者变量（asm1.do_assemble()）
  inputs: ShapeRef[]            // 不变：位置参数中的 shape 引用
  args: Record<string, Arg>     // 不变：尾参选项对象
  outputKeys?: string[]         // ← 新增：解构键（const {front: a, back: b} → keys ['front','back']）
  outputs: PartName[]           // 不变：绑定的变量名（0/1/N 个）
  refs?: string[]               // 不变：依赖分析用（所有 $ref/$param/嵌套调用中的变量）
  hasAssignment?: boolean       // 不变（纯语法事实）
  seq?: number                  // 不变
}
```

`Arg` 增加两个通用变体，消灭 A7 的白名单：

```ts
type Arg = JsonValue | ParamRef | VarRef | CallRef
interface VarRef { $ref: PartName }        // args 内的变量引用（如 members: [{$ref:'part0'}]）
interface CallRef { $call: { callee: string; args: Arg[] } }  // 嵌套 cad 调用（吸收 GeomRef/AssetRef）
```

- `GeomRef`（types.ts:35-47）与 `AssetRef` 退役为 `CallRef`：`cad.faceCenter(p, [x,y,z], 2)` 的 faceOrdinal/anchor 就是普通实参，拓扑语义由 geom 库函数自己解释（exec 在其内）。`$param` 保留（它是脚本参数变量，不是调用）。
- `inputs` 与 `args` 的分工不变（位置引用 vs 选项对象），因为全部现有函数都符合 `(…inputs, options?)` 形态；这不是限制而是现状的如实描述。

### 4.3 parser：纯语法解析（零函数知识）

改造后 parser 的规则**全部可枚举、无一个函数名**：

1. `cad.<ident>(...)` → `{ callee: <ident> }`；位置参数中的标识符 → `inputs`（同时记 `$ref` 语义）；末尾对象字面量 → `args`；数组/对象内的已声明标识符 → `VarRef`；`cad.<ident>(...)` 嵌套 → `CallRef`。
2. `const {k1: v1, k2: v2} = <call>` → outputs=[v1,v2]、outputKeys=[k1,k2]。对任意 callee 合法。
3. `<ident>.<method>(...)` 表达式语句 → receiver=ident、callee=method、outputs=[]。对任意方法名合法（目标须已声明的校验保留——这是变量作用域检查，不是 op 知识）。
4. 裸重赋值 `x = <call>`（x 已声明）保留（parser.ts:875-912 的机制，与函数名无关）。
5. 删除清单：A1（union 等不再改写，callee 就是源码里的名字）、A2（解构通用化）、A3（group/assembly 就是普通调用，members 数组元素走 VarRef 通用扫描）、A4（load 别名不再收敛，见 §10 决策 3）、A5（void 校验删除——赋值一个无返回值的调用得到 undefined，JS 语义，无害）、A6（成员方法通用化）、A7（嵌套调用通用化）、A8（消费规则 A/B 从 parser 删除——消费只是显示语义，见 §4.8；双重引用是合法 JS，运行时自然处理）。
6. `parseScript` 的 `options.schemas` 注入参数删除。

### 4.4 compile / codegen：机械翻译 + 统一 ABI

**统一 ABI（关键决策）**：所有可从 .faijs 调用的可调用体（cad 命名空间函数、compound 对象的成员方法）签名为

```ts
(…sourceVisibleArgs, exec: ExecContext) => Result | Promise<Result>
```

即"源码里写了什么实参，编译产物就按原序发什么实参，末尾追加 exec"。exec 是引擎注入的隐藏末参，不出现在 .faijs 文本、api.d.ts、codegen 产物中。

**compile**（`buildStatementFnBody` 重写为无分支）：

```
赋值语句:   ctx.<out> = await cad.<callee>(<inputs→ctx.*>, <args→translateArgs>, exec)
解构语句:   const {<keys>} = await cad.<callee>(...); ctx.<out_i> = <key_i>   // 按 outputKeys 机械写
成员调用:   await ctx.<receiver>.<callee>(<args?>, exec)
无赋值调用:  await cad.<callee>(..., exec)
```

- `translateArg` 对 `VarRef`→`ctx.<name>`、`CallRef`→`cad.<callee>(…, exec)` 递归翻译（A10 的 members 特判被 VarRef 通用扫描吸收）；`getStatementRefs` 变成纯 Arg 树遍历，无 op 分支。
- writes = outputs（A11 特判消失：无赋值语句 outputs 本来就是 []）。
- 统一 `await`：同步函数被 await 是合法 JS。
- A9 六分支、A11 全部删除。`boolean` 变参形态消失（见 §4.5）。

**codegen**（`buildArgsParts` 的 per-op switch 删除，改通用打印机）：

- 语句 → 文本只有一种规则：按 IR 机械打印 `let <out> = cad.<callee>(<inputs…>, <args>)`、解构、成员调用、裸重赋值（outputs[0] 已声明则 `x = …`，现有 :506-511 机制保留）。
- 不再做"默认值省略"（codegen.ts:113 等）：IR 里有什么打印什么。这比现状**更忠实**（现状会把显式写的 `nRad: 32` 吞掉）；UI 生成代码时默认值本就不进 args。
- load 的 `// source:` 注释行（:452-455）随 A4 一起处置（§10 决策 3）。

### 4.5 库层：函数即普通 TS 函数

1. **签名对齐 ABI**（机械工作，无逻辑变化）：boolean.ts 拆成 `union/subtract/intersect` 三个导出薄函数（共享内部实现），消灭"三个函数压成一个 op"的畸形；`copy/group/assembly` 等的 shape 入参标注 `ReadonlyShape`（见下）；sdf/knurl 的 `emitBrepLost` 从 adapter（B2）**移入函数体内**（函数持有 exec，自己发事件）。
2. **`ReadonlyShape` 品牌类型**（定义放 `src/mesh/types.ts` 或 `src/stdlib/shape.ts`）：

```ts
declare const readonlyBrand: unique symbol
/** Shape 类型的强化：承诺本函数不修改、不消费该入参。 */
export type ReadonlyShape = Shape & { readonly [readonlyBrand]?: true }
```

可选品牌属性使任何 Shape 可赋给 ReadonlyShape 形参（调用方零负担）；它的作用是**文档 + 符号表提取源 + 实现契约**，契约靠契约测试守护（§8-3），不靠类型系统强制。
3. **cad 命名空间 = 对象字面量**（adapter 删除，B2）：

```ts
// src/cad-runtime/internal-stdlib.ts（重命名后）——全文件无任何 per-函数逻辑
export function createInternalStdlib(exec: ExecContextImpl): StdlibNamespace {
  const bind = <F extends (...a: any[]) => any>(f: F) =>
    (...args: any[]) => f(...args, exec)          // 机械注入 exec，均匀适用于所有函数
  return mapValues({ box, sphere, …, union, subtract, intersect, split, group, assembly, copy,
                     faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax, asset }, bind)
}
```

4. **参数校验进函数**（brepjs 模式）：零向量、直径>0、未知字段等由各函数自己检查并抛带上下文的 Error；`BrepUnsupportedError` → failedAt 的现有链路（runtime.ts:520-528）不变。SCHEMAS（A14）整体删除。
5. 双链路分派不动：`resolve-path.ts` 已在函数内部做静态判定，符合红线。

### 4.6 符号表：唯一函数信息载体（机器生成，无 per-函数代码）

新增构建期工具 `scripts/gen-symbol-table.ts`（TypeScript Compiler API 扫描 `src/stdlib/*.ts` 导出签名），生成并入库 `src/lang/symbol-table.json`（生成文件，同 api.d.ts 的纪律：禁手改 + 守卫测试）：

```jsonc
{
  "copy":     { "readonlyPositions": [0] },
  "group":    { "readonlyPaths": ["members"] },
  "assembly": { "readonlyPaths": ["members"] },
  "drill":    {},
  "union":    {},
  …
}
```

提取规则（纯机械）：位置形参类型为 `ReadonlyShape` → `readonlyPositions` 记下标；options 对象属性类型为 `ReadonlyShape` / `readonly ReadonlyShape[]` → `readonlyPaths` 记属性名。签名里没有 readonly 标注就什么都不记——**库作者的唯一的额外工作就是在签名里写类型**，这正是"第三方库提供是否修改入参的申明"（用户原话）的落地。

符号表的消费方只有三个，全部是**均匀查表**，无 per-函数代码路径：命名服务（§4.7）、活跃性分析（§4.8）、check() 诊断（§4.9）。第三方库未来按 brepjs 式动态加载时，随包提供同款 json，加载时合并进符号表（远期，非本方案实施范围）。

### 4.7 核心点 1：变量名自动推导（引擎侧命名服务）

`src/lang/allocate-id.ts` 重写为 `derivePartName`（A13 的四个 op 白名单全部删除）。输入只含语法事实 + 符号表查询结果，**调用方（3d_editor FeatureDef / AI 管线）不传任何函数元数据**：

```ts
function derivePartName(input: {
  callee: string
  inputCount: number      // 语法事实
  outputCount: number     // 语法事实（含解构）
  statements: CadStatement[]  // 现有语句（取下一个 partN）
}): { behavior: 'reuse' | 'new'; names: PartName[] }
```

规则（用户原话 1-3 + 默认值，按优先级）：

| 规则 | 条件 | 命名 | 例 |
|---|---|---|---|
| R0 | outputCount === 0 | 无名字（无赋值语句） | do_assemble |
| R1 | callee 在符号表且其全部 shape 入参位置都被标 readonly | **新名** partN | copy、group、assembly |
| R2 | inputCount===1 且 outputCount===1（消费性单入单出） | **复用** inputs[0] | drill、fillet、translate |
| R3 | 其余（0 入 1 出创建类；入出数量不同） | **新名**（每输出一个 partN） | box、union、split |
| R4 | 多入多出且数量相等（Shape[] 批处理） | **禁用**（parser/命名服务报错，§10 决策 4） | — |
| R5 | 同一函数 ReadonlyShape 与 Shape 混合 shape 入参 | **禁用**（符号表生成期报错，用户原话"可以禁用"） | — |

- R1 的必然性（用户原话）："既然入参是ReadonlyShape，而出参是Shape，那代表一定有新的shape生成了。"
- **未知函数（不在符号表，如第三方/AI 自造）**：默认消费性语义 → 命中 R2/R3。解析、编译、执行、命名、活跃性全部正常工作，只是命名退化为默认规则。这是"引擎不认识函数也能跑"的试金石。
- partN 计数机制（getMaxModelNum，allocate-id.ts:29-54）原样保留。`allocateSplitIds` 被 `derivePartName(outputCount:2)` 吸收。
- partN_vM / grp_N 旧名兼容解析（:19-23,:158-196）：建议删除（§10 决策 2）。

### 4.8 核心点 2：canvas 显示集合（静态 DAG 活跃性，符号表驱动）

**保留** `computeLeafTerminals`（terminal-dag.ts:32-83）的算法骨架——"每个变量名：最后写者 P + P 之后无消费性引用 ⇒ 终端"。只替换消费判定的依据：

```ts
// 判定语句 stmt 是否"消费"变量 v（替换 NON_CONSUMING_OPS 查表，B1/A8）
function consumes(stmt: CadStatement, v: PartName, table: SymbolTable): boolean {
  if (!(stmt.refs ?? []).includes(v)) return false
  const info = table[stmt.callee]          // 未知 callee → 无 readonly 信息 → 全部消费（默认）
  // 嵌套调用（CallRef）中的引用 = 只读查询，不消费（faceCenter(part2) 不吃掉 part2）
  if (isInsideCallRef(stmt, v)) return false
  // 符号表标记的 readonly 位置/路径不消费（copy 的源、group/assembly 的 members）
  if (isReadonlyUse(stmt, v, info)) return false
  return true                             // 其余右侧出现 = 消费（用户原话）
}
```

- 这样 A8（parser 里的 NON_CONSUMING_OPS 与规则 A/B）与 B1（terminal-dag 里的 NON_CONSUMING_OPS）两处重复硬编码**同时消灭**，消费语义只剩符号表里的 readonly 数据一个真源。
- 效果对照（与现行语义逐例一致，且对第三方函数自动成立）：

| 脚本 | 判定 | canvas |
|---|---|---|
| `part0 = cad.box(...)` | 无消费者 | part0 |
| `part1 = cad.copy(part0)` | copy 入参 readonly → 不消费 | part0、part1 |
| `part0 = cad.drill(part0, ...)` | 最后写者后无消费 | part0（最新状态） |
| `{front, back} = cad.split(part0, ...)` | split 消费 part0 | front、back |
| `g = cad.group({members:[part0,part1]})` | members 路径 readonly → 不消费 | part0、part1、g |
| `x = myLib.clone(part0)`（未知函数） | 默认消费 part0 | x（命名侧走 R2 复用 part0，此处即 part0 显示新值） |

- "一个 shape 最多被一个 compound 引用"（用户原话）：由 group/assembly **库函数**在执行时检查（它们拿到成员值，做重复登记校验并抛错），不进 parser。
- `exec.touch` 机制（exec-context.ts:218，现仅 compound.ts 装配求解用）原样保留——它是"原地修改通知"，与活跃性判定无关，不需要为它发明 exec.consume。
- `ExecutionResult.terminals` 结构与语义不变，3d_editor 消费侧零改动。

### 4.9 check()：parse + 符号/引用诊断（校验的归宿）

`runtime.ts:879-983` 重构为三阶段，全部无 per-函数代码：

1. **parse**（不变，零知识解析）。
2. **符号检查**（新）：callee ∈ 符号表（未知 → 报错"函数不存在"，这是正常语言的未定义符号诊断）；receiver 变量已声明。这就是"引擎解析这些函数，自然知道其输入、输出的格式"（用户原话）的落地——引擎知道的是**签名**，不是 op。
3. **引用预检**（不变：inputs/refs 须先定义）。

可选的第四阶段（后续迭代，本方案不实施）：用符号表附带的参数类型信息做 JSON 级静态校验（从 TS 签名机械生成，等价于把 SCHEMAS 的能力改为机器生成而非手写）。

### 4.10 AI 文档面：api.d.ts 从签名生成

`scripts/gen-api-dts.ts` 重写：输入从 SCHEMAS 改为 stdlib TS 签名（与符号表同一提取管线，SPECIAL_OPS/isAsync 名单 B5 自然死亡——async 看返回类型是否为 Promise，boolean×3 就是三个真实函数，split 的 `{front,back}` 就是返回类型）。产物 `src/mesh/api.d.ts` 与 `docs/ops-api-inventory.md` 是 AI/UI 的参考书，**不参与任何语言机制**。守卫测试（api-dts-sync.test.ts 改造）保证签名 → 符号表 + api.d.ts 同步。

### 4.11 3d_editor 宿主侧适配

保留不动的：FeatureDef 注册表机制（C1，UI 元数据是宿主正当职责）、Timeline 按语句↔特征一行一节点的模型、executeScriptDiff 增量通道、`result.terminals` 消费方式。

需要改的：

1. `recordFeature`/`buildStatement`：构造的 CadStatement 用新字段（callee/receiver/outputKeys）；命名从 `allocateStatementId/allocateSplitIds` 改为 `derivePartName`（§4.7）。`boolean.ts` 注册 union/subtract/intersect 三个 callee 到同一 Feature（C2）。
2. `executeScript.ts:19`：删除 SCHEMAS import 与 validateScriptArgs 阶段（C3）；参数错误经 runtime failedAt 反馈。
3. split 语句构造：`outputs` + `outputKeys:['front','back']`；assembly 成员调用语句走 receiver/callee 通用形态（C4 的 model-store.ts:1414-1468 createAssembly 直写处同步）。
4. `scene-mutator.ts:67-80` op→中文名表改按 callee 查（纯宿主显示元数据，保留在宿主）。
5. `contract-entry.test.ts:55-228`（C5）：白名单更新——`allocateStatementId/allocateSplitIds` → `derivePartName`；删 SCHEMAS/validateScriptArgs 相关；新增 `ReadonlyShape` 类型导出。
6. `isVoidOrSameShape`/`isNewShape`（executeScript.ts:36-47）：从"op 名排除 group/assembly"改为按**语句/结果事实**判定（outputs 为空、或 terminal 对应值 isCompound——runtime 已有运行时 compound 检测 runtime.ts:596-604 可复用），宿主不再按函数名分支。

---

## 5. 波及文件清单

### 5.1 faijs

| 文件 | 改动 |
|---|---|
| `src/lang/types.ts` | CadStatement：op→callee、assemblyTarget→receiver、+outputKeys；Arg +VarRef/CallRef；GeomRef/AssetRef 退役 |
| `src/lang/parser.ts` | 删 A1-A8 全部特判；通用解构/成员调用/嵌套调用/VarRef 扫描；删 options.schemas |
| `src/lang/compile.ts` | buildStatementFnBody 无分支化；getStatementRefs 纯 Arg 遍历；writes=outputs |
| `src/lang/codegen.ts` | buildArgsParts 通用打印机；statementToLine/scriptToCode 去 op 分支 |
| `src/lang/allocate-id.ts` | 重写为 derivePartName（§4.7）；删四个 op 白名单；（决策 2）删旧名兼容 |
| `src/lang/args-schema.ts` | **删除** |
| `src/stdlib/schemas.ts` | **删除** |
| `src/lang/symbol-table.json` + `scripts/gen-symbol-table.ts` | **新增**（§4.6） |
| `src/mesh/types.ts` / `src/stdlib/shape.ts` | +ReadonlyShape 品牌类型 |
| `src/stdlib/boolean.ts` | 拆 union/subtract/intersect 三函数 |
| `src/stdlib/copy.ts` / `compound.ts` | 入参标 ReadonlyShape；compound 重复成员校验进函数 |
| `src/stdlib/sdf.ts` / `knurl.ts` | emitBrepLost 内移 |
| `src/cad-runtime/internal-stdlib-adapter.ts` | **删除**，改为无 per-函数逻辑的对象字面量装配（§4.5-3） |
| `src/cad-runtime/terminal-dag.ts` | NON_CONSUMING_OPS → 符号表驱动的 consumes()（§4.8） |
| `src/cad-runtime/runtime.ts` | check() 三阶段（§4.9）；extractBrepSolids 的 assembly 特判改按运行时 compound 值（B4） |
| `scripts/gen-api-dts.ts` | 重写为签名驱动（§4.10） |
| `src/index.ts` / `src/browser.ts` | 导出面收敛：+derivePartName/ReadonlyShape/symbol-table 类型，−SCHEMAS/validateStatementArgs/allocate* |
| `src/lang/*.test.ts`、`src/cad-runtime/*.test.ts`、`test/faijs/**` | 断言适配；op-set-consistency → 符号表↔签名一致性守卫 |

### 5.2 3d_editor

| 文件 | 改动 |
|---|---|
| `src/engine/features/*.ts` | buildStatement 产新 IR；boolean 注册三 callee；命名改 derivePartName |
| `src/engine/script-engine/ScriptEngine.ts` | getAllocateCtx → derivePartName 入参；:1146 过滤改通用 |
| `src/engine/script-engine/executeScript.ts` | 删 SCHEMAS 校验（C3）；:36-47 改事实判定（§5.11-6） |
| `src/renderer/model-store.ts` / `CommandPipeline.ts` / `scene-mutator.ts` | assembly/split/boolean 特判随新 IR 适配；显示名表按 callee |
| `src/engine/__tests__/contract-entry.test.ts` | 白名单收敛 |
| Timeline/feature-icon-map | byOp → byCallee（机制不变，键名随动） |

---

## 6. 与旧方案（faijs-function-contract.md）的关键差异

1. **活跃性判定：静态符号表驱动，而非运行时执行事实。** 旧方案要给 ExecContext 新增 `exec.consume` 并要求 split 等函数实现里埋点——把显示语义侵入几何实现，且依赖执行时序。本方案保持 terminal-dag 的纯静态分析（"shape出现在右侧则认为被消费"是用户原话的静态语义），消费例外只来自符号表 readonly 数据，函数实现零改动、零新 API。
2. **符号表的正当性框架不同。** 旧方案把 readonly 数据描述为"引擎包内 API 目录"，定位含糊。本方案明确：符号表 = 标准库符号表（正常语言编译器认识 prelude 的同款机制），机器生成、均匀查询、无 per-函数代码路径；未知第三方函数有确定默认行为，全链路不崩。
3. **IR 真改。** 旧方案保留 op 字段语义（boolean 归一只在语法层取消）。本方案把 IR 改为通用调用语句（callee/receiver/outputKeys/VarRef/CallRef），从数据结构上让 per-op 分支无处寄生。
4. **嵌套调用泛化。** 旧方案未处理 GEOMREF_FEATURES/ASSET_FEATURES 白名单（A7）。本方案用 CallRef 把 `cad.faceCenter(...)`/`cad.asset(...)` 变成普通嵌套调用。
5. **ABI 明确。** 旧方案只说"adapter 改对象字面量"，未解决 per-op 调用形态（parseCall 弹栈）的根源。本方案定义统一 ABI（源码实参原序 + 隐藏末参 exec），compile 单模板发射，adapter 的 parseCall 连根消灭。
6. **codegen 默认值省略删除**（旧方案未提及）：通用打印机更忠实于源码。

---

## 7. 实施步骤

严格遵守两仓库测试纪律（先自测 → 受影响测试 → 全层绿才跑 CI；严禁跑 CI 找 bug）。faijs 全绿并 push 后，再更新 3d_editor 的包 hash 做宿主侧（3d_editor CLAUDE.md 开发流程）。

### 阶段 0：规格测试先行（红）
- 为新语法形态写 parser/compile/codegen 测试：`cad.union(a,b)` 归一为 callee='union'；任意 callee 的解构；任意成员调用；args 内嵌套调用与 members VarRef。
- 为 §4.7 命名五条规则、§4.8 活跃性六例写纯函数测试（含"未知函数默认行为"用例）。

### 阶段 1：符号表 + 库层签名
- `ReadonlyShape` 类型；copy/group/assembly 签名标注；boolean 拆三函数；emitBrepLost 内移。
- `gen-symbol-table.ts` + `symbol-table.json` + 一致性守卫测试（含 R5 混合输入报错）。
- 全量 vitest（此阶段行为应零变化——符号表尚无消费方）。

### 阶段 2：IR + parser 纯化
- types.ts IR 改造；parser 删 A1-A8、加通用能力；fixture 文本适配（boolean fixtures 改直写 union/subtract/intersect）。
- parser/codegen round-trip 测试全绿。

### 阶段 3：compile/codegen 机械化 + 命名/活跃性切换
- compile 无分支化 + ABI 落地；codegen 通用打印机；adapter 删、对象字面量上线。
- derivePartName 上线（删 op 白名单）；terminal-dag 符号表化（删两处 NON_CONSUMING_OPS）。
- 全量 vitest + parity（brep/mesh 一致）+ demo e2e 全绿（**行为零变化闸门**）。

### 阶段 4：校验与文档面收口
- 删 schemas.ts/args-schema.ts；check() 三阶段；参数校验补进各函数（错误路径测试，stderr 零容忍不变）。
- gen-api-dts 签名驱动重写；api.d.ts / ops-api-inventory.md 重新生成。
- `pwsh -NoProfile scripts/ci.ps1` 全绿；push faijs。

### 阶段 5：3d_editor 适配
- 更新 package.json 的 faijs 包 hash + npm install。
- §5.2 全表适配；分层验证：lint → tsc → vitest → test:components → build → 只跑相关 e2e spec。

---

## 8. 测试策略

1. **行为零变化闸门（阶段 3 关键）**：同一 .faijs 文本的重构前后 ExecutionResult（terminals/outputs/compounds）必须一致；若测试因引擎内部机制消失而红，改机制不改语义。
2. **符号表一致性守卫**：symbol-table.json ↔ stdlib 签名机械一致（替代 op-set-consistency）；R5 混合输入在生成期报错。
3. **ReadonlyShape 契约测试**：对 copy/group/assembly，执行后断言入参对象内容与身份未被修改（品牌类型不做静态强制，契约靠测试）。
4. **命名规则用例**（§4.7）：copy→新名；drill→保名；union→新名；split→双新名；group/assembly→新名；未知函数 1 入 1 出→保名。
5. **活跃性用例**（§4.8 表格六例全收）；嵌套调用引用（faceCenter(part2)）不消费 part2。
6. **第三方函数模拟**：注册一个假库函数（签名带 ReadonlyShape 入参），验证 parser/compile/命名/活跃性/check 全链路仅靠"函数 + 签名"工作，引擎无任何它的知识。
7. **round-trip**：text→IR→text 幂等（含 union 直写、解构、成员调用、嵌套调用、显式默认值不丢）。
8. 函数内校验的错误路径测试（零向量/直径≤0/未知字段抛错）；stderr 零容忍纪律不变。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| .faijs 旧文本/存量 fixture 用 `op='boolean'` IR 或旧名 | 无历史兼容红线：文本形态 `cad.union(...)` 不变天然兼容；IR/fixture 一并迁移；partN_vM/grp_N 兼容代码删除（决策 2） |
| 校验从 parse 期移到运行期，AI 错误反馈变晚 | check() 保留符号+引用诊断；api.d.ts 给 AI 前置约束；运行时 failedAt 链路不变；后续可加签名驱动的静态参数校验（§4.9 阶段四） |
| 解构通用化后 AI 写出任意键解构导致 undefined | 合法 JS 语义，运行时自然暴露；check() 后续可用返回类型校验键（符号表扩展） |
| 3d_editor 依赖 allocate*/SCHEMAS 导出面 | 导出面收敛先于发版；contract-entry 白名单同步 |
| group/assembly members 从 args 字符串改 VarRef 的迁移面 | compile/terminal-dag/3d_editor createAssembly 三处同步改；round-trip 测试兜底 |
| 统一 ABI 改变 stdlib 签名，brep/mesh 实现调用点大量签名微调 | 机械改动；阶段 1 单独成步，行为零变化验证 |

---

## 10. 非目标与待评审决策点

**非目标**：不做 .faits（带类型源码、第三方库动态加载，见思考文档，远期）；不做 R4 Shape[] 批量操作（需语言层数组输出新语法，另立方案）；不做控制流（明确禁止，保持 timeline/canvas 推导成立）；不改 ExecutionResult/增量缓存/VM 执行模型。

**待评审决策点**：

1. **IR 字段改名**：`op→callee`、`assemblyTarget→receiver` 两仓库一起改（推荐：去 op 概念的符号性动作，机械重命名）。
2. **旧名兼容删除**：partN_vM/grp_N 解析兼容（allocate-id.ts:158-196）与 loadFile/loadUrl/loadByKey 收敛（A4）——按无历史兼容红线建议全删，fixture 同步迁移。
3. **load 的 `// source:` 注释行**（codegen.ts:452-455）随 A4 删除还是保留为通用 meta 机制。
4. **R4（Shape[] 等量多入多出）**：确认禁用。
5. **R5（ReadonlyShape+Shape 混合输入）**：确认符号表生成期报错禁用。
6. **符号表是否附带参数类型信息**以支撑 check() 的静态参数校验（本方案列为后续迭代）。
