/**
 * interp-backend — AST interpreter execution backend.
 *
 * Executes transformed units directly on the retained acorn AST: no `new
 * Function`, no `eval`, no dynamic import — the only execution backend that
 * runs in restricted realms (WeChat mini-program, strict CSP web).
 *
 * Contract with DirectExecutor (must stay observably identical to VmBackend):
 * - the persistent ctx IS the variable container (root env, D1);
 * - top-level function declarations were hoisted into ctx as async closures
 *   by transformFunction in the vm path — here the FunctionDeclaration unit
 *   creates an InterpClosure in ctx with the same name/params;
 * - block units share the root env (R-5 v1, no nested scopes);
 * - bare-call geometric writeback is performed by DirectExecutor's transform
 *   for the vm path; the interpreter mirrors it here (double condition on
 *   host.isGeom) using unit.writes[0] as the static candidate target.
 */
import type { ExecBackend, ExecHost, TransformedUnit, ASTNode } from '../exec-backend'
import { InterpEnv } from '../interp/env'
import type { InterpState } from '../interp/env'
import { BreakSignal, ContinueSignal, isControlSignal } from '../interp/signals'
import { evalExpr } from '../interp/eval-expr'
import { execBody, execStmt } from '../interp/exec-stmt'
import { InterpClosure } from '../interp/closure'

/** Default closure recursion cap (matches the vm path's natural stack limit
 *  order of magnitude; tuned by the perf-budget test). */
const MAX_CLOSURE_DEPTH = 200

/**
 * AST-interpreter execution backend: runs transformed units directly on the
 * retained acorn AST. No `new Function`, no `eval`, no dynamic `import()` —
 * the backend for restricted realms (WeChat mini-program / strict CSP).
 * Semantics contract: observably identical to VmBackend (see the differential
 * suite exec-backend-diff.test.ts).
 */
export class InterpBackend implements ExecBackend {
  async runUnit(unit: TransformedUnit, host: ExecHost): Promise<void> {
    const node = unit.node as ASTNode | undefined
    if (!node) {
      throw new Error('E_INTERNAL: interpreter backend requires the AST node on the transformed unit')
    }
    const state: InterpState = {
      host,
      depth: 0,
      maxDepth: MAX_CLOSURE_DEPTH,
      evalExpr: (n: ASTNode, env: InterpEnv) => evalExpr(n, env, state),
      execBody: (body: ASTNode[], env: InterpEnv) => execBody(body, env, state),
    }
    const env = new InterpEnv('root', host.ctx, host.namespaces)

    try {
      switch (node.type) {
        case 'FunctionDeclaration': {
          const name = node.id?.name
          if (!name) throw new Error('E_STATEMENT: function declaration must have a name')
          host.ctx[name] = new InterpClosure(node, env)
          return
        }
        case 'VariableDeclaration':
        case 'ExpressionStatement':
        case 'BlockStatement':
        case 'IfStatement':
        case 'ForStatement':
        case 'ForOfStatement':
        case 'ForInStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'SwitchStatement':
        case 'TryStatement':
        case 'ThrowStatement':
        case 'LabeledStatement':
        case 'EmptyStatement':
          if (node.type === 'ExpressionStatement' && this.isBareCallWithWriteback(node, unit)) {
            await this.runBareCallWriteback(node, unit, env, state, host)
            return
          }
          await execStmt(node, env, state)
          return
        default:
          throw new Error(`E_UNSUPPORTED_SYNTAX: top-level statement ${node.type} is not supported by the interpreter backend`)
      }
    } catch (e) {
      // a control signal escaping a unit boundary is an interpreter bug, not a
      // user-visible error — convert to a plain internal error
      if (isControlSignal(e)) {
        const kind = e instanceof BreakSignal ? 'break' : e instanceof ContinueSignal ? 'continue' : 'return'
        throw new Error(`E_INTERNAL: ${kind} signal escaped unit boundary (line ${unit.lineNo})`, { cause: e })
      }
      throw e
    }
  }

  /** Bare call with a static writeback candidate (P25 §3.7 rule 2): run the
   *  call, then apply the runtime double condition
   *  isGeom(result) && isGeom(ctx[target]) before writing back.
   *  Re-assignments (`x = call`) are NOT bare calls — they assign
   *  unconditionally through execStmt, matching the vm path. */
  private isBareCallWithWriteback(node: ASTNode, unit: TransformedUnit): boolean {
    return (
      node.expression?.type === 'CallExpression' &&
      unit.callee !== undefined &&
      (unit.writes?.length ?? 0) > 0
    )
  }

  private async runBareCallWriteback(
    node: ASTNode,
    unit: TransformedUnit,
    env: InterpEnv,
    state: InterpState,
    host: ExecHost,
  ): Promise<void> {
    const result = await evalExpr(node.expression, env, state)
    const target = unit.writes[0]
    if (host.isGeom(result) && host.isGeom(host.ctx[target])) {
      host.ctx[target] = result
    }
  }
}
