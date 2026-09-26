# Agent Note：brepkit 布尔 evolution 格式错位（union/cut/subtract 崩溃）

English | [中文](2026-09-26-brepkit-boolean-evolution-format.md)

## 问题

brepkit 上 `cad.union`/`cut`/`subtract` 崩溃，报 `RangeError: Invalid array length`。崩溃不在 wasm 内核，而在适配器 `mapEvolution` 的数据格式契约。

## 根因

brepkit `fuseWithEvolution` 返回映射形态 JSON：`{solid, evolution:{modified:{oldHandle:[newHandles]}, deleted:[oldHandles]}}`。适配器的 `mapEvolution` 把 `modified` 拼成了扁平 hash 列表 `[hash_a0, hash_a1, ...]`（每个被改输入面一个 hash）。但下游 `decodeEvolution`/`decodeHashEvolution`（face-evolution.ts）期望 OCCT 的分段格式 `[inHash, count, outHash1, outHash2, ...]`。

分段解码器把 `modified[1]`（一个约 1.7 亿的 FNV face hash）当成 `count`，循环 `outHashes.push()` 17 亿次，最终抛 `Invalid array length`。

`fuseAll`/`fuse` 简单版不崩，因为它们完全不经过 `mapEvolution`。

## 决策

在 `brepkitKernel.ts` 的 `mapEvolution` 中：
1. 反向建 `handle→hash` 表（registry 原存 `hash→handle`）。
2. 遍历 `evo.modified` 的 `{oldHandle: [newHandles]}` 映射，逐条目产出分段 `[inHash, outCount, ...outHashes]`；outHashes 用 `faceFingerprint` 对新面句柄现场算 hash。
3. `deleted` 同样经反向表翻回 hash。
4. 加 GOTCHA 注释记录格式陷阱。

`cutWithHistory`/`intersectWithHistory`/`filletWithHistory` 共用 `mapEvolution`，一并修复。

## 验证

- `brepkit-boolean-fix.test.ts`（5 例）：brepkit 上 union/cut/subtract 返回有效几何，occt 不回退，`evolution.modified` 分段解码不抛。
- `multi-engine-op-parity.test.ts`：union/cut/subtract 在 occt + brepkit 2.129.15/3.4.18/4.0.32 全部 pass，bbox 一致。
- `brepkitKernel.test.ts`：75/75 无回退。

## 备选方案

- **改 `decodeEvolution`/`decodeHashEvolution` 接受扁平形态**——否决：face-evolution.ts 的分段格式是 occt 历史路径共享的权威契约；把 occt 解码耦合到 brepkit 适配器格式，会把内核特有怪癖泄漏进共享层。
- **在 op 层修复**——否决：bug 是 brepkit 内核桥内的数据格式转换；适配器是唯一拥有它的层（修复仅限适配器层）。

## 后果

- 3 个 op 在 brepkit 上不再崩溃。
- 修复仅限适配器层；未改 op 层或 face-evolution.ts。
- 三个 brepkit 版本行为完全一致——根因是适配器格式 bug，非 wasm 内核版本差异。
