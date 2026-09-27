# 方案：草图过约束策略变更——冲突型报错、冗余型事件通知

状态：方案（未实施）——等实施指令

## 1. 用户裁定（原话，2026-09-27）

> 这样，我现在裁定，不冲突的过约束，用事件通知的方式提醒。冲突型过约束，必须报错，并且报错信息要指出哪里有冲突。

### 1.1 裁定结论

| 项 | 旧策略（D3，2026-09-26） | 新策略（2026-09-27 裁定） |
|---|---|---|
| 冗余型过约束（redundant，约束相容但重复） | 允许 + 剔除冗余 + 诊断列表 | **允许 + 求解照常 + 经事件（EventSink）通知**，行为不中断 |
| 冲突型过约束（conflicting，约束互相矛盾） | 放行 + best-effort 解 + 诊断 | **必须报错**（err），错误信息必须**指出哪些约束冲突** |

本裁定推翻 `2026-09-26-sketch-constraint-lib-plan.md` 的 D3 拍板（「冲突型过约束放行」）。冲突场景从「允许范畴」移入「仍然报错」范畴——与该方案 §5「仍然报错」清单（bad ref / unsupported constraint / unsupported geom / solve failed）并列，成为第五种报错情形。

## 2. 现状（实测，2026-09-27）

代码基线：本轮会话刚完成的行为——

| 位置 | 现状 |
|---|---|
| `packages/sketch/src/planegcs-backend.ts`（solve 冲突分支） | 冲突时 `apply_solution()` + pullBack 返回 best-effort 几何，`converged: false`、`reason: 'conflicting'`、带 `problemConstraints` 列表（约束下标） |
| `packages/sketch/src/faces.ts`（`shapeFromSolved`） | `!converged && status !== 'conflicting'` 才抛 `E_SKETCHC_SOLVE_FAILED`——冲突被显式放行构面 |
| `packages/sketch/src/solve.ts`（`solveSketch`） | 产出 `SolveOutcome`（status / converged / problemConstraints / droppedConstraints / dof） |
| `packages/sketch/src/op.ts`（`cad.sketch` op） | `onDiagnostic` 回调把非 solved 状态转发给宿主 sink；诊断**不**挂 Shape |
| 防回归测试 | `packages/tests/faijs/sketch-constraint/sketch-constraint.test.ts` 场景 4（冗余不报错）、场景 5（冲突 best-effort 不报错）；`packages/sketch/src/solve-sketch.test.ts` 冗余 / 冲突两用例 |

## 3. 新契约设计

### 3.1 冗余型过约束：事件通知

- 求解行为不变（planegcs 剔除冗余、正常求解、几何有效）。
- **通知通道改为事件**：`cad.sketch` op 内把冗余状态（status、被剔除约束列表、剩余 DoF）经诊断 sink（EventSink）发给宿主。现有 `onDiagnostic` 机制已具备该通道，无需新管道。
- 脚本面不产生 err；`SolveOutcome` 结构化诊断照旧供库面消费者（fcstd / CQ 面）读取。
- 与旧行为的差别仅在**通知保证**：冗余必须通知到宿主，不允许静默。

### 3.2 冲突型过约束：必须报错，指出冲突位置

- `shapeFromSolved`（faces.ts）去掉 `status !== 'conflicting'` 放行分支：冲突 → err。
- 错误码：新增 **`E_SKETCHC_CONFLICTING`**（不再混入 `E_SKETCHC_SOLVE_FAILED`），可携带冲突详情。
- **报错信息必须指出哪里有冲突**，两级信息都要有：
  1. **约束标识**：planegcs 返回的 `problemConstraints` 是 GCS 内部约束下标（`cN` → N）。后端在 push 约束时已维护「N → 规范约束（kind + 涉及的 tag/index + 参数值）」的映射（`constraintToPrimitives` 消费的正是 `usableConstraints` 序列），冲突分支据此把下标反查成可读描述。
  2. **几何元素标识**：描述里带上约束引用的几何 tag（如 `bottom` / `top`），让用户定位到草图里的哪条线/哪个圆。
- 错误信息示例（形态，非最终文案）：

  ```
  E_SKETCHC_CONFLICTING: conflicting constraints detected
    - length(bottom) = 80
    - length(top) = 60
  (top and bottom are joined at both corners; they cannot have different lengths)
  ```

- 脚本面语句边界自动 unwrap：err 落入 `failedAt`，脚本在该语句失败——这是**期望行为**，不再是 bug。
- fcstd 影响是本裁定的核心代价：读第三方 `.FCStd` 遇冲突约束将整文件转换失败。缓解见 §5.2。

### 3.3 诊断双路职责的重新划分

| 状态 | SolveOutcome（库面） | 事件（宿主面） | 脚本面 |
|---|---|---|---|
| solved | status='solved' | 不通知 | 正常 |
| underconstrained | dof > 0 | 通知（自由度） | 正常 |
| **redundant** | 剔除列表 | **必须通知** | 正常 |
| **conflicting** | 冲突约束列表 | 通知（报错摘要） | **err，`failedAt` 指向 sketch 语句** |
| failed | reason | 通知 | err |

## 4. 实施步骤

1. **错误码与反查**：`planegcs-backend.ts` 维护「GCS 下标 → 规范约束描述」映射；冲突分支把 `problemConstraints` 反查为 `{ kind, refs, value }` 列表随 outcome 返回。
2. **faces.ts 收紧**：`shapeFromSolved` 冲突分支抛 `E_SKETCHC_CONFLICTING`（信息含 §3.2 两级描述）；删除本次会话加的放行注释与逻辑。
3. **op 事件面**：`op.ts` 的 `onDiagnostic` 对 conflicting 同样发事件（报错摘要），保证宿主 UI 在 err 之外也能收到结构化冲突详情。
4. **测试翻转**：
   - `sketch-constraint.test.ts` 场景 5 改断言：`failedAt` 有值、错误信息含两个冲突约束的 kind+tag 与值（80/60）、错误码 `E_SKETCHC_CONFLICTING`；GOTCHA 注释留档本次裁定。
   - `solve-sketch.test.ts` 冲突用例同步翻转；新增「错误信息可读性」断言（含 tag 名，不含裸下标）。
   - 场景 4（冗余）增加断言：诊断事件确实发出（spy sink）。
5. **fcstd 侧处置**：按 §5.2 拍板实施（fcstd 跟随 FCStd 自身规范，与 faijs 脚本面策略解耦）。
6. **文档同步**：`2026-09-26-sketch-constraint-lib-plan.md` §5 / §10.2 D3 标注被本方案推翻并链接本文件；`docs/api-contract.md` 错误码表补 `E_SKETCHC_CONFLICTING`；Agent Note 记录裁定变更与理由。
7. **收尾**：typecheck / lint / 相关包测试；stderr 零容忍照常。

## 5. 待确认点

### 5.1 planegcs 冲突下标的可靠性

`get_gcs_conflicting_constraints()` 返回的下标是否稳定覆盖**全部**冲突成员（而非首个矛盾环）需实测确认；若返回不全，错误信息可能漏列某条冲突约束。实施第一步即做探针验证。

### 5.2 fcstd 读第三方文件的冲突处置（已拍板，2026-09-27）

> fcstd 读第三方文件的处置要兼容 fcstd 自己的规范，和 faijs 的规范不需要一致。

**结论：fcstd 是 FCStd 兼容层，冲突处置跟随 FCStd/FreeCAD 自身语义，不套用 faijs 脚本面的「冲突即 err」新策略。** 两个面各守各的契约：

| 面 | 冲突约束处置 | 依据 |
|---|---|---|
| faijs 脚本面（`cad.sketch`） | **err**（`E_SKETCHC_CONFLICTING`，指出冲突位置） | 本方案用户裁定 |
| fcstd 面（读第三方 `.FCStd`） | **容错**：冲突草图剔除冲突约束后 best-effort 求解，转换不中断；产物中显式标注该草图不精确（沿用既有诊断通道） | FCStd 兼容性——第三方文件常见冲突，收紧会让整文件转换失败 |

能力层接口恰好支持这种分离：`solveSketch` 产出的是结构化 `SolveOutcome`（`converged: false` + `status: 'conflicting'` + 冲突列表），**err 只在 `sketchFaces` / op 构面边界抛出**。fcstd 直接消费 `solveSketch` / `SketchSolver` 管线，读到 conflicting 状态后自行决定「剔除冲突约束重解」，不经过 `shapeFromSolved` 的报错边界。

实施落点：

1. fcstd 求解管线（`convert.ts` 一侧）在拿到 `status: 'conflicting'` 后：剔除 `problemConstraints` 对应约束、重解一次，取第二次结果构面。
2. 重解结果的状态与被剔除约束随既有诊断通道标注在产物上，不静默。
3. 该行为写成 fcstd 侧防回归测试（含冲突约束的 `.FCStd` fixture → 转换成功 + 产物带不精确标注）。
4. faijs 脚本面的 `E_SKETCHC_CONFLICTING` 不影响此路径——两面的契约差异在 Agent Note 中显式留档，防止后续把 err 边界下沉到能力层。
