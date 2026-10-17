# `.fai.zip` 几何内核需求静态判定

> 方案出处：deepseek-V4.1-Flash + Workbuddy
> 写作日期：2026-10-16

## 1. 目标

给定一个 `.fai.zip` 建模文档，在**运行之前**回答：它需要哪个（哪些）几何内核。

"运行之前"在本方案中是字面意义的严格边界：

- 不加载任何 wasm（`occt-wasm` / `manifold` / `brepkit`）；
- 不装配 BREP 引擎；
- 不执行任何一条模型语句；
- 只做三件事：解 zip、解析脚本 AST、查常量表。

输出不是一句 verdict，而是 **verdict + 证据**：哪条语句、哪个 op、声明收窄到哪个引擎集合、证据落在源码哪一行。

## 2. 语义定义

报告的 verdict 精确等价于下面这句话：

> 以 `mode='brep'` 装配并执行该 model，是否会因为引擎不匹配被静态门拦截而落到 `ExecutionResult.failedAt`。

三个边界条件必须显式说明，否则报告会被误读：

| 条件 | 影响 |
|---|---|
| `mode='mesh'` | 引擎门被 D11-6 豁免，verdict 与执行结果无关 |
| `mode='auto'` | 不匹配时静态降级 mesh，不报错，但精度路径改变 |
| `brep_mock` 引擎 | D11-3 豁免引擎门，恒通过，不代表真实可行性 |

因此报告携带 `brepRequired` 作为第二个独立轴：当文档里所有终端 part 都已在 mesh 链上时，它**根本不需要 BREP 内核**，此时 verdict 退化为 `any` 且不构成执行风险。

## 3. 现状盘点

### 3.1 可直接复用的构件

| 构件 | 位置 | 用途 |
|---|---|---|
| `readZipEntries` | `packages/core/src/io/zip.ts` | 纯 JS 解包（fflate），零 wasm |
| `openContainer` | `packages/core/src/io/fai-zip/container-read.ts` | manifest 校验 + 模块图 + payload，一次解包 |
| `extractMetadata` | `packages/core/src/lang/metadata-extractor.ts` | 纯 AST，产出 `lines[].callee` / `namespace` / `refs` / `line`，以及 `imports[]` |
| `SCRIPT_FACE_OPS` | `packages/core/src/api/generated/script-face-manifest.ts` | op 名 → `engines?`，常量表，可静态 import |
| `BREP_ENGINE_IDS` | `packages/core/src/brep/engine/types.ts` | 引擎全集 |
| `resolveFunctionEngines` | `packages/core/src/cad-runtime/lib-decl.ts` | 库侧 `fn.engines ?? lib.platform ?? 中立` |
| `capability-map.json` | `packages/core/src/api/surface/` | op → 内核方法集合（静态 trace） |
| `engine-method-map.json` | `packages/core/src/api/surface/` | 内核方法 → `aligned/dialect/occt-only/brepkit-only/...` |

### 3.2 三个缺口

**缺口一：没有一张完整的 op → 引擎静态表。**

`SCRIPT_FACE_OPS` 只有 40 条（其中 17 条声明 `engines:['occt']`），而 `arg-spec.ts` 有 894 个条目。脚本面 op 全集远大于 40。手写 `engines` 散落在 `arg-spec.ts` 与各手写 `api/*.ts` 模块里，没有汇总产物。静态分析器不能通过 import 运行时 `DUAL_OP_META` 拿——那会把 `occt-wasm` 拖进来。

**缺口二：`.fai.zip` 通道没有任何引擎维度。**

`openContainer` 只做容器语义；`faijs-cli` 只有 `check` / `run` / `view` 三个命令，且 `check` 只吃单文件 `.fai.js`，不识别 zip。

**缺口三：第三方库的引擎约束落在容器之外。**

按 `docs/fai-zip-format.md` §5.3，裸 specifier 是库引用，库不在容器内。而 `lib-decl.ts` 的 `platform` 是**语义基准**约束（`faijs-freecad` 只能跑 occt），与函数实现无关，无法从脚本 AST 推导。没有宿主输入，这部分只能判 unknown。

## 4. 设计

### 4.1 新增：op 引擎事实表

**工作件 1** — 生成器 `packages/core/scripts/gen-op-engine-facts.ts`，产物 `packages/core/src/api/surface/op-engine-facts.json`。

生成器 import `ARG_SPEC`（`api/surface/arg-spec.ts`，唯一人工维护点）+ `capability-map.json` + `engine-method-map.json`，对**每一个**脚本面 op 产出一条：

```jsonc
{
  "op": "fuse",
  "kind": "brep-op",
  "path": "brep",                 // 'mesh' | 'brep' | 'dual'
  "declared": ["occt"],           // 手写 engines ?? null（未声明）
  "kernelMethods": ["generalTransform", "isNull", "dispose", "release"],
  "derived": ["occt"],            // 由 kernelMethods × engine-method-map 推导
  "source": "brep-operations/booleanFns.ts#fuseBrep"
}
```

推导规则：

```
derived(op) = ⋂ over m ∈ kernelMethods(op) of engineSet(m)

engineSet(m) =
  aligned | dialect | kernel-only → ALL
  occt-only                       → {occt}
  brepkit-only                    → {brepkit}
  need-probe                      → UNKNOWN
```

`derived` 取交集：一个 op 只要调用了一个 `occt-only` 内核方法，整个 op 就只能是 occt。出现 `UNKNOWN` 传染整个 op；出现 ∅ 说明同一 op 同时依赖 occt 专属与 brepkit 专属方法，是**实现矛盾**，必须报错而不是取并集。

同时**扩展 `gen-capability-map.ts` 覆盖 `query` kind**。它现在只 trace `kind==='brep-op'`，而 `query` 类 op 同样直连 `getBrepApi().*`（如 `measureVolumeProps` 声明了 `engines:['occt']`），漏 trace 会让 `derived` 误判为中立。

**一致性门禁**：`declared` 与 `derived` 必须**相等**，不是包含关系。

- `derived={occt}` 而 `declared=null` → 漏声明，BREP 模式下会在 brepkit 上误放行然后在实现里炸；
- `derived=ALL` 而 `declared=['occt']` → 过度声明，不必要地收窄，op 本可跨引擎。

这条断言把"引擎声明"从人工自觉变成机器可验证，是整张表不腐化的唯一保障。

### 4.2 新增：分析器

**工作件 2** — `packages/core/src/io/fai-zip/kernel-requirements.ts`，从 `@faicad/faijs/io/fai-zip` 导出。

依赖白名单（违反即失去"运行前"能力）：

```
../zip                                    // 解包
./container                               // manifest 校验
../../lang/metadata-extractor             // AST 解析
../../api/surface/op-engine-facts.json    // 常量表
../../brep/engine/types                   // BREP_ENGINE_IDS
```

**禁止** import 任何 `api/generated/*`、`occt-kernel/*`、`brepkit-kernel/*`、`three`、`node:*`。这条由守卫测试静态扫描 import 语句钉住（项目里 `dist/sdk.js` 已有同类先例）。

### 4.3 算法

**Step 1 — 解容器**

```ts
const c = openContainer(bytes, { modelId })
```

拿 `manifest`、`activeModel`、`loader.listModules()`、`assets`。

**Step 2 — 逐模块静态解析**

对 `model/**` 下**每个**模块（不只是 entry）跑 `extractMetadata`，得到：

- `lines[i]`：`{ callee, namespace?, refs, line, outputs, receiver? }`
- `imports[]`：`{ kind, specifier, packageName?, localName?, bindings[] }`

必须遍历全模块图，不能只看 entry。`.fai.zip` 的模块图是静态的（相对 specifier 解析规则见 `docs/fai-zip-format.md` §5.2）。

**Step 3 — 引擎求交**

对每条语句判定 `effectiveEngines`：

```
namespace 为空或等于默认 ns（cad）
  → 查 op-engine-facts：declared ?? ALL     // declared 由门禁保证 == derived

namespace 为库 binding
  → 查宿主传入的 libMeta[packageName]
     resolveFunctionEngines(fn.engines, lib.platform) ?? ALL
  宿主未提供该包 → UNKNOWN，记入 unresolved
```

然后：

```
required = ⋂ over all statements effectiveEngines

required = ∅                       → verdict 'unsatisfiable'
required 含 UNKNOWN                → verdict 'unknown'
required == ALL                    → verdict 'any'
required ⊂ ALL 且非空              → verdict '<id>-only'
```

**Step 4 — mesh 链近似**

faijs 语言子集**禁止控制流**（`if` / `for` / `while` / `switch` / `try` / 动态 `import()` 全部是 `E_CONTROL_FLOW` ParseError），语句是线性序列，依赖由 `refs` / `receiver` 显式给出。因此**数据流是静态 DAG，链级传播可静态判定**，不需要执行。

mesh 起点集合：

- mesh-only op：`knurl` / `sdf`（`defineOp({ mesh })`，无 `brep` 实现，不写 solidCache）
- `load` 且实参指向无 BREP 载体的格式（`.stl` / `.3mf` / `.obj`）

正向传播：part 由 mesh-only op 产出，或其任一输入 `refs` 已在 mesh 集合中 → 加入 mesh 集合。兄弟 part 互不污染。

输出 `meshedParts` 与 `brepRequired = 存在终端 part 不在 mesh 集合中`。

**保守原则**：任一条语句的 callee 不在事实表里（无法判定 path）→ 该 part 标 UNKNOWN，且 `brepRequired` 取 `true`（按需要 BREP 处理），绝不乐观假设。

### 4.4 输出契约

```ts
export type KernelVerdict =
  | 'any'            // 中立：任何引擎都能跑
  | 'occt-only'      // 收窄到 occt
  | 'brepkit-only'   // 收窄到 brepkit
  | 'unsatisfiable'  // 引擎约束互相矛盾
  | 'unknown'        // 证据不足（库未解析 / 未知 op / 解析失败）

export interface KernelBlocker {
  kind: 'op-engines' | 'lib-platform' | 'lib-fn-engines' | 'unresolved-lib' | 'parse-error'
  module: string                 // moduleKey（相对 model/）
  line?: number
  callee: string
  declared: readonly string[]
  detail: string
}

export interface KernelRequirementReport {
  modelId: string
  verdict: KernelVerdict
  /** 逐引擎三态：ok = 静态门放行；blocked = 会被拒；unknown = 证据不足 */
  engines: Array<{
    engineId: BrepEngineId
    status: 'ok' | 'blocked' | 'unknown'
    blockers: KernelBlocker[]
  }>
  /** 是否真的需要 BREP 内核；false = 纯 mesh 文档 */
  brepRequired: boolean
  meshedParts: string[]
  modules: string[]
  unresolved: Array<{ module: string; specifier: string; line: number }>
}
```

`engines[]` 是逐引擎的三态，而不是单个 verdict。理由是同一个文档可能对 occt 是 `ok`、对 brepkit 是 `blocked`——这正是"需要哪个内核"的答案形态；verdict 只是它的摘要，供脚本消费。

## 5. 出口

| 出口 | 形态 |
|---|---|
| API | `analyzeKernelRequirements(bytes, opts?) → KernelRequirementReport`，从 `@faicad/faijs/io/fai-zip` 导出 |
| CLI | `faijs kernels <doc.fai.zip> [--json] [--model <id>]` |
| Viewer | `openFaiZip` 前置调用，按 verdict 只加载需要的 wasm，不再盲载三个引擎 |

`opts` 形状：

```ts
interface AnalyzeKernelOptions {
  modelId?: string        // 覆盖 manifest.active
  libMeta?: Record<string, LibMeta>   // 宿主提供的库声明（packageName → faijs.lib + peers）
  caps?: ZipReadOptions   // 解包上限
}
```

`libMeta` 缺省 → 所有库调用进 `unresolved`，verdict 降级为 `unknown`。**不做"假设中立"的兜底**——`lib-decl.ts` 已经写明 `platform` 是任何 `fn.engines` 都写不出来的语义约束，猜就是错。

## 6. 落地顺序

1. 扩展 `gen-capability-map.ts` 覆盖 `query` kind；
2. 新增 `gen-op-engine-facts.ts` + 产物 `op-engine-facts.json`；
3. 新增 `kernel-requirements.ts` 分析器；
4. 从 `io/fai-zip/index.ts` 导出；
5. 新增 CLI `kernels` 命令（`node-host/cli.ts` 的 `parseArgs` / `cliMain`）；
6. 补测试（见 §7）。

步骤 1–2 是前置：没有事实表，分析器只能查 40 条 op。

## 7. 必须同批交付的测试

### 7.1 一致性门禁

新增 `packages/core/test/api/surface/op-engine-facts.test.ts`，钉三条：

1. 事实表条目集合 ≡ 脚本面 op 全集（与 `capability-map.test.ts` 的三方一致口径对齐）；
2. 每条 `declared === derived`（§3.1 门禁）；
3. 无 `derived === ∅` 的矛盾条目。

### 7.2 分析器行为

新增 `packages/core/test/io/fai-zip/kernel-requirements.test.ts`：

| 用例 | 期望 |
|---|---|
| `cad.box` + `cad.knurl` | `brepRequired: false`，`verdict: 'any'` |
| 含 `cad.fuse` | `verdict: 'occt-only'`；brepkit 项 `status:'blocked'`，blocker 带正确 `module` / `line` / `callee` |
| 含未注册库 import | `verdict: 'unknown'`，`unresolved` 非空且不为空数组 |
| 宿主传入 `libMeta`（含 `platform:['occt']`） | 该库调用参与求交，verdict 收窄 |
| 多 model 容器 + `--model` | 逐 model 独立判定，互不串味 |
| 非 zip 字节 | 抛错并带 `[fai-zip]` 前缀 |

### 7.3 零依赖守卫

静态扫描 `kernel-requirements.ts` 的 import 语句，断言不含 §4.2 黑名单。这条一旦破，"运行前"的边界就没了。

## 8. 取舍与纪律

**内核需求是推导出来的，不是声明出来的。**

不往 `manifest.json` 加 `requiresKernel` 字段。理由是 `docs/fai-zip-format.md` §4.7 的硬规则：manifest 是声明而非缓存，任何字段都不得存放读成员就能推翻的值。加了这个字段，脚本与 manifest 冲突时没有仲裁者。

若确实需要给第三方 reader 免去 parser 成本，只能写进 `cache/kernel-requirements.json`（§8.1 标准可选命名空间）：删掉即可重算，不参与任何判定。

**unknown 优先于猜测。**

库未解析、op 未登记、解析失败——一律 `unknown` 并列出证据。分析器的价值在于**可证伪**，一个乐观的错误 verdict 比 `unknown` 危险得多。

**预测的是静态门，不是运行时降级。**

报告回答"`mode='brep'` 会不会 `failedAt`"。运行时 mesh 降级（`load` STL、knurl 污染）是**第二轴**，以 `brepRequired` / `meshedParts` 呈现，且只记录不门禁——与 `packages/tests/faijs/engine-compat/harness.ts` 里 `SoftDiff` 的口径一致：拓扑计数差异是信息，不是失败。

**换内核不动分析器。**

新引擎（如 smlib）落地时，`.fai.zip` 侧零改动：引擎集合来自 `BREP_ENGINE_IDS`，op 的 `engines` 是数据，分析器只读表。新增引擎要动的是引擎侧四处：`BREP_ENGINE_IDS`、`BrepEngineApi` 实现、`engine-method-map.json`、`native-history.ts`。这与项目现有"引擎事实落常量表、不搞运行时探测"的纪律一致。
