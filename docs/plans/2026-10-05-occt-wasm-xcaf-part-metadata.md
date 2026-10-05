# 方案：让 occt-wasm 在 STEP 导入/导出时保存与设置部件级描述(description)与零件号(partNumber)

状态：搁置（occt-wasm 内核开发暂停；依赖该能力的相关测试已 skip，恢复开发后按原 §7 清单推进）

## 0. 用户原话

> 我选方案C，需要写一份计划，如何更新OCCT这个WASM的库，让它能够导入导出step文件的时候保存和设置这些信息。

"这些信息" 指 faijs `Shape.meta` / `FileMeta` 中被 occt-wasm 层无法落地的两个字段：部件级 `description`（描述）与 `partNumber`（零件号），见 `2026-10-05-faijs-meta-name-note-api-design.md` 的方案 C 结论。

## 1. 背景与问题陈述

faijs 的 STEP 写通道（`packages/core/src/brep/export/step.ts`）目前做到：

- 每个独立实体经 `doc.addShape(sub, { name, color })` 写入 XCAF label（`setName` → `PRODUCT.NAME`）。
- 整体文件级字段经文本层 `rewriteStepHeader` / `rewriteFileMetaHeader` 写入 `FILE_NAME` / `FILE_DESCRIPTION`。

**缺口**：部件级 `description` 与 `partNumber` 无法写入 / 读回 STEP。原因是 occt-wasm 的能力边界：

- `RawXCAFKernel`（`node_modules/occt-wasm/dist/xcaf-document.d.ts`）只绑定 `xcafSetName` / `xcafSetColor` / `xcafAddShape` 等，没有 description / partNumber 的 label 通道；
- `AddShapeOptions`（`dist/types.d.ts`）只有 `{ name?, color? }`；
- 导出红线禁止对 STEP 文本中 DATA 段的几何 / 实体坐标做文本手术。

结论：这是 **occt-wasm 这个第三方 WASM 库的能力缺口**，不是 faijs 侧实现可自行补上。方案 C = 更新 `occt-wasm`（在其内部增加 XCAF 级 description / partNumber 读写线程），再在 faijs 侧接线。

## 2. 目标

让 `occt-wasm` 及其 TS wrapper（`XCAFDocument` / `OcctKernel`）具备以下能力，供 faijs 使用：

1. **写入**：创建 / 组装 XCAF 文档时为每个 part label 设置 `description`（写到 STEP `PRODUCT` 实体的描述参数）与 `partNumber`（写到所属 `PRODUCT_DEFINITION` / `PRODUCT_IDENTIFICATION` 的部件号槽）。
2. **读回**：`importXCAFFromSTEP` 的 `getLabelInfo` / `LabelInfo` 能返回每个 label 的描述与部件号。
3. **零文本手术**：读写全部走 XCAF label / OCCT 属性 / STEP writer 的正常路径完成，不触碰 STEP 文本 DATA 段实体坐标，满足导出红线。

## 3. 现状调研要点（已核实的约束）

- **occt-wasm 是外部 npm 依赖，不是 faijs 仓库的一部分**；`packages/core/package.json:171` 为 `"occt-wasm": "^3.8.4"`。
- **构建形态**（occt-wasm README「Development」）：
  - 工具链：**Rust 1.95+、emsdk 5.0.3**；`git clone --recurse-submodules`（OCCT 为子模块）。
  - 构建：`cargo xtask build`（OCCT + Rust facade → WASM）；测试 `cargo xtask test`。
  - 另有 Docker 免本地工具链：`npm run docker:build`（OCCT 层首跑缓存）/ `npm run docker:dist`（把 dist/ 产物拷到宿主机）。
  - 同包装也有 Rust 包 crates.io/crates/occt-wasm（原生目标用）。
  - 因此 XCAF 绑定（`xcafSetName` 等）在 occt-wasm 的 Rust facade 侧，需在该仓库源码中新增绑定并重新构建 WASM。
- **faijs 对 occt-wasm 的耦合面只允许在 `packages/core/src/occt-kernel/`**（AGENTS.md A1）：出具类型 `OcctKernel.createXCAFDocument()` / `importXCAFFromSTEP()`、`XCAFDocument`、`LabelInfo`。写入在 `packages/core/src/brep/export/step.ts:125`（`doc.addShape(sub, { name, color })`），读取在 `packages/core/src/occt-kernel/occtKernel.ts:322-350`（`importXCAFFromSTEP` → `getLabelInfo` → `AssemblyPartNode`）。
- **STEP 标准中这两个字段的宿主位置**：
  - 描述：`PRODUCT` 实体的描述参数（`PRODUCT(...,'<description>',…)`）；OCCT 的 `XCAFDoc_ShapeTool` 只放 name，不给描述留槽位。
  - 部件号：属于 `PRODUCT_DEFINITION.product_number` / `PRODUCT_IDENTIFICATION`。XCAF 无内置独立 attribute。

因此 occt-wasm 需要**编码开源化**：在 Rust facade 里为每个 label 挂自定义属性保存 description / partNumber，并在 `xcafExportSTEP` 的 writer 阶段把属性内容写到上述标准实体的对应槽位。

## 4. 方案设计

### 4.1 落地形态分叉（"更新 occt-wasm"的两种路径）

occt-wasm 是外部 npm 包，faijs 不能直接改它源码后提交。二选一：

- **C1 — 上游 PR + 发布版本（主推）**：在 andymai/occt-wasm 的 Rust facade 实现新增绑定 + 单测 + TS wrapper 类型，向上游提交 PR 合并后发布新 `occt-wasm` 版本；faijs 将 `packages/core/package.json` 的 `occt-wasm` 升级到新版本，再在 faijs 侧接线。
- **C2 — 本地 fork / vendored 副本（仅当上游合并不可行或需尽快落地）**：把 occt-wasm fork 为本地仓库，用 `cargo xtask build` 或 Docker 生成本地 `occt-wasm.wasm` + wrapper，作为 faijs 本地依赖。代价是 Rust + emsdk 工具链与构建产物进入 faijs 维护范围（当前 3.8.4 ~4.5 MB），且需解决 WASM 分发（Vite `public/wasm/`）与 worker 通道。

本方案以 **C1 为主线**，C2 为降级明细。

### 4.2 在 occt-wasm 内增加（Rust facade + TS wrapper）

镜像现有 `xcafSetName` / `getLabelInfo` 的写法新增：

1. Rust facade 侧新增绑定：
   - `xcafSetPartMeta(docId, tag, description?, partNumber?)`，或拆为 `xcafSetPartDescription` / `xcafSetPartNumber`（与 `xcafSetName` 对齐，投 hunk 选一）。
   - 底存储：TDataStd_Name 已被 name 占用；description / partNumber 用通用 XCAF 自定义属性（`TDataStd_AsciiString` / `MDTV` 通用属性类）挂在所属 label 下（fa 内部存储层，允许自定义）。
   - `xcafGetLabelInfo` 的返回对象扩增 `description` / `partNumber` 两个字段（缺省空串）。
   - `xcafImportSTEP` 时把源 STEP 的 `PRODUCT` description 与所属 `PRODUCT_DEFINITION` 的 product_number 读进上述属性。
2. **STEP 写入路径自定义**（`xcafExportSTEP` / writer 阶段）：每 label 的 description → 写 `PRODUCT(...)` 描述参数；partNumber → 写所属 `PRODUCT_DEFINITION` 的部件号槽。**只写这两个标准实体槽位，不发明字段**（叶内导出合规）。
3. **TS wrapper**（occt-wasm `dist/xcaf-document.d.ts` + `dist/types.d.ts`）：
   - `AddShapeOptions` 增 `{ name?, color?, description?, partNumber? }`；
   - `XCAFDocument.setPartMeta(label, opts)` 或 `addShape(shape, {…, description, partNumber})`；
   - `LabelInfo` 增 `description?: string; partNumber?: string`。
4. occt-wasm 自身测试：`cargo xtask test`（Rust 侧 round-trip）+ 仓库 Vitest（TS wrapper round-trip：`create → addShape → setPartMeta → exportSTEP → fromSTEP → getLabelInfo` 断言一致）。

### 4.3 faijs 侧接线（只动 `occt-kernel/` 与 `brep/export/step.ts`）

1. `brep/export/step.ts:125`：`doc.addShape(sub, { name, color })` → `doc.addShape(sub, { name, color, description: entry.meta?.description, partNumber: entry.meta?.partNumber })`（`StepExportEntry` 已带 `meta`）。
2. 读回：`occt-kernel/occtKernel.ts` 的 `walkLabel` 把 `info.description` / `info.partNumber` 填入 `AssemblyPartNode` → 上抛 → `Shape.meta`。
3. `stepMetaParser.ts` 的文本扫描兜底降级为"老 occt-wasm 的兼容回落"（当 `getLabelInfo` 拿不到 desc / partNumber 时），不再是主路径。
4. `packages/core` 升级 `occt-wasm` 依赖 + 刷新 lock。3d_editor 侧应读 `Shape.meta` 是 Engine-agnostic 不变；若编辑器调 `occt-wasm` 的 set，则适配新签名。
5. 红线合规：本实现走 XCAF label / OCCT writer 的属性写，不触碰 STEP 文本几何或实体坐标，不违反导出红线。`rewriteStepHeader` 仅保留整体文件 header 字段，与 desc / partNumber 无冲突。

## 5. 关键风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 上游不接受把 desc / partNumber 进 XCAF | PR 被拒，无法升版本 | 走 C2 本地 fork（自用）；或在 occt-wasm 用自定义属性存、仅 faijs 消费 |
| XCAF 无 description 的标准 attribute，需自定义存储机制 | 与"只写标准槽位"绑 | 区分两层：fa 内部存储用自定义属性（允许），STEP 导出只写 `PRODUCT.description` / `product_number` 两个标准位 |
| `cargo xtask build`（emsdk 5 + Rust 1.95）本地重构建成本 | 环境难配 | 优先上游合并（无本地构建）；需本地时用 Docker `docker:dist` 免装工具链 |
| 升级 `occt-wasm` 版本（3.8.4→新）引入回归 | 既有 STEP 读写回归 | 升级后跑 faijs 全量 step/import/export/3mf 单测 + 集成 + `3d_editor` 导出链路 + CI 全绿 |
| desc / partNumber 在多子实体展平（compound→多 label）的归属 | 每子实体语义不清 | 约定：入参命名单实体（`subs.length===1`）才写 desc / partNumber；展平出 `[n]` 名的子实体不写（保持 name 行为一致） |

## 6. 验收标准

1. faijs：`box` 设 `meta.description = '铝制外壳'`、`setPartNumber('BOM-001')` → `exportStepFromSolids` → 重新 `importXCAFFromSTEP` → `getLabelInfo` 返回相同值 → `Shape.meta` 一致（round-trip）。
2. 打开导出的 `.step`：在 `PRODUCT(...,'铝制外壳',…)` 与所属 `PRODUCT_DEFINITION` 的 `product_number` 处看到对应值，且不改几何坐标。
3. 现代 step Reader（NX / SolidWorks / 自制编辑器）能读回这两个字段。
4. faijs 全量单测、集成测试、`3d_editor` STEP 导出链路全绿；`scripts/api-surface-snapshot.json` 与类型按流程重新生成。
5. 版本：`occt-wasm` 升级只动 `package.json` + `package-lock`（第三方、非 `@faicad/*`），不手动改任何 `@faicad/*` 版本。

## 7. 任务清单

- [ ] S1 调研并记录 occt-wasm 上游 API 面与 PR 通道（核心调研已完成，见 §3）
- [ ] S2（occt 侧）Rust facade 新增 `xcafSetPartMeta` + `xcafGetLabelInfo` 扩展 + STEP writer 槽位写
- [ ] S3（occt 侧）TS wrapper 扩展 `AddShapeOptions` / `LabelInfo` + round-trip 测试
- [ ] S4 上游 PR（C1）或生成本地 fork（C2），产出可用新版本 `occt-wasm`
- [ ] S5 faijs 升级依赖 + `step.ts` / `occtKernel.ts` 接线 + 重新生成 api surface
- [ ] S6 round-trip 大测试（§6）+ 回归（step/import/export/3mf + 编辑器链路）全绿
- [ ] S7 更新 Agent Note（把 `stepMetaParser` 的兜底角色、新绑定、升版记录在案）

## 8. 版本与红线合规

- `occt-wasm` 属第三方依赖（非 `@faicad/*`），升级不触发 `check-lockstep`，只动 `package.json` / `lock`。
- 本方案禁止对 STEP 文本中 `PRODUCT` 的手工 / 文本改写（红线），只允许 occt-wasm 内部写出的正常属性写入。
- 记录当前状态、不写历史；plan 状态按 方案（未实施） → 实施中 → 已落地 / 已废弃 流转。