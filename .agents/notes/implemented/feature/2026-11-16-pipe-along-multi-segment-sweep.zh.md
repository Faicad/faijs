# Agent Note：sweepAlong —— 三维扫掠的「事实 → 策略 → 执行 → 判据」四段

Status: implemented

[English](2026-11-16-pipe-along-multi-segment-sweep.md) | 中文

## 问题

把等截面沿任意三维中心线扫成实体，此前会**不出错地**给出错几何：丢体积、丢内腔、管位置错、
静默少一条腿。第一版（`cad.pipeAlong`）用「拆段 + union」绕过了症状，但归因不完整——把
六条互相独立的 faijs 层缺陷算到了内核头上：

- **R1 截面从不落到路径上。** `MakePipe` / `MakePipeShell` 只在调用方放的位置扫。截面在原点、
  脊柱从 `z=90` 起，管就绕着原点扫出来；体积恒等式照样通过，只是管在错的地方。
- **R2 缺省转角过渡是 `transformed`。** 遇到 G0 折角，截面在拐点停止旋转，整段退化成平移体：
  90° 折角实测 0.5000，4 段折线弧实测 0.6366（= 2/π）。
- **R3 混合边类型要逐段扫。** 弧 + 直腿一次扫会算错；上一版笔记记的是
  「V = 面积×(弧长 − 腿长)」，实际那是**截面未落位**（R1）的产物——截面落位后同一次扫掠是精确的。
- **R4 带孔面被缩成外环**，于是 `sweepAdvanced` 扫出实心棒而不是管。
- **R5 判据只有体积。** 15° 折角只偏 1.70%，落在 5% 容差内，产物却是压扁的平移体；混合边类型
  丢整条腿体积差 78%，但 bbox 只少一条腿。
- **R6 扫之前没人看脊柱。** 断裂／折返／退化的脊柱直接送进内核，失败消息既不说原因也不说怎么改。

## 决定

把扫掠拆成四段，各占一个模块，各自可独立测：

1. **事实** —— `api/internal/spine-analysis.ts`。`analyzeSpine(api, wire)` 读出：边、边类型
   （`line`/`arc`/`other`）、端点、端点切向（数值单侧差分，**不**读内核 `curveTangent`）、边长、
   弧半径、G0 折角（`turn > 1e-3 rad`）、断裂、闭合、折返（`turn > 175°`）、退化边。只读：
   借用的子形状句柄全部释放，不构造几何，不抛业务错误。
2. **策略** —— `api/internal/sweep-strategy.ts`。`selectStrategy(facts, req)` 把事实映射成
   `single` / `miter` / `segments` / `closed`，或按 `E_SPINE_EMPTY` / `E_SPINE_DEGENERATE` /
   `E_SPINE_DISCONTINUOUS` / `E_SPINE_FOLD` / `E_SPINE_MIXED_CORNER` /
   `E_SPINE_MITER_SELF_INTERSECT` 拒绝。硬拒绝排在最前，`opts.strategy` 也绕不过去。
3. **执行** —— `api/solid-offset/index.ts` 的 `sweepAlongBrep`。`single` / `miter` / `closed`
   走一次内核扫掠；`segments` 逐边扫再 `fuse` 共面接缝；带孔截面逐环扫、孔环 `cut` 掉。落位由
   `api/internal/section-placement.ts` 负责（最小旋转，保留面内朝向，bbox 中心压到路径上）。
4. **判据** —— `api/internal/sweep-guard.ts`。C1 体积恒等式（缺省 5%，可逐次注入）、C2 端面法向
   与端点切向夹角 ≤ 1°、C3 产物包围盒覆盖脊柱包围盒、C4 策略层拒绝。`strict:false` 把 C2/C3
   降级为 `setSweepNoticeHook` 的通知，C1 永远抛。

`cad.pipeAlong` 重命名为 `cad.sweepAlong(profile, spine, opts)`：旧名强调的是 "pipe"，而 op 现在
覆盖 `single` / `miter` / `segments` / `closed`。三个旧入口收窄而不是继续留着当陷阱：

- `cad.pipe` 直接拒绝多边／G0 脊柱（`E_PIPE_SPINE_UNSUPPORTED`）——`MakePipe` 没有过渡入口，
  这类脊柱只可能长出平板。
- `cad.sweepAdvanced` 的 `transitionMode:'auto'` 由脊柱事实解析（有 G0 折角 ⇒ `rightCorner`，
  全 G1 ⇒ 内核缺省），并新增 `autoPlace` / `strict`。旧行为仍可由显式
  `transitionMode:'transformed'` 复现。
- `cad.sweep` 保持两内核选项交集，因此只判 C1。

## 备选方案

- **保留 `pipeAlong`（永远逐段）。** 否决：逐段扫在每个 G0 折角处留 V 形缺口（4 段／16 段实测
  0.8968 / 0.8801），而一次斜接扫给 0.9936 / 0.9996 —— 只要脊柱有折角，逐段一定更差。
- **用 `withContact` / `withCorrection` 解决落位。** 否决：`withContact` 只把截面滑到贴住脊柱
  （管心偏一个截面半径），两者都不管面内朝向，非对称截面会被拧。落位算成一次 12 元矩阵
  （`sectionPlacementMatrix`），`sweepAlong` 与 `sweepAdvanced({autoPlace})` 共用。
- **靠放宽体积容差。** 否决：放宽只是遮住几何，15° 折角证明指标本身是瞎的。C2 存在的理由就是
  「体积看不出截面没转」。
- **用内核 `curveTangent` 读切向。** 否决：在这套 occt-wasm 绑定上，先 `curveParameters` 再
  `curveTangent` 会让**后续**的 `sweepFull` 失败；数值差分只损失 1e-3 的弧半径精度，换掉这个交互。
- **拒绝闭合中心线。** 被实测推翻：整圆脊柱一次内核扫掠就是对的（环面体积 = 面积 × 周长），
  所以 `closed` 成了策略而不是拒绝。
- **保留 `pipeAlong` 别名一个 minor。** 不采用：该符号从未发布。

## 后果

- **一次调用就对**：`cad.sweepAlong` 在单弧／折线／混合 G1／闭合脊柱上分别是解析体积的
  1.0000 / 0.9936–0.9996 / 1.0000 / 1.0000，带孔截面保住内腔。
- **报错自带原因与修法**：断裂脊柱报出两个端点与距离；混合+G0 说明两个问题需要相反路线；
  塌陷体报出端面法向偏离多少度并指向 `sweepAlong`。
- **归因更正**：此前「混合边类型丢一条腿」与「读过边数据后绑定层就坏」两条结论都是假象——前者是
  截面未落位，后者是测试脊柱本身断开（`circleArc` 角度：`axis = +X` 时 `0°` 落在 `+Z`，不是 `+X`）。
  两者都已钉住：`sweep-hollow-pipe.test.ts` F2b 对真正相切的弧+直腿扫出 1.0000；
  `sweep-kernel-behavior.test.ts` K9 在同一进程里先分析再扫同一条脊柱。
- **新增测试**：`test/api/spine-analysis.test.ts`（12 条）、`test/api/sweep-along.test.ts`（12 条）、
  `test/api/sweep-guard.test.ts`（10 条），另有 K1c / K2 / K4 / K9 重写。
- **`sweep` 仍没有 `volumeTolerance`**：该选项在 `pipe`、`sweepAdvanced`、`sweepAlong` 上。
  `test/api/sweep-mesh-winding.test.ts` 用文档化的 `setSweepVolumeTolerance` 出口把进程级容差
  设到 0.99，并额外钉住粗折线脊柱实测的 5/12 体积事实。
- **代价**：`segments` 是「每边一次扫掠 + 每个接缝一次 `fuse`」；`single` / `miter` / `closed`
  是一次扫掠加一遍判据。
