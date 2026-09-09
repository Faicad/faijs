# cq-compat 对等测试

[English](README.md) | 中文

CadQuery ⇄ cq-compat 几何等价验证（抓取上游测试几何的 AST 注入 harness 见 `.agents/notes/proposed/testing/` 下的 `2026-09-08-cq-compat-cadquery-parity-harness` 决策记录）。

## 布局

```
tests/
  baseline.json          # Version lock (CadQuery tag, Python venv, OCP version)
  manifest.json          # Three-state case manifest (single source of truth; gen-manifest.ts)
  ref-harness/
    cq_step_plugin.py    # pytest plugin: intercepts test modules, AST-injects the export
    run-ref.py           # reference STEP export driver (git archive tag snapshot, read-only)
  run-cand.ts            # walks mirror .fai.js → out/cand/*.step
  compare.ts             # names the ref/cand pairs → out/report.{md,json}
  gen-manifest.ts        # builds the manifest from the ref manifest
  test_cadquery/…        # mirror cases (file name = ref STEP name + .fai.js)
```

## 命令

```bash
# 1. reference STEP (需 C:\Users\ylt\cadquery-env，产物约 650 个文件 / 约 21 MB，已 gitignore)
C:/Users/ylt/cadquery-env/Scripts/python.exe tests/ref-harness/run-ref.py

# 2. 上游用例静态分析 → tests/coverage.json（分类 + blockedBy 实测排行）
#    （退出码 139/段错误是 venv 卸载 OCCT DLL 的已知噪音，JSON 已写完，可忽略）
C:/Users/ylt/cadquery-env/Scripts/python.exe tests/ref-harness/analyze-coverage.py --json tests/coverage.json

# 3. 生成/刷新三态清单（消费 coverage.json；人工标注优先于机器默认值）
npx tsx tests/gen-manifest.ts

# 4. 导出候选（全部镜像用例；改了 src/ 后先 npm run build -w @faicad/cq-compat —— CLI 走 dist）
npx tsx tests/run-cand.ts

# 5. 比对出报告
npx tsx tests/compare.ts
```

## 镜像用例命名

参考 STEP：`tests.test_cadquery__TestBooleans__testBox__r.step`；镜像文件：`test_cadquery/TestBooleans__testBox__r.fai.js`；脚本末行必须是 `let result = cq.val(...)`，变量名与参考 `__var__` 对齐。

### 多体用例约定（combine=False / eachpoint）

ref 侧导出的是 `val()` = 上游 `objects[0]`，**只含第一个实体**。因此 `combine=False` / 多点 eachpoint 的用例，镜像里**只 push 第一个点**（例如 `pushPoints(wp, [[-2, 0]])` 而不是完整点阵），让 `val()` 与 ref 对齐。完整 compound 的几何由 `src/*.test.ts` 单测覆盖，不在 STEP 比对里验证。违反此约定会表现为 vol Δ 100%、bbox 成倍偏大（实测踩过）。

## 红线

- `blocked` 用例必须填 `blockedBy`；禁止把 `blocked` 记为 `ported`。
- `FAIL` 不得用放宽容差改成 `PASS`（容差在 compare.ts 集中定义）。
- **新增镜像文件后必须重跑 `gen-manifest.ts`**（第 3 步）。manifest 是三态唯一事实源，`ported` 只对磁盘上存在 `.fai.js` 的用例成立；漏跑会让 `manifest.json` 与磁盘脱节（2026-09-08 曾出现 manifest 记 27、磁盘实际 55 的口径失真）。
