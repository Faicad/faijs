# Agent Note: FCStd 移植 M13 — 覆盖率扩展第一批（2026-09-17）

## 探针结论（M13.0，scripts/probe-m13-types.ts）

| 类型 | 语料形态 | 决策 |
|---|---|---|
| `Part::Compound`(5) | `Links` PropertyLinkList + 自带 .brp | **实现** → cad.group |
| `Part::Sphere`(1)+AdditiveSphere(1) | Radius（draft 样本参数在 XML 可读） | **实现** → cad.sphere；部分角度/缺 Radius 显式烘焙 |
| `Part::Offset2D`(22) | Source/Value/Fill/Join 可读，但 Offset2D 是 2D 偏移——faijs 无对应 op，需要先 wire-offset 能力 | **暂缓**，依赖未就绪 |
| `Part::Mirroring`(4) | EngineBlock 三个实例 + draft 一个，参数属性在探针中不可读（镜像平面存法非标） | **暂缓**，形态需二次探针 |

## 实现（M13.1）

- `Part::Compound`：Links 成员全部可解析 → `cad.group`；任一不可解析 →
  bake `compound-missing-members`
- `Part::Sphere`：全角度（Angle1=-90/Angle2=90/Angle3=360）→ `cad.sphere`
  at Placement；部分角度 → bake `sphere-partial-angle`；缺 Radius →
  bake `sphere-missing-radius`

## 验证（M13.2 / DoD）

- V5 双口径：非 Python 可覆盖 556→**562**，覆盖率 65.6%→**66.3%**
  （ArchDetail 4 个 Compound + draft Sphere/其他入白名单口径）
- ArchDetail / draft_test_objects 转换 → faijs-cli check 全 OK
  （draft 产物含 `sphere`、`group` 调用）
- fcstd 13 文件 / 102 用例全绿（+5：M13 whitelist extensions）

## 后续候选（性价比顺序）

1. `Part::Offset2D`(22)：先在 faijs 实现 wire-offset op（收益最大）
2. `Part::Mirroring`(4)：先补探针搞清镜像平面存储
3. M13.3 外部几何全量解锁：让 Drilling_1 类 L2 预判草图回 L1
4. M10 遗留容器加载器：跨文件 `<Body>_out` 引用闭环
