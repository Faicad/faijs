# Agent Note：cq-compat 对等验证 harness —— 用 AST 注入抓取上游测试几何

Status: proposed

[English](2026-09-08-cq-compat-cadquery-parity-harness.md) | 中文

## 问题

`@faicad/cq-compat` 从未与上游 CadQuery 做过等价性验证，就被直接用于移植 `packages/mini_lathe`。首次用真实 CadQuery 测量，结果 **7 个零件全部不等价**（体积偏差 0.03%–1.8%；`slide_mid` 连实体数量和包围盒都差 3 mm）。已定位的成因：选择器索引后缀（`faces(">Z[-2]")`、`faces("-Y")[1]`）被静默剥离、`cutBlind` 不遍历 `pushPoints`、`union` 返回复合体而非融合体。

CadQuery 自带套件里也没有可用的导出口径：`BaseTest.saveModel()` 确实会写 STEP，但只有 `test_cadquery.py` 中约 35% 的用例调用了它，**其余测试文件调用数为 0**，依赖它会产生大量拿不到参考几何的用例。

## Proposal

参考几何由 pytest 插件捕获，做法是**在内存中改写测试模块**（CadQuery 检出目录里的源文件一律不改）：自定义 `MetaPathFinder` 拦截白名单内的 `tests.*` 模块，把每个 `test_*` 的函数体重写成 `try: <原 body> finally: __CQ_EXPORT__(locals(), "<用例 id>")`。

- 用 `try/finally` 而不是在末尾追加语句，这样 `return`、断言失败、抛出异常三条路径都能触发导出。
- `locals()` 只产出**被命名的中间变量**（链式调用的中间对象都是匿名的），因此每用例导出数量约两个；更重要的是，变量名可以在镜像侧一一对应。
- 只对 `Workplane`（取 `.val()`）、`Assembly`（取 `.toCompound()`）和 `Shape` 中 `ShapeType()` 为 `Solid`/`Compound` 且 `Volume() > 1e-6` 的值导出，其余记录原因后跳过。
- 两侧都产出 `<module>__<Class>__<test>__<var>.step`，并用既有的 `compare-step.ts` / `compare-assembly.ts` 判定，不新增比对逻辑。在 `v2.8.0` 快照上对 10 个建模测试文件的实测：**622 用例全部通过、耗时 62 秒、305 个用例导出几何、 650 个 STEP 文件、20.7 MB**；47 次捕获被过滤（多为 `Vector` 类型值，以及上游 `exportStep` 本身 就写不出来的 `CompSolid`）。

## 已考虑的其他方案

- **依赖 `BaseTest.saveModel()`** —— 否决：单文件约 35%、其余文件 0% 的覆盖率，撑不起参考基线。
- **用 pytest 钩子（`pytest_pyfunc_call`）包装测试函数再读 `frame.f_locals`** —— 否决：不借助 `settrace` 就拿不到执行帧的局部变量。
- **`sys.settrace` + return 事件处理** —— 否决：运行开销大，且与同一轮里的覆盖率工具冲突。
- **追踪所有 `Workplane` 实例、按 `parent` 关系推导"叶子链"** —— 否决：叶子按创建顺序编号，而镜像侧的 faijs 脚本没有对应的中间对象，序号跨侧永远对不上。
- **每个用例手写一句导出** —— 否决：两三百到六百个用例、跨两种语言，无法维护，且上游一改就漂移。参考解释器、CadQuery 版本（`2.8.0`）、OCP 构建（`7.9.3.1.1`）与上游测试 tag 全部记入一个基线文件，由 harness 读取。测试源码取自 `git archive <tag> tests` 导出的快照，运行时绑定 site-packages 解释器、绝不绑定检出根目录，因此不会往 CadQuery 工作树写入任何内容。

## Acceptance criteria

1. 一条命令即可从锁定的基线复现参考资产，退出码为 0，且捕获到的用例数与运行报告一致 （10 个建模测试文件共 622 用例全部通过）。
2. 每次捕获失败都必须带原因上报，不允许静默失败；尤其要把 `Shape.exportStep()` 返回 `False` 判为失败，并且必须为自行加载的模块补上 `__file__` / `__package__`。
3. 两侧用例标识逐字相同，比对时按文件名配对，无需人工映射表。
4. 验证结果可执行：每个被阻塞的用例都要写清楚阻塞它的 op，且不得记为通过。
5. 修复后重跑 mini_lathe 比对：`slide_top` 与 `slide_mid` 各自为单一实体，体积相对偏差 ≤ 0.01%。

## Risks

- **基线漂移**：本机 CadQuery 检出停在 `a6bedc0`（`v2.8.0-20`，dev 分支，需要 OCP 8.0.1），与已安装的 `cadquery 2.8.0`（OCP 7.9）不兼容；一旦处理错判，就会在同一次参考运行里混入两个 CadQuery 版本。
- **导出静默丢失**：`Shape.exportStep()` 在输出目录不存在时返回 `False` 而不抛异常，会造成"报告成功、文件全无"。
- **loader 记账缺失**：手写 loader 不会设置 `__file__` / `__package__`，会让被拦截模块里的 `Path(__file__).parent` 失败。
- **OCCT 版本错配**：参考侧 OCP 7.9、faijs 侧 `occt-wasm` 3.8.0，圆角与倒角的面边数量本就不同；拓扑计数只作观察项，门禁依据是体积、质心、包围盒与双向布尔差。**绝不允许**通过放宽容差把失败用例 变成通过。
- **资产体积**：一次全量参考约 20 MB、耗时约 60 秒，CI 只能承载小规模 smoke 子集，全量 parity 报告 由本地作业产出。
