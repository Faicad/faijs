# Agent Note：`Part::Compound` 中不带几何的成员

Status: implemented

[English](2026-09-28-compound-nonmodeling-members.md) | 中文

## 问题

`Part::Compound` 的翻译（`packages/fcstd/src/feature-translate.ts`）读取该对象
`Links` 这个 `PropertyLinkList`，并要求**每一条**链接都能解析出几何变量。任何一条
解析不出来，整个对象就 bake 成 `compound-missing-members`，进而让整份文档成为缺口
（exit 2，不产出 `.fai.zip`）。

FreeCAD 的语义更窄：`Part::Compound` 接受 `Links` 里的任意文档对象，并直接忽略其中
没有 Shape 的那些。FCBL 家具一族（`FCBL_curtain`、`FCBL_bed_double`、
`FCBL_nightstand_wall_hung`）把文档的 `App::VarSet` 放在该列表**第一位**——那是各
Extrude 读取 `<<Label>>.Alias` 表达式的参数容器。所有 Extrusion 成员都能解析；只有
`VarSet` 永远解析不出来，因为 `codegen.ts` 在翻译前就把非建模类型短路成
`preserved-only`，根本不会为它建变量。

带该类的 28 个语料文件里，19 个属于这一形态。

## 决策

在计算 compound 成员表时，跳过**类型**为非建模的成员，其余保持原有要求：至少一个
成员能解析。

判据用 `structural-types.ts` 的 `isNonModelingType`——与 `codegen.ts` 翻译前短路、
`convert.ts` 的 C4 审计用的是同一个谓词，因此不可能出现「翻译器里被丢弃、别处却被
当作建模特征发出」的成员。

跳过方向被刻意收窄：不在 `docObjects` 里的成员（单元测试那样只用两个参数调用翻译器
时）**仍然要求解析**。靠「不知道」就丢弃会静默产出成员错误的 compound，所以必须先
确知链接的类型才能跳过。

## 实测效果

- `FCBL_curtain` / `FCBL_bed_double` / `FCBL_nightstand_wall_hung` → `ok: true`、
  `gaps: []`；发出的 `cad.compound` 成员恰为 Extrusion 链接（1 / 5 / 6），
  `VarSet` 无任何痕迹。
- 重测全部 28 个带该类的语料文件：**19 个转为 `ok`**，含
  `Bathroom_cabinet_sink.FCStd`（63 张草图）与 `Bedroom_closet.FCStd`（56 张）。
- 仍有 13 个是缺口，但属**另一个**子因：`Links` 为空而对象携带真实的 `Shape`
  `.brp`（如 `arduino-mega.fcstd`）。本次不处理。

## 考虑过的替代方案

- **把非建模成员翻译成空调用。** 否决：`cad.compound` 要求每个成员都在 BREP 链上，
  否则抛 `E_BREP_UNSUPPORTED`；而 `VarSet` 本就无几何可贡献。
- **把所有解析失败的链接一律丢掉。** 否决：它无法区分「本就没有几何」与「几何翻译
  失败」，级联时会静默产出成员错误的 compound。
- **把 `App::VarSet` 类型写死。** 否决：同一张 Links 表里还可能是
  `Spreadsheet::Sheet`、`App::Plane` 或分组，共享的非建模谓词已覆盖该族，且不会与
  codegen 的视图漂移。

## 后果

- 对「非建模成员」这一形态，该类已消除，且修复自带验证：`VarSet` 不产生任何 codegen
  变量，所以仍需它的成员表根本到不了预期形态。
- 依赖语料的 e2e（`compound-members-e2e.test.ts`）在三个 FCBL 文档上钉住「转换通过 +
  成员数」。
- 验证时发现：这些产物**跑不起来**。canonical 草图投影丢掉了 `construction` 标记，
  且 `toFreeCadGeoms` 拒绝 `point` / `ellipse` / `bspline`，而 `fromFreeCadGeoms` 却会
  产出它们——于是发出的 `cad.sketch` 载荷要么在运行期被拒，要么把构造几何静默提升成
  轮廓。属另一缺陷，单独修。

## 文件

- `packages/fcstd/src/feature-translate.ts` —— `Part::Compound` 分支。
- `packages/fcstd/src/feature-type.test.ts` —— 四个单元用例。
- `packages/fcstd/src/compound-members-e2e.test.ts` —— 语料 e2e。
