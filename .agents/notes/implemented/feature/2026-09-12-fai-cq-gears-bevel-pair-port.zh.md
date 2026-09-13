# Agent Note: fai_cq_gears 移植 BevelGearPair（装配定位链 + 用 cq 新建参考用例）

Status: implemented

[English](2026-09-12-fai-cq-gears-bevel-pair-port.md) | 中文

## Problem

`fai_cq_gears` 已移植全部九个单体齿类，其中 `BevelGear` 就在同一天完成。移植方案 §8.4 剩下的形状类只有**齿轮对**：`BevelGearPair` 把两个锥齿轮单体装配成一对啮合齿轮，小轮必须绕两轴交点旋转。它不只是加一层包装，有两件事让它比单体麻烦：

- **上游没有参考数据。** cq_gears 自带回归用例只覆盖单体类，所以移植方案 §9.4 要求为对类**新建**参考用例——意味着要给参考生成器加一条「能识别齿轮对、并记录逐件真值」的路径。
- **定位链不是自明的。** `BevelGearPair.assemble()` 用 `*=` 复合了四个 `cq.Location`，而 CadQuery `Location` 在**复合顺序**与 `(t, ax, angle)` 重载**含义**两件事上都必须先实测确定，不能凭记忆。

## Decision

- **新增模块 `src/pairs.ts`。** `bevelPairConeAngles()` 把轴交角分配给两件（`delta_gear = atan(sin A / (z_pinion/z_gear + cos A))`，小轮取倒数式）；`buildBevelGearPair()` 复用既有的 `buildBevelGearSolid` 建两件；`placePinion()` 施加定位链；`bevelPairExportParts()` 每件给一个具名条目交给 `exportStepFromSolids`。
- **定位语义靠实测，不靠假设**（对安装版 CadQuery 探针实测，记录在 `docs/analysis/2026-09-12-fai-cq-gears-bevel-precision.md` §6.4）：`cadquery/occ_impl/geom.py` 的 `Location(t, ax, angle)` 构造的是 `gp_Ax1(Vector(0,0,0), ax)`，所以旋转轴**恒为原点**、`t` 只是平移分量；且 `Location.__mul__` 的复合是**右到左**。因此 `loc = A*B*C` 的施加顺序是 **C → B → A**，即：绕 Z 转 `π/z`（**仅**小轮齿数为偶时）→ 沿 Z 平移 `-pinion.cone_h` → 绕 Y 转过原点转轴交角 → 沿 Z 平移 `+gear.cone_h`。
- **上游的不对称照抄，不「顺手修正」。** `BevelGearPair.__init__` 给 gear 传了 `clearance`、给 pinion **没传**（落回 0.0），并把 pinion 的螺旋角取负。两条都逐字保持。
- **扩展而非另起一套参考生成。** `gen-reference.py` 新增 `--set pairs` 与 `build_pair_case()`：逐件记录**装配位姿下**的 volume/bbox/bbox_min/bbox_max/center，外加 `z`/`cone_h`/`cone_angle_deg`/`gs_r`/`surface_splines`，以及 `assembly` 块。齿面点阵显式跳过并写明原因（`tooth_face_grids_skipped`）——对类没有单一的 `twist_angle`。
- **三个新用例**覆盖定位链的三条分支：`bp-basic`（奇齿数小轮 → 无 Z 旋转）、`bp-even-pinion`（偶齿数小轮 → 有 Z 旋转）、`bp-angled-helix`（60° 轴交角 + 20° 螺旋 → 非 90° 轴与 pinion 螺旋取负）。
- **一份映射只有一个家。** `args → 构造 options` 的抽取原先在导出脚本与测试里各写一份，这个重复一天内造成**两次** 2% 体积假报警（测试漏抽 `bore_d`，拿「无轴孔的我们」去比「有轴孔的参考」）。现在只存在于 `src/testing/reference-options.ts`，由 `export-ours.ts` 与两个 bevel 测试套件共用。

## Alternatives considered

- **让对构造器返回单个 fuse 后的/compound 实体。** 否决：参考侧是两个独立产品的 compound（`MANIFOLD_SOLID_BREP` 计数为 2），而 `compareAssemblyFiles` 刻意区分「2 个零件」与「1 个含 2 solid 的 compound」，所以对必须保持两个导出条目。
- **把定位手写成一个 4×4 矩阵。** 否决：`placePinion` 按 Python 相同的顺序组合同样的四个内核操作，代码可以逐行对照 `assemble()` 审阅；手写矩阵最终还是要推导出同一个顺序，没有额外收益。
- **给两件加上 cq 的 `goldenrod`/`lightsteelblue` 颜色。** 实测后否决：`assemble()` 把颜色赋给了 `cq.Assembly`，但 `_build()` 返回的是 `asm.toCompound()`——颜色在这一步已丢失，参考 STEP 里**没有** `COLOUR_RGB`。B 侧不着色才让两侧可比。
- **复用 `merge-bevel-reference.ts` 并入新用例。** 否决：它把类与源目录都写死了。已由通用的 `scripts/merge-reference.ts`（`--from <dir> --class <name|all>`）取代——按 id 合并、保持既有条目顺序、并拷贝 STEP 文件。

## Consequences

- **T1 通过。** 包内测试套件用 `bevelPairOptionsFromArgs` 驱动，跑 `bp-basic`（35 s）与 `bp-angled-helix`（23 s），逐件体积（相对 1e-3）与 bbox（绝对 1e-3）断言通过。导出器实测整体体积：`bp-basic` 相对 8.07e-7、`bp-even-pinion` 7.86e-7、`bp-angled-helix` 5.29e-6。
- **T2 仍报 DIFFERENT，但原因唯一，且如实上报未放宽。** 全精度逐件判据显示：除体积相对项外所有判据都在容差内——结构 2 vs 2、颜色一致、质心差 ≤ 2.02e-5、bbox 差 ≤ 3.61e-4（两者对 `linearTolerance = 1e-3` 有 30 倍余量）；而逐件体积相对差为 1.739e-6 / 1.652e-6 / 1.415e-5 / 2.461e-6，对 `1e-6` 门槛超出 **1.7～14 倍**——`surface_splines = 12` 的用例最差，两个直齿用例只超 1.7 倍，与 `BevelGear` 已确立的「齿面逼近差」根因一致。
- `bp-angled-helix` 另外在**整体布尔差**上不合规（`A−B = 0`、`B−A = −1.319`，容差 `1.814e-3`）。负的差体积说明 `BRepAlgoAPI_Cut` 返回了反向实体——即已知的 occt-wasm 近重合 B 样条布尔差缺陷，不是建模错误：同一份数据里 `A−B` 恰为 0，逐件质心差 2.0e-5。
- 两侧面数不同（如 gear 183 vs 185、angled gear 125 vs 101），被 `strictTopology: false` 排除在判定之外，与既有的 B-spline 曲面标定一致。
- 三个参考 STEP 给仓库增加 6.3 MB（1.90 / 1.94 / 2.48 MB）；参考目录本来就有 118 MB，故沿用「已移植类全量入库参考数据」的既有做法。
- **门槛后续。** `BevelGear` 遗留的体积极容差决策现在也覆盖本类：定在 `1e-5` 时三个直齿件直接通过、`bp-angled-helix` 需要 `2e-5`；维持现在的 `1e-6` 则 Bevel 族九个用例全部记为已知偏差。分析文档两种读数都记了，两处容差都没有改动。
