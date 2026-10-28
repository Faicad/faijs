# SMLib 抽壳（Shell）缺陷分析

- 日期：2026-10-28
- 作者：faijs engine-compare 排查（MainAgent）
- 范围：SMLib（C++ 封装 WASM）抽壳操作与 occt 双引擎逐值比对
- 状态：排查完成；SHELL_TWO 崩溃为内核级缺陷，未修复

## 背景与任务来源

用户原始要求（原话）："你还需要检查 3d_editor 这个项目里，他有一个 Example 文件夹里面有一些 faijs 脚本，你要用 occt 和 SMlib 都跑一遍，然后验证它们是相等的。然后 SMlib 比如说抽壳的时候，他会默认把一个长方体的外表面做圆角，这个 bug 要检查一下，还有就是你一个长方体对它进行平面分割以后自然有破皮，这个问题你也检查一下，这都是 SMlib 的 bug，检查一下。"

本文档聚焦抽壳（Shell）部分。平面分割（splitByPlane）破面缺陷已在同日另一修复中解决（半空间盒+布尔差算法替代 SmApiCut，与 occt 逐值一致），不在本文范围。

## 排查方法

- 探针：`packages/tests/faijs/engine-compare/smlib-shell-split-probe.test.ts`（8 用例，观测性无断言）
- 比对框架：同一 `.fai.js` 脚本分别在 occt 与 smlib 内核执行，逐项比对 vol / area / tri / bbox / faceCount
- 内核源码定位：`C:\git\new\usd-brep\source\SM_API\src\SmApiBrep.cpp`、`source\SM_API\inc\SmApiBrep.h`、`wasm-probe\src\SmApiBridgeEx.cpp`

## 实测数据（20×20×20 长方体，厚度 2）

| 场景 | occt | smlib | 结论 |
|---|---|---|---|
| SHELL_TOP（移除顶面，点顶面开口） | vol=3392, area=3552, tri=28, bbox=[20,20,20], 11 面 | vol=3392, area=3552, tri=28, bbox=[20,20,20], 11 面 | **逐值一致** |
| SHELL_THIN（30×20×10 长条，厚 1，去顶面） | vol=1464, area=3028, tri=28, 11 面 | vol=1464, area=3028, tri=28, 11 面 | **逐值一致** |
| SHELL_FULL（全封闭，无开口面） | vol=4096, area=1536, tri=12, bbox=[16,16,16], 6 面 | vol=3904, area=3936, tri=24, bbox=[20,20,20], 12 面 | **封闭薄壁语义差** |
| SHELL_TWO（移除上下两顶面，即 faces="\|Z"） | vol=2880, area=3168, tri=32, 10 面 | `E_OP_FAILED: memory access out of bounds`，vol=0 | **内核级崩溃** |

## 结论一：圆角 bug 未复现

用户报告的"抽壳默认把长方体外表面做圆角"在当前探针场景下**未复现**：SHELL_TOP / SHELL_THIN 两个开口抽壳场景与 occt 逐值一致（体积、面积、三角面数、bbox、面数完全相同），结果中不存在圆角面。

未复现不等于不存在：用户观察到圆角的场景很可能是 3d_editor 实际 UI 操作的具体参数组合（当前探针覆盖厚度 1–2、单面/长条开口）。若要继续追查，需要用户提供真机复现的具体参数（形状尺寸、厚度、开口面选择）。建议将"圆角复现参数"列为待补充输入，而不是在缺少参数的情况下修改已与 occt 一致的路径。

## 结论二：SHELL_FULL 封闭薄壁语义差（smlib 出外壳而非向内薄壁）

- occt 语义：向内抽壳——20³ 盒厚 2 后内部掏空，bbox 缩到 [16,16,16]，6 个平面，面积 1536
- smlib 语义：**偏移外壳**——结果仍是 20³ 外轮廓（bbox=[20,20,20]），12 面（内外面都保留），面积 3936
- 体积差异：smlib 3904 vs occt 4096，且 smlib 的 bbox 不随厚度内缩

这是**封闭薄壁语义差异**而非泄漏/崩溃：smlib 在"无开口面抽壳"时输出的是外表面偏移壳体（含内外面），与 occt 的"向内薄壁实体"不同。对用户可见影响：全封闭抽壳在 smlib 下结果体积/外观与 occt 不一致，不能用于双引擎等价比对。

内核路径：`SmApiShellBrepFull`（SmApiBrep.h:490 签名 `(pBrep, dOffsetDistance, bDoExtendedOffset, bDoSelfInt, bCreateOffsetSolid, rFacesToShell, rpResult)`），桥 `SmApiBridgeEx.cpp:472 SmApiShellBrepFullEx` 透传。语义差异源于内核实现本身，非桥层问题。

## 结论三：SHELL_TWO（移除上下两顶面）内存越界崩溃（内核级，未修复）

smlib 在 `faces="|Z"`（同时移除上下两个顶面）时直接 `E_OP_FAILED: memory access out of bounds`，无输出。occt 同参数正常输出闭合实体（vol=2880, 10 面）。

定位：崩溃发生在内核 SmApiShellBrepFullEx 多面移除路径（去两个相对顶面），疑似内核在删面/缝合时访问已释放或越界内存。属**内核级缺陷**，faijs 适配层无法规避——需要 SMLib C++ 侧（SmApiShellBrepFull 多面移除分支）修复后重新编译 wasm。

## 结论与建议（供审核）

1. 开口抽壳（点顶面/长条）在 smlib 与 occt 下结果一致，**无圆角、无破面**，双引擎等价比对通过——此路径不需要改动。
2. 全封闭抽壳（无开口面）smlib 语义为"偏移外壳"，与 occt"向内薄壁"不同——若产品需要全封闭抽壳的双引擎一致性，需在内核侧对齐语义（或在 faijs 层对全封闭场景显式降级/告警，避免静默输出不同几何）。
3. 多顶面移除（\|Z）在 smlib 下崩溃——**必须内核修复**（SMLib C++ 多面移除路径），faijs 层无解；修复前应在该场景给出明确错误提示而不是 OOB 崩溃。
4. 圆角 bug：当前无复现参数，需要用户提供 3d_editor 真机复现的具体形状/厚度/开口组合后再追查。

## 附：相关文件索引

- 探针：`packages/tests/faijs/engine-compare/smlib-shell-split-probe.test.ts`
- 内核源码：`C:\git\new\usd-brep\source\SM_API\inc\SmApiBrep.h`（SmApiShellBrepFull 签名 :490）
- 桥：`C:\git\new\usd-brep\wasm-probe\src\SmApiBridgeEx.cpp`（SmApiShellBrepFullEx :472）
- 修复提交：`c72882e fix(smlib-kernel): splitByPlane solid halves + transform rotation transpose`
