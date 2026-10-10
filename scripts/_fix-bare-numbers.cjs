/**
 * Fix bare numbers in .fai.js fixtures by wrapping dimensioned params with * MM.
 *
 * This is a one-time migration script. It reads .fai.js files, finds bare numbers
 * in object-form op calls for known dimensioned params, and wraps them as `n * MM`.
 */
const fs = require('fs')
const path = require('path')

// Known dimensioned params (length) that need * MM suffix
const LENGTH_PARAMS = new Set([
  'width', 'depth', 'height', 'radius', 'diameter', 'length', 'distance',
  'thickness', 'depth', 'offset', 'pitch', 'height', 'size',
  'x', 'y', 'z', 'r1', 'r2', 'r', 'h', 'w', 'd', 'l',
  'spacing', 'spacingX', 'spacingY', 'xSpacing', 'ySpacing',
  'grooveDepth', 'grooveWidth', 'dowelDiameter', 'dowelHeight',
  'tenonSideLength', 'tenonHeight',
])

const ANGLE_PARAMS = new Set([
  'angle', 'angleDegrees', 'startAngle', 'endAngle', 'inPlaneAngle',
  'grooveFlapsAngle',
])

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let changed = false

  // Fix object-form params: { radius: 10 } → { radius: 10 * MM }
  // Also fix: { radius:10 } (no space)
  for (const param of LENGTH_PARAMS) {
    // Match `param: number` or `param: number` (not already followed by * MM)
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

  // Fix vec3 arrays that are bare: [5,0,0] → [5 * MM, 0, 0] (only for known length vec3 params)
  // This is trickier - skip for now, handle manually

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`Fixed: ${filePath}`)
  }
  return changed
}

// Walk .fai.js files
function walk(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walk(full))
    } else if (entry.name.endsWith('.fai.js')) {
      results.push(full)
    }
  }
  return results
}

const testDir = path.join(__dirname, '..', 'packages', 'tests', 'faijs')
const files = walk(testDir)
let fixed = 0
for (const f of files) {
  if (fixFile(f)) fixed++
}
console.log(`\nFixed ${fixed} files`)
