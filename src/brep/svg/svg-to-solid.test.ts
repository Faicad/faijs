/**
 * @vitest-environment node
 *
 * SVG BREP 操作单元测试
 *
 * 测试内容：
 * 1. extractSvgPaths — SVG 元素提取（path/rect/circle/ellipse/line/polyline/polygon）
 * 2. parseSVGPathToWires — SVG path 命令解析 → OCCT wire
 * 3. classifyHoles — 孔洞分类（外轮廓+内孔）
 * 4. svgToSolid — 端到端 SVG → OCCT solid（含曲线/圆弧/孔洞）
 * 5. STEP 导出含 ADVANCED_FACE
 *
 * 运行：npx vitest run src/brep/svg/svg-to-solid.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import {
  extractSvgPaths,
  parseSVGPathToWires,
  classifyHoles,
  svgToSolid,
  parseSvgNaturalSize,
} from './svg-to-solid'
import { solidToShape } from '../brep-ops'
import { getSolidBoundingBox } from '../brep-utils'

let kernel: OcctKernel

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_RESULTS_DIR = join(__dirname, '..', '..', '..', 'test-results', 'svg-blueprints')

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
}, 120000)

// ─── extractSvgPaths ───

describe('extractSvgPaths', () => {
  it('should extract <path d> attributes', () => {
    const svg = '<svg><path d="M 0 0 L 10 0 L 10 10 Z"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('M 0 0')
  })

  it('should extract <rect> as path d', () => {
    const svg = '<svg><rect x="0" y="0" width="10" height="20"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('M 0,0')
    expect(paths[0]).toContain('h 10')
    expect(paths[0]).toContain('v 20')
    expect(paths[0]).toContain('Z')
  })

  it('should extract <circle> as path d with arcs', () => {
    const svg = '<svg><circle cx="5" cy="5" r="3"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('A 3,3')
  })

  it('should extract <ellipse> as path d with arcs', () => {
    const svg = '<svg><ellipse cx="5" cy="5" rx="4" ry="2"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('A 4,2')
  })

  it('should extract <polygon> as path d', () => {
    const svg = '<svg><polygon points="0,0 10,0 10,10 0,10"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('M 0,0')
    expect(paths[0]).toContain('L 10,0')
    expect(paths[0]).toContain('Z')
  })

  it('should extract <polyline> as path d (no Z)', () => {
    const svg = '<svg><polyline points="0,0 10,0 10,10"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('M 0,0')
    expect(paths[0]).not.toContain('Z')
  })

  it('should extract multiple elements', () => {
    const svg = '<svg><rect x="0" y="0" width="10" height="10"/><circle cx="20" cy="20" r="5"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(2)
  })

  it('should return empty array for SVG with no shapes', () => {
    const svg = '<svg><text>hello</text></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths.length).toBe(0)
  })
})

// ─── parseSVGPathToWires ───

describe('parseSVGPathToWires', () => {
  it('should parse simple rectangle path', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 L 10 0 L 10 10 L 0 10 Z')
    expect(subpaths.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should parse path with relative commands', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 l 10 0 l 0 10 l -10 0 z')
    expect(subpaths.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should parse path with H/V commands', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 H 10 V 10 H 0 Z')
    expect(subpaths.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should parse path with cubic bezier (C)', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 C 5 0 5 10 10 10 Z')
    expect(subpaths.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should parse path with quadratic bezier (Q)', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 Q 5 10 10 0 Z')
    expect(subpaths.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should parse path with arc (A)', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 A 5 5 0 0 1 10 0 Z')
    expect(subpaths.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should parse path with smooth cubic bezier (S)', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 C 5 0 5 10 10 10 S 15 0 20 0 Z')
    expect(subpaths.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should parse multiple subpaths (M...Z...M...Z)', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 L 10 0 L 10 10 Z M 20 20 L 30 20 L 30 30 Z')
    expect(subpaths.length).toBe(2)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should compute correct bounding box for a square', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 L 10 0 L 10 10 L 0 10 Z')
    expect(subpaths.length).toBe(1)
    // Y-flipped: SVG (0,0)→(10,10) becomes OCCT (0,0)→(10,-10)
    expect(subpaths[0].bbox.minX).toBeCloseTo(0, 5)
    expect(subpaths[0].bbox.maxX).toBeCloseTo(10, 5)
    expect(subpaths[0].bbox.minY).toBeCloseTo(-10, 5)
    expect(subpaths[0].bbox.maxY).toBeCloseTo(0, 5)
    for (const sp of subpaths) kernel.release(sp.wire)
  })
})

// ─── classifyHoles ───

describe('classifyHoles', () => {
  it('should classify single subpath as outer with no holes', () => {
    const subpaths = parseSVGPathToWires(kernel, 'M 0 0 L 10 0 L 10 10 L 0 10 Z')
    const groups = classifyHoles(subpaths)
    expect(groups.length).toBe(1)
    expect(groups[0].holes.length).toBe(0)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should classify nested subpaths as outer + hole', () => {
    // 外轮廓: 0,0 → 20,0 → 20,-20 → 0,-20 (大正方形)
    // 内孔: 5,-5 → 15,-5 → 15,-15 → 5,-15 (小正方形)
    const subpaths = parseSVGPathToWires(kernel,
      'M 0 0 L 20 0 L 20 20 L 0 20 Z M 5 5 L 15 5 L 15 15 L 5 15 Z')
    const groups = classifyHoles(subpaths)
    expect(groups.length).toBe(1)
    expect(groups[0].holes.length).toBe(1)
    for (const sp of subpaths) kernel.release(sp.wire)
  })

  it('should classify two independent subpaths as two outers', () => {
    const subpaths = parseSVGPathToWires(kernel,
      'M 0 0 L 10 0 L 10 10 L 0 10 Z M 20 20 L 30 20 L 30 30 L 20 30 Z')
    const groups = classifyHoles(subpaths)
    expect(groups.length).toBe(2)
    expect(groups[0].holes.length).toBe(0)
    expect(groups[1].holes.length).toBe(0)
    for (const sp of subpaths) kernel.release(sp.wire)
  })
})

// ─── parseSvgNaturalSize ───

describe('parseSvgNaturalSize', () => {
  it('should parse viewBox', () => {
    const svg = '<svg viewBox="0 0 100 50"></svg>'
    const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svg)
    expect(naturalWidth).toBe(100)
    expect(naturalHeight).toBe(50)
  })

  it('should parse width/height attributes', () => {
    const svg = '<svg width="200" height="100"></svg>'
    const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svg)
    expect(naturalWidth).toBe(200)
    expect(naturalHeight).toBe(100)
  })

  it('should return 0,0 when no size info', () => {
    const svg = '<svg></svg>'
    const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svg)
    expect(naturalWidth).toBe(0)
    expect(naturalHeight).toBe(0)
  })
})

// ─── svgToSolid ───

describe('svgToSolid', () => {
  it('should produce a valid solid from a simple rectangle SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)

    kernel.release(solid)
  })

  it('should produce ADVANCED_FACE in STEP export', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 5, targetLongSide: 20 })
    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(solid)
  })

  it('should produce a solid from <rect> element', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 3, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    kernel.release(solid)
  })

  it('should produce a solid from <circle> element', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 3, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    // 圆柱面应该有精确曲面（不是三角化平面）
    expect(step).toContain('CYLINDRICAL_SURFACE')
    kernel.release(solid)
  })

  it('should produce a solid from <ellipse> element', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="40" ry="20"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 3, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    kernel.release(solid)
  })

  it('should produce a solid from <polygon> element', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="10,10 90,10 50,90"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 3, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    kernel.release(solid)
  })

  it('should produce a solid from path with cubic bezier', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 50 C 10 10 90 10 90 50 C 90 90 10 90 10 50 Z"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 3, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    // 贝塞尔曲线挤出后生成精确曲面（非三角化平面）
    expect(step).not.toContain('POLYGONAL_FACE')
    kernel.release(solid)
  })

  it('should produce a solid from path with arc', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 50 A 40 40 0 0 1 90 50 L 90 90 L 10 90 Z"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 3, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(solid)
  })

  it('should handle holes correctly (outer + inner hole)', () => {
    // 外轮廓 0,0 → 100,0 → 100,100 → 0,100
    // 内孔 20,20 → 80,20 → 80,80 → 20,80
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 0 0 L 100 0 L 100 100 L 0 100 Z M 20 20 L 80 20 L 80 80 L 20 80 Z"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')

    // 带孔的挤出体体积应该小于无孔的
    const solidWithHoleVol = kernel.getVolume(solid)
    kernel.release(solid)

    // 无孔版本
    const svgNoHole = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 0 0 L 100 0 L 100 100 L 0 100 Z"/></svg>'
    const solidNoHole = svgToSolid(kernel, svgNoHole, { depth: 5, targetLongSide: 20 })
    const solidNoHoleVol = kernel.getVolume(solidNoHole)
    kernel.release(solidNoHole)

    expect(solidWithHoleVol).toBeLessThan(solidNoHoleVol)
  })

  it('should handle multiple independent paths', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path d="M 10 10 L 40 10 L 40 40 L 10 40 Z"/><path d="M 60 60 L 90 60 L 90 90 L 60 90 Z"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 3, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(solid)
  })

  it('should scale by targetLongSide correctly', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100"/></svg>'
    // targetLongSide=40, naturalWidth=200 → scale = 40/200 = 0.2
    // 缩放后: 200*0.2=40 (长边), 100*0.2=20 (短边)
    const solid = svgToSolid(kernel, svg, { depth: 5, targetLongSide: 40 })
    const bb = getSolidBoundingBox(kernel, solid)
    // 长边应接近 40（居中后 minX≈-20, maxX≈20）
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(40, 0)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 0)
    // Z 底部对齐到 0
    expect(bb.min[2]).toBeCloseTo(0, 5)
    expect(bb.max[2]).toBeCloseTo(5, 5)
    kernel.release(solid)
  })

  it('should center XY at origin and align Z bottom to 0', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 5, targetLongSide: 20 })
    const bb = getSolidBoundingBox(kernel, solid)
    // XY 居中
    expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(0, 5)
    expect((bb.min[1] + bb.max[1]) / 2).toBeCloseTo(0, 5)
    // Z 底部对齐到 0
    expect(bb.min[2]).toBeCloseTo(0, 5)
    kernel.release(solid)
  })

  it('should throw on empty SVG', () => {
    expect(() => {
      svgToSolid(kernel, '<svg></svg>', { depth: 5 })
    }).toThrow()
  })

  it('should throw on SVG with no path elements', () => {
    expect(() => {
      svgToSolid(kernel, '<svg><text>hello</text></svg>', { depth: 5 })
    }).toThrow()
  })
})

// ─── logo111.svg fixture test ───

describe('svgToSolid with logo111.svg fixture', () => {
  // 读取真实 SVG 文件作为端到端验证
  // logo111.svg 包含: <g transform> + 复杂 <path> + 多个 <rect transform>
  const logoSvg = readFileSync('test/faijs/fixtures/svg/logo111.svg', 'utf-8')

  it('should produce a valid solid from logo111.svg', () => {
    const solid = svgToSolid(kernel, logoSvg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)

    kernel.release(solid)
  })

  it('should produce ADVANCED_FACE in STEP export (true BREP, not faceted)', () => {
    const solid = svgToSolid(kernel, logoSvg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')

    kernel.release(solid)
  })

  it('should produce a solid with non-zero volume', () => {
    const solid = svgToSolid(kernel, logoSvg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const volume = kernel.getVolume(solid)
    expect(volume).toBeGreaterThan(0)

    kernel.release(solid)
  })

  it.skip('writes STEP model file to test-results/', () => {
    const solid = svgToSolid(kernel, logoSvg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const step = kernel.exportStep(solid)
    mkdirSync(TEST_RESULTS_DIR, { recursive: true })
    writeFileSync(join(TEST_RESULTS_DIR, 'logo111.step'), step, 'utf-8')

    kernel.release(solid)
  })

  it('should center XY at origin and align Z bottom to 0', () => {
    const solid = svgToSolid(kernel, logoSvg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    const bb = getSolidBoundingBox(kernel, solid)
    // XY 居中
    expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(0, 1)
    expect((bb.min[1] + bb.max[1]) / 2).toBeCloseTo(0, 1)
    // Z 底部对齐到 0
    expect(bb.min[2]).toBeCloseTo(0, 1)
    expect(bb.max[2]).toBeCloseTo(5, 1)

    kernel.release(solid)
  })
})
