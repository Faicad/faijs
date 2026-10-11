/**
 * text/svg extras — three-free 几何链行为测试。
 *
 * 验证 P2 迁移后的三个 extras（text-geometry / text-cjk / svg-extrude）
 * 返回 core `Shape` 且几何合理：
 * 1. createTextGeometry：真实 OpenSans 字体渲染，非空、水密、尺寸正确
 * 2. createMixedTextGeometry：混合文本（CJK 无系统字体时走默认字体，notdef 跳过）
 * 3. opentypePathToGeometry：字形轮廓 → Contour → extrude
 * 4. svgToExtrudedGeometry：真实 potrace 素材 logo.svg，解析 + 水密 + 缩放
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { setupTestFont } from '@faicad/faijs/brep/text/fontTestHelper'
import { getOpentypeFont, createTextGeometry, opentypePathToGeometry, opentypePathToContours } from '../../src/extras/text-geometry'
import { createMixedTextGeometry } from '../../src/extras/text-cjk'
import { svgToExtrudedGeometry, parseSvgShapes, extrudeShapes } from '../../src/extras/svg-extrude'
import type { Shape } from '@faicad/faijs/mesh/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 按坐标配对检查每条边恰好被 2 个三角形共享（非索引三角流）。 */
function expectWatertight(shape: Shape): void {
  expect(shape.positions.length).toBeGreaterThan(0)
  expect(shape.indices.length % 3).toBe(0)
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
}

describe('text-geometry (three-free)', () => {
  beforeAll(async () => {
    await setupTestFont()
  })

  it('createTextGeometry renders Latin text into a watertight Shape', async () => {
    const font = await getOpentypeFont()
    const shape = await createTextGeometry('Hello', 10, 2, font)
    expectWatertight(shape)
    // 布局语义：X 居中、Y 底部对齐到 0、Z 居中（maxZ = depth/2）
    let maxZ = -Infinity, minZ = Infinity, minY = Infinity, maxY = -Infinity
    for (let i = 0; i < shape.positions.length; i += 3) {
      maxZ = Math.max(maxZ, shape.positions[i + 2])
      minZ = Math.min(minZ, shape.positions[i + 2])
      minY = Math.min(minY, shape.positions[i + 1])
      maxY = Math.max(maxY, shape.positions[i + 1])
    }
    expect(maxZ).toBeCloseTo(1, 6) // depth/2（Z 居中）
    expect(minZ).toBeCloseTo(-1, 6)
    expect(minY).toBeCloseTo(0, 6) // Y 底部对齐
    expect(maxY).toBeGreaterThan(1)
    expect(shape.indices.length / 3).toBeGreaterThan(50)
  })

  it('createTextGeometry throws on missing glyph', async () => {
    const font = await getOpentypeFont()
    await expect(createTextGeometry('中', 10, 2, font)).rejects.toThrow(/not found in font/)
  })

  it('opentypePathToContours yields contours with hole structure', async () => {
    const font = await getOpentypeFont()
    const path = font.getPath('B', 0, 0, 10)
    const contours = opentypePathToContours(path, 6)
    expect(contours.length).toBeGreaterThan(0)
    // 'B' 有两个内腔（孔）
    expect(contours[0].holes.length).toBeGreaterThanOrEqual(2)
  })

  it('opentypePathToGeometry returns null for empty path', () => {
    const font = null as never
    void font
    // 空 Path：构造一个无命令的 path 对象
    const empty = { commands: [] } as never
    expect(opentypePathToGeometry(empty, 2)).toBeNull()
  })
})

describe('text-cjk (three-free)', () => {
  beforeAll(async () => {
    await setupTestFont()
  })

  it('createMixedTextGeometry merges per-char shapes and centres', async () => {
    const font = await getOpentypeFont()
    // 无系统 CJK 字体（node 环境）：CJK 字符走默认字体 → notdef 被跳过
    const shape = await createMixedTextGeometry('AB中', 10, 2, null, font)
    expectWatertight(shape)
    // 只有拉丁字符被渲染（中文 notdef 跳过）；网格非空
    expect(shape.indices.length).toBeGreaterThan(0)
  })
})

describe('svg-extrude (three-free)', () => {
  const svg = readFileSync(join(__dirname, 'logo.svg'), 'utf-8')

  it('parseSvgShapes resolves the potrace logo into contours', () => {
    const contours = parseSvgShapes(svg)
    expect(contours.length).toBeGreaterThanOrEqual(2) // 外环+孔 与 岛
  })

  it('svgToExtrudedGeometry extrudes the logo watertight and scaled', () => {
    const shape = svgToExtrudedGeometry(svg, {
      depth: 2,
      targetLongSide: 20,
      naturalWidth: 1560,
      naturalHeight: 1560,
    })
    expectWatertight(shape)
    // 缩放：长边 1560 → 20
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < shape.positions.length; i += 3) {
      const x = shape.positions[i]
      const y = shape.positions[i + 1]
      const z = shape.positions[i + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    expect(maxX - minX).toBeLessThanOrEqual(20 + 1e-6)
    expect(maxY - minY).toBeLessThanOrEqual(20 + 1e-6)
    expect(minZ).toBeCloseTo(0, 6) // Z 底部对齐热床
    expect(maxZ).toBeCloseTo(2, 6)
  })

  it('extrudeShapes reuses the shared contour pipeline', () => {
    const contours = parseSvgShapes(svg)
    const shape = extrudeShapes(contours, { depth: 2, naturalWidth: 1560, naturalHeight: 1560 })
    expectWatertight(shape)
  })
})
