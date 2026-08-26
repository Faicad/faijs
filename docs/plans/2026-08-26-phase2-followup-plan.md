# Phase 2 收尾：装配 solid 同步缺陷判定 + T7 及后续任务细化

> 本文档是新一份技术实施计划（方案/计划性质，不含代码改动）。
> 前置文档：`2026-08-25-faijs-vm-execution-implementation-plan.md`（总方案）、`2026-08-26-phase2-completion-plan.md`（Phase 2 收尾 T1–T11）。
> 本文档回答用户提出的「已知遗留说法是否准确」的核查结论，并给出正确的解决方案，然后细化 T7 及之后的 Phase 2 任务，保证 Phase 2 正常完成。

---

## 0. 用户原话（直接引用，不删除）

> “我需要你完成以下任务：1. 先问清楚两个设计文档要改哪里（总方案 & phase2 收尾），以及记录在哪；2. 再来判断这个已知遗留说法是否正确；3. 需要你完整分析本项目和 ../3d_editor 的代码，并给出正确的解决方案；然后写一份新的技术实施文档，分析目前的完成状态，并细化后续的、从 T7 开始的其它 phase2 任务。保证 phase2 能正常完成。”

待核查的「已知遗留」（出自 T6 完成总结，原文引用）：

> “appendAndCommit(do_assemble) 测试中 getSolidBoundingBox 因 OCCT solid handle 失效而失败。这是因为 VM 执行模式下 do_assemble 是无赋值操作，result.brepSolids 不包含被变换的 box。需要在 T7/T8 中解决装配变换后的 solid handle 映射问题。”

---

## 1. 核查结论（一句话判定）

**该说法“现象正确、归因与定位不准确”**：

- ✅ **对的部分**：`appendAndCommit(do_assemble)` 测试确实失败，错误就是 `getSolidBoundingBox … Invalid shape ID`（已在 3d_editor `script-engine.test.ts` 复现）；`do_assemble` 在 VM 下确实是无赋值语句（`writes = []`）。
- ❌ **不准确的部分一（机制）**：`result.brepSolids` **不是“不包含 box”**，而是**包含 box，但用的是被释放的旧 handle**。装配变换后 box 的新 OCCT solid 只写进了身份槽（`getSlot`），从未反向同步到 runtime 的 `solidCache`（PartName→solid 映射），而 `extractBrepSolids` 恰恰从这个 stale 映射读取 → 拿到的是已在 `solveAssembly` 里 `kernel.release` 过的旧 handle → bbox 抛 `Invalid shape id`。
- ❌ **不准确的部分（定位）**：这本质上是 **faijs 侧 runtime 的装配变换 solid 映射缺陷**（可归为 compound/装配链收尾），**不是 T7/T8（3d_editor 场景树/预览 stdlib）**。T7/T8 都是消费方前端任务，即使做完也不会修复 brepSolids。正确的修复点在 faijs（`CadRuntime.collectResult` 的 solid 数据源 + `exec.setSolid` 同步）。

---

## 2. 当前完成状态（2026-08-26 实测基线）

### 2.1 faijs

| 项 | 状态 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 error |
| `npx vitest run` | ✅ 725 passed / 9 skipped |
| `scripts/ci.ps1` | 未跑（本会话只做了代码核查，按 AGENTS 规范不先跑 CI） |

> 注：HEAD 之上还有一批**未提交（多已 git add）**的 Phase 2 改动（`git diff --cached --stat` 显示 24 个文件 +932/-104，含 `stdlib/{assert,compound,boolean,drill,engrave,extrude,primitives,transform}.ts`、`cad-runtime/{runtime,exec-context,module-executor}.ts`、`lang/parser.ts`、`runtime.test.ts` 等）。这些就是 T6 完成总结对应的工作内容（82/85 → 1 failed 的 faijs 侧基座），当前仅未 commit；不影响本文档的根因与方案。

**关键代码现状（含 file:line）**：
- `src/lang/compile.ts:241-244` — `add_constraint`/`do_assemble` 编译为 `writes = []`；`do_assemble` fn 体为 `await ctx.<asm>.do_assemble(exec)`（同文件 `:171-174`）。
- `src/cad-runtime/runtime.ts:216-234`：`ModuleExecutor` 选项把 `setSolid/releaseHandle/getSolid` 接到 runtime 持有的 `this.solidCache`（PartName 键控）。`ensureBrepChain`（`runtime.ts:238-249`）把 `solidCache` 作为 `brepChain.solidCache`。
- `src/cad-runtime/module-executor.ts:234-249`（`afterStatement`）：**只有 `writes` 非空时**才把「槽中的 `slot.solid` → `setSolid(partName)`」写回 runtime。因为 `do_assemble` 的 `writes` 为空 → 该同步**一次都不会执行**。
- `src/stdlib/compound.ts:186-233`（`solveAssembly`）：BREP 变换路径读 `exec.getSolid(movingShape)`（身份槽旧 handle）→ `applyTransformBrep` 建**新 handle** → `kernel.release(movingSolid)` **释放旧 handle** → `exec.setSolid(movingShape, transformedSolid)` **只写身份槽**。
- `src/cad-runtime/exec-context.ts:170-176`：`getSolid/setSolid` 仅读写 WeakMap 身份槽，不触碰 runtime `solidCache`。
- `src/cad-runtime/runtime.ts:605-645`（`extractBrepSolids`）：从 `this.solidCache.get(tKey)`（PartName 键控，**stale**）取值，**而不是**从槽（slot）取最新值。
- `runtime.test.ts` 全绿（含一个 `do_assemble` append 测试），但该测试**只校验 mesh/bbox，不校验 BREP solid handle** → faijs 侧没暴露这个缺陷，缺陷在 3d_editor 的回归测试里暴露，符合“已知遗留”。

### 2.2 3d_editor

| 项 | 状态 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 error |
| `npx vitest run`（整套） | ❌ 2 个文件失败：`script-engine.test.ts`（装配 `appendAndCommit` 实数据用例）+ `feature-registry.test.ts`（8 个 `deriveLabel` 中文 label 断言） |

**重要分流**：`feature-registry.test.ts` 的 8 个失败是**本地编码问题**，与 Phase 2 逻辑无关：
- 我在磁盘上把 `src/engine/features/*.ts`（13 个文件）读出来做字节分析：这些**工作区文件被以 GBK/CP936 重新编码**（HEAD 是合法 UTF-8；GBK roundtrip 一致），而 vitest/vite 按 UTF-8 读取 → 字符串变成 `�`（U+FFFD）→ `toContain('分割')` 等断言失败（`Received: '�ϲ�'`）。
- 换句话说：**这是一次本地文件编码把 13 个 feature 源文件从 UTF-8 改写成了 GBK**（多半是编辑器/工具把 UTF-8 改存 GBK），不是产品代码回归。处理：把这 13 个文件的编码恢复为 UTF-8（已核对 `HEAD:src/engine/features/drill.ts` 与 GBK 解码后的工作区内容字节一致，即内容无实质差异，只是编码变了）。文件清单：`boolean, drill, engrave, extrude, group, knurl, load, screw, sdf, split, svg-extrude, text, transform.ts`。
- 修复方式（仅编码层操作，不引入内容改动）：把 13 个文件按 GBK 解码后以 UTF-8（无 BOM）重新写入磁盘；随后跑 `feature-registry.test.ts` 的 8 个用例应恢复通过。注意不要 `git restore` 目录（AGENTS 警戒），逐文件安全重建编码即可。

---

## 3. 根因链（准确版）

```
box 语句执行：BREP 生成 solid 存入身份槽（setSolid），afterStatement（writes 非空）
  → 身份槽 solid 写入 runtime.solidCache['boxName']；3d_editor _exportSolid 拿到该 handle（有效）。

do_assemble 语句执行：
  ModuleExecutor.executeIds → fn = await ctx.asm.do_assemble(exec)
    → AssemblyBehavior.solve → solveAssembly（compound.ts:186）
       movingSolid = exec.getSolid(movingShape)        // 身份槽 -> 旧 handle
       transformedSolid = applyTransformBrep(...)      // 新 handle
       kernel.release(movingSolid)                     // 释放旧 handle ！！
       exec.setSolid(movingShape, transformedSolid)    // 只写身份槽
  afterStatement（module-executor.ts:234-249）:
    writes = [] → 循环不执行 → setSolid(partName, slot.solid) 从未被调用
    → runtime.solidCache['boxName'] 仍指向已释放的旧 handle
collectResult / extractBrepSolids（runtime.ts:605-635）：
    读取 this.solidCache.get('boxName') = 旧、已释放 handle
    → Result.brepSolids['boxName'] = { solid: 旧(已释放), kernel }

3d_editor appendAndCommit → _fillExportCacheAndRebuildTopology（ScriptEngine.ts:797-805）
    → _exportSolidCache[':box'] = 旧(已释放)
script-engine.test.ts:2058 → getSolidBoundingBox(kernel, 旧 handle)
    → OcctError: getBoundingBox: Invalid shape id: …   ★ 复现失败点
```

**因此准确性结论**：
- “`result.brepSolids` 不包含被变换的 box” —— **表述不精确**：它**包含了 box 键**，但值是**旧（已释放）handle**，即“包含了一个被释放的过期 handle”，等价于“不含被正确 transform 后的新 solid”。
- “需要在 T7/T8 中解决 handle 映射” —— **定位错误**。T7（2.10 场景树从 compounds）与 T8（2.11 预览走 stdlib）与 brepSolid 的数据源无关；正确归属是 **faijs 侧的装配 solid 映射/同步缺陷（可列为 T6.5/T6.1）**。

---

## 4. 正确解决方案

### 4.A 核心原则
- **恒等槽（identity slot）是 BREP solid 的单一事实来源**（与总方案 §3.3/§3.4 一致）。runtime 的 `solidCache`（PartName 键控）应视为**从身份槽派生**，而身份槽才是权威。装配在 *同一 Shape 对象* 上原地替换 new solid（`:1+setSolid`），所以 `result.brepSolids`/`buildBrepTopology`/3d_editor 导出缓存都必须读「最新槽」，而不是写时同步过的映射。
- 因此最干净的修复不在 stdlib（改 stdlib 内部），而在 **faijs CadRuntime 收集输出** 这层。

### 4.B 推荐修复（faijs 侧，最小、符合红线）
1. **`CadRuntime.collectResult` 提取前做“槽反同步”**（与 `changed` 的构造位置 `runtime.ts:586-591` 相邻）：
   - 遍历 `exec.touchedShapes`（`ExecContextImpl` 已把被装配变形的 Shape 记录在内），对每个 `touchedShape` 用 `exec.shapeToName` 反查 PartName，再从身份槽取最新 `solid`（与 `faceEvolution`），若存在则通过 runtime 的 `setSolid/setFaceEvolution`（`runtime.ts:228-233`）把 `this.solidCache[partName]` / `this.faceEvolutionCache[partName]` 更新为**新 handle**。
   - 这样 `extractBrepSolids`（读取 `this.solidCache`）天然拿到新 handle，`result.brepSolids` 对 box 返回新 handle；`collectResult` 构建 `buildBrepTopology` 也走同一份 map，保持一致。
   - **释放语义**：不要在此处释放旧 handle——旧 handle 已由 `compound.solveAssembly` 的 `kernel.release(movingSolid)` 释放过（或由覆盖语句的顶替释放）；本步骤只是**替换映射**，不新增释放（避免二次释放）。同时需核对 `solidCache` 无其它引用。
   - 该方案不触碰 `writes` 语义、不放大红线（stdlib 仍只用 ExecContext 平台 API）。
2. **（可选）主机侧防御**：在 3d_editor `_fillExportCacheAndRebuildTopology`/`commitSceneResult` 对 `result.brepSolids` 的每个 handle 做有效性防御（仅当 faijs 提供校验 API 时）；**不要**用 `try/catch` geop 探测。因为红线规定 “BREP 路径静态、无运行时回退”；此路径不应靠 host 防御，而应让 faijs 返回正确 handle。

### 4.C 备选 B（大改，不强推）
把 `exec.setSolid` 改成“身份槽 + 通过 shapeToName 同步回 runtime PartName 映射”，但 shapeToName 在 `afterStatement` 才设置（`module-executor.ts:242`），执行期 `setSolid` 时可能查不到名字，且要控制释放时机（避免重复释放），语义改动大。因此**仅作为 4.B 的附录**记录，不采用。

### 4.D 验证（faijs 与 3d_editor）
- faijs：在 `src/cad-runtime/runtime.test.ts` 增加一个 **BREP 场景的 do_assemble + brepSolid 断言**：创建 box（BREP）→ 装配加 face_mate（moving=box）→ `result.brepSolids.get(boxName)` 的 solid 必须是「运行前不同 handle」且可 `getSolidBoundingBox`（即非失效）。该测试在 mesh 与 brep 双模式运行（beforeAll initOcctWasm），直接堵死本缺陷。
- 3d_editor：`script-engine.test.ts` 该用例原样保留并应转绿（验证 `boxBboxAfter.min[2]=10` 等）。
- 顺带修复 13 个 feature 源文件编码（UTF-8），使 `feature-registry` 8 个用例恢复。

---

## 5. T7 及后续 Phase 2 任务清单（含细化、验收）

> 说明：完成 T6/T6.5（上述装配 solid 修复）后，进入下文任务。每条带 **改动文件 / 改动 / 验收 / 关联测试**。所有任务只改方案所指文件；改动后逐一跑自己的测试、再跑受影响测试，最后才 `scripts/ci.ps1`。

### T7 — 2.10 场景树层级从 `ExecutionResult.compounds` 构建
- 现状：`3d_editor/src/stores/core/model-store.ts:83-166` `buildSceneTreeFromDag` 目前**读 sceneScript 的 `args.members`** 建 group/assembly 树；`ExecutionResult.compounds`（faijs 已产出，`runtime.ts:549-559`）尚未被消费。
- 改动：
  1. `ScriptEngine`/scene store 在 `commitSceneResult` 后把最新 `result.compounds` 存入 store（或作为 `operationResults` 附带字段）。
  2. `buildSceneTreeFromDag` 增加参数 `ExecutionResult.compounds`，优先用 **key=compound 变量名、value=成员变量名** 建层级；`args.members` 作为回退（旧文件/非 VM 产物）。
  3. `compute scene tree` 后按 `terminalToScopedId`（`useScriptStore`）把成员名映射成 scopedId 挂到 group.children。
- 验收：在 `model-store.test.ts` 增加「compounds 建树」测试；e2e 场景树 spec（`material-editor-scene-tree.spec.ts` 等）绿。
- 关联：既有 `commitSceneResult`（`ScriptEngine.ts:1231`）已消费 `result.outputs/brepSolids`，此处只新增 `compounds` 的传递。
- 注意：T7 仅改“树结构的数据源”，**成员的显示、选择、拓扑独立于 T10**。

### T8 — 2.11 预览执行器走 stdlib（预览 exec 抽象）
- 现状：`LiveDrillPreview.tsx:198` 直接 `cad.drill(targetShape, ...)`；`EngravingCore.ts:167` 直接 `cad.engrave(...)`。
- faijs 侧新增「预览 exec」：`src/cad-runtime/preview-exec.ts` 提供 `createPreviewExec(ports?) → PreviewExec`，只带 `kernels (occt + manifold?) + getSolid/setSolid（只读写身份槽，不写 ctx/output/params）`，供「dry-run」用。
- 改动：
  - `LiveDrillPreview.tsx:198` → `import { drill } from '@faicad/faijs/stdlib'` + `createPreviewExec()` 传入（move = dry-run，committed 结果直接 build preview mesh）。
  - `EngravingCore.ts:168` → `import { engrave } from '@faicad/faijs/stdlib'` + `createPreviewExec()`。
- 验收：预览交互 spec 绿；`grep cad.drill / cad.engrave`（除 `cad` 命名空间内部实现外）不再在 preview 组件出现。

### T9 — 2.12 step-converter 走高层 API + 2.7b browser deprecated 区删除
- 现状：`step-converter/index.ts` **已**使用 `importStep/exportStep/meshToStepBrep` 等高层 API（`step-converter/index.ts:1-5`），无需再改 API；剩余是 **清理总旧名** 与 **删除 browser.ts deprecated 区**。
- 改动：
  1. 全局 grep 3d_editor 不再 import faijs deprecated 符号（`executeStatement/initBrepChainState/releaseBrepChainState/executeAssemblyPassForStmt/resolveGeomRef`）；此项在 T6 已大体完成，核对确认。
  2. faijs `src/browser.ts:224-255`（deprecated 区：`computeContentKey/resolveGeomRef/BrepChainState/initBrepChainState/releaseBrepChainState/initOcctWasm` 等）删除，并同步删 `contract-entry.test.ts` 白名单项——**必须排在 3d_editor 全部迁移后**，否则编译断。
- 验收：grep 无生产 import；`3d_editor npx tsc --noEm` 绿；`contract-entry` 暂时名单项同步清理。

### T10 — 2.13 BREP 真拓扑从 `ExecutionResult.topology` 消费
- 现状：`ScriptEngine._rebuildBrepTopology`（`ScriptEngine.ts:602-629`）直接用 `runtime.buildBrepTopology`（读持久 `solidCache`）。`ExecutionResult.topology`（`runtime.ts:561-564`，brep/auto 模式已自动构建）还没被消费。
- 改动：`_rebuildBrepTopology` 改为读最近一次 `result.topology`（`PartTopology` map，key=partName），`SetStepRuntime` 写入 topology store；**GLB/primitive/mesh 假拓扑仍用 `buildSelectorRuntime*/buildSolidTopologyRuntime`**。
- 验收：拓扑（face-level）在装配/变换后更新为新几何（拓扑不陈旧）；`script-engine`/topology 相关 spec 绿。

### T11 — 2.14 契约白名单收敛
- 现状：`contract-entry.test.ts:82,102,212-213` 还有 E10/E12/E13 临时放行（`getManifoldModule/myManifoldModule/BrepChainState/initBrepChainState/releaseBrepChainState/executeStatement/resolveGeomRef` 等），且该测试位于 `src/engine/__tests__/`，**vitest 默认不跑**（仅 `test:components` jsdom 或 CI 跑）。
- 改动：
  1. 待 T8/T9 完成、3d_editor 不再引用后，删 `contract-entry.test.ts` 的临时段（`:82, :200-233`）。
  2. 新增锁定断言「几何变更必须走 `CadRuntime.execute`（脚本语句）」：即 grep 生产代码无 `executeStatement`/`initBrepChainState`/`resolveGeomRef` 等。
- 验收：完整白名单无临时段；新增断言绿；`npx vitest run`（含 __tests__ 手动跑）+ `npx vitest run --config vitest.jsdom.config.ts` 都绿。

---

## 6. 实施顺序与依赖

```
T6.5 [faijs：装配 solid 槽位回写（§4）→ faijs 单测绿 → npm run pack → 3d_editor npm install]
   └ (#可选) 13 个 feature 源文件编码修复（UTF-8）
       └─ T7 (compounds 建树)        ─┐
          T8 (预览 exec + stdlib)     ─┼─ 各自独立，可并行
          T9 (step-converter+dep)     ─┤（T9 依赖 T6.5 与全部迁移）
          T10 (topology 消费)         ─┘
          T11 (白名单收敛)  ─────────── 最后做（依赖所有旧的符号清理）
```

- **T6.5 必须最先做**：它是已知遗留的唯一根因，也是保证 Stage 2 test 数稳定的前置。
- **T9/T10/T11 都最后归口到 contract-entry**，避免中途反复。
- 每次**应先跑自己新增测试，再跑影响的相关测试，最后才 `scripts/ci.ps1`**（AGENTS 红线）。

---

## 7. 验收总口径（Phase 2 完成判据）

1. faijs：`npx tsc --noEmit` 0 error；`npx vitest run` 全绿（含新增 brep 装配 solid 断言）；`scripts/ci.ps1` 绿；红线 grep（`stdlib` 无 `ExecContextImpl/exec.brepChain/exec.outputCache/exec.setVariable/exec.script` 直读）。
2. 装配回归：`appendAndCommit(do_assemble)` 用例绿（box 底面 z≈10、中心 ≈[-0.106,0.0415,20]、cylinder 不动）；`ExecutionResult.brepSolids` 对 box 为**有效新 handle**。
3. 3d_editor 分层：`npx tsc --noEmit` 0；`npx vitest run` 全绿（含修复后的 feature 编码与 script-engine）；`test:components` 绿；相关组件/e2e 绿。
4. 红线：`contract-entry.test.ts` 无临时段；生产代码不再 import 已删 deprecated 符号。
5. 兼容性：`partN_vM` 存量 `.faijs` 原样跑通。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| T6.5 槽位回写与既有 `afterStatement` 写回重复（双写同槽） | 办法：仅对**未写过** `solidCache` 的 touched shape 补写；重复写是幂等（同一新 handle）。统一走 runtime `setSolid` 回调，让释放逻辑仍只发生在「顶替释放」处 |
| 释放时序风险（旧 handle 被替换时是否还被引用） | 保持现行 `solveAssembly` 的 `release(movingSolid)` 顺序（先释放旧再建新），新映射只写新 handle；在 runtime 单独维护「曾释放集合」或依赖「顶替释放」机制，并在 README 注明 |
| touchedShapes 不覆盖下游 Shape（downstream） | 跟随现状：仅处理装配成员与下游 mesh（`dependentsOf` 传播 mesh），BREP solid 仅对 moving 成员重写；下游 brep 内部不变更（记录为已知边界） |
| feature 源文件编码若被当成真实 diff commit | 提交前以 UTF-8 重新 save（内容 = HEAD），勿把 GBK 内容提交；若 HEAD 已损坏另论 |
| T8 干跑 exec 与正常 exec 语义漂移 | 预览 exec 不写 ctx/output/params 只算纯几何 → 预览与执行结果必须一致；Dry-run 与最终 commit 用同一 op |

---

## 9. 非目标（本次不取）

- Phase 3：UI 命名 `partN`、`StmtId` 写回 `CadStatement.id`、终端判定移执行收尾、`$param` 级联等。
- Phase 4：.faicad / sucrase / 第三方动态加载。
- 多约束协同求解（AssemblyBehavior 槽位已留位，后续演进）。

---

## 附：本地测试观测记录（用于一句话识别环境是否正确）

- 复现命令（3d_editor）：
  ```
  npx vitest run src/engine/script-engine/script-engine.test.ts
  → 1 failed (appendAndCommit(do_assemble) | 82 passed | 2 skipped)
  npx vitest run
  → 9 failed / 1861 passed : 8× feature-registry(中文编码问题) + 1× script-engine(装配)
  ```
- feature 编码核验：对 13 个 `src/engine/features/*.ts` 用 `Encoding.GetEncoding(936)` 解码与 `HEAD:`（UTF-8）内容一致 → 工作区被 GBK 重编码；修复=重新保存为 UTF-8。