/**
 * env — scope/binding resolution for the AST interpreter.
 *
 * Env kinds (design D1/D2, docs/plans/2026-09-14-no-eval-interpreter-backend-design.md):
 * - root: the persistent ctx IS the variable container — reads resolve ctx,
 *   writes go to ctx (block-level const/let included, R-5 semantics per D1).
 * - function: params + function-local let/const only; a function body CANNOT
 *   see top-level ctx variables (D2 — matches the vm backend, where the
 *   function body is embedded verbatim inside `new Function`, so ctx
 *   identifiers are free identifiers there and ReferenceError).
 * - overlay: catch-clause scope — local vars, reads fall through to parent,
 *   writes stay local (matches the vm path where the catch param is a plain
 *   function-scope binding, not hoisted to ctx).
 *
 * Root identifier resolution order (matches hoistText: declared/ctx names are
 * rewritten to `__ctx.<name>`, so ctx wins over ns): overlay vars → ctx →
 * namespace bindings → S4 safe globals → ReferenceError.
 * Function env: vars → parent function vars → ns → globals (never ctx, D2).
 */
import type { ExecHost, ASTNode } from '../exec-backend'
import { S4_SAFE_GLOBALS } from '../../lang/security-scanner'

/** Where a resolved identifier binding lives. */
export type BindingWhere = 'ns' | 'ctx' | 'global' | 'local'

/** Result of resolving an identifier: its scope kind and current value. */
export interface ResolvedBinding {
  where: BindingWhere
  value: unknown
}

/**
 * Interpreter-wide state shared by all eval/exec calls within one unit run.
 * `evalExpr`/`execBody` are wired by the backend (lazily, to keep the module
 * graph acyclic: eval-expr → closure, exec-stmt → eval-expr, closure → state).
 */
export interface InterpState {
  host: ExecHost
  /** current closure recursion depth (guard against stack blowout) */
  depth: number
  /** maximum closure recursion depth before E_EXEC_LIMIT */
  maxDepth: number
  /** expression evaluator (wired by the backend) */
  evalExpr: (node: ASTNode, env: InterpEnv) => Promise<unknown>
  /** statement-list executor (wired by the backend) */
  execBody: (body: ASTNode[], env: InterpEnv) => Promise<unknown>
}

/**
 * Lexical environment for one scope level of the AST interpreter.
 * See module doc for the root/function/overlay semantics (D1/D2).
 */
export class InterpEnv {
  /** local bindings (function params/locals, catch params, for-in/of vars) */
  readonly vars = new Map<string, unknown>()

  constructor(
    readonly kind: 'root' | 'function' | 'overlay',
    private readonly ctx: Record<string, unknown>,
    private readonly ns: Record<string, unknown>,
    /** enclosing function env (closures only; never crosses into a root env — D2) */
    private readonly parent?: InterpEnv,
  ) {}

  /**
   * True when `name` is a namespace binding.
   * @param name - identifier to test.
   * @returns true when the namespaces record owns `name`.
   */
  hasNs(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.ns, name)
  }

  /**
   * Resolve an identifier through vars → ctx → ns → S4 globals.
   * @param name - identifier to resolve.
   * @returns the binding, or undefined when unresolvable (caller throws ReferenceError).
   */
  lookup(name: string): ResolvedBinding | undefined {
    if (this.vars.has(name)) return { where: 'local', value: this.vars.get(name) }
    let p = this.parent
    while (p) {
      if (p.vars.has(name)) return { where: 'local', value: p.vars.get(name) }
      p = p.parent
    }
    if (this.kind !== 'function' && Object.prototype.hasOwnProperty.call(this.ctx, name)) {
      return { where: 'ctx', value: this.ctx[name] }
    }
    if (this.hasNs(name)) {
      return { where: 'ns', value: (this.ns as Record<string, unknown>)[name] }
    }
    if (S4_SAFE_GLOBALS.has(name)) {
      return { where: 'global', value: (globalThis as Record<string, unknown>)[name] }
    }
    return undefined
  }

  /**
   * Write a variable: function/overlay envs stay local; the root env writes
   * through to the persistent ctx (D1). Namespace bindings are read-only.
   * @param name - identifier to write.
   * @param value - value to store.
   */
  assign(name: string, value: unknown): void {
    if (this.kind === 'function' || this.kind === 'overlay' || this.vars.has(name)) {
      // function bodies never write ctx (D2); overlay writes stay local
      if (this.hasNs(name) && !this.vars.has(name)) {
        throw new Error(`E_NS_ASSIGN: cannot assign to namespace binding "${name}"`)
      }
      this.vars.set(name, value)
      return
    }
    if (this.hasNs(name)) {
      throw new Error(`E_NS_ASSIGN: cannot assign to namespace binding "${name}"`)
    }
    // root env: writes go to the persistent ctx (D1)
    this.ctx[name] = value
  }
}
