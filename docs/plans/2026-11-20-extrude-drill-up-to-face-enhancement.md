# faijs 到面终止语义增强：拉伸 / 钻孔 / 切除统一 up-to 机制

- 状态：实施中
- 日期：2026-11-20
- 方案出处：Tencent Hunyuan Hy + WorkBuddy
- 范围：`packages/core`（faijs 引擎），`cad.extrude` / `cad.drill` / `cad.pocket` / `cad.punchHole` / `fai_drill` 五个存量 op 的参数与 BREP 实现；新增共享模块 `api/up-to.ts`
- 本期之外：Workplane 链式 API、拉伸/切削 `taper`、曲面共形贴合、mesh 执行链（冻结面，见 AGENTS.md 2026-11-07 裁定）

## 0. 需求与判定依据

需求：让 faijs 的钻孔、切除具备与 `cad.extrude` 同级的「加工到某个面 / 到体端面 / 到基准面」终止语义，并把散落在 extrude 内的终止逻辑收敛为可复用的统一契约。

判定依据（逐条可查，详见配套分析 `docs/analysis/2026-11-20-extrude-drill-until-face-gap-analysis.md`）：

| 事实 | 代码证据 |
|---|---|
| `cad.extrude` 已有 `upTo`，支持 `FaceTopoRef` / `'last'` / `'first'` / `{plane}` / 选择器字符串四类目标 | `api/extrude.ts:188-210`、`:325-492` |
| `cad.drill` 的 options 只有 `at/radius/axis/depth`，无面终止 | `api/brep-operations/compoundFns.ts:139-199` |
| `fai_drill` 参数表无 `upTo/toFace/until`；`face` 表示**起点面**，语义与终止面不同 | `extra/ops/fai_drill.ts:626-643` |
| `cad.punchHole` 只有 `height?`，`null` 即贯穿 | `api/punch-hole.ts:41-54`、`:263-274` |
| 面选择器解析已具备（`>Z` / 索引 / 命名视图 / 复合轴） | `api/cadquery-selectors/face.ts:107`、`api/face-by-selector.ts:68` |
| 到面截断机制 = 长实体 ∩ 目标面半空间盒 | `api/extrude.ts:401-491` |
| BREP 内核当前无线-面求交能力（仅 mesh 侧有 raycast） | `extra/mesh/drill-hole/DrillHoleCore.ts:116`；`brep/engine/primitives.ts` 无对应项 |

## 1. 设计目标与原则

1. **一个终止契约，服务加料与减料**。`extrude` 的「长拉伸 → 平面截断」与钻孔/切除的「长刀 → 平面截断 → 相减」是同一个几何原语。抽取为共享模块，五个 op 共用，避免各写一份。
2. **参数名沿用 `upTo`**。不引入第二套命名（`until` / `toFace` / `to` 都不新增）；`cad.extrude.upTo` 已是既有公开契约，复用可降低认知与迁移成本。
3. **起点面与终止面分离，各自命名**。`fai_drill.face` 保留「从哪个面下刀」语义；新增 `upTo` 只表达「到哪个面停」。二者互不覆盖。
4. **显式报错，不静默降级**。`upTo` 与定长参数（`length`/`depth`/`height`）互斥；方向与目标面平行、目标不可达、选择器命中多面，全部给出带错误码的异常（沿用 `E_UP_TO_*` 风格）。
5. **BREP-only 落地**。新能力只进受支持的 BREP 链；mesh 侧沿现有做法显式抛 `MeshUnsupportedError`（`api/extrude.ts:524-537` 已有先例），不实现、不修 mesh 缺陷。
6. **不破坏既有脚本**。`depth` / `height` / `length` 的现有默认值与 `depth=0` 通孔快捷方式保持不变；`upTo` 是纯增量参数。

## 2. 核心设计：统一终止条件抽象

### 2.1 新增共享模块 `api/up-to.ts`

```
export type UpToTarget =
  | { kind: 'distance'; value: number }                    // 定长（既有 length/depth 的归一形态）
  | { kind: 'face'; ref: FaceTopoRef }                     // 拾取的具体面
  | { kind: 'selector'; selector: string }                 // >Z / <X / 命名视图，在 base 上解析
  | { kind: 'plane'; point: Vec3; normal: Vec3 }           // 显式基准面（无限平面）
  | { kind: 'extent'; which: 'first' | 'last' }            // base 沿加工方向的近/远端

export interface UpToContext {
  kernel: BrepEngineApi
  base?: Shape                    // extent / selector 的支持体
  origin: Vec3                    // 加工起点（孔心 / 轮廓中心）
  direction: Vec3                 // 加工方向（已归一化、已定号）
  offset?: number                 // 截断面沿其法向偏移
}

export interface CutPlane { point: Vec3; normal: Vec3 }

export function resolveUpToPlane(target: UpToTarget, ctx: UpToContext): CutPlane
export function clipByUpToPlane(kernel: BrepEngineApi, solid: BrepHandle, plane: CutPlane, keepSide?: Vec3): BrepHandle
```

契约要点：

- `resolveUpToPlane` 只负责「**把任意目标解析成一个截断面**」。四类面目标的解析规则与现有 `extrudeUpToSolid` 步骤 1 完全一致（`api/extrude.ts:330-399`）：面引用取 `hint.center/normal` 快照；`extent` 走 bbox 沿方向投影；`selector` 走 `resolveSelectorToFaceRefs` 且要求恰好命中一面；`plane` 取给定点法向。
- `clipByUpToPlane` 只负责「**用截断面把长实体截短**」。搬迁现有步骤 2–4（`api/extrude.ts:401-491`）：按截断面投影算长实体长度、构造半空间盒、`common`、空结果检查。保留现有 GOTCHA 结论——长试探长度必须按「截断面到轮廓的投影距离」而非轮廓自身对角线；保留侧按「包含加工起点的一侧」判定；`{plane}` 目标保留自动定向。
- `resolveUpToPlane` 内部对 `selector` / `extent` 缺 `base` 抛 `E_UP_TO_NO_BASE`，对方向与目标面法向近似平行抛 `E_UP_TO_PARALLEL`，对截不到目标抛 `E_UP_TO_NO_INTERSECTION`——与现有错误码一致，调用方无需二次判断。

### 2.2 `extrude` 的兼容性处理

- `ExtrudeUpTo` / `ExtrudeOptions`（`api/extrude.ts:188-210`）**保留为对外类型**，内部转成 `UpToTarget` 后委托共享模块；`api/index.ts:157` 的导出不变。
- `extrudeUpToSolid`（`api/extrude.ts:325`）改为薄封装：归一化 `upTo` → `resolveUpToPlane` → `clipByUpToPlane`。功能与错误码逐条对齐，本期不新增 extrude 行为。
- 这一步是纯抽取，用现有 `extrude-upto.test.ts` 全量回归即可验证无行为漂移。

## 3. 各 op 的接口契约变更

### 3.1 `cad.drill` — 钻孔到面

```
drill(shape, {
  at: Vec3 | [x, y],
  radius: number,
  axis?: Vec3,                    // 缺省 [0,0,1]
  depth?: number,                 // 既有；与 upTo 互斥
  upTo?: UpToTarget,              // 新增
  baseFeature?: Shape,            // 新增；缺省 = shape（钻到自己身上的面）
  offset?: number                 // 新增；截断面偏移，缺省 0
})
```

实现（`compoundFns.ts:139-199` 的 `drillBrep`）：

1. `depth` 与 `upTo` 同时给出 → `E_DRILL_DEPTH_UPTO`；都不给 → 保持原 through-all 行为。
2. `upTo` 分支：以 `at` 为起点、`dir` 为方向构造**超长圆柱刀**（长度取 `base`/`shape` bbox 对角线 × 2，确保越过截断面）；`ctx.direction = dir`、`ctx.base = baseFeature ?? s`；`resolveUpToPlane` 得到截断面 → `clipByUpToPlane` 截短刀体 → `kernel.cut(s, tool)`。
3. 刀体与截断面的夹角检查：圆柱轴与截断面法向夹角 > 阈值（初始取 1°，即近似平行）时抛 `E_DRILL_UPTO_AXIS`——此时截断面无法在合理长度内终止孔。
4. `tool` 的释放继续放在 `finally`（现有 `:197`）。

### 3.2 `fai_drill` — 编辑器钻孔到面

- JSDoc 参数表（`extra/ops/fai_drill.ts:609-657`）新增 `@param params.upTo`、`@param params.baseFeature`、`@param params.offset`；说明 `face` 是起点面、`upTo` 是终止面，二者独立。
- `normalizeDrillParams`（`:290`）新增归一：`upTo` 不存在时保持现状（`depth` 缺省 0 = 通孔）；存在时把 `depth` 视为不适用，二者同时显式给出抛 `E_DRILL_DEPTH_UPTO`。
- BREP 主路径 `drillBrepPath`（`:529`）在造刀阶段调用共享模块截断；`drillBrepWithRoleTable`（`brep/face-evolution.ts:769`）继续接收截短后的刀具，roleTable 传播逻辑不变。
- PMI 一致性：孔深由面决定时，`threadHole` / 孔深标注不得再写死数值深度，改为「到面」描述（复用现有 `PmiHoleAxis` / `formatThreadHole` 的文本生成路径）；具体措辞在 P1 实现时随测试一并定稿。

### 3.3 `cad.punchHole` — 按面轮廓切除到面

- `PunchHoleParams`（`api/punch-hole.ts:41-54`）的 `height?: number | null` 旁新增 `upTo?: UpToTarget`、`baseFeature?: Shape`。
- `punchDepth`（`:67`）当前在 `height` 缺省/为 `null` 时取 bbox 对角线 + `THROUGH_MARGIN` 做贯穿；改为：`upTo` 存在时走共享截断，`height` 保持原样，`upTo` 与显式 `height` 互斥（`E_PUNCH_HEIGHT_UPTO`）。
- 刀体构造 `punchSolidOf`（`:133`）沿用 `resolveFaceHandle` + `kernel.extrude` / `loft`（含拔模），仅把「定长刀体」换成「共享模块截断面刀体」；`kernel.cut` 与后续清理不变。

### 3.4 `cad.pocket` — 型腔到面

- `pocketBrep`（`compoundFns.ts:211-258`）当前要求 `depth > 0`（`:217`）。新增 `upTo`，存在时跳过 depth 校验，用 `profile` 沿 `faceNormalAt` 造超长棱柱刀，共享模块截断后 `kernel.cut`。
- `upTo` 的 `base` 缺省为被加工 shape。

### 3.5 `combine: 'cut'`（P2）

- `cad.extrude` 新增 `combine?: 'union' | 'cut'`，缺省 `'union'`。`cut` 时取 `baseFeature`（必填）与拉伸结果做 `kernel.cut`，几何上与 `cad.pocket` 同构——共用同一套截断与布尔路径，只是轮廓来源不同（extrude 吃面、pocket 吃 profile）。
- 不新增 op 名，避免 `cut` 别名与 `subtract` 漂移（现有 `api/boolean.ts:531` 已是别名）。

## 4. 分阶段落地

| 阶段 | 内容 | 风险 | 退出条件 |
|---|---|---|---|
| **P0 抽取** | 新建 `api/up-to.ts`；`extrude` 委托共享模块；对外类型/导出不变 | 低（纯重构） | `extrude-upto.test.ts` 全绿、行为零漂移；`typecheck` / `lint` 通过 |
| **P1 减料到面** | `cad.drill`、`fai_drill`、`cad.punchHole`、`cad.pocket` 的 `upTo` | 中（多 op、PMI 联动） | 各 op 到面测试全绿；既有 depth/height 测试不回归 |
| **P2 语义补齐** | `extent: 'next'`、`combine:'cut'`、双向到面 `backwardUpTo` | 中高（next 需新面枚举逻辑） | 见 §5 的降级策略与验收 |
| **P3 独立评估** | Workplane 链式、taper、曲面共形、mesh 链 | 高 | 不在本期；需单独方案评审 |

### 4.1 `extent: 'next'` 的实现策略（P2）

BREP 内核当前没有线-面求交（`brep/engine/primitives.ts` 无对应项），本期不引入双引擎新内核能力。采用**面枚举 + 方向投影**的近似实现：

1. 枚举 `base` 的所有面（经现有 `iterShapes` / `api/measure-query.ts` 的面遍历能力）；
2. 取每个面的中心与法向，按「中心在加工方向上的投影 > 起点投影」筛选候选，并按投影距离升序取最近者；
3. 要求候选面法向与加工方向夹角超过阈值（避免取到与加工方向平行的侧面）；无候选则抛 `E_UP_TO_NEXT_NOT_FOUND`；
4. 得到的面中心 + 法向交给 `resolveUpToPlane` 的 face 分支。

语义边界须写入 API 文档：**`next` 是基于面中心投影的近似「下一个面」，不保证与复杂曲面精确相交**。这与 CadQuery `until='next'` 的实际行为（沿方向取面并算距离）在精度量级上相当，不宣称更优。精确线-面求交留作 P3 的独立评估项。

### 4.2 双向到面（P2）

现有 `backwardLength` 与 `upTo` 互斥（`api/extrude.ts:265-272`）。新增 `backwardUpTo?: UpToTarget`：正向走 `upTo`、负向走 `backwardUpTo`，各自解析截断面后按现有双向实现方式（先平移再拉伸，`api/extrude.ts:633-643`）合成。保留现有互斥规则，只新增一条「`backwardUpTo` 与 `backwardLength` 互斥」。

## 5. 测试计划

原则：关键几何语义全部固化为可重复的 `*.test.ts`；**每个新能力同时钉住两组值**——不带 `upTo` 的既有定长结果（当前正确值，防回归）与带 `upTo` 的目标面结果（新语义正确值），二者断言并存，不 skip、不 mock。

| 测试文件 | 新增用例 |
|---|---|
| `test/api/up-to.test.ts`（新建） | `resolveUpToPlane` 四类目标各自解析结果；缺 base → `E_UP_TO_NO_BASE`；平行 → `E_UP_TO_PARALLEL`；不可达 → `E_UP_TO_NO_INTERSECTION`；`clipByUpToPlane` 保留侧判定、斜基准面自动定向 |
| `test/api/extrude-upto.test.ts`（扩展） | P0 重构后原用例逐条复跑；补充 P2 `extent:'next'` 与 `backwardUpTo` |
| `test/api/drill-up-to.test.ts`（新建） | 到 `FaceTopoRef` / `'last'` / `'>Z'` / `{plane}` 四类目标的孔深与孔底位置；轴平行 → `E_DRILL_UPTO_AXIS`；`depth`+`upTo` → `E_DRILL_DEPTH_UPTO`；hole 中心/直径不因 upTo 改变 |
| `test/extra/ops/fai-drill-brep-semantics.test.ts`（扩展） | `upTo` 下 PMI 文本为「到面」而非数值深度；`face` 起点面与 `upTo` 终止面独立生效 |
| `test/api/punch-hole-e2e.test.ts`（扩展） | `upTo` 到斜面时孔口/孔底共面性；`height`+`upTo` 互斥 |
| `test/api/boolean-consume.test.ts`（扩展） | `combine:'cut'` 与现有 `extrude`+`cut` 两步结果等价 |
| `test/api/mesh-solid-extrude.test.ts`（扩展） | 新增 `drill`/`punchHole` 的 mesh 链 `upTo` 拒绝断言（与 `:251` 同款） |

验证顺序遵循 AGENTS.md：先跑本方案自测 → 再跑受影响测试 → 全通过后才跑一次 `scripts/ci.ps1`，之后只重跑失败项。

## 6. 文档与门禁

- `docs/api-contract.md` / `docs/api-contract.zh.md`：新增「到面终止语义」小节，说明 `upTo` 四类目标、`next` 的近似边界、与定长参数的互斥、BREP-only 范围；同步 `api-contract.i18n.yaml`。
- `docs/ops-api-inventory.md` / `.zh.md`：五个 op 的参数表补 `upTo` / `baseFeature` / `offset` / `combine`。
- 新增 API 需通过 `npm run check:api-coverage -w @faicad/faijs`（`api/up-to.ts` 导出函数须被本包测试引用）。
- `npm run doc-sync`（链接、双语、Agent Note、类型等价、ts 编译）。
- `node scripts/check-ghost-deps.mjs`、`npm run typecheck`、`npm run lint`。

## 7. 验收标准

1. `.fai.js` 可直接写出「钻孔到某个拾取面」并得到正确孔深，无需手算深度：
   ```js
   const base = part0;
   const stopFace = cad.faceRef(base, 7);
   const drilled = cad.drill(base, {
     at: [10, 10, 0], radius: 3,
     upTo: stopFace,
   });
   ```
2. 同一 `upTo` 写法在 `extrude` / `drill` / `punchHole` / `pocket` 语义一致：四类目标、同一套错误码、同一套 `offset` 方向。
3. 既有不传 `upTo` 的脚本行为零变化（全量回归测试绿）。
4. mesh 链调用 `upTo` 得到显式错误，不产生半截几何。
5. 文档双语同步、API 覆盖门禁通过。

## 8. 风险与边界

| 风险 | 应对 |
|---|---|
| `fai_drill` PMI 文本与孔深联动牵涉较多 | P1 内单独子任务，用测试锁定措辞，不扩散到螺纹规格体系 |
| `next` 为近似语义，曲面可能被误判 | 显式文档边界 + 法向夹角阈值 + 无候选报错；精确求交留 P3 |
| 五 op 参数膨胀 | 统一 `UpToTarget` 类型与 `baseFeature/offset` 命名，不各自定义形状 |
| 共享模块改动影响 extrude | P0 单独提交，纯抽取 + 原测试全绿后才进 P1 |
| 用户脚本里 `face` 与 `upTo` 混淆 | API 文档与 JSDoc 明确起点面/终止面分工；错误码区分 |

## 9. 证据索引

| 主题 | 文件 | 关键行 |
|---|---|---|
| `ExtrudeUpTo` / `ExtrudeOptions` | `packages/core/src/api/extrude.ts` | 180-210 |
| 到面求解四目标 + 截断 | `packages/core/src/api/extrude.ts` | 325-492 |
| extrude op / mesh 拒绝 upTo | `packages/core/src/api/extrude.ts` | 591-683 / 524-537 |
| `drillBrep` / `pocketBrep` | `packages/core/src/api/brep-operations/compoundFns.ts` | 139-199 / 211-258 |
| `fai_drill` 参数与声明 | `packages/core/src/extra/ops/fai_drill.ts` | 609-658 |
| 钻孔 roleTable 路径 | `packages/core/src/brep/face-evolution.ts` | 769 |
| `punchHole` 参数 / 刀体 / op | `packages/core/src/api/punch-hole.ts` | 41-54 / 133 / 263-274 |
| 面选择器 | `packages/core/src/api/cadquery-selectors/face.ts` | 107 |
| `faceRef` / `faceBySelector` | `packages/core/src/api/face-ref.ts` / `face-by-selector.ts` | 42 / 68 |
| `cut = subtract` 别名 | `packages/core/src/api/boolean.ts` | 531 |
| 库面 extrude 导出 | `packages/core/src/api/index.ts` | 157 |
