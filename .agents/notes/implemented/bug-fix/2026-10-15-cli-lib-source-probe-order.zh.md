# Agent Note：CLI 库源码探测顺序——先 ship、后 src，使严格确定性门禁可满足

English | [中文](2026-10-15-cli-lib-source-probe-order.md)

Status: implemented

## Problem

Node 宿主的 `cliPortsLibLoader.loadSource` 在 `src/index.ts` **之前**探测 `dist/index.js`。运行时确定性门禁把它返回的内容交给 `scanDeterminism(..., { strict: true })`，后者的契约是「库必须发布编译后的 JS」：TS 语法是硬错误，不是剥离的对象。所以对任何包目录含 TS 源码的库，宿主交给扫描器的恰恰是扫描器必须拒绝的文件。

包目录在两种正常开发布局下**都是**仓库根——workspace 链接成员和 `file:` 自链接。2026-10-15 在独立 `faijs-cadquery` 仓库观测到该问题，其文档化开发设置正是 `file:.` 自链接：其 `parity-smoke` D 阶段套件（通过 host CLI 执行的套件）的全部 33 个用例在执行任何东西之前就失败了，报错：

```
SyntaxError: [determinism] library source is not valid plain JavaScript at line 160:7
   (type stripping is not supported; libraries must ship compiled JS): Unexpected token (160:7)
```

门禁在 `cliRun` 内部抛错，所以没有镜像脚本能通过 host CLI 运行——对一个构建产物正确的库来说，这是红色发布门禁。

## Decision

先探测 ship：`dist/index.js` → `src/index.js` → `src/index.ts`。扫描器收到的是实际运行的产物。严格抛错保留为终端情况，所以只有 TS 的库（无 `dist`、无 JS）仍会像以前一样触发契约——门禁的牙齿不变。

## Alternatives considered

- **在宿主扫描前剥离 TS（sucrase）**：拒绝——严格契约正是为了禁止剥离。审计脚本 `packages/core/scripts/determinism-cli.ts` 剥离是因为它编目仓库树；它不定义运行时契约。一条规则两套策略比它们隐藏的 bug 更糟。
- **保持 src 优先、src 不是纯 JS 时回退到 dist**：拒绝——对每个 TS 库净效果相同，但它编码了「读 TS、发现是 TS、读别的」——在唯一一个声明价值是「无静默回退」的门禁内部做静默回退。
- **改消费方的开发布局（只暴露 `dist` 的自链接）**：拒绝——`package.json` 旁边有 `src/` 是独立 faijs 库和每个 workspace 成员的正常布局。需要重构每个消费仓库的修复方案会让宿主侧的陷阱对下一个仓库仍然待命。

## Consequences

- workspace 链接或自链接的库通过其构建产物扫描，所以扫描覆盖的是发布的内容。过期的 `dist` 被扫描为过期——构建步骤已经是 CLI 和测试套件的前置条件。
- 仍手动接 `cad` 的同包调用点已移除：`scripts/faijs-cli.ts` 不再传 `{ cad: createApiNamespace() }`（该参数现在抛 `E_CAD_RESERVED`），`execute-script.ts` 不再在 `createRuntime` 后重新注册 `cad`——`createRuntime` 中的保留名守卫已使该分支不可达。
- `packages/core/test/node-host/cli-lib-source.test.ts` 钉住两侧：dist 源码必须通过严格扫描，同包的 `src/index.ts` 必须仍然抛错。

## Verification

- `npx vitest run --root packages/core test/node-host/cli-lib-source.test.ts`——2/2 绿（dist 通过严格扫描；`src/index.ts` 仍抛错）。
- 消费方，`faijs-cadquery` 对携带此变更的 `@faicad/faijs` 构建：`parity-smoke` + `shape-filter` + `kernel.probe` 49/49 绿，而之前同样三个文件 32 个用例红。
