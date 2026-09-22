# Agent Note: 跨文件调用路由——触及 main/外 Body 变量的调用必须进 main

Status: implemented

English | [中文](2026-09-20-cross-file-call-routing.md)

## Problem

接线 Body 容器依赖（test_geomop：Part::Cut 的 Tool→Body、Base→游离
Part::Box）暴露出 M10.3 多文件拆分的一类 SEC_FREE_IDENT：输入活在其他模块
的 Cut 仍被发进自己的 Body 文件（`let part26 = cad.subtract(part19, part5)`
出现在 Body003.fai.js，而 part19 声明在 main.fai.js）。三层暗坑，每层都被
「上一层修复后套件通过」掩盖：

1. Body 容器的依赖对 `variables` 解析——那里永远没有 Body 名（Body 结果在
   chainVar 里）。
2. 有了 chainVar 回退后，Kahn 仍把容器依赖当「链建好之前就满足」（Cut 跑在
   它的 Base 被构建之前）。
3. 文件路由比较 `own === b`（own 有值时恒真）、且完全跳过折入调用
   （`own === undefined`），引用 main 变量或外 Body 链头的 cut 畅通无阻地
   进了 Body 文件。

## Decision

- 依赖解析：`variables.get(dep) ?? chainVar.get(dep)`。
- Kahn 就绪：Body 容器依赖展开为该 Body 的成员特征——消费者排在链建好
  之后。
- 路由：调用进 Body 文件仅当 own === b、没有输入属于别的 Body（查
  `assigned` **或** `headToBody`——外 Body 链头从不在 `assigned` 里）、且
  没有输入是已知的 main 输出（`mainOuts`；折入调用不在 `results` 里，此
  检查不得依赖 `own`）。其余一律去 main——在那里输入重映射为外 Body 导入的
  `<Body>_out` 终端别名。

## Alternatives considered

- **跨文件 import 裸变量** — 否决：模块导出按契约只有 `<Body>_out` 终端
  （module-registry D6）；导出内部 partN 变量会破坏聚合入口依赖的命名
  稳定性。
- **在 Body 文件里发本地别名** — 否决：Body 文件 import 另一个 Body 的
  终端来喂自己的链，会把跨 Body 依赖从模块图里藏掉；main 才是诚实的位置。

## Consequences

- 56 样本 sweep：ok 45→**46**（test_geomop 转出）、gap 11→10、
  **checkFail 4→0**（本阶段迭代中一度引入又消除的 SEC_FREE_IDENT 回归：
  3 个中间状态曾 checkFail 4）。
- 剩余 10 个失败全部是真实特征/几何工作（Draft 对象、EngineBlock、外部
  几何、compound 成员、1 个不支持约束、delta-exceeds-t1）。
- fcstd 套件 13 文件 / 134 用例绿（+1：Body 容器链头解析 GOTCHA）。
- 探针留档：`packages/core/scripts/dbg-cut-tool-body.mts`（tsx 运行的
  Tool→Body 解析合成复现）。
