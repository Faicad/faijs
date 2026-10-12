# STEP 导出丢「compound 中的游离面」——faijs core 修复计划

> 状态：**待实施**（本文是计划，不含实现代码；所有行号与事实已对 monorepo 当前源码核验，日期 2026-10-08）。
> 范围：`packages/core`（`brep/export/step.ts` 一处），外加回归测试与联合验证。
> 触发来源：`cq-compat` 重估 §3.2 的 `test_sewing__res3`（标签 `export:free-face-in-compound`）。
> 说明：本文以当前源码 + 实测探针为依据，不以任何历史 plan 作为现状依据。

---

## 1. 缺陷现场

`cq-compat` 的 `test_sewing__res3`：对一个开口盒的 5 个面 + 被移除的顶 + 顶平移到 x=+1 的帽面共 **7 个面**做 sewing，内存里的结果是 **f7/e16/v12**，与上游（OCP）逐位一致。导出 STEP 后只剩 **6 个 `ADVANCED_FACE`**——被丢的正是那个游离帽面。

上游 ref STEP 的结构对照（`out/ref/tests.test_free_functions___test_sewing__res3.step`）：

| STEP 实体 | 数量 | 归属 |
|---|---|---|
| `SHELL_BASED_SURFACE_MODEL` | **2** | 两个独立 label |
| `CLOSED_SHELL` | 1（6 面） | 开口盒 + 顶盖缝出来的那个壳 |
| `OPEN_SHELL` | 1（1 面） | 平移到 x=+1 的帽面，被单独包成 shell |
| `ADVANCED_FACE` | **7** | — |

`cq-compat-compare` 的 `compareStepFiles` 按 f/e/v 拓扑计数 + 体积 / 质心 / bbox / 布尔对拍，丢一面直接判 FAIL。

---

## 2. 根因：形状类型分派是**级联短路**，不是逐子形状分派

位置：`packages/core/src/brep/export/step.ts:93-110`，`exportStepFromSolids()` 每个 entry 的处理：

```ts
let subs = kernel.getSubShapes(solid, 'solid')   // :93
if (subs.length === 0) subs = kernel.getSubShapes(solid, 'shell')  // :95
if (subs.length === 0) subs = kernel.getSubShapes(solid, 'face')   // :98
if (subs.length === 0) subs = kernel.getSubShapes(solid, 'edge')   // :101
if (subs.length === 0) subs = [solid]            // :103-110 整体写入兜底
```

**整个 entry 只选一个层级**，首个非空者胜出。`res3` 的 sew 产物实测各层计数：

| `getSubShapes` 层级 | 数量 | 分派结果 |
|---|---|---|
| `solid` | 0 | 空 → 继续 |
| `shell` | **1** | **非空 ⇒ 在此短路** |
| `face` | **7** | 永不看 |
| `edge` | 16 | 永不看 |

命中 `shell` 后 `subs` 只有那 1 个壳（6 面），写入 1 个 XCAF label（`step.ts:111-126`，`doc.addShape` 在 `:125`）。**与它平级的那 1 个游离 face 拿不到任何 label。**

同一缺陷的反面 WITNESS（也是定位它的关键旁证）：**为什么 `compound(face, face)` 反而不丢面**？因为那种输入 solid/shell/face/edge 各层全取 0，落到 `:103-110` 的 `subs = [solid]` 兜底，整个 compound 作为单一 label 交给 XCAF，两个面都在。所以这不是「复合体只能写一份」，就是级联短路。

**顺带需修正的过期注释**：`step.ts:104-108` 称「wasm `getSubShapes` 不展开 compound 层（`TopExp_Explorer` 默认跳过），纯面/壳/边 compound 拿不到子形状」。实测在 sew 产物上 `getSubShapes('face')` 返回 7、`('shell')` 返回 1，**是穿透 compound 的**。该注释与实际不符，本次连同代码一起改写。

---

## 3. 为什么不能在本仓（cq-compat）绕过

在上游用 `TopoDS_Builder.MakeShell + Add` 把散面单独包成一个 shell。这条路在本仓不存在：

| 通道 | 实测结果 |
|---|---|
| `sew([face])` | 原样返回 **face**（不是 shell） |
| `buildSolidFromFaces([face])` / `sewAndSolidify([face])` | 同样返回 **face** |
| `makeSolid(face)` | 抛 `TopoDS::Shell` |
| 内核含 shell 的 API 全表 | 仅 `isShell`、`shell`（抽壳 offset）、`shellWithHistory`、`sweepPipeShell`——**没有任何构造 shell 的入口** |

⇒ 缝得对、包装不了，缺陷只能回到 core 的导出分派层修。

---

## 4. 目标与非目标

**目标**：一个 entry 的形状里，**未被任何已写入的 shell/solid 覆盖的面，也必须写进 STEP**。

**非目标（硬性红线，不许碰）**：

- 不做 fuse（文件头 `step.ts:7-9` 的约定：`fuse` 只允许出现在用户脚本的布尔运算里，禁止作为导出侧的合并手段）。
- 不改 XCAF 多实体「一个 label = 一个 PRODUCT」的总体结构。
- 不改现有 `name [n]` 展平命名约定（`step.ts:115-117`），既有用例 `step-export.test.ts:141` 依赖它。

---

## 5. 候选方案与判据

| # | 方案 | 关键依赖 | 可行性 |
|---|---|---|---|
| **A（推荐）** | **保留级联 + 自由面补齐**：走到 `shell` 层后额外取 `getSubShapes(solid,'face')`，筛出不属于任何已选 shell 的面，追加进 `subs` | `getSubShapes` + `isSame` | 两个 API 均已声明（`primitives.ts:208/211`）且已实现（`occt-primitives.ts:346`）；`getSubShapes` 还在 OCCT 能力表白名单内（`adapters/occt.ts:153`） |
| B | 枚举 compound 的直接 children，每个 child 各自走一遍级联 | 内核 children 枚举 | **不可行**：`occt-wasm` 只暴露 `isCompound` / `makeCompound`，无 `getChildren` / `explode` 类通道 |
| C | 检测到存在自由面时，放弃分派，改为整体 `addShape(compound)` 交给 XCAF | XCAF 对混合 compound 的写出行为 | **待探针 P1 验证**：若 XCAF 能把 compound 内的 shell 与 face 都展开写出，则 C 更简单；否则走 A |
| D | 在 core 新增「face → open shell」的内核 op | 新 API surface | 远期备选，牵扯 capability 表 + `OCCT_METHOD_KINDS` + `verify-export-jsdoc`，**不在本轮** |

**选择规则**：先做 P1、P2 两个探针。P1 通过即取 C（更少代码、语义更贴近 XCAF 原生）；否则取 A。两条都不理想才回头评估 D。

---

## 6. 探针任务（实施前必做，结论入档）

| # | 命題 | 判据 |
|---|---|---|
| **P1** | XCAF `addShape` 直接吃 `compound(shell(6面), face)` 时，是否 7 面全出 | 导出文本里 `ADVANCED_FACE` = 7 ⇒ C 可行 |
| **P2** | `getSubShapes(c,'face')` 取到的句柄，与 `getSubShapes(shell,'face')` 取到的句柄，能否用 `isSame` 判定同一性 | 覆盖/uniqueness 判定稳定成立 ⇒ A 的自由面筛选可靠 |
| **P3** | 单个 face 独立成 label 时，STEP writer 写出的是 `SHELL_BASED_SURFACE_MODEL + OPEN_SHELL`（与 ref 形态一致）还是别的 | 决定 A 方案要不要额外包一层；并确认 `compareStepFiles` 的 f/e/v 口径是否因此 satisfied |

探针落 `packages/core` 下的一支临时 vitest（`test/brep/export/step-free-face.probe.test.ts`），结论无论正负都冻结为常驻断言——本仓规矩：**验证过的负向结论必须留测试**。

---

## 7. 实施步骤

| 步骤 | 内容 | 产出 / 验收 |
|---|---|---|
| **T1** | 跑 P1/P2/P3 三探针 | 记录实测数值到本文 §6 表格，选定 A 或 C |
| **T2** | 改 `packages/core/src/brep/export/step.ts`：新型分派；同步改写失效注释（`:89-92` 的「solid → shell → face → edge」描述与 `:104-108` 的「不展开 compound」） | 行为变更点集中在 `:93-110`；`:111-126` 的 label 写入与命名尽量不动 |
| **T3** | 在 `packages/core/test/brep/export/step-export.test.ts` 增用例：① shell+游离 face 的 compound ⇒ 7 面全出；② 纯 face compound 仍走既有兜底（回归，保护 `:141` 那条语义）；③ 多 solid compound 的 `name [1]/[2]` 不变（已有用例不得翻红） | 新增 ≥3 断言，全量 core 单测绿 |
| **T4** | 门禁：`eslint packages/core/src` + `npm run typecheck` + `verify-export-jsdoc` | 三项全过；注意 `packages/core/dist/**` 是 gitignored 的构建产物，**不需要也不应入库**（`scripts/check-dist-sync.mjs` 文件头明确说明 dist 不入 git） |
| **T5** | 出包与下游联调 | 见 §8 |

---

## 8. 下游联调路径（含一处真实风险）

`cq-compat` 侧 `@faicad/faijs` 装在 `node_modules` 里是**实体目录，版本 0.29.5**（`devDependencies: ^0.29.0`），而 monorepo `packages/core` 当前 **0.30.9**。也就是说下游落后不止一个小版本。

| 步骤 | 命令 | 备注 |
|---|---|---|
| 1 | 在 monorepo：`npm run build`（或 `npm run pack` 自带 build） | `npm run pack` 按 workspace 依赖顺序 build 后打 tgz（`scripts/pack.mjs`） |
| 2 | 定位 `faicad-faijs-<ver>.tgz`（落在 `packages/core/` 旁） | root 已有多个历史 tgz 先例 |
| 3 | 在 cq-compat：`npm i <path-to-tgz>` | 会装上 ≥0.30.9 |
| 4 | `npx tsx tests/run-cand.ts --only "test_sewing"` → `tests/compare.ts --only "test_sewing"` | `test_sewing__sh` 必须**保持** PASS（零回归），`__res3` 由 FAIL 转 PASS |
| 5 | 翻 manifest：清 `export:free-face-in-compound` 的手动 blocked 标注，重跑 `gen-manifest` + `mark-blocked` | blocked 86 → 85 |

**风险 R1（必须先和用户确认）**：这等于把 cq-compat 的 faijs 从 0.29.5 跨到 0.30.x，中间可能有不相关 breaking。若不想连带升级，备选是**先在 0.29.x 分支上做同一处最小改动**再出 patch 包——是否走这条路需要你拍板，不默认执行。

**风险 R2**：改动位于所有 STEP 导出的公共路径（影响面见下表），`faijs-fasteners` 的多个 export 测试直接吃它，必须在各自 workspace 复跑。

---

## 9. 影响面（改一处，动这些调用方）

| 调用方 | 位置 | 说明 |
|---|---|---|
| `export-model.ts` | `:486`、`:581` | L1→L2 导出主链路（两处重复逻辑） |
| `node-host/cli.ts` | `:857` | CLI `--mode brep` 的 STEP 写出，cq-compat 的 `run-cand` 正走这条 |
| `occt-kernel/highLevelApi.ts` | `:222` | `exportStepFromSolidsHighLevel` 的门面 |
| `index.ts` / `browser.ts` | `:39` / `:228` | 公共 API 再导出（签名不变时无需改） |
| `packages/faijs-fasteners/scripts/` | `export-ours.ts`、`kernel-nut-probe.ts`、`kernel-screw-probe.ts` | 导出脚本 |
| `packages/faijs-fasteners/test/` | `bearing/nut/screw/sprocket/thread/washer.test.ts` | 需复跑 |
| `packages/core/test/` | `api/occt-high-level.test.ts`、`brep/case2-load-stl-cylinder-assembly.test.ts`、`brep/export/step-export.test.ts` | 需复跑 |
| `packages/demo/main.ts` | — | demo 手动验证即可 |

---

## 10. 硬门禁清单（本仓）

| 阶段 | 检查 | 命令 |
|---|---|---|
| pre-commit | 行尾 LF、translate pairing、archived notes、family lockstep、`verify-export-jsdoc`、eslint(staged, --fix)、whitespace | `lefthook.yml` 自动 |
| pre-push | typecheck | `npm run typecheck` |
| 版本 | 若改 `package.json` 版本 → `check-lockstep` 生效 | `npm run set-version` 统一推进 |
| doc | `docs/plans/**` 已明确**豁免** `verify-md-wrap`（`scripts/verify-md-wrap.ts` 的 `isExcluded`），但仍受 `verify-md-links` 管辖 | 本文不引外部链接 |

按本仓既有规矩：**提交必须让门禁真实通过，不得 `--no-verify`**。

---

## 11. 验收标准

1. `packages/core`：`npx vitest run packages/core/test/brep/export/step-export.test.ts` 全绿（含新增的 §7-T3 三条），且该文件内 **13 条既有用例零翻红**。
2. `eslint packages/core/src` 0 警；`npm run typecheck` 0 错（`scripts/` 里没被 `package.json` / `lefthook.yml` 引用的脚本不算门禁）。
3. 下游：`test_sewing__res3` 由 FAIL 转 PASS（f7/e16/v12 对齐 ref），`test_sewing__sh` 保持 PASS。
4. 变异验证：把 `__res3` 镜像里 x=+1 的位移去掉（帽面与顶面重合），结果必须重新翻红——证明第 7 面确实在数据通路上，而不是被某个巧合凑出的拓扑数。
5. `cq-compat` 侧 blocked 计数 86 → 85，标签 `export:free-face-in-compound` 退役（注释里留一行说明它曾是导出侧缺口、本轮在 core 合上）。

---

## 12. 待你拍板的两件事

1. **§8 R1**：是接受 cq-compat 连带跨到 faijs 0.30.x，还是先在 0.29.x 上做最小 patch？
2. **§5 方案选择**：默认按探针结论自动取 A/C（推荐）；若你倾向直接定方案，我可以跳过 P1 直接实施 A（改动可控、不依赖 XCAF 对混合 compound 的未知行为）。
