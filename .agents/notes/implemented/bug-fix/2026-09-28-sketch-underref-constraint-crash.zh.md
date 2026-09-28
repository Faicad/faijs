# Agent Note: 草图 FCStd → canonical 约束投影的 ref 数守卫

Status: implemented

[English](2026-09-28-sketch-underref-constraint-crash.md) | 中文

## 问题

`fromFreeCadConstraints`（`packages/sketch/src/project.ts`）直接解引用它预期存在的
ref，却没有先检查 refs 数组里到底有几个。FreeCAD 把隐式的坐标轴／原点存成
GeoUndef，于是「绝对坐标」类约束只带**一个** ref。`Bathroom_cabinet_sink.FCStd`
的 Sketch259 里就有 `DistanceY {refs: [{geoId: 0, pos: 1}], value: 70}`，而被引用的
起点存的确实是 `y1 = 70`——这条约束的含义就是「该点的 y 为 70」。`two()` 随后调用
`ref(undefined)`，投影抛出 `TypeError: Cannot read properties of undefined
(reading 'pos')`。

`convert.ts` 捕获该异常并把草图记为 `L2 / solver-throw`，使整个文件失败（不产出
容器）。这是语料里最大的缺口类：前 900 个文件中有 436 个（1047 个草图）命中。
由于该异常会在草图的下游消费者运行之前就中断，它还**掩盖了真正的缺口**——即便
该草图自身的求解已经成功，最终报告仍写成草图崩溃。

`DistanceY`/`DistanceX` 不是唯一的暴露面：`Coincident`、`Parallel`、`Tangent`、
`Perpendicular`、`Equal`、`DistanceX/Y` 都会走到 `two()`，而 `PointOnObject`
（`refs[1]`）与 `Symmetric`（`refs[2]`）是直接下标取用——任何 refs 不足的输入
都会以同样方式崩溃。

## 决策

在**任何解引用之前**按类型最小 ref 数（`REFS_REQUIRED`）做检查，不足者写入投影
既有的 `unmapped` 台账，理由为 `ambiguous-refs`。该台账本就用于坐标轴 ref、
参考（非驱动）约束与不支持类型，因此不引入任何新词汇，损失也保持可见而非静默。

`REFS_REQUIRED` 只登记投影 switch **真正处理**的类型。它不处理的类型
（`InternalAlignment`、`Block`、`Weight` 等）不在表中，仍走 `default:` 分支、
仍报 `unsupported-type`——守卫不得改写本就正确的诊断。

守卫刻意**不**尝试补全缺失信息。planegcs 后端同样会忽略 1-ref 的
`DistanceX`/`DistanceY`（其 `r[1]` 不存在，因而不会 push 任何 primitive）。
两条投影因此一致地认为该约束不含求解信息，这正是「convert 期保真预检」与
「产出的 `cad.sketch`」保持同步的原因。若要任一侧去钉住绝对坐标，需要新增
canonical 约束种类，属另一项改动。

## 后果

- 该崩溃类已消除。在原先报 `solver-throw` 的样本上实测：
  - `Bathroom_cabinet_sink.FCStd` → `ok: true, gaps: []`，63 个草图全部 `L0`。
  - `Plate Wheel simplex 1x17,02.FCStd` → `ok: true, gaps: []`（原为
    `solver-throw` + `groove-profile-baked-upstream`）。
  - `battery-AAA.fcstd` → `ok: true, gaps: []`。
- 上述样本表明被丢弃的 1-ref 约束不会改变解：周边约束仍钉住了几何，classify
  仍落在 `L0`（求解器复现了存储坐标）。
- 另两个样本停止崩溃后暴露了**下一个**根因：`FAULHABER_2342L-012CPR.FCStd` 与
  `Fountain.FCStd` 现在失败于
  `external-geometry-unresolved: unsupported sub-element: Vertex55/Vertex19`
  （`external-geo.ts` 只接受 `Edge<N>` 链接），并级联出 `pad-missing-profile` /
  `groove-missing-base` / `fillet-missing-base`。这是独立的特性缺口，不是回归。
- `packages/sketch` 既不在 pre-commit 的 eslint glob
  （`{src,packages/core/src,packages/stdlib/src,packages/gear-lib-demo/src}/**`）
  内，也不在 `npm run lint`（`packages/core/src packages/faijs-extra/src`）内，
  因此 `project.ts` 带着一处既有的 `no-unused-vars`（未使用的 `geoms` 参数，
  HEAD 即已存在）。此处如实记录，而不用改名掩盖：该参数正是文档所述「对 geoms
  做边界检查」的落点，修它本身是一次行为变更。

## 涉及文件

- `packages/sketch/src/project.ts` —— 新增 `REFS_REQUIRED`、ref 数守卫及其文档条目。
- `packages/sketch/src/project-fcstd.test.ts` —— 两个回归测试：1-ref `DistanceY`
  被记入台账而非抛出；各类 refs 不足的约束都不会抛出。

## 备选方案

- **改为抛出带类型的 `SketchProjectionError`。** 否决：调用方（`convert.ts`）会把
  任何抛出都当作 `solver-throw` 并使文件失败。写入台账才是投影文档化的「无
  canonical 对应物」上报方式，也能让失败归因保持正确。
- **现在就给 canonical 增加 `coordinateX`/`coordinateY` 种类，并让后端把 1-ref
  `DistanceX/Y` 映射为 `coordinate_x`/`coordinate_y`。** 延后，非否决：这是保真的
  编码方式，但它改动了 canonical 的公开词汇（`cad.sketch` 约束），需要同步反向
  映射与 CadQuery 表，并要针对语料实测——属独立改动，而非崩溃修复。
- **放宽调用方对外部几何的 `polyline.length >= 2` 过滤。** 不在本次范围：该过滤
  针对的是外部链接，不是草图约束。
