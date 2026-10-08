# Agent Note: 脚本面导出命令只在 node 宿主开放

Status: implemented

[English](2026-10-08-export-commands-node-host-only.md) | 中文

## Problem

`.fai.js` 脚本是 AI 可以生成出来的文本，因此属于不受信输入。`packages/core/src/lang/security-scanner.ts` 的静态扫描是防御它的第一层，而它自己就写明了边界：静态扫描不是沙箱，而且它的档位——`strict`、`balanced`、`off`——是运行期选项，`off` 会让扫描整体早退。

在脚本能够触碰的能力里，导出处在损害尺度的最远端。它把几何从内核交到脚本文本手里，在宿主侧最终落到一次用户可见的写入：下载、保存、剪贴板传输。两个导出命令此前在三种宿主上都可达——Node CLI、browser worker、小程序 worker。`cad.exportStl` 甚至被文档写成「中立 op」：它只读 Shape 自带的三角载荷，根本不读任何环境事实。于是「写什么、写到哪、写几份」的决定权就归了脚本文本，而且恰好落在最敏感的那个环境里——页面内脚本发起下载，正是 CSP、用户手势要求与 drive-by download 防护所要约束的模式。

## Decision

**脚本面导出命令只在 `node` 宿主开放。** 其余宿主上一律在读取载荷之前失败，报 `E_HOST_UNSUPPORTED`。

- 宿主在端口装配期声明一次环境：`HostPorts.hostEnv`，类型为 `'node' | 'browser' | 'weapp'`，定义在 `packages/core/src/cad-runtime/ports.ts`。`createNodePorts()` 声明 `'node'`，`createBrowserPorts()` 声明 `'browser'`。字段保持可选，读取端 fail-closed：未声明即非 node，一律拒绝而不是默认放行。
- `CadRuntime.claimBackends()` 把它发布成 `config.hostEnv`，与 `mode`、`brepEngineId` 同位。`Backends.config.hostEnv` 声明在零依赖层 `packages/core/src/runtime-state.ts`，并由 runtime 的 getter 把两处声明在编译期钉在一起。
- 断言器 `assertHostFor(opName, hosts)` 落在 `packages/core/src/api/internal/l3-bridge.ts`，与 `assertEngineFor` 并列，抛 `HostUnsupportedError`——定义在 `runtime-state.ts`，带 `code = 'E_HOST_UNSUPPORTED'`，宿主可从 `ExecutionResult.failedAt.code` 读到错误种类。
- 两个导出 op 都在函数体第一行调用它：`exportStl` 在读三角载荷之前，`exportBrep` 在它既有的引擎断言之前，于是门序固定为宿主门在前、引擎门在后。门写在函数体而不是分派元数据里，是因为这两个 op 是普通函数、不走 `dispatchPath`；这个位置同时覆盖从子路径 import 同一函数的 TypeScript 使用者，没有旁路。
- 门只读 `config.hostEnv`，不读别的。它与安全档位解耦：把扫描放宽到 `balanced` 或 `off` 不会重新打开这个命令。
- 这不是禁止在浏览器里导出，而是一条关于「由谁发起导出」的规则。宿主自己的字节通道——`exportModel`、`exportModelSync`、`exportStepFromSolids`、`buildStlBufferFromMesh`——不受影响，在所有宿主上仍可调用；那正是应用在用户按下导出按钮时走的路。

## Alternatives considered

**依赖静态安全扫描。** 否决：扫描器自称只是第一层，档位可以被关掉，而且它检查的是文本、并不授予能力。把能力藏在可以被关掉的扫描后面，没有任何保证。

**在门里做运行期环境探测。** 否决：`typeof process` 这类探测属于内核装载器，用途是选择 wasm 装载通道。一个靠环境里的全局对象去猜宿主的能力门，既不是静态的，也无法审计；而宿主在装配端口时本来就知道自己是谁。

**把 `hostEnv` 设为 `HostPorts` 的必填字段。** 否决：`HostPorts` 是公开类型，仓内约百处装配点，多数只给 `events`。设必填会强推与本次能力无关的机械改动。可选 + fail-closed 拒绝，在真正相关的调用点上效果等价。

**保持命令开放，只发警告。** 否决：警告不是门禁。这条决策是拒绝这个能力，而警告会把写入仍然留在脚本控制之下。

## Consequences

- Node 宿主照旧可以导出；经 CLI 或 `executeScript` 跑的脚本行为不变。姊妹仓 `3d_editor` 的 `createProcessPorts` 以 `...base` 展开 Node 端口，因此其 Electron 主进程继承 `'node'`。
- browser 与小程序宿主拒绝这两个命令。要在那里导出的应用，从自己的入口调用宿主字节通道——就是门禁没有覆盖的那几个函数。
- 任何手工装配 `HostPorts` 却漏了 `hostEnv` 的宿主会失去导出命令。`3d_editor` 的小程序端口装配是唯一这样的点，必须显式声明 `'weapp'`。
- 门禁钉在 `packages/core/test/api/export-stl-brep.test.ts`：browser、小程序与未声明宿主上的拒绝；证明门先于实现体的载荷 getter 陷阱；宿主门先于引擎门的顺序；以及与安全档位的解耦。`packages/core/test/node-host/ports.test.ts` 与 `packages/core/test/browser-host/index.test.ts` 钉住两个工厂的声明值，因此经工厂装配的宿主不会因为漏写而丢失该值。
