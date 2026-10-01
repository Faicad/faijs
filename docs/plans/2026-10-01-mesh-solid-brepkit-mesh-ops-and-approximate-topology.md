# 网格实体与 brepkit 网格后端：STL 近似拓扑 + mesh op 方案（2026-10-01）

日期：2026-10-01
状态：**待拍板**（§7 有 3 个待定项，未决策前不开工）
范围：`packages/core`（L1 适配器 / L2 执行链 / 拓扑层 / 导出层）
实测内核：`brepkit-wasm@3.4.18`（`packages/core` devDependency，`node_modules/brepkit-wasm/brepkit_wasm.d.ts` 共 228 个方法）

---

## 0. 结论先行

**问题一：brepkit 是否实现了自动识别 mesh 的近似拓扑？**

**部分实现，且默认路径不可用，但存在一条可用的驱动顺序。**

- `importStl` / `importIndexedMesh` 的确会建 B-Rep：**顶点按坐标焊接**，但**每个三角形一个平面面、每条三角形边各占一条边**（不共享）。实测 10×10×10 立方体 STL → `[面12, 边36, 顶点8]`，`validateSolid = 1`（严格校验不过）。
- 这个状态的实体 **fillet 0/36 成功、chamfer 0/36 成功**——内核自己判"no manifold edges to chamfer"。**直接拿 `importStl` 的结果做不上圆角。**
- 但按固定顺序再走两步就可用：`weldShellsAndFaces(faces, tol)` → **`[面12, 边18, 顶点8]`，`validateSolid = 0`**（边被共享，成为真流形）；再 `unifyFaces()` → **`[面6, 边12, 顶点8]`**（共面三角形合并回一个平面面）。此时 **fillet 12/12 成功**。
- 圆柱 STL：`[面124, 边372]` → weld `[124,186]`（合法）→ unify `[34,96]`（64 个侧面三角合成 32 个侧面四边形，两个端盖各合成 1 个面）→ **fillet 96/96 成功**。
- **brepkit 不具备的**：从面片簇**拟合曲面**。`convertToElementary` 在三角面片实体上返回 0（面片本来就是 plane，没有 NURBS 可识别）。`recognizeFeatures` 是有限的特征识别器（在 native 的"圆柱切方孔"实体上能返回 `[{"type":"hole","diameter":20,"faces":[124]}]`，在三角面片实体上返回 `[]`）。**所以 STL 里的圆柱永远只是 32 个平面四边形，不会变成 1 张圆柱面。**

**问题二：如果没有，如何把近似拓扑能力提供给 brepkit？**

答案不是"给 brepkit 加算法"，而是**在送入 brepkit 之前把网格整理成它能正确合并的形态**，然后**由 faijs 侧驱动它的合并原语**：

```
原始三角网格
  → importStl / importIndexedMesh          （内核自带：顶点焊接 + 逐三角形成面）
  → weldShellsAndFaces(allFaces, tol)      （关键一步：把重复边缝成共享边 → 真流形）
  → unifyFaces()                           （内核的共面区域合并 = 近似拓扑本体）
  → 网格实体（mesh solid）
```

**`weldShellsAndFaces` 之前调用 `unifyFaces` 是错的**（实测 `[面6, 边36]`、`volume = 0`，实体损坏）；顺序不可交换。**这既是"如何把能力提供给 brepkit"的答案，也是本方案的核心技术约束。**

**问题三：近似拓扑（原"假拓扑"）是否全部保留下来了？**

**契约与解析全保留，算法不在核内，另有两处已删。**

| 部分 | 现状 | 证据 |
|---|---|---|
| `TopologySource = 'brep' \| 'primitive' \| 'mesh'` | ✅ 保留 | `packages/core/src/cad-runtime/runtime.ts:101` |
| `setTopology(part, source, data)` 注入口 | ✅ 保留 | 同上 `:1367` |
| 拓扑行契约 `SelectorManifest` / `FaceRow` / `EdgeRow` + 构建器 `buildSelectorRuntime(Data)` | ✅ 保留并导出 | `packages/core/src/topology/types.ts`、`build-selector-runtime.ts` |
| mesh 面 hint → 解析兜底（geometric 路径） | ✅ 保留 | `setTopology` 写 `ShapeSlot.faceHints`（`runtime.ts:1373`）→ `api/topo-resolve.ts:237` |
| 每三角形 faceId 标注 `buildFaceIdsForPart` | ✅ 保留 | `topology/build-face-ids.ts` |
| **从三角网格自动推导面/边分组的生产者** | ❌ **核内没有**（只有测试喂假数据，靠宿主外建） | 全仓 `setTopology(..., 'mesh', ...)` 仅出现在 `*.test.ts` |
| primitive 面的语义 role 分配 `assignPrimitiveFaceRoles` | ❌ 已删（primitive/mesh 行只填 hint，`origin/role` 显式 null） | `topology/naming/mesh-primitive.test.ts:5,190-193` |

即：**「近似拓扑」作为契约与解析是完整的，作为算法从未进过核心仓。** 本方案要把生产者补进引擎——而这件事是**可行的**，因为 brepkit 现在真的能给网格一份拓扑（见 §2、§3.3 实测）。

**另外一个必须一起处理的既成事实**：今天 mesh 零件**是能导出 STEP 的**——`exportModel(entries, 'step')` 对没有 solid 的条目会走 `reconstructSolidFromMesh`（mesh → ASCII STL → OCCT importStl → heal → sew → solid），产出的正是用户描述的"facet 三角化的 STEP"。这与本项目宗旨相悖，必须随本方案一并取消（§3.6）。

---

## 1. 现状（代码事实，非文档转述）

### 1.1 op 的双实现分布（用户判断的验证）

- `defineOp` 在 `packages/core` + `packages/faijs-extra` 共有 38 个非测试文件使用。
- 声明了 `mesh:` 实现的只有 13 个 op：`union/subtract/intersect/boolean`、`engrave`、`knurl`、`place`、`box/cylinder/cone/sphere/...`（`api/primitives.ts` 5 处）、`screw`、`sdf`、`transform`（4 处）。
- 其余全部 brep-only：`fillet`、`chamfer`、`extrude`、`revolve`、`loft`、`sweep`、`shell`、`split`、`pattern`、`sketch-*`、`punch-hole`、`draft`、`section-by-plane`、`thicken`、`wire`、`helix`、`profile`、`import-*` …

结论：**"mesh 必须实现"这一原始设计事实上已退化为"mesh 只在少数 op 上有实现"**，用户的判断成立。

### 1.2 mesh 路径的现有实现底座

- mesh 路径的布尔走 Manifold（`Backends.kernel.csg`，`boolean/csg-backend.ts`），产物是裸 `MeshData`（`positions` + `indices`）。
- mesh 路径的产物**不带 `solid` 槽** → `hasBrep() === false` → 该 part 不在 BREP 链上（`brep-chain.ts` 逐 part 的 `solidCache` 决定）。
- `load` 的 CAD 源判定是静态的：`CAD_FORMATS = {step, brep, stp}`，**STL/3MF 不在其中**（`brep/brep-chain.ts:23`）→ 今天 STL 就一定落 mesh 路径。这一点与用户的诉求天然一致。

### 1.3 近似拓扑的通路（已实测可复用）

`packages/core/src/brep/brep-topology.ts` 的 `buildTopologyFromMesh(kernel, solid, meshWithGroups)` 只经 **L1 契约面** 调用内核（`getSubShapes` / `curvePointAtParam` / `pointOnSurface` / `curveParameters` / `hashCode` / `curveTangent` / `wireframe` / `surfaceType` / `surfaceCenterOfMass` / `getBoundingBox` / `curveType` / `curveLength` / `curveIsClosed` / `uvBounds` / `surfaceNormal` / `shapeOrientation` / `isSame` / `getVolume` / `getNurbsCurveData` / `getFaceCylinderData` / `getCenterOfMass` / `release`）——这些方法 brepkit 适配器**全部已实现**（`brepkit-kernel/brepkitKernel.ts`）。

**实测（`tsx` 直跑源码）：**

```
importStl(box stl) → weldShellsAndFaces → unifyFaces
  → 实体 [面6, 边12, 顶点8]
  → api.meshShape(...)            → 12 三角, faceCount=6, faceGroups=6 组
  → buildAssemblySelectorManifest → buildSelectorRuntime
      → faces: 6, edges: 12, vertices: 20
      → face[0]: {surfaceType:'plane', area:50, normal:[0,0,-1], params:{origin,axis}}
      → edge[0]: {curveType:'LINE', length:10, faceStart:0, faceCount:2}
```

**近似拓扑的产物形态与 BREP 路径完全同构**（同样的 FaceRow/EdgeRow 字段、同样的 `faceStart/faceCount` 邻接、同样的 `params`），并且 `edge.faceCount = 2` 正是 `EdgeTopoRef.faces`（双角色限定符）所需要的邻接信息。**不需要为 mesh 造第二套拓扑表示。**

### 1.4 阻塞用户目标的两处既有缺陷（本次实测发现）

`BrepMeshResult.faceGroups` 的单位在两层之间口径不一致：

| 层 | 口径 | 依据 |
|---|---|---|
| OCCT 内核 → `topologyExt` | **索引单位**（3/三角形） | `occt-kernel/topologyExt.ts:635-647` 注释明写 index units，并 `triStartIdx / 3` |
| brepkit 适配器 `solidMesh/faceMesh/compoundMesh` | **三角形单位**（已除 3） | `brepkit-kernel/brepkitKernel.ts:345-346`，且被 `brepkitKernel.test.ts:87` 断言钉住 |

后果：在 brepkit 引擎下 `topologyExt` **又除了一次 3**，实测 face 行的 `triangleCount` 为 `0.6667`（真值 2）——**面↔三角形区间错 3 倍**，直接影响按面拾取/高亮范围。而 mesh 零件的一切交互都建立在这个区间上。

同族的第二处（同一根因，另一个字段）：`edgeGroups`。`topologyExt.ts:737` 把 `pointStart/pointCount` 当**浮点单位**交给 `extractEdgePolylineFromWireframe`（`:270-288`，内部 `off = pointStart + p*3`），而 brepkit 适配器的 `wireframe()` 输出的是**点单位**偏移（`brepkitKernel.ts:794-796`）。实测表现：`pointCount < 6` 恒成立 → 返回 `[]` → 曲面边**静默回退到曲线采样**（功能不崩，但丢了内核线框数据）。

这两条必须在 Phase 0 钉死：**`faceGroups` / `edgeGroups` 的单位是 L1 契约的一部分，必须有跨引擎的一致性测试**，否则 mesh 零件的近似拓扑天生带病。

---

## 2. brepkit 能力矩阵（全部为本次实测结果）

### 2.1 网格 → 实体

| 调用 | 立方体 STL（12 三角） | 圆柱 STL（124 三角） |
|---|---|---|
| `importStl` | 面12 / 边36 / 顶点8，vol 1000，validate 1 | 面124 / 边372 / 顶点64，vol 6242.89，validate 1 |
| `+ mergeCoincidentVertices` | 无变化（顶点已焊） | — |
| `+ healSolid` / `repairSolid` | 无变化（12 面不变） | — |
| `+ unifyFaces`（**不先 weld**） | 面6 / 边**36** / vol **0**，validate 1 → **损坏，不可用** | 面34 / vol 2885（≈一半，损坏） |
| `weldShellsAndFaces(tol)` | 面12 / 边18 / vol 1000 / **validate 0** | 面124 / 边186 / vol 6242.89 / **validate 0** |
| `weldShellsAndFaces` → `unifyFaces()` | **面6 / 边12 / vol 1000 / validate 0** | **面34 / 边96 / vol 6242.89 / validate 0** |
| `exportStep` → `importStep` 往返 | 面12 / 边36（**没被修好**） | — |
| `sewFaces` + `makeSolid` | 等价于 weld 结果（面12 / 边18 / validate 0） | — |

→ **网格实体的规范构造 = `importStl` → `weldShellsAndFaces(tol)` → `unifyFaces()`**，`tol` 必须与模型尺度挂钩（§3.1）。

### 2.2 在网格实体上做几何操作

| 操作 | 逐三角形实体（importStl 直出） | 规范化后（weld+unify） |
|---|---|---|
| `fillet(solid, [edge], r)` | **0/36 成功**（"none of the requested edges are filletable"） | **12/12 成功**（方盒）／**96/96 成功**（圆柱） |
| `chamfer` | 0/36（"no manifold edges to chamfer"） | 随 fillet 一并可用 |
| `fuse` / `cut` | 结果可疑（vol 0） | ✅ 正常（`cut` → vol 750，`fuse` → vol 1500） |
| `extrude(face, 法向, 5)` | — | **6/6 个识别面全部成功**，各得合法 6 面实体、vol 500 |
| `makePolygon(pts)` → 平面 face | — | ✅（画草图轮廓用） |
| `exportStl/Obj/Ply/3mf/Glb` | — | ✅ 全部成功（684 / 1757 / 957 / 1086 / 1356 字节） |

→ **用户的两个终极目标在 brepkit 侧都已验证可行**：① 对识别出的边加圆角；② 在识别出的平面上画草图拉伸出新实体。

### 2.3 brepkit 明确**不做**的事

- 不做曲面拟合：`convertToElementary` 在三角面片实体上返回 0。
- `recognizeFeatures` 是有限识别器，对三角面片实体返回 `[]`，**不能**依赖它做区域识别。
- 网格批量导出（`meshBoolean` 等）在**原始三角形**上工作，不进实体拓扑 → 本方案不用它（我们要的正是拓扑）。

---

## 3. 设计

### 3.1 名词与边界（先划红线）

| 名词 | 定义 |
|---|---|
| **网格实体（mesh solid）** | 由网格文件（STL/OBJ/PLY/GLB/3MF）导入、经 §2.1 规范化得到的 brepkit 实体。它是**近似拓扑的载体**，不是精度链的一环。 |
| **近似拓扑** | 网格实体上的面/边/顶点集合，及其在 `SelectorManifest` / `FaceRow` / `EdgeRow` 中的投影。几何上是**多面体近似**（平面面片），不是精确解析面。 |
| **网格后端** | 提供网格实体能力的引擎侧组件（本期即 brepkit 的网格用法）。与 BREP 引擎**同名不同用**：同一个 brepkit wasm 实例，但走的是 mesh 语义路径。 |
| **mesh op** | 声明了 `mesh` 实现的 op；其实现体读 `MeshData`、返回 `MeshData`。 |

**不可逾越的三条红线**（对齐 AGENTS.md 的引擎定位与用户宗旨）：

1. 网格实体**永不**进入 `brepChain.solidCache`——它由独立的注册表持有，生命周期与 BREP 链无关。
2. 网格零件**永不**产出精确量语义（`volume/centerOfMass/...` 走 mesh 侧或如实标注为近似），**永不**导出 STEP。
3. **禁止任何 mesh→BREP 的隐式升格**：今天的 `reconstructSolidFromMesh`（mesh→facet BREP→STEP）随本方案删除或封禁（§3.6）。

### 3.2 数据模型

**不新增第四种 Shape kind。** 网格零件就是今天的 `SolidShape`（`kind:'solid'`），只是：

- mesh 载荷 = 该零件的三角网格（唯一几何真源，与今天一致）；
- 新增 `ShapeSlot.meshSolid?: unknown` ——保存 brepkit 实体句柄的**身份**（句柄本身仍放运行时注册表，slot 只放"我是不是网格实体"这一事实）。

```ts
// runtime-state.ts（ShapeSlot 增一个字段，与现有 solid / faceHints 同级）
export interface ShapeSlot {
  solid?: unknown           // BREP 链句柄（精度链）
  meshSolid?: unknown       // 网格实体句柄（近似链）—— 二者互斥，不共存
  faceEvolution?: Map<number, number[]>
  faceHints?: unknown
  behavior?: unknown
}
```

加一条静态不变量：**`solid` 与 `meshSolid` 同时存在 = 缺陷**，由 `dispatchPath` 的前置校验直接报错（不给运行时选边站的机会）。

运行时侧新增注册表（与 `solidCache` 对称、互不干扰）：

```ts
// 新增 mesh-solid-chain.ts
const meshSolidCache: Map<PartName, MeshSolidHandle>
```

### 3.3 加载路径：STL → 网格实体 → 近似拓扑

```
load(part, path|file, {format:'stl'})
  │
  ├─ 解析（现有 mesh/stl-loader.ts 或 mesh/io.ts，不动）
  ├─ 静态判定：非 CAD 格式 → mesh 路径（现有 isCadFormat，不动）
  ├─ 【新】规范化：importStl/importIndexedMesh → weldShellsAndFaces(tol) → unifyFaces()
  │      容差 tol = max(1e-6, bbox 对角线 × 1e-6)（用 bbox 定标，不写死绝对值）
  ├─ 【新】建近似拓扑：buildTopologyFromMesh(meshKernel, meshSolid, kernel.meshShape(meshSolid))
  │      —— 复用现有函数，零新算法（§1.3 已实测）
  ├─ 【新】runtime.setTopology(part, 'mesh', data)
  └─ 产物：MeshData（mesh 载荷）+ meshSolid 句柄 + 近似拓扑
```

要点：

- **规范化失败（开放/非流形网格）必须显式失败**，带 part 名与原因（开放网格 weld 后 vol=0、面朝向不一致）。**禁止**静默退化成"无拓扑的裸网格"——那会让所有下游 mesh op 失去选择能力，属于"报错好于掩盖"。
- 容差定标：`weldShellsAndFaces` 的容差决定顶点/边缝合半径；按 STL 常见的单位歧义（mm vs inch），容差必须由 bbox 尺度导出，**不得写死 1e-6**。
- 单位口径：STL 无单位元数据，沿用现有 `opts.unit` 显式声明（`mesh/io.ts` 头注释的既有约定），不引入启发式猜测。

### 3.4 分派：mesh 路径的引擎身份

今天 `dispatchPath` 只判 `mode`（auto/brep/mesh）+ `engines` + `capabilities`。新增一维：**mesh 实现的引擎要求**。

```ts
defineOp({
  mesh: brepkitMeshImpl,          // 或 manifoldMeshImpl
  brep: brepImpl,
  meshEngines: ['brepkit'],       // 【新】缺省 ['manifold']；声明即静态门禁
  ...
})
```

规则（沿用现有"静态判定、无运行时回退"的红线）：

1. 输入 `hasMeshSolid === true` 且 op 声明的 `meshEngines` 不含网格后端 → **静态抛错**（`E_MESH_SOLID_UNSUPPORTED`），绝不在运行时改走 manifold。
2. 输入 `hasMeshSolid === true` 且 op 只有 brep 实现 → 与今天一致：`auto` 模式静态降级到 mesh；若该 op 连 mesh 实现都没有 → `MeshUnsupportedError`。
3. `mode='brep'` 且输入是网格零件 → 报错（`E_BREP_UNSUPPORTED`），因为网格零件按定义没有精度链。
4. 两个后端能力**不互相冒充**：manifold 的 mesh op 不得接受网格实体，brepkit 的 mesh op 不得接受非规范化网格（要么先规范化，要么拒绝）。

### 3.5 mesh op = brepkit 三明治

每个网格 op 的实现体是同一个形状：

```
MeshData ──► meshSolid 句柄（注册表查得，不重复导入）
              │
              ├─ 内核调用（fillet / chamfer / fuse / cut / extrude / …）
              │
              └─ meshShape(meshSolid') ──► MeshData
```

约定：

- **句柄不重复导入**：`meshSolid` 由加载路径建立并随 part 存活，op 只做"入场取句柄 → 出账写回句柄"。
- **回写**：op 产物的 `meshSolid` 槽指向新句柄；旧句柄按引用计数回收（沿用 `handle-bridge` / `release` 的既有约定，**不得泄漏**——brepkit 适配器里已有一批"句柄泄漏"的 GOTCHA 注释，新路径不能再添）。
- **面/边选择**：`EdgeTopoRef` / `FaceTopoRef` 的解析走 §1.3 的近似拓扑（`api/topo-resolve.ts` 的 geometric 路径已就绪），`edge.faceCount = 2` 天然满足双面限定符。
- **命名层**：网格零件的面/边**不给语义 role**（与今天 mesh/primitive 行只填 hint 的裁决一致）。role 是 BREP 真拓扑的专有能力——近似拓扑不冒充它。

**ops 覆盖顺序**（按用户目标排序，不一次铺满）：

| 批 | ops | 用户价值 |
|---|---|---|
| B1 | `fillet`、`chamfer`、`fuse/cut/intersect` | 对识别出的边倒圆角/倒角；网格实体布尔 |
| B2 | `extrude`、`sketch`（在识别平面上）、`profile` | 在识别出的平面上画草图拉伸新实体 |
| B3 | `transform` 族、`pattern` 族、`shell`、`split-by-plane` | 常规建模 |
| B4 | 测量（`volume/area/bbox`）与视图辅助 | 只读，标注为近似 |

### 3.6 导出：mesh 零件不支持 STEP

- **`exportModel(entries, 'step')`：凡条目的零件是网格零件 → 报错**（带 part 名的明确错误，如 `E_STEP_MESH_PART`），**不是**静默走 mesh 重建。
- **移除 mesh→STEP 通道**：`brep/export/step.ts:73-79` 的 `if (!solid) { reconstructSolidFromMesh(...) }` 分支删除；`occt-kernel/meshReconstruct.ts` 随之下线（其导出面 `browser.ts:217` / `index.ts:163` 同步删）。这是本方案里**唯一需要删代码**的地方，且必须删——留下就等于承认 facet STEP 合法。
- **mesh 格式导出照旧可用**（`stl` / `3mf`，以及内核侧已验证的 `obj/ply/glb`）。网格零件的 mesh 格式导出**不做任何重建**，直接用它的网格载荷。
- CLI 与宿主的导出入口（`node-host/cli.ts` 走 `exportModelSync`）同步收口；导出失败必须把"哪个 part、为什么"说清楚。

### 3.7 与既有拓扑层的接缝

- **不新增拓扑表示**：`FaceRow` / `EdgeRow` / `faceRuns` / `edgeGroups` 全部沿用（§1.3 实测产物同构）。
- **`buildSelectorManifestCore` 不新开分支**：它本来就只经 L1 调内核，网格实体直接复用。
- **`brep-topology.ts` 的 `@platform occt` 标注需要修正**：它 `import computeEffectiveDeflection`（来自 `occtKernel.ts`，但函数本身是引擎中立的 `{getBoundingBox}` 泛型），实际可跑 brepkit（§1.3 实测已证）。修正是**标注与 import 位置**问题，不是逻辑问题。
- **`hasBrep` / `brepOf` 不动**：新增 `hasMeshSolid` / `meshSolidOf`，与它们并列且互斥。

---

## 4. 分阶段实施

### Phase 0：把本次实测钉成测试 + 修两处单位缺陷（无新功能）

1. 落成 `packages/core/src/brepkit-kernel/mesh-solid-topology.test.ts`：
   - `importStl` → 逐三角形面 + 重复边（12 面 / 36 边）；`fillet` 拒绝；
   - `weldShellsAndFaces` → 18 边 / `validateSolid = 0`；
   - **`unifyFaces` 不先 weld 会损坏实体（vol 0）** —— 作为防回归用例（`GOTCHA:` 注释）；
   - `weld + unify` → 6 面 / 12 边 + `fillet` 12/12；
   - 圆柱 124 → 34 面 + `fillet` 96/96。
2. 修 §1.4 两处单位方言：**以"与 OCCT 内核同口径"为准**（`faceGroups` 索引单位、`edgeGroups` 浮点单位），改 brepkit 适配器，同步改 `brepkitKernel.test.ts:71-88` 的断言，并加**跨引擎一致性测试**（同一 box 在 occt / brepkit 两个引擎上 `FaceRow.triangleCount` 必须相等）。
3. 断言 `meshShape.faceGroups` 覆盖全部三角形且与 `faceCount` 一致（现有测试只查 brepkit 自洽，没查跨层）。

**验收**：`npm run test -w @faicad/faijs` 全绿；新增用例在 `stderr` 零输出下通过。

### Phase 1：网格实体与近似拓扑（只读，不接 op）

1. `mesh-solid-chain.ts`：`PartName → 句柄` 注册表 + 回收。
2. `ShapeSlot.meshSolid` + `hasMeshSolid/meshSolidOf` + "solid 与 meshSolid 互斥"的静态校验。
3. `load` 的 STL/OBJ/PLY/GLB/3MF 路径接入规范化 + `buildTopologyFromMesh` + `setTopology(part,'mesh',...)`。
4. 网格零件的 `ExecutionResult.topology[].source === 'mesh'`，面/边行列齐全、`faceRuns` 区间正确（Phase 0 修完才有真值）。

**验收**：host 拿到 STL 零件的拓扑后，能在 UI 上选中"6 个平面 / 12 条边"并读到正确的 `surfaceType/area/normal/params/curveType/length`；立方体 STL 的 6 个面 `area = 100`（10×10）。

### Phase 2：B1 批 mesh op（倒圆角/倒角/布尔）

1. `dispatchPath` 加 `meshEngines` 门禁 + `E_MESH_SOLID_UNSUPPORTED`。
2. `fillet` / `chamfer` / `fuse` / `cut` / `intersect` 的 brepkit mesh 实现（三明治，§3.5）。
3. 面演化/roleTable 在这条路径上**如实缺席**（近似拓扑无 hash 演化）——不得造恒等映射。

**验收**：对立方体 STL 的任一识别边 `fillet(r=1)`，结果仍为合法网格实体、体积落在解析预期区间；圆柱 STL 96 条边全部可倒角；网格实体与 BREP 实体**不可**混进同一次布尔（静态报错）。

### Phase 3：B2 批（识别平面上草图 + 拉伸）

1. 面的草图平面数据：`getAnalyticSurfaceParams`（实测 `{type:'plane', normal, d}`）+ 面中心。**注意 `getSurfaceDomain` 对平面返回 `±1e6` 的无限域，不能当草图范围用。**
2. `extrude` / `sketch-on-face` / `profile` 的 brepkit mesh 实现（`extrude(face, dir, dist)` 已实测 6/6 可用）。
3. 产出的**新实体也是网格实体**（新网格零件），同样不具备 STEP 导出资格。

**验收**：在立方体 STL 的顶面画矩形草图 → 拉伸 5mm → 得到合法的融合/切除结果（实测路径已通过：`fuse` vol 1500 / `cut` vol 1000）。

### Phase 4：导出收口 + 批 B3/B4

1. §3.6 的 STEP 封禁与 `reconstructSolidFromMesh` 下线。
2. 批 B3/B4 ops。

**验收**：对任意含网格零件的模型导出 STEP → 明确报错并指出 part 名；导出 STL/3MF 正常；`doc-sync` 全绿。

---

## 5. 风险与已知边界（如实声明）

| 风险 | 说明 | 处置 |
|---|---|---|
| **曲面不还原** | STL 圆柱永远是 32 个平面四边形，**不会**变回 1 张圆柱面；"识别出的圆柱侧面"在近似拓扑里是 32 个面 | 方案内如实接受。若后续要"逻辑区域合并"（一个逻辑面 = 32 个面片，几何仍是面片），是**命名层的分组**，不是几何拟合——单独立项，不在本期 |
| **规范化失败** | 开放网格 / 非流形 / 自交 STL：`weld` 后 vol=0、validate≠0 | 显式失败 + 原因；不做"尽力而为"的静默降级 |
| **容差敏感性** | `weldShellsAndFaces` 的 tol 太小缝不上、太大粘死 | 由 bbox 定标 + 提供显式覆盖参数；两种失败都要有测试 |
| **`unifyFaces` 的脆弱性** | 实测顺序错就损坏实体（vol 0）；内核版本间行为可能变 | Phase 0 固化为防回归测试；`unify` 后必须 `validateSolid`，不过就退回 weld 后状态并如实告知"面不合并" |
| **两处单位缺陷** | 不修则 mesh 零件的面/边区间全错 | Phase 0 必修，且加跨引擎一致性测试 |
| **网格零件误入精度链** | 新句柄若被写进 `solidCache`，STEP 就会再次静默化 | 三条红线 + `solid`/`meshSolid` 互斥断言 + Phase 4 删除 mesh→STEP 通道 |
| **引擎候选** | 用户提到"brepkit 支持加载 stl / 失败回退到网格 / 导出 mesh"，均指 brepkit 的**内建**行为 | 本方案**显式利用**其网格能力，但**不使用**它的隐式 mesh 回退（`meshFallbackCount` 仍按现状作为"BREP 链中断"信号，不参与本路径） |

---

## 6. 本次实测的复现方式

探针脚本（本地证据，尚未落成正式测试，Phase 0 的输入）：

| 文件 | 覆盖内容 |
|---|---|
| `.tmp-probe/stl-probe.mjs` | `importStl` 的实体计数与面类型；228 个内核方法清单 |
| `.tmp-probe/probe2.mjs` | `unifyFaces` 不 weld 会损坏实体；fillet/chamfer 在逐三角实体上全拒绝 |
| `.tmp-probe/probe3.mjs` | 各种愈合顺序对照；`recognizeFeatures` 输出；`detectSmallFeatures` |
| `.tmp-probe/probe4.mjs` | STEP 往返不能修好边共享；`weldShellsAndFaces` 是唯一可行修法 |
| `.tmp-probe/probe5.mjs` | **weld → unify → fillet 12/12**；圆柱 96/96；布尔正常 |
| `.tmp-probe/probe6.ts` | **复用 `buildAssemblySelectorManifest` + `buildSelectorRuntime` 跑通近似拓扑**（→ 也暴露了 `triangleCount = 0.6667` 的单位缺陷） |
| `.tmp-probe/probe7.mjs` | `faceOffsets` 单位核对（索引单位，非三角形单位） |
| `.tmp-probe/probe8.mjs` | **识别面 extrude 6/6**；网格实体布尔；5 种 mesh 格式导出；`makePolygon` |

运行（Node 22 + 仓库内 `node_modules`）：

```bash
cd /c/my/Faicad/faijs
"C:/Users/yuan_/.workbuddy/binaries/node/versions/22.22.2-5/node.exe" .tmp-probe/probe5.mjs
npx tsx .tmp-probe/probe6.ts
```

Phase 0 完成后删除 `.tmp-probe/`，结论以 `*.test.ts` 形式留仓（AGENTS.md「验证与踩坑留档铁律」）。

---

## 7. 待拍板（未决策前不开工）

1. **规范化时机**：STL 导入时**立即**规范化（慢一点，但拓扑立刻可用，失败立刻可见）／第一次需要拓扑时才惰性规范化（导入快，但失败点后移）。本方案默认前者。
2. **`meshEngines` 门禁粒度**：按 op 声明（`defineOp` 上一个字段）／按运行时装配（网格后端作为实例级冻结的一部分，类似 `createRuntime({brep, mesh})`）。本方案用前者，后者更接近既有装配风格。
3. **Phase 3 的"新实体"归属**：在识别面上拉伸出的新实体记为**新网格零件**（本方案默认）／与原网格实体布尔融合成一个零件／两者都作为独立 op。
