# 方案：brepkit 引擎支持 SVG 视图生成（projectView / projectSheet）

- 产出：glm5.3-flash + AtomCode
- 日期：2026-10-11
- 状态：已落地（2026-10-11：双方言分派 + brepkit 投影测试 + 文档/Agent Note 同 PR 完成）

## 0. 用户原话

> 本项目采用brepkit内核的时候，是否支持生成svg视图？

> 好的，写出一份方案。和step的处理一样，必须支持，可以有不同的实现。不需要申明engine

## 1. 目标与非目标

**目标**：brepkit BREP 引擎下，SVG 视图生成可用——脚本面 `cad.projectView(shape, view)`、`cad.projectSheet(shape, views)`，以及 TS 库面同名函数。与 STEP 处理同一基调：

- **必须支持**，不因 brepkit 缺特性而报错；
- **可以有不同的实现**——按引擎 id 静态分派通道，无运行时回退；
- **不申明 engine**——视图 op 本就没有 `engines` 声明（`script-face-manifest.ts` 中 `viewCamera` / `projectView` / `projectSheet` 均无 engines 字段），保持现状；实现体内不做引擎能力断言。

**非目标**：

- `toPNG` / `toMultiviewPNG`（PNG 栅格化，用户本轮只问 SVG 视图）；
- `toSVG` / `toMultiviewSVG`（`api/view-export`）——它们是直调 occt 原生方法的另一族导出 op，与 `projectView/projectSheet` 的 HLR 投影链路无关，本轮不动（若后续需要可按同一分派模式另行立项）。

brepkit 引擎下产出的 SVG 形态 = 按 brepkit 内核 `projectEdges` 的原生输出（已投影 2D 折线）序列化，一切以 brepkit 自己的实现为准。

## 2. 现状盘点（堵点在哪）

| 位置 | 现状 | 问题 |
|---|---|---|
| `brepkit-kernel/brepkitKernel.ts:1417` | `projectEdges` 已实现 L1 契约，返回 JSON 字符串 `{"visible":[[x,y,…]],"hidden":[[…]]}`（内核已投影好的 2D 折线点列） | 无堵点 |
| `engine-method-map.json` | `projectEdges` 登记 `status: "dialect"`（occt 返回 compound 句柄结构，brepkit 返回折线 JSON） | 方言差异待上层消化 |
| `api/view/view-projection.ts:79-143` `projectPolylines` | 把 `projectEdges` 返回硬断言为 occt 的 6 组 compound 结构（`ProjectEdgesResult`），逐 compound `getSubShapes` → `curveParameters`/`curvePointAtParam` 采样 | brepkit 下 6 个字段全 `undefined` → 循环全部 skip → **产出空 SVG，静默错误**（本方案唯一堵点） |
| `api/view/view-projection.ts:146+` `edgeToPath` | occt 方言专用：3D 边采样折线再投影 | brepkit 通道不需要（内核已投影），不复用也不删除 |
| `api/view/view-sheet.ts` | 纯 SVG 组合排版（嵌套 `<svg>` 网格 + 标签），消费 `projectViewSvg` | 引擎无关，无堵点 |
| 脚本面 / manifest | `projectView` / `projectSheet` 无 engines 声明 | 无堵点，保持 |

## 3. 方案总览

原则与 `2026-10-11-brepkit-step-io.md` 完全一致：**实现体按引擎 id 静态分派方言通道，无门禁、无引擎声明、无报错**。occt 通道保持现状；brepkit 引擎下走内核原生折线通道：

- 分派点在 `projectPolylines`（或其同层的方言适配函数）：取当前引擎 id（`getBackends()` / 引擎注册处，与 `export-model.ts` 的 `engineId === 'brepkit'` 同一口径）。
- **occt 通道**（现状，逐字节不变）：compound 句柄 → `getSubShapes` → 3D 曲线采样 → 相机平面投影 → SVG path。
- **brepkit 通道**（新增）：`kernel.projectEdges` 返回的 JSON 折线点列已是相机平面 2D 坐标（内核投影，含可见/隐藏两组）——直接解析 → 每条折线一个 `<path>`；`visible` 组实线，`hidden` 组虚线（stroke-dasharray，复用现有渲染参数 `strokeWidth`/`dash`/`hiddenOpacity`）。跳过 compound/曲线采样整条 occt 链。
- SVG 组装（`viewBoxOfPaths` / `projectViewSvg` / `projectSheet`）两组通道共用，单一真源。

## 4. 阶段拆解

### Phase 1 — 投影方言分派

1. `api/view/view-projection.ts`：`projectPolylines` 改为按引擎 id 分派：
   - brepkit → 新增 `projectPolylinesFromNative(api, solid, cam)`：调 `api.projectEdges(...)`（签名不变），解析 JSON 折线，返回同构的 `{ visible: string[]; hidden: string[] }`；
   - 其余（含 occt）→ 现有 compound 采样路径，不改一行行为。
2. **不做引擎能力断言**：分派只选通道，任何引擎缺投影能力时的行为不在本方案内报错（与 STEP 方案基调一致——不应有门禁、不应报错）。
3. GOTCHA 留档：`view-projection.ts:70-77` 现有注释"occt 的 HLR 输出已是相机平面坐标"对 brepkit 同样成立（brepkit 返回的也是投影后 2D 坐标），但**数据形态不同**（occt=compound 句柄待采样，brepkit=成品折线 JSON）——在方言分派处补注释说明。

### Phase 2 — brepkit 折线通道语义核实

1. 读 brepkit2 仓（`C:/my/Faicad/brepkit2`）`projectEdges` 绑定的 wasm 侧实现，确认：
   - 返回折线的坐标系（是否 = faijs 传入的 `xAxis`/`direction` 张成的相机平面、原点约定）；
   - `visible`/`hidden` 数组的元素结构（每条折线一个 `[x,y,…]` 扁平数组还是嵌套点对）；
   - `hiddenLines` / `deflection` 参数在 brepkit 侧的语义（当前 faijs 调用固定传 `true, 0.1`）。
2. 若 brepkit 侧缺隐藏线计算或语义偏差：按 brepkit 原生行为产出（隐藏组为空就不画虚线），**不报错、不在 faijs 侧补算 HLR**。

### Phase 3 — 测试与守卫

1. **防回归测试**（`packages/core/test/`，brepkit 引擎初始化沿用现有 brepkit 测试模式）：
   - brepkit 下 `projectView(box, 'front')`：产出非空 SVG、含可见线 path；体积/包围盒换算的 viewBox 合理性断言；
   - brepkit 下 `projectView(box, 'front')` 含隐藏线（box 背面棱 → hidden 组虚线 path，若内核提供）；
   - brepkit 下 `projectSheet` 多视图组合：非空、嵌套 `<svg>` 结构正确；
   - **occt 引擎下现有 projectView/projectSheet 测试逐字节不变（全绿）**——分派不得影响 occt 通道；
   - 方言分派测试：同一 shape 同一视图，两引擎均产出含 path 的 SVG（内容允许不同——按各自内核输出为准）。
2. **stderr 零容忍**：任何 warn 用例在测试内 spy 并断言。
3. 更新 `docs/ops-api-inventory.md` / `docs/api-contract.md` 中 `projectView` / `projectSheet` 的引擎说明（注明双通道：occt=HLR compound 采样，brepkit=内核原生折线）。
4. 同 PR 落一份 Agent Note 记录"视图投影双方言通道、无门禁、无 engines 声明"决策。

## 5. 风险与待验证点

| 风险 | 说明 | 处置 |
|---|---|---|
| brepkit 折线坐标系/数据结构未核实 | 方案假定返回已投影相机平面 2D 坐标，需读 wasm 绑定源码确认 | Phase 2 第 1 步先行核实，按实际结构写解析 |
| brepkit 投影质量未与 OCCT HLR 对比 | 离散精度、隐藏线完整性未知 | 以 brepkit 原生输出为准（用户基调）；可补一份投影对比测试留档结论 |
| `deflection`/`hiddenLines` 参数语义方言差异 | faijs 现固定传 `true, 0.1` | Phase 2 核实；语义不同则按 brepkit 侧缺省行为走，不报错 |
| JSON 解析失败兜底 | 内核返回非法 JSON 属于内核 bug | 直接抛错暴露（属实现缺陷，非"缺特性"），符合 BREP 红线 |
| brepkit mock / brep-mock 测试适配器 | `brep-mock.ts:417` 的 `projectEdges` 返回 `unsupported` | 不动 mock（mock 不参与分派测试）；如测试需要再给 mock 补折线桩 |

## 6. 验收标准

- brepkit 引擎下：`cad.projectView` / `cad.projectSheet` 产出非空、合法的 SVG 线稿（可见线必有；隐藏线按内核能力），**任何情况下不因 brepkit 缺特性而报错**。
- occt 引擎下：现有投影测试逐字节不变，全绿。
- 实现**不新增任何 `engines` 声明**，实现体无引擎能力断言；分派按引擎 id 静态选择通道，无运行时回退。
- 全量相关测试通过后按仓库流程跑 `scripts/ci.ps1` 一次。
