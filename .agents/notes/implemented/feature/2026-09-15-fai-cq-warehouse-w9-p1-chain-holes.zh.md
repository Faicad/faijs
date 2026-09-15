# Agent Note: fai_cq_warehouse W9 — P1-a Chain + P1-b 孔系列

Status: implemented

English | [中文](2026-09-15-fai-cq-warehouse-w9-p1-chain-holes.md)

## Problem

W8 收口 P0 移植时显式搁置了两个 P1 项：孔系列函数（上游 `extensions.py:865–1363` monkey-patch 到 Workplane 的 `clearanceHole` / `tapHole` / `threadedHole` / `insertHole` / `pressFitHole` / `fastenerHole` / `pushFastenerLocations`）与 `Chain` 传动装配体（`chain.py`，多链轮滚子链）。此外 W4 为 `BradTeeNut` 留下了临时孔切割器（`recess.ts` 的 `Temp*`），标注待孔系列落地后替换。

## Decision

### 孔系列（`src/holes.ts`，P1-b）

函数式 API——方案红线禁止 monkey-patch，故目标件与孔位均为显式入参（无 Workplane 栈）。七个入口（`clearanceHole` / `tapHole` / `threadedHole` / `insertHole` / `pressFitHole` / `fastenerHole` / `pushFastenerLocations`）共享同一几何核心 `fastenerHoleCutter`：沉头旋转体（轮廓下移 head_offset）∪ 杆部圆柱 ∪ 82° 钻尖圆锥，对齐 `_fastenerHole`（extensions.py:865–1009）。`depth=None` 表示贯穿（用 `bboxDiagonal(part)` 等价上游 `largestDimension()`）。螺纹孔严格对齐上游组合方式：内螺纹 `IsoThread(external=False)` 在切割**之后** union 回零件，而非并入切割器（extensions.py:998–1005）。非法 fit/material key 按上游 ValueError 语义抛错。

`BradTeeNut` 改调 `fastenerHoleCutter`；`recess.ts` 的临时切割器（`TempClearanceHoleCutterParams` / `tempClearanceHoleCutter`）已删除，仅保留仍在用的 `tempCounterSunkCountersinkProfile`（沉头轮廓）。

### Chain（`src/chain.ts`，P1-a）

`chain.py` 的函数式移植：节圆半径（复用 `sprocketPitchRadius`）、入/出角（`_calc_entry_exit_angles` 四分支）、弧/线段交错、滚子定位扫描、逐节装配。`buildChain` 返回 `{parts: {name, solid}[], pitchRadii, chainLength, chainLinks, numRollers, rollerLoc, spktInitialRotation}`；`{name, solid}[]` 的 parts 直接喂多产品 STEP 导出器（产品名 `link0…`），`placeSprocket` 复现 `assemble_chain_transmission` 的链轮摆放（`spktInitialRotation` = 首滚子角 + 180/齿数）。范围：**仅平面链**（`spkt_normal` 必须为 `(0,0,1)`）；支持 2+ 链轮；斜面链不支持、显式抛错。

链板 dog-bone 轮廓用 **8 条精确三点弧**（`arcEdge`），每条弧的中点用**该弧自己的圆心**计算（镜像弧用镜像圆心）——先试过采样折线近似，否决：链板在 fuse 中被静默丢弃，且永远过不了 STEP 比对。关键上游语义：`radiusArc((0, neck), -neck_r)` 的**负**半径 = 凹弧（dog-bone 收腰）；选了凸弧会每块板多 ~6.94 mm²，被下面的 A/B 体积锚当场抓获。

### A/B 真值锚

- 五轮链（32/10/10/10/16 齿，上游 `sprocket_and_chain_tests.py:184`）：滚子数 87 与世界坐标滚子位逐位对齐上游测试真值（1e-6）。
- 16t/16t 传动（上游在 cadquery-env 直跑）：`chain_length = 1107.6348638400789`，87 个滚子；逐件体积内节 510.0012 mm³（z 跨度 4.3812）、外节 279.0664 mm³（z 跨度 7.0479）——35 节全部 1% 以内。上游装配的参考 STEP 保留在 `fixtures/reference/transmission-16t-16t.step`，供后续 STEP 级 parity。

## Alternatives considered

- **monkey-patch Workplane**（上游风格）。否决：移植方案明令禁止；函数式形态让分层门禁有意义。
- **链板轮廓采样折线。** A/B 比对后否决：丢失 STEP parity 所需的精确圆弧段，且 fuse 静默退化。
- **螺纹体并入孔切割器。** 否决：上游是切割后 union；并进切割器会改变所得实体。
- **W8 的 index 导出 Chain/孔系列桩。** W8 时否决，现在以真实面实现。

## Consequences

- `@faicad/fai-cq-warehouse` 现在导出 `buildChain` / `makeLink` / `placeSprocket` 与七个孔系列函数；`Chain` 与孔系列不再是搁置项（W8 note 已同步回改）。
- W4 的临时切割器已删除；`recess.ts` 不再复刻 `_fastenerHole` 几何。
- 斜面链（倾斜 `spkt_normal`、三维链平面）仍未实现并显式抛错；上游完整 `chain_plane` 支持是后续工作。
- 新文件 `holes.ts` / `chain.ts` 通过 `check-lib-layering.mjs`（内核只经 `requireKernel()`，无 `as any`，无直接 occt-wasm）。

## Verification

- `src/holes.test.ts` 8/8（孔径表、ValueError 对齐、贯穿体积 = π r² T、螺纹孔去除量 > 直孔、沉头切割器重于无沉头）；
- `src/chain.test.ts` 9/9（五轮滚子真值 1e-6、两轮闭式链长、参数校验、A/B 体积 1%、逐件 z 跨度对齐上游公式）；
- BradTeeNut 切换后 `src/nut.test.ts` 回归：绿（STEP 等价 fixture 无变化）；
- 包 `tsc --noEmit` 干净（存量 cq-compat 报错除外）、`eslint src` 干净、`check-lib-layering.mjs` OK；
- STEP 冒烟：37 件传动装配导出，产品名 `spkt0/spkt1/link0…link34` 齐全。
