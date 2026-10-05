# Agent Note: PBR 外观 API（Shape 方法 + appearance 字段）

Status: implemented

English | [中文](2026-10-05-pbr-appearance-shape-methods.zh.md)

## Problem

faijs 模型此前无法设置颜色/材质/透明度：脚本只能通过 `return { shape, color, metalness, roughness }` 把三字段传给编辑器（`ScriptMetaIR.appearance`），而该通道是全仓零使用的死特性（无任何 `.fai.js` 用过，`metadata-extractor.test.ts` 零用例）；编辑器渲染端虽有完整 PBR 管线（29 字段 `MaterialAppearance`），但上游数据源只有 3 字段，STEP 导入也丢色。用户要求：颜色/材质/透明度可设置、可在编辑器正确渲染；设置不必属于 op；要用 `let box1 = cad.box(...); box1.set...` 的成员调用写法；不兼容存量（旧 return 三字段与 `ScriptMetaIR.appearance` 删除）；外部 STEP/3MF 导入导出须兼容已有规范。

## Decision

外观改为 **Shape 实例方法 + 自解释字段**，非 op 体系：

- 新增 `packages/core/src/api/appearance.ts`：`PbrAppearance`（全字段可选、不隐式清零、`opacity` 为透明度唯一权威字段、`alphaMode: OPAQUE|MASK|BLEND`）、`MaterialSpec = Omit<PbrAppearance,'color'|'opacity'>`、`normalizeColor`（hex #rgb/#rrggbb/#rrggbbaa 与 [r,g,b]/[r,g,b,a]，内部归一 sRGB 0–1）、`mergeAppearance`（undefined 不覆盖旧值）、`attachAppearanceMethods`。
- `Shape.appearance?: PbrAppearance` 数据字段随 mesh/brep 双链路产物传递（可序列化、worker 过线保留）；方法由产物构造点 `solid()`/`curve()` 统一挂载（`setAppearance/setColor/setMaterial/setOpacity/getAppearance`，原地合并返回 `this`，幂等）。
- 脚本面 `box1.setColor(...)` 复用既有成员调用语句形态（`asm1.solve()` 的 `classifyOpCall` receiver 分支，无新增语句形态）；**链式** `a.setX(...).setY(...)` 脚本面暂不支持（解析器只认单层 receiver），TS 库面可链式。
- 几何 op 产物默认继承第一个携带外观的几何输入（`define-op.ts` 的 `inheritInputAppearance`，产物已有外观则不动）。
- 删除 `ScriptMetaIR.appearance` 与 `metadata-extractor` 的 color/metalness/roughness 解析分支；return 对象未知 key 静默忽略（宽容语义，已写入代码注释）。
- 3d_editor：`faijsAppearanceToHost` 全字段映射（PbrAppearance → MaterialAppearance，alpha = opacity ?? 1，opacity<1 未显式 alphaMode → BLEND）；`executeScript` 改读执行结果 `shape.appearance`（非脚本元数据）；脚本/导入外观写 `materialOriginals`（原值），用户编辑写 `materialOverrides`（覆盖），查询优先级 overrides > originals > defaultMaterial（`getEffectiveAppearance` 扩展）；worker 协议（`platform/execution/protocol.ts` `toWireGeometry`/`wireToHostResult`）补 `appearance` 字段过线（web/weapp/electron 三端共用）。
- 3d_editor 依赖的 `@faicad/faijs` 从 0.29.1 tgz 升级到 0.29.3 tgz（`file:` 路径更新，6 处 package.json）。

## Alternatives considered

1. **外观作为 op（defineOp + args-schema + api-namespace）**：被用户否决——设置外观不是几何操作，无 mesh/brep 双实现需求、无引擎分派；op 是"几何变换"语义，外观是"元数据合并"语义。
2. **保留 return 三字段并扩展**：被用户否决（不兼容存量，要求完全重设计）；且实测为死特性，删除零迁移成本。
3. **方法挂到 `Shape` 接口（extends 方法接口）**：会让所有 Shape 字面量类型强制实现方法、破坏大量现有代码；改为基础 `Shape` 纯数据契约 + `SolidShape/CurveShape extends ShapeAppearanceMethods` + 运行时构造点挂载。
4. **编辑器外观继续写 `materialOverrides`**：无法区分"脚本原值"与"用户编辑"，重放会覆盖用户编辑；分层 originals/overrides 语义让脚本恢复与用户编辑共存。

## Consequences

- 脚本可用 `box1.setColor('#e53935')` / `box1.setOpacity(0.5)` / `box1.setMaterial({ metalness: 0.8 })`（一次一条语句）设置外观，编辑器渲染消费 `shape.appearance` 全字段（颜色/透明度/金属度/粗糙度/自发光/透射/清漆/织物/拉丝/高光/环境/alphaMode/双面/无光照）。
- 破坏性变更（仓库内部测试阶段，不考虑 API 向后兼容）：`ScriptMetaIR.appearance` 与 return 三字段通道删除；3d_editor 材质写入从 overrides 改为 originals（用户编辑路径不受影响）。
- 验证：faijs core typecheck/lint 全绿，core 单测 2956 passed（含 `api/appearance.test.ts` 15 个）、faijs-tests 571 passed（含 `faijs/appearance/appearance.test.ts` 7 个 e2e）；3d_editor `test:unit` 2822 passed（含新增 `faijs-appearance.test.ts` 8 个、`appearance-e2e.test.ts` 3 个端到端闭环）、改动文件 eslint 干净。
- 已知缺口：3d_editor `npm run typecheck:desktop` 报 3 处存量错误（`platform/src/weapp/wire-codec.ts`、`weapp/worker-ports.ts`、`execution/sketch-host.ts`），均为 faijs 0.29.1→0.29.3 内部导出漂移（`StdlibNamespace`→`LibNamespace`、`cad-runtime/ports` 的 `PartName` 不再导出、`SharedArrayBuffer` 类型不兼容），非本次 P1 改动引入，属升级副作用的存量适配，待单独处理。
- P2/P3 已落地（2026-10-05，faijs 0.29.4）：
  - **P2 导入**：`importFile` 3MF basematerials `baseColor` → `shape.appearance.color`（sRGB 0–1，无 baseColor 不挂）；`loadBrep` 消费 STEP `STYLED_ITEM`（`getSolidColorsOrdered` 首个 solid 颜色对齐单零件收敛，三个 return 点，宽容不抛）；3d_editor `formatLoaders` STEP 分支设 `MeshStandardMaterial`（导入即所见，修复丢色）+ 记录 `mesh.userData.faijsAppearance`，`ModelGroup` 导入循环写 `materialOriginals`（原值，幂等）。
  - **P3 导出**：STEP 颜色经 `exportSolids`（worker 协议）→ XCAF 写侧（既有 `exportStepFromSolids`，step-export.test「color preserved」断言已有）；3MF basematerials 修复**两个存量 bug**（faijs `build3mfModelXml` 此前把 basematerials 内联在 `<object>` 内、parseThreemf 只读 `<resources>` → 改为 `<resources>` 声明 + object `pid/pindex` 引用、hexColor 输出 6 位；3d_editor `meshToExportEntry` 用 `...(extractPartColor(mesh) ?? {})` 把颜色元组 spread 成数字键、`color` 字段从未进入 entry → 显式 `color` 字段）；glTF 路径**定稿** = 编辑器 `THREE.GLTFExporter`（§12 ⑥：`.glb` 二进制、PBR 子集 baseColorFactor/metallicFactor/roughnessFactor/alphaMode 从渲染材质导出、坐标烘焙 mm→米 + Z-up→Y-up、ExportDialog 新增 .glb 项、单位固定米）。
  - **版本**：faijs 0.29.3 → 0.29.4（`set-version.mjs` 唯一写入端，覆盖 P2+P3 core 改动），3d_editor 6 处 package.json tgz 引用同步、npm install 后 node_modules 0.29.4。
- P4（面级材质 + 顶点色 + 3MF colorgroup/逐三角形读写）待实施。
