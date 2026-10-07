# brep-mirror 目录退役、术语清理与 compatOp 兼容面收缩方案

状态：已落地
日期：2026-10-07
落地：3 commit（b534970 Phase 1+2 改名+selfhost 退役、f5048c7 Phase 3 compatOp 收缩、d2b6725 Phase 4 文档）
依据：本会话用户澄清与调研结论（见 §0、§3.4）

## 0. 用户原话（逐字记录）

> "brep-mirror" 名字不合适，"compat/mirror"这个过渡性概念应该退役。brep-mirror这个目录，原本是从另外一个brepjs项目拷贝过来的，compat的意思是兼容brepjs项目的语义，现在我们不需要兼容brepjs的api，但是这些都是cad标准操作，语义保留。至于如何实现，请你写出一份合理的方案。

> 到底哪里还有 brepjs 形态的裸函数？我知道的唯一一个可能在用的就是sheetmetal子包。你去调研清楚。如果compatOp没有任何调用方，也要删除。

> 按选项 A，更新你的方案

## 1. 问题定性

`packages/core/src/api/brep-mirror/` 是本仓从早期 brepjs 项目拷贝、改造而来的 **BREP 实现目录**。它的名字与围绕它的叙事都建立在两个已失效的前提上：**`mirror`**（暗示"另一个项目的镜像"）与 **`compat` / `selfhost`**（`compat` 的真实含义是"兼容 brepjs 的语义"，`selfhost` 是 core-decouple 过渡期描述"实现已内化为第一方"的词）。

今天这些操作本身是**标准 CAD 操作**，语义必须保留；需要退役的只是命名与叙事。上一版方案把它误读成"按原子/组合复杂度做收编拆分"，方向错误。本方案纠正为：**命名与术语退役，实现体与生成机制不改**。

用户进一步要求核查 `compat` 概念的另一技术载体——`compatOp` 机制——是否还有真实用途。调研结论（§3.4）是：

- **`compatOp` 有活调用方**（`sheetmetal`、`faijs-gears` 两个裸函数库经 `registerLib` 提升），**不能整体删除**；
- **但真正的"brepjs 形态裸函数"在本仓已不存在**——所有库都是 faijs-native，`compatOp` 的 **brepjs 借入路径是死代码**。

因此本方案含两部分工作：**（一）目录与术语退役**（原目标）；**（二）`compatOp` 兼容面收缩（选项 A）**——删除死掉的借入分支与 `projectBrepOp`，把 `compatOp` 固定为 faijs-native 语义。

## 2. 目标与非目标

### 目标

1. `src/api/brep-mirror/` 退役，改为表达"faijs 第一方 BREP 操作实现"的中性名字；
2. `compat` / `mirror` / `selfhost` 三个过渡词，在目录名、`arg-spec` 字段、生成器注释、生成产物、代码注释、生效文档中一并清除；
3. **`compatOp` 兼容面收缩**：删除无消费者的 brepjs 借入分支（`borrowDeep` / `borrowBrepjsShape` / `createBorrowedHandle`）、死文件 `compat-projection.ts`、以及 `registerLib` 的 `borrow` 选项；
4. **目录改名部分行为零变化**：不改任何 op 的 `kind`、错误码、参数归一（D11）、引擎归属、命名、能力声明；
5. 公开 API 面与生成产物口径不变（cad 脚本面 95 op、`brep-op` 35 条、capability-map）。

### 非目标

- **不把 `compatOp` / `admitCompatLib` 整体删除**（选项 B）——它们仍是 `sheetmetal` / `faijs-gears` 裸函数进入脚本面的唯一通道；
- 不改 `src/brep/`、`src/occt-kernel/`、`src/brepjs-compat/`；
- 不拆 `joinery-brep.ts` / `straightSkeleton.ts`；不移动 `brepHelpers.ts`；
- 不把 `sheetmetal` / `faijs-gears` 改写为 `defineOp`（那是选项 B 的内容）；
- 不改历史 `docs/plans/` 文档。

## 3. 现状事实（2026-10-07 实测）

### 3.1 目录内容（13 文件）

| 文件 | 性质 |
|---|---|
| `booleanFns.ts` | 从 brepjs 迁移：fuse / section / split |
| `primitiveFns.ts` | 从 brepjs 迁移：torus / ellipsoid / makeBaseBox |
| `topologyFns.ts` | 从 brepjs 迁移：rotate / mirror / clone / applyMatrix / locate / shell / offset |
| `sweepFns.ts` | 从 brepjs 迁移：extrude / revolve / sweep / complexExtrude / twistExtrude |
| `patternFns.ts` | 从 brepjs 迁移：linear / circular / grid / rectangular pattern |
| `compoundFns.ts` | 从 brepjs 迁移：pocket / drill / boss / mirrorJoin |
| `healingFns.ts` | 从 brepjs 迁移：heal / simplify / autoHeal / fixShape / healSolid / fixSelfIntersection |
| `hullFns.ts` | 从 brepjs 迁移：convexHull |
| `roofFns.ts` | 从 brepjs 迁移：roof（编排） |
| `threadFns.ts` | 从 brepjs 迁移：thread（loft 螺纹） |
| `brepHelpers.ts` | 本仓共享工具：`brepHandleOf` + 3×4 仿射矩阵 |
| `straightSkeleton.ts` | **本仓自有**：直骨架纯 TS 算法（roof 的依赖） |
| `joinery-brep.ts` | **本仓自有**：榫卯 OCCT 布尔序列 |

> `joinery-brep.ts` 与 `straightSkeleton.ts` 并非从 brepjs 拷贝。新目录名必须同时覆盖"迁移来的标准 op 实现"与"自有算法实现"两类。

### 3.2 `arg-spec` 中的登记形态（`src/api/surface/arg-spec.ts`）

- `kind: 'brep-op'` 共 **35** 条，每条 `source: 'brep-mirror/<file>.ts#<fn>'` 且带 `selfhost: true`；
- `kind: 'query'` 中另有 **3** 条 `source: 'core:brep-mirror#<fn>'`；
- `selfhost: true` 字段共 45 处；`args` 文本含 "core selfhost" 10 处。

`selfhost` **是恒真且不被生成器读取的字段**（`gen-l3-surface.ts` 分支只判断 `kind`），纯过渡期标记。

### 3.3 引用面（`grep brep-mirror`，排除 dist/node_modules）

| 类别 | 位置 |
|---|---|
| **真实 import（本地）** | `api/brep-topology.ts:23`、`api/screw.ts:15`、`api/sweep.ts:23` |
| **真实 import（跨包，公开路径）** | `packages/faijs-extra/src/ops/fai_drill.ts:18`、`fai_split.ts:22` |
| **仅注释** | 各 `brep-mirror/*.ts` 文件头、`api/screw.ts:5`、`api/sweep.ts:4/13/40`、`api/internal/profile-wire.ts:13`、`packages/sheetmetal/src/geometryOps.ts:23` |
| **`arg-spec`** | 35 条 `source` 前缀 + 3 条 `core:brep-mirror` + 字段/注释 |
| **生成产物** | `api/generated/*.ts`（import + 注释）、`api/surface/capability-map.json`（`sourceFile`） |
| **生成器/脚本** | `gen-l3-surface.ts`（注释 5 处）、`gen-capability-map.ts:32`、`scan-occt-op-coverage.ts:244` |
| **测试** | `packages/core/test/api/brep-mirror/`（8 文件） |
| **文档** | `docs/api-contract.md:395` / `.zh.md:396`、`docs/ops-api-inventory.md` 及 `.zh.md` |

### 3.4 `compatOp` 链路调研（用户要求）

**调用链**：`compatOp` 唯一实际调用点是 `admit-compat-lib.ts:74`；`admitCompatLib` 唯一调用点是 `runtime.ts:475`（`registerLib` 内，`lift = options.autoLift ?? !hasDualOp(ns)`）。

**真实库注册分类**：

| 注册 ns | 来源 | dual-op? | 走 `admitCompatLib`? |
|---|---|---|---|
| `cad` | `createApiNamespace()` / `createEditorCadNamespace()` / draw / sketch / viewer | 是 | 否 |
| `sheet` | `@faicad/sheetmetal` | 否（裸函数） | **是** |
| `faijs-gears` | `@faicad/faijs-gears` | 否（裸函数） | **是** |
| 测试夹具 | `packages/tests/**`、`packages/core/test/**` | 视情况 | 是（测试） |

**两个真实裸函数库的形态**（均 **非** brepjs 形态）：

- `sheetmetal`：`src/geometryOps.ts:18` `import type {Shape, Vec3} from '@faicad/faijs/api'`，`translate(shape: Shape, offset: Vec3): Promise<Shape>` 收 **core Shape**；测试显式 `borrow: false`。
- `faijs-gears`：`src/index.ts:18` `import type {BrepHandle} from '@faicad/faijs'`，`spurGear(params, options): Promise<Result<BrepHandle, string>>`——纯数值参数、无 Shape 输入、输出 core `BrepHandle`。

**全仓 `grep` 证实**：依赖 `brepjs-compat` / 消费 `ShapeHandle` / `{wrapped}` 的代码**全部在 `packages/core/src` 内部**，没有任何 `packages/*/src` 库消费——**不再存在"brepjs 形态的裸函数"**。

**因此可判定的死代码**：

- `compat-projection.ts` **整文件无调用方**：`projectBrepOp`（`:75`）、`assertKernelBound`（`:40`）、`CompatProjection` 均无引用（仅注释提及）；
- `borrowDeep`（`compat-op.ts:83`）、`borrowBrepjsShape`（`l3-bridge.ts:126`）、`createBorrowedHandle`（`l3-bridge.ts:85`）**仅由 `compatOp` 的借入分支调用**，而两个真实库都不需要借入。

**必须保留的**（`compatOp` 仍有实际作用）：`admitCompatLib`、`compatOp`、`adoptEntity`（`BrepHandle` 输出收编）、`callBrepjs`、`unwrapResult`、`assertLibConforms`、`BorrowedShapeHandle` 接口（`adoptEntity` 仍消费其 `{wrapped}` 形态）。

### 3.5 生成器链路：数据驱动，逻辑零硬编码（关键事实）

生成器与扫描脚本**不硬编码 `brep-mirror` 子目录**，路径全部从 `arg-spec.source` 推导：

- `gen-l3-surface.ts`：`parseSource(source)` 取 `#` 前的 `file`，`renderImports` 生成 `import { fn as __own_fn } from '../${file}'`；`renderBrepOp` 生成 `defineOp({ brep: __own_fn, name, naming, capabilities, engines, … })`。
- `gen-capability-map.ts:32-34`：常量名 `BREP_MIRROR_ROOT` / `SELFHOST_ROOT` 的值都是 `src/api` 根，不指向 `brep-mirror/` 子目录。
- `scan-occt-op-coverage.ts:244`：`path.join(…,'src','api', file)`，`file` 取自 `arg-spec.source`。

**结论：目录改名只需改 `arg-spec` 的 `source` 字符串与各处注释，生成器/扫描器逻辑 0 行改动。**

## 4. 设计决策

### 4.1 新目录名：`src/api/brep-operations/`

`brep-operations` 直白表达"BREP 操作实现"，与 brepjs 源目录 `src/operations/` 词汇对应但去掉"兼容它"的含义；`brep-` 前缀与 `src/brep/` 词汇一致，并与生成分片 `api/generated/operations.ts` 明确区分。名字不含任何过渡词，且能覆盖目录内全部内容。

落选候选：`brep-ops`（与 `src/brep/brep-ops.ts` 撞名）、`brep-selfhost-ops` / `brep-compat-ops`（含退役词）、`brep-composed-ops`（"组合"是错误定性）、`brep-features`（feature 偏建模特征）、`cad-ops`（违反"cad 只属脚本面"纪律）。

目录内文件名不变。

### 4.2 保持实现形态与 `kind` 不变

35 个 `brep-op` 条目**全部保持 `kind: 'brep-op'`**，不移交手写 `defineOp`、不拆原子/组合。理由：`brep-op` 是中性词本不在退役范围；现机制（`renderBrepOp` 直连 + Phase 2.2 `naming` 守卫 + U7 反向基线护栏 + capability-map 静态实测）是有效护栏；用户需求是命名与概念退役，不是实现结构重构。

### 4.3 `source` 前缀迁移

- 35 条 `source: 'brep-mirror/<file>.ts#<fn>'` → `'brep-operations/<file>.ts#<fn>'`；
- 3 条 `source: 'core:brep-mirror#<fn>'` → `'core:brep-operations#<fn>'`。

改完后重跑生成器，产物 import 自动跟随。

### 4.4 `selfhost` 术语退役

删除 `arg-spec` 全部 `selfhost: true` 字段（45 处）与 `ArgSpecEntry.selfhost` 接口声明；`args` 文本中"（core selfhost）"改中性描述（10 处）；`gen-l3-surface.ts` / `gen-capability-map.ts` 注释同步。生成器从不读该字段，删除不改变任何生成语义。

### 4.5 文档叙事去 brepjs 化，语义契约保留

各文件头 "Self-hosted compat-op implementations … Semantics mirror brepjs …" 改为中性描述：**faijs 第一方 BREP 操作实现；操作语义遵循标准 CAD 约定（错误码/守卫不变）；不再声称与 brepjs API 兼容**。`docs/api-contract.md:395` / `.zh.md:396` 同步。

### 4.6 公开路径：一次性退役，不留别名

`packages/core/package.json` 有 `"./api/*"` 通配导出，故 `@faicad/faijs/api/brep-mirror/*` 是事实公开路径。按仓库既定立场（内部测试阶段不考虑 API 向后兼容）+ 用户"概念退役"要求，**不留旧路径别名**。

### 4.7 `compatOp` 兼容面收缩（选项 A）

**保留** `compatOp` + `admitCompatLib`（`sheetmetal` / `faijs-gears` 裸函数仍需要提升与输出收编），**删除**无消费者的 brepjs 借入面：

1. **删除 `api/internal/compat-projection.ts` 整文件**（`projectBrepOp` / `assertKernelBound` / `CompatProjection` 全无调用方）；
2. **`compat-op.ts`**：删 `borrowDeep`；删 `CompatSpec.borrow`；`buildAdapter` 去掉借入分支，固定"输入原样直传"；
3. **`l3-bridge.ts`**：删 `borrowBrepjsShape` 与 `createBorrowedHandle`；`BorrowedShapeHandle` 接口**保留**（`adoptEntity` 仍消费 `{wrapped}` 形态）；
4. **`admit-compat-lib.ts`**：删 `options.borrow` 参数与传递；
5. **`runtime.ts`**：删 `registerLib` 的 `borrow?: boolean` 选项（`:462`）与传递（`:475`）、相关注释（`:459`）；
6. `ports.ts:198`、`arg-spec.ts:95/1703/2060/2066/2069` 等注释中的 borrow 叙事清理。

**收益**：`compatOp` 语义从"两种形态"收敛为单一 faijs-native 语义，与两个真实库的实际形态一致；同时消除一个隐患——`runtime.ts:1249` 自动装载注册时**未传 `borrow`**，而 `demo` 经 `libLoader` 自动装载 `sheetmetal`（`packages/demo/e2e/demo.spec.ts:207`）时会落到默认 `true`，与测试里的 `borrow:false` 相反。删掉 borrow 后默认行为统一为直传，该不一致自动消失。

**边界**：`adoptEntity` / `callBrepjs` / `unwrapResult` / `assertLibConforms` / `l3-bridge` 的收编面 / `cadquery-selectors/borrow-bridge.ts` 的 `asBrepShape`（仍防御性处理外部传入的 `{wrapped}`）**保留**。

## 5. 实施步骤

### Phase 1 — 目录与数据改名（纯机械）

1. `git mv packages/core/src/api/brep-mirror packages/core/src/api/brep-operations`；
2. `git mv packages/core/test/api/brep-mirror packages/core/test/api/brep-operations`；
3. `arg-spec.ts`：35 条 `brep-mirror/` 前缀 + 3 条 `core:brep-mirror#` 改为新名；
4. 真实 import 同步：`api/brep-topology.ts`、`api/screw.ts`、`api/sweep.ts`、`packages/faijs-extra/src/ops/fai_drill.ts`、`fai_split.ts`；测试 8 文件 import；
5. 注释同步：`api/internal/profile-wire.ts`、`packages/sheetmetal/src/geometryOps.ts`、三个脚本注释；
6. 重跑 `gen-l3-surface` / `gen-capability-map` / `gen-ops-api-inventory`；
7. 验证：`lint` + 根/workspaces `typecheck` + `npm run test -w @faicad/faijs` + `node scripts/check-platform-imports.mjs` + 全仓 `grep brep-mirror`（排除 dist/node_modules/历史 plans）为 0。

### Phase 2 — `selfhost` 术语退役

1. 删 `arg-spec` 45 处 `selfhost: true` + 接口声明 + 注释；改写 10 处 args 文本；
2. 清理 `gen-l3-surface.ts` / `gen-capability-map.ts`（含常量名 `BREP_MIRROR_ROOT` / `SELFHOST_ROOT`）注释；
3. 重跑生成器，核对产物仅注释差异；
4. 验证：另加 `grep -i selfhost`（src/scripts/generated）为 0。

### Phase 3 — `compatOp` 兼容面收缩（选项 A，独立可回退）

1. 删 `api/internal/compat-projection.ts`；
2. `compat-op.ts`：删 `borrowDeep` / `CompatSpec.borrow` / 借入分支，更新文件头；
3. `l3-bridge.ts`：删 `borrowBrepjsShape` / `createBorrowedHandle`（保留 `BorrowedShapeHandle` 接口），更新文件头；
4. `admit-compat-lib.ts`：删 `options.borrow`；
5. `runtime.ts`：删 `registerLib` 的 `borrow` 选项与传递、注释；
6. 注释清理：`ports.ts`、`arg-spec.ts`、`api/extrude.ts`、`api/index.ts`、`index.ts`、`api-namespace.ts` 等处的 `compatOp(projectBrepOp(…))` / borrowDeep 叙事；
7. 测试：删 `packages/tests/faijs/compat-e2e/shape-borrow.test.ts`；各测试 `registerLib(…, {autoLift:true, borrow:false})` 去掉 `borrow:false`（`sheetmetal-flow.test.ts`×7、`aluminum-enclosure.test.ts`、`lib-error.test.ts`）；复核 `packages/core/test/api/cadquery-selectors/borrow-bridge.test.ts` 与 `_support/test-fixture-lib/` 是否依赖借入；
8. **删除前复核**：确认 `packages/cq-compat-compare` 与 `.env/probe/*`（`registerLib('cq', …)`）不依赖默认 borrow 的 brepjs 借入；（仓外 `@faicad/cq-compat` 若为 brepjs 形态则需另议——本仓无此消费者）；
9. 验证：`typecheck` + `lint` + `npm run test -w @faicad/faijs` + `npm run test -w @faicad/faijs-tests` + `npm run test -w @faicad/sheetmetal` + `npm run test -w @faicad/faijs-gears` + demo e2e（sheetmetal-demo）。

### Phase 4 — 文档

1. `docs/api-contract.md` / `.zh.md`（§395 及 §7.8 库准入）、`docs/ops-api-inventory.md` / `.zh.md`（生成物，重跑 `gen-ops-api-inventory`）、`docs/library-dev-guide.md` / `.zh.md`（若述及 borrow）更新；
2. 双语文档保持 LF；跑 `npm run doc-sync`（注意：`verify-translation-pairing` 存在预先 out-of-sync，勿把既存失配算作本次引入）。

### 提交纪律

Phase 1 / 2 / 3 各自独立 commit（均可独立回退）；文档与代码同 commit；commit/push 分别征求用户同意。

## 6. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | 改文件头注释破坏 `@platform occt` 标记，导致 `check-platform-imports.mjs` 失效/误报 | 只改描述性文字，逐文件保留 `@platform occt`；改后立即跑守卫 |
| 2 | `brepHelpers.ts` 的 `[brep-mirror] E_…` 错误文本被测试断言依赖 | Phase 1 前 grep；有则同批改 |
| 3 | 生成产物 / `capability-map.json` 残留旧路径 | 重跑全部生成器后全仓 `grep brep-mirror` 为 0（验收 1） |
| 4 | 跨包公开路径未同步，faijs-extra 构建失败 | Phase 1 第 4 步列全，改后 `npm run build -w @faicad/faijs-extra` |
| 5 | **仓外/测试存在 brepjs 形态库，删 borrow 后失效** | Phase 3 第 8 步复核 `cq-compat-compare` 与 probe；本仓已证实无消费者 |
| 6 | `_support/test-fixture-lib/` 或 `borrow-bridge.test.ts` 依赖借入语义 | Phase 3 第 7 步逐个核对；仅改测试语义，不改生产形状 |
| 7 | `joinery-brep.ts` 依赖 three，测试环境特殊 | 纯路径改名，不动内容 |
| 8 | 双语文档配对失配 | 统一 LF，跑 `doc-sync` pairing 门禁（区分预先失配） |

### 后续建议（本次不做）

`brepHelpers.ts` 是跨模块共享工具（`api/brep-topology.ts` 等非 op 模块也依赖），却位于"操作实现"目录内，依赖方向倒置。建议后续移至 `api/internal/` 中性位置。属结构重构，非本次命名退役目标。

## 7. 验收标准

1. 仓库（除 `docs/plans` 历史文档、`dist`、`node_modules`）`grep brep-mirror` **0 命中**；
2. `grep -i selfhost` 在 `packages/core/src`、`packages/core/scripts`、生成产物中 **0 命中**（历史 plans 除外）；
3. `src/api/brep-operations/` 文件集与改名前**逐一对应**（仅目录名变化，无增删）；
4. 生成产物 diff **仅路径/注释差异**——`defineOp` 的 `name`/`naming`/`capabilities`/`engines`/`outputs` 等参数逐条一致；
5. 公开面不变：cad 脚本面 95 op、`brep-op` 35 条、`capability-map` 条目与内核方法集合不变；
6. **compatOp 收缩后**：`compat-projection.ts` 已删；`borrowDeep` / `borrowBrepjsShape` / `createBorrowedHandle` / `registerLib` 的 `borrow` 选项均不存在；`sheetmetal`、`faijs-gears` 的注册与执行全绿；
7. `lint`（0 新 warning）、根 + workspaces `typecheck`、core + tests + sheetmetal + faijs-gears 全量 vitest、`check-platform-imports` / `check-ghost-deps` / `check-lockstep` 全绿；
8. demo e2e `sheetmetal-demo` 全绿（验证自动装载路径的 borrow 不一致已消除）。