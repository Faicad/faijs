# Agent Note: Pocket ThroughAll 支持 + BODY_CHAIN_BASE 泄漏守卫

Status: implemented

English | [中文](2026-09-20-pocket-throughall-and-marker-guard.md)

## Problem

ThroughAll（通孔）此前被显式烘焙为 `pocket-type-ThroughAll-unsupported`——
hole_puzzle（×9）、motor_mount_inch（×2）、strange_part_with_holes（×2）全部
只差这一块。实现过程中还暴露了上一轮修复的漏洞：CAM demo 零件**没有
PartDesign::Body**，`BODY_CHAIN_BASE` 标记永远不会被重定向，直接泄漏进生成
代码：`cad.subtract(::body-chain-base::, part3)`——非法 JS，parser 杀掉整
文件（motor_mount_inch check-fail）。

## Decision

- **ThroughAll 与 Length 同路径翻译**，棱柱深度取 1e6 mm（按 Reversed 定
  符号）：FreeCAD 会在减运算时用基准实体截断通孔棱柱，超深深度在 subtract
  后是精确的。GOTCHA 测试锁定（Type='ThroughAll' → translated、2 调用、
  切削方向深值）。
- **codegen 加泄漏守卫**：Body 折入步骤之后，调用里仍带 BODY_CHAIN_BASE 的
  特征（无 Body / 链头未建立）显式降级为 `pocket-missing-dependency`
  缺口——标记绝不出现在生成代码里。
- **旧烘焙表断言更新**（`feature-type.test.ts`）：「pocket ThroughAll must
  bake」是 M9.3 时代口径；正向覆盖现居 feature-translate.test.ts。
- corpus 后续记录在案：3 个无 Body 的 CAM 文件带 `SubShape` 结果缓存、无
  Body 链——未来的出路大概率是 H7 Part::Feature 同款的 shape-asset 式
  解析；本轮延后。

## Alternatives considered

- **为 ThroughAll 计算真实基准包围盒深度** — 否决：翻译器拿不到基准几何；
  超大常量因 subtract 截断而精确，1e6 mm 远在浮点精度安全区内。
- **泄漏守卫改为把标记替换成 profile 变量** — 否决：减错操作数会静默产出
  错误几何；显式缺口才是诚实的。

## Consequences

- 56 样本 sweep：ok 37、checkFail 1→0（标记泄漏的 parse 失败消除）；3 个
  CAM 文件从 ThroughAll-unsupported 退回 pocket-missing-dependency，等待
  SubShape/无 Body 链的解析方案。带 Body 文件的几何行为不变。
- fcstd 套件 13 文件 / 125 用例绿。
