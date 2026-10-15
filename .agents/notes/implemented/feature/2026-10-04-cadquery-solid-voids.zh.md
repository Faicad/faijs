# Agent Note：CadQuery 自由函数 solid + solidWithInner

English | [中文](2026-10-04-cadquery-solid-voids.md)

Status: implemented

## Problem

CadQuery 的 `Workplane.solid()` 与 `Workplane.solid(inner=...)` 从一组面构建实体，并处理内部空腔。上游 `test_solid` 导出 12 个变量；其中 8 个因缺少 `solid`、4 个因缺少 `op:solid-voids` 而被阻塞。faijs 未实现这些函数。

## Decision

在 `workplane.ts` 中实现了两个自由函数：

1. **`solid(...inputs)`** ——缝合来自输入的全体面。单壳 → 直接 `makeSolid`。多壳（外轮廓 + 内部空腔）→ 取体积最大的壳作为外壳，对其余做布尔减。
2. **`solidWithInner(outer, inner[])`** ——显式外层面 + 内部空腔面。外层：缝合 + makeSolid。每个内层：优先使用 `wp.baseShape`（面选择前的原始实体）直接取得实体句柄，绕开缝合-Face 的问题；回退为缝合内层面 + makeSolid。

### 关键：用布尔减，而不是 buildSolidFromFaces

`buildSolidFromFaces` / `sewAndSolidify` 会把内层面当作外层面，从而**加上**空腔体积而非减去。布尔减（outer − inner₁ − inner₂）才是正确的：它保留所有面（外层 + 反转定向作为空腔边界的内层）。

### 关键：wp.baseShape 与 wp.shape

`Workplane.clone()` 会把 `out.shape = out.objects[0]`，因此在 `cq.faces(sph, '')` 之后 `.shape` 变成第一个面，而不是原始实体。`.baseShape` 保留面选择前的原始形状。这对 `solidWithInner` 很重要——内层输入是经过面选择的 workplane，布尔需要用原始实体句柄，而不是重新缝合的面。

## Discoveries (GOTCHA)

1. **CadQuery `sphere(d)` 中 d 是直径不是半径。** `sphere(0.1)` → 半径 0.05。faijs `cq.sphere(wp, radius)` 直接接收半径，因此镜像用 `cq.sphere(wp, 0.05)`。
2. **CadQuery `.moved(shape)` 移动到形状的 CENTER 而非其 Location。** Solid 的 `toLocs()` 返回 `Location(self.Center())`。`box(10,10,1)` 中心在 (0,0,0.5)，所以 `sphere(0.1).moved(b_large)` 把球放在 (0,0,0.5)。
3. **`kernel.sew([sphereFace], 1e-6)` 返回 Face，不是 Shell。** `makeSolid` 不能包裹 Face。解决：对于源自实体的内层输入，直接用 `wp.baseShape` 拿到原始实体句柄，完全绕开缝合。

## Parity

12 个变量全部 PASS（volΔ=0、comΔ=0、topo 完全匹配）：
- b/b_large/b_small/b1/s1/s2：f6/e12/v8
- sphere1/sphere2：f1/e3/v2
- s3/s4/s6：f18/e36/v24
- s5：f8/e18/v12

## Alternatives considered

- **使用 `buildSolidFromFaces` / `sewAndSolidify`**：拒绝——会把内层面当作外层面并加上空腔体积而非减去。
- **重新缝合内层面而非使用 `wp.baseShape`**：拒绝——`kernel.sew([sphereFace], 1e-6)` 返回 Face 而非 Shell，`makeSolid` 无法包裹；`wp.baseShape` 直接给出原始实体句柄。

## Consequences

- ported 476→488，blocked 166→154。标签 `solid`(8) 与 `op:solid-voids`(4) 消除。
- G-C8 剩余：3 个 `addCavity` 用例（推迟到 B4）。
- Manifest 影响：12 个变量解锁。
