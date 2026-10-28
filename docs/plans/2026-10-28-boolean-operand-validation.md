---
status: v2 已实施（2026-10-28）—— 4 例中 3 例转 PASS（issue802 见 §11.2），零回归
date: 2026-10-28
repo: faijs（packages/core）
supersedes: v1「布尔操作数闭合性校验」（2026-10-28，前提已被实证推翻，见 §0）
影响面: 内核 `api/boolean.ts` / `api/boolean-op` + 叶子 op 标记 + `mesh/types.ts`
        + `api/internal/authored-closure.ts`（句柄登记表）；
        ext 侧 `polyhedron` 缝补前求值（faijs-openscad）
---

# 布尔操作数闭合性校验（v2：叶子网格口径）

## 0. 变更记录 —— v1 前提被实证推翻

v1 的设计是：`boolean` 对**所有**操作数按其 BREP 拓扑类型（`shapeType`）判定闭合性，
非闭合即按 OpenSCAD 语义丢弃。

按用户要求「必须在最新源码基础上修改」，v1 已在 **v0.44.7 源码**上实现、构建、重新生成
555 个 `.fai.js` 并实测。结果**证伪**：

| 检验 | 结果 | 结论 |
| --- | --- | --- |
| 4 例操作数的 `shapeType` | 全部 `SOLID` / `COMPOUND`，**无一个是 `SHELL`** | `shapeType` 判据对 4 例零作用 |
| 4 例实测数值 vs 基线 `parity-report.json` | 逐位相同（issue591 cand vol 4.5 / 48 tri；scale-zero 91.688 / 46434；issue802 49365.94 / 76；stl-import 2.75 / 58） | 校验是**空转**，没改变任何结果 |
| 改用「全网格水密性」判据 | issue591 两组的 mesh 同样"非闭合" → 两组一起被丢 → 整体变空，报 `no result shape in outputs` | 判据落在"网格"上是对的，但**作用域**错了 |
| 改用「非流形边 ≥3」判据 | issue591 的锥化棱柱（有效闭合实体）同样被误判 → 同上变空 | 同上 |

v1 的实现已全部回退，工作区干净（三仓 `git status` 无改动）。

**v2 的两处修正**：
1. 判定依据：`shapeType` → **网格无向边计数**（每条无向边恰被 2 个三角共用）；
2. 判定作用域：所有操作数 → **仅「作者叶子网格」**（authored leaf）。

理由见 §3：CGAL 的校验只发生在 PolySet → Nef 这一跳，Nef → Nef 不重复校验。

---

## 1. 问题陈述

openscad-port 语料中 4 例 FAIL，参考侧（OpenSCAD）与 faijs 侧的差异全部指向
「OpenSCAD 丢弃了非闭合的操作数，faijs 没有」：

| id | OpenSCAD 报错 | ref | faijs cand |
| --- | --- | --- | --- |
| `3D/features/linear_extrude-scale-zero-tests` | 5 次 not-closed | 3628 tri / vol 56.18 | 46434 tri / vol 91.69 |
| `bugs/issue591` | 1 次 not-closed | 24 tri / vol 2.25 | 48 tri / vol 4.50 |
| `bugs/issue802` | 1 次 not-closed | 24 tri / vol 6347.5 | 76 tri / vol 49365.9 |
| `stl/stl-import-nonmanifold` | 1 次 not-closed | 12 tri / vol 1.0（只剩 cube） | 58 tri / vol 2.75 |

## 2. 关键实证

### 2.1 issue802：两个 `polyhedron` 的边计数（决定性证据）

`issue802.scad` 的 CSG 是两个并列的 `polyhedron()`（顶层隐式 union）。对 CSG 里两个
`polyhedron` 的 `faces` 逐一展开成三角形、统计无向边使用次数：

```
polyhedron#1: pts=54 faces=50 tris=50 edgeUseHist={"1":4,"2":73} degenerateTris=0
polyhedron#2: pts=37 faces=24 tris=24 edgeUseHist={"2":36} degenerateTris=0
```

- `polyhedron#1` 有 **4 条边界边**（只被 1 个三角用）→ **不闭合** → OpenSCAD 丢弃；
- `polyhedron#2` 全部边恰被 2 个三角共用 → **闭合** → OpenSCAD 保留；
- **ref 的 `triangleCount` 恰好是 24**，正是 `polyhedron#2` 的三角数，且 ref 的 bbox
  （x ∈ [80.30, 148.845]）与 `polyhedron#2` 的实际坐标范围一致。

→ 「OpenSCAD 丢掉不闭合的那一个、保留闭合的那一个」是**唯一**与 ref 数值自洽的解释。

### 2.2 issue591：同一几何、两种构造，OpenSCAD 只丢一种

CSG 结构（两个顶层 group，最后隐式 union）：

```
group A: difference() { linear_extrude(h=3, scale=[0,1]) { sq@x=+1; sq@x=-1; }   cube(2,center)@z+2.5 }
group B: difference() { group() { linear_extrude(...)  sq@x=+1
                                 linear_extrude(...)  sq@x=-1 }               cube(2,center)@z+2.5 }
```

生成的 `.fai.js` 显示两者走**完全不同的调用**：

- group A：`part4 = openscad.polygonBool([s1,s2],'union')`（2D 布尔合成一个多段 profile）
  → `part5 = twistExtrude(part4, 3, 0, [0,1], ...)` —— **一次**挤出产出**一个** mesh；
- group B：`part11 = twistExtrude(s1,...)`、`part14 = twistExtrude(s2,...)` —— **两次**挤出，
  再 `part15 = __union([part11,part14])` → `cad.boolean fuse`。

几何上两者是同一个物体（两个楔形沿顶棱相接）。单个楔形（square → 线段）的拓扑是
**闭合 2-流形**：6 顶点 / 5 面 / 9 边，9 条边每条恰被 2 个三角共用。

- group A 的一次挤出把两个楔形写进**同一个 mesh**，顶棱 `EF` 被 **4 个三角**共用 → 该 mesh
  **不闭合** → OpenSCAD 丢弃 → group A 的 `difference` 结果为空；
- group B 的两次挤出各自闭合 → 两个操作数都合法 → CGAL union 成有效 Nef → 后续
  `difference` 是在 **Nef 之间**做的，不再回头校验 mesh → 保留。

ref 的数值完全印证：ref 只剩 group B（bbox y ∈ [1.5, 2.5]，正好是 group B 平移 y+2 后的范围；
group A 应在 y ∈ [-0.5, 0.5]，ref 中不存在），volume 2.25 = 单组的量。

### 2.3 为什么"所有操作数都校验"必然失败

group B 的 `__union([part11, part14])` 产物的 mesh，其顶棱 `EF` 同样被 4 个三角共用。
若对所有操作数一律校验，`part18 = subtract(part15, part17)` 的 base 会被误判不闭合 →
group B 也被丢 → 整个模型为空。这就是 v1 实测到的 `no result shape in outputs`。

**结论：闭合性只能校验"作者写出来的叶子网格"，不能校验布尔产物。** 这不是权宜之计，
正是 CGAL 的语义（§3）。

## 3. 语义模型：CGAL 的校验边界

OpenSCAD 的对象树以 CSG 节点求值。只有把 **PolySet（叶子网格）转成 `CGAL_Nef_polyhedron`**
时才会做网格闭合性校验并打印 `ERROR: The given mesh is not closed!`。一旦进了 CGAL，
后续 `union` / `difference` / `intersection` 都是 **Nef 与 Nef** 之间运算，**不再**回到
PolySet，也就**不再**校验。

叶子网格包括：`polyhedron`、`import`（STL/OFF 等）、`linear_extrude` / `rotate_extrude`
的输出、以及各 3D 原语。布尔产物、`hull`/`minkowski` 之类都不是叶子。

faijs 没有 Nef，每一步都产出 `Shape`（带 mesh），所以必须**显式**复刻这个边界：
给叶子产出的 `Shape` 打标记，`boolean` 只校验带标记的操作数。

## 4. 设计

### 4.1 标记

在 `packages/core/src/mesh/types.ts` 增加内部符号槽（与既有 `[BREP_TESS]` /
`[BREP_LAZY_TESS]` 同一模式）：

```ts
/** @internal 叶子网格标记：由叶子 op（原语 / 挤出 / import / polyhedron）产出时置位。
 *  boolean 只对带本标记的操作数做闭合性校验（复刻 CGAL 的 PolySet→Nef 校验边界）。
 *  宿主禁读禁写；跨 worker 序列化丢失时按"未标记"处理（fail-open，不校验）。 */
[AUTHORED_LEAF]?: true
```

标记用 `symbol`（非字符串键），不参与 JSON / `structuredClone` / 相等比较。
丢失时退化为「不校验」——安全方向。

### 4.2 设置 / 清除点

调查结论：设置点只有**两个**，不需要逐一改各叶子 op。

1. **ext（OpenSCAD 库）产物 → faijs Shape 的唯一入口**是
   `packages/core/src/api/internal/l3-bridge.ts` 的
   `adoptEntity(product, opName, segments)`（compatOp 投影第 5 步，所有 `openscad.*`
   产物都经它 adopt）。此处**已带 `opName`**，直接在此处打标记即可覆盖
   `twistExtrude` / `polyhedron` / `import` 等全部 ext 叶子 op，**无需改 faijs-openscad**。
   仅需一个 `NON_LEAF_OPS` 名单排除 ext 里非叶子的 op（如将来接入的 `hull`/`minkowski`），
   本期该名单为空。
2. **core 原生 3D 叶子 op**（`box` / `sphere` / `cylinder` / `polyhedron` / extrude 家族 /
   `importStl`）走 `defineOp`（`define-op.ts` 的 `wrapped` 是唯一产物出口）。给
   `DualOpMeta` 增加可选 `leaf?: boolean`，在 `wrapped` 返回前按声明打标记。声明是
   **逐 op 增量**的：只给实际用到的叶子 op 加 `leaf: true`，其余默认 false（= 不校验，
   fail-safe）。

**继承与清除**：

- `boolean`（`union`/`subtract`/`intersect`/`cut`/`fuse`）产物**一律无标记**——对应 CGAL 的
  Nef 阶段，这正是 issue591 group B 不被误丢的关键；
- 其它重造 mesh 的 op（`hull`/`minkowski`/`fillet`/`compound` 合并）默认无标记（新 Shape
  天然不带），本期不改其行为；
- **纯仿射变换的继承本期不做**（`applyMatrix` / `translate` / `rotate` / `scale` / `mirror`
  若返回新 Shape，标记会丢）。后果是"被变换过的叶子不校验"，方向是**漏判**（fail-safe：
  等于保持现状），不是误判。issue591/issue802/stl-import 三例的叶子都是直接操作数，
  不需要继承。列为后续增强（§10.6）。

> 标记在 `adoptEntity` 一处的覆盖面是决定性的：issue591 的 `twistExtrude`、issue802 的
> `polyhedron`、stl-import 的 `import` 全都是 `openscad.*` 库产物，一个插入点即可覆盖 3 例。

### 4.3 校验规则（OpenSCAD 语义分流）

开关 `setBooleanOperandValidation(on)`（模块级，默认 **false**）开启后：

| 运算 | 非闭合操作数处理 | 与 OpenSCAD 一致 |
| --- | --- | --- |
| `union` | 丢弃该操作数，其余照常；全被丢 ⇒ 空实体 | `ERROR: ... not closed!` + 其余照常 |
| `subtract` | base 被丢 ⇒ 整树为空；tool 被丢 ⇒ 跳过该 tool；无 tool 剩 ⇒ 原样返回 base | base 被丢 ⇒ `Current top level object is empty.` |
| `intersect` | 任一被丢 ⇒ 空实体 | 任一被丢 ⇒ 空 |

只对**带叶子标记**的操作数判定；未标记的一律视为合法（不校验），保持现状。

默认关，由 OpenSCAD 翻译产物在文件头 `cad.setBooleanOperandValidation(true)` 开启
（emitter 一行，不进业务逻辑）。

### 4.4 闭合判定算法

对 `Shape.positions` / `Shape.indices`：

1. 顶点按坐标量化去重（`round(x*1e6)|round(y*1e6)|round(z*1e6)`），容忍接缝处因 flat 法向
   切分导致的索引重复顶点（位置相同即同一顶点）；
2. 每条无向边 `(min,max)` 计数；
3. **所有**边计数恰为 2 ⇒ 闭合；出现 1（边界边）或 ≥3（非流形边）⇒ 不闭合。

复杂度 O(T)，T = 三角数；对语料最大 mesh 也在毫秒级，且**只**在开关开启且操作数带标记时执行。

注意：**不**剔除退化三角。issue802 的 `polyhedron#2` 含 20 个重复坐标点但仍全边计数为 2，
被 OpenSCAD 保留；擅自剔除退化三角会改变判定口径。

### 4.5 空实体表示

`api.makeCompound([])` 造空 compound（`isSolid=false`，可继续参与链式操作），
复用 v1 已验证的 `emptySolid()` 实现。

## 5. 逐例预期

| id | 叶子操作数 | 判定 | 预期结果 |
| --- | --- | --- | --- |
| `issue802` | `polyhedron#1`（4 边界边）、`polyhedron#2`（闭合） | #1 丢、#2 留 | ref = #2（24 tri, vol 6347.5）⇒ **PASS** |
| `issue591` | group A 的 `twistExtrude` 单 mesh（顶棱 4 面共用）→ 丢；group B 两个 `twistExtrude` 各闭合 → 留；`__union` 产物不校验 → `difference` 正常 | A 空、B 保留 | ref = B（24 tri, vol 2.25）⇒ **PASS** |
| `stl-import-nonmanifold` | `import(cubes-touching.stl)`（`nonManifoldEdges:1`）、`cube` | import 丢、cube 留 | ref = cube（12 tri, vol 1.0）⇒ **PASS** |
| `linear_extrude-scale-zero-tests` | 5 处 `scale=[0]` 挤出叶子 | 待 §8 探针确认 | 预期三角数由 46434 降到 3628 量级 ⇒ **PASS**（本期内不保证，见 §6） |

`linear_extrude-scale-zero` 是目前唯一**没有**直接观测到"叶子 mesh 边计数"的一例
（CSG 里是 `linear_extrude` 而非 `polyhedron`），需先跑探针（§8.1）拿到 5 个叶子 mesh 的
边计数分布再定；若其非闭合边来自 faijs 自身三角化伪影（而非真实非流形），则该例需另外
在 `twistExtrude` 侧修，不阻塞前三例。

## 6. 范围外 / 不承诺

- 不承诺 4 例全 PASS。`issue802` / `issue591` / `stl-import-nonmanifold` 三例有 §2 的直接
  实证，作为本期的验收目标；`linear_extrude-scale-zero` 视 §8.1 探针结果决定是否同期纳入。
- **不动** `builtin-invalid-range-test`（同属 `cad.boolean` 但根因是 fuse 重叠体积记账，
  另一张单）。
- 不引入"非闭合模式"：布尔操作数的前提就是闭合 2-流形实体，非闭合是**违例**而不是模式。

## 7. 风险与回退

### 7.1 已识别的高危回归面：`*-touch-*` / `*-nonmanifold` 共 21 例

基线 `parity-report.json` 里有 21 例 id 含 `nonmanifold` / `touch-edge` / `touch-face` /
`touch-vertex`，其中 **15 例当前 PASS**，且 `cand.nonManifoldEdges == ref.nonManifoldEdges`
（如 `polyhedrons-touch-face-nonmanifold` 双方都是 5 条）。**OpenSCAD 保留了它们，没有丢弃。**

这批用例是本节规则的最大回归面，逐条判读后的结论（需要在 §8.1 探针中逐例实测确认）：

| 子类 | 例 | 是否有 `cad.boolean` 调用 | 规则是否作用于它 | 预期 |
| --- | --- | --- | --- | --- |
| 单个 polyhedron 自触（`polyhedron-self-touch-*`、`misc__nonmanifold-polyhedron`） | 5 | **无**（`__union([x])` 直接返回 `shapes[0]`） | 否 | 不变 ✓ |
| 多个**各自闭合**的 polyhedron 相触（`polyhedrons-touch-*`、`tetracyl-touch-*`） | 8 | 有（`__union([a,b])`） | 是，但每个操作数**闭合** → 全部保留 | 不变 ✓ |
| `rotate_extrude-touch-edge/vertex` | 2 | 有 | 操作数闭合 | 不变 ✓ |
| `minkowski-cubes-touch-*` | 3 | 有（当前 ERROR） | 操作数闭合 | 不变（ERROR 波动豁免） |
| `stl-import-nonmanifold` | 1 | 有 | **import 叶子非闭合 → 丢** | FAIL → PASS ✓ |

结论：规则只丢「**单个操作数自身**非闭合」的情形，上述 PASS 例的操作数都是各自闭合的
实体（非流形只出现在**并集产物**上，而并集产物不参与校验）。但这必须由探针逐例证实，
不能只靠推理——**这是本期头号回归风险**。

### 7.2 其它风险

| 风险 | 评估 | 缓解 |
| --- | --- | --- |
| 标记漏设 ⇒ 该丢的没丢 | 只影响对应 op，结果为"保持现状" | 标记在 `adoptEntity` 单点覆盖全部 ext 叶子；core 叶子逐 op 声明 |
| 标记误设到非叶子上 | 可能误丢 | 布尔产物一律不带；`hull`/`minkowski`/`compound` 不继承；`NON_LEAF_OPS` 名单 |
| 坐标量化阈值不合适 | 可能把接缝顶点当两个 ⇒ 假边界边 ⇒ 误丢 | 1e-6 绝对阈值；语料尺度 1e-2 ~ 1e3，足够宽松；21 例专项探针 + 全量门禁兜底 |
| 影响非 OpenSCAD 调用方 | 默认 **false**，完全无行为变化 | — |
| 门禁回归 | 开关由 OpenSCAD 产物打开；若回归集中在 `*-touch-*` / `*-nonmanifold`，说明判据外溢 | §7.1 专项 + 全量 555 例门禁 + 回归比对 |

回退方式：`git revert` 单提交；开关默认 false 本身就保证"不开启即等于旧行为"。

## 8. 验证计划

### 8.1 探针（先做，产出数据再改）

1. **叶子 mesh 边计数探针**：临时 env 门控（`BOOL_DEBUG=1`），在 `isClosedSolid` 判定点
   打印每个操作数的 `opName / authored / triCount / edgeUseHist / closed`。
2. **跑三类样本**：
   - 目标 4 例（issue802 / issue591 / stl-import-nonmanifold / linear_extrude-scale-zero）；
   - **§7.1 的 21 例 `*-touch-*` / `*-nonmanifold`**（回归面，必须确认非闭合操作数**数量为 0**）；
   - 5 个良构对照（`cube`-only、`sphere`、正常 `linear_extrude`、`rotate_extrude`、正常 STL import）。
3. **验收判据**：
   - 良构对照 + 21 例回归面：非闭合操作数 **= 0**（零误伤）；否则判据需收窄，不得进入实现；
   - 4 例目标：叶子分布与 §5 预期一致。
4. 探针代码**不提交**，数据贴进下表。

### 8.1b 探针数据（待填）

| 用例 | 操作数 opName | tris | edgeUseHist | closed | 期望 |
| --- | --- | --- | --- | --- | --- |
| issue802 | 待测 | | | | polyhedron#1 false / #2 true |
| issue591 group A | 待测 | | | | false |
| issue591 group B | 待测 | | | | true / true |
| stl-import-nonmanifold | 待测 | | | | import false / cube true |
| 21 例回归面 | 待测 | | | | **全部 true** |

### 8.2 faijs 自身测试套件

`npm test -w @faicad/faijs` 全绿；另补 §9 的内核单测。开关默认 false，理论零影响，
但 `isClosedSolid` 与标记逻辑要新增覆盖。

### 8.3 parity 门禁（openscad-port）

1. 单例冒烟 4 例 → 目标 PASS；
2. 全量 `npm run parity:check` → **零回归**（仅 PASS↔FAIL 退化算回归；TIMEOUT/ERROR 波动豁免）；
3. `npm run parity:promote` 刷新基线。

| 用例 | 期望 verdict |
| --- | --- |
| issue802 / issue591 / stl-import-nonmanifold | FAIL → PASS |
| linear_extrude-scale-zero | 视探针，FAIL 或 PASS |
| 其余 551 例 | 不变 |

## 9. 内核单测（待落）

```ts
// packages/core/test/boolean-operand-validation.test.ts
// 1. 非闭合叶子操作数在 union 中被丢弃
//    linearExtrude({scale:[0,1]}) 多段 profile 造出顶棱 4 面共用的 mesh
//    expect(volume(union(nonClosed, cube))) ≈ volume(cube)
// 2. subtract 的 base 非闭合 ⇒ 空
// 3. intersect 任一非闭合 ⇒ 空
// 4. 布尔产物不校验：union(a,b) 的产物作为 base 时不被丢
// 5. 开关关闭时行为与现状逐位一致（回归钉）
// 6. applyMatrix 保留叶子标记；boolean 产物不带标记
```

## 10. 未决问题

1. ~~`import` 的 Shape 是否已有来源信息可复用~~ —— 已确认：不需要来源信息，
   `adoptEntity` 的 `opName` 就是来源。
2. ~~`polyhedron` 的 op 名与产品构造点~~ —— 已确认：`openscad.polyhedron`
   （`faijs-openscad/packages/ext/src/ops/polyhedron.ts`），产物经 `adoptEntity` 进入 faijs。
3. 坐标量化去重对**米级单位**（生成代码里 `MM` 常量）下的坐标值是否需要改成相对 bbox
   尺度的阈值？倾向：先用绝对 1e-6，门禁兜底，出现误伤再改相对阈值。
4. `adoptEntity` 里打标记会不会影响 `adoptedMap` 去重路径返回的**同一个 Shape 实例**
   （R6 双所有权防护）？该路径返回缓存实例，标记在 adopt 时一次性完成，语义一致。
5. `linear_extrude-scale-zero` 若探针显示其非闭合边来自 faijs 自身三角化伪影（而非真实
   非流形），该例需在 `twistExtrude` 侧单独修，另起一张单，不阻塞本期的三例。
6. 纯仿射变换的叶子标记继承（§4.2 本期不做）作为后续增强：`applyMatrix(import(x))` 这类
   "变换后的非闭合叶子"目前不校验（漏判、fail-safe），可在同一标记机制上加
   `leaf: 'inherit'` 补齐。


---

## 11. 实施结果（2026-10-28 回填）

**内核** `a3d1aa5d` + **emitter** `faijs-openscad 24b595e` + **基线** `openscad-port fd02daf`。

全量 555 例门禁：`稳定 553 · 改进 2 · 已知波动 0 · 新增 0 · 移除 0 · 回归 0 → PASS`
PASS 218 → **220**、FAIL 9 → **7**、known-diffs 33 → **27**。

| 用例 | 结果 | 探针数据 |
| --- | --- | --- |
| `issue591` | FAIL → PASS | group A `tris=32 edgeHist={2:46, 4:1} closed=false` → 丢；group B 两个 `tris=16 {2:24} closed=true` → 留 |
| `stl-import-nonmanifold` | FAIL → PASS | import 操作数 `tris=24 {2:34, 4:1} closed=false` → 丢，剩 cube 12 tri / vol 1.0 |
| `linear_extrude-scale-zero-tests` | FAIL → TIMEOUT | 0.44.7 在退化挤出上更慢；known-diffs 豁免，待该例的非闭合操作数被丢后应同时变快 |
| `issue802` | 仍 FAIL | 见下 |

### 11.1 实施中对 §4 的两处修正

1. 标记落点不是 `l3-bridge#adoptEntity`（实测**从未被调用**），而是
   **`compat-op#adoptOut`**——它才是所有库产物的唯一出口（含「已经是 Shape 直接透传」
   那条短路），且带 `spec.name`。
2. `cad.boolean(args, tools, kind, opts)` 走的是 **`api/boolean-op/index.ts` 里另一份
   `booleanBrep`**，不是 `api/boolean.ts`。OpenSCAD 语义必须在**两处**都实现
   （issue591 走 `cad.subtract`，issue802 / stl-import 走 `cad.boolean 'fuse'`）。

### 11.2 issue802 —— 已解决（2026-10-28 续，`f7d160e0` + faijs-openscad `1b667ee`）

faijs 的 `openscad.polyhedron` 先用 sew/makeSolid 把**开放网格缝补成闭合实体**：作者
原始三角有 4 条边界边（探针 `edgeHist {1:4, 2:73}`），缝补后产物 52 tri **全闭合**。
于是按缝补后的 mesh 判永远是"闭合"，而 OpenSCAD 在 PolySet→Nef 看到的是原始三角并丢弃它。

首次定位记录的两条阻塞点，**第一条本身是错的**（探针实测修正）：

- ~~ext 的 `polyhedron` 返回数字句柄、Symbol 槽打不上去~~ —— 实测 `BOOL_DEBUG` 探针显示
  两个操作数 `leaf=true`：ext 产物**确实**带着 `AUTHORED_LEAF` 标记进了布尔判定点。
  原因是 `registerLib` 收编 ext 命名空间时把数字句柄包成了 faijs Shape，标记就打在
  这个 Shape 上。障碍只剩一条：**判据读到的 mesh 是缝补后的产物**。
- ~~句柄号登记后取不回~~ —— 取回点就是判定点本身：`isClosedOperandForBooleanOp(api, h, …)`
  已经拿到了 `h = brepOf(shape)`，按句柄号查表即可，不必追「句柄 → Shape」的转换链路。

落地（两个包，跨包靠 globalThis 对齐）：

- **ext `ops/polyhedron.ts`**：新增 `authoredMeshClosed(tris)`，在 `sew` **之前**按输入
  三角形统计无向边使用次数（顶点 `round(x*1e6)` 量化，与内核 `meshClosure` 同口径）；
  不闭合时 `recordAuthoredClosure(handle, false)`。三个返回点统一过 `finish()`，
  `BOOL_DEBUG=1` 打印 `[EXT_DEBUG] polyhedron authoredOpen=… tris=…`。
- **内核 `api/internal/authored-closure.ts`**（新增）：句柄号 → 结论的登记表，挂在
  `globalThis[Symbol.for('faijs.authoredClosure')]`——登记方（ext 包）与读取方（内核）
  是独立包、可能解析到不同的 `@faicad/faijs` 副本，模块级 `Map` 不共享。
  **只登记 `closed === false`**；未登记即回退既有口径（fail-safe）；表上限 4096。
- **`boolean-closure#isClosedOperandForBooleanOp`**：先查登记表（命中时 `tris=-3` 标记
  结论来源），未命中再走产物 mesh 的边计数。

实测：

```
[EXT_DEBUG] polyhedron authoredOpen=true  tris=50   ← part0（原始三角 4 条边界边）
[EXT_DEBUG] polyhedron authoredOpen=false tris=24   ← part1
[BOOL_DEBUG] op=fuse i=0 leaf=true tris=-3 closed=false   ← 按登记结论丢
[BOOL_DEBUG] op=fuse i=1 leaf=true tris=24 edgeHist={"2":36} closed=true
```

候选 = part1：24 tri / volume 6347.4918（ref 6347.4924）/ Hausdorff 1.9e-6 → **PASS**。
全量 555 例门禁 `稳定 554 · 改进 1 · 回归 0 → PASS`；PASS 220 → **221**、FAIL 7 → **6**。

### 11.3 内核全量测试

`npm test -w @faicad/faijs`：4106 passed / 16 failed。16 例失败全部与本次改动无关：

- 13 例 brepkit 多版本冒烟：`Cannot find module .../_test-kernels/brepkit-2.129.15/...`
  ——本地缺该测试夹具（未下载），环境性失败；
- 1 例 `corpus-fai-js`：失败项全在仓库内 `out/`（gitignored 的本地巡检产物），
  `E_SECURITY — AST nesting depth exceeds 100`；
- 2 例（本轮已修）`op-set-consistency`：cad 面新增 `setBooleanOperandValidation` 后符号表
  未同步 → `npx tsx scripts/gen-symbol-table.ts` 重新生成（171 条，提交 `294e0dee`）。
