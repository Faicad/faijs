/**
 * arg-spec — L3 投影签名适配表（E5 唯一人工维护点）
 *
 * 设计文档：docs/plans/2026-09-02-faijs-api-surface-completion.md §E5 / §5.2
 *
 * 输入：brepjs `src/index.ts`（upstream-surface.json 已按 §2.6 排除）。
 * 作用：为每个保留符号声明「faijs 面投影方式」。生成器
 * `scripts/gen-l3-surface.ts` 读取本表 + surface 清单，产出
 * `api/generated/<module>.ts`（E5：不手写 699 个；本表之外符号按默认规则推导）。
 *
 * 产出类别（对齐 §5.2 / E5 分类表；生成器按本类判别产出）：
 *   brep-op : defineOp({ brep }) —— Solid 进出（构造/变换/布尔/修饰，consumes 'none'|'all'）
 *   query   : 普通导出函数（输入 Shape 借入 brepjs handle → 调 vendored → 返回纯数据；
 *             返回非 Shape，不进 defineOp——先例 api/geom.ts，generated/topology.ts getBounds）
 *   pure    : 无 Shape 参数的纯函数 → 直接 re-export（不进 defineOp，不是 op）
 *   type    : `export type { … } from '<vendored>'` re-export
 *   skip    : 登记跳过（divergence：语义 faijs 面无法表达 / 已由 faijs 既有 op 覆盖），带 reason
 *
 * 双形态（E2）：同名符号由生成器注入 `normalizeArgs` 判别器（faijs 对象形态 ↔ brepjs
 * 位置形态），适配表给 faijs 形参映射；本文件首批样本聚焦「faijs 无同名」的纯新增符号，
 * 双形态条目随 §5.1 同名处置逐批加入（P14 分批）。
 *
 * P13a 机制验证样本（4 条，覆盖 type / brep-op 构造 / brep-op 布尔 / query 四类产出路径）：
 *   1. Bounds3D  — type re-export（topology/shapeFns）
 *   2. torus     — brep-op 构造（topology/primitiveFns，faijs 无同名）
 *   3. fuse      — brep-op 布尔（topology/booleanFns，faijs 用 union，fuse 无同名）
 *   4. getBounds — query（topology/shapeFns，consumes:'none'，faijs 用 bbox* 但无同名）
 */

/** 生成器可用的投影方式。 */
export type ProjectionKind = 'brep-op' | 'query' | 'pure' | 'type' | 'skip'

/** brep-op / query 的时间线消费声明（透传 defineOp 元数据，G3/G4）。 */
export type Consume = 'all' | 'none' | number[]

/**
 * 单条投影适配。
 *
 * - `name`   faijs 面导出名（= brepjs 符号名；同名冲突已在 §5.1 处置后由本表登记双形态或改名）。
 * - `source` vendored 树内的来源符号，`<相对 vendored 根的模块路径>#<导出名>`（默认同名）。
 * - `kind`   投影类别（见文件头）。
 * - `args`   brep-op/query：调用约定描述，供生成器产出 JSDoc 与 normalizeArgs 占位；
 *            type/pure：无需 args（直接 re-export）。
 * - `consumes` brep-op/query 的 defineOp consumes 声明；缺省 'all'（构造类显式 'none'）。
 */
export interface ArgSpecEntry {
  name: string
  source: string
  kind: ProjectionKind
  /** Human-readable call shape for generated JSDoc; machine mapping lands in P14. */
  args?: string
  consumes?: Consume
  /** For kind 'skip': divergence reason (must be non-empty, §8 O4). */
  reason?: string
  /**
   * Machine bridge hints (P13a mechanism sample).
   * For 'brep-op'/'query': which positional parameters are geometry inputs
   * (0-based indices into the brepjs positional-arg list) that the generated
   * code must borrow via `borrowBrepjsShape`. Non-listed params pass through
   * untouched (numbers / option objects are value params).
   */
  geometryArgs?: number[]
  /** For brep-op/query: whether a bool `Result` must be unwrapped (err → throw). Default true for ops/query. */
  returnsResult?: boolean
  /** For query only: the vendored return type name (re-exportable from the entry's module) so the generated function can annotate its return type (the export-JSDoc gate requires an explicit annotation + @returns). */
  returnType?: string
}

/**
 * 首批机制验证样本（P13a）。每个样本都选了 faijs 无同名、brepjs 有完整实现的符号，
 * 生成产物可立即 typecheck 并桥接 vendored 跑通（E5 模板：句柄借入 → 调 vendored →
 * Result 翻转 → fromBrep 所有权转入）。
 */
export const ARG_SPEC: ArgSpecEntry[] = [
  {
    name: 'Bounds3D',
    source: 'topology/shapeFns.js#Bounds3D',
    kind: 'type',
  },
  {
    name: 'torus',
    source: 'topology/primitiveFns.js#torus',
    kind: 'brep-op',
    args: '(majorRadius: number, minorRadius: number, options?: TorusOptions)',
    consumes: 'none',
    // 构造类：无几何输入（纯数值参数），brepjs 返回裸 ValidSolid（非 Result）。
    geometryArgs: [],
    returnsResult: false,
  },
  {
    name: 'fuse',
    source: 'topology/booleanFns.js#fuse',
    kind: 'brep-op',
    args: '(a: Shape3D, b: Shape3D, options?: BooleanOptions) -> Result<Shape3D>',
    // 两个输入都是 faijs Shape → 借入 brepjs handle；第三参 options 透传。
    geometryArgs: [0, 1],
    returnsResult: true,
  },
  {
    name: 'getBounds',
    source: 'topology/shapeFns.js#getBounds',
    kind: 'query',
    args: '(shape: AnyShape) -> Bounds3D',
    consumes: 'none',
    // 查询：输入 Shape（借入），返回纯数据 Bounds3D → 不进 defineOp（直接导出函数）。
    geometryArgs: [0],
    returnsResult: false,
    returnType: 'Bounds3D',
  },
]
