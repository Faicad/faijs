# 小程序端三角化性能优化：延迟三角化 + deflection 旋钮（2026-10-21）

- 状态：**已落地（端侧 benchmark 验证通过，2026-10-22）**
- 产出来源：3d_editor `docs/plans/2026-10-21-face-bench-actual.md` 实测报告 + 用户指令
- 涉及仓库：`faijs`（实现方，改动在此）、`3d_editor`（消费方：升级依赖 + weapp worker 装配两行配置）
- 用户原话（逐字，关键部分）：「我需要优化小程序运行faijs的性能，首要优化是隐藏终端延迟三角化。然后 scale3d 导致三角化极度膨胀，增大 deflection，都可以尝试」

---

## 1. 实测基线（2026-10-21，brepkit-wasm + interpreter 后端）

- 端侧 bundle 复测（2026-10-21 23:36 构建）：execute 中位数 **64,581ms**（5 次：
  45,342 / 56,983 / 64,581 / 65,024 / 68,701，机器负载下）；报告 65.8s 是 0.36.13
  「一份 mesh」P2 落地前的数字。节点探针（空载顺序跑）：eager@默认 ≈ 57.7s。
- 13 个终端，几何产出：ear_left/right 各 32,164 顶点（未缩放球 482 顶点的 66 倍）、
  mouth_cut 16,036、human_face 36,214（bundle 与探针逐字节一致）。
- **三角化不是主瓶颈**：`kernel.meshShape` 全量仅 ~4.1s（30 次）/57.7s（~7%）。
  报告"三角化 ~40%"是 65s 时代（拓扑对同一 solid 二次三角化 + 参数兜底 2π/32）的
  旧结论，P2（一份 mesh + meshShapeCache 命中）后已失效。真正的耗时大头是 BREP
  布尔（subtract/union，报告 50-60%）+ 收尾拓扑/面表/序列化（随三角数缩放）。
- 脚本执行链上每次 op 产出**即三角化**：`sphere → scale3d → translate` 链每一步都
  `meshShape` 一次，链中间产物全部浪费（约 30 次三角化，终端只有 13 个）——defer
  的价值在于砍掉这 17 次（约 2.5s）+ 把 13 次终端三角化推迟到收尾。

## 2. 优化一：隐藏终端延迟三角化（用户指定首要）

### 2.1 现状

- `brep/brep-ops.ts::solidToShape` 在**每个 BREP op** 产出时急切 `kernel.meshShape`，shape 携带 positions/indices + `BREP_TESS` 槽。
- `cad-runtime/runtime.ts::collectDirectResult` 在收尾时对**所有终端**（含 keepHidden）构建 BREP 拓扑（`buildBrepTopology` 命中 `meshShapeCache`，不再二次三角化——P2 已生效）。
- 中间产物（被布尔/变换消费、非终端）的三角化完全浪费：face.fai.js 全量执行约 30 次 `meshShape`，仅 13 次对应最终终端。

### 2.2 方案：op 产出延迟三角化，收尾只物化终端

新增运行时配置 `tessellationTiming: 'eager' | 'defer'`（缺省 `'eager'`，行为零变化）：

- **`'defer'` 模式**：`solidToShape` 不调 `meshShape`，产出空 mesh（`Float32Array(0)` / `Uint32Array(0)`）+ 挂 `BREP_LAZY_TESS` 描述符（kernel + solid + 三角化参数）。
- **收尾物化**：`collectDirectResult` 计算终端后，先物化需要显示的 shape——可见终端**必物化**（显示 + 拓扑红线：物化参数与创建时完全相同，写入 `positions/indices` + `BREP_TESS` + `meshShapeCache`，`buildBrepTopology` 命中同一份 mesh）；隐藏终端按拓扑开关物化。**中间产物永不物化**（省 ~53% 三角化）。
- **按需物化兜底**：
  - `getCachedOutput(partName)`：读到懒 shape 时物化（宿主迟取隐藏终端/导入件）。
  - `define-op.ts` 分派：判定走 **mesh 链**（链切换，mesh-only op 消费 BREP 输入）时，先物化 BREP 输入（mesh 实现读 `positions`）。
  - `topoMode: 'brep'`（对全部 shape 建拓扑）：先物化全部 shape（拓扑与显示同源，红线不破）。
- **不变量**：物化 = 用创建时记录的参数调 `kernel.meshShape` 一次；已物化 shape 的 `BREP_LAZY_TESS` 删除（幂等）；拓扑 mesh === 显示 mesh（同一份 positions/indices 引用）。

### 2.3 预期收益

- 全量 execute：30 次 `meshShape` → 13 次（中间产物 17 次省掉），meshShape 耗时
  ~4.1s → ~1.6s（-2.5s，~4%）。**defer 单独不是大头**——三角化只占 7%；
  真正的杠杆是与 angular 组合（见 §3/§6）：defer + angular 2π/32 合计 57.7 → 36.1s。
- 增量 update：每次 update 重放的后缀中，链中间产物不再三角化；未变化终端的 mesh
  已在上一轮物化、`BREP_TESS` 槽保留，`meshShapeCache` 命中，本轮零新增三角化。
- 隐藏终端：keepHidden 源在 `topoMode:'off'` 或宿主确认不需拓扑时可完全跳过物化
  （后续可选 `deferHidden` 开关，本次不默认开，避免行为变化）。

### 2.4 风险与处置

| 风险 | 处置 |
|---|---|
| 链切换：mesh-only op 消费 BREP 输入（空 mesh → 垃圾几何） | `define-op.ts` mesh 分支前物化输入（§2.2 兜底），实现即报错的静态门禁 |
| 拓扑红线：拓扑 mesh 必须 == 显示 mesh | 物化先于拓扑构建，同一份 mesh 写入缓存（P2 既有机制），不做"同参数再算一次" |
| `topoMode:'brep'` 对中间产物建拓扑 → 兜底三角化（参数不同） | 该模式下先物化全部 shape，杜绝兜底 |
| 内容 key（statementCache）对懒 shape 退化 | 收尾物化后再算 content key（顺序调整），终端 key 为真实 mesh |
| 空 mesh 的 wire 序列化（中间产物） | 中间产物本就不渲染；wire 只携带终端（weapp 真源是 terminals） |
| 覆盖其他宿主（web/desktop） | `'defer'` 缺省关闭；weapp worker 显式开启 |

## 3. 优化二：deflection 实测无效 → 实际旋钮是 angular（可尝试，已定案）

- **linearDeflection 在 brepkit 下无效**（探针实测 0.1/0.3/0.5 几何逐字节一致），
  scale3d 膨胀与它无关——用户提出的"增大 deflection"在端侧不成立，替换为
  `angularDeflection`（全局默认 2π/64 rad；报告 §2.1 "默认 0.5 rad" 亦为错）。
- 放宽 angular 2π/32：ear 32,164 → 7,908、human_face 36,214 → 11,958
  （-67% 顶点）；meshShape 1.6s → 0.78s；**下游拓扑/面表/序列化随三角数同比例
  下降**——execute 56.0 → 36.1s（-36%）。2π/16 只再省 ~2s 但网格粗 7×，不取。
- 改动：weapp worker `faijs.worker.ts` 的 `createRuntime` options 增加
  `tessellation: { angularDeflection: 2 * Math.PI / 32 }`。
- **不改脚本 segments**：基本体自身三角化由显式 `segments`（2π/segments）决定，
  全局旋钮只影响变换/布尔产物（终端多为链末产物，跟随全局）。要再压基本体网格
  需改脚本参数（超出本次运行时优化范围，报告 §2.4 "segments 无效"在 brepkit
  下亦不成立——实测 head 跟随全局 angular 即因 head 终端是 scale3d 产物）。

## 4. API 契约（faijs 对外）

| 入口 | 签名变更 | 语义 |
|---|---|---|
| `CadRuntimeOptions.tessellationTiming` | 新增 `'eager' \| 'defer'`（缺省 eager） | BREP 显示 mesh 三角化时机 |
| `CadRuntimeOptions.tessellation` | 已有（不新增） | 全局 deflection 旋钮 |
| 内部 `BREP_LAZY_TESS` Symbol | 新增（mesh/types.ts） | 懒三角化描述符挂载槽 |
| `solidToShape` 行为 | 按运行时 timing 分支 | eager 路径代码不变 |

## 5. 测试计划（faijs）

1. `test/brep/deferred-tessellation.test.ts`（常驻）：
   - `tessellationTiming:'defer'` 下对 `kernel.meshShape` 打 spy：链中间产物（sphere→scale3d→translate 的第一二步）**0 次** meshShape；终端各 1 次。
   - 拓扑与显示 mesh 同源：`result.topology` 的面行区间与显示 mesh 一致（复用 face-mesh-alignment 的断言函数）。
   - 几何产出与 eager 模式**逐字节一致**（defer 物化参数相同）。
   - `getCachedOutput` 对懒 shape 物化；二次调用幂等。
   - `topoMode:'brep'` 下全部 shape 物化。
2. `test/brep/deferred-tessellation-chain-switch.test.ts`：mesh-only op（如 `cad.hole` screw 变体）消费 BREP 懒输入 → 物化后正确产出（不断言崩溃/垃圾）。
3. 探针 `test/perf/face-tessellation-probe.test.ts`（perf 配置，CI 不跑）：FACE_DEFLECTION / FACE_RUNS 环境变量控制，输出每终端顶点数与耗时。

## 6. 实施记录

### 探针数据（2026-10-21，packages/core 活源码，brepkit，interpreter，auto 模式）

**引擎校准（重要）**：perf 配置必须用独立 setup（`test/perf/setup-perf.ts`，只注册 brepkit）。
若沿用 `test/test-setup.ts`（先注册 OCCT → 抢占 `defaultBrepId`），探针会**静默跑在
OCCT 上**（实测 head 1,999 vs bundle 7,908，数据作废一次）。

**结论 1：brepkit 忽略 `linearDeflection`**（0.1 / 0.3 / 0.5 三档几何**逐字节一致**）：

| linearDeflection | head | ear_left | human_face | 耗时（2 轮, min/med） |
|---|---|---|---|---|
| 0.1（默认） | 7,908 | 32,164 | 36,214 | 45,401 / 72,111ms |
| 0.3 | 7,908 | 32,164 | 36,214 | 31,774 / 35,349ms |
| 0.5 | 7,908 | 32,164 | 36,214 | 31,433 / 32,973ms |

（几何与端侧 bundle 基线完全一致：head 7,908 / ear 32,164 / human_face 36,214，
探针与 bundle 对拍成立。耗时差异为机器负载噪声，不代表趋势。）
→ **报告 §3「增大 deflection」在 brepkit 上不成立**：scale3d 膨胀与 linearDeflection 无关。

**结论 2：有效旋钮是 `angularDeflection`（全局默认 2π/64；报告 §2.1 称 0.5 为错）**：

| angularDeflection | head* | ear_left | human_face | 耗时（2 轮） |
|---|---|---|---|---|
| 2π/64（默认） | 7,908 | 32,164 | 36,214 | ~45-72s |
| 2π/32 | 1,924 | 7,908 | 11,958 | ~31-35s |
| 2π/16 | 1,924 | 916 | 4,966 | ~31-33s |
| 2π/8 | 1,924 | 468 | 4,518 | ~31-32s |

（*head/ear 等**终端**多为变换/布尔产物（scale3d/translate/subtract/union 结果），走
`solidToShape` → 用**全局 angular**，故跟随全局旋钮；基本体自身三角化由显式
`segments` 决定（2π/segments），但终端名指向的是链末产物。angular 放宽到某档后网格
达到 linearDeflection 0.1 的地板（head 2π/16 起停在 1,924、ear 停在 468），继续放宽
angular 不再减网格。）

**结论 3：三角化不是主瓶颈（重要修正）**——`meshShape` 全量耗时仅 ~4s/57s（7%）。
报告"三角化 ~40%"是 65s 时代（拓扑二次三角化）的旧结论；P2 落地 + brepkit 后
三角化已很便宜。defer（30→13 次 meshShape）只省 ~1.7s（~3-4%）。

**结论 4：angular 放宽的收益主要来自下游（拓扑/序列化）随三角数缩放**：

| 配置（linear=0.1） | execute | meshShape 次数/耗时 |
|---|---|---|
| eager @ 默认 angular | 57.7s | 30 次 / 4.1s |
| defer @ 默认 angular | 56.0s | 13 次 / 1.6s |
| **defer @ angular 2π/32** | **36.1s** | 13 次 / 0.78s |
| eager @ angular 2π/32 | 39.4s | 30 次 / 1.7s |

（空载顺序跑，node 探针，单轮；绝对数有机器噪声，相对关系稳定。）
→ **最终组合：defer + angular 2π/32 = 57.7s → 36.1s（-38%）**；其中 defer ~4%、
angular ~33%（顶点 36,214 → 11,958，拓扑/面表/序列化成本随三角数同比例下降）。

**结论 5：隐藏终端语义**——`topoMode:'auto'`（weapp 现状）下隐藏终端仍需物化
（拓扑为全部终端构建），defer 的收益 = **把全部三角化推迟到收尾并砍掉中间产物**
（30→13），隐藏终端的**纯跳过**需 `topology:'off'` 或后续 `deferHidden` 开关。

**最终配置决策（待端侧 bench 验证后拍板）**：
- `tessellationTiming: 'defer'` —— 必开（首要优化）。
- `tessellation: { angularDeflection: 2π/32 }` —— 替代无效的 linearDeflection；
  预期 ear 32,164 → 7,908、human_face 36,214 → 11,958（-67% 顶点），显示/拓扑同源
  不破。**不改脚本 segments**（head 等基本体不受全局旋钮影响，需改脚本才动）。

### 落地步骤

1. runtime-state：`tessellationTiming` 状态 + `configureTessellationTiming` / `getTessellationTiming`。✅
2. mesh/types：`BREP_LAZY_TESS` Symbol 槽。✅
3. brep-ops：`solidToShape` defer 分支 + `deferred-tess.ts`（materializeTessellation）。✅
4. **api/primitives：`brepPrimitiveMesh` defer 分支**（基本体绕过 solidToShape，独立补挂 faceRanges）。✅
5. runtime：`CadRuntimeOptions.tessellationTiming` + collectDirectResult 物化 + getCachedOutput 物化。✅
6. define-op：mesh 链分派前物化懒输入。✅
7. 单测（deferred-tessellation.test.ts 6/6）+ 探针数据。✅
8. 版本升级（`npm run set-version -- 0.37.0` → `pack`）→ 3d_editor `npm run update-faijs`（首轮直装后 verify 报 lock 行 peer 元数据 ^0.36.0，按脚本提示补 `--full-install` 重新解析，3 包 @0.37.0 全 OK）。✅
9. weapp worker：`createRuntime` 加 `tessellationTiming:'defer'` + `tessellation:{angularDeflection:2π/32}` → `npm run build:worker` → 复跑 bench-face.mjs。✅
10. 真机回归（weapp 渲染/拾取/拓扑一致性）——端侧 worker-sim bench 已验证几何/拓扑/红线，真机渲染待产品回归。

### 端侧验证结果（2026-10-22，worker bundle 0:46 构建，bench-face.mjs 5 次）

| 指标 | 基线（eager @ 默认 angular，0.36.13 bundle） | 优化后（defer + angular 2π/32，0.37.0 bundle） |
|---|---|---|
| execute 中位数 | **64,581ms** | **31,927ms（-50.5%）** |
| execute 区间 | 45,342 – 68,701ms | 30,923 – 32,693ms |
| head 顶点 | 7,908 | 1,924 |
| ear_left/right 顶点 | 32,164 | 7,908 |
| human_face 顶点 | 36,214 | 11,958 |
| 终端数 / brepProduced | 13 / 13 | 13 / 13（source=brep 全 13） |
| Function 构造器 | 0 | 0 |

- 几何产出与探针 angular 2π/32 逐项一致（ear 7,908 / human_face 11,958 / head 1,924），
  探针→bundle 对拍成立。
- 收益超 §6 预估（-38% → -50.5%）：探针为单轮含噪声；angular 放宽对下游
  （拓扑/面表/序列化/消息序列化）的削减在完整 bundle 上比 node 探针更充分。
- 中间产物不物化的次数量化：defer 单测断言 meshShape 计数 30 → 13（与 §2.3 一致）。
