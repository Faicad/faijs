# Agent Note: mini_lathe 测试夹具所有权随项目迁出 monorepo

Status: implemented

[English](2026-09-19-mini-lathe-tests-follow-project-out.md) | 中文

## Problem

mini_lathe 已迁出 faijs monorepo 至 `D:/Faicad/cadquery-port/mini_lathe`（commit a7326a3），但 cq-compat 的两个测试（`assembly-mini-lathe-e2e.test.ts`、`assembly-export-bake.test.ts`）留在原地继续探测旧路径，套件级失败报 "mini_lathe root not found"。第一版修法（改路径候选指向新位置）止住了表象，但留下精神分裂状态：faijs CI 将长期携带唯一的夹具在另一个仓库里的测试——cadquery-port 一旦改名或删除，faijs 还会再断一次。

## Decision

这两个测试属于 mini_lathe 案例而非 cq-compat 库面：被测对象是「mini_lathe 装配在 cq-compat 求解器上的表现」，mini_lathe 是其唯一夹具，冻结参考位姿（`out/ref/mini_lathe_poses.json`）也在 mini_lathe 项目内。因此把两个测试**迁到 `cadquery-port/mini_lathe/tests/`**（改名 `assembly-e2e.test.ts` / `export-bake.test.ts`），并从 cq-compat 删除。

配套变更：

- `cadquery-port/mini_lathe` 新增 `vitest.config.ts`（别名把 `@faicad/faijs*` 与 `@faicad/cq-compat` 解析到 faijs 活源码，与 monorepo 内 M7 免打包范式一致）、`test` 脚本，以及覆盖 `tests/` 的 tsconfig paths。
- cq-compat 保留全部库级测试；剩余的 "mini_lathe" 字样经 grep 核实仅为历史注释，不访问其文件。
- 参考位姿用 `scripts/export-cadquery-ref.py`（cadquery-env python）在新位置就地重生成——`out/` 被 gitignore，新 checkout 本就没有位姿文件。

## Alternatives considered

- **原地改路径候选（第一版修法）。** 用户澄清目标后否决：「彻底剥离」——凡读取 mini_lathe 文件的代码必须与 mini_lathe 同仓库；monorepo 测试伸进兄弟仓库取数，正是要去除的耦合。
- **整个 cq-compat 测试套件一起搬。** 否决：其余装配测试（constraints、global solver、lift boundary）测的是库本身，用合成夹具、不访问 mini_lathe 文件，是 cq-compat 的回归守卫，应当留下。

## Consequences

- faijs CI 的 cq-compat 测试不再依赖 monorepo 之外的任何东西；cadquery-port 拥有 mini_lathe 的 e2e/烘焙验证，在 `mini_lathe/` 内 `npm test` 运行。
- cadquery-port 新 checkout 需要先在 `mini_lathe/` 内 `npm install` 并跑一次 `scripts/export-cadquery-ref.py`，测试才能通过（坑点已记录：`out/` 被 gitignore）。
- 别名配置内嵌一个易错事实：`@faicad/faijs/shape` 映射到 `packages/core/src/shape.ts`（不是 `mesh/index.ts`）——指错模块的表象是 `isShape is not a function`（双实例症状），而不是解析错误。
