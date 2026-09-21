# Agent Note: 命名链在无名产形 op 处断掉

Status: implemented

## Problem

FCStd 移植的面/边引用（`cad.edgeRef`）建立在「每个 shape 自带 roleTable」之上。
`edgeRef` 拒绝没有表的 shape，这是对的：表才是让 `(origin, role)` 对可解析、
并能穿过后续 op 存活下来的东西。

实测（2026-09-21）：移植层发出的 Pad→Fillet 链
`sketch → extrude → fillet(edgeRef(extrude_out, N))` 死在那个 `edgeRef` 上：

```
E_TOPO_NOT_FOUND: edgeRef: input shape has no role table (nameless shape)
```

对 `api/` 下每一处 `fromBrep` 的普查显示：**建表或传播表的反而是少数**。

| 产形者 | 表 |
|---|---|
| `primitives.ts`（链根） | 有 |
| `import_brep`（链根，E3） | 有 |
| boolean / fillet / chamfer / copy / place / transform | 传播 |
| **`extrude`** | **无** |
| **`revolve`** | **无**（生成投影，没有可以挂命名的代码位置） |
| `sketch` 的面、`compound-geom`、`engrave`、`screw`、`svgExtrude`、`text` | 无 |
| `load`、`fai_*`（编辑器自有） | 无，且按平台/库分层已在范围外 |

所以缺陷类别不是「extrude 坏了」，而是「**有名字是逐 op 自愿的，忘了也没人吭声**」。
extrude 是这一类里最糟的一个，因为它是 FCStd 最常见的特征链的链根。
两个语料样本死在这里：`strange_part_with_holes.fcstd`（CAM DemoParts，死在第
一个 Pad）；`ModelFromV021.FCStd`（PartDesign，死在 revolve 产物——那里先撞上的是
`edgeRef` 的序号检查，因为序号 10 超出 revolve 产物的范围，无名 shape 要到后面才暴露）。

## Decision

- **`cad.extrude` 在两条路径上都建链根 roleTable**，通过一个 helper
  （`api/extrude.ts` 的 `registerExtrudeRoles`），机制与 `primitives.ts` 同源：
  origin = 当前语句的 LHS（两个 extrude 永不撞 origin），role 由 `assignRoles`
  给出（extrude 无语义命名器，走位置兜底 `extrude:face_i`，保证每面必有 role）。
- **表通过 `fromBrep` 登记在实际返回的那个实体上**，因此委托长度投影产出的产物
  与 up-to 产物落在同一种槽位形态上。
- **刻意不发明 `extrude:start/end/side` 语义词汇。** 今天没有任何消费方读这些字符串
  ——`edgeRef` 把 `(origin, role)` 当身份标签，下游一律按 hash 推进——而区分端盖需要
  拉伸方向，当前命名器签名不携带该信息。按 +Z 猜会**静默错标**所有非 Z 向拉伸。
  等真正解释这个名字的消费方出现再加。
- **`cad.revolve` 有意保持无名**，并由一条绊线测试钉住。修它是一道设计岔路
  （像 `extrude` 那样手写包装 op，还是在调度层给所有 brep 产物统一兜底建表），
  这道岔路属于方案，不属于本次修复。
- 留档的边界：**输入的 roleTable 不穿过 extrude 传播**——vendored extrude 不产面演化
  记录，没有东西可以推进 hash。这里只命名 extrude 自身引入的面。这仍严格优于修复前
  （修复前完全没有表）。

## Alternatives considered

- **让 `edgeRef` 在没有表时退回序号/hash 引用** —— 否决：这正是本项目禁止的旁路。
  表**就是**那项能力，抛错是「产形者从未交付它」的诚实信号；拿掉信号只会把整类问题
  藏起来，而不是修掉其中一员。
- **按假定的 +Z 方向做 `start/end/side` 语义命名** —— 否决：`cad.extrude` 接受任意
  `normal`，该假定会静默错标所有非 Z 向拉伸。错名字比诚实的位置名更糟。
- **同一轮顺手修 `revolve`** —— 以范围为由否决：`cad.revolve` 是生成投影，而本项目
  的规矩是 faijs 语义（命名就是语义）必须落在手写 `defineOp` 里。那个包装是否值得写，
  或者是否该由调度层统一给所有 brep 产物命名，是要拿着语料分布一起做的结构性决定。
- **只报缺口、不修 extrude** —— 否决：Pad/Pocket 是语料里最常见的特征链，而修复只是
  一个 helper 加一次登记。

## Consequences

- `packages/tests/faijs/edge-ref/edge-ref.test.ts` 新增 4 例：extrude 产物上的 `edgeRef`
  可解析；FCStd Pad→Fillet 几何正确（7 面；体积减少 `(1−π/4)·r²·L`）；表穿过
  `cad.place`（移植层会在特征之间发 `place`）保持；以及一条绊线钉住 revolve 当前的
  无名失败——将来修好时该断言应该**翻转，而不是删除**。
- 已验证通过：edge-ref 10/10；core api（extrude-upto、fillet、place、place-calibration、
  compound-geom、face-ref）36/36；tests 包（fillet、chamfer、boolean、transforms、
  topology-naming、features）55/55。
- 与本改动同时运行的 B2 全库普查消费的是**已安装的 tgz**，不是这棵源码树，且其报表
  记录了引擎 cli 的 sha256——两者不会被静默混在一起。因此重测 56 样本执行侧普查前，
  必须先 rebuild + 重装 tgz。
- 仍然无名、仍然是活的故障模式：`revolve`、`sketch` 的面、`compound-geom`、`engrave`、
  `screw`、`svgExtrude`、`text`。对它们的产物做 `edgeRef` / `faceRef` 仍会抛出同一个错。
