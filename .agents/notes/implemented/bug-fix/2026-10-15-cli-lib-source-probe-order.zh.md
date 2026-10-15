# Agent Note: CLI 库源码探测顺序——产物优先，让 strict 确定性门禁可满足

Status: implemented

[English](2026-10-15-cli-lib-source-probe-order.md) | 中文

## 问题

node host 的 `cliPortsLibLoader.loadSource` 把 `src/index.ts` 排在
`dist/index.js` **之前**。运行时确定性门禁把它返回的内容直接交给
`scanDeterminism(..., { strict: true })`，而该契约就是「库必须产出编译后的纯
JS」——TS 语法是硬错误，不是可以剥离的东西。于是只要一个库的包目录里有它的 TS
源码，host 交给扫描器的就是一个按契约必须被拒绝的文件。

而这两种正常 dev 布局下，包目录**就是**仓库根：workspace 链进来的成员，以及
`file:` 自链。2026-10-15 在 standalone 的 `faijs-cadquery` 仓库实测到——它的
dev 自链正是 `file:.`：`parity-smoke` 阶段 D 套件（走宿主 CLI 子进程的那个）33
条全部在真正执行前就失败：

```
SyntaxError: [determinism] library source is not valid plain JavaScript at line 160:7
   (type stripping is not supported; libraries must ship compiled JS): Unexpected token (160:7)
```

门禁在 `cliRun` 内部抛出，因此任何 mirror 脚本都无法经宿主 CLI 跑通——对一个
构建产物本身完全正确的库来说，这是一道恒红的发布门。

## 决定

产物优先探测：`dist/index.js` → `src/index.js` → `src/index.ts`。扫描器拿到的是
真正会被执行的那份产物。strict 抛错保留为兜底分支，因此「只有 TS 源码（既无
dist 也无 JS）的库」仍会照旧违反契约——门禁不放松。

## 备选方案

- **host 扫描前用 sucrase 剥离 TS。** 否决：strict 契约的存在就是为了禁止剥离。
  审计脚本 `packages/core/scripts/determinism-cli.ts` 剥离是因为它在盘点仓库
  目录树，而不是在定义运行时契约。同一个规则两套策略，比它掩盖的 bug 更糟。
- **保持 src 优先，仅在 src 非纯 JS 时回退 dist。** 否决：对所有 TS 库净效果相同，
  但它把「读 TS → 发现是 TS → 再读别的」写进了唯一一个以「没有静默回退」为价值
  的门禁里。
- **改消费方的 dev 布局（自链只暴露 `dist`）。** 否决：`package.json` 旁边放着
  `src/` 是 standalone faijs 库与每个 workspace 成员的正常布局。要求逐个改造消费
  仓库的修法，会把 host 侧的陷阱留给下一个库。

## 后果

- workspace 链或自链的库改为经构建产物被扫描，即扫描对象等于发布对象。dist 陈旧
  就按陈旧扫——构建本就是 CLI 与测试套件的前置条件。
- 同包内仍在手工装配 `cad` 的调用点被删除：`scripts/faijs-cli.ts` 不再传
  `{ cad: createApiNamespace() }`（该实参现在会抛 `E_CAD_RESERVED`），
  `execute-script.ts` 不再在 `createRuntime` 之后重复注册 `cad`——`createRuntime`
  的保留名守卫已使该分支不可达。
- `packages/core/test/node-host/cli-lib-source.test.ts` 两侧并钉：dist 源码必须
  通过 strict 扫描，而同包的 `src/index.ts` 必须仍然抛错。

## 验证

- `npx vitest run --root packages/core test/node-host/cli-lib-source.test.ts`——
  2/2 绿（dist 通过 strict 扫描；`src/index.ts` 仍抛错）。
- 消费方一侧，`faijs-cadquery` 对该改动所在的 `@faicad/faijs` 构建：`parity-smoke`
  + `shape-filter` + `kernel.probe` 49/49 绿，而此前这三个文件有 32 条红。
