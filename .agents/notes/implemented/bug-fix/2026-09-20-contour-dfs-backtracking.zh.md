# Agent Note: 轮廓 DFS 回溯——分支死路不再拖死闭环

Status: implemented

## Problem

前两轮轮廓修复之后 slittingsaw（11 线刀具坯轮廓）仍缺口：多条线段共享
y=0 轴（长中心线、缺口段、自由分支）。首到先得的链接从种子出发走进了
seg2 的远端点 (-50,0)——死路——吞掉线段后真实的 8 段环永远闭不上
（contours 0，求解器正常）。这是同一贪心链接器的第三类失效：链中抢链
（ballend）、闭合后抢链（tap）、现在是分支死路。

## Decision

- `extractContours` 改用 **DFS + 回溯**链接：在每个端点尝试所有未用候选；
  第一条回到种子头部的路径胜出；死分支把线段退还池子
  （`cand.used = false`）并尝试下一候选。此前的临时规则（池子重扫、闭合
  即停）均被 DFS 的遍历次序覆盖，已删除。
- 指数最坏情况在实践中可控：轮廓池 ≤ 几十条线段、多数端点只有 2 向；分支
  密集的语料恰恰是旧链接器已失效的场景，搜索在首次闭合即终止。

## Alternatives considered

- **优先级启发式（偏向离头部近/共享端点少的候选）** — 否决：启发式靠猜，
  回溯靠证明。slittingsaw 的分支节点上没有任何局部信号能区分获胜续接。
- **欧拉路径/平面面遍历（正规半边网格）** — 原则上正确的修法，但改动大得
  多；若 DFS 在真实语料上出现病态耗时再回访（批量阶段会给答案）。

## Consequences

- 56 样本 sweep：ok 43→**44**（slittingsaw 转出，8 段环经死路分支回溯
  找到）、gap 13→12、`cliCheck` 失败 0。`sketch-not-solved` 降至 2
  （BIMExample 按开放轮廓策略、TestTangentMode 真实拓扑）。
- 测试：contour.test.ts +1（slittingsaw 真实 11 线端点数据 → ≥8 段闭环）。
  fcstd 套件 13 文件 / 132 用例绿。
- 剩余 12 个失败全部是真实特征/几何工作（Draft 对象、EngineBlock、compound
  成员、外部几何、fillet/cut 链、delta-exceeds-t1、PocketTest 空白条目待
  triage）。
