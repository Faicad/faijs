# @faicad/faijs-fasteners

[English](README.md) | 中文

faijs 的标准紧固件与五金件库：螺纹、螺母、螺钉、垫圈、轴承、链轮、链条与紧固孔。

## 来源

本包是 [cq_warehouse](https://github.com/gadgetguy/cq-warehouse)（v0.8.0，Maurice Lambert 的 CadQuery 标准件库）的 TypeScript 移植。几何语义、参数表（ISO/DIN 规格数据）与类行为均遵循上游 Python 源码；移植结果逐件对照上游生成的 STEP 参考做了验证（见 `fixtures/reference/`）。

- 参考用上游源码：`C:/git/CADQ/cq_warehouse/src`
- 许可证：Apache-2.0（与上游一致）

## 改名历史

最初名为 `@faicad/fai-cq-warehouse`（沿用上游品牌）；2026-10-02 改名为 `@faicad/faijs-fasteners`，以对齐 faijs 产品线命名约定并如实描述包内容。`cq_warehouse` 名称在此保留作为来源归属。
