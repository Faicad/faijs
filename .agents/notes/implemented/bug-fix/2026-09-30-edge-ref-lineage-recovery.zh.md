# Agent Note：`edgeRef` 通过血缘回走找回「无血统」的邻面

Status: implemented

[English](2026-09-30-edge-ref-lineage-recovery.md) | 中文

## Problem

`cad.edgeRef(of, N)` 把编号边解析成携带两个邻面 `(origin, role)` 身份的
`EdgeTopoRef`。面路径早已具备「身份缺失时沿血缘回走恢复」的能力，边路径没有。

`resolveFaceGeometry` 遇到 `RoleTable` miss 时调 `recomputeViaLineage`：沿血缘
DAG 重算该面的 hash 集并回填。`edgeRef` 没有这一步，它只做正查
`findOriginRole(table, ordinalToHash, fo)`（「哪个 `(origin, role)` 拥有这个面
hash」），`undefined` 就抛 `E_TOPO_NOT_FOUND` / `no role lineage`。

miss 不是用户写错了。part 的 `RoleTable` 只是**缓存副本**，某个面的条目可能从
目标 part 丢了、而**根节点**（名字诞生处）仍然完整正确——典型成因是中间 op 把
旧 hash 表原样带走。身份一直都在，只是目标副本丢了。面路径能吃下这种 drift，
边路径却直接失败，于是这类 part 上的 `cad.fillet` / `cad.chamfer` 死于
`no role lineage`。

## Decision

给边路径补上与面路径**方向相反**的镜像恢复，且只在正查失败后才跑。

`recoverEdgeRole`（`packages/core/src/api/topo-resolve.ts`）的遍历方向与
`recomputeViaLineage` 相反：面路径已知 `(origin, role)`、去找它的 hash；边路径
已知面 hash、去找 `(origin, role)`。它枚举所有已登记节点输出表里的
`(origin, role)` 候选（按假设根节点的表是完整的），对每个候选把根序沿 DAG 推进
到目标 part、换算成该 part 当前的面 hash 集，取包含目标面 hash 的那个候选。

`edgeRef` 仅在 `findOriginRole` 返回 `undefined` 时调它，并回填恢复出的
`{origin, role}`，让原有解析流程（exact 命中或几何兜底）照常继续。

推进规则自带、不套 `resolveViaLineage` 那套更严的契约，因为这里会遇到更宽的
节点形态：

- 有 ordinal 演化（`HashEvolution`）→ 照用；
- `identity` 血缘（copy / place / transform）但**未挂演化** → 按 1:1 推进
  （语义正确：identity 不改面序），顺带覆盖 `place.ts` 经 compat 路径从未调
  `attachEvolution` 的既有缺口；
- 其余无演化 → 放弃该候选，不乱猜。

推进带 `seen` 访问守卫，异常 DAG 环路直接放弃而不是挂死。

## Consequences

- 邻面身份在血缘根处存在、仅目标 part 缓存缺失时，`edgeRef` 不再抛
  `no role lineage`。
- 零回归是结构性的而非偶然：所有候选都不命中时返回 `undefined`，调用方原样保留
  旧错误；且只在失败路径上跑，热路径零变化。
- `LineageGraph.stmtIds()` 是唯一新增的图 API——供候选枚举用的只读访问器，图本身
  行为不变。
- 「identity 类未挂演化」是**既有缺口**而非本次引入：compat 路径上的
  `place.ts` 不调 `attachEvolution`。1:1 规则只是在恢复层面绕过它，根子上的缺口
  仍开着，值得在源头修掉。

## 值得记住的坑

证明恢复有效的那个测试，**出现了 vitest 没抓住的 typecheck 失败**：
`tableOfPart` 返回 `ReadonlyMap<string, …>`，而 `RoleTable` 是
`ReadonlyMap<StmtId, …>`，`StmtId` 又是 branded 类型。vitest 跑绿（类型被剥掉），
`tsc --noEmit` 却在三个调用点报错。**vitest 绿不等于集成测试过了 typecheck。**

## Files

- `packages/core/src/api/topo-resolve.ts` — `recoverEdgeFaceRole` 及其
  `lineageHashesAt` 推进（候选枚举、推进规则、环路守卫）。
- `packages/core/src/api/edge-ref.ts` — 以 `findOriginRole` 返回 `undefined` 为
  闸门的恢复调用与回填。
- `packages/core/src/topology/naming/lineage.ts` — `stmtIds()`。
- `packages/tests/faijs/edge-ref/edge-ref-lineage-recovery.test.ts` — `box → place`
  链删掉 `placed` 的 role 条目复现 drift；断言单元级恢复返回真身份、端到端
  `edgeRef` 能解析，以及「根节点也残缺时必须仍抛原错」的 control 段。

## Alternatives considered

- **先猜 `(origin, role)`，再复用 `recomputeViaLineage`。** 否决：该函数回答的是
  反向问题（身份 → hash），调用它就等于已经知道答案。
- **miss 时整体重建目标 part 的 `RoleTable`。** 否决：那是在错误路径上对运行期状态
  做大范围改写，而只读推进 + 局部回填已经够覆盖这个场景。
- **把 `no role lineage` 当成硬性作者错误、不动。** 否决：同一类 drift 在面路径已经
  可恢复，边路径保持严格会让 `edgeRef` 在 `resolveFaceGeometry` 能接受的模型上失败。
