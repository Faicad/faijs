# 形状编程 API 扩展：wire 多环 / wireFromEdges / faceFromWire / shell-sew 语义澄清

- 状态：方案（待评审）
- 日期：2026-11-14
- 范围：`packages/core`（faijs 引擎），脚本面 `cad.*` op 四项扩展
- 不在本计划内：fcstd-port 侧 face tier（no-solid 落地）、bspline 段模型、`makeShell` 显式构造器

## 0. 用户原话（需求来源）

> 「你分析一下，目前的faijs对shell和wire的支持有哪些，是否完全没有。对face的支持又有哪些？ 要实现合理的编程api，应该做哪些扩展」

> 「把合理的api扩展建议写出一份开发计划文档，先评审和开发这部分。」

背景：fcstd-port P2-R2 侦察发现 no-solid 桶（370 个 Part::Feature 冻结形状）中存在
face / wire / shell 三类非实体形状需要重建出口（People symbols 平面单面、SVG path
wire、STL 导入开放壳）。侦察结论（详见 fcstd-port 侧 `p2r2-nosolid-census`）：

| 类别 | 数量 | 现有出口 |
|---|---|---|
| face（face / compound-of-faces） | 345 | `cad.sketchOnPlane` 已覆盖平面单面/含孔面/多面 compound，**零扩展可落地** |
| wire | 2 | `sketchOnPlane({as:'wire'})` 只回**第一个**链，多环静默丢弃；无"边列表→wire" op |
| shell | 23 | `cad.sew`（面集→壳）是唯一构造口；`cad.shell` 是抽壳（产薄壁实体），命名易混 |

## 1. 现状结论（事实依据，逐条可查）

### 1.1 wire

构造入口：

- `cad.wire(points, {closed, smooth})`（`api/wire.ts`）：**只吃点列**——折线
  （makeLineEdge × N + makeWire）或平滑样条（interpolatePoints）；弧段/段模型进不来。
- `cad.sketchOnPlane({as:'wire'})`（`api/sketch-on-plane.ts:98-104`）：从 2D 段模型
  （line/arc/spline）取 wire，但**多链只回第一条**——`sketch-on-plane.ts:51-53`
  文档明载 "With MULTIPLE disjoint chains only the FIRST one is returned"，是有据的
  静默丢数据。
- 边构造族 `cad.edge / circleArc / ellipseEdge / ellipseArc / tangentArc`：产单边
  （1D curve Shape）；**没有把边列表组装成 wire 的脚本 op**——L1 契约有
  `makeWire`（`brep/engine/primitives.ts:340`，occt + brepkit 双引擎 dialect），
  只是没暴露到脚本面。
- `cad.helix`、`cad.approximatePoints / interpolateWithTangents`。

消费面：sweep / loft / pipe 等 11 个动作接受 wire 输入（`api/wire.ts` 头注）；
谓词 `isWire`、查询 `getLength / iterShapes` 齐全。

**兼容性事实**：faijs-freecad 侧唯一的 `as:'wire'` 消费（`codegen.ts:562-590`）
是**每条开链单独一次调用**（单链契约），不受多环语义变化影响。

### 1.2 face

- 构造：`cad.sketchOnPlane`（默认 face，含孔 addHolesInFace，多轮廓→面 compound）、
  `sketchOnFace / sketchOnSurface / faceOnSurface / nonPlanarFace / punchHole /
  removeHolesFromFace`。
- 查询：`faceNormal / outerWire / uvBounds / faceRef / faceBySelector /
  projectPointOnFace / classifyPointOnFace`。
- 下游：`extrude / revolve`（面→实体）、`thicken`、`sew / sewAndSolidify /
  solidFromFaces`（面→壳/实体）。
- face 可作最终产物独立存在（不 extrude 即是面）。
- **结论：sketch 蓝图→face 的路径零扩展**（sketchOnPlane 全覆盖）；唯一缺口在组装链
  wire→平面 face 的脚本面格——库层 `face(w, holes?)` 已实现但未注册脚本面（E2b 暴露）。

### 1.3 shell

- **`cad.shell` 不是壳构造器**：是抽壳（solid 按面移除、等厚薄壁，产实体，
  `api/shell.ts:1-2`）。
- 唯一壳构造口：`cad.sew(shapes, {tolerance})`（中立 op，面/壳缝合→壳，不保证闭合，
  `api/feature-repair.ts:181-193`）；`cad.makeSolid`（闭合壳→实体，平台 op）。
- occt-wasm 内核无 `makeShell`（sew 是唯一成壳路径）。
- 谓词 `isShell` 有。
- **结论：能力面够用（sew 成壳、makeSolid 升实体），缺口在文档语义不澄清，
  `cad.shell` 命名与"构造壳"的直觉冲突是现成踩坑点。**

## 2. 扩展设计

### 2.0 组装矩阵全景（评审细化 2026-11-14）

"部件列表→容器"一族（对称性依据；每格已对照 L1 契约 + engine-method-map 实测）：

| 组装 | L1 内核（双引擎?） | 脚本面现状 | 本计划动作 |
|---|---|---|---|
| edges→wire | `makeWire`（occt+brepkit dialect） | ❌ 缺（**库层已有** `wireLoop(edges)`——brep-topology.ts:283，仅闭链语义、未注册进 api-namespace/符号表，脚本面不可见） | **E2 补** |
| wire→face（平面） | `makeFace`（occt+brepkit dialect；brepkit 侧 `makeFaceFromWire`） | ❌ 缺（**库层已有** `face(w, holes?)`——brep-topology.ts:341，EMPTY_MESH 收养无显示网格、同样未注册脚本面） | **E2b 补** |
| faces→shell | `sew`（双引擎） | ✅ `cad.sew` | 不加 `shellFromFaces`（见下） |
| faces→solid | `buildSolidFromFaces` / `sewAndSolidify` | ✅ `solidFromFaces`（occt）+ `sewAndSolidify`（中立） | 无 |
| shell→solid | `makeSolid` | ✅ `cad.makeSolid`（occt） | 无 |

**为什么没有 `cad.shellFromFaces`**：

1. `cad.sew` 实质上就是 shellFromFaces（面集→壳，中立 op），再加名违反"一个事实一个家"。
2. occt-wasm 内核**无 `makeShell`**——不存在"严格收集成壳（不缝合合并）"的原语；`sew`
   是带容差的**缝合**（可能合并共面），起名 `shellFromFaces` 会承诺 sew 不保证的严格
   语义。`cut=subtract` / `fuse=union` 别名先例是 brepjs 兼容需要，不构成新别名理由。
3. 处置：E3 文档明确"`sew` = 壳构造正门（shellFromFaces 的实质）"。

**运行时处理差异（wire vs face/shell，逐条核实）**——决定新 op 的实现口径：

| 维度 | wire（1D） | face / shell |
|---|---|---|
| 注册 | `fromBrepCurve`，kind:'curve'，显示走 `solidToShape` wireframe 网格（线显示，非面片；sketch-on-plane.ts:104 先例） | `fromBrep(solidToShape(...))`，tessellate + BREP slot（开放壳可 tessellate） |
| 句柄借用 | `brepOf` 可借（`profile-wire.ts:9`） | 同一套 `brepOf` / `borrowHandles` |
| 消费预检 | 被**面 op 拒收**：`isCurveShape`（`shape.ts:422`）执行前预检；sweep/loft/pipe 接受 wire 作 spine | `extrude`/`revolve`/`thicken` 接受 face；`sew`/`makeSolid` 接受 shell |
| naming/roleTable | **不参与**——`unmodeled`（`wire.ts:13`"无面 → 无 roleTable"）；faceRef 不可引用 | 分 op：`sew` 产壳 = `kernel`（byAdjacency，面 lineage 可用）；`faceOnSurface`/`nonPlanarFace`/`makeSolid` = `unmodeled`；`sketchOnPlane` = `construct` |
| keep/replica 词汇（L3/L4） | 无（solid 域 pattern/split 专属） | 仅 solid 的面参与 |

由此确定的实现口径：E2 产物走 `fromBrepCurve` + `unmodeled`（与 `cad.wire` 同口径）；
E1 多链 = 逐链 `assembleWire` 后 wire 句柄 `makeCompound`，整体按 curve 收养（单链路径与现状逐字节一致）；**E2b 产物必须走 `fromBrep(solidToShape(...))` 有网格收养——库层 `face()` 的 `wrapSolid`（EMPTY_MESH）无显示网格，脚本面最终产物会空白，不可复用**（同 `nonPlanarFace` 的 `unmodeled` naming 先例）。

### 2.1 统一契约：三类形状一视同仁（用户裁定 + 验收案例）

> 「这三类应该统一呀。我完全可以画一个线，比如矩形，然后UI上就应该显示这个矩形呀。
> 然后我拉伸消费这个矩形，这个矩形就应该消失啊，显示长方体呀。把这个案例写进去。」

**契约（三类一致，2026-11-14 用户裁定）**：wire / face / shell 在脚本面享有同一套
显示与消费语义——① 可显示：任何产物都带显示几何，UI 直接可画（wire = 线框网格，
face/shell = tessellation）；② 可消费：产物可喂下游 op；③ 消费即消失：被下游语句
消费的源形状从显示中消失，由消费产物取代；显式保留用 `keep()`。

**机制事实（逐条核实，判定全部是名字/结构级，与形状种类无关）**：

- 显示候选：`isShapeLike` 结构判定（`'positions' in v && 'indices' in v`，
  `cad-runtime/runtime.ts:365`）——wire 的 wireframe 网格同样命中；
- 终端/消失：`computeLiveShapes`（`cad-runtime/live-shapes.ts:183`）——被消费
  （R5 默认消费，:117）的变量不再是 terminal，UI 不显示；
- 消费规则：R-A/R-B/R-C（`cad-runtime/consume-rule.ts`）——消费点、禁止再引用
  （`E_USE_AFTER_CONSUME`）、消费即释放，全部按语句结构与变量名判定；
- `keep()`：R1 豁免（唯一显式保留路径）。

**验收案例（golden case，固化为测试）**——矩形 → 成面 → 拉伸：

```js
const rect = cad.wire([[0,0,0],[10,0,0],[10,6,0],[0,6,0]], { closed: true })
// UI 显示矩形线框（wireframe 网格）

const face = cad.faceFromWire(rect)
// rect 被 R5 消费 → 矩形线框消失；UI 显示矩形面

const box = cad.extrude(face, 5)
// face 被消费 → 矩形面消失；UI 显示长方体
```

链上缺口正是 E2b：没有 `faceFromWire`，矩形 wire 进不了 `extrude`（1D 预检拒收是
既定契约，`shape.ts:422`——面 op 拒收 1D 产物，预检失败而非内核深错）。
UI"拉伸一个矩形"的手势在脚本面映射为 `faceFromWire` + `extrude` 两步（自动桥接
属 UI 层职责，不在本计划）。

**验收断言**（测试随 E2b 落地）：三步各自执行后 terminals 分别为
`{rect}` → `{face}` → `{box}`（`computeLiveShapes` 输出），每步类型断言
`isWire / isFace / getShapeType === 'solid'`；`rect.keep()` 变体：终端恒含 `rect`。

### E1 `sketchOnPlane({as:'wire'})` 保留全部链（多环不再丢）

**语义变更**（行为修复，非新增参数）：

- 单链（开或闭）：返回该链 wire——**与现状完全一致**（weapp sweep-spine 路径不变）。
- 多链：逐链 `assembleWire`，返回 **wires 的 compound**（单 wire 与多 wire 用
  `getShapeType` 可区分；与 `as:'face'` 多轮廓→面 compound 的既有口径对齐）。
- `organiseBlueprints` 的孔/岛分类在 wire 模式下无意义（wire 不成面），直接按
  蓝图顺序逐链组装，不区分 outer/inner。

**兼容性**：

- faijs-freecad `codegen.ts` 单链调用不受影响（实测确认，见 1.1）。
- 依赖"多链只回第一条"的调用方属于依赖静默丢数据，不在兼容承诺内；变更在
  `docs/ops-api-inventory.md` 双语对齐更新。

**实现点**：`buildShapeFromBlueprints`（`sketch-on-plane.ts:90-127`）的
`as === 'wire'` 分支重写；`cad.profile` / `cad.sketch` 的 `as:'wire'` 走同一
placement core（`sketch/faces.ts:140`、`profile.ts`），同步受益，行为统一。

### E2 新增 `cad.wireFromEdges(edges)`（边列表→wire，补组装缺口）

**定位**：中立 op——L1 `makeWire` 两引擎同实现（dialect，engine-method-map 实测），
与 `cad.solidFromFaces`（面集→实体）构成对称词汇：**部件列表→容器**。
**库层先例**：`wireLoop(edges)`（`api/brep-topology.ts:283`）已实现 edges→**闭** wire
（`WIRE_BUILD_FAILED` / `WIRE_NOT_CLOSED`，`curveIsClosed` 校验），但闭链语义 + 未注册
脚本面——E2 在 op 层重写（开链默认 + 脚本面登记），不强行复用。

- 签名：`wireFromEdges(edges: Shape[], opts?: { closed?: boolean })`
  - `edges`：1D 边 Shape（`cad.edge / circleArc / ellipseEdge / tangentArc` 等产物，
    `brepOf` 借句柄）；至少 2 条。
  - `closed`：默认 `false`（开链合法——与 `cad.wire` 默认口径一致）；`true` 时加
    `curveIsClosed` 校验（= 库层 `wireLoop` 语义），不闭合抛
    `E_WIRE_FROM_EDGES_NOT_CLOSED`。
- 语义：**顺序敏感**组装（按入参顺序 makeWire，不做端点排序——排序责任在调用方，
    与 `cad.wire` 点列的"有序点列"口径一致）；内核 makeWire 自行校验连接性，
    失败抛内核错误（静态规则：BREP 路径异常=设计缺陷直接暴露，不兜底）。
- 产物：wire（1D curve Shape，收养口径同 E1 单链——`fromBrepCurve(solidToShape(...))`）；
  `naming: { kind: 'unmodeled' }`（同 wire op 先例）。
- 错误码：`E_WIRE_FROM_EDGES_TOO_FEW`（<2）、`E_WIRE_FROM_EDGES_NO_BREP`
  （入参无 BREP 句柄）、`E_WIRE_FROM_EDGES_NOT_CLOSED`（closed 校验失败）——
  沿用 `solidFromFaces` 的 `E_SOLID_FROM_FACES_*` 命名族。

**登记面**（新增导出 API 的完整清单，缺一 CI 红）：

1. `api/wire-from-edges.ts` 新文件（对齐 `solid-from-faces.ts` 结构）。
2. `api/api-namespace.ts` 字面量**显式列出**（禁 spread，gen-symbol-table 只认
   PropertyAssignment）→ `lang/symbol-table.generated.ts` 重生成。
3. `api/surface/arg-spec.ts` 加条目（`scriptFace` 不设——`edges` 入参是 Shape[]，
   `.fai.js` 侧由变量传递，无字面量形态）。
4. `docs/ops-api-inventory.md`（英/中/i18n 三件套）。
5. 测试（API 覆盖门禁 L1/L2）：新文件 `test/wire-from-edges.test.ts`——
   直线+圆弧混合组装、`closed` 参数（true 不闭合报错 / false 开链通过）、
   错误码三条、`isWire` 断言、下游 `sweep` 消费一条。

### E2b 新增 `cad.faceFromWire(wire, holes?)`（平面 wire→face，补组装矩阵）

**定位**：中立 op——L1 `makeFace` 两引擎 dialect（occt `makeFace` / brepkit
`makeFaceFromWire`，engine-method-map.json:452-454）；与 E2 构成完整组装链
edges→wire→face，与 `solidFromFaces` / `sew` 同族（**部件列表→容器**）。
**库层先例**：`face(w, holes?)`（`api/brep-topology.ts:341`）——平面 wire→face +
`addHolesInFace` 孔、`FACE_NOT_PLANAR` 校验（`surfaceType !== 'plane'`）。
但库层实现用 `wrapSolid`（EMPTY_MESH，无显示网格），脚本面收养**不可复用**
（最终产物空白）；E2b 在 op 层用 sketchOnPlane 的有网格口径重写。

- 签名：`faceFromWire(wire: Shape, holes?: Shape[])`
  - `wire`：闭合平面 wire（E1/E2/`outerWire`/`cad.wire` 产物，`brepOf` 借句柄）。
  - `holes`：可选孔 wire 列表（`addHolesInFace`，与库层 `face()` / `sketchOnPlane`
    含孔面同口径）；缺省无孔。
- 语义：平面限定——`surfaceType(face) !== 'plane'` 时抛
  `E_FACE_FROM_WIRE_NOT_PLANAR`（非平面 wire 走 `cad.nonPlanarFace`，occt-only，
  职责分离与库层一致）；不闭合 wire 由内核 makeFace 报错直通。
- 产物：face Shape——`fromBrep(solidToShape(kernel, f), { solid: f })` 有网格收养
  （sketch-on-plane.ts:123 同款，可作最终产物正常显示）；
  `naming: { kind: 'unmodeled' }`（同 `nonPlanarFace` 先例）。
- 错误码：`E_FACE_FROM_WIRE_NO_BREP`（wire 无句柄）、
  `E_FACE_FROM_WIRE_NOT_PLANAR`（非平面）——`E_FACE_FROM_WIRE_*` 命名族。

**登记面**（与 E2 同清单）：

1. `api/face-from-wire.ts` 新文件。
2. `api/api-namespace.ts` 字面量显式列出 → symbol-table 重生成。
3. `api/surface/arg-spec.ts` 加条目（`scriptFace` 不设，同 E2 理由）。
4. `docs/ops-api-inventory.md` 英/中/i18n 三件套。
5. 测试：新文件 `test/face-from-wire.test.ts`——平面闭合 wire→face、含孔、
   非平面错误码、`isFace` 断言、下游 `extrude` 消费一条、
   GOTCHA：与 `nonPlanarFace` 的职责分界（faceFromWire 平面限定、
   nonPlanarFace 非平面），测试固化边界。
6. §2.1 golden case（矩形→成面→拉伸）：terminals 三步断言
   `{rect}` → `{face}` → `{box}` + `keep()` 变体——三类统一契约的验收测试。

### E3 `cad.shell`（抽壳）vs `cad.sew`（成壳）语义澄清

**不新增代码，只做文档 + 防回归测试**：

1. `docs/ops-api-inventory.md` 双语条目更正：
   - `shell`：明确"**抽壳/薄壁**：输入实体，移除选中面并等厚偏置，产物仍是**实体**"；
   - `sew`：明确"**壳构造正门**：面/壳集缝合为壳（可能开放）；配合 `makeSolid`
     （闭合壳→实体）与 `solidFromFaces`（面集一次成型实体）构成壳/实体通道"。
2. GOTCHA 防回归测试（验证留档铁律 §2）：`test/` 中新增断言
   `getShapeType(cad.shell(...)) === 'solid'` 与 `isShell(cad.sew([f...]))`——
   把"直觉命名陷阱"固化为可执行契约。

## 3. 实施顺序与验收

| 步骤 | 内容 | 验收 |
|---|---|---|
| 1 | E1 分支重写 + 测试（单链回归、多链 compound、profile/sketch 同路径） | 单包 vitest 绿 |
| 2 | E2 + E2b 新 op + 各五处登记 + 测试（含 §2.1 golden case） | vitest + `check-api-test-coverage` 绿 |
| 3 | E3 文档双语 + GOTCHA 测试 | `npm run doc-sync` 绿 |
| 4 | 全量验证 | `typecheck` → `lint` → 单包测试 → 受影响面抽查（sweep/loft 消费 wire、extrude 消费 face 的既有测试） |
| 5 | CI | `scripts/ci.ps1`（一次通过为纪律，禁止靠 CI 找 bug） |
| 6 | 版本与分发 | `npm run set-version -- <下一 patch>` → `check-lockstep` → `npm run pack --only @faicad/faijs` → fcstd-port 引擎刷新（file: pin 同步 + 手工 tar 解包，见 fcstd-port AGENTS 红线） |

**回归红线**：fcstd-port 侧 flips4（44/0/6）与 P0-4（parity.json 逐字节相同）零回归
（E2/E2b 是纯增量，唯一行为变更是多链 as:'wire'，faijs-freecad 已确认无多链调用）。

## 4. 非目标（明确不做）

- `makeShell` 显式构造器——内核无对应方法，sew 已覆盖，价值低。
- `cad.shellFromFaces`——`cad.sew` 即其实质（§2.0 裁决），加名违反"一个事实一个家"。
- `cad.polygon` 脚本面暴露——库层已有（`brep-topology.ts:367`），但
  `cad.wire` + E2b `faceFromWire` 可组合出同能力，不重复暴露。
- `cad.wire` 接受段模型（弧/样条段）——E2 的边列表组装已覆盖同一需求，
  且段模型归 `sketchOnPlane` 单一真源。
- bspline 段 / face tier / shell tier 的 fcstd-port 落地——另行立项
  （本计划只打通 faijs 侧 API 缺口，为下游 tier 铺路）。
- `cad.shell` 改名——向后兼容优先，语义冲突由文档澄清解决。
