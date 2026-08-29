# faijs monorepo 化方案（npm workspaces）

- 日期：**2026-08-30**（第 4 版）
  - 第 1–2 版：pnpm 方案 + 错误的 stdlib 切分 → **已作废**
  - 第 3 版：改 npm、重做 stdlib 切分、新增 brepjs 剖析 → 结构正确，但**内部数字多处未核实**
  - 第 4 版（本版）：**逐条实地核实**（brepjs 仓库 + faijs 源码），修正 16 处事实错误，见 **§0.4**
- 状态：**设计待裁定（未实施，未改任何代码）**
- 包管理器：**npm workspaces**（已裁定，见 §2）
- 仓库形态：**单 git 仓 + 多 package**（已裁定，见 §0.3 D1）

## 权威文档（本方案的判据来源，按优先级）

| 优先级 | 文档 | 状态 | 本方案依据它的什么 |
|---|---|---|---|
| **1** | `C:\my\Faicad\3d_editor\Faijs语言的思考.md` | **语言定位唯一权威** | 第 5/6/7/13 条 —— 尤其是 **第 13 条「几何运算全部交给 faijs 语言库来实现，faijs 引擎不内置」**，它是 §4 stdlib 切分的唯一判据 |
| **2** | `docs/plans/2026-08-29-engine-library-contract.md` | **已完成的方案** | §0.2 硬约束 K1–K6、§5 职责界定总表、§10.1 装配（求解 ≠ 传播） |
| **3** | `docs/plans/2026-08-29-faijs-module-runtime-plan.md` | **正在开发的文档** | §4 三条加载通道、§4.5 SDK 增量 API、§5 断链物化 |
| — | `AGENTS.md` / `CLAUDE.md` | 工程纪律 | 测试分层、stderr 零容忍、BREP/mesh 红线 |

> ### ⚠️ 上一版（§头部）的事实错误，此处更正
>
> 前两版把 `docs/api-contract.md` 和 `docs/syntax-design.md` 列为「上位文档／改行为前必读」。**这是错的。**
>
> **在当前的快速开发阶段，这两份文档已经过时**（用户本轮第 3 轮输入当面指出）。本方案**不引用它们作为任何判据**。
>
> **关于 `syntax-design.md` 的过时证据**（核实自 `engine-library-contract.md` §16 第 846–861 行）：该表共 **9 行**待修订项，其中 **`syntax-design.md` 占 3 行**（§1.1/§6.2 末参 exec、§5.2/§5.3 符号表驱动消费判定、§10 远期第三方库），另 4 行指向 `keep-syntax-design.md`、2 行指向 `ecosystem-roadmap.md`、各 1 行指向 `faijs-normal-js-subset.md` 与 `faijs-platform-api-design.md`。
> ⚠️ 上一版写的「8 处待修订点」是**错的**（数字凭印象，未回查）。
>
> **关于 `api-contract.md`**：用户明确判定其过时。`engine-library-contract.md` §5.4 仍引用它作为「单位与坐标系」的约定来源——**这是契约文档尚未同步的部分，不是本方案可以依赖的判据**。本方案只从 `Faijs语言的思考.md` 与 `engine-library-contract.md` 取判据。
>
> 另外三条必须知道的过时/冲突事实：
> 1. `docs/syntax-design.md` 的「第三方库遵守末参 `exec` 约定」「符号表驱动消费判定」**均已作废**（K1 + contract §16）。
> 2. `AGENTS.md` 说「入口文件 `src/index.ts`（全量）」等 —— 结构描述正确，但**包形态描述会在本次迁移后失效**，迁移完成时须同步修订 `AGENTS.md`。
> 3. `C:\my\Faicad\3d_editor\Faijs语言的思考.md` 第 90 条：**「本语言的核心思想，不能放入 `../faijs` 项目，以免专利失效。」** 该文件**故意放在 3d_editor 而不在 faijs 仓库**。本次 monorepo 化**不得**把它搬进 faijs 仓库，任何"语言核心思想"性质的文档同理。

---

## 0. 需求基线（用户原话，不准删改）

### 0.1 第一轮（提出需求）

> 请调研并写一份方案。我想把本项目更改为monorepo，并且使用pnpm管理。然后把demo项目，标准库，测试用的第三方库等都独立为单独的repo，且引用主的faijs库。这样联动修改demo与faijs引擎时，不需要打包就可以测试。请分析本项目的代码并写一份方案。

| # | 需求 | 验收判据 |
|---|---|---|
| M1 | 项目改为 **monorepo** | 多个 package 在同一仓库内协同开发 |
| M2 | 使用 **pnpm** 管理 | 已改判为 **npm workspaces**（§2）。M2 的真实诉求是"monorepo 由 workspace 管理器统一编排" |
| M3 | **demo** 独立为单独的包 | demo 不再以 `file:../faicad-faijs-x.y.z.tgz` 消费引擎 |
| M4 | **标准库**（`src/stdlib/`）独立为单独的包 | 有独立 `package.json`，可被单独引用 |
| M5 | **测试用的第三方库**独立为单独的包 | `test/faijs/libs/*`（mock mech-lib）成包；可独立发布 |
| M6 | 这些包**引用主的 faijs 库** | 依赖方向：demo / stdlib / mech-lib → faijs（单向，无环） |
| M7 | **联动修改 demo 与 faijs 引擎时，不需要打包就可以测试** | 改 faijs 源码 → demo dev server / vitest 立即生效，中间无 `npm pack` / `npm run build` |

### 0.2 第二轮（包管理器提问）

> 可以参考C:\git\OpenCascade\brepjs的设计。它没有采用pnpm，而是直接采用的npm。据说pnpm 会有 WASM 路径问题，是否是这样。本项目用 npm 好，还是 pnpm 好？

→ 回答见 §2。结论：**"pnpm 有 WASM 问题"被实测证伪**；但本项目仍推荐 npm，理由是同域先例 + 迁移风险。

### 0.3 第三轮（本轮的裁定与纠错）

> ok. 用npm方案，且是一个git仓库多个package的monorepo。但是你的stdlib拆分部分写的有问题。比如装配，毫无疑问是stdlib的东西，为何你要把它放入引擎里。还有，你要分析C:\git\OpenCascade\brepjs的这个项目，看看它的monorepo是如何设计和实现的。请修改你的方案，文件名也要修改，去掉pnpm。此外，你文档开头明显有事实错误。目前在快速开发阶段，`docs/api-contract.md`、`docs/syntax-design.md` 都是过时的文档。下面这些才是需要参考的：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位唯一权威）、`docs\plans\2026-08-29-faijs-module-runtime-plan.md`（正在开发的文档）、`docs\plans\2026-08-29-engine-library-contract.md`（已完成的方案）。

| 裁定 / 纠错 | 本方案的处理 |
|---|---|
| **D1 = 单 git 仓 + 多 package** | 采纳（§5）。每个 package 仍是完整可 `npm publish` 的 npm 包，将来可 `git filter-repo` 拆出 |
| **包管理器 = npm** | 采纳（§2）。全文命令改用 npm |
| **文件名去掉 pnpm** | 采纳。本文件为 `docs/plans/2026-08-29-monorepo-plan.md` |
| **装配属于 stdlib，不属于引擎** | **上一版结论作废，§4 全部重写**。`compound.ts`（`group`/`assembly`/`solveFaceMate`/`applyTransform`）**全部留在 stdlib** |
| **分析 brepjs 的 monorepo 设计** | §3 新增完整剖析，并从中提取 6 条可直接落地的机制 |
| **文档开头引用了过时文档** | 已在"权威文档"表更正，并列出 3 条过时事实 |
| **文件名去掉 pnpm 后仍要改内容** | 第 3 版只改了文件名与结构，**内部数字凭印象**。第 4 版逐条实地核实，见 §0.4 |

### 0.4 第四轮：实地核实修正表（本版新增，逐条可复核）

> 第 3 版的结构性结论全部保留（npm、单仓多包、装配留 stdlib、brepjs 剖析），但**内部数字有多处凭印象填写**。
> 本版对 brepjs 仓库与 faijs 源码逐条实地核对，修正如下。**每一条都标注了核实命令。**

| # | 第 3 版写的 | 实测（2026-08-30） | 核实方式 | 影响章节 |
|---|---|---|---|---|
| **C1** | 「25 个 op」「共 16 行」 | **17 行 import（`internal-stdlib.ts:10–26`），30 个函数**。25 = 30 − 5 个 geom 查询（`faceCenter/faceNormal/bboxCenter/bboxMin/bboxMax`）。两个说法都不精确 | 逐行点算 `src/cad-runtime/internal-stdlib.ts` | §1 §3.8 §4.3 §4.4 §4.5 |
| **C2** | 「7 个子路径导出」 | **11 个**：`.` `./browser` `./csg` `./sdf` `./stdlib` `./node` `./faqts` `./faqts/node` `./faqts/browser` `./module-resolver` `./sdk` | dump `package.json.exports` 键 | §6.1 §10-P0 §12 §14-E |
| **C3** | 版本 `0.5.4` | **0.5.8**（`package.json:3`；最新 tarball `faicad-faijs-0.5.8.tgz`；3d_editor 已在消费 0.5.8） | 读 `package.json` + `3d_editor/package.json:24` | §6.1–6.3 §10 §12 |
| **C4** | 「`brepjs@18.119.2` 是 9MB **死依赖**，全仓 `from 'brepjs'` 零命中」 | **❌ 完全错**。`test/faijs/libs/brepjs-gear.ts:32`、`brepjs-gear.test.ts:23`、`c3-brepjs-scenario.test.ts:34` **真实 import `from 'brepjs'`**。它是**第三方库样例的真依赖**，删了会直接炸 `packages/mech-lib` | `grep -rn "from 'brepjs'" src test demo` | §1 §6.5 §10-P0 §13 §14-F |
| **C5** | 「根目录 14 个历史 `.tgz`」 | **19 个**。且 `*.tgz` 已被 `.gitignore` 忽略 —— 它们是**构建产物**，不是待清理的"未跟踪文件" | `ls *.tgz \| wc -l` + 读 `.gitignore` | §1 §10-P0 §14-F |
| **C6** | 「`process.cwd()` 10 处 / 9 个文件」 | **13 处 / 10 个文件**；清单**漏了 `test/faijs/faqts/faqts.test.ts` 的 3 处**（`:27 :29 :87`） | `grep -rn "process.cwd()" test/` | §9.2 |
| **C7** | `test/*.step / *.svg / *.3mf` | 实际在 **`test/fixtures/`**（`box_boss.3mf` `box_boss.step` `cube-10x5x5.stl` `svg/` `test-model.step`，共 5 项）。`test/` 根下**无**数据文件 | `ls test/` `ls test/fixtures/` | §9.1 §10-P6 |
| **C8** | `demo/main.ts:502-505, 512-516` | **`:503` 与 `:513`**。且 demo **没有 `src/` 子目录**，main.ts 就在 `demo/` 根 | `grep -n "node_modules/occt-wasm\|node_modules/manifold-3d" demo/main.ts` | §2.2 §8.1 |
| **C9** | `three` 依赖的证据只有「`brep/brep-ops.ts:17`」 | three 被**多处** import：`boolean/cross-section.ts:17`、`boolean/geo-convert.ts:8`、`boolean/extrude-helpers.ts:16`、`boolean/deriveNormals.ts:1`、`brep/brep-ops.ts:17`、`brep/brepjs-mirror/joinery-brep.ts:19` 及若干 test | `grep -rn "from 'three'" src/` | §6.2 §13-O6 |
| **C10** | core 包目录含 `ops/` | **无 `ops/` 目录**（已拆为 `boolean/` `primitives/` `sdf/`）；且**遗漏**了 `faqts/` `module-resolver/` `assets/` `test/` | `ls src/` | §4.7 §5 |
| **C11** | 「190 个文件」 | **204 个 `.ts`** | `find src -name "*.ts" \| wc -l` | §13-O8 |
| **C12** | 「brepjs 用一个 100 行的 bash 脚本」 | **139 行** | `wc -l scripts/check-layer-boundaries.sh` | §3.5 |
| **C13** | 3d_editor 有 **267 处** `@faicad/faijs` 引用 | **279 处** | `grep -rn "@faicad/faijs" 3d_editor/src \| wc -l` | §4.5 §12 |
| **C14** | P0 只说删 `demo/package-lock.json` | 还要删 **`demo/node_modules/`**（已存在，含指向 tarball 解压产物的 `@faicad/faijs`） | `ls -d demo/node_modules` | §10-P0 |
| **C15** | P0 只说改 `"prepare"` → `"prepublishOnly"` | 根 `package.json` **同时有 `"prepack"` 和 `"prepare"`**，两者都跑 build。workspace 下都会被 `npm install` / `npm pack` 触发，**必须一起处理** | 读 `package.json.scripts` | §6.2 §10-P0 |
| **C16** | §3 的 brepjs 数据未标出处 | 全部回查并标注 `文件:行`，新增 **§3.9 核实清单** | 见 §3.9 | §3 全节 |

**已核实为正确、不要被上表误伤的部分**：

- ✅ core → stdlib 的反向依赖 **确为 9 个文件 / 29 条 import 语句**（§4.4 表逐行对得上）；
- ✅ `src/stdlib/` **确为 22 个源文件**；`compound.ts` 283 行、`shape.ts` 126 行（§4.3 表）；
- ✅ `brepjs-mirror/` 的消费者**确为** `drill.ts:18` / `screw.ts:13` / `split.ts:23`；core 侧只有 `brep/index.ts:8` 的一行注释（§4.3）；
- ✅ `module-executor.ts:22` import shape、`:24` import `applyTransform`、`:348` 用 `Object.assign(applyTransform(...))`、`:360` 调 `computeDownstream`（§4.6）；
- ✅ `occtKernel.ts:75` 的 4 层 `..` 猜测 + `:79` 起 `candidates` 里的 `process.cwd()` 兜底（§2.2）；
- ✅ brepjs `workspaces` 数组**确为 11 个成员**、根包即主库、`.npmrc` 三行、`check-layer-boundaries.sh` 四层（§3.1/§3.5/§3.7）。

---

## 1. 结论速览

| 结论 | 内容 |
|---|---|
| **可以做** | M1–M7 全部可达成。本机 npm 10.9.7 / Node 22.22.2 可用 |
| **包管理器** | **npm workspaces**。不是因为 WASM（那个说法被证伪），而是同域先例 + 迁移风险（§2） |
| **包划分** | **3 个可发布核心包 + 3 个 private 包**：`@faicad/faijs`（根，门面）、`@faicad/faijs-core`（引擎）、`@faicad/faijs-stdlib`（几何库）；`demo` / `tests` / `mech-lib`（含 `fixtures`）。详见 §5 |
| **装配归库** | `compound.ts` 整体留在 stdlib（§4.3）。引擎里唯一用到它的 `applyTransform`（`module-executor.ts:24,348`）是**现状病灶**，按 `engine-library-contract.md` §10.1 由"标记 stale → 重算"取代，**不是**把函数上移 |
| **循环只剩两条边** | E-a：`internal-stdlib.ts:10-26` 静态 import **30 个函数**（17 行）；E-b：`module-executor.ts:24` import `applyTransform`。其余 **8 个文件 / 11 条** core→stdlib import 中，9 条是 `stdlib/shape`（shape 上移即消失）、2 条是 `browser.ts:106-107` 对 `stdlib/compound` 的门面再导出（合法，留在根包）。§4.4 逐行对账 |
| **循环的解法** | E-a：把 `internal-stdlib.ts` 从引擎搬到**根门面包**（brepjs 布局：根包即主库）；E-b：按 contract §10.1 传播收归引擎。两条边都消失后包图是 **DAG** |
| **M7 的机制** | **消费端 `resolve.alias` 指向 `src/index.ts`**（brepjs 已在用，§3.4）。比上一版的 `exports` 自定义条件更简单，且不需要改任何包的 `package.json` |
| **WASM 处理** | 照抄 brepjs 的 `wasmAssets()` 插件：`createRequire(import.meta.url).resolve('occt-wasm/dist/occt-wasm.js')` + dev 中间件 + `writeBundle` 拷贝（§8）。同时修掉 `occtKernel.ts:75` 的**既存 bug** |
| **brepjs 依赖的真实处置**（第 4 版更正） | `brepjs@18.119.2` **不是死依赖**：`test/faijs/libs/brepjs-gear.ts:32` 真实 import 它。正确做法是**随 `mech-lib` 出包时下沉为该包的 dependency**（§6.5），**不是删除**。根目录 19 个 `.tgz` 是 `.gitignore` 已忽略的构建产物（C4/C5） |
| **迁移方式** | P-0 → P0–P6 共 8 个阶段，每阶段独立可验收、可独立提交（§10） |

---

## 2. 包管理器裁定：npm workspaces

### 2.0 裁定

**用 npm workspaces。** 决定因素不是 WASM，而是：
1. **同域先例已经替我们做过这个决定**（brepjs：同 OCCT + WASM + vite + vitest 技术栈，11 个 workspace 成员，跑通了发布流程。详见 §3）；
2. **迁移风险显著更低** —— npm 的 hoisting 让 §8.2 的两处硬编码路径在 P1–P3 期间继续可用，可以"先 monorepo 化，再清理"；
3. **6 个包规模下，npm 的三个短板都有确定的低成本替代**（§2.4）；
4. 不引入新工具链，`package-lock.json` 已在版本控制中，`scripts/ci.ps1` 改动最小。

### 2.1 实测："pnpm 有 WASM 路径问题"——这个说法是错的

在临时目录搭出与 pnpm `node-linker=isolated` 等价的目录结构（junction 指向本机已安装的真实包，零安装）：

```
<root>/node_modules/.pnpm/occt-wasm@3.7.0/node_modules/occt-wasm   ← 真实文件
<root>/packages/core/node_modules/occt-wasm                        → .pnpm/.../occt-wasm（symlink）
<root>/node_modules/occt-wasm                                      ← 不存在（pnpm 不提升）
```

从 `packages/core/src/occt-kernel/` 下运行，测四种解析写法：

| # | 写法 | cwd = 仓库根 | cwd = packages/core |
|---|---|---|---|
| A | `resolve(moduleDir, '..','..','..','..', 'node_modules','occt-wasm',...)` | ❌ ENOENT | ❌ ENOENT |
| B | `resolve(process.cwd(), 'node_modules','occt-wasm',...)` | ❌ ENOENT | ✅ 22,086,075 B |
| C | `createRequire(import.meta.url).resolve('occt-wasm/dist/occt-wasm.wasm')` | ✅ 22,086,075 B | ✅ 22,086,075 B |
| D | `fileURLToPath(import.meta.resolve('occt-wasm/dist/occt-wasm.wasm'))` | ✅ | ✅ |

**结论 1**：C / D 在任何 linker 下都成立（它们走 `exports`；`occt-wasm` 导出了 `"./dist/occt-wasm.wasm"`，`manifold-3d` 导出了 `"./manifold.wasm"`）。

**结论 2**：A / B 会炸，但**炸的原因是硬编码路径，不是 WASM**。它们依赖 npm 的 hoisting。

**结论 3**：Emscripten 自身的加载机制在 pnpm 下完全正常。证据：
- `occt-wasm/dist/occt-wasm.js`：`_scriptName = import.meta.url` + `scriptDirectory = new URL(".", _scriptName).href`。Node 默认 realpath 解析，`.wasm` 就在 glue JS 旁边，直接命中。
- `manifold-3d/manifold.js`：`createRequire(import.meta.url)` + 相对 `import.meta.url` 读 `manifold.wasm`。
- **端到端实测**（cwd = `packages/core`，穿过两层 symlink）：`import("manifold-3d")` OK → `Module() + setup()` OK（29ms）→ `Manifold.cube(10,10,10,true)` 得 `triVerts = 36, numProp = 3`。

> 公开检索到的 pnpm + WASM 案例（如 shiki `onig.wasm` 报 `Unknown file extension ".wasm"`）根因是**打包器把 `.wasm` 当 ESM 模块去 `import`**，pnpm 只是让 `.pnpm` 路径出现在报错里。faijs 从不 `import` wasm，只传 `ArrayBuffer` 或 URL 字符串 —— 与本项目无关。

### 2.2 但 faijs 有两处手写路径，其中一处**今天就已经是死的**

**① `src/occt-kernel/occtKernel.ts:75`** —— 既存 bug，与选 npm 还是 pnpm 无关：

```ts
const wasmPath = resolve(moduleDir, '..', '..', '..', '..', 'node_modules', 'occt-wasm', 'dist', 'occt-wasm.wasm')
```

实测它在本仓库的真实解析目标：

```
pattern A resolves to: C:\my\node_modules\occt-wasm\dist\occt-wasm.wasm     exists: false
pattern B (cwd=repo root) resolves to: C:\my\Faicad\faijs\node_modules\...   exists: true
```

`..` 的层数（4 层）是按"包根在 src 的上两级"写的，但实际从 `faijs/src/occt-kernel` 上溯 4 级会跑到 `C:\my`。**这条路径在当前 npm 单包布局下就已经失效**，OCCT 能初始化纯粹是靠 `:75` 失败后落到 `:79` 的 `process.cwd()` 兜底，而兜底能成只是因为 cwd 恰好是仓库根。

迁移到 monorepo 后 cwd 可能是仓库根 / `packages/core` / `packages/tests` 中的任意一个，**兜底也会失效**。

**② `demo/main.ts:503, 513`**（第 4 版核实行号；`demo/` 下**没有 `src/`**，文件就是 `demo/main.ts`）：

```ts
wasm: import.meta.env.DEV ? '/node_modules/occt-wasm/dist/occt-wasm.wasm' : 'https://cdn.jsdelivr.net/...'
setManifoldWasmUrl(import.meta.env.DEV ? '/node_modules/manifold-3d/manifold.wasm' : 'https://cdn.jsdelivr.net/...')
```

`demo/package.json` 目前自己声明了这两个包，所以 demo 作为独立项目时可用。入 workspace 后是否可用取决于 vite root 与 hoisting 位置。

**两处共同点：都不是 WASM 问题，是"猜路径"问题。** 修法见 §8。

### 2.3 npm vs pnpm 对照（逐条实测或查证）

| 维度 | npm 10.9.7 | pnpm 11.1.3 | 对本项目的影响 |
|---|---|---|---|
| `workspace:` 协议 | ❌ 不支持（实测 `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`） | ✅ 支持 | **npm 的真实短板** |
| 多包脚本**拓扑排序** | ❌ 按 `workspaces` **数组顺序**执行（实测：声明 `[b, a]` 则 B 先跑，即使 b 依赖 a） | ✅ `pnpm -r build` 按拓扑排 | **npm 的真实短板**，靠数组顺序手写保证 |
| 依赖图过滤 | ❌ 只有 `-w <name>` / `--workspaces` | ✅ `--filter pkg...` | 6 个包规模下 `-w` 够用 |
| 依赖隔离 | ❌ 提升到根，幽灵依赖静默可用 | ✅ 严格，直接报错 | **pnpm 的优势**，但可用更便宜的方式拿到（§2.5） |
| peerDependencies | ✅ npm 7+ 自动安装 | ⚠️ 不自动装，只告警 | `manifold-3d` 声明了 `@gltf-transform/*` + `esbuild-wasm` 为 peer → pnpm 下每次 install 有告警噪声 |
| WASM 加载 | ✅ 正常 | ✅ **正常**（§2.1 实测） | **无差异** |
| 手写死路径 | 靠 hoisting 侥幸可用 | 直接失败 | 两者都不该依赖（§2.2） |
| 磁盘 / 安装速度 | 每项目一份 | 全局 store，硬链接 | pnpm 优势，但**只在其他项目也用 pnpm 时才兑现**（3d_editor / Ficad 目前是 npm） |
| 新工具链 | 无（内建，lock 已在 git） | 需引入 pnpm + `pnpm-workspace.yaml` + `.npmrc` | npm 迁移面更小 |
| 同域先例 | **brepjs 用 npm** | — | 强信号 |

### 2.4 npm 的两个短板及其替代

**① `workspace:*` → `"*"`（可发布包用锁定 semver）**

实测：`npm install` 遇 `workspace:*` 直接 `EUNSUPPORTEDPROTOCOL`；改成 `"*"` 后 symlink 正常建立：

```
node_modules/@probe/a -> /tmp/npm-ws-probe/packages/a
node_modules/@probe/b -> /tmp/npm-ws-probe/packages/b
node packages/b/index.js  →  resolved: a
```

⚠️ `"*"` 在 **publish 后**会匹配 registry 上的任意版本。mitigation：
- **private 包**（demo / tests / mech-lib）用 `"*"` 无风险；
- **可发布包**（stdlib）的内部依赖写锁定范围（如 `"@faicad/faijs-core": "^0.5.8"`），发版时统一 bump（§11.3）。

**② 构建顺序靠 `workspaces` 数组顺序，不是自动拓扑**

实测 `npm run --workspaces` 严格按根 `package.json` 里 `workspaces` 数组的书写顺序执行。因此：

```jsonc
// 根 package.json —— 顺序即构建顺序，必须按依赖拓扑手写
"workspaces": [
  "packages/core",      // 1. 引擎，无内部依赖
  "packages/stdlib",    // 2. 依赖 core
  "packages/mech-lib",  // 3. 依赖 core（第三方库样例）
  "packages/fixtures",  // 4. private 数据包
  "packages/tests",     // 5. 依赖上面全部
  "packages/demo"       // 6. private，最后
]
// 门面 @faicad/faijs 在根包，天然最后
```

并在 CI 里加一条**顺序断言**（`npm ls --workspaces` 的输出顺序 vs 预期 diff），防止有人重排数组。

### 2.5 幽灵依赖的替代检测（选 npm 时**必做**，否则 M4 抽包会漏）

npm 提升依赖到根，导致"包 A 用了包 B 声明的依赖"不报错。这对 M4（stdlib 抽包）是**实质风险**。必须用工具补上：

| 手段 | 说明 | 是否必做 |
|---|---|---|
| **`eslint-plugin-import` 的 `import/no-extraneous-dependencies`** | 为每个包配 `packageDir`，按该包自己的 `package.json` 判定 import 是否合法。项目已有 eslint flat config，增量成本最低 | ✅ **CI 必过** |
| **`madge --circular`** | 同时验 §14 的"包图无环"验收项 | ✅ **CI 必过** |
| **brepjs 同款 `check-layer-boundaries.sh`** | 分层边界强制，见 §3.5。本项目层数少，可简化 | 建议 |
| **`knip`** | brepjs 在用。除幽灵依赖外还查未使用的文件/导出/依赖 | 可选 |
| **一次性 pnpm 门禁** | CI 里加非阻塞 job：`pnpm install && pnpm -r test`，**不提交 `pnpm-lock.yaml`**，纯当"严格模式体检" | 可选 |

---

## 3. brepjs monorepo 设计与实现剖析

> 本节回答用户第三轮的要求：「你要分析 `C:\git\OpenCascade\brepjs` 这个项目，看看它的 monorepo 是如何设计和实现的。」
>
> 版本：brepjs `18.119.2`，`packageManager: npm@11.6.1`。

### 3.1 拓扑：根包即主库

```
brepjs/                          ← git 仓库根
├── package.json                 ← 双重身份：workspace 根 + 主库包 `brepjs`
├── src/                         ← 主库源码（引擎 + 几何，约 18k 行）
├── tests/                       ← 主库测试
├── vite.config.ts               ← 主库构建（vite lib mode）
├── packages/
│   ├── brepjs-opencascade/      ← WASM 数据型包
│   ├── brepjs-manifold/         ← mesh 内核（Manifold）
│   ├── brepjs-bim/              ← 域库：IFC4 建筑构件
│   ├── brepjs-sheetmetal/       ← 域库：钣金
│   ├── brepjs-cad/              ← 域库 + CLI + MCP server（最大，含 viewer/bench）
│   ├── brepjs-viewer/           ← three.js 查看器
│   ├── brepjs-voxel(-wasm)/     ← 体素引擎（Rust→WASM）
│   └── brepjs-vscode/
├── apps/
│   ├── playground/              ← private：React + Monaco 的在线 IDE
│   └── docs/                    ← private：vitepress 文档站
├── scripts/                     ← ensure-wasm.sh / check-layer-boundaries.sh / smoke...
└── benchmarks/, notes/, media/
```

**关键设计点**：根 `package.json` **自身就是主库 `brepjs`**（`main`/`exports` 指向 `dist/`），同时充当 workspace 根。域库是 `packages/*`，应用是 `apps/*`。

### 3.2 包间依赖：peerDependencies + 单一实例

| 包 | 对 `brepjs` 的依赖声明 | 说明 |
|---|---|---|
| `brepjs-bim` | `peerDependencies: { "brepjs": ">=18.0.0", "web-ifc": ">=0.0.50" }` | 域库把引擎声明为 **peer** |
| `brepjs-sheetmetal` | `peerDependencies: { "brepjs": ">=18.0.0" }` | 同上 |
| `brepjs-cad` | `dependencies: { "brepjs": ">=18.117.1" }` | **唯一例外**：它有 `bin`（`brep` CLI / `brep-mcp`），需要 install 后就可用 |
| `packages/*/devDependencies` | `"eslint": "*"`, `"typescript": "*"`, `"vite": "^8.0.0"` | **用 `"*"` 从根 hoist 拿 dev 工具**，不在每个包里重复装 |

**为什么用 peer**：保证整棵树里**只有一份 `brepjs`**（根包 + npm hoisting）。这直接对应 faijs 的 `module-runtime-plan.md` §4.3「单例共享三层保障」——同一份 `WeakSet`、同一个 OCCT wasm 实例。

**对本项目的映射**（§6 采用）：`@faicad/faijs-stdlib` 与 `mech-lib` 对 `@faicad/faijs-core` 用 **peerDependencies** + devDependencies 用 `"*"`。

### 3.3 构建：vite lib mode + external + dts

每个域库一个自己的 `vite.config.ts`，形态高度统一：

```ts
// packages/brepjs-bim/vite.config.ts（全文）
export default defineConfig({
  plugins: [dts({ rollupTypes: false, compilerOptions: { declarationMap: false } })],
  build: {
    target: 'es2022',
    minify: false,
    lib: { entry: { 'brepjs-bim': resolve(__dirname, 'src/index.ts') }, formats: ['es', 'cjs'] },
    rollupOptions: { external: ['brepjs', 'web-ifc'] },   // ← 引擎 external，不打包进产物
  },
})
```

三个要点：
1. **`external` 是硬要求，不是优化** —— 引擎打进库 = 两份 WeakSet + 两份 wasm（与 faijs `module-runtime-plan.md` §4.2 逐字同构）。
2. 每个包**自己跑自己的 vite build**，根用 `npm run build --workspace=xxx` 串行编排（`build:site` 脚本里逐条列出）。
3. `prepack: npm run build`（`brepjs-cad`）—— 发布前构建，不是 `prepare`。

### 3.4 ★ 免打包联动：消费端 `resolve.alias` 指向 `src/index.ts`

**这是对本方案 M7 最有价值的一条。**

`vitest.config.ts`（根）：

```ts
resolve: {
  alias: {
    '@': resolve(__dirname, 'src'),
    // node_modules/brepjs is a stale published copy; route to live src.
    brepjs: resolve(__dirname, 'src/index.ts'),
    // Same for the satellite domain packages the playground-example regression
    // test meshes: route to live src so tests run against current source (not
    // the last-published dist) and don't need a dist build in CI.
    'brepjs-sheetmetal': resolve(__dirname, 'packages/brepjs-sheetmetal/src/index.ts'),
    'brepjs-bim':        resolve(__dirname, 'packages/brepjs-bim/src/index.ts'),
  }
}
```

原文注释写得很清楚：**"route to live src so tests run against current source (not the last-published dist) and don't need a dist build in CI"** —— 这正是 M7 的需求，只是 brepjs 把它用在了测试上。

**另一种形态：`exports` 直接指向源码。** `packages/brepjs-manifold/package.json`：

```json
"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
"files": ["src", "dist"]
```

这个包**根本没有构建步骤**，消费者直接拿 TS 源码（配合 `files: ["src","dist"]` 发布 src）。适用于"消费者一定是打包器"的包。

**对 faijs 的取舍**（§7 采用）：

| 机制 | 优点 | 缺点 | 采纳 |
|---|---|---|---|
| **消费端 `resolve.alias`**（brepjs 根 vitest 的做法） | 零改动被依赖包的 `package.json`；`dist` 与 `src` 两条路径共存，外部用户（3d_editor）照常拿 dist，仓库内消费拿 src | 每个消费端要配一遍（但只有 demo vitest / demo vite / tsc 三处） | ✅ **主机制** |
| `exports` 指向 src（brepjs-manifold 做法） | 一处配置，所有消费者自动生效 | 所有消费者都被迫吃 TS 源码；**3d_editor 的生产构建也会被拖进 TS 源码**，不可控 | ❌ 不采纳 |
| 自定义 `exports` 条件（上一版方案） | 与上面同构，但需消费端显式 `resolve.conditions` | 比 alias 多一层间接，收益相同 | ❌ 弃用（alias 更简单） |

> **结论：上一版设计的 `"faijs-source"` 自定义条件机制作废**，改用 brepjs 的 `resolve.alias`。理由：brepjs 已验证可行，且它把"决定权"放在消费端（谁要免打包谁配置），不会污染发布出去的包契约。

**brepjs 没做到的地方**（本项目要补）：brepjs 的 **playground 应用没有 alias** —— 它依赖根包的 `dist`（`predev` 只构建 bim/sheetmetal/viewer，根包靠 `npm run dev` = `vite build --watch` 另起）。也就是说 brepjs 只做到了"测试免打包"，**dev server 没做到**。本项目 M7 要求 demo dev server 也免打包 —— 同一套 alias 加到 `demo/vite.config.ts` 即可，机制完全一样。

### 3.5 分层边界强制：`scripts/check-layer-boundaries.sh`

brepjs 用一个 **139 行**的 bash 脚本（`scripts/check-layer-boundaries.sh`，第 4 版核实行数）强制 `src/` 内的分层：

```
Layer 0: kernel/, utils/                                              — 无内部 import
Layer 1: core/                                                        — 只能 import L0
Layer 2: topology/, 2d/, operations/, query/, measurement/, io/,
         worker/, csg/, voxel/, implicit/                             — 只能 import L0–L1
Layer 3: sketching/, text/, projection/, gear/, ns/, lattice/         — 只能 import L0–L2
```

实现：`grep -oP "from ['\"](\K[^'\"]+)"` 抽 import → 解析目标目录 → `get_layer()` 查层号 → `target_layer > src_layer` 即报错退出。支持 `--staged`（只查 git staged 文件）+ `BOUNDARY_SRC_DIR` 环境变量覆写扫描根（便于对 throwaway fixture 自测）。

挂三个入口：`npm run check:boundaries` / `check:boundaries:staged`（husky pre-commit）/ CI。

**对本项目的映射**：faijs 的分层更简单（引擎 / 库 两层 + 库内不分层），所以**不需要照抄脚本**，但**需要同类的守卫**——把 §4 的切分表做成可执行的断言（§14 验收项 A4）。可选：直接用 bash 脚本对 `packages/*/src` 做"禁止 core import stdlib"的单向检查。

### 3.6 WASM：`ensure-wasm.sh` + 中间件 serve，不进 git

**归属**：独立数据型包 `packages/brepjs-opencascade`，`main` 直接指向 `src/brepjs_single.js`，`.wasm` 与 glue 放一起，`exports` 提供 `"./src/*"`。

**不进 git**：`prepare` 跑 `scripts/ensure-wasm.sh`：
1. 读 `packages/brepjs-opencascade/package.json` 的 `version`；
2. 比对 `src/.wasm-version` 标记文件；
3. 不一致 → `npm view <pkg>@<ver> dist.tarball` 拿 URL → `curl` + `tar -xzf` 解压回 `src/` → 写新的 `.wasm-version`。

**浏览器侧**：`apps/playground/vite.config.ts` 的 `wasmAssets()` 插件：

```ts
function wasmFileMap(): Record<string, string> {
  const occtDir = dirname(reactRequire.resolve('occt-wasm/dist/occt-wasm.js'))
  const webIfcDir = dirname(reactRequire.resolve('web-ifc'))
  return {
    'occt-wasm.js':   resolve(occtDir, 'occt-wasm.js'),
    'occt-wasm.wasm': resolve(occtDir, 'occt-wasm.wasm'),
    'web-ifc.wasm':   resolve(webIfcDir, 'web-ifc.wasm'),
  }
}
// configureServer:  用 server.middlewares 在 `${base}wasm/<file>` 下 serve，带 COEP/COOP 头
// writeBundle:      mkdir dist/wasm + copyFileSync 拷进产物
```

**两个关键细节**：
1. `createRequire(import.meta.url).resolve(...)` —— 正是 §2.1 实测的 **pattern C**，linker-agnostic。
2. `optimizeDeps: { exclude: ['occt-wasm', 'web-ifc'] }`，注释：**"Both are Emscripten glue: running them through esbuild's dep optimizer corrupts the WASM import object, so serve them as native ESM instead."**

**抄什么 / 不抄什么**：

| 抄 | 不抄 |
|---|---|
| ✅ `createRequire(...).resolve()` + dev 中间件 + `writeBundle` 的 **wasmAssets 插件**（§8.3 直接采用） | ❌ **把 wasm 移出 git 再 `prepare` 下载**：brepjs 是 22MB+ 的自定义 OCCT 构建，有理由；faijs 用的 `occt-wasm` 是 npm 包，包管理器自己会装，额外下载脚本是净负担 |
| ✅ `optimizeDeps.exclude` 排除 Emscripten glue | ❌ **optional peerDependencies 表达可选内核**：faijs 的 `occt-wasm` 是硬依赖（BREP 链核心），不是可选插件 |
| ✅ **数据型 WASM 包**的布局（将来 faijs 若自带定制 OCCT 构建，直接照抄） | ❌ `release-please` / `size-limit` / `knip` / husky 整套 CI 工具链：faijs CI 是 `scripts/ci.ps1`，不引入新工具 |
| ✅ `paths` + `resolve.alias` 双层：tsconfig `paths` 只管类型，vite alias 管运行时 | ❌ `apps/docs` vitepress 站：faijs 的 demo 已够用 |

### 3.7 工程配置清单

| 项 | brepjs 做法 | faijs 采纳 |
|---|---|---|
| `.npmrc` | `access=public` / `provenance=true` / `save-exact=true` | 采纳 `save-exact=true`；`provenance` 待 publish 时再加（H5 禁止 publish） |
| 根 devDependencies | 全部上提到根（typescript / eslint / vitest / vite / puppeteer / prettier…），子包 devDeps 写 `"*"` | ✅ 采纳（§6） |
| TypeScript | 根 `tsconfig.json` 用 `moduleResolution: "bundler"` + `paths: { "@/*": ["./src/*"] }`；每个包自己的 `tsconfig.json` | ✅ 采纳，但 faijs 用**根 `paths` + project references**（§7.4） |
| 类型检查 | `tsgo --noEmit`（TypeScript 7 native preview） | ❌ 不采纳（faijs 用 `tsc --noEmit`） |
| 测试 | 根 `vitest.config.ts` 用 `projects` 按内核分片（occt-wasm / occt / brepkit），`pool: 'forks'`，`maxWorkers: 4` | 部分采纳：faijs 已有 BREP/mesh parity，改用 `projects` 分片可期（`module-runtime-plan` §4 已提） |
| 发布 | `release-please-config.json` + `plugins: ["node-workspace"]` + `separate-pull-requests: true`；每个包一个 `publish-*.yml` | 部分采纳：统一版本 + 逐包 `npm publish -w`（§11.3） |
| 死代码检查 | `knip` + 每 workspace 单独配置（`knip.config.ts` 的 `workspaces` 段，含 5 条 `ignoreDependencies` 理由注释） | 可选（§2.5） |

### 3.8 brepjs 与本项目的结构映射

| brepjs | faijs 对应 | 说明 |
|---|---|---|
| 根包 `brepjs`（src/ = 引擎 + 几何） | **`@faicad/faijs`（根，门面）** + **`packages/core`（引擎）** | faijs 多一层：几何必须外置（K2），所以根包退化成薄门面，引擎下沉到 `packages/core` |
| `packages/brepjs-bim` / `-sheetmetal`（域库） | **`packages/stdlib`（标准几何库）** | 关键差异：**bim/sheetmetal 是可选的，stdlib 是内置的**（每个脚本都用 `cad.*`）。这决定了 §4.5 的循环处理方式 |
| `packages/brepjs-cad`（域库 + CLI） | `packages/core/scripts`（faijs CLI 归引擎） | — |
| `apps/playground` | `packages/demo` | — |
| `packages/brepjs-opencascade`（wasm 数据包） | 不需要（用 npm 上的 `occt-wasm`） | — |
| 第三方库（仓库外的 `my-gear-lib`） | `packages/mech-lib` | brepjs 的第三方库在仓库外；faijs 需要**仓库内的第三方库样例**来做 M7 联动测试，所以入 workspace |

### 3.9 brepjs 事实核实清单（第 4 版新增：每条都给了可复核的出处）

> 上一版 §3 的描述**方向正确但缺少出处**。本表逐条回查 brepjs `18.119.2` 源码，供实施时直接对照。

| 结论 | 出处（brepjs 仓库内） | 核实结果 |
|---|---|---|
| 单 git 仓 + 11 workspace 成员 | `git remote -v` = `github.com/andymai/brepjs`；`package.json:24-36` 的 `workspaces` 数组 | ✅ 11 个（`packages/*` 9 个 + `apps/*` 2 个） |
| 根 `package.json` **自身就是主库** | `package.json:2-3`（`name: brepjs` / `version: 18.119.2`）+ `:37-39` 的 `main`/`module`/`types` 指向 `dist/` | ✅ 双重身份坐实 |
| `packageManager: npm@11.6.1`（**不用 pnpm**） | `package.json:23` | ✅ |
| 根包导出 **17 个子路径** | `package.json:40-207` | ✅ `.` `./core` `./result` `./vectors` `./topology` `./operations` `./2d` `./sketching` `./text` `./projection` `./query` `./measurement` `./io` `./worker` `./shapeRef` `./quick` `./kernel/occtWasm/occtWasmAdapter` |
| 域库把引擎声明为 **peer** | `packages/brepjs-bim/package.json:48-51`（`brepjs: ">=18.0.0"`, `web-ifc: ">=0.0.50"`） | ✅ |
| **唯一例外**：有 `bin` 的包用 `dependencies` | `packages/brepjs-cad/package.json`：`bin.brep` / `bin.brep-mcp` + `dependencies.brepjs: ">=18.117.1"` | ✅ 与本方案 §6.2 的取舍直接相关 |
| 子包 devDeps 写 `"*"` 从根 hoist | `packages/brepjs-bim/package.json:52-62`（`eslint: "*"`, `typescript: "*"`, `vite: "^8.0.0"` …） | ✅ 注意：**不是所有 devDep 都写 `"*"`**，vite/vitest 写了具体范围 |
| **引擎 external 是硬要求** | `packages/brepjs-bim/vite.config.ts:12-14`（`rollupOptions.external: ['brepjs','web-ifc']`） | ✅ 与 `module-runtime-plan.md` §4.2 逐字同构 |
| **免打包联动 = 消费端 alias 指向 src** | `vitest.config.ts:57-63`（注释原文：`node_modules/brepjs is a stale published copy; route to live src.`） | ✅ 本方案 §7.1 直接采用 |
| 另一种形态：`exports` 直接指 src | `packages/brepjs-manifold/package.json:30-35`（`exports["."] = { types: "./src/index.ts", default: "./src/index.ts" }`）+ `files: ["src","dist"]` | ✅ 该包**无 build 脚本** |
| 分层边界脚本四层 | `scripts/check-layer-boundaries.sh:7-11` + `get_layer()` `:25-34`；违规判据 `target_layer > src_layer`（`:116`） | ✅ 挂 `check:boundaries` / `:staged` / CI 三个入口 |
| wasm 用 `createRequire(...).resolve()` | `apps/playground/vite.config.ts:26-34`（`reactRequire.resolve('occt-wasm/dist/occt-wasm.js')`） | ✅ 正是 §2.1 实测的 pattern C |
| `optimizeDeps.exclude` 排除 Emscripten glue | `apps/playground/vite.config.ts:150-153`，注释：`running them through esbuild's dep optimizer corrupts the WASM import object` | ✅ |
| wasm 不进 git + `prepare` 下载 | `.gitignore:35-36`（`packages/brepjs-opencascade/src/*.wasm` 与 `.wasm-version`）+ `scripts/ensure-wasm.sh` + `package.json:254`（`"prepare": "husky && bash scripts/ensure-wasm.sh"`） | ✅ |
| **playground 没有 alias 到 brepjs src** | `apps/playground/vite.config.ts` 的 `resolve.alias` **只有** `react` / `react-dom`（`:154-159`），且 `dependencies.brepjs: "*"`；根包的 `dev` 是 `vite build --watch`（`package.json:214`） | ✅ 坐实"brepjs 只做到测试免打包，dev server 没做到" |
| 发布：`release-please` + 每包独立版本 | `.release-please-manifest.json`（根 18.119.2 / cad 0.103.0 / bim 0.3.1 / sheetmetal 0.3.0 / opencascade 0.16.0 / voxel-wasm 0.7.0）+ `release-please-config.json` | ✅ **版本不统一**，与本方案 §11.3 的"统一版本"取舍不同 |
| `.npmrc` 三行 | `.npmrc`：`access=public` / `provenance=true` / `save-exact=true`（另有一行注释掉的 `engine-strict`） | ✅ |
| 死代码检查 `knip` | `package.json:238`（`"knip": "knip"`）+ `knip.config.ts` | ✅ |

**从核实清单里新读出的两条**（上一版漏了，对 faijs 有影响）：

1. **brepjs 用 `release-please` 做逐包独立版本**（`.release-please-manifest.json` 证明），**不是**统一版本。faijs §11.3 选统一版本是因为可发布包只有 3–4 个且强耦合（core/stdlib/门面必须同版本才不出双实例），这是**有理由的偏离**，不是照抄失败 —— 但要在 §11.3 写明理由。
2. **brepjs 根包把 OCCT 声明为 optional peer + `peerDependenciesMeta.optional`**（`package.json:288-307`），因为它有多内核（occt / brepkit / manifold）。faijs 的 `occt-wasm` 是**硬依赖**（BREP 链核心，无替代内核），所以不抄这条 —— 与上一版判断一致，此处补上出处。

---

## 4. stdlib 切分的正确判据（本轮重写，上一版作废）

### 4.1 上一版错在哪

上一版把 `stdlib/compound.ts` 的 `applyTransform` / `solveFaceMate` 判为"核心数据模型"，理由是「`module-executor.ts:348` 真的调用了 `applyTransform`」。

**这个推理把"现状代码怎么写的"当成了"应该怎么写"。** 但 `engine-library-contract.md` §10.1 明确指出，`module-executor.ts:348` 那一段**正是要被消灭的病灶**：

> **现状病灶**（`compound.ts:200-248`）四步耦合在 `solveAssembly` 里：① `Object.assign` 原地改写 ② `exec.getSolid/setSolid` ③ `exec.dependentsOf` + 逐个下游 `Object.assign` ④ `exec.touch`。第 ③ 步是核心问题：**库在做 DAG 遍历，而 DAG 归引擎（F2）**。

正确做法是**改调用方**（引擎改为"标记 stale → 重算"），不是**搬被调用方**。

### 4.2 正确判据：K2 / K5 + contract §5 职责表

来自 `Faijs语言的思考.md` 第 13 条与 `engine-library-contract.md` §0.2 / §5：

| 判据 | 原文 | 含义 |
|---|---|---|
| **K2** | 「几何运算全部交给faijs语言库来实现，faijs引擎不内置」/「引擎不内置任何几何算法，也不实现任何几何函数。引擎只负责调度、记账、提供资源」 | **一切几何算法 → 库** |
| **K5** | 「parser/compile/runtime 不得按函数名分支，也不区分任何函数类别——**引擎里只有库函数**（faijs 自带标准库与第三方库没有类别之别）」 | 引擎**不认识** 30 个 stdlib 函数的名字 |
| §5.2 | 「**装配约束求解** ｜ 默认归属 **库** ｜ 纯计算（`compound.ts:136-153`）」 | **装配求解 = 库**（用户的纠错点，文档已明确） |
| §10.1 | 「应用变换到成员几何 ｜ **库** ｜ 产出新 Shape，不再原地改写」「找出下游并让其反映新变换 ｜ **引擎** ｜ 标记 stale → 重算」 | **`applyTransform` = 库**；引擎那半边是**重算**，不是调库 |
| §5.4 | 「Shape 构造器 ｜ **引擎** ｜ `import { solid, fromBrep } from '@faicad/faijs'`」 | **Shape 构造器 = 引擎**（它是记账，不是几何） |
| §7.2 | 「目标：构造器登记，库零记账」 | 同上 |

**一句话**：引擎 = 解析 + 校验 + 调度 + 记账 + 资源；库 = 一切几何。判别一个函数归谁，问的是"它是几何算法吗"，不是"现在谁在 import 它"。

### 4.3 逐文件归属表（`src/stdlib/` 全 22 个源文件）

| 文件 | 行数 | 归属 | 判据 |
|---|---|---|---|
| `compound.ts`（`group` / `assembly` / `solveFaceMate` / `applyTransform` / `FaceMateTransform`） | 283 | **stdlib** | §5.2「装配约束求解｜库」+ §10.1「应用变换到成员几何｜库」。**本轮更正：全部留在 stdlib** |
| `split.ts` | 242 | **stdlib** | 几何算法 |
| `engrave.ts` | 197 | **stdlib** | 几何算法 |
| `drill.ts` | 197 | **stdlib** | 几何算法（消费 `brepjs-mirror/threadFns`） |
| `screw.ts` | 156 | **stdlib** | 几何算法（消费 `brepjs-mirror/threadFns`） |
| **`shape.ts`** | 126 | **core** | **不是几何算法**：Shape 构造器（`solid` / `fromBrep` / `compound`）+ 身份 WeakSet + BREP 槽登记/查询（`getSlot` / `ensureSlot` / `hasBrep` / `brepOf`）。§5.4「Shape 构造器｜引擎」+ §7.2「构造器登记，库零记账」 |
| `boolean.ts` | 118 | **stdlib** | 几何算法 |
| `primitives.ts` | 100 | **stdlib** | 几何算法 |
| `transform.ts` | 92 | **stdlib** | 几何算法 |
| `geom.ts`（`faceCenter` / `faceNormal` / `bbox*`） | 92 | **stdlib** | 几何算法（查询也是几何） |
| `text.ts` | 85 | **stdlib** | 几何算法 |
| `load.ts` | 69 | **stdlib** | 几何算法（mesh/STEP 载入） |
| `assert.ts` | 67 | **stdlib** | §5.2「参数语义校验｜库」 |
| `svgExtrude.ts` | 63 | **stdlib** | 几何算法 |
| `copy.ts` | 62 | **stdlib** | 几何算法 |
| `extrude.ts` | 58 | **stdlib** | 几何算法 |
| `internal/svg-asset-resolver.ts` | 52 | **stdlib** | 服务于 `svgExtrude` |
| `reconcile.ts` | 44 | **stdlib** | 断链物化的库侧入口（`module-runtime-plan` §5.4/§5.6） |
| `knurl.ts` | 43 | **stdlib** | 几何算法（mesh-only op，断链触发 T1） |
| `sdf.ts` | 33 | **stdlib** | 几何算法 |
| `index.ts` | 31 | **stdlib** | 命名空间装配 |
| `asset.ts` | 20 | **stdlib** | 资产声明 |

**净结果**：`src/stdlib/` 里**只有 `shape.ts`（126 行 / 5%）上移到 core**，其余 95% 留在 stdlib —— 与上一版"拆两半"的说法完全不同，切分面极小。

**同时：随 stdlib 迁移的还有** `src/brep/brepjs-mirror/`。实测消费者只有三处：

```
src/stdlib/drill.ts:18  import { threadBrep } from '../brep/brepjs-mirror/threadFns'
src/stdlib/screw.ts:13  import { threadBrep } from '../brep/brepjs-mirror/threadFns'
src/stdlib/split.ts:23  } from '../brep/brepjs-mirror/joinery-brep'
```

`core` 侧对它的引用只有 `src/brep/index.ts:8` 的一行注释（"brepjs-mirror/: 从 brepjs 参考的操作实现"），非 import。
⚠️ `brepjs-mirror/` 自带的两个测试（`joinery-brep.test.ts`、`threadFns.test.ts`）**随之迁到 stdlib 包**，不能落在 core 里。

### 4.4 core → stdlib 的反向依赖：只剩两条真边

> **第 4 版复核**：以下计数**逐行核对通过**（`grep -rn "stdlib" src --include="*.ts"`，剔除 `*.test.ts` 与纯注释行）。
> 总量 **9 个文件 / 29 条 import 语句** —— 上一版这个数是**对的**，保留。
> 但下一节（§4.5）的"25 个 op"**是错的**，已改为 30。

实测当前 `src/`（排除 `stdlib/` 自身与 `*.test.ts`）对 stdlib 的 import 共 **9 个文件 / 29 处**（另有一处 `handle-bridge.ts:11` 的注释提及依赖约束，非 import）。按上表切分后：

| 位置 | import 什么 | 切分后 |
|---|---|---|
| `brep/handle-bridge.ts:17` | `fromBrep`（shape.ts） | ✅ 消失（shape 已在 core） |
| `cad-runtime/backend-dispatch.ts:19` | `hasBrep`（shape.ts） | ✅ 消失 |
| `cad-runtime/module-executor.ts:22` | `getSlot/hasBrep/brepOf/ensureSlot`（shape.ts） | ✅ 消失 |
| `cad-runtime/preview-exec.ts:19` | `getSlot/ensureSlot`（shape.ts） | ✅ 消失 |
| `cad-runtime/runtime.ts:47` | `isCompoundLike, getSlot`（shape.ts） | ✅ 消失 |
| `node-host/cli.ts:26` | `type CompoundShape`（shape.ts） | ✅ 消失 |
| `sdk.ts:35,42` | shape 构造器与类型 | ✅ 消失 |
| `browser.ts:106-107,110` | `solveFaceMate, applyTransform` 再导出 + `isCompoundLike` | ⚠️ 保留为**门面 → stdlib** 的单向边（浏览器/SDK 门面本就该在根包） |
| **`cad-runtime/internal-stdlib.ts:10-26`** | **17 行 / 30 个函数** | ❌ **边 E-a**，见 §4.5 |
| **`cad-runtime/module-executor.ts:24`** | **`applyTransform`** | ❌ **边 E-b**，见 §4.6 |

**前 7 行（7 个文件 / 8 条 import 语句，全是 `shape.ts`）全部消失** —— shape 上移进 core 后它们变成包内 import。剩下 3 行 = 两条真边（E-a / E-b）+ 一行合法的门面再导出。

### 4.5 边 E-a：`internal-stdlib.ts` 静态 import **30 个函数**

> **第 4 版更正**：上一版写「16 行，25 个 op」，**两个数字都不精确**。逐行点算 `src/cad-runtime/internal-stdlib.ts:10-26` 得 **17 行 import、30 个具名函数**。
> 「25」的来源应是 **30 − 5 个 geom 查询**（`faceCenter` / `faceNormal` / `bboxCenter` / `bboxMin` / `bboxMax`）—— 但 `asset` 也算进去了，所以 25 不是一个自洽的分类。本方案统一用 **30**，并在需要区分时写「30 个函数（其中 5 个是 geom 查询）」。

```ts
// src/cad-runtime/internal-stdlib.ts:10-26 —— 逐行点算：17 行 import / 30 个函数
:10  box, sphere, cylinder, cone, wedge                              (5)
:11  translate, rotate, scale                                        (3)  → 8
:12  extrude                                                         (1)  → 9
:13  knurl                                                           (1)  → 10
:14  sdf                                                             (1)  → 11
:15  text                                                            (1)  → 12
:16  screw                                                           (1)  → 13
:17  svgExtrude                                                      (1)  → 14
:18  load                                                            (1)  → 15
:19  drill                                                           (1)  → 16
:20  split                                                           (1)  → 17
:21  union, subtract, intersect                                      (3)  → 20
:22  engrave                                                         (1)  → 21
:23  group, assembly                                                 (2)  → 23
:24  copy                                                            (1)  → 24
:25  faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax            (5)  → 29   ← geom 查询
:26  asset                                                           (1)  → 30

export function createInternalStdlib(): StdlibNamespace { return { …30 个… } }
export function createNamespaces(libs?): Namespaces { return { ...(libs ?? {}), cad: createInternalStdlib() } }
```

这是 **K5（引擎零函数知识）** 的现存违反：引擎按名字把 30 个几何函数装配成 `cad` 命名空间。

> ⚠️ **与 `engine-library-contract.md` 的关系**：契约文档 §13 的 P0–P8 与实施手册第 1604 步都**保留**了 `createInternalStdlib()`（"导出列表不变"）。也就是说契约重构**不消除** E-a，只是把它原地保留。
> 本方案不推翻契约文档的结论，而是**把 E-a 这条边从"包内依赖"升级为"包间依赖"来管理**——见 §4.7 的解法。

**解法（三选一，推荐 E-a-1）**：

| 方案 | 做法 | 3d_editor 改动 | 评价 |
|---|---|---|---|
| **E-a-1（推荐）** | 把 `internal-stdlib.ts` 从 `packages/core` **搬到根门面包** `packages/faijs`。core 的 `createRuntime(ports, libs?)` 不再默认注入 `cad`；门面调用时注入 | **0 处** | brepjs 布局（根包即主库）。包图 DAG。代价：多一个可发布包 |
| E-a-2 | core 完全不绑定 `cad`；宿主显式 `import * as cad from '@faicad/faijs-stdlib'` + `runtime.registerLib('cad', cad)` | 每处 runtime 创建点 2 行 | 最贴合 K5「标准库与第三方库没有类别之别」；但需要每个宿主都记得注册 |
| E-a-3 | core 声明 stdlib 为 **optional peerDependency** 并在 `internal-stdlib.ts` 里 import | 0 处 | ❌ **不推荐**：形成 peer 循环（`faijs ↔ stdlib`），npm 能装但构建顺序未定义 |

**推荐 E-a-1**，理由：3d_editor 有 **279 处 `@faicad/faijs` 引用**（第 4 版实测 `grep -rn "@faicad/faijs" 3d_editor/src`，上一版写 267 已更正），任何要求改名或加注册的方案成本都远高于多一个薄门面包。

### 4.6 边 E-b：`module-executor.ts:24` import `applyTransform`

```ts
// src/cad-runtime/module-executor.ts:22-25
import { getSlot, hasBrep, brepOf, ensureSlot } from '../stdlib/shape'   // ← shape 上移后消失
import { applyTransform } from '../stdlib/compound'                       // ← 边 E-b
import { applyTransformBrep } from '../brep/brep-ops'

// :340-360（现状）
Object.assign(member, applyTransform(member, t.quaternion, t.pivot, t.translation, t.rotationMatrix))
const transformed = applyTransformBrep(kernel, solid, …)
ensureSlot(member).solid = transformed
const stale = this.computeDownstream(memberNames)   // ← 引擎自己的下游失效已经存在
```

**解法：按 `engine-library-contract.md` §10.1 把传播收归引擎 —— 不是搬 `applyTransform`。**

| 步骤 | 改动 |
|---|---|
| 1 | `module-executor.ts` 删掉 `applyTransform` import（`:24`）与 `:348` 的 `Object.assign` 原地改写 |
| 2 | 成员变换改为**重放**：把变换记录进 `AssemblyBehavior`，由引擎在 `executeFrom(staleIds)` 重算时施加（`:360` 的 `computeDownstream` 已是这个机制的雏形，扩展它即可） |
| 3 | BREP 侧的 `applyTransformBrep`（`brep/brep-ops`，**本就在 core**）随之走重算路径，不再手工 `ensureSlot` 覆盖 |
| 4 | 结果：`do_assemble` 变**幂等**（现在执行两次会叠加变换）—— 契约文档 §10.1 已标注这是"语义变化最大的一项"，需专项 e2e |

**这是 `engine-library-contract.md` P6 的工作，与本 monorepo 迁移正交但耦合**：E-b 不消除，`packages/core` 就会 import `packages/stdlib`，包图成环。因此 P4（stdlib 出包）**必须排在契约 P6 之后**，或采用 §10 的临时处理。

### 4.7 切分后的包图（DAG）

```
                    ┌──────────────────────────────────────┐
                    │  packages/core   @faicad/faijs-core  │
                    │  引擎：lang/ cad-runtime/ mesh/       │
                    │  brep/（除 brepjs-mirror）/ topology/ │
                    │  boolean/ primitives/ sdf/           │
                    │  occt-kernel/ node-host/ browser-host│
                    │  faqts/ module-resolver/ assets/     │
                    │  + shape.ts（从 stdlib 上移）         │
                    │  + sdk.ts / index.ts / browser.ts    │
                    └───────────────▲──────────────────────┘
                                    │ peerDependencies
                    ┌───────────────┴──────────────────────┐
                    │  packages/stdlib @faicad/faijs-stdlib│
                    │  几何库：25 op + compound/assembly   │
                    │  + brep/brepjs-mirror/               │
                    └───────────────▲──────────────────────┘
                                    │ dependencies
                    ┌───────────────┴──────────────────────┐
                    │  根  @faicad/faijs（门面，brepjs 布局）│
                    │  re-export core + stdlib              │
                    │  + internal-stdlib.ts（cad 绑定）      │
                    └───────────────▲──────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
  packages/demo            packages/tests              packages/mech-lib
  (private)                (private)                   (可发布，第三方库样例)
        │                           │                           │
        └─────────────► packages/fixtures (private，.faijs/.step/.svg 数据)
```

**DAG 验证**：`faijs → stdlib → core`，`demo/tests/mech-lib → faijs`，`* → fixtures`。无环。

**关于 M6 的命名取舍**（需知悉，不必再裁）：用户原话是"这些包**引用主的 faijs 库**"。上图中 stdlib 引用的是 `@faicad/faijs-core`（引擎包）而非 `@faicad/faijs`（门面包）。这是**必需的**——如果 stdlib 引用门面，而门面又引用 stdlib，就成环。取舍说明：

- "主 faijs 库"在本方案里 = **`@faicad/faijs` 这个包名**（3d_editor / 外部用户的唯一入口，279 处引用不变）；
- stdlib 引用的是它的**引擎层** `@faicad/faijs-core`，这是同一主库的内部拆分，不是另一个项目；
- 若坚持字面（stdlib 必须引用名为 `@faicad/faijs` 的包），则必须走 E-a-2（宿主显式注册 `cad`），代价是 3d_editor 的每处 runtime 创建点加 2 行。

---

## 5. 目标结构

> **第 4 版更正**：`packages/core/src/` 的目录清单按 `ls src/` 实测重写。
> 上一版列了 **`ops/`**（不存在，已拆为 `boolean/` `primitives/` `sdf/`），并**漏掉**了 `faqts/` `module-resolver/` `assets/` `test/`。
> 完整实测清单（204 个 `.ts`）：`assets`(fonts) `boolean` `brep` `browser-host` `cad-runtime` `faqts` `lang` `mesh` `module-resolver` `node-host` `occt-kernel` `primitives` `sdf` `stdlib` `test`(blob-store.ts) `topology` + 根级 `index.ts` `browser.ts` `node.ts` `csg.ts` `sdf.ts` `sdk.ts` `identity.ts` `runtime-state.ts` `test-helpers.ts`。

```
faijs/                                   ← 单 git 仓库
├── package.json                         ← 双重身份：workspace 根 + 门面包 `@faicad/faijs`
├── pnpm-workspace.yaml                  ← ❌ 不需要（npm 用 package.json 的 workspaces 数组）
├── package-lock.json                    ← 唯一锁文件（删除 demo/package-lock.json）
├── tsconfig.json                        ← 根：paths + references（typecheck 免 build）
├── tsconfig.build.json                  ← 各包构建配置
├── eslint.config.mjs                    ← 根：覆盖全部包 + import/no-extraneous-dependencies
├── vitest.config.ts                     ← 根：resolve.alias 指向各包 src（M7 核心）
├── .npmrc                               ← save-exact=true
├── docs/                                ← 架构契约是仓库级，留在根
├── scripts/                             ← 仓库级脚本（ci.ps1 / ci.sh / gen-api-dts.ts）
│
├── packages/
│   ├── core/                            ← @faicad/faijs-core（引擎，可发布）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/                         ← git mv 自根 src/（保留历史）
│   │   │   ├── lang/          ← 解析/校验/编译
│   │   │   ├── cad-runtime/   ← 执行器、分派、预览
│   │   │   ├── mesh/ primitives/ sdf/ boolean/
│   │   │   ├── brep/          ← 不含 brepjs-mirror/（后者随 stdlib 走）
│   │   │   ├── occt-kernel/ topology/
│   │   │   ├── node-host/ browser-host/
│   │   │   ├── faqts/ module-resolver/ assets/ test/
│   │   │   ├── shape.ts       ← 从 stdlib 上移（§4.3）
│   │   │   ├── index.ts browser.ts node.ts csg.ts sdf.ts sdk.ts
│   │   │   │                 ← 根级门面文件随 core 走，根包的 src/ 只做薄 re-export
│   │   │   └── **/*.test.ts   ← 单元/逻辑测试随源码走（AGENTS.md 现状）
│   │   └── scripts/           ← faijs-cli.ts / gen-symbol-table.ts
│   │
│   ├── stdlib/                          ← @faicad/faijs-stdlib（几何库，可发布）
│   │   ├── package.json                 ← peerDependencies: { "@faicad/faijs-core": "^0.5.8" }
│   │   ├── tsconfig.json
│   │   └── src/                         ← 现 src/stdlib/（除 shape.ts）+ src/brep/brepjs-mirror/
│   │
│   ├── demo/                            ← @faicad/faijs-demo（private）
│   │   ├── package.json                 ← 依赖 "@faicad/faijs": "*"
│   │   ├── vite.config.ts               ← resolve.alias 指向各包 src + wasmAssets 插件
│   │   ├── e2e/ examples/ assets/       ← playwright + 示例
│   │   └── main.ts index.html style.css ← ⚠️ demo **没有 src/ 子目录**，main.ts 在包根
│   │
│   ├── mech-lib/                        ← @faicad/mech-lib（第三方库样例，可发布但 H5 禁 publish）
│   │   ├── package.json                 ← dependencies: { "brepjs": "18.119.2" }（⚠️ 第 4 版更正，见 §6.5）
│   │   └── src/                         ← 现 test/faijs/libs/ 全 7 个文件
│   │                                      （mock-mech-brep.ts / mock-mech-mesh.ts / brepjs-gear.ts
│   │                                        + 4 个 *.test.ts）
│   │
│   ├── fixtures/                        ← @faicad/faijs-fixtures（private，纯数据）
│   │   └── *.step, *.stl, *.3mf, svg/   ← 现 test/fixtures/ 全 5 项（⚠️ 不是 test/ 根）
│   │
│   └── tests/                           ← @faicad/faijs-tests（private，集成测试）
│       ├── faijs/                       ← 现 test/faijs/*.test.ts
│       └── vitest.config.ts
│
└── src/                                 ← 根门面的薄 src（仅 re-export + cad 绑定）
    ├── index.ts                         ← re-export @faicad/faijs-core + @faicad/faijs-stdlib
    ├── browser.ts                       ← 浏览器门面（含 §4.4 那 3 条 compound/shape 再导出）
    ├── node.ts
    ├── csg.ts
    ├── sdf.ts
    ├── sdk.ts                           ← 第三方库 SDK 入口（零 heavy 依赖守卫）
    ├── faqts/                           ← faqts 子路径（3 个：. / node / browser）
    ├── module-resolver/
    ├── stdlib/index.ts                  ← ./stdlib 子路径
    └── cad-runtime/internal-stdlib.ts   ← 从 core 搬来（E-a-1）
```

> ⚠️ **根包必须复刻现状的全部 11 个 exports 子路径**（第 4 版更正，见 §6.1）：`.` `./browser` `./csg` `./sdf` `./stdlib` `./node` `./faqts` `./faqts/node` `./faqts/browser` `./module-resolver` `./sdk`。
> 其中 `faqts/*` 与 `module-resolver` 是 Phase B–D 新增的，上一版的"7 个子路径"漏了它们 —— 若照上一版做，**3d_editor 与 demo 的这 4 条 import 会直接断**。

**为什么 `docs/` 留根**：架构契约是仓库级的（`AGENTS.md` 的文档地图指向 `docs/`），且 §头部提到的专利约束要求"语言核心思想"文档不进 faijs 仓 —— 集中放根便于管控。

**为什么 `scripts/` 分两处**：`faijs-cli.ts` / `gen-symbol-table.ts` 随 `src/` 进 `packages/core/scripts/`（它们的相对导入指向同包源码）；`ci.ps1` / `ci.sh` / `gen-api-dts.ts` / `bump-version.mjs` 是**仓库级**的，留根。
⚠️ `fix-import-extensions.mjs` 被**多个包**调用，必须留根并**参数化**（§11.2）。

---

## 6. 各包的 `package.json` 契约

### 6.1 根（`package.json`）→ `@faicad/faijs`

> **第 4 版更正**：版本号 `0.5.4` → **`0.5.8`**（`package.json:3`）；`exports` 从"7 个"改为 **11 个**；`dependencies` 按现状**逐字**列全（现状根包 dependencies 有 7 个：acorn / manifold-3d / occt-wasm / opentype.js / sucrase / three + 迁移后新增的两个 workspace 包）。

```jsonc
{
  "name": "@faicad/faijs",
  "version": "0.5.8",
  "private": false,
  "type": "module",
  "workspaces": [
    "packages/core",       // 1. 引擎，无内部依赖
    "packages/stdlib",     // 2. 依赖 core
    "packages/mech-lib",   // 3. 依赖 core + brepjs
    "packages/fixtures",   // 4. private 数据包
    "packages/tests",      // 5. 依赖上面全部
    "packages/demo"        // 6. private，最后
  ],                       // ⚠️ 顺序即构建顺序，必须按拓扑手写（§2.4）
  "exports": {
    // ⚠️ 必须与现状逐字一致 —— 实测 11 个键，上一版写"7 个"漏了 faqts/* 与 module-resolver
    ".":                 { "types": "./dist/index.d.ts",            "import": "./dist/index.js" },
    "./browser":         { "types": "./dist/browser.d.ts",          "import": "./dist/browser.js" },
    "./csg":             { "types": "./dist/csg.d.ts",              "import": "./dist/csg.js" },
    "./sdf":             { "types": "./dist/sdf.d.ts",              "import": "./dist/sdf.js" },
    "./stdlib":          { "types": "./dist/stdlib/index.d.ts",     "import": "./dist/stdlib/index.js" },
    "./node":            { "types": "./dist/node.d.ts",             "import": "./dist/node.js" },
    "./faqts":           { "types": "./dist/faqts/index.d.ts",      "import": "./dist/faqts/index.js" },
    "./faqts/node":      { "types": "./dist/faqts/node.d.ts",       "import": "./dist/faqts/node.js" },
    "./faqts/browser":   { "types": "./dist/faqts/browser.d.ts",    "import": "./dist/faqts/browser.js" },
    "./module-resolver": { "types": "./dist/module-resolver/index.d.ts", "import": "./dist/module-resolver/index.js" },
    "./sdk":             { "types": "./dist/sdk.d.ts",              "import": "./dist/sdk.js" }
  },
  "dependencies": {
    "@faicad/faijs-core": "^0.5.8",
    "@faicad/faijs-stdlib": "^0.5.8",
    "acorn": "^8.18.0",
    "manifold-3d": "^3.5.1",
    "occt-wasm": "3.7.0",
    "opentype.js": "^1.3.4",
    "sucrase": "^3.35.1",
    "three": "^0.184.0"
  },
  "scripts": {
    "build": "npm run build -w @faicad/faijs-core && npm run build -w @faicad/faijs-stdlib && npm run build:facade",
    "build:facade": "tsc -p tsconfig.build.json && node scripts/fix-import-extensions.mjs",
    "typecheck": "tsc -b --verbose",
    "test": "vitest run",
    "lint": "eslint packages src",
    "pack": "npm run build && npm pack"      // ⚠️ 不能用 -w，根包自己不在 workspaces 数组里
  }
}
```

> ⚠️ `build` 里显式列出顺序是**必需的**：`npm run build --workspaces` 按数组顺序跑，而根包自己不在数组里，所以根包必须最后单独调（见 §2.4）。
>
> ⚠️ **`pack` 不能用 `npm pack -w @faicad/faijs`**（上一版写错了）：`-w` 只对 `workspaces` 数组成员生效，根包不在其中。现状是 `"pack": "npm run build && npm pack"`，**保持不变即可**——但它依赖下面 §6.2 的 `prepack`/`prepare` 处理。

### 6.2 `packages/core/package.json` → `@faicad/faijs-core`

```jsonc
{
  "name": "@faicad/faijs-core",
  "version": "0.5.8",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":       { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./sdk":   { "types": "./dist/sdk.d.ts",   "default": "./dist/sdk.js" },
    "./csg":   { "types": "./dist/csg.d.ts",   "default": "./dist/csg.js" },
    "./sdf":   { "types": "./dist/sdf.d.ts",   "default": "./dist/sdf.js" },
    "./node":  { "types": "./dist/node.d.ts",  "default": "./dist/node.js" },
    "./browser": { "types": "./dist/browser.d.ts", "default": "./dist/browser.js" }
  },
  "files": ["dist"],
  "dependencies": {
    "acorn": "^8.18.0",
    "manifold-3d": "^3.5.1",
    "opentype.js": "^1.3.4",
    "sucrase": "^3.35.1",
    "three": "^0.184.0"
  },
  "peerDependencies": {
    "occt-wasm": "3.7.0"        // ⚠️ 第 4 版新增：见下方「OCCT 单一实例」说明
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json && node ../../scripts/fix-import-extensions.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src",
    "gen:symbols": "npx tsx scripts/gen-symbol-table.ts"
  }
}
```

**要点**：

- **`prepare` 与 `prepack` 必须一起处理**（第 4 版更正 C15）。现状根 `package.json` 里**两个都有**，且都跑 build：
  ```jsonc
  "prepack": "npm run build",   // ← npm pack 时触发
  "prepare":  "npm run build"   // ← npm install 时触发（workspace 下会炸）
  ```
  迁移后：
  | 包 | `prepare` | `prepack` | 理由 |
  |---|---|---|---|
  | 根 `@faicad/faijs` | **删** | **保留**（`npm run build` + 依赖包已构建） | `npm pack` 要产物；`prepare` 在 install 时会因 core 未构建而炸 |
  | `core` / `stdlib` | **删** | **删** | 构建顺序由根脚本显式编排（§2.4），包级钩子会造成重复构建 |
  | `mech-lib` | 删 | 保留 | 同根包（要 pack） |
  - 只改 `prepare` 而留 `prepack` 在根包是**可以的**（根包在 install 时不会被 npm 触发 `prepare`？—— **实测需确认**，见 P0 验收项）。保守做法：根包保留 `prepack`，**删掉 `prepare`**。
- `three` **保持 dependencies 身份不变**。第 4 版更正证据：three 不只被 `brep/brep-ops.ts:17` 用到，而是散布在 `boolean/cross-section.ts:17`、`boolean/geo-convert.ts:8`、`boolean/extrude-helpers.ts:16`、`boolean/deriveNormals.ts:1`、`brep/brepjs-mirror/joinery-brep.ts:19` 及多个 test。抽包后**必须显式列进 `packages/core` 的 `dependencies`**，不能靠根 hoisting 偷渡（§2.5 幽灵依赖）。
  > 注意：`brepjs-mirror/` 随 stdlib 走（§4.3），所以 **stdlib 也要声明 `three`**。
- `worker-csg-backend.ts:30` / `worker-sdf-backend.ts:27` 的 `new Worker(new URL('./csg-worker.js', import.meta.url), {type:'module'})` —— 源码模式处理见 §7.5。
- **根级 `overrides: { "occt-wasm": "3.7.0" }` 留在根 `package.json`**（现状已在根），workspace 下 `overrides` **只在根生效**，子包写无效。

#### ⚠️ OCCT 单一实例：`occt-wasm` 必须声明为 peer（第 4 版新增的一节）

**为什么**：`grep` 实测 `stdlib` 与 `brep/brepjs-mirror/` **都直接 import `occt-wasm`**（见上方 §6.3 证据）。如果 core 与 stdlib 各自把它放进 `dependencies`，npm 在极端情况下（版本范围不一致 / hoisting 被打破）会装**两份 wasm**——而 `module-runtime-plan.md` §4.2 明确写过：

> 若把 SDK 打进库里，`isShape` 会读另一份 WeakSet，**OCCT 句柄会落在另一个 wasm 实例**。globalThis 状态锚点只能救 Shape 身份，**救不了 OCCT 句柄**。

**处理**（brepjs 同构，但去掉 `optional`）：

| 包 | `occt-wasm` 的声明方式 | 理由 |
|---|---|---|
| 根 `@faicad/faijs` | **`dependencies`**（唯一的实际安装点） | 现状就在 dependencies；根装一份，hoist 给全树 |
| `core` | **`peerDependencies`**（**非 optional**） | core 是唯一初始化 wasm 的地方 |
| `stdlib` | **`peerDependencies`**（非 optional） | stdlib 直接用它做 BREP 布尔/螺纹 |
| `mech-lib` | **`peerDependencies`**（非 optional） | brepjs adapter 复用 faijs 的 wasm 实例（§6.5） |

**与 brepjs 的差异要写明**：brepjs 把 `occt-wasm` 声明为 **optional peer**（`peerDependenciesMeta.optional`，根 `package.json:294-307`），因为它有多内核（occt / brepkit / manifold）可切换。faijs **没有替代内核**（BREP 链核心），所以是**硬 peer**，不加 `optional`。

**守卫（CI 必加）**：
```bash
npm ls occt-wasm --workspaces   # 断言：只出现一个版本，且无 nested 副本
```
以及 §7.3 demo vite 配置里 `resolve.dedupe` 必须包含 `occt-wasm` 与 `three`（**现状只 dedupe 了 `occt-wasm`**，`three` 是新增项）。

### 6.3 `packages/stdlib/package.json` → `@faicad/faijs-stdlib`

```jsonc
{
  "name": "@faicad/faijs-stdlib",
  "version": "0.5.8",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":         { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    // 不再需要 `./stdlib` 子路径：包自身已叫 stdlib，根门面的 `@faicad/faijs/stdlib`
    // 直接 re-export 本包即可（§5 根 src/stdlib/index.ts）
  },
  "files": ["dist"],
  "peerDependencies": {
    "@faicad/faijs-core": "^0.5.8",   // ← brepjs 模式，保证单一实例
    "occt-wasm": "^3.7.0"             // ⚠️ 必须 peer：wasm 实例只能有一份
  },
  "dependencies": {
    "three": "^0.184.0"               // ⚠️ 第 4 版实测：brepjs-mirror/joinery-brep.ts:19 用到
  },
  "devDependencies": {
    "@faicad/faijs-core": "*",       // workspace 内解析到本地
    "@types/node": "*", "typescript": "*", "vitest": "*"     // 从根 hoist
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json && node ../../scripts/fix-import-extensions.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  }
}
```

### 6.4 `packages/demo/package.json`（private）

```jsonc
{
  "name": "@faicad/faijs-demo",
  "private": true,
  "type": "module",
  "dependencies": {
    "@faicad/faijs": "*",        // workspace 内 → symlink 到根门面
    "three": "*", "occt-wasm": "*", "manifold-3d": "*"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test:e2e": "playwright test",
    "test:e2e:preview": "playwright test --config playwright.preview.config.ts"
  }
}
```

**删除**：`demo/package-lock.json`、**`demo/node_modules/`**（第 4 版补：实测已存在，内含指向 tarball 解压产物的 `@faicad/faijs`）、`demo/package.json` 里的 `file:../faicad-faijs-x.y.z.tgz`。

### 6.5 `packages/mech-lib` / `packages/tests` / `packages/fixtures`

> **第 4 版更正（C4）**：上一版把根 `devDependencies.brepjs` 判为"死依赖，直接删"。**这是错的**。
> 实测 `grep -rn "from 'brepjs'" src test demo` 命中 **3 处**，全部在 `test/faijs/libs/`：
> ```
> test/faijs/libs/brepjs-gear.ts:32            } from 'brepjs'
> test/faijs/libs/brepjs-gear.test.ts:23       import { makeExternalGear } from 'brepjs'
> test/faijs/libs/c3-brepjs-scenario.test.ts:34 import { makeExternalGear } from 'brepjs'
> ```
> `brepjs-gear.ts` 是 `module-runtime-plan.md` §6 的 **C1 brepjs 兼容层 adapter fixture**，是"第三方库样例"这个需求（M5）的核心用例之一。**正确做法是让它随 `mech-lib` 出包并下沉为该包的 dependency，不是删除。**

`test/faijs/libs/` 实测 **7 个文件**，全部进 `packages/mech-lib/src/`：

| 文件 | 性质 | 外部依赖 |
|---|---|---|
| `mock-mech-brep.ts` | B4 fixture：第三方库（BREP 版） | `@faicad/faijs/sdk` |
| `mock-mech-mesh.ts` | B4 fixture：第三方库（mesh 版） | `@faicad/faijs/sdk` |
| `brepjs-gear.ts` | **C1 fixture：brepjs adapter** | **`brepjs`** + faijs SDK |
| `brepjs-gear.test.ts` | 测试 | `brepjs` |
| `c3-brepjs-scenario.test.ts` | 测试 | `brepjs` |
| `b7-no-face-evolution.test.ts` | 测试 | — |
| `mock-lib.test.ts` | 测试 | — |

| 包 | name | private | 依赖 |
|---|---|---|---|
| mech-lib | `@faicad/mech-lib` | false（但 H5 禁 publish） | `peerDependencies: { "@faicad/faijs-core": "^0.5.8", "occt-wasm": "^3.7.0" }`<br>`dependencies: { "brepjs": "18.119.2" }`<br>`devDependencies: { "vitest": "*" }` |
| tests | `@faicad/faijs-tests` | true | `@faicad/faijs: "*"` / `@faicad/mech-lib: "*"` / `@faicad/faijs-fixtures: "*"` |
| fixtures | `@faicad/faijs-fixtures` | true | 无（纯数据） |

`mech-lib` **不依赖 `@faicad/faijs`（门面）**，只依赖 core —— 对应 `engine-library-contract.md` §11.1 的层次表（L4 依赖宿主包，L2/L1 不依赖）。

> ⚠️ **`brepjs` 是 9MB 的重依赖，但它只被 `mech-lib` 用**。出包后它从根 `devDependencies` 下沉到 `packages/mech-lib/dependencies` —— 这样 `npm install` 的**根依赖树变干净**，且任何一个不跑 brepjs 场景的开发者/CI job 都不会被它拖累（可用 `npm install --workspace=@faicad/mech-lib --include-workspace-root` 精确控制）。
> 这比上一版"直接删掉"更正确：**删了会炸 C1 回归测试**。

---

## 7. 免打包联动（M7）

### 7.1 机制：消费端 `resolve.alias`（brepjs 已验证，§3.4）

**三条解析路径，全部绕开 `dist/`：**

| 场景 | 机制 | 配置文件 |
|---|---|---|
| vitest（全部包） | `resolve.alias`：`@faicad/faijs` → `<root>/src/index.ts`，`@faicad/faijs-core` → `packages/core/src/index.ts`，`@faicad/faijs-stdlib` → `packages/stdlib/src/index.ts` | 根 `vitest.config.ts` |
| vite dev（demo） | 同上 alias + `optimizeDeps.exclude` + `server.watch.ignored` 反选 | `packages/demo/vite.config.ts` |
| TypeScript | 根 `tsconfig.json` 的 `paths` + project `references` | 根 `tsconfig.json` |

### 7.2 根 `vitest.config.ts`

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const r = (p: string) => resolve(__dirname, p)

export default defineConfig({
  resolve: {
    alias: {
      // 与 brepjs vitest.config.ts 同构：bare specifier → 活源码，不经 dist。
      '@faicad/faijs':        r('src/index.ts'),
      '@faicad/faijs-core':   r('packages/core/src/index.ts'),
      '@faicad/faijs-stdlib': r('packages/stdlib/src/index.ts'),
      '@faicad/mech-lib':     r('packages/mech-lib/src/index.ts'),
      '@faicad/faijs-fixtures': r('packages/fixtures'),
    },
  },
  test: {
    projects: ['packages/core', 'packages/stdlib', 'packages/tests'],
    testTimeout: 120_000,                       // AGENTS.md：几何运算慢
    pool: 'forks',                              // brepjs 同款：避免 wasm 线性内存跨文件累积
    maxWorkers: 4,
  },
})
```

### 7.3 `packages/demo/vite.config.ts`（增量部分）

在现有配置上**追加**三项（不删现有 CDN external 逻辑）：

```ts
export default defineConfig({
  resolve: {
    // 第 4 版更正：现状 demo/vite.config.ts **只有** `dedupe: ['occt-wasm']`（已实测）。
    // `three` 与 `manifold-3d` 是新增项——抽包后 core 与 stdlib 各自声明 three，
    // 不 dedupe 会出现两份 three（instanceof 判定失效）。
    dedupe: ['occt-wasm', 'three', 'manifold-3d'],
    alias: {
      '@faicad/faijs':        resolve(__dirname, '../../src/index.ts'),
      '@faicad/faijs-core':   resolve(__dirname, '../core/src/index.ts'),
      '@faicad/faijs-stdlib': resolve(__dirname, '../stdlib/src/index.ts'),
    },
  },
  optimizeDeps: {
    exclude: [
      '@faicad/faijs', '@faicad/faijs-core', '@faicad/faijs-stdlib',  // 源码包不预打包
      'occt-wasm', 'manifold-3d',                                     // brepjs：Emscripten glue 经 esbuild 会损坏
    ],
    esbuildOptions: { target: 'esnext' },                             // 现状已有，保留
  },
  server: {
    port: 8899,
    watch: {
      // pnpm/npm workspace 包是 node_modules 下的 symlink，Vite 默认忽略 node_modules；
      // 必须显式反选才能对引擎源码改动触发 HMR。
      ignored: ['!**/node_modules/@faicad/**'],
    },
  },
  plugins: [cdnExternalPlugin(), wasmAssets()],   // wasmAssets 见 §8.3
})
```

> `optimizeDeps.exclude` 三条缺一不可：esbuild 预打包会把 TS 源码编译成**冻结快照**，改动不再生效 —— 那 M7 就白做了。

### 7.4 TypeScript：免 build 的 typecheck

根 `tsconfig.json`（solution 风格）：

```jsonc
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/stdlib" },
    { "path": "./packages/tests" },
    { "path": "./packages/demo" },
    { "path": "." }              // 根门面
  ],
  "compilerOptions": {
    "paths": {
      "@faicad/faijs":            ["./src/index.ts"],
      "@faicad/faijs-core":       ["./packages/core/src/index.ts"],
      "@faicad/faijs-stdlib":     ["./packages/stdlib/src/index.ts"],
      "@faicad/mech-lib":         ["./packages/mech-lib/src/index.ts"],
      "@faicad/faijs-fixtures/*": ["./packages/fixtures/*"]
    }
  }
}
```

每个包的 `tsconfig.json` 设 `"composite": true` + `"declaration": true`，`references` 指向依赖包。这样 `tsc -b` 在没有 `dist/` 的干净工作区也能通过。

### 7.5 硬骨头：Worker URL 在源码模式下会断

```ts
// packages/core/src/browser-host/worker-csg-backend.ts:30
new Worker(new URL('./csg-worker.js', import.meta.url), { type: 'module' })
// packages/core/src/browser-host/worker-sdf-backend.ts:27
new Worker(new URL('./sdf-worker.js', import.meta.url), { type: 'module' })
```

**问题**：源码模式下磁盘上是 `csg-worker.ts`，`.js` 字面量指向不存在的文件。

**解法**：源码写 `.ts` 字面量，构建期由脚本重写回 `.js`。

1. 源码改为 `new URL('./csg-worker.ts', import.meta.url)`；
2. 扩展 `scripts/fix-import-extensions.mjs`：它现在只重写 `from '...'` / `import('...')`，**增加一条规则**重写 `new URL('./x.ts', import.meta.url)` → `new URL('./x.js', import.meta.url)`（同步处理 `worker-sdf-backend.ts`）；
3. `tsc` 不需要感知（字符串字面量，不影响类型）；
4. 加一条守卫测试：扫描 `packages/core/src/**` 断言 `new URL('./...js', import.meta.url)` 在**源码**中零出现。

> 不用 Vite 的 `?worker` 私有语法 —— 它会破坏 demo 的 importmap/CDN external 场景（现状 `demo/vite.config.ts` 的 `worker: { format: 'es' }` 依赖普通 worker 文件）。

### 7.6 各场景"免打包"达成矩阵

| 场景 | 免打包 | 依赖机制 |
|---|---|---|
| demo `npm run dev -w @faicad/faijs-demo`（vite serve） | ✅ | alias + `optimizeDeps.exclude` + watch 反选 |
| demo `npm run test:e2e`（playwright + vite dev） | ✅ | 同上（webServer 起的是 dev server） |
| 跨包单测 `npm run test --workspaces` | ✅ | vitest alias |
| 全仓 `npm run typecheck` | ✅ | tsconfig `paths` + `references` |
| 全仓 `npm run lint` | ✅ | 根 eslint flat config |
| CLI `npx tsx packages/core/scripts/faijs-cli.ts run x.faijs` | ✅ | tsx 直接跑 TS，从来不需要 build |
| demo `npm run build -w @faicad/faijs-demo`（发布产物） | ❌ 需要 dist | 符合预期 —— 发布必须走编译产物 |
| `npm run pack`（给 3d_editor 的 tarball） | ❌ 需要 dist | 符合预期 —— 根包不在 `workspaces` 数组里，`-w` 选不中它 |
| `npm run test:e2e:preview`（CDN/importmap 路径） | ❌ 需要 dist | 符合预期，本来就是验证产物路径 |

---

## 8. WASM 处理

### 8.1 三处需要处理的位置

| # | 位置 | 问题 | 处理 |
|---|---|---|---|
| 1 | `src/occt-kernel/occtKernel.ts:75`（迁后 `packages/core/src/occt-kernel/occtKernel.ts`） | 4 层 `..` 猜测**今天已失效**，靠 `:79` candidates 里的 `process.cwd()` 兜底侥幸可用 | §8.2 |
| 2 | `demo/main.ts:503, 513`（⚠️ 第 4 版核实行号；`demo/` 无 `src/`） | 硬编码 `/node_modules/...`（dev）/ jsdelivr（prod） | §8.3 |
| 3 | `manifold-3d` 的 wasm（`src/mesh/manifold-loader.ts`） | 走 `import.meta.url` 自解析，**pnpm/npm 都正常**（§2.1 实测），无需改 | 保持 |

### 8.2 Node 侧：改为 linker-agnostic

```ts
// packages/core/src/occt-kernel/occtKernel.ts
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)

export function resolveOcctWasmPath(): string {
  // 走 package exports：与 cwd / hoisting / linker 全部无关（§2.1 实测 pattern C）
  return require_.resolve('occt-wasm/dist/occt-wasm.wasm')
}
```

`occt-wasm@3.7.0` 的 `package.json` 确实导出了 `"./dist/occt-wasm.wasm": "./dist/occt-wasm.wasm"`（已实测），所以 `require.resolve` 可用。ESM 环境下若需纯 ESM 回退，用 `import.meta.resolve('occt-wasm/dist/occt-wasm.wasm')`。

### 8.3 浏览器侧：照抄 brepjs 的 `wasmAssets()` 插件

在 `packages/demo/vite.config.ts` 增加（结构直接来自 brepjs `apps/playground/vite.config.ts`）：

```ts
import { createRequire } from 'node:module'
import { createReadStream, existsSync, mkdirSync, copyFileSync } from 'node:fs'
const require_ = createRequire(import.meta.url)

function wasmFileMap(): Record<string, string> {
  const occtDir = dirname(require_.resolve('occt-wasm/dist/occt-wasm.js'))
  const manifoldDir = dirname(require_.resolve('manifold-3d/manifold.js'))
  return {
    'occt-wasm.wasm': resolve(occtDir, 'occt-wasm.wasm'),
    'manifold.wasm':  resolve(manifoldDir, 'manifold.wasm'),
  }
}

function wasmAssets(): Plugin {
  const files = wasmFileMap()
  return {
    name: 'wasm-assets',
    configureServer(server) {
      server.middlewares.use('/wasm', (req, res, next) => {
        const filePath = files[(req.url?.slice(1) ?? '')]
        if (!filePath || !existsSync(filePath)) return next()
        res.setHeader('Content-Type', 'application/wasm')
        createReadStream(filePath).pipe(res)
      })
    },
    writeBundle({ dir }) {
      if (!dir) return
      const out = resolve(dir, 'wasm')
      mkdirSync(out, { recursive: true })
      for (const [file, src] of Object.entries(files)) {
        if (existsSync(src)) copyFileSync(src, resolve(out, file))
      }
    },
  }
}
```

`main.ts` 侧对应改为：`'/wasm/occt-wasm.wasm'` / `'/wasm/manifold.wasm'`（dev 与 build 走同一路径，不再依赖 `node_modules` 的物理位置）。CDN 分支（prod）保持不变。

> brepjs 还给 dev 中间件加了 COEP/COOP 头（`Cross-Origin-Embedder-Policy: require-corp`）—— 那是为 `SharedArrayBuffer`（web-ifc 需要）。faijs 不需要 SAB，**不加**，避免与 demo 现状冲突。

### 8.4 P-0 验收：修的是既存 bug

`occtKernel.ts:75` 的失效是**当前代码就有的 bug**，与 monorepo 无关。因此单列 P-0 阶段（§10），独立提交、独立回滚。

验收判据：在 **3 个不同 cwd**（仓库根 / `packages/core` / `packages/tests`）下各跑一次 `initOcctWasm()` 均成功。**这条测试在当前代码下会失败**（因为 `:79` 的兜底依赖 cwd = 仓库根），这正是 P-0 的价值证明。

---

## 9. 测试 / fixture / 第三方库包

### 9.1 测试归属

> **第 4 版更正（C7）**：fixture 数据**不在 `test/` 根目录**，而在 **`test/fixtures/`**。上一版写的 `test/*.step / *.svg / *.3mf` 是错的（`ls test/` 只有两个子目录 `faijs/` 与 `fixtures/`）。

| 现状 | 迁移后 | 说明 |
|---|---|---|
| `src/**/*.test.ts`（单元/逻辑，与源码同目录） | 随源码走：`packages/core/src/**`、`packages/stdlib/src/**` | 符合 `AGENTS.md` 现状，不动 |
| `test/faijs/**`（功能测试 + `.faijs` fixture） | `packages/tests/faijs/**` | 集成测试集中 |
| `test/faijs/libs/*`（**7 个文件**，含 `brepjs-gear.ts`） | `packages/mech-lib/src/**` | M5：第三方库成包（§6.5） |
| `test/fixtures/*`（**5 项**：`box_boss.3mf` `box_boss.step` `cube-10x5x5.stl` `svg/` `test-model.step`） | `packages/fixtures/**` | 数据包，被 tests / core 引用 |

### 9.2 ⚠️ cwd 隐患（必须修，否则 monorepo 下必挂）

> **第 4 版更正（C6）**：上一版写「10 处 / 9 个文件」并给了一份**漏项**的清单。实测 `grep -rn "process.cwd()" test/` 得 **13 处 / 10 个文件**，漏掉的是 **`test/faijs/faqts/faqts.test.ts` 的 3 处**。

实测 `test/` 下用 `process.cwd()` 定位 fixture 的**全量清单（13 处 / 10 个文件）**：

```
test/faijs/syntax.test.ts:19                  resolve(process.cwd(), 'test/faijs')
test/faijs/syntax/syntax.test.ts:17           resolve(process.cwd(), 'test/faijs/syntax')
test/faijs/boolean/boolean.test.ts:24         resolve(process.cwd(), 'test/faijs/boolean')
test/faijs/features/features.test.ts:26       resolve(process.cwd(), 'test/faijs/features')
test/faijs/mixed/mixed.test.ts:34             resolve(process.cwd(), 'test/faijs/mixed')
test/faijs/mixed/mixed.test.ts:35             resolve(process.cwd(), 'test/fixtures')   ← 跨包
test/faijs/multi-mesh/multi-mesh.test.ts:24   resolve(process.cwd(), 'test/faijs/multi-mesh')
test/faijs/parity/parity.test.ts:26           resolve(process.cwd(), 'test/faijs/parity')
test/faijs/primitives/primitives.test.ts:24   resolve(process.cwd(), 'test/faijs/primitives')
test/faijs/transforms/transforms.test.ts:24   resolve(process.cwd(), 'test/faijs/transforms')
───────────────────────────────────────────────────────────────────────────────────────
test/faijs/faqts/faqts.test.ts:27             resolve(process.cwd(), 'test/faijs/faqts/fixtures/mount-plate.ts')  ← 上一版漏
test/faijs/faqts/faqts.test.ts:29             pathToFileURL(resolve(process.cwd(), 'src/mesh/index.ts')).href     ← 上一版漏
test/faijs/faqts/faqts.test.ts:87             pathToFileURL(resolve(process.cwd()) + '/').href                    ← 上一版漏
```

> ⚠️ **`faqts.test.ts:29` 格外难处理**：它 cwd 相对地指向 **`src/mesh/index.ts`** —— 迁移后 `src/` 进了 `packages/core/`，这条路径**同时跨包又跨目录层级**。它不能简单改成 `new URL('.', import.meta.url)`，必须改为**包导入**（`import { ... } from '@faicad/faijs-core'`）或走 tsconfig `paths` 的别名。

迁移后 cwd 可能是仓库根或 `packages/tests`，这 **13 处全部会挂**。统一改为相对 `import.meta.url`：

```ts
import { fileURLToPath } from 'node:url'
const dir = fileURLToPath(new URL('.', import.meta.url))
```

`mixed.test.ts:35` 的 `'test/fixtures'` 额外要注意：它指向**另一个包**（`packages/fixtures`），改完后走 `@faicad/faijs-fixtures` 的 alias/paths（§9.3）。

### 9.3 fixture 引用改为包导入

`packages/tests` 与 `packages/core` 对 fixture 的引用从相对路径改为 `@faicad/faijs-fixtures/xxx.faijs`（由 tsconfig `paths` + vitest alias 解析）。

### 9.4 `mech-lib` 的层次验证（`Faijs语言的思考.md` 第 96 条的典型场景）

用户要的完整链条：

```
faijs 脚本
  └─ import * as mech from 'mech-lib'          ← packages/mech-lib（依赖 core）
       └─ import { gear } from 'gear-lib'      ← 可选：packages/gear-lib（零依赖，纯几何）
            └─ import { spec } from 'bearing-db' ← 可选：packages/bearing-db（纯数据包）
```

**建议最小起步**：先只做 `mech-lib` 一层（对应现有 `test/faijs/libs/mock-mech-*`），把 `gear-lib` / `bearing-db` 列为可选扩展 —— 它们的价值是验证**传递依赖**与**非 CAD 数据包**在同一 workspace 内共存，但会额外增加 2 个包。

若做，`bearing-db` 是非 CAD 纯数据包，正好验证 `engine-library-contract.md` §11.1 层次表的 L1（"faijs 全程不感知"）。

---

## 10. 迁移步骤（P-0 → P0–P6，每阶段独立可验收）

> **纪律**（对齐 `AGENTS.md` / `CLAUDE.md`）：每阶段按 lint → typecheck → 单测 → build → e2e 逐层验证，每步通过才进下一步；e2e 一次一个 spec；**不跑全量 e2e、不跑 CI 总脚本 `scripts/ci.ps1`、不并发跑测试**。

### P-0 — linker-agnostic 化（**独立于 monorepo，建议单独 commit**）

修的是 §8.2/§8.4 的**既存 bug**，与 monorepo 化正交，可独立回滚。

1. `occtKernel.ts:75` 及 `:79` 的 `candidates[1]` 改为 `createRequire(import.meta.url).resolve('occt-wasm/dist/occt-wasm.wasm')`，删掉 4 层 `..` 猜测与 `process.cwd()` 兜底
2. 补回归测试：**在 3 个不同 cwd 下**各跑一次 `initOcctWasm()`，断言成功（当前代码下会失败）
3. `demo/main.ts:503, 513` 改走 §8.3 的 `/wasm/*` 路径
4. **验收**：lint / typecheck / `npx vitest run src/occt-kernel` / demo `vite dev` 下 OCCT + manifold 均能从本地加载

### P0 — 准备（无功能改动）

> **第 4 版更正**：第 2 步（删 `brepjs`）与第 3/4 步（tgz、prepare）在上一版都是**错的或漏项的**，见下方逐条。

1. `git checkout -b feat/monorepo`（现分支 `main`）
2. ❌ ~~删死依赖 `npm pkg delete devDependencies.brepjs`~~ —— **不要做**。`brepjs` 是 `test/faijs/libs/brepjs-gear.ts:32` 的**真依赖**（C4）。
   ✅ 改为：**什么都不做**，留到 P6 随 `mech-lib` 出包时下沉为 `packages/mech-lib` 的 `dependencies`（§6.5）。
3. ⚠️ 根目录 `.tgz`：**19 个**（不是 14 个），且 `*.tgz` 已被 `.gitignore` 忽略 —— 它们是**每次 `npm run pack` 的构建产物**。
   ✅ 处理：手动清一次即可（`rm -f *.tgz`），**不要**把它当成"仓库卫生问题"写进 CI。若要治本，改 `pack` 脚本输出到 `dist/`。
4. ⚠️ **`prepare` 与 `prepack` 都在**（C15）。现状根 `package.json.scripts` 实测：
   ```
   "pack":     "npm run build && npm pack"
   "prepack":  "npm run build"
   "prepare":  "npm run build"
   ```
   ✅ 处理（按 §6.2 的表）：根包**删 `prepare`、留 `prepack`**；core / stdlib **两个都删**（构建顺序由根脚本显式编排）。
   ⚠️ **P0 验收项**：改完后跑一次 `npm install`，**断言没有触发任何 build**（若触发，说明 `prepare` 没删干净或 npm 对根包的 `prepare` 另有行为 —— 这条必须实测确认，不能想当然）。
5. 建立**公开导出面快照**：脚本 dump `@faicad/faijs` 的 **11 个**子路径（C2，不是 7 个）导出符号表，存为 `scripts/api-surface-snapshot.json`（P6 验收时 diff）
6. **验收**：`npx vitest run` 全绿 / `npm run typecheck` / `npm run lint` 通过（先建立基线）

### P1 — 建立 workspace 骨架（**暂不移动任何源码**）

1. 根 `package.json` 加 `"workspaces": [...]`（顺序按 §2.4）+ `"private": false`
2. devDependencies 上提到根（typescript / eslint / vitest / @types/* / @vitest/coverage-v8），各包 devDeps 写 `"*"`
3. `mkdir -p packages/core && git mv src test packages/core/`（`git mv` 保留历史）
   - ⚠️ `docs/` **留在根**（§5）
   - ⚠️ **`scripts/` 不整体搬**（第 4 版更正 §5）：只有 `faijs-cli.ts` / `gen-symbol-table.ts` 随 `src/` 进 `packages/core/scripts/`；`ci.ps1` / `ci.sh` / `gen-api-dts.ts` / `bump-version.mjs` / `fix-import-extensions.mjs` **留根**
4. 新建根 `src/`（门面薄层：先只做 `export * from '@faicad/faijs-core'`，**暂不接 stdlib**）
5. `rm -rf demo/package-lock.json demo/node_modules`（C14：`demo/node_modules` 实测已存在）
6. `npm install`
7. **验收**：`npm run test -w @faicad/faijs-core` / `typecheck` / `lint` / `build` 全通过 —— **这一步结束时功能零变化**，只是换了目录位置
   - ⚠️ 附加验收：`npx tsc --noEmit` 在**根**也通过（根 `src/` 的 re-export 类型已接上）

### P2 — demo 入 workspace，打通 M7（**本阶段交付 M7 的核心价值**）

1. `git mv demo packages/demo`，改 `package.json`（`file:../faicad-faijs-*.tgz` → `"@faicad/faijs": "*"`）
2. `packages/demo/vite.config.ts` 加 §7.3 的 alias + `optimizeDeps.exclude` + watch 反选 + `wasmAssets()`
3. 根 `vitest.config.ts` 加 §7.2 的 alias
4. **验收**（M3 / M7）：
   - 改 `packages/core/src/` 任意一个文件 → demo dev server **不重启即可见**（HMR）
   - `npm run test -w @faicad/faijs-demo` / `test:e2e` 通过
   - `npm run build -w @faicad/faijs-demo` 仍成功（发布路径不受影响）

### P3 — stdlib 内部切分（**本轮更正的重点**）

1. `git mv src/stdlib/shape.ts` → `packages/core/src/shape/`（K2/§5.4 判据，126 行）
2. 修正 core 侧 8 处 import（`handle-bridge.ts:17`、`backend-dispatch.ts:19`、`module-executor.ts:22`、`preview-exec.ts:19`、`runtime.ts:47`、`node-host/cli.ts:26`、`sdk.ts:35,42`）
3. **验收**：`npm run test -w @faicad/faijs-core` / `typecheck` / `lint` 全绿；**公开导出面 diff 为空**
4. ⚠️ **本阶段不动 `compound.ts`** —— 它整体留在 stdlib（§4.3）

### P4 — 消除边 E-b（依赖 `engine-library-contract.md` P6）

> **前置条件**：契约文档的 P6「装配重做：求解 ≠ 传播」已完成。若未完成，本阶段**不得执行**（否则包图成环）。

1. `module-executor.ts` 删 `applyTransform` import（`:24`）与 `:348` 的原地改写
2. 装配变换改由引擎重放（`:360` 的 `computeDownstream` 扩展为完整 stale → recompute）
3. **验收**：契约文档 §10.1 的专项 e2e 通过；`do_assemble` 幂等（执行两次不叠加变换）；`grep -r "stdlib/compound" packages/core/src` **零命中**

### P5 — stdlib 出包

1. `git mv packages/core/src/stdlib packages/stdlib/src` + `git mv packages/core/src/brep/brepjs-mirror packages/stdlib/src/brepjs-mirror`
2. 建 `packages/stdlib/package.json`（§6.3，peerDependencies 模式）
3. 把 `packages/core/src/cad-runtime/internal-stdlib.ts` **搬到根门面** `src/cad-runtime/internal-stdlib.ts`（E-a-1）
4. core 的 `createRuntime(ports, libs?)` 不再默认注入 `cad`；根门面注入
5. 根 `src/index.ts` 补齐显式 re-export（避免 `export *` 星号歧义）
6. **验收**：
   - `npm run typecheck --workspaces` / `npm run lint --workspaces` / `npm run test --workspaces` 全绿
   - **包图无环**：`madge --circular packages/*/src` 零命中；`npm ls --workspaces --depth 0` 是 DAG
   - **`grep -r "@faicad/faijs-stdlib" packages/core/src` 零命中**（引擎不许知道几何库）
   - **`npm ls occt-wasm --workspaces` 只出现一个版本**（§6.2 的 wasm 单一实例守卫）
   - `npm run build` 产物的导出面与 P0 快照**逐字一致**（**11 个子路径**全比对，不是 7 个）

### P6 — fixtures / mech-lib / tests 出包

> **第 4 版更正（C4 / C7）**：第 1 步要把 `brepjs` 依赖一起搬；第 2 步的源路径是 `test/fixtures/`，不是 `test/`。

1. `git mv test/faijs/libs packages/mech-lib/src`；建 `packages/mech-lib/package.json`，依赖写入 **`dependencies: { "brepjs": "18.119.2" }`**（§6.5）
   - 同步：从**根** `package.json` 的 `devDependencies` 里删掉 `brepjs`（此时才删，且是"下沉"不是"删除"）
2. `git mv test/fixtures/* packages/fixtures/`（⚠️ 源是 `test/fixtures/`，5 项：`box_boss.3mf` `box_boss.step` `cube-10x5x5.stl` `svg/` `test-model.step`）；建 `packages/fixtures/package.json`
3. `git mv test/faijs packages/tests/faijs`；建 `packages/tests/package.json` + `vitest.config.ts`
4. 修 §9.2 的 **13 处** `process.cwd()` 隐患（其中 `faqts.test.ts:29` 指向 `src/mesh/index.ts`，需改为包导入，见 §9.2 的专门说明）
5. **验收**：`npm run test -w @faicad/faijs-tests` 全绿，且**在 `packages/tests/` 下直接 `npm test` 也能跑**（不依赖 cwd）
   - 附加：`npm run test -w @faicad/mech-lib` 全绿 —— **证明 `brepjs` 下沉后 C1 回归测试没被删掉**

### P6.5 — 边界守卫与清理

1. eslint 加 `import/no-extraneous-dependencies`（每包配 `packageDir`）+ `madge --circular`
2. 可选：移植 brepjs `check-layer-boundaries.sh` 的简化版（只查"core 不得 import stdlib"）
3. CI 加 `workspaces` 数组**顺序断言**（§2.4）
4. 同步修订 `AGENTS.md`（包形态描述已失效）

---

## 11. CI / 脚本 / 发布改造

### 11.1 现状 `scripts/ci.ps1` 的 6 步 → 新结构

| # | 命令 | 说明 |
|---|---|---|
| 1 | `npm run lint --workspaces --if-present` | 根 eslint flat config 覆盖全部包 |
| 2 | `npm run typecheck --workspaces --if-present` | `tsc -b`，靠 `paths` 免 build |
| 3 | **按序** build：`npm run build -w @faicad/faijs-core` → `-w @faicad/faijs-stdlib` → 根 `npm run build` | 顺序由 `workspaces` 数组 + 显式编排保证（§2.4） |
| 4 | `npm run test --workspaces --if-present` | vitest workspace；**stderr 零容忍保留**（项目红线 H2） |
| 5 | `npm run test:e2e -w @faicad/faijs-demo` | dev server 模式，验证 M7 链路 |
| 6 | `npm run test:e2e:preview -w @faicad/faijs-demo` | build + preview，验证 CDN/importmap |
| 7 | `madge --circular packages/*/src` | 新增：包图无环守卫 |
| 8 | 导出面 diff vs P0 快照 | 新增：公开 API 不漂移 |

> **stderr 零容忍**（`ci.ps1` 第 4 步的 `^stderr |` 扫描）**原样保留**，只把 `npx vitest run` 换成 workspace 版。

### 11.2 脚本调整

| 脚本 | 现状 | 改为 |
|---|---|---|
| `scripts/fix-import-extensions.mjs` | 扫 `dist/`，补 `.js` 扩展名 | 加一条规则：重写 `new URL('./x.ts', import.meta.url)` → `.js`（§7.5）；路径参数化（每个包调一次） |
| `scripts/gen-symbol-table.ts` | 扫 `src/cad-runtime/internal-stdlib.ts` 生成符号表 | ⚠️ **构建成环风险**：抽包后 core build 要扫 stdlib，而 stdlib build 要 core dist。<br>**解法**：符号表**提交进 git**（不再每次生成），CI 加 drift 检查（重新生成后 `git diff --exit-code`）。`npm run gen:symbols` 保留给手动调用 |
| `scripts/faijs-cli.ts` | `../src/...` 相对导入 | 随 `src/` 进 `packages/core/scripts/`，相对路径不变（`scripts/` → `src/` 的两层关系不变） |
| `scripts/gen-symbol-table.ts` | 同上 | 同上 |
| `scripts/ci.ps1` / `ci.sh` / `gen-api-dts.ts` / `bump-version.mjs` / `fix-import-extensions.mjs` | 单包 | **留根**，见 §11.1 |

### 11.3 发布

> 🔴 **H5：禁止 `npm publish`（等专利通过后才发布）。** 本节为将来的准备，现在只 `npm pack`。

- **统一版本模式**：所有可发布包（`faijs` / `faijs-core` / `faijs-stdlib` / `mech-lib`）共用同一版本号，根 `scripts/bump-version.mjs` 统一 bump。当前版本号 **0.5.8**。
- **⚠️ 这是一处对 brepjs 的"有理由偏离"，必须写明**（第 4 版补）：
  brepjs 用 `release-please` 做**逐包独立版本**（实测 `.release-please-manifest.json`：根 18.119.2 / cad 0.103.0 / bim 0.3.1 / sheetmetal 0.3.0 / opencascade 0.16.0 / voxel-wasm 0.7.0）。
  **faijs 不照抄，理由是耦合强度不同**：brepjs 的域库（bim/sheetmetal）与引擎是**可选组合**，用户可自由搭配版本；faijs 的 core / stdlib / 门面是**同一次执行必须版本对齐的三件套**（错版本 → 两份 WeakSet / 两份 wasm，§6.2 已论证）。因此统一版本 + 锁定范围是**正确性要求**，不是偷懒。
- **每个可发布包**用 `"prepack": "npm run build"`（不是 `prepare`/`prepublishOnly` —— 只有 `prepack` 能同时覆盖 `npm pack` 与 `npm publish`；`prepare` 在 workspace 下每次 install 都跑，见 §6.2 的表）。
- **private 包**（demo / fixtures / tests）设 `"private": true`，npm 自动跳过。
- **内部依赖**：可发布包写锁定范围（`"@faicad/faijs-core": "^0.5.8"`），发版时统一 bump（§2.4）。
- 与 `module-runtime-plan.md` §9.1 一致：**只 pack 不 publish**。

---

## 12. 跨项目影响：3d_editor

3d_editor 在 `C:\my\Faicad\3d_editor`，**不在本 workspace 内**，仍通过 tarball 消费：

```jsonc
// 3d_editor/package.json:24（第 4 版核实：当前已消费 0.5.8）
"@faicad/faijs": "file:../faijs/faicad-faijs-0.5.8.tgz"
```

| 影响面 | 说明 | 处理 |
|---|---|---|
| **包名不变** | 根包仍叫 `@faicad/faijs` | ✅ **0 改动**（实测 **279 处**引用，第 4 版更正 C13） |
| **导出面不变** | **11 个**子路径逐字一致（P0 快照 + CI diff 守卫） | ✅ 0 改动。⚠️ 上一版说"7 个"，若按 7 个做，**`faqts` / `faqts/node` / `faqts/browser` / `module-resolver` 四条 import 会断** |
| **tarball 路径** | `npm run pack` 产出仍在根 | ✅ 0 改动。`pack` 脚本**保持** `"npm run build && npm pack"` 即可（根包不在 `workspaces` 数组里，`-w` 无效，见 §6.1） |
| 改 faijs 源码后 | 仍需 `npm run pack` + 3d_editor `npm install` | ⚠️ **不变** —— 这是两个 git 仓，M7 的免打包只在 faijs 仓库内生效 |
| `BrepChainState` / `initBrepChainState` / `cadExecuteStatement` | 由 core 提供，经门面 re-export | ✅ 0 改动 |
| `import/no-extraneous-dependencies` 检查 | faijs 内部新增 `three` 为 core/stdlib 的 dependency | ✅ 对 3d_editor 无影响 |
| **`occt-wasm` 变 peer** | core/stdlib 把它从 `dependencies` 改成 `peerDependencies` | ⚠️ **需实测确认**：3d_editor 装 tarball 时，peer 由 3d_editor 自己解析。若 3d_editor 未声明 `occt-wasm`，npm 7+ 会**自动安装**一个（可能与 faijs 期望的 3.7.0 不一致）。<br>**P5 附加验收项**：在 3d_editor 侧装一次 tarball，断言 `npm ls occt-wasm` 只有一个版本且 = 3.7.0 |

**可选的后续优化**（不在本方案范围）：3d_editor 若要也享受免打包联动，可把它加入 workspace（跨 git 仓不可行）或改用 `link:` —— 但那会让"两个独立产品"的边界模糊，不建议。

---

## 13. 风险与开放问题

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| O1 | **E-b 阻塞 P5**：若 `engine-library-contract.md` P6 未完成，`packages/core` 仍 import stdlib → 成环 | **高** | P5 **严格排在 P4 之后**。若急需提前，临时方案：把 `applyTransform` 的**纯函数副本**放 core（**临时，必须在 P6 后删除并加 TODO 守卫**）——这是补丁，不推荐 |
| O2 | `server.watch.ignored` 的 `!` 反转是否真能让 Vite 监听 symlink 内的文件 | 中 | P2 实测确认；若无效，退路是 `server.watch.followSymlinks: true` + 不 exclude |
| O3 | `optimizeDeps.exclude` 三个 workspace 包后，dev 首次加载变慢 | 低 | 可接受（M7 的价值远大于首屏几秒）；brepjs 同款处理 |
| O4 | 构建期反向依赖：`gen-symbol-table.ts` 扫 stdlib | 中 | 符号表提交进 git + CI drift 检查（§11.2） |
| O5 | OCCT wasm（~22MB）在多包下被重复解析 | 低 | `resolve.dedupe: ['occt-wasm','three','manifold-3d']`（demo **现状只有 `occt-wasm`**，`three`/`manifold-3d` 是新增项）；外加 `occt-wasm` 声明为 peer（§6.2） |
| O6 | `three` 现在是 core **与** stdlib 两处的 dependency（第 4 版更正：不只 `brep-ops.ts:17`，还在 `boolean/` 的 4 个文件与 `brepjs-mirror/`） | 中 | 诚实申报（现状本就 import）；抽包后必须显式声明两次，并靠 `resolve.dedupe: ['three']` 保证单实例。若担心体积，可在 P3 评估剥离——**但那是独立重构，不在本方案范围** |
| O7 | npm 的幽灵依赖会掩盖缺声明的跨包 import | 中 | §2.5 的工具链必做 |
| O8 | P1 的 `git mv src packages/core/src` 是一次大移动（**204 个** `.ts`，第 4 版更正 C11） | 中 | `git mv` 保历史；分两个 commit（移动 + 配置调整）便于 review |
| O9 | 用户原话是"独立的 **repo**"，本方案是"单仓多包" | 语义 | **已裁定**（第三轮 D1）：单 git 仓 + 多 package |
| O10 | M6 字面：stdlib 引用的是 `@faicad/faijs-core` 而非 `@faicad/faijs` | 语义 | §4.7 已说明取舍。若要字面满足 → 改走 E-a-2，代价是 3d_editor 每处 runtime 创建点加 2 行 |
| O11 | 专利约束：`Faijs语言的思考.md` 第 90 条要求"语言核心思想"不进 faijs 仓 | **高** | 该文件留在 3d_editor；monorepo 化**不得**把它搬入；新增文档同理审查 |
| **O12** | **（第 4 版新增）`brepjs` 不能删** —— 上一版把它判为死依赖，实测是 `test/faijs/libs/brepjs-gear.ts:32` 的真依赖 | **高**（若照上一版做，C1 回归测试直接消失） | P6 随 `mech-lib` **下沉**为该包 `dependencies`（§6.5），不是删除。验收加一条 `npm run test -w @faicad/mech-lib` 全绿 |
| **O13** | **（第 4 版新增）`occt-wasm` 改 peer 后，3d_editor 装 tarball 时可能解析出另一个版本** | 中 | §12 的附加验收项：装一次 tarball 断言 `npm ls occt-wasm` 单版本 = 3.7.0。若失败，退路是 core/stdlib 改回 `dependencies`（放弃 peer 的严格性） |
| **O14** | **（第 4 版新增）`faqts.test.ts:29` 的 `process.cwd() + 'src/mesh/index.ts'`** 跨包跨层级，不能用 `import.meta.url` 简单替换 | 中 | P6 单独处理：改为包导入或 tsconfig `paths` 别名（§9.2） |
| **O15** | **（第 4 版新增）`prepare` 与 `prepack` 双钩子** —— 只改其中一个不够 | 中 | §6.2 逐包列表；P0 增加"跑 `npm install` 断言未触发 build"的验收 |
| **O16** | **（第 4 版新增）根 `src/` 门面要复刻 11 个 exports，漏一个就断 3d_editor** | 中 | P0 的导出面快照必须覆盖全部 11 个子路径；CI diff 守卫（§11.1 第 8 步） |

---

## 14. 验收标准（分层）

### A. M1 / M2（monorepo + npm）

- [ ] 根 `package.json` 有 `workspaces` 数组；**唯一锁文件** `package-lock.json`（`demo/package-lock.json` 已删）
- [ ] `npm install` 一次装完全部包
- [ ] `npm ls --workspaces --depth 0` 的依赖图是 **DAG**（`madge --circular packages/*/src` 零命中）
- [ ] 顺序断言：CI 校验 `workspaces` 数组顺序 == 依赖拓扑

### B. M3 / M4 / M5（包已独立）

- [ ] `packages/stdlib/` 有独立 `package.json`，`@faicad/faijs-stdlib` 可被单独引用
- [ ] `packages/mech-lib/` 成包（**含 `brepjs` dependency**）；`packages/demo/` 不再有 `file:*.tgz` 依赖
- [ ] **`grep -r "@faicad/faijs-stdlib" packages/core/src` 零命中**（引擎不许知道几何库）
- [ ] **`grep -r "stdlib/compound" packages/core/src` 零命中**（装配不留引擎，§4.6）
- [ ] **`npm run test -w @faicad/mech-lib` 全绿**（证明 `brepjs` 是"下沉"不是"删除"，C4/O12）

### C. M6（依赖方向）

- [ ] `faijs → stdlib → core`，`demo/tests/mech-lib → faijs`，无环
- [ ] stdlib 与 mech-lib 对 core 用 `peerDependencies`（单一实例保证，brepjs 模式）
- [ ] **`npm ls occt-wasm --workspaces` 只出现一个版本**（wasm 单一实例，§6.2）

### D. M7（免打包联动）—— **本方案核心价值**

- [ ] `npm run typecheck` 在**没有 `dist/`** 的干净工作区下通过
- [ ] 改 `packages/core/src/` 任一文件 → demo dev server **不重启即生效**
- [ ] 改 `packages/stdlib/src/` 任一文件 → 同上
- [ ] `npm run test --workspaces` 跑的是 **src** 不是 dist（断言：`vitest --reporter=verbose` 的模块路径含 `/src/`）
- [ ] demo `npm run test:e2e` 通过

### E. 不回归

- [ ] `npm run lint --workspaces` / `typecheck --workspaces` / `test --workspaces` 全绿；**stderr 零容忍检查保留且通过**
- [ ] `npm run build` 产物的**公开导出面与 P0 快照逐字一致**（**11 个**子路径全比对，C2/O16）
- [ ] `npm run build -w @faicad/faijs-demo && test:e2e:preview` 通过（CDN/importmap 路径不受影响）
- [ ] `occtKernel.ts` 中不再出现 `resolve(moduleDir, '..', ...)` 与 `resolve(process.cwd(), ...)`；3 个不同 cwd 下 `initOcctWasm()` 均成功
- [ ] **3d_editor 侧装一次 tarball，断言 `npm ls occt-wasm` 单版本 = 3.7.0**（O13）

### F. 清理项（第 4 版逐条更正）

- [ ] ~~`brepjs` 依赖已从 `package.json` / `package-lock.json` 删除~~ → **改为**：`brepjs` 已从根 `devDependencies` **下沉**到 `packages/mech-lib` 的 `dependencies`（C4）
- [ ] `demo/package-lock.json` 与 **`demo/node_modules/`** 均已删（C14）
- [ ] 根目录 `.tgz` 已清（**19 个**，且确认 `*.tgz` 在 `.gitignore` 内——它们是构建产物，不是"未跟踪垃圾"）
- [ ] **`prepare` 与 `prepack` 已按 §6.2 的逐包表处理**；跑一次 `npm install` 断言**未触发 build**（C15/O15）
- [ ] `test/` 下 **13 处** `process.cwd()` 全部改为 `import.meta.url` 相对或包导入（含 `faqts.test.ts:29` 的跨包特例，C6/O14）
- [ ] `AGENTS.md` 的包形态描述已同步修订
- [ ] `docs/api-contract.md` 与 `docs/syntax-design.md` **未被本方案引用**（它们已过时）；若修订，另起文档同步任务
