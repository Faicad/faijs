# fai.js API 误用分析总结（FCStd → fai.js 翻译管线实测）

- 日期：2026-10-12
- 来源：faijs-freecad 翻译管线（`src/codegen.ts`、`src/feature-translate.ts`）在 FreeCAD-library 语料（3202 个 FCStd）上跑 parity 时暴露的 fai.js API 误用。
- 目的：把翻译期发现的 fai.js API 语义陷阱汇总给 fai.js 团队，用于改进 **API 文档** 与 **API 设计**（品牌类型 / 参数拆分 / 契约硬化）。
- 判定口径：parity 以 `tools/parity-judge.py` 的 1e-5 相对容差为准（volume / area / bbox / 质心 / solid 数全部通过）。

> 本文档记录的是「翻译器对 fai.js API 的误用」，不是 fai.js 的 bug。fai.js 的契约本身是正确的，问题出在翻译器**把 FreeCAD 的字段语义套到了 fai.js 参数上**，忽略了参数名相同但语义不同。

---

## 0. 总览：误用清单

| # | 误用 | 涉及的 fai.js API | 后果 | 修复手段 | 给 fai.js 的建议 |
|---|------|-------------------|------|----------|------------------|
| A | Placement 被双重应用（`at:` 烘入 + `cad.place` 再应用） | `cad.box/cylinder/sphere` 的 `at:` + `cad.place` | 平移翻倍，位姿错（dcom 全为 `0,0,-2.5`） | 仅对位移烘焙 op 把 `at` 归零，`cad.place` 独占 Placement | 文档显式声明「`at` 与 `cad.place` 不要重复承载同一 Placement」 |
| B | `at:` 语义被当成「位置」统一处理 | `cad.mirror` 的 `at`、revolve 类的 `at` | 归零 `at` 会把镜像平面 / 旋转轴挪到原点 → 几何损坏 | 按 op 白名单限定 `at` 归零（仅 box/cylinder/sphere） | **把 `at` 的三种语义在文档里并列标注**，考虑拆分为 `position`/`planeAt`/`axisAt` |
| C | `cad.place` 自引用 / 前向引用 | `cad.place(X, X)` | fai.js 拒绝前向引用 → 变量未定义、Body 终端悬空 | 用「未定位」的原 var 作输入，定位副本先声明 | 文档固化「严禁前向引用」硬规则 + 翻译期静态检测 |
| D | 把 `cad.mirror`/`cad.clone` 当「消费输入」处理 | `cad.mirror`/`cad.clone` 的 `keep(input)` | 源对象泄漏为独立终端，或被 keep 复活成「多余 solid」 | 仅被 mirror/clone 消费的 var 仍是 root，进 assembly compound | 文档固化 mirror/clone 的「源保留」语义 + 提供 `consumeSource` 选项 |
| E | 把草图当「位置参数 inputs」而非 `params.sketch` | `cad.extrude`/`cad.revolve` 的 `params.sketch` | 草图被判为未消费 → 泄漏进终端 compound → 多出 solid / 体积错 | 草图走 `params.sketch`（裸变量名），不入 `inputs` | 文档标注「profile 通过 params 传递，不是 inputs」 |
| F | 保留 `at` 同时把 `place` 的 position 归零 | `cad.place` 旋转中心 | `x' = Q·x + Q·P`，绕错误中心旋转 | `at` 必须归零，让 `x' = Q·x + P` | 同 A/B：单一 Placement 权威源 |

---

## A. Placement 双重应用（C4 修复，2026-10-12）

### 误用
FreeCAD 的 `Part::Box`/`Part::Cylinder`/`Part::Sphere` 把对象 Placement 的**位置**烘焙进了几何体本身（`feature-translate.ts:placementPos(obj)` → 写入 `cad.box/cylinder/sphere` 的 `at:`），同时 codegen 在 M8.3 步骤又对同一个对象施加了 `cad.place`（承载其完整 Placement 的旋转+平移）。

结果：平移被应用了两次。

### 为什么是陷阱
`cad.place(part, {rotation, position})` 的语义是「绕局部原点旋转后平移」（x' = Q·x + P），与 FreeCAD Placement 完全一致（`docs/ops-api-inventory.md:838`）。而 primitive 的 `at:` 在 fai.js 里本就是「基准点位置」（box 角点 / cylinder 底面轴心 / sphere 球心）。两者叠加 = 平移翻倍。

### 实测证据
- 199/1200 复测产品呈现**统一**的 `dcom = 0,0,-2.5`：truth bbox z ∈ [-2.5, 12.5]，我们的 z ∈ [-5, 10]；volume / area / solids 都对，只有位姿错。
- 全语料 `Bolt Clearance Hole Cylinders` 族 **411/411 全 fail**，全是这个位姿错。
- 修复后：该族 411/411 全 pass（`out/c4-b0..b3-parity.json`：pass 411 / fail 16 / no-truth 3）。

### 修复（codegen.ts:803–839）
只对真正把 `placementPos(obj)` 烘焙进 `at:` 的 op 做「归零 + `cad.place` 独占」：

```ts
const POSITION_BAKING_OPS = new Set(['cad.box', 'cad.cylinder', 'cad.sphere']);
const bakedAtCall =
  pl === undefined ? undefined
  : (() => {
      const c = verdict.calls.at(-1);
      if (!c || !POSITION_BAKING_OPS.has(c.op)) return undefined;
      const at = (c.params as { at?: unknown } | undefined)?.at;
      if (!Array.isArray(at) || at.length !== 3) return undefined;
      return at.every(
        (v, i) => typeof v === 'number' && Math.abs(v - pl.p[i]!) < 1e-9,
      ) ? c : undefined;
    })();

if (lastVar && pl && !isIdentityPlacement(pl) && !isPrePlaced && !sketchCarriesFrame && reorientVar) {
  if (bakedAtCall) (bakedAtCall.params as Record<string, unknown>).at = [0, 0, 0];
  // 然后用原始(未定位) var 作输入发 cad.place，position/rotation = pl.p / pl.q
  ...
}
```

### 给 fai.js 的建议
1. 在 `cad.box/cylinder/sphere` 与 `cad.place` 的文档处**显式加交叉警告**：「primitives 的 `at` 与 `cad.place` 不要重复承载同一个 Placement；要么用 `at`，要么用 `cad.place`，二选一。」
2. 考虑在类型层区分「带 placement 的 primitive」与「不带 placement 的 primitive」，让翻译器无法同时写 `at` 又包 `cad.place`。

---

## B. `at:` 语义被当成「位置」统一处理（防误伤，核心陷阱）

### 误用
A 的修复最初想「对所有 op 把 `at:` 归零，交给 `cad.place`」。但 **`at` 在不同 op 里根本不是同一语义**：

| op | `at` 的真实语义 | 归零的后果 |
|----|----------------|-----------|
| `cad.box` / `cad.cylinder` / `cad.sphere` | **基准点位置**（角点 / 底面轴心 / 球心） | 仅去掉平移，正确 |
| `cad.mirror(part, {normal, at})` | **镜像平面上的一个点**（`docs/ops-api-inventory.md:1360`：镜面 = 过点 `at`、法向 `normal`） | 平面被挪到原点 → 镜像结果整体错位 |
| revolve 类（`cad.revolve` 等，`{axis, at}`） | **旋转轴上的一点**（`docs/ops-api-inventory.md:1446`：轴 = 过点 `at`、方向 `axis`） | 轴被挪到原点 → 旋转体错位 |

`feature-translate.ts:1883–1921` 清楚显示：`cad.mirror` 的 `at` 来自 `placementPos(planeObj)` —— 那是镜像**平面**的 point，不是被镜像几何的位置。

### 为什么是陷阱
参数名 `at` 在 primitives 和 mirror/revolve 里都叫 `at`，但前者是「把几何体放在哪」，后者是「平面/轴经过哪」。只要翻译器写一句「`if (at) at = [0,0,0]`」就会把 mirror/revolve 的几何搞坏，且**极难察觉**（形状还在、只是整体错移）。

### 修复
A 修复中的 `POSITION_BAKING_OPS` 白名单就是这道「防误伤」闸门：只有 box/cylinder/sphere 三个真正把 `placementPos(obj)` 烘焙进 `at` 的 op 才允许归零（codegen.ts:819–820, 827）。

### 给 fai.js 的建议（最高优先）
1. **文档**：在 `ops-api-inventory.md` 顶部加一条「`at` 是一个**重载参数**，语义随 op 变化」的醒目横幅，逐 op 标注 `at` 含义。
2. **API 设计（推荐，破坏性需评审）**：把三种语义拆成不同参数名，从根上消除陷阱：
   - primitives：`position`（代替 `at`）
   - `cad.mirror`：`plane: { point, normal }`
   - revolve 类：`axis: { point, direction }`
3. **类型层**：给 `at` 引入品牌类型 `PlanePoint` / `AxisPoint` / `Position`，让 TypeScript 在翻译器侧直接报错，防止把平面点当位置传。

---

## C. `cad.place` 自引用 / 前向引用

### 误用
codegen 在「把定位副本先声明」这一步，曾把 `cur`（已指向定位输出 var `rv`）又喂给 `cad.place` 的输入：

```ts
cad.place(rv, rv)   // 前向引用：rv 在本行才被声明
```

fai.js 是**拒绝前向引用**的语句语言（codegen.ts:843–845 注释）。运行期会前向引用失败，且真实输入被丢弃 → `cad.place` 误路由到 main，`Body__chain_N` 终端未定义。

### 修复
`cad.place` 的输入必须用「未定位」的**原 var**，`rv`（定位副本）先声明、再被下游（如 subtract）消费：

```ts
const cur = reorientVar;            // 原始、未定位
const rv  = emitVar(`${name}__place`);
const placeCall: CadCall = {
  out: rv, op: 'cad.place', source: name, inputs: [cur],
  params: { rotation: [...pl.q], position: [...pl.p] },
};
// 若需对 subtract 重新定向，必须把 placeCall 插到 subCall 之前
```

### 给 fai.js 的建议
- 文档把「**fai.js 拒绝前向引用**」列为硬规则，并说明后果（变量未定义 / 误路由 main）。
- 可考虑在翻译期静态扫描 `inputs` 是否引用了本语句之后才 `emitVar` 的变量，提前报错而非运行期炸。

---

## D. `cad.mirror` / `cad.clone` 的「源保留」语义（D-1，2026-10-06）

### 误用
FreeCAD 的 `Part::Mirroring` / `Part::Clone` 在树里**保留原始对象**（CAD 操作者语义）。fai.js 对应 `cad.mirror`/`cad.clone` 的 `keep` 语义也是「**不消费输入**」（`docs/ops-api-inventory.md:1369`：「keep 语义：不消费输入」）。

翻译器若把「被 mirror 消费的源」标记为 consumed，源会**泄漏成独立终端**（游离在 compound 之外）；若标记为 unconsumed，mirror 的 `keep(input)` 又会**复活**它成一个「多出来的 solid」（codegen.ts:1434–1442）。

### 修复（codegen.ts:1434–1442）
> 被 mirror/clone **唯一**消费的 var 仍然是 root —— 必须作为成员加入 assembly compound；compound 的参数扫描会消费它，独立终端随之消失。

```ts
const MIRROR_SOURCE_OPS = new Set(['cad.mirror', 'cad.clone']);
const isRootOut = (c) => {
  if (consumed.has(c.out) &&
      !(consumers.get(c.out)?.size &&
        [...consumers.get(c.out)!].every((op) => MIRROR_SOURCE_OPS.has(op)))) {
    return false;
  }
  return !PROFILE_OPS.has(c.op);
};
```

### 给 fai.js 的建议
- 文档把 mirror/clone 的 `keep` / 「源保留」语义提到 op 描述**最前面**，并配一句翻译器告诫：「源对象不会消失，必须显式纳入装配 compound，否则要么泄漏、要么被复活成多余 solid。」
- 提供一个显式的 `cad.mirror(part, {...}, { consumeSource: true })` 选项（或 `cad.mirrorConsume`），让「要丢弃源」的调用方一次说清，省去翻译器推断。

---

## E. 草图走 `params.sketch` 而非 `inputs`

### 误用
`cad.extrude`/`cad.revolve` 把轮廓草图放在 **`params.sketch`**（裸变量名），**不是**位置参数 `inputs`（codegen.ts:1419 注释、feature-translate `case` 里 `params.sketch`）。

翻译器若把草图当成「被消费的位置输入」塞进 `inputs`，草图会被判为「未消费」→ 泄漏进终端 `cad.compound` → 多出一个 solid、体积/质心全错（C_0603、Sliding_door 等曾因此 solids 12 vs truth 11、volume 37%）。

### 修复
草图类轮廓一律经 `params.sketch` 传递，不进 `inputs`；`lower()` 对「什么是最终产物」保持单一事实源（codegen.ts:1426–1428）。

### 给 fai.js 的建议
- 在 `cad.extrude`/`cad.revolve` 文档明确标注：「profile 通过 `params.sketch` 传，不是 `inputs`」。
- 考虑用品牌类型让 `inputs`（必须是已声明的 Shape 变量）与 `params.sketch`（裸名字符串）在类型上区分。

---

## F. 保留 `at` 同时把 `cad.place` 的 position 归零 → 绕错旋转中心

### 误用（A 的反面陷阱）
A 的修复若改成「保留 `at`、只把 `cad.place` 的 `position` 归零」，会得到：

```
x' = Q·x + (Q·P)     // 绕原点旋转后，再被 Q 转过的 P 平移
```

而不是正确的 `x' = Q·x + P`。旋转中心错误 → 旋转过的 primitive 整体错位（codegen.ts:814–815）。

### 修复
`at` 必须**整体归零**（三个分量），让 `cad.place` 独占 Placement：`x' = Q·x + P`。

---

## 1. 给 fai.js 的跨切面建议汇总

1. **`at` 是重载参数**：在 `ops-api-inventory.md` 加横幅，逐 op 标注 `at` 是 position / plane-point / axis-point。首选 API 拆分（`position` / `plane` / `axis`）消除陷阱。
2. **Placement 单一权威源**：primitives 的 `at` 与 `cad.place` 不可重复承载同一 Placement；文档交叉警告。
3. **前向引用硬规则**：fai.js 拒绝前向引用，文档固化后果 + 翻译期静态检测建议。
4. **mirror/clone 源保留**：文档置顶 `keep` 语义 + 提供 `consumeSource` 选项。
5. **profile 走 params.sketch**：文档明确 extrude/revolve 的草图传参方式。
6. **品牌类型防御**：对 `Position` / `PlanePoint` / `AxisPoint` / `ShapeVar` / `ProfileName` 引入品牌类型，在翻译器侧把「语义混淆」变成编译期错误。

## 2. 翻译器作者的自检清单（落地用）

- [ ] 任何写 `at` 的地方，先确认当前 op 的 `at` 是 position 还是 plane/axis 点。
- [ ] primitive 若写了 `at`，绝不再包 `cad.place` 带同一 Placement；二选一。
- [ ] `cad.place` 的输入必须是「尚未定位」的原 var，定位副本先声明。
- [ ] 被 mirror/clone 唯一消费的 var，必须进 assembly compound。
- [ ] 草图走 `params.sketch`，不进 `inputs`。
- [ ] 旋转过的 primitive，确认 `at` 已完全归零（`[0,0,0]`）而非只动 position。

---

## 参考（file:line）

- `faijs-freecad/src/codegen.ts:803–839` — C4：Placement 双重应用修复 + `POSITION_BAKING_OPS` 白名单。
- `faijs-freecad/src/codegen.ts:816–820` — `at:` 语义重载警告（mirror 平面点 / revolve 轴点）。
- `faijs-freecad/src/codegen.ts:843–845` — `cad.place` 前向引用禁止。
- `faijs-freecad/src/codegen.ts:1434–1442` — D-1：mirror/clone 源保留 → 仍是 root。
- `faijs-freecad/src/codegen.ts:1419` — 草图走 `params.sketch` 非 `inputs`。
- `faijs-freecad/src/feature-translate.ts:957,962,969,989,1076` — primitive 把 `placementPos(obj)` 烘焙进 `at:`。
- `faijs-freecad/src/feature-translate.ts:1883–1921` — `cad.mirror` 的 `at` = `placementPos(planeObj)`（镜像平面点）。
- `faijs/docs/ops-api-inventory.md:838` — `cad.place` = 绕局部原点旋转后平移。
- `faijs/docs/ops-api-inventory.md:1360,1376,1446` — `cad.mirror` / `cad.revolve` 的 `at` 为平面点 / 轴点。
- `out/c4-b0..b3-parity.json` — C4 复测：螺栓族 411/411 转绿（pass 411 / fail 16 / no-truth 3）。



附带发现（跨仓反馈项）

  registry 官方 `@faicad/faijs@0.32.3` 的 dist 缺 `solve-tree.js`——npm 安装的官方包连装配镜
  像都跑不起来。这说明 registry 上的 0.32.3 发布产物本身有缺陷，tgz 直装态（本地构建）是当前
  唯一可用态。建议随 N6 跨仓清单反馈给 faijs 仓（可能与 publish 流程的文件清单/ignore 配置有
  关）。