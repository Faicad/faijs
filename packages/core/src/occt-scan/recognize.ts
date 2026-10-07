/**
 * @internal — occt-scan 识别层（仅供 `scripts/scan-occt-op-coverage.ts` 与回归测试使用，
 * 不是 faijs 公开 API，勿从业务代码 import）。
 *
 * 识别「occt 原生内核直调」的源码分析。判据（方案 §7.2 缺陷 1 + §7.5 陷阱 1）：
 * 只有从 `getOcctKernel()` / `getKernel()` / `initOcctWasm()` 拿到的变量才是 occt 原生
 * 句柄；`const kernel = getBrepApi()`（L1 契约句柄）的调用**不**算 occt 直调——把它的
 * 方法调用算进去会把中立 op 全误判成平台 op。
 *
 * 用 TypeScript AST（ts.createSourceFile）做语法层分析，按符号声明位置判定，能穿透
 * §7.2 要求的三类形态（正则在此处两头都错，见方案）：
 *   - `const x = <handle>.<m>.bind(k)`     → x(...) 与绑定点的 `<m>` 都计入
 *   - `(<cast>).<m>.call(k, ...)`             → `<m>` 计入
 *   - `const { m } = <handle>` 解构           → 别名 m(...) 调用计入
 *   以及最普通 `<handle>.<m>(...)` 链式直调。
 */

import ts from 'typescript'

/** 返回函数调用表达式的被调用名（裸标识符或属性名），否则 null。 */
function calleeName(callee: ts.Expression | undefined): string | null {
  if (!callee) return null
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

/** 去掉括号/类型断言/`as`/`!`/`satisfies`，拿到最内层表达式。 */
function unwrap(n: ts.Expression): ts.Expression {
  let x = n
  for (;;) {
    if (ts.isParenthesizedExpression(x)) x = x.expression
    else if (ts.isAsExpression(x)) x = x.expression
    else if (ts.isTypeAssertionExpression(x)) x = x.expression
    else if (ts.isNonNullExpression(x)) x = x.expression
    else if ((ts as unknown as { isSatisfiesExpression?: (x: ts.Node) => boolean }).isSatisfiesExpression?.(x)) {
      x = (x as ts.Expression & { expression: ts.Expression }).expression
    } else break
  }
  return x
}

/** 一个表达式是否「判定为 occt 内核派生句柄」（依据 kernelIds + 直接获取器）。 */
type IsKernel = (e: ts.Expression) => boolean

function makeIsKernel(kernelIds: Set<string>): IsKernel {
  return (e) => {
    const u = unwrap(e)
    if (ts.isIdentifier(u)) return kernelIds.has(u.text)
    if (ts.isCallExpression(u)) {
      const nm = calleeName(u.expression)
      return nm === 'getOcctKernel' || nm === 'getKernel' || nm === 'initOcctWasm'
    }
    return false
  }
}

/** 绑定模式里导出的名字。 */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  const out: string[] = []
  if (ts.isObjectBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) {
        const prop = el.propertyName ? el.propertyName.getText() : el.name.getText()
        out.push(prop)
      }
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) out.push(el.name.text)
      else if (ts.isBindingElement(el)) out.push(...bindingNames(el.name))
    }
  }
  return out
}

/**
 * 收集文件里「持有 occt 内核」的标识符集合。
 *
 * - 直接获取：`const k = getOcctKernel()` / `await initOcctWasm()` / `getKernel()`。
 * - 派生别名不动点：`const raw = k as unknown as T` 等其初始化式判定为内核派生者的
 *   局部 const 也收为内核标识（覆盖层层 cast/别名）。
 *
 * 注意：`getBrepApi()` 不在内核获取器之列，故 `const kernel = getBrepApi()` 的 `kernel`
 * 不会进入返回值——§7.5 陷阱 1 的防线。
 *
 * @param src 待扫描的 TS 源码文本。
 * @returns 内核标识符（变量名）集合，按字典序排列。
 */
export function kernelIdentifiers(src: string): Set<string> {
  const sf = ts.createSourceFile('recognize.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const KERNEL_ACQUIRE =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^;=\n]*?=\s*(?:await\s+)?[^;\n]*(?:getOcctKernel|getKernel|initOcctWasm)\s*\(\s*\)/g
  const kernelIds = new Set<string>()
  KERNEL_ACQUIRE.lastIndex = 0
  for (let m = KERNEL_ACQUIRE.exec(src); m; m = KERNEL_ACQUIRE.exec(src)) kernelIds.add(m[1])

  // 收集文件内所有变声明的「名 → 初始化式」。
  const initByVar = new Map<string, ts.Expression>()
  ;(function collect(n: ts.Node): void {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      for (const nm of bindingNames(n.name)) initByVar.set(nm, n.initializer)
    }
    ts.forEachChild(n, collect)
  })(sf)

  const isKernelInDecl = makeIsKernel(kernelIds)
  let changed = true
  while (changed) {
    changed = false
    for (const [name, init] of initByVar) {
      if (!kernelIds.has(name) && isKernelInDecl(init)) {
        kernelIds.add(name)
        changed = true
      }
    }
  }
  return new Set([...kernelIds].sort())
}

/**
 * 收集「方法别名」：把 occt 方法绑定/解构到局部变量后，后续 `alias(...)` 调用要还原
 * 成底层方法名。形态：
 *   - `const x = <内核值>.<m>.bind(k)`             → x ⇒ m（覆盖 `raw.linearPattern.bind(k)` 后 `nativeLP(...)`）
 *   - `const { m } = <内核值>` / `{ m: mm }`          → m ⇒ m / mm ⇒ m（解构）
 * 只认内核派生基；`kernel = getBrepApi()` 的 .m 不作数（§7.5 陷阱 1）。
 *
 * @param src 待扫描的 TS 源码文本。
 * @param kernelIds 内核标识符集合（来自 {@link kernelIdentifiers}）。
 * @returns 别名 → 底层 occt 方法名的映射。
 */
export function methodAliases(src: string, kernelIds: Set<string>): Map<string, string> {
  const sf = ts.createSourceFile('aliases.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const isKernelIdent = makeIsKernel(kernelIds)
  const alias = new Map<string, string>()

  for (const stmt of sf.statements as unknown as ts.Node[]) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const d of stmt.declarationList.declarations) {
      if (!d.initializer) continue
      // 形态 1：`const x = <值>.<m>.bind(k)` / `<值>.<m>.call(k, …)` ，<值> 是内核
      if (ts.isIdentifier(d.name) || ts.isObjectBindingPattern(d.name)) {
        const names = bindingNames(d.name)
        // 解构出别名：const { m: mm } = kernel
        if (ts.isObjectBindingPattern(d.name)) {
          for (const el of d.name.elements) {
            if (ts.isBindingElement(el)) {
              const mth = el.propertyName ? el.propertyName.getText() : el.name.getText()
              alias.set(el.name.getText(), mth)
            }
          }
        }
        if (names.length === 1 && ts.isCallExpression(d.initializer)) {
          const init = d.initializer
          const outerName = calleeName(init.expression)
          if (outerName === 'bind' || outerName === 'call') {
            const prop = init.expression as ts.PropertyAccessExpression
            if (ts.isPropertyAccessExpression(prop) && ts.isPropertyAccessExpression(prop.expression) && isKernelIdent(prop.expression.expression)) {
              alias.set(names[0]!, prop.name.text)
            }
          }
        }
      }
    }
  }
  return alias
}

/**
 * 返回 src 里被调用的、基类是内核派生的 occt 方法名（与 occtNames 交集）。
 *
 * 覆盖形态（§7.2 缺陷 1）：
 *   - `<k>.method(`                    普通直调（k 为内核标识）
 *   - `getOcctKernel().method(...)`      链式（调用表达式基即内核）→ 属性访问基命中
 *   - `raw.method.bind(k)` / `(<cast>).m.call(k,…)`   绑定点属性访问把 `<m>` 计入
 *   - `const x = k.m.bind(...); x(...)` const 绑定别名调用
 *   - `const { m } = k; m(...)`          解构别名调用
 *
 * @param src 待扫描的 TS 源码文本。
 * @param occtNames occt 方法名全集（用于交集过滤）。
 * @returns 被调用的 occt 方法名集合。
 */
export function kernelCallsIn(src: string, occtNames: Set<string>): Set<string> {
  const sf = ts.createSourceFile('scan.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const kernelIds = kernelIdentifiers(src)
  const alias = methodAliases(src, kernelIds)
  const isKernelIdent = makeIsKernel(kernelIds)
  const out = new Set<string>()

  const visit = (n: ts.Node): void => {
    // 别名调用：`nativeLP(...)` / `lp(...)` / `m(...)` 还原底层方法名
    if (ts.isCallExpression(n)) {
      const nm = calleeName(n.expression)
      if (nm && alias.has(nm)) {
        const real = alias.get(nm)!
        if (occtNames.has(real)) out.add(real)
      }
    }
    // 内核派生基 . 属性访问 → 属性是 occt 方法（属性访问即方法引用/调用）
    if (ts.isPropertyAccessExpression(n)) {
      if (isKernelIdent(n.expression)) {
        const name = n.name.text
        if (occtNames.has(name)) out.add(name)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}