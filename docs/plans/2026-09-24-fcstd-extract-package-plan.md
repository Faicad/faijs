# FCStd 转换功能抽离到独立包 · 开发计划

> 日期：2026-09-24
> 状态：**已落地**（2026-09-24 实施完成；Step 5 fcstd-port 消费方迁移待该仓库另行执行）
> 范围：将 `packages/core/src/fcstd/*` 与 `packages/core/src/fcstd-convert.ts` 从 core
> 引擎包抽离，成为一个独立的可发布 workspace 包 `@faicad/faijs-fcstd`；core 退化为
> 纯引擎，不再携带 FCStd 读层 / 转换流水线。

---

## 0. 用户原始要求（原文引用）

> 我想把fcstd转换的相关功能，独立到一个包中，而不是放入core模块。请写一份开发计划

拆解为约束：

| 编号 | 约束 |
|---|---|
| C1 | FCStd 相关功能（读层 + 转换流水线 + CLI）整体移出 `packages/core` |
| C2 | 落到**独立的一个包**（不是散落的多个包，也不是留在 core 子目录） |
| C3 | 本会话只产出计划；实施另启动 |

---

## 1. 现状实证（已查代码，含证据行号）

### 1.1 当前 fcstd 在 core 里的落点

| 资产 | 位置 | 角色 |
|---|---|---|
| 读层 barrel | `packages/core/src/fcstd/index.ts` | 公开子路径 `@faicad/faijs/fcstd` 的入口 |
| 转换流水线模块 | `packages/core/src/fcstd/convert.ts` | `convertFcstdFile` 主流程 |
| 转换流水线 barrel（顶层） | `packages/core/src/fcstd-convert.ts` | 公开子路径 `@faicad/faijs/fcstd-convert` 的入口（**刻意放在顶层**见 §1.4） |
| 其余模块 | `packages/core/src/fcstd/*.ts`（unpack / document / sketch-parse / expressions / feature-translate / codegen / placement / attachment / external-geo / planegcs-backend / sketch-verify / contour / fillet-edges / bspline / structural-types / build-fai-zip / cli / sketch-solver / quat-euler / container 等） | 读层 + 转换内部实现 |
| CLI | core `package.json` `bin.faijs-fcstd-convert` → `./dist/fcstd/cli.js` | 批量转换命令 |
| 公开导出 | core `package.json` `exports["./fcstd"]`(line 52–55)、`exports["./fcstd-convert"]`(line 56–59) | 两个子路径 |

### 1.2 耦合面（决定能否干净抽离）

**生产代码对 core 的依赖——仅 2 个公开子路径**（grep `packages/core/src/fcstd` 全量 `../` 导入）：

| 被引方 | 来源文件 | 是否公开子路径 |
|---|---|---|
| `../api/result.js`（`ok`/`err`/`isOk`/`Result`） | `unpack.ts:11`、`document.ts:9`、`convert.ts:30`、`planegcs-backend.ts:13`、`sketch-solver.ts:9`、`build-fai-zip.ts:12` | ✅ `@faicad/faijs/api/result`（经 `./api/*` 导出） |
| `../occt-kernel/occtKernel.js`（`initOcctWasm`） | `external-geo.ts:11` | ✅ `@faicad/faijs/occt-kernel/occtKernel`（经 `./occt-kernel/*` 导出） |

其余 fcstd 模块全部 `.` 自引用（`src/fcstd/` 内部），**不触达 core 其它内部模块**。

**唯一非公开耦合（仅一个测试文件）**：
- `editor-op-boundary.test.ts:5` → `import symbolTable from '../lang/symbol-table.generated.js'`（core 内部生成物，非导出）

**反向耦合（core 依赖 fcstd，抽离会断）**：
- `packages/core/src/api/sketch.test.ts:17` → `import type { Contour } from '../fcstd/contour.js'`（仅类型）

**core 内可卸依赖（grep 实证仅 fcstd 使用）**：
- `@salusoft89/planegcs`（仅 `fcstd/**` 引用）
- `fflate`（仅 `fcstd/**` 引用：`unpack.ts:10`、`convert.ts:31`、`build-fai-zip.ts:10`）

> 注：`acorn` / `flatbush` / `three` 在 fcstd 子树**无引用**（fcstd 生成 `.fai.js` 字符串、由运行时 parser 解析，不自带 parser）。

### 1.3 消费方（必须同步迁移）

兄弟仓库 `D:/Faicad/fcstd-port`（不在本 monorepo workspaces，经 `file:../faijs/faicad-faijs-*.tgz` 消费）大量引用：

| 引用 | 文件 |
|---|---|
| `@faicad/faijs/fcstd` | `lib/profile.mjs:34`、`tools/coverage-report.ts:19`、`tools/calibrate-t1.ts:17`、`tools/locate-l1-sketches.ts:14`、`tools/validate-sketch-solve.ts:16`、`test/FreeCAD/*.test.ts`（多） |
| `@faicad/faijs/fcstd/sketch-parse.js` | `test/FreeCAD/solver-wrong-solution.test.ts:31` |
| `@faicad/faijs/fcstd/placement.js` | `test/FreeCAD/placement-corpus.test.ts:14` |
| `@faicad/faijs/fcstd-convert` | `test/FreeCAD/convert.test.ts:14`、`tools/coverage-report.ts:20`、`tools/calibrate-t1.ts:18`、`tools/locate-l1-sketches.ts:15`、`tools/validate-sketch-solve.ts:17`、`tools/probe-planegcs.ts:11` |
| CLI 路径 | `tools/batch-convert.ts:607` 拼 `node_modules/@faicad/faijs/dist/fcstd/cli.js` |

### 1.4 既有「顶层 barrel」hack（抽离后自然消失）

`fcstd-convert.ts` 刻意放在 `src/` 顶层而非 `src/fcstd/` 内，原因见其注释：vitest/tsconfig
把 `@faicad/faijs/*` 按字符串前缀替换成 `src/*`，若 barrel 在 `src/fcstd/convert-api.ts`，
则 `@faicad/faijs/fcstd-convert` 会解析到不存在路径。**新包自身就是 fcstd 包，`@faicad/faijs-fcstd/*`
映射到自家 `src/*`，该 hack 不再需要**，可直接用干净的 `src/convert.ts` 作 `./convert` 子路径。

---

## 2. 目标架构与默认决策

### 2.1 包归属（默认方案，推荐）

**新建 workspace 包 `packages/fcstd` → npm 名 `@faicad/faijs-fcstd`**，留在 faijs monorepo 内。
理由：

- 与既有的拆分范式一致：`@faicad/faijs-extra`（2026-09-24 拆出编辑器扩展库）、
  `@faicad/cq-compat*` 系列都在本 monorepo 内作 workspace 包、lockstep 发布；
- 复用本仓 CI（lint/typecheck/build/test/守卫）、版本 lockstep、`publish-all.ps1` 拓扑发布；
- 不引入跨仓库版本漂移与 tgz 手工重装（fcstd-port 本就要消费它）。

> 备选（若用户坚持独立仓库）：在 `D:/Faicad/fcstd-lib` 另起仓库。代价：失去锁步版本、
> 守卫复用、publish 拓扑；fcstd-port 改为消费 `@faicad/faijs-fcstd` 的 npm 包而非 workspace。
> 本计划按默认方案（workspace 包）撰写，备选仅作提示。

### 2.2 依赖关系

```
@faicad/faijs-fcstd  (新包)
   ├─ peerDependencies: @faicad/faijs   ^<当前版本线，如 0.16.0>   (引擎：api/result + occt-kernel)
   ├─ peerDependencies: occt-wasm       ^3.8.4                      (external-geo 经 initOcctWasm 需要)
   ├─ dependencies:     @salusoft89/planegcs  1.2.0                 (草图约束求解器)
   ├─ dependencies:     @xmldom/xmldom        ^0.9.8                (Document.xml 解析)
   └─ dependencies:     fflate                ^0.8.2               (解包/打包 .fai.zip)
```
> core 抽离后：移除自身 `dependencies` 中的 `@salusoft89/planegcs`、`fflate`（grep 实证仅 fcstd 用）。

### 2.3 目标包结构

```
packages/fcstd/
├── package.json            # name=@faicad/faijs-fcstd, 同号 lockstep
├── tsconfig.json           # 镜像 faijs-extra/tsconfig.json
├── tsconfig.build.json     # 镜像 faijs-extra/tsconfig.build.json
├── NOTICE / LICENSE
└── src/
    ├── index.ts            # 读层 barrel（原 fcstd/index.ts）→ 子路径 "."
    ├── convert.ts          # 转换流水线（原 fcstd/convert.ts + 原顶层 fcstd-convert.ts 合并）
    │                       #   → 子路径 "./convert"
    ├── unpack.ts  document.ts  sketch-parse.ts  expressions.ts
    ├── feature-translate.ts  codegen.ts  placement.ts  attachment.ts
    ├── external-geo.ts  planegcs-backend.ts  sketch-verify.ts  sketch-solver.ts
    ├── contour.ts  fillet-edges.ts  bspline.ts  structural-types.ts
    ├── build-fai-zip.ts  cli.ts  quat-euler.ts  container.ts
    └── *.test.ts           # 原 fcstd/*.test.ts（除 §3.2 两条特殊项）
```

**exports 映射**（1:1 复用原子路径名，最小化 fcstd-port 迁移）：

| 原子路径 | 新子路径 | 内容 |
|---|---|---|
| `@faicad/faijs/fcstd` | `@faicad/faijs-fcstd` (`.`) | unpackFcstd / memberText / parseDocumentXml / parseSketchObject / parseGeometryList / parseConstraintList / CONSTRAINT_NAMES / parseExpressionEngine |
| `@faicad/faijs/fcstd/sketch-parse.js` | `@faicad/faijs-fcstd/sketch-parse` | ConstraintType / GeoId / GeoRef / PointPos / SketchCon / SketchGeom / ParsedSketch |
| `@faicad/faijs/fcstd/placement.js` | `@faicad/faijs-fcstd/placement` | placementOf / applyPlacement / planeBasis |
| `@faicad/faijs/fcstd-convert` | `@faicad/faijs-fcstd/convert` | convertFcstdFile / SKETCH_T1 / ALLOWED_DISPOSITIONS / createPlanegcsSolver / planegcsWasmPath / classifySketch / maxPointDistance / resolveExternalGeometry / isWhitelisted + 对应类型 |

**bin**：`faijs-fcstd-convert` → `./dist/cli.js`（从 core 迁来）。

---

## 3. 实施步骤（按依赖顺序）

### Step 0 — 脚手架

1. 新建 `packages/fcstd/`，`package.json` 照 `packages/faijs-extra/package.json` 模板：
   - `name: "@faicad/faijs-fcstd"`，`version` 与 faijs 同号（lockstep，当前 `0.16.1`），
   - `exports` 见 §2.3，`files: ["dist","NOTICE","LICENSE"]`，
   - `scripts`: `build: "tsc -p tsconfig.build.json && node ../../scripts/fix-import-extensions.mjs dist"`、
     `typecheck` / `test` / `lint` 同 faijs-extra，
   - `dependencies` / `peerDependencies` 见 §2.2。
2. 复制 `packages/faijs-extra/tsconfig.json` + `tsconfig.build.json` 到 `packages/fcstd/`
   （moduleResolution 沿用 core 既有约定，相对导入保留 `.js` 扩展名）。
3. 根 `package.json` `workspaces` 数组追加 `"packages/fcstd"`
   （位于 `"packages/core"` 之后，满足 `check-workspaces-order.mjs` 拓扑断言）。

### Step 1 — 迁移源码（整目录搬，不改逻辑）

1. `git mv packages/core/src/fcstd/* packages/fcstd/src/`（flatten：去掉 `fcstd/` 子目录）。
2. `git mv packages/core/src/fcstd-convert.ts packages/fcstd/src/convert.ts`，并把其 re-export
   内容**合并**进 `src/convert.ts`（原 `fcstd/convert.ts` 已是模块，顶层 barrel 的 re-export
   直接并入，消除 §1.4 hack）。
3. `git mv packages/core/src/fcstd/index.ts packages/fcstd/src/index.ts`（读层 barrel）。
4. 改写 fcstd 内对 core 的 2 处公开子路径导入：
   - `../api/result.js` → `@faicad/faijs/api/result.js`
   - `../occt-kernel/occtKernel.js` → `@faicad/faijs/occt-kernel/occtKernel.js`
   （其余 `.` 相对导入因 flatten 后仍是同目录兄弟，无需改。）

### Step 2 — 处理两处耦合断点（必须做，否则测试/守卫挂）

**2.1 `editor-op-boundary.test.ts`（原引用 core 内部生成物）**
- 该测试是「fcstd lowering 不借用 editor op」的护栏，原本用 core 内部 `symbol-table.generated.js`
  枚举 cad op。
- **处置**：改写为消费公开 `createApiNamespace()`（来自 `@faicad/faijs/api/api-namespace`，
  fcstd-port 已同款使用），枚举 cad 命名空间成员做护栏。这同时消除了对生成物的耦合，更可移植。
- 随 `git mv` 进入 `packages/fcstd/src/`，导入改 `@faicad/faijs/api/api-namespace`。

**2.2 `api/sketch.test.ts`（core 反向依赖 fcstd 的 `Contour` 类型）— 默认方案 C**
- `Contour` 类型被 `cad.sketch` 消费，但**生产代码 `api/sketch.ts` 不引用 fcstd**（grep 实证），
  仅该测试引用。
- **默认处置（C，推荐）**：把 `api/sketch.test.ts` 中依赖 `Contour` 的断言整体迁到新包
  `packages/fcstd/src/sketch-contour.test.ts`——新包测试 `cad.sketch` 吃自家 `Contour` 的往返，
  从 `@faicad/faijs` 导入 `createRuntime`/`createApiNamespace`/`initOcctWasm`（下游→引擎，合法）。
  原 `api/sketch.test.ts` 删除或改为不含 `Contour` 的纯 `cad.sketch` 校验。
- 备选（B，仅在用户不愿移动测试时）：新包 `exports` 暴露 `Contour`，core 测试改
  `import type { Contour } from '@faicad/faijs-fcstd'`（type-only，无运行时环；ghost-deps 对
  `@faicad/*` 放行）。但架构上 core 测试依赖下游包不优雅，**优先 C**。

### Step 3 — core 侧收口

1. `packages/core/package.json`：
   - 删除 `exports["./fcstd"]`、`exports["./fcstd-convert"]`；
   - 删除 `bin.faijs-fcstd-convert`；
   - `dependencies` 移除 `@salusoft89/planegcs`、`fflate`
     （移除后跑 `check-ghost-deps` + core `typecheck` 验证无残留引用；若发现其它模块引用则保留）。
2. 删除 core 内空目录 `packages/core/src/fcstd/`（已迁空）。
3. `core/src/fcstd-convert.ts` 已迁走（Step 1.2），core 不再有该文件。

### Step 4 — 守卫 / CI 对齐

1. `node scripts/check-ghost-deps.mjs`：新包 `@faicad/faijs` 属 `@faicad/*` 被放行；
   非 `@faicad` 依赖（planegcs / xmldom / fflate）须全部在 `dependencies` 声明（§2.2 已列）。
2. `node scripts/check-workspaces-order.mjs`：新包在 `packages/core` 之后（Step 0.3）。
3. `node scripts/check-dep-lockstep.mjs`：新包 `@faicad/faijs` peer 范围 `^<当前版本线>`。
4. `npx madge --circular packages/*/src`：新包 → `@faicad/faijs` 单向，无环。
5. `npm run typecheck` / `npm run lint` / `npm run test --workspaces` 全绿。

### Step 5 — 消费方 fcstd-port 迁移（兄弟仓库，需另开会话/PR）

> 本步在 fcstd-port 仓库执行，不在本 monorepo；此处列出动作供对齐。

1. `fcstd-port/package.json`：`@faicad/faijs` 之外新增 `@faicad/faijs-fcstd`
   （版本线同 faijs；tgz 期改为 `file:../faijs/packages/fcstd` 或待 npm 发布后走 registry）。
2. 全局替换导入：
   - `@faicad/faijs/fcstd` → `@faicad/faijs-fcstd`
   - `@faicad/faijs/fcstd/sketch-parse.js` → `@faicad/faijs-fcstd/sketch-parse`
   - `@faicad/faijs/fcstd/placement.js` → `@faicad/faijs-fcstd/placement`
   - `@faicad/faijs/fcstd-convert` → `@faicad/faijs-fcstd/convert`
3. `tools/batch-convert.ts` 拼的 CLI 路径 `node_modules/@faicad/faijs/dist/fcstd/cli.js`
   → `node_modules/@faicad/faijs-fcstd/dist/cli.js`。
4. `tools/probe-planegcs.ts` 的 `planegcsWasmPath()` 来源改为 `@faicad/faijs-fcstd/convert`
   （路径解析随包走新 node_modules，行为自然正确）。
5. fcstd-port `vitest.config.ts` 的 alias 增加 `@faicad/faijs-fcstd` → 本仓 `packages/fcstd/src`。

### Step 6 — 发布对齐

1. `scripts/publish-all.ps1` 拓扑序在 `@faicad/faijs`（core 升格后的引擎）之后追加
   `@faicad/faijs-fcstd`。
2. 版本 lockstep：随 faijs 同号 bump（当前 `0.16.1`）。

### Step 7 — 文档与遗留计划更新

1. `docs/plans/2026-09-23-fcstd-gap-dev-plan.md` 内文件路径
   （`feature-translate.ts:969-1048`、`api/extrude.ts:440-468` 等）改写为
   `packages/fcstd/src/...` 新位置（该 gap 计划仍有效，仅路径变更）。
2. `docs/plans/2026-09-19-npm-publish-plan.md` §2 发布范围表追加一行
   `@faicad/faijs-fcstd`；core 删除 `./fcstd`/`/fcstd-convert` 子路径的事实记入。
3. `fcstd-port/README.md` 中「faijs 只提供 FCStd 读层 + 转换层」改为指向 `@faicad/faijs-fcstd`。
4. AGENTS.md 架构段（`L1 几何层` / `fcstd` 描述）更新：fcstd 读层+转换已迁出 core。

---

## 4. 验收口径

| 项 | 判据 |
|---|---|
| 抽离干净 | core `typecheck` + `check-ghost-deps` + `check-dep-lockstep` 通过；core `dist/` 不再含 `fcstd*`（除被删的空目录） |
| 新包自洽 | `npm run build -w @faicad/faijs-fcstd`、`npm run test -w @faicad/faijs-fcstd`、`npm run typecheck -w @faicad/faijs-fcstd` 全绿 |
| 反向耦合消除 | core 不再有文件引用 `../fcstd/`（grep 为空）；`api/sketch.test.ts` 不再依赖 fcstd（按 §2.2 处置后） |
| 消费方无回归 | fcstd-port 跑 10 文件小批量：`convert ok + run ok + STEP 落盘` 与 tgz 时代结果一致（publish-plan §5.3） |
| CLI 可用 | `npx faijs-fcstd-convert <x.FCStd>` 从新包 bin 跑通 |

---

## 5. 风险登记

| 编号 | 风险 | 对策 |
|---|---|---|
| R1 | core 移除 `fflate`/`planegcs` 后仍有隐藏引用 | Step 3.1 移除后必跑 `check-ghost-deps` + core `typecheck`；若报错则回退保留该依赖 |
| R2 | `api/sketch.test.ts` 的 `Contour` 断言迁移遗漏 | 采用 §2.2 默认方案 C（整段迁入新包测试），迁移后 grep core 确认 `../fcstd/` 归零 |
| R3 | `editor-op-boundary` 护栏改写后语义漂移（漏检借用 editor op） | 改写后用 fcstd-port 现有语料跑一遍该测试，确认仍报「borrow count = 0」 |
| R4 | fcstd-port 1:1 替换漏掉子路径（如 `/sketch-parse.js` 深引） | Step 5.2 全量替换 + fcstd-port `typecheck` 验证所有 import 解析 |
| R5 | `planegcsWasmPath()` 解析到错误 node_modules | 抽离后 `createRequire(import.meta.url)` 自然指向新包；fcstd-port `probe-planegcs.ts` 验证路径 |
| R6 | lockstep 版本未同步导致 CDN/registry 解析旧版 | `check-dep-lockstep` + `publish-all` 同号校验兜底 |

---

## 6. 不做的事（明确排除）

- 不改动 fcstd 的**转换逻辑/语义**（本计划只做物理搬移 + 依赖重布线，不修 bug、不扩特征）。
- 不触碰 fcstd-port 的画像/批量驱动器/语料（仅改其 import 指向）。
- 不在本计划内实施（用户要求只写方案）。
