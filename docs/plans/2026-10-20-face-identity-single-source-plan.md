# 面身份单源化：拓扑面表 / 显示 mesh / 面号三者对齐（2026-10-20）

- 状态：方案（未实施）
- 产出来源：web 版抽壳"方向反了"的根因追查（faijs 侧）
- 涉及仓库：`faijs`（修复方，全部代码改动在此）、`3d_editor`（消费方，预期零改码）

---

## 1. 用户原话（逐字）

> 分析../3d_editor项目，为何网页版本的抽壳命令，抽壳的方向反了。我点击哪个面，应该就是那个面消失，被抽壳啊。小程序端是正确的。

> 没看懂你写的内容。我的要求很简单，拓扑数据必须来自faijs，3d_3ditor不准自己写拓扑；而且拓扑数据必须和显示拾取时的mesh必须一一对应。你参照这两条要求。给我分析到底谁的问题

> setFaceColor 的面序契约（0=+X,1=−X,2=+Y,3=−Y,4=+Z,5=−Z）成立？这是什么意思？

> 到底什么意思，你没讲清楚。setFaceColor 的面序契约（0=+X,1=−X,2=+Y,3=−Y,4=+Z,5=−Z），到底是谁规定的

> 这完全是错误的东西啊。faijs彻底剥离了three.js，而且这明显和我定的规则冲突。你写一份完整的开发计划文档，把这个问题彻底修复。

两条硬规则（本方案的第一性判据，来自用户第二段原话）：

- **规则一**：拓扑数据必须来自 faijs；3d_editor 不准自己写拓扑。
- **规则二**：拓扑数据必须与显示、拾取时的 mesh 一一对应。

---

## 2. 结论

一句话：**问题全部在 faijs。** 3d_editor 只是把 faijs 给出的"面行号"原样传递，它没有任何造拓扑或改面号的代码；出错的是 faijs 在数据离开引擎之前，就把"显示 mesh 的三角形顺序"和"拓扑面表的行序"做成了两个互不相干的东西，并且把前者锚定在 three.js 的三角形生成顺序上——这既违反规则二，也和"faijs 已彻底剥离 three.js"的定位冲突。

具体是四个缺陷叠加，其中 D1/D2 直接造成抽壳方向反：

| 编号 | 缺陷 | 后果 |
|---|---|---|
| D1 | **面号双源**：`Shape.faceRanges` 的下标（= `setFaceColor` 的 faceIds）按"契约序 +X/−X/+Y/−Y/+Z/−Z"，而拓扑面表行号/`faceRuns.faceRow`/命名行号按内核枚举序 −X/+X/−Y/+Y/−Z/+Z | box 的两套编号成对对调；同一个数在两套体系里指不同的面 |
| D2 | **box 只重排了显示 mesh，没重排拓扑面表**：`api/primitives.ts` 在 BREP 路径把三角形的 `indices` 整块重排到契约序，但拓扑面表仍按内核枚举序、`faceRuns.triStart` 仍是重排前的位置 | 面行 4 的数据是 −Z（命名 `bottom`），它的 `triangleStart` 却指向显示 mesh 里 +Z 的那两个三角形 → 点顶面得到 `role:'bottom'` → 抽壳开底面 |
| D3 | **"一份 mesh"只写在注释里**：`brepChain.meshShapeCache` 在生产路径上**从未被写入**（全仓只有 `brep-ops.ts:79` 一处 `set`，而唯一能传 `brepChain` 的 `loadBrep` 调用点都传 `undefined`），`buildBrepTopology` 恒 miss → 拓扑永远做第二次 `meshShape`，且参数是硬编码 `2π/32`，与显示侧的 `segments → 2π/segments` 不是同一个表达式 | faijs 自述的"规则 1"从未真正执行；曲线面（圆柱/圆锥/球）随时可能因两次三角化不一致而错位，只是当前参数下恰好收敛到同一结果 |
| D4 | **契约出处错误**：面号语义的三层出处是「three.js `BoxGeometry` 的顶点/索引循环顺序」→「`mesh/meshdata/parametric.ts` 的 vendored 移植（注释明写"改动循环顺序 = 改变面序契约"）」→「`mesh/primitives.ts` 里硬编码的 6 个 `{start,count}`」 | 一个已经和 three.js 无关的引擎，把第三方库的循环顺序当成对外 API 契约；且 `docs/api-contract.md` 里**没有**任何条款承认它，契约只存在于注释 |

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
- 全仓 `setFaceColor` 只出现在 `part-style-script.ts` 的 `APPEARANCE_CALLEES` 白名单（用于整组替换零件样式语句），**没有任何调用点** → 本轮"面号语义"变更对编辑器 UI 不可见。
- 小程序为什么对：`packages/weapp/src/viewer/face-pick.ts` 的 `pickFaceRow()` **故意不用"三角形序号 → 面行"表**（因为该表不可信），改用射线落点按几何归面（平面距离 → bbox → 面心距）。它是对 D2 的绕行补丁，不是另一套正解——绕开了缺陷，代价是每次拾取都要 O(面数) 打分，且在几何判据并列时会抛错。

结论：宿主如果要在自己这边"修"，只能自己维护"显示三角形 ↔ 面行"的映射——那正是规则一禁止的事，而且它拿不到内核序，做不到。所以修必须发生在 faijs。

---

## 4. 目标不变量（验收以此为准）

- **I1 一份 mesh**：一个 BREP part 在一次执行内只 `meshShape` 一次；拓扑必须由这份三角化结果构建（禁止"同参数再算一次"的等价性论证）。
- **I2 一个面号**：`faceIds`/`faceRanges` 下标 / `faceRuns.faceRow` / 拓扑面表行号 / 命名数组下标，是**同一个数**，不允许存在第二套编号。
- **I3 自洽**：对任意面行 r，其 `(triangleStart, triangleCount)` 覆盖的三角形，其面积、质心、法向必须等于该行自己记录的 `area/center/normal`（容差内）。
- **I4 完备且不重叠**：所有面行的三角形区间两两不重叠，并集 = 显示 mesh 的全部三角形（无面结构者除外，显式标注）。
- **I5 方向不靠数字**：方向/位置语义只由 `role`（`semantic` 命名器）与选择器（`">Z"`/`"|Z"`）表达；数字面号**不承诺**方向，也不承诺跨内核一致（除非裁决点 A 选"规范序"，见 §5）。
- **I6 破坏即报错**：任一不变量被破坏时抛 `E_TOPO_FACE_MESH_MISMATCH`（新错误码），禁止静默返回错数据或静默降级。
- **I7 宿主只消费**：faijs 保证 I1–I6 后，宿主（web/weapp）只做"查表 → 用"，不得维护第二套映射；宿主发现不一致时的正确行为是 fail-fast，不是自算。

---

## 5. 裁决点（需要用户拍板）

**裁决点 A：数字面号要不要跨内核/跨路径稳定？**

| | 方案 A：内核枚举序（诚实最小） | 方案 B：faijs 规范序（排序面表） |
|---|---|---|
| 定义 | 面号 = 面表行号 = 内核 `getSubShapes(shape,'face')` 序 | 面号 = 面表行号，但面表在 `topologyExt` 一处按**面自身几何键**排序后编号 |
| 跨 occt / brepkit | 不保证同号同面 | 可复现（键只用面自身不变量） |
| 跨 STEP 往返 | 不保证 | 可复现 |
| 跨 mesh / brep 路径 | 不保证 | 可复现（前提：mesh 路径也由同一规范化函数产面结构） |
| 代码量 | 小（删重排 + 加断言） | 中（排序面表 + 排序 faceEdge/edgeFace 关系 + 命名改绑 + mesh 路径改造 + 一致性测试矩阵） |
| 对存量脚本 | box/cylinder 现有数字的含义按内核序重排；`setFaceColor(4)` 在 brep 下从"+Z 位置"变"−Z 位置" | 可把规范键定义为"法向主轴 X→Y→Z、同轴正号在前"，则 box 的 0..5 恰好仍是 +X,−X,+Y,−Y,+Z,−Z；但 **cylinder 会变**（平面面排到前面 → 顶/底/侧面 vs 侧面/顶/底） |
| 推荐 | **默认采用** | 作为后续增强（若确实需要跨引擎稳定面号再做，届时单独出方案） |

推荐理由：用户规则只要求"来自 faijs + 与显示 mesh 一一对应"，不要求跨内核同号；而任何"规范序"都必然改掉一部分既有数字的含义（对圆柱类尤其明显），收益是脚本可移植性——这是一个独立的产品决策，不该和"修 bug"捆绑。方案 A 同时把"D4 three 契约"彻底删除，符合用户"faijs 已剥离 three.js"的定位。

**裁决点 B：`setFaceColor` 是否增加选择器入参形态？** 现签名只收 `number[]`。建议追加 `string[]`（`">Z"`、`"|Z"`、`"top"`），内部走已有 `resolveSelectorToFaceRefs`；数字形态保留、文档降级为"引擎本地行号"。这样脚本要稳定语义时有一条正当出口，不必依赖数字。

**裁决点 C：不变量被破坏时的行为** —— 抛错（推荐，符合 I6）还是返回 `undefined` 让宿主自己决定。

**裁决点 D：mesh 路径是否同步改造** —— box 的 mesh 路径目前由 three 移植体生成 + 硬编码 `faceRanges`。改造后由生成器直出面分组，`faceRanges` 统一由一个函数导出（推荐，否则"一个面号"只在 brep 侧成立）。

---

## 6. 方案（分阶段，每阶段可独立合入）

### P0 契约落纸（无代码行为变化）

1. `docs/api-contract.md` 新增一节「面身份与面号」，写入 I1–I7，并明确规定：
   - 面号 = faijs 拓扑面表行号；`faceRanges` 是它的派生物（同一序）；
   - **数字面号不承诺方向**，方向语义看 `role`/选择器；
   - 禁止任何实现把"某个第三方库的三角形生成顺序"当契约依据。
2. 删除/改写三处误导性注释：`mesh/primitives.ts`（"面序号契约 0=+X…"）、`mesh/meshdata/parametric.ts` 文件头（"改动循环顺序 = 改变面序契约"）、`api/primitives.ts`（"按面法线重排 indices 到契约序"）。
3. `docs/ops-api-inventory.md` 更新 `setFaceColor` / `shell.openFaces` 的面号与选择器说明。

### P1 删掉 box 重排（单点修复用户可见 bug）

`packages/core/src/api/primitives.ts`：

- 删除 `faceNormalAxis()` 与 `brepPrimitiveMesh()` 里 `op === 'box'` 的 `byContract` 重排分支；
- `brepPrimitiveMesh()` 统一按"面分组 → `faceRanges`（直接取 `faceGroups` 的 `triStart/triCount`）"透传，**不改 `indices`**；
- box/cylinder/cone 走同一条代码路径（消除特例）。

完成后：面表行 r 的 `triangleStart` 与 `faceRanges[r]` 同源同序，I2/I3 对 box 成立，抽壳方向随之正确（因为"点顶面 → 行 5 = +Z → `role:'top'`"）。

### P2 让"一份 mesh"真正生效（I1）

1. `Shape` 新增内部字段（非枚举、不序列化、不进 JSON）：`brepTess?: BrepMeshResult`（positions/indices/normals/faceGroups 全量），由三角化入口写入。
2. 三角化入口收敛为一个函数（建议在 `brep/brep-ops.ts` 旁新增 `tessellateBrep(solid, params)`，`solidToShape` 改为它的薄包装），所有 BREP op 一律走它；禁止在 `src/api/**` 直接调 `kernel.meshShape`（加一条 grep 门禁）。
3. 在 `direct-executor.ts` 同步 `solidCache` 的同一处（L688/L706：`setSolidHook(partName, solid)` 的调用点，此处同时握有 ctx 里的 shape）把 `shape.brepTess` 写入 `brepChain.meshShapeCache[partName]`（`setSolidHook` 本身只带 partName+solid，需要扩一个可选 shape 参数或新增 `setTessHook`）；`buildBrepTopology` 因此 100% 命中，`buildSolidTopologyRuntime` 退化为"没有显示 mesh 的路径"（导入/装配合并等）的兜底，且其参数改为从 `runtime-state.getTessellation()` 取，不再硬编码 `2π/32`。
4. 兜底路径加计数断言日志（仅测试可见）：任何"显示过又二次三角化"的 part 必须在测试里被捕获（见 P4 INV-3）。

### P3 面号消费面收敛（配合裁决点 B）

- `api/appearance.ts` `mergeFaceAppearance()`：注释与错误信息改为"面号 = 面表行号"；新增 `string[]` 形态（若裁决点 B 通过），内部先解析成 FaceTopoRef 再映射行号。
- `api/shell.ts`：`openFaces` 已收 selector/FaceTopoRef/序号，无需改；补充"序号 = 面表行号"的 JSDoc。
- `topology/build-face-ids.ts`：加运行期断言——`runs[i].triangleStart + triangleCount <= indices/3` 且与 `faceRanges` 一致（不一致抛 `E_TOPO_FACE_MESH_MISMATCH`）。这是 I6 的落地位置（最低成本、覆盖所有宿主）。

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
4. `packages/core/test/api/face-color-numbering.test.ts` —— `setFaceColor`：数值面号命中的三角形区间 == 面表行区间；选择器形态与数值形态对同一面等价（若裁决点 B 通过）。
5. 3d_editor（另一仓）加一条消费侧断言测试：`buildFaceIdsForPart` 输出的 faceIds 覆盖的三角形区间必须等于 faijs `faceRuns` 的区间，不等即 fail-fast（**不许自算映射**）。

### P5 文档、笔记、跨仓发布

1. `.agents/notes/` 新增 Agent Note：记录"为什么不把 three.js 三角形顺序当契约"、"meshShapeCache 形同虚设的发现"两个决策。
2. `docs/api-contract.md` / `docs/ops-api-inventory.md` / `docs/library-dev-guide.md` 同步（一个事实一个家：面号定义只在 api-contract）。
3. 版本：`npm run set-version -- <x.y.z>` → `node scripts/check-lockstep.mjs`（禁止手改任何版本号）。
4. `npm run pack` 出包 → 3d_editor 走既有 `update-faijs` 流程升级 → web 端手测"点顶面 → 顶面消失"，weapp 复测不回归。
5. 本方案落地后，回填本文档状态为"已落地"，并记录实测数字。

---

## 7. 行为变更与影响面

- **修复后用户可见**：web 抽壳点哪个面就开哪个面（与小程序一致）。
- **box 数字面号**：方案 A 下 0..5 = 内核枚举序（−X,+X,−Y,+Y,−Z,+Z）；此前 `setFaceColor` 文档宣称的 +X,−X,+Y,−Y,+Z,−Z 作废。存量 `.fai.js` 若硬编码了数字面号，需要改为选择器/role（仓内检索：`grep -rn "setFaceColor"` 于 fixtures 与 demo，逐条核对）。3d_editor 不产生 `setFaceColor` 调用，UI 无变化。
- **cylinder/cone 数字面号**：方案 A 下不变（仍为侧面/顶/底的内核序），与 P1 前一致。
- **拓扑面行 `id`**（`o1.fN`）：方案 A 下不变；若选方案 B，行 id 与序号会整体按规范序重排 —— 需先确认 3d_editor 没有把 `o1.fN` 落库（当前它只存 `FaceTopoRef{origin,role,hint}`，未存行 id）。
- **性能**：BREP 拓扑不再二次三角化，单次执行三角化次数约减半（大装配收益更明显）。
- **weapp 的 `pickFaceRow`**：保留（更健壮），但从"必需"降为"可选"；注释里"面序表不可信"的理由需更新为历史原因。

---

## 8. 风险与回退

| 风险 | 说明 | 处置 |
|---|---|---|
| 存量脚本依赖数字面号 | 数字含义在方案 A 下变化 | P0 文档明示 + 仓内 fixtures 全检索 + `setFaceColor` 选择器形态提供迁移路径 |
| 排序/Z 序变化导致快照失效 | 若选方案 B | 先核查 3d_editor 是否持久化 rowIndex/行 id；未持久化才落 |
| `brepTess` 跨 op 失效 | 变换类 op 会换 solid、须重新三角化 | 缓存键用 partName，`runtime.ts` 已有的 `deleteTopology`/缓存清理点一并删键（已有逻辑，补测试） |
| 断言误伤导入/装配路径 | 这些路径本无"显示 mesh 同源" | 断言只在 `source === 'brep' && 有 brepTess` 时生效；兜底路径显式标 `source:'brep'(fallback)` 并在测试里单列 |
| 双内核断言语义差异 | brepkit 面枚举序可能不同 | 断言只比较"行 ↔ 自身几何"，不比较跨内核行号（方案 A 下） |

回退：P1/P2 各自独立、无对外签名变化，可单独 revert；P3 的选择器形态为纯增量，可单独关闭。

---

## 9. 验收标准

1. `face-mesh-alignment` 测试全绿：所有矩阵组合下 I2/I3/I4 成立。
2. `shell-open-face-direction` 四组合全绿：点顶面 → 顶面消失；`">Z"` 与 `role:'top'` 的 FaceTopoRef 结果一致。
3. `mesh-single-tessellation` 全绿：每 part 每次执行 1 次 `meshShape`，拓扑命中缓存。
4. `docs/api-contract.md` 有面身份条款；三处误导注释消失；`docs/ops-api-inventory.md` 已更新。
5. 定向测试通过后才跑一次 `pwsh -NoProfile scripts/ci.ps1`，全绿；`npx madge --circular packages/*/src` 无新增环。
6. 3d_editor web 手测：抽壳点顶面 → 顶面消失；点侧面 → 侧面消失；小程序无回归。
7. 全仓 `grep -rn "契约序\|face 序号契约\|BoxGeometry.*顺序" packages/core/src` 无残留。

---

## 10. 不在本方案范围内

- 不改 `shell` 的语义（厚度方向、内腔规则）。
- 不重做命名/role 体系（`assignRoles` 的判向逻辑经实测正确，`role:'top'` 与 `">Z"` 指纹逐字相同）。
- 不动 `three-162`（它只是测试里的 parity oracle，属 `devDependencies`；运行时 core 不依赖 three）。
- 不改 weapp 的几何归面拾取（可选优化另开）。
- 不涉及 3d_editor 的业务代码（除一条消费侧断言测试）。
