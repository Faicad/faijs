# fai_cq_warehouse 移植开发计划（cq_warehouse → TypeScript）

状态：**已落地**（W1–W8 全部完成；W9 的 P1-a Chain + P1-b 孔系列已于 2026-09-15 落地，斜面链为后续增量） | 日期：2026-09-13 | 上游：`C:\git\CADQ\cq_warehouse` v0.8.0（git HEAD `daa4650`）

> W3 落地时的偏差与容差标定见 `docs/analysis/2026-09-14-cq-warehouse-thread-probe.md`；决策记录见 `.agents/notes/implemented/feature/2026-09-14-fai-cq-warehouse-thread-geometry.md`。
> W3 已知缺口：`end_finishes="chamfer"` 未实现（内核只有等距 chamfer），`buildThread` 显式抛错，且参考用例集内不含 chamfer 用例。
> W4 落地时的偏差与容差标定见 `docs/analysis/2026-09-14-cq-warehouse-nut-washer-probe.md`；决策记录见 `.agents/notes/implemented/feature/2026-09-14-fai-cq-warehouse-nut-washer-geometry.md`。
> W4 已知缺口：`HeatSetNut` 未实现（内核无 `Face.makeNSidedSurface`，`makeNonPlanarFace` 实测把 4 边扭面退化为 3 边面），`heatSetNut()` 显式抛错；`BradTeeNut` 的 `clearanceHole` 走 `src/recess.ts` 的 `Temp*` 临时实现，待 W9·P1-b 替换（§8-W4 去重表）。

---

## 0. 用户原始要求（原话）

> 请参考cq_gears的移植，把C:\git\CADQ目录下的 cq_warehouse也移植到本项目的packages下，保证api和输出step的兼容性。请先调研并写一份详细的开发计划。

拆解成三条硬性目标：

1. **照 cq_gears 的移植范式做**（已落地的 `packages/fai_cq_gears` 是事实标准：参考数据管线 + 逐件 STEP 等价比对 + `Result` 包装 + 参数名逐字沿用 Python）。
2. **落到 `packages/` 下**成为本项目的一个 workspace 包。
3. **API 与输出 STEP 双向兼容**——签名形状对齐上游，STEP 几何与 Python/CadQuery 侧等价。

---

## 1. 结论摘要

- 建议新建 **`packages/fai_cq_warehouse`**（包名 `@faicad/fai-cq-warehouse`），依赖 `@faicad/cq-compat`（dev + peer）与 `@faicad/faijs-core`。
- **分层定位（§4.3）**：`cq-compat` ≈ CadQuery（平台），`fai_cq_warehouse` ≈ cq_warehouse（第三方库）。**平台不为一个第三方库写专属代码**——本移植对 `cq-compat` 与 `core` **零改动**；CadQuery 已有而 cq-compat 未实现的（`polarArray` / `consolidateWires` / `makeRuledSurface` / `makeNSidedSurface` …）是平台的 parity 欠账，本包只提 backlog 并在自己包内临时兜；CadQuery 也没有的（`Workplane.fillet2D` 等）本包自己写，正如上游 `extensions.py` 那样。
- **可移植主体是 5 个几何模块**：`thread` / `fastener` / `bearing` / `sprocket` / `chain`。数量以 §2.7 的**实测清单**为准：**可实例化类 34 个**（P0 范围 33 个——`Chain` 归 P1，见 §3.2）+ **抽象基类 5 个** + **参数表 34 张**（其中 2 张在上游源码零引用，见附录 A）。
  > ⚠️ 本方案初稿写的「6 个基类 + 26 个具体类」**已作废**：实测 `__subclasses__` 与 `__abstractmethods__` 对不上（27 与 26 都不对）。所有验收判据一律引用 §2.7 的清单表，不再引用裸数字。
- **`extensions.py`（4110 行）整体不移植**：5 个几何模块对它的实际依赖只有 **1 个方法**（`Workplane.clearanceHole`，被 `fastener.py:747` BradTeeNut 调用）。其余 98% 是 Workplane/Sketch/Vector/Assembly 的 monkey-patch，依赖 CadQuery 内部私有结构（`self.objects` / `self.ctx` / `self.plane`），在 cq-compat 的 Workplane 上无对应物。
- **`drafting.py`（746 行）不移植**：产出是 SVG 尺寸标注，不在「输出 STEP 兼容」范围，且依赖字体与 SVG 序列化。
- **最大技术风险在螺纹**：`Thread` 用 `Wire.makeHelix` + `Face.makeRuledSurface` + `Shell.makeShell` + `Solid.makeSolid` 构造螺旋面，其中 `makeRuledSurface` / `makeNSidedSurface` / 参数曲线（`parametricCurve`）在当前 cq-compat + occt-wasm 上**尚无封装**，必须先做内核探测（W2）。
- **参考环境已验证可用**：cadquery 2.8.0 + Python 3.13.14 的 venv 里，`PYTHONPATH=C:\git\CADQ\cq_warehouse\src` **免安装即可 import 并生成几何**（实测见 §2.6），A 侧真值管线无需 `pip install`。

---

## 2. 上游盘点（调研事实）

### 2.1 仓库与版本

| 项 | 值 |
|---|---|
| 路径 | `C:\git\CADQ\cq_warehouse` |
| 版本 | 0.8.0（`setup.cfg:3`），Apache-2.0，作者 Gumyr |
| git HEAD | `daa4650`（Merge PR #84） |
| Python | 声明 `>=3.9`；本机实测 3.13.14 可跑 |
| CadQuery | 未声明约束；本机 cadquery 2.8.0（与 cq_gears 移植同一基准） |
| 第三方依赖 | **零**（`install_requires` 为空，无 numpy/pandas） |

### 2.2 模块划分与移植判定

| 文件 | 行数 | 职责 | 移植 | 理由 |
|---|---|---|---|---|
| `fastener.py` | 2369 | Nut/Screw/Washer 家族 + 参数表读取 + recess（十字/六角/梅花/一字/方孔） | **是（P0）** | 核心零件库 |
| `extensions.py` | 4110 | CadQuery 类 monkey-patch（thicken/emboss/text/finger joint/hole 系列/Sketch 扩展） | **否（仅 1 方法）** | 依赖 CQ 私有结构；几何模块只用到 `clearanceHole` |
| `thread.py` | 1003 | `Thread`/`IsoThread`/`AcmeThread`/`MetricTrapezoidalThread`/`PlasticBottleThread` | **是（P0）** | 螺纹是紧固件前置依赖 |
| `drafting.py` | 746 | 尺寸标注 → SVG | **否** | 非 STEP 产出；依赖字体与 SVG |
| `chain.py` | 700 | 链条装配（Assembly + Location 阵列） | **是（P1）** | 依赖 Assembly 能力 |
| `bearing.py` | 616 | 5 类滚动轴承 | **是（P0）** | 2D 轮廓 revolve + 阵列 |
| `sprocket.py` | 397 | 链轮齿形 | **是（P0）** | 纯 2D 轮廓 + extrude，最易 |
| `extensions_doc.py` | 1691 | 文档用绘图脚本 | **否** | 非库代码 |
| `__init__.py` | 1 | 空 | — | — |

### 2.3 模块依赖图（实测）

```
thread.py             （自包含）
fastener.py    ──►    thread.py        (fastener.py:42  IsoThread/is_safe/imperial_str_to_float)
bearing.py     ──►    fastener.py      (bearing.py:43   参数表读取/求值/筛选工具)
chain.py       ──►    sprocket.py      (chain.py:46)
sprocket.py           （自包含）
```

移植顺序必须遵守：**thread → fastener → bearing → sprocket → chain**。

### 2.4 数据资产（34 张 CSV，共 964 行）

分类（**以「是否被上游代码引用」为准**，实测 `grep` 每个 CSV 文件名在 `*.py` 中的出现位置，2026-09-14 复核）：

| 类别 | 张数 | 说明 |
|---|---|---|
| 紧固件几何参数表 | **24** | 34 − 工艺/查算 5 − 轴承 5。构成：Nut 7 + Screw 12 + Washer 3 = 22，再加 2 张**零引用**的 `imperial_set_screw_parameters` / `metric_set_screw_parameters` |
| 轴承表 | **5** | `single_row_*_parameters.csv`，与 5 个 Bearing 类一一对应 |
| 工艺/查算表 | **5** | `clearance_hole_sizes`(86)、`tap_hole_sizes`(100)、`drill_sizes`(107)、`nominal_screw_lengths`(27)、`iso10664def`(17) |
| **合计** | **34** | 共 964 行 |

> ⚠️ 初稿写「紧固件几何参数表 21 张」是错的。
> ⚠️ **重要发现**：`imperial_set_screw_parameters.csv` 与 `metric_set_screw_parameters.csv` 在上游 `*.py` 中**零引用**（`SetScrew` 只读 `setscrew_parameters.csv`）→ 属**死数据**。这两张表 W1 照常生成、照常进 34 表哈希断言（与 W1 验收 2、§10 口径一致），仅标 `referencedByUpstream:false`（`src/data/manifest.ts`）且**不参与 `types()`/`sizes()`/`selectBySize()` 对照**，避免后人误以为漏做。
- **读取路径**：`read_fastener_parameters_from_csv()`（`fastener.py:59`）用 `importlib.resources.open_text(cq_warehouse, f)` + `csv.DictReader` → `dict[Size, dict["type:dim", str]]`；`isolate_fastener_type()`(`:144`) 拆 `type:dim`；`evaluate_parameter_dict()`(`:130`) 把字符串求值成 float。
- **关键陷阱（实测扫描 34 张表）**：表里**大量非数值单元格**——
  - 英制分数：`"1/16"`、`"3/8"`（`socket_head_cap_parameters.csv` 的 `asme_b18.3:k`）；
  - 钻头编号：`"#2"`、`"F"`、`"M"`（`heatset_nut_parameters.csv:material_thickness`）；
  - 规格代号：`T10`/`PH1`（十字槽 `rf`/`k` 列）、`H-THM300`（drill 列）；
  - 型号字符串：`SKT:mass` / `SKT:Designation`（轴承，纯标注）；
  - 占位符：`–`（en dash，如 `single_row_capped_...csv:SKT:Pu`）。
  - 因此 **不能**把整表当 float 解析；必须**按列语义**分派求值器（数值 / 英制分数 / 编号查表 / 原样字符串）。
- Python 侧用 `eval()` + `is_safe()` 白名单（`thread.py:43`）做数值求值。**TS 侧禁止运行时 eval**：改由生成期脚本求值，产出纯 `number | string` 的 JSON（见 §5.3）。

### 2.5 测试资产（`tests/`，9 文件，均为 `unittest`，无 pytest）

| 文件 | 行数 | 能否当真值生成器 |
|---|---|---|
| `sprocket_and_chain_tests.py` | 411 | ★ 已有 Area/Volume 硬编码真值（`:138` flat sprocket Area=16935.406/Volume=15851.936；`:358` make_link；`:184` five-sprocket chain）——**加 STEP 导出即可当 A 侧** |
| `fastener_tests.py` | 441 | 部分（`box.Volume() < 999.99` 型弱断言，`:141/:251/:391`） |
| `bearing_tests.py` | 127 | 部分（`:123` 同类弱断言） |
| `thread_tests.py` | 254 | 弱（只测解析/sizes，无体积） |
| `extensions_tests.py`(959) / `sketch_tests.py`(348) / `extensions_finger_joint_tests.py`(156) / `drafting_tests.py`(339) / `sub-class_tests.py`(110) | — | 不在移植范围 |

**结论：上游没有现成的「STEP + 体积/bbox」真值集，必须自建**（照 cq_gears 的 `gen-reference.py` 做法）。

### 2.6 环境实测（本次调研跑通，作为可行性证据）

```
PYTHONPATH=C:\git\CADQ\cq_warehouse\src  C:\Users\ylt\cadquery-env\Scripts\python.exe
py 3.13.14 / cadquery 2.8.0 / cq_warehouse 未安装（免安装 import 成功）
```

| 用例 | 构造 | Volume | 类型 | 耗时 |
|---|---|---|---|---|
| HexNut | `HexNut(size='M6-1', fastener_type='iso4032')` | 302.297726（bbox 11.545×10.0×5.2） | Solid | 0.52 s |
| IsoThread | `IsoThread(major_diameter=6, pitch=1, length=10)` | 38.016317 | Solid | 0.55 s |
| Bearing | `SingleRowDeepGrooveBallBearing(size='M8-22-7', bearing_type='SKT')` | 1644.7491 | **Compound** | 1.87 s |
| Sprocket | `Sprocket(num_teeth=16, chain_pitch=12.7, roller_diameter=7.9375)` | 6552.2962 | Solid | 3.44 s |

单件亚秒~3 秒，A 侧参考集可以做到几十个用例。

### 2.7 上游公共 API 面（签名实测）

```
Nut(size: str, fastener_type: str, hand='right', simple=True)
Screw(size: str, length: float, fastener_type: str, hand='right', simple=True, socket_clearance=6)
Bearing(size: str, bearing_type: str)
Sprocket(num_teeth, chain_pitch=12.7, roller_diameter=7.9375, clearance=0.0,
         thickness=2.1336, bolt_circle_diameter=0.0, num_mount_bolts=0,
         mount_bolt_diameter=0.0, bore_diameter=0.0)
Chain(spkt_teeth, spkt_locations, positive_chain_wrap, chain_pitch=12.7,
      roller_diameter=7.9375, roller_length=2.38125, link_plate_thickness=1.0,
      spkt_normal=(0,0,1))
IsoThread(major_diameter, pitch, length, external=True, hand='right',
          end_finishes=('fade','square'), simple=False)
AcmeThread(size, length, external=True, hand='right', end_finishes=('fade','fade'))
PlasticBottleThread(size, external=True, hand='right', manufacturingCompensation=0.0)
```

#### 类清单（实测 `inspect.getmembers` + `__subclasses__` + `__abstractmethods__`，2026-09-14 复核）

**抽象基类 5 个**（均有非空 `__abstractmethods__`，不可实例化——TS 侧对应 abstract class 或 interface + 工厂分派）：

| 基类 | 位置 | 抽象成员（实测） |
|---|---|---|
| `Nut` | `fastener.py:365` | `countersink_profile` / `fastener_data` / `nut_plan` / `nut_profile` |
| `Screw` | `fastener.py:1241` | `countersink_profile` / `fastener_data` |
| `Washer` | `fastener.py`（ABC, Solid） | `fastener_data` / `washer_profile` |
| `Bearing` | `bearing.py`（ABC, Compound） | `bearing_data` / `countersink_profile` / `inner_race_section` / `outer_race_section` / `race_center_radius` / `roller` / `roller_diameter` |
| `TrapezoidalThread` | `thread.py:523` | `parse_size` / `thread_angle` |

> 注：`Thread`（`thread.py:59`）**不是** ABC——它无 `__abstractmethods__` 且继承自 `Solid`，是可实例化的**通用螺纹类**；`IsoThread` / `PlasticBottleThread` 直接继承 `Solid` 而**不继承** `Thread`（实测 `__bases__`）。因此它计入具体类，不算基类。这是 §3.1 与 W3 的统一口径。

**可实例化类 34 个**（下表；此表是所有验收计数的**唯一分母**）：

| 组 | 数量 | 类名 |
|---|---|---|
| Thread | **5** | `Thread`（通用）、`IsoThread`、`AcmeThread`、`MetricTrapezoidalThread`、`PlasticBottleThread` |
| Nut | **7** | `DomedCapNut`、`BradTeeNut`、`HeatSetNut`、`HexNut`、`HexNutWithFlange`、`UnchamferedHexagonNut`、`SquareNut` |
| Screw | **12** | `ButtonHeadScrew`、`ButtonHeadWithCollarScrew`、`CheeseHeadScrew`、`CounterSunkScrew`、`HexHeadScrew`、`HexHeadWithFlangeScrew`、`PanHeadScrew`、`PanHeadWithCollarScrew`、`RaisedCheeseHeadScrew`、`RaisedCounterSunkOvalHeadScrew`、`SetScrew`、`SocketHeadCapScrew` |
| Washer | **3** | `PlainWasher`、`ChamferedWasher`、`CheeseHeadWasher` |
| Bearing | **5** | `SingleRowDeepGrooveBallBearing`、`SingleRowCappedDeepGrooveBallBearing`、`SingleRowAngularContactBallBearing`、`SingleRowCylindricalRollerBearing`、`SingleRowTaperedRollerBearing` |
| Sprocket | **1** | `Sprocket`（非 ABC，继承 `Solid`） |
| Chain | **1** | `Chain`（非 ABC，继承 `object`）— **P1，不计入 P0 分母** |

**计数的三种口径（防止再打架）**

| 口径 | 数值 | 用在哪 |
|---|---|---|
| 可实例化类·全量 | **34** | 上游对账、§7.1 `--set full` |
| 可实例化类·P0 范围 | **33** | W8 总验收判据的分母（排除 Chain） |
| 抽象基类 | **5** | 不进验收计数（它们不产出几何） |

---

## 3. 移植范围界定

### 3.1 「兼容」的定义（先立判据，避免后期扯皮）

**API 兼容** = ① 类名/工厂函数名与 Python 侧一一对应；② 参数名**逐字沿用** Python（含 `fastener_type`、`end_finishes`、`manufacturingCompensation` 这类大小写混合名）；③ 默认值一致；④ 返回 `Promise<Result<T>>`（fai_cq_gears 已确立的包装）；⑤ 派生属性以纯函数暴露，命名遵循 §4.2 规则（派生量 `<class>Dimensions()`、类方法转 `nutTypes()`/`nutSizes()`、孔径查询 `clearanceHoleDiameters()`）。

**STEP 兼容** = ① 逐件导出（Compound/Assembly 按上游零件树拆分，**零件顺序必须与上游一致**）；② 体积相对差、bbox/质心线性差落在**实测标定**容差内；③ 拓扑不要求相同（`strictTopology: false`，与 cq_gears 一致）；④ 颜色：`bearing.py` 导入了 Color 但源码未见使用。该项**挂在 W0 探测**（不再悬空）：W0 跑 A 侧时对 Bearing 的 STEP 做一次 grep 判断是否含 `COLOUR_RGB`，结论写进 W0 的分析产出并在 W6 的 manifest 里注明；若确实无颜色实体，则从比对项中移除该项（避免比对的是「两边都没有」这种伪通过）。

### 3.2 P0 必做（本方案主线 W0–W8）

`thread` → `fastener`（Nut 7 + Washer 3 + Screw 12 + 5 种 recess）→ `bearing` 5 → `sprocket` → 数据层 34 表。

P1 **一律排在 W9**，且拆成**两个互相独立**的子项（可各自单独做或单独放弃，初稿把它们捆在「视 W2 探测结果」一个条件上是错的）：

| P1 子项 | 内容 | 真实依赖（初稿写错，已修正） | 做与不做怎么定 |
|---|---|---|---|
| **P1-a · Chain** | `Chain` 类（Assembly + Location 阵列，多产品 STEP） | 依赖 **W7 的 Sprocket**（`Chain` 要吃 Sprocket 齿廓）+ W2 的 `polarArray`/多产品 STEP 能力；**不依赖** W2 的 helix/ruled-surface | W7 结束后，按 W2 探测报告中「多产品 STEP + 装配 Location」两项是否在 green 清单里来定 |
| **P1-b · 孔系列** | `clearanceHole` / `tapHole` / `threadedHole` / `insertHole` / `pressFitHole` / `fastenerHole` / `pushFastenerLocations`，以**函数式 API**（`clearanceHole(wp, ...)`）提供，语义对齐 `extensions.py:865–1363`，**不做 monkey-patch** | 依赖 **W1 的参数表**（`clearance_hole_sizes` / `tap_hole_sizes` / `drill_sizes` / `nominal_screw_lengths`）+ **W3 的螺纹**（`threadedHole` 要用 IsoThread）；**与 W2 的 helix/ruled-surface 探测无关** | W3 结束后决定 |

**理由**：这两项的依赖链完全不同——Chain 卡在「装配与多产品导出」，孔系列卡在「参数表与螺纹」；用同一个「W2 内核探测」作条件，等于把 Chain 的排期挂到跟它无关的能力上（这正是初稿把 chain 同时写进 §3.3/W9 与 §8/W7 的根因）。

**P1 不计入 P0 验收分母**（§2.7 已把分母定为 33）。W9 若只做其中一项，另一项保持未实现状态即可，不影响 W8 收口。

### 3.4 明确不移植（写入方案以免反复）

| 主题 | 位置 | 不移植理由 |
|---|---|---|
| Workplane/Sketch/Vector/Vertex/Assembly/Location 的 monkey-patch 扩展 | `extensions.py` 全部 79 个函数 | 依赖 CadQuery 私有状态（`objects`/`ctx`/`plane`），cq-compat Workplane 结构与 CQ 不同；且不属于「零件库」语义 |
| 文本与字体（`textOnPath` / `embossText` / `make2DText` / Sk text） | `extensions.py:674/2204/1986/3763` | 依赖 freetype 与系统字体，occt-wasm 侧无对应能力 |
| 指接盒（`makeFingerJoints` 三处 + 测试） | `extensions.py:1366/1817/3855` | 非零件库；依赖 Face/Wire 拓扑操作链 |
| 曲面投影/浮雕（`projectToShape` / `embossToShape` / `makeNonPlanarFace` / `embossWireToShape`） | `extensions.py:1520/1651/2902/3117` | 依赖 B 样条曲面投影与线投影，内核能力未验证。注意：此处不移植的是 `extensions.py` 的 **Workplane 级封装**（`embossToShape` 等）；§5.5.2 WarehouseKernel 里声明的 `makeNonPlanarFace` 是 **kernel 层原语**（HeatSetNut knurl 用），两者是不同层的同名概念，不矛盾 |
| `drafting.py`（尺寸标注 → SVG） | 全 746 行 | 产出非 STEP；需 SVG 序列化与字体 |
| `extensions_doc.py` | 全 1691 行 | 文档绘图脚本，非库代码 |

---

## 4. 目标包结构与 API 设计

### 4.1 目录

```
packages/fai_cq_warehouse/
  package.json            @faicad/fai-cq-warehouse（照 fai_cq_gears 的 peer/dep 形状）
  tsconfig.json / tsconfig.build.json（build 排除 src/testing）
  vitest.config.ts
  src/
    index.ts              公共入口：工厂函数 + contractVersion + types()/sizes()
    kernel.ts             本包私有 raw 内核访问层（requireKernel + WarehouseKernel 补声明）
                          全包唯一的 getBackends() 调用点（§5.5.2 第 ① 层； CadQuery 没有、
                          parity 也没覆盖的低级构造兜底，属 §4.3 第 ③ 类）
    kernel-conformance.test.ts  两级 probe：方法存在性 + 真调一次的契约 smoke（§5.5.2 第 ③ 层）
    primitives.ts         本包私有建模扩展（helix / ruledSurface / polarArray / consolidateWires
                          / fillet2D / nSidedFace…）—— ≈ 上游 extensions.py 里真正被用到的部分
                          （§4.3 第 ② 类；cq-compat parity 补齐后可整块替换）
    column-semantics.yaml 见 §5.3.1（放在 scripts/ 下，此处仅示意归档位置）
    test-setup.ts         CLI/测试侧 configureBackends（照 packages/sheetmetal/src/test-setup.ts）
    data/                 由 CSV 生成的参数数据（JSON/TS）+ 索引
    params.ts             参数表查询（select_by_size / types / sizes / isolate_fastener_type 等价）
    measure.ts            字符串度量解析（metric/imperial 分数/钻头编号）
    thread.ts             Thread / IsoThread / AcmeThread / MetricTrapezoidalThread / PlasticBottleThread
    nut.ts                7 类螺母 + nut_profile/nut_plan/countersink_profile
    screw.ts              12 类螺钉 + 头型轮廓 + 杆部 + 螺纹装配
    washer.ts             3 类垫圈
    bearing.ts            5 类轴承 + 保持架/滚子/密封盖
    sprocket.ts           链轮 + make_tooth_outline
    chain.ts              Chain（P1）
    recess.ts             cross/hex/hexalobular/slot/square 五种沉孔
    math.ts               共用几何工具（与 fai_cq_gears/src/math.ts 同风格）
    testing/
      reference-options.ts   args→options 抽取的**唯一真源**（cq_gears 红线：禁止就地另写）
      compare.ts             封装 compareAssemblyFiles + 标定容差
  scripts/
    gen-data.ts           CSV → src/data/*（生成期求值，运行期零 eval）
    gen-reference.ps1     A 侧转调壳（照抄 fai_cq_gears）
    gen-reference.py      A 侧真值生成器
    export-ours.ts        B 侧 STEP 导出
    compare-all.ts        全量比对
  fixtures/reference/     manifest.json + *.step
```

### 4.2 API 形状（照 cq_gears：工厂函数 + `Result`）

```ts
// 与 fai_cq_gears 同构：参数名逐字沿用 Python，返回 Promise<Result<…>>
export function makeHexNut(params: {
  size: string
  fastener_type: string
  hand?: 'right' | 'left'
  simple?: boolean
}): Promise<Result<BrepHandle, string>>

// 派生尺寸（对应 Python 属性）：同步纯函数，不进内核
export function hexNutDimensions(params: {...}): { nut_thickness: number; nut_diameter: number }
export function nutTypes(): string[]                 // Nut.types()
export function nutSizes(fastener_type: string): string[]
export function clearanceHoleDiameters(size: string, fit: 'Close'|'Normal'|'Loose'): number[]
```

**命名规则**：工厂函数 `make<ClassName>`；派生量 `<class>Dimensions()`；类方法 `types()`/`sizes()` 转 `nutTypes()`/`nutSizes()`；零件树逐件导出沿用 `*ExportParts`（返回 `{ name, solid }[]`）。

#### 4.2.1 `contractVersion` 的定义（初稿只提了名字，此处补齐）

```ts
/** 本包对外的**行为契约**版本（详见 §4.2.1 表格）。 */
export const contractVersion = 1
```

| 项 | 规定 |
|---|---|
| 值 | 从 `1` 起，**单调递增的整数**（不是 semver，不是小数） |
| 语义 | 标识「**本包 API 形状 + 参数表来源版本 + STEP 输出形态**」这套组合；消费者（UI/editor 宿主）用它判断是否兼容自己的缓存产物 |
| 与上游版本的关系 | **不对齐** `cq_warehouse 0.8.0`。下游关心的兼容对象是本包，不是上游 wheel；上游版本另行记录在 `src/data/manifest.ts` 的 `upstreamGitHead` 里（§5.3 已要求每张表记 sha256/行数/git HEAD） |
| 必须自增的情形 | ① 参数表内容/来源变更（重跑 `gen-data.ts` 后数值变了）；② 工厂函数签名或默认值变更；③ STEP 拆分方式与零件顺序变更；④ 容差默认值变更 |
| 不必自增的情形 | 内部重构、新增可选能力、文档改动、修 bug 但输出不变 |
| 验证 | 一条单测锁定当前值 + 一条 docs 检查：`docs` 里凡是提到该值的引用都要同步（改值必须显式改测试，防止误改） |

### 4.3 分层归属：平台层 vs 第三方库（原「在 cq-compat 里建 warehouse.ts」提议作废）

**正确的类比**（用户指出，本方案采纳）：

| Python 世界 | 本项目 | 性质 |
|---|---|---|
| CadQuery | `@faicad/cq-compat`（+ `@faicad/faijs-core`） | **平台 / 公共能力层** |
| cq_warehouse | `@faicad/fai-cq-warehouse` | **第三方库** |

**推论：平台不得为一个第三方库写专属代码。** 原提议「在 cq-compat 新建 `src/warehouse.ts` 存放本包专有的螺旋面 / 滚花 / 放样原语」，等价于要求 CadQuery 内置 cq_warehouse 的实现——**作废**。否则每移植一个 CadQuery 生态库（下一个可能是 cq_warehouse 之外的任何库），平台都要改一次，这不可能成立。

#### 归属判定树（每需要一项能力就走一遍）

1. **CadQuery 本身有没有这项能力？——有**（不论 cq-compat 是否已实现）→ 它属于 **cq-compat 自己的 parity 欠账**，按 cq-compat 的路线图补。本包是**只读消费者**：不为它改 cq-compat；缺失期内在本包自己目录里临时绕过，并记一条 parity backlog；cq-compat 补齐后换回。
2. **CadQuery 没有**（cq_warehouse 自己发明的）→ **写在本包内**。第三方库在用户态扩展平台是社区标准做法——上游的 `extensions.py` 就是这么干的。
3. **两边都没有的低级（OCP 级）构造** → 写在本包 `src/kernel.ts`，但必须 probe 收敛到**一个文件**。

#### 实测证据：我上一轮列出的「能力缺口」，CadQuery 全都自带

cadquery 2.8.0（`cadquery-env/Lib/site-packages/cadquery`）：

| 能力 | CadQuery 出处 | 归属判定 |
|---|---|---|
| `Face.makeRuledSurface` | `occ_impl/shapes.py:3604` | ① cq-compat parity 欠账 |
| `Face.makeNSidedSurface` | `occ_impl/shapes.py:3500` | ① |
| `Shell.makeSolid` / `makeShell` | `occ_impl/shapes.py:4184` / `:3952` | ① |
| `Wire.makeHelix` | `occ_impl/shapes.py:3063` | ① |
| `Wire.fillet2D` | `occ_impl/shapes.py:3146` | ①（但见下方例外） |
| `Workplane.polarArray` | `cq.py:1436` | ① |
| `Workplane.consolidateWires` | `cq.py:2321` | ① |
| `Workplane.parametricCurve` | `cq.py:1939` | ① |
| `Workplane.toPending` / `polarLine` | `cq.py:4334` / `:1666` | ① |

**全部是第 ① 类** —— 也就是说：这些不是「本移植需要的新发明」，而是 **cq-compat 相对 CadQuery 还差的功能**。它们本就写在 cq-compat 的 parity 路线图里（phase2 计划的 P4「缺失算子补齐」），本包只是又一个消费者，**不构成让本包去改 cq-compat 的理由**。

> 唯一例外恰好印证第 ② 类：`Workplane.fillet2D` 上游是 cq_warehouse 自己在 `fastener.py:208` monkey-patch 出来的（CadQuery 只有 `Wire.fillet2D`，`Workplane` 上没有）——第三方补平台的洞，写在自己包里。

#### 内核怎么拿（上一轮的裁决继续有效）

- 官方通道是 `getBackends()`（`runtime-state.ts:357-369` 注释原文「库函数通过它获取内核与宿主端口」），`Backends.kernel.brep` 由 **host 注入**；未配置即抛错、明确禁止兜底。
- 库**不得**自己 `initOcctWasm()` 建内核（`library-dev-guide.md:245`：faijs manages the kernel, **the host provides it**）。
- 本包在**自己包内** `src/kernel.ts` 声明 `WarehouseKernel extends BrepEngineApi`，`requireKernel()` = `getBackends().kernel.brep as WarehouseKernel`（全包唯一取值点，见 §5.5.2），并配 probe 测试逐个断言方法在活内核上存在（沿用 cq-compat `gears.ts` 的 probe 约定）。
- ⚠️ **已知信息缺口（W2 必须先验证）**：`Backends.kernel.brep` 在 core 类型中是 `unknown | null`，且我们依赖的这批方法**没有声明在 `BrepEngineApi` 里**（实测 `packages/core/src/brep/engine/primitives.ts`（202 行）对 `bsplineSurface` / `makeHelixWire` / `approximatePoints` / `sew` / `thicken` / `makeNonPlanarFace` / `getSurfaceArea` 命中数均为 **0**）。所以这是**运行时契约、靠 probe 兜底，TS 不提供保护**。若 W2 发现连运行时方法都不齐，则由**本包**决定是否向 core 提「把通用原语纳入 `BrepEngineApi`」的议题——那是 core 的公共接口演进，不由第三方库代劳。

#### 本轮结论

**本移植对 cq-compat 零改动，对 core 零改动。** 缺什么就由本包在 `src/kernel.ts` / `src/primitives.ts` 里兜，并向 cq-compat 团队交一条 parity backlog。副产品：这同时解除了「cq-compat 已移交第三方、改动要走第三方流程」对本移植的排期耦合。

---

## 5. 技术路线

### 5.1 分层（依赖方向不可反转）

```
               ┌── L3 Host / test-setup ── configureBackends({kernel:{brep}}) ── 唯一初始化方 ─┐
               │                                      │ 注入                                   │
               ▼                                      ▼                                       │
  ┌─ 平台层 ───────────────────────────────────┐   ┌─ core: Backends.kernel.brep ─┐           │
  │ @faicad/cq-compat  ≈ CadQuery              │   │ occt-wasm（BrepEngineApi）   │           │
  │ Workplane parity 算子（公共能力，不属于本包）│◄──┤ BrepHandle / 几何原语        │           │
  └────────────────────────────────────────────┘   └──────────────────────────────┘           │
        ▲ 只读消费（parity 缺的 → 提 backlog，不改它）          ▲ 只读（getBackends，非 init）  │
        │                                                        │                             │
  ┌─ 第三方库：@faicad/fai-cq-warehouse ≈ cq_warehouse ─────────────────────────────────────┐ │
  │ src/kernel.ts       本包私有 raw 访问（WarehouseKernel + probe）─────────────────────────┘ │
  │ src/primitives.ts   本包私有 extensions（≈ 上游 extensions.py 里真正用到的部分）            │
  │ src/thread|nut|screw|bearing|sprocket|chain.ts   零件语义层                              │
  └────────────────────────────────────────────────────────────────────────────────────────┘
```

三条硬约束：

1. **不动平台**：本移植对 `cq-compat` / `core` **零改动**（§4.3）。缺的 parity 记 backlog，缺的第 ②/③ 类能力写在本包自己目录里。
2. **不建内核**：本包不 `initOcctWasm()`、不持有 kernel 单例，内核由 host 经 `getBackends().kernel.brep` 注入（`library-dev-guide.md:245`）。
3. **不串包**：本包不 import `occt-wasm`（package.json 也不应声明该依赖），不 import `getGearKernel`（那是**另一个第三方库**的东西，不是平台 API）；低层访问统一收敛在 `src/kernel.ts`。

### 5.2 建模范式映射（各模块构造路径，来自 Explore 调研）

| 模块 | 上游范式 | TS 侧落点 |
|---|---|---|
| thread | helix wire → ruled surface → shell → solid；端部 `fade` 用 `parametricCurve` | helix 需按 §5.5.2 第 2 层补声明 + probe 验证（**不能引 `GearKernel`**）；**ruled surface / 参数曲线待补**；`simple=True` 降级为圆柱（先做） |
| fastener | 2D 轮廓 → `revolve` / `extrude`；头型用 `spline`+`radiusArc`；knurl 用 helix + `makeNSidedSurface` | `revolve`/`extrude` 已有；`polarArray`、`consolidateWires`、`fillet2D` 需补；knurl 的 n-sided 面待补 |
| bearing | 2D 轮廓 → `revolve`（内外圈）+ `polarArray`（滚子）+ `Sketch().rect().fillet()`（保持架） | `revolve` 已有；滚子阵列可用 `rotate`+`copy` 合成；**Sketch 路径用等价 2D 轮廓 + fillet2D 替代** |
| sprocket | 齿廓点集 → `polarArray` → `extrude` → `chamfer` → `cutThruAll` | 全部可落（`chamfer` 已有），**最易，建议当 W2 的能力验证件** |
| chain | 板 + 滚子 → `extrude` → `Assembly` + `Location` 阵列 | `Assembly` 用 cq-compat `assembly.ts`；多产品 STEP 用 `exportStepFromSolids` |

### 5.3 数据层：生成期求值，运行期零 eval

`scripts/gen-data.ts` 读上游 CSV 目录（经环境变量 `FAI_CQ_UPSTREAM` 指定，默认 `C:\git\CADQ\cq_warehouse\src\cq_warehouse`——与 `FAI_CQ_PYTHON` 同一机制，照 fai_cq_gears 先例），按列语义分派：

1. **数值列** → `number`（含 `eval` 等价的受限求值器：仅 `0-9 . + - * / ( )` 与空格，白名单与 `thread.py:43 is_safe` 对齐；越界即**报错退出**，不静默回退）。
2. **英制分数**（`1/4`、`3/8`）→ `number`（`imperial_str_to_float` 等价）。
3. **钻头编号**（`#2`/`F`）→ 保留字符串，运行期查 `drill_sizes`。
4. **规格代号 / 型号 / 占位符** → 原样字符串。
5. 产出 `src/data/*.json` + `manifest`（记录每个源 CSV 的 sha256、行数、源 git HEAD、`referencedByUpstream` 标记），并生成一条单测断言「数据哈希 == 期望」，**上游数据变动必须显式更新**。

#### 5.3.1 列语义分派表（上面 5 条规则的落地载体——**这是数据层最难的部分，不能只停留在原则**）

上面第 1–4 条规则本身不够，真正的工作量在于回答「**34 张表 × 每一列属于哪条规则**」。因此它是**一个独立的、有归属的交付物**：

| 项 | 内容 |
|---|---|
| 落点 | `scripts/column-semantics.yaml`——`(csv 文件名, 列名) → 求值器 id` 的显式映射表，人工写、人工评审 |
| 单一真源 | 该文件是列语义的**唯一真源**：`gen-data.ts` 只读它，**禁止**在 TS 里写「按文件名猜」「按后缀猜」的启发式；未命中的列一律**报错退出**，不静默按 float 处理 |
| 维护者 | W1 阶段一次性建立；新增 CSV 或上游加列时同步更新（PR 里能看见 diff） |
| 自洽性验收 | `scripts/check-column-semantics.ts` 反向扫描：CSV 表头里**每一列都必须在 yaml 里有条目**，漏一行即 CI 红；反向也扫（yaml 里引用了不存在的列也红） |
| 测试 | 每个求值器至少 2 条单测（正常值 + 边界/占位符）；特别覆盖用户点名的三处：`heatset_nut_parameters.material_thickness`（钻头编号）、`socket_head_cap_parameters` 的 `rf`/`k`（`T10`/`PH1`）、`single_row_capped_*.SKT:Pu`（`–` 占位符） |

### 5.4 已知红线继承（来自 cq_gears 移植教训）

- args→options 抽取**只有一份真源**（`src/testing/reference-options.ts`），禁止在测试里就地另写映射。
- 容差只定义在 `src/testing/compare.ts`；**禁止就地放宽消 FAIL**，放宽必须先出实测数据 + 分析文档。
- 所有 STEP 比对走 `compareAssemblyFiles`（装配比对），不走 `compareStepFiles`。
- 参考值（A 侧 manifest）**不得为过测试而篡改**；偏差要如实记为已知偏差并写分析文档。
- 未验证的启发式必须回滚为显式抛错，不许「猜一个实现」。

### 5.5 内核获取的正确写法（`Backends.kernel.brep: unknown | null` 的三层收敛）

#### 5.5.1 定性：这是平台的类型债，本移植承担其后果

| 事实 | 出处 |
|---|---|
| `kernel.brep` 声明为 `unknown \| null`，理由「字段类型用宽松结构，避免本模块依赖具体实现」 | `core/src/runtime-state.ts:41,58` |
| 运行时实际对象是 `initOcctWasm()` 的返回值，经 `as unknown as BrepEngineApi` **双重断言**强转 | `core/src/occt-kernel/occtKernel.ts:107` |
| 同一实例的另一条取值通道 `getKernel()` 返回的是**未转换**的 `OcctKernel` | `occtKernel.ts:120` |
| core 自身共 **19 处**消费点，被迫写成 `getBackends().kernel.brep as BrepEngineApi \| null` | `api/*.ts` 18 处 + `cad-runtime/direct-executor.ts:580` |
| `BrepEngineApi` 是 core **公开导出**的类型 | `core/src/index.ts:231` |
| 「结构化内核接口（不 import occt-wasm，只做结构匹配，避免 heavy 依赖）」已有官方模板 | `core/src/brep/handle-bridge.ts:21-26` |

**判断（两面都说清楚）**

1. **调用侧看确实不合理**：对象的实际形态是确定的，却把类型擦成 `unknown`，代价是全仓库 19 处裸 `as` 断言；`as` 在 TS 里**不做任何运行时校验**，所以方法改名、引擎换实现、单纯 Wolfram 拼错都**不会在编译期变红**，只会在运行时炸成 `TypeError: k.makeHelixWire is not a function`。
2. **平台侧这样做有理由**：`Backends` 要能装配**任意** BREP 引擎（不只 occt-wasm），而 `runtime-state.ts` 是零依赖叶子模块；一旦收窄成 `BrepEngineApi`，第三方引擎必须实现 60 个方法的全接口才能装配。
3. **但它是可修的，且不是本移植的活**：已核实 `brep/engine/primitives.ts:13-25` 只依赖 `./types`、`runtime-state.ts:17` 只依赖 `./identity`，两边**无环**，type-only 引入不会成环。稳妥方向是 `Backends<K extends KernelBase>` 泛型或最小公共接口 `KernelBase`，配合已有的能力位 `config.brepCapabilities`（`runtime-state.ts:49-56`）做能力路由。→ **记入 core backlog，本轮不动平台**（§4.3 零改动裁决）。

#### 5.5.2 本包的正确写法：三层收敛（平台零改动的前提下保证正确）

**第 1 层 —— `requireKernel()`：全包唯一的取值点**

```ts
// packages/fai_cq_warehouse/src/kernel.ts
import { getBackends } from '@faicad/faijs-core'
import type { BrepEngineApi } from '@faicad/faijs-core'

/**
 * Get the BREP kernel injected by the host.
 * 与 core 自身消费点同构（`core/src/api/primitives.ts:102` 等 19 处同一模式）。
 * @throws when the kernel is absent — never silently falls back to null or a stub
 *         (aligned with `runtime-state.ts:364-368`).
 */
export function requireKernel(): BrepEngineApi {
  const k = getBackends().kernel.brep as BrepEngineApi | null
  if (!k) throw new Error('[fai-cq-warehouse] BREP kernel unavailable: call configureBackends({ kernel: { brep } }) first')
  return k
}
```

约束：全包**只有这个文件**调 `getBackends()`；其余文件一律 `import { requireKernel }`。这是「一个事实一个家」在内核访问上的落点——将来 §5.5.1 的平台 backlog 若被修复，只需改这 1 行。

**第 2 层 —— `WarehouseKernel extends BrepEngineApi`：只声明本包真正用到的成员**

照官方措辞办（结构性匹配，**不 import `occt-wasm`**）：

| 补声明成员 | 被谁用 | 运行时对象里有吗（`occt-wasm/dist/index.d.ts` 静态核对） |
|---|---|---|
| `revolve` | thread / fastener / bearing | ✅ |
| `loft` | **ruled surface 的退化路径**（§6） | ⚠️ **必须 probe 确认**（见下） |
| `makeHelixWire` | thread 螺旋线 | ✅ |
| `bsplineSurface` | 齿廓/螺纹曲面逼近 | ✅ |
| `approximatePoints` | 端部 fade 参数曲线 | ✅ |
| `getSurfaceArea` | 度量自检 | ✅ |
| `thicken` / `makeNonPlanarFace` | fastener 的 knurl 面 | ✅ |

> ⚠️ **`loft` 必须进 probe 清单**（用户指出，成立）：§6 把 `makeRuledSurface` 缺失时的退化路径定为 `loft(ruled)`，但全文没确认过 `loft` 本身可达。若 `loft` 也不存在，则 W3 的 `simple=False` 就**只剩放弃**一条路，直接影响 W3 的成败判断。因此 W2 的 probe 要先验 `loft`，再据此决定 W3 是否还有第二条路。
> 判定语义：probe 报红 = 该能力**判为不可用**，路线表里依赖它的方案立即作废，**不许「先写着以后再说」**。

> 关键认知：第 2 层是**「我认为应该有」的声明，不是证明**。它只换来编辑器补全，不提供任何正确性保证。

**第 3 层 —— `kernel-conformance.test.ts`：把「我认为」变成「我验过」**

两级断言，**缺一不可**：

1. **存在性**：`expect(typeof Reflect.get(k, name)).toBe('function')`——名字拼错、引擎换实现、内核升级改名，立即变红。
2. **契约 smoke**：每个方法**真调一次**，验返回值形态（句柄非空、`getBoundingBox()` 有 6 个数值字段、`getVolume() > 0` 等）。理由：`typeof` 只证明名字存在，**参数顺序与返回值形态不真调是验不出来的**。

配套 `src/test-setup.ts`（照 `packages/sheetmetal/src/test-setup.ts:12-18`）：`await initOcctWasm()` 后注入，库代码本身不初始化。

**明确禁止**（写入 §10 门禁静态扫描）

| 禁止 | 原因 |
|---|---|
| import `occt-wasm` 或其 `OcctKernel` 类型 | 库不得穿透到 `#![`引擎包（§5.1 约束 3） |
| 在多个文件里各自调 `getBackends()` | 破坏「取值点唯一」，平台 backlog 修复时需改多处 |
| 断言成 `any` | 比 `unknown` 更糟，直接关闭全部检查 |
| 复制/import `GearKernel` | 那是**另一个第三方库**的私有接口，不是平台 API |

---

## 6. 能力缺口清单（W2 探测后定稿）

判定口径（§4.3 归属树）：表最后一列不再写「改哪里补」，而是写**归谁**——① parity 欠账（cq-compat 路线图，本包只记 backlog）② 本包自己写 ③ 本包 `kernel.ts` 兜底。

先列当前状态（基于 `packages/cq-compat/src/workplane.ts` 与 `packages/core/src/brep/engine/primitives.ts` 的 grep 实测）：

| 能力 | 上游调用点 | 平台现状 | 归属与本包做法 |
|---|---|---|---|
| `revolve` | 全模块 | ✅ `BrepEngineApi` 层可达 | ③ 本包 `primitives.revolve()` 包一层（毫米/度口径） |
| helix | `thread.py` ×6 | ✅ 运行时可达（`Wire.makeHelix` 等价） | ③ `primitives.helixWire()` + probe |
| `extrude` / `cut` / `fuse` / `intersect` | 全模块 | ✅ cq-compat Workplane 已有 | 直接用 cq-compat（或本包薄封装） |
| `fillet` / `chamfer` | fastener/sprocket | ✅ `BrepEngineApi` | 直接用 |
| `makeSphere` / `makeCone` | bearing 滚子 | ✅ `BrepEngineApi` | 直接用 |
| `polarArray` | fastener/bearing/sprocket | ❌ cq-compat 无 | ① CadQuery 有（`cq.py:1436`）→ backlog；本包临时 `rotate`+`copy`+`fuseAll` 合成（W2） |
| `consolidateWires` | sprocket/fastener | ❌ 无 | ① 有（`cq.py:2321`）→ backlog；本包临时自实现 wire 归并 |
| `parametricCurve` | `thread.py` fade 端 | ❌ 无 | ① 有（`cq.py:1939`）→ backlog；本包用采样点 + 拟合近似 |
| `makeRuledSurface` | `thread.py` ×4 | ❌ 无 | ① CadQuery 有（`shapes.py:3604`）→ backlog；退化路径依赖 `loft(ruled)`，**而 `loft` 本身必须先经 §5.5.2 的 probe 确认**——若 `loft` 也不可用，则此项**无退化路径**，W3 的 `simple=False` 直接判不可做（W2 探测报告必须给出结论） |
| `makeNSidedSurface` | `fastener.py:885` HeatSetNut | ❌ 无 | ① 有（`shapes.py:3500`）→ backlog；缺失则 knurl 降级（`simple` 路径） |
| `Workplane.fillet2D` | `fastener.py:208`（上游自造） | CadQuery 也无（只有 `Wire.fillet2D`） | ② **本包自己写**（`primitives.fillet2D`） |
| Sketch | `bearing.py` 保持架 | cq-compat 无 Sketch | ① → 本包用等价 2D 轮廓 + `fillet2D` 替代，**不要求平台引入 Sketch** |
| Assembly + 多产品 STEP | `chain.py` | ✅ cq-compat `assembly.ts` + core `exportStepFromSolids` | 直接用（只读消费） |

**W2 交付物**（全部落在本包，不动平台），三件必须与 §5.5.2 同名：

1. `src/kernel.ts`——`requireKernel()`（全包唯一取值点）+ `WarehouseKernel extends BrepEngineApi` 补声明。**不导出任何 `get*Kernel()`**（那是 D1 的老样子）。
2. `src/kernel-conformance.test.ts`——两级 probe（存在性 + 契约 smoke），清单含本节的 `loft`。
3. `src/primitives.ts`（上表第 ②③ 类）+ `src/test-setup.ts`（照 `packages/sheetmetal/src/test-setup.ts`）+ **`docs/analysis/` 一份探测报告**（哪些运行时方法真的存在、哪些只能近似；探测结论直接决定 W3 的路线取舍）。

> ⚠️ 别忘了 §5.5.1 的信息缺口：`WarehouseKernel` 超出的这批方法**不在 core 的 `BrepEngineApi` 类型契约里**（202 行接口，7 项实测 0 命中），是运行时契约，probe 是唯一保护。

---

## 7. 参考数据管线（兼容性验证的骨架）

### 7.1 A 侧（Python/CadQuery）

- 新建 `scripts/gen-reference.py`（照 `fai_cq_gears/scripts/gen-reference.py` 结构）+ `gen-reference.ps1` 转调壳（`FAI_CQ_PYTHON` → `C:\Users\ylt\cadquery-env\Scripts\python.exe`）。
- **免安装导入**：脚本内 `sys.path.insert(0, os.environ.get('FAI_CQ_UPSTREAM', r'C:\git\CADQ\cq_warehouse\src'))`（已实测可用，不必 `pip install -e`，规避沙箱网络风险）。
- 每个用例产出：`<id>.step` + `manifest.json`（`volume` / `bbox` / 质心 / 零件数 / 构造参数 / 环境版本 / 上游 git HEAD）。
- 用例集分档：`--set smoke`（每类 1–2 例，日常回归）与 `--set full`（覆盖 §2.7 清单的 **P0 33 个可实例化类 × 2–3 规格**；Chain 属 P1，在 `--set full` 里需显式 `--include-p1` 才生成）。
- Bearing 是 Compound、Chain 是 Assembly → manifest 记 `parts[]`（逐件 volume/bbox/质心 + 顺序），比对按件配对。

### 7.2 B 侧（TS）

`scripts/export-ours.ts`（照抄 fai_cq_gears 的形状）：读同一份 manifest，用 `makeXxx()` 生成，`exportStepFromSolids` 逐件导出到 `out/`。

### 7.3 比对

`scripts/compare-all.ts` + `src/testing/compare.ts` → `compareAssemblyFiles`。

- **初始容差沿用 cq_gears 的标定值**（`strictTopology:false`、`linearTolerance:1e-3`、`volumeRelativeTolerance:1e-6`、`booleanVolumeTolerance:1e-3`、`skipFusedBoolean:true`），**但必须逐类实测后重新标定**；B 样条/螺旋面类的体积差大概率超 1e-6（cq_gears 的 Bevel 族实测 1.9e-4，需逐类 override + 分析文档）。
- 螺纹/滚子这类**近重合曲面**上整体布尔差不可靠（cq_gears 已验证），判定以**逐件体积 / 质心 / bbox** 为准。

#### 7.3.1 逐类容差标定：流程与排期（初稿只写了「必须重新标定」，没说何时做、怎么做）

**每个产生几何的阶段（W3–W7）都包含一个标定子步骤**，不是等 W8 一次性算总账：

1. **跑**：该阶段所有用例走一遍比对，取当前 cq_gears 继承容差，收集**偏差数据**（每项指标的最坏值与分布，不只看 PASS/FAIL）。
2. **出**：`docs/analysis/` 一份该阶段的偏差分析文档（哪些类在哪个指标上超差、超出多少、根因是否已知）。超差必须归因到「方法差异 / 数据错误 / 真 bug」三者之一。
3. **定**：确属上游方法差异导致（不是我方 bug）的，才允许在 `src/testing/compare.ts` 里按**类**加容差 override；override 必须带注释指向分析文档。
4. **锁**：每份 override 都要有一条单测反向守卫——「用旧容差跑会 FAIL」，防止 override 悄悄失效。

**分工与红线**

| 环节 | 谁做 | 红线 |
|---|---|---|
| 偏差数据收集 | 该 W 阶段 | 必须报告最坏值，**只报 PASS/FAIL 不算完成** |
| 分析文档 | 该 W 阶段 | **归因未明不得加 override** |
| override 落地 | `src/testing/compare.ts` | 按类而非全局；带文档链接；配 step-4 反向守卫 |
| 全局默认值调整 | **只在 W8** | 默认值放宽必须单独立 PR 并说明理由，禁止埋在功能 PR 里 |

> 沿用 cq_gears 既有红线：**容差只定义在 `src/testing/compare.ts`，禁止就地放宽消 FAIL**。

---

## 8. 分阶段计划

> 每个 W 阶段结束必须留下：代码 + 测试 + 参考数据 + 一份 PASS/FAIL 计数。未达标不进下一阶段。

### W0 — 环境与 A 侧管线打通（前置）

- 任务：写 `gen-reference.py` 最小版（`--set smoke`，先只跑 HexNut/M6-1 与 Sprocket/16T 两个用例），导出 STEP + volume/bbox 进 manifest；`gen-reference.ps1` 转调壳。
- 验收：A 侧 2/2 产出 STEP；manifest 体积与 §2.6 实测一致（302.297726 / 6552.2962）；Python 侧零 stderr。
- 风险：`importlib.resources.open_text` 在 3.13 的弃用告警（实测仅 warning，不影响）；若未来移除，改 `importlib.resources.files()`。

### W1 — 数据层

- 任务：
  1. `scripts/gen-data.ts` 34 表 → `src/data/*.json` + sha 清单；`params.ts`（`types()`/`sizes()`/`selectBySize()`/`isolateFastenerType()`）；`measure.ts`（metric / imperial 分数 / 钻头编号）。
  2. **建立 §5.3.1 的 `scripts/column-semantics.yaml`**（列语义的唯一真源）+ `scripts/check-column-semantics.ts` 自洽性扫描器。这是本阶段**最大的一项工作量**，不能省略。
  3. **A 侧数值快照**：扩展 `gen-reference.py`，dump 每张表的**逐规格数值**（不只是字符串列表）到 `fixtures/data-snapshot.json`。
- 验收：
  1. 单测断言「TS 侧 `types()`/`sizes()`/`selectBySize()` 返回值与 Python 侧逐字一致」（用 W0 的 A 侧 dump 做对照，覆盖 Nut 7 类、Screw 全部 12 类、Washer 3 类、Bearing 5 类的 sizes 列表）。
  2. 34 表哈希断言通过（零引用的 2 张表按 §2.4 标 `referencedByUpstream:false`）。
  3. **数值逐值比对**（补 R5 的验证缺口——初稿只在字符串层比对，求值出来的数值全程没有任何阶段做快照比对，直到 W4 的 STEP 体积才间接发现）：TS 侧求值结果与 `fixtures/data-snapshot.json` 逐值比对，**相对容差 1e-12**（纯算术，不应有任何误差；有差一定是求值器不等价）。
  4. `check-column-semantics.ts` 全绿：34 表**每一列都有归属**，无遗漏、无悬空引用。
- 红线：**运行期零 eval**；非数值单元格解析失败必须报错而不是置 0。
- **为什么必须在 W1 做 3 而不是留到 W4**：到了 W4 的 STEP 体积比对才暴露数值错误时，误差里混进了几何与逼近误差，定位成本高一个数量级。数据层错误必须在数据层拦住。

### W2 — 本包自己的能力层（`src/kernel.ts` + `src/primitives.ts`）

- 任务：**按 §5.5.2 三层收敛**在本包内建 `src/kernel.ts`（`requireKernel` + `WarehouseKernel`）+ `src/primitives.ts` + `src/test-setup.ts`（对 `cq-compat` / `core` **零改动**）+ §6 第 ②③ 类能力实现 + `docs/analysis/` 探测报告（含给 cq-compat 的 parity backlog 条目清单）。
- 顺序：**先 probe 后开发**——第 3 层的存在性断言必须先绿，再写 `src/primitives.ts`；否则是在「我以为有」的基础上盖楼。
- 验收：`src/kernel-conformance.test.ts` 全绿（两级断言：存在性 + 契约 smoke）；用 `sprocket` 做端到端「内核版 Hello World」（齿廓 wire → polarArray → extrude → chamfer），体积与 A 侧比对。

### W3 — Thread

- 任务：`thread.ts` 五个类。**先做 `simple=True` 全绿**（简化为光杆/光孔），再攻 `simple=False` 的真实螺旋面（fade/square/chamfer/raw 四种端部）。
- 验收：`IsoThread`/`AcmeThread`/`MetricTrapezoidalThread`/`PlasticBottleThread` 各 2–3 规格 STEP 比对通过；`external` 与 `hand='left'` 各 1 例。
- 风险（最高）：`simple=False` 的路线由 W2 探测结论决定，不在此阶段另立第三条路——§6 已规定：`loft` 可用则走 `loft(ruled)` 退化；`loft` 也不可用则 `simple=False` **直接判不可做**。若走退化路线，体积必然有差 → 必须在分析文档里写明并逐类定容差，**不得静默放宽**。

### W4 — Nut（7 类）+ Washer（3 类）

- 任务：`nut.ts` 的 `nut_profile` / `nut_plan` / `countersink_profile` / `make_nut`；`recess.ts` 五种沉孔；`washer.ts`。
- 验收：7 类螺母 × 2 规格（M6-1 iso4032 必过，实测 302.297726）+ 3 类垫圈 STEP 比对通过；`HexNutWithFlange`、`BradTeeNut`（唯一用到 `clearanceHole` 的类）单独一例。
- 说明：`BradTeeNut` 需要 `extensions.clearanceHole`（`fastener.py:747`），在 W4 内以**本地等价实现**（孔 + 沉头锥）替代，代码注释标注上游来源行号。
- **⚠️ 去重约定（对应初稿漏掉的「一份还是两份」问题）**：这份本地实现是**临时占位**，按「一个事实一个家」红线，**不得与 W9 的 P1-b 正式版并存**。

  | 阶段 | 状态 |
  |---|---|
  | W4 | 临时实现落在 `src/recess.ts` 内，命名必须带 `Temp` 前缀并在 JSDoc 标注「P1-b 落地后删除，勿扩散引用」 |
  | W9 · P1-b | 落 `src/holes.ts` 正式版，语义对齐 `extensions.py:865–1363` |
  | W9 收口 | **必须**把 W4 的临时实现替换为正式版调用，删除Temp 实现；该替换是 P1-b 验收项之一 |
  | P1-b 不做时 | 临时实现保留，但仍在 JSDoc 里保留上述标注，并在 W8 的 Agent Note 中记为已知技术债 |

- **落地结果（2026-09-14）**：`src/nut.ts`（7 类；`BradTeeNut` 复用 `src/recess.ts` 的 `Temp*` 沉孔；`HeatSetNut` 显式抛错）、`src/washer.ts`（3 类）+ 三种截面轮廓、`src/primitives.ts` 新增 `cone` / `bboxDiagonal`。参考用例 21 例中 **19 例 STEP 等价**（六角族 10 + BradTeeNut 2 + washer 6 + threaded 1（逐例 override）），**2 例 HeatSetNut 为显式缺口**（测试断言其抛错）。验收项对照：M6-1 iso4032 实测 `302.297726`（= A 侧 `302.2977262431188`）；`HexNutWithFlange` 2 例、`BradTeeNut` 2 例。
- **最重要的一条内核修法**：`revolve` 返回 **shell 非 solid**（`getVolume` 在闭合壳上恰好正确，掩盖问题；`common(shell, blank)` 静默掉到 1/3）。`primitives.revolveProfile` 内补 `makeSolid` + `orientOutward` 后逐位一致。回归锁：`src/kernel-pitfalls.test.ts` 陷阱 8、`src/nut.test.ts` 几何回归锁。
- **W9 落地结果（2026-09-15）**：P1-b `src/holes.ts` 正式版落地（7 入口共享 `fastenerHoleCutter` 核心，语义对齐 extensions.py:865–1363）；BradTeeNut 已切换到正式版并删除 Temp 实现（上表「W9 收口」验收项完成）。P1-a `src/chain.ts` 落地（`buildChain` 函数式形态 + `placeSprocket`，仅平面链；A/B 体积锚 35/35 对齐上游，参考 STEP 在 `fixtures/reference/transmission-16t-16t.step`）。详见 Agent Note 2026-09-15-fai-cq-warehouse-w9-p1-chain-holes。

### W5 — Screw（12 类）

- 任务：头型轮廓（`spline` + `radiusArc` + `polarLine` 组合）、杆部、螺纹段（复用 W3）、`socket_clearance`、`min_hole_depth` 相关派生量。
- 验收：12 类 × 2 规格 STEP 比对；`simple=True/False` 各覆盖；`CounterSunkScrew` 与 `SetScrew` 单列（端部与锥角最易错）。
- **落地结果（2026-09-14）**：`src/screw.ts`（12 类头型钩子逐位复刻 + `Seg` 段系统 + 精确 `filletAt`）、`src/screw.test.ts`（70 测试）。参考用例 **32 例**（每类 ≥2 规格），**28 / 28 STEP 等价**，**4 例为显式缺口**（PH 沉孔的 30° 锥度切割器，抛 `E_RECESS_TAPER_UNSUPPORTED`）。验收项对照：`screw-shcs-m6-iso4762` 实测 `900.6842796`；`simple=false` 覆盖 1 例（杆内 override）；`CounterSunkScrew` 5 例（含 `hand=left` 1 例）、`SetScrew` 2 例单列。
- **两条新的内核/语义坑（本阶段首次定位）**：
  1. **cq 的 `>Z` / `>X` 排序键是 `Edge.Center()` ＝ 圆弧**质心**不是圆心**。RCOS 的 `edges(">Z")` 因此选的是弧（质心 z = 2.386）而不是别的边；拿圆心（z = −9.165）当键会把圆角倒到轴线角点上。
  2. **`fillet2D` 的圆弧邻边不能用直线近似**（`t = r/tan(θ/2)` 只对两直线角精确）。RCOS 的弧-线角上弦近似把切点放到**弧外**（`|p1−Q| = 12.00099`，误差 2.0e-3）；精确解（`|C−Q| = R∓r` + `(C−a)·n = r`）与 A 侧六位全等。
- **容差标定**：螺钉族唯一越界例 `screw-shcs-m6-iso4762-threaded`（螺旋外螺纹）逐例 override（`compare.ts`：`vol 2e-3` / `linear 2e-1`），依据＝网格收敛（弦高 2e-3→8e-4 时体积差 2.133e-4→5.818e-6、质心 1.554e-3→4.203e-5 mm，同比例收敛）+ 两侧自偏差（A 1.221e-2 / B 5.779e-2 mm）+ 光杆对照（1.010e-15 / 5.135e-11 mm）。
- 证据载体：`scripts/kernel-screw-probe.ts`（三段）、`scripts/probe-screw-head-profiles.py`（A 侧边序列）；分析文档 `docs/analysis/2026-09-14-cq-warehouse-screw-probe.md`。
- **留给 W6/W7 的一条告诫**：`primitives.filletCorner2D`（W4，recess 在用）与本包 `screw.filletAt` 是两份圆角实现，本次只修了后者；W6/W7 遇到带圆弧邻边的倒圆角，先查 `filletCorner2D`，需要时把精确解法上收到 `primitives` 并合并两份。

### W6 — Bearing（5 类）

- 任务：内外圈 revolve、滚子阵列（球/圆柱/圆锥）、保持架（`cage`，圆锥轴承才有）、密封盖（`cap`）。
- 验收：5 类 × 2 规格；**零件树顺序与上游 Compound 一致**（比对的硬约束，W0 的 manifest 必须记零件顺序）；M8-22-7/SKT 必过（实测 1644.7491）。

### W7 — Sprocket（不含 Chain）

- 任务：`make_tooth_outline` 齿廓、`clearance`/`bolt_circle_diameter`/`num_mount_bolts`/`bore_diameter` 变体。
- 验收：链轮 3 规格（含带安装孔变体）STEP 比对通过。
- **范围**：`Chain` **不在此阶段**（初稿同时写在 §3.3/W9 与 W7，冲突已解除）——Chain 归 **W9 的 P1-a**。本阶段 PASS/FAIL 计数**只算 Sprocket**，不受 P1 取舍影响。

### W8 — 公共入口、文档与门禁

- 任务：`src/index.ts` 汇总导出 + `contractVersion`（语义见 §4.2.1）；`package.json` 加进 root `workspaces`（**在 `fai_cq_gears` 之后**，满足 `check-workspaces-order.mjs` 的拓扑断言）；Agent Note（`.agents/notes/`）；`npm run doc-sync` 通过。
- **【待定 T1】** 测试接线位置：接入 `@faicad/faijs-tests` 还是留在包内集成测试？**本方案不定**，按下列判据在 W8 启动时决定：

  | 选 `@faicad/faijs-tests` | 选包内集成测试 |
  |---|---|
  | 用例需要跨包协作或多 prescription manager | 用例只依赖本包 + core |
  | 期望跟随 `npm run test --workspaces` 统一跑 | 期望包自洽、`git clone` 单包可测 |

  **默认倾向：包内**（参考 `fai_cq_gears` 的做法——它的参考数据、compare.ts、fixture 都在自己包里，场景高度同质）。决定后在 Agent Note 里记录理由。
- 验收：`npm run typecheck -w @faicad/fai-cq-warehouse` / `lint` / `test` 全绿；根 `npm run build` 不受影响。

### W9（P1，可选）— Chain + Workplane 孔系列

两个子项互相独立，各自按 §3.2 的依赖条件单独决定是否启动，**不捆绑、不与 W2 的 helix/ruled-surface 结论挂钩**。

- **P1-a · Chain**：装配语义 + 多产品 STEP（照 `sprocket_and_chain_tests.py:184` 的两链轮与五链轮两例），按多产品 STEP 逐件比对。依赖 W7 已完成的 `Sprocket`。
- **P1-b · 孔系列**：`clearanceHole` / `tapHole` / `threadedHole` / `insertHole` / `pressFitHole` / `fastenerHole` / `pushFastenerLocations`，函数式形态，语义对齐 `extensions.py:865–1363`。依赖 W1 参数表与 W3 的 `IsoThread`。
- **两项共同的收口要求**（对应下面第 ④ 项的「一个事实一个家」）：P1-b 落地后，**必须替换 W4 中 `BradTeeNut` 的本地临时实现**，不得两份并存。
- 验收：所做子项各自出 PASS/FAIL 计数；未做的子项在 W8 的 Agent Note 里显式标为「未实现（P1）」；若 P1 决策发生在 W8 之后（依赖条件分别是 W3/W7 收口），落地或放弃后**必须回改该 Agent Note** 保持一致。

---

## 9. 风险登记

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | `makeRuledSurface` / `makeNSidedSurface` 内核不支持 | 真实螺纹、HeatSetNut knurl 做不出 | W2 先探测；缺失则 `simple=True` 先落地，真实螺纹另立分析文档 + 逐类容差 |
| R2 | 螺旋面 STEP 体积对不上 | W3/W5 大面积 FAIL | 先测后定容差；以质心/bbox/逐件体积为主判据，布尔差不进主判据 |
| R3 | Compound/Assembly 零件顺序与上游不一致 | 比对假 FAIL | manifest 记顺序；B 侧构造顺序**逐字照抄**上游 |
| R4 | CSV 非数值单元格解析错误（英制分数/钻头编号） | 尺寸系统性偏差 | 生成期严格分派 + 单测对照 Python dump；失败即报错 |
| R5 | 上游 `eval()` 语义与 TS 求值器不等价 | 参数微差 | 生成期求值 + 与 Python 侧逐值比对快照 |
| R6 | 移植面过大（5 模块 P0 33 类） | 周期长 | 严格按 W0→W8 串行，每阶段独立可验收；`sprocket`（最易）放 W2 做能力验证 |
| R7 | 沙箱网络受限导致 `pip install` 失败 | A 侧管线建不起来 | 已验证免安装 `PYTHONPATH` 导入路径，不依赖 pip |
| R8 | 一并移植 `extensions.py` 的诱惑 | 范围失控 | §3.4 已列明不移植清单；新增需求需另立方案 |
| R9 | `getBackends()` 未配置时抛错，CLI/单测场景需先 `configureBackends` | W2 起所有脚本跑不起来 | 照 `packages/sheetmetal/src/test-setup.ts` 建 `test-setup.ts`；`export-ours.ts` 开头显式配置，**不静默兜底** |
| R10 | **内核契约无编译期校验**：`kernel.brep` 是 `unknown`（`runtime-state.ts:58`），本包靠 `as` 断言获得类型；TS 的 `as` 不校验任何东西，方法改名/换引擎/签名漂移都只在运行时炸（19 处 core 现有裸断言已实证这条路行不通） | 运行时 `TypeError: k.xxx is not a function`，且可能到 W3+ 才暴露 | §5.5.2 第 3 层：`kernel-conformance.test.ts` 做**两级**断言（存在性 + 真调一次的契约 smoke）；**W2 必须先绿再开发**；无法验证的能力直接判不可用，不许「先写着以后再说」 |

### 9.1 技术债登记（本轮不改，但必须记录）

| # | 债务 | 位置 | 为何本轮不改 | 迁移路径 |
|---|---|---|---|---|
| D1 | **第三方库代码住进了平台层**：`cq-compat/src/gears.ts`（432 行）是 cq_gears 移植的私有原语层，却放在 CadQuery 等价层里；同时它 `initOcctWasm()` 让库自带内核，违反 `library-dev-guide.md:245` | `packages/cq-compat/src/gears.ts`（尤其 `:99-105`）；下游引用 20+ 处 | cq-compat 已移交第三方；fai_cq_gears 已验收，不宜与本轮耦合 | ① 本移植按 §4.3 走「零改动平台」路线，用实战验证第三方自包含可行；② 出一份错位分析文档；③ 将 `gears.ts` 内容下沉回 `fai_cq_gears/src/kernel.ts`（仅在 cq-compat 留 deprecated 转发一个版本周期）；④ 内核改为 `getBackends()` 注入 |
| D2 | 为了让移植能推进而在 `cq-compat` 复制了一份底层能力（本可以避免的那次） | 本方案初稿 §4.3（已作废，保留作反面教材） | 已被指出并纠正 | 归档教训：先做归属判定树，再决定写哪儿 |
| D3 | **内核类型被擦除**：`Backends.kernel.brep` 声明为 `unknown \| null`（理由是「避免本模块依赖具体实现」，`runtime-state.ts:41`），导致 core 自身 19 处消费点被迫写 `as BrepEngineApi \| null` 裸断言，类型错误全部推迟到运行时 | `core/src/runtime-state.ts:58`；消费点 `core/src/api/*.ts`（18 处）、`core/src/cad-runtime/direct-executor.ts:580` | 属平台自身的类型契约问题，与本移植无关；且本轮已裁决对 core/cq-compat 零改动（§4.3） | 已核实**可修且不成环**：`brep/engine/primitives.ts:13-25` 只依赖 `./types`、`runtime-state.ts:17` 只依赖 `./identity`。方向是 `Backends<K extends KernelBase>` 泛型或最小公共接口 `KernelBase`（**不要**直接收窄成 `BrepEngineApi`——那会强迫第三方引擎实现全部 60 个方法），配合已有能力位 `config.brepCapabilities`（`runtime-state.ts:49-56`）做能力路由。**提给 core backlog，本移植只记录不动手**；修复后本包仅需改 `src/kernel.ts` 一行（§5.5.2 第 1 层） |

---

## 10. 验收门禁

- 每阶段：`vitest run`（包内）+ A/B STEP 全量比对，输出 PASS/FAIL 计数与最坏偏差值。
- **分层静态门禁**（W8 落地，防 §4.3 的错位复发）：包内 `src/` 与 `scripts/` 禁止出现 `from 'occt-wasm'`、`initOcctWasm`、`getGearKernel`——前两条是「不得绕 host 注入」，第三条是「不得消费另一个第三方库的东西」（那不是平台 API）。实现用 eslint `no-restricted-imports` / `no-restricted-syntax`，或照 `scripts/check-ghost-deps.mjs` 写一个 `check-lib-layering.mjs`；命即 CI 红。
- **内核取值点唯一门禁**（对应 §5.5.2，防 R10）：三条同性质的静态规则——① `getBackends()` 只允许出现在 `src/kernel.ts`（其余文件必须经 `requireKernel()`）；② 禁止出现 `as any`；③ 禁止 type-only import `occt-wasm` 的 `OcctKernel`。三条并入上面的 `check-lib-layering.mjs`。
- **内核契约门禁**：`src/kernel-conformance.test.ts`（两级断言）必须常绿；新增 any `WarehouseKernel` 成员时**必须先加进该测试的清单**，CI 才会校验它。
- **零改动平台自检**：本移植 PR 的 diff 不得包含 `packages/cq-compat/**` 与 `packages/core/**`（除新增 backlog 文档外）；若确需改动，必须在 PR 里说明为何该能力属于平台而非本库。
- 全量完成判据：**§2.7 清单里 P0 范围的 33 个可实例化类**（Thread 5 + Nut 7 + Screw 12 + Washer 3 + Bearing 5 + Sprocket 1）全部有 **≥2 个规格**通过 STEP 等价比对；`types()`/`sizes()` 与 Python 逐字一致；数据层 34 表哈希通过（其中 2 张零引用表标 `referencedByUpstream:false`）；W3–W7 每阶段的容差标定文档齐备（§7.3.1）。P1 两项（Chain / 孔系列）不计入此判据，未做的在 Agent Note 里显式标注。
- CI：接入 `npm run test --workspaces`（stderr 零容忍，照 AGENTS.md 约定）；`npm run doc-sync` 通过；改动 cq-compat 后必须 `npm run build -w @faicad/cq-compat` 再跑 B 侧（CLI 走 dist，vitest 走 src alias——cq-compat 既有红线）。

---

## 附录 A：34 张 CSV 的分类

归类方法：把每个 CSV 文件名在 `*.py` 中 grep 出引用点，按**引用的类名**归属（2026-09-14 实测）。下表每一行的文件数与标签数字一致。

| # | 类别 | 张数 | 文件（省略 `_parameters.csv` 后缀） |
|---|---|---|---|
| 1 | 螺母参数 | **7** | `hex_nut`、`hex_nut_with_flange`、`unchamfered_hex_nut`、`square_nut`、`domed_cap_nut`、`brad_tee_nut`、`heatset_nut` |
| 2 | 螺钉头参数 | **12** | `socket_head_cap`、`hex_head`、`hex_head_with_flange`、`button_head`、`button_head_with_collar`、`cheese_head`、`countersunk_head`、`pan_head`、`pan_head_with_collar`、`raised_cheese_head`、`raised_countersunk_oval_head`、`setscrew` |
| 3 | 垫圈参数 | **3** | `plain_washer`、`chamfered_washer`、`cheese_head_washer` |
| 4 | 紧定螺钉（**零引用**） | **2** | `imperial_set_screw`、`metric_set_screw` |
| 5 | 工艺/查算 | **5** | `clearance_hole_sizes`、`tap_hole_sizes`、`drill_sizes`、`nominal_screw_lengths`、`iso10664def` |
| 6 | 轴承参数 | **5** | `single_row_deep_groove_ball_bearing`、`single_row_capped_deep_groove_ball_bearing`、`single_row_angular_contact_ball_bearing`、`single_row_cylindrical_roller_bearing`、`single_row_tapered_roller_bearing` |
| | **合计** | **34** | |

> 初稿错误已修：「紧定螺钉 2」标签下列了 3 个文件（把零引用的 2 张混进已引用的 `setscrew`），「垫圈 1」列了 2 个文件且漏了 `cheese_head_washer`。
> **跨表依赖（实测）**：`UnchamferedHexagonNut` 除自身表外还读 `hex_nut_parameters`；`RaisedCheeseHeadScrew` 除自身表外还读 `cheese_head_parameters`——生成数据时不能按「一类一表」硬编码。
> 精确清单以 `scripts/gen-data.ts` 扫描结果为准，文档不维护第二份（仅此处给出归类与计数）。

## 附录 B：与 fai_cq_gears 的对照（复用点 / 差异）

| 维度 | fai_cq_gears | fai_cq_warehouse（本方案） |
|---|---|---|
| 内核入口 | `getGearKernel()`——住在 **cq-compat** 里（技术债 D1） | 本包自己的 `src/kernel.ts` → `getBackends().kernel.brep`（host 注入），**不动 cq-compat** |
| 返回形态 | `Promise<Result<BrepHandle>>` | 同 |
| 装配/对类 | `*ExportParts` → `{name, solid}[]` | 同（Bearing/Chain 必用） |
| 参考数据 | `gen-reference.py` + manifest 38 条 | 同结构，自建用例集（上游无现成真值） |
| 比对 | `compareAssemblyFiles` + 逐类容差 override | 同，容差**逐类实测后标定** |
| 主要差异 | 单一几何族（齿轮），齿面是 B 样条 | 5 个异构模块 + 34 张参数表 + 螺旋面/装配；**数据层是新增工作量** |
