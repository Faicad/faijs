/**
 * Fix bare numbers in vec3 arrays for dimensioned params.
 *
 * Handles patterns like:
 * - { offset: [10, 0, 0] } → { offset: [10 * MM, 0, 0] }
 * - translate(p, [10, 0, 0]) → translate(p, [10 * MM, 0, 0])
 *
 * Only fixes vec3 params that are declared as 'length' in paramDims:
 * offset, center, normal, point, origin, pivot
 *
 * Also fixes remaining object-form bare numbers that were missed by the
 * previous script (e.g. params with different naming patterns).
 */
const fs = require('fs')
const path = require('path')

// Vec3 params declared as 'length' dimension
const VEC3_LENGTH_PARAMS = [
  'offset', 'center', 'at', 'origin', 'point', 'pivot', 'normal',
]

// Vec3 params declared as 'angle' dimension
const VEC3_ANGLE_PARAMS = [
  'angles',
]

// Additional length params that might have been missed
const EXTRA_LENGTH_PARAMS = [
  'majorRadius', 'minorRadius', 'r1', 'r2', 'r',
  'h', 'w', 'd', 'l', 't', 'r1',
  'filletRadius', 'chamferDistance',
  'dx', 'dy', 'dz',
  'safeDistance',
]

function fixVec3Arrays(content) {
  let changed = false

  for (const param of VEC3_LENGTH_PARAMS) {
    // Pattern: param: [NUM, ...] → param: [NUM * MM, ...]
    // Only fix the first element if it's a bare number (vec3 check uses first element)
    // Actually, all elements need * MM since checkDim checks each element

    // Match: param: [number, ...] but not param: [number * MM
    const regex = new RegExp(`(\\b${param}\\s*:\\s*\\[)([^\\]]+)(\\])`, 'g')
    content = content.replace(regex, (match, prefix, inner, suffix) => {
      // Fix each bare number in the array
      const newInner = inner.replace(/(\d+(?:\.\d+)?)(?!\s*\*\s*(?:MM|DEGREE))/g, (numStr) => {
        changed = true
        return `${numStr} * MM`
      })
      return prefix + newInner + suffix
    })
  }

  for (const param of VEC3_ANGLE_PARAMS) {
    const regex = new RegExp(`(\\b${param}\\s*:\\s*\\[)([^\\]]+)(\\])`, 'g')
    content = content.replace(regex, (match, prefix, inner, suffix) => {
      const newInner = inner.replace(/(\d+(?:\.\d+)?)(?!\s*\*\s*(?:MM|DEGREE))/g, (numStr) => {
        changed = true
        return `${numStr} * DEGREE`
      })
      return prefix + newInner + suffix
    })
  }

  return { content, changed }
}

// Also fix positional vec3 for translate: translate(p, 10, 0, 0) → translate(p, 10 * MM, 0, 0)
function fixPositionalVec3(content) {
  let changed = false

  // translate(p, NUM, NUM, NUM) - shapeArity=1, vec3Keys=['offset']
  // Pattern: cad.translate(varName, NUM, NUM, NUM)
  const regex = /cad\.translate\(\s*(\w+)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/g
  content = content.replace(regex, (match, varName, n1, n2, n3) => {
    changed = true
    return `cad.translate(${varName}, ${n1} * MM, ${n2} * MM, ${n3} * MM`
  })

  // Also handle translate(p, [NUM, NUM, NUM])
  const regex2 = /cad\.translate\(\s*(\w+)\s*,\s*\[([^\]]+)\]/g
  content = content.replace(regex2, (match, varName, inner) => {
    const newInner = inner.replace(/(\d+(?:\.\d+)?)(?!\s*\*\s*(?:MM|DEGREE))/g, (numStr) => {
      changed = true
      return `${numStr} * MM`
    })
    return `cad.translate(${varName}, [${newInner}]`
  })

  return { content, changed }
}

// Fix remaining object-form length params
function fixExtraObjectForm(content) {
  let changed = false
  for (const param of EXTRA_LENGTH_PARAMS) {
    const regex = new RegExp(`(\\b${param}\\s*:\\s*)(\\d+(?:\\.\\d+)?)(\\s*[,}\\n])`, 'g')
    content = content.replace(regex, (match, prefix, num, suffix) => {
      changed = true
      return `${prefix}${num} * MM${suffix}`
    })
  }
  return { content, changed }
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let changed = false

  if (!content.includes('cad.')) return false

  let result

  // Fix vec3 arrays in object form
  result = fixVec3Arrays(content)
  if (result.changed) { content = result.content; changed = true }

  // Fix positional vec3
  result = fixPositionalVec3(content)
  if (result.changed) { content = result.content; changed = true }

  // Fix extra object-form params
  result = fixExtraObjectForm(content)
  if (result.changed) { content = result.content; changed = true }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`Fixed: ${filePath}`)
  }
  return changed
}

// Walk files
function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, results)
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.fai.js')) {
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
