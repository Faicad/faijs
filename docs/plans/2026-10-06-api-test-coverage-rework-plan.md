# faijs API 测试覆盖方案（重定范围与门禁边界）

日期：2026-10-06
状态：方案（未实施）

## 1. 需求（用户原话）

用户对**当前未提交的改动**提出三点批评：

> 目前未提交的代码，设计问题很大啊，首先，本项目有源代码为何要去分析dist，而且为何在core里分析别的包造成反向依赖，还有测试代码为何混入src代码

用户给出的**原始需求**逐字如下：

> 给faijs导出的所有api、和其中的所有参数都要补充测试。而且缺少测试的api必须在ci测试中失败。

> 这个需求的更深层的含义是提高代码的质量。不导出的api，如果有完善的测试也更好。而且每个子包应该负责自己的测试。

> 请根据我的需求，写一份新的方案。

## 2. 现状诊断

当前未提交改动引入了一个门禁：`packages/core/scripts/check-api-coverage.ts`（外加一次性的 `packages/core/scripts/list-exports.ts` 与 `root-fns.txt`），并因此在 `packages/core/src/**`、`packages/faijs-extra/src/**` 下新增约 50 个 `*.test.ts`。它的实现方式是：

1. **从 `dist` 加载导出面**：`import(pathToFileURL('packages/core/dist/index.js'))`，再 `Object.entries` 取函数名。
2. **在 core 的脚本里横向扫描别的包**：测试源码目录硬编码了 `packages/faijs-extra/src`、`packages/sketch/src`、`packages/draw/src`，默认入口还包含 `packages/faijs-extra/dist/index.js`。
3. **覆盖判定只是"函数名 token 匹配"**：`new RegExp('\\b' + name + '\\b').test(测试源码)`，参数完全不检查。

对应三个设计问题：

| # | 用户批评 | 代码事实 |
|---|---|---|
| 1 | 有源码为何分析 dist | 导出面从 `dist/*.js` 读取；必须先 `npm run build`，产物可能与 src 不同步，且 type-only 导出与参数信息在运行时不可见 |
| 2 | core 里分析别的包造成反向依赖 | core 是最底层包，脚本却引用 `faijs-extra`／`sketch`／`draw` 的 dist 与 src，拓扑上向上依赖；且这些包的测试被 core 越权扫描 |
| 3 | 测试代码混入 src | 新增测试全部铺在 `packages/*/src/**` 与实现同目录，测试没有独立归属，"src"这一边界同时容纳实现与测试 |

第 3 点还有一个更深的问题：门禁的"覆盖"只是**函数名被提到**，Agent Note 自己也写明 "it is a correctness net, not a numerical-parity suite"。这与用户"每个参数都要补充测试、提高代码质量"的真实意图不符——它保证的是"名字出现过"，不是"参数被测过"。

## 3. 设计目标与原则

1. **源码为准**：导出面、参数清单全部由 TypeScript 源码（AST / checker）解析，不读 `dist`，不与 build 顺序耦合。
2. **分包自治**：门禁脚本通用化后放在根 `scripts/`（仓库既有的跨包守卫之家），以"包"为单位运行；**每个包只检查自己的导出面与自己的测试**，core 不认识 extra/sketch/draw。
3. **测试独立**：测试文件与实现目录分离，每个子包持有自己的测试；门禁只扫描该包自己的测试。
4. **参数级硬门禁**：不仅要求导出 API 被测试引用，还要求其**每个参数**在测试中被触及；缺测即 CI 失败。
5. **非导出 API 软覆盖**：不设硬门禁，用覆盖率报告 + 评审推动，避免"为过门禁而写名字"的反向激励。

## 4. 方案设计

### 4.1 覆盖范围

"faijs 导出的所有 api"定义为**所有对外发布包**（`@faicad/*`）在各自 `package.json` 的 `exports` 中声明的**具体入口**（排除 `*` 通配键；通配键对应的子模块单独登记，见 4.2）。

单元即"包"：`core`（含 `.`、`./api`、`./sdk`、`./csg`、`./sdf`、`./node`、`./browser`、`./shape`、`./mesh`、`./io`…）、`faijs-extra`（`.`、`./browser`、`./editor-ops`）、`sketch`、`draw`、`sheetmetal`、`faijs-gears`、`faijs-fasteners`、`faijs-viewer` 等。

### 4.2 导出面与参数清单提取（源码）

新增解析器（TS Compiler API，项目已依赖 `typescript`，`check-tsconfig-paths.mjs` 有先例）：

1. 读包的 `package.json` `exports`，把每个具体键映射到其 `types` 对应的**源文件**（约定 `dist/` 镜像 `src/`，如 `./api` → `src/api/index.ts`）。
2. 以这些源文件为入口构建 `ts.Program`，用 `checker.getExportsOfModule` 得到导出符号集（含 re-export 链、`export *`），过滤出 value 类导出（函数、类、const）。
3. 对每个导出函数取签名参数名；对 `options` 对象参数，用 `checker.getPropertiesOfType` 取全部属性名。
4. op（`cad.*` 一类由声明式契约定义的 API）参数以 `defineOp` schema / `api/surface/arg-spec` 为准——这是权威来源，比 TS 推断更可靠。

产物：每包一份 `api-manifest.json`（`API → 参数名[]`），可作为评审物与回归基线。

### 4.3 覆盖判定（分档）

门禁判据分三档，前两档为 CI 硬门禁：

- **L1 函数覆盖（硬）**：导出函数名在本包测试中以**调用/引用**形式出现（排除注释、字符串文档）。升级点：从 dist 名字清单改为源码导出面。
- **L2 参数覆盖（硬，用户新要求）**：该函数的**每个参数名**都在针对它的调用点出现——位置参数按参数名，`options` 对象按属性名。实现上遍历测试与 `.fai.js` fixture 的 AST，定位该函数的 `CallExpression`，核对实参与对象字面量覆盖的参数名。
  - 示例：`box(width, depth, height, { at, centered })` 需要测试中出现对 `box` 的调用，且 `width`/`depth`/`height`/`at`/`centered` 均被赋值过。
- **L3 行为断言（软/评审）**：参数取值不同导致的可观测结果（数值/几何）被断言。机械门禁无法证明语义，故不作为门禁，靠代码评审与既有 BREP/mesh parity 套件保证。

诚实边界：L2 能保证"每个参数被调用过"，**不能**保证"参数语义正确"。语义质量由 L3 评审补足；不做机械假装。

### 4.4 门禁脚本归属与运行方式

- 新脚本放根 `scripts/check-api-test-coverage.ts`（与 `check-ghost-deps.mjs`、`check-test-fs-scope.mjs` 同级），接受 `--package=<dir>`：
  - 该包导出面（4.2）× 该包自己的测试（4.5）→ L1/L2 判定；
  - 缺测输出 `函数 — 缺参数` 清单并非零退出。
- 每个包 `package.json` 增加 `"check:api-coverage": "npx tsx ../../scripts/check-api-test-coverage.ts --package=."`，便于单包自检。
- **删除** `packages/core/scripts/check-api-coverage.ts`、`packages/core/scripts/list-exports.ts`：core 不再拥有跨包门禁，也不再有反向依赖。
- CI：守卫步骤按包运行（脚本内遍历可发布包，或显式逐包 `-w`），core 与 extra 各查各的。

### 4.5 测试目录组织（回应第 3 点）——**存量全量迁移**

**已定方案：存量测试一次性全部迁出 `src`。** 每个包建立与 `src/` 平级的 `test/` 目录，所有测试放 `test/**/*.test.ts(x)`；迁移完成后各包 `src` 下**不得再存在** `*.test.ts(x)`（由门禁断言）。

配置改动（逐包）：

- `vitest.config.ts`：`include` 改为 `test/**/*.test.ts`、`test/**/*.test.tsx`；`setupFiles` 指向迁移后的 `test/` 路径（如 `test/vendored-setup.ts`）；alias 中对 `@faicad/faijs` 等的既有映射不变。
- `tsconfig.json`（typecheck）：`include` 增加 `test/**/*.ts`，移除对测试文件的 src 依赖。
- `tsconfig.build.json`：排除 `test/`（保持不编译进 dist）。
- 门禁的"本包测试" = 该包 `test/` 目录；`check-api-test-coverage` 不再从 `src` 抓测试。

迁移内容与规则：

1. 迁移对象是 `*.test.ts(x)` 及其**测试专属支撑**：`packages/core/src/test/`、`packages/core/src/test-support/`、`packages/core/src/test-helpers.ts`、`packages/faijs-fasteners/src/testing/` 等。
2. **判定线**：凡被 `src` 下非测试代码 `import` 的支撑模块**不得移动**（否则 `src → test` 形成反向依赖），留在 `src`；只有"仅被测试引用"的才迁入 `test/`。迁移前用静态引用扫描产出每个候选文件的引用者清单，逐一裁定。
3. import 路径改写：`./x` → `../src/x`，`../../` 相对深度相应调整；一次性脚本批量改写 + 人工复核跨包引用（`@faicad/*` 走 alias，不受影响）。
4. **fixture 相对路径**：大量测试用 `import.meta.url` 定位 `packages/fixtures/data/...`。目录深度变化后这些相对层的层数必须同步调整，否则 CI 上 ENOENT。
5. `scripts/check-test-fs-scope.mjs` 用"文件到仓库根的深度"判定路径穿越；迁移整体变浅一层，需在迁移后重跑该守卫确认无新增/遗漏。

> 注：这与现有 `AGENTS.md`「测试与源码同目录」的约定不同，实施时须同步更新 `AGENTS.md`、各包 `vitest.config.ts`、`tsconfig.json` 与 `tsconfig.build.json`，并把新约定写入长期文档（见 4.6）。

### 4.6 非导出 API 与质量补充

- 非导出 API 不设硬门禁（用户："如果有完善的测试也更好"）；
- 用 vitest v8 coverage 产出各包报告（core 已有 coverage 设施），作为评审信号与趋势指标，不卡阈值，避免"写名字过门禁"；
- 文档同步：本门禁属于"测试规范"，落地后写入 `docs/` 根目录的长期文档与 `AGENTS.md`，而非留在 plans。

### 4.7 CI 接入点

守卫步骤（`scripts/ci.ps1` / `ci.sh` 第 5 步）加入 `check-api-test-coverage`，与幽灵依赖、lockstep、导出面并列；因为基于源码，**不再要求先 build**。

## 5. 对现有未提交改动的处置

逐文件处理，**严禁目录级还原**（`AGENTS.md` 红线）。本次新增测试连同存量测试按 4.5 **全量迁入各包 `test/`**：

1. 删除 `packages/core/scripts/check-api-coverage.ts`、`packages/core/scripts/list-exports.ts`、`root-fns.txt`。
2. 逐行回退 `package.json` 的 `check-api-coverage` script 与 `scripts/ci.ps1` 的两处新增（脚本名/注释）。
3. 新增的 ~50 个 `*.test.ts`：**先审查后归位**——
   - 有真实断言价值的（如 `occt-high-level.test.ts`、`brep-api-ops.test.ts`、primitives/boolean/knurl 系列）保留，按 4.5 迁入对应包 `test/`；
   - 纯为"名字出现"而写、无断言或断言空洞的剔除；参数缺口按 L2 补；
4. 重写 `.agents/notes/implemented/testing/2026-10-06-api-export-coverage-gate.*`（现 note 描述的是被否定的 dist+token 方案），改为记录本方案落地后的真实决策。
5. 删除/重做相关的 `check-api-coverage.ts` 单测（若有）。

## 6. 分阶段实施

- **P0 范围与清单**：确定 4.1 的可发布包范围；对存量测试与测试支撑文件产出「文件 → 引用者」裁定表（区分"仅测试引用"与"被 src 引用"）。
- **P1 存量全量迁移**：按 4.5 把 `*.test.ts(x)` 与仅测试引用的支撑迁入各包 `test/`，同步 vitest/tsconfig，批量改写 import 与 fixture 相对路径；逐包跑测试与该包 `typecheck`，重跑 `check-test-fs-scope.mjs` 验证。（迁移范围已定为全量，不再可选。）
- **P2 解析器**：实现源码导出面 + 参数清单提取（4.2），产出 `api-manifest.json`，先只输出报告不失败。
- **P3 门禁**：实现 L1/L2 判定与显式失败（4.3/4.4），接入各包 script 与 CI。
- **P4 测试补全**：审查现有新增测试，补齐 L2 参数缺口，剔除纯"名字出现"的空洞测试。
- **P5 清理与文档**：删除旧脚本与临时产物，重写 Agent Note，更新 `AGENTS.md`、各包 `vitest.config.ts`/`tsconfig` 与新约定长期文档。

## 7. 验收标准

1. 有源码、无 `dist` 时门禁可运行（不依赖 build）。
2. core 的脚本/门禁不出现任何他包路径；每个包各自运行门禁。
3. 新增一个无测试的导出 API（或其新参数）→ CI 立即失败，并打印"函数 — 缺参数"清单。
4. 测试目录与实现目录分离：每个包 `src/` 下**不再存在**任何 `*.test.ts(x)`，测试全部位于 `test/`；门禁只扫本包测试。
5. 各包测试、typecheck、`check-test-fs-scope` 在迁移后全绿。
6. 非导出 API 有覆盖率报告但不阻塞 CI。

## 8. 风险

- **迁移面广**：core 约 265 个、其余包合计约 90 个 `*.test.ts`，加上 `src/test/`、`src/test-support/` 等支撑；自动改写 import 与 fixture 相对路径后必须逐包跑测试兜底，不能只靠静态改写。
- **支撑文件误判**：被 `src` 非测试代码引用的模块若被迁走会形成 `src → test` 反向依赖，故 P0 的引用者裁定表是迁移前的硬前置。
- **fixture 路径**：`check-test-fs-scope.mjs` 以文件深度判定路径穿越，迁移后深度变化需重新校验。
- **L2 误判空间**：参数名可能碰巧出现在别处，第一版接受调用点级匹配，后续可收紧。
- **`.fai.js` fixture 解析**：op 的调用点在 `.fai.js` fixture 里，需覆盖 JS 子集语法；复用项目已有 parser，避免另造轮子。
- **双通道统一**：op 参数以 schema 为准、TS 函数以签名为准，两条通道需在 `api-manifest.json` 里统一，避免同 API 两套参数清单。