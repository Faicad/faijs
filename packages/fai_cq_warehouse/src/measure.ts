/**
 * measure.ts — string measure parsing, mirroring cq_warehouse/thread.py
 * (`is_safe` / `imperial_str_to_float` / `metric_str_to_float`).
 *
 * 红线（方案 §5.3）：运行期零 eval —— 所有算术由受限的递归下降求值器完成。
 * 白名单与 thread.py:43 `is_safe` 逐字一致：数字、`.`、`/` 与空格（长度 ≤10），
 * 求值器本身支持 `+ - * / ( )`；英制路径先把空格换成 `+` 再交给求值器，
 * 复刻上游 `eval(measure.strip().replace(" ", "+"))`。
 * 单位约定与上游一致：mm = 1，inch = 25.4 mm（imperial 求值结果 ×25.4）。
 */

export const INCH = 25.4

/** Python thread.py:43 `is_safe` — characters allowed in an eval-able measure. */
const SAFE_CHARS = new Set('0123456789./ '.split(''))

/**
 * thread.py `is_safe` — 单元格是否可直接交给算术求值器：长度 ≤10 且字符全在
 * 白名单内（数字、`.`、`/` 与空格）。
 * @param value - 待检的单元格文本。
 * @returns true 表示安全可求值。
 */
export function isSafe(value: string): boolean {
  return value.length <= 10 && [...value].every((c) => SAFE_CHARS.has(c))
}

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === ' ') {
      i++
      continue
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i
      while (
        j < src.length &&
        ((src[j]! >= '0' && src[j]! <= '9') || src[j] === '.')
      )
        j++
      const num = Number(src.slice(i, j))
      if (!Number.isFinite(num))
        throw new Error(`invalid number literal in measure: ${JSON.stringify(src)}`)
      tokens.push({ kind: 'num', value: num })
      i = j
      continue
    }
    if ('+-*/()'.includes(c)) {
      tokens.push({ kind: 'op', value: c })
      i++
      continue
    }
    throw new Error(`illegal character ${JSON.stringify(c)} in measure: ${JSON.stringify(src)}`)
  }
  return tokens
}

/**
 * Restricted recursive-descent evaluator: `+ - * / ( )` over number literals.
 * @param expr - 算术表达式（调用方须先过 {@link isSafe}）。
 * @returns 求值结果。
 */
export function evalArithmetic(expr: string): number {
  const tokens = tokenize(expr)
  let pos = 0
  const peek = () => tokens[pos]

  const parseExpr = (): number => {
    let left = parseTerm()
    for (;;) {
      const t = peek()
      if (t && t.kind === 'op' && (t.value === '+' || t.value === '-')) {
        pos++
        left = t.value === '+' ? left + parseTerm() : left - parseTerm()
      } else {
        return left
      }
    }
  }
  const parseTerm = (): number => {
    let left = parseFactor()
    for (;;) {
      const t = peek()
      if (t && t.kind === 'op' && (t.value === '*' || t.value === '/')) {
        pos++
        left = t.value === '*' ? left * parseFactor() : left / parseFactor()
      } else {
        return left
      }
    }
  }
  const parseFactor = (): number => {
    const t = peek()
    if (!t) throw new Error(`unexpected end of measure: ${JSON.stringify(expr)}`)
    if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      pos++
      const v = parseFactor()
      return t.value === '+' ? v : -v
    }
    if (t.kind === 'op' && t.value === '(') {
      pos++
      const v = parseExpr()
      const close = peek()
      if (!close || close.kind !== 'op' || close.value !== ')')
        throw new Error(`missing ')' in measure: ${JSON.stringify(expr)}`)
      pos++
      return v
    }
    if (t.kind === 'num') {
      pos++
      return t.value
    }
    throw new Error(`unexpected token in measure: ${JSON.stringify(expr)}`)
  }

  const value = parseExpr()
  if (pos !== tokens.length)
    throw new Error(`trailing tokens in measure: ${JSON.stringify(expr)}`)
  return value
}

/**
 * thread.py `metric_str_to_float` — metric values eval raw (mm).
 * Non-eval-able cells are returned as-is (mirrors upstream returning the string).
 * The empty string is passed through: upstream never evaluates it because
 * `isolate_fastener_type` (fastener.py:148) drops empty cells first; gen-data
 * evaluates every cell, so '' must be preserved, not fed to the evaluator.
 * @param measure - 单元格原文（公制，mm）。
 * @returns 求值后的 mm 数值；不可求值或空串时原样返回字符串。
 */
export function metricStrToFloat(measure: string): number | string {
  if (measure === '') return ''
  if (isSafe(measure)) return evalArithmetic(measure)
  return measure
}

/**
 * thread.py `imperial_str_to_float` — spaces become `+` (`"1 1/2"` → `1+1/2`),
 * result converted to mm (×25.4). Non-eval-able cells are returned as-is.
 * Empty string passes through (see metricStrToFloat).
 * @param measure - 单元格原文（英制，含 `1 1/2` 这类分数写法）。
 * @returns 换算为 mm 的数值；不可求值或空串时原样返回字符串。
 */
export function imperialStrToFloat(measure: string): number | string {
  if (measure === '') return ''
  if (isSafe(measure)) return evalArithmetic(measure.trim().replace(/ /g, '+')) * INCH
  return measure
}

/**
 * Unified per-cell evaluation used by the parameter tables
 * (fastener.py `evaluate_parameter_dict`): `is_metric` is decided per row
 * by the first character of the row key (`M…` → metric).
 * @param value - 单元格原文。
 * @param isMetric - 该行是否为公制（由行键首字符判定）。
 * @returns 求值结果；不可求值时原样返回字符串。
 */
export function evaluateCell(
  value: string,
  isMetric: boolean,
): number | string {
  return isMetric ? metricStrToFloat(value) : imperialStrToFloat(value)
}
