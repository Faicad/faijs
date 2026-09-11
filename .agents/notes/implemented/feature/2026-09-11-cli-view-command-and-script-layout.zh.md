# Agent Note: faijs-cli view 命令与脚本布局

Status: implemented

[English](2026-09-11-cli-view-command-and-script-layout.md) | 中文

## 问题

1. 视图投影 op（`projectView`/`projectSheet`/`viewCamera`，随视图投影方案落地）只作为库 API 存在。用户的需求是一个脚本：传入 `.fai.js` 文件名，产出视图 SVG。CLI 已有 `check` 和 `run`，但没有 `view` 命令。
2. 脚本已经长出两个家族——第三方入口 `packages/core/scripts/faijs-cli.ts` 与仓库自用的 doc/ci/开发脚本（根 `scripts/` 加 `packages/core/scripts/gen-*`）——但这一划分没有文档记录。`docs/analysis/2026-08-30-scripts-reference.md` 只覆盖根 `scripts/`，且不存在 `scripts/README.md` 来标明边界。

## 决策

### CLI 增加 `view` 命令

- `cli.ts` 增加第三个命令：`faijs-cli view <file.fai.js> --out <x.svg>`，选项 `--view <front|back|top|bottom|left|right|iso|"x,y,z">`（单视图，缺省 `front`）、`--sheet <front,top,right,iso>`（多视图图纸，与 `--view` 互斥）、`--part <name>`（只投影指定 shape 变量；缺省按终端自动选择，同 `run`）。
- `cliView(filePath, outPath, opts)` 是可测试逻辑：读取并执行脚本（CLI ports：project loader、lib loader），选出可投影（带 mesh）的 shape，宿主侧调 `projectView`/`projectSheet`，把 SVG 字符串写盘。多个 shape 时每个终端产出一个文件（`<out>_<i>_<name>.svg`）。
- 视图输出依赖 BREP 路径：前置 `await initOcctWasm()`，mesh-only shape 直接抛 `E_BREP_ONLY_INPUT`（无运行时回退，遵循静态规则红线）。

### 脚本布局文档化

- 新增 `scripts/README.md` 声明边界：`packages/core/scripts/faijs-cli.ts` 是第三方入口（`cliMain` 的薄外壳）；根 `scripts/` 与 `packages/core/scripts/gen-*` 是仓库自用（CI、doc 门禁、翻译、生成器），逐脚本细节链接 `docs/analysis/2026-08-30-scripts-reference.md` 而不重复。
- `cli.ts` 头注释写明同一划分，让后续贡献者在入口处即看到。

## 备选方案（未采纳）

- **把 CLI 逻辑直接写进 `faijs-cli.ts`。** 否决：逻辑必须保持可导入、可单元测试（既有 `check`/`run` 模式）；入口保持为 `process.argv` 薄外壳。
- **只暴露 `projectSheet`（不提供单视图命令）。** 否决：单视图 SVG 是用户的首要需求（一个零件一张图纸）；多视图图纸是叠加选项。
- **在 `scripts/README.md` 里写完整脚本说明。** 否决：一个事实一个家——根 `scripts/` 的细节已存在于 `docs/analysis/2026-08-30-scripts-reference.md`；README 只链接，不重复。

## 影响

- `npx tsx packages/core/scripts/faijs-cli.ts view <file.fai.js> --out <x.svg> [--view|--sheet] [--part]` 端到端可用。已用居中 box 验证：`--view iso` 产出有效 SVG，含可见实线路径、隐藏 `stroke-dasharray` 虚线、正确 viewBox。
- `view` 需要 BREP 路径；mesh-only shape 以 `E_BREP_ONLY_INPUT` 快速失败（测试断言不写输出文件）。
- CLI 解析接受 `"x,y,z"` 方向串为 `ViewSpec` 对象（如 `--view 1,-1,1`）。
- 测试：`cli.test.ts` +10（parseArgs view/sheet/part ×2、单视图 viewBox、iso 隐藏线、多视图图纸标签、`--part`、多终端文件命名、mesh 模式报错、非法视图、缺 part）；`cli.test.ts` + `view.test.ts` 合计 40 个测试全绿，core 全量与集成全量绿。
