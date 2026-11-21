# Agent Note: SMLib borrowed 子形状的哈希必须以 solid 的枚举序为根

Status: implemented

[English](2026-11-21-smlib-edge-adjacency-lineage.md) | 中文

## Problem

在 SMLib 内核下，一个普通长方体的任何一条边都无法构造出 `EdgeTopoRef`，因此选中一条边
后做倒圆角/倒角预览会直接失败：`TopoRefError: edge naming has no adjacent-face lineage
(mesh limitation)`。在 mweb 复现：`cad.box` → 圆角工具 → 点一条边 → 预览。

故障点不在命名层。`buildAssemblySelectorManifest` 通过 `kernel.hashCode(edge)` 给每个面
环里的边计算哈希、再用 `isSame` 消歧，把它们映射回 solid 边枚举的序号，以此推导
面→边与边→面邻接。SMLib 适配器把 borrowed 子形状的确定性哈希记成 `(owner, index)`，
因为 C++ 侧只返回 slot id。同一条边会被枚举两次——作为 `face → edge` 枚举的第 i 条，以及
`solid → edge` 枚举的第 j 条——两次拿到的句柄完全相同，而后一次记录覆盖了前一次。于是
`hashCode(faceEdge)` 解析成 `(face, i)`，而 `buildEdgeOrdLookup` 的键是 `(solid, j)`，
`findOrdinal` 在哈希闸门就未命中，`isSame` 根本轮不到执行。结果每张面的 `edgeCount = 0`、
每条边的 `faceCount = 0`，`edgeFaceOrdinalsOf` 对全部边返回 null，`buildPartNaming` 随之
为每条边行输出 `faces: null`（`origin/role` 也是 null）。`captureTopoRef` 正确地拒绝伪造
身份，也就是用户看到的那条报错。

同一轮排查还暴露出第二个独立缺口：`assignRoles` 要求 `surfaceType === 'cylinder'` 才给
圆柱的侧立面命名，但 SMLib 把圆柱侧面建成等半径锥面并报 `'cone'`（实测 `makeCylinder`
三张面的曲面编码是 `[2,0,0]`）。整张侧面因此不进角色表，所以在圆柱上丢的不只是边的血统，
连面的身份都没有。

## Decision

两条规则，都以不变量表达，而不是在症状处打补丁：

1. SMLib 适配器的 `recordSubShape` 把 solid 的枚举序作为规范序号：在当前 arena epoch 内，
   一旦某个句柄已被某个 solid owner 记录，非 solid owner（面或 wire）不得覆盖它。而后续的
   solid→edge 枚举仍可覆盖非 solid 记录，因此无论枚举先后顺序如何，映射都会收敛到
   `(solid, j)`。
2. `assignRoles` 按 op 语义给圆柱（以及圆锥）的侧立面命名——凡不是端盖的面就是侧立面——
   而不是比较内核的曲面类型字符串。`cad.cylinder` 产出的实体按构造恰好是两个端盖加一个
   侧立面。

`test/topology/naming/smlib-edge-face-adjacency.test.ts` 把这两条都钉死，其中包括对长方体
每一条边名行调用 `captureTopoRef`，并且该用例在修复前的代码上会以与用户流程完全相同的
方式失败。`packages/core/test/topology` + `packages/core/test/smlib-kernel` +
`packages/core/test/brep` + `packages/core/test/cad-runtime` 保持全绿。

## Alternatives considered

- **把 `hashCode` 改成内容哈希（曲线类型 + 端点）。** 否决：`meshShape` 的 `faceGroups`、
  `wireframe` 的 `edgeGroups` 哈希由 C++ 侧按 solid 枚举序生成；适配器换一套哈希函数会与
  这些缓冲对不上，三角形与折线的查表随之失效。
- **让面→边枚举按所属 solid 记录，而不是按面记录。** 作为主修法否决：适配器没有父指针，
  solid owner 只有在一次 solid→edge 枚举之后才可知；"solid 优先"规则不需要额外状态，且与
  枚举先后无关。
- **放宽 `captureTopoRef`，让没有血统的边行退化成只有 hint 的引用。** 否决：这正是命名
  契约明令禁止的静默降级。数据在源头就是错的，UI 应继续拒绝据此构造引用。
- **在 `surfaceType` 里用采样法向来识别"等半径锥面"。** 否决：廉价的启发式会把锥度很小的
  真圆锥误判成圆柱，而唯一的功能消费方（角色分配）本来就掌握 op 类型，那是精确信息。

## Consequences

- 在 SMLib 上，长方体/圆柱/棱柱的边现在带 `faces` 与 `origin/role`，因此
  `hasUsableEdgeNaming` 为真、`EdgeTopoRef` 可构造，选中边做倒圆角/倒角会产出几何而不是抛错。
- 面行在 SMLib 上补上了 `edgeStart/edgeCount`，因此靠边界的面拾取、以及任何消费面→边表的
  调用方（选择器辅助、实体哈希）看到的是同一张连通图，而不是空表。
- 圆柱侧面在 SMLib 上现在命名为 `lateral`；其上报的 `surfaceType` 仍是 `'cone'`，因为内核
  就是这么建模的。消费方不得在 SMLib 上凭 `surfaceType` 推断"这是圆柱"。
- 下游宿主需要消费新的 faijs 版本线；mweb 走常规 tgz 刷新取用，长方体→倒圆角→预览流程
  由一条 mweb e2e 用例覆盖。
