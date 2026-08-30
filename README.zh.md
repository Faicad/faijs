# @faicad/faijs

[English](README.md) | 中文

Faicad CAD 执行引擎——`faijs` 语言 parser、BREP/mesh 双链路几何运算与 `CadRuntime` 编排器。

- **L0 文本层**（`src/lang/`）：`faijs` 是合法的 JavaScript 子集，**无控制流**（`if`/`for`/`while`/`do`/`switch`/`try`、动态 `import()`）。脚本经 acorn 解析、编译为零 import 的 ESM 模块，由 JS VM 执行（不使用 `eval`/`new Function`）。
- **L1 几何层**（`src/brep/` + `src/mesh/`）：每个 op 有 BREP（OCCT）路径和 mesh（manifold-3d）路径；`src/ops/dispatcher.ts` 按静态规则分派。
- **L2 编排**（`src/cad-runtime/`）：`CadRuntime` + `HostPorts`。
- **L3 宿主**（`src/node-host/` / `src/browser-host/`）。

单位：毫米，+Z 向上，角度用度。契约文档：`docs/api-contract.md`、`docs/syntax-design.md`。

## Entry points

| Import | Contents |
|---|---|
| `@faicad/faijs` | 全量 API（L0–L3，含 Node host） |
| `@faicad/faijs/browser` | 浏览器安全子集（无 `node:*`） |
| `@faicad/faijs/node` | Node host 入口 |
| `@faicad/faijs/stdlib` | 内置库命名空间 |
| `@faicad/faijs/sdk` | **第三方库开发面**（零重依赖） |

## Developing a third-party library (`@faicad/faijs/sdk`)

`.faijs` 脚本可以 `import * as mech from 'mech-lib'` 并调用 `mech.makeHeadstock(...)`；宿主加载你的模块（`import(url)`）并在任何 check/execute 之前通过 `CadRuntime.registerLib(binding, module)` 注册。

你的模块是一个导出函数的普通 ESM 文件——通过 SDK 入口编写：

```ts ignore-check
// mech-lib.mjs
import { solid, fromBrep, keep, getBackends, CONTRACT_VERSION } from '@faicad/faijs/sdk'

// Optional but recommended: pin the runtime contract version (registerLib validates it).
export const contractVersion = CONTRACT_VERSION

// Library functions follow the faijs source signature: (inputShapes…, params) — no hidden args.
export function makeHeadstock({ teeth = 8 } = {}) {
  // Shapes you produce MUST be created through the constructors so the engine
  // recognizes them (identity table) and can union/drill/extrude them downstream.
  const mesh = buildHeadstockMesh(teeth)
  return solid(mesh)
}

export function cutGear(input, { module: m, teeth }) {
  const { csg } = getBackends() // kernel / csg / sdf / fonts / assets are injectable resources
  const result = cutTeeth(input, m, teeth)
  // BREP chain: register the OCCT handle so hasBrep()/brepOf()/STEP export work.
  return fromBrep(result.mesh, { solid: result.solid, faceEvolution: result.faceEvolution })
}
```

Contract points:

- **Signature form**: `(input, params)` — matches the faijs source form; the engine calls `ns.<callee>(inputs..., args)` with the args object merged, exactly like the built-in `cad.*` ops. No hidden `exec` parameter.
- **Shape identity**: every returned shape must come from `solid(mesh)` / `fromBrep(mesh, holder)` / `compound(children)`; otherwise the engine treats it as an opaque value and downstream geometry ops (union, drill, …) reject it.
- **`keep(...shapes)` / `keepHidden(...shapes)`**: call inside your function body to declare which input shapes stay visible / hidden after your op (replaces the old per-op `keep` type annotations).
- **`contractVersion`**: export it (matching `CONTRACT_VERSION`) so `registerLib` can reject incompatible versions loudly instead of silently misbehaving.
- **Brevity on BREP**: `hasBrep(shape)` / `brepOf(shape)` let you check whether an input is on the BREP chain; mesh-only fallbacks must be decided statically per the dispatch rules, not by try/catch at runtime.

Loading is the host's job (URL → `import(url)` → `registerLib`); the SDK never loads modules itself and ships with **zero heavy runtime dependencies** (no `three`, `occt-wasm`, `manifold`, `node:*`) — enforced by a dist guard test.
