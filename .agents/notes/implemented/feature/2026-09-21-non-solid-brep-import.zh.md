# Agent Note：非实体 BREP 导入（`cad.load` 的 `allowNonSolid`）

Status: implemented

## 问题

FreeCAD 的 `.brp` 资产是冻结的 BREP，而**冻结的 BREP 不保证含实体**——Draft 的线、面、壳都以同样方式冻结。FCStd 端口里的 shape-asset 规则把它们统统交给 `cad.load` 导入，而 `cad.load` 是 **SOLID 加载器**，凡是没有实体子形的都拒绝。

56 样本语料实测：698 个 `cad.load` 站点中，**346 个指向零实体的 `.brp`**（只有 `Ve/Ed/Wi/Fa/Sh` 记录）。这些产物转换时 `ok=true`、`cliCheck` 全干净，一运行就在第一条语句上崩（`[loadBrep] imported shape contains no solid sub-shapes`）——因为 `cliCheck` 只校验语法与脚本内引用，**从不校验被调用者、从不校验资产**。上一轮把这件事记录为设计缺口并给了两个修法；本笔记落地其中之一（另一个「把 shape-asset 限制为实体」会白白丢掉真实几何）。

塑造这个解法的约束是：本仓的 BREP/mesh 路径**静态决定**、禁止运行时回退，所以「先当实体试、失败再放宽」根本不可用——放宽的决定必须发生在调用之前。

## 决策

- **判据来自资产的文本。** `brep/brep-topology-text.ts` 导出 `brepTextHasSolid`，扫描 CASCADE `TShapes <N>` 段里的裸 `So` 记录。该段是**扁平表**（compound 里的 solid 也有自己的 `So` 行），且头部声明的数量界定了扫描范围，因此形状像类型码的数据行无法把扫描拖长。返回 `null` 表示「不是 CASCADE 文件」——**故意不并入 `false`**：读不了的资产是另一种失败，必须继续以实体导入的身份失败。
- **判据是拿内核对拍出来的，不是论证出来的。** fcstd-port `out/probe-brp-predicate.mjs` 在每个可加载站点上把它与 `getSubShapes(top, 'solid').length > 0` 比较：**681 一致、0 不一致**（335 含实体 / 346 零实体）；内核拒绝的 2 个文件令判据弃权。转换期零内核开销。
- **`cad.load` 加的是参数，不是新 op。** `params.allowNonSolid`（缺省 false）透传到 `loadBrep(..., { allowNonSolid })`。选参数而非新 op 的理由：加载几何本来就是 `load` 的职责，再造一个符号只会重复它的 key/path/url 分流而无语义增益；且缺省值让所有既有产物**逐字节不变**——只有置位时 params 对象才扩展。
- **放宽路径仍然拒绝真正空掉的资产。** `hasAnyTopology` 要求至少有顶点/边/线/面/壳之一，损坏文件因此是响亮失败，而不是一个静默的空 Shape。
- **转换层保持零内核。** `convert.ts` 在本来就要遍历归档收集 `shapeCarriers` 的同一趟里收集 `nonSolidAssets`，交给 `generateModel` → `translateObject` → `shapeAssetCall`，于是判决被**显式写进产出脚本**（`allowNonSolid: true`），而不是运行时探。

## 考虑过的替代方案

- **新增专用 op**（`cad.loadShape`，或用历史那个 `cad.import_shape` 名字）——否决：它重复 `load` 的源路由，只为一个放宽的校验增加公开符号。加开关可保持「一个加载器、一份契约」。
- **转换期用 OCCT 探资产**——否决：转换层目前完全不启内核，为每个资产起一个内核去回答一个文本能精确回答的问题不划算。
- **先按实体导入、失败再回退**——否决：本仓铁律是 BREP 路径静态决定；静默重试会掩盖「哪些产物依赖哪种几何」。
- **非实体资产只走 mesh**——否决：冻结文件是精确几何，Draft 线本来就可能是后续 `extrude` 的基座，BREP 句柄值得保留。
- **把 shape-asset 限制为实体、其余转显式 gap**——即文档里记录的另一个选项；否决，因为它把已经冻结的真实几何变成 gap，并会让四个能跑的样本失去资格。

## 后果

- 新增：`brep/brep-topology-text.ts`（+ 测试）、`brep/load-nonsolid.test.ts`、fixture `fixtures/data/brp/{draft-wire,boss-solid}.brp`。
- faijs：fcstd 14 文件 / 145 用例全绿；`api` + 一致性套件 24 文件 / 262 用例全绿。`docs/ops-api-inventory.*` 已按新参数重生成。
- fcstd-port 基线：**50 个可转换样本中能执行的从 32 → 36。** Crank、thermomech_flow1D 与两个 InvoluteGear 文件现在能跑；Crank 退出了被钉住的 `KNOWN_UNRUNNABLE` 槽位。转换侧 sweep 不变（ok 50 / gap 6 / checkFail 0）——这是执行侧缺陷。
- **下面的缺陷现在露出来了。** `KNOWN_UNRUNNABLE` 槽位改为钉住 ArchDetail 的 `E_BREP_UNSUPPORTED: input is not BREP`：293 个导入全部放行后，它往后走一条语句就死在「`cad.group` 的 compound 再次进 `rotate_euler`」（结构 compound 不携带 OCCT 句柄）。另有 2 个样本死在导出侧——`exportStepFromSolids` 在全线框链里找不到可导出子形，正是本问题的镜像。
- **已知限制，已在 `load-nonsolid.test.ts` 里钉住**：无面的线框三角化为空，因此它能导入、能查询，但不贡献显示网格。要渲染它需要内核的 `wireframe()` 边通道，`Shape` 目前不承载。
- `allowNonSolid` 放宽的是校验，所以误判只会退化成「稍微过于宽松」而不会产生错误结果——测试里的实体 fixture 钉住了「开关不扰动正常路径」。非实体操作数仍进不了布尔运算（OCCT 抛 `boolean operation failed`），测试把这条下游边界钉住，供调用方遵守。
