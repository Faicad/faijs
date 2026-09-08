# Agent Note: cq-compat 工作平面栈语义、transformArg 括号、以及装配一致性 STEP 比对

Status: implemented

[English](2026-09-08-cq-compat-workplane-stack-step-compare.md) | 中文

## Problem

三个根因，诊断见 `docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`：

1. **cq-compat 特征操作忽略工作平面栈。** `cutBlind`、`cboreHole`、`cskHole` 和 boss 拉伸只在原点生效：从不遍历 `pushPoints`/`faces(...)` 推入的 `wp.pts`，于是多点特征应用（双槽、双 boss）只在原点生成一个特征，而不是每点一个。CadQuery 语义（workplane「栈」）要求每个特征操作在栈上每个点处生效。
2. **`direct-executor.ts` 在嵌套算术变换中丢括号。** `transformArg` 把 `-((((15-8)/2)+(10/2))+0.555)` 发射成 `-13.445`，静默折叠了含多个负字面量与嵌套括号的表达式。
3. **STEP 比对不是装配一致性比对。** 旧 `compareStepFiles` 只比整件 solid 总数。`slide_top` 案例证明了失败模式：两个独立零件（2 leaf）vs 一个 compound（1 leaf）通过了旧比对，尽管几何不同。STEP 无法预知是否为 compound，因此每次比对都必须经 `compareAssemblyFiles` 遍历导入的装配结构（leaf 数、名字、逐 leaf 几何）。

## Decision

1. **工作平面栈语义**（`packages/cq-compat/src/workplane.ts`）：`resolveFaceSelector` 改为 async，并通过 `getSubShapes(face)` 枚举 BREP 面（极值 bbox 中心；平局取面积大者；`CenterOfMass` 用 `getSurfaceCenterOfMass`、`CenterOfBoundBox` 用面 bbox 中心）。`extrude`/`cutBlind` 遍历 `wp.pts`，每点建工具并以 `OVERLAP` 0.1 union 融合；`cboreHole`/`cskHole` 先捕获 pts，再调一次 `hole()`，随后每点沉/锪孔。顺带修掉两个潜在 bug：normals 表缺 `'+Y'/'-Y'/…'` 六个别名键（导致 `faces('+Y')` 落回 `[0,0,1]` 只切薄片——现已补全 12 键），以及 cbore/csk 圆筒原用朝外的 `result.normal`（悬空不切料，改用 `invNormal`）。
2. **全括号变换发射**（`packages/core/src/cad-runtime/direct-executor.ts`）：`transformArg` 对 Unary/Binary/Logical/Conditional 节点全括号发射；mesh 模式回归断言 `minX = −10.055 ± 1e-6`（丢括号会是 `−14.445`）。
3. **处处装配一致性比对**（`packages/cq-compat/src/assembly-compare.ts`）：`AssemblyCompareOptions.matchNames`（默认 true），`leafCount` 永远强制相等；`fai_cq_gears` 比对脚本切到 `compareAssemblyFiles`（`matchNames: false`）；旧 `compare-step.ts` 重写并加 DEPRECATED 头指向装配比对。`writeAssemblyStep`（`cli.ts`）在首选 `brepSolids` 查找 miss 时保留成员名/颜色：按索引从 `compound.children` 经 `brepOf(child)` 解析成员。

## Alternatives considered

- **保留仅原点特征循环，并对 mini_lathe 脚本特判。** 拒绝：那是掩盖 cq-compat 语义空洞，且违背 CadQuery 栈契约；用户的硬约束要求 pushPoints 后特征操作逐点生效。
- **旧 solid 计数逻辑 + 体积检查走 STEP 比对。** 拒绝：compound-vs-parts 失败是结构性的（leaf 拓扑），不是体积的；只有完整装配遍历（leaves、名字、逐 leaf bbox/体积/COM）才能同时捕获 2-vs-1 案例和 1-product-2-solid 案例。
- **让 `compareStepFiles` 包装 `compareAssemblyFiles`。** 拒绝：保留两个入口会让旧 bug 回来；旧入口被弃用并改线。
- **把 fai_cq_gears 脚手架 typecheck 修复纳入本次变更。** 仅机械性接受：脚手架的 `RawOcctKernel` 缺真实存在的 `getShapeType` 声明，`planarCapAtZ` 的容差参数推断成字面量 `0.01`——这是 HEAD 就存在的类型缺口（阻塞 CI typecheck 门禁）；两处均为纯类型拓宽/声明补齐，无运行时改动。

## Consequences

- cq-compat 回归期望校准：`cutBlind` 双槽 18400/1 solid、`cboreHole` 18532.41、boss 两点 21200/1 solid、`centerOption`（+Y 切 10×30×depth 8）21680/1 solid——全部 ±1；cq-compat 套件 8/8。
- core 套件 1074 passed / 10 skipped（83 文件）；`cli.test` 13/13，含新的装配成员名导出测试。
- `packages/mini_lathe` 基于修复构建重导出：7 个零件（slide_mid 是真实的 2-leaf 零件——base z∈[−3,8] 与 block z∈[11,24.7] 无重叠；legacy 快照同结构），装配 = 6 leaf，名 `axk/bp/mb/mt/slide_top/tp`。`verify-all.ts`（5 项检查：逐零件 leaf 数、装配 6-leaf + 名字、slide_top 体积 88282.5/zmax 21.7、新 vs legacy 的 slide_top 与装配必须 DIFFERENT）全绿。
- legacy `slide_top.step`（修复前 07:44）是含 2-solid compound 的 1 个 product（v=90008.3）：装配比对经几何（体积/bbox/COM）捕获；旧 `gen/slide_top.step` 案例（2 products）经 leaf 数捕获——两种失败形态都覆盖。
- 已知遗留（既有，不在本次范围）：装配约束在 CLI 导出中不生效——`assembly.fai.js` 未调 `asm.solve()`；调用会触发另一个 CLI bug（brep-topology 链的 `INVALID_SHAPE_ID`）。本次未处理。

## Verification

- `npm run test -w @faicad/cq-compat` 8/8；`npm run test -w @faicad/faijs-core` 1074 passed（含 transformArg 括号回归）。
- CI 等价运行（Windows 上 pwsh 不可用——Access denied——故 `scripts/ci.ps1` 的 9 步手工执行）：lint、typecheck（根 + 全部 workspaces，含脚手架类型修复）、build、workspace 测试（core 1074 / gear-lib-demo 21 / sheetmetal / faijs-tests，零 stderr）、守卫（ghost-deps、workspaces-order、madge、api-surface、vendored tsc、layer-boundaries、branding、gen:surface）、demo e2e dev 15 + preview 2、doc-sync 12 项门禁（补了 `packages/mini_lathe` README 双语配对后）、`npm pack`——全绿。
- `packages/mini_lathe/scripts/verify-all.ts` 对重导出的产物重跑干净。
