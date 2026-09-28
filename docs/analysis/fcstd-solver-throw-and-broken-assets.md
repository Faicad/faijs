# FCStd `solver-throw` 余波与 `shape-asset-broken` 判定（2026-09-28）

状态：已判定。来源：`docs/plans/2026-09-28-fcstd-v3-next-dev-plan.md` §4 P4 / P2，后续批次复核。

## solver-throw（P4）

- `0ad3d90b` 后**不存在真抛错路径**：对报表中以 solver-throw 为唯一 reason 的全部 49 个文件逐个用当前引擎重转，**45 个翻 ok**；其余 3 个（`Architectural Parts/Windows/Glass-skin/Glass skin 6 …`，去重后 3 个唯一路径）的真卡点是 `external-geometry-unresolved`（退化 polyline），与 solver 无关。
- 共病文件（blocked 274）的真因是并存的其它 reason（baked-upstream / `*-missing-*` 族），随上游类释放，见 [fcstd-baked-upstream.md](fcstd-baked-upstream.md)。
- 结论：solver-throw 不再是独立 gap 类，不立项修复。

## shape-asset-broken（E4）

- 13 个以该原因为唯一 reason 的文件（去重后 12 个可重转路径）全部复核：**0 个可修复**。
- 抽样解剖（FCBL_table_parametric 的 `Mirrored.Shape.brp`、Microswitch_SPDT_Vertical 的 `PartShape37.brp`、cherry-mx-basic、Refrigerator）均为 **0 字节 `.brp` 成员**——FreeCAD 保存时内容即丢失，非转换器缺陷。
- 结论：源数据真实损坏，E4 契约（`convert.ts`：missing 或 zero-byte 成员 → 显式 `shape-asset-broken` gap）行为正确。按 D8 不伪造几何，保留显式 reason，属于**已知限制**，不计入「可清零 gap」。

## 口径

- 两类均已从可修复清单移除；报表 `singleFix` 中出现的 freed 数字（165 / 100）是历史累计交叉释放的体现，后续追踪以 `byReasonKey` 残余计数为准。
- 若未来发现非 0 字节但解析失败的 .brp，属新缺陷类别，单独立项。

## compound-missing-members 复核（同日追加）

- 报表 28 个 gap 文件用当前引擎逐个重转：**25 个已翻 ok**（既有空 Links shape-asset 兜底 + P1 依赖链修复的连带释放）。
- 残余 2 个真 gap（`Doors_windows.FCStd`、`MK8.FCStd`）的真卡点是并存原因：`shape-asset-broken`（0 字节 Prop 资产，见上）、`extrusion-zero-length`、`solver-throw: OOM`——均不属于本类，随对应类处理。
- 结论：compound-missing-members 无需新代码修复，移出可修复清单。
