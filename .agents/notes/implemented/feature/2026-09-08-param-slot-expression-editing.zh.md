# Agent Note：参数源码槽位编辑 —— faijs ArgSource/validateExpression/editArgSource + 3d_editor timeline 整合

Status: implemented

[English](2026-09-08-param-slot-expression-editing.md) | 中文

## Problem

3d_editor 的 timeline 只展示操作节点；参数定义（`const w = 40`）与派生参数（`const d = w * 2`）既没有节点、也无法编辑。metadata 提取器会把表达式折叠成运行时字面量，一旦宿主在编辑时按整行重印语句，原始表达式文本就被静默销毁。`hasComputedArgs` 只读闸门正为挡住这种丢失而存在，但它也让参数彻底不可编辑：用户只能赋值，无法查看或修改产生该值的表达式。

## Decision

为每个参数槽跟踪其源码区间，编辑时只精确替换该区间，绝不重印整行：

- **faijs（只增不改）**（`packages/core/src/lang/metadata-extractor.ts` / `lib/expr-validate.ts` / `lib/source-edit.ts`）：
  - `extractMetadata(code)` → `UiMetadata`：`params`（line / name / value / type / computed）+ `names`（升序去重的已声明名字集合，供表达式校验）+ 扁平的 `argSources`。每条槽含 `stmtId`、`path`、`text`、`start`、`end`、`params`（被引用的已声明名字）、`refs`、`isExpression`。path 覆盖位置槽（`positional[i]`，支持 `.field` / `[index]` 嵌套）、命名参数槽（`args.<key>`）、RHS 槽（单声明行 `'rhs'`；一行多参如 `const w = 40, h = 20` 用 `'rhs:<name>'` 区分）。
  - `validateExpression({ text, knownNames })` → `{ ok: true }` 或 `{ ok: false, code: E_SYNTAX|E_REFERENCE|E_VALUE, message, line? }`：括号包裹后 acorn 解析判语法错；可接受表达式白名单区分引用错与值错。
  - `editArgSource(code, stmtId, path, newText)` → `Result<string, EditSourceError>`：重新提取 → 定位槽 → 断言 `start`/`end` 切出的文本仍是记录的 `text`（否则 `E_RANGE_STALE`）→ 校验新表达式（`E_SYNTAX`/`E_REFERENCE`/`E_VALUE`）→ 精确替换 → 对整体结果再 acorn 回验。代码本身无法提取时返回 `E_PARSE`；错误为判别联合 `EditSourceError`。
  - browser 入口 re-export 上述 API + `asStmtId`，宿主只从 `@faicad/faijs/browser` 消费。
- **3d_editor（宿主侧）**：
  - `script-store` 新增 `replaceSceneCode(newCode)`：写 `sceneCode` 并重算 `statementIndex`。`ScriptEngine.updateSceneCode(old, new)` 只做执行与提交几何，不持久化文本，宿主两者都做。
  - `src/engine/param-edit/param-edit.ts` 的 `commitArgEdit`：先 `editArgSource` → 成功后在**任何改动前** push 撤销快照（`undo.label.editParam`）→ `replaceSceneCode` → `ScriptEngine.updateSceneCode(old, new)`。`E_RANGE_STALE` 用宿主当前 `sceneCode` 自动重试一次；`E_PARSE` 整体降级为提示条 + 只读「查看代码」，绝不静默跳过。
  - `TimelinePanel.tsx` 按代码行号把参数条目并入 timeline：单声明行或一行多参的每条声明都渲染为相邻参数节点（key = `param:<name>`），各持独立的 `rhs` / `rhs:<name>` 槽。单击参数节点打开 ExpressionField（实时 `validateExpression`），Enter/确认提交，Esc 取消。
  - 删除参数前做引用预检：其它槽引用了该名字 → 阻止并提示「被 N 处引用」；检查为宿主对 `argSources` 的宿主侧过滤，不新增 faijs 接口。引用计数同时查 `params` 与 `refs`——计算参数（其引用只进 refs）同样受保护。与其它参数同处一行声明的参数同样受保护。
- `hasComputedArgs` 只读闸门在 P0 保持关闭（零回归）；它只会在后续与 op 面板逐槽编辑 + backfill 引用感知一起放开的原子发布中打开——单独放开会把默认值写进被引用的槽。
- **P1/T3（已放开）：op 语句逐槽参数编辑，取代 `hasComputedArgs` 一刀切只读。** `src/engine/features/arg-field.ts` 定义三态字段模型（`editable-literal` / `editable-expression` / `readonly`，经 `fieldEditState`）与路由谓词 `hasSlotEditorSlots(slots, paramNames)`：某 op 行的 `argSources` 槽之一引用到已声明参数（含计算参数）即进入 timeline 槽位编辑器。计算参数（`const d = w * 2` 作为 `box(w, h, d)` 的实参）在提取结果里只进 `refs`、不进 `params`，因此判定取 `params ∪ refs` 并对照 `meta.params[].name`。尾随选项对象（`{ size: … }`）是 `args.*` 子槽的投影，被排除在槽位列表外（可编辑单位是 `args.size` 等）。
  - `TimelinePanel` 按语句构建槽位表；`TimelineNode` 路由：第三方 → 查看代码；参数引用行 → `SlotEditorOverlay`（逐槽 `ExpressionField`，依赖 chip 可跳转参数定义并高亮引用，Enter 走公共 `commitArgEdit` 链路）；非参数引用行 → 照旧进数值面板 / backfill。因为参数引用行永远不会打开 Feature 面板，"backfill 把默认值写进引用槽"的旧故障对全部 Feature（box/chamfer/drill/engrave/knurl/fai_extrude/fai_split/transform/assemble）都是**结构性**关闭的，而非逐面板补丁。
  - 槽提交用 `draftRef` 镜像最新输入：`change` 后同帧紧跟 `Enter` 也能读到最新文本，不受 React 批处理未 flush 影响。
  - `hasComputedArgs` 不再有生产消费者（仅夹具/注释残留）；faijs 端照旧导出，且 `meta.params[]/names[]` 本就含派生参数——A1 切换在提取层已经生效。

## Alternatives considered

- 在 3d_editor 内实现源码区间替换（`source-patch.ts`）。用户明确否定：splice 是 faijs 的纯函数（`editArgSource`），供一切宿主复用，不进入 3d_editor 树。
- 编辑时按整行重印（旧的 `codeToArgs` → `formatLineCode` 闭环）。拒绝：表达式在该路径折叠丢失，正是闸门要保护的问题。
- 对同一行多参整行删除。拒绝：每个参数有独立区间，删除一个不能波及另一个。
- 在 P0 就把派生参数并入 `paramNames` 作宿主表面形态。方案实际走向：派生参数本身在提取层已进 `params[]/names[]`（A1 已天然生效），宿主把"引用到已声明参数"作为逐槽路由判据，从 `refs`（派生引用只进 refs）与 `params` 共同判定，而不以 paramNames 形态承载。
- 脚本不能整体解析时去猜。拒绝：`E_PARSE` 必须大声报出（提示 + 只读查看代码），绝不猜测。

## Consequences

- 源码被完整保留：改动只落在参数槽的一小段，绝不重印命令行；表达式原文永不丢失。
- 每次编辑在任何改动前快照 undo；过期区间用当前代码自动重试；坏表达式明确上报。
- 槽区间每次 `editArgSource` 都基于传入 code 重算，`E_RANGE_STALE` 只在调用方确实传入过期快照时出现；宿主重试改用 store 当前 `sceneCode`。
- 宿主合同：新增符号（`extractMetadata`、`UiMetadata`、`ArgSource`、`validateExpression`、`editArgSource`、`EditSourceError`）已进 3d_editor D 类白名单，保持「仅 /browser 导入」策略。
- 路由谓词收掉旧的 `hasComputedArgs` 只读闸门：引用参数的行逐槽编辑，无引用的行留在 Feature 面板；Feature 面板的 backfill 永远够不到引用槽，旧的写默认值故障被结构性移除。
- 验证：3d_editor 组件套件 367/367（TimelinePanel 新增逐槽用例：槽位编辑器打开、逐槽 `editArgSource` 经 `updateSceneCode` 提交、依赖 chip 跳转、计算参数引用槽路由），单元套件 1901 通过（仅 `c4-brepjs-gear` 一条无关既存失败），typecheck 仅剩两条既存 `compat` 错误，`vite build` 通过；faijs 核心套件全绿。
- 边界：T4 重命名预检（P2）仍为可选、待做；因为参数引用行永不打开 Feature 面板（它们进槽位编辑器），故无需给面板字段加 `fx` 徽标。