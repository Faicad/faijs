# 方案：fai_cq_gears / fai_cq_warehouse 解除对 cq-compat 的依赖

状态：方案（未实施）

## 用户原话

> 分析包
> fai_cq_gears AGPL
> fai_cq_warehouse AGPL
> 看他们依赖cq-compat的哪些api和功能。我希望让它们不依赖cq-compat，这样使用更方便

## 1. 调查结论

### 1.1 fai_cq_warehouse：已经零依赖 cq-compat

- 运行时 `dependencies: {}`，peerDependencies 只有 `@faicad/faijs` + `occt-wasm`。
- 唯一牵连是 devDependencies 的 `@faicad/cq-compat-compare`（file: 协议），仅供 4 个测试文件（bearing/nut/screw/sprocket）做 STEP 装配等价比对（`compareAssemblyFiles`）。
- **对最终使用者无任何影响，无需动作。** devDependency 不进入安装图；若希望仓库层面也解干净，见 §4 可选项。

### 1.2 fai_cq_gears：深度依赖，但依赖面完全收敛在一个文件

全部运行时依赖集中在 `packages/faijs-cadquery/src/gears.ts`（437 行）——该文件头注释自述"为 cq_gears 移植而生（landing spot），fai_cq_gears only imports from here"。

被消费的 API/功能清单：

| 符号 | 用途 | fai_cq_gears 使用点 |
|---|---|---|
| `getGearKernel()` | raw occt-wasm 内核单例（= `initOcctWasm()` 的类型断言包装，无任何额外逻辑） | index.ts 及全部 build 测试 |
| `GearKernel` 类型 | 约 30 个 occt 原生方法的能力面（bsplineSurface / approximatePoints / interpolatePoints / sew / loft / revolve / mirror / split / fillet / shell / thicken / healWire / makeWire / makeFace / makeLineEdge / getSubShapes / curveParameters / curvePointAtParam …） | 全部 13 个源文件 |
| `GearAxis` 类型 | rotate / revolve / mirror 的轴 | pairs / planetary / crossed_pair |
| `connectEdgesToWires` | 无序边 → 容差连线成 wire（OCCT `ShapeAnalysis_FreeBounds::ConnectEdgesToWires` 移植，O(n²) 端点配对，补桥接线段） | spur_gear / bevel_gear / worm_gear / rack_gear 等 5 处 |
| `gearEdgeEnds` / `gearShellToSolid` / `gearFaceFromWires` | 边端点（含 B-spline 边端点红线处理）、sew+makeSolid、wire(+holes)→face | rack_gear / ring_gear |
| `buildGearSplineFace`、`GearSplineFaceStrategy`（3 种）、`GearSplineFaceOptions`、`GearSplineGrid`、`DEFAULT_GEAR_SPLINE_FACE_STRATEGY`、`GEAR_SPLINE_FACE_STRATEGIES` | 齿面 B-spline 面构建（grid-approx / row-approx-loft / row-interp-loft） | spline-face.ts re-export 给全包 |
| `soleGearFace`、`gearDistanceToFace`、`gearFaceDeviation`、`GearDeviationStats` | 单面规约、偏差度量 | spline-face.ts |
| （dev）`@faicad/cq-compat-compare` 的 `compareAssemblyFiles` | 参考基线 STEP 比对 | testing/compare.ts |

### 1.3 关键事实：gears.ts 是完全自包含模块

`gears.ts` 的项目内 import 只有两类：
1. `@faicad/faijs` 的 `initOcctWasm` + 类型（`BrepEngineApi` / `BrepHandle` / `BrepVec3`）——这些是 fai_cq_gears 的 peer 依赖，本来就有；
2. `./geom-types` 的 `Vec3` 类型（cq-compat 内部的几何向量类型，仅类型用途）。

**不引用 cq-compat 的 Workplane / assembly / sketch 任何一层。** cq-compat 内部也没有任何其它文件 import gears.ts（已 grep 验证：只有 index.ts / browser.ts 的 re-export 行）。核心包 / faijs-extra / sheetmetal / sketch / draw / fcstd 均不消费这些齿轮符号。

测试侧牵连：
- `packages/tests/faijs/compat-e2e/fai-cq-gears-flow.test.ts`：注释提到 `getGearKernel`，实际消费的是 `@faicad/fai-cq-gears` 包门面（迁移后不受影响，需验证）。
- fai_cq_gears 自己的 26 个文件的 `@faicad/faijs-cadquery` import（含 type-only）需替换。
- 两个包的 `vitest.config.ts` alias、`package.json` 依赖声明需同步。

## 2. 方案：把 gears.ts 整体迁入 fai_cq_gears

**推荐此路线**，理由：gears.ts 自述服务对象就是 fai_cq_gears；cq-compat 侧无人内部引用；单文件搬迁改动面最小、几何行为零变化（代码逐字节移动，只改 import 路径）。

### 2.1 改动清单

1. **搬迁文件**：`packages/faijs-cadquery/src/gears.ts` → `packages/fai_cq_gears/src/kernel/gears.ts`
   - `import type { Vec3 } from './geom-types'` → 改用包内 `./math` 的 `Vec3`（fai_cq_gears 已有 `math.ts`；确认字段兼容：两者均为 `{x,y,z}`，纯类型替换）。若 math.ts 的 Vec3 与 geom-types 结构不一致，则在 kernel/gears.ts 内联最小 `Vec3` 接口（避免为类型引入跨包依赖）。
   - 其余内容逐字节保留（含全部 GOTCHA 注释与红线说明）。
2. **fai_cq_gears 内替换 import**：26 个文件中
   - `from '@faicad/faijs-cadquery'` → `from './kernel/gears'`（或建 `./kernel` barrel 统一出口，减少路径噪音）；
   - `spline-face.ts` 的 re-export 行同步改源。
3. **package.json（fai_cq_gears）**：删除 `"dependencies": { "@faicad/faijs-cadquery": "^0.26.0" }`（改为空或移除字段）；peerDependencies 不变。
4. **vitest.config.ts（fai_cq_gears）**：删除 `@faicad/faijs-cadquery` alias 行。
5. **cq-compat 侧清理**：
   - 删除 `src/gears.ts`；
   - index.ts 删除两段齿轮 re-export（第 238–265 行附近）；
   - browser.ts 删除 `export * from './gears'` 及其注释（browser.ts 该行注释本身写明其存在理由就是 fai-cq-gears）。
6. **lockstep**：不新增/不减少包，只动依赖边，`check-lockstep` 规则不受影响；版本号按流程走 `set-version`（patch 位 +1）。
7. **文档**：`.agents/notes/` 新增一条 Agent Note（齿轮原语层所有权从 cq-compat 迁至 fai_cq_gears）；grep 全仓 `@faicad/faijs-cadquery` 文档引用更新指向。

### 2.2 验证步骤

1. `npm run typecheck`
2. `npm run test -w @faicad/fai-cq-gears`（重点：spline-face / 各 gear build / stability——几何必须逐位不变，因为只是 import 路径变化）
3. `npm run test -w @faicad/fai-cq-warehouse`（确认无波及）
4. `packages/tests` 的 `fai-cq-gears-flow.test.ts`
5. `node scripts/check-lockstep.mjs`
6. 最后才允许跑一次 `scripts/ci.ps1`（铁律：不通过 CI 找 bug）

### 2.3 风险与红线

- **AGPL 语义**：gears.ts 本来就在本仓库（Apache-2.0 根）内，迁移不改变任何许可证事实。
- **`__probe-moved.test.ts` / `moved.test.ts`**（cq-compat 内）：需 grep 是否触达 gears 符号；若有，一并迁移或删除。
- **occt-wasm 直连红线**：gears.ts 文件头规定"fai_cq_gears must not touch occt-wasm directly"——迁移后该约定由包内注释继续承载，语义不变（仍只经 `getGearKernel` 单例）。
- 历史文档（docs/plans 旧文件）不改。

## 3. 备选路线（不采用，仅留档）

**B. 拆独立小包 `@faicad/gear-kernel`**：gears.ts 独立成包，fai_cq_gears 依赖它。仅当未来出现第三个消费 raw kernel 的包时才有价值；当前多一个包 = 多一份 lockstep/发布负担，弃。

**C. fai_cq_gears 自写 kernel 拷贝**：违反"一个事实一个家"且造成双份漂移，弃。

## 4. 可选项：warehouse 测试侧解耦

`@faicad/cq-compat-compare` 是 devDependency + file: 协议，不影响使用者。若追求仓库内完全解耦，需把 `compareAssemblyFiles`（装配 STEP 比对器）另作安排——超出本次"使用更方便"的目标，默认不做。
