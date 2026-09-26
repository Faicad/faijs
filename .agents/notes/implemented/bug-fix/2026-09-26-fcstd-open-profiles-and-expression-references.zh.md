# 代理说明：FCStd 开放轮廓是能力缺口而非缺陷；B1 表达式引用已落地

Status: implemented

[English](2026-09-26-fcstd-open-profiles-and-expression-references.md) | 中文

## 问题

B2（依赖边）与 A2（拉伸角色词汇表）收口后，重跑一份新的 150 文件语料样本
（`packages/fcstd/scripts/sweep-gaps.ts 150 7`）得到 `ok=117 gapped=33 failed=0`，缺口台账的头部
两项合计占约 180 条记录中的 105 条：

```
72  Part::Extrusion :: extrusion-missing-base
33  Sketcher::SketchObject :: sketch-solved-no-closed-loop
```

两者最初都按缺陷去打，结果都不是。本轮真正有价值的产出是**证伪了的假设及其测量**。

**`extrusion-missing-base` 是级联，不是独立缺陷。** 在
`Architectural Parts/Windows/Fixed/Double glazed window with shutters and simple.FCStd` 上，
`Extrude_Sketch094.Base = Sketch095` —— 正是那个 `sketch-solved-no-closed-loop` 的草图。同文件的
另一个草图 `Sketch094` 是 translated 的，Extrusion 只是没有可消费的东西。

**`sketch-solved-no-closed-loop` 是对模型的真实陈述。** 两个假设经实测否证：

1. **容差。** `contour.ts` 用 `JOIN_TOL = 1e-7` 串接端点，而求解验收容差 `SKETCH_T1` 是 `1e-6`，
   于是草图可能"解过了却串不上"。`probe-sketch-loop.ts` 把所有端点聚类并报告最大簇内距离：
   每个失败样本都是 **0.000e+0**。端点精确重合，容差不是成因。
2. **构造几何污染。** FreeCAD 用 `<Construction value="1"/>` 标记参考几何且从不约束它，存下的
   坐标是残留垃圾（`Sketch095` 有一条 `StartY = -16508.67` 的构造线，真实弧在 y ≈ 1165）。
   解析器把标志丢弃了，而 `extractContours` 的文档注释承诺"non-construction segments only"却
   没过滤任何东西。仍然修了（它本身就是对的），但语料计数 **33 → 33**，零效果。

这些轮廓实际是什么：`Sketch095` 是两个 r=7 的半圆在一点相切（圆心 (25,1172) 与 (25,1158)）——
一条开放的 S 形线。`Bathroom_cabinet_sink.FCStd` 的 `Sketch037`/`Sketch238`/`Sketch239`/`Sketch268`
是单条直线，被 `Part::FeaturePython` 的 `PathArray.PathObject`（阵列路径）消费；
`Sketch036`/`Sketch229` 则作为 `Part::Sweep.Spine` 与 `Draft Clone2D.Objects`。

**决定性证据：这些是曲面不是实体。** `Extrude_Sketch094.Shape` 冻结为 `PartShape3.brp`，直接从
压缩包读出是 `Sh 1 / Wi 2 / Fa 2 / Ed 7 / Ve 6`，**没有 `So` 记录**。即使 `Solid=true`，FreeCAD
也把这条开放线拉成了壳。没有实体可翻，`cad.extrude`（接面）表达不了。

## 决策

落地三处改动，只有第三项推动了台账。

1. **解析并排除构造几何**（`sketch-parse.ts`、`contour.ts`）。`SketchGeom` 增加
   `construction: boolean`，`parseGeometryList` 读取该兄弟节点，`extractContours` 在链池与
   自闭合圆两处都跳过它。
2. **破损形状资产不得抢占可翻译类型**（`feature-translate.ts`）。零字节或缺失的 `.brp`
   曾被无条件提前 bake。FreeCAD 常为"结果已折入 Body"的特征保存空的形状缓存——
   `RND_455_00194.fcstd` 给 `LinearPattern` 存了零字节 `PartShape69.brp`，给 23 个
   `PartDesign::Mirrored` 存了空缓存——该事实与可翻译性无关。现在这个判定只在类型会落入
   `python-opaque` / `type-not-whitelisted` 时生效，也就是 E4 原本针对的那条兜底路径。
   实测效果：**0 个文件**，但 `PartDesign::PolarPattern` 改报 `polar-pattern-missing-source`
   （真实缺陷），不再归咎于缺失的 `.brp`。
3. **B1：解析 `Object.Property` 与 `Sketch.Constraints.<名称>` 引用**（`expressions.ts`）。
   引用解析原本只认 Spreadsheet 三跳形态。按序增加：Spreadsheet 别名（既有）；
   `Sketch.Constraints.<名称>`（具名驱动约束——`-Sketch229.Constraints.Length / 2`、
   `Esboco_janela_fixa_persiana.Constraints.Largura_vao`）；普通对象属性，顺带打通
   `App::VarSet` 变量（它们就是 `App::PropertyLength` 属性，而 `spreadsheetAliasValue` 只接受
   `Spreadsheet::Sheet`）。被引用对象自身的 ExpressionEngine 绑定会被跟随，并带环保护。
   `Pad010.Length = Pad_MountingPadEdge.Length` 现已可翻译。实测：
   `pad-length-expression-non-constant` **10 → 0**，`pocket-missing-dependency` 7 → 6。

## 已考虑的其它方案

- **把 `JOIN_TOL` 放宽到 `SKETCH_T1`。** 否决：失败样本的 `worstIntraCluster` 实测就是 0，
  放宽不修任何东西，只会让串接变松。
- **强行闭合开放轮廓**（把两个自由端连起来）。否决：那是编造几何。冻结的 BREP 证明 FreeCAD
  产出的是壳；发出实体会是静默的保真度谎言，正是计划禁止的（"真差异显式留 reason"）。
- **把开放草图判为 `preserved-only` 以阻断级联。** 否决：那会掩盖"建于其上的特征没有几何"
  这一事实，而 `extrusion-missing-base` 本来就该报这件事。
- **现在就把 `PartDesign::Mirrored` 变成可翻译。** 推迟：它不在白名单里、也没有分支，且它的
  `MirrorPlane` 是指向 `Sketch002.V_Axis` 的 `LinkSub`——草图轴，不是基准面。该子形态对应的
  正确镜像面未确立，`Originals` 又是 `count=0`，猜测会有几何错误风险。它保持为诚实的缺口。
- **让 `Originals` 为空的阵列特征回落到 `BODY_CHAIN_BASE`。** 推迟：`Originals` 为空时 FreeCAD
  语义是"整个累积体"，而 codegen 目前把每个非切除特征并入 Body 链——把阵列结果并到它本身就
  包含的链头上会重复计数。错误的几何比诚实的 `polar-pattern-missing-source` 更糟。

## 后果

- 语料样本在文件层面未变：**117/150 ok，33 gapped，0 failed**。无回归，排序仍未丢弃任何对象
  （`feature-translation-pending` 哨兵 = 0）。
- 最大的两类缺口现已确认为**能力缺口而非缺陷**：翻译它们需要线/路径表示（开放草图 → 路径），
  以及 `Part::Extrusion` 对开放线的曲面输出。这是 C 类工作，不是快速修复。
- 样本上剩余的诚实缺口类别：`compound-missing-members`、`multifuse-missing-dependency`、
  `cut-missing-dependency`、`delta-exceeds-t1`、`fillet-missing-base`、
  `polar-pattern-missing-source`，外加 `PartDesign::Mirrored`（23 条，完全没有翻译器）。
- 回归护栏：`packages/fcstd/src/construction-geometry-gotcha.test.ts`、
  `packages/fcstd/src/expressions-object-ref-gotcha.test.ts`（含引用环用例），以及
  `feature-translate.test.ts` 中的两个用例。
- 探针按仓库规则保留：`probe-sketch-loop.ts`、`probe-shape-asset.ts`、`probe-b1-expr.ts`。
