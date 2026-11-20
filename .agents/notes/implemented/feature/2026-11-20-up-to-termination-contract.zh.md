# Agent Note: 加料与减料共用的到面终止契约

Status: implemented

[English](2026-11-20-up-to-termination-contract.md) | 中文

## Problem

面驱动的终止条件此前只存在于 `cad.extrude`。`cad.drill`、`cad.pocket`、`cad.punchHole`、`cad.fai_drill` 都要求调用方先手算数值深度，因此「钻到某个面停」这类由图纸驱动的写法必须先量尺寸。截断算法也长在拉伸 op 内部，第二个消费者若要用，只能复制它的半空间截断、平面定向与失败分支。CadQuery 风格的 `until` / `combine: 'cut'` 在 faijs 没有对应物。

## Decision

把终止契约收敛到单一模块 `packages/core/src/api/up-to.ts`，所有消费者委托它。

- `normalizeUpToTarget` 接受拾取面引用、`'first'` / `'last'` / `'next'`、CadQuery 选择器字符串、显式 `{ plane: { point, normal } }` 或数值长度。`resolveUpToPlane` 把非长度目标解析为唯一 `CutPlane`；`clipByUpToPlane` 与 `trimToPlane` 按目标半空间截断长实体或刀具。
- 五个 op——`extrude`、`drill`、`pocket`、`punchHole`、`fai_drill`——共用目标语法、`baseFeature`、`offset` 与同一组 `E_UP_TO_*` 错误。已有可靠深度路径的减料 op（`pocket`、`punchHole`、`fai_drill`）在 op 边界把 `upTo` 解析成具体深度后回填原路径，因而拔模刀体与 PMI 一并复用。`cad.drill` 则构造超长圆柱刀、截断后相减。
- `extrude` 另接受 `combine: 'cut'`（拉伸体作刀具）与 `backwardUpTo`（双向终止）。`upTo` 与各 op 定长参数互斥；`backwardUpTo` 与 `backwardLength`、`mode: 'backward'` 互斥。
- `next` 按面中心在加工方向上的投影配合法向夹角筛选最近面。BREP 内核无线-面求交，因此这是近似语义，文档明确标注边界。
- 仅 BREP。mesh 执行链冻结；纯 mesh 输入带 `upTo` 时显式报错，不产生半截几何。

## Alternatives considered

- **Workplane 式链**（`选面 → 拉伸/钻孔到该面`）更贴近 CadQuery 的曲面工作流，但会引入新的语句模型，超出「参数级扩展」的范围。留待单独评估。
- **每个 op 各写一份平面截断**。拒绝：半空间定向规则与四类失败分支会被复制，任一处修复后就会漂移。
- **为 `next` 做精确线-面求交**。本次不采用：需要新增 BREP 内核能力；投影近似对平面目标已足够，且精度边界已写明。
- **另起 `until` / `toFace` 命名**。拒绝：`extrude.upTo` 已是公开参数，第二套词汇只增加迁移成本，不增加语义。
- **在冻结的 mesh 链上实现 `upTo`**。按现行 BREP-only 约定拒绝；新能力只落受支持链。

## Consequences

- 五个 op 共用一套语法与错误词表；`fai_drill.face` 保持起点面含义，只有 `upTo` 决定终止面。
- 定长行为不变：每个新测试同时钉住不带 `upTo` 的结果与到面结果。
- 生成的 API 手册收录新参数表，长期契约文档记录共用语义（含 `next` 精度边界）。
- API 覆盖门禁在真实 TypeScript 调用点上强制校验：脚本字符串调用对 AST 门禁不可见。
- 测试覆盖五个 op 的四类目标、孔底位置与孔心/半径不变、各消费者上的 `offset`、`next` 选中中间面、`combine:'cut'` 两步等价、斜孔底共面、PMI `termination:'face'` 文本、mesh 链拒绝，以及 `E_UP_TO_*` / `E_DRILL_UPTO_AXIS` 错误码。
- 补测过程暴露并修复了三处实现缺项：`trimToPlane` 的空布尔结果抛内核错误而非 `E_UP_TO_NO_INTERSECTION`；方案要求的 `E_DRILL_UPTO_AXIS` 守卫缺失；`punchHole` 对斜目标只在锚点定深（平底），未按真实截断面裁剪棱柱。
