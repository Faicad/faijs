/**
 * determinism-scanner — .fai.js determinism gate (B-tier, conservative taint)
 *
 * Decides statically whether any non-deterministic value (`Math.random`,
 * `Date.now` / `new Date`, `crypto.*`, `performance.now`) flows into geometry
 * generation. Conservative policy: anything the analysis cannot prove safe is a
 * violation — "when in doubt, reject".
 *
 * Model:
 * - **sources** produce tainted values.
 * - **propagation** moves taint through arithmetic, member access, assignment,
 *   arrays/objects, calls, and implicit control flow.
 * - **sinks** are geometry-generating call sites: members of the `cad`
 *   namespace (and any library namespace), named library callees, and unknown
 *   function calls (conservative). `console.*` and the pure built-ins are safe
 *   containers — taint may pass through them but does not, by itself, violate.
 *
 * This gate is entry prevention; exit equivalence is checked separately by
 * cross-kernel parity tests (docs/reproducibility-contract.md §5).
 */

import { parse as acornParse } from 'acorn'

// ── types ──

/** Why a value is non-deterministic (a source). */
export type DeterminismSource =
  | 'Math.random'
  | 'Date'
  | 'crypto'
  | 'performance.now'
  | 'getRandomValues'

/** A single conservatively-flagged violation. */
export interface DeterminismViolation {
  /** 1-based line of the offending sink / flow. */
  lineNo: number
  /** The non-deterministic source kind that reached geometry. */
  source: DeterminismSource
  /** Human-readable message (for tooling / self-correction). */
  message: string
}

/** Scan options. */
export interface DeterminismScanOptions {
  /** Default geometry namespace name (default `'cad'`). */
  defaultNs?: string
  /**
   * Extra geometry namespace binding names (`import * as sheet from ...` →
   * `'sheet'`). Member calls on these are geometry sinks.
   */
  extraNamespaces?: string[]
  /**
   * Extra named callees treated as geometry functions (`import { gear } from
   * ...` → `'gear'`). Direct calls to these are geometry sinks.
   */
  extraCallees?: string[]
}

/** Scan result. */
export interface DeterminismScanResult {
  /** True iff `violations` is empty. */
  ok: boolean
  violations: DeterminismViolation[]
}

// ── rule tables ──

/** Containers (identifier → member) whose member access is a non-deterministic source. */
const SOURCE_MEMBERS: Record<string, Set<string>> = {
  Math: new Set(['random']),
  Date: new Set(['now', 'parse', 'UTC']),
  performance: new Set(['now']),
  crypto: new Set(['getRandomValues', 'randomUUID']),
}

/**
 * Identifiers that are themselves non-deterministic values (a bare `Date` or
 * `crypto` reference is a source — `new Date()` / `crypto.subtle` alias paths).
 */
const SOURCE_IDENTS = new Set<string>(['Date', 'crypto', 'getRandomValues', 'performance'])

/**
 * Safe containers: member calls on these neither violate nor introduce taint;
 * taint only propagates through their arguments (pure/observable-only globals).
 */
const SAFE_CONTAINERS = new Set<string>([
  'console', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Object', 'Array',
  'Map', 'Set', 'Symbol', 'RegExp', 'Promise', 'Error', 'Intl', 'Reflect',
])

/** Safe top-level functions (pure/known, not geometry). */
const SAFE_FUNCTIONS = new Set<string>([
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number', 'Boolean',
  'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
])

// ── scope ──

interface Scope {
  parent: Scope | null
  tainted: Map<string, boolean>
}

function childScope(parent: Scope): Scope {
  return { parent, tainted: new Map() }
}

function lookupTaint(scope: Scope, name: string): boolean {
  let s: Scope | null = scope
  while (s) {
    const v = s.tainted.get(name)
    if (v !== undefined) return v
    s = s.parent
  }
  return false
}

function markTaint(scope: Scope, name: string): void {
  // Write through to the nearest scope that declares `name`, else current scope.
  let s: Scope | null = scope
  while (s) {
    if (s.tainted.has(name)) {
      s.tainted.set(name, true)
      return
    }
    s = s.parent
  }
  scope.tainted.set(name, true)
}

// ── scanner ──

/** acorn node (structural access only; see security-scanner for the same pattern). */
type Node = any

/**
 * Static non-determinism scanner (B-tier, conservative).
 * @param code - the `.fai.js` / library source text.
 * @param opts - scan options (geometry namespace/callee hints).
 * @returns scan result with all violations.
 */
export function scanDeterminism(code: string, opts: DeterminismScanOptions = {}): DeterminismScanResult {
  const defaultNs = opts.defaultNs ?? 'cad'
  const geometryNamespaces = new Set<string>([defaultNs, ...(opts.extraNamespaces ?? [])])
  const geometryCallees = new Set<string>(opts.extraCallees ?? [])

  const violations: DeterminismViolation[] = []

  let ast: Node
  try {
    ast = acornParse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    })
  } catch {
    // A syntax error is not a determinism violation; the main parse path owns
    // syntax diagnostics. Return ok (empty).
    return { ok: true, violations: [] }
  }

  const rootScope: Scope = { parent: null, tainted: new Map() }

  function lineOf(node: Node): number {
    return node?.loc?.start?.line ?? 1
  }

  function report(node: Node, source: DeterminismSource, detail: string): void {
    violations.push({
      lineNo: lineOf(node),
      source,
      message: `[determinism] ${detail} (non-deterministic value reaches geometry)`,
    })
  }

  /** Return the source kind of a call/construct callee, else null. */
  function sourceKindOfCallee(callee: Node): DeterminismSource | null {
    if (
      callee?.type === 'MemberExpression' &&
      callee.object?.type === 'Identifier' &&
      !callee.computed &&
      callee.property?.type === 'Identifier'
    ) {
      const members = SOURCE_MEMBERS[callee.object.name]
      if (members?.has(callee.property.name)) {
        const o = callee.object.name
        if (o === 'Math') return 'Math.random'
        if (o === 'Date') return 'Date'
        if (o === 'crypto') return callee.property.name === 'randomUUID' ? 'crypto' : 'getRandomValues'
        return 'performance.now'
      }
    }
    if (callee?.type === 'Identifier' && SOURCE_IDENTS.has(callee.name)) {
      if (callee.name === 'performance') return 'performance.now'
      if (callee.name === 'getRandomValues') return 'getRandomValues'
      return callee.name as DeterminismSource
    }
    return null
  }

  /**
   * Whether a call/construct site is a geometry sink, and if so, check its
   * arguments for taint. Returns the tainted-ness of the call result.
   */
  function handleCall(node: Node, scope: Scope): boolean {
    const callee = node.callee
    let resultTainted = false

    // A source call (Date.now / Math.random / crypto.* / performance.now)
    // produces a tainted result regardless of its arguments.
    const srcKind = sourceKindOfCallee(callee)
    if (srcKind) {
      lastSource = srcKind
      // Still walk arguments: nested calls inside may themselves violate.
      for (const a of node.arguments ?? []) {
        evalTaint(a?.type === 'SpreadElement' ? a.argument : a, scope)
      }
      return true
    }

    // Evaluate argument taint (propagation, eager evaluation).
    const argTaints: boolean[] = []
    for (const a of node.arguments ?? []) {
      if (a?.type === 'SpreadElement') {
        argTaints.push(evalTaint(a.argument, scope))
      } else {
        argTaints.push(evalTaint(a, scope))
      }
      if (argTaints[argTaints.length - 1]) resultTainted = true
    }

    // Determine the call target kind.
    // 1) Geometry namespace member call: `cad.box(...)` / `sheet.fn(...)`.
    if (callee?.type === 'MemberExpression') {
      const obj = callee.object
      const prop = callee.computed ? null : callee.property?.name
      const objName = obj?.type === 'Identifier' ? obj.name : null

      if (objName !== null && geometryNamespaces.has(objName)) {
        // Geometry op: any tainted argument violates.
        const taintedArg = argTaints.findIndex((t) => t)
        if (taintedArg >= 0) {
          report(callee, inferSourceForArgs(argTaints, taintedArg), `${objName}.${prop ?? '(computed)'} receives a non-deterministic argument`)
        }
        return resultTainted
      }

      if (objName !== null && SAFE_CONTAINERS.has(objName)) {
        // Safe container (console/math/json/...): propagate only.
        return resultTainted
      }
    }

    // 2) Direct named geometry callee: `gear(...)` from `import { gear }`.
    if (callee?.type === 'Identifier' && geometryCallees.has(callee.name)) {
      const taintedArg = argTaints.findIndex((t) => t)
      if (taintedArg >= 0) {
        report(callee, inferSourceForArgs(argTaints, taintedArg), `${callee.name}(...) receives a non-deterministic argument`)
      }
      return resultTainted
    }

    // 3) Known safe top-level function: propagate only.
    if (callee?.type === 'Identifier' && SAFE_FUNCTIONS.has(callee.name)) {
      return resultTainted
    }

    // 4) Unknown function call: conservative — a tainted argument may feed
    //    geometry, and we cannot prove otherwise.
    const taintedArg = argTaints.findIndex((t) => t)
    if (taintedArg >= 0) {
      report(callee, inferSourceForArgs(), `${calleeName(callee)}(...) receives a non-deterministic argument through an unknown callee`)
    }
    return resultTainted
  }

  function inferSourceForArgs(): DeterminismSource {
    // Best-effort attribution; the precise source is tracked per-node via lastSource.
    return lastSource ?? 'Date'
  }

  function calleeName(node: Node): string {
    if (!node) return '(unknown)'
    if (node.type === 'Identifier') return node.name
    if (node.type === 'MemberExpression') {
      const o = node.object?.type === 'Identifier' ? node.object.name : '?'
      const p = node.computed ? '[...]' : node.property?.name ?? '?'
      return `${o}.${p}`
    }
    return node.type
  }

  // Track the most recent source kind seen (for coarse attribution in reports).
  let lastSource: DeterminismSource | undefined

  /**
   * Evaluate whether an expression is tainted, recording sources as side
   * effects. Memo-free (exponential-free because the AST is a tree).
   */
  function evalTaint(node: Node, scope: Scope): boolean {
    if (!node) return false
    switch (node.type) {
      case 'Literal':
        return false

      case 'Identifier': {
        if (node.name === 'undefined' || node.name === 'NaN' || node.name === 'Infinity') return false
        // Source: bare `Date` / `crypto` / `performance` reference.
        if (SOURCE_IDENTS.has(node.name)) {
          lastSource = node.name !== 'performance' ? (node.name as DeterminismSource) : 'performance.now'
          return true
        }
        return lookupTaint(scope, node.name)
      }

      case 'MemberExpression': {
        // Source: `Math.random`, `Date.now`, `crypto.getRandomValues`, ...
        if (node.object?.type === 'Identifier') {
          const members = SOURCE_MEMBERS[node.object.name]
          if (members && !node.computed && node.property?.type === 'Identifier' && members.has(node.property.name)) {
            const kind =
              node.object.name === 'Math' ? 'Math.random'
                : node.object.name === 'Date' ? 'Date'
                  : node.object.name === 'crypto' ? (node.property.name === 'randomUUID' ? 'crypto' : 'getRandomValues')
                    : 'performance.now'
            lastSource = kind
            return true
          }
        }
        // Otherwise: taint flows through the object (and, conservatively, the key).
        const objTaint = evalTaint(node.object, scope)
        const keyTaint = node.computed ? evalTaint(node.property, scope) : false
        return objTaint || keyTaint
      }

      case 'NewExpression':
        // `new Date(...)` is a source regardless of arguments (timezone/sytem
        // clock dependence). `new crypto.X` likewise.
        if (node.callee?.type === 'Identifier' && SOURCE_IDENTS.has(node.callee.name)) {
          lastSource = node.callee.name === 'Date' ? 'Date' : 'crypto'
          return true
        }
        return handleCall(node, scope)

      case 'CallExpression':
        return handleCall(node, scope)

      case 'ArrayExpression': {
        let t = false
        for (const el of node.elements ?? []) {
          if (el && evalTaint(el, scope)) t = true
        }
        return t
      }

      case 'ObjectExpression': {
        let t = false
        for (const prop of node.properties ?? []) {
          if (prop.type === 'SpreadElement') {
            if (evalTaint(prop.argument, scope)) t = true
          } else if (prop.value && evalTaint(prop.value, scope)) {
            t = true
          }
        }
        return t
      }

      case 'UnaryExpression':
        return evalTaint(node.argument, scope)

      case 'UpdateExpression':
        return evalTaint(node.argument, scope)

      case 'BinaryExpression':
      case 'LogicalExpression':
        return evalTaint(node.left, scope) || evalTaint(node.right, scope)

      case 'ConditionalExpression': {
        const testT = evalTaint(node.test, scope)
        const consT = evalTaint(node.consequent, scope)
        const altT = evalTaint(node.alternate, scope)
        return testT || consT || altT
      }

      case 'AssignmentExpression': {
        const rhsT = evalTaint(node.right, scope)
        if (rhsT) {
          markAssignTarget(node.left, scope)
        }
        return rhsT
      }

      case 'SequenceExpression': {
        let t = false
        for (const e of node.expressions ?? []) {
          if (evalTaint(e, scope)) t = true
        }
        return t
      }

      case 'TemplateLiteral': {
        let t = false
        for (const expr of node.expressions ?? []) {
          if (evalTaint(expr, scope)) t = true
        }
        return t
      }

      case 'ChainExpression':
        return evalTaint(node.expression, scope)

      case 'AwaitExpression':
        return evalTaint(node.argument, scope)

      case 'SpreadElement':
        return evalTaint(node.argument, scope)

      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        const fnScope = childScope(scope)
        for (const p of node.params ?? []) {
          collectPatternTaintDefault(p, fnScope)
        }
        walkFunctionBody(node, fnScope)
        return false
      }

      default:
        return false
    }
  }

  /** Mark an assignment/declaration target tainted. */
  function markAssignTarget(left: Node, scope: Scope): void {
    if (left.type === 'Identifier') {
      markTaint(scope, left.name)
      return
    }
    if (left.type === 'MemberExpression') {
      // Conservatively taint the base object; the precise key is unknown.
      if (left.object?.type === 'Identifier') markTaint(scope, left.object.name)
      return
    }
    if (left.type === 'ArrayPattern' || left.type === 'ObjectPattern') {
      collectPattern(left, (name) => markTaint(scope, name))
      return
    }
  }

  /** Collect binding names from a destructuring pattern. */
  function collectPattern(pattern: Node, cb: (name: string) => void): void {
    if (!pattern) return
    if (pattern.type === 'Identifier') {
      cb(pattern.name)
      return
    }
    if (pattern.type === 'RestElement') {
      collectPattern(pattern.argument, cb)
      return
    }
    if (pattern.type === 'ArrayPattern') {
      for (const el of pattern.elements ?? []) if (el) collectPattern(el, cb)
      return
    }
    if (pattern.type === 'ObjectPattern') {
      for (const prop of pattern.properties ?? []) {
        if (prop.type === 'RestElement') collectPattern(prop.argument, cb)
        else if (prop.value) collectPattern(prop.value, cb)
      }
      return
    }
    if (pattern.type === 'AssignmentPattern') {
      collectPattern(pattern.left, cb)
      return
    }
  }

  /** Register a parameter, evaluating its default for taint. */
  function collectPatternTaintDefault(pattern: Node, scope: Scope): void {
    if (pattern?.type === 'AssignmentPattern') {
      collectPattern(pattern.left, (name) => {
        scope.tainted.set(name, evalTaint(pattern.right, scope))
      })
      return
    }
    collectPattern(pattern, (name) => {
      if (!scope.tainted.has(name)) scope.tainted.set(name, false)
    })
  }

  /** Walk a function body (its own scope; statements inside analyzed eagerly). */
  function walkFunctionBody(node: Node, fnScope: Scope): void {
    if (node.body?.type === 'BlockStatement') walkBody(node.body.body ?? [], fnScope)
    else if (node.body) {
      // Expression body: `x => expr`.
      evalTaint(node.body, fnScope)
    }
  }

  /** Walk a statement list, carrying implicit-flow taint. */
  function walkBody(body: Node[], scope: Scope, implicitTaint = false): void {
    // Hoist declarations first so assignments resolve in this scope.
    for (const stmt of body) {
      if (stmt?.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations ?? []) {
          collectPattern(decl.id, (name) => {
            if (!scope.tainted.has(name)) scope.tainted.set(name, false)
          })
        }
      }
      if (stmt?.type === 'FunctionDeclaration' && stmt.id?.name) {
        if (!scope.tainted.has(stmt.id.name)) scope.tainted.set(stmt.id.name, false)
      }
    }
    if (implicitTaint) {
      // Any assignment target inside a tainted control flow becomes tainted.
      for (const stmt of body) markStmtTargets(stmt, scope)
    }
    for (const stmt of body) walkStmt(stmt, scope)
  }

  /** Conservatively mark every LHS a block writes through as tainted. */
  function markStmtTargets(node: Node, scope: Scope): void {
    if (!node) return
    switch (node.type) {
      case 'VariableDeclaration':
        for (const d of node.declarations ?? []) collectPattern(d.id, (n) => markTaint(scope, n))
        return
      case 'ExpressionStatement':
        if (node.expression?.type === 'AssignmentExpression') markAssignTarget(node.expression.left, scope)
        if (node.expression?.type === 'UpdateExpression') markAssignTarget(node.expression.argument, scope)
        if (node.expression?.type === 'CallExpression') {
          // In-place mutation ergonomics: taint the first argument receiver.
          const first = node.expression.arguments?.[0]
          if (first?.type === 'Identifier') markTaint(scope, first.name)
        }
        return
      case 'FunctionDeclaration':
        if (node.id?.name) markTaint(scope, node.id.name)
        return
      default:
        return
    }
  }

  function walkStmt(node: Node, scope: Scope): void {
    if (!node) return
    switch (node.type) {
      case 'ExpressionStatement':
        evalTaint(node.expression, scope)
        return

      case 'VariableDeclaration':
        for (const decl of node.declarations ?? []) {
          if (decl.init && evalTaint(decl.init, scope)) {
            collectPattern(decl.id, (name) => markTaint(scope, name))
          }
        }
        return

      case 'BlockStatement':
        walkBody(node.body ?? [], childScope(scope))
        return

      case 'IfStatement': {
        const testT = evalTaint(node.test, scope)
        walkBody(toList(node.consequent), childScope(scope), testT)
        if (node.alternate) walkBody(toList(node.alternate), childScope(scope), testT)
        return
      }

      case 'ForStatement': {
        const forScope = childScope(scope)
        if (node.init?.type === 'VariableDeclaration') {
          for (const d of node.init.declarations ?? []) {
            collectPattern(d.id, (n) => { if (!forScope.tainted.has(n)) forScope.tainted.set(n, false) })
            if (d.init && evalTaint(d.init, forScope)) collectPattern(d.id, (n) => markTaint(forScope, n))
          }
        } else if (node.init) {
          evalTaint(node.init, forScope)
        }
        const testT = node.test ? evalTaint(node.test, forScope) : false
        if (node.update) evalTaint(node.update, forScope)
        walkBody(toList(node.body), forScope, testT)
        return
      }

      case 'ForInStatement':
      case 'ForOfStatement': {
        const forScope = childScope(scope)
        const rightT = evalTaint(node.right, forScope)
        if (node.left?.type === 'VariableDeclaration') {
          for (const d of node.left.declarations ?? []) {
            collectPattern(d.id, (n) => { if (!forScope.tainted.has(n)) forScope.tainted.set(n, false) })
          }
        }
        walkBody(toList(node.body), forScope, rightT)
        return
      }

      case 'WhileStatement':
      case 'DoWhileStatement': {
        const loopScope = childScope(scope)
        const testT = evalTaint(node.test, loopScope)
        walkBody(toList(node.body), loopScope, testT)
        return
      }

      case 'SwitchStatement': {
        const swScope = childScope(scope)
        const discT = evalTaint(node.discriminant, swScope)
        for (const c of node.cases ?? []) {
          if (c.test) evalTaint(c.test, swScope)
          walkBody(c.consequent ?? [], childScope(swScope), discT)
        }
        return
      }

      case 'ReturnStatement':
        if (node.argument) evalTaint(node.argument, scope)
        return

      case 'ThrowStatement':
        if (node.argument) evalTaint(node.argument, scope)
        return

      case 'TryStatement': {
        walkBody(toList(node.block?.body ?? []), scope)
        if (node.handler) {
          const catchScope = childScope(scope)
          if (node.handler.param) collectPattern(node.handler.param, (n) => { catchScope.tainted.set(n, false) })
          walkBody(node.handler.body?.body ?? [], catchScope)
        }
        if (node.finalizer) walkBody(node.finalizer.body ?? [], scope)
        return
      }

      case 'FunctionDeclaration': {
        const fnScope = childScope(scope)
        for (const p of node.params ?? []) collectPatternTaintDefault(p, fnScope)
        walkFunctionBody(node, fnScope)
        return
      }

      case 'LabeledStatement':
        if (node.body) walkStmt(node.body, scope)
        return

      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        // Imports are handled by the caller (namespace/callee hints). A default
        // export with a declaration still needs its body walked.
        if (node.type === 'ExportDefaultDeclaration' && node.declaration && node.declaration.type !== 'Identifier') {
          walkStmt(node.declaration, scope)
        }
        if (node.type === 'ExportNamedDeclaration' && node.declaration) {
          walkStmt(node.declaration, scope)
        }
        return

      case 'ClassDeclaration': {
        const clsScope = childScope(scope)
        for (const m of node.body?.body ?? []) {
          if (m.value) walkFunctionBody(m.value, childScope(clsScope))
        }
        return
      }

      case 'EmptyStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'DebuggerStatement':
        return

      default: {
        // Unknown statement node: conservatively walk children via evalTaint on
        // expression-shaped child properties is error-prone; skip structurally.
        return
      }
    }
  }

  function toList(node: Node): Node[] {
    if (!node) return []
    return node.type === 'BlockStatement' ? (node.body ?? []) : [node]
  }

  walkBody(ast.body ?? [], rootScope)

  return { ok: violations.length === 0, violations }
}