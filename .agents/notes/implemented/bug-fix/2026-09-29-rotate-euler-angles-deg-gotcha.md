# Agent Note: rotate_euler 的参数名是踩坑热点（anglesDeg 误用信号）

Status: implemented

English | [中文](2026-09-29-rotate-euler-angles-deg-gotcha.zh.md)

## Problem

`cad.rotate_euler` 的契约参数名是 `angles`（度值，XYZ 序），但仓库内 4 处
fixtures/测试（`packages/tests/faijs/transforms/rotate.fai.js`、
`transform-chain.fai.js`、`parity/parity-transforms.fai.js`、`syntax.test.ts`）
全部误写为 `anglesDeg`。参数表把未知键静默丢弃，`assertVec3(params.angles)`
看到 undefined 才报错——错误信息（"angles must be a vec3 … got undefined"）
指向校验点而不是书写点，排障要跨两层才定位到「参数名写错」。

对比：sheetmetal 包的 bend 参数就叫 `angleDeg`（合法），同仓库两个"角度"参数
命名不一致，是误写的直接诱因。这符合「API 不清晰本身就是问题」的判定信号。

## Decision

1. 修复 4 处误用（commit 003864e4），不改 op 契约——`angles` 语义自洽
   （JS 命名空间全局约定：角度一律用度，参数名无需再带单位后缀）。
2. 记录上游改进信号：若未来做 op 参数重命名/别名审查，`rotate_euler` 与
   sheetmetal 的角度参数命名应统一口径（要么都带单位后缀，要么都不带），
   消除「相邻包同名概念两种拼写」的歧义源。
3. 不加 `anglesDeg` 别名：内部测试阶段不做向后兼容（仓库明示约定），加别名
   会固化第二种拼写。

## Alternatives considered

- **加 `anglesDeg` 别名兼容**：拒绝——固化歧义，违背内部测试阶段约定。
- **只修 fixtures 不留档**：拒绝——同类误用已在 4 个文件独立发生，说明拼写
  歧义是系统性的，值得记档供上游审查。

## Consequences

- transforms/syntax/parity 测试全绿（原 2 个既有红转绿）。
- 若上游统一角度参数命名，本 note 与 sheetmetal `angleDeg` 一并列入改动清单。
