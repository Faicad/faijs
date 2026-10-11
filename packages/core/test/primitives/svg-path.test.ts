/**
 * svg-path — 共享 SVG 语法层与折线化测试。
 *
 * 覆盖：
 * 1. `tokenizeSvgPath`：完整命令集（M/L/H/V/C/S/Q/T/A/Z + 相对小写）
 * 2. `extractSvgPaths`：path/rect/circle/ellipse/line/polyline/polygon + rect 圆角
 * 3. `parsePathToSubpaths`：隐式闭合、Z 闭合、bezier 采样、arc 三点圆弧近似
 * 4. `svgPathToContours` + `extrudeShape` 集成：**真实素材 logo.svg**（potrace
 *    位图矢量化：相对命令 + group matrix transform）必须可解析、可拉伸、水密。
 *
 * 运行：npx vitest run test/primitives/svg-path.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  tokenizeSvgPath,
  extractSvgPaths,
  parsePathToSubpaths,
  svgPathToContours,
  extractGroupTransform,
  parseSvgTransform,
} from '../../src/primitives/svg/svg-path'
import { extrudeShape } from '../../src/mesh/meshdata/extrude'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('tokenizeSvgPath', () => {
  it('full command set with relative forms', () => {
    const tokens = tokenizeSvgPath('M 1,2 L 3,4 H 5 V 6 C 1,2 3,4 5,6 S 1,2 3,4 Q 1,2 3,4 T 5,6 A 1,1 0 1 0 7,8 Z')
    expect(tokens.map((t) => t.command)).toEqual([
      'M', 'L', 'H', 'V', 'C', 'S', 'Q', 'T', 'A', 'Z',
    ])
    expect(tokens[0].args).toEqual([1, 2])
    expect(tokens[8].args).toEqual([1, 1, 0, 1, 0, 7, 8])
  })

  it('relative commands stay lowercase', () => {
    const tokens = tokenizeSvgPath('m 10,20 l 5,5 z')
    expect(tokens.map((t) => t.command)).toEqual(['m', 'l', 'z'])
  })

  it('multi-arg groups after one command letter', () => {
    const tokens = tokenizeSvgPath('m 1,2 3,4 5,6')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].args).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('extractSvgPaths', () => {
  it('extracts path/rect/circle/ellipse/line/polyline/polygon', () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <path d="M 0 0 L 1 1 Z"/>
        <rect x="1" y="2" width="3" height="4"/>
        <rect x="1" y="2" width="3" height="4" rx="1" ry="1"/>
        <circle cx="5" cy="5" r="2"/>
        <ellipse cx="6" cy="6" rx="2" ry="3"/>
        <line x1="0" y1="0" x2="1" y2="1"/>
        <polyline points="0,0 1,1 2,2"/>
        <polygon points="0,0 1,1 2,0"/>
      </svg>`
    const paths = extractSvgPaths(svg)
    expect(paths).toHaveLength(8)
    expect(paths[0]).toBe('M 0 0 L 1 1 Z')
    expect(paths[1]).toBe('M 1,2 h 3 v 4 h -3 Z')
    expect(paths[2]).toContain('A ') // rect 圆角转弧
    expect(paths[3]).toContain('A ') // circle → 两段半圆
    expect(paths[4]).toContain('A ') // ellipse
    expect(paths[5]).toBe('M 0,0 L 1,1')
    expect(paths[6]).toBe('M 0,0 L 1,1 L 2,2')
    expect(paths[7]).toMatch(/ Z$/)
  })

  it('rect with transform expands corners', () => {
    const svg = '<svg><rect x="0" y="0" width="10" height="10" transform="matrix(1,0,0,1,5,6)"/></svg>'
    const paths = extractSvgPaths(svg)
    expect(paths[0]).toBe('M 5,6 L 15,6 L 15,16 L 5,16 Z')
  })
})

describe('parsePathToSubpaths', () => {
  it('explicit Z closes and yields one closed subpath', () => {
    const sps = parsePathToSubpaths('M 0,0 L 10,0 L 10,10 Z', 6)
    expect(sps).toHaveLength(1)
    expect(sps[0].closed).toBe(true)
    expect(sps[0].points).toHaveLength(4) // 3 + Z 闭合点
    expect(sps[0].signedArea).not.toBe(0)
  })

  it('implicit close (no Z) still flushes a subpath at next M', () => {
    const sps = parsePathToSubpaths('M 0,0 L 10,0 L 10,10 M 20,20 L 30,30', 6)
    expect(sps).toHaveLength(2)
    expect(sps[0].closed).toBe(false)
  })

  it('cubic bezier sampling yields curveSegments points per segment', () => {
    const sps = parsePathToSubpaths('M 0,0 C 10,0 0,10 10,10', 4)
    expect(sps[0].points).toHaveLength(1 + 4) // M 起点 + 4 采样点
    // 终点 = (10,10)
    expect(sps[0].points[sps[0].points.length - 1]).toEqual({ x: 10, y: 10 })
  })

  it('quadratic bezier sampling (Q) with S/T reflection family', () => {
    const sps = parsePathToSubpaths('M 0,0 Q 5,10 10,10 T 20,20', 3)
    // M + 3 + 3
    expect(sps[0].points).toHaveLength(1 + 3 + 3)
    expect(sps[0].points[sps[0].points.length - 1]).toEqual({ x: 20, y: 20 })
  })

  it('arc command produces sampled arc points (sagitta three-point approx)', () => {
    const sps = parsePathToSubpaths('M 0,0 A 5,5 0 0 1 10,0', 4)
    expect(sps[0].points).toHaveLength(1 + 4)
    // 半圆上顶点的 y 应 > 0（Y-down 下 sweep=1 → 弧向下凸？以弧中点 y 方向验证即可）
    const midY = sps[0].points[2].y
    expect(Math.abs(midY)).toBeGreaterThan(0)
  })

  it('full circle via two half arcs', () => {
    const sps = parsePathToSubpaths('M 0,0 A 5,5 0 1 0 10,0 A 5,5 0 1 0 0,0', 4)
    expect(sps[0].points.length).toBeGreaterThan(8)
  })
})

describe('extractGroupTransform / parseSvgTransform', () => {
  it('parses matrix(...) and finds group transform', () => {
    expect(parseSvgTransform('matrix(0.1,0,0,-0.1,-425.13732,1500.4667)')).toEqual([
      0.1, 0, 0, -0.1, -425.13732, 1500.4667,
    ])
    const svg = '<svg><g transform="matrix(1,0,0,1,2,3)"><path d="M 0 0"/></g></svg>'
    expect(extractGroupTransform(svg)).toEqual([1, 0, 0, 1, 2, 3])
  })
})

describe('logo.svg integration (real-world potrace output)', () => {
  const svg = readFileSync(join(__dirname, 'logo.svg'), 'utf-8')

  it('extracts exactly 2 paths from the logo', () => {
    expect(extractSvgPaths(svg)).toHaveLength(2)
  })

  it('resolves contours and extrudes into a watertight mesh', () => {
    const contours = svgPathToContours(svg, 6)
    expect(contours.length).toBeGreaterThan(0)

    const shape = extrudeShape(contours, 2)

    // 网格合理性：轮廓折点 1224（外环+孔）+ 25（岛）× 曲线采样 → 三角形数千量级
    expect(shape.positions.length / 3).toBeGreaterThan(10_000)
    expect(shape.indices.length / 3).toBeGreaterThan(1_000)

    // 水密性：每条**几何边**（按坐标配对）恰好被 2 个三角形共享（开放边界 = 0）。
    // 注意：extrudeShape 输出非索引三角流（底/侧/顶顶点为独立副本），
    // 共享边必须用坐标做 key——索引 key 在非索引布局下永不配对。
    const pos = shape.positions
    const edgeCount = new Map<string, number>()
    for (let i = 0; i < shape.indices.length; i += 3) {
      const v = [
        [shape.indices[i], shape.indices[i + 1]],
        [shape.indices[i + 1], shape.indices[i + 2]],
        [shape.indices[i + 2], shape.indices[i]],
      ]
      for (const [u, w] of v) {
        const ax = pos[u * 3], ay = pos[u * 3 + 1], az = pos[u * 3 + 2]
        const bx = pos[w * 3], by = pos[w * 3 + 1], bz = pos[w * 3 + 2]
        const key = ax < bx || (ax === bx && (ay < by || (ay === by && az < bz)))
          ? `${ax},${ay},${az}|${bx},${by},${bz}`
          : `${bx},${by},${bz}|${ax},${ay},${az}`
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
    }
    let open = 0
    for (const [, count] of edgeCount) {
      if (count !== 2) open++
    }
    expect(open).toBe(0)

    // 几何合理性：拉伸高度 = depth，XY 尺寸在合理范围（logo 归一后 targetLongSide 语义外）
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < shape.positions.length; i += 3) {
      minX = Math.min(minX, shape.positions[i])
      maxX = Math.max(maxX, shape.positions[i])
      minY = Math.min(minY, shape.positions[i + 1])
      maxY = Math.max(maxY, shape.positions[i + 1])
      maxZ = Math.max(maxZ, shape.positions[i + 2])
    }
    expect(maxZ).toBeCloseTo(2, 6)
    expect(maxX - minX).toBeGreaterThan(0)
    expect(maxY - minY).toBeGreaterThan(0)
  })

  it('golden: contour structure is stable (regression guard)', () => {
    const contours = svgPathToContours(svg, 6)
    // potrace 素材结构固化：1 个外环（197 折点）+ 5 个孔，另 1 个独立小点轮廓
    expect(contours.length).toBe(2)
    expect(contours[0].outer.length).toBe(197)
    expect(contours[0].holes.map((h) => h.length).sort((a, b) => a - b)).toEqual([55, 105, 149, 237, 481])
    expect(contours[1].outer.length).toBe(25)
    expect(contours[1].holes).toHaveLength(0)
  })
})
