# Demo 浏览器端项目加载（本地文件夹 + zip，重做方案 · 可执行版）

> 状态：**已落地**（2026-09-09 验收全绿：core 1301 通过、demo 单测 19/19、e2e 24/24、doc-sync 12 项全过、全量 CI 通过）
> 日期：2026-09-09
> 取代：`docs/plans/2026-09-09-browser-project-loader-design.md`（方向错误：实现放错了包，见 §2）
> 实测基准：commit `3a2a889`
> **可执行性声明**：本文所有决策已在 §4 定死，**无待确认项**。第三方按 §7 的步骤顺序执行、
> 用 §6 的判据验收、以 §9 的 DoD 收尾即可，不需要再向任何人确认。

---

## 1. 用户原话（逐字）

本轮（第三轮，新增 zip 通道）：

> 此外，你在方案里最好写两个browser端的实现，加一个zip的实现。这样方便测试。文件夹权限似乎必须手动点击确认，无法自动化测试。zip的话，直接把mini_lathe项目打包就可以验证了。

第二轮：

> 我对整份方案都持反对意见。我有一个疑惑，为何在packages/core里，实现browser-host/directory-project-loader.ts ？ 这个host明显不属于core呀？我希望的是在demo里，实现对本地文件夹的支持，以及未来实现在3d_editor中。

> 请彻底重新分析这个需求，完成一份新的实现方案

> 好的，分析这个文档，是否可以交个第三方无歧义的执行。不要留待确认的东西。

第一轮（最初需求，旧方案 §1 原文）：

> 最后一次提交，实现了.fai.js文件的引用，且基于node.fs实现的。可以查看mini_lathe项目的相关代码。现在，我需要在browser host里也支持这个语法特性，用demo项目做测试。你可以参考这个项目C:\git\OpenCascade\BREP.io， 它支持在浏览器里管理本地文件夹。请写一份技术实现方案

**需求重述（本方案与旧方案的分水岭）**：相对 import 的**语法特性**已由引擎支持完毕
（`1a7cb6e`：契约 + `ModuleRegistry` + `entryKey`），浏览器侧不缺语法，缺的只是
"一个项目文件夹的文本从哪儿读"。因此本次 100% 是**宿主应用（demo）如何拿到项目文件**，
不是引擎能力。

**两个通道的分工（用户本轮点明的核心动机）**：

| 通道 | 交互 | 能否自动化 |
|---|---|---|
| **folder**（File System Access API 目录句柄） | 系统目录选择弹窗，**必须有真实用户手势** | **否** —— 现有 e2e 把 `showDirectoryPicker` stub 成 OPFS 根，真实 picker 从未被触达 |
| **zip**（`<input type=file>` + 解压） | 文件选择 | **是** —— Playwright `setInputFiles` 可直接注入内存 buffer 并派发 `change`，走的是**真实 DOM 路径**，无 stub |

所以 zip 通道不只是"多一种输入方式"，它是**唯一能端到端自动验证真实 mini_lathe 多文件项目的通道**：
直接在测试里把 `packages/mini_lathe` 打成 zip 喂进去，不需要人工点任何对话框。

---

## 2. 对旧方案的裁决（结论，不再讨论）

**核心错误：把「宿主应用的文件来源策略」放进了引擎包。**
`createDirectoryProjectLoader` 决定的全是策略：项目根是谁、只认哪些文件、跳过什么目录、
清单何时刷新。而 `browser-host/` 里其它成员（`BrowserEventSink` / `BrowserFontProvider` /
`FetchAssetResolver` / Worker 后端）全是**无策略的环境适配器**——给定浏览器环境只有一种写法。

最硬的证据是**消费者**（2026-09-09 全仓 grep 实测）：

| 实现 | core 内消费者 | 唯一消费方 |
|---|---|---|
| `createFsProjectLoader` | **有** — `node-host/cli.ts` L21/L76 | core 自带 CLI |
| `createDirectoryProjectLoader` | **零** | `packages/demo/main.ts` L16/L564 |

"与 node fs loader 对称"不成立：node 版是"core 实现、core 消费"的包内自用工具；浏览器版是
"替 demo 写的代码放错了包"。且 **Node 里项目来源只有一个答案（fs）**，浏览器没有——
FSA picker / OPFS / 拖拽目录 / zip / IndexedDB，选哪个是产品决策。对称的只是形状，不是归属。

旧方案另有四处错误（已在本方案纠正）：① 把与多文件无关的引擎改动 `autoLiftFor` 混进同一次提交；
② 把 demo 的 UI 决策（默认入口、`__proj:` 下拉、`Project:` 前缀）写进 core 方案文档；
③ 给 core 内零消费者的实现配 242 行单测；④ e2e 用 OPFS stub 顶掉真实 picker，却没写
"真实 picker 无自动化覆盖"与人工验收要求（本方案 §6.3 补齐，zip 通道则把它变成可自动化）。

---

## 3. 范围

### 3.1 目标

1. 把浏览器目录加载器从 core 迁到 demo，**行为逐字不变**（key 约定、跳过集、越界防御、`refresh()` 语义、UI 文案）。
2. demo 保留 Open Folder 能力：挂载本地文件夹 → 枚举 `.fai.js` → 选入口 → 以 `entryKey` 执行，跑通 mini_lathe 装配。
3. **新增 zip 通道**：`Open Zip` 按钮 → 选 `.zip` → 解压出全部 `.fai.js` → 同一套 `entryKey` 流程执行。
4. **zip 通道必须被 e2e 全自动覆盖**，且用的是真实 `packages/mini_lathe`（测试内现打 zip，不落二进制）。

### 3.2 非目标 / 不得改动清单（第三方请勿越界）

- **不新建任何 workspace 包**（不为 demo 与 3d_editor 预建共享包）。
- **不改既有 UI 元素的形态**：`#open-btn` / `#open-dir-btn` / `#file-input` / `#example-select`
  的 id、位置、文案、`__proj:` option 约定、`Project:` 状态前缀一律保持现状
  （只**新增** `#open-zip-btn` 与 `#zip-input`）。
- **不改 `packages/demo/e2e/demo.spec.ts` 的既有断言**：P1（搬家）结束后它应当是**零 diff**；
  P2（zip）只允许**追加**用例，不允许改写既有用例。
- **不动引擎**：`cad-runtime/`、`node-host/`、`autoLiftFor`、`libLoader` 全部不动。
- **不动** `packages/cq-compat` 的 5 个 `top` → `top_face` 改名与 tests README 双语修复
  （修的是 pre-existing 红，与本题无关，回退它们只会制造噪声）。
- **不做** zip 写回 / 导出 zip / 从 URL 拉 zip / 拖拽目录 / IndexedDB 持久化 / 多目录挂载 /
  `findProjectRoot` 浏览器版（延续旧方案的非目标，本方案也不做）。
- 3d_editor 的实现不在本次范围，见 §5.7。

---

## 4. 已定决策（D1–D15，第三方照做，无需再问）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 目录加载器归属 | **迁出 core，落在 `packages/demo/src/project/`** |
| D2 | `createBrowserPorts({ projectLoader })` 透传 | **保留**。它与 `csg`/`sdf`/`assets`/`events`/`libLoader` 同构（每个可注入 HostPorts 字段都有一个 option），零策略；相应保留 `browser-host/index.test.ts` 里那两个注入用例 |
| D3 | `autoLiftFor` | **保留不动**。它与多文件无关，属于"demo 与 CLI 的 `autoLift` 默认值不一致"这个独立缺陷，且现有 e2e 已证明关掉提升后装配才不跑崩；回退它会立刻让 demo 装配红，替代方案未经验证。它在新 Agent Note 里单独记一条 |
| D4 | demo 文件布局 | `packages/demo/src/project/` 下 **5 源 + 2 测试**（§5.2），**不建 `index.ts` barrel** |
| D5 | `ProjectLoader` 类型来源 | **用 `NonNullable<HostPorts['projectLoader']>` 投影**，不深导入 core 内部路径，避免幽灵依赖守卫风险 |
| D6 | 单测 | **给 demo 装 vitest**（§5.8），纳入 CI |
| D7 | demo typecheck | **不加 `typecheck` 脚本**（基线已红，见 §5.9）；验证方式是"错误集合不增" |
| D8 | 既有 UI | **不改**（见 §3.2）；只新增 zip 的两个元素 |
| D9 | 共享包 | **不建**（只有一个消费者；3d_editor 自己实现，见 §5.7） |
| D10 | zip 解压库 | **fflate `^0.8.3`**，声明进 `packages/demo/package.json` 的 **dependencies**。理由：它已在仓库依赖树内（`manifold-3d` 与 `@types/three` 的传递依赖，实测 `npm ls fflate` → `fflate@0.8.3 deduped`），`npm install` 不需要新下载；MIT、约 8KB、`unzipSync` 覆盖 store/deflate/目录条目。手写 zip 解析器需新增约 150 行未经生产验证的二进制解析代码，与项目"任何没有测试的代码都不合格"冲突 |
| D11 | zip 顶层目录 | **不做顶层剥离**（§5.5-B3 给出理由：剥离与否对解析正确性无影响，但"所有文件都在 `src/` 下"的 zip 会被误剥）。改为把入口启发式升级为**后缀匹配**（§5.5-C），folder 通道同时受益 |
| D12 | zip fixture | **不落二进制 zip 进仓库**。e2e 用 `fflate.zipSync` 在测试内从 `packages/mini_lathe`（或 `e2e/fixtures/mesh-project`）现打 buffer，再 `setInputFiles` 注入。理由：fixture 永不过期、无二进制 diff、monorepo 不收构建产物 |
| D13 | zip loader 的 `refresh()` | **实现为 no-op（`Promise.resolve()`）**，不是遗漏——zip 是内存快照，重枚举无意义；实现它是为了让 `main.ts` Run 前的 `project.loader.refresh()` 对两个通道统一 |
| D14 | 两个通道的公共类型 | 统一为 `DemoProjectLoader`（`ProjectLoader & { refresh(): Promise<void> }`）；`ProjectState.loader` 字段类型改成它，两个通道可直接互换 |
| D15 | zip 依赖在 vite 中的处理 | **不 external、不加进 importmap**，由 vite 打进 bundle（约 8KB）。importmap 只外链 three / manifold-3d / occt-wasm，不变 |

---

## 5. 实施规范

### 5.1 第一步：从 core 回退（逐项，精确锚点）

| # | 文件 | 动作 |
|---|---|---|
| 1.1 | `packages/core/src/browser-host/directory-project-loader.ts` | 删除文件 |
| 1.2 | `packages/core/src/browser-host/directory-project-loader.test.ts` | 删除文件 |
| 1.3 | `packages/core/src/browser-host/index.ts` | 删除注释块与两段 export（锚点：注释"浏览器版 ProjectLoader（多文件 §4.5）：与 node-host 的 fs-project-loader 对称，"起，到 `} from './directory-project-loader'` 止，共 10 行） |
| 1.4 | `packages/core/src/browser.ts` | 删除同内容的两段（L118 注释 `// 浏览器版 ProjectLoader（多文件 §4.5）…` 起至 L126 `} from './browser-host/directory-project-loader'` 止） |
| 1.5 | `packages/core/src/browser-host/index.test.ts` | **不改**（两个 `projectLoader` 注入用例保留，见 D2） |
| 1.6 | `npm run build` | 必须重跑（core 的 dist 不会被 root `clean` 清掉） |
| 1.7 | `packages/core/dist/browser-host/directory-project-loader.{js,d.ts,js.map,d.ts.map}` | 构建后若仍存在 → 删除这 **4 个文件**（只删文件，不删目录，禁止 `rm -rf`） |
| 1.8 | `scripts/api-surface-snapshot.json` | `node scripts/api-surface-snapshot.mjs` 重生成并提交差异（CI 步骤 5 会跑它） |

**Agent Note 迁移**（不删历史，改状态）：

| # | 动作 |
|---|---|
| 1.9 | `git mv` 这 3 个文件到 `.agents/notes/rejected/architecture/`，改名 `2026-09-09-browser-project-loader-in-core.{md,zh.md,i18n.yaml}`；两个 md 的 `Status:` 行改为：`Status: rejected — 宿主「项目文件从哪来」属应用层策略，不该放进 core（已迁至 packages/demo）；其中第 4 条 autoLiftFor 决策仍然有效，见 implemented/feature/2026-09-09-demo-local-folder-project.md`；同步两个 md 里的 `English | [中文](…zh.md)` 链接文件名与 i18n.yaml 的两个键名 |
| 1.10 | `npx tsx scripts/verify-translation-pairing.ts --write .agents/notes/rejected/architecture/2026-09-09-browser-project-loader-in-core.md` 重录哈希 |

### 5.2 demo 新文件（精确规范）

目录：`packages/demo/src/project/`

```
types.ts               # 类型（引擎契约投影 + 句柄最小接口 + 两通道公共接口）
shared.ts              # 两通道共享的常量与纯函数（无 DOM、无依赖）
pick.ts                # FSA 能力探测 + 目录句柄获取（全仓唯一接触 window.* 的文件）
folder-loader.ts       # 目录句柄 → DemoProjectLoader（旧实现逐字搬迁，无 DOM，可单测）
zip-loader.ts          # zip 字节 → DemoProjectLoader（纯内存，可单测）
folder-loader.test.ts  # 单测
zip-loader.test.ts     # 单测
```

**`types.ts` —— 必须导出以下符号（签名照抄，不得改名）**

```ts
import type { HostPorts } from '@faicad/faijs/browser'

/** 引擎契约投影：不深导入 core 内部路径，也不引入新的包依赖。 */
export type ProjectLoader = NonNullable<HostPorts['projectLoader']>

/** 可枚举/可下钻的目录句柄最小接口（structurally 兼容 FileSystemDirectoryHandle 与 OPFS）。 */
export type FsDirectoryHandleLike = {
  kind?: string
  entries?: () => AsyncIterable<[string, FsEntryHandleLike]>
  getDirectoryHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsDirectoryHandleLike>
  getFileHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandleLike>
}
export type FsFileHandleLike = { kind?: string; getFile?: () => Promise<{ text(): Promise<string> }> }
export type FsEntryHandleLike = FsDirectoryHandleLike | FsFileHandleLike

/** demo 侧加载器：引擎契约 + 应用侧刷新能力。两个通道（folder / zip）都实现它。 */
export interface DemoProjectLoader extends ProjectLoader {
  refresh(): Promise<void>
}
```

**`shared.ts` —— 必须导出**

```ts
/** 项目模块扩展名（`.fai.js` 结尾即命中）。 */
export const FAI_SUFFIX = '.fai.js'

/** 枚举时跳过的目录（依赖 / 产物 / 版本控制，与 node fs 版一致）。 */
export const DEFAULT_SKIP_DIRS = ['node_modules', 'dist', 'out', '.git', '.workbuddy']

/** 越界 key 的统一报错（两通道必须逐字一致）。 */
export function escapeError(key: string): Error   // `module "${key}" escapes the project (not in enumeration)`

/** 目录/文件段是否应被跳过：以 `.` 开头，或在 skipDirs 中。 */
export function isSkippedDir(name: string, skipDirs: Set<string>): boolean

/** 入口启发式（§5.5-C）。keys 必须已排序；返回 null 表示清单为空。 */
export function pickEntryKey(keys: string[]): string | null

export function errMessage(err: unknown): string   // err instanceof Error ? err.message : String(err)
```

**`pick.ts` —— 必须导出**（folder 通道专用）

```ts
export type PickedDirectory = FsDirectoryHandleLike & { name?: string }

/** 能力缺失 → 抛 Error('File System Access API 不可用（需要 Chrome/Edge 或 localhost/HTTPS）')
 *  用户取消 / 拒绝授权 / 任何 rejection → 返回 null（不抛）。
 *  唯一接触 window.* 的模块；不碰状态栏。 */
export function pickProjectDirectory(): Promise<PickedDirectory | null>
```

### 5.3 `folder-loader.ts`（旧实现逐字搬迁）

```ts
export interface FolderProjectOptions { skipDirs?: string[] }
export async function createFolderProjectLoader(
  rootHandle: FsDirectoryHandleLike,
  opts?: FolderProjectOptions,
): Promise<DemoProjectLoader>
```

行为（**逐条照搬旧实现，不允许"顺手改进"**）：

1. 用 `shared.ts` 的 `FAI_SUFFIX` / `DEFAULT_SKIP_DIRS`；另跳过以 `.` 开头的目录；
   `opts.skipDirs` 可整体覆盖。
2. 创建时 `await refresh()` 预枚举一次；`listModules()` **同步**返回缓存副本（引擎同步调用它）。
3. `walk()`：`for await (const [name, entry] of dir.entries())`；`entry.kind === 'directory'` →
   递归；否则仅收集以 `.fai.js` 结尾的文件；key = POSIX 相对路径（`base ? base + '/' + name : name`）。
4. `refresh()`：重新 walk 并 `sort()`。
5. `readSource(key)`：先校验 `modules.includes(key)`，不在清单 → 抛 `escapeError(key)`；
   再 `descendToFile`（按 `/` 分段逐段 `getDirectoryHandle`，末段 `getFileHandle`），任一步失败 →
   抛带 key 的错误，原异常一律作为 `{ cause }` 传入（lint 规则 `preserve-caught-error`）；
   最后 `(await handle.getFile()).text()`。
6. 不实现 `fingerprint()`（旧实现也没有）。

### 5.4 `packages/demo/main.ts` 接线 —— P1（搬家，只允许这 4 处）

1. **L16 import**：删掉 `createDirectoryProjectLoader, type DirectoryProjectLoader, type FsDirectoryHandleLike`，
   改为从本地模块引入
   `import { createFolderProjectLoader } from './src/project/folder-loader'`、
   `import { pickProjectDirectory, type PickedDirectory } from './src/project/pick'`、
   `import type { DemoProjectLoader } from './src/project/types'`。
2. **L504 `ProjectState.loader`**：类型 `DirectoryProjectLoader` → `DemoProjectLoader`。
3. **L514-529 `PickedFsDirectory` 类型 + `pickProjectFolder()`**：删掉类型定义与内部 picker 逻辑，
   改为调用 `pickProjectDirectory()`；**三处 `setStatus` 文案逐字保留**
   （`File System Access API 不可用（需要 Chrome/Edge 或 localhost/HTTPS）`、`未授权访问文件夹: ${msg}`）。
4. **L564**：`createDirectoryProjectLoader(handle)` → `createFolderProjectLoader(handle)`。

`populateProjectOptions` / `selectProjectEntry` / `openProjectFolder` 的其余部分、
`exampleSelect` 的 `__proj:` 分支、`runCode` 的 `refresh()` + `entryKey` + 双 ports 注入、
状态栏 `Project: ${rootName} (${entryKey}) — ` 前缀 —— **全部零改动**。
文案 `目录 "${rootName}" 下没有 .fai.js 文件` 被 e2e 断言，**不得改写**。

### 5.5 `zip-loader.ts` —— P2（新增通道）

```ts
import { unzipSync } from 'fflate'

export interface ZipProjectOptions { skipDirs?: string[] }

/** 入参只接受字节，不接受 File/Blob —— 保证单测零 DOM 依赖（调用方负责 `await file.arrayBuffer()`）。 */
export async function createZipProjectLoader(
  data: ArrayBuffer | Uint8Array,
  opts?: ZipProjectOptions,
): Promise<DemoProjectLoader>
```

**A. 解析流程（逐条，顺序不可换）**

1. `const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data)`
   （复制一份，避免共享 buffer 的 byteOffset 语义）。
2. `unzipSync(bytes)`；抛异常 → 包成 `new Error(\`zip 解析失败: ${errMessage(err)}\`, { cause: err })`
   向上抛（由 `main.ts` 的 catch 显示为 `打开压缩包失败: …`）。
   **实测**：非 zip 字节时 fflate 抛 `Error('invalid zip data')`；Z4 断言的是外层文案
   `打开压缩包失败:`，**不要**断言 fflate 的内部消息（库升级会变）。
3. 遍历条目（**实测于 2026-09-09，fflate 0.8.3**：`zipSync`/`unzipSync` 都**不产出目录条目**，
   故"以 `/` 结尾"这一步只是防御性保留，正常路径不会命中）：
   - 目录条目（key 以 `/` 结尾）跳过；
   - 路径归一化：`\` → `/`；去掉前导 `./`；
   - 任一段命中 `isSkippedDir`（点目录或 skipDirs）→ 跳过；
   - 不以 `.fai.js` 结尾 → 跳过；
   - value 存入 `Map<string, Uint8Array>`，key 用归一化后的路径。
4. 解压后总字节 > `64 * 1024 * 1024` 或条目数 > `5000` → 抛
   `zip 内容超出上限（64MB / 5000 条目）`（在解析后立刻判定，防止巨包）。
5. `modules = [...map.keys()].sort()`。

**B. 行为约定**

1. **B1** `listModules()` 同步返回 `[...modules]`。
2. **B2** `readSource(key)`：不在清单 → 抛 `escapeError(key)`（与 folder 通道**逐字一致**，
   这是"两个通道行为可互换"的判据）；否则 `new TextDecoder('utf-8').decode(bytes)`。
3. **B3** **不做顶层目录剥离**。理由（写进代码注释）：moduleKey 与脚本里的相对 import 都以
   同一个根为基准，**剥不剥离都不影响解析正确性**；但"全部文件都在 `src/` 下"的 zip
   在"公共首段"规则下会被误剥成 `assembly.fai.js`，反而让 `src/` 这一层语义丢失。
   保持"zip 内路径 = moduleKey"这一条无例外的规则，正确性由 §5.5-C 的入口启发式兜住。
4. **B4** `refresh()` 是 **no-op**（`return Promise.resolve()`），注释写明"zip 为内存快照，
   重枚举无意义；实现它是为了与 folder 通道统一调用点"（D13）。

**C. 入口启发式 `pickEntryKey(keys)`（`shared.ts`，folder 与 zip 共用）**

```
1) 精确 === 'src/assembly.fai.js'
2) 后缀 '/src/assembly.fai.js'（zip 带顶层包裹目录时命中）
3) 精确或后缀 'assembly.fai.js'
4) keys[0]
5) keys 为空 → null（调用方按"没有 .fai.js 文件"处理）
```
keys 已排序，`find` 返回字典序第一个 → 结果确定。
**folder 通道现有行为不变**：OPFS 根 = mini_lathe 根时 key 恰为 `src/assembly.fai.js`，命中第 1 条。

### 5.6 `main.ts` 接线 —— P2（zip，只允许这 5 处新增/改动）

| # | 位置 | 动作 |
|---|---|---|
| 2.1 | `index.html`（`banner-controls` 内，`#file-input` 之后） | 新增 `<button id="open-zip-btn" class="btn btn-secondary" title="Open a .zip project (multi-file relative imports)">Open Zip</button>` 与 `<input type="file" id="zip-input" accept=".zip" hidden />`。**既有元素一律不动** |
| 2.2 | `main.ts` L99-101 元素查询区 | 新增 `const openZipBtn = …getElementById('open-zip-btn')`、`const zipInput = …getElementById('zip-input')`（类型同 `fileInput`） |
| 2.3 | `main.ts` | 新增 `async function openProjectZip(file: File)`：读取 `await file.arrayBuffer()` → `createZipProjectLoader` → `listModules()` → 空则 `setStatus(\`压缩包 "${zipName}" 内没有 .fai.js 文件\`, 'error')` 并 `project = null` → 否则 `project = { rootName: zipName, loader, keys, entryKey }` → `populateProjectOptions(keys, entryKey)` → `selectProjectEntry(entryKey)`；整体 `catch` → `setStatus(\`打开压缩包失败: ${msg}\`, 'error')` 且 `project = null`。**结构与 `openProjectFolder()` 同构，照抄它的骨架** |
| 2.4 | `main.ts` | `openZipBtn.addEventListener('click', () => zipInput.click())`；`zipInput.addEventListener('change', …)`：取 `zipInput.files?.[0]`，先 `zipInput.value = ''`（允许重复选同一文件），再 `void openProjectZip(file)` |
| 2.5 | `main.ts` `openProjectFolder()` 内的入口计算 | 把 `keys.includes('src/assembly.fai.js') ? 'src/assembly.fai.js' : keys[0]` 换成 `pickEntryKey(keys) ?? ''`（空清单分支在此之前已 return，故 `?? ''` 不可达）；`openProjectZip` 用同一个函数 |

`rootName` 规则（zip）：文件名去掉尾部 `.zip`（不区分大小写），空则回落 `'project'`。

### 5.7 3d_editor（本次不写它的代码，只留对齐约定）

- 复用**契约与概念**：`ProjectLoader` 接口形状、moduleKey 约定、`entryKey`、错误码语义、
  以及"入口启发式"（它是应用侧策略，可直接抄 `pickEntryKey`）。
- **不复制** demo 的 picker 交互、示例下拉。
- 它自己会有：项目文件表（store）、session 缓存、IndexedDB 持久化、写回。
- 抽取共享包的触发条件（不到就不抽）：**出现第二个真实消费者且两边实现收敛为同一份**。

### 5.8 测试装配（D6，精确配置）

`packages/demo/package.json`：

- scripts 增加 `"test": "vitest run"`。
- **dependencies** 增加 `"fflate": "^0.8.3"`（D10）。**必须声明**：`scripts/check-ghost-deps.mjs`
  遍历 `workspaces` 下每包的 `src/**/*.ts`，新建 `packages/demo/src/` 后它会被扫到，
  未声明即判幽灵依赖失败。e2e 与单测都用同一个包，不必再加 dev 依赖。
- devDependencies 增加 `"vitest": "*"`（与其它 workspace 一致，复用根安装）。

`npm install` 后 `package-lock.json` 会有 diff（fflate 由传递依赖变为直接依赖），**必须一起提交**。

**必须新增 `packages/demo/vitest.config.ts`** —— demo 的 `tsconfig` include 是 `**/*.ts`，
默认 vitest include 会把 `e2e/demo.spec.ts`（Playwright 用例）也收进来并失败：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑 demo 自己的单测；e2e/demo.spec.ts 是 Playwright 用例，不归 vitest 管
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

CI：`scripts/ci.ps1` L78 的 `$testPackages` 数组**追加** `'@faicad/faijs-demo'`
（顺序无语义，追加到末尾即可）。`scripts/ci.sh` 走 `npm run test --workspaces --if-present`，
**自动生效，无需改**。stderr 零容忍照常适用。

### 5.9 demo typecheck（D7，基线已红，必须这样验）

`npx tsc -p packages/demo/tsconfig.json --noEmit` 在**改动前**就有 3 个既有错误
（2026-09-09 实测）：

```
packages/demo/main.ts(326,45): error TS2339: Property 'op' does not exist on type '{ index; callee; message; … }'
packages/demo/main.ts(342,3):  error TS2322: { solid: BrepHandle; kernel: BrepEngineApi } 不可赋值给 { solid: ShapeHandle; kernel: OcctKernel }
packages/demo/main.ts(479,40): error TS2345: ShapeHandle 不可赋值给 BrepHandle
```

因此：**不要给 demo 加 `typecheck` 脚本**（会把既有红带进 CI）。验收方式是——改动后重跑同一命令，
**错误集合不得增加**；允许这 3 条（行号可能漂移），新增任何一条即判失败。
修这 3 条是独立任务，不在本方案范围。

---

## 6. 验收标准（可判定）

### 6.1 单测 `folder-loader.test.ts`

用纯对象实现的内存假句柄（不依赖 DOM）构造目录树，覆盖：

1. 枚举：递归产出全部 `.fai.js` 的 POSIX key；跳过目录与非 `.fai.js`；排序稳定。
2. `readSource`：命中返回文本；不在清单的 key、目录 key → 抛错且信息带 key。
3. 越界：`../x.fai.js`、`a/../../x.fai.js` 归一后不在清单 → 拒绝读取。
4. `refresh()`：新写入的文件出现、删除的文件消失。
5. 同步性：`listModules()` 不返回 Promise（引擎同步调用它）。

### 6.2 单测 `zip-loader.test.ts`（P2）

用 `fflate.zipSync` 在内存里构造 zip（不落盘、不依赖 DOM），覆盖：

1. 基本：`{ 'src/assembly.fai.js', 'src/parts/a.fai.js', 'README.md' }` → 清单恰为两个 `.fai.js`，排序稳定。
2. 顶层包裹目录：`{ 'mini_lathe/src/assembly.fai.js', … }` → key **保留** `mini_lathe/` 前缀（B3 不剥离），
   且 `pickEntryKey` 仍返回 `mini_lathe/src/assembly.fai.js`（第 2 条后缀规则命中）。
3. 跳过：条目位于 `node_modules/` / `dist/` / `.git/` / 点目录 → 不进清单；目录条目（key 以 `/` 结尾）忽略。
4. 反斜杠路径（`src\\parts\\a.fai.js`）→ 归一为 `src/parts/a.fai.js`。
5. `readSource`：命中返回解码文本（含中文）；越界 key → 抛错且文案与 folder 通道**逐字相同**。
6. `refresh()` 是 no-op 且返回 Promise；调用后清单不变。
7. 损坏输入（非 zip 字节）→ 抛错且 `cause` 被保留。
8. `pickEntryKey` 单独测：精确命中 / 后缀命中 / `assembly.fai.js` 兜底 / `keys[0]` 兜底 / 空 → null。

### 6.3 e2e —— P1 判据（`packages/demo/e2e/demo.spec.ts` 零 diff）

现有 4 个 Open Folder 用例必须**原样通过**，这是"纯搬家"的判据：

1. mini_lathe 装配（brep 多文件相对 import）自动运行 + STEP 含 `ADVANCED_FACE`；mesh 显式不可用。
2. 纯 cad 多文件 fixture（`e2e/fixtures/mesh-project/`）brep + mesh 双链都 OK。
3. 空目录 → 状态栏"没有 .fai.js 文件"。
4. 切回内置示例 → 单文件路径（无 `Project:` 前缀）；再切回恢复项目模式。

### 6.4 e2e —— P2 新增 zip 用例（追加，不改既有）

在 `demo.spec.ts` 末尾追加（helper 追加在文件顶部 helper 区，既有 helper 不改动）：

```ts
/** 把 .fai.js 项目树打成 zip buffer（不落盘）。files: 相对根 POSIX key → 源码文本。 */
async function zipFaiProject(files: Record<string, string>): Promise<Buffer> {
  const entries: Record<string, Uint8Array> = {}
  for (const [key, text] of Object.entries(files)) entries[key] = new TextEncoder().encode(text)
  return Buffer.from(zipSync(entries))
}
```

| # | 用例 | 关键断言 |
|---|---|---|
| Z1 | **真实 mini_lathe**（`readFaiProjectTree(new URL('../../mini_lathe/', import.meta.url))` → `zipFaiProject` → `setInputFiles('#zip-input', { name: 'mini_lathe.zip', mimeType: 'application/zip', buffer })`） | `#example-select` 值 = `__proj:src/assembly.fai.js`；编辑器含 `import * as cq from '@faicad/cq-compat'`；状态栏匹配 `/Project: \S+ \(src\/assembly\.fai\.js\) — OK — brep: \d+ shape\(s\)/`；STEP 下载以 `ISO-10303-21` 开头且含 `ADVANCED_FACE` |
| Z2 | 顶层包裹目录（把 `e2e/fixtures/mesh-project/` 的 key 全部加 `wrapped/` 前缀再打包） | 入口选中 `__proj:wrapped/src/assembly.fai.js`（后缀启发式命中）；brep + mesh 双链都 OK；两个 canvas 截图 > 1000 字节 |
| Z3 | zip 内无 `.fai.js`（只放 `README.md`） | 状态栏含 `没有 .fai.js 文件`；`class` 含 `error`；不进入项目模式 |
| Z4 | 损坏 zip（`Buffer.from('not a zip')`） | 状态栏含 `打开压缩包失败:`；`class` 含 `error`；页面不崩（后续点击 Run 仍可用） |

`SELECTOR` 常量追加 `openZipBtn: '#open-zip-btn'`、`zipInput: '#zip-input'`。
**Z1 是本项目第一次在浏览器里全自动跑通真实 mini_lathe 多文件装配**（folder 通道做不到，
见 §6.5）——它的通过是本方案最核心的验收信号。

### 6.5 人工验收清单（folder 通道自动化覆盖不到的部分，必须做）

e2e 用 `addInitScript` 把 `showDirectoryPicker` stub 成 OPFS 根——句柄接口同构、数据流真实，
但**真实系统 picker 从未被自动化触达**（这正是 §1 里用户指出的"必须手动点击确认"）。
每次涉及该路径的改动都要人工验收：

- [ ] 主机 Chrome/Edge，`npm run dev`（:8899）→ 点 Open Folder → 选 `packages/mini_lathe/`
      → 默认选中 `src/assembly.fai.js` → 装配渲染 + STEP 可导出。
- [ ] 取消授权 → 状态栏给出可读错误，页面不崩。
- [ ] 打开 `packages/mini_lathe/src`（入口在所选根下的子目录）→ 相对 import 基准正确
      （key 为 `assembly.fai.js`，由 `pickEntryKey` 第 3 条命中）。
- [ ] Firefox/Safari：能力缺失 → 明确报错（不静默），单文件 Open File 与 **Open Zip 仍可用**。
- [ ] 手工点 Open Zip 选一个真实 zip（macOS/Windows 打的都试一次）→ 行为与 Z1/Z2 一致。

---

## 7. 执行步骤（按顺序，每步有判据）

| # | 步骤 | 命令 / 动作 | 通过判据 |
|---|---|---|---|
| 1 | 回退 core（§5.1 1.1-1.4） | 删 2 文件 + 删 2 处 export | `grep -rn "createDirectoryProjectLoader\|DirectoryProjectLoader\|FsDirectoryHandleLike" packages/core/src` → 0 处 |
| 2 | 重建 + 快照 | `npm run build` → 删 1.7 的 4 个陈旧产物 → `node scripts/api-surface-snapshot.mjs` | 快照 json 的 `./browser` 数组不再含 `createDirectoryProjectLoader` |
| 3 | demo 新文件（§5.2/5.3） | 新建 5 文件 + `folder-loader.test.ts` | 与旧实现逐行比对：key 生成、跳过集、越界文案、`{ cause }` 包裹 |
| 4 | main.ts 接线 P1（§5.4） | 只改 4 处 | 除这 4 处外 `main.ts` 无其它 diff |
| 5 | 单测装配（§5.8） | 加 test 脚本 + vitest/fflate 依赖 + `vitest.config.ts` + ci.ps1 包名 | `npm run test -w @faicad/faijs-demo` 全绿且无 stderr；`node scripts/check-ghost-deps.mjs` OK |
| 6 | 类型回归（§5.9） | `npx tsc -p packages/demo/tsconfig.json --noEmit` | 错误集合不增（允许既有 3 条，行号可漂移） |
| 7 | core 回归 | `npm run test -w @faicad/faijs-core` | 全绿 |
| 8 | **P1 闸门：e2e 零 diff** | `npx playwright test demo.spec.ts`（cwd `packages/demo`） | 既有 20 个用例全绿，且 `git diff --stat packages/demo/e2e/demo.spec.ts` 为空 |
| 9 | zip 实现（§5.5） | 新建 `zip-loader.ts` + `zip-loader.test.ts` | §6.2 的 8 组覆盖全绿 |
| 10 | zip 接线（§5.6） | `index.html` 2 元素 + `main.ts` 5 处 | 除这 5 处外 `main.ts` 无其它 diff；`index.html` 只有新增 2 行 |
| 11 | zip e2e（§6.4） | 追加 Z1–Z4 | 4 个新用例全绿；既有 20 个仍全绿（既有断言未改） |
| 12 | 类型回归再验 | 同步骤 6 | 错误集合仍不增 |
| 13 | 人工验收（§6.5） | 5 项 | 全部勾选 |
| 14 | 文档与 note（§5.1 1.9-1.10、§9） | 迁移 note + 新建 note | `npm run doc-sync` 12 项全过 |
| 15 | 全量 CI | `pwsh -NoProfile scripts/ci.ps1` | 全绿；**失败项只重跑失败的那一个，禁止靠跑 CI 找 bug** |

---

## 8. 风险（已 mitigation，非待确认）

| # | 风险 | 处置（已定） |
|---|---|---|
| R1 | core 的 dist 不被 root `clean` 清掉，陈旧产物残留 | §5.1 1.7 明确删除 4 个文件 |
| R2 | 快照 json 未同步 → CI 步骤 5 出现未提交改动 | 步骤 2 已包含，且必须提交该 diff |
| R3 | vitest 默认把 Playwright 的 `e2e/demo.spec.ts` 收进来 | §5.8 的 `vitest.config.ts` 限定 `include: ['src/**/*.test.ts']` |
| R4 | demo typecheck 基线红，误判为新引入 | §5.9 已列出 3 条既有错误的原文，判据是"不增" |
| R5 | 搬家时"顺手改进"导致行为漂移 | §5.4 行为不变清单 + 步骤 8 的 e2e 零 diff 双保险 |
| R6 | 真实 picker 无自动化覆盖 | §6.5 人工验收清单，列为 DoD 必做项；zip 通道（Z1）提供可自动化的替代验证 |
| R7 | OPFS stub 与真实 FSA 句柄的异常类型差异 | `pick.ts` 只取 `err.message`，不假设异常类型 |
| R8 | 新建 `packages/demo/src/` 后幽灵依赖守卫开始扫 demo | §5.8：fflate 必须写进 demo 的 **dependencies** |
| R9 | `unzipSync` 同步解压大 zip 卡主线程 | §5.5-A4 的 64MB / 5000 条目上限 + 错误提示；demo 场景（源码包）远小于该量级 |
| R10 | zip 顶层包裹目录导致入口选不中 | D11 不剥离 + `pickEntryKey` 后缀匹配（§5.5-C），Z2 专门覆盖 |
| R11 | zip 内文件名非 UTF-8 / 含 BOM | `TextDecoder('utf-8')` 默认剥离 BOM；非 UTF-8 文件名不会是 `.fai.js` 源码，不处理 |

---

## 9. Definition of Done

- [ ] `packages/core/src/**` 中不再出现 `createDirectoryProjectLoader` / `DirectoryProjectLoader` / `FsDirectoryHandleLike`。
- [ ] `scripts/api-surface-snapshot.json` 已重生成并提交。
- [ ] `packages/demo/src/project/{types,shared,pick,folder-loader,zip-loader}.ts` +
      两个 `*.test.ts` 就位；`folder-loader.ts` 行为逐字等价旧实现。
- [ ] `packages/demo/main.ts` P1 仅 4 处改动、**P1 阶段 `e2e/demo.spec.ts` 零 diff**；
      P2 zip 接线仅 §5.6 的 5 处 + `index.html` 新增 2 行。
- [ ] `packages/demo/package.json` 声明 `fflate ^0.8.3` 与 `vitest *`；`package-lock.json` 已提交。
- [ ] `npm run test -w @faicad/faijs-demo` 全绿、无 stderr；`npm run test -w @faicad/faijs-core` 全绿；
      `node scripts/check-ghost-deps.mjs` OK。
- [ ] `npx tsc -p packages/demo/tsconfig.json --noEmit` 错误集合不增。
- [ ] demo e2e 全部用例全绿：既有 20 个 + 新增 Z1–Z4；§6.5 人工验收 5 项全部勾选。
- [ ] 旧 Agent Note 已迁至 `rejected/architecture/2026-09-09-browser-project-loader-in-core.*` 并改 Status；
      新 Agent Note `.agents/notes/implemented/feature/2026-09-09-demo-local-folder-project.{md,zh.md,i18n.yaml}`
      已建（Decision 中单列三条：`autoLiftFor` 保留见 D3；两通道同属 demo 应用层见 D1；
      zip 用 fflate 且不落二进制 fixture 见 D10/D12），i18n 哈希已重录。
- [ ] `npm run doc-sync` 12 项全过；`pwsh -NoProfile scripts/ci.ps1` 全绿。
- [ ] 本文档状态改为「已落地」。

---

## 10. 参考（本仓代码，实测于 2026-09-09）

- 契约：`packages/core/src/cad-runtime/ports.ts`（`ProjectLoader` L204-223、`LibLoader` L185-210）
- 引擎装载：`packages/core/src/cad-runtime/module-registry.ts`；`entryKey`：`cad-runtime/runtime.ts`
- node 侧对照（**不动**）：`packages/core/src/node-host/fs-project-loader.ts`、`node-host/cli.ts`
- 待回退：`packages/core/src/browser-host/directory-project-loader.ts(+test)`、`browser-host/index.ts`、`browser.ts`
- 消费方：`packages/demo/main.ts`（L16 / L44-58 / L99-101 / L351-419 / L498-583 / L629-644）、
  `packages/demo/e2e/demo.spec.ts`（L46-77 helpers、L410-503 用例）
- UI：`packages/demo/index.html` L26-33（`banner-controls`：`#example-select` / `#open-btn` / `#open-dir-btn` / `#file-input`）
- e2e 配置：`packages/demo/playwright.config.ts`（timeout 120s、workers 1、retries 1、testMatch `**/demo.spec.ts`）
- CI：`scripts/ci.ps1` L78 `$testPackages`、L133 快照；`scripts/ci.sh` L33 `--workspaces --if-present`
- 依赖守卫：`scripts/check-ghost-deps.mjs`（遍历 `workspaces/*/src/**/*.ts`，`@faicad/*` 放行）
- 外部参考：BREP.io `src/services/mountedStorage.ts`、`componentLibrary.ts`
  （仅借鉴"目录句柄获取 + 递归枚举 + 按路径读取"三块；IndexedDB 与多挂载管理不在范围内）
