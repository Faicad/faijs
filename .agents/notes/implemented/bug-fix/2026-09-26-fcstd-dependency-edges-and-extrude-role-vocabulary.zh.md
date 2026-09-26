# 代理说明：FCStd B2 依赖边与 A2 拉伸角色词汇表

Status: implemented

[English](2026-09-26-fcstd-dependency-edges-and-extrude-role-vocabulary.md) | 中文

## 问题

两个独立的阻塞点让 `Architectural Parts/Bedroom/Beds.FCStd` 产不出可运行产物。它们被当作两个
不同的计划项上报，且两者的真实成因都与计划里记录的不同。

**B2 —— 「Loft/Compound 未实现」。** 转换器报告：

```
gaps: [{"name":"Loft002","type":"Part::Loft","reason":"loft-section-baked-upstream:Sketch262"},
       {"name":"Compound001","type":"Part::Compound","reason":"compound-missing-members"}]
```

但 `Sketch262` **已翻译且求解成功**，`Compound001` 的 `Links` 也一个不缺。两条 reason 都是假象，
不是能力缺口。

**A2 —— 「fillet edgeRef 无角色血统」。** 计划把这一族（A2/A4/A6）记为已被早前的拓扑血统重构消解。
B2 修好后，执行推进到：

```
Execution failed at statement 32 (callee: fillet): edgeRef: adjacent face ordinal 2 has no role lineage
```

可见该结论对这份样本是错的：失败不在血统回走断裂，而在 fillet 基体的**词汇表缺项**。

## 决定

### B2：拓扑排序的边由翻译器自己的属性清单导出

`codegen.ts` 的 `depsOf()` 自带一份硬编码链接属性清单，缺了 `Sections`（Part::Loft / Part::Sweep
的轮廓）和 `Spine`（Part::Sweep 的路径），且 `Originals` 被放在单值清单里——而 `App::PropertyLinkList`
在单值读法下取不到任何东西。于是 Kahn 把特征放在它的 Document.xml 位置上（FreeCAD 按对象名排序，
故 `Loft002` 排在 `Sketch262` 之前），`inputVar()` 合理地返回 undefined。

修法不是往第二份清单里补名字，而是由 `feature-translate.ts` 导出 `LINK_INPUT_PROPS` 与
`LINK_LIST_INPUT_PROPS`（翻译器真正会通过 `inputVar()` 解析的属性），`depsOf()` 只消费它们。两份
清单从此不可能再漂移。

`UpToFace` 刻意排除：Pad/Pocket 的「拉伸到面」可以指向**后续**特征才产出的几何，把它当成依赖会让
排序死锁。

Kahn 循环同时补了环断裂。此前停滞的对象会被整个丢出 `order`，永远到不了翻译器，于是保留容器的
初始 `feature-translation-pending` 处置——一个排序死锁被报成翻译缺口。新增依赖边绝不能让对象从
账本里消失，所以剩余对象改为按迭代序发射，各自降级到自己诚实的 bake reason。

### A2：拉伸必须给每个侧面命名，且必须知道自己是沿哪个轴拉伸的

在 Beds `part28`（`place(extrude(sketch))`，轮廓含 4 段弧）上实测：10 张面，角色表只覆盖 6 张
（`bottom, top, wall:0..3`）；未覆盖的 4 张（序号 2/4/6/8）恰好是弧段扫出的 4 张 `cylinder` 侧面。
两个缺陷：

1. `extrudeConstructRoles` 只在 `surfaceType === 'plane'` 时取法向，曲面侧面因而没有法向、拿不到
   `wall:<i>`，还被 `wallIdx` 跳过——这同时破坏了 `role-name.ts` 的契约（`wall:3` 是「profile 第 3
   条边扫出的面」）。
2. 拉伸轴取「第一对反平行的平面法向」。方柱有三对这样的面；Beds 里 X 向侧壁先于端盖被找到，于是
   `top`/`bottom` 落到侧壁上、真正的端盖被编成 `wall:N`。

修法：侧面一律按法向判定、不再限平面（圆柱面 uv 中点法向是径向，故与拉伸轴垂直）；拉伸轴**由 op
自己的拉伸方向 hint、由几何确认**——至少两张面的法向与之平行才采信，否则仍走原来的几何搜索。两半
缺一不可：方向负责消歧，几何负责裁定。

## 已考虑的替代方案

- **就地往 `depsOf` 补上缺的属性名。** 否决：这份清单正是这样漂移了两次（已为 `Links` 记档，现在
  又是 `Sections`）。要修的是唯一真值，不是手抄第四个名字。
- **让 `depsOf` 对所有 `App::PropertyLink*` 属性通用化。** 否决：`UpToFace` 与附着的 `Support`
  链接可以指向下游，产生的环会白白重排（在环断裂之前甚至会丢弃）对象。
- **给 `edgeRef` 加血统回走兜底**（`resolveFaceGeometry` 已有）。作为 A2 的修法否决：它帮不上忙。
  这不是「表里有、本次 miss」——根本没有任何 role 给这张面起过名，没有可回走的 `(origin, role)`。
  这仍是一个值得补的真实不对称，但不是本 bug。
- **给非基本体链根发位置兜底名**（`extrude:face_3`）。否决且早已被禁：OCCT 不承诺面序稳定，这类
  名字抗不住重放，还会用无意义的名字把覆盖率统计灌水。
- **纯几何但更聪明地定轴**（如取间距最大的那对反平行面）。否决：绕弯，且对方柱仍然有歧义。op 知道
  自己沿哪个方向拉伸；以「脚本可能写成别的形式」为由拒绝使用它，是可以回答的——几何确认那一步就是
  回答。

## 后果

- Beds.FCStd：`gaps` 2 → 0（`translated` 31 → 33），`cliRun` 走到 STEP 导出（4930 个实体）。两项
  计划项在各自样本文件上关闭。
- A2 的修法改变的是**所有**拉伸的角色分配，不只含弧的那些：凡端盖不是第一对反平行面的棱柱，现在
  `top`/`bottom` 都正确落在端盖上，而不再落到侧壁。下游 `faceRef`/`edgeRef` 若曾把旧的（错的）名字
  固化下来，解析结果会变——变正确，但确实是变了。
- 回归护栏：`packages/core/src/api/extrude-wall-role-gotcha.test.ts`（core）与
  `packages/fcstd/src/codegen.test.ts` 新增两例（翻译器）。
- 探针按仓库规则保留：`packages/core/scripts/probe-a2-edgeref.ts`、`probe-a2-beds.ts`、
  `packages/fcstd/scripts/probe-b2-beds.ts`、`probe-b2-xml.ts`、`sweep-gaps.ts`。
- 语料抽样（119 个文件）无回归，剩余均为诚实的 bake reason：`sketch-solved-no-closed-loop`、
  成员确实未构建的 `compound-missing-members`、`sweep-spine-baked-upstream`、`shape-asset-broken`。
  排序丢弃对象数为 0（`feature-translation-pending` 计数 0）。
