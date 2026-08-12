// fix-dynamic-imports.mjs — 修复动态 import 中的 @/ 路径
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('src')

function walk(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...walk(full))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

const replacements = [
  // Dynamic imports with @/ paths
  [/import\('(@\/[^']+)'\)/g, (match, p1) => {
    // Convert @/path to relative path based on file location
    return `import('${p1}')` // We'll handle this differently
  }],
]

// Simpler approach: just find and replace specific patterns
const fixes = [
  [/@\/cad-runtime\/ports/g, '../cad-runtime/ports'],
  [/@\/brep\/text\/fontRegistry/g, '../brep/text/fontRegistry'],
  [/@\/lib\/topology\/types/g, '../topology/types'],
  [/@\/engine\/boolean\/extrude-helpers/g, '../boolean/extrude-helpers'],
  [/@\/engine\/version-store\/FileBlobStore/g, 'BROWSER_ONLY'],
]

let fixed = 0
for (const file of walk(root)) {
  let content = readFileSync(file, 'utf-8')
  const original = content
  
  // Only fix @/ inside import() calls, not in type annotations
  // Actually, let's fix all @/ references in dynamic imports
  content = content.replace(/import\(['"]@\/([^'"]+)['"]\)/g, (match, path) => {
    // Calculate relative path from file to the target
    const relPath = file.substring(root.length).replace(/\\/g, '/')
    const dir = relPath.substring(0, relPath.lastIndexOf('/'))
    const depth = (dir.match(/\//g) || []).length
    const prefix = depth === 0 ? './' : '../'.repeat(depth)
    return `import('${prefix}${path}')`
  })
  
  // Fix type-level import('@/...') expressions (inline type imports)
  content = content.replace(/import\('([^']+)'\)\./g, (match, path) => {
    if (!path.startsWith('@/')) return match
    const relPath = file.substring(root.length).replace(/\\/g, '/')
    const dir = relPath.substring(0, relPath.lastIndexOf('/'))
    const depth = (dir.match(/\//g) || []).length
    const prefix = depth === 0 ? './' : '../'.repeat(depth)
    const converted = `${prefix}${path.substring(2)}`
    return `import('${converted}').`
  })
  
  if (content !== original) {
    writeFileSync(file, content, 'utf-8')
    console.log('Fixed:', file.substring(root.length))
    fixed++
  }
}
console.log(`Done. Fixed ${fixed} files.`)
