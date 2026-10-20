# faijs 草图契约

[English](sketch-contract.md) | 中文

> 定位：本文档记录草图子系统的契约 —— 两条脚本面入口、它们交换的 canonical 几何、轮廓抽取规则，以及各入口面的角度单位约定。
>
> 相关文档：
> - `docs/api-contract.md` —— 引擎与运行时契约、脚本面单位常量、量纲校验通道、`paramDims` 声明纪律
> - `docs/ops-api-inventory.md` —— 写 `.fai.js` 用的 API 手册（逐 op 参数，生成文件）

---

## 1. 两条脚本面入口

| 入口 | 输入 | 处理 | 产物 |
|---|---|---|---|
| `cad.sketch` | `shapes`（语义图元）**或** `geoms`（canonical 几何），外加 `constraints` | planegcs 求解 → `extractContours` → 放置 | 平面；`as:'wire'` 时为外环 wire |
| `cad.profile` / `cad.sketchOnPlane` / `cad.sketchOnFace` / `cad.sketchOnSurface` | `contours` —— 段环（`ProfileLoop[]`）或已绘制轮廓（`Blueprint` / `Blueprint[]`） | 不求解；坐标原样使用 | 目标平面 / 面 / 曲面上的平面；`as:'wire'` 时为外环 wire |

`cad.sketch` 仅 BREP 可用 —— mesh 路径报 `E_MESH_UNSUPPORTED`。`cad.profile` 与 `cad.sketchOnPlane` 仅 BREP 可用且不带引擎门；`cad.sketchOnFace` 是引擎中立（在 brepkit 网格链上也能跑）；`cad.sketchOnSurface` 声明 `engines: ['occt']`。

两条入口在一个地方汇合：求解完成的 `cad.sketch` 把轮廓交给同一个放置核心（`buildSketchOnPlaneWith`），而放置入口直接调用它。

---

## 2. 角度单位

### 2.1 规则

**带量纲的槽位不接受裸数字。** 每个角度参数都声明为 `dim: 'angle'`，脚本必须写带单位的量 —— `90 * DEGREE` 或 `1.5708 * RADIAN`。裸 `90` 会被拒绝（`E_DIM_BARE_NUMBER`）。

单位常量就是普通数字，角度基准单位是度 —— `DEGREE = 1`、`RADIAN = 180/π` —— 所以两种写法表示同一个角，写哪个都行。

**内部用什么单位不属于契约。** sketch 库、`geometry2d/` 与各内核一律用弧度；每个 op 在自己的入口换算一次，下游见不到度。调用方只写"量"，所以将来改内部单位对调用方是不可见的。

### 2.2 全部角度槽位

| API | 角度字段 | 声明 | 换算 |
|---|---|---|---|
| `cad.sketch` `shapes[]` | `angle`（rect / roundedRect / ellipse / polygon / slot / trapezoid）、`a1` `a2`（trapezoid）、`a0` `a1`（arc） | `angle` | `anglesToRadians` |
| `cad.sketch` `geoms[]` | `a0` `a1`（arc）；`angle` `a0` `a1`（ellipse） | `angle` | `anglesToRadians` |
| `cad.sketch` `constraints[]` | kind 为 `angle` / `arcAngle` 的 `value` | `angle` | `anglesToRadians` |
| `cad.circleArc` / `cad.ellipseArc` | `startAngle`、`endAngle` | `angle` | —（本身即度） |
| `cad.rotate_euler` | `angles` | `angle` | — |
| `cad.wedge` | `angle` | `angle` | — |
| `cad.profile` / `cad.sketchOnPlane` / `cad.sketchOnFace` / `cad.sketchOnSurface` / `cad.punchHole` | `contours[].segments[]` → `startAngle`、`endAngle` | `angle` | `contourAnglesToRadians` |
| `cad.boolean` | `options.simplifyAngularTolerance` | `angle` | op 入口（`fromBase`） |

已经没有"裸弧度"那一行了。原先未声明的两个槽位 —— 轮廓弧角与 `simplifyAngularTolerance` —— 现在都声明 `angle` 并在边界换算，往那里传裸数字是**报错**，而不是静默产出错误几何。

### 2.3 换算发生在哪里

每个 op 在入口换算一次，且经量纲系统（`fromBase(value, 'radian', 'angle')`）而非局部常量：

- `cad.sketch` → `anglesToRadians`（`packages/core/src/sketch/op.ts`），对 `shapes` / `geoms` / `constraints` 一趟扫过。
- 四个放置入口 → `contourAnglesToRadians`（`packages/core/src/api/profile.ts`），对 `contours[].segments[]` 一趟扫过。

因此 `profileSegToCurve`（`packages/core/src/geometry2d/adapt.ts`）及其下游只见到弧度 —— 这也正是换算必须留在 **op 入口**的原因：内核产出的轮廓（`extractContours`，弧度）会经非脚本调用方到达同一批 helper，把换算放进 helper 会把它们换算两次。

### 2.4 检查在哪一步跑

`check()`（dry-run）会跑量纲 pass 并拒绝裸数字。**`execute()` 路径目前不跑** —— 见 `docs/api-contract.md` §15.3。

---

## 3. 角度字段登记表

一个度值只有在字段被登记后才会进入弧度内部。`SHAPE_ANGLE_KEYS`、`GEOM_ANGLE_KEYS`、`ANGLE_VALUE_CONSTRAINTS`（`packages/core/src/sketch/op.ts`）是 `anglesToRadians` 遍历的登记表，按 shape / geom / constraint 的 kind 索引。

| 语义图元 kind（`shapes[]`） | 角度字段 |
|---|---|
| `rect`、`roundedRect`、`ellipse`、`polygon`、`slot` | `angle` |
| `trapezoid` | `angle`、`a1`、`a2` |
| `arc` | `a0`、`a1` |

| canonical geom kind（`geoms[]`） | 角度字段 |
|---|---|
| `arc` | `a0`、`a1` |
| `ellipse` | `angle`、`a0`、`a1` |

| 约束 kind（`constraints[]`） | 角度字段 |
|---|---|
| `angle`、`arcAngle` | `value` |

**某个 kind 新增了角度字段，必须同时登记。** 未登记的字段会被 `anglesToRadians` 跳过，度值就当弧度被消费 —— 不报错，几何悄悄变错。没有任何检查把登记表与图元声明对齐，所以「给图元加一个角度字段」等于「同时改这里」。

---

## 4. canonical 椭圆

canonical 椭圆要求 `major ≥ minor`。`toFreeCadGeoms`（`packages/core/src/sketch/project.ts`）对输入做归一化：`rx < ry` 时交换半径并把长轴方向转 `+π/2`，于是 `major = max(rx, ry)`、`minor = min(rx, ry)`、`rot = angle + π/2`（否则 `rot = angle`）。焦距 `c = √(major² − minor²)`，两个焦点落在 `(cx ∓ c·cos rot, cy ∓ c·sin rot)` —— focus 1 在**负向**那一端。

**长轴没有方向，所以 `angleXU` 只在模 π 意义下有意义 —— 而求解边界两侧正好差这个 π：**

| 侧 | `angleXU` |
|---|---|
| 推入侧 —— `toFreeCadGeoms` 写入 | `rot` |
| 回读侧 —— planegcs 后端由解出的焦点反算 `atan2(f1 − centre)` | `rot ± π` |

两者是同一个椭圆。`rx=10, ry=20, angle=30°`（脚本面是度）归一化为 `major=20, minor=10, rot=120°`，回读得 `angleXU = −60°`；`135°` 与 `−45°` 同理是同一根轴。

对调用方的两条结论：

1. **不要把 `angleXU` 与输入的 `angle` 做数值比较** —— 按模 π 比较。
2. `fromFreeCadGeoms` 回映为 `rx = majorRadius`、`ry = minorRadius`、`angle = angleXU`，所以往返一圈拿回的 `angle` 是回读值，不是传进去的那个值。

---

## 5. 轮廓抽取

### 5.1 `cad.sketch` —— 只要闭合链

`extractContours`（`packages/core/src/sketch/contour.ts`）把求解后的几何串成环，**只保留闭合链与自带闭合的圆；开放链被丢弃**。两个端点在 `JOIN_TOL = 1e-7` 内视为相接，构造几何在最前面就被排除。一个环都没闭合时，`cad.sketch` 以 `E_SKETCHC_NO_CONTOUR: solved sketch produced no closed loop` 失败 —— 所以 `as:'wire'` 交不出「一条孤弧长出来的开放脊柱」。

### 5.2 放置入口 —— 轮廓原样使用

放置入口既不求解也不重新串链：`toContourBlueprints` 把每个 `ProfileLoop`（或已绘制的 `Blueprint`）转成一个轮廓，`organiseBlueprints` 给它们分类（嵌套 = 孔，不相交 = 独立岛），且不检查链是否闭合。`as:'face'` 下开放链不成面。`as:'wire'` 下：

- `cad.sketchOnPlane` / `cad.sketchOnFace` / `cad.sketchOnSurface` 取**第一条**——单条链（开放或闭合）原样返回，于是开放链得到开放 wire（扫掠脊柱路径）；多条不相交链时只返回第一条，因此多段开放路径要先接成一条链。
- `cad.profile` 取**面积最大**那个岛的外环，并丢弃孔环。

于是同一条开放链被 `cad.sketch` 拒绝，却被 `cad.sketchOnPlane({ as:'wire' })` 接受：两条入口的差别在于轮廓是**推导出来的**还是**直接给的**。
