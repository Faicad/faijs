/**
 * gen-symbol-table — 从 stdlib TS 签名生成符号表（设计文档 §4.6）
 *
 * 用 TypeScript Compiler API 扫描 src/stdlib/*.ts 的导出函数签名：
 * - 位置形参类型为 ReadonlyShape → readonlyPositions 记下标
 * - options 对象属性类型为 ReadonlyShape / readonly ReadonlyShape[] → readonlyPaths 记属性名
 * - 同一函数的位置形参中同时出现 Shape 与 ReadonlyShape（R5）→ 报错退出
 *
 * 产物：src/lang/symbol-table.json（生成文件，禁手改）
 *
 * 运行：npx tsx scripts/gen-symbol-table.ts
 */

import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const STDLIB_DIR = path.resolve(__dirname, '..', 'src', 'stdlib')
const INTERNAL_STDLIB_FILE = path.resolve(__dirname, '..', 'src', 'cad-runtime', 'internal-stdlib.ts')
const OUTPUT = path.resolve(__dirname, '..', 'src', 'lang', 'symbol-table.json')

interface FunctionSymbol {
  readonlyPositions?: number[]
  readonlyPaths?: string[]
}

type SymbolTable = Record<string, FunctionSymbol>

// ── 文件发现 ──

/** 扫描 src/stdlib/*.ts（排除 *.test.ts、index.ts、schemas.ts、assert.ts、shape.ts） */
function discoverStdlibFiles(): string[] {
  const files = fs.readdirSync(STDLIB_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.endsWith('.test.ts'))
    .filter((f) => f !== 'index.ts')
    .filter((f) => f !== 'schemas.ts')
    .filter((f) => f !== 'assert.ts')
    .filter((f) => f !== 'shape.ts')
    .map((f) => path.join(STDLIB_DIR, f))
  return files
}

/**
 * 从 internal-stdlib.ts 的 createInternalStdlib() 返回对象字面量提取 cad 命名空间函数名。
 * 符号表只收录这些函数（无 readonly 标注的记空对象）——check() 符号检查据此判定
 * "函数不存在"（设计文档 §4.9），必须覆盖全部 cad 函数而非仅 readonly 标注者。
 */
function discoverCadNamespaceFunctions(): string[] {
  const source = fs.readFileSync(INTERNAL_STDLIB_FILE, 'utf-8')
  const sf = ts.createSourceFile(INTERNAL_STDLIB_FILE, source, ts.ScriptTarget.ES2022, true)
  const names: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || stmt.name?.text !== 'createInternalStdlib') continue
    // 找 return { ... } 对象字面量
    const visit = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
        for (const prop of node.expression.properties) {
          // 简写属性（{ box, sphere }）与完整属性（{ key: value }）都要收
          if (ts.isShorthandPropertyAssignment(prop)) {
            names.push(prop.name.text)
          } else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            names.push(prop.name.text)
          }
        }
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(stmt)
    break
  }
  return names
}

// ── 类型名提取 ──

/** 从类型节点获取类型名字符串（如 'ReadonlyShape', 'Shape', 'ExecContext'）。 */
function getTypeName(node: ts.TypeNode | undefined): string {
  if (!node) return ''

  // Identifier: ReadonlyShape, Shape, ExecContext
  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName
    if (ts.isIdentifier(typeName)) return typeName.text
    return ''
  }

  // ArrayType: Shape[]
  if (ts.isArrayTypeNode(node)) {
    return getTypeName(node.elementType) + '[]'
  }

  // TypeOperator: readonly T[]
  if (ts.isTypeOperatorNode(node)) {
    if (node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return getTypeName(node.type)
    }
  }

  return ''
}

/** 检测类型名是否为 ReadonlyShape。 */
function isReadonlyShapeType(typeName: string): boolean {
  return typeName === 'ReadonlyShape' || typeName === 'ReadonlyShape[]'
}

/** 检测类型名是否为 Shape（非 ReadonlyShape）。 */
function isShapeType(typeName: string): boolean {
  return typeName === 'Shape' || typeName === 'Shape[]'
}

/** 检测类型节点是否包含 ReadonlyShape（包括数组形式、ReadonlyArray 形式）。 */
function containsReadonlyShape(node: ts.TypeNode | undefined): boolean {
  if (!node) return false
  const typeName = getTypeName(node)
  if (isReadonlyShapeType(typeName)) return true

  // ArrayType: Shape[]
  if (ts.isArrayTypeNode(node)) {
    return containsReadonlyShape(node.elementType)
  }

  // TypeOperator: readonly T[] (the `readonly` modifier wraps the array type)
  if (ts.isTypeOperatorNode(node)) {
    return containsReadonlyShape(node.type)
  }

  // TypeReference with type arguments: ReadonlyArray<ReadonlyShape>
  if (ts.isTypeReferenceNode(node)) {
    if (node.typeArguments) {
      for (const arg of node.typeArguments) {
        if (containsReadonlyShape(arg)) return true
      }
    }
  }

  return false
}

/** 检测类型名是否为 readonly 数组形式（如 'readonly ReadonlyShape[]'）。 */
function isReadonlyArray(node: ts.TypeNode | undefined): boolean {
  if (!node) return false
  if (ts.isArrayTypeNode(node)) {
    return containsReadonlyShape(node.elementType)
  }
  // ReadonlyArray<ReadonlyShape>
  if (ts.isTypeReferenceNode(node)) {
    const typeName = getTypeName(node)
    if (typeName === 'ReadonlyArray' && node.typeArguments) {
      return node.typeArguments.some((arg) => containsReadonlyShape(arg))
    }
  }
  return false
}

// ── 符号表提取核心 ──

/**
 * 从源文件列表提取符号表。
 * 导出为纯函数供测试 import。
 */
export function extractSymbolTable(sourceFiles: string[]): SymbolTable {
  const program = ts.createProgram(sourceFiles, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: ['node'],
  })

  const checker = program.getTypeChecker()
  const table: SymbolTable = {}

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue
    const filePath = sourceFile.fileName
    const matched = sourceFiles.some((sf) => path.resolve(sf) === path.resolve(filePath))
    if (!matched) continue

    // 遍历顶层语句
    for (const stmt of sourceFile.statements) {
      // FunctionDeclaration
      if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt)) {
        extractFromFunctionDeclaration(stmt, checker, table, sourceFile)
      }
      // VariableStatement with export (arrow functions)
      else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
            extractFromArrowFunction(decl, stmt, checker, table, sourceFile)
          }
        }
      }
    }
  }

  return table
}

function hasExportModifier(node: ts.Statement): boolean {
  if (!ts.canHaveModifiers(node)) return false
  const modifiers = ts.getModifiers(node)
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function extractFromFunctionDeclaration(
  stmt: ts.FunctionDeclaration,
  checker: ts.TypeChecker,
  table: Record<string, FunctionSymbol>,
  sourceFile: ts.SourceFile,
): void {
  const fnName = stmt.name?.text
  if (!fnName) return

  const symbol = extractFromParameters(stmt.parameters, checker, sourceFile)
  if (symbol) table[fnName] = symbol
}

function extractFromArrowFunction(
  decl: ts.VariableDeclaration,
  container: ts.VariableStatement,
  checker: ts.TypeChecker,
  table: Record<string, FunctionSymbol>,
  sourceFile: ts.SourceFile,
): void {
  const name = decl.name
  if (!ts.isIdentifier(name)) return
  const fnName = name.text

  const arrowFn = decl.initializer as ts.ArrowFunction
  const symbol = extractFromParameters(arrowFn.parameters, checker, sourceFile)
  if (symbol) table[fnName] = symbol
}

function extractFromParameters(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): FunctionSymbol | null {
  const readonlyPositions: number[] = []
  const readonlyPaths: string[] = []
  let hasShape = false
  let hasReadonlyShape = false

  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i]
    const typeName = getTypeName(param.type)

    // 跳过 exec 参数
    if (typeName === 'ExecContext' || typeName === 'ExecContextImpl') continue

    // 位置 shape 参数
    if (isReadonlyShapeType(typeName)) {
      readonlyPositions.push(i)
      hasReadonlyShape = true
      continue
    }

    if (isShapeType(typeName)) {
      hasShape = true
      continue
    }

    // Options 对象参数：检查属性类型
    // 直接从 AST 扫描 InterfaceDeclaration（同文件内定义的 interface）
    if (param.type && ts.isTypeReferenceNode(param.type)) {
      const typeNameStr = getTypeName(param.type)
      if (typeNameStr.includes('Params')) {
        // 在同文件内查找 interface 声明
        const interfaceDecl = findInterface(sourceFile, typeNameStr)
        if (interfaceDecl) {
          const allMembers = collectInterfaceMembers(interfaceDecl, sourceFile, new Set([typeNameStr]))
          for (const member of allMembers) {
            if (member.type) {
              // 检查属性类型是否含 ReadonlyShape
              if (containsReadonlyShape(member.type)) {
                readonlyPaths.push(member.name)
              }
            }
          }
        }
      }
    }
  }

  // R5 检测：混合 Shape + ReadonlyShape
  if (hasShape && hasReadonlyShape) {
    throw new Error(
      `[gen-symbol-table] R5 violation: function has mixed Shape and ReadonlyShape parameters. ` +
      `This is disabled (design decision R5). Check the function signature.`,
    )
  }

  if (readonlyPositions.length === 0 && readonlyPaths.length === 0) {
    return null
  }

  const result: FunctionSymbol = {}
  if (readonlyPositions.length > 0) result.readonlyPositions = readonlyPositions
  if (readonlyPaths.length > 0) result.readonlyPaths = readonlyPaths
  return result
}

/** 在源文件中查找指定名称的 InterfaceDeclaration。 */
function findInterface(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration | null {
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
      return stmt
    }
  }
  return null
}

/** 收集 interface 的所有属性（含继承的父接口属性）。 */
function collectInterfaceMembers(
  interfaceDecl: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  visited: Set<string>,
): { name: string; type: ts.TypeNode | undefined }[] {
  const members: { name: string; type: ts.TypeNode | undefined }[] = []

  // 处理继承（heritage clauses: extends GroupParams）
  if (interfaceDecl.heritageClauses) {
    for (const clause of interfaceDecl.heritageClauses) {
      for (const expr of clause.types) {
        const parentName = expr.expression.getText()
        if (visited.has(parentName)) continue
        visited.add(parentName)
        const parentInterface = findInterface(sourceFile, parentName)
        if (parentInterface) {
          members.push(...collectInterfaceMembers(parentInterface, sourceFile, visited))
        }
      }
    }
  }

  // 自身属性
  for (const member of interfaceDecl.members) {
    if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
      members.push({ name: member.name.text, type: member.type })
    }
  }

  return members
}

// ── 主入口 ──

function main(): void {
  const files = discoverStdlibFiles()
  console.log(`[gen-symbol-table] Scanning ${files.length} stdlib files...`)

  const table = extractSymbolTable(files)

  // 符号表覆盖 cad 命名空间全部函数（check() 符号检查判定"函数不存在"需要）：
  // 无 readonly 标注的函数记空对象（= 默认消费语义，derivePartName/consumes 行为不变）。
  const cadFunctions = discoverCadNamespaceFunctions()
  for (const name of cadFunctions) {
    if (!table[name]) table[name] = {}
  }

  const json = JSON.stringify(table, null, 2)
  fs.writeFileSync(OUTPUT, json + '\n', 'utf-8')

  const entries = Object.keys(table).length
  console.log(`[gen-symbol-table] Written ${entries} entries to ${path.relative(process.cwd(), OUTPUT)}`)
  for (const [name, sym] of Object.entries(table)) {
    console.log(`  ${name}: ${JSON.stringify(sym)}`)
  }
}

// Only run main() when executed directly (not when imported by tests)
const directRun = fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')
if (directRun) {
  main()
}
