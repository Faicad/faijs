# Agent Note: Compound 成员排序、幽灵 `import_shape` op、非建模 shape 资产

Status: implemented

## Problem

ArchDetail 报 `compound-missing-members`：它的 5 个 `Part::Compound` 容器翻译成
`cad.group({ members: [...] })`，但容器执行时成员尚未注册成变量，于是容器解析为空。
成员与其资产都在——故障纯属排序。

Kahn 排序所用的拓扑边由 `depsOf` 产出，而它的 `linkProps` 不含 `Links`。
因此 `Part::Compound` **对自己成员没有边**，排序可以自由地把 group 排在成员之前
（或其所在子模块之前），`inputVar` 落空。

修这个的过程中浮出两个独立缺陷，形态完全相同：产物 `ok=true`、`cliCheck` 零错误，
一执行就崩。`cliCheck` 只校验语法与脚本内引用，**从不校验被调用者、从不校验资产**，
所以这一类在转换侧的每一道门禁上都是结构性不可见的。

1. **发出的被调用者不存在。** shape-asset 判定发的是 `cad.import_shape`。`cad`
   命名空间里没有这个 op——资产加载器是 `cad.load`，且它是 **SOLID** 加载器
   （`params: { key, format }`，`format: 'brep'`）。50 个语料产物里 42 个
   `cliCheck` 干净却无法执行。
2. **非建模对象被当作 shape 资产。** 规则是「任何带 Shape 证据的对象即 shape 资产」，
   于是 `PartDesign::Body` 自身与它的两个 `PartDesign::Plane` 基准面也被导入。
   基准面的 `.brp` 装的是平面 FACE，即零实体；这些导入被 `cad.union` 进 Body 链
   （`cad.union(pad, datumPlane)`），使产物不可运行。PadTest 计数一度误读为
   translated=9 / preserved-only=4，像是进展；诚实值是 6/7。

## Decision

- **成员就是拓扑依赖。** `linkProps`（建边与 `inputVar` 重命名共用同一份链接表）
  在 `Shapes` 之外补入 `Links`，容器必定排在其内容之后。
- **单一分类表。** 新增 `fcstd/structural-types.ts`，持有 `STRUCTURAL_TYPES`、
  `STRUCTURAL_TYPES_EXTENDED`、`isFemStructural`、`isNonModelingType`。独立成模块是因为
  `convert.ts` 与 `codegen.ts` 都需要该判定，而两者直接互相 import 会成环。
  `convert.ts` 重导出原先本地定义的这些名字，调用方无改动。
- **`Fem::` 是命名空间规则，不是清单。** `isFemStructural(type)` 即
  `type.startsWith('Fem::')`。枚举已被扩过两次、还等着第三轮；FreeCAD 里每个
  `Fem::` 类型都是分析/网格/求解/结果对象，从不是建模几何，故整个命名空间按定义
  就是结构类型。
- **非建模类型在翻译前短路**（而不只是从资产收集中排除）：两者必须一致——既不在
  `shapeCarriers` 里，也在 codegen 循环里直接答 `preserved-only`。
- **资产用 `cad.load` 加载**，key 取资产成员去扩展名的文件名，`format: 'brep'`。
  `shapeAssetCall()` 是该调用的唯一构造处。

## Alternatives considered

- **给 `Part::Compound` 显式优先级而非建边**——否：同样的遗漏对所有容器型类型都在，
  且会在 Kahn 之外再引入第二套排序机制。
- **第三次枚举缺失的 `Fem::` 类型**——否：前两轮已证明枚举对此命名空间是错的形状；
  命名空间判定不会过期。
- **保留 `cad.import_shape` 并把它加进命名空间**——否：该 op 从未存在、无人依赖；
  为迎合笔误而发明 op 会扩大公开面，并掩盖「正确 op 是仅支持实体的 `cad.load`」这一事实。
- **让 shape-asset 规则保持类型无关，改在运行时过滤**——否：BREP/mesh 路径在执行前
  就按静态规则判定，这是本项目的设计红线；运行时回退正是被禁止的行为类别。
- **宁可让 ArchDetail 继续 gap，也不产出跑不了的产物**——否：缺失的成员边是影响所有
  容器文档的真 bug，而非实体资产问题是正交的、既有的，且波及面比这一个文件更广
  （21 个发 load 的样本里有 14 个）。用 gap 遮住它等于销毁证据。

## Consequences

- 56 样本 sweep：ok 48→**50**、gap 8→**6**、`cliCheck` 失败 0（82 个模型模块、
  1,075 条语句）。ArchDetail 转出；剩余 6 个 gap 全是真实几何/求解工作。
- **ArchDetail 只到「可转换」，产物仍不可执行。** 本轮的诚实表述是「compound 排序
  已修」，不是「ArchDetail 能用了」。它的成员是 Draft 线，冻结 `.brp` 里没有实体，
  `cad.load` 拒绝加载。
- 一个经实测的设计级遗留被钉住：冻结 `.brp` **不保证是实体**。698 个 `cad.load`
  站点普查：335 可加载、346 零实体、15 个 manifest 无对应 key、2 个本 occt 构建读不了
  ——分布在 21 个发 load 的样本中的 14 个。产物层面：50 个可转换样本 **32 能 run、
  18 失败、0 抛异常**，分 6 类根因。修法需要「非实体导入能力」（faijs 目前没有），
  或把 shape-asset 限制为实体、其余转显式 gap。
- 新增两张不同粒度的回归网：e2e golden 钉一个「全实体且能跑」的 shape-asset 样本，
  外加一个钉死的必失败样本；全语料 run 普查按样本钉死 32/18 的划分，使
  「转换仍报 ok」再也不能掩盖不可运行的产物。
- 两张网都记录了同一条坑：多 Body 文档会产出「聚合入口 + 每个 Body 一个模块」，
  `cad.load` 调用在 Body 模块里。只断言 `model/main.fai.js` 证明不了任何事
  ——在 `test_geomop.fcstd` 上实测：7 个 load 站点，入口里 0 个。
- faijs fcstd 套件 14 文件 / 144 用例全绿；语料项目套件 7 文件 / 20 用例全绿。
