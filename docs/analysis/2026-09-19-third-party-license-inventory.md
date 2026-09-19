# 第三方许可清单（Q4 梳理，2026-09-19）

> 对应发布计划 R-N4：发布前梳理 vendored / 依赖的第三方许可义务。
> 结论：**5 个发布包的 MIT 标注与实际义务不匹配，发布前必须修正**。

## 1. 许可清单（运行时随包分发的组件）

| 组件 | 许可 | 进入 tarball 的方式 | 义务 |
|---|---|---|---|
| faijs 自有代码 | MIT（5 包 package.json 现值） | 全部源码编译产物 | 保留版权声明 |
| vendored/brepjs | **Apache-2.0**（上游 https://github.com/OpenCascade/brepjs，锁 commit 8685273a） | `dist/vendored/**` 编译产物 | 保留其 NOTICE/版权标注；Apache-2.0 要求随分发附许可文本 |
| occt-wasm 3.8.4 | **JS 胶水: MIT OR Apache-2.0；WASM 二进制: LGPL-2.1-only**（继承 OCCT） | **不进 tarball**（peerDependency，由宿主安装/CDN 加载） | LGPL 替换义务由 README 已述方案满足（wasm URL 可被宿主覆盖，`OcctKernel.init({ wasm: '...' })`）；包内 NOTICE 需声明该 peer 的许可 |
| manifold-3d 3.5.1 | Apache-2.0 | peerDependency，不进 tarball | 无嵌入义务 |
| @salusoft89/planegcs 1.2.0 | **LGPL-2.0-or-later** | **不得进 tarball**——仅 `src/fcstd`（WIP，已排除出发布构建）引用 | 若留在 dependencies 会误导（npm 会连带安装）；见 §2 处置 |

## 2. 发现的问题与处置

### 2.1 包 license 字段与 vendored Apache-2.0 冲突（必须修）

`packages/core/src/vendored/brepjs/NOTICE` 明确写着 faijs root 与 `@faicad/faijs`
为 **Apache-2.0**（SLIC window, O13），但 5 个发布包 package.json 现值均为 **MIT**。
二者取其一：

- 方案 a（维持 MIT）：MIT 与 Apache-2.0 代码混合分发是允许的（Apache 兼容 MIT，
  MIT 宽松于 Apache），但 core 包必须保留 vendored/brepjs 的 Apache-2.0 attribution
  （NOTICE 文件随包分发），且 NOTICE 中「faijs is Apache-2.0」的表述要改；
- 方案 b（改回 Apache-2.0）：与 NOTICE 一致，但对消费者（3d_editor 等内部项目）
  更重。

**建议**：方案 a——package.json 保持 MIT，core 包补 `NOTICE`（files 白名单已含
dist/，NOTICE 放包根即可被 npm 打进 tarball），内容 = 现 vendored NOTICE +
occt-wasm wasm 部分 LGPL-2.1 声明 + planegcs 不随包声明（若 §2.2 采纳）。

### 2.2 planegcs（LGPL）仍挂 core dependencies（必须修）

`@salusoft89/planegcs` 仅被 `src/fcstd/*` 引用，而 fcstd 已从发布构建排除
（3065d61），但它还在 `packages/core/package.json` 的 `dependencies` 里——
npm 安装 @faicad/faijs 会连带安装 LGPL 包，即使代码不用。处置：
移到 `optionalDependencies` 或干脆移出（fcstd 落地时再加回并评估 LGPL 义务）。

### 2.3 dist 残留 fcstd 编译产物（已修）

`packages/core/dist/fcstd/**`（60 文件，含 planegcs-backend）是 3065d61 排除前
的旧构建残留，曾在 tarball 里。已 `rm -rf dist` 全量重建，复测 tarball 0 个
fcstd 文件。

## 3. 复核清单（发布前最后过一遍）

- [ ] core 包根新增 NOTICE（Apache-2.0 attribution + occt-wasm LGPL 声明）
- [ ] planegcs 移出 core dependencies（或 optionalDependencies）
- [ ] `npm pack --dry-run` 复查：无 fcstd / 无 test 产物 / NOTICE 在列
