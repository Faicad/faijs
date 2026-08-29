/**
 * SVG 自然尺寸解析（单一真源）
 *
 * BREP（svg-to-solid.svgToSolid）与 mesh（svgToExtrudedGeometry）
 * 双路径共用此函数，保证同一 SVG 的双路径缩放一致。
 *
 * viewBox 优先，回退到 width/height，都没有则返回 0（不缩放）。
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
