/**
 * Parse the natural size of an SVG (single source of truth).
 *
 * Both the BREP path (svg-to-solid.svgToSolid) and the mesh path
 * (svgToExtrudedGeometry) share this function so the same SVG scales
 * identically on both paths.
 *
 * viewBox takes priority, falling back to width/height; if neither exists,
 * returns 0 (no scaling).
 *
 * @param svgString - the SVG source text.
 * @returns the natural width and height of the SVG.
 */

export function parseSvgNaturalSize(svgString: string): { naturalWidth: number; naturalHeight: number } {
  // viewBox 优先
  const vbMatch = svgString.match(/viewBox=["']([^"']+)["']/i)
  if (vbMatch) {
    const parts = vbMatch[1].split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { naturalWidth: parts[2], naturalHeight: parts[3] }
    }
  }
  // 回退到 width/height
  const wMatch = svgString.match(/<svg[^>]*\swidth=["'](\d+(?:\.\d+)?)["']/i)
  const hMatch = svgString.match(/<svg[^>]*\sheight=["'](\d+(?:\.\d+)?)["']/i)
  if (wMatch && hMatch) {
    return { naturalWidth: parseFloat(wMatch[1]), naturalHeight: parseFloat(hMatch[1]) }
  }
  return { naturalWidth: 0, naturalHeight: 0 }
}
