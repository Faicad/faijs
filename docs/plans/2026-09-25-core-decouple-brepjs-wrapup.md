# 方案：brepjs 彻底剥离收尾（sheetmetal faijs 化 + Phase 5 归零）

状态：方案（待用户确认后实施）

> 现状事实以 2026-09-25 源码实测为准（复核命令随条给出）。
> 本方案是 `docs/plans/2026-09-25-core-decouple-brepjs-plan.md` 的**收尾修订版**：
> 前 4 个 Phase 已落地或接近落地，本方案只处理剩余部分（sheetmetal 改写 +
> 全仓收口 + 删包归零），并**修正执行中出现的方向偏差**（见 §0.1）。
> 执行前须通读 `AGENTS.md` 与 `docs/api-contract.md`。

## 0. 用户原话（2026-09-25 第二轮，需求原始记录，逐字）

> 你完全偏离了最初的设计呀最初的设计说的是本项目要彻底剥离bre pgs然后让
> sheet metal钣金库使用自己项目的fai js的api也就是说你应该改造的是钣金库不是
> 应该改造我们自己的代码去兼容brepjs而是让钣金库的api使用我们的风格完全搞反了
> 呀.就算要兼容bre pgs，那也应该是写一个独立的第三方兼容包，类似于cadquery的
> 这种兼容方式，在子包里兼容它的API风格，然后让钣金库用这个子包来开发，或者说
> 嗯，不需要动钣金库，直接依赖于那个子库

> 根据我刚刚的要求，以及这个项目的进展，你写一份新的开发方案收尾，最后的那些
> 部分把bre pjs彻底剥离

（注：以上为语音转写原文，含同音错字。方案作者澄清后的语义：

1. **最初设计**（与 09-25 原方案 §0.1 裁决 6/9 一致）：彻底剥离 brepjs；
   sheetmetal 钣金库改用**本项目 faijs 自己的 API**。
2. **方向纠正**：应该改造的是**钣金库**（让钣金库用 faijs 风格），不是改
   core 去兼容 brepjs 的 API 风格。执行中把「sheetmetal 补出口」做成了
   「core 内新增 brepjs 兼容面」，方向搞反（§0.1 详述与处置）。
3. **兼容的姿势**：若将来确实需要 brepjs API 兼容，也应是**独立的第三方兼容
   包**（类似 cq-compat / cadquery 兼容方式，在子包里兼容 brepjs 的 API 风格，
   让钣金库或其它消费方用这个子包开发；甚至钣金库无需改动、直接依赖该子库）。
   该兼容层**不属于 core、不属于本收尾主线**（§5 列为可选项）。
4. **本方案任务**：写一份新的收尾方案，把剩余部分（sheetmetal 改写 +
   tests/demo/cq-compat/守卫/根级收口 + 删包归零 + 文档统一收尾）做完，
   让 brepjs 从 monorepo 彻底消失。

若与用户本意有偏差，以用户原话为准。）

## 0.1 方向纠偏（相对 09-25 原方案 §5.8 的修正）

**原方案 §5.8 的立意是对的**：sheetmetal 改写为只依赖 core（裁决 6），core 按
裁决 3 补 sheetmetal 需要的出口。**执行中出现的偏差**：把「补出口」实现成了
「core 内新增一个 brepjs 兼容面」——

- 产物：`packages/core/src/api/brepjs-compat/topoSurface.ts`（约 435 行，
  符号名/返回形态/错误码逐项对照 brepjs 参考实现：`Result<number>` 测量、
  法文枚举 `SurfaceType`、brepjs 错误码 `WIRE_BUILD_FAILED` 等）。
- 问题：这等于**在 core 里再造一个 brepjs 兼容层**，违反裁决 9「brepjs 兼容
  层不由本 monorepo 提供」，也把「sheetmetal 用 faijs 风格」做成了「faijs
  迁就 brepjs 风格」——方向搞反。
- **处置（本方案第一条执行动作）**：删除 `topoSurface.ts` 及其在
  `api/index.ts` 的导出；sheetmetal 需要的查询/测量/构造能力改按 **faijs
  自己的风格**重新设计（§2.2），不复刻 brepjs 符号与形态。

**「faijs 风格」的实测判据**（本方案所有出口设计必须对齐，逐条复核）：

| 面 | faijs 现状（实测位置） | 形态 |
|---|---|---|
| 建模 op | `api/primitives.ts`、`api/boolean.ts`、`api/transform.ts`、`api/extrude.ts`（defineOp 包装） | **async** `(...args) => Promise<Shape>`，失败抛 `E_*` 错误 |
| 查询 | `api/geom.ts`（`faceNormal/bboxCenter/bboxMin/bboxMax`） | **同步**，`Shape` 进、直接返回 `Vec3` |
| 测量 | `api/generated/measurement.ts`（`measureVolume/measureArea/measureLength`）+ cad 面 `volume/area/length` | **同步**，`Shape` 进、直接返回 `number` |
| 有效性 | `api/generated/topology.ts` `isValid(shape): boolean` | 同步直接返回 |
| 底层底座 | `api/brep-mirror/*Fns.ts`（P3 自有化范式：`fuseBrep` 等） | 同步 `Result<BrepHandle>` + `kernelError/validationError` 错误码 + `getBrepApi()` |
| 组合子 | `api/index.ts` 平铺 `ok/err/isOk/isErr/unwrap/unwrapOr/Result`（core 第一方 result） | 同步 Result 组合 |
| 类型体系 | `shape.ts`：`Shape/SolidShape/CompoundShape/CurveShape/StdShape`、`fromBrep`/`fromBrepCurve` | faijs Shape 模型 |

**由此确定 sheetmetal 改写的主形态**（§2.3）：

- 建模链：用 faijs 公开建模 op（`box/cylinder/sphere/translate/fuse/cut/
  intersect/extrude`），`await` 化（消费方全部经 cad 脚本面调用——async
  执行器天然 await，见 §1.3，公共 API 改 async 无外部断裂）。
- 查询/测量/构造：用 faijs 风格出口（同步/直接返回或 Result 组合，见 §2.2）。
- 错误处理：faijs op 失败抛错 → sheetmetal 在公共 API 边界按 faijs 惯例
  表达（见 §2.3.3，具体形态由执行者按「与现有消费测试断言对齐」落地）。

## 1. 现状盘点（2026-09-25 实测）

### 1.1 已完成（09-25 原方案 Phase 0–3 + Phase 4 大部分）

| 项 | 状态 | 证据 |
|---|---|---|
| Phase 0 核验 / Phase 1 内联 / Phase 2 拔引擎耦合 | 完成 | `api/occt-kernel-bridge.ts` 已删、7 处消费方已改 |
| Phase 3：35 op 自有化 | 完成 | inventory §8：generated 全零 vendored、测量/拓扑 query selfhost |
| Phase 4 前半：generated 收口 + 装配面自有化（裁决 10） | 完成 | 装配 4 模块 selfhost、chain parity 对拍通过；core 151/151、装配 40/40、cq-compat 154/154、build 383 files |
| 提交 | 已完成两轮 | `9352c03`（剥离主体 143 文件）、`59b4304`（门禁债 + topologyFns 编码修复） |

### 1.2 未完成 / 执行中（本方案的处理对象）

| 项 | 状态 | 处置 |
|---|---|---|
| §5.8 sheetmetal 改写 | **中段，方向偏差** | §0.1 纠偏 + §2 重做 |
| §5.9 tests/demo/cq-compat/守卫脚本/根级配置 | 未开始 | §3 |
| Phase 5 删 `packages/brepjs` + 归零守卫 | 未开始 | §4 |
| 文档门禁统一收尾（export-jsdoc 358 处、pairing hash、方案状态流转、weapp 等） | 未开始 | 用户明确指令：**功能全部完成后统一处理**（§4.4） |

### 1.3 sheetmetal 消费方实测（公共 API 改 async 无外部断裂的依据）

`grep -rn '@faicad/sheetmetal' --include='*.{ts,json,md,html}' packages/`：

- `packages/tests/faijs/compat-e2e/sheetmetal-flow.test.ts`、
  `aluminum-enclosure.test.ts`：经 **cad 脚本面**消费（`createRuntime` +
  `createNodePorts` + `registerLib` 注册 sheetmetal 为扩展库，再跑 `.fai.js`
  脚本 `sheet.unfold(p1)` 等）。脚本执行器对库函数一律 `await`，函数 async 化
  对脚本面透明。
- `packages/demo/main.ts` L157：CDN 库包脚本面（`import * as sm from
  '@faicad/sheetmetal'` 后作库函数调用），同上透明。
- `packages/core/src/cad-runtime/browser-lib-loader.ts`：扩展库动态加载机制，
  不依赖 sheetmetal 函数签名形态。

结论：sheetmetal 公共 API 改 async 不影响现有消费方；测试断言可原样保留。

### 1.4 当前未提交改动（实测 `git status --short`，方案定处置）

| 文件 | 内容 | 处置 |
|---|---|---|
| `packages/core/src/api/brepjs-compat/topoSurface.ts`（新增） | brepjs 兼容面（方向错误） | **删除**（§2.1） |
| `packages/core/src/api/index.ts`（改） | 追加 `export * from './brepjs-compat/topoSurface'` | **回退该行**（§2.1） |
| `packages/sheetmetal/` 44 个文件（改） | import 源 `@faicad/faijs-brepjs` → `@faicad/faijs/api`；`test-setup.ts` 重写为 `initOcctWasm + registerOcctBrepEngine`；`package.json` peer 清、`vitest.config.ts`/`tsconfig.json` brepjs 条目清；`types.ts` Solid 别名 | **保留**（方向正确），按 §2 继续完成；其中 `@faicad/faijs/api` 子路径按 §2.2 落点微调 |
| 根目录 `rewrite-sheetmetal-imports.py`、`fix-sheetmetal-config.py`（新增） | 一次性改写脚本 | 保留在仓库根作复跑/参考（一次性工具，提交时一并记录） |
| `test-error-report-2026-09-25.md`（新增，未跟踪） | 用户临时文件 | **提交时排除**（`git reset --` 后不纳入） |

## 2. sheetmetal faijs 化改写（替代原 §5.8）

### 2.1 core 侧：删除 brepjs 兼容面（第一条执行动作）

1. `rm packages/core/src/api/brepjs-compat/topoSurface.ts`（目录 `api/brepjs-compat/`
   保留——其中 `index.ts`/`types.ts`/`planeTypes.ts`/`vecOps.ts` 等是 §5.2 已收编
   的 core 第一方组合子与工具，继续平铺在 `api/index.ts`）。
2. `api/index.ts` 删除 `export * from './brepjs-compat/topoSurface'` 一行及其注释。
3. 复核：`grep -rn 'topoSurface' packages/core/src` 为空。

### 2.2 core 侧：sheetmetal 所需能力的 faijs 风格出口（裁决 3 的落地）

**原则**：只补 sheetmetal 实测需要的、faijs 现在**没有**的能力；命名、返回
形态、错误表达全部对齐 §0.1 的 faijs 风格判据；**不复刻 brepjs 符号/形态**；
不建「兼容层」命名空间。

**A. 零新增（faijs 已有，sheetmetal 直接改用）**

| sheetmetal 现有符号 | faijs 落点（实测已公开） |
|---|---|
| `box/cylinder/sphere/translate/fuse/cut/intersect/extrude` | `@faicad/faijs/api`：`primitives/transform/boolean/extrude`（async `Promise<Shape>`） |
| `measureVolume/measureArea` | `@faicad/faijs/api`：cad 面 `volume/area`（同步 `number`） |
| `getBounds(x).xMax/zMin` | `@faicad/faijs/api`：`bboxMin/bboxMax/bboxCenter`（同步 `Vec3`，sheetmetal 侧组合成 Bounds3D） |
| `isValid` | `@faicad/faijs/api`：cad 面 `isValid(shape): boolean`（已有） |
| `vecAdd/vecSub/vecScale/vecDot/vecCross/vecLength/vecNormalize` | `@faicad/faijs/api` 平铺（已有） |
| `ok/err/isOk/isErr/unwrap/unwrapOr/Result/BrepError/validationError/kernelError` | `@faicad/faijs/api` 平铺（已有；`BrepError` 需补 `export type` 一行，见 B 备注） |

> 备注：`api/index.ts` 目前平铺了 `Result/Ok/Err/Vec3` 等，但 **`BrepError`
> 类型未平铺**（`api/brepjs-compat/index.ts:48` 有、`api/index.ts` 未导出）。
> sheetmetal `facade.ts` 用 `import type { BrepError }` —— 补一行
> `export type { BrepError } from './brepjs-compat'` 即满足（属第一方结果体系，
> 不是兼容层）。

**B. 需新增（faijs 风格，sheetmetal 实测缺）**

| sheetmetal 现有符号 | 缺失点 | faijs 风格落点（推荐形态，执行者按 §0.1 判据落地） |
|---|---|---|
| `isSolid(shape)` | 无 | 新增同步 `isSolid(shape: Shape): boolean`（引擎 `BrepEngineApi.isSolid` 直通；位置 `api/geom.ts` 或新 `api/query.ts`） |
| `getEdges/getFaces/getSolids(shape)` | 无 | 新增同步查询：`Shape` 进、`Shape[]` 出（引擎 `getSubShapes(shape, 'edge'\|'face'\|'solid')` 直通；边/面经 `fromBrepCurve`/`fromBrep` 包装成 faijs `CurveShape`/`SolidShape`，使 sheetmetal 拿到的子形状可直接再喂给 faijs op） |
| `getSurfaceType(face)` | 无 | 新增同步 `getSurfaceType(shape): SurfaceType`（`BrepEngineApi.surfaceType` 中立串直通；枚举值 faijs 命名，如 `'plane'/'cylinder'/'sphere'` 小写中立串——**不用法文**） |
| `curveStartPoint/curveEndPoint(edge)` | 无 | 新增同步查询，`Vec3` 直接返回（`curvePointAtParam` first/last） |
| `faceCenter/normalAt/pointOnSurface(face, pt)` | 无 | 新增同步查询，`Vec3` 直接返回（`surfaceCenterOfMass/surfaceNormal/pointOnSurface` 直通；`faceCenter` 输入为 getFaces 产出的 Shape） |
| `sharedEdges(a, b)` | 无 | 新增同步查询，`Shape[]` 返回（`sharedEdges` 直通 + 包装） |
| `outerWire(face)` | 无 | 新增同步构造，返回 `CurveShape`（occt 原生 `outerWire` 直通 + `fromBrepCurve`） |
| `isPlanarWire(wire)` | 无 | 新增同步判定，`boolean` 返回（引擎面法向一致性判定） |
| `wireLoop(edges)` | 无 | 新增同步构造，返回 `CurveShape`（`makeWire` + `fromBrepCurve`；错误按 faijs 惯例抛/err） |
| `line(a, b)` | 无 | 新增同步构造，返回 `CurveShape`（`makeLineEdge` + `fromBrepCurve`） |
| `face(wire)` | 无 | 新增同步构造，返回 `SolidShape`（`makeFace` + `fromBrep`——使 sheetmetal 的 `face(...)` → `extrude(profile.value, ...)` 链零适配） |
| `polygon(points)` | 无 | 新增同步构造，返回 `SolidShape`（`makeWire`+`makeFace` 直通 + `fromBrep`） |

**形态说明**（执行者按此落地，避免再滑回 brepjs 形态）：

- 上述新增出口全部**同步**（引擎调用均同步，先例 `faceNormal/measureVolume`）。
- 返回 `Shape` 家族（`CurveShape`/`SolidShape`）而非裸句柄：sheetmetal 的
  子形状（face/edge/wire）要直接喂回 faijs op（`extrude`、`fuse` 等吃 Shape，
  `brepOf` 自动提句柄）——**这是与 brepjs wrapper 面最大的形态差异，也是
  faijs 风格的本质**。
- 错误表达：查询/构造失败按 faijs 惯例——先用 `err(kernelError/validationError)`
  或直接抛 `E_*`，执行者按「sheetmetal 调用点改动最小」选一并在实现头注释
  记录；**不得引入 brepjs 错误码**（如 `WIRE_BUILD_FAILED` 等）。
- 命名空间：落 `api/geom.ts`（查询/判定）与 `api/brep-mirror/`（构造）或新建
  `api/query.ts`/`api/surface.ts`，由执行者按现有组织归位；**禁止再建
  `brepjs-compat/` 风格的新命名空间**。

### 2.3 sheetmetal 改写内容（操作清单，逐项验收）

1. **import 来源**：全部改到 `@faicad/faijs/api` 对应出口（44 个文件已改，按
   §2.2 落点微调 `BrepError` 与新增出口的 import 行）。
2. **建模链 async 化**：`authorFns/contourFlangeFns/cutoutFns/formFns/hemFns/
   jogFns/loftedFlangeFns/miterFns/reliefFns/tabFns/unfoldFns/validateFns/
   foreignUnfoldFns` 中 `box/cylinder/sphere/translate/fuse/cut/intersect/
   extrude` 调用加 `await`，外层函数改 `async`。
   - `fuse/cut/intersect` 返回 `Promise<Shape>`（faijs op 失败即抛）——
     sheetmetal 现有 `const r = fuse(...); if (!r.ok) return r;` 模式改为
     `try { const fused = await fuse(...) } catch { ... }` 或等价；**公共 API
     错误形态见 2.3.3**。
   - `cylinder(radius, height, { at, axis })`：faijs `cylinder` 是否吃
     `at/axis` 选项以源码为准（`api/primitives.ts` 的 defineOp schema）；
     若不吃，sheetmetal 侧组合 `cylinder(...) → translate(...)`（或用
     `rotate_euler` 对齐轴）——执行者按调用点最少改动落地并在测试钉住。
   - `rotate(s, angleDeg, { at, axis })`：faijs 无同名 op（有 `rotate_euler`），
     sheetmetal 侧自实现矩阵旋转（`applyTransform`/`transform` 或 brepHelpers
     `rotationMatrix` 已在 core 内）——执行者按调用点落地。
3. **公共 API 错误形态**（本方案推荐，执行者验证后锁定）：
   sheetmetal 公共函数（`authorPart/unfold/fold/...`）由「同步返回
   `Result<T>`」改为「async 返回 `Promise<Result<T>>`」——内部 `await` faijs
   op，失败 `catch` 后 `return err(...)`；类型层面 `Result` 沿用 core 第一方
   result。消费方（§1.3）全经脚本面/await，`Promise<Result<T>>` 不破坏既有
   断言。
4. **类型对齐**：`types.ts` 的 `Solid = SolidShape`（已改）保留；
   `Wire/Edge/Face/Bounds3D` 按 §2.2 出口类型（`CurveShape`/`SolidShape`/
   组合 Bounds3D）对齐——执行者逐文件过 typecheck。
5. **测试**：`src/*.test.ts` 中直接调用建模链的用例同样 `await`；
   `test-setup.ts` 已重写为 `initOcctWasm + registerOcctBrepEngine`
   （import 面 `@faicad/faijs/occt-kernel/occtKernel`、`@faicad/faijs/
   brep/engine/adapters/occt` 已核实为公开 exports 路径）——保留。
   `foreignUnfold.test.ts` 对 `@faicad/faijs/brepjs-compat` 的 import 改 local
   （原 §5.8 第 3 条，仍适用）。
6. **配置**：`package.json`（peer 已清）、`vitest.config.ts`（alias 已清）、
   `tsconfig.json`（paths 已清）——保留；`npm run typecheck -w @faicad/sheetmetal`
   与 `npm run test -w @faicad/sheetmetal` **全绿且断言不放宽**（原 §5.8 第 4 条）。

### 2.4 验收（§5.8 完成判据）

```
grep -rn '@faicad/faijs-brepjs' packages/sheetmetal   # 必须为空
npm run typecheck -w @faicad/sheetmetal && npm run test -w @faicad/sheetmetal  # 全绿，断言未放宽
npm run test -w @faicad/faijs-tests  # compat-e2e（sheetmetal-flow/aluminum-enclosure）全绿
```

## 3. 全仓收口：tests / demo / cq-compat / 守卫脚本 / 根级配置（沿用原 §5.9，状态更新）

原 §5.9 的 6 条全部适用，逐条列执行动作（执行者按顺序做完）：

1. **`packages/tests`**：
   - `p3-vendored-surface`（14）+ `p5-vendored-surface`（31）= 45 个 vendored
     面自身测试**随包删除**；删前把断言对象在 §5.4 自有实现下仍成立的
     真实回归用例（`sweepRepro/sweepSketchOrientation/boolean2dRegression/
     svgPathRegression/straightSkeleton/approximations` 等）**先改写成 core 侧
     测试**再删原文件（逐文件过，禁止整目录 rm）。
   - `d10-occt-single-instance`（1）+ 两个 `kernel-setup.ts`：按 §5.1 新语义
     重写（内核装配 = core 引擎直接可用）。
   - 其余 `@faicad/faijs-brepjs` 引用（122 处含非 vendored 面）逐条改 core
     出口或删除（按 §2.2 A/B 落点）。
2. **`packages/demo`**：`vite.config.ts:105` 的 brepjs alias 条目删除；
   收口判据 = demo 不再经 core 到 brepjs。
3. **`packages/cq-compat`**：9 处 `api/internal/l3-bridge` 借入面——
   按原 §0.2 待裁决 3：core 保留该借入面（内部已自有化，对外签名不动）或
   cq-compat 改写为直接调 core 出口；执行前把两案的测试影响对比给用户拍板
   （不阻塞 §2/§3.1，可并行）。
4. **`scripts/`**：
   - `check-vendored-branding.mjs`：并入 §4.1 新守卫后删除（或改写为
     「monorepo 内零 brepjs 子包 / 零包名引用」守卫）；
   - `check-layer-boundaries.mjs`：文件头旧路径
     `packages/core/src/vendored/brepjs/` 注释修正，vendored 段删除；
   - `publish-all.ps1` L79：`@faicad/faijs-brepjs` 项删除；
   - `check-workspaces-order.mjs` / `check-dep-lockstep.mjs` /
     `check-ghost-deps.mjs`：随 workspaces 数组变化同步；
   - `check-platform-imports.mjs` / `check-lib-layering.mjs` /
     `check-lib-src-language.mjs` / `verify-md-wrap.ts`：复核
     `packages/brepjs` 相关排除项。
5. **根级配置与发布通道（5 处，全部删除）**：
   - 根 `package.json`：`workspaces` 去掉 `"packages/brepjs"`（首项）+
     `build` 脚本去掉 `npm run build -w @faicad/faijs-brepjs` 首段；
   - `cdn/importmap.json` 第 3 行 brepjs jsdelivr 条目；
   - `cdn/versions.json` 第 2 行 `"@faicad/faijs-brepjs": "0.16.2"`（死登记）；
   - `packages/core/tsconfig.vendored.json` **删除**（include 指向已不存在的
     `src/vendored/brepjs/**`）；
   - `scripts/ci.ps1` L150-151/L155-156 与 `ci.sh` 对应段删除。
   - 已核实：删包不影响 `occt-wasm` 供给（core peer `^3.8.4` + 根
     `overrides` 锁单实例）。
6. **`packages/brepjs` 树本身**：Phase 5 整目录删除（§4.2，前置 = §2 + §3 完成）。

## 4. Phase 5：删包 + 归零守卫 + 文档统一收尾

### 4.1 新守卫 `scripts/check-core-no-brepjs.mjs`

- 范围：所有 `package.json`、各包 `src/`、`scripts/`、`cdn/`、根构建链
  （**排除** `node_modules`/`dist`/`docs`/`.agents/notes`——文档与决策记录的
  叙述性提及不构成依赖）。
- 命中 `@faicad/faijs-brepjs` 字样或 `packages/brepjs` 路径即失败。
- 接入 `ci.ps1` / `ci.sh` 门禁序列（承接 §3.4 对 `check-vendored-branding.mjs`
  的处置）。

### 4.2 删除 `packages/brepjs`

- 前置：§2（sheetmetal 改写）+ §3（全仓收口）完成、chain parity 对拍通过、
  §3.1 测试搬迁完成。
- 动作：整目录删除（按 AGENTS.md：目录删除必须移动进回收站，禁止
  `rm -rf` 式直接销毁）。
- 同步清根级 5 处（§3.5）。

### 4.3 删除 core 残骸与死代码

`api/occt-kernel-bridge.ts`（若 Phase 2 未删净）、删除后的 generated 分片、
临时 parity 对拍测试、`api/brepjs-compat/topoSurface.ts`（§2.1 已删）。

### 4.4 文档与元数据统一收尾（用户明令：功能全部完成后统一处理）

1. **export-jsdoc 门禁**（现行 358 处违规）：全部补 `@platform occt` 等头注释
   ——在 §2 新增出口落地后一次性补齐（新增文件带头注释，历史违规批量补）。
2. **translation pairing hash 重录**（`docs/i18n/`）：方案落地后统一重录。
3. **方案状态流转**：本方案与 09-25 原方案、09-24 方案标注状态
   （方案 → 实施中 → 已落地/已废弃 + 替代链接）。
4. `docs/ops-api-inventory.md` / `docs/api-contract.md` 同步（compat op
   实现来源 = core 直连 occt；sheetmetal 出口登记 faijs 风格）。
5. 版本号 bump（core）+ weapp 恢复纯 core tgz 依赖（撤临时 `file:` 行）+
   重建 worker + 探针回归。

### 4.5 验证总闸（Phase 5 末，全绿才算完成）

```
npm run typecheck && npm run lint
node scripts/check-core-no-brepjs.mjs
test ! -e packages/brepjs                     # 子包目录必须不存在（裁决 9）
grep -rn "@faicad/faijs-brepjs" --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir=docs --exclude-dir=.agents .  # 必须为空（文档/记录里的提及除外）
npx madge --circular packages/*/src
单包测试：core / sheetmetal / tests / cq-compat（先跑相关层；只重跑失败用例；最后跑一次 pwsh -NoProfile scripts/ci.ps1）
```

## 5. 兼容子包选项（可选，另行立项，不阻塞主线）

- **触发条件**：仅当 monorepo 外（或未来独立发布）确有消费方需要 brepjs 的
  API 形态（同步 wrapper 面、`ValidSolid` 视图、`Result<number>` 测量等）时，
  另行立项一个**独立兼容包**（cq-compat 模式：依赖 `@faicad/faijs` 公开面
  实现，在子包里兼容 brepjs 的 API 风格，让消费方用这个子包开发；甚至消费方
  无需改动、直接依赖该子库）。
- **本方案不执行**：本收尾主线的目标只是「monorepo 内彻底剥离 brepjs」；
  兼容包是否立项、由谁维护、放仓库外还是独立发布，待有真实消费方时另行决策。
- **已误建产物的再利用**：`topoSurface.ts`（§2.1 删除）的语义对照与引擎调用
  实测可作为未来该兼容包的**种子实现参考**（移到兼容包时按 brepjs 形态还原），
  但不属于本方案动作。

## 6. 执行规划（供第三方执行）

> 每个里程碑结束时 monorepo 必须处于：`npm run typecheck` 0 错、lint 0 错、
> 相关包测试全绿、可 build 的可交付状态。遵守 AGENTS.md：测试纪律（不跑 CI
> 找 bug、stderr 零容忍）、关键验证落测试、文档同 PR 更新（文档门禁按用户
> 明令最后统一处理，但新增代码的头注释/配对从落地起就合规）。

| 里程碑 | 内容 | 预估 |
|---|---|---|
| M1 | §2.1 删 topoSurface + §2.2 core 补 faijs 风格出口（含 `BrepError` 平铺）+ core typecheck/测试全绿 | 1~2 天 |
| M2 | §2.3 sheetmetal 全面 faijs 化（async 建模链 + 类型对齐 + 测试）+ §2.4 验收全绿 | 2~3 天 |
| M3 | §3 全仓收口（tests 搬迁 + demo + cq-compat 拍板 + 守卫 + 根级 5 处） | 2~3 天 |
| M4 | §4 Phase 5：新守卫 + 删包 + 死代码清理 + 文档统一收尾 + weapp + 验证总闸 | 1~2 天 |

提交纪律：沿用已授权的 `--no-verify`（用户已用两次），conventional commits
（英文），提交排除 `test-error-report-2026-09-25.md`（`git reset --`）。

## 7. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| sheetmetal async 化波及公共 API 与测试断言 | 中 | §1.3 实测消费方全经脚本面（await 透明）；断言不放宽 |
| 新增出口又滑回 brepjs 形态（Result 测量/法文枚举/brepjs 错误码） | 高 | §0.1 形态判据表 + §2.2 形态说明；实现头注释记录；review 对照判据 |
| `cylinder/rotate` 等 faijs op 无 brepjs 选项（at/axis）需组合实现 | 中 | §2.3.2 组合策略 + 测试钉住几何结果（与现有断言对拍） |
| 删包带走回归基线（p3/p5 真实 bug 复现用例） | 高 | §3.1 逐文件搬迁先于删除，禁止整目录 rm |
| cq-compat 经 l3-bridge 间接耦合未裁决 | 中 | §3.3 两案对比交用户拍板，不阻塞主线 |
| 文档门禁后置导致 PR 无法合入 | 低 | 用户明令最后统一处理；新增代码从头合规 |
| 未提交改动处置出错（误提交用户临时文件 / 误删正确改写） | 中 | §1.4 处置表；提交前 `git status` 复核 |

## 8. 明确不做

- **core 不提供 brepjs 兼容层**（裁决 9）：不建 `brepjs-compat` 风格的新
  命名空间，不复刻 brepjs 符号/形态/错误码。
- **不做「sheetmetal 依赖 brepjs 扩展包」的过渡方案**（裁决 6/9）：monorepo
  终态没有 `packages/brepjs`。
- **不提前做文档门禁**（用户指令）：export-jsdoc/pairing hash/方案状态流转等
  在功能全部完成（M1–M3）后统一处理（M4）。
- **不新建兼容子包**（§5）：无真实消费方前不立项，不占本收尾主线。
