# 引入 truck 作为 faijs 第三 B-Rep 内核的可行性分析

- 日期：2026-10-26
- 状态：**方案（未实施）**
- 性质：可行性分析 + 分阶段引入建议

## 0. 用户原话（逐字记录）

> 帮我写一份分析文档，我想把truck引入C:\my\Faicad\faijs，做为一个新的brep内核的选择，可以取代occt/brepkit。

（此前同一会话中用户的逐步提问，逐字：）

> 分析本brep内核，它能够编译为masm吗

> 分析本brep内核，它能够编译为wasm吗，供web使用

> 这个项目有wasm版本吗？size多大，本地有编译好的wasm吗

> 帮我重新用 wasm-pack 编译一份最新的 wasm

> 如果：truck 缺 fillet/chamfer/抽壳/拔模等高级算， 那么C:\git\new\solidcraft项目是如何实现这些操作的？

> 把 SolidCraft 先例补进分析文档 §3.3

## 1. truck 内核现状调查结论

### 1.1 项目本体

truck（`C:/git/new/truck`）是 ricosjp 开发的纯 Rust B-Rep 几何内核，Apache-2.0 协议，workspace 含 18 个 crate。核心调查结论：

| 维度 | 结论 |
|---|---|
| 语言安全 | 核心 crate（`truck-base`/`truck-geometry`/`truck-modeling` 等）全部 `#![deny(unsafe_code)]`，无内联汇编、无平台绑定假设 |
| wasm 支持 | **一等公民**：`truck-js` 官方 JS 绑定层（wasm-bindgen + js-sys + gloo），`crate-type = ["cdylib"]`，仓库自带编译产物，CI 有 `docker/wasm-test.Dockerfile`（wasm32-unknown-unknown + wasm-pack + Deno 跑测试） |
| 本地 wasm 实测 | 已用 `wasm-pack build truck-js --target web --release` 重新编译成功，`pkg/truck_js_bg.wasm` 1.92 MB（release + `opt-level="z"`，gzip 后约 600–700 KB） |
| MASM | 不可行也不需要：rustc/LLVM 直接产出 COFF，不经过 MASM，工具链上无此路径（详见会话分析） |

### 1.2 能力矩阵（与 faijs 需求对齐）

| 能力 | truck crate | 对 faijs 的意义 |
|---|---|---|
| 拓扑（vertex/edge/wire/face/shell/solid + 半边结构） | `truck-topology` | 对应 faijs 的 `BrepHandle` 拓扑面 |
| NURBS 曲线/曲面、解析曲面（平面/球/环/双曲线等） | `truck-geometry` | 精确 B-Rep 几何 |
| 建模原语（拉伸/旋转/扫掠/多扫掠、长方体/球/圆柱/圆锥/圆环） | `truck-modeling` | primitives 层 |
| 布尔运算（并/差/交） | `truck-shapeops` | boolean 层（BREP 路径核心） |
| STEP 读写 | `truck-stepio` | io 层（faijs 有大量 STEP 依赖：装配导入、颜色解析） |
| 三角化/网格化、网格滤波 | `truck-meshalgo` | `BrepMeshResult` / wireframe 输出 |
| 装配（DAG） | `truck-assembly` | 装配树 |
| 渲染 | `truck-platform`/`truck-rendimpl`（wgpu） | **不需要**——faijs 自有 three.js viewer |
| 抽壳/倒角/圆角/拔模 | **缺失**（truck 无 fillet/chamfer/shell 等高级造型算子） | 与 OCCT 的关键差距，见 §3.3 |

## 2. faijs 侧的内核架构现状

faijs 已是**多内核注册架构**，这是引入 truck 的直接有利条件：

- 引擎身份固定三值：`BREP_ENGINE_IDS = ['occt', 'brepkit', 'brep_mock']`（`packages/core/src/brep/engine/types.ts`），每个 op 经 `defineOp` 的 `engines` 声明自证身份（D11-1/D11-2 narrowing 体系）。
- 引擎注册表（`engine/registry.ts`）：BREP/mesh 双槽位正交，异步 provider 注册，装配期冻结（R8）。新增引擎 = 注册期动作，无运行时切换 API。
- 引擎中立契约：`BrepHandle`（number + brand，OCCT hash 句柄同构）、`BrepMeshResult`（positions/normals/indices/faceGroups，face hash 上界 `BREP_HASH_BOUND = 2^31-1` 两侧同余）、`BrepEdgeData`、`*WithHistory` 面演化编码——均为实测钉死的单位口径，有跨引擎一致性测试（`topology/face-group-units.test.ts`）。
- 双路径几何契约（`docs/api-contract.md` §8）：BREP 精确路径 + mesh 路径（manifold-3d）；**跨引擎必须先经 mesh 层**——句柄不得跨引擎传递。
- 既有先例：brepkit 内核已走通"第三引擎接入"全套流程（适配器 + 一致性测试 + STEP 一致性分析 `docs/analysis/2026-09-18-brepkit-vs-occt-step-consistency.md`）。

## 3. 逐项可行性评估

### 3.1 wasm 交付：可行，工程量小

truck-js 已提供 wasm-bindgen 绑定与 wasm-pack 构建，产物 1.92 MB 与 occt-wasm 同量级。faijs 侧 `brepkit-kernel/brepkitWasm.ts` 的"异步 provider + wasm 下载"装配模式可直接复用。交付形式：`@faicad/faijs` 新增一个 truck 适配器包（或 vendor 进 `packages/core/src/truck-kernel/`，与 `occt-kernel`/`brepkit-kernel` 平级）。

### 3.2 适配器实现：可行，但句柄模型需适配

- faijs 的 `BrepHandle` 是 `number & brand`（OCCT wasm 的 shape id）。truck-js 返回的是 wasm-bindgen 包装的 Rust 对象引用。适配层需在 JS 侧建 `handle number → truck 对象` 注册表（自增 id + Map），或在 Rust 侧暴露 id-based API。这是纯适配层工作，不破坏契约（句柄仍然只回传给产生它的引擎）。
- `BrepMeshResult` 输出：truck-meshalgo 的三角化结果可映射为 positions/normals/indices；`faceGroups` 的 face hash 需用 truck 的 `HashCache` 输出并对 `BREP_HASH_BOUND` 取模，与拓扑提取侧对齐（曾因两侧上界不一致踩过 faceGroups 全 0 的坑，必须一开始钉死）。
- `BrepTessellateOptions`（linearDeflection/angularDeflection）：truck-meshalgo 支持按容差三角化，语义可对齐。

### 3.3 能力覆盖：**核心可行，高级算子有实质缺口**（最大风险）

faijs 当前依赖 OCCT 的能力中，truck 缺失或不完整的：

| 能力 | OCCT | truck | 影响 |
|---|---|---|---|
| 布尔（并/差/交） | ✅ | ✅ | 核心路径可用 |
| 拉伸/旋转/扫掠原语 | ✅ | ✅ | 核心路径可用 |
| STEP 导入导出 | ✅（成熟，多 AP） | ⚠️（基础 AP 支持，装配/颜色语义弱） | 装配导入、STEP 颜色解析需降级或保留 occt 路径 |
| 圆角/倒角（fillet/chamfer） | ✅ | ❌ 无 | occt-only op，truck 引擎下必须走 `engines: ['occt']` 拦截（faijs 已有该声明机制） |
| 抽壳/拔模/薄壁 | ✅ | ❌ | 同上 |
| 面演化历史（modified/generated/deleted） | ✅ | ⚠️ 布尔有 face 变更追踪，编码不同 | `*WithHistory` 需实测重编码 |
| 数值确定性 | 已验收 | 需按 `docs/reproducibility-contract.md` 单独验收（wasm32 浮点 + 排序稳定性） | 必须过 determinism scanner |

因此"**取代** occt/brepkit"在现阶段不成立——正确定位是**第三个引擎选项**：通用建模（原语 + 布尔 + 三角化）可由 truck 承接，高级造型算子与 STEP 重语义继续由 occt 承接（`defineOp.engines` 声明天然支持按 op 分流）。

### 3.3.1 SolidCraft 先例：缺口可在应用层补，但有代价（2026-10-26 调查）

SolidCraft（`C:/git/new/solidcraft`，纯 Rust 参数化 CAD）本身基于 truck 构建——把 truck-geometry/shapeops/stepio/meshalgo 四个 crate vendored 进 `vendor/` 并自行打补丁（Cargo.toml 注明修复了 truck debug 断言拒绝合法几何等问题）。truck 缺失的高级算子由它在 `crates/kernel` 手写，叠加在 truck 拓扑层之上：

| 算子 | 实现位置 | 思路与支持范围 |
|---|---|---|
| fillet/chamfer | `crates/kernel/src/blend.rs`（2000+ 行） | 局部 B-Rep 操作（非通用布尔）：直接把目标边替换为圆弧边并插入圆柱面，端面重建边界（truck-modeling 的 `Face`/`EdgeID` API）。仅支持"两平面面之间的直边、端面垂直、端顶点各只 touching 一个平面面"；曲线边、已混合角一律 `not supported yet` |
| 半径降级 | `blend_fit.rs`/`blend_variable.rs`/`blend_corner.rs` 等 | `fillet_max_each` 逐组求最大可行半径、`fillet_tapered` 沿边锥化、G2 版本与角点处理——半径放不下自动缩小/锥化并出警告 |
| shell/draft | `crates/kernel/src/polyhedron.rs` | 仅限**凸平面体**：由半空间直接求交构造实体（顶点 = 三平面交点），精确、仅末次抽壳用布尔；曲面体不支持 |
| 其它算子 | `offset.rs`、`delete_face.rs`、`emboss.rs`、`helix.rs` 等 | 全部自研；另以 mesh 路径（`meshbody`/`tspline`/`polybool`）兜底 |

对 faijs 的两点启示：其一，**应用层补齐是可行路径**——blend 系列合计约上万行专门几何代码，每个算子支持范围明确受限、靠"不支持就报错"逐步扩大；其二，**需预留 vendor 补丁机制**——SolidCraft 不直接用 crates.io 版本而是 vendored + 自修，faijs 引入 truck 也应按此预期。这条先例不改变 §3.3 的缺口结论（truck 上游至今无这些算子），但把"缺口不可控"细化为"可控但工程量大"。

### 3.4 与 mesh 路径的关系

faijs 的 mesh 布尔走 manifold-3d，与内核无关；truck 引擎接入后，跨引擎场景（如 truck 建模 → occt 圆角）按 §8.3 契约经 mesh 层中转，无新增架构负担。

## 4. 分阶段引入建议

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 spike | vendor truck-js 产物，注册 `truck` 引擎（`BREP_ENGINE_IDS` 增加第四值），实现 `primitives` 最小集（box/cylinder 原语 + meshShape） | 跨引擎 face-group-units 测试覆盖 truck |
| M1 布尔 | union/difference/intersect + 拓扑提取（wireframe/faceGroups） | 与 occt/brepkit 三方一致性用例 |
| M2 STEP | truck-stepio 导入导出 + 与 occt STEP 保真度对比（复用 2026-09-18 分析的方法论） | 保真度差距清单成文 |
| M3 缺口决策 | 基于 M1/M2 实测决定 op 分流表（哪些 op engines 标 `['truck','occt']`、哪些 occt-only） | ops-api-inventory 更新 |
| M4 确定性验收 | 按 reproducibility-contract 跑 determinism scanner | 通过后 truck 可作为脚本默认引擎选项之一 |

## 5. 结论

- **能编译为 wasm 供 Web 使用：是**，且已有官方 wasm 绑定与产物（1.92 MB），已本地复现构建。
- **能否引入 faijs：可行**，faijs 的引擎注册架构（`BREP_ENGINE_IDS` + provider + `defineOp.engines`）正是为此设计的，brepkit 已验证过第三引擎接入路径。
- **能否"取代"occt/brepkit：现阶段不能**——fillet/chamfer/shell/拔模等高级算子与 STEP 重语义是实质缺口；合理定位是第三引擎 + 按 op 分流，待 M0–M3 实测后再评估替代程度。
- 最大工程风险排序：①高级算子缺口（上游缺失，但应用层补齐可行——SolidCraft 已验证，代价是数千至上万行专用几何代码 + vendor 补丁机制，见 §3.3.1）→ ②face hash/面演化编码对齐（可控，需实测钉死）→ ③STEP 保真度（可控，可保留 occt 路径兜底）。
