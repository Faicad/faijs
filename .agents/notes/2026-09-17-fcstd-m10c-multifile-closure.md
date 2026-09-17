# Agent Note: FCStd 移植 M10c — 多文件容器跨文件引用闭环（2026-09-17）

## 结论

M10 遗留的「多 Body 产物不可端到端执行」缺口已闭环。聚合 main 的跨文件
引用改走 runtime 既有的相对 import 契约（module-registry D6），未新增
加载器或运行时机制。

## 实现（两处，均在 codegen.ts）

1. **import 语义聚合入口**：main.fai.js 对每个有几何的 Body 产出
   `import { <Body>_out } from './<Body>.fai.js';`，再
   `cad.group({ members: [...] })`。Body 文件的终端别名 `<Body>_out`
   （纯赋值 `let Body_out = <链头>;`）在 live-shapes 判定中无 producer →
   直接终端 → 可被 named import 绑定（D6 名字契约成立）。
2. **拆分闭包（关键修复）**：main 中消费 Body 文件变量的调用必须迁入该
   Body 文件，否则 main 引用未声明标识符（`SEC_FREE_IDENT`——首次端到端
   run 在 test_geomop 上抓到：`part13` 在 Body 文件、消费者 `part14` 留在
   main）。修复为迭代闭包：任何 inputs 命中 Body 文件产出的 main 调用
   反复迁移直至稳定（链可跨多层）。

## 实测（test_geomop.fcstd，7 个 Body 的真实语料）

- 转换 → model/{main,Body,Body002..Body007}.fai.js 七+一文件
- `faijs-cli run model/main.fai.js --mode brep --project-root model/`
  → STEP 导出成功（3030 ents）
- 单 Body 聚合：import 单终端后 `let part_out = <Body>_out;` 保持稳定
  根名；零 Body 回落单文件（原路径不变）

## GOTCHA

- CLI 多文件 run 需要 `--project-root`（fs-project-loader 以其为
  moduleKey 基准；e2e 解包容器后传 `--project-root model/`）。
- 纯赋值别名行 `let A = B;` 不是 op 调用，live-shapes 的「无 producer →
  直接终端」分支正是它可导出的依据——勿把别名行改写成 identity op。
- 安全扫描器自动收集 import 绑定名（collectImportBindings），故 import
  后的标识符引用合法；**未走 import 的裸跨文件引用**才是 SEC_FREE_IDENT。

## 测试

- codegen.test.ts：M10.3 双 Body 断言更新为 import 语义（+2 import 行断言）
- fcstd 13 文件 / 102 用例全绿；e2e 三样本 + G9 真实样本全绿（基线不变）
- 真实多 Body 样本端到端：test_geomop 7 Body → STEP 通过（手动验证，
  转换/运行链路均可重跑命令见上）
