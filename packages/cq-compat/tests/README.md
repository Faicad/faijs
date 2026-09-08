# cq-compat parity tests

CadQuery ⇄ cq-compat 几何等价验证（方案：`docs/plans/2026-09-08-cq-compat-cadquery-parity.md`）。

## 布局

```
tests/
  baseline.json          # 版本锁定（CadQuery tag、Python venv、OCP 版本）
  manifest.json          # 三态用例清单（唯一事实源；gen-manifest.ts 生成）
  ref-harness/
    cq_step_plugin.py    # pytest 插件：拦截测试模块，AST 注入导出
    run-ref.py           # 参考 STEP 导出驱动（git archive tag 快照，只读）
  run-cand.ts            # 遍历镜像 .fai.js → out/cand/*.step
  compare.ts             # ref/cand 按名配对 → out/report.{md,json}
  gen-manifest.ts        # 从 ref manifest 生成三态清单
  test_cadquery/…        # 镜像用例（文件名 = ref STEP 名 + .fai.js）
```

## 命令

```bash
# 1. 参考 STEP（需 C:\Users\ylt\cadquery-env，产物 ~650 文件 / ~21MB，已 gitignore）
C:/Users/ylt/cadquery-env/Scripts/python.exe tests/ref-harness/run-ref.py

# 2. 生成/刷新三态清单
npx tsx tests/gen-manifest.ts

# 3. 导出候选（全部镜像用例）
npx tsx tests/run-cand.ts

# 4. 比对出报告
npx tsx tests/compare.ts
```

## 镜像用例命名

参考 STEP：`tests.test_cadquery__TestBooleans__testBox__r.step`
镜像文件：`test_cadquery/TestBooleans__testBox__r.fai.js`
脚本末行必须是 `let result = cq.val(...)`，变量名与参考 `__var__` 对齐。

## 红线

- `blocked` 用例必须填 `blockedBy`；禁止把 `blocked` 记成 `ported`。
- `FAIL` 不得用放宽容差改成 `PASS`（容差在 compare.ts 集中定义）。
