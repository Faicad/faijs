# Agent Note: 所有带量纲槽位全部声明 —— 不准裸数字，内部单位不再是契约

Status: implemented

[English](2026-10-21-dimensioned-slots-declared.md) | 中文

## 问题

2026-10-20 的草图回顾把角度单位分裂记成了**面向使用者**的契约：脚本面角度是度，但 `contours[].segments[].startAngle` / `endAngle` 与 `cad.boolean` 的 `options.simplifyAngularTolerance` 是裸弧度，且传错单位不会报错 —— 只会静默产出错误几何。

这个框架是错的。用户真正要的契约是：**带量纲的槽位不接受裸数字**。内部用度还是弧度属于实现细节，根本不该出现在契约里。按这个框架重新看，"裸弧度"不是需要记下来的例外，而是**未声明的槽位** —— 也就是量纲系统上的洞。

据此拆出两个不同的缺陷：

1. **67 个数值参数未声明。** `check-op-dims.mjs`（2026-10-10 那条守卫）只强制 `paramDims` 的**存在**，从不检查它的**覆盖**，所以 `paramDims: {}` 能通过 CI 而实际上什么都没声明。未声明的槽位对量纲通道是不可见的：裸数字直接通过，值按内部碰巧使用的单位被消费。
2. **量纲通道不在执行路径上运行。** `check()` 给 `extractMetadata` 传 `opDims`，`executeDirectText` 不传。所以"不准裸数字"只在 dry-run 里生效，脚本真正执行时被静默豁免。

## 决定

**声明每一个数值参数，并让那两个弧度槽位变得和其它角度槽位一样。**

- `contours[].segments[]` 拿到递归 `DimSpec`（`contoursDimSpec()`，`sketch/dim-spec.ts`）：坐标与半径是 `length`，弧的 `startAngle` / `endAngle` 是 `angle`，样条的 `knots` / `degree` / `multiplicities` 是 `plain`。以 `spec` 挂到 `cad.profile`、`cad.punchHole`、`cad.sketchOnPlane`、`cad.sketchOnFace`、`cad.sketchOnSurface`。
- 由于角度基准单位是度（`DEGREE = 1`、`RADIAN = 180/π`），把这些槽位声明为 `angle` 意味着到达的值是度。`contourAnglesToRadians()`（`api/profile.ts`）在**每个 op 入口**换算一次 —— 绝不放进 `profileSegToCurve`，后者被非脚本调用方、以及内核产出的 `extractContours`（弧度）共用，在那里换算会把它们换算两次。
- `cad.boolean` 的 `simplifyAngularTolerance` 声明为 `angle`，在 op 入口用 `fromBase(…, 'radian', 'angle')` 换算。
- 其余 65 个槽位按各自量纲声明，或显式声明 `plain`。
- `check-op-dims.mjs` 增加**规则 3（穷尽性）**：声明了 `paramDims` 的 op，其 JSDoc 里每个 `@param … type:number` 都必须出现在 `paramDims` 中；`plain` 视为满足。这才让这条不变量能长期成立，而不是只对一次。
- 往这些槽位传弧度的脚本迁移为 `* RADIAN`（内核原值保持逐位不变），或取整的度数。

**执行路径的缺口本次刻意不合上。** 实测：把 `opDims` 接进 `executeDirectText` 会让 **133 个文件、703 个测试**失败 —— 现有语料通篇写裸数字（`cad.box(20, 20, 20)` 之类）。`docs/api-contract.md` §15.2 的契约此前一直是名义上的；要让它真正生效是一次语料迁移，且对所有产出 `.fai.js` 文本的宿主是破坏性变更 —— 这是给用户的决策，不是 bug 修复。该缺口连同实测数字记在 `runtime.ts` 的调用点注释与 §15.4。

## 被否掉的替代方案

- **继续把弧度槽位当作例外记下来。** 否：这正是用户纠正的那个框架。一个静默接受裸数字的"例外"**就是**那个 bug。
- **把 contour 角度声明为 `plain`。** 否：`plain` 的含义是"刻意无量纲"，而弧的扫角是带量纲的。那样做只是让新门禁闭嘴，陷阱还在。
- **在 `profileSegToCurve` / `toContourBlueprints` 内部换算。** 否：这些 helper 与内核产出的轮廓（`extractContours`，弧度）以及直接 TS 调用方（如 `sketch-on-plane-open-wire.test.ts` 里的 `buildSketchOnPlaneWith`）共用。入口换算保证"脚本面 ⟷ 内部"只有一道边界；那个测试一行未改仍通过，就是边界位置正确的证据。
- **现在就把量纲通道接到执行路径。** 带测量数据推迟，不是否决：703 个失败是迁移工程，且会打断产出脚本文本的宿主；悄悄做等于把一次大的破坏性变更当作契约修复的副作用发出去。
- **不加规则 3，靠评审。** 否：这 67 个洞本身就证明评审抓不住。守卫很便宜（已经在同一棵 AST 上走），并且已验证抽掉一条声明时会真的报错。

## 后果

- 声明了 `paramDims` 的 op，其每个数值参数都有了交代，并由 CI 强制。
- 往 contour 弧角或 `simplifyAngularTolerance` 传裸数字，现在是"声明槽位违规"，而不是静默产出错误几何。
- **五个 contour op 的脚本调用方行为变更**：弧角现在按度读。直接 TS 调用方（`buildProfileShape`、`toContourBlueprints`、`buildSketchOnPlaneWith`）仍传弧度、不受影响 —— 这个不对称是刻意的，且已记录。
- 内部单位不再属于契约：`docs/sketch-contract.md` §2 删掉了"裸弧度"两行，改为陈述规则（写"量"）与换算位置。
- 测试：4880 通过、4 失败 —— 与干净 HEAD 检出上的 4 个一致（`case2-load-stl-cylinder-assembly` ×2、`engine-verdict-equivalence` ×2），是用 `git worktree` 建 HEAD 副本实测对照的，不是想当然。
