# Agent Note：脚本面建模能力扩展 —— Phase 6–7 收口

Status: implemented

[English](2026-09-24-script-face-modeling-capability.md) | 中文

## 问题

脚本面建模能力的 Phase 0–5 已在提交 b0c4a92 … e2165a4 落地，剩 Phase 6（剖切族 + mock 补桩）与 Phase 7（文档 / 守卫 / 版本）未收口：

- `splitByPlane` / `sectionByPlane` 只存在于 L1 契约面——没有 cad 脚本面 op。
- `brep-mock.ts` 仍把 `revolveVec` / `sew` / `shell` / `hullFromPoints` / `sectionByPlane` / `splitByPlane` 桩成 `unsupported(...)`，mock 引擎无法驱动任何触达它们的编排链路（方案 §2.4⑥）。
- `handle-bridge.ts` 的 `getKernel()` JSDoc 仍写「Get the OCCT kernel instance」，而 D12 早已用类型化的中立出口 `getBrepApi()` 取代它。

## 决定

1. **`cad.splitByPlane(shape, { point, normal })` —— 手写中立 op**（`api/split-by-plane.ts`）。产物形态按方案原则 5：两半是**具名产物** `['positive', 'negative']`，不是数组；positive 是法向所指一侧（L1 契约 §3.7 口径，occt 适配器按质心投影分类）。经 `capabilities: ['directEdit']` 路由；naming 取 `subdivide`（同 `split`）。
2. **`cad.sectionByPlane(shape, { point, normal })` —— 手写中立 op**（`api/section-by-plane.ts`）。L1 产物是边/线句柄**数组**，过不了单产物边界——op 把它收拢为 **1D compound**（`makeCompound`），经 `fromBrepCurve` 登记（方案 §7.1-1①：Phase 3 的登记管线）。平面不与体相交时抛 `E_SECTION_BY_PLANE_NO_INTERSECTION`——此前 occt 适配器把（空的）结果 compound 当「curve」句柄返回，那是静默假产物（违反原则 9），已在适配器修正（`occt-primitives.ts`）：空截面 → release + `[]`。
3. **mock 补桩完成**（`brep-mock.ts`）：六个方法全部补上近似实现（bbox 代数 + 标签），与该文件既有的「引擎切换测试替身」契约一致。它们明确是近似，不是真几何。
4. **`getKernel()` 标弃用**（`brep/handle-bridge.ts`）：JSDoc 纠正（「当前注入的 BREP 内核」，不是「OCCT 内核」）并加 `@deprecated`，指向 `getBrepApi()`（中立）与 `getOcctKernel()`（L2 平台面）。本轮不迁移任何调用点——vendored 面桥接与存量测试继续使用。
5. **文档**：`docs/ops-api-inventory.md` 重生成（自动）；`docs/api-contract.md`/`.zh.md` §10.1 分类表补入所有阶段的脚本面新增（1D 曲线族、扫掠/放样族、特征族、剖切族、中立查询），§7.11 增补一段说明其中哪些声明 `engines: ['occt']`、哪些中立。

## 备选方案（及否决理由）

- **`sectionByPlane` 用 `outputs` 直接返回句柄数组。** 否决：outputs 逐元素包装可行，但方案规定单产物 1D compound（原则 5）；裸的边句柄数组还会在没有 compound 属主的情况下泄漏子形状生命周期。
- **空截面问题改在 op 里修、不动适配器。** 否决：「空结果」方言归适配器所有，未来每个消费者都会遇到；留在 op 层会迫使每个调用方靠试探识别空 compound。
- **本轮迁移所有 `getKernel()` 调用点。** 否决：约 200 处引用，多为 vendored 面与测试；D12 的口径是标弃用而非扫荡。

## 后果

- `cad.splitByPlane` 与 `cad.sectionByPlane` 从 `.fai.js` 可达；两者均中立（brepkit 与 mock 都可用）。
- GOTCHA（测试钉住）：L1 向量形参是 `{x,y,z}` **对象**——元组进内核就是零向量；两个 op 都在边界显式转换并拒绝非有限输入（`E_SPLIT_BY_PLANE_BAD_VEC` / `E_SECTION_BY_PLANE_BAD_VEC`）。
- GOTCHA（测试钉住）：`BrepBoundingBox` 字段是 `xmin/xmax/...`，不是 `min.x/max.x`。
- `brep_mock` 现在能经 shell / sew / revolveVec / hullFromPoints / sectionByPlane / splitByPlane 跑通编排链路（几何是近似，产物是真的）。

## 验证

- `packages/core/src/api/split-by-plane.test.ts`（3 条）：两半带 BREP 句柄的具名产物；positive 在上 / negative 在下且体积之和等于原体；非法向量内核前拒绝。
- `packages/core/src/api/section-by-plane.test.ts`（4 条）：`kind:'curve'` 产物带 compound 句柄；box 在 z=5 截面的包围盒钉死（XY = box、Z 压平到 5）；`wireframe` 出非空有限点列（1D 显示路径，不做伪三角化）；平面不与体相交时显式报错。
- 重生成 `script-face` + 符号表后 `op-set-consistency` 全绿（两个新 op 三源一致）。
- 新 mock 桩下 `engine-switch-p3` + `feature-family` 仍绿；`tsc --noEmit` 干净。
