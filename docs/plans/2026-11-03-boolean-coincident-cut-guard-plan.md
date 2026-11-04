---
status: v5 全部收尾完成（2026-11-03：P0 L3 落地 + P1 提示规范化 + P2 门禁/单测/提交全部完成）
date: 2026-11-03
repo: faijs（packages/core）
来源案例: copy1（drawing/copy1/run/part.fai.js）round 8 —— 端部 6mm 减薄四轮反复后定位为「贴面减除」
关联: 2026-10-28-boolean-operand-validation.md（相邻缺陷类：闭合性校验；本文档处理「共面/零体积相交」）
影响面: `api/boolean.ts`（subtract/boolean defineOp）｜ `api/boolean-op/index.ts`（booleanBrep 第二入口）
        ｜ `scripts/faijs-cli.ts` check 管线（L1 原落点，已取消）｜ `DrillHoleCore`（clearance 参照）
实施落点: `packages/core/src/api/internal/coincident-cut.ts`（新建：COINCIDENT_EPS / detectCoincidentShells /
          coincidentCutProtect）｜ `packages/core/src/api/boolean.ts`（booleanBrep cut 路径）｜
          `packages/core/src/api/boolean-op/index.ts`（BooleanOptions.clearance + callBooleanOp）｜
          `packages/core/src/runtime-state.ts` + `cad-runtime/runtime.ts` + `node-host/cli.ts`（P1 提示规范化）
验证（2026-11-03，全绿）: ① tsc --noEmit 全绿；② copy1 最终版零回归：run 零 warning + raycheck 21/21；
          ③ copy1 共面变体（③ 刀具体去掉手动出板余量：顶面贴板顶 z=8.0 / 外端贴板端 y=340.0）零 warning +
          raycheck 21/21 —— 无需自己检测/加余量即正确切除；④ 零体积探针：warning 触发 + 自动外扩 0.01，
          raycheck 4/4（0.01 深坑被挖出）；⑤ 单测 `test/boolean/coincident-cut-guard.test.ts` 7/7
          （判定范围钉死：零体积修正 / 侵入+贴齐不修正 / clearance:0 关闭）；⑥ **全量回归**
          `npm test -w @faicad/faijs` 421 文件 / 4484 通过 / 13 跳过 / 0 失败；⑦ **P1 提示规范化**
          （reportRuntimeNotice/takeRuntimeNotices 并入 result.infos，CLI ℹ 前缀报告，双端探针验证）；
          ⑧ **P2 openscad-port 门禁**：依赖升 faijs 0.45.20（新 tgz 含 L3）→ 全量 parity 50 ported 例
          PASS 41 / PASS-NT 8 / FAIL 1（Old/example017 既有共面残留结构性差异）与旧基线逐位一致
          （verdict_diffs=0）、**L3 命中普查 = 0**；⑨ **P2 内核级 e2e 单测** 7/7（双入口 +
          非轴对齐斜置三态 + clearance:0 关闭，`coincident-cut-guard-e2e.test.ts`）；⑩ 符号表重生成
          幂等（签名未变，无需重生成）；⑪ git 提交 8e0db0b。
判定范围实测定论（2026-11-03）: 只修正零体积相交（tool 底面贴 base 顶面 / tool 顶面贴 base 底面）；
          「tool 已侵入、面恰贴 base 表面」（槽底=板底 / 全厚贯穿孔）不修正——copy1 ⑤ 横带 / ⑦ 孔实证
          内核对贴齐共面处理正常，外扩纯属噪音。
设计变更记录（2026-11-03 用户裁定）: 原 L1（check 静态规则）/ L2（运行时零体积告警）独立检测层**取消**——
          L3 已默认修正，「暴露贴面」对正常脚本是噪音；L3 触发修正即「位置错误」信号，保留一行运行时提示。
          原 P1 重定义为「L3 触发提示规范化（挂进 check 报告而非裸 console.warn）」。
---

# 布尔减「贴面减除」防护：coincident-cut guard（L1–L4 四层）

## 0. 问题陈述：一个 1px 残留折腾了四轮

copy1 建模（`drawing/copy1/run/part.fai.js`）的端部 6mm 减薄区，布尔减后留「1px 薄壳残留」，
用户四次纠正（+0.1 → 全部方向 10 → 内部 0.1 → 长度方向内边切通 10）才解决。根因（已实证）：

- **看图零错误**：减薄深 6 / 余壁 10 / 内边 270 / 外端 340 全部读对；
- **写代码错在机理**：v1 刀具体底面 z=2.0 与余壁顶面**共面**、内边 y=270.0 与窗口端块邻界**共面**。
  `cad.subtract(part, tool)` 的 tool 与被减体**共面 = 相交体积为零**：数学上没有体积被减掉
  （只贴合、不侵入），内核在浮点容差下把「面贴面」残留成薄壳。这是**所有 CSG/B-rep 内核的
  数学性质**（OCCT / OpenCascade / FreeCAD 一致），不是内核 bug。
- **反证**：同文件其它特征（窗口 / 4×槽 / M3/M6 孔）全是**侵入式**减除（穿通全板），无一残留。

**faijs 现状**：高级 API 已内置规避（`DrillHoleCore.ts` "Add epsilon on both ends for clean
CSG cut"；`face-place.ts` 刻字 "±depth/2 + 0.01"；测试注释 "减掉 0.01 的避共面余量"），
但**裸 `cad.subtract` / `cad.boolean` 与 `faijs check` 不设防**——「贴面减除」这类高发错误
只能靠建模者自律。本文档给四层方案，把「靠人记得加余量」变成「**默认自动修正 + 编译器/
运行时诊断**」。

**设计原则（用户裁定 2026-11-03）：正确行为是默认，不是选项。**
`cad.subtract(part, tool)` 默认就检测共面并在共面处自动外扩 ε，用户零成本得到干净结果；
`options.clearance` 只用于覆盖数值（制造级余量）或显式关闭（极端场景），不再要求用户
「记得开启」。

## 1. 语义模型

- **布尔减的有效前提**：减除体必须**侵入**被减体（二者交集是**正体积**）。侵入方向任意
  （进入 base 内部、或越出 base 外表面均可），只要 tool 的每个外表面不与 base 表面**共面**。
- **共面（coincident face）**：tool 的某个面与 base 的某个面在同一平面上（距离 < ε，
  ε = `SEWING_TOLERANCE` = 0.01mm），且法向相反/同向贴合。此时两体相交体积为零，
  布尔减在数学上无定义 → 内核残留薄壳或拓扑退化。
- 与 2026-10-28「闭合性校验」的区别：闭合性是「操作数自身拓扑」问题（开放网格）；
  贴面是「操作数相对位置」问题（零体积相交）。两者互补，共用 `AUTHORED_LEAF` 式的
  内部标记机制与 `isClosedOperandForBooleanOp` 同类的判定点。

## 2. 设计（原 L1–L4 四层；2026-11-03 用户裁定取消 L1/L2，实际落地为 L3 修正层 + L4 固化）

### L1 —— `faijs check` 静态「贴面减除」规则（~~warning 级，默认开，零内核依赖~~）【已取消 2026-11-03】

> **取消理由（用户裁定）**：L3 已默认自动修正，「在建模时暴露贴面」对正常脚本是纯噪音；
> 修正本身已保证结果干净。本节保留作为设计历史。

（原设计：在 `scripts/faijs-cli.ts` 的 check 管线新增几何级规则（现有 check 是符号/语句级）：

- **可解析模式**：`subtract(base, tool)` 中 base 可追溯到 `box`（毛坯原语，copy1 模式），
  tool 是 `box` / `cylinder`（可含 `at` 平移）。解析式计算 tool 的六个外表面
  （cylinder：两端面 + 柱面），与 base 的包围盒面比对：**任一 tool 表面与 base 表面
  距离 < ε 且该方向 tool 未侵入 base 内部/未越出外部** → 报 L 级 warning：
  `coincident-cut：subtract 的 tool 第 i 面与 base 共面（零体积相交），布尔减将残留薄壳；
  请在该方向加侵入余量（侵入 base 内部或越出 base 表面 ≥ ε）。`
- **不可解析模式**（base 是复杂表达式 / tool 是布尔产物）：跳过，不误报（fail-safe）。
- 与 ffmt 的 L 规则同体系（warning 不阻断，但输出到 check 报告显眼位置）。

### L2 —— 运行时「零体积相交」告警（~~warning 级，默认开，O(1) 包围盒 + 可选精确~~）【已取消 2026-11-03】

> **取消理由（用户裁定）**：与 L1 同——L3 已修正，独立告警层不再必要；「侵入+贴齐」由
> 内核正确处理本就不该告警，「零体积相交」每次触发都伴随 L3 修正提示（见 L3）。本节保留作为设计历史。

（原设计：在 `api/boolean.ts` 的 `subtract` / `booleanBrep` 与 `api/boolean-op/index.ts` 的
第二入口统一加检测（两处都拦，参照 2026-10-28 §11.1 的双入口教训）：

- **O(1) 包围盒交叠检测**（默认）：对每对 `(base, tool)`，检查 tool 的包围盒在 x/y/z
  三个轴向上与 base 包围盒的交叠深度。若 tool 完全在 base 外（任一轴交叠 ≤ 0）→
  不可能产生有效减除，输出结构化 warning（含语句号 / op 名 / 两体包围盒）。
  共面贴合（交叠恰为 0）在此命中。成本：每 subtract 一次包围盒计算，毫秒级。
- **精确面距离检测**（`cad.setCoincidentCutGuard('strict')` 或 debug 模式开启）：
  对 tool 每个面到 base 每个面做距离查询（内核已有能力），距离 < ε 且共面 → warning。
  默认关（成本高）；L1 已拦住的常见情形不必走它。
- **不阻断**：真实场景存在「贴面定位」（如凸台贴合装配基准、分离面）——warning 而非
  error，建模者可显式豁免（`// [build] coincident-cut: 已知贴面，豁免` 注释级豁免，
  与 ffmt 的豁免注释同模式）。

### L3 —— API 免疫：`cad.subtract` / `cad.boolean` **默认自动规避共面**（默认处理对）

**设计原则：正确行为是默认，不是选项。** `cad.subtract(part, tool)` 默认就检测
tool 与 base 的共面面，在共面处自动外扩 ε（侵入 base 或越出 base），用户**不需要**
做任何事——贴面减除从「靠建模者记得加余量」变成「框架默认修正」。

```ts
part = cad.subtract(part, tool)                          // 默认：自动检测共面并外扩 ε（0.01mm）
part = cad.subtract(part, tool, { clearance: 0.1 })      // 覆盖：制造级余量（机加/铣削惯例）
part = cad.subtract(part, tool, { clearance: 0 })        // 显式关闭自动规避（极少用，兼容极端场景）
```

- **默认行为**：布尔前对 `(base, tool)` 做共面检测（见下），对每个「与 base 表面共面」
  的 tool 面，沿该面法向自动外扩 `clearance`（默认 ε = 0.01mm，与 `SEWING_TOLERANCE` /
  `DrillHoleCore` 同量级）。方向判定：tool 面采样点在 base 内部 → 向外越出 ε；
  在 base 外部 → 向内侵入 ε（二者都产生**正体积相交**，布尔减从此有定义）。
- **零回归面**：合法侵入式减除（穿通孔、完全在 base 内的凹槽）不共面 → 检测零命中 →
  行为逐位不变。只有「贴面」脚本被自动修正——这类脚本本来就是错的（必留薄壳）。
- **检测算法（两段）**：
  1. O(1) 包围盒粗筛：tool 与 base 包围盒在 x/y/z 三轴的交叠深度均 > ε ⇒ 必然侵入，
     跳过（绝大多数正常 subtract 零成本）；
  2. 精确面距离检测（仅对「交叠深度 ≈ 0」的轴）：tool 该方向的外表面与 base 表面
     距离 < ε ⇒ 共面命中，按方向外扩。
- **`cad.boolean`（union/subtract/intersect）同款默认语义**（union/intersect 的
  共面不是缺陷，但保持同一检测统一告警）。
- 与诊断的关系（2026-11-03 用户裁定：原 L1/L2 独立检测层取消）：L3 是**修正层**
  （默认自动改对）。L3 触发修正本身就是「位置错误」信号——正常人不会故意让减具体
  悬空贴面——每次触发输出一行运行时提示（含语句号）即足够：正常脚本零命中零噪音，
  位置写错的脚本在提示下一眼可见。不再另设独立检测/告警层。

### L4 —— 固化：文档 + 单测 + 案例验收

- **文档**：`docs/language-design` 或 `docs/api-contract` 增「布尔减共面陷阱」专节：
  机理（零体积相交）、症状（1px 薄壳）、规避（侵入余量 / `clearance`）、check 规则说明。
- **单测**：`packages/core/test/boolean-coincident-cut-guard.test.ts`
  （见 §6 用例清单）。
- **案例验收**：copy1 减薄场景作为 canonical 用例——**v1（共面）脚本不改一行代码**直接跑
  `cad.subtract`，L3 默认自动外扩 → raycheck 零残留、compare 通过；运行时输出一行
  L3 修正提示（含语句号）。【2026-11-03 已由「共面变体 part_coincident.fai.js」完成等价
  验收：变体去掉③刀具体手动出板余量（顶面/外端贴板面），raycheck 21/21 全过】
- **AGENTS.md / 项目规范**：把「布尔减减除体必须侵入」写入 faijs 建模规范（R 系列规则，
  与 copy1 REPORT §11.4 R2/R3 对齐）。

## 3. 实现要点（待排期时的落点）

| 层 | 文件 | 改动 |
|:--|:--|:--|
| L1 ~~check 静态规则~~ | ~~`scripts/faijs-cli.ts` + `scripts/rules/coincident-cut.ts`~~ | **已取消（2026-11-03 用户裁定）** |
| L2 ~~运行时零体积告警~~ | ~~`api/boolean.ts`、`api/boolean-op/index.ts`~~ | **已取消（2026-11-03 用户裁定）** |
| L3 | `packages/core/src/api/boolean.ts`、`api/boolean-op/index.ts`、`api/internal/coincident-cut.ts` | **已实施**：默认检测共面并自动外扩 ε；`options.clearance` 覆盖数值 / `0` 关闭 |
| L4 | `docs/`、`packages/core/test/`、AGENTS.md | 文档专节、单测、规范条目 |
| 符号表 | `scripts/gen-symbol-table.ts` 重生成 | 本次 `subtract`/`boolean` 函数签名未变（仅 BooleanOptions 接口加 clearance 字段），无需重生成；未来签名变化时同步（参照 2026-10-28 §11.3 教训） |

## 4. 验收标准

1. **copy1 案例（默认行为）**：对 v1（共面）脚本**不改一行代码**直接跑
   `cad.subtract` → L3 默认自动外扩 → 产物**无薄壳**；raycheck 21/21、compare 前视通过；
   运行时输出一行 L3 修正提示（含语句号）。【2026-11-03 已通过等价变体验收，见 front matter】
2. **零回归**：`npm test -w @faicad/faijs` 全绿；openscad-port 全量 555 例门禁
   PASS↔FAIL 零退化（合法侵入式减除不触发 L3，行为逐位不变）。【已完成 2026-11-03：
   faijs 全量 421 文件 / 4484 通过 / 13 跳过 / 0 失败；openscad-port 50 ported 例
   parity PASS 41 / PASS-NT 8 / FAIL 1（Old/example017，既有共面残留结构性差异），
   与升级前基线逐位一致（verdict_diffs=0）；**L3 命中普查 = 0**，合法侵入式减除
   零命中、行为逐位不变】
3. **新单测全绿**：§6 清单逐条（已落 7 条核心判定用例）。
4. **符号表一致**：`check() 符号表 ≡ cad 面`（gen-symbol-table 重生成后一致；本次无需重生成）。
5. **clearance 覆盖**：`{ clearance: 0.1 }` 按 0.1 外扩、`{ clearance: 0 }` 回到旧行为
   且 L3 修正提示照常关闭（显式关闭 = 不修正也不提示）。

## 5. 风险与回退

| 风险 | 评估 | 缓解 |
|:--|:--|:--|
| **L3 默认开启的回归面（头号风险）** | 所有既有 subtract 都过 L3 检测：合法侵入式（绝大多数）零命中、逐位不变；但「tool 面与 base 面距离恰为 0 且有意为之」的存量脚本会被自动外扩 0.01mm | ① 全量门禁（openscad-port 50 ported + 仓库语料 4484）实测**命中数 = 0**（2026-11-03 已验）；② 命中者若确属缺陷，正是修复；③ 0.01mm 远小于任何图纸公差，几何无实质变化 |
| ~~L1 误报（可解析模式把「贴面但有意」当错误）~~ | ~~warning 不阻断；真实贴面可豁免注释~~ | **已取消**：L1 随独立检测层取消 |
| ~~L2 误报（包围盒保守：斜置/复杂形状被误判「交叠 0」）~~ | ~~只告警不阻断~~ | **已取消**：L2 随独立检测层取消 |
| **L3 外扩方向判错**（tool 面在 base 内/外误判 → 扩错边） | 扩错边仍产生侵入（向 base 内或越出 base 任一方向都有效）→ 结果仍是干净布尔，仅外扩方向与直觉相反 | 方向判定用面采样点 + base 包含测试；单测覆盖「tool 在 base 内 / 外 / 斜置」三态 |
| L3 对复杂形状（非 box/cylinder）的面检测成本 | 面数多时精确检测慢 | 包围盒粗筛先排除绝大多数；仅「交叠 ≈ 0」的轴走面检测；strict/默认可调 |
| 双入口漏改（boolean.ts vs boolean-op/index.ts） | 只拦一处 → 另一入口仍裸奔 | 两处同改 + 单测分别覆盖两个入口 |
| 与 2026-10-28 闭合性校验交互 | 判定点相邻、语义不同 | 共用标记机制，单测交叉覆盖（贴面+非闭合组合） |

回退方式：L3 默认值可一键改回 0（保留 API 形态，行为回到旧版），`git revert` 单提交兜底。

## 6. 内核单测清单

```ts
// packages/core/test/boolean/coincident-cut-guard.test.ts（2026-11-03 已落，7/7 通过）
// 1. 零体积相交：tool 底面贴 base 顶面 → z-min 侧外扩 ε          ✓ 已落
// 2. 零体积相交：tool 顶面贴 base 底面 → z-max 侧外扩 ε          ✓ 已落
// 3. 侵入 + 贴齐（槽底=板底 / 全厚贯穿孔）→ 不修正               ✓ 已落（copy1 ⑤/⑦ 实证）
// 4. 正常侵入（无贴面）→ 零成本跳过                               ✓ 已落
// 5. clearance ≤ 0 → 显式关闭，永不修正                          ✓ 已落
// 6. 贴面距 < clearance（制造级 0.1）也修正                       ✓ 已落
// 7. 默认行为回归钉：合法侵入式减除（穿通孔）→ 零外扩             ✓ 已落（=用例4）
// ~~L1 check 命中 / L2 O(1) 告警 / 豁免注释 / strict 模式~~ → 随独立检测层取消，不再单测
// 9. cad.boolean 'cut' 与 cad.subtract 双入口同时覆盖             ✓ 已落（2026-11-03 P2：
//    coincident-cut-guard-e2e.test.ts，两入口各零体积例触发、侵入贴齐/clearance:0 不触发）
// 10. 贴面 + 非闭合（与 2026-10-28 交叉）→ 两套规则各自正确触发    （P2 未单列：闭合性
//    校验已有独立用例群 operand-closure.test.ts，L3 与其无共享状态）
// 11. 方向判定三态：tool 在 base 内 / 在 base 外 / 斜置 → 外扩方向正确 ✓ 已落（2026-11-03
//    P2：e2e 斜置绕 z 45° 三态——base 内零命中 / base 外贴顶面触发 z-min / 侵入跳过）
// 12. 内核级 e2e 合计 7/7（双入口 × 零体积/侵入贴齐/clearance:0 + 非轴对齐三态）

## 7. 未决问题

1. ~~L1 的「可解析模式」是否要支持 tool 带 `rotate`/`scale`~~ → **已随 L1 取消关闭**。
2. ε 统一取 `SEWING_TOLERANCE`（0.01mm）还是单独常量？→ **已定**：独立常量
   `COINCIDENT_EPS = 0.01`（实施落点 `api/internal/coincident-cut.ts`），文档说明与
   sewing tolerance 的关联。
3. **L3 默认开启后，全量门禁必须先跑「命中普查」**：确认存量脚本中「贴面减除」命中数
   （预期为 0 或极少数缺陷例），命中者逐例人工裁决（修复 or 豁免）。→ **已执行
   （2026-11-03 P2）**：openscad-port 50 ported 例全量 parity 实跑，L3 命中 = 0，
   无命中例需裁决；copy1 共面变体已实证「命中即修复」。
4. `options` 命名：`clearance` vs `overcut` vs `avoidCoincident`。→ **已定**：`clearance`
   （制造语义：刀具/加工间隙），默认值 0.01 即自动规避，用户可传制造余量。
5. ~~L1 规则是否并入 ffmt（drawing 侧）还是只进 faijs check（faijs 侧）~~ → **已随 L1
   取消关闭**；drawing 侧由 copy1 REPORT 的 R 系列规范覆盖。
6. L3 外扩后的 tool 是否应保留「已修正」元信息 → **已定**：运行时提示（console.warn，
   含语句号）记录；不写进产物。提示规范化（挂进 check 报告而非裸 console.warn）归 P1。

---

## 8. 排期建议（「默认处理对」是 P0 核心，已完成；诊断层已按用户裁定取消）

| 阶段 | 内容 | 依赖 |
|:--|:--|:--|
| P0 | **L3 默认自动规避（核心）** + 全量「贴面命中普查」+ copy1 案例验证（v1 不改一行即无残留）+ 符号表重生成 | 无 |
| P1 | ~~L1 check 规则 + L2 运行时告警（O(1)）+ 双入口统一~~ → **重定义（2026-11-03 用户裁定）**：取消独立检测层；仅 L3 触发提示规范化（挂进 check 报告而非裸 console.warn） | P0（已完） |
| P2 | L4 文档/单测/规范 + openscad-port 全量门禁回归（含命中普查）+ 内核级双入口/非轴对齐单测 | P0 | → **已完成 2026-11-03**：① openscad-port 依赖升 faijs 0.45.20（新 tgz 含 L3）并全量 parity 50 例 PASS↔FAIL 与旧基线逐位一致、L3 命中 0；② 内核级 e2e 单测 7/7（双入口 + 非轴对齐三态）；③ 符号表重生成幂等（签名未变）；④ 提交 8e0db0b |
| P3 | strict 精确面检测（斜置/复杂形状）+ 制造级 clearance 文档与示例 | P2 |
