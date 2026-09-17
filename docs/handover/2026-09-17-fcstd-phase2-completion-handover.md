# FCStd → faijs 移植第二阶段：完成情况交接（2026-09-17）

> 来源：用户问答「简要汇报整个任务的完成情况，所有 freecad 的 fcstd 文件是否都能正确转为目标格式？」——按原话保存为交接文档。

## 总体汇报

第二阶段计划（M7–M13，加上计划外 M10c）已全部完成，共 9 个提交（`a6b2def` → `2aaa964`），fcstd 单测 13 文件 / 102 用例全绿，e2e 三样本 golden 全绿。

### 各里程碑完成情况

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M7 | 管线修复（codegen 空参数、`requiresBrep: true`）、e2e golden、scan 统计修正 | ✅ |
| M8 | Placement 坐标系（四元数→欧拉 THREE oracle 标定）、变换链策略 | ✅ |
| M9 | Pad/Pocket Type 语义全分支显式化（UpToFace/UpToLast/TwoLengths 不再静默降级） | ✅ |
| M10 | Body.Group 主序、多 Body 拆分、容器加载缺口定位 | ✅ |
| M11 | ExpressionEngine 常量绑定接入、非常量显式烘焙、G7/G9 资产记账 | ✅ |
| M12 | T1 标定（125 草图分布依据）、4 个 L1 定位、V5/V6 可重跑脚本 | ✅ |
| M13 | Compound/Sphere 白名单扩展、外部几何解锁（Drilling_1 L0=13）、Offset2D 探针判定不可行 | ✅ |
| M10c | 多文件容器跨文件 import 闭环（test_geomop 7 Body 真实样本端到端出 STEP） | ✅ |

## 核心问题的如实回答：不是所有 FCStd 都能"正确转换"

按口径分三层：

1. **转换不崩溃、产出容器**：全部 56 个样本都能走完转换流程（failures=0）——但这不等于几何正确。
2. **几何级保真（翻译为可执行 faijs 语句）**：非 Python 对象口径下可覆盖约 **66.3%**（562/848）。真实三样本 e2e 的 translated 占比也不高（如 PadTest 4/13）。
3. **不可转换的主力**（均有显式 reason，非静默丢失）：
   - **Draft/Python 系对象**（Part2DObjectPython 等，占全量 53.9%）——几何存在 Python 代理里，XML 不可读（Offset2D 的 22 处即因此判定不可行）
   - **Fem::Constraint\*、TechDraw** 等非建模对象——本来就不该转
   - **L1/L2 草图**——4 个 L1 已定位归因（InternalAlignment×8、3 个错解），InternalAlignment 不升级 P0
   - UpToFace/UpToLast 等已显式烘焙——V6 体积对比因此 FAIL（377% 差异，是真实覆盖率结论而非脚本缺陷）

## 结论

**转换管线本身健壮、零静默丢失（每处降级都有 reason 和资产留痕），但"全量正确转换"尚未达到——当前非 Python 可覆盖口径约 66%，瓶颈在 Draft/Python 系对象与高级草图约束。**

## 留给用户的事项

- **M12.5（V4 人工抽样）**：需 FreeCAD 实机打开 ≥3 个样本人工核对，无法自动化，未执行。
- 若要提升保真率，下一批收益最大的是 `.brp` 边提取 + 2D 偏移重建（可解 Offset2D 22 处），属新能力立项。

## 相关材料

- 计划：`docs/plans/2026-09-17-fcstd-port-phase2-plan.md`
- 决策记录（.agents/notes/）：`2026-09-17-fcstd-m8-placement-strategy.md`、`…-m9-pad-pocket-types.md`、`…-m10-body-split.md`、`…-m11-expressions-assets.md`、`…-m12-fidelity-calibration.md`、`…-m13-coverage-wave1.md`、`…-m13w-offset2d-infeasible.md`、`…-m133-external-geo.md`、`…-m10c-multifile-closure.md`
- 可重跑脚本（packages/core/scripts/）：`scan-fcstd-samples.ts`、`validate-sketch-solve.ts`、`fcstd-to-fai-zip.ts`、`locate-l1-sketches.ts`、`calibrate-t1.ts`、`verify-geometry.ts`、`coverage-report.ts`、`probe-m13-types.ts`、`probe-offset2d-feasibility.ts`
- 环境：Node 用 `C:\Users\ylt\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`（系统 nodejs v12 太旧）；语料根 `D:/Faicad/FreeCAD`（56 个 .FCStd），可用 env `FAIJS_FCSTD_CORPUS` 覆盖
