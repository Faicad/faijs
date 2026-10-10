/**
 * Fix bare numbers in .ts test files that contain inline .fai.js code strings.
 * Simplified version: only fixes object-form bare numbers.
 * Positional form is handled separately.
 *
 * This is a one-time migration script.
 */
const fs = require('fs')
const path = require('path')

// Known dimensioned params (length) in object form
const LENGTH_PARAMS = [
  'width', 'depth', 'height', 'radius', 'diameter', 'length', 'distance',
  'thickness', 'offset', 'pitch', 'size',
  'spacing', 'spacingX', 'spacingY', 'xSpacing', 'ySpacing',
  'grooveDepth', 'grooveWidth', 'dowelDiameter', 'dowelHeight',
  'tenonSideLength', 'tenonHeight',
  'r1', 'r2', 'radiusBottom', 'radiusTop', 'tubeRadius',
]

const ANGLE_PARAMS = [
  'angle', 'angleDegrees', 'startAngle', 'endAngle', 'inPlaneAngle',
  'grooveFlapsAngle', 'twistAngle',
]

function fixObjectForm(content) {
  let changed = false
  for (const param of LENGTH_PARAMS) {
    // Match `param: number` (not already followed by * MM/DEGREE)
    const regex = new RegExp(`(\\b${param}\\s*:\\s*)(\\d+(?:\\.\\d+)?)(\\s*[,}\\n])`, 'g')
    content = content.replace(regex, (match, prefix, num, suffix) => {
      changed = true
      return `${prefix}${num} * MM${suffix}`
    })
  }
  for (const param of ANGLE_PARAMS) {
    const regex = new RegExp(`(\\b${param}\\s*:\\s*)(\\d+(?:\\.\\d+)?)(\\s*[,}\\n])`, 'g')
    content = content.replace(regex, (match, prefix, num, suffix) => {
      changed = true
      return `${prefix}${num} * DEGREE${suffix}`
    })
  }
  return { content, changed }
}

// Fix positional form for specific ops
function fixPositionalForm(content) {
  let changed = false

  // Pattern: cad.box(NUM, NUM, NUM  (but not cad.box({)
  // We match cad.OP( followed by bare numbers separated by commas
  const ops = {
    'box': 3,       // 3 length params
    'sphere': 1,    // 1 length param
    'cylinder': 2,  // 2 length params
    'cone': 3,      // 3 length params (including 0)
    'torus': 2,     // 2 length params
    'wedge': 3,     // 3 length params
  }

  for (const [opName, maxArgs] of Object.entries(ops)) {
    // Match: cad.opName(NUM) or cad.opName(NUM, NUM) etc.
    // But NOT cad.opName({  or cad.opName(varName
    // The pattern: cad.opName( followed by a digit
    const pattern = new RegExp(`cad\\.${opName}\\((\\d)`, 'g')
    let match
    const positions = []
    while ((match = pattern.exec(content)) !== null) {
      positions.push(match.index)
    }

    // Process from end to start to preserve indices
    for (let i = positions.length - 1; i >= 0; i--) {
      const startPos = positions[i]
      const callStart = startPos + `cad.${opName}(`.length

      // Parse the call to find all positional args until { or )
      let pos = callStart
      let depth = 1
      let argStart = callStart
      const args = []
      let argIdx = 0

      while (pos < content.length && depth > 0) {
        const ch = content[pos]
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') {
          depth--
          if (depth === 0) {
            const argText = content.slice(argStart, pos).trim()
            if (argText) args.push({ start: argStart, end: pos, text: argText, idx: argIdx })
            break
          }
        }
        if (ch === ',' && depth === 1) {
          const argText = content.slice(argStart, pos).trim()
          if (argText) args.push({ start: argStart, end: pos, text: argText, idx: argIdx })
          argIdx++
          argStart = pos + 1
        }
        pos++
      }

      // Fix bare numbers in positional args (only the first maxArgs)
      for (let j = Math.min(args.length, maxArgs) - 1; j >= 0; j--) {
        const arg = args[j]
        const numMatch = arg.text.match(/^(\d+(?:\.\d+)?)$/)
        if (numMatch) {
          const num = numMatch[1]
          const replacement = `${num} * MM`
          content = content.slice(0, arg.start) + replacement + content.slice(arg.end)
          changed = true
        }
      }
    }
  }

  return { content, changed }
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let changed = false

  // Only process files that contain cad. calls
  if (!content.includes('cad.')) return false

  // Apply object form fixes
  let result = fixObjectForm(content)
  if (result.changed) { content = result.content; changed = true }

  // Apply positional form fixes
  result = fixPositionalForm(content)
  if (result.changed) { content = result.content; changed = true }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`Fixed: ${filePath}`)
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

let fixed = 0
for (const dir of dirs) {
  const files = walk(dir)
  for (const f of files) {
    if (fixFile(f)) fixed++
  }
}
console.log(`\nFixed ${fixed} files`)
