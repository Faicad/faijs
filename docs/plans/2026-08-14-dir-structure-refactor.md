# 目录结构重构计划

> 日期：2026-08-14
> 性质：开发计划。目标：收敛 `src/` 目录混乱，消除新旧架构并存与死代码，修复失效文档引用。
> 原则：**每阶段独立可验证**（`pwsh -NoProfile scripts/ci.ps1`），行为零变化优先，删文件逐个确认。

---

## 1. 现状问题清单（全部有证据）

### A. L1 执行层结构错位（核心混乱，本计划的主目标）

**现状**：L1 执行层被切成了三个语义不对齐的目录：

| 目录 | 实际内容 | 问题 |
|---|---|---|
| `src/brep/ops/` | **整个 L1 的双路径执行分派层**：`dispatcher.ts` + 每 op 一个 `executeXxx(ctx)`（内部在 BREP/mesh 间静态选择）+ `geom-ref.ts` + `OpContext` | **名不符实**：它不是 brep 专属操作，17 个分派文件全部 import `mesh-ops` 实现库（brep/ops/boolean.ts:20 等）；`ops.test.ts` 自述 "Operation dispatcher"。只因先有 brep 链后有分派器，才被塞在 `brep/` 下 |
| `src/mesh-ops/` | 旧 cad-core 库：mesh 纯函数实现（primitives/boolean/split/drill/engrave/transform/query/io + `knurl/` + `drill-hole/`）**混着 BREP 内容**（`primitives-brep.ts` 的 boxBrep 等、`brep-ops.ts` shim）+ 生成文件 `api.d.ts` | **名字无意义**：既不是纯 mesh 后端（含 BREP 内容），也不是旧名 cad-core；`index.ts` 头注释仍自称 cad-core（mesh-ops/index.ts:2），`cad-core.test.ts` 旧文件名残留 |
| `src/brep/`（根） | BREP 后端实现：brep-chain / brep-ops（652 行真身）/ brep-utils / svg / text / operations | 本应干净，但被 ops 分派层占了地盘 |

**错位证据链**：`src/index.ts:51-57` 绕道 `mesh-ops/brep-ops.ts`（31 行 deprecated shim）导入真实实现 `src/brep/brep-ops.ts`；`src/mesh-ops/index.ts:43-47` 暴露 `boxBrep` 等 BREP 基本体——**mesh-ops 目录内同时装着 mesh 与 brep 两家的东西**。

### B. 目录内杂物与死代码

| # | 问题 | 证据 |
|---|---|---|
| B1 | `src/brep/ops/` 混入与 op 分派无关的文件：`face-evolution.ts`（BREP 面演化，被 boolean/transform 分派器使用）、`svg-asset-resolver.ts`（被 engrave/svgExtrude 使用） | `src/brep/ops/boolean.ts:20`、`src/brep/ops/engrave.ts:19` |
| B2 | `src/brep/operations/`（brepjs 镜像：joinery-brep/threadFns）与 `src/brep/ops/` 并存，**单复数命名不统一** | `src/brep/index.ts:8` |
| B3 | `src/brep/svg/svgBlueprints.ts`、`src/brep/text/textBlueprints.ts` 沿用旧 "blueprint" 概念名，与 `src/primitives/svg-extrude.ts` / `text-geometry.ts`（mesh 对应物）命名不对称 | `src/brep/ops/engrave.ts:14-15` |
| B4 | `src/runtime/` 孤岛：`env.ts`（`isWebRuntime`）**全库零引用**，疑似死代码；`blob-store.ts` 仅被测试使用 | `rg isWebRuntime` 无命中；`src/brep/ops/load.test.ts:59`、`split.test.ts:24` |
| B5 | `src/test/` 只放 fixtures，与根 `test/` 职责重叠 | `src/test/fixtures/` |
| B6 | 字体三份重复：`src/assets/fonts/OpenSans-Regular.ttf`（代码声明"唯一真源"）、根 `assets/fonts/`（git 已跟踪）、`demo/assets/fonts/` | `src/node-host/node-font-provider.ts:21`；`git ls-files` |

### C. 文档与注释失效

| # | 问题 | 证据 |
|---|---|---|
| C1 | 9+ 处源码注释引用**不存在**的 `docs/faijs-engine-refactor-design.md` | `src/cad-runtime/{index,ports,runtime}.ts`、`src/node-host/*`、`src/boolean/csg-core.ts`、`src/sdf/sdf-core.ts` |
| C2 | 文档间引用旧文件名：`faijs-syntax-design.md`（实际 `syntax-design.md`）、`code-engine-api-contract.md`（实际 `api-contract.md`） | `docs/ops-api-inventory.md:10`、`docs/api-contract.md:403` |
| C3 | `docs/architecture.md` 空占位文件 | — |
| C4 | 大量注释残留旧仓库名 `3d_editor`、旧路径 `src/renderer/engine/` | `src/browser-host/*`、`src/primitives/text-geometry.ts:82`、`src/boolean/csg-core.ts` |
| C5 | `docs/plans/2026-08-13-ui-record-faijs-engine.md` 是跨仓库（3d_editor）调研计划，与本仓库代码计划混放 | 文件内容 |

### D. 其它

| # | 问题 | 证据 |
|---|---|---|
| D1 | `src/node-host/index.ts` 带 UTF-8 BOM（全库唯一） | 文件首字符 `\uFEFF` |
| D2 | `.gitignore` 残留旧仓库条目：`src/renderer/public/env/*.hdr`、`pages/.vitepress/`、`benchmark/`、`resources/`、`.workbuddy`、`scripts/time_ci.sh.txt`、`todo2*.txt`、`*.exr`、`diag*.png` 等 | `.gitignore` |
| D3 | CLI 测试产物直接落在 `test/` 根目录（`tmp-box.step` 等，已 gitignore，可改输出到系统临时目录） | `test/` 目录 |

---

## 2. 目标结构

**L1 执行层三块各司其职**（本次重构的核心）：

```
src/
├── lang/            # L0 文本层（parser/codegen/args-schema）              —— 不动
├── ops/             # L1 执行分派层：dispatcher + 每 op 一个 executeXxx    ← 从 brep/ops/ 上移
├── brep/            # L1 BREP 后端实现：brep-chain / brep-ops / svg / text  —— 收敛内部
├── mesh/            # L1 mesh 后端实现：cad 纯函数 API + knurl + drill-hole ← 从 mesh-ops/ 更名
├── primitives/      # 基本体/文字/SVG 生成（L1 共享地基：brep 与 mesh 都用）  —— 不动
├── boolean/         # CSG/boolean 辅助                                      —— 不动
├── sdf/             # SDF 求值                                              —— 不动
├── topology/        # 拓扑/面选择                                           —— 不动
├── occt-kernel/     # OCCT wasm kernel 单例                                —— 不动
├── cad-runtime/     # L2 编排（CadRuntime + HostPorts）                    —— 不动
├── node-host/       # L3 Node host                                          —— 不动
└── browser-host/    # L3 Browser host                                       —— 不动
```

**依赖方向**（单向，禁止反向）：

```
ops (分派) ──▶ brep（BREP 后端）＋ mesh（mesh 后端）
brep、mesh ──▶ primitives / occt-kernel（共享地基）
mesh ──▶ boolean / sdf（mesh 专属地基）
```

**`src/primitives/` 是共享地基，不属于任何一方**（已实证，非待决策）：`geometry.ts` 被 brep/ops 与 mesh-ops 双方引用（brep/ops/{engrave,extrude,drill,knurl,split,transform}.ts）；`primitiveToCad.ts` 是纯 brep 侧（brep/ops/primitives.ts、mesh-ops/primitives-brep.ts）；`screw-db.ts` 两家共用（brep/operations/threadFns.ts）。地位与 `occt-kernel/` 相同——mesh 与 brep 的公共地基。内部文件按服务对象分 mesh 侧 / brep 侧，但**该层保持原位、不并入任何一家**。

**待决策命名**（实施前确认）：

1. 分派层：`ops/`（推荐，与 op 白名单呼应）vs `engine/`（旧仓库该词指 script-engine，易混）vs `exec/`。
2. mesh 后端：`mesh/`（推荐，与 `brep/` 完全对称）vs `cad-mesh/`（保留 cad 语义）。

**命名约定（本计划确立，重构后生效）**：

- `cad` 词根只保留给 `.faijs` API 对象（`cad.*`，mesh 语义）——不再用作几何实现层的名字（`primitiveToCad` / `cad-core` / `cadSolidToStep` 均属此类，见 P3）。
- L1 实现层按 `brep` / `mesh` 词根对称命名：底层 `brep-primitives.ts` ↔ `mesh-primitives.ts`；包装层 `primitives-brep.ts`（boxBrep）↔ `primitives.ts`（box）。

---

## 3. 分阶段实施

> 每阶段结束跑全量 CI：`pwsh -NoProfile scripts/ci.ps1`（lint → typecheck → vitest + stderr 零容忍）。
> 涉及删除的文件先逐个确认（仓库铁律：禁止无差别还原/批量删除）。

### P0 基线（0.5h）

1. 确认当前 `pwsh -NoProfile scripts/ci.ps1` 全绿，记录 git 状态作为基线。

### P1 删死代码与 shim（低风险，行为零变化）

1. 删除 `src/mesh-ops/brep-ops.ts` shim；`src/index.ts`、`src/browser.ts` 改从 `src/brep/` 直接导入（`src/brep/index.ts` 已导出全部同名符号，纯路径改写）。
2. 删除 `src/runtime/env.ts`（零引用，先跑 rg 复核）。
3. 删除根 `assets/fonts/OpenSans-Regular.ttf`（真源在 `src/assets/fonts/`；确认无代码引用根路径后删）。
4. 清理 `.gitignore` 陈旧条目（D2）。
5. **验证**：CI 全绿；`rg "mesh-ops/brep-ops" src` 无残留。

### P2 L1 结构归位（本次重构的主步骤，机械改名，行为零变化）

1. **`src/brep/ops/` → `src/ops/`**（决策后定名）：
   - 移动 dispatcher / types / geom-ref / 各 executeXxx / svg-asset-resolver。
   - 更新所有 import：`brep/ops/...` → `ops/...`（涉及 src/index.ts、browser.ts、test-helpers.ts、各测试）。
   - 与 op 分派无关的 `face-evolution.ts` 移入 `src/brep/`（B1）。
2. **`src/mesh-ops/` → `src/mesh/`**（决策后定名），并拆出 BREP 内容：
   - `primitives-brep.ts`（boxBrep 等）→ `src/brep/`（brep 基本体后端）。
   - 保留：cad API 组装（index.ts）+ 各 mesh 实现 + `knurl/` + `drill-hole/`。
   - 同步 `scripts/gen-api-dts.ts` 输出路径（`src/mesh/api.d.ts`）并重跑。
   - `cad-core.test.ts` 随目录更名。
3. 更新 `src/index.ts` / `src/browser.ts` / `src/node.ts` / `src/csg.ts` / `src/sdf.ts` 的导出路径。
4. 更新 AGENTS.md 架构段（L1 三层描述）。
5. **验证**：CI 全绿；`rg "brep/ops|mesh-ops" src scripts` 无残留；`npx tsx scripts/faijs-cli.ts check` 冒烟跑一个 fixture。

### P3 目录内收敛（中等风险，只挪不重写）

1. `src/brep/operations/` → 更名 `src/brep/brepjs-mirror/`，并在 `src/brep/index.ts` 注明「镜像 brepjs，勿手改核心算法」。
2. `src/brep/svg/svgBlueprints.ts` → `svg-to-solid.ts`；`src/brep/text/textBlueprints.ts` → `text-to-solid.ts`（同步更新 4 处 import）。
3. **primitive 两套实现对称命名**（用户 2026-08-14 反馈——`primitiveToCad.ts` 名不符实：它产出的是 OCCT brep solid，而本仓库 `cad` 词根专指 `.faijs` 的 `cad.*` API（mesh 语义））：
   - `src/primitives/primitiveToCad.ts` → `brep-primitives.ts`。
   - `src/primitives/geometry.ts` → **`mesh-primitives.ts`**（与 brep 侧完全对称；被 25+ 处引用——index/browser、brep/ops/*、mesh-ops/*、boolean/*、topology/*、occt-kernel/*，机械替换 import 路径）。
   - 导出改名：`primitiveToCadSolid` → `primitiveToBrepSolid`、`PrimitiveToCadResult` → `PrimitiveToBrepResult`、`geometryToCadSolid` → `geometryToBrepSolid`、`cadSolidToStep` → `brepSolidToStep`、`primitiveToStep` → `primitiveToBrepStep`；`extractMeshData` 不动（通用工具）；mesh 侧 `makePrimitiveGeo` / `mergeBufferGeometries` 函数名不动（语义已清晰，非 brep/cad 词根）。
   - 同步调用处：`src/brep/ops/primitives.ts:10,44`、`src/mesh-ops/primitives-brep.ts:23,66`、`src/index.ts` / `src/browser.ts`（re-export 与类型名）。
   - **对称结果**：底层实现 `mesh-primitives.ts`（makePrimitiveGeo）↔ `brep-primitives.ts`（primitiveToBrepSolid）；API 包装层 `primitives.ts`（cad.box）↔ `primitives-brep.ts`（cad.boxBrep）。
4. `src/runtime/blob-store.ts` → `src/test/`（测试工具与源码分离；`src/runtime/` 整体删除）。
5. `src/test/fixtures/` → 合并进 `test/faijs/fixtures/`（fixtures 统一放根 `test/`）。
6. **验证**：CI 全绿；`rg "primitiveToCad|cadSolidToStep" src` 无残留。

### P4 注释与文档清扫

1. 清扫旧路径注释（C4）：`src/renderer/engine/`、`3d_editor` 引用改为当前路径或删除。
2. 测试文件头部过时注释（"Run: npx vitest run src/renderer/..."）更新为当前路径。
3. `src/node-host/index.ts` 去除 BOM（D1）。
4. **验证**：CI 全绿；`rg "cad-core|renderer/engine" src` 命中归零（文档除外）。

### P5 文档修复（随功能 commit，不单独提交）

1. **C1 决策**（需用户确认）：批量把 9+ 处 `docs/faijs-engine-refactor-design.md` 引用替换为 `docs/plans/` 对应计划，或新建该文档补全设计史。
2. 修复 C2：`ops-api-inventory.md:10`、`api-contract.md:403` 的旧文档名引用。
3. `docs/architecture.md`：补一份真实架构总览（或删除，AGENTS.md 已含架构速览）。
4. `docs/plans/2026-08-13-ui-record-faijs-engine.md`：文件头标注「跨仓库（3d_editor）调研计划」，或移出 plans/。

---

## 4. 下游影响分析（已实证）

**下游清单**：`demo/`（`file:..` 引用）+ `C:\my\Faicad\3d_editor`（`node_modules/@faicad/faijs` 为 **junction 直连本仓库源码**，无 dist，改动即时生效）。

**公共 API 面**：`package.json` exports map 只暴露 5 个入口（`.`、`./browser`、`./csg`、`./sdf`、`./node`），无子路径导出——内部目录改名（`brep/ops`→`ops/`、`mesh-ops`→`mesh/`）对外**不可见**，只要入口 re-export 同名符号即可。

**逐项影响**（已用 rg 实证 3d_editor 全部 import）：

| 计划改动 | 3d_editor / demo 是否受影响 |
|---|---|
| P1 删 `mesh-ops/brep-ops.ts` shim | 无感：`BREP_NATIVE_OPS`/`MESH_ONLY_OPS`/`initBrepChainState`/`releaseBrepChainState`/`lastSolidOfChain` 改由 `src/brep/` 直接 re-export，符号名不变 |
| P2 目录改名 | 无感：入口文件内 import 路径变化，导出不变 |
| P3 `primitiveToCadSolid` 等 5 个导出改名 | **零破坏**：3d_editor / demo 均未 import 这 5 个符号（已实证） |
| P3 `geometry.ts` → `mesh-primitives.ts` | 无感：`makePrimitiveGeo`/`DEFAULT_SIZE`/`applyPrimitiveOffset`/`mergeBufferGeometries` 符号名不变，仅模块路径变 |
| P3 `svgBlueprints`/`textBlueprints` 改名 | 无感：非公共导出（index.ts 未 re-export） |

**义务**：每阶段 CI 全绿后，在 3d_editor 仓库跑一次 `npm run typecheck`（或 build）验证 junction 链路；执行改名步骤前用 `rg "primitiveToCad|..." C:\my\Faicad\3d_editor\src` 复核一遍（防止执行期间 3d_editor 新增引用）。

---

## 5. 风险与铁律

- **铁律**：所有 git 操作（含删除/改名后的 add）必须经用户确认；删除文件逐个确认，禁止批量还原。
- 改名与移动**不改任何行为**：只动 import 路径与文件名；任何「顺便重构」的代码改动禁止混入本计划。
- P2 是机械改名，建议用脚本批量替换 import 后再人工核对 diff，避免手滑漏改。
- 每阶段独立成 commit（conventional commits，如 `refactor(ops): move dispatcher out of brep/`），便于回退。
- 文档改动（docs/）必须随相关功能 commit 一起提交。
- 若 CI 在 P1/P2 后出现未预期红（如隐藏的 shim 依赖），先 `git log` 定位最近改动，再逐文件排查——不执行任何 reset/restore。