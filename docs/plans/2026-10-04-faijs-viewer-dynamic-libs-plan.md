# Plan: faijs-viewer 预置库与动态加载（preset core+sketch+faijs-extra, dynamic libs via LibLoader）

Date: 2026-10-04 · Status: 方案（未实施）

## 用户要求（原话）

> 能否把动态加载faijs库的能力封装在faijs-viewer里？而且 core、sketch、faijs-extra是预置的。
> 不需要这个参数。所谓小程序没有的能力，只是目前还没有实现。此外，draw包你标记为deprecated。实际代码中根本没有用到。
> faijs-viewer 的预置面不需要draw
> 先写 plan → 实现 → 测试 → CI

## 背景与目标

`@faicad/faijs-viewer` 的 v1 API `openFaiZip(bytes, { wasm })` 是通用 `.fai.zip` 查看器的参考实现（3d_viewer_electron 消费 npm 发布版）。v1 现状：

- 预置面把 `sketch` + `draw` 合并进默认 `cad` 命名空间（`mergeDrawNamespace(mergeSketchNamespace(createApiNamespace()))` + `registerSketchSymbols/registerDrawSymbols`）；
- **没有接入 `libLoader`**——`createBrowserPorts({ assets, projectLoader })` 不传 `libLoader`。脚本 `import * as gears from "@faicad/faijs-gears"` 这类裸包导入，执行时绑定未注册 → 未知命名空间报错。

目标：把动态加载 faijs 库的能力封装进 faijs-viewer，预置面改为 **core + sketch + faijs-extra 三合一**（draw 移除），动态库按需装载由 viewer 内建 LibLoader 承担，宿主零负担（除可选 `libs` 配置）。

## 现状证据（源码核实）

- 引擎已支持执行期按需装载：`runtime.execute/append` → `autoLoadLibsFromImports(meta.imports)`——对每个未注册的 namespace import 调 `ports.libLoader.loadLib(packageName)` 后 `registerLib(localName, ns, {autoLift, packageName})`；加载失败/版本不匹配 → `failedAt` 定位 import 行。无需提前下载注册全部包。
- `createBrowserLibLoader` 已从 `@faicad/faijs/browser` 导出（`core/src/browser.ts:57`）：CDN 动态 `import()`（jsDelivr `+esm` 直链 pin 或 importmap 裸 specifier），支持 `cdnBase/versions/aliases/libs/meta/autoLift/forceImportMap/importModule/fetchImpl`，返回含 `prefetchMeta()`。
- node 侧参照 `cliPortsLibLoader`（`core/src/node-host/cli.ts:84`）：仅 `@faicad/` scoped 库、短名归一表、`loadSource` 读 `src/index.ts|dist/index.js`（determinism 扫描）、逐库 autoLift 读各库 package.json 的 `faijs.autoLift`。
- faijs-extra：`mergeEditorNamespace(platform)` 把 A 组（`fai_drill/fai_extrude/fai_split/group/assembly/copy/load`）+ B 组（`text/svgExtrude`）合到 cad；`registerEditorSymbols()` 扩展静态符号表。B 组 op 的 mesh 实现（`mesh/primitives.ts`）**静态 import three**（`SVGLoader`/`Shape`/`ExtrudeGeometry` 链），BREP 路径走 core（`brep/text/text-to-solid`、`brep/svg/svg-to-solid`）不涉 three。主入口还导出预览 helpers（`extras/*`，供 3d_editor 交互预览）。
- 内核单例兜底已就位：occt 内核与 runtime-state 挂 `globalThis`（2026-09-26 跨实例设计），CDN 副本库 `initOcctWasm()` 复用宿主内核，BREP 句柄互通。
- 版本契约：`registerLib` 先 `assertContractVersion(ns.contractVersion)`，不匹配即抛错（无静默降级）。

## 设计

### 1. `OpenFaiZipOptions.libs`（`types.ts`）

```ts
export interface FaiViewerLibsOptions {
  /** 动态加载总开关。缺省 true；false = 禁用一切非预置库（绑定未注册报错）。 */
  enabled?: boolean
  /** 浏览器 CDN base（须以 `/` 结尾）；缺省 jsDelivr npm 镜像。 */
  cdnBase?: string
  /** 版本 pin 表：packageName → version（浏览器 +esm 直链；建议 pin 到宿主引擎同版本线）。 */
  versions?: Record<string, string>
  /** 白名单（npm 包名）。缺省不限制；生产建议显式给（fai.zip 是不可信输入）。 */
  allow?: string[]
  /** 别名：脚本 specifier → npm 包名（如 'gears' → '@faicad/faijs-gears'）。 */
  aliases?: Record<string, string>
  /** 注入的动态 import 实现（测试 / 宿主自定义装载通道用）；缺省原生 import。 */
  importModule?: (url: string) => Promise<unknown>
}
```

### 2. 预置面：core + sketch + faijs-extra 三合一（`open-fai-zip.ts`）

- 移除 `mergeDrawNamespace/registerDrawSymbols`（draw 不再预置，`cad.draw` 调用报未知 callee）；
- `registerSketchSymbols(); registerEditorSymbols();`
- `runtime.registerLib('cad', mergeEditorNamespace(mergeSketchNamespace(createApiNamespace())), { default: true })`；
- faijs-extra 全量（A+B），**不设 editor 参数**——A/B 能力差只是"尚未实现"，不是需要 host 选参的架构边界；未来 B 组免 three 化后 viewer 可随之移除 three peer。

### 3. 动态面：viewer 内建 LibLoader（新模块 `libs.ts`）

`createViewerLibLoader(opts?: FaiViewerLibsOptions): LibLoader | undefined`，按 `inNodeEnv()` 分派（与 `ensureSketchSolver` 同模式）：

- `enabled === false` → `undefined`（引擎报"未注册绑定"）；
- 浏览器 → `createBrowserLibLoader({ cdnBase, versions, libs: allow, aliases, importModule })`（CDN 动态 import）；
- node → 内建 node loader（对齐 `cliPortsLibLoader` 语义，范围更小、不动 core）：
  - 白名单：`allow`（有则校验）∪ 默认仅 `@faicad/` scoped（安全，防同名陌生人包）；
  - 短名归一：`aliases` 表；
  - `loadLib: (name) => import(pkg)`（未安装 → `ERR_MODULE_NOT_FOUND`，由 runtime 报明确装载失败信息）；
  - `loadSource`：`createRequire` 解析包目录，读 `src/index.ts` 或 `dist/index.js`（determinism 扫描）；node:` 经 `/* @vite-ignore */` 动态 import（不污染浏览器 bundle，与 `NODE_SKETCH_SOLVER_SPECIFIER` 同模式）；
  - `options.autoLift` 缺省 false + `autoLiftFor` 读各库 package.json `faijs.autoLift`（逐库覆盖）。

### 4. 依赖（`faijs-viewer/package.json`）

- peer：移除 `@faicad/faijs-draw`；新增 `@faicad/faijs-extra`（`^0.29.0`）、`three`（`^0.162.0 || ^0.184.0`，与 faijs-extra peer 一致——B 组 op mesh 实现静态连带 three；3d_viewer_electron 已具备，零额外成本）；
- devDeps：新增 `@faicad/faijs-extra`（file:../faijs-extra）、`three`（^0.184.0）、`@types/three`（^0.184.1，d.ts 类型解析）、`@faicad/faijs-gears`（file:../faijs-gears，node 端到端动态库测试用）。

### 5. faijs-draw 标记 deprecated（不删代码）

- `packages/draw/package.json` description 标注 deprecated；
- `packages/draw/src/index.ts` 头部 JSDoc 标注 deprecated 及替代方向（FreeCAD Draft 转换改走 `cad.profile`/`cad.sketch`，另行立项）。

## 边界与连带影响

1. **FreeCAD Draft 转换已迁移，无 `cad.draw` emitter**：faijs-freecad 的 Draft 管线（2026-09-29）已移除 `cad.draw` emission——contours 以 `ProfileLoop` 数据经 `cad.sketchOnPlane` 放置（`draw/src/index.ts`、`faijs-freecad/src/draft-chain-e2e.test.ts`、`codegen.ts:265` 证实）。draw 包本身早已全面 deprecated（package.json description + JSDoc 均标注，注明"no remaining emitter"）。**viewer 移除 draw 无实际模型连带**；draw 包剩余消费方仅 3d_editor 宿主装配（`sketch-host.ts`，本轮不动）。
2. **3d_editor 不受影响**：`packages/platform/src/execution/sketch-host.ts` 的 `mergeDrawNamespace` 是 3d_editor 自己的宿主装配，本轮不动；deprecated 只影响其后续演进。
3. **版本契约**：动态库 CDN 加载必须 pin 到与宿主引擎同版本线（`versions`），否则 `assertContractVersion` 抛错（错误信息经 `failedAt` 结构化返回）。
4. **安全**：fai.zip 不可信。`allow` 白名单 + `versions` pin 由宿主配置；node 侧默认限 `@faicad/` scoped。determinism 扫描（`loadSource`）仅覆盖 node 路径且仅 `@faicad/*`。
5. **three peer**：viewer 新增 `three` peer（B 组 op mesh 路径静态连带）；3d_viewer_electron 已具备。未来 B 组免 three 化后随之移除。
6. **3d_viewer_electron 接线依赖发版**：该仓库消费 npm 发布版 `@faicad/faijs-viewer`，新 API 需 viewer 发版后才可接线（`openFaiZip(bytes, { wasm, libs })`）。本 plan 不含 3d_viewer_electron 改动。

## 改动清单

| 文件 | 改动 |
|---|---|
| `packages/faijs-viewer/src/types.ts` | `OpenFaiZipOptions` 加 `libs?: FaiViewerLibsOptions` |
| `packages/faijs-viewer/src/libs.ts`（新） | `createViewerLibLoader` + node loader 实现 |
| `packages/faijs-viewer/src/open-fai-zip.ts` | 移除 draw；ports 加 `libLoader`；cad 注册改三合一 |
| `packages/faijs-viewer/package.json` | peer/devDeps 更新（见上） |
| `packages/faijs-viewer/README.md` + `README.zh.md` | 移除 draw 合并描述、补动态库加载文档（draw 包 deprecated 标注已存在，无需再改） |
| `packages/faijs-viewer/src/open-fai-zip.test.ts` | 测试扩展（见下） |
| `packages/faijs-viewer/src/libs.test.ts`（新） | node/browser 分派单元测试 |
| `.agents/notes/proposed/architecture/2026-10-04-faijs-viewer-preset-dynamic-libs.md`（+zh/.i18n） | Agent Note（双语） |

不做：core 导出 `createNodeLibLoader` 工厂（范围更小，viewer 自建）；faijs-extra 新增 `./ops` 子入口（B 组 mesh 实现本身连带 three，子入口免不了）；3d_viewer_electron 接线（依赖发版）。

## 测试计划（faijs-viewer，vitest node）

1. **预置 A 组**：容器 `let g = cad.group([cad.box(10,20,30), cad.box(5,5,5)])` → 出 mesh（证明 `mergeEditorNamespace` 生效，无 import 即可用）；
2. **预置 B 组符号**：容器 `let t = cad.text`（取引用不调用）→ `error.code === 'E_NO_GEOMETRY'`（证明 `cad.text` 可解析而非未知 callee）；
3. **cad.draw 回归断言**：容器 `cad.draw("dummy")` → E_EXECUTION（移除 draw 后未知 callee）；
4. **白名单拒绝**：`import * as gears from "@faicad/faijs-gears"` + `libs: { allow: [] }` → E_EXECUTION，错误信息含 whitelist；
5. **enabled: false**：同上容器 + `libs: { enabled: false }` → E_EXECUTION（绑定未注册）；
6. **动态库端到端（node loader 真加载）**：`import * as gears from "@faicad/faijs-gears"` + `gears.spurGear({module:2,teeth_number:12,width:8})`（demo 惯例）+ `libs: { allow: ['@faicad/faijs-gears'] }` → 出 mesh；
7. **libs.ts 单元**：node 分支（白名单/别名/loadSource）、browser 分支（`vi.stubGlobal('window', …)` + `importModule` 注入）。

## CI 计划

1. 先跑 faijs-viewer 测试；再跑受影响的包（viewer 依赖面变化：faijs-extra/three 新增；draw/core 未动代码，预期无回归；仍跑 `packages/draw` 与 `packages/faijs-extra` 测试确认）；
2. `npm run typecheck`（含 workspaces）、`npm run lint`、守卫（check-ghost-deps / check-workspaces-order / check-lockstep / madge）；
3. `pwsh -NoProfile scripts/ci.ps1`（严禁用 CI 找 bug，前两步全绿才跑）；
4. Agent Note 从 `proposed/` 提升到 `implemented/`（追加 Consequences）。
