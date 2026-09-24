# Agent Note：脚本面造线 —— 1D `curve` 形态与 `wire` / `helix` op

Status: implemented

[English](2026-09-24-script-face-wire-creation.md) | 中文

## Problem

`.fai.js` 脚本面**造不出 wire（1D 曲线）**。对整个面的普查发现没有任何一个 op 输出它：`sketch` 内部造了 wire（`loopToWire`），但只交出 face；`line` / `circle` / `arc` / `bezier` / `wire` / `helix` / … 在 arg-spec 里全是 `skip`，理由清一色「→ Edge/Wire 子形状产物，faijs 整件面不承载」。结果是一整族特征——`sweep`、`complexExtrude`、`twistExtrude`、`roof`、`helix` 等共 11 个动作——**登记了却喂不进输入**：它们的输入侧要 wire，而脚本永远造不出来。

模型层卡着两处：(1) 没有任何 shape 判别位表示「1D」；`ShapeKind` 声明了 `'curve'` 却零引用，而所有构造器产物一律自称 `kind:'solid'`。(2) BREP 登记管线只有单一入口 `fromBrep(mesh, holder)`，硬绑 `solid(mesh)`——即便 1D 产物本身正确，也会被标成 `'solid'`（这是假话：wire 的三角载荷实测为空，positions 0 / indices 0，且不抛错）。

## Decision

1. **1D 判别位 = `kind:'curve'`，维持「有无三角载荷」语义。** `kind` 是载荷类别标签，不是拓扑维度。1D 产物因此取自己的 kind，而不是被错标成 `'solid'`。`CurveShape` 加入 `StdShape` 联合；结构判定 `isCurveShape(v)`（与 `isCompoundLike` 同族，不做 `WeakSet` 严格化）回答本轮唯一需要的问题：「是不是 1D」。
2. **登记管线做泛化，不做复制。** `fromBrep` 重构为 `solid(mesh)` + 新的私有 `attachBrep(s, holder)`，由后者承载四步登记（身份槽、血缘语句键旁挂、函数 BREP 域登记）。两种形态共用它：`curve(mesh)`（与 `solid` 对称）与 `fromBrepCurve(mesh, holder)`（与 `fromBrep` 对称）。brep 与 mesh 两条路径都走同一份代码，形态之间不可能漂移。mesh 侧由 op 实现返回已包装的 `curve(mesh)`；`wrapMeshOne` 靠 `isShape` 短路，kind 得以保留，**无需改 `define-op.ts`**。
3. **新增手写 op。** `wire(points, {closed?, smooth?})` 是**中立** dual op：mesh 路径返回折线载荷、经 `curve(mesh)` 包装；brep 路径用 L1 造边（`makeLineEdge` / `interpolatePoints`）再 `makeWire` 成线，经 `fromBrepCurve` 登记。`helix({radius, pitch, turns, axis?, origin?})` 是**平台** op（`engines:['occt']`，不声明 `capabilities`——D11-7 互斥）：L1 没有螺旋线构造器，occt-wasm 有原生 `makeHelixWire`，故由 op 自证平台身份，非 occt 引擎在执行前被分派层拒绝。
4. **`sketch` 增出线形态。** `sketch({contours, as:'face'|'wire'})` 复用既有 `loopToWire`，`as:'wire'` 时把外环作为 1D 曲线交出（孔环丢弃——扫掠脊柱是单闭合轮廓）。缺省仍是面。
5. **面消费 op 在触内核前拒绝 1D 输入。** `extrude` 预检 `isCurveShape(input)` 并抛 `E_EXTRUDE_NEEDS_FACE`。把 wire 喂给面 op 必须是确定性的**内核前**拒绝，绝不落进几何内核深处才报「extrusion operation failed」。
6. **命名与显示。** 1D op 声明 `naming: {kind:'unmodeled'}`（wire 无面 → 无角色表；先例 `torus` / `convexHull`）。1D shape 是合法终结产物；其显示取 L1 `wireframe(shape, deflection?)`，不做伪三角化。

## Alternatives considered

- **把 `kind` 改成拓扑维度（2D / 1D / 3D）。** 否决：这是更大的模型改动，而本轮只需要一个 bit——「是不是 1D」。载荷类别语义已是既有口径，改成维度会迫使所有既有读者重新推导它原本的含义。
- **保留 `kind:'solid'`，另加一个维度标记位。** 否决：同一事实两个真源；而且对空载荷的 wire 而言 `'solid'` 本身就是假话。
- **`wire` 只做 brep（不给 mesh 实现）。** 否决：那样 kind 在 mesh 模式下将不可得（或含混），而方案要求同一 op 两种 mode 下 kind 一致。dual 实现配 `curve(mesh)`，由「两种 mode 下 kind 一致」的测试专门钉住。
- **在每个面 op 里用内核拓扑查询判 1D 输入。** 否决：昂贵且分散；`kind` 判别位是廉价的静态预检，与 BREP/mesh 静态路由同一精神。
- **在 manifold（mesh）侧重造 wire 几何。** 否决：下游没有任何 wire 的 mesh 消费者；折线载荷足以维持 kind 一致，重造曲线等于给一个符号写第二份实现。

## Consequences

- `cad.wire(...)`、`cad.helix({...})`、`cad.sketch({..., as:'wire'})` 在 `.fai.js` 中可达；它们解锁扫掠 / 放样族（在后续阶段实现）。
- 1D shape 是真正的终结产物，三角载荷为空。显示走 `wireframe`；STL 导出按构造为空，而 STEP 路径是 BREP（occt 能写 wire）——两条导出路径按设计不同，本条目不做统一。
- 把 1D 产物喂给面 op 会在预检处失败并给出具名错误，而不是在内核内部失败。
- 三源一致成立：符号表已重生成（`wire` / `helix` 进入），并顺手补掉一处既有缺口——`split` 已在 `cad` 命名空间里，却漏在 `api/index.ts` 的导出面上。
- `helix` 的几何契约由测试钉死：`radius` 决定 XY 包络为 ±radius；`pitch × turns` 决定轴向高度，自原点沿轴起算（`origin` 缺省为原点，`axis` 缺省为 +Z）。

## Verification

- `packages/core/src/api/wire-helix.test.ts`（10 条）：`wire` 可达 + `kind:'curve'`；brep 与 mesh 两种 mode 下 kind 一致（并断言 mesh 载荷为有限值——这是对一处「按元组取 `{x,y,z}` 字段导致载荷全 `NaN`」回归的守卫）；`E_WIRE_TOO_FEW_POINTS`；`wire → extrude` 于内核前失败并报 `E_EXTRUDE_NEEDS_FACE`，且**不是** `EXTRUDE_FAILED`；L1 `wireframe` 显示供给得到非空、有限的点列；`helix` 可达 + `kind:'curve'`；螺旋线 bbox 钉死 radius / pitch / turns 语义；`brepkit` 下 helix 执行前报「requires engine occt」；`brep_mock` 下 helix 不被平台身份判定拦截（D11-3 豁免）；`sketch as:'wire'` 得 `kind:'curve'`。
- 三源一致：重生成后 `src/lang/op-set-consistency.test.ts` 通过。
- 受影响套件通过：`op-set-consistency`、`sketch`、`extrude-upto`、`extrude-roles`、`wire-helix`（共 29 条），外加集成测试 `faijs/p23-cad-face` 与 `faijs-extra` 的 `cad-membership`。
- 改动文件 `tsc --noEmit` 与 `eslint` 干净。
