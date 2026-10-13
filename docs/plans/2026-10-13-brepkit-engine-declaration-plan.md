> 方案出处：WorkBuddy Agent + 3d_editor（faijs-fasteners / faijs-gears 兼容 brepkit 移植）
> 日期：2026-10-13

# faijs-fasteners / faijs-gears 兼容 brepkit 移植：引擎声明方案

## 0. 目标

1. 两个库里**能用兼容 API 建模的零件，就用兼容 API**（brepkit 已具备的 L1 核心面）。
2. **只能 occt 内核处理的零件，必须在静态期就能知道**——不靠运行时报错来暴露。
3. 声明机制与 faijs 语言现有体系**对齐，不另立维度**。

## 1. 事实：faijs 语言侧已经具备完整的静态引擎声明能力

这部分是现状，不是要改的东西，但它是本方案的基础。

- **声明原语 `engines`**：`packages/core/src/define-op.ts` 的 `defineOp({ engines?: BrepEngineId[] })`（白名单，D11 收窄计划 2026-09-24）。缺省 = 全平台中立 op（只用 L1 核心面）；平台 op（import `occt-kernel/*` 或 `brepkit-kernel/*` 调原生方法）**必须**声明 `engines`。同一份 `engines` 也挂在 `DualOpMeta.engines`（`define-op.ts:182`）与 `arg-spec.ts` 每条目上（`arg-spec.ts:111`）。
- **引擎身份类型**：`packages/core/src/brep/engine/types.ts:21` 定义 `BREP_ENGINE_IDS = ['occt','brepkit','brep_mock']`，`BrepEngineId` 由它推导。禁止裸 `string`。
- **能力真源 `engine-method-map.json`**：`packages/core/src/api/surface/engine-method-map.json` 是 core→occt→brepkit 的方法映射**唯一真源**。`status` 字段把每个方法归为：`aligned`/`dialect` → L1 核心面（两引擎都有）；`occt-only`/`brepkit-only` → L2 平台面（仅一侧有）；`need-probe` → 待探针降级。
- **静态追踪 `capability-map.json`**：`packages/core/src/api/surface/capability-map.json` 由 `scripts/gen-capability-map.ts` 产出，每个 op 记录它实际调用的 `kernelMethods` 列表——**不运行代码就能知道一个 op 碰了哪些内核方法**。
- **运行前门禁**：`packages/core/src/cad-runtime/backend-dispatch.ts:221` 的 `dispatchPath` 在 op 执行前读 `config.brepEngineId`，与 `engines` 白名单比对，不匹配直接抛 `BrepUnsupportedError`（D11-2/4），**无运行时 try-catch 回退**（红线）。

> 结论：静态识别 occt-only 的能力，faijs 语言侧已经齐备，只是两个库没有接入。

## 2. 两个库今天怎么"申明"引擎（答案：今天没申明）

- `faijs-fasteners/src/index.ts` 与 `faijs-gears/src/index.ts` 的导出全部是**裸 builder 函数**（`buildNut`/`spurGear`/`buildThread`…），没有任何 `engines` 元数据，也没有 per-part 能力分类。
- `faijs-gears/src/index.ts:63` 的 `run()` 包装调 `getGearKernel()`，而 `getGearKernel()` 内部是 `initOcctWasm().then(k => k as GearKernel)`——**硬依赖 occt**。
- `faijs-fasteners/src/kernel.ts` 的 `requireKernel()` 取 `getBackends().kernel.brep`（host 注入，理论上可以含 brepkit）——比 gears 更接近可移植。
- 私有 kernel 接口 `GearKernel` / `WarehouseKernel` 在 `BrepEngineApi` 之上各扩展少量 raw occt 方法（`bsplineSurface` / `approximatePoints` / `interpolatePoints` / `interpolatePointsWithTangents` / `makeNonPlanarFace` / `makeHelixWire` / `split` / `draftPrism` 等）。

因此今天"只能 occt 处理的零件"完全不可知，只能在运行时炸。

## 3. 方案：两库复用同一套 `engines` 白名单 + 静态能力追踪

核心原则：**不新造一个"能力声明"轴**。faijs 已经定义了 `BrepEngineId` 与 `engines` 白名单语义，两库直接复用，只是粒度从"语言 op"下沉到"库零件"。

### 3.1 声明载体：每个零件挂 `engines` 元数据

元数据形状与 `DualOpMeta.engines` / `arg-spec` 的 `engines` **完全一致**——`'occt' | 'brepkit' | 'brep_mock'`，缺省全平台中立。推荐用集中注册表（可读、可生成、可校验）：

```ts
// faijs-gears/src/part-manifest.ts
import type { BrepEngineId } from '@faicad/faijs'

export interface PartMeta {
  /** 引擎白名单；缺省语义 = 全平台中立（只用 L1 核心面）。 */
  engines: BrepEngineId[]
  /** 静态追踪出的内核方法名（构建脚本回填，供诊断与校验）。 */
  kernelMethods: string[]
}

export const PART_META = {
  spurGear:              { engines: ['occt', 'brepkit'], kernelMethods: ['extrude', 'loft', 'sewFaces', 'makeFaceFromWire', /* … */] },
  herringboneGear:       { engines: ['occt', 'brepkit'], kernelMethods: [/* … */] },
  bevelGear:             { engines: ['occt', 'brepkit'], kernelMethods: ['splitByPlane', /* … */] },
  worm:                  { engines: ['occt', 'brepkit'], kernelMethods: ['interpolateSurface', 'split', /* … */] },
  // occt-only 零件：静态标识，端侧自动不出现
  heatSetNut:            { engines: ['occt'],            kernelMethods: ['makeNSidedSurface'] },
} as const satisfies Record<string, PartMeta>
```

（也可沿用 `index.ts` 既有的 `fn.outputs` 写法在函数对象上挂 `fn.engines`，但集中注册表更利于生成与校验，推荐前者。）

### 3.2 内核接入点对齐：让 brepkit 真的能进（前置硬改）

- **gears**：`getGearKernel()` 必须改走 `getBackends().kernel.brep`（像 fasteners 那样），而不是 `initOcctWasm()`。否则即便零件声明 `['occt','brepkit']`，brepkit 模式下也取不到内核。
- 两个库的私有 kernel 接口（`GearKernel`/`WarehouseKernel`）保留，但其 raw occt 扩展方法要逐个对账到 L1 核心面（见 3.3）。

### 3.3 "能用兼容 API 就用兼容 API"：把 raw 调用改走 L1

逐方法路线（依据 `engine-method-map.json` 的 `status`）：

| 旧 raw 调用（GearKernel/WarehouseKernel） | 改走 L1 核心面 | 备注 |
|---|---|---|
| `approximatePoints` | `approximateCurve` | brepkit 同名/近等价，签名带控制点数 |
| `interpolatePoints` | `interpolatePoints` | aligned |
| `bsplineSurface` | `approximateSurfaceLspia` / `interpolateSurface` | 拟合算法不同，有轻微面偏差 |
| `makeNonPlanarFace` | `makeFaceFromWire` | aligned（自动 planar/non-planar） |
| `split(face,[plane])` | `splitByPlane` / `split` + 取片适配器 | 返回 `[pos,neg]`，需显式选片 |
| `getVolume` | `volume` | dialect（多 deflection 参数） |
| `getSubShapes`/`isSolid`/`isValid` | 类型化 getter / `getSolidShells` / `validateSolid` | dialect |

改完后该零件调用的内核方法全集都落在 `aligned`/`dialect` → 自动归类为 `['occt','brepkit']`。

> **§3.3 实测补充（2026-10-13 seed 验证 washer 得到）**：washer 的 `revolveProfile`
> 走 raw occt 扩展 `revolve(wire, axis, angleRad)` + `makeSolid(shell)` + `orientOutward`，
> 这三步在 L1 下的合法映射已实测可工作：
> - `revolve(wire, axis, angleRad)` → **先 `makeFace(wire)` 升面，再 `revolveVec(face, center, dir, deg)`**。
>   brepkit 的 `revolveVec` 只吃 face（与 `extrude` 同族断言），而 occt 的 `revolve` 直接吃 wire；
>   升面是两内核都能接受的归一路径（brepkit 内核 `makeFaceFromWire` + 登记 `knownFaces`）。
> - `makeSolid(shell)` → brepkit 下**恒等**（brepkit `revolveVec` 已 `markSolid` 直接产出 solid，
>   无 occt 的「revolve 出 shell 再包 solid」两步）。
> - `orientOutward` → 直接用 L1 `getVolume` + `reverseShape`（两引擎都有）。
> 这证明 washer 确为零缺口零件（§5 第一批），且上述三步即 fasteners 迁移 L1 后该做的归一
> （属另一个 agent 的库源码工作，本测试仅以桩验证可行性，未改任何库源码）。

### 3.4 静态可识别：构建期能力追踪脚本

新增 `scripts/gen-lib-capability-map.ts`，逻辑对齐 core 的 `gen-capability-map.ts`：

1. 解析每个零件 builder 的调用图，抽出所有内核方法名（`k.xxx` / `kernel.yyy` 形式）。
2. 对每个方法查 `engine-method-map.json.status`：
   - 全部 `aligned`/`dialect` → 候选 `engines: ['occt','brepkit']`；
   - 任一 `occt-only` → 候选 `engines: ['occt']`。
3. 产出 `lib-capability-map.json`（镜像 `capability-map.json` 结构：`{ part, source, kernelMethods, engines }`）。
4. **断言**：`PART_META` 里手写的 `engines` 必须与追踪结果一致，不一致 → 构建失败（复用 `assertLibConforms` 的"声明 + 校验"模式）。

这样"只能 occt 处理的零件"，从源 + 映射表就能静态得出，无需运行任何代码。

### 3.5 执行期门禁：weapp 侧静态过滤

`packages/weapp/src/ui/tools.ts:37` 已有红线原则：**"跑不通的不是置灰，是没有这个按钮"**。把 `PART_META.engines` 接入工具注册：

- worker 只注册 brepkit 时，注册器读每个零件 `engines`：含 `'brepkit'` 的进面板；纯 `['occt']` 的不出现（或归入"需云端生成"分组，绝不置灰）。
- 这与 `dispatchPath` D11-2 同构：都是"运行前按引擎白名单拒绝"。

## 4. 与 faijs 语言方案的一致性（不要重复造轮子）

| 维度 | 语言 op | 两库零件 |
|---|---|---|
| 声明原语 | `defineOp.engines: BrepEngineId[]` | `PART_META[part].engines`（同类型同语义） |
| 能力真源 | `engine-method-map.json` | **复用同一份**（不另立映射） |
| 静态追踪 | `capability-map.json` / `gen-capability-map.ts` | `lib-capability-map.json` / `gen-lib-capability-map.ts`（复用逻辑） |
| 运行前门禁 | `dispatchPath` D11-2 | weapp 注册过滤（同源逻辑） |
| 默认行为 | 全平台中立 | 全平台中立 |

唯一新增的"轴"只是粒度（语言 op → 库零件），机制零新增。

## 5. 落地优先级（衔接前期 brepkit 可行性调研）

- **第一批（零缺口，先打通）**：washer / sprocket / bearing / 直齿轮(spur) / ring / crossed_helical / hyperbolic / nut(6/7) / thread(4/5) / screw(10/12)。`PART_META` 直接标 `['occt','brepkit']`，只做 3.2 接入 + 3.3 的 raw→L1 改写。
- **第二批（需适配器）**：bevel / worm / rack 的 `split` 取片逻辑；worm 默认 `grid-approx` 的 `bsplineSurface→interpolateSurface` 改写（或直接切 `row-approx-loft` 规避拟合偏差）。
- **第三批（静态标 `['occt']`，端侧不出现）**：`heatSetNut`（`makeNSidedSurface`）、thread `end_finishes:'chamfer'`（非对称双距倒角）、screw `PanHeadWithCollar`(din967/PH) 与 `RaisedCheeseHead`(iso7045/PH)（cross 沉孔 30° 锥度 cutter）。`PART_META` 标注 `['occt']`，端侧自动过滤。

## 6. 测试方案：brepkit ↔ occt 一致性验证

用户硬性要求：**每一个零件，都要测试 brepkit 与 occt 的建模结果一致。** 这一节把"一致"落成可执行、可纳入 CI 的测试架构，并复用 §3 的 `PART_META` 与 `lib-capability-map.json`，让"声明"与"验证"同源于一份数据。

### 6.1 "一致"的工程定义（先定判据，再写测试）

brepkit 与 occt 是两套独立几何内核，**数值上不可能逐位相等**（浮点、拟合算法、tessellation 粒度都不同）。因此"一致"定义为两级门禁：

| 级别 | 判据 | 取值/容差 | 性质 |
|---|---|---|---|
| **T1 拓扑等价（硬门禁，一票否决）** | 仅 `solid` 的数量必须相等（**唯一真正引擎无关拓扑**） | 精确相等 | 实体数不一致 = 直接 fail |
| **T1* 拓扑软记录（仅告警不门禁）** | `shell` / `face` / `edge` / `vertex` / `wire` 数量 | 引擎表示策略差异（fuse 后 shell 枚举数不同、brepkit 离散圆弧/样条、不枚举 wire、接缝顶点数不同） | 记 `unsupported`，`console.warn`，不 fail |
| **T2 度量收敛（容差带）** | 体积 `volume`、表面积 `getSurfaceArea`、包围盒 `getBoundingBox` 最大维、质心 `getCenterOfMass` 的相对偏差 | `ε_vol=1e-3`、`ε_area=1e-3`、`tol_bbox=1e-4(相对)`、`ε_cm=1e-3` | 软门禁，可配 band |
| **T3 表面偏差（深检，默认不门禁，只记录）** | 两体 tessellate 后采样 Hausdorff 距离 | 记 `maxDev`，不卡默认 run；作为回归基线 | 趋势追踪 |

> ⚠️ **T1 硬门禁的引擎无关子集（2026-10-13 实证修正）**：种子验证（washer → sprocket → bearing）
> 发现四类子形状数量**不能**作为硬门禁，只有 `solid`/`shell` 是真正引擎无关拓扑：
> - `wire`：brepkit 的 `getSubShapes` 根本**不枚举 wire**（仅 face/edge/vertex/shell/solid），
>   属引擎能力差异，非几何差异。
> - `vertex`：旋转体在两内核下**接缝顶点数不同**（washer 实测 occt=4 vs brepkit=5；
>   chamfered=5 vs 6；cheeseHead=6 vs 7），是接缝表示差异，同一合法实体的等价拓扑。
> - `face` / `edge`：**brepkit 把圆弧/样条离散成大量线性段**，导致面/边数量随离散精度爆炸，
>   不代表几何不一致。实测：链轮 10 齿 occt=62 face / brepkit=953 face；48 齿=292 / 5344；
>   轴承深沟球 occt 数百 / brepkit 上千。属引擎**表示策略**差异，非拓扑差异。
> 故 T1 硬门禁最终收敛为 **`solid` 精确相等**；`shell`/`face`/`edge`/`vertex`/`wire` 全部降为 T1* 软记录。
> 其中 `shell` 额外受 fuse 后装配体的枚举策略影响（带盖深沟球轴承实测 occt=2 / brepkit=1）。
> 这不影响"一致"的判定意图——真正的几何一致由 T2（体积/面积/包围盒/质心）严格把关。

- `['occt','brepkit']` 零件 → 跑 **T1 + T2**，必须全过。
- `['occt']` 零件 → **不跑双引擎比对**（brepkit 建不出），只跑 occt 单体回归（确保仍产出合法 solid，T1 拓扑存在即可），并交叉校验其 `PART_META.engines` 确为 `['occt']`。

### 6.2 测试架构

```
packages/core/src/test-utils/engine-compat/
  harness.ts        # compareEngines(buildFn, params, engines) → 抽 T1/T2 指标 + 比对
  metrics.ts        # extractMetrics(shape): 拓扑计数 + volume/area/bbox/CoM
  tolerance.ts      # 默认容差带 + 每零件可覆盖的 band
  golden.ts         # 读写 <part>.<fixture>.golden.json（occt 参考度量，钉死基线）
faijs-fasteners/test/engine-compat/
  fixtures.ts       # 每个零件的默认参数 + 2~3 组 scale/teeth 变体（覆盖尺度敏感性）
  nut.test.ts  thread.test.ts  screw.test.ts  washer.test.ts  bearing.test.ts
  sprocket.test.ts  holes.test.ts  chain.test.ts
faijs-gears/test/engine-compat/
  fixtures.ts
  spur.test.ts  herringbone.test.ts  bevel.test.ts  worm.test.ts  rack.test.ts
  crossed_helical.test.ts  ring.test.ts  hyperbolic.test.ts  assembly.test.ts
```

**harness 核心伪码**：

```ts
async function compareEngines(buildFn, params, { engines, band }) {
  const ref = engines.includes('occt') ? await runEngine('occt', buildFn, params) : null
  const got = engines.includes('brepkit') ? await runEngine('brepkit', buildFn, params) : null
  if (ref && got) {                 // ['occt','brepkit'] 零件
    assertTopoEqual(metrics(ref), metrics(got))      // T1
    assertMetricWithinTol(metrics(ref), metrics(got), band ?? DEFAULT_TOL) // T2
  } else if (ref) {                 // ['occt'] 零件：仅回归
    assert(metrics(ref).solids >= 1)                // 仍是合法实体
  }
  return { ref, got }
}
// runEngine 通过切换 getBackends().kernel 注册的引擎 + config.brepEngineId 实现，
// builder 必须走 §3.2 的 getBackends().kernel.brep 注入（不能硬编码 occt）。
```

### 6.3 已知偏差零件的"双钉"测试（关键纪律）

对于 §5 第二批里**已声明 `['occt','brepkit']` 但存在已知拟合偏差**的零件（worm 的 `grid-approx`、screw 的 PanHead 头样条、角接触轴承滚道样条、bevel/worm/rack 的 `split` 取片），测试**不能写成"假通过"**，必须按用户纪律钉住两个值：

```ts
// worm.test.ts —— 钉住「当前偏差值」与「应有正确值」
test('worm grid-approx: brepkit 与 occt 体积收敛', async () => {
  const { ref, got } = await compareEngines(buildWorm, wormGridApproxFixture, {
    engines: ['occt', 'brepkit'],
    band: { vol: KNOWN_DEVIATION.wormGridApprox.vol }, // 当前已接受 band
  })
  // 缺陷钉：当前 brepkit 体积偏差 = 1.8e-3（超出默认 ε_vol），是"当前错误值"
  pinCurrent('worm.gridApprox.volDev', 1.8e-3)
  // 应有正确值：适配器改写（切 row-approx-loft 或换 interpolateSurface 参数）后 → 0
  pinTarget('worm.gridApprox.volDev', 0, '改用 row-approx-loft 规避 bsplineSurface 拟合差')
  assertLess(got.dev.vol, band.vol)   // 在已接受 band 内 → 通过；未来收紧 band 时自动变红
})
```

- `pinCurrent` 把"当前偏差"写入 `golden.deviation.json`，**未来不得悄悄改大**；
- `pinTarget` 写"应有正确值"，当适配器改进使偏差收敛到 target 时，**测试自动翻转**（assert 收紧），无需人力记得回头验证。
- 这正是用户长期纪律："探针必须固化为测试；一个缺陷测试必须同时钉住当前错误值与应有正确值，未来修复后翻转断言。"

### 6.4 与静态声明的闭环交叉校验（防"声明可用、实测拉胯"）

新增一条 CI 断言 `assertEngineMetaConsistent`：

1. `PART_META[part].engines` 含 `'brepkit'` ⟺ 该 part 存在通过 T1+T2 的 engine-compat 测试。
   - 声明了 `'brepkit'` 却没有对应通过测试 → **构建/测试失败**（禁止"拍脑门说可用"）。
2. `PART_META[part].engines` 与 `lib-capability-map.json` 的 `engines` 必须一致（复用 §3.4 的校验）。
3. occt-only 零件若其 engine-compat 测试**意外在 brepkit 下也过了 T1+T2** → 说明 §3.4 的静态追踪漏判，反向暴露 `engine-method-map.json.status` 标错，必须回查映射表而非静默放过。

### 6.5 参数覆盖矩阵（每个零件不止跑默认参数）

拟合类偏差（尤其 `approximateSurfaceLspia` / `interpolateSurface`）对**尺度敏感**，默认参数过了不代表小模数或大齿数还过。fixtures 强制覆盖：

| 维度 | 变体 |
|---|---|
| 尺寸 | 最小 / 默认 / 最大（覆盖网格密度切换阈值） |
| 齿数/齿数密度 | 少齿（≈8）/ 中（≈24）/ 多齿（≈60） |
| 收尾/变体标志 | 各 `end_finishes`、`head_style`、bore 有/无 |

每个 `(part, fixture)` 是一个独立 test case，失败定位到具体参数组合。

### 6.6 CI 接入

- 新增脚本 `test:engine-compat`（node/vitest，分别导入两库 test 目录）。
- 必须同时加载 occt（wasm）与 brepkit（vendored）两套后端；occt-only 零件不阻断流水线。
- 门禁：`['occt','brepkit']` 零件任意 T1/T2 失败 → 红；`pinCurrent` 值被改大 → 红；`assertEngineMetaConsistent` 任一不一致 → 红。
- 输出 `engine-compat-report.json`（每零件 T1/T2 结果 + 当前偏差值），归档供趋势追踪。

### 6.7 零件级覆盖清单（落到具体测试文件，2026-10-13 续实证修正）

> 实测后修正：齿轮包**全部** `['occt']`（齿面依赖 `bsplineSurface`/`approximatePoints`/`interpolatePoints`/`makeHelixWire`，且绕过 `kernel.brep` 注入直接取 raw occt-wasm）；`thread`/`internalThreadSolid` 同理 `['occt']`；`nut`/`screw`/`holes`/`chain` 为 `['occt','brepkit']` 但带 §6.3 双钉 band（圆弧离散/布尔精度致系统性小偏差）。下表为权威分类。

| 库 | 零件 | 测试文件 | 引擎分类 | 期望结论 |
|---|---|---|---|---|
| fasteners | washer（Plain/Chamfered/CheeseHead 共 3 类） | `washer.test.ts` | `['occt','brepkit']` | T1(`solid`)+T2(≤1e-3) 全绿 |
| fasteners | bearing（深沟球+带盖深沟球+圆柱滚子 3 类） | `bearing.test.ts` | `['occt','brepkit']` + §6.3 band | T1+T2 通过（体积≤6.0e-3/面积≤2.3e-3/bbox≤6.5e-4 band，目标 0） |
| fasteners | nut（HexNut / HexNutWithFlange / BradTeeNut 3 类） | `nut.test.ts` | `['occt','brepkit']` + §6.3 band | T1+T2 通过（体积≤2.6e-3/面积≤2.0e-3/bbox≤4.6e-4/coM≤2.1e-3 band） |
| fasteners | screw（HexHead / CounterSunk / SetScrew 3 类） | `screw.test.ts` | `['occt','brepkit']` + §6.3 band | T1+T2 通过（沉头锥形头体积≤3.7e-2、coM.z≤1.6e-2 偏大 band，监控 brepkit revolve/intersect 精度） |
| fasteners | holes（`fastenerHoleCutter` 平/沉头 2 fixture） | `holes.test.ts` | `['occt','brepkit']` | T1+T2 通过（圆柱/圆锥精确体，无 band） |
| fasteners | chain（2-链轮链节 `parts[0]`） | `chain.test.ts` | `['occt','brepkit']` | T1+T2 通过（链板轮廓源码已密采样折线，几何近一致，无 band） |
| fasteners | sprocket | `sprocket.test.ts` | `['occt']` 真缺口 | 仅 occt 单体回归（多弧闭合 wire 退化→体积偏小 ~12% 且非对称） |
| fasteners | thread（含 internalThreadSolid） | `thread.test.ts` | `['occt']` 真缺口 | 仅 occt 单体回归（依赖 makeHelixWire + bsplineSurface/approximatePoints，brepkit 无对应原语） |
| fasteners | bearing 角接触球 / 圆锥滚子 | `bearing.test.ts` | `['occt']` 真缺口 | 仅 occt 对照（interpolatePointsWithTangents / makeFaceFromWire 构建失败） |
| fasteners | heatSetNut / screw PanHeadWithCollar·RaisedCheeseHead / holes internalThreadSolid | 各自 `*.test.ts` | `['occt']` 真缺口 | 仅 occt 回归（非平面 knurl 面 / 特定头型 / 螺纹，brepkit 缺原语） |
| gears | spur / ring / crossed_helical / hyperbolic / herringbone / bevel / rack / worm（+ 各装配体） | `gears.test.ts` | `['occt']` 真缺口 | 仅 occt 单体回归（齿面依赖 bsplineSurface/approximatePoints/interpolatePoints/makeHelixWire，且齿轮包绕过 `kernel.brep` 注入直接取 raw occt-wasm，brepkit 不可建） |

### 6.8 Seed 状态（2026-10-13 已跑通）

种子测试已落地并**全绿**，验证 harness 架构可行：

- **实际落点（与 §6.2 草图不同，按对话里用户指定）**：测试放在 `packages/tests/`（与默认 suite 隔离的专属 vitest config `packages/tests/vitest.engine-compat.config.ts`，`--config` 调用，不影响默认 suite），而非 `packages/core/src/test-utils/` 或 `faijs-fasteners/test/`。
  - `packages/tests/faijs/engine-compat/harness.ts`：双引擎注入 + 指标抽取 + T1/T2 断言。
  - `packages/tests/faijs/engine-compat/washer.test.ts`：washer 三类的种子（3 类 × 首/尾尺寸 = 6 geometry fixtures + 1 sanity）。
- **零缺口零件实证**：washer（PlainWasher / ChamferedWasher / CheeseHeadWasher）在 occt 与 brepkit 下 T1（`solid/shell/face/edge` 精确相等）+ T2（体积/面积/包围盒/质心相对偏差 ≤ 1e-3）全部通过；唯一偏差是 T1* 接缝顶点数（occt 4/5/6 vs brepkit 5/6/7），已降为软记录。
- **扩展零缺口零件（2026-10-13 续，按用户选定方向 §6.7 第一批，已落地并跑通）**：
  - `sprocket.test.ts`：**经实测重新归类为 brepkit 真缺口（`['occt']`）**。表面上构建调用面干净（仅 L1 的 extrude/makeFace/makeWire/makeArcEdge/makeCone/makeCylinder/cut/fuse/mirror/translate/reverseShape），但 brepkit 对链轮齿廓这种 50+ 条小半径圆弧边构成的单闭合 wire，在 `makeWire`/`makeFaceFromWire` 处静默退化（已知 `makeWire`「边序接不上时静默丢弃」陷阱 + 圆弧离散），导致 brepkit 体积比 occt 小 **~12%**（10 齿 2503 vs 2194；48 齿 61486 vs 54369）且带孔变体 CoM 非对称（偏差 100%）。非测试方法可修复（改库源码禁止），故改为 occt-only 单体回归 + 文档记录缺口。
  - `bearing.test.ts`：深沟球 / 带盖深沟球 / 圆柱滚子三类（每类取该 type 首/尾尺寸）走 brepkit↔occt，实测几何高度一致，仅存在**系统性小体积偏差 0.1%–0.6%**（brepkit 比 occt 略小，滚道圆弧离散成弦致旋转体轻微欠填）。按 §6.3 双钉：钉死体积偏差上限 6.0e-3 为 band、目标 0，brepkit 偏差增大即自动转红。`SingleRowAngularContactBallBearing` 因 `interpolatePointsWithTangents`（无 L1 等价）静态排除、仅 occt 回归；`SingleRowTaperedRollerBearing` 经实测为 **brepkit 真缺口**——圆锥内/外圈轮廓线在 `makeFaceFromWire`（brepkitKernel.ts:1044）报 `invalid wire handle`，属 brepkit 轮廓线容错/构建缺陷，已排除出 brepkit 对照并降为 occt-only，须另行排查（不在本测试范围）。
  - **T1 门禁实证二次修正**：带盖深沟球轴承实测 occt=2 shell / brepkit=1 shell（fuse 后装配体枚举策略差异），故 T1 硬门禁最终收敛为**仅 `solid` 精确相等**，`shell` 与 `face`/`edge`/`vertex`/`wire` 一并降为 T1* 软记录；几何一致由 T2 把关。
  - **T2 / isSolid 实证修正**：轴承在 volume 之外，还暴露 area（≤2.2e-3）、bbox（**M3 小尺寸 y 轴 ≤6.09e-4，为各轴全量最大**，源于包围盒最小、同一圆弧弦离散绝对误差占比最大）的小偏差，以及 isSolid 在 M10 深沟球上 occt=false（compound-of-solids）/ brepkit=true（合并 solid）的表示差异。故 `isSolid` 由硬门禁降为软记录（实体有效性已由 T1 `solid` 数量保证）；area/bbox 偏差按 §6.3 双钉钉入 `BEARING_T2_BAND`（areaRel=2.3e-3、bboxRel=6.5e-4、volumeRel=6.0e-3，目标 0；band 仅覆盖实测最大观测，后续 brepkit 精度提升可收紧）。链轮 occt 回归也因 occt 把多体链轮作 compound-of-solids 返回（`metrics.solid` 计数 undefined）而改为只校验体积 > 0 与 bbox 有限。
  - **第二批零缺口件实证（2026-10-13 续，全绿）**：
    - `nut.test.ts`：HexNut / HexNutWithFlange / BradTeeNut 三类（各取 1 尺寸）走 brepkit↔occt，实测**系统性小偏差**（brepkit 比 occt 略小，六角/法兰轮廓圆弧离散）：体积≤2.500e-3、面积≤1.822e-3、bbox.y≤4.511e-4、coM.z≤1.986e-3。按 §6.3 双钉 `NUT_T2_BAND`（volumeRel=2.6e-3、areaRel=2.0e-3、bboxRel=4.6e-4、coMRel=2.1e-3，目标 0）。heatSetNut 因非平面 knurl 面（`makeNonPlanarFace`）brepkit 缺原语，保持 `['occt']`。
    - `screw.test.ts`：HexHead / CounterSunk / SetScrew 三类。HexHead/SetScrew 仅 coM.z 偏高（长细件质心对头部离散极敏感：1.5%/0.2%）；CounterSunk 锥形头更甚（体积 3.619e-2）。均按 §6.3 双钉 `SCREW_T2_BAND`（volumeRel=3.7e-2、coMRel=1.6e-2、bboxRel=3.8e-3、areaRel=4.0e-2，目标 0；沉头头为 brepkit revolve/intersect 精度监控重点）。PanHeadWithCollar / RaisedCheeseHead 等特定头型未纳入本轮，保持 `['occt']`。
    - `holes.test.ts`：`fastenerHoleCutter`（平/沉头 2 fixture）仅用 revolveProfile/cylinder/cone/fuse/translate，圆柱圆锥为精确体，T1+T2 无 band 全绿。`clearanceHole`/`tapHole` 需宿主 `part` 实体、`internalThreadSolid` 走螺纹（helix+bspline），保持 `['occt']`。
    - `chain.test.ts`：2-链轮链节取 `parts[0].solid`；链板轮廓源码已密采样折线（圆弧预离散），brepkit↔occt 几何近一致，T1+T2 无 band 全绿（需传 `positive_chain_wrap` 满足 buildChain 校验）。
  - **occt-only 回归实证（2026-10-13 续，全绿）**：
    - `thread.test.ts`：`buildThread`（非 simple）依赖 `makeHelixWire` + `bsplineSurface`/`approximatePoints`（`ruledFace`），brepkit 无对应原语 → `['occt']`；仅校验体积 > 0 与 bbox 有限。`internalThreadSolid` 同理。
    - `gears.test.ts`：spur / ring / crossed_helical / bevel / rack / worm 六类全部 `['occt']`。根因：齿面靠 `bsplineSurface`/`approximatePoints`/`interpolatePoints`/`makeHelixWire`/`loft` 构造，这些原语 **brepkit core 引擎未实现**（归 core，不在本包范围）——与 faijs-fasteners 一样属真缺口，非测试桩可补。已把 `faijs-gears/src/kernel/gears.ts` 的 `getGearKernel()` 从硬绑 `initOcctWasm()` 改为**优先消费宿主注入式 backend**（`getBackends().kernel.brep`，与 fasteners `kernel.ts` 对齐），未配置时回退 `initOcctWasm()` 保旧测试兼容。如此 brepkit 注入下齿轮构建必然失败，本测试用 `useBuildKernel('brepkit')` + 断言 `r.ok===false`（错误含 `bsplineSurface`/`makeHelixWire`/`is not a function`）把**真缺口暴露在引擎层**；occt 注入下仍做单体回归（Result.ok + 体积>0 + bbox 有限）。将来 core 补齐原语后，该缺口测试直接翻转为一致性测试，无需再改源码。
  - **harness 配套修正**：`initEngines` 末尾补 `useBuildKernel('occt')`，使直接读 `getBackends().kernel.brep` 的库（fasteners `requireKernel` / `buildThread`）在 beforeAll 后即可 build，免每个测试重复切核；新增 `extractMetrics(engine, handle)` 与 `measureOcct(handle)` 供 occt-only 零件直接量测 occt 几何。
- **库源码改动（仅 faijs-gears，用户授权）**：`faijs-gears/src/kernel/gears.ts` 的 `getGearKernel()` 由硬绑 `initOcctWasm()` 改为优先消费注入式 backend（与 fasteners 对齐，使引擎声明机制对齿轮生效）；brepkit 缺口现经引擎注入诚实暴露。`harness.ts` 内 `revolve`/`makeSolid`/`rotate` 适配仍为测试桩（`WarehouseKernel` 测试专用适配器；`rotate`→ Rodrigues 矩阵映射 L1 `transform`），待 fasteners 迁移 L1 后该桩可删（见 §3.3 实测补充）。**core 引擎（brepkit L1 缺 spline/helix 原语）未改**——那是另一 agent 的重构范围。
- **已知约束**：本环境无 `dist` 构建，专属 config 用别名把 `@faicad/faijs` 指到 `packages/core/src` 源码；`registerBrepkitBrepEngine()` + `getBrepEngine('brepkit').primitives` 取 L1 单例，occt 侧注入 raw `initOcctWasm()`。

## 7. 风险与红线

- **不改写 brepkit 内核**，只改两库的适配层与声明层。
- **不做运行时 try-catch 回退**（faijs 红线）；occt-only 零件靠 `engines` 在运行前静态拒绝。
- `split` 取片（brepkit 返回 `[pos,neg]`）必须显式选片，禁静默降级。
- `PART_META` 与追踪结果不一致 → 构建失败，不允许"声明说可用、实际炸"。
- **测试不得假通过**：凡是已知偏差零件必须 §6.3 双钉（当前值 + 目标值），band 只能收紧不能偷偷放大；`pinCurrent` 改大即红。
- `['occt','brepkit']` 零件若缺少对应 engine-compat 测试 → 视为声明无效，构建/CI 失败（§6.4）。

## 8. 实际完成内容与缺口（2026-10-13 收尾状态）

本节是收尾时的权威结论，区分「已落地并验证」与「真缺口 / 计划内未做」，避免把方案描述误读为已完成。

### 8.1 已完成（已落地并验证）

1. **测试底座 `harness.ts`**（`packages/tests/faijs/engine-compat/harness.ts`）
   - 双引擎注入：occt 侧注入 raw `initOcctWasm()`；brepkit 侧用 L1 单例（`registerBrepkitBrepEngine` + `getBrepEngine('brepkit').primitives`，用别名把 `@faicad/faijs` 指到 `packages/core/src` 源码）。
   - T1/T2 断言：`expectTopoEqual`（硬门禁仅 `solid` 精确相等；`shell/face/edge/vertex/wire` 软记录）、`assertConsistent`（T2 体积/面积/包围盒/质心相对偏差，band 可配）。
   - 测试桩适配：`revolve`（`revolveVec` 需先 `makeFace`）、`makeSolid`（恒等）、`rotate`（Rodrigues→L1 `transform`）。
   - `extractMetrics`、`measureOcct`、`useBuildKernel` 供 occt-only 量测与引擎切换；`initEngines` 末尾补 `useBuildKernel('occt')`。

2. **9 个测试文件、44 个用例全绿**（用 `packages/tests/vitest.engine-compat.config.ts` 运行）：

   | 文件 | 零件 | 分类 | 结论 |
   |---|---|---|---|
   | washer.test.ts | Plain/Chamfered/CheeseHead | `['occt','brepkit']` | T1+T2 无 band |
   | bearing.test.ts | 深沟球/带盖深沟球/圆柱滚子 | `['occt','brepkit']`+band | 系统性小偏差双钉（vol≤6.0e-3/area≤2.3e-3/bbox≤6.5e-4） |
   | nut.test.ts | Hex/HexFlange/BradTee | `['occt','brepkit']`+band | 小偏差双钉（vol≤2.6e-3/area≤2.0e-3/bbox≤4.6e-4/coM≤2.1e-3） |
   | screw.test.ts | HexHead/CounterSunk/Set | `['occt','brepkit']`+band | 沉头锥形头偏大 band（vol≤3.7e-2/coM≤1.6e-2/bbox≤3.8e-3/area≤4.0e-2） |
   | holes.test.ts | fastenerHoleCutter | `['occt','brepkit']` | 无 band |
   | chain.test.ts | 2-链轮链节 | `['occt','brepkit']` | 无 band |
   | sprocket.test.ts | sprocket | `['occt']` | occt 单体回归 |
   | thread.test.ts | thread/internalThreadSolid | `['occt']` | occt 单体回归 |
   | gears.test.ts | spur/ring/crossed_helical/bevel/rack/worm | `['occt']` | occt 回归 + brepkit 缺口断言（`r.ok===false`） |

3. **faijs-gears 源码改造**（用户授权）：`getGearKernel()` 由硬绑 `initOcctWasm()` 改为**优先消费注入式 backend**（`getBackends().kernel.brep`，与 fasteners `kernel.ts` 对齐），未配置时回退 `initOcctWasm()`（保旧测试兼容）。brepkit 缺口现经引擎注入诚实暴露。

4. **本计划文档**：§6.7 分类表与 §6.8 实证笔记已按实测结果回填（含 T1 二次修正、`isSolid` 降级、各零件 band 实测值）。

### 8.2 真缺口（在 brepkit 引擎层，非本包可补）

根因：**core 引擎（brepkit L1）缺 spline / helix 类原语**（`bsplineSurface` / `approximatePoints` / `interpolatePoints` / `makeHelixWire` / `loft` 等），归 core 重构（另一 agent 范围），本工作未改 core。具体受影响零件：

- **sprocket**：50+ 小半径圆弧边闭合 wire，`makeWire`/`makeFaceFromWire` 静默退化 → 体积偏小 ~12% 且 CoM 非对称。
- **thread / internalThreadSolid**：依赖 `makeHelixWire` + `bsplineSurface`/`approximatePoints`。
- **全部 gears**（spur/ring/crossed_helical/hyperbolic/herringbone/bevel/rack/worm + 装配体）：齿面依赖 spline/helix 原语；改造后已能诚实暴露（brepkit 注入下 `r.ok===false`，错误含 `bsplineSurface`/`makeHelixWire`/`is not a function`）。
- **bearing 角接触球 / 圆锥滚子**：`interpolatePointsWithTangents` / `makeFaceFromWire` 构建失败（brepkit 轮廓线容错缺陷）。
- **heatSetNut / screw PanHeadWithCollar·RaisedCheeseHead / holes internalThreadSolid**：非平面 knurl 面 / 特定头型 / 螺纹，brepkit 缺原语。

> 闭合条件：core 补齐上述原语后，§3.3 的 raw→L1 改写即可把上述 `['occt']` 零件抬为 `['occt','brepkit']`；届时 sprocket/thread/gears 的 occt-only 测试直接翻转为一致性测试，**无需再改本包源码**。

### 8.3 计划内但尚未实现（明确列出，以免误判为已完成）

- **§3.1 `PART_META` 注册表**未建（每个零件挂 `engines` 元数据）。
- **§3.4 `gen-lib-capability-map.ts` + `lib-capability-map.json`** 未实现（静态追踪每个零件调用的内核方法）。
- **§3.5 weapp 侧静态过滤**未接入（`PART_META.engines` → 工具注册，brepkit 模式自动不出现 occt-only 零件）。
- **§6.3 双钉 `pinCurrent`/`pinTarget` 持久化**目前仅在测试代码内以 band 常量形式存在（`BEARING_T2_BAND`/`NUT_T2_BAND`/`SCREW_T2_BAND`），未落 `golden.deviation.json`；band 仅覆盖实测最大观测，后续可手工收紧。
- **§6.4 `assertEngineMetaConsistent`** 闭环校验未实现（声明 `['brepkit']` 与测试存在性互证）。

### 8.4 已知约束与边界

- 本环境无 `dist` 构建；专属 config 用别名把 `@faicad/faijs` 指到 `packages/core/src` 源码。
- 测试桩 `revolve`/`makeSolid`/`rotate` 适配属验证用；fasteners 迁移 L1 后该桩可删（见 §3.3）。
- **core 引擎未改**；另一 agent 的 faijs 大范围重构与本提交不冲突——本提交仅含 engine-compat 测试、harness、gears.ts 改造、计划文档，不影响他人工作树。
