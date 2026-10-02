# 方案：core 直连几何引擎，去除 brepjs 中转层（可交接执行版）

状态：方案（待用户确认后实施）

> 现状事实以 2026-09-25 源码实测为准（复核命令随条给出）。
> 本方案取代 `docs/plans/2026-09-24-brepjs-extraction-plan.md` 的依赖方向裁定。
> 本方案面向第三方执行者编写：目标、边界、逐 Phase 操作、验收判据、守卫均
> 自包含；执行前须通读 `AGENTS.md` 与 `docs/api-contract.md`。

## 0. 用户原话（需求原始记录，逐字）

> BREPS这个裤独立出去了，怎么可能让扣还要依赖于他呢？这明显是错误的呀，你首先要解决的是这个问题。

> 你去看当初的设计文档是怎么写的怎么把B2EP PS玻璃的玻璃的含义就是不能让迫依赖他，这样还在依赖他，这怎么能叫叫玻璃呢？那证明当初的设计文档就是错的呀，你给我全部清楚协议，一份新的方案彻底，我们不他该依赖于一批独立的第三代买进来，仅仅是为了能够未来兼容其他的能够兼容他的AP，而我的核心绝对不能依赖于他。

> 你大概没有理解这个问题靠靠把的含义就是是用来做3D建模的API，那么几何内核OCTOP些当然应该属于他的，否则别人拿这个把怎怎么睫毛而拍下面的那些纸包他他只是一个扩展，如说是BRE PS扩展的carry的扩展FED的扩展，这是第三方扩展的兼容App

> 我需要的是目前的API，目前faijs的功能应该不受影响，但是把BREPPS玻璃出去啊，这样做的工作量有多大需要复制的BREEP JS的代有多少？

> 所有的O P所有的功能都必须是核心包自己实现扩展的纸包是提供额外的功能，怎么可能是提供核心包功能一个替代实实现这理完全错误扩展保持提供错一提层A批呀，一层语法堂

> Compat oP是个个什么东西？

> 你这次理解正确就是是要把金BRE PS中卷的这一层这一层操作对称操作 P去掉应应该是我们自己的项目直连几何引起来实现这些操作请把方案写清楚整个个规划清楚能够交给第三方执行

> 在方案里写明，这次迁移完成以后，不需要有那个bre pjs的子包了。

> 需要保证你API的兼容性，所以这两个路径大概都要支持,你选择一个最合适的方案

（注：以上为语音转写原文，含同音错字。方案作者澄清后的语义，按时间演进：

1. brepjs 独立出去了，core 还依赖它，这是错的；当初「剥离」的含义就是 core
   不依赖它，09-24 方案写反了，作废。
2. **core 就是 3D 建模 API 本体**：几何内核（OCCT 等）天然属于 core；
   brepjs/cq/fcstd 是扩展（第三方兼容包）。
3. **core 的全部 op、全部功能由 core 自己实现**，扩展包只提供额外功能
   （增强 API、语法糖），绝不提供 core 功能的替代实现。
4. 具体手法（本方案的核心）：**把「compat op」这层从 brepjs 借来的中转去掉，
   faijs 自己的项目直连几何引擎（occt-wasm 原生能力）实现这些操作。**
5. 本方案要写得足够完整，可以交给第三方执行。
6. **终态不保留 brepjs 子包**：迁移完成后删除 `packages/brepjs`
   （`@faicad/faijs-brepjs`），monorepo 内不再有它（落地为裁决 9）。
7. **装配求解的两条路径都要支持**（API 兼容性要求）：chain 与 global 都是既有
   公开面（`SolveOptions.solver`），不能只留一条 → chain 由 core 自有化实现，
   两条同处 core（落地为裁决 10）。

若与用户本意有偏差，以用户原话为准。）

## 0.1 用户裁决（既定前提，执行者不得更改）

1. core 是 3D 建模 API 本体，几何内核属于 core。
2. core 对 `@faicad/faijs-brepjs` **依赖归零**：package.json 不声明、源码
   零 import（含 `import type`）。
3. core 的**全部 op 由 core 自己实现**——直连几何引擎（occt-wasm），不经过
   brepjs 中转。扩展包只提供额外功能（monorepo 内实例：`faijs-extra`、
   `sheetmetal`、`cq-compat` 等，属增强 API 与语法糖），不承载 core 功能的
   任何实现。**brepjs 兼容层不由本 monorepo 提供**——它属仓库外独立 brepjs
   项目的范畴（裁决 9）。
4. 装配求解**两条路径都留在 core**：core 自有的 global-solver 与新自有化的
   chain 求解器同处 core（裁决 10）。原「chain 路径随扩展包走」的裁定已随
   裁决 9 删除 `packages/brepjs` 而作废——chain 改由 core 自己实现（§5.6），
   不 import vendored。
5. 现有 API/功能不受影响：`.fai.js` 面、`cad.*` 面、mesh 链行为不变；
   BREP 链几何行为以现有测试为回归基线。
6. **sheetmetal 直接改写为依赖 core API**（用户裁决）：不采用「sheetmetal
   改依赖 brepjs 扩展包」的过渡方案——彻底斩断 brepjs 依赖链。改写完成后
   monorepo 内 brepjs 消费方按 §2.5 实测为 sheetmetal + tests + demo +
   cq-compat + 守卫脚本，须一并收口（§5.9）。
7. 09-24 方案「core 依赖新包」的裁定作废；其可复用的实测数据仍有效。
8. **core 只保留一份内核契约**（由裁决 3 推出）：自有化后 core 的内核接口
   仍是既有 `BrepEngineApi`；不得再引入第二套内核接口（vendored 的
   211 方法 `KernelAdapter` 属 brepjs 侧内部物——仓库外项目内部，或
   `packages/brepjs` 迁移期副本内，均不收编进 core）。
9. **迁移完成后 monorepo 内不再有 brepjs 子包**（用户裁决，2026-09-25，
   本节最高优先级）：**`packages/brepjs`（`@faicad/faijs-brepjs`）在本方案
   完成后整体删除**，不留「降级保留 / 可选发布 / 保留兼容层」任何分支。
   brepjs 的独立性由**仓库外的独立 brepjs 项目**承担；本 monorepo 不再产出
   brepjs 兼容层包。由此：所有原判「迁入 brepjs 包」的处置（tests 的
   vendored 面套件、codegen 提取器、`generated/brepjs` 面）**一律改为删除**，
   见 §2.6 / §5.5 / §5.6 / §5.9。**唯一例外是装配 chain 求解器：它不删除，
   改为 core 自有化**（裁决 10——两条求解路径都是既有 API 面，须都保留）。
   迁移期间该包**仅作为语义参考源与测试对象**存在（§5.3/§5.4 的参考窗口），
   因此**自有化必须在该包删除之前全部完成**（Phase 顺序约束，见 §6）。
   实测前提（删除对外零影响的依据）：该包在 npm registry 上**从未发布**
   （查证 `registry.npmjs.org/@faicad%2Ffaijs-brepjs` → `{"error":"Not found"}`）；
   `cdn/versions.json` 的 `0.16.2` 与 `cdn/importmap.json` 的 jsdelivr 条目是
   **未生效的死登记**，§5.9 一并清除。
10. **装配求解器：两条路径都保留，chain 改由 core 自有实现**（用户裁决，
    2026-09-25）：`SolveOptions.solver` 的 `'chain' | 'global'` 联合类型是既有
    API 面，为保 API 兼容**两者都必须可用**。结合裁决 9（终态无 brepjs 子包），
    chain 的落点只剩**自有化进 core**——§0.2 原三候选中的 (b)「只留 global」与
    (c)「留 core 降级」均不满足「两条都支持」，**明确不采用**。由此确定：
    - **默认值一字不改**：`solve.ts` 第 68 行的 `opts.solver === 'global'`
      判断与「缺省走 chain」的行为保持不变——**默认仍是 chain，零行为变更**
      （原 §0.2 裁决 1「默认求解风格」随之关闭，不再是待裁决项）。
    - `SolverStyle` / `SolveOptions` 的**形状不变**（两者本就定义在 core：
      `api/assembly/solvers/types.ts`，不在 vendored 侧）。
    - chain 的实现**语义以 vendored `kernel/solverAdapter.ts` 现行为为基线**
      （解析解公式、拓扑轮次调度、`(unanchored)` 判定、DOF 表），属
      **移植 + 改线，不是重新设计**；自有化后既有 chain 测试全部保留，
      仅改断言的实现来源。

## 0.2 待用户裁决项（执行者必须停下来问，不得自行选定）

以下三点现有源码给出的是**事实缺口**，不是执行者可以自行决定的设计；Phase 0
出证据后交用户裁决，裁决前不得动对应代码：

（原第 1 项「默认求解风格」与原第 5 项「chain 路径落点」已由**裁决 10 关闭**：
两条路径都保留、默认 chain 不变、chain 自有化进 core —— 均不再待裁决。）

1. **`@faicad/faijs/api/*` 的公开面边界**：若干 `api/generated/*` 分片在仓库内
   零引用，但经 `./api/*` 通配导出在包外可达（见 §2.7）。要「直接删除」还是
   「保留空壳」，属公开面收缩，需用户裁定。**同项一并覆盖** `api/index.ts` 的
   `brepjsCompat` 命名空间与平铺组合器（§5.5 第 3 条）——裁决 9 后无扩展包
   可接收它们。
2. **sheetmetal 改写的落点**：sheetmetal 需要 9 个 core 当前**没有**的出口
   （见 §5.8）。需用户裁定「补进 core 公开面」的具体面（公开导出 / 仅内部
   可达）。原第二分支「sheetmetal 保留对扩展包的依赖」**已随裁决 9 失效**
   ——`packages/brepjs` 将被删除，sheetmetal 不可能再依赖它。
3. **cq-compat 的借入面归属**：`cq-compat` 有 9 处 import
   `@faicad/faijs/api/internal/l3-bridge` 的 `borrowBrepjsShape` /
   `adoptBrepjsProduct`（含主源 `workplane.ts`）。core 内部 op 自有化 ≠ 删除
   这个对外借入面。归属（core 保留 / cq-compat 改写）需用户裁定。
   「迁扩展包」这一分支**已随裁决 9 失效**（无扩展包可迁）。

另有一条**技术方式**取舍，Phase 0 须给证据、由用户拍板，默认仍按本方案
（逐 op 重写）：

- 逐 op 重写（本方案 §5.4）vs **把 vendored 的 op 编排层（`topology/*Fns`、
  `operations/*Fns`）整片移植进 core 并把 `getKernel()` 指向 core 引擎**。
  Phase 0 必须给出两条路径的**闭包规模实测**（移植路径会牵出 shapeRef /
  metadata / disposal / wrapper 等多大一片）与语义风险对比，作为裁决依据。

## 1. 背景与触发事件

- 09-24 方案把 vendored brepjs 树物理迁出为 `packages/brepjs`
  （`packages/brepjs/src` 实测 262 文件 / 1.57MB），但 core 的 38 个文件改成
  `import '@faicad/faijs-brepjs/...'`——依赖一条没少。
- 3d_editor 小程序端消费 faijs tgz 时 `npm install` 404：core `0.16.3` 声明了
  `@faicad/faijs-brepjs: ^0.16.0`，而该包只存在于 workspace 内（`0.16.2`），
  包外不可解析。monorepo 内 workspace 解析兜住，经 npm 消费立即断图。
- 根因：faijs 的 BREP 建模能力是经 compat op 机制从 vendored brepjs「投影」
  来的——**op 的编排逻辑（内核调用顺序、公差、命名/角色表、Result 映射、
  keep/history）住在 vendored 函数里**，core 只是包了一层借入/收养适配。按
  裁决 3，这层中转必须去掉，core 直连几何引擎。
- **`packages/brepjs` 是中间态，不是终点**（裁决 9）：09-24 方案把 vendored
  树物理迁出为 `packages/brepjs`，只做到「core 源码里不再有 vendored 实现」，
  core 仍经包名 `@faicad/faijs-brepjs` 依赖它——依赖一条没少。本方案完成后
  该子包**整体删除**，monorepo 内不再有 brepjs 子包；迁移期间它仅作为语义
  参考源与测试对象存在（§5.3/§5.4）。

## 2. 现状依赖全景（实测 2026-09-25，复核命令随条）

### 2.1 总量（core）

```bash
grep -rn '@faicad/faijs-brepjs' packages/core/src | wc -l   # 840 行（去重后按文件计）
# 非测试 33 文件 / 833 处；测试 5 文件 / 7 处；合计 38 文件 / 840 处
grep -rl '@faicad/faijs-brepjs' packages/core/src           # 38 文件
```

测试侧 5 个文件：`api/assembly/{pose,preview,solve}.test.ts`、
`api/assembly/solvers/global-solver.test.ts`、`brep/engine/measurement-parity.test.ts`。

### 2.2 core 内依赖分类（执行者按此逐类处置）

| 类 | 文件 | 引用数 | 内容 | 处置（见 §5） |
|---|---|---|---|---|
| A | `api/generated/*`（14 文件） | 757 | compat op 生成投影 + TS 兼容面 re-export | 拆：op 自有化（§5.4）；re-export 面按 §5.5 |
| B | `api/brepjs-compat/index.ts` | 43 | 手写 compat 面 + 语义 wrap | 同上拆分 |
| C | `occt-kernel/occt-primitives.ts`、`api/occt-kernel-bridge.ts` | 4 | `OcctWasmAdapter` 引用、vendored kernel registry 接线 | 见 §5.1（范围已按实测收窄） |
| D | `api/{loft,revolve,sweep,thicken,replicate}.ts` | 5 | 平台 op 的 BREP 实现（经 brepjs fns） | core 直连 occt 重写（§5.3） |
| E | `api/assembly/*`（10 文件） | 14 | 装配求解（chain + global）+ 关节/装配树面 | **两条路径都留 core**（裁决 10）：chain 与关节面按 §5.6 自有化 |
| F | `api/result.ts`、`api/internal/{l3-bridge,profile-wire}.ts` | 7 | Result 投影、句柄借入 | 见 §5.2 / §5.7 |
| G | `api/view/{view-camera,view-projection}.ts` | 7 | 投影相机纯数据函数 | 内联 core（§5.2） |
| H | 测试（4 个 assembly 测试 + measurement-parity） | 7 | — | 随各类走 |

合计 757+43+4+5+14+7+7+7 = 840，与 §2.1 对平——**分类无遗漏**。

### 2.3 关键结构事实（实测，直接决定 §5 的范围）

1. **core 已经有自己的 occt 引擎，而且它就是默认 BREP 引擎**：
   - `brep/engine/primitives.ts` = L1 契约 `BrepEngineApi`；
   - `occt-kernel/occt-primitives.ts`（431 行）= `createOcctPrimitives()`，逐方法
     显式实现 `BrepEngineApi`，直调 occt-wasm 原生 `OcctKernel`；
   - `brep/engine/adapters/occt.ts` = 注册入口（`registerOcctBrepEngine()`，
     引擎 id `occt`，含 `capabilities` 逐核声明）；同目录还有
     `adapters/brepkit.ts`、`adapters/brep-mock.ts`（引擎切换测试用）；
   - 因此**不存在「core 没有引擎、要新建 occt-engine」这件事**。§5.1 是
     「把最后一处 vendored 依赖拔掉 + 删反向投影桥」，不是「收编出一个引擎」。
2. **core 自己的引擎只在一处触及 vendored 适配器**：
   `occt-primitives.ts` 第 110 行 `OcctWasmAdapter.fromKernel(k)`，源码注释明示
   「used only where occt-wasm has no single native call: hullFromPoints」——
   即 vendored 适配器对 core 自有引擎的全部价值当前只有 hull 一族。
3. **桥的方向被普遍误读（本方案的重点澄清）**：`api/occt-kernel-bridge.ts` 不是
   「core 借 vendored 内核」，而是**把 core 当前引擎反向投影成 vendored
   `KernelAdapter`**，供 vendored 函数（compat op 的实现）调用
   （`injectCurrentBrepEngineAsKernel()`，引擎中立，Phase 2 P2-5 起）。
   逆向依赖成立，方向是 vendored → core 引擎。
4. **桥的消费方是 7 处，不止 core 内部**：`brep/engine/adapters/occt.ts`
   （第 21 行 import）、`brep/engine/{engine-switch-p2,measurement-parity}.test.ts`、
   `packages/tests/faijs/d10-occt-single-instance/*.test.ts`、
   `packages/tests/faijs/{p3,p5}-vendored-surface/kernel-setup.ts`、
   `packages/sheetmetal/src/test-setup.ts`。删桥 = 这 7 处一起改。
5. **brepjs 的 211 方法内核接口是 vendored 私有物**：`kernel/occtWasm/*`（20 文件）
   + `kernel/interfaces/*`（16 文件）服务于 vendored 函数；core 侧契约是
   `BrepEngineApi`（`api/surface/engine-method-map.json` 为唯一真源）。
   收编这套接口进 core = 造第二套内核接口 → 违反裁决 8 与「一个符号一份实现」。
6. vendored 树对 core 零反向依赖、`occt-wasm` 是宿主注入的 peerDependency
   （`packages/brepjs/package.json` 的 `peerDependencies`；core 自身亦声明同名
   peer，删包不影响供给），包内无直接 import 单例——方向可行。

### 2.4 compat op 全集（实测 **35** 个，分布在三个 generated 文件）

```bash
grep -c 'compatOp(projectBrepOp(' packages/core/src/api/generated/{topology,operations,sketching}.ts
```

| 文件 | 数量 | op 名单 |
|---|---|---|
| `generated/topology.ts` | 18 | torus, fuse, ellipsoid, rotate, mirror, clone, applyMatrix, locate, section, split, shell, offset, heal, simplify, autoHeal, fixShape, healSolid, fixSelfIntersection |
| `generated/operations.ts` | 16 | extrude, revolve, sweep, complexExtrude, twistExtrude, linearPattern, circularPattern, gridPattern, roof, drill, pocket, boss, mirrorJoin, rectangularPattern, thread, convexHull |
| `generated/sketching.ts` | 1 | makeBaseBox |

核对口径：`api/surface/arg-spec.ts` 中 `kind: 'brep-op'` 条目数 = 35，
`api/surface/capability-map.json` 的 `entries` 长度 = 35，三者一致。

**注意区分两个数**（易混）：

- **compat op = 35**：需自有化的对象（本方案 §5.4）。
- **脚本面 op = 49**：`arg-spec.ts` 中 `scriptFace: true` 的条目数，含 core 自研
  op（primitives/transform/boolean/fillet/…）、query 面 op 与 view 面 op。
  这批本来就自有实现，**不属改造对象**，但 §5.5 删除 generated 分片时必须保证
  它们仍可装配。

其他分片（`kernel/query/2d/io/ns/gear/projection/text/core/brepjs`）的
`compatOp` 计数为 0——它们是纯 re-export 面，实际引用状况见 §2.7，处置见 §5.5。

### 2.5 monorepo 消费方全景（**本节纠正「其余包零 brepjs 消费」的旧结论**）

`grep -r '@faicad/faijs-brepjs' packages/*/src packages/*/vite.config.ts`：

| 包 | 规模 | 性质 | 处置 |
|---|---|---|---|
| `packages/core` | 38 文件 / 840 处 | 改造主体 | §5.1–5.7 |
| `packages/sheetmetal` | 40 文件（25 src + 15 test） | 建模范畴的真实消费方 | §5.8 |
| `packages/tests` | 21 文件 / 115 处 | `p3-vendored-surface`、`p5-vendored-surface`（vendored 面测试套件）+ `d10-occt-single-instance` + 两个 `kernel-setup.ts` | §5.9 |
| `packages/demo` | `vite.config.ts` 1 处 | `resolve.alias` 把 `@faicad/faijs-brepjs` 指向 `../brepjs/src`（活源码联动） | §5.9 |
| `packages/faijs-cadquery` | 9 文件 | import core 的 `api/internal/l3-bridge`（借入面）——**经 core 间接耦合** | §0.2 待裁决 3 |
| `packages/brepjs` 自身 | 262 文件 / 1.57MB（`src`）+ 7 个根 barrel | vendored 树与 brepjs 兼容面本体，包名自引用（subpath 导出） | **随裁决 9 整体删除**（§5.9） |
| **根级配置与发布通道**（实测 5 处） | — | ① 根 `package.json` 的 `workspaces[0] = "packages/brepjs"`（`check-workspaces-order.mjs` 按拓扑序断言）；② 根 `build` 脚本首段 `npm run build -w @faicad/faijs-brepjs`；③ `cdn/importmap.json` 第 3 行 jsdelivr 条目；④ `cdn/versions.json` 第 2 行 `"0.16.2"`（**未发布的死登记**）；⑤ `packages/core/tsconfig.vendored.json`（include 仍指向**已不存在**的 `src/vendored/brepjs/**`，`ci.ps1` L151 与 `ci.sh` 仍在跑它 —— 残留死配置） | §5.9 全部删除 |
| `scripts/` | 3 个文件 | `check-layer-boundaries.mjs`、`check-vendored-branding.mjs`、`publish-all.ps1` 硬编码包名 | §5.9 |

**结论**：裁决 6 的「monorepo 内零 brepjs 消费方」需要连 tests / demo /
cq-compat / 守卫脚本 / 根级配置 / CDN 通道一起收口，不是 sheetmetal 一家的事。
凡声称「其余包零消费」的表述都是错的。**终态（裁决 9）不是「降级保留」而是
`packages/brepjs` 目录不存在**：收口判据为「全仓（除 `node_modules`/`dist`）
grep 不到包名，且 `packages/brepjs` 路径不存在」。

### 2.6 codegen 与数据面（**旧方案完全遗漏的一层**）

| 工件 | 现状 | 归属判定 |
|---|---|---|
| `api/surface/arg-spec.ts`（3896 行 / 149KB） | 唯一人工维护点：35 brep-op + 49 scriptFace + 402 skip + 286 type + 111 pure + 23 query | **不能**——core 自有 op 的注册表与能力声明来源 |
| `api/surface/capability-map.json`（173KB） | 35 条 op → vendored 内核方法映射，由 `gen-capability-map.ts` 对 **vendored 树做调用图 BFS** 得出 | **不能**——静态分派（红线：禁止运行时回退）的支撑数据；op 自有化后 BFS 算法失效，须改为从 core 自有实现推导 |
| `api/surface/engine-method-map.json`（26KB） | 引擎能力对齐表（`BrepEngineApi` 与 occt/brepkit 的 aligned/dialect/occt-only 判定） | 留 core |
| `vendored-surface.json`(352KB) / `vendored-classification.json`(417KB) / `upstream-surface.json`(110KB) / `upstream-exclusions.json`(17KB) / `projection-manifest.json`(231KB) | 面向 vendored 树的提取/分类/覆盖度产物 | **随 `packages/brepjs` 删除**（裁决 9） |
| 7 个 codegen 脚本 | `gen-vendored-surface/classify/upstream-surface/emit`、`gen-l3-surface`、`gen-surface-check`、`gen-capability-map`（另 `gen-brepkit-surface`、`gen-engine-method-map`、`gen-api-dts`、`gen-symbol-table` 亦在 core scripts） | **按流向拆**，不能整批迁：见下 |

拆法（按产物落点，不按脚本归属）：

- **随包删除（原「迁 brepjs 包」组，裁决 9 后无接收方）**：
  `gen-vendored-surface`、`gen-vendored-classify`、`gen-upstream-surface`、
  `gen-surface-emit` 及其产物（`vendored-surface.json` 等 5 个 JSON）——
  它们只服务「把 vendored 面提取/投影出来」这件事，而 vendored 面既不再进
  core（§5.5 删 10 个零引用分片），也没有 brepjs 子包可落（裁决 9）。
  Phase 5 连脚本带产物一起删。
- **留 core**：`gen-l3-surface`（产物 = core 脚本面/query 面分片）、
  `gen-capability-map`（产物 = core 分派数据）、`gen-surface-check`
  （门禁，原设计须同时检查两侧 → 改为只检查 core 侧）、
  `gen-symbol-table`、`gen-api-dts`、`gen-brepkit-surface`。
- 留 core 的这批脚本**输入必须换成 core 自有实现**（§5.4 第 3 步）——不得改为
  指向包名 `@faicad/faijs-brepjs`（那正是要删的耦合，且裁决 9 后该包不存在）。
  `VENDORED_ROOT_REL` 随删除组消失，core 侧不再保留任何 vendored 根配置。

### 2.7 generated 分片的实际引用状况（决定 §5.5 的删除范围）

| 分片 | 引用数 | 仓库内引用方 | 判定 |
|---|---|---|---|
| `brepjs/index.ts`（1299 符号） | 298 | **无**（仅生成器自身 + `dist`） | 死代码 |
| `kernel.ts` | 38 | **无** | 死代码 |
| `gear.ts` | 14 | **无** | 死代码 |
| `2d.ts` | 12 | **无** | 死代码 |
| `io.ts` | 12 | **无** | 死代码 |
| `ns.ts` | 9 | **无** | 死代码 |
| `query.ts` | 8 | **无** | 死代码 |
| `projection.ts` | 7 | **无** | 死代码 |
| `text.ts` | 5 | **无** | 死代码 |
| `cad/script-face.ts` | 0 | **无**（自述 P5 骨架 / `TODO(P4)`） | 死代码 |
| `topology.ts` | 129 | `api/replicate.ts`、`api/internal/compat-op.test.ts`、`measurement-script.test.ts` | 承载 op，改造 |
| `measurement.ts` | 27 | `brep/engine/measurement-parity.test.ts` | 承载 query op |
| `core.ts` | 116 | `measurement-script.test.ts`（`getShapeKind`） | 部分承载 op |
| `operations.ts` | 77 | `api/index.ts`、`api/extrude.ts` | 承载 op，改造 |
| `sketching.ts` | 5 | 经 `script-face.ts` 相对 import | 承载 op |
| `view.ts` | 0（无 brepjs 依赖） | 经 `script-face.ts` 相对 import | 留 core |
| `script-face.ts` / `script-face-manifest.ts` | 0（无 brepjs 依赖） | `api/index.ts`、`api/api-namespace.ts`、`gen-symbol-table.ts`、3 个测试 | 留 core |

**关键结论**：死代码合计 **403 处引用 = core 全部 brepjs 引用的 48%**。
这 10 个分片的正确动作是**删除**（归属待 §0.2 待裁决 1），不是「整体迁入扩展包」
——`generated/brepjs/index.ts` 的内容就是 brepjs 包自己的公开面，把它搬进
brepjs 包等于让包 re-export 自己；且裁决 9 后**连可迁的目标包都不存在**。

## 3. 名词表（第三方执行者必读）

- **`packages/brepjs` / `@faicad/faijs-brepjs`**：09-24 方案把 vendored brepjs
  树物理迁出而成的子包。**本方案的终态是删除它**（裁决 9）——它不属本 monorepo
  的交付物，迁移期间只作语义参考源与测试对象存在于工作区；删除后 brepjs 的
  独立形态在仓库外，与本仓库无包级关系。别名：**扩展包**在本方案中**不指**它。
- **occt-wasm**：OCCT 编译的 wasm（arena 句柄模型，u32 句柄）。**这才是几何
  引擎**，core 与 brepjs 共用同一实例（`occt-wasm` 是双方 peerDependency，
  由宿主注入）。
- **`BrepEngineApi`**：core 的 L1 内核契约（`brep/engine/primitives.ts`），
  真源 = `api/surface/engine-method-map.json`。**core 唯一的内核接口**。
- **`createOcctPrimitives()`**：core 的 occt 引擎实现
  （`occt-kernel/occt-primitives.ts`），直调 occt-wasm 原生方法。
- **`KernelAdapter` / `interfaces/*`（211 方法）**：**brepjs 私有**的内核抽象，
  服务 vendored 函数。本方案**不收编**进 core。
- **`OcctWasmAdapter`**：brepjs 对 occt-wasm 的完整适配器
  （`kernel/occtWasm/occtWasmAdapter.ts`）。core 只在 `hullFromPoints` 上用到它。
- **occt-kernel-bridge（反向投影桥）**：`api/occt-kernel-bridge.ts`。把 core
  当前引擎投影成 vendored `KernelAdapter` 注入 vendored registry，使 vendored
  函数可用。**方向是 vendored → core**。自有化完成后其唯一存在理由消失。
- **compat op**：`compatOp(projectBrepOp('<name>', …, vendoredFn))` 形态的生成
  op，共 35 个。本方案将它们全部**自有化**：改为 core 直连 occt 引擎的实现。
- **l3-bridge / borrow**：core Shape（数字句柄）⇄ vendored `ShapeHandle`
  （对象视图）的零拷贝互操作（arena 句柄同源，D10 单实例）。**注意**：
  `borrowBrepjsShape` / `adoptBrepjsProduct` 被 `packages/faijs-cadquery` 当公开 API
  使用（9 处）——core 内部停用 ≠ 删除这个对外借入面（§0.2 待裁决 3）。

## 4. 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│ @faicad/faijs (core) —— 3D 建模 API 本体                      │
│                                                              │
│ lang/            .fai.js 语言层（不动）                        │
│ mesh/            manifold 链（不动）                          │
│ occt-kernel/     ★ createOcctPrimitives（core 自己的 occt 实现）│
│ brepkit-kernel/  brepkit 引擎（已有）                          │
│ brep/engine/     BrepEngineApi + registry + adapters/         │
│                  （occt / brepkit / brep-mock —— 注册机制已存在）│
│ api/             ★ 全部 op core 自有实现（35 个 compat op 自有化）│
│ api/surface/     arg-spec + capability-map + engine-method-map │
│                  （分派真源，留 core）                          │
│ result/          ★ 第一方 Result/errors 模块                   │
│ cad-runtime/     编排（不动）                                  │
│ api/assembly/    ★ global-solver（core 自研，保留）             │
└───────▲───────────────────────────────▲──────────────────────┘
        │ 依赖 core 公开 API
┌───────┴──────────────┐
│ @faicad/sheetmetal   │
│ ★ 改写：只依赖 core，  │
│   不再依赖 brepjs     │
└──────────────────────┘
✗ packages/brepjs（@faicad/faijs-brepjs）—— 迁移期临时存在，Phase 5 整体
  删除（裁决 9）。终态：monorepo 内不存在 brepjs 子包；brepjs 的独立形态
  在仓库外，不属本 monorepo 的交付物。
```

依赖红线：core 零 brepjs；扩展包 → core 单向；**monorepo 内不存在 brepjs 子包**
（终态，裁决 9）。**core 只有一套内核接口**（`BrepEngineApi`）；brepjs 的
`KernelAdapter` 属仓库外项目内部物，与 core 无关。

## 5. 改造内容（逐类）

### 5.1 C 类：拔掉 core 自有引擎对 vendored 适配器的最后一处依赖 + 删反向投影桥

**不是「收编引擎」**（引擎已存在，见 §2.3.1）。实际动作：

1. 定位 `createOcctPrimitives()` 中 `OcctWasmAdapter.fromKernel(k)` 的用途
   （当前唯一用途 = `hullFromPoints`）。两条路，Phase 0 定：
   - 移植最小闭包（`packages/brepjs/src/kernel/hullOps.ts` +
     `kernel/hullGeometry.ts` 及其 import）进 `occt-kernel/`，改用 core 的
     `BrepEngineApi` 形态；
   - 或直调 occt-wasm 的 hull 原生方法（若无，则前者）。
   **不做**：收编 20 文件 `occtWasm/*` + 16 文件 `kernel/interfaces/*`（§2.3.5）。
   ⚠️ **参考窗口受限**（裁决 9）：上述源文件随 `packages/brepjs` 在 Phase 5
   删除，本步骤**必须早于删包完成**；照抄语义、不留 import。
2. 删除 `api/occt-kernel-bridge.ts`（反向投影桥），同步改 **7 处消费方**（§2.3.4）。
   注意 `brep/engine/adapters/occt.ts` 第 21 行 import 了
   `injectCurrentBrepEngineAsKernel`——注册流程需一并调整（注册只管 core 引擎，
   不再向 vendored registry 注入）。
3. `engine-switch*` / `measurement-parity` 等测试中依赖「注入后 vendored 可用」的
   断言按新语义重写。
4. wasm 初始化通道不变：`initOcctWasm()`（`occt-kernel/occtKernel.ts`）+
   `registerOcctBrepEngine()`；宿主注入方式不变。

### 5.2 F/G 类：Result / 常量 / 视图投影内联 core

- 复制 `packages/brepjs/src/core/result.ts`、`core/errors.ts` →
  `packages/core/src/result/`，作为 core 第一方模块；签名不变
  （`ok/err/isOk/isErr/unwrap/unwrapOr/map/andThen/BrepError/…`）。
- 同批内联：`DEG2RAD/RAD2DEG`（constants）、`api/view/*` 的
  `createCamera/cameraFromPlane/PROJECTION_PLANES`（纯数据，~160 行）。
- **`api/index.ts` 的平铺面必须补齐本方案原先漏掉的符号**（它们是下游的门面）：

  | 现来源 | 符号 | 下游 |
  |---|---|---|
  | `api/brepjs-compat` | `createPlane` / `createNamedPlane` / `resolvePlane` | 库作者面（`api/index.ts` 平铺） |
  | `api/brepjs-compat` | `vecAdd/vecSub/vecScale/vecDot/vecCross/vecLength/vecNormalize` | sheetmetal、下游库 |
  | `api/brepjs-compat` | `kernelError` / `validationError` | fcstd（`@faicad/faijs/api/result` 8 处）等 |
  | `api/brepjs-compat` | `makeExternalGear`…`thread`、`map/andThen` | 库作者面（见 `api/index.ts` 第 102–110 行） |

  逐个决定「内联 core / 就地保留在 core 公开面」，但**表内每一行都要有落点**，
  不允许留悬空导出（裁决 9 后无扩展包可接收）。
- `api/result.ts`、`api/internal/result-unwrap.ts` 的 import 切到第一方模块。
  **`@faicad/faijs/api/result` 这个深路径必须继续存在**（`fcstd` 有 8 处消费）。
- parity 对拍测试：core 正被改造为「零 brepjs 引用」并由 §6 Phase 5 的守卫
  检查 core `src/`，所以对拍测试**不得放 core**，应放 `packages/tests`
  （临时），且**必须在 Phase 5 删包之前用完**（裁决 9 后无对照物可供对拍）。

### 5.3 D 类：平台 op 的 BREP 实现改为 core 直连 occt

`api/{loft,revolve,sweep,thicken,replicate}.ts` 的 BREP 实现改为 core 直连：

- occt 原生能力对照（经 core 引擎/原生面）：`loft` →
  `BRepOffsetAPI_ThruSections`；`revolve` → `BRepPrimAPI_MakeRevol`；
  `sweep` → `BRepOffsetAPI_MakePipeShell`；`thicken` → `BRepOffset_MakeOffsetShape`；
  `replicate` → 纯矩阵实例变换（不触 wasm）。
- 语义参考实现 = brepjs 对应 fns
  （`packages/brepjs/src/operations/{loftFns,sweepFns}.ts` 等），**照抄语义不
  import**。⚠️ 参考窗口只在迁移期：该树随裁决 9 在 Phase 5 删除，**§5.3 与
  §5.4 的全部自有化必须早于删包完成**，否则失去参考物与对拍基线。
- 回归基线：`api/*.test.ts` 现有测试 + `packages/tests` 相关 e2e，断言不放宽。

### 5.4 A/B 类之 op 部分：35 个 compat op 全部自有化（本方案核心动作）

**把 `compatOp(projectBrepOp('<name>', …, vendoredFn))` 逐个换成 core 直连
occt 引擎的实现。**

**本仓库已有自有化先例，照它写**（勿另立形态）：

- `api/brep-mirror/threadFns.ts`——occt 原生构造螺纹（`kernel.makeLineEdge` +
  `kernel.makeWire` + `kernel.loft`），文件头明写「适配自 brepjs
  `operations/threadFns.ts`，保留算法，改用本项目 occt-wasm API；差异：不用
  BlueprintSketcher / DisposalScope / Result，改为 kernel 直调 + `BrepHandle` +
  抛异常」。消费方：`api/screw.ts`（core）与 `faijs-extra/ops/fai_drill.ts`。
- `api/brep-mirror/joinery-brep.ts`——657 行榫卯布尔序列，消费方
  `faijs-extra/ops/fai_split.ts`。
- 平台归属写法：文件头 `@platform occt` 自证 + op 声明 `engines: ['occt']`
  （守卫 `check-platform-imports.mjs` 规则 2）。

逐 op 步骤（每个 op 同一模式）：

1. 读该 op 的生成投影 + `arg-spec.ts` 条目，确认参数面与 `formClass`
   （schema 不变）与 `engines` 声明。
2. 读 brepjs 对应 fns 作为**语义参考**（内核方法选择、公差、keep/history、
   Result→错误码映射、命名/角色表、`borrow/adopt` 所有权）——参考窗口见 §5.3，
   必须早于 Phase 5 删包。
3. 在 core 写自有实现（形态对齐 `api/brep-mirror/*`），直调 core 引擎方法；
   平台 op 标 `@platform occt` + `engines: ['occt']`。
4. **重推该 op 的能力声明**：把 `capability-map.json` 中该 op 的条目从
   「vendored 调用图 BFS 结果」改为「core 自有实现调用的内核方法集合」，
   保持静态分派（禁运行时回退）语义不变。**这是旧方案最大的遗漏**：op 换实现
   必然改写 capability-map，而它是分派真源。
5. 删除该 op 的 vendored import 与 `projectBrepOp` 包装，并从 generated 分片中
   摘掉（分片最终由「core 自有 op 的清单」重新生成，见 §5.5）。
6. 跑该 op 全部既有测试（api 内 + `packages/tests` e2e）+ capability-map 门禁；
   几何断言不许放宽。

**顺带消除已有重复实现**（`api/index.ts` 与 `api/api-namespace.ts` 的取源先逐个复核）：

- `thread`：vendored compat op 与 core `api/brep-mirror/threadFns.ts` 两份 → 收敛
  为一处（以 core 版为准）。
- `revolve`：cad 面取 `api/revolve.ts`（手写、**带 roleTable**），TS 库面
  `api/index.ts` 第 76 行却取 `./generated/operations` 的 compat op（**无
  roleTable**，正是 `api/revolve.ts` 文件头记录的「nameless shape」缺陷）→
  自有化后两面对齐到同一份手写实现。
- `extrude`：`api/extrude.ts` 第 26 行把长度形态委托给 `generated/operations`
  的 compat op → 自有化后去掉委托。
- `sweep` / `loft` / `thicken`：cad 面与 TS 面均取手写平台 op（`api/*.ts`），
  但手写 op 内部仍调 vendored 函数 → 属 §5.3 范围。

**自有化顺序（由简到繁）**：

| 组 | ops | 说明 |
|---|---|---|
| G1 直通型 | applyMatrix / clone / locate / heal / healSolid / fixShape / autoHeal / fixSelfIntersection / simplify / makeBaseBox / torus / ellipsoid / section / mirror | 语义薄，多为单内核方法调用 |
| G2 布尔/修剪 | fuse / pocket / drill / boss / mirrorJoin / split / convexHull | 布尔走 `BRepAlgoAPI_*`（含 N-way）；convexHull 需 hull 闭包（§5.1） |
| G3 拉伸/旋转/修饰族 | extrude / complexExtrude / twistExtrude / revolve / rotate / offset / shell | 生成特征；注意 `extrude.ts` / `revolve.ts` 手写先例的 roleTable 登记 |
| G4 阵列/特征 | linearPattern / circularPattern / rectangularPattern / gridPattern / roof / thread | 多为 G2+G3 的组合循环；thread 用 core 既有实现 |
| G5 平台 op 层 | `api/{loft,revolve,sweep,thicken,replicate}.ts` 的 BREP 实现 | 手写 op 外壳保留，内部换成 core 直连（§5.3） |

### 5.5 A/B 类之 re-export 面：一律删除（裁决 9 后无迁移目标）

按 §2.7 实测分两类：

1. **10 个零引用分片**（`brepjs/index`、`kernel`、`gear`、`2d`、`io`、`ns`、
   `query`、`projection`、`text`、`cad/script-face`；403 处引用）：**删除**。
   它们是「把 vendored 面投影进 core」的产物，而 vendored 面本来就住在 brepjs
   包里——迁进去等于自我 re-export，无任何价值。
   ⚠️ 它们在包外经 `./api/*` 通配可达（Node subpath pattern 的 `*` 跨 `/`），
   删 = 公开面收缩 → 走 §0.2 待裁决 1。
2. **6 个有引用分片**（`script-face`、`script-face-manifest`、`operations`、
   `topology`、`core`、`measurement`，另 `view` 无 brepjs 依赖）：**就地改造，
   不迁出**（裁决 9 后也不存在可迁的目标包——`packages/brepjs` 将被删除）。
   它们承载 core 的脚本面 op / query op 与 `cad` 面清单
   （`api/index.ts`、`api/api-namespace.ts`、`gen-symbol-table.ts` 都从这里取，
   且 AGENTS「单一来源」要求不允许第二份清单）。动作 = 改为指向 core 自有实现：
   - `brep-op` 条目 → 指向 §5.4 自有实现；
   - `query` 条目 → 指向 core 引擎查询方法（`getEdges/getFaces/getSolids/
     getBounds/getSurfaceType/…`）；
   - `type` / `pure` 条目 → 指向 core 自有类型/工具，或裁定删除（这些符号若
     `@faicad/faijs/api` 本就不平铺，则属未公开面）。
3. `api/brepjs-compat/index.ts`（43 处）+ `api/index.ts` 的 `brepjsCompat`
   命名空间与平铺组合器：**按符号逐个定性**——纯组合器/工具（Result、向量、
   平面、常量）内联 core（§5.2）；纯 vendored op 符号平铺面（`brepjsCompat.fuse`
   等）判为「库作者兼容面」，其存废**并入 §0.2 待裁决 1**（公开面边界）——
   不得再假设有扩展包接收（裁决 9）。
4. `@faicad/faijs/brepjs-compat` 子路径：**删除**（连同
   `packages/core/src/brepjs-compat.ts` 别名文件）。理由：core 零依赖后无法
   转发到 brepjs 包，而「deprecation 转发」需要 core 依赖扩展包 → 与裁决 2
   直接冲突；且该包名从未发布，无 monorepo 外历史消费方。**包内唯一消费方是
   sheetmetal 的一个测试文件**（`foreignUnfold.test.ts`），随 §5.8 改写。

### 5.6 E 类：装配面自有化（裁决 10——两条求解路径都留 core）

**裁决**：为保 API 兼容，chain 与 global **都必须可用**（裁决 10）。所以 chain
既不是「迁走」也不是「删掉」，而是**用 core 自有实现替换 vendored 实现**，
两条路径并列留在 `api/assembly/`，默认值不变。

#### 5.6.1 自有化后的落点（与 global-solver 对称）

| 现状 | 自有化后 |
|---|---|
| `solvers/global-solver.ts`（core 自有） | 不动 |
| vendored `kernel/solverAdapter.ts`，被 `solve.ts:16` import | **新增 `solvers/chain-solver.ts`**（core 自有） |
| `SolverEntity` / `SolverConstraint` / `SolverResult` 类型在 vendored 侧 | 迁入 `solvers/types.ts` |
| vendored `utils/quaternion.ts`（78 行：`quatRotate`/`quatFromAxisAngle`/`quatFromTo`/`quatMultiply`） | 内联 core（`solvers/quat.ts` 或并入既有工具模块） |
| vendored `operations/jointFns.ts`（464 行）+ 装配树原语 | 关节面自有化（§5.6.3） |

core 侧**不动**（只改 import 源，不动结构）：`solvers/{global-solver,linalg,
pose-from-delta}`、`api/assembly/types.ts`、`normalize.ts`、`validate.ts`、
`golden-mate.ts`，以及装配 op 定义。

**关键：API 面零改动**。`SolverStyle = 'chain' | 'global'`（`solvers/types.ts`
第 14 行）与 `SolveOptions.solver?`（同文件 20–25 行）**本来就定义在 core**，
只有 chain 的**实现体**在 vendored 侧。自有化后签名、默认值、导出面均不变。
core 侧 `quatRotate` 内联（§5.2 手法）可先行，与其他裁决项无关。

#### 5.6.2 语义基线 = vendored 现行为（移植，不是重新设计）

`solvers/chain-solver.ts` 必须逐项对齐 `kernel/solverAdapter.ts` 的现行为：

- **拓扑轮次调度**：根 = 从未作为 `entityB` 出现的节点 ∪ 显式 `fixed` 节点；
  反复扫描 pending，只解「参考 `entityA` 已 placed」的约束；无进展即停；剩余
  pending 全部记 `(unanchored)`。
- **八类解析解**：`solvePlanePair` / `solveConcentric` / `solveAngle` /
  `solvePointPair` / `solvePlaneToPoint` / `solveAxisToPoint` /
  `solvePointToAxis` / `solveAxisAxisDistance`，按实体类型对分派。
- **诊断语义**：`unsupported` 字符串格式（`"<type>(<a>-<b>)"` 与
  `"<type>(unanchored)"`）、`UNSUPPORTED_DOF` 表（coincident 3 / concentric 4 /
  distance 1 / angle 1）的求和规则、`converged = unsupported.length === 0`。
- **错误行为**：不收敛时 `solve.ts` 抛错的文案与 `dof` 数值不得变。
- **默认值一字不改**：`solve.ts` 第 68 行 `opts.solver === 'global'` 判断与
  「缺省走 chain」保持原样（裁决 10），并新增一条测试钉住该默认值。

⚠️ **参考窗口**：vendored 原实现随 `packages/brepjs` 在 Phase 5 删除，故
chain 自有化**必须在删包前完成**（§6 Phase 顺序约束），且**在删包前**用现行为
做一次 parity 对拍（临时测试，Phase 5 随包删除）。

#### 5.6.3 关节 / 装配树面（同一手法）

`joints.ts` 从 vendored 借的符号一并自有化（不属 chain 求解器，但同属 E 类）：

- 关节工厂与运动学（源 `operations/jointFns.ts` 464 行）：`revoluteJoint`、
  `prismaticJoint`、`forwardKinematics`、`mechanismDOF`、`jointTrajectory`、
  `inverseKinematics`、`addJoint` + 类型 `Joint` / `JointPose` / `IKResult` /
  `IKOptions` / `IKTarget`。
- 装配树原语：`createAssemblyNode` / `addChild` / `AssemblyNode`。
- `pose.ts` 的 `JointPose` 类型引用同源处理。

#### 5.6.4 需改动的 import 落点（实测，Phase 4 逐条改）

| 文件 | 行 | 借入符号 |
|---|---|---|
| `solve.ts` | 16 | `solveConstraints` |
| `preview.ts` | 19 / 21 | `SolverConstraint`+`SolverEntity`（type）/ `solveConstraints` |
| `entities.ts` | 20 | `SolverEntity`（type） |
| `lower.ts` | 14 | `SolverConstraint`+`SolverEntity`（type） |
| `pose.ts` | 12 / 13 / 14 | `SolverEntity`（type）/ `quatRotate` / `JointPose`（type） |
| `joints.ts` | 35 / 36 | 关节工厂 + `createAssemblyNode`/`addChild`/`AssemblyNode` |
| 测试 | — | `solve.test.ts:20`、`preview.test.ts:19`、`pose.test.ts:14` |

（`api/assembly/index.ts` 无 brepjs import，仅注释中出现该词。）

#### 5.6.5 验收

- `solve.ts` 的 solver 分派与默认值**逐字未改**；新增测试钉住「缺省 = chain」。
- 既有 chain 测试**全部保留**（`solve.test.ts` 25 用例含 T5 链式三体用例、T6
  直译对照用例；`preview.test.ts` 18 用例；`pose.test.ts` 4 用例），仅把断言的
  实现来源从 vendored 改为 core 自有；**断言值不放宽**。
- 删包前 parity 对拍通过；删包后 chain 与 global 两条路径测试均全绿。

### 5.7 零散件与对外深路径

- Phase 0 用 `grep -rn '@faicad/faijs-brepjs' packages/core/src` 全量列出，
  逐个按「内联 / 随类迁移 / 删」处置，不允许留「临时转发」。
- 已知零散件：`api/internal/profile-wire.ts`、`api/internal/l3-bridge.ts`
  （`core/disposal` 的 `createBorrowedHandle`/`unregisterFromCleanup`/
  `ShapeHandle`、`kernel/occtWasm/helpers` 的 `handle`/`isOcctWasmHandle`）。
- ⚠️ **对外深路径不可随意挪**（旧方案对这点是错的）：core 的 `./api/*`、
  `./brep/*`、`./occt-kernel/*`、`./topology/*` 等通配导出实际被下游当公开面
  使用，例如 `faijs-extra` 用 `@faicad/faijs/api/brep-mirror/threadFns`
  与 `/brep/brep-ops`、`fcstd` 用 `/api/result`、`cq-compat` 用
  `/api/internal/l3-bridge`、`tests` 用 `/brep/engine/adapters/occt`。
  动这些路径前必须先列出消费方并给替代落点。

### 5.8 sheetmetal 改写（裁决：彻底去掉 brepjs 依赖链）

**实测（纠正旧方案的清单）**：40 个文件引用（25 `src` + 15 测试）；去重后
**44 个值符号 + 9 个类型符号**（不是 25 + 7）。

| 类别 | 符号 | 落点 |
|---|---|---|
| Result | `ok/err/isOk/isErr/unwrap/validationError` + `Result/BrepError` | §5.2 core 第一方 result |
| 查询/测量 | `isValid/isSolid/getEdges/getSolids/getFaces/getBounds/getSurfaceType/curveStartPoint/curveEndPoint/outerWire/measureVolume/measureArea/faceCenter/normalAt/pointOnSurface/sharedEdges/isPlanarWire/wireLoop` | core 引擎查询面（部分需新增出口，见下） |
| 建模 | `box/cylinder/sphere/translate/rotate/polygon/fuse/cut/intersect/extrude` | §5.4 自有化底座（`extrude` 已是 core op） |
| 构造 | `face/line`（`wire` core 已有出口） | **core 当前无出口** |
| 向量 | `vecAdd/vecSub/vecScale/vecDot/vecCross/vecLength/vecNormalize` | §5.2 core util |
| 类型 | `Bounds3D`(core 已有)、`Edge/Face/Wire/Solid/Vec3/ValidSolid/BrepError/Result` | core 引擎/几何类型 |

⚠️ **修正旧方案的结论**：旧方案称这些符号「全部落在 core 收编底座覆盖范围内，
没有任何只有 brepjs 才有的能力」。实测**能力**确实都在 occt 内核里，但 **core
公开面缺 9 个出口**：`face`、`line`、`wireLoop`、`isPlanarWire`、`faceCenter`、
`normalAt`、`pointOnSurface`、`sharedEdges`、`measureArea`
（逐个用 `grep '\b<name>\b' packages/core/src/api/index.ts` 复核为「无」）。
→ 改写前先在 core 增设这批出口（具体面由 §0.2 待裁决 2 决定）。

**改写内容**：

1. import 来源全改为 `@faicad/faijs` 对应出口；类型对齐（brepjs
   `Solid`（ShapeHandle 视图）→ core 引擎句柄形态；`foreignUnfoldFns.ts` 的
   `getFaces<'3D'>` 等泛型面按 core 查询 API 对齐）。
2. `package.json` 移除 `@faicad/faijs-brepjs`。
3. `src/test-setup.ts` 改为 `initOcctWasm()` + core 引擎注册
   （`injectCurrentBrepEngineAsKernel` 随桥删除）；`foreignUnfold.test.ts`
   对 `@faicad/faijs/brepjs-compat` 的 import 改 local。
4. sheetmetal 全量测试为回归基线，断言不放宽。

**改写完成后**：monorepo 内 brepjs 消费方只剩 §2.5 表里的 tests / demo /
cq-compat / 守卫脚本 / 根级配置；全部收口后按裁决 9 **删除 `packages/brepjs`
子包**（不是「降级保留 / 可选发布」）。

### 5.9 tests / demo / cq-compat / 守卫脚本 / 根级配置收口

**本节是裁决 9 的落地主体**：目标不是「把消费方迁走」，而是让 `packages/brepjs`
目录能从仓库中消失。

1. **`packages/tests`**：
   - `p3-vendored-surface`（14 文件）+ `p5-vendored-surface`（31 文件）= **45
     个文件是 vendored 面自身的测试**（`booleanFns`/`curveFns`/`faceFns`/
     `finderFns`/`measureFns`/`measurement`/`primitiveFns`/`query`/`shapeFns`/
     `topology`/`wrapperFns`/`gearFns`/`loftFns`/`sweepFns`/`svgPath`/
     `sketcher2d` 等）。裁决 9 后**无接收方，随包删除**。
     ⚠️ **删前必做搬迁**：其中一批是真实 bug 复现 / 语义基线
     （`sweepRepro`、`sweepSketchOrientation`、`boolean2dRegression`、
     `svgPathRegression`、`straightSkeleton`、`approximations` 等）。这些用例
     的断言对象若在 §5.4 自有实现下仍成立，必须**先改写成 core 侧测试**再删
     原文件——否则等于把回归基线一起丢掉。
   - `d10-occt-single-instance`（1 文件）与两个 `kernel-setup.ts` 依赖反向投影
     桥 → 按 §5.1 新语义重写（内核装配从「向 vendored registry 注入」变为
     「core 引擎直接可用」）。
2. **`packages/demo`**：`vite.config.ts` 的 alias 指向 `../brepjs/src` ——
   随包删除，**该 alias 条目删除**；收口判据 = demo 不再经 core 到 brepjs。
3. **`packages/faijs-cadquery`**：9 处 `api/internal/l3-bridge` 借入面 → §0.2
   裁决 4（「迁扩展包」分支已失效，只剩「core 保留」或「cq-compat 改写」）。
4. **`scripts/`**：
   - `check-vendored-branding.mjs`：守卫对象（vendored 树字符串 + 包名）随包
     消失 → 改为「monorepo 内零 brepjs 子包 / 零包名引用」守卫，或并入
     Phase 5 新增的 `check-core-no-brepjs.mjs` 后删除本脚本；
   - `check-layer-boundaries.mjs`：文件头注释仍写已不存在的旧路径
     `packages/core/src/vendored/brepjs/`，vendored 相关段随包删除；
   - `publish-all.ps1`：`@faicad/faijs-brepjs` 项**删除**（不是「可选发布」）；
   - `check-workspaces-order.mjs`、`check-dep-lockstep.mjs`、
     `check-ghost-deps.mjs`：随 `workspaces` 数组变化同步（见下条）；
   - `check-platform-imports.mjs`、`check-lib-layering.mjs`、
     `check-lib-src-language.mjs`、`verify-md-wrap.ts`（`isExcluded` 仍含
     `packages/brepjs/src/`）：复核是否受 generated 删除 / 包删除影响。
5. **根级配置与发布通道（实测 5 处，全部删除）**：
   - 根 `package.json`：`workspaces` 去掉 `"packages/brepjs"`（首项，
     `check-workspaces-order.mjs` 按拓扑序断言）；`build` 脚本去掉
     `npm run build -w @faicad/faijs-brepjs` 首段；
   - `cdn/importmap.json` 第 3 行的 `@faicad/faijs-brepjs → jsdelivr` 条目；
   - `cdn/versions.json` 第 2 行的 `"@faicad/faijs-brepjs": "0.16.2"`
     （**从未发布的死登记**，见 §0.1 裁决 9）；
   - `packages/core/tsconfig.vendored.json` **删除**（include 仍指向已不存在的
     `src/vendored/brepjs/**`，属残留死配置）；
   - `scripts/ci.ps1` 第 151 行 `npx tsc --noEmit -p
     packages/core/tsconfig.vendored.json` 与 `ci.sh` 对应段删除；
     `ci.ps1` L150/L155 的 vendored 注释与品牌守卫调用按上条调整。
   - **已核实（防执行者误判）**：删包**不影响 `occt-wasm` 供给**——core 自身的
     `peerDependencies` 已声明 `occt-wasm: ^3.8.4`，根 `package.json` 有
     `overrides: {"occt-wasm":"3.8.4"}` 锁单实例；`sheetmetal` 的 peer
     `@faicad/faijs-brepjs` 随 §5.8 移除；`cq-compat` / `fcstd` /
     `faijs-extra` / `tests` 的 package.json 本就不含 brepjs 包名
     （cq-compat 的耦合是经 core `l3-bridge` 间接的）。
6. **`packages/brepjs` 树本身**：Phase 5 **整目录删除**（裁决 9）。删除前须完成
   §5.1 / §5.3 / §5.4 / §5.6 全部自有化，以及第 1 条的测试搬迁。

## 6. 执行规划（Phase 划分，供第三方执行）

> 每个 Phase 结束时 monorepo 必须处于：`npm run typecheck` 0 错、
> lint 0 错、相关包测试全绿、可 build 的**可交付状态**。
> 遵守 AGENTS.md：测试纪律（不跑 CI 找 bug、stderr 零容忍）、关键验证
> 落测试、文档同 PR 更新。

### Phase 0 — 事实核验与基线（1~2 天）

1. 复核 §2 全部计数与清单（命令已给）。
2. **op 逐个盘点**：35 个 compat op × {brepjs 参考实现位置、occt 引擎方法、
   语义保留点（keep/history/命名/roleTable）、现有测试清单、§0.2 技术方式取舍
   所需证据} → 产出 `docs/plans/…-op-selfhost-inventory.md`（执行中的活文档）。
3. 盘点 `createOcctPrimitives()` 对 vendored 件的最小闭包（§5.1 第 1 步）。
4. **全仓消费方盘点**（旧方案此处有错，必须重做）：core 全目录 +
   `packages/{sheetmetal,tests,demo,cq-compat,faijs-extra,brepjs}` +
   `scripts/` + **根级配置**（根 `package.json` 的 workspaces/build、`cdn/`、
   `packages/core/tsconfig.vendored.json`、`ci.ps1`/`ci.sh`）的 brepjs 引用与
   core 深路径引用，逐条落表（§2.5 / §5.7 / §5.9）。
5. **公开面基线重拍**：`scripts/api-surface-snapshot.json` 现存基线已过期
   （仍含 `./fcstd`、`./fcstd-convert` 键，core 现为 28 个 exports 键）——
   先 `npm run build` 再 `node scripts/api-surface-snapshot.mjs` 重拍，
   作为后续 diff 判据。
6. 把 §0.2 的**三项**待裁决（+ 一条技术方式取舍，共四项）整理成一页（含实测
   证据）交用户拍板；**未拍板项在后续 Phase 中不得动**。（原第 1 项「默认求解
   风格」与原第 5 项「chain 落点」已由**裁决 10** 关闭，不再列入。）

### Phase 1 — 内联基础件（1 天）

1. Result / errors / 常量 / 视图投影内联（§5.2）+ §5.2 表中每个平铺符号定落点。
2. 验收：core 测试全绿；导出面 diff 相对 Phase 0 基线**仅允许新增/无变化**
   （不得静默消失）。

### Phase 2 — 拔除 vendored 引擎耦合（1~2 天）

1. `createOcctPrimitives()` 的 hull 依赖按 §5.1 第 1 步处理（最小闭包移植）。
2. 删除 `api/occt-kernel-bridge.ts`，改 7 处消费方（§2.3.4）。
3. 验收：core 自有 occt/brepkit/mock 引擎装配与切换测试全绿；
   `packages/tests` 的 occt 相关套件按新装配方式全绿。

### Phase 3 — 35 个 op 自有化（**工作量最大**，按 G1→G5 分批）

1. 每批：实现 → 重推 capability-map 条目 → 该 op 测试 → 导出面 diff → 下一批。
2. G1/G2 完成后可先行删除对应 vendored import（增量减依赖）。
3. 验收：35 op 全部无 `projectBrepOp`；`api/surface/capability-map.json`
   的 35 条全部来自 core 自有实现；几何测试全绿（不放宽断言）；
   静态分派语义不变（无运行时回退）。

### Phase 4 — generated 面收口 + 装配面自有化（裁决 10）+ sheetmetal 改写 + 全仓收口

1. §5.5：删 10 个零引用分片（走裁决 2）；6 个有引用分片改为指向 core 自有实现。
2. §2.6：codegen 按流向拆分（**删除组连脚本带产物一并删除**，core 侧生成器改
   输入源）；`gen-surface-check` / `gen:surface` / `doc-sync` 脚本链同步。
3. §5.6：装配面自有化——新增 `solvers/chain-solver.ts`、类型迁入
   `solvers/types.ts`、`quaternion` 内联、关节/装配树面自有化，并改 §5.6.4
   表内 9 处 import；**默认值不改**，加一条「缺省 = chain」测试；
   删包前完成 parity 对拍。
4. §5.8：sheetmetal 改写（含 core 补 9 个出口，走裁决 3）。
5. §5.9 第 1~5 条：tests 的 45 个 vendored 用例「搬迁后删除」/ demo alias /
   cq-compat / 守卫脚本 / 根级配置（workspaces、build、cdn、tsconfig.vendored、
   ci 步骤）。
6. 验收：core / sheetmetal / tests 全绿；`grep` 确认 core 零 brepjs、
   sheetmetal 零 brepjs；**`packages/brepjs` 已无任何消费方**（唯一残留 =
   显式裁定的 cq-compat 结果，与待 Phase 5 删除的包目录本身）。

### Phase 5 — 删除 brepjs 子包 + 归零守卫 + 收尾（1~2 天）

1. 新守卫 `scripts/check-core-no-brepjs.mjs`：范围 = 所有 `package.json`、
   各包 `src/`、`scripts/`、`cdn/`、根构建链（**排除** `node_modules` /
   `dist` / `docs` / `.agents/notes` —— 文档与决策记录里的叙述性提及不构成
   依赖，方案文本本身也含该字样）；命中 `@faicad/faijs-brepjs` 字样或
   `packages/brepjs` 路径即失败；接入 `ci.ps1` / `ci.sh` 门禁序列
   （承接 §5.9 第 4 条对 `check-vendored-branding.mjs` 的处置）。
2. **删除 `packages/brepjs` 子包**（裁决 9）——前置条件：§5.1 / §5.3 / §5.4 /
   §5.6 自有化全部完成 + §5.6.2 的 chain parity 对拍通过 + §5.9 第 1 条测试
   搬迁完成。同时清根级配置 5 处
   （§5.9 第 5 条）。
3. 删除 core 残骸与死代码（`api/occt-kernel-bridge.ts`、删除后的 generated、
   临时 parity 对拍测试）。
4. 同步既有守卫与元数据（逐项，不再「参考某方案 §5」）：
   `check-workspaces-order.mjs`、`check-dep-lockstep.mjs`、`check-ghost-deps.mjs`、
   `check-layer-boundaries.mjs`（其文件头注释仍写旧路径
   `packages/core/src/vendored/brepjs/`，一并修正）、
   `check-platform-imports.mjs`、`check-lib-layering.mjs`、
   `check-vendored-branding.mjs`（删或并入第 1 步守卫）、
   `npx madge --circular packages/*/src`、`scripts/api-surface-snapshot.json`。
5. 版本号 bump（core）；`docs/ops-api-inventory.md`、`docs/api-contract.md`
   同步（compat op 实现来源改为 core 直连 occt）；本方案与 09-24 方案标注
   状态流转。
6. weapp 恢复纯 core tgz 依赖（撤临时 `file:` 行）+ 重建 worker + 探针回归。

### 验证总闸（Phase 5 末，全绿才算完成）

```
npm run typecheck && npm run lint
node scripts/check-core-no-brepjs.mjs
test ! -e packages/brepjs                     # 子包目录必须不存在（裁决 9）
grep -rn "@faicad/faijs-brepjs" --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir=docs --exclude-dir=.agents .  # 必须为空（文档/记录里的提及除外）
npx madge --circular packages/*/src
单包测试：core / sheetmetal / tests（brepjs 包已删、其测试随删；先跑相关层；只重跑失败用例；最后跑一次 pwsh -NoProfile scripts/ci.ps1）
```

## 7. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| op 自有化漏语义（keep/history/命名/roleTable/Result 映射） | 高 | §5.4 语义清单；`api/brep-mirror/*` 现成范式；G 分批小步走；测试不放宽 |
| **capability-map 失效导致静态分派错判**（旧方案未识别） | 高 | 每 op 自有化时同步重推条目；Phase 3 门禁卡 `entries` 数 = 35 且来源可溯 |
| **sheetmetal 缺 9 个 core 出口**（旧方案误判为「全覆盖」） | 高 | §5.8 补出口清单；裁决 3 先行 |
| **cq-compat 经 l3-bridge 与 core 间接耦合**（旧方案未识别） | 高 | §0.2 待裁决 3；裁决前不动 l3-bridge 对外签名 |
| **tests / demo 也是消费方**（旧方案误判为「零消费」） | 中 | §5.9；收口判据写进 Phase 4 验收 |
| **chain 自有化语义漂移**（解析解公式 / 拓扑调度 / DOF 表对不齐，伤 API 兼容性） | 高 | §5.6.2 逐项基线；删包前 parity 对拍；既有 chain 用例断言不放宽 |
| 默认求解风格被误改 = 行为变更 | 中 | 裁决 10 明令默认值一字不改；加「缺省 = chain」钉住测试 |
| 公开面收缩（删 dead generated）误伤包外消费方 | 中 | §0.2 待裁决 1；以 `api-surface-snapshot` 重拍基线为判据 |
| codegen 拆分不当导致 core 侧生成器仍依赖 brepjs | 中 | §2.6 按产物落点拆；Phase 4 验收加「core 侧生成器零 brepjs」 |
| 收编范围失控（把 211 方法接口搬进 core） | 中 | 裁决 8：core 只有 `BrepEngineApi`；Phase 2 验收卡「core 无第二套内核接口」 |
| **删包带走回归基线**（p3/p5 的 bug 复现用例随包删除） | 高 | §5.9 第 1 条：删前把断言对象仍成立的用例改写成 core 侧测试；逐文件过一遍，禁止整目录 rm |
| 根级配置漏清，构建/CI 仍指向已删包 | 中 | §5.9 第 5 条 5 处清单 + Phase 5 全仓守卫（`test ! -e packages/brepjs` + grep 为空） |
| 包外消费方断裂 | 已排除 | 实测该包从未发布（npm registry 返回 `Not found`）；cdn 两条为死登记，一并清除 |
| Result 双份实现漂移 | 中 | 同源复制 + 注释标注 + **删包前**完成 `packages/tests` parity 对拍（裁决 9 后无对照物，Phase 5 起只剩单向断言） |
| loft/sweep 重写几何行为偏差 | 中 | 照抄 brepjs fns 语义（含默认公差），测试基线不放宽 |
| core dist 残留 | 低 | 守卫查 `dist` |

## 8. 明确不做

- **迁移期间**不改 `packages/brepjs` 树内的 vendored 实现逻辑（上游 commit
  锁定；它只作语义参考源与测试对象）；**Phase 5 整包删除**（裁决 9），不留
  「降级保留 / 可选发布 / 兼容层转发」任何分支。
- **不把 vendored 的 211 方法 `KernelAdapter` 接口收编进 core**（裁决 8）。
- 不新增第二套内核抽象、不为兼容保留「临时转发」层。
- 不改 `.fai.js` 语法、`cad.*` 参数面、mesh 链行为。
- **不改装配求解器的默认风格、也不删除任一条路径**（裁决 10）：chain 与
  global 都是既有 API 面，缺省 chain 保持不变。
- 不在未获裁决前删 `api/generated` 的公开可达分片（§0.2 待裁决 1）。
- 不动被下游当公开面使用的 core 深路径（§5.7），除非先给替代落点。
- 不在本方案内执行 npm 发布（发布计划单独收口；但 Phase 5 的守卫/文档要为
  发布扫清障碍）。
- 不顺手重构无关模块；不放宽任何既有测试断言。

## 9. 工作量与工期估算（待 Phase 0 证据后重估）

| Phase | 内容 | 工期 |
|---|---|---|
| 0 | 核验 + op 盘点 + 最小闭包 + **全仓消费方盘点** + 公开面基线重拍 | 1~2 天 |
| 1 | Result/常量/视图内联 + 平铺面定落点 | 1 天 |
| 2 | hull 闭包 + 删桥 + 7 处消费方 | 1~2 天 |
| 3 | 35 op 自有化 + capability-map 重推（G1→G5） | 6~10 天 |
| 4 | generated 收口 + 装配面自有化（裁决 10）+ sheetmetal 改写 + tests/demo/cq-compat/根级配置收口 | 6~9 天 |
| 5 | **删 `packages/brepjs` 子包** + 守卫、文档、版本、weapp | 2 天 |
| **合计** | | **17~27 个工作日（待 Phase 0 复核）** |

复制量：§5.2 内联（result/errors ≈ 660 行）+ §5.1 最小 hull 闭包（待 Phase 0
测定）+ §5.6 装配面（`solverAdapter` 385 行、`jointFns` 464 行、`quaternion`
78 行，均按「移植 + 改线」处理，非照搬文件）。其余均为**重写/改线**，非复制。
新增工作量（相对旧方案）来自：9 个 sheetmetal 出口、cq-compat 安置、
**p3/p5 共 45 个 vendored 测试的搬迁与删除**、capability-map 重推、**删包与
根级配置 5 处收口**、**装配两条路径的自有化与 parity 对拍**。

## 10. 一句话结论

去掉 brepjs 中转层：**core 直连几何引擎（occt-wasm）自己实现全部 op**——
core 既有的 `createOcctPrimitives()` / `BrepEngineApi` 就是那个直连底座
（不是新建引擎），要做的是：拔掉它对 vendored 适配器的最后一处依赖（hull）、
删掉反向投影桥、把 35 个 compat op 逐个换成 core 自有实现并同步重推
capability-map、内联 Result/常量/视图、删掉 403 处死 generated 引用、
sheetmetal 改写为只依赖 core（需先在 core 补 9 个出口）、**装配两条求解路径
都留 core（chain 自有化，默认值不变）**、cq-compat 借入面按裁决收口。
**完成后 monorepo 内不存在 brepjs 子包**——
`packages/brepjs` 整体删除（裁决 9），brepjs 的独立形态在仓库外。core 零依赖
brepjs、功能不变。
