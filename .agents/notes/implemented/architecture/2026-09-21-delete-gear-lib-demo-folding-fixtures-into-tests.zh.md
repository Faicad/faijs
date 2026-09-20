# Agent Note：删除 `packages/gear-lib-demo`，把它的 fixture 收进 `packages/tests`

> 日期：2026-09-21
> 状态：已实施（faijs 侧）

## 决策记录

1. **gear-lib-demo 本身没有建模能力。** `src/gear.ts` 只有 88 行，转发 core 的 `makeExternalGear` / `makeInternalGear` / `makePlanetaryGear` / `thread`。它真正的价值是那 736 行测试——覆盖第三方库通道（`registerLib` + `autoLift` + `autoLoadLibs` + `fn.outputs` 多输出收编 + BREP `dispatchPath` + STEP `ADVANCED_FACE` + `E_MESH_UNSUPPORTED`）。删包不能删掉这些覆盖。
2. **迁移落点**：`packages/tests/faijs/compat-e2e/_support/gear-lib-demo/`（8 个文件：`gear.ts`、`index.ts`、`mock-mech-brep.ts`、`mock-mech-mesh.ts` + 4 个测试文件）。脚本里的 specifier（`'gear-lib-demo'`）只是字符串，因此只改了两行 import（`gear-flow-fixture.ts:26`、`gear-auto-load-full-namespace.test.ts:15`），10 个 e2e 用例断言逐字未动。
3. **gear 能力现状**：core `src/vendored/brepjs/gear/`（compat 面，冻结不再扩展；`thread` 因不是齿轮而留在 core）+ `@faicad/fai-cq-gears`（15 个工厂，已发布 npm，latest `0.13.1`）。新齿轮能力一律落 `fai_cq_gears`。
4. **`packages/brepjs-compat` 从未存在**——它一直是 core 的子路径导出（`./brepjs-compat` → `dist/api/brepjs-compat/`）。记忆中的那个包是 `mech-lib`，commit `7dcba4e` 改名为 gear-lib-demo。

## 验证

`faijs/compat-e2e`：基线 **8 文件 / 22 用例** → 迁移后 **12 文件 / 43 用例** → 删包后仍 **12 / 43 全绿**。

## 删包过程中踩到的坑

- `packages/tests/package.json` 声明了 `"@faicad/gear-lib-demo": "*"`。不先删它，`npm install --package-lock-only` 会永久保留 lock 里的 workspace 节点（只会降级成 `"extraneous": true`）。正确顺序：先删依赖 → 重生成 lock → 手工删残留节点并用 `JSON.parse` 校验。
- CI 接线有四处提到该包：`scripts/ci.ps1`（`$testPackages`、madge 参数）、`scripts/ci.sh`（madge 参数）、`scripts/check-vendored-branding.mjs`（`MIGRATION_EXEMPT` 与 A4 包列表）、`scripts/gen-importmap.mjs`（`EXCLUDE`）。
- `scripts/gen-ops-api-inventory.ts:185` 硬编码了「第三方库（TS 代码，如 …）」那一行，所以 `docs/ops-api-inventory*.md` 必须重跑生成器（`node_modules/.bin/tsx scripts/gen-ops-api-inventory.ts`），不能手改。

## 遗留

- `D:/Faicad/3d_editor` 仍 import `@faicad/gear-lib-demo`（4 处），且该链路本就断了（faijs 无对应 tgz，其 `node_modules` 也没有）。修法：把同一套 fixture 落进 3d_editor 自己目录、包名不变。
- demo／浏览器侧暂不能换 `fai_cq_gears`：`cq-compat/src/browser.ts` 只导出 `./workplane` + `./assembly`，浏览器拿不到 `getGearKernel()`（`gears.ts` 本身是 browser-safe 的）。
- demo 的 `'gear-demo'` 示例刻意保留（见 `packages/demo/main.ts:134`）：它是「CDN 上没有的库必须显式报错」的唯一 e2e 防回归（`e2e/demo.spec.ts:163`）。
