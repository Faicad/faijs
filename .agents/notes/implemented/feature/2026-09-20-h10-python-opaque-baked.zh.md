# Agent Note: H10 — Python 特征合法烘焙（python-opaque → python-baked）

Status: implemented

## Problem

C4（批量转换终检）只允许三种 disposition：`translated` / `python-baked` /
`preserved-only`。Python 例外的改名消费端早已存在（`auditMapping`：reason
`python-opaque` → disposition `python-baked`），但**没有任何代码产生过
`python-opaque` 这个 reason**。特征翻译器对一切白名单外类型统一返回
`baked` + `type-not-whitelisted: <type>`，于是 Python 脚本特征
（`Part::FeaturePython`、`App::FeaturePython`、`Path::FeaturePython`……）
100% 落进缺口清单。Python 对象是缺口第一大宗（4,514 个对象 / 647 文件，
占库 9.8%）。既有测试断言 `reason !== 'python-opaque'` 是空真——该 reason
从未被产生过。

一个相关误分类：`App::Point` / `App::Annotation` 属基准/标注类型，应进
`STRUCTURAL_TYPES`（preserved-only），此前被算作翻译缺口。

## Decision

- **产生端接在翻译判定处**（`feature-translate.ts`）：新增导出谓词
  `isPythonOpaque(obj)`，按**属性存在**判定 C4 的 Python 例外——属性名为
  `Python` 或 `Proxy`，或任意属性的 XML `type` 属性为
  `App::PropertyPythonObject`。`translateObject` 的白名单检查对此类对象返回
  `{ kind: 'baked', reason: 'python-opaque' }`（位于白名单检查之后，白名单
  类型绝不被该例外捕获）。
- **类型名后缀不是证据。** 类型名以 `Python` 结尾但无该属性的对象仍走普通
  `type-not-whitelisted` 缺口。这与库画像的属性口径统计及方案的明确要求一致。
- **`App::Point` / `App::Annotation`** 加入 `STRUCTURAL_TYPES`
  （`convert.ts`）→ `preserved-only`。
- **空真断言升级为正向锁定**（`convert.test.ts`）：Draft/Python 语料样本
  产生的 gaps 中不得再出现任何匹配 `/Python/` 的类型。

## Alternatives considered

- **以类型名后缀（对 type 匹配 `/\bPython\b/`）作触发条件** — 否决：方案
  明确要求属性证据；仅凭后缀会让非 Python 对象搭车进 `python-baked`（违反
  V-C6），也会漏掉类型名无后缀的 Python 载体。
- **只在 `auditMapping` 事后判定** — 否决：终检只见 `type` + `reason`，拿不到
  解析后的属性表；属性证据必须在对象图可用的位置（翻译器）读取。
- **现在就把 Python 特征的形状烘焙为 `cad.asset`** — 延后：方案将 Python
  形状的下游消费列为后续项；本次变更只接通台账例外。

## Consequences

- Python 脚本特征不再以缺口身份阻塞转换；非翻译对象仅含 Python-opaque（加
  结构类型）的文件现在能以 `ok=true` 转出，每个对象带 `python-baked` 台账项。
- `convert.test.ts:42` 的旧空真断言保留（仍然为真），并补充正向的 `/Python/`
  缺口锁定。
- 测试：`feature-translate.test.ts` H10 组（4 例：FeaturePython 带 Proxy 的
  GOTCHA、后缀不充分 GOTCHA、属性名变体、白名单 Box 的 V-C6 防搭车）；
  fcstd 套件 125/125 通过。
