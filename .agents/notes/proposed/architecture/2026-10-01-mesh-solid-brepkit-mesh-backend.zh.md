# Agent Note: 网格实体 —— brepkit 作为网格后端，近似拓扑由其导出，STEP 仍只属于 BREP

[English](2026-10-01-mesh-solid-brepkit-mesh-backend.md) | 中文

## 问题

引擎原本的设计是每个 op 都有 `brep` 与 `mesh` 两套实现。实际上几乎所有 op 都只有
brep 实现，而 mesh 路径**根本没有拓扑**：网格零件只带一份裸 `MeshData`
（`positions` + `indices`），下游无法选中任何面或边。于是用户加载 STL 之后，既不能对
识别出的边倒圆角，也不能在识别出的平面上画草图——而这正是加载网格的意义所在。

另有两处缺陷会挡住任何修法：

1. `BrepMeshResult.faceGroups` / `BrepEdgeData.edgeGroups` 在**生产端（brepkit 适配器）
   与消费端（拓扑提取器）之间存在两套单位口径**（三角形单位 vs 索引单位；点单位 vs
   浮点单位），取模上界也不一致。brepkit 引擎下面行的 `triangleCount` 因此静默变成 0。
2. `exportModel(entries, 'step')` 会把网格零件**静默升格**成 facet BREP
   （`reconstructSolidFromMesh`），产出的正是本项目区分 mesh/BREP 所要杜绝的
   "facet 三角化 STEP"。

## 提议

**给网格零件一份真实的（近似）拓扑，由引擎自己生产；网格 op 由 brepkit 的网格内核实现。**

1. **网格实体**：由网格文件经唯一合法顺序 `importStl` → `weldShellsAndFaces(按包围盒定标的 tol)`
   → `unifyFaces()` 构造出的 brepkit 实体。它承载近似拓扑（平面面片），永不产出精度量
   语义。该顺序**不可交换**：先 `unifyFaces` 再 `weldShellsAndFaces` 会得到体积归零的
   损坏实体。`unifyFaces` 是原地修改，返回值是**被合并的面数**而不是句柄。
2. **近似拓扑**沿用既有拓扑契约（`SelectorManifest` / `FaceRow` / `EdgeRow`，由
   `buildTopologyFromMesh` 经 L1 引擎契约面构建），**不新增第二套拓扑表示**。
3. **存储**：网格零件仍是 `kind: 'solid'` 的 Shape。新增 `ShapeSlot.meshSolid` 只保存
   句柄**身份**；它与 `ShapeSlot.solid` 互斥，且**永不**写入 `brepChain.solidCache`。
4. **分派**：`defineOp` 新增 `meshEngines`（缺省 `['manifold']`）。把网格实体喂给
   `meshEngines` 不含当前网格后端的 op → 静态失败（`E_MESH_SOLID_UNSUPPORTED`），
   不存在运行时回退到 manifold。
5. **网格 op 的形态**：一律是「三明治」——从注册表取网格实体句柄、调内核、把新句柄写回，
   并以 `meshShape(...)` 产出 `MeshData`。
6. **STEP 只属于 BREP**：删除 mesh → STEP 通道（`reconstructSolidFromMesh`），含网格零件
   的模型导出 STEP 时按 part 名明确报错。

## 接口变更

- `BrepMeshResult.faceGroups` 为**索引单位**（`[triStartIdx, triCountIdx, faceHash]`）；
  `BrepEdgeData.edgeGroups` 为**浮点单位**（`[pointStartFloat, pointCountFloat, edgeHash]`）。
  两者的 hash 共用唯一上界 `BREP_HASH_BOUND`，生产端与消费端同源。
- brepkit 适配器把类型**编译进句柄的第 26..28 位**（`asFace` / `asEdge` / `asWire` /
  `asVertex`；实体不带标签）。brepkit 句柄按类型分命名空间——`getFaceEdges(0)`、
  `getSolidFaces(0)`、`getEdgeCurveType(0)` 对**同一个数字**全部成功，内核根本问不出
  句柄是什么。标签随句柄流动，`asNum()` 在每次内核调用前剥掉它。
- `ShapeSlot` 新增 `meshSolid?`；`hasMeshSolid` / `meshSolidOf` / `fromMeshSolid` 与
  `hasBrep` / `brepOf` / `fromBrep` 并列，且与之互斥。互斥在**两个写入点**上强制，
  并在每次 `dispatchPath` 前由 `assertShapeSlotExclusive` 复核。
- 网格后端经**网格引擎槽**装配（`registerMeshEngine('brepkit', { id, meshSolid })`），
  永不占用 BREP 槽：宿主可以让 OCCT 当 BREP 引擎、brepkit 当网格后端。端口是
  `MeshSolidBackend`（`brep/mesh-solid.ts`）：`kernel`（L1 API）、`ops`
  （`importMesh` / `weld` / `unify` —— 内核私有，**刻意**不放进 `BrepEngineApi`），
  以及引擎中立的驱动器 `normalize` / `describe` / `buildTopologyData` / `release`。
  `getMeshSolidBackend()` 扫网格槽，返回第一个提供了网格后端的引擎。
- `load` 的网格分支经 `setPendingMeshSolid` / `setPendingMeshTopology` 通道登记句柄与
  拓扑（与 `setPendingDetectedUnit` 同一模式），因为该 op 住在 `@faicad/faijs-extra`，
  拿不到 `CadRuntime` 引用。运行时按语句收编，先核对存活 ctx 变量**仍然**携带那个句柄
  （防 part 名被重写成 BREP 输出），再写入 `MeshSolidRegistry` 与
  `setTopology(part, 'mesh', …)`。
- **显示 mesh = 网格实体自身的三角化**，不是原始 STL 顶点数组。否则 `faceRuns` 索引的
  三角形不是用户看到的那些（拓扑契约规则 1）。
- `computeEffectiveDeflection` 从 `occt-kernel/occtKernel.ts` 移到中立的
  `brep/effective-deflection.ts`（它本来就只用 `getBoundingBox`），于是
  `brep/brep-topology.ts` 不再依赖 OCCT 内核，其 `@platform occt` 标注也随之摘除。
- `disposeBrepkit()` 现在同时重置缓存下来的 wasm `initPromise` 与 memo 化的原语对象，
  且 `createBrepkitPrimitives()` 按内核实例 memo 化。二者都是在**同一个** wasm 实例、
  **同一套**句柄桥接层上装配两个消费者（BREP 引擎 + 网格后端）的前提。
- `defineOp` 新增 `meshEngines`（缺省 `['manifold']`）。`dispatchPath` 在**既有的**
  网格后端槽上读它：当前 id 取自已装配的后端对象本身（`kernel.meshSolid.id`），
  而不是注册表的第二份快照——门禁因此不可能与装配结果漂移。门禁在**路径已选定为
  mesh 之后**才跑：这样 `mode='brep'` 仍拿到更贴切的 `E_BREP_UNSUPPORTED`，而
  `mode='mesh'` 同样受管（强制走 mesh 并不能让一个只会 manifold 的实现读懂网格实体句柄）。
- **网格实体永不与链外几何同处一次调用。** 输入里只要一部分是网格实体，就在实现跑之前
  以 `E_MESH_SOLID_MIXED` 失败。两种可能的结局都是静默降级：走 manifold 丢掉网格实体的
  身份与近似拓扑，走网格后端则让另一侧操作数没有句柄。`E_MESH_SOLID_MIXED` 是普通的
  输入不变量错误（与 `E_SHAPE_SLOT_EXCLUSIVE` 同级）；`E_MESH_SOLID_UNSUPPORTED` 是
  `MeshUnsupportedError`，与另两条 mesh 路径拒绝同类，宿主可一致归类。
- 网格 op 就是那个"三明治"，且只是那个三明治：`api/internal/mesh-solid-op.ts` 从身份槽
  取句柄（**不重复导入**）、调**一个** L1 内核方法，再由 `describeMeshSolid` 产出**一份**
  三角化同时喂显示 mesh 与近似拓扑（规则 1）。新句柄与其拓扑走与 `load` 同一条 pending
  通道写回。**输入句柄一概不释放**——生命周期归链（BREP 路径同样不释放输入），
  所以 `b = fillet(a)` 之后 `a` 仍然可用。
- **网格实体的边只能按几何解析。** 它没有 role 层，故 `EdgeTopoRef.faces` 里的两个
  `RoleQualifier` 是占位符，永远解析不到面。于是 `resolveEdgeTopo` 降级为在整个**边表**上
  按 `hint`（length / midpoint）匹配——但**仅当**上下文不带 `faceEdgeAdjacency` 时。
  BREP 上下文总是带它，所以这条放宽从 BREP 路径不可达：那里"面解析不到"仍然是
  `not-found`，不会静默变成"按长度猜一条边"。共用匹配器（`matchEdgeByHint`）两个调用点
  只有一份实现。
- **STEP 导出在结构上拒绝网格零件。** `StepExportEntry.solid` 改为**必填**，`mesh?` 字段
  整体删除，写出器因此没有第二个几何来源可退；`exportStepFromSolids` 保留一道运行期
  `E_STEP_MESH_PART` 作为最后闸门。`exportModel` / `exportModelSync` 在取内核**之前**对每个
  条目跑 `assertStepEntryHasSolid`，因为"这不是一个 BREP 零件"才是用户需要看到的第一个
  事实，不该取决于当前恰好装配了哪个 BREP 引擎。报错带上 part 名。它是普通 `Error` 而非
  `MeshUnsupportedError`：这是导出输入的不变量，不是一次分派决策。多成员装配里出现网格
  零件时，`cq-compat-assembly` 的 `save.ts` 抛同样的错并指出成员名。
- **网格链面是一个独立的身份。** `ShapeSlot` 新增 `meshFace?`，与 `solid` / `meshSolid`
  并列且与二者互斥；`fromMeshFace` / `hasMeshFace` / `meshFaceOf` 与另两对并列。它存在的
  理由和 BREP 链需要"面 Shape"完全一样：`sketchOnFace` 产出一张面，`extrude` 消费它。
  BREP 分支把面句柄停在 `slot.solid` 里；网格分支**不能**借这一格——那样 `hasBrep` 会变真，
  分派会把一个 brepkit 面句柄送进精度内核。网格链面的 `kind` 仍是 `'solid'`（与 BREP 侧的
  面 Shape 同形），好让 `extrude` 的 `isCurveShape` 预检在两条链上行为一致。
  `assertShapeSlotExclusive` 现在数全部三种链身份：多于一种即 `E_SHAPE_SLOT_EXCLUSIVE`。
- **`sketchOnFace` 新增 mesh 分支，且刻意不走 UV 域。** BREP 分支把轮廓映射进面的
  `(u,v)` 域；而 brepkit 平面的域是 ±1e6——一个无限域，其中点只是一个**参数**原点，
  可能落在面之外——所以"把草图放在面的 UV 范围内"在那里毫无意义。网格分支改为把轮廓
  放在面自己的平面框里：原点取面的**包围盒中心**（不是 `surfaceCenterOfMass`，后者在
  brepkit 上是 UV 域中点求值——见上），法向取该 UV 中点处的 L1 `surfaceNormal`。
  这与 `cad.sketchOnPlane` 的语义一致。因此 `scaleMode` 只接受 `'original'`
  （`'bounds'` / `'native'` 是相对 UV 域定义的），`as:'wire'` 被拒（网格链上的 wire 没有
  身份槽，而下游是 `extrude`，它要的是面），只接受**平面**面，多岛屿草图也被拒——因为
  brepkit 的 `extrude` 吃一张面，不吃 compound。每一条拒绝都是说明原因的
  `MeshUnsupportedError`，没有一条会静默改成别的行为。
- **`extrude` 新增 mesh 分支。** 输入是网格链面，产物是新的网格实体；方向语义用的是
  BREP 分支那**同一份** `normalizeExtrudeOptions`（没有分叉——`(face, 5)` 仍然是 +Z）。
  网格链上拒绝 `upTo`：它需要精度链对目标面求交并裁切，而把"拉伸到那张面"悄悄换成
  "拉伸这么长"会给用户一个不同的实体。
- **`fillet` / `chamfer` 在 `mode='mesh'` 下不再是 brep-only。** 它们现在声明了 mesh 实现，
  于是选定的是网格路径，而不是在分派处失败。裸网格输入因此拿到的拒绝从
  `E_MESH_UNSUPPORTED`（"没有 mesh 实现"）变为 `E_MESH_SOLID_UNSUPPORTED`（"网格路径需要
  网格实体输入与已装配的网格后端"）——仍是 `MeshUnsupportedError`，仍在任何几何工作之前，
  仍然不回退到 BREP。两个错误码都是 `MeshUnsupportedError`，宿主侧归类不变；只是消息现在
  说出了真正的原因。
- **网格链的选择器接受 1 起序号。** `fillet` / `chamfer` 的 `edges`、`shell` 的 `openFaces`
  既收 `TopoRef` 也收序号，与 `sketchOnFace` 的 `face` 序号同口径。序号就是宿主已经从近似
  拓扑数组里读出来的那个下标（+1），所以"用户点了第 7 条边"不需要任何几何反推。精度链
  **刻意**不开这个口子：BREP 实体的身份是它的 role 线路，而枚举序号跨特征会漂移——在那里
  接受序号，等于把"可重放的引用"降级成"这次跑出来的下标"。`assertFilletParams` /
  `assertChamferParams` 加了一个只有网格实现才传的 `allowOrdinals` 选项，`shell` 的 BREP 分支
  则用自己的消息拒绝序号。
- **变换族新增网格分支：动的是句柄而非顶点。** `translate` / `rotate_euler` / `scale` /
  `scale3d` 把网格实体送到网格后端内核，复用 BREP 路径用的同一批引擎中立助手
  （`translateBrep` / `rotateBrep` / `scaleBrep`），产物的身份与近似拓扑因此都还在；裸网格
  保持历史上的顶点烘焙路径。对网格实体烘焙顶点会静默丢掉它的身份槽——此后每个下游网格 op
  都会把它当裸网格拒绝。不挂面演化、不产 roleTable（近似链两者都没有）。
- **`shell` 新增网格分支。** 与 BREP 分支同一条 L1 调用
  （`shell(solid, faces, thickness, tolerance)`），差别只在选面方式（序号或几何 `FaceTopoRef`）。
  内核拒绝时报 `E_SHELL_FAILED`，带上壁厚与被移除的面数。
- **阵列 / 镜像族新增网格分支，释放恰好落在融合这一步。** `linearPattern`、`circularPattern`、
  `gridPattern`、`rectangularPattern`、`mirrorJoin`、`mirror`、`clone` 都可作用于网格实体。
  产副本的 op 走 `meshPatternProduct`：把副本融成一个新的网格零件，并且**只释放它自己造的
  副本**——绝不释放输入（`a` 在 `b = linearPattern(a)` 之后必须仍然可用），中途失败时同样释放，
  所以失败调用不漏句柄。网格链上不产 `replica[k]/<inner>` 命名（没有 role 层可回投）。
  `gridPattern` 的网格分支用逐份 `translate` + `fuseAll` 造副本，而不是调内核的 `gridPattern`：
  后者返回**一个 compound 句柄**，而近似拓扑没有办法把 compound 讲成一个网格零件。
- **测量接受网格实体。** `area` / `length` / `volume` / `centerOfMass` 经网格后端内核读网格实体
  句柄。读到的值是对**面片几何**的精确测量（10³ 立方体 STL 读 1000.000；32 边形棱柱读到的是
  32 个面片之和）——既不是对原始设计的还原，也不是估算，所以不做任何折扣，也不贴"近似"标签。
  两个链句柄都没有的形状（裸网格）报 `E_MEASUREMENT_NO_HANDLE`，而不是返回 0。
- `meshSolidBasicEntry` 从 `meshSolidEntry` 拆出：整体作用于实体的 op（变换 / 抽壳 / 阵列）
  不需要边表，而建一遍边表的代价是每条边一次内核调用。

## 备选方案

- **直接向内核查询句柄类型。** 否决：brepkit 没有 shape-type API，也没有可靠探测——
  所有候选判别式（`getAnalyticSurfaceParams`、`getEdgeCurveType`、`getSolidFaces`）
  都会回答"自己命名空间里该下标对应的对象"，因此同号的边与面无法区分。
- **对面片簇做曲面拟合**（把 STL 圆柱还原成一张圆柱面）。否决：brepkit 不做
  （`convertToElementary` 在面片实体上返回 0，`recognizeFeatures` 返回 `[]`），自研
  拟合器超出本次变更范围。面片化的圆柱就是 32 个平面四边形。
- **沿用内核的隐式 mesh 回退**（`meshFallbackCount` / facet STEP）。否决：它会掩盖
  mesh/BREP 边界，而这正是本项目唯一不肯模糊的东西。
- **新增第四种 shape kind（`meshSolid`）**。否决：网格零件本就是 `kind: 'solid'`，
  另立 kind 会让每条终端/动画/导出路径分叉，收益为零。
- **惰性规范化（首次需要拓扑时再做）**。否决：会把失败点从"引发它的那次导入"移开。
  导入即规范化，才能让"开放网格加载失败"成为加载期错误。
- **按 op 声明 `meshEngines` vs 运行时冻结后端**。运行时冻结更贴近既有
  `createRuntime({ brep, mesh })` 风格，但决策必须出现在 op 的声明处，且分派表是静态的。
  故选字段。

## 验收标准

- 跨引擎契约测试（occt × brepkit）：`faceGroups` 索引单位、`edgeGroups` 浮点单位、分组
  hash 等于 `hashCode(subShape, BREP_HASH_BOUND)`，同一个 box 在两侧的
  `triangleStart` / `triangleCount` / `area` / 边长完全一致。
- 网格实体构造测试：12 三角形的 box STL → 12 面 / 36 条不共享边 / 严格校验不过且 fillet
  被拒；`+ weld` → 18 边 / 校验通过；`+ unify` → 6 面 / 12 边 / fillet 12-of-12；
  圆柱 STL → 124 三角形 → 34 面 / 96 边，逐条边可倒圆角；同一次请求 96 条边被拒。
- 加载 box STL 得到宿主可选择的网格拓扑：6 个平面面 `area = 100`、12 条边
  `length = 10`、`ExecutionResult.topology[].source === 'mesh'`。
- 含网格零件的模型导出 STEP 报错并指出 part 名；STL/3MF 导出照常。
- Phase 2（B1 批）：立方体 STL 的一条识别边 `fillet(r=1)` → 仍是带自身近似拓扑的网格
  零件，体积落在解析区间 `a³ − (1 − π/4)·r²·a` 内，且**没有**面演化挂上去
  （造一张恒等映射等于宣称存在一份并不存在的演化）。
- Phase 2：32 边形棱柱 STL 恰好报出 96 条边，且每一条都能走 op 逐条倒圆角；网格实体与
  链外几何混进一次布尔 → `E_MESH_SOLID_MIXED`；两个网格实体 union 产出网格零件。
- Phase 3：在 10³ 立方体 STL 的 `+Z` 面上（按几何选取——近似拓扑没有 role）画 4×6 矩形
  草图并拉伸 5 → 草图是网格链面，棱柱是体积 120 的新网格零件，`union(box, prism)` = 1120，
  `mode:'backward'` 的 `cut(box, prism)` = 880。`upTo`、非 `'original'` 的 `scaleMode`、
  越界的面序号各自以各自的错误码失败。
- Phase 4（B3 批）：在 10³ 立方体 STL 上，`translate` / `rotate_euler` / `scale` / `scale3d`
  各自都把零件留在网格链上（注册表句柄、`source === 'mesh'`、不在 `solidCache` 里），同时几何
  确实动了（体积 1000/8000/2000，转 45° 后包围盒张到 10√2）；`shell` 移除识别出的顶面、
  `thickness: 1` = 424，不开口 = 488；`linearPattern`（3 份、间距 20）= 3000，
  `circularPattern`（绕 Z 4 份）= 4000，`gridPattern` / `rectangularPattern`（2×2）= 4000，
  `mirrorJoin` = 2000 且横跨 x ∈ [−10, 10]，`mirror` = 1000 且落在 x < 0、源零件保留，
  `clone` = 1000 且句柄独立。
- Phase 4（B4 批）：网格零件上 `volume` = 1000、`area` = 600、`centerOfMass` = (5, 5, 5)；
  测得的值在脚本里是可消费的数字（体积 1000 当缩放系数 `v / 500` → 8000）；裸网格报
  `E_MEASUREMENT_NO_HANDLE`。
- Phase 4：每个带网格实体实现的 op 都声明了 `meshEngines`，把已装配的网格后端换成未声明的
  那一个后门禁静态拒绝（读的是 op 自己的元数据，不是它的副本）。
- 端到端场景（目标用例）：加载立方体 STL，从近似拓扑里读出 6 个面 / 12 条边，用**这次读到的
  序号**对一条底边倒圆角，再从倒圆角后的零件**重新读一遍拓扑**，在它的 `+Z` 面上画 4×6 矩形
  并拉伸 5 → `union` = 1117.854，`cut`（背向）= 877.854；同一条链在 32 边形棱柱 STL 上按序号
  给一条竖向棱倒圆角。该链的产物导 STL 正常（从文件回读的三角形数与网格载荷一致），导 STEP
  报 `E_STEP_MESH_PART` 并指出 part 名。
- 脚本面验收：同一场景以**一份真实 `.fai.js`** 跑在编辑器宿主上（`@faicad/faijs-extra` +
  经 `assetsDir` 端口读到的夹具 STL），选择器以字面量写进脚本。测试把这些字面量钉在
  一次新的拓扑读数上：边 `9` 是**刚 load 完那个零件**上长 20 的底棱，面 `4` 是**倒圆角之后
  那个零件**上的 `+Z` 面——圆角新增一张面，编号整体漂移（同一张面在倒圆角前是 `6`）。
  结果：`volume` = 2000 − 4.292 + 120，每一步产物都是网格零件，草图为网格链面。
- `npm run test -w @faicad/faijs` 全绿且 stderr 零输出。

## 风险

- **曲面不还原**：STL 圆柱在近似拓扑里永远是 32 个平面四边形。这是如实声明的边界，不是缺陷。
- **没有网格后端的宿主拿不到近似拓扑**。"没有装配网格内核"（例如只接了 BREP 槽的 weapp
  构建）是一种合法的静态配置，此时 `load` 保持它历史上的裸网格行为；这与规范化失败是
  **两回事**——后者必须响亮失败。这个区分是刻意的，但很容易读错；防线是：边界由装配决定，
  在任何几何工作之前定下，永不靠检视一个失败结果来推断。
- **brepkit 网格适配器不在 browser umbrella 里**。`entry-boundary.test.ts` 禁止 `browser.ts`
  再导出 brepkit（该 wasm 包的 node 分支由 vite 静态解析，在 web 上并不存在）。浏览器宿主
  从 root 或 `weapp` 入口取，或自带一份 `MeshSolidBackend`。
- **规范化可能失败**（开放 / 非流形 / 自交网格）：焊接后体积为 0 或 `validateSolid` 非 0。
  必须带 part 名响亮失败；静默降级成"无拓扑的裸网格"会让所有下游 op 失去选择能力。
- **焊接容差敏感**：太小缝不上，太大粘死。容差由包围盒对角线导出，且可显式覆盖。
- **`unifyFaces` 脆弱**：顺序错就损坏实体；防线是防回归测试 + unify 后 `validateSolid`
  校验，不过就退回 weld 后状态并如实告知"面未合并"。
- **网格句柄泄进精度链**会静默复活 facet STEP；防线是 `solid`/`meshSolid` 互斥校验，
  以及删除 mesh → STEP 通道。
- **一次请求里的整批共面边会被内核拒绝。** 32 边形棱柱上的实测：96 条边一次性提交被
  整体拒绝（"no fillet engine produced a changed, closed, outward-oriented result"）——
  端盖那几条共面边链一起磨圆会自交；而逐条提交 96/96 全部成功。op 连同边数一起如实转述
  内核的拒绝，**不**自动改成逐边重试：运行时换策略会掩盖一个真实的几何事实，还会让结果
  依赖一次看不见的重试。需要整条边链的调用方请把它拆成几何上互不相邻的若干组。
- **网格实体上不支持 `chamfer` 的 `twoDistances`。** 它要把 `faces[0]` / `faces[1]`
  两个邻面解析出来，才能决定 `width1` 与 `width2` 各归哪一侧；没有 role 层，两个限定符
  都解析不了，而猜一个参考面会把倒角落在错误的一侧。`equal` 与 `distanceAngle` 可用
  （它们只需要边本身）。
- **裸网格输入在这些新增网格路径上仍被拒绝。** `translate` 一族仍有裸网格实现（manifold
  的顶点烘焙），但这里新加的其他 op（`shell`、阵列族、`mirror` / `clone`、`fillet` /
  `chamfer`）只有网格实体路径，所以裸网格是被 `meshSolidBasicEntry` / `meshSolidEntry`
  拒绝的，而不是被分派层拒绝。错误码与错误类同前（`E_MESH_SOLID_UNSUPPORTED`、
  `MeshUnsupportedError`），只是上移了一层。
- **序号是位置号，不是身份。** 从某次拓扑读数里取到的序号，只在那一次的同一个零件上指同一条边/面
  ——任何特征之后编号都会变。这正是工作流每一步都重新读拓扑的原因，也是精度链干脆不收序号的原因。
  几何 `TopoRef` 有镜像的弱点（同尺寸的面、等长的边分不开），两种形式并存正是为此。
- **网格链的 `gridPattern` 返回融合实体，BREP 分支返回 compound。** BREP 内核交回的是一个
  含全部副本的 compound 句柄；网格分支改用逐份 `translate` + `fuseAll`，因为近似拓扑没有办法把
  compound 讲成一个网格零件。实体相同，对分离副本而言几何也相同——但指望"一个 compound、多个
  子件"的调用方不应在网格链上期待同样的形态。
- **这些整体作用于实体的 op 依赖 brepkit 接受网格导出的实体。** `translate` / `mirror` /
  `shell` / `fuseAll` 都在 `api/mesh-solid-modeling.test.ts` 里带着解析体积被实测过（不是
  "跑通了就行"），所以内核哪天不再接受它们会响亮失败，而不是悄悄产出一个裸网格。
