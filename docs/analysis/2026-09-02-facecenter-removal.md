# faceCenter 查询 op 删除清单（faijs）

## 决定

用户指令（原话）：

- 「给我删除faijs项目里现有的faceCenter的代码。然后文档里删除这个冲突点。不准改别的东西」
- 「不清楚就给我写新的文档，到底删除faceCenter的哪些地方，哪些地方要保留。给我写清楚。不准改别的文档，写新的」

背景：faijs 的 `faceCenter(of, anchor?, ordinal?)` 查询 op 无真实下游——所有调用点都在 core 测试，`.fai.js` fixture / demo / mech-lib / 3d_editor 零命中。brepjs 的 `faceCenter(face): Vec3`（面质心）是另一回事，有真实下游（sheetmetal `foreignUnfoldFns.ts` 6 处 + brepjs 内部 drill/pocket/sketch/mate/wrapper/形状引用打分）。处置 = **删除 faijs 查询形态，空出 `faceCenter` 名，P13 投影 brepjs 质心形态**（与 `fillet` 的「直接用 brepjs 版」同款逻辑）。

## 已删除（faijs 查询 op 全链路）

| # | 文件 | 位置 | 删除内容 |
|---|---|---|---|
| 1 | `packages/core/src/api/geom.ts` | `faceCenter` 导出函数（JSDoc 块 + 函数体） | 删除 `export function faceCenter(of, anchor?, ordinal?)`（原 :71-87） |
| 2 | 同上 | `geomQuery` | 剪裁为 faceNormal 专用：删 `feature` 参数与 `'faceCenter' | 'faceNormal'` 联合类型；删面质心计算分支（`kernel.getSurfaceCenterOfMass` 调用）与 `feature === 'faceCenter'` 返回分支；错误文案去 `feature` 模板 |
| 3 | 同上 | 头注 | 删 `faceCenter/faceNormal` 列举 → 只保留 `faceNormal` |
| 4 | `packages/core/src/api/index.ts` | :31 | 导出列表删 `faceCenter` → 只导出 `faceNormal, bboxCenter, bboxMin, bboxMax` |
| 5 | `packages/core/src/api/api-namespace.ts` | :30, :52 | import 与 cad 命名空间条目删 `faceCenter` |
| 6 | `packages/core/src/lang/symbol-table.generated.ts` | :33 | 符号表条目 `"faceCenter": {}` 删除 → `check()` 不再认 `cad.faceCenter` |
| 7 | `packages/core/scripts/gen-api-dts.ts` | API_ENTRIES / ORDER / 几何查询 sections | 删 `faceCenter` 条目（含 `usage: cad.faceCenter(...)` 注文）→ 重生成 `mesh/api.d.ts` |
| 8 | `packages/core/src/mesh/api.d.ts`（生成物） | 几何查询节 | 重生成后已无 `faceCenter(shape: Shape, ...)` 行 |
| 9 | `docs/ops-api-inventory.md` / `.zh.md`（生成物） | faceCenter op 节 | 重生成后已移除签名/示例/参数表/查询清单条目 |

**推荐语与注释清理**：

| 文件 | 位置 | 改动 |
|---|---|---|
| `api/fai_drill.ts` | :235 `@param params.position` | 删「（建议几何引用 cad.faceCenter）」 |
| `api/engrave.ts` | :195 `@note` | 删「，建议用几何引用 `cad.faceCenter(part0, [锚点])`」 |
| `mesh/query.ts` | :74 | 注释 `GeomRef faceCenter/faceNormal` → `faceNormal` |
| `lang/parser.ts` | :13 | 语法注释示例删 `cad.faceCenter(var)` |
| `lang/codegen.ts` | :33, :108 | 注释示例 `cad.faceCenter(part0)` → `cad.faceNormal(part0)` |

**测试改范式**（faijs 已无 `cad.faceCenter`，原拿它当嵌套调用范式的用例换成其它查询 op）：

| 文件 | 位置 | 改动 |
|---|---|---|
| `lang/parser.test.ts` | :163-173 | `cad.faceCenter(part0, [0,0,10])` → `cad.faceNormal(part0, [0,0,10])`，断言 callee 同步 |
| `lang/expr-ir.test.ts` | :140-148, :154-164 | `cad.faceCenter(part0, [...] , 2)` → `cad.bboxCenter(part0)`（嵌套调用用例 + E_VALUE 抛错用例） |
| `lang/parser-normalization.test.ts` | :93-108 | `cad.faceCenter(part2)` → `cad.faceNormal(part2)` |
| `lang/codegen.test.ts` | :204-218 | 嵌套 callee `faceCenter` → `faceNormal`（param 键 `position`/`faceNormal` 不变） |
| `lang/codegen.test.ts` | :249-275 | 嵌套 callee `faceCenter` → `faceNormal`（外层 engrave 参数字段 `faceCenter` 保留） |
| `lang/compile.test.ts` | :48-58, :90-96 | `cad.faceCenter(part0, [...] , 2)` → `cad.bboxCenter(part0)`，编译期望串同步 |
| `cad-runtime/terminal-dag-symbol.test.ts` | :163-186 | `callRef('faceCenter', ...)` → `callRef('faceNormal', ...)` |
| `lang/op-set-consistency.test.ts` | :30 | `CAD_NAMESPACE_FUNCTIONS` 删 `'faceCenter'` |

## 保留（不许删，删了会伤别的东西）

**engrave/knurl 的 `params.faceCenter` 参数字段与本地变量**（是特征参数，不是查询 op；3d_editor 在写这些参数）：

- `api/engrave.ts` :133, :193, :197, :205, :213（读取、`@param`、`@example`、类型声明）
- `api/knurl.ts` :41, :55（`@param`、默认 `cad.bboxCenter` 兜底）
- `mesh/engrave.ts` :71, :89（`THREE.Vector3` 本地变量 `faceCenter`）
- `mesh/api.d.ts` :48, :49（engrave/knurl 的 `params` 类型里 `faceCenter?: any` 字段）
- `cad-runtime/runtime.test.ts` :146, :554, :810, :839（knurl/engrave 语句的 `faceCenter` 参数）

**拓扑「逻辑点」数组**（mesh 拓扑体系，与查询 op 无关）：`topology/types.ts` :255、`build-logical-points.ts` :139, :153, :158, :199-201, :213、`build-selector-runtime.ts` :599, :635, :645, :741, :743、`cad-runtime/runtime-topology.test.ts` :41, :76, :100。

**OCCT 内核几何方法 `getSurfaceCenterOfMass`**（BREP 能力接口，仍是 topology/naming 面计算的手段，也是 brepjs `faceCenter` 的底层）：`brep/engine/primitives.ts` :117、`brep/engine/adapters/brep-mock.ts` :274、`occt-kernel/topologyExt.ts` :362, :366、`topology/naming/score.ts` :50、`geom-hint.ts` :32、`brep/face-evolution.test.ts` 等内核测试。

**vendored brepjs 树内 brepjs 原生 `faceCenter(face)`**（不属于 faijs op，是 P13 要投影的对象）：`vendored/brepjs/topology/faceFns.ts` :189、`topology/index.ts` :80 导出、以及内部依赖点（`compoundOpsFns.ts`、`cannedSketches.ts`、`mateFns.ts`、`wrapperFns.ts`、`blueprint.ts`、`scoring.ts`、`shapeRefFns.ts`、`derivedFaceRefFns.ts`）。`packages/tests/faijs/p3-vendored-surface/**` 测的是 brepjs 自有 surface，保留。

## 验证状态

- 受影响测试全绿：`lang/parser`、`expr-ir`、`parser-normalization`、`codegen`、`compile`、`op-set-consistency`（100 passed）+ `cad-runtime/terminal-dag-symbol`、`runtime`（76 passed）。
- `packages/core` `tsc --noEmit` 通过（修复了 `geom.ts` 一处遗留 `feature` 引用）。
- 生成物已重生成：`mesh/api.d.ts`（`gen-api-dts.ts`）、`docs/ops-api-inventory.md`/`.zh.md`/`.i18n.yaml`（`gen-ops-api-inventory`）。
- core 全量 vitest **未跑完**（按要求中止，留待用户放行）。
- 残留 `faceCenter` 引用全部属于上表「保留」类；`rg` 核查 faijs core 非 vendored 已无任何 `cad.faceCenter(` 调用。

## 未动（明确不动）

- 计划文档 `docs/plans/2026-09-02-faijs-api-surface-completion.md` 中的 faceCenter 冲突字节**未改**（用户指令「不准改别的文档」，冲突点改由本文档承载）。
- 3d_editor 零改动（对 `cad.faceCenter` 零调用，engrave/knurl 的 `faceCenter` 字段名不受影响）。
- `.fai.js` API 手册按删除后的状态重生成，faceCenter op 已不在手册中。

## 后续（不在本次范围内）

P13 投影时以 brepjs `faceCenter(face): Vec3`（`faceFns.ts:189` 面质心）形态落实 `faceCenter` 名；计划文档的 §5.1 faceCenter 行、复核结论、D-FACECENTER、断言 B、U7 需在用户放行后再同步。