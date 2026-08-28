# faijs 语言 API 参考（AI / 用户写代码手册）

> 日期：2026-08-12
> **本手册的用途**：给 AI 和用户写 `.faijs` 代码用的 API 参考。**不需要看任何内部实现**，照着本手册写即可。
>
> - ✅ = 此接口正确、可放心使用
> - ⚠️ = 可用，但参数有已知缺陷
> - ❌ = 接口错误，**禁止使用**，等重做（见 §7）
>
> 相关文档：`docs/syntax-design.md`（语法与执行契约）、`docs/api-contract.md`（语句层内部契约）。

---

## 1. 原则：只写拓扑，不写网格

> **所有和拓扑相关的操作，API 参数里只准写拓扑信息（实体引用、面引用、参数数值），不准写三角化网格相关的信息（顶点/索引数组、细分参数、网格几何快照、原始文档内容）。**


---

## 3. 创建类操作（无上游输入）

### 3.1 `box` ✅

```js
const part0 = cad.box({ size: 20 })                  // 等边（立方体）
const part0 = cad.box({ size: [30, 20, 10] })        // 三边
const part0 = cad.box({ size: [30, 20, 10], center: [0, 0, 5] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `size` | `number` 或 `[x,y,z]` | ✅ | — | number = 等边 |
| `center` | `[x,y,z]` | | 原点 | 中心位置 |

同步。返回几何，可作后续 op 的输入。

### 3.2 `sphere` ✅

```js
const r = cad.sphere({ radius: 10 })
const r = cad.sphere({ radius: 10, segments: 64, center: [0,0,10] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | number | ✅ | — | |
| `segments` | number | | 32 | 细分度（影响面数） |
| `center` | [x,y,z] | | 原点 | |

同步。

### 3.3 `cylinder` ✅

```js
const c = cad.cylinder({ radius: 5, height: 40 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radius` | number | ✅ | — | |
| `height` | number | ✅ | — | 沿 Z 轴 |
| `segments` | number | | 32 | |
| `center` | [x,y,z] | | 原点 | |

同步。

### 3.4 `cone` ✅

```js
const c = cad.cone({ radiusBottom: 10, radiusTop: 4, height: 30 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `radiusBottom` | number | ✅ | — | 底半径 |
| `radiusTop` | number | ✅ | — | 顶半径（=Bottom 时即圆柱） |
| `height` | number | ✅ | — | 沿 Z 轴 |
| `segments` | number | | 32 | |
| `center` | [x,y,z] | | 原点 | |

同步。

### 3.5 `wedge` ✅（⚠️ 参数形态待收敛）

```js
const w = cad.wedge({ size: [30, 20, 10] })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `size` | number 或 [x,y,z] | ✅ | — | 楔形包围盒尺寸 |

> ⚠️ UI 面板另有 `width/height/angle/length` 形态，两种写法并存，属遗留，暂不要使用后者。

同步。

### 3.6 `text` ⚠️

```js
const t = await cad.text({ text: 'Hello', size: 20, depth: 5 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `text` | string | ✅ | — | 要生成的文字 |
| `size` | number | ✅ | — | 字号（mm） |
| `depth` | number | ✅ | — | 挤出深度（mm） |
| `font` | string | | 默认字体 | ⚠️ 语义未定（当前只有默认字体，暂不要传） |

异步。生成独立零件（文字轮廓挤出）。

### 3.7 `screw` ✅

```js
const s = await cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex' })
const s = await cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex', nRad: 64 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `system` | `'metric'` \| `'imperial'` | ✅ | — | 制式 |
| `specIdx` | number | ✅ | — | 规格索引（决定螺纹直径，如 M6） |
| `thread` | `'coarse'` \| `'fine'` \| `'custom'` \| `'none'` | ✅ | — | 螺纹类型 |
| `length` | number | ✅ | — | 螺杆长度 |
| `head` | `'hex'` \| `'chc'` \| `'none'` | ✅ | — | 头型（六角 / 内六角 / 无头） |
| `pitchCustom` | number | | — | 自定螺距（thread='custom' 时用；⚠️ codegen 暂不输出，TODO） |
| `nRad` | number | | 32 | 径向分段数（拓扑参数，决定 mesh 几何输出；BREP 路径不影响实体，仅控制 BREP→mesh 三角化提示） |

#### `nRad` 设计说明

**nRad 是拓扑参数，不是渲染参数。**

- **Mesh 路径**：nRad 直接决定 screw mesh 的径向分段数。不同 nRad = 不同的 3D 模型（不同的顶点数、三角面数、螺纹轮廓形状）。
- **BREP 路径**：BREP 使用精确数学曲面，nRad 不影响 BREP 实体几何。当 BREP→mesh 转换时（显示、STL 导出），nRad 作为三角化角度提示（angular deflection ≈ 2π/nRad）。
- **.faijs 序列化**：默认值 32 时不输出（保持 .faijs 简洁）；非默认值时输出 `nRad:64` 以保证几何可复现。
- **全局默认**：用户可配置全局默认值（默认 32），per-statement 的 nRad 覆盖全局默认。

#### `pitchCustom` 状态

执行层已支持（`makeScrew` / `threadBrep` 均读取此参数），但 codegen 暂不序列化。待用户确认需要后启用。

异步。生成独立零件。

### 3.8 `svgExtrude` ❌ **禁止使用，等重做**

```js
// ❌ 当前接口（错误，够写别用）
const s = await cad.svgExtrude({ svg: '<svg>…整份XML…</svg>', depth: 5, targetLongSide: 20 })
```

| 参数 | 类型 | 必填 | 默认 | 问题 |
|---|---|---|---|---|
| `svg` | string | ✅ | — | ❌ 整份 SVG XML 内容拷贝进参数；尺寸语义靠两套实现各自推导，导致 mesh/BREP 结果不一致 |
| `depth` | number | ✅ | — | |
| `targetLongSide` | number | | 20 | 长边目标尺寸 |

**为什么错**：SVG 是外部资产，应像 `load`/`assembly` 那样用**引用**；自然尺寸（viewBox）与缩放应显式成参数。（SVG 是从二维轮廓挤出的拓扑操作，BREP 后端已具备，重做中，见 §7。）**重做完成前不要使用。**

### 3.9 `sdf` ⚠️（mesh 型，可接受）

```js
const s = await cad.sdf({
  code: 'return sphere(10) - sphere(5, [10,0,0])',
  box: [[-20,-20,-20], [30,20,20]],
  resolution: 1,
})
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `code` | string | ✅ | — | SDF 函数源码（`sdf(x,y,z)` 定义或标题模板调用） |
| `box` | `[[minX,minY,minZ],[maxX,maxY,maxZ]]` | | 引擎估算 | 包围盒 |
| `resolution` | number | | 引擎默认 | 网格单元边长（越小越精细；SDF 天生是网格操作，允许网格参数） |
| `params` | object | | — | 参数数值表 |

异步。生成独立零件。

### 3.10 加载：`load` ✅（key / path / url 三选一）

```js
// ✅ 资产引用的正确形态（内容不进代码，只进引用）：
const p = await cad.load({ key: 'file_abc123' })
// 非 web 环境（本地文件）：
const p = await cad.load({ path: 'D:/models/box.step', format: 'step' })
// 网络：
const p = await cad.load({ url: 'https://…/box.3mf' })
```

| op | 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `load` | `key` | string | 三选一 | faicad 缓存中的资产 key（内容按 key 取，**引用而非拷贝** ✔） |
| `load` | `path` | string | 三选一 | 本地绝对路径（非 web 环境） |
| `load` | `url` | string | 三选一 | 网络地址 |
| `load` | `format` | string | | 格式提示（step/3mf/stl/obj/…） |

> 语言正常化后 `loadFile`/`loadUrl`/`loadByKey` 别名已删除（A4），统一为 `load` 一个函数。

异步。永远是一个 part 的第一条语句，后面可接特征链：

```js
const p = await cad.load({ key: 'file_abc123' })
const p2 = await cad.drill(p, { diameter: 5 })
return { shape: p2 }
```

---

## 4. 变换类操作（inputs ≥ 1，同步，无 await）

```js
const p1 = cad.translate(part0, { offset: [10, 0, 0] })          // 平移
const p2 = cad.rotate(part0, { anglesDeg: [0, 0, 45] })          // 旋转（度）
const p3 = cad.rotate(part0, { anglesDeg: [0, 0, 45], pivot: [0,0,0] })  // 绕指定点旋转
const p4 = cad.scale(part0, { factor: 2 })                        // 等比缩放
const p5 = cad.scale(part0, { factor: [2, 1, 1] })                // 非等比
```

| op | 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `translate` | `offset` | [x,y,z] | ✅ | — | 平移向量 |
| `rotate` | `anglesDeg` | [x,y,z] | ✅ | — | 欧拉角（度，XYZ 顺序） |
| `rotate` | `pivot` | [x,y,z] | | 原点 | 旋转中心 |
| `scale` | `factor` | number 或 [x,y,z] | ✅ | — | 缩放系数 |

**装配的相对位置全靠这些语句**（每个成员自己的 transform 语句），装配语句本身不携带变换。

---

## 5. 特征类操作（inputs ≥ 1）

### 5.1 `drill` ⚠️

```js
const p = await cad.drill(part0, { diameter: 5 })                             // 通孔，沿面法向
const p = await cad.drill(part0, { diameter: 5, depth: 3 })                   // 盲孔
const p = await cad.drill(part0, {                                            // 螺丝孔
  diameter: 5.2, depth: 8, holeType: 'screw',
  screwSystem: 'metric', screwSpecIdx: 6, screwThread: 'coarse', screwHead: 'none',
})
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `diameter` | number | ✅ | — | 孔径 |
| `depth` | number | | 0 | 孔深；**0 = 通孔** |
| `holeType` | `'simple'` \| `'screw'` | | `'simple'` | 螺丝孔时填 `'screw'` |
| `direction` | `'normal'` \| `'x'` \| `'y'` \| `'z'` | | `'normal'` | 钻孔轴向（默认沿面法向） |
| `position` | [x,y,z] | | — | 孔心位置（🔎 建议用几何引用：`cad.faceCenter(part0, [锚点])`） |
| `faceNormal` | [x,y,z] | | [0,0,1] | 面法向（决定朝向） |
| `tolerance` | number | | 0.3 | 公差 |
| `screwSystem` / `screwSpecIdx` / `screwThread` / `screwHead` | 见 3.7 同名字段 | | `'metric'` / 6 / `'coarse'` / `'none'` | 螺丝孔规格（holeType='screw' 时用） |

异步。

> ⚠️ AI 提示素材 `api.d.ts` 与这里**不同名**（旧素材写 `type: 'through'|'blind'`、`direction` 为向量）——那是不存在的写法，**一律以本表为准**，`type` 键无效。

### 5.2 `extrude` ✅

```js
const p = await cad.extrude(part0, { length: 10 })                       // 沿法向双向各 5
const p = await cad.extrude(part0, { length: 10, mode: 'forward' })      // 单向
const p = await cad.extrude(part0, { length: 10, normal: [0,0,1], originOffset: 2 })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `length` | number | ✅ | — | 总拉伸量 |
| `mode` | `'centered'` \| `'forward'` \| `'backward'` | | `'centered'` | 双向 / 正向 / 反向 |
| `normal` | [x,y,z] | | 当前面法向 | 拉伸方向 |
| `originOffset` | number | | 0 | 切面在法向上的偏移 |
| `space` | `'local'` \| `'world'` | | — | 坐标空间声明 |

异步。

### 5.3 `split` ⚠️（文本参数与执行断裂，见 §7）

```js
// 多输出：解构出 front / back 两个零件
const { front: part1, back: part2 } = await cad.split(part0, {
  normal: [0, 0, 1], offset: 5,                 // ⚠️ 文本层写法（见下方警告）
  cutMode: 'dovetail',
  grooveDepth: 3, grooveWidth: 5, grooveDepthTolerance: 0.1, grooveWidthTolerance: 0.1, grooveFlapsAngle: 30,
})
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `cutMode` | `'plane'` \| `'dovetail'` \| `'dowel'` \| `'tenon'` \| `'straight-tenon'` \| `'straight'` | | `'plane'` | 切割模式 |
| `normal` | [x,y,z] | | [0,0,1] | 切割面法线 |
| `offset` | number | | 0 | 切割面沿法线偏移（过 bbCenter） |
| `side` | `'front'` \| `'back'` | | — | （内部使用，普通写法可不写） |
| `bbCenter` / `bboxSize` | [x,y,z] | | 自动 | 包围盒信息（缺省自动推导） |
| 燕尾 `grooveDepth` `grooveWidth` `grooveDepthTolerance` `grooveWidthTolerance` `grooveFlapsAngle` | number | cutMode='dovetail' | | 燕尾槽参数 |
| 定位销 `dowelDiameter` `dowelDiameterTolerance` `dowelHeight` `dowelHeightTolerance` `selectedSections` | number / number[] | cutMode='dowel' | | 定位销参数 |
| 直榫 `tenonSideLength` `tenonSideLengthTolerance` `tenonHeight` `tenonHeightTolerance` `selectedSections` | number / number[] | cutMode='tenon' | | 直榫参数 |

异步。**双输出**：必须用 `{ front: partA, back: partB }` 解构变量名（partA/partB 各自成为独立模型）。

> ⚠️ **已知断裂（勿手写非默认平面）**：文本层打印的键是 `normal`/`offset`，但执行层读的是 `planeRotation`/`planePosition`——只有默认平面（法线 [0,0,1]、offset 0）两边恰好一致，E2E 测试掩盖了该断裂。**旋转过的分割无法通过文本复现**，修复见 §7。修复前，AI 写 split 请只用默认平面。

### 5.4 布尔：`union` / `subtract` / `intersect` ✅

```js
const a = await cad.union(part0, part1)          // 合并（≥2 个输入）
const b = await cad.subtract(part0, part1)       // 差集：part0 减 part1（第一个为主体）
const c = await cad.intersect(part0, part1)      // 交集
```

- **函数名即操作**，没有 args 对象；输入全是变量引用（多个可用 `cad.union(a, b, c)`）。
- 异步。所有输入变量必须已声明。

### 5.5 `engrave` ❌ **logo 分支禁止使用（文字分支可用）**

```js
// ✅ 文字雕刻（可用）
const p = await cad.engrave(part0, {
  mode: 'concave', depth: 2,                // concave=凹陷 / convex=凸出
  text: 'Hello', textSize: 10,
  faceCenter: [0, 0, 0], faceNormal: [0, 0, -1],
})
// ❌ logo 雕刻（禁止使用——svgText 为整份 XML 拷贝 + svgSize 文本导出丢失，往返失真）
const p = await cad.engrave(part0, { engravingType: 'logo', svgText: '<svg>…</svg>', svgSize: 20, … })
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `mode` | `'concave'` \| `'convex'` | | `'concave'` | 凹陷（减法）/ 凸出（加法） |
| `depth` | number | | 0 | 深度 / 凸出高度 |
| `text` | string | 文字时 | — | 文字内容（与 svgText 二选一） |
| `textSize` | number | 文字时 | 10 | 字号 |
| `engravingType` | `'text'` \| `'logo'` | | 按内容推导 | **冗余参数**，不要写 |
| `svgText` / `svgSize` | — | logo 时 | — | ❌ logo 分支错误（§7），禁止 |
| `faceCenter` / `faceNormal` | [x,y,z] | | — | 面位置（🔎 建议几何引用 `cad.faceCenter(part0, [锚点])`；⚠️ 目前为绝对坐标快照） |

异步。

所有面的拓扑引用，都要和装配类似处理。


### 5.6 `knurl` ⚠️（网格型 op）

```js
const p = cad.knurl(part0, {
  knurlTextureHeight: 0.5, knurlScaleU: 0.15, knurlScaleV: 0.15,
  knurlInvertDisplacement: false, knurlRefineLength: 1.0, knurlMappingMode: 5,
})
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `knurlTextureHeight` | number | | 0.5 | 纹路高度 |
| `knurlScaleU` / `knurlScaleV` | number | | 0.15 | 纹路频率 |
| `knurlInvertDisplacement` | boolean | | false | 反向位移 |
| `knurlRefineLength` | number | | 1.0 | 细分长度 |
| `knurlMappingMode` | number | | 5 | UV 映射模式 |
| `faceCenter` / `faceNormal` | [x,y,z] | | — | 面锚定（同上建议用几何引用） |

同步（文本层无 await）。knurl 本质是**顶点位移**（网格操作），网格参数可接受；但面锚定应拓扑化。

---

## 6. 结构语句：`group` / `assembly`（改正案例，非终态）

**结构语句，无 const、无 await、不产生几何**，只表达零件之间的关系。成员用**变量名引用**，约束用**拓扑面引用**——这是「只写拓扑」原则的一次落地（曾经错得离谱：旧装配把成员变换残片、`relativeTransform` 快照等塞进约束，现已改为上面的形态），**但装配自身仍可改进**：

```js
export default async (cad) => {
  const part0 = cad.box({ size: [30, 20, 10] })
  const part1 = cad.box({ size: [10, 5, 5] })
  const part1 = cad.translate(part1, { offset: [5, -2, 0] })   // 相对位置由成员自己的变换语句表达

  cad.group({ name: '底板组', members: ['part0'] })               // 分组：零约束，保持当前布局
  cad.assembly({
    name: '装配1',
    members: ['part0', 'part1'],
    constraints: [{
      fixedPartId: 'part0',
      movingPartId: 'part1',
      fixedFace: { faceRowIndex: 3, faceId: 'col:0:face:3', surfaceType: 'plane' },
      movingFace: { faceRowIndex: 17, faceId: 'col:0:face:17', surfaceType: 'plane' },
      invalid: false,
    }],
  })
  return [{ shape: part0 }, { shape: part1 }]
}
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 组/装配名 |
| `members` | Shape[]（变量引用数组） | ✅ | 成员 **faijs 变量名**（`[part0, part1]`，语言正常化后为 VarRef 数组，不再是字符串数组） |
| `constraints`（仅 assembly） | 数组 | | 面约束：`fixedPartId`/`movingPartId`（变量名）+ `fixedFace`/`movingFace`（拓扑面引用 `{ faceRowIndex, faceId, surfaceType }`，**几何数据不入参数，运行时从面行派生**） |

### 6.2 装配自身的可改进之处（勿当成照抄模板）

1. **`faceRowIndex` 是运行时行索引**（`SelectorRuntime.faces[]` 下标），依赖拓扑重建后 faces 数组的行顺序稳定；行序变化即失配，只能靠 `invalid: true` 兜底。**理想的面引用应是全局稳定的拓扑面标识**（STEP_T 面 id 已是显式字段 `faceId`，行索引可由它推导），收敛为单一稳定引用后 `invalid` 兜底可去掉。
2. **`invalid` 是运行时状态混入数据契约**（还随 `.faijs` 序列化导出），应改为派生量，不进参数。
3. **约束只有「面贴面」一种**：无轴向对齐（配合坐标轴）、共面、距离等约束类型；`relativeTransform` 等历史字段已被清走，但约束表达能力仍单薄。
4. **成员相对位姿没有校验锚点**：装配语句不带任何"确认时刻"的位姿参照，完整性完全依赖各成员 transform 语句链，链外改动（如删除某成员 transform）不会收到装配层警告。

这些点提醒新 API 设计（尤其 §7 的 svgExtrude/engrave 重做）：引用要**稳定**、状态要**派生**、语义要**单一**——装配只是朝这个方向走了一程，不是终点。

---

## 7. 错误接口与修复状态（❌ 明细）

| 接口 | 错误内容 | 修复方向 | 状态 |
|---|---|---|---|
| `svgExtrude({ svg: … })` | ① 整份 XML 内容拷贝；② 自然尺寸两套实现隐式推导（mesh scale=1 bug）；③ 语义挂在三角化实现上 | 内容改**资产引用**（参照 `loadByKey`）或规范化 2D 轮廓数据 + 显式尺寸参数；BREP 后端已具备（`makeWire/makeFace/addHolesInFace/extrude`） | 🔄 设计中 |
| `engrave` logo 分支（`svgText`/`svgSize`） | ① 同 svgExtrude 内容拷贝；② `svgSize` 录制有但 schema/codegen 缺失 → **.faijs 导出丢缩放参数，往返失真**；③ `faceCenter/faceNormal` 绝对快照 | logo 改**资产引用**；面改**拓扑引用**（`cad.faceCenter(of, anchor)` 几何引用 / TopoFaceRef 风格）；三件套参数完备 | 🔄 设计中 |
| `split` 文本参数断裂 | 文本层输出 `normal`/`offset`，执行层读 `planeRotation`/`planePosition` → 非默认平面无法文本复现 | 统一键名（直接序列化 `normal`/`offset`/`inPlaneAngleDeg`），加「旋转平面往返」测试 | ✅ 已修 |
| `drill` API 素材漂移 | `api.d.ts` 写 `type: 'through'|'blind'`、`direction` 为向量，与真实契约（`holeType`/`direction` 枚举）不符 → AI 照旧素材写必错 | `api.d.ts` 收敛到语句契约，删错误键 | ✅ 已修（gen-api-dts 签名驱动重写后按真实契约生成） |
| `screw.pitchCustom` | schema 有、codegen 输出缺失 → 文本往返丢失 | codegen 加 TODO 注释，待用户确认后启用 | ⏳ 暂缓（用户要求） |
| `screw.nRad` | 拓扑参数（径向分段数），schema 有、codegen 缺失 → 文本往返丢失 | codegen 补输出（非默认值 32 时序列化），设计 nRad 为 mesh 拓扑参数 + BREP 三角化提示 | ✅ 已修 |
| `screwHole` | FeatureKind 存在但无执行分派（执行走 drill.holeType='screw'） | screwHole 是 FeatureKind 别名（回退到 drill），保留 | ✅ 已确认保留 |
| `load` 四联（load/loadFile/loadUrl/loadByKey） | 语义重叠冗余 | 收敛为一个 `load` + 引用 key | ✅ 已修（语言正常化 A4：别名删除，统一 `load`，key/path/url 三选一） |
| `text.font` | 两套字体语义（THREE 字体名 vs 注册表 key），当前只有默认字体 | 定义为字体资产引用或删除参数 | ❌ 未修 |
| `wedge` 双形态 | `size` 与 `width/height/angle/length` 并存 | 收敛单一形态 | ❌ 未修 |
| `engrave.engravingType` | 冗余推导键（内容类型由 text/svgText 决定） | 重做时去掉 | ❌ 未修 |

**修复顺序**：P0 = svgExtrude、engrave(logo)（用户点名）；P1 = split 断裂、drill 素材漂移；P2 = 其余收敛。修复期间上述 ❌ 写法一律不要出现在 AI 生成代码里。

---

## 8. 写给 AI 的速查（一句话总结每个可用 op）

```
创建（同步，无 await）: box / sphere / cylinder / cone / wedge
创建（异步，await）:    text / screw / sdf / load
变换（同步）:           translate / rotate / scale
特征（异步）:           drill / extrude / split(双输出解构) / union / subtract / intersect / engrave(仅文字)
同步特征:               knurl
结构（裸调用）:         group / assembly
禁止:                   svgExtrude、engrave(logo)
面定位:                 优先 cad.faceCenter(v, [锚点]) / cad.faceNormal(v, [锚点])
交互式可编辑:           cad.faceCenter / faceNormal / bboxCenter / bboxMin / bboxMax（参数量引用）
```

还有，为何有同步、异步之分？难道不应该是调用方来决定吗？