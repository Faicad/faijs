# Agent Note: 轮廓闭合即停——已闭合的链不许继续扩展

Status: implemented

English | [中文](2026-09-20-contour-stop-at-closure.md)

## Problem

贪心重扫修复之后，tap 和 slittingsaw 仍报 `sketch-not-solved`（contours=0），
而求解器本身收敛。对求解后端点的探针钉死了它：链接器在链**已经回到头部**
之后仍继续扩展。tap 轮廓顶点 (0,0) 同时被闭合段（seg5）和自由段（seg8，
0,0→-4,4）触及；自由段被吞进链里，`closed` 变 false，完美闭合的 6 段环被
丢弃。与 ballend 抢链同类失效，只是发生在链的更后段。

## Decision

- `extractContours`：**闭合即停**——每次扩展扫描前，若链已触及头部
  （`segments.length > 1 && near(tail, head)`）则 break。闭合先到先得：
  先闭合的链保住线段；剩余自由段另起（开放、被丢弃的）链。
- **BIM WallTrace 开放轮廓策略（已定案，无需改码）**：探针 BIMExample——
  WallTrace* 草图是单条开放线/折线，消费者只有 Part::FeaturePython 的 Wall
  对象（H10 已 python-baked）。没人消费该轮廓几何；开放轮廓草图保留
  `pending-sketch-channel` 式备注即可，不阻塞文件。

## Alternatives considered

- **全候选回溯搜索** — 继续延后：两类 corpus 失效（链中抢链、闭合后抢链）
  已由重扫 + 闭合即停解决；出现三向汇合节点再回访。
- **为墙迹线发出开放轮廓** — 现阶段否决：没有消费者读取，徒增台账噪音；
  随 BIM 墙体特性工作一并回访。

## Consequences

- 56 样本 sweep：ok 42→**43**（tap 转出）、checkFail 0。slittingsaw 仍缺口
  （11 线轮廓先链进错误的环——同族问题，下一轮）；BIMExample/TestTangentMode
  按策略/真实拓扑保留。
- 测试：contour.test.ts +1（tap 真实端点数据；闭合即停 GOTCHA）。fcstd
  套件 13 文件 / 131 用例绿。
