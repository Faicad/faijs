# Agent Note: demo 本地文件夹项目加载 —— 目录加载器从 core 迁入 demo + 完整 zip 通道

Status: implemented

[English](2026-09-09-demo-local-folder-project.md) | 中文

## 问题

浏览器目录项目加载器（`createDirectoryProjectLoader` + 类型）此前被实现在 `packages/core` 里。放错包了：它的每个部分都是策略——项目根是哪、只认哪些文件、跳过什么目录、清单何时刷新。浏览器 host 的其它成员（`BrowserEventSink` / `BrowserFontProvider` / `FetchAssetResolver` / Worker 后端）都是**无策略的环境适配器**——给定环境只有一种写法。node 侧加载器是「core 实现、core 消费」（CLI）；浏览器版在 core 里消费者为零，唯一消费方在 `packages/demo/main.ts`。另外，多文件项目只能通过 File System Access 目录选择弹窗打开，必须有真实用户手势——CI 与自动化测试永远无法端到端跑真实的多文件项目。

## 决定

1. **目录加载器迁出 core，落在 `packages/demo/src/project/`（D1）。** `folder-loader.ts` 是旧实现逐字搬移（`createDirectoryProjectLoader` 更名 `createFolderProjectLoader`）；`shared.ts` 承载两通道共用的常量/纯函数（`FAI_SUFFIX`、`DEFAULT_SKIP_DIRS`、`escapeError`、`isSkippedDir`、`pickEntryKey`、`errMessage`）；`types.ts` 投影引擎契约、不深导入 core 内部路径；`pick.ts` 是全仓唯一接触 `window.*` 的模块。`createBrowserPorts({ projectLoader })` 透传保留（D2）：加载器像其它 HostPorts 字段一样注入。
2. **`autoLiftFor` 保持有效（D3）。** 它与多文件无关，修的是独立存在的「demo 与 CLI autoLift 默认不一致」缺口；回退它立刻会让 demo 装配坏掉（既有 e2e 依赖 demo 在全局不提升下运行装配）。单列此条，避免这个决定随被否决笔记的状态行一起丢失。
3. **folder 与 zip 两个通道作为应用层策略都在 demo 里。** 共用同一接口 `DemoProjectLoader = ProjectLoader & { refresh(): Promise<void> }`（D14），`ProjectState.loader` 在两通道之间可互换：同样的 moduleKey 约定、同样的越界报错文案（走 `escapeError`）、同样的入口启发式。
4. **zip 通道用 `fflate`（D10）。** `createZipProjectLoader(bytes, opts?)` 用 `unzipSync` 在内存快照上构造 loader。**不做顶层目录剥离**（D11/B3）：zip 相对路径就是 moduleKey，无例外；正确性由入口启发式兜住——`pickEntryKey` 采用后缀匹配，带包裹顶层目录也能选到装配。尺寸上限（64MiB / 5000 条目，R9）与 `TextDecoder('utf-8')` 解码（B2）。`refresh()` 为 no-op Promise（D13），让 `main.ts` Run 前的统一刷新对两通道一致。
5. **demo 获得单测**（D6）：新增 `test` 脚本、`vitest` dev 依赖、`vitest.config.ts` 限定 `src/**/*.test.ts`（Playwright 的 `e2e/demo.spec.ts` 不入 vitest），`fflate` 声明进 `dependencies`（R8：project/ 目录出现后幽灵依赖守卫才开始扫描 `packages/demo/src`）。demo 被追加进 CI 测试列表；lockfile diff 一并提交。
6. **zip 测试数据永不落盘（D12）。** e2e 用 `fflate.zipSync` 在内存里打包，不会陈旧、不产生二进制 diff。
7. **e2e 首次以「无 stub」驱动 zip 通道**——`setInputFiles` 把内存 buffer 经真实 `<input type=file>` 注入，第一次在浏览器里端到端跑通真实 `mini_lathe` 项目（Z1），外加包裹目录（Z2）、空包（Z3）、损坏包（Z4）。既有 20 条用例原样通过，P1 搬家期间 `demo.spec.ts` 零 diff。

验证：demo 单测 19/19（folder-loader 7 + zip-loader 12，含入口启发式）；core 89 个文件、1301 通过 / 10 跳过；demo e2e 24/24；demo typecheck 错误集合大小不变（仍是那 3 条既有错误，仅行号漂移）；幽灵依赖守卫 OK。

一处如实说明的适配：方案要求「未授权访问文件夹: ${msg}」逐字保留，但 `pick` 契约（能力缺失抛错、任何 rejection 返回 null、不碰状态栏）会丢原始 rejection 消息——要保 `${msg}` 就得把原始拒绝文本传出 `pick.ts`。demo 采用：取消/拒绝时显示 `未授权访问文件夹:` 前缀 + 固定说明（`用户取消或拒绝授权`）；能力缺失时显示逐字原样的 `File System Access API 不可用（…）`；任何路径都不让页面崩。

## 备选方案

- **目录加载器留在 core**：它是纯策略、single 消费者（demo）且 core 内零消费；只有宿主机环境只有唯一形状时才属于 core。
- **为 demo 与 3d_editor 建共享包**：拒绝——今天只有一个消费者；等出现第二个消费者且两者收敛到同一实现再抽。
- **手写 zip 解析替代 `fflate`**：与「不引入未验证代码」原则冲突——~150 行新二进制解析 vs 已在依赖树里的 MIT 库。
- **剥离 zip 顶层目录**：拒绝（B3）——moduleKey 规则必须无例外；后缀匹配在 `pickEntryKey` 里统一做，不假装包裹不存在。
- **提交二进制 zip fixture**：拒绝（D12）——会过期、产生二进制 diff。

## 后果

- `demo` 应用拥有文件来源策略；`core` 只留环境无关的适配器。3d_editor 将按同一契约（`ProjectLoader`、`moduleKey`、`entry`、错误码语义）自带实现项目文件表。
- zip 成为两通道之间可端到端自动验证的「证据」——它用真实多文件数据走同一套执行路径。
- 沿用既有缺口：每次运行重读源码（暂无 `fingerprint()` 缓存），与之前一致。