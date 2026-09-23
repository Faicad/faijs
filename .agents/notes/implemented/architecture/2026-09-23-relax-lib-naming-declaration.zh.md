# Agent Note：废除库面命名声明（2026-09-23）

状态：已实施

[English](2026-09-23-relax-lib-naming-declaration.md) | 中文

## 决策记录

1. **用户裁决**：库作者不需要声明面命名。用户原话：「给我改掉这个设计。库作者不需要申明这个东西」；「这两层都很可疑：package.json faijs.naming/namingFor。一个库，几何实体和零件各种各样，怎么可能申明这种垃圾。哪个所谓的申明，明显只适合op」。
2. **旧设计错在哪**：库是黑盒零件生产者——一个包声明几十个产出不同零件（spurGear / flange / washer…）的函数，一个库级 `faijs.naming`（或函数级 `fn.naming`）承载不了任何信息。六类 Provenance（kernel/construct/identity/subdivide/replicate/unmodeled）是 **op 级**规则（"输出面↔输入面"映射），服务于内建 op 链，不是库。强制声明对库必然退化成 unmodeled——纯负担、零信息。
3. **整体删除**（2026-09-23）：`fn.naming`（NamingCarrier）、`registerLib({ naming })`、`LibLoaderOptions.namingFor`、三库 package.json 的 `faijs.naming`、CLI `readLibNaming`、浏览器 loader 的 `namingFor` + meta naming 抓取、`admitCompatLib` 硬失败分支（Phase 2.11-③）。
4. **新行为**：每个裸库函数一律以固定默认 `unmodeled` provenance 接纳——其面无稳定身份，面引用降级几何匹配（surfaceType/normal/center/area）。不读、不要求任何声明。默认 reason 带 `default:` 前缀，隐式默认与库作者显式 unmodeled 记账可区分；不输出 stderr（CI stderr 零容忍）。
5. **保留**：op 级命名（`DUAL_OP_META.naming` / roleTable——面命名声明的唯一合法位置）、六类 Provenance、血缘/身份机制、`fn.outputs`（多输出注解，与命名无关）、`faijs.autoLift`（执行语义，与命名无关）。
6. **版本**：0.14.1 尚未发布；属发布前设计修订，版本号保持 0.14.1。tarball 重打。

## 代码位置

- `packages/core/src/cad-runtime/admit-compat-lib.ts` — 默认 unmodeled 接纳，不再读命名
- `packages/core/src/cad-runtime/runtime.ts` — `registerLib` 签名 / namingFor 传参删除
- `packages/core/src/cad-runtime/ports.ts` — `LibLoaderOptions.namingFor` 删除
- `packages/core/src/cad-runtime/browser-lib-loader.ts` — `namingFor` / meta naming 抓取删除（autoLift 保留）
- `packages/core/src/node-host/cli.ts` — `readLibNaming` / namingFor 删除
- `packages/{fai_cq_gears,fai_cq_warehouse,sheetmetal}/package.json` — `faijs.naming` 删除
- `packages/core/src/index.ts` — 导出注释更新（Provenance 导出保留）
- `packages/core/src/cad-runtime/admit-compat-lib.test.ts` — 重新钉住默认接纳
- `docs/plans/2026-09-23-relax-lib-naming-design.md` — 方案（新）
- `docs/plans/2026-09-22-topology-identity-development-plan.md` §7.2 — 2.11 标注已废除

## 遗留 / 后续

- 重打 5 个 tarball（0.14.1：core / cq-compat / fai_cq_gears / fai_cq_warehouse / sheetmetal）并重装进 3d_editor。
- 验证 3d_editor `c4-brepjs-gear.test.ts` 恢复通过（npm 0.13.2 gears 此前硬失败，现默认接纳）。
- `docs/api-contract.md` / `docs/library-dev-guide.md` 已核查，无命名声明契约内容——无需修改。
