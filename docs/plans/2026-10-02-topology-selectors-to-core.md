# 将 CadQuery 拓扑选择器子系统上移至 faijs core（独立子目录 `cadquery-selectors/`）

> 状态：**方案已定，待实施**（基于 `packages/core`、`packages/cq-compat` 当前源码核实，日期 2026-10-02）。
> 范围：`packages/core`（新增子目录）、`packages/cq-compat`（退化为薄封装）。
> 说明：本文是 faijs 仓库内部实施记录；以当前源码为准，不引用任何历史 plan 作为现状依据。下游 `@faicad/animation` 的接入 / 升级 / 去依赖在本仓库范围之外，由其自身方案记录。

---

## 1. 目标

把 CadQuery 风格的**拓扑选择器子系统**（字符串语法 `>Z` / `<Z` / `+Z` / `|Z` / `#Z` / 命名视图 / 多轴 / 索引 / 最近点，作用于 face / edge / vertex）从 `packages/cq-compat` 的实现中**上移到 `packages/core`**，作为 core 的一个**独立子目录**承载，并让 cq-compat 退化为从 core 薄封装 / re-export，不再维护选择器解析逻辑。

达成后：
- core 拥有与 CadQuery 完全对齐的通用拓扑选择器能力（`@faicad/faijs/api/cadquery-selectors`）；
- cq-compat 公共 API（`resolveFaceSelector` 等）保持不变（下游无感），但实现来自 core；
- faijs 自身已有的命名 / 血缘 TopoRef 系统（`api/topo-resolve.ts`）**不受影响、与本次子系统物理隔离**。

---

## 2. 现状取证（当前源码）

### 2.1 同仓 monorepo，cq-compat 源码在本地
- 仓库 `packages/`：`core`、`cq-compat`、`cq-compat-assembly`、`cq-compat-compare`、`cq-compat-sketch`、`fai_cq_gears`、`sheetmetal` 等。
- cq-compat 源码：`packages/cq-compat/src/{workplane.ts, shape-class.ts, sketch.ts, index.ts, *.test.ts}`。
- 这是 intra-package 重构，不是跨仓库；所有改动都在本仓库内。

### 2.2 两套「选择」机制，不要混淆
- **(A) CadQuery 字符串 / 对象选择器**（cq-compat 实现，本次迁移对象）：`resolveFaceSelector(shape,'>Z')`、`edges('|Z')`、`DirectionSelector` 类等；枚举真实 BREP 的面 / 边 / 顶点，按方向 / 命名视图 / 索引挑。
- **(B) core 的命名 / 血缘 TopoRef 系统**（`api/topo-resolve.ts` + `topology/naming/`）：按 `(origin, role)` 在构建期捕获、运行期沿血缘 DAG 回走重算（`roleTable` miss → `recomputeViaLineage`）。这是 faijs 自有命名拓扑能力，与 (A) 正交。**本次不改动它，且新子系统与之物理隔离**。

### 2.3 cq-compat 的 CadQuery 选择器面（本次迁移对象，经读 `packages/cq-compat/src` 确认）
- 字符串解析器：
  - `resolveFaceSelector(shape, sel, centerOption?)` — `workplane.ts:565`，返回 `{ center, normal }`。
  - `resolveEdgeSelection(shape, sel)` — `workplane.ts:4878`：`|X|Y|Z` 轴平行边；`#X#Y#Z` 轴极值边（含并列）；空 = 全部。
  - `resolveFaceEdgeSelection(shape, sel)` — `workplane.ts:4995`：方向选择器挑出面的边（供 `.faces('>Z').fillet/chamfer`）。
  - `applyStringSelector(k, els, expr)` — `sketch.ts:498`：2D 草图元素选择器（`>X` / `>Y` / `not` / `and` / `or` / 方向 `(dx,dy)`）。
- 选择器类（`shape-class.ts`，作用于 CqShape 类模型列表）：`TypeSelector`、`DirectionSelector`（含 `containsPoint` 符号消歧）、`NearestToPointSelector`、`StringSyntaxSelector`。
- Workplane 层封装：`faces/edges/vertices/solids/shells`（`workplane.ts`，依赖上述解析器 + Workplane 管道）。

### 2.4 core 已具备迁移所需的全部原语（已核实）
- `packages/core/src/api/brep-topology.ts` 导出：`getFaces` / `getEdges` / `getSolids` / `bounds3D` / `getSurfaceType` / `faceCenter`(= `surfaceCenterOfMass`，面质心) / `normalAt`(= UV 中心真实几何法向) / `pointOnSurface` / `sharedEdges` / `outerWire`。
- `BrepEngineApi`（`brep/engine/primitives.ts`）已具备 `getSubShapes` / `subShapeHashes` / `isSame` / `surfaceNormal` / `uvBounds` / `surfaceCenterOfMass` / `getBoundingBox` / `getSurfaceArea` —— 即 cq-compat 当前用 `OcctKernel` 的同名方法，core 的 L1 引擎全有对应。
- 依赖符号 core 均已导出：`brepOf` / `isShape`（`@faicad/faijs/shape`）、`fromHandle`（`@faicad/faijs/sdk`，亦由 `handle-bridge` 再导出）、`getBrepApi`（`@faicad/faijs/brep/handle-bridge`，cq-compat `workplane.ts` 本就已在 import）。
- core `package.json` 有 `"./api/*"` 通配 → 新增 `packages/core/src/api/cadquery-selectors/` 可自动解析为 `@faicad/faijs/api/cadquery-selectors`，无需改 `exports`。
- 命令（仓库 scripts）：`npm run typecheck -w @faicad/faijs` / `npm run build -w @faicad/faijs` / `npm test -w @faicad/faijs`。

### 2.5 借用视图还原（必须保留）
cq-compat `asBrepShape`（`workplane.ts:65`）处理 compatOp 借用视图（`{ wrapped: {id} }`）→ `fromHandle` 还原 + `borrowedShapeCache`。真实 `resolveFaceSelector` **第一行就是 `shape = asBrepShape(shape)`**——若不归一，借用视图下 `brepOf` 为 undefined → 落到 bbox 兜底并在 `cad.bboxMax` 崩溃。core 版必须保留该归一逻辑（依赖 `isShape` + `fromHandle`，core 均已有）。

### 2.6 落点：`api/cadquery-selectors/` 独立子目录（与 `topo-resolve` 隔离）
`api/` 下已有 `assembly/` / `brepjs-compat/` / `measurement/` / `surface/` / `view/` 等独立子目录，新建 `cadquery-selectors/` 与现有约定一致，且与 `topo-resolve.ts` 物理隔离（见 §3 D8、§4 隔离原则）。

---

## 3. 设计决策

| 编号 | 决策点 | 结论 |
|---|---|---|
| D1 | BREP 不可用 / 无匹配面 / 索引越界 / 多轴索引不支持 | **忠实移植 cq-compat**：真实错误**抛错**（与 CadQuery 一致）；BREP 不可用的「整形状 bbox 兜底」**保留**（cq-compat 安全网，保证下游零行为变化） |
| D2 | 选择器形态覆盖范围 | **搬全套**（命名视图 / 单轴 / 索引 / 多轴），作为通用能力，真正替代 cq-compat 的该 API |
| D3 | `normal` 取值 | 单轴 `>Z/+/<Z/-` 及 `DirectionMinMaxSelector` 返回**选择器轴方向向量** `[0,0,sign]`，**不是**真实几何法向；仅多轴 `+XY/>XY` 分支返回所选面真实外法向（`normalAt(f)`） |
| D4 | `center` 取值 | 排序 / 比较用 `bounds3D(f)` 中心（bbox 中心）；返回默认用 `faceCenter(f)`（= `surfaceCenterOfMass`，= CadQuery `face.center()` 质心），与 cq-compat 默认一致；保留 `centerOption:'CenterOfBoundBox'` → bbox 中心 |
| D6 | 拓扑选择器覆盖范围 | **face 必做且严格对齐 cq-compat**；**edge / vertex 一并实现**（共享语法解析，按 CadQuery `selectors.py` 语义）；solid / shell 本版不实现（core 已有 `getSolids`，将来可补） |
| D7 | cq-compat 退化为薄封装 | cq-compat 的 `resolveFaceSelector` 等改为 `export { ... } from '@faicad/faijs/api/cadquery-selectors'`，删除自身实现；公共 API 不变 |
| D8 | **独立子目录 + 与现有拓扑选择器隔离** | 迁移体必须落在 **`packages/core/src/api/cadquery-selectors/` 独立子目录**，不得写成 `api/` 顶层平铺文件，也**不得并入 / 依赖** `topo-resolve.ts` 及其 `topology/naming/`；只复用 `./brep-topology` 原语 + `getBrepApi()`，与 faijs 自身 TopoRef 正交、物理隔离 |

> D1 已定「保留兜底」：下游 `assertFaceReallyResolved`（animation 侧）仍保留为双保险（还能拦「选错面」）。
> D3 已定「轴向量」：单轴 / 轴方向选择器 normal 不是 `normalAt`；多轴分支才是真实法向。
> D6 / D7 范围：edge / vertex 选择器是「通用子系统」的应有之义；它们的语义需对照 CadQuery 验证（见 §6）。

---

## 4. faijs core 改造

### 4.1 新增独立子目录 `packages/core/src/api/cadquery-selectors/`（物理隔离，D8）

**隔离原则（D8）**：本目录是 CadQuery 兼容子系统的**独立物理边界**：
- 目录内模块不外泄到 `api/` 顶层；`api/index.ts` 仅以 `export * from './cadquery-selectors'` 一行汇聚。
- **只依赖** `./brep-topology`（`getFaces/getEdges/bounds3D/faceCenter/normalAt/...`）原语与 `getBrepApi()`（L1 引擎）。
- **严禁** `import` 或并入 `api/topo-resolve.ts` 及其 `topology/naming/`（那是 faijs 自己的命名 / 血缘 TopoRef 系统，与 CadQuery 字符串选择器正交）。
- 内部子模块间用相对 import（全仓约定，构建脚本 `fix-import-extensions.mjs` 自动补 `.js`）。

**目录文件清单**：
```
packages/core/src/api/cadquery-selectors/
├── index.ts          # 公开出口：re-export resolveFaceSelector/resolveEdgeSelector/resolveVertexSelector/parseSelector 及类型
├── types.ts          # SelectorDesc / Target / Kind 描述对象类型
├── grammar.ts        # 共享 parseSelector(sel): SelectorDesc：归一 CadQuery 字符串（命名视图/单轴/多轴/索引/平行/垂直）+ NAMED_VIEW_TO_AXIS + 轴线表
├── borrow-bridge.ts  # asBrepShape 借用视图归一（必须保留，见 §2.5）
├── face.ts           # resolveFaceSelector：严格对齐 cq-compat（D1/D3/D4）
├── edge.ts           # resolveEdgeSelector：对齐 cq-compat resolveEdgeSelection（D6）
├── vertex.ts         # resolveVertexSelector：按 CadQuery vertices() 语义补全（D6）
└── selectors.test.ts # 单测（face 回归 + edge/vertex 对照，见 §6）
```

#### 4.1.1 `grammar.ts`：共享 `parseSelector(sel): SelectorDesc`
把 CadQuery 字符串语法归一为描述对象，供 face/edge/vertex 共用（去重核心）：
```ts
type Target = 'face' | 'edge' | 'vertex'
type Kind = 'dirMinMax' | 'dir' | 'parallel' | 'perpendicular' | 'nth' | 'named' | 'nearest'
interface SelectorDesc {
  target: Target
  kind: Kind
  axisVec: [number, number, number]   // 单位轴向量（单轴/多轴/命名视图归一后）
  sign: 1 | -1                          // '>'/'+' => 1；'<'/'-' => -1
  index?: number                        // [-k] 后缀（负数=倒数）
}
```
- `NAMED_VIEW_TO_AXIS`（front=>>Z, back=<<Z, left=<<X, right=>>X, top=>>Y, bottom=<<Y）—— 从 cq-compat 原样搬入（已 verified vs cadquery 2.8.0）。
- 轴线表 `XY=(1,1,0)` / `XZ=(1,0,1)` / `YZ=(0,1,1)`（多轴）。
- 修饰符：`>`/`<`→`dirMinMax`（带 sign），`+`/`-`→`dir`（带 sign，方向选择器），`|`→`parallel`，`#`→`perpendicular`，`[-k]`→`nth` 索引。
- 纯函数、无副作用、单测覆盖。

#### 4.1.2 `face.ts`：`resolveFaceSelector(shape, sel, centerOption?)` —— 严格对齐 cq-compat（D1/D3/D4）
**入口必须先 `asBrepShape(shape)`**（来自 `borrow-bridge.ts`，见 §2.5，绝不可省）。逻辑逐行对齐 cq-compat `workplane.ts:565-820`：
- 多轴分支（`+XY`/`>XY`…）：`getFaces` 枚举 → `normalAt(f)` 取外法向、`faceCenter(f)` 取质心；`+`/`-` 走「法向平行」过滤（`dot > cos(1e-4)`），`>`/`<` 走「质心沿方向极值」；返回 `{ center: 质心, normal: faceNormalOf }`（D3 多轴 = 真实法向）。
- 单轴分支：过滤「垂直于该轴」的面（bbox 沿轴极薄 `<0.1`）；`+`/`-` 还需 `normalAt(f)` 沿轴分量符号匹配；按 `bounds3D(f)` 中心沿轴坐标取极值（sign>0 取 max，否则 min；并列取面积更大者，用 `getSurfaceArea`）；索引 `[-k]` 走排序后第 k 张（升 / 降序按 `>`/`<`、`+`/`-` 规则）；
  - `normal` = `[0,0,sign]`（D3 轴向量，**不是** `normalAt`）；
  - `center` 默认 `faceCenter(f)`（质心，= cq-compat 默认），`centerOption==='CenterOfBoundBox'` 取 `bounds3D(f)` 中心（D4）。
- 错误处理（按 D1）：无 BREP / 无面 / 索引越界 / 多轴索引不支持 → **抛明确错误**；BREP 不可用的「整形状 bbox 兜底」**保留**（用 `bounds3D` 替代 cq-compat 的 `cad.bboxMax/bboxMin`）。
- 返回类型 `{ center: Vec3; normal: Vec3 }`。

#### 4.1.3 `edge.ts`：`resolveEdgeSelector(shape, sel, opts?)` —— 对齐 cq-compat `resolveEdgeSelection`（D6）
- 实现于 `workplane.ts:4878` 的语义：`|X|Y|Z` 轴平行边（bbox 沿轴主导、两垂直轴 ≤ PAD）；`#X#Y#Z` 轴极值边（含并列 ties）；空 = 全部。
- CadQuery 的 `edges('>A')`/`+A`/`|A`/`#A` 完整语义（边切向 parallel / perpendicular / extreme）属扩展，按 `selectors.py` 补齐，返回建议 `{ center: Vec3; direction?: Vec3 }`。
- 边中点 / 切向：用 `curveStartPoint`/`curveEndPoint`（brep-topology 已导出）差向量归一。

#### 4.1.4 `vertex.ts`：`resolveVertexSelector(shape, sel, opts?)` —— 按 CadQuery `vertices()` 语义（D6）
- `>A`/`<A`：顶点沿轴坐标最远 → `{ center: Vec3 }`；`+A`/`-A`：沿轴带符号（多值）；`[-k]` 索引。
- 顶点坐标：用 `getSubShapes(handle,'vertex')` 后取点（core 已有底层访问）。
- cq-compat 当前**没有**独立的 `resolveVertexSelector`（Workplane 层 `vertices` 存在但解析逻辑待确认），故本函数是「补全」而非「去重」，须对照 CadQuery 验证（§6）。

#### 4.1.5 `borrow-bridge.ts`：借用视图还原 `asBrepShape`（必须保留，见 §2.5）
cq-compat `asBrepShape` 处理 compatOp 借用视图（`{ wrapped: {id} }`）→ `fromHandle` 还原 + `borrowedShapeCache`。真实 `resolveFaceSelector` 第一行即 `shape = asBrepShape(shape)`。core 版保留该归一（依赖 `isShape` `@faicad/faijs/shape` + `fromHandle` `@faicad/faijs/sdk`）；core 的 `brepHandleOf` 不处理 compatOp 借用视图包装，删掉会破坏 autoLift / compatOp 场景。

#### 4.1.6 文件规范
内部用相对 import（全仓一致，构建脚本 `fix-import-extensions.mjs` 自动补 `.js`）。

### 4.2 导出登记
- 利用已有 `"./api/*"` 通配，独立子目录 `cadquery-selectors/` 自动解析为 `@faicad/faijs/api/cadquery-selectors`，**无需改 `packages/core/package.json` 的 exports**。
- 在 `src/api/index.ts` 加一行 `export * from './cadquery-selectors'`，使其进入 `@faicad/faijs/api` 命名空间（推荐下游子路径直达 `@faicad/faijs/api/cadquery-selectors`，**不要顶层平铺**，以免与 `topo-resolve` 等命名拓扑模块混淆）。
- **隔离校验（D8）**：新增目录内不得出现对 `topo-resolve` / `topology/naming` 的 import；提交 / typecheck 前以 `grep -rn "topo-resolve\|topology/naming" packages/core/src/api/cadquery-selectors/` 确认为空。

---

## 5. cq-compat 改造（同仓内）

1. `workplane.ts` 中删除 `resolveFaceSelector`（`workplane.ts:565` 起，约 250 行）及其私有 `NAMED_VIEW_TO_AXIS`、轴线表、索引逻辑；`resolveEdgeSelection`/`resolveFaceEdgeSelection` 同理删重复解析逻辑。
2. 在 cq-compat 入口 `index.ts` 改为 re-export core 版本：
   ```ts
   export { resolveFaceSelector, resolveEdgeSelector, resolveVertexSelector }
     from '@faicad/faijs/api/cadquery-selectors'
   ```
   （保持 `@faicad/cq-compat` 公共 API 不变，下游无感）。
3. 选择器类（`DirectionSelector`/`StringSyntaxSelector`/`NearestToPointSelector`/`TypeSelector`，`shape-class.ts`）Phase 2 改为从 core 引入实现或薄继承——注意 `DirectionSelector` 用 `containsPoint` 做符号消歧，须先确认 `BrepEngineApi` 是否等价（见 §7 风险）。
4. `asBrepShape` **保留**在 cq-compat（它仍被 cq-compat 的装配代码 `constraintEx` 使用，且本项目核心入口也要用它，不属于可删的重复代码）。
5. Workplane 管道、`CqShape` 类模型、CadQuery op 语义**保留**（这些是 cq-compat 的职责，不属于「选择器解析」）。

---

## 6. 验证

### faijs core
1. `npm run typecheck -w @faicad/faijs` —— 新模块编译通过。
2. `npm run build -w @faicad/faijs` —— 产出 `dist/api/cadquery-selectors/{index,face,edge,vertex,...}.js` 与 `.d.ts`。
3. `npm test -w @faicad/faijs` —— 运行 `cadquery-selectors/selectors.test.ts`。
4. **CadQuery 对照验证（关键）**：
   - face 分支：以 cq-compat 现有行为为基准（其已 verified against 2.8.0），新实现须**字节级一致**（同一长方体 / 圆柱 / 带凸台件，比较 `center`/`normal`）。
   - edge / vertex 分支：用本机 CadQuery 2.8.0（`.venv`）跑对照，记录期望值再断言；本机不可用时标注待验证。

### cq-compat
5. 改 re-export 后，`npm test -w @faicad/cq-compat` 确认 `resolveFaceSelector` 行为与旧版一致（同样以 CadQuery 2.8.0 为基准）。

---

## 7. 风险与回滚
- **语义差异（D3/D4 已锁定）**：单轴 normal 用轴向量 `[0,0,sign]`（非 `normalAt`）、center 用面质心，闭合实体上与 cq-compat / CadQuery 等价；仅曲面 / 边缘情形有差异。回归测试（§6.4）确认 face 分支字节级一致。
- **edge / vertex 新实现验证风险（D6）**：edge 的 `|Z`/`#Z` 直接对齐 cq-compat 已有 `resolveEdgeSelection`（风险低）；`resolveVertexSelector` 是补全语义，必须对照 CadQuery 验证；未验证前不得宣称「完全兼容」。face 分支不受此风险影响（直接字节级对齐 cq-compat）。
- **借用视图（§2.5）**：`asBrepShape` 归一逻辑必须保留，否则 autoLift / compatOp 场景 `brepOf` 为 undefined → 兜底或崩溃。
- **`containsPoint` 等价性（Phase 2）**：`DirectionSelector` 用 `containsPoint` 做法向符号消歧，须确认 `BrepEngineApi` 是否有等价 API（OcctKernel 有，但 L1 接口未必暴露）；若无，Phase 2 改用 core 等价手段（如 `brepOf` + 点包容查询）或保留该类在 cq-compat。
- **共享解析器回归风险**：`parseSelector` 抽出后若逻辑偏差会改变 face 行为——故 §6.4 要求 face 分支字节级对齐 cq-compat，作为回归锁。
- **子目录隔离（D8）**：新增模块必须落在 `cadquery-selectors/` 独立目录、严禁并入 `topo-resolve.ts` 或 `api/` 顶层；以 §4.2 的 grep 校验 + code review 兜底。
- **回滚**：任一改动均可通过 `git revert` 单文件恢复；本方案仅改文件、不擅自提交，回滚前需授权。

---

## 8. 实施清单（faijs 仓库内）

| 步骤 | 仓库 | 动作 | 提交授权 |
|---|---|---|---|
| 1 | faijs core | 新建独立子目录 `packages/core/src/api/cadquery-selectors/`（index.ts + types.ts + grammar.ts + borrow-bridge.ts + face.ts + edge.ts + vertex.ts）：`parseSelector` + `resolveFaceSelector`（对齐 cq-compat，含 `asBrepShape` 归一），且与 `topo-resolve` 物理隔离（D8） | 改文件后由用户决定 |
| 2 | faijs core | 同目录加 `resolveEdgeSelector`（对齐 `resolveEdgeSelection`）/ `resolveVertexSelector`（D6，按 CadQuery 语义补全） | 同上 |
| 3 | faijs core | 新增 `cadquery-selectors/selectors.test.ts`（face 回归 + edge / vertex 对照） | 同上 |
| 4 | faijs core | `typecheck` → `build` → `test` 全绿；face 与 cq-compat 字节级一致 | 同上 |
| 5 | cq-compat | 删 `workplane.ts` 内 `resolveFaceSelector`/`resolveEdgeSelection` 实现 → 入口 re-export core 版本 | 用户授权 |
| 6 | cq-compat | `npm test`（cq-compat）确认 re-export 行为与旧版一致 | 同上 |

> 所有步骤仅修改文件；**任何 `git commit` 都需用户当次逐次明确授权**，不会自行提交任一仓库。
> 下游 `@faicad/animation` 的接入（改 import 源、删 cq-compat 依赖、重新链接 / 升级 faijs）不属本仓库范围，由其自身方案记录。
