# fai_cq_gears —— 把 cq_gears 移植为 faijs 库（技术实现方案）

> ⚠️ **本文件已废弃**：2026-09-11 实测复核发现包骨架与 SpurGear 裸实体已落地、且多处事实
> （Python 环境、CLI 白名单、比对工具选型、公开 API 入口缺失）已变化。无歧义的执行规范见
> **`docs/plans/2026-09-11-fai-cq-gears-port.md`**。本文件仅留作历史，请勿照此执行。

日期：2026-09-08
状态：**已废弃（被 2026-09-11-fai-cq-gears-port.md 替代）**
移植源：`C:\git\CADQ\cq_gears`（cq_gears 0.62，Apache-2.0，作者 meadiode@github）
基线仓库：`C:\my\Faicad\faijs`
前置方案：`docs/plans/2026-09-06-cadquery-compat-and-multifile-faijs.md`（mini_lathe → `.fai.js`
脚本移植，**已实施**；本方案复用其中的 STEP 等价性比对工具）

> **基线声明（必读）**：本方案中所有关于 faijs 现状的结论，均为 **2026-09-08 读源码实测**
> 得到（文件名 / 符号 / 签名见各处标注）。faijs 处于高频重构期，**plan 文档只代表写下那一刻
> 的事实**；实施 P0 时必须按本文给出的位置重新复核一遍，复核结果与原文档冲突时以代码为准。

---

## 0. 用户原始需求（逐字）

> 这个移植已经完成了，现在我需要写一份新的开发计划，把C:\git\CADQ\cq_gears库移植为faijs的库，名字为fai_cq_gears。除了功能，还需要移植测试。并且要利用已有的STEP file equivalence comparison utility来保证移植后双方的建模结果是一致的。

拆解为 4 个目标：

| # | 目标 | 本方案结论 |
|---|---|---|
| G1 | cq_gears → faijs **库**（非脚本），名字 `fai_cq_gears` | 新 workspace 包 `packages/fai_cq_gears`（npm `@faicad/fai-cq-gears`），绑定名 `fai_cq_gears`，导出函数式 API，返回 `Result`（§4） |
| G2 | 功能完整移植 | 15 个类全部有对应导出；分两批：9 个单体齿轮（P2–P4）+ 6 个齿轮对/轮系（P5）（§3.1、§7） |
| G3 | 测试一并移植 | 三层测试：T1 回归（31 例，cq 自带期望值）、T2 STEP 等价性（**用户点名的核心**）、T3 稳定性（随机参数 + 不变量 + 报告）（§6） |
| G4 | 用已有 STEP 等价性工具保证双方一致 | 复用 `@faicad/cq-compat` 的 `compareStepFiles` / `printCompareReport`；Python 侧出参考 STEP，faijs 侧出对照 STEP，按校准后的容差门禁（§6.2） |

---

## 1. 现状基线（2026-09-08 实测）

### 1.1 库形态契约（`docs/library-dev-guide.md`，库作者面）

| 事实 | 位置 / 说明 |
|---|---|
| 库 = 普通 TS 模块命名空间，导出函数 + `contractVersion` | `registerLib` 内 `assertContractVersion(ns)`（`cad-runtime/runtime.ts:365`）——**不导出 `contractVersion` 会直接拒绝装载** |
| 函数返回 `Result`；`err` → 语句级失败（`failedAt`），不崩 | `library-dev-guide.md` §2.2 |
| 返回值三分类：faijs `Shape` / OCCT 句柄（`__occtWasm`）/ 纯数据记录 | 同 §2.3 |
| 裸函数经 `{ autoLift: true }` 提升为 brep-only op；`fn.outputs` 声明多输出字段 | `runtime.ts:364`（签名 `{ default?, autoLift?, packageName? }`）、`library-dev-guide.md` §2.6 |
| 宿主注册：`runtime.registerLib('gear', gear, { autoLift: true, packageName: '...' })` | `packages/gear-lib-demo/src/gear.test.ts:85`（实测写法） |
| CLI 装载白名单 | `packages/core/src/node-host/cli.ts:38` `CLI_ALLOWED_LIBS = new Set(['@faicad/gear-lib-demo', '@faicad/sheetmetal', '@faicad/cq-compat'])` |
| 包内测试必须自带 `vitest.config.ts` 把包名 alias 到活源码 | `packages/sheetmetal/vitest.config.ts`（模板）；根 `vitest.config.ts` 只 include 根 `src/**` |

### 1.2 库面 API 可用性（逐个核实，这是本方案的核心依据）

cq_gears 全部建模都走 **OCCT 曲面/拓扑构造**，而 faijs 的库面 API 由「vendored brepjs 1299
符号（`api/generated/brepjs/index.ts`）+ 42 个手写包装（`api/brepjs-compat/index.ts`）+ 脚本面
op」组成。逐个核实结果（2026-09-08，grep 源码）：

| cq_gears 需要的构造 | faijs 库面现状 | 结论 |
|---|---|---|
| `cq.Face.makeSplineApprox(pts2d, tol, minDeg, maxDeg)`（**齿轮齿面核心**） | **无同名**。`initOcctWasm()` 返回的实例（运行时是 `occt-wasm` 的 `OcctKernel`）有 `bsplineSurface(controlPoints, rows, cols)`（`node_modules/occt-wasm/dist/index.d.ts:390`），**但无 tol / deg 参数** | ⚠️ **最高风险**，需 P0 实测（§4.4） |
| B-spline 曲线（含 tol / deg 控制） | `makeBSplineApproximation(points, { tolerance, degMin, degMax, smoothing })`（`vendored/brepjs/topology/curveBuilders.ts:143`，默认 `1e-3 / 1 / 6`）、`makeBSplineInterpolation` | ✅ 可用作曲面构造的**降级路线** |
| 线框连接 `cq.Wire.combine(edges, tol)` / `consolidateWires()` | `wire(edges)` / `wireLoop(edges)`（`topology/primitiveFns.ts:390/408`）→ `assembleWire`（**无 tol 参数**）；内核另有 `healWire(wire, tol)`、`makeWireFromMixed` | ⚠️ 需自建「带容差」的组线器（§4.5） |
| `Face.makeFromWires(outer, holes[])` | `face(closedWire & PlanarWire, holes?)`（`primitiveFns.ts:422`）、`filledFace(wire)`、`polygon(points)`；内核 `makeFace(wire)` / `makeNonPlanarFace(wire)` / `addHolesInFace(face, holeWires)` | ✅ 有（类型较严，必要时走内核版） |
| `Face.makeRuledSurface(w1, w2)` | `loft(wires, isSolid, ruled)`（`vendored/brepjs/operations/api.ts:76`） | ✅ 等价替代 |
| `make_shell(faces, tol)`（OCP `BRepBuilderAPI_Sewing`） | 内核 `sew(shapes, tolerance?)`（`kernel/interfaces/topologyOps.ts:63`）；brepjs 包装 `weldShapes(facesOrShells)`（`topology/shapeUtils.ts:12`）**不传 tol** | ✅ 走内核 `sew(faces, 1e-2)` |
| `Solid.makeSolid(shell)` | `makeSolid(facesOrShells)`（`topology/solidBuilders.ts:154`，内部 `weldShapes` + `solidFromShell`，无 tol）；内核 `makeSolid(shell)` | ✅ 先 `sew(faces,tol)` 再 `makeSolid(shell)` |
| 布尔 `cut` / `fuse` | `cut` / `fuse` / `split(shape, tools[])`（`operations/api.ts`、`topology/api.ts:233`） | ✅ |
| `revolve()`（倒角刀具） | `revolve(face, { at, direction, angle })`（`operations/api.ts:56`） | ✅ |
| `fillet(shape, edges, r)` | `fillet(shape, edgesOrRadius, radius)`（`topology/api.ts:326`） | ✅ |
| `shell(shape, faces, thickness, { tolerance })` | `shell(...)`（`topology/api.ts:399`） | ✅ |
| `threePointArc` | `threePointArc`（generated 面有符号，属 2D 草图 DSL）；内核 `makeArcEdge(start, mid, end)` | ✅（实施前复核坐标系） |
| `radiusArc` | 无；可自算中点后走 `makeArcEdge` | ✅ 自算 |
| `twistExtrude` | **无** | ⚠️ 见 §4.6（只影响缺齿切除体） |
| `make_cross_section_face`（OCP `GeomAPI_IntSS`，**Worm 专用**） | **无**；用 `split(face, [plane])` + 取平面上的边 + 组线 + 成面复现 | ⚠️ **次高风险**（§4.7） |
| `Workplane.faces('>Z')` / `edges('<Z')` 选择器 | **无选择器**；内核有 `getSubShapes` / `surfaceNormal` / `getSurfaceCenterOfMass` / `uvBounds` / `outerWire`，`api/geom.ts` 有 `faceNormal` / `bboxMin` / `bboxMax` | 需自建选择器（§4.5） |
| `Assembly` / `Location` / `Color` / `toCompound()` | 库面可用 `assembly()` / `group()`（`api/compound.ts`）；**但库内更简单**：返回带 `outputs` 的数据记录 | ✅（§5.5） |
| numpy（`linspace`/`arccos`/`cross`/`dot`/`arctan2`/矩阵乘） | 无；全部手写 TS 数学层 | ✅（§5.3） |

**硬约束（必须写进方案）**：`occt-wasm` 是**预编译 wasm + JS 绑定**（`node_modules/occt-wasm/dist`），
仓库里没有 C++ 源码，**「给内核加一个 makeSplineApprox」不是可选项**。任何能力缺口只能在
现有绑定之上组合，或改变构造策略。

### 1.3 STEP 等价性比对工具（已存在，用户点名复用）

| 设施 | 位置 | 说明 |
|---|---|---|
| `compareStepFiles(a, b, options)` | `packages/cq-compat/src/step-compare.ts:107` | 五维比对：bbox / volume / centerOfMass / topology / 布尔差（A-B、B-A） |
| `printCompareReport(result)` | 同文件 `:187` | 人类可读报告 |
| CLI | `packages/cq-compat/scripts/compare-step.ts` | `npx tsx … <a.step> <b.step> [--linear-tol] [--volume-tol] [--boolean-tol] [--no-strict-topology] [--json]`，退出码 0/1 |
| 默认容差 | `step-compare.ts:64` | `linear 1e-4`、`volumeRelative 1e-4`、`booleanVolume 1e-3`、`strictTopology true` |
| 装配版 | `packages/cq-compat/src/assembly-compare.ts` | mini_lathe 实际使用的容差更松：`linear 1e-3`、`volume 1e-3`、`boolean 1e-1`、`strictTopology false`（`:73`） |
| 公开导出 | `packages/cq-compat/src/index.ts:53` | `compareStepFiles` / `printCompareReport` 已在包入口导出 |

⇒ **复用方式**：`fai_cq_gears` 把 `@faicad/cq-compat` 作为 **devDependency** 引入，测试里
`import { compareStepFiles } from '@faicad/cq-compat'`（§6.2）。不搬运、不复制实现。
（备选：把比对工具抽到中性包——**不采用**，会动 cq-compat 的公开面且无收益。）

### 1.4 参考 STEP 的生成环境（实测可用）

系统 `python` 里没有 cadquery；但 **CQ-editor 自带环境可用**：

```
C:\Users\yuan_\cq-editor\python.exe
  cadquery 2.6.dev0 / cq_gears 0.62（site-packages 与 C:\git\CADQ\cq_gears\cq_gears 逐字节一致）/ numpy 2.3.0
```

实测：`SpurGear(module=1, teeth_number=17, width=5).build().Volume()` → `1111.7107…`（可跑通）。
⇒ 参考 STEP 由 Python 脚本生成，解释器路径做成可覆盖的环境变量 `FAI_CQ_PYTHON`，
默认 `C:/Users/yuan_/cq-editor/python.exe`，并把 `C:\git\CADQ\cq_gears` 加到 `sys.path` 首位
（保证用的是源码而不是 site-packages 副本）。

### 1.5 工程接入点清单（实施时逐条改）

1. 根 `package.json` 的 `workspaces` 数组：新增 `packages/fai_cq_gears`，**必须排在
   `packages/cq-compat` 之后**（依赖拓扑断言：`scripts/check-workspaces-order.mjs`）。
2. `packages/core/src/node-host/cli.ts:38` `CLI_ALLOWED_LIBS` 增加 `'@faicad/fai-cq-gears'`。
3. 新包自带 `vitest.config.ts`（抄 `packages/sheetmetal/vitest.config.ts`，改 `__dirname` 相对路径）。
4. 新包自带 `tsconfig.json` / `tsconfig.build.json`（抄 `packages/gear-lib-demo`）。
5. 幽灵依赖守卫 `scripts/check-ghost-deps.mjs`：包 `package.json` 必须声明
   `@faicad/faijs`（devDep `file:../..`）、`occt-wasm`（peer）、`@faicad/cq-compat`（devDep，仅测试用）。
6. `packages/tests/vitest.config.ts`：如要加脚本级 e2e，追加 alias
   `'@faicad/fai-cq-gears' → ../fai_cq_gears/src/index.ts`，并在 `@faicad/faijs-tests`
   的 `dependencies` 声明该包。
7. 非平凡变更须带 Agent Note（`.agents/notes/`，见 `AGENTS.md`）。
8. `docs/plans/` 不参与双语配对（`AGENTS.md` 例外清单），本文件无需 `.zh.md` / `.i18n.yaml`。

---

## 2. cq_gears 源码分析

### 2.1 文件与类清单（实测 `wc -l`）

| 文件 | 行数 | 内容 |
|---|---|---|
| `cq_gears/__init__.py` | 75 | 15 个类的 re-export + `gear()` / `addGear()` 猴子补丁 |
| `cq_gears/utils.py` | 217 | `sphere_to_cartesian` / `s_arc` / `s_inv` / `circle3d_by3points` / `rotation_matrix` / `angle_between`（纯数学，numpy）+ `make_shell` / `make_cross_section_face`（**直调 OCP**） |
| `cq_gears/spur_gear.py` | 523 | `GearBase` / `SpurGear` / `HerringboneGear` |
| `cq_gears/ring_gear.py` | 386 | `RingGear` / `HerringboneRingGear` / `PlanetaryGearset` / `HerringbonePlanetaryGearset` |
| `cq_gears/bevel_gear.py` | 421 | `BevelGear` / `BevelGearPair` |
| `cq_gears/rack_gear.py` | 267 | `RackGear` / `HerringboneRackGear` |
| `cq_gears/worm_gear.py` | 229 | `Worm` |
| `cq_gears/crossed_helical_gear.py` | 315 | `CrossedHelicalGear` / `CrossedGearPair` / `HyperbolicGear` / `HyperbolicGearPair` |
| **合计（不含测试）** | **2433** | |
| `tests/**` | 1021 | regression（31 例）+ stability（5 类 + 报告器） |

15 个类按构造方式分三族：

- **A 族·直纹/扭纹齿面**（SpurGear / HerringboneGear / RingGear / HerringboneRingGear /
  CrossedHelicalGear / HyperbolicGear）：渐开线点集 → `_build_tooth_faces`（**网格样条曲面**）
  → 顶/底面 → `make_shell` → `makeSolid`。
- **B 族·球面渐开线**（BevelGear）：`s_inv` / `s_arc` 球面曲线 → 同样的网格样条曲面 →
  **用两个切割平面裁顶/底**（`face.split`）→ 再 `_trim_bottom` / `_trim_top`（回转体布尔切）。
- **C 族·齿条 / 蜗杆**（RackGear / HerringboneRackGear / Worm）：齿条是直线廓形沿 x 平移
  （螺旋角时 tx 偏移）；蜗杆是齿条廓形绕 x 轴旋转 + 沿 x 平移的螺旋扫掠，**端面用
  `make_cross_section_face` 求交生成**（最高风险）。

### 2.2 CadQuery / OCP API 调用集（读源码逐条列出，按风险排序）

| 调用 | 频次/位置 | 风险 |
|---|---|---|
| `cq.Face.makeSplineApprox(pts2d, tol=1e-2, minDeg=3, maxDeg=8)` | A/B 族全部齿面 | 🔴 高 |
| `cq.Wire.combine(edges, tol=1e-2)` + `Face.makeFromWires` | 顶/底面 | 🟠 中 |
| `make_shell(faces, tol=1e-2)`（OCP Sewing）+ `Solid.makeSolid` | 全部 | 🟢 低（内核有 `sew`） |
| `face.split(plane)` + `BoundingBox` 选块 | Bevel（裁顶底）、Rack（左右端） | 🟠 中 |
| `make_cross_section_face`（OCP `GeomAPI_IntSS` + `ConnectEdgesToWires`） | **Worm 专用** | 🔴 高 |
| `twistExtrude` | HerringboneGear/HerringboneRingGear 的缺齿切除体 | 🟠 中（影响面小） |
| `Workplane.faces/edges/vertices('>Z' \| '<Z' \| '\|Z' \| '<X' …)` + `.val()` | 打孔/沉台/轮辐/倒角 | 🟠 中（需自建选择器） |
| `moveTo / lineTo / threePointArc / radiusArc / close / consolidateWires / toPending` | 缺齿线框、轮辐线框 | 🟢 低（`makeArcEdge` + `wire`） |
| `extrude / cutThruAll / cutBlind / revolve / cut / union` | 孔、轮毂、沉台、倒角 | 🟢 低 |
| `fillet(spoke_fillet)` | 轮辐切除体 | 🟢 低 |
| `Face.makeRuledSurface` / `Wire.makeCircle` / `Face.makePlane` | RingGear 轮缘面、切割平面 | 🟢 低 |
| `Assembly / Location / Color / toCompound` | 3 个 Pair + 2 个 Gearset | 🟢 低（改成返回记录） |
| `cq.Vector` / numpy 全套 | 全局 | 🟢 低（手写） |

> 上一版方案（`2026-09-06` §4.7）给出的调用集是「Workplane 44 / add 47 / Vector 36 …」，
> 那是**按字符串统计**的结果；本表是按**实际调用点**重新核定的，实施以本表为准。

### 2.3 现有测试（移植对象）

**① `tests/regression`（31 例，9 个类）**

- `regression_test_cases.json`：`[{class, args, expected:{volume, bbox:[xlen,ylen,zlen]}}] × 31`
- `test_regression.py`：`cls(**args).build()` → 断言 `|vol - expected| <= 1e-3`、
  `|bbox.len - expected| <= 1e-3`（**绝对值 1e-3，非相对**）
- 覆盖：SpurGear 6 / BevelGear 6 / RingGear 4 / RackGear 4 / Worm 3 / HerringboneGear 2 /
  HerringboneRingGear 2 / HerringboneRackGear 2 / CrossedHelicalGear 2
- **未覆盖**：PlanetaryGearset、HerringbonePlanetaryGearset、BevelGearPair、CrossedGearPair、
  HyperbolicGear、HyperbolicGearPair（6 个类无回归用例）

**② `tests/stability`（随机参数 + 不变量 + 报告）**

- `conftest.py`：`--rng_seed=42`、`--num_test_cases=10`（脚本里默认 1000）、`--test_timeout=120`
- `utils.py::_TestGear`：`gen_params(seed, n)` 生成随机参数 → **子进程**跑 `gear_build`
  （`multiprocessing fork`，超时 `terminate`）→ 失败分类标签：
  `PRECALC / BUILDING / NOT_SOLID / VOLUME / BBOX_Z / BBOX_XY / TIMEOUT`
- 不变量（以 SpurGear 为例）：`isinstance(body, cq.Solid)`；
  `width·π·rd² < Volume < width·π·ra²`；`|width − bbox.zlen| ≤ 0.5`；`|2·ra − max(bbox.xlen, bbox.ylen)| ≤ 0.5`
- `report.py`：读 pytest `--json-report` 输出，统计通过率 + 每类每标签失败数 + 汇总表

**关键差异**：cq 用子进程隔离是因为 OCCT 在极端参数下会**挂死**；JS 里 wasm 挂死无法中断，
必须换机制（§6.3）。

---

## 3. 设计总纲

> **P-a（形态划分）**：`fai_cq_gears` 是 **TS 库**（`.ts` 源码、无 `.fai.js` 语法限制、
> 可用 class / for-of / async），内部直接调用**库面 API**（`brepjsCompat` 与
> `api/generated/brepjs` 的符号）+ 必要的**内核直调**（`initOcctWasm()` 实例上的 wasm 方法）。
>
> **P-b（不改核心）**：本方案**不新增 `cad.*` 脚本面符号、不改执行器、不改 cq-compat 的
> 公开面**。所有 CadQuery 语义都住在 `fai_cq_gears` 里。
>
> **P-c（一致性靠测不靠抄）**：不追求「代码逐行等价」，追求**建模结果等价**——
> 判据是 STEP 五维比对（§6.2）。构造策略可以自由替换，只要比对通过。

---

## 4. 包设计

### 4.1 目录与命名

```
packages/fai_cq_gears/
  package.json                 # name: @faicad/fai-cq-gears, version 0.1.0
  tsconfig.json / tsconfig.build.json
  vitest.config.ts
  README.md
  src/
    index.ts                   # 15 个类对应函数 + contractVersion + 类型
    math.ts                    # numpy 等价：linspace / arange / cross / dot / norm /
                               #   rotationMatrix / sphereToCartesian / sInv / sArc /
                               #   circle3dBy3points / angleBetween
    rng.ts                     # 确定性 PRNG（稳定性测试用，seed 可复现）
    selectors.ts               # '>Z' / '<Z' / '|Z' / '>X' / '<X' 面/边/点选择器
    geom-build.ts              # 组线（带容差）/ 成面（带孔）/ 缝合 / 实体化 / 切割平面
    spline-face.ts             # ★ 网格样条曲面（makeSplineApprox 等价）——P0 决策点
    profile.ts                 # 齿廓点集计算（A/B/C 三族共享的数学部分）
    spur_gear.ts  ring_gear.ts  bevel_gear.ts  rack_gear.ts  worm_gear.ts  crossed_gear.ts
    pairs.ts                   # 齿轮对 / 行星轮系（返回记录）
    errors.ts                  # 错误码（对齐 faijs Result 体系）
  scripts/
    gen-reference.py           # Python：出 cq 侧参考 STEP
    gen-reference.ps1          # 包一层，设置 FAI_CQ_PYTHON / PYTHONPATH
    export-ours.ts             # tsx：出 faijs 侧 STEP
    compare-all.ts             # 批量比对 + 汇总
    stability.ts               # 稳定性测试运行器（可子进程隔离）
  fixtures/
    reference/                 # cq 侧参考 STEP（入库）
    cases.json                 # 从 cq 的 regression_test_cases.json 同步的 31 例
  out/                         # 本地生成物（git 忽略，除 smoke 集）
  src/*.test.ts                # T1 / T2 / T3
```

**命名裁决**（用户指定 `fai_cq_gears`）：

| 项 | 值 |
|---|---|
| 目录 | `packages/fai_cq_gears`（下划线，与用户给的库名逐字一致） |
| npm 包名 | `@faicad/fai-cq-gears`（连字符，符合 npm/仓库既有命名） |
| `.fai.js` 里的 import specifier | `@faicad/fai-cq-gears` |
| 推荐绑定名 | `fai_cq_gears`（宿主 `registerLib('fai_cq_gears', ns, { packageName: '@faicad/fai-cq-gears', autoLift: true })`） |
| 导出函数名 | Python 类名转 camelCase：`spurGear` / `herringboneGear` / `ringGear` / `herringboneRingGear` / `planetaryGearset` / `herringbonePlanetaryGearset` / `bevelGear` / `bevelGearPair` / `rackGear` / `herringboneRackGear` / `worm` / `crossedHelicalGear` / `crossedGearPair` / `hyperbolicGear` / `hyperbolicGearPair` |

### 4.2 API 形态：**单调用**（构造 + build 合一）

cq_gears 的用法是 `cls(**ctor_args)` 后 `.build(**build_args)`，且 `__init__` 的
`**build_params` 会被存下来、在 `build()` 时**与 build 参数合并**（`spur_gear.py:47`）。
⇒ 一次调用传全部参数在语义上完全等价，且对 `.fai.js` 友好（脚本里没有 `new`、没有两步）：

```ts
export function spurGear(params: SpurGearParams): Result<ValidSolid>
export function ringGear(params: RingGearParams): Result<ValidSolid>
export function bevelGear(params: BevelGearParams): Result<ValidSolid>
export function rackGear(params: RackGearParams): Result<ValidSolid>
export function worm(params: WormParams): Result<ValidSolid>
// …
```

参数名**逐字沿用 Python**（`module` / `teeth_number` / `width` / `pressure_angle` /
`helix_angle` / `clearance` / `backlash` / `bore_d` / `chamfer` / `hub_d` / `hub_length` /
`recess_d` / `recess` / `n_spokes` / `spoke_width` / `spoke_fillet` / `spokes_id` /
`spokes_od` / `missing_teeth` / `rim_width` / `cone_angle` / `face_width` / `trim_bottom` /
`trim_top` / `lead_angle` / `n_threads` / `length` / `height` / `twist_angle` / `shaft_angle` …），
**不做重命名**——这是「移植工作量最小」的前提，也让 `regression_test_cases.json` 可以
零转换直接喂给 TS 测试。

**不移植 `Workplane.gear()` / `addGear()` 猴子补丁**（cq 的插件入口）：faijs 不允许
第三方库改写另一个库的载体，且它们只是 `build() + eachpoint()` 的语法糖。
记录为**已知的 API 差异**，使用者直接调 `fai_cq_gears.spurGear(...)`。

### 4.3 通用构造流水线（库内部）

对应 cq 的 `_build`：

```
① profile：纯数学算出 4 段点集（左齿面/齿顶/右齿面/齿根）       ← math.ts + profile.ts
② tooth faces：点集 × 若干截面（扭转/锥度）→ 网格 → splineFace()   ← spline-face.ts
③ 端面：收集边界边 → 带容差组线 → face()/makeFromWires           ← geom-build.ts
④ shell = kernel.sew(faces, shellSewingTol) → makeSolid(shell)    ← geom-build.ts
⑤ 后处理：chamfer → bore → missingTeeth → recess → hub → spokes   ← 各 gear 模块
   全部用 extrude + boolean cut / revolve + cut 实现，不依赖 Workplane
⑥ 返回 Result<ValidSolid>（OCCT 句柄，由引擎收养）
```

**GearBase 常量逐字保留**（`curve_points=20`、`surface_splines=5`、`wire_comb_tol=1e-2`、
`spline_approx_tol=1e-2`、`shell_sewing_tol=1e-2`、`isection_tol=1e-7`、
`spline_approx_min_deg=3`、`spline_approx_max_deg=8`、`ka=1.0`、`kd=1.25`；
`BevelGear.surface_splines=12`、`Worm.surface_splines=8 / wire_comb_tol=0.1 / t_face_parts=2`、
`HyperbolicGear.surface_splines=2`）——这些常量直接决定几何，必须一致。

### 4.4 ★ 风险一：网格样条曲面（`Face.makeSplineApprox` 等价物）

cq 的实现（`C:\git\CADQ\cadquery\cadquery\occ_impl\shapes.py:3618`）是
`GeomAPI_PointsToBSplineSurface(TColgp_HArray2OfPnt, DegMin=3, DegMax=8, Tol3D=1e-2)` → `MakeFace`。

faijs 侧候选（**P0 必须实测三选一**）：

| 方案 | 做法 | 评估 |
|---|---|---|
| **S1** | `kernel.bsplineSurface(flatPts, rows, cols)`（wasm 绑定，无 tol/deg） | 最省事；若 wasm 内部就是 `GeomAPI_PointsToBSplineSurface` 默认参数，可能已足够接近 |
| **S2** | 逐行 `makeBSplineApproximation(row, { tolerance: 1e-2, degMin: 3, degMax: 8 })` 得曲线 → `loft(rows, false, false)` 蒙皮 | 参数与 cq **逐字对齐**（tol/deg 同名同义），语义上最接近；多一层 loft |
| **S3** | `makeBSplineInterpolation`（过所有点）+ loft | 齿廓点本来就是精确采样点，插值可能更准；但与 cq 的"逼近"语义不同 |

**P0 判定方法（不许拍脑袋）**：
1. Python 侧：用 cq 生成同一个点阵的 `makeSplineApprox` 面 → 导出 STEP + 记录 `Area()`；
2. TS 侧：同一点阵分别用 S1/S2/S3 建面 → 记录 `getSurfaceArea()`；
3. 再对「同一个齿轮的整体体积」做三方案 × 参考值的对比（体积是最敏感的量）。
4. 判定：选**体积相对偏差最小**且稳定的方案；若三者都 > 1e-3，进入 §9 的降级阶梯。

### 4.5 ★ 风险二：带容差组线 + 选择器

- **组线**：`assembleWire` 无 tol。实现 `combineWires(edges, tol)`：
  `getSubShapes(shape,'edge')` → `assembleWire(edges)` → `kernel.healWire(wire, tol)`
  → `isValid` 检查；失败则回退 `kernel.makeWireFromMixed`。
  判定标准要与 cq 一致：**能封成闭环**且边长总和合理。
- **选择器**：实现 `selectFaces(solid, sel)` / `selectEdges(solid, sel)`，语义按 cq：
  `>Z` = 该方向坐标最大者、`<Z` 最小、`|Z` = 与 Z 轴平行、`>Z[-2]` = 排序后倒数第 2 个。
  实现手段：`kernel.getSubShapes` + `getSurfaceCenterOfMass` / `surfaceNormal` /
  `api/geom.ts` 的 `faceNormal` / `bboxMin` / `bboxMax`。
  ⚠️ **排序必须复现 cq 的顺序语义**（否则会选错面，几何全错）——用 T1 回归用例反向验证。

### 4.6 ★ 风险三：`twistExtrude`（人字齿缺齿切除体）

只用于 `HerringboneGear._remove_teeth` / `HerringboneRingGear`（`missing_teeth` 参数，
31 个回归用例里只有 2 例命中）。处置：

1. 首选：用「旋转截面 + `loft(wires, true, false)`」逼近（切除体是**被减去的**体，
   表面细节差异对最终零件体积影响极小）；
2. 备选：`t_face_parts` 风格自建扭转网格面（与齿面同一套 `splineFace`）；
3. 判据：命中的 2 个用例（HerringboneGear #2、SpurGear missing_teeth）STEP 比对通过即可。

### 4.7 ★ 风险四：Worm 端面（`make_cross_section_face`）

cq 用 `GeomAPI_IntSS`（面-面求交）拿交线 → `ConnectEdgesToWires` → `MakeFace`。
注意 cq 只取 **第一条** wire（`wires_out.First()`），本身就带有 OCCT 顺序依赖。

faijs 侧首选：**`split(face, [cutPlane])` 取子面 → 抽平面上的边 → `combineWires(tol)` →
`face()`**，与 Rack 的端面做法统一（Rack 已经验证过这条路线在 cq 里能出正确结果）。

兜底（若首选在蜗杆上不稳定）：把蜗杆体**加长**后与两个半空间做布尔 `cut`，
端面自然成平面；这会改变拓扑（face/edge 数），因此 T2 必须 `strictTopology: false`，
且以布尔差体积为主要判据。**该兜底是否启用由 P4 实测决定**。

---

## 5. 齿轮对 / 行星轮系 / 颜色

### 5.1 返回「带 `outputs` 的记录」而不是 compound

cq 的 `Pair/Gearset._build()` 返回 `asm.toCompound()`（合并成一个 compound）。
faijs 库面有更好的选择：返回**具名记录**并用 `fn.outputs` 标注几何字段
（`library-dev-guide.md` §2.6，`@faicad/gear-lib-demo` 的 `planetary` 就是这么做的）：

```ts
export interface PlanetaryGearsetResult {
  sun: ValidSolid
  planets: ValidSolid[]      // 已按各自 Location 定位
  ring: ValidSolid
  colors: { sun: RGB; planet: RGB; ring: RGB }
}
export function planetaryGearset(params: PlanetaryGearsetParams): Result<PlanetaryGearsetResult>
;(planetaryGearset as { outputs?: string[] }).outputs = ['sun', 'planets', 'ring']
```

好处：每个零件可单独导出 STEP 做**逐件**等价性比对（比整体 boolean 差更可诊断），
也便于 UI 分层着色。

### 5.2 Location / 颜色

- `cq.Location(...)` 的语义（平移 + 绕轴旋转角）→ `api/transform.ts` 的 `rotate_euler` /
  `translate` / `applyTransform`，或用内核 `transform(shape, matrix)`（4×4，自算）。
  **旋转角用度**（faijs 契约），与 Python 的 `np.degrees(...)` 输出一致。
- 颜色：`cq.Color('gold')` 等 → 记录里的 `RGB`（sRGB 0..1）。
  库**不负责**把颜色写进 STEP（单件导出的 STEP 无颜色语义）；若宿主用
  `exportStepFromSolids(kernel, entries)` 导出整体，entries 的 `color` 字段已支持
  （`brep/export/step.ts:52`，内部做 sRGB→linear）。

---

## 6. 测试移植方案（G3 + G4）

三层测试，全部在新包内（`src/*.test.ts`），`npm run test -w @faicad/fai-cq-gears` 跑 T1+T2，
`npm run test:stability -w @faicad/fai-cq-gears` 单独跑 T3。

### 6.1 T1 —— 回归测试（cq `tests/regression` 的移植，门禁）

- 数据：`fixtures/cases.json` = cq 的 `regression_test_cases.json`（31 例，**逐字同步**，
  加一个 `sync` 脚本从源仓库拷，记录源 commit sha）。
- 断言：与 cq 完全一致 —— `|volume − expected.volume| ≤ 1e-3`、
  `|bbox.xlen/ylen/zlen − expected.bbox[i]| ≤ 1e-3`。
- 体积/包围盒来源：直接对库返回的 solid 用 `kernel.getVolume` / `kernel.getBoundingBox`
  （与 cq 的 `body.Volume()` / `BoundingBox()` 同一内核算法）。
- **性质**：这是最便宜也最灵敏的一致性信号——只要几何一致，这些数就该一致。
  它是 T2 的前置门禁（T1 不过就别浪费时间导 STEP）。

### 6.2 T2 —— STEP 等价性测试（用户点名的核心，门禁）

```
① Python 侧出参考：scripts/gen-reference.py
     - 读 fixtures/cases.json，逐个 cls(**args).build()
     - cq.exporters.export(body, 'fixtures/reference/<id>.step')
     - 同时把实测 volume/bbox 写回 fixtures/reference/manifest.json（供 T1 交叉核对）
② faijs 侧出对照：scripts/export-ours.ts（tsx）
     - 同参数调 fai_cq_gears.<fn>(params) → Result<Solid>
     - exportStepFromSolid(solid.wrapped, kernel) → out/<id>.step
       （签名实测：exportStepFromSolid(solid, kernel) → ArrayBuffer，brep/export/step.ts:124）
③ 比对：compareStepFiles(refPath, ourPath, options)  ← @faicad/cq-compat
```

**容差校准（不许拍脑袋，P0 出数）**：

| 维度 | 起点 | 说明 |
|---|---|---|
| `strictTopology` | **false** | B-spline 曲面表示必然不同（面/边数不等），严格比对必失败；参考 mini_lathe 的做法（`assembly-compare.ts:73`） |
| `linearTolerance` | 1e-2 mm（P0 后收紧到能过的最小值） | 齿轮尺寸 6–700 mm，1e-2 约 1e-5～1e-3 相对量 |
| `volumeRelativeTolerance` | 1e-3（0.1%） | 与 mini_lathe 一致 |
| `booleanVolumeTolerance` | **按件计算** `max(1e-1, volumeRef × 1e-4)` | 布尔差是绝对量，大件（2.1e5 mm³）需要放缩；`CompareOptions` 是数值，测试里逐例算出即可，**不需要改工具** |

每个用例的 `equivalent` 必须为 `true`；失败时 `printCompareReport` 输出五维明细，
测试断言里带上 `result.details.join('\n')` 便于定位。

**门禁策略**：31 例全绿。若某类（预期是 Worm）无论如何调不进容差，**不允许静默放宽**，
按 §9 降级阶梯处理并明确记录。

### 6.3 T3 —— 稳定性测试（cq `tests/stability` 的移植，非默认门禁）

- `gen_params`：用 `rng.ts` 的**确定性 PRNG**（seed 可复现，不追求与 numpy `default_rng`
  同序列——测的是**我们的库**在自己参数域内的行为，不是复现 cq 的随机样本）。
- 不变量逐条照抄（`isSolid` / 体积上下界 / bbox 三个方向），容差 `BBOX_CHECK_TOL = 0.5` 不变。
- 失败标签照抄：`PRECALC / BUILDING / NOT_SOLID / VOLUME / BBOX_Z / BBOX_XY / TIMEOUT`。
- **超时/挂死机制必须换**：wasm 挂死无法在进程内中断。
  方案：`scripts/stability.ts` 逐例 `spawnSync('node', ['--import', 'tsx', 'runner.ts', caseJson], { timeout })`
  → 超时 kill，标 `TIMEOUT`。默认 `--in-process` 快速模式（不带超时保护，用于日常 50 例），
  `--isolate` 模式（子进程隔离，用于 500+ 例与复现挂死）。
- 规模：默认 `--num-test-cases=50`（cq 脚本默认 1000，但每次构造要跑完整 OCCT 流水，
  按实测耗时再定），CLI 可覆盖。
- 报告：移植 `report.py` 的汇总（通过率 + 每类每标签计数），输出 JSON 到
  `out/stability-report-<ts>.json`，并提供打印汇总（不做 HTML）。

### 6.4 目录与脚本

| 脚本 | 命令 |
|---|---|
| 生成参考 STEP | `pwsh -NoProfile scripts/gen-reference.ps1`（内部 `& $env:FAI_CQ_PYTHON scripts/gen-reference.py`） |
| 生成对照 STEP | `npx tsx scripts/export-ours.ts` |
| 批量比对 | `npx tsx scripts/compare-all.ts [--json]` |
| 稳定性 | `npx tsx scripts/stability.ts --num-test-cases=50 [--isolate] [--seed=42]` |
| 单包测试 | `npm run test -w @faicad/fai-cq-gears` |
| 单包 typecheck | `npm run typecheck -w @faicad/fai-cq-gears` |

**参考 STEP 入库**：与 `packages/mini_lathe/out/*.step` 的做法一致，**提交进仓库**
（31 件，若总体积 > ~5 MB 再裁剪到每类 2 例的 smoke 集，其余按需生成）。

---

## 7. 分期

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 可行性尖峰** | ① 复核 §1.2 全部 API 现状；② §4.4 三方案实测（面积 + 体积偏差表）；③ 打通 ref/our/compare 全链路（SpurGear 最小例）；④ 定容差表 | 一份 `docs/analysis/2026-09-08-fai-cq-gears-spike.md`：方案选定 + 实测偏差 + 建议容差。**达不到 1e-3 体积相对偏差→ 立刻上报，不自行放宽** |
| **P1 骨架** | 包落地（目录 / package.json / tsconfig / vitest.config / workspaces / CLI 白名单）、`math.ts` + `rng.ts` + `errors.ts` + `contractVersion`、SpurGear 裸齿轮（无 bore/hub/spokes/chamfer）跑通 T1 第 1 例 | 单包 test 绿、typecheck 绿 |
| **P2 A 族** | `spur_gear.ts` 全量（bore / missing_teeth / recess / hub / spokes / chamfer）+ `ring_gear.ts`（含轮缘 `makeRuledSurface` 等价物）+ 两个 Herringbone 变体 | T1 覆盖 SpurGear 6 / RingGear 4 / Herringbone×4；T2 同步 |
| **P3 B 族 + C 族齿条** | `bevel_gear.ts`（球面渐开线 + split 裁顶底 + 回转 trim）、`rack_gear.ts` + Herringbone 变体（左右端 + 背/顶/底面） | T1 覆盖 BevelGear 6 / Rack 6；T2 同步 |
| **P4 蜗杆（高风险）** | `worm_gear.ts` + 端面策略（首选 / 兜底二选一，按 STEP 比对结果定） | T1 覆盖 Worm 3；T2 同步；如启用兜底，在文档记录并说明拓扑差异 |
| **P5 交叉齿 + 齿轮对** | `crossed_gear.ts`（CrossedHelicalGear / HyperbolicGear）+ `pairs.ts`（BevelGearPair / CrossedGearPair / HyperbolicGearPair / PlanetaryGearset / HerringbonePlanetaryGearset，返回带 `outputs` 的记录）；为这 6 个类**新写**回归用例（cq 没有），参考 STEP 由 Python 侧同步生成 | T1/T2 覆盖到 15 个类 |
| **P6 测试完善** | T3 稳定性移植（含子进程隔离模式）+ 报告器；`sync-cases` 脚本；脚本级 e2e（`.fai.js` 里 `import * as gears from '@faicad/fai-cq-gears'` 调 `gears.spurGear(...)` 并被后续 `cad.*` 消费） | `npm run test -w` 全绿；e2e 进 `packages/tests` |
| **P7 收尾** | Agent Note、`npm run doc-sync`、幽灵依赖 / workspaces 顺序 / madge 无环守卫、CI 冒烟（只跑受影响包） | 全绿 |

> 纪律（AGENTS.md）：先跑自己写的测试 → 再跑可能被影响到的测试 → 全绿后才准跑 CI，
> **严禁靠跑 CI 找 bug**。

---

## 8. 验收

1. **功能**：15 个类全部有导出函数，参数名与 Python 逐字一致；`contractVersion` 已导出；
   `.fai.js` 里 `import * as gears from '@faicad/fai-cq-gears'` 可调、返回值被后续 `cad.*` 消费。
2. **T1**：31 例（+P5 新增的 6 个类用例）全部满足 `|Δvolume| ≤ 1e-3`、`|Δbbox| ≤ 1e-3`。
3. **T2**：全部用例 `compareStepFiles(...).equivalent === true`（容差按 P0 校准值，
   `strictTopology: false`）；失败输出五维明细。
4. **T3**：稳定性套件可复现（同 seed 同结果），报告含通过率与失败标签分布；
   已知的不稳定参数区间要有记录（而不是把用例删掉）。
5. **零核心改动**：`packages/core/src/**`、`packages/cq-compat/src/**` 除
   `CLI_ALLOWED_LIBS` 一行外无改动（`git diff` 核验）；若实施中确实需要改，
   必须单独说明理由并走用户确认。
6. **工程守卫**：`check-ghost-deps`、`check-workspaces-order`、`madge --circular` 全过；
   `npm run typecheck`、`npm run doc-sync` 全过；测试 stderr 零输出。
7. **可复现**：`fixtures/reference/` 入库，附生成时的 cq_gears / cadquery 版本与源 commit sha。

---

## 9. 已裁决 / 降级阶梯 / 待拍板

**已裁决（本方案拍板，实施照此执行）**

| # | 事项 | 裁决 |
|---|---|---|
| 1 | 库名 | 目录 `packages/fai_cq_gears`，npm `@faicad/fai-cq-gears`，绑定 `fai_cq_gears` |
| 2 | API 形态 | 单调用（构造 + build 合一），参数名沿用 Python |
| 3 | 比对工具 | 直接依赖 `@faicad/cq-compat`（devDep）复用 `compareStepFiles`，不搬运不改写 |
| 4 | 参考 STEP | 用 `C:\Users\yuan_\cq-editor\python.exe` 生成，入库，附版本与源 sha |
| 5 | `strictTopology` | 恒为 `false`（B-spline 表示必然不同） |
| 6 | 齿轮对返回形态 | 具名记录 + `fn.outputs`（逐件可比对着色），不返回 compound |
| 7 | `Workplane.gear/addGear` 猴子补丁 | 不移植，记录为已知差异 |
| 8 | 改 occt-wasm / 加内核能力 | **禁止**（预编译 wasm，无 C++ 源码），缺口只能靠组合或换构造策略 |

**降级阶梯（STEP 比对不达标时，按顺序，每步都要出实测数据并告知）**

1. 换 §4.4 的曲面方案（S1→S2→S3），看偏差是否收敛；
2. 局部重构造（例：Worm 端面走 §4.7 兜底），以布尔差体积为主判据；
3. 逐类设容差（而非全局放宽），并在 `docs/analysis/` 记录每类的实测偏差与原因；
4. 仍不达标 → **上报用户**，给出「偏差量级 + 影响面 + 建议（接受差异 / 改判据 / 改目标）」，
   由用户决定。**绝不允许静默放宽容差让测试变绿**（用户既有红线）。

**待用户拍板（不阻塞 P0–P2）**

1. 参考 STEP 是否全部入库（31 件，体积待 P0 实测）——默认「是」，超限才裁剪；
2. P5 是否要给 cq 没有回归用例的 6 个类新建参考（默认「是」，否则这 6 个类无一致性证据）；
3. `fai_cq_gears` 是否需要**同时**提供 mesh 路径实现（当前设计是 brep-only，mesh 模式返回
   `E_MESH_UNSUPPORTED`，与 `gear-lib-demo` 一致）。齿轮的 mesh 等价实现基本不可能用
   多边形逼近到 1e-3，建议不做——如用户要求再议。
