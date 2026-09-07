# CadQuery 兼容层 + 多文件 `.fai.js` 项目 —— 技术实现方案

日期：2026-09-06
状态：方案（未实施）
样本工程：`C:\git\CADQ\mini_lathe`（CadQuery 多文件参数化建模，小型车床刀架）
基线仓库：`C:\my\Faicad\faijs`

> **本方案的每一条"现状"结论都来自 2026-09-06 对本仓库源码的实机执行**
> （`npx tsx` 直接调用 `CadRuntime` / `DirectExecutor` / `extractMetadata`，共 40+ 用例），
> **不是来自历史文档**。faijs 当前处于双通道重构期，`docs/plans/` 中的旧结论一律不引用。

---

## 0. 用户原始需求（逐字）

> 分析这个项目C:\git\CADQ\mini_lathe，它是基于cadquery的api实现的一个多零件模型。现在我需要把整体它移植到faijs环境下，用.fai.js实现。未来，我还有很多基于cadquery的模型库，需要移植到faijs。所以你需要考虑如何让faijs兼容cadquery的api，使得移植的工作量尽量小。之前faijs已经兼容了brepjs的api，这一点必须保留，也许可以基于目前的faijs的api再增加一个cadquery api兼容层，当然也可以实现为库，不需要写到faijs的核心代码库里。此外，之前所有的建模，都是假定单文件的。这个mini_lathe是一个多文件的项目，所以也要支持.fai.js多文件的项目，要支持文件之间的引用。之前faijs已经支持加载第三方ts库了，现在则是要求加载本地项目里的.fai.js文件。最后，mini_lathe有单独的装配代码，用到了cadquery自己的装配api，其constrain有独特的语法。这一部分先不支持，可以用brepjs的装配语法实现，要让.fai.js文件里可以写装配代码。请先完整分析，写一份技术实现方案。

**追加澄清（本次重写的原因）**：

> 这份文档需要大改。parser的架构已经大改： UI 通道与执行通道解耦 + parser 退化为元数据提取器 + 删除中间层 IR（这部分还在开发中，另外一个agent）。你需要重新核实和重写parser这部分。此外，现在一个.fai.js文件中，可以引用另外一个fai.js文件中所有终端的形状，不需要导出或return语句。

拆解为 5 个目标：

| # | 目标 | 本方案结论 |
|---|---|---|
| G1 | CadQuery API 兼容层，移植工作量最小 | 兼容层做**库** `@faicad/cq-compat` + **转译器**自动拆链（§4.2） |
| G2 | brepjs 兼容必须保留 | 不动现有 80 个 compat 导出；仅**追加**投影（§4.5） |
| G3 | `.fai.js` 多文件互引用 | **已落地**（§1.2），本方案补映射规则与约束 |
| G4 | 装配代码可写在 `.fai.js` 里 | **已可写**（`cad.assembly`）；CadQuery `constrain` 落到库层（§4.4） |
| G5 | 按新架构重写 parser 部分 | 已按双通道重构现状重写（§1.1、§1.3） |

---

## 1. 现状基线（2026-09-06 实测）

### 1.1 双通道架构：已落地，旧 IR 通道与新的 direct 通道双路径共存

实测确认（读源码 + 执行验证）：

| 组件 | 文件 | 角色 |
|---|---|---|
| `DirectExecutor` | `packages/core/src/cad-runtime/direct-executor.ts`（848 行） | **执行通道**：`.fai.js` 源码直通 JS VM，**不 import `parser.ts` / `compile.ts`**（已 grep 确认） |
| `extractMetadata` | `packages/core/src/lang/metadata-extractor.ts`（1389 行） | **UI 通道**：退化为元数据提取器，产出 `UiMetadata`，不生成可执行代码 |
| `computeLiveShapes` | `packages/core/src/cad-runtime/live-shapes.ts`（272 行） | 终端判定（替代 `terminal-dag`） |
| `ModuleRegistry` | `packages/core/src/cad-runtime/module-registry.ts`（240 行） | 多文件装载 + 隐式导出 |
| `ProjectLoader` | `packages/core/src/cad-runtime/ports.ts:208` | 宿主注入项目文件表（`listModules` / `readSource`） |
| 开关 | `new CadRuntime(ports, mode, ns, { executor: 'direct' })` | direct 为 **guarded 可选**，缺省仍是 `module`（旧 IR 通道） |

`UiMetadata` 结构（`metadata-extractor.ts:80`）：

```ts
interface UiMetadata {
  lines: StatementSummary[]      // 行级语句摘要（timeline / 参数编辑 / 终端判定）
  params: ParamEntry[]           // 参数表
  imports: ImportEntry[]         // import 表（多文件与库装载共用）
  functions: FunctionEntry[]     // 顶层函数表
  blocks: BlockEntry[]           // 控制流块（只读节点）
  keep: Map<number, KeepEntry[]> // 行内 keep 声明
  terminalShapes?: TerminalShape[]
}
```

**架构含义（本方案的立足点）**：执行通道与 UI 通道已解耦，但 `runtime.execute()` 仍会调用
`extractMetadata`（`runtime.ts:582/648`，为 `computeLiveShapes` 提供 `lines`/`blocks`/`keep`）。
因此**两条通道的语法接受集不一致会直接表现为"能跑但 UI 看不见"或"UI 认但执行报错"**——
见 §1.3 矩阵，这是本方案必须处理的一等风险。

### 1.2 多文件：已落地，且为隐式导出（无需 export / return）

`ModuleRegistry` 已实现，导出面 = **存活 shape ∪ 常量 ∪ 函数**：

```ts
interface FaiModuleExports {
  values: Record<string, unknown>                        // 存活 shape + 常量
  fns: Record<string, (...a: unknown[]) => unknown>      // 顶层函数
  liveShapes: Set<string>                                // 存活 shape 名（引用校验用）
}
```

实测 6 个用例（`CadRuntime` + 内存 `ProjectLoader`，direct 模式）：

| 用例 | 结果 |
|---|---|
| `import * as cfg` + `cfg.OUTX`（普通常量） | ✅ |
| `import { pin_holes }`（函数） | ✅ |
| `import { cfgPlate }`（存活 shape） | ✅ |
| `cfg.INX`（派生常量，二元表达式） | ✅ |
| **Q1 `import { OUTX }`（普通常量，named 形态）** | ❌ `BINDING_NOT_EXPORTED` |

**⚠️ 实测出的不对称（必须写进移植规约）**：
`resolveBinding`（`module-registry.ts:201`）只认 `liveShapes ∪ fns`。
**普通常量不在 `liveShapes` 里 ⇒ 只能走 namespace import**。
即 CadQuery 的 `from config import OUTX` 必须写成 `import * as config` + `config.OUTX`；
而 mini_lathe 里原本就是 `import config` + `config.OUTX` 的写法，**可以直接一一对应**。

另有两条既有语义：
- **A-9**：模块内被消费的 shape 不在 `liveShapes` ⇒ 跨文件引用报 `BINDING_NOT_EXPORTED`。
- **A-10**：跨文件引用 ≠ 消费 ⇒ B 引用 A 的 shape 后，该 shape 在 B 侧仍作直接终端保留。

### 1.3 语法接受集实测矩阵（两通道不一致 —— 本方案的核心风险）

方法：`npx tsx` 分别调用 `DirectExecutor.execute()`（纯执行通道，绕开 metadata）、
`extractMetadata()`（纯 UI 通道）、`CadRuntime.execute()`（两者串联）。

| 写法 | DirectExecutor（执行） | extractMetadata（UI） | 说明 |
|---|---|---|---|
| `const INX = OUTX - 24`（二元式） | ✅ | ✅ | 旧 parser 曾报错，现已可用 |
| `const TOL = -0.02`（一元） | ✅ | ✅ | |
| `for (let i=0;i<n;i++){…}` 顶层块 | ✅ | ✅ | |
| 顶层块内 `a = cad.translate(a, …)` 重赋值 | ✅ | ✅ | 块走 `hoistBlockText`，自动注入 `await` |
| 顶层块内多行 + 局部变量 | ✅ | ✅ | |
| `while` / `if` 顶层块 | ✅ | ✅ | |
| 顶层 `function` + 调用 | ✅ | ✅ | |
| `cfg.x` 对象成员作实参 | ✅ | ✅ | |
| 三元 | ✅ | ✅ | |
| `class` 声明 | ✅ | ❌ `class declarations are not allowed` | 两通道不一致 |
| **`for (… of …)`** | ✅ | ❌ | 经 `CadRuntime` 串联时整体失败 |
| **解构 `const [a,b] = …`** | ❌ | ❌ | |
| **三级链 `a.b().c()`** | ❌ `expected <ns>.<op>(…)` | ⚠️ 不报错但**降级为 param** | 见下 |
| **`[1,2].forEach(…)`（数组接收者）** | ❌ | ⚠️ 降级为 param | |
| 两级 `w.m()`（变量作 receiver） | ✅ | ✅ | `lineConsumes` 有 receiver 概念 |
| `cad.box(…)` 作实参（嵌套调用） | ✅ | ✅ | `transformArg` 递归 |

**三级链的根因**：`direct-executor.ts:699 emitCall()` 只处理两种 callee——
`<Identifier>.<Identifier>(…)` 与 `<Identifier>(…)`；receiver 为 `CallExpression` 时直接抛错。
`metadata-extractor.ts:1195 isOpCall()` 是同一套两级判定，链式落不进 `lines`，
被当作**参数声明**（实测 `lines=0, params=1`）。

**后果**：即使执行通道放开链式，UI 通道也拿不到该行的 `StatementSummary` ⇒
timeline 无此节点、参数编辑不可见、终端判定缺少 producer 行。

**结论：链式支持必须两通道同时改，或者——绕开它（本方案选后者，见 §4.2.2）。**

### 1.4 函数体内循环调用 cad：必须显式写 `async function` + `await`

`transformFunction`（`direct-executor.ts:600`）**原样保留函数体**，只注入
`const cad = __ns.cad` 绑定，**不自动注入 `await`**；而 cad 的 op 全是 async（返回 Promise）。
实测四种形态：

| 写法 | 结果 |
|---|---|
| `function f(s){ return cad.translate(s,…) }`（无循环） | ✅ 返回值在**调用点**被 `await` |
| 函数体纯计算循环（不调 cad） | ✅ |
| `function f(s){ for(…){ r = cad.translate(r,…) } return r }` | ❌ `Cannot read properties of undefined (reading 'length')` |
| `function f(s){ … await … }`（函数名无 `async`） | ❌ `SyntaxError: Cannot use keyword 'await' outside an async function` |
| **`async function f(s){ for(…){ r = await cad.translate(r,…) } return r }`** | ✅ |

**根因在解析顺序**：源码先经 acorn 整体解析，**此时** `function` 不是 async ⇒ 函数体内的
`await` 非法 ⇒ 在变换成 async 之前就被拒。写成 `async function` 后源码层即合法，
而 `transformFunction` 生成的本来就是 `__ctx.f = async function f(…)` ⇒ 函数体内 `await` 成立。

实测覆盖：`for` / `while` / 数组点位表 / 无循环 4 种函数体（U1–U4）全通过；
**跨文件**场景 V1（`import { pin_holes }` 具名导入 async 函数）与
V2（`import * as cfg` + `cfg.pin_holes` + `cfg.PIN_PTS`）全通过。

⇒ **CadQuery 的 `pin_holes(wp)` 可直接在 `.fai.js` 里写成 `async function`**，
**无需沉到库、无需任何 core 改动**。移植规约：**凡函数体内调用 cad，一律 `async function`
且每个 cad 调用前写 `await`。**

### 1.5 op 可用性实测：mini_lathe 在 mesh 模式下跑不通

方法：`CadRuntime(ports,'mesh',…)` 逐个执行（direct 模式）：

```
MESH✓ union  intersect  translate  scale  (box / cylinder / sphere / cone …)
MESH✗ cut  rotate  mirror  chamfer  pocket  drill  rectangularPattern
      circularPattern  boss  fuse  offset  split      → E_MESH_UNSUPPORTED
```

mini_lathe 用到的 `hole`(20) / `fillet`(7) / `cutBlind`(12) / `shell`(2) / `rotate`(2)
全部落在 `MESH✗` 一侧。

**brep 模式实测**：`registerOcctBrepEngine()` + `CadRuntime(ports,'brep',…,{executor:'direct'})`
→ warmup ✅、`cut` ✅（其余 op 因 OCCT 单次运算耗时数秒，未在探针内跑完）。

**结论：mini_lathe 移植后必须跑 brep 模式。** 附带工程约束：brep 运算慢，
而 no-IR 架构下 `update` = 全量重跑（`ModuleRegistry` 每轮全量重读重执行，
`fingerprint` 增量缓存标注为 v2）⇒ 8 文件全量重跑的交互延迟需在宿主侧评估。

### 1.6 兼容面投影的真实结构：三层，两处断裂

> 本节为 2026-09-07 对前一版"两面都没有"结论的**更正**。前一版结论不准确：
> `fillet` / `shell` 的投影代码**已经生成好了**，只是没有接到任何公开入口。

#### 1.6.1 三层结构（实测）

`api/surface/arg-spec.ts`（866 条，覆盖 852 个上游符号）是唯一分类源，`kind` 决定投影方式：

| `kind` | 数量 | 投影方式 |
|---|---|---|
| `brep-op` | 42 | `compatOp(projectBrepOp(…))` 包装 → `api/generated/<module>.ts` |
| `pure` | 111 | 直接 re-export → 同上 |
| `query` | 18 | 借入 Shape → 调 vendored → 返回纯数据 → 同上 |
| `type` | 286 | 类型导出 |
| `skip` | 395 | **不投影**，每条带 `reason` |

生成面 `api/generated/*.ts` 合计 **171 个运行时符号**，`fillet` 明确在其中：

```ts
// packages/core/src/api/generated/topology.ts:413（生成文件）
export const fillet = compatOp(
  projectBrepOp('fillet', ["shape","edges","radius"], 'A', __vendored_fillet),
  { name: 'fillet' },
)
```

#### 1.6.2 断裂一：生成面 171 个里，144 个没有公开入口

`api/index.ts:41` 只导出 `./generated/script-face`，而 `script-face.ts` 是
`gen-l3-surface.ts` 按 `kind === 'brep-op' && scriptFace === true` 筛出来的
**27 个**（`scriptFace` 是 arg-spec 里的**手工标记**）：

```
arg-spec brep-op (42)  ──► api/generated/{topology,operations,…}.ts
                              │
                              ├─ scriptFace:true (27) ──► script-face.ts ──► api/index.ts ──► 公开
                              └─ 其余 (15) ────────────► ✗ 无引用
arg-spec pure (111) + query (18) ─► api/generated/*.ts ──► ✗ 无引用
```

`api/generated/topology.ts` 的 30 个导出中，17 个被 `script-face.ts` 挑走，
**`fillet` / `shell` / `section` 未被挑走**；除 `script-face.ts` 与
`compat-op.test.ts`（import `clone`）外，**无任何生产代码引用这些模块**。

⇒ 这 144 个是"生成了但拿不到"的死代码。接通只需在 `api/index.ts` 加一行导出。

#### 1.6.3 断裂二：手写 compat 面与生成面是两套独立体系

库作者唯一入口是 `@faicad/faijs/compat` → `api/compat/index.ts`（**手写** 80 个），
它**不 import 任何 generated 模块**（grep 确认），与生成面 171 个互不引用：

| 只在生成面 | `fillet` `shell` `offset` `sweep` `section` `split` `mirror` `scale` `translate` `twistExtrude` `complexExtrude` `convexHull` `roof` `drill` `pocket` `boss` `linearPattern` `circularPattern` `gridPattern` … |
|---|---|
| 只在 compat 手写面 | `loft` `polygon` `wire` `face` `outerWire` `sharedEdges` `getFaces` `getEdges` `getVertices` `getWires` `getShells` `getSolids` `getCompSolids` `normalAt` `pointOnSurface` `faceCenter` `vertexPosition` `isSolid` `Sketcher` `FaceSketcher` `draw*` `makeExternalGear` … |

**这张表本身就是关键证据**：`loft` / `normalAt` / `getShells` / `faceCenter`
在 arg-spec 里全部是 `skip`（理由："形状数组入参，模板单柄借入不适用" /
"入参 Face 子形状句柄"），**但手写 compat 面把它们导出去了**。

⇒ `skip` 的真实语义是「**自动生成模板不适用**」，**不是「技术上不可导出」**。
手写包装可以覆盖其中相当一部分。

#### 1.6.4 `skip` 395 个的重新分类

按理由聚合（实测），并按"对**库作者 TS 面**是否成立"重新判定：

| 理由（实测条数） | 举例 | 脚本面 | **库作者 TS 面** |
|---|---|---|---|
| IO / 字节（16） | `exportSTEP` `importSTL` `exportDXF` `importURDF` | ✗ | ✗ **架构决定，正确**（走 host ports） |
| 与 faijs sdf 冲突（在 `upstream-exclusions.json`：voxel / implicit / lattice / csg） | `sdfBox` `latticeInfill` `csg` | ✗ | ✗ **架构决定，正确** |
| 子形状句柄入参 / 产物（21） | `thicken` `draft` `normalAt` `uvBounds` `projectPointOnFace` `curveTangentAt` `addHoles` `solidFromShell` `sewShells` `sectionToFace` | ✗ | ✅ **应导**（库是 TS，可直接持有句柄） |
| 数组入参 / 多产物（~10） | `loft` `loftAll` `guidedSweep` `multiSectionSweep` `materialize` | ✗ | ✅ **应导**（`loft` 已被手写面反证） |
| 装配（13） | `createAssemblyNode` `addMate` `solveAssembly` `addJoint` `walkAssembly` `createAssembly` `jointTrajectory` | ✗ | ✅ **应导**（本方案 §4.4 正需要） |
| 演化遥测布尔 / 修饰（~12） | `fuseWithEvolution` `filletWithEvolution` `chamferWithEvolution` `shellWithEvolution` `variableFillet` | ✗ | ✅ **应导**（复合产物，库侧可解包） |
| 2D / 绘图 DSL（Blueprint / Drawing 句柄，~40） | `mirror2D` `intersect2D` `curve2d*` `drawProjection` `drawingFillet` `sketchLoft` `sketchSweep` | ✗ | △ 部分（compat 已有 `draw*` / `Sketcher` / `polygon` / `outerWire`） |
| 拓扑谓词 / 子形状导航 / 迭代器（37） | `isShell` `isManifoldShell` `iterShells` `createShell` | ✗ | △ 低价值 |
| 状态化 / 历史 / 内核作用域（~15） | `addStep` `findStep` `modifyStep` `supportsProjection` | ✗ | △ 低价值 |
| **命名冲突** | `chamfer`（faijs 同名）、`intersect`（§4.8 守卫） | ✗ | ✅ 改名后可导 |

#### 1.6.5 结论

**用户判断成立**：`fillet` / `sweep` 这类常见 CAD 操作没有出现在库作者可见的面上，
不是 brepjs 不支持、也不是技术不可行，而是两个独立的工程遗漏：

1. 生成面已产出 171 个投影，但只有 27 个接到公开入口——**其余 144 个是死代码**；
2. 手写 compat 面是另一套独立清单，覆盖面由人工挑选决定，且大量 `skip` 理由
   （子形状句柄 / 数组入参 / 装配）**只对脚本面成立，对库作者的 TS 面不成立**。

修正后的改动见 §4.5。

---

## 2. mini_lathe 分析

### 2.1 文件依赖（实测 grep）

```
config.py          ← 常量 + def pin_holes(wp)
  ↑
  ├── bottom_plate.py   (bp)
  ├── middle_bottom.py  (mb)
  ├── middle_top.py     (mt)
  ├── top_plate.py      (tp)
  ├── axk.py            (axk)
  ├── slide_top.py      (slide_top)
  ├── slide_mid.py / handle.py / misc.py
  ↓
assemb.py / assemb2.py  ← 8 条 constrain + solve()
```

引用形态全部是 `import config` + `config.OUTX` —— 与 §1.2 的 namespace import **天然对应**。

### 2.2 API 使用频次（实测 `grep -ohE '\.[a-zA-Z_]+\(' *.py | sort | uniq -c`）

```
faces 53 | workplane 45 | rect 37 | extrude 25 | Workplane 24 | hole 20
edges 12 | cutBlind 12 | val 10 | constrain 8 | center 8 | add 8
pushPoints 7 | polygon 7 | fillet 7 | translate 6 | vertices 5 | cut 5
transformed 4 | union 3 | threadedHole 3 | circle 3 | cboreHole 3
wires 2 | shell 2 | rotate 2 | cskHole 2
toCompound / text / outerWire / mirror / makeSphere / fuse / Assembly / solve …  各 1
```

---

## 3. 差距清单（CadQuery → faijs 现状）

| CadQuery | 频次 | faijs 现状 | 缺口等级 |
|---|---|---|---|
| `Workplane(plane)` / `.workplane()` 载体 | 69 | 无 | **高**——需兼容层 |
| 链式 `a.b().c()` | 全局风格 | §1.3 两通道均限 | **高** |
| `.faces('>Z')` / `.edges()` / `.vertices()` 选择器串 | 70 | 无 | **高** |
| `.hole/.cboreHole/.cskHole/.threadedHole` | 28 | `cad.drill`/`pocket`/`boss`（brep-only） | 中（库层组合） |
| `.fillet` / `.shell` | 9 | **完全缺失** | **高**（需补投影） |
| `.rect` / `.circle` / `.polygon` 草图 | 47 | 部分（`polygon` 在 compat 面） | 中 |
| `.extrude` / `.cutBlind` | 37 | `fai_extrude` / `cut`+`split` | 中 |
| `.pushPoints` 阵列 | 7 | `rectangularPattern`/`circularPattern`（brep-only） | 中 |
| `.val()` | 10 | 无（兼容层自造终端方法） | 低 |
| Python `for` 循环 | 多处 | `for(;;)` ✅ / `for-of` ❌ / 函数体内需 `async function`+`await`（§1.4） | 中 |
| `Assembly.constrain(…).solve()` | 8 | `cad.assembly` 仅 `face_mate` | 中（v1 够用） |
| 多文件 `import config` | 11 | **已支持**（namespace 形态） | ✅ |

---

## 4. 设计方案

### 4.1 总体原则：把复杂度放进库，最小限度触碰正在重构的通道

parser / 元数据层**正在被另一个 agent 改造**。本方案因此遵循：

> **P-a**：CadQuery 语义（链式、选择器、Workplane 载体、阵列、孔型）全部实现在
> **TS 库 `@faicad/cq-compat`** 里——库是 TS，不受 `.fai.js` 语法限制，可自由使用
> `class` / `for-of` / `async-await` / 链式。
>
> **P-b**：`.fai.js` 只保留**声明式组装**（每个 CadQuery 链拆成"每步一变量"），
> 由**转译器**自动生成——移植工作量趋近于零，且**零通道改动**。
>
> **P-c**：core 改动压到最小、且与另一个 agent 的改动面**不重叠**
> （只碰 `api/compat/index.ts` 的投影清单，不碰 `metadata-extractor.ts`
> 与 `direct-executor.ts`）。

收益：本方案**不依赖** no-IR 重构的完成度，也不与其产生文件冲突。

### 4.2 CQ 兼容层：Workplane 载体 + 转译器拆链

#### 4.2.1 载体设计（已实测验证可行）

CadQuery 的 `Workplane` 在 faijs 里实现为 **plain object**，几何藏在 `.shape` 字段：

```ts
// packages/cq-compat/src/workplane.ts（示意，非完整实现）
export interface Workplane {
  __cq: true
  plane: string
  shape: Shape | null      // 几何藏这里，不暴露在顶层
  sel?: string             // 当前选择器
  box(w: number, d: number, h: number): Promise<Workplane>
  faces(sel: string): Promise<Workplane>
  hole(d: number, depth?: number): Promise<Workplane>
  fillet(r: number): Promise<Workplane>
  val(): Shape             // 终端方法：取出几何
}
```

**为什么必须是 plain object 且几何藏在 `.shape`** —— 两条实测依据：

1. **终端污染**：`computeLiveShapes` 的候选集来自 `isShapeLike(v)` =
   `'positions' in v && 'indices' in v`（`runtime.ts:234`）与 `isCompoundLike`。
   载体顶层若无 `positions`/`indices`/`children`，就**不会成为终端候选**。
   实测已验证：三个中间态 `v0/v1/v2` **一个都不出现在 `terminals`**。
   若几何直接摊在载体顶层，每一级中间态都会变成终端，UI 会堆满半成品。

2. **分派门**：`compat-op.ts:52-77` 的 `collectShapes`/`borrowDeep` 遇到
   `Object.getPrototypeOf(v) !== Object.prototype` 直接 return —— **class 实例不被遍历**，
   分派门找不到内嵌 Shape ⇒ `dispatchPath([])` 恒判 `'brep'`，mesh 模式下不报错直接放行，
   违反静态分派红线。**载体必须是 plain object，不能用 class。**

补充：`live-shapes.ts:96` 明确 **receiver 不消费**（`w2 = w1.box(…)` 中 `w1` 不算被消费）。
载体若被判为 shape，`w1` 会永久留在终端列表——这也是必须把几何藏进 `.shape` 的原因。

#### 4.2.2 链式：用转译器拆成"每步一变量"，而不是改两通道

实测已验证"每步一变量"形态**现在就能跑**（原型用例，语法与 ctx 提升全程通过，
仅因原型误用 brep-only 的 `cad.drill` 在末行失败）。

转译器把 CadQuery 源码（Python AST）转成 `.fai.js`：

```python
# CadQuery 原码
bp = cq.Workplane("XY").box(OUTX, OUTY, T).faces(">Z").hole(5)
```
```js
// 转译输出（每步一变量，零通道改动即可执行）
let bp_0 = cq.Workplane('XY')
let bp_1 = bp_0.box(config.OUTX, config.OUTY, config.T)
let bp_2 = bp_1.faces('>Z')
let bp_3 = bp_2.hole(5)
let bp = bp_3.val()
```

命名规则：`${lhs}_${n}` 递增；末行 `.val()` 落回原变量名（保持下游引用不变）。

**转译器同时处理**：
- `import config` → `import * as config from './config.fai.js'`（§1.2 的 namespace 约束）；
- `from x import y` → **仅当 `y` 是 shape / 函数**才转 named import，普通常量强制转 namespace；
- Python `for pt in pts:` → `.fai.js` 顶层 `for (let i=0;i<pts.length;i++)` 块（§1.3：`for-of` 不可用）；
- `def pin_holes(wp)` → 见 §4.2.3。

**为什么不做"真链式"**：需要同时改 `direct-executor.emitCall` 与
`metadata-extractor.isOpCall`——正是另一个 agent 正在重写的两个文件，必然冲突。
转译器把这个问题**从运行时挪到移植时一次性解决**，且可逆。
若通道重构完成且接受集扩展，转译器可退化为可选的"美化输出"。

#### 4.2.3 函数内循环（`pin_holes`）：直接写 `async function`

§1.4 已实测：只要写成 `async function` 并在每个 cad 调用前写 `await`，
函数体内的循环加工**在 `.fai.js` 里直接可用**，且可跨文件导出。

```js
// config.fai.js —— 常量 + 异步加工函数，原样对应 CadQuery 的 config.py
const OUTX = 100
const INX = OUTX - 24
const PIN_PTS = [[0, 0], [12, 8], [-12, 8]]

async function pin_holes(wp, pts) {
  let r = wp
  for (let i = 0; i < pts.length; i++) {
    r = await cq.holeAt(r, pts[i])      // 每个 cad/cq 调用都要 await
  }
  return r
}
```

```js
// 使用方（实测 V1/V2 两种导入形态均通过）
import * as config from './config.fai.js'          // 常量走 namespace
import { pin_holes } from './config.fai.js'        // 函数可 named import
let base_0 = cq.Workplane('XY')
let base_1 = base_0.box(config.OUTX, config.OUTY, config.T)
let base = pin_holes(base_1, config.PIN_PTS)
```

**移植规约**：CadQuery 的 `def f(...)` 若函数体涉及建模 op → 转译为 `async function`
且体内每个 `cad.*` / `cq.*` 调用加 `await`；若只做纯数据计算 → 普通 `function` 即可。

> 备选（仅在需要复用跨模型时）：把此类函数实现为兼容层库导出的函数（库是 TS，
> 内部可自由写）。本方案不强制——§1.4 实测已证明 `.fai.js` 内直写可行。

#### 4.2.4 选择器字符串

CadQuery 选择器（`>Z` / `|Z` / `>Z[-2]` / `#Z`）在库内解析为 faijs 的拓扑查询。
faijs 侧可用原语：`api/compat` 的 `getFaces`/`getEdges`/`getVertices`/`faceCenter`/
`faceNormal`/`getSurfaceType`，以及 `api/topo-resolve.ts`。
选择器解析是纯字符串逻辑，放在库里。

### 4.3 多文件映射

| CadQuery | `.fai.js`（转译目标） | 依据 |
|---|---|---|
| `import config` | `import * as config from './config.fai.js'` | §1.2 namespace 必需 |
| `from bottom_plate import bp` | `import { bp } from './bottom_plate.fai.js'` | named 可用（bp 是存活 shape） |
| 模块出口 | **无**：隐式导出存活 shape ∪ 常量 ∪ 函数 | `ModuleRegistry` 已实现 |
| `config.OUTX` | `config.OUTX` | 逐字对应 |

宿主需注入 `HostPorts.projectLoader`（`ports.ts:208`）。mini_lathe 的各 `.fai.js`
由宿主按项目根相对路径提供 `listModules()`。

**⚠️ A-9 约束的移植影响**：零件文件内被后续 op 消费的中间 shape **不能**被别的文件引用。
转译器需保证被跨文件引用的名字是该文件**末态存活**的 shape（通常就是末行 `.val()` 产物）。

### 4.4 装配

现状：`cad.assembly({ name, members, constraints })`，约束类型**当前只有 `face_mate`**
（`api/compound.ts:59`）；`cad` 脚本面含 `assembly`，即 `.fai.js` 里可写装配代码。

CadQuery `constrain` 的 8 条分两类（实测读 `assemb.py`）：`Plane` 与 `Axis`。

**v1（本方案）**：在兼容层里把 `constrain` 编译为**纯数据构造函数**，落到 `face_mate` 语义：

```js
// CadQuery: constrain("bp@faces@>Z[-2]", "mb@faces@<Z", "Plane")
let c0 = cq.planeMate('bp', '>Z[-2]', 'mb', '<Z')
// CadQuery: Axis 约束
let c1 = cq.axisMate('axk', '>Z', 'tp', '<Z')   // v1 降级为变换序列求解
let asm = cad.assembly({
  name: 'mini_lathe',
  members: [bp, mb, mt, tp, axk, slide_top],
  constraints: [c0, c1],
})
```

`axisMate` 在 v1 由兼容层用**变换序列**（对齐后再平移/旋转）实现，不要求 core 新增约束类型。

**⚠️ 如实标注的能力差异**：CadQuery `solve()` 是**全局联立求解**，
faijs `do_assemble()` 是**顺序求解**。mini_lathe 的 8 条约束是链式的，
两者结果一致 ⇒ v1 够用。但这是能力差异、不是等价；若后续出现过约束 / 闭环装配，
需 core 新增 `axis_mate` 约束类型 + 联立求解器（v2）。

### 4.5 需要的 core 改动（最小集）

> **用户裁决（2026-09-07，方向级）**：「brepjs 支持的 api，应该都导出啊。而且我未来要移植更多的
> cadquery 库，所以不能只看 mini_lathe 用到了哪些。如果不显著增加移植难度，能导出的 api 都应该导出。」
>
> ⇒ C1 的目标从「补 mini_lathe 用到的 2 个符号」升级为「**按面分层，最大化兼容面覆盖**」。

#### C1-a：接通生成面（零风险，优先）

把 `api/generated/*.ts` 的 171 个运行时符号接到公开入口。

| 改动 | 位置 | 说明 |
|---|---|---|
| 新增 `export * from './generated/topology'` 等 | `api/index.ts` | 或与根门面 `src/compat.ts` 并列新增子路径 |

**风险点（必须先解决）**：生成面与手写 compat 面**存在同名冲突**——
`box` / `cylinder` / `cone` / `ellipsoid` / `rotate` / `translate` / `cut` / `fuse` /
`extrude` / `revolve` / `sweep` / `getBounds` / `measureArea` / `measureLength` /
`measureVolume` / `isValid` / `ok` / `err` / `map` / `andThen` … 两边都有。

按 `api/index.ts:41-48` 已确立的红线 **「一个名字一份实现」**：
生成面是 `compatOp` 包装的 **faijs 形态**（Shape 进 / Shape 出、Result→throw），
手写面是 **brepjs 句柄形态**。二者**语义不同，不能随便二选一**。

⇒ 处理原则：
- **不合并进同一个扁平命名空间**。生成面整包以 `compat` 之外的**独立命名空间**暴露
  （建议 `brep`，即 `import { brep } from '@faicad/faijs'`），与 `compat` 并列。
- 库作者按需二选一：写 brepjs 形态用 `compat.*`，写 faijs 形态用 `brep.*`。
- 冲突名**不做别名改写**（改名会破坏上游 1:1 对应关系，违背 G2）。

#### C1-b：把 `skip` 中对 TS 面成立的部分补进兼容面

按 §1.6.4 判定为 ✅ 的三组，逐组补手写包装（手写可绕过"生成模板不适用"）：

| 组 | 数量级 | 代表符号 | 备注 |
|---|---|---|---|
| 子形状句柄 | ~21 | `thicken` `draft` `normalAt` `uvBounds` `projectPointOnFace` `curveTangentAt` `addHoles` `solidFromShell` `sewShells` | 手写面已有 `normalAt` / `getShells` 先例 |
| 数组入参 / 多产物 | ~10 | `loft` `loftAll` `guidedSweep` `multiSectionSweep` `materialize` | 手写面已有 `loft` 先例 |
| 装配 | ~13 | `createAssemblyNode` `addMate` `solveAssembly` `addJoint` `walkAssembly` | 本方案 §4.4 直接依赖 |
| 演化遥测 | ~12 | `fuseWithEvolution` `filletWithEvolution` `chamferWithEvolution` `shellWithEvolution` `variableFillet` | 复合产物需库侧解包 |
| 命名冲突改名 | 2 | `chamfer` `intersect` | 上游名加前缀，如 `brepChamfer` / `brepIntersect` |

> `variableFillet`（变半径圆角）对 CadQuery 移植价值高——CadQuery 的 `.fillet()` 支持
> per-edge 半径，是常见形态。

**不导**（架构决定，维持现状）：IO / 字节类（走 host ports）、voxel / implicit /
lattice / csg（与 faijs sdf 冲突，见 `upstream-exclusions.json`）。

#### C1-c：cad 脚本面保持保守

`cad` 脚本面（`symbol-table.generated.ts`，58 个）**不在本次扩大范围**。
理由：脚本面 v1 不投子形状（既有的方向裁决），且新增脚本面 op 会牵动
UI ops / 符号表 / 文档三处一致性门禁（另一个 agent 的重构范围）。

⇒ 兼容层库走 **TS 面**（`compat` / `brep`），不要求 `cad.*` 新增符号。

---

**不做**（避免与另一个 agent 冲突）：
- ❌ 不改 `direct-executor.ts`（链式、函数体 await）——由转译器与库绕开（§4.2.2 / §4.2.3）
- ❌ 不改 `metadata-extractor.ts`（UI 接受集）——同上
- ❌ 不删旧 IR 通道——那是另一个 agent 的 P6 门禁事项
- ❌ 不重排 `arg-spec.ts` 的 `kind` 分类（那是生成面唯一来源，改动牵动三个生成脚本）

C1-a/C1-b 均为**追加导出 / 追加入口**，不触碰现有 80 个 compat 符号 ⇒ **G2（brepjs 兼容必须保留）成立**。

**⚠️ 新增验收项**：C1-a 接通后，生成面 171 个符号**必须全部通过一次冒烟调用**
（`compatOp` 包装本身可能隐藏签名错配）。这批代码此前无任何生产引用，
等于**从未被执行验证过**。建议在 `api/generated/` 下新增一组
generated-surface smoke 测试，逐个调用并断言返回 Shape / 明确报错。

---

## 5. 移植工作量估算

| 阶段 | 内容 | 人工量 |
|---|---|---|
| 一次性 | 兼容层库 `@faicad/cq-compat`（Workplane + 选择器 + 孔型 + 阵列 + 装配构造） | 主要成本 |
| 一次性 | 转译器（Python AST → `.fai.js`） | 主要成本 |
| 一次性 | C1-a 接通生成面（含 smoke 测试） | 小（代码已生成，主成本在冒烟验证） |
| 一次性 | C1-b 补 `skip` 中 TS 面可行的部分（~58 个） | 中（逐个手写包装 + 冒烟） |
| **每个模型** | 跑转译器 + 手工收尾（命名、选择器索引、装配） | **趋近于零** |

mini_lathe 预期产物：`config.fai.js` + 6~9 个零件 `.fai.js` + `assemb.fai.js`。

---

## 6. 分期

- **P0（前置）**：**C1-a** 接通生成面到公开入口（优先，零风险，代码已存在）；
  **C1-b** 补 `skip` 中 TS 面可行的部分（子形状 / 数组 / 装配 / 演化 / 改名五组）；
  确认运行模式为 **brep**（§1.5）。
- **P1**：兼容层库 Workplane 载体 + 选择器 + 基础 op 映射；单文件冒烟（一个零件跑通）。
- **P2**：转译器；`config.fai.js` 多文件冒烟（namespace import + 常量 / 函数）。
- **P3**：全量文件移植 + 装配（`planeMate` / `axisMate`）跑通。
- **P4**：回归——brepjs 兼容面 80 个符号零回归、既有 `.fai.js` fixture 全绿、stderr 零输出。
- **v2（不占本次）**：真链式（待通道重构稳定后评估）、函数体 await、装配联立求解。

---

## 7. 验收

1. mini_lathe 各零件在 **brep 模式 + direct 通道**下全部产出，与 CadQuery 输出的
   体积 / 包围盒在容差内一致。
2. 跨文件引用零 `BINDING_NOT_EXPORTED`；普通常量全部走 namespace import。
3. 终端列表**只含每个零件的末态**（中间态 `*_0/_1/_2` 不出现）—— §4.2.1 实测验证项。
4. 装配各零件位置与 CadQuery `solve()` 结果一致（链式约束，顺序求解等价）。
5. `api/compat/index.ts` 现有 80 个导出**逐个不变**（G2）。
6. 未修改 `direct-executor.ts` / `metadata-extractor.ts`（可用 `git diff` 核验）。
7. 全流程 stderr 零输出。
8. 生成面 171 个符号**逐个通过冒烟调用**（此前无生产引用，等于零验证，§4.5 C1-a）。
9. 兼容面覆盖度可量化：新增一份清单，记录 852 个上游符号的
   「已导 / skip / skip 理由」三态，作为后续移植新 CadQuery 库时的**缺口自检表**。

---

## 8. 待拍板

1. **运行模式**：确认移植后只跑 **brep**（mesh 下 cut / hole / fillet / shell 全不可用，§1.5）。
   若要求 mesh 可用，需先补这些 op 的 mesh 实现，量级完全不同。
2. **转译器 vs 真链式**：本方案选转译器（零通道改动、不冲突，§4.2.2）。
   若更希望 `.fai.js` 里保留真链式观感，则需与另一个 agent 协调通道改动排期。
3. ~~`pin_holes` 等参数化函数沉到库还是 `.fai.js` 内可写~~ —— **已由实测定案**：
   `.fai.js` 内写 `async function` + `await` 即可（§1.4 / §4.2.3），无需 core 改动、无需沉库。
   仅当希望**跨模型复用**这些加工函数时，才额外把它们抽进兼容层库。
4. ~~**C1 投影范围**：只补 `fillet`/`shell`，还是连带 `sweep`、`hole` 系列一并投影~~
   —— **已由用户裁决（2026-09-07）**：「能导出的 api 都应该导出」，不按 mini_lathe
   用量裁剪。据此 §4.5 重写为 C1-a / C1-b / C1-c 三层。
   仍需确认一项：**生成面与手写面同名冲突**（约 20 个，`box`/`cut`/`fuse`/`rotate` 等）
   的暴露方式——本方案建议并列独立命名空间 `brep`（不合并、不改名），
   另一选项是只导出生成面的**差集**（即手写面没有的那部分），代价是语义来源分裂。
