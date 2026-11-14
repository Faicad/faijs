# circularPattern：取消 `fullAngle`，改为内核步距 `angleStep`

- **状态**：已落地
- **日期**：2026-11-14
- **范围**：`packages/core/src/api/replicate.ts`、`api/brep-operations/patternFns.ts`、`api/surface/arg-spec.ts` 及其生成物、`occt-kernel/occt-primitives.ts`、`brepkit-kernel/brepkitKernel.ts`、相关测试与文档
- **读者**：开发期 agent
- **结论**：`fullAngle` 是 API 层凭空引入的名义角，删除且不保留兼容别名；公开参数改为与 occt、smlib 两内核同名同义的 `angleStep`（度，每份步距）。

## 0. 用户要求（原话）

> 「取消错误的fullAngle， 按照occt、smlib的api提供一个正确的api」

> 「faijs的错误必修直接修复，它就在仓库里，同级目录，去写一份修正方案」

> 「你还是没有说清楚fullAngle到底是谁定义的，明显是错误的呀。」

本次裁定明确两点：一是修复对象是 faijs 自身（不是 drawing 侧的绕过），二是旧参数**取消**，不做保留兼容，公开接口直接对齐两内核的步距口径。

## 1. 现状：一条事实链，三个层次

`fullAngle` 只存在于最外层，越往里越不存在：

| 层 | 位置 | 事实 |
|:--|:--|:--|
| 脚本面 API | `api/replicate.ts:148` / `:159` | `circularPattern(input, axis, count, fullAngle = 360, center = [0,0,0])` |
| 脚本面换算 | `api/replicate.ts:152` / `:163` | `const step = fullAngle / count`，随后缩写成 `step` 传给内核 |
| 兼容面 API | `api/brep-operations/patternFns.ts:23` / `:87` / `:99` | `params: ['shape','axis','count','fullAngle','center']`；`angleStep = (fullAngle ?? 360) / n` |
| 兼容面签名表 | `api/surface/arg-spec.ts:1915-1916` | `circularPattern(shape, axis, count, fullAngle?, center?)`，`params` 同上一行 |
| 生成物 | `api/generated/operations.ts:96-105` | 由 `gen-l3-surface.ts` 从 arg-spec 生成，声明 `paramDims: {}` |
| **内核接口（occt/smlib 真正的口径）** | `brep/engine/primitives.ts:230-237` | `circularPattern(shape, center, axis, angleStep, count)`，注释「绕 axis 均分 angleStep 每份」 |
| smlib 实现 | `smlib-kernel/smlibKernel.ts:806-812` | `out = [原件]`；`for i in 1..count-1`：`rotate(shape, {point:center, direction:axis}, angleStep * i * π/180)` |
| occt 实现 | `occt-kernel/occt-primitives.ts:328-335` | 直接把 `angleStep`（度）交给原生 wasm，注释「wasm 这一层吃的是度」 |
| brepkit 适配器 | `brepkit-kernel/brepkitKernel.ts:990-995` | 形参 `_angleStep` **被忽略**，固定按 `360/count` 均分，注释自述「其它角度跨度无法表达」；该文件另有显式失败入口 `fail()`（`:102-105`）却未在此使用 |
| 文档 | `docs/ops-api-inventory.md:1228` / `:1238` | 「环形阵列：绕 axis 均分 fullAngle」「总角度（度，缺省 360）」 |
| 内核层测试（错误用法） | `test/brepkit-kernel/brepkitKernel.test.ts:691-692` | 传 `angleStep = 360, count = 4`，4 份完全重合仍断言「返回 4 个实体」 |
| 内核层测试（掩盖缺陷） | `test/brep/engine/engine-switch-p2.test.ts:97-103` / `:138-142` | 传 `120, 3`，恰好等于 brepkit 硬编码的 `360/3`，因此 brepkit 忽略步距也「一致」 |

## 2. 病灶

病灶不是「换算写错了」，而是**一个内核不存在的量被提到公开 API 上**：内核只有步距，两内核都按 `第 k 份 = 原件旋转 k·angleStep` 实现，位置集合恒为 `0, step, …, (count−1)·step`。`fullAngle` 是 API 层自己造的名义角，等于 `count × step`，与 `@param` 宣告的「总角度」（首末跨度 `(count−1)·step`）相差整整一个步距。

它只在 `fullAngle = 360` 这一个点自洽：整圈 `n` 等分时 `360/count` 既是名义角的 `count` 等份，也正好是相邻孔距，末份落在 360° 与原件重合、被 `i < count` 丢弃。**所有既有验证都发生在这一点上**，所以矛盾从未暴露；一旦写非整圈（一段弧 4 个、间隔 30°），按文档填「总角度 90」会得到 `step = 22.5`，孔位全错且不报警。

brepkit 适配器把同一处错误再放大一层：它连步距都不看，固定 `360/count`，合法调用与非法调用得到同一结果，失败点被抹平。

## 3. 正确的 API（本次裁定）

公开签名改为：

```
circularPattern(shape: Shape, axis: Vec3, count: number, angleStep?: number, center?: Vec3): Shape
```

语义与内核一字不差：

| 项 | 定义 |
|:--|:--|
| `count` | 副本总数（**含原件**，`k = 0 … count−1`） |
| `angleStep` | 相邻两份的夹角，单位**度**，方向绕 `axis`（过 `center`） |
| 位置 | 第 `k` 份 = 原件旋转 `k · angleStep` |
| 缺省 `angleStep` | `360 / count`（整圈均分，等价于旧 `fullAngle = 360` 的行为，既有整圈调用零变化） |
| 缺省 `center` | 原点 `[0,0,0]` |
| 符号 | 负 `angleStep` 表示反向；方向分叉仍由 `axis` 表达 |

校验与错误码：

| 条件 | 结果 |
|:--|:--|
| `count < 1` 或非整数 | `PATTERN_INVALID_COUNT`（沿用现有码） |
| `count > 1` 且 `angleStep` 非有限数 | `PATTERN_INVALID_STEP` |
| `count > 1` 且 `angleStep = 0` | `PATTERN_INVALID_STEP`（全部副本重合，无意义） |
| `count > 1` 且 `abs(angleStep) >= 360` | `PATTERN_INVALID_STEP`（超过一整圈，副本必然重叠） |
| `axis` 为零向量 | `PATTERN_ZERO_AXIS`（沿用现有码） |
| `count = 1` | 直接返回原件，不校验步距 |

参数位置契约：第 4 位 `angleStep`、第 5 位 `center`（与现状同位，仅改名与语义）。只想给 `center` 时写 `circularPattern(s, axis, 4, undefined, [0,0,0])`。兼容面（`circularPatternBrep`）的对象形态按 `params` 表映射，因此 `{ angleStep: 30, center: [0,0,0] }` 合法。

`fullAngle` 不再存在：无别名、无旧值读取、无「给 360 就当整圈」的隐式分支。

图纸说法到调用的映射（这一栏就是本方案相对旧口径的全部收益）：

| 图纸标注 | 调用 | 实际首末跨度 |
|:--|:--|:--|
| 整圈 8 均布 | `circularPattern(s, [0,0,1], 8)` 或 `(…, 8, 45)` | 315° |
| 整圈 20 均布 | `circularPattern(s, [0,0,1], 20)` | 342° |
| 一段 4 个、间隔 30° | `circularPattern(s, [0,0,1], 4, 30)` | 90° |
| 两段各 4 个、间隔 30° | 两次 `circularPattern(s, axis, 4, 30)` 作用在不同起始件上 | 每段 90° |
| 10 个、间隔 30°（留 90° 缺口） | `circularPattern(s, [0,0,1], 10, 30)` | 270° |

旧调用迁移（破坏面只有一个值）：`fullAngle = 360` → 省略或写 `360 / count`；`fullAngle ≠ 360` → 写 `angleStep = fullAngle / count`（旧语义本来就是 `count × step`，如此迁移才保持几何不变）。

## 4. 双实现同步

faijs 的同形 op 有两条实现路径，必须同一次改完，否则两个面语义分叉：

| 位置 | 改法 |
|:--|:--|
| `api/replicate.ts:148-157`（mesh 分支，`meshEngines: ['brepkit']`） | 形参 `fullAngle` → `angleStep`；`const step = angleStep ?? 360 / count`；其余不动。mesh 执行链 2026-11-07 起冻结，`step` 继续原样传 brepkit，不在此处修 brepkit 的缺陷 |
| `api/replicate.ts:159-183`（brep 分支） | 同上改名；`step` 直接传 `kernel.circularPattern(solid, center, u, step, count)`，删除一切 `/ count` 换算；`theta = -k * step` 的符号约定**不动**（roleTable 逆映射依赖它，现有 parity 已自洽） |
| `api/replicate.ts:187` | `paramDims: { count: 'plain', fullAngle: 'angle' }` → `{ count: 'plain', angleStep: 'angle' }` |
| `api/brep-operations/patternFns.ts:23` | `CIRCULAR_PATTERN_PARAMS.params` 第 4 项 → `angleStep` |
| `api/brep-operations/patternFns.ts:87-99` | 解构第 4 项改名；`const angleStep = angleStepRaw ?? 360 / n`，删除 `/ n` 换算；补 `PATTERN_INVALID_STEP` 校验 |
| `api/surface/arg-spec.ts:1915-1916` | `args` 字符串与 `params` 数组同步改名（这是唯一人工维护点） |
| `packages/core/src/api/generated/*` | 不手改，跑 `npm run gen:surface` 重生成 |
| `docs/ops-api-inventory.md` / `.zh.md` | 不手改，跑 `npm run gen-ops-api-inventory` 重生成 |
| `lang/symbol-table.generated.ts:135` | 只登记 op 名（`"circularPattern": {}`），不含参数，无需变更 |
| `mesh/api.d.ts:117` | role 词表，不含参数，无需变更 |

## 5. brepkit 适配器：让失败可听见

`brepkitKernel.ts:990-995` 的静默忽略必须终止，用本文件既有的显式失败入口 `fail()`（`:102-105`，定义是「适配器内部的显式失败……不在实现体里伪装」）：

```
circularPattern(shape, center, axis, angleStep, count) {
  if (count > 1 && Math.abs(angleStep - 360 / count) > 1e-9) {
    fail(`circularPattern: angleStep=${angleStep}, brepkit only supports 360/count=${360 / count}`)
  }
  ...
}
```

理由：`brepkit` 在 faijs 里是可选 BREP 引擎之一（`engine-verdict-equivalence` 把它纳入 verdict 等价集），静默返回一份「看起来对、位置全错」的实体，比直接失败危险得多；faijs 的既有红线是「BREP 路径执行异常 = 必须暴露」。当且仅当 `angleStep` 恰为 `360/count`（整圈均分）时 brepkit 能给出正确结果，此时放行。

不用 `unsupported()`（`smlibKernel.ts:817` 那种桩）：`brepkitKernel.ts` 的设计原则是「零 unsupported 桩、能力缺失由静态判定拦截」。本项是**参数级**能力差异（方法存在、只有整圈均分正确），`api/surface/engine-method-map.json` 的能力表按方法粒度登记，表达不了参数取值，因此只能在实现体内显式失败，并把这一条登记进 engine 能力表的备注。

## 6. 受影响调用点

| 位置 | 现状 | 改法 | 理由 |
|:--|:--|:--|:--|
| `test/cad-runtime/live-shapes.test.ts:270` | `cad.circularPattern(part0, [1,0,0], 4, 360)` | `(part0, [1,0,0], 4, 90)` 或去掉第 4 位 | 旧 360 是名义角；新 360 会被当步距并被校验拦下 |
| `test/api/brep-operations/brep-operations-g4.test.ts:90` | `circularPatternBrep({…}, [0,0,1], 4, 360, [0,0,0])` | `…, 4, 90, [0,0,0]` | 同上 |
| `test/brepkit-kernel/brepkitKernel.test.ts:692` | `api.circularPattern(box, center, axis, 360, 4)` | `…, 90, 4` | 这里第 4 位是**内核步距**，360 让 4 份全部重合，原断言「4 个实体」其实在验一个退化结果 |
| `test/api/consume-input.test.ts:65` / `:133` | `cad.circularPattern(s0, [0,0,1], 4)` | 不变 | 走缺省 `360/count`，行为不变 |
| `test/api/mesh-solid-modeling.test.ts:253` | `cad.circularPattern(a, [0,0,1], 4)` | 不变 | 同上 |
| `test/smlib-kernel/smlib-p2-ops.test.ts:207` | `p.circularPattern(…, 90, 4)` | 不变 | 内核层，本来就是步距 |
| `test/brep/engine/engine-switch-p2.test.ts:97-103` / `:138-142` | `…, 120, 3` | 保留 | 整圈均分，两内核唯一可比的点；新增用例覆盖非均分（见 §7） |
| `.fai.js` fixture（`packages/tests` 全量） | 无 `circularPattern` 调用 | 无影响 | 脚本面存量模型零破坏 |
| drawing 侧（`server/prompts/model.md`、`partials/faijs_occt_*.md`） | 讲 `fullAngle = stepDeg × count` | 改讲 `angleStep = stepDeg`；手册片段重跑 `scripts/sync_faijs_manual.py` 跟随 | 下游不再需要那个乘法 |

## 7. 测试计划（不改测试就等于没改）

新增 `packages/core/test/api/circular-pattern-step.test.ts`，全部基于真实几何（occt 已 `initOcctWasm()`），不用 mock：

1. **步距生效**：`count = 4, angleStep = 30`，取 4 份质心绕轴的极角，断言依次为 `0° / 30° / 60° / 90°`（容差 0.01°）。
2. **缺省整圈**：`count = 4` 不给步距，断言 `0/90/180/270`。
3. **GOTCHA 留档**（faijs 硬规则 2）：同一测试里写两组断言 —— 旧口径「按跨度填 90 当总角、4 份」得到 `22.5°` 的错位结果，新口径 `angleStep = 90` 得到 `0/90/180/270`；注释标 `GOTCHA:`。
4. **非法步距**：`angleStep = 0`、`= 360`、`= -400` 在 `count > 1` 下抛出 `PATTERN_INVALID_STEP`；`count = 1` 时任意步距直接返回原件。
5. **负步距**：`angleStep = -30, count = 4` 得到反向 `0/−30/−60/−90`。
6. **兼容面同判**：`circularPatternBrep` 覆盖 1、2、4 三项；对象形态 `{ angleStep: 30, center: [0,0,0] }` 与位置形态结果一致。
7. **双引擎 parity（非整圈）**：occt 与 smlib 各跑 `angleStep = 30, count = 4`，逐份质心角度差 `< 1e-6`；这是旧测试从未覆盖的区间。
8. **brepkit 显式失败**：`angleStep = 30, count = 4` 下适配器抛 `[brepkit-kernel]` 显式错误（断言消息含 `angleStep`，并 spy `console.error` 满足 stderr 零容忍）；`angleStep = 90, count = 4` 下正常返回 4 份。
9. **API 覆盖门禁**：`angleStep` 必须出现在调用点（`scripts/check-api-test-coverage.ts` 的 L2），上面 1–6 自动满足；若 `api-coverage-baseline.json` 记录旧参数名，需重新生成 baseline。

## 8. 文档与门禁

| 文档 | 动作 |
|:--|:--|
| `api/replicate.ts` JSDoc（`:129-145`） | 改英文表述：`Copy count instances (original included) around the axis; instance k is rotated k · angleStep. angleStep defaults to 360/count.` 禁止出现 `total angle` 字样 |
| `docs/ops-api-inventory.md` / `.zh.md` | 生成器重跑，不手改 |
| `docs/api-contract.md:594` | 该行只讲 `keepHidden` 消费语义，无需改；若新增参数表格则在此补 `angleStep` 一行 |
| `.agents/notes/` | 新增一条决策记录（双语）：为什么删除 `fullAngle`、为什么选 `angleStep` 而不是 `spanAngle`、为什么不留兼容层、brepkit 为何改为显式失败 |
| `docs/plans/2026-11-14-circular-pattern-angle-step.md` | 本方案，实施后状态改为「已落地」 |

## 9. 落地顺序

1. 改 `api/replicate.ts`（brep 分支 + mesh 分支签名）。
2. 改 `api/brep-operations/patternFns.ts` 与 `api/surface/arg-spec.ts`。
3. `npm run gen:surface` 重生成 `api/generated/*`。
4. `npm run gen-ops-api-inventory` 重生成 API 手册（中英）。
5. 改 `brepkit-kernel/brepkitKernel.ts` 的步距守卫。
6. 改 §6 列出的 4 处测试，新增 §7 的 9 项测试。
7. `npm run test -w @faicad/faijs` → `npm run typecheck` → `npm run lint` → `npm run doc-sync` → `npx tsx scripts/check-api-test-coverage.ts --package=packages/core`。
8. 以上全绿后跑一次 `pwsh -NoProfile scripts/ci.ps1`，失败只跑失败项，不反复跑 CI。
9. 需要发版时走 `npm run set-version -- <ver>`，禁止手改版本号。

## 10. 不做的事（范围边界）

1. 不保留 `fullAngle` 兼容别名或迁移分支——用户裁定「取消」。
2. 不新增 `spanAngle`（真跨度）参数；将来若确有「图纸只给跨度不给步距」的来源，另立方案，且不得与 `angleStep` 同时存在于同一 op。
3. 不新增 `startAngle`；分段弧由调用方对同一去重几何多次调用表达。
4. 不改 mesh 执行链行为（冻结），只跟随签名与默认值推导。
5. 不尝试让 brepkit 支持任意步距（wasm 无此参数），只让它显式失败。
6. 不动 `linearPattern` / `gridPattern` / `rectangularPattern` / `mirrorJoin`——它们没有这个病灶。
7. 不跑 `git push`、不动版本号、不 `git stash`。

## 11. 风险

1. **外部 `.fai.js` 曾写 `fullAngle ≠ 360`**：改名后第 4 位被解释为步距，几何会变，且仅当新值 `>= 360` 才被校验拦下（如旧值 90 会静默变成「每份 90°」）。faijs 内 `.fai.js` fixture 无此类调用；drawing 侧 `model.md` 只生成整圈默认。若仓库外存在此类模型，需在迁移说明里给出 `angleStep = fullAngle / count` 的换算。
2. **双实现漏改**：`replicate.ts` 与 `patternFns.ts` 若只改一边，脚本面与 `@faicad/faijs/api` 面语义分叉，且 typecheck 不会报错（参数名不同但都接受 number）。缓解：§7 第 6 项在兼容面独立断言。
3. **生成物与源表不一致**：`arg-spec.ts` 改了而忘了跑 `gen:surface` / `gen-ops-api-inventory`，`doc-sync` 与 `check-dist-sync` 会红——这是预期行为，按报错重跑。
4. **brepkit 守卫的容差**：`360/count` 是浮点除法，比较必须用 `1e-9` 级绝对容差，不能写成 `angleStep === 360/count`。

## 12. 验收标准

1. 全部 `circularPattern` 公开面（脚本面 + `@faicad/faijs/api`）的签名是 `(shape, axis, count, angleStep?, center?)`，`params` 表与 `paramDims` 同为 `angleStep`。
2. `src/` 与 `docs/*.md`（含生成物）grep `fullAngle` 为 0 命中；`docs/plans/` 内旧文档与历史 log 不计。
3. 一段 4 个、间隔 30° 的模型导出的 STEP 上，孔位极角为 `0/30/60/90`（±0.01°）。
4. occt 与 smlib 在非整圈步距下位置一致；brepkit 在非整圈步距下抛出显式错误而非返回错位实体。
5. `npm run test -w @faicad/faijs`、`typecheck`、`lint`、`doc-sync`、API 覆盖门禁全绿，且 `scripts/ci.ps1` 跑通一次。

## 13. 落地记录

### 13.1 代码

| 位置 | 改动 |
|:--|:--|
| `api/replicate.ts` | 新增 `circularStep(count, angleStep)`：参数校验（正整数 `count`）+ 缺省 `360/count` + `count > 1` 时拒绝 `0` 与 `abs(step) >= 360`，错误文案 `[api/circularPattern] angleStep ...`。mesh / brep 两个分支签名换 `angleStep?: number`，`step` 提到分支前计算；`paramDims` 改 `{ count: 'plain', angleStep: 'angle' }` |
| `api/brep-operations/patternFns.ts` | `CIRCULAR_PATTERN_PARAMS.params` 第 4 项 `angleStep`；新增 `angleStepRaw` 解构与 `PATTERN_INVALID_STEP` 校验 |
| `api/surface/arg-spec.ts` | `args` / `params` 均为 `angleStep`，示例同步 |
| `api/generated/*`、`docs/ops-api-inventory.md` / `.zh.md` | 由 `gen-l3-surface.ts`（16 projections）与 `gen-ops-api-inventory` 重生成，`fullAngle` 0 命中 |
| `occt-kernel/occt-primitives.ts` | **实施中发现的第二个根因**：occt-wasm 的 `circularPattern(shape, center, axis, angle, count)` 收的是**总角度（弧度）**并在内部按 `total/count` 逐份旋转；旧适配器把「度」当弧度、把「步距」当总角直传，等于每份 `step/count` 弧度。现换算 `totalAngleRad = count · angleStep · π/180`，并把这条 `GOTCHA` 写进注释 |
| `brepkit-kernel/brepkitKernel.ts` | 形参 `angleStep`；`count > 1 && |angleStep − 360/count| > 1e-9` 时 `fail()`，不再静默整圈均分 |

### 13.2 测试

- 新增 `test/api/circular-pattern-step.test.ts`（9 项）：内核层极角读数（`0/30/60/90`）、旧语义对照（`22.5°` 样例必须不同）、缺省 `360/count` 与显式 90 等价、弧段 `30°/2` 份的包围盒对「手工 `rotate` 基线」等值、非法步距（`0` / `360` / `-400`）必须 `rejects.toThrow`、`count = 1` 不校验、兼容面同口径、对象形态 `{ shape, axis, count, angleStep, center }` 与位置形态等价、`PATTERN_INVALID_STEP`。
- 新增 `test/smlib-kernel/circular-pattern-step.test.ts`（2 项）：`createRequire` 探测可选包 + `describe.skipIf`，本机未装包时跳过。
- 既有用例同步：`cad-runtime/live-shapes.test.ts`、`api/brep-operations/brep-operations-g4.test.ts` 的第 4 参由 `360` 改 `90`（整圈等价）；`brepkit-kernel/brepkitKernel.test.ts` 改 `angleStep = 90 = 360/4` 并新增「非整圆步距显式失败」；`api/consume-input.test.ts` 的 `circularPattern` fixture 由「居中方盒绕原点整圈」改为非居中 `box(20, 20, 20)` + 显式 `4, 90`（原 fixture 在正确语义下四份完全重合，退化成单实体）。

### 13.3 门禁结果（2026-11-14）

| 门禁 | 结果 |
|:--|:--|
| `npm run doc-sync` | 12 项全绿（170 Agent Notes、202 双语配对、685 doc refs、459 md links） |
| `npm run lint` | 7 包 layering OK，eslint 无错 |
| `npm run check-api-coverage` | 通过（L1 1025 exports / 183 既有 gap，L2 155 APIs / 95 既有 gap） |
| `npx tsc --noEmit` | 20 条报错全部来自未安装的可选包 `@faicad/smlib-wasm`；非 smlib = 0 |
| `vitest run --exclude 'test/smlib-kernel/**'` | **6 files failed / 424 passed；tests 4751 passed / 13 skipped / 0 failed**。6 个失败文件全部是 `import smlibKernel` 时找不到 `@faicad/smlib-wasm`（`brep/engine/engine-switch-smlib.test.ts` 等，不在 `test/smlib-kernel/` 目录内） |
| `npm run build` / `npm run check-dist-sync` | 未通过，原因同上：`tsc -p tsconfig.build.json` 在 `smlibWasm.ts` 的 `@faicad/smlib-wasm` 类型解析处中止，`dist/` 无法重建，`check-dist-sync` 仍报「源码有、dist 缺 12 个」（`dist/` 已被 `.gitignore` 忽略，源码与测试不受影响） |

### 13.4 环境限制：可选包未装

本机 `node_modules/@faicad` 下没有 `smlib-wasm`，`test/smlib-kernel/**` 整套因 `import '@faicad/smlib-wasm'` 失败而整文件 FAIL，这是既有环境状态、与本改动无关（同一状态下 `typecheck` 的 20 条报错也只在 smlib 侧）。smlib 侧的契约钉已写成 `describe.skipIf`，装上包即参与回归。`brepkit` 同理（`brepkit2-wasm` 未装时整组 skip）。

### 13.5 未跑的门禁与原因

`pwsh -NoProfile scripts/ci.ps1` 未跑：它内含 `npm run build` 与全量 `vitest`，在本机（未装 `@faicad/smlib-wasm`）必然停在 smlib 缺包处，跑一次只会得到 §13.4 已记录的同一批环境失败，无增量信息。装上可选包后应在 CI 机器上跑一次作为发布前门禁。
