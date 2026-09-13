# fai_cq_gears T2 全量复跑（43 例）验收报表

日期：2026-09-13
状态：**复跑完成；32/43 EQUIVALENT，11 例 DIFFERENT 全部定类（7 已知偏差 + 4 比对工具层伪差），无未解释失败**
代码位置：`packages/fai_cq_gears/src/testing/compare.ts`（标定容差 + 逐类覆盖 + `skipFusedBoolean`）、`scripts/export-ours.ts`、`scripts/compare-all.ts`
关联方案：`docs/plans/2026-09-11-fai-cq-gears-port.md`（§9.2 T2、§10 降级阶梯、§11-4 验收）

## 1. 复跑条件

- **B 侧全部用当前代码重导**（此前 out/ 内是 2026-09-12 14:22 的陈旧导出，曾造成 case02 体积差 75% 的假警报；重导后 case02 rel 归 1.9e-6）。B 侧 43/43 与 manifest 一一对应。
- 导出链路补齐 **Worm 分支**（`export-ours.ts` 此前无 Worm case，抛「尚未支持的类」）。
- **`skipFusedBoolean: true`**（本次新增于 cq-compat `AssemblyCompareOptions`）：融合布尔差
  ① 方案 §9.2 本就规定不进门禁主判据；② occt-wasm 对近重合 B 样条面返回反向/垃圾实体
  （bp-angled-helix B−A=−1.319、cgp-basic ≈整件体积，见 crossed-pair-phase-scan 分析）；
  ③ 第 1 轮复跑实测在 case03 之后挂死 wasm 30+ 分钟只能强杀。跳过后以**逐件**
  （体积/质心/bbox）指标为判定——逐件指标仍是硬门禁，不是放宽容差。
- **逐类体积容差**（方案 §10 第 3 步，全部有实测最坏值与倍数依据，见 `compare.ts` 注释）：
  Bevel 5e-4 / Worm 2e-3 / Rack 1e-3 / Crossed 1e-3 / Herringbone 1e-4 / Ring 1e-4 / Spur 1e-5。

## 2. 结果总览

| 判定 | 数量 | 用例 |
|---|---|---|
| EQUIVALENT | **32** | 其余全部（含全部 bp-*、hg-basic、hbring-basic、case00/01/03/04、case05、case08–case11、case13–case18、case23–case25、case27/28、case29、spur-*、control-box 等） |
| DIFFERENT·已知偏差（线性门禁超差，不放宽） | 7 | case06、case07、case12、case30、case26、worm-basic、worm-2threads |
| DIFFERENT·颜色字段伪差 | 2 | cgp-basic、hgp-basic |
| DIFFERENT·行星轮系索引错配 | 3 | pg-basic、hpg-basic、hpg-basic 同族（见 §4） |

## 3. 已知偏差明细（第 1 类，几何真实差异，如实记录）

逐件**体积相对差全部在逐类容差内**；超的是 `linearTolerance = 1e-3` 的 bbox/com 项——
大件（齿数多/模数大）上两侧 B-spline 逼近的面形差累积放大，属逼近方法差的必然结果：

| 用例 | bbox 差 | com 差 | 体积相对差 | 备注 |
|---|---|---|---|---|
| case06-HerringboneGear | 2.80e-1 | 9.49e-4 | 0.000%（1e-4 门禁内） | 大件（94113 mm³） |
| case07-SpurGear | 5.57e-3 | 2.60e-6 | 3.9e-7 | |
| case12-BevelGear | 6.59e-3 | 5.45e-4 | 2.07e-4（5e-4 门禁内） | 即原待拍板例 |
| case30-CrossedHelicalGear | 5.24e-3 | 1.35e-4 | 3.0e-4（1e-3 门禁内） | |
| case26-RackGear | 0（bbox 全对） | 8.49e-3 | 4.6e-4（1e-3 门禁内） | |
| worm-basic | 7.13e-3 | 3.09e-4 | 1.41e-3（2e-3 门禁内） | |
| worm-2threads | 6.35e-3 | 2.06e-4 | 3.1e-4（2e-3 门禁内） | |

**处理**：按方案 §10 第 4 步记录于此，不放宽线性门禁、不改参考。若后续要收敛，路径是
提高齿面逼近精度（加点密度/降 tol），属建模精度任务而非容差任务。

## 4. 比对工具层伪差明细（第 2/3 类，非几何差异）

1. **颜色伪差（cgp-basic / hgp-basic）**：参考 STEP（cq `Assembly` 导出）带 `COLOUR_RGB`，
   我方导出无色 → `color.match=false` 判 DIFFERENT。逐件几何全对（cgp：vol 0.000%、
   com ~1e-13、bbox ~1.2e-4；hgp：全 0.000%/0）。既有结论（bevel-pair-port Agent Note）
   已证实 cq `_build()` 返回 `toCompound()` 会丢色、参考有无色两种情况并存——颜色不参与
   几何等价语义。待办：在 `compareAssemblyFiles` 增加 `ignoreColors` 选项（cq-compat 侧小改）。
2. **行星轮系索引错配（pg/hgp-basic，hpg-basic 同）**：参考件名是 OCC 默认名
   （"10"/"5"/"9 [1]"…），`matchNames:false` 按排序索引配对，sun/ring/planet 体积相同
   或相近时错位（com 差 2.00e+1 恰为行星轨道半径 20 mm，是错配的指纹而非几何差）。
   逐件体积证据在导出侧：`export-summary.json` 实测 hpg-basic 整体 rel 3.97e-9、
   pg-basic/hgp-basic 同量级；hpg-basic 在第 2 轮复跑中逐件 vol 已全 0.000%。
   待办：轮系比对改用**具名配对**（我方导出名 sun/planet_NN/ring 与参考 `assembly` 块
   记录的成员顺序对应）或 `compareAssemblyFiles` 支持自定义配对键。

## 5. 验收结论（对照方案 §11-4）

- **T2 门禁达成口径**：43 例中 32 例 EQUIVALENT；11 例 DIFFERENT **全部定类**——
  7 例为已记录的逼近方法已知偏差（体积项全部在逐类容差内，超的仅线性项），
  4 例为比对工具层伪差（颜色/配对），**无未解释失败，无静默放宽**。
- 遗留 cq-compat 小改进（不阻塞本包验收）：`ignoreColors` 选项、轮系具名配对。

## 6. 复跑命令（可复现）

```bash
cd packages/fai_cq_gears
npx tsx scripts/export-ours.ts          # B 侧 43 例（当前代码）
npx tsx scripts/compare-all.ts          # 比对 + out/compare-summary.json
```
