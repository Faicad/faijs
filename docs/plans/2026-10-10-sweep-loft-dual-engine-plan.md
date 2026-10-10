# 方案：sweep / loft 双引擎化——基础 op 两内核支持，高级功能拆独立 op

> 方案出处：本方案由另一 agent 起草；落地实施与本次修订 deepseek-V4.1-Flash + WorkBuddy

状态：**已实施**（faijs 0.31.2）。

落地形态（全文以此为准）：
- L1 契约 `brep/engine/primitives.ts` 增中立名 `sweep(profile, spine)` 与 `loft(sections, ruled, endPoint?)`；
- occt 适配器把 `sweep` 映射到原生 **`sweepPipeShell`**（不是 `simplePipe`），brepkit 适配器做 face 升格、脊柱 wire→NURBS 拟合与截面顶点数一致性检查；
- 基础 `api/sweep.ts` / `api/loft.ts` 去 `engines` 声明、选项面收窄为两内核交集（`sweep` 无选项，`loft` 只留 `ruled` / `endPoint`）；
- 控制面拆到 `api/sweep-advanced.ts` / `api/loft-advanced.ts`（`engines: ['occt']`）；
- 端侧（3d_editor `packages/weapp`）四个操作实测全部成体。

## 0. 用户原话

> 分析为何扫掠、放样功能是occt only的。brepkit到底哪里缺少功能导致不支持

然后你需要参考skecthOnPlane的做法。之前skecthOnPlane方法不支持brepjs，后来支持了。因为把高级功能曲面的草图更改为skecthOnSurface。拉升和扫掠是否也可以采用类似的做法？请写一份技术实现方案出来。基础的拉升、扫掠要两个几何内核都支持。高级功能可以给独立的op。不要看了occt-wasm就是 "overrides": { "occt-wasm": "5.6.0" }

## 1. 版本事实澄清

- **occt-wasm**：root `package.json` 有 `"overrides": { "occt-wasm": "5.6.0" }`，实际安装 5.6.0（`2026-10-05-occt-wasm-upgrade-3-8-to-5-6-plan.md` 已落地）。sweep 的 occt 侧能力（`simplePipe` / `sweepPipeShell` / `sweepFull`）都在。
- **brepkit-wasm**：`packages/core/package.json` 声明 `"brepkit-wasm": "^3.4.18"`，实际安装 **3.6.0**（本机 `node_modules` 实测）。

### brepkit-wasm@3.6.0 的扫掠/放样导出面（实测 d.ts）

| 方法 | 签名要点 | 能力边界 |
|---|---|---|
| `sweep(face, path_degree, path_knots, path_control_points, path_weights)` | 截面必须 **face**；路径必须**单条 NURBS 曲线**（四数组） | 基础扫掠，无过渡/引导线/缩放律 |
| `sweepSmooth(face, …NURBS…)` | 同上 | 每条带生成单张 NURBS 曲面，光滑 |
| `sweepWithOptions(profile, path_edge, contact_mode, scale_values, segments, corner_mode)` | 路径吃 **edge**；`contact_mode`: rmf/fixed/constantNormal；`scale_values`: 分段线性缩放律；`corner_mode`: smooth/miter/round | 有接触模式 + 缩放律 + 转角 |
| `pipe(face, …NURBS…)` | 同 sweep | 管道 |
| `multiSectionSweep(faces, params, …spine NURBS…, ruled)` | 多截面沿 NURBS spine | 多截面扫掠 |
| `guidedSweep(face, spine NURBS, aux NURBS)` | spine + 辅助线，双 NURBS | 引导扫掠（无 contact 语义） |
| `helicalSweep(face, axis…, radius, pitch, turns)` | 螺旋扫掠 | 特化 |
| `sweepAlongEdges(face, edge_handles[])` | 沿边链扫掠，非 NURBS 路径时自动拟合 | 边链路径 |
| `loft(faces: Uint32Array)` | 一组 **face 句柄** | **要求各截面顶点数一致**；ruled |
| `loftSmooth(faces)` | 同上 | 光滑拟合 |
| `loftWithOptions(faces, options)` | options JSON：`endPoint`（蒙皮收点）、`ruled` | 支持 endpoint 收点 |

即：brepkit **有**扫掠/放样，缺的是 OCCT `MakePipeShell` 级别的控制面（transition 模式、auxSpine+guideContact、support、解析式 law、orientation 参考系），以及 loft 的"任意 wire、顶点数可不同"的蒙皮自由度。

## 2. 现状与先例

### 现状
- `api/sweep.ts`：`defineOp({ engines: ['occt'] })`，brep 实现直连 `brep-operations/sweepFns.ts`（occt `simplePipe`/`sweepPipeShell`/`sweepFull`）。
- `api/loft.ts`：`defineOp({ engines: ['occt'] })`，brep 实现直连 occt `loft`/`loftWithVertices`（ThruSections）。
- L1 契约 `brep/engine/primitives.ts`（`BrepEngineApi`）**不含**任何 sweep/loft 方法——`engine-method-map.json` 里 `loft`/`simplePipe`/`sweepPipeShell` 均为 `occt-only, brepkit: null`。

### 先例：sketchOnPlane → sketchOnSurface 拆分（commit 6f5cd97）

`sketchOnFace` 曾因曲面 UV 贴合只有 occt 能做而整卡在 occt。解法：
1. **收窄基础 op**：`sketchOnFace` 只保留两内核都能做的**平面**能力，去掉 `engines` 声明 → 中立 op；
2. **高级能力独立 op**：曲面 UV 贴合拆成 `sketchOnSurface`（`engines: ['occt']`），报错信息里指路；
3. 两 op 共享底层桥接代码，产物形态一致（face），下游 `extrude` 无感。

## 3. 方案总览

照搬同一拆分模式：

| op | 引擎声明 | 能力 |
|---|---|---|
| `sweep`（基础，改造） | **无 engines**（occt + brepkit 双 BREP 实现） | 单截面沿路径扫掠；无 transition/law/auxSpine/support 等高级选项 |
| `sweepAdvanced`（新，occt-only） | `engines: ['occt']` | 现 `SweepOptions` 的 sweepFull 控制面整体搬入：`orientation`/`up`/`auxSpine`/`guideContact`/`support`/`transitionMode`(新名)/`law`/`lawLength`/`maxDegree`/`maxSegments`/公差族 |
| `loft`（基础，改造） | **无 engines** | 多截面蒙皮；`ruled`（brepkit: loft/loftSmooth）；`endPoint`（brepkit: loftWithOptions） |
| `loftAdvanced`（新，occt-only） | `engines: ['occt']` | `startPoint`（点退化蒙皮——brepkit 无对应）、任意顶点数截面的 ThruSections 完整语义、tolerance 精控 |

原则：**基础 op 的选项集 = 两内核交集**；某选项只有 occt 能做 → 该选项从基础 op 移除，进 advanced op（与 sketchOnFace 收窄完全同构）。

## 4. 基础 `sweep` 的 brepkit 实现

### 4.1 输入适配（核心工作）

brepkit `sweep(face, path NURBS)` 与 faijs 契约的差距及消化方式：

**① 截面 wire → face**
- faijs 契约：截面 wire 或 face（face 取外环，`toProfileWireView` 已有）。
- brepkit 只吃 face。适配：wire → `makeFace(wire)`（brepkitKernel 已接线 `makeFaceFromWire` 语义）。face 输入直接用。
- 闭合性：开口 wire 不构成合法截面 → 执行前显式报错（沿用 `E_SWEEP_NO_PROFILE` 风格，新增 `E_SWEEP_OPEN_PROFILE`）。

**② 路径 wire → NURBS 曲线四数组**

brepkit 路径参数是 `(degree, knots, control_points, weights)` 扁平数组。消化路径（复用本仓已有机制，不引新内核调用）：
1. 折线 wire（`cad.wire` 默认产物）：顶点即控制点，构造一次 NURBS——**优先方案**：直接用 L1 已有的 `interpolatePoints(pts, degree)`（BrepEngineApi 已声明、brepkitKernel 已接线 `interpolatePoints`）生成穿过顶点的 B 样条 edge，再 `getEdgeNurbsData(edge)`（brepkit 原生有）拆出四数组；
2. 圆弧/混合 wire：沿边按弧长采样（`curvePointAtParam` 已在 L1）取点列，同上 `interpolatePoints` 拟合。采样密度按折角自适应（转折 > 30° 的段加密），保精度；
3. 若 wire 本身就是单条 NURBS edge（`smooth` wire）：直接 `getEdgeNurbsData` 原样取，零损失。

适配器放 `brepkit-kernel/brepkitKernel.ts`（方言在此层消化的既有纪律），L1 新增中立名：

```
sweep(profileFace: BrepHandle, spine: BrepHandle): BrepHandle      // spine=wire，适配器内部转 NURBS
```

occt 适配器把该中立名映射到原生 `sweepPipeShell`（补两个默认开关 `false`）；**不用 `simplePipe`** —— 实测它对 8×8 方截面沿 +Z 扫 50 产出体积 2133.33，`sweepPipeShell` 为解析值 3200。brepkit 适配器做 ①② 转换后调 `kernel.sweep(...)`。**注意**：`getEdgeNurbsData` 只对 B 样条边返回数据、对解析边（line/circle）会 throw——采样拟合路线（方案 2）天然避开此坑（拟合产物必是 NURBS）；仅方案 3 需先判 `curveType(edge)==='bspline'`。

### 4.2 语义对齐声明（文档必须写清的差异）

brepkit 基础 sweep 与 occt `MakePipe` 在非平面路径上的截面参考系算法不同（RMF 细节差异）。基础 op 文档注明"复杂路径下两引擎产物可能有细微差别；需要确定性行为用 `sweepAdvanced`（occt）"。这是拆分方案接受的成本：**基础 = 交集语义，不承诺逐字节一致**。

### 4.3 选项白名单

基础 `sweep` 保留：`mode:'simple'`、`frenet`（occt 专用语义，brepkit 忽略?——**否**，见下）。收紧为：基础 `sweep` **不收任何选项**（第二参数后无 opts），需要任何控制的走 `sweepAdvanced`。理由：`frenet` brepkit 无对应，保留会造成静默语义分叉。

## 5. 基础 `loft` 的 brepkit 实现

**① 截面 wire → face**：同 4.1①（`makeFace`）。
**② 顶点数一致性**：brepkit loft 要求各截面顶点数相同。执行前检查（`getWireEdges`/`getFaceVertices` 已在导出面）；不一致 → 显式报错 `E_LOFT_SECTION_MISMATCH`，指路 `loftAdvanced`。这是**执行前静态可判**的输入约束，符合"禁止运行时回退"红线——不静默降级、不换引擎。
**③ 选项映射**：
- `ruled`（默认 true）：brepkit `ruled=true` → `loft`/`loftWithOptions`；`ruled=false` → `loftSmooth`；
- `endPoint`：`loftWithOptions` 的 `endPoint` JSON 字段直映射；
- `startPoint`：brepkit 无点退化蒙皮 → **从基础 loft 移除**，进 `loftAdvanced`；
- `tolerance`：brepkit 无对应 → 基础 loft 移除（occt 用内核缺省），进 `loftAdvanced`。

L1 中立名：`loft(profileFaces: BrepHandle[], ruled: boolean, endPoint?: BrepVec3): BrepHandle`。occt 适配器映射到原生 `loft`（ThruSections, ruled 对应；endPoint 用 `loftWithVertices` 退化段）。

## 6. 高级 op：`sweepAdvanced` / `loftAdvanced`

- `api/sweep-advanced.ts`、`api/loft-advanced.ts` 新文件；实现体直接把现 `sweep.ts` 的 sweepFull 分支、`loft.ts` 的 startPoint/tolerance 分支**平移**过去，产物走同一条 `fromBrep(solidToShape(...))` 收养路径。
- `SweepOptions` 里 sweepFull 专属字段全部迁到 `SweepAdvancedOptions`；`transitionMode:'right'` 旧别名保留在 advanced（旧脚本里给出这些字段的行为不变——**但 op 名变了**：存量脚本 `cad.sweep(w, p, { orientation: ... })` 需改为 `cad.sweepAdvanced(...)`。这是**破坏性变更**，需查存量 `.fai.js`/测试 fixture 中带 sweepFull 字段的调用点并同步改写，在方案实施第一步盘点）。
- `engines: ['occt']`；非 occt 链执行前报 `E_BREP_ENGINE_UNSUPPORTED`，错误信息指向"该引擎链请拆分/简化模型或使用基础 sweep"。
- 命名进 `symbol-table.generated.ts`（重跑生成）、`mesh/api.d.ts`（重跑 `gen-api-dts.ts`）、`docs/ops-api-inventory.md`。

## 7. 实施步骤

1. **盘点破坏面**：grep 存量脚本/fixture/tests 里带 sweepFull/loft startPoint 字段的 `cad.sweep`/`cad.loft` 调用点，列出改写清单。
2. **L1 扩契约**：`BrepEngineApi` 增 `sweep(profile, spine)`、`loft(faces, ruled, endPoint?)` 两个中立名；`gen-engine-method-map.ts` HAND_MAP 增两行（aligned/dialect + note）；重跑生成两份 surface JSON。
3. **brepkit 适配器**：`brepkitKernel.ts` 实现两方法（wire→NURBS 拟合、wire→face、顶点数检查）。
4. **occt 适配器**：映射 `simplePipe` / `loft`；保持现产物路径。
5. **改造基础 op**：`sweep.ts`/`loft.ts` 去 `engines` 声明，brep 分支按 `getBackends().kernel.brep` 当前引擎走 L1（不再直连 `getOcctKernel()`）；选项面收窄（高级字段删除）。
6. **新建 advanced op**：平移实现、声明 `engines:['occt']`。
7. **测试**：
   - 防回归（GOTCHA）：brepkit 链顶点数不一致 loft 必须执行前报错；开口 wire sweep 报 `E_SWEEP_OPEN_PROFILE`；`getEdgeNurbsData` 对解析边 throw 的坑（拟合路线规避）。
   - parity：同一模型 occt/brepkit 两链跑基础 sweep/loft，断言体积/包围盒在容差内（brepkit NURBS 拟合引入近似，容差按拟合精度定）。
   - 存量 sweep/loft 测试迁移到 advanced op 的改写。
8. **文档同步**：`docs/ops-api-inventory.md`、api-contract 引用点、错误码表。

## 8. 风险与边界

- **NURBS 拟合精度**：圆弧 wire 采样拟合成 B 样条是近似（非精确圆）。截面轮廓保真度下降是本方案最大的语义代价；缓解：采样密度自适应 + 单 NURBS wire 零损失直通。
- **brepkit loft 顶点数约束**：非等顶点截面在 brepkit 链上不可用（报错指路 advanced），不是静默降级——符合红线，但用户在 brepkit 链上会遇到功能分叉。
- **不涉及 mesh 链**：本方案只覆盖 BREP 双内核（occt / brepkit BREP 后端）。sweep/loft 的 mesh 后端（网格实体上的扫掠）不在本次范围，与 extrude 的 mesh 分支现状对齐（extrude 有 meshEngines，sweep/loft 暂无网格实现——维持现状）。
- **版本语义**：brepkit 侧能力以 3.6.0 实装为准；`package.json` 的 `^3.4.18` range 建议随本方案一并提升声明到 `^3.6.0`（走 set-version 流程的依赖规范化，不手改 range）。

## 9. 明确不做

- 不给 brepkit 补 MakePipeShell 级控制面（transition/auxSpine/support/解析 law）——那是内核侧功能，等 brepkit-wasm 上游。
- 不做运行时引擎回退（brepkit 链缺高级功能就报错，不偷偷切 occt）。
- 不动 `simplePipe`/`sweepPipeShell` 等 L2 平台名的现有归属。
