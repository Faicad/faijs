# Agent Note: compatOp 是 defineOp 之上的壳 —— 所有 brepjs 提升 op 的唯一入口

Status: implemented

[English](2026-09-06-compat-op-shell-on-define-op.md) | 中文

## Problem

`compatOp(fn, spec)` 过去自己重新实现了整套 op 生命周期：参数透传、自调 `dispatchPath`、borrow → call → unwrap → adopt、自挂 `DUAL_OP_META`、自管产物收养。这使 compat 成为第二条与 `defineOp` 平行的实现路径，随时可能漂移（它当初整套漏掉了 `positional`/slot-map 选项），多产物标注还用了一个库表面重复的专名（`geometryFields`）。修正字段集意味着手工同步两份同一契约的副本。既定方向是单一入口：`compatOp` 是 `defineOp` 之上的薄壳，只追加 defineOp 无法拥有的 brepjs 桥接；其余全部（分派、Result 边界、产物包装、元数据、能力路由）归属 `defineOp`。

## Decision

- `CompatSpec extends Omit<DualOpOptions, 'mesh' | 'brep'>`，其中 `name: string` 收紧为必填。spec 自动继承 `defineOp` 的每一个选项——无手抄字段表，未来 `defineOp` 新增选项零改动即可被 `compatOp` 继承。没有任何自创选项字段（唯一的例外是 `name` 的类型收紧）。
- adapter 是留在 compat 内部的唯一执行逻辑：① 用 `borrowDeep` 借入每个输入（faijs `Shape` → brepjs 借入视图），② `callBrepjs` 调用并用 `unwrapOrThrow` 解包（复用 `unwrapResult` 叶子），③ 用 `adoptOut` 收养产物（句柄/记录 → 收养，纯数据透传，`outputs` 声明的字段按 key 逐个收养，数组保持）。该产物随后流经 `defineOp` 自己的包装，已收养的 Shape/记录原样透传。
- `capabilities` / `outputs` / `schema` / `slotMap` 全部原样透传；`keep/keepHidden` 仍走标准 shape 可见性契约（compat 边界不拦截不重写）——借入的 brep 视图是新的 brepjs 对象，所以函数体 `keep()` 对借入 compat 输入保持无声 no-op，与此前设计一致。
- 多产物标注名只有 `outputs` 一个（`admitCompatLib` 读取被包装函数上的 `fn.outputs`）；旧的 `geometryFields` 名称已从全仓删除。
- op 层位置形参声明更名：`PositionalForm` / `positional` 字段 → `slotMap` / `SlotMap`；语句层 `StatementIR.positional`（位置实参**值**）名字保留。
- 为让单一入口与既有调用方协同，需要两处 `defineOp` 边界修复，均已在 compat e2e 套件中验证：
  - `wrapBrepOne` 对纯数据透传：既不是 Shape、也不是 `faceEvolution`/`fromBrep` 结果、也不是裸 OCC 句柄（`__occtWasm`）的值，是数据产物（如 sheetmetal 风格记录）——透传到引擎的值存储，而不是当作裸句柄去三角化。原生 brep 产物不受影响（`fromHandle` 仍服务于直出的 shape-handle 数字）。
  - `runImpl` 现在原样重抛 `OpError`——compat adapter 对库 `err` Result 抛 `OpError`，若把它包成普通 `Error`，引擎会把它当成意外的实现 bug 而不是语句失败（`failedAt`）。此前已保留 `BrepUnsupportedError` / `MeshUnsupportedError`。

## Consequences

- 整个仓库只有一套 op 生命周期。compat op 在语句边界与原生 dual-op 不可区分：同样的 `defineOp` 元数据键、同样的分派、同样的 Result→`failedAt` 行为、同样的产物包装。
- `compatOp` 提升既支持几何产物（`outputs` 记录、收养的数组），也支持纯数据产物（sheetmetal part 记录），不再抛 `OcctError: meshShape: Invalid shape ID 0`。
- `geometryFields` 在 `docs/plans/` 之外不可引用；`outputs` 成为唯一的厂商侧多产物名字。
- lint/typecheck/测试：`packages/core` 全套（含新增 `compat-op.test.ts`）、`packages/tests` 全套、gear-lib-demo、守卫脚本（幽灵依赖、顺序、madge）、文档各门禁（双语配对已重录）全部通过。唯一不通的文档门禁只是事前就存在的归档 plans 月目录内断链，禁止改动。

## Alternatives considered

- **保留双路径，手工补齐字段集。** 否：手工维护的 `CompatSpec` 字段列表正是本次要消除的漂移源；组合接口继承是用户记录的偏好。
- **给 compat 自创数据/消费载体（如 `consume` / `geometryFields`）。** 否：被多纪要否决的自创接口一律禁止；只保留桥接必需项 + `outputs` 名称。
- **只修 `adoptOut` 数据崩溃。** 否：崩溃在 `defineOp.wrapBrepOne`——产物的包装归属权在它；那里的透传修复是通用的（任何实现返回普通对象都用得上）且保持单一入口。
- **让引擎按消息重捕被包装的 `Error`。** 否：按类匹配（`OpError`）才是文档化的边界；按消息嗅探会重新引入漂移。

## Verification

- 新核心测试 `packages/core/src/api/internal/compat-op.test.ts`（7 条）覆盖：与 `defineOp` 的 meta 字段集对等、on/off 链分派矩阵、`outputs` 运行时记录、`slotMap` 位置形态、`keep`/`keepHidden` 终端、`fn.outputs` 提升。
- 重跑 compat 集成批次 `compat-e2e` / `v53-lib-brep-dispatch` / `p4-l3` / `p23-cad-face` / `refactor-acceptance`（58 通过）为绿；全工作区测试为绿（core 233、tests 1327、gear-lib-demo）。