# Agent Note: translate/scale 对 brepkit 的优雅降级

Status: implemented

[English](2026-09-28-brepkit-transform-degradation.md) | 中文

## Problem

`translate` 与 `scale` 两个 op 声明了 `engines: ['occt']`，且其 BREP 实现（`api/transform.ts`）
无条件走 occt-only 的 `translateWithHashEvolution` / `scaleWithHashEvolution`
（内部直调 `getOcctKernel()`）。在 brepkit BREP 引擎上，`backend-dispatch.ts` 的静态平台门
在执行前就报 `E_BREP_UNSUPPORTED: op 'translate' requires engine occt (current=brepkit)`
——即便 brepkit 的裸 `kernel.translate` / `kernel.scale` 是真实现。结果最常见的两个变换 op
在 brepkit brep 链上完全不可用。

## Decision

把 `translate` / `scale` 改为**中立 op**（移除 `engines:['occt']`），BREP 路径按当前引擎
的**能力声明集**在执行前静态定轨（无运行时 try-catch 回退）：

- occt 声明 `translateWithHistory` / `scaleWithHistory` → 权威历史路径
  （`translateWithHashEvolution` / `scaleWithHashEvolution`），照产出 faceEvolution +
  roleTable（occt 侧零行为变化）。
- brepkit 未声明（只有裸 `translate` / `scale`）→ L1 `translateBrep` / `scaleBrep`
  保证几何精确，**并加恒等 hash 面演化**。

对 transform op 的区分点在于：刚体/均匀变换**不会改变面数及面顺序**，因此恒等面映射
是**真实正确**的——绝非 boolean/倒角那种内核毁面重造场景下**被禁止的「伪造演化」**。
复用既有 `identityHashEvolution`（`rotate_euler` / `scale3d` 本就使用，已被
`face-evolution.ordering.test.ts` 钉住），使结果 slot 带恒等 `faceEvolution` 并传播
`roleTable`，选面/命名在 brepkit 降级路径上仍可用。

`rotate_euler` / `scale3d` 本就是中立 op，仍走 `rotateBrep` / `scaleBrep` + identity
面演化（未变）。

## Consequences

- `translate` / `scale` 在 brepkit BREP 引擎上可用（brepkit-wasm 2.129.15 / 3.4.18 /
  4.0.32 三版本验证，含链式 `translate → scale`）。
- occt 上输出与之前逐位一致（历史路径保留），既有 mesh/BREP parity 与 face-evolution
  ordering 保证成立。
- brepkit 降级路径结果 slot **带恒等 faceEvolution 并传播 roleTable**（变换保面序，
  该映射真实、而非伪造），因此选面/命名照常可用——这与 intersect/chamfer 的降级不同，
  后者在这些操作本质上不保留面拓扑、故无演化。
- brepkit（三版本）端到端验证：`cad.faceRef` 能在 translate/scale 后的盒上解析
  （`faceRef(shape, 1)`）—— 即 roleTable + identity faceEvolution 真实可被选面/点名消费，
  而非仅 slot 挂载。

## Files

- `packages/core/src/api/transform.ts` —— `translate`/`scale` 中立化 + `transformBrep`能力路由。
- `packages/core/src/brep/engine/brepkit-batchD-fix.test.ts` —— 新增回归套件（occt + brepkit
  三版本），钉住 occt 历史路径保留与 brepkit 恒等面演化，并含 `cad.faceRef` 解析的端到端
  选面/点名用例。

## Alternatives considered

- **保留 `engines:['occt']`** —— 否决：会整块挡死 brepkit；用户需求是「只要能降级的 op 一律
  降级到至少能用」，`*WithHistory` 有无并不重要。
- **裸 L1 调用且降级路径不带面演化（初版实现）** —— 否决：变换保留面数/面序，不带面演化会
  无故破坏 brepkit 上的选面/命名，而恒等映射在此真实正确；虽符合 intersect/chamfer 的降级
  纪律，但此处无利却有害。
- **在「内核不保面」场景伪造恒等映射（一般性担忧）** —— 对 transform 不适用（见上）；对真正
  丢失面拓扑的 op，「不伪造」纪律继续保留。