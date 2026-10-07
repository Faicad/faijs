# FCStd `*-baked-upstream` 烘焙轮廓判定（P3，2026-09-28）

状态：已判定。

## 判定结论

**四族 `*-baked-upstream` 不构成独立的「死轮廓」类。** 抽样 + 全量 B3 续跑证实：plan §2 所列 312 个文件的绝大多数是**翻译顺序/依赖断裂的下游症状**，而非 FreeCAD 源里烘焙死的 Shape。前序 P1 修复（依赖解析缺口族 + shape-asset 兜底）落地后，典型样例已全部翻 ok：

| 样例 | 原 reason | 修复后 |
|---|---|---|
| `Electrical Parts/Batteries/battery-AAA.fcstd` | revolution-profile-baked-upstream | ok |
| `Electrical Parts/Endstop/endstop.fcstd` | sweep-profile-baked-upstream | ok |
| `Electronics Parts/Motors/DC motor/FAULHABER_2342L-012CPR.FCStd` | groove/revolution-profile-baked-upstream | ok |

## 机制（为何会报 baked-upstream）

`translateObject` 的 profile 解析（`packages/fcstd/src/feature-translate.ts`）：`Part::Revolution`/`Groove`/`Sweep`/`Loft` 依赖的 Sketch 上游自身被烘焙（无变量）时，特征以 `<op>-profile-baked-upstream:<对象名>` 显式烘焙。codegen 的 Kahn 排序 + cycle-break（B2）保证该对象仍进台账、各自带诚实 reason——所以该 reason 实际编码的是「上游 Sketch 未产出变量」，上游修复即连带释放。

## 修复后残余（B3 全量续跑，2026-09-28）

- `reports/batch-report.json` totals：ok 2024 → **3679**（convertRate 50.39% → 67.2%，累计多轮）。
- `byReasonKey` 中四族原生 key 计数 = 0；残余以 `groove-profile-baked-upstream:SketchNNN` 带后缀形式存在，随 P1/P4 上游类清零而清零，不再单独立项。
- 真正的源数据损坏（`.brp` 成员 0 字节，如 FCBL 的 `Mirrored.Shape.brp`、cherry-mx、Refrigerator）由 E4 契约诚实报 `shape-asset-broken`，**不属于本类**（见 P2 判定，D8：不伪造几何）。

## 后续口径

1. `*-baked-upstream` 不再计入「可清零 gap」的独立类；追踪其**上游** reason（solver-throw / pattern-missing-source / shape-asset-broken 等）。
2. 若未来出现 FreeCAD 源里确为死 Shape（无 Sketch 对象、仅 Part::Feature）的案例，按既有 shape-asset 路径导入冻结几何，不恢复假参数化（D8）。
