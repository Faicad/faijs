# faijs BREP 引擎可切换架构方案

> 日期 2026-08-30 ｜ 状态：**方案（未实施）** ｜ 参照项目 `C:\git\OpenCascade\brepjs`
>
> **2026-08-30 修订**：§5.2 / §9.1 / §9.3 / §9.4 / §10.2 / §12-6 / 附录 A 按 monorepo 迁移后的代码现状与 3d_editor 实测消费面更正（版本 3.7.0 → 3.8.4；browser 入口真实导出面；对 monorepo-plan §6.2 的决策反转记录）。修订处均带 ⚠️ 标记与日期。

---

## 0. 需求锚点（用户原话）

> 请分析本项目的代码，以及 `C:\git\OpenCascade\brepjs` 项目。
> **brepjs项目是允许引擎切换的。我想要让本项目也能够实现引擎切换。**
> **但是本项目的引擎切换和brepjs项目不同。** 比如，在brepjs项目中，occt和manifold都是实现相同接口的引擎，是一个相互替代的角色。
> **本项目中，则明确区分mesh引擎与brep引擎，希望可以单独切换某一个引擎。其实主要是希望能够切换brep引擎。**
> **目前的occt是lgpl的，希望未来能够切换到一个允许私有打包的引擎上。**

拆成四条可验收的需求：

| # | 需求 | 验收判据 |
|---|---|---|
| R1 | 引擎可切换 | 切换 BREP 引擎不需要修改 `src/brep/**` 任何一行 |
| R2 | **双槽位正交**：mesh 引擎与 BREP 引擎是两个独立的槽，可单独切换其中一个 | 只换 mesh 引擎时 BREP 链行为完全不变，反之亦然 |
| R3 | BREP 引擎是切换重点 | 新增一个 BREP 引擎 = 新增一个包 + 注册，不动引擎核心 |
| R4 | 未来可换到**允许私有打包**的引擎 | 在不安装 `occt-wasm` 的情况下，`npm run build` + `npm run typecheck` + 纯 mesh 模式执行全部通过 |

### 0.1 需求锚点补充（用户对本方案第一版的纠正）

> **接口切在哪一层的理解不正确。** 本项目已有的 stdlib 其实只是一个 demo。
> **真实的库能力必需看齐 `C:\git\new\onshape\onshape-std-library-mirror`，要支持它的所有上层特征。**
> 你帮我分析 occt-wasm 的 api，以及 onshape 标准库底层依赖的 api，**看它们的交集有多大**。
> **引擎接口需要的是在这两个之间二选一，或者一个折中。**

三条可验收需求：

| # | 需求 | 验收判据 |
|---|---|---|
| R5 | **库能力看齐 Onshape 标准库** | 151 个 `@` 原生内核入口**逐项有归属**（附录 A 五分类：契约面 / 库层组合 / 可选能力槽 / 单独立项 / 其他槽位），无一项悬空；最终以 §7.7 的「107 特征 × 支持矩阵」滚动验收 |
| R6 | **接口切层要经得起两个面的夹逼** | 引擎接口既不能被 OCCT 的方法形状污染（否则新引擎无法对齐），也不能把非几何内核的职责（草图求解、查询引擎、钣金）塞进引擎契约 |
| R7 | **切层决策要有数据支撑** | 给出 Onshape 需求面 × OCCT 提供面的**逐项映射表与交集量化**，而非定性判断 |

> **⚠️ 本方案第一版（v1）的 §7 切错了层**——它按"faijs 现有 demo op（drill / split / engrave …）"切，而这些 op 只是 demo，不是真实目标面。§7 已按 R5–R7 重写。

### 0.2 需求锚点补充（用户对切换时机的定调）

> **还有一个事情，引擎的切换只会发生在构建/打包时刻，不会发生在运行时刻。这个只有开发者决定什么时候切换，频率非常低的一个事情。**

| # | 需求 | 验收判据 |
|---|---|---|
| R8 | **引擎切换只发生在构建/打包时刻**，运行时无切换 | 运行时 API 表面不存在任何"切换引擎"入口；引擎绑定发生在宿主装配/初始化期，之后冻结 |

**对 v1 的影响**：v1 §8 的"执行中切换策略"（`strict` / `materialize` / `reset` 三策略）整套删除；brepjs 的运行时切换机制（`getKernel` / `withKernel`）从"参考改造"降级为"明确不抄"。§8 已按 R8 重写。

---

## 1. 结论先行

0. **【本轮新增，且推翻 v1 的 §7】引擎接口既不能切在 OCCT 面，也不能切在 Onshape 面，必须"分层拆解"**。对 Onshape 标准库依赖的 151 个 `@` 原生内核入口逐项映射后的实测结果是：**occt-wasm 直接对应 39 项（26%）／faijs 库层可组合实现 61 项（40%）／硬缺口 13 项（9%）／根本不属于几何内核职责 38 项（25%）**。直接交集只有 26%——这直接否决了"接口 = OCCT 方法面"和"接口 = Onshape 原语面"两种切法。且 13 项硬缺口里 9 项是"OCCT C++ 有、occt-wasm 未暴露"的可补缺口，**真正任何候选引擎都给不出的只有 4 项**（曲面缠绕 + 钣金展平族 3 项）。逐项映射表见附录 A，分析见 §7.1–§7.3。
1. **用户对许可证的判断成立，但粒度要精确**：`occt-wasm` 的 npm `license` 字段写的是 `MIT OR Apache-2.0`，那只覆盖 build tooling；**编译出的 WASM 产物是 `LGPL-2.1-only`**。详见 §5。
2. **候选格局在本文写作时刚发生剧变**：brepjs 现在用的 `brepkit-wasm` 从 3.0.0 起转为 **AGPL-3.0-only**，不再是私有打包的选项；其 Apache-2.0 延续版是 **Remus**。详见 §5.2。
3. **faijs 做引擎切换比 brepjs 容易得多**，原因是 faijs 的表示模型天然解耦了跨内核对象互通这个 brepjs 最难的问题——brepjs 为此写了 557 行 op-graph 重放，faijs **完全不需要**。详见 §4.3。
4. **已有的可替换基础比预期好**：`src/brep/**` 全部是 `f(kernel, solid, ...)` 纯函数形态，`Backends.kernel.occt` 类型已经是 `unknown`，`ShapeSlot.solid` 已经是 `unknown`，并且存在 `setOcctWasmInitFn` 这个现成的注入钩子。
5. **主要工作量不在"抽象"，而在"隔离"**：把 33 处 `import type ... from 'occt-wasm'` 解掉、把 `occt-wasm` 从硬依赖降为可选依赖。
6. **用户指出"本项目 stdlib 只是 demo"属实，且差距被量化了**：faijs 现有 `packages/stdlib/src/` 约 20 个 op；Onshape 标准库是 **107 个 feature / 151 个内核入口 / 14.6 万行**。R5 是比 R1–R4 大一个数量级的工程。本方案只解决**其中与引擎切层有关的那部分**（§7.4 的 port 面），库层本身的分期见 §7.7。
7. **【本轮新增】切换时机被定调为构建/打包时（R8），方案因此进一步简化**：不需要运行时切换 API、不需要执行中切换策略、不需要切换瞬间的对象迁移；brepjs 的运行时切换机制（`getKernel`/`withKernel`）整条不抄。引擎选择在宿主装配期冻结，能力表在启动时即完全确定，`dispatchPath` 的静态路由判据因此仍是纯静态的（§8）。

---

## 2. 现状：faijs 的 OCCT 耦合全景

### 2.1 耦合的三层结构

```
L2  stdlib/         13 处 getBackends().kernel.occt as OcctKernel   ← 类型已是 unknown，纯类型替换
L1  brep/           全部 kernel-first 纯函数；2 处例外抓全局       ← 抽象边界最好
L0  occt-kernel/    持有模块级单例 kernelInstance                   ← 唯一真耦合点
```

**关键的正面事实**（已逐行核对）：

- `src/brep/brep-ops.ts:40,76,190,206,222,262,401,491,662` 全部是 `f(kernel: OcctKernel, solid: ShapeHandle, ...)` 形态，**没有一处读全局**。这一整层换内核时只改参数类型，不动调用逻辑。
- `src/runtime-state.ts:40-44` 的 `Backends.kernel.occt` 字段类型**已经是 `unknown | null`**（注释写明"避免本模块依赖具体实现"）。13 处 stdlib 调用点现在做的是 `as import('occt-wasm').OcctKernel` 显式下转型——只要把这里换成一个新接口类型，运行时零改动。
- `src/runtime-state.ts:111` `ShapeSlot.solid?: unknown`、`src/stdlib/shape.ts:63` `BrepHolder.solid: unknown`——句柄在身份系统里已经是不透明的。
- `src/brep/handle-bridge.ts:20-25` 已存在一个 duck-typing 的 `MeshableKernel` 接口，只声明 `meshShape` 一个方法，注释写明"不 import occt-wasm，只做结构匹配"。**这就是内核接口该长什么样**，只是它只覆盖了 1 个方法。
- `src/cad-runtime/backend-dispatch.ts:39` 的 `dispatchPath` 与具体内核无关，换内核不影响这一层。
- `src/occt-kernel/occtKernel.ts:42` 的 `setOcctWasmInitFn(fn: () => Promise<OcctKernel>)` 是**现成的、无需改架构即可接入新内核的入口**（`:60-63` 优先使用注入函数）。

### 2.2 真正的耦合点（需要改的）

| 类别 | 位置 | 问题 |
|---|---|---|
| **模块级单例** | `src/occt-kernel/occtKernel.ts:23-24` | `kernelInstance` / `initPromise` 硬编码 `OcctKernel` 类型 |
| **裸抓全局** | `src/occt-kernel/occtKernel.ts:425`（`meshesToStep`）、`src/occt-kernel/topologyExt.ts:567`（`buildSelectorManifest`，⚠️ 2026-08-30 修订：初稿写 :572，实测 :567） | 无参数注入版本 |
| **brep 层例外** | `src/brep/brep-chain.ts:124`、`src/brep/primitives-brep.ts:63` | 唯二在 `src/brep/` 层抓全局单例的地方，破坏了该层的一致性 |
| **类型泄漏** | `import type` 语句 **20 处（非测试 .ts，core 17 + stdlib 3）** + 内联 `import('occt-wasm')` 类型引用 **37 处（非测试 .ts）**（⚠️ 2026-08-30 复核修正：初稿"33 处 / 生产 11 处"漏列 8 个文件且未统计内联形态，完整清单见 §9.2） | 未安装 `occt-wasm` 时 `tsc` 直接失败 → R4 的最大障碍 |
| **句柄类型** | `ShapeHandle = number & brand`（occt-wasm 定义） | 新引擎若为对象句柄，33 处签名全要改 |
| **WASM 路径硬编码** | `src/occt-kernel/occtKernel.ts:75,79` | `monorepo-plan.md:1219` 已列为 P-0 缺陷 |
| **依赖声明** | `package.json:86` `dependencies` + `:106` `overrides` 双锁 | 硬依赖，无法"不装" |
| **OCCT 不在 HostPorts** | `src/cad-runtime/ports.ts:182` | 绕过了整个 Port 注入体系，走 globalThis 单例 |

### 2.3 OCCT 方法面（新引擎需要覆盖的最小面）

> **⚠️ 路径口径（2026-08-30 复核）**：仓库已重组为 monorepo，本文 v1 的 `src/...` 路径现已迁移到 `packages/core/src/...`，op 实现迁移到 `packages/stdlib/src/...`。下文数字已按新路径**重新实测**。

**occt-wasm 提供的面**：`OcctKernel` 类 **201 个公开实例方法**（`node_modules/occt-wasm/dist/index.d.ts`，`awk '/^export declare class OcctKernel/,/^}/' | grep -cE '^    [a-zA-Z_]+\('`，不含 `private constructor` 与 `static init`），对应 rust 侧 `crate/src/kernel_generated.rs` 的 **193 个 `pub fn`**（`C:\git\OpenCascade\occt-wasm`）。

**faijs 实际用到的面**：生产代码（`packages/core/src` + `packages/stdlib/src`，排除 `*.test.ts` / `*.d.ts`）调用 **`kernel.<method>()` 共 66 个不同方法、388 次**：

```
120 release          24 makeLineEdge        15 translate          15 getSubShapes
 14 transform        12 fuse                11 meshShape          10 makeWire
 10 curvePointAtParam 8 pointOnSurface       8 hashCode            8 cut
  8 curveParameters   7 makeBezierEdge       6 makeFace            6 makeCylinder
  6 getBoundingBox    6 extrude              4 makeBoxFromCorners  4 makeArcEdge
  4 isSolid           4 importStep           4 copy                3 unifySameDomain
  3 isValid           3 getSurfaceCenterOfMass 3 generalTransform  3 fromBREP
  3 exportStep        3 curveTangent         3 common              2 wireframe
  2 surfaceType       2 surfaceNormal        2 sewAndSolidify      2 scale
  2 removeDegenerateEdges 2 makeCone         2 loft                2 healSolid
  2 fixShape          2 fixFaceOrientations  2 curveType           2 curveLength
  2 curveIsClosed     2 addHolesInFace       1 uvBounds            1 subShapeHashes
  1 shapeOrientation  1 section              1 makeSphere          1 makeRectangle
  1 located           1 isSame               1 intersectWithHistory 1 importXCAFFromSTEP
  1 importStl         1 getVolume            1 getNurbsCurveData   1 getFaceCylinderData
  1 getCenterOfMass   1 fuseWithHistory      1 fuseAll             1 cutWithHistory
  1 createXCAFDocument 1 buildTriFace
```

> **修正 v1 的一处事实错误**：v1 写「`makeBoxFromCorners` **51 次**」，该数字把测试文件算进去了。**生产代码实际只调用 5 次**（⚠️ 2026-08-30 复核：初稿写 4 次，实测 5 处，`brep/brep-ops.ts:430`、`primitives/brep-primitives.ts:92`、`stdlib/brepjs-mirror/joinery-brep.ts:373` 等）；其余 47 次全在 `*.test.ts` 里。这直接降低了该方法的适配风险等级——见 §12 风险 4 的修订。

其中 **OCCT 特有、新引擎未必有对应物** 的（需要适配器做语义映射，而不是简单转发）：

| 方法 | 生产调用次数 | 为何特殊 | 适配思路 |
|---|---|---|---|
| `makeBoxFromCorners` | **4** | 对角点建 box，非 engine 通用 API | `makeBox` + `translate` 组合（默认实现）。风险等级已因次数修正而下调 |
| `createXCAFDocument` / `importXCAFFromSTEP` | 1 / 1 | OCCT 的 XCAF 装配文档模型 | 装配导入降为**可选能力**；缺失则装配走 mesh 路径 |
| `cutWithHistory` / `fuseWithHistory` / `intersectWithHistory` | 1 / 1 / 1 | faijs 面演化的基础（`face-evolution.ts`） | 列为可选能力，缺失则 `faceEvolution` 不可用 |
| `buildTriFace` + `sewAndSolidify` | 1 / 2 | mesh→BREP 提升路径（`meshesToStep`） | 列为可选能力（`meshToSolid`） |
| `release` | **120** | 手工内存管理 | 接口保留；GC 型引擎实现为 no-op |
| `getSubShapes` / `hashCode` / `subShapeHashes` | 15 / 8 / 1 | 拓扑内省 | **升为必需能力**（§7.4 理由：查询引擎与面演化的地基，不是可选） |
| `queryBatch` | **0（仅测试）** | 批量查询 | **不在生产路径上**，无需适配 |

---

## 3. 参照：brepjs 的引擎切换机制

### 3.1 brepjs 怎么做（`C:\git\OpenCascade\brepjs`）

| 机制 | 位置 | 形态 |
|---|---|---|
| **接口分族 + 交集聚合** | `src/kernel/interfaces/index.ts:29-44` | 15 个子接口（boolean/primitive/builder/sweep/modifier/transform/evolution/mesh/io/measure/topology/curve/surface/repair）交集成 `KernelAdapter`，约 164 个方法 |
| **编译期完整性守卫** | `src/kernel/occt/defaultAdapter.ts:198-202` | `type _AssertSatisfiesKernelAdapter = (...args) => KernelAdapter; const _check = (oc) => new DefaultAdapter(oc)`——漏实现任何方法，编译器精确列出缺失属性 |
| **注册表** | `src/kernel/index.ts:22-43` | 模块级 `Map<string, KernelAdapter>` + `_defaultKernelId`，**第一个注册的自动成为默认** |
| **切换 API** | `src/kernel/index.ts:39,50,92,96` | `registerKernel(id, adapter)` / `getKernel(id?)` / `getActiveKernelId()` / `withKernel<T>(id, fn)` |
| **`withKernel` 显式拒绝 async** | `src/kernel/index.ts:96-119` | 检测回调返回 `Promise` 就抛错，因为 `finally` 里同步恢复 |
| **能力声明** | `src/kernel/capabilities.ts:18-49` | `KernelCapabilities { exact, brepExport, exactMeasurement, tessellationModel }` |
| **不支持即抛错** | `src/kernel/unsupported.ts:10-27` | `UnsupportedKernelOperationError`，用 `Symbol.for()` 全局标记而非 `instanceof`，以便跨 bundle 边界识别 |
| **跨内核互通** | `src/kernel/manifold/replay.ts:546` | **op-graph 重放**（557 行）：manifold 记录操作意图图，在目标内核上重放 |
| **适配器静态导入 / WASM 动态导入** | `src/kernel/index.ts:7-10` + `optionalBackend.ts:15` | `importOptionalBackend(specifier)`，specifier 必须是**变量**以规避打包器静态分析 |

### 3.2 抄什么 / 不抄什么

| brepjs 机制 | 抄？ | 理由 |
|---|---|---|
| 接口分族 + 交集聚合 | ✅ **抄** | 好设计，faijs 也应按功能族切接口 |
| **编译期完整性守卫** | ✅ **抄，优先级最高** | 投入极小（5 行）、收益极大。faijs 加新引擎时漏实现立即编译报错 |
| 模块级 `Map` 注册表 + 首个注册者为默认 | ✅ **抄** | 极简且够用 |
| `Symbol.for()` 全局错误标记 | ✅ **抄** | faijs 同样有"两份 faijs 代码"问题（`runtime-state.ts:160-163` 的注释已经承认这个场景），`instanceof` 同样不可靠 |
| 适配器静态导入 / WASM 包动态导入 | ✅ **抄** | 直接服务于 R4（私有打包隔离） |
| 动态 import 的 specifier 必须是变量 | ✅ **抄** | 未安装的可选依赖不应导致构建失败 |
| `UnsupportedKernelOperationError` 抛错语义 | ✅ **抄** | 与 faijs 现有红线一致（不静默降级） |
| **`withKernel(id, fn)` 同步作用域** | ❌ **不抄** | 双重理由：① **faijs 的执行是异步的**——`initOcctWasm()` 返回 Promise，`runtime.execute()` 是 async，同步作用域 API 在 faijs 没有可用场景；② **用户已定调切换只发生在构建/打包时（R8）**，运行时切换 API 整体不需要 |
| **单槽位 `getKernel()`** | ❌ **不抄** | 这正是用户指出的差异点。faijs 要双槽位，见 §4 |
| **`capabilities` 只描述不路由** | ❌ **不抄** | brepjs 全仓无 capabilities 消费方（`src/index.ts:25` 只有再导出）。**faijs 应该反其道而行**——因为 faijs 已有静态分派点 `dispatchPath`，让 capability 参与静态路由是自然且合规的，见 §8.3 |
| **op-graph 重放（557 行）** | ❌ **不抄，且不需要** | faijs 的表示模型让它根本不成为问题，见 §4.3 |
| `Result<T,E>` 包装 | ⚠️ 暂不抄 | faijs 现有错误语义是 throw + `BrepUnsupportedError`，改动面过大，不在本方案范围 |
| 错误正则翻译 | ⚠️ 暂不抄 | 同上 |

---

## 4. 关键差异：faijs 的双槽位模型

### 4.1 brepjs：单槽位平替

```
brepjs:   ┌─────────────────────────┐
          │   getKernel() → 唯一的   │
          │   KernelAdapter          │
          └─────────────────────────┘
            occt │ brepkit │ manifold │ occt-wasm
            （四选一，互相替代，任一时刻只有一个）
```

manifold 在 brepjs 里被塞进同一个 `KernelAdapter` 接口，但它是个"残缺实现"：`manifoldAdapter.ts:76-83` 声明 `exact: false, brepExport: false`，29 个方法直接抛 `UnsupportedKernelOperationError`。**brepjs 是把一个 mesh 内核硬塞进 B-rep 接口里**——这就是为什么它需要 op-graph 重放：manifold 算不出精确结果，只好把操作记下来交给 OCCT 重算一遍。

### 4.2 faijs：双槽位正交

```
faijs:    ┌──────────────────┐   ┌──────────────────┐
          │  brepEngine 槽   │   │  meshEngine 槽   │
          │  occt / remus…   │   │  manifold-3d / … │
          └────────┬─────────┘   └────────┬─────────┘
                   │                      │
                   └──────┬───────────────┘
                          ▼
              Shape = { positions, indices }   ← 公共货币（必有载荷）
              + slot.solid?: BrepHandle        ← BREP 叠加层（可选）
```

两个槽位**不是替代关系，是分工关系**：

- **mesh 引擎**负责：knurl、SDF、STL/mesh 导入、所有 mesh-CSG 布尔、以及最终的显示三角化。**它是每条链的必经之路**（`Shape` 是必有载荷）。
- **BREP 引擎**负责：精确布尔、精确扫掠、STEP/BREP 导入导出、拓扑与面演化。**它是可选的精度增强层**，可以随时断链。

这正是 `src/mesh/types.ts:35-38` 与 `src/stdlib/shape.ts:114-121` 表达的表示模型：**mesh 必有，BREP 叠加**。

> **R2 的可验收含义**：`brepEngine` 与 `meshEngine` 各自独立注册、独立切换。换 mesh 引擎不影响任何 BREP 语义；换 BREP 引擎不影响任何 mesh 语义。

### 4.3 为什么 faijs 不需要 brepjs 的 op-graph 重放

这是本方案最重要的简化，也是 faijs 相对 brepjs 的结构性优势。

brepjs 的难题：manifold 产出的 shape 是三角汤，OCCT 不认识它。要做精确 STEP 导出，只能把操作历史重放一遍。代价是 557 行 `replay.ts`，且**不可重放时降级为刻面近似 + `console.warn`**（`manifold/ioOps.ts:318-330`）——即"悄悄变差"。

faijs 没有这个问题，因为：

1. `Shape = { positions, indices }` 是**所有 part 的公共货币**，不存在"某个 part 只有 BREP 没有 mesh"的状态。
2. BREP 断链时**必然经过三角化**，这已经是既有机制：`src/stdlib/reconcile.ts:29-44` 的 `reconcileBrepInputs` + `src/mesh/reconcile.ts` 的归约四步 + `part-brep-lost` 事件。
3. **在 R8（构建时切换）的定调下，连"切换瞬间链上有活 part"的场景都不存在**——换引擎必然伴随重新构建与进程重启，所有句柄随进程消亡。退一万步，即使未来开放运行时切换，也只是复用既有断链物化管线（`reconcileBrepInputs` + `part-brep-lost`），**仍然不需要重放**。

推论：**faijs 的引擎切换实现成本，主要在"隔离"（§9）而不是"互通"**。这是与 brepjs 投入结构的根本不同。

---

## 5. 许可证事实核查（R4 的动机核验）

### 5.1 occt-wasm 的许可证是分层的

`node_modules/occt-wasm/package.json` 的 `license` 字段是 **`MIT OR Apache-2.0`**，但 README 的 License 章节写得很清楚：

> **Build tooling** (xtask, scripts, TypeScript wrapper): MIT OR Apache-2.0
> **Compiled WASM output**: **LGPL-2.1-only** (inherits from OCCT)
> The LGPL requires that end users can replace the LGPL component. For web applications, this is satisfied by loading the `.wasm` file from a URL (which users can override via `OcctKernel.init({ wasm: '...' })`). **If you ship a desktop app with the WASM embedded, consult the LGPL-2.1 FAQ.**

**结论**：用户说"occt 是 lgpl 的"——**成立，且指向的正是 WASM 产物**。npm 字段那个 `MIT OR Apache-2.0` 只覆盖包装代码，容易误判。

对 Faicad（桌面应用 + Web 双形态）的具体影响：

| 形态 | LGPL-2.1 合规性 | 说明 |
|---|---|---|
| Web（wasm 从 URL 加载） | ✅ 基本可满足 | 用户可替换 wasm，符合 LGPL 的 relink 要求 |
| **桌面内嵌 wasm 二进制** | ⚠️ **真实障碍** | 必须提供 relink 能力（给出目标文件/替换机制），或取得商业授权 |

**这正是 R4 的合理动机，证伪不成立。**

### 5.2 候选 BREP 引擎现状（2026-08-30 核查）

| 引擎 | 许可证 | 私有打包 | 成熟度 | 备注 |
|---|---|---|---|---|
| `occt-wasm` **3.8.4**（当前） | WASM 产物 **LGPL-2.1-only**；tooling MIT/Apache | ⚠️ 桌面内嵌受限 | 成熟（faijs 在用） | ⚠️ 2026-08-30 修订：初稿写 3.7.0，仓库 HEAD `3f79826` 已 bump 到 3.8.4 |
| OCCT 官方商业授权 | 商业 | ✅ 付费 | 成熟 | Open Cascade SAS 提供 |
| `brepkit-wasm` **≤ 2.129.x** | MIT OR Apache-2.0 | ✅ | 停滞在旧版 | 旧版本条款仍然有效 |
| `brepkit-wasm` **≥ 3.0.0** | **AGPL-3.0-only** 或商业授权 | ❌ 需购买 | 活跃 | **刚转 AGPL**（3.0.0 发布于本文写作前约 1 小时）。brepjs 目前锁的是 `^2.126.2`，恰好在最后一个 MIT 版本区间 |
| **Remus**（`esaueng/remus`） | **Apache-2.0（permanent）** | ✅ | 活跃开发中 | **brepkit 改 AGPL 后的 Apache-2.0 延续版**，见下 |
| `Breprs` | MIT OR Apache-2.0 | ✅ | 0.6.1-alpha（2026-03） | 成熟度不足 |
| ACIS / Parasolid | 商业 | ✅ 付费 | 工业级 | 成本高 |

**关于 Remus**（`github.com/esaueng/remus`）：

- 身份：提交 `a194d2e`（PR #37，`refactor: rename the kernel identity from brepkit to remus`，2026-08-17）确认它是 brepkit 的重命名延续，crate 名统一为 `remus-*`；`NOTICE`、`provenance ledger` 与 `.step` fixture **故意保留**历史名 `brepkit`。
- 许可证：提交 `bcbc824`（PR #248，`chore: establish permanent Apache-2.0 line`，2026-08-14）。
- WASM/TS：`remus-wasm`（wasm-bindgen，L3）+ TypeScript bindings，`crates/wasm/pkg` 已刷新到 **v2.130.0**。**未确认已发布到 npm**——下游 brepjs 目前以 git path 消费。
- 已实现且有证据的：布尔（fuse/cut/intersect，含精确体积校验）、extrude、sweep（miter，体积 exact）、loft（曲线保持）、tessellation（793 个 stage capture 全部定向水密）、STEP I/O（`remus-io` corpus **473/473**）。
- 未确认：fillet/chamfer 完成度、revolve、拓扑查询 API 形态、**面演化（face evolution）API 是否暴露**。

### 5.3 对本方案的结论

- **不把"选哪个引擎"写死进方案**。R4 的实质是**架构可替换性**，不是现在就换。
- 接口设计必须接纳"能力不齐"的引擎：Remus 这类引擎很可能**没有** OCCT 的 `cutWithHistory` / XCAF 装配 / `buildTriFace`。所以能力必须分层、可选，并让缺失能力静态地降级到 mesh 路径（§8.4），而不是让引擎去伪造这些 API。
- §5.2 的表格应作为**活的选型档案**维护在本文档，不写进代码。

---

## 6. 目标架构

### 6.1 分层

```
L3  Host             createRuntime({ brep: 'occt' | 'remus', mesh: 'manifold' })  ← 装配期选定，之后冻结（R8）
L2  CadRuntime       持有两个引擎句柄 + BrepChainState
L1.5 库层            packages/stdlib：B 类组合实现 + 特征层（对齐 Onshape 107 特征，§7.7）
L1  接口层           src/brep/engine/          ← 新增，零具体实现依赖
      ├ types.ts          BrepHandle / BrepMeshResult / BrepCapabilities
      ├ primitives.ts     BrepPrimitives（引擎契约面，83 项分 14 族，§7.4）
      ├ capabilities.ts   可选能力槽（evolution / heal / directEdit / advSurface / assembly / meshLift，§7.5）
      └ registry.ts       双槽位注册表 + 编译期守卫
L0  适配器            src/brep/engine/occt/    ← 唯一 import occt-wasm 的地方
                      src/brep/engine/remus/   ← 未来
                      src/mesh/engine/manifold/ ← mesh 槽
```

**依赖红线**：`src/brep/**`（除 `engine/<impl>/` 外）**禁止**出现 `occt-wasm`、`brepkit-wasm`、`remus-wasm` 的任何 import（含 `import type`）。由 ESLint `no-restricted-syntax` + 一条扫描测试强制（brepjs 在 `src/kernel/README_cn.md:26` 用同样手段禁止 `x.wrapped.method()`）。

### 6.2 双槽位注册表

```ts
// src/brep/engine/registry.ts

/** BREP 引擎注册表（槽位 1）。 */
const brepEngines = new Map<string, BrepEngine>()
let defaultBrepId: string | null = null

/** mesh 引擎注册表（槽位 2）——与 BREP 槽完全独立。 */
const meshEngines = new Map<string, MeshEngine>()
let defaultMeshId: string | null = null

export function registerBrepEngine(id: string, engine: BrepEngine): void
export function registerMeshEngine(id: string, engine: MeshEngine): void
export function getBrepEngine(id?: string): BrepEngine          // 未注册则抛错
export function getMeshEngine(id?: string): MeshEngine
export function getActiveBrepEngineId(): string | null
export function getActiveMeshEngineId(): string | null
```

与 brepjs 的 `registerKernel` 同构（首个注册者为默认），但**两张表、两套 getter**，这是 R2 的直接落地。**注册只发生在宿主启动装配期**——构建时选定的适配器包在初始化时完成注册，之后注册表运行期只读（R8）；不提供运行时的 `unregister` / `setDefault` / 切换 API。

### 6.3 句柄中立化

当前 `ShapeHandle` 直接来自 occt-wasm（`node_modules/occt-wasm/dist/types.d.ts:5` 定义为 `number & { [ShapeHandleBrand]: never }`）。新引擎可能是对象句柄，所以 faijs 必须有自己的不透明类型：

```ts
// src/brep/engine/types.ts

declare const BrepHandleBrand: unique symbol

/**
 * BREP 实体句柄——不透明值。
 *
 * 契约（对应 brepjs 的 KernelShape 约定，brepjs src/kernel/README_cn.md:167-176）：
 * L1 及以上代码**永远不对句柄调用任何方法**，只把它传回产生它的那个引擎。
 * 句柄不得跨引擎传递——跨引擎必须先经 mesh 层（见 §8.3）。
 */
export type BrepHandle = { readonly [BrepHandleBrand]: never }
```

- OCCT 适配器的句柄运行时就是 `number`，加 brand 是**零成本的类型层转换**。
- 替换 33 处 `import type { ShapeHandle } from 'occt-wasm'` → `import type { BrepHandle } from './engine/types'`。
- **`ShapeSlot.solid` / `BrepHolder.solid` 已经是 `unknown`**，从 `unknown` 收紧到 `BrepHandle` 是纯类型增强，无运行时影响。

**句柄不得跨引擎**这条约束，用一个轻量标记落地（而非运行时逐一校验，避免性能损耗与误报）：句柄由引擎自己产生并自己消费；跨引擎只能走 mesh（§8.3 的结构保证）。brepjs 在 `interfaces/core.ts:25-28` 注释里说了要防混用但**未实现任何校验**——本方案不重复这个未兑现的承诺，改用结构保证。

---

## 7. 接口契约

### 7.1 两个面的真实形状与逐项映射结果

**面甲：occt-wasm 提供面**——`OcctKernel` 201 个公开实例方法（TS 声明）/ rust 侧 193 个 `pub fn`；形态是**命令式、句柄化、立即求值**。faijs 生产代码实际用到其中 66 个（§2.3）。

**面乙：Onshape 需求面**——标准库 107 个特征（101 个用户可见，FEATURES_SUMMARY.md）依赖 **151 个 `@` 原生内核入口**（66 `@op` + 44 `@ev` + 18 `@sk` + 23 其它，GEOMETRY_PRIMITIVES.md；另有 ~115 个语言运行时/上下文/调试 `@` 入口，不属几何原语，不在对照范围）。`@op*` 的形态是**声明式特征再生**（`(context, id, definition)`），与 faijs 的命令式执行不同——这是形态差异，不妨碍能力对照。

对 151 项逐项映射（**完整逐项表见附录 A**）后的分类汇总：

| 分类 | 数量 | 占比 | 含义 |
|---|---|---|---|
| **A 直接对应** | 39 | 26% | occt-wasm 有同义方法，适配器纯转发 |
| **B 库层可组合** | 61 | 40% | 无单一内核调用，但可在 faijs 库层用"契约面原语 + JS 算法"组合实现——Onshape 自己就是这么做的（`query.fs` 的 `q*` 全部是纯 FS 实现，不委托内核） |
| **C1 可补暴露缺口** | 9 | 6% | OCCT C++ 有能力、occt-wasm 未暴露（GeomPlate 系填充/边界曲面、直接编辑族）——扩展 binding 可补 |
| **C2 真缺口** | 4 | 3% | 任何候选引擎都没有：曲面缠绕 `@opWrap` + 钣金展平族 3 项 |
| **D 非几何内核职责** | 38 | 25% | 草图求解（18+4）、查询求值（3）、属性/命名/配合/上下文（13）——应切到别的槽位（§7.6） |

三个直接推论：

1. **直接交集只有 26%**。"接口 = OCCT 方法面"会让 40% 的 B 类需求没有落点——除非库层绕过接口直接调引擎方法，而那恰恰让引擎切换失去意义。
2. **需求面的 25% 根本不是几何内核的活**。"接口 = Onshape 原语面"会逼着每个候选引擎去实现草图约束求解器和属性系统——那不叫几何引擎接口，叫 CAD 平台接口。
3. **真正的硬缺口极小（4 项）且高度集中**。钣金展平是独立算法工程，换不换引擎都要单独立项；它阻塞的是 Onshape 17 个钣金特征，不阻塞其余 90 个特征。

### 7.2 为什么"二选一"的两个选项都不成立

用户给的三选：OCCT 面 / Onshape 面 / 折中。前两个被 §7.1 的数据否决：

**选项甲（接口 = occt-wasm API 面）否决理由**：

- 覆盖面只够 A 类 39 项，B 类 61 项无落点。
- 接口被 OCCT 特有物污染：`release`/`checkpoint` 手工内存管理、`makeBoxFromCorners` 便利方法、XCAF 装配文档模型、`*WithHistory` 演进数据——新引擎要么伪造这些 API，要么在适配器里藏语义映射，两种都违背"接口即契约"。

**选项乙（接口 = Onshape 151 `@` 入口面）否决理由**：

- D 类 38 项不是几何内核职责（§7.1 推论 2）。
- `@op*` 的 `(context, id, definition)` 再生范式与 faijs 的命令式执行模型不匹配——faijs 没有、也不应该有 Onshape 的 context/再生机。
- 没有任何候选引擎原生暴露这个面 → 每个引擎都要写 151 项厚适配器，而其中 B/D 类的适配器代码在各引擎间**完全重复**。重复部分恰恰证明：它应该留在 faijs 库层，而不是塞进引擎契约。

### 7.3 折中：形态取甲、覆盖面取乙

**引擎接口 = 命令式几何内核原语契约**：

- **形态看齐 occt-wasm**（命令式、句柄化、立即求值）——faijs 是命令式执行引擎，且所有现实候选（OCCT / Remus / Parasolid / ACIS 系）都是这个形态，适配器最薄。
- **覆盖面看齐 Onshape 需求**——以"151 项逐项有归属、107 个特征全部可在库层实现"为验收标准（R5/R7），而不是以"faijs 现有 demo op 用到的 66 个方法"为限。

151 项的五类去向：

| 分类 | 数量 | 去向 |
|---|---|---|
| A 直接对应 | 39 | 引擎契约面（§7.4）的骨干，适配器纯转发 |
| B 库层可组合 | 61 | **faijs 库层职责**（§7.7），基于契约面 + JS 组合实现；引擎可选原生覆盖加速 |
| C1 可补暴露 | 9 | **可选能力槽**（§7.5），OCCT 适配器扩展 binding 补齐；其他引擎原生有则提供 |
| C2 真缺口 | 4 | 单独立项（钣金展平 + 曲面缠绕），不属于换引擎范畴（§7.6） |
| D 非内核职责 | 38 | 不进引擎接口：SketchSolver 槽 / 查询引擎（JS）/ 属性与上下文（runtime），见 §7.6 |

这仍对应**「默认 + 可覆盖」分层模型**：引擎只实现契约面即可工作；B 类由库层默认实现兜底；引擎在某项上有原生优势时可覆盖加速——声明只是偏离默认时的补丁，不是必填项。

### 7.4 引擎契约面（port 面）

契约面 = **A 类 39 项 + B 类组合实现所依赖的底层查询/构造能力 44 项**（拓扑枚举、曲线/曲面数据读取——没有这些，B 类与查询引擎都无从实现），共 **83 项**，按 14 族分组。标 `?` 的为可空项（引擎缺失 → 依赖它的库层功能静态降级走 mesh，§8.4）；未标的是硬必需。

| 族 | 项数 | 成员 |
|---|---|---|
| 生命周期 | 2 | `release`（GC 型引擎实现为 no-op）、`dispose` |
| 实体图元 | 4 | `makeBox` `makeCylinder` `makeSphere` `makeCone` |
| 造型运算 | 7 | `extrude` `revolve` `sweep` `loft` `thicken` `draft?` `offset?` |
| 布尔与分割 | 6 | `fuse` `cut` `common` `split` `intersect` `fuseAll?` |
| 局部特征 | 4 | `fillet` `chamfer` `shell` `defeature?` |
| 变换 | 6 | `translate` `rotate` `scale` `generalTransform` `copy` `mirror?` |
| 曲线构造 | 8 | `makeLineEdge` `makeArcEdge` `makeBSplineEdge` `interpolatePoints` `makeCircleEdge?` `makeBezierEdge?` `makeHelixWire?` `approximatePoints?` |
| 拓扑构造 | 7 | `makeVertex` `makeWire` `makeFace` `makeCompound` `bsplineSurface?` `sew?` `sewAndSolidify?` |
| 三角化 | 1 | `meshShape`（**BREP→mesh 唯一出口，断链物化依赖，硬必需**） |
| 拓扑查询 | 9 | `getShapeType` `getSubShapes` `subShapeCount` `hashCode` `isSame` `shapeOrientation` `subShapeHashes?` `adjacentFaces?` `sharedEdges?` |
| 几何求值 | 16 | `vertexPosition` `curveType` `curvePointAtParam` `curveTangent` `curveParameters` `curveIsClosed` `curveLength` `surfaceType` `surfaceNormal` `pointOnSurface` `uvBounds` `getNurbsCurveData?` `surfaceCurvature?` `getFaceCylinderData?` `projectPointOnFace?` `projectPointOnEdge?` |
| 测量 | 7 | `getBoundingBox` `getVolume` `getSurfaceArea` `getLength` `getCenterOfMass` `distanceBetween` `getInertia?` |
| 校验与投影 | 2 | `isValid` `projectEdges?` |
| IO | 4 | `importStep` `exportStep` `importStl?` `exportStl?` |

硬必需约 60 项、可空约 23 项（最终划分在 Phase 1 随 OCCT 适配器落地时钉死）。

**与现有 66 个被调方法的衔接**（§2.3，已逐一核对）：**45 个**与契约面一一对应；**11 个**按 §7.5 进可选能力槽（heal 族 5：`unifySameDomain`/`healSolid`/`fixShape`/`fixFaceOrientations`/`removeDegenerateEdges`；evolution 3：`*WithHistory`；assembly 2：`createXCAFDocument`/`importXCAFFromSTEP`；meshLift 1：`buildTriFace`）；**10 个**可由契约面组合实现或留作 OCCT 适配器内部方法——`makeRectangle`（矩形 wire + `makeFace`）、`located`/`transform`（归并 `generalTransform`）、`fromBREP`、`wireframe`、`section`、`isSolid`、`addHolesInFace`、`getSurfaceCenterOfMass`、`makeBoxFromCorners`（`makeBox`+`translate`），Phase 2 迁移时逐项处置。45 + 11 + 10 = 66，无遗漏。

**命名沿用 occt-wasm 现状**——这不是"理想命名"，是"最小迁移成本 + 可演进"的取舍：`packages/core/src/brep/**` 已经是这个调用形状，契约面先行意味着调用方零改动。语义契约中立化（单位 mm、+Z 向上、角度用度，见 `docs/api-contract.md`）。

与 v1 的对照：v1 的契约面只有 ~25 个方法（按现有 demo op 用量反推），**覆盖不了 B 类 61 项的底层依赖**——例如没有 `surfaceCurvature`/`getNurbsCurveData` 就没有曲率求值族，没有 `adjacentFaces` 就没有边凸性判定，没有 `projectEdges` 就没有投影曲线族。本版契约面是按"Onshape 需求面反推"而非"现有用量反推"得出的。

### 7.5 可选能力槽（C1 + 既有 OCCT 特有物）

契约面之外、但 faijs 已有功能或 C1 类需求依赖的能力，按 6 组声明为可选能力。机制沿用 brepjs 的 `?` 可选方法 + `'methodName' in engine` 类型守卫：

| 能力组 | 内容 | 谁依赖 | OCCT | Remus |
|---|---|---|---|---|
| `EvolutionCapability` | 12 个 `*WithHistory` + `getFaceHashes` | faijs 面演化全链（`face-evolution.ts`） | ✅ 有 | ❓ 待确认（Phase 5 前置调研） |
| `HealCapability` | `healSolid` `healFace` `healWire` `unifySameDomain` `fixShape` `fixFaceOrientations` `removeDegenerateEdges` 等 | 混合布尔后的修复、B 类 `@evFaults` 的"修"半边 | ✅ 有 | ❓ |
| `DirectEditCapability`（C1） | `moveFace` `replaceFace` `edgeChange` `extendSheetBody` `derip` | Onshape 直接编辑特征族 | ⚠️ C++ 有、wasm 未暴露，需扩 binding | ❓ |
| `AdvSurfaceCapability`（C1） | `boundarySurface` `fillSurface` `faceBlend` `constrainedSurface` | Onshape 高级曲面特征族 | ⚠️ GeomPlate 系，需扩 binding | ❓ |
| `AssemblyCapability` | XCAF 13 方法（装配文档/颜色/名称/GLTF） | 3d_editor 的 STEP 装配导入 | ✅ 有 | ❓ 大概率无 |
| `MeshLiftCapability` | `buildTriFace` + `sewAndSolidify` → `meshToSolid` | mesh→BREP 提升（`meshesToStep` 路径） | ✅ 有 | ❓ |

**缺失的传导规则不变**：可选能力缺失 → 依赖它的功能静态降级（走 mesh 或报"该引擎不支持"），与 §8.4 的路由整合。绝不允许引擎伪造这些 API。

### 7.6 不进引擎接口的：D 类 38 项与 C2 4 项的归属

| 归属 | 项数 | 内容 | 形态 |
|---|---|---|---|
| **SketchSolver 槽**（独立引擎槽，与 BREP 槽正交） | 22 | `@sk*` 18 + `@newSketch`/`@isSketch`/`@containsSketch`/`@skipOrderDisambiguation` | 2D 约束求解器。Onshape 用 D-Cubed DCM；开源对应物是 PlaneGCS（FreeCAD）或自研。本方案只预留槽位，不展开——草图轮廓在无求解器时仍可用显式坐标定义，求解器是编辑体验层 |
| **查询引擎（faijs JS 实现）** | 3 | `@evaluateQuery` `@evaluateQueryCount` `@isQueryEmpty` | Onshape 先例：`query.fs` 的 `q*` 全部纯 FS 实现。faijs 用 JS 实现，底层只依赖契约面的拓扑查询 + 几何求值族 |
| **属性/命名/配合/上下文（CadRuntime 数据模型）** | 13 | `@opNameEntity`、`@opMateConnector`、`@evMateConnector`×2、`@opCreateCompositePart`/`@opModifyCompositePart`、`@opMergeContexts`、`@evOwnerSketchPlane`、`@getHoleAttributes`、钣金属性查询×2、`@evSheetMetal*ToolBodies`×2 | 特征树/属性系统职责。几何侧需要时（如组合零件→`makeCompound`）走契约面 |
| **C2 单独立项** | 4 | `@opWrap`（曲面缠绕 = 测地映射算法）、`@opSMFlatOperation` + `@sheetMetalApplyInFlat` + `@updateSheetMetalGeometry`（钣金展平族） | 任何引擎下都要自研的算法工程。钣金展平阻塞 Onshape 17 个钣金特征，是"支持所有上层特征"的最大单项障碍，建议作为独立项目评估 |

### 7.7 库层分期（B 类 61 项与 107 特征的支持路线）

库层工程（对齐 Onshape 标准库）不按本方案的 Phase 0–5 走，此处只给依赖分期——每一波的前置是左列能力到位：

| 波次 | 特征规模 | 前置依赖 | 内容 |
|---|---|---|---|
| L1 主干 | ~30 特征 | A 类直通（契约面） | 图元 6、extrude/revolve/sweep/loft/thicken、boolean、fillet/chamfer/draft/shell、mirror/pattern/transform、split、import |
| L2 组合 | ~35 特征 | B 类（契约面 + JS） | 曲线族 16（fitSpline/compositeCurve/bridgingCurve/helix…）、offsetSurface/endcap/enclose、deleteFace/hole/section 族、wrap 之外的曲面投影族 |
| L3 高级曲面 + 直接编辑 | ~10 特征 | C1 能力槽到位 | boundarySurface/fill/constrainedSurface/faceBlend、moveFace/replaceFace 原生版、modifyFillet |
| L4 草图系统 | 1 + 前置解锁 | SketchSolver 槽 | Sketch 特征（约束求解编辑体验）；无求解器时草图用显式坐标，不阻塞 L1–L3 |
| L5 钣金 | 17 特征 | C2 展平算法 | 钣金全族 |

**验收工件**：每一波交付一份「特征 × 支持矩阵」（107 特征逐行标注：已支持/依赖缺失/波次），作为 R5 的滚动验收依据。

### 7.8 编译期完整性守卫（抄 brepjs，优先级最高）

```ts
// src/brep/engine/occt/adapter.ts（每个适配器都写一份）
type _AssertSatisfiesBrepPrimitives = () => BrepPrimitives
const _check: _AssertSatisfiesBrepPrimitives = () => createOcctPrimitives(kernel)
void _check
```

漏实现任何方法 → `tsc` 精确列出缺失属性。契约面从 v1 的 ~25 方法扩到 83 项后，这个守卫从"性价比高"变成**必需品**——没有它，83 项的契约面没有任何引擎能一次实现正确。

---

## 8. 切换语义：构建/打包时切换（R8）

### 8.1 用户定调与本方案的简化

用户原话（§0.2）：**切换只发生在构建/打包时刻，开发者决定，频率极低**。直接推论：

1. **没有运行时切换 API**——不提供 `setBrepEngine` / `withKernel` / `unregisterEngine`；注册表在启动装配完成后只读（§6.2）。
2. **没有执行中切换策略**——v1 的 `strict` / `materialize` / `reset` 三策略（`EngineSwitchPolicy`）整套删除：切换瞬间不存在存活句柄（换引擎必然伴随重新构建与进程重启）。
3. **引擎选择 = 构建期依赖决策 + 启动期一次注册**，不引入任何新概念。

这与 AGENTS.md 红线的关系：红线说的"切换"是链上 **brep→mesh 的单向降级**，本方案说的是**引擎整体替换**。两者不同维度，但共享同一条原则——**切换是声明性的、发生在执行前，不是执行中的动态回退**。R8 把这个原则推到了最强形式：连"执行前"都提前到了"构建时"。

### 8.2 构建时切换的机制

三个层次，全部是构建/启动期行为：

| 层次 | 机制 | 时机 |
|---|---|---|
| **包选择** | 宿主 `package.json` 选择安装哪个适配器包（`@faicad/faijs-engine-occt` / `-remus`）——同时这就是 LGPL 隔离边界（§9.4） | 构建/打包时 |
| **启动注册** | 适配器包在宿主初始化时完成 WASM 加载并 `registerBrepEngine(id, engine)` | 进程启动时 |
| **实例冻结** | `createRuntime({ brep: 'occt', mesh: 'manifold' })` 显式选定（同一构建内多引擎并存时按 id 选）；缺省用首个注册者 | Runtime 构造时，之后不可变 |

**换引擎的完整流程** = 换依赖包 → 改一行 `createRuntime` 参数（或用缺省）→ 全量测试 → 重新打包。这正是"频率极低的开发者决策"应有的形态。

### 8.3 句柄跨引擎问题在构建时切换下不存在

§6.3 的"句柄不得跨引擎"契约保留为静态纪律，但 R8 下它几乎不会被触发：切换伴随进程重建，旧引擎句柄不会与新引擎句柄共存。保留它的价值在于**同一构建内多引擎并存**的场景（例如 OCCT 与 Remus 同时注册、不同 Runtime 各用一个）——此时句柄仍不得跨引擎传递，结构保证同 §6.3。

若未来真的出现运行时切换需求（例如交互式编辑器里让用户换引擎），扩展路径已经存在、且不引入新概念：**切换 = 一次全链断链**，复用 `reconcileBrepInputs` + `part-brep-lost` 物化管线（§4.3）。本方案不实现它，但不堵死它。

### 8.4 与 `dispatchPath` 的整合：能力表驱动的静态路由

**这是本方案对 brepjs 的一处主动改进**（brepjs 的 capabilities 无任何消费方）。

现状（`src/cad-runtime/backend-dispatch.ts:39`）：

```ts
export function dispatchPath(inputs: Shape[], brepImpl: unknown | undefined): BrepPath
```

> ⚠️ **2026-08-30 修订（破坏性变更登记）**：`dispatchPath` 是**公开 SDK API**——`sdk.ts:78` 显式 re-export（注释写明"第三方库作者从 `@faicad/faijs/sdk` 导入"），`mech-lib` 的 `c3-brepjs-scenario.test.ts:33,78` 正在以 `dispatchPath([p0, p1], () => undefined)` 双参形式使用。本节改造为 `dispatchPath(inputs, opName)` 会破坏该公开面，**必须与 Phase 3 的 3d_editor 协调一并处理**：要么保留第二参数做静态能力标记兼容（推荐，mech-lib 零改写），要么把 mech-lib 用例列入锁步更新清单（§12 风险 11 已登记）。

`brepImpl` 是**静态布尔/函数标记**（`boolean.ts:27` 写 `const brepImpl = true`，`primitives.ts:53` 写 `const brepImpl = primitiveToBrepSolid`）——它表达的是"这个 op 有没有 BREP 实现"，但**没有表达"当前引擎是否支持"**。换引擎后这个判断就失效了。

改造后：

```ts
export function dispatchPath(inputs: Shape[], op: BrepOpName): BrepPath
```

内部按 op 名查询**当前引擎**是否为该 op 提供了实现（含库层默认实现所需的可选能力是否齐备，§7.4/§7.5）。三条判定规则**逐字保留**，只把第 2 条的判据从"有没有 brepImpl"改为"当前引擎支不支持该 op"：

1. `mode='mesh'` → mesh
2. `mode='brep'` → 当前引擎不支持该 op 则抛 `BrepUnsupportedError`；输入不全在链也抛
3. `mode='auto'` → 引擎支持且输入全在链 → brep；否则 mesh

**仍然是执行前的静态判定，不违反 AGENTS.md 红线**。且在 R8 下它更强：引擎构建时固定 → 能力表在启动时一次性完全确定 → `dispatchPath` 的判据可以在启动期求值缓存，运行期零开销；未来甚至可以按能力表做构建期 tree-shaking（不在本方案范围）。

---

## 9. LGPL 隔离与打包（R4 落地）

### 9.1 依赖声明改造

```jsonc
// package.json
"dependencies": { /* 移除 occt-wasm */ },
"optionalDependencies": { "occt-wasm": "3.8.4" },
"peerDependencies": { "occt-wasm": "3.8.4" },
"peerDependenciesMeta": { "occt-wasm": { "optional": true } }
```

> ⚠️ **2026-08-30 修订**：① 版本号从初稿的 3.7.0 改为 **3.8.4**——仓库 HEAD `3f79826` 已把 workspace 升到 3.8.4，初稿的 3.7.0 已过时；② peer 范围从初稿的 `>=3.7.0 <4` **收窄为精确版本 `3.8.4`**——两个不同大版本的 occt-wasm 装进同一棵树就是两份 wasm 实例，会戳穿 monorepo-plan §6.2 的单一实例不变量，peer 范围是这条不变量在消费端的最后防线。

**移除 `overrides` 里的 `occt-wasm`**（现状根 `package.json:109-111`）。⚠️ **2026-08-30 修订初稿理由**：初稿写「它会强制传递依赖也用 OCCT，与'可选'矛盾」——**不准确**。npm 的 `overrides` 只在 workspace 根自己的 install 生效，消费端会忽略依赖包里的 overrides，它既不会强制安装、也不会强制任何人用 OCCT。**移除的真实理由**：可选化后它只是仓库内部 pin 的残留，保留会让"未安装状态"在仓库内的语义含混。移除本身低风险（occt-wasm 仍装在根时 overrides 是惰性 pin；未装时对不在依赖树里的包 overrides 无效果）。

#### ⚠️ 对 monorepo-plan §6.2 的修订（决策反转说明，2026-08-30）

本节的依赖改造与 `docs/plans/2026-08-29-monorepo-plan.md` §6.2「OCCT 单一实例」**直接冲突**，此处显式记录反转：

| monorepo-plan §6.2 的决策 | 本方案的修订 | 理由 |
|---|---|---|
| core/stdlib/mech-lib 声明**硬 peer**（不加 `optional`），依据是「faijs 没有替代内核」 | 降为 **optional peer**（`peerDependenciesMeta.optional: true`） | §6.2 的依据是"内核不可替换"，而本方案 R4 的全部意义就是让内核可替换/可省略——**前提变更，决策随之反转**。monorepo-plan §3.9 第 2 条"不抄 brepjs 的 optional peer"同因作废 |
| 根 `overrides: {"occt-wasm": ...}` 双锁保留 | **移除** | 见上：overrides 只影响仓库内部 install，消费端无效；保留与"可选"语义冲突 |
| `npm ls occt-wasm --workspaces` 断言**只出现一个版本**（无条件） | 改为**条件断言**：装了 → 恰好一个版本、无 nested 副本；没装 → 零个 | 可选化后"未安装"是合法状态，无条件断言会误报 |
| §12 O13 验收「3d_editor 装 tarball 后 `npm ls occt-wasm` 单版本 = 3.7.0」 | 更新为 **3.8.4** + 条件化 | 版本号随 workspace 实际 bump |

**反转后单一实例不变量仍然成立，但机制变了**：从"npm 靠硬 peer 强制单份"变为"**单一安装点 + 守卫**"——根 `dependencies`（或宿主自身）保持唯一安装点，npm 对 optional peer 同样解析到 hoist 的那一份。monorepo-plan §6.2 担心的"core 与 stdlib 各自把 occt-wasm 放进 dependencies 导致两份"在可选化下也不会发生，因为安装点只有一个。

**3d_editor 不受影响**（实测 2026-08-30）：硬 peer 时 npm 7+ 会自动补装 peer；转 optional 后 npm 不再自动装——但 3d_editor 的 `package.json` 已在 `dependencies` 与 `devDependencies` 各声明 `occt-wasm: 3.8.4`（`:49,92`），行为不变，且自带精确版本反而消除了 O13 的版本漂移担忧。

> 对 monorepo-plan 的全文追认见该文档**开头追加的「2026-08-30 追加更正说明」**（仅追加，不改原有内容）。

### 9.2 类型解耦（R4 的主要工作量）

> ⚠️ **2026-08-30 修订（实测更正）**：初稿写「33 处 `import type ... from 'occt-wasm'`（生产代码 11 处）」，**两个数字都低估了**。实测（`packages/core/src` + `packages/stdlib/src`，非测试 `.ts`）：

**形态一：`import type ... from 'occt-wasm'` 语句 —— 20 处（17 个文件）**

core（17 处）：`brep/brep-chain.ts:15`、`brep/brep-ops.ts:18`、`brep/brep-topology.ts:14`、`brep/brep-utils.ts:5`、`brep/export/step.ts:13`、`brep/face-evolution.ts:15`、`brep/primitives-brep.ts:24`、`brep/svg/svg-to-solid.ts:26`、`brep/text/text-to-solid.ts:20`、`cad-runtime/runtime.ts:25,36`（2 处）、`cad-runtime/module-executor.ts:18`、`cad-runtime/preview-exec.ts:18`、`node-host/cli.ts:28`、`primitives/brep-primitives.ts:25`、`occt-kernel/occtKernel.ts:8`、`occt-kernel/meshReconstruct.ts:20`。

stdlib（3 处）：`brepjs-mirror/joinery-brep.ts:20`、`brepjs-mirror/threadFns.ts:18`、`engrave.ts:12`。

初稿的 11 个文件清单**漏了 8 个**：`occtKernel.ts:8`、`meshReconstruct.ts:20`、`runtime.ts:25,36`、`module-executor.ts:18`、`preview-exec.ts:18`、`cli.ts:28`、`brep-primitives.ts:25`、`engrave.ts:12`。

**形态二：内联 `import('occt-wasm').X` 类型引用 —— 37 处（非测试 .ts）**

典型形态：`getBackends().kernel.occt as import('occt-wasm').OcctKernel | null`、`brepOf(s) as import('occt-wasm').ShapeHandle | undefined`、`let x: import('occt-wasm').ShapeHandle`——集中在 stdlib（boolean/copy/drill/split/screw/text 等，12 处 `kernel.occt`）+ core 的 brep 各文件。**这种形态不匹配 `from 'occt-wasm'` 的 grep，卸载 occt-wasm 后同样让 typecheck 失败，必须一并替换。**

**替换语义**：上述全部改为 `import type { BrepHandle } from './engine/types'`（句柄）/ `BrepPrimitives`（内核参数，`engine/primitives.ts`）/ `BrepMeshResult`（三角化结果，`engine/types.ts`）。**occt-kernel/ 的 `occtKernel.ts` 与 `meshReconstruct.ts` 保留 `import type from 'occt-wasm'`**——它们是本方案允许的**单一 OCCT 类型耦合区**（Phase 2 转适配器 / §9.4 适配器包化时消除），其跨出该区的导出签名改为中性类型（内部 cast）。

**这一步是 R4 的必要条件**：只要还有一处 `import type from 'occt-wasm'`（含内联形态），未安装该包时 `tsc --noEmit` 就失败。

> ⚠️ **仓库卫生注记（2026-08-30）**：`packages/stdlib/src` 下存在 **69 个被 git 跟踪的编译产物**（`.js` / `.d.ts` / `.js.map`，其中 `joinery-brep.d.ts:18`、`threadFns.d.ts:17` 也含 `import type from 'occt-wasm'`）——目前靠 core/stdlib 两个 tsconfig 的 `skipLibCheck: true` 才不参与 typecheck。与 monorepo「src 只放源码、产物进 dist/」的约定冲突，会污染 grep 验收（A1），**建议在 Phase 0 实施前清理**（`git rm` 这些产物，属独立清理提交）。

### 9.3 构建产物形态

> ⚠️ **2026-08-30 修订（实测更正）**：初稿本表按 monorepo 迁移前的 `src/...` 路径与旧导出面填写，`browser.ts` 一行与实际严重不符。下表按 monorepo 迁移后的 `packages/core/src/` 与 3d_editor 实测消费面重写。

| 入口 | OCCT 值导出（2026-08-30 实测） | 未装 occt-wasm 时 |
|---|---|---|
| `packages/core/src/index.ts` | `:186-206` 整块：`initOcctWasm` / `getKernel` / `disposeOcctWasm` / `setOcctWasmInitFn` / `meshesToStep` / `releaseShape` / `importAssemblyFromStep` 等 + `reconstructSolidFromMesh` / `exportStepFromSolidsHighLevel` / `buildSelectorManifest` 等 | 需改为 re-export 类型 + 惰性取值函数 |
| `packages/core/src/browser.ts` | **远超初稿的"只导出 `setOcctWasmInitFn`"**：`:83` `setOcctWasmInitFn`；`:100` `ensureOcctKernel` / `disposeOcct` / `importStep` / `exportStep` / `exportStepFromSolidsHighLevel` / `releaseSolid`；`:199` `reconstructSolidFromMesh` / `meshToStepBrep` / `meshToAsciiStl` / `cadShapeIsValid`；`:220-231` 一票 brep 助手（`solidToShape` / `translateBrep` / `getSolidBoundingBox` / `exportStepFromSolid(s)` / `buildStlBufferFromMesh` 等） | **不是"已基本安全"，是 3d_editor 最主要的受影响面**，见 §10.2 |
| `packages/core/src/node.ts` | 零 OCCT 导出 | 安全 |
| `packages/core/src/sdk.ts` | 零 heavy 依赖（有守卫测试） | 安全 |

**惰性化的真实理由（修正初稿）**：初稿写「否则打包器会把 `occt-wasm` 静态拉进 bundle」——**不成立**。实测 `occt-kernel/occtKernel.ts:8` 只有 `import type from 'occt-wasm'`，`:89` 的值访问是 `await import('occt-wasm')` 动态导入，**core 里没有任何静态值导入 occt-wasm**，打包层面早已是动态边界。真正要解决的是三件事：

1. **未安装时的 typecheck**——33 处 `import type`（Phase 0，§9.2）；
2. **未安装时的构建期解析失败**——字面量 specifier 的动态导入仍会被打包器静态分析，`occt-wasm` 不在依赖树时 rollup/webpack 直接报 "Could not resolve"。这正是 brepjs 用 `importOptionalBackend(specifier)`（specifier 必须是**变量**，§3.1）规避的场景，适配器包化（§9.4）后自然消失；
3. **未安装时的运行期错误语义**——走注册表抛明确的"引擎未注册"（§8.4 / Phase 3 D3），而非 module-not-found。

具体形态在实施阶段定（见 §11 Phase 3），但 §10.2 的 3d_editor 协调范围**必须按 browser.ts 的真实导出面来定，不是按根入口**。

### 9.4 与 monorepo 计划的关系

`docs/plans/2026-08-29-monorepo-plan.md` 已规划 `packages/core`（引擎）+ `packages/stdlib`。⚠️ **2026-08-30 修订**：monorepo 迁移**已实施**（现状 `occt-kernel/` 位于 `packages/core/src/occt-kernel/`，core 声明 `occt-wasm` 为硬 peer）。本方案 Phase 0–4 **保持 occt-kernel 在 core 内**（§10.1 的改法，OCCT 适配器即 `src/brep/engine/occt/`），下面的适配器包拆分是**最终形态**（第二阶段引擎接入或后续清理时落地），**不是 Phase 0–4 的前置**——⚠️ 2026-08-30 补充：**若 Phase 3 的 D1 保持字面验收（卸载后 build+typecheck+lint 全过），occt-kernel 类型解耦/包化须提前为 D1 前置**（见 Phase 3 D1 注记）。**引擎适配器应作为独立 package**，与 core 解耦：

```
packages/
  core/                    引擎（不含任何具体实现依赖）
  brep-engine-occt/        ← 唯一依赖 occt-wasm 的包（optional peer）
  brep-engine-remus/       ← 未来，唯一依赖 remus-wasm 的包
  stdlib/                 几何库
```

这样"不装 `brep-engine-occt`"在 workspace 层面就是自然的，`occt-wasm` 的 LGPL 产物被关在一个可省略的包里。

---

## 10. 影响面

### 10.1 faijs 内部

| 位置 | 改动 |
|---|---|
| `src/occt-kernel/occtKernel.ts` | 单例类型 `OcctKernel` → `BrepEngine`；`initOcctWasm` 保留为 OCCT 适配器的初始化入口 |
| `src/occt-kernel/occtKernel.ts:425` `meshesToStep` | 加 `engine` 参数（或从注册表取），消除裸抓全局 |
| `src/occt-kernel/topologyExt.ts:572` | 同上 |
| `src/brep/brep-chain.ts:76,124` | `kernel: OcctKernel \| null` → `engine: BrepEngine \| null` |
| `src/brep/primitives-brep.ts:63` | 改为接收注入 |
| `src/brep/brep-ops.ts` 等全部 | `kernel: OcctKernel` → `p: BrepPrimitives` |
| `src/stdlib/*.ts` 13 处 | `as import('occt-wasm').OcctKernel` → `as BrepPrimitives` |
| `src/cad-runtime/ports.ts:182` | **建议**新增 `brepEngine?: BrepEngine` 到 `HostPorts`，与 `csg`/`sdf` 同构（OCCT 目前绕过 Port 体系走 globalThis，这是要修的历史问题） |
| `src/cad-runtime/backend-dispatch.ts:39` | `dispatchPath(inputs, opName)` |
| `package.json` | §9.1 |
| `AGENTS.md:34,37` | 文档已过时（`src/ops/dispatcher.ts` 目录根本不存在），需同步修正 |

### 10.2 3d_editor（跨项目，需协调）

3d_editor 经 `@faicad/faijs` tarball 消费 faijs，直接依赖 `BrepChainState` / `initBrepChainState` / `releaseBrepChainState` / `cadExecuteStatement`，以及 `runtime.brepSolidCache` / `setBrepSolid`。

> ⚠️ **2026-08-30 修订（实测更正）**：初稿引的 `ScriptEngine.ts:1416`（`brepChain.brepActive && result.brepSolid`）**已过时**——当前 1416 行是 `requireMeshOutput(...)`，且初稿"需要同步的只有 `kernel` 字段类型"低估了范围。**2026-08-30 实测的 3d_editor 真实触点**：

**A. 类型层面（Phase 2 的 `BrepChainState.kernel` / `ExecutionResult.brepSolids` 类型变化）**：

| 位置 | 用法 | 影响 |
|---|---|---|
| `ScriptEngine.ts:1091` | `exportSolidCache` 类型写死 `import('occt-wasm').OcctKernel`——3d_editor **自己直接 type-import occt-wasm** | 类型换为 `BrepEngine` 系 |
| `ScriptEngine.ts:1163-1169` | 消费 `result.brepSolids` 的 `{solid, kernel}` 对并写入导出缓存 | 同上 |
| `ScriptEngine.ts:1332-1335` | 把 `brepSolids` 映射进宿主导出缓存 | 同上 |
| `c4-brepjs-gear.test.ts:91` | `entry!.kernel.exportStep(entry!.solid)` 直接调 kernel 方法 | 契约面含 `exportStep`（IO 族，§7.4）则仅类型微调 |
| `script-engine.test.ts:97,1648` | mock `brepChain: { solidCache, kernel: null }`；动态 `getSolidBoundingBox(kernel, solid)` | mock 的 `null` 仍可赋值，仅签名侧 |

**B. 值导出层面（Phase 3 的 browser 入口惰性化）——比初稿认为的更关键**：3d_editor 生产代码全部走 `@faicad/faijs/browser`（其 `contract-entry.test.ts` 禁止根入口），正在用的 OCCT 值：`lib/step-converter/index.ts:2,5`（`ensureOcctKernel` / `disposeOcct` / `importStep` / `exportStep` / `releaseSolid` + `reconstructSolidFromMesh` / `meshToStepBrep` / `meshToAsciiStl` / `cadShapeIsValid`）、`engine/host/index.ts:15`（`setOcctWasmInitFn`）、`engine/exporters/index.ts:696`（动态 `exportStepFromSolidsHighLevel`）。**根入口的 `initOcctWasm` / `getKernel` / `meshesToStep` 在 3d_editor 生产代码里零使用**（只出现在测试与注释）。

**缓解策略（修订）**：

- `initBrepChainState()` / `releaseBrepChainState()` 的函数签名可以保持不变（内部换实现），`BrepChainState.solidCache` 的键与语义不变——此条仍然成立；
- 需要同步的不只是 `kernel` 字段类型，还有 `ExecutionResult.brepSolids` 的条目类型（`runtime.ts:114` 的 `{solid: ShapeHandle; kernel: OcctKernel}`）与 3d_editor 自己的 occt-wasm 类型标注（上表 A）；
- **browser 入口的 OCCT 值导出采用「名字不变 + 内部惰性包装」**（`ensureOcctKernel` / `importStep` / `exportStep` 等原地保留为惰性取值函数，内部 `await import(adapter)`）→ **3d_editor 的 import 语句零改写**，只有上表 A 的类型标注需要跟改；
- 改 faijs 源码后必须 `npm run pack` 重打 tarball，3d_editor 再 `npm install`（既有约定）；按 faijs 的 patch-only 版本规则 bump，3d_editor 同步更新同一轮完成；3d_editor 的 `contract-entry.test.ts` 白名单（`:98-110`）需同步核对。

---

## 11. 分阶段实施与验收标准

> 每个 Phase 独立可验收，通过后才进下一个。**测试类保持提纲式**（分层 + 测点 + 方法），不写完整实现。

### Phase 0 — 类型解耦（R4 的地基，可独立交付）

> ⚠️ **2026-08-30 修订（按实测更正，详见 §9.2）**：替换范围从初稿的"33 处 `import type`"扩为**两种形态全量**（20 处 `import type` 语句 + 37 处内联 `import('occt-wasm')` 类型引用）；`occt-kernel/`（`occtKernel.ts` + `meshReconstruct.ts`）保留 occt-wasm 类型耦合，其跨出该区的导出签名改中性类型。

**内容**：新增 `packages/core/src/brep/engine/types.ts`（`BrepHandle` / `BrepMeshResult` / `BrepCapabilities`）+ `packages/core/src/brep/engine/primitives.ts`（`BrepPrimitives` 内核中立接口，覆盖 §2.3 实测的 66 个被调方法，Phase 1 扩到 §7.4 的 83 项契约面）；替换 core（除 `occt-kernel/`）+ stdlib 全部 20 处 `import type from 'occt-wasm'` 语句与 37 处内联 `import('occt-wasm')` 类型引用为中性类型；`occt-kernel/occtKernel.ts` + `meshReconstruct.ts` 保留 occt-wasm 类型（**单一 OCCT 类型耦合区**），跨出该区的导出签名改为 `BrepHandle` / `BrepPrimitives`（内部 cast）。

**验收**：
- A1：`grep -rn "from 'occt-wasm'\|import('occt-wasm')" packages/core/src packages/stdlib/src`（排除 `*.d.ts` 编译产物）只命中 `occt-kernel/` 目录
- A2：临时移走 `node_modules/occt-wasm` 后，`npm run typecheck` **通过**——⚠️ 2026-08-30 修订语义：`occt-kernel/**` 是允许的 OCCT 类型耦合区，其消除随 Phase 2 转适配器 / §9.4 适配器包化落地；**完整 R4（D1：卸载后 build+typecheck+lint 全过）以 occt-kernel 解耦为前提**，因此 D1 是「Phase 3 + occt-kernel 解耦子任务」的联合验收，不是 Phase 0 单独能达成的
- A3：`npm run lint` 通过；现有含 `initOcctWasm()` 的测试文件全部通过（实测 core+stdlib 18 个 + packages/tests 7 个 = 25 个，⚠️ 2026-08-30 修订：初稿写 28 个）

### Phase 1 — 接口层 + OCCT 适配器（不动任何调用方行为）

**内容**：新增 `src/brep/engine/{types,primitives,capabilities,registry}.ts` + `src/brep/engine/occt/adapter.ts`；契约面 83 项分 14 族落地（§7.4），硬必需/可空划分在本阶段钉死；写编译期守卫。

**验收**：
- B1：OCCT 适配器通过 `_AssertSatisfiesBrepPrimitives` 守卫（83 项契约面无遗漏）
- B2：`registerBrepEngine('occt', createOcctEngine())` 后 `getBrepEngine()` 可用
- B3：**行为等价**——`src/brep/**` 的 parity 测试（BREP vs mesh 一致性）结果与改造前逐字节一致
- B4：ESLint 规则生效：`src/brep/**` 除 `engine/<impl>/` 外禁止 import 具体引擎包

### Phase 2 — 调用方切换

**内容**：`src/brep/**` 与 `src/stdlib/**` 的 13 处改用 `BrepPrimitives`；`BrepChainState.kernel` 改类型；`brep-chain.ts:124` / `primitives-brep.ts:63` 改注入；`meshesToStep` / `buildSelectorManifest` 加引擎参数。

**验收**：
- C1：`grep -rn "OcctKernel" src/brep/ src/stdlib/` 零命中
- C2：全部现有测试通过（含 28 个 OCCT 测试文件 + parity + e2e fixture）
- C3：`part-brep-lost` 事件与断链物化行为不变

### Phase 3 — 双槽位与打包隔离

**内容**：mesh 引擎注册（`src/mesh/engine/manifold/`）；`package.json` 依赖改造（§9.1）；`src/index.ts` 的 OCCT 值导出改惰性。

**验收（R4 的全部）**：
- D1：卸载 `occt-wasm` 后 `npm run build` + `npm run typecheck` + `npm run lint` 全部通过 —— ⚠️ 2026-08-30 修订：**D1 以 occt-kernel 类型解耦为前提**——若 occt-kernel 仍在 core 内保留 occt-wasm 类型导入，D1 无法达成。前置处理二选一：① 把 §9.4 的适配器包化从"最终形态"**提升为 D1 前置**（`packages/brep-engine-occt` 落地后再验收 D1）；② 或 D1 暂时改验收为"除 `occt-kernel/` 外零 occt-wasm 引用 + 纯 mesh 模式执行通过"，完整 R4 待包化后补验收（见 Phase 0 A2 注记）
- D2：卸载后 `mode='mesh'` 完整执行一个代表性脚本成功（纯 mesh 模式可运行）
- D3：卸载后 `mode='brep'` 或 `mode='auto'` 走 BREP 分支时抛出**明确的"引擎未注册"错误**，而非崩溃或静默降级
- D4：装上 `occt-wasm` 后全部测试恢复通过

### Phase 4 — `dispatchPath` 能力路由 + 启动冻结（R8）

**内容**：`dispatchPath(inputs, opName)`；`createRuntime({ brep, mesh })` 实例冻结；注册表启动装配完成后只读。

**验收**：
- E1：构造一个**故意缺失可选能力**的 mock 引擎，验证依赖缺失能力的 op 静态地走 mesh，而不是抛错或崩溃
- E2：注册表冻结——启动装配完成后任何注册/注销尝试抛错（或被类型系统拒绝）；运行时 API 表面 grep 不到任何切换入口（R8 的直接验证）
- E3：只换 mesh 引擎时，BREP 链行为完全不变（R2 的直接验证）

### Phase 5 — 第二个 BREP 引擎（验证 R1/R3 真的成立）

**内容**：接入一个真实替代引擎（Remus 为首选候选，见 §5.2）。

**验收**：
- F1：新引擎 = 新增一个包 + 一次 `registerBrepEngine` 调用，`src/brep/**` 零改动
- F2：至少跑通 primitives + boolean + transform + STEP 导出
- F3：引擎缺失的能力被正确识别并降级到 mesh，有明确的事件/日志

> **Phase 5 的前置**：Remus 需确认 ① 是否发布 npm 包；② face-evolution API 是否暴露；③ wedge/fillet 支持度。这三条未确认前，Phase 0–4 仍可独立推进——**它们本身不依赖任何第二个引擎存在**。

---

## 12. 风险与未决问题

| # | 风险 / 未决 | 说明与应对 |
|---|---|---|
| 1 | **Remus 尚未确认发布 npm** | 目前只确认 `crates/wasm/pkg`（v2.130.0）与 brepjs 以 git path 消费。Phase 0–4 不依赖它；若 Phase 5 前仍未发布，可用 git dependency 或 vendor 方式接入 |
| 2 | **Remus 的面演化 API 未知** | faijs 的 `face-evolution.ts` 全链依赖 `*WithHistory`。若 Remus 不提供，面演化在该引擎下不可用 → 必须能静态降级（§8.3 正是为此设计）。**需在 Phase 5 前置调研** |
| 3 | **348 处 `release` 的手工内存管理** | GC 型引擎实现为 no-op 即可，无功能风险；但**语义上** faijs 代码仍假设"用完要释放"。这是既有约束，不在本方案改变 |
| 4 | **`makeBoxFromCorners` 生产代码 5 次调用**（⚠️ 2026-08-30 修订：初稿写 4；v1 误写 51，那次统计把测试文件算进去了，实测生产 5 处 / 测试 47 处） | OCCT 特有，Remus 未必有。调用次数少 → 适配成本极低：OCCT 适配器内部用 `makeBox` + `translate` 组合即可，无需进契约面 |
| 5 | **XCAF 装配导入无替代** | `createXCAFDocument` / `importXCAFFromSTEP` 是 OCCT 独有。降为 `AssemblyCapability`，缺失时装配走 mesh 路径。**3d_editor 的 STEP 装配功能会受影响，需提前确认影响面** |
| 6 | **Phase 3 的值导出惰性化是破坏性变更（破坏面已实测收敛，见 §9.3/§10.2）** | ⚠️ 2026-08-30 修订：初稿写的根入口 `initOcctWasm` / `getKernel` / `meshesToStep` 值导出**对 3d_editor 生产代码零影响**——其 `contract-entry.test.ts` 禁止根入口，这三个符号只出现在 3d_editor 的测试与注释。**真实破坏面**：① `@faicad/faijs/browser` 的 OCCT 值导出（`ensureOcctKernel` / `importStep` / `exportStep` / `exportStepFromSolidsHighLevel` / `reconstructSolidFromMesh` / `meshToStepBrep` 等，3d_editor 的 step-converter / exporters / host 在用）；② `BrepChainState.kernel` 与 `ExecutionResult.brepSolids` 类型（ScriptEngine.ts:1091,1163-1169,1332-1335）。**缓解**：名字不变 + 惰性包装 → 3d_editor 的 import 零改写；patch bump + tarball 锁步发布；**仍需在 Phase 3 前与 3d_editor 协调**（按 §10.2 的触点清单） |
| 7 | **brepkit 刚转 AGPL** | 说明"permissive B-rep 内核"这个生态位**不稳定**。本方案的价值恰恰在此：不押注任何单一引擎。§5.2 表格应作为活档案持续维护 |
| 8 | **运行时切换被明确放弃（R8）** | 用户定调切换只发生在构建/打包时。若未来出现运行时切换需求，扩展路径是全链断链物化（§8.3 末段）；同一构建内多 Runtime 各用不同引擎在现状设计下已支持（实例级冻结 + 双槽位注册表） |
| 9 | **C2 真缺口阻塞钣金全族** | 钣金展平（`@opSMFlatOperation` 族 3 项）任何候选引擎都没有，且阻塞 Onshape 17 个钣金特征——这是 R5"支持所有上层特征"的最大单项障碍。建议作为**独立算法项目**评估（自研展平/缠绕算法），与换引擎解耦（§7.6） |
| 10 | **契约面 83 项对新引擎是硬门槛** | 硬必需约 60 项。Remus 当前成熟度（§5.2）距离覆盖契约面有明确差距（缺 fillet/chamfer 确认、拓扑查询形态未知）。Phase 5 前必须做契约面 × Remus 能力对照，差距大的话 Phase 5 拆分进行 |
| 11 | **`dispatchPath` 签名改造是 sdk 公开面破坏性变更（⚠️ 2026-08-30 新增）** | `sdk.ts:78` 公开 re-export `dispatchPath`，mech-lib `c3-brepjs-scenario.test.ts:33,78` 在用双参形式。§8.4 的 `dispatchPath(inputs, opName)` 改造需**保留第二参数兼容**（推荐）或把 mech-lib 用例列入锁步更新，与 Phase 3 的 3d_editor 协调一起做 |

---

## 附录 A：Onshape 151 入口 × occt-wasm 逐项映射（R7 交付物）

> 分类码：**A** = occt-wasm 直接对应（适配器纯转发）；**B** = faijs 库层可组合实现（契约面原语 + JS）；**C1** = OCCT C++ 有、occt-wasm 未暴露（可补）；**C2** = 真缺口（任何候选引擎都没有）；**D** = 非几何内核职责（切到别的槽位，§7.6）。
> 入口清单来源：`onshape-std-library-mirror/docs/GEOMETRY_PRIMITIVES.md`；occt-wasm 方法面来源：`node_modules/occt-wasm/dist/index.d.ts`（201 个实例方法，已逐一回查）。
> ⚠️ 该镜像文档 `OCCT_WASM_VS_ONSHAPE_API.md` 有两处与 occt-wasm 不符：`revolveVec` 与 `solidFromShell` **不存在**（真实方法为 `revolve`、`buildSolidFromFaces`/`makeSolid`）；本附录已按实测修正（初稿按 3.7.0 实测，⚠️ 2026-08-30 修订：workspace 已 bump 到 3.8.4，Phase 0 落地时需按 3.8.4 复核方法面）。

### A.1 `@op*`（66 项）

**实体/曲面创建（22）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@opExtrude` | A | `extrude` |
| `@opRevolve` | A | `revolve` |
| `@opSweep` | A | `sweep` / `pipe` |
| `@opLoft` | A | `loft` / `loftWithVertices` |
| `@opBoundarySurface` | C1 | OCCT GeomPlate/Plate 系，occt-wasm 未暴露 |
| `@opRuledSurface` | B | 直纹面 = 两轨线性 loft |
| `@opFillSurface` | C1 | GeomPlate 填充，未暴露 |
| `@opThicken` | A | `thicken` |
| `@opSphere` | A | `makeSphere` |
| `@opPoint` | B | 基准点 = JS datum（或 `makeVertex`） |
| `@opPolyline` | B | `makeLineEdge` + `makeWire` |
| `@opPlane` | B | 基准面 = JS datum（需面片时 `makeFace`） |
| `@opCreateBSplineCurve` | A | `makeBSplineEdge` |
| `@opCreateBSplineSurface` | A | `bsplineSurface` |
| `@opCreateCurvesOnFace` | B | `projectEdges` |
| `@opCreateIsocline` | B | `surfaceNormal` 采样 + 拟合（精度降级） |
| `@opCreateOutline` | B | `projectEdges` / `wireframe` + 轮廓整理 |
| `@opExtractSurface` | B | `getSubShapes` + `copy` |
| `@opExtractWires` | B | `getSubShapes` + `copy` |
| `@opDropCurve` | A | `projectEdges` / `projectPointOnFace` |
| `@opSplineThroughEdges` | B | 边采样 + `interpolatePoints` |
| `@opTessellatedLoft` | B | 折线截面 loft（`loftWithVertices`） |

**布尔与组合（5）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@opBoolean` | A | `fuse` / `cut` / `common` |
| `@opBooleanedPattern` | B | 阵列变换 + 布尔组合 |
| `@opCreateCompositePart` | D | 组合零件 = 属性/分组数据模型（几何侧 `makeCompound`） |
| `@opModifyCompositePart` | D | 同上 |
| `@opMergeContexts` | D | 上下文合并 = runtime 职责 |

**圆角/倒角/拔模/抽壳/混合（11）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@opFillet` | A | `fillet` / `filletVariable` / `filletBatch` |
| `@opFullRoundFillet` | B | 由相对面距计算半径后 `fillet` |
| `@opModifyFillet` | B | `defeature` + 重新 `fillet` |
| `@opChamfer` | A | `chamfer` / `chamferDistAngle` |
| `@opDraft` | A | `draft` |
| `@opBodyDraft` | A | `draft`（中性面） |
| `@opShell` | A | `shell` |
| `@opFaceBlend` | C1 | 面面混合（BRepFilletAPI 系未暴露） |
| `@opConstrainedSurface` | C1 | 约束曲面拟合（GeomPlate 近似，未暴露） |
| `@opEnclose` | A | `sewAndSolidify` / `buildSolidFromFaces` |
| `@opWrap` | C2 | 测地缠绕，OCCT 无对应算法 |

**面/边编辑（23）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@opMoveFace` | C1 | 直接造型（BRepOffsetAPI 系未暴露） |
| `@opReplaceFace` | C1 | ReShape + 愈合（未暴露） |
| `@opOffsetFace` | A | `offset` |
| `@opDeleteFace` | A | `defeature` |
| `@opDeleteBodies` | B | 从上下文移除 = 数组/runtime 操作 |
| `@opSplitFace` | B | `split` + 面提取 |
| `@opSplitPart` | A | `split` |
| `@opSplitEdges` | B | `curveSplit` + 重构 |
| `@opSplitByIsocline` | B | isocline（B）+ splitFace |
| `@opSplitBySelfShadow` | B | 法向分类（采样）+ splitFace |
| `@opIntersectFaces` | A | `intersect` |
| `@opEdgeChange` | C1 | 边替换 + 愈合（未暴露） |
| `@opEditCurve` | B | `getNurbsCurveData` + `makeBSplineEdge` + 替换 |
| `@opMoveCurveBoundary` | B | `curveParameters` / `curveSplit` + 重构 |
| `@opDerip` | C1 | 钣金去卷边愈合（未暴露） |
| `@opFlipOrientation` | B | `shapeOrientation` + 反向 `copy` |
| `@opOffsetCurveOnFace` | B | 采样 + `projectPointOnFace` + 拟合 |
| `@opOffsetWire` | A | `offset` |
| `@opExtendSheetBody` | C1 | 延伸钣金体（BRepFill 系未暴露） |
| `@opFitSpline` | A | `interpolatePoints` / `approximatePoints` |
| `@opHelix` | A | `makeHelixWire` |
| `@opHole` | B | 孔几何 = `makeCylinder`+`cut`+定位；孔属性部分归 D |

**阵列/变换（2）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@opPattern` | B | 线性/圆周有 `linearPattern`/`circularPattern`（A 级）；曲线阵列 = JS 变换 + `copy` |
| `@opTransform` | A | `translate` / `rotate` / `scale` / `generalTransform` |

**钣金/导入/命名/连接器（4）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@opSMFlatOperation` | C2 | 钣金展平算法，OCCT 无 |
| `@opImportForeign` | A | `importStep` / `importStl` |
| `@opNameEntity` | D | 命名实体 = 属性系统 |
| `@opMateConnector` | D | 配合连接器 = datum + 属性 |

小计：A=25，B=25，C1=9，C2=2，D=5。

### A.2 `@ev*`（44 项）

**点/线/面/体基础（8）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@evVertexPoint` | A | `vertexPosition` |
| `@evEdgeTangentLines` | A | `curveTangent` |
| `@evLine` | B | `curveType` + 参数读取 |
| `@evPlane` | B | `surfaceType` + `pointOnSurface` / `surfaceNormal` |
| `@evAxis` | B | `getFaceCylinderData` 轴 |
| `@evBox` | A | `getBoundingBox` |
| `@evArea` | A | `getSurfaceArea` |
| `@evVolume` | A | `getVolume` |

**边相关（7）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@evEdgeCurvatures` | B | `getNurbsCurveData` + JS 微分 |
| `@evEdgeCurvatureDerivatives` | B | 同上 |
| `@evEdgeConvexity` | B | `adjacentFaces` + `surfaceNormal` 判定 |
| `@evPlanarEdge` | B | `curveType` / 平面性判定 |
| `@evPlanarEdges` | B | 同上批量 |
| `@evCornerType` | B | 两侧 `curveTangent` 连续性判定 |
| `@evFilletRadius` | B | `surfaceType`==cylinder + `getFaceCylinderData` |

**面相关（9）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@evFaceCurvatures` | A | `surfaceCurvature` |
| `@evFaceCurvatureDerivatives` | B | 采样 + 差分 |
| `@evFacePeriodicity` | B | `surfaceType` + `uvBounds` |
| `@evFaceTangentPlanes` | A | `surfaceNormal` / `pointOnSurface` |
| `@evFaceTangentPlanesAtEdge` | B | 边上取点 + 切平面 |
| `@evOwnerSketchPlane` | D | 草图归属 = 特征/属性系统 |
| `@evSurfaceDefinition` | B | `surfaceType` + 各型参数读取组合 |
| `@evOffsetDetection` | B | 采样点距判定两面偏置关系 |
| `@evFaults` | B | `isValid` + 愈合诊断（精度降级） |

**曲线/样条/曲面近似（6）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@evCurveDefinition` | A | `curveType` / `getNurbsCurveData` |
| `@evApproximateBSplineCurve` | A | `approximatePoints` |
| `@evApproximateBSplineSurface` | B | 网格采样 + `bsplineSurface` 拟合 |
| `@evRuledSurfaceBases` | B | 直纹面基线提取（曲面查询组合） |
| `@evMeshPoints` | A | `meshShape` 读三角化 |
| `@evTessellatedLoftMatches` | B | 匹配逻辑 JS（配合折线 loft） |

**距离/碰撞/射线/偏差（6）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@evDistance` | A | `distanceBetween` |
| `@evLength` | A | `getLength` / `curveLength` |
| `@evCollisionDetection` | B | `common` + 体积判定 / 三角化碰撞（性能注记） |
| `@evRaycast` | B | 走三角化射线（精度降级） |
| `@evMaxPathDeviation` | B | 采样 + `distanceBetween` |
| `@evPointsDeviation` | B | 采样 + `projectPointOnFace` |

**质量/质心/配合（6）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@evApproximateCentroid` | A | `getCenterOfMass` |
| `@evApproximateMassProperties` | A | `getVolume` / `getInertia` / `getCenterOfMass` |
| `@evMateConnector` | D | 配合 = 属性系统 |
| `@evMateConnectorCoordSystem` | D | 同上 |
| `@evMaxTolerance` | B | 容差读取（未暴露，用建模容差近似） |
| `@evTolerances` | B | 同上 |

**钣金工具体（2）**

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@evSheetMetalHoleToolBodies` | D | 钣金属性数据 |
| `@evSheetMetalFormToolBodies` | D | 同上 |

小计：A=14，B=25，D=5。

### A.3 `@sk*`（18 项）——全部 D（SketchSolver 槽）

| 入口 | 分类 | 去向 |
|---|---|---|
| `@skLineSegment` `@skArc` `@skCircle` `@skEllipse` `@skEllipticalArc` `@skConicSegment` `@skBezier` | D | 草图 2D 实体 = SketchSolver 槽 |
| `@skSpline` `@skSplineSegment` `@skInterpolatedSpline` `@skInterpolatedSplineSegment` `@skFitSpline` | D | 同上 |
| `@skPoint` `@skText` `@skImage` | D | 同上 |
| `@skConstraint` `@skSetInitialGuess` `@skSolve` | D | 约束求解器本体（Onshape 用 D-Cubed DCM；开源对应 PlaneGCS/自研） |

### A.4 其它几何/查询相关（23 项）

| 入口 | 分类 | occt-wasm 对应 / 去向 |
|---|---|---|
| `@newSketch` `@isSketch` `@containsSketch` `@skipOrderDisambiguation` | D | 草图上下文 = SketchSolver 槽 / runtime |
| `@computeLinearPatternTransforms` `@computeCircularPatternTransforms` `@computeCurvePatternTransforms` `@getFullPatternTransform` `@getRemainderPatternTransform` `@alignCanonically` | B | 纯 JS 矩阵/插值计算，无引擎依赖 |
| `@clusterPoints` `@clusterBodies` `@constructPaths` `@approximateSpline` | B | JS 算法（`constructPaths` 依赖契约面拓扑邻接查询） |
| `@evaluateQuery` `@evaluateQueryCount` `@isQueryEmpty` | D | 查询引擎 = faijs JS 实现（对齐 `query.fs` 纯 FS 先例） |
| `@evaluateSpline` | B | `curvePointAtParam` |
| `@sheetMetalApplyInFlat` `@updateSheetMetalGeometry` | C2 | 依赖 `@opSMFlatOperation` 展平算法 |
| `@isInSheetMetalFeature` `@queryContainsFlattenedSheetMetal` | D | 钣金属性查询 = 属性系统 |
| `@getHoleAttributes` | D | 孔属性 = 属性系统 |

### A.5 汇总校验

| 分类 | @op(66) | @ev(44) | @sk(18) | 其它(23) | 合计 | 占比 |
|---|---|---|---|---|---|---|
| A 直接对应 | 25 | 14 | 0 | 0 | **39** | 26% |
| B 库层可组合 | 25 | 25 | 0 | 11 | **61** | 40% |
| C1 可补暴露 | 9 | 0 | 0 | 0 | **9** | 6% |
| C2 真缺口 | 2 | 0 | 0 | 2 | **4** | 3% |
| D 非内核职责 | 5 | 5 | 18 | 10 | **38** | 25% |
| 合计 | 66 | 44 | 18 | 23 | **151** | 100% |

---

## 附：本方案的核心判断（供复核）

1. **双槽位（§4.2）是本方案与 brepjs 最本质的差异**，直接来自用户指出的"mesh 引擎与 brep 引擎要能单独切换"。它不是把 brepjs 的单槽位复制过来。
2. **不需要 op-graph 重放（§4.3）** 是 faijs 的结构性优势，因为 `Shape` 是公共货币、断链必经 mesh。这让 faijs 的引擎切换成本远低于 brepjs。
3. **主要工作量在"隔离"而非"抽象"（§9.2）**：`src/brep/**` 的 kernel-first 形态已经是良好的抽象边界，真正的硬骨头是 33 处 `import type` 解耦与依赖声明改造——而这一步恰恰是 R4（私有打包）的必要条件。
4. **接口切层的答案来自数据而非偏好（§7.1–§7.3）**：151 项逐项映射显示直接交集只有 26%，两种"二选一"都被否决；折中 = 形态取 OCCT 命令式、覆盖面取 Onshape 需求、D 类切出引擎契约。逐项证据在附录 A。
5. **构建时切换（R8）是最大的简化来源**：删掉运行时切换 API、执行中切换策略、切换瞬间的对象迁移三整块设计；brepjs 的运行时切换机制整条不抄。
