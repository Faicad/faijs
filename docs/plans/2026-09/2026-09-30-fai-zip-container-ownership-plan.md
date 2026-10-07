# `.fai.zip` 容器层归属调整计划

> Status: 实施中
> Scope: faijs monorepo（`packages/core`、`packages/fcstd`）+ 3d_editor 依赖面
> 规范依据: `docs/fai-zip-format.md`（`.fai.zip` 容器格式规范，本计划的实现必须与之一致）

## 1. 问题

`.fai.zip` 是 faijs 自身定义的唯一容器格式（`docs/fai-zip-format.md` §1），但它的读实现与 manifest 模式当前寄居在 `packages/fcstd`（`@faicad/faijs-fcstd`）——一个 FreeCAD FCStd 转换包。宿主项目为了读写自己的工程格式，必须依赖一个与自身无关的转换包。

容器层在 fcstd 内的实际构成：

| 位置 | 行数 | 内容 |
|---|---|---|
| `packages/fcstd/src/container.ts` | 137 | manifest/models 模式（`ContainerManifest`、`ContainerModel`）与 FCStd 转换账本（`FaiMapping`、`ObjectMappingEntry`、`initialDisposition`）混在同一文件 |
| `packages/fcstd/src/container-read.ts` | 326 | 统一的 `.fai.zip` 读 API，只依赖 `fflate` 与两个 type |
| `packages/fcstd/src/build-fai-zip.ts` | 140 | FCStd → `.fai.zip` 写出 |

3d_editor 对该包的引用共 4 处源文件，全部只触及容器读层与容器类型；FCStd 解析与转换链路（`document.ts`、`sketch-parse.ts`、`feature-translate.ts`、`codegen.ts`、`convert.ts`，合计约 1.2 万行）零引用：

| 3d_editor 位置 | 用到的东西 |
|---|---|
| `packages/app/src/engine/project/project-store.ts:27-28` | `ContainerModel` 类型、`readDataMember` |
| `packages/app/src/stores/serialization/snapshot-serializer.ts:14` | `ContainerManifest`、`ContainerModel` 类型 |
| `packages/app/src/stores/serialization/snapshot-io.ts:24` | `ContainerModel` 类型 |
| `packages/platform/src/internal/zip-project.ts:32-33` | `openContainer`、`ContainerManifest`、`ContainerModel` |

由此产生的代价：

- 依赖声明在三个包里各写一次（`3d_editor/package.json:104`、`3d_editor/packages/app/package.json:15`、`3d_editor/packages/platform/package.json:17`），并在 3d_editor 根 `package.json` 的 `overrides` 中为 `@faicad/faijs-fcstd` 单独钉一条 `file:` 路径。
- 传递引入 `@faicad/faijs-draw`、`@faicad/faijs-sketch`、`@xmldom/xmldom`、`fflate`，以及 peer `occt-wasm`。
- `zip-project.ts:30-31` 已出现绕包边界的写法：为避免包根 index 连带 `sketch-parse`，导入只能精确到 `container-read` 子路径。
- 反向耦合同时存在：`packages/core/scripts/probe-a2-beds.ts:14` 与 `probe-beds-parts.ts:13` 用跨包相对路径 `import '../../fcstd/src/container-read.js'`。
- 依赖方向不正确：`fcstd` 依赖 `@faicad/faijs`（core），而容器层又把 core 的 `ProjectLoader` 端口当作外部契约使用；正确方向应只有 fcstd → core 一条。

同一处代码还有两个与归属无关但必须一并修的缺陷：

- `packages/core/src/io/zip.ts` 的契约声明它是「faijs 与宿主读写 ZIP 的唯一入口，下游（3MF loader、export-model writer、fcstd、demo）都应使用它而不是直接用 fflate」，但 `container-read.ts:15` 直接 `import { unzipSync } from 'fflate'`，绕开了 `io/zip.ts` 的解压上限；3d_editor 的 `zip-project.ts:60-62` 又重复定义了一份上限常量。
- `io/zip.ts` 目前仓内只有一个消费者（`packages/core/src/mesh/threemf-loader.ts:178`）。容器层迁入 core 后成为它的第二个（读）与第三个（写）消费者。

## 2. 架构决定

容器层（manifest 模式 + 读 API + 写 API）归 `packages/core`，子路径为 `@faicad/faijs/io/fai-zip`；`@faicad/faijs-fcstd` 不再持有任何容器层符号。

读与写一起收：core 提供格式级 manifest 构造与容器组装，fcstd 的转换写出与 3d_editor 的工程保存都改用同一份实现。

错误呈现方式保持 throw，与 `packages/core/src/io/zip.ts` 的契约一致（该层「失败即抛，无降级返回值」）。

依赖方向收敛为两条单向边：`fcstd` → `core`、`3d_editor` → `core`。容器层不依赖任何 FCStd 概念，也不依赖 `node:*`（web worker 与浏览器可用）。

## 3. 目标设计

### 3.1 目录与子路径

```
packages/core/src/io/
  index.ts              通用 ZIP 层（不 re-export 容器层）
  zip.ts                通用 ZIP 读写（不改）
  fai-zip/
    index.ts            子路径入口 @faicad/faijs/io/fai-zip
    container.ts        manifest / models / asset 模式（零 FCStd 概念）
    container-read.ts   读 API
    container-write.ts  写 API
```

`packages/core/package.json` 的 `exports` 增加显式条目 `./io/fai-zip`，与现有 `./io/*` 通配并存（显式条目优先，通配对嵌套目录不作保证），构建后以 `import('@faicad/faijs/io/fai-zip')` 实测可解析。

`io/index.ts` 不 re-export 容器层：通用 ZIP 层是格式层的底座，底座不反向依赖格式层。

### 3.2 包边界划分

| 符号 | 归属 | 说明 |
|---|---|---|
| `ContainerManifest`、`ContainerModel` | core | 规范 §4 的 manifest 模式 |
| `ContainerAssetEntries`、`OpenContainerResult` | core | 规范 §7 的载荷表与读取结果 |
| `readManifest`、`listModels`、`listModules`、`readModule`、`readDataMember`、`readAssetEntries`、`openContainer` | core | 规范 §9 读方义务的实现 |
| `createManifest`、`writeContainer` | core | 规范 §10 写方义务的实现（新增） |
| `ObjectDisposition`、`ObjectMappingEntry`、`ParamMappingEntry`、`FaiMapping` | fcstd | `mapping.json` 是规范 §3 的「FCStd 转换约定」成员，账本模式属转换方 |
| `FcstdArchive`、`FcstdMember`、`parseDocumentXml`、sketch 与表达式解析面 | fcstd | FCStd 解析链路，保持原状 |

### 3.3 读 API

函数集合与现行实现一致，底层由 fflate 切到 `io/zip.ts` 的 `readZipEntries`：

```ts
export interface OpenContainerOptions {
  /** 覆盖 manifest.active；未提供时取 manifest.active，再退到 models[0] */
  modelId?: string
  /** 覆盖 io/zip 的默认解压上限（maxEntries / maxTotalBytes） */
  caps?: ZipReadOptions
}

export function openContainer(bytes: Uint8Array, opts?: OpenContainerOptions): OpenContainerResult
```

`openContainer` 的第二参数由 `string` 改为 options 对象；3d_editor 的唯一调用点 `zip-project.ts:160` 是单参数调用，改动量为零。

非 ZIP 输入的错误保留 `[fai-zip]` 前缀：捕获 `readZipEntries` 抛出的 `zip read failed: …` 并重新抛出带 `cause` 的 `[fai-zip] cannot open container as ZIP: …`；manifest 级错误文案不变。3d_editor 现有测试只断言 `.fai.zip` 扩展名字符串，不断言该错误文案。

`caps` 存在的必要性：容器通道此前没有任何上限，而 fcstd 产物含 `freecad/**` 字节级影子与全部 `.brp` 资产，条目数与解压后体积由源文档决定，不受容器层控制。容器层因此保留显式的上限覆盖口；默认值不另设一套，直接沿用 `io/zip.ts` 的默认值。

`io/zip.ts` 的默认上限本次一并由 5000 条目 / 64 MiB 上调为 **9999 条目 / 512 MiB**，浏览器与 Node 共用同一套值。两点依据：其一，该上限是**解压后**检查（`unzipSync` 返回完整结果后才按条目累加 `byteLength`；实测 64 MiB 恰好放行、80 MiB 抛 `content exceeds limit (maxTotalBytes …)`），它限制的是「一次读入后调用方保留与遍历的量」，属资源预算而非安全边界——`io/zip.ts` 文件头「protect against zip bombs」的表述属过度声明，本次一并改正；其二，原值取自交互式「用户随手选文件」场景，对加载工程文件过小。上限语义保持排他上界（`totalBytes > maxTotalBytes` 即抛）。

真正的解压前拦截（`unzip` 的 `filter` 逐条目按 `originalSize` 累计、超限即否决整个归档）是 `io/zip` 层的独立议题：它会同时影响 3MF loader、export-model、fcstd、demo、3d_editor 全部消费者，**不属本次归属迁移范围**，另行排期。

### 3.4 写 API

写 API 的输入是「组装输入」，不含 FCStd 概念，并支持 producer-defined 成员透传（规范 §3，fcstd 需要写入 `mapping.json` 与 `freecad/**`）：

```ts
export interface ContainerAssembly {
  models: ContainerModel[]
  active?: string
  meta?: {
    createdAt?: string
    appVersion?: string
    label?: string
    source?: ContainerManifest['source']
    requiresBrep?: boolean
  }
  /** `model/**` 成员：包内完整路径 → 源码 */
  modules: Record<string, string>
  /** 数据成员：成员路径（如 `data/plate.json`）→ JSON 文本。规范 §6 不定义其键，写方掌控 */
  dataMembers: Record<string, string>
  /** `files/**` 载荷：key（fileId）→ 字节 */
  files: Record<string, Uint8Array>
  /** `assets/**` 载荷：成员路径 → 字节 */
  assets: Record<string, Uint8Array>
  /** producer-defined 成员（规范 §3）：`mapping.json`、`freecad/**` 等，原样写入 */
  producerMembers?: Record<string, Uint8Array>
}

/** 构造并校验 manifest（唯一实现） */
export function createManifest(input: Pick<ContainerAssembly, 'models' | 'active' | 'meta'>): ContainerManifest

/** 组装容器：返回字节与被写入的 manifest */
export function writeContainer(assembly: ContainerAssembly): { bytes: Uint8Array; manifest: ContainerManifest }
```

`writeContainer` 的强制断言（违反即抛，不允许静默产出不可重建的容器）：

1. `models` 非空，`models[].id` 唯一，`models[].entry` 唯一。
2. 每个 `models[].entry` 必须在 `modules` 中存在。
3. 每个 `models[].data` 必须在 `dataMembers` 中存在（按成员路径）。
4. `active` 必须等于某个 `models[].id`。
5. `files` 与 `assets` 的相对键集合互不相交（规范 §7.1）。
6. `entry` 必须位于 `model/` 下且以 `.fai.js` 结尾。

`dataMembers` 按成员路径而非 model id 作为键：规范 §4 中 `models[].data` 是任意容器路径，`data/<modelId>.json` 是写出方的约定，不由格式层强加；3d_editor 侧的薄封装负责 id → `data/<id>.json` 的映射。

压缩与底层写入复用 `writeZipEntries`（`io/zip.ts`，level 6）。返回值类型为 `Uint8Array`；3d_editor 现行 `buildFaiZipBytes` 返回 `ArrayBuffer`，由调用侧薄封装转换。

`writeContainer` 的适用边界：它要求组装输入自洽，即每一条 `models[].entry` 都能在 `modules` 中找到。3d_editor 的保存路径满足——`modules` 由 `loader.listModules()` 枚举，与 `models[]` 同源。fcstd 的 `buildFaiZip` **不满足**：它产出的是中间容器，`model/**` 脚本此时还不存在，由 `convert.ts` 在拿到产物后注入并二次打包（`convert.ts:383-396` 注入、`convert.ts:466` 终包）。因此 `build-fai-zip.ts` 走 `createManifest` + `writeZipEntries`——拿到 manifest 的唯一实现与统一的 ZIP 写出，但不走 `writeContainer`，否则断言 2 会误断中间态。断言 2 不因此放宽：它约束的是「对外交付的容器」，不是中间产物。

## 4. 实施步骤

### Phase 1 — core 读层落地

1. 新建 `packages/core/src/io/fai-zip/container.ts`，从 `packages/fcstd/src/container.ts` 迁入 `ContainerModel`、`ContainerManifest`、`ContainerAssetEntries`；FCStd 侧符号留在 fcstd。
2. 新建 `container-read.ts`，迁移 `readManifest`、`listModels`、`listModules`、`readModule`、`readDataMember`、`readAssetEntries`、`openContainer`，底层由 fflate 改为 `readZipEntries`，`openContainer` 增加 options 参数。
3. 新建 `packages/core/src/io/fai-zip/index.ts`，导出 §3.2 表中归属 core 的全部符号。
4. `packages/core/package.json` 增加 `./io/fai-zip` 显式 exports 条目。
5. 迁移 `packages/fcstd/src/container-read.test.ts`（356 行）到 `packages/core/src/io/fai-zip/container-read.test.ts`，并补两条接入后的行为测试：非 ZIP 输入的错误前缀与 `cause`、`caps` 覆盖生效。

### Phase 2 — core 写层落地

1. 新建 `container-write.ts`，实现 §3.4 的 `createManifest`、`writeContainer` 与六条断言。
2. 新建 `container-write.test.ts`，逐条覆盖规范 §10 写方义务的负例：漏 `entry` 成员、重复 id、重复 entry、`data` 与 `models[].data` 不匹配、`files` 与 `assets` 键冲突、`active` 不在 `models` 内、`entry` 不在 `model/` 下。
3. 补 round-trip 测试：`writeContainer` → `openContainer` 得回等价 manifest、模块表、数据成员与载荷，且 `producerMembers` 原样保留。

### Phase 3 — fcstd 收口

1. `packages/fcstd/src/container.ts` 缩为 fcstd 侧符号集合：`ObjectDisposition`、`ObjectMappingEntry`、`ParamMappingEntry`、`FaiMapping`、`initialDisposition`。
2. 删除 fcstd 的 `buildManifest`，其 `source` 与 `requiresBrep: true` 语义改由 `build-fai-zip.ts` 调用 core 的 `createManifest` 显式传入。同一语义只保留一份实现。
3. `build-fai-zip.ts` 改用 core 的 `createManifest` + `writeZipEntries`（适用边界见 §3.4）——拿到 manifest 的唯一实现与统一的 ZIP 写出，但不走 `writeContainer`。`mapping.json`、`freecad/**`、`assets/**` 与 `manifest.json` 一并交给 `writeZipEntries`，SHA-256 影子校验逻辑保持不变。
4. `packages/fcstd/src/index.ts` 删除容器读层与容器类型的全部 re-export。`@faicad/faijs-fcstd` 的公开面收缩为 FCStd 解析与转换；`exports` 中的 `./*` 通配意味着 `/container-read` 与 `/container` 子路径导入将硬失效，属预期行为（项目取向为不做迁移兼容）。
5. 删除 `packages/fcstd/src/container-read.ts`。
6. `container-open-e2e.test.ts` 与 `draft-analytic-e2e.test.ts`、`draft-chain-e2e.test.ts`、`draft-parametric-e2e.test.ts` 留在 fcstd（依赖转换产物），import 改指 core 子路径；`build-fai-zip.test.ts` 留在 fcstd。
7. `convert.ts` 的终包 `zipSync(members, { level: 6 })` 改走 core 的 `writeZipEntries`，消除 fcstd 内对 `fflate` 写路径的直接调用。
8. 清理 `packages/core/scripts/probe-a2-beds.ts:14` 与 `probe-beds-parts.ts:13` 的跨包相对导入。
9. 实测现有 fcstd 产物的解压条目数与解压后总字节数，确认默认上限（9999 条目 / 512 MiB）够用；不足则据实上调 `io/zip.ts` 的默认值，不在容器层另设一套。

### Phase 4 — faijs 守卫与构建

1. 跑 `node scripts/check-ghost-deps.mjs`，按实际使用的 import 决定 `packages/fcstd` 的 `fflate` 依赖是否保留（`unpack.ts` 仍直接使用它，除非 Phase 6.3 实施），不得留幽灵依赖。
2. 跑 `npx madge --circular packages/*/src` 确认包图无环。
3. `npm run build -w @faicad/faijs` 与 `npm run build -w @faicad/faijs-fcstd`，构建后验证 `@faicad/faijs/io/fai-zip` 可解析、`@faicad/faijs-fcstd/container-read` 已不可解析。
4. 版本推进只允许经 `node scripts/set-version.mjs <ver>`，随后跑 `node scripts/check-lockstep.mjs`。
5. `npm run pack` 产出新 tarball（3d_editor 消费的是 `packages/core` 与 `packages/fcstd` 的 tgz）。

### Phase 5 — 3d_editor 切换

1. 四个源文件改 import 到 core 子路径：`project-store.ts:27-28`、`snapshot-serializer.ts:14`、`snapshot-io.ts:24`、`zip-project.ts:32-33`，并删除 `zip-project.ts:30-31` 那条绕包边界的注释。
2. `snapshot-serializer.ts:155` 的 `buildFaiZipBytes` 改为 core `writeContainer` 的薄封装（含 `Uint8Array` ↔ `ArrayBuffer` 与 id → `data/<id>.json` 的映射），`FaiZipAssembly` 与 `ContainerAssembly` 同形时直接复用；`snapshot-io.ts:237` 的调用点同步。
3. 删除三处依赖声明（`3d_editor/package.json:104`、`packages/app/package.json:15`、`packages/platform/package.json:17`），并删除根 `package.json` 的 `overrides` 中 `@faicad/faijs-fcstd` 条目。
4. 重新安装依赖并刷新 lock（`file:` tgz 内容变更必须重装，否则子路径解析失败）。
5. `packages/platform/src/internal/zip-project.ts` 的 `MAX_ENTRIES` / `MAX_TOTAL_BYTES` 改为直接引用 `@faicad/faijs/io` 的默认值，不再复制一份常量。这不是可选的整洁化：该 guard 跑在容器判定**之前**，本仓库若仍是 5000 / 64 MiB，容器会先在这里被拒——上调 `io/zip.ts` 的默认值到 512 MiB 在编辑器里就等于没生效。上限文案同步改为按常量算出。
6. 根 `package.json:68-69` 的 `@faicad/faijs-draw` 与 `@faicad/faijs-sketch` 本次不动：虽然全仓源码 import 数为 0，但它们服务于 3d_editor 自身的 sketch/draw 接入，删除属误伤。
7. 注意 `file:` 依赖的既有坑：同路径 tgz 换内容时 npm 会命中 lock 里的旧 integrity 并复用缓存中的旧包，`npm install` 不会重新解包。收口时必须删掉 lock 中对应条目（含 `packages/*/node_modules/@faicad/faijs` 这些陈旧嵌套副本）并删除磁盘副本，再重装，然后核对 `node_modules/@faicad/faijs/dist/io/fai-zip/` 真的存在。
8. 重装后核对装上的副本与源码同源：`node_modules/@faicad/faijs/dist/io/zip.js` 与「当前 `src/io/zip.ts` 单独编译产物」逐字节一致（差异只允许 `sourceMappingURL` 行），确认 tgz 未落后于源码。
9. `packages/platform` 的验证用一次性 include 覆盖执行 `src/__tests__/*.test.ts`（原因见 §5），不修改仓库的 vitest 配置——该排除是既有配置，是否收编这批测试另行决定。

### Phase 6 — 可选清理（不列入验收）

1. `packages/app/src/stores/serialization/snapshot-io.ts:229` 动态导入的 `three/examples/jsm/libs/fflate.module.js` 改走 `@faicad/faijs/io`，消除仓内第二份 fflate 实例。
2. `packages/fcstd/src/unpack.ts` 切到 `io/zip.ts`：需 `io/zip.ts` 先暴露 ZIP 注释（EOCD comment），否则不切。
3. 提供 `writeContainerAsync`（转发 `writeZipEntriesAsync`），供大工程保存时不阻塞事件循环。
4. 补 `mapping.json` 的读取器（规范 §3 列为 FCStd 转换约定成员，当前无 reader）。
5. 更新 `.agents/notes/implemented/feature/2026-09-28-unified-fai-zip-container-v3.md` 中「读 API 归属 fcstd」的结论并同步 `.zh.md` 与 `.i18n.yaml`（Agent Note 是双语配对档，三件必须同步）。
6. 编辑器重存 fcstd 产物时会丢掉 `manifest.source` / `manifest.requiresBrep`（`FaiZipAssembly` 不携带这两个字段）。`requiresBrep` 是执行判据而非展示字段，丢它会让「必须走 BREP 链」的容器被重新写成未声明——属既有缺陷，与本次归属迁移无关，单独评估。

## 5. 验收标准

faijs 侧：

- `npm run test -w @faicad/faijs` 与 `npm run test -w @faicad/faijs-fcstd` 通过，且无 `stderr |` 输出（CI 零容忍）。
- `npm run typecheck`、`npm run lint`、`node scripts/check-ghost-deps.mjs`、`node scripts/check-workspaces-order.mjs`、`npx madge --circular packages/*/src` 全部通过。
- `io/zip.ts` 的默认上限（9999 条目 / 512 MiB）由测试锁定，防止无声回退。
- `npm run build` 与 `npm run pack` 通过；构建产物中 `packages/core/dist/io/fai-zip/` 存在，`packages/fcstd/dist/container-read.js` 不存在。
- `npm run doc-sync` 通过。

3d_editor 侧：

- `npm run typecheck` 通过；`packages/app/src/stores/serialization` 与 `packages/platform` 的 vitest 通过（含 `snapshot-serializer.test.ts` 对 `manifest.json` 内容的断言）。
- `test/e2e/snapshot.spec.ts`、`snapshot.cylinder-engraving.spec.ts`、`snapshot.sdf.spec.ts` 三个 e2e 通过（覆盖 `.fai.zip` 的打开与保存端到端路径）。
- `npm ls @faicad/faijs-fcstd` 在 3d_editor 下为空——该包不再出现在依赖树中。
- `node scripts/check-faijs-lockstep.mjs`、`node scripts/check-ghost-deps.mjs --lint-gate` 通过。

关于 `packages/platform` 的 vitest：`zip-project.test.ts` 位于 `packages/platform/src/__tests__/`，而根 `vitest.config.ts` 的 `exclude` 含 `packages/*/src/**/__tests__/**`（该行由 2026-09-18 的 monorepo 重组引入，早于这些测试文件的建立），`vitest.jsdom.config.ts` 的 `include` 只覆盖 `packages/app/src/**/__tests__/`。因此该目录下 5 个文件（64 个用例）在当前配置下不被任何 vitest 配置收集，也不在根 `tsconfig.json` 的 `include` 内（根配置只含 `packages/platform/src/**/*.d.ts`）。本次验证以一次性 include 覆盖跑通该文件（8 files / 83 tests 全绿）；**测试文件未被收集属既有问题，不属本次归属迁移的改动面**，另行处置。

功能等价：

- 用迁移后的代码打开既有容器（fcstd 产物 + 3d_editor 保存的工程）行为不变。
- 用迁移后的代码写出的容器能被未迁移的读方打开（格式未变，`format: 3` 未动）。

## 6. 风险

| 风险 | 说明 | 处置 |
|---|---|---|
| 解压上限变化 | 容器通道从「无上限」变为继承 `io/zip.ts` 的 9999 条目 / 512 MiB；fcstd 产物的条目数与解压后体积由源文档决定，不受容器层控制 | Phase 3.9 实测条目数与解压后字节数，确认默认值够用；不足则上调 `io/zip.ts` 默认值，不在容器层另设一套 |
| 新断言误断既有产物 | `writeContainer` 的六条断言严格于现行 `buildFaiZipBytes` 与 fcstd 的组装路径 | Phase 5.2 迁移后立即跑 `snapshot-serializer.test.ts` 与三个 snapshot e2e；断言只在违反规范 §10 时触发，触发即视为既有缺陷而非需放宽断言 |
| `dist/` 残留造成误判 | 旧构建产物里仍有 `packages/fcstd/dist/container-read.js`，会让已删除的 import 继续解析成功 | 验证前先 clean 两侧 `dist/`，以「构建后 `/container-read` 不可解析」作为收口证据 |
| 版本线联动 | 包族 lockstep 要求各包 `version` 与 root `config.faijsVersion` 一致 | 只经 `scripts/set-version.mjs` 改版本，改后跑 `check-lockstep.mjs` |
| 3d_editor 依赖重装 | `file:` tgz 依赖不会自动跟随内容变化 | Phase 5.4 强制重新安装并刷新 lock |
| fcstd 依赖面误判 | `fflate` 在 `unpack.ts` 仍被使用，`@faicad/faijs-draw` / `@faicad/faijs-sketch` 在转换链路真被使用 | 依赖增删按 `check-ghost-deps.mjs` 与真实 import 决定，不凭印象增删 |

## 7. 影响面清单

| 侧 | 路径 | 动作 |
|---|---|---|
| core | `src/io/fai-zip/container.ts` | 新增 |
| core | `src/io/fai-zip/container-read.ts` | 新增（自 fcstd 迁入并改底层） |
| core | `src/io/fai-zip/container-write.ts` | 新增 |
| core | `src/io/fai-zip/index.ts` | 新增 |
| core | `src/io/fai-zip/container-read.test.ts` | 迁入并补测 |
| core | `src/io/fai-zip/container-write.test.ts` | 新增 |
| core | `package.json` | 增加 `./io/fai-zip` exports |
| core | `src/io/zip.ts`、`src/io/index.ts` | 改默认上限（5000 / 64 MiB → 9999 / 512 MiB）、导出上限常量、改正「防 zip 炸弹」的过度声明；读写实现不改 |
| core | `scripts/probe-a2-beds.ts`、`scripts/probe-beds-parts.ts` | 改 import 指向 `src/io/fai-zip` |
| fcstd | `scripts/probe-products.ts`、`scripts/probe-a2-exec-sweep.ts`、`scripts/probe-a2-fillet-baseline.ts` | 改 import 指向 core 子路径 |
| fcstd | `scripts/probe-container-size.ts` | 新增：实测产物条目数与解压后字节数（Phase 3.9 的证据来源） |
| fcstd | `src/container.ts` | 缩为 fcstd 侧符号 |
| fcstd | `src/container-read.ts` | 删除 |
| fcstd | `src/container-read.test.ts` | 迁往 core |
| fcstd | `src/build-fai-zip.ts` | 改用 core `createManifest` + `writeZipEntries`（见 §3.4） |
| fcstd | `src/convert.ts` | 终包改走 core `writeZipEntries` |
| fcstd | `src/index.ts` | 删除容器层 re-export |
| fcstd | `src/container-open-e2e.test.ts`、`src/draft-analytic-e2e.test.ts`、`src/draft-chain-e2e.test.ts`、`src/draft-parametric-e2e.test.ts`、`src/build-fai-zip.test.ts` | 保留，改 import |
| fcstd | `package.json` | 按实际 import 复核 `fflate` 依赖 |
| 3d_editor | `packages/app/src/engine/project/project-store.ts` | 改 import |
| 3d_editor | `packages/app/src/stores/serialization/snapshot-serializer.ts` | 改 import + 改用 core 写 API |
| 3d_editor | `packages/app/src/stores/serialization/snapshot-io.ts` | 改 import |
| 3d_editor | `packages/platform/src/internal/zip-project.ts` | 改 import + 删除绕边界注释 + 上限常量改引 `@faicad/faijs/io` |
| 3d_editor | 根 / `packages/app` / `packages/platform` 的 `package.json` | 删 `@faicad/faijs-fcstd` 依赖与 overrides；三者连同 `packages/scene-kernel`、`packages/shared`、`packages/weapp` 的 faijs tgz 引用一并落在 `0.22.4` 版本线（消费本次重打的包） |
| 3d_editor | `package-lock.json` | 删陈旧 lock 条目（同路径 tgz 换内容会命中旧 integrity）后重装 |
