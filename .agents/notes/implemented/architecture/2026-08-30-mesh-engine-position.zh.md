# Agent Note: mesh engine is formal data, not a preview

Status: implemented

[English](2026-08-30-mesh-engine-position.md) | 中文

## Problem

参考项目 brepjs 中，occt 与 manifold 实现同一内核接口，manifold 的 mesh 输出只用于预览，精确几何由导出时的 OCCT 重放产生。faijs 同样有 BREP/mesh 双链，很容易照搬这套「mesh = 对精确结果做预览近似」的框架。但这对本仓库是错的：它会把 mesh 链降级为占位符，并迫使每次 UI 预览都跑一遍完整的 mesh 几何。

## Decision

faijs 明确区分 mesh 引擎与 brep 引擎；mesh 链是正式（生产）数据，不是预览、也不是占位近似。有些模型只能用 mesh 表示：SDF 模型（packages/core/src/sdf）由 manifold 计算，只能以 mesh 形式存在，因此 mesh 链必须是头等公民。链切换是静态的、非回退：brep 链上某个受支持的操作无法执行时，该操作之后的链段交给 mesh 处理，之前的链段仍保持 brep 结果（见 AGENTS.md「BREP/mesh 路径判定红线」）。

预览是 UI 层的职责，不是 faijs 的职责。faijs 只提供 mesh 运算与正式数据；宿主（如 3d_editor）是否预览、用什么方式预览由实际情况决定：简单/成本低的任务可以直接真实执行（跑 cad.op 得到真实结果），复杂或耗时的任务则用叠加层/幽灵蒙层示意。AGENTS.md「引擎定位（与 brepjs 不同）」只规定 mesh 数据是正式的，不规定任何预览方式。

## Alternatives considered

- 照搬 brepjs：mesh = manifold 预览、导出时用 OCCT 重放得到精确结果。拒绝：它把 mesh 变成纯粹的占位表示，掩盖了「只有 mesh 才能承载 SDF」的事实，也会让每次预览都触发一次完整几何重建。
- 由 faijs 或架构文档规定预览方式（「必须真执行」或「必须叠加层」）。拒绝：两种固定规定都会过度约束宿主——预览由 UI 层按实际取舍，faijs 不规定。
- 把 mesh 当作 brep 不可用时的近似回退。拒绝：本仓库的链切换是静态判定（红线），mesh 结果是正式数据，不是劣化的回退。

## Consequences

- mesh 是默认且正式的数据路径：mesh 算子结果（如 v1 倒角的平面切角）是生产几何，可供后续 op 与导出使用，不是预览产物。
- BREP 仍是可选精确链：需要精确曲面 / STEP 导出时才使用。
- 预览策略：宿主 UI 按实际情况决定——成本低的特征可直接真实执行，费时/非常规的用蒙层/叠加层示意；faijs 不参与、也不依赖预览。