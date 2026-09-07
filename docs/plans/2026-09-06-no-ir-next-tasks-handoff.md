# 无 IR 双通道执行 —— 后续任务移交清单（开发接力）

日期：2026-09-06
状态：已落地（T1–T6 全部完成）
基线：`C:\my\Faicad\faijs` main 分支，commit `f1855ec` 之后的 4 笔功能提交：`6afbb0e`（P1–P4 guarded direct runtime）、`9ede3ed`（E4 执行选项）、`0f7257a`（P5 多文件引擎侧）、`96ad085`（E6/E7）
主方案：`docs/plans/2026-09-06-no-ir-dual-channel-runtime.md`（P1–P6 全部实施内容；本文件是其**剩余任务执行单**，按依赖排序，可逐项独立交付）

> 写给接手的开发者：先读主方案 §1–§6 与本文件的「红线与纪律」，再按 T1→T6 顺序推进。每一项完成后**先跑自己测试，再跑受影响测试，全绿后才准跑仓库级 CI**；严禁用 CI 找 bug。文档类修复（T6）在功能完成前一律不做（用户已明确：先功能后文档，当前 doc-sync 的 verify-md-wrap 报错属已知 backlog，功能收尾后统一清）。

## 0. 当前状态（接手即验证的基线）

- 执行链仍是双路径共存：module 路径（parseScript → compileToModule → ModuleExecutor → computeLeafTerminals）**是缺省**；direct 路径（extractMetadata → DirectExecutor → computeLiveShapes）是 `CadRuntimeOptions.executor:'direct'` 可选通道。
- 已落地：MetadataExtractor（analyzeCode/codeToArgs 建于其上）、DirectExecutor（共享 ctx/append 增量/update 全量重跑/failedAt.lineNo/顶层函数/容器体/模块作用域 import 跳过）、computeLiveShapes、CadRuntime guarded direct（execute/append/update 分支 + collectDirectResult + E4 beforeStatement+E_EXEC_LIMIT + E6 failedAt.index 语句序数 + E7 direct check 语法门禁）、多文件引擎侧（HostPorts.projectLoader + ModuleRegistry + import 绑定 ctx 预置 + 命名空间成员引用）、A-5 参数引用保真（引擎面）。
- 测试基线（本地全绿）：core 85 文件 / 1240；tests 74 文件 / 1537；`packages/tests/faijs/no-ir/` 207（a16 61 + a17 40 + a14 40 + runtime-direct-mode 52 + multifile 8 + a1-a15 6）；typecheck / lint / export-jsdoc 绿。
- 仓库级 CI：脚本按步即停已推进到 **8/9 doc-sync** 才失败（失败点 = agent notes 硬换行格式，见 T6）→ 1–7/9（lint、typecheck、build、四包测试含 no-ir parity 门禁 + stderr 零容忍、守卫、demo e2e ×2）**已通过**。R11 的「A-16/A-17/A-14 在 CI 全绿」前置因此满足。
- 红线 R11：**任何阶段不得先删 IR 代码**；A-16/A-17/A-14 常绿是删除 PR 的合并前置。

## 1. 红线与开发纪律（对全部任务生效）

1. **R11**：P1–P6 删除动作（T5）之前，A-16/A-17/A-14 对拍常绿；删除只发生在 T5，且以 T1–T4 全绿为前提。
2. **缺省仍是 module**：任何改动不得在 T4 完成前翻转缺省；direct 只能经 `executor:'direct'` 显式选择。
3. **stderr 零容忍**：测试故意触发错误必须 spy 断言，禁止全局静默。
4. 每次开发：① 跑自己写的测试；② 跑受影响测试；③ 全绿后跑 `pwsh -NoProfile scripts/ci.ps1`；CI 失败只重跑失败项。
5. 每个非平凡改动配 Agent Note（implemented/architecture，双语 + `.i18n.yaml`，用 `scripts/verify-translation-pairing.ts --write <file>` 记录哈希）——但**文案硬换行要符合 verify-md-wrap**（T6 前可先按单行段落写，避免新增 backlog）。
6. 测试 fixture 路径一律 `import.meta.url` 锚定；新对拍/功能测试放 `packages/tests/faijs/no-ir/`（parity/、acceptance/、multifile/、blocks/ 等子目录）。
7. 环境：mesh 模式跑 DirectExecutor（createApiNamespace + 先 warmup 认领全局 backends）；需要字体/资产/注册库的 fixture 在裸环境两边都失败 → 不在 mesh 语料内（宿主注入后由集成测试覆盖）；BREP/OCCT 用例（T3 起）用仓库既有 `initOcctWasm()` 模式。

## 2. 任务清单

### T1 【功能】自由 JS 块执行（A-6 / A-11）

目标：DirectExecutor 把 for/if/while/do/switch/裸块等顶层**块单元**整块执行（当前对这些节点抛 E_CONTROL_FLOW）；块内 shape 进 ctx 并出现在 terminals（timeline 对块仍只读——MetadataExtractor 的 blocks 面已就绪）。

范围/要点：
- `direct-executor.ts` `parseAndTransform`/`transformTopNode`：控制流节点按「块起始行 = 单元行号」产出单一块单元，执行文本 = 原代码整段；块内**顶层**声明提升到 `__ctx`（块内 `const p = cad.box(...)` → `__ctx.p = ...`），块内**嵌套块与函数体跳过**；对外部变量的词法引用按 `hoistText`（已含 ctx 键）处理。注意 DirectExecutor 单元已按 ESM module 解析（T2 的 parseBody 形态），块文本切片取 `node.start..node.end` 即可。
- 块产物登记：单元执行前后对共享 ctx 做 diff，新增 shape 键 → `blockOutputs: Map<shapeName, 块起始行>`（computeLiveShapes 已支持该锚点输入，见 `live-shapes.ts` `LiveShapesInput.blockOutputs`）。
- 执行安全：`executionTimeoutMs` 只在单元间插桩（块内部死循环无法中断，R-7 注明 v2 Worker 方案）——T1 至少保证**块内无死循环的正常场景**与**单元级超时**正确；不要在单块内测死循环。
- 验收：A-6（`for` 块产出的 shape 进 terminals；块在 timeline 单只读节点——用 analyzeCode/extractMetadata 断言）、A-11 自由语法回归（循环块/条件块/嵌套块）；DirectExecutor 与 no-ir 新增 `blocks/` 用例；`append` 后的块（整段重放）行号稳定。
- 文件：`packages/core/src/cad-runtime/direct-executor.ts`（+ `direct-executor.test.ts`）、`packages/core/src/cad-runtime/live-shapes.ts`（如需）、`packages/tests/faijs/no-ir/blocks/`。
- 依赖：E_EXEC_LIMIT 已就绪（9ede3ed）。风险：作用域提升对解构/多行块内声明的覆盖（R-5，v1 只做块顶层声明）。

### T2 【功能】collectResult 输出面补全（activeValues / changed，mesh 面）

目标：让 direct 结果与 module 结果在 mesh 场景的**字段全集**等位，消除「有几何但缺 activeValues/changed」的差异。

范围：
- `runtime.ts` direct 组装：实现 `collectDirectActiveValues(meta)` 镜像 `collectActiveValues`（非几何 DAG 叶子：lines 的 outputs 扫描 + lineConsumes/块词法消费 + 起点 = 最后写者行号 + 1；候选 = ctx 非 shape/compound 键），失败后进 `ExecutionResult.activeValues`。
- `changed`：module 侧由装配变换（applyPendingAssemblyTransforms）记录——direct 无 deps/装配传播时，装配（assemble/do_assemble）目前不在 direct 语料内；T2 至少保证普通 mesh 场景两边 `changed` 都为 undefined（用对拍断言字段存在性一致），装配传播的 direct 等价归入 T3。
- 验收：扩 runtime 对拍（`runtime-direct-mode.test.ts` 或新 `parity/full-result.test.ts`）：对 mesh 语料断言 direct vs module 结果**键集合一致**（outputs/terminals/compounds/brepSolids 存在性/activeValues/changed 存在性）；另造一个非几何查询叶子脚本（需一个返回 number/普通对象的 op 或 registerLib 的 compat 函数）断言 activeValues 内容相等。
- 文件：`packages/core/src/cad-runtime/runtime.ts`（collectDirectResult）、新增 live-shapes 或独立辅助函数 + 测试。

### T3 【功能】direct 的 BREP/topology/naming 收敛（解锁缺省翻转的前置）

目标：direct 执行后，runtime 能像 module 路径一样给出 `brepSolids`（逐终端 solid）、auto/brep `topology`、`naming`（roleTable/命名行），使 auto/brep 模式场景 direct == module。

范围：
- `direct-executor.ts`：执行单元后把**身份槽**同步到 runtime 的 PartName 键控缓存（对齐 `module-executor.ts afterStatement` 的 slot→solidCache/faceEvolutionCache/roleTableCache 同步与 `setName`）；`DirectExecutorOptions` 增可选缓存钩子（getSolid/setSolid/setFaceEvolution/setRoleTable 等），由 runtime 构造时注入（runtime 已持有这三份缓存 + ensureBrepChain）。
- `runtime.ts` direct 组装：auto/brep 分支复用既有 `buildBrepTopology(partName)` / `extractBrepSolids` 思路（依赖 solidCache 命中，故先做同步）；`naming` 走既有 `buildNamingInput`/`buildPartNaming`。
- 装配/compound 传播（applyPendingAssemblyTransforms 语义）在 direct 的等价——最小可用版：块/语句执行后消费 pending 变换并**原地**应用（mesh）+ 写 solidCache（brep），`changed` 记录，下游因整场景顺序执行天然重读——如实标注与 module deps 级联的差异。
- 验收：新增 auto/brep 模式对拍（用仓库 OCCT 测试基建，如 `svg-to-solid`/`threadFns`/brep-mesh-equivalence 的 fixture 子集）：direct vs module 的 brepSolids 键集、topology.source、naming 逐 part 相等；`part-brep-lost` 语义回归可后置。
- 文件：`direct-executor.ts`、`runtime.ts`、`module-executor.ts`（如需抽共享辅助）、新 `no-ir/parity/brep-direct-parity.test.ts`。
- 风险：OCCT 句柄生命周期（顶替释放/dispose 路径必须仍只操作 runtime solidCache）；本任务完成前**不得**执行 T4。

### T4 【切换】缺省翻转到 direct（完整 P4）

前置：T1–T3 全绿 + 门禁 A-16/A-17/A-14 绿（已满足）。
内容：`CadRuntimeOptions.executor` 缺省改 `'direct'`（`createRuntime` 工厂同步）；collectResult 输入换源为 direct 组装；`check()` 统一走语法门禁（E7 逻辑已备）；**module 路径代码保留但停用**（供回退与 T5 删除前对照）；A-1–A-15 全量回归 + 全量 core/tests + 仓库级 CI 绿；3d_editor（另一仓库 `C:\my\Faicad\3d_editor`）全量回归——这是仓库外验证点，需用户安排或在 faijs 侧以 §4.10 契约逐行打勾测试兜底。
文件：`runtime.ts`、`index.ts`/`browser.ts` 门面（如需）、各入口测试的 executor 参数清理（不再需要显式 direct）。
验收：缺省实例（3 参构造）在 mesh + auto/brep fixture 上与翻转前 module 结果逐键一致（golden 由 T2/T3 对拍锁定）；performance 冒烟（update 全量重跑响应性，R-3 用户已接受）。

### T5 【删除】删除 IR 代码并迁移门禁（P6）

前置：T4 已翻转且 CI 绿；R11 的 A-16/A-17/A-14 在 CI 全绿（现满足）。
内容：删除 `lang/parser.ts` 语义层（parseScript 语义分支/importDeclToIR/折叠）、`lang/compile.ts`（compileToModule/CompiledStatementMeta）、`cad-runtime/module-executor.ts`（ModuleExecutor；`ExecBookkeeping`/`Namespaces` 迁入 direct-executor.ts）、`cad-runtime/terminal-dag.ts`（computeLeafTerminals/consumes/DagRuntimeView；live-shapes 替代）；parser 语法门禁能力迁 `syntax-gate.ts`（可并入 metadata-extractor）；`lang/types.ts` 删 ScriptIR/StatementIR/ImportIR/FunctionDefIR/ArgIR 相关守卫与工厂，保留 ParamDef/TerminalShape/ScriptMetaIR/VarKind；同步删门面导出与类型引用；`codegen.ts` 的 StatementIR 依赖改 HostArg 面输入。
迁移门禁：对拍（A-16/A-17/A-14）转快照断言（行为基线固化）；parser/compile/statement-summary/code-to-args/terminal-dag 测试迁移为 MetadataExtractor/DirectExecutor/computeLiveShapes（含 keep 契约回归）；CLI（`faijs-cli.ts check/run`）与 `executeIR/updateIR/appendIR/plan` 等内部 API 的消费点清理；`madge` 无环 + `gen-api-dts` 重跑确认不受影响。
验收：删除后全量 typecheck/lint/守卫/测试/仓库级 CI（含 doc-sync，需 T6 先清）/demo e2e 绿；`no-ir/parity/` 转为快照且继续常绿。

### T6 【文档收尾（明确后置）】doc-sync 全绿 + 新文档补齐

用户已明确**先功能后文档**；功能全部完成后做：修复既有 agent notes 的硬换行（verify-md-wrap 报错行清单：`metadata-extractor-no-ir-p1`、`direct-executor-live-shapes-p2-p3`、`runtime-direct-mode-p4` 的 EN/ZH 长行段落按「一段一物理行」重排）→ `npm run doc-sync` 全绿；按变更补/更新 Agent Note 双语（T1–T5 各配一条，含 i18n 记录与分类/配对门禁）；本文档任务全部勾销后把 `docs/plans/2026-09-06-no-ir-dual-channel-runtime.md` 状态行改「已落地」。

## 3. 验证命令速查（在 faijs 根目录 / 对应包目录）

```
npx vitest run faijs/no-ir            # no-ir 全套（parity/acceptance/multifile/blocks…）
npx vitest run src/cad-runtime src/lang  # core 受影响子集
npm run test -w @faicad/faijs-core   # core 全套
npm run test -w @faicad/faijs-tests  # 集成全套
npm run typecheck && npm run lint
npx tsx scripts/verify-export-jsdoc.ts
npx tsx scripts/verify-translation-pairing.ts <agent-note.md>   # 双语记录
pwsh -NoProfile scripts/ci.ps1       # 仓库级 CI（功能全部完成后跑；doc-sync 须先 T6）
```

## 4. 已知风险与注意

- **并行跑两套重 OCCT 测试会互抢 CPU 产生 flake**：全量验证时 core 与 tests 不要同时后台跑；flake 以单独重跑判定。
- 缺省翻转（T4）前，任何新增执行面行为都必须在 direct 与 module 两边对拍（runtime-direct-mode 语料只锁 mesh；T3 前不要承诺 auto/brep 等价）。
- module 路径删除（T5）后 `3d_editor` 依赖的 §4.10 U1–U12/R1–R4 契约不得变化——先逐行核对该表再删。
- 主方案 R-8：删除前对拍覆盖缺口（fixture 不全 → 行为回归）——T1/T2 阶段尽量扩 fixture（keep/链式/错误路径/块/多文件）。
