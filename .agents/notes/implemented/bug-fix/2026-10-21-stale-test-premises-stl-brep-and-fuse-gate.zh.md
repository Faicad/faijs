# Agent Note：两个长期红灯的测试冻结了后来被推翻的前提——以及判决门禁如何保持诚实

Status: implemented

[English](2026-10-21-stale-test-premises-stl-brep-and-fuse-gate.md) | 中文

## Problem

这四条测试在本轮任何改动之前就已红了好几周；用 `git worktree` 检出干净 `HEAD` 的副本能
逐条复现，这是它们没被误判为回归的唯一原因。两组失败是同一个形状：**断言冻结了一个
前提，而后来的、有意的变更已经把它推翻了**，变更落地时没人回头看那份测试。

1. `test/brep/case2-load-stl-cylinder-assembly.test.ts` 断言「STL → mesh，`cube_v0`
   无 solid」（`solidCache` / `brepSolids` 里都不该有它）。v0.35.6（commit `28c2811`）
   把 **STL 接上了 BREP 路径**（brepkit `importStl` + `weld`/`unify`；occt
   `reconstructSolidFromMesh`），目的正是让导入件能被圆角/钻孔/分割 —— 这些能力在
   「没有面-边邻接的壳」上全部不可用。所以 `cube_v0` 现在持有 BREP 句柄，两条断言
   恰好断言了已发布行为的反面。`docs/api-contract.md` §8 早就白纸黑字写了
   （「**STL is not on the mesh path** since v0.35.6」），测试没有跟上。

2. `test/brep/engine/engine-verdict-equivalence.test.ts` 把 brepkit 上的拒绝集合冻结在
   **删掉 `capabilities` 轴那一刻**，要求 `oldBlocked == newBlocked` 严格相等。
   v0.35.7（commit `72ab6bc`）在确认 `fuseBrep` 只调 `getBrepApi().fuse`（brepkit 也有
   的 L1 方法）之后，移除了 `fuse` 的 `engines: ['occt']`。这是一处**有意的**拦截
   消失 —— 于是等式破了，门禁红在了错误的理由上。

第二种情形才是有意思的地方：门禁**在正常工作**。「判决集合的任何变化都必须现形」正是
我们要的。缺的是记录一次**已复核**变更的手段，否则真回归会被常红基线淹没。

## Decision

**case2 —— 把断言改成已发布的前提，并让它更咬人。** 这份文件自己的论点（逐 part
BREP 独立）从来不依赖「STL 是 mesh」，依赖它的只是括号里的说明。所以现在断言
`cube_v0 ∈ solidCache` 为 `true`，内联 v0.35.6 的出处，并补两条**比原来更强**的形状侧
断言：`hasBrep(cube_v0) === true`、`hasMeshSolid(cube_v0) === false`。第二个
`brepSolids` 用例改成断言真正要紧的事 —— 两个终端都在表里，且**不共享句柄**
（`cubeSolid.solid !== matedSolid.solid`），这正是「逐 part 而非一条全局链」的可观察面。
「mesh 零件永不进 `solidCache`」这条**不**在此重复：它在
`test/api/load-mesh-solid.test.ts:171` 里对着 3MF/mesh 模式守着，那是现在唯一剩下的
mesh 路径。一个事实两个家，正是这个缺口当初打开的方式。

**verdict-equivalence —— 保留冻结的 `HEAD` 快照，加一本账。** 新增
`INTENTIONALLY_UNGATED_BREP_OPS`，逐 op 记录 `HEAD` 之后**已复核**的放宽，每条必须带
**commit + 几何实证 + 为何仍安全**。三条缺一不可；缺了就不是豁免，而是洞。两条差集
断言变成：

- 「新增拦截」必须仍为空 —— 过度收窄永远不能作为偏离被接受。
- 「丢失拦截」必须**恰好等于**账本的键集。静默放宽依旧红；账本条目过期（op 又被加回
  门禁）同样红，因为每个键都会对着 `HEAD` 被拦集合校验。
- `fuse` 的实证指向 `test/brep/engine/brepkit-fuse-op.test.ts`：两个错位 10³ 盒并集
  volume ≈ 1875 —— 几何真值，不是「没报错」。

咬合度已验证：把账本里的 `fuse` 键改名重跑，2 条红（`expected [Array(19)] to deeply
equal [Array(20)]`，以及差集断言点名 `fuse`），还原后转绿。

## Alternatives considered

- **把 `fuse` 翻回被拦集合**（重新加 `engines: ['occt']`）。会重新打断钣金折弯路径 ——
  它在 brepkit 上直接调 L1 `fuse` —— 并且与既有的实证结论矛盾。靠撤掉一个修复来让测试
  变绿，方向就是反的。
- **删掉这四条断言。** 等式门禁拦的是一整类回归（某个 op 意外丢掉引擎限制）。为了 CI
  变绿删掉它，等于用一个可见问题换一个不可见问题。
- **把 case2 换成 3MF fixture，好让「STL → mesh」活着。** 那个前提是被有意废弃的；
  换个文件让它继续活着，等于在别处写下一句关于产品的假话。mesh 终端的不变量已经在它
  该在的地方被覆盖。
- **把 `HEAD` 快照改写成今天的状态。** 那样它就再也证不了「删轴那一刻判决没有漂移」，
  而那正是它存在的唯一理由。

## Consequences

两组失败本来都能靠读契约发现：`docs/api-contract.md` §8 直接写明了 STL 的变更，
`arg-spec.ts:183-187` 有五行事无巨细的注释解释 `fuse` 的门禁为何被移除。测试只是没有
被纳入那次变更的清单。两条值得带走的后果：

- **翻转某个不变量的行为变更，必须反查断言该不变量的测试。** 「哪些测试提到了这个 op／
  这种文件格式？」是一次很便宜的搜索；这两处本来都能被抓到。
- **冻结快照式的门禁确实需要动时，给它配一本有准入规则的账，而不是放松断言。** 差别
  在于下一次未经复核的变更是否还能让门禁变红。

还有一笔更安静的代价：**常年红着的门禁会训练人忽略它**。这四条失败待在一个除此之外全
绿的套件里，于是「4 红，既有」成了状态报告里一句正常的话。账本把那句话变成「0 红」——
那才是未来的回归能显出形状的基线。

## Verification

- 两个文件一起跑：16 通过。
- 全量：**4881 通过 / 0 失败**（此前 4880 通过 / 4 失败）。
- 账本咬合检查：把 `fuse` 键改名后恰好 2 条失败 —— 集合相等断言
  （`expected [Array(19)] to deeply equal [Array(20)]`）与点名 `fuse` 的差集断言；
  还原后 10/10。
- 新增笔记对：`verify-agent-note-format`、`verify-agent-note-classification`、
  `verify-md-wrap`、`verify-md-links`、`verify-translation-pairing` 全绿。

## Files

- `packages/core/test/brep/case2-load-stl-cylinder-assembly.test.ts` —— 修正前提；补
  `hasBrep`/`hasMeshSolid` 与句柄互异性断言。
- `packages/core/test/brep/engine/engine-verdict-equivalence.test.ts` ——
  `INTENTIONALLY_UNGATED_BREP_OPS` 账本 + `headBlockedOnBrepkit()` 辅助函数；账本键
  过期检查。
