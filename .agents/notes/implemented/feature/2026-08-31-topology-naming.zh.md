# Agent Note: TopoRef 命名层——跨历史拓扑身份

Status: implemented

[English](2026-08-31-topology-naming.md) | 中文

## Problem

faijs 的拓扑身份纯靠序号（`o1.f3`，`TopExp::MapShapes` 枚举序）。序号只在「当前这一个 solid 快照」内有意义：一旦上游语句改参、插入/删除布尔，枚举序就变，`o1.f3` 会指向另一个面。今天能工作，是因为钻孔/装配绕开 id、直接存几何快照（法向/中心）——这只是缺命名层时的临时补丁，无法表达「改参重放后的同一个面」，而倒角选边与特征引用正需要它。STL/3MF 的 mesh 假拓扑根本没有 OCCT solid，永远不会有 hash 血缘。

## Decision

在不动快照内地址层的前提下，新增跨历史身份层。`TopoRef`（纯数据、JSON 安全、写进 `.faijs` op 参数）以 `{origin, role}` + 几何 hint 命名面/边/顶点/生成面；解析方向单向——`TopoRef` → 解析器 → 当前快照序号或活 BREP 句柄。绝不反向把序号当稳定身份存进脚本。

`RoleTable`（origin → role → 面 hash 列表）只是执行内状态：随 Shape 身份槽与 runtime 持久 `roleTableCache` 传播（与 `faceEvolutionCache` 同生命周期），不序列化，跨会话整体重建。hash 键演化来自现有 `*WithHistory` 的同一份打包结果（`decodeHashEvolution`、布尔 A/B 拆流的 `splitHashEvolutionByOrigin`），零新增 wasm 调用。解析显式三态——成功 `exact` / `geometric-fallback`；失败抛 `TopoRefError`（`E_TOPO_DELETED` / `E_TOPO_AMBIGUOUS` / `E_TOPO_NOT_FOUND`）——绝不静默拿序号硬取。

来源能力分级：BREP part 带沿演化传播的语义+位置 role（`box:top` 等）；primitive 假拓扑用同一套语义命名器按固定面序命名；mesh（STL/3MF）part 只给 hint（`role=''`），恒走几何解析，不确定性显式上报。part 在链中途从 BREP 降级 mesh 时，已累积的 `{origin, role}` 与 hint 作为纯数据保留，解析回落到面 hint 快照——这是引用解析层面的降级，不是引擎路径运行时回退。

## Alternatives considered

- **保留序号、只加几何快照引用。** 拒绝：快照扛不住「面被参数改动移动」的重放；本层的意义恰恰是跨重放的身份。
- **给 mesh 伪造 hash 血缘。** 拒绝：mesh 无 solid、无演化、无链；伪造血缘正是「假拓扑冒充精确」。
- **原样搬 brepjs（单 origin、实体结果）。** 拒绝：faijs 布尔有 target+tool 双输入，必须用 `RoleQualifier`（带 origin 的 role）+ A/B 拆流合表；hash 在这里是会话内活句柄，不是持久身份。

## Consequences

- `ExecutionResult.naming` 携带每 part 命名行；宿主把拾取序号反查到命名行，经 `captureTopoRef` 造 `TopoRef`。
- stdlib primitive 在链根建表；transform/copy 按 hash 恒等传播；布尔每步合并 target/tool 两侧的表（缝面以本次语句 LHS 为新 origin）。
- 边 = 两邻面 role 的公共边（布尔合流后可跨 origin）；顶点 = ≥3 面顶点邻接的交；生成面（倒角/圆角）按桥接两面的法向混合解析。
- mesh 能力边界显式：无边 lineage、无 role——只 hint、几何解析、诚实的 `ambiguous`/`not-found`，绝不静默选错。
