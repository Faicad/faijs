# Agent Note: 分层 API 移植 — P5 L2 全量面（operations/2d/sketching/io/gear + text）

Status: implemented

[English](2026-09-02-layered-api-p5-l2-surface.md) | 中文

## Problem

P4 打通了第一条 L3 端到端线路，但 L2 面仍然不全：vendored 树里只有 `topology/` + `query/` + `measurement/`（P3 第一批），因此方案的 **P5 门——L2 全量面（`operations/` `2d/` `sketching/` `io/` `gear/`，不含 csg）——无法用 brepjs 自己的测试来验收。** P3 当时把 `2d/blueprints`／sketching 层留到了 P5（"corner/blueprint/sketch 层属 2d/blueprints，留 P5"），所以 P5 必须把整个第二批 API 搬进 vendored 树并跑绿。

## 决策

1. **第二批 L2 面逐字节搬自 brepjs main（b7a3705）**：`operations/`（24 文件：assembly/convexHull/dh/exporterFns/exporters/guidedSweep/history/ik/instance/joint/mate/multiSweep/pattern/roofFns/straightSkeleton/thread/urdf…）、`2d/`（38 文件——lib/、blueprints/ 含 boolean2D/booleanOps/compoundBlueprint/svg/baseSketcher2d/blueprintSketcher）、`sketching/`（11 文件）、`io/`（12 文件）、`gear/`（4 文件）外加 `kernel/solverAdapter.ts`。仅把 `@/` 根别名改写为相对前缀，其余与上游一字不差。
2. **保持 D6 排除，并按方案推迟该推迟的**：`csg/` 继续排除（D6）；`implicit/` 不搬——其唯一模块 `sdfFns.ts` 依赖方案推迟的 `voxel/`。`text/` + `projection/` + `draw3d`/`drawingFactories` 作为 sketching 的依赖闭包一起搬（方案把 text+projection 列在 P5），外加一行极小的 `kernel/occt/wasmTypes/externals.ts` 类型 shim（opentype.js 的 `OpenTypeFont` 接口——纯类型文件，非 OCCT 逻辑）。
3. **测试 harness 照搬 P3 模式**：`packages/tests/faijs/p5-vendored-surface/` — `p5-surface.ts` facade 从 vendored 树重导出 P5 公共 API 面；`kernel-setup.ts` 装配 D10 单实例内核（`initOcctWasm()` + `bindOcctKernel()`，提供 setup.ts 契约名 `initKernel`/`initOC`/`initOCCT`/`currentKernel` 及顶层 `getKernel` 读面）；divergence 注册表与 P3 harness 共用（相对导入 `p3-vendored-surface/kernel-divergences.js`）。brepjs 自带的测试文件拷入 `tests/`，import 从 `@/…/` 改写为 vendored 路径或 facade；唯一的测试侧适配是 `textBlueprints.test.ts` 的字体搜索候选表（上游只列 Linux 系统字体路径；harness 追加 `C:\Windows\Fonts`，让套件能在 win32 上跑）。
4. **验收 = brepjs 自己的测试，跑在全集 vitest 内**：29 文件 / 631 测试，覆盖 `gear`（几何/数学/实体）、`operations`（loft/pattern/extrude/revolve/sweep/convexHull/straightSkeleton 及 assembly/DH/joint/instance/urdf 批次）、`2d`（definitions/offset/boolean2D/blueprints/svg）、`sketching`（f/drawingFactories/compound/draw3d）、几何（curves/approximations/curve2dFns/curve2dGeometry/svgPath）与 `typography`（textBlueprints 用真实 TTF 度量——16/16 零 skip），全部绿；全集基线亦绿（core 880/9、stdlib 46、tests 1269、doc-sync 12 门）。

## 备选方案

- **与一个假的 `voxel` 适配器一起搬入 `implicit/`**（JS→Rust-WASM 桥 shim）。否决：`voxel` 因硬性 WASM 门槛被方案推迟；假适配器只会掩盖真实依赖、让 divergence 注册表撒谎。
- **不拷贝 brepjs 测试，为 P5 另写 faijs 专属测试**。项目自 P3/P4 起就规定：对 vendored 树直接跑 brepjs 自有套件——它既是既定验收，又能立刻暴露导出面漂移（事实如此：harness facade 的导出清单必须精确对照 P5 可见名）。
- **弃用 facade，直接在 harness 里重导出根 `index.ts` barrel**。否决：根 barrel 会引入 `csg/`、`mesh/`、`voxel/` 等 P5 决策排除项——列出 P5 可见名的 facade 才是刻意划定的契约面。
- **静候对 L2 的 TypeScript 级重建再落地**。否决：逐字节移植 + 自己测试绿 + boundary/ghost/隔离编译守卫，就是既定移植策略。

## 后果

- L2 全量面现在跑在 faijs 自家宿主绑定内核上并通过 brepjs 自有测试——237 文件的 vendored 树，boundary/ghost-deps/隔离编译全绿。
- `p5-surface` facade 是可维护的"P5 公共面"地图：P6 只要加宽 L3 重导出，就会先以 facade 缺失条目的形式暴露出来。
- 字体候选回退是本套件与上游测试唯一的测试侧差异；这类跨平台适配放在 harness 而非 vendored 源里是正确的归属。
- 下一步门禁：P6（L3 全量 + 取消 stdlib，以及 D12 兼容 shim）如今有了整层 L2 垫底；P6 的示例集可直接叠在此面之上。