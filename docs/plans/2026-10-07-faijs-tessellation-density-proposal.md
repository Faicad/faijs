# faijs 三角化密度控制提案

> 提出方：faijs-openscad 转换器（`@faicad/faijs-openscad`）
> 日期：2026-10-07
> 目标 faijs 版本：≥ 0.30.9（当前最新）
> 状态：提案（待 faijs 侧评审）

---

## 1. 问题陈述

faijs-openscad 的 parity 验证将 OpenSCAD `.scad` 模型转为 `.fai.js`，
执行后导出 STL，与 OpenSCAD 官方 STL 做网格度量对账（体积 / 表面积 / bbox IoU / 质心）。
当前 10/22 例 FAIL，**其中 8 例的根因是三角化密度不匹配**：faijs 导出的 STL
比 OpenSCAD 参考 STL 密得多，导致体积差异超出容差。

典型案例 `Functions/functions.scad`：
- OpenSCAD 参考：sphere(r=1) 默认 $fn=5 → 内接五面体，体积 ≈ 2.40/sphere
- faijs 候选：sphere(r=1) BREP 真球 → 64 段三角化，体积 ≈ 4.19/sphere
- 单球差 43%，总体积差 14% → FAIL

**根因**：faijs 的 BREP 引擎（OCCT）保存**精确解析曲面**（真球），
三角化只在导出/显示时发生；而 OpenSCAD 的几何**全程是刻面多面体**，
$fa/$fs/$fn 在创建时即决定面数，布尔运算在刻面上进行，导出即刻面本身。
两种模型的体积在粗刻面下有本质差异。

---

## 2. faijs 当前三角化机制

### 2.1 solidToShape（`src/brep/brep-ops.ts:57`）

```ts
export function solidToShape(kernel, solid, segments?, brepChain?, partName?): Shape {
  const angularDeflection = segments
    ? (2 * Math.PI) / Math.max(3, segments)
    : (2 * Math.PI) / 64  // 缺省 64 段
  const mesh = kernel.meshShape(solid, {
    linearDeflection: DEFAULT_LINEAR_DEFLECTION.as(mm),  // 0.1 mm
    angularDeflection,
  })
  return { positions, indices }
}
```

- `segments` 参数：仅 `cad.sphere(r, { segments })` 等**创建时**传入，
  设置该图元的显示网格密度。
- **布尔运算后**：`booleanBrep`（`src/api/boolean.ts:195`）调用
  `solidToShape(kernel, resultSolid)` —— **segments 传 undefined**，走缺省 64 段。
- `CadRuntimeOptions`（`src/cad-runtime/runtime.ts:313`）只有
  `security` / `execBackend` / `determinism`，**无三角化密度控制**。

### 2.2 exportStl（`src/api/export-stl.ts:118`）

```ts
export function exportStl(shape: Shape, options?: ExportStlOptions): Uint8Array | string
```

**中立 op**：只序列化 Shape 自带的 `positions` / `indices` 载荷，
**不触达内核、不重新三角化**。三角化在 `solidToShape` 时已完成。

### 2.3 当前缺省值 vs OpenSCAD 缺省值

| 参数 | faijs 缺省 | OpenSCAD 缺省 | 倍率 |
|------|-----------|--------------|------|
| angularDeflection | 2π/64 ≈ 0.098 rad ≈ 5.6° | $fa = 12° = 0.209 rad | faijs 细 2.2× |
| linearDeflection | 0.1 mm | $fs = 2 mm | faijs 细 20× |

faijs 的缺省三角化比 OpenSCAD **细一个数量级**，这是体积差异的直接来源。

---

## 3. OpenSCAD $fa / $fs / $fn 语义

OpenSCAD 用三个特殊变量控制刻面密度（全文档 §5 of OpenSCAD manual）：

- **$fa**：最小刻面角度（度）。圆周上相邻顶点对圆心的张角 ≥ $fa。
  → `segments ≤ 360 / $fa`
- **$fs**：最小刻面边长（mm）。相邻顶点的弦长 ≥ $fs。
  → `segments ≤ 2πr / $fs`
- **$fn**：显式面数。若 > 0，直接指定 segments，覆盖 $fa/$fs。

最终：`segments = max(5, min(ceil(360/$fa), ceil(2πr/$fs)))`（$fn=0 时）

**关键**：$fs 是**线性**的（与半径成正比），$fa 是**角度**的（与半径无关）。
这恰好对应 OCCT 的 `linearDeflection` 和 `angularDeflection` 两个参数。

---

## 4. 提案：CadRuntimeOptions.tessellation

### 4.1 API 设计

在 `CadRuntimeOptions` 增加可选字段 `tessellation`：

```ts
export interface CadRuntimeOptions {
  security?: SecurityPolicy
  execBackend?: ExecBackendChoice
  determinism?: DeterminismPolicy
  /** 三角化密度控制（缺省 = faijs 内置 64 段 / 0.1mm）。 */
  tessellation?: TessellationDensity
}

export interface TessellationDensity {
  /**
   * 角度偏差（弧度）。相邻顶点对曲率中心的最大张角。
   * 对应 OpenSCAD $fa（需从度转弧度）。
   * 缺省 2π/64 ≈ 0.098。
   */
  angularDeflection?: number
  /**
   * 线性偏差（mm）。相邻顶点的最大弦长 / 偏移。
   * 对应 OpenSCAD $fs。
   * 缺省 0.1。
   */
  linearDeflection?: number
}
```

### 4.2 传播路径

`createRuntime` 将 `options.tessellation` 存入 `CadRuntime` 实例，
`solidToShape` 从实例读取缺省 deflection（替代当前硬编码 64 段 / 0.1mm）：

```
createRuntime(ports, mode, { tessellation: { angularDeflection: 0.209, linearDeflection: 2.0 } })
  → CadRuntime.tessellation = { angularDeflection: 0.209, linearDeflection: 2.0 }
  → solidToShape(kernel, solid)  // segments=undefined 时读实例缺省
    → meshShape(solid, { angularDeflection: 0.209, linearDeflection: 2.0 })
```

`cad.sphere(r, { segments: N })` 的显式 segments **仍优先生效**（per-primitive override），
不受全局 tessellation 影响——这对应 OpenSCAD 中 $fn 对单个图元的覆盖。

### 4.3 实现改动点（faijs 侧）

1. `src/cad-runtime/runtime.ts`：
   - `CadRuntimeOptions` 加 `tessellation?: TessellationDensity`
   - `CadRuntime` 实例存 `tessellation` 字段
   - 定义 `TessellationDensity` interface（或放 `src/brep/effective-deflection.ts`）

2. `src/brep/brep-ops.ts`：
   - `solidToShape` 增加可选参数 `defaultDeflection?: { angularDeflection?: number; linearDeflection?: number }`
   - segments=undefined 时，若 `defaultDeflection` 提供，用其值；否则用当前硬编码缺省
   - 或：改为从 `getBrepChain()` / 全局状态读缺省（避免改签名）

3. `src/api/boolean.ts`：
   - `booleanBrep` 调 `solidToShape` 时传入 runtime 的 tessellation 缺省

4. `src/api/primitives.ts`：
   - `cad.sphere(r, { segments })` 的 segments 仍优先于全局 tessellation

### 4.4 消费方用法（faijs-openscad 侧）

转换器在 `tests/run-parity.ts` 的 `executeFaijs` 中：

```ts
const rt = createRuntime(ports, 'brep', {
  tessellation: {
    angularDeflection: 12 * Math.PI / 180,  // $fa=12° → 0.209 rad
    linearDeflection: 2.0,                    // $fs=2mm
  },
})
```

若 `.scad` 源码改了 $fa/$fs（如 `$fa=5; $fs=0.5;`），转换器在 emit 时
将这些值写入 `createRuntime` 的 options（需在 .fai.js 头部注入）。

---

## 5. 为什么 deflection 映射比 segments 映射好

### 5.1 方案对比

| 方案 | API | 优点 | 缺点 |
|------|-----|------|------|
| **A. 全局 deflection**（本提案） | `CadRuntimeOptions.tessellation` | 自然映射 $fa/$fs；尺寸自适应；一处设置全局生效 | $fn 显式覆盖需 per-primitive segments（已有） |
| B. 全局 segments | `CadRuntimeOptions.defaultSegments` | 简单 | 不同半径球需不同 segments，一个值无法兼顾 |
| C. per-boolean segments | `cad.union(a, b, { segments })` | 细粒度 | segments 不是布尔语义的一部分；最后一步才生效 |
| D. exportStl 重三角化 | `cad.exportStl(shape, { deflection })` | 导出时控制 | exportStl 需从中立 op 变平台 op；BREP 句柄可能已释放 |

### 5.2 deflection 的尺寸自适应性

$fs = 2mm 对 r=1 球 → segments ≈ 2π×1/2 = 4 → max(5, 4) = 5
$fs = 2mm 对 r=10 球 → segments ≈ 2π×10/2 = 32

`linearDeflection = 2.0` 传给 OCCT `meshShape`，OCCT 内部按曲面曲率自适应：
小球粗刻面、大球细刻面——**与 OpenSCAD $fs 语义一致**。
这是 segments（全局定值）做不到的。

### 5.3 与现有 segments 参数的兼容

`cad.sphere(r, { segments: 100 })`（显式 $fn=100）仍优先生效：
solidToShape 在 segments ≠ undefined 时走 `2π/segments`，
不读全局 tessellation。这对应 OpenSCAD `$fn=100` 覆盖 $fa/$fs 的语义。

---

## 6. 局限性与已知不精确

### 6.1 BREP 精确 vs OpenSCAD 刻面（拓扑差异）

OpenSCAD：sphere(r=1, $fn=5) → **五面体** → union(五面体, 五面体) → 刻面结果
faijs：sphere(r=1) → **真球 BREP** → union(真球, 真球) → 精确结果 → 三角化

两者的**拓扑不同**：OpenSCAD 在刻面上做布尔，faijs 在精确曲面上做布尔再刻面。
体积/表面积会接近（都是内接近似），但**三角形数量和布局不会逐面一致**。
parity 的度量对账（volume/area/bbox/centroid）能通过，但逐三角形对账不能。

### 6.2 $fn 显式覆盖在布尔后丢失

`cad.sphere(r, { segments: 5 })` 设了创建时密度，但 union 后 `solidToShape`
用全局 deflection（非 5 段）。若全局 `tessellation.angularDeflection = 0.209`
（对应 $fa=12°），union 后的刻面密度由 deflection 决定，不回溯 per-primitive $fn。

**实际影响小**：$fn 显式覆盖在 OpenSCAD 中也是创建时的，布尔后 OpenSCAD 同样
不保留 per-primitive $fn（结果是一个新 polyhedron）。差异在于 OpenSCAD 的
布尔在刻面上进行（密度自然继承），faijs 在 BREP 上进行（密度由导出 deflection 决定）。

### 6.3 非球面曲面（NURBS / sweep）

$fa/$fs 原始语义针对圆/球/柱的刻面数。对 sweep/loft 等自由曲面，
OpenSCAD 本身也不用 $fa/$fs（那些是 polyhedron 或线性 sweep）。
faijs 的 deflection 对所有曲面统一生效，对非球面可能过细或过粗。
**建议**：先在球/柱/锥上验证，再推广。

---

## 7. 验证计划

1. faijs 侧实现 `CadRuntimeOptions.tessellation`
2. faijs-openscad 在 `run-parity.ts` 注入 `{ angularDeflection: 0.209, linearDeflection: 2.0 }`
3. 重跑 22 例 parity，预期：
   - functions.scad: volΔ 从 14% 降到 < 1%（刻面密度对齐）
   - example018/019/022: 类似改善（球/柱刻面变粗）
   - example023: 已 PASS（applyMatrix 修复），不受影响
4. 若仍有 FAIL，分析是否为拓扑差异（§6.1）而非密度差异

---

## 7. 验证计划（本仓实施补充，2026-10-08）

### 7.1 实现落点核对（faijs2 现状）

- `src/brep/brep-ops.ts:57` `solidToShape`：缺省 angularDeflection = 2π/64、
  linearDeflection = `DEFAULT_LINEAR_DEFLECTION`（0.1mm，`src/tolerance.ts:26`）。
- 调用点不止 boolean：`api/boolean.ts:192`、`api/boolean-op/index.ts:105`、
  `api/align/index.ts:92`、`api/chamfer.ts:295`、`api/place.ts:84`、
  `api/profile.ts:237/261/264`、`api/punch-hole.ts:241` 等均以缺省段数调用。
- `src/cad-runtime/runtime.ts:313` `CadRuntimeOptions` 目前只有
  `security` / `execBackend` / `determinism`。

### 7.2 测试设计

新增 `packages/core/test/tessellation-density.test.ts`，全部用例标注
`GOTCHA`/`parity` 用途：

1. **缺省不变（防回归）**：不传 `tessellation` 时，`solidToShape` 产出的
   sphere mesh 顶点数与当前实现一致（64 段基线锁定）。
2. **全局粗化生效**：`createRuntime(..., { tessellation: { angularDeflection: 12°,
   linearDeflection: 2.0 } })` 后，布尔结果 shape 的三角形数显著少于缺省；
   体积偏差相对缺省增大但仍为内接近似方向（体积 < 精确球体积）。
3. **per-primitive segments 优先**：`cad.sphere(r, { segments: 5 })` 在
   全局粗化配置下仍产出 5 段密度（`$fn` 覆盖语义，§4.2）。
4. **$fa/$fs → deflection 映射语义**：`linearDeflection=2.0` 时，r=1 球的
   实际段数 ≤ r=10 球的段数（尺寸自适应，§5.2）。
5. **API 面单测**：直接调 `solidToShape(kernel, solid, undefined, undefined,
   undefined, { angularDeflection, linearDeflection })` 传 defaultDeflection
   与经 runtime 传播结果一致。
6. **stderr 零容忍**：测试内故意传非法 deflection（如 0/负数）时按
   Result/OpError 抛出，console.warn/error 先 spy。

### 7.3 验收口径

- 上述测试在 `npm run test -w @faicad/faijs` 全绿，stderr 无输出。
- 跑一次受影响面的既有测试（primitives / boolean / parity 相关）确认无回归。
- 不跑全量 CI 找 bug（铁律）。

---

## 8. 对 faijs 的其它收益

本提案不只服务 faijs-openscad。任何需要**控制导出精度**的 faijs 宿主都能用：
- 3D 打印切片器：粗刻面减小 STL 文件
- 实时渲染：粗刻面提升帧率
- STEP 归档：不受影响（STEP 是精确 BREP，不三角化）

当前 faijs 的 64 段 / 0.1mm 缺省对多数场景过细，本提案给出**宿主可调**的入口。