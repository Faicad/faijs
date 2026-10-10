/**
 * Auto-add paramDims to defineOp calls that are missing it.
 *
 * For each defineOp call without paramDims, this script:
 * 1. Reads the JSDoc above the call for @param annotations with unit hints
 * 2. Reads the mesh/brep function signature for parameter names
 * 3. Infers paramDims based on parameter names and unit hints
 * 4. Inserts paramDims into the defineOp call
 *
 * Heuristic for parameter dims:
 * - Params with (mm) in JSDoc → 'length'
 * - Params with (degree) in JSDoc → 'angle'
 * - Params named width/depth/height/radius/diameter/length/offset/pitch/thickness/distance → 'length'
 * - Params named angle/angleDegrees/startAngle/endAngle → 'angle'
 * - All other numeric params → 'plain'
 * - If no numeric params found → {}
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const repoRoot = path.resolve(__dirname, '..')

const SCAN_DIRS = [
  path.join(repoRoot, 'packages/core/src/api'),
  path.join(repoRoot, 'packages/faijs-extra/src/ops'),
  path.join(repoRoot, 'packages/sketch/src'),
  path.join(repoRoot, 'packages/sheetmetal/src'),
  path.join(repoRoot, 'packages/draw/src'),
  path.join(repoRoot, 'packages/faijs-gears/src'),
  path.join(repoRoot, 'packages/faijs-fasteners/src'),
]

// Length param names (by convention)
const LENGTH_NAMES = new Set([
  'width', 'depth', 'height', 'radius', 'diameter', 'length', 'distance',
  'thickness', 'offset', 'pitch', 'size', 'spacing', 'spacingX', 'spacingY',
  'r', 'r1', 'r2', 'h', 'w', 'd', 'l', 't',
  'majorRadius', 'minorRadius', 'radiusBottom', 'radiusTop', 'tubeRadius',
  'xLength', 'yLength', 'zLength', 'rx', 'ry', 'rz',
  'resolution',  // SDF resolution is in mm
  'textSize', 'depth', 'grooveDepth', 'grooveWidth',
  'dowelDiameter', 'dowelHeight', 'tenonSideLength', 'tenonHeight',
  'safeDistance', 'filletRadius', 'chamferDistance',
  'x', 'y', 'z',  // position coords
  'cx', 'cy', 'cz',  // center coords
  'dx', 'dy', 'dz',  // direction components (could be plain, but safer as length)
  'pivot',  // vec3 point
  'point', 'origin', 'center', 'at', 'normal',  // vec3 params (length)
  'factor',  // scale3d factor — actually plain, but we'll handle per-op
])

const ANGLE_NAMES = new Set([
  'angle', 'angleDegrees', 'startAngle', 'endAngle', 'inPlaneAngle',
  'grooveFlapsAngle', 'twistAngle', 'fullAngle', 'draftAngle',
])

// Params that are definitely plain (dimensionless)
const PLAIN_NAMES = new Set([
  'count', 'countX', 'countY', 'segments', 'segmentsX', 'segmentsY',
  'shapeArity', 'index', 'ordinal', 'face', 'edge', 'edges',
  'mode', 'type', 'kind', 'name', 'text', 'code', 'file',
  'centered', 'boolean', 'bool', 'string', 'id',
  'k', 'n', 'i', 'j', 'layer', 'color', 'material',
  'arrowSize', 'arrowLength',  // these are display params, plain
])

function inferDim(paramName, jsdocHint) {
  // JSDoc hint takes priority
  if (jsdocHint === 'length') return 'length'
  if (jsdocHint === 'angle') return 'angle'
  if (jsdocHint === 'mass') return 'mass'

  // Name-based heuristic
  if (LENGTH_NAMES.has(paramName)) return 'length'
  if (ANGLE_NAMES.has(paramName)) return 'angle'
  if (PLAIN_NAMES.has(paramName)) return 'plain'

  // Default: plain (safer — bare numbers won't be rejected)
  return 'plain'
}

function collectTs(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectTs(full, out)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

function unwrapToObjectLiteral(node) {
  let current = node
  while (current) {
    if (ts.isObjectLiteralExpression(current)) return current
    if (ts.isAsExpression(current)) { current = current.expression; continue }
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AsKeyword) {
      current = current.left; continue
    }
    break
  }
  return null
}

function hasParamDims(objLit) {
  for (const prop of objLit.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'paramDims') return true
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'spec') return true
  }
  return false
}

function extractJSDocParams(sf, callNode) {
  const hints = new Map()
  const text = sf.text
  const pos = callNode.getStart(sf)
  const lineStart = text.lastIndexOf('\n', pos) + 1
  let searchPos = lineStart - 1
  while (searchPos > 0 && /[ \t\r\n]/.test(text[searchPos])) searchPos--
  if (searchPos < 1 || text.slice(searchPos - 1, searchPos + 1) !== '*/') return hints
  const commentEnd = searchPos + 1
  const commentStart = text.lastIndexOf('/**', commentEnd)
  if (commentStart === -1) return hints
  const commentText = text.slice(commentStart, commentEnd)

  const paramRegex = /@param\s+(?:params\.|inputOrParams\.)?(\w+)\s*-?\s*([^\n@]*)/g
  let match
  while ((match = paramRegex.exec(commentText)) !== null) {
    const paramName = match[1]
    const desc = match[2]
    const unitMatch = desc.match(/\((mm|cm|m|micron|inch|foot|yard|degree|rad|radian|kg|gram|second)\)/i)
    if (unitMatch) {
      const unit = unitMatch[1].toLowerCase()
      const unitToDim = {
        mm: 'length', cm: 'length', m: 'length', micron: 'length',
        inch: 'length', foot: 'length', yard: 'length',
        degree: 'angle', rad: 'angle', radian: 'angle',
        kg: 'mass', gram: 'mass', second: 'time',
      }
      const dim = unitToDim[unit]
      if (dim) hints.set(paramName, dim)
    }
  }
  return hints
}

function processFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8')
  const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.ES2022, true)

  const changes = []  // {pos, end, text}

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'defineOp' || node.expression.text === 'compatOp')
    ) {
      if (node.arguments.length === 0) { ts.forEachChild(node, visit); return }
      const objLit = unwrapToObjectLiteral(node.arguments[0])
      if (!objLit) { ts.forEachChild(node, visit); return }
      if (hasParamDims(objLit)) { ts.forEachChild(node, visit); return }

      // Missing paramDims — need to add it
      const hints = extractJSDocParams(sf, node)

      // Build paramDims from hints + known param names
      const dims = {}
      for (const [param, dim] of hints) {
        dims[param] = dim
      }

      // Also check mesh/brep function signature for params
      for (const prop of objLit.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        if (!ts.isIdentifier(prop.name)) continue
        const propName = prop.name.text
        if (propName === 'mesh' || propName === 'brep') {
          // Try to get function params
          const init = prop.initializer
          if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) {
            for (const param of init.parameters) {
              if (ts.isIdentifier(param.name)) {
                const pName = param.name.text
                if (pName === 'params' || pName === 'input' || pName === 'options') continue
                if (!(pName in dims)) {
                  dims[pName] = inferDim(pName, hints.get(pName))
                }
              }
            }
          }
        }
      }

      // Generate paramDims string
      const entries = Object.entries(dims)
      let paramDimsStr
      if (entries.length === 0) {
        paramDimsStr = 'paramDims: {}'
      } else {
        const parts = entries.map(([k, v]) => `${k}: '${v}'`).join(', ')
        paramDimsStr = `paramDims: { ${parts} }`
      }

      // Insert before the closing } of the object literal
      const closeBrace = objLit.getLastToken()
      if (closeBrace && closeBrace.kind === ts.SyntaxKind.CloseBraceToken) {
        const pos = closeBrace.getStart(sf)
        const prevChar = code[pos - 1]
        const prefix = (prevChar === ',' || prevChar === '\n' || prevChar === ' ') ? '' : ','
        changes.push({
          pos: pos,
          end: pos,
          text: `${prefix}\n  ${paramDimsStr},\n`,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (changes.length === 0) return false

  // Apply changes from end to start
  changes.sort((a, b) => b.pos - a.pos)
  let newCode = code
  for (const change of changes) {
    newCode = newCode.slice(0, change.pos) + change.text + newCode.slice(change.end)
  }

  fs.writeFileSync(filePath, newCode, 'utf-8')
  console.log(`Added paramDims to ${changes.length} defineOp call(s) in: ${filePath}`)
  return true
}

let totalFixed = 0
for (const dir of SCAN_DIRS) {
  const files = collectTs(dir)
  for (const f of files) {
    if (f.replace(/\\/g, '/').endsWith('internal/compat-op.ts')) continue
    if (processFile(f)) totalFixed++
  }
}
console.log(`\nFixed ${totalFixed} files`)
