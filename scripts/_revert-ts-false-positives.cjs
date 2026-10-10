/**
 * Revert false positives: * MM and * DEGREE that were inserted into
 * TypeScript code (outside of template literals / string literals).
 *
 * The migration scripts couldn't distinguish between:
 * 1. .fai.js code inside template literals (should have * MM)
 * 2. TypeScript object literals (should NOT have * MM)
 *
 * This script scans .ts files and reverts * MM / * DEGREE that appear
 * outside of template literals (backtick strings) and regular string literals.
 */
const fs = require('fs')
const path = require('path')

function revertFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let changed = false
  let result = ''
  let i = 0
  let inTemplateString = false
  let inStringSingle = false
  let inStringDouble = false
  let inLineComment = false
  let inBlockComment = false

  while (i < content.length) {
    const ch = content[i]
    const next = content[i + 1]

    // Handle comments
    if (!inTemplateString && !inStringSingle && !inStringDouble) {
      if (inLineComment) {
        result += ch
        if (ch === '\n') inLineComment = false
        i++
        continue
      }
      if (inBlockComment) {
        result += ch
        if (ch === '*' && next === '/') {
          result += next
          i += 2
          inBlockComment = false
          continue
        }
        i++
        continue
      }
      if (ch === '/' && next === '/') {
        inLineComment = true
        result += ch
        i++
        continue
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true
        result += ch
        i++
        continue
      }
    }

    // Handle string literals
    if (!inLineComment && !inBlockComment) {
      if (inTemplateString) {
        result += ch
        if (ch === '`' && content[i - 1] !== '\\') {
          inTemplateString = false
        }
        i++
        continue
      }
      if (inStringSingle) {
        result += ch
        if (ch === "'" && content[i - 1] !== '\\') {
          inStringSingle = false
        }
        i++
        continue
      }
      if (inStringDouble) {
        result += ch
        if (ch === '"' && content[i - 1] !== '\\') {
          inStringDouble = false
        }
        i++
        continue
      }
      if (ch === '`') {
        inTemplateString = true
        result += ch
        i++
        continue
      }
      if (ch === "'") {
        inStringSingle = true
        result += ch
        i++
        continue
      }
      if (ch === '"') {
        inStringDouble = true
        result += ch
        i++
        continue
      }
    }

    // Outside of any string/comment: check for " * MM" or " * DEGREE" patterns
    // and revert them to just the number
    if (!inTemplateString && !inStringSingle && !inStringDouble && !inLineComment && !inBlockComment) {
      // Pattern: <number> * MM or <number> * DEGREE
      // Check backwards in result for a number, then * MM/DEGREE
      const remaining = content.slice(i)
      const mmMatch = remaining.match(/^\s*\*\s*(?:MM|DEGREE)\b/)
      if (mmMatch) {
        // Check if there's a number before this in result
        // Look backwards past whitespace
        let j = result.length - 1
        while (j >= 0 && (result[j] === ' ' || result[j] === '\t')) j--
        // Check for a number ending at j
        let numEnd = j
        while (j >= 0 && /[0-9.]/.test(result[j])) j--
        if (numEnd > j) {
          // There's a number before * MM — revert by removing the * MM part
          changed = true
          i += mmMatch[0].length
          continue
        }
      }
    }

    result += ch
    i++
  }

  if (changed) {
    fs.writeFileSync(filePath, result, 'utf-8')
    console.log(`Reverted: ${filePath}`)
  }
  return changed
}

// Walk .ts files
function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, results)
    } else if (entry.name.endsWith('.ts')) {
      results.push(full)
    }
  }
  return results
}

const dirs = [
  path.join(__dirname, '..', 'packages', 'tests'),
  path.join(__dirname, '..', 'packages', 'core', 'test'),
  path.join(__dirname, '..', 'packages', 'faijs-extra', 'test'),
]

let reverted = 0
for (const dir of dirs) {
  const files = walk(dir)
  for (const f of files) {
    if (revertFile(f)) reverted++
  }
}
console.log(`\nReverted ${reverted} files`)
