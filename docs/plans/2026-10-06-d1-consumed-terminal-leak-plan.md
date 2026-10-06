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
| **E-1** | 根因最小复现：core 侧单测，用 Sliding_door 形态（`import_brep` 声明 + `mirror` 消费）构造 StatementSummary 断言 `lineConsumes` 返回值，定位 R2/R4/R5 哪层漏 | 复现测试变红，且能指出具体规则层 |
| **E-2** | 修复消费判定（按 E-1 结论），回归 `live-shapes.test.ts` 全绿 | 25 样本的形态单测全过；**静态判据**：消费判定是纯静态语法分析，无运行期试探 |
| **E-3** | 重编号（§3 表）单独 commit：代码注释 + 方案文档 + 测试名 | grep 无残留 C0/C2/C3/C4/C5 提法（docs+src） |
| **E-4** | 25 样本探针复测（fcstd-port `_d2-probe-terminals.mts`，单样本级） | 每样本导出面不再含被消费变量；assembly 不变 |
| **E-5** | 全量 parity 复跑 | **须用户批准**（不自动跑）；判据：PASS 集合只增不减、area 类 FAIL 显著下降 |

## 5. 风险

| ID | 风险 | 处置 |
|---|---|---|
| R-A | 修复把「合法终端」误杀（如用户故意让中间结果可见） | keep/keepHidden 是对外红线约定——用户可用 keep 显式保活；E-2 回归必须覆盖 keep 语义用例 |
| R-B | pattern/mirror 族 op 的消费语义与 pad/pocket 不同（返回新 shape 而非演化） | E-1 按 op 族分组构造用例，不整批改 |
| R-C | 重编号与在飞 PR 冲突 | E-3 独立 commit、改名单次完成 |

留存：fcstd-port `out/d2-anatomy.txt`、`out/d2-confirmed.json`、`tools/_d2-probe-terminals.mts`。
