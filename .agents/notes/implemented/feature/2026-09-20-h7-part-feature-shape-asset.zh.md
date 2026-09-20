# Agent Note: H7 第一刀——Part::Feature 作为纯 Shape 载体

Status: implemented

## Problem

`Part::Feature` 是翻译缺口清单里最大的单一类型（全库 1,359 个对象；H10 接线
后是 47 个失败语料文件中 21 个的首因）。corpus 探查表明这些对象**根本不是
参数化特征**：56 个样本全部 70 个对象的属性面恰好是 `Shape`（41×）或
`Shape` + `ShapeMaterial`（29×）——没有任何特征参数。几何以 `.brp` 成员形式
存于 ZIP（`Part::PropertyPartShape` 元素内的 `file="Face005.Shape.brp"`），
容器构建器（M2.3）早已将其拷入 `assets/`。把「不在白名单」当成「翻译缺口」
是把一个既有事实的形状误判成了待做工作。

## Decision

- `translateObject` 增加可选第 4 参 `shapeCarriers`：`Shape` 属性的 `file`
  属性指向的 `.brp` 成员**在压缩包中真实存在**的对象名集合（`convert.ts`
  经 `memberText` 收集）。
- 集合内的 `Part::Feature` 判为 `{ kind: 'translated', calls: [],
  reason: 'shape-asset' }`——零 cad 调用；几何经 `assets/<name>.Shape.brp`
  交付并登记进 mapping 的 artifacts。
- 集合外的 `Part::Feature` 是显式缺口（`shape-asset-missing`），绝不静默烘焙。
- codegen 经 `generateModel(..., shapeCarriers)` 把集合传下去。

## Alternatives considered

- **让 `cad.asset` 学会加载 .brp 并发出真实调用** — 延后：现 `cad.asset`
  返回 UTF-8 文本（面向 SVG）；让它交付 BREP 形状是内核工作量，而当前没有
  下游消费者需要它（corpus 里 Part::Feature 的消费者——Extrusion/MultiFuse/
  Groups——本来就因别的原因在缺口里）。台账里记了 artifact 路径。
- **在 C4 三态之外新增 `shape-baked` 处置** — 否决：C4 契约是三态；
  「形状已作为资产存在、因为没有需要翻译的东西所以零调用」诚实的表述就是
  带区分 reason 的 `translated`。
- **把类型加进白名单然后落到 `default`** — 否决：default 会发
  `type-not-implemented`（谎言——根本没尝试过），且形状证据检查会丢失。

## Consequences

- 56 样本 sweep：ok 22→23，`Part::Feature` 缺口文件数归零；全部 ok 产物
  `cliCheck` 失败 0。唯一新增的 ok 文件是唯一以 Part::Feature 载体为全部
  阻塞的文件；其余原首因文件现在卡在各自真正的下一个阻塞上
  （revolution-missing-profile 等）。
- 全库推论：全部 1,359 个 `Part::Feature` 对象应能以同样方式转出（属性面
  相同）——批量阶段验证。
- `Part::Revolution`/`Fillet`/`Chamfer`（Part 工作台同名异构系，730 对象）
  在 56 样本零出现；仍是批量阶段的 H7 工作。
- 测试：`feature-translate.test.ts` H7 组（3 例，含形状证据 GOTCHA 与显式
  缺口路径）；fcstd 套件 12 文件 / 120 用例绿。
