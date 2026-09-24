# Agent Note：脚本面建模能力扩展——剖切族落地（Phase 6/7 收尾）

Status: implemented

[English](2026-09-24-script-face-split-section-ops.md) | 中文

## 背景

《cad 脚本面建模能力扩展》方案（2026-09-24）中，Phase 1–5（零成本提拔 / 中立测量查询 /
造线能力 / 扫掠放样族 / 按面选特征族）已随 `b0c4a92`…`8727eb2` 落地。本轮完成剩余的
Phase 6（剖切族 / mock 补桩 / stale skip 理由校正）与 Phase 7（文档 / Agent Note / 版本号）。

## 本轮改动

### Phase 6.1 — `cad.splitByPlane`（中立，具名双产物）

`api/split-by-plane.ts`：L1 `splitByPlane(shape, point, normal)`（两引擎 `dialect`）薄包装，
声明 `outputs: ['positive', 'negative']`，`positive` = 法向正侧（方案 §3.7 口径）。

**GOTCHA（具名产物在脚本面的消费方式，2026-09-24 实测，测试留档
`api/split-by-plane.test.ts`）**：必须用**解构**消费——

```js
const { positive: part1 } = cad.splitByPlane(p0, { point: [10,10,10], normal: [0,0,1] })
```

两条错误写法都实测失败：

1. `const p1 = cad.splitByPlane(...)` —— 具名 record 整体存进语句变量（plain object），
   outputs 投影只收 `isShapeLike` ⇒ `part1` 丢失。
2. `const p1 = cad.splitByPlane(...).positive` —— 「命名空间调用后链式取成员」不被
   direct-executor 识别（`transformVariable` 只对 `ObjectPattern` 与直接 `CallExpression`
   发射 op 语句），落入裸文本求值 ⇒ `cad is not defined`。

### Phase 6.2 — `cad.sectionByPlane`（中立，1D compound 产物）

`api/section-by-plane.ts`：L1 `sectionByPlane` 交线句柄组 → 逐条 `fromBrepCurve` 登记 1D
curve → L1 `makeCompound` 持句柄打包，顶层经 `fromBrep` 收养（与 `compound-geom` 先例同口径：
持 compound 句柄的**几何复合体**，不是结构壳 `CompoundShape`——结构壳无句柄、不可继续变换）。
空截面 ⇒ 空复合体不抛错。

**GOTCHA（occt 适配器透传语义，2026-09-24 实测，测试留档）**：occt 的 `sectionByPlane` 在
提取不到 edge/wire 子形状时把整个 result compound 透传成**单句柄**
（`occt-primitives.ts` 的 `if (out.length === 0) return [asHandle(result)]`）——空截面时那是一条
空载荷退化曲线。op 内按「无 edge 且无 vertex」过滤退化句柄，保证空截面 ⇒ 空复合体
（不伪造几何，方案原则 9）。

### Phase 6.3 — brep-mock 补桩

`brep/engine/adapters/brep-mock.ts` 按 bbox 近似模型补齐 6 个核心面桩：
`revolveVec` / `sew` / `shell` / `hullFromPoints` / `sectionByPlane` / `splitByPlane`
（并顺手把 `sewAndSolidify` 从固定 1×1×1 改为与 `sew` 同口径的合并 bbox）。mock 仍是
「近似几何 + 全能力声明」的验证载体，不是生产内核（文件头语义不变）。

### Phase 6.4 — stale skip 理由校正

`api/surface/arg-spec.ts`：`loft` / `guidedSweep` / `multiSectionSweep` 的 reason 已在先前
提交校正为「数组入参无障碍（borrowDeep 递归借入）；真障碍是 wire 输入 + 多截面/导轨语义」；
本轮把 §P14 第八片头部注释的同类 stale 文字一并校正。

### Phase 7 — 文档

- `docs/ops-api-inventory.md` / `.zh.md`：随新 op JSDoc 重生成；
- `docs/api-contract.md` §10.1：函数目录补 1D 曲线 / 扫掠放样 / 修复 / 剖切 / 查询各族新成员；
  §7.11：追加脚本面平台 op 与中立 op 的实例说明（1D 产物 `kind:'curve'`，显示经 `wireframe`）；
- 符号表：`gen-symbol-table.ts` 重跑（`splitByPlane` / `sectionByPlane` 进 `check()` 面）；
- 根门面导出：`api/index.ts` 补两条新导出（p23 三源一致「门面 ⊆ 导出面」门禁要求）。

### Phase 7 待裁决 4（后续轮）— occt 独占诊断族以 `inspect*` 命名进脚本面

arg-spec 新增五条 query 条目（`kind:'query'` + `engines:['occt']` + `scriptFace:true`）：
`inspectInterference` / `inspectAllInterferences`（干涉）、`inspectCurvature` /
`inspectCurvatureAtMid`（曲率）、`inspectMassProps`（惯量/主轴/质心）。命名不走 `measure*`
（避免与中立量 volume/area/length 形成误导性双轨）；生成器按 `source` 的 exportName 导入
vendored 实现、按 `name` 声明导出（改名投影），U7 反向护栏按 exportName 回查基线
（`gen-l3-surface.ts` generateModule 相应放宽）。

GOTCHA（vendored 语义，2026-09-24 实测，测试留档 `api/inspect-diagnostics.test.ts`）：
- `PhysicalProps.centerOfMass` 是 `[x,y,z]` **元组**，不是 `{x,y,z}` 对象——对象式读法得 undefined；
- `measureCurvatureAtMid` 输入是 **Face**（solid 报 `uvBounds: TopoDS::Face`）——脚本面用
  `cad.sketch` 平面面（曲率 0）作输入；
- 直调 cad 命名空间（不经 CadRuntime）须自行 `configureBackends`：`brepCapabilities` 传
  `{}` ⇒ directEdit 门 op 全拒；`evolution` 必须是**数组**（传 true 抛
  "boolean true is not iterable"）；Backends 类型要求 texture/assets/events 字段补全。

## 验证

- `api/split-by-plane.test.ts`（4）/ `api/section-by-plane.test.ts`（4）全绿；
- brep-mock 相关 4 套（engine-switch / capability-routing / guard / arg-spec-capabilities）全绿；
- `sweep-loft` / `wire-helix` 回归全绿；
- `p23-cad-face` 三源一致全绿（15 passed / 1 skipped）。
