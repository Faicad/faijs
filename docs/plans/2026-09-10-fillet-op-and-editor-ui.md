# fillet（圆角）op 与 3d_editor 圆角 UI 开发计划

- 状态：**方案（未实施）**
- 日期：2026-09-10
- 范围：`packages/core`（faijs 引擎与脚本面）+ `../3d_editor`（圆角 UI）
- 交付里程碑：**M1 = 等半径圆角（含 UI）**；**M2 = 变半径 + 几何限定符 + 过渡面命名**。M1 可独立交付，M2 依赖 M1。

> 本文所有行号均于 2026-09-10 对当前工作区代码核对过。faijs 处于高频重构期，动手前若距本文日期超过数天，请先按 §1 的表格复核关键点（尤其是 `primitives.ts` / `build-naming.ts` / 3d_editor 的 `features/types.ts`）。

## 0. 需求原文

> 现在，写一份开发计划文档，我需要给.fai.js脚本提供圆角fillet的功能，并且在../3d_editor项目完成对应的UI功能。你可以参考chamfer的设计开发，核心是设计好fillet的接口api，注意边拓扑的问题。
>
> 此外，目前cq-compa里的cadquery兼容的边选择器语法，能够用在.fai.js自己的倒角、圆角的边选择中吗？

两个交付：① `.fai.js` 脚本面 `cad.fillet` 的接口契约与实现路径；② 3d_editor 的圆角 UI（照 chamfer 的形态做）。核心难点是**边拓扑**——选哪条边、这条边在圆角之后还指不指得回来。

## 1. 现状（代码事实）

### 1.1 脚本面没有 fillet

`packages/core/src/lang/symbol-table.generated.ts` 是 `check()` 的符号表（机器生成，禁手改），69 个键里没有 `fillet`，也没有任何 round/fillet 别名。UI 通道写 `cad.fillet(...)` 会在 `lang/metadata-extractor.ts:1619` 抛 `E_REFERENCE: function "fillet" does not exist in this script`。

底层其实都齐了，缺口只在"投不投脚本面"：

| 层 | 现状 | 位置 |
|---|---|---|
| OCCT 内核 | `fillet(solid, edges[], radius)` / `filletBatch(ops[])` / `filletVariable(solid, edge, r1, r2)` / `filletWithHistory(solid, edges[], radius, hashes, bound)` | `node_modules/occt-wasm/dist/index.d.ts:135,241,455,461` |
| vendored brepjs 运行期对象 | `fillet` / `filletVariable` / `filletWithHistory` / `chamferWithHistory` / `defeature` 全部存在 | `vendored/brepjs/kernel/occtWasm/occtWasmAdapter.ts:677,719,1011,1029,733` |
| vendored brepjs 声明层 | `fillet`（:18）/ `filletVariable`（:137）已投影 | `vendored/brepjs/kernel/occtWasm/modifierOps.ts` |
| brepjs 兼容面 | `fillet` 已生成 compatOp 投影 | `api/generated/topology.ts:413` |
| faijs 引擎接口 | **只有** `chamfer`（:58）/ `chamferDistAngle`（:63），**没有 fillet** | `brep/engine/primitives.ts` |
| cad 脚本面 | 无（`arg-spec.ts:2799-2804` 的 fillet 条目没有 `scriptFace`） | `api/generated/script-face.ts:17-45` |

⚠️ **两条会导致误判的既有事实**：

1. **vendored 的 `fillet()` 只支持统一半径。** 它宣称支持 `[r1,r2]` 与 per-edge 函数半径，但内部过 `resolveUniformRadius`（`vendored/brepjs/kernel/occtWasm/helpers.ts:132-141`）：数组取 `radius[0]`、函数只问 `edges[0]` 再取 `val[0]`——**第二个半径被静默丢弃**。因此变半径**不能**复用 `api/generated/topology.ts:413` 那条投影，必须走 `filletVariable`。
2. **`occt.ts:67` 的编译期守卫不兜底。** `initOcctWasm()` 以 `as unknown as BrepEngineApi` 返回（`occt-kernel/occtKernel.ts:87`），`type _AssertOcctApi = AssertSatisfiesBrepEngineApi<...>` 断言的是**强转后的声明类型**，永远通过。给 `BrepEngineApi` 加方法后，OCCT 适配器实际有没有该方法**编译器不会告诉你**，只能靠实跑验证。P0 完成后必须立刻跑一个真 OCCT 的最小用例。

### 1.2 chamfer 的既有形态（fillet 的参照物）

`api/chamfer.ts:239-240`：`defineOp({ capabilities: ['directEdit'], brep })`，无 mesh 实现（mesh 输入由 `backend-dispatch` 抛 `E_MESH_UNSUPPORTED`）。参数：

- `edges: EdgeTopoRef[]`（必填，`assertChamferParams`（:35）硬校验每条 `kind:'edge'` 且 `faces` 是两项 RoleQualifier）
- `type: 'equal' | 'twoDistances' | 'distanceAngle'`（必填，按 type 校验 width / width1+width2 / width+angle）
- 逐边构建：`twoDistances` 每条边单独调一次 `kernel.chamferDistAngle`（:185），因为内核一次只吃一个距离对

`.fai.js` 里的真实写法（`packages/tests/faijs/chamfer/chamfer.test.ts`）：

```js
const part0 = cad.box(20, 20, 20, { centered: true })
const part1 = cad.chamfer(part0, { edges: [{ kind:'edge', faces:[{ origin:'part0', role:'box:top' }, { origin:'part0', role:'box:front' }], hint:{ kind:'edge', length:20, midpoint:[0,-10,10] } }], type:'equal', width:1 })
```

**错误载体（务必沿用）**：chamfer 一律 `throw new Error('E_CHAMFER_XXX: <说明>')`（见 :38/:42/:46/:195），由 runtime 在语句边界归到 `ExecutionResult.failedAt`。fillet 同形。

### 1.3 命名层已经为圆角预留了位置，但通道没打通

`topology/naming/types.ts` 里：

- `RoleQualifier`（:65）、`EdgeTopoRef`（:84-88，`faces: [RoleQualifier, RoleQualifier]` = "两邻面之交"）
- `DerivedFaceTopoRef`（:98-103）：`op: 'fillet' | 'chamfer'` + `between`，**过渡面的身份类型已设计好**，且已能解析（`naming/resolve-derived.ts`）
- `EdgeNaming`（:174-177）：宿主拿到的边命名行，`faces: null` 表示无邻接 role
- `PartNaming`（:181-186）：`{ source, faceNaming, edgeNaming }`

没打通的地方：

1. `api/chamfer.ts:217` 的 `fromBrep(solidToShape(...), { solid: resultSolid })` **没传 roleTable**——倒角之后的 part 丢了 role 命名。这是 chamfer 的既有缺陷，fillet 会原样继承。修法见 §3.2（M1 内含）。
2. `naming/build-naming.ts` 没有 derived 相关代码——`DerivedFaceTopoRef` 只能被解析，还没有"生成面命名行"产出通道（M2）。

### 1.4 3d_editor 的倒角 UI（fillet UI 的模板）

3d_editor 位于 `C:\my\Faicad\3d_editor`，通过 `package.json:22-23` 的 `file:` tgz 依赖 faijs **两个包**（`@faicad/faijs` 与 `@faicad/faijs-core`，当前 `0.11.1`），不是 workspace。已有设施：

- 视口点选边：`chamfer-store.ts:177-182` 进入工具时 `setSelectionMode('edge')`，`ViewportContainer.tsx:1665` 的 `TopologyPicker` 对 `activeToolMode==='chamfer'` 启用
- 点选 → `naming/capture-topo-ref.ts:37` 经 `ExecutionResult.naming` 的 `edgeNaming` 行 → `captureTopoRef(row)` → `EdgeTopoRef`，直接塞进 args
- 参数表单硬编码（`ChamferPanel.tsx`），M1 只暴露 `radius`（默认 5，软边界 0.01–500，来源见 §6.6）
- 预览是真执行：`ScriptEngine.chamferPreview`（:922）追加一行代码 → `runtime.execute(newCode)` → 取输出 mesh；取消/确认前必须 `resetPreviewScene(原码)`
- BREP-only 判定：`ScriptEngine.isChamferSupported`（:894）看 `topologySources` 是 `brep` 或 `glb`
- 代码行由 Feature 自描述产生：`features/chamfer.ts:43` 的 `buildChamferCode` 用 faijs 的 `formatCodeLine` 产出 `part0 = cad.chamfer(part0, {...})`

## 2. fillet 接口契约（核心设计）

### 2.1 调用形态

```js
// M1：等半径（edges 可多条）
const part1 = cad.fillet(part0, { edges: [EDGE_REF, EDGE_REF_2], radius: 2 })

// M2：变半径（edges 必须恰好 1 条，见 §2.3）
const part2 = cad.fillet(part0, { edges: [EDGE_REF], radius: [1, 3] })

// M2：几何限定符选边（字符串形态，见 §4）
const part3 = cad.fillet(part0, { edges: '|Z', radius: 1.5 })
const part4 = cad.fillet(part0, { edges: 'all', radius: 1 })
```

**不设 `type` 字段**。chamfer 用 `type` 是因为三种形态吃不同参数槽（width / width1+width2 / width+angle）；fillet 的两种形态都落在 `radius` 一个槽上，按 D11 判别规则（明显可区分 → 单名函数内部切换）用 `radius` 的数值形态判别即可：`number` = 等半径，`[start, end]` = 变半径。

### 2.2 参数表

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `edges` | `EdgeTopoRef[]` \| `string` | ✅ | — | 参与圆角的边。数组 = 显式拓扑引用（稳定）；字符串 = 几何限定符（M2，每次执行重新求值，见 §4） |
| `radius` | `number` \| `[number, number]` | ✅ | — | 等半径（mm，>0）；或 `[start, end]` 变半径（`filletVariable` 语义）。**变半径时 `edges` 必须恰好 1 条** |
| `propagate` | `boolean` | | `true` | 是否传播 role 命名。变半径路径无演化数据，不可用（见 §2.3） |

### 2.3 行为约定（逐条可判）

1. **BREP-only**：`defineOp({ capabilities: ['directEdit'], brep })`，与 chamfer 同形。
2. **链路分派**（`backend-dispatch` 静态判定，禁止运行时回退）：mesh 输入 → `E_MESH_UNSUPPORTED`；`mode='brep'` 但引擎无 `directEdit` → `E_BREP_UNSUPPORTED`。`mode='auto'` 且 BREP 链已断 → 走 mesh 路径 → `E_MESH_UNSUPPORTED`（不静默跳过、不退化成无操作）。
3. **异步**：与 chamfer 一致（`@async true`），脚本面语句边界自动 unwrap。
4. **输入消费**：单进单出（`part1 = cad.fillet(part0, …)`）。
5. **变半径只允许单边**：`radius` 为数组时 `edges.length !== 1` → `E_FILLET_VARIABLE_SINGLE_EDGE`。理由：`filletVariable` 一次只吃一条边，逐边循环时**每条边各自重建一次拓扑**，多次调用之间没有演化数据可累积；且边的参数化方向由 OCCT 内部决定，faijs 无法在多边场景下承诺 `[start, end]` 与几何端点的对应关系。
6. **变半径不承诺端序**：`[r1, r2]` 中哪一端是 `r1` 由 OCCT 对该边的参数化决定，faijs 不做映射、不提供 `flip`。需要确定端向时，用两条等半径 fillet 手动拼接。**UI 在 M1/M2 均不暴露变半径**（手写脚本专用，且文档须写明该限制）。
7. **`propagate` 冲突不静默**：变半径路径下 `propagate: true`（显式传入）→ 抛 `E_FILLET_PROPAGATE_UNAVAILABLE`；未显式传入则按 `false` 处理且不报错（降级可见，见 §3.3）。
8. **半径上限由内核定**：OCCT 在半径超过邻面尺寸时自己失败。faijs 不在 op 层猜上限，而是在引擎边界把 `OcctError` 回译成 `E_FILLET_RADIUS_TOO_LARGE`（禁止裸冒 OcctError 到脚本层）。
9. **错误载体**：`throw new Error('E_FILLET_XXX: <说明>')`，与 `chamfer.ts:38` 同形；由 runtime 归到 `failedAt`。

### 2.4 错误码

| 码 | 触发 | 里程碑 |
|---|---|---|
| `E_FILLET_NO_EDGES` | `edges` 为空数组 / 限定符解析出空集（不静默返回原几何） | M1 |
| `E_FILLET_BAD_EDGE_REF` | 条目不是 EdgeTopoRef 或 `faces` 不是两项 | M1 |
| `E_FILLET_BAD_RADIUS` | radius ≤ 0 / 非有限 / 数组不是 2 项 / 变半径任一 ≤ 0 | M1 |
| `E_FILLET_VARIABLE_SINGLE_EDGE` | 变半径但 `edges.length !== 1`（§2.3.5） | M2 |
| `E_FILLET_PROPAGATE_UNAVAILABLE` | 显式 `propagate: true` 且走变半径路径（§2.3.7） | M2 |
| `E_FILLET_RADIUS_TOO_LARGE` | 内核失败回译（邻面放不下该半径、自交等） | M1 |
| `E_FILLET_NO_BREP` | 输入 Shape 无 BREP 句柄（走不到 dispatch 的兜底路径） | M1 |
| `E_FILLET_BAD_SELECTOR` | 几何限定符语法不支持（明确列出支持的语法，不猜） | M2 |
| `E_MESH_UNSUPPORTED` / `E_BREP_UNSUPPORTED` | 链路能力判定（复用现有点） | M1 |
| `E_TOPO_DELETED` / `E_TOPO_AMBIGUOUS` / `E_TOPO_NOT_FOUND` | 命名层三码，原样透出（不吞、不静默取序号） | M1 |

## 3. 边拓扑问题（本方案的重点）

### 3.0 前提：为什么需要持久命名

参数化建模存的是一串特征，改任一参数就整链重放，几何重新生成。倒角/圆角/抽壳/阵列/装配 mate 都必须引用子形状，于是每次重放都要回答"我上次选的那条边现在是哪个"——这就是**拓扑命名问题**（persistent naming）。faijs 的解法是给面/边一个**文本化血缘身份**（`role`），并由 `*WithHistory` 内核调用返回的演化数据把 role 从上一个 part 搬到下一个 part。

### 3.1 两层语义：身份 vs 谓词

- **身份（identity）**：`EdgeTopoRef` = 两邻面的 role 血缘 + hint 几何兜底。纯数据、JSON 安全，写进 `.fai.js`，重放后仍能指认"同一条边"。
- **谓词（predicate）**：`"|Z"` 这类按包围盒/法向在运行期筛选。写起来短，但**选中的是"符合条件的集合"，不是"那一个"**。

两者不是替代关系，判据是用户意图：**"这条边"用身份，"这类边"用谓词**。集合语义下谓词反而更鲁棒（某条边消失后继续倒剩下的；显式引用会 `E_TOPO_DELETED` 断链）。分级策略见 §4。

### 3.2 圆角后的面演化：必须走 WithHistory（M1）

圆角会把两个邻面切开、并在中间插入过渡面。若不传播命名，圆角之后的 part 会整体失去 role，表现为"圆角之后的模型在 UI 里选不了边"。

**输入 roleTable 的取法**（chamfer 目前完全没做，参照 `api/boolean.ts:48`）：

```ts
const inputRoleTable = getSlot(inputs[0])?.roleTable as ReadonlyMap<unknown, unknown> | undefined
const outPart = String(getCurrentStmt()?.outputs[0] ?? '')   // 同 boolean.ts:55
```

**新增 `filletWithRoleTable`**（落在 `brep/face-evolution.ts`，紧邻 :244 的 `booleanWithRoleTable`）。签名与契约：

```ts
export function filletWithRoleTable(
  kernel: BrepEngineApi,
  solid: BrepHandle,              // 输入实体（单输入，与 boolean 的 a/b 不同）
  edgeHandles: BrepHandle[],      // 已解析的 Edge 句柄
  radius: number,                 // 仅等半径；变半径走 §3.3 不走这里
  inputRoleTable: ReadonlyMap<unknown, unknown>,
  outPart: string,                // 本次语句 LHS，用于给新生面分配 origin
): { result: BrepHandle; faceEvolution: Map<number, number[]>; roleTable: ReadonlyMap<unknown, unknown> }
```

内部五步（与 `boolean.ts:59-75` 同构）：

1. `const inputHashes = getFaceHashes(kernel, solid)`（`face-evolution.ts:36`）
2. `const evo = kernel.filletWithHistory(solid, edgeHandles, radius, inputHashes, HASH_UPPER_BOUND)`（常量 `face-evolution.ts:19`）
3. `const faceEvolution = decodeEvolution(kernel, evo, solid, evo.result)`（:71）
4. `const roleTable = propagateAllOrigins(inputRoleTable, decodeHashEvolution(evo), …)`（`naming/roles.ts:178`）
5. op 内 `return fromBrep(solidToShape(kernel, evo.result), { solid: evo.result, faceEvolution, roleTable })`

**注意**：`booleanWithRoleTable` 是双输入（A/B 拆流后合表，缝面以本次语句 LHS 为新 origin）。fillet 是单输入，**不要照抄它的合表逻辑**，但 outPart/origin 分配规则一致。

配套改动：`BrepEngineApi`（`brep/engine/primitives.ts:56-66` 的「倒角（directEdit 能力）」段）新增 `fillet` / `filletVariable` / `filletWithHistory`；`brep/engine/adapters/brep-mock.ts:139-146` 同段补 mock 实现（照 chamfer 的 `alloc({kind:'solid', bbox, tag})` 形态）。**mock 补了不代表 OCCT 有**——见 §1.1 第 2 条，必须实跑验证。

**顺带修 chamfer（M1 内）**：`chamferWithHistory` 同样存在（`occtWasmAdapter.ts:1029`）而 chamfer 没用。同一阶段把 chamfer 也改成 WithHistory + roleTable 传播，否则"倒角后能选边、圆角后不能"会成为说不清的行为差异。

> ⚠️ 兼容性：这一步会**改变**现有 chamfer 的输出——倒角后 part 的 `roleTable` 从"空"变为"非空"，`faceNaming.role` 从 `''` 变为真实 role，`edgeNaming.faces` 从 `null` 变为可解析。属于缺陷修复，但 `packages/tests/faijs/chamfer/` 与 3d_editor 的回填逻辑若有断言依赖旧行为，需同步更新。

### 3.3 变半径路径的取舍：接受降级（M2）

`filletWithHistory` 只接受单一 `number`；变半径只能用 `filletVariable(solid, edge, r1, r2)`，**没有 WithHistory 版本**，且一次只吃一条边。

决策：变半径路径**不产出 roleTable**。理由不是"懒得做"，而是 `resolve-edge.ts:38-57` 的 `facesForQualifier` 在 roleTable 未命中时会**静默几何兜底**（按 hint 找"最像"的面，返回 `confidence: 'geometric-fallback'`，不报错）——拿旧 role 去指一个新拓扑是**静默错指**，比"没有名字"危险得多。

降级后的确切行为（对照 `build-naming.ts:113-148`）：

- `faceNaming` 行：`role = ''`，`hint` 保留
- `edgeNaming` 行：`faces = null`，`hint` 保留
- 宿主侧 `capture-topo-ref.ts:37` 直接取 `row.faces` ⇒ **这些面/边在 UI 上点选不出来**（这是有意为之：宁可点不到，不可点错）

UI 在 M2 暴露变半径时，必须在确认前提示"变半径圆角之后无法继续按名选面/选边，建议放在建模链末端"。

### 3.4 过渡面与新边的命名（边引用扩型，M2）

圆角产生两类新拓扑：

- **过渡面**：用已预留的 `DerivedFaceTopoRef{ op:'fillet', between:[qA,qB], hint }`（`types.ts:98-103`）。需要在 `build-naming.ts` 新增 derived 面命名行通道，`PartNaming`（:181-186）增加可选字段 `derivedFaceNaming`。**必须是可选字段**：老宿主（含 3d_editor M1）不消费时不报错。
- **新边（过渡面与原面的交线）**：现有 `EdgeTopoRef.faces: [RoleQualifier, RoleQualifier]` 表达不了——它的一侧是过渡面。扩型：

```ts
type EdgeFaceQualifier = RoleQualifier | DerivedFaceQualifier   // { origin, op:'fillet'|'chamfer', between:[RoleQualifier, RoleQualifier] }
interface EdgeTopoRef { kind:'edge'; faces: readonly [EdgeFaceQualifier, EdgeFaceQualifier]; hint: EdgeHint }
```

`RoleQualifier` 是子集，JSON 形状不变 ⇒ **存量 `.fai.js` 零修改**。`resolve-edge.ts:52-58` 的 `sharedEdgeOrdinals` 要先经 `resolve-derived.ts` 把 derived 面解析到当前面（normal-blend），再取公共边。

M2 内部再分两步：**M2a = 能解析**（手写/UI 生成的 derived 引用可用，`types.ts` + `resolve-edge.ts` + `resolve-derived.ts`）；**M2b = 命名行产出**（`build-naming.ts` 出 derived 行 + 3d_editor 侧消费，UI 才能点选圆角后的新边）。

### 3.5 其它边界

- **凹边（reflex）**：chamfer 明确不支持（β ≥ 180° → `E_CHAMFER_REFLEX_EDGE`）；OCCT 的 fillet 支持凹边圆角，但半径受邻面几何限制，失败走 `E_FILLET_RADIUS_TOO_LARGE`。
- **边被删除**：后续布尔/抽壳删掉该边 → 命名层 `E_TOPO_DELETED`，不静默跳过。
- **同一边被多次圆角**：第二次时该边已不存在（已变成过渡面与新边的组合），解析 `not-found`；想加大半径的正确路径是编辑原语句（`codeToArgs` 回填），不是叠加。
- **顺序敏感**：先圆角再倒角相邻边，与反过来，结果不同。这是几何事实，UI 用时间线顺序表达，不做自动重排。

## 4. CadQuery 边选择器能用在 faijs 的倒角/圆角里吗

**结论：不能直接复用为 faijs 的边选择机制；可作为"几何限定符"叠加，并共享一份解析器。稳定策略按谓词种类分级（§4.2）。**

cq-compat 现状（`packages/cq-compat/src/workplane.ts`）：`resolveEdgeSelection`（:1514-1538）只支持空串（全部边）与 `|X`/`|Y`/`|Z`（按包围盒判定，垂直方向 extent ≤ `PAD = 0.5mm`，:1526 硬编码）；`resolveFaceEdgeSelection`（:1609）额外支持 `>Z`/`<X` 类方向极值。不支持的一律 throw（fail loud，这个姿态要沿用）。

### 4.1 不能当"唯一主机制"的四条理由

1. **语义层错配**：它是运行期几何谓词，faijs 的引用体系是持久身份。
2. **覆盖面太窄**：CadQuery 真正的语法（BoxSelector、CenterNth、RadiusNth、`#Z`、`not`、组合、`>X[1]` 索引）一个都没实现。认领它 = 认领残缺方言。
3. **依赖错配**：它经 `compatFn('getEdges')` 拿 brepjs 活句柄，绕过 faijs 的 roleTable/hint，UI 无法回显"选中了什么"。
4. **阈值是经验值**：`PAD = 0.5mm` 与模型尺度耦合（小模型全选、大模型漏选）。

### 4.2 分级策略（本方案的落地规则）

前提约束（faijs 的 UI 交互模型天然满足，但**需在 §10 确认是否写死为产品规则**）：**只改参数值 + 语句只能末尾追加**（后者由 `partN` 链式结构保证）。在此约束下按谓词种类分级：

| 谓词类型 | 例子 | 只改参数时 | 本方案规则 |
|---|---|---|---|
| 方向类 | `\|X` `\|Y` `\|Z` | 稳定（方向一般不随尺寸变） | **可作主机制**，UI 可直接生成并显示"当前匹配 N 条边" |
| 类型类 | `%Plane` | 稳定 | 同方向类 |
| 极值类 | `>Z` `<Y` | **脆**（选的是"赢家"，赢家由参数决定，改一个数字就换目标且不报错） | **必须固化为显式引用**：UI 求值后立即转成 `EdgeTopoRef[]` 写回代码行，不让脆谓词留在脚本里 |
| 排序/索引类 | `CenterNth` `RadiusNth` | 脆 | 不支持 → `E_FILLET_BAD_SELECTOR` |
| 范围类 | `BoxSelector` | 脆 | 不支持 → `E_FILLET_BAD_SELECTOR` |

方向类也非无条件安全：其前提是**形状族稳定**（primitive、无布尔切割改变边数、角度参数不跨临界值）。反例：拉伸草图里一条线的角度从 90° 改到 85°，那条边不再 `|Z`，**静默少倒一条**——因此 §4.3 第 5 条的"空集/数量提示"是必需补偿。

### 4.3 落地方式（M2）

1. core 新增 `api/edge-selector.ts`：给定 BREP 现场（kernel + solid）+ 限定符字符串 → Edge 句柄数组。cq-compat 的 `resolveEdgeSelection` 改为复用它，消除第二份实现。
2. fillet/chamfer 的 `edges` 接纳字符串形态，V1 支持：`'all'`、`'|X'|'|Y'|'|Z'`、`'>X'|'>Y'|'>Z'|'<X'|'<Y'|'<Z'`。其余一律 `E_FILLET_BAD_SELECTOR` 并列出支持列表——**不猜、不静默降级为"全部边"**。
3. 语义命名：在 faijs 里叫**几何限定符**（geometric qualifier），不叫 CadQuery 选择器。
4. 稳定性承诺写进 `docs/ops-api-inventory.md`：限定符每次执行重新求值；极值/排序/范围类必须固化（§4.2）。
5. UI 提供"固化为显式引用"：选中后把当前求值结果转成 `EdgeTopoRef[]` 写回代码行；并显示当前匹配条数（0 条时报错，不静默）。
6. 限定符需要 BREP 现场（要 `getEdges`），mesh 链路 → `E_MESH_UNSUPPORTED`。

## 5. faijs 侧实施步骤

| 阶段 | 内容 | 里程碑 | 主要文件 |
|---|---|---|---|
| P0 | `BrepEngineApi` 新增 `fillet` / `filletVariable` / `filletWithHistory` 声明 + mock 实现 + **实跑验证 OCCT 侧确实存在**（§1.1.2） | M1 | `brep/engine/primitives.ts:56-66`、`brep/engine/adapters/brep-mock.ts:139-146` |
| P1a | 新增 `api/fillet.ts`：`defineOp({ capabilities:['directEdit'], brep })`，等半径走 `filletWithRoleTable`（§3.2） | M1 | `api/fillet.ts`、`brep/face-evolution.ts` |
| P1b | 变半径：逐边 `filletVariable` + 单边校验 + 不产 roleTable（§3.3） | M2 | `api/fillet.ts` |
| P2a | 边引用扩型 `EdgeFaceQualifier`（能解析） | M2a | `naming/types.ts`、`resolve-edge.ts`、`resolve-derived.ts` |
| P2b | derived 面命名行通道（`PartNaming.derivedFaceNaming` 可选字段） | M2b | `naming/build-naming.ts`、`naming/types.ts` |
| P3 | 几何限定符 `api/edge-selector.ts` + fillet/chamfer 接纳字符串（§4.3） | M2 | `api/edge-selector.ts`、`api/fillet.ts`、`api/chamfer.ts`、`packages/cq-compat/src/workplane.ts` |
| P4 | 脚本面登记：`api-namespace.ts` 加键 → `api/index.ts` 加 `export { fillet } from './fillet'` → 重跑生成脚本 | M1 | `api/api-namespace.ts:54`、`api/index.ts:20` |
| P5 | chamfer 补 WithHistory + roleTable（§3.2 末段，含兼容性处理） | M1 | `api/chamfer.ts:205-217` |
| P6 | 文档：`ops-api-inventory.md` 新增 fillet 条目（照 :327 chamfer 条目格式）+ 限定符语法表；`api-contract.md` 补错误码与命名约定 | M1 | `docs/ops-api-inventory.md`、`docs/api-contract.md` |

**P4 的生成链路约束**（`lang/op-set-consistency.test.ts:40-69`）：符号表键集 ≡ cad 命名空间函数集 ⊆ `api/index.ts` 导出面，三源必须一致；且脚本面 manifest 里每个 op 都要有 `brep` 实现、无 `mesh` 实现。改完必须重跑 `packages/core/scripts/gen-symbol-table.ts`、`gen-l3-surface.ts`、`gen-api-dts.ts`，否则 CI 直接红。`mesh/api.d.ts` 是生成产物，禁手改。

**arg-spec 处置**：`arg-spec.ts:2799-2804` 的 fillet 条目补 `scriptFace: false` 并写明理由，照 `box` 条目的先例（:2564-2570，原文："faijs 侧由手写 dual-op 覆盖……scriptFace 不投（避免与手写 box 撞名）"）。当前 fillet 条目**没有 `scriptFace` 字段**，必须显式补上，否则生成器行为取决于缺省值。保留 `kind: 'brep-op'`，`api/generated/topology.ts:413` 的 compat 投影不动（它只进 `brepjsCompat` 命名空间，不与手写 `fillet` 撞顶层导出）。

**依赖顺序**：faijs（P0→P4）→ `npm run pack` 出 tgz → 3d_editor 联调。UI 的骨架代码可提前写，但**任何真执行/预览都必须等 faijs 侧 tgz 就位**。

## 6. 3d_editor 侧实施步骤

照 chamfer 逐项对称新增（`C:\my\Faicad\3d_editor`）。括号为已核对的 chamfer 位置：

1. `src/engine/version-store/Command.ts:14-33` — `COMMAND_TYPES` 在 `'chamfer'`（:32）后加 `'fillet'`；`CommandParams`（:35 起）加 `radius?: number`
2. `src/stores/core/tool-store.ts:11` — `ActiveToolMode` 联合类型末尾加 `'fillet'`
3. `src/engine/features/types.ts:27-34` — `FeatureIconKey` 加 `'fillet'`
4. `src/engine/features/fillet.ts`（新增）— `FeatureDef`。**必需字段以接口为准**：`type`、`ops: ['fillet']`、`commandType: 'fillet'`、`buildCode`（用 `formatCodeLine({ callee:'fillet', … })`，照 `features/chamfer.ts:43`）、`buildArgs`（edges + radius）、`getIconKey`（**必填，勿漏**）、`deriveLabel`、`editor: { toolMode:'fillet', backfill, collectArgs }`。`terminalMapping` 省略即为 `'auto'`（单进单出，与 chamfer 同）
5. `src/engine/features/index.ts` — 参照 :75 `import { chamferFeature } from './chamfer'` 加 import，参照 :92 加 `registerFeature(filletFeature)`
6. `src/stores/tools/fillet-store.ts`（新增）— 仿 `chamfer-store.ts`：`DEFAULT_FILLET_RADIUS = 5`、`FILLET_RADIUS_MIN = 0.01`、`FILLET_RADIUS_MAX = 500`（与 `chamfer-store.ts:24-26` 同组 BLEND_BOUNDS 边界）、Tier A/C 字段划分与 undo 注册
7. `src/engine/components/fillet/FilletToolbar.tsx`（新增）+ `src/layouts/DesktopLayout.tsx` 挂载（参照 :59 import、:1437-1438 使用）
8. `src/engine/components/fillet/FilletPanel.tsx`、`FilletPreview.tsx`（新增）+ `src/components/viewport/ViewportContainer.tsx` 挂载（参照 :50-51 import、:1789-1790 使用）并在 :1665 的 `TopologyPicker enabled` 条件里加 `activeToolMode === 'fillet'`
9. `src/engine/script-engine/ScriptEngine.ts` — 新增 `isFilletSupported`（仿 :894，复用 `topologySources` 判定）与 `filletPreview`（仿 :922，**注意 `resetPreviewScene` 的配对调用**）
10. `src/engine/script-engine/feature-icon-map.tsx` — 图标组件映射（参照 :41）与颜色（参照 :71）
11. `src/stores/serialization/undo-registrations.ts:154` — fillet 的 undo 注册（照 `chamfer` 条目）
12. `src/locales/zh.json`、`en.json` — `fillet.*` 文案（参照 `zh.json:457-461` 的 chamfer 五键：label / tooltip / tooltipSelectEdge / tooltipBrepOnly / brepOnly）
13. 选边链路**完全复用** `naming/capture-topo-ref.ts`（`edgeTopoRefFromReferenceId`），M1 不需要新机制；M2b 落地后若要点选圆角产生的新边，此处才需扩消费 `derivedFaceNaming`

**联调与发布**（3d_editor 消费 tgz，非 workspace）：faijs 侧改完 → `npm run pack` → 版本号 `0.11.1` → **`0.12.0`**（新增 op，minor）→ 3d_editor `package.json:22-23` 两个依赖（`@faicad/faijs`、`@faicad/faijs-core`）同步改版本号与文件名。

## 7. 测试计划（提纲）

- **单元**：`api/fillet.test.ts` 参数校验（§2.4 各码，含 `E_FILLET_VARIABLE_SINGLE_EDGE`、`E_FILLET_PROPAGATE_UNAVAILABLE`）；`edge-selector.test.ts` 限定符解析（含空集、不支持语法）
- **引擎/命名（真 OCCT）**：等半径后 `faceNaming.role` 非空、`edgeNaming.faces` 可解析；面 1→N 分裂后旧 role 仍命中；变半径路径 `roleTable` 为空且 `edgeNaming.faces === null`
- **集成（.fai.js）**：`packages/tests/faijs/fillet/fillet.test.ts`，照 `chamfer.test.ts` 风格——box 20³ 单棱 `radius=2`：面数 6→7、体积按圆柱段解析式断言（`ΔV = (4-π)·r²·L/4`，r=2、L=20 ⇒ 约 17.17 mm³ 的减少量，容差 1e-3）、`brepChain.solidCache` 未断链；限定符 `|Z` 与 `'all'`；错误路径（空 edges、radius≤0、非 BREP 输入 → `E_MESH_UNSUPPORTED`、不支持的限定符、内核半径过大 → `E_FILLET_RADIUS_TOO_LARGE`）
- **回归**：`lang/op-set-consistency.test.ts`（三源一致）；`packages/tests/faijs/chamfer`（P5 改 WithHistory 后，注意 §3.2 的兼容性变化）
- **stderr 零容忍**：故意失败用例必须在测试内 spy `console.warn/error` 并断言未被调用
- **3d_editor e2e**：`test/e2e/fillet.spec.ts` 仿 `chamfer.spec.ts`（进入工具 → 点选边 → 改半径 → 预览 → 确认 → 代码行落盘 → 刷新后回填）

## 8. 验收标准（DoD）

M1 完成的判定（全部为真才算完成）：

1. `cad.fillet(part0, { edges:[…], radius:2 })` 在真 OCCT 下跑通，产出实体体积符合解析式
2. 圆角之后该 part 的 `faceNaming.role` 非空、未被圆角影响的边 `edgeNaming.faces` 可解析（= roleTable 确实传下来了）
3. `npx tsx packages/core/scripts/faijs-cli.ts check <f.fai.js>` 认得 `fillet`（符号表已更新），`run` 能导出 STEP
4. 3d_editor：进入圆角工具 → 点选边 → 改半径 → 预览 → 确认 → 代码行落盘 → 刷新页面后点击特征树节点能回填半径与边
5. `npm run test --workspaces`、`npm run typecheck`、`npm run lint` 全绿，stderr 零输出
6. chamfer 改 WithHistory 后 `packages/tests/faijs/chamfer` 全绿（含 §3.2 兼容性处理的断言更新）
7. 两个 tgz 已 pack 到 `0.12.0`，3d_editor 依赖已更新且能独立 `npm i` 成功

M2 追加：变半径单边跑通且降级行为符合 §3.3；限定符解析与固化链路可用；derived 引用可解析（M2a）/ 可点选（M2b）。

## 9. 风险与开放问题

- **OCCT 圆角的鲁棒性**明显低于倒角：半径接近邻面尺寸、三面交汇处、凹边处都可能失败。M1 必须把失败统一回译为 `E_FILLET_RADIUS_TOO_LARGE`，不要让 OcctError 冒到脚本层。**绝不可静默返回未圆角的原形状**——cq-compat 曾因此导致 mini_lathe 一批零件圆角整批消失（`workplane.ts:1543-1547` 的注释记录了这次事故）。
- **变半径的逐边构建**每步重建命名上下文，圆角后边数变多，M2 要实测性能。
- **P5（chamfer 改 WithHistory）是行为变更**，不是纯内部重构，需单独一个 commit 并写清对既有 `.fai.js` 的影响。
- **§10 的三个待确认项**会直接改变 P3 与 UI 的形态，动手前必须先定。

## 10. 实施前必须确认的决策（默认方案已给出，未确认即按默认执行）

| # | 问题 | 默认决策 | 影响 |
|---|---|---|---|
| 1 | 「只改参数 + 语句只能末尾追加」是否写死为产品规则？ | **写死**（写进 `docs/syntax-design.md` 与 UI 约束）。若以后支持中间插入编辑，§4.2 方向类"稳定"的结论立即失效 | §4.2、UI 交互 |
| 2 | `PAD = 0.5mm` 是否按模型尺度自适应？ | **不自适应**，保持固定 0.5mm；补偿手段是 UI 显示"当前匹配 N 条边"让用户确认（隐式尺度耦合比显式提示更危险） | P3 |
| 3 | 圆角后是否允许点选"过渡面与原面的新边"？ | M1 不允许（该边 `faces: null`）；M2b 落地后允许 | P2b、UI 第 13 项 |

## 11. 文档与决策记录

- 实施时同步更新：`docs/ops-api-inventory.md`（fillet 条目 + 几何限定符语法表 + 稳定性承诺）、`docs/api-contract.md`（错误码、命名传播约定）
- 需要新增 Agent Note：① 边引用扩型（derived 面参与 `EdgeTopoRef`）的取舍；② CadQuery 选择器不直接复用、改为分级几何限定符的决定；③ 变半径降级（不传播 roleTable，且只允许单边）的决定；④ chamfer 改 WithHistory 的行为变更
