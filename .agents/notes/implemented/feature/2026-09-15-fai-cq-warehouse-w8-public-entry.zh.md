# Agent Note: fai_cq_warehouse W8 — 公共入口、workspaces 注册与分层门禁

Status: implemented

English | [中文](2026-09-15-fai-cq-warehouse-w8-public-entry.md)

## Problem

`@faicad/fai-cq-warehouse` 是 cq_warehouse（CadQuery 生态库）的 TypeScript 移植。W8 启动时该包缺三样东西：没有公共入口 `src/index.ts`、未注册进 root `workspaces`、移植方案为 W8 规定的分层约束只存在于文字（无机械执行）。缺了这三样，宿主无法消费该包，workspace 级工具链看不见它，「不得直接碰内核」的红线也没有守卫。

## Decision

### 公共入口（`src/index.ts` + `src/contract.ts`）

照 `fai_cq_gears` 入口形状做 barrel 导出：各模块的工厂函数与派生尺寸函数（thread ×5 / nut ×7 / screw ×12 / washer ×3 / bearing ×5 / sprocket ×1）、参数表查询面（`nutTypes`/`nutSizes` 等，即 `types()`/`sizes()` 类方法的函数式等价物）、度量解析器。`contractVersion` 放在 `src/contract.ts`，别名引用 core 的 `CONTRACT_VERSION`（不硬编码），与 gears 包约定一致。`Chain`（P1-a）与孔系列函数（P1-b）**刻意不导出**——它们是未实现的 P1 项，状态记录在下方 Consequences。

### workspaces 注册

`packages/fai_cq_warehouse` 在 root `workspaces` 中紧随 `packages/fai_cq_gears` 之后，满足 `check-workspaces-order.mjs` 的拓扑断言（已验证通过）。

### 分层门禁（`scripts/check-lib-layering.mjs`）

独立静态检查脚本（风格照 `check-ghost-deps.mjs`），作用于该包 `src/` 与 `scripts/`，执行方案的 5 条门禁规则：

1. 禁止 `import 'occt-wasm'`——内核必须经 host 注入的 `requireKernel()`；
2. `initOcctWasm` 只允许出现在 **host 角色**的 `src/test-setup.ts`（库代码自身绝不初始化内核；测试/CLI 侧扮演 host）；
3. 禁止 `getGearKernel`——不得消费另一个第三方库的内部入口；
4. `getBackends()` 只允许出现在 `src/kernel.ts`——其余文件一律经 `requireKernel()`；
5. 禁止 `as any`、禁止 type-only import `OcctKernel`。

规则在剥掉注释/字符串后的源码上运行，文档性提及不会误报。命中任一规则退出码 1（CI 红）。

## Alternatives considered

- **用 eslint `no-restricted-imports` 代替脚本。** 未采纳：仓库已因 peer 版本冲突否决过 eslint-plugin-import（见 `check-ghost-deps.mjs` 头注）；带注释剥离的独立检查器覆盖同样规则，不重开该依赖争议。
- **导出 Chain / 孔系列的桩函数。** 否决：导出未实现的 P1 面会让宿主绑定到空实现；方案要求未实现项记状态，而非留桩。
- **硬编码 `contractVersion = 1`。** 否决：契约须与内核契约锁定；别名 core 的 `CONTRACT_VERSION` 使两者强制同步。

## Consequences

- 消费方经 `@faicad/fai-cq-warehouse` 导入；`npm run test --workspaces` 与 workspace 工具链现在能看到该包。
- 分层规则有机械守卫；回退成直接碰内核会让 CI 变红。
- P1 状态：本包内 **Chain（P1-a）与孔系列（P1-b）未实现**，属方案的 W9 可选项。两者依赖不同（Chain 依赖多产品 STEP + 装配 Location；孔系列依赖 W1 参数表 + W3 IsoThread），可各自独立取舍。任一项日后落地必须回改本 note。

## Verification

- `node scripts/check-lib-layering.mjs` → OK；
- `node scripts/check-workspaces-order.mjs` → OK（10 个 workspace 依赖序正确）；
- 包内 `typecheck` / `lint` / `vitest run` 全绿（运行记录见 PR）。
