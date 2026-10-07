# AGENTS.md

## ⚠️ 用户全局铁律（最高优先级，优先于本文件一切其它规则）

1. **用户需求永远是第一位的，必须立刻响应。** 用户问进度时，必须**立刻停下手里的所有工作**、如实报告当前状态；永远不准以「让我再跑一个更准确的报告 / 再验证一轮 / 再查一下」为由继续跑任务而不先回应用户。
2. **分析 bug 不准钻牛角尖。** 遇到难解 bug，必须先给出**全局清单**（总共哪些点可能挂死/出错、各自条件），先报全局再谈单点；不准几个小时死盯一个点、被问「有哪些死锁」却回答不出来。单点长时间无解就上浮问题、如实告知，而不是无限深挖。
3. **如实汇报一切。** 未解决的 bug 永远不写成「已解决 / implemented」；用户叫停 / 禁跑后立即停手，不在未授权下继续跑任务。

Faicad CAD 执行引擎：faijs 语言 parser + BREP/mesh 双链路几何 + CadRuntime。

**monorepo（npm workspaces，2026-08-30 P1–P6.6）**：根 `package.json` 为 `@faicad/faijs-monorepo`（private 聚合器，原根门面已废弃、见下）、`packages/core`（`@faicad/faijs` 引擎，2026-09-19 D2-A 升格为公开包名；L3 API 面在 `core/src/api/`，P6 起并入 core）、`packages/faijs-extra`（`@faicad/faijs-extra` 编辑器扩展库，2026-09-24 D1 拆分：`fai_drill`/`fai_extrude`/`fai_split`/`group`/`assembly`/`copy`/`load`/`text`/`svgExtrude` 与 svg／文字预览辅助；`/editor-ops` 子入口只含 A 组、不触达 `three/examples`，供小程序 worker 使用。**它不是标准库、也不属于 faijs 语言核心库——原本只是为 3d_editor 应用提供的一组 op，其他应用原则上不应依赖**）、`packages/fixtures`（数据包）、`packages/tests`（集成测试）、`packages/demo`（private）。构建产物各包 `dist/`；**测试/CLI 直接消费 `src/`**（vitest alias + tsconfig paths，M7 免打包；`packages/demo` 例外——独立化后经 workspace 依赖消费各包 `dist/`，见下）。

> 包架构再设计（2026-09-19）：原根门面 `@faicad/faijs`（仅注入 cad + `export *`）已删除，其公开名 `@faicad/faijs` 由 core 升格继承（D2-A）；`cad` 默认命名空间内置引擎（D1，`createRuntime` 自带注册，不违反 K5）。详见 `docs/plans/2026-09-19-npm-publish-plan.md`。

## 开发完成后的测试步骤

1. 每次开发完功能，一定先跑自己写的测试

2. 单独跑其它可能有被影响到的测试

3. 全部通过后才准跑ci， `scripts/ci.ps1`。**严禁通过跑 CI 找 bug**。跑完一次 CI 后记住哪些测试失败了，之后只跑失败的测试，不要重复跑 CI。

4. 要改版本号时，必须走下面的「版本号升级流程」——版本号一律由脚本改写，禁止手改（手改的 package `version` 或 @faicad/* range 会被 `check-lockstep.mjs` 判失败：pre-commit、ci.ps1、ci.sh、publish-all 四处都跑）。

## ⚠️ 版本号升级流程（唯一写入口，禁止手改）

**禁止手工编辑任何版本号**：`config.faijsVersion`、任何包的 `version`、任何 `@faicad/*` 依赖/peer range。全部由脚本改写。

**这不是洁癖——手改已经造成过实际故障。** 2026-09-30 的 `7355c4a` 手改 `config.faijsVersion` 到 0.22.4（跳过 `set-version.mjs`），同一批改动里 `@faicad/faijs-cadquery` 的 `@faicad/faijs-sketch` peer 写成 `"*"` 而没有被规范化，`check-lockstep.mjs` 随即变红。**判据是脚本的出口，不是人的自觉**——所以 `check-lockstep` 是硬门禁，不是警告。

| 顺序 | 命令 | 作用 |
|---|---|---|
| 1 | `npm run set-version -- <MAJOR.MINOR.PATCH>` | **唯一**的版本写入端 |
| 2 | `node scripts/check-lockstep.mjs` | 改完必须跑（CI 的一部分） |

`set-version.mjs <ver>` 一次改到位：root `config.faijsVersion` + 每个家族包 `version` + 每个 `@faicad/*` registry range（一律规范成 `^<major>.<minor>.0`）+ `cdn/versions.json` + `package-lock.json`。同版本重跑是幂等的修复入口——**修红就走这条路**。

## ⚠️ 验证与踩坑留档铁律

1. **关键验证必须保留为可重复执行的测试代码。** 开发过程中写过的任何一次性验证脚本（探针、语义标定、边界确认），若其结论对后续开发有意义，必须把验证逻辑落成 `*.test.ts` 留在仓库里；一次性 dbg 脚本，不应该直接删除，重要的结论要保留为测试代码。
2. **与预期不一致的 API 用法必须留档为测试。** 发现某个 API 的真实行为与直觉/文档不符时（如参数顺序、语义反向、隐式约束），必须把「错误用法 + 正确用法」写成防回归测试（`GOTCHA:` 注释标注），防止后人踩坑。
3. **API 不清晰本身就是问题。** 反复出现踩坑说明 API 设计至少是不清晰的，要在 Agent Note 中记录该信号，供上游改进或重命名时参考。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run build` | 按序构建：`core` → `faijs-draw` → `faijs-sketch` → `faijs-extra` → `sheetmetal`（`tsc` 编译各包 src → dist；demo e2e 与 faijs-cadquery / cq-compat-compare 的 pretest 构建消费这些包的 dist） |
| `npm run build -w <pkg>` | 单包构建，如 `npm run build -w @faicad/faijs` |
| `npm run pack` | 构建（workspaces 顺序即依赖拓扑）+ 逐包 `npm pack`，tgz 落在各包目录。开关：`--only <pkg>`、`--no-build`、`--dry-run`、`--strict-lockstep` |
| `npm run test -w <pkg>` | 单包测试（`-w @faicad/faijs` / `-w @faicad/faijs-tests`；cwd=包目录，fixture 路径已 import.meta.url 化） |
| `npm run test --workspaces` | 全量测试（stderr 零容忍由 CI 检查） |
| `npm run typecheck` | 根 `tsc --noEmit`（tsconfig paths 跟随检查 core 源码）+ `--workspaces` 逐包 |
| `npm run lint` | `eslint packages/core/src packages/faijs-extra/src`（`scripts/`、`docs/`、`demo/`、`packages/demo/` 被 ignore） |
| `node scripts/check-ghost-deps.mjs` | 幽灵依赖守卫（每包 import 必须声明在自身 package.json） |
| `node scripts/check-workspaces-order.mjs` | workspaces 数组顺序 == 依赖拓扑断言 |
| `node scripts/set-version.mjs <ver>` | 包族版本对齐**写入端**（升级版本号就走它，见上面「版本号升级流程」）：把 root `config.faijsVersion` + 全部可发布包 `version` + 全部 @faicad/* registry range 一次改成同一版本线（`--dry-run` 只打印、`--no-lock` 跳过 lock 刷新、`--include-private` 把 fixtures/tests/demo 一起对齐） |
| `node scripts/check-lockstep.mjs` | 包族 lockstep 守卫：① 各可发布包 `version` == root `config.faijsVersion`；② @faicad/* registry 依赖 range 指向该版本线（防 CDN 解析旧版断图）。`--self-test` 用合成包集自测规则引擎，`--include-private` 让 private 包也纳入检查 |
| `npx madge --circular packages/*/src` | 包图无环守卫 |
| `pwsh -NoProfile scripts/ci.ps1` | Windows 全量 CI：lint → typecheck → build → workspace 测试 + stderr 检查 → 守卫 → demo e2e ×2 → pack |
| `scripts/ci.sh` | Linux/macOS 版；Windows 下会报错提示改用 ps1 |
| `npx tsx packages/core/scripts/faijs-cli.ts check <f.fai.js>` | 干跑校验（parse + schema + 引用预检） |
| `npx tsx packages/core/scripts/faijs-cli.ts run <f.fai.js> --out x.stl\|step [--mode auto\|brep\|mesh]` | 执行并导出；STEP 需要 BREP 链存活 |
| `npm run doc-sync` | 文档规范全量检查（12 项门禁：链接、换行、预算、Agent Note、双语、类型等价、Mermaid、JSDoc、ts 编译、引用、归档） |
| `npm run archive-plans` | 归档上月 docs/plans/ 文档到 yyyy-mm/ 文件夹（每月 1 号运行） |
| `npx tsx scripts/check-api-test-coverage.ts --package=<dir>` | API 测试覆盖门禁：基于源码 AST，检查每包导出 API 是否被本包 `test/` 引用（L1），且每个参数是否在调用点被覆盖（L2）。不依赖 build。各包可经 `npm run check:api-coverage -w <pkg>` 单独运行。已知缺口由各包 `api-coverage-baseline.json` 暂放过（防退化），`--generate-baseline` 刷新 baseline |

## 架构（L0–L3 分层，全部位于 `packages/core/src/`）

- **L0 文本层** `lang/`：parser（acorn，**先解析后编译，执行交给 JS 虚拟机**）、codegen、args-schema。`.fai.js` 是合法 JS 子集，语句 id 用 `sN`（StmtId），产出变量名用词法名（UI 自动生成代码采用 `partN` 形式，见 `lang/allocate-id.ts`）。
- **L1 几何层**：`brep/`（OCCT brep 链）、`mesh/`（manifold-3d mesh 路径，按模块具名导出，**无任何聚合门面**）、`boolean/`、`primitives/`、`sdf/`、`topology/`；**L3 API 库面在 `api/`（core 内）——库函数经 `@faicad/faijs/api` 导入，`cad` 命名空间经门面 `createRuntime` 注入**。
- **L2 编排** `cad-runtime/`：`CadRuntime` + `HostPorts`（csg/sdf/fonts/assets/events 注入接口）。
- **L3 Host**：`node-host/`（fs）+ `browser-host/`（worker）。
- **双链路执行**：每个 op 必支持 mesh（默认路径），可选支持 brep——库函数经 `defineOp` 声明实现集（`@faicad/faijs/sdk`），`cad-runtime/backend-dispatch.ts` 按静态规则分派，无运行时回退；BREP 链状态在 `brep/brep-chain.ts`。单位 mm、+Z 向上、角度用度（契约见 `docs/api-contract.md`）。
- **op 三分类**：① faijs 特有 dual-op（`defineOp({mesh, brep})`，如 `box`/`union`/`knurl`，mesh+brep 双实现）；② compat op（`compatOp(fn, spec)`，brep-only，如 `fuse`/`cut`/`extrude`——从早期 brepjs 投影（已内化为第一方代码），mesh 模式抛 `E_MESH_UNSUPPORTED`）；③ TS 兼容面纯投影（re-export，非 op——`Sketcher`/`Blueprint`/`draw` DSL、`ok`/`err`/`isErr` 组合子、子形状查询 `getFaces`/`getEdges`）。`compatOp` 和 `admitCompatLib` 的底层封装见 `docs/api-contract.md` § 7.7–7.8。
- **错误体系 = Result 原生**：对外 API 全面采用 `Result`/`BrepError` 体系（`ok`/`err`/`isOk`/`isErr`/`map`/`andThen`/`unwrap`）。TS 兼容面 Result 原样返回；cad 脚本面语句边界自动 unwrap（err → `ExecutionResult.failedAt`，存量 `.fai.js` 零修改）；库边界面经 `compatOp` 边界 unwrap。
- **引擎定位（与 brepjs 项目不同）**：faijs 的引擎切换和 brepjs 项目不同。在 brepjs 项目中，occt 和 manifold 都是实现相同接口的引擎，mesh 的用途是预览。本项目中则明确区分 mesh 引擎与 brep 引擎，且 mesh 是正式数据，不是预览，定位完全不同——比如 sdf 模型，只能以 mesh 表示。至于 UI 层预览，完全可以采用更轻量级的方式实现（如幽灵渲染/叠加层），不应依赖"先用 mesh 拆解重建几何来充当预览"。
- 入口：根门面 `@faicad/faijs`（`src/index.ts` 等 10 个 exports 子路径，薄 re-export + `createRuntime` 包装注入 cad）；引擎入口在 `packages/core/src/index.ts` / `browser.ts`（不含 node-host）/ `node.ts` / `csg.ts` / `sdf.ts` / `sdk.ts`。浏览器构建里静态 import node-host 会 404——Node 专用代码一律从 `@faicad/faijs/node` 导入。

## 库开发者 vs 脚本开发者：两套 API 面，禁止混用

faijs 同时服务两类人，他们看到的是**不同的 API 面**。混为一谈在本仓已经造成过一次真实事故（B3）：把内核实现的聚合对象当成 faijs 的公开 API 去 `import`。先确认自己在哪一侧，再决定能 import 什么。

### 一、脚本开发者（写 `.fai.js` 模型的人）

- **只面对一样东西：`cad` 命名空间**（`cad.box(...)`、`cad.union(a, b)`、`cad.engrave(...)`）。它由宿主在运行时经 `registerLib('cad', namespace, { default: true })` 注入；脚本面可见的 op 名以 `lang/symbol-table.generated.ts` 为权威清单。
- **`cad.<op>` 是语言/运行时契约，不是模块路径**：它解析到 `api/` 里的 op 定义对象（`defineOp({ mesh, brep })`），再由 `cad-runtime/backend-dispatch.ts` 按静态规则分派到 mesh 或 brep 实现。
- **不受本仓文件组织变化影响**：op 名、签名、语义不变，存量 `.fai.js` 一律无需改写。
- 编辑器专用 op（`fai_drill` / `fai_extrude` / `fai_split` / `group` / `assembly` / `copy` / `load` / `text` / `svgExtrude`）由 `@faicad/faijs-extra` 装配进同一个 `cad` 命名空间——脚本开发者只需知道它们可用，不需要知道包结构。

### 二、库开发者（写 TS：核心、扩展库、宿主、下游工具的人）

- **面对具名模块，不存在「一个大而全的对象」**。一律从具体子路径导入：
  - API / sdk：`@faicad/faijs/api`、`@faicad/faijs/sdk`（`defineOp` / `compatOp`）
  - 几何内核：`@faicad/faijs/mesh/{primitives,transform,boolean,engrave,query,io}`、`@faicad/faijs/brep/*`、`@faicad/faijs/primitives/*`
  - 运行时 / 解析：`@faicad/faijs/runtime-state`、`@faicad/faijs/symbol-table`、`@faicad/faijs/identity`、`@faicad/faijs/shape`、`@faicad/faijs/api/api-namespace`
- **⛔ 禁止把 `packages/core/src/mesh/` 的内核门面当公开 API。** 该目录**不提供**任何 `cad` / `meshCad` 形状的聚合对象（2026-10-06 B3 补正已整体删除）。要 `box` 就 `import { box } from '@faicad/faijs/mesh/primitives'`；找不到「什么都有的那个对象」是**预期行为**，不是缺 API。
- **需要用「脚本面那套 op 对象」时，拿命名空间本身**：平台面 `createApiNamespace()`（`@faicad/faijs/api/api-namespace`）、编辑器面 `createEditorCadNamespace()`（`@faicad/faijs-extra`）。core 内部就是这么做的（见 `api/cadquery-selectors/face.ts`）。
- **命名纪律**：`cad` 这个名字只属于脚本面。库层面再出现 `cad` / `xxxCad` 形状的聚合对象，一律视为设计缺陷。
- 用自己的库扩展 faijs（写 op、做下游库）另见 `docs/library-dev-guide.md`。

### 三、一句话判据

- 你的代码**被 `.fai.js` 调用** → 你写 op（`defineOp`），归脚本面。
- 你的代码**由 TS 直接 import** → 你只能用具体模块，永远不要把内核门面当 API。

## 必须知道的约定

- **`packages/core/src/mesh/api.d.ts` 是生成文件**：由 `packages/core/scripts/gen-api-dts.ts` 生成（内嵌函数目录），禁止手改；改 schema 后必须重跑 `npx tsx packages/core/scripts/gen-api-dts.ts`。
- **测试 stderr 零容忍**（CI 强制）：任何测试输出 `stderr |` 行即判失败。测试若故意触发错误，必须在测试内 spy `console.warn/error` 并断言；禁止全局静默 stderr。
- **typecheck/lint 覆盖测试**：各包 `tsc --noEmit` 的 include 含 `src/**/*.ts` + `test/**/*.ts`；`packages/tests` 的集成测试由 `npm run typecheck -w @faicad/faijs-tests` 单独覆盖——改动后手动跑 vitest 验证。
- 测试分布：各包 `test/**/*.test.ts(x)`（与 `src/` 平级、独立目录，不再与源码同目录）、`packages/tests/faijs/`（按功能分目录，含 `.fai.js` fixture）、`packages/fixtures/data/`（step/stl/3mf/svg 数据）。第三方库通道测试 fixture 在 `packages/tests/faijs/compat-e2e/_support/`。parity 测试（BREP vs mesh 一致性）在 `beforeAll` 里 `initOcctWasm()`。fixture 路径已 `import.meta.url` 化（与 cwd 无关）。
- **API 测试覆盖门禁**（CI 强制）：每个可发布包的导出 API 必须被本包 `test/` 引用（L1），且每个参数必须在调用点被覆盖（L2）。由 `scripts/check-api-test-coverage.ts` 基于源码 AST 判定，不依赖 build。新增导出 API 或新参数未测试 → CI 失败。
- 仓库文档双语配对（英文 `foo.md` + 中文 `foo.zh.md` + `foo.i18n.yaml`），见 [docs/i18n/README.md](docs/i18n/README.md)。例外：`docs/plans/`、`docs/analysis/`、`AGENTS.md` 不配对。commit message 用 conventional commits（英文）；代码注释用英文。

## 文档地图

- `docs/AGENTS.md`：文档标准，改文档前必读。
- `docs/api-contract.md`、`docs/language-design.md`、`docs/ops-api-inventory.md`（写 `.fai.js` 的 API 手册）、`docs/library-dev-guide.md`（第三方库开发手册）：有效契约，改行为前必读。
- `docs/plans/YYYY-MM-DD-*.md`：按日期命名的设计/计划文档。每月 1 号归档到 `yyyy-mm/` 文件夹。**严禁修改或引用已归档的 plans 子文件夹里的文件。**
- `docs/analysis/`：技术分析文档。
- `.agents/notes/`：决策记录（Agent Notes），见 [.agents/notes/README.md](.agents/notes/README.md)。
- `.agents/skills/faijs-npm-publish/SKILL.md`：npm 发布说明，**发布 npm 时必读**（含 `publish-all.ps1` 流程、环境识别戒律、版本号升级流程）。
- `docs/i18n/`：双语配对约定与翻译规则。



## ⚠️ Git 操作警戒：永远不准无差别还原目录

**禁止 `git restore <目录>`、`git checkout -- <目录>`、`git reset --hard` 等批量还原操作。**

这些命令会**无差别销毁目录下所有未提交的修改**。可单个文件处理。


## BREP 术语约定

- **`brep`（BREP）在本项目的默认含义**：指**可通过方程/精确几何运算**的边界表示模型——OCCT 实体（精确曲面、边、顶点，STEP 导出为 `ADVANCED_FACE`）。faceted / 三角化封装的"brep"默认不算brep。

## ⚠️ BREP/mesh 路径判定红线：静态规则，禁止运行时回退

**BREP 链是否可用，由静态规则在执行前判定，不是运行时 try-catch 判定。** 

是否用 mesh 在执行前就应知道。BREP 路径执行抛异常 = 设计缺陷或 bug，必须直接报错暴露。

Brep链可以切换，没有回退。在链上增加一个brep不支持的操作后，该链的后续部分采用mesh处理。该链之前的部分不变，仍然是brep处理。这就是切换。


## 文档写作要点
写需求分析文档和技术开发文档时，最重要的原始内容是用户的要求。用户的原话必须直接写入文档中，然后才是其他的内容。

如果用户说写方案，那么整个会话过程中都只写方案。用户让你改的任何东西，意思都是在方案中修改。除非用户明确说开始实施、开始写代码。

## 文档管理

- 非平凡变更必须在同一 PR 中新增或更新至少一份 Agent Note（见 [.agents/notes/README.md](.agents/notes/README.md)）。
- 代码改动和文档更新在同一 PR 中完成——配置键、默认值、错误码的变更同步更新 README 和 JSDoc。
- 运行 `npm run doc-sync` 检查文档规范（全部 12 项门禁）。
- 文档放置规则：方案设计→`docs/plans/`；技术分析→`docs/analysis/`；决策记录→`.agents/notes/`；接口契约→`docs/api-contract.md`；语言契约→`docs/language-design.md`；API 手册→`docs/ops-api-inventory.md`；库开发手册→`docs/library-dev-guide.md`。
- 一个事实一个家：每条规则只有一处权威归属，其他地方只链接不重复。
- 记录当前状态，不写变更历史——变更历史放在 commit message 和 PR 中。
- 双语配对：范围内文档必须配齐 `.md`（英文）、`.zh.md`（中文）、`.i18n.yaml`（一致性记录）。例外：`docs/plans/`、`docs/analysis/`、`AGENTS.md` 不配对。
- 非 `docs/plans/` 文档严禁引用 `docs/plans/` 文档——plans 是临时性、按月归档的方案文档，不得成为其他文档的引用对象；非 plans 文档必须自包含（权威规定见 `docs/AGENTS.md`）。
- `docs/plans/` 中的方案文档状态流转：方案（未实施）→实施中→已落地/已废弃。废弃的方案文档标注替代方案链接。每月 1 号归档上月文档到 `yyyy-mm/` 文件夹。


本项目虽已发布npm，但是仍然是内部测试阶段，不考虑任何api的向后兼容性。
