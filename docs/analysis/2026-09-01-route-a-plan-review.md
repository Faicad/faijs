# Route A（fai.js 直执管线）实施计划评审意见

- 评审日期：2026-09-01
- 评审对象：[docs/analysis/2026-09-01-route-a-fai-js-implementation-plan.md](./2026-09-01-route-a-fai-js-implementation-plan.md)
- 前置分析：[two-routes-control-flow-and-lib-import.md](./2026-09-01-two-routes-control-flow-and-lib-import.md)、[route-a-library-author-contract.md](./2026-09-01-route-a-library-author-contract.md)
- 评审方式：通读方案与两份前置分析；对方案引用的现状代码坐标逐项核实（runtime / module-executor / runtime-state / define-op / compile / module-resolver / parser）；在 Node v22 复现 `new Function + with(Proxy)` 机制与关键边界；扫描全部 43 个 `.fai.js` fixture；核对宿主项目 3d_editor 的真实调用点。

## 总体结论

**方向可行，但现稿不能直接开工——评审结论：有条件通过（Approve with required changes）。**

路线选择本身成立：Node v22 复现了 `new Function + with(Proxy) + async IIFE` 机制，let/const/class/var/函数声明/解构/循环/闭包/内置对象全部可运行；方案对现状的大部分抽查断言也属实（origin 来自 PartName、outputs 键是 ctx 变量名、`plan()` 无生产消费、3d_editor 只走文本 `execute()`、43 个 fixture 中仅 1 个容器、fixture 零 `var`）。

但有 **1 个被实测证伪的关键伪代码错误**、**1 类系统性盲区（语句边界职责盘点不全）**，以及一批宿主契约层面的遗漏。以下按严重度分级。

## 一、阻断项（开工前必须补设计）

### 1. S4 的 scope 伪代码自相矛盾，按原文写必崩（已实测）

方案 S4 规定 `has` 对 `__faijs__` 前缀返回 **false**，同时 `get` 第①分支返回 persist。按 ECMAScript 规范，`with` 环境在 `HasBinding=false` 时会**跳过 proxy 继续向外层查找**，根本不会调用 `get`——第①分支是死代码。实测（Node v22）：

```text
A FAIL: __faijs__persist is not defined     ← 方案原文（has 对前缀返回 false）
B OK                                        ← has: () => true、get 第一分支返回 persist
```

改成 `has: () => true`、`get` 第一分支返回 persist 后，let/解构/var/函数声明/class/循环/闭包/内置对象全部通过。方案"必须点①"表格里的因果（"`has:()=>true` 会把注入名遮蔽成 undefined"）是**写反的**。方案声称这些"全部为上一轮 node 探针实测"，实际这段没有跑通过。P1 spike 的第一颗纽扣就错了，必须先补一个真正跑通的最小闭环。

### 2. 系统性盲区：要删的 module-executor，其"语句边界职责"只盘点了 1/3

方案 §2.4 对 `lang/` 四个工具做了消费方审计，却**没有对即将删除的 `module-executor` 做同构审计**。现状 `executeIds/afterStatement` 在每条语句边界上承担 8 项职责，S1–S7 只承接了其中 3 项（ctx 产出、终端判定、handle 释放），其余 5 项无主，且每一项都有真实消费方：

| 现状职责（module-executor） | 消费方 | 方案 S1–S7 是否承接 |
| --- | --- | --- |
| ctx 写入 / outputCache | outputs | 已承接：S5 ctx 即持久变量容器 |
| 终端叶子判定 | terminals | 已承接：S6 consumed WeakSet 对象图 |
| 旧 BREP handle 替换释放 | brepChain | 已承接：R-4 dispose + 全量重跑 |
| `setCurrentStmt(source)` | `keep()/keepHidden()` 运行时：`if (!stmt \|\| !keepSink) return`（runtime-state.ts:360） | **无主：currentStmt 为空时函数体 keep 静默 no-op，违反 I-5** |
| `setName(v, w)`（逐语句执行中写入） | **stdlib `compound.ts` 的 `group/assembly` 在执行中调 `nameOf(member)` 取成员名**，约束固定件判定依赖它 | **无主：方案只在结尾 persist 时命名，执行中名字为空 → 装配成员名静默丢失，I-3「stdlib 零改动」不成立** |
| 身份槽 → `solidCache/faceEvolutionCache/roleTableCache` 同步 | `brepSolids / topology / naming`（collectResult） | **无主：没有任何 stage 负责** |
| `beforeStatement(stmtId, index)` 宿主钩子 | **3d_editor `executeScript.ts:186` 用它做逐语句撤销快照（statement 粒度 undo）** | **无主：整段函数执行没有语句边界，宿主能力回退** |
| `emitBrepLost` / `applyPendingAssemblyTransforms`（含下游 DAG 重放）/ `changed` 推导 | UI toast、P6 装配、ExecutionResult.changed | **无主：唯一调用点就在将被删的 afterStatement** |

根因是第一性的：**路线 A 把整段脚本作为一个 JS 函数执行，天然不存在"语句边界"，而现有引擎有 5 个子系统挂在这个边界上。**

建议把 S1 扫描器升级为**轻量插桩层 S1'**：同一次顶层语句 AST 遍历，在每条顶层语句前后注入 `__faijs__before(line, declaredNames)` / `__faijs__after(...)` 钩子，统一承接 currentStmt、setName、槽缓存同步、beforeStatement、brep-lost。这比在 P3 被 39 个 fixture（尤其装配类）逐个炸出来便宜得多。

另外注意方案完全没提的 **append + 装配**场景：现状追加 `do_assemble` 后靠 `executeFrom` 重放依赖成员的前缀语句；路线 A 的 append 只跑新增文本，前缀不会重跑，成员被变换后前缀产物是陈旧的。需规定：append 检测到装配/约束操作时自动升级为全量重跑（与 update 同策略），或补重放设计。

## 二、重要风险（应写进方案，不补会在 P3/P5 返工）

1. **CSP：`new Function` 比现状 Blob `import()` 更苛刻。** 现状动态执行用 Blob URL 模块，只需 `script-src blob:`；`new Function` 额外需要 `'unsafe-eval'`，而这是企业 CSP / 浏览器扩展 / 部分 WebView 最常禁的令牌。3d_editor 仓库当前没有 CSP（已查），但同级还有 Tauri/Electron/web 三个壳。**这是外部 go/no-go 条件，必须进 P0**，否则整条路线在某个宿主直接不可用。
2. **D1-b 全局白名单不是沙箱，别写成安全边界。** `({}).constructor.constructor('...')()` 从任意字面量即可绕过白名单拿到 Function 构造器；它的真实价值只是"防手滑污染全局"的卫生层。方案里"堵住最直接攻击面"的措辞过强，且白名单**绝不能放行 `globalThis`**。真隔离只能靠 Worker（D1-a），建议正文如实定位。
3. **错误行号提取只在 V8 成立。** `at eval (...<anonymous>:L:C)` 是 Chrome/Node 的栈格式，Firefox/Safari 不同；方案仅在 Node 探针验证。3d_editor 是浏览器产品，需要跨引擎策略（特征探测 + 无法提取时降级为整段报错）。
4. **`check()` 存在隐式同步→异步破坏。** D12-a 要做 import 可解析性与 contractVersion 校验，就必须真正 `import()` 模块（异步）；而现状 `check()` 是同步的，CLI、demo、3d_editor 全部同步调用。建议拆成同步 `check()`（语法+预检）+ 异步 `checkImports()`，不要悄悄改签名——若改签名必须进 P8 迁移表。
5. **R3 的真正难点被一句话带过：resolveImports 的解析表谁来喂。** resolver 是纯改写函数，需要宿主提供 `imports: { 裸说明符 → URL }` 表（resolver.ts:26），S2 没设计这张表的来源（HostPorts 注入？registerLib 同步登记？importmap？）。浏览器里用户库裸说明符如何变成可加载 URL，是"fai.js 引库"的命门。另外要在正文显式承接契约结论：**被 import 的建模库必须是只导出函数的普通 ESM**（函数内部自行 import op 库）；带顶层建模语句的 `.fai.js` 无法被 `import()`——因为 import 发生时没有 scope 注入，没有 cad。
6. **`activeValues` 是宿主可见字段，方案全文未提。** 3d_editor `ScriptEngine.ts:1245` 把 `result.activeValues` 写入 UI store。现状语义是"非几何 DAG 叶子"；路线 A 下所有顶层 `const n = 4` 都会 persist 进 ctx，朴素 ctx 扫描会把中间标量全部变成 active 值，UI 内容随之变化——违反 I-1。必须复刻叶子过滤规则。同理 S7 说"沿用 collectResult"低估了工作量：`collectResult` 对 ScriptIR 的依赖还包括 compounds 成员提取、brepSolids、naming，建议单列 S6.5 结果组装设计。
7. **失败路径的 ctx/handle 回滚语义没有规定。** 现状保证"执行失败时 ctx/缓存保持执行前状态，旧 handle 成功后才释放"。VM 执行中 set trap 会逐步写 ctx，throw 后留下半成品。execute/update 有 dispose+全量重跑兜底，但 **append 失败**时前缀必须完好、本次新增键要回滚（执行前快照 keys，catch 中恢复）；run 级 recorder/keepSink/backends 这些 globalThis 单例必须 try/finally 复位（含失败路径）。
8. **全局单例的并发窗口从"一条语句"扩大到"整段 run"。** runtime-state 全挂 globalThis；现状交错窗口是一条语句，路线 A 下是整段脚本执行。预览执行与主执行/导出并发时，await 点会串台。需明确单飞假设，或用 AsyncContext 隔离。
9. **容器 `return { shape, name }` 的元信息通道丢失。** parity-screw 的 return 现承担两件事：显式 terminals、`meta.name`（CLI `cli.ts:194` 用它命名导出文件，color/metalness/roughness 同路）。VM 下 async IIFE 的返回值被丢弃，"只去容器"的迁移配方不完整——要改用 `keep()` 并补元信息替代通道，否则这个 fixture 不是"原样可用"。
10. **BREP 链 × 控制流是零覆盖新地形。** 循环里同名重复赋值（`base = subtract(base, hole)` 跑 N 次）会让按 PartName 键控的 faceEvolutionCache/roleTableCache 反复覆盖；face evolution 原本建立在"一名一语句一次"的假设上。现有 parity 测试全部无循环，R-1 只讨论了链切换，没讨论同名缓存语义，需要专项探针测试。

## 三、规格缺口与事实性错误（较小，但要改）

- **S1 顶层名收集必须遍历解构 pattern（含 `{front: part1}` 重命名）和多声明符。** 这不是假想：现有 `split.fai.js`、`split-dag.fai.js` 两个真实 fixture 正是 `const { front: part1, back: part2 } = cad.split(part0)`，按现稿"收 let/const 名"会静默丢输出（违反 I-5）；`let a=1,b=2` 同理；`for (const x of ...)`、块内声明不得误收。
- **S1"只扫描不拒绝"过头**：`export`（new Function 直接 SyntaxError）、`import.meta` 必须在扫描期给友好错误；顶层 `this/arguments` 与 ESM 语义不同，需写明。
- **S3 import 剥离"替换为等数量 `\n`"会造成行漂移**（已实测：`import x; const z=1` 同行时 z 从第 1 行漂到第 2 行）。正确掩码是逐字符替换：原 `\n` 保留、其余字符换空格。
- **AC-7 不可能达成**：`keep.test.ts` 顶部就 import 了 parseScript/compileToModule/scriptIRToCode/computeLeafTerminals/ModuleExecutor 并手搓 StatementIR，P4b 删完后该文件无法编译；其中"生成代码包含某字符串"的编译层断言在新架构无对象可测。应改为"行为用例迁移为 VM 文本测试"，删掉"断言一行不改"。
- **行数账实不符**：parser.ts 实际 1261 行（稿称 1469）；types.ts 整个文件才 212 行，稿称"删 IR 部分 263 行"。AC-8 净减方向大概率仍成立，但逐文件数字需重算（runtime.ts 的行号引用是准的，parser.ts 的引用整体偏旧，如红线实际在第 6 行而非 22–23）。
- **S6 `isShapeLike` 必须包含 compound-like**：group/assembly 产物不是 mesh，宿主靠 terminals 找到它们再展开成员；keepHidden 的 hidden 标记也需要 run 级 recorder 承接，现稿无此设计。
- **D14 行号作 id**：同一行多条语句会撞键，需注明。
- **freeVars 是真正的作用域分析**：嵌套函数参数、catch 形参、块级绑定都要排除，朴素 AST walk 会误报导致 append 误拒。
- **IDE/lint 体验**：注入式 `cad` 对静态分析是未声明变量（eslint no-undef、TS 报错、无补全）。建议提供 ambient `.d.ts`，或文档首推 D9 已允许的显式 import 写法。
- 只存在于数组/闭包中、未赋给顶层变量的 shape，对象图终端判定不可见（现状静态 DAG 行为一致，但应写明边界）。

## 四、对分期计划的具体修改建议

1. **P0 增补三件事**：
   1. 按修正后 scope 跑通 new Function 最小闭环（含解构/循环/函数声明）；
   2. 各宿主壳（3d_editor/Tauri/Electron/web）CSP `unsafe-eval` 验证；
   3. 语句边界插桩 PoC，证明 5 项红色职责可由 before/after 钩子承接。
2. **S1 → S1'**：扫描 + 顶层语句轻量插桩；补解构/多声明符遍历、export/import.meta 拒绝。
3. **S2 补**：解析表来源与注入位置、副作用-only import 仍需 await、命名导入别名与 default 形式。
4. **S3 修正**为逐字符掩码；新增 **S6.5**：activeValues/compounds/brepSolids/topology/naming/brep-lost/changed 的结果组装设计。
5. **P8 迁移表补四行**：beforeStatement（宿主 undo）、check 异步化拆分、return-meta 通道、append 遇装配自动升级全量。
6. **修正 AC**：AC-7 改为行为迁移、AC-8 重算行数；新增"循环 × BREP 同名重复赋值"parity 探针用例。

## 五、总结

路线 A 的技术方向和净收益判断是对的，方案的现状调研也明显经过实地核查，质量在水准之上；但它对旧引擎"语句边界"这一抽象的拆除后果估计不足（这恰是它在 §2.4 展示过的审计能力，只是没用在 module-executor 自己身上），加上核心 scope 伪代码被实测证伪。补齐 P0 三项与 S1'/S6.5 后即可开工，不需要推翻路线。

## 附：评审中的实测与核实记录

- Node v22 探针：方案原文 scope（has 对前缀 false）→ `ReferenceError: __faijs__persist is not defined`；修正为 `has: () => true` 后，let/const/class/var/函数声明/解构（含重命名）/多声明符/循环/闭包/内置对象全部通过。
- Node v22 探针：import span 用等数量 `\n` 替换会导致同行后续语句行号漂移；逐字符掩码（保留原换行）无漂移。
- fixture 全量统计：共 43 个 `.fai.js`；仅 parity-screw 1 个 `export default` 容器；零 `var`；2 个文件使用对象解构（split、split-dag）；仅 1 个 apiVersion 头。
- 代码坐标核实：runtime.ts（execute/append/update/plan/check/collectResult）、module-executor.ts（executeIds/afterStatement/applyPendingAssemblyTransforms）、runtime-state.ts（currentStmt/keepSink/shapeToName/backends 全局单例）、define-op.ts（op 包装器不依赖 exec，经 getBackends 取全局状态）、compile.ts、module-resolver/resolver.ts（纯改写、解析表外部注入）、parser.ts（1261 行）。
- 宿主核实（3d_editor）：脚本执行只走 `runtime.execute(code, { beforeStatement })` 文本入口；消费 `result.terminals / failedAt / activeValues`；statement 粒度 undo 依赖 beforeStatement 钩子；未消费 plan/executeIR/getMaxModelNum。
