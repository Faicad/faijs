# Agent Note：pipeAlong —— 一次调用完成多段空心管扫掠

Status: implemented

[English](2026-11-16-pipe-along-multi-segment-sweep.md) | 中文

## 问题

把等截面沿多段三维中心线扫成管件，此前只能手工做：把路径拆成单段 wire、每段各造一个截面、
用平移把它摆到该段起点、逐段 pipe，最后 union。case8 图纸（U 形管，长腿顶端还转出 U 平面
接一段横管）就需要五段。

三条内核事实决定了它必须这么写：

- `pipe` / `sweepPipeShell` / `sweepFull` 都只接受**一个**截面句柄和**一条**脊柱，而且 `pipe`
  从不搬截面：调用方必须自己把截面放到脊柱起点坐标系上。`sweepAdvanced` 能搬，但必须
  `withContact` **和** `withCorrection` 同时给（只给 `withContact` 只是把截面滑到贴住脊柱，
  并不转正）。
- **G0（有折角）**的脊柱会丢实体体积：默认 `transitionMode: 'transformed'` 下，截面在折角处停止
  旋转，整个扫掠退化成平移——两段 90° 折线只剩「面积 × 首段长」（= 按弧长算的 50%），15° 折角
  保留 98.3%，正好从 5% 体积守卫底下溜过去。G1 脊柱（真弧、弧+直线相切、共线多段）全部精确，
  所以这是**转角处理的默认值**问题，不是曲率能力问题。实测表见
  `test/api/sweep-kernel-behavior.test.ts` K1–K4。
- 带孔面截面会整个丢掉内腔：`toProfileWireView` 只取外环，于是 `sweepAdvanced` 扫出实心棒而
  不是管。

## 决定

在 `api/solid-offset/index.ts` 新增 `cad.pipeAlong(section, spine, opts?)`：

1. 把脊柱拆成边（`getSubShapes(wire, 'edge')`）；顺序无关——每段独立扫掠后 union。
2. 每段读起点与起点切向（`curveParameters` + `curvePointAtParam` + `curveTangent`），构造 12 元
   仿射矩阵，把截面的局部 XY 坐标系搬到该点、法向取切向，并让截面包围盒中心落在中心线上
   （Pappus：体积 = 净面积 × 段长）。
3. 每段用 `kernel.pipe(face, segWire)` 扫掠，逐段保留既有的 `assertSweptVolumeMatches` 守卫
   （默认 5%）。
4. 孔环单独扫掠后从外环扫掠体减掉；复合结果再按面的净面积对账一次。
5. 各段 union。

`pipeAlong` 仅 occt 可用；`opts.closed` 目前直接拒绝
（`E_PIPE_ALONG_CLOSED_UNSUPPORTED`）。

`sweepAdvanced` 也沿同一条路径支持了带孔面：`toProfileRingsView` 返回全部环，
`sweepAdvancedBrep` 逐环扫掠并减掉孔环。单环（普通）截面保持与改动前逐字节一致。

同一批还落地了两件同源的事（都来自「有意粗扫 → 先出 STL 再判断」的流程）：

- **容差可逐次注入。** `assertSweptVolumeMatches` 新增可选 `volumeTolerance`（`(0,1)`）；
  `pipe`、`sweepAdvanced`、`pipeAlong` 以 `opts.volumeTolerance` 暴露它。进程级的
  `setSweepVolumeTolerance` 仍作默认。越界值抛 `E_SWEEP_TOL_INVALID`，不静默夹取；错误信息
  同时点出两条出路，并写明「放宽不修几何」。
- **截面定位只补文档、不扩接口。** `sketchOnPlane` 本就支持 `plane: { origin, normal, xAxis }`，
  截面可直接落在脊柱起点的坐标系上，既不用 translate 也不用新增 op。其 `@example` 现在演示
  这个用法（以及非对称截面必须给 `xAxis`），随生成器进手册，不必手改生成物。

## 备选方案

- **把全部环交给内核。** 否决：`sweepPipeShell(face)` 直接拒收 face
  （`BRepFill_Section: bad shape type of section`），而该族只吃一个截面句柄。
- **依赖 `withContact` / `withCorrection`。** 实测否决：两者合用确实能把一个截面搬到脊柱起点并
  转正，但有折角的路径需要**逐段**一致的坐标系；另一条候选 `transitionMode: 'roundCorner'` 在
  密集折角上直接抛 `Geom_RectangularTrimmedSurface`。
- **整条多边脊柱一次扫掠。** 实测否决：默认转角过渡下只保留 50%（90° 折角）/ 63.7%（密采样
  弧）；`rightCorner` 能到 94–100%，但在折线路径上并不精确。
- **先让各段略微重叠再 union。** 否决：共面接缝本身已能精确 union（已验证），加一个凑数的
  epsilon 只会引入误差。
- **给 `pipe(profile, spine, { autoContact })` 加参数。** 不采用：`pipeAlong` 已经逐段摆放截面，
  在已验证的单段 op 上再加一个搬截面开关属于多余的接口面积。

## 测试

- `test/api/sweep-hollow-pipe.test.ts` 的 F1–F3 钉住内核事实（带孔面丢内腔；折线与相切多段脊柱
  丢体积；环扫后布尔减能恢复内腔）。
- G1/G2：三段 U 形一次调用，实心与圆环截面的体积都精确。
- G4：case8 三维路径（短腿 → 180° 弯 → 长腿 → 转出弧 → 横管）配 Ø17.3/Ø13.3 圆环，bbox
  90 × 95 × 180、体积 34862.09（解析值 34863.9），与先前交付的五段版一致。
- G3：`opts.closed` 以专用错误码拒绝。
- P2g1–P2g4：默认 5% 仍拦折线；`volumeTolerance: 0.6` 放行同一次调用，但体积仍是解析值的
  50%（放宽不修几何）；`pipe` 同一选项生效；`1.5` / `0` / `-0.2` 抛
  `E_SWEEP_TOL_INVALID`。
- P1a–P1c：`sketchOnPlane({ plane: { origin, normal } })` 把截面直接放在脊柱起点（体积 =
  面积 × 长，无需 translate）；截面留在原点会被守卫拦；显式 `xAxis` 钉住非对称截面朝向。
  P1a 同时钉住 `xAxis` 的自动推导规则（normal 为 `+Y` ⇒ 局部 `+X` 落在世界 `+Z`）。

## 后果

- **归因（2026-11-16 实测，`test/api/sweep-kernel-behavior.test.ts`）：** 内核不是瓶颈。G1 脊柱
  精确（真弧、切成两段的弧、相切弧+直腿、共线多段——全部 = 面积 × 长度的 1.0000），内核自己的
  转角处理也是对的（单拐角 90° 用 `rightCorner` 精确）。真正坏掉的是 faijs 层的三个决定：只取
  外环的截面、G0 脊柱上用 `transformed` 默认值、不搬截面。所以 `pipeAlong` 是**折角场景的绕行
  方案**，不是内核能力的替代品。
- `pipeAlong` 还顺带暴露了另一个独立缺陷：两个 G1 相切的扫掠实体做 `union` 会静默只返回其中
  一个（脚本层 `cad.union` 同样复现；不相交实体则正常）。已钉成 K7，保持 OPEN。
- case8 的 `part-along.fai.js` 一次调用得到同一实体；`faijs run` 导出水密 STL，0 非流形边，
  bbox 与体积一致。
- 每次调用是「每段一次扫掠 + 一次 union」；管件量级的零件可以接受。
- 截面必须关于中心线对称：非对称截面在弧段上会破坏 Pappus 恒等式，被守卫拒绝而不是静默漂移。
- `circleArc` 的角度基准不是「0° 指向 +X」：`axis = (0,-1,0)` 时 0° 指向 −Z、90° 指向 +X，
  负的终止角还会被归一化成更长的扫掠。写 U 形弯应优先用
  `tangentArc(start, tangent, end)`；该约定由 G0e 钉住。
- `docs/ops-api-inventory.md` 未重新生成：其生成器在本次改动前就已经失败——`validateSolid`
  没有章节（手册 172 章 vs 符号表 173 个 op）。在该既有缺口关闭前，`pipeAlong` 的 JSDoc
  是权威说明。
- `sweep` 暂未暴露 `volumeTolerance`：方案把该选项限定在 `pipe` / `sweepAdvanced`（外加
  `pipeAlong`）。后果在 HEAD 上可见：`test/api/sweep-mesh-winding.test.ts` 有两条本就失败的
  用例（折线脊柱被 `sweep` 守卫按 58.3% 拒绝），问题来自 2026-11-15 的守卫提交，与本次改动
  无关；在 `sweep` 上补同一选项就是显然的修法。
