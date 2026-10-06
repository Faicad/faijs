# 方案：D-1 被消费终端泄漏修复 + 消费判定规则重新编号

- 日期：2026-10-06
- 归属：`packages/core`（`cad-runtime/live-shapes.ts` 消费判定）
- 触发：G0-D 方案 §8-D1/D2 的 D-2 测量（fcstd-port `out/d2-measure-report.md` v2）
- 状态：**立项（待实施）**
- 铁律：所有修复必须在转换/执行期**静态判定**；验收用单测 + 单样本探针，**全量 sweep 须用户批准**（2026-10-06 教训）。

---

## 1. 问题一句话

36 个泄漏变量（25 个产品）的 shape 被后续 op 消费，终端选择却仍把它们判为活、导出为独立 STEP ⇒ parity `merge_parts` 双重计数，19/20 有 truth 样本的 merged area 超 truth 1.37×–17.3×。

## 2. 样本解剖（fcstd-port `out/d2-anatomy.txt` + `out/d2-confirmed.json`）

**泄漏变量声明形态**（36 个）：

| 声明 op | 数量 | 说明 |
|---|---|---|
| `cad.import_brep` | 29 | 冻结资产（Pocket/Clone 命名族） |
| `cad.extrude` | 4 | f77b50589157 Pad/Pad001、blower Pad002 |
| `cad.fillet` | 2 | Sliding_door Fillet、trims Fillet005 |
| `cad.box` | 1 | sw_smd_6.0x3.8 Box001 |

**消费 op 形态**（每变量首个消费者）：`cad.mirror` ×10、`cad.circularPattern` ×23、`cad.linearPattern` ×8、`cad.place` ×4、`cad.extrude` ×2（含交叉提及）。**全部是 positional 首参直引**——C5 规则按码面应命中，未命中的机制层原因需 E-1 最小复现裁决（嫌疑：StatementSummary 对这些 op 的首参提取形态、或 keep 表误登记）。

**污染量化**：25 个确认产品中 20 个有 truth+旧栈 STEP，19 个 merged area / truth ∈ [1.37, 17.3]（`arduino-mega` 17.3×、`lcd-4x20-backlight` 5.0×），全部 parity fail。

## 3. 消费判定规则重新编号（用户指示：C0–C5 提法过时且编号失真）

**现状失真**：权威方案 `2026-09-06-no-ir-dual-channel-runtime.md` §4.3 只定义 **C0/C1（keep 声明）→ C3（输出全非几何）→ C5（positional VarRef 默认消费）**；代码后来加了 **C4**（无赋值裸调用不消费，P25 §3.7）未入册；**C2 从不存在**——编号有空洞，「C0–C5」名不副实。

**新编号（本方案定义，实施时全仓统一替换）**：

| 旧 | 新 | 规则 |
|---|---|---|
| C0/C1 | **R1** | keep 声明胜出（行内 keep 表 + 函数体 KeepRegistry）→ 不消费 |
| C4 | **R2** | 无赋值裸调用不消费（修改类经 inplaceWrites 走 producer 精确化） |
| C3 | **R3** | 有赋值但输出全非几何（纯数据/测量语句）→ 不消费输入 |
| — | **R4** | 嵌套 call-ref 内引用 = 只读查询，不消费（原 C5 内的 inCallRef 分支，升为显式规则）。**2026-10-06 复核后保留**：① 出处为本就是「选择器查询」语义（`2026-08-27-faijs-language-normalization-design.md:295`——`faceCenter(part2)` 不吃掉 part2）；② 语料实测（3,136 产品）：嵌套引用 1,684 处全部为同变量选择器（edgeRef/faceRef/vertexRef 挑选被加工对象自身的子元素），跨变量仅 2 处（`cad.extrude` + 跨变量 `faceRef`，删 inCallRef 会误杀）；③ **嵌套位置产生新 shape 的调用（`cad.drill(cad.box())` 形态）在语料中出现 0 次**——用户提议的删除场景当前不存在。结论：保留 R4；若未来语法放开嵌套 shape 生产调用，须同步把「嵌套位置产生几何 = 消费」补为 R4 的例外分支（届时以最小单测落判据） |
| C5 | **R5** | 默认消费：positional/args 顶层 VarRef/ExprRef 引用 → 消费 |
| — | **R6**（块单元） | 自由 JS 块词法级外部 shape 名引用 → 保守判消费 |

实施时同步更新：`live-shapes.ts` 注释、方案 §4.3/§296-301、相关测试名。**只改名不改行为**（纯重编号，单独一个 commit，与修复分开）。

## 4. 修复批次

| 批 | 内容 | 验收判据 |
|---|---|---|
| **E-1** | 根因最小复现：core 侧单测，用 Sliding_door 形态（`import_brep` 声明 + `mirror` 消费）构造 StatementSummary 断言 `lineConsumes` 返回值，定位 R2/R4/R5 哪层漏 | ✅ **已完成（2026-10-06）**。`packages/core/test/cad-runtime/live-shapes.test.ts` 新增 7 个复现用例（mirror/circularPattern/linearPattern/place × import_brep + fillet 链 + compound 并存 + R5 扫描锚点）**全部通过** ⇒ **漏判不在 R1–R6 扫描层**——`lineConsumes`/`computeLiveShapes` 对泄漏形态判定正确。**真正根因：op 内建 keep**。replicate 族 op 函数体显式声明 `keep(input)`（`api/replicate.ts:151/162/…/507` mirror；`:148` circularPattern；`api/pattern.ts:108/:115` linearPattern，注释明言 "copy-like keep semantics: replicate ops preserve their source shape"）⇒ 执行期经 KeepRegistry 登记到调用行 ⇒ **R1 短路「不消费」** ⇒ 源 shape 存活为（隐藏）终端。这与 boolean `keepHidden`（既有 C0/C1 机制锚点用例，TS35 solids 1vsN 的根因）**同族同机制**——是刻意设计，非扫描缺陷。fcstd 侧 D-1 双重导出是「replicate 保留源」语义与「assembly 已含变换后副本」的转换产物叠加的结果 ⇒ **修复方向修正**：不是改 `lineConsumes`，而是二选一：(a) fcstd 转换侧（本仓 codegen）在发射 mirror/pattern 后不再让源变量成为 assembly 之外的独立终端；(b) core 侧 replicate 族 keep 语义改为 keepHidden(false) 之外的第三态或由宿主决定。**E-2 待重新定题**（见 §4a） |
| **E-2** | **重新定题并实施（2026-10-06）**：按「CAD 操作者语义」分族处置——pattern 族（circularPattern/gridPattern/rectangularPattern/linearPattern）原件已融合进阵列结果 ⇒ `keep(input)` 改 **`keepHidden(input)`**（保留为隐藏终端：不渲染、不导出，历史锚点仍在，与 boolean 族同语义；`replicate.ts` 6 处 + `pattern.ts` 2 处 + import 补齐）；mirror/clone/mirrorJoin 维持 `keep(input)` 不变（操作者语义：镜像/复制后原件继续独立存在）。验证：`consume-input.test.ts` 13/13、`cad-runtime` 25 文件 348 用例全绿；fcstd-port 重装 0.29.6 后单样本探针实测——pattern 泄漏样本（arduino-mega / DN15_Stamped_Flange / smart-lcd-ramps）导出面收敛为**单 STEP**（泄漏终端消失），mirror/clone 样本（Sliding_door `0_Fillet` / C_0603 `0_Clone001`）保持不变（属 §4a-mirror 语义，待 codegen 议题） | pattern 泄漏样本导出面 = assembly 单件；mirror 样本不变；既有 keep 语义用例全绿 |
| **E-3** | 重编号（§3 表）单独 commit：代码注释 + 方案文档 + 测试名 | ✅ **已完成（2026-10-06）**：`live-shapes.ts` 注释、`live-shapes.test.ts`/`consume-input.test.ts` 用例名、no-IR 运行时方案 §4.3 全部改为 R1–R6（R2 标注「原 C4」、R5 标注「原 C5」），grep 零 C-残留；36/36 绿。commit `86a068aa` |
| **E-4** | 25 样本探针复测（fcstd-port `_d2-probe-terminals.mts`，单样本级） | ✅ **核心完成（2026-10-06）**。pattern 族：E-2 的 core 修复（`c0f596c4`）+ fcstd-port 换装 0.29.6 后，arduino-mega / DN15_Stamped_Flange / smart-lcd-ramps 导出面收敛为单 STEP ✅。mirror/clone 族：本仓 codegen roots 过滤（mirror/clone-only 消费的源变量并入 assembly members）+ 本仓 faijs 升 0.29.6 后 rebased-sweep 实测 9/10 RUN-OK，C_0603 / L_0603 / C_1206 / L_0805 / C_0402 / sw_smd_6.0x3.8 / Sliding_door / Single door with transom 收敛为 assembly 单件（Sliding_door 旧 `0_Fillet` 泄漏消失）✅。**残留登记**：① LED_0603 的 `Pocket` 被 `cad.mirrorJoin` 消费——mirrorJoin 族未列入收口（同族待议）；② Jante-Arriere 单样本 sweep 挂起未出结果，已终止进程待复测。**→ 两项均已收口（2026-10-06 追加）**：mirrorJoin 语义核实为「原物 replica[0] + 镜像 replica[1] fuse 成一体」（原件被吸收，同 pattern 族）⇒ core 侧 2 处 `keep→keepHidden`；fcstd-port lockfile 陈旧 integrity 清除后换装成功；rebased-sweep 复测 LED_0603 / Jante-Arriere 均收敛为**单 STEP**；cad-runtime 348 用例零回归 |
| **E-5** | 全量 parity 复跑 | **须用户批准**（不自动跑）；判据：PASS 集合只增不减、area 类 FAIL 显著下降 |

## 5. 风险

| ID | 风险 | 处置 |
|---|---|---|
| R-A | 修复把「合法终端」误杀（如用户故意让中间结果可见） | keep/keepHidden 是对外红线约定——用户可用 keep 显式保活；E-2 回归必须覆盖 keep 语义用例 |
| R-B | pattern/mirror 族 op 的消费语义与 pad/pocket 不同（返回新 shape 而非演化） | E-1 按 op 族分组构造用例，不整批改 |
| R-C | 重编号与在飞 PR 冲突 | E-3 独立 commit、改名单次完成 |

留存：fcstd-port `out/d2-anatomy.txt`、`out/d2-confirmed.json`、`tools/_d2-probe-terminals.mts`。
