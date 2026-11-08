# Agent Note: 钻孔与螺丝的描述性螺纹规格（`thread: 'M16-6H'`）

Status: implemented

[English](2026-11-07-thread-descriptive-modeling.md) | 中文

## Problem

按规格攻丝原本需要内部三键词汇：`fai_drill(part, { holeType: 'tapped', screwSystem: 'metric', screwSpecIdx: 10, screwThread: 'coarse' })`。人类写法——"M16 螺纹孔"——没有直达入口；读生成 API 手册的 AI 代码生成器学到的也是内部 `screwSpecIdx` 词汇，而不是工程标注写法。

2026-11-07 的代码审计还登记了一批螺纹相关缺陷：brep 自定义螺距回落粗牙、通孔螺纹高度硬编码、imperial PMI 缺公差等级缺省、`handedness` 无产出方、3MF PMI 序列化/解析孪生死代码、3MF PMI round-trip 断、brep 忽略 tolerance、`cad.screw` brep 大径超公称、`holeType:'screw'` 语义分叉、`mirror` 缺 `pmiRemap`。

## Decision

描述性规格文法（`parseThreadSpec`）是两个 op 的首选入口；登记缺陷**仅在 BREP 链**修复。

**文法**（规范化、空格全容忍）：metric `M<dia>[×<pitch>][-<class>][↧|↓<depth>]`，imperial `[#<gauge>|<frac>"|<dec>][-<tpi>][-<class>][↧|↓<depth>]`，pipe `PT|R|Rc<size>[↧|↓<depth>]`。公差等级：metric `[4-8][GH]`、imperial `1B|2B|3B`；深度后缀映射到孔参数 `depth`。`specLabel` 只承载规格部分。

**键名**：`fai_drill` 增 `thread`；`screw` 增 `spec`（其 `thread` 键已被牙型枚举占用）。

**语义**（用户已确认）：`thread` 存在时 `holeType` 缺省 `'tapped'`；`diameter` 缺省按表反算底孔；无 `depth` 即通孔。描述串即图纸标注语法：只有串内带公差等级后缀（`-6H`）或调用方显式给出 `threadClass` 时才产出 `PmiThreadHole`；否则只出几何、不出 PMI，该路径不默认 `6H`。串内字段与显式参数冲突（`↧18` vs `depth`、`-6H` vs `threadClass`），且与旧三键组合互斥——各报 `E_ARG`。旧三键入口原样保留（存量脚本零改动），两种入口解析出同一 `ResolvedThreadSpec`。

**AI 面可见性**：生成的 AI 手册（`gen-skill-docs --emit`，ai-gateway 消费；`gen-api-dts` → `api.d.ts`）只宣传 `thread`/`spec` 与文法示例；旧键 `screwSystem`/`screwSpecIdx`/`screwThread`（及 `screw` 的 `system`/`specIdx`）经隐藏标记由生成器从生成文档面滤去——TypeScript 类型与运行时保留。

**范围**：仅 BREP 链；mesh 链冻结（独立决策，2026-11-07）。metric 表扩到 M64。

**已落地修复**：JSDoc/类型谎言更正；brep 自定义螺距透传（`screwPitchCustom`）；通孔螺纹高度由 bbox 推导；旧路径 imperial `'2B'` 缺省；`handedness` PMI 参数；3MF PMI 序列化/解析统一与 round-trip；brep `tolerance` 生效（仅 simple/tapped——screw 孔不吃，保底孔/牙型配对）；`cad.screw` 牙顶到公称大径；`holeType:'screw'` 牙型自底孔壁起、牙顶到公称；`mirror`-only `pmiRemap`（mirrorJoin 故意不注册）。

## Alternatives considered

**用描述键取代三键入口。** 否决：存量脚本与下游消费方使用三键形式；描述键是增量（零修改红线）。

**描述路径默认 `6H` 且恒产 PMI。** 用户否决：描述串是图纸标注语法——不带公差等级的标注不标注任何东西；只有串内带公差或显式给出时才产 PMI。

**把 `↧18` 映射到 `threadDepth`。** 用户否决（选孔深 `depth: 18`）：与调用方词汇一致——"不给 depth 就是通孔"。

**两条链都修。** 否决：mesh 链冻结；mesh 侧缺陷登记、不修。

**从 TypeScript 类型删除旧键来隐藏。** 否决：类型层删除会破坏存量脚本的类型检查；隐藏只作用于生成的 AI 面文档。

## Consequences

- 全部验收判据验证通过：`parseThreadSpec` 文法（29/29 测试）；`fai_drill` `thread` 键（互斥、PMI 条件、串内盲孔、旧路径等价）；`screw` `spec` 键；AI 面文档隐藏旧键；Phase 2–4 每项修复带防回归测试；既有 55 用例螺纹基线不红（mesh 用例作冻结基线）。
- `#14` 牙型改动使体积判别失效（牙深由 pilot→公称 固定、齿宽随螺距缩放，填充率尺度不变）：防回归测试改用面数与环带探针判别，不用体积。
- 描述路径的条件 PMI 与旧路径的恒产 PMI 行为不同——文档写明、测试锁死，不静默统一。
- `PmiAffine` 反射支持（`mirror` pmiRemap 用）经探针测试核实并保留在套件中；反射矩阵产生 `-0`，方向断言一律走 `expectVec`，不做裸相等。
- `E_ARG`/`E_THREAD_SPEC` 消息经 `toOpFailure` 包装后原样存活，脚本面失败可见原始错误码。
