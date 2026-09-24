# Agent Note：脚本面特征族（shell / draft / thicken / 修复薄包装）—— 收口

Status: implemented

[English](2026-09-24-script-face-feature-family.md) | 中文

## 问题

Phase 5 要把「按面/边选的特征族」放到脚本面：`shell`、`draft`、`thicken`、`filletVariable`，以及一组修复薄包装（`defeature`、`removeHolesFromFace`、`reverseShape`、`unifySameDomain`、`sew`、`sewAndSolidify`）。op 本身已经写了，但这一轮并没有真正收口：

- **`cad.draft` 在任何引擎上都不可用。** `api/draft.ts` 把 `pull` / `neutral` 以**元组**（`[0,0,1]`）交给 L1，而 L1 说的是 `BrepVec3 = {x,y,z}` 对象。内核读到的是零向量：occt 抛出无文案的 `KERNEL_ERROR: draft:`，brepkit 抛 `cannot normalize zero vector`。调用点上那两处 `as unknown as Parameters<typeof kernel.draft>[2]` 强转就是征兆 —— 类型之所以"对得上"，正是因为被强转打掉了。
- **occt 的 L1 `draft` 静默丢弃 `neutral`。** occt-wasm 原生签名是 `draft(shape, face, angleRad, direction)` —— 根本没有 neutral 形参 —— 但 L1 契约带着这个形参，适配器照收不误、不吭声。
- **三源一致守卫是红的。** 新 op 名已作为字面量键进了 `createApiNamespace()`，但符号表没重生成，`op-set-consistency` 报 `missing symbol for "shell"`。
- **`arg-spec` 记录过时**：已被手写模块取代的 op，条目还在描述"当初为什么做不了"。
- **验收是空洞的。** 测试在方案（§Phase 5.6）明确要求几何等价的地方只断言了 `toBeTruthy()`：`filletVariable` 在 `r1 == r2` 时必须与 `fillet` 等价；`shell` / `draft` 要有两引擎 parity。`draft` 与修复族则完全没有覆盖。

## 决定

1. **修 `draft`，不是绕开它。** `api/draft.ts` 显式把 `pull` / `neutral` 转成 `BrepVec3`（先例：`pattern.ts` / `api/helix.ts`），两处 `as unknown as` 强转随之消失。
2. **把 L1 的不对称改成"响的"，不是静默的。** occt 的 `draft` 适配器现在对**非原点** `neutral` 显式报错，而不是忽略它 —— 与 `occt-primitives.ts` 里 `interpolatePoints` 已有的规则一致（"宁可拒绝，也不静默产出错几何"）。同时 `draft` 拒绝 `neutral.normal`：两个引擎都不消费平面法向（occt 压根没有 neutral，brepkit 只收点），不拒绝就等于静默丢弃。
3. **分派声明维持这一轮的写法**：`shell` / `draft` / `filletVariable` / 六个修复包装是中立 op，经族级能力 `capabilities:['directEdit']` 路由；`thicken` 是平台 op（`engines:['occt']`），因为 `thickenWithHistory` 只在 occt 侧。
4. **校正 `arg-spec` 记录**：`shell` 补上 `reason`（被手写 op 覆盖 —— 同 `extrude` / `sweep` 口径；它保留 `kind:'brep-op'` 作为**vendored 面**的引擎记录）；`draft` / `thicken` / `removeHolesFromFace` 保持 `kind:'skip'`，但理由从"faijs 为什么做不了"改成"由哪个手写模块承担"。
5. **所有生成物重跑一遍**（`gen-l3-surface`、`gen-capability-map`、`gen-symbol-table`、`gen-api-dts`）。其中关键的是符号表 —— 它就是三源一致三元组的第三源。
6. **把验收提到方案的真实标准**，用实测数字替代 `toBeTruthy()`：`filletVariable(…, 2, 2)` 与 `fillet(radius: 2)` 断言**体积在 1e-6 内相等**（实测逐位相同，均为 991.4159）；`shell` 的两引擎 parity 按它真实的粒度断言；`draft` 加上"体积确实改变"的断言，它同时就是元组 bug 的回归守卫。

## 备选方案（及否决理由）

- **用逐核能力名（`capabilities:['draft']`、`['reverseShape']`…）替代族级布尔。** 这是符合红线的方向，能让静态门在 brepkit 上**执行前**拒绝，而不是运行时报错（见下方 GOTCHA）。本轮暂缓：`BrepMethodKind`（`brep/engine/types.ts:212`）目前不含 `draft` / `defeature` / `reverseShape` / `unifySameDomain` / `removeHolesFromFace`，occt 的 `methods` 名单也不含 —— 改动横跨类型联合与两个引擎声明。这属于跨切面决定，记为待办而不是我单方面拍板。
- **断言 `shell` 两引擎体积相等。** 按实测否决：同输入下 occt 2272、brepkit 1952 —— 两个内核的偏置语义不同。故 parity 只断言**包围盒一致** + **两侧都严格比原体薄**。
- **断言 `reverseShape` 后 `vol === 1000`。** 按实测否决：反转壳朝向会把**有向**体积翻成 −1000，守恒断言必须用 `|vol|`。
- **把 `neutral` 从公开的 `DraftParams` 里删掉。** 暂缓：方案明确写了它，删除属于面向用户的 API 决定。在拍板之前，显式报错至少让失败是诚实的。

## 影响

- `cad.shell`、`cad.draft`、`cad.thicken`、`cad.filletVariable`、`cad.defeature`、`cad.removeHolesFromFace`、`cad.reverseShape`、`cad.unifySameDomain`、`cad.sew`、`cad.sewAndSolidify` 均可从 `.fai.js` 触达。
- **GOTCHA（已由测试钉住）**：L1 的向量形参是 `BrepVec3` **对象**，不是元组；元组进内核就是零向量，直接死在里面。
- **GOTCHA（已由测试钉住）**：`neutral` 在两引擎间**并不对称** —— occt-wasm 原生 `draft` 没有 neutral 形参，occt 侧只能表达默认（原点）中性面，非原点值现在会显式报错。`neutral.normal` 两个引擎都没有消费者，同样报错。
- **GOTCHA（已由测试钉住）**：`cad.reverseShape` 会把**有向**体积翻号（box(10,10,10)：+1000 → −1000），不是缺陷，断言必须用 `|vol|`。另外 brepkit 的 `unifySameDomain` 会把体**重新居中**（`[0,10]³` → `[−5,5]³`）。
- **GOTCHA（已由测试钉住）**：BREP 句柄只在**创建它的内核实例**内有效。跨引擎比对必须在切引擎**之前**把该引擎的量测值取出来，否则第二个内核去解析第一个内核的 arena id，报 `invalid solid handle`。
- **待办（需你裁定）**：brepkit 侧族级布尔 `directEdit: true` 会放行随后在运行时失败的 op —— `draft` 返回**体积不变**的几何（静默无操作，正是"不静默产出错几何"红线针对的形态），`reverseShape` 抛 `invalid solid handle`。`feature-family.test.ts` 里两条 `it.skip` 记录了**正确**行为，让修法有靶子；修法形态见上面的备选方案。
- **已知输入侧缺口（存量，非本轮引入）**：brepkit 下 `cad.sketch` 与 `cad.edgeRef` 不可用，故凡以 sketch 面 / 边引用为输入的用例只跑 occt。引擎门用例改用 `cad.cylinder`（brepkit 声明了 `makeCylinder`），保证失败点落在被测 op 上。

## 验证

- `packages/core/src/api/feature-family.test.ts`（17 通过 / 2 跳过）：`shell` 薄壁（bbox + 体积上下界）、两引擎 bbox parity；`draft` 可达 + 体积改变守卫、角度 / `neutral.normal` / occt-neutral 三类拒绝；`filletVariable` `r1 == r2` ≡ `fillet`（bbox + 1e-6 体积）；`thicken` 面 → 实体，另含 D11-4（brepkit 执行前拒绝）与 D11-3（`brep_mock` 不拦截）；`reverseShape` 有向体积语义；`unifySameDomain` 体积守恒；`sew` / `removeHolesFromFace` 可达；`defeature` 空面表拒绝。
- 三源一致与面守卫全绿：`op-set-consistency`、`capability-map`、`arg-spec-capabilities`、`generated/surface-mechanism`、`api-dts-sync` —— 5 个文件 24 条。
- `tsc --noEmit`、改动文件的 `eslint`、`scripts/check-platform-imports.mjs`（689 文件 / 182 平台，0 违规）均干净。
