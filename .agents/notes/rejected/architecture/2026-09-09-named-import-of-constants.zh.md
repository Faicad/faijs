# Agent Note：`.fai.js` 模块具名 import 普通常量

Status: rejected — 收益只是写法上的观感，代价却是每个模块的导出面静默扩张成"全部顶层变量"，并堵死后续做显式导出收口的可能。

[English](2026-09-09-named-import-of-constants.md) | 中文

## Problem

把一个多文件 Python CadQuery 项目（mini_lathe）移植过来时，首先撞上的重复就是 config 块：19 个常量加一个 `pin_holes` 辅助函数，被原样复制进全部 7 个零件脚本。Python 靠 `import config` 消掉它，各零件统一写 `config.OUTX`。

faijs 的多文件通道（P5，见 `.agents/notes/implemented/architecture/2026-09-06-module-registry-multifile-p5.md`）已经覆盖了这个改法的形状，但只覆盖了一部分：`import * as cfg from './config.fai.js'` 可用，而 `import { OUTX } from './config.fai.js'` 会被 `ModuleRegistry.resolveBinding` 拒绝 —— 它只放行 `liveShapes ∪ fns`，普通常量一律报 `BINDING_NOT_EXPORTED`。

本 note 要回答的问题是：要不要放行普通常量的具名 import，让 Python 的 `from config import X` 在 faijs 里有对应形态？

## Proposal

把 `resolveBinding` 从二分规则放宽为三分规则：

| 值种类 | 规则 | 变化 |
|---|---|---|
| shape 值 | 必须 ∈ `liveShapes` | 不变（A-9） |
| 非 shape 常量 | 直接放行 | **新增** |
| 函数 | 经 `fns` | 不变 |

shape 那一行正是"图省事版本"不安全的原因。`FaiModuleExports.values` 装的是**全部**非函数 ctx 键，shape 也在里面。若把所有值都放行，那么一个在产出模块内部已被消费掉的 shape 就能被 `import { base }` 悄悄取到 —— 这恰恰是 A-9 禁止的，也是 `multifile.test.ts` 断言必须失败的场景。所以"放行常量"和"放行一切"不是同一个改动，被讨论的从来只有前者。

## 为什么收益很小

1. **被移植的 Python 源码根本没用这种写法。** mini_lathe 的 7 个零件脚本全部写 `config.OUTX`，没有一个写 `from config import OUTX`。整个 Python 项目里唯一的 `from X import Y` 出现在 `assemb.py`，导入的是 **shape**（`from bottom_plate import bp`）—— 而这条 faijs 已经通过 `liveShapes` 支持了。为常量做"Python 对齐"的论证因此是纯理论的：它对应的是源码并未使用的一个特性。
2. **命名空间形态已经完备。** `import * as cfg` + `cfg.OUTX` 已实现、已测试（`multifile.test.ts` 的 "namespace import" 用例），不需要动引擎。
3. **观感上的收益只是一个前缀。** 抽掉 config 块本身消掉约 130 行重复；剩下的写 `OUTX` 还是 `cfg.OUTX` 属于口味问题。而且这个前缀 arguably 是优点 —— 它在使用处标出哪些是项目共享参数、哪些是 `slot_x` / `cut_centers` 这类局部变量。

## 为什么代价很大

1. **导出面变成"全部顶层变量"。** 现在模块的公开面是**推导出来的**：存活 shape + 函数。放行常量之后就变成**一切** —— 包括那些从未打算被导入的中间变量。`slide_mid.fai.js` 里的 `hole_positions`、`cut_centers`、`hexagon_side` 之类全会变成合法的导入目标。Python 同样宽松，但 Python 并不需要维护一条可机检的模块边界。
2. **它堵死了更好的修法。** P5 note 已经把 `// @export` 收口列进开放缺口。显式导出声明才是"另一个模块可以导入什么"的原则性答案。先落地隐式全量导出，就会长出依赖它的使用方，后续收口变成破坏性变更。拒绝本提案等于零成本地保留了这个选项。
3. **它削弱了绑定校验作为设计信号的清晰度。** 现在的规则是一句话：一个模块导出它**产出且保留**的东西，加上它**定义**的函数。三分规则需要额外一段解释 shape 为何要特殊对待，而这段解释此后每次讨论导出面都得带着走。
4. **影响面在引擎而不是项目。** `resolveBinding` 被所有宿主共享（CLI、测试、3d_editor）。一个 mini_lathe 的书写便利性问题，不该用 core 语义的永久变更来回答。

## Alternatives considered

- **只用命名空间 import（`import * as cfg` + `cfg.OUTX`）—— 采纳。** 零 core 改动；已实现已测试；与 Python 源码的实际写法一致。代价是每处一个前缀。
- **放行所有值（含 shape）。** 直接否决：破坏 A-9，且 `multifile.test.ts` 的断言要从"失败"改成"成功"，属于倒改测试而非扩展测试。
- **显式 `// @export` 标注。** 这才是长期应有的形态，也正是本提案被**拒绝**而不是"带条件接受"的原因。为 mini_lathe 去重而言超出范围，继续留在 P5 的开放缺口清单里。
- **让生成器把常量产出成库（library）而不是 `.fai.js`。** 否决：等于把项目共享参数移出项目，而且库是另一套信任与打包边界。

## Acceptance criteria

若本提案被接受，需要满足：

1. `import { OUTX } from './config.fai.js'` 能解析，且 `OUTX` 在导入方脚本里可作为裸标识符使用。
2. `multifile.test.ts` 的 A-8 / A-9 / A-10 用例原样通过 —— 特别是"导入一个非存活 shape"仍须以 `BINDING_NOT_EXPORTED` 失败。
3. 新增核心单测覆盖具名常量导入，另有一条断言"非存活 shape 仍被拒绝"。
4. `docs/library-dev-guide.md` 或多文件契约文档写明这条三分规则。

以上均未实现。除 `module-registry.ts` 里一行指向本 note 的指针注释外，工作区与提案前完全一致。

## Risks

- **会被反复重提。** 今后每个用了 `from config import X` 的 Python 移植项目都会再撞一次。要记下的答复是：先把"Python 对齐"当成论据之前，先确认源码是否真的用了那种写法。
- **误用被拒行为的风险可控。** 闸门是"拒绝"而非"忽略"，写错的 `import { OUTX }` 会在 import 行以 `BINDING_NOT_EXPORTED` 加一份存活 shape 清单明确报错，失败形态是清晰的错误而不是静默的 `undefined`。
- **note 漂移。** `module-registry.ts` 的指针注释写明了本 note 的路径；若本 note 日后被取代，那条注释必须同步搬走。
