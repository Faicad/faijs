# Skill: faijs npm 发布

在 faijs monorepo 上向 npm 发布包时，遵守以下约定。**发布是不可逆的外部副作用操作，流程以 `scripts/publish-all.ps1` 的代码为准，环境识别先行。**

## ⚠️ 第一优先级：先确认"我的 npm 是谁、读哪个 .npmrc"

发布 / 认证类操作开始前，第一件事核对（2026-10-04 事故教训，见 `docs/analysis/2026-10-04-publish-retrospective.md`）：

- `npm config get userconfig` / `$env:NPM_CONFIG_USERCONFIG`
- `(Get-Command npm | node).Source` 是否指向 `sandbox_runtime`
- 失败日志路径是否含 `sandbox_runtime`

**发现沙箱环境（`sandbox_runtime`）→ 立即停止认证类操作。** 沙箱的 npm 读的是沙箱 `.npmrc`（无用户 npmjs token）、registry 默认是 npmmirror 镜像，任何发布操作必然 `ENEEDAUTH`。此时发布必须在**用户真实终端**执行，不要在我方环境反复试错、更不要把沙箱失败归因为"用户凭证失效"。

- `npm whoami` 返回的 `ENEEDAUTH` **不代表用户 token 失效**——先对照用户真实终端的环境证据（用户终端的 `npm whoami --registry=https://registry.npmjs.org/` 是最优先级事实）。
- 同一动作在同一环境失败 2 次 → 停止重试，重新观察环境证据（路径 / 配置 / 日志位置），而不是加大重试次数。

## 版本号升级流程（唯一写入口，禁止手改）

发布前版本号一律由脚本改写，禁止手改（手改会被 `check-lockstep.mjs` 判失败）：

| 顺序 | 命令 | 作用 |
|---|---|---|
| 1 | `npm run set-version -- <MAJOR.MINOR.PATCH>` | **唯一**的版本写入端 |
| 2 | `node scripts/check-lockstep.mjs` | 改完必须跑 |

`set-version.mjs <ver>` 一次改到位：root `config.faijsVersion` + 每个家族包 `version` + 每个 `@faicad/*` registry range（一律规范成 `^<major>.<minor>.0`）+ `cdn/versions.json` + `package-lock.json`。同版本重跑是幂等的修复入口。

## publish-all.ps1 调用方式

统一入口是 `scripts/publish-all.ps1`（以源码为准，默认 DryRun 干跑，不发布）：

| 命令 | 含义 |
|---|---|
| `pwsh .\scripts\publish-all.ps1 -DryRun -SkipCI` | 本地干跑：只做 lockstep/构建/pack 白名单断言，**不发布**（默认推荐） |
| `pwsh .\scripts\publish-all.ps1 -SkipCI` | 跳过 CI，真实发布（在**用户真实终端**、需 npmjs 官方 registry 有效凭证） |
| `-Tag <tag>` | dist-tag，默认 `latest`；首发布用 `next` |
| `-From <N>` | 从第 N 个包开始（1-based，断点续发；前序跳过） |
| `-Otp <otp>` | 2FA 一次性密码（账号开 2FA 时需要） |
| `-SkipBuild` | 跳过逐包 build（已手工构建时用） |
| `-Provenance` | 加 `--provenance`（需要 OIDC CI 环境，本地不可用） |

### 五步流程（对应脚本逐段）

1. **[1/5] 版本 lockstep 硬门禁**：`node scripts/check-lockstep.mjs`。断言①所有可发布包 `version` == root `config.faijsVersion`；②所有 `@faicad/*` registry range 指向该版本线。失败即 `throw`，**发布前中止**。
2. **[2/5] 全量 CI（可选）**：`-SkipCI` 跳过；否则直接调 `scripts/ci.ps1` / `ci.sh`。
3. **[3/5] 逐包（拓扑序 10 包，见脚本 `$Packages`）**：
   - 每包 `npm run build` → **必须在包目录内**执行 `npm pack --dry-run --json .`（路径必须是 `.`，从仓库根传路径会被当 package spec 触发 GitHub shorthand 解析）→ `Assert-Tarball` 白名单断言；
   - **Tarball 白名单**：禁止 `(^|/)src/`、`tests?/`、`__tests__/`、`out/`、`fixtures/`、`scripts/`、`out-`、`probe-`、`node_modules/`、`*.test.*`、`*.spec.*`、`*.fai.js`、`*.brp`、`*.step`、`*.log`；必须含 `package.json`；必须含 `dist/` 内容（缺则视为空构建）；
   - 非 DryRun 时：`npm publish --access public [--tag] [--otp] --registry https://registry.npmjs.org/`（**固定官方 registry**）；失败即 `throw`；
   - **验证延迟到 Step 4**（不在循环内卡等 CDN 传播）。
4. **[4/5] 发布后验证（warn-only，绝不 abort）**：对每个已发包 `curl.exe -s https://registry.npmjs.org/<urlencoded-name>/<version>` 最多 5 次重试，响应 `name`+`version` 匹配即通过；CDN 传播延迟未命中只 warn，不视为失败。
5. **[5/5] 发布记录**：写 `out-publish-<YYYYMMDD-HHMMSS>.json`。

### 判定发布成功

- 脚本层面：Step 4 对每个包输出 `OK verified <pkg>@<version>`（warn 除外）；
- 手动复核：`npm view <pkg> version` 返回目标版本号。

## 行为准则（2026-10-04 复盘预防复发）

1. 环境识别先行（见上）——沙箱环境绝不执行发布/认证操作。
2. 我环境的失败 ≠ 用户环境的失败；涉及用户凭证的结论先对照用户真实终端证据。
3. 读代码读到环境语义：`publish-all.ps1` 用当前 shell PATH 解析 `$npm`，在沙箱里注定读到沙箱 `.npmrc`。
4. 发布从 DryRun 开始；真实发布失败报告"哪个环节 + 失败日志路径"，不得反复用真实发布命令试错。
5. 让用户操作前先穷尽我方可查（配置 / 环境 / 远端）。
6. 先信任用户陈述的事实。

## 相关文件

- `scripts/publish-all.ps1` —— 发布入口（权威流程，本 skill 以其代码为准）
- `scripts/set-version.mjs` / `scripts/check-lockstep.mjs` —— 版本写入口与 lockstep 守卫
- `docs/analysis/2026-10-04-publish-retrospective.md` —— 本次事故复盘（根因：执行环境隔离 + 错误归因）
- `AGENTS.md` —— 版本号升级流程、check-lockstep 硬门禁的权威出处