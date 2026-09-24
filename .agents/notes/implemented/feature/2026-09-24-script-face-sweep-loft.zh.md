# Agent Note：脚本面扫掠 / 放样族 —— 输入形态适配与平台 op 划分

状态：已实施

[English](2026-09-24-script-face-sweep-loft.md) | 中文

## 问题

上一轮给了脚本面**造出** wire 的能力（`wire` / `helix` / `sketch({as:'wire'})`），但**消费** wire 的那批动作仍然不可达。其中四个——`sweep`、`complexExtrude`、`twistExtrude`、`roof`——只以生成 compatOp 的形式存在，从未标记 `scriptFace`；`loft` 在 arg-spec 里是 `skip`。

真正的障碍**不是**实参借入。`sweep` / `loft` 当初的 skip 理由是「compat-op 模板无法数组借入」，但 `borrowDeep` 本就会递归借入数组与嵌套形状。障碍是**输入形态适配**：脚本面最自然的截面来源是 `sketch(...)`，它产出**面**；而 vendored `sweep(wire, spine, …)` / `loft([wire, …])` 只吃 **wire**。单柄借入的生成模板没有地方表达「面 → 外环」。先例早已存在：`fillet` 与 `extrude` 正因同一原因由手写 faijs op 覆盖。

## 决策

1. **手写 `api/sweep.ts` 与 `api/loft.ts`，定位为平台 op** —— `engines:['occt']`，不声明 `capabilities`（D11-7：二者互斥）。两者都经常规 L3 桥（`borrowBrepjsShape` → `callBrepjs` → `unwrapOrThrow` → `adoptEntity`）抵达 vendored 实现，并声明 `naming: {kind:'unmodeled'}`（扫掠体/放样体尚无面词汇表；先例 `torus`）。
2. **共用一条输入适配步径**：`api/internal/profile-wire.ts` 的 `toProfileWireView(section)`。1D 输入（由上一轮落地的判别位 `isCurveShape` 判定）直接借入；2D 面经 vendored `outerWire` 归约为**外环**（孔环被丢弃——扫掠脊柱 / 放样截面都是单一轮廓）。刻意做成叶子模块，使两个 op 不会漂移成两个判定点。
3. **所有权在该 helper 里写明**：`borrowBrepjsShape` 产出零拷贝**借用**（faijs `Shape` 仍持有所有权）；`outerWire` 产出 arena **新** wire，生命周期归 vendored finalizer。因此此处**不得** `unregisterFromCleanup` —— 那是**收养**路径的 R1 规矩，本条不是收养。
4. **不暴露 `shellMode`。** vendored `sweep(…, shellMode)` 返回 `[shell, startWire, endWire]` 元组，跨不过单产物边界（设计原则 5：多产物一律走具名 `outputs`，不用数组）。`loftAll`（返回 `Shape3D[]`）同理不暴露。
5. **`complexExtrude` / `twistExtrude` / `roof` 不需要手写 op。** 它们已是生成 compatOp，只是缺 `scriptFace: true`。收进脚本面是 arg-spec 的一个标记，不是新代码。
6. **校正过时的 skip 理由。** `loft` 转为 `skip`，理由改「由手写 `api/loft.ts` 覆盖」（`fillet` 先例）；`guidedSweep` / `multiSectionSweep` 保持 `skip`，但理由改为真实原因——数组借入本身无障碍，是 faijs 侧尚未写这两个 op（长尾，本轮不做）。
7. **重跑生成物**：`gen-l3-surface.ts`（script-face + manifest）、`gen-symbol-table.ts`（符号表）、`gen-api-dts.ts`（`api.d.ts` 内嵌的函数目录已过期）。

## 考虑过的替代方案

- **给生成器加一种「面 → 外环」输入模式。** 否决：生成器的价值在于统一单柄投影；per-op 适配钩子会把建模决策挪进代码生成。手写 op 才是这种情形的既定路线。
- **用 `capabilities:['sweepPipeShell']` 代替 `engines:['occt']`。** 否决：capability 路由用于**中立** op（任何 BREP 引擎都能跑，`roof` 就是现成例子）；引擎身份用于只在单一平台存在的 op。D11-7 规定二者互斥。
- **把 `shellMode` / `loftAll` 的元组、数组产物抬上脚本面。** 否决：违反设计原则 5。
- **给 `sweep` / `loft` 写 mesh 实现。** 否决：`BRepOffsetAPI_MakePipeShell` 与 `BRepOffsetAPI_ThruSections` 本质是 BREP-only，这正是平台 op 机制存在的理由。

## 后果

- `cad.sweep(profile, spine, opts?)` 与 `cad.loft(sections, opts?)` 可从 `.fai.js` 抵达。两者截面都接受 **wire 或面**；两者在当前引擎非 occt 时都于**执行前**被拒。
- `cad.complexExtrude`、`cad.twistExtrude`、`cad.roof` 可达。`roof` 保持中立（capability 路由，无引擎身份）。
- **测试钉死的 GOTCHA**：vendored `complexExtrude(wire, center, normal, profile?)` 的 `normal` 是**挤出向量**而非单位方向——传 `[0,0,30]` 即沿 +Z 挤出 30 mm；`center` 是脊柱起点。
- **测试钉死的 GOTCHA**：brepkit 的能力表没有 `makeWire`，所以 `cad.wire` 会在被测 op 之前就挂；引擎门用例的输入因而改用 `cad.cylinder`（brepkit 声明了 `makeCylinder`）。
- **测试钉死的 GOTCHA**：occt-wasm 3.x 缺 `sweepAdvanced`，vendored `sweep` 会丢弃 `transitionMode` 并发出一次性的 `console.warn`。CI 对任何 `stderr |` 行零容忍，故该告警被 spy **并逐条核对内容**（只容忍「occt-wasm 版本能力不足」这一族），不是全局静默。
- 顺带修复两处**本轮之前就已红**的仓库级守卫：`mesh/api.d.ts` 过期（已重生成）；`surface-mechanism.test.ts` 的 script-face kind 白名单早于「`query` op 上脚本面」那次提交——现已容纳 `brep-op` / `faijs` / `query`。
- 平台导入守卫（`scripts/check-platform-imports.mjs`）恢复干净：上一轮写的 `helix.ts` 导入了 `occt-kernel/*` 却缺必需的 `@platform occt` 标注。

## 验证

- `packages/core/src/api/sweep-loft.test.ts`（14 条）：截面为 2D 面（走外环适配）与截面为 1D wire 的 sweep；两个面截面与两个 wire 截面的 loft；扫掠/放样几何用 BREP 包围盒断言；`complexExtrude` / `twistExtrude` 可达；**每个** `engines:['occt']` op 在 brepkit 下均于**执行前**报 `op '<name>' requires engine occt`；sweep / loft / complexExtrude / twistExtrude 在 `brep_mock` 下**不被**平台身份判定拦截（D11-3 豁免）；`roof` 完全不做引擎门控（中立 op）。
- core 全量测试：140 个文件，1973 通过 / 10 跳过，0 失败。
- `faijs-extra` 的 `cad-membership`（10 通过）与集成测试 `faijs/p23-cad-face`（15 通过 / 1 跳过）全绿。
- `tsc --noEmit`、改动文件的 `eslint`、`scripts/check-platform-imports.mjs` 均干净。
