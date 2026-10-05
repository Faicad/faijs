# 方案：将 faijs 的 occt-wasm 从 3.8.4 升级到 5.6.0（需哪些变更）

状态：已落地（2026-10-05，occt-wasm 已升至 5.6.0，核心类型修复 `getBoundingBox`、可发布包 range 与 demo CDN 全部对齐，core/tests/cadquery 测试全绿）

## 0. 用户原话

> 请更新到最新版本的occt-wasm 5.6.0，看你说的这些功能是否已经在occt-wasm中提供了。
>
> （随后）实施方案A。
>
> 你需要先写一份方案，occt-wasm从3.8.4到最新版本5.6.0，要有哪些变更。

本方案回答「faijs 升级 occt-wasm 3.8.4 → 5.6.0 需要改哪些东西」。它是升级前的前置文档，不承诺实现。

## 1. 结论摘要

- **occt-wasm@5.6.0 是 npm `latest`**，faijs 当前 `packages/core/package.json` 为 `"occt-wasm": "^3.8.4"`。
- **本次升级是低风险、基本向后兼容的**。经逐一对 3.8.4 与 5.6.0 的类型声明（`dist/index.d.ts`、`dist/types.d.ts`、`dist/raw-types.d.ts`、`dist/xcaf-document.d.ts`）与 package.json `exports` 比对，**faijs 现有调用点几乎无需改动**；5.6.0 新增面全部是新增方法/类型，没有通过仅类名去重命名的改动。
- **本次升级不会带来『存/读部件级 description 与 partNumber』的功能（方案 C 目标仍然缺失）**。5.6.0 的 XCAF 面仍未暴露 description / partNumber / 产品元数据。它带来的是**装配树增强**（子形状 label、装配引用、位置矩阵、`assembly:true`）——这与 meta 目标无关。
- 因此这份方案分两层：升到 5.6.0 需要的[必改项]极少数（几乎为 0），其余是 [可选采用项]。是否可选采用见 §5。

## 2. 调研方法

- 在临时目录安装 occt-wasm@5.6.0，与 faijs 当前使用的 3.8.4 逐文件比对类型声明与 package.json。
- 比对维度：① `OcctKernel` 类方法集合；② 导出类型名集合；③ faijs 实际调用的方法签名；④ 值类型体（`Vec3`/`Color3`/`BoundingBox`/`Mesh`/`EdgeData`）；⑤ `InitOptions`；⑥ package.json `exports`（含 `./dist/occt-wasm.wasm`）。

## 3. 核对结果（已证实的差异）

### 2.1 类方法集：无删除，新增 8 个
- 3.8.4 `OcctKernel` 共 192 个方法；5.6.0 共 200 个。**被删除 = 0**。
- 新增（5.6.0）：`booleanOp`、`chamferAsymmetric`、`makeHelixWireHanded`、`sectionPlane`、`sweepAdvanced`、`sweepFull`、`toPNG`、`toMultiviewPNG`。
- <br/>均不影响 faijs 现有调用。

### 2.2 导出类型名：无删除，新增若干
- 3.8.4 的类型名全部保留（删除集 = 0）。
- 新增：`BooleanOpOptions`、`BoundingBoxOptions`、`LabelOptions`、`SweepAdvancedOptions`、`SweepFullOptions`、`SweepOrientedOptions`、`SweepToleranceOptions`、`WireframeOptions`、`WireframeSource`。

### 2.3 关键方法签名：稳定一致
- `getSubShapes`、`curveSplit`、`hashCode`、`subShapeHashes`、`buildTriFace`、`sewAndSolidify`、`meshShape`、`exportStep`、`fromBREP`/`toBREP`、`importStep`、`makeBoxFromCorners`/`Cylinder`/`Sphere`/`Cone`、`buildTriFace` —— 两边签名一致。
- `importStl` 形参从 `string|ArrayBuffer` 放宽为 `string|ArrayBuffer|Uint8Array`（兼容更宽，不破坏）。
- 唯一签名变化：`getBoundingBox` 新增一个带 `BoundingBoxOptions` 的重载，但旧的 `(shape, useTriangulation: boolean)` 重载仍然存在 → faijs 用 `(shape, false)/(shape, true)` 不破坏。

### 2.4 XCAF 面：公开 `LabelInfo` 未变，内部 raw 有变化但不影响 faijs
- 公开 `XCAFDocument.getLabelInfo()` 返回的 `LabelInfo` 两边**完全一致**（`{ labelId, name, hasColor, color, isAssembly, isComponent, shapeHandle }`），faijs 读 `info.shapeHandle`（`occtKernel.ts`）不受影响。
- 内部 `RawXCAFKernel.getLabelInfo` 的返回从包含 `shapeId` 改为以 `shapeHandle`（faijs 不直接用 raw KC，忽略）。
- 新增（5.6.0，增量的才可用）：`xcafAddAssembly`、`getReferredLabel`、`getLocation`、`getSubShapes`、`addSubShape`、`addShape({assembly:true})` 使 compound 可导入/导出为装配。

### 2.5 初始化与资源解析：兼容
- `InitOptions` 两边一致（`wasm?: string|URL|ArrayBuffer|Uint8Array`）。
- `package.json` `exports` 完全一致，`./dist/occt-wasm.wasm` 路径保留 → `resolveOcctWasmPath()` 与 `Ctor.init({ wasm: ArrayBuffer })`（`occtKernel.ts:167-170`）不受影响。

### 2.6 description / partNumber：**仍未提供**
- 5.6.0 全量类型声明中 `partNumber`/`part_number`/`productNumber`/`PRODUCT`/desc 的匹配为 0（除去无关注释）。`LabelOptions`、`AddShapeOptions`、`LabelInfo` 均无这两个字段。
- 结论：**升级到 5.6.0 并不提供方案 C 的 desc/partNumber 能力**，它仍是 occt-wasm 上游缺口，需另行在上游 Rust facade 增加绑定（见上一份方案）。

## 4. 需要的变更清单

### A. faijs 必做题（少，几乎为零）
- 升级 `packages/core/package.json` 依赖 `occt-wasm` 从 `^3.8.4` → `^5.6.0`，`npm install` 刷新 `package-lock`。
- 重新生成 api surface / 重新跑 typecheck，排查任何编译层回归（预期无 break，若有按本表分级处理）。**注意**：`occt-wasm` 是第三方依赖、非 `@faicad/*` 家族，不触发 `check-lockstep`，也不走 `set-version`。
- 回归：core 全量（step import/export、3mf、mesh、topology、XCAF assembly 相关）、`packages/tests`、`3d_editor` 导出链路。若 `getImage` 有任何行为差异，固化防回归测试（GOTCHA）。

### B. 可选的 faijs 采用（与 desc/partNumber 目标无关）
- 若编辑器/导入希望保留“装配的骨架结构”，可升级后用新增的 `addShape({assembly:true})` / `getReferredLabel` / `getLocation` 替换现有 `importAssemblyFromStep` 的展平遍历，获得子级装配语义与位置矩阵（当前 faijs 的 walkLabel 需自行用 `getChildren`+`hashCode` 还原，5.6 提供了更稳支持的设施）。**不是本次目标的必需项。**

### C. 不改就无风险的项
- `getBoundingBox`/`importStl`/`isSolid` 等新重载让行为一致；既有二进制 wasm 解析路径、值类型均向后兼容。

## 5. 风险与门槛
| 风险 | 影响 | 对策 |
|---|---|---|
| 5.6.0 未提供 desc/partNumber（已核实） | 升级不推进方案 C | 明确告知这是独立上游缺口，另做绑定 |
| 5.6 的 buildTriFace 等虽名同，数值细节可能有漂移 | 少量 mesh/naming 回归 | 先跑既有测试基线，diff 后定个案；不改的缓做两级测试 |
| 装配新 API 使 faijs 可更易保真读 STEP 装配 | 若采 B 会改动行为 | 划线 B 不在本次范围，若做走独立 PR/测试 |
| 升级到 5.6.0 的最低构建（Rust/emsdk）只在 occt-wasm 上游侧，faijs 只需 npm 依赖 | 无（faijs 不改基本） | 无 |

## 6. 验收标准
1. faijs 依赖为 `occt-wasm ^5.6.0`，`npm install` 后 lock 一致。
2. `npm run typecheck` / 全量单测 / core step+mesh+topology / `packages/tests` 全绿；编辑器 STEP 导出链路全绿。
3. 关键行为：`box→exportStep→import×` 与原有 3MF、assembly 解析结果与 3.8.4 一致。
4. 提交不含 `desc/partNumber` 支持（本方案明确不做）。
5. 升级记录进 Agent Note；本方案状态流转 方案→实施中→已落地。

## 7. 决策点（需用户取舍）
- 本方案只升级到 5.6.0；**是否同时采用 B（装配骨架读者）**。
- `desc/partNumber` 另费独立方案（已写，见另一份方案），本次不混入。
- 确认后我进入实施（改动依赖 + 跑全量 + 修复）+ 提交。