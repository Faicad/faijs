/**
 * parser — 文本 → ScriptIR（合法 JS 子集，设计文档 §2）
 *
 * 执行模型：`.faijs` 文本先用 acorn 解析（合法性证明 J-1），再 walk AST 还原为 ScriptIR。
 * 绝不 eval / new Function / import() 真执行。
 *
 * 支持的语法（合法 JS 子集）：
 * - `// apiVersion: N` — 版本声明（可选，默认 1）
 * - `export default async (cad) => { ... }` — 唯一合法容器
 * - `const <name> = <literal>` → ParamDef（参数声明，右侧仅字面量）
 * - `const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { ...args })` → StatementIR
 * - `cad.union/subtract/intersect(inputVar, inputVar)` → boolean op
 * - `cad.faceCenter(var)` / `cad.faceNormal(var)` / `cad.bboxCenter(var)` / ... → GeomRef
 * - `return { shape: part<N>_v<M>, name, color, metalness, roughness }` → ScriptIR.meta
 *
 * 禁止（acorn 抛错或 AST walk 拒绝即 ParseError）：
 * - `param` / `with` 关键字、对象字面量用 `=`
 * - 循环 / 条件 / IIFE / try-catch / 模板字符串
 * - 多 default export、函数定义（除顶层箭头外）
 * - eval / new Function / 动态 import()
 */

import { parse as acornParse } from 'acorn'
import type {
  ArgIR,
  StatementIR,
  JsonValue,
  ParamDef,
  ParamRefIR,
  ScriptIR,
  ScriptMetaIR,
  TerminalShape,
} from './types'
import { isParamRef, isVarRef, isCallRef } from './types'
import {
  asStmtId,
  asPartName,
  type PartName,
} from '../identity'

// ── 解析错误 ──

export class ParseError extends Error {
  line: number

  constructor(message: string, line: number) {
    super(`[parser] line ${line}: ${message}`)
    this.name = 'ParseError'
    this.line = line
  }
}

// ── AST 辅助类型（acorn ESTree 兼容） ──

type ASTNode = any

function getLine(node: ASTNode): number {
  return node?.loc?.start?.line ?? 0
}

// ── AST 辅助常量 ──
// (none: the parser holds zero function-name knowledge — A1/A7 constants removed)

// ── AST 值解析 ──

/** 解析字面量 / 数组 / 对象 / ParamRefIR / GeomRef */
function parseValueExpr(
  node: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
  line: number,
): ArgIR {
  if (!node) throw new ParseError('missing value expression', line)

  switch (node.type) {
    case 'Literal':
      return node.value

    case 'Identifier': {
      // 裸标识符：参数变量 → ParamRefIR；已声明变量 → VarRefIR（A7 消灭后通用）
      const name = node.name
      if (paramNames.has(name)) {
        const ref: ParamRefIR = { $param: name }
        return ref
      }
      const varId = varToId.get(name)
      if (varId) {
        return { $ref: varId } as ArgIR
      }
      throw new ParseError(`unknown identifier "${name}" in args value (not a declared param or variable)`, line)
    }

    case 'ArrayExpression': {
      return node.elements.map((el: ASTNode) => parseValueExpr(el, paramNames, varToId, line))
    }

    case 'ObjectExpression': {
      const obj: Record<string, ArgIR> = {}
      for (const prop of node.properties) {
        // shorthand property: { size } → { size: size }
        const key = prop.key.type === 'Identifier' ? prop.key.name
          : prop.key.type === 'Literal' ? String(prop.key.value)
          : null
        if (key === null) {
          throw new ParseError(`invalid object key`, line)
        }
        // shorthand: { size } → value is the same identifier
        if (prop.shorthand) {
          if (paramNames.has(key)) {
            obj[key] = { $param: key } as ParamRefIR
          } else {
            throw new ParseError(`unknown shorthand identifier "${key}" (not a declared param)`, line)
          }
        } else {
          obj[key] = parseValueExpr(prop.value, paramNames, varToId, line)
        }
      }
      return obj as ArgIR
    }

    case 'CallExpression': {
      // 嵌套调用 → CallRefIR（A7 消灭后任意 cad.<ident>(...) 都合法）
      const callee = node.callee
      if (
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'cad' &&
        callee.property?.type === 'Identifier'
      ) {
        const innerCallee = callee.property.name
        const innerArgs = node.arguments.map((a: ASTNode) => parseValueExpr(a, paramNames, varToId, line))
        return { $call: { callee: innerCallee, args: innerArgs } } as ArgIR
      }
      throw new ParseError('nested calls in args must be cad.<ident>(...)', line)
    }

    case 'UnaryExpression':
      // 负数: -5
      if (node.operator === '-' && node.argument?.type === 'Literal') {
        return -node.argument.value
      }
      throw new ParseError(`unsupported unary expression in args value`, line)

    default:
      throw new ParseError(`unsupported value expression: ${node.type}`, line)
  }
}

// ── StatementIR 解析 ──

interface ParsedStatement {
  stmt: StatementIR
  varName: string
  /** 词法声明的输出名（parser 收集，最终遍历经 varToId 解析为物理 partName 后写入 stmt.outputs） */
  declaredOutputs: string[]
}

/**
 * 解析一条 `const varName = [await] cad.op(...)` 语句。
 */
function parseCadStatement(
  declNode: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
): ParsedStatement {
  const line = getLine(declNode)

  // 提取变量名
  if (declNode.id?.type !== 'Identifier') {
    throw new ParseError('expected identifier on left side of const declaration', line)
  }
  const varName = declNode.id.name

  // 提取 init（可能包在 AwaitExpression 里）
  let init = declNode.init
  if (init?.type === 'AwaitExpression') {
    init = init.argument
  }

  // init 必须是 CallExpression
  if (init?.type !== 'CallExpression') {
    throw new ParseError(`expected cad.<op>(...) call, got ${init?.type ?? 'null'}`, line)
  }

  // callee 必须是 MemberExpression: cad.<op>
  const callee = init.callee
  if (
    callee?.type !== 'MemberExpression' ||
    callee.object?.type !== 'Identifier' ||
    callee.object.name !== 'cad' ||
    callee.property?.type !== 'Identifier'
  ) {
    throw new ParseError('expected cad.<op>(...) call', line)
  }

  const opName = callee.property.name

  // 普通调用：callee 就是源码里的名字（A1 boolean 改写 / A4 load 收敛已删）
  let args: Record<string, ArgIR> = {}
  const inputs: PartName[] = []
  for (const argNode of init.arguments) {
    if (argNode.type === 'Identifier') {
      // input 变量引用
      const inputId = varToId.get(argNode.name)
      if (!inputId) {
        throw new ParseError(`unknown variable "${argNode.name}" in inputs`, getLine(argNode))
      }
      inputs.push(inputId)
    } else if (argNode.type === 'ObjectExpression') {
      // args 对象
      const parsed = parseValueExpr(argNode, paramNames, varToId, line)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, ArgIR>
      } else {
        throw new ParseError('args must be an object', line)
      }
    } else {
      throw new ParseError(`unexpected argument type: ${argNode.type}`, getLine(argNode))
    }
  }

  // Phase 3：id 不再赋变量名，由最终遍历赋 sN；变量名记录到 declaredOutputs
  const stmt: StatementIR = {
    id: asStmtId('__pending__'), callee: opName, args, inputs,
    outputs: [],
    hasAssignment: true,
  }

  return { stmt, varName, declaredOutputs: [varName] }
}

// ── 通用解构解析（A2 消灭：任意 callee、任意键） ──

interface ParsedDestructuring {
  /** 语句列表（解构调用本身） */
  stmt: StatementIR
  /** 每个解构值的词法变量名（与 keys 一一对应） */
  valueNames: string[]
  /** 词法声明的输出名 */
  declaredOutputs: string[]
}

/**
 * 解析 `const { k1: v1, k2: v2 } = [await] cad.<any>(...)`。
 *
 * 任意键数（1..N）、任意 callee（不再限 split/front/back）。
 */
function parseDestructuring(
  declNode: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
): ParsedDestructuring {
  const line = getLine(declNode)

  // id 必须是 ObjectPattern
  if (declNode.id?.type !== 'ObjectPattern') {
    throw new ParseError('expected object pattern for destructuring', line)
  }

  const props = declNode.id.properties
  if (props.length === 0) {
    throw new ParseError('destructuring must have at least one property', line)
  }

  const keys: string[] = []
  const valueNames: string[] = []
  for (const prop of props) {
    if (prop.type !== 'Property' || prop.key?.type !== 'Identifier') {
      throw new ParseError('destructuring properties must be identifiers', line)
    }
    if (prop.value?.type !== 'Identifier') {
      throw new ParseError(`destructuring value for "${prop.key.name}" must be an identifier`, line)
    }
    keys.push(prop.key.name)
    valueNames.push(prop.value.name)
  }

  // 提取 init（可包 AwaitExpression），必须是 cad.<ident>(...) 调用
  let init = declNode.init
  if (init?.type === 'AwaitExpression') {
    init = init.argument
  }
  if (init?.type !== 'CallExpression') {
    throw new ParseError(`expected cad.<op>(...) call in destructuring, got ${init?.type ?? 'null'}`, line)
  }

  const callee = init.callee
  if (
    callee?.type !== 'MemberExpression' ||
    callee.object?.type !== 'Identifier' ||
    callee.object.name !== 'cad' ||
    callee.property?.type !== 'Identifier'
  ) {
    throw new ParseError('destructuring is only allowed for cad.<op>(...) calls', line)
  }

  const opName = callee.property.name
  const args: Record<string, ArgIR> = {}
  const inputs: PartName[] = []

  for (const argNode of init.arguments) {
    if (argNode.type === 'Identifier') {
      const inputId = varToId.get(argNode.name)
      if (!inputId) {
        throw new ParseError(`unknown variable "${argNode.name}" in destructuring inputs`, getLine(argNode))
      }
      inputs.push(inputId)
    } else if (argNode.type === 'ObjectExpression') {
      const parsed = parseValueExpr(argNode, paramNames, varToId, line)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(args, parsed as Record<string, ArgIR>)
      } else {
        throw new ParseError('destructuring args must be an object', line)
      }
    } else {
      throw new ParseError(`unexpected argument type in destructuring: ${argNode.type}`, getLine(argNode))
    }
  }

  // Phase 3：id 不再赋变量名；outputs 在最终遍历经 varToId 解析后写入
  const stmt: StatementIR = {
    id: asStmtId('__pending__'), callee: opName, args, inputs, outputs: [],
    outputKeys: keys,
    hasAssignment: true,
  }

  return { stmt, valueNames, declaredOutputs: valueNames }
}

// ── meta 解析 ──

/**
 * 解析 return 语句，提取 terminal shape(s) 和 meta。
 *
 * 支持三种形式：
 * - `return part0_vN`（裸标识符）→ 单终端，无 meta
 * - `return { shape: part0_vN, name, color, ... }`（单终端 + meta）
 * - `return [ { shape: part1, name, ... }, { shape: part2, name, ... } ]`（多终端）
 */
function parseReturnStatement(
  node: ASTNode,
  varToId: Map<string, PartName>,
): { terminalShapeId: PartName | null; meta: ScriptMetaIR | undefined; terminalShapes: TerminalShape[] | undefined } {
  const line = getLine(node)
  const arg = node.argument

  if (!arg) {
    return { terminalShapeId: null, meta: undefined, terminalShapes: undefined }
  }

  // return part0_vN（裸标识符）
  if (arg.type === 'Identifier') {
    const ref = varToId.get(arg.name)
    if (!ref) {
      throw new ParseError(`unknown variable "${arg.name}" in return`, line)
    }
    return { terminalShapeId: ref, meta: undefined, terminalShapes: undefined }
  }

  // return { shape: part0_vN, name, color, ... }
  if (arg.type === 'ObjectExpression') {
    const result = parseReturnObject(arg, varToId, line)
    return { terminalShapeId: result.id, meta: result.meta, terminalShapes: undefined }
  }

  // return [ { shape: ... }, ... ]（多终端）
  if (arg.type === 'ArrayExpression') {
    const terminalShapes: TerminalShape[] = []
    for (const elem of arg.elements) {
      if (elem?.type !== 'ObjectExpression') {
        throw new ParseError('return array elements must be objects { shape, ... }', line)
      }
      const result = parseReturnObject(elem, varToId, line)
      if (result.id) {
        terminalShapes.push({ id: result.id, meta: result.meta })
      }
    }
    if (terminalShapes.length === 0) {
      throw new ParseError('return array must have at least one element', line)
    }
    // 单元素数组等价为单终端
    if (terminalShapes.length === 1) {
      return { terminalShapeId: terminalShapes[0].id, meta: terminalShapes[0].meta, terminalShapes: undefined }
    }
    return { terminalShapeId: null, meta: undefined, terminalShapes }
  }

  throw new ParseError(`unsupported return expression: ${arg.type}`, line)
}

/** 解析单个 return 元素 { shape: varName, name?, color?, metalness?, roughness? } */
function parseReturnObject(
  objNode: ASTNode,
  varToId: Map<string, PartName>,
  line: number,
): { id: PartName | null; meta: ScriptMetaIR | undefined } {
  let id: PartName | null = null
  const meta: ScriptMetaIR = {}

  for (const prop of objNode.properties) {
    const key = prop.key?.type === 'Identifier' ? prop.key.name
      : prop.key?.type === 'Literal' ? String(prop.key.value)
      : null
    if (!key) continue

    if (key === 'shape') {
      if (prop.value?.type === 'Identifier') {
        const ref = varToId.get(prop.value.name)
        if (!ref) {
          throw new ParseError(`unknown variable "${prop.value.name}" in return shape`, line)
        }
        id = ref
      }
    } else if (key === 'name') {
      if (prop.value?.type === 'Literal') {
        meta.name = prop.value.value as string
      }
    } else if (key === 'color') {
      if (prop.value?.type === 'Literal') {
        if (!meta.appearance) meta.appearance = {}
        meta.appearance.color = prop.value.value as string
      }
    } else if (key === 'metalness') {
      if (prop.value?.type === 'Literal') {
        if (!meta.appearance) meta.appearance = {}
        meta.appearance.metalness = prop.value.value as number
      }
    } else if (key === 'roughness') {
      if (prop.value?.type === 'Literal') {
        if (!meta.appearance) meta.appearance = {}
        meta.appearance.roughness = prop.value.value as number
      }
    }
  }

  return { id, meta: Object.keys(meta).length > 0 ? meta : undefined }
}

// ── 引用收集（Phase 1: VM 执行 deps 计算） ──

/** 递归收集 ArgIR 中的变量引用：$param → 参数名；$ref → 变量名；$call → 递归收集内部 args。 */
function collectRefsFromArg(value: ArgIR, out: Set<string>): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return
  if (isParamRef(value)) {
    out.add(value.$param)
    return
  }
  if (isVarRef(value)) {
    out.add(value.$ref)
    return
  }
  if (isCallRef(value)) {
    for (const a of value.$call.args) collectRefsFromArg(a, out)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefsFromArg(v as ArgIR, out)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectRefsFromArg(v as ArgIR, out)
  }
}

/**
 * 收集单条语句引用的全部变量名（inputs + args 中 $param / $ref / 嵌套调用 + receiver）。
 * 存入 stmt.refs，编译期据此翻译为 deps（定义这些变量的语句 id）。
 */
function collectStatementRefs(stmt: StatementIR): string[] {
  const refs = new Set<string>(stmt.inputs)
  for (const arg of Object.values(stmt.args)) {
    collectRefsFromArg(arg, refs)
  }
  // receiver：成员方法调用（add_constraint/do_assemble 等）依赖其 receiver 变量，
  // 不加入则成员调用对 compound 的依赖边缺失（连带 bug，见命名分层修复文档 §2.4）。
  if (stmt.receiver) refs.add(stmt.receiver)
  return [...refs]
}

// ── 主解析函数 ──

export interface ParseResult {
  script: ScriptIR
  /** 语句 id → 变量名映射（新格式下为恒等映射） */
  varToId: Map<string, string>
  /** 每条语句在源码中的行号（1-based，与 script.statements 一一对应；analyzeCode 用） */
  statementLines: number[]
}

/**
 * 解析合法 JS 子集文本为 ScriptIR。
 *
 * 步骤：
 * 1. acorn.parse — 合法性闸门（J-1），抛 SyntaxError 即文本非法
 * 2. AST walk — 只接受允许的节点形状，遇违规即 ParseError
 * 3. 构建 ScriptIR
 *
 * 零函数知识：parser 不接收任何 schemas/函数元数据（A5/A14 已删），
 * 对 callee 名字完全均匀处理。
 *
 * @throws ParseError — 含行号
 */
export function parseScript(code: string): ParseResult {

  // ── 0. 扁平代码检测与封装 ──
  // 如果代码不含 `export default`，则自动封装为合法容器
  let parseCode = code
  // 扁平封装后首行代码在 parseCode 中位于第 2 行；statementLines 须扣掉封装偏移，
  // 使行号始终相对宿主原始文本（analyzeCode 契约）。
  const lineOffset = code.includes('export default') ? 0 : 1
  if (lineOffset) {
    // 扁平格式：自动封装
    parseCode = `export default async (cad) => {\n${code}\n}`
  }

  // ── 1. acorn 解析（合法性闸门） ──
  let ast: ASTNode
  try {
    ast = acornParse(parseCode, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    })
  } catch (err) {
    const syntaxErr = err as { message?: string; loc?: { line: number } }
    const line = syntaxErr.loc?.line ?? 1
    const msg = syntaxErr.message ?? String(err)
    throw new ParseError(`SyntaxError: ${msg}`, line)
  }

  // ── 2. 验证 AST 结构 ──
  // 顶层必须是 Program，且仅含一个 ExportDefaultDeclaration
  if (ast.type !== 'Program') {
    throw new ParseError('expected a module', 1)
  }

  const exportDecl = ast.body.find((n: ASTNode) => n.type === 'ExportDefaultDeclaration')
  if (!exportDecl) {
    throw new ParseError('missing `export default`', 1)
  }

  // export default 必须是 async 箭头函数
  const arrowFn = exportDecl.declaration
  if (
    arrowFn?.type !== 'ArrowFunctionExpression' ||
    !arrowFn.async ||
    arrowFn.params.length !== 1 ||
    arrowFn.params[0]?.type !== 'Identifier' ||
    arrowFn.params[0].name !== 'cad'
  ) {
    throw new ParseError('expected `export default async (cad) => { ... }`', getLine(exportDecl))
  }

  // 箭头函数体必须是 BlockStatement
  const body = arrowFn.body
  if (body?.type !== 'BlockStatement') {
    throw new ParseError('expected arrow function body to be a block statement { ... }', getLine(arrowFn))
  }

  // ── 3. walk body ──
  const params: ParamDef[] = []
  const statements: StatementIR[] = []
  const statementLines: number[] = []
  const paramNames = new Set<string>()
  const varToId = new Map<string, PartName>()
  let meta: ScriptMetaIR | undefined
  let terminalShapes: TerminalShape[] | undefined

  for (const stmtNode of body.body) {
    const line = getLine(stmtNode)

    switch (stmtNode.type) {
      case 'VariableDeclaration': {
        // 允许 const 和 let（let 仅用于装配变量）
        if (stmtNode.kind !== 'const' && stmtNode.kind !== 'let') {
          throw new ParseError(`only 'const' or 'let' declarations allowed, got '${stmtNode.kind}'`, line)
        }
        // 单声明器
        if (stmtNode.declarations.length !== 1) {
          throw new ParseError('only single declarator per const/let allowed', line)
        }
        const decl = stmtNode.declarations[0]

        // 通用解构：const { k1: v1, k2: v2 } = [await] cad.<any>(...)（A2 消灭：任意 callee、任意键）
        if (decl.id?.type === 'ObjectPattern') {
          if (stmtNode.kind !== 'const') {
            throw new ParseError('destructuring requires const', line)
          }
          const { stmt, valueNames } = parseDestructuring(decl, paramNames, varToId)
          // 命名服务不再由 parser 调用：parser 只做语法分析，保留词法变量名（设计 §5.1）
          stmt.outputs = valueNames.map((n) => asPartName(n))
          statements.push(stmt)
          statementLines.push(line)
          // varToId 仅用于作用域校验，恒等映射（词法名 → 词法名）
          valueNames.forEach((n) => varToId.set(n, asPartName(n)))
          break
        }

        // 判断是参数还是语句
        let init = decl.init
        const isAwait = init?.type === 'AwaitExpression'
        if (isAwait) init = init.argument

        // ── E15.1 已删（A3）：group/assembly 走普通调用路径，members 数组元素经 VarRefIR 通用扫描 ──

        // Phase 3: let 允许用于普通 cad.op() 语句（单入单出复用名时 codegen 产生 let 重赋值）

        if (
          init?.type === 'CallExpression' &&
          init.callee?.type === 'MemberExpression' &&
          init.callee.object?.type === 'Identifier' &&
          init.callee.object.name === 'cad'
        ) {
          // 语句：const partN_vM = [await] cad.op(...)
          const { stmt, varName } = parseCadStatement(decl, paramNames, varToId)
          // 命名服务不再由 parser 调用：parser 只做语法分析，保留词法变量名（设计 §5.1）
          stmt.outputs = [asPartName(varName)]
          statements.push(stmt)
          statementLines.push(line)
          // varToId 仅用于作用域校验，恒等映射（词法名 → 词法名）
          varToId.set(varName, asPartName(varName))
        } else if (
          init?.type === 'Literal' ||
          init?.type === 'ArrayExpression' ||
          init?.type === 'ObjectExpression'
        ) {
          // 参数：const name = literal
          if (decl.id?.type !== 'Identifier') {
            throw new ParseError('param declaration must have identifier name', line)
          }
          const name = decl.id.name
          // 解析字面量值（不允许 ParamRefIR / GeomRef / 标识符）
          const value = parseLiteralOnly(init, line)
          params.push({
            name,
            type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'vec3',
            value: value as never,
            default: value as never,
          })
          paramNames.add(name)
        } else {
          throw new ParseError(
            `unsupported const declaration: init type = ${init?.type ?? 'null'}`,
            line,
          )
        }
        break
      }

      case 'ReturnStatement': {
        const result = parseReturnStatement(stmtNode, varToId)
        meta = result.meta
        terminalShapes = result.terminalShapes
        break
      }

      case 'ExpressionStatement': {
        const expr = stmtNode.expression

        // ── Phase 3: 裸重赋值 part0 = [await] cad.op(...) ──
        // codegen 对已声明变量的重赋值不使用 let/const，产生裸赋值表达式
        if (
          expr?.type === 'AssignmentExpression' &&
          expr.operator === '=' &&
          expr.left?.type === 'Identifier'
        ) {
          const varName = expr.left.name
          // 验证变量已声明
          if (!varToId.has(varName)) {
            throw new ParseError(`unknown variable "${varName}" in re-assignment`, line)
          }
          let init = expr.right
          if (init?.type === 'AwaitExpression') init = init.argument
          if (
            init?.type === 'CallExpression' &&
            init.callee?.type === 'MemberExpression' &&
            init.callee.object?.type === 'Identifier' &&
            init.callee.object.name === 'cad' &&
            init.callee.property?.type === 'Identifier'
          ) {
            // 复用 parseCadStatement 的内部逻辑
            const fakeDecl = {
              id: { type: 'Identifier', name: varName } as const,
              init: expr.right,
              loc: stmtNode.loc,
            }
            const { stmt, varName: parsedVar } = parseCadStatement(fakeDecl, paramNames, varToId)
            // 命名服务不再由 parser 调用：裸重赋值保留词法变量名（设计 §5.1）
            stmt.outputs = [asPartName(parsedVar)]
            statements.push(stmt)
            statementLines.push(line)
            // varToId 仅用于作用域校验，恒等映射（词法名 → 词法名）
            varToId.set(parsedVar, asPartName(parsedVar))
            break
          }
          throw new ParseError(`re-assignment must be a cad.op() call`, line)
        }

        // ── 成员方法调用（A6 消灭：任意方法名；receiver 须已声明） ──
        // assem1.add_constraint({ ... }) / assem1.do_assemble() / assem1.myMethod()
          if (
            expr?.type === 'CallExpression' &&
            expr.callee?.type === 'MemberExpression' &&
            expr.callee.object?.type === 'Identifier' &&
            expr.callee.property?.type === 'Identifier'
          ) {
            const targetVar = expr.callee.object.name
            const methodName = expr.callee.property.name
            // 验证 targetVar 已声明（变量作用域检查，非 op 知识）
            if (!varToId.has(targetVar)) {
              throw new ParseError(`unknown variable "${targetVar}" in .${methodName}() call`, line)
            }
            const args: Record<string, ArgIR> = {}
            for (const argNode of expr.arguments) {
              if (argNode.type === 'ObjectExpression') {
                const parsed = parseValueExpr(argNode, paramNames, varToId, line)
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                  Object.assign(args, parsed as Record<string, ArgIR>)
                } else {
                  throw new ParseError(`${methodName} args must be an object`, line)
                }
              } else if (argNode.type !== 'undefined') {
                throw new ParseError(`unexpected argument type in ${methodName}: ${argNode.type}`, line)
              }
            }
            const memberStmt: StatementIR = {
              id: asStmtId('__pending__'),
              callee: methodName,
              args,
              inputs: [],
              outputs: [],
              receiver: targetVar,
              hasAssignment: false,
            }
            statements.push(memberStmt)
            statementLines.push(line)
            break
          }

          // All other bare expression statements are not allowed
          throw new ParseError(
            `bare expression statements not allowed; use 'const part0_vN = cad.op(...)' instead`,
            line,
          )
        }

      default:
        throw new ParseError(`unsupported statement: ${stmtNode.type}`, line)
    }
  }

  // ── 3.5 独立 StmtId 分配 + 引用收集（Phase 3: id = sN） ──
  // StmtId 按语句顺序分配 s(K+1)..s(K+N)，K = params.length——参数在编译产物中占 s1..sK，
  // 使 parser 分配的 id 与 compileToModule 生成的模块语句 id 一致。
  const stmtIdBase = params.length
  let stmtIdx = 0
  for (const stmt of statements) {
    const sN = asStmtId(`s${stmtIdBase + (++stmtIdx)}`)
    stmt.id = sN
    stmt.refs = collectStatementRefs(stmt)
  }
  const sourceLines = lineOffset ? statementLines.map((l) => l - lineOffset) : statementLines

  // ── 4. terminal shapes ──
  // Phase 3：终端判定移入执行收尾（runtime.collectResult），parser 不再计算。
  // 显式 return [...] 的 terminalShapes 优先；否则运行期从 result.outputs 过滤。
  const finalTerminalShapes = terminalShapes

  // ── 5. 构建 ScriptIR ──
  const script: ScriptIR = {
    params,
    statements,
    meta,
    terminalShapes: finalTerminalShapes,
  }

  return { script, varToId, statementLines: sourceLines }
}

// ── 字面量解析（仅允许字面量，不允许标识符/调用） ──

function parseLiteralOnly(node: ASTNode, line: number): JsonValue {
  switch (node.type) {
    case 'Literal':
      return node.value
    case 'ArrayExpression':
      return node.elements.map((el: ASTNode) => parseLiteralOnly(el, line))
    case 'ObjectExpression': {
      const obj: Record<string, JsonValue> = {}
      for (const prop of node.properties) {
        const key = prop.key?.type === 'Identifier' ? prop.key.name
          : prop.key?.type === 'Literal' ? String(prop.key.value)
          : null
        if (!key) throw new ParseError('invalid object key in param literal', line)
        obj[key] = parseLiteralOnly(prop.value, line)
      }
      return obj
    }
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument?.type === 'Literal') {
        return -node.argument.value
      }
      throw new ParseError(`unsupported unary in param literal`, line)
    default:
      throw new ParseError(`param value must be a literal (number/string/boolean/null/array/object), got ${node.type}`, line)
  }
}

// ── 版本迁移 ──

export function getApiVersion(code: string): number {
  const match = code.match(/^\/\/\s*apiVersion:\s*(\d+)/m)
  return match ? parseInt(match[1], 10) : 1
}
