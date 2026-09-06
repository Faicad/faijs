# faijs 朝 roadmap 方向重构：近期可落地开发计划（parser 正常化 + 命名空间 + 可发布准备）

- 日期：2026-08-29
- 状态：待评审（仅写计划，未改代码）
- 上位文档：`docs/plans/2026-08-28-faijs-ecosystem-roadmap.md`（路线图）、`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位唯一权威）
- 直接依据：`docs/plans/2026-08-29-faijs-normal-js-subset.md`（parser 差距清单）
- 基线文档：`docs/plans/2026-08-29-faijs-landing-3d-editor-migration.md`（引擎去 exec 已完成 + 3d_editor 迁移闭环）

---

## 0. 用户要求（原话）

> 我需要重构目前的faijs项目，让它朝roadmap的方向前进。你的方案要分析目前代码里不符合长期演化方向的，并且需要修改改掉的部分。并且方案里必须同时考虑../3d_editor项目。所有的api、接口变更，必须同步更新3d_editor项目。方案不需要写太大。写目前可落地且急需变更的部分。

> （2026-08-29，faijs-normal-js-subset）faijs必需是正常的js的子集，除了没有控制流语句。文档错的要改，实现错的要写开发计划。docs根目录下的文档，必需写清楚当前的实现与规范的要求。不能把当前的临时的、甚至错误的实现当成语言规范要求。

> （2026-08-29，landing 方案）我需要的是目前能够落地的方案……每次的功能变更，必需是一个闭环，让3d_editor项目能够成功移植，ci跑通。不准写半吊子的东西。

---

## 1. 当前基线（已完成，不重复做）

引擎 ↔ 库契约重构（`2026-08-29-engine-library-contract-implementation.md` P0–P6 + P7 引擎侧）**已完成并全部验证通过**（804 用例绿、typecheck/lint 干净，未提交）：

| 已就绪能力 | 证据 |
|---|---|
| 全局运行时状态锚点（roadmap V2.1） | `src/runtime-state.ts`（`getRuntimeState()` / `configureBackends` / `keep` / `CONTRACT_VERSION`） |
| Shape 身份表读锚点（两份 faijs 共享状态） | `src/stdlib/shape.ts:36,53,70,76` |
| 编译产物去 exec：`fn(ctx, ns)`、`ns.cad.<callee>` 发射 | `src/lang/compile.ts` |
| **第三方库引擎侧通道已就绪**：`registerLib` / `setNamespaces` / 编译按 `ns.<binding>` 发射 / statementKey 包名前缀 / `assertContractVersion` | 3 个 IR 级用例通过 |
| 3d_editor 迁移闭环方案 | `2026-08-29-faijs-landing-3d-editor-migration.md`（E0–E4，faijs 0.2.0） |

**结论**：roadmap V1.2/V3 的引擎侧不再是瓶颈。**瓶颈全部在 L0 parser 与包发布形态上**——这正是本计划的范围。

---

## 2. 不符合长期演化方向的现状清单（必须修改的部分）

> 判定原则：**实现不是规范**（faijs-normal-js-subset §2）。以下每一项都给出代码证据与归属的处理阶段。

| # | 病灶 | 证据（文件:行号） | 为什么不符合长期方向 | 处置 |
|---|---|---|---|---|
| D1 | **parser 白名单语句形态**：只接受 6 种语句，其余 `unsupported statement` | `src/lang/parser.ts:749-750` | 规范 = 正常 JS 子集（黑名单制），白名单是临时实现 | **F1 修** |
| D2 | **表达式白名单**：`BinaryExpression`/`TemplateLiteral`/`Conditional`/`Spread` 一律 `ParseError` | `src/lang/parser.ts:67-147`（`parseValueExpr`） | 正常 JS 表达式是子集成员；`cad.box({size: base+20})` 必须合法 | **F1 修** |
| D3 | **控制流无专用错误码**：if/for/while 混在笼统 `unsupported statement` 里 | `src/lang/parser.ts:749-750` | 规范唯一禁令就是控制流，必须给明确诊断（V1.5） | **F1 修** |
| D4 | **顶层 import 被包装进函数体** → 语法错误 | `src/lang/parser.ts:504-520` | import 是模块声明非控制流（思考文档 §4），禁它是实现偷懒（roadmap E1/E4） | **F2 修** |
| D5 | **parser 硬编码 `cad` 命名空间 5 处** | `src/lang/parser.ts:127,190,291,613,679`（另 `:550` 包装参数名保留） | `cad` 只是缺省命名空间；`mech.makeHeadstock()` 必须合法 | **F2 修** |
| D6 | **codegen 硬编码 `cad` 前缀** | `src/lang/codegen.ts:82,135` | 同 D5，round-trip 必须能打印 `${ns}.${callee}` | **F2 修** |
| D7 | **编译产物零 import ESM** | `src/lang/compile.ts:1-19`；`src/cad-runtime/module-executor.ts:34-47` | 零 import 是加载实现取舍，不能反向阉割语言（roadmap E4）；但**改它涉及模块运行时整体** | **明确不做**（排期到 V3，见 §6） |
| D8 | **`package.json` `private: true`、无 SDK 入口** | `package.json:4,8-33` | roadmap V2：第三方库必须能 `npm i @faicad/faijs` 并 `import ... from '@faicad/faijs/sdk'` | **F3 修** |
| D9 | **根入口静态 import three / node:fs** | `package.json:49-55`；`dist/` 130 个 ESM 文件 | SDK 必须零 heavy 依赖（roadmap §3.3 实测证据） | **F3 修**（新增独立 sdk 入口，不动根入口） |
| D10 | 函数定义 → `unsupported statement` | `src/lang/parser.ts:749-750` | 思考文档 §3 预设"未来支持"；但依赖 DAG/特征对应规则，非急需 | **明确不做**（排期 V1.3，见 §6） |
| D11 | OCCT 三角化 × manifold 混合布尔缺口 | landing 文档 §5-2 | 已知兼容缺口，现有路径不触发 | **记录不修** |

---

## 3. 范围裁定（落地且急需 = F1 + F2 + F3）

| 阶段 | 内容 | 对应上游计划 | 为什么急需 |
|---|---|---|---|
| **F1** | parser 白名单 → 黑名单：语句形态放开 + 表达式扩展 + 控制流专用错误码 | normal-js-subset **P1**（+ V1.5） | 语言正常化的地基；AI 生成代码大量被表达式白名单误杀（思考文档 §1「AI 不擅长生成 partN_vM」同源问题） |
| **F2** | 顶层 import 段 + 多命名空间调用 | normal-js-subset **P2 + P3** | 引擎侧通道已就绪（§1），只差 parser——这是打通"车床场景"（roadmap R4）的最短路径 |
| **F3** | 可发布准备：`@faicad/faijs/sdk` 入口 + 包元信息 | roadmap **V2.2 / V2.4** | 没有 SDK 入口，第三方库无法开发——F2 打通后立刻需要 |

**明确排除**（避免半吊子，见 §6）：P4 函数定义、P5/V3 模块运行时（ModuleResolver、bundle 通道、importmap、Worker 沙箱）、faits 执行路径、npm publish 流水线本身（V2.5）、V4/V5。

---

## 4. F1 —— parser 白名单 → 黑名单（语句 + 表达式 + 错误码）

### 4.1 目标

语言形态接近规范：唯一拒绝项是控制流 + `eval`/`new Function` + 动态 `import()` + `export`。既有合法脚本的 **parse → codegen → parse 往返逐位相等**（S-5 不变式不破）。

### 4.2 faijs 侧改动

| 改动 | 文件 | 说明 |
|---|---|---|
| 语句 walk 放开 | `src/lang/parser.ts:749-750` | 接受非控制流语句形态（表达式语句、任意调用、多声明器等）；拒绝清单收敛为黑名单 |
| 控制流专用错误码 | `src/lang/parser.ts` | if/for/while/do/switch/try/动态 import → `stage:'parse'` 专用诊断码（如 `E_CONTROL_FLOW`），不再笼统 `unsupported statement` |
| `parseValueExpr` 扩展 | `src/lang/parser.ts:67-147` | 支持 `BinaryExpression` / `UnaryExpression`（全）/ `TemplateLiteral` / `ConditionalExpression` / `SpreadElement` |
| IR 存储形态 | `src/lang/types.ts`、`compile.ts` | **采用 normal-js-subset O1 的建议：编译期求值折叠为字面量**（无控制流 → 可静态求值；IR 零改动）。引用其他语句变量的表达式若无法静态求值 → parse 期明确报错，不发明运行时求值机制 |
| codegen 打印新表达式 | `src/lang/codegen.ts` | 折叠后的字面量按现有规则打印，往返不变式自动满足 |
| `codeToArgs` 行为 | `src/lang/code-to-args.ts` | 参数为表达式时**求值后返回字面值**（与编译期折叠一致），不抛错 |

### 4.3 对 3d_editor 的影响与同步修改

| # | 影响点 | 证据 | 同步修改 |
|---|---|---|---|
| F1-E1 | feature 编辑面板用 `codeToArgs` 取参数 | `3d_editor/src/engine/features/{primitive,knurl,extrude,engrave,transform,split,drill}.ts`（均 `codeToArgs(codeLine)`） | 参数含表达式时 `codeToArgs` 返回折叠后的字面值——**编辑面板若把字面值写回，表达式会丢失**（`base+20` → `120`）。3d_editor 需加判定：源码行含非字面量参数的特征，编辑面板**降级为只读/代码编辑**，禁止表单写回。判定依据由 faijs 在 `StatementSummary` 增加 `hasComputedArgs: boolean` 提供（`src/lang/statement-summary.ts`） |
| F1-E2 | 回归锚点 | — | 既有合法脚本（当前 3d_editor 能录出的全部形态）`parse → codegen → parse` 逐位相等；3d_editor 侧零行为变化 |

### 4.4 验收

- `cad.box({ size: base + 20 })`、`cad.box({ name: \`板-${n}\` })`、`cad.drill(p, { depth: flag ? 5 : 0 })` 全部通过 parse（normal-js-subset §4 P1 判据，其中引用语句变量的表达式按 §4.2 静态求值规则处理）。
- if/for/while/switch/try/动态 `import()` → 专用错误码。
- 既有 fixture（`test/faijs/**`）round-trip 全绿；新增表达式形态 round-trip 逐位相等。
- 3d_editor：含表达式参数的特征节点显示只读参数，无表单写回路径。

---

## 5. F2 —— 顶层 import 段 + 多命名空间调用

### 5.1 目标

`import * as mech from 'mech-lib'` + `mech.makeHeadstock(...)` 在 parse/codegen/IR 层完整落地，与**已就绪**的引擎通道（`registerLib` / `ns.<binding>` 发射 / statementKey 包名前缀 / 版本校验）对接，端到端可执行。

### 5.2 faijs 侧改动

| 改动 | 文件 | 说明 |
|---|---|---|
| import 预扫描提升 | `src/lang/parser.ts:504-520` | parse 前预扫描顶层 import 声明，提到 `export default async (cad) => {...}` 包装之外；行号偏移（`:509`）同步修正 |
| `ScriptIR.imports: ImportIR[]` | `src/lang/types.ts` | `ImportIR = { specifier, kind: 'namespace'\|'named'\|'default', localName, packageName }`；`packageName` 由 specifier 推导（`@scope/pkg/sub` → `@scope/pkg`） |
| codegen 打印 import 段 | `src/lang/codegen.ts` | import 段写回文件头，round-trip 逐位相等 |
| 命名空间放开 | `src/lang/parser.ts:127,190,291,613,679`（5 处）+ `codegen.ts:82,135`（2 处） | 统一 `(packageName, callee)` 二元组；`StatementIR.namespace` / `CallRefIR.$call.namespace`（字段已在 P7 引擎侧预留） |
| compile 按 ns 发射 | `src/lang/compile.ts` | `cad.*` → `ns.cad.*` 不变；第三方 → `ns.<binding>.*`（引擎侧已支持，此处只需 parser 产出 `namespace` 字段） |
| 约束 | parser | 只允许 import 不允许 export；import 必须在文件头部连续段；不支持动态 `import()` |
| `codeToArgs` | `src/lang/code-to-args.ts:25-28` | `NON_DECL` 增加可选 `namespaces` 参数（L0 不得感知注册表） |
| `StatementSummary` | `src/lang/statement-summary.ts` | 增加 `namespace?` / `packageName?`（timeline 的"带包名"标识来源，思考文档 §3） |

**编译产物仍保持零 import**（D7 不在本期范围）：第三方库对象由宿主 `import(url)` 后 `registerLib(binding, mod)` 注入 namespaces——这条路径**已验证**，不依赖编译产物携带 import。

### 5.3 对 3d_editor 的影响与同步修改

| # | 影响点 | 证据 | 同步修改 |
|---|---|---|---|
| F2-E1 | feature 按 op 名唯一 | `3d_editor/src/engine/features/index.ts:118`（`getFeatureByOp(op)`）；`ScriptEngine.ts:44-50,432-433` | `getFeatureByOp(op)` → `getFeatureByOp(packageName, op)`；内置特征 `packageName='cad'` 走原表；未知第三方函数 → **timeline 只读函数名节点，不支持特征编辑面板**（思考文档 §3 已定论） |
| F2-E2 | 库注册时序 | `3d_editor/src/engine/script-engine/ScriptEngine.ts:83-93` | **注册必须先于 check/execute**：`getRuntime()` 尾部完成已安装库的 `import(url)` + `assertContractVersion` + `registerLib` |
| F2-E3 | 快照持久化 | 参照 `3d_editor/src/engine/version-store/SvgAssetStore.ts` 的 export/restore 范式 | `sceneScript` 含第三方 import 时，快照记录库清单（`packageName → {url, version, contentHash}`）；restore 后**先注册再 check** |
| F2-E4 | 回归锚点 | — | statementKey：`cad.chamfer` ≠ `mech-lib.chamfer`（faijs 侧已有 IR 级用例，parser 落地后补端到端用例） |

### 5.4 验收

- `import * as mech from 'mech-lib'` + `mech.makeHeadstock(...)` → `parse → codegen → parse` 往返逐位相等（含 import 段与命名空间前缀）。
- 用 mock 模块（data: URL）模拟 `mech-lib` 端到端执行成功，产物进 `ExecutionResult.outputs`，与内置 op 产物可混合 `cad.union`（normal-js-subset §4 P2/P3 判据 + roadmap §11）。
- 未登记 specifier 的命名空间调用 → check ② 明确报错（不回退、不静默）。
- 3d_editor：安装 mock 库后 timeline 出现只读 `mech-lib.makeHeadstock` 节点；快照 export/restore 往返几何一致。

---

## 6. F3 —— 可发布准备（SDK 入口 + 包元信息）

### 6.1 目标

第三方库能 `import { solid, fromBrep, isShape, keep, getBackends } from '@faicad/faijs/sdk'` 开发，SDK **零 heavy 运行时依赖**。**不做** npm publish 流水线本身（V2.5，单独排期）。

### 6.2 faijs 侧改动

| 改动 | 文件 | 说明 |
|---|---|---|
| 新增 `src/sdk.ts` | 新增 | 导出纯数据/纯函数面：`Shape`/`SolidShape`/`CompoundShape` 类型、`solid`/`fromBrep`/`compound`/`isShape`/`isCompound`/`hasBrep`/`brepOf`、`keep`/`keepHidden`、`getBackends`/`configureBackends` 类型、`BrepUnsupportedError`、`CONTRACT_VERSION`。**只 import `runtime-state` 与 `stdlib/shape`**（两者均零 heavy 依赖），`import type` 取 occt-wasm 类型 |
| `exports` 加 `./sdk` | `package.json:8-33` | 指向 `dist/sdk.js` / `dist/sdk.d.ts`；additive，根入口/`browser`/`stdlib` 不动 |
| SDK 依赖守卫 | 测试 | 新增守卫测试：`dist/sdk.js` 的静态 import 闭包不含 `three` / `occt-wasm`（值导入）/ `node:*` |
| 包元信息 | `package.json` | 去 `private: true`；补 `license` / `repository` / `keywords`（roadmap V2.4） |
| README 库开发指南 | `README.md` | 简述第三方库契约（签名形态、keep、fromBrep、contractVersion） |

### 6.3 对 3d_editor 的影响

**零影响**。`./sdk` 是纯新增子路径，3d_editor 现有导入（`@faicad/faijs/browser`、`/stdlib`）不变。3d_editor 仅做依赖 tarball 升级 + 回归（闭环步骤，见 §7）。

### 6.4 验收

- `dist/sdk.js` 静态 import 闭包守卫测试通过（零 `three` / `node:*` / occt 值导入）。
- `import { solid, isShape } from '@faicad/faijs/sdk'` 在裸 node / 浏览器（importmap 指向单文件）可用；两份独立加载的 faijs 构造的 Shape 互相 `isShape()` 成立（锚点已有测试，sdk 入口补一条）。

---

## 7. 执行顺序与闭环纪律（每阶段独立可交付）

**闭环定义**（沿用 landing 文档 §3）：一阶段 = faijs 改动 + 自测 → 版本号递增 + `npm run pack` → 3d_editor 升级依赖 + 对应修改 → 3d_editor 测试/CI 验收。任何一步失败则该闭环不交付、退回修复。

| 步 | 内容 | faijs 验收 | 3d_editor 验收 |
|---|---|---|---|
| **Step 0** | landing 文档 Step 0–3 先完成（0.2.0 打包 + 3d_editor 迁移），本计划在其之上叠版 | landing §4 | landing §4 |
| **Step 1（F1）** | parser 黑名单化 + 表达式 + 错误码；版本 → 0.3.0 | §4.4 全部；既有 fixture round-trip 零回归 | 升级 tarball；F1-E1 只读降级改造；CI 全绿 |
| **Step 2（F2）** | 顶层 import + 命名空间；版本 → 0.4.0 | §5.4 全部（含 mock 库端到端） | 升级 tarball；F2-E1/E2/E3 三项改造；timeline 只读节点 + 快照库清单用例；CI 全绿 |
| **Step 3（F3）** | SDK 入口 + 包元信息；版本 → 0.5.0 | §6.4 全部 | 升级 tarball + 全量回归（无代码修改） |

**每步公共纪律**：
- faijs 侧：`npm run lint` → `npx tsc --noEmit` → 相关 vitest 单文件逐个跑（不跑全量找 bug）→ 全绿后 `npm run pack`；`demo/package.json` tarball 引用同步递增（AGENTS.md 硬约定）。
- 3d_editor 侧：分层测试流程（lint → tsc → vitest → build → 只跑相关 playwright spec）；一次一个测试进程，不跑并发。
- 版本纪律：每次 pack 前版本号递增；破坏性变更（F1 的 `StatementSummary` 新增字段、F2 的 `getFeatureByOp` 签名）在 3d_editor 迁移清单中逐条对应。

---

## 8. 明确不做的部分（单独排期，不留半截状态）

| 项 | 上游 | 排除原因 |
|---|---|---|
| 函数定义（faijs 顶层 `function`） | normal-js-subset P4 / roadmap V1.3 | 依赖 DAG 跳过非几何语句与 feature=包名.函数名 规则，非当前瓶颈 |
| 编译产物携带 import（模块运行时） | normal-js-subset P5 / roadmap V3 | 依赖 ModuleResolver、bundle 构建通道、importmap 改造（3d_editor `vite.config.ts`）——整体方案在 roadmap §3/§5，单独排期 |
| npm publish 流水线 | roadmap V2.5 | F3 只做到"包可发布形态"，发布动作本身单独排期 |
| faits 执行路径 | roadmap §7 / V4.3 | 独立增量 |
| 库市场 / Worker 沙箱 / 多版本共存 | roadmap V4/V5 | 生态与加固阶段 |
| D11 混合布尔缺口 | landing §5-2 | 已知缺口，现有路径不触发，记录不修 |

---

## 9. 证据索引（本计划引用的代码事实）

| 事实 | 位置（已逐一核实） |
|---|---|
| parser 语句白名单拒绝点 | `src/lang/parser.ts:749-750` |
| 表达式白名单 | `src/lang/parser.ts:67-147` |
| 包装函数（import 落进函数体） | `src/lang/parser.ts:504-520`，行号偏移 `:509` |
| `cad` 硬编码 5 处 | `src/lang/parser.ts:127,190,291,613,679`（已 grep 核实） |
| codegen `cad` 硬编码 | `src/lang/codegen.ts:82,135` |
| 编译产物零 import | `src/lang/compile.ts:1-19` |
| 运行时锚点已实现 | `src/runtime-state.ts`（`getRuntimeState()` / `CONTRACT_VERSION` / `assertContractVersion`） |
| Shape 身份表已读锚点 | `src/stdlib/shape.ts:36,53,70,76` |
| `private: true` / 无 sdk 入口 / 依赖 three+occt+manifold | `package.json:4,8-33,49-55` |
| 引擎侧第三方库通道已就绪 | `2026-08-29-faijs-landing-3d-editor-migration.md` §1（P7 引擎侧，3 个 IR 级用例） |
| 3d_editor feature 按 op 唯一 | `3d_editor/src/engine/features/index.ts:118`；`ScriptEngine.ts:44-50,432-433` |
| 3d_editor feature 面板用 codeToArgs | `3d_editor/src/engine/features/{primitive,knurl,extrude,engrave,transform,split,drill}.ts` |
| 3d_editor runtime 懒建（注册时序风险点） | `3d_editor/src/engine/script-engine/ScriptEngine.ts:83-93` |
| 3d_editor 快照资产范式参照 | `3d_editor/src/engine/version-store/SvgAssetStore.ts` |
