# 装配语法 `do_assemble` 执行方案（Step 2）

- 日期：2026-08-18（v6：取消 marker + 装配 pass 落地——以代码事实为依据，给出可直接落地执行的逐文件改动方案）
- 类型：功能设计（feature design）
- 依赖：Step 1（BREP 逐 part 链，`docs/plans/2026-08-18-brep-per-part-chain.md`）
- 状态：待评审 → 待实现

---

## 0. 用户原始要求（原样保留）


先通读本项目和../3d_editor 项目的源代码，架构文档，了解装配目前是如何实现的。
下面的语法，也许未来可以实现，但是这个目前不合适：

```js
let assem1 = cad.assemble({ name, members })
assem1.add_constraint({ type: 'face_mate', fixedPartName, movingPartName, fixedFace, movingFace })
assem1.add_constraint(more...)
assem1.do_assemble()
```

目前先采用这样的语法：
```js
const assem1 = cad.assemble({ name, members, constraints })
assem1.do_assemble()
```
cad.assemble语句保持不变，保持小步快跑的开发节奏，先不碰constraints的语法变更，保持现状。除非现有语法妨碍do_assemble的实现。。变更有两点：
1. 增加'const assem1 ='的赋值
2. 增加assem1.do_assemble()语句

注意：有一个关键点，3d_editor项目是如何实现timeline节点的。我记得大概是看faijs脚本里有多少个操作，目前就是看有多少个cad.<op>。你要先确认是否是这个逻辑。
要保证assem1.do_assemble()不会增加timeline的节点。

此外，3d_editor项目装配的e2e测试，大概出错了。在没有引入faijs之前，创建一个立方体、再创建一个圆柱体、然后装配。应该是3个timeline节点。
加了faijs之后，目前的实现有错误，导致额外出现了两个移动、旋转的节点。
这次要彻底修复它。

如何实现装配，是内部逻辑。不应该把实现装配的移动、旋转泄露出去。
也就是要把它收到do_assemble里。导出faijs以后再重新导入时，也是通过do_assemble实现再装配。
当然，有一个细节，导出step/stl等文件时，必须保证是装配后的位置。

而且，不应该在3d_editor里直接处理mesh的几何变更，这是违规。所有几何变更必须走faijs语句执行。

这是第一步。
未来第二步，是实现装配拓扑的优化。可以参考这个文档C:\my\Faicad\3d_editor\docs\plans\2026-08-17-resolve-geom-ref-fallback-fix.md，其中的`faceEvolutionCache` 写入但从未消费——面演化链路断裂。
仔细分析它，我的目的是要实现拓扑面的稳定溯源，不能依靠faceOrdinal之类的东西。
怎么实现我没有想好，你先详细调研，给出一个初步的方案。

---

## 0.5 用户追加要求（原样保留）

正常的语言哪里会有isMaker这种垃圾。你要做的是，如何实现把maker这种东西删除掉。

1. 所有语句必须执行，不准跳过。就算是空执行，也是执行。

2. 所有语句，如果有赋值，一样参与terminal shape 计算。

比如 const group1 = cad.group(...)

那么输出就应该显示这个group1，而group1里的入参则从terminal shape里删除。显示group的时候，自然显示group里的元素。

3. 所有语句，不准跳过schema 校验。下面这句也是错误的

runtime.ts:591 — if (stmt.isMarker) continue

4. codegen 也必须正常输出。不准有什么maker的判断。

---

## 1. 目标与范围

### 1.1 本方案目标

**彻底取消 marker 机制（已完成的 `isMarker` → `STRUCTURAL_OPS` 只是改了名字，本质没变——仍然是跳过执行）。让所有语句一律执行，`do_assemble()` 在 faijs replay 中真正执行装配求解。**

目标语法：
```js
const assem1 = cad.assemble({ name, members, constraints })
assem1.do_assemble()
```

### 1.2 核心设计原则（用户要求）

| # | 原则 | 含义 |
|---|---|---|
| 1 | **所有语句必须执行** | 不存在"跳过"分支。结构型语句（group/assembly/assemble/add_constraint）走 dispatcher 返回空 Shape（no-op），`do_assemble` 走 dispatcher 执行装配 pass。所有语句都经过 dispatcher。 |
| 2 | **有赋值的语句参与 terminal shape** | `const group1 = cad.group(...)` → `group1` 作为终端；group 的 members 从终端列表中移除（被 group 引用了）。显示 group 时显示其包含的元素。 |
| 3 | **不准跳过 schema 校验** | `check()` 中所有语句一律过 `validateStatementArgs`。当前代码已满足（593 行循环不跳过），保持不变。 |
| 4 | **codegen 正常输出** | 按 op 类型选输出格式，不存在"marker 判断"。当前 codegen 已按 op 输出（不读 `isMarker`/`STRUCTURAL_OPS`），保持不变。 |

### 1.3 现状（本方案消除的）

- **`STRUCTURAL_OPS` 跳过逻辑**：`isMarker` 字段已删除，但 `STRUCTURAL_OPS.has(stmt.op) continue` 在 runtime/executeScript/test-helpers/cli/replay-validator 等 **11 处** 仍然跳过执行。本质和 `isMarker` 一样——换了马甲的 marker。
- **3d_editor**：裸 `cad.assembly(...)` marker + 独立 `rotate`/`translate` 语句 + mesh 烘焙落库。
- **dispatcher 中 `do_assemble`**：空壳——创建了空的 `assemblyDef`（空 members、空 constraints），什么也不做。

---

## 2. 现状核实（代码事实）

### 2.1 `STRUCTURAL_OPS` 跳过点全量清单

**faijs 侧（7 处）：**

| 文件 | 行 | 代码 | 作用 |
|---|---|---|---|
| `src/cad-runtime/runtime.ts` | 217 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | replay 主循环跳过执行 |
| `src/cad-runtime/runtime.ts` | 298 | `filter((s) => !STRUCTURAL_OPS.has(s.op))` | 无终端回退取最后非结构型语句 |
| `src/cad-runtime/runtime.ts` | 384 | `if (STRUCTURAL_OPS.has(s.op)) continue` | resolveShapeRef 子重放跳过 |
| `src/cad-runtime/runtime.ts` | 451 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | plan() 增量分析跳过 |
| `src/test-helpers.ts` | 37 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 测试 replay 跳过 |
| `src/test-helpers.ts` | 51 | `filter(s => !STRUCTURAL_OPS.has(s.op))` | 测试取终端跳过 |
| `src/node-host/cli.ts` | 129 | `filter((s) => !STRUCTURAL_OPS.has(s.op)).pop()` | CLI 导出取终端跳过 |
| `src/lang/parser.ts` | 891 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | terminal shape 计算跳过 |

**3d_editor 侧（11 处）：**

| 文件 | 行 | 代码 | 作用 |
|---|---|---|---|
| `executeScript.ts` | 199 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 执行跳过 |
| `executeScript.ts` | 335 | `filter((s) => !STRUCTURAL_OPS.has(s.op))` | 无终端回退 |
| `executeScript.ts` | 677 | `if (!STRUCTURAL_OPS.has(s.op)) baseById.set(s.id, s)` | diff 映射排除 |
| `executeScript.ts` | 681 | `if (!STRUCTURAL_OPS.has(s.op)) newById.set(s.id, s)` | diff 映射排除 |
| `executeScript.ts` | 686 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | diff 分类跳过 |
| `executeScript.ts` | 701 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | DELETE 检测跳过 |
| `executeScript.ts` | 710 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 孤儿检测跳过 |
| `executeScript.ts` | 738 | `filter((s) => !STRUCTURAL_OPS.has(s.op)).length` | reused 计数 |
| `executeScript.ts` | 771 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 增量执行跳过 |
| `replay-validator.ts` | 124 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 校验 replay 跳过 |
| `replay-validator.ts` | 139 | `filter(s => !STRUCTURAL_OPS.has(s.op))` | 取终端跳过 |
| `ScriptEngine.ts` | 1432 | `filter(s => !STRUCTURAL_OPS.has(s.op))` | 取终端跳过 |

**结论：以上全部 `STRUCTURAL_OPS` 跳过逻辑都是 `isMarker` 换皮，必须消除。**

### 2.2 Parser —— 两种装配形态并存

| 写法 | 触发分支 | 产物 |
|---|---|---|
| 链：`let assem1=cad.assemble({...})` → `assem1.do_assemble()` | `parser.ts:662-702` / `792-828` | `op='assemble'`（带 `assemblyVar`）+ `op='do_assemble'`（带 `assemblyTarget`） |
| 裸调用：`cad.assembly({ name, members, constraints })` | `parser.ts:754-788` | `op='assembly'`，`args={name, members, constraints}` |

**需要的 parser 改动**：
- `parser.ts:664` 的 `stmtNode.kind === 'let'` → 放宽为 `const || let`。
- `group`/`assembly` 裸调用支持 `const group1 = cad.group(...)` 赋值形式（目前只认 ExpressionStatement 裸调用）。

### 2.3 dispatcher 中 `do_assemble` —— 空壳

`src/ops/dispatcher.ts:211-225`：
```ts
case 'do_assemble': {
  const { executeDoAssemble } = await import('./assemble')
  const assemblyDef = {
    name: undefined as string | undefined,
    members: [] as string[],
    constraints: [] as AssemblyConstraint[],
  }
  // ↑ 空 assemblyDef！什么也不做！
  if (outputCache) {
    executeDoAssemble(assemblyDef, outputCache)
  }
  return { positions: new Float32Array(0), indices: new Uint32Array(0) }
}
```

**问题**：`assemblyDef` 是空的，`executeDoAssemble` 拿不到约束数据。真正的装配定义在 `assemble` 语句的 `args` 里，但 dispatcher 无法跨语句访问。

### 2.4 `assemble.ts` —— 数学已正确，但缺桥接

`src/ops/assemble.ts` 已实现：
- `solveFaceMate(fixedCenter, fixedNormal, movingCenter, movingNormal)`（`assemble.ts:147`）：返回 `{ quaternion, pivot, translation, rotationMatrix }`。
- `applyTransform(shape, quaternion, pivot, translation, rotationMatrix)`（`assemble.ts:182`）：绕 pivot 旋转 + 平移，只烘焙 mesh。
- `executeDoAssemble(assemblyDef, outputCache)`（`assemble.ts:223`）：遍历 constraints，求变换写回 `outputCache`。

**缺口 1：constraints 类型不匹配**。`FaceMateConstraint` 要求 `fixedFace`/`movingFace` 带 `center`/`normal`。但 3d_editor 的 `TopoFaceRef` 只有 `faceId` + `surfaceType`。需要 `faceId → {center, normal}` 解析桥。

**缺口 2：只动 mesh，不动 BREP**。`executeDoAssemble` 只烘焙 `outputCache`，不动 `solidCache`。BREP 件装配后 `solidCache` 仍停在旧位置。

### 2.5 拓扑数据

- `FaceRow`（`src/topology/types.ts:103-125`）已带 `id` / `center` / `normal` / `surfaceType`。
- `ExecutionResult.topology` 从 `topologyCache` 产出（`runtime.ts:315`）。
- `topologyCache` 由宿主在 replay 后通过 `setTopology(partName, source, data)` 注入。
- BREP 件的内联拓扑构建已存在：`buildSolidTopologyRuntime(kernel, solid)`（`src/brep/brep-topology.ts:44-81`）。
- mesh 件的拓扑由宿主在文件加载时注入。

### 2.6 BREP 变换接口已存在

`src/brep/brep-ops.ts`：
- `matrixToArray(matrix: THREE.Matrix4): number[]`（`brep-ops.ts:648`）：将 THREE.Matrix4 转为 OCCT 所需的 3x4 row-major 数组。
- `kernel.transform(solid, matrixArray)`：直接吃 4x4 矩阵。

### 2.7 Codegen —— 已按 op 输出，不需要改

`src/lang/codegen.ts` 的 `statementToLine` 和 `scriptToCode` 已按 `stmt.op` 分支输出，不读 `STRUCTURAL_OPS`/`isMarker`。结构型语句各自有正确的输出格式。

**唯一要改**：`let` → `const`（2 处：`codegen.ts:370` 和 `447`）。

### 2.8 Schema 校验 —— 已不跳过

`runtime.ts` 的 `check()` 方法（593 行）遍历所有语句过 `validateStatementArgs`，不跳过结构型语句。`args-schema.ts` 已为 group/assembly/assemble/add_constraint/do_assemble 定义了 schema。**已满足用户要求，不需要改。**

---

## 3. 设计：取消 marker + 装配 pass

### 3.1 核心设计：所有语句一律执行

**取消 `STRUCTURAL_OPS` 跳过逻辑。** 所有语句（含 group/assembly/assemble/add_constraint/do_assemble）一律进入 dispatcher 执行。

| op | dispatcher 行为 | 产出 |
|---|---|---|
| `group` | no-op：返回空 Shape | 空 Shape（不写 outputCache，不作为终端——由 terminal shape 算法处理） |
| `assembly` | no-op：返回空 Shape | 同上 |
| `assemble` | no-op：返回空 Shape。**注册装配定义到 runtime 上下文**（供 do_assemble 消费） | 同上 |
| `add_constraint` | no-op：返回空 Shape。**注册约束到 runtime 上下文**（供 do_assemble 消费） | 同上 |
| `do_assemble` | **执行装配 pass**：从上下文取装配定义 + 约束 → resolveFace → solveFaceMate → applyTransform mesh + kernel.transform BREP | 空 Shape（不产出新几何，只修改 outputCache 中已有 part 的几何） |

**关键**：no-op 也是"执行"了——走 dispatcher，过 schema，写 statementCache（空 Shape），参与 plan() 增量分析。不再有任何 `continue` 跳过。

### 3.2 Terminal Shape 算法重写

**当前算法**（`parser.ts:879-913`）：收集所有非 `STRUCTURAL_OPS` 语句的 id → 不被引用的 = 终端。结构型语句被跳过。

**新算法**：

```
1. 收集所有语句的 id（含结构型语句，不跳过任何语句）。
   - 普通语句 id = stmt.id
   - split 多输出 id = stmt.outputs
   - 结构型语句有赋值的（如 const group1 = cad.group(...)）→ id = stmt.id
   - 结构型语句无赋值的（如 cad.group(...) 裸调用）→ 无 id（不参与终端）
2. 收集"被引用"的 id：
   - 普通语句的 inputs
   - 结构型语句的 args.members / args.constraints 中的 partName / scopedId
3. 终端 = 不被引用的输出 id
```

**group 作为终端的语义**：`const group1 = cad.group({ members: ['part0_v0', 'part1_v0'] })` → `group1` 是终端，`part0_v0` 和 `part1_v0` 被 group 引用 → 不再是终端。显示 group 时显示其包含的元素。

**实现**：
- parser 中 group/assembly/assemble 语句如果有赋值（`const xxx = cad.group(...)`），需要记录变量名 → `stmt.id` 映射，并且 `stmt.id` 不再是 `grp_N` 而是有意义的 id。
- 但当前 parser 对 group/assembly 只支持裸调用（ExpressionStatement），不支持赋值。**本次方案不改 parser 的 group 解析**——保持裸调用，无赋值 → 无 id → 不参与终端。这和现状一致。
- **assemble 语句**已有 `assemblyVar`（如 `assem1`），但 `id` 是 `grp_N`。assemble 不产出几何，不应作为终端。
- **do_assemble 语句**的 `id` 是 `grp_N`，不产出几何，不应作为终端。

**简化方案**：terminal shape 计算只看"是否被引用" + "是否产出几何"。
- 结构型语句不产出几何 → 不作为终端（**但不跳过执行**）。
- 结构型语句引用的 members 从终端列表移除。

```
terminal shape 计算：
1. referencedIds = 所有语句的 inputs ∪ 结构型语句的 args.members ∪ args.constraints 中的 partName
2. outputIds = 产出几何的语句的 id（跳过 group/assembly/assemble/add_constraint/do_assemble）
3. terminals = outputIds 中不被 referencedIds 引用的
```

**注意**：这里"跳过结构型语句"仅用于 terminal shape 计算（不产出几何的语句不是终端），**不影响执行**。所有语句仍然执行。

### 3.3 `STRUCTURAL_OPS` 的去留

**`STRUCTURAL_OPS` 这个 Set 保留**，但语义收窄为：**"这些 op 不产出几何"**——仅用于：
1. terminal shape 计算：排除不产出几何的语句（不作为终端）。
2. CLI/回退取终端：排除不产出几何的语句。

**不再用于**：跳过执行、跳过 schema、跳过 plan()、跳过 diff。

即 `STRUCTURAL_OPS` 从"跳过执行"变为"不产出几何"标记，职责单一。

### 3.4 `do_assemble` 装配 pass 设计

#### 问题：dispatcher 无状态

dispatcher 的 `executeStatement` 是无状态函数，无法跨语句保存装配上下文。`assemble` 语句的 `args`（含 members/constraints）需要传给后续的 `do_assemble`。

#### 方案：runtime 注入装配上下文

**在 runtime 的 replay 主循环中维护装配上下文**（不在 dispatcher 里）：

```ts
// runtime.ts replay() 主循环
interface AssemblyContext {
  name?: string
  members: string[]
  constraints: AssemblyConstraintRaw[]
}

let assemblyContexts = new Map<string, AssemblyContext>()  // varName → def
```

主循环中：

```ts
for (let i = 0; i < script.statements.length; i++) {
  const stmt = script.statements[i]

  // 装配上下文收集（在 dispatcher 调用前）
  if (stmt.op === 'assemble') {
    const varName = stmt.assemblyVar ?? 'assem1'
    assemblyContexts.set(varName, {
      name: stmt.args.name as string | undefined,
      members: stmt.args.members as string[],
      constraints: (stmt.args.constraints as AssemblyConstraintRaw[]) ?? [],
    })
    // 仍然走 dispatcher（no-op），保证执行不跳过
  }

  if (stmt.op === 'add_constraint') {
    const targetVar = stmt.assemblyTarget ?? 'assem1'
    const ctx = assemblyContexts.get(targetVar)
    if (ctx) {
      ctx.constraints.push(stmt.args as unknown as AssemblyConstraintRaw)
    }
    // 仍然走 dispatcher（no-op）
  }

  // beforeStatement 钩子
  opts?.beforeStatement?.(stmt, i)

  // 解析输入（结构型语句 inputs=[] → 空）
  const inputGeometries: Shape[] = []
  for (const inputRef of stmt.inputs) {
    let geo = outputCache.get(inputRef) ?? opts?.inputGeometryMap?.get(inputRef)
    if (!geo) {
      geo = await this.resolveShapeRef(inputRef, outputCache, opts?.sceneScript)
      outputCache.set(inputRef, geo)
    }
    inputGeometries.push(geo)
  }

  // do_assemble 特殊处理：在 dispatcher 之前执行装配 pass
  if (stmt.op === 'do_assemble') {
    const targetVar = stmt.assemblyTarget ?? 'assem1'
    const def = assemblyContexts.get(targetVar)
    if (!def) {
      throw new Error(`[CadRuntime] do_assemble: assembly "${targetVar}" not found`)
    }
    await this.executeAssemblyPass(def, outputCache, brepChain)
    // do_assemble 仍然走 dispatcher（返回空 Shape），保证不跳过
  }

  // mesh-only / brep 检查（结构型语句不会触发——它们的 op 不在 MESH_ONLY_OPS 中）
  // ...

  // 执行语句（所有语句一律走 dispatcher）
  const result = await dispatchStatement(stmt, inputGeometries, outputCache, paramsMap, brepChain, this.ports, this.mode)
  outputCache.set(stmt.id, result)

  // 写入 statementCache（所有语句都写缓存，含结构型语句）
  const contentKey = computeContentKey(result.positions, result.indices)
  const getInputContentKey = (id: string) => this.statementCache.get(id)?.outputContentKey
  const stmtKey = computeStatementKey(stmt, getInputContentKey)
  this.statementCache.set(stmt.id, {
    statementKey: stmtKey,
    outputContentKey: contentKey,
    output: result,
  })
}
```

**关键变化**：
1. 删除 `if (STRUCTURAL_OPS.has(stmt.op)) continue`（217 行）。
2. 所有语句走 dispatcher。
3. `assemble`/`add_constraint` 在 dispatcher 前收集上下文。
4. `do_assemble` 在 dispatcher 前执行装配 pass（副作用：修改 outputCache/solidCache）。
5. dispatcher 中结构型语句返回空 Shape（no-op）。
6. 所有语句写 statementCache。

#### `executeAssemblyPass` 方法

```ts
private async executeAssemblyPass(
  def: AssemblyContext,
  outputCache: Map<string, Shape>,
  brepChain: BrepChainState,
): Promise<void> {
  for (const constraint of def.constraints) {
    if (constraint.type !== 'face_mate' && constraint.type !== undefined) {
      throw new Error(`[assemble] unsupported constraint type: ${constraint.type}`)
    }

    const fixedPartName = constraint.fixedScopedId ?? constraint.fixedPartName
    const movingPartName = constraint.movingScopedId ?? constraint.movingPartName

    // 解析面心/法向
    const fixedFace = await this.resolveFace(fixedPartName, constraint.fixedFace, outputCache, brepChain)
    const movingFace = await this.resolveFace(movingPartName, constraint.movingFace, outputCache, brepChain)

    // 求解刚体变换
    const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
      fixedFace.center, fixedFace.normal,
      movingFace.center, movingFace.normal,
    )

    // Mesh（outputCache）：烘焙变换后的顶点
    const movingShape = outputCache.get(movingPartName)
    if (movingShape) {
      const transformed = applyTransform(movingShape, quaternion, pivot, translation, rotationMatrix)
      outputCache.set(movingPartName, transformed)
    }

    // BREP（solidCache）：刚体变换 OCCT 实体
    if (brepChain.kernel && brepChain.solidCache.has(movingPartName)) {
      const solid = brepChain.solidCache.get(movingPartName)!
      // 组装 4x4 刚体矩阵
      const R = new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
      )
      const t = new THREE.Vector3(...translation)
      const piv = new THREE.Vector3(...pivot)
      const Rpivot = new THREE.Vector3(...pivot).applyMatrix4(R)
      const finalTranslation = piv.clone().sub(Rpivot).add(t)
      const M = new THREE.Matrix4().multiply(R, new THREE.Matrix4().makeTranslation(
        finalTranslation.x, finalTranslation.y, finalTranslation.z
      ))
      const matrixArray = matrixToArray(M)
      const transformedSolid = brepChain.kernel.transform(solid, matrixArray)
      try { brepChain.kernel.release(solid) } catch { /* 已释放 */ }
      brepChain.solidCache.set(movingPartName, transformedSolid)
    }
  }
}
```

#### `resolveFace` 方法

```ts
private async resolveFace(
  partName: string,
  faceRef: { faceId: string; surfaceType: string },
  outputCache: Map<string, Shape>,
  brepChain: BrepChainState,
): Promise<{ center: [number, number, number]; normal: [number, number, number] }> {
  // 1. 已有拓扑缓存
  let topo = this.topologyCache.get(partName)

  // 2. BREP 件：内联构建拓扑
  if (!topo && brepChain.kernel && brepChain.solidCache.has(partName)) {
    const solid = brepChain.solidCache.get(partName)!
    const result = buildSolidTopologyRuntime(brepChain.kernel, solid)
    topo = {
      partName,
      source: 'brep' as TopologySource,
      data: { ...result, faces: result.runtime.faces } as unknown as SelectorRuntimeData,
    }
    this.topologyCache.set(partName, topo)
  }

  if (!topo) {
    throw new Error(`[assemble] topology not available for part "${partName}"`)
  }

  // 3. 从拓扑中按 faceId 查找面
  const faces = (topo.data as unknown as { faces: FaceRow[] }).faces
  const face = faces.find(f => f.id === faceRef.faceId)
  if (!face) {
    throw new Error(`[assemble] face "${faceRef.faceId}" not found in part "${partName}"`)
  }
  if (!face.center || !face.normal) {
    throw new Error(`[assemble] face "${faceRef.faceId}" has no center/normal data`)
  }

  return {
    center: [face.center[0], face.center[1], face.center[2]],
    normal: [face.normal[0], face.normal[1], face.normal[2]],
  }
}
```

### 3.5 resolveShapeRef 子重放循环改动

`runtime.ts:382-401` 的子重放循环也有 `if (STRUCTURAL_OPS.has(s.op)) continue`（384 行）。

**改动**：删除跳过逻辑，所有语句走 dispatcher。同时复制装配上下文收集 + do_assemble 执行逻辑（同主循环）。

### 3.6 plan() 增量分析改动

`runtime.ts:449-451` 的 `if (STRUCTURAL_OPS.has(stmt.op)) continue` 删除。

结构型语句参与增量分析：它们的 `statementKey` 由 `op + args + inputs` 组成。args 变化（如 group 的 members 变了）→ statementKey 变化 → 标记为 stale → 重算。重算走 dispatcher 返回空 Shape（no-op），不产生错误。

### 3.7 terminal shape 计算改动

`parser.ts:879-913` 的 `computeTerminalShapes`：

**当前**：跳过 `STRUCTURAL_OPS` 语句，不收集它们的 id。

**改动**：
1. 仍然跳过结构型语句的 id 收集（它们不产出几何，不作为终端）。
2. **新增**：收集结构型语句引用的 id（`args.members` / `args.constraints` 中的 partName / scopedId），加入 `referencedIds`。这样 group 的 members 从终端列表中移除。

```ts
export function computeTerminalShapes(statements: CadStatement[]): TerminalShape[] | undefined {
  const referencedIds = new Set<string>()
  for (const stmt of statements) {
    // 普通语句的 inputs
    for (const inputId of stmt.inputs) {
      referencedIds.add(inputId)
    }
    // 结构型语句引用的 members/constraints 中的 partName
    if (STRUCTURAL_OPS.has(stmt.op)) {
      const members = stmt.args.members
      if (Array.isArray(members)) {
        for (const m of members) {
          if (typeof m === 'string') referencedIds.add(m)
        }
      }
      const constraints = stmt.args.constraints
      if (Array.isArray(constraints)) {
        for (const c of constraints) {
          if (c && typeof c === 'object') {
            const fn = c.fixedScopedId ?? c.fixedPartName
            const mn = c.movingScopedId ?? c.movingPartName
            if (typeof fn === 'string') referencedIds.add(fn)
            if (typeof mn === 'string') referencedIds.add(mn)
          }
        }
      }
    }
  }

  // 收集所有产出几何的语句 id（跳过结构型语句——它们不产出几何）
  const outputIds: string[] = []
  for (const stmt of statements) {
    if (STRUCTURAL_OPS.has(stmt.op)) continue  // 仅 terminal 计算跳过，不影响执行
    outputIds.push(stmt.id)
    if (stmt.outputs) {
      for (const outId of stmt.outputs) {
        outputIds.push(outId)
      }
    }
  }

  // 终端 = 不被引用的输出
  const terminals: TerminalShape[] = []
  const seen = new Set<string>()
  for (const id of outputIds) {
    if (referencedIds.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    terminals.push({ id })
  }

  if (terminals.length <= 1) return undefined
  return terminals
}
```

### 3.8 dispatcher 改动

`src/ops/dispatcher.ts` 的结构型语句分支保留（返回空 Shape），但 `do_assemble` 分支简化——装配 pass 已在 runtime 中执行，dispatcher 中的 `do_assemble` 只需返回空 Shape：

```ts
case 'group':
case 'assembly':
case 'assemble':
case 'add_constraint':
case 'do_assemble': {
  // no-op：结构型语句不产出几何。
  // do_assemble 的装配 pass 在 runtime 主循环中执行（副作用写回 outputCache/solidCache）。
  return { positions: new Float32Array(0), indices: new Uint32Array(0) }
}
```

### 3.9 test-helpers.ts 改动

删除 `STRUCTURAL_OPS` 跳过（37 行）和终端过滤（51 行）。

**改动后**：
```ts
for (const stmt of script.statements) {
  // 所有语句走 dispatcher（含结构型 no-op）
  const inputGeometries: Shape[] = []
  for (const inputRef of stmt.inputs) {
    const geo = outputCache.get(inputRef) ?? inputGeometryMap?.get(inputRef)
    if (!geo) {
      throw new Error(`[replayScript] missing input geometry for ref "${inputRef}" in statement "${stmt.id}"`)
    }
    inputGeometries.push(geo)
  }
  const result = await executeStatement(stmt, inputGeometries, outputCache, params, brepChain, ports, mode)
  outputCache.set(stmt.id, result)
}

// 取终端：用 script.terminalShapes 或回退到最后一条产出几何的语句
const terminals = script.terminalShapes ?? []
if (terminals.length > 0) {
  const lastTerm = terminals[terminals.length - 1]
  const finalShape = outputCache.get(lastTerm.id)!
  // ...
} else {
  // 回退：最后一条非 STRUCTURAL_OPS 的语句
  const nonStructStmts = script.statements.filter(s => !STRUCTURAL_OPS.has(s.op))
  // ...
}
```

### 3.10 cli.ts 改动

`cli.ts:129` 的 `filter((s) => !STRUCTURAL_OPS.has(s.op)).pop()` 改为优先使用 `execResult.terminals`：

```ts
const terminals = execResult.terminals ?? []
if (terminals.length > 0) {
  // 用终端
} else {
  // 回退到最后一条非结构型语句
  const lastStmt = script.statements.filter((s) => !STRUCTURAL_OPS.has(s.op)).pop()
  // ...
}
```

**注意**：CLI 取终端仍用 `STRUCTURAL_OPS` 过滤——因为终端只看产出几何的语句。这不违反"不准跳过执行"——执行已经全部走了，这里只是取导出目标。

### 3.11 3d_editor 侧改动

#### executeScript.ts

**删除所有 `STRUCTURAL_OPS.has(stmt.op) continue` 跳过**（199, 686, 701, 710, 771 行）。

所有语句走 `executeStatement`。结构型语句在 dispatcher 中返回空 Shape，不影响场景。

**diff 逻辑**（677-681 行）：`baseById`/`newById` 不再排除结构型语句。结构型语句参与 diff 分类——args 变化 → PARAM → 重算（no-op）。id 是 `grp_N`，N 每次重建可能不同 → 误判为 ADD/DELETE。

**`grp_N` id 不稳定问题**：这是 parser 用 `_grpCounter` 生成的递增 id，每次 parse 可能不同。

**解决方案**：parser 中 group/assembly/assemble 语句的 id 改为确定性 id——基于变量名或内容哈希。例如 `assemble` 语句用 `assemblyVar` 作为 id 的一部分：`assem_assem1`。`group` 裸调用用 `grp_${hash(args)}`。

**但这改动范围大**。简化方案：diff 逻辑中结构型语句按"类型 + args 内容"匹配，不按 id 匹配。即 `baseById`/`newById` 用 `op + JSON.stringify(args)` 作为 key（而非 `s.id`）。

**更简化**：diff 逻辑保留对结构型语句的排除（仅 diff 用途，不影响执行）。执行不再跳过，但 diff 仍只对几何语句做增量分类。

```ts
// diff 映射：仍排除结构型语句（仅 diff 用途，不影响执行）
for (const s of baseScript.statements) {
  if (!STRUCTURAL_OPS.has(s.op)) baseById.set(s.id, s)
}
```

**这和"不准跳过执行"不矛盾**：diff 是增量分析，不是执行。执行已不再跳过。

#### replay-validator.ts / ScriptEngine.ts

同理：删除执行跳过（124 行），保留终端过滤（139 行——终端只看产出几何的语句）。

### 3.12 codegen 改动

**仅 2 处**：`let` → `const`。

`codegen.ts:370`：
```ts
return `let ${varName} = cad.assemble({ ${parts.join(', ')} })`
```
→
```ts
return `const ${varName} = cad.assemble({ ${parts.join(', ')} })`
```

`codegen.ts:447`：
```ts
bodyLines.push(`let ${varName} = cad.assemble({ ${argsParts.join(', ')} })`)
```
→
```ts
bodyLines.push(`const ${varName} = cad.assemble({ ${argsParts.join(', ')} })`)

---

## 4. 逐文件改动契约

### 4.1 faijs 侧

| 文件 | 改动 |
|---|---|
| src/lang/parser.ts | (1) cad.assemble 分支放宽 let -> const||let。(2) computeTerminalShapes 新增结构型语句引用的 members/constraints partName 收集到 referencedIds。 |
| src/lang/codegen.ts | statementToLine 和 scriptToCode 的 assemble 输出 let -> const（2 处）。 |
| src/cad-runtime/runtime.ts | (1) replay 主循环删除 STRUCTURAL_OPS 跳过，所有语句走 dispatcher。(2) 新增装配上下文收集。(3) 新增 do_assemble 装配 pass。(4) 新增 executeAssemblyPass 方法。(5) 新增 resolveFace 方法。(6) resolveShapeRef 子重放删除跳过。(7) plan() 删除跳过。(8) 新增 import。 |
| src/ops/dispatcher.ts | do_assemble 分支简化：合并到统一 no-op 分支。 |
| src/ops/assemble.ts | 不改函数实现。保留导出。 |
| src/test-helpers.ts | 删除执行跳过，保留终端过滤。 |
| src/node-host/cli.ts | 终端取值优先用 execResult.terminals。 |

### 4.2 3d_editor 侧

| 文件 | 改动 |
|---|---|
| executeScript.ts | (1) 删除执行跳过（199、771 行）。(2) diff 逻辑保留 STRUCTURAL_OPS 排除——仅 diff 用途，不影响执行。 |
| replay-validator.ts | (1) 删除执行跳过（124 行）。(2) 终端取值保留 STRUCTURAL_OPS 过滤。 |
| ScriptEngine.ts | 终端取值保留 STRUCTURAL_OPS 过滤。 |
| assemble-store.ts | confirmAssemble 删除 rotate/translate 语句和 executeAssembleTransform。改为 createAssembly + recomputePart。 |
| model-store.ts | createAssembly 改为 op=assemble + 追加 do_assemble 语句。do_assemble 不设 feature。 |
| TimelinePanel.tsx | 跳过 do_assemble 不产生 timeline 节点。optional chaining。 |
| feature-registry.tsx | 注册 assemble kind。getFeatureDef 加 optional chaining。 |
| test/e2e/assembly.spec.ts | 节点计数 6->3。导出文本断言改为 cad.assemble + do_assemble。 |

### 4.3 STRUCTURAL_OPS 最终职责

| 用途 | 保留/删除 | 理由 |
|---|---|---|
| 执行跳过 | 删除 | 用户要求：所有语句必须执行 |
| schema 校验跳过 | 已删除 | 当前代码已不跳过 |
| plan() 增量分析跳过 | 删除 | 所有语句参与增量 |
| terminal shape 计算排除 | 保留 | 不产出几何的语句不是终端 |
| CLI/回退取终端排除 | 保留 | 同上 |
| diff 增量分析排除 | 保留（3d_editor） | grp_N id 不稳定，diff 需排除。不影响执行。 |

核心区分：STRUCTURAL_OPS 只用于筛选产出几何的语句（终端计算/导出/diff），不用于跳过执行。

---

## 5. 测试用例

### 5.1 faijs 单元测试

新增 src/cad-runtime/runtime-assembly.test.ts：
- 装配后 moving 件位置变化验证
- do_assemble 不产生额外 timeline 节点（terminalShapes 只含几何语句）
- 导出再导入位置一致验证（codegen -> parse -> replay -> 位置相同）
- BREP 件装配后 solidCache 同步变换验证
- 结构型语句走过 dispatcher 验证（spy dispatchStatement 调用次数 = 语句总数）
- group 引用的 members 从终端列表移除验证

### 5.2 3d_editor e2e 测试

test/e2e/assembly.spec.ts 改造：
1. 前置流程不变：创建 cube、创建 cylinder、移动 cylinder、装配模式、点两面、确认装配。
2. timeline 节点断言 6->3（cube + cylinder + assemble；do_assemble 不产生节点）。
3. 导出文本断言：cad.assemble + do_assemble 存在，不再有 cad.rotate / cad.translate。
4. 再导入验证：导入导出的 faijs 后，两零件仍在装配位置。

### 5.3 既有测试

- src/ops/assemble.test.ts 保留为单元层。
- src/lang/parser-assembly.test.ts 的 let 断言改为 const。

---

## 6. timeline 节点计数逻辑

### 6.1 确认结论

- timeline 节点 = sceneScript 语句数（每条语句一个节点，含已注册 kind 的结构型语句）。
- do_assemble 不设 feature -> getFeatureDef 返回 null -> timeline 不渲染 -> 0 个节点。
- 装配内部 rotate/translate 不再作为独立语句 -> 从源头消除额外节点。
- 3 个节点 = cube + cylinder + assemble。

### 6.2 do_assemble 不产生 timeline 节点的实现

1. do_assemble 语句不设 feature。
2. TimelinePanel 的 useAllTimelineItems 遍历所有语句，但 getFeatureDef(stmt) 对无 feature 的语句返回 null -> TimelineNode 返回 null -> 不渲染。
3. e2e 计数逻辑跳过 do_assemble。

---

## 7. 装配 pass 数学说明

applyTransform（mesh 路径）公式：p = R*(p-pivot) + pivot + translation

展开后：p = R*p + (pivot - R*pivot + translation)

BREP 路径用同一个矩阵 M = R * T(pivot - R*pivot + translation)，经 matrixToArray 转为 OCCT 格式后调 kernel.transform。

两者数学一致，保证 mesh 与 BREP 位置同步。

---

## 8. 导出位置保证

- mesh 件：outputCache[movingPartName] 已被 applyTransform 烘焙 -> STL/三角化 STEP 导出天然用装配后顶点。
- BREP 件：solidCache[movingPartName] 已被 kernel.transform 刚体变换 -> 精确 STEP 导出用装配后实体。
- 导出层无需装配感知代码。
- faijs 再导入：导出的文本含 cad.assemble({...constraints}) + do_assemble() -> 重新 parse + replay -> 同一装配 pass 重新求解 -> 位置复现。

---

## 9. 第二步：拓扑面稳定溯源（初步方案，待评审）

> 用户原始要求（原样保留）：
>
> 第二步，是实现装配拓扑的优化。可以参考这个文档C:\my\Faicad\3d_editor\docs\plans\2026-08-17-resolve-geom-ref-fallback-fix.md，其中的 faceEvolutionCache 写入但从未消费——面演化链路断裂。
> 仔细分析它，我的目的是要实现拓扑面的稳定溯源，不能依靠faceOrdinal之类的东西。
> 怎么实现我没有想好，你先详细调研，给出一个初步的方案。

### 9.1 现状调研结论

1. faceEvolutionCache 写入端已实现（brep-chain.ts:122），但读取端 resolveGeomRef 从未接线。
2. hash 不可持久化（TopoDS_TShape 对象内存地址的 Murmur 哈希）。
3. ordinal 不可靠（布尔操作改变面顺序）。
4. FaceRow.id 本身是 ordinal 派生。

### 9.2 初步方案：FaceLineage —— 面谱系

核心思路：把面身份系在面从哪来（谱系链）上，重放时沿语句链重建谱系 -> 定位当前面。

FaceLineage = { root: { stmtId, ordinal }, tags: Array<{ op, ordinal }> }

### 9.3 实施顺序

1. P0（本次实现）：resolveFace 的 faceId 解析主路径落地 -> 装配可运行。
2. P1：faceEvolutionCache 补全写入 + face-lineage.ts 穿越算法 + FaceRow.lineage 字段。
3. P2：装配约束引用 lineage；3d_editor 拾取面时记录 lineage。
4. P3：root 定位降级几何指纹；1->N 消歧策略；mesh 指纹溯源。

---

## 10. 开放决策

1. move flush 的处理：建议保留为独立 transform 语句（用户建模操作，导出/再导入位置一致）。
2. mesh 件拓扑约束：非盒状 mesh 在 faijs 核心无通用拓扑重建能力。通用 mesh 装配依赖 3d_editor 在 setTopology 注入面拓扑。
3. grp_N id 不稳定问题：diff 逻辑用 STRUCTURAL_OPS 排除结构型语句（仅 diff 用途）。未来可考虑确定性 id。

---

## 11. 一句话总结

取消 marker：所有语句一律执行（含 no-op 的结构型语句和执行装配 pass 的 do_assemble）。装配几何变更全经 faijs 语句执行。

```js
const assem1 = cad.assemble({ name, members, constraints })
assem1.do_assemble()
```

- faijs 侧：删除 STRUCTURAL_OPS 执行跳过（保留终端/diff 筛选用途）；parser 放宽 let->const；codegen 输出 const；runtime 在 do_assemble 处执行装配 pass；所有语句走 dispatcher、写 statementCache、参与 plan() 增量分析。
- 3d_editor 侧：confirmAssemble 删除独立 rotate/translate 语句与 executeAssembleTransform；改为 createAssembly 产出 assemble + do_assemble 语句，然后调 recomputePart 走 faijs replay 求解落库；TimelinePanel 过滤 do_assemble、feature-registry 注册 assemble kind。
- 效果：装配几何变更全经 faijs 语句执行（红线修复）；do_assemble 不产生 timeline 节点；独立 rotate/translate 语句消失 -> 6->3；导出天然取装配后位置；faijs 再导入经同一 pass 复现装配。
- 第二步（拓扑面稳定溯源）给出 FaceLineage 谱系方案，待评审。