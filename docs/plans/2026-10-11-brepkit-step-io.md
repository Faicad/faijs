# 方案：brepkit 引擎支持 STEP 导入 / 导出

- 产出：glm5.3-flash + AtomCode
- 日期：2026-10-11
- 状态：已落地（2026-10-11；内核 reader 修复在 brepkit2 工作区，待 brepkit-wasm 发版后解锁 `import-step.test.ts` 的 skip 用例）

## 0. 用户原话

> 目前使用brepkit内核，faijs是否支持导入导出step
>
> 你写一份开发计划，我需要让brepkit在faijs里支持导入、导出step文件。它有importStep / exportStep 绑定。其不支持的特性忽略即可。
>
> 去C:\my\Faicad\brepkit2读代码

## 1. 目标与非目标

**目标**：faijs 的 brepkit BREP 引擎下，`cad.import_step` 与 `cad.exportStep` 可用；库面 `exportModelSync(..., 'step')` 同步/异步两分支同样放行。STEP 能力来自 brepkit wasm 自带的 `importStep` / `exportStep` 绑定（纯 Rust 自研 AP203 实现，不依赖 OCCT）。

**非目标（用户明确："其不支持的特性忽略即可"）**：

- XCAF 装配层级（装配树、PRODUCT 结构层级、组件实例位姿）——brepkit 无此概念。
- 名称/颜色等展示属性写入 STEP（brepkit writer 不产出）。
- AP214 颜色等扩展实体类型。

brepkit 引擎下导出的 STEP 形态 = 按 brepkit writer 的原生输出（平铺、无层级、无名称颜色），一切以 brepkit 自己的实现为准；导入侧外部 CAD 的 STEP 遇到不认识的实体类型，按 brepkit reader 的行为处理——最多警告（`console.warn`），不报错、不抛异常。

**设计基调（用户 2026-10-11 更正）**：不应该有门禁，不应该报错。导出按 brepkit 支持的格式来；导入遇到不支持的特性最多警告、甚至可以没有。

## 2. 现状盘点（堵点在哪）

brepkit 内核侧已完全就绪，堵点全部在 faijs 上层的引擎门：

| 位置 | 现状 | 问题 |
|---|---|---|
| `packages/core/src/brepkit-kernel/brepkitKernel.ts:1529-1543` | `importStep`（多 solid → compound）/`exportStep`（bytes→文本）已实现 L1 契约 | 无堵点 |
| `packages/core/src/api/import-step.ts:118` | `defineOp({ engines: ['occt'] })` | brepkit 下被静态分派拒绝 |
| `packages/core/src/api/export-step.ts:96` | `assertEngineFor('exportStep', ['occt'])` | brepkit 下抛 `E_BREP_UNSUPPORTED` |
| `packages/core/src/brep/export/export-model.ts:604 / 693` | 同步/异步两分支均断言 `engineId === 'occt'` | brepkit 下抛 `E_BREP_UNSUPPORTED` |
| `packages/core/src/brep/export/step.ts` | XCAF 装配写出器，occt-only 平台面 | **不复用**——brepkit 走独立简版通道 |

## 3. 方案总览

原则：**不做引擎门禁**。occt 的 XCAF 通道保持现状；brepkit 引擎下 STEP 直接走 brepkit 内核自带的 `importStep` / `exportStep`，产出与消费都完全按 brepkit 自己的实现来。分派按引擎 id 静态选择通道（无运行时回退），但**不设能力断言、不因 brepkit 缺特性而报错**：

- `exportStep` / `exportModel:step`：`engineId === 'brepkit'` → brepkit 原生通道；其余（含 occt）→ 现状 XCAF 通道。
- `import_step`：移除 `engines: ['occt']` 限制；实现体本已引擎中立（`loadBrep` → `kernel.importStep`，走 `getBrepApi()` L1 契约），brepkit 适配器已实现该方法。

## 4. 阶段拆解

### Phase 1 — 导出：brepkit 原生通道

1. 新增 `packages/core/src/brep/export/step-flat.ts`（名字待定）：输入 `ExportEntry[]`（复用 `export-members.ts` 的成员拆解），对每个成员取 `solid` 句柄，调 `kernel.exportStep(handle)` 取文本。
2. 多成员：brepkit wasm 的 `exportStep` 只吃单 solid、每次返回完整 STEP 文件（各自带 header）。做法：取第一个成员的文件作骨架，把其余成员 DATA 段的实体重编号后并进去（与现有 `rewriteStepUnitEntities` 同级的纯文本处理）。**任何成员数都不报错**。
3. `export-model.ts` 两个分支：去掉 `engineId !== 'occt'` 的 `BrepUnsupportedError`，改为按引擎分派（brepkit → 原生通道，其余 → `exportStepFromSolids` 现状）。
4. `api/export-step.ts`：去掉 `assertEngineFor('exportStep', ['occt'])`。
5. 单位：brepkit 通道输出 brepkit 原生几何上下文，`options.unit` 在该通道不生效（忽略，不报错、不警告）；单位改写逻辑仍只服务 occt 通道。

### Phase 2 — 导入：放行 `import_step`

1. `api/import-step.ts` `defineOp` 去掉 `engines: ['occt']`。
2. 核实 `importStepImpl` 其余环节在 brepkit 下的行为：
   - `loadBrep`（`brep-ops.ts:898`）的合法判据 `getSubShapes(top, 'solid').length >= 1`——brepkit 适配器的 `getSubShapes` 对 compound 已按子 solid 处理（`brepkitKernel.ts:1179-1182`），需测试钉住。
   - `kernel.subShapeHashes(solidHandle, 'face', ...)`（E3 roleTable）——确认 brepkit 适配器实现了 `subShapeHashes`；若未实现则对该引擎跳过 roleTable 环节（不报错；下游 edgeRef 需要 role 名时再补实现）。
   - `parseStepPartMeta`（纯文本捞 meta）与引擎无关，直接复用。
3. 不支持的实体类型：遵循 brepkit reader 自身行为——reader 能容错的按其结果走，faijs 侧最多 `console.warn` 一条（含文件名/实体类型），**绝不抛错中断**；`loadBrep` 按文件头自适应（CASCADE Topology 文本 → `fromBREP`，否则 `importStep`），brepkit 侧 `fromBREP` 同样吃 STEP/BREP 文本（`brepkitKernel.ts:1548`），两引擎行为同构。

### Phase 3 — 测试与守卫

1. **防回归测试（brepkit 引擎下）**：
   - 往返：faijs 建 box/cylinder → `exportStep` → `import_step` → 几何一致性（体积/包围盒/面数）。
   - brepkit 内核自产的 STEP 往返文件（brepkit2 仓 `crates/io/src/step/tests` 已覆盖内核往返，faijs 侧只需钉 op 面）。
   - 多成员导出：≥2 个 solid 的装配导出不报错，产物含全部成员。
   - 含 brepkit 不支持的实体类型的 STEP 导入：最多产出 warning（测试内 spy `console.warn` 并断言），导入不失败。
   - occt 引擎下现有 XCAF 装配导出行为逐字节不变（现有测试全绿）。
2. **stderr 零容忍**：警告用例必须在测试内 spy `console.warn/error` 并断言。
3. 更新 `docs/ops-api-inventory.md` 与 `docs/api-contract.md` 中 `exportStep` / `import_step` 的引擎说明（注明 brepkit 通道：按内核原生格式，平铺、无层级、无名称颜色，`unit` 不生效）。
4. 同 PR 落一份 Agent Note 记录"STEP 双通道分派、无门禁"决策。

## 5. 风险与待验证点

| 风险 | 说明 | 处置 |
|---|---|---|
| brepkit reader 不认外部 STEP | reader 以自家 writer 往返为主，occt/其它 CAD 导出的 STEP 可能含未支持实体 | 按 brepkit reader 行为处理，faijs 侧最多 console.warn，不报错 |
| `subShapeHashes` 在 brepkit 适配器是否可用 | 影响 roleTable 建立，进而影响下游 edgeRef | Phase 2 第 2 步先核实；缺则该引擎跳过 roleTable，不报错 |
| 多成员 STEP 拼接 | 重编号跨文件实体引用，文本处理易错 | 纯文本重编号，往返测试钉住 |
| 单位 | brepkit 输出的几何上下文与 faijs 单位选项无关联 | brepkit 通道忽略 `unit`（不生效，不报错），文档写明 |
| fixture 依赖 | parity 测试需 brepkit wasm 可初始化（node 测试环境） | 沿用现有 brepkit 测试的初始化模式 |

## 6. 验收标准

- brepkit 引擎下：`cad.exportStep`（单 solid 或多成员）产出合法 ISO-10303-21 文本，**任何情况下不因 brepkit 缺特性而报错**；`cad.import_step` 读回该文件得到等价几何；往返测试通过。
- 导入含不支持特性的 STEP：最多警告，不失败。
- occt 引擎下：现有 XCAF 装配导出行为逐字节不变（现有 step-export 装配测试全绿）。
- 全量相关测试通过后按仓库流程跑 `scripts/ci.ps1` 一次。
