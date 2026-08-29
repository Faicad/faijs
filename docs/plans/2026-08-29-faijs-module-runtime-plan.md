# faijs 模块运行时开发规范（Phase 0 → E）

- 日期：2026-08-29
- 状态：**可执行规范**。本文档面向执行者，目标是"读完即可开发，无歧义"。
- 上位文档：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位唯一权威）
- 相关文档：`AGENTS.md`（BREP/mesh 路径判定红线、测试纪律）、`docs/api-contract.md`、`docs/syntax-design.md`
- 代码基线：faijs `C:\my\Faicad\faijs`（version 0.5.0）；3d_editor `C:\my\Faicad\3d_editor`；brepjs `C:\git\OpenCascade\brepjs`

---

## 0. 如何使用本文档

### 0.1 执行规则

1. **按阶段顺序执行**：Phase 0 → A → B → C → D → E。前一阶段验收未过，不得进入下一阶段。
2. **每个任务必须交付测试**。没有测试的代码视为未完成。
3. **断言优于描述**：本文档所有验收项都写成可执行的断言（文件、命令、期望值）。执行者不得用"看起来对"替代断言。
4. **遇到本文档未覆盖的情况**：停下来向用户提问，不要自行发明语义。

### 0.2 不可协商的红线

| # | 红线 | 说明 |
|---|---|---|
| **H1** | **BREP/mesh 路径判定必须是静态的，禁止运行时 try-catch 回退** | 判定在执行前完成；BREP 路径抛异常 = bug，必须直接暴露 |
| **H2** | **禁止隐藏错误** | 禁止 `spyOn(console,'warn')`、吞掉 stderr、注释掉断言来让门禁通过。CI 报出的信号要改根因 |
| **H3** | **不改变现有行为**（用户硬性要求） | 不断链场景（全 BREP 走 BREP / 输入无 BREP 侧）的行为必须与改动前逐位一致 |
| **H4** | **不准无条件焊接 BREP 模型，只准在 BREP 断链的时刻焊接**（用户原话：*不准 brep 无条件焊接*） | 断链时刻 = `dispatchPath` 返回 `'mesh'` 的时刻，含 mesh-only op / 混合输入 / 显式 mesh 模式三种触发。见 §5.2、§5.4 |
| **H5** | **禁止 npm publish**（用户硬性要求） | 必需等专利通过后才发布。`npm pack` 出 tarball 可以，publish 不可以。见 §9 |
| **H6** | **禁止并发跑测试** | 一次只能有一个测试进程。跑下一个前确认上一个（含子进程）已退出 |
| **H7** | **禁止在 3d_editor 重复实现 faijs 已有能力** | 第三方库能力必须走 `registerLib` 通道 |

### 0.3 命令速查

| 目的 | 命令（在 `C:\my\Faicad\faijs` 下执行） |
|---|---|
| 类型检查 | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| 跑单个测试文件 | `npx vitest run <path>` |
| 构建 | `npm run build` |
| 打包 tarball | `npm run pack` |

3d_editor 侧：`npx vitest run <path>`（unit）、`npm run test:components`（组件）、`npx playwright test <name>.spec.ts`（e2e，需先 build）。

### 0.4 测试纪律（对齐 `AGENTS.md` / `CLAUDE.md`）

每阶段按以下顺序逐层验证，**每一步通过才进下一步**：

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npx vitest run <相关单文件>`（只跑本次改动相关的文件，一个一个跑）
4. 3d_editor：`npm run test:components`
5. `npm run build`
6. 3d_editor：`npx playwright test <相关 spec>.spec.ts`（**一次只跑一个 spec**）

**严禁**：跑全量 e2e；跑项目 CI 总脚本 `scripts/ci.ps1`；并发跑测试；修改 `playwright.config.ts` / `vite.config.ts` 等配置文件。

---

## 1. 要解决的问题

### 1.1 目标场景 A —— 第三方库与依赖图（roadmap V3）

faijs 脚本要能引用第三方库，且第三方库自身可以依赖别的库。完整链条：

```
faijs 脚本
  └─ import * as mech from 'mech-lib'        ← 第三方机械模型库
       └─ import { gear } from 'gear-lib'    ← 依赖齿轮库
            └─ import { spec } from 'bearing-db'  ← 再依赖非 CAD 的标准件数据库
```

要解决的问题：**如何把一个带依赖树的 ESM 库加载进宿主运行时，并让它与 faijs 共享同一份状态与内核。**

### 1.2 目标场景 B —— brepjs 齿轮（本轮跑通目标）

利用 brepjs 的齿轮建模能力，通过兼容层封装成符合 faijs 规范的第三方库，在 faijs 中使用，并能与内置 op 做**精确 BREP 布尔**、导出**精确 STEP**。

要解决的问题：**外部 CAD 库的几何产物如何变成 faijs 的一等 Shape，并保留精确 BREP 表示（而不是退化成三角网格）。**

### 1.3 目标场景 C —— BREP 断链时刻的 mesh 物化（P0）

用户点名场景（逐字）：

> 加入我导入一个stl文件，然后建模一个box，然后布尔。怎么处理？必需支持mesh+brep的布尔。这是必需支持的场景。而且项目定位写的很清楚，必需支持mesh/brep/sdf混合建模。

> 文档有的brep转mesh的定义是错误的。并不是只有mesh与brep做布尔运算的时候才需要处理这个事情。而是任何在brep断链的时刻处理这个问题。比如brep建模的模型，最后做滚花之类的操作，此时断链，必需转mesh。

要解决的问题：**断链是常态而非异常。** BREP 层会在三类时刻永久丢失（mesh-only op / 混合输入 / 显式 mesh 模式），此时 BREP 侧输入的三角化产物是"逐面三角汤"，必须归约为合法 2-manifold 网格，mesh 层才能独立承担后续运算。**需要定义断链时刻的物化语义，并保证结果正确、可预期。** 详见 §5。

### 1.4 需求原话

**上位需求（roadmap §0.1）**：

> faijs/faits必需是一个正常的语言。faits可以理解为就是ts代码，它里面可以import其它的库。而faijs对应UI录制的代码，只有这个特殊一些，但是也要能引用第三方库呀，只是没有控制流语句。比如第三方写了一个机械模型库，这个库又引用了齿轮库，齿轮库又引用了一个标准件数据库(非cad库)。然后faijs里用机械模型库建模一个车床模型。而且让你写的而是解决方案。什么faijs 未发布，根本不是理由，那就让faijs发布即可。你需要主动规划faijs的后续开发的路线图。要实现我上面提到的这个场景。

**断链物化要求（用户，逐字）**：

> 这个问题必需修复，写在方案的最开头。brep与mesh混合的时刻，对brep模型进行相应处理不久可以了吗？为何一直拖着不解决？而且不应该改变现有行为，不准brep无条件焊接，只准在和mesh混合操作的时刻焊接。

> 并不是只有mesh与brep做布尔运算的时候才需要处理这个事情。而是任何在brep断链的时刻处理这个问题。比如brep建模的模型，最后做滚花之类的操作，此时断链，必需转mesh。

**解读**（normative）：用户后一段是对前一段"混合时刻"的**泛化**，不是替换。触发面从"布尔混合"扩展为**任何断链时刻**（§5.2 的 T1/T2/T3）；"不准无条件焊接"的约束继续有效，只是触发条件表述为**断链时刻**而非字面的"混合操作的时刻"。

**发布 gate（用户，逐字）**：

> 必需等专利通过后才发布。

### 1.5 非目标（本计划不做）

- `npm publish`（H5）
- 运行时 ModuleResolver（延后到 V5.2，与多版本 scopes 合并做）
- 语言层 `var` 放开、参数右侧任意表达式（收益/风险比不佳，待真实用例）
- 库市场 / Worker 沙箱 / 按需加载 / 引擎切换（V4/V5）

---

## 2. 术语与全局不变量

| 术语 | 定义 |
|---|---|
| **Shape** | `{ positions: Float32Array; indices: Uint32Array }`（`src/mesh/types.ts:35-38`）。**mesh 是每个 Shape 的必有载荷** |
| **BREP 槽（slot）** | 挂在 Shape 上的可选精确表示层，存 OCCT 句柄。见 `src/stdlib/shape.ts:98-121` |
| **在 BREP 链上** | `hasBrep(shape) === true`，即该 Shape 有 OCCT 句柄（`src/stdlib/shape.ts:114-116`） |
| **断链（chain break）** | 某 op 的产物**没有 BREP 句柄**（`solid()` 而非 `fromBrep()`）→ 该 part 从此只剩 mesh 层 |
| **断链时刻** | `dispatchPath` 返回 `'mesh'` 的那一刻。三种触发见 §5.2 |
| **物化（materialize）** | 断链时刻把 BREP 侧输入的三角化载荷归约为合法 2-manifold 网格，使 mesh 层能独立承担后续运算 |
| **归约（reconcile）** | 物化的具体实现：把 BREP 三角化产物（逐面三角汤）规整为合法 2-manifold 网格 |
| **混合（mixed）** | 断链触发之一（T2）：同一次 op 的输入中**既有** `hasBrep === true` **又有** `false` |
| **mesh-only op** | 断链触发之一（T1）：无 `brepImpl` 的 op（`knurl` / `sdf`），必然断链 |
| **提升** | 反方向：把 mesh 重建为 BREP 实体（可选 opt-in，见 §5.7）。**断链是单向的，提升不会自动发生** |
| **adapter（兼容层）** | 把外部 CAD 库封装成 faijs 第三方库的那一层。**它是库的一部分，不是 faijs 的一部分** |

**关键不变量**：

1. mesh 与 BREP **不是互斥的两类对象**，而是同一 Shape 的**两层表示** —— 混合在数据模型层面没有阻抗。
2. **mesh 层必有，BREP 层可选且会丢失。** BREP 层一旦丢失（断链），该 part 永久只剩 mesh 层；不会自动恢复。
3. **断链是常态而非异常**，由静态规则在执行前判定（H1）。工程问题不是"如何避免断链"，而是**断链时刻如何把 BREP 侧正确物化为可用的 mesh 层**。

---

## 3. 当前基线（客观事实）

### 3.1 执行链

```
faijs 源码 (.faijs)
   └─ parse → ScriptIR（含 imports?: ImportIR[]）        ← 已实现
        └─ compile → 编译产物（零 import，fn(ctx, ns)）  ← 库经 ns 注入
             └─ ModuleExecutor.importModule(code)        ← data:/Blob URL
                  └─ ns.<binding>.<callee>()             ← 调第三方库函数
                       └─ 第三方库模块（ESM）            ← ★ import 依赖图在这一层
```

**结论**：faijs 编译产物**永远不需要** import（第三方库由宿主 `registerLib` 后经 `ns` 传入）。需要 import 解析的是**第三方库模块自身的依赖图**。

### 3.2 已具备能力（带路径行号）

| 能力 | 证据 |
|---|---|
| parser 黑名单化 + 表达式折叠 + 控制流专用错误码 | `src/lang/parser.ts:795-819`（`throwUnsupportedStatement`，`E_CONTROL_FLOW` / `E_STATEMENT` / `E_IMPORT`） |
| 顶层 import 段 + 多命名空间调用 | `src/lang/types.ts:157-173`（`ImportIR`）、`StatementIR.namespace`（`:78-79`） |
| SDK 入口（零 heavy 依赖） | `src/sdk.ts`（63 行）；守卫测试 `src/sdk.test.ts` |
| 引擎侧第三方库通道 | `src/cad-runtime/runtime.ts:254-258`（`registerLib` → `assertContractVersion` → `setNamespaces`） |
| 库函数可拿到 faijs 内核 | `src/cad-runtime/runtime.ts:286-303`：`kernel.occt` getter → `brepChainOf()?.kernel ?? null`；配合 `src/runtime-state.ts:200-206` 的 `getBackends()` |
| 契约版本与状态锚点 | `src/runtime-state.ts:55`（`CONTRACT_VERSION = 1`）、`:69-75`；globalThis 锚点见 `src/cad-runtime/runtime.ts:156-186` |
| Shape 身份与 BREP 槽 | `src/stdlib/shape.ts:34-59`（`solid` / `fromBrep`）、`:114-121`（`hasBrep` / `brepOf`） |
| 路径静态判定 | `src/cad-runtime/backend-dispatch.ts:30-51`（`dispatchPath`，**全体一致**判定） |
| 顶点焊接（weld） | `src/boolean/csg-core.ts:114-155`（`weldPositionsWorker`，1µm 量化 hash 网格做 key，推入原始坐标，无精度损失） |
| mesh→BREP 重建 | `src/occt-kernel/meshReconstruct.ts:104`（`reconstructSolidFromMesh`，多阶段愈合 + 多容差缝合） |
| 宿主侧库注册 | 3d_editor `src/engine/script-engine/ScriptEngine.ts:119-124`（`registerInstalledLibs`） |
| 库清单持久化 | 3d_editor `src/engine/version-store/LibManifestStore.ts:17-61`；快照 `snapshot-io.ts:166-174,338-348` |
| Timeline 只读节点渲染 | 3d_editor `src/engine/components/panels/TimelinePanel.tsx:124,171,173` |

### 3.3 ⚠️ 仓库未提交资产（执行前必须掌握）

以下文件**存在但未纳入 git、从未执行过**。执行者必须先跑通它们再判断后续工作量。

| 路径 | 内容 | 状态 |
|---|---|---|
| `src/mesh/reconcile.ts` | 293 行。四步归约：`weldVertices` / `removeDegenerate` / `unifyOrientation` / `assertManifold` + 入口 `reconcileMesh` | 已实现，**从未运行** |
| `src/stdlib/reconcile.ts` | 44 行。共用入口 `reconcileBrepInputs`（§5.4） | 已实现，**从未运行** |
| `src/mesh/reconcile.test.ts` | 190 行，13 个用例（焊接、退化剔除、朝向统一、2-manifold 断言、全管线） | **从未运行** |
| `test/faijs/mixed/` | M1–M5 五份 `.faijs` fixture + `mixed.test.ts` | **从未运行** |

**接线状态**（与 §5.4 表一致）：`src/stdlib/boolean.ts:102`（C1）、`src/stdlib/knurl.ts:30`（C2）**已接线**；C3–C10 待处理。

**M1–M5 用例定义**（`test/faijs/mixed/mixed.test.ts`）—— 全部覆盖 **T2 混合输入**触发：

| 用例 | 输入构成 | 预期路径 |
|---|---|---|
| M1 | `load(stl)` + `box` → `union`（用户点名场景） | mesh |
| M2 | `load(stl)` + `cylinder` → `union`（曲面三角化） | mesh |
| M3 | `sdf(...)` + `box` → `union`（BREP × SDF） | mesh |
| M4 | `box` + `box` → `union`（全 BREP 对照） | **brep** |
| M5 | `load(stl)` + `load(stl)` → `union`（全 mesh 对照） | mesh |

⚠️ **M1–M5 不覆盖 T1（mesh-only op 断链）**。用户点名的"滚花断链"场景目前**无回归用例**，须由执行者新增（见 §7.1 P0-2a）。

**第一步任务（P0-1）就是跑这两个测试文件并把结果记录进 §8.1。禁止在拿到真实结果前修改实现逻辑。**

> **⚠️ 章节号漂移（执行者须知）**：上述三个文件的头注释引用的是本文档的**旧章节号**。当前文档的对应位置为：
>
> | 代码注释中的引用 | 本文档实际章节 |
> |---|---|
> | `reconcile.ts` / `reconcile.test.ts` 的 `§6.1.5 P0-1c` | **§5.6**（reconcile 四步规范）+ `src/mesh/reconcile.test.ts` |
> | `src/stdlib/reconcile.ts` 的 `§6.1.5 P0-1b` | **§5.4**（物化规则） |
>
> 执行者**不要**为了让注释与文档一致而改动代码注释（代码由另一条实施线负责）；若确需同步，只改注释中的章节号，不动实现。

### 3.4 待补能力

| 缺口 | 说明 | 章节 |
|---|---|---|
| 断链点未全部接线 | `reconcileBrepInputs` 已接 C1（`boolean.ts:102`）、C2（`knurl.ts:30`）；C3–C6（`drill`/`extrude`/`engrave`/`split`）未接；C7–C10（`copy`/`translate`/`rotate`/`scale`）待裁决（§5.5）。另：兜底 weld 触发语义仍是"顶点密度嗅探"（`csg-core.ts:70`：`vertCount >= triCount*3*0.9`），不符合 H4 | §5.4 |
| 缺 T1 断链回归用例 | 现有 M1–M5 只覆盖 T2；用户点名的"滚花断链"无用例 | §7.1 P0-2a |
| SDK 无三角化入口 | `src/sdk.ts:24-63` 无 `kernel.meshShape` 封装 | §4.5 |
| 编译产物加载不支持裸说明符 | `module-executor.ts` 用 data:/Blob URL 动态 import，裸说明符浏览器无法解析 | §4.2 |
| 无兼容层规范 | 缺"外部 CAD 库 → faijs Shape"的契约与所有权协议 | §6 |
| occt-wasm 版本落后 brepjs | faijs 锁 `^3.7.0`（实测 3.7.0），brepjs 要求 `^3.8.0` | §7 P0-4 |
| 顶层函数定义未支持 | `src/lang/parser.ts:809-811` 主动抛 `E_STATEMENT`；3d_editor `todo2_.md:37` 有实际需求 | §7 Phase A |
| 3d_editor `getFeatureByOp` 是死链 | `features/index.ts:126-129` 硬编码 `if (packageName && packageName !== 'cad') return undefined`；调用点 `ScriptEngine.ts:462` 恒传 `undefined` | §7 Phase B6 |
| 3d_editor 无可执行的 mock 库 | 全仓无带 `contractVersion` 导出的库模块 | §7 Phase B4 |

---

## 4. 模块运行时

### 4.1 三条加载通道

| 通道 | 机制 | 运行时残留裸说明符 | 定位 |
|---|---|---|---|
| **① 构建期预 bundle** | 后端 esbuild 把库 + 全部依赖打平成单文件 ESM，`@faicad/faijs/sdk` 与 `occt-wasm` 设为 external → 对象存储 → 内容 hash URL | 仅 `@faicad/faijs/sdk`（+ `occt-wasm`） | **主路径** |
| **② CDN external** | `https://esm.sh/mech-lib?external=@faicad/faijs/sdk` | 仅 `@faicad/faijs/sdk` | 开发者路径（零后端） |
| **③ 运行时 ModuleResolver** | faijs 提供纯函数 `resolveImports(code, table)`，acorn 解析并重写裸说明符为绝对 URL，宿主提供表与 IO | 全解析 | **延后到 V5.2**（与多版本 scopes 合并做） |

**为什么 ① 是主路径**：①②都能在加载前把依赖树打平，运行时只剩一个已知裸说明符，用静态 importmap 就能解决 —— 不需要运行时重写器。③要自己实现递归解析、版本仲裁、循环依赖，工程量是 ①②之和的数倍，且 V5.2 的 `scopes` 需求正好需要它，届时一并做。

### 4.2 通道①的实现要求

**职责划分**：

| 方 | 职责 |
|---|---|
| 库作者 | 写普通 TS/ESM，正常 `import` 依赖；对 faijs SDK 用**裸名** `@faicad/faijs/sdk` 导入；不打包 |
| faijs | 提供 SDK 包（零 heavy 依赖），声明 external 清单，提供 `assertContractVersion` |
| 后端（3d_editor `/api/internal` 已有） | esbuild bundle：入口 = 库入口；`external: ['@faicad/faijs/sdk', 'occt-wasm']`；产物上传对象存储，返回内容 hash URL |
| 宿主（3d_editor） | `registerInstalledLibs`（`ScriptEngine.ts:119-124`）：`import(url)` → `registerLib(binding, mod)`；快照记录 `lib-manifest.json` |

**external 是硬要求，不是优化**：

- 若把 SDK 打进库里，`isShape` 会读**另一份** `WeakSet`，OCCT 句柄会落在**另一个** wasm 实例。
- globalThis 状态锚点**只能救 Shape 身份（WeakSet），救不了 OCCT 句柄**（wasm 实例是两份）。

### 4.3 单例共享三层保障（缺一不可）

| 层 | 机制 | 作用 |
|---|---|---|
| 1. 构建期 external（主） | esbuild / esm.sh external 掉 `@faicad/faijs/sdk` 与 `occt-wasm` | 保证 SDK 与内核**只有一份实例** |
| 2. importmap 静态映射（必需） | 宿主页面 `<script type="importmap">` 声明 `"@faicad/faijs/sdk": "/vendor/sdk.js"` | 解析运行时残留的唯一裸说明符 |
| 3. globalThis 状态锚点（兜底） | `__FAICAD_FAIJS_RUNTIME__`（`src/cad-runtime/runtime.ts:156-186`），stateVersion 不匹配即抛 | external 意外失效时仍能保证 Shape 身份互通 |

**importmap 硬约束**（必须遵守）：importmap 必须在**任何模块加载之前**声明，且标准下**不能运行时新增条目**。因此"动态安装的库"不能靠"运行时往 importmap 加一条"解决 —— 必须靠 external 把裸说明符收敛到固定的那一个（`@faicad/faijs/sdk`），而它在页面加载时就已声明。**这是 ①② 为主路径、③ 为延后项的根本原因。**

### 4.4 库模块契约（normative）

每个 faijs 第三方库模块**必须**满足：

```ts
interface FaijsLibModule {
  /** 契约版本，必须等于 CONTRACT_VERSION（当前 = 1）。缺失或不等 → registerLib 抛错 */
  readonly contractVersion: number
  /** 可被调用的函数集合。`ns.<binding>.<callee>` 的 callee 即此处的键 */
  readonly [name: string]: unknown
}
```

- 校验入口：`src/cad-runtime/runtime.ts:254-258`（`registerLib` → `assertContractVersion`）。
- 未注册命名空间被调用时报错位置：`src/cad-runtime/runtime.ts:1042-1056`。
- 返回值类型：库函数返回 faijs 类型（`SolidShape` / `CompoundShape`），**不返回库自己的类型**。

### 4.5 SDK 增量 API（normative）

**缺口**：第三方库要造 BREP 产物，需要"OCCT 句柄 → mesh"。`src/sdk.ts:24-63` 当前无此能力。

**⚠️ 实现约束（必须遵守，否则守卫测试失败）**：

`src/brep/brep-ops.ts:17` 有 `import * as THREE from 'three'`。因此 `src/sdk.ts` **绝不能** import `brep-ops`（会把 three 拉进 SDK bundle，违反 `src/sdk.test.ts` 的零 heavy 依赖守卫）。新 API 必须在**新建的零依赖模块**中实现，直接调运行时注入的 `kernel.meshShape`。

**新增文件**：`src/brep/handle-bridge.ts`（只允许 import `runtime-state`、`stdlib/shape`、type-only `mesh/types`）

```ts
// src/brep/handle-bridge.ts

import type { Shape } from '../mesh/types'
import { getBackends } from '../runtime-state'
import { solid, fromBrep } from '../stdlib/shape'

/** 结构化内核接口（不 import occt-wasm，只做结构匹配，避免 heavy 依赖） */
interface MeshableKernel {
  meshShape(
    handle: unknown,
    opts: { linearDeflection: number; angularDeflection: number },
  ): { positions: ArrayLike<number>; indices: ArrayLike<number> }
}

/**
 * 取 faijs 当前使用的 OCCT 内核实例。
 * @throws 内核未就绪（mesh 模式或未初始化）时抛错 —— 不静默返回 null。
 */
export function getKernel(): unknown {
  const kernel = getBackends().kernel.occt
  if (!kernel) {
    throw new Error('[faijs/bridge] OCCT kernel not available: BREP operations require an initialized kernel')
  }
  return kernel
}

export interface MeshHandleOptions {
  /** 线性偏差（mm），默认 0.1 —— 与内置 op 一致（src/brep/brep-ops.ts:27） */
  linearDeflection?: number
  /** 角度分段数，默认 32 —— angularDeflection = 2π / segments */
  segments?: number
}

/** 三角化一个 OCCT 句柄 → Shape（不登记 BREP 槽）。 */
export function meshHandle(handle: unknown, opts?: MeshHandleOptions): Shape {
  const kernel = getKernel() as MeshableKernel
  const mesh = kernel.meshShape(handle, {
    linearDeflection: opts?.linearDeflection ?? 0.1,
    angularDeflection: (2 * Math.PI) / Math.max(3, opts?.segments ?? 32),
  })
  return {
    positions: new Float32Array(mesh.positions as ArrayLike<number>),
    indices: new Uint32Array(mesh.indices as ArrayLike<number>),
  }
}

/**
 * 默认路径（推荐）：三角化 + 登记 BREP 槽，一步完成。
 * 等价于 meshHandle(h) + fromBrep(sh, { solid: h })。
 * 库作者只有在需要自定义三角化精度时，才退回 meshHandle + fromBrep 组合。
 */
export function fromHandle(handle: unknown, opts?: MeshHandleOptions): ReturnType<typeof fromBrep> {
  return fromBrep(meshHandle(handle, opts), { solid: handle })
}
```

（`solid` 在本文件未直接使用，若 lint 报未使用导入则移除该 import。）

**在 `src/sdk.ts` 末尾增补导出**（additive，不改现有导出）：

```ts
export { getKernel, meshHandle, fromHandle } from './brep/handle-bridge'
export type { MeshHandleOptions } from './brep/handle-bridge'
```

**不变量（必须被测试覆盖）**：

1. `getKernel()` 在 mesh 模式（kernel 为 null）**抛错**，不返回 null。
2. `fromHandle(h)` 产出的 Shape 满足 `hasBrep(shape) === true`。
3. `dist/sdk.js` 静态 import 扫描**仍然零 heavy 依赖**（`src/sdk.test.ts` 必须继续通过）。
4. `meshHandle` 默认参数与内置 op 一致：`linearDeflection = 0.1`、`segments = 32`。

---

## 5. BREP → mesh 物化规范（断链时刻，P0）

### 5.1 概念模型：两层表示与断链

faijs 的 Shape 是**两层表示**：

| 层 | 是否必有 | 代码证据 |
|---|---|---|
| **mesh 层**（`{ positions, indices }`） | **必有载荷**，任何 Shape 都有 | `src/mesh/types.ts:35-38` |
| **BREP 层**（OCCT 句柄，挂在 slot 上） | **可选叠加层，且会丢失** | `src/stdlib/shape.ts:114-121`（`hasBrep` / `brepOf`） |

BREP 层由 `fromBrep(mesh, holder)` 登记（`src/stdlib/shape.ts:51-59`），而 `solid(mesh)` **不登记槽**（`:34-38`）。

**断链（chain break）定义**：一个 op 的产物**没有 BREP 句柄**（用 `solid()` 而非 `fromBrep()` 构造）→ 该 part 从此**只剩 mesh 层**，BREP 层永久丢失。

**断链时刻**：`dispatchPath`（`src/cad-runtime/backend-dispatch.ts:30-51`）返回 `'mesh'` 的那一刻。

**为什么断链时刻必须物化（materialize）**：

1. 断链后，mesh 层要**独立承担该 part 的全部后续运算**；
2. 而 BREP 侧的 mesh 载荷来自 OCCT 三角化（`kernel.meshShape`，`src/brep/brep-ops.ts:40-64`）—— 它是**逐面三角化的三角汤**：共享边的顶点被重复产出、**不焊接**，可能还带朝向不一致与退化三角形；
3. manifold-3d 要求输入是**合法 2-manifold**，三角汤直接喂进去会失败。

⇒ **断链时刻 = BREP 侧输入的 mesh 载荷必须被归约成合法 2-manifold 的时刻。** 这不是"布尔运算的特例"，而是**断链的普适要求**。

**可观测信号**：引擎在断链时统一发 `part-brep-lost` 事件（`src/cad-runtime/module-executor.ts:376-395`）。⚠️ 该事件的判据是"语句**全部**输入在链上、但输出不在链上"（`:378`），因此它**只覆盖 T1，不覆盖 T2/T3**。事件与物化是两个独立判据，不要互相替代。

### 5.2 断链的三种触发（normative）

| 触发 | 条件 | 判据位置 | 典型场景 |
|---|---|---|---|
| **T1 mesh-only op** | 该 op 无 `brepImpl`（如 `knurl` / `sdf`） | `dispatchPath(inputs, undefined)` → 必然 `'mesh'` | **BREP 建模的模型最后做滚花**（用户点名场景）；`sdf` |
| **T2 混合输入** | 输入中**既有** `hasBrep === true` **又有** `false` | `backend-dispatch.ts:49`：`brepImpl && inputs.every(hasBrep)` 不成立 | `load(stl)` + `box` → `union` |
| **T3 显式 mesh 模式** | `config.mode === 'mesh'` | `backend-dispatch.ts:36` | 用户强制全 mesh 执行 |

**T1 的证据**：`src/stdlib/knurl.ts:26` 明写 `// mesh-only：无 brepImpl`；`src/stdlib/sdf.ts:25` 同。`src/brep/brep-chain.ts:68` 的注释亦确认"它被 knurl/sdf（mesh-only op）产生（不写 solidCache）"。

**T2 的证据**：`src/brep/brep-chain.ts:26` 的 `CAD_FORMATS = new Set(['step','brep','stp'])` **不含 stl** → `isCadFormat` 返回 false（`:38-55`）→ `load` 走 `solid(await cad.load(...))`（`src/stdlib/load.ts:53,61-63`），产物无 BREP 槽。

⇒ 三种触发**都必须**在断链时刻对 BREP 侧输入做归约。工程问题不是"如何避免断链"，而是**断链发生时如何保证 mesh 层可用且正确**。

### 5.3 断链点完整清单（normative）

断链点 = **所有 `dispatchPath` 可能返回 `'mesh'` 且该 op 有几何输入**的位置。按下游消费者分两类：

| # | op | `dispatchPath` 位置 | mesh 分支 | 下游是否构造 Manifold | 类别 |
|---|---|---|---|---|---|
| C1 | `union` / `subtract` / `intersect` | `src/stdlib/boolean.ts:99` | `booleanMesh` `:74` | 是（CSG 后端） | **A** |
| C2 | `knurl` | `src/stdlib/knurl.ts:27` | `cad.knurl` `:31` | 是（细分 + 位移） | **A** |
| C3 | `drill` | `src/stdlib/drill.ts:194` | `drillMeshPath` `:196` | 是（CSG 后端） | **A** |
| C4 | `extrude` | `src/stdlib/extrude.ts:50` | `cad.extrude` `:52` | 是（CSG 后端） | **A** |
| C5 | `engrave` | `src/stdlib/engrave.ts:177` | `cad.engrave` `:186` | 是（CSG 后端） | **A** |
| C6 | `split` | `src/stdlib/split.ts:239` | `splitMeshPath` `:241` | 是（CSG 后端） | **A** |
| C7 | `copy` | `src/stdlib/copy.ts:55` | 深拷贝 `:57-60` | **否**（纯数组复制） | **B** |
| C8 | `translate` | `src/stdlib/transform.ts:73` | `cad.translate` `:75` | **否**（烘焙顶点） | **B** |
| C9 | `rotate` | `src/stdlib/transform.ts:81` | `cad.rotate` `:83` | **否**（烘焙顶点） | **B** |
| C10 | `scale` | `src/stdlib/transform.ts:89` | `cad.scale` `:91` | **否**（烘焙顶点） | **B** |

**无输入的创建类 op 不可能收到 BREP 输入，无需归约**：`primitives`（`src/stdlib/primitives.ts:69,76,83,90,97`）、`screw`（`:145`）、`sdf`（`:26`）、`svgExtrude`（`:51`）、`text`（`:82`）、`load`（`src/stdlib/load.ts`）。

**Manifold 构造点（A 类判据）**：`meshToManifold`（`src/boolean/csg-core.ts:60-81`），唯一调用方是 CSG 后端 —— `src/browser-host/csg-worker.ts:41,51,63,80,104` 与 `src/browser-host/inline-csg-backend.ts:31`。B 类的 `src/mesh/transform.ts:19-49` 只改顶点数组，不经过 CSG 后端。

### 5.4 物化规则（normative）

**降级规则（现状，保持不变）**：`dispatchPath`（`src/cad-runtime/backend-dispatch.ts:30-51`）是**全体一致**判定 —— auto 模式下 `brepImpl && inputs.every(hasBrep)` → brep，否则 mesh。只要有一个输入不在 BREP 链上，**全部输入一起降级为 mesh 路径**。这符合 H1 红线。

**需要新增的是降级之后的物化步骤**，规则如下：

| 项目 | 规则 |
|---|---|
| **触发条件** | `dispatchPath` 已返回 `'mesh'`（即 T1/T2/T3 任一断链触发成立） |
| **处理对象** | **只对 BREP 侧输入**（`hasBrep(s) === true` 者）做归约；mesh 侧输入**原样透传** |
| **插入位置** | 各断链点的 mesh 分支入口 —— 在 `dispatchPath` 判定为 `'mesh'` **之后**、进入 mesh 实现**之前**（见 §5.3 C1–C10 表） |
| **无 BREP 输入时** | **零变化**：返回原数组，不分配、不改写（满足 H3） |
| **与 H1 的关系** | 物化发生在**路径已静态判定之后**，是**输入数据规整**，不是运行时回退 |

**共用入口**：`reconcileBrepInputs(inputs)`（`src/stdlib/reconcile.ts:29-44`）。所有断链点**必须**复用此函数，不得各自实现。

```ts
// src/stdlib/reconcile.ts —— 已实现，各断链点共用
export function reconcileBrepInputs(inputs: Shape[]): Shape[] {
  let hasBrepSide = false
  for (const s of inputs) {
    if (hasBrep(s)) { hasBrepSide = true; break }
  }
  if (!hasBrepSide) return inputs               // 无 BREP 侧 —— 零变化透传

  return inputs.map((s) => {
    if (!hasBrep(s)) return s                   // mesh 侧 —— 原样透传
    const r = reconcileMesh(s.positions, s.indices)
    return { positions: r.positions, indices: r.indices }
  })
}
```

**接线形态**（以 `knurl` 为例，其余断链点同构）：

```ts
// src/stdlib/knurl.ts:27-31 —— 已接线，作为其余断链点的模板
dispatchPath([input], undefined)                 // ① 静态判定（T1：mesh-only）
const [meshInput] = reconcileBrepInputs([input]) // ② 断链时刻物化
return solid(await cad.knurl(meshInput, { ... }))// ③ 进 mesh 实现
```

**接线状态**（执行者须先核实，再推进）：

| 断链点 | 状态 |
|---|---|
| C1 `boolean` | ✅ 已接线（`src/stdlib/boolean.ts:102`） |
| C2 `knurl` | ✅ 已接线（`src/stdlib/knurl.ts:30`） |
| C3–C6（`drill` / `extrude` / `engrave` / `split`） | ⬜ 待接线 |
| C7–C10（`copy` / `translate` / `rotate` / `scale`） | ⬜ 待裁决，见 §5.5 |

### 5.5 B 类断链点的覆盖缺口（待裁决，normative）

B 类（`copy` / `translate` / `rotate` / `scale`）的 mesh 分支**不构造 Manifold**，因此断链时即便喂进三角汤也不会当场失败。但它产出的 Shape：

1. 由 `solid()` 构造 → **无 BREP 槽**（BREP 层已丢失）；
2. mesh 载荷仍是**未焊接的三角汤**（B 类只做数组复制 / 顶点烘焙，不改变连接关系）。

⇒ **缺口**：该产物后续进入 A 类 op（如 `union`）时，`hasBrep(s) === false` → `reconcileBrepInputs` 会**跳过它**（只归约 BREP 侧）→ 三角汤直达 `meshToManifold` → 只能依赖 `src/boolean/csg-core.ts:70` 的**顶点密度嗅探**（`vertCount >= triCount * 3 * 0.9`），而该嗅探既不判朝向也不补 T 形接缝，曲面体大概率失守。

**为什么 B 类的触发覆盖只有 T3**：B 类四个 op 都是**单输入**（`dispatchPath([input], brepImpl)`）。单输入不可能"混合"，故 **T2 对 B 类不适用**；它们都有 `brepImpl`，故 **T1 不适用**。⇒ B 类收到 BREP 输入**只在 T3（显式 `mode='mesh'`）下发生**。

**三种处置方案，执行者须选其一并写明理由（不要自行发明第四种）**：

| 方案 | 做法 | 代价 | 与 H3 的关系 |
|---|---|---|---|
| **S1（推荐）** | B 类断链点**同样**调 `reconcileBrepInputs` | B 类在断链时多一次归约开销 | 不冲突：归约只在**有 BREP 输入**时发生，全 mesh 输入零变化 |
| S2 | Shape 上打"mesh 载荷未归约"标记；B 类透传标记，A 类见标记即归约 | 需扩展 `Shape` 与 slot 语义，侵入面大 | 不冲突，但改动面最大 |
| S3 | 维持现状，B 类不归约，依赖密度嗅探兜底 | 曲面体混合布尔仍可能失败 | 不冲突，但缺口未闭合 |

**本文档默认采用 S1**，理由：B 类收到 BREP 输入只在 T3（显式 `mode='mesh'`）下发生，属于用户显式指定的非默认路径，归约代价可接受，且能把缺口一次性闭合。若执行者实测发现 S1 在 T3 下引入回归，改用 S3 并在 §8.1 记录实测数据。

### 5.6 `src/mesh/reconcile.ts` 规范

**已实现**（§3.3）。规范要求：

| 步骤 | 导出函数 | 职责 |
|---|---|---|
| 1 顶点焊接 | `weldVertices(positions, indices)` | 按 1e-6 mm 量化到 hash 网格合并共享边重复顶点，重建索引。**复用** `src/boolean/csg-core.ts:114-155` 的 `weldPositionsWorker`，仓库内不留第二份 weld |
| 2 退化剔除 | `removeDegenerate(positions, indices)` | 丢弃零面积三角形，紧凑化索引与顶点 |
| 3 朝向统一 | `unifyOrientation(positions, indices)` | 连通分量内面法向传播（BFS），翻转缠绕不一致的三角形 |
| 4 2-manifold 断言 | `assertManifold(positions, indices)` | 每条无向边恰好被 2 个三角形共享。**不满足即显式抛错**（H2：不静默、不 try-catch 回退） |
| 入口 | `reconcileMesh(positions, indices, opts?)` | 依次执行 1→2→3→4；`opts.assertManifold === false` 可跳过第 4 步（仅供单测） |

**约束**：纯数据、无 wasm 依赖、可单测。不得引入 try-catch 吞错。

**调用方**（只有这两类，不得扩散）：

| 调用方 | 场景 |
|---|---|
| `reconcileBrepInputs`（`src/stdlib/reconcile.ts:29`） | 断链时刻，对 BREP 侧输入归约（§5.4） |
| 单测 `src/mesh/reconcile.test.ts` | 逐步断言四个步骤 |

### 5.7 反方向：mesh → BREP 提升（可选，显式 opt-in）

能力已存在，与断链物化是**相反方向**，两者**不得互相触发**：

- `reconstructSolidFromMesh(kernel, positions, indices)`（`src/occt-kernel/meshReconstruct.ts:104`）：三角网格 → ASCII STL → OCCT `importStl` → 多阶段愈合（`fixShape` → `healSolid` → `fixFaceOrientations` → `removeDegenerateEdges` → `unifySameDomain`）→ 失败则多容差面缝合回退（1e-5 → 1e-4 → 1e-3 → 1e-2）→ `isValid` 验证。
- 现有调用方：`src/brep/export/step.ts:72`、`src/primitives/brep-primitives.ts:313`。

**⚠️ 严禁做成运行时回退**（H1）：这是**尽力而为的启发式**（网格开放/非流形时会抛错），绝不能实现成"断链物化失败就提升"，也绝不能实现成"降级到 mesh 后又偷偷升回 BREP"。断链是**单向**的：一旦断链，该 part 就只有 mesh 层，除非用户显式 opt-in 提升。

**允许的形态**：显式 opt-in（新增 per-op 策略或 mode 参数）。auto 模式默认**仍是断链降级**；`mode='brep'` 下遇 T2/T3 仍按现状抛 `BrepUnsupportedError`（`backend-dispatch.ts:43-45`）。

本项在 Phase 0 **只做能力摸底，不落地**。

---

## 6. brepjs 兼容层规范

### 6.1 内核共享：句柄借用，不是格式转换

brepjs **不自研几何内核**，它是 occt-wasm 之上的适配器层（`src/kernel/index.ts:261-271`）。faijs 与 brepjs 用**同一个 wasm 内核** ⇒ 句柄在同一 arena 内可互通。

| 环 | 事实 | 文件 |
|---|---|---|
| ① | faijs 的 OCCT 句柄 = arena id（`ShapeHandle = number & { brand }`） | `node_modules/occt-wasm/dist/types.d.ts:6-8` |
| ② | brepjs 的 `ShapeHandle.wrapped` **就是原始内核句柄** | `src/core/disposal.ts:131-150` |
| ③ | brepjs 支持注入外部内核：`registerKernel(id, adapter)` 从主入口公开导出 | `src/kernel/index.ts:39`、`src/index.ts:13` |
| ④ | `OcctWasmAdapter.fromKernel(kernel)` 是推荐构造方式，只需 `OcctKernelOwner { getRawModule(): unknown; getRawKernel(): unknown }` | `src/kernel/occtWasm/occtWasmAdapter.ts:138-141,167` |
| ⑤ | faijs 的 occt-wasm 3.7.0 内核**已具备** `getRawModule()` / `getRawKernel()` | `node_modules/occt-wasm/dist/index.d.ts:512,524` |
| ⑥ | faijs 已把内核交给库函数：`getBackends().kernel.occt` | `src/cad-runtime/runtime.ts:286-303` |

⇒ 库顶层写一行：

```ts
registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(getBackends().kernel.occt as OcctKernelOwner))
```

此后 brepjs 造出的每个 solid，其 `.wrapped` 都是**faijs 自己 arena 里的合法句柄**，可直接 `fromHandle(raw)` 登记进 faijs BREP 链。**零 shim、零额外 wasm 下载（复用 faijs 实例）。**

**收益**：齿轮可与内置 op 走**精确 BREP 布尔**（全部输入 `hasBrep` 为真 → `dispatchPath` 返回 `'brep'`），导出**精确 STEP**（`ADVANCED_FACE`）。

### 6.2 adapter 职责与分层

| 层 | 职责 |
|---|---|
| brepjs | 提供齿轮算法 + occt-wasm 适配器；**不感知 faijs** |
| **adapter** | ①注入 faijs 内核；②调 brepjs 建形；③`wrapped` → `fromHandle` 转 faijs Shape；④钉住 brepjs 句柄防释放；⑤错误转译（`Result` → throw） |
| faijs | 提供 SDK（含 §4.5 的 `fromHandle`）、`registerLib`、`dispatchPath`、BREP 链生命周期 |
| 宿主 | 预 bundle / importmap / `registerInstalledLibs` / timeline 只读节点 |

**关键**：adapter 是**库**的一部分，不是 faijs 的一部分。faijs 不需要为 brepjs 写任何专有代码。

### 6.3 所有权三态协议（必须遵守）

**问题**：brepjs 的 `ShapeHandle` 带 `Symbol.dispose` / `.delete()`，并有 **FinalizationRegistry 兜底**（`src/core/disposal.ts:41`）。faijs 的 `solidCache` 长期持有 raw handle。**若 brepjs 侧包装对象被 GC，底层 arena 槽被释放 → faijs 持有的句柄悬空**。brepjs **没有** detach / 所有权转移 API。

| 方 | 对 raw handle 的行为 |
|---|---|
| **brepjs 侧** | **只钉不释**：adapter 在模块级数组永久持有 brepjs 包装对象引用，阻止 GC 与 FinalizationRegistry 触发；**禁止**调用 `.delete()` / `[Symbol.dispose]()` |
| **faijs 侧** | **独占释放**：raw handle 进 `solidCache`，由 `releaseSolid`（`runtime.ts:280-291`）调 `kernel.release()` |
| **双方** | **禁止重复释放** —— double free 在 wasm arena 上是未定义行为 |

**中间结果**（brepjs 变换/布尔产生的临时形状）：由 adapter 显式 `.delete()`，在交出最终句柄**之前**完成。

### 6.4 初始化时序

brepjs 需要 `await init()`，而 faijs 库函数签名是同步的（返回值可以是 Promise）。

**要求**：内核注入必须在**模块加载期**完成（模块顶层 await，或宿主 `await import(url)` 后模块导出已就绪的对象）。**禁止**在每个库函数内部 await 检查。

宿主侧 `registerInstalledLibs`（`ScriptEngine.ts:119-124`）已是 `await import(...)`，天然满足。

### 6.5 齿轮 API 契约

**brepjs 源 API**（`src/gear/gearFns.ts`）：

| 函数 | 位置 | 参数 |
|---|---|---|
| `makeExternalGear(params): Result<GearResult>` | `:165` | `ExternalGearParams`（`:51-81`）：`teeth` / `moduleSize` / `thickness` / `pressureAngleDeg?`(默认 20°) / `shift?` / `clearance?` / `flankThinning?` / `bore?` / `samples?` |
| `makeInternalGear` | `:211` | `InternalGearParams`（`:83-95`）：上者 + `ringWallThickness?`（默认 2×moduleSize） |
| `makePlanetaryGear` | `:273` | `PlanetaryGearParams`（`:97-124`）：`thickness` / `moduleSize?` / `sunTeeth?` / `planetTeeth?` / `numPlanets?` / ... |

**注意**：字段是 **`moduleSize`（不是 `module`）**，角度是 **`pressureAngleDeg`（度）**。单位 mm、+Z 向上、变换角度用度（`src/topology/transformFns.ts:43`）—— **与 faijs 契约一致，无需单位换算**。

**adapter 产出的库模块契约**：

```ts
export const contractVersion = 1

/** 参数名直接沿用 brepjs 字段名 —— 不加映射层（映射是负担不是价值） */
export function external(params: {
  teeth: number
  moduleSize: number
  thickness: number
  pressureAngleDeg?: number
  bore?: number
  shift?: number
  clearance?: number
}): SolidShape

export function internal(params: { /* 同 external + ringWallThickness? */ }): SolidShape
export function planetary(params: { /* 见 PlanetaryGearParams */ }): CompoundShape
```

**错误转译**：brepjs 返回 `Result<GearResult>`。adapter 必须 `if (isErr(r)) throw new Error(...)`，携带 brepjs 的 error code 与 message，**不得静默返回**。

---

## 7. 分阶段实施

### 7.1 Phase 0 —— 断链物化 + 阻断性验证（faijs 0.5.1）

| # | 任务 | 文件 / 命令 | 验收 |
|---|---|---|---|
| **P0-1** | **跑基线，记录真实结果** | `npx vitest run src/mesh/reconcile.test.ts`；`npx vitest run test/faijs/mixed/mixed.test.ts` | 把 13 + 10 条用例的通过/失败**逐条记录**进 §8.1。**禁止在拿到结果前改实现** |
| **P0-2a** | **补 T1 断链回归用例**（用户点名场景，当前零覆盖） | `test/faijs/mixed/` 新增：M6 = `box` → `knurl`（全 BREP 输入进 mesh-only op，T1）；M7 = `box` → `knurl` → `union(box)`（断链产物再进 A 类 op）；M8 = `mode='mesh'` 下 `box` → `translate`（T3，B 类） | 三份 fixture 可被 executor 接受；M6 验证 `knurl` 收到 BREP 输入后仍能产出合法网格 |
| **P0-2b** | **接线 C3–C6 断链点** | `drill.ts` / `extrude.ts` / `engrave.ts` / `split.ts` 的 mesh 分支入口加 `reconcileBrepInputs`（模板见 §5.4 的 knurl 接线形态） | 四个 op 在 T2/T3 下输入含 BREP 侧时，进入 CSG 后端前已完成归约 |
| **P0-2c** | **B 类断链点裁决**（C7–C10） | `copy.ts` / `transform.ts`（`translate`/`rotate`/`scale`）；按 §5.5 在 S1/S2/S3 中选一 | 选定的方案已实施或已明确记录为"接受缺口"；M8 通过 |
| **P0-3** | **验证 H3（零行为变化）** | `npx vitest run test/faijs/mixed/mixed.test.ts` + `npx vitest run src/brep-mesh-equivalence.test.ts` + `npx vitest run test/faijs/parity/parity.test.ts` | M4/M5 结果与 P0-1 基线**一致**；parity 测试全绿 |
| **P0-4** | **V-1：occt-wasm 版本验证**（阻断性） | 升 `occt-wasm` 到 `^3.8.0` → `npx tsc --noEmit` → 跑几何测试 → 打印句柄运行时形态（`typeof handle`、`handle.id`） | tsc + 全部 brep/mesh 几何测试全绿；记录句柄形态。**若失败，回退 3.7.0 并记录阻塞** |
| **P0-5** | **V-2：adapter 原型验证**（只验证，不落地） | 最小脚本：验证 `OcctWasmAdapter.fromKernel(faijsKernel)` 可用、产出句柄可被 `fromHandle` 三角化 | 打印 `hasBrep(shape) === true`、`positions.length > 0` |

**执行顺序**：P0-1 → P0-2a → P0-2b → P0-2c → P0-3 → P0-4/P0-5（后两者可并行于 P0-3 之后）。

**P0 完成判据**：M1–M8 全绿 + lint/typecheck 干净 + parity 全绿 + C1–C10 十个断链点状态明确（已接线或已裁决接受缺口）+ P0-4 有明确结论。

### 7.2 Phase A —— 语言层收尾（faijs 0.5.2）

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| **A1** | **顶层函数定义** | `src/lang/parser.ts:809-811`（移除 `FunctionDeclaration` 拒绝分支）；`src/cad-runtime/terminal-dag.ts`（跳过非几何语句，`:62` 已有 `hasAssignment` 判据） | `function` + import + 命名空间调用 parse → codegen → parse **往返逐位相等**；控制流仍报 `E_CONTROL_FLOW`；`eval`/`new`/`export` 仍被拒；函数定义不污染 DAG 终端集 |

**降级项**（本阶段不做）：`var` 放开（O2）、参数右侧任意表达式（O3）。

### 7.3 Phase B —— 模块运行时（faijs 0.5.3）

| # | 任务 | 交付物 | 依赖 | 验收 |
|---|---|---|---|---|
| B1 | **SDK 增补** `getKernel` / `meshHandle` / `fromHandle` | 新增 `src/brep/handle-bridge.ts` + `src/sdk.ts` 增补导出 | P0-4 | §4.5 四条不变量各有测试；`src/sdk.test.ts` 守卫仍通过（`dist/sdk.js` 零 heavy 依赖） |
| B2 | **通道①预 bundle**：后端 esbuild 服务（external SDK + occt-wasm）→ 对象存储 → hash URL | 3d_editor `/api/internal` | B1 | 产出的 ESM 内 `@faicad/faijs/sdk` 保持为裸说明符 |
| B3 | **importmap + `dist/sdk.js` 复制到 `public/vendor/`** | 3d_editor `vite.config.ts` + 页面 | B1 | 浏览器控制台无裸说明符解析错误 |
| B4 | **mock 库 fixture**：带 `contractVersion` 的最小库模块，**mesh 版 + BREP 版各一** | faijs `test/` + 3d_editor fixture | B1 | 两版均可被 `registerLib` 接受并真正求值 |
| B5 | **`registerInstalledLibs` 单测** | 3d_editor | B4 | 覆盖 import → registerLib → `ns.<binding>(...)` 真正求值 |
| B6 | 🔴 **修 `getFeatureByOp` 死链** | `features/index.ts:126-129` 去掉硬编码 `return undefined`；`ScriptEngine.ts:462` 传真实包名 | B4 | 第三方包名的 feature 可被查到；有测试 |
| B7 | **无 faceEvolution 的退化行为确认** | faijs | B1 | 缺失时下游（如 drill 按面选择）**显式报错**而非崩溃或静默错误结果。**不得**因此把第三方 BREP 产物降级为 mesh |
| B8 | **快照对齐回归** | 3d_editor | B5 | `lib-manifest.json` export/restore 往返一致 |
| B9 | **通道②CDN 通道打通** | 宿主侧 | B3 | `esm.sh?external=@faicad/faijs/sdk` 可加载 |
| B10 | 通道③ModuleResolver | — | **延后到 V5.2** | — |

### 7.4 Phase C —— brepjs 兼容层端到端（faijs 0.5.4）

| # | 任务 | 验收 |
|---|---|---|
| C1 | adapter 实现：内核注入 + 齿轮 API 封装 + 所有权三态协议（§6.3） | 代码 + 单测 |
| C2 | 预 bundle adapter 库（走 B2 通道） | external 生效、**零额外 wasm 下载** |
| C3 | **场景验收** | 见下方六项断言 |
| C4 | 3d_editor 侧集成 | timeline 出现只读 `brepjs-gear.external` 节点；快照 export/restore 几何一致 |
| C5 | 顺带封装 1–2 个高价值 op 验证泛化性（建议：螺纹 `src/operations/threadFns.ts:64`、圆角 `src/topology/modifierFns.ts:265`） | 可正常调用 |

**目标场景脚本**（验收用）：

```js
import * as gear from 'brepjs-gear'

let part0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
let part1 = cad.box({ size: [40, 40, 8] })
let part2 = cad.union(part0, part1)
```

**六项验收断言**：

1. `hasBrep(part0) === true`
2. `cad.union(part0, part1)` 走 **brep** 路径（断言 `dispatchPath` 判定结果，非 mesh）
3. 导出 STEP 为 **`ADVANCED_FACE`**（精确），非三角化
4. 几何正确：`pitchDiameter = moduleSize × teeth = 48mm`；`tipDiameter = moduleSize × (teeth + 2) = 52mm`（用 brepjs 返回的 `GearResult` 字段交叉校验）
5. 3d_editor timeline 出现只读节点 `brepjs-gear.external`
6. 保存 → 重载 → 几何一致

### 7.5 Phase D —— faits 执行路径（faijs 0.5.5）

`.faits` → sucrase 去类型（保留行号）→ acorn 解析 import → 说明符重写 → Blob → `import()` 整段执行 → 显式声明输出。

| | faijs | faits |
|---|---|---|
| 解析 | parseScript → ScriptIR（结构化，可增量） | sucrase → 纯文本（不建 IR） |
| 执行粒度 | 逐语句 fn（append/update/plan） | 整段一次执行 |
| DAG 活跃性 | ✅ 引擎自动推导 | ❌ 显式声明输出 |
| timeline | ✅ 一行一节点 | ❌ 不参与 timeline |

faits 的 import 解析**复用** B 阶段的通道 ①② —— 这是 B 排在 D 前面的理由。

### 7.6 Phase E —— 生态与加固（V4/V5）

V4.1 库市场 / V4.2 参数表单 / V4.4 脚手架 / V4.5 文档站 / V5.1 Worker 沙箱 / V5.2 多版本共存 + ModuleResolver / V5.3 第三方库声明 `brepImpl` / V5.4 按需加载 / V5.5 引擎切换 / **V5.6 occt-wasm 版本治理常态化**。

---

## 8. 验收矩阵

### 8.1 Phase 0 基线记录表（执行者填写）

| 用例 | 期望 | P0-1 实际结果 | P0-2/P0-3 后结果 |
|---|---|---|---|
| `reconcile.test.ts` 13 条（weld / 退化 / 朝向 / 2-manifold / 全管线） | 全绿 | ☐ 待填 | ☐ 待填 |
| M1 `load(stl)` + `box` | 通过，走 mesh | ☐ 待填 | ☐ 待填 |
| M2 `load(stl)` + `cylinder` | 通过，走 mesh | ☐ 待填 | ☐ 待填 |
| M3 `sdf` + `box` | 通过，走 mesh | ☐ 待填 | ☐ 待填 |
| M4 `box` + `box` | 通过，走 **brep** | ☐ 待填 | ☐ 待填 |
| M5 `load(stl)` + `load(stl)` | 通过，走 mesh | ☐ 待填 | ☐ 待填 |
| M6 `box` → `knurl`（T1 mesh-only 断链） | 通过，产物无 BREP 槽 | 无此用例 | ☐ 待填 |
| M7 `box` → `knurl` → `union(box)`（断链产物再进 A 类） | 通过，走 mesh | 无此用例 | ☐ 待填 |
| M8 `mode='mesh'` 下 `box` → `translate`（T3，B 类） | 通过，走 mesh | 无此用例 | ☐ 待填 |
| P0-4 occt-wasm 3.8 句柄形态 | `typeof` / `.id` 记录 | ☐ 待填 | — |

**C1–C10 断链点状态确认表**（P0 完成时每一格必须有结论）：

| 断链点 | 触发覆盖 | 接线状态 | 备注 |
|---|---|---|---|
| C1 `boolean` | T2 / T3 | ✅ 已接线 | `boolean.ts:102` |
| C2 `knurl` | T1 | ✅ 已接线 | `knurl.ts:30` |
| C3 `drill` | T2 / T3 | ☐ | |
| C4 `extrude` | T2 / T3 | ☐ | |
| C5 `engrave` | T2 / T3 | ☐ | |
| C6 `split` | T2 / T3 | ☐ | |
| C7 `copy` | T3 | ☐ | B 类，见 §5.5 裁决 |
| C8 `translate` | T3 | ☐ | B 类，见 §5.5 裁决 |
| C9 `rotate` | T3 | ☐ | B 类，见 §5.5 裁决 |
| C10 `scale` | T3 | ☐ | B 类，见 §5.5 裁决 |

### 8.2 各阶段验收汇总

| 阶段 | faijs 侧 | 3d_editor 侧 |
|---|---|---|
| **0** | M1–M8 全绿且 M4/M5 与基线一致；`reconcile` 四步各有单测；C1–C10 十格状态表全部有结论；触发语义为"断链时刻、只对 BREP 侧"（H4）；P0-4 有明确结论 | 回归全绿 |
| **A** | 函数定义 parse → codegen → parse 往返相等；控制流仍报专用码；DAG 终端集不受函数污染 | 回归全绿 |
| **B** | SDK 三 API 可用且有守卫测试；`dist/sdk.js` 仍零 heavy 依赖；B7 退化行为有测试 | mock 库（mesh + BREP 两版）经 `registerInstalledLibs` 真正求值；`getFeatureByOp` 死链修复并有测试；timeline 出现 `包名.函数名` 只读节点 |
| **C** | §7.4 六项断言全过；精确 STEP（`ADVANCED_FACE`）；零额外 wasm | timeline 只读节点；快照 export/restore 几何一致 |
| **D** | faits 执行 + faijs⇄faits 互操作用例 | faits 文件可执行（不参与 timeline） |
| **E** | 逐项按 V4/V5 验收 | 对应 UI/沙箱/多版本能力 |

### 8.3 闭环定义

一阶段 = faijs 改动 + 自测 → 版本号递增 + `npm run pack` → 3d_editor 升级 tarball + 对应修改 → 3d_editor 测试验收。**任何一步失败则该闭环不交付、退回修复。**

**跨项目流程**（3d_editor `CLAUDE.md:4-10`）：先定 faijs API → 先写单测（脱离 web 验证几何）→ faijs 测试通过并 push → 更新 3d_editor `package.json` 中 faijs 包路径并安装 → 才做 3d_editor 开发。

**版本纪律**：每次 pack 前版本号递增，**只改最后一位**（0 = 0.5.1、A = 0.5.2、B = 0.5.3、C = 0.5.4、D = 0.5.5）；`demo/package.json` tarball 引用同步递增。

---

## 9. 明确不做

### 9.1 🔴 npm publish —— 等专利通过后才发布

- 用户原话（逐字）：**必需等专利通过后才发布。**
- 只做到"包可发布形态"（`npm pack` 可出 tarball、SDK 零 heavy 依赖、元信息齐备），**publish 动作不在本计划范围**。
- 专利通过前：不执行 `npm publish`、不上架公开 registry。本地 tarball（demo / 3d_editor `file:` 引用）与内部流转不受影响。

### 9.2 其它推迟项

| 项 | 原因 |
|---|---|
| 通道③运行时 ModuleResolver | 延后到 V5.2（与多版本 scopes 合并做） |
| `var` 放开 / 参数右侧任意表达式 | 风险/收益比不佳，待真实用例 |
| 3d_editor playwright 全量 e2e | 非确定性套件，按 `CLAUDE.md` 只跑相关 spec |
| 库市场 / Worker 沙箱 / 按需加载 / 引擎切换 | V4/V5，按依赖顺序 |

---

## 10. 风险登记与处置

| # | 风险 | 处置 |
|---|---|---|
| **R1** | occt-wasm 版本分歧（faijs 3.7.0 vs brepjs ^3.8.0），句柄运行时形态可能不一致 | **P0-4 阻断性验证**。先实测 `typeof` / `.id`，再决定是否升级。brepjs 注释称 3.7+ downcast 返回"同一 id 包在新对象里"（`src/core/shapeTypes.ts:315-322`），与 3.7 的 `number` 类型声明有张力，**必须实测** |
| **R2** | brepjs 句柄所有权（FinalizationRegistry 悬空风险） | adapter 模块级数组钉住引用（§6.3 三态协议）；**禁止**双方重复释放 |
| **R3** | SDK 缺三角化能力 | B1 新增三 API；**不得** import `brep-ops`（会拉入 three，破坏 SDK 守卫测试） |
| **R4** | 无 faceEvolution 的下游退化行为未确认 | B7 专项验证；不得因此把第三方 BREP 产物降级为 mesh |
| **R5** | brepjs 是活跃项目，API 可能变动 | adapter 锁定 brepjs 版本；不在 faijs 内写 brepjs 专有代码（§6.2 分层保障） |
| **R6** | 混合布尔回归覆盖刚建立，真实状态待 P0-1 测定 | 严格执行 P0-1 先测后改。**不得**以文档断言替代实测 |
| **R7** | `reconstructSolidFromMesh` 是尽力而为的启发式 | 只能作**显式 opt-in**；**严禁**做成"降级失败就提升"的运行时回退（H1） |
| **O5** | 主线程全权限风险（任意 URL 加载） | V5.1 Worker 沙箱落地前，CDN 通道（通道②）需 UI 显式用户确认 |
| **O6** | 大体积纯数据库 bundle 膨胀 | V5.4 按需切片；V3 先接受 |

---

## 11. 附录 A：代码索引

**faijs（C:\my\Faicad\faijs）**

| 关注点 | 位置 |
|---|---|
| Shape 定义 | `src/mesh/types.ts:35-38` |
| Shape 构造器 / BREP 槽 | `src/stdlib/shape.ts:34-59`（`solid`/`fromBrep`）、`:98-121`（`getSlot`/`ensureSlot`/`hasBrep`/`brepOf`） |
| SDK 导出面 | `src/sdk.ts:24-63`；守卫测试 `src/sdk.test.ts` |
| 契约与状态 | `src/runtime-state.ts:55`（`CONTRACT_VERSION`）、`:69-75`、`src/runtime-state.ts:31-52`（`Backends`）、`:200-206`（`getBackends`）、`src/cad-runtime/runtime.ts:156-186`（globalThis 锚点） |
| 库注册 | `src/cad-runtime/runtime.ts:254-258`（`registerLib`）、`:280-303`（句柄生命周期 + `kernel.occt` getter） |
| 模块加载 | `src/cad-runtime/module-executor.ts:34-37`（`Namespaces`）、`:58-71`（`importModule`） |
| 路径判定（断链时刻） | `src/cad-runtime/backend-dispatch.ts:30-51`（`dispatchPath`）、`:36`（T3 mesh 模式）、`:43-45`（brep 模式抛错）、`:49`（T2 auto 降级） |
| **断链物化共用入口** | `src/stdlib/reconcile.ts:29-44`（`reconcileBrepInputs`） |
| 归约四步 | `src/mesh/reconcile.ts`（`weldVertices` / `removeDegenerate` / `unifyOrientation` / `assertManifold` / `reconcileMesh`）+ 测试 `src/mesh/reconcile.test.ts` |
| **A 类断链点**（下游构造 Manifold） | C1 `src/stdlib/boolean.ts:99,102`；C2 `src/stdlib/knurl.ts:27,30`；C3 `src/stdlib/drill.ts:194,196`；C4 `src/stdlib/extrude.ts:50,52`；C5 `src/stdlib/engrave.ts:177,186`；C6 `src/stdlib/split.ts:239,241` |
| **B 类断链点**（纯数组操作） | C7 `src/stdlib/copy.ts:55,57-60`；C8/C9/C10 `src/stdlib/transform.ts:73,81,89` → `src/mesh/transform.ts:19-49` |
| Manifold 构造点（A 类判据） | `src/boolean/csg-core.ts:60-81`（`meshToManifold`）→ `src/browser-host/csg-worker.ts:41,51,63,80,104`、`src/browser-host/inline-csg-backend.ts:31` |
| 兜底焊接（嗅探式，不符合 H4） | `src/boolean/csg-core.ts:70`（密度阈值 `vertCount >= triCount*3*0.9`）、`:114-155`（`weldPositionsWorker`） |
| 断链事件（只覆盖 T1） | `src/cad-runtime/module-executor.ts:376-395`（`emitBrepLost`，判据"全部输入在链、输出不在链"）；sink：`src/browser-host/browser-event-sink.ts:18-20` |
| 三角化 | `src/brep/brep-ops.ts:40-64`（`solidToShape`；⚠️ `:17` import three，SDK 不得引用） |
| mesh→BREP（提升，opt-in） | `src/occt-kernel/meshReconstruct.ts:104`（`reconstructSolidFromMesh`） |
| 格式判定（T2 来源） | `src/brep/brep-chain.ts:26`（`CAD_FORMATS`，不含 stl）、`:38-55`（`isCadFormat`）；`src/stdlib/load.ts:53,61-63` |
| mesh-only op（T1 来源） | `src/stdlib/knurl.ts:26`、`src/stdlib/sdf.ts:25`；`src/brep/brep-chain.ts:68`（断链语义注释） |
| parser 黑名单 | `src/lang/parser.ts:795-819`；函数定义拒绝在 `:809-811` |
| occt-wasm 类型 | `node_modules/occt-wasm/dist/types.d.ts:6-8`；`dist/index.d.ts:512,524`（`getRawModule`/`getRawKernel`） |

**brepjs（C:\git\OpenCascade\brepjs）**

| 关注点 | 位置 |
|---|---|
| 内核注册 | `src/kernel/index.ts:39`（`registerKernel`）、`src/index.ts:13`（公开导出） |
| 适配器 | `src/kernel/occtWasm/occtWasmAdapter.ts:138-141`（`OcctKernelOwner`）、`:167`（`fromKernel`） |
| 句柄与所有权 | `src/core/disposal.ts:41`（FinalizationRegistry）、`:131-150`（`ShapeHandle.wrapped`）；`src/core/shapeTypes.ts:315-322`（3.7+ downcast） |
| 齿轮 | `src/gear/gearFns.ts:51-81`（`ExternalGearParams`）、`:83-95`（`InternalGearParams`）、`:97-124`（`PlanetaryGearParams`）、`:165` / `:211` / `:273`（三个 make 函数） |
| 变换（角度单位为度） | `src/topology/transformFns.ts:43` |
| 其它可借用能力 | 螺纹 `src/operations/threadFns.ts:64`、放样 `loftFns.ts:44`、扫掠 `sweepFns.ts:135/280`、阵列 `patternFns.ts:26/68/119`、圆角/倒角/抽壳/加厚/拔模 `modifierFns.ts:265/326/407/168/576` |
| 包元信息 | `package.json`：`name: brepjs`、`type: module`、exports 含 `.` / `./core` / `./topology` / `./operations` 等 |

**3d_editor（C:\my\Faicad\3d_editor）**

| 关注点 | 位置 |
|---|---|
| faijs 依赖 | `package.json:24` → `file:../faijs/faicad-faijs-0.5.0.tgz` |
| 库注册 | `src/engine/script-engine/ScriptEngine.ts:101`（调用点）、`:119-124`（`registerInstalledLibs`） |
| 🔴 死链 | `ScriptEngine.ts:462`（恒传 `undefined`）、`src/engine/features/index.ts:126-129`（硬编码 return undefined） |
| 库清单 | `src/engine/version-store/LibManifestStore.ts:17-61`；`src/stores/serialization/snapshot-io.ts:166-174,338-348` |
| Timeline 只读节点 | `src/engine/components/panels/TimelinePanel.tsx:124,171,173` |

---

## 12. 附录 B：执行者检查清单

开始每个阶段前，逐项确认：

- [ ] 已读 `AGENTS.md`（红线 + 测试纪律）
- [ ] 已读本文档 §0.2 的七条红线
- [ ] 已确认没有其它测试进程在跑（H6）
- [ ] 本阶段每个任务都写了对应测试
- [ ] 改 faijs 后已跑 `npm run lint` + `npx tsc --noEmit`
- [ ] faijs 测试通过后才 pack 并升级 3d_editor
- [ ] 版本号只改最后一位
- [ ] 未执行 `npm publish`

**改动任何 op 的 mesh 分支前，额外确认**：

- [ ] 该 op 属于 §5.3 的哪一类（A 类 / B 类 / 无输入创建类）？
- [ ] 若可能收到 BREP 输入，mesh 分支入口已调 `reconcileBrepInputs`（§5.4），且位置在 `dispatchPath` 之后、mesh 实现之前
- [ ] 归约**只作用于 BREP 侧输入**，mesh 侧原样透传（H4）
- [ ] 没有把物化写成 try-catch 回退（H1）—— 归约失败必须显式抛错
- [ ] 没有在断链后偷偷调用 `reconstructSolidFromMesh` 把 part 升回 BREP（§5.7）
- [ ] §8.1 的 C1–C10 状态表已更新到本 op 那一行
