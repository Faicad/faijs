# 拓扑命名（TopoRef）移植与历史追踪技术实现方案（v2 重写稿）

> 状态：方案（未实施）
> 取代关系：本文是对 `2026-08-31-topology-naming-port.md`（下称「旧稿」）的**全新重写**，旧稿保留不动，不在其上修改。
> 涉及仓库：`faijs`（C:\my\Faicad\faijs）、`3d_editor`（C:\my\Faicad\3d_editor）、移植来源 `brepjs`（C:\git\OpenCascade\brepjs）。
> 关联方案：`2026-08-31-chamfer-brep-api-design.md`（倒角边选择子，本文为其补上真正的跨历史身份层）。

---

## §0 需求原文

用户原话（逐字录入，作为本方案的最高约束）：

> 我需要把 brepjs 项目的拓扑相关的代码移植过来。更新现有的 faijs 和 3d_editor 两个项目的拓扑相关处理代码和算法，因为目前的拓扑直接采用序号，无法处理历史追踪。此外，faijs 对 stl 之类的生成了近似拓扑，这部分没法做历史追踪，你判断要如何重构，也许只是简单的让数据格式兼容。
>
> 2026-08-31-topology-naming-port.md 是之前写的一份文档，但是不够准确，不够完善。你可以参考，但是需要完全写一份新的，不要改这份旧文档。
> 你需要彻底了解这三个项目的拓扑处理相关的代码。
>
> 我需要把 brepjs 拓扑相关的代码移植过来，实现可追踪的拓扑命名方案。
> 现在，请对照 faijs 和 3d_editor 项目的源代码，写一份新的技术实现的 md 方案。

由此拆解出四条硬要求：

1. 移植 brepjs 的拓扑命名/历史追踪代码，落到 faijs 引擎与 3d_editor 宿主；
2. 现状「拓扑直接采用序号」必须升级为「可跨历史追踪的命名」；
3. STL/3MF 等 mesh 近似拓扑（以及 primitive 假拓扑）无法做历史追踪，需要给出**明确的重构判断**——允许「只让数据格式兼容」这一较轻路线；
4. 只写方案，不改旧稿、不写实现代码。

---

## §1 现状（对照源码核实后的事实，非旧稿推断）

本节所有结论均来自三个仓库当前源码，给出文件路径；「事实」= 代码可直接验证，「判断」= 在事实之上的设计推断，会显式标注。

### 1.1 faijs：序号身份层已经完整，但没有「跨历史身份」

**（事实）身份全部是序号品牌字符串。** `packages/core/src/identity.ts`：

- `OccurrenceId = 'o1'`、`ShapeId = 'o1.s1'`、`FaceId = 'o1.f3'`、`EdgeId = 'o1.e7'`；数字 = `TopExp::MapShapes` 的枚举序号（1 起）。
- UI 侧 `ReferenceId = 'topology|face|o1.f3'`，只是序号的展示包装。

**（事实）选择器是「单个快照内」的列式表。** `packages/core/src/topology/`：

- `types.ts`：`SelectorManifest`（occurrences/shapes/faces/edges 四张列存表 + buffers）、`SelectorRuntime`、`Reference`；
- `build-face-ids.ts`：三角片 → 面行；`build-selector-runtime.ts`：manifest → `referenceMap` / `faceReferenceByRowIndex`；
- **没有 vertex 表**（只有面、边两级）；
- `FaceRow` 已携带 `surfaceType / area / center / normal / bbox`——这些恰好等于 brepjs 的 `GeometricHint` 字段（见 §2.2），是后续「格式兼容」的关键。

**（事实）BREP 链按 part 维护，节点已带「演化」，但是序号键。** `packages/core/src/brep/`：

- `brep-chain.ts`：**没有逐节点链表**，链状态是 `BrepChainState` 上的三个逐 part 缓存——`solidCache: Map<PartName,BrepHandle>`（某 part 有句柄即在 BREP 链上、缺失即已降级 mesh）、`faceEvolutionCache: Map<PartName,FaceEvolution>`（产出该 part 的上一步序号演化）、`meshShapeCache`；由 `runtime.ts:259/322/384` 在每个 BREP op 后写入并传入状态。遇到 mesh-only op 时按 AGENTS 红线做「链切换」（该 part 不写 solidCache），前半段保持 BREP、后半段转 mesh，**无运行时回退**。
- `face-evolution.ts`：演化的**原始形态就是 hash**。occt-wasm 高层 `*WithHistory` 返回 `BrepEvolutionData { result, modified:number[], generated:number[], deleted:number[] }`，其中 `modified` 是**分段打包**的 `[inHash, count, outHash1, outHash2, ...] × N`（即 hash→hash[] 的 1→多，文件头 61-63 行注释）；`decodeEvolution()` 用 `subShapeHashes(shape,'face',B)`（批量取 hash、**不分配句柄**）建 hash↔序号对照，把它**解码成序号键** `FaceEvolution = Map<inOrd,outOrd[]>` 供选择器/文本持久化使用。注意：布尔包装 `cut/fuse/intersectWithHistoryBrep` 虽然用 `getUnionFaceHashes` 传入了 A∪B 两边的 hash（打包结果含双方），但 `decodeEvolution(evo, a, result)` **只对基体 a 解码，工具 b 的面去向被丢弃**。
- `engine/primitives.ts` 的 `BrepEngineApi` 是对 occt-wasm 原始 kernel 的**结构化子集重声明**——`initOcctWasm()` 直接把 occt-wasm 实例 `as unknown as BrepEngineApi`（`occt-kernel/occtKernel.ts:106`），因此接口里只声明了 `cut/fuse/intersectWithHistory` 三个带历史方法，但底层实例实际具备 `index.d.ts:458-472`（3.8.4）的全部 12 个 `*WithHistory`（translate/rotate/mirror/scale/fuse/cut/intersect/fillet/chamfer/shell/offset/thicken），**新增方法只需补接口声明 + 补 face-evolution 包装，不需要写内核实现**。
- `stdlib/src/transform.ts` 的 BREP 实现走 `applyTransformBrep()`（`brep-ops.ts`，矩阵 copyTransform，**不调 WithHistory**），再由 `face-evolution.identityEvolution()` 按「刚体变换不改变面数量与顺序」合成 ordinal i→[i] 的**恒等演化**（202-222 行，注释明确说明是为绕开 rotate/scale WithHistory 签名不兼容而设）。

**（事实）内核底层原语已齐备。** `occt-kernel/topologyExt.ts` 已使用 `kernel.hashCode(h, 2147483647)`、`getSubShapes(shape,'face'|'edge'|'vertex')`（`BrepSubShapeType` 含 `'vertex'`，`engine/types.ts:106`）、`isSame(a,b)`，并在 646-668 行用 isSame 建出了 face↔edge 双向邻接序号（`faceEdgeRows / edgeFaceRows`）。即：移植 shapeRef 所需的 hash、邻接、同构判断**不需要新的 C++/wasm 能力**。

**（事实）当前没有任何 faijs op 以面/边引用为参数。** 全 `packages/stdlib/src` 检索 `FaceId/EdgeId/selector` 无消费方：

- 钻孔 `drill.ts` 用 `position + faceNormal`（几何快照）；
- 装配 `stdlib/src/compound.ts` 的 `FaceMateConstraint` 只有 `{surfaceType,center,normal}`，且 258 行注释明确写「`faceId`/`faceRowIndex` 这些键在代码中不存在」——**求解器完全不用 faceId**；
- 3d_editor 侧 `stores/tools/assemble-store.ts` 同样只把 `{faceId, surfaceType, center, normal}` 里的 center/normal 喂给 `solveFaceMate`。

**（判断）这就是「序号无法历史追踪」的具体机制**：序号只在「当前这一个 solid 快照」内有意义；一旦上游语句改参、插入/删除布尔，`TopExp::MapShapes` 的枚举顺序会变，`o1.f3` 就指向另一个面。今天能工作，是因为钻孔/装配都**绕开 id、直接存几何快照（法向/中心）**——这正是缺少命名层时的临时补丁，也是倒角方案 §2.2「序号在确定性全量重放下稳定」赌注想依赖、但被用户判定为不足的地方。

**（事实）三种拓扑来源静态判定。** `cad-runtime/runtime.ts`：`TopologySource = 'brep' | 'primitive' | 'mesh'`；BREP 从 solid 构建，primitive/mesh 由宿主 `setTopology()` 注入；`ExecutionResult.topology: Map<PartName, {source, data: SelectorRuntimeData}>`（`runtime.ts:111-149`）。

### 1.2 3d_editor：四类拓扑分桶，假拓扑只生成一次

**（事实）`stores/core/topology-store.ts`** 四个 Map 物理隔离：`stepRuntimes / glbRuntimes`（BREP 真拓扑）、`primitiveRuntimes`（基本体假拓扑）、`meshRuntimes`（STL/3MF 假拓扑），外加 `topologySources` 注册表，`getSelectorRuntime` 按来源直取、无优先级回退。文件头注释明确：假拓扑「只在加载/创建时生成一次，变更后不重新生成，旧拓扑保留使用」。

**（事实）两类假拓扑都产出与 STEP_T 同构的 `SelectorBundle`。**

- `lib/primitives-topology/`：cube/sphere/cylinder/cone/wedge 从参数**确定性**拼面/边。`cube.ts` 面序固定 `f0 +X, f1 -X, f2 +Y, f3 -Y, f4 +Z, f5 -Z`，且每面带计算好的 `normal/center/area`，并建出 face↔edge 邻接。
- `lib/mesh-feature-detection/build-mesh-topology.ts`：从三角网格做平面 BFS + 圆柱 PCA + 特征边提取，每个检出平面/圆柱面 → 一个 FaceRow（`surfaceType/area/center/normal` 齐全，187-204 行），每条特征边 → 一个 EdgeRow；face-edge 邻接留空（262-263 行）。

**（事实）拾取与代码生成链路。**

- `lib/topology/picking.ts`：`faceIds[triangle] → 面行 → runtime.faceReferenceByRowIndex → Reference`；选中态存 `selection-store.ts` 的 `selectedReferenceIds`（`topology|...` 字符串）+ `selectedRefScopedIds`。
- 代码生成：`ScriptEngine.recordFeature → Feature.buildCode（engine/features/*.ts）→ formatCodeLine（faijs codegen，参数以 JSON 字面量打印）→ appendCode`。**因此任何要写进 `.faijs` 的拓扑引用，必须是 JSON 可序列化的纯对象。**
- 宿主经 `file:../faijs/*.tgz`（当前 0.6.0）消费 `@faicad/faijs(-core/-stdlib)`，occt-wasm 同为 3.8.4。

### 1.3 brepjs：要移植的 shapeRef 到底是什么

移植源是 `src/topology/shapeRef/`（9 个文件、约 1.1k 行、**纯函数、内核抽象**），不是旧稿说的 `TopoShapeRef.ts/TopoShapeRefManager.ts/FaceRefBuilder.ts`（仓库里不存在这些文件名，旧稿此处失实）。实际构成：

| 文件 | 行数 | 职责 |
|---|---|---|
| `shapeRefTypes.ts` | 201 | `ShapeRef/EdgeRef/VertexRef/DerivedFaceRef` + 各自 hint、`RoleTable = origin→role→number[]（hash）`、Resolved/Broken 结果（带 `confidence: exact\|geometric-fallback`） |
| `shapeRefFns.ts` | 300 | `captureHint / assignRoles / createRef / updateRoles / resolveRef` |
| `scoring.ts` | 79 | `defaultScorer`：曲面类型硬门 + 法向点积≥0.707 + 质心距²≤100 + 面积 log 比 |
| `roleLookup.ts` | 59 | `roleOfFace`（hash→role 反查）、`facesForRole`（role→当前面）、距离/质心 |
| `edgeRefFns.ts` | 139 | 边 = 两邻面之交：`facesOfEdge`+反查 role 捕获，`sharedEdges`+hint 解析 |
| `vertexRefFns.ts` | 129 | 顶点 = ≥3 面交点：邻面 role 集合捕获，面顶点交集 + 位置 hint 解析 |
| `derivedFaceRefFns.ts` | 141 | 倒角/圆角「生成面」= 桥接两命名面的过渡面，法向混合过滤 |
| `refResolveFns.ts` | 164 | 四类 ref 的类型守卫、统一 `resolveLineageRef`、从零重建的 `resolveRefIn`、递归替换 op 参数的 `resolveRefParams`（仅单输入） |

配套但**不直接照搬**的两层：

- `src/kernel/occt/historyOps.ts + evolutionOps.ts`：带历史布尔/变换/修饰器，产出 **hash 键**的 `ShapeEvolution`；调用方需传入 `inputFaceHashes`；brepjs 靠自编译的 C++ `EvolutionExtractor` 批量抽取 + JS 兜底。
- `src/operations/historyFns.ts`：`ModelHistory` 参数化重放（操作日志 + `replayFrom/modifyStep`），重放时用 `resolveRefParams` 把参数里的 ref 换成活实体。

**（事实，关键）三层身份分工。** 综合源码：

1. **hash（OCCT `HashCode`，上界 INT32_MAX）是「一次执行会话内」的活句柄标识**：同一次重放中 op1→op2 句柄还在，hash 可沿演化传播；但两次独立全量重放之间句柄重建、hash 不稳定；
2. **role（语义/位置名，如 `box:top`）才是跨重放稳定的身份**，由 `assignRoles` 在每次重放开头重建 role→hash；
3. **hint（几何快照）是最后兜底**，role 对不上时全形状打分，并显式区分 exact / geometric-fallback / deleted / ambiguous / not-found。

**（事实）`updateRoles` 只消费 deleted/modified，刻意不消费 generated**（`shapeRefFns.ts:169-174` 注释：occt 系内核 generated hash 指向中间形、对布尔实测 0 个存活）；生成面（圆角/倒角/布尔缝）改由 `DerivedFaceRef` 以「桥接的两个面」lineage 命名。

### 1.4 旧稿哪里不准确（本稿的修正点）

1. 旧稿按 `TopoShapeRef/FaceRefBuilder/EdgeNameBuilder` 等不存在的文件组织移植清单；本稿按真实 9 文件 + 配套两层组织。
2. 旧稿把「序号演化」与「命名」混在一层；本稿明确**序号是快照内地址、命名是跨历史身份，两层并存、互不替换**（§2.1）。
3. 旧稿未回答「mesh/primitive 近似拓扑怎么办」；本稿给出明确决策：**统一数据格式 + 分级解析**，不伪造 hash 血缘（§5）。
4. 旧稿未识别「布尔会合并两个来源的 role 表」「faijs 边可能跨来源」这两个 brepjs 单形状模型没覆盖、而 faijs 装配/布尔必然遇到的问题（§3.4、§4.3）。
5. 旧稿未区分「引用解析降级」与 AGENTS 红线禁止的「引擎路径运行时回退」——本稿显式划清（§5.4）。

---

## §2 总体设计

### 2.1 核心决策：序号层不动，新增 TopoRef 命名层（D1）

不重写选择器/拾取/渲染栈。两层职责：

| 层 | 载体 | 生命周期 | 用途 | 改动 |
|---|---|---|---|---|
| 快照内地址层（保留） | `FaceId/EdgeId`（序号）、`SelectorManifest/Runtime` | 单个 solid 快照 | 拾取、高亮、面片映射、渲染 | 不动 |
| 跨历史身份层（新增） | `TopoRef`（纯数据，写进 `.faijs`）+ `RoleTable`（运行期、不序列化） | 跨语句、跨改参重放 | op 参数里稳定指认「同一个面/边/点」 | 本文新增 |

解析方向固定为单向：**`TopoRef`（稳定、在脚本里）→ 解析器 → 当前快照的序号 `FaceId/EdgeId` 或活 BREP 句柄**。绝不反向把序号当稳定身份存进脚本。

这与 brepjs 自身「hash 是活句柄、ShapeRef 是稳定身份」的分层同构，只是把 brepjs 的 hash 句柄角色替换为 faijs 已有的「序号 + BREP 句柄」。

### 2.2 数据类型（新增 `packages/core/src/topology/naming/types.ts`）

字段命名对齐 brepjs 以便逐函数移植，但把 brepjs 的「单 origin」扩展为「origin 可限定」，以支持布尔合流（§3.4）。全部为 readonly、JSON 安全（满足 §1.2 代码生成约束）。

```ts
// 几何提示：面。字段与 SelectorRuntime 的 FaceRow（surfaceType/area/center/normal）同源
export interface FaceHint {
  readonly kind: 'face'
  readonly surfaceType?: string
  readonly normal?: [number, number, number]
  readonly center?: [number, number, number]
  readonly area?: number
}
export interface EdgeHint {
  readonly kind: 'edge'
  readonly length?: number
  readonly midpoint?: [number, number, number]
}
export interface VertexHint { readonly kind: 'vertex'; readonly position?: [number, number, number] }
export interface DerivedFaceHint {
  readonly kind: 'derived-face'
  readonly normalA: [number, number, number]
  readonly normalB: [number, number, number]
  readonly edgeMidpoint?: [number, number, number]
}

// role 的全局限定：origin = 该面血缘起点的 part 变量名（链根），role = 该起点内的角色名
export interface RoleQualifier { readonly origin: PartName; readonly role: string }

// 面：origin+role 为主键，hint 为兜底（对应 brepjs ShapeRef）
export interface FaceTopoRef { readonly kind: 'face'; readonly origin: PartName; readonly role: string; readonly hint: FaceHint }
// 边：= 两邻面之交。faijs 扩展：两面可能来自布尔合流后的不同 origin，故用 RoleQualifier 而非裸 role 串
export interface EdgeTopoRef { readonly kind: 'edge'; readonly faces: readonly [RoleQualifier, RoleQualifier]; readonly hint: EdgeHint }
// 顶点：≥3 邻面之交
export interface VertexTopoRef { readonly kind: 'vertex'; readonly faces: readonly RoleQualifier[]; readonly hint: VertexHint }
// 生成面（倒角斜面/圆角面）：桥接两面
export interface DerivedFaceTopoRef {
  readonly kind: 'derived-face'; readonly op: 'fillet' | 'chamfer'
  readonly between: readonly [RoleQualifier, RoleQualifier]; readonly hint: DerivedFaceHint
}
export type TopoRef = FaceTopoRef | EdgeTopoRef | VertexTopoRef | DerivedFaceTopoRef

// 运行期 role 表（不写进脚本）：origin(链根 PartName) → role → 当前面 hash 列表（1→多分裂时多个）
export type RoleTable = ReadonlyMap<PartName, ReadonlyMap<string, readonly number[]>>

// 解析结果：显式三态，禁止静默取错
export type TopoResolution<T> =
  | { readonly ok: true; readonly entity: T; readonly ordinal: number; readonly confidence: 'exact' | 'geometric-fallback' }
  | { readonly ok: false; readonly reason: 'deleted' | 'ambiguous' | 'not-found'; readonly candidatesOrdinal?: readonly number[] }
```

短写形态（手写脚本友好，对齐倒角方案）：`FaceTopoRef | FaceId`（字符串 `'o1.f3'`）、`EdgeTopoRef | EdgeId`。短写只给序号，解析时走「当前快照直取 + hint 缺失则不纠错」的快路径。

### 2.3 RoleTable 的属主：BREP 链，不是 op、也不是宿主（D2）

brepjs 把 RoleTable 留给调用方（playground/historyFns）。faijs 里唯一正确的属主是 **`BrepChainState`（逐 part 缓存）**，与现有 `solidCache / faceEvolutionCache` 并列新增 `roleTableCache: Map<PartName, RoleTable>`，因为只有链状态同时握有：每个 part 的当前句柄、上一步演化、输入 part 是谁。

- 链根（primitive / load STEP / 导入产出的 part）建表：`assignRoles(solid, opType)`（§3.2），写入 `roleTableCache[part]`；
- 每个后续 BREP op：读输入 part 的表 + 本次 hash 演化，算出输出 part 的表并回写（§3.3），写入点与 `runtime.ts:322 faceEvolutionCache.set` 同处；
- 布尔合流：合并两个输入 part 的表（§3.4）；
- RoleTable **只活在一次执行内**，随 `CadRuntime.execute` 确定性重建（执行结束随 `runtime.ts:1265` 一并 clear），**不序列化、不进 `.faijs`、不进 STEP_T**。脚本里只存 TopoRef。

（判断）这与 faijs「纯文本源码 + 确定性全量重放」模型天然契合：每次重放都从链根重新 assign、沿同一条语句序列重新传播，得到与本次句柄一致的 role→hash。

### 2.4 hash 键演化：打包结果本身就是 hash 键，新增一个并列解码器即可（D3）

brepjs 需要自编译 C++ `EvolutionExtractor`；faijs **不需要**，而且比「从序号换算」更近一步：`*WithHistory` 返回的打包 `modified = [inHash,count,outHash...]` **本身就是 hash→hash[] 的 1→多映射**，现在的 `decodeEvolution` 只是把它解成了序号。新增一个并列的纯函数 `decodeHashEvolution(evo): { modified: Map<number,number[]>, deleted: number[] }`，直接按同一分段格式解出 hash 键版本：

```
idx=0; while idx<modified.length:
  inHash=modified[idx]; count=modified[idx+1]
  outHashes=modified.slice(idx+2, idx+2+count)
  hashEvo.modified.set(inHash, outHashes)
  idx += 2+count
hashEvo.deleted = [...evo.deleted]   // 已是输入面 hash
（generated 不进 role 传播，§1.3）
```

它与现有 `decodeEvolution` **同源、同一次内核调用**，一个供 role 传播（hash 键）、一个供选择器/文本（序号键），不新增任何 wasm 调用，也不需要 `getSubShapes` 逐句柄 `hashCode`。需要 hash↔序号对照时统一用 `subShapeHashes`（批量、零句柄分配）；hash 碰撞按 topologyExt 既有办法用 `isSame` 消解（`findOrdinal`，topologyExt.ts:555-569）。`subShapeHashes` 与 `getSubShapes` 同走 `TopExp::MapShapes+IndexedMap`、逐位同序（face-evolution.ts:10-12 已声明），是本方案成立的前提，M1 补成断言（§7-R4）。

**变换类（translate/rotate/scale/mirror）**：当前不调 WithHistory、用 `identityEvolution` 合成序号恒等。刚体平移/旋转下面 1:1 保留，role 传播可同样按「输入第 i 面 hash → 输出第 i 面 hash」用 `subShapeHashes` 两端对齐合成 hash 恒等，M1 先沿用；M2 再切到 occt-wasm 已有的 `translate/rotate/mirror/scaleWithHistory`（只需在 `BrepEngineApi` 补声明 + 在 face-evolution 补包装，签名见 `index.d.ts:458-472`）以覆盖镜像（镜像反向、法向变化，语义角色需重判，见 §7-R3）。

### 2.5 解析总算法（op 执行时把 TopoRef 变活）

新增 `topology/naming/resolver.ts`，输入一个 `ResolutionContext`（封装「当前 part 的活 solid+kernel」或「mesh/primitive 的 manifest 行」+ 该 part 的 RoleTable），输出 §2.2 的 `TopoResolution`。以面为例（移植 `shapeRefFns.resolveRef`）：

```
resolveFace(ref, ctx):
  1. 精确：hashes = ctx.roleTable[ref.origin]?.[ref.role]
     - 当前面中 hash 命中恰好 1 个 → exact，返回其 ordinal/句柄
     - 命中 0 个 → deleted（该 role 被这一步删掉）
     - 命中多个（1→多分裂）→ 只在这几个候选间用 hint 打分（§3.5），不与全形状竞争
  2. 几何兜底（role 缺失 / 上一步未命中）：在「当前全部面」上按 hint 打分
     - BREP：用 kernel 现场算 surfaceType/normal/center/area
     - mesh/primitive：直接读 FaceRow 同名字段（§5）
  3. 最优分 > MIN_SCORE 且与次优差 ≥ AMBIGUITY_THRESHOLD → geometric-fallback
     否则 ambiguous（并列候选）/ not-found（无超阈值候选）
```

边/顶点/生成面分别移植 `edgeRefFns / vertexRefFns / derivedFaceRefFns`，邻接来源：

- BREP：`getSubShapes(face,'edge'|'vertex')` + isSame（topologyExt 已有 face→edge，可复用并补 edge→faces、face→vertex）；
- mesh/primitive：用 manifest 的 `faceEdgeRows/edgeFaceRows`（primitive 已建，mesh 为空 → 边 lineage 在 mesh 上不可用，降级为 hint，§5.3）。

**任何一步定不了案就抛带错误码的异常，绝不静默拿序号硬取**（这同时修掉倒角方案 §2.4 点名的 `geom.ts` 序号错配静默问题）。

---

## §3 faijs 引擎实现

### 3.1 文件清单（新增）

```
packages/core/src/topology/naming/
  types.ts            # §2.2 全部类型 + 错误码枚举
  geom-hint.ts        # captureFaceHint(kernel, faceHandle)；faceRowToHint(row, colIdx)
  roles.ts            # assignRoles / propagateRoles / mergeRoleTables / roleOfOrdinal
  score.ts            # defaultFaceScorer（BREP 现场几何）+ scoreFaceRow（manifest 行）两套候选打分
  resolve-face.ts     # resolveFaceTopo
  resolve-edge.ts     # resolveEdgeTopo
  resolve-vertex.ts   # resolveVertexTopo（P2，依赖 vertex 邻接）
  resolve-derived.ts  # resolveDerivedFaceTopo（倒角/圆角，P3）
  resolver.ts         # 统一 ResolutionContext + resolveTopoRef + 短写解析
  ref-params.ts       # 递归把 op 参数里的 TopoRef 替换为解析后的 {ordinal/handle}（移植 resolveRefParams，扩展多输入显式标注 origin）
  index.ts
```

### 3.2 assignRoles：语义命名对齐 faijs 基本体约定（移植 + 改造）

移植 `shapeRefFns.assignRoles` 的「语义优先、位置兜底」：

- 语义命名器按 faijs 单位/轴向契约（mm、+Z 向上、角度用度）实现：
  - `box`：按外法向主轴给 `box:top/bottom/front/back/left/right`（阈值 abs(component)>0.9）；
  - `cylinder/cone`（Z 轴）：`:top/:bottom` 端盖 + `:lateral` 侧立面；`sphere`：`sphere:surface`；
  - 其余/认不出的面：位置名 `${opType}:face_${i}`，保证每面必有 role。
- 与 3d_editor `primitives-topology/cube.ts` 的固定面序（+X,-X,+Y,-Y,+Z,-Z）**建立对照表并加测试锁定**，使 BREP 真拓扑与 primitive 假拓扑对同一立方体给出一致的语义名（§5 兼容的基础）。
- assign 时只保留 `hash + hint`，**不保留面句柄**（避免 wasm 句柄生命周期泄漏；brepjs 用 transient 子形状 + finally dispose，faijs 在 `getSubShapes` 后只取 hash/几何量）。

### 3.3 沿链传播（改 `brep-chain.ts` + `runtime.ts` + `module-executor.ts`）

- `BrepChainState` 与 `runtime` 各增一个 `roleTableCache: Map<PartName, RoleTable>`，初始化/clear 点对齐 `faceEvolutionCache`（`brep-chain.ts:102/123/142`、`runtime.ts:259/384/1265`、`preview-exec.ts:60`）。
- 链根：primitive/load 产出 part 时建表写入。
- 单父 op（变换/倒角/钻孔等）：`roleTableCache[out] = propagateRoles(roleTableCache[in], decodeHashEvolution(evo))`，移植 `nextHashes`：deleted 丢弃、modified 用全部后继替换（保留 1→多）、未变保留；身份槽 → 缓存的同步点对齐 `module-executor.ts:90`。
- 与现有序号演化的关系：`decodeEvolution`（序号键，进 `faceEvolutionCache`）继续服务选择器/可视化；`decodeHashEvolution`（hash 键，进 `roleTableCache`）服务命名；二者由同一次 `*WithHistory` 的打包结果解出，不重复调用内核。

### 3.4 布尔合流：合并两个来源的 role 表（faijs 对 brepjs 的必要扩展）

faijs 布尔有 target + tool 两个输入，各自带链根来源；brepjs 是单形状模型，没这问题。规则：

```
resultTable = {}
for origin,roles in roleTableCache[targetPart]: resultTable[origin] = propagate(roles, targetHashEvo)
for origin,roles in roleTableCache[toolPart]:   resultTable[origin] = propagate(roles, toolHashEvo)
# 布尔新生成的缝面/刃面：以「本次布尔语句」为新 origin，位置名命名
resultTable[thisStmtId] = assignGeneratedPositionalRoles(...)
roleTableCache[outPart] = resultTable
```

现有 `getUnionFaceHashes` 已把 A∪B 两边 hash 传入、打包 `modified` 已含双方去向，但 `cut/fuse/intersectWithHistoryBrep` 只对基体 a 调了一次 `decodeEvolution`。补法零额外内核调用：对同一份 `evo` 分别 `decodeHashEvolution` 后按「inHash 属于 A 还是 B」（用 `subShapeHashes(a)`/`subShapeHashes(b)` 两个集合判定归属）拆成 A、B 两张 hash 演化，各自传播各自的 role 表；布尔新缝面以本次语句为新 origin 给位置名。

### 3.5 打分器两套实现（移植 scoring.ts）

- `defaultFaceScorer`（BREP）：移植阈值（类型不符直接 -∞、法向点积 <0.707 拒、质心距²>100 拒、面积 |log 比|>1 扣分；最优阈值 MIN_SCORE=0.5、模糊带 0.1）。**阈值常量化并在 JSDoc 写明 mm 单位假设**，faijs 契约就是 mm，可直接沿用。
- `scoreFaceRow`（mesh/primitive）：候选不是句柄而是 FaceRow，用行内 `surfaceType/normal/center/area` 走同一套权重，保证两条路径打分口径一致、结果可比。

### 3.6 op 如何拿到解析结果：`resolveTopoArgs`（不改 defineOp 形态）

`define-op.ts` 的 `brepImpl(...args)` 签名保持不变。新增辅助：op 的 brep 实现内部对「含 TopoRef 的参数」调用

```ts
resolveTopoArgs(params, { kernel, solid: inputSolid, roleTable: roleTableCache.get(inputPart) })
```

它把每个 TopoRef 解析为 `{ ordinal, handle, confidence }`（移植 `refResolveFns.resolveRefParams` 的递归，数组/嵌套对象都下钻）。区别于 brepjs「仅单输入自动解析」：faijs 的 TopoRef 自带 `origin`（§2.2），多输入布尔也能按 origin 定位到对应输入 part 的表，因此**可支持多输入**——这是 faijs 相对 brepjs 的增强点。解析失败按 §2.5 抛错码（如 `E_TOPO_FACE_DELETED / E_TOPO_AMBIGUOUS / E_TOPO_NOT_FOUND`），纳入 args 校验。

### 3.7 向宿主暴露命名数据（改 ExecutionResult）

3d_editor 拾取时要把「选中的序号」反查成 role 才能造 TopoRef，不能让宿主为这件事再打一次 wasm。在 `ExecutionResult` 增加（与 `topology` 并列、选择器 manifest 不改动）：

```ts
naming?: Map<PartName, {
  source: TopologySource
  // 序号(1起) → { origin, role, hint }，宿主 O(1) 反查；BREP/primitive 完整，mesh 只给 hint（role 为空串）
  faceNaming: ReadonlyArray<{ origin: PartName; role: string; hint: FaceHint }>
  edgeNaming: ReadonlyArray<{ faces: [RoleQualifier, RoleQualifier] | null; hint: EdgeHint }>
}>
```

- BREP：由链节点 roleTable + `roleOfOrdinal`（hash→role 反查的序号版）+ captureHint 生成；
- primitive：由语义命名器直接按固定面序生成（§3.2 对照表）；
- mesh：只填 hint（取自 FaceRow），`role=''`、`origin=该 part`，表示「只能几何兜底」。

根门面在 `./browser`（及 `./node`）导出 naming 类型与 `captureTopoRef(runtime, naming, referenceId)` 纯函数，供宿主统一构造 TopoRef。

### 3.8 内核/API 扩展点清单

- `engine/primitives.ts` `BrepEngineApi`：补声明 `translate/rotate/mirror/scale/fillet/chamfer/shell/thicken/offsetWithHistory`（底层 occt-wasm 实例已实现，接口是结构化子集重声明，见 §1.1；M2/M3）；`brep/face-evolution.ts` 照布尔三兄弟的模式补对应 `*WithHistoryBrep` 包装与 `decodeHashEvolution`，fillet/chamfer 的演化对应 brepjs `modifierWithEvolution`（修饰器 builder 的 Modified/IsDeleted 已由 occt-wasm 高层封装进打包结果）。
- `brep/face-evolution.ts`：增 §2.4 hash 键解码 + 布尔按 A/B 归属拆演化（§3.4）。
- `occt-kernel/topologyExt.ts`：补 edge→faces、face→vertex 邻接查询（edge/vertex lineage 用，face→edge 已有）；选择器 manifest 输出保持不变。
- 根 `src/index.ts` 等 exports：`./browser`、`./node` 增导 naming 模块；不新增第 12 个 exports 子路径（命名属于核心公共能力，随 browser/node 走）。

---

## §4 边 / 顶点 / 生成面的分级落地

### 4.1 面（M1-M2，最高优先）

面是钻孔/装配/倒角选面的基础，最先落地全链路：assign → propagate → resolve → ExecutionResult.naming → 宿主 capture。

### 4.2 边（M3，对齐倒角方案）

`EdgeTopoRef` 取代倒角方案 §2.2 里「`faces?:[FaceId,FaceId]` 裸序号」的临时形态：两个邻面改用 `RoleQualifier`（带 origin 的稳定 role），`length/midpoint` 仍是 hint。解析 = 两 role 解析到当前面 → 取公共边（`sharedEdges` 同构）→ 多公共边时 hint 裁决。倒角方案 §2.4 的「三步解析（序号快取 → lineage 校验 → hint 重定位）」保留为本解析器在「短写 EdgeId / 完整 EdgeTopoRef」两种入参下的具体策略，错误码合并到 §3.6 同一套。

### 4.3 跨来源边（布尔缝边，faijs 扩展）

布尔后一条边可能邻接一个 target 来源面、一个 tool 来源面。brepjs `EdgeRef.faceRoles` 是单 origin 的两个 role 串，无法表达；本方案 `EdgeTopoRef.faces` 用两个 `RoleQualifier` 分别带 origin（§2.2），解析时到各自 origin 表取面。补单测：两立方体 fuse 后缝边的捕获与改参重放。

### 4.4 顶点（P2）

faijs 选择器无 vertex 表、UI 也暂无顶点拾取。`VertexTopoRef`（≥3 面交点）类型与解析器在 M3 一并移植（内核 `getSubShapes(face,'vertex')` 可用），但**不接 UI、不进 manifest**，仅为倒角/定位类 op 的内部参数预留；启用顶点拾取另立任务。

### 4.5 生成面（M3，derived）

`DerivedFaceTopoRef` 服务「先倒角、再对倒角面做操作」这类跨特征引用：在**操作前**形状上捕获被倒边的两邻面 role + 外法向 + 边中点；操作后在结果里找「同时邻接这两面、法向同时正比于两条法向」的过渡面（移植 normal-blend 过滤）。与 §3.8 chamfer/fillet WithHistory 同期落地。

---

## §5 mesh / primitive 近似拓扑的重构决策（回答用户第 3 点）

### 5.1 结论：不伪造 hash 血缘，走「统一格式 + 分级解析」

**（判断）STL/3MF 的 mesh 假拓扑、以及 mesh 模式下的 primitive 假拓扑，本质上没有 OCCT solid，就没有 hash、没有演化、没有链，无法也不应伪造一条历史血缘链。** 正确做法正是用户提示的较轻路线——**让数据格式兼容**：同一套 TopoRef 结构贯穿三种来源，只在「能提供多少身份信息」上分级。

| 来源 | 有无 solid | role | hint | 解析能力 | confidence |
|---|---|---|---|---|---|
| brep（STEP/GLB STEP_T/brep 链） | 有 | 语义+位置，沿演化传播 | 有 | role 精确 + 分裂裁决 + 几何兜底 | exact / geometric-fallback |
| primitive（假拓扑，参数确定） | 无 | **语义**（固定面序+法向直接命名，§3.2 对照表） | 有（FaceRow 全字段） | role 在「这份不变的假拓扑」内精确；无跨语句演化 | exact（创建快照内）/ geometric-fallback |
| mesh（STL/3MF 特征检测） | 无 | 无（`role=''`） | 有（surfaceType/normal/center/area） | **仅几何兜底** | 恒 geometric-fallback |

### 5.2 primitive：把「固定面序」升级为「语义 role」，零几何成本

`primitives-topology/*.ts` 本就按参数确定性生成、且带 normal/center。只需在生成 SelectorBundle 的同时，用与 BREP 同一套命名器（§3.2）按固定面序产出 `faceNaming`（cube 的 f2 即 `box:top` 等）。于是：

- primitive 上选面，捕获的是带语义 role 的完整 FaceTopoRef；
- 该 part 之后若一直走 mesh，role 在这份假拓扑内始终有效（假拓扑只生成一次、面序不变）；
- 不需要 manifold 提供历史。

### 5.3 mesh（STL）：只做 hint 级引用，并把不确定性显式化

- `build-mesh-topology` 输出**结构不变**（仍是 SelectorBundle），`ExecutionResult.naming` 对 mesh 只填 hint、role 留空；
- 在 STL 上选面 → 捕获 `FaceTopoRef{ role:'', hint:{surfaceType,normal,center,area} }`；
- 解析时走 `scoreFaceRow` 在（可能已陈旧的）FaceRow 里找最匹配面；并列/无匹配 → ambiguous/not-found，**UI 明确提示「网格模型只能按几何特征近似追踪，模型改动后可能失效」**，不假装精确。
- mesh 的 edge-face 邻接当前为空（build-mesh-topology.ts:262），故 STL 上不产出 EdgeTopoRef lineage，只能给边 hint；这是已知能力边界，写进 JSDoc 与用户提示。

### 5.4 BREP→mesh 链切换：身份降级，不是路径回退（守住 AGENTS 红线）

当一个 part 在链中途遇到 mesh-only op（sdf/knurl/load STL 等），按现有红线「链切换」：前半 BREP、后半 mesh。命名层行为：

- 切换点：solid 句柄消失、hash 血缘终止，但**已累积的 `{origin,role}` 与 hint 作为纯数据保留**；
- 切换后解析同一 TopoRef：无活 solid → 自动走 §5.3 的 manifest 行几何兜底；能对上就 geometric-fallback，对不上就报错；
- **这属于「引用解析」层面的降级（reference resolution degradation），不是 AGENTS 禁止的「引擎路径运行时回退」**：走 mesh 还是 BREP 仍由静态规则在执行前定死，解析器不会、也无权把 mesh 执行改回 BREP。代码评审与文档中必须用这两个不同术语，避免混淆。

### 5.5 「假拓扑只生成一次、陈旧保留」规则不变

命名层不要求、也不触发假拓扑重新生成（现有 topology-store 注释的规则保留）。命名只读取假拓扑行做匹配；陈旧导致的匹配失败按三态显式上报，而非靠重新检测掩盖。

---

## §6 3d_editor 宿主实现

### 6.1 捕获：从选中 Reference 造 TopoRef（新增 `src/lib/topology/capture-topo-ref.ts` 宿主胶水）

faijs 导出纯构造函数 `captureTopoRef(ordinal, namingRow)`（§3.7，不含任何前端状态）；3d_editor 新增的 `capture-topo-ref.ts` 只负责取前端状态、调用它。输入 `fileId + ReferenceId`，输出可直接塞进 op 参数的 TopoRef：

```
1. selection-store 取 scopedId → term PartName；
2. 从 ScriptEngine 缓存的最近一次 ExecutionResult.naming 取该 part 的 faceNaming/edgeNaming；
3. Reference 的 ordinal（'o1.f3'→3）→ naming 行 → {origin,role,hint}；
   - BREP/primitive：得到完整 FaceTopoRef；
   - mesh：role='' 的 hint-only ref（§5.3）；
4. 边：用 edgeNaming 的两邻面 RoleQualifier + length/midpoint 组 EdgeTopoRef。
```

`ScriptEngine` 需缓存 `ExecutionResult.naming`（与现在缓存 result.topology 同处，`_rebuildBrepTopology/ commitSceneResult` 附近）。

### 6.2 代码生成：Feature.buildCode 发 TopoRef 字面量

- 需要面/边的 Feature（先做装配、钻孔；倒角随其自身方案）在 `buildArgs` 里把原先的 `faceNormal/position` 或裸 faceId **替换/增补**为 `captureTopoRef()` 的纯对象；`formatCodeLine` 以 JSON 字面量打印，得到形如：

  ```js
  part2 = cad.chamfer(part2, { edges: [ { kind:'edge',
    faces:[{origin:'part1',role:'box:top'},{origin:'part1',role:'box:front'}],
    hint:{length:20,midpoint:[0,-10,10]} } ], type:'equal', width:2 })
  ```

- **向后兼容**：装配 `TopoFaceRef`/`FaceMateConstraint` 保留现有 `center/normal`（solveFaceMate 仍用），**新增** `topoRef` 字段，不删旧字段，保证旧脚本/旧快照可回放；drill 的 `position/faceNormal` 同理保留，新增可选 `face` TopoRef。

### 6.3 拾取与展示

- `useTopologyPicking / SelectionInfoOverlay`：悬停/选中时若该 part 是 mesh 来源且 role 为空，提示「近似（几何）追踪」；BREP 显示语义 role（如 `box:top`）比裸 `o1.f3` 更可读。
- `topology-store` 四 Map 结构不动；naming 数据随 `ScriptEngine` 结果缓存，不进 topology-store（避免再开一套生命周期桶）。

### 6.4 版本与联调

- faijs 按 AGENTS「打包发布前必须更新版本号」先升 minor（0.6.0 → 0.7.0，新能力、向后兼容），`npm run pack` 后 3d_editor `package.json` 三个 `file:` tgz 版本同步；
- 3d_editor 不直接碰 wasm 做命名反查，全部经 faijs 导出的 `captureTopoRef / resolveTopoRef`，保持「宿主不重算引擎事实」的既有边界。

---

## §7 风险与对冲

- **R1 hash 会话内稳定性**：HashCode 基于句柄，必须保证「assign 与 propagate/resolve 在同一次执行、同一 wasm 堆」内完成；RoleTable 不跨执行缓存、不序列化即天然规避。补测：同一脚本两次 execute，role 解析结果一致而 hash 可以不同。
- **R2 generated 不可靠**：遵循 brepjs 实测结论，布尔 generated 不进 role 传播，缝面用位置名、倒角面用 derived lineage，不依赖 generated hash。
- **R3 镜像/非刚体变换后的语义角色**：镜像翻转法向，`box:top` 可能变 `box:bottom`。M2 切真实 WithHistory 后，镜像节点按演化结果重判语义 role（而非沿用旧 role）；在那之前镜像 op 标记为「role 需几何复核」，解析强制走 hint 并标注。
- **R4 序号↔hash 枚举一致性**：hash 键解码与序号键解码依赖 `subShapeHashes` / `getSubShapes` / topologyExt 三者同一 `TopExp::MapShapes` 枚举顺序。以单测锁定「同一 solid 上 subShapeHashes 第 i 项 == getSubShapes 第 i 个的 hashCode == topologyExt manifest 第 i 行」（face-evolution.ts:10-12 与 topologyExt.ts:600-604 已声明，补成断言）。
- **R5 对称几何歧义**：立方体 6 面全等、球单面，hint 也可能分不开。语义 role（法向主轴）在规范朝向下可分；旋转到非主轴朝向时 role 退化为位置名、hint 失效 → 明确 ambiguous，让用户/上层补约束，绝不随机选。
- **R6 mesh 陈旧误配**：STL 变更后旧假拓扑几何对不上，hint 可能错配。用「类型硬门 + 法向阈值 + 面积比」多重门限，宁报 not-found/ambiguous；UI 标注近似性质（§5.3）。
- **R7 句柄生命周期**：assign/resolve 中 `getSubShapes` 产出的临时面句柄，读完 hash/几何量后不挂到 RoleTable（只存 number/number[]），避免 wasm 内存泄漏；对齐 brepjs transient dispose 纪律与 faijs 现有 handle 归属约定。
- **R8 origin（链根变量）在编辑下的稳定性**：origin 用脚本中的 part 变量名；语句增删导致变量改名时，由既有 codegen/IR 重排机制像处理普通输入变量引用一样同步改写 TopoRef 内 origin（与跨 part 输入引用同一套机制），不另造 id 体系。补测：上游插入一条语句后，下游 TopoRef 仍解析到同一语义面。
- **R9 范围蔓延**：选择器/拾取/渲染/STEP_T 列式格式一律不改；命名层是叠加层。vertex 不接 UI（§4.4）。

---

## §8 里程碑与验收

> 严格遵循 AGENTS「开发完成后的测试步骤」：先写/跑自身测试 → 跑受影响测试 → 全绿才跑一次 CI（`scripts/ci.ps1`），之后只复跑失败项，不靠 CI 找 bug。

**M0 类型与纯函数移植（无内核依赖）**
- 落地 `naming/types.ts、score.ts、geom-hint.ts（行版）` 与 roles 的纯逻辑（nextHashes/propagate/merge）；
- 把 brepjs `shapeRef.test.ts / shapeRefEditReplay / Edge / Vertex / Derived` 用「句柄→可枚举候选」的适配接口改写为 faijs 单测（不 init wasm 的部分先全绿）。

**M1 hash 键演化解码 + 链上 RoleTable（BREP 布尔/变换传播）**
- §2.4 `decodeHashEvolution`、§3.3 传播、§3.4 布尔 A/B 拆流合表；
- 验收：box→fuse→cut 链上，`box:bottom` 等未受影响面 exact 命中；被切面 1→多分裂时只在后继内裁决（移植 shapeRefIntegration 用例）；布尔后能解析「来自工具 b」的面。

**M2 面 TopoRef 全链路 + 内核补全 + ExecutionResult.naming**
- resolve-face/ref-params/resolver、`./browser`/`./node` 导出、`captureTopoRef`；补 translate/rotate/scale/mirror WithHistory 包装；
- 验收：`.faijs` 参数携带 FaceTopoRef，改上游参数后全量重放仍命中同一语义面；错误码三态有测试；`faijs-cli run` 导出 STEP 正常。

**M3 边/生成面（对接倒角方案）+ 顶点类型预留**
- resolve-edge/derived/vertex、edge→faces 与 face→vertex 邻接、fillet/chamfer WithHistory；跨来源缝边用例（§4.3）。

**M4 mesh/primitive 兼容**
- primitive 语义 naming、mesh hint-only naming、链切换降级（§5）；验收：cube 假拓扑与 BREP 同语义名对照一致；STL 选面解析为 geometric-fallback，篡改网格后正确报 ambiguous/not-found。

**M5 3d_editor 集成**
- capture-topo-ref、ScriptEngine 缓存 naming、装配/钻孔 Feature 增补 topoRef（保留旧字段）、选中态近似提示；e2e：建盒→选面→装配/钻孔→改盒参数重放，引用不漂移。

**M6 文档/契约/发布**
- 更新 `docs/api-contract.md`（TopoRef 是参数层契约）、`docs/ops-api-inventory.md`（受影响 op 的参数形态）、必要 Agent Note；`npm run doc-sync` 12 项门禁；升版本、`npm run pack`、3d_editor tgz 同步；全量 CI。

### 测试分层清单

- `packages/core/src/topology/naming/*.test.ts`：纯函数（传播/合并/打分/三态）；
- `packages/core/src/brep/*.test.ts`：hash 键解码、布尔 A/B 双输入演化、链切换命名降级（parity 测试 beforeAll `initOcctWasm()`）；
- `packages/tests/faijs/`：新增带 TopoRef 参数的 `.faijs` fixture（面引用改参重放、倒角边引用、装配）；
- stderr 零容忍：故意触发的失败解析必须 spy `console.warn/error` 并断言；
- 3d_editor：capture/代码生成 roundtrip、mesh 近似提示、旧脚本兼容（无 topoRef 字段仍可跑）。

---

## §9 调研足迹（源码依据，便于复核）

- faijs：根 `src/identity.ts`、`src/define-op.ts`、`src/shape.ts`、`src/runtime-state.ts`；`topology/{types,build-face-ids,build-selector-runtime}.ts`；`brep/{brep-chain,face-evolution,brep-topology,brep-ops}.ts`；`brep/engine/{types,primitives}.ts`、`brep/engine/adapters/{occt,brep-mock}.ts`；`occt-kernel/{occtKernel,topologyExt,highLevelApi}.ts`（initOcctWasm 直接 cast 原始 kernel）；`cad-runtime/{runtime,module-executor}.ts`；`stdlib/src/{compound,transform,boolean,drill,primitives}.ts`；`node_modules/occt-wasm/dist/index.d.ts:458-472`、`types.d.ts(EvolutionData)`。faijs 自身不使用 `mapShapesAndAncestors`（那是 brepjs 的抽取方式），演化统一来自 occt-wasm 高层 `*WithHistory` 的打包 hash 数组。
- 3d_editor：`stores/core/{selection-store,topology-store}.ts`；`stores/tools/assemble-store.ts`；`lib/topology/picking.ts`；`lib/mesh-feature-detection/build-mesh-topology.ts`；`lib/primitives-topology/{build-primitive-topology,cube}.ts`；`engine/script-engine/ScriptEngine.ts`；`engine/features/{types,drill}.ts`；`package.json`（faijs 0.6.0 tgz / occt-wasm 3.8.4）。
- brepjs：`src/topology/shapeRef/{shapeRefTypes,shapeRefFns,scoring,roleLookup,edgeRefFns,vertexRefFns,derivedFaceRefFns,refResolveFns,index}.ts`；`src/kernel/occt/{historyOps,evolutionOps}.ts`；`src/operations/historyFns.ts`；`src/topology/adjacencyFns.ts`；`tests/shapeRef*.test.ts`。
- 初始拓扑定义：`3d_editor/docs/step-topology-implementation.md`；brepjs 分析：`brepjs/notes/brepjs-toponaming-and-history-analysis.md`；旧稿（仅参考、不修改）：`docs/plans/2026-08-31-topology-naming-port.md`。
