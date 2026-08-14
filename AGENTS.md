# AGENTS.md

Faicad CAD 执行引擎：faijs 语言 parser + BREP/mesh 双链路几何 + CadRuntime。**无构建步骤**——包以 TS 源码直接消费（`main: src/index.ts`），没有 dist。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm test` | 全量测试（vitest run；testTimeout 120s，几何运算慢） |
| `npx vitest run <path>` | 跑单个测试文件，如 `npx vitest run test/faijs/syntax.test.ts` |
| `npx vitest run --coverage` | v8 覆盖率（text + html → `coverage/`） |
| `npm run typecheck` | `tsc --noEmit`，**只覆盖 `src/**/*.ts`**——`test/`、`demo/`、`vitest.config.ts` 不在检查范围 |
| `npm run lint` | `eslint src`（`scripts/`、`docs/`、`demo/` 被 ignore） |
| `pwsh -NoProfile scripts/ci.ps1` | Windows 全量 CI：lint → typecheck → vitest + stderr 检查 |
| `scripts/ci.sh` | Linux/macOS 版；Windows 下会报错提示改用 ps1 |
| `npx tsx scripts/faijs-cli.ts check <f.faijs>` | 干跑校验（parse + schema + 引用预检） |
| `npx tsx scripts/faijs-cli.ts run <f.faijs> --out x.stl\|step [--mode auto\|brep\|mesh]` | 执行并导出；STEP 需要 BREP 链存活 |

## 架构（L0–L3 分层）

- **L0 文本层** `src/lang/`：parser（acorn，**先解析后执行，绝不 eval**）、codegen、args-schema。`.faijs` 是合法 JS 子集，语句 id 用 `partN_vM`（N=模型号，M=版本号）。
- **L1 几何层**：`src/brep/`（OCCT brep 链）、`src/mesh-ops/`（manifold-3d mesh 路径 + `cad` API）、`src/boolean/`、`src/primitives/`、`src/sdf/`、`src/topology/`。
- **L2 编排** `src/cad-runtime/`：`CadRuntime` + `HostPorts`（csg/sdf/fonts/assets/events 注入接口）。
- **L3 Host**：`src/node-host/`（fs）+ `src/browser-host/`（worker）。
- **双链路执行**：每个 op 有 BREP（occt-wasm）与 mesh（manifold-3d）两条路径，`src/brep/ops/dispatcher.ts` 按 op 白名单静态分派；BREP 链状态在 `src/brep/brep-chain.ts`。单位 mm、+Z 向上、角度用度（契约见 `docs/api-contract.md`）。
- 入口文件：`src/index.ts`（全量）、`src/browser.ts`（浏览器安全版，**不含 node-host**）、`src/node.ts`（node-host 专用）、`src/csg.ts` / `src/sdf.ts`。浏览器构建里静态 import node-host 会 404——Node 专用代码一律从 `@faicad/faijs/node` 导入。

## 必须知道的约定

- **`src/mesh-ops/api.d.ts` 是生成文件**：由 `src/lang/args-schema.ts` 经 `npx tsx scripts/gen-api-dts.ts` 生成，禁止手改；改 schema 后必须重跑该脚本。
- **测试 stderr 零容忍**（CI 强制）：任何测试输出 `stderr |` 行即判失败。测试若故意触发错误，必须在测试内 spy `console.warn/error` 并断言；禁止全局静默 stderr。
- **typecheck/lint 不覆盖测试与 demo**：`test/` 目录的 TS 错误不会被 `npm run typecheck` 发现，改动后手动跑 vitest 验证。
- 测试分布在 `src/**/*.test.ts`（与源码同目录）和 `test/faijs/`（按功能分目录，含 `.faijs` fixture）。parity 测试（BREP vs mesh 一致性）在 `beforeAll` 里 `initOcctWasm()`。
- `test/faijs/syntax.test.ts` 有 `KNOWN_CODEGEN_ISSUES` 集合（screw/split/split-dag/parity-screw）：这些文件只做结构级 round-trip 比对，**不要把它们当成 bug 去修**。
- `test/*.stl`、`test/*.step` 是 CLI 测试产物（已 gitignore），不要提交。
- `demo/` 是独立 vite 应用（dev 端口 8899；build 时 three/manifold-3d/occt-wasm 外链 jsdelivr CDN importmap，版本号与 package.json 手写同步）。
- 仓库文档与代码注释用中文；commit message 用 conventional commits（如 `feat(brep): ...`）。

## 文档地图

- `docs/api-contract.md`、`docs/syntax-design.md`、`docs/ops-api-inventory.md`（写 `.faijs` 的 API 手册）：有效契约，改行为前必读。
- `docs/architecture.md`：**空占位文件**。
- `docs/plans/YYYY-MM-DD-*.md`：按日期命名的设计/计划文档。



### 要点

- **只看最后几轮对话写 commit message 是严重错误。** 必须回头看整个 diff 和实际完成的全部工作，找到真正重要的内容
- header 是核心，正文是辅助。


## ⚠️ Git 操作警戒：永远不准无差别还原目录

**禁止 `git restore <目录>`、`git checkout -- <目录>`、`git reset --hard` 等批量还原操作。**

这些命令会**无差别销毁目录下所有未提交的修改**，包括用户尚未 staging 的代码、调试改动、配置文件调整等。


## BREP 术语约定

- **`brep`（BREP）在本项目的默认含义**：指**可通过方程/精确几何运算**的边界表示模型——OCCT 实体（精确曲面、边、顶点，STEP 导出为 `ADVANCED_FACE`）。faceted / 三角化封装的"brep"默认不算brep。

## ⚠️ BREP/mesh 路径判定红线：静态规则，禁止运行时回退

**BREP 链是否可用，由静态规则在执行前判定，不是运行时 try-catch 判定。** 

是否用 mesh 在执行前就应知道。BREP 路径执行抛异常 = 设计缺陷或 bug，必须直接报错暴露。

Brep链可以切换，没有回退。在链上增加一个brep不支持的操作后，该链的后续部分采用mesh处理。该链之前的部分不变，仍然是brep处理。这就是切换。

