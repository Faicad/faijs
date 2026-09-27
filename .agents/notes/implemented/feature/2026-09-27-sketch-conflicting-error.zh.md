# Agent Note: 草图冲突型过约束在脚本面改为硬报错

状态：implemented

[English](2026-09-27-sketch-conflicting-error.md) | 中文

## 问题
2026-09-26 的草图设计允许冲突型过约束通过（best-effort 解 + 诊断），仅把冗余型过约束标记为可剔除但仍放行。用户于 2026-09-27 裁定：冲突型过约束在 faijs 脚本面必须硬报错；冗余型过约束仍放行，但必须通知宿主（不得静默）。

## 决策
`shapeFromSolved`（faces.ts）在 `SolveOutcome.status === 'conflicting'` 时抛出 `E_SKETCHC_CONFLICTING`。错误信息列出冲突约束，解析为几何 tag + 值（如 `length(bottom) = 80`），绝不使用裸求解器下标。
- 该错误码独立于 `E_SKETCHC_SOLVE_FAILED`（后者保留给求解器硬失败）。
- 脚本面 op 边界把错误自动 unwrap 进 `failedAt`——机制不变，现在这是期望行为而非 bug。
- 诊断事件 sink 对 conflicting 仍触发，宿主 UI 在报错之外还能拿到结构化冲突详情。
- `SolveOutcome` 新增 `conflictDetails?: ConflictDetail[]`，由 `solveSketch` 在 canonical 层填充（planegcs 后端只认识数字 geoId，不认识 canonical tag，因此 tag 解析不能放在后端）。
- fcstd 兼容层不受影响：它走底层的 `SketchSolver.solve()` + `extractContours`，从不经过 `shapeFromSolved`，因此仍按自身 FCStd 兼容契约容错（best-effort）。

## 测试
- 冲突草图上的 `cad.sketch` 在该语句失败；`failedAt.message` 含 `E_SKETCHC_CONFLICTING` 及冲突几何 tag 名 + 值。
- 冗余草图仍求解并发出诊断，不报错。
- fcstd 转换含冲突的第三方草图仍成功（容错不变）。

## 备选方案
- 保留冲突放行（旧 D3）：用户裁定必须报错。
- 在能力层（`solveSketch` / `SketchSolver`）抛错：会同时破坏共用能力的 fcstd；报错边界刻意只放在脚本面 `shapeFromSolved`。
- 在 planegcs 后端解析冲突 tag：后端没有 canonical tag；tag 解析属于拥有 tag 的 canonical 层。

## 风险
- `get_gcs_conflicting_constraints()` 返回**全部**冲突成员。数字下标回退仅作为求解器零返回的兜底保留。

## 影响
- 脚本面对冲突草图以可读错误码 + 结构化诊断事件稳定拒绝。
- fcstd 第三方转换因边界限于 `shapeFromSolved`，仍保持 best-effort 冲突容错。
- `solveSketch` 现在携带 tag 解析所需的冲突详情，与 planegcs 后端的 tag 命名解耦。