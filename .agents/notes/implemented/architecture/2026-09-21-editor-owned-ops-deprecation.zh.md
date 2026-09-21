# Agent Note — 编辑器专有 op 退出 faijs 平台面

Date: 2026-09-21
Status: implemented
Area: architecture / op 归属 / 兄弟项目边界

## Context

FCStd 移植借用了兄弟项目 `../3d_editor` 交互模型里的三个 op 来 lower FreeCAD
对象，而这次借用正是 `ArchDetail` 死掉的直接原因：

- `Part::Compound` 是 `Part::Feature` 子类——一个**几何对象**，带 Shape 与
  Placement。它被 lower 成了 `cad.group`，而该 op 自己的模块头写着「自身无独立
  mesh；几何由 children 承载；意义是结构（层级）」，JSDoc 写着「结构语句，无几何
  输出」。编译器发出 `let part651 = cad.group(part441, ...)`，紧接着
  `part652 = cad.rotate_euler(part651, ...)`；结构 compound 不带 OCCT 句柄，
  于是变换抛 `input is not BREP`。
- Placement 是对象的**位姿属性**，却被 lower 成了 `rotate_euler` + `translate`
  两条语句。

用户的裁决：这些 op 与此前的 `fai_` 前缀家族一样，从未被设计为通用平台 op——
它们的存在是为 `../3d_editor` 的编辑器服务（画布显示、拖拽手柄、时间线语句、结构
分组）。FCStd 移植这类**平台能力**不得借用它们；平台需要这些行为时，必须设计自己
的 API。

## Decision

`translate`、`rotate_euler`、`scale`、`scale3d`、`group`、`assembly`、`copy`
一律标记为 `@deprecated`，归属 `../3d_editor`，沿用 `f963d97`（对 `fai_*` 的同类
处理）的先例：op JSDoc 是唯一事实源，三处接线点补注释，生成器把标记传播到面向 AI
的 `src/mesh/api.d.ts`，并在 `docs/ops-api-inventory.*` 里落 🚫 标记。

## 判定标准：什么样的 op 属于编辑器

判据是**这个 op 的形态为谁的语义服务**。已收集的证据：

- `../3d_editor/packages/app/src/engine/features/transform.ts`——transform 家族被
  注册为 Feature：UI 工具模式 `move`/`rotate`/`scale`、显示标签「旋转」、时间线
  backfill。
- `.../panels/TimelinePanel.tsx:824`——按 `statement.callee === 'rotate_euler'`
  把语句反查回工具模式。
- `api/copy.ts` 模块头——「画布显示 box 和副本两份」。
- `api/compound.ts` 模块头——「无几何输出；意义是结构」。

四条描述的都是编辑器交互或画布行为，而不是几何。

## Alternatives considered

- **只迁 `group`**（真正弄坏 ArchDetail 的那个），transform 家族不动。否决：
  `rotate_euler` 就是消费那个 compound 的 op，且它与 `translate`/`scale` 属于同一个
  编辑器 Feature；只标一个不标兄弟项是任意的。
- **先不标，直接修 lower。** 否决：标记成本极低且能阻止借用扩散；改接线是另一件更
  大的工作。
- **直接删除这些 op。** 否决：`../3d_editor` 仍在用。它们是迁走，不是消失。

## Known counter-evidence

既有记录至少把 `translate` 当作平台 op：
`packages/core/src/api/surface/arg-spec.ts:2718` 称其为「faijs 同名手写面」，且
`f963d97` 的 diff 上下文**明确把** `translate, rotate_euler, scale, scale3d`
排除在废弃名单之外。本 note 记录：用户本次裁决**覆盖**上述记录。

## Consequences

- **这是过渡态，不是终态。** `fcstd/codegen.ts` 仍为 Placement 发射
  `cad.rotate_euler` + `cad.translate`（4 处）、为产物聚合发射 `cad.group`
  （2 处）；`fcstd/feature-translate.ts` 为 `Part::Compound` 发射 `cad.group`
  （1 处）。两个文件现已各带一条 ⚠️ 注释，声明该借用是临时的，**不得**被读作
  这些 op 属于平台面的证据。
- **替代品不需要任何新内核能力。** `kernel.makeCompound`
  （`packages/core/src/brep/engine/primitives.ts:109`）与
  `kernel.located`/`transform`/`generalTransform`（:96-98）都已存在。缺的是一个
  表达**几何** compound 与**放置**的 faijs API。
- 在该 API 落地、lower 改写过来之前，`ArchDetail` 仍然跑不起来。
