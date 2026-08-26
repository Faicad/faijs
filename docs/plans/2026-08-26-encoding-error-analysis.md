# 编码事故复盘：源文件被重编码为 GBK/CP936（UTF-8 破坏）

> 本文档是一份**事故复盘 + 预防规范**（方案/文档性质，不含代码改动）。
> 触发背景：Phase 2 收尾核查时发现 3d_editor 的 `feature-registry.test.ts` 8 个中文 label 断言失败，
> 根因不是产品代码回归，而是**一批源文件被以 GBK/CP936 重新编码**，vitest 按 UTF-8 读取后中文变成乱码。
> 用户指出该错误**已多次发生**，要求找出确切根因并单独成文，避免再犯。

---

## 0. 用户原话（直接引用，不删除）

> “你需要找出到底是什么编码错误，然后还要单独写一份文档，这个编码错误犯了多次了。一定要避免。”

---

## 1. 一句话结论

**源文件被某个工具/编辑器以 GBK/CP936（ANSI，Windows 中文系统默认代码页）重新保存**，把本应
UTF-8（无 BOM）的 `.ts` 源码改写成了 GBK 字节流。GBK 是**有损**编码：不在 GBK 字符集内的字符
（如 `⌀` U+2300）会变成 `?`（0x3F），且 vitest/vite 按 UTF-8 读取时把 GBK 字节解码成
`�`（U+FFFD），导致中文注释、字符串 label 全部乱码，中文断言失败。

---

## 2. 现象（2026-08-26 实测）

| 项 | 结果 |
|---|---|
| `npx vitest run`（3d_editor） | ❌ 9 failed：8× `feature-registry.test.ts`（中文 label）+ 1× `script-engine.test.ts`（装配，另一根因） |
| 断言失败形态 | `expect(label).toContain('分割')` → `Received: '�ϲ�'`（U+FFFD 乱码） |
| `npx tsc --noEmit` | ✅ 0 error（注释乱码不影响编译；字符串乱码若未断言也不报错） |

**受影响文件（`3d_editor/src/` 下共 14 个非 UTF-8 文件）**：

| 文件 | 损坏模式 |
|---|---|
| `engine/features/{boolean, drill, engrave, extrude, group, knurl, screw, sdf, split, svg-extrude, text, transform}.ts`（12 个） | **模式 A**：整文件被重编码为 GBK |
| `engine/components/renderers/ViewCube.tsx`（1 个） | **模式 A**：整文件被重编码为 GBK |
| `engine/features/load.ts`（1 个） | **模式 B**：UTF-8 字节流中部分字节被替换为 `?`（0x3F） |

> 注：原 Phase 2 计划只列了 13 个 feature 文件，实测还多出一个 `ViewCube.tsx` —— 说明该错误
> 影响面比当时核查的更大，更印证“多次发生”。

---

## 3. 根因诊断（字节级证据）

### 3.1 判定方法（可复现）

```python
data = open(p, 'rb').read()
try:
    data.decode('utf-8')          # 合法 UTF-8 → 正常
except UnicodeDecodeError:
    try:
        data.decode('gbk')        # 能按 GBK 完整解码 → 被重编码为 GBK
        print('GBK-encoded')
    except UnicodeDecodeError:
        print('mixed/corrupted')  # 混杂或字节损坏
```

### 3.2 模式 A：整文件 UTF-8 → GBK 重编码（13 个文件）

- 字节证据：文件以 GBK 完整解码成功；GBK 解码结果与 `HEAD:`（合法 UTF-8）逐字节一致（除下述差异）。
- 与 HEAD 的差异只有三类：
  1. **编码**：UTF-8 → GBK（这是本次事故本体）。
  2. **有损字符**：`⌀`（U+2300，直径符号，**不在 GBK 字符集**）→ `?`（0x3F）。例：
     `drill.ts` 的 `钻孔 ⌀${d}` 变成 `钻孔 ?${d}`。**这是不可逆数据丢失**，仅重编码无法恢复。
  3. **BOM 移除**：HEAD 带 UTF-8 BOM（EF BB BF），工作区无 BOM。
- 另有一处**预期改动**混入（非事故）：`returnType: 'new_shape'` 字段被移除（与当前
  `CadStatement` 类型已无 `returnType` 一致，属正常重构，修复时须保留）。

### 3.3 模式 B：load.ts 字节级 `?` 替换（1 个文件）

- 字节证据：`load.ts` 不是 GBK，而是**UTF-8 字节流中部分字节被替换为 `?`（0x3F）**。
- 被替换的字节全部是 3 字节 UTF-8 序列的**末字节**（0x80–0xBF 续字节），例如：

| 原字符 | 原 UTF-8 | 损坏后 |
|---|---|---|
| `—`（U+2014） | `E2 80 94` | `E2 80 3F` |
| `。`（U+3002） | `E3 80 82` | `E3 80 3F` |
| `无`（U+65E0） | `E6 97 A0` | `E6 97 3F` |
| `是`（U+662F） | `E6 98 AF` | `E6 98 3F` |

- 机制推断：工具把 UTF-8 文件按 **GBK 双字节配对**读取；凡配不成合法 GBK 字符的孤立字节
  （如 `E2 80` 配对后剩下的 `94`、`E6 97` 配对后剩下的 `A0`）在回写时被替换成 `?`（0x3F）。
  其余字节原样保留 → 中文主体仍是 UTF-8，只有“配不成对”的字节变 `?`。
- 后果：`load.ts` 的**注释区被破坏**（多处 `?`、注释换行被吞并），且 `deriveLabel` 等字符串
  若含被破坏字符同样乱码。**该文件无法靠“GBK→UTF-8 重编码”恢复，必须从 HEAD 重建 + 保留预期改动。**

### 3.4 为什么“多次发生” / 根因来源

- 两个仓库 `git log` 均无 encoding 相关提交，`HEAD` 全部是合法 UTF-8 → **损坏从未被提交**，
  全部发生在工作区（未提交状态），是**本地工具/编辑器反复改写**造成的。
- 最可能的来源：**Windows 中文系统（locale=GBK/CP936）下，编辑器或工具以 ANSI/GBK 为默认
  编码打开/保存文件**（旧版记事本、某些 IDE 的“保存为 ANSI”、或把 UTF-8 文件误判为 GBK 后
  回存）。中文系统下这类工具对“无 BOM 的 UTF-8 文件”极易误判。
- faijs 仓库 `src/` 实测 0 个非 UTF-8 文件 → 当前仅 3d_editor 受影响，但**风险对两个仓库同在**。

---

## 4. 影响面

1. **测试**：`feature-registry.test.ts` 8 个中文 label 断言失败（`toContain('分割')` 等）。
2. **运行时 UI**：`deriveLabel` 返回的中文 label 乱码（`钻孔 ?`、`�ϲ�`），场景树/面板显示异常。
3. **源码可读性**：中文注释全部乱码，后续维护困难。
4. **潜在编译风险**：若字符串字面量中的乱码破坏了引号/模板串结构，可能直接编译失败
   （本次未发生，但 load.ts 已接近）。

---

## 5. 检测方法（一劳永逸）

### 5.1 一次性扫描（当前用）

```bash
python -c "
import os
for root, dirs, files in os.walk('src'):
    for fn in files:
        if not fn.endswith(('.ts','.tsx','.js','.jsx','.json','.css','.html','.md')): continue
        p = os.path.join(root, fn)
        try: open(p,'rb').read().decode('utf-8')
        except UnicodeDecodeError: print('NON-UTF8:', p)
"
```

### 5.2 长期守卫（建议，见 §6）

- 新增一个 **UTF-8 合法性守卫测试**：扫描 `src/` 下所有源码文件，断言全部可严格 UTF-8 解码
  （`decode('utf-8')` 不抛错），且无 BOM。任何一次“被保存成 GBK”都会立刻红。
- 在 CI（`scripts/ci.ps1` / `ci.sh`）里加同款检查，作为测试之前的第一道闸。

---

## 6. 预防规范（必须遵守）

1. **源码一律 UTF-8（无 BOM）**：所有 `.ts/.tsx/.js/.json/.css/.md` 文件必须 UTF-8 无 BOM。
2. **编辑器配置**：VS Code / WebStorm 等设置 `files.encoding: utf8`、
   `files.autoGuessEncoding: false`（**不要**自动猜测编码，避免误判 GBK）；
   新文件默认 UTF-8。
3. **禁止“另存为 ANSI/GBK”**：任何工具提示“编码不是 UTF-8，是否转换”时，一律选
   “保持 UTF-8 / 用 UTF-8 重新打开”，**绝不转成 ANSI/GBK**。
4. **含非 GBK 字符的文件尤其危险**：`⌀`（直径）、`±`、`×`、emoji 等不在 GBK 字符集，
   一旦被存成 GBK 会**永久丢失**（变 `?`），无法从乱码文件恢复，只能从 git HEAD 重建。
5. **提交前自查**：`git status` 若出现大范围 `M` 且多为中文注释文件，先跑 §5.1 扫描确认编码。
6. **CI 守卫**：落地 §5.2 的 UTF-8 守卫测试/脚本，让该错误在 CI 第一道闸就暴露。
7. **修复纪律**：已损坏文件**禁止 `git restore`/`checkout` 整目录**（AGENTS 警戒）；
   逐文件安全重建编码；含 `?` 数据丢失的文件（如 load.ts、drill.ts 的 `⌀`）必须从
   `HEAD:` 取回正确字符，再叠加预期改动（如 `returnType` 移除）。

---

## 7. 本次修复方案（另见 Phase 2 计划 §2.2 与 T6.5 收尾）

1. **模式 A（13 个文件）**：按 GBK 解码 → 以 UTF-8（无 BOM）重写；对 `drill.ts` 等含 `⌀`
   的文件，从 `HEAD:` 恢复 `⌀`（GBK 解码后 `?` 处对照 HEAD 回填）。
2. **模式 B（load.ts）**：从 `HEAD:` 取正确内容（UTF-8），叠加预期改动（移除 `returnType`、
   保留当前代码结构），重写为 UTF-8（无 BOM）。
3. **保留预期改动**：`returnType` 字段移除（当前类型已无该字段），不因修编码而回退。
4. **验证**：`npx vitest run src/engine/script-engine/feature-registry.test.ts` 8 用例转绿；
   全量 `npx vitest run` 该文件不再失败。

---

## 8. 附：本次实测观测记录（用于一句话识别环境是否正确）

- 复现命令（3d_editor）：
  ```
  python -c "<§5.1 扫描脚本>"  → 14 个非 UTF-8 文件
  npx vitest run src/engine/script-engine/feature-registry.test.ts → 8 failed（中文 label）
  ```
- 编码核验：12 个 feature + ViewCube.tsx 可 GBK 完整解码，GBK 解码内容与 `HEAD:`（UTF-8）
  一致（除 `⌀`→`?`、BOM、`returnType` 移除）；`load.ts` 为 UTF-8 字节 + 部分字节 `?` 替换。
