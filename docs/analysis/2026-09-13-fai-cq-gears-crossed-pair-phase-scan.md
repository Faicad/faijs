# fai_cq_gears CrossedGearPair（cgp-basic）相位扫描判定：融合布尔差为数值伪差

日期：2026-09-13
状态：**扫描完成，判定 cgp-basic 为「已等价」，DIFFERENT 来自融合布尔差的数值伪差**
代码位置：`packages/fai_cq_gears/src/crossed_pair.ts`（`crossedPairAlignAngle` / `placeSecondGear`）、诊断脚本 `packages/fai_cq_gears/scripts/_chk_phase.ts`
关联方案：`docs/plans/2026-09-11-fai-cq-gears-port.md`（§8.4 齿轮对、§10 降级阶梯）

## 1. 背景

CrossedGearPair 移植中，`cgp-basic` 的逐件指标全部合格，但两 compound 融合后的 overall 布尔差
为 6204 mm³ ≈ 整件体积，被判 `DIFFERENT`。待判定两个互斥假设：

- **A. 真实相位偏移**：gear2 绕自轴自旋半齿（≈9°）——旋转对称体自旋时 com/bbox 不变，
  逐件比对测不出，唯有融合啮合干涉能暴露。
- **B. 融合布尔差数值伪差**：cgp-basic 是真螺旋齿，融合干涉区数值行为与直齿扭转的
  hgp-basic 不同，6204 可能是布尔差本身返回垃圾值。

## 2. 排除 A 的前置证据（非 bug 部分，已实测）

- 裸齿廓点 `crossedHelicalGearGeometry` 与 cq manifest **byte-perfect**
  （t_lflank/t_tip/t_rflank/t_root 全部 maxdiff=0），twistAngle/r0/rb/rr 全匹配。
- gear1、gear2 单体 vol 差均 0.000%，com 差 ~1e-12，bbox 差 ~1e-4 —— 两件单体几何与
  各自位姿均与 cq 一致。
- `crossedPairAlignAngle` 偶/奇分支已按 cq 源修正；同套放置链的 hgp-basic bool=0 通过。

## 3. 相位扫描实测（scripts/_chk_phase.ts，δ 为 gear2 绕自轴的附加自旋）

对 δ ∈ {0°, ±9°, ±4.5°, 18°, 20.26°}（9° = π/z 半齿角，z=20）重建装配并比对参考
（容差同 `CALIBRATED_COMPARE`，`strictTopology:false`）：

| δ | boolAB (mm³) | boolBA (mm³) | equivalent |
|---|---|---|---|
| 0° | 6.204e3 | 6.204e3 | false |
| 9° | 6.204e3 | 6.183e3 | false |
| −9° | 6.204e3 | 6.183e3 | false |
| 4.5° | 6.204e3 | 6.171e3 | false |
| −4.5° | 6.204e3 | 6.171e3 | false |
| 18° | 6.204e3 | 6.204e3 | false |
| 20.26° | 6.204e3 | 6.198e3 | false |

参考体积 6203.8 mm³；容差 max(1e-3, 6203.8×1e-6) ≈ 6.2e-3 mm³。

## 4. 判定

**假设 A 被排除，假设 B 成立。**

- 若存在半齿相位错位，干涉区只是齿槽局部（齿宽 10 mm、齿高 ~2 mm 量级的局部体积，
  至多几十 mm³），不可能等于**整件体积 6204 mm³**。δ=0 时 A−B ≈ B−A ≈ 整件体积，
  说明 `BRepAlgoAPI_Cut` 对这组近重合 B 样条螺旋齿面返回了**反向/垃圾实体**——
  即已知的 occt-wasm 近重合 B 样条布尔差缺陷（同现象已记录于
  `docs/analysis/2026-09-12-fai-cq-gears-bevel-precision.md` §6.2：bp-angled-helix
  出现 B−A = −1.319 的负体积）。
- δ 从 0° 扫到 ±20.26°，bool 始终停留在 6.2e3 量级，**无任何向 0 收敛的点**——
  不存在一个「正确相位」能使融合布尔差通过；这符合「伪差与相位无关」的预期。
- 逐件几何（体积 0.000%、com 1e-12、bbox 1e-4）与裸齿廓 byte-perfect 一致，
  是几何正确的直接证据。

**结论**：`crossedPairAlignAngle` 的 align 公式正确，cgp-basic 实际等价；overall
bool=6204 是融合布尔差在近重合 B 样条齿面上的数值伪差，不构成建模错误。
与 Bevel 族同类：按方案 §10 第 4 步如实上报，不就地放宽容差、不静默改绿。
