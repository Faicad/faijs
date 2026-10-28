/**
 * smlib-kernel/smlib-render-defects — weapp 渲染缺陷复现与网格不变量（node 直跑）
 *
 * 用户实测（weapp 端 smlib 内核，2026-10-27）：
 *  1. 榫卯分割（连平面分割也一样）确认后两部分破面；
 *  2. 抽壳后外棱边变圆角、内腔底面从抽壳方向看不见。
 *
 * 缺陷钉成网格不变量（渲染正确性的必要条件集，全部可从 meshShape 输出判定）：
 *  A. 绕向一致：每个三角形 dot(cross(e1,e2), n) > 0（n = 桥写入的 per-vertex 面法向）。
 *     违反 = 该面从法向一侧被背面剔除（three.js FrontSide）→ 看穿/破面。
 *  B. 闭合配对：封闭实体网格每条有向边恰好与反向边成对（1e-3 量化）。
 *     违反 = 丢面 / 丢孔（tessellate 桥只三角化外环，内环孔洞被静默丢弃）。
 *  C. 符号体积 = 内核体积且同号（整体朝外）；网格面积 ≈ 内核表面积（无丢/多面）。
 *  D. 语义契约：抽壳 = 向内等厚薄壁（体积/bbox 精确断言）；平面分割两半各半。
 *
 * 场景与用户操作一一对应（weapp tool-code 发射口径）：
 *  - 平面分割 → fai_split cutMode:'plane' + separationRatio 0.02（splitBrep + translateBrep）
 *  - 燕尾榫卯 → fai_split cutMode:'dovetail'（groove 1/4/60°，公差 0.3 —— 20³ 盒的自适应预填）
 *  - 定位销   → fai_split cutMode:'dowel'（d=4 h=3，公差 0.3 —— 顶面圆孔 = 内环路径）
 *  - 抽壳     → cad.shell（点顶面开口，壁厚 2）
 *
 * Run: npx vitest run test/smlib-kernel/smlib-render-defects.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { initSmlibWasm, resetSmlibWasm, type SmlibKernel } from '../../src/smlib-kernel/smlibWasm'
import { splitBrep, translateBrep } from '../../src/brep/brep-ops'
import {
  dovetailBooleanSplitBrep,
  dowelOrTenonBooleanSplitBrep,
  type JoineryBasis,
  type GrooveParams,
  type DowelOrTenonParams,
} from '../../src/api/brep-operations/joinery-brep'
import { computeBasisFromNormal, separationOffset } from '../../src/extra/mesh/fai_split'
import { DEFAULT_LINEAR_DEFLECTION } from '../../src/tolerance'
import { mm } from '../../src/units'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { Vec3 } from '../../src/mesh/types'

let p: SmlibPrimitives

beforeAll(async () => {
  p = await createSmlibPrimitives()
})

afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

// 端侧显示路径口径（brep-topology.ts / joinery solidToMeshData 同参）
const DISPLAY_TESSELLATE = {
  linearDeflection: DEFAULT_LINEAR_DEFLECTION.as(mm),
  angularDeflection: (2 * Math.PI) / 32,
} as const

// ── 网格诊断 ──

interface GroupDiag {
  tris: number
  area: number
  badWinding: number
  degenerate: number
  normal: [number, number, number]
  zMin: number
  zMax: number
  facePtr: number
}

interface MeshDiag {
  triCount: number
  faceCount: number
  meshArea: number
  signedVolume: number
  windingViolations: number
  degenerateTris: number
  unpairedEdges: number
  groups: GroupDiag[]
}

function analyzeMesh(solid: BrepHandle): MeshDiag {
  const mesh = p.meshShape(solid, DISPLAY_TESSELLATE)
  const positions = mesh.positions
  const normals = mesh.normals
  const indices = mesh.indices
  const faceGroups = mesh.faceGroups
  const edgeDir = new Map<string, number>()
  const q = (v: number) => Math.round(v * 1000) // 1e-3 量化（f32 顶点足够）

  const groups: GroupDiag[] = []
  let meshArea = 0
  let signedVolume = 0
  let windingViolations = 0
  let degenerateTris = 0

  const groupCount = Math.floor(faceGroups.length / 3)
  for (let g = 0; g < groupCount; g++) {
    const startTri = faceGroups[g * 3] / 3
    const triCount = faceGroups[g * 3 + 1] / 3
    const diag: GroupDiag = {
      tris: triCount,
      area: 0,
      badWinding: 0,
      degenerate: 0,
      normal: [0, 0, 0],
      zMin: Infinity,
      zMax: -Infinity,
      facePtr: faceGroups[g * 3 + 2],
    }
    for (let t = startTri; t < startTri + triCount; t++) {
      const i0 = indices[t * 3]
      const i1 = indices[t * 3 + 1]
      const i2 = indices[t * 3 + 2]
      const x0 = positions[i0 * 3]
      const y0 = positions[i0 * 3 + 1]
      const z0 = positions[i0 * 3 + 2]
      const x1 = positions[i1 * 3]
      const y1 = positions[i1 * 3 + 1]
      const z1 = positions[i1 * 3 + 2]
      const x2 = positions[i2 * 3]
      const y2 = positions[i2 * 3 + 1]
      const z2 = positions[i2 * 3 + 2]
      const nx = normals[i0 * 3]
      const ny = normals[i0 * 3 + 1]
      const nz = normals[i0 * 3 + 2]
      if (t === startTri) diag.normal = [nx, ny, nz]
      const cx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0)
      const cy = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0)
      const cz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
      const clen = Math.hypot(cx, cy, cz)
      diag.area += clen / 2
      meshArea += clen / 2
      if (clen < 1e-9) {
        diag.degenerate++
        degenerateTris++
      } else if (cx * nx + cy * ny + cz * nz < 0) {
        diag.badWinding++
        windingViolations++
      }
      signedVolume += (x0 * (y1 * z2 - z1 * y2) + y0 * (z1 * x2 - x1 * z2) + z0 * (x1 * y2 - y1 * x2)) / 6
      // 有向边登记（闭合配对检查用）
      const edges: Array<[number, number, number, number, number, number]> = [
        [x0, y0, z0, x1, y1, z1],
        [x1, y1, z1, x2, y2, z2],
        [x2, y2, z2, x0, y0, z0],
      ]
      for (const [ax, ay, az, bx, by, bz] of edges) {
        const key = `${q(ax)},${q(ay)},${q(az)}>${q(bx)},${q(by)},${q(bz)}`
        edgeDir.set(key, (edgeDir.get(key) ?? 0) + 1)
      }
      diag.zMin = Math.min(diag.zMin, z0, z1, z2)
      diag.zMax = Math.max(diag.zMax, z0, z1, z2)
    }
    groups.push(diag)
  }

  // 配对：每条有向边的条数不得超过其反向边的条数（超出部分 = 未配对）
  let unpairedEdges = 0
  for (const [key, count] of edgeDir) {
    const gt = key.indexOf('>')
    const rev = `${key.slice(gt + 1)}>${key.slice(0, gt)}`
    const rcount = edgeDir.get(rev) ?? 0
    if (count > rcount) unpairedEdges += count - rcount
  }

  return {
    triCount: Math.floor(indices.length / 3),
    faceCount: groupCount,
    meshArea,
    signedVolume,
    windingViolations,
    degenerateTris,
    unpairedEdges,
    groups,
  }
}

function logDiag(label: string, solid: BrepHandle, diag: MeshDiag): void {
  const kv = p.getVolume(solid)
  const ka = p.getSurfaceArea(solid)
  console.log(
    `[${label}] tris=${diag.triCount} faces=${diag.faceCount} meshArea=${diag.meshArea.toFixed(2)} kernelArea=${ka.toFixed(2)} ` +
      `signedVol=${diag.signedVolume.toFixed(2)} kernelVol=${kv.toFixed(2)} windingBad=${diag.windingViolations} ` +
      `degenerate=${diag.degenerateTris} unpairedEdges=${diag.unpairedEdges} isSolid=${p.isSolid(solid)}`,
  )
  for (let i = 0; i < diag.groups.length; i++) {
    const g = diag.groups[i]
    console.log(
      `  [${label}] face#${i} tris=${g.tris} area=${g.area.toFixed(2)} ` +
        `n=(${g.normal.map((v) => v.toFixed(2)).join(',')}) z=[${g.zMin.toFixed(2)},${g.zMax.toFixed(2)}]` +
        `${g.badWinding ? ` badWinding=${g.badWinding}` : ''}${g.degenerate ? ` degenerate=${g.degenerate}` : ''}`,
    )
  }
}

/**
 * 诊断：逐面打印每个三角形的精确顶点坐标 + facePtr ↔ brep 面质心映射。
 * 用于定位破面里"坏顶点"的精确位置（如燕尾 front 顶面环里的 (10,10,0)）。
 * 注意：内部再次 meshShape —— 与 analyzeMesh 的结果对照可顺带验证两次细分是否一致。
 */
function dumpTriangles(label: string, solid: BrepHandle): void {
  const mesh = p.meshShape(solid, DISPLAY_TESSELLATE)
  const positions = mesh.positions
  const indices = mesh.indices
  const faceGroups = mesh.faceGroups
  const faceCentroid = new Map<number, string>()
  for (const f of p.getSubShapes(solid, 'face')) {
    const c = p.surfaceCenterOfMass(f)
    faceCentroid.set(
      f as unknown as number,
      `(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`,
    )
  }
  const groupCount = Math.floor(faceGroups.length / 3)
  for (let g = 0; g < groupCount; g++) {
    const startTri = faceGroups[g * 3] / 3
    const triCount = faceGroups[g * 3 + 1] / 3
    const facePtr = faceGroups[g * 3 + 2]
    const cent = faceCentroid.get(facePtr) ?? ' ?'
    console.log(`  [${label}] group#${g} facePtr=${facePtr} centroid=${cent} tris=${triCount}`)
    for (let t = startTri; t < startTri + triCount; t++) {
      const vs: string[] = []
      for (const c of [0, 1, 2]) {
        const vi = indices[t * 3 + c]
        vs.push(
          `(${positions[vi * 3].toFixed(3)},${positions[vi * 3 + 1].toFixed(3)},${positions[vi * 3 + 2].toFixed(3)})`,
        )
      }
      console.log(`    [${label}] tri#${t - startTri}: ${vs.join(' ')}`)
    }
  }
}

/** 不变量 A/B/C（封闭实体网格契约）。 */
function expectClosedCoherentMesh(label: string, solid: BrepHandle, diag: MeshDiag): void {
  expect(diag.windingViolations, `${label} 绕向一致 dot(cross,n)>0`).toBe(0)
  expect(diag.degenerateTris, `${label} 无退化三角`).toBe(0)
  expect(diag.unpairedEdges, `${label} 闭合流形（有向边成对）`).toBe(0)
  const kv = p.getVolume(solid)
  expect(
    Math.abs(diag.signedVolume - kv) / Math.max(Math.abs(kv), 1e-9),
    `${label} 网格符号体积 = 内核体积`,
  ).toBeLessThan(0.005)
  const ka = p.getSurfaceArea(solid)
  expect(
    Math.abs(diag.meshArea - ka) / Math.max(Math.abs(ka), 1e-9),
    `${label} 网格面积 = 内核表面积`,
  ).toBeLessThan(0.005)
}

// ── 场景 ──

describe('对照：无布尔 box 20³', () => {
  it('网格不变量全零（12 三角 / 6 面 / 体积 8000 / 表面 2400）', () => {
    const box = p.makeBox(20, 20, 20)
    const diag = analyzeMesh(box)
    logDiag('box20', box, diag)
    expect(diag.triCount).toBe(12)
    expect(diag.faceCount).toBe(6)
    expect(p.getVolume(box)).toBeCloseTo(8000, 1)
    expect(p.getSurfaceArea(box)).toBeCloseTo(2400, 1)
    expectClosedCoherentMesh('box20', box, diag)
  })
})

describe('用户缺陷 1 复现：平面分割（fai_split cutMode=plane + separationRatio 0.02）', () => {
  it('两半各 4000、闭合、绕向一致、半盒 6 面', () => {
    const box = p.makeBox(20, 20, 20)
    const { front, back } = splitBrep(p, box, {
      normal: [0, 0, 1],
      planeDistance: 10,
      planeCenter: [10, 10, 10],
    })
    const sep = separationOffset({ separationRatio: 0.02 }, [20, 20, 20])
    const frontMoved = translateBrep(p, front, [0, 0, sep])
    const backMoved = translateBrep(p, back, [0, 0, -sep])
    for (const [label, half] of [
      ['front', frontMoved],
      ['back', backMoved],
    ] as const) {
      const diag = analyzeMesh(half)
      logDiag(`split-plane ${label}`, half, diag)
      dumpTriangles(`split-plane ${label}`, half)
      expect(p.isSolid(half), `${label} 是闭合实体`).toBe(true)
      expect(p.getVolume(half), `${label} 体积`).toBeCloseTo(4000, 1)
      expect(diag.faceCount, `${label} 面数（半盒 6 面）`).toBe(6)
      expectClosedCoherentMesh(`split-plane ${label}`, half, diag)
    }
    const bbF = p.getBoundingBox(frontMoved)
    expect(bbF.zmin).toBeCloseTo(10 + sep, 2)
    expect(bbF.zmax).toBeCloseTo(20 + sep, 2)
    const bbB = p.getBoundingBox(backMoved)
    expect(bbB.zmax).toBeCloseTo(10 - sep, 2)
  })
})

describe('用户缺陷 2 复现：抽壳（点顶面开口，壁厚 2）', () => {
  it('探针：SmApiShellBrepFullEx 参数变体（诊断日志，断言只在契约用例）', async () => {
    const k: SmlibKernel = await initSmlibWasm()
    const box = p.makeBox(10, 10, 10)
    const faces = p.getSubShapes(box, 'face')
    let top = faces[0]
    let maxZ = -Infinity
    for (const f of faces) {
      const c = p.surfaceCenterOfMass(f)
      console.log(`[shell-probe] face centroid = (${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)})`)
      if (c.z > maxZ) {
        maxZ = c.z
        top = f
      }
    }
    const variants: Array<[string, number, number]> = [
      ['正距离外扩 (+2, bExt=0) —— 内核语义 offset−original（反例）', 2, 0],
      ['负距离内缩 (-2, bExt=0) —— faijs shell 适配器口径', -2, 0],
      ['负距离内缩 (-2, bExt=1)', -2, 1],
    ]
    for (const [label, dDist, bExt] of variants) {
      const arr = k.malloc(4)
      const out = k.malloc(4)
      try {
        const dv = new DataView(k.memory.buffer)
        dv.setUint32(arr, top as unknown as number, true)
        dv.setUint32(out, 0, true)
        const st = k.find('SmApiShellBrepFullEx')(
          box as unknown as number,
          dDist,
          bExt,
          1,
          1,
          arr,
          1,
          out,
        )
        if (st !== 1000) {
          console.log(`[shell-probe] ${label}: status ${st}`)
          continue
        }
        const h = dv.getUint32(out, true) as BrepHandle
        const bb = p.getBoundingBox(h)
        console.log(
          `[shell-probe] ${label}: volume=${p.getVolume(h).toFixed(3)} ` +
            `bbox=[${bb.xmin},${bb.ymin},${bb.zmin}]-[${bb.xmax},${bb.ymax},${bb.zmax}] isSolid=${p.isSolid(h)}`,
        )
      } finally {
        k.free(arr)
        k.free(out)
      }
    }
  })

  it('契约：向内等厚薄壁（体积 712 / bbox [0,10]³ 不外扩 / 网格不变量）', () => {
    const box = p.makeBox(10, 10, 10)
    const faces = p.getSubShapes(box, 'face')
    let top = faces[0]
    let maxZ = -Infinity
    for (const f of faces) {
      const c = p.surfaceCenterOfMass(f)
      if (c.z > maxZ) {
        maxZ = c.z
        top = f
      }
    }
    const shelled = p.shell(box, [top], 2, 0.01)
    const diag = analyzeMesh(shelled)
    logDiag('shell t=2', shelled, diag)
    expect(p.isSolid(shelled), '抽壳结果是闭合实体').toBe(true)
    // 向内薄壁：1000 − 内腔 6·6·8 = 712（开口在顶面，壁厚 2 向内）
    expect(p.getVolume(shelled), '体积 = 712（向内薄壁）').toBeCloseTo(712, 0)
    const bb = p.getBoundingBox(shelled)
    expect(bb.xmin, 'bbox 不外扩（缺陷 2 的圆角外扩形态）').toBeCloseTo(0, 2)
    expect(bb.xmax).toBeCloseTo(10, 2)
    expect(bb.ymin).toBeCloseTo(0, 2)
    expect(bb.ymax).toBeCloseTo(10, 2)
    expect(bb.zmin).toBeCloseTo(0, 2)
    expect(bb.zmax).toBeCloseTo(10, 2)
    expectClosedCoherentMesh('shell t=2', shelled, diag)
  })
})

describe('用户缺陷 1 复现：燕尾榫卯分割（groove 1/4/60°，公差 0.3）', () => {
  it('两半闭合、绕向一致、体积合理', () => {
    const box = p.makeBox(20, 20, 20)
    const { widthDir, depthDir } = computeBasisFromNormal([0, 0, 1], 0)
    const basis: JoineryBasis = {
      normal: [0, 0, 1],
      widthDir,
      depthDir,
      planeCenter: [10, 10, 10],
      planeDistance: 10,
    }
    const groove: GrooveParams = {
      depth: 1,
      depthTolerance: 0.3,
      width: 4,
      widthTolerance: 0.3,
      flapsAngle: 60,
    }
    const { front, back } = dovetailBooleanSplitBrep(p, box, basis, groove)
    const diagF = analyzeMesh(front)
    logDiag('dovetail front', front, diagF)
    dumpTriangles('dovetail front', front)
    const diagB = analyzeMesh(back)
    logDiag('dovetail back', back, diagB)
    dumpTriangles('dovetail back', back)
    expect(p.isSolid(front)).toBe(true)
    expect(p.isSolid(back)).toBe(true)
    // 楔体积（梯形截面 × 20）：front +≈68.45（4/1/60°），back −≈100.09（4.6/1.3/60°）
    expect(p.getVolume(front), 'front = 4000 + 楔 ≈ 4068').toBeGreaterThan(4055)
    expect(p.getVolume(front)).toBeLessThan(4082)
    expect(p.getVolume(back), 'back = 4000 − 公差楔 ≈ 3900').toBeGreaterThan(3887)
    expect(p.getVolume(back)).toBeLessThan(3913)
    expectClosedCoherentMesh('dovetail front', front, diagF)
    expectClosedCoherentMesh('dovetail back', back, diagB)
  })
})

describe('用户缺陷 1 复现：定位销榫卯分割（顶面圆孔 = tessellate 内环路径）', () => {
  it('下半带孔闭合、绕向一致、孔环不丢', () => {
    const box = p.makeBox(20, 20, 20)
    const { widthDir, depthDir } = computeBasisFromNormal([0, 0, 1], 0)
    const basis: JoineryBasis = {
      normal: [0, 0, 1],
      widthDir,
      depthDir,
      planeCenter: [10, 10, 10],
      planeDistance: 10,
    }
    const params: DowelOrTenonParams = { size: 4, sizeTolerance: 0.3, height: 3, heightTolerance: 0.3 }
    const { front, back } = dowelOrTenonBooleanSplitBrep(p, box, basis, 'dowel', params, null)
    const diagF = analyzeMesh(front)
    logDiag('dowel front', front, diagF)
    dumpTriangles('dowel front', front)
    const diagB = analyzeMesh(back)
    logDiag('dowel back', back, diagB)
    expect(p.isSolid(front)).toBe(true)
    expect(p.isSolid(back)).toBe(true)
    // front = 4000 + π·2²·3 ≈ 4037.7；back = 4000 − π·2.3²·3.3 ≈ 3945.2
    expect(p.getVolume(front)).toBeGreaterThan(4030)
    expect(p.getVolume(front)).toBeLessThan(4046)
    expect(p.getVolume(back)).toBeGreaterThan(3938)
    expect(p.getVolume(back)).toBeLessThan(3954)
    expectClosedCoherentMesh('dowel front', front, diagF)
    expectClosedCoherentMesh('dowel back', back, diagB)
  })
})
