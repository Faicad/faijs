# `cad.load` 参数面收敛为 `{ file, unit? }`

[English](2026-10-01-load-file-param.md) | 中文

**日期**: 2026-10-01
**状态**: implemented

## 决策

按 3d_editor 方案 `2026-10-01-unified-load-flow-and-scene-tree-design.md`
（用户 P8 拍板），编辑器 `cad.load` op（`@faicad/faijs-extra`）删除三键参数面
`{ key | path | url, format? }`，收敛为：

```js
const p = await cad.load({ file: 'vise.3mf' })   // asset file name, no path, with extension
const p = await cad.load({ file: 'box.stl', unit: 'mm' })  // unit kept for STL only (R17)
```

- **`file`** = 用户上传文件名（basename、含扩展名）。宿主资产库**按文件名**注册资产；
  `load` 经 `assets.resolveByKey(file)` 解析。
- **格式由 `file` 后缀自判**（白名单 `stl/3mf/step/stp/stpz/brep` → 归一化
  `stl/3mf/step/brep`）；宿主不再传 `format`。`iges/igs` 刻意**不在**白名单——
  occt-wasm 未链接 TKDEIGES（见 `brep-chain.ts` 的 `CAD_FORMATS` 注释），
  报「不支持的扩展名」比报内核错误更清晰。
- **3MF 魔数 sanity**：`.3mf` 后缀但字节非 zip 归档（`PK\x03\x04`/`PK\x05\x06`）
  拒绝。STL（文本/二进制歧义）与文本格式交解析器（宽容解析外部数据红线）。
- **白名单未命中** → 硬报错（不猜格式）。
- **`unit`** 仅 STL 保留（格式无声明单位；固化进语句行保证重放尺度一致）。

## 同 PR 附带改动

- `FsAssetResolver.scanDirectory` 每文件**双注册**：完整文件名（供
  `cad.load({ file })` 寻址）+ 去扩展名 stem（供 `cad.import_brep({ asset })`
  寻址——平台 BREP 资产约定，asset 引用 `<stem>.brp` 的 `<stem>`）。两个命名空间
  一个文件，非运行时回退。
- `fileBlobStore.put` 支持显式 key（测试支持；按文件名注册资产）。
- 更新调用点：`load-multipart.test.ts`、`threemf-extrude-chain.test.ts`、
  `case2-load-stl-cylinder-assembly.test.ts`、mixed fixture
  `m1/m2/m5-*.fai.js`（全部 `key:`/`path:`+`format:` → `file:`）。

## GOTCHA

Node `readFileSync(...).buffer` 对 < 8 KiB 的小文件是池化视图陷阱
（`byteOffset !== 0`）：读小 fixture 必须切片 `buf.buffer, buf.byteOffset,
buf.byteLength`。已修在触碰的测试中；`load-file-param.test.ts` 与
`load-multipart.test.ts` 带 `toArrayBuffer` helper。

## 验证

- `packages/core/src/api/load-file-param.test.ts`（新建，7 例）——全量工作区跑：
  更新 fixture 前 **3561 passed, 4 failed**；更新后全绿
  （`case2` 6/6、`mixed` 10/10、`load-multipart` 3/3、`threemf-extrude-chain` 1/1）。
- lint 0 errors；typecheck 绿。
