# Agent Note: 齿轮原语层（gears.ts）从 cq-compat 迁至 fai_cq_gears

Status: implemented

## Problem

`@faicad/fai-cq-gears` 在 npm 依赖图上挂着 `@faicad/cq-compat`，但两者其实是"兼容层"与"齿轮库"两个独立发布物——用户装齿轮库被迫连带装 cq-compat，使用不便。分析确认（2026-10-02）：fai_cq_gears 对 cq-compat 的全部运行时依赖收敛在一个文件 `cq-compat/src/gears.ts`（437 行，文件头自述"为 cq_gears 移植而生"），且 cq-compat 内部无任何其它代码引用它。`@faicad/fai-cq-warehouse` 运行时本就零依赖 cq-compat（仅 devDependency 的 cq-compat-compare 供测试比对）。

## Decision

把 `gears.ts` 整体迁入 `packages/fai_cq_gears/src/kernel/gears.ts`（git mv，逐字节保留，仅 `Vec3` 类型 import 从 cq-compat 的 `geom-types` 换为包内 `math.ts`——两者同为 `{x,y,z}` 同构类型）。配套：

- `fai_cq_gears/src/kernel/index.ts` 新建 barrel，承载原 cq-compat 齿轮 re-export 面；
- fai_cq_gears 25 个文件的 `from '@faicad/cq-compat'` 全部改为包内相对路径；package.json `dependencies` 清空；vitest.config.ts 删除 cq-compat alias；
- cq-compat 的 index.ts / browser.ts 删除齿轮 re-export（留迁移指路注释）。

`fai_cq_gears` 从此 peer 依赖只剩 `@faicad/faijs` + `occt-wasm`，与 warehouse 一致。

## 值得留档的 GOTCHA

- **stability 子目录 import 路径**：批量把 `from '@faicad/cq-compat'` 替换成 `from './kernel'` 时，`src/stability/` 下的三个文件应该是 `from '../kernel'`——typecheck（TS2307）会立刻抓住，但要记得子目录替换不是纯文本问题。
- **occt-wasm 直连红线保持不变**：迁移后红线（fai_cq_gears 只经 `getGearKernel()` 单例，不直接 touch occt-wasm）由包内 `kernel/` 注释继续承载，语义未变。
- **warehouse params 测试的环境性失败**（与本次迁移无关）：`src/params.test.ts` 的 34 表哈希断言会去读本机路径 `C:/git/CADQ/cq_warehouse/...` 的上游 CSV，`brad_tee_nut_parameters.csv` 的当前哈希（ebeeaca3…，2026-01-17 的文件）与 manifest 记录（eff4dedc…）不一致。这是上游数据/manifest 漂移的既有问题，非本次改动引起（本次未触碰任何数据文件）。修复方向：重跑 `gen-data.ts` 更新 manifest，或确认上游 CSV 被动过后回滚。

## Alternatives considered

- **独立小包 `@faicad/gear-kernel`**：多一个包就多一份 lockstep/发布负担；当前没有第三个 raw-kernel 消费者，弃。
- **fai_cq_gears 自写 kernel 拷贝**：违反"一个事实一个家"，双份漂移，弃。

## Consequences

- 齿轮库单独安装成为可能（`@faicad/faijs` + `occt-wasm` 即可）；cq-compat 回归纯 CadQuery 兼容层定位。
- 几何行为零变化：代码逐字节移动 + import 路径替换，gears 包 226 个用例（不含 stability）与 tests 集成 fai-cq-gears-flow 全部通过，偏差表数值与迁移前同量级。
- stability.test.ts（每类 20 种子 × 3 类 ≈ 60 次真实 BREP 构建，单文件常规 5–10 分钟）本次按用户指示跳过未跑。
