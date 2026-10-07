# 方案：`api/brepjs-compat` 改名为 `api/geom-types`

- 日期：2026-10-07
- 状态：已落地（2026-10-07 实施，Agent Note：.agents/notes/implemented/architecture/2026-10-07-rename-brepjs-compat-to-geom-types.md）
- 用户原话：「写一份方案，改名为api/geom-types」

## 1. 背景与动机

`packages/core/src/api/brepjs-compat/` 源于 2026-09-03 的 brepjs 兼容层计划。2026-09-25 core-decouple（裁决 9）删除了旧 `packages/brepjs` 与全部 op 投影，该目录现仅剩 core 内联的纯工具与类型（见其 `index.ts` 头注释）：

| 文件 | 内容 |
|---|---|
| `types.ts` | `Vec3`、`PointInput`、`toVec3` 等基础几何类型 |
| `vecOps.ts` | `vecAdd/vecSub/vecCross/vecNormalize/…` 纯向量运算 |
| `planeOps.ts` / `planeTypes.ts` | `createPlane/createNamedPlane/resolvePlane`、`Plane/PlaneName/PlaneInput` |
| `constants.ts` | `DEG2RAD`、`RAD2DEG` |
| `index.ts` | 桶 re-export（含 re-export core 的 `Result` 组合子与 `kernelError/validationError`） |

目录里已**没有任何 brepjs 代码**，名字是历史残留，误导读者以为存在对外兼容层。改名为 `api/geom-types` 使目录名与内容一致。

## 2. 改名范围（引用面清单，已核实）

### 2.1 代码 import / re-export（必须改）

对 `../brepjs-compat/*` 或 `./brepjs-compat/*` 的引用，全部集中在 `packages/core/src/`：

- `api/index.ts` — 三处 `from './brepjs-compat'`（值导出、类型导出、`map/andThen`）
- `api/brep-operations/booleanFns.ts` — `planeTypes`、`planeOps`
- `api/brep-operations/compoundFns.ts`、`hullFns.ts`、`patternFns.ts`、`primitiveFns.ts`、`sweepFns.ts` — `types`（Vec3）
- `api/brep-operations/topologyFns.ts` — `types`（MatrixInput、Vec3）
- `api/brep-topology.ts` — `./brepjs-compat/types`
- `api/view/cameraFns.ts` — `types` + `vecOps`
- `api/view/projectionPlanes.ts`、`view-camera.ts` — `types`
- `api/boolean.ts` — 仅注释里出现 `brepjs-compatible` 字样（**不是路径**，见 §4 判断项）

### 2.2 目录内文件自身（git mv）

`packages/core/src/api/brepjs-compat/{index,types,vecOps,planeOps,planeTypes,constants}.ts` → `packages/core/src/api/geom-types/` 同名文件。目录内互相 import 全部是相对路径（`../../result/result` 等），无需改动。

### 2.3 生成文件（改名后必须重新生成，禁止手改）

- `packages/core/src/api/surface/capability-map.json` — 由 `packages/core/scripts/gen-capability-map.ts` 生成，内含 `brepjs-compat/planeOps.ts` 等路径字符串；钉住三方一致的 `capability-map.test.ts` 会失败，重跑生成器即可。
- `packages/core/src/mesh/api.d.ts` — 由 `gen-api-dts.ts` 生成；如生成产物含该路径需一并重跑（实施时验证）。

### 2.4 注释中的路径引用（随改名顺带更新，语义不变）

- `src/index.ts` L237 注释「`api/brepjs-compat` 仅保留…」
- `geometry2d/bridge/plane.ts` L6 注释「`createPlane` helper in `api/brepjs-compat`」

### 2.5 不改的部分（明确排除）

- `packages/*/NOTICE` 文件：其「brepjs-compat facade」表述指**已删除的对外兼容面**的许可证归属（brepjs 项目 Apache-2.0 移植代码），是法律声明，不随目录改名而失效，保持不动。
- `docs/plans/` 下历史方案文档（已归档或按规则不改）：如 `2026-09-03-faijs-brepjs-compat-api.md`，属变更历史。
- `.agents/notes/` 决策记录：记录当时事实，不改。
- `docs/ops-api-inventory(.zh).md` L738：文本是 JSDoc 的镜像（由 `scripts/gen-ops-api-inventory.ts` 从源码 JSDoc 同步），其中 `brepjs-compatible` 是**语义描述**（「与 brepjs 兼容的签名」）而非路径——**建议不动**；若 JSDoc 措辞一并调整则需重跑该生成器（见 §4 判断项）。
- 对外包名与子路径导出：`packages/core/package.json` 的 `exports` 已无 `./brepjs-compat` 独立条目（仅 `./api/*` 通配）；改名后 `dist/api/geom-types/` 自然落位，无需改 package.json。

## 3. 实施步骤

1. `git mv packages/core/src/api/brepjs-compat packages/core/src/api/geom-types`
2. 全局替换 import 路径：`brepjs-compat/` → `geom-types/`（限 `packages/core/src/**` 与 `packages/tests/**` 的相对 import；当前 tests 中无引用，实施时以 `grep -r "brepjs-compat/" packages/*/src packages/*/test` 复核为空）
3. 更新 §2.4 两处注释路径
4. 重跑 `npx tsx packages/core/scripts/gen-capability-map.ts`（并按需 `gen-api-dts.ts`），确认 `capability-map.json` 无 `brepjs-compat` 残留
5. 验证（按 AGENTS.md 测试步骤顺序）：
   - `npm run typecheck`（根 + workspaces）
   - `npm run test -w @faicad/faijs`（重点：`api/surface/capability-map.test.ts`、brep-operations 相关单测）
   - `npm run lint`
6. 全部通过后再跑 `pwsh -NoProfile scripts/ci.ps1` 一次；之后只重跑失败项
7. 同一 PR 内新增 Agent Note（`.agents/notes/`）记录改名决策；本方案文档状态改为「已落地」

## 4. 实施中的两个判断点（当前按推荐项执行）

1. **`api/boolean.ts` JSDoc 的「brepjs-compatible 签名」措辞**：描述的是参数形态语义（`(base, tool, options?)` 源自 brepjs 惯例），不是路径，**不改**。若用户认为该措辞也应现代化，则改 JSDoc 后需同步重跑 `gen-ops-api-inventory` 并接受 docs 双语 diff。
2. **是否保留旧路径 shim（`brepjs-compat/` 目录内 re-export `geom-types`）**：推荐**不保留**。该目录从未被外部包 import（`@faicad/faijs` 的对外子路径 `./api/*` 指向 dist，且公开符号全部由 `api/index.ts` 平铺导出，符号名不变——对外 0 破坏）；内部路径 shim 只会延长残留寿命。

## 5. 风险与回退

- 风险极低：纯路径重命名，无符号、无语义变化；`git mv` 保留历史。
- 主要回归面 = capability-map 一致性测试（生成器会自动覆盖）与 typecheck 的 paths 解析。
- 回退 = revert 该 commit。
