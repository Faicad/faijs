/**
 * gen-symbol-table — 生成标准库符号表（keep-syntax 设计 P1 后的精简形态）
 *
 * keep-syntax P1 删除了 readonly 标注提取（保留语义改由 keep 声明表达，
 * 见 docs/plans/2026-08-28-keep-syntax-design.md §2.5/§4.1）。
 * 符号表现只承载一个职责：check() 符号检查判定 callee 是否存在
 * （"函数不存在"诊断），因此必须覆盖 cad 命名空间全部函数。
 *
 * P23（§4.2 ②，B1 三源一致）单一来源：
 *   ① faijs 特有 op ← src/api/api-namespace.ts 的 createApiNamespace() 字面量；
 *   ② 生成脚本面 op ← src/api/generated/script-face-manifest.ts（由
 *     gen-l3-surface.ts 依据 arg-spec 的 `scriptFace: true` 条目生成）。
 * 两份并集 = cad 命名空间运行时键集（api-namespace 展开的是同一份 scriptFaceOps）。
 * 先跑 `npx tsx packages/core/scripts/gen-l3-surface.ts`，再跑本脚本。
 *
 * 产物：src/lang/symbol-table.generated.ts（生成文件，禁手改）
 *
 * 运行：npx tsx packages/core/scripts/gen-symbol-table.ts
 */

import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { SCRIPT_FACE_OPS } from '../src/api/generated/script-face-manifest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const INTERNAL_STDLIB_FILE = path.resolve(__dirname, '..', 'src', 'api', 'api-namespace.ts')
// 输出为 .generated.ts 而非 .json（实施文档 §6.5）：ESM 下 JSON import 需要
// import attribute（"type: json"），在 vite/vitest 的 Node ESM 消费方会报错。
const OUTPUT = path.resolve(__dirname, '..', 'src', 'lang', 'symbol-table.generated.ts')

type SymbolTable = Record<string, Record<string, never>>

/**
 * 从 api-namespace.ts 的 createApiNamespace() 返回对象字面量提取 cad 命名空间函数名。
 * 符号表只收录这些函数（每个记空对象条目）——check() 符号检查据此判定
 * "函数不存在"（设计文档 §4.9），必须覆盖全部 cad 函数。
 */
export function discoverCadNamespaceFunctions(): string[] {
  const source = fs.readFileSync(INTERNAL_STDLIB_FILE, 'utf-8')
  const sf = ts.createSourceFile(INTERNAL_STDLIB_FILE, source, ts.ScriptTarget.ES2022, true)
  const names: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || stmt.name?.text !== 'createApiNamespace') continue
    // 找 return { ... } 对象字面量（可能带 `as unknown as StdlibNamespace` 断言）
    const unwrapObject = (expr: ts.Expression): ts.ObjectLiteralExpression | undefined => {
      let cur: ts.Expression | undefined = expr
      while (cur) {
        if (ts.isObjectLiteralExpression(cur)) return cur
        if (ts.isAsExpression(cur)) {
          cur = cur.expression
          continue
        }
        return undefined
      }
      return undefined
    }
    const visit = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression) {
        const obj = unwrapObject(node.expression)
        if (obj) {
          for (const prop of obj.properties) {
            // 简写属性（{ box, sphere }）与完整属性（{ key: value }）都要收
            const key = ts.isShorthandPropertyAssignment(prop)
              ? prop.name.text
              : ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)
                ? prop.name.text
                : undefined
            // contractVersion 是命名空间元数据键，不是可调用 callee——符号表不收
            if (key !== undefined && key !== 'contractVersion') names.push(key)
          }
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(stmt)
    break
  }
  return names
}

// ── 主入口 ──

function main(): void {
  // P23（B1 三源一致）：faijs 特有 op（api-namespace 字面量）∪ 生成脚本面 op
  //（script-face-manifest）= cad 命名空间运行时键集。
  const cadFunctions = [
    ...discoverCadNamespaceFunctions(),
    ...SCRIPT_FACE_OPS.map((op) => op.name),
  ]
  const seen = new Set<string>()
  for (const name of cadFunctions) {
    if (seen.has(name)) throw new Error(`[gen-symbol-table] cad 面重名符号: ${name}`)
    seen.add(name)
  }

  // 生成 .generated.ts：import 无 JSON attribute 需求，vite/vitest/node ESM 均可用
  const table: SymbolTable = {}
  for (const name of cadFunctions) table[name] = {}

  const lines: string[] = []
  lines.push(`/**`)
  lines.push(` * symbol-table 生成文件 — 禁手改。`)
  lines.push(` * 由 scripts/gen-symbol-table.ts 从 api-namespace 的 cad 命名空间生成（键存在性）。`)
  lines.push(` * keep-syntax P1 后符号表只承载 check() 符号检查（"函数不存在"判定）；`)
  lines.push(` * 保留语义由 keep 声明表达，不再有 readonly 标注。`)
  lines.push(` */`)
  lines.push(`export default ${JSON.stringify(table, null, 2)}`)
  lines.push(``)
  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf-8')

  console.log(`[gen-symbol-table] Written ${cadFunctions.length} entries to ${path.relative(process.cwd(), OUTPUT)}`)
}

// Only run main() when executed directly (not when imported by tests)
const directRun = fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')
if (directRun) {
  main()
}
