# Agent Note: shape-asset 特征是可寻址实体（import_shape）

Status: implemented

English | [中文](2026-09-20-shape-asset-addressable-solid.md)

## Problem

SubShape→shape-asset 落地后，hole_puzzle 仍卡 `fillet-missing-base`、
test_geomop 卡 `cut-missing-dependency`：shape-asset 判定发出的是**零调用**，
而 codegen 只从调用（或非恒等 Placement）注册变量——零调用对象没有变量，
下游消费者（Fillet 的 Base→Pocket、Cut 的 Base→Pad）解析依赖落空。依赖明明
存在，缺的是变量绑定。

## Decision

- shape-asset 判定现发出一条 `cad.import_shape` 调用（`params.asset` =
  SubShape 的 `.brp` 成员路径，`source` = 对象名）。结果缓存成为真实的、
  可寻址的实体变量；assets/ 交付链（build-fai-zip）本来就带着字节。
- `out` 占位用对象名——codegen 本就把所有输出重命名为 partN。（首版实现
  在声明前引用了 `out`——ReferenceError 被新测试自己抓住。）
- 旧测试断言（`calls: []`）更新为新契约，注释标注 2026-09-20 变更。

## Alternatives considered

- **在 codegen 给零调用 translated 对象注册变量** — 否决：那会把名字绑到
  不可执行的东西上；import_shape 调用是诚实的（实体确实从资产加载），且
  保持 codegen 变量规则单一来源（变量只来自调用）。
- **让 Fillet/Cut 基准像 Pocket 一样回退 Body 链** — 不适用：这些文件没有
  Body；基准引用是显式的（Base→Pocket），只是目标此前不可寻址。

## Consequences

- 56 样本 sweep：ok 44→**45**、gap 12→11、`cliCheck` 失败 0。hole_puzzle
  越过 fillet 链推进到 `external-geometry-unresolved`（真实外部几何工作）；
  test_geomop 的 Cut 链已解析但仍有自己的下一个阻塞（其 cut-missing-
  dependency 属另一不可解析 Base——下一阶段 triage）。
- fcstd 套件 13 文件 / 133 用例绿（2 例新增/更新 GOTCHA 测试）。
- 剩余 11 个失败：type-not-whitelisted 3（draft_test_objects、EngineBlock、
  all_objects）、sketch-not-solved 2（策略/拓扑）、external-geometry 2、
  compound 1、unsupported-constraint 1、cut 1、delta-exceeds-t1 1——全部是
  真实特征/几何工作。
