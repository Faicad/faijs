/**
 * parser — 文本 → PartScript（合法 JS 子集，设计文档 §2）
 *
 * 执行模型：`.faijs` 文本先用 acorn 解析（合法性证明 J-1），再 walk AST 还原为 PartScript。
 * 绝不 eval / new Function / import() 真执行。
 *
 * 支持的语法（合法 JS 子集）：
 * - `// apiVersion: N` — 版本声明（可选，默认 1）
 * - `export default async (cad) => { ... }` — 唯一合法容器
 * - `const <name> = <literal>` → ParamDef（参数声明，右侧仅字面量）
 * - `const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { ...args })` → CadStatement
 * - `cad.union/subtract/intersect(inputVar, inputVar)` → boolean op
 * - `cad.faceCenter(var)` / `cad.faceNormal(var)` / `cad.bboxCenter(var)` / ... → GeomRef
 * - `return { shape: part<N>_v<M>, name, color, metalness, roughness }` → PartScript.meta
 *
 * 禁止（acorn 抛错或 AST walk 拒绝即 ParseError）：
 * - `param` / `with` 关键字、对象字面量用 `=`
 * - 循环 / 条件 / IIFE / try-catch / 模板字符串
 * - 多 default export、函数定义（除顶层箭头外）
 * - eval / new Function / 动态 import()
 */

import { parse as acornParse } from 'acorn'
import type {
  Arg,
  AssetRef,
  CadStatement,
  GeomRef,
  JsonValue,
  ParamDef,
  ParamRef,
  PartScript,
  PartScriptMeta,
  TerminalShape,
  Vec3,
} from './types'
import { getOpReturnType } from './args-schema'
import { allocateStatementId } from './allocate-id'
import {
  asStmtId, asPartName, asGroupName,
  type StmtId, type PartName,
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

const BOOLEAN_OP_NAMES = new Set(['union', 'subtract', 'intersect'])
const GEOMREF_FEATURES = new Set(['bboxCenter', 'bboxMin', 'bboxMax', 'faceCenter', 'faceNormal'])
const ASSET_FEATURES = new Set(['asset'])

// ── AST 值解析 ──

/** 解析字面量 / 数组 / 对象 / ParamRef / GeomRef */
function parseValueExpr(
  node: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
  line: number,
): Arg {
  if (!node) throw new ParseError('missing value expression', line)

  switch (node.type) {
    case 'Literal':
      return node.value

    case 'Identifier': {
      // 裸标识符 → ParamRef（必须是已声明的参数名）
      const name = node.name
      if (paramNames.has(name)) {
        const ref: ParamRef = { $param: name }
        return ref
      }
      throw new ParseError(`unknown identifier "${name}" in args value (not a declared param)`, line)
    }

    case 'ArrayExpression': {
      return node.elements.map((el: ASTNode) => parseValueExpr(el, paramNames, varToId, line))
    }

    case 'ObjectExpression': {
      const obj: Record<string, Arg> = {}
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
            obj[key] = { $param: key } as ParamRef
          } else {
            throw new ParseError(`unknown shorthand identifier "${key}" (not a declared param)`, line)
          }
        } else {
          obj[key] = parseValueExpr(prop.value, paramNames, varToId, line)
        }
      }
      return obj as Arg
    }

    case 'CallExpression': {
      // cad.faceCenter(part0_v0) / cad.faceCenter(part0_v0, [1,2,3]) → GeomRef
      const callee = node.callee
      if (
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'cad' &&
        callee.property?.type === 'Identifier'
      ) {
        const feature = callee.property.name
        if (GEOMREF_FEATURES.has(feature)) {
          const args = node.arguments
          if (args.length < 1 || args[0].type !== 'Identifier') {
            throw new ParseError(`cad.${feature}() requires a variable name as first argument`, line)
          }
          const varName = args[0].name
          const of = varToId.get(varName)
          if (!of) {
            throw new ParseError(`unknown variable "${varName}" in cad.${feature}()`, line)
          }
const ref: GeomRef = { $geom: { of, feature } }
// 可选第二参数：anchor point [x, y, z]
if (args.length >= 2) {
const anchorArr = parseValueExpr(args[1], paramNames, varToId, line)
if (Array.isArray(anchorArr) && anchorArr.length === 3) {
ref.$geom.anchor = { point: anchorArr as Vec3 }
}
}
// P5-2: 可选第三参数：faceOrdinal（拓扑面序号）
if (args.length >= 3 && args[2].type === 'Literal') {
ref.$geom.faceOrdinal = args[2].value as number
}
return ref
        }
        // cad.asset('key') → AssetRef
        if (ASSET_FEATURES.has(feature)) {
          const args = node.arguments
          if (args.length !== 1 || args[0].type !== 'Literal') {
            throw new ParseError(`cad.asset() requires a single string literal argument`, line)
          }
          const ref: AssetRef = { $asset: args[0].value as string }
          return ref
        }
      }
      throw new ParseError(`unsupported call expression in args value`, line)
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

// ── CadStatement 解析 ──

interface ParsedStatement {
  stmt: CadStatement
  varName: string
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

  // 判断是否为 boolean op（union/subtract/intersect）
  let op: string
  let args: Record<string, Arg> = {}
  const inputs: PartName[] = []

  if (BOOLEAN_OP_NAMES.has(opName)) {
    // boolean op: cad.union(partA, partB) → op='boolean', args.operation=opName, inputs=[...]
    op = 'boolean'
    args = { operation: opName }
    for (const argNode of init.arguments) {
      if (argNode.type !== 'Identifier') {
        throw new ParseError(`boolean op arguments must be variable names`, getLine(argNode))
      }
      const inputId = varToId.get(argNode.name)
      if (!inputId) {
        throw new ParseError(`unknown variable "${argNode.name}" in boolean inputs`, getLine(argNode))
      }
      inputs.push(inputId)
    }
  } else {
    // 普通 op: cad.op(inputVar?, { args })
    op = opName
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
          args = parsed as Record<string, Arg>
        } else {
          throw new ParseError('args must be an object', line)
        }
      } else {
        throw new ParseError(`unexpected argument type: ${argNode.type}`, getLine(argNode))
      }
    }
  }

  // P4-1: load op 收敛 — 旧 op 名映射为统一 'load' op
  if (op === 'loadFile' || op === 'loadUrl' || op === 'loadByKey') {
    op = 'load'
  }
  // 旧 load op 的 fileRef → key（向后兼容旧文本）
  if (op === 'load' && args.fileRef !== undefined && args.key === undefined) {
    args.key = args.fileRef
    delete args.fileRef
  }

  // 语句 id = 变量名（partN_vM 体系，设计文档 §3）
  const id = asStmtId(varName)

  const rt = getOpReturnType(op)
  const stmt: CadStatement = {
    id, op, args, inputs,
    hasAssignment: true,
    returnType: rt,
  }

  return { stmt, varName }
}

// ── split 解构解析 ──

interface ParsedSplitDestructuring {
  /** 语句列表（split 本身 + 两个输出的变量注册） */
  stmt: CadStatement
  /** front 输出的变量名 */
  frontVarName: string
  /** back 输出的变量名 */
  backVarName: string
}

/**
 * 解析 `const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v2, { ... })`。
 *
 * split 是唯一允许多输出解构的 op。产出两个不同模型（partN/partM），
 * 各自版本从 _v0 起算。
 */
function parseSplitDestructuring(
  declNode: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
): ParsedSplitDestructuring {
  const line = getLine(declNode)

  // id 必须是 ObjectPattern
  if (declNode.id?.type !== 'ObjectPattern') {
    throw new ParseError('expected object pattern for split destructuring', line)
  }

  // 必须恰好两个属性: front 和 back
  const props = declNode.id.properties
  if (props.length !== 2) {
    throw new ParseError(`split destructuring must have exactly 2 properties (front, back), got ${props.length}`, line)
  }

  let frontVarName: string | null = null
  let backVarName: string | null = null

  for (const prop of props) {
    if (prop.type !== 'Property' || prop.key?.type !== 'Identifier') {
      throw new ParseError('split destructuring properties must be identifiers', line)
    }
    const keyName = prop.key.name
    if (prop.value?.type !== 'Identifier') {
      throw new ParseError(`split destructuring value for "${keyName}" must be an identifier`, line)
    }
    if (keyName === 'front') {
      frontVarName = prop.value.name
    } else if (keyName === 'back') {
      backVarName = prop.value.name
    } else {
      throw new ParseError(`split destructuring only allows "front" and "back" keys, got "${keyName}"`, line)
    }
  }

  if (!frontVarName || !backVarName) {
    throw new ParseError('split destructuring must have both "front" and "back" keys', line)
  }

  // 提取 init（必须包在 AwaitExpression 里）
  let init = declNode.init
  if (init?.type === 'AwaitExpression') {
    init = init.argument
  }
  if (init?.type !== 'CallExpression') {
    throw new ParseError(`expected cad.split(...) call in destructuring, got ${init?.type ?? 'null'}`, line)
  }

  // callee 必须是 cad.split
  const callee = init.callee
  if (
    callee?.type !== 'MemberExpression' ||
    callee.object?.type !== 'Identifier' ||
    callee.object.name !== 'cad' ||
    callee.property?.type !== 'Identifier' ||
    callee.property.name !== 'split'
  ) {
    throw new ParseError('destructuring is only allowed for cad.split(...)', line)
  }

  const args: Record<string, Arg> = {}
  const inputs: PartName[] = []

  for (const argNode of init.arguments) {
    if (argNode.type === 'Identifier') {
      const inputId = varToId.get(argNode.name)
      if (!inputId) {
        throw new ParseError(`unknown variable "${argNode.name}" in split inputs`, getLine(argNode))
      }
      inputs.push(inputId)
    } else if (argNode.type === 'ObjectExpression') {
      const parsed = parseValueExpr(argNode, paramNames, varToId, line)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(args, parsed as Record<string, Arg>)
      } else {
        throw new ParseError('split args must be an object', line)
      }
    } else {
      throw new ParseError(`unexpected argument type in split: ${argNode.type}`, getLine(argNode))
    }
  }

  // split 语句的 id = front 变量名（约定：第一个输出）
  const id: StmtId = asStmtId(frontVarName)
  // outputs 包含两个输出 PartName
  const outputs: PartName[] = [asPartName(frontVarName), asPartName(backVarName)]

  const stmt: CadStatement = {
    id, op: 'split', args, inputs, outputs,
    hasAssignment: true,
    returnType: getOpReturnType('split'),
  }

  return { stmt, frontVarName, backVarName }
}

// ── meta 解析 ──

/**
 * 解析 return 语句，提取 terminal shape(s) 和 meta。
 *
 * 支持三种形式：
 * - `return part0_vN`（裸标识符）→ 单终端，无 meta
 * - `return { shape: part0_vN, name, color, ... }`（单终端 + meta）
 * - `return [ { shape: part1_v1, name, ... }, { shape: part2_v0, name, ... } ]`（多终端）
 */
function parseReturnStatement(
  node: ASTNode,
  varToId: Map<string, PartName>,
): { terminalShapeId: StmtId | null; meta: PartScriptMeta | undefined; terminalShapes: TerminalShape[] | undefined } {
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
    return { terminalShapeId: asStmtId(ref), meta: undefined, terminalShapes: undefined }
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
): { id: StmtId | null; meta: PartScriptMeta | undefined } {
  let id: StmtId | null = null
  const meta: PartScriptMeta = {}

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
        id = asStmtId(ref)
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

// ── 主解析函数 ──

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ParseOptions {
  // 保留类型空位，未来可扩展（如 apiVersion 等）
}

export interface ParseResult {
  script: PartScript
  /** 语句 id → 变量名映射（新格式下为恒等映射） */
  varToId: Map<string, string>
}

/**
 * 解析合法 JS 子集文本为 PartScript。
 *
 * 步骤：
 * 1. acorn.parse — 合法性闸门（J-1），抛 SyntaxError 即文本非法
 * 2. AST walk — 只接受允许的节点形状，遇违规即 ParseError
 * 3. 构建 PartScript
 *
 * @throws ParseError — 含行号
 */
export function parseScript(code: string, _options?: ParseOptions): ParseResult {

  // ── 0. 扁平代码检测与封装 ──
  // 如果代码不含 `export default`，则自动封装为合法容器
  let parseCode = code
  if (!code.includes('export default')) {
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
  const statements: CadStatement[] = []
  const paramNames = new Set<string>()
  const varToId = new Map<string, PartName>()
  const assemblyVars = new Set<string>()
  let meta: PartScriptMeta | undefined
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

        // split 解构：const { front: part1_v0, back: part2_v0 } = await cad.split(...)
        if (decl.id?.type === 'ObjectPattern') {
          if (stmtNode.kind !== 'const') {
            throw new ParseError('split destructuring requires const', line)
          }
          const { stmt, frontVarName, backVarName } = parseSplitDestructuring(decl, paramNames, varToId)
          statements.push(stmt)
          // 注册两个输出变量名 → 输出 PartName
          varToId.set(frontVarName, asPartName(frontVarName))
          varToId.set(backVarName, asPartName(backVarName))
          break
        }

        // 判断是参数还是语句
        let init = decl.init
        const isAwait = init?.type === 'AwaitExpression'
        if (isAwait) init = init.argument

        // ── E15.1: const/let assem1 = cad.assembly({...}) ──
        if (
          (stmtNode.kind === 'const' || stmtNode.kind === 'let') &&
          init?.type === 'CallExpression' &&
          init.callee?.type === 'MemberExpression' &&
          init.callee.object?.type === 'Identifier' &&
          init.callee.object.name === 'cad' &&
          init.callee.property?.type === 'Identifier' &&
          (init.callee.property.name === 'group' ||
           init.callee.property.name === 'assembly')
        ) {
          if (decl.id?.type !== 'Identifier') {
            throw new ParseError('assembly/group must have identifier name', line)
          }
          const varName = decl.id.name
          const opName = init.callee.property.name
          const args: Record<string, Arg> = {}
          for (const argNode of init.arguments) {
            if (argNode.type === 'ObjectExpression') {
              const parsed = parseValueExpr(argNode, paramNames, varToId, line)
              if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                Object.assign(args, parsed as Record<string, Arg>)
              } else {
                throw new ParseError(`${opName} args must be an object`, line)
              }
            } else {
              throw new ParseError(`unexpected argument type in ${opName}: ${argNode.type}`, line)
            }
          }
          const grpId = allocateStatementId(opName, [], { statements })
          const stmt: CadStatement = {
            id: grpId,
            op: opName,
            args,
            inputs: [],
            hasAssignment: true,
            returnType: getOpReturnType(opName),
          }
          statements.push(stmt)
          // group/assembly 变量名 → 组名（GroupName ⊆ PartName）
          if (opName === 'assembly') {
            assemblyVars.add(varName)
          }
          varToId.set(varName, asGroupName(grpId))
          break
        }

        // let 不允许用于其他场景（const 已覆盖 group/assembly，let 也已覆盖）
        if (stmtNode.kind === 'let') {
          throw new ParseError("'let' is only allowed for cad.assembly()/cad.group() declarations", line)
        }

        if (
          init?.type === 'CallExpression' &&
          init.callee?.type === 'MemberExpression' &&
          init.callee.object?.type === 'Identifier' &&
          init.callee.object.name === 'cad'
        ) {
          // 语句：const partN_vM = [await] cad.op(...)
          const { stmt, varName } = parseCadStatement(decl, paramNames, varToId)
          // 赋值校验：void 不准赋值
          if (stmt.returnType === 'void') {
            throw new ParseError(
              `cad.${stmt.op}() is void, cannot assign to a variable`, line,
            )
          }
          statements.push(stmt)
          // 语句输出名 = 变量名（PartName）
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
          // 解析字面量值（不允许 ParamRef / GeomRef / 标识符）
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
        // ── E15.1: 装配链式调用成员方法 ──
        // assem1.add_constraint({ ... }) / assem1.do_assemble()
        const expr = stmtNode.expression
          if (
            expr?.type === 'CallExpression' &&
            expr.callee?.type === 'MemberExpression' &&
            expr.callee.object?.type === 'Identifier' &&
            expr.callee.property?.type === 'Identifier' &&
            (expr.callee.property.name === 'add_constraint' || expr.callee.property.name === 'do_assemble')
          ) {
            const targetVar = expr.callee.object.name
            const methodName = expr.callee.property.name
            // 验证 targetVar 是已声明的装配变量
            if (!varToId.has(targetVar) && !assemblyVars.has(targetVar)) {
              throw new ParseError(`unknown assembly variable "${targetVar}" in .${methodName}() call`, line)
            }
            const args: Record<string, Arg> = {}
            for (const argNode of expr.arguments) {
              if (argNode.type === 'ObjectExpression') {
                const parsed = parseValueExpr(argNode, paramNames, varToId, line)
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                  Object.assign(args, parsed as Record<string, Arg>)
                } else {
                  throw new ParseError(`${methodName} args must be an object`, line)
                }
              } else if (argNode.type !== 'undefined') {
                throw new ParseError(`unexpected argument type in ${methodName}: ${argNode.type}`, line)
              }
            }
            const memberStmt: CadStatement = {
              id: allocateStatementId(methodName, [], { statements }),
              op: methodName,
              args,
              inputs: [],
              assemblyTarget: targetVar,
              hasAssignment: false,
              returnType: getOpReturnType(methodName),
            }
            statements.push(memberStmt)
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

  // ── 4. 自动推导 terminal shapes ──
  // 不被任何其他语句引用的输出即终端
  const derivedTerminals = computeTerminalShapes(statements)

  // 如果 return 语句提供了 terminalShapes/meta，则优先使用 return 的信息
  // 否则使用自动推导的终端
  const finalTerminalShapes = terminalShapes ?? derivedTerminals

  // ── 5. 构建 PartScript ──
  const script: PartScript = {
    params,
    statements,
    meta,
    terminalShapes: finalTerminalShapes,
  }

  return { script, varToId }
}

// ── terminal shapes 自动推导 ──

/**
 * 从语句列表自动推导 terminal shapes。
 * 规则：不被任何其他语句引用的输出即终端。
 *
 * 终端计算基于 hasAssignment 和 returnType：
 * - 有赋值（hasAssignment=true）且 returnType 为 new_shape 的语句才参与终端计算
 * - void / same_shape / scalar 不产出几何，不作为终端
 * - split 解构的 outputs 中不被引用的 → 终端
 */
export function computeTerminalShapes(statements: CadStatement[]): TerminalShape[] | undefined {
  // 收集所有被引用的 id（inputs + group/assembly/assemble 的 members）
  const referencedIds = new Set<string>()
  for (const stmt of statements) {
    for (const inputId of stmt.inputs) {
      referencedIds.add(inputId)
    }
    // group/assembly 的 args.members 引用了其他语句的 id
    if (stmt.op === 'group' || stmt.op === 'assembly') {
      const members = stmt.args?.members
      if (Array.isArray(members)) {
        for (const m of members) {
          if (typeof m === 'string') referencedIds.add(m)
        }
      }
    }
  }

  // 收集所有输出 id（语句 id + split outputs），跳过无赋值/非 new_shape 语句
  // TerminalShape.id 语义 = StmtId（FAM-STMT-ID）；split 的输出名按同一命名空间信任点 asStmtId 收口。
  const outputIds: StmtId[] = []
  for (const stmt of statements) {
    const rt = stmt.returnType ?? 'new_shape'
    // 只有有赋值且返回 new_shape 的语句才产出几何终端
    if (!stmt.hasAssignment && rt !== 'new_shape') continue
    if (rt !== 'new_shape') continue
    outputIds.push(stmt.id)
    if (stmt.outputs) {
      for (const outId of stmt.outputs) {
        outputIds.push(asStmtId(outId))
      }
    }
  }

  // 终端 = 不被引用的输出
  const terminals: TerminalShape[] = []
  const seen = new Set<string>()
  for (const id of outputIds) {
    if (referencedIds.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    terminals.push({ id })
  }

  // 如果只有一个终端，不返回数组（等价为单终端，meta 在 return 中处理）
  if (terminals.length <= 1) return undefined
  return terminals
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
