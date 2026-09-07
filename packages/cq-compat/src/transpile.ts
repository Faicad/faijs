/**
 * CadQuery Python → .fai.js transpiler (mini_lathe target).
 *
 * Handles the patterns found in mini_lathe:
 * - import cadquery as cq / import config / import math
 * - chained Workplane calls: wp.faces(">Z").workplane().hole(d)
 * - config constant references (inlined from config.py)
 * - function definitions (def pin_holes(wp): ...)
 * - list comprehensions, math.cos/radians, slicing
 * - if __name__ == "__main__" blocks (dropped)
 *
 * Not a general Python transpiler — targeted at CadQuery scripts.
 */

// ── AST types (subset) ─────────────────────────────────────────────────────

interface AstNode {
  _type: string
  [key: string]: unknown
}

interface TranspileCtx {
  /** Inlined config constants: name → JS expression string */
  configConsts: Map<string, string>
  /** Inlined config functions: name → JS function body lines */
  configFns: Map<string, { params: string[]; body: string[] }>
  /** Part name (from output filename, used for terminal variable) */
  partName: string
  /** Variables already declared (to avoid duplicate `let`) */
  declared: Set<string>
  /** When true, Name nodes matching config constants are inlined. */
  inlineConfigNames?: boolean
  /** When true, we're inside a function body — cq calls need await. */
  inFunction?: boolean
}

// ── Config extraction ──────────────────────────────────────────────────────

/**
 * extractConfig
 * @param ast - AstNode
 * @returns {
  consts: Map<string, string>
  fns: Map<string, { params: string[]; body: string[] }>
}
 */
export function extractConfig(ast: AstNode): {
  consts: Map<string, string>
  fns: Map<string, { params: string[]; body: string[] }>
} {
  const consts = new Map<string, string>()
  const fns = new Map<string, { params: string[]; body: string[] }>()

  // First pass: extract all constants
  for (const stmt of (ast.body as AstNode[]) ?? []) {
    if (stmt._type === 'Assign') {
      const targets = stmt.targets as AstNode[]
      const value = stmt.value as AstNode
      if (targets.length === 1 && targets[0]._type === 'Name') {
        const name = (targets[0] as AstNode).id as string
        consts.set(name, transpileExpr(value, makeCtxWithConsts(consts)))
      }
    }
  }

  // Second pass: extract functions with constants inlined
  const fnCtx: TranspileCtx = { ...makeCtxWithConsts(consts), inFunction: true }
  for (const stmt of (ast.body as AstNode[]) ?? []) {
    if (stmt._type === 'FunctionDef') {
      const name = stmt.name as string
      const args = ((stmt.args as AstNode).args as AstNode[]) ?? []
      const params = args.map((a) => (a as AstNode).arg as string)
      const body = (stmt.body as AstNode[]) ?? []
      const bodyLines = body.map((s) => transpileStmt(s, fnCtx)).filter((l) => l !== null) as string[]
      fns.set(name, { params, body: bodyLines })
    }
  }
  return { consts, fns }
}

function makeCtxWithConsts(consts: Map<string, string>): TranspileCtx {
  return { configConsts: new Map(consts), configFns: new Map(), partName: 'result', declared: new Set() }
}

// ── Main entry ─────────────────────────────────────────────────────────────

/**
 * transpile
 * @param ast - AstNode
 * @param config - ReturnType<typeof extractConfig>
 * @param partName - string
 * @returns string
 */
export function transpile(ast: AstNode, config: ReturnType<typeof extractConfig>, partName: string): string {
  const ctx: TranspileCtx = {
    configConsts: config.consts,
    configFns: config.fns,
    partName,
    declared: new Set(),
  }

  const lines: string[] = []
  lines.push("import * as cq from '@faicad/cq-compat'")
  lines.push('')

  // Inline config constants
  if (config.consts.size > 0) {
    for (const [name, value] of config.consts) {
      lines.push(`const ${name} = ${value}`)
    }
    lines.push('')
  }

  // Inline config functions
  for (const [name, fn] of config.fns) {
    lines.push(`async function ${name}(${fn.params.join(', ')}) {`)
    for (const l of fn.body) lines.push(`  ${l}`)
    lines.push('}')
    lines.push('')
  }

  // Transpile module body
  const bodyLines: string[] = []
  let lastAssignName: string | null = null
  for (const stmt of (ast.body as AstNode[]) ?? []) {
    const line = transpileStmt(stmt, ctx)
    if (line !== null) {
      bodyLines.push(line)
      // Track last variable assignment (for terminal extraction)
      if (stmt._type === 'Assign') {
        const targets = stmt.targets as AstNode[]
        if (targets.length === 1 && targets[0]._type === 'Name') {
          lastAssignName = (targets[0] as AstNode).id as string
        }
      }
    }
  }
  lines.push(...bodyLines)

  // Terminal extraction: if last assignment is a Workplane, extract its shape
  if (lastAssignName) {
    lines.push('')
    lines.push(`let result = cq.val(${lastAssignName})`)
  }

  return lines.join('\n')
}

// ── Statement transpilation ────────────────────────────────────────────────

function transpileStmt(stmt: AstNode, ctx: TranspileCtx): string | null {
  switch (stmt._type) {
    case 'Import':
    case 'ImportFrom':
      return null // imports handled by header
    case 'If':
      return transpileIf(stmt, ctx)
    case 'Assign':
      return transpileAssign(stmt, ctx)
    case 'Expr':
      return transpileExpr(stmt.value as AstNode, ctx)
    case 'FunctionDef':
      return transpileFunctionDef(stmt, ctx)
    case 'Return':
      return `return ${transpileExpr(stmt.value as AstNode, ctx)}`
    case 'Pass':
      return null
    default:
      return `// [unhandled stmt: ${stmt._type}]`
  }
}

function transpileIf(stmt: AstNode, ctx: TranspileCtx): string | null {
  const test = stmt.test as AstNode
  // Detect `if __name__ == "__main__":` or `if True or ...` → drop
  if (isMainCheck(test) || isTrueLiteral(test) || isShowObjectGuard(test)) {
    return null
  }
  // Generic if (rare in mini_lathe)
  const body = (stmt.body as AstNode[]).map((s) => transpileStmt(s, ctx)).filter((l) => l !== null) as string[]
  const testStr = transpileExpr(test, ctx)
  return [`if (${testStr}) {`, ...body.map((l) => `  ${l}`), '}'].join('\n')
}

/** Detect `"x" not in globals()` guard (cadquery vis import pattern). */
function isShowObjectGuard(test: AstNode): boolean {
  if (test._type !== 'Compare') return false
  const ops = test.ops as AstNode[]
  if (ops.length !== 1 || ops[0]._type !== 'NotIn') return false
  return true
}

function isMainCheck(test: AstNode): boolean {
  if (test._type !== 'Compare') return false
  const left = test.left as AstNode
  if (left._type !== 'Name' || left.id !== '__name__') return false
  const ops = test.ops as AstNode[]
  if (ops.length !== 1 || ops[0]._type !== 'Eq') return false
  const comps = test.comparators as AstNode[]
  if (comps.length !== 1 || comps[0]._type !== 'Constant') return false
  return (comps[0] as AstNode).value === '__main__'
}

function isTrueLiteral(test: AstNode): boolean {
  if (test._type === 'Constant' && test.value === true) return true
  // `True or ...` — always true
  if (test._type === 'BoolOp' && (test.op as AstNode)._type === 'Or') {
    const values = test.values as AstNode[]
    return values.some((v) => v._type === 'Constant' && v.value === true)
  }
  return false
}

function transpileAssign(stmt: AstNode, ctx: TranspileCtx): string | null {
  const targets = stmt.targets as AstNode[]
  const value = stmt.value as AstNode
  if (targets.length !== 1) return `// [unhandled multi-target assign]`
  const target = targets[0]
  if (target._type !== 'Name') return `// [unhandled assign target: ${target._type}]`
  const name = target.id as string
  const valueStr = transpileExpr(value, ctx)
  const isNew = !ctx.declared.has(name)
  if (isNew) ctx.declared.add(name)
  return isNew ? `let ${name} = ${valueStr}` : `${name} = ${valueStr}`
}

function transpileFunctionDef(stmt: AstNode, ctx: TranspileCtx): string | null {
  const name = stmt.name as string
  const args = ((stmt.args as AstNode).args as AstNode[]) ?? []
  const params = args.map((a) => (a as AstNode).arg as string)
  const fnCtx: TranspileCtx = { ...ctx, inFunction: true }
  const body = (stmt.body as AstNode[]).map((s) => transpileStmt(s, fnCtx)).filter((l) => l !== null) as string[]
  return [`async function ${name}(${params.join(', ')}) {`, ...body.map((l) => `  ${l}`), '}'].join('\n')
}

// ── Expression transpilation ───────────────────────────────────────────────

function transpileExpr(node: AstNode, ctx: TranspileCtx): string {
  switch (node._type) {
    case 'Constant':
      return transpileConstant(node)
    case 'Name':
      return transpileName(node, ctx)
    case 'Attribute':
      return transpileAttribute(node, ctx)
    case 'Call':
      return transpileCall(node, ctx)
    case 'BinOp':
      return transpileBinOp(node, ctx)
    case 'UnaryOp':
      return transpileUnaryOp(node, ctx)
    case 'List':
      return transpileList(node, ctx)
    case 'Subscript':
      return transpileSubscript(node, ctx)
    case 'ListComp':
      return transpileListComp(node, ctx)
    case 'Tuple':
      return `[${((node.elts as AstNode[]) ?? []).map((e) => transpileExpr(e, ctx)).join(', ')}]`
    case 'Compare':
      return transpileCompare(node, ctx)
    case 'BoolOp':
      return transpileBoolOp(node, ctx)
    default:
      return `/* [unhandled expr: ${node._type}] */`
  }
}

function transpileCompare(node: AstNode, ctx: TranspileCtx): string {
  const left = transpileExpr(node.left as AstNode, ctx)
  const ops = node.ops as AstNode[]
  const comparators = node.comparators as AstNode[]
  const opMap: Record<string, string> = {
    Eq: '===', NotEq: '!==', Lt: '<', LtE: '<=', Gt: '>', GtE: '>=',
    Is: '===', IsNot: '!==', In: 'in', NotIn: '!in',
  }
  const parts: string[] = [left]
  for (let i = 0; i < ops.length; i++) {
    const op = opMap[ops[i]._type] ?? `/* ${ops[i]._type} */`
    const comp = transpileExpr(comparators[i], ctx)
    parts.push(op, comp)
  }
  return `(${parts.join(' ')})`
}

function transpileBoolOp(node: AstNode, ctx: TranspileCtx): string {
  const op = node.op as AstNode
  const values = (node.values as AstNode[]).map((v) => transpileExpr(v, ctx))
  const joiner = op._type === 'And' ? '&&' : '||'
  return `(${values.join(` ${joiner} `)})`
}

function transpileConstant(node: AstNode): string {
  const v = node.value
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === null) return 'null'
  return String(v)
}

function transpileName(node: AstNode, ctx: TranspileCtx): string {
  const id = node.id as string
  // math module → Math
  if (id === 'math') return 'Math'
  // config constant inlining
  if (ctx.configConsts.has(id)) return ctx.configConsts.get(id)!
  return id
}

function transpileAttribute(node: AstNode, ctx: TranspileCtx): string {
  const value = node.value as AstNode
  const attr = node.attr as string
  // math.cos → Math.cos, math.radians → (x => x * Math.PI / 180)
  if (value._type === 'Name' && value.id === 'math') {
    if (attr === 'radians') return '(x => x * Math.PI / 180)'
    if (attr === 'cos') return 'Math.cos'
    if (attr === 'sin') return 'Math.sin'
    if (attr === 'sqrt') return 'Math.sqrt'
    return `Math.${attr}`
  }
  // config.X → inlined constant
  if (value._type === 'Name' && value.id === 'config' && ctx.configConsts.has(attr)) {
    return ctx.configConsts.get(attr)!
  }
  // Generic attribute: a.b — but for chained calls this is handled by transpileCall
  return `${transpileExpr(value, ctx)}.${attr}`
}

function transpileCall(node: AstNode, ctx: TranspileCtx): string {
  const func = node.func as AstNode
  const args = (node.args as AstNode[]) ?? []
  const keywords = (node.keywords as AstNode[]) ?? []

  let result: string
  let needsAwait = false

  // Chained method call: wp.method(args)
  if (func._type === 'Attribute') {
    result = transpileMethodCall(func, args, keywords, ctx)
    // cq/workplane methods are async; Math.xxx is not.
    // For chained calls, the outermost receiver may be a Call, so check method name.
    const method = (func as AstNode).attr as string
    const mathMethods = new Set(['cos', 'sin', 'sqrt', 'radians', 'degrees', 'tan', 'atan', 'asin', 'acos', 'pow', 'abs', 'floor', 'ceil', 'round'])
    if (!mathMethods.has(method)) {
      needsAwait = true
    }
  } else if (func._type === 'Name') {
    // Direct function call: fn(args)
    const name = func.id as string
    const argStrs = args.map((a) => transpileExpr(a, ctx))
    result = `${name}(${argStrs.join(', ')})`
    if (ctx.configFns.has(name)) needsAwait = true
  } else {
    // Call result of another expression (e.g. (lambda)(...))
    result = `${transpileExpr(func, ctx)}(${args.map((a) => transpileExpr(a, ctx)).join(', ')})`
  }

  // Inside async function body, await cq/config calls (they return Promises)
  if (ctx.inFunction && needsAwait) {
    result = `await ${result}`
  }
  return result
}

/**
 * Convert chained method calls to function calls:
 *   wp.faces(">Z").workplane().hole(d)
 *   → cq.hole(cq.workplane(cq.faces(wp, ">Z")), d)
 *
 * Also handles cq.Workplane("XY") (constructor, not method).
 */
function transpileMethodCall(
  func: AstNode,
  args: AstNode[],
  keywords: AstNode[],
  ctx: TranspileCtx,
): string {
  const method = func.attr as string
  const receiver = func.value as AstNode
  const argStrs = args.map((a) => transpileExpr(a, ctx))
  const kwStr = transpileKeywords(keywords, ctx)

  // config.fn(args) → fn(args) (config functions are inlined as global functions)
  if (receiver._type === 'Name' && receiver.id === 'config' && ctx.configFns.has(method)) {
    return `${method}(${argStrs.join(', ')})`
  }

  // config.CONSTANT → inlined constant (handled in transpileAttribute, but here for call)
  if (receiver._type === 'Name' && receiver.id === 'config' && ctx.configConsts.has(method)) {
    return ctx.configConsts.get(method)!
  }

  // math.cos(x), math.sin(x), math.sqrt(x), math.radians(x) → JS Math
  if (receiver._type === 'Name' && receiver.id === 'math') {
    if (method === 'radians') return `(${argStrs[0]} * Math.PI / 180)`
    if (method === 'degrees') return `(${argStrs[0]} * 180 / Math.PI)`
    return `Math.${method}(${argStrs.join(', ')})`
  }

  // cq.Workplane("XY") — constructor call
  if (receiver._type === 'Name' && receiver.id === 'cq' && method === 'Workplane') {
    return `cq.Workplane(${argStrs.join(', ')})`
  }

  // wp.export("file.step") — drop (CLI handles export)
  if (method === 'export') return 'null'

  // wp.val() → cq.val(wp)
  if (method === 'val') return `cq.val(${transpileExpr(receiver, ctx)})`

  // wp.vals() → cq.vals(wp)
  if (method === 'vals') return `cq.vals(${transpileExpr(receiver, ctx)})`

  // wp.transformed(offset=(x,y,z)) → cq.transformed(wp, { offset: [x,y,z] })
  if (method === 'transformed') {
    const recv = transpileExpr(receiver, ctx)
    return `cq.transformed(${recv}, { ${kwStr} })`
  }

  // wp.rect(w, h, forConstruction=True) → cq.rect(wp, w, h, { forConstruction: true })
  if (method === 'rect') {
    const recv = transpileExpr(receiver, ctx)
    const allArgs = kwStr ? [...argStrs, `{ ${kwStr} }`] : argStrs
    return `cq.rect(${recv}, ${allArgs.join(', ')})`
  }

  // wp.circle(r) → cq.circle(wp, r)
  if (method === 'circle') {
    return `cq.circle(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.extrude(d) → cq.extrude(wp, d)
  if (method === 'extrude') {
    return `cq.extrude(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.faces(sel) → cq.faces(wp, sel)
  if (method === 'faces') {
    return `cq.faces(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.workplane(offset=?) → cq.workplane(wp) or cq.workplane(wp, { offset })
  if (method === 'workplane') {
    const recv = transpileExpr(receiver, ctx)
    return kwStr ? `cq.workplane(${recv}, { ${kwStr} })` : `cq.workplane(${recv})`
  }

  // wp.hole(d) → cq.hole(wp, d)
  if (method === 'hole') {
    return `cq.hole(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.cutBlind(d) → cq.cutBlind(wp, d)
  if (method === 'cutBlind') {
    return `cq.cutBlind(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.fillet(r) → cq.fillet(wp, r)
  if (method === 'fillet') {
    return `cq.fillet(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.edges(sel) → cq.edges(wp, sel)
  if (method === 'edges') {
    const recv = transpileExpr(receiver, ctx)
    return argStrs.length > 0 ? `cq.edges(${recv}, ${argStrs.join(', ')})` : `cq.edges(${recv})`
  }

  // wp.vertices() → cq.vertices(wp)
  if (method === 'vertices') {
    return `cq.vertices(${transpileExpr(receiver, ctx)})`
  }

  // wp.pushPoints(pts) → cq.pushPoints(wp, pts)
  if (method === 'pushPoints') {
    return `cq.pushPoints(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.union(other) → cq.union(wp, other)
  if (method === 'union') {
    return `cq.union(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.cut(other) → cq.cut(wp, other)
  if (method === 'cut') {
    return `cq.cut(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.mirror(plane) → cq.mirror(wp, plane)
  if (method === 'mirror') {
    return `cq.mirror(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.rotate(start, end, angle) → cq.rotate(wp, axis, angle) (simplified)
  if (method === 'rotate') {
    return `cq.rotate(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.translate(v) → cq.translate(wp, v)
  if (method === 'translate') {
    return `cq.translate(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.polygon(n, d) → cq.polygon(wp, n, d)
  if (method === 'polygon') {
    return `cq.polygon(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.cboreHole(d, cboreD, cboreH) → cq.cboreHole(wp, d, cboreD, cboreH)
  if (method === 'cboreHole') {
    return `cq.cboreHole(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.cskHole(d, cskD, cskAng) → cq.cskHole(wp, d, cskD, cskAng)
  if (method === 'cskHole') {
    return `cq.cskHole(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.threadedHole(d) → cq.threadedHole(wp, d)
  if (method === 'threadedHole') {
    return `cq.threadedHole(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.shell(t) → cq.shell(wp, t)
  if (method === 'shell') {
    return `cq.shell(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // wp.intersect(other) → cq.intersect(wp, other)
  if (method === 'intersect') {
    return `cq.intersect(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
  }

  // Generic fallback: cq.method(receiver, args...)
  return `cq.${method}(${transpileExpr(receiver, ctx)}, ${argStrs.join(', ')})`
}

function transpileKeywords(keywords: AstNode[], ctx: TranspileCtx): string {
  const parts: string[] = []
  for (const kw of keywords) {
    const arg = kw.arg as string | null
    const value = transpileExpr(kw.value as AstNode, ctx)
    if (arg) {
      // Python True/False → JS true/false
      const v = value === 'True' ? 'true' : value === 'False' ? 'false' : value
      parts.push(`${arg}: ${v}`)
    } else {
      parts.push(`...${value}`)
    }
  }
  return parts.join(', ')
}

function transpileBinOp(node: AstNode, ctx: TranspileCtx): string {
  const left = transpileExpr(node.left as AstNode, ctx)
  const right = transpileExpr(node.right as AstNode, ctx)
  const op = node.op as AstNode
  const opMap: Record<string, string> = {
    Add: '+', Sub: '-', Mult: '*', Div: '/', Mod: '%', Pow: '**',
    LShift: '<<', RShift: '>>', BitOr: '|', BitXor: '^', BitAnd: '&',
    FloorDiv: '/',
  }
  const opStr = opMap[op._type] ?? `/* ${op._type} */`
  return `(${left} ${opStr} ${right})`
}

function transpileUnaryOp(node: AstNode, ctx: TranspileCtx): string {
  const operand = transpileExpr(node.operand as AstNode, ctx)
  const op = node.op as AstNode
  if (op._type === 'USub') return `(-${operand})`
  if (op._type === 'UAdd') return `(+${operand})`
  if (op._type === 'Not') return `(!${operand})`
  return `(${operand})`
}

function transpileList(node: AstNode, ctx: TranspileCtx): string {
  const elts = (node.elts as AstNode[]) ?? []
  return `[${elts.map((e) => transpileExpr(e, ctx)).join(', ')}]`
}

function transpileSubscript(node: AstNode, ctx: TranspileCtx): string {
  const valueNode = node.value as AstNode
  // Handle .vertices()[start:end] and .edges()[start:end] — merge slice into call
  if (valueNode._type === 'Call' && (valueNode.func as AstNode)._type === 'Attribute') {
    const method = ((valueNode.func as AstNode).attr as string)
    if (method === 'vertices' || method === 'edges') {
      const baseCall = transpileCall(valueNode, ctx)
      const slice = node.slice as AstNode
      if (slice._type === 'Slice') {
        const lower = slice.lower ? transpileExpr(slice.lower as AstNode, ctx) : null
        const upper = slice.upper ? transpileExpr(slice.upper as AstNode, ctx) : null
        const parts: string[] = []
        if (lower !== null) parts.push(lower)
        if (upper !== null) parts.push(upper)
        return baseCall.replace(/\)$/, `, { slice: [${parts.join(', ')}] })`)
      }
      // Single index: .vertices()[-1]
      const idx = transpileExpr(slice, ctx)
      return baseCall.replace(/\)$/, `, { index: ${idx} })`)
    }
  }
  const value = transpileExpr(valueNode, ctx)
  const slice = node.slice as AstNode
  if (slice._type === 'Slice') {
    const lower = slice.lower ? transpileExpr(slice.lower as AstNode, ctx) : ''
    const upper = slice.upper ? transpileExpr(slice.upper as AstNode, ctx) : ''
    return `${value}.slice(${lower}, ${upper})`
  }
  // Index
  return `${value}[${transpileExpr(slice, ctx)}]`
}

function transpileListComp(node: AstNode, ctx: TranspileCtx): string {
  const elt = transpileExpr(node.elt as AstNode, ctx)
  const generators = (node.generators as AstNode[]) ?? []
  // Simple single-generator: [expr for x in list]
  if (generators.length === 1) {
    const gen = generators[0]
    const target = transpileExpr(gen.target as AstNode, ctx)
    const iter = transpileExpr(gen.iter as AstNode, ctx)
    return `${iter}.map((${target}) => ${elt})`
  }
  return `[${elt} /* listcomp */]`
}
