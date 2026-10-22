/**
 * keep-statement — `a.keep()` / `a.keepHidden()` 的语句形状判定（单一真源）。
 *
 * keep 是**编译期声明**，不是运行时方法：`Shape` 是纯数据接口（`mesh/types.ts`），
 * 照常发射调用会得到 `__ctx.a.keep is not a function`。因此两个地方都要认出同一条
 * 语句——语言层（`lang/metadata-extractor.ts` 登记声明）与执行层
 * （`cad-runtime/direct-executor.ts` 让它成为 no-op）——判定只写一份，避免两处漂移。
 *
 * 认的形状：
 * - `CallExpression`，callee 是 `MemberExpression`（非计算属性）；
 * - `object` 是 `Identifier`（receiver 必须是变量，命名空间写法 `cad.keep(a)` 不支持）；
 * - `property` 是 `Identifier`，名为 `keep` 或 `keepHidden`。
 *
 * 两档判据：
 * - {@link matchKeepCall} 只认名字（**不**看实参）——语言层用它把
 *   `a.keep(x)` 判成"写错的 keep 语句"并报 `E_STATEMENT`；
 * - {@link matchKeepStatement} 额外要求零实参——执行层用它决定跳过执行。
 */

type ASTNode = any

/** 命中的 keep 调用（尚未校验实参个数）。 */
export interface KeepCallMatch {
  /** receiver：被声明的变量名。 */
  target: string
  /** true = `keepHidden()`（保留但隐藏）；false = `keep()`（保留且可见）。 */
  hidden: boolean
  /** 实参个数（语言层据此拒绝 `a.keep(x)`）。 */
  argCount: number
}

/**
 * 判定一个表达式节点是否是 `x.keep(...)` / `x.keepHidden(...)` 形态的调用。
 *
 * @param expr - `ExpressionStatement.expression`（或任意表达式节点）。
 * @returns 命中时返回 `{ target, hidden, argCount }`；否则 `undefined`。
 */
export function matchKeepCall(expr: ASTNode): KeepCallMatch | undefined {
  if (expr?.type !== 'CallExpression') return undefined
  const callee = expr.callee
  if (callee?.type !== 'MemberExpression') return undefined
  if (callee.computed === true) return undefined
  if (callee.object?.type !== 'Identifier') return undefined
  if (callee.property?.type !== 'Identifier') return undefined
  const prop = callee.property.name
  if (prop !== 'keep' && prop !== 'keepHidden') return undefined
  return {
    target: callee.object.name,
    hidden: prop === 'keepHidden',
    argCount: (expr.arguments ?? []).length,
  }
}

/**
 * 判定是否是**合法的** keep 声明语句（零实参）。
 *
 * @param expr - `ExpressionStatement.expression`（或任意表达式节点）。
 * @returns 命中时返回 `{ target, hidden }`；否则 `undefined`。
 */
export function matchKeepStatement(expr: ASTNode): Omit<KeepCallMatch, 'argCount'> | undefined {
  const m = matchKeepCall(expr)
  if (!m || m.argCount !== 0) return undefined
  return { target: m.target, hidden: m.hidden }
}
