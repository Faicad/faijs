# Agent Note: 无 BaseFeature 的 Pocket 经 Body 链解析

Status: implemented

## Problem

FreeCAD 0.20+ 的 PartDesign 文件常在内部特征上**省略** `BaseFeature` 属性——
基准由 Body 的特征顺序隐含。翻译器此前硬性要求 `inputVar(BaseFeature)`
可解析，凡缺该属性的 Pocket 一律落 `pocket-missing-dependency` 缺口，哪怕其
Profile 草图早已 translated + solved。corpus：hole_puzzle（9 个 Pocket，
全部无 BaseFeature）、motor_mount_inch（2）、strange_part_with_holes（2）
——3 个文件纯粹被这一条卡死。

## Decision

- `feature-translate.ts`：新增导出标记 `BODY_CHAIN_BASE`
  （`'::body-chain-base::'`——不是合法变量名）。BaseFeature 属性**缺失**的
  Pocket 发出的 `cad.subtract` 以该标记为基准输入；**显式** BaseFeature 解析
  失败仍是缺口（测试锁定）。
- `codegen.ts`：特征折入 Body 链时，把等于标记的调用输入重定向到链头
  （`prev`）。

## Alternatives considered

- **在翻译器内解析隐含基准** — 否决：翻译器是逐对象的，没有 Body 链上下文；
  链头只存在于 codegen 的折入步骤。
- **不发 subtract、由折入步骤直接做 `prev − featureVar`** — 可行且等价，但
  带标记发出 subtract 让 Pocket 自身的调用列表自描述，且 UpToFace/UpToFirst
  路径学会该标记后同样适用。

## Consequences

- 56 样本 sweep：3 个 pocket-missing-dependency 文件推进到**下一个真实阻塞**
  `pocket-type-ThroughAll-unsupported`（它们的 Pocket 是通孔）——本轮 ok 维持
  37，但依赖链失效类已消除；ThroughAll 支持是后续工作。
- 测试：`feature-translate.test.ts` 新增 2 例（标记发出 + 显式基准仍缺口）。
  fcstd 套件 13 文件 / 125 用例绿。
