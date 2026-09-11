# Agent Note: cq-compat 补齐四个齿轮扩展原语（E1–E4）

Status: implemented

[English](2026-09-11-cq-compat-gear-extensions-e1-e4.md) | 中文

## 问题

`fai_cq_gears` 移植需要四个 cq-compat 当时尚未导出的 CadQuery 标准库原语：`Face.makeSplineSurface`（齿面）、`Workplane().makeHelix`（蜗杆螺旋线）、`face.split`（端面裁切）、`Workplane().twistExtrude`（人字齿/缺齿变体）。若 fai_cq_gears 在裸 `occt-wasm` 上自建这些方法，会重复 cq-compat 已做的工作，并重踩原生内核陷阱（实例绑定的 `ShapeHandle`、Vec3 形态、三角化接线）。

## 决策

在 cq-compat 内以薄封装补齐四个原语，使 fai_cq_gears 经 cq-compat API 消费而非直接触碰 `occt-wasm`。每个 op 作为 `export async function` 落在 `packages/cq-compat/src/workplane.ts`，通过共享单例 `getKernel()`（`getKernel() as unknown as OcctKernel`）调用原生内核，并从 `index.ts` 导出：`helix`→`makeHelixWire`、`splitFace`→`halfSpace`+`split`+`getSubShapes`、`twistExtrude`→原生 `rotate`/`translate` 扫截面经 `loft`。`splineFace` 经过两轮：第一版对整块网格调 `bsplineSurface`，但 occt-wasm 此处不给 DegMin/DegMax/Tol3D，只能按内核默认拟合，对 CadQuery `makeSplineApprox` 的相对面积偏差实测 2.269e-4——比计划要求的 4.2e-11 差 7 个数量级。现改为**默认 `row-approx-loft`**（逐行 `approximatePoints(tol=1e-2)` + `loft`），实测 4.2e-11（直齿）/ 5.6e-7（斜齿），一次性整块拟合作保留为 opt-in `strategy: 'grid'`。四个 op 均有完整 JSDoc（repo-wide `verify-export-jsdoc` 门禁）。单元测试（4 文件 11 例）经原生内核构造基类几何并断言尺寸/面积，全部通过；cq-compat 全包 122 测试无回归。

## 考虑的替代方案

- **fai_cq_gears 自建裸 `occt-wasm` 的 `RawOcctKernel`。** 拒绝：重复 cq-compat 的桥接工作，并 reintroduce 实例绑定 `ShapeHandle` 风险；移植已明确改为依赖 cq-compat。
- **扩展 vendored brepjs 层以新增四个方法。** 拒绝：`occt-wasm` 的 `OcctKernel` 已原生声明 `split`/`makeHelixWire`/`bsplineSurface`，无需扩展 vendored 层——它们是薄封装，不是新几何。
- **`twistExtrude` 走路线 B（自建扭转面 + sew + makeSolid）。** 拒绝：路线 A（把旋转+平移的截面副本经 `loft` 放样）已验证可行，且复用 cq-compat 现有机制。

## 结果

- 四个原语（`splineFace`、`helix`、`splitFace`、`twistExtrude`）已从 `@faicad/cq-compat` 导出，可供 `fai_cq_gears` 直接 import。
- 三个关键陷阱已为后续原生 op 记录：occt-wasm 的 `Vec3` 是 `{x,y,z}` 对象（非元组）；`fromHandle` 需要 `configureBackends({ kernel: { brep: getKernel() } })` 提供可三角化内核（直接调 op 不要用 `createRuntime`，其 `kernel.brep` getter 仅在 `runtime.execute` 内填充）；原生 `rotate` 收弧度与 `{ point, direction }` 轴。
- `run-cand` 镜像 parity 状态：`splitFace` 三个 `testSplitKeeping*` 用例全部 PASS；`splineFace`/`helix`/`twistExtrude` 登记 BLOCKED，因偏差根因是工具/内核限制而非 cq-compat 几何差异（插值 vs 逼近曲面拟合；裸 wire STEP 导出有损；OCCT 对近重合 B 样条实体布尔的鲁棒性缺陷）。净 parity 35.69%（PASS 228 / PASS-NT 4 / FAIL 1 / BLOCKED 417）。
- `fai_cq_gears` 现可删除其 `// TEMP-SHIM: delete when cq-compat E{n} lands` 桥接，并从 `packages/fai_cq_gears/src` 移除全部直接 `occt-wasm`/`initOcctWasm`/`RawOcctKernel` 引用。
