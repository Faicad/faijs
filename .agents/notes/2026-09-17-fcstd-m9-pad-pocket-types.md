# Agent Note: FCStd 移植 M9 — Pad/Pocket Type 语义与 Body fuse 链（2026-09-17）

## 决策 1：Pad/Pocket `Type` 枚举双表解析（M9.1）

`App::PropertyEnumeration` 在 FCStd 里以**字符串标签或整数索引**两种形态落盘
（语料两种都见过）。`featureTypeOf()` 按 Pad/Pocket 各自的枚举表解析：

- Pad:    0=Length 1=UpToLast 2=UpToFirst 3=UpToFace 4=TwoLengths
- Pocket: 0=Length 1=ThroughAll 2=UpToFirst 3=UpToFace 4=TwoLengths
  （两表 1 号位不同——Pocket 是 ThroughAll；来源 FreeCAD Pad.h/Pocket.h）

缺 `Type` 属性 = Length（FreeCAD 默认）。**索引越界/未知标签 → `unknown`，
绝不静默按 Length 处理**（G4 违规已消除）。

## 决策 2：语义映射（M9.2/M9.3）

- `Length` → 单段 extrude（不变）
- `TwoLengths` → `+Length` / `−Length2` 双段 extrude 后 `cad.union`，
  中间变量 `<out>__pos` / `<out>__neg` 便于 mapping 定位
- `UpToLast/UpToFirst/UpToFace/ThroughAll` → **显式烘焙 + reason**
  （`pad-type-<T>-unsupported` / `pocket-type-<T>-unsupported`），不按 bbox 猜长度
- Pocket 的 `Midplane` 仍显式烘焙（`pocket-midplane-unsupported`）

## 决策 3：D-C 落地 — 同 Body 链式 fuse（M9.4）

codegen 解析 `PartDesign::Body` 的 `Group`（`Property > LinkList > Link*`，
按 Body.Group 顺序）建立成员归属；第一个 translated 特征为链基，其后
Pad 类 `cad.union(prev, next)`、Pocket/Cut 类从链头 `cad.subtract`。

**GOTCHA（双重 subtract 防护）**：Pocket 自身的 translate 已经产出
`cad.subtract(base, cut)`（BaseFeature 解析到链头变量时）。此时链头直接
推进为 Pocket 的输出变量，**不得**再追加一次对链头的 subtract——会切两次。
仅当 Pocket 的 base 未指向链头（如散落 Part 特征）才补链式 subtract。

`cad.group` 不再用于同 Body 特征组合（那是装配语义，M10 跨 Body 才用）。

## 基线变更（已写明原因）

PadTest e2e golden：translated **6→4**、baked 4→6。原 Pad001（UpToFace）、
Pad002（UpToLast）被静默按 Length 平移（正是 M9 要消灭的 G4 违规），
现在显式烘焙并带 reason。这是行为修正，不是回归。

## 语料缺口

计划里的 `TwoLengthsPad*.FCStd` 三个样本**不在本机语料**
（`D:/Faicad/FreeCAD/data/tests/` 只有 Crank/PadTest/PocketTest/ProjectTest）。
语义测试改用合成 fixture（`feature-type.test.ts`，12 用例，含标签/索引双形态）。

## 测试

- `feature-type.test.ts`：Type 枚举双形态 + TwoLengths 双段 + 全部烘焙 reason
- `codegen.test.ts`：同 Body 三特征链（Pad→Pocket→Pad001）恰好 2 个链级 op、
  无双重 subtract、无 cad.group
- e2e 三样本 golden 全绿（基线 4/6/3 已注明原因）
