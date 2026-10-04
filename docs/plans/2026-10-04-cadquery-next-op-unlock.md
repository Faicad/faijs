# CadQuery 移植：下一阶段解锁方案（2026-10-04，已订正）

> 状态：方案（plan-only）。本会话只产出本计划，不实施任何代码改动。
> 上游任务上下文：`docs/plans/2026-10-03-cadquery-full-port-roadmap.md`（权威路线图）。

## 0. 订正说明（取代初版错误前提）

初版（与 2026-10-04 会话前半段）曾断言「`importStep`/`load`/`save`/`export`/`hollow` 等均未实现、要继续解锁必须新增这些 op」。**该前提错误**，已用数据推翻：

- `importStep` / `load` / `save` **已实现**于 `packages/faijs-cadquery/src/assembly/save.ts`，并经 `assembly/index.ts:32` 再导出到 `cq` 命名空间；`constrain`/`solve` 同理（`assembly/index.ts` 的 `constraintEx`/`buildAssembly`/`solve`）。
- `hollow` **已实现**为 `shell`（`workplane.ts:5499`，已导出 `index.ts:89`）——仅上游名 `hollow` 与 faijs 名 `shell` 不同，覆盖分析器按上游名反射故判缺失。

故「下一步 = 新增一批 op」是错的。真实情况见 §2–§3。

## 1. 当前状态（已实证）

- **已提交** `3d6640ab`：新增 `splitShapeBy` / `replaceFacesOnSolid` / `edgesOfFace` 三个 helper——把 DSL 的 `Shape` 包装（OCCT 句柄藏在 runtime slot）桥接到 OCCT 原始句柄（经 `brepOf` 取出 → 跑 OCCT BOP → `fromHandle` 包回 `Shape`）；几何运算 100% 走 OCCT，`mesh` 仅指包装类型而非几何后端；+ `faceMakePlane` 可选 `scale` 参数；10 个 `pending:mirror` 用例全部解锁。
- manifest：`496/146/55` → **`506/136/55`**，`pending:mirror` 归零。
- 包内 `npx vitest run`：**598 全绿、零 stderr**；`npm run build -w @faicad/faijs-cadquery`（tsc）通过。
- 刷新 coverage：`totalCasesInRefManifest=305` / `casesWithStep=297` / `portableNow=211` / `blocked=45`。
- 用刷新后的 coverage 重跑 `gen-manifest.ts`：结果仍是 `506/136/55`，`git diff` 为空 → **权威确认 `pending:mirror=0`**。

## 2. 关键结论：only-mirror backlog 已清空；12 个 assembly 用例的真实阻塞

- 12 个 `test_assembly` 用例的 `blockedBy` 经核查是 **pytest 器具调用**（`getfixturevalue` / `parametrize` / `__dir__`，分析器归入 `STRUCTURAL_BLOCKERS`），**不是几何 op**。证据（`coverage.json` 实测）：
  - `test_assembly_step_import_roundtrip`：`blockedBy=getfixturevalue`，`ops=getfixturevalue,load,importStep` → `importStep`/`load` 在 ops 里但**不是 blocker**。
  - `test_save` / `test_export`：`blockedBy=parametrize`，`ops=parametrize,save` / `parametrize,export` → 同理。
  - `test_vtkjs_export` / `test_toJSON` / `test_exportGLTF`：blocker 是 `exportVTKJS`/`toJSON`/`exportGLTF`（分析器已列的排除项/路线图排除项）。
- **结论**：这批用例不可镜像，因为它们依赖 pytest 器具注入 / 文件 IO / 排除项导出器，与「是否实现某 CadQuery op」无关。要解锁需改测试 harness 或确认属排除项，**不是写镜像、也不是补 op**。

## 3. 真实缺失 op（剔除 pytest 伪 op 后的 `blockedBy` 直方图）

| 缺失 op | 阻塞用例数 | 真实状态（已核查） |
|---|---|---|
| `remove` | 5 | `Assembly.remove` 已实现（`assembly/assembly.ts`），`Shape.remove` 是缺口（路线图 G-C3）；分析器**刻意保守**保留 `remove` 为缺失（避免误解锁 `Shape.remove` 用例），见 `analyze-coverage.py:86-92` |
| `interpPlate` | 3 | 需进一步核查（疑似特殊采样 op，初版未覆盖） |
| `hollow` | 3 | **已实现**为 `shell`（`workplane.ts:5499`，导出 `index.ts:89`）；仅名不匹配 → 加 `hollow` 别名或列入 `CQ_COMPAT_EXTRA` 即可解锁，无需新几何 |
| `export` | 3 | `save`/`exportStepFromSolids` 已实现；上游 `cq.exporters.export(...)` 部分变体（vtkjs/glTF）是排除项；`test_export`/`test_export_errors` 的 blocker 是窄语义，需逐用例确认 |
| `importBrep` | 2 | `importStep`（STEP）已实现；通用 BREP 导入未显式导出（疑似部分缺口） |
| `project` | 2 | **确实未实现**（无导出函数，仅 `extrude` 局部复用） |
| `prism` | 2 | **确实未实现**（无导出函数，仅 `extrude` 局部复用） |
| 单点 | geomType/cast/largestDimension/parametricCurve/CombinedCenter/filter/faceOn/draft/matrixOfInertia 各 1，narrow:chamfer-asym / narrow:sphere-angles 各 1 | 各自 1 用例，多为特殊/窄语义 |

**真正需要「新写导出 op」的只有 `prism`(2) 与 `project`(2)`**；`hollow` 是别名工作；`remove` 是分析器保守标记（几何侧 `Assembly.remove` 已有）；其余多为 pytest 器具/排除项/窄语义。

## 4. 内核可行性（已 fact-check，只读）

- `prism`：上游 `Workplane.prism(dir, length)` = 沿方向向量 extrude。`kern().extrude(brepOf(face), vec...)` 已在 `workplane.ts` 多处作为 `prism` 局部变量复用（`workplane.ts:729` 等）→ 封装为导出 `prism(wp, dir, length)` 即可，无新内核原语。
- `project`：上游 `Workplane.project(dir, ...)` = 把线框投影到面。`k.projectEdges(shape, origin, direction, xAxis, ...)` @ `occt-primitives.ts:400` 已存在 → 封装为导出 `project(...)`。
- `hollow`：已 `shell`（含厚度<0 无去面 → 闭壳，见 `workplane.ts:5518-5522`）。提议 `export { shell as hollow }` 或 `CQ_COMPAT_EXTRA` 加 `hollow`。
- `remove`：`Assembly.remove` 骨架在 `assembly/assembly.ts:628`；`Shape.remove`（按面/子形状删）是 G-C3 缺口，非本轮范围。

## 5. 推荐执行序列（一次只解决一个 op，且只动真缺口）

- **P1 `hollow`（3 用例，零新几何）**：`index.ts` 加 `export { shell as hollow }`（或 `CQ_COMPAT_EXTRA` 加 `hollow`）→ 重跑 coverage+gen-manifest → 应冒出 3 个 `pending:mirror` → 写镜像 → 比对 ref `PASS` → 回归 → 提交。验证「别名即解锁」管线。
- **P2 `prism`（2 用例）**：封装 `extrude` 为导出 `prism(wp, dir, length)`（补 JSDoc）→ coverage/gen-manifest → 镜像 → 比对 → 回归 → 提交。
- **P3 `project`（2 用例）**：封装 `projectEdges` 为导出 `project(...)` → 同上流程。
- **P4 `remove` / `importBrep` / `export` 窄语义**：先逐用例确认是真缺口还是分析器/排除项误标，再决定；`interpPlate`(3) 需先读上游源码定语义。**不盲目实现排除项（glTF/VTK/VRML 已 `skipped`）。**

## 6. 单 op 执行配方（每步可验证）

1. **核查现状**：先 grep 包内 `src` 与 `assembly/save.ts`、`workplane.ts`，确认该 op 是否已有实现（含别名/不同名）；再读 `analyze-coverage.py` 的 `CQ_COMPAT_EXTRA`/`CQ_COMPAT_OPS` 判定，确认它是「真缺失」还是「已实现但未识别」。
2. **实现 op**：在 `faijs-cadquery` 的 `workplane.ts` / `shape-class.ts` / `assembly/` 加/暴露 CadQuery 兼容函数，从 `index.ts` 或 `assembly/index.ts` 导出到 `cq` 命名空间；补 JSDoc（`verify-export-jsdoc` 门禁要求每个导出 API 有文档）。仅当确属真缺口才写新几何；若只是别名/重命名，改导出即可。
3. **刷新 coverage + gen-manifest**：`C:/Users/ylt/cadquery-env/Scripts/python.exe tests/ref-harness/analyze-coverage.py --json tests/coverage.json` → `npx tsx tests/gen-manifest.ts` → 应冒出新的 `pending:mirror` 条目（解锁数 == 该 op 阻塞用例数）。
4. **写镜像**：对每个新 `pending:mirror` 用例写 `<module>/<Case>__<var>.fai.js`。注意 `.fai.js` 受限子集：参数位无嵌套 `await`、变量名受限（`top` 等被安全扫描器禁止）、裸 `Shape` 中间量必须内联进消费调用。
5. **比对 ref**：`npx tsx tests/run-cand.ts --only <substring>` → `npx tsx tests/compare-one.mjs "REF_BASE|CAND_BASE"` 确认 `PASS`（`volΔ=0`、拓扑逐位一致）。ref 命名不规则（cadquery 模块用 `__`、assembly 用 `___`），需逐用例对齐 `out/ref/` 文件名。
6. **回归**：`npm run build -w @faicad/faijs-cadquery` + `npx vitest run`（包内，预期全绿、零 stderr）。
7. **提交**：`git add` **显式路径**（含 src + manifest + 镜像，绝不带 freecad 任务的 `packages/faijs-freecad/*` 与 `scripts/_probe-*`）+ `git commit`（Bash 工具须 `timeout: 300000` 以容纳 repo-wide `verify-export-jsdoc`；无 `--no-verify`；无 `Co-Authored-By`；英文 conventional commit）。

## 7. 风险与注意

- **先核查、再断言「未实现」**：本次教训——`importStep`/`load`/`save`/`export`/`hollow` 早已实现（assembly/save.ts、shell），初版误判主因是把用例 `ops`（全部被追踪调用）与 `blockedBy`（首个缺失 op）混为一谈，且忽略了分析器 `CQ_COMPAT_PACKAGES`/`CQ_COMPAT_EXTRA` 的判定机制。任何「op 缺口」结论须先查 `coverage.json` 的 `blockedBy`（而非 `ops`），并交叉 `src` 内实现。
- 别名/重命名解锁优先于新写几何；能力缺口 = 报错，不是加旁路。
- `export`/文件 IO 用例可能部分属路线图排除项，P4 前须先确认范围。
- 严守「一次只解决一个 op / 一个问题」；每 op 独立提交、独立回归。
- 长任务串行：任何全量 parity sweep 必须单进程、带单用例超时（防 `run-cand` 无超时导致整轮不返回 / `spawnSync` EBUSY 全灭），见 AGENTS.md 铁律。

## 8. 验收口径

- 每 op 完成后：manifest `blocked` 计数器下降 == 该 op 解锁用例数；新镜像全部 `PASS` vs ref（`volΔ=0`、拓扑逐位一致）；包内 vitest 零回归；dist 重建通过。
- 全量 parity 的 FAIL 不必归零（现 ~21 条为基线，含 1 条 `testTwistExtrudeCombine__r` 既有「镜像已 `.blocked` 但 `out/cand` 留旧件」假 FAIL），判零回归用 **PASS/FAIL 集合 diff**，不是 `FAIL==0`。

## 9. 修订（2026-10-04 续：执行验证推翻 P1–P3 前提）

执行 P1–P3 后发现本计划 §3–§5 对 `hollow`/`prism`/`project` 的「薄包装即可解锁」前提**全部错误**，逐一订正：

### 9.1 `hollow`（P1 已做，0 新解锁）
- 已加 `export { shell as hollow }`（commit `32c95cbb`），`cq.hollow` 可调用。
- 但 3 个 `hollow` 用例**此前已被处理**：其镜像用 `cq.shell` 复现几何（`test_free_functions/test_hollow__res1.fai.js:9` 即 `cq.shell(b0, -0.1)`），`res2` 是手动标记的 `kernel:hollow-intersection-join`（内核限制，非 op 缺口，见 gen-manifest 的 `manual:true` 保留逻辑）。故加别名仅 API 完备性，**不解锁任何 pending:mirror**——manifest 仍 `506/136/55`、`git diff` 为空已证实。

### 9.2 `prism`（P2 不可做 —— 内核缺口）
- 上游 `prism` 不是 `Workplane.prism(dir, length)`，而是 **`cadquery.func.prism`**（自由函数），签名 `prism(ctx, base, faces, t, [dir], [angle], additive)`。
- 它基于 OCCT **`BRepFeat_MakePrism`**（`cadquery/occ_impl/shapes.py:7689` / `7748` 的 `multidispatch` 两重载）做特征级加/减棱柱，支持 `angle`(taper)、`thruAll`、`from/to` 面深度；测试断言**精确面数**（"6+2" / "6+4" / "6+1" / "6+2*3"）即该特征构造器的干净拓扑。
- **occt-wasm 未暴露 `BRepFeat_MakePrism`**——`packages/core/src/api/extrude.ts:286` 明示（up-to 拉伸已用「长拉伸 → 与目标面半空间盒求交」绕行）。
- 结论：`prism` 是**内核级缺口**，非 `extrude` 包装。按分类学铁律留 `blocked`，**不写脆弱假实现**。真解锁须在内核加 `makePrism`/`BRepFeat_MakePrism` 原语（路线图级内核任务，超出本计划「薄包装」范围）。

### 9.3 `project`（P3 op 可做，但用例被 text 缺口卡死）
- `Shape.project(target, dir)` 基于内核 `projectEdges`，**真实 occt 内核已实现**（`packages/core/dist/occt-kernel/occt-primitives.js:335` 委托 `k.projectEdges`），故 `project` op 本身可封装导出。
- 但 2 个 `project` 用例（`test_project` × 2，分别 `TestCadQuery` 与 `test_free_functions`）都调用 `Compound.makeText("T"/"O", 5, 0)`（文本几何），而 `text`/`makeText` 是已知独立缺口（路线图 class-D 几何不符、`testText` 等 FAIL）；不先解锁 `text` 写不出这两用例的镜像。
- 结论：实现 `project` op 本身 = API 完备性，**净解锁 0 用例**（与 `hollow` 同性质）。若要解锁须先攻 `text` 缺口。

## 10. 修正后的结论与下一步建议

- **quick-win backlog 已空**：原 §5 的 P1–P3「薄包装解锁」前提全部落空。剩余真实缺口是**内核级**（`prism` → `BRepFeat_MakePrism`）或**与其他缺口纠缠**（`project` → `text`），均非单 op 薄包装。
- 真正可独立推进的方向（需另行规划，超出本计划「加一行导出」量级，每个都是正式任务）：
  1. **内核加 `makePrism` 原语** → 解锁 `prism`(2) + 潜在更多 `BRepFeat` 类 op（`draft`/`thruAll` 拉伸等）；
  2. **攻 `text`/`makeText` 缺口** → 解锁 `project`(2) + `testText` 系列；
  3. `remove`(5) 的 `Shape.remove` 缺口（G-C3，分析器保守保留）；`importBrep`(2) 通用 BREP 导入；`interpPlate`(3) 待读 `func.py` 定语义。
- 建议：将本计划从「薄包装清单」升级为「内核/纠缠缺口清单」，下一轮从 (1) 或 (2) 选一个作为正式任务（均超出「加一行导出」量级，需用户拍板范围与优先级）。
