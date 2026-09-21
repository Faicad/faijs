# Agent Note: SubShape 结果缓存 → shape-asset（无 Body 的 PartDesign 文件）

Status: implemented

## Problem

Body 链回退与 ThroughAll 支持落地后，3 个无 Body 的 CAM demo 文件
（hole_puzzle、motor_mount_inch、strange_part_with_holes）仍卡在
`pocket-missing-dependency`：它们没有 PartDesign::Body，BODY_CHAIN_BASE
标记没有链头可解析。corpus 探针显示每个 Pocket 都带 `SubShape` 属性
（Part::PropertyPartShape），其 `.brp` 成员在 ZIP 里真实存在——被切出的
几何早已是事实（hole_puzzle：9 个 SubShape 缓存 / 77 个 .brp 成员；另两个
各 2 个）。对已存在为资产的几何给一个诚实但无用的缺口，不如给它正名。

## Decision

- `translateObject`：对象在 `shapeCarriers` 集合内**且**带 `SubShape` 属性时，
  判为 `{ kind: 'translated', calls: [], reason: 'shape-asset' }`——复用 H7
  Part::Feature 模式（结果缓存 → 零 cad 调用，几何经 assets/ 交付）。
- **只有 SubShape 构成证据。** 同文件的 Pad 也带 `Shape` 属性；把它们劫持进
  shape-asset 会压制真实翻译（测试锁定：带 Shape 的 Pad 仍走正常路径）。
- `convert.ts` 把 SubShape 载体收进同一个 `shapeCarriers` 集合（`SubShape`
  属性的 `file` 成员存在）。
- 同轮 sweep 回归类 triage：`Part::Plane`、`Part::Line`（Part 工作台基准
  面/线，同 App::Plane/App::Line 语义）、`App::TextDocument`、
  `Fem::FemPostWarpVectorFilter` 分别加入结构/FEM 集——前面的阻塞一落，
  它们就浮出来了。

## Alternatives considered

- **把特征上的 Shape 也当 shape-asset 证据** — 否决：特征的 Shape 是其计算
  结果；可翻译的特征必须继续翻译，参数变更才能流动。只有特征自有的
  `SubShape` 缓存才在无 Body 文件里标记「这个对象的全部目的就是这个冻结
  结果」。
- **为这些文件合成虚拟 Body 链** — 否决：文件确实没有 Body；凭空造一个会
  改变超出证据范围的几何排序语义。

## Consequences

- 56 样本 sweep：ok 37→**39**（strange_part_with_holes、FEMExample 转出；
  motor_mount_inch 完整转换；hole_puzzle 推进到 fillet-missing-base——它
  自己的下一个阻塞）、checkFail 0。
- 剩余首因：`type-not-whitelisted` 6（Draft/Assembly/VRML——批量阶段）、
  `sketch-not-solved` 4、单例 5（含 hole_puzzle 的 fillet 链）。
- fcstd 套件 13 文件 / 128 用例绿（新增 3 例：SubShape 资产、Pad 不劫持
  GOTCHA、无证据路径）。
