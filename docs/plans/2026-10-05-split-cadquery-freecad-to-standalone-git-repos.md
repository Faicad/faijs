# 方案：将 faijs-cadquery / faijs-freecad 拆分为独立 git 仓库（保留各自目录历史）

状态：已落地

## 0. 用户原话

初始需求：

> 我需要把packages下面的
> faijs-cadquery
> faijs-fasteners
> faijs-freecad
> faijs-gears
> 都独立出去，成为单独的git项目。而且最好能够保留git提交的历史，只保留自己这个目录相关的历史。
> 请问有那么可行的方案？

> 你需要先写方案

**范围变更（本版依据）**：

> 这样，我更改方案，只移出faijs-cadquery
> faijs-freecad，不动
> faijs-gears
> faijs-fasteners
> 请重写方案。

用户已确认的决策（原话选项）：

> 历史保留范围：**含改名前的旧路径（推荐）**——保留 `cq-compat` / `fcstd` 等旧目录下的完整历史（freecad 不含 core 内源头）。
>
> monorepo 侧如何处置：**彻底移除，改依赖 registry 发布版（推荐）**。
>
> 新仓远端命名：**沿用 `@faicad/<name>` 命名**——仓库名与 npm 包名对齐。
>
> `@faicad/cq-compat-compare` 处置：**单独发布到 npm（推荐）**——它并非 private、已登记 `cdn/versions.json`，纳入 publish-all 发布，移出方用 registry 引用。

## 1. 结论摘要

**完全可行，属 git 标准操作。** 核心工具是 `git filter-repo` 的路径过滤 + 重命名能力，可跨「改名链」保留历史。

本版范围：**移出 2 个包**（`@faicad/faijs-cadquery`、`@faicad/faijs-freecad`），**保留 2 个包**（`@faicad/faijs-gears`、`@faicad/faijs-fasteners`）在 monorepo。

有利条件：

1. **代码层面已近乎独立**：两包对 core 等只用 `peerDependencies` / `dependencies` + registry range，源码无相对路径耦合。
2. **两者彼此不依赖**，可各自独立成仓。
3. **均在发布清单内**（`scripts/publish-all.ps1:85-86`）并登记于 `cdn/versions.json`，「改依赖 registry 版本」前提成立。
4. **两包无相互依赖、freecad 无任何反向依赖**，波及面比四包方案小。

**最大风险点**：两个目录名都是 **2026-10-02 才 rename 出来的**，真实历史在旧目录名下（见 §3.2）。只按当前路径过滤会丢掉大部分提交。

## 2. 现状调研

### 2.1 两个移出包的定位

| 包 | 路径 | license | 运行时依赖（仓库内） | 备注 |
|---|---|---|---|---|
| `@faicad/faijs-cadquery` | `packages/faijs-cadquery` | AGPL-3.0-only | peer：`@faicad/faijs`、`@faicad/faijs-sketch`、`@faicad/faijs-extra`；dev：`@faicad/cq-compat-compare`、`@faicad/faijs`、`@faicad/faijs-extra` | devDeps 三处 `file:` 本地链 |
| `@faicad/faijs-freecad` | `packages/faijs-freecad` | Apache-2.0 | deps：`@faicad/faijs-sketch`、`@xmldom/xmldom`；peer：`@faicad/faijs`、`occt-wasm` | 带 `bin`（`faijs-freecad-convert`）；devDeps **无** `file:`，靠 workspace hoist 拿 core（幽灵依赖） |

cadquery 的 AGPL-3.0-only 属性与其余 Apache-2.0 不同，独立仓需各带自己的 LICENSE/NOTICE。

### 2.2 monorepo 内的反向依赖

| 引用方 | 引用形态 | 处理 |
|---|---|---|
| `packages/demo` | `main.ts:133` 运行时 `import('@faicad/faijs-cadquery')`；`package.json` `^0.29.0`；`e2e/demo.spec.ts:264` | 已是 registry range，移除 workspace 后自动生效 |
| `packages/faijs-gears`（**保留**） | `src/testing/compare.ts:2,5` 仅**注释**提到 cadquery，实际 import 的是 `@faicad/cq-compat-compare`（`compare.ts:17`）；`tsconfig.json:22` 有 cadquery path 映射；`package.json` **未声明** cadquery | **实测为死引用**：删除 tsconfig path；不补 cadquery 依赖（另注：`compare.ts:5` 注释称 cadquery 是 devDependency，与实际不符，属文档瑕疵） |
| `packages/cq-compat-compare`（**保留**） | `tsconfig.json:22-23` 有 cadquery path 映射；源码 **无** import | **实测为死引用**：删除该 path（cadquery 移出后会指向不存在目录） |
| 根 `package.json` | `compat:ref` / `compat:cand` / `compat:report` 硬编码 `packages/faijs-cadquery/tests/*` | 随 cadquery 仓迁走或删除 |
| `packages/demo`（tsconfig） | `tsconfig.json:20-21` path 指向 `../faijs-cadquery/dist` | 删除，改走 node_modules |
| freecad | **无任何反向依赖** | 无需处理 |

> 注：cadquery 的方向是「cadquery（dev）→ compare」；compare 源码不反向 import cadquery，无循环依赖。

### 2.3 两包引用的仓库内共享资产（拆出后需自备）

- **构建脚本**：两包 build 均为 `tsc -p tsconfig.build.json && node ../../scripts/fix-import-extensions.mjs dist`，依赖根 `scripts/` 共享脚本。
- **cadquery 的 devDeps 本地链**：`@faicad/faijs`（`file:../core`）、`@faicad/faijs-extra`（`file:../faijs-extra`）、`@faicad/cq-compat-compare`（`file:../cq-compat-compare`）。
- **freecad 的隐式依赖**：源码 import `@faicad/faijs`（含子路径 `/io`、`/io/fai-zip`、`/io/zip`、`/api/result`）与 `@faicad/faijs-sketch`（含 `/node`），但 devDeps 未声明 core——独立后须显式补。
- **`@faicad/cq-compat-compare`**：留 monorepo，按决策纳入发布，供 cadquery 独立仓 registry 引用。

## 3. 历史链调研（决定 filter-repo 参数的关键）

### 3.1 各包提交量

| 包 | 当前路径提交数（2026-10-02 后） | 旧路径提交数 | 旧路径首次提交 |
|---|---|---|---|
| cadquery | 41 | **128**（`packages/cq-compat`） | `be4bee64` 2026-09-08 |
| freecad | 27 | **76**（`packages/fcstd`） | `8fb8a783` 2026-09-24 |

> `faijs-gears`（`fai_cq_gears` 58 条）与 `faijs-fasteners`（`fai_cq_warehouse` 45 条）**本次保留在 monorepo，不导出**。

### 3.2 改名链（`git log --follow` 实测）

- **cadquery**：`packages/cq-compat` →（`e84817eb` rename）→ `packages/faijs-cadquery`。
- **freecad**：`packages/core/src/fcstd/` → `packages/fcstd/` →（R100）→ `packages/faijs-freecad`。按用户决策**不追 core 内源头**，只取后两段。

### 3.3 历史交叠（无法完美切割，需接受）

早期存在跨包文件移动，例如 `01ede80 refactor(fai_cq_gears): move raw kernel layer into cq-compat`——gears 的一部分曾移入 cq-compat。filter-repo 后这类**改动了本目录的提交会保留在对应仓的历史里**，其 commit message 仍会提到别的目录。这是「只保留自己目录相关历史」的正常边界。

## 4. 方案总览

分三阶段，彼此解耦：

- **阶段 1**：用 `git filter-repo` 从 monorepo 副本导出两个独立仓，保留「当前路径 + 旧路径」全量历史，并把包内容落到新仓根。
- **阶段 2**：就地改造每个新仓，使其脱离 monorepo 也能 `install / build / test`。
- **阶段 3**：在 monorepo 侧移除这两个包及其硬引用，并接上所有连锁引用。

原则：**原仓在阶段 1、2 全程只读**；阶段 3 的 monorepo 改动可独立回滚。

## 5. 阶段 1：导出独立仓（保留改名链历史）

### 5.1 安装工具

`git filter-repo` 当前未安装（已实测），用已就位的 Python 3.13：

```bash
pip install git-filter-repo
git filter-repo --version
```

> 备选：`git subtree split -P <path> -b <branch>` 是 git 内置命令，但**不跟随 rename 链**，会丢旧路径历史，不推荐用于本场景。

### 5.2 逐包执行

每个包**单独 clone 一份副本**再过滤（filter-repo 破坏性重写历史，严禁在原仓直接跑；它默认还会移除 origin 以防误推）。

新仓与 monorepo **同级**，统一放在 `/c/my/Faicad/` 下——cadquery → `C:\my\Faicad\faijs-cadquery`，freecad → `C:\my\Faicad\faijs-freecad`。远端在 gitcode `Faicad` 组织下，需先在 gitcode 各建一个空仓：`https://gitcode.com/Faicad/faijs-cadquery.git`、`https://gitcode.com/Faicad/faijs-freecad.git`。

```bash
git clone --no-local /c/my/Faicad/faijs /c/my/Faicad/<new-repo>
cd /c/my/Faicad/<new-repo>
git filter-repo <该包的参数>
```

**faijs-cadquery**
```
--path packages/cq-compat
--path packages/faijs-cadquery
--path-rename packages/cq-compat/:
--path-rename packages/faijs-cadquery/:
```

**faijs-freecad**（按决策不含 core 内源头）
```
--path packages/fcstd
--path packages/faijs-freecad
--path-rename packages/fcstd/:
--path-rename packages/faijs-freecad/:
```

完整示例（cadquery）：

```bash
git clone --no-local /c/my/Faicad/faijs /c/my/Faicad/faijs-cadquery
cd /c/my/Faicad/faijs-cadquery
git filter-repo \
  --path packages/cq-compat \
  --path packages/faijs-cadquery \
  --path-rename packages/cq-compat/: \
  --path-rename packages/faijs-cadquery/:
```

**备选（若一步法报路径冲突）**：分两步——先把旧路径并入新路径，再用 `--subdirectory-filter` 提到根：

```bash
git filter-repo --path packages/cq-compat --path packages/faijs-cadquery \
  --path-rename packages/cq-compat/:packages/faijs-cadquery/
git filter-repo --subdirectory-filter packages/faijs-cadquery
```

### 5.3 校验与推送

```bash
git log --oneline | wc -l                     # 提交数约为「当前路径 + 旧路径」去重后之和
git log --follow --oneline src/index.ts | tail -5   # 应追溯到旧路径时代首次提交
git filter-repo --analyze                     # 生成 .git/filter-repo/analysis/ 供核对

# 在 faijs-cadquery 副本内：
git remote add origin https://gitcode.com/Faicad/faijs-cadquery.git
# 在 faijs-freecad 副本内：
git remote add origin https://gitcode.com/Faicad/faijs-freecad.git
git push -u origin main
```

预期提交数量级（去重后）：cadquery ≈ 169、freecad ≈ 103。

> 注意：filter-repo 重写所有 tree，**新仓的 commit hash 全部会变**（历史内容保留、hash 不复用，属正常现象）。

## 6. 阶段 2：让新仓可独立构建/测试

### 6.1 每仓必做

1. **构建脚本自备**：`node ../../scripts/fix-import-extensions.mjs dist` 在独立仓失效 → 把该脚本复制进各仓 `scripts/` 并改路径，或内联为本地实现。
2. **依赖链改 registry**：
   - cadquery：`file:../core`、`file:../faijs-extra`、`file:../cq-compat-compare` 改为对应 `^<version>`（compare 需先按 §9.1 发布）。
   - freecad：**显式补 `@faicad/faijs`**（现靠 hoist，是幽灵依赖），连同 `@faicad/faijs-sketch` 一并落到 registry。
3. **tsconfig / vitest / eslint 自举**：新仓默认继承根配置处需自带 `tsconfig.base.json`、`vitest.config.ts`、`eslint.config.*`。
4. **仓库级文件**：cadquery 复制 **AGPL-3.0-only** LICENSE、freecad 复制 **Apache-2.0** LICENSE 与 NOTICE，各补 README。
5. **CI**：各仓自建最小 CI（install → typecheck → build → test）。
6. **`repository.url`**：各包 `package.json` 的 repository 指向各自新仓——cadquery → `https://gitcode.com/Faicad/faijs-cadquery.git`，freecad → `https://gitcode.com/Faicad/faijs-freecad.git`。
7. **cadquery 的 compat 脚本**：根 `compat:ref` / `compat:cand` / `compat:report` 随包迁入新仓自建。

### 6.2 版本与发布策略

- 独立后建议各仓使用**独立语义化版本**，不再受 monorepo `set-version.mjs` / `check-lockstep.mjs` 家族版本约束。
- 包名沿用 `@faicad/<name>` 不变，monorepo 侧改 registry 依赖时无需改包名。
- **CDN 版本表（已定）**：`cdn/` 三份产物由 `scripts/gen-importmap.mjs` **扫描 `packages/` 生成**，职责限定为 **monorepo 家族**。两包移出后条目自然消失，monorepo 不再代管其 CDN pin（理由与落地见 §9.2 ①）。

## 7. 阶段 3：monorepo 侧剥离

### 7.1 根 `package.json`

- `workspaces` 移除：`packages/faijs-freecad`（第 63 行）、`packages/faijs-cadquery`（第 67 行）；**保留** `packages/faijs-gears`、`packages/faijs-fasteners`、`packages/cq-compat-compare`。
- 删除或迁移 `compat:ref` / `compat:cand` / `compat:report` 三个脚本（硬编码 `packages/faijs-cadquery/tests/*`）。
- 根 `build` 脚本**不含**这两包，无需改动；`lint` 脚本同样不含，无需改动。

### 7.2 反向依赖与残留 path

| 文件 | 处理 |
|---|---|
| `packages/tsconfig.json:20-21`（demo） | 删除指向 `../faijs-cadquery/dist` 的 paths，改走 node_modules |
| `packages/faijs-gears/tsconfig.json:22` | **确认删除** cadquery path（`testing/compare.ts` 实际只 import compare，已实测） |
| `packages/cq-compat-compare/tsconfig.json:22-23` | **确认删除**指向 cadquery 的 paths（源码本就未 import） |
| `packages/demo/package.json:16` | 已是 `^0.29.0`，无需改，确认 registry 可安装 |
| `packages/faijs-gears/package.json` | **不动**——它实际依赖的是 `@faicad/cq-compat-compare`（已在 devDeps），非 cadquery |

### 7.3 脚本与配置（已实测的精确行号）

| 文件 | 处理 |
|---|---|
| `tsconfig.json:33-34` | 删除 `@faicad/faijs-cadquery` 及其 `/*` paths；**保留** `:36` 的 compare path |
| `vitest.config.ts:23` | 更新注释（不再提及 cadquery；根 alias 本就不含它） |
| `scripts/publish-all.ps1:85-86` | 删除 freecad、cadquery 两行；按 §9.1 把 `@faicad/cq-compat-compare` 加入发布清单 |
| `scripts/ci.ps1:106` | `$testPackages` 删除 `@faicad/faijs-freecad`、`@faicad/faijs-cadquery` |
| `scripts/ci.ps1:98` | 删除 cadquery 的 900000ms 预算覆盖；`:80/:86/:93` 注释同步更新 |
| `scripts/check-lib-src-language.mjs:19` | `libPackages` 删除 `faijs-cadquery`（freecad 本就不在列） |
| `scripts/gen-faijs-cadquery-jsdoc.ts` | 整个脚本随 cadquery 仓迁走（引用其 `src/workplane.ts` 等） |
| `scripts/check-tsconfig-paths.mjs:5` | 规则说明涉及 cadquery+compare，需调整 |
| `scripts/check-lockstep.mjs:77` | 自测用例含合成 freecad 条目，可保留或替换，不影响真实规则 |
| `scripts/gen-ops-api-inventory.ts` | 复核是否引用这两包（首轮 grep 命中，二轮未见字面行），按需移除采集项 |
| `cdn/` 三份产物 | 重新生成（`node scripts/gen-importmap.mjs`）后两包条目自动消失；无需额外改动（见 §9.2 ①） |

> 以上为对全仓 `grep "faijs-cadquery\|faijs-freecad\|cq-compat\|fcstd"` 的实测命中；逐文件确认「真实引用 / 白名单 / 仅注释」后再改。

## 8. 风险、回滚与验证

### 8.1 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| hash 全变 | filter-repo 必然重写 | 已知且可接受；新旧仓不要求 hash 一致 |
| 误操作原仓 | filter-repo 破坏性强 | **只在 clone 副本上跑**，原仓全程只读 |
| 历史切割不完美 | 早期跨目录移文件 | 见 §3.3，接受 |
| monorepo 连锁断链 | demo/gears/compare 的 tsconfig path、幽灵依赖 | §7.2 逐项清理后再跑 typecheck |
| monorepo 装不上 | registry 版本落后（实测已发 0.29.3、本地 0.29.5 未发；compare 未发布） | 阶段 3 前执行 §9.2 ② 发布 gate |
| CDN pin 缺口 | gen-importmap 扫描不到移出包 | 已决策：monorepo 不代管，移出包自管（§9.2 ①） |
| 版本漂移 | 解除 lockstep 后各仓独立 | 各仓自建 CI + 发布流程 |

### 8.2 回滚

- 阶段 1、2：原仓未改，删除 `/c/my/Faicad/` 下的新仓副本即可。
- 阶段 3：全部为 monorepo 内文件改动，用 `git revert` 回滚。

### 8.3 验证清单

- 新仓：`git log --follow src/index.ts` 能追到旧路径首次提交；`npm install && npm run build && npm test` 通过。
- monorepo：`npm install` → `npm run build` → `npm run typecheck` → `node scripts/check-lockstep.mjs` → `npm test --workspaces` → `pwsh -NoProfile scripts/ci.ps1` 通过。
- 重点确认 demo 的 cadquery 运行时加载、gears 的 testing 路径在移除本地 path 后仍能解析。

## 9. 决策记录

### 9.1 已决策

- **移出范围**：仅 `@faicad/faijs-cadquery`、`@faicad/faijs-freecad`；`@faicad/faijs-gears`、`@faicad/faijs-fasteners` 保留在 monorepo。
- **历史保留范围**：含改名前的旧路径（cadquery 追 `cq-compat`；freecad 追 `fcstd`，不含 core 内源头）。
- **monorepo 侧处置**：彻底移除这两个包，demo 改依赖 registry 发布版。
- **新仓命名与位置**：沿用 `@faicad/<name>`（仓库名与包名对齐），本地与 `faijs` **同级**放在 `C:\my\Faicad\` 下（faijs-cadquery、faijs-freecad），远端在 gitcode `Faicad` 组织下——`https://gitcode.com/Faicad/faijs-cadquery.git`、`https://gitcode.com/Faicad/faijs-freecad.git`。
- **`@faicad/cq-compat-compare`**：留 monorepo，单独发布到 npm；cadquery 独立仓用 registry 引用。落地动作：纳入 `scripts/publish-all.ps1` 发布清单（当前仅在注释提及），cadquery 仓 devDeps 由 `file:../cq-compat-compare` 改为 `^<version>`。

### 9.2 本版定稿（原「待确认项」的选定方案）

**① CDN 三份产物（`cdn/importmap.json` / `versions.json` / `lib-meta.json`）的归属**

选定方案：**`gen-importmap.mjs` 职责不变，只覆盖 monorepo 家族；移出的两个包不再进入 monorepo 的 CDN 产物，其 CDN 加载由消费方自理。**

依据（均经实测）：
- 三份产物在仓库内**无运行时消费点**——`browser-lib-loader` 的 `versions` / `meta` 由外部 host 注入，仓库内没有任何 host 读取 `cdn/*.json`。
- demo 的 CDN 外置白名单**只含 `three` / `manifold-3d` / `occt-wasm`**（`packages/demo/vite.config.ts` 的 `EXACT_CDN` / `PREFIX_CDN` / `rollupOptions.external`），`@faicad/*` 一律被打包进 bundle，**不经过 CDN importmap**。
- freecad 是 Node CLI，本就无浏览器 CDN 场景。
- 若让 monorepo 手工代管移出包版本，会制造「版本事实的第二处家」，与 AGENTS「一个事实一个家」及 `check-lockstep` 防旧版本的精神冲突。

落地：阶段 3 移除两包后重跑 `node scripts/gen-importmap.mjs`，两包条目自动消失；`gen-importmap.mjs` 与 `check-lockstep` 规则 3 无需改（它们只扫描 workspace 成员）。cadquery 独立仓如需浏览器 CDN 消费：消费方在自身 importmap 直接声明，或走 plan-a（裸 specifier + jsDelivr `latest`）；独立仓可复用 `gen-importmap.mjs` 自产一份版本表。

**② npm 发布 gate（前置条件，非可选）**

实测（`npm view`）：`@faicad/faijs`、`@faicad/faijs-cadquery`、`@faicad/faijs-freecad` 均已发布到 **0.29.3**；`@faicad/cq-compat-compare` 返回 **E404（从未发布）**；仓库本地版本线为 **0.29.5（未发布）**。

选定方案：**阶段 3 前把 monorepo 当前版本线发布到位，并确保 `cq-compat-compare` 首次发布。** 发布顺序（拓扑）：

```
core → faijs-sketch → faijs-extra → cq-compat-compare → faijs-cadquery → faijs-freecad
```

落地：先把 `@faicad/cq-compat-compare` 加入 `scripts/publish-all.ps1` 清单（§7.3），再执行 `scripts/publish-all.ps1`（或按上序单发）。gate 判据：`npm view @faicad/faijs-cadquery version`、`... @faicad/faijs-freecad ...`、`... @faicad/cq-compat-compare ...` 均返回 ≥ 独立仓 peer range 所需版本，才可执行阶段 3 的依赖改写。注：独立仓 peerDeps 是 `^0.29.0`，registry 现有 0.29.3 即可满足安装；但为功能一致应发布到 0.29.5。

**③ 死 path 核实**

选定方案：**确认为死引用，直接删除。** 实测 `packages/faijs-gears/src/testing/compare.ts:17` 实际 `import { compareAssemblyFiles, ... } from '@faicad/cq-compat-compare'`，对 cadquery 的引用仅在注释（`:2,:5`）；`packages/cq-compat-compare/src` 全目录无 cadquery import。删除 `packages/faijs-gears/tsconfig.json:22`、`packages/cq-compat-compare/tsconfig.json:22-23` 的 cadquery path；`faijs-gears/package.json` 不补 cadquery 依赖。验证命令（应无输出）：

```bash
grep -rn "from '@faicad/faijs-cadquery'\|import('@faicad/faijs-cadquery')" packages/faijs-gears packages/cq-compat-compare
```