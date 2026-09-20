# Agent Note: 轮廓提取贪心链接修复（ballend 系 11 文件 sketch-not-solved 的真因）

Status: implemented

## Problem

`Part::Feature` 修完后，56 样本仍有 13 个文件以 `sketch-not-solved` 为首因：
11 个 CAM 刀具坯同构系列（ballend/bullnose/endmill/radius/reamer/slittingsaw/
tap/thread-mill/taperedballnose/test-path-tool-bit-shape-00/
test_28534_truncated_pocket）+ BIMExample + TestTangentMode3-0.21。诊断发现
这些草图**根本不是没解出来**：全部 L0、`loopCount=0`——求解器收敛，轮廓
提取一无所获。

## Root cause（最小复现钉死）

`fcstd/contour.ts` 的 `extractContours` 贪心链接后**不重扫池子**：tail 漂移
到新端点后继续在同一轮扫描里向下匹配。当多条线段共享端点（刀具坯轮廓的
y=50 顶边由共线段拼成，另有旋转轴自由段和底部自由段），后索引的线段先抢走
链条，正确的先索引续接被断环——一个完美闭合的 6 段轮廓（弧+5 线）返回
0 环。

## Decision

一行修复：每次匹配成功后 `break` 出候选循环，while 重扫从池子头开始。用
ballend 的真实端点数据写成 GOTCHA 测试锁定（8 段含 2 自由段 → 必须产出
≥5 段闭环）。

## Alternatives considered

- **上游过滤 construction 几何** — 正交但不修本 bug：这些文件的轴线段在解析
  数据里没有 construction 标记（sketch-parse 全链路无此标记），过滤是独立的
  另一块工作；且无论有无过滤，重复端点的抢链 bug 都会破坏轮廓。
- **回溯式链接（全候选尝试、保留闭合链）** — 理论更稳，但仅重扫即可解决
  corpus 的失效类；若未来出现三向端点汇合的轮廓再回访。

## Consequences

- 56 样本 sweep：ok 23→**32**；`sketch-not-solved` 首因 13→4。残留：
  BIM 的 WallTrace 是**真实的开放墙迹线**（单线/开折线——需要开放轮廓策略，
  不是 bug）；TestTangentMode 有真实的自由段拓扑；TestSketchCarbonCopy 是
  已知的 delta-exceeds-t1 L1 案例。
- fcstd 套件：12 文件 / 121 用例绿（含新 GOTCHA 测试）。
- 这些文件里 translated 草图上的 `pending-sketch-channel` reason 是既有
  （M10.5 链路）现象，本修复未改变。
