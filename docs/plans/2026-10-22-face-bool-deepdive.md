# 2026-10-22 face 模型"为什么还慢"深度诊断（第二阶段）

> 前置：`docs/plans/2026-10-21-weapp-tessellation-defer-plan.md`（第一轮 defer + angular 落地，
> 端侧 64,581ms → 31,927ms，-50.5%）。本文回答"为什么电脑 30s / 真机 100s 仍不可接受"，
> 记录第二阶段全部探针矩阵与结论。探针均在 `packages/core/test/perf/`，跑法：
> `npx vitest run --config vitest.perf.config.ts <probe>`。

## 1. 结论先行

**34s（端侧 execute，defer + angular 2π/32）的构成 ≈ brepkit 内核布尔 ~28s（82%）+ 语句/变换开销
~4s（12%）+ 收尾下游 ~2.5s（7%，含 meshShape 0.75s + 拓扑 1.6s + 序列化）。**

- 三角化（第一轮的优化目标）已不是问题：13 终端 meshShape 合计 **745ms**。
- 拓扑构建（face 表/指纹/邻接）**1.6s**：`topo=auto 34,284ms` vs `topo=off 32,704ms`（差 4.6%）。
- 布尔是绝对主导：`subtract(head, eL, eR, mouth)` ≈ 14s、`union(8体)` ≈ 14s（stage 增量口径，
  各自占对应 stage 的 ~88%）。每次 cut/fuse 的内核数值求交成本 ~3s 是 **brepkit 引擎固有**，
  与三角化、段数、输入顺序无关（见 §3）。

**真机 >100s = 桌面 ~34s × ~3.2x**（手机 wasm 算力差距 + 首次实例化/编译）。要达成
"电脑 30s 不可接受"的目标，唯一有效杠杆是把布尔从 ~28s 降下来——**这超出 faijs 现有 API
能力**，已系统性排除的改法见 §3，剩余方向见 §4。

## 2. 数据口径

| 口径 | 数值 | 说明 |
|---|---|---|
| 端侧 execute（当前 bundle，5 轮中位） | 31,927ms | 0.37.0，defer + angular 2π/32，13 终端 |
| node 探针 execute（defer + 2π/32，topo=auto） | 34,284ms | 本机噪声 ±30-50%，趋势一致 |
| 同配置 topo=off | 32,704ms | 拓扑成本 ≈ 1.6s |
| meshShape 13 终端合计 | 745ms | 三角化已不是瓶颈 |
| boolonly：8 球+变换（无布尔） | 5,661ms | 非布尔基线 |
| boolonly：8 体 union 增量 | 17,066ms（75.1%） | 布尔主导 |
| boolonly：4 体 subtract 增量 | 21,130ms（78.9%） | 布尔主导 |
| stage 增量：subtract / union 各自单条 | ~14s / ~14s | 前缀重放口径 |

注：本机负载噪声大（同实验不同时段 ±50%），跨轮比较只认相对结论（探针内对照），
绝对值仅供参考。

## 3. 探针矩阵：已系统性排除的 faijs 侧改法

| 探针 | 内容 | 结果 | 裁决 |
|---|---|---|---|
| ellipsoid-boolean-probe | scale3d(sphere)→原生 makeEllipsoid（修正平移后） | B/A=0.961（cut 合计 6,747→6,481ms），网格顶点比 0.985 | **放弃**（~4%，且需 peephole 判定） |
| batch-boolean-probe | fuseAll（union 批量入口） | 直接抛 `invalid input: cluster fuse degraded to mesh fallback` | **死路** |
| batch-boolean-probe | compoundCut（subtract 批量入口） | 顺序 cut×3 8,871ms vs compoundCut 8,864ms = **1.00x** | **死路** |
| segments-boolean-probe | makeSphere 段数 8/16/32/64/128 | cut 3.08/2.76/3.05/3.76/4.95s；8/16 不比 32 快 | **无关**（数值鲁棒性主导） |
| union-order-probe | union 输入重排（小体先并） | 1.61x 加速（24.9→15.4s）但**结果顶点 4,279 vs 原序 11,915，几何错误** | **严禁重排**（brepkit 布尔结果依赖输入顺序） |
| face-tessellation-probe（FACE_TOPO） | topo=auto vs off 隔离拓扑成本 | 34,284 vs 32,704ms（差 4.6%） | 拓扑不是瓶颈 |

结论：布尔成本是 **brepkit 内核数值求交** 的固有行为。faijs 侧所有包装层（defer/angular/缓存/
顺序/批量/几何等价替换）均无法显著改变它。

## 4. 剩余方向（未实施，按预期收益排序）

1. **brepkit 内核布尔优化（引擎级，收益最大）**：~28s 是内核求交成本。方向：
   - 更快的 NURBS 求交 / 球面分析布尔特判（内核识别 sphere/ellipsoid 面，走解析求交而非通用 NURBS）；
   - 上游 brepkit 版本升级若含布尔加速，直接受益。
   风险：超出 faijs 仓库边界，需要单独评估（内核是 Rust/wasm，`brepkit-wasm` 包）。
2. **增量 update 复用未变终端（faijs，编辑场景）**：真机每次编辑 = update 重放后缀 + 重建全部
   13 终端 outputs（~2.5-5s 桌面）。若 statementCache 已缓存的终端 solid 不变，复用上一次的
   物化 mesh/拓扑/wire，setColor 类编辑可降到 ~100ms。**注意**：update 的瓶颈同样被后缀里的
   布尔主导（改布尔前的语句 = 重跑全部布尔），此方向只优化"布尔之后"的编辑。
3. **收尾序列化（faijs，~1s 级）**：mesh 走 JSON 字符串（`tessellateSolidGrouped` 返回 JSON +
   `JSON.parse`）+ 13 终端 wire 序列化 → 二进制 TypedArray 传输。收益小（报告 §2.3 口径，
   在 defer+angular 后 ~1s 级）。
4. **预期管理/交互层**：打开模型时先显示部分终端（布尔前的头），布尔结果流式到位；
   或 loading 进度条按 stage 展示，避免"100s 白屏"体感。

## 5. 建议

- 电脑 30s → 10s 以下的唯一现实路径是 **方向 1（内核）**；faijs 侧能再榨的是 **方向 2（编辑
  场景 UX）**。若用户在真机上主要是"打开模型等 100s"，应先解决内核；若主要是"改一句等十几秒"，
  方向 2 立即可做（faijs 内，风险可控）。
- 本轮不做任何会改变几何/面序的投机优化（union 重排已证明会产生错误几何）。
