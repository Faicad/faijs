# Agent Note: CadQuery 自由函数 solid + solidWithInner（B2-2）

Status: implemented

English | [中文](2026-10-04-cadquery-solid-voids.md)

## Problem

CadQuery 的 `Workplane.solid()` 与 `Workplane.solid(inner=...)` 从一组面构建实体，并处理内部空腔。上游 `test_solid` 导出 12 个变量；其中 8 个因缺少 `solid`、4 个因缺少 `op:solid-voids` 而被阻塞。faijs 需要在 occt-wasm BREP 链上提供相应的自由函数，并达到 12/12 parity。

## Decision

在 `workplane.ts` 中实现了两个自由函数：

1. **`solid(...inputs)`** ——缝合来自输入的全体面。单壳 → 直接 `makeSolid`。多壳（外轮廓 + 内部空腔）→ 取体积最大的壳作为外壳，对其余做布尔减。
2. **`solidWithInner(outer, inner[])`** ——显式外层面 + 内部空腔面。外层：缝合 + makeSolid。每个内层：优先使用 `wp.baseShape`（面选择前的原始实体）直接取得实体句柄，绕开缝合-Face 的问题；回退为缝合内层面 + makeSolid。

### 关键：用布尔减，而不是 buildSolidFromFaces

`buildSolidFromFaces` / `sewAndSolidify` 会把内层面当作外层面，从而**加上**空腔体积而非减去。布尔减（outer − inner₁ − inner₂）才是正确的：它保留所有面（外层 + 反转定向作为空腔边界的内层）。

### 关键：wp.baseShape 与 wp.shape

`Workplane.clone()` 会把 `out.shape = out.objects[0]`，因此在 `cq.faces(sph, '')` 之后 `.shape` 变成第一个面，而不是原始实体。`.baseShape` 保留面选择前的原始形状。这对 `solidWithInner` 很重要——内层输入是经过面选择的 workplane，布尔需要用原始实体句柄，而不是重新缝合的面。

## 发现（GOTCHA）

1. **CadQuery `sphere(d)` 中 d 是直径不是半径。** `sphere(0.1)` → 半径 0.05。faijs `cq.sphere(wp, radius)` 直接接收半径，因此镜像用 `cq.sphere(wp, 0.05)`。
2. **CadQuery `.moved(shape)` 移动到形状的 CENTER 而非其 Location。** Solid 的 `toLocs()` 返回 `Location(self.Center())`。`box(10,10,1)` 中心在 (0,0,0.5)，所以 `sphere(0.1).moved(b_large)` 把球放在 (0,0,0.5)。
3. **`kernel.sew([sphereFace], 1e-6)` 返回 Face，不是 Shell。** `makeSolid` 不能包裹 Face。解决：对于源自实体的内层输入，直接用 `wp.baseShape` 拿到原始实体句柄，完全绕开覆盖缝合。

## Parity

12 个变量全部 PASS（volΔ=0、comΔ=0、topo 完全匹配）：
- b/b_large/b_small/b1/s1/s2：f6/e12/v8
- sphere1/sphere2：f1/e3/v2
- s3/s4/s6：f18/e36/v24
- s5：f8/e18/v12

## Manifest 影响

ported 476→488，blocked 166→154。标签 `solid`(8) 与 `op:solid-voids`(4) 消除。G-C8 剩余：3 个 `addCavity` 用例（推迟到 B4）。

## 备选方案

- **`buildSolidFromFaces` / `sewAndSolidify`**：直接方案，但会把内层面当作外层面并**加上**空腔体积而非减去；对 `solidWithInner` 与多壳 `solid` 场景会产生错误的空腔拓扑。
- **布尔减（`kernel.cut`，outer − inner…）**：正确的空腔/保留面语义；采纳。对源自实体的内层输入，`wp.baseShape` 直接给出原始实体句柄，避免重新缝合面的问题。
- **把内层面缝合（`kernel.sew([f], 1e-6)`）作为内层句柄**：否决——返回 Face 而非 Shell，`makeSolid` 无法包裹 Face。

## 影响

ported 476→488，blocked 166→2→154；`solid`(8) 与 `op:solid-voids`(4) 消除。G-C8 剩余为 3 个 `addCandida` 用例，推迟到 B4。