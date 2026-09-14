/**
 * closure — InterpClosure, the interpreter's function object.
 *
 * Corresponds to the vm backend's `__ctx.<name> = async function <name>(...)`
 * hoisting: every user function becomes an async callable stored in ctx.
 * Visible bindings inside the body = params + namespace bindings + S4 safe
 * globals (D2) — never top-level ctx variables. Nested closures additionally
 * see the enclosing function's locals (D3 lexical capture).
 *
 * Module-graph note: this file must NOT import eval-expr/exec-stmt (they
 * import this file); body execution goes through the lazily wired
 * state.evalExpr / state.execBody.
 */
import type { ASTNode } from '../exec-backend'
import { InterpEnv, type InterpState } from './env'
import { ReturnSignal } from './signals'

/**
 * An interpreter-created user function value (FunctionDeclaration /
 * FunctionExpression / ArrowFunctionExpression). Corresponds to the vm
 * backend's `__ctx.<name> = async function <name>(...)` hoisted closure.
 */
export class InterpClosure {
  constructor(
    /** FunctionDeclaration / FunctionExpression / ArrowFunctionExpression node */
    private readonly node: ASTNode,
    /** defining env (lexical parent for nested closures; root env → dropped) */
    private readonly defEnv: InterpEnv,
  ) {}

  /**
   * Invoke the closure with positional args.
   * @param args - evaluated call arguments (positional; params ABI §3.4).
   * @param state - shared interpreter state (recursion guard, wired evaluators).
   * @returns the returned value (undefined for a plain body end).
   */
  async call(args: unknown[], state: InterpState): Promise<unknown> {
    if (++state.depth > state.maxDepth) {
      state.depth--
      throw new Error(`E_EXEC_LIMIT: closure recursion depth exceeded (${state.maxDepth})`)
    }
    try {
      // ctx/ns come from the CALL-time host (registerLib hot-update safe);
      // the parent chain carries only lexical function locals (D3).
      const env = new InterpEnv(
        'function',
        state.host.ctx,
        state.host.namespaces,
        this.defEnv.kind === 'root' ? undefined : this.defEnv,
      )
      const params = (this.node.params ?? []).map((p: ASTNode) =>
        p?.type === 'Identifier' ? p.name : null,
      )
      for (const p of params) {
        if (p === null) {
          throw new Error('E_UNSUPPORTED_SYNTAX: non-identifier function parameters are not supported')
        }
      }
      params.forEach((p: string, i: number) => env.vars.set(p, args[i]))
      // Named function expression self-binding (matches the vm path, where
      // transformFunction emits `__ctx.<name> = async function <name>(...)` —
      // the function name inside the body binds to the function itself).
      if (this.node.id?.name) {
        env.vars.set(this.node.id.name, this)
      }
      if (this.node.body?.type === 'BlockStatement') {
        try {
          await state.execBody(this.node.body.body ?? [], env)
        } catch (e) {
          if (e instanceof ReturnSignal) return e.value
          throw e
        }
        return undefined
      }
      // arrow with expression body
      return await state.evalExpr(this.node.body, env)
    } finally {
      state.depth--
    }
  }
}
