# 约束 1 修复方案：函数体内引用顶层 const/let/function

> 状态：方案待评审
> 日期：2026-10-14
> 优先级：HIGH

## 1. 需求（用户原话）

> 「你说的这个场景，必须重新执行，这个场景里的函数内部引用顶层const很合理。所以我决定了，必须支持在函数体内引用顶层const」

用户要求：faijs 脚本中的函数体必须能引用顶层 `const`/`let` 变量和调用顶层函数。

典型场景：

```javascript
const SIZE = 5
function mk(d) { return cad.box(SIZE + d, SIZE, SIZE, { centered: true }) }
let part = mk(2)   // 期望：产出 7×5×5 的 box
```

当前行为：`SIZE is not defined`（两后端均失败）。

## 2. 当前行为（探针实测）

| 场景 | vm 后端 | interp 后端 |
|---|---|---|
| 函数体读顶层 `const` | `SIZE is not defined` | `SIZE is not defined` |
| 函数体读顶层 `let` | `SIZE is not defined` | `SIZE is not defined` |
| 函数体调用顶层函数 | `helper is not defined` | `helper is not defined` |
| 函数体读顶层 const + 用参数 | `SIZE is not defined` | `SIZE is not defined` |
| 嵌套函数读外层函数局部（D3 闭包） | 正常 | 正常 |
| 递归（函数体调用自身） | 正常 | 正常 |

**两后端行为一致**：都不支持函数体读顶层变量/调用顶层函数。递归和 D3 闭包（嵌套函数读外层函数局部）正常。

## 3. 根因分析

### 3.1 D2 设计决策

D2（`docs/plans/2026-09/2026-09-14-no-eval-interpreter-backend-design.md`）：函数体作为单一重放单元，不依赖外部脚本状态。保证：
1. 函数是纯的（只依赖参数）→ 同参数同结果
2. 重放确定性 → 改一行不影响函数语义
3. 双后端一致 → vm 和 interp 行为相同

**本方案放弃 D2 的第 1 点**（函数不再纯——可以闭包捕获顶层变量），保留第 3 点（双后端一致）。第 2 点（重放确定性）的影响见 §5。

### 3.2 interp 后端根因

`interp/env.ts:86`：

```typescript
if (this.kind !== 'function' && Object.prototype.hasOwnProperty.call(this.ctx, name)) {
  return { where: 'ctx', value: this.ctx[name] }
}
```

`this.kind !== 'function'` 条件让 function env **跳过 ctx 查找**。function env 的 `this.ctx` 是 `state.host.ctx`（全局 ctx，`closure.ts:47`），但 lookup 刻意不查它。

`interp/closure.ts:49`：

```typescript
this.defEnv.kind === 'root' ? undefined : this.defEnv,
```

如果定义环境是 root，parent 设为 `undefined`（丢弃 root parent）。这不影响 ctx 查找（ctx 在 `this.ctx` 里，不在 parent chain 里），但阻止了通过 parent chain 访问 root env 的 vars。

### 3.3 vm 后端根因

`direct-executor.ts:1022-1038` `transformFunction`：

```typescript
const bodyText = code.slice(node.body.start + 1, node.body.end - 1)  // 原始函数体文本
const binds = nsNames.map((n) => `  const ${n} = __ns.${n}`).join('\n')
const body = [
  `__ctx.${name} = async function ${name}(${params.join(', ')}) {`,
  binds,       // const cad = __ns.cad
  bodyText,    // 原始函数体文本（逐字嵌入）
  '}',
].join('\n')
```

`bodyText` 是**原始文本逐字嵌入**。函数体里的顶层变量名（`SIZE`）是自由标识符——在 `new Function` 的作用域里找不到（`SIZE` 在 `__ctx` 里，但函数体没有 `__ctx` 引用）。

递归能工作是因为具名函数表达式的名字（`async function fib(n)` 里的 `fib`）在函数作用域里绑定到函数自身。D3 闭包能工作是因为嵌套函数的 parent chain 保留了外层函数 env。

## 4. 修复方案

### 4.1 interp 后端（1 行改动）

`interp/env.ts:86`：去掉 `this.kind !== 'function'` 条件。

```typescript
// 改前：
if (this.kind !== 'function' && Object.prototype.hasOwnProperty.call(this.ctx, name)) {
// 改后：
if (Object.prototype.hasOwnProperty.call(this.ctx, name)) {
```

function env 的 `this.ctx` 是 `state.host.ctx`（全局 ctx）。去掉条件后，function env 也查 ctx → 函数体能读顶层变量（它们在 ctx 里）。

**不需要改 `closure.ts:49`**：ctx 查找走 `this.ctx`，不走 parent chain。parent chain 只查 `vars`（函数局部变量），保留丢弃 root parent 的逻辑不影响 ctx 查找。

**不需要改 `assign`**：用户只要求**读**顶层变量，不要求**写**。函数体里的 `let x = 1` 仍然写本地 vars（`assign` 的 `this.kind === 'function'` 分支），不写 ctx。函数体里的 `SIZE = 20`（赋值顶层变量）仍然写本地 vars（创建本地 SIZE，不修改 ctx SIZE）——这与 JS 的严格模式行为一致（不给未声明的变量赋值，但 SIZE 在 ctx 里... 实际上 `assign` 会写本地 vars 因为 `this.kind === 'function'`）。

> **待确认**：函数体里赋值顶层变量（`SIZE = 20`）应该写 ctx 还是本地？用户只要求读，暂不支持写。如果后续要支持写，需改 `assign`。

### 4.2 vm 后端（transformFunction 改造）

在函数体开头注入解构，把函数体引用的顶层变量从 `__ctx` 解构为本地变量：

```typescript
// 收集函数体引用的顶层变量名
const outerVars = this.collectFnBodyOuterRefs(node, declared, params)
const destruct = outerVars.length > 0
  ? `  const { ${outerVars.join(', ')} } = __ctx`
  : ''
const body = [
  `__ctx.${name} = async function ${name}(${params.join(', ')}) {`,
  binds,
  destruct,    // const { SIZE, helper } = __ctx
  bodyText,
  '}',
].join('\n')
```

#### 4.2.1 collectFnBodyOuterRefs 实现

遍历函数体 AST，收集引用位置的标识符，过滤出在 `declared` 里的（顶层变量/函数），排除函数参数和函数体内部声明的局部变量。

```typescript
private collectFnBodyOuterRefs(
  node: ASTNode,
  declared: Set<string>,
  params: string[],
): string[] {
  // 收集函数体里声明的局部变量（let/const/function/params）
  const localDeclared = new Set<string>(params)
  // 遍历函数体，收集声明
  this.collectDeclarations(node.body, localDeclared)
  // 收集函数体里引用的标识符
  const referenced = new Set<string>()
  this.collectReferences(node.body, referenced)
  // 顶层变量 = referenced ∩ declared，排除局部变量
  return [...referenced].filter(
    (v) => declared.has(v) && !localDeclared.has(v) && !this.hasNs(v)
  )
}
```

#### 4.2.2 同名冲突处理

如果函数体里有局部变量和顶层变量同名：

```javascript
const SIZE = 5
function mk() { let SIZE = 10; return cad.box(SIZE, SIZE, SIZE) }
```

`collectFnBodyOuterRefs` 会发现 `SIZE` 在 `localDeclared` 里 → 不解构 `SIZE` → 函数体里的 `SIZE` 解析到本地 `let SIZE = 10`。**正确语义**（局部遮蔽全局）。

如果函数体引用了顶层变量但没声明同名局部变量：

```javascript
const SIZE = 5
function mk() { return cad.box(SIZE, SIZE, SIZE) }
```

`collectFnBodyOuterRefs` 发现 `SIZE` 不在 `localDeclared` 里 → 解构 `const { SIZE } = __ctx` → 函数体里的 `SIZE` 解析到解构变量。**正确**。

#### 4.2.3 AST 遍历实现

用简单递归遍历 acorn AST。需要区分**声明位置**和**引用位置**的标识符：

| 节点类型 | 声明位置（不收集为引用） | 引用位置（收集为引用） |
|---|---|---|
| VariableDeclarator | `.id` | `.init` |
| FunctionDeclaration | `.id`, `.params` | `.body` |
| FunctionExpression / ArrowFunctionExpression | `.params` | `.body` |
| MemberExpression | —（property 当 computed=false 时不是引用） | `.object`, `.property`（当 computed=true） |
| ObjectPattern | `.properties[].key`, `.properties[].value` | — |
| AssignmentPattern | `.left`（声明） | `.right`（默认值） |
| ImportSpecifier | `.local` | — |

### 4.3 双后端一致性

| 场景 | interp 行为 | vm 行为 | 一致？ |
|---|---|---|---|
| 函数体读顶层 const | env.lookup 查 ctx → 找到 | 解构 `const { SIZE } = __ctx` → 找到 | ✅ |
| 函数体读顶层 let | 同上 | 同上 | ✅ |
| 函数体调用顶层函数 | 同上（函数在 ctx 里） | 同上（函数在 __ctx 里） | ✅ |
| 局部变量遮蔽顶层 | vars 优先于 ctx（lookup 先查 vars） | 本地声明优先于解构（JS 作用域规则） | ✅ |
| 函数体赋值顶层变量 | 写本地 vars（不写 ctx） | 写本地 vars（解构是 const，赋值报错） | ⚠️ 见下 |

**赋值行为差异**：interp 里函数体 `SIZE = 20` 会创建本地 SIZE（`assign` 的 function 分支写 vars）；vm 里解构是 `const { SIZE } = __ctx`，`SIZE = 20` 会报 TypeError（const 赋值）。

**解决**：解构用 `let` 而不是 `const`：`let { SIZE } = __ctx`。这样 vm 里 `SIZE = 20` 写本地解构变量（不写 __ctx），与 interp 行为一致（都不修改顶层变量）。

> 但 `let { SIZE } = __ctx` 解构出来的 SIZE 是可写的——函数体里 `SIZE = 20` 修改本地副本，不影响顶层 SIZE。这与 JS 闭包语义一致（闭包捕获的是变量引用，但 faijs 的 ctx 是值快照——解构创建的是值拷贝）。实际上 interp 也不修改 ctx（assign 写本地 vars），所以两后端一致：**都不支持函数体修改顶层变量**。

## 5. 影响面

### 5.1 D2 设计变更

D2 的「函数纯性」不再成立——函数可以闭包捕获顶层变量。影响：

- **重放确定性**：修改顶层变量后，调用函数的结果会变。这是**用户期望的行为**——用户认为函数体引用顶层 const 很合理。
- **增量执行**：修改顶层 `const SIZE = 20` 后，引擎重放该行 + 后续依赖行。如果函数 `mk()` 在 SIZE 之后，重放 `mk()` 会用新的 SIZE 值。**正确**。
- **函数缓存**：如果引擎缓存了函数调用结果（按参数缓存），修改顶层变量后缓存失效。目前 faijs 没有函数结果缓存（每次调用都重新执行），所以无影响。

### 5.2 现有测试

- `exec-backend-diff.test.ts`：现有函数测试（`mk(d)`、`fib(n)`、`adder(base)`）不引用顶层变量，不受影响。
- `update-incremental.test.ts`：增量重放测试不涉及函数体引用顶层变量。
- `direct-executor.test.ts`：可能有函数体引用顶层变量的负面测试（期望 ReferenceError）——需搜索确认。

### 5.3 文档更新

- `docs/library-dev-guide.zh.md:433`：约束 1 描述需更新（从「不支持」改为「支持」）。
- `docs/language-design.md`：§4.5 约束描述需更新。
- `interp/env.ts` 注释：D2 描述需更新。

## 6. 测试计划

### 6.1 双后端差分测试（exec-backend-diff.test.ts）

```typescript
describe('constraint 1: function body reads top-level vars', () => {
  it('function reads top-level const', async () => {
    const code = [
      'const SIZE = 5',
      'function mk(d) { return cad.box(SIZE + d, SIZE, SIZE, { centered: true }) }',
      'let part = mk(2)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('function calls top-level function', async () => {
    const code = [
      'function helper() { return cad.box(1, 1, 1, { centered: true }) }',
      'function mk() { return helper() }',
      'let part = mk()',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('local variable shadows top-level const', async () => {
    const code = [
      'const SIZE = 5',
      'function mk() { let SIZE = 10; return cad.box(SIZE, SIZE, SIZE, { centered: true }) }',
      'let part = mk()',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  // ... 更多用例
})
```

### 6.2 现有测试回归

- 全量 cad-runtime 测试（403 tests）
- 全量 lang 测试（410 tests）
- lint + typecheck

## 7. 实施步骤

1. interp：`env.ts:86` 去掉 `this.kind !== 'function'` 条件（1 行）
2. vm：`transformFunction` 加 `collectFnBodyOuterRefs` + 注入解构（~40 行）
3. 更新 `env.ts` 注释（D2 描述）
4. 写双后端差分测试
5. 跑全量测试验证
6. 更新 `docs/library-dev-guide.zh.md` 约束 1 描述

## 8. 待确认项

1. **函数体赋值顶层变量**：`SIZE = 20` 在函数体里应该写 ctx 还是本地？当前方案：两后端都写本地（不修改顶层变量）。如果用户要求支持写 ctx，需改 `assign`（interp）+ 解构用 `let`（vm）。
2. **解构用 const 还是 let**：如果函数体里不赋值顶层变量，用 const（更严格）；如果可能赋值，用 let。当前方案：用 let（与 interp 的 assign 行为一致）。