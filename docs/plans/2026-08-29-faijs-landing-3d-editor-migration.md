# faijs 引擎去 exec 落地：3d_editor 迁移与 CI 闭环方案

日期：2026-08-29
类型：落地执行方案（非设计文档）
替代：`2026-08-29-engine-library-contract.md` / `2026-08-29-engine-library-contract-implementation.md` 中以"P7 第三方库端到端"为终点的编排

## 0. 为什么重写这份方案（用户原话）

> 那这个方案就是错误的呀。我需要的是目前能够落地的方案。给我写一份新的方案。写明当前完成了哪些功能，3d_editor项目如果对应修改。比如每次的功能变更，必需是一个闭环，让3d_editor项目能够成功移植，ci跑通。不准写半吊子的东西。

上一方案以 P7"第三方库端到端"（`.faijs` 源码里 `import * as mech from 'mech-lib'`）为最终目标；
但 P7 依赖**尚未实施**的 parser 计划（`faijs-normal-js-subset` 的 P2/P3：顶层 import + 命名空间调用），
方案无法整体落地——这正是"半吊子"。

本方案改以**当前已完成且全部验证通过**的功能为基线（P0–P6 + P7 引擎侧），
把**3d_editor 移植**作为落地闭环的核心：每一处功能变更都做到
"faijs 改动 → 自测 → 打包 → 3d_editor 升级 → 对应修改 → 3d_editor 测试/CI 验收"的完整闭环；
**无法落地**的部分（`.faijs` import 第三方库）明确排除、单独排期，不留半截状态。

## 1. 当前已完成并验证通过的功能（基线）

全部在 `C:/my/Faicad/faijs` 当前工作区，**未提交**。

| 期 | 内容 | 验证 |
|---|---|---|
| P0 | 新增 `src/runtime-state.ts` 全局锚点（Backends / 当前语句 / Shape 身份表），零依赖 | `runtime-state.test.ts` 6 用例 |
| P1 | Shape 构造器身份表改读锚点；新增 `fromBrep` / `hasBrep` / `brepOf` / `nameOfShapes` | `shape.test.ts` 7 用例 |
| P2 | stdlib 18 个文件去 exec：改 `getBackends()`，BREP 产物经 `fromBrep()` 登记；`BrepUnsupportedError` 移入锚点层 | runtime/keep/execute-code/compile 全绿 + 4 条 grep 断言 |
| P3 | keep() 改 import 入口；删 `deriveMemberNames`（成员名经 keep 反查）；`setCurrentStmt`/`setName`/`setKeepSink` 三处切换 | `keep.test.ts` 27 用例 + grep 断言零残留 |
| P4 | 分派与 `part-brep-lost` 事件收归引擎：`backend-dispatch.ts` 取代 `resolve-path.ts`；knurl/sdf 不再 emit | runtime.test 事件用例 + grep 断言 |
| P5 | 编译产物去 exec：`fn(ctx, ns)`、`ns.cad.<callee>` 发射、**删除 exec-context.ts**（核心目标） | compile.test 逐字断言（`fn: async (ctx, ns)`）+ 120 用例 |
| P6 | 装配重做（求解 ≠ 传播）：库只 `solveTransforms`，引擎应用变换 + DAG 重放下游；`do_assemble` 幂等 | 4 个专项用例（幂等 / 下游 drill mesh+BREP 同步 / STEP 导出 / compounds 成员名） |
| P7 引擎侧 | `registerLib` / `setNamespaces` / statementKey 包名前缀 / `assertContractVersion` 版本校验 / 编译按 `ns.<binding>` 发射 | 3 个 IR 级用例（IR 构造带 namespace 的 StatementIR 端到端执行） |
| 总检查 | 手册 §13 全部 grep 断言零残留 | `npm test`：**58 文件 / 804 通过 / 9 跳过 / 0 失败**；typecheck、lint 干净 |

实施中顺带修复的既有缺陷：
- `drillBrep` 通孔判定：契约 `depth<=0` 表示通孔，原实现只判 `===0`，`depth<0` 产生零高圆柱导致 OCCT 崩溃（该路径此前零 e2e 覆盖）。

**范围明确**：以上是"引擎去 exec + 双链路契约 + 装配重做"的全部内容，不包含 P7 的 `.faijs` import 端到端（见 §5）。

## 2. faijs 对 3d_editor 的 API 变化清单

3d_editor（`C:/my/Faicad/3d_editor`）经 `file:../faijs/faicad-faijs-0.1.9.tgz` 依赖 faijs，
从 `@faicad/faijs/browser` 与 `@faicad/faijs/stdlib` 两个子路径导入。

### 2.1 未变化的（占导入面绝大多数）

`CadRuntime`、`isMeshShape`、`codeToArgs`、`formatCodeLine`、`SelectorRuntime`、`buildSelectorRuntime`、
`mergeBufferGeometries`、`computeSection`、`buildExtrudedProfile`、`getScrewSpec/getScrewSpecs/threadToPitchMm/makeScrew`、
`subdivide`、`applyKnurlDisplacement`、`geoToManifoldMesh`/`manifoldMeshToGeo`、`solveFaceMate`/`applyTransform`、
`NRAD_MIN/MAX`、`HostPorts` 结构、`ExecutionResult` 结构、`StmtId/PartName/JsonValue` 等——**全部未变**。

### 2.2 变化的（3d_editor 需要对应修改的点）

| # | 变化 | 旧 | 新 | 对 3d_editor 的影响 |
|---|---|---|---|---|
| 1 | stdlib 库函数签名 | `(input, params, exec)` 末参注入 | `(input, params)` 源码形态 | `LiveDrillPreview.tsx` 直调 `drill(target, params, createPreviewExec())` 的第三参不再被读取；且 drill 内部改读全局 backends（§3-E2） |
| 2 | exec 上下文 | `exec-context.ts`（ExecContext/ExecContextImpl） | 已删除；`BrepUnsupportedError` 移至 runtime-state | 3d_editor 不 import 该内部文件，无直接编译影响 |
| 3 | 预览路径 | stdlib 从 `createPreviewExec()` 读内核/模式（mesh） | stdlib 从 `getBackends()` 读（CadRuntime 构造时自动装配） | 预览必须在 runtime 已构造的前提下直调 stdlib；`createPreviewExec` 保留导出但已无内部作用（§3-E2） |
| 4 | `part-brep-lost` 事件 | knurl/sdf 库内 emit（auto 模式、语句执行前） | 引擎 afterStatement 统一发（语句执行成功、上游在 BREP 链而输出断链） | 事件结构（partName/op/reason）不变，监听端无需改；语义：执行失败的语句不再发 |
| 5 | CadRuntime | 构造只建 executor | 构造时自动 `configureBackends`；新增 `registerLib` / `getStatementCacheEntry` | 零改动即兼容；新 API 为只读/扩展 |
| 6 | StatementIR | — | 新增可选 `namespace` 字段（P7 预留） | 无影响（parser 尚未产出该字段） |
| 7 | drill BREP 通孔 | `depth<0` 崩溃 | `depth<=0` 正确通孔 | 传 `depth<0` 的 BREP 钻孔子段结果被修复 |

## 3. 3d_editor 迁移清单（每项一个闭环）

**闭环定义**：一项功能变更 = faijs 改动 + 自测 → `npm run pack` 出 tarball → 3d_editor 升级依赖 + 对应修改 → 3d_editor 测试/CI 验收。任何一步失败则该闭环不交付、退回修复。

### E0：faijs 版本号 bump + 打包（破坏性变更 → 0.2.0）

- 改动：`package.json` 版本 0.1.9 → **0.2.0**（P2–P6 全部是破坏性 API 变更，按 AGENTS.md"打包发布前必须更新版本号"）
- 闭环：`npm run typecheck` + `npm test`（804 绿）→ `npm run pack` → 根目录 `faicad-faijs-0.2.0.tgz`
- 验收：tarball 存在；`exports` 指向 dist；`demo/package.json` 同步指向 `faicad-faijs-0.2.0.tgz`（AGENTS.md：改 faijs 后必须 pack + demo npm install，否则 demo 跑旧产物）

### E1：3d_editor 升级依赖 + 编译基线

- 改动：`3d_editor/package.json` 的 `@faicad/faijs` 指向 `file:../faijs/faicad-faijs-0.2.0.tgz` → `npm install`
- 验收：`3d_editor` 的 `npm run typecheck` 通过——**编译面零破坏**（§2.2 中除 E2 外均无编译影响）

### E2：预览路径改造（唯一的语义破坏点）

- 文件：`3d_editor/src/engine/components/drill-hole/LiveDrillPreview.tsx`
- 现状：`await drill(targetShape, drillParams, createPreviewExec())`（第三参传 preview exec）
- 问题：新 drill 签名 `(input, params)`，第三参被忽略；且 drill 内部 `dispatchPath` 读**全局** `getBackends()`（CadRuntime 构造时装配），不再读传入的 exec；`createPreviewExec()` 的 'mesh' 模式语义不再生效。
- 改动：
  1. 删除第三参：`await drill(targetShape, drillParams)`
  2. 保证前置：预览入口前确保 CadRuntime 已构造（3d_editor 的 ScriptEngine 单例在首次执行时才懒建——若用户在首个几何执行前打开钻孔子段预览，`getBackends()` 会抛 "backends not configured"；需在应用启动/进入编辑时确保 runtime 构造，或预览入口显式 `await getRuntime()`）
  3. 路径正确性：预览的目标 shape 是视口 mesh（未注册 Shape → 不在 BREP 链），auto 模式下 `dispatchPath` 自然走 mesh 路径，与旧 preview exec 的 'mesh' 强制语义等价
- 验收：`LiveDrillPreview` 相关 vitest 全绿 + playwright 钻孔子段用例（预览出孔、不提交几何）

### E3：3d_editor 全量回归 + CI

- 改动：无（纯验证）
- 验收：`3d_editor/scripts/ci.ps1`（或对应脚本）全绿——vitest 全量 + playwright 子集 + lint + tsc

### E4（后续清理，可选）

- 3d_editor 全仓 `grep "createPreviewExec"`——若无其他使用者，后续版本从 faijs 删除该导出（本次保留兼容）

## 4. 闭环与 CI 验收标准

| 环节 | 命令/标准 |
|---|---|
| faijs 自测 | `npm run typecheck`、`npm run lint`、`npm test`（804 通过 / 0 失败） |
| faijs 打包 | `npm run pack` → `faicad-faijs-0.2.0.tgz`（`prepack` 自动 build） |
| faijs CI | `pwsh -NoProfile scripts/ci.ps1`（lint → typecheck → build → vitest + stderr 检查 → pack + demo e2e）——demo 依赖新 tarball，故 E0 必须同步 demo 依赖 |
| 3d_editor 升级 | `npm install`（tarball 指向 0.2.0） |
| 3d_editor 修改 | §3-E2 |
| 3d_editor 验收 | typecheck → vitest 全量 → playwright 子集 → CI 全绿 |

版本纪律：每次 pack 前 faijs 版本号递增；demo 与 3d_editor 的 tarball 引用同步更新。

## 5. 明确不做的部分（避免半吊子）

1. **`.faijs` 源码 import 第三方库**（`import * as mech from 'mech-lib'` + `mech.makeHeadstock(...)`）：
   依赖 `faijs-normal-js-subset` 计划的 P2/P3（parser 支持顶层 import 与命名空间调用），**该 parser 工作未实施**。
   引擎侧通道已就绪并通过 IR 级测试（`registerLib`、编译按 `ns.<binding>` 发射、statementKey 包名前缀、版本校验），
   parser 落地后即可端到端打通——**单独排期，不混入本次落地**。
2. **OCCT 三角化网格 × manifold 混合布尔缺口**：BREP 链产物与 mesh-only 产物混合 `union`（auto 模式回落 mesh 路径）时，
   OCCT 三角化网格对 manifold-3d 不流形（"Not manifold"）。独立于本次迁移的已知兼容缺口，**记录不修**；
   3d_editor 现有路径（全部输入同链）不触发。

## 6. 执行顺序（每步独立可交付、CI 可跑通）

| 步 | 内容 | 验收 | 交付物 |
|---|---|---|---|
| Step 0 | faijs 0.2.0：版本号 + pack + demo 依赖同步 | tarball 生成、faijs CI 全绿 | `faicad-faijs-0.2.0.tgz` |
| Step 1 | 3d_editor 升级依赖（E1） | 3d_editor typecheck 通过 | 依赖升级提交 |
| Step 2 | LiveDrillPreview 改造（E2） | 相关 vitest + playwright 子段用例通过 | 预览路径修复提交 |
| Step 3 | 3d_editor 全量回归 + CI（E3） | 3d_editor CI 全绿 | 迁移完成 |
| Step 4（后续） | parser 计划（faijs-normal-js-subset P2/P3）→ P7 端到端 | 独立排期 | — |

**验收总则**：本方案不含任何"待办但未验证"的条目——每一行落地内容都在其对应步骤的 CI 中可验证。
