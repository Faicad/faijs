# Agent Note：ExecutionResult 装配声明与标识符提升的字符串保护区

Status: implemented

[English](2026-10-15-execution-result-assembly-decls.md) | 中文

## 问题

两个缺口阻碍宿主消费 `cad.assembly` 声明：

1. **声明在结果中不可达。** `ExecutionResult` 只带 `compounds`（成员名），
   约束 / 运动副声明仅存在于 compound 的 behavior slot 内，而 `getSlot`
   不是公开导出。宿主想在自己的侧面上解算装配，只能从 `outputs`
   里挑 compound 再逆向推导内部 slot 结构。
2. **标识符提升会腐化字符串字面量。** 方言的提升逻辑
   （`hoistBlockText`、`hoistText`）用文本级 `\b<name>\b` 全局替换
   重写已声明名字，不区分代码与字符串。在 `for` 循环体内，
   `parent: 'carrier'` 被发射成 `'__ctx.carrier'`；装配消费者随后
   把这个未知父级当作不存在，静默地把零件重新挂到场景根节点——
   一次没有任何诊断的静默错挂。

## 决策

- **`ExecutionResult.assemblies?: AssemblyDecl[]`** —— 每个 `cad.assembly`
  语句一条：`{ name?, memberNames, constraints, joints, solver, compound }`
  （即 behavior 的声明字段加上 compound 引用；刻意不含
  `solve` / `solveDetailed` 方法）。收集在 `collectDirectResult`，
  与 `compounds` 同源。`AssemblyDecl` 与 `AssemblyBehavior` 同在
  `extra/ops/compound.ts`，并从 `@faicad/faijs/extra` 再导出。
- **`AssemblyBehavior.kind?: 'group' | 'assembly'`** 判别两种 compound
  生产者。`group` 的产物留在 `compounds` 但不进 `assemblies`：
  group 没有约束也没有运动副，解一个空约束集会撞上消费侧的
  欠定诊断。
- **提升跳过保护区。** `collectHoistProtectedRanges` 解析文本
  （先 module，后 `(function(){ … })` 回退——与 `hoistBlockText`
  原有策略相同），收集字符串字面量区间、模板字面量 quasi 区间、
  注释区间。`replaceOutsideProtected` 逐条顺序应用替换
  （后续替换照旧看到先前替换的输出），但完整落在保护区内的匹配
  原样保留。全部四条提升替换——for-of 头部、声明左值、自由引用、
  命名空间绑定——在 `hoistBlockText` 和 `hoistText` 中都走它。
  自由引用与命名空间替换合并为单趟交替匹配（与原先逐名顺序
  替换等价：插入的 `__ctx.` / `__ns.` 前缀含 `_` 与 `.`，本身就是
  词边界断点，名字不会被另一个名字的模式二次匹配）。

## 考虑过的替代方案

- 暴露 `assemblyBehaviorOf(shape)` 访问器而非结果字段：否决——宿主
  仍然得自己在 `outputs` 里发现 compound，声明面离结果契约永远
  隔一层间接。
- 让消费者自己从 `assemblies` 里过滤 `group`：否决——排除与否是
  源码层面的事实（无约束/运动副），属于生产者的职责；判别符
  同时也在 behavior 上记录了意图。
- 像 `transformArg` 那样在 AST 上重写块级提升：暂缓——块级路径
  刻意是文本级的（其文档化的 v1 限制就包括嵌套作用域）；
  区间保护用最小 diff 消除了字符串腐化这一类问题。AST
  重写留作未来选项。
- 解析失败回退到无保护替换：保留（不是替代方案而是边界）——
  无法独立解析为 JS 的片段（如对象方法的简写属性）维持旧行为，
  不抛错。

## 工程备注

- **对称腐化对 parity 测试隐形。** 落地合并交替替换时，一个非捕获
  组（`(?:a|b)` 而发射器读 `$1`）让每个被提升的名字都成了
  `__ctx.undefined`；vm/interpreter parity 测试照样通过，因为两个
  后端发射出同样坏掉的文本。抓住它的是 `direct-executor.test.ts`
  里的发射文本断言——行为级 parity 看不见对称变换 bug。
- 正则字面量不受保护（只保护字符串、模板文本、注释）；安全扫描器
  已对它们有限制，且方言代码路径不求值它们。

## 后果

- 宿主从 `ExecutionResult.assemblies` 读声明，在自己的侧面上解算。
  对它们而言烘焙仍是禁止的：调用 `asm.solve()` / `do_assemble()`
  会把变换作用到几何顶点上，宿主再拿它做动画就会双重定位。
- 下游钉住这个提升缺陷的金丝雀（当前错误值 `'__ctx.carrier'`，
  应有值 `'carrier'`）一旦消费到含此变更的 faijs 构建即翻绿。

## Testing

- `packages/core` 套件全绿：347 个文件，3921 通过 / 13 跳过。
- 新测试：`test/cad-runtime/direct-executor.test.ts` 6 个
  （字符串 / 模板 / 注释 / 命名空间文本保护、真实引用无误伤、
  双后端端到端），`test/cad-runtime/runtime.test.ts` 2 个
  （装配声明字段；`group` 排除 + 声明顺序）。
- API 覆盖门禁通过（`check-api-test-coverage`），typecheck 通过。
