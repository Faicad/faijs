# fai_cq_gears —— 把 cq_gears 移植为 faijs 库（以 cq-compat 为地基的可执行规范）

日期：2026-09-11
修订：2026-09-11 第 2 版（架构反转：从「裸 occt-wasm 内核自建」改为「依赖 `@faicad/cq-compat` 建模层」）
状态：**15 类功能移植全部已落地（2026-09-13，见 §8 各类标注与 §13 风险表现状列）；架构迁移（cq-compat 化，§1/§4）与 T3 稳定性测试（§9.3）未实施**
移植源（交由执行方持有，本机可不可用不影响本规范）：`C:\git\CADQ\cq_gears`（cq_gears 0.62，Apache-2.0）
基线仓库：`D:\Faicad\faijs`
前置资产：`docs/analysis/2026-09-08-fai-cq-gears-spike.md`（P0 定案）、`docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`（比对工具红线）、`docs/plans/2026-09-08-cq-compat-parity-phase2.md`（cq-compat 进度与阻塞）

> **基线声明（必读）**：本规范中所有关于 faijs / cq-compat 现状的结论，均为 **2026-09-11 在 `D:\Faicad\faijs` 实测**
> 得到（文件路径 / 符号 / 行号见 §1 与各处标注）。faijs 处于高频重构期，**本规范只代表写下那一刻的事实**；
> 执行前对本文标注的「复用点 / 缺口」必须按所给位置重新 `Read` 一遍，与原代码冲突时以代码为准，
> 并把冲突写进 `.agents/notes/` 与新的 analysis 文档，不要静默绕过。

---

## 0. 用户原始需求（逐字）

> 这个移植已经完成了，现在我需要写一份新的开发计划，把 C:\git\CADQ\cq_gears 库移植为 faijs 的库，名字为 fai_cq_gears。除了功能，还需要移植测试。并且要利用已有的 STEP file equivalence comparison utility 来保证移植后双方的建模结果是一致的。

> 当前请求（2026-09-11 第 1 版）：这份文档已过期，请重新写一份，要给能够无歧义的交给第三方执行。

> **当前指令（2026-09-11 第 2 版，本次重写依据）**：必须重新写这份方案，让 cq_gears 的移植**依赖 cq-compat**。
> 即 fai_cq_gears 不得直接在裸 `occt-wasm` 内核上自建几何，必须复用 `@faicad/cq-compat` 的 Workplane 建模层；
> cq-compat 缺失的齿轮必需原语作为 cq-compat 的扩展任务补齐，fai_cq_gears 阻塞其上。

拆解为 4 个目标，执行方必须逐项交付证据：

| # | 目标 | 本规范要求 |
|---|---|---|
| G1 | cq_gears → faijs **库**（非脚本），名 `fai_cq_gears` | 见 §6：包 `packages/fai_cq_gears`，绑定名 `fai_cq_gears`，导出函数式 API，返回 `Result` |
| G2 | 功能完整移植 | 15 个类全部有对应导出（§8 逐类给出 cq_gears 源 op → cq-compat op 映射） |
| G3 | 测试一并移植 | 三层测试 T1 回归（31 例 + 6 新类）、T2 STEP 等价性（用户点名核心）、T3 稳定性（§9） |
| G4 | 用已有 STEP 等价性工具保证双方一致 | 复用 `@faicad/cq-compat` 的 `compareAssemblyFiles`（**不是** `compareStepFiles`，原因见 §1.8），A 侧 Python 出参考 STEP，B 侧 faijs（经 cq-compat）出对照 STEP |

---

## 1. 架构决策反转（本版核心）

### 1.1 第 1 版的错误

第 1 版（已被本版取代）要求 fai_cq_gears **直接在裸 `occt-wasm` 内核上自建**几何（`RawOcctKernel` + 自写 `geom-build.ts` / `spline-face.ts` / `kernel.ts`），并规定"不改 cq-compat、不搬运实现"。
经评审，这是**重复劳动**：cq-compat 已经趟过的裸内核怪癖（wire 装配丢边、shell 外扩开口、loft 共面/退化顶点、union-compound 误判等）fai_cq_gears 会重新撞一遍，只是"不 import 规避函数、自己重写一遍等价逻辑"。

### 1.2 本版决策：fai_cq_gears 是 cq-compat 的**消费者**

cq_gears 在 Python 里本就是**建立在 CadQuery `Workplane` 操作之上**的库（`extrude` / `cut` / `union` / `loft` / `fillet` / `revolve` / `face` / `spline` / `translate` / `rotate` / `mirror`…）。
`@faicad/cq-compat` 就是 CadQuery `Workplane` API 的 TS 兼容层（见 `packages/cq-compat/src/index.ts` 导出的全套 op）。
因此**最自然的移植就是 1:1 翻译**：把 cq_gears 每个 `_build` 方法里的 CadQuery 调用，逐条映射到 cq-compat 的对应 op。
这样 fai_cq_gears 自动继承 cq-compat 已解决的怪癖与规避，**不再重复踩坑**。

### 1.3 依赖边界（精确，避免歧义）

fai_cq_gears **依赖** `@faicad/cq-compat` 的：

1. **全部建模 op**（§3 映射表）：extrude / cut / union / intersect / combine / loft / fillet / chamfer / shell / revolve / hole / face / spline / wire / box / cylinder / cone / torus / wedge / circle / ellipse / polygon / rect / rarray / translate / rotate / mirror / workplane / faces / edges / vertices / center / pushPoints / moveTo / lineTo / add / compound / val / transformed 等（`cq-compat/src/index.ts` 已导出，2026-09-11 实测）。
2. **STEP 比对工具** `compareAssemblyFiles` / `printAssemblyReport`（`cq-compat/src/index.ts:97` 导出）——T2 门禁，黑盒复用。
3. **cq-compat 必须补齐的 4 个扩展原语**（§4，E1–E4）：`splineFace`(B-spline 曲面) / `helix`(螺旋线) / `splitFace`(平面裁面) / `twistExtrude`(扭转拉伸)。这 4 个 cq-compat 当前**未导出**，是 fai_cq_gears 的硬阻塞点。

fai_cq_gears **不依赖**（即禁止直接调用）：

- 裸 `occt-wasm` 内核（`initOcctWasm` / `RawOcctKernel`）。除 §5 列出的 4 个缺口临时 shim 外，库运行时代码不得 `import` 或调用 `occt-wasm` 原始方法。
- 任何绕过 cq-compat op、自己用 `BrepEngineApi` 拼布尔/缝合/建面的代码。

### 1.4 依赖的硬阻塞含义（执行方必须正视）

fai_cq_gears 的完成度**受 cq-compat 进度硬阻塞**：

- cq-compat 当前 parity **34.46% / PASS 220 / FAIL 0**（2026-09-10，`out/report.md`）。齿轮相关的核心 op 大多已 ported（extrude 71 个镜像、cut 10、union 12、loft 17、shell 9、face 18、spline 2、wire 9、translate 18、rotate 8、mirror 4、workplane 46 等），但 fai_cq_gears 要求的几何精度（T1 体积/bbox 1e-3、T2 STEP 等价）可能高于 cq-compat 现有 case 的精度。
- **建议并行推进**：cq-compat 先补 E1–E4 + 把 gear-relevant op 子集在齿轮精度下跑绿；fai_cq_gears 同步做 1:1 翻译 + T1/T2。两者不是先后，而是 cq-compat 的 E1–E4 必须先合入，fai_cq_gears 才能解锁对应齿轮类。

---

## 2. 现状基线（2026-09-11 实测；按本版架构重新解读）

### 2.1 已存在的包与文件清单（已 `find` 核实）

```
packages/fai_cq_gears/
  package.json                 # name @faicad/fai-cq-gears, v0.1.0, type module
  tsconfig.json / tsconfig.build.json
  vitest.config.ts             # alias 到 core/cq-compat/faijs 活源码（不经 dist）
  fixtures/reference/          # manifest.json + spur-basic.step / spur-helix15.step / control-box.step（已入库）
  src/
    math.ts                    # numpy 子集（vec3/add/sub/scale/dot/cross/norm/…）✅ 保留（纯 TS，无关内核）
    profile.ts                 # GEAR_BASE_CONSTANTS / SpurGearGeometry / spurGearGeometry() /
                               #   toothFaceGrids() —— ⚠️ 仅 SpurGear；✅ 保留（纯数学，无关内核）
    spline-face.ts             # buildSplineFace + S1/S2/S3 —— ❌ 本版废除：改为走 cq-compat loft / E1 splineFace
    geom-build.ts              # connectEdgesToWires / combineWires / faceFromWires / shellToSolid —— ❌ 本版废除：改为走 cq-compat wire/face/loft/shell/union
    kernel.ts                  # RawOcctKernel 接口 + getRawKernel() —— ❌ 本版废除（仅作 §5 缺口临时 shim 残留，须带删除期限）
    spur_gear.ts               # buildSpurGearSolid / buildToothFaces / planarCapAtZ —— ⚠️ 须重构为 cq-compat 编排
    fixtures.ts                # loadManifest / caseById / stepPath / REFERENCE_DIR / OUT_DIR ✅ 保留
    testing/compare.ts         # CALIBRATED_COMPARE / compareCase —— ✅ 保留（封装 cq-compat compareAssemblyFiles）
    kernel-probe.test.ts       # 核对 RawOcctKernel 方法 —— ❌ 废除（裸内核探针不再需要）
    profile.test.ts            # 数学层与 Python 逐点一致(1e-9) ✅ 保留
    spline-face.test.ts        # 三策略面积/偏差表 —— ⚠️ 改为校验 cq-compat loft / E1 splineFace 的齿面精度
  scripts/
    gen-reference.py           # Python 参考生成（--set spike|regression --out --ids）✅ 保留（A 侧）
    export-ours.ts             # B 侧 STEP 导出 —— ⚠️ 重构：经 cq-compat 调 fai_cq_gears.<fn>
    compare-all.ts             # 批量比对 + 汇总 ✅ 保留
    probe-gear.ts / probe-spline-face.ts  # 诊断用 —— ⚠️ 改为诊断 cq-compat op 行为
```

### 2.2 已验证可工作的结论（仍有效，但实现路径变）

- **齿面定案 S2 `row-approx-loft`**（尖峰报告 §3：直齿面积偏差 4.2e-11、斜齿 5.6e-7，比 S1/S3 好约 3 个数量级）。本版下该策略**翻译为 cq-compat `loft`**（多截面放样，S2 即逐行 wire 放样）；若 cq-compat `loft` 达不到该精度，则触发 E1（`splineFace`）。尖峰结论本身（S2 最优）不变。
- **数学层 `profile.ts` 与 Python 逐点一致至 1e-9**（尖峰报告 §3 末）——纯 TS，无关内核，直接保留。
- **参考 STEP/manifest 已入库**（spur-basic / spur-helix15 / control-box）——A 侧资产不变，B 侧改用 cq-compat 重建。
- **`compareAssemblyFiles` 已导出且 union-compound bug 已修**（详见 `docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`）——T2 仍黑盒复用。

### 2.3 命名与包形态（不变）

| 项 | 值 |
|---|---|
| 目录 | `packages/fai_cq_gears` |
| npm 包名 | `@faicad/fai-cq-gears` |
| `.fai.js` import specifier | `@faicad/fai-cq-gears` |
| 推荐绑定名 | `fai_cq_gears`（`runtime.registerLib('fai_cq_gears', ns, { compat: true })`） |
| 导出函数名 | Python 类名 → camelCase：`spurGear / ringGear / herringboneGear / herringboneRingGear / planetaryGearset / herringbonePlanetaryGearset / bevelGear / bevelGearPair / rackGear / herringboneRackGear / worm / crossedHelicalGear / crossedGearPair / hyperbolicGear / hyperbolicGearPair` |
| **参数名** | **逐字沿用 Python**（module / teeth_number / width / pressure_angle / helix_angle / bore_d / chamfer / hub_d / hub_length / recess / n_spokes / spoke_width / spoke_fillet / missing_teeth / rim_width / cone_angle / face_width / trim_bottom / trim_top / lead_angle / n_threads / length / height / twist_angle / shaft_angle …），**不做重命名** |

### 2.4 复用的既有资产（本版重定义）

- **数学层** `src/math.ts` / `src/profile.ts`：纯 TS，直接保留，移植各齿轮的 `utils.py` 数学部分时直接用，不另写、不碰内核。
- **比对** `src/testing/compare.ts`：保留，内部 `compareAssemblyFiles`（cq-compat）不变。
- **参考生成** `scripts/gen-reference.py`（A 侧）：保留。
- **建模层（本版唯一地基）**：`import * as cq from '@faicad/cq-compat'`，全部几何经 cq-compat Workplane op 构建。详见 §3 映射表。

### 2.5 已知缺口清单（本版视角，按严重度）

1. **【高】cq-compat 缺 4 个齿轮必需原语**（E1 `splineFace` / E2 `helix` / E3 `splitFace` / E4 `twistExtrude`）：cq-compat `src/index.ts` 未导出（2026-09-11 实测：makeSplineSurface 0 命中、makeHelix 0 命中、twistExtrude 不在 index、split face-by-plane 不在 index）。**这是本版依赖关系的硬阻塞**，必须在 cq-compat 内补齐（§4）。
2. **【高】`src/index.ts` 不存在**：15 函数 + `contractVersion` 未导出，库不可被 `registerLib` 装载。§6 给配方（本版下函数体改为编排 cq-compat op）。
3. **【高】`CLI_ALLOWED_LIBS` 未含 `@faicad/fai-cq-gears`**（`packages/core/src/node-host/cli.ts:40`）：唯一允许的 core 改动（一行），`.fai.js` 加载路径需要；PR 显式说明。
4. **【中】`scripts/gen-reference.ps1` 缺失**：`npm run gen-reference` 失败；补 .ps1 或改 package.json 直调 python。
5. **【中】`export-ours.ts` 只接 SpurGear/Box**：每加一类在 `switch` 加分支（本版下分支内改调 cq-compat 编排后的 `fai_cq_gears.<fn>`）。
6. **【低】`gen-reference.py --set regression` 尚未生成 31 例 + 6 新类参考**：现入库 manifest 仅 `set: spike`。

### 2.6 比对用 `compareAssemblyFiles` 而非 `compareStepFiles`（红线，不变）

cq 导出的参考 STEP 是 N 个独立 PRODUCT/solid，faijs 导出可能是 1 个 compound 内含 N 个 solid；`compareStepFiles` 只比总 solid 数，会把「2 parts vs 1 compound」误判通过（见 `docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`）。**所有 STEP 比对走 `compareAssemblyFiles`**，`matchNames: false`。

### 2.7 参考环境（两个候选 interpreter，执行方选可用者；旧文档 `yuan_` 路径保留，由执行方判断）

| 候选 interpreter | 说明 | 注意 |
|---|---|---|
| `C:\Users\yuan_\cq-editor\python.exe` | 原始机：cadquery 2.6.dev0 + cq_gears 0.62 | 旧文档源环境 |
| `C:\Users\ylt\cadquery-env\Scripts\python.exe` | 本机：cadquery 2.8.0 + cadquery-ocp 7.9.3.1.1 | 版本不同，生成参考前先 `import cadquery, cq_gears` 干净通过 |

环境变量：`FAI_CQ_PYTHON`（interpreter）、`FAI_CQ_GEARS_SRC`（cq_gears 源码根，默认 `C:\git\CADQ\cq_gears`）。
**基线一致性红线**：所有参考 STEP/manifest 必须在同一 cadquery 版本下生成并入库；manifest 记录生成时 `python/cadquery/numpy/cq_gears_src_git_sha`，换环境重生成须同步更新。

---

## 3. cq_gears → cq-compat op 映射总表（1:1 翻译依据）

> 执行方打开 `C:\git\CADQ\cq_gears` 对应 `_build` 方法，把每个 CadQuery 调用按此表映射到 cq-compat。
> cq-compat op 均为 `async`（返回 `Promise<Workplane>`），故 fai_cq_gears 导出函数统一返回 `Promise<Result<...>>`（§6.2）。

| cq_gears（Python / CadQuery） | cq-compat op（已导出✅） | 备注 |
|---|---|---|
| `cq.Workplane('XY').circle(r).extrude(w)` | `cq.extrude(cq.circle(cq.Workplane('XY'), r), w)` | 盘/基础体 |
| `.circle(r).cutThruAll()` / `Workplane().cut(s)` | `cq.cutThruAll(wp)` / `cq.cut(wp, other)` | 钻孔/减料 |
| `.union(other)` / `.intersect(other)` | `cq.union(wp, other)` / `cq.intersect(wp, other)` | 布尔并/交 |
| `cq.Workplane().add(face)` / `Part.makeLoft(...)` | `cq.loft(wp, opts)` / `cq.add(wp, shape)` | 齿面/放样（S2 策略＝多截面 loft） |
| `cq.Solid(...).fillet(r, edges)` | `cq.fillet(wp, r)` | 倒圆（chamfer 用 `cq.chamfer`） |
| `.shell(t)` | `cq.shell(wp, t)` | 抽壳 |
| `.revolve(axis, angle)` | `cq.revolve(wp, ...)` | 回转（hub/spokes 端面） |
| `Face.makeFromWires` / `Wire.combine` | `cq.wire(wp)` → `cq.face(wp)` | 端面/截面成面（替代原 geom-build.ts） |
| `cq.Workplane().translate/rotate/mirror` | `cq.translate / cq.rotate / cq.mirror` | 坐标变换 |
| `.workplane(offset).faces('>Z').hole(d)` | `cq.workplane` → `cq.faces` → `cq.hole` | 孔/定位 |
| `.pushPoints([...]).each(…)` / `cq.Location` | `cq.pushPoints` / `cq.center` / `cq.moved` | 齿/零件阵列定位 |
| **`Part.makeSplineSurface(grid)`** | **E1 `cq.splineFace(grid)`（待补）** | 齿面 B-spline（若 loft 精度不足） |
| **`cq.Workplane().twistExtrude(...)`** | **E4 `cq.twistExtrude(...)`（待补）** | 人字齿缺齿切除体 |
| **`Workplane().makeHelix(...)` / 螺旋扫掠** | **E2 `cq.helix(...)`（待补）** | 蜗杆 |
| **`face.split(plane)` / `split(keepTop)`** | **E3 `cq.splitFace(wp, plane)`（待补）** | Bevel/Rack/Worm 端面裁切 |

---

## 4. cq-compat 必须补齐的扩展（E1–E4，fai_cq_gears 的硬阻塞）

> 这 4 个原语 cq-compat 当前未导出（§2.5-1）。它们是 cq-compat 的工程任务，不是 fai_cq_gears 的。
> 实现路线参考 fai_cq_gears 第 1 版已在 `kernel.ts` / `spline-face.ts` / `geom-build.ts` 探明的裸内核调用（`bsplineSurface` / `approximatePoints` / `interpolatePoints` / `makeHelixWire` / `split` / `makeSolid` 等），但**必须落地在 cq-compat 内部**（新增 `compatOp` 或 Workplane op），fai_cq_gears 只消费、不抄。

| 编号 | 原语 | 消费方 | 裸内核实现线索（来自第 1 版探查） | 验收 |
|---|---|---|---|---|
| E1 | `splineFace(points)` / `Face.makeSplineSurface` | 齿面（S2 策略若 loft 不足） | `kernel.bsplineSurface` / `approximatePoints` / `interpolatePoints`（`kernel.ts:RAW_KERNEL_METHODS`） | 直齿面积偏差 ≤ 4.2e-11、斜齿 ≤ 5.6e-7（复刻尖峰 §3） |
| E2 | `helix(params)` wire | Worm | `kernel.makeHelixWire`（`kernel.ts`） | 螺旋线轴向误差 ≤ 1e-6 |
| E3 | `splitFace(wp, plane)` | Bevel / Rack / Worm 端面 | `kernel.split(face, [plane])`（`kernel.ts` 已声明） | 子面拓扑正确、体积守恒 |
| E4 | `twistExtrude(params)` | HerringboneGear / SpurGear(missing_teeth) | 旋转截面 + `loft` 逼近，或自建扭转网格面 | 2 个回归用例 T2 通过 |

**扩展落地约束**：
- 每个扩展走 cq-compat 既有 `compatOp` / Workplane op 注册机制，加 JSDoc（cq-compat 的 `verify-export-jsdoc` 门禁会扫全仓，见工作记忆 lefthook 门禁）。
- 扩展须自带 cq-compat 侧 `.fai.js` 镜像测试 + parity case，并入 cq-compat `tests/manifest.json`。
- fai_cq_gears 不 import 这些扩展的裸内核实现；只 `import { splineFace, helix, splitFace, twistExtrude } from '@faicad/cq-compat'`。

**临时 shim 条款（仅过渡期）**：在 E1–E4 合入 cq-compat 之前，fai_cq_gears 可在 `src/kernel.ts` 保留一个**明确标注 `// TEMP-SHIM: delete when cq-compat E{n} lands`** 的薄桥，直接调 `occt-wasm` 仅覆盖该缺口；E 落地后对应 shim **必须删除**，不得留作正式路径。这是本版唯一允许 fai_cq_gears 触裸内核的例外，且带删除期限。

---

## 5. fai_cq_gears 文件改造清单（保留 / 废除 / 重构）

| 文件 | 处置 | 说明 |
|---|---|---|
| `src/math.ts` | **保留** | 纯 TS numpy 子集，无关内核 |
| `src/profile.ts` | **保留** | 纯数学（渐开线/齿廓点阵），无关内核 |
| `src/fixtures.ts` | **保留** | 用例加载 |
| `src/testing/compare.ts` | **保留** | 封装 cq-compat `compareAssemblyFiles` |
| `scripts/gen-reference.py` | **保留** | A 侧参考 |
| `scripts/compare-all.ts` | **保留** | 批量比对 |
| `src/spline-face.ts` | **废除 → 改写** | 不再自写 B-spline；改为调 cq-compat `loft`（S2）或 E1 `splineFace`；原 S1/S2/S3 探索结论转为 cq-compat `loft` 参数校验 |
| `src/geom-build.ts` | **废除** | wire/face/shell/solid 组装改走 cq-compat `wire`/`face`/`loft`/`shell`/`union` |
| `src/kernel.ts` | **废除（仅留 §4 临时 shim）** | 不再作为主路径；`RawOcctKernel` / `getRawKernel` 仅服务于 E1–E4 落地前的临时桥 |
| `src/kernel-probe.test.ts` | **废除** | 裸内核探针不再需要 |
| `src/spur_gear.ts` | **重构** | `buildSpurGearSolid` 等改为编排 cq-compat op（见 §8.1） |
| `src/spline-face.test.ts` | **改写** | 校验 cq-compat `loft` / E1 `splineFace` 的齿面精度 |
| `src/index.ts` | **新建**（§6） | 15 函数 + `contractVersion`，函数体编排 cq-compat |
| `scripts/export-ours.ts` | **重构** | 经 cq-compat 调 `fai_cq_gears.<fn>` 生成 B 侧 STEP |
| `src/profile.test.ts` | **保留** | 数学层一致性 |

---

## 6. P1 收尾：公开 API 入口（§2.5-2 缺口）

### 6.1 创建 `src/index.ts`

模式照抄 `packages/gear-lib-demo/src/mock-mech-brep.ts` + `library-dev-guide.md` §2.6 / §3.3（brep 路径）。**本版下函数体经 cq-compat 编排**：

```ts
import { CONTRACT_VERSION } from '@faicad/faijs/sdk'        // 值=3，勿硬编码
import type { BrepHandle } from '@faicad/faijs-core'
import * as cq from '@faicad/cq-compat'                      // 唯一建模地基
import { spurGear, type SpurGearParams } from './spur_gear'
import { ok, type Result } from '@faicad/faijs/sdk'

export const contractVersion = CONTRACT_VERSION

/** 每个导出函数返回 Promise<Result<BrepHandle>>（cq-compat op 均为 async） */
export async function spurGear(params: SpurGearParams): Promise<Result<BrepHandle>> {
  try {
    const k = /* 取得 runtime 的 occt wasm 句柄（经 cq-compat 内部，不直接 initOcctWasm） */
    const solid = await buildSpurGearSolid(cq, params)      // 编排 cq-compat op
    return ok(solid as unknown as BrepHandle)
  } catch (e) { return err(...) }
}
// … 其余 14 个函数，参数名逐字沿用 Python（见 2.3）
```

> **6.2 同步→异步**：cq-compat op 均为 `async`，故 fai_cq_gears 导出函数统一返回 `Promise<Result<...>>`，调用方 `await`。这天然解决了第 1 版 §4.2 的同步/异步纠结（直接选 (a)）。
> **6.3 内核句柄**：fai_cq_gears 不自己 `initOcctWasm()`；cq-compat 负责 wasm 初始化与单例。fai_cq_gears 只在需要时经 cq-compat API 取得已初始化的内核（E1–E4 的裸内核线索通过 cq-compat 暴露，不经 fai_cq_gears）。

### 6.4 `fn.outputs` 标注（仅齿轮对/轮系）

`planetaryGearset / herringbonePlanetaryGearset / bevelGearPair / crossedGearPair / hyperbolicGearPair` 返回具名记录（`{ sun, planets, ring }` 等），按 `library-dev-guide.md` §2.6 挂 `fn.outputs`，使宿主逐件导出 STEP 做逐件等价比对。

### 6.5 不移植的 API 差异

- `Workplane.gear()` / `addGear()` 猴子补丁：faijs 不允许第三方库改写另一库载体。使用者直接调 `fai_cq_gears.spurGear(...)`。
- mesh 模式：`brep-only`，mesh 路径返回 `E_MESH_UNSUPPORTED`。

### 6.6 校验命令（P1 完成判据）

```
npm run typecheck -w @faicad/fai-cq-gears      # 0 错
npm run test    -w @faicad/fai-cq-gears        # 现有 test 全绿（spline-face.test 改写后）
# 装载自检：src/index.test.ts 里 runtime.registerLib('fai_cq_gears', lib, { compat: true }) 不抛
```

---

## 7. 通用构造流水线（Workplane op 版，A/B/C 三族共用）

对应 cq_gears 的 `_build`，全部经 cq-compat：

```
① profile：纯数学算出齿廓点集（math.ts + profile.ts，复用，无关内核）
② tooth faces：点集 → 多截面 wire → cq.loft(wp, {ruled})（S2 策略）；
   若 loft 精度不足 → 调 E1 cq.splineFace(grid)（§4）
③ 端面：边界边 → cq.wire(wp) → cq.face(wp)（替代原 geom-build.ts 的 connectEdgesToWires/faceFromWires）
④ solid：齿面 + 端面 → cq.union / cq.loft 缝合 → cq.shell（抽壳，若需）；
   体积为负时由 cq-compat shell/loft 语义归一化（继承 cq-compat 已修的 shell 外扩/共面处理，不再自写）
⑤ 后处理：chamfer → bore → missingTeeth → recess → hub → spokes
   全部经 cq.cut / cq.union / cq.revolve / cq.fillet（继承 cq-compat 的布尔/wire 规避，不再重踩）
⑥ 返回 Promise<Result<BrepHandle>>
```

**GearBase 常量逐字保留**（`src/profile.ts:GEAR_BASE_CONSTANTS`）：`ka=1.0 / kd=1.25 / curve_points=20 / surface_splines=5 / wire_comb_tol=1e-2 / spline_approx_tol=1e-2 / shell_sewing_tol=1e-2 / isection_tol=1e-7 / spline_approx_min_deg=3 / spline_approx_max_deg=8`。各子类覆盖常量（Bevel `surface_splines=12`、Worm `surface_splines=8 / wire_comb_tol=0.1 / t_face_parts=2`、Hyperbolic `surface_splines=2`）也逐字保留。

---

## 8. 逐类移植配方（P2–P5，每类给 cq_gears 源 op → cq-compat op）

> **状态（2026-09-13）：本节全部 15 类已落地**——但走的是 v1 裸内核路径（§13-6 阻塞
> cq-compat 化未解），非本节的 cq-compat op 编排。落地证据：`src/*.ts` 各构造器 +
> `docs/analysis/2026-09-13-fai-cq-gears-t2-full-rerun.md`（43 例 T2 复跑报表）。
> 本节其余内容保留为 cq-compat 化迁移（未实施）时的对照配方。

> 每类：源文件/类/方法（执行方打开 `C:\git\CADQ\cq_gears`）→ **cq-compat op 映射（§3）** → faijs 侧做法 → 验证。参数名逐字沿用 Python。

### 8.1 A 族·直纹/扭纹齿面（网格样条曲面）

#### SpurGear
- 源：`spur_gear.py::SpurGear._build_gear_faces / _build / _remove_teeth / _bore / _recess / _spokes / _chamfer / _hub`
- cq-compat 映射：`cq.extrude` / `cq.circle` / `cq.loft`(齿面 S2) / `cq.wire`+`cq.face`(端面) / `cq.cut`(bore/missing/recess) / `cq.revolve`(hub/spokes) / `cq.fillet`(chamfer)
- 待补（在 `spur_gear.ts` 内，经 cq-compat）：`bore_d`→`cq.cutThruAll` 或 `cq.cut` 圆柱孔；`missing_teeth`→直齿用截面 `cq.cut`（人字齿才需 E4 `twistExtrude`，见 8.2）；`recess`/`hub`/`spokes`→`cq.extrude`+`cq.cut`/`cq.revolve`+`cq.cut`；`chamfer`→`cq.fillet`(近似) 或 `cq.chamfer`
- 验证：T1 6 例；T2 6 例 EQUIVALENT

#### HerringboneGear
- 源：`spur_gear.py::HerringboneGear`（= SpurGear + 半齿扭转；`_remove_teeth` 用 `twistExtrude` 缺齿切除体）
- cq-compat 映射：同 SpurGear；扭转拼接走 `cq.loft` 两半相反扭转；`missing_teeth` 切除体走 **E4 `cq.twistExtrude`**（§4）
- 验证：2 例 T2 通过（E4 落地后）

#### RingGear / HerringboneRingGear
- 源：`ring_gear.py::RingGear`（内齿，`_build` 用 `Face.makeRuledSurface` / `makeLoft` 建轮缘面）
- cq-compat 映射：`cq.loft(wp, {ruled:true})` ≡ `makeRuledSurface`；`cq.wire`+`cq.face` 做内孔与轮毂；内齿齿廓点集取反（改 `rr`/`ra` 语义）
- 新增文件 `ring_gear.ts`
- 验证：T1 4 例；T2 4 例

#### PlanetaryGearset / HerringbonePlanetaryGearset
- 源：`ring_gear.py::PlanetaryGearset`（sun + n planets + ring，按 `shaft_angle` 定位）
- cq-compat 映射：组合单体（各自走 8.1）+ `cq.moved`/`cq.pushPoints`/`cq.Location` 定位
- 返回具名记录（§6.4）：`{ sun, planets[], ring, colors }`
- 验证：新建参考用例（§9.4），逐件 STEP 比对

#### CrossedHelicalGear / HyperbolicGear
- 源：`crossed_helical_gear.py`（轴交角 `shaft_angle`；HyperbolicGear `surface_splines=2`）
- cq-compat 映射：A 族齿面骨架；轴交角通过旋转各齿/截面坐标系（`cq.rotate`/`cq.moved`）
- 验证：T1 各 2 例；T2 各 2 例

### 8.2 B 族·球面渐开线（BevelGear）

- 源：`bevel_gear.py::BevelGear`（`s_inv`/`s_arc` 球面曲线 → 网格样条 → 两切割平面裁顶/底 `face.split` → `_trim_bottom/_trim_top` 回转体布尔切）
- cq-compat 映射：`utils.py` 数学搬进 `math.ts`（逐字）；齿面 `cq.loft`/E1 `splineFace`；**端面裁切走 E3 `cq.splitFace(face, [plane])`**；`cq.fillet` 倒角；`cq.revolve`+`cq.cut` 回转体切
- 新文件 `bevel_gear.ts`
- 验证：T1 6 例；T2 6 例（`strictTopology:false`，B-spline 表示差异，以体积/bbox 为主判据）

### 8.3 C 族·齿条 / 蜗杆

#### RackGear / HerringboneRackGear
- 源：`rack_gear.py`（直线廓形沿 x 平移；螺旋角时 tx 偏移；左右端 `face.split(plane)`）
- cq-compat 映射：廓形 `cq.wire`+`cq.face`；左右端面**走 E3 `cq.splitFace`**；Herringbone 变体背/顶/底面扭转拼接
- 新文件 `rack_gear.ts`
- 验证：T1 各 2–4 例；T2 同步

#### Worm —— 高风险（依赖 E2 + E3）
- 源：`worm_gear.py`（齿条廓形绕 x 轴旋转 + 沿 x 平移的螺旋扫掠；端面用 `make_cross_section_face`）
- cq-compat 映射：**螺旋线走 E2 `cq.helix`**；螺旋扫掠经 `cq.loft`(沿 helix wire 的多截面) 或 E2 提供的扫掠；**端面走 E3 `cq.splitFace`**（首选，与 Rack 同路线）；兜底：加长后与半空间 `cq.cut`，端面成平面（但拓扑 face/edge 数变，T2 须 `strictTopology:false` 且以布尔差体积为主判据）
- 新文件 `worm_gear.ts`
- 验证：T1 3 例；T2 3 例

### 8.4 齿轮对（返回记录，§6.4）

- `BevelGearPair`（`bevel_gear.py`）、`CrossedGearPair` / `HyperbolicGearPair`（`crossed_helical_gear.py`）：组装两单体 + `cq.moved` 按 `shaft_angle` 定位，返回 `{ gear1, gear2, colors }`，挂 `fn.outputs`
- 新文件 `pairs.ts`
- 验证：新建参考用例（§9.4），逐件 STEP 比对

---

## 9. 测试层（G3 + G4，用户点名核心）

三层测试全在 `packages/fai_cq_gears/src/**`；`npm run test -w @faicad/fai-cq-gears` 跑 T1+T2，`npm run test:stability -w …` 跑 T3。

### 9.1 T1 —— 回归测试（门禁）
- 数据：`fixtures/cases.json`（cq `regression_test_cases.json` 同步 31 例 + §9.4 的 6 新类），`id / class / args / expected:{volume, bbox}`。
- 断言：`|volume − expected.volume| ≤ 1e-3`、`|bbox.x/y/zlen − expected[i]| ≤ 1e-3`（绝对值）。
- 体积/bbox 来源：对库返回 solid 用 cq-compat 暴露的 volume/bbox 查询（与 cq `Volume()`/`BoundingBox()` 同内核算法）。**性质**：几何一致则这些数必一致；T1 不过不浪费时间导 STEP。

### 9.2 T2 —— STEP 装配等价性（用户点名核心，门禁）
全链路：`gen-reference.py`（A 侧）→ `export-ours.ts`（B 侧，经 cq-compat 调 `fai_cq_gears.<fn>`）→ `compare-all.ts`（装配比对）。
- A 侧：`scripts/gen-reference.py --set regression --out fixtures/reference`。
- B 侧：`npx tsx scripts/export-ours.ts`（同参数调 `fai_cq_gears.<fn>(params)` → 经 cq-compat 建几何 → 导出 STEP）。
- 比对：`compareCase(input)`（内部 `compareAssemblyFiles`，`CALIBRATED_COMPARE`）。
- **标定容差（尖峰 §6，写进 `CALIBRATED_COMPARE`，勿改除非新实测）**：

  | 维度 | 门禁 | 实测最坏 | 说明 |
  |---|---|---|---|
  | `strictTopology` | **false** | 全等（S2 确定性） | B-spline 表示必然不同 |
  | `linearTolerance` | 1e-3 mm | 2.8e-6 | 留 ~3 个数量级余量 |
  | `volumeRelativeTolerance` | 1e-6 | 1.4e-7 | 直齿 4e-12 |
  | `booleanVolumeTolerance` | `max(1e-3, vol×1e-6)` | — | 布尔差绝对量，按件缩放；不进门禁主判据 |
  | `matchNames` | false | — | 按索引配对 |

- 判据：每例 `result.equivalent === true`；失败 `formatCompareLine` 输出四维明细。
- **31 例全绿；Worm/Bevel 调不进容差时按 §10 降级，绝不允许静默放宽。**

### 9.3 T3 —— 稳定性测试（非默认门禁）
- `gen_params`：确定性 PRNG（`src/rng.ts`，seed 可复现）。执行方补 `src/rng.ts`（当前缺失）。
- 不变量照抄 cq（`isSolid` / 体积上下界 / bbox 三方向 `BBOX_CHECK_TOL=0.5`）。
- 失败标签：`PRECALC / BUILDING / NOT_SOLID / VOLUME / BBOX_Z / BBOX_XY / TIMEOUT`。
- **超时机制必须换**：wasm 挂死无法进程内中断。用 `spawnSync('node', ['--import','tsx','runner.ts',caseJson], { timeout })` → 超时 kill 标 `TIMEOUT`（参考 cq `scripts/stability.ts`）。
- 报告：汇总通过率 + 每类每标签计数，JSON 到 `out/stability-report-<ts>.json`。

### 9.4 参考 STEP / 用例入库（G4 数据基础）
- `gen-reference.py --set regression` 生成全量参考（31 例）；为 §8.1/§8.4 的 6 个无 cq 回归类（PlanetaryGearset / HerringbonePlanetaryGearset / BevelGearPair / CrossedGearPair / HyperbolicGear / HyperbolicGearPair）**新建参考用例**（cq 自身无这些类回归数据）。
- 入库：参考 STEP + manifest 提交仓库；总体积 > ~5 MB 裁剪到每类 2 例 smoke 集。
- manifest 记录生成时 `python/cadquery/numpy/cq_gears_src_git_sha`。

---

## 10. 降级阶梯（STEP 比对不达标时，按顺序，每步出实测数据并告知）

1. 齿面改走 E1 `splineFace`（若当前用 `cq.loft` 精度不足），看偏差是否收敛。
2. 局部重构造（例：Worm 端面走 §8.3 兜底），以布尔差体积为主判据。
3. 逐类设容差（而非全局放宽），在 `docs/analysis/` 记录每类实测偏差与原因。
4. 仍不达标 → **上报用户**，给「偏差量级 + 影响面 + 建议」，由用户定。**绝不允许静默放宽容差让测试变绿。**

---

## 11. 验收（交付前逐项核对）

1. **功能**：15 个类全部有导出函数（经 cq-compat 编排），参数名与 Python 逐字一致；`contractVersion` 已导出；`.fai.js` 里 `import * as gears from '@faicad/fai-cq-gears'` 可调。
2. **依赖合规**：库运行时代码 `grep -rn "occt-wasm\|initOcctWasm\|RawOcctKernel" src` **除 §4 临时 shim 外零命中**；全部几何经 `@faicad/cq-compat` op；E1–E4 落地后对应 shim 已删除。
3. **T1**：31 例 + 6 新类 `|Δvolume| ≤ 1e-3`、`|Δbbox| ≤ 1e-3`。
4. **T2**：全部用例 `compareAssemblyFiles(...).equivalent === true`（`strictTopology:false`、标定容差）。
5. **T3**：稳定性套件可复现，报告含通过率与失败标签分布。
6. **核心改动最小**：除 `cli.ts:40` 加一行 `CLI_ALLOWED_LIBS` 含 `@faicad/fai-cq-gears` 外，`packages/core/src/**` 无逻辑改动（`git diff` 核验）；补这行 PR 显式说明。**cq-compat 的 E1–E4 扩展改动在 cq-compat 仓库内、随 cq-compat PR 合入。**
7. **工程守卫**：`node scripts/check-ghost-deps.mjs`、`node scripts/check-workspaces-order.mjs`、`npx madge --circular packages/*/src` 全过；`npm run typecheck`、`npm run doc-sync` 全过；测试 stderr 零输出。
8. **可复现**：`fixtures/reference/` 入库，附生成时 cadquery/cq_gears 版本与源 sha。
9. **非平凡变更带 Agent Note**（`.agents/notes/`）。

---

## 12. 命令速查（执行方照抄）

```bash
# 0) 前置：参考 interpreter（二选一）
export FAI_CQ_PYTHON="C:/Users/ylt/cadquery-env/Scripts/python.exe"   # 或 yuan_ 机路径
export FAI_CQ_GEARS_SRC="C:/git/CADQ/cq_gears"

# 1) A 侧参考 STEP
cd packages/fai_cq_gears
python scripts/gen-reference.py --set regression --out fixtures/reference

# 2) B 侧对照 STEP（经 cq-compat 建几何）
npx tsx scripts/export-ours.ts

# 3) 装配比对
npx tsx scripts/compare-all.ts

# 4) 单包测试 / 类型
npm run test    -w @faicad/fai-cq-gears
npm run typecheck -w @faicad/fai-cq-gears

# 5) 全仓守卫（提交前）
node scripts/check-ghost-deps.mjs
node scripts/check-workspaces-order.mjs
npx madge --circular packages/*/src
npm run typecheck
npm run doc-sync
```

> 注：`package.json` 现有 `test:spike` 指向 `vitest run src/spike`，但 `src/spike/` 不存在；执行方要么创建该目录，要么改指现有 `src/*.test.ts`。

---

## 13. 待拍板 / 已知风险（执行方遇到即上报）

> **现状标注（2026-09-13）**：5 已解决（ps1 已补）；7 已解决（cq_gears 源已回归本机，
> 见 handover 文档）；8 已解决（`src/index.ts` 15 函数全量落地，装载自检 `index.test.ts`）；
> **6 已解决（E5 `solidFromFaces` / E6 `planarCap` 已落 cq-compat，测试 5/5 通过）**，
> 架构迁移（15 类改写为 cq-compat 编排）已解锁、进行中；其余 1/2/3/4/9/10 维持原状。
> T1/T2 容差门槛已拍板并落地（逐类覆盖，见 `src/testing/compare.ts` 与
> `docs/analysis/2026-09-13-fai-cq-gears-t2-full-rerun.md`）。

1. **cq-compat parity 是硬阻塞（首要风险）**：fai_cq_gears 完成度受 cq-compat 进度约束。当前 cq-compat parity **35.69% / PASS 228**（2026-09-11；PASS-NT 4 / FAIL 1 / BLOCKED 417）；齿轮相关核心 op 已 ported 但须在齿轮精度（T1/T2）下复验。**E1–E4 已落地并合入**（`splineFace` / `helix` / `splitFace` / `twistExtrude`，见 `docs/plans/2026-09-11-cq-compat-gears-extensions-e1-e4.md`），fai_cq_gears 已可解锁对应类；但删 shim 仍受 E5/E6 阻塞（见本表第 6 条）。**建议并行**：cq-compat 补 E5/E6 + 提 gear-relevant op 精度；fai_cq_gears 同步 1:1 翻译。
2. **cadquery 版本漂移**：本机 `cadquery-env` 2.8.0 vs 旧机 2.6.dev0；cq_gears 0.62 在 2.8.0 下先 `import cadquery, cq_gears` 干净通过再生成参考。
3. **齿面 B-spline 走 `loft` 还是 E1 `splineFace`**：**已定案（2026-09-11 实测）**——走 **E1 `cq.splineFace` 的默认 S2 `row-approx-loft`**。理由：cq-compat 的 `loft` op 只吃「pending wire 描述符」或 `wp.shape` 的面外环，**不能**吃外部 3D 行点；`cq.spline` 是 2D 且用 `makeBSplineInterpolation`（= S3 插值），不是 S2 的曲线逼近。E1 内部已实现 S2（`approximatePoints(tol=1e-2)` + `loft`），实测与第 1 版 S2 面积**逐位相同**、对 cq 参考最大距离 2.646e-6 → **直接消费，不要再在 fai_cq_gears 自重写 S2**。
4. **`twistExtrude` / `helix` / `splitFace` 缺口**：见 §4，属 cq-compat 扩展，fai_cq_gears 不自行实现（除 §4 临时 shim）。**状态：2026-09-11 已落地并合入**（连同 E1 `splineFace`）。
5. **`gen-reference.ps1` 缺失**（§2.5-4）：补文件或改 package.json 直调 python。
6. **【新·高】删 shim 还差 2 个 cq-compat 原语（E5/E6）**：把 `spur_gear.ts` 从裸内核迁到 cq-compat 时发现，v1 的装配步骤在 cq-compat **没有对应 op**：
   - **E5 `solidFromFaces`**（sew + makeSolid + fixFaceOrientations）：cq-compat 现有 op 里没有 sew/makeSolid/solidify（`shell` 是抽壳，不是缝合）。v1 `spur_gear.ts:126-132` 依赖 `kernel.sew/makeSolid/fixFaceOrientations`。
   - **E6 平面盖面（boundary edges at z → closed wire → face）**：v1 `spur_gear.ts:51-76`（`planarCapAtZ`）从既有面 `getSubShapes(f,'edge')` 收边界边 → `connectEdgesToWires` → `healWire` → `makeFace`。cq-compat 的 `wire` op 只吃**绘图描述符**（`pendingEdges`），**无法**消费外部内核边。
   - 两者都是 occt-wasm 原生方法的薄封装（`sew`/`makeSolid`/`fixFaceOrientations`/`getSubShapes`/`makeWire`/`healWire`/`makeFace` 均在 `index.d.ts`），可仿 E1–E4 模式落进 cq-compat。**API 形态待拍板**（建议 `solidFromFaces(wp, faces[], opts?)` + `capFacesAt`/`boundaryFace(wp, faces[], plane, tol)`）。
7. **【新·高】cq_gears Python 源在本机不存在**：`C:\git\CADQ\` 只有 `cadquery` 与 `mini_lathe`，`FAI_CQ_GEARS_SRC` 未设；`cadquery-env` 里也没装 `cq_gears`（`site-packages` 无 gear 目录）。⇒ **P2–P5（Ring/Bevel/Rack/Worm/Pairs 等 14 类）无法在本机逐字对照 Python 源翻译**。可用的替代：(a) 拿回 cq_gears 源；(b) 仅靠已入库的 `fixtures/reference/*.step` 做 T2 反推（不足以 1:1 复刻参数语义）。**SpurGear 不受影响**（v1 `spur_gear.ts` 已含映射与注释）。
8. **【新·中】`src/index.ts` 只应先覆盖已实现的类**：15 函数中目前只有 SpurGear 有构造器；其余在 P2–P5 落地前应返回显式错误（不静默占位），避免 `registerLib` 装载后调用得到假结果。
9. **mesh 不支持**：齿轮库 brep-only。
10. **参数域极端值挂死**：靠 §9.3 子进程超时隔离。
