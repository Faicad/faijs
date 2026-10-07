# 收口计划：dispose 重入死锁修复 + compat-e2e 全量验证 + U8/A1 品牌守卫收尾

状态：已落地（partial：R1 假设被证伪并回退；p23 offset 按用户指示 skip）　　日期：2026-09-04

## 1. 用户要求（原话）

> 「写一份开发计划，完成你上面说的收口部分。」

「上面说的收口部分」指本轮核查后仍未关闭的工程尾部工作，共三项：

1. **p23-cad-face 挂死**：FinalizationRegistry 终结器在 wasm 调用进行中同步 dispose OCCT 句柄，导致原生存锁，事件循环被同步阻塞；仓库已知待办，未修，也未先写分析文档。
2. **compat-e2e / p23 全量实跑验证**：因上述挂死被禁止运行，本轮只以 ci.log 历史记录佐证，未实跑当前树。
3. **U8/A1 品牌守卫 dist 字面量**：`dist/api/surface/arg-spec.js` 的 `reason:` 字符串字面量含 `brepjs`，守卫 A1 扫描 dist 时必报，属既有现象、未决策、未处理。

本收口超出此前「若遗漏只补①②」的授权基线，属新建开工项；实施前需用户再次拍板。

## 2. 现状（已实查的客观事实）

三份文档（compat-api、arena-handle-leak、true-js-subset-design）的核心实现已全部落地并通过：core 76 文件 / 996 测试、mech-lib 21、sheetmetal 233、compat-op 15、compat-face 3，typecheck / lint / doc-sync 全绿；git 事故后工作区内容完整，无内容损失。

三个收口项的相关代码事实：

- `packages/core/src/vendored/brepjs/core/disposal.ts`（472 行）：`FinalizationRegistry`（L117–124）回调直接 `heldValue.delete()` → `kernel.dispose` → `k.release(id)`；`createHandle`（L224–232）同样注册终结器。终结器在 GC 任意时刻同步执行，若与进行中的 wasm/embind 栈重叠则可能原生死锁。
- `packages/tests/faijs/p23-cad-face/p23-cad-face.test.ts`：14 用例必挂（threads/forks 双池行为一致），事件循环被同步阻塞；10-load 子集与 tsx 直跑可通过；提前强制 GC 会让挂起提前发生。
- `scripts/check-vendored-branding.mjs` A1（L90–112）：扫描根为 `src/vendored/brepjs`、`src/api/compat`，以及**存在的 `packages/core/dist`**；`arg-spec.ts` 源在 `api/surface/`（不在扫描根），但其内 8 处 `reason:` 字面量含 `brepjs`，编译产物 `dist/api/surface/arg-spec.js` 命中 A1。
- `arg-spec.ts` 与守卫脚本相对 `389b8de` 逐字节不变 ⇒ 该字面量现象先于重建存在，非本次引入。

## 3. 完成定义（DoD）

1. p23-cad-face 14/14 实跑全绿、不挂死（threads/forks 双池）；compat-e2e 全项（mech-lib-flow 7、sheetmetal-flow 7、lib-error 3、shape-borrow、aluminum-enclosure 等）实跑全绿。
2. `check-vendored-branding.mjs` 全项通过（含 A1）；重新生成 `gen-l3-surface` 零 diff。
3. 全程 typecheck / lint / 受影响套件 / doc-sync 无回退；按 AGENTS.md 顺序自测优先、只跑受影响套件、不把跑 CI 当调试手段。
4. 新增 Agent Note（中英）+ 本计划状态翻「已落地」。

## 4. R1 — dispose 重入死锁修复

### 4.1 根因假设（先分析、后改码）

- A. 终结器回调由 FinalizationRegistry 在 GC 时同步调度，与 wasm 现场调用不互斥。
- B. wasm/embind 调用进行中，任意 JS 分配触发 GC → 终结器此刻再 `kernel.dispose` → 与当前占用 kernel 的现场调用重叠 → 原生死锁；与线程池/双池无关，任何 runtime 同路径。
- C. 重复 `execute()` 产生的临时句柄量大 → 触发 GC 频度高、挂起更早；强制 GC 令挂起提前，与既有观测一致。

### 4.2 修复方向（先做可行性探针，再选型）

- **a.（推荐）终结器去现场化**：终结器回调不再同步 `release`，只登记待释放集合；在同步安全点（`executeIR` 入口/出口、模块构造结束）批量释放。低侵入、不改 wasm 语义，只改时机。
- **b. 重入标记**：kernel 外层维护 `inCall` 计数器，终结器检测到 in-call 则暂存，待原调用退出后释放。与 a 本质相同，但落点在内核接口层。
- **c. 操作互斥锁**：仅当 wasm 侧 `release` 本身不可重入（需先在 kernel 侧确认 occt-wasm 3.8.4 是否持有内部锁）才加临界区；风险高、非首选。
- 取舍：先用 b 做 0.5–1 天探针（给 wasm 现场调用打标记 + 观察 p23），再落实 a/b。

### 4.3 影响与回归

- 覆盖全部 occt-wasm 临时句柄释放路径（disposal、`adoptEntity`、`borrowBrepjsShape`、`buildSelectorManifest`、`assignRoles`、`meshReconstruct`）。
- 回归必跑：`arena-bounded`、`compat-op` ④、裸 `cad.box` 二次执行 delta = 0、p23 双池、compat-e2e；不得破坏既有「occt-wasm 3.8.4 与历史基线全绿」。

## 5. R2 — compat-e2e / p23 全量实跑

- 前置：R1 落地、用户解除禁跑授权。
- 执行：`npx vitest run`（cwd = `packages/tests`）指定 `compat-e2e/*` 与 `p23-cad-face/*`，不跑全量 workspace；stderr 零容忍。
- 验收：p23 14/14、compat-e2e 全绿，且与 ci.log 既有历史记录核对一致（同一 HEAD 下）。

## 6. R3 — U8/A1 dist 品牌字面量

- **a.（推荐）改写措辞**：把 `arg-spec.ts` 8 处 `reason:` 中 `brepjs` 改为等价表述（如「上游 OCCT 投影」「vendored 同类」），验证语义等价、`gen-l3-surface` 重跑零 diff、重建 dist 后 A1 通过。
- **b. 目录豁免**：给 A1 对 `dist/api/surface/` 加豁免——治标不治本、违背 §E6 精神，不推荐。
- **c. 已知豁免清单**：守卫硬编码本文件——保留字面量、变化小但留债。
- 决策依据：先确认 `reason` 是纯开发元数据、还是会被用户可见字符串引用（若会被公开引用只能走 a）。

## 7. 文档与工具链

- `docs/analysis/2026-09-04-...-disposal-死锁`（根因 + 实验 + 取舍），链接既有 `2026-09-04-compat-arena-handle-leak.md`。
- 新 Agent Note：`.agents/notes/`（implemented + 中英 + i18n.yaml），按 `.agents/notes/README.md` 格式。
- 如措辞变动涉及 `ops-api-inventory` / `api-contract`：同步更新并跑 `npm run doc-sync` 12 门禁。

## 8. 验证顺序（遵循 AGENTS.md）

1. 修复后先跑自测/受影响测试：`arena-bounded` / disposal 专项 / `dual-form-args`。
2. 再跑受影响套件：core `cad-runtime+api`、`occt-kernel`、p23、compat-e2e、mech-lib、sheetmetal。
3. typecheck（root + workspaces）、lint、`doc-sync`。
4. 守卫：`check-ghost-deps` / `check-workspaces-order` / madge 无环 / `check-vendored-branding`。
5. 仅最后、且仅在用户要求全量回归时才跑 `scripts/ci.ps1`。

## 9. 风险与处置

| # | 风险 | 处置 |
|---|---|---|
| 1 | 探针表明 wasm 现场调用不可中断 → 与现状冲突 | 先证仍可安全延迟，否则回到现场一致语义并更新分析 |
| 2 | 延迟释放令 arena 存活数微增 → 破坏 ≤100 断言 | 释放点锚到 execute 边界，重跑 `arena-bounded` |
| 3 | R3 措辞改动引入 `gen-l3-surface` diff / 预算超限 | 生成重跑比对 + doc-sync 兜底 |
| 4 | compat-e2e 实跑仍需用户授权 | 开工前列为本计划前置确认项 |

## 10. 实施清单

- [x] P1 写 p23 挂死分析文档（实证 bisect + 排除项 + 处置）→ `docs/analysis/2026-09-04-p23-cad-face-offset-vitest-hang.md`
- [x] P2 disposal/adapterShims 实验改动：**回退**（假设被证伪，见上述分析 §6）
- [x] P3 回归：`arena-bounded` / `compat-op` / p3+p5（disposal 回退后基线保持）
- [x] P4 compat-e2e 全项实跑（5 文件全通过，7.5–55s，标记为不 skip）
- [x] P5 `arg-spec` 措辞 + L3 生成重跑零 diff + A1 通过
- [x] P6 Agent Note（中英）+ i18n 校验
- [x] P7 doc-sync / lint / 守卫全绿；p23 含 `cad.offset` 用例标记 skip + TODO 引用分析文档；本计划状态更新