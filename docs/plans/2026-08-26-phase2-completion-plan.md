# Phase 2 收尾：未完成项设计与实施文档

- 日期：2026-08-26
- 状态：待评审
- 前置文档：`docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md`（总方案，下称「总方案」）
- 范围：**只收尾总方案 Phase 2 的未完成/有偏差项**，不触碰 Phase 3（命名/StmtId 分离）与 Phase 4（.faits/第三方库）。
- 说明：本文档只写方案，不包含实施；所有改动以本文件为准，实施前需用户显式授权。

---

## 0. 需求原话（不准删除）

> 先一篇新的技术实施文档，完成 phase2 的各项未完成任务，并要保证设计无问题，系统能正常运行

三条硬约束，逐条映射到本文档：

1. **完成 Phase 2 各项未完成任务** → §3 任务清单覆盖 2.2 / 2.4 / 2.7 / 2.8（faijs）与 2.9–2.14（3d_editor）。
2. **保证设计无问题** → 消除当前实际代码中的两条红线违规与一处空接口（§2 事实基线），并按总方案 §3 补回被跳过的设计契约。
3. **系统能正常运行** → 首要目标是让 `npm run typecheck` 转绿（当前唯一阻塞是 2.8 半成品），再保证两项目 CI 全绿、3d_editor 消费到新产物。

---

## 1. 事实基线（2026-08-26 真实代码核对，带 file:line）

> 以下结论来自实际代码阅读 + `npx tsc --noEmit` 实证，非 commit message 推断。

### 1.1 已完成（与总方案一致，无需改动）

| 总方案任务 | 证据 |
|---|---|
| 1.1 compileToModule | `src/lang/compile.ts`：零 import ESM、`(ctx,cad,exec)` 三参、deps 翻译（`compile.ts:176-184` 的 group/assembly 也带 `memberNames`） |
| 1.2 ModuleExecutor | `src/cad-runtime/module-executor.ts`：ctx 持久、`afterStatement` 同步 `outputCache`/`shapeToName`（`module-executor.ts:220-240`）、executeAll/Ids/From、reconcileCtx |
| 1.3 ExecContext 实现 | `src/cad-runtime/exec-context.ts`（双内核 + WeakMap 槽） |
| 1.4 内部适配命名空间 | `src/cad-runtime/internal-stdlib-adapter.ts`（group/assembly 已转发 stdlib） |
| 1.5 CadRuntime 重写 | `runtime.ts` 三入口 → ModuleExecutor；collectResult 组装 outputs/brepSolids/topology/compounds（`runtime.ts:508-581`） |
| 1.6/1.7 StmtId 独立 + deps 级联测试 | `parser.ts:845`；`runtime.test.ts:671` |
| 2.1 ops→stdlib | `src/stdlib/` 已落地（drill/geom/compound 等）；`src/ops/` 已空 |
| 2.3 geom 查询 | `src/stdlib/geom.ts`（faceCenter/faceNormal/bboxCenter/bboxMin/bboxMax，末参 exec） |
| 2.5 删 Sets | `brep-chain.ts` 已无 `BREP_NATIVE_OPS/MESH_ONLY_OPS` |
| 2.6 拓扑自动携带 | `runtime.ts:508` collectResult 按 `ExecuteOptions.topology` 构建 BREP 真拓扑；`compounds` 已构建（`runtime.ts:538-544`） |

### 1.2 未完成 / 有偏差（本文档要修）

| # | 问题 | 实证 | 严重度 |
|---|---|---|---|
| **2.8** | `returnType` 四类分类删除只做了一半：`ReturnType` 类型别名仍在，但 `CadStatement.returnType` 字段已删，parser/cli/测试仍引用 → **typecheck 全红（14 处 error TS，全部 returnType）** | `types.ts:78-83`（类型仍在）；`parser.ts:741,901`（字段已删仍读）；`cli.ts:130`；`runtime.test.ts:52-64,558,581,623,631`；`brep-mesh-equivalence.test.ts:59,81`；`args-schema.test.ts:37`；`brep-ops-features.test.ts:554`；`case2-*.test.ts:93` | 🔴 硬阻塞（CI 不绿） |
| **2.4** | `dependentsOf`/`touch` 仍是空壳（返回 `[]` / no-op），但总方案 §3.3/§3.10 要求它们是真实 API；且 `compound.ts` 直接读 `ExecContextImpl` 内部（`exec.outputCache`/`exec.script`/`exec.brepChain.kernel`/`exec.setVariable`）并 import `ExecContextImpl` —— **违反红线（stdlib 依赖引擎实现内部）** | `exec-context.ts:187-198`（placeholder）；`compound.ts:19`（import ExecContextImpl）、`compound.ts:186-211`（`propagateTransformDownstream` 直读 script+outputCache）、`compound.ts:214-262`（solveAssembly 读 `exec.brepChain.kernel`/`exec.outputCache`/`exec.setVariable`） | 🔴 设计缺陷（红线违规 + 空接口） |
| **2.2** | 每 op 的 `assertXxxParams` 自校验未落地（总方案 §3.11 要求），库函数不调 schema，校验只靠集中式 parse 期 `validateStatementArgs` | `src/stdlib/**` 无 `assertXxxParams`；`schemas.ts:249,260` 仅有 `void:true` 标志；`runtime.ts:868` 集中校验存活 | 🟡 设计偏差（Phase 2.11 直引 stdlib 时缺防御） |
| **2.7** | `browser.ts` deprecated 区未删（注释「E12 迁移后移除」），与 3d_editor 未完成耦合；`./stdlib` 导出 + `api-dts-sync.test.ts` 已 OK | `browser.ts:224-255`（deprecated 区仍在） | 🟡 受 2.9/2.12 阻塞（不能现在删） |
| **2.9–2.14** | 3d_editor 侧完全未启动：源文件仍 import 已 deprecated 符号；`node_modules/@faicad/faijs/dist` 仍含旧产物（`src/ops/dispatcher.js`） | `executeScript.ts:19-21,210,220,244,251,827`；`execute-validator.ts:27-28,120,134`；`index.ts:12-13`；`step-converter/index.ts:2`；`contract-entry.test.ts:82,202-225`；`script-engine.test.ts`/`valid-js.test.ts` 大量 `executeStatement`/`initBrepChainState`/`resolveGeomRef` 引用 | 🔴 进度为 0 |

### 1.3 关键设计缺口（1.2 的延伸）

- `ExecutionResult` 没有 `changed` 字段（`runtime.ts:91-116`），而总方案 §3.10 要求 `touch` 把持有 Shape 的变量列入 `ExecutionResult.changed`。**`touch` 即便接好也没有 sink**——必须补 `changed` 字段。
- `compound.ts` 的装配变换靠 `exec.setVariable` 把结果写回 ctx（实现依赖）；但总方案 §3.10 的干净模型是「**原地修改成员 Shape + setSolid 同步 + touch**」，ctx 因持有同一对象引用天然看到变更，无需 setVariable。

---

## 2. 设计修正原则（先定调，再给任务）

### 2.A returnType 删除（2.8）的干净做法

- **类型与字段彻底删除**：`types.ts` 删 `ReturnType` 类型别名（78-83）；`CadStatement` 不加回 `returnType` 字段。
- **void 赋值校验改查 schema 表**：parser 在解析 `const x = cad.op(...)` 时，对「有赋值且 op 的 schema.void===true」抛错。schema 表通过 **parse 入口注入参数**（`parseScript(code, { schemas? })`）传入，避免 `lang` 反向依赖 `stdlib`（红线 1：lang 层不出现 op 名知识；schema 是数据表，注入不破坏该红线）。CadRuntime 调用 parser 时注入 `SCHEMAS`。无表则不校验（与总方案 §2.8「无表不校验」一致）。
- **终端判定去 returnType**：`computeTerminalShapes` 改为「`hasAssignment===true` 且未被其它语句引用为 input/成员」即终端。依据：当前 DSL 中无 `scalar` op（总方案 §1.1 已确认 scalar 无 op 使用），且 `void` op（add_constraint/do_assemble）`hasAssignment===false` 已被排除；group/assembly `hasAssignment===true` 且为 compound → 正确归入终端（总方案 §3.6）。drop returnType 后语义不变。

### 2.B 装配链路走平台 API（2.4）的干净做法

- **`dependentsOf(shape)` 真实化**：在 `ExecContextImpl` 内基于 `script.statements` + `inputs` + `outputCache`（已由 ModuleExecutor 在 `afterStatement` 同步，`module-executor.ts:234`）+ `shapeToName`（`exec-context.ts:124`）递归求下游 Shape。inputs-based 对装配变换足够（装配只沿 `inputs` 链传播）；`$param` 级联属 Phase 3 范畴，不在此补。
- **`touch(shape)` 真实化**：`ExecContextImpl` 增 `touchedShapes: Set<Shape>`；`touch` 写入。collectResult 读 `touchedShapes` → `shapeToName` → `PartName` → 填 `ExecutionResult.changed`（新增字段）。
- **`compound.ts` 红线合规化**：删除 `import { ExecContextImpl }`；`solveAssembly` 只使用 `ExecContext` 接口方法——
  - BREP：`exec.kernels.occt`（取代 `exec.brepChain.kernel`）
  - 链记账：`exec.getSolid/setSolid`（取代直接读 `exec.brepChain`）
  - 下游：`exec.dependentsOf(movingShape)`（取代自带 `propagateTransformDownstream`）
  - 变更声明：`exec.touch(shape)`（取代 no-op）
  - 删除 `exec.outputCache`/`exec.script`/`exec.setVariable` 直读；删除 `propagateTransformDownstream` 函数。
  - **成员/下游变换改为原地修改**：对 member/下游 Shape 做 `Object.assign(shape, applyTransform(shape, ...))`（保留同一对象引用，`ctx.part0` 与 `compound.children[i]` 同步看到变更）。不再依赖 `setVariable` 回写。

### 2.C per-op 自校验（2.2）的契约

- 每个 stdlib op 文件导出 `assertXxxParams(params)`：校验必填字段存在 + 数值范围（如 `drill`: `depth>0`、`position` 为 vec3）。op 函数体在 `resolvePath` 之前调用，非法即抛 `Error`（不静默）。
- 集中式 `validateStatementArgs`（runtime.check，总方案 §2.2 保留）继续作为 parse 期 UX 校验；per-op assert 是 stdlib 被**直接 import** 时的防御层（服务 2.11 预览路径），二者共存不冲突。

### 2.D browser.ts deprecated 区（2.7）的分批

- **2.7a（现在做，无阻塞）**：`./stdlib` 导出、`api-dts-sync.test.ts` 守卫已 OK，确认即可。补充 `gen-api-dts.ts` 从 stdlib schemas 生成（若未接，则接上）。
- **2.7b（gated）**：deprecated 区（`browser.ts:224-255`）的删除**必须在 2.9 + 2.12 完成、3d_editor 不再 import 这些符号之后**进行；否则 3d_editor 编译断。本文档把 2.7b 排到 3d_editor 任务之后。

---

## 3. 任务清单

### 3.1 faijs 侧

#### T1 — 2.8 returnType 彻底删除（🔴 让 typecheck 转绿）

| 项 | 文件:行 | 改动 |
|---|---|---|
| 删类型别名 | `src/lang/types.ts:78-83` | 删除 `ReturnType` 注释 + `export type ReturnType = ...` |
| parser void 校验 | `src/lang/parser.ts:741` | `if (stmt.returnType === 'void')` → 改为注入 schema 判定：`const schema = schemas?.[stmt.op]; if (schema?.void) throw ParseError(\`cad.${stmt.op}() is void, cannot assign\`)` |
| parser 注入 schema | `src/lang/parser.ts` parseScript 签名 | 新增可选参数 `schemas?: Record<string, OpSchema>`（从 `../lang/args-schema` 的 `OpSchema` 类型）；CadRuntime 调用处注入 `SCHEMAS` |
| 终端判定去 returnType | `src/lang/parser.ts:899-911`（computeTerminalShapes） | `const rt = stmt.returnType ?? 'new_shape'` 与两处 `if (rt !== 'new_shape') continue` 删除；改为 `if (!stmt.hasAssignment) continue`；同步更新 874-875 注释 |
| cli 引用 | `src/node-host/cli.ts:130` | `(s.returnType ?? 'new_shape') === 'new_shape'` → `s.hasAssignment` |
| 测试清理 | `runtime.test.ts:52-64`（删 returnType 推导）、`runtime.test.ts:558,581,623,631`、`brep-mesh-equivalence.test.ts:59,81`（filter 改 `s.hasAssignment`）、`args-schema.test.ts:37`、`brep-ops-features.test.ts:554`、`case2-*.test.ts:93` | 删除 fixture 上的 `returnType` 字段赋值；`brep-mesh-equivalence.test.ts:81` filter 改 `s.hasAssignment` |
| 注释清理 | `src/cad-runtime/runtime.ts:6,338`、`args-schema.ts:11-12` | 删除提及 returnType 的注释（行 338 的「returnType 过滤」改为「hasAssignment 过滤」） |

**验收**：`npx tsc --noEmit` 退出 0；`npx vitest run src/lang/parser.test.ts src/lang/args-schema.test.ts` 绿。

#### T2 — 2.4 装配走平台 API（🔴 红线合规 + 空接口接实）

| 项 | 文件:行 | 改动 |
|---|---|---|
| 加 touchedShapes | `src/cad-runtime/exec-context.ts` | `ExecContextImpl` 增 `readonly touchedShapes = new Set<Shape>()` |
| 实现 dependentsOf | `src/cad-runtime/exec-context.ts:187-189` | 基于 `this.script.statements` + `stmt.inputs` + `this.outputCache` + `this.shapeToName` 递归求下游 Shape（inputs-based，含 visited 防环） |
| 实现 touch | `src/cad-runtime/exec-context.ts:196-198` | `this.touchedShapes.add(shape)` |
| ExecutionResult.changed | `src/cad-runtime/runtime.ts:91-116` | 接口增 `changed?: PartName[]` |
| collectResult 填 changed | `src/cad-runtime/runtime.ts:508-581` | 读 `exec.touchedShapes` → `shapeToName` → `asPartName` → 去重 → `changed`（仅当非空） |
| compound 去红线 | `src/stdlib/compound.ts` | 删 `import type { ExecContextImpl }`（:19）；`solveAssembly` 参数类型改 `ExecContext`；成员/下游变换改 `Object.assign(shape, applyTransform(...))` 原地修改；用 `exec.kernels.occt` / `exec.getSolid` / `exec.setSolid` / `exec.dependentsOf` / `exec.touch`；删 `propagateTransformDownstream`（:186-211）与 `exec.outputCache`/`exec.script`/`exec.setVariable` 直读 |

**验收**：`npx vitest run src/cad-runtime/runtime.test.ts`（含 compound/装配用例）；新增断言：① `dependentsOf` 返回下游 Shape；② `touch` 后 `ExecutionResult.changed` 含对应 PartName；③ compound 成员 mesh 被原地变换（ctx 中同名变量同步）；④ grep `compound.ts` 不含 `ExecContextImpl` / `exec.brepChain` / `exec.outputCache` / `exec.setVariable`。

#### T3 — 2.2 per-op 自校验（🟡 设计补全）

| 项 | 文件 | 改动 |
|---|---|---|
| 每 op 加 assertXxxParams | `src/stdlib/{drill,engrave,extrude,...}.ts` | 导出 `assertXxxParams(params)`：必填字段存在 + 范围；op 体首行调用，非法抛错 |
| 接 resolvePath 之前 | 同上 | `assertXxxParams(params); const path = resolvePath(exec, [input], brepImpl)`（与总方案 §3.11 形态一致） |

**验收**：`npx vitest run src/stdlib`（直引 op 传非法参数 → 抛错）；grep `src/stdlib` 至少覆盖创建类 + drill/engrave/extrude 等高频 op 的 assert。

#### T4 — 2.7a 导出面守卫（🟢 基本完成，确认）

- 确认 `package.json` 的 `./stdlib` 导出、`src/api-dts-sync.test.ts` 存在；若 `gen-api-dts.ts` 未从 stdlib schemas 生成，则接上（改 `scripts/gen-api-dts.ts` 读取 `src/stdlib/schemas.ts` 的 `SCHEMAS`）。
- **不做** deprecated 区删除（见 T9 / 2.7b）。

**验收**：`npx tsx scripts/gen-api-dts.ts` 成功；`npx vitest run src/api-dts-sync.test.ts` 绿。

#### T5 — faijs 发版

- `npm run pack`（根目录）→ 产出 `faicad-faijs-0.1.1.tgz`（或更高版本号）。
- 此产物是 3d_editor 任务的输入；**未 pack 前 3d_editor 跑的是旧 dist（含 `src/ops/dispatcher.js`），Phase 2 装配/红线修正对 3d_editor 不可见**。

### 3.2 3d_editor 侧（2.9–2.14，进度 0）

> 实施前置：先完成 T5（pack）+ `3d_editor/npm install` 更新 tgz。以下任务的精确改动点来自对 3d_editor 当前源码的 grep（见 §1.2），实施时需逐文件读取确认。

#### T6 — 2.9 手工执行循环 → CadRuntime 三入口

| 文件 | 改动 |
|---|---|
| `src/engine/script-engine/executeScript.ts:19-21,206-251,789-832` | 删 `initBrepChainState/releaseBrepChainState/executeAssemblyPassForStmt/executeStatement/computeContentKey` import；主路径改 `runtime.execute/append/update`；装配变换交给 stdlib `assembly().do_assemble(exec)`（已随 T2 落地），不再手动调 `executeAssemblyPassForStmt`；保留「每条语句 = 一次 append」的粒度以满足 statement-granularity undo |
| `src/engine/script-engine/execute-validator.ts:27-28,74,120,134` | 删废弃 import；校验逻辑改为基于 `CadRuntime.execute` 结果比对（或如 ScriptEngine 主路径已校验则删除该文件）；`executeStatement`/`initBrepChainState` 导出移除 |
| `src/engine/script-engine/index.ts:12-13` | 删 `executeStatement/validateExecution/computeContentKey/resolveGeomRef` 转发；改导 CadRuntime 相关 |

**验收**：`computeContentKey` 在 3d_editor 侧仍有本地实现（`execute-validator.ts:48`/`VersionStore.ts:61`），不依赖 faijs 导出；grep 生产代码不再 import 上述 deprecated 符号。

#### T7 — 2.10 场景树层级从 `ExecutionResult.compounds` 构建

- `src/stores/tools/model-store.ts` / `ScriptEngine.ts` 的 `buildCombinedTree`：成员各自显示链路不变；层级结构优先读 `ExecutionResult.compounds`（key=compound 变量名，value=成员变量名），回退原「读 DAG 语句 args.members」。

**验收**：group/assembly 语句产物的场景树层级与总方案 §3.6 一致；e2e 场景树 spec 绿。

#### T8 — 2.11 预览走 stdlib 正路径

| 文件 | 改动 |
|---|---|
| `src/renderer/.../LiveDrillPreview.tsx:198` | `cad.drill` 直算 → `import { drill } from '@faicad/faijs/stdlib'` + `CadRuntime.createPreviewExec()`（B 类新增预览 exec，仅带 kernels + getSolid/setSolid，不写 ctx） |
| `src/engine/.../EngravingCore.ts:168` | `cad.engrave` → `import { engrave } from '@faicad/faijs/stdlib'` + 预览 exec |

**验收**：预览交互 spec 绿；grep 不再 `cad.drill(...)`/`cad.engrave(...)` 直算（除 compile 产物命名空间注入外）。

#### T9 — 2.12 step-converter 用高层 API + 2.7b deprecated 区删除

| 文件 | 改动 |
|---|---|
| `src/lib/step-converter/index.ts:2` | `initOcctWasm/getKernel/importStepToMesh/...` 改为 `importStep/exportStep`（browser.ts:97 已导出） |
| `src/browser.ts:224-255` | **T6+T9 完成后**删 deprecated 区（`computeContentKey`/`resolveGeomRef`/`BrepChainState`/`initBrepChainState`/`releaseBrepChainState`/`initOcctWasm` 等）；同步删 `contract-entry.test.ts` 对应白名单项 |

**验收**：grep `execute-validator.ts`/`step-converter`/`script-engine` 不再 import 任何已删符号；`npm run typecheck`（3d_editor）绿。

#### T10 — 2.13 BREP 真拓扑从 `ExecutionResult.topology` 消费

- `src/engine/script-engine/ScriptEngine.ts:596-630`（`_rebuildBrepTopology`）：改读 `ExecutionResult.topology` + setStepRuntime；`buildSelectorRuntime*`/`buildFaceIdsForPart` 仅保留 GLB/primitive/mesh 假拓扑路径。
- `contract-entry.test.ts:200-233` 的 E13 临时段缩到假拓扑构建函数。

**验收**：拓扑消费 spec 绿；白名单 E13 段消失。

#### T11 — 2.14 契约白名单收敛

- `src/engine/__tests__/contract-entry.test.ts:82,200-233`：删 E10/E12/E13 临时放行段；新增断言「几何变更必须走 `CadRuntime.execute`（脚本语句）」——即 grep 生产代码无 `executeStatement`/`initBrepChainState`/`resolveGeomRef` 等直接几何执行符号。

**验收**：`contract-entry.test.ts` 白名单无临时段；新增锁定断言绿。

---

## 4. 实施顺序与依赖

```
T1 (2.8 typecheck 绿)
 └─ T2 (2.4 红线+changed) ─┐
T3 (2.2 assert) ───────────┤
T4 (2.7a 守卫) ─────────────┤
        └────────────── T5 (faijs pack) ──→ 3d_editor npm install
                            └─ T6 (2.9) → T7 (2.10) → T8 (2.11) → T9 (2.12 + 2.7b) → T10 (2.13) → T11 (2.14)
```

- **T1 必须最先做**：它是唯一让 `typecheck` 转绿的项；其它 faijs 改动都在已绿的基座上叠加，便于逐条验证。
- **T5 是 faijs→3d_editor 的闸**：未 pack + 重装前，3d_editor 看不到 T1–T4 的任何修正。
- **T9 的 deprecated 删除依赖 T6/T9-step-converter 完成**：否则 3d_editor 编译断。

---

## 5. 验收标准（系统能正常运行的判据）

1. **faijs 类型/测试**：`npx tsc --noEmit` 退出 0；`npx vitest run` 全绿（含 BREP↔mesh parity）；`scripts/ci.ps1` 绿。
2. **红线 grep（faijs）**：`src/stdlib` 不含 `ExecContextImpl` / `exec.brepChain` / `exec.outputCache` / `exec.setVariable` / `exec.script` 直读。
3. **接口非空**：`dependentsOf` 返回真实下游、`touch` 驱动 `ExecutionResult.changed` 非空（新增测试覆盖）。
4. **3d_editor 分层测试**（lint → tsc → vitest → 组件 → 相关 e2e）：全绿；`contract-entry.test.ts` 无临时段。
5. **3d_editor 红线 grep**：生产代码不再 import `executeStatement`/`initBrepChainState`/`releaseBrepChainState`/`executeAssemblyPassForStmt`/`resolveGeomRef`/`initOcctWasm`/`getKernel`/`computeContentKey`（来自 faijs）等 deprecated 符号。
6. **装配回归**：add_constraint 链式约束真实生效（新测试，补总方案 §1.1 缺口）；compound 成员 mesh 被原地变换且 ctx 同名变量同步；下游 mesh + BREP solid 双覆盖传播。
7. **兼容性**：`partN_vM` 存量 `.faijs` fixture 原样通过（变量名仅字符串，引擎不解释格式）。

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| T1 删 returnType 后 `computeTerminalShapes` 语义漂移 | 经 T1 论证：当前 DSL 无 scalar op、void op 均 `hasAssignment=false`，`hasAssignment` 过滤与旧 `returnType==='new_shape'` 过滤等价；补测试固定「group/assembly 仍入终端、do_assemble 不入终端」 |
| T2 原地修改 Shape 破坏共享引用假设 | 仅 mutation `positions`（同对象、同引用），`applyTransform` 返回新数组经 `Object.assign` 替换；compound.children 与 ctx 变量持有同一对象，天然同步；补测试断言 `ctx.part0 === compound.children[0]` 且 positions 已变 |
| T2 `dependentsOf` inputs-based 漏 `$param` 级联 | 装配下游只沿几何 `inputs` 传播，与 `$param` 无关；`$param` 级联属 Phase 3，不在此补；记录为已知边界 |
| T6 改 CadRuntime 后 undo 粒度变化 | 保持「每条语句 = 一次 append」映射；`beforeStatement` 钩子（module-executor.ts:135）仅对 `hasAssignment` 语句触发，与旧解释器一致；补 undo 重算 spec |
| T9 提前删 deprecated 区致 3d_editor 编译断 | 严格 T9 排序：step-converter 先改高层 API、executeScript 先迁 CadRuntime，再删 deprecated 区 |
| 3d_editor 旧 dist 缓存 | T5 后必须在 `3d_editor` 跑 `npm install`；验证 `node_modules/@faicad/faijs/dist` 不再含 `src/ops/dispatcher.js` |

---

## 7. 非目标（本次不做）

- Phase 3：UI 代码 `partN` 命名、`StmtId` 写回 `CadStatement.id`、终端判定移入执行收尾（isShape 遍历 ctx）。本文档 T1 的终端判定仍保留在 parse 期 `computeTerminalShapes`，仅去 returnType。
- Phase 4：.faits / sucrase / 第三方库动态加载。
- 约束求解器多约束联合求解（stdlib 内部演进，AssemblyBehavior 槽已留位）。
- GLB 只读预览路径移除（契约既定，与本方案无关）。
