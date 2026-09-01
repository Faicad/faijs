# vendored/brepjs — 移植树

本目录是 docs/plans/2026-09-01-layered-api-architecture.md（Layered API 架构）移植 brepjs
的落盘根。状态：**P1 + P2 已落地**（L1 `core/` + `utils/` + L0 kernel 契约 + occtWasm 适配器
已移入、独立编译通过、边界检查全绿、D10 内核单实例绑定已接通并断言）。

## 已移入内容（P1 + P2）

- `core/` —— brepjs L1 17 文件（result / shapeTypes / disposal / errors / validityTypes /
  vecOps / kernelCall / kernelBoundary / planeOps / curve2dHandle 等），原样保留。
- `utils/` —— brepjs L0 工具 10 文件（vec2d / vec3 / quaternion / zip / range /
  precisionRound / bug / uuid / arrayAccess / ioFilename）。
- `kernel/` —— **L0 契约 + 适配器**：
  - `types.ts`、`unsupported.ts`、`kernel2dTypes.ts`、`capabilities.ts`、`quality.ts`、
    `interfaces/*`（16 文件）—— P1 移入。
  - `geometry2d.ts`、`hullGeometry.ts`、`stlBuilder.ts` —— P2 移入（occtWasm 依赖）。
  - `occtWasm/` —— P2 移入，19 文件（occtWasmAdapter / occtWasmTypes / primitiveOps /
    booleanOps / topologyOps / meshOps / ioOps / sweepOps / curveOps / surfaceOps /
    measureOps / modifierOps / transformOps / constructionOps / kernel2dOps /
    evolutionOps / hullOps / repairOps / adapterShims / helpers）。**DI 形态，零
    直接 `import 'occt-wasm'`**，符合 D10 单实例禁令（由 faijs occt 加载器注入同一实例）。
  - `index.ts` —— D10 冻结注册表（`getKernel` 只读冻结 / `registerKernel` 装配期一次 /
    `freezeKernels` 冻结，二度注册抛错）。**无 `withKernel`、无 `init()` 回落**。
- 所有 `@/` 别名 import 已改写为相对路径（D9：`paths: {}`，禁止别名）。

## 桥接点（D10 / R5）

faijs 侧移植树的**唯一**引用点是 L3 桥 `packages/core/src/api/occt-kernel-bridge.ts`：
`initOcctWasm()`（faijs 既有单例）→ `OcctWasmAdapter.fromKernel(同一实例)` →
`registerKernel('occt-wasm', adapter)` → `freezeKernels()`。单实例断言测试在
`packages/tests/faijs/d10-occt-single-instance/`（5 用例，含建模冒烟）。

## 未移入（后续期）

`topology/`、`operations/`、`2d/`、`query/`、`measurement/`、`io/`、`sketching/`、
`gear/`、`implicit/`、`lattice/`、`projection/`（L2）、`api/`（L3）、`lang/`、
`cad-runtime/`、`module-resolver/`（L4）待后续分期；`csg/` 与 `kernel/manifold/` **不移植**。

## 分层映射

- L0 = `kernel/`、`utils/`
- L1 = `core/`
- L2 = `topology/`、`operations/`、`2d/`、`query/`、`measurement/`、`io/`、`sketching/`、
  `gear/`、`implicit/`、`lattice/`、`projection/`
- L3 = `api/`
- L4 = `lang/`、`cad-runtime/`、`module-resolver/`

改名避让：移植 `topology/`、`operations/` 等与既有 faijs `topology/`、`primitives/`
**语义不同**，落地时一律放本根下、不合并不跨越（R4/R5）。

## 强制检查（P1 起）

- 边界：`node scripts/check-layer-boundaries.mjs`（R1 向下 / R2 utils→kernel 禁 / R3 L3+ 禁
  kernel白名单外 / R4 禁 别名+逃出 / R5 反向仅 L3）。P2 落地后全绿（73 文件）。
- 独立编译：`packages/core/tsconfig.vendored.json`（`noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` 严格度对齐 brepjs）；主 `tsconfig.json`/
  `tsconfig.build.json` 已将 `src/vendored` 排除，本树只经自身 tsconfig 编译。
  P1 后 core build 走两段 tsc，主代码只经 d.ts 边界引用此树（阶段验收时接入）。

## License / 来源协议（O9/O10/O13）

移植文件保留 brepjs Apache-2.0 约定与 NOTICE 意符；`packages/brepjs-opencascade`（LGPL）
不搬。brepjs 上游以提交 `8685273a` 为基准锁定（O10），不做双向同步。**O13 已定夺
（2026-09-02，仓主批准：根包 license 从 LGPL-2.0-only 升为 Apache-2.0）**——P1/P2 移植代码
license 与根包一致，无目录级 NOTICE 隔离