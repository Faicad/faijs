# faijs monorepo 正式发布 npm 计划

> 日期：2026-09-19
> 状态：**方案（未实施）**——用户明确说开始实施后才动代码
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
| 根门面 | `@faicad/faijs` | 0.12.1 | **private: true** | **发布**（去 private） |
| core | `@faicad/faijs-core` | 0.12.1 | 否 | **发布** |
| cq-compat | `@faicad/cq-compat` | 0.1.0 | 否 | **发布** |
| gear-lib-demo | `@faicad/gear-lib-demo` | 0.5.13 | 否 | **不发布**（拍板：属于 demo，C1 排除） |
| mini_lathe | `@faicad/mini-lathe` | 0.1.0 | **private: true** | **移出 monorepo**（拍板：整包移植到 `D:/Faicad/cadquery-port/mini_lathe`，不再是 faijs 子包；其 npm 发布由 cadquery-port 项目自行决定） |
| fai_cq_gears | `@faicad/fai-cq-gears` | 0.1.0 | 否 | **发布** |
| fai_cq_warehouse | `@faicad/fai-cq-warehouse` | 0.1.0 | 否 | **发布** |
| sheetmetal | `@faicad/sheetmetal` | 0.1.0 | 否 | **发布** |
| fixtures | `@faicad/faijs-fixtures` | 0.5.8 | **private: true** | **不发布**（测试数据包，属测试基建） |
| tests | `@faicad/faijs-tests` | 0.5.9 | **private: true** | **不发布**（集成测试包） |
| demo | `@faicad/faijs-demo` | — | **private: true** | **不发布**（C1 明确排除） |

依赖拓扑（发布顺序必须满足）：`core` → 根门面 `faijs` → 库包（cq-compat / gear-lib-demo / fai_cq_gears / fai_cq_warehouse / sheetmetal / mini_lathe）。

---

## 3. 发布前必须补齐的缺口

### 3.1 包元数据缺口

| 编号 | 缺口 | 位置 | 修补 |
|---|---|---|---|
| M1 | 根包 `private: true` | 根 package.json | 删除该字段；core/库包无此字段已可发 |
| M2 | mini_lathe 无 `exports`、`files: ["src"]`、无 build script——它目前是「源码直发」形态，与其它包的 dist 形态不一致 | `packages/mini_lathe/package.json` | 按 gear-lib-demo 范式补：tsconfig.build + `files: ["dist"]` + exports + build script（或暂缓，见 Q3） |
| M3 | `repository.url` 指向 `gitcode.com/Faicad/faijs.git`，各库包**没有** repository/license/keywords/description | 各子包 | 补齐 npm 包页必需字段；license 需用户拍板（见 Q4） |
| M4 | core 的 `peerDependencies: occt-wasm 3.8.4` 为**精确锁版**——npm 上 peer 过严会与宿主冲突 | `packages/core/package.json` | 建议放宽为 `^3.8.4`（wasm 二进制兼容性需实测后定，见 R-N3） |
| M5 | 根包 dependencies 里有 `@faicad/faijs-core: "*"`——发布后必须改为确定版本（`^0.13.0` 等），`*` 在 registry 上无法解析到 workspace 语义 | 根 package.json | 发布脚本统一注入 workspace 实际版本 |

### 3.2 工程缺口

| 编号 | 缺口 | 修补 |
|---|---|---|
| E1 | **无 CI 发布通道**：发布全靠本机手工 `npm publish` | 新增发布脚本 `scripts/publish-all.ps1`（拓扑序逐包 build+publish）+ 可选 GitHub Actions/AtomGit CI workflow |
| E2 | **无发布前校验**：npm pack 内容从未被审查过（dist 是否含测试文件、.map、探针脚本？） | 每包发前 `npm pack --dry-run` 审查 + 断言脚本（files 白名单核对） |
| E3 | **版本策略缺失**：现各包版本不齐（0.12.1 / 0.1.0 / 0.5.13） | 统一版本策略（见 §4） |
| E4 | **provenance / 双因素认证**：npm 正式包建议 provenance 签名 + 2FA | 发布账号开 2FA；CI 发发布带 `--provenance`（需 OIDC 支持的托管环境） |
| E5 | **AGENTS.md 铁律冲突**：现文档明文「本项目未上线，且不准发布到npm」 | 发布落地时同步修订 AGENTS.md 与 docs（避免文档与事实打架） |

---

## 4. 版本策略（建议：fixed 统一版本）

monorepo 包间强耦合（根门面 re-export core 全量 API），独立版本号管理成本高。建议：

- **全部可发布包统一同号**（fixed/lockstep）：当前一起升到 `0.13.0`（minor 升级，因 fcstd-convert CLI 是新增能力）；
- peerDependencies 对 `@faicad/faijs`/`@faicad/faijs-core` 锁同号 minor 范围（`^0.13.0`）；
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
     core → faijs → cq-compat → gear-lib-demo → fai_cq_gears
         → fai_cq_warehouse → sheetmetal → mini_lathe
  4. 逐包 npm view 校验版本落库
  5. 产出发布记录（版本、时间、tarball sha512）
```

- 首次发布建议 `--tag next`，冒烟验证后再 `npm dist-tag add ...@latest` 转正；
- `--dry-run` 模式只跑 1–3 的检查不真发。

### 5.3 发布后验证

1. 空目录 `npm install @faicad/faijs` 独立消费冒烟：`createRuntime` + 一个 box+union 脚本跑通（Node 侧）；
2. fcstd-port 切换为 npm 依赖（`npm install @faicad/faijs`），跑 10 文件小批量对照 tgz 时代结果；
3. 浏览器侧：demo 的 importmap 指向 esm.sh/unpkg 上已发布的包路径可用（demo 构建外链 CDN，发布后 CDN 自动可见）。

---

## 6. 风险登记

| 编号 | 风险 | 影响 | 对策 |
|---|---|---|---|
| R-N1 | `@faicad` scope 在 npm 上已被他人占用 | 高（scope 占用即无法发布） | P0 第一步 `npm org` 核实；被占则需换 scope（牵动全部 import，代价极大，必须最先确认） |
| R-N2 | tarball 夹带不该发布的内容（探针脚本、测试 fixture、语料路径） | 高（泄密/体积） | E2 审查 + files 白名单断言 |
| R-N3 | occt-wasm peer 放宽后宿主装了不兼容版本 | 中 | 实测 3.8.x 系列兼容性后再定范围；保守可保持精确锁版 |
| R-N4 | license 未定（Apache-2.0 是根包现值，但 vendored 代码 planegcs/OCCT wasm 的许可义务未梳理） | 高（法律） | 发布前梳理 vendored 第三方许可清单（planegcs LGPL？OCCT LGPL-2.1-with-exception？）并写 NOTICE；见 Q4 |
| R-N5 | 发布后 npm 上版本不可撤销（unpublish 有 72h 窗口且苛刻） | 中 | 一切先 `--dry-run` + next tag 冒烟 |
| R-N6 | demo CDN 外链 importmap 的版本号是手写同步的，发布后两处版本漂移 | 低 | 发布脚本末尾检查 demo 的 importmap 版本并提醒更新 |

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

---

## 8. 与既有计划的关系

- 本计划**取代** batch-convert 方案 §5.3 的「禁发 npm、走 tgz」交付方式：fcstd-port 改为从 npm 消费 `@faicad/faijs`，版本追溯直接用 npm 版本号；
- batch-convert 的其余部分（硬骨头清单、批量驱动器、C4 终检）不变；
- AGENTS.md 的「不准发布到 npm」条款在 P0 修订（E5）。
