# faijs 引擎 ↔ 语言实现（库）契约：重新设计与实施方案

- 日期：2026-08-29（v2，按用户两轮反馈重写）
- 状态：设计待裁定（**仅写方案，未改任何代码**）
- 上位文档：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位唯一权威）
- 相邻文档：`docs/syntax-design.md`、`docs/plans/2026-08-28-faijs-ecosystem-roadmap.md`、`docs/plans/2026-08-28-keep-syntax-design.md`、`docs/plans/2026-08-29-faijs-normal-js-subset.md`
- 参照实现：
  - `C:\git\new\onshape\onshape-std-library-mirror`（FeatureScript 标准库，265 个 `.fs`）
  - `C:\git\OpenCascade\brepjs`（内核无关的 BREP 库，多内核 + 第三方库生态）

---

## 0. 需求与约束

### 0.1 用户原话（需求基线，不准删改）

来自 `Faijs语言的思考.md`：

> 4. faijs引擎负责代码的解析与校验，提前杜绝错误和安全风险。但是执行完全交给js虚拟机。
> 5. 几何运算全部交给faijs语言库来实现，faijs引擎不内置。
> 6. faijs不处理UI状态，只处理几何。这是它和freecad宏之类的语言的最大区别。
> 7. faijs可以UI录制，按行增量执行。这是它和cadquery、openscad之类3D建模语言最大的不同。

> faijs是通用语言，并不是一个什么op相关的语言。op就是函数，这是长期的方向。未来的第三方库，它就是写代码，实现function。不需要知道什么op这种概念。

> 必需再次强调，faijs必需是正常的语言，必需正常的设计。所有不符合这个要求的设计，都要给我去掉，目前的代码如何实现的不重要。唯一的例外，faijs必需是UI能够自动生成代码，比如AI/UI生成的代码能够和谐共存。

> 先解析后执行， 纯函数链 ， 这两点是过时的说法。

本轮反馈（2026-08-29，两轮）：

> Faijs与UI的唯一耦合点，是keep语法，也就是指明哪些shape需要保留/显示在UI中。feature特征的定义，绝对不再faijs中，这个在上层的应用中。比如../3d_editor里定义。这是faijs与onshape的最大差别。让你参考onshape的接口定义的时候，不要把feature特征这块抄过来。

> 库函数签名 = 源码里写的样子。禁止隐式注入。 这是正确的。
>
> 但是文档里写的禁止全局单例、禁止让库 author 感知"引擎"的存在，不知道什么意思？这个和我的想法不同。
>
> 你需要的是设计一个合理的接口契约，而不是一刀切的禁止。每一个功能到底谁来实现，要仔细思考。比如keep，大部分情况下，引擎侧自动处理了，但是库作者可以定义自己的默认值。类似的，其它的情况引擎侧和库代码侧，到底应该如何界定双方的职责，要自己考虑。

### 0.2 硬约束（K）

| # | 约束 | 含义 |
|---|---|---|
| **K1** | **库函数签名 = 源码里写的样子，禁止隐式注入** | `cad.box({size})` 编译为 `cad.box({size})`，参数一个不多一个不少。禁止编译期凭空追加末参；禁止"签名无形"（`rest.pop()` 取上下文） |
| **K2** | **几何运算在库** | 引擎不内置任何几何算法，也不实现任何几何函数。引擎只负责调度、记账、提供资源 |
| **K3** | **keep 是唯一 UI 耦合点** | faijs 不定义 feature、不定义 UI 表单、不定义图标/编辑面板。这些全在 3d_editor |
| **K4** | **纯函数链已过时** | 不能把「函数返回新 Shape、不原地改写」当作推理前提 |
| **K5** | **引擎零函数知识** | parser/compile/runtime 不得按函数名分支，也不区分任何函数类别——**引擎里只有库函数**（faijs 自带标准库与第三方库没有类别之别）。函数信息只能是均匀数据 |
| **K6** | **UI/AI 共享一份代码** | 两者收敛到同一 `ScriptIR`，引擎不区分来源 |

> **v1 的两条错误禁令已撤回**（用户指出"不知道什么意思""和我的想法不同"）：
> ~~禁止全局单例~~ —— 全局/模块级**环境配置**（内核注册表、Shape 身份 WeakSet）是正常语言的通行做法（brepjs `registerKernel`、three.js `ColorManagement`），不是隐式注入。见 §6.1 的区分标准。
> ~~禁止让库 author 感知引擎的存在~~ —— 库作者当然知道自己为 faijs 写库（他要 `import` faijs、要写声明）。真正要禁的是**库访问引擎的内部可变状态**，不是"感知存在"。见 §6.4。
>
> **编号约定**：本文档用 **K**（约束）、**S**（从参照实现学的原则）、**A/B/C**（契约的三个面）、**F**（禁令）、**P**（分期）、**O**（开放问题）。
> 文中出现的 **C0/C1/C3/C5** 一律指 `keep-syntax-design.md` 的**消费判定规则**，与本文档编号无关。

---

## 1. 结论速览

| 面 | 现状 | 目标 |
|---|---|---|
| 库函数签名 | `(…args, exec)`，exec 编译期凭空追加 | **`(…args)`**，与源码逐字一致 |
| 库获取后端 | 运行时从 `exec` 索取 | **模块级后端注册表**（`configureBackends()` + `getBackends()`），brepjs `registerKernel` 模式 |
| 第三方库形态 | `import '@faicad/faijs/sdk'` + 自造装配协议 | **普通 npm 包：`import { box, union } from '@faicad/faijs'`**（brepjs / cq_gears 模式） |
| BREP 槽登记 | 库手动 `exec.setSolid(...)` | **构造器登记**（`fromBrep(mesh, holder)`），库零记账 |
| 双链路分派 | 每个库函数自调 `resolvePath` | **引擎统一分派**，库在函数定义处声明能力（挂在函数对象上） |
| 保留语义 | 运行时 `exec.keep(...)` | **默认消费 → 库函数体 `keep()`（import 得到，非注入）→ 调用点 `keep` 最高**（§8） |
| 求值型识别 | 运行时推断（C3） | **引擎运行时判据**（输出值非几何 → 不消费）。引擎拿不到类型，不靠形态推断（§8.4） |
| 编译产物 | `async (ctx, cad, exec) => {}` | **`async (ctx, ns) => {}`** |
| feature/annotation | —— | **不引入**（K3） |

一句话：**取消隐式注入之后，剩下的不是"什么都不许有"，而是"每一项职责各归其位，且都可被更具体的一方覆盖"。**

---

## 2. 现状诊断：契约的四层错位

> 判定原则：**声明的契约不是实际契约**。以下每条都附代码证据。

### 2.1 错位一：隐式注入末参（违反 K1）

`compile.ts` 在 4 个发射点机械追加 `, exec`（`:178` `:187` `:192` `:196`），嵌套调用再追加一次（`:84`）。源码 `cad.box({size})` 编译为 `cad.box(ctx.size, exec)`——**调用方没写第三个参数**。

### 2.2 错位二：声明的接口不是实际接口（向下转型）

`ExecContext` 接口（`exec-context.ts:49-90`）有 20 个字段。但库函数实际访问的是**实现类 `ExecContextImpl` 的字段**：

| 位置 | 越权访问 | 是否在接口里 |
|---|---|---|
| `stdlib/drill.ts:143` | `(exec as ExecContextImpl).brepChain.partTransform` | ❌ |
| `stdlib/drill.ts:169` | 同上（mesh 路径） | ❌ |
| `stdlib/compound.ts:263` | `exec.currentStmt?.args?.members` | ⚠️ 在接口里，但 IR 属引擎内部 |
| `exec-context.ts:266` | `setVariable`（`ExecContextImpl` 专有方法） | ❌ |
| `exec-context.ts:141` | `shapeToName` / `:144` `touchedShapes` | ❌ |

**库函数靠 `as ExecContextImpl` 向下转型绕过接口**。这意味着 `ExecContext` 这份"契约文档"是摆设——真正的契约是"整个引擎实现对象都对你开放"。这比隐式注入严重得多：隐式注入至少还是一份有界的 API，这里是**无界**。

### 2.3 错位三：库反向掏引擎内部状态

`compound.ts:257-272` 的 `deriveMemberNames` 在**运行时读 IR**：

```ts
const stmtMembers = (exec.currentStmt?.args?.members as unknown[] | undefined) ?? []
```

函数存在的唯一原因是：**引擎没有把成员变量名传给库**（引擎知道 `args.members` 是 `VarRefIR[]`），库只能回头去掏语法树。

### 2.4 错位四：执行态与持久对象的生命周期冲突

`compound.ts:310-315` 的注释自陈：

```ts
;(c as CompoundShape & { do_assemble?: (e: ExecContext) => void }).do_assemble = (e: ExecContext) => {
  // 用当前执行上下文求解：分次 append（3d_editor appendAndCommit）时
  // 每次 runtime.append 新建 exec，touch/变更声明必须落在当前 exec 上
  behavior.solve(e)
}
```

`assembly()` 闭包捕获了 `exec`（`:307`），但 exec 是**逐次新建**的 → compound 是持久对象、exec 是短命对象 → 只能用"每次显式再传一个 exec"补救。**生命周期不匹配，靠打补丁**。

### 2.5 附：签名无形 + 库干引擎的活

- **签名无形**：`geom.ts:73-79` `faceCenter(...rest)` 用 `rest.pop()` 取 exec——类型系统彻底失效。
- **库干引擎的活**：`compound.ts:237` `exec.dependentsOf(shape)` 是**图算法**（依赖整张 `ScriptIR`）；`:239` `Object.assign(downstream, ...)` 是**手工下游传播**。这两件事都属于 DAG 所有者（引擎）。

### 2.6 一个被推翻的前提：C3 推断

`keep-syntax-design.md` §3.2 为 C3 写的论证是：

> faijs 的执行模型是**纯函数链**（几何函数返回新 Shape，不原地改写……）。在此模型下「返回非几何的函数不可能把几何吞进结果」是必然推论。

用户已裁定**"纯函数链"是过时的说法**（§0.1），而 `compound.ts:222,239` 的 `Object.assign` 就是原地改写的实例。

→ **C3 的推理前提不成立**。处置方式：**去掉那条伪论证，保留规则本身**——它真正依赖的是"输出不是几何"这个运行时事实，与纯函数链无关（§8.4）。

---

## 3. 为什么上一版方案（platform-api）不够

`2026-08-29-faijs-platform-api-design.md` 提出：全局锚点 + `import { keep } from '@faicad/faijs/sdk'`。方向对了一半（取消 exec），但：

| # | 问题 | 说明 |
|---|---|---|
| **P1** | 只是换了个地方索取 | 把"引擎凭空加的参数"换成"库凭空读的全局"，耦合面没减。真正的病灶（§2.2 向下转型、§2.3 掏 IR、§2.4 生命周期）一条没治 |
| **P2** | 三类职责没做分类 | exec 里混着：①**资源**（kernels/fonts/assets）②**记账**（getSolid/setSolid）③**意图声明**（keep/touch）。搬家不改职责 |
| **P3** | 把"静态事实"留在运行时 | keep、brepImpl 都是**关于函数的静态事实**，却用运行时调用表达 |

**根本分歧**：前方案问"平台能力该从哪拿"，本方案问"**每一项职责该由谁承担、谁可以覆盖**"（§5）。

> ⚠️ v1 版本的另一个错误（本版修正）：v1 主张"用工厂注入取代全局锚点、SDK 作废"。读完 brepjs 后确认这是**过度设计**——brepjs 用模块级内核注册表（全局配置）+ 库 `import` 宿主包，既正常又简单。v1 发明的 `install(deps)` 装配协议反而是 faijs 专属魔法，比 `import` 更不正常。见 §6.1。

---

## 4. 参照实现：学什么 / 不学什么

### 4.1 Onshape FeatureScript

**不抄**（K3 + 架构差异）：

| 机制 | 证据 | 为什么不抄 |
|---|---|---|
| `defineFeature` / `annotation` / `precondition` / `UIHint` / `"Feature Type Name"` | `feature.fs:47`、`primitives.fs:30-42`、`uihint.gen.fs`（49 个 UIHint 值） | **用户本轮明确裁定**：feature 定义绝不在 faijs，在上层 3d_editor。这是 faijs 与 Onshape 的最大差别 |
| `op*` 引擎原生原语（约 90 个） | `primitives.fs:110-120`、`geomOperations.fs` | Onshape 的 op 是 C++ 引擎原生操作（约 90 个）。faijs **几何运算全部在库**（K2）：引擎不实现任何原生几何操作，只执行库函数 |
| `Query` 惰性拓扑查询 | `query.fs:9-36` | Query 服务于 Onshape 的**历史型增量建模**。faijs 是**全量重放 + 变量引用**：改参数 → 下游链重算，引用（`PartName`）天然重新求值。拓扑命名由"重放 + faceEvolution"覆盖 |
| `Context` 全局模型数据库 | `context.fs:12-30` | faijs 的"context"是**持久 `ctx` 变量容器**（`module-executor.ts:67`），几何由库产出后挂在变量上 |

**学**（S，均不含 feature）：

| # | Onshape 做法 | faijs 迁移 |
|---|---|---|
| **S1** | 几何归属单一：特征不持有 body，往 context 提交 | Shape 身份与 BREP 槽由**引擎侧构造器**持有，库只产出数据（§7） |
| **S2** | Id 分层反映创建历史（`context.fs:88-140`） | faijs 已有 `StmtId`/`PartName` 两个命名空间（**保持**）；错误/事件归属由引擎按 StmtId 补（§10.3） |
| **S3** | 求值型与构造型显式分野：`ev*` 只读 vs `op*` 修改 | faijs **不引入类型/形态声明**：引擎拿不到类型，求值型由**运行时判据**识别（§8.4）；库需要时直接调 `keep()` 表达 |
| **S4** | 错误携带归属：`throw regenError` + `id`（`feature.fs:66-84`） | 库只 `throw`；**引擎在调用点挂 stmt 归属** |
| **S5** | 版本协商 `isAtVersionOrLater`（`primitives.fs:96`） | 装配期校验 `CONTRACT_VERSION`（§11.4） |

### 4.2 brepjs（更直接的参照：同为 TS、多后端、有第三方库生态）

| brepjs 做法 | 证据 | faijs 迁移 |
|---|---|---|
| **模块级内核注册表**：`registerKernel(id, adapter)` / `getKernel()` / `withKernel(id, fn)` | `docs/kernel-swap_cn.md:51-101` | **后端注册表**：`configureBackends()` + `getBackends()`（§6.1）。这是"环境配置"，不是隐式注入 |
| **库 = 普通 npm 包，import 宿主包** | `docs/dynamic-third-party-library-loading_cn.md:206-214`（`my-gear-lib` 的 `import { sketchExtrude, cut } from 'brepjs'`） | 第三方库 `import { box, union } from '@faicad/faijs'`（§11）。**v1 的 `install(deps)` 协议作废** |
| **`KernelShape` 是不透明句柄**；约定"Layer 2+ 代码永不在句柄上调方法，只传回给内核方法"，用 ESLint 规则强制 | `docs/kernel-swap_cn.md:167-176` | Shape 的 BREP 句柄同样是不透明的；库只**登记**句柄，不操作引擎的句柄表（§7） |
| **内核方法只返回普通 JS 值**（点 → `[n,n,n]`，新形状 → 不透明句柄） | `docs/kernel-swap_cn.md:178-188` | 库的产出要么是普通数据，要么是经构造器包装的 Shape；不泄漏内核对象 |
| **句柄生命周期**：`Symbol.dispose` / `DisposalScope` / `FinalizationRegistry` | `docs/memory-management_cn.md:10-83` | 释放仍归引擎（顶替释放已有），但**登记归构造器**（§7.2） |
| **多内核测试**：vitest projects 对三个内核跑同一套测试 | `docs/kernel-swap_cn.md:204-238` | faijs 已有 BREP/mesh parity 测试，保持 |
| **单例靠打包去重 / `?external=`** | `docs/dynamic-third-party-library-loading_cn.md:167-175` | 与 roadmap §5.2（预构建 bundle + external）一致；**全局锚点保留为兜底**（§11.3） |

> ★ brepjs 给出的最重要一课：**"库 import 宿主包 + 模块级注册表配置"就能同时满足"正常语言"与"引擎/宿主注入资源"**，不需要任何专属装配协议。v1 的工厂注入是为"多实例隔离"这个**并不存在的需求**做的过度设计（3d_editor 的 CadRuntime 本就是主线程单例，`ScriptEngine.ts:83-93`）。

---

## 5. 职责界定总表（本方案的核心）

> 用户要求："每一个功能到底谁来实现，要仔细思考……引擎侧和库代码侧，到底应该如何界定双方的职责。"
>
> 格式：**默认归属**（没人说话时谁做） → **可覆盖方**（谁有资格改变默认） → **优先级**。

### 5.1 保留与显示（K3，唯一 UI 耦合点）

| 职责 | 默认归属 | 可覆盖 | 说明 |
|---|---|---|---|
| **保留语义**（哪些入参不被消费） | **引擎**（默认消费；求值型按运行时事实豁免，§8.4） | 库（函数体 `keep()`）→ 用户（调用点 `keep`） | 库作者自己声明，**compound 无任何特例**（§8.3） |
| **隐藏与否**（`keepHidden`） | **引擎**（默认值） | 库 → 用户 | 最后一次保留声明胜出（keep-syntax D2） |
| **终端/显示集合推导** | **引擎**（DAG 最后写者 + 下游无消费） | 不可覆盖（faijs 职责，宿主不重复实现） | `terminal-dag.ts` |
| **feature / 图标 / 编辑面板** | **上层应用（3d_editor）** | —— | **不在 faijs**（用户裁定） |

### 5.2 几何执行

| 职责 | 默认归属 | 可覆盖 | 说明 |
|---|---|---|---|
| **几何算法实现** | **库** | —— | K2：引擎不内置任何几何算法 |
| **BREP/mesh 路径选择** | **引擎**（按库声明的能力 + 输入的链状态） | 库在函数定义处声明能力（挂在函数对象上）；宿主设全局 `mode` | 静态判定，禁止运行时回退（红线） |
| **BREP 句柄登记** | **引擎侧构造器**（`fromBrep`） | —— | 库不再手动 `setSolid`（§7.2） |
| **BREP 句柄释放** | **引擎**（顶替释放 + reconcileCtx） | —— | 现状 `module-executor.ts:137-151` |
| **面演化映射（拓扑命名）** | 引擎持有；**库登记**（产物来自 `*WithHistory` 时） | —— | brepjs 同构：库只登记，不解释 |
| **参数语义校验**（直径 > 0 等） | **库** | —— | 引擎只做语法/引用校验（`check`） |
| **单位与坐标系** | **引擎约定**（mm、+Z 上、角度用度） | —— | `docs/api-contract.md` |
| **装配约束求解** | **库** | —— | 纯计算（`compound.ts:136-153`） |
| **装配的下游传播** | **引擎**（失效 + 重算） | —— | 现状由库手工传播，见 §10.1 |

### 5.3 执行与调度（全部归引擎，库不参与）

| 职责 | 归属 | 现状问题 |
|---|---|---|
| 变量命名（`partN`） | 生成侧调引擎服务 | 现状正确，保持 |
| DAG 构建、deps、增量判定 | 引擎 | —— |
| 缓存键 `statementKey` | 引擎 | 需补包名前缀（既有修正 C2） |
| 错误处理与归属（`failedAt` / stmt） | 引擎 | 现状要求库传 stmt（§10.3 改） |
| 事件（`part-brep-lost`） | 引擎 | 现状部分由库 emit（§10.3 改） |
| 拓扑构建 / STEP 导出 | 引擎 | —— |
| 资源释放与回收 | 引擎 | —— |

### 5.4 环境资源（宿主注入，库通过 import 访问）

| 资源 | 谁提供 | 库如何拿到 | 说明 |
|---|---|---|---|
| OCCT / CSG / SDF 后端 | 宿主（HostPorts） | `getBackends().kernel` | 全局配置，**不是隐式注入**（§6.1） |
| 字体 / 纹理 / 资产 / 事件 | 宿主 | `getBackends().fonts` 等 | 同上 |
| 执行模式 / partTransform | 宿主 | `getBackends().config` | 可变引用，运行期可切换 |
| Shape 构造器 | 引擎 | `import { solid, fromBrep } from '@faicad/faijs'` | 内部读全局身份表（§7） |

### 5.5 三面契约与两条禁令

```
┌─ 契约面 A：环境资源 ────────────────────────────────┐
│  宿主 configureBackends(ports) 一次（模块级注册表）    │
│  库 import { getBackends } from '@faicad/faijs'      │
└──────────────────────────────────────────────────────┘
┌─ 契约面 B：Shape 与句柄 ─────────────────────────────┐
│  库产出几何 → 经构造器包装 → 引擎登记身份槽与 BREP 句柄 │
└──────────────────────────────────────────────────────┘
┌─ 契约面 C：保留语义（keep）──────────────────────────┐
│  引擎默认消费；库函数体 keep() 覆盖；调用点 keep 最高    │
│  （库显式 import { keep } 调用，非注入）                 │
└──────────────────────────────────────────────────────┘
```

**两条禁令**（针对 §2.2/§2.3 的真实病灶，不是泛指）：

| # | 禁令 | 精确含义 | 现状违反处 |
|---|---|---|---|
| **F1** | **库不得访问引擎的内部可变状态** | 无 `currentStmt`、无 `script`（ScriptIR）、无 `outputCache`、无 `brepChain`。库要什么信息，引擎要么**作为参数传给它**，要么**由引擎自己处理** | `compound.ts:263`、`drill.ts:143,169`、`exec-context.ts:208-232` |
| **F2** | **库不得查询或修改 DAG** | 无 `dependentsOf`、无 `touch`；禁止原地改写已发布的 Shape | `compound.ts:237,239,242,246` |

> F1 是"库不能读引擎的内部状态"，**不是**"库不能知道引擎存在"。库当然要 `import` faijs、要按 faijs 的协议写声明。区别在于：**公开接口 vs 内部状态**。
> F2 的执行要点：装配的下游传播改由引擎做（§10.1）。

---

## 6. 契约面 A：后端获取（模块级注册表）

### 6.1 关键区分：隐式注入 vs 环境配置

| | 隐式注入（禁止） | 环境配置（正当） |
|---|---|---|
| 形态 | 调用方没写，引擎在编译期往参数列表追加 | 宿主显式调一次 `configure()`；库显式 `import` 访问器 |
| 可见性 | `.faijs` 文本与 `api.d.ts` 里都看不到 | 源码里看得见（`import { getBackends } from '@faicad/faijs'`） |
| 签名影响 | 库函数签名被迫携带引擎类型 | **库函数签名 = 源码形态** |
| 业界例子 | —— | brepjs `registerKernel`、three.js `ColorManagement.enabled`、axios `defaults` |
| 判定 | **K1 禁止** | **允许，且推荐** |

**结论**：v1 写的"禁止全局单例"是错的。模块级**环境配置**不该禁；该禁的只有"隐式注入到函数参数"。

### 6.2 接口

```ts
// @faicad/faijs —— 宿主侧配置（启动时一次）
export function configureBackends(ports: Backends): void
export function getBackends(): Backends

export interface Backends {
  /** 契约版本（S5）：装配期校验，不兼容即抛错 */
  readonly contractVersion: number

  /** 执行配置（可变对象：宿主可在运行期切换 mode / partTransform） */
  readonly config: {
    mode: ExecutionMode
    partTransform?: { position: Vec3; scale?: Vec3 }
  }

  /** 几何后端。occt 异步初始化 → 用 getter */
  readonly kernel: {
    readonly occt: OcctKernel | null   // mesh 模式/未初始化时为 null
    readonly csg: CsgBackend | undefined
    readonly sdf: SdfBackend | undefined
  }

  /** 宿主端口（透传 HostPorts） */
  readonly fonts: FontProvider | undefined
  readonly texture: TextureSampler | undefined
  readonly assets: AssetResolver | undefined
  readonly events: EventSink

  /** faijs 自带标准库命名空间（`cad`）。引擎不区分它与第三方库——所有函数都是库函数 */
  readonly cad: StdlibNamespace
}
```

**要点**：`config` 与 `kernel` 是**可变引用**（对象 + getter），运行期切换模式、occt 异步就绪都不需要重新配置——闭包读的是引用，不是快照。

### 6.3 库的形态（普通模块，无工厂）

```ts
// src/stdlib/primitives.ts（目标形态）
import { getBackends, solid, fromBrep } from '@faicad/faijs/shape'   // 普通 import

export function box(params: BoxParams): Shape {
  assertBoxParams(params)                     // 库的语义校验（§5.2）
  const { kernel, config } = getBackends()
  if (config.mode !== 'mesh' && kernel.occt) return boxBrep(params, kernel.occt)
  return solid(cad.box(params))
}
```

| 判据 | 说明 |
|---|---|
| K1 满足 | `cad.box({size})` 编译为 `cad.box({size})`，参数一个不多 |
| 正常语言 | 库就是一堆导出的普通函数，与 brepjs 的 `src/index.ts` 同构 |
| 可测 | 测试里 `configureBackends(fakeBackends)` 后直接调 `box(...)` |
| 传递依赖 | 库 A 要用库 B：B `import` A 即可（普通 npm 依赖） |

### 6.4 编译产物形态

| | 现状 | 目标 |
|---|---|---|
| 语句 fn | `async (ctx, cad, exec) => {}`（`compile.ts:250`） | **`async (ctx, ns) => {}`** |
| 赋值语句 | `ctx.part0 = await cad.box(ctx.size, exec)` | `ctx.part0 = await ns.cad.box(ctx.size)` |
| 成员调用 | `await ctx.asm1.do_assemble(exec)`（`compile.ts:187`） | `await ctx.asm1.do_assemble()` |
| 嵌套调用 | `await cad.union(ctx.a, ctx.b, exec)`（`compile.ts:84`） | `await ns.cad.union(ctx.a, ctx.b)` |
| 第三方 | `exec.libs.mech.makeHeadstock(...)`（roadmap 规划） | **`ns.mech.makeHeadstock(...)`** |

`ns` 是**命名空间集合**（`{ cad, mech, … }`），所有库函数同形态——`cad` 只是 faijs 自带标准库的默认绑定，引擎不区分函数来自哪个库。

---

## 7. 契约面 B：Shape 与句柄

### 7.1 现状：记账是引擎外包给库的活

```ts
// drill.ts:160-162
const shape = solid(solidToShape(kernel, resultSolid))
exec.setSolid(shape, resultSolid)      // ← 库在维护引擎的资源表
```

库手动记账，是因为 Shape 是库造的裸对象、引擎拿不到里面的 OCCT 句柄。**这是资源托管的缺位**：引擎负责释放句柄（`module-executor.ts:58,149-151`），却让库负责登记。

### 7.2 目标：构造器登记，库零记账

```ts
// @faicad/faijs 导出（构造器内部读全局身份表，roadmap §3.4 锚点）
export function solid(mesh: MeshData): SolidShape
/** BREP 产物：mesh（三角化结果）+ OCCT 句柄 + 面演化，一次登记 */
export function fromBrep(mesh: MeshData, holder: BrepHolder): SolidShape
export function compound(children: Shape[]): CompoundShape
export function hasBrep(shape: Shape): boolean      // 引擎查槽
export function brepOf(shape: Shape): ShapeHandle | undefined

export interface BrepHolder {
  solid: ShapeHandle
  faceEvolution?: Map<number, number[]>
}
```

改造后：

```ts
function drillBrepPath(input: Shape, params: DrillParams): Shape {
  const kernel = getBackends().kernel.occt!
  const upstream = brepOf(input)
  const resultSolid = drillBrep(kernel, upstream, …)
  return fromBrep(solidToShape(kernel, resultSolid), {
    solid: resultSolid,
    faceEvolution: identityEvolution(kernel, resultSolid),
  })
}
```

| 现状 | 改造后 |
|---|---|
| 每个函数 3–5 行 `setSolid`/`setFaceEvolution` | 0 行 |
| "某 Shape 是否在 BREP 链上"取决于库记账是否正确 | 由槽决定，**引擎可查**（`hasBrep`） |
| 库需向下转型拿 `partTransform`（`drill.ts:143`） | `getBackends().config.partTransform`，正当渠道 |
| brepjs 的"句柄不透明"约定 | 一致：库只**登记**句柄，不操作引擎的句柄表 |

### 7.3 双链路分派收归引擎

现状：`resolvePath(exec, inputs, brepImpl)` 由**每个库函数自调**（`copy.ts:57`、`primitives.ts:69,76,83,90,97`、`drill.ts:196`…），`brepImpl` 是函数自带的能力标记。

目标：**能力是函数自己的接口契约**——在**定义处**声明、作为数据挂在函数对象上（K5：函数信息只能是均匀数据）。引擎**不维护任何按函数名查的能力表**，也不认识 `box`/`knurl` 这些名字；分派由引擎统一做，只读函数对象上的数据：

```ts
// 库侧：能力声明在函数定义处（引擎不区分函数来自哪个库——都是库函数）
// dual(meshImpl, brepImpl?)：打包两条实现并挂能力数据；brepImpl 缺省 = mesh-only
export const box = dual(boxMesh, boxBrep)      // 双链路：mesh + brep
export const knurl = dual(knurlMesh)           // 只实现 mesh
```

```ts
// 引擎侧：分派只读函数对象上挂的 brepImpl 数据，不查任何名字表
function dispatch(fn: ShapeFunction, inputs: Shape[]): 'brep' | 'mesh' {
  const { kernel, config } = getBackends()
  if (config.mode === 'mesh') return 'mesh'
  const canBrep = fn.brepImpl !== undefined
  if (config.mode === 'brep') {
    if (!canBrep) throw new BrepUnsupportedError('function has no BREP implementation')
    if (!inputs.every(hasBrep)) throw new BrepUnsupportedError('input is not BREP')
    return 'brep'
  }
  return canBrep && inputs.every(hasBrep) ? 'brep' : 'mesh'
}
```

红线不变：**静态判定，禁止运行时 try-catch 回退**（`AGENTS.md` ⚠️）。`BrepUnsupportedError` 的 `stmt` 由引擎在调用点补（§10.3）。

**函数的两条实现如何暴露**：`dual()` 在定义处打包 mesh/brep 两条实现并挂能力数据；只实现一条时只传 mesh 实现。

> ⚠️ **用户裁定（红线）**：引擎**绝不依赖函数名**。旧稿在此写过 `OpEntry` + `backends: ['brep']` 的按名声明，实施手册 P4b 还写过 `Record<string, boolean>` 能力表——那是引擎**反向依赖 op/函数名字**，绝对不允许存在，本版已全部删除。能力声明的载体是**函数对象本身**（接口契约），不是任何名字表；`dual()` 与引擎都不认识函数名。**faijs 里没有"op"、也没有"内置函数"这一类别**——引擎只认识库函数；faijs 自带标准库的函数与第三方库函数在引擎眼中没有任何区别。

---

## 8. 契约面 C：保留语义（默认消费 + 库函数体 keep）

### 8.1 三层模型

> 用户指出："比如keep，大部分情况下，引擎侧自动处理了，但是库作者可以定义自己的默认值。"
> 并纠正 v2："实现装配库代码的作者，自己在库函数内部调用keep，一切解决了。"

```
  引擎默认：消费（C5，一条规则，不按形态分支）
        ↑ 被覆盖
  库函数体：keep(...) / keepHidden(...)      ← 库显式调用（import 得到）
        ↑ 被覆盖
  调用点：{ keep: [...], keepHidden: true }  ← 用户/UI/AI 的显式意图，最高优先级
```

**v2 的两处错误**（本版修正）：

| v2 做法 | 错在哪 |
|---|---|
| 用"静态声明清单（`OpDeclaration.retain`）"取代库函数体的 `keep()` 调用 | 把"运行时调用"换成"装配期填表"，负担形式变了本质没变。用户要的是**库作者在函数体调 keep** |
| 设计"引擎按形态推导保留"（D-a…D-f） | 与 `keep-syntax` 的 C5（默认消费）冲突，且我一边批评 C3 的"运行时推断不可靠"，一边自己引入"形态推断保留"——自相矛盾 |

**修正后只有一条默认规则**：**默认消费**（`keep-syntax` C5）。需要保留的，库显式调 `keep()`。

### 8.2 `keep()` 的调用入口（取消 exec 后怎么拿）

`keep` 需要知道"当前执行的是哪条语句"。取消 exec 末参后，走**模块级执行上下文**——与 §6.1 的 `getBackends()` 完全同构：

```ts
// @faicad/faijs 导出（库显式 import 并调用）
import { keep, keepHidden } from '@faicad/faijs'

export function group(params: GroupParams): CompoundShape {
  const members = params.members ?? []
  keep(...members)                    // ← 库作者自己声明：成员保留且可见
  return compound(members)
}

export function union(a: Shape, b: Shape): Shape {
  keepHidden(a, b)                    // ← 布尔系：源保留但隐藏
  return unionImpl(a, b)
}

export function copy(input: Shape): Shape {
  keep(input)                         // ← 复制：源保留且可见
  return copyImpl(input)
}
```

```ts
// 引擎侧（cad-runtime/exec-scope.ts）—— 模块级执行上下文
let currentStmt: StatementIR | undefined
export function setCurrentStmt(stmt: StatementIR | undefined): void { currentStmt = stmt }

export function keep(...shapes: unknown[]): void { registerKeep(shapes, false) }
export function keepHidden(...shapes: unknown[]): void { registerKeep(shapes, true) }

function registerKeep(shapes: unknown[], hidden: boolean): void {
  if (!currentStmt) return
  const names = shapes.map(nameOf).filter(Boolean)   // Shape → PartName 反查
  moduleExecutor.registerKeep(currentStmt.id, names, hidden)
}
```

引擎在 `executeIds` 语句 fn 之前 `setCurrentStmt(source)`——**替换现状的 `exec.currentStmt = source`**（`module-executor.ts:140`），改动极小。

| 判据 | 说明 |
|---|---|
| **K1 满足** | `keep` 是库**显式 import 并调用**的函数，不是引擎往参数列表里塞的东西。库函数签名仍是源码形态 |
| 与 `getBackends()` 同构 | 两者都是"库 import 访问器 → 访问器读模块级状态"。区别只是读的是"环境配置"还是"当前执行态" |
| 与 brepjs 一致 | brepjs 的 `getKernel()` 同样读模块级注册表 |

> 这意味着 **`shapeToName` WeakMap 反查必须保留**（`exec-context.ts:141`）——v2 曾把它列入删除清单，是错的：正是它让 `keep(shape)` 无需库传变量名。

### 8.3 compound 不需要任何特殊处理（含代码核查）

> 用户指出："根据昨天的keep的设计方案后，compound没有任何需要特殊处理的地方。实现装配库代码的作者，自己在库函数内部调用keep，一切解决了。"

**v2 为 compound 设计的特例全部撤销**："产出 compound → 成员自动保留"（D-a）、"成员名经 `{shape,name}` 参数包装传递"（§10.3）都是我自己发明的，昨天方案里没有——昨天方案 §2.5 的做法就是 `group`/`assembly` 在函数体 `exec.keep(...members)`，与普通函数无任何区别。

**compound 相关代码逐项核查**（用户要求分析哪些是过时代码）：

| 项 | 核查结果 | 处置 |
|---|---|---|
| `ExecutionResult.compounds` | **活跃，非过时**。`ScriptEngine.ts:1303` → `setSceneCompounds` → `model-store.ts:143,159` 用于建场景树层级（`compounds` 优先于 `args.members`，见 `model-store.test.ts:547`） | **保留输出字段** |
| `memberNames`（`AssemblyBehavior`） | faijs 内部使用（约束求解按名定位 moving 成员 `compound.ts:209`；填 `compounds` `runtime.ts:684`）；**3d_editor 零引用** | 保留字段，**来源改为 keep 反查** |
| `deriveMemberNames` 读 IR（`compound.ts:257-272`） | **真病灶**：库在运行时读 `exec.currentStmt.args.members`，违反 F1 | **删除**，改由 §8.2 的 `keep(...members)` 反查得到成员名 |
| `isCompoundLike` 结构判定 | 活跃（`runtime.ts:612,654,682,809`），`keep-syntax` §5.3 D5 已裁定保留 | 保留 |
| v2 的 D-a"compound → 成员自动保留" | 我发明的特例 | **删除** |
| v2 的 `{shape,name}` 参数包装 | 我发明的 | **删除** |
| `AssemblyBehavior.solve(exec)` 的 exec 参数 | 随 exec 取消 | 删除参数（§10） |

**关键简化：`keep()` 一次调用同时解决两件事**：

```
assembly() 函数体 keep(...members)
   ├─→ 保留语义：成员不被消费（C1 判定，进 terminals）
   └─→ 结构输出：反查出的成员名 → ExecutionResult.compounds（宿主建树）
```

成员名不再需要"读 IR 反解"，也不需要"参数包装"，`deriveMemberNames` 整个函数消失。

### 8.4 求值型识别：只能用运行时事实，不能用类型或形态

> 用户纠正："faijs引擎拿不到类型，代码是去类型后交给js vm执行的。"

**v2 的错误**：我写了"库可选声明 `kind:'query'`；**不声明则走形态默认**"。这句是错的，双重错误：

1. **形态推不出求值型**。`cad.faceCenter(part0)` 与 `cad.drill(part0)` 都是 1 入 1 出，形态完全一致。形态规则对"这个函数是查询还是修改"零信息量。
2. **引擎拿不到类型**。`.faijs` 是无类型 JS（`.faits` 是远期且去类型后执行），执行时引擎手上只有**运行时值**，没有静态类型。

**正确的判据只有一条——运行时事实**（即现状 C3 的判据，`terminal-dag.ts:70-79`）：

```
语句有赋值 && outputs 非空 && 所有输出在运行时既非 isShapeLike 也非 isCompoundLike
  → 该语句不可能把几何吞进结果 → 不消费输入
```

这是**值判定**，不是类型判定，也不是形态推断。它对第三方库同样成立（`mech.measure(a)` 返回 number → a 不被消费），零声明即可工作。

**去掉的是那条伪论证，不是规则本身**：`keep-syntax` §3.2 把它建立在"纯函数链"假设上（已被用户推翻，§2.6）；实际上它依赖的只是"输出不是几何"这个运行时事实。

**库的补充手段（如需）**：求值型函数若想表达"我连输入都不碰"，在函数体调 `keep(...)` 即可，无需任何类型/形态机制。

### 8.5 连带简化：符号表

现状"保留语义"的静态载体是**符号表**（`src/lang/symbol-table.generated.ts`），由 `scripts/gen-symbol-table.ts` 解析 stdlib 的 **TS 类型节点**生成（提取 `ReadonlyShape` 形参位置）。

按 §8.1（默认消费 + 库函数体 `keep`）后，保留语义**不再有静态载体**：

- 符号表的 `readonlyPositions` / `readonlyPaths` **删除**——它们本就是"从类型里挖保留语义"的魔法，与"引擎拿不到类型"（§8.4）同源问题；
- 符号表退化为**函数存在性检查**（`check` 的 `knownCallee`，`runtime.ts:967-979`）；
- **不存在内置/第三方之分**：所有库函数都靠函数体 `keep()`，不存在"第三方符号表永为空"的问题，也不再依赖"SDK 文档须明示作者记得写"（`keep-syntax` §10 E2 风险消除）。

---

## 9. keep：唯一的 UI 耦合点（K3）

**本节是 faijs 与 UI 的全部接口，不多不少。**

| 层 | 归属 | 形态 | 优先级 |
|---|---|---|---|
| **默认** | 引擎 | 消费（C5，一条规则） | 最低 |
| **例外** | 引擎 | 求值型运行时判据：输出非几何 → 不消费（§8.4） | —— |
| **库默认值** | 库 | 函数体 `keep(...)` / `keepHidden(...)`（§8.2） | 中 |
| **调用点 keep** | 语言层（faijs） | `{ keep: [a, b], keepHidden: true }` | **最高** |
| **终端推导** | 引擎 | `computeLeafTerminals`：最后写者 + 下游无消费 + 上述保留结论 | —— |
| **feature/图标/面板/timeline** | **3d_editor** | —— | **不在 faijs** |

**调用点语法与语义完全不变**（`keep-syntax-design.md` §2.3/§2.4 的 `keep`/`keepHidden`、覆盖规则、`statementKey` 排除 keep、D1/D2 可见性规则全部保留）。

### 9.1 净减项（诚实修正：v2 高估了删除量）

v2 曾把 `shapeToName`、`internalKeep`、`DagRuntimeView` 全部列入删除清单——**这是错的**：既然保留"库函数体 `keep()`"，这些机制就是它的支撑，必须保留。

**真正删除的**：

| 删除项 | 位置 | 说明 |
|---|---|---|
| `exec` 末参本身 | `compile.ts:84,178,187,192,196` | 本方案的核心目标 |
| `ExecContext` 接口与 `ExecContextImpl` | `exec-context.ts`（整个文件 269 行） | 能力拆到 `getBackends()`（A）、`keep()`（C）、Shape 构造器（B） |
| `deriveMemberNames` 读 IR | `compound.ts:257-272` | 违反 F1；成员名改由 `keep()` 反查（§8.3） |
| `exec.setSolid` / `setFaceEvolution` 记账样板 | `drill.ts:160-162` 等 | 改由 `fromBrep()` 构造器登记（§7.2） |
| `resolve-path.ts` | `stdlib/internal/resolve-path.ts` | 分派收归引擎（§7.3） |
| 符号表 readonly 提取 | `scripts/gen-symbol-table.ts` | 保留语义不再有静态载体（§8.5） |
| 库向下转型 (`as ExecContextImpl`) | `drill.ts:143,169` | 改走 `getBackends().config`（§7.2） |

**必须保留的**（v2 误判）：

| 保留项 | 位置 | 为什么 |
|---|---|---|
| `shapeToName` WeakMap 反查 | `exec-context.ts:141`；`module-executor.ts:275`；`runtime.ts:525-533` | `keep(shape)` 靠它拿到变量名，否则库得传名字 |
| `internalKeep` 记账 + "缓存命中保留上一轮" | `module-executor.ts:77,141-142,194-197` | 库函数体 keep 的登记目标；增量执行下必需 |
| `DagRuntimeView.internalKeep` | `terminal-dag.ts:38-42` | C1 判定的数据来源 |
| 运行时 keep 调用机制 | —— | 用户明确要求"库作者在库函数内部调用 keep" |

> **结论**：本方案的净收益不在"删机制"，而在**取消隐式注入（K1）+ 消除向下转型（F1）+ 消除库干引擎的活（F2）**。`keep` 的运行时机制按用户要求完整保留，只是入口从 `exec.keep(...)` 变成 `keep(...)`。

**宿主契约不变**：`ExecutionResult.terminals: TerminalShape[]`（`id` + `hidden`），3d_editor `commitSceneResult` 消费方式不变（`keep-syntax-design.md` §11.1）。

---

## 10. 收归引擎的三件事

### 10.1 装配：求解 ≠ 传播

**现状病灶**（`compound.ts:200-248`）四步耦合在 `solveAssembly` 里：① `Object.assign` 原地改写（`:222`）② `exec.getSolid/setSolid`（`:227,233`）③ `exec.dependentsOf` + 逐个下游 `Object.assign`（`:237-241`）④ `exec.touch`（`:242,246`）。

第 ③ 步是核心问题：每个下游 Shape 是独立对象，装配变换必须手动重放——**这是"纯函数链"与"原地改写"混用的后果**（§2.6 的实证）。库在做 DAG 遍历，而 DAG 归引擎（F2）。

**目标形态**：

| 职责 | 归属 | 机制 |
|---|---|---|
| 求解约束（给定位姿 → 变换矩阵） | **库** | `solveFaceMate` 已是纯函数（`compound.ts:136-153`），保持 |
| 应用变换到成员几何 | **库** | 产出**新 Shape**，不再原地改写（F2） |
| 找出下游并让其反映新变换 | **引擎** | 标记 stale → 重算。`ModuleExecutor.executeFrom(staleIds)`（`module-executor.ts:159-175`）**本就是这个能力** |
| 变更声明（`ExecutionResult.changed`） | **引擎** | `afterStatement` 已遍历写入变量，顺手比对旧值（§10.2） |

**为什么引擎重放优于手工传播**：手工传播只改 mesh、不改 BREP → 下游若在 BREP 链上，其 solid 与 mesh **失配**（现状 `compound.ts:236` 的注释只说"下游 solid 由 setSolid 身份槽保留"，并未变换它）。引擎重放走既有增量路径，双链路各自正确重算。

> ⚠️ 这是本方案**语义变化最大**的一项：`do_assemble` 从"原地改写整条下游链"变为"让下游失效并重算"（副作用：`do_assemble` 变幂等——现在执行两次会叠加变换）。P6 需专项 e2e，**不与 P2–P5 的机械改造混做**。

### 10.2 变更传播（`touch`）收归引擎

`touch` 唯一用途是填 `ExecutionResult.changed`（`exec-context.ts:144,237-239`）。引擎在 `afterStatement`（`module-executor.ts:267-287`）已遍历本语句写入变量——比对旧值即可得出 `changed`，无需库声明。

### 10.3 错误与事件归属（消灭 `currentStmt`）

库不再知道"当前是哪条语句"。归属由引擎在调用点补充：

| 场景 | 现状 | 目标 |
|---|---|---|
| `BrepUnsupportedError` 带 stmt | 库构造时传 `exec.currentStmt`（`resolve-path.ts:38,42,48`） | 引擎 catch 后挂 stmt |
| 库函数抛错 → `failedAt` | 引擎已有捕获 | 不变，归属更完整 |
| `part-brep-lost` 事件 | 部分由库 `exec.events.emit` | **引擎统一发**：分派结果为 mesh 且上游在 BREP 链 → 发事件，`partName` 由引擎从语句 `outputs` 取 |

禁用 `currentStmt` 后，`compound.ts:257` 的 `deriveMemberNames` 失去数据来源。

**不需要给 `members` 加名字包装**（v2 曾提议 `{ shape, name }`，已撤销，理由见 §8.3）：成员名由 `keep(...members)` 反查得到，一次调用同时产出保留语义与 `ExecutionResult.compounds`。`deriveMemberNames` 整段删除，运行时读 IR 消失（F1）。

> 连带影响：`AssemblyBehavior.memberNames` 仍需要成员名做约束求解定位（`compound.ts:209` 按名查 moving 成员）。它同样来自 `keep()` 反查结果——库在 `assembly()` 里先 `keep(...members)` 再构造 behavior，字段与现状一致。

---

## 11. 第三方库：普通 npm 包（brepjs / cq_gears 模式）

### 11.1 形态（v1 的 `install(deps)` 协议作废）

```ts
// mech-lib/src/index.ts —— 普通 npm 包，与 brepjs 的 my-gear-lib 同构
import { box, union, solid, compound, keep, type Shape, type CompoundShape } from '@faicad/faijs'
import { helicalGear } from 'gear-lib'          // 传递依赖
import { GB_BEARINGS } from 'bearing-db'        // 纯数据

export function makeHeadstock(opts: HeadstockOpts): Shape {
  const body = box({ size: [400, 300, 350] })
  const gear = solid(helicalGear({ teeth: opts.gearTeeth, moduleSize: 2 }))
  return union(body, gear)
}

// 可选：只有需要声明"保留"时才写（装配/分组类库函数的典型用法）
export function makeAssembly(members: Shape[]): CompoundShape {
  keep(...members)                    // ← 与标准库 group/assembly 同一写法
  return compound(members)
}
```

**第三方库零声明即可工作**：不调 `keep` 就走"默认消费"（§8.1），不需要任何清单、schema 或类型标注。

```json
// package.json
{ "dependencies": { "@faicad/faijs": "^1.0.0", "gear-lib": "^2.1.0" } }
```

**库作者体验**：`npm i @faicad/faijs gear-lib` → tsc → `npm publish`。**与写普通 npm 包没有任何区别**（roadmap R1 的验收判据）。

| 层 | 包 | 是否依赖 faijs | 说明 |
|---|---|---|---|
| L4 | `mech-lib` | 是（普通 npm 依赖） | 宿主装配为 `ns.mech` |
| L2 | `gear-lib` | **否**（纯几何计算，返回 `{positions,indices}`） | mech-lib 用 `solid()` 包装 |
| L1 | `bearing-db` | **否**（纯数据） | faijs 全程不感知 |

> **v1 错在哪**：v1 为"零依赖"发明了 `install(deps)` 装配协议，把"库不要依赖 faijs"当目标。但 brepjs / cq_gears 证明：**库依赖宿主包是正常生态的通行做法**（cq_gears 的 `install_requires=['cadquery']`）。真正的目标是"库作者体验 = 写普通包"，而不是"零依赖"。中间件库（gear-lib）依然可以零依赖——那是它的选择，不是协议要求。

### 11.2 宿主装配

```
ModuleResolver: 'mech-lib' → https://static/…/mech-lib@1.4.0-<hash>.js
  → import(url) → 校验 CONTRACT_VERSION → ns.mech = mod
```

**键前缀**：多命名空间下 `statementKey` 必须含包名（既有修正 C2：`cad.chamfer` ≠ `mech-lib.chamfer`）。

**无装配协议**：库不需要导出清单、schema 或安装函数——`import` 进来的就是命名空间对象本身，与 brepjs 一致。

### 11.3 单例与身份互通（保留 roadmap §3.4 全局锚点）

库 `import` faijs 后，若页面上存在**两份 faijs 代码**（宿主 bundle 一份、库 bundle 打进一份）→ 两份 WeakSet → Shape 身份不通。

三层防护（与 brepjs 一致，**v1 的"锚点作废"结论撤回**）：

1. **构建期去重**（主）：预构建 bundle 时 `external: ['@faicad/faijs']`（roadmap §5.2 已定）或 `?external=@faicad/faijs`（CDN，brepjs §3.5b）；
2. **全局锚点兜底**：`globalThis.__FAICAD_FAIJS_RUNTIME__`（roadmap §3.4）—— Shape 身份 WeakSet、身份槽 WeakMap、OCCT kernel 单例挂上去，两份代码共享一份状态；
3. **版本校验**：`stateVersion` 不兼容即抛错，不静默降级。

### 11.4 版本协商（S5）

| 版本 | 含义 | 规则 |
|---|---|---|
| `FAIJS_SDK_VERSION` | 包 semver | 新增导出 = minor；删改签名 = major |
| `FAIJS_STATE_VERSION` | 运行时状态结构版本 | 结构破坏性变更 +1；不兼容即抛错 |

库声明 `peerDependencies: { "@faicad/faijs": ">=1.0.0 <2" }`；宿主加载时校验。

---

## 12. 编译与执行层改动

| 文件 | 现状 | 改动 |
|---|---|---|
| `src/lang/compile.ts` | 4 处发射 `, exec`（`:178,187,192,196`）+ 嵌套 `:84`；fn 签名 `:250` | fn `async (ctx, ns) => {}`；发射 `ns.<binding>.<callee>(…)`；删全部 `, exec` |
| `src/cad-runtime/module-executor.ts` | `fn(ctx, cad, exec)`（`:31,146`）；`internalKeep`（`:77,141,194,222-238`） | `fn(ctx, ns)`；删 `internalKeep` 全套；`afterStatement` 补 `changed` 推导 |
| `src/cad-runtime/exec-context.ts` | 整个文件（269 行） | **删除**。能力拆到 `backends.ts`（A）、Shape 构造器（B）、`exec-scope.ts` 的 `keep()`（C） |
| `src/cad-runtime/backends.ts` | —— | **新增**：`configureBackends` / `getBackends` / `Backends` 接口 |
| `src/stdlib/**`（18 文件） | 收 exec；`resolvePath` 样板；`exec.setSolid` | 去 exec；`getBackends()`；`fromBrep()` 登记 |
| `src/stdlib/shape.ts` | 模块级 WeakSet/WeakMap（`:37,94`） | 改读全局锚点（roadmap §3.4） |
| `src/stdlib/internal/resolve-path.ts` | 库函数自调 | **删除**，逻辑移到引擎分派 |
| `src/cad-runtime/terminal-dag.ts` | `DagRuntimeView` + C3（`:38-42,70-79`） | **基本保留**（库函数体 keep 的支撑）；C3 去掉伪论证、保留运行时判据 |
| `src/lang/symbol-table.ts` + 生成脚本 | 从 TS 类型节点提取 readonly | 退化为存在性集合；删 readonly 字段 |
| `src/cad-runtime/runtime.ts` | 装配 exec | `configureBackends()`；`failedAt`/事件挂 stmt 归属 |
| `src/index.ts` | 导出面 | 新增 `configureBackends`/`getBackends`/`Backends`/`keep`/`keepHidden`/Shape 构造器 |

**不变**（零回归面）：`ScriptIR`/`StatementIR` 结构、`parseScript`、codegen 往返、statementKey 公式（除包名前缀）、`ExecutionResult` 字段集合、`HostPorts`、`derivePartName`。

---

## 13. 分期实施

> 纪律：每期独立验证通过再进下一期；e2e 一次一个 spec；不跑全量，不跑 CI。

| 期 | 内容 | 风险 |
|---|---|---|
| **P0** | 契约类型落地：`Backends` / `configureBackends` / `getBackends` / `keep` / `keepHidden` / 引擎分派函数；守卫测试 | 无 |
| **P1** | `shape.ts` 改读全局锚点；`fromBrep`/`hasBrep`/`brepOf` 构造器 | 低 |
| **P2** | stdlib 去 exec：18 个文件改用 `getBackends()`，签名 = 源码形态；BREP 产物改 `fromBrep` 登记 | **高**（面积最大，逐函数验证） |
| **P3** | `keep()` 改 import 入口 + 模块级执行上下文；删 `deriveMemberNames`（成员名改 keep 反查）；删符号表 readonly | 中 |
| **P4** | 分派收归引擎；错误/事件挂 stmt 归属；成员名经参数传递 | 中（BREP/mesh 红线相关） |
| **P5** | compile + module-executor 去 exec：`async (ctx, ns)`；删 `exec-context.ts` | 中 |
| **P6** | **装配重做**：求解 ≠ 传播；删 `deriveMemberNames`/`dependentsOf`/`touch` | **高**（语义变化，专项 e2e） |
| **P7** | 第三方库通道：ModuleResolver + 单例去重 + 版本校验 | 中 |
| **P8** | 文档同步（§15）+ 3d_editor 回归 | 中 |

依赖：P0 → P1 → P2 → P3 → P4 → P5；**P6 独立做**（语义变化不与机械改造混合）；P7 依赖 P0+P5。

---

## 14. 验收标准（测试提纲，分层）

**契约形态（P0/P5）**
- 编译产物逐字断言：`ctx.part0 = await ns.cad.box(ctx.size)`——**无 `, exec`**，覆盖 4 种语句形态 + 嵌套 + 成员调用
- `src/` 下 `ExecContext` / `exec-context.ts` 零残留；stdlib 签名中无 `exec` 参数
- 无 `as ExecContextImpl` 向下转型（`grep` 断言）
- 库函数签名有形：无 `...rest` + `rest.pop()` 取上下文

**后端注册表（P1/P2）**
- `configureBackends(fake)` 后 `box(...)` 可单测（无需全局 runtime）
- `config.mode` 运行期 `auto → mesh` 切换后，同一份闭包读到新值
- OCCT 未就绪（`kernel.occt === null`）时 mesh 路径正常

**Shape 与句柄（P1/P2）**
- BREP 产物 `hasBrep(shape) === true`；mesh 产物 `false`
- stdlib 中 `setSolid` / `setFaceEvolution` 零残留
- 句柄释放仍单次（顶替释放回归：`module-executor.ts:137-151`）

**保留语义三层（P3，回归锚点来自 `keep-syntax` §9）**
- **库函数体 keep**：`union(a,b)` → a、b 保留隐藏；`group`/`assembly` → 成员保留可见；`copy(a)` → a 保留可见（逐条对照 `keep-syntax` §2.5 表）
- **引擎默认**：`drill(a)` / `split(a)` / `transform` → 消费；`add_constraint` / `do_assemble` → 不消费 receiver
- **调用点覆盖**：`drill(c,{keep:['c']})` / `{keepHidden:true}` → 覆盖库函数体声明（优先级最高）
- **求值型（运行时判据）**：`mech.measure(a)` 返回 number / `bboxMin(a)` 返回 vec3 → a 不被消费，**零声明**
- **零 keep 库函数**：`mech.fuse(a,b)`（函数体未调 keep）→ a、b 被消费（默认 C5，与 `keep-syntax` E2 一致）
- **compound 成员名**：`assembly()` 内 `keep(...members)` → `ExecutionResult.compounds` 正确产出成员名（替代读 IR 的 `deriveMemberNames`）
- 缓存命中（未重跑）时保留结论与重跑一致（`internalKeep` 保留机制不变）
- `computeKey` 仅 keep 变化时不改变（零重算）

**分派与归属（P4）**
- `mode:'brep'` + mesh-only 函数 → `BrepUnsupportedError`，`failedAt` 带 stmt（库不再传）
- `part-brep-lost` 由引擎发出，`partName` 正确
- 库内无 `currentStmt` 访问（`grep` 断言）

**装配（P6，专项）**
- `do_assemble` 后成员与下游 mesh 一致、BREP 句柄同步（不再失配）
- `do_assemble` 执行两次 = 执行一次（幂等）
- `ExecutionResult.changed` 由引擎填出，值域与现状一致
- 装配 + 下游 drill + STEP 导出 e2e 通过

**第三方库（P7）**
- `mech-lib`（普通 npm 包，`import { box, union } from '@faicad/faijs'`）端到端跑通
- `gear-lib` 产出经 `solid()` 包装后可与标准库产物混合 `union`
- 两份 faijs 加载 → Shape 身份互通（锚点兜底）；`stateVersion` 不匹配 → 抛错
- `statementKey`：`cad.chamfer` ≠ `mech-lib.chamfer`

---

## 15. 风险与开放问题

| # | 问题 | 处置 |
|---|---|---|
| **O1** | `kernel.occt` 异步就绪 | getter（可变引用），库在使用处判空并抛明确错误。与现状 `exec.kernels.occt` 是 getter（`exec-context.ts:164-170`）同构 |
| **O2** | `keep()` 读模块级执行上下文，并发或嵌套执行时归属是否可靠 | 引擎逐语句串行执行，`setCurrentStmt` 在 fn 之前设置（替换现状 `exec.currentStmt = source`，`module-executor.ts:140`）；嵌套调用（CallRefIR）内层 keep 归属外层语句——与现状语义一致（`keep-syntax` §2.2 E7，低风险） |
| **O3** | P6 装配语义变化 | 独立一期 + 专项 e2e，**不与 P2–P5 混做** |
| **O4** | 标准库函数的 `keep()` 声明是否齐全 | 按 `keep-syntax` §2.5 表逐条核对：group/assembly/copy → `keep`；union/subtract/intersect → `keepHidden`；drill/extrude/transform/split → 不声明。P3 逐函数验证 |
| **O5** | 成员名经参数传递后 `members` 元素形态变化（`Shape` → `{shape,name}`） | 影响 `group`/`assembly` 实现；`.faijs` 文本不变，codegen 往返不受影响 |
| **O6** | 与相邻文档的冲突 | 见 §16，**尚未修订那些文档**，待本方案裁定后同步 |
| **O7** | 多实例（多个 CadRuntime 用不同后端） | 当前**无此需求**（3d_editor 主线程单例）。若将来需要，加 `withBackends(overrides, fn)` 式作用域覆盖，但 faijs 执行是 async——需评估 AsyncLocalStorage 或显式传参，**不在本方案范围** |
| **O8** | 是否需要 `@faicad/faijs/stdlib` 子路径 | 保留（宿主直接 import 标准库函数与声明用）；第三方库用根入口即可 |
| **O9** | 专利考量（思考文档 §8.1） | 本文档的注册表/声明机制属常规工程手法；语言核心思想另行管理 |

---

## 16. 与相邻文档的冲突清单（待同步修订）

| 文档 | 章节 | 现状 | 应改为 |
|---|---|---|---|
| `docs/syntax-design.md` | §1.1 / §6.2 统一 ABI | "第三方库遵守末参 exec 约定"、"`(…args, exec)`" | 库 = 普通 npm 包；ABI = 源码形态；保留语义由库函数体 `keep()` 声明 |
| 同上 | §5.2/§5.3 符号表驱动消费判定 | `readonlyPositions`/`readonlyPaths` | 删除：保留语义无静态载体（引擎拿不到类型），改由库函数体 `keep()` 表达 |
| 同上 | §10 远期第三方库 | "遵守末参 exec 约定" | `import { … } from '@faicad/faijs'`（brepjs 模式） |
| `docs/plans/2026-08-28-keep-syntax-design.md` | §2.2 函数体 `exec.keep` | 挂在 exec 末参上 | **机制保留**，入口改为 `import { keep, keepHidden } from '@faicad/faijs'`（读模块级执行上下文）；登记/反查/缓存保留全部不变 |
| 同上 | §3.2 C3 + "C3 为什么成立" | 依赖"纯函数链"论证 | **去掉那条伪论证**（前提已被用户推翻），保留"输出非几何"的运行时事实判据 |
| 同上 | §6 `DagRuntimeView.internalKeep` | 运行时视图 | 删除；`computeLeafTerminals` 纯静态化 |
| 同上 | §10 E2（第三方未声明 keep） | "SDK 文档须明示" | 引擎默认已覆盖大部分；偏离才需声明 |
| `docs/plans/2026-08-28-faijs-ecosystem-roadmap.md` | §3.4 全局锚点 | 需要 | **保留**（§11.3；v1 曾误判为作废，已撤回） |
| 同上 | §4 SDK 入口 / §10 V2.2 | 计划新增 | SDK 子路径**非必需**（库用根入口即可）；类型由根入口导出。V2.1 锚点保留，V2.3（`exec.cad`）随 exec 删除而作废 |
| 同上 | §5.2 预构建 bundle + `?external` | 已有 | 保留，作为单例去重主手段（与 brepjs 一致） |
| `docs/plans/2026-08-29-faijs-normal-js-subset.md` | §3 P3（`exec.libs`） | 第三方走 `exec.libs` | 改 `ns.<binding>` |
| `docs/plans/2026-08-29-faijs-platform-api-design.md` | 全文 | 锚点 + SDK import | **被本文取代**；其 §1 对 exec 的批判由本文 §2 继承并深化 |

---

## 附录 A：证据索引

**faijs（现状）**

| 事实 | 位置 |
|---|---|
| 编译期 4 处追加 `, exec` + 嵌套 1 处 | `src/lang/compile.ts:84,178,187,192,196` |
| 语句 fn 签名 `async (ctx, cad, exec) =>` | `src/lang/compile.ts:250` |
| `ExecContext` 接口（20 字段） | `src/cad-runtime/exec-context.ts:49-90` |
| **库向下转型**访问 `ExecContextImpl.brepChain` | `src/stdlib/drill.ts:143,169` |
| 库运行时读 IR | `src/stdlib/compound.ts:257-272` |
| 持久对象捕获短命 exec，靠每次再传补救 | `src/stdlib/compound.ts:307,310-315` |
| 库调图算法 + 手工下游传播 + 原地改写 | `src/stdlib/compound.ts:222,237-243,246` |
| 签名无形：`rest.pop()` 取 exec | `src/stdlib/geom.ts:73-79,82-88,91-108` |
| 每个库函数自调 `resolvePath` + `brepImpl` 自述 | `src/stdlib/copy.ts:24,57`；`primitives.ts:54,69,76,83,90,97`；`drill.ts:27,196` |
| `exec.setSolid` 记账样板 | `src/stdlib/drill.ts:160-162`；`copy.ts:33-38`；`primitives.ts:62-64` |
| `internalKeep` + shapeToName + 缓存命中保留 | `src/cad-runtime/module-executor.ts:77,141-142,194-197,222-238,275` |
| C3 运行时推断 + `DagRuntimeView` | `src/cad-runtime/terminal-dag.ts:38-42,70-79` |
| Shape 身份模块级 WeakSet/WeakMap | `src/stdlib/shape.ts:37,94` |
| 符号表从 TS 类型节点生成 | `scripts/gen-symbol-table.ts` |
| `ExecutionResult`（宿主消费面，不变） | `src/cad-runtime/runtime.ts:93-135` |
| `HostPorts`（注入面，不变） | `src/cad-runtime/ports.ts:182-189` |
| 3d_editor CadRuntime 主线程单例 | `src/engine/script-engine/ScriptEngine.ts:83-93` |

**Onshape**

| 事实 | 位置 |
|---|---|
| 特征签名 + `defineFeature`（不抄） | `feature.fs:47-85,120` |
| annotation / precondition / UIHint（不抄） | `primitives.fs:30-42`；`tool.fs:9-80`；`uihint.gen.fs`（49 值） |
| op 提交式副作用（不抄机制） | `primitives.fs:110-120` |
| Query 惰性求值（不抄） | `query.fs:9-36` |
| Context 全局模型库（不抄） | `context.fs:12-30` |
| Id 分层反映创建历史（S2） | `context.fs:88-140` |
| 错误归属 + `regenError`（S4） | `feature.fs:66-84` |
| 版本协商（S5） | `primitives.fs:96` |
| 求值族 `ev*`（S3） | `evaluate.fs`（60+ 个 `ev*`） |

**brepjs**

| 事实 | 位置 |
|---|---|
| 模块级内核注册表 `registerKernel`/`getKernel`/`withKernel` | `docs/kernel-swap_cn.md:51-101` |
| 库 = 普通 npm 包，import 宿主包 | `docs/dynamic-third-party-library-loading_cn.md:206-214` |
| `KernelShape` 不透明句柄；Layer2+ 不在句柄上调方法（ESLint 强制） | `docs/kernel-swap_cn.md:167-176` |
| 内核方法只返回普通 JS 值 | `docs/kernel-swap_cn.md:178-188` |
| 句柄生命周期（dispose/scope/FinalizationRegistry） | `docs/memory-management_cn.md:10-83` |
| 单例靠打包去重 + `?external=` | `docs/dynamic-third-party-library-loading_cn.md:167-175` |
| 第三方库加载机制④（注册表 + Blob wrapper + 源码改写） | `docs/dynamic-third-party-library-loading_cn.md:48-165` |

## 附录 B：用户约束与本方案对应

| 用户约束 | 落实 |
|---|---|
| "库函数签名 = 源码里写的样子。禁止隐式注入" | §6.3/§6.4：编译产物参数一个不多；禁止 `rest.pop()` 取上下文 |
| "不要把 feature 特征这块抄过来" | §4.1 首行列为不抄项，全文未引入 feature 概念；§5.1/§9 明确 feature 在 3d_editor |
| "keep 是与 UI 的唯一耦合点" | §9 划界：调用点 keep 属语言层，其余 UI 表现全在上层 |
| "大部分情况下引擎侧自动处理，库作者可以定义自己的默认值" | §8.1 三层：引擎默认消费（一条规则）→ 库函数体 `keep()` → 调用点 keep 最高；求值型由引擎运行时判据自动豁免（§8.4） |
| "每一个功能到底谁来实现，要仔细思考" | §5 职责界定总表（5.1 保留与显示 / 5.2 几何执行 / 5.3 执行调度 / 5.4 环境资源） |
| **"禁止全局单例"——用户反对** | §0.2 撤回；§6.1 给出"隐式注入 vs 环境配置"的区分标准，模块级注册表是正当配置 |
| **"禁止让库 author 感知引擎"——用户反对** | §0.2 撤回；F1 精确表述为"不得访问引擎内部可变状态"，库当然要 import faijs 并按协议写声明 |
| "纯函数链是过时的说法" | §2.6 + §8.4：去掉 C3 的伪论证，保留"输出非几何"的运行时事实判据；装配改由引擎重放（§10.1） |