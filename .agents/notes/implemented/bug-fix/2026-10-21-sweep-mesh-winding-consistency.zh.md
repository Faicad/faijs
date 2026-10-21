# Agent Note: 扫掠网格的绕序是网格输出契约，不是内核细节

Status: implemented

[English](2026-10-21-sweep-mesh-winding-consistency.md) | 中文

## Problem

小程序里的扫掠体显示成**破壳**：表面裂开一个大楔形洞，整体读起来是"面片"而不是实心。
同一个体导出 STL 看着却正常 —— 正是这一点让报告看起来像渲染器的缺陷。

两个现象出自同一个事实：`cad.sweep` 返回的网格里，有一部分三角形**以相同方向**
遍历共享边（非流形绕序）。渲染层用 `FrontSide` 单面绘制，朝向反的那片被剔除、表面
就裂开；STL 查看器通常双面渲染，同样的三角形在那里看着是实心的。

真机几何（逐字来自报告）：

```js
let sk0 = cad.sketch({ shapes:[{kind:'rect', cx:-0.5, cy:-0.5, w:29, d:27}], constraints:[], plane:'XY' })
let w0 = cad.sketchOnPlane({ contours:[{segments:[
  {kind:'line', x1:0, y1:0, x2:12, y2:-11},
  {kind:'line', x1:12, y1:-11, x2:17, y2:-35}]}],
  plane:{origin:[-0.5,-0.5,0], normal:[-1,0,0], xAxis:[0,0,1]}, as:'wire' })
let part0 = cad.sweep(sk0, w0)
```

实测该网格（28 顶点 / 52 三角）：**8 条边被两侧三角形同向遍历**，涉及 21% 的表面积。

单因素实测把触发条件隔离出来：

| 截面 | 路径 | 绕序冲突 |
|---|---|---|
| 29×27 | 两段折线（拐角 35.7°） | **8** |
| 8×8 | 同一折线 | 0 |
| 29×27 | 单段直线 | 0 |
| 14×14 | 同一折线 | 0 |

必须**同时**是大截面 + 折线路径。截面在拐角平面内的半宽 13.5mm 乘 `cot(拐角/2)` 约
41mm，而第一段只有 16.3mm —— 截面在拐角内侧扫过自身，侧壁的边界曲线自交，内核的
扇形三角化把这个凹/自交多边形拆成了互相交错的三角形。

所以**几何本身是自交的**（这是另一个、上游的产品问题）。但网格仍然必须是*可渲染的*：
绕序一致是网格的属性，而仓库里早就有这个算法 —— `mesh/reconcile.ts` 的
`unifyOrientation` —— 只是 `cad.sweep` 从来没调用它。把它当成"内核的事"，结果就是
唯一一个单面绘制的消费方裂开了洞。

## Decision

`sweepBrep` 在返回前把 BREP 派生的网格过一遍 **`weldVertices` + `unifyOrientation`**
（`packages/core/src/api/sweep.ts`）。

有三处细节是承重的：

1. **就地改写载荷，绝不 `{...s}`。** BREP 句柄挂在 runtime slots 上、以 shape **对象
   引用**为键（`shape.ts:480 brepOf`）。展开 shape 会造出新对象，其 `brepOf` 为
   `undefined`，紧接着的 `getBoundingBox` / `getVolume` 直接崩。（这一点立刻被撞到：
   修正前有 3 个既有 sweep 测试因 `getBoundingBox` 失败而红。）
2. **不做退化三角形剔除。** `weldVertices` 与 `unifyOrientation` 都不改变三角形数量
   与顺序，因此 `materialGroups` 的 `(start, count)` 仍然有效。走完整的
   `reconcileMesh` 会顺带删掉零面积三角形、让面序悄悄重排。
3. **不做流形断言。** 这是显示网格的规整，不是实体验证。自交的体在这里修不成有效
   实体（该不该接受它属于上游判定），但网格必须能正确单面渲染。

## Alternatives considered

- **渲染层改用 `DoubleSide`。** 在每个消费方掩盖症状（光照与阴影的法线仍然是错的），
  而且 `cad.sweep` 继续输出违反契约的网格。否掉：缺陷在数据里，不在材质里。
- **在 weapp 渲染层修补网格。** 这确实是内核无关的、也能用，但等于在消费方重写一遍
  `unifyOrientation`，其它 `cad.sweep` 调用方照样坏，并且把正确性保证放进了"只负责
  显示"的那一层。
- **走完整的 `reconcileMesh`（焊接 → 去退化 → 绕序统一 → 断言）。** 去退化会重编三角形
  序号、让 `materialGroups` 失效；流形断言会把"自交但可显示"的体变成硬失败。作为
  显示路径的修法否掉。
- **在 brepkit 的 sweep 里修。** 对自交的扫掠，全局一致的朝向本来就不存在，内核无法
  承诺。它只能报告或拒绝，而且那是另一个仓、反馈回路慢得多。
- **改为拒绝输入（可扫掠性校验：截面包络 vs 段长与拐角角）。** 正交，且仍然值得做 ——
  它能从根上避免产出自交实体。但它替代不了本修法：无论体是否有效，网格都必须正确渲染。

## Consequences

- `cad.sweep` 的输出现在按契约保证绕序一致，由
  `test/api/sweep-mesh-winding.test.ts` 钉住（真机几何要求冲突 0；8×8 对照组
  守住断言本身不产生假阳性）。
- 端到端已验证：同一份网格用渲染层自己的参数（`FrontSide`、60° crease）渲出来，
  从开口的洞变成实心；重建 worker bundle 后，weapp 探针报告的绕序冲突为 0。
- **自交的体仍然是自交的体。** 这个形状的体积、布尔、STEP 导出依旧不可靠；本修法让
  它*能画*，不是让它*有效*。截图现在看着是实心的，这正是上游校验必须做的原因 ——
  没有它，一个无效的体看起来是可接受的。
- 未改动 `cad.loft` / `cad.revolve` / `cad.extrude`。它们在病态输入上可能有同一类缺陷；
  同样两行调用适用，但每个都要先有自己的证据再动。
