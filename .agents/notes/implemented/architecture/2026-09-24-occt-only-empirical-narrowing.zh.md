# Agent Note：`draft` 与 `reverseShape` 按实证收窄为 occt-only

Status: implemented

[English](2026-09-24-occt-only-empirical-narrowing.md) | 中文

## 问题

两条手写 op 带着**族级**能力声明 `capabilities: ['directEdit']` 上了脚本面：

- `cad.draft` —— 对选定面施加拔模斜度；
- `cad.reverseShape` —— 反转壳体朝向。

两个引擎都以族级布尔声明了 `directEdit: true`，于是静态能力门在**两个引擎**上都放行了这两条 op。在 brepkit 上，失败在派发之后才浮现，且是两种形态，都不可接受：

- `reverseShape` 在 op 级失败：`invalid solid handle: index N is out of bounds`（报出的 callee 是 `reverseShape`，不是输入构造侧的 op）。
- `draft` 返回**不抛错但错误**的几何。同一脚本（`cad.box(20,20,10)`、`angleDeg: 3`、经 `cad.faceRef` 选单个面）、同一进程实测，并先用几何枚举列出面，使序号错配无法成为借口：

  | 引擎 | ordinal 1–6（= 面表顺序） | 结果 |
  |---|---|---|
  | occt | `[-X, +X, -Y, +Y, -Z, +Z]` | ordinal 1–4（四个侧面）**全部恰好** −52.4078；两个端面（⊥ pull）被内核拒绝 |
  | brepkit | `[-Z, +Z, -Y, +Y, -X, +X]` | `+60.29 / 0 / 0 / +17.47 / 0` |

  三点使它成为定论而非序号假象：
  1. 对称体上对单个侧面拔模，四个侧面必须给同一结果。occt 是；brepkit 给出四个不同值。**对称性被破坏与「哪个 ordinal 对应哪张面」无关。**
  2. 三个 ordinal 是**静默无操作** —— 体积与包围盒都不变。项目对此情形的规则是「宁可拒绝，也不静默产出错几何」。
  3. 端面（⊥ pull）把 x/y 包围盒撑大 `0.524 = 10·tan 3°`，即对一张无法拔模的面施加了斜度。

两种形态都违反派发红线：BREP 链可用性必须在执行前静态判定。「门说能、内核说不能」正是这条红线禁止的状态，而运行时没有任何机制能补救一次失败的静态判定。

## 决定

`draft` 与 `reverseShape` 声明 `engines: ['occt']`。

- 收窄是**逐条**的，不是整族的。`fillet` 在 brepkit 上是正确的（与 occt 逐位相同），`shell` 两侧都成为薄壁（包围盒一致），`unifySameDomain` 两侧可用（有重新居中的差异）。只收窄有证据反对的那两条。
- 它是**实证收窄，不是依赖声明**：两个文件都没有 import 任何平台模块，实现只接触 L1 契约面。此处使用 engines 轴表达的是「这条 op 在此处无法产出正确几何」，而该轴正是用于此。
- `capabilities` 清单与 `engines` 并存。两条轴互相独立、按序求值（引擎白名单在前、能力求交在后）；这份声明之所以可能，正是由于该互斥已被撤销。
- 不新增逐核能力名。把 `draft` / `reverseShape` 扩进 `BrepMethodKind` 并在 occt 方法表里声明，等于为一件另一条轴已能表达的事去扩大一套词汇。

## 考虑过的替代做法

- **新增逐核能力名（`capabilities: ['draft']`），让能力门拒绝 brepkit。** 否决：轴选错了，且改动更大 —— 需要扩方法联合与两个引擎的方法表；而它陈述的是「内核方法依赖」，与真正的事实「该引擎不支持」不符。
- **把整个修复/编辑族收窄为 occt。** 否决：该族并非一律不可用。`fillet` 与 `shell` 在 brepkit 上明确可用；整族声明等于为了掩盖两处缺陷而丢弃可用的功能。
- **保留声明、把缺陷写进文档。** 否决：这会把红线形态留在原地 —— 在 brepkit 下，op 通过静态门之后抛错，或静默返回错误几何。
- **改为修 brepkit 的 L1 `draft` / `reverseShape`。** 本次不做：这属内核侧工作，且目前尚无关于成因的证据；而无论内核何时修好，静态门都是必需的。现在收窄不阻碍日后放宽。

## 后果

- 在 brepkit 上两条 op 现在都在**执行前**失败，且报错点出引擎名。此前那种「内核深处报错，或静默返回错误几何」的形态已消除。
- occt 侧行为不变。`draft` 的参数校验（角度非零、面引用、`neutral.normal`）不受影响。
- `draft` 的 `neutral` 参数事实上退化为默认值：occt-wasm 原生 `draft(shape, face, angleRad, direction)` 没有 neutral 形参，适配器对非原点中性点显式报错而非丢弃；而 brepkit —— 唯一消费中性点的引擎 —— 现已被静态拒绝。因此非原点中性点已无可用引擎，它会明确报错而不是静默拔错。要补齐该语义还是去掉该参数，是另一个待定问题。
- 另有四条 op 因缺乏干净证据而保持原样，这一点是**如实记录**而非猜测：`defeature`、`sew`、`sewAndSolidify`、`removeHolesFromFace`。它们的探针输入在到达 op 级行为之前先撞上输入构造侧限制（面引用），故未为其添加引擎声明。
- 回归守卫位于 `api/feature-family.test.ts`：brepkit 下两条 op 必须报出点明 `occt` 的执行前失败；mock 引擎下平台身份门不得拦截 `draft`。
