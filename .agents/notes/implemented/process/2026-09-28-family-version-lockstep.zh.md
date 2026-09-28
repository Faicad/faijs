# Agent Note: 整个 @faicad/* 包族共用一个版本（单一真源 + 写入端 + 守卫）

Status: implemented

[English](2026-09-28-family-version-lockstep.md) | 中文

## Problem

可发布的 `@faicad/*` 包族本应「一个版本」发布，但这条规则只停留在口头意图：版本 bump 靠手工改 12 个 `package.json`，包族已经悄悄分裂成四条版本线（`@faicad/faijs` 0.20.0、7 个包 0.19.0、`@faicad/faijs-draw` 0.18.3、三个 `cq-compat-*` 0.17.0），而提交与 CI 路径上没有任何环节会发现。

三处具体缺口：

- **没有单一真源。** 版本分散在每个包自己的 `version` 字段里，「bump 整个包族」是一次跨多文件的手工编辑，除了读 12 个文件没有别的核对方式。
- **写入端已经腐坏。** `scripts/bump-version.mjs` bump 的是**根**包版本（根是 `private`、从不发布），并改写 `demo/package.json` —— 该路径在 demo 迁到 `packages/demo` 之后就不存在了。运行它会在写不存在的目录时抛错，同时一个包族成员都没改到。上一次真正生效的包族 bump 是一条手写提交。
- **守卫看不见 drift。** [依赖 lockstep 守卫](../bug-fix/2026-09-24-dep-lockstep-guard.zh.md) 只校验包间 range 是否指向**目标包自己**的版本线，因此分裂成四条线的包族照样通过。唯一的版本相等断言在 `publish-all.ps1` step 1，也就是只能在发布那一刻才炸；而 `scripts/ci.sh` 根本没跑任何 lockstep 守卫。
- **第二个家也已腐坏。** `cdn/versions.json` —— 供方案 b 浏览器库装载器读取的精确 pin 镜像（生成物）—— 落后三条版本线（0.16.2 / 0.16.1 / 0.13.2），并且完全没有 `@faicad/faijs-draw` 与 `@faicad/faijs-sketch`；除了手工跑一次 `gen-importmap.mjs`，没有任何环节会重新生成它。

## Decision

三个协作件，一条规则，共享定义放在 `scripts/lockstep-lib.mjs`（包族发现、`expectedRange`、`readCdnVersions`、`collectViolations`）：

1. **单一真源** —— 包族版本只声明一次：根 `package.json` → `config.faijsVersion`。根包是 `private`，它自己的 `version` 不是发布版本，不用于此目的。
2. **写入端** —— `scripts/set-version.mjs <ver>` 依次写入声明版本、每个包族成员的 `version`、以及每个 registry range 形式的 `@faicad/*` 条目（`dependencies` / `peerDependencies` / `devDependencies`）统一为 `^<major>.<minor>.0`；随后刷新 `package-lock.json` 让 lock 里的 workspace 条目跟随，并重新生成 `cdn/versions.json`，使 CDN pin 镜像不可能被落下。`--dry-run` 只打印改动计划，`--no-lock` 跳过 lock 刷新，`--include-private` 把 `fixtures` / `tests` / `demo` 一并纳入。
3. **守卫** —— `scripts/check-lockstep.mjs` 同时断言三半：(a) 每个包族成员的 `version` == `config.faijsVersion`；(b) 每个 registry range 形式的 `@faicad/*` 条目 == 其目标的 `^<major>.<minor>.0`；(c) `cdn/versions.json` 把每个包族成员 pin 在其当前版本（文件不存在时跳过）。`file:` / `workspace:` / `link:` 属本地解析，跳过。规则实现为对内存包表的纯函数，因此 `--self-test` 用合成包集跑规则（对齐 / 版本线分叉 / range 陈旧 / 本地 range / 外部包名 / 版本未声明 / devDependencies range / CDN pin 陈旧 / CDN 缺 pin / CDN 镜像缺失）—— 从未见过失败的守卫不构成证据。

规则 (a) 与 (b) 互补：(a) 看不见陈旧 range（2026-09 CDN 断图事故），(b) 看不见版本线分叉（本 note 的 Problem）。规则 (c) 的存在理由是：生成物仍然是同一个事实的第二个家，而它在没有任何门禁察觉的情况下漂了三条版本线。

门禁接线 —— 同一条命令在四处运行，drift 无法悄悄落地：

| 门禁 | 作用 |
|---|---|
| `lefthook.yml` pre-commit（`glob: {package.json,packages/*/package.json}`） | 直接拒绝引入 drift 的那次提交 |
| `scripts/ci.ps1` step 5 | Windows 全量 CI |
| `scripts/ci.sh` step 5 | Linux/macOS 全量 CI（此前完全不跑 lockstep 守卫） |
| `scripts/publish-all.ps1` step 1 | 发布门禁；合并了原 step 1（版本相等）+ step 1b（range），`$Version` 改为从根声明读取 |

private 工作区包（`@faicad/faijs-fixtures`、`@faicad/faijs-tests`、`@faicad/faijs-demo`）默认不属于包族：它们从不发布，用 `*` 或 `file:` 解析，其 version 字段没有发布含义。`--include-private` 可把它们纳入。

包族已对齐到 `0.20.0`，顺带修好两条旧守卫放行的陈旧 range：`fcstd → @faicad/faijs-draw`（`^0.18.0`）与 `fcstd → @faicad/faijs-sketch`（`^0.19.0`）。重新生成的 `cdn/versions.json` 现在把 12 个包族成员全部 pin 在 `0.20.0`，并补上了此前缺失的 `@faicad/faijs-draw` 与 `@faicad/faijs-sketch`。

## Alternatives considered

- **用 npm workspaces 自带的版本能力。** npm 没有 fixed 模式，workspaces 只做链接，没有任何受支持的方式声明「所有成员一个版本」。
- **changesets / lerna fixed mode / independent-versions 类工具。** 各自会新增依赖和配置文件，而 changesets 的核心价值恰恰是「逐包选择版本」，与需求相反；一个 60 行的 Node 脚本直接读 `package.json` 即可，不引入新依赖。
- **沿用根 `version` 字段作为真源，而不是新增 `config.faijsVersion`。** 根包是 `private: true`，npm 会用该字段做自身记账，复用它会与 npm 语义冲突，并让读者误以为 0.x 就是发布线。
- **只扩展既有 range 守卫（即维持现状）。** 它在四线分裂的包族上通过了 —— 这是实测而非假设。range 一致性离开版本相等就无法表达「包族一个版本」。
- **相等性仍只交给 `publish-all.ps1`（即维持现状）。** 在功能合入之后的发布时刻才触发，一次 drift 的代价从「提交被拒」变成「发布中止」。
- **只在 CI 拦，不加 pre-commit 钩子。** 反馈更慢，且会让未对齐的改动留在分支上；该钩子只做一次文件扫描，约 100 ms。
- **在 `packages/tests` 写 vitest 单测，而不是 `--self-test`。** `packages/tests` 的 include 只有 `faijs/**/*.test.ts`，而仓库工具链的测试不属于语言/几何集成包。把合成用例折进守卫，可以让规则与它的验证同处一个文件，且每次调用都跑。
- **把 `scripts/bump-version.mjs` 保留成弃用转发壳。** 它得转发到 `set-version.mjs`，却挂在一个已不能描述其行为的名字下；包族只保留一个写入端，因此删除旧名而不做别名。
- **把 `cdn/versions.json` 继续交给手工跑 `gen-importmap.mjs`。** 这就是现状，也正是镜像落后三条版本线、缺两个包的成因。把重新生成折进写入端只多一次本地、确定性的脚本调用，就让镜像不可能被忘记；没有加 `--no-cdn` 逃生开关，因为该生成是幂等、不联网的，而且镜像漂移时守卫给出的修复命令正是它。
- **删掉 `cdn/versions.json`，只依赖 importmap 解析。** 精确 pin 是为可复现的发布产物存在的，与 dev/playground 解析不是同一种保证；删掉它等于拿一个真实属性换整洁。

## Consequences

- 包族 bump 变成一条命令：`node scripts/set-version.mjs <ver>`。patch 级 bump 可以合法地不改 range（`^0.20.0` 允许 `0.20.x`）；写入端会把未变字段如实报为 unchanged，而不是假装改写过。
- 手工改某一个包的 `version` 或某个 `@faicad/*` range，会被 pre-commit 钩子、两种 CI 和发布门禁同时拦下。
- `scripts/bump-version.mjs` 与 `scripts/check-dep-lockstep.mjs` 已删除，其活逻辑分别落在 `set-version.mjs` 与 `check-lockstep.mjs`；2026-09-24 的 note 保留为「range 规则为何存在」的记录。
- `check-lockstep.mjs --include-private` 目前会报出 private 包的偏离（fixtures 0.5.8、tests 0.5.9、demo 无版本，以及 `tests` 的 `*` range）。这正是包族之外那些包的预期诊断输出，一旦有人选择纳入，它就是一份待修清单。
- 新的可发布 `@faicad/*` 包只要是 `packages/` 下的非 private 包就自动进入包族；唯一的退出方式是被写进 `FAMILY_EXCLUDE` 集合，这个摩擦是刻意保留的。
