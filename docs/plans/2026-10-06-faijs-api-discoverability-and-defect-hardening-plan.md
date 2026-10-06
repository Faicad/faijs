# faijs API 可发现性与缺陷加固开发计划

日期：2026-10-06
状态：方案（未实施）
基准：`packages/core@0.29.6`，本 clone HEAD `43e0e0f2`（工作区含 `5e556070`）
来源：faijs-openscad 转换器（OpenSCAD CSG → faijs 代码）的下游集成实测

## 1. 需求（用户原话）

> faijs的bug或者缺陷要优先修复。请修复你上面发现的Math的缺陷。

> 然后总结之前碰到的faijs项目本身的bug或者功能缺陷，或者对faijs的特性和api使用产生误解的地方，写一份开发计划，要改进faijs项目。计划写到faijs2目录，目前你要在这个目录工作。

## 2. 证据口径

本计划不采信文档自述，每条结论都来自可复现的下游实测，并标注判据来源（文件:行号、键数、命令）。行号与键数按上表基准记录；faijs 处于高频重构期，实施时须以当时源码复核，不得直接引用本文数字。

三条独立取证路径必须互相印证，任何一条单独给出的结论都不足采信：读源码（`src`）、读生成物（`dist` / `generated`）、跑运行时探针。本项目已实证前两条都可能给出错误答案——手册逐 op 章节只覆盖 57/95（见 B1），本地 `dist` 符号表停在一个月前的构建（见 A5）。

原始记录保留在 `faijs-openscad` 仓库，可作为交叉验证：`docs/plans/2026-10-06-faijs-api-assumption-errors.md`（12 条理解勘误 + 5 条撤回）、`src/emit/*.probe.test.ts`（Host 装配 / applyMatrix / 2D profile / 脚本全局的固化探针）、`src/__probe__/script-globals-scan.ts`（`Math` 拦截的分层取证）。

## 3. A 类缺陷：语言、运行时与工具链

### A1 唯一判定入口已建立，但缺少不变量守门（P0，已完成一半）

已完成（`5e556070`）：把「裸标识符是否免 import」收口到 `lang/security-scanner.ts` 的 `isSafeGlobalIdent()`，六处判定点（`metadata-extractor` 三处、`direct-executor` 两处、`code-to-args` 一处）改为调用它，不再各自复制名单。

待办：现有契约测试 `packages/core/src/lang/script-globals.test.ts` 只硬编码了几个名字（`Math` / `Number` / `MM`）。应改为**遍历 `S4_SAFE_GLOBALS` 全集**驱动断言，使名单新增一项时所有判定点自动被纳入覆盖；并保留反向断言：名单外的标识符（如 `zzz`）仍被拒。这样才能把「六处判定与白名单一致」从一次性修复变成持续不变量。

### A2 「脚本可用哪些内置全局」不可发现（P0）

判据：`docs/language-design.md`、`docs/language-design.zh.md`、`docs/api-contract.md` 三份标准文档对 `Math` / `parseInt` / `console` 的提及次数均为 **0**（`grep -c` 实测）。`S4_SAFE_GLOBALS` 未从主导出或 `./node` 导出；`packages/core/package.json` 的 `exports` 无 `./lang/*` 子路径。

结论：脚本作者判断「`Math` 能不能用」的唯一途径是读 `packages/core/src/lang/security-scanner.ts` 源码。这正是「`Math` 需要 import 吗」这类问题在项目里没有正确答案的根因——清单本身没有对外出口。

动作：在 `docs/language-design.md` 增「内置全局」一节，列出名单与语义（单位常量走静态折叠，其余走运行时 `globalThis` 求值），并说明它们**免 import**；同时把 `S4_SAFE_GLOBALS` 通过 `./runtime-state` 或新子路径对外导出，供编辑器做补全与实时校验。文档为中英双语对，改动须同步两份并跑 `scripts/verify-translation-pairing.ts`。

### A3 `E_REFERENCE` 的报错文案与真实原因相反（P1）

判据：`extractMetadata('let p = cad.box(Math.PI, 1, 1)')` 抛 `[parser] unknown identifier "Math" in expression`，而 `Math` 是设计上合法的免 import 全局——同一份代码在 `security-scanner.test.ts` 的 S-21/S-22 是被断言放行的。两条测试同时通过，说明文案描述的现象与设计意图相反。

后果：报错说「未知标识符」，读者会合理地推断「这个语言没有 Math」，而不是「某个校验点的白名单漏了」。错误信息把调用方引向与真相相反的修复方向（去 import、去自建常量），这是 A1 缺陷能潜伏至今的直接原因。

动作：`metadata-extractor` 在抛 `E_REFERENCE` 前判定该标识符是否属于 `S4_SAFE_GLOBALS`；若属于，改用独立错误码（如 `E_GLOBAL_NOT_ADMITTED`）与文案，指明「该名字是免 import 安全全局，但当前判定点未放行」，并在文案里指向 A1 的统一入口。

### A4 两份「SAFE」清单语义不同但命名撞车（P2，需拍板）

判据：`S4_SAFE_GLOBALS` 34 项，回答「这个裸标识符是否被安全门禁允许」；`lang/determinism-scanner.ts` 的 `SAFE_CONTAINERS` 16 项 + `SAFE_FUNCTIONS` 11 项，回答「这个全局的成员调用是否传播污点」。两者互不为超集——前者有 `Date` / `Infinity` / `NaN` / `undefined`，后者无；后者有 `Intl` / `Reflect` / `encodeURI` / `encodeURIComponent` / `decodeURI` / `decodeURIComponent`，前者无。

后果：`Intl.NumberFormat('zh-CN').format(1.5)` 与 `encodeURIComponent('x')` 在确定性分析里被认定为纯净（安全），但脚本里写会被 `SEC_FREE_IDENT` 拒。名字里都带 `SAFE`，却回答不同问题，很容易被读成「前者是后者的子集」。

动作：这是策略决定，需先拍板再动手——扩 `S4_SAFE_GLOBALS` 的边界如何定（是否放行 `Intl` / `Reflect` / URI 编解码），或反之明确「脚本可用全局 = S4 名单」并把完整清单落进 A2 的文档章节。无论选哪个，两处名单都应加注释互相指认，禁止用对方的名字反推自己的语义。

## 4. B 类缺陷：文档与 API 面的可发现性

### B1 手册逐 op 章节覆盖 57/95（P0）

判据：`docs/ops-api-inventory.md` §3–§7（行 68–1117）共 **57** 个逐 op 条目，而 `packages/core/src/lang/symbol-table.generated.ts` 有 **95** 键，**38 个符号没有逐 op 章节**：`defeature` `reverseShape` `unifySameDomain` `sew` `sewAndSolidify` `removeHolesFromFace` `jointTrajectory` `inverseKinematics` `mechanismDOF` `torus` `fuse` `inspectMassProps` `area` `length` `volume` `centerOfMass` `complexExtrude` `twistExtrude` `roof` `drill` `pocket` `boss` `thread` `convexHull` `makeBaseBox` `ellipsoid` `rotate` `applyMatrix` `locate` `offset` `heal` `simplify` `isValid` `isSameShape` `autoHeal` `fixShape` `healSolid` `fixSelfIntersection`。（手册有而符号表无的：0 个。）

其中 `applyMatrix` 后果最重：它是变换类（inputs ≥ 1），语义与 OpenSCAD 的 `multmatrix` 逐字对应——行主序 4×4、底行 `[0,0,0,1]`，源码注释直接写着 `OpenSCAD multmatrix equivalent`——却只在 §8「BREP 能力声明」表里出现过一次。下游做选型时会据此误判「faijs 不具备任意仿射变换能力」，进而去设计本不需要的矩阵分解方案。本项目的转换器就为此白写了一套分解器设计。

动作：给 38 个符号补逐 op 章节；更彻底的做法是把手册逐 op 部分改为从 `api/surface/arg-spec.ts` 生成，与已有的 `script-face-manifest` 同源，从根上消除手工维护的滞后。

### B2 手册示例已失效（P0）

判据：`docs/library-dev-guide.md:233` 与 `docs/library-dev-guide.zh.md:233` 都写着 `let b0 = cad.box({ size: [30, 30, 5] })`，而 `packages/core/src/api/primitives.ts:37` 已明确抛 `E_ARGS_FORM: the box({ size }) object form is removed`，正确形态是位置参数 `cad.box(30, 30, 5)`（由 `slotMap` 装箱为 `{width,depth,height}`）。同文件 `cylinder` 的旧对象形态也已同样去除（`primitives.ts:64`）。

后果：这是手册里最容易被照抄的示例之一，读者照抄即报错，且报错指向的是「参数形态已移除」而非文档过期，容易被误判成自己对 API 理解有误。

动作：修正这两处示例，并系统性复查该手册是否还有其他按旧形态书写的例子。`.md` 与 `.zh.md` 成对，须同步修改并跑 `scripts/verify-translation-pairing.ts`。

### B3 三个 cad-like 面 + 一个同名内部命名空间（P0）

判据：`packages/core/src/index.ts:43` 有 `export { cad } from './mesh'`，它是一个 BREP-only 内部命名空间（38 键，`boxBrep` / `fuseBrep` / `*Brep` 一族），**既不是** ② 脚本面的 `cad.*`（95 op），**也不是** ① TS 兼容面的扁平函数。主导出文件中 `export {...}` 块共 **281** 个符号名，另有 3 处 `export *` 未展开。三者的区别从包名与导出名上完全无法分辨。

后果：下游按「TS 库层」自居去做能力探测时，若拿到的是 `import { cad }`，会得出「faijs 没有 `mirror` / `profile` / `extrude` / `revolve` / `applyMatrix` / `offset`」的结论。本项目 v1 勘误的 12 条里有 5 条源于此，全部已撤回。

动作：把 `./mesh` 的内部命名空间改名（如 `meshOps` / `brepOps`），或改为仅在 `@faicad/faijs/mesh` 子路径导出、不再占用 `cad` 这个名字；README 顶部放三面对照表，写明每一面的消费者、形态与入口。

> **状态：已搁置（2026-10-06，用户决定「mesh 的问题先放下，先解决其它问题」）。**
> 本节保留 B3 的完整判据与验收，但具体实施路线（见下方 A/B/C 取舍）待用户拍板后再动 `index.ts` / `mesh`。实施顺序表 §6 第 5 行已同步标注为「已搁置」。

#### B3 路线取舍（A/B/C，待拍板）

计划 §6 第 5 行的验收是「主导出不再有名为 `cad` 的 BREP 命名空间；README 有三面对照表」。改名与移出两种处置都能达成该验收，因此取舍权在用户：

- **A. 改名 `meshOps`，仍在主导出**：改 `mesh/index.ts` 里的那个 `const` + `index.ts` / `browser.ts` 两行 re-export + 内部 8 处 `import`（约 11 行）。
  代价：下游 `import { cad }` 编译失败、需改名；`./mesh` 子路径下仍叫 `meshOps`。
- **B. 从主导出移除，只留 `@faicad/faijs/mesh`**：删两行 re-export 即可（子路径已存在，无需新增配置）。
  代价：主导出少一个符号——而「写 `import { cad }` 直接编译报错」正是想堵住的那个坑。注意子路径 `@faicad/faijs/mesh` 下它仍叫 `cad`，计划只要求主导出干净。
- **C. A+B**：最彻底，破坏面最大。

当前（2026-10-06）B3 处于搁置态，尚未选定 A/B/C 任一；解除搁置后按所选路线实施，并补 README 三面对照表。

### B4 Host 装配无完整可复制示例（P1）

判据（三个必踩的坑，下游实测）：只 `createRuntime` 不 `registerOcctBrepEngine` → `[faijs/bridge] BREP engine API not available`；`configureBackends` 漏 `config.brepCapabilities` → `E_BREP_UNSUPPORTED: current engine lacks capability 'fuseWithHistory' (brepEngineId=<none>)`；`defineOp` 包装的函数直接返回 `Promise<Shape>` 而非 `Result`，用 `isErr()` 判定会得到假阳性（`isErr` 的判据是 `ok === false`，而 `Shape` 上没有 `ok` 字段）。

后果：装配缺失会被下游误读成「faijs 的能力缺口」。本项目 v1 的「布尔默认不可用」「`volume` 静默 NaN」「球差 0.22%」三条已因此全部撤回——装配后布尔全通、体积误差 0.0000%、球是解析精确球。

动作：`library-dev-guide` §3.1 给出一个完整可复制的装配函数，串起 `initOcctWasm` → `registerOcctBrepEngine` → `configureBackends({ config: { mode, brepEngineId, brepCapabilities } })`，并显式说明 capabilities 必须一并传入、以及 `defineOp` 的返回值不是 `Result`。

### B5 单位常量只在 `/units` 子路径（P2）

判据：主导出 281 个符号名里没有 `MM` / `INCH` / `DEGREE`；它们位于 `@faicad/faijs/units`（`exports` 中确有 `./units`）。而在脚本面，`MM` 等是**免 import** 全局（属 `S4_SAFE_GLOBALS` 子集）。

后果：同一个名字在两个面上有两种引入方式，下游容易写出「TS 层 import 了、脚本层又 import 一次」或反之的多余/缺失引入。

动作：在主导出 re-export 这几个常量；或在 A2 的文档章节明确「脚本面免 import、TS 面需从 `/units` 引入」的双重语义。

### B6 缺「代码字符串 → 产物」的一等执行 API（P1）

判据：`./node` 子路径映射到 `packages/core/src/node.ts`，导出 `cliCheck` / `cliRun` / `cliMain` / `parseArgs`；主导出有 `createRuntime` / `createApiNamespace`。但没有任何一个「给 `.fai.js` 源码字符串 → 直接拿到产物」的函数。发布 tarball 不含 `scripts/`，于是每个下游各自内联 CLI 包装器（`faijs-cadquery` 与 `faijs-openscad` 都是这么做的），并各自重复踩一遍 B4 的三个坑。

动作：提供 `executeScript(code, opts): Promise<{ outputs, failedAt, diagnostics }>`，内部完成 Host 装配与 `runtime.execute`，把 B4 的装配知识固化在一处而不是散在每个下游。

### B7 `convexHull` 与 OpenSCAD 的 `hull` 同名近义（P2）

判据：`convexHull` 收**点集**（喂 shape 报 `points.map is not a function`），底层是 occt 内核的 `hullFromPoints`；OpenSCAD 的 `hull()` 收**任意子节点**做凸包。两者不可互相替代。

动作：在手册与 FAQ 显式写「`convexHull` ≠ OpenSCAD `hull`」。若未来要支持 `hull` 语义，另起名（如 `hullOfShapes`），不要改变 `convexHull` 的既有语义。

## 5. 下游误解清单（用于改进文档，非缺陷）

这一节记录的是「文档本可以拦住、但没有拦住」的误解。按仓库 `AGENTS.md`「与预期不一致的 API 用法必须留档为测试」的纪律，每一条都应在对应文档落成说明，并保留为带 `GOTCHA:` 注释的防回归测试。

| # | 误解 | 真相 | 应落点 |
|---|---|---|---|
| M1 | `import { cad } from '@faicad/faijs'` 拿到的就是脚本面的 `cad` | 它是 BREP-only 内部命名空间（38 键），与脚本面 95 op 无关 | README 三面对照表（B3） |
| M2 | 库作者也用脚本面的 `cad.*` 写实现 | 库作者走 `defineOp`（`@faicad/faijs/sdk`），不碰脚本面 | library-dev-guide |
| M3 | 不装配 Host 就能探测能力：`cad.union` 不可用、体积 NaN、球不精确 | 装配后布尔全通、体积误差 0.0000%、球是解析精确球；未装配走的是 mesh 路径 | library-dev-guide §3.1（B4） |
| M4 | 读 `dist` 或手册 §3–§7 可以枚举出全部 op | 两者都可能不完整（A5 / B1），`src` 才是唯一真源 | AGENTS.md + README |
| M5 | 「静态元数据提取器」= 「表达式求值器」，所以脚本语言不支持 `Math` | 求值器（vm 与 interpreter 两个后端）完全支持；拦人的是前置静态校验的白名单 | language-design（A2 / A3） |
| M6 | 脚本语句是「换行分隔」，写在一行用 `;` 会静默截断 | **本轮实测推翻**：`DirectExecutor.unitRanges` 对单行分号返回 3 个 unit（0.29.5 与 0.29.6 一致），`;` 与换行等价；单行无分号才抛 `SyntaxError`（正确 JS 行为）。原结论来自下游探针自身的写法问题，不是 faijs 缺陷 | 撤销 `faijs-openscad` 勘误 §3.3 第 2 条 |

M6 的实测方式：`new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() } }).unitRanges('let a = cad.box(1,1,1); let b = cad.box(2,2,2); let c = cad.box(3,3,3)')` → `ranges.length === 3`，三条 `lineNo` 均为 1；对照组「单行无分号」抛 `[parser] line 0: SyntaxError: Unexpected token`。同一脚本在 0.29.5 的安装产物上复跑，结果相同。语句切分由 `acorn` 完成（`metadata-extractor.ts` 顶部 `import { parse as acornParse } from 'acorn'`），因此 `;` 与换行在语法层本就等价。

## 6. 实施顺序

顺序按「下游被误导的概率 × 修复成本」排。P0 是每个新下游都会撞上的；P1 是撞上后需要读源码才能自救的；P2 是清理项。

| 顺序 | 项 | 优先级 | 落点 | 验收判据 |
|---|---|---|---|---|
| 1 | A1 不变量守门 | P0 | `packages/core/src/lang/script-globals.test.ts` | 遍历 `S4_SAFE_GLOBALS` 全集，六处判定点逐一断言放行；名单外标识符仍被拒 |
| 2 | B2 手册示例失效 | P0 | `docs/library-dev-guide.md` + `.zh.md` | 示例改为位置参数形态；`verify-translation-pairing` 通过；手工跑通示例脚本 |
| 3 | A2 内置全局清单文档化 + 导出 | P0 | `docs/language-design.md` + `.zh.md`、导出面 | 文档含完整名单与两类语义；清单可从运行时查询 |
| 4 | B1 手册补 38 个逐 op 章节 | P0 | `docs/ops-api-inventory.md` + `.zh.md` | 逐 op 章节符号集 == 符号表键集（加一条文档覆盖守卫） |
| 5 | B3 `cad` 内部命名空间改名 | P0（**已搁置**，待 A/B/C 拍板） | `packages/core/src/index.ts`、`browser.ts`、`mesh/index.ts`、README | 主导出不再有名为 `cad` 的 BREP 命名空间；README 有三面对照表（路线见 §4 B3 下方 A/B/C） |
| 6 | A5 `dist` 脱节告警 | P0 | `scripts/`、`docs/AGENTS.md` | 生成物与源码键集不一致时守卫失败 |
| 7 | A3 `E_REFERENCE` 文案区分 | P1 | `packages/core/src/lang/metadata-extractor.ts` | 安全全局被漏放行时给出独立错误码与文案；真未知标识符仍为 `E_REFERENCE` |
| 8 | B4 装配示例补全 | P1 | `docs/library-dev-guide.md` + `.zh.md` | 手册中的装配函数可原样复制运行 |
| 9 | B6 一等执行 API | P1 | `packages/core/src/node.ts` | `executeScript(code, opts)` 可返回产物，下游不再内联 CLI |
| 10 | A4 两份 SAFE 清单边界 | P2 | 先拍板，再动 `security-scanner.ts` / `determinism-scanner.ts` | 两处互相指认；是否扩白名单由用户决定 |
| 11 | A6 增量清单改名 | P2 | `packages/core/src/api/generated/` | 全集/增量关系在文件头注释里互相指认 |
| 12 | B5 单位常量 re-export | P2 | `packages/core/src/index.ts` | 主导出可拿到 `MM` / `INCH` / `DEGREE` |
| 13 | B7 `convexHull` ≠ `hull` 说明 | P2 | 手册 + FAQ | 两处均有显式警示 |
| 14 | M6 撤销下游勘误 | — | `faijs-openscad/docs/plans/2026-10-06-faijs-api-assumption-errors.md` | §3.3 第 2 条改为实测结论 |

## 7. 门禁与验收

每项改动按仓库既有流程验收：先跑自己写的测试，再跑可能受影响的相邻测试，全绿后才跑 `scripts/ci.ps1`；禁止用跑 CI 来找 bug。文档改动须跑 `scripts/verify-translation-pairing.ts`（双语对）与 `scripts/verify-export-jsdoc.ts`（导出面 JSDoc）。

本计划新增两类守卫，都属于「把一次性发现变成持续不变量」：其一，A1 的白名单不变量测试，防止判定点再次漂移；其二，A5/B1 的生成物与文档覆盖守卫，防止真源与派生物再次脱节。两者都应对齐已有做法——仓库已有 `check-lockstep.mjs`、`check-ghost-deps.mjs`、`verify-export-jsdoc.ts` 等同类守卫，新增项并入同一套 CI 步骤即可。

## 8. 范围边界

本计划不改变任何几何语义、不新增 op、不动版本号（版本号一律走 `scripts/set-version.mjs`）。A4 涉及是否放行 `Intl` / `Reflect` / URI 编解码等新全局，属安全面策略决定，须先拍板再实施，不在本次自动执行范围内。

本计划也不处理「为 OpenSCAD parity 补齐缺失 op」——`polyhedron` / `hull` / `minkowski` / `resize` / `projection` / `surface` / `text` / `import` 的缺口属于能力扩展，由 faijs-openscad 的开发计划另行跟踪。

## 9. 复现方式

```bash
# ① 符号表：源 vs dist 的键集差异（A5）
cd C:/my/ficad_front/faijs2
node --input-type=module -e "
import { readFileSync } from 'node:fs'
const src = readFileSync('packages/core/src/lang/symbol-table.generated.ts','utf8')
const keys = [...src.matchAll(/^\s+\"([A-Za-z0-9_]+)\"\s*:/gm)].map(m=>m[1])
const dist = Object.keys((await import('./packages/core/dist/lang/symbol-table.generated.js')).default)
console.log('src', keys.length, 'dist', dist.length)
"

# ② 脚本可用全局清单不可发现（A2）
for f in docs/language-design.md docs/language-design.zh.md docs/api-contract.md; do
  printf '%-34s %s\n' "$f" "$(grep -c 'Math\|parseInt\|console' $f)"
done

# ③ 语句分隔不是「换行分隔」（M6）
node --input-type=module -e "
import { pathToFileURL } from 'node:url'
const base = 'C:/my/Faicad/faijs-openscad/node_modules/@faicad/faijs/dist/'
const { DirectExecutor } = await import(pathToFileURL(base + 'cad-runtime/direct-executor.js').href)
const de = new DirectExecutor({ namespaces: { cad: {} } })
console.log(de.unitRanges('let a = cad.box(1,1,1); let b = cad.box(2,2,2); let c = cad.box(3,3,3)').ranges.length)
"

# ④ S4 拦截的分层取证（A1 / A3 / M5）
cd C:/my/Faicad/faijs-openscad
FAIJS_PROBE_RUNTIME=1 npx vitest run src/emit/faijs-script-globals.probe.test.ts
npx tsx src/__probe__/script-globals-scan.ts
```
