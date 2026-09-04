# 方案：mech-lib 重命名为 gear-lib-demo + 修复库名加载不匹配 bug + 自动注册可行性分析

**状态：方案（未实施）**

## 用户需求

用户原话（第一轮）：

> 我需要把库mech-lib重命名为gear_lib_demo。
>
> 然后在packages\demo项目里，要添加一个测试的.fai.js案例，演示gear库的使用。

用户原话（第二轮）：

> 这样，把库mech-lib重命名为gear-lib-demo。所有地方都必须用这个名字，没有例外，mech-lib、gear-lib都必须改过来。此外，排查一下，为何之前用gear-lib不报错，是哪里的问题，怎么可能允许这种错误存在。这只能说明代码是错误的，没有真正加载库，否则库的名字是mech-lib，怎么可能gear-lib能加载？!
>
> 给我更新方案，彻底解决库的名字加载不匹配的问题。

用户原话（第三轮）：

> 你他妈还在写这种垃圾？import * as gear from 'gear-lib' ？？？明明要求全部一致。 还有，能否在parse解析的时候，主动调用registerLib ，而不是host宿主手动注入？分析这个方案的可行性。

## Bug 排查：import specifier 与 registerLib binding 不匹配为何不报错

### 现象

测试中存在以下代码模式：

```js
// 测试侧（gear.test.ts / c3-scenario.test.ts / mech-lib-flow.test.ts）
runtime.registerLib('gear', gear, { compat: true })
await runtime.execute([
  "import * as gear from 'gear-lib'",   // specifier = 'gear-lib'
  'let g1 = gear.external({ teeth: 24, ... })',
].join('\n'))
```

包名是 `@faicad/mech-lib`（或 `@facad/mech-lib`），`registerLib` 的 binding 是 `'gear'`，脚本 import 的 specifier 是 `'gear-lib'`。三者各不相同，但执行成功，不报错。

### 根因

**import specifier 在整个执行链路中从未被用于运行时库查找。** 库查找完全依赖绑定名（`import * as X` 中的 `X`），specifier 只是语法装饰。

详细追踪：

1. **Parser 层**（`packages/core/src/lang/parser.ts`）：
   - 第 1588 行：`importBindings.set(imp.localName, imp.packageName)`——建立 `gear → 'gear-lib'` 映射，但 `packageName` 从未被运行时查询
   - 第 1592 行：`isNamespaceName(name)` 只检查 `importBindings.has(name)`——即只检查 `gear` 这个绑定名是否被声明过，不检查 specifier 指向的包是否真实存在
   - 第 857 行：`const nsName = callee.object.name`——namespace 取的是绑定名 `gear`
   - 第 883 行：`{ namespace: nsName }`——StatementIR.namespace 存的是绑定名 `gear`，不是 specifier `'gear-lib'`

2. **Compile 层**（`packages/core/src/lang/compile.ts`）：
   - 第 1 行注释明确说"零 import ESM 模块"——编译产物不含任何 import 语句
   - 第 232 行：`const nsExpr = \`ns.${stmt.namespace ?? 'cad'}\``——编译为 `ns.gear.external(...)`，用绑定名
   - 第 383-384 行：函数体绑定名收集只用 `imp.localName`，不用 specifier

3. **Runtime 层**（`packages/core/src/cad-runtime/runtime.ts`）：
   - 第 361 行：`this.libs[binding] = admitted`——`registerLib('gear', ...)` 存入 `libs['gear']`
   - 第 1405-1406 行（check 阶段）：`const ns = stmt.namespace`（=`'gear'`），`const lib = this.libs[ns]`（=`libs['gear']`）——用绑定名查找，与 specifier 无关

4. **ModuleExecutor 层**（`packages/core/src/cad-runtime/module-executor.ts`）：
   - 第 274 行：`compiled.fn(this.ctx, this.namespaces)`——`this.namespaces` 是 `this.libs` 的浅拷贝，`ns.gear` 就是 `libs['gear']`
   - 第 639 行：`source.namespace ?? this.defaultNsName`——statementKey 用绑定名

**结论：import specifier `'gear-lib'` 只存入 `ScriptIR.imports` 数组的 `specifier` 和 `packageName` 字段，在整个执行链路中没有任何代码消费这两个字段做运行时查找或校验。** 脚本写 `import * as gear from '任意字符串'` 都能工作，只要 `registerLib('gear', ...)` 已注册。

### 为什么这是 bug

1. **静默错误**：用户在脚本中写了错误的库名（如 `'gear-lib'` 而实际包名是 `'mech-lib'`），引擎不报错，给用户虚假的"库已加载"印象
2. **丧失校验能力**：`check()` 方法的符号检查只查 `libs[ns]`（绑定名），不校验 import specifier 是否对应一个已注册的库
3. **与设计意图矛盾**：parser 推导了 `packageName` 字段，types.ts 注释说"statementKey 包名前缀 / 宿主 getFeatureByOp 用"——但 statementKey 实际用的是绑定名，不是 packageName

## 自动注册可行性分析

用户问：能否在 parse 解析时主动调用 `registerLib`，而不是 host 手动注入？

### 当前架构

当前库注册流程是 **host 手动注入**：

1. host 创建 runtime：`const rt = createRuntime(ports, mode)`
2. 根门面 `src/index.ts` 自动注入 `cad` 命名空间（`rt.registerLib('cad', createApiNamespace(), { default: true })`）
3. host 额外调用 `rt.registerLib('gear', gearModule, { compat: true })` 注入第三方库
4. host 调用 `rt.execute(code)` 执行脚本

编译产物是**零 import 的 ESM 模块**（`compileToModule` 第 1 行注释："不含任何 import 语句"）。脚本中的 `import * as gear from 'gear-lib-demo'` 在编译时被消灭——parser 提取绑定名 `gear`，编译器发射 `ns.gear.external(...)`，import 语句本身不进入编译产物。

### 不可行的原因

**parse 是纯同步操作**，不能发起网络请求或动态 `import()`：

- `parseScript(code)` 是同步函数，返回 `ScriptIR`
- 自动注册需要加载库模块（`await import(url)`），这是异步操作
- 库模块可能来自 CDN（浏览器）、本地文件系统（Node CLI）、workspace symlink（测试环境）——加载方式与环境强相关

### 可行的方案：execute 阶段自动加载

虽然 parse 阶段不能自动注册，但 **execute 阶段可以**。`execute` 已是 `async` 方法，在 parse 之后、语句执行之前，可以插入一个自动加载步骤。

#### 方案设计

1. **HostPorts 新增 `libLoader` 端口**：

```ts
export interface LibLoader {
  /** 按 packageName 加载库模块，返回其导出对象 */
  loadLib(packageName: string): Promise<StdlibNamespace>
  /** 列出已注册的 packageName（供 check 阶段校验） */
  listLibs(): string[]
}
```

2. **Runtime.executeIR 自动加载**：在 `compileToModule` 之前，遍历 `script.imports`，对每个 namespace import 的 packageName 调用 `ports.libLoader?.loadLib(packageName)`，如果该 binding 尚未注册则自动 `registerLib`：

```ts
async executeIR(script: ScriptIR, opts?: ExecuteOptions): Promise<ExecutionResult> {
  // 自动加载未注册的库
  if (this.ports.libLoader) {
    for (const imp of script.imports ?? []) {
      if (imp.kind !== 'namespace') continue
      const binding = imp.localName
      if (this.libs[binding]) continue  // 已注册（host 手动注入或之前自动加载）
      const ns = await this.ports.libLoader.loadLib(imp.packageName)
      this.registerLib(binding, ns, { compat: true, packageName: imp.packageName })
    }
  }
  // ...后续编译执行不变
}
```

3. **check 阶段也利用 libLoader 校验**：如果 `libLoader` 存在，校验 import specifier 的 packageName 是否在 `libLoader.listLibs()` 中；如果不存在 `libLoader`，回退到当前行为（不校验 specifier）。

#### 各宿主实现

- **Node CLI**（`packages/core/src/node-host/`）：`libLoader.loadLib(packageName)` 用 `await import(packageName)` 或 `await import(resolve(packageName))` 加载 npm 包
- **浏览器 demo**（`packages/demo/main.ts`）：`libLoader.loadLib(packageName)` 用静态字面量 `import()` 加载——不能对变量参数 `import(packageName)`（Vite/Rollup 无静态分析，build 后裸跑会失败），须用静态 `LIB_MODULES` 映射表（见第四部分 4.4），经 vite alias 或 CDN importmap 落位
- **测试环境**：vitest alias 已将 `@faicad/gear-lib-demo` 映射到源码，`libLoader` 直接 `await import('@faicad/gear-lib-demo')`

#### 与 module-resolver 的关系

`module-resolver`（`packages/core/src/module-resolver/resolver.ts`）是独立的纯函数模块，做 specifier → URL 的文本重写（importmap 机制）。当前 `compileToModule` 产出零 import 模块，module-resolver 没被 runtime.execute 调用。

采用本方案的自动加载后，module-resolver 可在 `libLoader` 实现内部使用：`libLoader.loadLib(packageName)` 先用 `resolveImports` 将 packageName 解析为 URL，再 `await import(url)`。但这是 libLoader 实现的细节，不影响 runtime 接口。

#### 优势

- 脚本只需写 `import * as gear from 'gear-lib-demo'`，host 不需手动 `registerLib`
- import specifier 必须与 packageName 匹配（libLoader 按 packageName 加载），彻底解决不匹配问题
- host 仍可手动 `registerLib` 覆盖自动加载（优先级：已注册的 binding 不被自动加载覆盖）

#### 风险

- **安全性**：自动 `import(packageName)` 会加载任意模块，需在 libLoader 实现中做白名单校验（module-resolver 已有此机制：未登记的裸 specifier 抛 `UnresolvedImportError`）
- **性能**：首次加载库模块需网络请求；可缓存已加载模块
- **异步 check**：`check()` 当前是同步方法，如果需要校验 specifier 是否可加载，需改为 async 或只做静态注册表校验（`libLoader.listLibs()`）

### 结论

**parse 阶段自动注册不可行**（同步 vs 异步冲突），但 **execute 阶段自动加载可行且推荐**。本方案由四部分组成：① 修复 specifier 校验 bug；② mech-lib → gear-lib-demo 重命名；③ demo 齿轮案例；④ execute 阶段自动加载落地（原标注为「后续增强」，现纳入本方案实施，见 `实施方案 / 第四部分`）。

## 实施方案

### 第一部分：修复 import specifier 校验 bug

#### 1.1 registerLib 增加 packageName 声明

**修改文件**：`packages/core/src/cad-runtime/runtime.ts`

`registerLib` 新增 `packageName` 可选参数，建立 `packageName → binding` 映射：

```ts
private readonly specifierToBinding = new Map<string, string>()

registerLib(
  binding: string,
  ns: StdlibNamespace,
  options?: { default?: boolean; compat?: boolean; packageName?: string },
): void {
  // ...existing code...
  if (options?.packageName) {
    this.specifierToBinding.set(options.packageName, binding)
  }
  // ...existing code...
}
```

#### 1.2 check() 阶段增加 import specifier 校验

**修改文件**：`packages/core/src/cad-runtime/runtime.ts` 的 `check()` 方法

在符号检查之前新增 import specifier 校验：

```ts
for (const imp of script.imports ?? []) {
  if (imp.kind !== 'namespace') continue
  const binding = this.specifierToBinding.get(imp.packageName)
  if (!binding) {
    errors.push({
      stage: 'symbol',
      message: `import specifier "${imp.specifier}" is not registered (registerLib has no binding for package "${imp.packageName}")`,
    })
    continue
  }
  if (!this.libs[binding]) {
    errors.push({
      stage: 'symbol',
      message: `import specifier "${imp.specifier}" maps to binding "${binding}" which is not registered`,
    })
  }
}
```

#### 1.3 根门面 createRuntime 声明 packageName

**修改文件**：`src/index.ts`

```ts
rt.registerLib('cad', createApiNamespace(), {
  default: true,
  compat: false,
  packageName: '@faicad/faijs',
})
```

#### 1.4 CLI 入口声明 packageName

**修改文件**：`packages/core/scripts/faijs-cli.ts`

当前 CLI 入口直接传 `{ cad: createApiNamespace() }` 给 `cliMain`，不经过 `registerLib`。需改为使用根门面的 `createRuntime`（自动注入 cad 带 packageName），或在 `cliMain` 中补充 `registerLib` 调用。

### 第二部分：mech-lib → gear-lib-demo 重命名

#### 2.1 统一命名

所有地方使用 `gear-lib-demo`，无例外：

- npm 包名：`@faicad/gear-lib-demo`
- 目录名：`packages/gear-lib-demo/`
- import specifier：`'gear-lib-demo'`
- registerLib packageName：`'gear-lib-demo'`
- registerLib binding：`'gear'`（绑定名，即 `import * as gear` 中的 `gear`，与包名独立）

**任何地方出现 `mech-lib` 或 `gear-lib`（不含 `-demo` 后缀）都必须改为 `gear-lib-demo`。**

#### 2.2 目录重命名

`packages/mech-lib/` → `packages/gear-lib-demo/`

#### 2.3 包名修改

`packages/gear-lib-demo/package.json`：

```json
{
  "name": "@faicad/gear-lib-demo",
  "peerDependencies": {
    "@faicad/faijs": "*",
    "occt-wasm": "^3.8.0"
  }
}
```

修复已有 typo（`@facad` → `@faicad`）。

#### 2.4 全量替换清单

**包自身：**
- `packages/gear-lib-demo/package.json` — name 字段、peerDependencies typo 修复
- `packages/gear-lib-demo/src/index.ts` — JSDoc 注释中所有 `mech-lib` / `@faicad/mech-lib` → `gear-lib-demo` / `@faicad/gear-lib-demo`
- `packages/gear-lib-demo/src/gear.ts` — JSDoc 注释中 `@faicad/mech-lib` → `@faicad/gear-lib-demo`，`gear-lib` → `gear-lib-demo`
- `packages/gear-lib-demo/src/mock-mech-brep.ts` — 注释中 `mech-lib` → `gear-lib-demo`
- `packages/gear-lib-demo/src/mock-mech-mesh.ts` — 注释中 `mech-lib` → `gear-lib-demo`
- `packages/gear-lib-demo/src/mock-lib.test.ts` — fixture 字符串 `'mech-lib'` → `'gear-lib-demo'`
- `packages/gear-lib-demo/src/b7-no-face-evolution.test.ts` — fixture 字符串 `'mech-lib'` → `'gear-lib-demo'`
- `packages/gear-lib-demo/src/gear.test.ts` — `registerLib` 调用加 `packageName: 'gear-lib-demo'`，fixture `'gear-lib'` → `'gear-lib-demo'`
- `packages/gear-lib-demo/src/c3-scenario.test.ts` — 同上

**根配置：**
- `package.json` — workspaces 数组、lint 脚本
- `tsconfig.host.json` — paths 映射
- `lefthook.yml` — eslint glob
- `AGENTS.md` — 架构描述

**CI 脚本：**
- `scripts/ci.ps1` — madge 命令参数
- `scripts/ci.sh` — 同上
- `scripts/check-vendored-branding.mjs` — A4 目录列表、迁移豁免登记

**tests 包：**
- `packages/tests/package.json` — dependencies
- `packages/tests/vitest.config.ts` — alias
- `packages/tests/tsconfig.json` — paths
- `packages/tests/faijs/compat-e2e/mech-lib-flow.test.ts` — 文件名改为 `gear-lib-demo-flow.test.ts`；import 路径；`registerLib` 加 `packageName`；fixture specifier → `'gear-lib-demo'`；注释
- `packages/tests/faijs/module-resolver/module-resolver.test.ts` — fixture 字符串

**core 源码（注释 + fixture 字符串，非运行时逻辑）：**
- `packages/core/src/sdk.ts`
- `packages/core/src/lang/parser.ts`
- `packages/core/src/lang/types.ts`
- `packages/core/src/lang/compile.ts`
- `packages/core/src/cad-runtime/runtime.ts`
- `packages/core/src/api/internal/l3-bridge.ts`
- `packages/core/src/lang/function-def.test.ts`
- `packages/core/src/lang/f2-imports-namespace.test.ts`
- `packages/core/src/cad-runtime/runtime.test.ts`

**文档：**
- `README.md` / `README.zh.md`
- `docs/ops-api-inventory.md` / `.zh.md`
- `docs/library-dev-guide.md` / `.zh.md`
- `docs/api-contract.md` / `.zh.md`

#### 2.5 workspaces 拓扑顺序

`check-workspaces-order.mjs` 断言 workspaces 数组顺序与依赖拓扑一致。`gear-lib-demo` 依赖 `@faicad/faijs`，位置与当前 `mech-lib` 相同，无需调整顺序。

### 第三部分：demo 添加齿轮演示 .fai.js 案例

#### 3.1 示例文件

新建 `packages/demo/examples/gear-demo.fai.js`：

```js
import * as gear from 'gear-lib-demo'

let g1 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })
let u1 = cad.union(g1, t1)
```

import specifier 使用 `gear-lib-demo`（与 `registerLib` 的 packageName 一致）。

#### 3.2 demo 集成：libLoader 自动加载接管

**vite.config.ts alias 新增：**

```ts
alias: [
  { find: '@faicad/faijs-core', replacement: resolve(__dirname, '../core/src') },
  { find: '@faicad/faijs', replacement: resolve(__dirname, '../../src') },
  { find: '@faicad/gear-lib-demo', replacement: resolve(__dirname, '../gear-lib-demo/src/index.ts') },
],
```

**main.ts 修改（配合第四部分 4.4 的浏览器 libLoader）：**

文件顶部添加导入：

```ts
import * as gearLib from '@faicad/gear-lib-demo'
```

`createBrowserPorts` 注入 `libLoader`（静态 `LIB_MODULES` 映射表，见 4.4）——gearLib 供该映射表静态引用；`runMode` 中不再手动 `registerLib('gear', gearLib, …)`，execute 阶段按 import specifier 自动装载 `gear` 绑定：

```ts
const runtime = createRuntime(ports, view.mode)
const result = await runtime.execute(code)
```

（保留手动 `registerLib` 也不冲突：binding 已注册时自动加载跳过。demo 以自动加载为演示主链路，使 gear-demo 案例只有在 specifier 与 packageName 严格一致时才能运行——不一致 → 自动装载失败 → 显式报错，不再静默）。

#### 3.3 EXAMPLES 记录与下拉菜单

**`main.ts` 的 `EXAMPLES` 记录新增条目：**

```ts
'gear-demo': `import * as gear from 'gear-lib-demo'

let g1 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })
let u1 = cad.union(g1, t1)`,
```

**`index.html` 的 `<option>` 新增：**

```html
<option value="gear-demo">Gear Library Demo</option>
```

#### 3.4 e2e 测试

gear 库是 brep-only（`compatOp`），mesh 模式会抛 `E_MESH_UNSUPPORTED`。从 `EXAMPLE_SNIPPETS` 中排除 gear-demo，单独写测试断言 brep 成功 + mesh unavailable。

### 第四部分：execute 阶段自动加载实现

可行性已按当前源码逐一验证：
- `parseScript` 是同步函数（packages/core/src/lang/parser.ts）——parse 期内无法发起异步 `import()` 装载库模块 → **parse 阶段自动注册不可行**；
- `execute` / `executeIR` / `updateIR` / `appendIR` 均为 `async`（packages/core/src/cad-runtime/runtime.ts），可在 parse 之后、`compileToModule` 之前插入自动加载 → **execute 阶段自动加载可行**；
- `ScriptIR.imports` 在 parse 期已解析出 `specifier` / `kind` / `localName` / `bindings?` / `packageName`（packages/core/src/lang/types.ts 的 `ImportIR`），自动加载无需对代码二次解析；
- `registerLib(binding, ns, { compat })` 已存在（runtime.ts），配合第一部分 1.1 新增的 `packageName` 存档，即可完成「按 specifier 装载 → 注册 binding」的闭环。

#### 4.1 HostPorts 新增 libLoader 端口

**修改文件**：`packages/core/src/cad-runtime/ports.ts`

`HostPorts` 增加可选字段 `libLoader?`（与 csg / sdf / fonts 等可选能力端口同形；`ports.ts` 需 `import type { StdlibNamespace } from '../runtime-state'`，纯 type-only 导入，无环）：

```ts
/** 库加载器：execute 阶段按 import 的 packageName 自动加载第三方库。 */
export interface LibLoader {
  /** 按包名加载库模块，返回其导出命名空间对象（与 registerLib 的 ns 同形）。 */
  loadLib(packageName: string): Promise<StdlibNamespace>
  /** 列出当前可加载的 packageName（check 阶段同步校验 import specifier 用）。 */
  listLibs(): string[]
  /** 自动装载的注册选项；缺省 { compat: true }（第三方库经 compat 边界收口，与手动注入一致）。 */
  options?: { compat?: boolean }
}
```

#### 4.2 CadRuntime 自动装载 autoLoadLibs

**修改文件**：`packages/core/src/cad-runtime/runtime.ts`

新增私有方法，并在三个执行入口各插 `await` 调用：

```ts
/** parse 之后、编译之前：按 script.imports 自动装载未注册的库（execute 阶段，不回退不静默）。 */
private async autoLoadLibs(script: ScriptIR): Promise<void> {
  if (!this.ports.libLoader) return
  for (const imp of script.imports ?? []) {
    if (imp.kind !== 'namespace') continue   // 命名空间 import 才映射语句绑定；named/default 不在此装载
    if (this.libs[imp.localName]) continue   // 已注册（宿主手动注入或已自动装载）→ 不覆盖
    const ns = await this.ports.libLoader.loadLib(imp.packageName)
    this.registerLib(imp.localName, ns, {
      compat: this.ports.libLoader.options?.compat ?? true,
      packageName: imp.packageName,          // 复用第一部分 1.1 的 packageName 存档，与手工注入同一条 specifier 校验/映射体系
    })
  }
}
```

- `executeIR`：在 `claimBackends()` 之后、`compileToModule(script)` 之前调用；
- `updateIR` / `appendIR`：同样在各自 `compileToModule(script)` 之前调用——增量路径传的也是（累计）全量脚本文本，import 段都在其中；**三个入口都必须装载**，否则只走 execute 的脚本一旦切到 update/append 会漏载库。

装载失败（`loadLib` 抛错 / 返回被拒绝的 promise）：**不回退、不静默**。自动装载发生在 parse 之后、编译之前，把加载错误统一归入 `ExecutionResult.failedAt`（与语句失败同一错误容器，message 注明是 import specifier 无法解析 / 库未在 libLoader 中登记）——而不是像现状那样执行期在 `ns` 上抛 TypeError。

#### 4.3 check() 与 libLoader 协同

**修改文件**：`packages/core/src/cad-runtime/runtime.ts` 的 `check()` 方法

- 有 `libLoader`：import specifier 校验改为查 `libLoader.listLibs()` 静态注册表——packageName 不在清单 → `stage:'symbol'` 报错「import specifier 未登记：libLoader 无法自动装载」；
- 无 `libLoader`：回落第一部分 1.1 / 1.2 的 `specifierToBinding` 手工注册校验；
- 保持同步：`check()` 只查静态注册表，不调用异步 `loadLib`。

demo 在执行前先用 `check(code)` 预检（packages/demo/main.ts `runCode()` 现有流程）；libLoader 装配后，gear-demo 的 import specifier 在预检期就被识别为可装载，不会误报「未注册」。

#### 4.4 各宿主实现

**Node CLI**（`packages/core/src/node-host/cli.ts` / `createNodePorts`）：登记白名单后用 Node 原生 `import()` 加载裸包（monorepo workspace symlink 直接把裸包解析到包源码，无需 URL 构造）：

```ts
import type { LibLoader } from '../cad-runtime/ports'
import type { StdlibNamespace } from '../runtime-state'
const cliLibLoader: LibLoader = {
  loadLib: async (name) => {
    const allowed = new Set(['@faicad/gear-lib-demo'])
    if (!allowed.has(name)) throw new Error(`[faijs] CLI: 未登记的库 "${name}"`)
    return (await import(name)) as StdlibNamespace
  },
  listLibs: () => [...new Set(['@faicad/gear-lib-demo'])],
}
```

**浏览器 / demo**（`packages/demo/main.ts`）：libLoader 经 `createBrowserPorts` 注入 `HostPorts`（`createRuntime(ports, view.mode)` 原样透传，无需改门面）。

⚠️ **浏览器动态 import 必须静态字面量**：Vite/Rollup 对 `import(packageName)` 里的**变量参数**做不了静态分析，production build 会遗留运行时裸 `import('...')`，浏览器端 404/失败。必须用**静态映射表**，令 loader 内每个 `import('@faicad/gear-lib-demo')` 都是字面量 specifier（可被 vite alias / rollup 解析打包）：

```ts
import * as gearLib from '@faicad/gear-lib-demo'  // 静态 import，供映射表引用 + 打包
const LIB_MODULES: Record<string, () => Promise<StdlibNamespace>> = {
  // key 必须是 registerLib packageName；value 必须是静态字面量 specifier
  '@faicad/gear-lib-demo': () => import('@faicad/gear-lib-demo'),
}
const demoLibLoader: LibLoader = {
  loadLib: async (name) => {
    const loader = LIB_MODULES[name]
    if (!loader) throw new Error(`[faijs] demo: 未登记的库 "${name}"`)
    return await loader()
  },
  listLibs: () => Object.keys(LIB_MODULES),
}
```

`@faicad/gear-lib-demo` 到 `packages/gear-lib-demo/src/index.ts` 的 vite alias（第三部分 3.2）正是让这个静态 import 落位活源码；dev 与 build（rollup 外联）一致生效。

**vitest / 测试**（`packages/tests/vitest.config.ts`）：alias 已把 `@faicad/mech-lib`（重命名后 `@faicad/gear-lib-demo`）映射到活源码，测试环境的 libLoader 复用上面浏览器映射表写法 + `await import('@faicad/gear-lib-demo')`，零额外配置。

#### 4.5 与其它部分的配合

- 第一部分 1.1 的 `registerLib` `packageName` 参数是自动装载的落位前提：4.2 的 `registerLib(…, { packageName })` 会把自动装载出来的库一并写进 `specifierToBinding`，与手工注入共享同一套校验/映射，绕不开 specifier 校验；
- 第三部分 3.2：demo 由「手动 `registerLib('gear', gearNs, { compat: true, packageName: 'gear-lib-demo' })`」改为「`createBrowserPorts` 注入 `libLoader` + auto-load」——gear-demo 案例完整走自动加载：import specifier 与 packageName 必须严格一致，不匹配 → 自动装载失败 → 显式报错（正是本方案要根治的「名字不符却能跑」的 bug 形态）；
- module-resolver（`packages/core/src/module-resolver/resolver.ts`）保持纯函数（importmap 文本重写），不被 runtime 直接调用；宿主若走「packageName → CDN URL → 动态 import」路线，可在其之上封装，不影响 runtime 接口。

#### 4.6 测试新增（归入下文「测试计划」）

- 已注册 binding + libLoader 存在 → autoLoadLibs 跳过，`libs['gear']` 仍是手动注入实例（不覆盖）；
- 未注册 + libLoader 可装载 → execute 后 `gear.external(...)` 正常产出 brep Shape（绑定名 `gear` 由 specifier 关键字自动注入）；
- 未注册 + libLoader 不可装载（不在 listLibs / loadLib 抛错）→ `ExecutionResult.failedAt` 非空且 message 提及 import specifier 无法加载（不回退、不静默）；
- `check()` 无 libLoader → 走 specifierToBinding（第一部分 1.2）校验，specifier 未登记报错；
- `check()` 有 libLoader → 走 listLibs 校验，gear-demo 的 import specifier 预检通过；
- demo e2e 的 gear-demo：brep 链路渲染成功；mesh 链路 E_MESH_UNSUPPORTED（brep-only，无回退）。

## 实施步骤

1. **修复 bug**：`runtime.ts` 的 `registerLib` 增加 `packageName` 参数和 `specifierToBinding` 映射；`check()` 增加 specifier 校验
2. **根门面**：`src/index.ts` 的 `createRuntime` 包装注入 cad 时声明 `packageName: '@faicad/faijs'`
3. **重命名**：`git mv packages/mech-lib packages/gear-lib-demo`，全量替换所有 `mech-lib` → `gear-lib-demo` 和 `gear-lib` → `gear-lib-demo`
4. **更新测试**：所有 `registerLib` 调用补充 `packageName` 参数，所有 fixture 中的 specifier 统一为 `gear-lib-demo`
5. **demo 案例添加**：新建 `.fai.js` 示例文件、修改 `main.ts` 和 `vite.config.ts`、新增下拉菜单项
6. **execute 自动加载**（第四部分）：`ports.ts` 增加 `libLoader` 端口；`runtime.ts` 新增 `autoLoadLibs` 并在三个入口调用；`check()` 与 libLoader 协同；宿主实现 libLoader（Node CLI 白名单 + `import(name)`、demo 浏览器静态 `LIB_MODULES` 映射表、vitest alias）；联动第三部分 3.2 的 demo 改为 libLoader 接管注册

## 测试计划

1. 跑 `packages/gear-lib-demo` 自身测试
2. 跑 `packages/tests` 集成测试
3. 跑 core 的 lang 测试
4. 新增测试：在 `runtime.test.ts` 中新增 import specifier 校验测试（specifier 未注册时报错、packageName 不匹配时报错、正确匹配时通过）
5. 新增自动加载测试（第四部分 4.6）：autoLoadLibs 跳过/装载/失败三态；`check()` 无 libLoader → specifierToBinding、有 libLoader → listLibs
6. 跑 `npm run typecheck`
7. 跑 `npm run lint`
8. 跑守卫脚本
9. demo e2e（含 gear-demo 自动加载：brep 成功 + mesh E_MESH_UNSUPPORTED）
