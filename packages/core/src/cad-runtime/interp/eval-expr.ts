/**
 * eval-expr — expression evaluation for the AST interpreter.
 *
 * Semantics contract: must stay observably identical to the vm backend
 * (`new Function` executing the transformed unit text) for every construct
 * the S4/S5 scanner admits. Notable alignments:
 * - call args are evaluated eagerly, spread supported;
 * - bare callee to a ctx-stored closure resolves through env (ctx/name);
 * - optional chaining / nullish coalescing follow JS semantics;
 * - assignment / update write through env.assign (root → ctx, D1);
 * - template literals and binary/unary/logical operators mirror JS.
 */
import type { ASTNode } from '../exec-backend'
import { InterpEnv, type InterpState } from './env'
import { InterpClosure } from './closure'

function unsupported(node: ASTNode): never {
  throw new Error(`E_UNSUPPORTED_SYNTAX: expression ${node?.type} is not supported by the interpreter backend`)
}

/**
 * Evaluate one AST expression node.
 * @param node - expression AST node.
 * @param env - current lexical environment.
 * @param state - shared interpreter state (host, recursion guard, wired evaluators).
 * @returns the evaluated value.
 */
export async function evalExpr(node: ASTNode, env: InterpEnv, state: InterpState): Promise<unknown> {
  switch (node.type) {
    case 'Literal':
      return node.value
    case 'Identifier': {
      if (node.name === 'undefined') return undefined
      const b = env.lookup(node.name)
      if (!b) throw new ReferenceError(`${node.name} is not defined`)
      return b.value
    }
    case 'TemplateLiteral': {
      let out = ''
      const quasis = node.quasis ?? []
      const exprs = node.expressions ?? []
      for (let i = 0; i < quasis.length; i++) {
        out += quasis[i].value.cooked ?? quasis[i].value.raw ?? ''
        if (i < exprs.length) {
          out += String(await evalExpr(exprs[i], env, state))
        }
      }
      return out
    }
    case 'TaggedTemplateExpression': {
      return unsupported(node)
    }
    case 'ArrayExpression': {
      const out: unknown[] = []
      for (const el of node.elements ?? []) {
        if (el === null) out.push(undefined)
        else if (el.type === 'SpreadElement') out.push(...((await evalExpr(el.argument, env, state)) as unknown[]))
        else out.push(await evalExpr(el, env, state))
      }
      return out
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const prop of node.properties ?? []) {
        if (prop.type === 'SpreadElement') {
          Object.assign(out, await evalExpr(prop.argument, env, state))
          continue
        }
        // Property ( scanners admit no methods; computed keys allowed )
        const key = prop.computed
          ? String(await evalExpr(prop.key, env, state))
          : prop.key.type === 'Identifier'
            ? prop.key.name
            : String(prop.key.value)
        out[key] = await evalExpr(prop.value, env, state)
      }
      return out
    }
    case 'UnaryExpression': {
      if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
        const b = env.lookup(node.argument.name)
        return b ? typeof b.value : 'undefined'
      }
      const v = await evalExpr(node.argument, env, state)
      switch (node.operator) {
        case '-': return -(v as number)
        case '+': return +(v as number)
        case '!': return !v
        case '~': return ~(v as number)
        case 'void': return undefined
        case 'delete': return true
        default: return unsupported(node)
      }
    }
    case 'BinaryExpression': {
      const l = await evalExpr(node.left, env, state)
      const r = await evalExpr(node.right, env, state)
      switch (node.operator) {
        case '+': return (l as number) + (r as number)
        case '-': return (l as number) - (r as number)
        case '*': return (l as number) * (r as number)
        case '/': return (l as number) / (r as number)
        case '%': return (l as number) % (r as number)
        case '**': return (l as number) ** (r as number)
        case '==': {
          return l == r
        }
        case '!=': {
          return l != r
        }
        case '===': return l === r
        case '!==': return l !== r
        case '<': return (l as number) < (r as number)
        case '<=': return (l as number) <= (r as number)
        case '>': return (l as number) > (r as number)
        case '>=': return (l as number) >= (r as number)
        case '&': return (l as number) & (r as number)
        case '|': return (l as number) | (r as number)
        case '^': return (l as number) ^ (r as number)
        case '<<': return (l as number) << (r as number)
        case '>>': return (l as number) >> (r as number)
        case '>>>': return (l as number) >>> (r as number)
        case 'instanceof': return (l as object) instanceof (r as (...a: never[]) => object)
        case 'in': return (l as string | number | symbol) in (r as object)
        default: return unsupported(node)
      }
    }
    case 'LogicalExpression': {
      switch (node.operator) {
        case '||': {
          const l = await evalExpr(node.left, env, state)
          return l || (await evalExpr(node.right, env, state))
        }
        case '&&': {
          const l = await evalExpr(node.left, env, state)
          return !l ? l : await evalExpr(node.right, env, state)
        }
        case '??': {
          const l = await evalExpr(node.left, env, state)
          return l !== null && l !== undefined ? l : await evalExpr(node.right, env, state)
        }
        default: return unsupported(node)
      }
    }
    case 'ConditionalExpression':
      return (await evalExpr(node.test, env, state))
        ? await evalExpr(node.consequent, env, state)
        : await evalExpr(node.alternate, env, state)
    case 'AssignmentExpression': {
      const value =
        node.operator === '='
          ? await evalExpr(node.right, env, state)
          : await evalExpr(
              { type: 'BinaryExpression', operator: node.operator.slice(0, -1), left: node.left, right: node.right },
              env,
              state,
            )
      assignTarget(node.left, value, env)
      return value
    }
    case 'UpdateExpression': {
      const old = (await evalExpr(node.argument, env, state)) as number
      const value = node.operator === '++' ? old + 1 : old - 1
      assignTarget(node.argument, value, env)
      return node.prefix ? value : old
    }
    case 'MemberExpression': {
      const obj = await evalExpr(node.object, env, state)
      const key = node.computed
        ? await evalExpr(node.property, env, state)
        : node.property.name
      if (obj === null || obj === undefined) {
        throw new TypeError(`Cannot read properties of ${obj} (reading '${key}')`)
      }
      return (obj as Record<string | symbol, unknown>)[key as string]
    }
    case 'ChainExpression':
      return evalExpr(node.expression, env, state)
    case 'AwaitExpression':
      return evalExpr(node.argument, env, state)
    case 'SequenceExpression': {
      let last: unknown
      for (const e of node.expressions ?? []) last = await evalExpr(e, env, state)
      return last
    }
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return new InterpClosure(node, env)
    case 'CallExpression':
      return evalCall(node, env, state)
    default:
      unsupported(node)
  }
}

function assignTarget(left: ASTNode, value: unknown, env: InterpEnv): void {
  if (left.type === 'Identifier') {
    env.assign(left.name, value)
    return
  }
  throw new Error(`E_UNSUPPORTED_SYNTAX: assignment target ${left.type} is not supported by the interpreter backend`)
}

async function evalCall(node: ASTNode, env: InterpEnv, state: InterpState): Promise<unknown> {
  // callee: resolve function value + this binding
  let fn: unknown
  let thisArg: unknown
  if (node.callee.type === 'MemberExpression') {
    const obj = await evalExpr(node.callee.object, env, state)
    const key = node.callee.computed
      ? await evalExpr(node.callee.property, env, state)
      : node.callee.property.name
    if (obj === null || obj === undefined) {
      throw new TypeError(`Cannot read properties of ${obj} (reading '${key}')`)
    }
    fn = (obj as Record<string | symbol, unknown>)[key as string]
    thisArg = obj
  } else {
    fn = await evalExpr(node.callee, env, state)
  }
  const args: unknown[] = []
  for (const a of node.arguments ?? []) {
    if (a.type === 'SpreadElement') args.push(...((await evalExpr(a.argument, env, state)) as unknown[]))
    else args.push(await evalExpr(a, env, state))
  }
  if (fn instanceof InterpClosure) {
    return await fn.call(args, state)
  }
  if (typeof fn !== 'function') {
    // Mirror the vm path's TypeError text: generated code renders ctx-rooted
    // receivers as `__ctx.<name>` (top-level units rewrite declared names),
    // plain locals/params keep their source name.
    if (
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.object.type === 'Identifier' &&
      node.callee.property.type === 'Identifier'
    ) {
      const name = node.callee.object.name
      const b = env.lookup(name)
      const desc = b?.where === 'ctx' ? `__ctx.${name}` : name
      throw new TypeError(`${desc}.${node.callee.property.name} is not a function`)
    }
    throw new TypeError('expression is not a function')
  }
  return await (fn as (...a: unknown[]) => unknown).apply(thisArg, args)
}
