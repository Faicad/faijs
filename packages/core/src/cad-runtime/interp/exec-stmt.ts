/**
 * exec-stmt — statement execution for the AST interpreter.
 *
 * Block semantics intentionally mirror the vm backend's hoistBlockText (R-5
 * v1): there are NO nested scopes for let/const inside blocks — every
 * declaration (including for-loop counters) writes through to the persistent
 * ctx. Closures created inside blocks therefore capture the shared ctx
 * binding, exactly as the vm path does.
 *
 * Local function declarations inside blocks become InterpClosure values in a
 * function-local env (the vm path's text rewrite cannot express them; the
 * corpus does not exercise them — interpreter picks the sane behavior).
 *
 * The positional+named call ABI (§3.4/§3.6, splitPositionalOptions) is
 * implemented in InterpClosure.call — user functions are invoked through it
 * by evalExpr's CallExpression path.
 */
import type { ASTNode } from '../exec-backend'
import { InterpEnv, type InterpState } from './env'
import { InterpClosure } from './closure'
import { BreakSignal, ContinueSignal, ReturnSignal, isControlSignal } from './signals'
import { evalExpr } from './eval-expr'

function unsupported(node: ASTNode): never {
  throw new Error(`E_UNSUPPORTED_SYNTAX: statement ${node?.type} is not supported by the interpreter backend`)
}

/**
 * Execute a statement list. Returns when a signal unwinds (caller catches).
 * @param body - statement AST nodes to execute in order.
 * @param env - current lexical environment.
 * @param state - shared interpreter state.
 */
export async function execBody(body: ASTNode[], env: InterpEnv, state: InterpState): Promise<void> {
  for (const stmt of body) {
    await execStmt(stmt, env, state)
  }
}

/**
 * Execute one AST statement node.
 * @param node - statement AST node.
 * @param env - current lexical environment.
 * @param state - shared interpreter state.
 */
export async function execStmt(node: ASTNode, env: InterpEnv, state: InterpState): Promise<void> {
  switch (node.type) {
    case 'VariableDeclaration': {
      for (const d of node.declarations ?? []) {
        await execDeclarator(d, env, state)
      }
      return
    }
    case 'ExpressionStatement':
      await evalExpr(node.expression, env, state)
      return
    case 'BlockStatement':
      await execBody(node.body ?? [], env, state) // no new scope (R-5 v1)
      return
    case 'FunctionDeclaration': {
      const name = node.id?.name
      if (!name) unsupported(node)
      env.assign(name, new InterpClosure(node, env))
      return
    }
    case 'IfStatement': {
      if (await evalExpr(node.test, env, state)) {
        await execStmt(node.consequent, env, state)
      } else if (node.alternate) {
        await execStmt(node.alternate, env, state)
      }
      return
    }
    case 'WhileStatement': {
      while (await evalExpr(node.test, env, state)) {
        try {
          await execStmt(node.body, env, state)
        } catch (e) {
          if (e instanceof BreakSignal && !e.label) return
          if (e instanceof ContinueSignal && !e.label) continue
          throw e
        }
      }
      return
    }
    case 'DoWhileStatement': {
      do {
        try {
          await execStmt(node.body, env, state)
        } catch (e) {
          if (e instanceof BreakSignal && !e.label) return
          if (e instanceof ContinueSignal && !e.label) {
            // fall through to the test
          } else {
            throw e
          }
        }
      } while (await evalExpr(node.test, env, state))
      return
    }
    case 'ForStatement': {
      if (node.init) await execStmt(node.init.type === 'VariableDeclaration' ? node.init : { type: 'ExpressionStatement', expression: node.init }, env, state)
      while (node.test ? await evalExpr(node.test, env, state) : true) {
        try {
          await execStmt(node.body, env, state)
        } catch (e) {
          if (e instanceof BreakSignal && !e.label) return
          if (e instanceof ContinueSignal && !e.label) {
            // fall through to update
          } else {
            throw e
          }
        }
        if (node.update) await evalExpr(node.update, env, state)
      }
      return
    }
    case 'ForOfStatement':
    case 'ForInStatement': {
      const isOf = node.type === 'ForOfStatement'
      const iterable = isOf
        ? await evalExpr(node.right, env, state)
        : await evalExpr(node.right, env, state)
      const list: unknown[] = isOf
        ? [...(iterable as Iterable<unknown>)]
        : Object.keys(iterable as object)
      if (node.left?.type !== 'VariableDeclaration' && node.left?.type !== 'Identifier') unsupported(node)
      const varName = node.left.type === 'Identifier' ? node.left.name : node.left.declarations?.[0]?.id?.name
      if (typeof varName !== 'string') unsupported(node)
      for (const item of list) {
        env.assign(varName, item)
        try {
          await execStmt(node.body, env, state)
        } catch (e) {
          if (e instanceof BreakSignal && !e.label) return
          if (e instanceof ContinueSignal && !e.label) continue
          throw e
        }
      }
      return
    }
    case 'SwitchStatement': {
      const disc = await evalExpr(node.discriminant, env, state)
      const cases = node.cases ?? []
      let started = false
      try {
        for (const c of cases) {
          if (!started && c.test) {
            if ((await evalExpr(c.test, env, state)) === disc) started = true
            else continue
          }
          if (!started && !c.test) continue // default: only after a match (JS: default may be anywhere)
          started = true
          await execBody(c.consequent ?? [], env, state)
        }
      } catch (e) {
        if (e instanceof BreakSignal && !e.label) return
        throw e
      }
      return
    }
    case 'BreakStatement':
      throw new BreakSignal(node.label?.name)
    case 'ContinueStatement':
      throw new ContinueSignal(node.label?.name)
    case 'ReturnStatement':
      throw new ReturnSignal(node.argument ? await evalExpr(node.argument, env, state) : undefined)
    case 'ThrowStatement':
      throw await evalExpr(node.argument, env, state)
    case 'TryStatement': {
      try {
        await execStmt(node.block, env, state)
      } catch (e) {
        // control signals are engine-internal — never observable to user catch
        if (isControlSignal(e)) throw e
        if (node.handler) {
          // catch-clause scope: writes stay local, reads fall through to the
          // enclosing env (D4) — root env has no fall-through parent (vm path:
          // catch param is the only clause-scoped binding)
          const overlayEnv = new OverlayEnv(env, state.host.ctx, state.host.namespaces as Record<string, unknown>)
          if (node.handler.param?.type === 'Identifier') overlayEnv.vars.set(node.handler.param.name, e)
          await execBody(node.handler.body?.body ?? [], overlayEnv, state)
        } else {
          throw e
        }
      } finally {
        if (node.finalizer) await execBody(node.finalizer.body ?? [], env, state)
      }
      return
    }
    case 'LabeledStatement':
      await execLabeled(node.label.name, node.body, env, state)
      return
    case 'EmptyStatement':
      return
    default:
      unsupported(node)
  }
}

/** Labeled loop: catches signals whose label matches; unlabeled signals from
 *  inner loops are absorbed by their own handlers, so a labeled signal here
 *  always targets this statement (or an outer one — rethrow). */
async function execLabeled(label: string, body: ASTNode, env: InterpEnv, state: InterpState): Promise<void> {
  const isLoop =
    body.type === 'ForStatement' || body.type === 'WhileStatement' ||
    body.type === 'DoWhileStatement' || body.type === 'ForOfStatement' || body.type === 'ForInStatement'
  if (!isLoop) {
    await execStmt(body, env, state)
    return
  }
  try {
    await execStmt(body, env, state)
  } catch (e) {
    if ((e instanceof BreakSignal || e instanceof ContinueSignal) && e.label === label) return
    throw e
  }
}

async function execDeclarator(d: ASTNode, env: InterpEnv, state: InterpState): Promise<void> {
  const init = d?.init ? await evalExpr(d.init, env, state) : undefined
  if (d?.id?.type === 'ObjectPattern') {
    for (const prop of d.id.properties ?? []) {
      if (prop.type !== 'Property') unsupported(prop)
      const key = prop.key?.type === 'Identifier' ? prop.key.name : String(prop.key?.value)
      const bind = prop.value?.type === 'Identifier' ? prop.value.name : null
      if (bind === null) unsupported(prop)
      env.assign(bind, (init as Record<string, unknown>)?.[key])
    }
    return
  }
  if (d?.id?.type === 'ArrayPattern') {
    let i = 0
    for (const el of d.id.elements ?? []) {
      if (el?.type === 'Identifier') env.assign(el.name, (init as unknown[])?.[i])
      else if (el !== null) unsupported(el)
      i++
    }
    return
  }
  if (d?.id?.type === 'Identifier') {
    env.assign(d.id.name, init)
    return
  }
  unsupported(d)
}

/**
 * Catch-clause env: writes stay local, reads fall through to the parent chain
 * (mirrors the vm path, where the catch param is an ordinary clause-scoped
 * binding and other identifiers resolve through the enclosing wrapper).
 */
class OverlayEnv extends InterpEnv {
  constructor(
    private readonly parentEnv: InterpEnv | undefined,
    ctx: Record<string, unknown>,
    ns: Record<string, unknown>,
  ) {
    super('overlay', ctx, ns)
  }

  override lookup(name: string): ReturnType<InterpEnv['lookup']> {
    const local = super.lookup(name)
    if (local) return local
    return this.parentEnv?.lookup(name)
  }
}
