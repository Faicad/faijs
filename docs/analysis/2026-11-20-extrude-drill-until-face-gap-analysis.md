# faijs 拉伸 / 钻孔 API 与 CadQuery「拉伸到面」语义的差距分析

> 报告出处：WorkBuddy（基于当前源码与测试逐项核对；结论只对应此刻代码状态）
> 写作日期：2026-11-20
> 范围：只做现状与差距分析，不含实施方案。

## 0. 结论速览

| 参照语义（CadQuery） | faijs 现状 | 承载 API |
|---|---|---|
| `extrude(until=<距离>)` 定长拉伸 | 支持 | `cad.extrude(face, length)` / `{length}` |
| `extrude(until="last"/"next")` 拉伸到最后一个面 / 下一个面 | **部分**：有 `'last'`/`'first'`，但语义是 baseFeature 的 bbox 沿方向近/远端近似，**没有 `'next'`** | `cad.extrude({upTo:'last', baseFeature})` |
| 拉伸到**指定某个面** | 支持（且目标形态比 CadQuery 更全） | `upTo: FaceTopoRef` / `'>Z'` 选择器 / `{plane}` |
| `cutBlind(until)` / `cutThruAll()` 从轮廓盲切 / 贯穿 | 有等价能力，但无同名 op 形态 | `cad.punchHole({contours, face, height?})`；`cad.drill` / `fai_drill` 按 `depth` |
| `hole` / `cboreHole` / `cskHole` 打孔 | 支持（含螺纹体系） | `fai_drill` / `fai_drill_tapper` |
| **`cutToFace` / 钻孔或切除到某个面（to-face / until）** | **不支持** | 钻/切 API 无 `upTo`、`toFace`、`until` 参数 |
| `combine="cut"`（拉伸即切除） | 不支持，需 extrude 后再 `cut` | `cad.cut = cad.subtract` |
| `.faces('>Z')` + Workplane 链式定位 | 无 Workplane 链；有独立选择器解析 | `faceBySelector` / `cadquery-selectors` |
| `both=True` 双向拉伸到面 / `taper` 拔模 | 双向仅数值 `backwardLength`；extrude 无 taper（`punchHole` 有 draftAngle） | `cad.extrude` / `cad.punchHole` |

一句话：**「拉伸到某个面」faijs 已经支持，且目标形态比 CadQuery 的 `until` 更丰富；真正的差距在「钻孔/切除到面」完全缺失、`until='next'` 语义缺失、以及缺少 Workplane 链式工作流。**

---

## 1. 参照系：CadQuery 的「拉伸到面」到底是什么语义

CadQuery 2.x 的相关方法签名（官方文档 / API reference）：

```python
Workplane.extrude(until, combine=True, clean=True, both=False, taper=None)
Workplane.cutBlind(until, clean=True, both=False, taper=None)
Workplane.cutThruAll(clean=True, taper=0)
Workplane.hole(diameter, depth=None, clean=True)
Workplane.cboreHole(diameter, cboreDiameter, cboreDepth, depth=None, clean=True)
Workplane.cskHole(diameter, cskDiameter, cskAngle, depth=None, clean=True)
```

要点：

1. `extrude` 的 `until` 是 **`float | str`**：数值表示拉伸距离；字符串只有 **`"next"` / `"last"`** 两个取值，表示拉伸到沿方向遇到的**下一个面 / 最后一个面**。它**不接受一个具体的 Face 对象**作为终止目标——用户口语里的「拉伸到某个面」在 CadQuery 里实际是「到下一个面 / 到最后一个面」+ 用 `.faces('>Z')` 等选择器事先圈定上下文。
2. `combine` 可取 `'cut'`：把本次拉伸直接当作切除，等价于「拉伸成刀 → 布尔减」。
3. `cutBlind(until)` 与 `extrude` 共用 until 机制；`cutThruAll` 贯穿。
4. 面定位靠 Selector（`.faces('>Z')` / `.faces('<Z')` / 索引 / 命名视图），挂在工作平面链上。

因此对比 faijs 时应当拆成三件事分别评估：**(a) 终止条件（到面/到距离）**、**(b) 面定位手段**、**(c) 工作平面链式工作流**。

---

## 2. faijs 现状：拉伸

### 2.1 API 形态

主 op：`cad.extrude`，定义在 `packages/core/src/api/extrude.ts:591`（`defineOp` 手写 dual-op，声明 `mesh` + `brep` 两条路径）。

```ts
// packages/core/src/api/extrude.ts:188-210
export type ExtrudeUpTo = FaceTopoRef | 'last' | 'first' | { plane: UpToPlaneSpec } | string

export interface ExtrudeOptions {
  length?: number
  normal?: Vec3                 // 缺省 [0,0,1]
  mode?: 'forward' | 'backward'
  backwardLength?: number       // >0 双向，与 mode:'backward' / upTo 互斥
  upTo?: ExtrudeUpTo
  baseFeature?: Shape
  offset?: number
}
```

调用形态（`normalizeExtrudeOptions`，`:228-240`）：

- `cad.extrude(face, 10)` → 沿 +Z 定长 10
- `cad.extrude(face, [x,y,z])` → 向量即「方向 × 长度」
- `cad.extrude(face, { length | upTo, normal, mode, backwardLength, baseFeature, offset })`

导出面：`@faicad/faijs` 根（`index.ts:151`）、`@faicad/faijs/api`（`api/index.ts:151-158`）、`cad` 脚本命名空间（`api/api-namespace.ts:183`）。

### 2.2 终止条件：已有四类目标

`extrudeUpToSolid`（`api/extrude.ts:325-492`）按 `upTo` 类型分四路：

| 目标类型 | 解析方式 | 代码位置 |
|---|---|---|
| `FaceTopoRef`（UI 拾取的任意具体面） | 取 faceRef 捕获的 center/normal 快照 | `:389-399` |
| `'last'` / `'first'` | baseFeature 的 bbox 沿拉伸方向远端 / 近端（bbox 投影近似） | `:340-360` |
| `'>Z'` 等选择器字符串 | 在 baseFeature 上 `resolveSelectorToFaceRefs`，命中 0 或多个面均报错 | `:361-383` |
| `{ plane: {point, normal} }` 显式平面 | 用平面方程直接确定截断面，支持自动定向 | `:384-389`、`:410-432` |

实现机制：**长拉伸 → 用目标面 center+normal 构造半空间盒 → `common` 截断**（`:401-491`）。平行方向抛 `E_UP_TO_PARALLEL`，够不到目标抛 `E_UP_TO_NO_INTERSECTION`。`offset` 让截断面沿法向偏移。`upTo` 提供时忽略 `length`（`:265-275`）。

**关键点**：这是「平面截断」——目标曲面只取 center+normal 构造平面，不按曲面真实形状贴合。对斜面/曲面目标，这是近似（与 CadQuery 的 until 中心投影近似思路相近，但 faijs 没有沿路径「下一个面」的概念）。

### 2.3 其他拉伸相关 op

- `fai_extrude`（`extra/ops/fai_extrude.ts:66`）：编辑器扩展 op，`mode:'centered'|'forward'|'backward'`，`centered` 即对称双向；带 `@deprecated` 注释但仍由编辑器消费。
- `svgExtrude` / `dxfExtrude`（`extra/ops/svg-extrude.ts`）：按 `depth`（可负）挤出。
- `complexExtrude` / `twistExtrude`：`api/generated/operations.ts:67-81`，brep-only。
- 产面 op：`cad.sketch` / `cad.profile` / `cad.sketchOnPlane` / `cad.sketchOnFace`，先产 planar face 再喂给 `extrude`。**没有 Workplane 类**（全仓无 `class Workplane`）。

### 2.4 测试覆盖

- `packages/core/test/api/extrude-upto.test.ts`：`upTo: faceRef` 到墙、`UpToLast`、offset、缺 baseFeature 报错、位置/对象形态、`{plane}` 斜基准面与自动定向。
- `extrude.test.ts`、`extrude-wall-role-gotcha.test.ts`、`extrude-roles.test.ts`：双向、反向、角色表。
- `mesh-solid-extrude.test.ts:251`：**明确测试 mesh 链拒绝 `upTo`**（`MeshUnsupportedError`，`api/extrude.ts:524-537`）——与「仅 BREP 链受支持」的策略一致。

---

## 3. faijs 现状：钻孔 / 切除

### 3.1 钻孔 op

| op | 定义 | 类别 | 深度/终止参数 |
|---|---|---|---|
| `fai_drill` | `extra/ops/fai_drill.ts:658` | dual-op（mesh+brep） | `depth>0` 盲孔；`depth=0` 通孔；`thread` 带 `THRU/THROUGH` 后缀亦为通孔（`:628-629`） |
| `fai_drill_tapper` | `extra/ops/fai_drill_tapper.ts:171` | brep-only | 由 `drill` / `tap` 描述串推导深度 |
| `cad.drill` | `api/generated/operations.ts:133`（实现 `api/brep-operations/compoundFns.ts:139-199`） | brep-only | `options.depth` 省略即通孔（bbox 投影 + overshoot） |
| `cad.punchHole` | `api/punch-hole.ts:263` | brep-only（occt） | `height?`；`null`/缺省即通孔（bbox + margin） |

`fai_drill` 参数表（`fai_drill.ts:626-643`）：`diameter`、`thread`、`depth`、`holeType:'simple'|'screw'|'tapped'`、`direction:'normal'|'x'|'y'|'z'`、`position`、`face: FaceTopoRef`、`faceNormal`、`tolerance` 及一整套螺纹规格参数。**没有 `upTo` / `toFace` / `until`。**

BREP 路径：`computeDrillGeometry`（`brep/brep-ops.ts:415`）用 bbox slab 求交算通孔（`:445`）、盲孔深度钳制（`:479`）；`drillBrep`（`:525`）/`drillBrepWithRoleTable`（`brep/face-evolution.ts:769`）做 `kernel.cut`。

### 3.2 切除 op

- `cad.cut = cad.subtract`（`api/boolean.ts:531`，dual-op 别名）；`cad.boolean(..., 'cut')`（`api/boolean-op/index.ts:218`，brep-only occt）。
- `cad.punchHole`（`api/punch-hole.ts`）是唯一「按面 + 轮廓」切除：`{ contours, on, face: FaceSelector, height?, draftAngle? }`，`face` 支持 `FaceTopoRef` / `'>Z'` 字符串 / 序号。
- 通用布尔 `union/subtract/intersect`（`api/boolean.ts:449/471/492`）均 dual-op。

### 3.3 面定位能力（有，但不是链式的）

- `api/cadquery-selectors/face.ts:107` `resolveFaceSelector(shape, sel, ...)`：支持 `>Z/<X`、索引后缀 `>Z[-2]`、命名视图 `top/bottom/front/back/left/right`、复合轴 `+XY/>XZ/-YZ`。
- `api/face-by-selector.ts:68` `faceBySelector(of, selector)`：脚本面导出，支持 `>Z/<X` 与命名视图（**不支持**索引与复合轴）。
- 被 op 消费：`punchHole.face`、`extrude upTo: '>Z'`、`sketchOnFace` 等。
- **无 Workplane 类、无 `.faces(...)` 链式选择器**（源码中 `Workplane` 仅出现在注释里，指向已移除的 `faijs-cadquery`）。

### 3.4 测试覆盖

`packages/core/test/extra/ops/fai-drill-*.test.ts` 系列覆盖：tolerance 语义、螺纹建模/底孔反算、管螺纹、tapped/screw 差异、描述串解析、通孔与盲孔几何、PMI、方向定号等。**没有任何钻孔/切除「to-face / until」测试**——因为无此 API。

---

## 4. 逐项差距与影响

| # | 差距 | CadQuery | faijs 当前 | 影响 |
|---|---|---|---|---|
| 1 | **钻孔/切除到面** | `cutBlind(until)` / `cutThruAll` / `extrude(combine='cut')` | 钻/切只有数值深度或「通孔」，无任何面终止参数 | 需要「孔底贴到某斜面/另一实体表面」的模型无法直接表达，只能手算深度 |
| 2 | **`until='next'` 语义** | 拉伸/切割到沿路径遇到的下一个面 | 只有 `'last'/'first'`（bbox 近远端近似）与显式面/平面 | 多级台阶、壁厚相关的「到下一个面」无对应；`'first'/'last'` 对非轴对齐体是近似 |
| 3 | **Workplane 链式** | `.faces('>Z').workplane().rect().extrude(...)` | 离散函数调用 + Shape 传递；选择器是独立字符串 | 需要 UI/脚本手动管理「面 → 工作平面 → 轮廓 → 操作」的中间态 |
| 4 | **`combine='cut'`** | 拉伸即切除，一步 | 需 `extrude` 后 `cut`/`subtract` 两步 | 脚本更长，且两步之间多一个中间实体 |
| 5 | **`taper` / 双向到面** | 拉伸可带锥度；`both=True` 双向 | `extrude` 无 taper；双向仅数值 `backwardLength`，与 `upTo` 互斥 | 无法「双向各拉到一个面」；拔模只在 `punchHole.draftAngle` 有 |
| 6 | **到的目标若是曲面** | until 到面按面中心投影（同样近似） | `upTo` 用 center+normal 平面截断 | 两者都非精确贴合曲面；faijs 对大曲率斜面误差更明显 |
| 7 | **网格链** | 不区分 | `upTo` 在 mesh 链抛 `MeshUnsupportedError` | 到面语义仅 BREP 链可用（符合当前受支持范围） |

### 值得肯定的既有基础

- `extrude.upTo` 的**目标类型比 CadQuery 更宽**：CadQuery `until` 只认数值与 `next/last`，faijs 认任意 `FaceTopoRef`（UI 拾取的具体面）、选择器字符串、显式基准平面。
- 面选择器子系统（`cadquery-selectors`）已实现 CadQuery 字符串语法（含索引、命名视图、复合轴），是补齐「到面」语义的地基。
- BREP 链已有「长拉伸 + 半空间截断」的成型实现与回归测试。

### 差距的定性判断（非方案）

- **拉伸到面**：能力已在。

  若要向 CadQuery 对齐，缺口是 `next` 定义与曲面贴合精度，而非从零实现终止条件。

- **钻孔/切除到面**：这是最大且唯一的「从无到有」缺口。

  内核侧已有可复用的几何机制（bbox 投影求通孔、半空间盒截断），但 API 层没有暴露，也没有任何测试。

- **链式工作流**：属于架构取向差异（faijs 明确无 Workplane 类），不是参数补齐能解决的——需要单独评估是否引入链式上下文抽象。

---

## 5. 证据索引

| 主题 | 文件 | 关键行 |
|---|---|---|
| `ExtrudeUpTo` / `ExtrudeOptions` | `packages/core/src/api/extrude.ts` | 180-210 |
| 调用形态归一化 / 互斥校验 | `packages/core/src/api/extrude.ts` | 228-276 |
| 到面求解（四类目标 + 截断） | `packages/core/src/api/extrude.ts` | 325-492 |
| extrude op 声明 / mesh 拒绝 upTo | `packages/core/src/api/extrude.ts` | 591-683 / 524-537 |
| 编辑器 `fai_extrude` | `packages/core/src/extra/ops/fai_extrude.ts` | 53-90 |
| `fai_drill` 参数与声明 | `packages/core/src/extra/ops/fai_drill.ts` | 609-658 |
| 钻孔几何 / BREP 主路径 | `packages/core/src/brep/brep-ops.ts` | 367-525 |
| `cad.drill` / `pocket` / `boss` | `packages/core/src/api/brep-operations/compoundFns.ts` | 139-199 / 211 / 258 |
| `cad.punchHole` | `packages/core/src/api/punch-hole.ts` | 41-54 / 263 |
| `cad.cut = subtract` | `packages/core/src/api/boolean.ts` | 531 |
| 面选择器解析 | `packages/core/src/api/cadquery-selectors/face.ts` | 107 |
| `faceBySelector` | `packages/core/src/api/face-by-selector.ts` | 68 |
| 到面测试 | `packages/core/test/api/extrude-upto.test.ts` | 全篇 |
| mesh 拒绝 upTo 测试 | `packages/core/test/api/mesh-solid-extrude.test.ts` | 251 |
| 钻孔测试族 | `packages/core/test/extra/ops/fai-drill-*.test.ts` | 全篇 |

CadQuery 参照：`Workplane.extrude / cutBlind / cutThruAll / hole / cboreHole / cskHole` 官方 API reference 与 CadQuery Class Summary（`cadquery.readthedocs.io`）。
