# Agent Note: cq-compat 补齐四个齿轮扩展原语（E1–E4）

Status: implemented

English | [中文](2026-09-11-cq-compat-gear-extensions-e1-e4.zh.md)

## 问题

`fai_cq_gears` 移植需要四个 cq-compat 当时尚未导出的 CadQuery 标准库原语：
`Face.makeSplineSurface`（齿面）、`Workplane().makeHelix`（蜗杆螺旋线）、
`face.split`（端面裁切）、`Workplane().twistExtrude`（人字齿/缺齿变体）。
若 fai_cq_gears 在裸 `occt-wasm` 上自建这些方法，会重复 cq-compat 已做的工作，
并重踩原生内核陷阱（实例绑定的 `ShapeHandle`、Vec3 形态、三角化接线）。

## 决策

在 cq-compat 内以薄封装补齐四个原语，使 fai_cq_gears 经 cq-compat API 消费而非直接
触碰 `occt-wasm`。每个 op 作为 `export async function` 落在
`packages/cq-compat/src/workplane.ts`，通过共享单例 `getKernel()`
（`getKernel() as unknown as OcctKernel`）调用原生内核，并从 `index.ts` 导出：
`splineFace`→`bsplineSurface`、`helix`→`makeHelixWire`、`splitFace`→
`halfSpace`+`split`+`getSubShapes`、`twistExtrude`→原生 `rotate`/`translate`
扫截面经 `loft`。四个 op 均有完整 JSDoc（repo-wide `verify-export-jsdoc` 门禁）。
单元测试（4 文件 9 例）经原生内核构造基类几何并断言尺寸/体积，全部通过；
cq-compat 全包 122 测试无回归。

## 考虑的替代方案

- **fai_cq_gears 自建裸 `occt-wasm` 的 `RawOcctKernel`。** 拒绝：重复 cq-compat 的桥接
  工作，并 reintroduce 实例绑定 `ShapeHandle` 风险；移植已明确改为依赖 cq-compat。
- **扩展 vendored brepjs 层以新增四个方法。** 拒绝：`occt-wasm` 的 `OcctKernel` 已原生
  声明 `split`/`makeHelixWire`/`bsplineSurface`，无需扩展 vendored 层——它们是薄封装，
  不是新几何。
- **`twistExtrude` 走路线 B（自建扭转面 + sew + makeSolid）。** 拒绝：路线 A（把旋转+平移的
  截面副本经 `loft` 放样）已验证可行，且复用 cq-compat 现有机制。

## 结果

- 四个原语（`splineFace`、`helix`、`splitFace`、`twistExtrude`）已从 `@faicad/cq-compat`
  导出，可供 `fai_cq_gears` 直接 import。
- 三个关键陷阱已为后续原生 op 记录：occt-wasm 的 `Vec3` 是 `{x,y,z}` 对象（非元组）；
  `fromHandle` 需要 `configureBackends({ kernel: { brep: getKernel() } })` 提供可三角化内核
  （直接调 op 不要用 `createRuntime`，其 `kernel.brep` getter 仅在 `runtime.execute` 内填充）；
  原生 `rotate` 收弧度与 `{ point, direction }` 轴。
- `fai_cq_gears` 现可删除其 `// TEMP-SHIM: delete when cq-compat E{n} lands` 桥接，并从
  `packages/fai_cq_gears/src` 移除全部直接 `occt-wasm`/`initOcctWasm`/`RawOcctKernel` 引用。
