# cad 脚本面建模能力扩展（2026-09-24）

**状态：方案（未实施）。** 全部现状判断来自 2026-09-24 对当前代码的实测，逐条给出 `file:line`；
未实测的部分明确标注「待探针」，不写成结论。

## 0. 用户要求（原文）

第一轮（本方案既有范围）：

> 「好的，把 ① 明确属于应暴露、但脚本面没有的（真实缺口），③ 有替代但语义不同的（边界情况，
> 可讨论）两类尽量暴露给faijs脚本。请写一份计划方案。」

第二轮（本轮，2026-09-24）：

> 「分析这份设计文档，我的目标是尽可能扩大 faijs 脚本的建模能力，请按照这个目标，分析这份文档，
> 并完善它。」

第二轮把目标从「两类缺口尽量暴露」提高为「**尽可能最大化脚本建模能力**」。因此本方案的做法是：
先做一次**四层全量盘点**（指令集 → 脚本面，§2），识别出**门控项**，再按「门控 → 高价值 → 长尾」
重排实施顺序（§4），而不是按能力条目逐条堆。

## 1. 脚本面现状（实测）

### 1.1 脚本面由三部分组成

| 组成 | 装配点 | 条数（实测） |
|---|---|---|
| 平台手写 op | `api/api-namespace.ts:67-106` | 35 |
| 生成脚本面 op | `api/generated/script-face.ts:21-52`（清单 `api/generated/script-face-manifest.ts:18-49`） | 30（其中 7 个被同名的平台手写 op 覆盖） |
| 编辑器扩展 op | `packages/faijs-extra/src/op-names.ts:21-35` | 9 |

去重后实测：`createApiNamespace()` **66 个键**；合并编辑器命名空间后 **75 个 `cad.*` 名**。
（实测方式：`tsx` 调用 `createApiNamespace()` 取 `Object.keys`。）

⚠️ **生成 op 与手写 op 同名是设计**：`api-namespace.ts:87` 先展开 `scriptFaceOps`，再用字面量覆盖
`cut`/`split`/`linearPattern`/`circularPattern`/`gridPattern`/`rectangularPattern`/`mirrorJoin`/
`mirror`/`clone`（`:88-105`）——手写版赢。其中 `split`/`linearPattern`/`circularPattern`/`gridPattern`/
`rectangularPattern`/`mirrorJoin`/`mirror`/`clone` 共 7 个是「生成 + 手写同名」；`cut` 的 arg-spec 条目是
`kind:'skip'`，被 `gen-l3-surface.ts:295` 过滤掉，所以 `cut` 是唯一「只存在于手写面」的重名。

### 1.2 四层对照面

| 层 | 内容 | 规模 |
|---|---|---|
| 引擎原生 | occt-wasm kernel 类方法（`node_modules/occt-wasm/dist/index.d.ts`） | 201 |
| L1 核心面 | `BrepEngineApi`（`brep/engine/primitives.ts:33-270`），两引擎共同真实现 | 99 |
| arg-spec 登记面 | `api/surface/arg-spec.ts:143` 的 `ARG_SPEC` | 857 条（brep-op 35 / query 18 / faijs 5 / pure 111 / type 286 / skip 402） |
| **脚本面** | §1.1 | **66 / 75** |

脚本面对登记面的覆盖率（实测）：**brep-op 25/35**、**query 0/18**、**faijs 5/5**。
即：**纯数据查询一条都没上脚本面**；建模 op 缺 10 条（其中 `extrude`/`revolve` 已由手写 op 在
cad 面覆盖，真缺口 8 条）。

### 1.3 脚本面现有的建模动作（按用途）

| 用途 | 现有 op |
|---|---|
| 体素创建 | `box` `sphere` `cylinder` `cone` `wedge` `torus` `ellipsoid` `makeBaseBox` `screw` `sdf` `convexHull` |
| 轮廓 → 面 | `sketch`（2D 线段/圆弧环 → 平面 Face 句柄）、`compound` |
| 面 → 体 | `extrude`（含 `upTo`）、`revolve` |
| 布尔 | `union` `subtract` `intersect` `cut` `fuse` |
| 变换 | `translate` `rotate` `rotate_euler` `scale` `scale3d` `applyMatrix` `locate` `mirror` `place` `clone` |
| 阵列/复制 | `linearPattern` `circularPattern` `gridPattern` `rectangularPattern` `mirrorJoin` |
| 修饰/增材 | `fillet`（EdgeTopoRef 选边）、`chamfer`、`knurl`、`engrave`、`drill` `pocket` `boss` |
| 修复 | `heal` `autoHeal` `fixShape` `healSolid` `simplify` |
| 切分/偏置 | `split`（Shape[] 切刀）、`offset` |
| 拓扑引用 | `faceRef`（面序号 1 起）、`edgeRef` |
| 测量 | `area` `length`、`bboxMin` `bboxMax` `bboxCenter` `faceNormal` |
| 出图/视图 | `viewCamera` `projectView` `projectSheet` |
| IO | `import_step` `import_brep` `asset` |
| 装配 | `jointTrajectory` `inverseKinematics` `mechanismDOF` |

## 2. 缺口盘点

### 2.1 四类缺口（本方案的组织框架）

- **G-A 登记缺口**：arg-spec 已登记、实现已生成，只是没打 `scriptFace: true`。改动量 = 一行 + 重跑生成器。
- **G-B 未登记缺口**：引擎或 L1 有该能力，但 arg-spec **完全没有这个符号**（`pure`/`type` 之外查无此名）。
  需要新增手写 op，或先补 vendored 面。
- **G-C 结构缺口**：能力在，但被**产物/输入模型**挡住——数组产物、子形状产物、状态化 DSL。
- **G-D 表达缺口**：脚本面**造不出输入**（wire / 边 / 面引用），导致一批特征即使登记也不可用。
  **这是门控项，决定 §4 的顺序。**

### 2.2 G-A（一类）：只差 `scriptFace` 标记的 brep-op（8 条）

8 条全部已带 `naming`，满足 `gen-l3-surface.ts:117` 的 scriptFace 前置守卫；改动量确实是「一行 +
重跑生成器」。

| op | arg-spec | engines（实测） | 输入 | 阻塞 |
|---|---|---|---|---|
| `thread` | `:1716` | `['occt']` | 仅 `options`（无 Shape 输入） | **无** |
| `fixSelfIntersection` | `:3290` | `['occt']` | `shape` | **无** |
| `sweep` | `:1624` | `['occt']` | `wire` + `spine` | G-D（要 wire） |
| `complexExtrude` | `:1631` | `['occt']` | `wire` + `center` + `normal` | G-D |
| `twistExtrude` | `:1638` | `['occt']` | `wire` + 角度 + 轴 | G-D |
| `roof` | `:1669` | 中立（用 `capabilities`） | `wire` + `options` | G-D |
| `section` | `:2896` | `['occt']` | `shape` + 平面 | 产物形态待探针（§2.4 ②） |
| `shell` | `:2929` | `['occt']` | `shape` + `faces: Shape[]` + 厚度 | 选面口径（§4 Phase 5） |

`extrude`（`arg-spec.ts:1609`）与 `revolve`（`:1617`）同样未打标记，但已由手写 op 在 cad 面覆盖
（`api/extrude.ts` 承载 `upTo`、`api/revolve.ts`），**不是缺口**。

### 2.3 G-A（二类）：18 条 query 全部缺席

`gen-l3-surface.ts:295` 只过滤 `kind !== 'skip'`，**query 类同样可以打 `scriptFace`**，且 query 模板
（`gen-l3-surface.ts:150-203`）已支持 `Shape` / `Shape[]` 位与 `engines` 执行前断言。实测清单：

| op | arg-spec | engines（实测） | 中立？ | 建议 |
|---|---|---|---|---|
| `isValid` | `:2991` | 空 | ✅ | 提拔 |
| `isEmpty` | — | 空 | ✅ | 提拔 |
| `isEqualShape` / `isSameShape` | — | 空 | ✅ | 提拔 |
| `getShapeKind` | — | 空 | ✅ | 提拔 |
| `checkInterference` / `checkAllInterferences` | `:401` | `['occt']` | ❌ | 见 §7 待裁决 4 |
| `measureVolume` / `measureVolumeProps` | `:304` | `['occt']` | ❌ | 不提拔（被中立版覆盖） |
| `measureArea` / `measureSurfaceProps` | — | `['occt']` | ❌ | 不提拔 |
| `measureLength` / `measureLinearProps` | — | `['occt']` | ❌ | 不提拔 |
| `measureDistance` / `measureDistanceProps` | `:340` | `['occt']` | ❌ | 见 §7 待裁决 4 |
| `measureCurvatureAt` / `measureCurvatureAtMid` | — | `['occt']` | ❌ | 见 §7 待裁决 4 |
| `getBounds` | `:188` | 空 | ✅ | **不提拔**（与已有 `bboxMin`/`bboxMax`/`bboxCenter` 同量） |

「不提拔」的理由统一是「**同一个量不给两个口径**」，不是省事。

### 2.4 G-B / G-C：真正缺的能力

**① 只在 L1、arg-spec 完全没有 → 手写薄包装即可拿到的能力**

`sew`、`sewAndSolidify`、`hullFromPoints`、`unifySameDomain`、`reverseShape`、`defeature`、
`removeHolesFromFace`、`fixFaceOrientations`、`removeDegenerateEdges`、`interpolatePoints`、
`surfaceCenterOfMass`。

这些在 `brep/engine/primitives.ts` 都在 L1 面内（`:61`–`:243` 区间），`engine-method-map.json` 里
状态均为 `dialect` / `aligned`（= 两引擎都有真实现）⇒ **都能做成中立 op**。
（L1 里的曲线参数查询 `curveLength` / `curvePointAtParam` / `curveTangent` 同属 L1，但属 §5 排除的
低阶查询，不进本轮。）

**② 只在 occt 原生面 → 平台 op（`engines:['occt']`）的候选池**

`halfSpace`、`intersectionCells`、`makeSolid`、`buildSolidFromFaces`、`offsetWire2D`、
`makeNonPlanarFace`、`bsplineSurface`、`approximatePoints`、`makeHelixWire`、`curveSplit`、
`liftCurve2dToPlane`、`makeFaceOnSurface`、`getInertia`、`getLinearCenterOfMass`、`distanceBetween`、
`surfaceCurvature`。

这是**候选池不是承诺清单**：§4 只取被具体 Phase 点名的（`makeHelixWire`、`surfaceCurvature` 等）。
IO 类（`importStl` / `exportStl` / `toBREP` / `fromBREP`）走宿主 ports 口径（`asset` / `load` /
`import_step` / `import_brep` 已在 cad 面），本轮不动。

**③ G-C① 数组产物做不成 op**

`define-op.ts:98` 的 `BrepProduct` = 句柄 / `{solid, faceEvolution}` / `Shape` / **具名记录**，
**不含数组**。因此 `loftAll`、`getSolids` 类、以及 L1 里返回 `BrepHandle[]` 的
`sectionByPlane`（`primitives.ts:80`）都不能按「返回数组」上脚本面。
出路是**具名产物** `outputs`（`define-op.ts:117`）——已有先例：occt 适配器的 `splitByPlane` 直接
返回 `{positive, negative}`（`occt-kernel/occt-primitives.ts:201`），`compat-op.ts:117` 支持
「具名字段是句柄数组」的收养。

**④ G-C② 子形状产物过不了兼容边界**

`api/internal/l3-bridge.ts:169-176`：收养时只放行 `type === 'solid'` / `'compound'`，其余
（edge / wire / face / vertex / shell）抛 `E_SUBSHAPE_BOUNDARY`。
⇒ **`helix`（Wire 产物）、`section`（边产物）、`thicken`（Face 入参后的面产物）的真实阻塞是
产物/入参形态，不是「引擎归属」**；把它们当「加个 `engines` 就能上」处理会直接踩这个边界。

**⑤ G-C③ 状态化 DSL（402 条 skip 的主体）**

finder 族（`edgeFinder`/`faceFinder`/`vertexFinder`/`wireFinder`/`cornerFinder`）、2D 族
（`Blueprint`/`Curve2D`/`draw`/`Sketcher`）、`sketching` 族、history/registry 族，skip 理由清一色是
「返回带闭包的 builder / 状态对象」。对策**不是搬 DSL**，而是把数据形态的等价物补上：
选面/选边 = `faceRef`/`edgeRef`；2D 轮廓 = `sketch`；历史 = 语句级重放。

**⑥ G-C④ mock 桩（新 op 想要被 mock 链路覆盖时的前置）**

`brep/engine/adapters/brep-mock.ts` 对 10 个**核心面方法**仍 `unsupported(...)`：
`:126 revolveVec`、`:127 sew`、`:129 shell`、`:130 hullFromPoints`、`:176 sectionByPlane`、
`:177 splitByPlane`、`:317 projectEdges`、`:368 composeTransform`、`:369 makeEllipsoid`、
`:370 makeTorus`。其中 **5 个恰好是本方案要新暴露的**（`shell` / `sew` / `sectionByPlane` /
`splitByPlane` / `hullFromPoints`）——要在 mock 下跑通编排链路，必须先补这些桩。

### 2.5 G-D 表达缺口（门控项）

**事实：脚本面没有任何一个产出 wire 的 op。** 逐一核对：

- `sketch`（`api/sketch.ts:193`）产出的是**面带柄**的 Shape——`sketch.ts:174`/`:178` 把 `makeFace`
  的 face 句柄放进 `fromBrep(..., {solid: face})` 的槽里；它内部虽然造了 wire（`loopToWire`），
  但 wire 不出函数。
- `line` / `circle` / `arc` / `ellipseArc` / `tangentArc` / `bezier` / `bsplineApprox` / `wire` /
  `wireLoop` / `face` / `polygon` / `helix` 在 arg-spec 全部是 `skip`，理由清一色「→ Edge/Wire
  子形状产物，faijs 整件面不承载」（如 `helix` 在 `:2777`）。

**推论**：`sweep`、`loft`、`guidedSweep`、`multiSectionSweep`、`pipe`、`simplePipe`、
`sweepPipeShell`、`complexExtrude`、`twistExtrude`、`roof`、`helix` 这 **11 个动作的输入侧全都要
wire**。不先解决造线，把 `sweep` 打上 `scriptFace: true` 只会得到一个「注册了但喂不进输入」的死 op。

机制现状（决定这件事能不能做）：

| 环节 | 现状 | 结论 |
|---|---|---|
| Shape 模型 | 基类型 `Shape` 只有 `{positions, indices}`（`mesh/types.ts:38-41`，**无 `kind` 字段**）；`kind` 由构造器加（`shape.ts:44` `{...mesh, kind:'solid'}`）。**`ShapeKind` 已声明 `'solid' \| 'shape2d' \| 'curve' \| 'compound'`（`shape.ts:21`），其中 `'curve'` / `'shape2d'` 全仓零引用（实测：全 `packages/*/src` 搜 `'curve'` 只命中类型定义一行）**。`fromBrep(mesh, holder)`（`shape.ts:64`）把任意 brep 句柄放进槽；`sketch.ts:174` 已经把 **face** 句柄这么放了。但它的返回类型写死 `SolidShape`、函数体首行 `solid(mesh)` 写死 `kind:'solid'`（`shape.ts:64-65`），而**它同时是 brep 登记的唯一运行时实现**（`fromHandle` / `adoptBrepjsProduct` / `adoptEntity` / `wrapBrepOne` 全是它的外壳）⇒ 1D 产物要带自己的 kind，必须改它；mesh 路径的**对称硬编码**在 `define-op.ts:164-166` `wrapMeshOne`。另实测全仓 `Shape.kind` 读取点只有 `shape.ts:129`/`:141`（compound 判定），无几何分派消费点；探针实测 face 载荷 positions 12 / indices 6、wire 为 0 / 0 ⇒ `kind` 现跑的是「有无三角载荷」语义，且 `'compound'` 已被**无载荷**的结构壳占用（`shape.ts:29-32`） | 模型层**不禁止** wire 入槽；判别位**现成**（新增 `'curve'`），但**登记与包装两处管线要改**（见 §7.1 建议 1 附带子项①②） |
| 产物边界 | `E_SUBSHAPE_BOUNDARY` 只在 `api/internal/l3-bridge.ts:169`，作用于 `compatOp` 产物的收养 | 手写 `defineOp` **不经过**该检查 |
| 网格载荷 | `solidToShape` 走 `kernel.meshShape`（`brep/brep-ops.ts:57`）；探针实测 wire 得空载荷（0/0）且**不抛错** | 执行链路**无缺口**（照走 `solidToShape`）；仅显示需另取 L1 `wireframe`（`primitives.ts:181`），见 §7.1 附带子项③ |
| 命名层 | `naming` 需要 `Provenance`；wire 无面 → 无 roleTable | 1D op 的 `naming` 取 `{kind:'unmodeled'}`（先例：`torus`/`convexHull`/`makeBaseBox` 实测 namingKind = `unmodeled`） |

### 2.6 按「解锁的动作数」排序

1. **G-D 造线** —— 解锁 11 个动作（§2.5）。最高杠杆。
2. **G-A 无阻塞部分** —— `thread`、`fixSelfIntersection` 2 条 + 中立查询 5 条 + 中立测量 2 条。
3. **按面/边选的特征** —— `shell`、`draft`、`thicken`、`defeature` 等，日常建模最高频。
4. **长尾** —— `sew`、`roof`、`twistExtrude`、`guidedSweep`、曲面族、诊断族。

## 3. 设计原则

1. **一律走既有三源一致通道**：arg-spec（`arg-spec.ts:143`）→ 生成器（`gen-l3-surface.ts:295`）→
   `script-face.ts` / `script-face-manifest.ts` → `gen-symbol-table.ts` → `check()` 符号表。三处相等由
   `packages/tests/faijs/p23-cad-face/p23-cad-face.test.ts:73` 断言。不发明第二套判定。
2. **平台归属按引擎事实声明**：`engines` 字段（`define-op.ts:116`），生成物透传
   （`gen-l3-surface.ts:130`），执行前拦截（`cad-runtime/backend-dispatch.ts:161`，`brep_mock` 豁免）。
3. **双方都有的能力必须做成中立 op**（不写 `engines`）。这一条会**把若干 vendored op 从 occt 平台
   升级为中立**：`shell` 是最典型一例——`engine-method-map.json` 里 `shell` 状态是 `dialect`
   （occt `shell` / brepkit `shell`），L1 `primitives.ts:65` 已有，而 arg-spec 因 vendored 实现路径
   声明了 `engines:['occt']`。改走 L1 后 `cad.shell` 两引擎都能跑。
4. **选面/选边一律用 faijs 既有拓扑引用语言**（`faceRef` / `edgeRef`，面序号 1 起，`api/face-ref.ts:42`），
   不复刻 vendored 的 `Face[]` / `Edge[]` 句柄入参。先例：`fillet` 用 `EdgeTopoRef[]`（`api/fillet.ts:92`）、
   `extrude` 的 `upTo` 用 `FaceTopoRef`（`api/extrude.ts:40`）。
5. **产物形态如实**：1D 就是 1D，不伪装成 solid；多产物一律用具名 `outputs`（`define-op.ts:117`），不用数组。
6. **手写 op 优先**：凡需要拓扑引用入参 / 1D 产物 / 角色表传播的，一律手写 `defineOp`
   （先例 `api/split.ts:114-120`、`api/fillet.ts:146-153`），不走生成投影。
7. **数组入参已不是阻塞项**：`compat-op.ts:73-79` 的 `borrowDeep` 递归借入数组/对象内的 Shape，
   `buildAdapter` 对每个实参都借（`compat-op.ts:161`）。**这条修正了若干条 skip 理由的前提**——
   `loft` / `guidedSweep` / `multiSectionSweep` 现写的「brep-op 模板单柄借入不适用」在 P23 之后
   不再成立；它们现在是被 G-D 挡（要 wire），不是被模板挡。Phase 6.4 顺手校正这些理由文字。
8. **不扩生成模板**：模板只做「借入 → 调用 → 收养」三段（`compat-op.ts:159-168`），够用；扩模板
   留待确有第二类需求时再议。
9. **缺失必须显式暴露**：不补桩、不返回假 0 / 假空数组（`brep-mock.ts:12` 已确立「缺失即暴露，
   绝不伪造」）。

## 4. 实施阶段

### Phase 0 — 探针（先做，无行为改动，结论决定后面怎么走）

1. **1D 载荷探针** —— **主体已跑完（2026-09-24 实测），剩两项**。
   已验（复刻 `sketch` 内部路径 `makeLineEdge`×4 → `makeWire` → `makeFace`，再直调 `meshShape` /
   `wireframe`）：face 得 positions 12 / indices 6，wire 得 **0 / 0 且不抛错**；`wireframe` 对 wire
   与 face 均出点列（points 24 / edgeGroups 12）。结论已写入 §2.5 与 §7.1 建议 1 / 附带子项③
   ⇒ **执行链路无缺口**。
   剩余：① `makeHelixWire`（Phase 3 的 `helix` 用）尚未探；② 按 `AGENTS.md`「关键验证必须留档为
   可重复测试」把上述结论落成 `*.test.ts`（现状为一次性脚本，未入库）。
   复现前置（探针实际用法）：`initOcctWasm()` → `registerOcctBrepEngine()` →
   `injectCurrentBrepEngineAsKernel()` → `getBrepEngine().primitives`，并
   `configureBackends({mode:'brep', brepEngineId:'occt', kernel:{brep:primitives}})`；
   与 `brep/engine/measurement-parity.test.ts` 的初始化同源。
2. **产物形态探针**：实测 vendored `section`（`arg-spec.ts:2896`）与 `roof`（`:1669`）的返回值类型
   （compound / solid / 边），钉死 §2.4 ② 的归属。
3. **选面口径探针**：`faceRef(part, n)` 的产物能否直接喂 L1 `shell`（`primitives.ts:65`）/
   `draft`（`:222`）——`api/topo-resolve.ts` 的 `buildEdgeResolutionContext` 与 L1 形参是否同口径。
4. 结论写入 Agent Note。**探针失败即该项降级为非目标**（§5），不硬造。

### Phase 1 — 零成本登记提拔（G-A 无阻塞部分）

1. `thread`（`:1716`）、`fixSelfIntersection`（`:3290`）补 `scriptFace: true`，重跑
   `gen-l3-surface.ts`（清单、生成物、符号表自动同步）。
2. 验收：`.fai.js` 里 `cad.thread({...})` / `cad.fixSelfIntersection(p)` 可跑；`p23-cad-face` 三源
   一致测试全绿；`docs/ops-api-inventory.md` 重生成通过 `--check`。

### Phase 2 — 中立测量 / 查询面

1. **新增中立 op（手写，直调 `getBrepApi()`）**，照 `api/measurement/index.ts:42-56` 的形态：
   `volume(shape)`（L1 `getVolume`）、`centerOfMass(shape)`（L1 `getCenterOfMass`）。
   `engine-method-map.json` 实测两条均为 `dialect` ⇒ 两引擎同口径。
2. **提拔中立 query**：`isValid`（`:2991`）、`isEmpty`、`isEqualShape`、`isSameShape`、`getShapeKind`
   （5 条 engines 实测为空 = 中立）。`scriptFace: true` 即可。
3. **明确不新增**：`boundingBox` / `getBounds` —— `bboxMin` / `bboxMax` / `bboxCenter` 已在 cad 面
   （`api-namespace.ts:76`），同一个量不给两个口径。
4. occt-only 的 `measure*` 家族**不按平台 op 提拔**（否则与中立版形成双轨）；确需 occt 独占诊断时
   另立名走 §7 待裁决 4。
5. 验收：扩展 `api/measurement/measurement-script.test.ts`，断言两引擎同口径 + brepkit 假值路径；
   `op-set-consistency` / `p23-cad-face` 全绿。

### Phase 3 — 造线能力（G-D 门控层，本方案的关键新增）

1. **先定 1D 判别位**（见 §7 待裁决 1）：新增 `kind:'curve'`（维持既有「有无三角载荷」语义——
   wire 载荷实测为空，故不得报 `'solid'`），还是沿用 `solid` 槽 + 维度标记。这是模型层决定，
   一次定清楚，后续 Phase 4–6 全部依赖它。
2. **登记与包装管线改造**（§7.1 建议 1 附带子项①，无免费路径）：
   - `shape.ts`：抽出私有 `attachBrep(s, holder)` 承载现有 4 步登记，新增 `curve(mesh)` 构造器
     与 `fromBrepCurve(mesh, holder)`（`fromBrep` 改为 `solid(mesh)` + `attachBrep`）；
   - mesh 路径按附带子项②选定的拧法落地（推荐 (i)：mesh impl 返回 `curve(mesh)`，靠 `isShape`
     短路，不动 `define-op.ts`）；
   - **没有这步，1D 产物的 kind 要么拿不到、要么随 `mode` 漂移**（`mode=brep` → `'curve'`，
     `mode=mesh` → `'solid'`）⇒ 必须配一条「同一 op 两种 mode 下 kind 一致」的测试。
3. **新增手写 op**：
   - `wire(points, {closed?, smooth?})` —— 折线 / 闭合轮廓 / 平滑曲线，**中立**，用 L1 构造
     （`makeLineEdge` `:166`、`makeArcEdge` `:167`、`makeBezierEdge` `:168`、
     `interpolatePoints` `:217` + `makeWire` `:172`，均在 `primitives.ts`）；
   - `helix({radius, pitch, turns, axis?})` —— **平台 op（`engines:['occt']`）**：L1 无
     `makeHelixWire`，occt-wasm 有原生实现（`inspect*` 族同例，需「非目标引擎执行前报错」
     与「`brep_mock` 下不拦截」两条测试）；
   - `sketch` 增出线形态（`{contours, as:'face'|'wire'}`）：让现有 2D 轮廓能力直接喂给扫掠族
     （`sketch.ts:193` 现在只有面形态；内部 `loopToWire`（`:132-150`）已造 wire，只需把它交出来）。
4. **命名与终结**：1D op 的 `naming` 取 `unmodeled`（先例 `torus`/`convexHull`/`makeBaseBox`）；
   确认 1D Shape 可作终结产物（显示 / 导出链路），显示按 §7.1 附带子项③ 的显示口径走
   `wireframe`（`primitives.ts:181`）。
5. 验收：1D op 的可达测试；把 1D 产物喂给 `extrude`（面 op）时必须是**执行前**报错，不许运行时报错。

### Phase 4 — 扫掠 / 放样 / 管道族（解锁 11 个动作）

1. `sweep(profile, spine, opts?)`：手写 op。`profile` 接受 1D（wire）或 2D（面）——2D 时取外环
   （L1 `getSubShapes(handle,'wire')`）；实现走 occt 平台，声明 `engines:['occt']`（`sweep` 的
   arg-spec 条目实测已是 `['occt']`）。
2. `loft(sections: Shape[], opts?)`：手写 op（数组入参已无障碍，见原则 7）；**否决** `loftAll`
   （数组产物，§2.4 ①）。
3. `complexExtrude` / `twistExtrude` / `roof`：登记 + 依赖 Phase 3。`roof` 是**中立** op——其
   capabilities 实测为 `['buildTriFace','dispose','fixShape','isValid','sew','sewAndSolidify']`，
   全部在双方能力面内。
4. `guidedSweep` / `multiSectionSweep`：长尾，本轮是否做见 §7 待裁决 5。
5. 验收：每个平台 op 沿用「非目标引擎执行前报错 / mock 下不拦截」两条测试；
   `node scripts/check-platform-imports.mjs` 通过。

### Phase 5 — 按面/边选的特征族（日常最高频）

统一口径：选面 = `faceRef(shape, ordinal)`，选边 = `edgeRef`，与 `fillet` 一致（原则 4）。

1. `shell(shape, {openFaces: FaceTopoRef[], thickness})`：手写，走 L1 `shell`（`primitives.ts:65`，
   map 实测 `dialect`）⇒ **中立 op**（不写 `engines`）。相对现状是能力升级（vendored 版是 occt 平台 op）。
2. `draft(shape, {faces: FaceTopoRef[], angleDeg, pull?, neutral?})`：手写，走 L1 `draft`
   （`primitives.ts:222`，map `dialect`）⇒ 中立。`neutral` 用 `{point, normal}` 平面参数，不给 face 引用。
3. `thicken(shape, thickness)`：手写。L1 无 thicken（`thickenWithHistory` 是 occt 平台，map `occt-only`）
   ⇒ 平台 op `engines:['occt']`。输入形态见 §7 待裁决 2。
4. `defeature(shape, faces)` / `removeHolesFromFace` / `reverseShape` / `unifySameDomain` / `sew` /
   `sewAndSolidify`：L1 已有（map 全为 `dialect`/`aligned`）⇒ 手写薄包装，中立。
5. `filletVariable(shape, edge, r1, r2)`：L1 `filletVariable`（`primitives.ts:105`，map `dialect`）是 faijs
   简化形态（单边 + 起止半径）⇒ 中立手写；vendored 的 per-edge 回调形态（`variableFillet`，`:3355`）
   维持 skip。
6. 验收：`filletVariable` 与 `fillet` 的边界一致性测试（`r1 == r2` 时结果等价，容差内）；
   `shell` / `draft` 的两引擎 parity。

### Phase 6 — 剖切与长尾

1. `splitByPlane(shape, {point, normal})`：手写，产物用具名 `outputs: ['positive','negative']`
   （`define-op.ts:117`；occt 适配器已返回该形态，`occt-kernel/occt-primitives.ts:201`）⇒ 中立。
2. `sectionByPlane`：**依赖 Phase 3**。L1 产物是边/线句柄数组（`primitives.ts:80`；
   `occt-primitives.ts:171-177` 逐条 downcast），既命中 §2.4 ① 又命中 ②——Phase 3 落地后按
   「1D compound」形态暴露，否则列非目标。
3. **mock 补桩**：`brep-mock.ts` 的 10 个核心面桩（`:126`–`:370`）按近似实现补齐，至少覆盖本方案
   新暴露 op 所需的方法（`shell`/`sew`/`splitByPlane`/`sectionByPlane`/`revolveVec`/`hullFromPoints`）。
4. **校正 stale skip 理由**：`loft`（`:1762`）、`guidedSweep`（`:1768`）、`multiSectionSweep`
   （`:1771`）的 reason 文字已与实现不符（原则 7），改为按实际情况描述。

### Phase 7 — 文档、守卫与发布

1. `docs/ops-api-inventory.md`（生成物）随 JSDoc 重生成；`docs/api-contract.md` **§10.1**（函数目录）
   与 **§7.11**（`engines` 声明）追加脚本面新增能力说明。
2. 清 D12 欠账：`brep/handle-bridge.ts:32` 的 `getKernel()` 标 `@deprecated` 并纠正 JSDoc（现仍写
   "Get the OCCT kernel instance"；类型化的中立出口 `getBrepApi()` 在同一文件 `:51`）。
3. Agent Note：`.agents/notes/implemented/architecture/2026-09-24-script-face-modeling-capability.md`。
4. 版本号：纯新增 op、无破坏性变更 ⇒ 只动 patch 位。

## 5. 不做的事（非目标）

- **不搬 vendored 状态化 DSL**（finder / 2D Blueprint / `Sketcher` / `Drawing` / history 注册表族，
  402 条 skip 的主体）：用数据形态的等效物替代（`faceRef`/`edgeRef`/`sketch`/语句级重放）；
- **不做数组产物 op**（`loftAll`、`getSolids` 类）；多产物只用具名 `outputs`；
- **不复刻 vendored 的 `Face[]` / `Edge[]` 句柄入参口径**（原则 4）；
- 不暴露句柄/内存管理与低阶查询（`dispose` / `release` / `hashCode` / `isSame` / `curvePointAtParam` /
  `uvBounds` 等）；
- 不给 brepkit 补 `loft` / `thicken` 的 faces 形态接线（工具形态不同，二者留 occt 平台 op）；
- 不做 UI 参数面板隐藏逻辑（宿主职责）；
- 不给缺失能力补桩、不返回假 0 / 假空数组（原则 9）。

## 6. 验收总门

- `npm run test -w @faicad/faijs` 与 `-w @faicad/faijs-tests` 全绿（stderr 零容忍）；
- `npm run typecheck` / `npm run lint` 通过；
- `node scripts/check-platform-imports.mjs` 通过（`@platform occt` 文件标注与 `engines` 声明一致）；
- `npm run doc-sync` 通过；
- `p23-cad-face` 三源一致（导出面 ≡ cad 面 ≡ `check()` 符号表）全绿；
- 每个新增平台 op 各两条测试：非目标引擎下执行前报错 / `brep_mock` 下不拦截。

## 7. 待裁决点（需用户拍板）

| # | 议题 | 备选 | 我的建议 | 影响面 |
|---|---|---|---|---|
| 1 | 1D 判别位：`kind` 的语义 + 登记管线 | (a) 把 `kind` 升为「拓扑维数真源」（连带走 `sketch` face→`'shape2d'`、几何 `compound` 与导入面各报什么，并先解决 `'compound'` 值冲突）；(b) 维持现有「有无三角载荷」语义，只新增 `'curve'` 给 1D | **(b)**：实测 face 有三角载荷（12/6）、wire 为 0/0，现语义自洽；且 core 与 3d_editor 均零读取 `kind` ⇒ (a) 现在无验收标准。**但登记管线（子项①②）无论选哪个都必须改** | 决定 Phase 3–6 全部形态；`shape.ts` + `define-op.ts` 各一处改动 |
| 2 | `thicken` / `shell` / `draft` 的「某实体的第 N 面」入参 | (a) 新增返回「面带柄 Shape」的 `faceOf(shape, ordinal)`；(b) 全部用 `FaceTopoRef[]` + 内部解析 | **(b)**（`faceRef` 现成口径） | `thicken` / `shell` / `draft` 的脚本写法 |
| 3 | `sectionByPlane` 是否本轮做 | (a) 本轮做（等 Phase 3 落地）；(b) 用 `splitByPlane` + 出图族顶替 | **(a)**，排在 Phase 6 且按「剖切族」整体交付 | Phase 6 范围 |
| 4 | occt 独占诊断（`checkInterference` / `measureCurvatureAt` / `measure*Props`） | (a) 进脚本面但改用 `inspect*` 命名；(b) 本轮不做 | **(a)**，只做无中立替代的三族 | 诊断类能力是否进脚本面 |
| 5 | `guidedSweep` / `multiSectionSweep` | (a) 本轮做；(b) 延后 | **(b)**，但本轮校正其 stale skip 理由 | Phase 4 范围 |

### 7.1 建议的理由（逐条，依据为 2026-09-24 实测代码）

**建议 1 → (b) 维持 `kind` 的「载荷类别」语义，只新增 `'curve'`；登记管线照改**

1. 选「沿用现有语义」不是「不新增字段」，而是**不新造第二个判别位**：基类型 `Shape` 本来就没有
   `kind`（`mesh/types.ts:38-41`），`kind` 是构造器加的。再加「维度标记」= 两个真相源，
   必然出现 `kind:'solid' && dimension:'1d'` 这种自相矛盾态。
2. **`kind` 今天跑的是「有无三角载荷」语义，不是「拓扑维数」（探针实测，2026-09-24）**：
   - `sketch` 的产物走 `kernel.meshShape(face)` ⇒ **positions 12 / indices 6**（方形面 = 2 三角，
     与 `box` 的 72 / 36 同族）；`wire` ⇒ **positions 0 / indices 0**（空，且**不抛错**）。
     所以 `sketch` 报 `'solid'` 在现语义下**是对的**——它有可渲染的三角面。
     探针复刻 sketch 内部路径（`makeLineEdge`×4 → `makeWire` → `makeFace`）后直接调
     `meshShape`；L1 `wireframe` 对 wire / face 都出点列（points 24 / edgeGroups 12）。
   - `Shape.kind` 的读取点只有 `shape.ts:129`（`isCompound`）与 `:141`（`isCompoundLike`）；
     core 其余 `kind` 命中全是无关物（AST 节点、topo-ref、导入 kind、worker 消息等）。
     `occt-kernel/topologyExt.ts:995` 的 `entry.kind` 是局部的 OCCT 种类字符串
     （`ShapeEntry`，同文件 `:713-723` 由 `getSubShapes(shape,'solid'|'shell')` 自造），
     与 `ShapeKind` 无关。本机 3d_editor 全仓搜 `kind` 亦零命中（只有无关的目录树 / 预览 kind）
     ⇒ **`kind` 目前是一个无消费者的标注字段**。
   - 另一条探针结果：`shapeType` / `getShapeKind` **都不在 L1 接口内**（实测 `BrepEngineApi`
     `:33-270` 的 99 个成员里没有它们；L1 面上可用的拓扑查询只有 `getSubShapes`）。探针从
     `engine.primitives` 调 `shapeType` 得 `k.shapeType is not a function` ⇒ 若将来改走
     「按拓扑类型判别是否 1D」，L1 现成入口只有 `getSubShapes`。
   - 推论：单给 `sketch` 改 `'shape2d'` 属**无害但不可验收**的改动（没有读者能证明改对了），
     而且只做一半会引入新不一致（见第 3 点）。
3. **(a) 路线要连带解决三件事，不是一行**：
   - 几何 `compound` op（`api/compound-geom.ts:88-92`）把 **TopoDS_Compound** 句柄也经
     `fromBrep` 交付 ⇒ 现报 `'solid'`；升维数语义后它该报什么？
   - **`'compound'` 这个值已被占用，且占它的类型无载荷**：`CompoundShape = {kind:'compound',
     children: Shape[]}`（`shape.ts:29-32`，由 `compound()` `:106-110` 产出）**不 extends
     `Shape`**、没有 `positions`/`indices`；而 `SolidShape extends Shape`（有载荷）。它与
     `'solid'`（有载荷的几何产物）**不同族** ⇒ 想表达「几何复合体」时无值可用。
   - `load`（`faijs-extra/ops/load.ts:94`）、`import-step`（`api/import-step.ts:73`）与
     `import-brep`（`api/import-brep.ts:82`）是「文件里是什么就塞什么」，需定义导入面 / 导入复合体
     各报什么。⇒ (a) 是一次**分类学重构**，宜作为独立议题，在出现第一个真读者（UI 按维数分流
     渲染 / 导出按维数选格式）时立项——那时才有验收标准。
4. 本轮只需要「是不是 1D」这一个判别位，(b) 已经够：新读者只问 `kind === 'curve'`，不会去断言
   face 一定是 `'shape2d'`。(a) 若将来要做，干净目标态是：**结构壳另起 `'group'`**，把
   `'compound'` 让给几何复合体，四个维数值即全部可用。
5. 启用 `'curve'` 的类型代价为零：`ShapeKind`（`shape.ts:21`）已声明
   `'solid' | 'shape2d' | 'curve' | 'compound'`，其中 `'curve'` / `'shape2d'` 全仓零引用。
   且 `StdShape`（`shape.ts:35`）**没有任何收窄消费点**——实测全 `packages/*/src` 里它只有
   定义与三处类型 re-export（`api/index.ts:49`、`sdk.ts:36`/`:39`）；`define-op` 用的是
   `MeshProduct` / `BrepProduct` / `Shape`（`define-op.ts:86`/`:98`/`:164`/`:169`），本就
   kind-agnostic ⇒ 往联合里加一个成员是**纯增量，零 call-site 改动**。

**建议 1 附带子项 ①（必须与 1 一起拍）：登记管线必须改，没有免费路径。**

brep 产物的登记**只有一条运行时通路**，终点是 `fromBrep`（实测，2026-09-24）：

| 入口 | 位置 | 性质 |
|---|---|---|
| `fromBrep(mesh, holder)` | `shape.ts:64-87` | ★ 唯一实现（4 步登记） |
| `fromHandle(handle, opts)` | `brep/handle-bridge.ts:137-140` | 转 `fromBrep(meshHandle(...), {solid})` |
| `adoptBrepjsProduct(product, seg?)` | `api/internal/l3-bridge.ts:84-97` | 转 `fromHandle` |
| `adoptEntity(product, op, seg?)` | `api/internal/l3-bridge.ts:163-181` | 转 `adoptBrepjsProduct` |
| `wrapBrepOne(v)` | `define-op.ts:169-186` | 转 `fromBrep` / `fromHandle` |

这 4 步分别是（`shape.ts:64-86`）：① `solid(mesh)` → `state.created.add(s)`（`:44-45`）；
② `state.slots.set(s, {solid, faceEvolution?})`（`:66-72`）——把句柄挂到 Shape 身份槽；
③ `runtimeLineage.recordOutput(stmtId, roleTable, holder.solid)`（`:76-83`）——拓扑命名 / 血缘图；
④ `registerFunctionBrep(holder.solid)`（`:84-85`）——函数 BREP 域，函数返回后统一释放。
缺任一步的后果：后续 op 解析不到句柄 / `faceRef`·`edgeRef` 解析链断 / 函数内造的句柄永不释放。
这正是「绕开 `fromBrep` 自己手写登记」不可接受的原因——等于复制一整套身份、血缘与释放语义。

而 `fromBrep` 把 kind 写死在两处：返回类型 `SolidShape`（`shape.ts:64`），
以及函数体首行 `const s = solid(mesh)`（`shape.ts:65`）——`solid()` 内是 `{...mesh, kind:'solid'}`
（`shape.ts:44`）。**改法不给 `fromBrep` 加可选 `kind` 参数**（漏传即静默回落 `'solid'`，
且与「构造器决定 kind」的现有结构 `solid()`/`compound()` 不一致），而是把 4 步登记抽成
一个私有 `attachBrep(s, holder)`：

```ts
export function fromBrep(mesh, holder): SolidShape { const s = solid(mesh); attachBrep(s, holder); return s }
export function fromBrepCurve(mesh, holder): CurveShape { const s = curve(mesh); attachBrep(s, holder); return s }
export function curve(mesh: Shape): CurveShape { /* 同 solid()：kind:'curve' + created 登记 */ }
```

登记逻辑仍**只有一份**（守住原则「不发明第二套判定」与用户裁决④「同库不准两份」），
类型层只动 `shape.ts` 一个文件。

**建议 1 附带子项 ②（对称缺口，必须一并处理）：mesh 路径同样硬编码 `solid()`。**

`define-op.ts:164-166`：`wrapMeshOne(v) = isShape(v) ? v : solid(v)`。每个 dual-op 的
**mesh 实现裸产物**都在这里被套成 `kind:'solid'`。只扩 `fromBrep` 不动它，会出现
**同一个 op 的 `kind` 随执行模式漂移**：`mode=brep` → `'curve'`，`mode=mesh` → `'solid'`。
两种拧法（择一，写进 §3 原则）：
- **(i) 约定 mesh impl 返回已构造的 Shape**（`curve(mesh)`），靠 `isShape` 短路——不动
  `define-op.ts`，代价是需要一条测试钉住「同一 op 在两种 mode 下 kind 一致」；
- (ii) `wrapMeshOne` 也接受 kind 声明——改动面更大，不推荐。

**建议 1 附带子项 ③（与 1 一起拍）：1D 的载荷口径。**
执行正确性口径：`solidToShape` 走 `kernel.meshShape`（`brep-ops.ts:57`），wire **实测返回
positions 0 / indices 0 且不抛错**，但类型上恒为 `Shape`（`positions`/`indices` 齐备，
`isMeshShape` 通过）⇒ **照样走 `solidToShape`（允许空载荷）**，链路不被破坏。
显示口径：线框需要点列，取 L1 `wireframe(shape, deflection?)`（`primitives.ts:181`）——
实测对 wire 与 face 均可用（points 24 / edgeGroups 12）；
**不要**为了显示把 wire 三角化伪装成实体（违反原则 5「1D 就是 1D」）。
两个口径不冲突。点列是直接挂进 `CurveShape` 载荷，还是由 UI 经 brep 槽自行取，随
Phase 3 的显示验收一并定。
⚠️ 导出链路要单独确认：STL 走 mesh（空），STEP 走 brep（occt 能写 wire）——进 Phase 3 验收。

**建议 2 → (b) 全部走 `FaceTopoRef[]`，不新增 `faceOf()`**

1. `faceRef` 返回**纯数据** `{kind:'face', origin, role, hint}`（`api/face-ref.ts:76`，不是 Shape）。
   先例已确立：`fillet` 收 `EdgeTopoRef[]`（`api/fillet.ts:92`）、`extrude` 的 `upTo` 收单个
   `FaceTopoRef`（`api/extrude.ts:40`）。新增 `faceOf()` 立刻产生**两套面引用口径**，
   违反用户裁决④「符号一份实现多处投影，同库不准两份」。
2. `faceOf` 的产物定位不清：若外包成 Shape，就撞上 `adoptEntity` 已封死的
   `E_SUBSHAPE_BOUNDARY`（`l3-bridge.ts:169`：只有 `solid`/`compound` 可跨库边界）；
   若不外包、只是个包装 `FaceTopoRef` 的对象，则与 `faceRef` 同物，纯属多一层壳。
3. L1 形参要的是**内核句柄**：`shell(solid, facesToRemove: BrepHandle[], …)`（`primitives.ts:65`）
   ——两种方案都得在 op 内做「TopoRef → 句柄」解析（`api/topo-resolve.ts` 的
   `buildEdgeResolutionContext` 已在做）。选 (b) 时解析只在 op 内一处；选 (a) 还得额外定义
   面 Shape 的解析与生命周期语义。
4. `draft` 的 `neutral` 平面参数**不给** face 引用（沿用方案原则，保留）。
5. **依赖**：本建议需 Phase 0 探针 3 通过（`faceRef` 的 `hint` 能否稳定喂入 L1 `shell`/`draft`）。
   探针不过则降级为「只支持 `{point, normal}` 平面参数、拒绝 face 引用」，不硬造。

**建议 3 → (a) 本轮做，作为「剖切族」整体交付，排在 Phase 6**

1. `sectionByPlane` 是**唯一能拿到精确截面线**的入口（`primitives.ts:76-80`：occt 由大平面 face
   经原生 `section` 达成，brepkit 返回句柄组 ⇒ **中立**）。不做它，脚本面就永远没有
   「切割 → 取截面 → 再建模」这条链，而这恰是薄壁/焊接件的常见动作。以「最大化建模能力」
   为目标，砍掉它是跑偏。
2. 代价已明确：产物是 1D 句柄数组（`primitives.ts:80`；`occt-primitives.ts:171-177` 逐条 downcast）
   ⇒ 必须先有 Phase 3 的 1D 形态。所以问题不是「要不要做」，而是「必须排在 Phase 6」。
3. `projectView` / `projectSheet` **不能替代**：那两条是出图/视图投影，不产生可继续建模的
   3D 边/线，也不是精确截面。
4. 若进度不足，正确砍法是**只砍 `sectionByPlane` 这一条**、改用 vendored 单产物
   `section(shape, plane)`（`arg-spec.ts:2896` 已是 `brep-op, engines:['occt']`，只差
   `scriptFace: true`）——其返回形态由 Phase 0 探针 2 钉死。**不建议**整族砍。
   顺序：`splitByPlane`（无 1D 依赖，先做）→ `sectionByPlane`（Phase 3 之后）。

**建议 4 → (a) 进脚本面，只做三条无中立替代的，统一 `inspect*` 命名**

1. 分级：`measureVolume` / `measureArea` / `measureLength` / `measureDistance`
   （`arg-spec.ts:304` / `:316` / `:328` / `:340`）这几个量 faijs 已有中立版
   （`area` / `length`；`volume` 由 Phase 2 补）⇒ **occt-only 版不得上脚本面**，
   否则同一个量两个口径，脚本作者无法判定用哪个（同意方案 Phase 2.4 的表态）。
2. 真正无中立替代、且是 occt 强项的只有三族：
   - **干涉** `checkInterference`（`:401`）/ `checkAllInterferences`（`:418`）——装配/公差刚需；
   - **曲率** `measureCurvatureAt`（`:372`）/ `measureCurvatureAtMid`（`:389`）——曲面质量诊断；
   - **惯量/质量属性** `measureVolumeProps`（`:268`）等——「绕轴惯性矩/主轴」中立面没有。
3. 命名**不走 `measure*`**（会与中立量形成误导性双轨）：改用
   `inspectInterference` / `inspectCurvature` / `inspectMassProps`，arg-spec 里声明
   `engines: ['occt']`（现成字段）+ `scriptFace: true`。名字自带「平台独占诊断」这层信息。
4. **排除项**：`measureDistance` / `measureDistanceProps` 继续 skip（等中立 `distance`）；
   状态化 distanceTool（`:254-264`，返回带 `distanceTo`/`dispose` 闭包的工具）**永远 skip**
   ——查询对象生命周期不可静态建模。

**建议 5 → (b) 延后，但本轮校正 skip 理由**

1. 它们的真障碍**不是数组入参**：`borrowDeep` 已递归借入数组/对象内的 Shape
   （`compat-op.ts:73-79`）。真障碍是 **wire 输入 + 多截面/导轨语义**，全部依赖 Phase 3。
2. `sweep` + `loft` 已覆盖绝大多数扫掠/放样需求；`guidedSweep`（导轨）与
   `multiSectionSweep`（多截面）是**高阶变体**：参数语义复杂一个量级（导轨链、每截面的变换配置），
   且 brepkit 侧是否同口径未验证。
3. 本轮目标是「最大化建模能力」，不是「最大条数」。先确保 Phase 3–5 的造线/扫掠/选面族
   **真正跑通并有测试**（这是新增能力的地基），再补高阶变体——届时它们已无结构障碍，
   只缺参数面设计。
4. 同时执行 §4 Phase 6.4：校正 `loft`（`:1762`）、`guidedSweep`（`:1768`）、
   `multiSectionSweep`（`:1771`）三条 stale skip 理由（现写「模板无法数组借入」，与
   `compat-op.ts:73-79` 实现不符）。

### 7.2 五点的依赖关系（拍板顺序）

**1 → 3 → 2 → 4 → 5**：1 是模型层地基（决定 Phase 3–6 全部形态），其落地形态即 Phase 3 步骤 2
的管线改造（`attachBrep` / `curve()` / `fromBrepCurve` + mesh 路径拧法）；3 依赖 1；
2 依赖 Phase 0 探针 3；4 / 5 是范围取舍，与前三者无耦合，可最后定。
