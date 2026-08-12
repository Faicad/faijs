/**
 * STEP 颜色解析器 — 从 STEP 文本中提取每个 solid 的颜色。
 *
 * STEP 文件中的颜色引用链：
 *   STYLED_ITEM → PRESENTATION_STYLE_ASSIGNMENT → SURFACE_STYLE_USAGE
 *   → SURFACE_SIDE_STYLE → SURFACE_STYLE_FILL_AREA → FILL_AREA_STYLE
 *   → FILL_AREA_STYLE_COLOUR → COLOUR_RGB
 *
 * STYLED_ITEM 的第三个参数引用被着色的 shape entity（通常是 MANIFOLD_SOLID_BREP）。
 * 我们解析这个引用链，建立 solid entity ID → color 的映射。
 *
 * 当 OCCT XCAF 的 getLabelInfo 返回 hasColor=false 时（颜色存储在 sub-shape 层级
 * 而非 label 层级），此解析器作为后备方案提取颜色。
 */

export interface StepEntity {
  id: number
  type: string
  /** Raw parameter string (between parentheses). */
  params: string
}

export interface SolidColor {
  /** STEP entity ID of the MANIFOLD_SOLID_BREP. */
  solidId: number
  /** RGB color in 0..1 range. */
  color: [number, number, number]
}

/** Parse all entities from STEP text into a Map<id, StepEntity>. */
function parseStepEntities(stepText: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>()
  // Match lines like: #123=ENTITY_TYPE(params);
  // STEP entities can span multiple lines, but the closing ); is always at end
  const regex = /#(\d+)\s*=\s*([A-Z_]+)\s*\(([^;]*)\)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(stepText)) !== null) {
    const id = parseInt(match[1], 10)
    const type = match[2]
    const params = match[3]
    entities.set(id, { id, type, params })
  }
  return entities
}

/** Extract all # references from a parameter string. Returns array of IDs. */
function extractRefs(params: string): number[] {
  const refs: number[] = []
  const regex = /#(\d+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(params)) !== null) {
    refs.push(parseInt(match[1], 10))
  }
  return refs
}

/**
 * Resolve the color reference chain starting from a STYLED_ITEM.
 * Returns the COLOUR_RGB values if found, or null if the chain is broken.
 */
function resolveColorChain(
  entityId: number,
  entities: Map<number, StepEntity>,
  visited: Set<number> = new Set(),
): [number, number, number] | null {
  if (visited.has(entityId)) return null // cycle guard
  visited.add(entityId)

  const entity = entities.get(entityId)
  if (!entity) return null

  if (entity.type === 'COLOUR_RGB') {
    // Parse: 'name', r, g, b
    const parts = entity.params.split(',')
    // Color values start after the name (which may contain commas if quoted)
    // Find the last 3 numeric values
    const nums: number[] = []
    for (let i = parts.length - 1; i >= 0 && nums.length < 3; i--) {
      const n = parseFloat(parts[i].trim())
      if (!isNaN(n)) nums.unshift(n)
    }
    if (nums.length === 3) {
      return [nums[0], nums[1], nums[2]]
    }
    return null
  }

  // For all intermediate types, follow # references
  const refs = extractRefs(entity.params)
  for (const ref of refs) {
    const color = resolveColorChain(ref, entities, visited)
    if (color) return color
  }

  return null
}

/**
 * Parse STEP text and extract colors for each solid.
 *
 * @param stepText Raw STEP file content
 * @returns Map<solidEntityId, [r, g, b]> where r,g,b are in 0..1 range
 */
export function parseStepColors(stepText: string): Map<number, [number, number, number]> {
  const entities = parseStepEntities(stepText)
  const colorMap = new Map<number, [number, number, number]>()

  for (const [, entity] of entities) {
    if (entity.type === 'STYLED_ITEM') {
      // STYLED_ITEM('', (#styleRef), #shapeRef)
      // The last # reference is the shape being styled
      const refs = extractRefs(entity.params)
      if (refs.length < 2) continue

      const shapeRef = refs[refs.length - 1] // last ref = styled shape
      const styleRef = refs[0] // first ref = presentation style

      // Verify the shape ref is a MANIFOLD_SOLID_BREP (or ADVANCED_BREP_SHAPE_REPRESENTATION)
      const shapeEntity = entities.get(shapeRef)
      if (!shapeEntity) continue

      // Resolve color from the style reference chain
      const color = resolveColorChain(styleRef, entities)
      if (color) {
        colorMap.set(shapeRef, color)
      }
    }
  }

  return colorMap
}

/**
 * Parse STEP text and return the ordered list of solid entity IDs.
 *
 * This order should match OCCT's getSubShapes(compound, 'solid') order,
 * because both iterate the compound's sub-shapes in the same order
 * they appear in the STEP file.
 */
export function parseStepSolidOrder(stepText: string): number[] {
  const entities = parseStepEntities(stepText)
  const solids: number[] = []
  for (const [id, entity] of entities) {
    if (entity.type === 'MANIFOLD_SOLID_BREP') {
      solids.push(id)
    }
  }
  return solids
}

/**
 * Get colors for each solid in order.
 *
 * @param stepText Raw STEP file content
 * @returns Array of colors [r,g,b] in 0..1, or null for solids without color.
 *          Length matches the number of MANIFOLD_SOLID_BREP entities.
 */
export function getSolidColorsOrdered(stepText: string): ([number, number, number] | null)[] {
  const colorMap = parseStepColors(stepText)
  const solidOrder = parseStepSolidOrder(stepText)
  return solidOrder.map(id => colorMap.get(id) ?? null)
}
