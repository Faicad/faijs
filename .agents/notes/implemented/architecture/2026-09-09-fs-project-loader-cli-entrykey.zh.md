# Agent Note: fs ProjectLoader + CLI 接线 + entryKey —— mini_lathe 经真实文件引用去重

Status: implemented

[English](2026-09-09-fs-project-loader-cli-entrykey.md) | 中文

## 问题

`packages/mini_lathe` 的 7 个零件脚本各自复制了整份 `config.py` 常量块和 `make_*` 辅助函数（Python 原版是 import 进来的）。引擎已有多文件支持（`ModuleRegistry` + `HostPorts.projectLoader`，P5），但没有任何东西接上真实文件系统：宿主侧没有 loader，CLI 从未注入，且主模块根本没有 module key（`loadDirectModuleImports` 调 `resolveImports` 时不传 `baseKey`），入口文件在子目录时它自己的 `./x.fai.js` 会相对错误的基准解析。具名 import 普通常量经评估后被**拒绝**——见 `.agents/notes/rejected/architecture/2026-09-09-named-import-of-constants.md`；命名空间 import（`import * as config from ...`）是采用的形态。

## 决定

1. **`node-host/fs-project-loader.ts`** —— `createFsProjectLoader(rootDir)`：递归枚举根目录下 `**/*.fai.js`，key 为相对根目录的 POSIX 风格路径；`readSource` 每次直接读盘（不做缓存：loader 每次调用都返回当前内容，改完即重跑的语义天然一致）。`findProjectRoot(entryFile)`：从入口文件向上找到最近的含 `package.json` 的目录；CLI 的 `--project-root` 可显式覆盖。
2. **CLI 接线**（`node-host/cli.ts`）：`cliCheck`/`cliRun` 从入口文件推算项目根、注入 `projectLoader`、并传 `entryKey`（入口文件相对根的路径）。`--project-root <dir>` 两个命令均可用。
3. **`ExecuteOptions.entryKey`**（`cad-runtime/runtime.ts`）：`execute`/`append`/`update` 透传给 `loadDirectModuleImports`，后者作为 `baseKey` 传给 `resolveImports`。缺省 → `undefined`，保持原先「单文件在根目录」的行为；既有调用方不受影响。
4. **子模块产出的 BREP solid 登记进主 runtime**：`runDirectModule` 构造 `DirectExecutor` 时没接 `setSolid` 钩子，依赖模块内部产出的 shape 进不了主 `solidCache`——装配体的零件在 import 模块里时，STEP 导出会退化成逐零件多终端输出。现在钩子在 `runDirectModule` 中挂上（并在 `ensureBrepChain()` 之后，后者同时被调整到依赖装载之前执行，保证 import 模块执行时 kernel 已初始化）。
5. **`autoLoadLibsFromImports` 跳过相对 specifier**：带相对 specifier 的命名空间 import（`./config.fai.js`）是模块 import 而非库；此前自动装载器会把它当库解析并失败。现在相对 specifier 在此被排除。
6. **mini_lathe 重构**：新增 `src/config.fai.js`，持有全部共享常量 + `pin_holes` 辅助函数（现在显式接收孔半径参数——no-IR 通道上模块级 `const` 在函数体内不可见，这是 `DirectExecutor` 既有的作用域规则；辅助函数显式声明依赖，而非闭包捕获魔数）。7 个零件脚本与 `assembly.fai.js` 改为 import，对齐 Python 原版的 `import config` / `from bottom_plate import bp`。

## 验证

- `bottom_plate` 重构前后 STEP 逐字节一致（仅文件头时间戳不同）；其余 6 个零件与装配体在重构前导出基线，重构后重导：全部逐字节一致，装配体除外——其内部实体编号有位移（实体数同 11375、成员名与顺序相同、`COLOUR_RGB` 集合相同——屏蔽 `#id` 与时间戳后结构相等）。
- `module-registry.test.ts` + `direct-executor.test.ts` + `cli.test.ts`：81 项通过。`packages/tests` multifile 套件：8 项通过。lint 与 core typecheck 干净。

## 备选方案

- **项目根 = 入口文件所在目录**：拒绝——跨目录引用会失效（包根的 `config.fai.js` 对 `src/parts/*` 入口不可达），且单零件导出各自解析出不同的根。
- **用 `.fai-project.json` 标记文件作项目根**：拒绝——多一个约定文件，所有既有 `.fai.js` 项目都得补；`package.json` 已是本 monorepo 事实上的根标记。
- **具名 import 普通常量（`import { OUTX } from ...`）**：拒绝——见 `.agents/notes/rejected/architecture/2026-09-09-named-import-of-constants.md`；命名空间 import 是采用的形态，且与 Python 原版实际使用 `config` 的方式一致。
- **fs loader 内按 fingerprint 缓存模块源码**：暂缓——P5 已把 fingerprint 缓存列为引擎侧开放缺口；loader 刻意每次重读，宿主保持薄层、改完即重跑的语义天然一致。

## 后果

- 任何 Node 消费方现在经 CLI 即可零宿主代码地从磁盘运行多文件 `.fai.js` 项目；browser 宿主仍需自行注入 `projectLoader`（未变）。
- 入口文件不在项目根的宿主必须提供 `entryKey`；CLI 已自动处理。
- 沿袭 P5 的已知缺口：每次 `execute`/`append` 调用都会重载模块（尚无 fingerprint 缓存）。
