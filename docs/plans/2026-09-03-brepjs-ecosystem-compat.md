# brepjs 生态兼容：第三方库「改包名即可」纳入 faijs，并在 `.fai.js` 中调用

> 状态：**已废弃**（v2，未实施） · 作者：AI · 日期：2026-09-03
> **被 `docs/plans/2026-09-03-faijs-brepjs-compat-api.md`（v3）整体取代**。
> 取代原因（用户裁决）：① 错误处理应全面采用 brepjs 的 Result 体系，faijs 的 throw 方案改过来
> （本文档的「边界 Result→throw 翻转」方向反了）；② TS 兼容面应就是 faijs 的对外 API 面本身，
> 而非一个独立子路径；③ 底层应封装 defineOp，使上层 API 零 BREP 链感知。
> 本文档 §2 错误诊断、§3 全流程模型、§8.3 增量缺陷两处的实测内容已被 v3 §3.3 继承。
> 以下为历史存档，勿再引用。
> 取代：`docs/plans/2026-09-02-faijs-api-surface-completion.md` 中关于库侧 API 面的设计（该文件未改动）
> 修订记录：本文档第二版。第一版（同日早些时候）的 P1 让第三方库 import
> `@faicad/faijs-core/vendored/brepjs`，与 9.1 号被否决的方案同源，已推翻重写。

---

## 0. 用户原始要求（原话）

> 「任何brepjs生态的第三方库，我希望的是只改包名就可以纳入到faijs生态。」

> 「brepjs-sheetmetal只是一个样本，我的需求是，brepjs库的任何brep相关的api，faijs要尽量兼容。
> brepjs库里还有大量非brep建模的部分，完全无关，本项目不支持。」

> 「sheetmetal必须是一个第三方库，怎么可能允许访问@faicad/faijs-core/vendored/brepjs？
> 这不彻底违反了项目的前提？9.1号的方案被否决，就是因为它让第三方库绕过faijs直接访问brepjs的api。
> 结果9.2号的方案，还偷偷这么干？必须纠正过来。」

> 「第三方库，不准出现任何的brepjs的内容。用mech-lib、sheetmetal这两个库来测试。
> 它们就是第三方库，只是为了演示的原因，和faijs放在了一起。要求能在fai.js脚本里，
> 调用这些第三方库。把这个流程走通。」

> 「你的方案完全未考虑如何在.fai.js库里import和执行这个钣金库。必须全流程思考。」

> 「总之：最终的评判标准是，brepjs的第三方库，可以很容易的转换为faijs的第三方库，
> 且能够在.fai.js脚本中调用，符合faijs的执行语义。」

> 「类似box/cylinder/sphere/translate/intersect 这样的符号，一个库里绝对不准出现两份。
> 但是，你要考虑Shape/throw 语义等问题。整个代码的执行，必须符合faijs的语义，
> 在brep/mesh双槽的环境下执行，有多个宿主，支持增量执行等。」

---

## 1. 结论摘要

| 问题 | 结论 |
|---|---|
| 第三方库能不能碰 brepjs？ | **不能**。零 `brepjs` 依赖、零 `vendored/**` 深路径 import。库只 import faijs 官方声明的面。 |
| 怎么做到「只改包名」？ | 新增 faijs 官方 **BREP 建模面** `@faicad/faijs-core/brep`（根门面转发为 `@faicad/faijs/brep`）。库把 `from 'brepjs'` 换成 `from '@faicad/faijs-core/brep'`，其余不动。 |
| 这和「绕过 faijs 访问 brepjs」有何区别？ | 库访问的是 **faijs 官方契约面**，faijs 对其承担稳定性与语义责任；vendored brepjs 是 faijs 的**私有实现**，可整体替换（自研 / Remus），替换时官方面不变。区别在于契约层，不在实现层。 |
| `.fai.js` 里怎么调用？ | 五步链路，**已有可运行样本**（`packages/mech-lib/src/c3-brepjs-scenario.test.ts`）。见 §3。 |
| 符号会不会出现两份？ | 不会。判定标准是**同一调用面上两个同名实现**。`cad.box`（脚本面）与 brep 面的 `box`（库作者面）不在同一作用域；faijs 的几何实现全局仍只有一套。 |
| Shape / throw 语义怎么调和？ | **库内部**保留 brepjs 的 `Result<T>` 形态（改包名即可的前提）；**库边界**统一为 faijs 语义：输入 `Shape`、输出 `Shape`、错误 `throw`。由 `adaptBrepLib` 在宿主注册时自动完成。 |

**一句话架构**：库内部用 brepjs 形态的建模链（改包名即可），库边界由 faijs 收口（Shape 进、Shape 出、错误 throw、BREP-only 静态分派）。

---

## 2. 错误诊断（自纠）

### 2.1 第一版方案的两处错误

**错误一（原则性）**：P1 设计的新增子路径内容是

```
export * from '@faicad/faijs-core/vendored/brepjs/index.js'
```

这等于把 faijs 的**私有实现目录**提升为第三方库的公共契约。它与 9.1 号被否决的方案是同一个错，只是换了个路径：

| | 9.1 号（被否决） | 第一版（本日早些时候） |
|---|---|---|
| 库写什么 | `from 'brepjs'` | `from '@faicad/faijs-core/vendored/brepjs'` |
| 实质 | 直接吃 brepjs 的实现 | 直接吃 faijs 私有目录里的同一份 brepjs 实现 |
| 后果 | faijs 换引擎 → 库全部崩 | 同 |

二者在**耦合性质**上完全等价：都让第三方库与 faijs 的内部实现细节绑定。区别只是字面量里有没有 `brepjs` 五个字母。

**错误二（覆盖面）**：方案只设计了「库作者面」，完全没有设计 `.fai.js` 侧的完整链路——库怎么被加载、binding 怎么匹配、参数怎么传、产物怎么回到 faijs 的增量与导出体系。而用户的最终评判标准恰恰是「能够在 `.fai.js` 脚本中调用」。

### 2.2 现有代码里已经存在的两处同类违规（实测）

这不是纸面风险，仓库里现在就有：

| 位置 | 违规形态 | 实测 |
|---|---|---|
| `packages/mech-lib/package.json` | `"dependencies": { "brepjs": "18.119.2" }` | 第三方库**直接依赖 brepjs 包** |
| `packages/mech-lib/src/brepjs-gear.ts:32` | `} from 'brepjs'`（导入 `registerKernel` / `OcctWasmAdapter` / `makeExternalGear` / `thread` / `isErr`） | 库代码里出现 brepjs 具名导入 |
| `packages/mech-lib/src/brepjs-gear.ts:64` | 库自己调 `registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(k))` | **库自行注册内核**，绕过 faijs 的引擎管理 |
| `packages/sheetmetal/src/compat.ts` | import 20 处 `@faicad/faijs-core/vendored/**` 深路径 | 等价于穿透 faijs 内部 |

两种违规形态不同，但性质一致：**第三方库与 faijs 的内部实现耦合**。

`packages/sheetmetal/package.json` 的 `dependencies` 是空的（只有 peer `@faicad/faijs-core`）——它的问题不在包依赖，而在 `compat.ts` 的深路径 import。

> 这两个库在本方案里既是**待改造对象**，也是**验收样本**（用户指定）。

---

## 3. 全流程模型（第一版完全缺失的部分）

### 3.1 五步链路

```
┌─ 宿主侧（JS 模块系统，真实加载发生在这里）────────────────────┐
│ ① initOcctWasm()                      OCCT 内核就绪（单实例）  │
│ ② import * as sheet from '@faicad/sheetmetal'                 │
│    真实模块加载：Node = 真 import；浏览器 = bundler / CDN       │
│ ③ runtime.registerLib('sheet', adaptBrepLib(sheet))           │
│    绑定名 'sheet' 必须与脚本里的 import binding 名一致          │
└───────────────────────────────────────────────────────────────┘
                              ↓
┌─ 引擎侧（.fai.js 只做声明，不做加载）─────────────────────────┐
│ ④ 脚本写 import * as sheet from '@faicad/sheetmetal'          │
│    parser 只取 binding 名 → compile 发射 ns.sheet.<callee>()   │
│    ⚠️ 说明符字符串不参与任何模块解析                            │
│ ⑤ 执行：包装层 borrow → 调库函数 → adopt → faijs Shape         │
│    → 后续语句消费 / 导出 STEP·STL / 增量键计算                  │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 关键事实：`.fai.js` 的 import 说明符不参与模块解析

这是整个流程的枢纽，必须写死：

- `parser.ts:1071` `importDeclToIR()` 把 `import * as X from 'Y'` 解析为 `ImportIR { specifier, kind, localName, packageName }`
  （类型见 `lang/types.ts:209-220`）。
- `compile.ts` 发射调用时用的是 `ns.${stmt.namespace ?? 'cad'}.${stmt.callee}`——**只有 binding 名参与**，
  `specifier` 从不参与模块解析。
- 编译产物是**零 import** 的 ESM（`compile.ts` 文件头注释：Node `data:` URL 与浏览器 Blob URL 都
  无法解析裸说明符）。
- 因此：**模块加载是宿主的职责**。宿主必须 `registerLib(<binding>, ns)`，binding 名与脚本里的
  `localName` 一致，否则执行时 `ns.sheet` 为 `undefined`。

这条链路上的分工是刻意的：引擎不碰模块系统（保持零 import 产物在两平台同构），宿主掌握加载策略
（Node 走 node_modules，浏览器走 bundler/CDN/importmap）。

### 3.3 现成可运行样本（实测存在，不是设计稿）

`packages/mech-lib/src/c3-brepjs-scenario.test.ts` 已经把全流程跑通了。宿主侧：

```ts
await initOcctWasm()
runtime = createRuntime(createNodePorts(), 'auto')
runtime.registerLib('gear', gear as never)      // :50
result = await runtime.execute([
  "import * as gear from 'brepjs-gear'",
  'let part0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
  'let part1 = cad.box({ size: [48, 48, 8] })',
  'let part2 = cad.union(part0, part1)',
].join('\n'))
```

四项断言全部通过：① `part0` 是 BREP；② `cad.union` 走 BREP 路径（不是 mesh）；
③ 导出 STEP 含 `ADVANCED_FACE`（精确，非 faceted）；④ 几何交叉校验（pitch=48/tip=52 与网格外径吻合）。

**这个样本证明了三件事**：全流程链路已存在且可用；第三方库产物能拿到 BREP 槽并参与 faijs 的
精确布尔与 STEP 导出；库产物能无缝接上 `cad.*` 的后续语句。

**它同时暴露了要解决的问题**：这个库的源码 `import from 'brepjs'`（`brepjs-gear.ts:32`），
还要自己 `registerKernel`（`:64`）——即 §2.2 的违规。本方案的目标就是**保留这条链路，换掉库的依赖面**。

### 3.4 库内部：brepjs 形态的建模链怎么接上 faijs Shape

这是全流程里唯一的技术难点，也是第一版没想清楚的地方。

`.fai.js` 传进库函数的是 **faijs `Shape`**（`{positions, indices}` + 身份槽，槽里是 OCCT 句柄）；
而 brepjs 形态的 op（`cut(a, b)` / `fuse(a, b)`）要的是 **brepjs `Solid`**（`{wrapped}` 句柄包装）。
两者形态不同，库内部若全用 `Solid`，链路就从入口处断了。

解法是把转换放在**库函数边界**，而不是每个 op 上：

| 位置 | 转换 | 现有设施 |
|---|---|---|
| 入口 | faijs `Shape` → brepjs `Solid` | `api/internal/l3-bridge.ts` `borrowBrepjsShape()`（借入句柄，零拷贝，不转移所有权） |
| 库内部 | `Solid` ⇄ `Solid`（纯 brepjs 形态建模链） | vendored brepjs op，签名与上游一致 |
| 出口 | brepjs `Solid` → faijs `Shape` | `sdk.ts:70` 已导出 `fromHandle()`（= `fromBrep(meshHandle(h), {solid:h})`，**收养即三角化 + 注册 BREP 槽**） |

`fromHandle` 已经解决了「产物只有 BREP、没有 mesh 载荷」的问题——`brep/handle-bridge.ts:69`
的注释写明它是 "tessellate + register the BREP slot in one step"。这正是 AGENTS.md
「mesh 是正式数据、每个 `Shape` 必有载荷」红线要求的。

于是库内链路自洽：入口借入 → 内部 `Solid` 链 → 出口收养为完整 `Shape`
（mesh 载荷 + BREP 槽），可以直接被后续 `cad.*` 语句、装配、导出消费。

---

## 4. 兼容面设计：`@faicad/faijs-core/brep`

### 4.1 命名与落点

| 项 | 决定 | 理由 |
|---|---|---|
| 权威面 | `@faicad/faijs-core/brep`（core 新增 exports 子路径） | `mech-lib/src/index.ts` 注释确立的既有约定：「只依赖 `@faicad/faijs-core`」 |
| 转发面 | `@faicad/faijs/brep`（根门面薄 re-export） | 与 `src/sdk.ts` 一致的模式（根门面 sdk 就是 `export * from '@faicad/faijs-core/sdk'`） |
| 不并入 | `./sdk` 面、根导出面、`cad` 命名空间 | 见 §6 符号唯一性 |
| 不开放 | 任何 `vendored/**` 深路径给第三方库（库作者侧） | §2.1 错误一的直接纠正 |

### 4.2 这个面「不是」裸 re-export

如果 `@faicad/faijs-core/brep` 只是 `export * from './vendored/brepjs/index.js'` 换了个门牌，
那就是换汤不换药的错误一。它必须是**筛选 + 语义封装**：

1. **筛选**：只纳入 brep 建模相关符号，明确排除非 brep 部分（§5）。
2. **语义封装**：面上的 op 承担 faijs 的执行语义责任，而非透传：
   - 内核由 faijs 统一绑定，**库作者不再写 `ensureKernelInjected()` / `registerKernel()`**
     （对比 `brepjs-gear.ts:64` 现在的做法）。
   - 句柄生命周期纳入 faijs 的函数 BREP 域（复用 `enterFunctionBrep` / `exitFunctionBrep`），
     **库作者不再维护模块级 `pinned` 数组**（对比 `brepjs-gear.ts:71`）。
   - 错误码映射到 faijs 错误体系，携带语句上下文。
3. **实现可替换**：面是契约，vendored brepjs 是当前实现。中期把高频 op 换成 faijs 原生
   dual-op，长期换成 Remus 或自研，面不变。

> 与 vendored 的关系：vendored 是**私有实现目录**，brep 面是**公共契约面**。
> faijs 内部（`api/generated` 等 468 处相对 import）继续直连 vendored，不受影响。

### 4.3 面的分层：机制面 vs 能力面

| 面 | 定位 | 内容 | 消费者 |
|---|---|---|---|
| `@faicad/faijs-core/sdk` | **机制面**（怎么声明 op） | `defineOp` / `fromHandle` / `solid` / `fromBrep` / `getBackends` / `CONTRACT_VERSION` | 所有第三方库 |
| `@faicad/faijs-core/brep`（新增） | **能力面**（用什么建形） | brepjs 形态的建模/查询/测量/数学 op | brepjs 血统的第三方库 |
| `cad` 命名空间 | **脚本面** | dual-op，`.fai.js` 的 `cad.*` | `.fai.js` 脚本 |

第三个面不对外（库作者不 import `cad`），第一个面不含几何能力（保持零 heavy 依赖守卫），
第二个面只在库内部使用。三者不重叠。

---

## 5. brep API 兼容范围

### 5.1 范围的天然上界：faijs 已 vendored 的面

faijs 在 D10 移植 brepjs 时**已经做过一次 brep 筛选**——vendored 的是 brep 建模部分，
`csg` / `voxel` / `lattice` / `implicit` / `worker` 已被裁掉。实测规模：

| | 行数 | `export` 段数 |
|---|---|---|
| 上游 `brepjs/src/index.ts` | 1251 | 159 |
| faijs `vendored/brepjs/index.ts` | 1132 | 112 |

即 vendored ≈ 上游的 70%，差额正是非 brep 部分。**兼容范围 = vendored 已覆盖的这部分**，
不需要、也不应该重新引入被裁掉的部分。

### 5.2 分类清单（按 vendored 面实测归类）

| 族 | 代表符号（`vendored/brepjs/index.ts` 行号） | 纳入 |
|---|---|---|
| 图元 | `box`:972 `cylinder` `sphere` `cone` `wedge` | ✅ |
| 布尔 | `cut`:1033 `fuse`:1032 `intersect` `section` | ✅ |
| 变换 | `translate`:1020 `rotate`:1021 `scale` `transform` | ✅ |
| 扫掠 / 成型 | `extrude`:1067 `loft` `sweep` `guidedSweep`:759 `roof`:761 | ✅ |
| 阵列 | `linearPattern` `circularPattern` `gridPattern`:777 | ✅ |
| 修饰 | `fillet` `chamfer` `variableFillet`:723 `shell` | ✅ |
| 线框构造 | `line` `wire` `face` `makeWire` `makeFace` | ✅ |
| 拓扑查询 | `getEdges` `getFaces` `getSolids` `getBounds` `isSolid` `sharedEdges` `getSingleFace`:188 | ✅ |
| 几何求值 | `pointOnSurface` `normalAt` `getSurfaceType` `curveStartPoint` `curveEndPoint` `faceCenter` | ✅ |
| 测量 | `measureVolume` `measureArea` `measureDistance` | ✅ |
| 判定 / 校验 | `isValid` `isPlanarWire` `checkBoolean`:630 | ✅ |
| 向量数学 | `vecAdd` `vecSub` `vecScale` `vecCross` `vecDot` `vecNormalize` `vecLength` | ✅ |
| 错误 / Result | `ok` `err` `isOk` `isErr` `BrepError` `validationError` | ✅ |
| 类型 | `Solid` `Bounds3D` `ValidSolid` `ShapeHandle`:450 `Plane`:467 | ✅ |
| 高级造型 | `hull`:707 `convexHull`:709 `minkowski`:711 `polyhedron`:713 `nurbs`:556 | ✅ |
| 草图 / 2D | `Sketcher`:235 `Sketch` `Blueprint`:140 `draw`:264 `fuse2D`:150 | ✅ 纳入（brep 的上游构造） |
| IO | `exportOBJ`:192 `importSVG`:215 `deserializeDrawing`:261 | ⚠️ 见下 |
| 内核管理 | `getKernel` `registerKernel` `withKernel` `getKernelCapabilities`:11 | ❌ **不纳入**（faijs 独占引擎管理） |
| 文本 / 字体 | `loadFont`:312 `textBlueprints`:313 `sketchText`:314 | ⚠️ 见下 |
| 机器人学 | `jointsFromDH`:845 等 `dhFns` / `ikFns` / `urdfFns` | ❌ 非 brep 建模 |

**两处需要决策的灰区**：

- **IO 族**：faijs 已有自己的 STEP/STL/3MF 体系（`brep/export/step.ts` 精确导出、
  `occtKernel.ts:420 meshesToStep` 三角化导出）。brepjs 的 `exportOBJ` / `importSVG`
  与 faijs 的导出契约不同（不产生 faijs `Shape`、不走增量体系）。
  **建议不纳入** brep 面；库若需要，由宿主经 `HostPorts.assets` 提供。
- **文本 / 字体**：faijs 有 `HostPorts.fonts` 注入口，字体是宿主资源。
  **建议不纳入** brep 面，库应走宿主注入（与多宿主设计一致）。

**明确排除**（用户原话「完全无关，本项目不支持」）：`csg` / `voxel` / `lattice` /
`implicit` / `worker` / `viewer`——这些在 D10 移植时就未 vendored，无需额外动作。

### 5.3 兼容的验收口径

「尽量兼容」的可判定标准：对 brepjs 生态库源码执行 `sed "s|from 'brepjs'|from '@faicad/faijs-core/brep'|"`，
若其 import 的符号全部落在 §5.2 的「纳入」族内，则**除这一行替换外零改动**通过类型检查。

---

## 6. 符号唯一性：为什么不会出现两份

用户要求：「类似 box/cylinder/sphere/translate/intersect 这样的符号，一个库里绝对不准出现两份。」

### 6.1 判定标准

「两份」的判定是：**同一个调用面上出现两个同名实现**。不是「仓库里出现两次同名字符串」。

三个面（§4.3）作用域互不重叠，因此：

| 符号 | 所在面 | 调用者 | 是否冲突 |
|---|---|---|---|
| `cad.box` | 脚本面（dual-op → `Promise<Shape>`） | `.fai.js` 脚本 | — |
| `brep` 面的 `box` | 库作者面（brepjs 形态 → `Result<Solid>`） | 库内部 | — |
| 二者 | **不同作用域**，库代码从不 import `cad`，脚本从不直接 import `brep` 面 | | ✅ 不冲突 |

### 6.2 三条硬约束（写进守卫）

1. **brep 面的裸符号禁止并入根导出面**。`packages/core/src/index.ts` 末行是 `export * from './api'`，
   而 `api/index.ts` 已导出裸 `box` / `cylinder` / `translate` / `intersect`——
   brep 面若并入会立刻造成真冲突。brep 面**只能**经 `@faicad/faijs-core/brep` 子路径访问。
2. **brep 面禁止进入 `cad` 命名空间**。`cad` 是 `.fai.js` 的脚本面，其成员必须是 dual-op
   （`defineOp` 产物），形态与 brepjs op 不同，混入会破坏 `assertLibConforms` 与分派。
3. **faijs 的几何实现全局只有一套**。brep 面的 `cut` 与 `cad.cut` 底层最终都调到同一个 OCCT
   引擎实例（D10 单实例），不存在第二份几何实现。

### 6.3 Shape / throw 语义的调和

用户特别点名这一组问题。brepjs 与 faijs 的语义差异及处理：

| 语义 | brepjs | faijs | 边界处理 |
|---|---|---|---|
| 错误 | `Result<T>`（`ok`/`err`），不抛 | 错误 `throw`，**不静默降级** | 库内部可保留 `Result`（改包名即可的前提）；越过库函数边界时由 `adaptBrepLib` 把 `err` 转为 `throw`，携带 faijs 错误码与语句上下文 |
| 产物 | `Solid`（句柄包装，无 mesh） | `Shape`（mesh 载荷 + BREP 槽） | 出口 `fromHandle()`：收养即三角化 |
| 输入 | `Solid` | `Shape` | 入口 `borrowBrepjsShape()`：借入句柄，零拷贝 |
| 异步 | 同步 | `async`（编译产物统一 `await`） | `await` 同步值是合法 JS（`compile.ts` `translateCallRef` 注释已确认），无需改造 |

---

## 7. 边界适配：`adaptBrepLib`

### 7.1 职责定位

宿主 `registerLib` 时调用，**一次包装，库作者零感知**：

```ts
import * as sheetmetal from '@faicad/sheetmetal'
runtime.registerLib('sheet', adaptBrepLib(sheetmetal))
```

对库导出的每个函数，`adaptBrepLib` 统一承担六件事：

1. **输入借入**：遍历实参，凡是 faijs `Shape` 的（按运行时值判定，非按位置/名称猜测——
   对齐 K5「禁止按名分类」），转 `borrowBrepjsShape(shape)`。
2. **输出收养**：返回值中的 brepjs `Solid` → `fromHandle()`（三角化 + 注册 BREP 槽）。
3. **Result → throw**：`isErr(r)` → `throw`，携带 faijs 错误码（对齐「不静默降级」红线）。
4. **BREP-only 声明**：包装为 `defineOp({ brep })`，**不给 mesh 实现**。
5. **句柄生命周期**：函数体内产生的中间句柄登记到 faijs 函数 BREP 域，返回后释放
   （复用 `module-executor.ts` 的 `enterFunctionBrep` / `exitFunctionBrep`）。
6. **契约版本**：自动补 `contractVersion`，使 `assertLibConforms` 通过。

### 7.2 为什么必须由引擎包装，而不是库作者手写

`brepjs-gear.ts` 现在的做法就是「库作者手写」：每个产物自己 `fromHandle`（`:122`）、
模块级 `pinned` 数组防 GC（`:71`）、自己 `ensureKernelInjected`（`:64`）。
结果是**每个库都要重复这套模板**，且与「只改包名」背道而驰。

还有一个正确性理由：`assertLibConforms`（`define-op.ts:236-276`）对**没有 dual-op 元数据的
函数直接跳过**（`:247-248` `if (!meta || meta.kind !== 'dual-op') continue`）。
也就是说，一个裸的 brepjs 库能直接 `registerLib` 进去而不报错——
**它同时也就完全不受 faijs 语义管辖**（无分派、无收养、无生命周期）。
这是引擎必须收口的第二个理由：不包装 = 静默绕过。

### 7.3 与现成分派机制的复用（不新发明）

`defineOp({ brep })` 只给 brep 实现，就自动获得 `backend-dispatch.ts:67-112` 的完整语义：

- `mode='mesh'` → 抛 `E_MESH_UNSUPPORTED`，**不回退**（对齐 AGENTS.md 红线）
- `mode='brep'` 且有输入不在链上 → 抛 `BrepUnsupportedError`，不静默降级
- `mode='auto'` 且输入全在链上 → 走 brep

`v53-lib-brep-dispatch.test.ts` 已完整覆盖这个矩阵（含「auto 只声明 brep + off-chain 输入 →
抛 `MeshUnsupportedError`」）。**无需为 brepjs 生态新发明任何分派机制。**

---

## 8. faijs 执行语义的落实

### 8.1 brep / mesh 双槽

- 库函数整体是 **BREP-only**（`defineOp({ brep })`，无 mesh 实现）。
- mesh 模式下调用 → `E_MESH_UNSUPPORTED`，**不回退**（符合"没有回退"红线）。
- 链上语义：库产物经 `fromHandle` 带 BREP 槽进入 `solidCache`，与 `cad.*` 产物同构；
  后续 mesh-only 操作会让该 part 断链并发 `part-brep-lost`，与内置 op 完全一致。
- **库内部的 op 不受分派管辖**——这是刻意的：整个库只在 brep 路径下执行（否则入口就抛错了），
  库内部的 op 序列属于库的实现细节。分派发生在**语句级**。

### 8.2 多宿主

| 宿主 | 库加载方式 | 约束 |
|---|---|---|
| Node（`node-host`） | 真 `import()`，走 node_modules | 库 peer 依赖 `@faicad/faijs-core` |
| 浏览器（`browser-host`） | bundler 打进同一 chunk，或 CDN + importmap | ⚠️ 见下 |

**浏览器下的硬约束**：OCCT 不在 worker 里（`browser-host/` 零 occt 引用，worker 只跑 CSG/SDF），
BREP 路径与脚本执行同处一个同步上下文，这是好消息。但相应地，
**第三方库必须与 faijs 共用同一份 `occt-wasm` 模块实例**——若 bundler 打进了第二份 wasm，
句柄空间不同，D10 单实例假设失效，库调用会直接崩或产生悬空句柄。
约束：库把 `occt-wasm` 声明为 `peerDependencies`，由宿主保证单实例。

### 8.3 增量执行（两处真实缺陷，必须修）

**（1）memo key 缺库身份**——`module-executor.ts:583` `computeKey()`：

```ts
`${source.namespace ?? this.defaultNsName}.${source.callee}`
```

库函数调用只有字符串 `"sheet.hem"`。对照本机函数分支，它有 `local.${callee}#${bodyHash}`
内容寻址保护。后果：**同名不同版本的库（或同名不同实现）会命中旧缓存，静默产出错误几何**。

修法：库身份（包名 + 版本 + 导出函数体内容哈希）进 key。库身份在 `registerLib` 时登记。

**（2）库侧模块级可变状态破坏纯函数性**——上游 `brepjs-sheetmetal`
`bendTableFns.ts:41 registry = new Map()` 与 `:369 starterTablesRegistered` 是模块级可变状态。
增量执行跳过某条语句时，展开可能用到与全量执行不同的折弯表。

修法：注册表显式化（库导出 `bendTables` 资源对象，由宿主/引擎持有并进增量 key），
并加纯函数守卫测试（同一输入两次执行结果一致，参照
`v53-lib-brep-dispatch.test.ts` 的「纯函数」用例）。

---

## 9. 两个库的改造与验收（用户指定样本）

### 9.1 mech-lib

| 项 | 现状 | 改造后 |
|---|---|---|
| `package.json` deps | `"brepjs": "18.119.2"` | 删除，只留 peer `@faicad/faijs-core` |
| `brepjs-gear.ts:32` | `from 'brepjs'` | `from '@faicad/faijs-core/brep'` |
| `brepjs-gear.ts:64` | 库自己 `registerKernel(...)` | 删除（faijs 统一绑定） |
| `brepjs-gear.ts:71` | 模块级 `pinned` 数组 | 删除（引擎函数 BREP 域接管） |
| `brepjs-gear.ts:122` | 手写 `fromHandle(rawIdOf(...))` | 由 `adaptBrepLib` 出口统一收养 |
| `mock-mech-brep.ts` | 已合规（dual-op，零 brepjs） | 不动，作为**对照组**保留 |

验收：现有 `c3-brepjs-scenario.test.ts` 四项断言（BREP 产物 / BREP 路径布尔 /
STEP 含 `ADVANCED_FACE` / 几何交叉校验）**零改动继续通过**，
且 `brepjs-gear.ts` 源码中 `grep -c brepjs` = 0（注释除外）。

### 9.2 sheetmetal

| 项 | 现状 | 改造后 |
|---|---|---|
| `compat.ts` | 20 处 `vendored/**` 深路径 import + 手工签名对齐 | **整文件删除** |
| 27 个源文件的 import | `from '@faicad/faijs-core/vendored/**'` | `from '@faicad/faijs-core/brep'`（单一说明符） |
| 签名对齐 | 散落在 `compat.ts`（如 `rotate` 手工包装） | 由 brep 面官方承担（P2） |

验收：`grep -rn vendored packages/sheetmetal/src` = 0；`compat.ts` 不存在；
库在 Node 宿主下经 `registerLib` 注册后，`.fai.js` 可调用并产出 `hasBrep === true` 的 `Shape`。

### 9.3 新增端到端验收（两个库都要过）

```js
// .fai.js
import * as sheet from '@faicad/sheetmetal'
let p0 = cad.box({ size: [100, 60, 2] })
let p1 = sheet.hem(p0, { edge: 'front', radius: 3, length: 10 })
let p2 = sheet.unfold(p1)          // 多输出：{ flat, bends }
let p3 = cad.union(p1, cad.box({ size: [10, 10, 10] }))
```

断言：
1. `p1` 是 faijs `Shape`（`hasBrep === true`，mesh 载荷非空）
2. `p3` 的布尔走 BREP 路径（`part1` 的 BREP 槽未被库调用破坏）
3. `p2` 多输出解构正确（`compile.ts` 的 `outputKeys` 路径）
4. 导出 STEP 含 `ADVANCED_FACE`
5. 增量：改 `p0` 尺寸后重跑，只有下游重算；改库版本后**全部重算**（验证 §8.3 缺陷 1 已修）
6. `mode='mesh'` 下调 `sheet.hem` → 抛 `E_MESH_UNSUPPORTED`，不回退

---

## 10. 分阶段计划

| 阶段 | 内容 | 破坏性 | 验收 |
|---|---|---|---|
| **P0** | 冻结兼容面基线：把 §5.2 的纳入清单写成快照测试（vendored 面符号的存在性与签名） | 无 | 快照测试通过 |
| **P1** | 新增 `packages/core/src/brep.ts`（筛选 + 语义封装）+ core/根门面 exports 子路径 | 纯新增 | 子路径可 import；守卫：该面不含内核管理符号 |
| **P2** | 签名对齐上移为官方职责：brep 面提供与上游一致的签名（`rotate` 等原在 `compat.ts` 手工适配的部分） | 纯新增 | 兼容清单内符号签名与上游一致 |
| **P3** | `adaptBrepLib` 落地（§7 六项职责）+ Shape↔Solid 双向桥提升到公开面 | 纯新增 | 单测覆盖 6 项职责 |
| **P4** | 改造 mech-lib：删 brepjs 依赖 / 改 import / 删 `ensureKernelInjected` 与 `pinned` | 中 | `c3` 四项断言零改动通过；源码零 brepjs |
| **P5** | 改造 sheetmetal：删 `compat.ts`，27 文件 import 收敛为单一说明符 | 中 | §9.2 验收 |
| **P6** | 修增量缺陷 1：库身份进 `computeKey` | 低 | 换库版本触发全量重算 |
| **P7** | 修增量缺陷 2：sheetmetal 折弯表注册表显式化 + 纯函数守卫 | 中 | 跳过语句后展开结果一致 |
| **P8** | 端到端验收（§9.3 六项断言，两库各一遍） | 无 | 全通过 |

**顺序硬约束**：P2 必须早于 P5——sheetmetal 的 `compat.ts` 现在承担签名对齐，
先删它而 brep 面未提供对齐会直接崩。

---

## 11. 风险与未决问题

| # | 问题 | 处理 |
|---|---|---|
| Q1 | brep 面的实现当前仍落到 vendored brepjs，是否算「间接访问 brepjs」？ | 见 §4.2：区别在契约层。faijs 对该面承担稳定性与语义责任，实现可整体替换。Q1 需要用户确认接受。 |
| Q2 | `vendored/*` 通配 exports 现在仍开着（26 键最后两个），库作者理论上还能 import 深路径 | 建议保留通配（faijs 自身 `api/generated` 有 468 处相对 import 依赖它），改由**守卫脚本**禁止第三方库接入走深路径（既有 vendored 测试套件入白名单）。破面为零。 |
| Q3 | brep 面的符号规模（112 段导出）是否需要一次性全量开放？ | 建议按 §5.2 分族开放，优先图元/布尔/变换/扫掠/查询/测量/数学（覆盖 sheetmetal 与 gear 的全部需求），高级造型族次之。 |
| Q4 | 多输出库函数（`unfold` 返回 `{flat, bends}`）在 brep 面的形态 | 返回普通对象即可，`compile.ts` 的 `outputKeys` 路径已支持解构赋值。 |
| Q5 | 库内部 op 不受分派管辖（§8.1）是否可接受？ | 这是「改包名即可」的必要条件（brepjs 库内部的 op 序列是它的实现）。分派发生在语句级，符合 faijs 红线。需用户确认。 |

---

## 12. 待用户确认

1. **Q1**：接受「brep 面当前用 vendored brepjs 实现，但契约与实现分离、实现可替换」这一设计？
2. **Q2**：深路径守卫方案（保留通配 + 守卫脚本）是否认可？
3. **实施范围**：P0–P3（纯新增、非破坏性，可完整验证）→ 还是 P0–P8 全量（含 P4/P5 两个破坏性改造）？
