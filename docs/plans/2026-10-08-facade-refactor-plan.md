# 门面 index.ts 重构与重名导出梳理方案

> 日期：2026-10-08
> 状态：方案（未实施）
> 前置分析：`docs/analysis/2026-10-08-same-name-facade-createRuntime.md`
> 涉及外部仓：`3d_editor`、`faijs-cadquery`、`faijs-freecad`、`faijs-openscad`

## 0. 用户原话

> 好的，请根据这个思路写一份完整的重构方案。此外，还要检查本项目的依赖方，包括 faijs-cadquery、faijs-freecad、faijs-openscad、3d_editor 这四个项目。重构的时候，如果涉及到了这几个项目用到的 api，一并修改。现在，请先调研并写出这份技术方案。

> 之前给库开发者写的方案里让其直接访问子目录拿到 api，略过门面，这个做法是否合适？

用户要求：基于"门面只 re-export 不定义新签名 + 子路径显式枚举 + 重名导出分类消歧"的思路，写完整重构方案；调研四个外部依赖仓的消费方式；涉及它们用到的 API 时一并修改。

## 1. 背景与目标

### 1.1 问题诊断（引自前置分析文档）

仓库内存在两个同名 `createRuntime`，签名靠 import 路径区分，类型系统不拦截误用：

| 位置 | 签名 | 第 3 参 | 导出面 |
|---|---|---|---|
| `cad-runtime/createRuntimeWithCad.ts:24` | `(ports, mode?, options?)` | `options` | `index.ts` / `browser.ts` / `weapp.ts` |
| `cad-runtime/runtime.ts:1870` | `(ports, mode?, libs?, options?)` | `libs` | 深路径（cli.ts、faijs-freecad） |

三个 umbrella 入口（index/browser/weapp，node 经 `export * from './index'` 继承）全部 re-export createRuntimeWithCad 版。可选参数错位是静默故障——tessellation 配置曾因此无声失效。

### 1.2 门面结构现状

- `index.ts`：252 行手写具名 re-export，按 L0–L3 全层平铺。
- `browser.ts`>：241 行，结构同 index.ts（B/C/D 四类收敛），同样从 createRuntimeWithCad re-export createRuntime。
- `weapp.ts`：42 行，从 createRuntimeWithCad re-export createRuntime。
- `node.ts`：36 行，`export * from './index'` + node-host 专用导出。
- `env-agnostic.ts`：100 行，三处 umbrella 共享的 env-agnostic 面（identity + runtime-state + lang/*），已收敛为单一源。
- `api/index.ts`：170 行，L3 API 面聚合，平铺大量 op。
- `api/api-namespace.ts`：223 行，cad 命名空间装配点。
- 13 个 `api/<x>/index.ts` 目录门面。

### 1.3 子路径暴露现状

`package.json` 用 wildcard 暴露 12 组子路径（`./mesh/*`、`./brep/*`、`./api/*`、`./io/*`、`./cad-runtime/*`、`./occt-kernel/*`、`./topology/*`、`./boolean/*`、`./primitives3/*`、`./brepkit-kernel/*`、`./geometry2d/*`、`./module-resolver/*`），等于全量暴露 `dist/` 下源文件结构——内部重构（改名/移动文件）即破坏性变更，无公开边界。

### 1.4 目标

1. 消灭同名异签名：一个公开名只有一个实现体。
2. 门面收敛为 re-export 薄层：不定义新签名，不手写 252 行具名清单。
3. 子路径改显式枚举：建立公开边界，内部文件可自由重构。
4. 重名导出分类消歧：同名异源真冲突显式指定权威源，同名同源不同面用不同公开名。
5. 四个外部依赖仓的受影响调用点一并修改。
6. 加 lint/脚本守卫防漂移。

## 2. 依赖方调研结果

### 2.1 调研方法

对四个仓逐一搜索所有 `@faicad/faijs` 相关 import，分类统计门面导入 vs 子路径导入，记录 `createRuntime` / `createRuntimeWithCad` / `createApiNamespace` / `CadRuntime` / `registerLib` 等关键符号的导入路径与调用形态。

### 2.2 3d_editor

- **依赖声明**：`file:` 协议指向 faijs 仓库预打包 tgz（0.30.9），有 `update-faijs` 脚本与 lockstep 守卫。
- **门面导入**：真正业务 import 仅 1 处（`packages/platform/src/electron/execution-process.ts:35` 从 `@faicad/faijs` 取 `createRuntime`, `exportStepFromSolidsHighLevel`）。app 包有门禁测试禁止生产代码从根门面导入。
- **子路径导入**：365 处，主导是 `@faicad/faijs/browser`（248 处，占 62%）。
- **createRuntime 调用点（8 处）**：

  | 文件:行 | import 来源 | 参数形态 | 第 3 参语义 |
  |---|---|---|---|
  | `app/.../faijs-test-harness.ts:173` | `/browser` | `(ports, mode)` 2 参 | — |
  | `platform/.../execution-process.ts:177` | `@faicad/faijs` | `(ports, 'auto')` 2 参 | — |
  | `platform/.../faijs.worker.ts:49` | `/browser` | `(ports, 'auto')` 2 参 | — |
  | **`platform/.../weapp/faijs.worker.ts:100`** | **`/weapp`** | **`(ports, 'brep', { execBackend: '8' })` 3 参** | **`options`** |
  | `platform/.../memory.ts:249` | `/browser` | `(ports, mode)` 2 参 | — |
  | `app/.../c4-brepjs-gear.test.ts:80` | `/browser` | `(ports, 'auto')` 2 参 | — |
  | `platform/.../sketch-host.test.ts:125` | `/4'browser` | `(ports, mode)` 2 参 | — |
  | `platform/.../sketch-host.test.ts:336` | `/browser` | `(ports, 'brep:')` 2 参 | — |

  **关键**：weapp worker 的 1 处用 3 参形态，第 3 参是 `options`（`{ execBackend: 'interpreter' }`）。这是重构的唯一真实断裂点。

- **cad 命名空间装配模式**：`createRuntime(ports, mode)` → `runtime.registerLib('cad', createEditorCadNamespace(), { default: true, packageName: '@faicad/faijs' })`。即：先让 createRuntime 自动注册平台 cad，再覆盖成编辑器 cad（来自 `@faicad/faijs-extra/browser`）。
- **createRuntimeWithCad**：不直接 import。
- **createApiNamespace**：不直接 import（用 createEditorCadNamespace）。
- **深路径**：1 处 `@faicad/faijs/cad-runtime/ports`（type import，weapp worker-ports.ts:21）。

### 2.3 faijs-cadquery

- **依赖声明**：npm version range（`^0.29.0` peerDependencies）。
- **门面导入**：38 处（createRuntime 29 处、registerOcctBrepEngine 30 处、getKernel 8 处等）。
- **子路径导入**：278 处（88%），大量使用 `@faicad/faijs/shape`、`@faicad/faijs/brep/handle-bridge`、`@faicad/faijs/occt-kernel/occtKernel` 等深路径。
- **createRuntime 调用点（32 处）**：全部从根门面 `@faicad/faijs` 导入，统一 2 参 `createRuntime(createNodePorts(), 'brep')`。BREP-only 消费者。
- **createRuntimeWithCad**：不使用。
- **createApiNamespace**：2 处（`workplane.ts:62` 走子路径 `@faicad/faijs/api/api-namespace`，`tests/faijs-cli.mjs:17` 走根门面）。
- **深路径**：无 cad-runtime 深路径。

### 2.4 faijs-freecad

- **依赖声明**：npm version range（`^0.29.0` peerDependencies + devDependencies）。
- **门面导入**：12 处，全部只取 `createApiNamespace`。
- **子路径导入**：73 处。
- **createRuntime**：**不使用**。直接 `new CadRuntime(ports, 'brep', { cad: ns })` 从深路径 `@faicad/faijs/cad-runtime/runtime` 导入 CadRuntime 类（2 处）。
- **createApiNamespace**：13 处（12 从门面，1 从深路径 `@faicad/faijs/api/api-namespace`）。调用形态统一 `createApiNamespace()` 0 参，经 `mergeSketchNamespace(...)` 合并 sketch 库后注入。
- **深路径**：2 处 `@faicad/faijs/cad-runtime/runtime`（CadRuntime 类）、2 处 `@faicad/faijs/cad-runtime/ports`（HostPorts type）。

### 2.5 faijs-openscad

- **依赖声明**：npm version range（`^0.30.9` peerDependencies），全动态 `await import()` + try/catch 降级。
- **门面导入**：8 处（动态，取 TS 兼容面函数 `volume`/`sphere` 等，不取运行时入口）。
- **子路径导入**：15 处（动态）。
- **createRuntime 调用点（6 处）**：全部从 `@faicad/faijs/node` 动态导入，统一 2 参 `createRuntime(createNodePorts(), 'brep')`。
- **createRuntimeWithCad**：不使用。
- **createApiNamespace**：不使用。
- **深路径**：无 cad-runtime 深路径；有 `brep/engine/adapters/occt` + `brep/engine/registry`（2 个 probe 测试手动装配 BREP 引擎）。

### 2.6 调研汇总

| 维度 | 3d_editor | faijs-cadquery | faijs-freecad | faijs-openscad |
|---|---|---|---|---|
| 依赖方式 | file: tgz 0.30.9 | npm ^0.29.0 | npm ^0.29.0 | npm ^0.30.9 |
| 门面导入处数.0 | 1 | 38 | 12 | 8 |
| 子路径导入处数 | 365 | 278 | 73 | 15 |
| createRuntime 调用 | 8 | 32 | 0 | 6 |
| createRuntime 参数形态 | 2 参 ×7 + **3 参 ×1** | 2 参 ×32 | — | 2 参 ×6 |
| createRuntimeWithCad | 不用 | 不用 | 不用 | 不用 |
| new CadRuntime | 0 | 0 | 2 | 0 |
| cad-runtime 深路径 | 1 (ports type) | 0 | 4 (runtime+ports) | 0 |

**关键结论**：

1. **createRuntimeWithCad 无任何外部消费者直接 import**——它是内部门面，外部经 umbrella 入口间接消费。删除安全。
2. **所有 createRuntime 调用都是 2 参 `(ports, mode)`，唯一例外是 3d_editor weapp 的 1 处 3 参 `(ports, 'brep', { execBackend: 'interpreter' })`**——第 3 参是 options，重构后需改为 4 参形态。
3. **faijs-freecad 不用 createRuntime，直接 `new CadRuntime`**——只要 CadRuntime 构造器签名不变，不受影响。
4. **createApiNamespace 存在双路径导入**（门面 + 深路径），门面 re-export 后行为不变。

## 3. 重构方案

分 5 个阶段，按风险递增排序。每阶段独立可验证、可回滚。

### 3.1 阶段 1：消灭同名异签名（createRuntimeWithCad）

**目标**：一个公开名 `createRuntime` 只有一个实现体。

**改动**：

1. **`cad-runtime/runtime.ts`**：`createRuntime` 函数内部增加 cad 自动装配逻辑——若 `libs` 未含 `cad` 键，自动装配 `createApiNamespace()` 并注册为 default lib。

   ```ts
   export function createRuntime(
     ports: HostPorts,
     mode?: ExecutionMode,
     libs?: Record<string, LibNamespace>,
     options?: CadRuntimeOptions,
   ): CadRuntime {
     const rt = new CadRuntime(ports, mode, libs, options)
     if (!rt.hasLib('cad')) {
       rt.registerLib('cad', createApiNamespace(), {
         default: true,
         packageName: '@faicad/faijs',
       })
     }
     return rt
   }
   ```

   `CadRuntime` 构造器**不**自动装配 cad——保持纯引擎语义。faijs-freecad 的 `new CadRuntime(ports, 'brep', { cad: ns })` 不受影响。

2. **删除 `cad-runtime/createRuntimeWithCad.ts`**。

3. **`index.ts` / `browser.ts` / `weapp.ts`**：createRuntime 的 re-export 源从 `./cad-runtime/createRuntimeWithCad` 改为 `./cad-runtime/runtime`。

   ```ts
   // 改前
   export { CadRuntime, createRuntime, ... } from './cad-runtime/createRuntimeWithCad'
   // 改后
   export { CadRuntime, createRuntime, ... } from './cad-runtime/runtime'
   ```

4. **新增 `cad-runtime/createBareRuntime.ts`**（或直接在 runtime.ts 导出）：提供不同名的 `createBareRuntime` 给需要"不带 cad 纯引擎"的宿主。

   ```ts
   export function createBareRuntime(
     ports: HostPorts,
     mode?: ExecutionMode,
     libs?: Record<string, LibNamespace>,
     options?: CadRuntimeOptions,
   ): CadRuntime {
     return new CadRuntime(ports, mode, libs, options)
   }
   ```

   当前无外部消费者需要它（faijs-freecad 用 `new CadRuntime`，cli.ts 等内部用 `new CadRuntime` 或传空 libs），但提供明确命名入口避免未来再造同名变体。

5. **`runtime.ts` 需要 import `createApiNamespace`**——注意避免循环依赖。`api/api-namespace.ts` 当前不 import runtime.ts，`runtime.ts` import 它是安全的（api 层在 cad-runtime 之下）。若存在循环，则把 cad 装配逻辑放在一个独立模块 `cad-runtime/default-cad-lib.ts` 中，由 runtime.ts 调用。

**外部消费点修改**：

| 仓 | 文件:行 | 当前调用 | 改后调用 | 原因 |
|---|---|---|---|---|
| 3d_editor | `platform/src/weapp/faijs.worker.ts:100` | `createRuntime(ports, 'brep', { execBackend: 'interpreter' })` | `createRuntime(ports, 'brep', undefined, { execBackend: 'interpreter' })` | 第 3 参从 options 变为 libs，需显式传 undefined |

其余所有 2 参调用点（3d_editor ×7、faijs-cadquery ×32、faijs-openscad ×6）无需修改——2 参形态在 4 参签名下完全兼容。

**3d_editor cad 覆盖模式**：3d_editor 的 6 处 `createRuntime(ports, mode)` + `runtime.registerLib('cad', createEditorCadNamespace(), ...)` 模式继续工作——createRuntime 自动装配平台 cad，3d_editor 随后 registerLib 覆盖成编辑器 cad（与当前 createRuntimeWithCad 行为一致）。可选优化：改为 `createRuntime(ports, mode, { cad: createEditorCadNamespace() })` 一步到位，但需确认 registerLib 覆盖语义且改动量大，**本期不做，列为后续优化**。

**验证**：
- `npm run test -w @faicad/faijs` 全绿。
- `npm run typecheck` 全绿。
- 四个外部仓各自测试全绿（3d_editor 需重新打包 tgz 后更新）。

### 3.2 阶段 2：门面收敛为 re-export 薄层

**目标**：门面只 re-export，不手写 252 行具名清单；门面与子路径同源。

**改动**：

1. **`index.ts`**：从 252 行手写具名 re-export，收敛为按层的 `export *` + 少量具名 type re-export（处理重名消歧）。

   ```ts
   // ── 共享面 ──
   export * from './env-agnostic'

   // ── L1 几何（brep + mesh + boolean + primitives + sdf + knurl + topology）──
   export * from './brep'        // brep/index.ts 聚合
   export * from './mesh'        // mesh/index.ts 聚合（见下）
   export * from './boolean'     // boolean/index.ts 聚合
   export * from './primitives'  // primitives/index.ts 聚合
   export * from './sdf'
   export * from './topology/naming'

   // ── L2 编排 ──
   export { CadRuntime, createRuntime, createBareRuntime, computeContentKey, AppendPrefixError } from './cad-runtime/runtime'
   export { createPreviewExec } from './cad-runtime/preview-exec'
   export type { ... } from './cad-runtime/runtime'
   export type { ... } from './cad-runtime/ports'

   // ── L3 Host ──
   export { createBrowserPorts } from './browser-host'
   export { ... } from './browser-host/...'

   // ── L3 API 面 ──
   export * from './api'
   export { createApiNamespace } from './api/api-namespace'

   // ── units ──
   export { MM, CM, ... } from './units'

   // ── 重名消歧（显式 re-export 指定权威源）──
   export type { Vec3 } from './lang/types'
   ```

2. **`browser.ts`**：同样收敛。B/C/D 四类分类保留（entry-boundary.test.ts 白名单约束），但每类用 `export *` 而非具名展开。

3. **`weapp.ts`**：已较精简（42 行），主要改 createRuntime re-export 源（阶段 1 已做）。

4. **`node.ts`**：`export * from './index'` 保持，node-host 专用导出保留。

5. **前提**：`brep/`、`mesh/`、`boolean/`、`primitives/` 需要有 `index.ts` 聚合文件。当前 `mesh/` 无 index.ts（B3 删除后）。需新建 `mesh/index.ts`，聚合 `mesh/primitives`、`mesh/transform`、`mesh/query`、`mesh/io`、`mesh/types` 等公开模块。`brep/` 已有 `brep/index.ts`（brep-ops 聚合）。`boolean/`、`primitives/` 需确认是否有 index.ts。

**风险**：`export *` 会改变导出集合——当前手写清单是"白名单"，`export *` 是"全量"。需确认每个子模块的导出都是公开 API，无内部符号泄漏。可通过 `entry-boundary.test.ts` 白名单守卫约束。

**验证**：
- `npm run typecheck` 全绿（导出集合变化可能影响下游类型）。
- `npm run test --workspaces` 全绿。
- 四个外部仓 typecheck + test 全绿。

### 3.3 阶段 3：子路径改显式枚举

**目标**：建立公开边界，内部文件可自由重构。

**改动**：

1. **`package.json`**：把 12 组 wildcard 拆成显式枚举。枚举依据：§2 调研中四个外部仓实际消费的子路径 + 本仓内部消费的子路径。

<details>
<summary>已被外部消费的子路径清单（点击展开）</summary>

**3d_editor 消费**：
- `./node`、`./browser`、`./weapp`、`./api`、`./sdk`、`./export`、`./symbol-table`、`./runtime-state`、`./identity`、`./env-agnostic`、`./units`、`./module-resolver`
- `./mesh/import-model`、`./mesh/threemf-view`、`./mesh/threemf-bambu`、`./mesh/io`、`./mesh/types`、`./mesh/transform`、`./mesh/query`、`./mesh/primitives`、`./mesh`
- `./io/zip`、`./io/fai-zip`、`./io`
- `./topology/build-selector-runtime`、`./topology/build-face-ids`、`./topology/types`
- `./geometry2d/bridge/plane`
- `./cad-runtime/ports`

**faijs-cadquery 消费**：
- `./node`、`./api`、`./sdk`、`./shape`、`./identity`、`./runtime-state`
- `./api/api-namespace`、`./api/cadquery-selectors`、`./api/chamfer-math`、`./api/brep-mirror/topologyFns`、`./api/assembly/types`
- `./occt-kernel/occtKernel`
- `./brep/handle-bridge`、`./brep/engine/types`、`./brep/engine/primitives`、`./brep/brep-ops`、`./brep/text/text-to-solid`、`./brep/text/fontRegistry`、`./brep/export/step`
- `./mesh/types`、`./mesh/rigid-transform`

**faijs-freecad 消费**：
- `./node`、`./io/zip`、`./io/fai-zip`、`./io`、`./identity`、`./symbol-table`、`./units`、`./shape`
- `./api/result`、`./api/api-namespace`、`./api/xml-dom`
- `./occt-kernel/occtKernel`
- `./cad-runtime/runtime`、`./cad-runtime/ports`
- `./mesh/types`、`./brep/handle-bridge`

**faijs-openscad 消费**：
- `./node`、`./units`、`./runtime-state`
- `./occt-kernel/occtKernel`
- `./brep/engine/adapters/occt`、`./brep/engine/registry`

</details>

2. **显式枚举原则**：
   - 已被外部消费的子路径 → 保留为显式枚举。
   - 仅本仓内部消费的子路径 → 保留为显式枚举（本仓测试/构建可能 import）。
   - 无人消费的子路径 → 从 exports 删除（收回为内部）。
   - 新增公开子路径需显式加入 package.json + Agent Note 记录。

3. **保留 wildcard 的例外**：`./api/*` 可考虑保留 wildcard——`api/` 下模块众多且增长频繁，显式枚举维护成本高。但 `./mesh/*`、`./brep/*`、`./cad-runtime/*` 等应改显式（内部文件不应全量暴露）。

**风险**：收回子路径可能导致某个未调研到的下游消费者断裂。缓解：先在 CI 加"子路径使用审计"脚本（扫描 node_modules 下所有 `@faicad/faijs/*` import），确认无遗漏后再收回。

**验证**：
- `npm run build` + `npm run pack` 成功。
- 四个外部仓 `npm ci && npm test` 全绿。
- 子路径审计脚本无遗漏。

### 3.4 阶段 4：重名导出分类处理

**目标**：同名异源真冲突显式指定权威源；同名同源不同面用不同公开名。

**当前重名清单与处理**：

| 重名 | 类型 | 处理 | 现状 |
|---|---|---|---|
| `createRuntime` | 同名异签名 | 阶段 1 已合并为单一实现体 | 待实施 |
| `boolean` | 同名同源不同面（cad 键名 vs 库面 op） | 保持不同公开名：`boolean`（cad 键）/ `booleanOp`（库面，`api/index.ts` 已 `boolean as booleanOp`） | 已做，加 lint 守卫 |
| `compound` | 同名异源（`api/compound-geom` vs `shape`） | 保持不同公开名：`compound` / `structCompound`（`api/index.ts:108` 已做） | 已做，加 lint 守卫 |
| `Vec3` | 同名异源真冲突（`lang/types` vs `mesh/types`） | 显式 re-export 指定权威源：`export type { Vec3 } from './lang/types'`（`index.ts:252` 已做） | 已做 |
| `isCompound` | 同名同源、仅面不同 | 子路径直达，门面不平铺（`api/index.ts` 注释约定） | 注释约定，落成 lint 规则 |

**`api/*/index.ts` 目录门面与 `api-namespace.ts` 双清单**：

13 个 `api/<x>/index.ts`，其中部分未进 cad 命名空间（如 `boolean-op`），仅作深路径 re-export。与 `symbol-table.generated.ts` 作为权威清单的约定打架。处理方向：每个 `api/<x>/index.ts` 必须明确归属——

- **cad 装配来源**：被 `api-namespace.ts` import，是 cad 命名空间的实现模块。
- **库面子路径入口**：被 `api/index.ts` re-export，是库面的公开模块。
- **两者皆是**：同时是 cad 装配来源和库面入口（常见情况）。
- **两者皆不是**：**应删除**或归入上述之一。

本期不逐一核实 13 个目录门面的归属（需逐个 trace 消费方），列为后续子任务。本期只处理 `boolean-op`（已知分叉点）：确认 `api/boolean-op/index.ts` 的消费者，若仅被 `api-namespace.ts` 装配则标注为"cad 装配来源"，若也被库面消费则保持 `boolean as booleanOp` 别名。

### 3.5 阶段 5：防回归守卫

**目标**：防止门面与子路径重新漂移。

| 守卫 | 实现 | 优先级 |
|---|---|---|---|
| 禁止同名导出签名分叉 | lint 规则：同名 `export function` 在不同文件里参数序必须一致（或直接禁止同名异文件导出） | 高 |
| 禁止门面定义新签名 | lint 规则：`index.ts` / `browser.ts` / `weapp.ts` 只允许 `export *` / `export { } from`，禁止 `export function` / `export class` | 高 |
| 禁止文件名带 With/Without/Bare 修饰词 | lint 规则：`*.ts` 文件名匹配 `/(With\|Without\|Bare)/` 时报错（`createBareRuntime` 例外，白名单） | 中 |
| 子路径公开边界 | 脚本：`package.json` 不允许新增 wildcard `./<x>/*`，必须显式枚举 | 中 |
| 子路径使用审计 | 脚本：扫描所有已知下游仓的 `@faicad/faijs/*` import，与 package.json exports 比对，报告未声明的子路径使用 | 低（定期跑） |

## 4. 外部消费点修改清单

### 4.1 必须修改（阶段 1 连带）

| 仓 | 文件:行 | 当前 | 改后 | 原因 |
|---|---|---|---|---|
| 3d_editor | `packages/platform/src/weapp/faijs.worker.ts:100` | `createRuntime(buildWeappPorts(...), 'brep', { execBackend: 'interpreter' })` | `createRuntime(buildWeappPorts(...), 'brep', undefined, { execBackend: 'interpreter' })` | 第 3 参从 options 变为 libs |

### 4.2 无需修改（兼容性确认）

| 仓 | 调用 | 原因 |
|---|---|---|---|
| 3d_editor | 7 处 `createRuntime(ports, mode)` 2 参 | 2 参形态在 4 参签名下兼容 |
| 3d_editor | 6 处 `runtime.registerLib('cad', createEditorCadNamespace(), ...)` 覆盖 | createRuntime 自动装平台 cad 后被覆盖，行为不变 |
| faijs-cadquery | 32 处 `createRuntime(createNodePorts(), 'brep')` 2 参 | 兼容；自动带 cad 正是所需 |
| faijs-freecad | 2 处 `new CadRuntime(ports, 'brep', { cad: ns })` | CadRuntime 构造器签名不变 |
| faijs-freecad | 13 处 `createApiNamespace()` | 不受影响 |
| faijs-openscad | 6 处 `createRuntime(createNodePorts(), 'brep')` 2 参 | 兼容 |
| 全部 | createRuntimeWithCad import | 无（无人直接 import） |

### 4.3 可选优化（本期不做）

| 仓 | 优化 | 理由 |
|---|---|---|---|
| 3d_editor | 6 处 `createRuntime(ports, mode)` + `registerLib('cad', ...)` → `createRuntime(ports, mode, { cad: createEditorCadNamespace() })` 一步到位 | 消除"先装平台 cad 再覆盖"的浪费，但改动量大且需确认 registerLib 覆盖语义 |
| faijs-freecad | 2 处 `new CadRuntime(ports, 'brep', { cad: ns })` → `createRuntime(ports, 'brep', { cad: ns })` | 统一用 createRuntime 入口，但 `new CadRuntime` 语义清晰，非必须 |

## 5. 实施顺序与验证

### 5.1 实施顺序

```
阶段 1（消灭同名异签名）
  ├─ 改 runtime.ts（createRuntime 内部装配 cad）
  ├─ 删 createRuntimeWithCad.ts
  ├─ 改 index.ts / browser.ts / weapp.ts（re-export 源）
  ├─ 新增 createBareRuntime
  ├─ 改 3d_editor weapp worker（1 处调用）
  └─ 验证：core test + typecheck + 四仓 test

阶段 2（门面收敛为 re-export 薄层）
  ├─ 新建 mesh/index.ts（聚合）
  ├─ 改 index.ts（export * 替代手写清单）
  ├─ 改 browser.ts（同上）
  └─ 验证：typecheck + 全量 test + 四仓 test

阶段 3（子路径改显式枚举）
  ├─ 跑子路径使用审计脚本
  ├─ 改 package.json（wildcard → 显式枚举）
  └─ 验证：build + pack + 四仓 ci && test

阶段 4（重名导出分类处理）
  ├─ 加 lint 守卫（boolean/compound/isCompound）
  └─ 验证：lint

阶段 5（防回归守卫）
  ├─ 加 lint 规则（禁止门面定义新签名、禁止同名异签、禁止文件名修饰词）
  ├─ 加脚本（子路径公开边界、使用审计）
  └─ 验证：lint + 脚本
```

### 5.2 每阶段验证清单

每阶段完成后必须通过：

1. `npm run typecheck`（根 + workspaces）
2. `npm run test --workspaces`
3. `npm run lint`
4. `npm run build`
5. 四个外部仓各自 `npm ci && npm test`（3d_editor 需先 `npm run pack` 更新 tgz）
6. `node scripts/check-ghost-deps.mjs`
7. `node scripts/check-lockstep.mjs`

### 5.3 回滚策略

每阶段独立 commit。若某阶段验证失败，`git revert` 该 commit 即可回滚，不影响前序阶段。阶段 1 是最高优先级、最低风险（外部消费点仅 1 处），应首先独立合入。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|---|
| createRuntime 自动装配 cad 导致循环依赖 | runtime.ts import api-namespace.ts 可能循环 | 把装配逻辑放独立模块 `default-cad-lib.ts` |
| 阶段 2 `export *` 导致内部符号泄漏 | 下游意外 import 到非公开符号 | entry-boundary.test.ts 白名单守卫 |
| 阶段 3 收回子路径遗漏下游消费者 | 某下游仓 build 失败 | 先跑审计脚本，四仓全测通过后才收回 |
| 3d_editor tgz 更新不同步 | 3d_editor 仍用旧 tgz | 3d_editor 有 update-faijs 脚本 + lockstep 守卫 |
| createRuntime 自动装 cad 与 3d_editor 覆盖 cad 冲突 | registerLib 覆盖行为变化 | 当前 3d_editor 已在覆盖（createRuntimeWithCad 注册后覆盖），行为不变 |

## 7. 不做的事

- **不**改 CadRuntime 构造器签名（faijs-freecad 直接 `new CadRuntime` 依赖当前签名）。
- **不**改 `api/api-namespace.ts` 的装配逻辑（createApiNamespace 行为不变）。
- **不**逐一核实 13 个 `api/*/index.ts` 目录门面归属（阶段 4 子任务，本期只处理 boolean-op）。
- **不**改 3d_editor 的 cad 覆盖模式为"一步到位"（§4.3 可选优化，后续独立做）。
- **不**改 faijs-freecad 的 `new CadRuntime` 为 `createRuntime`（§4.3 可选优化）。