# canvas 显示集合判定：不采用 DAG 活跃性时的备选方案分析

> **更正说明（2026-08-31）**：本文 §1.4 方案 C 论证中引用的"文本是 IR 的确定性投影"（当时 syntax-design 的约束 7）已被推翻——那是方向颠倒的错误表述。正确关系：**代码文本是唯一事实源**，`ScriptIR` 是 parser 从文本编译出的内部表示，可随时变更；`scriptToCode` / `statementToLine` 只是宿主编辑器的打印工具，不构成"文本由 IR 生成"。本文该处结论（`scriptToCode` 每次重算尾行会破坏性质）随之失效，方案的取舍不依赖该性质。live 契约见 `docs/syntax-design.md` §1.2-7 与 §3.2。

- 日期：2026-08-28
- 性质：**分析文档**（只写分析，不含实施；代码未做任何改动）
- 需求原话（用户 2026-08-28）：

> 分析一下，如果不采用*DAG 活跃性*判断，如何处理哪些shape出现在canvas中？
> 如果用明确的return/export语句之类的，UI层如何生成这样的代码？
> 以及其他宏语言如Freecad Marco是如何处理这个问题的，通过目录C:\git\F-cad\FreeCAD分析它的实现。
> 然后onshape是如何实现这个问题的，参考C:\git\new\onshape\onshape-std-library-mirror了解onshape的做法。

- 关联文档：`docs/syntax-design.md` §5（当前 DAG 活跃性契约）、`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（需求总纲）

---

## 0. 结论先行（TL;DR）

1. **"显示哪些 shape" 这个问题不会因为改用 return/export 而消失，它只会从 faijs 搬到 UI 层。** UI 生成 return 列表时，仍然要回答"part0 被 union 吃掉了吗、part1 是 group 成员所以不能算被吃掉吗"——**同一套消费知识，只是执行时机从运行时提前到生成时**。这与用户此前的裁定直接冲突：「活跃性判定必须封装在 faijs，3d_editor 不重复实现该判定」。
2. **`export` 在 faijs 里是语法死路**，不是设计取舍：扁平代码会被自动封装进 `export default async (cad) => { … }`（`parser.ts:512-515`），而 JS 规定 `export` 只能出现在模块顶层。实测 acorn 直接报错（§3.4 附证据）。`return` 语法可行。
3. **FreeCAD 根本没有"活跃性"问题**，因为它**不做推断**：Part 工作台是"显式注册制"（`addObject` / `Part.show` 把几何塞进 Document，进了就显示，不进就不显示），PartDesign 是"链 + Tip 指针"制（Body 只把 Tip 指向的那个特征的产物暴露到外面）。两种都不需要消费推断。
4. **Onshape 也没有活跃性推断**，但它走的是另一条路：**隐式累积 + 显式声明消费**。几何操作（`opExtrude` 等）无返回值、直接写进唯一累积器 `Context`；"消费"是**算子的显式参数**（`keepTools`、`NewBodyOperationType.NEW/ADD/REMOVE/INTERSECT`），中间体靠显式 `opDeleteBodies` 删除。代价是必须有 `Context` 可变容器 + `qCreatedBy(id)` 查询 DSL。
5. **建议**：保留 DAG 活跃性为默认；把已有但未被文档化的**显式 `return` 覆盖通道**（`runtime.ts:629-646`，`terminalShapes` 优先于 DAG）明确提升为契约中的"逃生舱"；不引入 context/query DSL，不引入 `show()` 注册语句。若仍嫌"隐式"，**代价最小的收敛方向是调用点显式消费覆盖**（Onshape `keepTools` 思路的外科手术式移植，§7.3），而不是推翻模型。

---

## 1. 先定位：要判定的到底是"存在性"还是"可见性"

这是分析前必须切开的两层，两者常被混为一谈：

| 层 | 问题 | FreeCAD 归属 | faijs 归属 |
|---|---|---|---|
| **存在性 / 最终几何集合** | 哪些几何构成"这个模型的最终结果" | App 层：Document 里有哪些 `Part::Feature` | **`ExecutionResult.terminals`** |
| **可见性开关** | 某个已存在的对象是否隐藏 | **Gui 层**：`ViewProviderDocumentObject.Visibility`（`src/Gui/ViewProviderDocumentObject.cpp:64`，`ADD_PROPERTY_TYPE(Visibility, (true), …, "Show the object in the 3d view")`） | 宿主（3d_editor），faijs 不持该状态 |

关键证据：FreeCAD 的 `Visibility` 属性挂在 **Gui 模块的 ViewProvider** 上，**不在** `App::DocumentObject` 上。也就是说 FreeCAD 架构上把"看不看得见"划给了视图层，把"存不存在"划给了数据层。

这与 faijs 的分层一致：faijs 判定的是**存在性**（terminals = 最终几何集合），"隐藏/显示/颜色/图标"是宿主 UI 状态（`Faijs语言的思考.md` 原话 6：「faijs不处理UI状态，只处理几何」）。

**本文档讨论的是存在性判定。**

---

## 2. 方案全景（8 个候选）

| # | 方案 | 判定发生在 | 需要额外语法 | UI 生成负担 | AI 生成负担 | 代表实现 |
|---|---|---|---|---|---|---|
| A | **DAG 活跃性**（现状） | 引擎运行时 | 无 | 低（只管命名） | **零** | faijs 当前 |
| B | **尾部 `return [...]` 列表** | 代码里显式写 | `return` | **高**（每次操作要维护尾行） | 高 | 可行，faijs 已实现为覆盖 |
| C | **`export { … }`** | 代码里显式写 | `export` | — | — | **语法不可行**（§3.4） |
| D | **显式注册 `cad.show(x)`** | 语句 | 新内置函数 | 高（要增删 show 行） | 高 | FreeCAD Part 工作台 |
| E | **隐式上下文累积 + 显式删除** | 引擎（Context） | 可变 Context + 查询 DSL | 中 | 中 | **Onshape** |
| F | **容器 + Tip 指针** | 容器属性 | 容器类型 + Tip | 中 | 中 | FreeCAD PartDesign Body |
| G | **调用点显式消费参数** | 语句参数 | `{ keep: [...] }` | 低（加参数） | 低 | Onshape `keepTools` |
| H | **逐语句 visible 标记** | 语句参数 | `{ visible: false }` | 中 | 中 | 无主流实现 |

下文逐个展开。

---

## 3. 方案 B/C：如果用明确的 return / export，UI 层怎么生成这样的代码

### 3.1 先看代码会长什么样

```js
// B：尾部 return 列表
let part0 = cad.box({ size: 20 })
part0 = cad.drill(part0, { diameter: 5 })
const { front: part1, back: part2 } = cad.split(part0)
let part3 = cad.cylinder({ radius: 5, height: 40 })
let part4 = cad.union(part1, part3)
return [{ shape: part2 }, { shape: part4 }]     // ← 每次操作后都要重算这一行
```

```js
// D：显式注册
let part0 = cad.box({ size: 20 })
let part1 = cad.drill(part0, { diameter: 5 })
cad.show(part1)                                  // ← 中间体要显示就得有这一行
```

### 3.2 UI 生成 return 列表时，仍然要回答同样的问题

UI 每次操作后要决定"return 里放谁"。增量维护这个集合的规则是：

| 操作 | 对 return 集合的动作 | 需要的知识 |
|---|---|---|
| `let part0 = cad.box(...)` | 加入 part0 | 创建类 |
| `part0 = cad.drill(part0, …)` | **不变**（名字复用） | 单入单出 = 修改 |
| `let part4 = cad.union(part1, part3)` | 移除 part1、part3；加入 part4 | **union 消费其全部输入** |
| `const {front: part1, back: part2} = cad.split(part0)` | 移除 part0；加入 part1、part2 | **split 消费输入、产出两个** |
| `let g = cad.group({ members:['part0'] })` | part0 **保留**、加入 g | **compound 不消费成员** |
| `let c = cad.copy(part0)` | part0 **保留**、加入 c | **readonly 入参不消费** |

——**这张表就是 `terminal-dag.ts` 的 `consumes()` 逻辑，一模一样。** 改成显式 return 后，规则一条都没少，只是：

- 执行者从 faijs 变成 3d_editor（违反"判定必须封装在 faijs"的用户裁定）；
- 判定时机从**运行时**（永远与当前代码一致）变成**生成时**（成为代码里一个需要人工/AI 同步的派生事实）。

**派生事实写进代码 = 必然漂移。** AI 改了中间某行却忘记更新尾部 return，画面就静默错了，且没有编译错误。

### 3.3 与"append-only 增量模型"的冲突

faijs 的核心卖点是「按行增量执行」（`Faijs语言的思考.md` 原话 7）：每次 UI 操作 = **追加一行**，走 `CadRuntime.append()`（`runtime.ts:365`），只执行新增语句。

显式 return 把这个模型打破了：

- return 行在**文件末尾**，改变终端集合 = **改写最后一行**，不再是纯追加；
- 一次 UI 操作变成"改尾行 + 追加"两个动作，代码视图 churn、undo 快照要多记一个非语句的元数据；
- `scriptToCode` 每次都要重算尾行，破坏了"文本是 IR 的确定性投影"这条干净性质（§0.1 约束 7）。

方案 D（`cad.show(x)`）更糟：当某个变量被消费时，它**前面那条 show 行必须删除**——这是**中间删行**，直接破坏"既有语句 id 不得重命名、不得重排"的身份契约（`docs/syntax-design.md` §7.2）。

### 3.4 `export` 是语法死路（实测证据）

faijs 的扁平代码不含 `export default` 时会被自动封装（`src/lang/parser.ts:512-515`）：

```ts
parseCode = `export default async (cad) => {\n${code}\n}`
```

而 JS 规定 `export` 只能出现在模块顶层。用 faijs 正在用的 acorn（`ecmaVersion:'latest', sourceType:'module'`）实测：

| 文本（封装后） | 结果 |
|---|---|
| `… { export const a = 1 }` | ❌ `'import' and 'export' may only appear at the top level (2:0)` |
| 扁平 `export { part0 }`（会被封装进函数体） | ❌ 同上 `(3:0)` |
| 扁平 `export [ part0 ]` | ❌ 同上 `(3:0)` |
| `return [ part0 ]` | ✅ OK |
| `cad.show(part0)` | ✅ OK |

**结论**：只要保留"扁平代码自动封装进箭头函数容器"这个机制（它是 faijs 让 `.faijs` 既能被任意 JS 解析器解析、又能被 walk 成 IR 的基础），`export` 就**不可能**作为语句机制存在。`return` 可以。

> 补充：`return` 在 faijs 里被 parser 解析为 `script.terminalShapes`（`parseReturnStatement`），**不是**一条 `StatementIR`——它不占 StmtId、不进 deps、不出现在 timeline 上。这个设计恰好是对的：显式覆盖不该污染语句序列。

### 3.5 命名服务能不能复用？能

`derivePartName` 与"用不用 return"正交：它只回答"新语句的输出该叫什么名字"（R0–R5），与终端判定无关。改用 return 方案时命名服务原样可用，不需要改。

### 3.6 AI 侧负担（这是决定性的）

| 方案 | AI 要记住什么 | 失败模式 |
|---|---|---|
| A（DAG） | 什么都不用记 | — |
| B（return） | 每次操作后更新尾行；消费 shape 时移除被吃掉的 | 忘记更新 → 画面静默错（无报错） |
| D（show） | 记得给每个最终 shape 调 show；被消费时删掉旧 show | 忘记删 → 中间体一直留在画布 |

用户原话已经点破这类负担的问题：「AI 不擅长生成这种带版本后缀的命名格式的代码……有大量的错误」（注：原话引用的 SSA 版本后缀命名已废弃，现行命名为 `partN`）。任何要求 AI 维护**派生事实**的方案都会放大这个失败率。

---

## 4. FreeCAD 的实现（`C:\git\F-cad\FreeCAD`）

### 4.1 Part 工作台：显式注册制，零推断

`Part.show(shape, [name])` 的实现（`src/Mod/Part/App/AppPartPy.cpp:972-1003`）：

```cpp
App::Document* pcDoc = App::GetApplication().getActiveDocument();
if (!pcDoc) {
    pcDoc = App::GetApplication().newDocument();
}
...
Part::Feature* pcFeature = pcDoc->addObject<Part::Feature>(name);   // ← 注册进 Document
pcFeature->Shape.setValue(shape);
pcFeature->purgeTouched();
return Py::asObject(pcFeature->getPyObject());                      // ← 返回文档对象
```

要点：

- **几何不通过返回值"出现"，而通过 `addObject` 的副作用进入 Document**。进了 Document 就进树、进 3D 视图。
- 宏里等价写法：`App.ActiveDocument.addObject("Part::Box", "Box")`。
- **没有"活跃性"概念**：一个中间 Shape 如果没被 `show()`，它只是 Python 里的一个局部变量，脚本结束就消失；被 `show()` 了就一直在，除非显式 `removeObject`。
- **消费完全由算子语义决定，不推断**：`Part::Cut` 的 `Base`/`Tool` 两个属性引用的是**文档对象**，切完 Tool 仍然独立存在（除非用户自己删）。这与 faijs 的 `subtract(a, b)` 消费 b 是**不同的语义约定**——FreeCAD 里布尔**不消费**工具。

### 4.2 名字分配：生成侧服务，与 faijs 的 `derivePartName` 同构

`Document::getUniqueObjectName`（`src/App/Document.cpp:3755-3767`）：

```cpp
std::string cleanName = Base::Tools::getIdentifier(proposedName);
if (!d->objectNameManager.containsName(cleanName)) {
    return cleanName;                                    // "Box"
}
return d->objectNameManager.makeUniqueName(cleanName, 3); // "Box001"
```

- 命名是**生成侧的分配服务**（3 位数字后缀），不是语言机制；
- 与 faijs 的 `derivePartName` / `PART_TOKEN_RE` 扫描取 `max+1` 是同一个思路（faijs 用 `partN`，FreeCAD 用 `Box`/`Box001`）；
- **FreeCAD 同样把命名放在生成侧而非解析侧**，与 2026-08-28 的 parser 分层修复结论一致。

### 4.3 录制机制：UI 生成的就是最终文本

`Command::_runCommand`（`src/Gui/Macro.cpp` / `src/Gui/Command.cpp`，见本仓 `MACRO_ANALYSIS.md` §4.2）：

```cpp
void Command::_runCommand(...) {
    LogDisabler d1;                                  // 防嵌套重复录制
    ...
    macroManager()->addLine(MacroManager::App, sCmd); // ① 先录制
    Base::Interpreter().runString(sCmd);             // ② 后执行
}
```

即**先录制、后执行**：命令内部调用 `doCommand(App, "App.ActiveDocument.addObject(\"Part::Box\",\"Box\")")`，这行字符串**同时**成为宏文本和立即执行的语句。

对 faijs 的启示：**UI 生成代码这件事，FreeCAD 的解法是"UI 直接产出最终文本"**。名字（`"Box"`）在执行那一刻由 Document 分配，然后写进录制行——与 faijs 的"生成侧调 `derivePartName` 得到 partN 再写进文本"完全同构。

**但注意**：FreeCAD 录制的是 `addObject(...)` 这种**创建语句**，不是"显示语句"。也就是说 FreeCAD 的 UI **从不需要生成"显示哪些"的代码**——因为创建即显示。这是它能绕开活跃性问题的根本原因，而 faijs 不能照搬（faijs 的 `cad.box()` 是纯函数、不产生副作用，这也是用户原话 5「几何运算全部交给faijs语言库」与 VM 执行模型的要求）。

### 4.4 PartDesign：链 + Tip 指针（第三种模型）

`Part::BodyBase::Tip`（`src/Mod/Part/App/BodyBase.h:54`）：

```cpp
App::PropertyLink Tip;    // 注释：resulting shape to the outside (Tip link)
```

- Body 内部是**线性特征链**（Pad → Pocket → Fillet …）；
- Body 对**外**只暴露 `Tip` 指向的那一个特征的产物（`Body.cpp:96-133`：`start = Tip.getValue()`，从 Tip 回溯重建）；
- 中间特征默认不单独显示（`setShowTip` / `showTip`，`src/Mod/PartDesign/App/Body.h:131,166`）。

这就是 **"多个语句写同一个变量、只显示最后一个"** 的另一种表达方式——与 faijs 的"重赋值 + 最后写者"语义**语义等价**，只是 faijs 用"最后写者"推断，PartDesign 用显式 `Tip` 指针。

**局限**：Tip 只能指一个。PartDesign 靠"一个 Body = 一个零件"来回避多输出问题；faijs 有 split（1→2）、boolean（2→1）这种 DAG，单一 Tip 表达不了——这正是 faijs 必须保留 DAG 判定的结构性原因。

### 4.5 FreeCAD 小结

| 机制 | 消费判定 | 适合 faijs 吗 |
|---|---|---|
| Part：`addObject` 显式注册 | 无推断（不 show 就不存在）；布尔**不消费**工具 | 不行：要求算子有副作用，与纯函数 + VM 执行模型冲突 |
| PartDesign：Body + Tip | 结构化（链上最后一个） | 部分：语义等价于"最后写者"，但表达不了 split/boolean 的 DAG |
| 命名 `getUniqueObjectName` | 生成侧分配 | ✅ 已等价实现（`derivePartName`） |
| 录制 `doCommand` 先录后执行 | UI 产出最终文本 | ✅ 已等价实现（宿主调 `derivePartName` 后写文本） |
| `Visibility` 在 Gui 层 | 与数据层分离 | ✅ 已等价（terminals 在 faijs，可见性在宿主） |

---

## 5. Onshape 的实现（`C:\git\new\onshape\onshape-std-library-mirror`）

### 5.1 `Context` 是唯一累积器

`context.fs:13-27`：

> A `Context` is a `builtin` that stores modeling data, including bodies (solids, sheets, wires, and points), their constituent topological entities…
> **Every Onshape Part Studio uses a single [Context].** All features, operations, and evaluation functions require a context to operate on.

即：整个 Part Studio 一个隐式容器，所有几何都在里面。

### 5.2 特征函数无返回值，几何操作直接写 Context

`extrude.fs:547-548`：

```fs
function extrudeWithDraft(context is Context, id is Id, definition is map, draftCondition is map)
{
    opExtrude(context, id, definition);      // 无赋值：几何直接进 context
    ...
}
```

- 特征签名统一 `(context, id, definition)`，**没有返回值**；
- `opExtrude` / `opBoolean` / `opFillet` 都是内置算子，副作用是往 context 里加/改/删 body；
- **没有"变量持有几何"这回事**——所以也就没有"哪个变量活跃"这个问题。

### 5.3 引用靠 `id` + 查询，不靠变量

`extrude.fs:552-555`：

```fs
const extrudeBodies = qSubtraction(qCreatedBy(id, EntityType.BODY), qUnion([
    qCreatedBy(id + "vertexPlane", EntityType.BODY),
    ...]));
```

- 几何的身份是 **`id`（分层字符串，`id + "subfeature"`）+ 查询**（`qCreatedBy(id, EntityType.BODY)`），不是变量名；
- `q*` 是一整套声明式查询 DSL（本仓 `docs/QUERY_DESIGN_ANALYSIS.md` 分析：约 120 个构造器，惰性，由内核 `@evaluateQuery` 解析）。

### 5.4 消费是算子的显式参数，不是推断

这是 Onshape 与 faijs 最本质的差异：

**（a）布尔是否吃掉工具 = 显式布尔参数 `keepTools`**（`boolean.fs:77, 108, 229`）：

```fs
definition.keepTools is boolean;
...
opBoolean(context, id, { "operationType" : ..., "tools" : definition.tools,
                         "keepTools" : definition.keepTools });
// 默认值：keepTools : false
```

**（b）新几何是新建还是并入已有 = 显式枚举 `NewBodyOperationType`**（`tool.fs:66-76`）：

```fs
export enum NewBodyOperationType
{
    annotation { "Name" : "New" }      NEW,        // 新建独立 part
    annotation { "Name" : "Add" }      ADD,        // 并入 target
    annotation { "Name" : "Remove" }   REMOVE,     // 从 target 挖掉
    annotation { "Name" : "Intersect" } INTERSECT
}
```

——**"这个操作会不会吃掉输入"是用户在 UI 上点选的一个参数**，不是从数据流推断出来的。

### 5.5 中间体靠显式 `opDeleteBodies` 删除

`extrude.fs:704`（拉伸用的中性面是中间产物，用完显式删）：

```fs
opDeleteBodies(context, getSubfeatureId("deleteNeutralPlane"), { "entities" : qCreatedBy(neutralPlaneId) });
```

还有独立的 "Delete part" 特征（`deleteBodies.fs`，`annotation { "Feature Type Name" : "Delete part" }`），用户可以手动删掉任何 part。

`boolean.fs:192, 196` 也用 `opDeleteBodies` 清理临时体。

### 5.6 `debug()` 是"看但不进模型"的独立通道

`debug.fs:57-96`：`debug(context, value, color)` 把 Query/向量/点高亮显示，但**不产生几何、不进 Part Studio**。

这与 faijs 的"预览层"是同一类需求，但 Onshape 把它做成了一条独立语句；faijs 的预览在宿主层（3d_editor），不在 `.faijs` 文本里。

### 5.7 Onshape 小结

```
显示集合 = Context 里所有 body
          − 被算子显式消费掉的（keepTools:false 的 tools、operationType:REMOVE 的 target…）
          − 被 opDeleteBodies 显式删掉的
```

| 维度 | Onshape | faijs |
|---|---|---|
| 几何持有方式 | 隐式 Context 累积（副作用） | 变量持有（值语义、纯函数） |
| 引用方式 | `id` + `q*` 查询 DSL | 变量名（PartName） |
| 消费判定 | **调用点显式参数** | **运行时数据流推断 + 符号表 readonly 标注** |
| 中间体处理 | 显式 `opDeleteBodies` | 自动（被消费即不显示） |
| 代价 | 需要可变 Context + 查询 DSL + 内置算子 | 需要"消费"的静态知识（符号表） |

**关键观察**：Onshape 之所以不需要推断，是因为它把"消费"下沉成了**算子的参数**；faijs 之所以需要推断，是因为它的算子是**纯函数**（`drill(a) → b`），消费信息不在调用点。而 faijs 的**符号表 readonly 标注**（`copy`/`group`/`assembly`）——其实正是"把消费信息挂在函数上"的 Onshape 式做法，只是粒度是**按函数**（签名），而 Onshape 是**按调用点**（参数）。

---

## 6. 关键洞察：消费到底是谁的属性

把所有方案放在一起看，分歧点其实只有一个：

> **"这个操作吃掉它的输入吗"——这个事实，挂在谁身上？**

| 挂在哪 | 代表 | 后果 |
|---|---|---|
| 挂在**数据流**（出现在右侧 = 被吃） | faijs 默认规则 | 简单、AI 零负担；但 copy/group/assembly 这类"读了但没吃"的必须开洞 |
| 挂在**函数签名**（readonly 标注 → 符号表） | faijs 的 `ReadonlyShape` | 洞有了唯一真源，可机器生成；但粒度是每函数，不能按调用点变 |
| 挂在**调用点参数** | Onshape `keepTools` / `NewBodyOperationType` | 最精确、最显式；代价是每个调用都要多写参数 |
| **不存在这个概念** | FreeCAD Part | 布尔不吃工具；中间体就是显式对象，用户自己删 |

**faijs 现在站的位置**：默认规则（数据流）+ 函数签名级覆盖（符号表）= 已经是一个混合体，且是"零额外语法"前提下能站到的最显式位置。

**再往前走一步（到调用点）的唯一理由**：确实存在"同一个函数在不同调用点消费语义不同"的场景。目前看只有 `union/subtract/intersect` 的 `keepTools` 语义（是否保留工具体）有这个需求——而那**本来就该是两个不同的函数或不同的参数**，不该靠消费推断表达。

---

## 7. 对 faijs 的建议

### 7.1 保留 DAG 活跃性为默认（方案 A）

理由（按权重）：

1. **AI / 手写代码零负担**——不需要维护任何派生事实；
2. **判定封装在 faijs**，满足用户裁定「活跃性判定必须封装在 faijs，3d_editor 不重复实现该判定」；
3. **永远与当前代码一致**（运行时计算，不可能漂移）；
4. **不破坏 append-only 增量模型**——新增语句就是纯追加；
5. 符号表 readonly 已经把"读了但没吃"的例外收敛到**一处机器生成的数据**，没有 per-函数代码路径。

### 7.2 把已有的"显式 return 覆盖"提升为正式契约

这个能力**已经实现但文档没写清楚**：

`runtime.ts:629-646`：

```ts
// 显式 terminalShapes（return [...]）优先；否则用"最后写者 + 下游无独占消费"算法。
const explicitTerminals = script.terminalShapes ?? []
let terminals: TerminalShape[]
if (explicitTerminals.length > 0) {
  terminals = explicitTerminals
} else {
  ...
  terminals = computeLeafTerminals(script, shapeVarNames)
}
```

建议在 `docs/syntax-design.md` 与给 AI 的提示词里明确：**`return [...]` 是可选的显式覆盖通道**，用途是"我想强制显示某个中间体 / 我不想显示某个叶子"，而**不是**每个脚本都必须写的样板。这样 §3 列出的所有负担都不会落到 AI 头上，同时保留了逃生舱。

### 7.3 若仍要降低"隐式"程度：用调用点显式消费覆盖（方案 G），不要推翻模型

Onshape `keepTools` 思路的外科手术式移植，只加一个可选参数，不改模型：

```js
let part4 = cad.union(part1, part3, { keep: ['part3'] })   // part1 被吃，part3 保留
```

- 加法式改动，既有代码全部不受影响；
- 只覆盖**真正有歧义**的多入算子，不要求每个调用都写；
- 仍然是 append-only，不破坏身份契约；
- 消费判定仍是 faijs 的事（调用点参数只是覆盖输入）。

**不建议**的方向：

| 方向 | 不建议的理由 |
|---|---|
| `export`（方案 C） | 语法不可行（§3.4 实测证据） |
| `cad.show()` 注册（方案 D） | 破坏 append-only；被消费时要**删中间行**，直接违反身份契约 |
| Context + `q*` 查询 DSL（方案 E） | 需要把纯函数改成副作用模型，推翻 VM 执行、增量缓存、变量名引用三套机制，收益（消费显式）已由符号表部分获得 |
| Body + Tip 指针（方案 F） | 单一 Tip 表达不了 split / boolean 的 DAG |
| 逐语句 `visible` 标记（方案 H） | 把 UI 可见性塞进几何参数，违反「faijs不处理UI状态，只处理几何」 |

### 7.4 判定矩阵（对 faijs 的适配度）

| 方案 | AI 负担 | UI 生成负担 | 破坏 append-only | 与"判定在 faijs"一致 | 与"纯函数/VM"一致 | 综合 |
|---|---|---|---|---|---|---|
| A DAG 活跃性 | ✅ 零 | ✅ 低 | ✅ 否 | ✅ | ✅ | **最优** |
| A + return 覆盖 | ✅ 零 | ✅ 低 | ✅ 否 | ✅ | ✅ | **最优（推荐）** |
| B 强制 return | ❌ 高 | ❌ 高（维护尾行） | ❌ 改尾行 | ❌ 判定移到 UI | ✅ | 差 |
| C export | — | — | — | — | — | **语法不可行** |
| D show() 注册 | ❌ 高 | ❌ 高（删中间行） | ❌ 是 | ❌ | ❌ 需副作用 | 差 |
| E Context + query | ⚠️ 中 | ⚠️ 中 | ✅ 否 | ✅ | ❌ 需副作用 + DSL | 成本过高 |
| F Body + Tip | ⚠️ 中 | ⚠️ 中 | ✅ 否 | ✅ | ⚠️ 需容器类型 | 表达不了 DAG |
| G 调用点 keep | ✅ 低 | ✅ 低 | ✅ 否 | ✅ | ✅ | **可选增强** |

---

## 8. 证据索引（本文所有 file:line 均来自实际读取，非推测）

**faijs（`C:\my\Faicad\faijs`）**
- `src/lang/parser.ts:512-515` — 扁平代码自动封装为 `export default async (cad) => { … }`
- `src/lang/parser.ts:651-656` — `ReturnStatement` 解析为 `meta` / `terminalShapes`，不进 `statements`
- `src/cad-runtime/runtime.ts:629-646` — 显式 `terminalShapes` 优先于 `computeLeafTerminals`
- `src/cad-runtime/runtime.ts:365` — `append(script, newIds)` 只执行新增语句
- `src/cad-runtime/terminal-dag.ts:31-64, 76-122` — `consumes()` 与 `computeLeafTerminals()`
- `src/lang/symbol-table.generated.ts` — group/assembly 的 `readonlyPaths:['members']`、copy 的 `readonlyPositions:[0]`
- `src/lang/allocate-id.ts:20-22, 98-106` — `PART_TOKEN_RE` 扫描文本取 `max+1`

**FreeCAD（`C:\git\F-cad\FreeCAD`）**
- `src/Mod/Part/App/AppPartPy.cpp:972-1003` — `Part.show()` 的 C++ 实现（`addObject<Part::Feature>` + `Shape.setValue` + `purgeTouched`）
- `src/Mod/Part/App/AppPartPy.cpp:471-475` — `"show(shape,[string]) -- Add the shape to the active document or create one if no document exists. Returns document object."`
- `src/App/Document.cpp:3755-3767` — `getUniqueObjectName` → `makeUniqueName(cleanName, 3)`
- `src/Gui/ViewProviderDocumentObject.cpp:64` — `ADD_PROPERTY_TYPE(Visibility, (true), …, "Show the object in the 3d view")`
- `src/Mod/Part/App/BodyBase.h:54` — `App::PropertyLink Tip;`（注释 `resulting shape to the outside (Tip link)`）
- `src/Mod/PartDesign/App/Body.cpp:96-133, 246-248` — 从 Tip 回溯重建；加实体后移动 Tip
- `src/Mod/PartDesign/App/Body.h:131, 166` — `setShowTip(bool)` / `bool showTip`
- `MACRO_ANALYSIS.md §4.2` — `Command::_runCommand`：先 `addLine` 录制、后 `runString` 执行
- `src/Mod/Spreadsheet/App/Spreadsheet.FCMacro:16` — 真实宏：`App.activeDocument().addObject('Spreadsheet::Sheet','Spreadsheet')`

**Onshape（`C:\git\new\onshape\onshape-std-library-mirror`）**
- `context.fs:13-27` — Context 是 Part Studio 的唯一建模数据容器
- `extrude.fs:547-548` — `opExtrude(context, id, definition)`，无返回值
- `extrude.fs:552-555` — `qCreatedBy(id, EntityType.BODY)` 引用几何
- `extrude.fs:704` — 中间体（中性面）用完显式 `opDeleteBodies`
- `boolean.fs:77, 108, 229` — `keepTools`（默认 `false` = 吃掉工具）
- `tool.fs:66-76` — `NewBodyOperationType { NEW, ADD, REMOVE, INTERSECT }`
- `deleteBodies.fs` — 独立的 "Delete part" 特征，封装 `opDeleteBodies`
- `debug.fs:57-96` — `debug(context, value, color)`：高亮显示但不进模型
- 统计：265 个 `.fs` 文件，72 个文件含 `defineFeature`
