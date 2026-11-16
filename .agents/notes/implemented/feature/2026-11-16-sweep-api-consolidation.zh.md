# Agent Note：扫掠公开面收敛为 `sweep` + `sweepRaw`（含三引擎能力实测）

Status: implemented

2026-11-16。承接 `2026-11-16-pipe-along-multi-segment-sweep.zh.md`（四段式扫掠）与本次
「API 合并 + 引擎探测」两步。

## 问题

仓里有四条扫掠路径，名字各说各的，差别全在**内核**而不在用户意图：

| 旧符号 | 内核入口 | 定义域 |
|---|---|---|
| `cad.pipe` | occt `MakePipe` | 单边 / 同类型 G1；face 截面 → 实体，wire/edge → 壳；**无控制面、无落位** |
| `cad.sweep` | L1 中立（occt `sweepPipeShell` / brepkit NURBS / smlib 平面路径） | 只取外环（孔丢失）、无落位 |
| `cad.sweepAdvanced` | occt `sweepFull` 全套控制面 | law / auxSpine / support / withContact… |
| `cad.sweepAlong` | 策略执行器（事实→策略→执行→判据） | 真正的「按意图干活」那条 |

同一个「截面沿中心线扫出管」的意图，用户从名字里看不出该选谁。仓库内也没有任何脚本用
`pipe`（只有 3 个测试 + 文档示例）⇒ 删除零能力损失。

## 决策（用户 2026-11-16 批准，明确「不需要兼容性」）

公开面只留**两个**：

- `cad.sweep(section, spine, SweepOptions{strategy, autoPlace, volumeTolerance, strict})`
  —— 唯一入口：脊柱事实 → 策略（single / miter / segments / closed）→ 执行 → C1/C2/C3。
- `cad.sweepRaw(profile, spine, SweepRawOptions)` —— 内核控制面逃生口（原 `sweepAdvanced`）。

删掉 `cad.pipe`（定义域 = `sweep` 的 `single` 策略；带孔 face 由逐环扫 + `cut` 覆盖，
`MakePipe` 裸管线留在 `sweepRaw({ mode:'simple' })`），删掉 `cad.sweepAlong`（并入
`sweep`），`sweepAdvanced` 改名 `sweepRaw`。**不留兼容别名**。

## 引擎能力矩阵（全部实测，不是静态推断）

`packages/core/test/api/sweep-engines.test.ts`：同脚本三引擎实跑，4×4 截面。

| 用例 | occt | smlib | brepkit |
|---|---|---|---|
| S1 直线 25（截面在起点） | 400 | 400 | 400 |
| S2 截面在 z=0、脊柱 z=90..140（autoPlace） | 800 | 800 | 800 |
| S4 两段共线 G1 | 400 | 400 | 400 |
| S5 L 形 90° 折角（miter） | 320 | `E_SWEEP_ENGINE_CAP` | `E_SWEEP_ENGINE_CAP` |
| S6 带孔截面（8/4） | 3015.93 | 3015.93 | 体积对（3015.93）但 C1 面积读数失真 ⇒ 判据误报 |
| K1 内核级：平面真弧 r=10/90° | — | 251.33（= 面积×弧长） | — |
| K2 内核级：闭合整圆 r=10 | 1005.31 | 1005.31（= 面积×周长） | — |

由此定表（`sweep.ts#STRATEGIES_BY_ENGINE`，引擎能力的唯一判定点）：

| 引擎 | single | miter | segments | closed | C2 |
|---|---|---|---|---|---|
| occt | ✔ | ✔ | ✔ | ✔ | ✔ |
| smlib | ✔ | ✘ | ✘ | ✔ | ✘（`shapeOrientation` unsupported） |
| brepkit | ✔ | ✘ | ✘ | ✘ | ✘ |

## 三个只有实测才会暴露的事实

1. **smlib 内核自己就把截面搬到路径起点**（`SmApiCreateSweepAlongPlanarPath` 的
   `moveProfile=true`）：叠加我们的 autoPlace **不会搬两次**，S2 与 occt 同为 800。
2. **smlib 吃多边路径 / 闭合路径 / 带孔截面**（S4 / K2 / S6 全部与 occt 一致）。它缺的只有
   转角过渡（miter）与引导线入口。⇒ `closed` 开放给 smlib，`segments` 暂关——后者需要真弧
   脊柱，而 `cad.circleArc` 只有 occt 实现（op 级弧脊柱在 smlib 上造不出来，缺口在脊柱
   构造，不在扫掠）。
3. **brepkit 的 `shapeType` 只区分 SOLID / FACE / COMPOUND**（`brepkitKernel.ts:1478`），wire
   一律报 COMPOUND。所以脊柱判据不能用类型字符串，必须用**结构**判（有 `edge`、且没有
   `face`）——否则 brepkit 上所有合法脊柱都会被误杀成 `E_SWEEP_SPINE_NOT_WIRE`。

## 顺带发现并修掉的两个缺陷

- 单独一条 **edge 截面**（`cad.circleArc` 的输出）直送内核 → occt
  `BRepFill_Section: bad shape type of section`。现在在 `sweepRingsOnce` 里把 edge 包成 wire，
  产物是**实体**（旧 `pipe` 的「edge → 壳」口径随 `pipe` 一起消失）。
- 折线脊柱（16/40 段近似弧）不再需要「靠体积守卫事后报警」：策略层选 `miter` 后体积精确
  （A2b/A5 实测），`strategy:'single'` 仍能复现旧的 2/π 偏差（A2 保留为守卫用例）。

## 未解决 / 需要后续

- `docs/ops-api-inventory.md(.zh.md)` **无法重生成**：生成器 `scripts/gen-ops-api-inventory.ts`
  已 deprecated，且当前因「逐 op 章节集 ≠ 符号表 op 集（171 vs 172，缺 `validateSolid`）」直接
  抛错（与本改动无关的既有缺口）。本次按生成器口径**手工同步**了 pipe / sweep / sweepRaw
  三章、op 清单与命名表；补上 `validateSolid` 章节后应重新生成一次并丢弃手工差异。
- `smlib` 上 `cad.circleArc` 没有实现 ⇒ 弧脊柱（`single` 真弧、`segments`）在 op 级不可达。
  要真正吃下 smlib 的曲线能力，下一步是给 `circleArc` / `wireFromEdges` 补 smlib。
- brepkit 带孔 face 的 `getSurfaceArea` 读不出净面积（读到 16，真值 150.8）。brepkit 是即将
  放弃的旧内核，不修；用例钉住现状（删 brepkit 时一并删）。

## 验证

```
npx vitest run test/api/sweep-engines.test.ts test/api/sweep-along.test.ts \
  test/api/sweep-guard.test.ts test/api/sweep-kernel-behavior.test.ts \
  test/api/sweep-hollow-pipe.test.ts test/api/sweep-loft.test.ts \
  test/api/sweep-revolve-guard.test.ts test/api/occt-s4-solid-offset.test.ts \
  test/brep/engine/engine-switch-smlib.test.ts \
  test/brep/engine/multi-engine-op-parity.test.ts test/api/occt-s4-c4-disposition.test.ts
```
11 文件 / 156 用例全绿；`npx tsc --noEmit` 无 sweep 相关错误（55 条既有错误全在
`test/probe-revolve-*` / `revolve-degenerate` / `smlib-kernel/circular-pattern-step`）；
`check-api-test-coverage --package=core`（baseline 已重生成）通过。
