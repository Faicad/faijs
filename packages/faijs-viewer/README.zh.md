# @faicad/faijs-viewer

[English](README.md) | 中文

任何第三方宿主打开并渲染 `.fai.zip` 三维文档的参考方式。viewer 读取容器，通过 `@faicad/faijs` 执行 active（或指定的）model，返回与宿主无关的三角化 mesh 数据——返回值不依赖 THREE、DOM 或任何 GL 库。

本包**不**依赖 `sheetmetal` 或 `cq-compat`。预置库——`@faicad/faijs`、`@faicad/faijs-sketch` 和 `@faicad/faijs-extra`——是家族 peer 包，由宿主提供；第三方 faijs 库（如 `@faicad/faijs-gears`）在执行期按需装载（见 [动态库加载](#dynamic-library-loading)）。它就是"第三方只需要一个 **viewer** 包就能查看 `.fai.zip`"的参考 SDK。

## v1 API

```ts ignore-check
import { openFaiZip } from '@faicad/faijs-viewer'

const result = await openFaiZip(bytes, {
  wasm: {
    occtUrl: 'https://your-cdn/occt-wasm.wasm',          // BREP-chain engine
    manifoldUrl: 'https://your-cdn/manifold.wasm',        // mesh / CSG engine
    brepkitUrl: 'https://your-cdn/brepkit_wasm_bg.wasm',  // secondary BREP engine
  },
  // modelId?: string                      // pick a model; default is manifest.active, else models[0]
  // mode?: 'auto' | 'brep' | 'mesh'       // default 'auto' (static BREP/mesh dispatch)
  // sketch?: { planegcsUrl: '...' }       // browser-only: constraint-solver wasm URL (see below)
  // libs?: { allow: ['@faicad/faijs-gears'], versions: { '@faicad/faijs-gears': '0.29.2' } }
  //                                       // dynamic third-party libraries (see below)
})

// result.meshes — structured mesh data; the host does the actual rendering.
for (const mesh of result.meshes) {
  // mesh.name       display label
  // mesh.positions  Float32Array, interleaved x/y/z triangle vertices
  // mesh.indices    Uint32Array, groups of 3 triangle indices
}
```

三种结果：

| 情形 | 形式 |
|---|---|
| `wasm` 缺失或三个 url 任一为空 | **抛异常**（`E_WASM_URL`；调用方契约违规，绝不作为 `error` 返回） |
| 字节无效 / 执行失败 / 无可见几何 | 返回 `result.error`，`code ∈ { E_CONTAINER, E_EXECUTION, E_NO_GEOMETRY }` |
| 成功 | 返回结构化 `meshes` |

真实 FreeCAD 转换产物会调用 `cad.sketch` 和编辑器扩展 op（`cad.fai_*`、`cad.group`、`cad.text`、…）；viewer 把 sketch + faijs-extra 命名空间合入默认 `cad` binding，并由约束求解器支撑 sketch（见下）。`@faicad/faijs-draw` 已弃用且刻意不合并——`cad.draw` 调用按未知 callee 失败。

## `cad.sketch` 与约束求解器

`cad.sketch`（来自 `@faicad/faijs-sketch`）需要单独的 **planegcs** 约束求解器 wasm。获取方式因运行环境而异：

- **Node / worker** — 求解器自动从已安装的 `@salusoft89/planegcs` 包加载；不需要 `sketch` 选项。
- **浏览器** — 自托管 `planegcs.wasm` 并传入 URL：`openFaiZip(bytes, { wasm, sketch: { planegcsUrl: 'https://your-cdn/planegcs.wasm' } })`。不给 URL 则不安装求解器；`cad.sketch` op 以 `E_SKETCHC_NO_SOLVER` 失败，经 `result.error` 上报。

注意：转换产物的 sketch 输入必须符合 sketch op 的契约（`shapes` 或 `geoms`）。产出 `cad.sketch({ contours: [...] })` 的转换器当前不被接受，会以 `E_SKETCHC_NO_GEOMS` 失败——该问题在 faijs 家族跟踪，不属本 viewer 包。

## <a id="dynamic-library-loading"></a>动态库加载

`.fai.zip` 的 model 可能 `import` 任意第三方 faijs 库——这个集合无法预先知道。引擎本来就在执行期按需装载命名空间 import（`autoLoadLibsFromImports` → `HostPorts.libLoader`），本 viewer 替你构建这个 loader：

- **浏览器宿主** — 从 jsDelivr CDN 动态 `import()`（给了 `libs.versions` 则走版本 pin 的 `+esm` 直链）；
- **Node 宿主** — 从已安装包 `import(pkg)`，默认限 `@faicad/` scoped 库，除非给了 `libs.allow`。

通过 `OpenFaiZipOptions.libs` 配置：

```ts ignore-check
const result = await openFaiZip(bytes, {
  wasm,
  libs: {
    allow: ['@faicad/faijs-gears'],                        // whitelist (a .fai.zip is untrusted input — production hosts should set this)
    versions: { '@faicad/faijs-gears': '0.29.2' },          // pin to the host engine's version line
    // aliases?: { gears: '@faicad/faijs-gears' },          // script specifier → npm package name
    // cdnBase?: 'https://cdn.jsdelivr.net/npm/',            // browser CDN base
    // enabled?: true,                                      // false disables dynamic loading entirely
  },
})
```

预置库（core、sketch、faijs-extra——合入 `cad`）从不经过 loader。装载或版本校验失败统一结构化返回 `E_EXECUTION` 到 `result.error`，绝不抛穿。`contractVersion` 与宿主引擎不匹配的库会被显式拒绝——请把 `libs.versions` pin 到与宿主运行的 `@faicad/faijs` 相同版本线。

## 三个 wasm url 全部必填，且必须自托管

`.fai.zip` **不内嵌 mesh** —— model 在运行时执行，这需要引擎 wasm。v1 不打包它们；由宿主提供并自托管：

- **occt-wasm** — BREP 链引擎（默认必选）。
- **manifold** — mesh/CSG 引擎（也用于 BREP 输出的三角化）。
- **brepkit** — 次级 BREP 引擎（v1 接受并校验；预留）。

自托管这三个文件（不要依赖上游 CDN 的可用性），并把 url 传给 `openFaiZip`：

1. 把 `occt-wasm` npm 包里的 `dist/occt-wasm.wasm` 拷进你的静态目录。
2. 把 `manifold-3d` 包根的 `manifold.wasm` 拷进你的静态目录。
3. 把 `brepkit-wasm` 的 `lib/brepkit_wasm_bg.wasm` 拷进你的静态目录。

具体浏览器绑定的示例见 `packages/demo/main.ts#initOcct`——它把 `OcctKernel.init({ wasm: occtUrl })` 注册到 core 的 `setOcctWasmInitFn`；浏览器环境下本 viewer 包会替你把三个 url 装进 core 的 `setOcctWasmInitFn` / `setManifoldWasmUrl` 钩子。

## Node / 测试

在 Node/worker 环境里，三个 url 仍会被校验（v1 契约），但引擎回退到 core 本地打包的 occt/manifold 自动加载——不发起网络请求。所以无公网的宿主也能在测试进程中完整运行 `openFaiZip`。

## 依赖

- 预置 peer `@faicad/faijs`、`@faicad/faijs-sketch`、`@faicad/faijs-extra` —— 合入默认 `cad` binding（三个家族包都由宿主提供）。
- peer `three` —— 由 faijs-extra 的 B 组 op（`cad.text` / `cad.svgExtrude` mesh 路径）携带；返回值不触碰它。
- peer `occt-wasm` —— 仅浏览器路径（`bindBrowserWasm`）懒加载；Node 测试从不加载。
