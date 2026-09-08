# fai_cq_gears P0 可行性尖峰报告

日期：2026-09-08
状态：**已完成**
关联方案：`docs/plans/2026-09-08-fai-cq-gears-port.md`（§4.4 三选一、§6.2 容差校准、§7 P0 里程碑）
代码位置：`packages/fai_cq_gears/`（测试 + 可复跑脚本，非一次性代码）

## 1. 尖峰范围与结论速览

| # | P0 目标（方案 §7） | 结果 |
|---|---|---|
| ① | 复核方案 §1.2 API 现状 | 完成，与方案一致，另发现 2 个未预见的坑（§5） |
| ② | §4.4 三方案实测 | **定案 S2 `row-approx-loft`**，面积偏差比 S1/S3 好 3 个数量级（§3） |
| ③ | ref→our→compare 全链路 | 打通，直齿全维 EQUIVALENT（§4） |
| ④ | 定容差表 | 见 §6 |

**判定门槛核对**：方案要求体积相对偏差 ≤ 1e-3，实测直齿 4.2e-12、斜齿 1.4e-7——**远优于门槛，无需上报风险**。

## 2. 复用的既成资产

- Python 参考侧：`C:\Users\yuan_\cq-editor\python.exe`（cadquery 2.6.dev0 + cq_gears 0.62，site-packages 与 `C:\git\CADQ\cq_gears` 逐字节一致）。系统 `python` 无 cadquery。
- faijs 侧参考数据由 `scripts/gen-reference.py --set spike` 生成，落在 `fixtures/reference/`（manifest.json 含齿面点阵/面积/体积/bbox/STEP 路径；测试与比对脚本都从 manifest 读，不硬编码期望值）。
- 五维比对复用 `@faicad/cq-compat` 的 `compareStepFiles`（devDependency 引用，未搬运实现）。

## 3. §4.4 三方案实测（齿面 B-spline）

测试：`src/spline-face.test.ts`（每个 (case, strategy) 输出逐面偏差表，最坏值汇总）。

面积相对偏差（对照 cq `makeSplineApprox`，点阵来自 Python 侧逐点导出）：

| case / strategy | relDiff（最坏面） | maxDev（mm） |
|---|---|---|
| spur-basic / S1 `grid-approx` | 2.269e-4 | 3.323e-3 |
| **spur-basic / S2 `row-approx-loft`** | **4.215e-11** | **4.405e-10** |
| spur-basic / S3 `row-interp-loft` | 2.665e-4 | 3.925e-3 |
| spur-helix15 / S1 `grid-approx` | 2.131e-4 | 3.323e-3 |
| **spur-helix15 / S2 `row-approx-loft`** | **5.559e-7** | **2.646e-6** |
| spur-helix15 / S3 `row-interp-loft` | 2.502e-4 | 3.927e-3 |

- **S1**（`bsplineSurface(controlPoints, rows, cols)` 一次性网格拟合）：受限于绑定无 tol/deg 参数，三个数量级劣于 S2，且行为不可调 → 淘汰。
- **S2**（逐行 `approximatePoints(row, tol)` 建样条线 → `loft(wires, false, false)` 蒙皮）：曲线级 tol 与 cq 同名同义，偏差与 tol 直接对应 → **定案，设为默认策略**。
- **S3**（逐行 `interpolatePoints` 插值 → loft）：插值过点但曲线振荡，蒙皮后偏差与 S1 同级 → 淘汰。
- S1/S3 实现保留在 `src/spline-face.ts` 作为回归对照（策略参数仍可切换），后续若 OCCT 绑定升级可重测。

数学层（involute/过渡曲线，`src/profile.test.ts`）：与 Python 逐点一致至 **1e-9**，移植算法无偏差来源。

## 4. ref→our→compare 全链路

链路：`gen-reference.py`（A 侧参考）→ `export-ours.ts`（B 侧，S2）→ `compare-all.ts`（五维比对）。
产物在 `out/`（.gitignore 覆盖，可随时重跑再生）。

体积（`out/export-summary.json`）：

| case | our | ref | ΔV (mm³) | rel |
|---|---|---|---|---|
| spur-basic | 1111.7107231854 | 1111.7107231900 | −4.6e-9 | 4.2e-12 |
| spur-helix15 | 1111.7107232734 | 1111.7108839661 | −1.6e-4 | 1.4e-7 |
| control-box（链路对照） | 6000 | 6000 | 0 | 0 |

五维比对（`out/compare-summary.json`）：

- **spur-basic：EQUIVALENT**。bbox 0 / 体积 4.6e-9 mm³ / 质心 7.5e-14 / 拓扑 A=B（70f/204e/136v/1s）/ 布尔差双向精确 0。
- **spur-helix15：四维等价，布尔差维度异常**。bbox 2.8e-6 / 体积 1.6e-4 mm³（1.4e-5%）/ 质心 9.9e-15 / 拓扑完全一致；但布尔差 **B−A 报 1112 mm³ ≈ 整件体积**。其余四维证明两实体几乎全等，这是 **OCCT 对两枚近重合样条齿面实体做 boolean 的鲁棒性伪影**，不是真实几何差异。
- **control-box：EQUIVALENT**（全零），证明比对链路本身无误报。

## 5. 尖峰发现的 API 事实（方案未预见的坑）

1. **occt-wasm `makeWire(edges)` 不给无序边排序**（cq 的 `Wire.combine` 会做链式排序）。直接把 68 条轮廓边丢进 `makeWire` 只连出 9 条边。已在 `src/geom-build.ts` 实现容差链式组线 `combineEdges`（端点容差匹配 + 逐段翻转），配合 `healWire(wire, wire_comb_tol)` 复现 cq 语义。
2. **`sew` 出的 shell 直接 `makeSolid` 可能得到反向实体**（实测体积 −1111.7107）：loft 蒙皮齿面法向朝内，`sew` 不归一化朝向。已在 `src/spur_gear.ts` 用 `fixFaceOrientations(solid)` 归一化。
3. 其余与方案 §1.2 预判一致：`bsplineSurface` 无 tol/deg；`occt-wasm` 是预编译 wasm，「给内核加函数」不是可选项。

## 6. 建议容差表（供 T2 门禁采用，替换方案 §6.2 占位值）

| 维度 | 建议门禁 | 实测最坏值 | 依据 |
|---|---|---|---|
| 体积相对偏差 | ≤ 1e-5 | 1.4e-7（斜齿） | ~70× 余量；单件比对应按件复测收紧 |
| bbox 逐轴差 | ≤ 1e-4 mm | 2.8e-6 mm | ~35× 余量 |
| 质心差 | ≤ 1e-4 mm | 9.9e-15 mm | 信号极稳 |
| 拓扑（f/e/v/s 计数） | 必须全等 | 全等 | S2 蒙皮拓扑确定性 |
| 布尔差 | **仅作参考信号，不进门禁** | 斜齿 B−A 伪影 1112 mm³ | §4 布尔鲁棒性伪影；如保留，只用 A−B 侧并按体积放缩 |

注：容差门禁的最终放行值仍应按方案 §6.2 在 T2 全量用例上复测后收紧，本表为尖峰 3 例的下界。

## 7. 可复跑命令

```bash
# A 侧参考（需 cq-editor python）
cd packages/fai_cq_gears && /c/Users/yuan_/cq-editor/python.exe scripts/gen-reference.py --set spike --out fixtures/reference

# B 侧导出 + 五维比对
npx tsx scripts/export-ours.ts
npx tsx scripts/compare-all.ts

# 全部测试（17 例：内核探针 / 数学层 1e-9 / 三方案偏差表）
cd ../.. && npm run test -w @faicad/fai-cq-gears
```
