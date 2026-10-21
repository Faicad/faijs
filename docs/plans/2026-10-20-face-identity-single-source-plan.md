# 面身份单源化：拓扑面表 / 显示 mesh / 面号三者对齐（2026-10-20）

- 状态：**已落地**（faijs 0.36.13，2026-10-21；3d_editor 已升级到 0.36.13）
- 产出来源：web 版抽壳"方向反了"的根因追查（faijs 侧）
- 涉及仓库：`faijs`（修复方，代码改动在此）、`3d_editor`（消费方：升级依赖 + 两条消费侧测试）

---

## 1. 用户原话（逐字）

> 分析../3d_editor项目，为何网页版本的抽壳命令，抽壳的方向反了。我点击哪个面，应该就是那个面消失，被抽壳啊。小程序端是正确的。

> 没看懂你写的内容。我的要求很简单，拓扑数据必须来自faijs，3d_3ditor不准自己写拓扑；而且拓扑数据必须和显示拾取时的mesh必须一一对应。你参照这两条要求。给我分析到底谁的问题

> setFaceColor 的面序契约（0=+X,1=−X,2=+Y,3=−Y,4=+Z,5=−Z）成立？这是什么意思？

> 到底什么意思，你没讲清楚。setFaceColor 的面序契约（0=+X,1=−X,2=+Y,3=−Y,4=+Z,5=−Z），到底是谁规定的

> 这完全是错误的东西啊。faijs彻底剥离了three.js，而且这明显和我定的规则冲突。你写一份完整的开发计划文档，把这个问题彻底修复。

> 用户点击一个面，生成的抽壳代码，需要保证换内核照样可以执行。所以这里的面拓扑命名需要一种跨内核的移植。

> 至于数字面号要不要跨内核稳定，当然不可能做到跨内核的移植性。所以要在faijs代码尽量避免用这种数字序号呀。

> 然后我实测，在小程序端，长方体抽壳生成如下的代码：
>
> ```js
> let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)
> let part1 = cad.shell(part0, { openFaces:[{kind:'face', origin:'s1', role:'right', hint:{kind:'face', surfaceType:'plane', normal:[1,0,0], area:600, center:[10,10,15]}}], thickness:2 * MM })
> ```
>
> 根本没有面序号。

三条判定（前两条来自用户第二段原话，第三条来自上面三段）：

- **规则一**：拓扑数据必须来自 faijs；3d_editor 不准自己写拓扑。
- **规则二**：拓扑数据必须与显示、拾取时的 mesh 一一对应。
- **规则三**：**跨内核移植的身份单位是面拓扑命名 `FaceTopoRef`（`origin` + `role`，`hint` 只作打分兜底），不是数字面号**。数字面号不可能跨内核，因此 faijs 代码要尽量避免数字序号。

用户给的实测代码就是规则三的现成样板：`origin:'s1'` 是语句 StmtId（不随变量改名/复用漂移），`role:'right'` 是语义角色，`hint.area = 600 = 20×30`、`center = [10,10,15]` 正是 `box(10,20,30)`（默认锚点、角点在原点）下 +X 面的几何——身份与几何自洽，且**代码里没有任何面序号**。

---

## 2. 结论

一句话：**问题全部在 faijs。** 3d_editor 只是把 faijs 给出的"面行号"原样传递，它没有任何造拓扑或改面号的代码；出错的是 faijs 在数据离开引擎之前，就把"显示 mesh 的三角形顺序"和"拓扑面表的行序"做成了两个互不相干的东西，并且把前者锚定在 three.js 的三角形生成顺序上——这既违反规则二，也和"faijs 已彻底剥离 three.js"的定位冲突。

更准确地说：**跨内核身份机制本身已经是对的**（`FaceTopoRef{origin, role}`，小程序产出的正是这个形态，web 侧 `captureTopoRef` 也产出同形态），坏的是**从显示 mesh 反查 `FaceTopoRef` 的中途那一步**——它用一个错位的数字面号当作"行号"，于是同一个身份被绑到了镜像的那张面上。所以修复的目标不是"再造一套可移植身份"，而是**把数字面号从身份链路里彻底摘出去**：数字只允许出现在"本次执行、本内核、本机内存"里，跨内核/跨执行/写进代码的身份只能是 `FaceTopoRef`。

faijs 已经有一处把这条规则写进代码：`api/shell.ts` 的 `expandShellFaceRefs()` 对精度链的数字序号**直接抛错**（注释原文："禁止 `cad.faceRef` 序号——序号跨内核不可移植"）。本方案要做的，是把这条已经存在的判断推到全库，并修掉唯一还在用"数字面号当跨内核身份"的地方——`setFaceColor` 的 `faceIds` 与它背后的 `faceRanges`。

具体是四个缺陷叠加，其中 D1/D2 直接造成抽壳方向反：

| 编号 | 缺陷 | 后果 |
|---|---|---|
| D1 | **面号双源**：`Shape.faceRanges` 的下标（= `setFaceColor` 的 faceIds）按"契约序 +X/−X/+Y/−Y/+Z/−Z"，而拓扑面表行号/`faceRuns.faceRow`/命名行号按内核枚举序 −X/+X/−Y/+Y/−Z/+Z | box 的两套编号成对对调；同一个数在两套体系里指不同的面 |
| D2 | **box 只重排了显示 mesh，没重排拓扑面表**：`api/primitives.ts` 在 BREP 路径把三角形的 `indices` 整块重排到契约序，但拓扑面表仍按内核枚举序、`faceRuns.triStart` 仍是重排前的位置 | 面行 4 的数据是 −Z（命名 `bottom`），它的 `triangleStart` 却指向显示 mesh 里 +Z 的那两个三角形 → 点顶面得到 `role:'bottom'` → 抽壳开底面 |
| D3 | **"一份 mesh"只写在注释里**：`brepChain.meshShapeCache` 在生产路径上**从未被写入**（全仓只有 `brep-ops.ts:79` 一处 `set`，而唯一能传 `brepChain` 的 `loadBrep` 调用点都传 `undefined`），`buildBrepTopology` 恒 miss → 拓扑永远做第二次 `meshShape`，且参数是硬编码 `2π/32`，与显示侧的 `segments → 2π/segments` 不是同一个表达式 | faijs 自述的"规则 1"从未真正执行；曲线面（圆柱/圆锥/球）随时可能因两次三角化不一致而错位，只是当前参数下恰好收敛到同一结果 |
| D4 | **契约出处错误**：面号语义的三层出处是「three.js `BoxGeometry` 的顶点/索引循环顺序」→「`mesh/meshdata/parametric.ts` 的 vendored 移植（注释明写"改动循环顺序 = 改变面序契约"）」→「`mesh/primitives.ts` 里硬编码的 6 个 `{start,count}`」 | 一个已经和 three.js 无关的引擎，把第三方库的循环顺序当成对外 API 契约；且 `docs/api-contract.md` 里**没有**任何条款承认它，契约只存在于注释 |

排查记录：曾一度把「brepkit 上带 `hint` 的 `FaceTopoRef` 不可解析」记为 D5，**已排除**——那是探针写法造成的假阴性（见 §3.5 末段）。跨内核身份链路本身不需要修。

---

## 3. 实测证据

探针（`createRuntime(createNodePorts(), 'brep')`，OCCT，2026-10-20 实测，探针已随分析删除，验证逻辑将在 P4 落成常驻测试）：

### 3.1 `cad.box(20, 20, 20, { centered: true })`

```
显示 mesh: 12 三角形；faceRanges = [{0,2},{2,2},{4,2},{6,2},{8,2},{10,2}]
拓扑面表: 6 行；faceRuns = 6 行（[occRow, primIdx, triStart, triCount, faceRow]）

显示三角形区间 | 该区间实际所在面        | 面表行 | 该行自己的 center / normal      | 命名 role
tri 0..1      | x=+10  (+X)            | 行 0   | [-10, 0, 0] / [-1, 0, 0]       | left   → 指 −X
tri 2..3      | x=-10  (−X)            | 行 1   | [ 10, 0, 0] / [ 1, 0, 0]       | right  → 指 +X
tri 4..5      | y=+10  (+Y)            | 行 2   | [0, -10, 0] / [0,-1, 0]        | front  → 指 −Y
tri 6..7      | y=-10  (−Y)            | 行 3   | [0,  10, 0] / [0, 1, 0]        | back   → 指 +Y
tri 8..9      | z=+10  (+Z，顶面)      | 行 4   | [0, 0, -10] / [0, 0,-1]        | bottom → 指 −Z   ← 抽壳在此反
tri 10..11    | z=-10  (−Z，底面)      | 行 5   | [0, 0,  10] / [0, 0, 1]        | top    → 指 +Z
```

**为什么这个 bug 一直没被测试发现**：`faceRanges` 与 `faceRuns` 的数值完全一致（都是 `{0,2}`、`{2,2}`……），任何"比对区间"的自检都会通过；只有把"行区间所指三角形的几何"与"行自己记录的 center/normal"放在一起比，才会暴露。现有 `test/topology/face-group-units.test.ts` 断言的是面积和、每面 2 个三角形、两内核 `triStart` 一致，没有一条把"行区间"与"行自己的 center/normal"对照，恰好绕过这一点。

### 3.2 `cad.cylinder(10, 20, { segments: 16 })`（对照组：没有重排 → 数值上是对的）

```
显示 mesh: 124 三角形；faceRanges = [{0,64},{64,30},{94,30}]
行 0: triStart=0  triCount=64  surface=cylinder  center=[0,0,10]  normal=[0,0,1]  role=lateral
行 1: triStart=64 triCount=30  surface=plane     center=[0,0,20]  normal=[0,0,1]  role=top
行 2: triStart=94 triCount=30  surface=plane     center=[0,0,0]   normal=[0,0,-1] role=bottom
```

行区间与几何自洽 ⇒ 圆柱的拾取/抽壳当前是**对的**。这也说明问题不在"op 分派"或"拓扑生成算法"，而在 box 那条"为了对齐 three 序而重排"的特例分支。

### 3.3 定位到的代码位置

- `packages/core/src/api/primitives.ts`：`primitiveBrep()` 调 `brepPrimitiveMesh()`；后者对 `op === 'box'` 走 `faceNormalAxis()` + `byContract` 重排 `indices`，**没有**走 `solidToShape()`，因此也没写 `meshShapeCache`。
- `packages/core/src/occt-kernel/topologyExt.ts`（面行构造段）：面行按 `getSubShapes(shape,'face')` 枚举序 push，`triangleStart/triangleCount` 按 `hashCode(face)` 从 `faceGroups` 反查；`faceRunData.push(0, 0, triStart, triCount, fi)`。
- `packages/core/src/brep/brep-topology.ts`：`buildSolidTopologyRuntime()` 内部 `kernel.meshShape(...)`（硬编码 `(2π)/32` + `computeEffectiveDeflection`），注释声称"与显示 mesh 完全相同"依靠"确定性"而非同一份数据。
- `packages/core/src/cad-runtime/runtime.ts`：`buildBrepTopology()` 先查 `brepChain.meshShapeCache`（恒 miss），再调 `buildSolidTopologyRuntime`。
- `packages/core/src/mesh/primitives.ts`：mesh 路径 `box()` 里硬编码 `faceRanges`，注释写"面序号契约：0=+X,…,5=−Z"。
- `packages/core/src/mesh/meshdata/parametric.ts`：文件头注释"顶点与索引的生成顺序逐行照抄 three.js r162 …… 改动这里的循环顺序 = 改变面序契约，属破坏性改动"。
- `packages/core/src/topology/naming/build-naming.ts`：`findOriginRole(input.roleTable, input.ordinalToHash, i + 1)` —— 命名按 **1 基内核序号** 绑定 role，而不是按行自身的面 hash。这就是为什么"排序面表"不能只改一处：命名也必须改用行携带的序号/hash。

### 3.4 3d_editor 侧（无责，且有证据）

- 拓扑来源：`ScriptEngine._rebuildTopologyFromResult` → `buildSelectorRuntimeMaps(part.data)`，只用 faijs 给的 `data`，没有自造拓扑 → 合规规则一。
- 面拾取：`ModelGroup.tsx` 用 faijs 的 `buildFaceIdsForPart` 给每个三角形打 `faceIds`；`lib/topology/picking.ts` 把 `faceIds[三角形序]` 换成 `rowIndex`，再取 `faceReferenceByRowIndex` → 完全按 faijs 的表走，没有改号。
- 抽壳：`features/shell.ts` 只把 `FaceTopoRef` 写进 `cad.shell(part,{openFaces,...})` → 无面号运算。
- 两端产出同形态代码：用户实测的小程序代码（`origin:'s1'` / `role:'right'` / `hint`）就是 `FaceTopoRef` 字面量，正是规则三要求的跨内核形态；web 侧拿到正确行后产出的代码与之同形，因此两端 sceneCode 可互认、可换内核重跑。
- 全仓 `setFaceColor` 只出现在 `part-style-script.ts` 的 `APPEARANCE_CALLEES` 白名单（用于整组替换零件样式语句），**没有任何调用点** → 本轮"面号语义"变更对编辑器 UI 不可见。
- 小程序为什么对：`packages/weapp/src/viewer/face-pick.ts` 的 `pickFaceRow()` **故意不用"三角形序号 → 面行"表**（因为该表不可信），改用射线落点按几何归面（平面距离 → bbox → 面心距）。它是对 D2 的绕行补丁，不是另一套正解——绕开了缺陷，代价是每次拾取都要 O(面数) 打分，且在几何判据并列时会抛错。

结论：宿主如果要在自己这边"修"，只能自己维护"显示三角形 ↔ 面行"的映射——那正是规则一禁止的事，而且它拿不到内核序，做不到。所以修必须发生在 faijs。

### 3.5 实测：用户那段代码在 occt 与 brepkit 上**都能执行**，且去的都是 +X

把用户真机实测的那段小程序代码逐字拿来跑，两内核各自一个 runtime、用生产装配（`registerOcctBrepEngine()` / `registerBrepkitBrepEngine()` + `createRuntime(createNodePorts(), 'brep', undefined, { execBackend: 'interpreter' })`）：

| 内核 | 结果 | 证据 |
|---|---|---|
| occt | **通过** | 28 个三角形，signed volume = 2672 = 6000 − 8×16×26（腔体沿 +X 贯通）；x=10 处只剩 2mm 宽环面，x=0 的 −X 面面积 600 保留 → 去的确实是 `right`=+X |
| brepkit | **通过** | 逐项相同：28 个三角形、signed volume 2672、bbox `[0,0,0]–[10,20,30]` |

brepkit 上另外三个变体（同一 box 10×20×30）也全通：`openFaces: ">X"`（选择器）、`{origin:'s1', role:'right'}`（无 hint，vol 2672）、`{origin:'s1', role:'top'}`（vol 3312 = 6000 − 6×16×28，腔体沿 +Z 贯通）。即：**规则三要求的"换内核照样执行"当前已经成立**，面名角色在两侧对齐（brepkit 的 box 同样是 `left/right/front/back/top/bottom`，只是行序不同）——身份机制的方向本来就是对的，本方案不需要动它。

⚠️ **探针写法红线**（我第一次就踩了，直接导致误判出 D5）：复现时我调了 `configureBackends({ config: { mode: 'auto', brepEngineId: 'brepkit' }, kernel: { brep } })`——那句 `mode: 'auto'` **覆盖了** `createRuntime(ports, 'brep')` 要的模式，于是 `cad.box` 走 mesh 链，`shell` 在这条链上收到 `FaceTopoRef` 就报 `E_TOPO_NOT_FOUND`。换回生产装配（`mode: 'brep'`）后两个内核立刻都绿。

**教训**：cross-kernel 测试一律用生产装配（`registerXxxBrepEngine()` + `createRuntime`），不要额外 `configureBackends` 盖 `config`；非要注入内核时，`config.mode` 必须与 runtime 要的一致。P4 #5 的测试里把这条写成注释钉住。

### 3.6 附带发现（非本方案主线，但得修）：mesh 链收到 `FaceTopoRef` 时既不支持也不报清楚

`mode: 'auto'` 下 box 走 mesh 链，同一段代码（已复现）：

| 写法 | 结果 |
|---|---|
| `openFaces: ">X"` | 通过（mesh 链支持选择器） |
| `{origin:'s1', role:'right', hint:{...}}` | `E_TOPO_NOT_FOUND: topo ref (face) not found in the current shape` |
| `{origin:'s1', role:'top'}`（无 hint） | `E_OP_FAILED: Cannot read properties of undefined (reading 'surfaceType')` |

这是两个独立问题：① mesh 链（没有 role/命名层）拿不到 BREP 面表，`FaceTopoRef` 在当前链上**无法解析**，但错误文案说不清“这张面引用需要 BREP 链”；② 无 hint 时空引用崩——违反仓规“遇到异常直接报错并携带上下文，不准掩盖”，这条无论哪个模式都该修。处理见 P3 末尾。

---

## 4. 目标不变量（验收以此为准）

- **I0 身份单源（新增，来自规则三）**：面跨内核/跨执行的身份只能是 `FaceTopoRef{origin, role}`（`hint` 仅打分兜底，不当身份）；**数字面号只在本执行、本内核的内存里有效**，禁止写进 `.fai.js`/sceneCode、禁止持久化、禁止成为跨内核 API 的契约。
- **I1 一份 mesh**：一个 BREP part 在一次执行内只 `meshShape` 一次；拓扑必须由这份三角化结果构建（禁止"同参数再算一次"的等价性论证）。
- **I2 一个面号**：`faceIds`/`faceRanges` 下标 / `faceRuns.faceRow` / 拓扑面表行号 / 命名数组下标，是**同一个数**，不允许存在第二套编号。
- **I3 自洽**：对任意面行 r，其 `(triangleStart, triangleCount)` 覆盖的三角形，其面积、质心、法向必须等于该行自己记录的 `area/center/normal`（容差内）。
- **I4 完备且不重叠**：所有面行的三角形区间两两不重叠，并集 = 显示 mesh 的全部三角形（无面结构者除外，显式标注）。
- **I5 方向与身份不靠数字**：方向/位置语义只由 `role`（`semantic` 命名器）与选择器（`">Z"`/`"|Z"`）表达。数字面号**既不承诺方向，也永不承诺跨内核/跨路径一致**——这不是"暂时没做到"，而是规则三给出的结论（内核枚举序不可移植），因此 faijs 代码不得以"数字一致"为前提写任何逻辑。
- **I6 破坏即报错**：任一不变量被破坏时抛 `E_TOPO_FACE_MESH_MISMATCH`（新错误码），禁止静默返回错数据或静默降级。
- **I7 宿主只消费**：faijs 保证 I1–I6 后，宿主（web/weapp）只做"查表 → 用"，不得维护第二套映射；宿主发现不一致时的正确行为是 fail-fast，不是自算。

---

## 5. 已裁决事项与仍需拍板

### 5.1 已由用户裁决（不再列为选项）

- **跨内核身份是 `FaceTopoRef`，数字面号不可能跨内核**（规则三）。因此本方案**不再考虑"排序面表让数字跨内核可复现"的规范序方案**：数字面号的唯一合法语义就是"本次执行、本内核的面表行号"，排序只会换一个不可移植的号，不产生任何可移植能力。
- **faijs 代码要尽量避免数字序号**。这使 P3 的"数字序号退出对外面"从可选项变成必做项，并要求逐项核查现有 API。

### 5.2 仍需拍板

**裁决点 A′：`setFaceColor` 的数字入参怎么处理？** 现签名 `setFaceColor(faces: number[], color)`，是 faijs 里仅存的"对外用数字面号"的 API。三个选项：

1. 只扩充不收窄：新增 `setFaceColor(faces: Array<FaceTopoRef | string>, color)`（`">Z"`/`"|Z"` 选择器 + 角色引用），`number[]` 保留，JSDoc 与手册明写"数字仅当次执行有效、不可跨内核/不可写进代码"。← **推荐**（零破坏，脚本有一条正当出口）
2. 收窄：`number[]` 改为内部（不对外），对外只收 `FaceTopoRef | selector`。破坏性，仓内 fixtures 需同步。
3. 不收窄不改：保持现状，只在文档里标风险。← 不推荐（等于把"用了不可移植身份"的陷阱留在对外 API 上）

**裁决点 B：不变量被破坏时的行为** —— 抛错（推荐，符合 I6）还是返回 `undefined` 让宿主自己决定。

**裁决点 C：mesh 路径（无 role 层的网格链）怎么处理数字序号？** 现状：`shell` 在网格链上只接受 1 起序号。根据规则三，建议：数字序号保留为"本内核快照内"的逃逸口，但在文档里与 `setFaceColor` 同一口径标注；同时把 `FaceTopoRef` 的几何匹配（法向/中心/面积）作为网格链的推荐形态（已实现，见 `resolveMeshFaces`）。是否要在脚本面彻底禁止数字序号，需要拍板（会影响 `load` 3MF/STL 类网格零件的用法）。

---

## 6. 方案（分阶段，每阶段可独立合入）

### P0 契约落纸（无代码行为变化）

1. `docs/api-contract.md` 新增一节「面身份与面号」，写入 I0–I7，并明确规定：
   - **跨内核/跨执行身份 = `FaceTopoRef{origin, role}`**（`hint` 仅打分兜底）；数字面号**不是身份**；
   - 面号 = faijs 拓扑面表行号，`faceRanges` 是它的派生物（同一序）；数字面号不承诺方向、不承诺跨内核；
   - 禁止任何实现把"某个第三方库的三角形生成顺序"当契约依据；
   - 禁止把数字面号写进 `.fai.js`/sceneCode/任何持久化数据。
2. 删除/改写三处误导性注释：`mesh/primitives.ts`（"面序号契约 0=+X…"）、`mesh/meshdata/parametric.ts` 文件头（"改动循环顺序 = 改变面序契约"）、`api/primitives.ts`（"按面法线重排 indices 到契约序"）。
3. `docs/ops-api-inventory.md` 更新 `setFaceColor` / `shell.openFaces`：两者统一口径——**推荐与唯一可移植的写法是 FaceTopoRef / 选择器**；数字序号标注"仅当次执行、本内核有效"。

### P1 删掉 box 重排（单点修复用户可见 bug）

`packages/core/src/api/primitives.ts`：

- 删除 `faceNormalAxis()` 与 `brepPrimitiveMesh()` 里 `op === 'box'` 的 `byContract` 重排分支；
- `brepPrimitiveMesh()` 统一按"面分组 → `faceRanges`（直接取 `faceGroups` 的 `triStart/triCount`）"透传，**不改 `indices`**；
- box/cylinder/cone 走同一条代码路径（消除特例）。

完成后：面表行 r 的 `triangleStart` 与 `faceRanges[r]` 同源同序，I2/I3 对 box 成立，抽壳方向随之正确（因为"点顶面 → 行 5 = +Z → `role:'top'`"）。这一步同时让 **web 侧生成的代码回到用户实测的小程序形态**：`{kind:'face', origin:'s1', role:'top', hint:{...}}`，无面序号、可跨内核执行。

### P2 让"一份 mesh"真正生效（I1）

1. `Shape` 新增内部字段（非枚举、不序列化、不进 JSON）：`brepTess?: BrepMeshResult`（positions/indices/normals/faceGroups 全量），由三角化入口写入。
2. 三角化入口收敛为一个函数（建议在 `brep/brep-ops.ts` 旁新增 `tessellateBrep(solid, params)`，`solidToShape` 改为它的薄包装），所有 BREP op 一律走它；禁止在 `src/api/**` 直接调 `kernel.meshShape`（加一条 grep 门禁）。
3. 在 `direct-executor.ts` 同步 `solidCache` 的同一处（L688/L706：`setSolidHook(partName, solid)` 的调用点，此处同时握有 ctx 里的 shape）把 `shape.brepTess` 写入 `brepChain.meshShapeCache[partName]`（`setSolidHook` 本身只带 partName+solid，需要扩一个可选 shape 参数或新增 `setTessHook`）；`buildBrepTopology` 因此 100% 命中，`buildSolidTopologyRuntime` 退化为"没有显示 mesh 的路径"（导入/装配合并等）的兜底，且其参数改为从 `runtime-state.getTessellation()` 取，不再硬编码 `2π/32`。
4. 兜底路径加计数断言日志（仅测试可见）：任何"显示过又二次三角化"的 part 必须在测试里被捕获（见 P4 INV-3）。

### P3 让数字序号退出 faijs 对外面（规则三落地，必做）

先逐项盘点，再按清单收敛（估算：faijs 目前只有一处真正对外用数字面号）：

| 位置 | 现状 | 处置 |
|---|---|---|
| `api/shell.ts` `expandShellFaceRefs()` | 精度链数字序号**直接抛错**，注释明写"序号跨内核不可移植" | 已合规，作为全库范式（保留） |
| `api/appearance.ts` `setFaceColor(faces: number[])` / `mergeFaceAppearance()` | **唯一对外数字面号 API** | 按裁决点 A′ 处理；JSDoc/错误文案改为"数字 = 当次执行的面表行号" |
| `api/internal/mesh-solid-op.ts` `resolveMeshFaces()` | 网格链 1 起序号（仅网格链） | 保留为逃逸口，文档标注"仅本内核快照"；推荐形态改为 FaceTopoRef 几何匹配 |
| `topology/build-face-ids.ts` 产出的 `faceIds` | 运行时送给 mesh 的**派生下标数组** | 不是身份，加注释+断言，禁止持久化 |

具体动作：

- `topology/build-face-ids.ts`：加运行期断言——`runs[i].triangleStart + triangleCount <= indices/3` 且与 `faceRanges` 一致（不一致抛 `E_TOPO_FACE_MESH_MISMATCH`）。这是 I6 的落地位置（最低成本、覆盖所有宿主）。
- `api/appearance.ts`：若 A′ 选 1，新增 `FaceTopoRef[] | string[]` 入参通道，内部先 `resolveSelectorToFaceRefs`/`resolveTopoRef` 定位到面 → 行号 → 区间；`number[]` 保留但文档降级。
- 加一条静态门禁（脚本或 lint 规则）：`src/api/**` 对外入口的参数类型里不得新增 `faces: number[]` 形态；现有项进白名单并附理由。
- **mesh 链收到 `FaceTopoRef` 的三种形态必须说清楚（§3.6）**：① 有 hint 时要么按几何（法向/中心/面积）匹配到面，要么报 `E_FACE_REF_NEEDS_BREP_CHAIN`（带 callee / part / ref）而不是现在的 `E_TOPO_NOT_FOUND`；② 无 hint 时禁止空引用崩溃，`hint` 缺失必须是显式分支（报“该面引用缺少几何提示，无法在 mesh 链上定位”）；③ 禁止 try/catch 吞掉后静默选一张面——那是掩盖错误。

### P4 不变量测试（常驻，可重复跑；按仓规必须落成 `*.test.ts`）

1. `packages/core/test/topology/face-mesh-alignment.test.ts` —— I2/I3/I4：
   - 矩阵：{occt, brepkit} × {mesh 路径, brep 路径} × {box, cylinder, cone, sphere, wedge, 布尔结果, STEP 导入}；
   - 每个面行用**显示 mesh** 的 positions/indices 现场算面积/质心/法向，与行数据比对（这是唯一能抓住 D2 的断言）；
   - 现有的 `face-group-units.test.ts` 保留，并补一条"行区间 ↔ 行自身几何"。
2. `packages/core/test/api/shell-open-face-direction.test.ts` —— 抽壳方向回归：
   - `shell(box,{openFaces:">Z"})` 与 `shell(box,{openFaces:[该 part 命名中 role='top' 的行的 FaceTopoRef]})` 的 bbox/体积必须相同；
   - 断结果缺口确实在 +Z（bbox 上界少一层 thickness）；
   - 四个组合（mesh/brep × occt/brepkit）全跑。
3. `packages/core/test/brep/mesh-single-tessellation.test.ts` —— I1：对 `kernel.meshShape` 打 spy，断言每个 BREP part 每次执行只调用 1 次，且 `buildBrepTopology` 命中缓存。
4. `packages/core/test/api/face-color-numbering.test.ts` —— `setFaceColor`：数值面号命中的三角形区间 == 面表行区间；`FaceTopoRef`/选择器形态与数值形态对同一面等价（若 A′ 选 1）。
5. `packages/tests/faijs/shell/cross-kernel-portability.test.ts` —— **用户实测代码逐字入测**（回归钉子：当前已通过，用于防止 P1 改动把它弄坏）：把小程序端产出的那段代码原样作为 `.fai.js` fixture（含 `origin:'s1'` / `role:'right'` / `hint{normal:[1,0,0], area:600, center:[10,10,15]}`）在 occt 与 brepkit 上各跑一次，断言：两边都能执行（无 `E_TOPO_NOT_FOUND`）、被移除的是 +X 面（抽壳后 x 上界少 `thickness`）、两边产物体积/bbox 在容差内相等。—— 这条测试同时钉住"web 与 weapp 生成同形态代码"与"代码里无面序号"两个事实。
6. `packages/core/test/topology/face-toporef-stability.test.ts` —— 身份稳定性：同一段脚本（box/shell）在 occt 与 brepkit 下拾取同一张几何面，产出的 `FaceTopoRef` 必须**逐字相同**（origin/role 相同，hint 可在容差内）；反向断言：数字面号可以不同（且测试里**不应**断言相同，防止把"数字跨内核"写回成契约）。
7. 3d_editor（另一仓）加一条消费侧断言测试：`buildFaceIdsForPart` 输出的 faceIds 覆盖的三角形区间必须等于 faijs `faceRuns` 的区间，不等即 fail-fast（**不许自算映射**）。
8. `packages/core/test/api/mesh-chain-face-ref.test.ts` —— §3.6：`mode:'auto'`（mesh 链）下 `openFaces` 传 `FaceTopoRef`（有/无 hint 两形态），断言拿到的是带上下文的明确错误（而非空引用崩溃或模糊的 `E_TOPO_NOT_FOUND`）；只有 hint 不匹配同一 `role` 多张面时才允许走打分兜底。

### P5 文档、笔记、跨仓发布

1. `.agents/notes/` 新增 Agent Note：记录"为什么不把 three.js 三角形顺序当契约"、"meshShapeCache 形同虚设的发现"两个决策。
2. `docs/api-contract.md` / `docs/ops-api-inventory.md` / `docs/library-dev-guide.md` 同步（一个事实一个家：面号定义只在 api-contract）。
3. 版本：`npm run set-version -- <x.y.z>` → `node scripts/check-lockstep.mjs`（禁止手改任何版本号）。
4. `npm run pack` 出包 → 3d_editor 走既有 `update-faijs` 流程升级 → web 端手测"点顶面 → 顶面消失"，weapp 复测不回归。
5. 本方案落地后，回填本文档状态为"已落地"，并记录实测数字。

---

## 7. 行为变更与影响面

- **修复后用户可见**：web 抽壳点哪个面就开哪个面（与小程序一致）；web 产出的代码形态与用户实测的小程序代码同形（`FaceTopoRef`，无面序号），换内核可执行。
- **box 数字面号**：0..5 = 内核枚举序（−X,+X,−Y,+Y,−Z,+Z）；此前 `setFaceColor` 文档宣称的 +X,−X,+Y,−Y,+Z,−Z 作废。存量 `.fai.js` 若硬编码了数字面号，需改为 `FaceTopoRef`/选择器（仓内检索 `grep -rn "setFaceColor"` 于 fixtures 与 demo，逐条核对）。3d_editor 不产生 `setFaceColor` 调用，UI 无变化。
- **cylinder/cone 数字面号**：不变（仍为侧面/顶/底的内核序），与 P1 前一致。
- **拓扑面行 `id`**（`o1.fN`）：不变（面表行序不动；本方案不引入任何排序）。
- **抽壳脚本形态不变**：小程序端已产出 `FaceTopoRef`（用户实测），web 修复后与之一致；两端 `sceneCode` 可互认，且**继续跨内核可执行**。
- **性能**：BREP 拓扑不再二次三角化，单次执行三角化次数约减半（大装配收益更明显）。
- **weapp 的 `pickFaceRow`**：保留（更健壮），但从"必需"降为"可选"；注释里"面序表不可信"的理由需更新为历史原因。

---

## 8. 风险与回退

| 风险 | 说明 | 处置 |
|---|---|---|
| 存量脚本依赖数字面号 | 数字含义变化 | P0 文档明示 + 仓内 fixtures 全检索 + `setFaceColor` 的 `FaceTopoRef`/选择器通道提供迁移路径 |
| `brepTess` 跨 op 失效 | 变换类 op 会换 solid、须重新三角化 | 缓存键用 partName，`runtime.ts` 已有的 `deleteTopology`/缓存清理点一并删键（已有逻辑，补测试） |
| 断言误伤导入/装配路径 | 这些路径本无"显示 mesh 同源" | 断言只在 `source === 'brep' && 有 brepTess` 时生效；兜底路径显式标 `source:'brep'(fallback)` 并在测试里单列 |
| 双内核断言语义差异 | brepkit 面枚举序可能不同 | 断言只比较"行 ↔ 自身几何"，不比较跨内核行号；身份一致性另用 FaceTopoRef 断言（P4 #6） |

回退：P1/P2 各自独立、无对外签名变化，可单独 revert；P3 的选择器形态为纯增量，可单独关闭。

---

## 9. 验收标准

1. `face-mesh-alignment` 测试全绿：所有矩阵组合下 I2/I3/I4 成立。
2. **跨内核可执行**（用户实测代码逐字入测）：同一段含 `FaceTopoRef` 的抽壳代码在 occt 与 brepkit 上都能执行，去的是同一张几何面，产物体积/bbox 在容差内相等。
3. `shell-open-face-direction` 四组合全绿：点顶面 → 顶面消失；`">Z"` 与 `role:'top'` 的 FaceTopoRef 结果一致。
4. `face-toporef-stability` 全绿：同一张几何面在两内核上产出逐字相同的 `FaceTopoRef`。
5. `mesh-single-tessellation` 全绿：每 part 每次执行 1 次 `meshShape`，拓扑命中缓存。
6. `docs/api-contract.md` 有面身份条款（含 I0 与"面号不得写进代码"）；三处误导注释消失；`docs/ops-api-inventory.md` 已更新。
7. 定向测试通过后才跑一次 `pwsh -NoProfile scripts/ci.ps1`，全绿；`npx madge --circular packages/*/src` 无新增环。
8. 3d_editor web 手测：抽壳点顶面 → 顶面消失；点侧面 → 侧面消失；小程序无回归；两端生成的抽壳代码形态一致（无面序号）。
9. 全仓 `grep -rn "契约序\|face 序号契约\|BoxGeometry.*顺序" packages/core/src` 无残留。

---

## 10. 不在本方案范围内

- 不改 `shell` 的语义（厚度方向、内腔规则）。
- 不重做命名/role 体系（`assignRoles` 的判向逻辑经实测正确，`role:'top'` 与 `">Z"` 指纹逐字相同）。
- 不动 `three-162`（它只是测试里的 parity oracle，属 `devDependencies`；运行时 core 不依赖 three）。
- 不改 weapp 的几何归面拾取（可选优化另开）。
- 不涉及 3d_editor 的业务代码（除一条消费侧断言测试）。
---

## 11. 实施记录（2026-10-21）

版本：faijs **0.36.13**（`set-version` → `check-lockstep` → `pack`）；3d_editor 已 `update-faijs` 到位。

### P1（删 box 重排）— 已落地

`api/primitives.ts`：删除 `faceNormalAxis()` 与 `brepPrimitiveMesh()` 里 `op === 'box'` 的 `byContract` 重排分支；
box/cylinder/cone 走同一条路径——faceRanges **直接取** `meshShape` 的 `faceGroups`（索引单位 /3 → 三角形单位），
**不改 `indices`**。面表行区间与显示 mesh 因此同源同序。

### P2（一份 mesh）— 已落地（改用 Symbol 槽，非 Shape 可枚举字段）

- `mesh/types.ts`：新增 `BREP_TESS = Symbol('faijs.brepTess')` 及 Shape 的 `[BREP_TESS]?` 槽。
  用 Symbol 的理由：对象展开会带（own enumerable symbol 被 CopyDataProperties 复制，所以 `solid(mesh)` 的 `{...mesh}` 天然带上），
  而 `JSON.stringify` / `structuredClone` / `Object.keys` 都看不到它——不需要在输出前手动剥离，也不会跨 worker 传体积。
- `brep/brep-ops.ts::solidToShape`：把这份三角化结果（positions/indices 与返回 Shape **共用同一引用**，normals/faceGroups 拷贝一份）挂到 `BREP_TESS`；
  **删除**了原来按 5th 参数（`stmtId`）写 `meshShapeCache` 的代码——那是 D3 的错键来源（写用 `stmtId`，读用 `PartName`，恒 miss）。
- `cad-runtime/direct-executor.ts`：`setSolid` 钩子增第三参 `shape`，两处调用点透传 ctx 里的 shape。
- `cad-runtime/runtime.ts`：新增私有 `setSolidAndTess()`（两处注入统一调用）——写 `solidCache`，并从 shape 的 `BREP_TESS` 写 `meshShapeCache`（键=`PartName`）；
  shape 无该槽（变换类 op / 导入存活对象）时**删键**，让 `buildBrepTopology` 回退兜底三角化，避免"新 solid + 旧 mesh"错配。
- `loadBrep` 的 `brepChain` / `stmtId` 死参数一并删除（两个调用点本就传 `undefined, undefined`）。

### P3（数字序号退出对外面 / 报错清晰化）— 部分落地

- `topology/build-face-ids.ts`：`buildFaceIdsForPart` 的越界从**静默 clamp** 改为抛 `E_TOPO_FACE_MESH_MISMATCH`（I6 落地位置，覆盖所有宿主）。
  同步改了 `packages/core/test/topology/build-face-ids.test.ts`：原"自定义列序"用例用的是一条越界数据（靠 clamp 通过），现改为合法数据 + 新增越界抛错用例。
- `topology/naming/resolve-face.ts` + `resolver.ts` + `types.ts`：`FaceTopoRef.hint` 在脚本面是运行期可选的，几何兜底路径原先会空引用崩溃
  （`Cannot read properties of undefined (reading 'surfaceType')`）。现在 hint 缺失时返回显式三态 `no-hint`，并由 `buildTopoError` 给出
  "缺少几何提示、需要 role 层"的文案（§3.6 ②）。
- 三处误导注释改写：`mesh/primitives.ts`（3 处"面序号契约"）、`mesh/meshdata/parametric.ts` 文件头、`api/primitives.ts`（P1 时随代码删除）。
- `docs/api-contract.md` 新增 **§11.2 Face identity and face numbering**（I0–I7 + "第三方三角形顺序不是契约" + "无 role 层链的解析语义"）。

**仍未做（超出本次修复范围，需另行拍板）**：裁决点 A′——`api/appearance.ts::setFaceColor(faces: number[])` 未扩充 `FaceTopoRef|selector` 入参通道，
仅按 I0 把数字入参的语义降级为"当次执行、本内核有效"。另：§3.6 ① 期望的新错误码 `E_FACE_REF_NEEDS_BREP_CHAIN` 未新增，
mesh 链的几何不匹配仍报 `E_TOPO_NOT_FOUND`（文案已含 "approximate topology has no role layer"）。

### P4（常驻测试）— 已落地

新增（`packages/tests/faijs/shell/`）：

- `face-mesh-alignment.test.ts` —— I2/I3：box/cylinder/cone 每个面行区间用**显示 mesh 现场算**的面积/质心/法向与该行自记值比对（唯一能抓 D2 的断言）。
- `shell-open-face-direction.test.ts` —— occt：`">X"` 与 `role:'right'` 都开 +X（x=10 端面只剩 184 的边界环），`role:'left'` 开 −X（x=0 只剩环）。
- `cross-kernel-portability.test.ts` —— 用户实测代码**逐字**在 occt 与 brepkit 上各跑一次：都执行、都开 +X、role 逐字相同（`'right'`）。
- `mesh-single-tessellation.test.ts` —— 对内核 `meshShape` 打 spy：box 单语句 1 次、`cylinder(segments:16)` 1 次、box+shell 2 次。
- `mesh-chain-face-ref.test.ts` —— 无 role 层 + FaceTopoRef：hint 缺失返回 `no-hint` 而非 TypeError；有 hint 则几何唯一匹配成功 / 不匹配明确 not-found。

3d_editor 新增（`packages/app/src/engine/__tests__/`）：

- `face-mesh-consumption.test.ts` —— 宿主只消费：`buildFaceIdsForPart` 的区间与 faijs `faceRuns` 一致、6 面行、12 三角形全覆盖。
- `shell-direction-host-chain.test.ts` —— 宿主真实链路：box → `naming.faceNaming` → `captureTopoRef` → 写进 `cad.shell` 代码 → 执行 → 开的是 +Z 顶面。

### 验证结果

| 层 | 结果 |
|---|---|
| faijs `tsc --noEmit` / `npm run lint` | 通过 |
| faijs core 单测（364 文件 / 3961 例） | 全绿 |
| faijs 集成测试（`packages/tests`，除 parity 76 文件 / 683 例） | 全绿 |
| faijs parity（12 例） | 全绿 |
| 3d_editor `lint` / `tsc --noEmit` / `build` | 通过 |
| 3d_editor 单测 | 4810 通过，**1 例既有失败**（`sketch-draft.test.ts` slot 手柄，见下） |
| 3d_editor e2e `cylinder-face-selection` + `sketch-extrude-topo-select` | 7 例全绿 |

**既有失败（非本次改动引入）**：`packages/app/src/stores/tools/sketch-draft.test.ts:242` 期望 slot 形状只有 `['center']` 手柄，
实得 `['center','vertex','vertex']`。该用例断言的是草图手柄（`sketch-draft.ts` → `@faicad/faijs/sketch`），与面身份/拓扑/抽壳无关；
失败原因是 faijs 工作区中**既有的** sketch 改动（随 0.36.13 tarball 一并进入 3d_editor），需在草图口径上单独对齐，不在本方案范围。
