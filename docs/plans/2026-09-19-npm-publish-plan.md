# faijs monorepo 正式发布 npm 计划

> 日期：2026-09-19
> 状态：**实施中**——D1/D2-A/K5/D3-autoLift/D3-Node 已落地（node-cli `cliPortsLibLoader` + `readLibAutoLift` 已读各库 `package.json.faijs.autoLift`）；M4 peer 放宽、各包 peer/devDep 修复、E1 `publish-all.ps1`、E2 白名单断言均已落地并进入 dry-run 验证；D3-Browser a/b 混合（CDN_BASE=jsDelivr）已拍板，`scripts/gen-importmap.mjs` 已落地产出 `importmap.json`/`versions.json`/`lib-meta.json`，core 侧通用 `createBrowserLibLoader` 工厂待补（不破坏 demo HMR）。
> 背景：用户新要求推翻 AGENTS.md「不准发布到 npm」的旧铁律——faijs 及其子包（demo 相关除外）都要正式发布到 npm。fcstd-port 批量项目将直接从 npm 消费 `@faicad/faijs`，不再走 tgz。

---

## 1. 用户原始要求（原文引用）

> 你需要重写你的计划，faijs以及下面的子包（demo相关的除外），都需要正式发布到npm。你先写一个发布npm的计划

拆解为约束：

| 编号 | 约束 |
|---|---|
| C1 | 发布范围 = faijs monorepo 全部可发布包，**demo 相关除外** |
| C2 | 正式发布（公开 npm registry，非私有源——待确认，见 Q1） |
| C3 | 本计划先行；实施另启动 |

---

## 2. 发布范围盘点（2026-09-19 实测；同日拍板回填）

| 包 | npm 名 | 版本 | 当前 private | 判定 |
|---|---|---|---|---|
| 根门面（待 §9 决策，倾向废弃） | `@faicad/faijs` | 0.12.1 | **private: true** | **见 §9 D2**：建议 core 升格为 `@faicad/faijs`，本门面包删除 |
| core（升格为公开引擎包，见 §9） | `@faicad/faijs` → `@faicad/faijs` | 0.13.0 | 否 | **发布**（拟改名为 `@faicad/faijs`，cad 内置） |
| cq-compat | `@faicad/cq-compat` | 0.13.2 | 否 | **发布**（兼容主体：workplane/2D 绘图/体素/特征/选择器/变换/齿轮内核） |
| cq-compat-assembly（2026-09-22 拆包新增） | `@faicad/cq-compat-assembly` | 0.1.0 | 否 | **发布**（装配兼容层：buildAssembly/solve()/toCompound()/save()，封装 core 求解器） |
| cq-compat-compare（2026-09-22 拆包新增） | `@faicad/cq-compat-compare` | 0.1.0 | 否 | **发布**（dev-only 几何等价性比较器；禁止进入任何包运行时依赖链） |
| cq-compat-sketch（2026-09-22 拆包新增） | `@faicad/cq-compat-sketch` | 0.1.0 | 否 | **发布**（2D 约束草图域，当前骨架，按方案 Phase 2 填充） |
| gear-lib-demo | `@faicad/gear-lib-demo` | 0.5.13 | 否 | **不发布**（拍板：属于 demo，C1 排除） |
| mini_lathe | `@faicad/mini-lathe` | 0.1.0 | **private: true** | **移出 monorepo**（拍板：整包移植到 `D:/Faicad/cadquery-port/mini_lathe`，不再是 faijs 子包；其 npm 发布由 cadquery-port 项目自行决定） |
| fai_cq_gears | `@faicad/fai-cq-gears` | 0.1.0 | 否 | **发布** |
| fai_cq_warehouse | `@faicad/fai-cq-warehouse` | 0.1.0 | 否 | **发布** |
| sheetmetal | `@faicad/sheetmetal` | 0.1.0 | 否 | **发布** |
| fixtures | `@faicad/faijs-fixtures` | 0.5.8 | **private: true** | **不发布**（测试数据包，属测试基建） |
| tests | `@faicad/faijs-tests` | 0.5.9 | **private: true** | **不发布**（集成测试包） |
| demo | `@faicad/faijs-demo` | — | **private: true** | **不发布**（C1 明确排除） |

依赖拓扑（发布顺序必须满足，采 §9 D2-A 后简化为；2026-09-22 拆包后更新）：`faijs`（原 core，cad 内置）→ `cq-compat-compare`（仅 core）→ `cq-compat`（devDeps 依赖 compare）→ `cq-compat-assembly`（依赖 cq-compat）→ `cq-compat-sketch`（独立）→ 库包（fai_cq_gears / fai_cq_warehouse / sheetmetal；mini_lathe 已移出 monorepo）。gear-lib-demo 不发布。

---

## 3. 发布前必须补齐的缺口

### 3.1 包元数据缺口

| 编号 | 缺口 | 位置 | 修补 |
|---|---|---|---|
| M1 | 根包 `private: true` | 根 package.json | 删除该字段；core/库包无此字段已可发 |
| M2 | mini_lathe 无 `exports`、`files: ["src"]`、无 build script——它目前是「源码直发」形态，与其它包的 dist 形态不一致 | `packages/mini_lathe/package.json` | 按 gear-lib-demo 范式补：tsconfig.build + `files: ["dist"]` + exports + build script（或暂缓，见 Q3） |
| M3 | `repository.url` 指向 `gitcode.com/Faicad/faijs.git`，各库包**没有** repository/license/keywords/description | 各子包 | **已补（2026-09-19）**：5 个发布包统一加 `license=MIT`、`repository`、`description`、`keywords` |
| M4 | core 的 `peerDependencies: occt-wasm 3.8.4` 为**精确锁版**——npm 上 peer 过严会与宿主冲突 | `packages/core/package.json` | 建议放宽为 `^3.8.4`（wasm 二进制兼容性需实测后定，见 R-N3） |
| M5 | 根包 dependencies 里有 `@faicad/faijs: "*"`——发布后必须改为确定版本（`^0.13.0` 等），`*` 在 registry 上无法解析到 workspace 语义 | 根 package.json | 采 §9 D2-A 后根门面删除，本行作废；否则发布脚本统一注入 workspace 实际版本 |

### 3.2 工程缺口

| 编号 | 缺口 | 修补 |
|---|---|---|
| E1 | **无 CI 发布通道**：发布全靠本机手工 `npm publish` | 新增发布脚本 `scripts/publish-all.ps1`（拓扑序逐包 build+publish）+ 可选 GitHub Actions/AtomGit CI workflow |
| E2 | **无发布前校验**：npm pack 内容从未被审查过（dist 是否含测试文件、.map、探针脚本？） | 每包发前 `npm pack --dry-run` 审查 + 断言脚本（files 白名单核对） |
| E3 | **版本策略缺失**：现各包版本不齐（0.12.1 / 0.1.0 / 0.5.13） | 统一版本策略（见 §4） |
| E4 | **provenance / 双因素认证**：npm 正式包建议 provenance 签名 + 2FA | 发布账号开 2FA；CI 发发布带 `--provenance`（需 OIDC 支持的托管环境） |
| E5 | **AGENTS.md 铁律冲突**：现文档明文「本项目未上线，且不准发布到npm」 | 发布落地时同步修订 AGENTS.md 与 docs（避免文档与事实打架） |
| E6 | **无 npm 自动加载通道（§9 D3/D4）**：host 现写死包名（demo `LIB_MODULES` + vite alias），无按 specifier 动态解析的 `libLoader`，浏览器 importmap 无 `@faicad/*` 映射 | 实现 host 端 `libLoader`（Node `import(pkg)` / Browser importmap+动态 `import`）+ 构建期生成 `@faicad/*` importmap scope（或 `versions.json` 直链，见 §9.4 混合策略）+ 逐库 `autoLift` 约定字段；CDN 后端取国内可达源（见 C-CDN / R-N8）；runtime 自动注册已具备（`runtime.ts:971`） |

---

## 4. 版本策略（建议：fixed 统一版本）

monorepo 包间强耦合（根门面 re-export core 全量 API），独立版本号管理成本高。建议：

- **全部可发布包统一同号**（fixed/lockstep）：当前一起升到 `0.13.0`（minor 升级，因 fcstd-convert CLI 是新增能力）；
- peerDependencies 对 `@faicad/faijs`/`@faicad/faijs` 锁同号 minor 范围（`^0.13.0`）；
- 发布脚本一次校验全部包版本一致，不一致即拒绝发布；
- 后续可用 changesets 管理升级日志（可选，非必需，见 Q5）。

---

## 5. 发布流程设计

### 5.1 一次性准备（P0）

1. npm 账号 + `@faicad` scope 组织确认（组织是否存在、谁有发布权，见 Q1）；
2. 各包补元数据（§3.1 M1–M5）；
3. `npm pack --dry-run` 全包审查，产出「每包最终 tarball 清单」留档；
4. AGENTS.md / docs 修订（E5）。

### 5.2 每次发布（P1 例行）

```
scripts/publish-all.ps1 [--dry-run] [--tag next]
  1. 版本一致性检查（全部包同号）
  2. npm run ci（全量门禁：lint/typecheck/build/test/守卫/demo e2e）
  3. 按拓扑序逐包：npm publish --access public --provenance
     faijs（原 core，cad 内置）→ cq-compat → gear-lib-demo → fai_cq_gears
         → fai_cq_warehouse → sheetmetal → mini_lathe
  4. 逐包 npm view 校验版本落库
  5. 产出发布记录（版本、时间、tarball sha512）
```

- 首次发布建议 `--tag next`，冒烟验证后再 `npm dist-tag add ...@latest` 转正；
- `--dry-run` 模式只跑 1–3 的检查不真发。

### 5.3 发布后验证

1. 空目录 `npm install @faicad/faijs` 独立消费冒烟：`createRuntime` + 一个 box+union 脚本跑通（Node 侧）；
2. fcstd-port 切换为 npm 依赖（`npm install @faicad/faijs`），跑 10 文件小批量对照 tgz 时代结果；
3. 浏览器侧：demo/playground 经 importmap（`CDN_BASE/*@faicad/` scope 或 `versions.json` 直链）动态 `import()` 已发布包路径可用；验证前先确认 `CDN_BASE`（C-CDN 选定源）在大陆网络可达（取代原 esm.sh/unpkg 裸链）。

---

## 6. 风险登记

| 编号 | 风险 | 影响 | 对策 |
|---|---|---|---|
| R-N1 | `@faicad` scope 在 npm 上已被他人占用 | 高（scope 占用即无法发布） | P0 第一步 `npm org` 核实；被占则需换 scope（牵动全部 import，代价极大，必须最先确认） |
| R-N2 | tarball 夹带不该发布的内容（探针脚本、测试 fixture、语料路径） | 高（泄密/体积） | E2 审查 + files 白名单断言 |
| R-N3 | occt-wasm peer 放宽后宿主装了不兼容版本 | 中 | 实测 3.8.x 系列兼容性后再定范围；保守可保持精确锁版 |
| R-N4 | license 未定（Apache-2.0 是根包现值，但 vendored 代码 planegcs/OCCT wasm 的许可义务未梳理） | 高（法律） | 发布前梳理 vendored 第三方许可清单（planegcs LGPL？OCCT LGPL-2.1-with-exception？）并写 NOTICE；见 Q4 |
| R-N5 | 发布后 npm 上版本不可撤销（unpublish 有 72h 窗口且苛刻） | 中 | 一切先 `--dry-run` + next tag 冒烟 |
| R-N6 | demo CDN 外链 importmap 版本漂移（原手写同步） | 低 | 采 §9.4 方案 b（`versions.json`）后由构建期生成精确 pin，自动消除两处漂移；dev 走 a 时由 CI 发包末尾校验 `CDN_BASE` 版本 |
| R-N8 | 浏览器自动加载依赖公网 CDN（esm.sh/jsDelivr），大陆网络下可能慢/被墙 | 高（runtime 动态 `import()` 直接失败，库加载不出） | 约束 C-CDN：默认不裸用 esm.sh，改用 jsDelivr 国内镜像或自建/内网托管 `@faicad/*` ESM 构建；离线/内网场景降级为打包器预 bundle（宿主 `npm install @faicad/faijs` + vite/webpack 从 `node_modules` 解析，根本不需要 importmap） |

---

## 7. 待拍板项

| 编号 | 问题 | 建议 |
|---|---|---|
| Q1 | npm registry：公开 npmjs.com 还是私有源？`@faicad` scope 组织是否已存在 | 公开 npmjs.com（正式发布的字面含义）；scope 必须最先核实 |
| Q2 | `@faicad/gear-lib-demo` 名带 demo，是否发布 | **已拍板（2026-09-19）：不发布**，属于 demo |
| Q3 | `mini_lathe` 是否本期一起发布（需先补 dist 构建形态） | **已拍板（2026-09-19）：移出 monorepo**，整包移植到 `D:/Faicad/cadquery-port/mini_lathe`；不再出现在本计划发布清单 |
| Q4 | license 最终定什么（根包现值 Apache-2.0；vendored 代码义务需梳理） | 需要法律层面确认后再定；P0 只做清单梳理不动 license 字段 |
| Q5 | 是否引入 changesets（版本日志工具） | 建议首期不上，手工 CHANGELOG 起步 |
| Q6 | 首发版本号：统一升 `0.13.0` 还是维持各包现版 | 建议统一 0.13.0（lockstep 起步） |
| Q7 | 门面折叠采 D2-A（core 改名 `@faicad/faijs`）还是 D2-B（保留门面纯透传） | 推荐 D2-A，彻底消除冗余 |
| Q8 | 浏览器 importmap 采 esm.sh scope（§9.4-a）还是 versions.json 直链（§9.4-b） | **已定稿为 a/b 混合 + CDN_BASE 拍板（2026-09-19）：`CDN_BASE` = jsDelivr 国内镜像 `https://cdn.jsdelivr.net/npm/`**（ESM 取 `+esm`）；dev 走 a（scope）、release 走 b（versions.json pin），共用此 base |
| Q9 | K5（引擎零函数知识）在 cad 内置 core 后是否仍成立 | 已澄清：cad 经 `registerLib` 同构注册，引擎不特判，K5 不被违反；§9.2 已纠正「放弃 K5」的误读 |

---

## 8. 与既有计划的关系

- 本计划**取代** batch-convert 方案 §5.3 的「禁发 npm、走 tgz」交付方式：fcstd-port 改为从 npm 消费 `@faicad/faijs`，版本追溯直接用 npm 版本号；
- batch-convert 的其余部分（硬骨头清单、批量驱动器、C4 终检）不变；
- AGENTS.md 的「不准发布到 npm」条款在 P0 修订（E5）。

---

## 9. 包架构再设计：门面去留 / cad 命名空间归属 / npm 自动加载（通盘）

> 用户原话（2026-09-19）：
> - 「faijs包本身没有作用呀，只是一个名称注入的话，调用方完全可以自己干呀？」
> - 「这个项目之前没有发布到npm，也就没有考虑过包的自动加载。所以包名的加载，都是host端自己写死的，具体可以参考demo项目。我需要把这个问题一起搞定。要能够自动加载npm包。」
> - 「如果core包可以通过npm自动加载，host宿主是否可以自动注册。还有cad这个命名空间，是否是默认的，如果是，似乎可以放入core包呀」
>
> 本节把三件事通盘纳入发布计划：① faijs 门面是否冗余；② cad 命名空间是否应内置 core；③ host 能否按 npm specifier 自动加载并自动注册第三方库。

### 9.1 现状实证（已查代码）

| 现象 | 证据 | 结论 |
|---|---|---|
| 门面仅做 cad 注入 + `export *` | `src/index.ts:10` `export * from '@faicad/faijs'`；`src/index.ts:34` `rt.registerLib('cad', createApiNamespace(), {default:true, packageName:'@faicad/faijs'})` | 门面无独有逻辑，调用方确实可自注入 cad |
| `cad` 是 runtime 默认绑定名 | `packages/core/src/cad-runtime/runtime.ts:359` `private defaultNsName = 'cad'`（缺省即 cad） | cad 在语义上已是「默认命名空间」 |
| cad 内容由门面注册，非 core | 全 core 无 `registerLib('cad', ...)` 自调用；`runtime.ts:365` 注释「the root facade injects it」 | cad 的「名字默认 + 内容靠门面注入」是割裂的 |
| 平台入口隔离 core 自身已有 | `core/index.ts:245-248` 注释 node-host 已移出默认入口；`core/browser.ts` 不含 node-host；`core/node.ts` 含 node-host | 隔离不在门面，而在 core 内部——门面 `./browser`/`./node` 只是透传 |
| 自动装载 + 自动注册 runtime 已具备 | `ports.ts:175-211` `LibLoader`（`loadLib`/`listLibs`/`autoLiftFor`）；`runtime.ts:943-977` `autoLoadLibsFromImports` 按 import specifier 调 `loadLib` 并自动 `registerLib` | **机制已实现，缺的只是 host 端 loader** |
| host 把包名写死 | `packages/demo/main.ts:28-48` 静态 `import * as gearLib from '@faicad/gear-lib-demo'` 等 + 手写 `LIB_MODULES` 映射；`packages/demo/vite.config.ts:103-114` 把每个 `@faicad/*` 写死 alias 落位源码；`packages/demo/index.html` importmap 仅含 three/manifold/occt，无 `@faicad/*` | 用户判断准确：当前无任何包来自 npm 动态解析，全是 host 硬编码 |

### 9.2 决策 D1：cad 命名空间归入 core（默认库内置化）

- **动作**：新增 `cad-runtime/createRuntimeWithCad.ts` 包装 `createRuntimeCore` 并自调 `registerLib('cad', createApiNamespace(), { default: true, packageName: '@faicad/faijs' })`；core 的 `index.ts`/`browser.ts`/`node.ts` 均从该包装导出 `createRuntime`；原根门面 `src/index.ts` 注入已删除，根 `src/` 门面目录已移除（D2-A）。
- **K5 不被违反（纠正此前误读）**：K5「引擎零函数知识」的本意是「引擎不按函数名分支、函数信息统一为数据」。cad 经 `defineOp` 注册为均匀库数据、与第三方库走完全相同的 `registerLib` 路径，引擎并未对 cad 特判——因此 cad 内置**不构成 K5 违反**，此前方案里「放弃 K5 字面纯度」的提法不成立。库作者仍只 `import type`/取符号自 `@faicad/faijs/api`（纯类型/常量，无运行时 cad 依赖），强制依赖从未产生。K5 实质与字面都保留。
- **收益**：cad 从「门面责任」变为「引擎默认能力」，与 `defaultNsName='cad'` 的既有默认一致，消除「名字默认、内容外挂」的割裂。

### 9.3 决策 D2：门面包去留（两选一，推荐 D2-A）

门面现在三件「独有」功能已全部可被 core 替代：cad 注入（D1）、平台入口隔离（core 已有）、`export *`（纯透传）。故门面无存在必要。

- **D2-A（推荐）：core 直接以 `@faicad/faijs` 名义发布，废弃独立 `@faicad/faijs` 包。**
  - 仓库内把 `packages/core` 的 `package.json` `name` 改为 `@faicad/faijs`（版本随之 `0.13.0`），根门面目录 `src/` + 根 `package.json` 删除或降为 private 聚合器。
  - 全部库/宿主里 `@faicad/faijs/api` → `@faicad/faijs/api`、`@faicad/faijs` → `@faicad/faijs`（含 `/browser` `/node` `/mesh/*` 等子路径，core 的 exports 已覆盖）。
  - 这直接回应「faijs包本身没有作用呀」——把作用并入 core，公开名 `@faicad/faijs` 保留给消费者。
- **D2-B（保守）：保留 `@faicad/faijs` 门面包，退化为纯 `export * from '@faicad/faijs'`（不再注入 cad）。** cad 由 core 注入（D1）。门面仅作「友好公共名 + 平台入口别名」。代价：仍双包、仍要 lockstep 版本同步（§4）、M5 仍需处理。

### 9.4 决策 D3：npm 自动加载（落地 libLoader）

runtime 已支持自动装载（§9.1 证据），缺口是 host 端 `libLoader` 实现与浏览器 importmap 生成。

- **D3-Node**：`loadLib = (pkg) => import(pkg)`。Node 从 `node_modules` 解析已装包，零额外工作。
- **D3-Browser**：按 specifier 动态 `import()`，由 importmap 把 `@faicad/*` 映射到 CDN。
  - **⚠️ 约束 C-CDN（国内可达性）**：本环境（中国、GitHub 间歇阻断、npm 走国内镜像）下，裸 `esm.sh`（Cloudflare CDN）在大陆常慢/被墙。a/b 两份方案都隐含依赖公网 CDN，必须把取版后端换成**对国内更稳的源**——优先 jsDelivr（含国内镜像）/ 自建或内网托管的 `@faicad/*` ESM 构建，**不得裸用 esm.sh**。下文中 `CDN_BASE` 即指 C-CDN 选定的源（建议在 Q8 拍板时一并定）。**【已拍板 2026-09-19】`CDN_BASE` = jsDelivr 国内镜像 `https://cdn.jsdelivr.net/npm/`；ESM 经 `+esm` 取（如 `https://cdn.jsdelivr.net/npm/@faicad/faijs@0.13.0/+esm`）；dev 走 a（scope）、release 走 b（versions.json pin），共用此 base。**
  - 方案 a（默认；dev / playground 用）：构建期扫描已装 `@faicad/*`，生成 importmap 的 scope 条目 `"@faicad/": "CDN_BASE/*@faicad/"`（后端按依赖图自动取版），取代 demo 手写 three/manifold/occt 版本与逐库 alias（`vite.config.ts:103-114`）。
  - 方案 b（release 兜底；pin 精确版）：构建期生成 `versions.json`（列出已装 `@faicad/*` 的 resolved 版本），loader 拼 `import(CDN_BASE + pkg + '@' + versions[pkg])`，版本精确 pin 到 installed 版本，保证可复现与缓存命中。
  - **混合策略（采纳）**：dev/playground 走 a 省维护（零版本表）；**CI 发包渠道走 b**，由构建期生成 `versions.json` 精确 pin，作为 release 产物。两者共用同一 `CDN_BASE`（C-CDN）。
  - 取代 demo 写死的 `LIB_MODULES`（`main.ts:39-48`）与 `autoLiftFor`（`main.ts:62`）。
  - **落地文件（2026-09-19）**：
    - `scripts/gen-importmap.mjs`：构建期扫描 `packages/*` 下可发布 `@faicad/*`，产出三份产物到 `--out`（默认 `cdn/`）：`importmap.json`（方案 a，逐库 latest `+esm`）、`versions.json`（方案 b，精确 pin 版）、`lib-meta.json`（逐库 `faijs.autoLift` 外置字段）。`CDN_BASE` 取 `--cdn-base` 或 env `CDN_BASE` 或默认 jsDelivr。
    - core 通用浏览器 loader 工厂 `packages/core/src/cad-runtime/browser-lib-loader.ts` 导出 `createBrowserLibLoader(opts)`：`versions` 提供时走方案 b（拼 `CDN_BASE + pkg + '@' + version + '/+esm'` 直链），否则走方案 a（裸 `import(pkg)` 依赖 importmap）；`options.autoLiftFor` 由 host 从 `lib-meta.json` 构建。**不破坏 demo 的 HMR 静态 alias 路径**（demo 仍走源码，loader 仅服务 CDN 发布消费场景）。**已落地（2026-09-19）**，实测行为：① 短名别名归一（`gear-lib-demo` → `@faicad/gear-lib-demo`，与 node 侧 `CLI_LIB_ALIASES` 同职责）；② `libs` 白名单按**归一后包名**校验；③ 同包并发/重复装载共享 in-flight promise（CDN 只取一次），失败不留毒缓存可重试；④ `autoLiftFor` 为同步回调，故逐库值须由 `meta` 预先给出，另提供 `prefetchMeta()`（抓各库 `package.json` 的 `faijs.autoLift`）预热，网络失败静默回落推断式；⑤ 经 `packages/core/src/browser.ts` + `index.ts` 双入口导出，**不被 `createBrowserPorts` 默认装配**（保证 demo HMR 路径零网络）。防回归测试 `packages/core/src/cad-runtime/browser-lib-loader.test.ts`（15 用例，全注入不触网）。
  - **D3-Node + D3-autoLift 已落地**：`packages/core/src/node-host/cli.ts` 的 `cliPortsLibLoader` 已实现 `loadLib = (pkg) => import(pkg)`（白名单），`readLibAutoLift(pkg)` 读各库 `package.json.faijs.autoLift` 喂给 `autoLiftFor`，cq-compat 已声明 `autoLift:false`。
- **D3-autoLift 配置外置**：逐库 `autoLift` 约定写入各包 `package.json`（如 `"faijs": { "autoLift": false }`，cq-compat 需 false），loader 读取后喂给 `libLoader.options.autoLiftFor`，取代 host 写死的判定。

### 9.5 决策 D4：host 自动注册（核心结论——可以）

- **cad**：core 自注册（D1），host 零动作。
- **第三方库**：脚本 `import * as x from '@faicad/fai-x'` → `autoLoadLibsFromImports` 在 execute 阶段调 `libLoader.loadLib('@faicad/fai-x')` → 自动 `registerLib(localName, ns, {packageName})`（`runtime.ts:971`）。host 完全不用预先 `registerLib` 或维护 `LIB_MODULES`。
- **因此 host 不再写死任何库**——这正是用户要的「自动加载 + 自动注册」。demo 的 `LIB_MODULES`/`autoLiftFor` 整段可删，改为提供通用 `libLoader`（Node：动态 import；Browser：importmap + 动态 import）。

### 9.6 对发布计划其余章节的影响

- **§2 发布范围**：采 D2-A 后，`@faicad/faijs` 行合并进 `@faicad/faijs`（core 升格）；发布清单少一个包，依赖拓扑简化为 `faijs → 库包`。M5（`@faicad/faijs: '*'`）随门面删除而自然消失。
- **§3.2 新增 E6**：host 端 `libLoader` 实现（Node/Browser）+ 浏览器 importmap 自动生成 + 逐库 autoLift 约定字段。
- **§5.2 拓扑**：发布顺序去掉独立的 `faijs` 步（core 即 faijs）。
- **§6 风险**：新增 R-N7「cad 内置 core 后，core 包体含标准库，第三方库若误用运行时 cad 符号会隐性耦合」——缓解：库仅取类型，CI 守卫 `check-ghost-deps` 已覆盖（AGENTS.md）。

### 9.7 待拍板（新增 Q7–Q9）

| 编号 | 问题 | 建议 |
|---|---|---|
| Q7 | 门面折叠采 D2-A（core 改名 `@faicad/faijs`）还是 D2-B（保留门面纯透传） | 推荐 D2-A，彻底消除冗余 |
| Q8 | 浏览器 importmap 采 esm.sh scope（§9.4-a）还是 versions.json 直链（§9.4-b） | **已定稿为 a/b 混合 + CDN_BASE 拍板（2026-09-19）：`CDN_BASE` = jsDelivr 国内镜像 `https://cdn.jsdelivr.net/npm/`**（ESM 取 `+esm`）；dev 走 a（scope）、release 走 b（versions.json pin），共用此 base |
| Q9 | K5（引擎零函数知识）在 cad 内置 core 后是否仍成立 | 已澄清：cad 经 `registerLib` 同构注册，引擎不特判，K5 不被违反；§9.2 已纠正「放弃 K5」的误读 |
