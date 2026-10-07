# borrow 通道退役后的残留清理方案

- 产出：glm5.3-flash + AtomCode
- 日期：2026-10-07
- 状态：方案（未实施）

## 0. 用户原话（需求来源）

> 我记得今天有一个提交说的是删除定义op时的borrow字段，和这里的"faijs Shape → 借入（borrow）转成内核 handle → 调 compat 源函数"是什么关系？

> 写一份技术方案，把这个问题描述清楚，以及解决方案写清楚

## 1. 问题陈述

### 1.1 背景：borrow 通道是什么

faijs 的 L3 API 面从早期 brepjs 项目投影而来。投影的运行时管线是一条「借入-调用-收养」通道（borrow → call → adopt）：

1. **借入（borrow）**：把 faijs `Shape`（含所有权与元数据的安全封装）转成内核裸句柄视图（`BorrowedShapeHandle`），供 compat 源函数消费；`borrowDeep` 还能递归借入数组/对象内嵌的 Shape。
2. **调用（call）**：`callBrepjs` 调 compat 源函数，经共享 unwrap 翻转 `Result`。
3. **收养（adopt）**：`adoptEntity` 把内核产物接回 faijs `Shape`（所有权转入 faijs 侧）。

承载这套机制的代码（截至 2026-10-06）：

| 文件 | 内容 |
|---|---|
| `api/internal/l3-bridge.ts` | `borrowBrepjsShape` / `createBorrowedHandle` / `OcctWasmHandleView` / `adoptEntity` |
| `api/internal/compat-projection.ts` | `projectBrepOp` / `assertKernelBound`——按 arg-spec 条目组装整条管线 |
| `api/internal/compat-op.ts` | `borrowDeep`、`CompatSpec.borrow` 字段——递归借入 + 借入开关 |
| `cad-runtime/admit-compat-lib.ts` / `runtime.ts` | 库注册面 `options.borrow` 参数 |

### 1.2 触发事件：f5048c7 删除 borrow 运行时路径

今天的提交 `f5048c7`（refactor(api): shrink compatOp compat surface — delete dead borrow path）判定 borrow 通道为死代码并删除：

- **删除理由**：两个真实第三方库（sheetmetal、faijs-gears）都是 faijs 原生实现、直接消费 core `Shape`，零消费者走借入管线。
- **删除内容**（-323 行）：`api/internal/compat-projection.ts` 整文件；`compat-op.ts` 的 `borrowDeep` / `CompatSpec.borrow`；`l3-bridge.ts` 的 `borrowBrepjsShape` / `createBorrowedHandle` / `OcctWasmHandleView` 等；`admit-compat-lib.ts` 的 `options.borrow`；`runtime.ts` 的 `registerLib` borrow 选项；回归测试 `shape-borrow.test.ts`；9 处 `borrow: false` 调用点。
- **保留内容**：`l3-bridge.ts` 的 `BorrowedShapeHandle` 接口与 `adoptEntity`——收养方向仍是活代码；`compat-op.ts` 的 `buildAdapter` 简化为输入透传（注释明言「faijs-native 库消费 core Shape：输入原样直传」）。
- **同日相关提交**：`56c21d2`（retire brepjs-compat subpaths and de-brepjs naming）、`b534970`（brep-mirror → brep-operations 重命名）——de-brepjs 系列清理的一部分。

### 1.3 现状：borrow 语义已死，但仓库里仍有三类残留

删除提交只清理了运行时代码本身，**描述性文字与文档没有同步**。全仓扫描（2026-10-07）后，残留分三类：

**A 类：基于已删机制的失效论证（最有害——论证前提不存在了）**

`packages/core/src/api/surface/arg-spec.ts` 里 4 条 skip reason 以「compat-op 的 borrowDeep 递归借入」为论证前提：

| 行 | 条目 | 失效论证 |
|---|---|---|
| L1688 | operations 模块头注释 | 「borrowDeep 递归借入数组/对象内的 Shape」 |
| L2045 | `loft` skip reason | 「数组入参本身已无障碍——compat-op 的 borrowDeep 递归借入数组」 |
| L2051 | `guidedSweep` skip reason | 同上句式 |
| L2054 | `multiSectionSweep` skip reason | 同上句式 |

这些 skip 的结论（不上脚本面、等手写 op）可能仍然正确，但**理由已经悬空**：borrowDeep 不存在了，数组入参的「无障碍」论据失去依据。

**B 类：描述已死管线的过时注释（误导读者）**

| 位置 | 内容 |
|---|---|
| `arg-spec.ts` 头注释 L169、条目注释 L200、L1686、L2153、L2516、L2963、L3168 等 ~15 处 | 「句柄借入 → 调 compat 源 → Result 翻转 → fromBrep 所有权转入」「走 defineOp + borrow/adopt」「faijs Shape 借入 → compat 源 Result → adopt」等 E5 模板描述 |
| `arg-spec.ts` L99、L448 | `geometryArgs` / `geometryCollectionArgs` 字段注释「逐元素借入 compat 内核 handle」 |
| `api/extrude.ts` L15 | 「compatOp 的入参先经 borrowDeep 借成 compat 视图」——引用已删除的函数名与已不存在的机制（此处同时是 up-to 实现约束的论证，属 A 类边缘） |
| `scripts/gen-l3-surface.ts` L138/173/187 | 生成 JSDoc「无 vendored 借入/调用」——语义仍对但措辞沿用旧机制名 |
| `docs/library-dev-guide.md` L241、L311、L319、L366、L379、L383 | **最严重**：手册仍在教用户写 `borrow: false`（该选项已从 `registerLib` 删除，写了会怎样未定义/报错）、「default borrow step rewrites nested Shape arguments into brepjs handle views」「adoption lifecycle (borrow → call → unwrap → adopt) is handled by the engine」——整段第三方库接入叙事基于已删机制 |

**C 类：仍然存活的同形词（不是残留，须在方案里划清界限防止误删）**

| 位置 | 为什么保留 |
|---|---|
| `api/internal/l3-bridge.ts` `BorrowedShapeHandle` / `adoptEntity` | 收养方向活代码；`BorrowedShapeHandle` 的「borrowed：不拥有、不释放」语义仍准确 |
| `shape.ts` `brepOf` + 生成器 `brepOf(shape) as BrepHandle` | query 直连引擎的现行取句柄方式（f5048c7 后借入的唯一存活形态），不是旧管线 |
| `api/feature-repair.ts` `borrowHandles`（本地函数）、`api/loft.ts` `w.borrowed`（wire view 字段） | 内核句柄层面的局部借用，与已删的 Shape 级 borrow 管线无关 |
| `api/cadquery-selectors/borrow-bridge.ts` `borrowedShapeCache` | 反方向（内核视图 → Shape）的选择器桥接，独立机制 |
| `api/internal/compat-op.ts` L126 注释 | f5048c7 自己改过（「borrow inputs」已改「pass-through」语义），但句首仍残留「borrow inputs → call the vendor function」旧句式 |

另有相邻问题记录在案（本方案不处理，仅登记）：`api/surface/upstream-surface.json` 的 `_meta.upstreamRef` 仍指向外部 brepjs 仓库路径 `C:/git/OpenCascade/brepjs/`，属同一批「历史指称」问题。

### 1.4 危害

1. **文档教不存在的东西**：`library-dev-guide.md` 的 `borrow: false` 是用户会照抄的 API——选项已删，照做必然踩坑。
2. **skip reason 论证悬空**：arg-spec 是「唯一人工维护点」，其 reason 是后续维护者的决策依据；基于死代码的论证会误导「数组入参是否需要手写 op」这类后续判断。
3. **术语混乱正在扩散**：本次会话已出现「借入 compat 内核 handle」这类把死机制当活机制的措辞（昨天的措辞清理保留了「借入」这个词，现在看应一并修正）。

## 2. 术语决定（方案的基准口径）

f5048c7 之后，「借入-调用-收养」模型中只有**收养（adopt）与直连取句柄（brepOf）**存活。统一新口径：

| 旧措辞 | 新口径 | 适用场景 |
|---|---|---|
| 借入 brepjs/compat 内核 handle（Shape→handle 转换管线） | **废弃**。现状是「输入原样直传」；query 需要句柄时经 `brepOf` 直读 | compatOp 入参、query 桥接 |
| borrow → call → unwrap → adopt 生命周期 | **adopt-only**：引擎只负责收养产物；输入透传 | compatOp 适配器描述 |
| `borrow: false` 选项 | **删除**。faijs 原生库无需任何标记，直接注册 | library-dev-guide |
| borrowed view（`BorrowedShapeHandle`） | **保留**，语义不变：不拥有、不释放的句柄视图 | adoptEntity 的产物侧 |

## 3. 解决方案

分四个独立可验证的步骤，全部在本方案获批后一次实施。改动只涉及注释、文档与生成器注释模板——**无运行时行为变更**，但生成器注释模板变更会使 `generated/*.ts` 的 JSDoc 变化，需重跑生成器并跑受影响测试。

### 3.1 Step 1 — arg-spec.ts 失效论证与过时注释修正

文件：`packages/core/src/api/surface/arg-spec.ts`（仅注释与 reason 字符串）。

1. **4 条 borrowDeep skip reason 重写**（L1688、L2045、L2051、L2054）：删除「borrowDeep 递归借入」论据。`loft` 条目改为指向手写 `api/loft.ts` 为唯一实现路径；`guidedSweep` / `multiSectionSweep` 的 reason 去掉「数组入参已无障碍」的机制论据，只保留事实结论「faijs 侧尚未手写对应 op（长尾），skip」——**不引入新论据**，避免方案文档替代码做未验证的断言。
2. **头注释与模块注释的 E5 模板描述**（L169、L200、L448、L1686、L2153、L2516、L2963、L3168 等 ~15 处）：「句柄借入 → 调 compat 源」改为现行事实：「输入直传 → 调 compat 源 → Result 翻转 → adopt 收养」；`geometryArgs` / `geometryCollectionArgs` 字段注释改为「该索引是 Shape（数组）形参，query 经 `brepOf` 直读句柄」。
3. **不动**：`BorrowedShapeHandle`、`brepOf`、feature-repair / loft / borrow-bridge 的活代码借用法（C 类）。

### 3.2 Step 2 — 生成器注释模板更新

文件：`packages/core/scripts/gen-l3-surface.ts`。

- L138、L173、L187 的「无 vendored 借入/调用」「无需 vendored 借入桥」改为「直连 occt 引擎（getBrepApi），无 compat 源中转」——与 §5.5 第 2 条的现行口径对齐。
- 重跑 `npx tsx packages/core/scripts/gen-l3-surface.ts`，`generated/*.ts` 的 JSDoc 随模板更新；再跑 `npx tsx packages/core/scripts/gen-capability-map.ts` 确认 capability-map.json 零 diff。

### 3.3 Step 3 — library-dev-guide.md 手册修正

文件：`docs/library-dev-guide.md`（本方案实施时同步改代码与文档）。

1. **L241（§3.2 borrow: false 段）**：整段重写。删除 `borrow: false` 教学，改为：「faijs 原生库（内部调 core ops、消费 core Shape）与 compat 形库均直接注册，无需额外标记；输入由引擎原样透传。」
2. **L311 / L319**：验证记录与终端表格中的 `borrow: false`、`borrows a zero-copy arena view` 措辞按 §2 新口径改写（arena view 措辞若描述的是内核层句柄语义可保留，逐处核对）。
3. **L366 / L379（Layer 3 调用叙事）**：「borrows shape inputs」改为「passes shape inputs through」；「adoption lifecycle (borrow → call → unwrap → adopt)」改为「adoption lifecycle (call → unwrap → adopt)」。
4. **L383**：保留 borrowed views 概念句（产物侧语义仍真），删去「brepjs-side concepts」的出处性表述，改为「borrowed-view（不拥有、不释放）语义由 compat 源约定自足」。

### 3.4 Step 4 — 散点注释修正

| 文件 | 改动 |
|---|---|
| `api/extrude.ts` L13–17 | 重写 ② 论证：不再引 `borrowDeep`；up-to 实现约束改述为「compatOp 入参原样直传，依赖 faceRef / brepOf / 内核直调的 up-to 实现不经 compat 通道」——结论不变、论据换为现行事实 |
| `api/internal/compat-op.ts` L126 | 句首旧句式「borrow inputs → call the vendor function」改为「pass inputs through → call the vendor function」 |
| `api/replicate.ts` L21 | 「borrow/adopt/capabilities」→「adopt/capabilities」 |

## 4. 验证方案

1. **生成器幂等**：重跑 `gen-l3-surface.ts` 与 `gen-capability-map.ts`，第二次跑零 diff；`capability-map.json` 条目数不变。
2. **相关测试**（先单跑、不跑全量 CI）：
   - `npx vitest run packages/core/src/api/surface/capability-map.test.ts`（三方一致断言）
   - `npx vitest run packages/tests/faijs/compat-e2e/sheetmetal-flow.test.ts packages/tests/faijs/compat-e2e/aluminum-enclosure.test.ts packages/tests/faijs/compat-e2e/lib-error.test.ts`（f5048c7 直接触及的三个 e2e，确认注释/文档改动未伴随行为漂移）
3. **全仓 grep 验收**：`grep -rn "borrowDeep\|borrow: false\|borrowBrepjsShape" packages/ docs/` 应仅剩历史 plan 文档（`docs/plans/` 不改）与本方案文档；C 类存活点（BorrowedShapeHandle、brepOf、borrow-bridge、borrowHandles、`w.borrowed`）逐一核对未被误改。
4. `npm run doc-sync` 过文档门禁。
5. **typecheck**：注释改动不触类型，但 arg-spec reason 是字符串字段，跑 `npm run typecheck -w @faicad/faijs` 兜底。

## 5. 不做 / 后续登记

- **不处理** `upstream-surface.json` 的 upstreamRef 外部路径——它是护栏基线数据，动它需单独评估 gen-l3-surface 反向校验的依赖方式，登记为后续独立小任务。
- **不改** `docs/plans/` 下任何历史方案文档（borrow 机制的设计出处），按「历史文档只追加不改原内容」纪律处理。
- **不改** `BorrowedShapeHandle` 命名——它描述的 borrowed view 语义仍然为真，改名收益小于 churn。
- 实施后按仓库纪律补一份 Agent Note（决策记录：borrow 通道退役、adopt-only 口径确立），放 `.agents/notes/`。

## 6. Agent Note

- （2026-10-07）本方案确立「adopt-only」口径：f5048c7 后 compatOp 输入直传、引擎只管收养产物；「借入」一词仅保留于 `BorrowedShapeHandle`（产物侧不拥有语义）与内核层局部借用（feature-repair / loft / borrow-bridge）。
