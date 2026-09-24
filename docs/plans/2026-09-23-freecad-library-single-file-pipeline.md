# FreeCAD-library 单文件流水线 · 开发计划（2026-09-23）

> 状态：**方案（未实施，本轮只写方案）**。
> 取代 `2026-09-23-freecad-library-conversion-plan.md`（批量阶段化方案，已证明流程设计错误）。
> 工作树：`D:/Faicad/fcstd-port`；语料：`D:/Faicad/FreeCAD-library`（3,201 个 FCStd）。

---

## 0. 需求原话

> "一个文件一个文件的跑，根本没有任何批量。每个文件记录到底是什么状态。把 fcstd 的所有文件这么一个一个处理。"

---

## 1. 设计原则（对旧流程的纠错）

旧流程的根因：把"批跑"当验证手段，正确性要跑完全量才暴露，每个 bug 付全量代价（多终端守卫 40 分钟、真值过期全量对拍、root 识别 1.6 小时）。本方案彻底取消批量驱动：

1. **单文件为最小单位**：一次只处理一个 FCStd，走完整链路，任何一步出错即时暴露在该文件的记录里。
2. **无批量驱动**：没有"阶段 1 跑 2,323 个、阶段 2 跑 1,251 个"这种跨文件批量。外层只是一个按序逐文件调用的简单循环。
3. **每文件状态自描述**：`state/manifest.jsonl` 每行一个文件，记录全链路每步状态 + error/reason，单点真相。
4. **产物隔离**：每文件产物进 `out/per-file/<stem>/`，不共享 jsonl 竞争、不互相污染。
5. **改脚本先单文件验证**：`process-one <sample>` 本身就是端到端 smoke，任何子脚本改动先在覆盖各类型的样本上跑通再继续循环。

---

## 2. 单文件流水线（process-one）

输入：一个 FCStd 的语料相对路径 `rel`。按序跑下列步骤，每步完成后写 manifest 该行对应字段；任何一步失败即记 error 并停止该文件（外层按配置决定停或继续）。

| 步 | 字段 | 动作 | 产物 | 状态值 |
|---|---|---|---|---|
| 1 convert | `convert` | `faijs-fcstd-convert <in.FCStd> out/per-file/<stem>/product.fai.zip` | `out/per-file/<stem>/product.fai.zip` + `mapping.json` | `ok` / `gap`(翻译缺口) / `failed` |
| 2 run | `run`,`step` | materialize product.fai.zip + `cliRun --mode brep --out out/per-file/<stem>/step/` | `out/per-file/<stem>/step/*.step`（多终端多文件） | `ok`/`run-fail`/`timeout`；`step=true` 当有 STEP 落盘 |
| 3 truth | `truth` | `export-fcstd-truth.py <in.FCStd>` | `out/per-file/<stem>/truth.json` | `ok`/`fail` |
| 4 inv | `inv` | `step-invariants.py out/per-file/<stem>/step/*.step`（多终端合并写一条） | `out/per-file/<stem>/inv.json` | `true`/`false` |
| 5 parity | `parity` | 比较 truth.json 与 inv.json（1e-5，5 项不变量） | `out/per-file/<stem>/parity.json` | `pass`/`fail`/`skip`(truth 或 inv 缺失) |
| 6 promote | `promoted` | 若 parity=pass：`mv product.fai.zip → FreeCAD-library/<rel>.fai.zip` | final 目录 | `true`/`false` |

每步失败时填具体 `error`/`reason` 字段，便于即时定位（不积压到汇总才看）。

`process-one`（`tools/process-one.ts` 或 `.py`）**本身就是单文件端到端 smoke**——改任何子脚本后跑 `process-one <样本>` 即可验证全链路，无需批跑。

---

## 3. 状态记录（manifest）

`state/manifest.jsonl`，每行一个文件，key = `rel`（语料相对路径）：

```jsonc
{
  "rel": "Path/To/File.FCStd",
  "stem": "<sha12>-<base>",          // 产品 stem，产物目录名
  "convert": "ok"|"gap"|"failed"|null, "convertError": "...",
  "run": "ok"|"run-fail"|"timeout"|null, "step": true|false, "runError": "...",
  "truth": "ok"|"fail"|null, "truthError": "...",
  "inv": true|false, "invError": "...",
  "parity": "pass"|"fail"|"skip"|null, "parityFails": ["volume","bbox"],
  "promoted": true|false,
  "updatedAt": "ISO8601"
}
```

**不重复工作**：`process-one` 开头读该行，跳过已完成的步骤（如 `convert=ok` 就不重转）。重跑只补该文件缺失的步骤，不整体重来。

---

## 4. 外层循环（无批量）

`tools/run-single-file.ts`：按语料相对路径排序，逐文件调 `process-one`：

```
for rel in sorted(corpus.rglob("*.FCStd")):
    process-one(rel)
    每 N 个文件刷新 reports/status.md（从 manifest 汇总）
```

- **可中断/续跑**：Ctrl+C 后重启，从 manifest 跳过已全完成的文件，继续下一个。
- **失败处理**：默认"失败即停"（该文件出错 → 停下等修 → 修完继续），可配 `--continue-on-error` 收集模式。
- **无并发**：严格串行，一次一个文件。
- **无"阶段"概念**：没有"先全量转换、再全量执行"——每个文件一次性走完六步。

---

## 5. 出错即修（核心改进）

旧流程：批跑 751 个 → 看汇总 → 发现守卫 bug → 改 → 重跑 751 个。
新流程：`process-one <第一个多终端文件>` → 立即看到守卫漏分片 → 修 → 再跑该文件确认 → 继续循环。**bug 在 1 个文件上暴露，代价 < 1 分钟**。

任何子脚本（convert / cliRun / export-truth / step-invariants / parity）改动：
1. 先在覆盖各类型的样本集上跑 `process-one`：单终端、多终端、App::Part 容器式、带 Placement 旋转各 1–2 个。
2. 全链路打通、无回归 → 才继续外层循环。

---

## 6. 入库

- `parity=pass` 即 `mv` 到 `FreeCAD-library/<rel>.fai.zip`（镜像相对路径），manifest `promoted=true`。
- 逐文件 `git add FreeCAD-library/<rel>.fai.zip` + 阶段性 `git commit --no-verify`。
- staging / out / state / tools 一律 gitignore，不入库。

---

## 7. 复用已有产物（迁移策略）

当前已有产物（批量方案遗留）：staging 2,323、step 1,238、truth 3,201（含 688 个 root 识别 bug，脚本已修待重跑）、inv 1,238、parity、promoted 138 入库。

两种启动模式：

- **A. 复用 + 单文件补差（推荐）**：把已有产物按 `stem` 归入 `out/per-file/<stem>/`，manifest 回填已有状态；`process-one` 对每个文件只补缺失步骤。已入库 138 个逐一回核（用修正后真值重判），确认 pass 才保留、否则回退。
- **B. 从头单文件重跑**：清空 manifest 状态字段（保留产物文件），按序逐文件重跑全链路。代价高但最干净。

推荐 A：不浪费已验证产物，且单文件视角下回核 138 个入库是必须的（其中 2 个已确认真值 bug）。

---

## 8. 与旧方案的关系

取代 `2026-09-23-freecad-library-conversion-plan.md`（批量阶段化方案）。旧方案的"阶段 1/2/3"划分废弃，改为单文件六步链路。旧方案 §0 铁律（几何对拍为唯一标准、两个目录职责、git 只收 final、不删产物）沿用。

---

## 9. 验收

- `FreeCAD-library/` 文件数 == manifest `parity=pass` 数 == `promoted=true` 数。
- 每个文件的 manifest 记录完整（六步状态齐全），任何失败有具体 error。
- 无批跑驱动；`process-one` 可独立调用任意单文件。