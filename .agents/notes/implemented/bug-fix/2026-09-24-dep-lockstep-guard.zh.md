# Agent Note：可发布 @faicad/* 包的依赖 lockstep 守卫

Status: implemented

[English](2026-09-24-dep-lockstep-guard.md) | 中文

## 问题

`@faicad/fai-cq-gears` 自身已 bump 到 0.16.x，但 `dependencies` 里仍声明
`"@faicad/cq-compat": "^0.14.0"`。CDN 库构建从 registry 解析出旧版
cq-compat@0.14.1，其内部 pin 又拉了旧 `@faicad/faijs`，运行时包图断裂。

`publish-all.ps1` Step 1 只检查各包自身 `version` 与 lockstep 版本一致，
从不检查包之间互相声明的 `@faicad/*` 依赖 range——漏改的 range 一路通过
publish，直到 CDN 构建才炸。lockstep 版本 bump 是对每个 package.json 的手工
修改（自身 version + 各互依赖 range），漏改一个 sed 目标就产生这类静默故障。

## 决策

新增守卫 `scripts/check-dep-lockstep.mjs`（纯 Node ESM，与
`check-ghost-deps.mjs` 同形态）：

- 范围：`packages/` 下所有非 private 的 `@faicad/*` 包（排除表与
  `gen-importmap.mjs` 一致）。
- 规则：`dependencies` / `peerDependencies` 中以 registry semver range 声明、
  且目标也是仓库内可发布 `@faicad/*` 包的条目，range 必须恰好等于
  `^<目标major>.<目标minor>.0`（如目标 0.16.1 → 只允许 `^0.16.0`）。
- `file:` / `workspace:` / `link:` 本地引用跳过（不经 registry，lockstep
  不适用）。
- 接入两道门禁：`scripts/ci.ps1` 第 5 步（与 check-ghost-deps /
  check-workspaces-order 并列）和 `publish-all.ps1` 新增 Step 1b——紧跟版本
  一致性检查之后、构建/publish 之前，漏改的 range 现在会让 publish 直接
  abort，而不是发出去一个断图。

## 被否决的替代方案

- **只在 publish 后校验 packument（warn-only）**：失败发生在包已经发上 npm
  之后，作为门禁毫无用处。
- **把 private 包（`faijs-tests` 等）也纳入检查**：它们用 `*` / `file:`，
  不会到达 CDN；约束它们徒增维护成本，不闭合故障模式。

## 后果

lockstep bump 必须在同一次变更里同时改：各包自身 `version` + 所有包间
registry range，否则 CI 与 publish 都会失败，报错信息会点名违规包与期望
range。守卫刻意从严（要求 `^X.Y.0` 精确相等，而非任意可满足 range），
`^0.14.0` 这类旧版本线永远无法通过。
